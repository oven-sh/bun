use crate::unicorn::could_be_asi_hazard;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow negated expressions on the left of (in)equality checks.
pub struct NoNegationInEqualityCheck;

const NO_NEGATION_IN_EQUALITY_CHECK: Message = Message::new("", "Negated expression is not allowed in equality check.");
const REMOVE_NEGATION: Message =
    Message::new("", "Remove the negation operator and use '{{suggested_operator}}' instead of '{{current_operator}}'.");

impl Rule for NoNegationInEqualityCheck {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-negation-in-equality-check", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNegationInEqualityCheck
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.binaries([BinOp::EqEq, BinOp::NotEq, BinOp::EqEqEq, BinOp::NotEqEq], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let ExprKind::Unary { op: UnOp::Not, operand: argument } = left.kind() else {
                return;
            };
            if left.is_parenthesized() || argument.unary_op() == Some(UnOp::Not) && !argument.is_parenthesized() {
                return;
            }
            let suggested_operator = bin_op_text(match op {
                BinOp::EqEq => BinOp::NotEq,
                BinOp::NotEq => BinOp::EqEq,
                BinOp::EqEqEq => BinOp::NotEqEq,
                _ => BinOp::EqEqEq,
            });
            let data = [("suggested_operator", suggested_operator.as_bytes()), ("current_operator", bin_op_text(op).as_bytes())];
            cx.report(left, NO_NEGATION_IN_EQUALITY_CHECK).suggest_with(REMOVE_NEGATION, &data, |fixer| {
                let file = fixer.file();
                let argument_text = file.slice(argument.outer_span());
                let before = file.text().get(..left.span().start as usize).unwrap_or_default();
                let prefix = if matches!(argument_text.first(), Some(b'(' | b'[')) && could_be_asi_hazard(e) {
                    ";"
                } else if text::last_code_point(before).is_some_and(text::is_identifier_start) {
                    // `return!foo` is `return foo`.
                    " "
                } else {
                    ""
                };
                let operator = [" ", suggested_operator, " "].concat();
                fixer.replace(e, [prefix.as_bytes(), argument_text, operator.as_bytes(), file.slice(right.outer_span())].concat())
            });
        });
    }
}
