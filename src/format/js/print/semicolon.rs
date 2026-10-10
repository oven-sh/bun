use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;

/// A `;`, unless the options say to leave them out.
pub(crate) struct OptionalSemicolon;

impl<'a> Format<'a> for OptionalSemicolon {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().semicolons.is_always() {
            ";".fmt(f);
        }
    }
}

/// `a = (b /* comment */);` is `a = b; /* comment */` for oxfmt: the parentheses are not written, so the
/// comment is before the `;`, and goes behind it like any other that is. Prettier writes
/// `a = b /* comment */;`, and makes that of it when it formats it again.
fn comments_in_dropped_parentheses_go_behind_semicolon(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `handleParenthesizedExpressionTrailingComment`: whether the parentheses at the end of `e`
/// are written, with the comment before the `)` in them: those of a sequence or an assignment that is
/// the value of a variable, the argument of `return`, the body of an arrow function or the right side of
/// an assignment. `is_in_such_a_place`: `e` is.
fn keeps_comment_in_parentheses(mut e: Expr<'_>, mut is_in_such_a_place: bool) -> bool {
    loop {
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => return is_in_such_a_place,
            ExprKind::Assign { value, .. } => {
                let is_sequence = matches!(
                    value.kind(),
                    ExprKind::Binary {
                        op: BinOp::Comma,
                        ..
                    }
                );
                if is_in_such_a_place || is_sequence {
                    return true;
                }
                e = value;
            }
            _ => match e.arrow_function().map(|arrow| arrow.body()) {
                Some(FnBody::Expr(body)) => (e, is_in_such_a_place) = (body, true),
                _ => return false,
            },
        }
    }
}

/// The last thing in `e` that is no assignment and no arrow function with an expression for a body. The
/// parentheses between its end and the end of `e` are not written.
fn last_of_assignments_and_arrows(mut e: Expr<'_>) -> Expr<'_> {
    loop {
        e = match e.kind() {
            ExprKind::Assign { value, .. } => value,
            _ => match e.arrow_function().map(|arrow| arrow.body()) {
                Some(FnBody::Expr(body))
                    if !matches!(
                        body.kind(),
                        ExprKind::Assign { .. }
                            | ExprKind::Jsx(_)
                            | ExprKind::Binary {
                                op: BinOp::Comma,
                                ..
                            }
                    ) =>
                {
                    body
                }
                _ => return e,
            },
        };
    }
}

/// See [`comments_in_dropped_parentheses_go_behind_semicolon`]: where the comments start that go behind
/// the `;` after `e`, if there are any in `e` or in the parentheses around it.
///
/// `is_in_such_a_place`: see [`keeps_comment_in_parentheses`]. `None`: it makes no difference.
pub(crate) fn start_of_comments_in_dropped_parentheses<'a>(
    e: Expr<'a>,
    is_in_such_a_place: Option<bool>,
    f: &Formatter<'a>,
) -> Option<u32> {
    if f.is_quiet()
        || !comments_in_dropped_parentheses_go_behind_semicolon(f)
        || is_in_such_a_place.is_some_and(|it| keeps_comment_in_parentheses(e, it))
    {
        return None;
    }
    let last = last_of_assignments_and_arrows(e);
    let position = last.span().end;
    let has_comments = f
        .comments()
        .has_comment_in_span(Span::after(last.span(), e.outer_span().end));
    // One that is about what is before it has to be seen there.
    (has_comments
        && !is_cast_target(last, f)
        && !f.comments().has_trailing_suppression_comment(position))
    .then_some(position)
}

/// The same for the `;` of `statement`.
pub(crate) fn start_of_comments_behind_semicolon<'a>(
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> Option<u32> {
    if f.is_quiet() || !comments_in_dropped_parentheses_go_behind_semicolon(f) {
        return None;
    }
    match statement.kind() {
        StmtKind::Expr(e) => start_of_comments_in_dropped_parentheses(e, Some(false), f),
        StmtKind::Var(declarations) => (declarations.last())
            .and_then(VarDecl::init)
            .and_then(|e| start_of_comments_in_dropped_parentheses(e, Some(true), f)),
        // Those in the parentheses around all of it stay there.
        StmtKind::Return(Some(e)) => start_of_comments_in_dropped_parentheses(e, None, f)
            .filter(|&position| position < e.span().end),
        _ => None,
    }
}
