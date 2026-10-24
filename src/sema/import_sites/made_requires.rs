use super::call_sites::{expr_kind, is_free_common_js};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CodeUnit, CommonJsVariable, Decl,
    InitialState, SymbolId, has_mapped_arguments,
};
use crate::fold::Decisions;
use crate::hir::{
    Branches, Chain, ExprId, ExprKind, File, Flags, FnBody, FnKind, MemberKey, NodeData, StmtKind,
};

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
        _ => None,
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
        _ => None,
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
        _ => false,
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
        _ => false,
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

fn iife_return_value(hir: &File<'_>, e: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return None;
    };
    let call = hir[call];
    let Some(ExprKind::Fn(function)) = expr_kind(hir, hir.skip_type_assertions(call.callee)) else {
        return None;
    };
    let function = &hir[function];
    let is_plain_function = matches!(function.kind, FnKind::Arrow | FnKind::Expr)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
    if call.chain != Chain::No || !is_plain_function {
        return None;
    }
    match function.body {
        FnBody::Expr(value) => Some(value),
        FnBody::Block(statements) if statements.len() == 1 => {
            match hir[hir.id_at(statements, 0)].kind {
                StmtKind::Return(value) => value.some(),
                _ => None,
            }
        }
        FnBody::Block(_) | FnBody::None => None,
    }
}

fn live_branch(hir: &File<'_>, decisions: &Decisions<'_>, e: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Cond { branches, .. }) = expr_kind(hir, e) else {
        return None;
    };
    let Branches { yes, no } = hir.branches(branches);
    match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
        (false, true) => Some(yes),
        (true, false) => Some(no),
        (false, false) | (true, true) => None,
    }
}

// The expression whose value `e` evaluates to: the live branch of a folded `?:`, or what an IIFE returns.
// esbuild writes `var __require = (x => typeof require !== "undefined" ? require : ..)(function (x) { .. })`.
pub fn find_result_expression(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
) -> Option<ExprId> {
    live_branch(hir, decisions, e).or_else(|| iife_return_value(hir, e))
}

// The `require` of the file, or `createRequire(import.meta.url)`, which resolves what it is given as that one does: written on the spot, or held by a binding that nothing stores to, which may start as another such binding.
pub fn find_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
) -> Option<OwnRequire> {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        if is_free_common_js(hir, bound, e, CommonJsVariable::Require) {
            return Some(OwnRequire::OfFile);
        }
        if let Some(result) =
            decisions.and_then(|decisions| find_result_expression(hir, decisions, e))
        {
            e = hir.skip_type_assertions(result);
            continue;
        }
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            return is_made_for_own_file(hir, bound, e).then_some(OwnRequire::Made);
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            _ => return None,
        }
    }
    None
}

// What `e` stands for: a binding that nothing stores to stands for what it starts as, which may be another such binding.
pub(super) fn follow_settled_bindings(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> ExprId {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        let Some(symbol) = settled_symbol(hir, bound, e) else {
            break;
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            _ => break,
        }
    }
    e
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
            _ => return false,
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
            _ => return false,
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
    find_own_require(hir, bound, None, callee) == Some(OwnRequire::Made)
}
