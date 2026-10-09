use bun_lint_oxlint::ast_util::{get_inner_expression, is_global_reference};
use crate::oxlint::promise::is_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prevents unnecessary wrapping of return values in promises with `Promise.resolve` or `Promise.reject`.
pub struct NoReturnWrap {
    allow_reject: bool,
}

const RESOLVE: Message = Message::new("", "Avoid wrapping return values in Promise.resolve");
const REJECT: Message = Message::new("", "Expected throw instead of Promise.reject");

#[derive(Default)]
pub struct State<'a> {
    /// The function that something is in.
    functions: AncestorMemo<'a, Func<'a>>,
    /// Whether something is in a call of a method of a promise.
    promises: AncestorMemo<'a, ()>,
}

impl Rule for NoReturnWrap {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-return-wrap", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoReturnWrap { allow_reject: options.object(0).bool_or("allowReject", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions("Promise") && (file.mentions("resolve") || !self.allow_reject && file.mentions("reject")) {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                let Some(message) = e.as_call().and_then(|it| rule.check_for_resolve_reject(it)) else {
                    return;
                };
                // What is in parentheses, and an optional chain, is not a call for oxlint.
                if e.is_parenthesized() || e.chain() != Chain::No {
                    return;
                }
                // It is what a function expression or an arrow function returns ..
                let func = match e.parent() {
                    Node::Func(func) => Some(func),
                    Node::Stmt(parent) if parent.tag() == StmtTag::Return => {
                        cx.state.functions.find(Node::Stmt(parent), |_, ancestor| ancestor.as_func())
                    }
                    _ => None,
                };
                let Some(Node::Expr(callback)) = func.filter(|it| matches!(it.kind(), FnKind::Expr | FnKind::Arrow)).map(Func::owner)
                else {
                    return;
                };
                // .. that is an argument of a call of a method of a promise, or of a call in one.
                let Some(call_expr) = call_with_callback(callback) else {
                    return;
                };
                let is_promise_call = |it: Expr<'a>| it.as_call().is_some_and(|it| is_promise(it).is_some());
                let is_inside_promise_cb = |_, ancestor: Node<'a>| ancestor.as_expr().filter(|it| is_promise_call(*it)).map(|_| ());
                if is_promise_call(call_expr) || cx.state.promises.find(Node::Expr(call_expr), is_inside_promise_cb).is_some() {
                    cx.report(e, message);
                }
            });
        }
        State::default()
    }
}

impl NoReturnWrap {
    /// The message, if the global `Promise.resolve` or `Promise.reject` is called.
    fn check_for_resolve_reject(&self, call_expr: Call) -> Option<Message> {
        let callee = call_expr.callee();
        let ExprKind::Dot { obj, name, .. } = callee.kind() else {
            return None;
        };
        let message = match name.bytes() {
            b"resolve" => RESOLVE,
            b"reject" if !self.allow_reject => REJECT,
            _ => return None,
        };
        let obj = get_inner_expression(obj);
        (obj.is_ident("Promise") && !callee.is_parenthesized() && is_global_reference(obj)).then_some(message)
    }
}

/// The call that `e` is an argument of.
fn call_with_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    e.parent().as_expr().filter(|it| it.as_call().is_some_and(|call| call.callee() != e))
}

/// What is around `e` and the `as T`, `!` .. after it.
fn outer_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    let mut parent = e.parent().as_expr()?;
    while matches!(parent.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation) {
        parent = parent.parent().as_expr()?;
    }
    Some(parent)
}

/// The `object.name(..)` of `object`, and whether it is `object.bind(this)`.
fn method_call_on(object: Expr<'_>) -> Option<(Expr<'_>, bool)> {
    let member = outer_expression(object).filter(|it| it.tag() == ExprTag::Dot && !it.is_private_member())?;
    let call_expr = outer_expression(member)?;
    let call = call_expr.as_call().filter(|it| get_inner_expression(it.callee()) == member)?;
    let is_this_arg = call.args().first().is_some_and(|it| it.tag() == ExprTag::This && !it.is_parenthesized());
    Some((call_expr, is_this_arg && member.member_name().is_some_and(|it| it.name().is("bind"))))
}

/// The call that has `callback`, `callback.bind(this)` or `callback.a().bind(this)` as an argument.
fn call_with_callback(callback: Expr<'_>) -> Option<Expr<'_>> {
    if let Some(call_expr) = call_with_argument(callback) {
        return Some(call_expr);
    }
    let is_call = |it: Expr| it.chain() == Chain::No;
    let (first, is_bound) = method_call_on(callback).filter(|it| is_call(it.0))?;
    if is_bound && let Some(call_expr) = call_with_argument(first) {
        return Some(call_expr);
    }
    // There only parentheses can be around the function.
    if !callback.parent().as_expr().is_some_and(|it| it.tag() == ExprTag::Dot) {
        return None;
    }
    let (second, is_bound) = method_call_on(first).filter(|it| is_call(it.0))?;
    call_with_argument(second).filter(|_| is_bound)
}
