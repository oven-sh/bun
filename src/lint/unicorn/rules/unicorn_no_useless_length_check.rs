use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_inner_expression_unless_chain, get_member_expr, static_property_name,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Disallow useless array length check.
pub struct NoUselessLengthCheck;

const USELESS_LENGTH_CHECK: Message = Message::new("", "Found a useless array length check");

#[derive(Copy, Clone)]
enum Operand<'a> {
    /// `array.length === 0` beside `||`, `array.length !== 0` or `array.length > 0` beside `&&`.
    LengthCheck(Name<'a>, Span),
    /// `array.every(..)` beside `||`, `array.some(..)` beside `&&`.
    Call(Name<'a>),
}

/// The `array` of `array.length`.
fn array_of(member: Expr<'_>) -> Option<Name<'_>> {
    get_inner_expression(member.object()?).as_ident()
}

fn operand(e: Expr<'_>, operator: BinOp) -> Option<Operand<'_>> {
    match e.kind() {
        ExprKind::Binary { op, left, right } => {
            let is_check = match operator {
                BinOp::Or => op == BinOp::EqEqEq,
                _ => matches!(op, BinOp::NotEqEq | BinOp::Gt),
            };
            if !is_check || right.tag() != ExprTag::Number || right.is_parenthesized() || right.text() != b"0" {
                return None;
            }
            let member = get_inner_expression_unless_chain(left)?;
            static_property_name(member)?.is("length").then_some(Operand::LengthCheck(array_of(member)?, e.span()))
        }
        ExprKind::Call(call) if !e.is_chain_root() => {
            let member = get_member_expr(call.callee())?;
            let method = if operator == BinOp::Or { "every" } else { "some" };
            static_property_name(member)?.is(method).then_some(Operand::Call(array_of(member)?))
        }
        _ => None,
    }
}

impl Rule for NoUselessLengthCheck {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-length-check", Kind::Problem);
    const ON: On = On::new().binaries(&[BinOp::And, BinOp::Or]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessLengthCheck
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("length") || !file.mentions_any(&["every", "some"]) {
            return None;
        }
        Some(())
    }

    fn binary<'a>(&self, root: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(operator) = root.binary_op() else {
            return;
        };
        if matches!(root.parent(), Node::Expr(parent) if parent.binary_op() == Some(operator)) {
            return;
        }
        // oxlint looks at the operands of `a && b && c` once for each `&&` that they are under: two neighbours are
        // reported as often as there are `&&` around both.
        let mut pending: SmallVec<[(Expr<'a>, u32); 8]> = SmallVec::new();
        let (mut at, mut depth, mut around_both) = (root, 0, 0);
        let mut previous = None;
        loop {
            while let ExprKind::Binary { op, left, right } = at.kind()
                && op == operator
            {
                depth += 1;
                pending.push((right, depth));
                at = left;
            }
            let current = operand(at, operator);
            if let (Some(Operand::LengthCheck(array, span)), Some(Operand::Call(called)))
            | (Some(Operand::Call(called)), Some(Operand::LengthCheck(array, span))) = (previous, current)
                && array == called
            {
                for _ in 0..around_both {
                    cx.report(span, USELESS_LENGTH_CHECK).help(match operator {
                        BinOp::And => {
                            "The non-empty check is useless as `Array#some()` returns `false` for an empty array."
                        }
                        _ => "The empty check is useless as `Array#every()` returns `true` for an empty array.",
                    });
                }
            }
            previous = current;
            let Some(next) = pending.pop() else {
                return;
            };
            (at, depth) = next;
            around_both = depth;
        }
    }
}
