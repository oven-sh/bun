use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows calling a callback function (`cb()`) inside a `Promise.prototype.then()` or `Promise.prototype.catch()`.
pub struct NoCallbackInPromise {
    callbacks: Vec<&'static str>,
    timeouts_err: bool,
}

const NO_CALLBACK_IN_PROMISE: Message = Message::new("", "Avoid calling back inside of a promise");

const TIMEOUT_WHITELIST: [&str; 4] = ["setImmediate", "setTimeout", "requestAnimationFrame", "nextTick"];

impl Rule for NoCallbackInPromise {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-callback-in-promise", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Whether something is in a callback of `then` or `catch`.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        let (exceptions, timeouts_err) = options.get(0).and_then(config).unwrap_or_default();
        let callbacks = ["callback", "cb", "done", "next"].into_iter().filter(|it| !exceptions.contains(it)).collect();
        NoCallbackInPromise { callbacks, timeouts_err }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions_any(&["then", "catch"]) && file.mentions_any(&self.callbacks)).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

/// `exceptions` and `timeoutsErr`. Nothing of it counts if something is not as expected.
fn config(value: &Json) -> Option<(Vec<&str>, bool)> {
    let (mut exceptions, mut timeouts_err) = (Vec::new(), false);
    for (key, value) in value.as_object()? {
        match &key[..] {
            b"exceptions" => {
                let strings = value.as_array()?.iter().map(|it| std::str::from_utf8(it.as_str()?).ok());
                exceptions = strings.collect::<Option<_>>()?;
            }
            b"timeoutsErr" => timeouts_err = value.as_bool()?,
            _ => return None,
        }
    }
    Some((exceptions, timeouts_err))
}

impl NoCallbackInPromise {
    fn is_callback(&self, e: Expr) -> bool {
        get_inner_expression(e).as_ident().is_some_and(|name| name.is_any(&self.callbacks))
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        if !self.is_callback(call_expr.callee()) {
            let Some(first) = call_expr.args().first().filter(|it| self.is_callback(*it)) else {
                return;
            };
            if has_promise_callback(call_expr) {
                cx.report(get_inner_expression(first), NO_CALLBACK_IN_PROMISE);
                return;
            }
            if !self.timeouts_err && is_inside_timeout(e) {
                return;
            }
        }
        let is_in_promise = cx.state.find(Node::Expr(e), |_, ancestor| match ancestor {
            Node::Expr(ancestor) if !self.timeouts_err && is_inside_timeout(ancestor) => Some(false),
            Node::Expr(ancestor) if is_inside_promise(ancestor) => Some(true),
            _ => None,
        });
        if is_in_promise == Some(true) {
            cx.report(e, NO_CALLBACK_IN_PROMISE);
        }
    }
}

/// It is a function that is an argument of `then` or `catch`.
fn is_inside_promise(e: Expr) -> bool {
    e.tag() == ExprTag::Fn
        && !e.is_parenthesized()
        && matches!(e.parent(), Node::Expr(parent)
            if parent.as_call().is_some_and(|call_expr| call_expr.callee() != e && has_promise_callback(call_expr)))
}

fn has_promise_callback(call_expr: Call) -> bool {
    let callee = call_expr.callee();
    !callee.is_parenthesized() && static_property_name(callee).is_some_and(|name| name.is_any(&["then", "catch"]))
}

fn is_inside_timeout(e: Expr) -> bool {
    let Some(callee) = e.as_call().map(Call::callee).filter(|it| !it.is_parenthesized()) else {
        return false;
    };
    match callee.kind() {
        ExprKind::Ident(name) => name.is_any(&TIMEOUT_WHITELIST),
        ExprKind::Dot { name, .. } => !callee.is_private_member() && name.name().is_any(&TIMEOUT_WHITELIST),
        _ => false,
    }
}
