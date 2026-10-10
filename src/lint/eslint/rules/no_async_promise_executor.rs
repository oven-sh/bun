use bun_lint::prelude::*;
use bun_lint::utils::oxlint::is_global_by_name;

/// Disallow using an async function as a Promise executor.
pub struct NoAsyncPromiseExecutor;

const ASYNC: Message = Message::new("async", "Promise executor functions should not be async.");

impl Rule for NoAsyncPromiseExecutor {
    const META: Meta = Meta::eslint("no-async-promise-executor", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAsyncPromiseExecutor
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("Promise") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
        if !executor.as_fn().is_some_and(Func::is_async) || !is_global_by_name(callee) {
            return;
        }
        let start = executor.span().start;
        cx.report(Span::new(start, start + "async".len() as u32), ASYNC);
    }
}
