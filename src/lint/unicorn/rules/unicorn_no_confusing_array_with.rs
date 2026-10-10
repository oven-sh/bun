use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr};
use bun_lint_oxlint::same_expression::is_same_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow confusing uses of `Array#with()`.
pub struct NoConfusingArrayWith;

const NEGATIVE_INDEX: Message = Message::new("", "Avoid using a negative index with `Array#with()`.");
const LENGTH_INDEX: Message = Message::new("", "Avoid using `.length` as the index in `Array#with()`.");

/// The `name` of `a.name`: not of `a?.name`, `a.#name`, `a["name"]`.
fn plain_member_name(member: Expr<'_>) -> Option<Ident<'_>> {
    member.member_name().filter(|_| !member.is_optional() && !member.is_private_member())
}

fn get_static_number_value(expression: Expr) -> Option<f64> {
    let (mut at, mut is_negated) = (expression, false);
    loop {
        match get_inner_expression(at).kind() {
            ExprKind::Number(value) => return Some(if is_negated { -value } else { value }),
            ExprKind::Unary { op: UnOp::Plus, operand } => at = operand,
            ExprKind::Unary { op: UnOp::Minus, operand } => (at, is_negated) = (operand, !is_negated),
            _ => return None,
        }
    }
}

fn is_length_member_for<'a>(index: Expr<'a>, object: Expr<'a>) -> bool {
    get_member_expr(index).is_some_and(|member| {
        plain_member_name(member).is_some_and(|it| it.name().is("length"))
            && member.object().is_some_and(|it| is_same_inner_expression(it, object))
    })
}

impl Rule for NoConfusingArrayWith {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-confusing-array-with", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConfusingArrayWith
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("with") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
            return;
        };
        let Some(member) = get_member_expr(call.callee()) else {
            return;
        };
        let Some(property) = plain_member_name(member) else {
            return;
        };
        let (Some(object), Some(index)) = (member.object(), call.args().first()) else {
            return;
        };
        if !property.name().is("with") || index.tag() == ExprTag::Spread {
            return;
        }
        if get_static_number_value(index).is_some_and(|it| it.is_finite() && it.trunc() < 0.0) {
            cx.report(property, NEGATIVE_INDEX);
        } else if is_length_member_for(index, object) {
            cx.report(property, LENGTH_INDEX);
        }
    }
}
