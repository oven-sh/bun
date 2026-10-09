use bun_lint_oxlint::ast_util::iter_outer_expressions;
use crate::oxlint::vue::{AfterAwait, call_of_callee, imported_from_vue, is_vue_file, is_vue_setup, setup_functions};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow asynchronously-registered `watch`.
pub struct NoWatchAfterAwait;

const NO_WATCH_AFTER_AWAIT: Message = Message::new("", "`{{name}}` is forbidden after an `await` expression.");

impl Rule for NoWatchAfterAwait {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-watch-after-await", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoWatchAfterAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_vue_file(file) || is_vue_setup(file) || !file.mentions("setup") || !file.has_exprs([ExprTag::Await]) {
            return;
        }
        on.finish(|_, cx| {
            let setup_functions = setup_functions(cx.file());
            if setup_functions.is_empty() {
                return;
            }
            let mut after_await = AfterAwait::new(cx.file());
            for (symbol, name) in imported_from_vue(cx.file(), &["watch", "watchEffect"]) {
                for call in symbol.references().filter_map(|it| it.expr()).filter_map(call_of_callee) {
                    // Only a call that is a statement: what `watch()` returns can stop it.
                    if let Some(Node::Stmt(stmt)) = iter_outer_expressions(call).next()
                        && stmt.tag() == StmtTag::Expr
                        && after_await.function_of(Node::Stmt(stmt)).is_some_and(|it| setup_functions.contains(&it))
                    {
                        cx.report(call, NO_WATCH_AFTER_AWAIT).data("name", name);
                    }
                }
            }
        });
    }
}
