use bun_lint::prelude::*;

/// Disallow unnecessary concatenation of literals or template literals.
pub struct NoUselessConcat;

const UNEXPECTED_CONCAT: Message =
    Message::new("unexpectedConcat", "Unexpected string concatenation of literals.");

/// The operands, if `e` is a `+`.
fn as_concatenation(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => Some((left, right)),
        _ => None,
    }
}

impl Rule for NoUselessConcat {
    const META: Meta = Meta::eslint("no-useless-concat", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Binary]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessConcat
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((mut left, mut right)) = as_concatenation(e) else {
            return;
        };
        // oxlint does not see through parentheses.
        let is_oxlint = cx.language().is_oxlint;
        let sees = |e: Expr| !(is_oxlint && e.is_parenthesized());
        // `foo + "a" + "b"`
        while let Some((_, inner)) = as_concatenation(left).filter(|_| sees(left)) {
            left = inner;
        }
        while let Some((inner, _)) = as_concatenation(right).filter(|_| sees(right)) {
            right = inner;
        }
        if ast_utils::is_string_literal(left)
            && ast_utils::is_string_literal(right)
            && sees(left)
            && sees(right)
            && ast_utils::is_token_on_same_line(cx.file(), left, right)
            && let Some(operator) = e.operator_span()
        {
            // oxlint points at the two strings.
            let both = Span::new(left.span().start, right.span().end);
            cx.report(if is_oxlint { both } else { operator }, UNEXPECTED_CONCAT);
        }
    }
}
