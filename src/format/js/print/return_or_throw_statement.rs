use super::semicolon::OptionalSemicolon;
use crate::js::utils::typecast::{
    comments_of_outermost_node, has_leading_own_line_comment, is_cast_target,
    is_cast_target_that_hides_its_kind, is_chain_expression_without_comments,
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

#[inline(never)]
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
        let dangling = FormatDanglingComments::Comments {
            comments,
            indent: DanglingIndentMode::None,
        };
        // `throw a // comment⏎;/* comment */`: the second one starts a line, because it follows a line comment.
        let trailing = f.comments().of_node(statement.as_ast_nodes()).trailing;
        let others = trailing.slice(comments.len(), trailing.len());
        write!(
            f,
            [space(), dangling, FormatTrailingComments::Comments(others)]
        );
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
        } else if argument.binary_op() == Some(BinOp::Comma) && is_cast_target(argument, f) {
            // `return (/** @type {T} */ (a, b));`: oxfmt looks at what is in the parentheses of the type cast, and writes the
            // parentheses of a sequence around all of it.
            write!(
                f,
                group(&format_args!("(", soft_block_indent(&argument), ")"))
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

/// `return !(// comment⏎a) && b;`: Prettier finds the comment, because its `getLeftSide` goes into the operand of `!`, and writes
/// parentheses around the argument. oxfmt stops at `!a`.
fn left_edge_goes_on_in_operands(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `return a⏎// comment⏎.b;`: for Prettier the comment leads `a.b`. For oxfmt it leads the name `b`, and counts all the same. Not
/// after `yield`, which only oxfmt asks about.
fn own_line_comment_before_property_counts<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt() && !matches!(argument.ast_parent(), AstNodes::YieldExpression(_))
}

/// See [`own_line_comment_before_property_counts`].
fn has_own_line_comment_before_property<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let ExprKind::Dot { name, .. } = e.kind() else {
        return false;
    };
    let comments = f.comments().of_name(name.span().start).leading;
    comments.iter().any(|comment| {
        comment.has_newline_before()
            && (comment.has_newline_after() || comment.is_multiline_block())
    })
}

/// Prettier's `returnArgumentHasLeadingComment`: whether a leading comment of `argument` ends its line or spans several, or a
/// leading comment of anything down its left edge ends its line.
pub(crate) fn has_argument_leading_comments<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    let is_cast = is_cast_target(argument, f);
    let has_leading_comment = match argument.tag() == ExprTag::Jsx && !is_cast {
        true => has_leading_own_line_comment(argument, f),
        false => (comments_of_outermost_node(argument, f).leading.iter())
            .any(|comment| comment.has_newline_after() || comment.is_multiline_block()),
    };
    if has_leading_comment {
        return true;
    }
    if is_cast || !has_naked_left_side(argument) {
        return false;
    }
    let looks_at_properties = own_line_comment_before_property_counts(argument, f);
    let has_own_line_comment = |e: Expr<'a>| {
        let comments = f.comments().of_node(e.as_chain_element()).leading;
        comments.iter().any(|comment| comment.has_newline_after())
            || (looks_at_properties && has_own_line_comment_before_property(e, f))
    };
    // The member access or the call in a `ChainExpression`.
    if (is_chain_expression_without_comments(argument, f) || looks_at_properties)
        && has_own_line_comment(argument)
    {
        return true;
    }
    let mut current = argument;
    while let Some(left) = left_side(current)
        && (has_naked_left_side(current) || left_edge_goes_on_in_operands(f))
    {
        // Every `ParenthesizedExpression` around it is a step of its own.
        let has_comment_before_parentheses = f.comments().has_type_cast_comments()
            && left.parens().any(|parentheses| {
                let comments = f.comments().of_cast_parens(parentheses.start).leading;
                comments.iter().any(|comment| comment.has_newline_after())
            });
        if has_comment_before_parentheses
            || match left.tag() {
                ExprTag::Jsx => has_leading_own_line_comment(left, f),
                _ => has_own_line_comment(left),
            }
        {
            return true;
        }
        current = left;
    }
    false
}
