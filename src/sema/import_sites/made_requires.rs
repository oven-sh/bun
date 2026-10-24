use super::call_sites::{expr_kind, is_free_common_js};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CodeUnit, CommonJsVariable, Decl,
    FnOwner, InitialState, Parent, PatParent, SymbolId, has_mapped_arguments,
};
use crate::fold::Decisions;
use crate::hir::{
    Branches, Call, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, FnKind, IdList, MemberKey,
    NodeData, PatKind, StmtKind,
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
const LONGEST_CHAIN_OF_PARAMETERS: usize = 3;

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

// The parameter that `e` names, where nothing stores to it: its function, and its place among the parameters.
fn find_settled_parameter(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<(FnId, usize)> {
    let Some(ExprKind::Ident(_)) = expr_kind(hir, e) else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(e) else {
        return None;
    };
    let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
        return None;
    };
    let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let is_settled = bound.stores_to(symbol).is_empty()
        && !bound.is_visible_to_eval(symbol)
        && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
        && !hir[id].flags.contains(Flags::REST)
        && hir[id].default.is_none();
    let function = bound.param_fn[id.idx()];
    let index = hir[function].params.iter().position(|it| it == id)?;
    is_settled.then_some((function, index))
}

fn argument_at(hir: &File<'_>, arguments: IdList<ExprId>, index: usize) -> Option<ExprId> {
    let mut passed = hir.ids(arguments).take(index + 1);
    let is_spread = |it| matches!(expr_kind(hir, it), Some(ExprKind::Spread(_)));
    match passed.clone().any(is_spread) {
        true => None,
        false => passed.nth(index),
    }
}

// The call in which a function expression stands, as what is called or as an argument.
fn find_call_around(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<(ExprId, Call)> {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return None;
    };
    let Parent::Expr(above) = bound.parent_of_expr(expression) else {
        return None;
    };
    match expr_kind(hir, above) {
        Some(ExprKind::Call(call)) => Some((expression, hir[call])),
        _ => None,
    }
}

// `(function (load) { .. })(require)`, and what TypeScript writes for "module": "umd": `(function (factory) { .. factory(require, exports) .. })(function (require, exports) { .. })`.
// Another call may pass something else, so a call of the parameter tests what it holds.
fn is_given_require_of_file(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    (function, index): (FnId, usize),
    parameters_left: usize,
) -> bool {
    let Some((expression, call)) = find_call_around(hir, bound, function) else {
        return false;
    };
    let is_require_of_file = |arguments: IdList<ExprId>| {
        argument_at(hir, arguments, index).is_some_and(|argument| {
            follow_to_own_require(hir, bound, decisions, argument, parameters_left)
                == Some(OwnRequire::OfFile)
        })
    };
    if call.callee == expression {
        return is_require_of_file(call.args);
    }
    let Some(ExprKind::Fn(caller)) = expr_kind(hir, hir.skip_type_assertions(call.callee)) else {
        return false;
    };
    let place = hir.ids(call.args).position(|it| it == expression);
    let Some(place) = place.filter(|&place| argument_at(hir, call.args, place).is_some()) else {
        return false;
    };
    let Some(held_by) = hir[caller].params.iter().nth(place).map(|id| hir[id]) else {
        return false;
    };
    let PatKind::Ident(name) = hir[held_by.pat].kind else {
        return false;
    };
    if held_by.flags.contains(Flags::REST) {
        return false;
    }
    let held_by = Binding::Symbol(bound.declared_symbol(Decl::Param(held_by.pat)));
    (0..hir.exprs.len() as u32).map(ExprId).any(|e| {
        let ExprKind::Call(inner) = hir[e].kind else {
            return false;
        };
        let inner = hir[inner];
        matches!(expr_kind(hir, inner.callee), Some(ExprKind::Ident(it)) if it == name)
            && bound.binding(inner.callee) == held_by
            && !decisions.is_some_and(|decisions| decisions.is_dead_expr(e))
            && is_require_of_file(inner.args)
    })
}

// The `require` of the file, or `createRequire(import.meta.url)`, which resolves what it is given as that one does: written on the spot, or held by a binding that nothing stores to, which may start as another such binding. The `require` of the file also where a parameter gets it.
pub fn find_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
) -> Option<OwnRequire> {
    follow_to_own_require(hir, bound, decisions, e, LONGEST_CHAIN_OF_PARAMETERS)
}

fn follow_to_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
    parameters_left: usize,
) -> Option<OwnRequire> {
    let is_parameter_with_require_of_file = |e: ExprId| {
        parameters_left > 0
            && find_settled_parameter(hir, bound, e).is_some_and(|parameter| {
                is_given_require_of_file(hir, bound, decisions, parameter, parameters_left - 1)
            })
    };
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
            if is_made_for_own_file(hir, bound, e) {
                return Some(OwnRequire::Made);
            }
            return is_parameter_with_require_of_file(e).then_some(OwnRequire::OfFile);
        };
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => e = hir.skip_type_assertions(source),
            _ => return is_parameter_with_require_of_file(e).then_some(OwnRequire::OfFile),
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
