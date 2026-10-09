use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow the use of `process.exit()`.
pub struct NoProcessExit;

const NO_PROCESS_EXIT: Message = Message::new("noProcessExit", "Don't use process.exit(); throw an error instead.");

impl Rule for NoProcessExit {
    const META: Meta = Meta::plugin(Plugin::Node, "no-process-exit", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProcessExit
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("process") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if ast_utils::is_process_exit_call(e) {
                cx.report(e, NO_PROCESS_EXIT);
            }
        });
    }
}
