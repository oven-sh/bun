use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow the use of `process.exit()`.
pub struct NoProcessExit;

const NO_PROCESS_EXIT: Message = Message::new("noProcessExit", "Don't use process.exit(); throw an error instead.");

impl Rule for NoProcessExit {
    const META: Meta = Meta::plugin(Plugin::Node, "no-process-exit", Kind::Suggestion).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProcessExit
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("process").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if ast_utils::is_process_exit_call(e) {
            cx.report(e, NO_PROCESS_EXIT);
        }
    }
}
