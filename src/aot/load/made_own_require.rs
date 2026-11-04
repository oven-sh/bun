//! `require = createRequire(__filename)`, the head of the CommonJS loader that NAPI-RS writes for an addon. What it makes resolves as the `require` of the file does, so the
//! file keeps its own: the call stays where it is written, and nothing is stored. Every `require("@scope/addon-linux-x64-gnu")` below is then a call that the build reads.

use bun_sema::atom::known;
use bun_sema::bind::{Binding, BindingInitializer, BindingKind, Bound, CommonJsVariable, Parent};
use bun_sema::hir::{Chain, ExprId, ExprKind, File, StmtId, StmtKind};
use bun_sema::resolve::{TransformRequest, TreeChange};

const OWN_REQUIRE: Binding = Binding::CommonJs(CommonJsVariable::Require);

fn find_only_argument(hir: &File<'_>, e: ExprId) -> Option<(ExprId, ExprId)> {
    let ExprKind::Call(call) = hir[hir.skip_type_assertions(e)].kind else {
        return None;
    };
    let call = hir[call];
    (call.chain == Chain::No && call.args.len() == 1).then(|| {
        let argument = hir.skip_type_assertions(hir.id_at(call.args, 0));
        (hir.skip_type_assertions(call.callee), argument)
    })
}

// Whatever of the two `require` holds by then, it answers with the built-in module.
fn requires_node_module(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    find_only_argument(hir, e).is_some_and(|(callee, name)| {
        matches!(hir[callee].kind, ExprKind::Ident(_))
            && bound.binding(callee) == OWN_REQUIRE
            && matches!(hir[name].kind, ExprKind::String(name) if name == known::node_module || name == known::module)
    })
}

fn is_create_require(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> bool {
    match hir[callee].kind {
        ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } => name == known::createRequire && requires_node_module(hir, bound, obj),
        ExprKind::Ident(_) => {
            let Binding::Symbol(symbol) = bound.binding(callee) else {
                return false;
            };
            bound.binding_kind(symbol) == BindingKind::Const
                && matches!(bound.binding_initializer(hir, symbol), BindingInitializer::PatternProperty { source, path }
                    if path[..] == [known::createRequire] && requires_node_module(hir, bound, source))
        }
        _ => false,
    }
}

fn makes_require_of_own_file(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    find_only_argument(hir, e).is_some_and(|(callee, path)| {
        matches!(hir[path].kind, ExprKind::Ident(_))
            && bound.binding(path) == Binding::CommonJs(CommonJsVariable::Filename)
            && is_create_require(hir, bound, callee)
    })
}

/// The statement and the call, where the statement is nothing but the store.
fn find_store(hir: &File<'_>, bound: &Bound<'_>, target: ExprId) -> Option<(StmtId, ExprId)> {
    let Parent::Expr(assignment) = bound.parent_of_expr(target) else {
        return None;
    };
    let ExprKind::Assign {
        op: None,
        target: stored_into,
        value,
    } = hir[assignment].kind
    else {
        return None;
    };
    let Parent::Stmt(statement) = bound.parent_of_expr(assignment) else {
        return None;
    };
    let is_whole_statement = matches!(hir[statement].kind, StmtKind::Expr(e) if e == assignment);
    (stored_into == target && is_whole_statement && makes_require_of_own_file(hir, bound, value))
        .then_some((statement, value))
}

pub(crate) fn keep_own_require(request: &mut TransformRequest<'_, '_>) -> TreeChange {
    let (hir, bound) = (&*request.hir, request.bound);
    let stores = bound.runtime.unbound_name_stores().iter();
    let mut stores = stores
        .map(|&(target, _)| target)
        .filter(|&target| bound.binding(target) == OWN_REQUIRE)
        .peekable();
    if stores.peek().is_none() || !bound.runtime.eval_scopes().is_empty() {
        return TreeChange::Unchanged;
    }
    // One store of anything else, and `require` is whatever the program makes of it.
    let Some(found) = stores
        .map(|target| find_store(hir, bound, target))
        .collect::<Option<Vec<_>>>()
    else {
        return TreeChange::Unchanged;
    };
    for (statement, call) in found {
        request.hir[statement].kind = StmtKind::Expr(call);
    }
    TreeChange::Changed
}
