use bun_lint_oxlint::ast_util::{get_member_expr, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `catch` to `then(a, b)` and `then(null, b)`.
pub struct PreferCatch;

const PREFER_CATCH: Message = Message::new("", "Prefer `catch` to `then(a, b)` or `then(null, b)`");

impl Rule for PreferCatch {
    const META: Meta = Meta::oxlint(Plugin::Promise, "prefer-catch", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCatch
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("then") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            // Only a call that is a statement. What is in parentheses, and an optional chain, is not a call for oxlint.
            if let Some(call_expr) = e.as_call()
                && call_expr.args().len() >= 2
                && get_member_expr(call_expr.callee()).and_then(static_property_name).is_some_and(|name| name.is("then"))
                && matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr)
                && !e.is_parenthesized()
                && e.chain() == Chain::No
            {
                cx.report(e, PREFER_CATCH);
            }
        });
    }
}
