use bun_lint::prelude::*;

/// Disallow comma operators.
pub struct NoSequences {
    allow_in_parentheses: bool,
}

const UNEXPECTED_COMMA_EXPRESSION: Message =
    Message::new("unexpectedCommaExpression", "Unexpected use of comma operator.");

/// How many pairs of parentheses around `e` show that the comma operator is meant. Those that the
/// syntax of a statement requires are not around the expression. Those of the body of an arrow
/// function are, and the syntax requires them too.
fn parentheses_needed(e: Expr<'_>) -> usize {
    match e.parent() {
        Node::Func(func) if func.is_arrow() => 2,
        _ => 1,
    }
}

/// `e` is the `init` or the `update` of a `for` statement.
fn is_init_or_update_of_for(e: Expr<'_>) -> bool {
    let Node::Stmt(parent) = e.parent() else {
        return false;
    };
    let StmtKind::For { init, update, .. } = parent.kind() else {
        return false;
    };
    update == Some(e) || init.is_some_and(|init| matches!(init.kind(), StmtKind::Expr(init) if init == e))
}

impl Rule for NoSequences {
    const META: Meta = Meta::eslint("no-sequences", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Binary]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoSequences {
            allow_in_parentheses: options.object(0).bool_or("allowInParentheses", true),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !utils::is_sequence_root(e)
            || is_init_or_update_of_for(e)
            || (self.allow_in_parentheses && e.parens().len() >= parentheses_needed(e))
        {
            return;
        }
        let sequence = e.sequence();
        let Some(first) = sequence.first() else {
            return;
        };
        let after_first = first.outer_span().end;
        // oxlint points at all that is between the first two.
        let place = match sequence.get(1).filter(|_| cx.language().is_oxlint) {
            Some(second) => first.outer_span().between(second.outer_span()),
            None => {
                let comma = skip_trivia(cx.text(), after_first);
                Span::new(comma, comma + 1)
            }
        };
        cx.report(place, UNEXPECTED_COMMA_EXPRESSION);
    }
}
