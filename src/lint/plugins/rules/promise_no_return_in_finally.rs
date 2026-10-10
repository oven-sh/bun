use crate::oxlint::promise::is_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow return statements in a `finally()` callback of a promise.
pub struct NoReturnInFinally;

const NO_RETURN_IN_FINALLY: Message = Message::new("", "Don't return in a finally callback");

impl Rule for NoReturnInFinally {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-return-in-finally", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoReturnInFinally
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("finally").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call().filter(|it| is_promise(*it).is_some_and(|prop_name| prop_name.is("finally"))) else {
            return;
        };
        let callbacks = call_expr.args().iter().filter(|it| !it.is_parenthesized()).filter_map(Expr::as_fn);
        for statements in callbacks.filter_map(Func::body_statements) {
            // The first, of those that are directly in the body.
            if let Some(return_stmt) = statements.iter().find(|it| it.tag() == StmtTag::Return) {
                cx.report(return_stmt, NO_RETURN_IN_FINALLY);
            }
        }
    }
}
