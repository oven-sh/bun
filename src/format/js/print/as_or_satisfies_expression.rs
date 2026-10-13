//! `a as T`, `a as const`, `a satisfies T`

use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::{format_args, write};

/// Prettier 3.9 writes `new (⏎ a as T⏎)()` like `(⏎ a as T⏎)()`. oxfmt follows 3.8, in which only `T`
/// can break.
fn breaks_around_the_callee_of_new(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// For oxfmt the comments around `as` and `satisfies` stay on the side of the operator that they are
/// on, and start a line if they do in the source. Prettier attaches them to the expression or to the
/// type.
fn comments_stay_around_cast_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`comments_stay_around_cast_operator`]. `comments`: those between `expression` and the type.
/// `is_union`: the type is a union, which places the comments before it itself.
fn write_with_comments_in_place<'a>(
    expression: Expr<'a>,
    operation: &'static str,
    comments: &'a [Comment],
    is_union: bool,
    format_type: &dyn Format<'a>,
    f: &mut Formatter<'a>,
) {
    // One that is about the type has to be seen by it: then all are left to the type.
    let has_suppression_comment = comments
        .iter()
        .any(|comment| f.comments().is_suppression_comment(comment));
    let operator = operation.as_bytes().first().copied().unwrap_or_default();
    let before_operator_count = f
        .comments()
        .comments_before_character(expression.span().end, operator)
        .len()
        .min(comments.len());
    let (before_operator, after_operator) = comments.split_at(before_operator_count);
    // No line break can be before the operator: only block comments on the line of the expression stay
    // there. A line comment is written behind the operator anyway.
    let glued_before_count = before_operator
        .iter()
        .take_while(|comment| !comment.preceded_by_newline() && !comment.is_multiline_block())
        .count();
    let (glued_before, moved) = before_operator.split_at(glued_before_count);
    // Those on the line of the operator.
    let glued_after_count = match is_union || !moved.is_empty() {
        true => 0,
        false => after_operator
            .iter()
            .take_while(|comment| {
                !(comment.preceded_by_newline()
                    || (comment.is_multiline_block() && comment.followed_by_newline()))
            })
            .count(),
    };
    let (glued_after, leading) = after_operator.split_at(glued_after_count);
    let is_on_lines_of_its_own = |comment: &Comment| {
        comment.followed_by_newline()
            && (comment.preceded_by_newline() || comment.is_multiline_block())
    };
    let is_type_on_next_line = glued_before
        .iter()
        .chain(glued_after)
        .any(|comment| comment.is_line())
        || (!is_union && moved.iter().chain(leading).any(is_on_lines_of_its_own));

    write!(f, FormatNodeWithoutTrailingComments(&expression));
    if !has_suppression_comment {
        write!(f, FormatTrailingComments::Comments(glued_before));
    }
    write!(f, [space(), operation]);
    if !has_suppression_comment {
        write!(f, FormatTrailingComments::Comments(glued_after));
    }
    match is_type_on_next_line {
        true => write!(f, indent(&format_args!(hard_line_break(), format_type))),
        false => write!(f, [space(), format_type]),
    }
}

pub(crate) fn write_as_or_satisfies_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let (expression, type_annotation, operation) = match e.kind() {
        ExprKind::As { expr, ty } => (expr, Some(ty), "as"),
        ExprKind::AsConst(expr) => (expr, None, "as"),
        ExprKind::Satisfies { expr, ty } => (expr, Some(ty), "satisfies"),
        _ => return,
    };
    let type_start = match type_annotation {
        Some(ty) => ty.span().start,
        None => e
            .const_keyword_span()
            .map_or_else(|| e.span().end, |it| it.start),
    };

    let format_inner = format_with(|f| {
        let format_type = format_with(|f| match type_annotation {
            Some(ty) => write!(f, ty),
            None => write!(f, "const"),
        });
        let comments = match f.is_quiet() {
            true => &[][..],
            false => f
                .comments()
                .comments_in(Span::after(expression.span(), type_start)),
        };
        if !comments.is_empty() && comments_stay_around_cast_operator(f) {
            let is_union = type_annotation.is_some_and(|ty| {
                matches!(ty.kind(), TypeKind::Union(_))
                    && !f.comments().is_suppressed(ty.span().start)
            });
            // `const` is no node that would write the comments before it.
            let format_type = format_with(|f| {
                if type_annotation.is_none() {
                    write!(
                        f,
                        FormatLeadingComments::Comments(f.comments().comments_before(type_start))
                    );
                }
                write!(f, format_type);
            });
            return write_with_comments_in_place(
                expression,
                operation,
                comments,
                is_union,
                &format_type,
                f,
            );
        }
        // Those up to the first that spans several lines.
        let count = comments
            .iter()
            .take_while(|c| !c.is_multiline_block())
            .count();
        let block_comments = comments.get(..count).unwrap_or_default();

        if !comments.is_empty() && type_annotation.is_none() {
            write!(
                f,
                [
                    FormatNodeWithoutTrailingComments(&expression),
                    FormatTrailingComments::Comments(block_comments),
                    space(),
                    operation,
                    space(),
                    "const"
                ]
            );
        } else if block_comments.is_empty() {
            write!(
                f,
                [
                    FormatNodeWithoutTrailingComments(&expression),
                    space(),
                    operation,
                    space(),
                    format_type
                ]
            );
        } else {
            write!(f, [expression, space(), operation]);
            // Prettier's space is text, which is seen before a line comment that trails the expression if
            // the type starts on the next line: `a as  // comment`.
            let is_after_line_comment = f
                .comments()
                .printed_comments()
                .last()
                .is_some_and(|it| it.is_line());
            match is_after_line_comment {
                true => write!(f, [" ", format_type]),
                false => write!(f, [space(), format_type]),
            }
        }
    });

    let parent = e.ast_parent();
    let is_callee_or_object = match parent {
        AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        AstNodes::NewExpression(_) if !breaks_around_the_callee_of_new(f) => false,
        _ => parent.is_call_like_callee(e),
    };
    match is_callee_or_object {
        true => write!(f, group(&soft_block_indent(&format_inner))),
        false => write!(f, format_inner),
    }
}
