use super::semicolon::OptionalSemicolon;
use crate::js::utils::typecast::{
    has_leading_own_line_comment, is_cast_target, is_cast_target_that_hides_its_kind,
    is_chain_expression_without_comments, leading_comments_of_expression,
};
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_return_statement<'a>(
    statement: Stmt<'a>,
    argument: Option<Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    write_return_or_throw("return", statement, argument, f);
}

pub(crate) fn write_throw_statement<'a>(
    statement: Stmt<'a>,
    argument: Expr<'a>,
    f: &mut Formatter<'a>,
) {
    write_return_or_throw("throw", statement, Some(argument), f);
}

fn write_return_or_throw<'a>(
    keyword: &'static str,
    statement: Stmt<'a>,
    argument: Option<Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, keyword);
    if let Some(argument) = argument {
        write!(f, [space(), FormatAdjacentArgument(argument)]);
    }
    write!(f, OptionalSemicolon);
    let comments = comments_that_count_for_the_width(statement, f);
    if !comments.is_empty() {
        let comments = FormatDanglingComments::Comments {
            comments,
            indent: DanglingIndentMode::None,
        };
        write!(f, [space(), comments]);
    }
}

/// `return a // comment⏎;`: the `;` is on a later line, so the comment is in the statement. oxfmt writes it behind the
/// `;` as ordinary text, which has to fit on the line. Prettier writes it like any other trailing comment of the statement.
fn comments_that_count_for_the_width<'a>(
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    if !f.options().flavor.is_oxfmt() || f.is_quiet() {
        return CommentList::empty();
    }
    let comments = f.comments().of_node(statement.as_ast_nodes()).trailing;
    let count = (comments.iter())
        .take_while(|comment| {
            comment.span().end <= statement.span().end && !comment.has_newline_before()
        })
        .count();
    comments.slice(0, count)
}

/// The argument of `return` or `throw`, which has to start on the line of the keyword. If it breaks, or starts with a
/// comment, it is written in parentheses. Prettier's `printArgumentNode`.
struct FormatAdjacentArgument<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatAdjacentArgument<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let argument = self.0;
        let is_binaryish =
            matches!(argument.kind(), ExprKind::Binary { op, .. } if op != BinOp::Comma);
        if !f.is_quiet() && has_argument_leading_comments(argument, f) {
            write!(f, ["(", block_indent(&argument), ")"]);
        } else if is_cast_target_that_hides_its_kind(argument, f) {
            // For Prettier it is a `ParenthesizedExpression`, whatever is in it.
            write!(f, argument);
        } else if is_binaryish
            || (f.options().experimental_ternaries
                && matches!(argument.kind(), ExprKind::Cond { yes, no, .. }
                    if matches!(yes.kind(), ExprKind::Cond { .. }) || matches!(no.kind(), ExprKind::Cond { .. })))
        {
            write!(
                f,
                group(&format_args!(
                    if_group_breaks(&"("),
                    soft_block_indent(&argument),
                    if_group_breaks(&")")
                ))
            );
        } else {
            write!(f, argument);
        }
    }
}

/// Prettier's `hasNakedLeftSide`.
fn has_naked_left_side(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Assign { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Call(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::NonNull(_)
        | ExprKind::Satisfies { .. } => true,
        ExprKind::As { .. } | ExprKind::AsConst(_) => !e.is_angle_bracket_assertion(),
        ExprKind::Unary { op, .. } => matches!(op, UnOp::PostInc | UnOp::PostDec),
        _ => false,
    }
}

/// Prettier's `getLeftSide`. It takes the first of a few properties that the node has, so it also goes into the operand of
/// `!a`, `await a` and `<T>a`, the callee of `new A()` and the first `${}` of a template.
fn left_side(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => e.sequence().first().copied(),
        ExprKind::Template(template) => template.exprs().first(),
        ExprKind::Binary { left, .. } => Some(left),
        ExprKind::Assign { target, .. } => Some(target),
        ExprKind::Cond { test, .. } => Some(test),
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
            Some(call.callee())
        }
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        ExprKind::Unary { operand, .. } | ExprKind::Await(operand) | ExprKind::Spread(operand) => {
            Some(operand)
        }
        ExprKind::Yield { value, .. } => value,
        ExprKind::NonNull(expr)
        | ExprKind::As { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::Instantiation { expr, .. } => Some(expr),
        _ => None,
    }
}

/// Prettier's `returnArgumentHasLeadingComment`: whether a leading comment of `argument` ends its line or spans several, or a
/// leading comment of anything down its left edge ends its line.
pub(crate) fn has_argument_leading_comments<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    let is_cast = is_cast_target(argument, f);
    if has_leading_own_line_comment(argument, f)
        || ((argument.tag() != ExprTag::Jsx || is_cast)
            && (leading_comments_of_expression(argument, f).iter())
                .any(|comment| comment.is_multiline_block()))
    {
        return true;
    }
    if is_cast || !has_naked_left_side(argument) {
        return false;
    }
    // `yield a⏎// comment⏎.b()`: the comment leads `a.b`. After `yield`, which only oxfmt asks about, it does not count.
    let is_after_yield = matches!(argument.ast_parent(), AstNodes::YieldExpression(_));
    let ends_its_line = |comment: Comment<'_>| {
        comment.has_newline_after()
            && !(is_after_yield && comment.span().start > argument.span().start)
    };
    // The member access or the call in a `ChainExpression`.
    if is_chain_expression_without_comments(argument, f)
        && (f
            .comments()
            .of_node(argument.as_chain_element())
            .leading
            .iter())
        .any(ends_its_line)
    {
        return true;
    }
    let mut current = argument;
    while let Some(left) = left_side(current) {
        // Every `ParenthesizedExpression` around it is a step of its own.
        let has_comment_before_parentheses = f.comments().has_type_cast_comments()
            && left.parens().any(|parentheses| {
                let comments = f.comments().of_cast_parens(parentheses.start);
                comments.leading.iter().any(ends_its_line)
            });
        if has_comment_before_parentheses
            || match left.tag() {
                ExprTag::Jsx => has_leading_own_line_comment(left, f),
                _ => (f.comments().of_node(left.as_chain_element()).leading.iter())
                    .any(ends_its_line),
            }
        {
            return true;
        }
        current = left;
    }
    false
}
