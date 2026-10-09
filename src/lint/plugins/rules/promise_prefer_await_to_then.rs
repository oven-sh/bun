use bun_lint_oxlint::ast_util::static_property_info;
use crate::oxlint::promise::is_promise_with_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer `await` to `then()`/`catch()`/`finally()` for reading Promise values.
pub struct PreferAwaitToThen {
    strict: bool,
}

const PREFER_AWAIT_TO_THEN: Message = Message::new("", "Prefer await to then()/catch()/finally()");

impl Rule for PreferAwaitToThen {
    const META: Meta = Meta::oxlint(Plugin::Promise, "prefer-await-to-then", Kind::Suggestion);
    /// Whether something is in a `yield` or an `await`.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        PreferAwaitToThen { strict: options.object(0).bool_or("strict", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions_any(&["then", "catch", "finally"]) {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                let Some(call_expr) = e.as_call() else {
                    return;
                };
                if !is_promise_with_context(call_expr).is_some_and(|name| name.is_any(&["then", "catch", "finally"])) {
                    return;
                }
                // Parentheses and the whole of an optional chain are nodes in between for oxlint.
                if matches!(e.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Return)
                    && !e.is_parenthesized()
                    && !e.is_chain_root()
                {
                    return;
                }
                let is_yield_or_await = |_, ancestor: Node<'a>| {
                    matches!(ancestor, Node::Expr(it) if matches!(it.tag(), ExprTag::Yield | ExprTag::Await)).then_some(())
                };
                if !rule.strict && cx.state.find(Node::Expr(e), is_yield_or_await).is_some() {
                    return;
                }
                let callee = call_expr.callee();
                let property = static_property_info(callee).filter(|_| !callee.is_parenthesized());
                cx.report(property.map_or_else(|| e.span(), |it| it.0), PREFER_AWAIT_TO_THEN);
            });
        }
        AncestorMemo::default()
    }
}
