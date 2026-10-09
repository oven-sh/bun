use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer top-level await over top-level promises and async function calls.
pub struct PreferTopLevelAwait;

const OVER_PROMISE_CHAIN: Message = Message::new("", "Prefer top-level await over using a promise chain.");
const OVER_ASYNC_IIFE: Message = Message::new("", "Prefer top-level await over using an async IIFE.");
const OVER_ASYNC_FUNCTION_CALL: Message = Message::new("", "Prefer top-level await over an async function call.");

#[derive(Default)]
pub struct State<'a> {
    /// What is in the body of a function or of a class, or anywhere in an arrow function.
    bodies: AncestorMemo<'a, ()>,
}

impl Rule for PreferTopLevelAwait {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-top-level-await", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        PreferTopLevelAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            let callee = call_expr.callee();
            let message = if is_promise_method(callee) {
                OVER_PROMISE_CHAIN
            } else if is_async_function(callee) {
                OVER_ASYNC_IIFE
            } else if callee.tag() == ExprTag::Ident && !callee.is_parenthesized() {
                OVER_ASYNC_FUNCTION_CALL
            } else {
                return;
            };
            if cx.state.bodies.find(Node::Expr(e), is_body).is_some() || is_handled(e) {
                return;
            }
            if callee.tag() != ExprTag::Ident || is_only_reference_to_async_function(callee) {
                cx.report(e, message);
            }
        });
        State::default()
    }
}

/// `a.then`, `a.catch`, `a.finally`, not in parentheses.
fn is_promise_method(e: Expr) -> bool {
    !e.is_parenthesized() && !e.is_private_member() && e.member_name().is_some_and(|it| it.name().is_any(&["then", "catch", "finally"]))
}

/// A function expression that is `async` and not a generator.
fn is_async_function(e: Expr) -> bool {
    get_inner_expression(e).as_fn().is_some_and(|it| it.is_async() && !it.is_generator())
}

fn is_body<'a>(child: Node<'a>, parent: Node<'a>) -> Option<()> {
    match (parent, child) {
        // The default of a parameter of a function is not in its body.
        (Node::Func(_), Node::Stmt(_)) | (Node::Class(_), Node::Member(_)) => Some(()),
        (Node::Func(func), _) if func.is_arrow() => Some(()),
        _ => None,
    }
}

/// It is awaited, or what is done with it is reported, or `Promise.all()` and the like take it.
fn is_handled(e: Expr) -> bool {
    let Node::Expr(parent) = e.parent() else {
        return false;
    };
    if !e.is_parenthesized() {
        // `e.then()`
        if is_promise_method(parent) && matches!(parent.parent(), Node::Expr(call) if call.as_call().is_some_and(|it| it.callee() == parent)) {
            return true;
        }
        // `Promise.all([e])`
        if parent.tag() == ExprTag::Array
            && !parent.is_parenthesized()
            && let Some(call) = parent.parent().as_expr().and_then(Expr::as_call)
            && is_method_call(call, Some(&["Promise"]), Some(&["all", "allSettled", "any", "race"]), Some(1), Some(1))
        {
            return true;
        }
    }
    // `await e`, `await e.a.b`, `await (e as T)`
    let mut at = parent;
    loop {
        let is_passed = match at.tag() {
            ExprTag::As | ExprTag::AsConst => !at.is_angle_bracket_assertion(),
            ExprTag::Satisfies => true,
            ExprTag::Dot => !at.is_private_member(),
            tag => return tag == ExprTag::Await,
        };
        match at.parent() {
            Node::Expr(parent) if is_passed => at = parent,
            _ => return false,
        }
    }
}

/// `ident`: an identifier. Nothing else refers to what it refers to, which is an `async` function or a `const` with one.
fn is_only_reference_to_async_function(ident: Expr) -> bool {
    let Some(symbol) = ident.symbol() else {
        return false;
    };
    // The name in the declaration is not a reference for oxlint.
    if symbol.references().filter(|it| !it.is_jsx_pragma() && !matches!(it.node(), Node::Pat(_))).nth(1).is_some() {
        return false;
    }
    match symbol.declarations().next() {
        Some(Declaration::Fn(func)) => func.is_async() && !func.is_generator(),
        Some(declaration @ Declaration::Var(_)) => matches!(declaration.node(), Some(Node::VarDecl(var_decl))
            if var_decl.var_kind() == VarKind::Const && var_decl.init().is_some_and(is_async_function)),
        _ => false,
    }
}
