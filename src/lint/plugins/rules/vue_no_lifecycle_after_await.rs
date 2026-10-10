use crate::oxlint::vue::{AfterAwait, call_of_callee, imported_from_vue, is_vue_file, is_vue_setup, setup_functions};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow asynchronously registered lifecycle hooks.
pub struct NoLifecycleAfterAwait;

const NO_LIFECYCLE_AFTER_AWAIT: Message = Message::new("", "Lifecycle hook `{{hook_name}}` is called after `await` in `setup()`.");

const LIFECYCLE_HOOKS: [&str; 11] = [
    "onBeforeMount", "onBeforeUnmount", "onBeforeUpdate", "onErrorCaptured", "onMounted", "onRenderTracked", "onRenderTriggered",
    "onUnmounted", "onUpdated", "onActivated", "onDeactivated",
];

impl Rule for NoLifecycleAfterAwait {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-lifecycle-after-await", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLifecycleAfterAwait
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
        for (symbol, hook_name) in imported_from_vue(cx.file(), &LIFECYCLE_HOOKS) {
            for call in symbol.references().filter_map(|it| it.expr()).filter_map(call_of_callee) {
                if call.as_call().is_some_and(|it| it.args().len() < 2)
                    && after_await.function_of(Node::Expr(call)).is_some_and(|it| setup_functions.contains(&it))
                {
                    cx.report(call, NO_LIFECYCLE_AFTER_AWAIT).data("hook_name", hook_name);
                }
            }
        }
    }
}
