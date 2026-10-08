use bun_lint::prelude::*;

/// Disallow the use of `process.exit()`.
pub struct NoProcessExit;

const NO_PROCESS_EXIT: Message = Message::new(
    "noProcessExit",
    "Don't use process.exit(); throw an error instead.",
);

impl Rule for NoProcessExit {
    const META: Meta = Meta::eslint("no-process-exit", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProcessExit
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], |_, e, cx| {
            let ExprKind::Call(call) = e.kind() else {
                return;
            };
            let callee = call.callee();
            // `[property.name = 'exit']` also holds for `process[exit]` and `process.#exit`.
            let obj = match callee.kind() {
                ExprKind::Dot { obj, name, .. } if name.name().is_any(&["exit", "#exit"]) => obj,
                ExprKind::Index { obj, index, .. } if index.is_ident("exit") => obj,
                _ => return,
            };
            // In `(process?.exit)()` a `ChainExpression` is the callee.
            if obj.is_ident("process") && !callee.is_chain_root() {
                cx.report(e, NO_PROCESS_EXIT);
            }
        });
    }
}
