use std::cmp::Ordering;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ImplicitReference, ImplicitReferenceKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, NodeData, is_intrinsic_jsx_name};
use bun_sema::import_sites::{
    JsxCallee, JsxImport, find_key_attribute, has_static_children, is_ignored_key, jsx_callee,
    jsx_children,
};
use bun_sema::resolve::JsxRuntime;
use smallvec::{SmallVec, smallvec};

use super::Element;
use crate::diagnostic_codes::Code;
use crate::ir::ValueId;
use crate::lower::call::{self, Arguments, Callee};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, module};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum JsxRoot {
    Factory,
    Fragment,
}

fn find_jsx_reference(
    references: &[ImplicitReference],
    expression: ExprId,
    root: JsxRoot,
) -> ImplicitReference {
    let found = references.binary_search_by(|reference| {
        let recorded_root = match reference.kind {
            ImplicitReferenceKind::JsxFactory => JsxRoot::Factory,
            ImplicitReferenceKind::JsxFragment => JsxRoot::Fragment,
            ImplicitReferenceKind::DecoratorMetadata(_) => return Ordering::Greater,
        };
        let NodeData::Expr(element) = reference.node else {
            unreachable!("the binder records a JSX root at its element");
        };
        (element, recorded_root).cmp(&(expression, root))
    });
    let index = found.expect("the binder records the root of every classic element");
    references[index]
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_intrinsic_tag_name(&self, tag: ExprId) -> Option<Atom> {
        match self.hir[tag].kind {
            ExprKind::String(name) => Some(name),
            ExprKind::This => Some(known::this),
            ExprKind::Ident(name) => {
                is_intrinsic_jsx_name(self.queries.atom_bytes(name)).then_some(name)
            }
            _ => None,
        }
    }

    fn report_jsx_key_warnings(&mut self, element: Element, target: JsxCallee) {
        let hir = self.hir;
        for attribute in hir[element.jsx].attrs.iter() {
            if is_ignored_key(hir, attribute) {
                let span = self.span_of(NodeData::Prop(attribute));
                self.diagnostics.report(Code::JsxKeyIgnored, span, &[]);
            }
        }
        if target == JsxCallee::Import(JsxImport::CreateElement) {
            let span = self.span_of(NodeData::Expr(element.expression));
            self.diagnostics.report(Code::JsxKeyAfterSpread, span, &[]);
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The element has no spread attribute.
    pub(crate) fn lower_element_parts_for_effect(&mut self, expression: ExprId) {
        let hir = self.file.hir;
        let ExprKind::Jsx(jsx) = hir[expression].kind else {
            unreachable!("lower_element_parts_for_effect takes a Jsx expression");
        };
        let tag = hir[jsx].tag.some();
        let tag = tag.filter(|&tag| self.file.find_intrinsic_tag_name(tag).is_none());
        let values = hir[jsx].attrs.iter().filter_map(|it| hir[it].value.some());
        let parts = tag.into_iter().chain(values);
        let parts: SmallVec<[ExprId; 8]> = parts.chain(hir.ids(hir[jsx].children)).collect();
        for part in parts {
            self.lower_expression_for_effect(part);
        }
    }

    pub(crate) fn lower_jsx(&mut self, expression: ExprId) -> ValueId {
        let hir = self.file.hir;
        let ExprKind::Jsx(jsx) = hir[expression].kind else {
            debug_assert!(false, "lower_jsx takes a Jsx expression");
            return self.builder.undefined();
        };
        let element = Element {
            expression,
            jsx,
            position: hir[expression].pos,
            key: find_key_attribute(hir, jsx).key,
        };
        let target = jsx_callee(hir, self.file.compiled.jsx_mode, jsx);
        debug_assert!(
            target != JsxCallee::Import(JsxImport::Fragment),
            "Fragment is a tag, never a callee"
        );
        self.file.report_jsx_key_warnings(element, target);
        self.set_position(element.position);
        let callee = match target {
            JsxCallee::Import(import) => self.get_jsx_import(import),
            JsxCallee::Factory => {
                let settings = self.file.compiled.jsx;
                self.lower_jsx_member_path(element, JsxRoot::Factory, &settings.factory)
            }
        };
        let tag = self.lower_jsx_tag(element);
        let arguments = match target {
            JsxCallee::Factory | JsxCallee::Import(JsxImport::CreateElement) => {
                self.lower_create_element_arguments(element, tag)
            }
            JsxCallee::Import(JsxImport::Jsx | JsxImport::Jsxs | JsxImport::Fragment) => {
                self.lower_jsx_runtime_arguments(element, tag, false)
            }
            JsxCallee::Import(JsxImport::JsxDev) => {
                self.lower_jsx_runtime_arguments(element, tag, true)
            }
        };
        self.set_position(element.position);
        call::emit_call_of(self, callee, arguments)
    }

    fn get_jsx_import(&mut self, import: JsxImport) -> Callee {
        let binding = self.file.inputs.modules.jsx_binding(self.file.file, import);
        let name = self.file.intern_bytes(import.export_name());
        Callee {
            function: module::emit_import_binding(self, binding, name),
            this: None,
            key: None,
            name: Some(name),
        }
    }

    fn lower_jsx_member_path(
        &mut self,
        element: Element,
        root: JsxRoot,
        path: &[Vec<u8>],
    ) -> Callee {
        let references = self.file.bound.runtime.implicit_references();
        let reference = find_jsx_reference(references, element.expression, root);
        let root_name = self
            .file
            .intern_binding_name(reference.binding, reference.name);
        let mut callee = Callee {
            function: self.get_binding(reference.binding, reference.name),
            this: None,
            key: None,
            name: Some(root_name),
        };
        for member_name in path.iter().skip(1) {
            let text = self.file.intern_bytes(member_name);
            let key = self.file.text_key(text);
            let receiver = callee.function;
            callee = Callee {
                function: self.emit_get(receiver, PropertyName::Constant(key)),
                this: Some(receiver),
                key: Some(key),
                name: Some(text),
            };
        }
        callee
    }

    fn lower_jsx_tag(&mut self, element: Element) -> ValueId {
        let hir = self.file.hir;
        let Some(tag) = hir[element.jsx].tag.some() else {
            let settings = self.file.compiled.jsx;
            let fragment = match settings.runtime {
                JsxRuntime::Automatic => self.get_jsx_import(JsxImport::Fragment),
                JsxRuntime::Classic => {
                    self.lower_jsx_member_path(element, JsxRoot::Fragment, &settings.fragment)
                }
            };
            return fragment.function;
        };
        match self.file.find_intrinsic_tag_name(tag) {
            Some(name) => {
                self.set_position(hir[tag].pos);
                self.emit_constant(Constant::String(name))
            }
            None => self.lower_expression(tag),
        }
    }

    fn lower_jsx_runtime_arguments(
        &mut self,
        element: Element,
        tag: ValueId,
        is_development: bool,
    ) -> Arguments {
        let props = self.lower_runtime_props(element);
        let key = element.key.map(|key| self.lower_attribute_value(key));
        self.set_position(element.position);
        let mut arguments: SmallVec<[ValueId; 4]> = smallvec![tag, props];
        if is_development {
            let is_static = has_static_children(self.file.hir, element.jsx);
            arguments.push(key.unwrap_or_else(|| self.builder.undefined()));
            arguments.push(self.builder.boolean(is_static));
            arguments.push(self.builder.undefined());
            arguments.push(self.get_this());
        } else {
            arguments.extend(key);
        }
        Arguments::Values(arguments)
    }

    fn lower_create_element_arguments(&mut self, element: Element, tag: ValueId) -> Arguments {
        let hir = self.file.hir;
        let props = self.lower_create_element_props(element);
        let children: SmallVec<[ExprId; 8]> = jsx_children(hir, element.jsx).collect();
        let mut kinds = children.iter().map(|&child| hir[child].kind);
        if kinds.any(|kind| matches!(kind, ExprKind::Spread(_))) {
            let list = self.lower_argument_list(&[tag, props], &children, element.position);
            return Arguments::List(list);
        }
        let mut arguments: SmallVec<[ValueId; 4]> = smallvec![tag, props];
        arguments.extend(children.iter().map(|&child| self.lower_expression(child)));
        Arguments::Values(arguments)
    }
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
