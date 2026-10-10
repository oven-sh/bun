use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_member_expr, is_computed, is_method_call, iter_outer_expressions, static_property_info,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow passing single-element arrays to `Promise` methods.
pub struct NoSinglePromiseInPromiseMethods;

const NO_SINGLE_PROMISE: Message =
    Message::new("", "Wrapping single-element array with `Promise.{{method_name}}()` is unnecessary.");

const METHODS: [&str; 3] = ["all", "any", "race"];

impl Rule for NoSinglePromiseInPromiseMethods {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-single-promise-in-promise-methods", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSinglePromiseInPromiseMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Promise") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if call.is_optional() || !is_method_call(call, Some(&["Promise"]), Some(&METHODS), Some(1), Some(1)) {
            return;
        }
        let Some(member) = get_member_expr(call.callee()).filter(|it| !it.is_optional() && !is_computed(*it)) else {
            return;
        };
        let (Some((span, method_name)), Some(ExprKind::Array(elements))) =
            (static_property_info(member), call.args().first().map(|it| get_inner_expression(it).kind()))
        else {
            return;
        };
        let Some(first) = elements.first().filter(|_| elements.len() == 1) else {
            return;
        };
        if matches!(first.tag(), ExprTag::Spread | ExprTag::Missing) {
            return;
        }
        cx.report(span, NO_SINGLE_PROMISE).data("method_name", method_name).fix(|fixer| {
            let is_all = method_name.is("all");
            let awaited = iter_outer_expressions(e).next().and_then(Node::as_expr);
            let awaited = awaited.filter(|it| it.tag() == ExprTag::Await);
            if awaited.is_none() && is_all || !is_fixable(e) {
                return None;
            }
            let element = fixer.file().slice(first.outer_span());
            Some(match awaited {
                Some(awaited) if is_all && !is_await_value_discarded(awaited) => {
                    fixer.replace(awaited, [&b"[await "[..], element, b"]"].concat())
                }
                Some(_) => fixer.replace(e, element),
                None => fixer.replace(e, [&b"Promise.resolve("[..], element, b")"].concat()),
            })
        });
    }
}

fn is_fixable(call: Expr) -> bool {
    let around = iter_outer_expressions(call).find(|it| !matches!(it, Node::Expr(e) if e.tag() == ExprTag::Await));
    match around {
        Some(Node::VarDecl(_)) => false,
        Some(Node::Stmt(stmt)) => stmt.tag() != StmtTag::Return,
        Some(Node::Expr(e)) => match e.tag() {
            ExprTag::Call => false,
            // Not the default value in a pattern.
            ExprTag::Assign => e.is_assignment_target(),
            _ => true,
        },
        _ => true,
    }
}

/// `awaited`: the `await` of the call.
fn is_await_value_discarded(awaited: Expr) -> bool {
    let around = iter_outer_expressions(awaited).find(|it| !matches!(it, Node::Expr(e) if e.tag() == ExprTag::Await));
    matches!(around, Some(Node::Stmt(stmt)) if stmt.tag() == StmtTag::Expr)
}
