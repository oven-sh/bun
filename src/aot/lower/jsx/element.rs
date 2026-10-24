use std::cmp::Ordering;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ImplicitReference, ImplicitReferenceKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{self, ExprId, ExprKind, NodeData, is_intrinsic_jsx_name};
use bun_sema::import_sites::{
    JsxCallee, JsxImport, find_key_attribute, has_static_children, is_ignored_key, jsx_callee,
    jsx_children,
};
use bun_sema::resolve::JsxRuntime;
use smallvec::{SmallVec, smallvec};

use super::Element;
use super::props::{
    lower_attribute_value, lower_child_list, lower_create_element_props, lower_runtime_props,
};
use crate::diagnostic_codes::Code;
use crate::ir::ValueId;
use crate::lower::call::{self, Arguments, CallSite, Callee};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, expression, function, module, scope};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum JsxRoot {
    Factory,
    Fragment,
}

fn jsx_reference_order(reference: &ImplicitReference) -> Option<(ExprId, JsxRoot)> {
    let root = match reference.kind {
        ImplicitReferenceKind::JsxFactory => JsxRoot::Factory,
        ImplicitReferenceKind::JsxFragment => JsxRoot::Fragment,
        ImplicitReferenceKind::DecoratorMetadata(_) => return None,
    };
    let NodeData::Expr(expression) = reference.node else {
        unreachable!("the binder records a JSX root at its element");
    };
    Some((expression, root))
}

fn find_jsx_reference(
    references: &[ImplicitReference],
    expression: ExprId,
    root: JsxRoot,
) -> ImplicitReference {
    let found = references.binary_search_by(|reference| match jsx_reference_order(reference) {
        Some(order) => order.cmp(&(expression, root)),
        None => Ordering::Greater,
    });
    let index = found.expect("the binder records the root of every classic element");
    references[index]
}

fn is_spread(hir: &hir::File<'_>, expression: ExprId) -> bool {
    matches!(hir[expression].kind, ExprKind::Spread(_))
}

fn find_intrinsic_tag_name(file: &FileLowering<'_, '_, '_, '_>, tag: ExprId) -> Option<Atom> {
    match file.hir[tag].kind {
        ExprKind::String(name) => Some(name),
        ExprKind::This => Some(known::this),
        ExprKind::Ident(name) => {
            is_intrinsic_jsx_name(file.queries.atom_bytes(name)).then_some(name)
        }
        _ => None,
    }
}

// The element has no spread attribute.
pub(super) fn lower_parts_for_effect(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    let hir = lowering.file.hir;
    let ExprKind::Jsx(jsx) = hir[expression].kind else {
        unreachable!("lower_parts_for_effect takes a Jsx expression");
    };
    let tag = hir[jsx].tag.some();
    let tag = tag.filter(|&tag| find_intrinsic_tag_name(lowering.file, tag).is_none());
    let values = hir[jsx].attrs.iter().filter_map(|it| hir[it].value.some());
    let parts: SmallVec<[ExprId; 8]> = tag
        .into_iter()
        .chain(values)
        .chain(hir.ids(hir[jsx].children))
        .collect();
    for part in parts {
        expression::lower_expression_for_effect(lowering, part);
    }
}

pub(super) fn lower_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Jsx(jsx) = hir[expression].kind else {
        debug_assert!(false, "lower_element takes a Jsx expression");
        return lowering.builder.undefined();
    };
    let element = Element {
        expression,
        jsx,
        position: hir[expression].pos,
        key: find_key_attribute(hir, jsx).key,
    };
    let target = jsx_callee(hir, lowering.file.compiled.jsx_mode, jsx);
    debug_assert!(
        target != JsxCallee::Import(JsxImport::Fragment),
        "Fragment is a tag, never a callee"
    );
    report_jsx_key_warnings(lowering.file, element, target);
    lowering.set_position(element.position);
    let callee = lower_jsx_callee(lowering, element, target);
    let tag = lower_jsx_tag(lowering, element);
    let arguments = match target {
        JsxCallee::Factory | JsxCallee::Import(JsxImport::CreateElement) => {
            lower_create_element_arguments(lowering, element, tag)
        }
        JsxCallee::Import(JsxImport::Jsx | JsxImport::Jsxs | JsxImport::Fragment) => {
            lower_jsx_runtime_arguments(lowering, element, tag, false)
        }
        JsxCallee::Import(JsxImport::JsxDev) => {
            lower_jsx_runtime_arguments(lowering, element, tag, true)
        }
    };
    lowering.set_position(element.position);
    let site = CallSite {
        callee_key: callee.key,
        callee_name: callee.name,
        ..CallSite::default()
    };
    call::emit_call(lowering, callee.function, callee.this, arguments, site)
}

fn report_jsx_key_warnings(
    file: &mut FileLowering<'_, '_, '_, '_>,
    element: Element,
    target: JsxCallee,
) {
    let hir = file.hir;
    for attribute in hir[element.jsx].attrs.iter() {
        if is_ignored_key(hir, attribute) {
            let span = file.span_of(NodeData::Prop(attribute));
            file.diagnostics.report(Code::JsxKeyIgnored, span, &[]);
        }
    }
    if target == JsxCallee::Import(JsxImport::CreateElement) {
        let span = file.span_of(NodeData::Expr(element.expression));
        file.diagnostics.report(Code::JsxKeyAfterSpread, span, &[]);
    }
}

fn get_jsx_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    import: JsxImport,
) -> Callee {
    let binding = lowering
        .file
        .inputs
        .modules
        .jsx_binding(lowering.file.file, import);
    let name = lowering.file.intern_bytes(import.export_name());
    Callee {
        function: module::emit_import_binding(lowering, binding, name),
        this: None,
        key: None,
        name: Some(name),
    }
}

fn lower_jsx_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
    target: JsxCallee,
) -> Callee {
    match target {
        JsxCallee::Import(import) => get_jsx_import(lowering, import),
        JsxCallee::Factory => {
            let settings = lowering.file.compiled.jsx;
            lower_jsx_member_path(lowering, element, JsxRoot::Factory, &settings.factory)
        }
    }
}

fn lower_jsx_member_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
    root: JsxRoot,
    path: &[Vec<u8>],
) -> Callee {
    let references = lowering.file.bound.runtime.implicit_references();
    let reference = find_jsx_reference(references, element.expression, root);
    let root_name = lowering
        .file
        .intern_binding_name(reference.binding, reference.name);
    let mut callee = Callee {
        function: scope::get_binding(lowering, reference.binding, reference.name),
        this: None,
        key: None,
        name: Some(root_name),
    };
    for member_name in path.iter().skip(1) {
        let text = lowering.file.intern_bytes(member_name);
        let key = lowering.file.text_key(text);
        let receiver = callee.function;
        callee = Callee {
            function: member::emit_get(lowering, receiver, PropertyName::Constant(key)),
            this: Some(receiver),
            key: Some(key),
            name: Some(text),
        };
    }
    callee
}

fn lower_jsx_tag(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, element: Element) -> ValueId {
    let hir = lowering.file.hir;
    let Some(tag) = hir[element.jsx].tag.some() else {
        return lower_jsx_fragment_tag(lowering, element);
    };
    match find_intrinsic_tag_name(lowering.file, tag) {
        Some(name) => {
            lowering.set_position(hir[tag].pos);
            expression::emit_constant(lowering, Constant::String(name))
        }
        None => expression::lower_expression(lowering, tag),
    }
}

fn lower_jsx_fragment_tag(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
) -> ValueId {
    let settings = lowering.file.compiled.jsx;
    match settings.runtime {
        JsxRuntime::Automatic => get_jsx_import(lowering, JsxImport::Fragment).function,
        JsxRuntime::Classic => {
            let path = &settings.fragment;
            lower_jsx_member_path(lowering, element, JsxRoot::Fragment, path).function
        }
    }
}

fn lower_jsx_runtime_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
    tag: ValueId,
    is_development: bool,
) -> Arguments {
    let props = lower_runtime_props(lowering, element);
    let key = element.key.map(|key| lower_attribute_value(lowering, key));
    lowering.set_position(element.position);
    let mut arguments: SmallVec<[ValueId; 4]> = smallvec![tag, props];
    if is_development {
        let is_static = has_static_children(lowering.file.hir, element.jsx);
        arguments.push(key.unwrap_or_else(|| lowering.builder.undefined()));
        arguments.push(lowering.builder.boolean(is_static));
        arguments.push(lowering.builder.undefined());
        arguments.push(function::get_this(lowering));
    } else {
        arguments.extend(key);
    }
    Arguments::Values(arguments)
}

fn lower_create_element_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
    tag: ValueId,
) -> Arguments {
    let hir = lowering.file.hir;
    let props = lower_create_element_props(lowering, element);
    let children: SmallVec<[ExprId; 8]> = jsx_children(hir, element.jsx).collect();
    if children.iter().any(|&child| is_spread(hir, child)) {
        let list = lower_child_list(lowering, element.position, &[tag, props], &children);
        return Arguments::List(list);
    }
    let mut arguments: SmallVec<[ValueId; 4]> = smallvec![tag, props];
    arguments.extend(
        children
            .iter()
            .map(|&child| expression::lower_expression(lowering, child)),
    );
    Arguments::Values(arguments)
}

#[cfg(test)]
mod tests {
    use bun_sema::atom::known;
    use bun_sema::bind::decorator_metadata::MetadataReference;
    use bun_sema::bind::{Binding, ImplicitReference, ImplicitReferenceKind, SymbolId};
    use bun_sema::hir::{ExprId, MemberId, NodeData, ParamId, TypeNodeId};

    use super::{JsxRoot, find_jsx_reference};

    fn recorded_references() -> [ImplicitReference; 6] {
        let record = |node, kind, name| ImplicitReference {
            node,
            kind,
            name,
            binding: Binding::Free,
        };
        let element = |index| NodeData::Expr(ExprId(index));
        let metadata = |index| {
            ImplicitReferenceKind::DecoratorMetadata(MetadataReference::TypeName(TypeNodeId(index)))
        };
        [
            record(element(3), ImplicitReferenceKind::JsxFactory, known::React),
            record(element(7), ImplicitReferenceKind::JsxFactory, known::React),
            record(element(7), ImplicitReferenceKind::JsxFragment, known::React),
            record(element(9), ImplicitReferenceKind::JsxFactory, known::React),
            record(NodeData::Member(MemberId(0)), metadata(1), known::Object),
            record(NodeData::Param(ParamId(0)), metadata(4), known::Object),
        ]
    }

    #[test]
    fn finds_roots_before_decorator_metadata() {
        let references = recorded_references();
        let roots = [
            (ExprId(3), JsxRoot::Factory),
            (ExprId(7), JsxRoot::Factory),
            (ExprId(7), JsxRoot::Fragment),
            (ExprId(9), JsxRoot::Factory),
        ];
        for (index, (expression, root)) in roots.into_iter().enumerate() {
            assert_eq!(
                find_jsx_reference(&references, expression, root),
                references[index]
            );
        }
    }

    #[test]
    #[should_panic(expected = "the binder records the root of every classic element")]
    fn unrecorded_fragment_root_panics() {
        find_jsx_reference(&recorded_references(), ExprId(9), JsxRoot::Fragment);
    }

    #[test]
    fn nested_elements_find_own_roots() {
        let record = |index, kind, binding| ImplicitReference {
            node: NodeData::Expr(ExprId(index)),
            kind,
            name: known::React,
            binding,
        };
        let shadowing = Binding::Symbol(SymbolId(1));
        let outer = Binding::Symbol(SymbolId(0));
        let references = [
            record(1, ImplicitReferenceKind::JsxFactory, shadowing),
            record(2, ImplicitReferenceKind::JsxFactory, outer),
            record(2, ImplicitReferenceKind::JsxFragment, Binding::Free),
            record(3, ImplicitReferenceKind::JsxFactory, outer),
        ];
        let find = |index, root| find_jsx_reference(&references, ExprId(index), root).binding;
        assert_eq!(find(1, JsxRoot::Factory), shadowing);
        assert_eq!(find(2, JsxRoot::Factory), outer);
        assert_eq!(find(2, JsxRoot::Fragment), Binding::Free);
        assert_eq!(find(3, JsxRoot::Factory), outer);
    }
}
