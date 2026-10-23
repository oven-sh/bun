use super::call_sites::{expr_kind, is_free_common_js};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CodeUnit, CommonJsVariable, Decl,
    InitialState, SymbolId, has_mapped_arguments,
};
use crate::hir::{ExprId, ExprKind, File, Flags, MemberKey, NodeData};

fn is_node_module(specifier: Atom) -> bool {
    specifier == known::module || specifier == known::node_module
}

fn settled_symbol(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<SymbolId> {
    let Some(ExprKind::Ident(_)) = expr_kind(hir, e) else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(e) else {
        return None;
    };
    if bound.dynamic_lookup_scope(NodeData::Expr(e)).is_some() {
        return None;
    }
    match bound.binding_stability(symbol) {
        BindingStability::Stable | BindingStability::Linked => Some(symbol),
        BindingStability::NoBinding
        | BindingStability::Stored
        | BindingStability::NotInitializedOnce
        | BindingStability::VisibleToEval
        | BindingStability::MappedArgument
        | BindingStability::ContainerMember => None,
    }
}

// What the import that declares `symbol` takes from `node:module`: `None` is the module's object.
fn import_from_node_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<Option<Atom>> {
    let declarations = bound.symbol(symbol).decls.iter();
    let mut imports = declarations.filter_map(|&declaration| match declaration {
        Decl::ImportDefault(import) | Decl::ImportNamespace(import) => {
            (!hir[import].type_only).then_some((hir[import].spec, None))
        }
        Decl::ImportSpec(spec) => {
            let spec = &hir[spec];
            let import = &hir[spec.import];
            let export = (spec.imported != known::default).then_some(spec.imported);
            (!spec.type_only && !import.type_only).then_some((import.spec, export))
        }
        Decl::ImportEquals(import) => {
            let import = &hir[import];
            (!import.flags.contains(Flags::TYPE_ONLY)).then_some((import.target.spec(), None))
        }
        Decl::Var(_)
        | Decl::Param(_)
        | Decl::Fn(_)
        | Decl::Class(_)
        | Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::Enum(_)
        | Decl::EnumMember(_)
        | Decl::Module(_)
        | Decl::TypeParam(_)
        | Decl::ExportSpec(_)
        | Decl::ExportStarAs(_)
        | Decl::ExportExpr(_)
        | Decl::UmdGlobal(_)
        | Decl::File
        | Decl::Require(_)
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_)
        | Decl::TypeLiteral(_) => None,
    });
    let (specifier, export) = imports.next()?;
    is_node_module(specifier).then_some(export)
}

fn is_import_meta_require(hir: &File<'_>, e: ExprId) -> bool {
    matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if name == known::require
            && matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::ImportMeta)))
}

fn is_request_of_node_module(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return false;
    };
    let callee = hir.skip_type_assertions(hir[call].callee);
    let is_import_meta_require = is_import_meta_require(hir, callee);
    let is_require = is_free_common_js(hir, bound, callee, CommonJsVariable::Require);
    let specifier = hir
        .ids(hir[call].args)
        .next()
        .and_then(|argument| expr_kind(hir, argument));
    (is_require || is_import_meta_require)
        && matches!(specifier, Some(ExprKind::String(text)) if is_node_module(text))
}

fn is_object_of_node_module(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    let Some(symbol) = settled_symbol(hir, bound, e) else {
        return is_request_of_node_module(hir, bound, e);
    };
    match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Import => import_from_node_module(hir, bound, symbol) == Some(None),
        BindingInitializer::Expression(source) => {
            is_request_of_node_module(hir, bound, hir.skip_type_assertions(source))
        }
        BindingInitializer::PatternProperty { .. }
        | BindingInitializer::Class(_)
        | BindingInitializer::Function(_)
        | BindingInitializer::Namespace(_)
        | BindingInitializer::Enum(_)
        | BindingInitializer::EntityName(_)
        | BindingInitializer::Opaque => false,
    }
}

fn is_create_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    if let Some((object, key)) = hir.member_key(e) {
        return matches!(key, MemberKey::Name(name) if name == known::createRequire)
            && is_object_of_node_module(hir, bound, object);
    }
    let Some(symbol) = settled_symbol(hir, bound, e) else {
        return false;
    };
    match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Import => {
            import_from_node_module(hir, bound, symbol) == Some(Some(known::createRequire))
        }
        BindingInitializer::PatternProperty { source, path } => {
            path[..] == [known::createRequire] && is_object_of_node_module(hir, bound, source)
        }
        BindingInitializer::Expression(_)
        | BindingInitializer::Class(_)
        | BindingInitializer::Function(_)
        | BindingInitializer::Namespace(_)
        | BindingInitializer::Enum(_)
        | BindingInitializer::EntityName(_)
        | BindingInitializer::Opaque => false,
    }
}

fn filename_may_be_modified(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    let filename = Binding::CommonJs(CommonJsVariable::Filename);
    let mut stores = bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| bound.binding(target) == filename)
        || !bound.runtime.eval_scopes().is_empty()
        || bound.file_uses_arguments() && has_mapped_arguments(hir, CodeUnit::File)
}

fn names_own_file(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    if is_free_common_js(hir, bound, e, CommonJsVariable::Filename) {
        return !filename_may_be_modified(hir, bound);
    }
    let is_import_meta_member = matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if (name == known::url || name == known::meta_filename || name == known::path)
            && matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::ImportMeta)));
    is_import_meta_member && !bound.import_meta_may_be_modified()
}

fn is_made_for_own_file(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let Some(ExprKind::Call(call)) = expr_kind(hir, hir.skip_type_assertions(e)) else {
        return false;
    };
    let mut arguments = hir.ids(hir[call].args);
    arguments
        .next()
        .is_some_and(|base| names_own_file(hir, bound, base))
        && is_create_require(hir, bound, hir[call].callee)
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OwnRequire {
    OfFile,
    Made,
}

const LONGEST_CHAIN_OF_BINDINGS: usize = 8;

// The `require` of the file, or `createRequire(import.meta.url)`, which resolves what it is given as that one does: written on the spot, or held by a binding that nothing stores to, which may start as another such binding.
pub fn find_own_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<OwnRequire> {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        if is_free_common_js(hir, bound, e, CommonJsVariable::Require) {
            return Some(OwnRequire::OfFile);
        }
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            return is_made_for_own_file(hir, bound, e).then_some(OwnRequire::Made);
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            BindingInitializer::PatternProperty { .. }
            | BindingInitializer::Import
            | BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Opaque => return None,
        }
    }
    None
}

// `import.meta.require` held by a binding that nothing stores to, which may start as another such binding: `var __require = import.meta.require;` stands at the top of what `bun build --target=bun` writes.
pub fn holds_import_meta_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            return false;
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            BindingInitializer::PatternProperty { .. }
            | BindingInitializer::Import
            | BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Opaque => return false,
        }
        if is_import_meta_require(hir, e) {
            return true;
        }
    }
    false
}

// What `createRequire` makes, for whichever file: written on the spot, or held by a binding that nothing stores to.
pub fn is_made_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            return matches!(expr_kind(hir, e), Some(ExprKind::Call(call)) if is_create_require(hir, bound, hir[call].callee));
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            BindingInitializer::PatternProperty { .. }
            | BindingInitializer::Import
            | BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Opaque => return false,
        }
    }
    false
}

// Whether one of the bindings that lead from `e` to what is written on the spot is a `var`, which holds `undefined` above its statement.
pub fn may_still_be_undefined(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            return false;
        };
        if bound.initial_state(symbol) == InitialState::Undefined {
            return true;
        }
        let BindingInitializer::Expression(source) = bound.binding_initializer(hir, symbol) else {
            return false;
        };
        e = hir.skip_type_assertions(source);
    }
    false
}

pub fn is_require_made_for_own_file(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> bool {
    find_own_require(hir, bound, callee) == Some(OwnRequire::Made)
}
