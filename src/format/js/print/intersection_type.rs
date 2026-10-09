use crate::js::utils::typescript::{is_object_like_type, union_leading_comments};
use crate::prelude::*;
use crate::{format_args, write};

/// `A & B`
pub(crate) fn write_ts_intersection_type<'a>(
    ty: TypeNode<'a>,
    types: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::is_interface_type(ty) {
        return super::flow::write_interface_type(types, f);
    }
    match types.len() {
        1 if lone_type_of_intersection_is_a_group(f) => write!(f, group(&types.first())),
        1 => write!(f, types.first()),
        _ => write!(
            f,
            group(&format_with(|f| format_intersection_types(types, f)))
        ),
    }
}

/// `& A` is an intersection for oxfmt, so a group: a block comment behind the `&` that ends its line is on the line of
/// `A` if that fits. For Prettier it is `A`.
pub(crate) fn lone_type_of_intersection_is_a_group(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// With the `&` at the start of the line, oxfmt leaves a comment that is on a line of its own there, above the `&`.
/// Prettier writes it behind the `&`.
fn own_line_comments_stay_above_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// ```ts
/// } & // comment      } &
/// {                     // comment
///                       {
/// ```
///
/// Prettier on the left: two object types are on the line of the `&` whatever is between them. oxfmt on the right.
fn comment_above_an_object_type_moves_it_off_the_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printIntersectionType`: object types stay on the line of the `&`, other types go
/// on a line of their own if it does not all fit.
fn format_intersection_types<'a>(types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    let is_operator_at_start =
        f.options().experimental_operator_position == OperatorPosition::Start;
    let mut is_prev_object_like = false;
    let mut is_chain_indented = false;

    for (index, item) in types.iter().enumerate() {
        let is_object_like = is_object_like_type(item);
        let content = format_with(|f| {
            // The comments before a union are outside of its parentheses.
            // Not if the union is not formatted: then they are written with it.
            if matches!(item.kind(), TypeKind::Union(members) if members.len() > 1) {
                let comments = union_leading_comments(item, f).0;
                let is_suppressed = comments.iter().any(|comment| {
                    f.comments().is_suppression_comment(comment) && !comment.preceded_by_newline()
                });
                if !is_suppressed {
                    write!(f, FormatLeadingComments::Comments(comments));
                }
            }
            write!(f, item);
        });

        if index == 0 {
            write!(f, content);
        } else if is_prev_object_like
            && is_object_like
            && !(comment_above_an_object_type_moves_it_off_the_line(f)
                && f.comments().has_leading_own_line_comment(item.span().start))
        {
            match is_chain_indented {
                true => write!(f, [" & ", indent(&content)]),
                false => write!(f, [" & ", content]),
            }
        } else if !(is_prev_object_like || is_object_like)
            || f.comments().has_leading_own_line_comment(item.span().start)
        {
            match is_operator_at_start {
                true => {
                    let comments_above = (own_line_comments_stay_above_operator(f)
                        && f.comments().has_leading_own_line_comment(item.span().start))
                    .then(|| format_leading_comments(item.span()));
                    write!(
                        f,
                        indent(&format_args!(
                            soft_line_break_or_space(),
                            comments_above, "& ", content
                        ))
                    )
                }
                false => write!(
                    f,
                    indent(&format_args!(" &", soft_line_break_or_space(), content))
                ),
            }
        } else if index > 1 {
            is_chain_indented = true;
            write!(f, [" & ", indent(&content)]);
        } else {
            write!(f, [" & ", content]);
        }
        is_prev_object_like = is_object_like;
    }
}
