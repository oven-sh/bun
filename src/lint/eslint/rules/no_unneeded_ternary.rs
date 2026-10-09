use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;

/// Disallow ternary operators when simpler alternatives exist.
pub struct NoUnneededTernary {
    allows_default_assignment: bool,
}

const UNNECESSARY_CONDITIONAL_EXPRESSION: Message = Message::new(
    "unnecessaryConditionalExpression",
    "Unnecessary use of boolean literals in conditional expression.",
);
const UNNECESSARY_CONDITIONAL_ASSIGNMENT: Message = Message::new(
    "unnecessaryConditionalAssignment",
    "Unnecessary use of conditional expression for default assignment.",
);

/// That of a `UnaryExpression`.
const UNARY_PRECEDENCE: i32 = 16;

fn boolean_literal(e: Expr) -> Option<bool> {
    match e.kind() {
        ExprKind::True => Some(true),
        ExprKind::False => Some(false),
        _ => None,
    }
}

/// ESLint's `invertExpression`: the text of an expression that is true when `e` is falsy.
fn invert_expression(e: Expr) -> Vec<u8> {
    // `<` and `>=` are not inverses: both are false with `NaN`.
    let inverse = match e.kind() {
        ExprKind::Binary { op: BinOp::EqEq, .. } => Some("!="),
        ExprKind::Binary { op: BinOp::NotEq, .. } => Some("=="),
        ExprKind::Binary { op: BinOp::EqEqEq, .. } => Some("!=="),
        ExprKind::Binary { op: BinOp::NotEqEq, .. } => Some("==="),
        _ => None,
    };
    if let Some(inverse) = inverse
        && let Some(operator) = e.operator_span()
    {
        let (file, whole) = (e.file(), e.span());
        return [
            file.slice(Span::new(whole.start, operator.start)),
            inverse.as_bytes(),
            file.slice(Span::new(operator.end, whole.end)),
        ]
        .concat();
    }
    let text = ast_utils::get_parenthesised_text(e);
    match ast_utils::get_precedence(e) < UNARY_PRECEDENCE {
        true => [&b"!("[..], text, b")"].concat(),
        false => [&b"!"[..], text].concat(),
    }
}

/// ESLint's `isBooleanExpression`: its value is always a boolean.
fn is_boolean_expression(e: Expr) -> bool {
    matches!(
        e.kind(),
        ExprKind::Unary { op: UnOp::Not, .. }
            | ExprKind::Binary {
                op: BinOp::EqEq
                    | BinOp::EqEqEq
                    | BinOp::NotEq
                    | BinOp::NotEqEq
                    | BinOp::Gt
                    | BinOp::Ge
                    | BinOp::Lt
                    | BinOp::Le
                    | BinOp::In
                    | BinOp::Instanceof,
                ..
            }
    )
}

impl Rule for NoUnneededTernary {
    const META: Meta = Meta::eslint("no-unneeded-ternary", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnneededTernary {
            allows_default_assignment: options.object(0).bool_or("defaultAssignment", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Cond], |rule, e, cx| {
            let ExprKind::Cond { test, yes, no } = e.kind() else {
                return;
            };
            // oxlint sees through `as T` and the like.
            let is_oxlint = cx.language().is_oxlint;
            let seen = |it: Expr<'a>| if is_oxlint { get_inner_expression(it) } else { it };
            if let (Some(consequent), Some(alternate)) = (boolean_literal(yes), boolean_literal(no)) {
                cx.report(e, UNNECESSARY_CONDITIONAL_EXPRESSION).fix(|fixer| {
                    if consequent == alternate {
                        // Not `foo() ? true : true`, which calls `foo`.
                        return (test.tag() == ExprTag::Ident).then(|| fixer.replace(e, yes.text()));
                    }
                    if alternate {
                        return Some(fixer.replace(e, invert_expression(test)));
                    }
                    Some(match is_boolean_expression(test) {
                        true => fixer.replace(e, ast_utils::get_parenthesised_text(test)),
                        false => fixer.replace(e, [&b"!"[..], &invert_expression(test)].concat()),
                    })
                });
            } else if !rule.allows_default_assignment
                && let (Some(tested), Some(consequent)) = (seen(test).as_ident(), seen(yes).as_ident())
                && tested == consequent
            {
                cx.report(e, UNNECESSARY_CONDITIONAL_ASSIGNMENT).fix(|fixer| {
                    let or_precedence = ast_utils::get_binary_operator_precedence(BinOp::Or);
                    let should_parenthesize_alternate = (ast_utils::get_precedence(no) < or_precedence
                        || ast_utils::is_coalesce_expression(no))
                        && !ast_utils::is_parenthesised(no);
                    let test_text = ast_utils::get_parenthesised_text(test);
                    let text = match should_parenthesize_alternate {
                        true => [test_text, b" || (", no.text(), b")"].concat(),
                        false => [test_text, b" || ", ast_utils::get_parenthesised_text(no)].concat(),
                    };
                    fixer.replace(e, text)
                });
            }
        });
    }
}
