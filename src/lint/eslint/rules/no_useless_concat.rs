use bun_lint::prelude::*;

/// Disallow unnecessary concatenation of literals or template literals.
pub struct NoUselessConcat;

const UNEXPECTED_CONCAT: Message =
    Message::new("unexpectedConcat", "Unexpected string concatenation of literals.");

/// Returns the operands, if `e` is a `+`.
fn as_concatenation(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.as_binary() {
        Some((BinOp::Add, left, right)) => Some((left, right)),
        _ => None,
    }
}

impl Rule for NoUselessConcat {
    const META: Meta = Meta::eslint("no-useless-concat", Kind::Suggestion);
    const ON: On = On::new().binaries(&[BinOp::Add]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessConcat
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((mut left, mut right)) = as_concatenation(e) else {
            return;
        };
        // oxlint doesn't look through parentheses.
        let is_oxlint = cx.language().is_oxlint;
        let looks_into = |e: Expr| !(is_oxlint && e.is_parenthesized());
        // `foo + "a" + "b"`
        while let Some((_, inner)) = as_concatenation(left).filter(|_| looks_into(left)) {
            left = inner;
        }
        while let Some((inner, _)) = as_concatenation(right).filter(|_| looks_into(right)) {
            right = inner;
        }
        if ast_utils::is_string_literal(left)
            && ast_utils::is_string_literal(right)
            && looks_into(left)
            && looks_into(right)
            && ast_utils::is_token_on_same_line(cx.file(), left, right)
            && let Some(operator) = e.operator_span()
        {
            // oxlint points at the two strings.
            let both = Span::new(left.span().start, right.span().end);
            cx.report(if is_oxlint { both } else { operator }, UNEXPECTED_CONCAT);
        }
    }
}
