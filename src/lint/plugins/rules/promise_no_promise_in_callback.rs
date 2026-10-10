use bun_lint_oxlint::ast_util::static_property_name;
use crate::oxlint::promise::is_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows the use of Promises within error-first callback functions.
pub struct NoPromiseInCallback {
    exempt_declarations: bool,
}

const NO_PROMISE_IN_CALLBACK: Message = Message::new("", "Avoid using promises inside of callbacks.");

impl Rule for NoPromiseInCallback {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-promise-in-callback", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Whether something is in an error-first callback.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        NoPromiseInCallback { exempt_declarations: options.object(0).bool_or("exemptDeclarations", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions_any(&["err", "error"]) && file.mentions_any(&["then", "catch", "finally", "Promise"]))
            .then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call().filter(|it| is_promise(*it).is_some()) else {
            return;
        };
        // A function that returns a promise is most likely part of a chain of promises. Parentheses and the whole of an
        // optional chain are nodes in between for oxlint.
        if matches!(e.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Return) && !e.is_parenthesized() && !e.is_chain_root() {
            return;
        }
        let is_callback = |_, ancestor: Node<'a>| match ancestor {
            Node::Func(func) if is_callback_function(func, self.exempt_declarations) => Some(()),
            _ => None,
        };
        if cx.state.find(Node::Expr(e), is_callback).is_some() {
            cx.report(call_expr.callee().outer_span(), NO_PROMISE_IN_CALLBACK);
        }
    }
}

fn is_callback_function(func: Func, exempt_declarations: bool) -> bool {
    is_error_first_callback(func)
        && !(exempt_declarations && func.kind() == FnKind::Decl && func.has_body())
        && !is_within_promise_handler(func)
}

fn is_error_first_callback(func: Func) -> bool {
    let first_parameter = func.params().first().filter(|it| !it.is_rest());
    first_parameter.and_then(|it| it.pat().as_ident()).is_some_and(|name| name.is_any(&["err", "error"]))
}

/// It is an argument of `then` or `catch`.
fn is_within_promise_handler(func: Func) -> bool {
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    let Some(call_expr) = e.parent().as_expr().and_then(Expr::as_call).filter(|_| !e.is_parenthesized()) else {
        return false;
    };
    let callee = call_expr.callee();
    let callee_name = callee.as_ident().or_else(|| static_property_name(callee));
    callee != e && !callee.is_parenthesized() && callee_name.is_some_and(|name| name.is_any(&["then", "catch"]))
}
