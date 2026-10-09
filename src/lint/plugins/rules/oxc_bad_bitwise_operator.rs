use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// This rule applies when bitwise operators are used where logical operators are expected.
pub struct BadBitwiseOperator;

const BAD_BITWISE_OPERATOR: Message = Message::new("", "Bad bitwise operator");
const USE_LOGICAL_OPERATOR: Message =
    Message::new("", "Bitwise operator '{{bad_operator}}' seems unintended. Did you mean logical operator '{{suggestion}}'?");

impl Rule for BadBitwiseOperator {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-bitwise-operator", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadBitwiseOperator
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.binaries([BinOp::BitAnd, BinOp::BitOr], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let Some(left_ident) = left.as_ident().filter(|_| !left.is_parenthesized()) else {
                return;
            };
            match op {
                BinOp::BitAnd if is_member_of(right, left_ident) => report(e, "&", "&&", cx),
                BinOp::BitOr if !is_numeric_expr(right) => report(e, "|", "||", cx),
                _ => {}
            }
        });
        on.exprs([ExprTag::Assign], |_, e, cx| {
            if let ExprKind::Assign { op: Some(BinOp::BitOr), value, .. } = e.kind()
                && !is_numeric_expr(value)
            {
                report(e, "|=", "||=", cx);
            }
        });
    }
}

fn report<'a>(e: Expr<'a>, bad_operator: &'static str, suggestion: &'static str, cx: &Cx<'a, BadBitwiseOperator>) {
    let data = [("bad_operator", bad_operator.as_bytes()), ("suggestion", suggestion.as_bytes())];
    cx.report(e, BAD_BITWISE_OPERATOR)
        .suggest_with(USE_LOGICAL_OPERATOR, &data, |fixer| Some(fixer.replace(e.operator_span()?, suggestion)));
}

/// `name.a`, `name[a]`
fn is_member_of<'a>(e: Expr<'a>, name: Name<'a>) -> bool {
    !e.is_parenthesized()
        && !e.is_chain_root()
        && e.object().is_some_and(|object| object.as_ident() == Some(name) && !object.is_parenthesized())
}

fn is_numeric_expr(e: Expr) -> bool {
    let is_outer_most = !e.is_parenthesized();
    match e.kind() {
        ExprKind::Number(_) | ExprKind::Null | ExprKind::Ident(_) => true,
        ExprKind::Unary { op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Void | UnOp::Delete, .. } => true,
        ExprKind::Unary { op: UnOp::Typeof, .. } => false,
        ExprKind::Unary { op: UnOp::Not, .. } => !is_outer_most,
        ExprKind::Binary { op, left, .. }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) && left.tag() != ExprTag::PrivateIdentifier =>
        {
            !is_string_concat(e)
        }
        ExprKind::String(_) | ExprKind::Template(_) => false,
        _ => !is_outer_most,
    }
}

/// Whether one of the operands of `a + (b + c) + ..` is a string or a `typeof`.
fn is_string_concat(binary_expr: Expr) -> bool {
    let mut pending: SmallVec<[Expr; 8]> = smallvec![binary_expr];
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Binary { op: BinOp::Add, left, right } => pending.extend([left, right]),
            ExprKind::String(_) | ExprKind::Unary { op: UnOp::Typeof, .. } => return true,
            _ => {}
        }
    }
    false
}
