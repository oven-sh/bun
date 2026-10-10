use bun_lint::prelude::*;

/// Disallow negating the left operand of relational operators.
pub struct NoUnsafeNegation {
    enforce_for_ordering_relations: bool,
}

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected negating the left operand of '{{operator}}' operator.",
);
const SUGGEST_NEGATED_EXPRESSION: Message = Message::new(
    "suggestNegatedExpression",
    "Negate '{{operator}}' expression instead of its left operand. This changes the current behavior.",
);
const SUGGEST_PARENTHESISED_NEGATION: Message = Message::new(
    "suggestParenthesisedNegation",
    "Wrap negation in '()' to make the intention explicit. This preserves the current behavior.",
);

impl NoUnsafeNegation {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let applies = match op {
            BinOp::In | BinOp::Instanceof => true,
            BinOp::Lt | BinOp::Gt | BinOp::Ge | BinOp::Le => self.enforce_for_ordering_relations,
            _ => false,
        };
        if !applies
            || !matches!(left.kind(), ExprKind::Unary { op: UnOp::Not, .. })
            || left.is_parenthesized()
        {
            return;
        }
        let operator = bin_op_text(op);
        let report = cx.report(left, UNEXPECTED).data("operator", operator);
        // oxlint has a fix, and writes the comparison anew.
        if cx.language().is_oxlint {
            report.fix(|fixer| {
                let file = fixer.file();
                let (negated, compared) = (file.slice(left.operand()?.outer_span()), file.slice(right.outer_span()));
                Some(fixer.replace(e, [&b"!("[..], negated, b" ", operator.as_bytes(), b" ", compared, b")"].concat()))
            });
            return;
        }
        report
            .suggest_with(
                SUGGEST_NEGATED_EXPRESSION,
                &[("operator", operator.as_bytes())],
                |fixer| {
                    let after_negation = Span::new(left.span().start + 1, e.span().end);
                    let text = [&b"("[..], fixer.file().slice(after_negation), b")"].concat();
                    fixer.replace(after_negation, text)
                },
            )
            .suggest(SUGGEST_PARENTHESISED_NEGATION, |fixer| {
                fixer.replace(left, [&b"("[..], left.text(), b")"].concat())
            });
    }
}

impl Rule for NoUnsafeNegation {
    const META: Meta = Meta::eslint("no-unsafe-negation", Kind::Problem)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::Binary]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoUnsafeNegation {
            enforce_for_ordering_relations: options
                .object(0)
                .bool_or("enforceForOrderingRelations", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}
