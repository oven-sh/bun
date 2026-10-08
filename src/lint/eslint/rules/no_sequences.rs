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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoSequences {
            allow_in_parentheses: options.object(0).bool_or("allowInParentheses", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], |rule, e, cx| {
            if !utils::is_sequence_root(e)
                || is_init_or_update_of_for(e)
                || (rule.allow_in_parentheses && e.parens().len() >= parentheses_needed(e))
            {
                return;
            }
            let Some(&first) = e.sequence().first() else {
                return;
            };
            let comma = skip_trivia(cx.text(), first.outer_span().end);
            cx.report(Span::new(comma, comma + 1), UNEXPECTED_COMMA_EXPRESSION);
        });
    }
}
