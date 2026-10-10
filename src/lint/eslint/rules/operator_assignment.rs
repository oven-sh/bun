use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{
    TokenOrText, can_tokens_be_adjacent, get_binary_operator_precedence, get_precedence,
    is_literal, is_logical_assignment_operator, is_same_reference,
};
use bun_lint::utils::estree_compat::is_assignment_target;
use bun_lint_oxlint::same_expression::is_same_member_expression;

/// Require or disallow assignment operator shorthand where possible.
pub struct OperatorAssignment {
    never: bool,
}

const REPLACED: Message = Message::new(
    "replaced",
    "Assignment (=) can be replaced with operator assignment ({{operator}}).",
);
const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected operator assignment ({{operator}}) shorthand.",
);

fn is_commutative_operator_with_shorthand(op: BinOp) -> bool {
    matches!(op, BinOp::Mul | BinOp::BitAnd | BinOp::BitXor | BinOp::BitOr)
}

fn is_non_commutative_operator_with_shorthand(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::Add
            | BinOp::Sub
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::Pow
    )
}

/// Whether evaluating `e` once instead of twice, or the reverse, runs the same getters, setters and
/// `toString` calls.
fn can_be_fixed(e: Expr) -> bool {
    let is_simple = |obj: Expr| matches!(obj.kind(), ExprKind::Ident(_) | ExprKind::This);
    match e.kind() {
        ExprKind::Ident(_) => true,
        ExprKind::Dot {
            obj,
            chain: Chain::No,
            ..
        } => is_simple(obj),
        ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } => is_simple(obj) && is_literal(index),
        _ => false,
    }
}

/// oxlint's `check_is_same_reference`. An index can be any expression, written twice: `a[i - 1] = a[i - 1] + b`.
fn is_same_reference_for_oxlint<'a>(target: Expr<'a>, e: Expr<'a>) -> bool {
    match target.kind() {
        ExprKind::Ident(name) => e.as_ident() == Some(name) && !e.is_parenthesized(),
        ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            target.tag() == e.tag() && is_same_member_expression(target, e)
        }
        _ => false,
    }
}

impl OperatorAssignment {
    /// `"always"`: an assignment uses the shorthand where it can.
    fn verify<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = e.kind()
        else {
            return;
        };
        let ExprKind::Binary { op, left, right } = value.kind() else {
            return;
        };
        let is_commutative = is_commutative_operator_with_shorthand(op);
        if !is_commutative && !is_non_commutative_operator_with_shorthand(op) {
            return;
        }
        let replacement = assign_op_text(Some(op));
        let is_oxlint = cx.language().is_oxlint;
        let is_same_reference = |e: Expr<'a>| match is_oxlint {
            true => is_same_reference_for_oxlint(target, e),
            false => is_same_reference(target, e, true),
        };
        if is_same_reference(left) {
            // A default value in a destructuring assignment.
            if is_assignment_target(e) {
                return;
            }
            cx.report(e, REPLACED).data("operator", replacement).fix(|fixer| {
                if !can_be_fixed(target) || !can_be_fixed(left) {
                    return None;
                }
                let (file, equals, operator) =
                    (fixer.file(), e.operator_span()?, value.operator_span()?);
                if file.comments_between(equals, operator).next().is_some() {
                    return None;
                }
                let left_text = file.slice(Span::new(e.span().start, equals.start));
                let right_text = file.slice(Span::new(operator.end, value.span().end));
                Some(fixer.replace(e, [left_text, replacement.as_bytes(), right_text].concat()))
            });
        } else if is_commutative && is_same_reference(right) && !is_assignment_target(e)
        {
            // `a = b * a` is not fixed to `a *= b`: that changes the order of the `valueOf` calls.
            cx.report(e, REPLACED)
                .data("operator", replacement)
                .labels_with(|it| it.note = format!("Use '{replacement}' shorthand instead of '='.").into());
        }
    }

    /// `"never"`: no assignment uses the shorthand.
    fn prohibit<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign {
            op: Some(op),
            target,
            value,
        } = e.kind()
        else {
            return;
        };
        if is_logical_assignment_operator(Some(op)) {
            return;
        }
        cx.report(e, UNEXPECTED).data("operator", assign_op_text(Some(op))).fix(|fixer| {
            if !can_be_fixed(target) {
                return None;
            }
            let (file, whole, operator) = (fixer.file(), e.span(), e.operator_span()?);
            let before_operator = Span::new(whole.start, operator.start);
            // They would be duplicated.
            if file.comments_in(before_operator).next().is_some() {
                return None;
            }
            let (left_text, new_operator) = (file.slice(before_operator), bin_op_text(op).as_bytes());
            let mut text = [left_text, b"= ", left_text, new_operator].concat();
            if get_precedence(value) <= get_binary_operator_precedence(op)
                && !value.is_parenthesized()
            {
                text.extend_from_slice(file.slice(operator.between(value.span())));
                text.push(b'(');
                text.extend_from_slice(value.text());
                text.push(b')');
            } else {
                let next = file.tokens_after(operator).with_comments().next()?;
                let punctuator = TokenOrText::Token(TokenKind::Punctuator, new_operator);
                if next.start() == operator.end && !can_tokens_be_adjacent(punctuator, next) {
                    text.push(b' ');
                }
                text.extend_from_slice(file.slice(Span::new(operator.end, whole.end)));
            }
            Some(fixer.replace(e, text))
        });
    }
}

impl Rule for OperatorAssignment {
    const META: Meta = Meta::eslint("operator-assignment", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        OperatorAssignment {
            never: options.str(0) == Some("never"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.never {
            on.exprs([ExprTag::Assign], Self::prohibit);
        } else {
            on.exprs([ExprTag::Assign], Self::verify);
        }
    }
}
