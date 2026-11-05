//! `require = createRequire(__filename)`, the head of the CommonJS loader that NAPI-RS writes for an addon. What it makes resolves as the `require` of the file does, so the
//! file keeps its own: the call stays where it is written, and nothing is stored. Every `require("@scope/addon-linux-x64-gnu")` below is then a call that the build reads.

#[cfg(test)]
mod tests_of_reads;

use bun_sema::atom::known;
use bun_sema::bind::{Binding, BindingInitializer, BindingKind, Bound, CommonJsVariable, Parent};
use bun_sema::hir::{Chain, ExprId, ExprKind, File, StmtId, StmtKind};
use bun_sema::import_sites::may_be_modified;
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

/// `require("a")`, `require.resolve("a")`, `require.main`: what the two functions answer alike. Whoever gets hold of the function, or of its `resolve`, can tell them apart.
fn is_asked_what_both_answer(hir: &File<'_>, bound: &Bound<'_>, function: ExprId) -> bool {
    let user_of = |e: ExprId| match bound.parent_of_expr(e) {
        Parent::Expr(user) => Some((user, hir[user].kind)),
        _ => None,
    };
    let is_called =
        |e: ExprId| matches!(user_of(e), Some((_, ExprKind::Call(call))) if hir[call].callee == e);
    match user_of(function) {
        Some((_, ExprKind::Call(_))) => is_called(function),
        // `find_store` has looked at it.
        Some((_, ExprKind::Assign { target, .. })) => target == function,
        Some((member, ExprKind::Dot { obj, name, .. })) if obj == function => {
            let is_read = bound.get_assignment_target(hir, member).is_none()
                && !matches!(user_of(member), Some((_, ExprKind::Unary { .. })));
            (name == known::resolve && is_called(member)) || (name == known::main && is_read)
        }
        _ => false,
    }
}

pub(crate) fn keep_own_require(request: &mut TransformRequest<'_, '_>) -> TreeChange {
    let (hir, bound) = (&*request.hir, request.bound);
    let stores = bound.runtime.unbound_name_stores().iter();
    let mut stores = stores
        .map(|&(target, _)| target)
        .filter(|&target| bound.binding(target) == OWN_REQUIRE)
        .peekable();
    // `__filename` names the file for as long as nothing has stored to it.
    if stores.peek().is_none() || may_be_modified(hir, bound, CommonJsVariable::Filename) {
        return TreeChange::Unchanged;
    }
    // One store of anything else, and `require` is whatever the program makes of it.
    let Some(found) = stores
        .map(|target| find_store(hir, bound, target))
        .collect::<Option<Vec<_>>>()
    else {
        return TreeChange::Unchanged;
    };
    // `arguments[1]` is the function too.
    let mut names = bound.ident_bindings().iter();
    if bound.file_uses_arguments()
        || names.any(|&(name, binding)| {
            binding == OWN_REQUIRE && !is_asked_what_both_answer(hir, bound, name)
        })
    {
        return TreeChange::Unchanged;
    }
    for (statement, call) in found {
        request.hir[statement].kind = StmtKind::Expr(call);
    }
    TreeChange::Changed
}

#[cfg(test)]
mod tests {
    use bun_sema::hir::{ExprId, ExprKind, StmtKind};

    use crate::compile::testing::{default_settings, with_loaded_build};
    use crate::load::ProjectId;

    fn keeps_store_to_require(text: &str) -> bool {
        let files = [("main.cjs", text), ("which.cjs", "module.exports = 1;")];
        with_loaded_build(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let file = files.by_path.get(&b"/project/main.cjs"[..]);
            let hir = files.hir(file.expect("the file is in the program"));
            let is_require = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(name) if files.atoms.bytes(name) == b"require");
            hir.ids(hir.body)
                .any(|statement| match hir[statement].kind {
                    StmtKind::Expr(e) => {
                        matches!(hir[e].kind, ExprKind::Assign { target, .. } if is_require(target))
                    }
                    _ => false,
                })
        })
    }

    #[test]
    fn the_store_goes_only_where_the_file_still_has_its_name() {
        let head = "const { createRequire } = require('node:module');";
        let tail = "require = createRequire(__filename); module.exports = require('./which.cjs');";
        let rows = [
            ("", false),
            ("__dirname = '/elsewhere';", false),
            (
                "function f() { arguments[3] = '/elsewhere/a.cjs'; } f(1, 2, 3, 4);",
                false,
            ),
            ("__filename = '/elsewhere/a.cjs';", true),
            (
                "function move() { __filename = '/elsewhere/a.cjs'; } move();",
                true,
            ),
            ("[__filename] = ['/elsewhere/a.cjs'];", true),
            (
                "({ path: __filename } = { path: '/elsewhere/a.cjs' });",
                true,
            ),
            ("__filename += '.cjs';", true),
            ("for (__filename of ['/elsewhere/a.cjs']);", true),
            ("arguments[3] = '/elsewhere/a.cjs';", true),
            ("eval('__filename = 1');", true),
        ];
        for (before, expected) in rows {
            let text = format!("{head} {before} {tail}");
            assert_eq!(keeps_store_to_require(&text), expected, "{text}");
        }
    }
}
