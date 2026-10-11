use bun_lint_oxlint::ast_util::iter_outer_expressions;
use crate::oxlint::vue::{AfterAwait, call_of_callee, imported_from_vue, is_vue_file, is_vue_setup, setup_functions};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow asynchronously registered lifecycle hooks. `WATCH`: asynchronously-registered `watch`.
pub struct NoCallAfterAwait<const WATCH: bool = false>;

const NO_LIFECYCLE_AFTER_AWAIT: Message = Message::new("", "Lifecycle hook `{{hook_name}}` is called after `await` in `setup()`.");
const NO_WATCH_AFTER_AWAIT: Message = Message::new("", "`{{name}}` is forbidden after an `await` expression.");

const LIFECYCLE_HOOKS: [&str; 11] = [
    "onBeforeMount", "onBeforeUnmount", "onBeforeUpdate", "onErrorCaptured", "onMounted", "onRenderTracked", "onRenderTriggered",
    "onUnmounted", "onUpdated", "onActivated", "onDeactivated",
];

impl<const WATCH: bool> Rule for NoCallAfterAwait<WATCH> {
    const META: Meta =
        Meta::oxlint(Plugin::Vue, if WATCH { "no-watch-after-await" } else { "no-lifecycle-after-await" }, Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || is_vue_setup(file) || !file.mentions("setup") || !file.has_exprs([ExprTag::Await]) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let setup_functions = setup_functions(cx.file());
        if setup_functions.is_empty() {
            return;
        }
        let mut after_await = AfterAwait::new(cx.file());
        let names: &[&str] = if WATCH { &["watch", "watchEffect"] } else { &LIFECYCLE_HOOKS };
        for (symbol, name) in imported_from_vue(cx.file(), names) {
            for call in symbol.references().filter_map(|it| it.expr()).filter_map(call_of_callee) {
                let node = match WATCH {
                    // Only a call that is a statement: what `watch()` returns can stop it.
                    true => iter_outer_expressions(call).next().filter(|it| matches!(it, Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr)),
                    false => call.as_call().filter(|it| it.args().len() < 2).map(|_| Node::Expr(call)),
                };
                if node.and_then(|it| after_await.function_of(it)).is_some_and(|it| setup_functions.contains(&it)) {
                    match WATCH {
                        true => cx.report(call, NO_WATCH_AFTER_AWAIT).data("name", name),
                        false => cx.report(call, NO_LIFECYCLE_AFTER_AWAIT).data("hook_name", name),
                    };
                }
            }
        }
    }
}
