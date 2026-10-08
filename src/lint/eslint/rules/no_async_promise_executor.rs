use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::is_global_reference;

/// Disallow using an async function as a Promise executor.
pub struct NoAsyncPromiseExecutor;

const ASYNC: Message = Message::new("async", "Promise executor functions should not be async.");

impl Rule for NoAsyncPromiseExecutor {
    const META: Meta = Meta::eslint("no-async-promise-executor", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAsyncPromiseExecutor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            let callee = call.callee();
            if !callee.is_ident("Promise") {
                return;
            }
            let Some(executor) = call.args().first() else {
                return;
            };
            if !executor.as_fn().is_some_and(Func::is_async) || !is_global_reference(callee) {
                return;
            }
            let start = executor.span().start;
            cx.report(Span::new(start, start + "async".len() as u32), ASYNC);
        });
    }
}
