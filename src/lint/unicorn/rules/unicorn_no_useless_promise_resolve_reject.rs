use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_computed, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows returning values wrapped in `Promise.resolve` or `Promise.reject` in an async function or a
/// `Promise#then`/`catch`/`finally` callback.
pub struct NoUselessPromiseResolveReject {
    allow_reject: bool,
}

const RESOLVE: Message = Message::new("", "Prefer `{{preferred}} value` over `{{preferred}} Promise.resolve(value)`.");
const REJECT: Message = Message::new("", "Prefer `throw error` over `{{preferred}} Promise.reject(error)`.");

#[derive(Default)]
pub struct State<'a> {
    nearest_function: AncestorMemo<'a, Func<'a>>,
    /// Whether there is a `try` statement around something, in the same function.
    is_in_try_statement: AncestorMemo<'a, bool>,
}

impl Rule for NoUselessPromiseResolveReject {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-useless-promise-resolve-reject", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUselessPromiseResolveReject { allow_reject: options.object(0).bool_or("allowReject", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.mentions("Promise") && file.mentions_any(&["resolve", "reject"]) {
            on.exprs([ExprTag::Call], Self::check);
        }
        State::default()
    }
}

fn as_function(node: Node<'_>) -> Option<Func<'_>> {
    node.as_func().filter(|it| it.kind() != FnKind::StaticBlock)
}

impl NoUselessPromiseResolveReject {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let Some(ExprKind::Dot { obj, name, .. }) = get_member_expr(call.callee()).map(Expr::kind) else {
            return;
        };
        let is_reject = match name.bytes() {
            b"resolve" => false,
            b"reject" if !self.allow_reject => true,
            _ => return,
        };
        if !get_inner_expression(obj).is_ident("Promise") || e.is_chain_root() {
            return;
        }
        let parent = e.parent();
        let is_yield = match parent {
            Node::Func(func) if func.is_arrow() && matches!(func.body(), FnBody::Expr(body) if body == e) => false,
            Node::Stmt(stmt) if stmt.tag() == StmtTag::Return => false,
            Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr && is_only_statement_of_function(stmt) => false,
            Node::Expr(outer) if matches!(outer.kind(), ExprKind::Yield { star: false, .. }) => true,
            _ => return,
        };
        let Some(function) = cx.state.nearest_function.find(Node::Expr(e), |_, parent| as_function(parent)) else {
            return;
        };
        if !function.is_async() && !is_promise_callback(function) {
            return;
        }
        let preferred = if is_yield { "yield" } else { "return" };
        let report = cx.report(e, if is_reject { REJECT } else { RESOLVE }).data("preferred", preferred);
        let is_in_try_statement = &mut cx.state.is_in_try_statement;
        report.fix(|fixer| {
            let argument = call.args().first().filter(|_| call.args().len() == 1);
            if call.args().len() > 1 || argument.is_some_and(|it| it.tag() == ExprTag::Spread) {
                return None;
            }
            if is_reject {
                let is_in_try_statement = is_in_try_statement.find(Node::Expr(e), |_, parent| match parent {
                    Node::Stmt(stmt) if stmt.tag() == StmtTag::Try => Some(true),
                    _ => as_function(parent).map(|_| false),
                });
                if is_in_try_statement == Some(true) || is_yield && !is_value_of_yield_discarded(e, parent) {
                    return None;
                }
            }
            let file = fixer.file();
            let arg_text = argument.map_or(&b""[..], |it| file.slice(it.outer_span()));
            let is_arrow_function_body = matches!(parent, Node::Func(_));
            Some(if is_reject {
                let error: &[u8] = if arg_text.is_empty() { b"undefined" } else { arg_text };
                match parent {
                    Node::Expr(outer) => fixer.replace(outer.outer_span(), [&b"throw "[..], error].concat()),
                    // `=> Promise.reject(error)` -> `=> { throw error; }`
                    Node::Func(_) => fixer.replace(e.outer_span(), [&b"{ throw "[..], error, b"; }"].concat()),
                    _ => fixer.replace(parent, [&b"throw "[..], error, b";"].concat()),
                }
            } else if let Some(argument) = argument {
                match argument.tag() == ExprTag::Object && !argument.is_parenthesized() {
                    true => fixer.replace(e, [&b"("[..], arg_text, b")"].concat()),
                    false => fixer.replace(e, arg_text),
                }
            } else if is_arrow_function_body {
                // `=> Promise.resolve()` -> `=> {}`
                fixer.replace(e, "{}")
            } else {
                // All that is after the `return` or the `yield`.
                let start = match parent {
                    Node::Stmt(stmt) if stmt.tag() == StmtTag::Return => stmt.span().start + 6,
                    Node::Expr(outer) => outer.span().start + 5,
                    _ => e.span().start,
                };
                fixer.remove(Span::new(start, e.span().end))
            })
        });
    }
}

/// Directives do not count.
fn is_only_statement_of_function(stmt: Stmt) -> bool {
    let Node::Func(func) = stmt.parent() else {
        return false;
    };
    func.kind() != FnKind::StaticBlock
        && func.body_statements().is_some_and(|statements| {
            let before = statements.len().checked_sub(2).and_then(|it| statements.get(it));
            statements.last() == Some(stmt) && before.is_none_or(|it| it.directive().is_some())
        })
}

/// `e`: the operand of the `yield` that is `parent`. Whether the parent of the parent of `e` is an expression statement
/// or parentheses, where parentheses are parents.
fn is_value_of_yield_discarded(e: Expr, parent: Node) -> bool {
    match (if e.is_parenthesized() { e.parens().len() } else { 0 }, parent) {
        (0, Node::Expr(outer)) => {
            outer.is_parenthesized() || matches!(outer.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr)
        }
        (1, _) => false,
        _ => true,
    }
}

/// `promise.then(function)`, `promise.catch(function.bind(this))`
fn is_promise_callback(function: Func) -> bool {
    let Node::Expr(mut current) = function.owner() else {
        return false;
    };
    loop {
        let Node::Expr(parent) = current.parent() else {
            return false;
        };
        if current.is_chain_root() {
            return false;
        }
        if let Some(call) = parent.as_call() {
            let method = get_member_expr(call.callee()).filter(|it| !is_computed(*it)).and_then(static_property_name);
            return method.is_some_and(|method| match call.args().len() {
                1 => method.is_any(&["then", "catch", "finally"]),
                2 => method.is("then") && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread),
                _ => false,
            });
        }
        // `current.bind(..)`
        match parent.parent() {
            Node::Expr(bound)
                if bound.tag() == ExprTag::Call
                    && !parent.is_chain_root()
                    && static_property_name(parent).is_some_and(|it| it.is("bind")) =>
            {
                current = bound;
            }
            _ => return false,
        }
    }
}
