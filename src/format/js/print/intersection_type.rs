use crate::js::utils::typescript::{
    has_leading_own_line_comment, is_object_like_type, without_lone_operator,
};
use crate::prelude::*;
use crate::{format_args, write};

/// `A & B`
#[inline(never)]
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
        let has_leading_own_line_comment =
            has_leading_own_line_comment(without_lone_operator(item).as_ast_nodes(), f);

        if index == 0 {
            write!(f, item);
        } else if is_prev_object_like
            && is_object_like
            && !(comment_above_an_object_type_moves_it_off_the_line(f)
                && has_leading_own_line_comment)
        {
            match is_chain_indented {
                true => write!(f, [" & ", indent(&item)]),
                false => write!(f, [" & ", item]),
            }
        } else if !(is_prev_object_like || is_object_like) || has_leading_own_line_comment {
            match is_operator_at_start {
                true => {
                    let comments_above = (own_line_comments_stay_above_operator(f)
                        && has_leading_own_line_comment)
                        .then(|| leading_comments(without_lone_operator(item).as_ast_nodes()));
                    write!(
                        f,
                        indent(&format_args!(
                            soft_line_break_or_space(),
                            comments_above, "& ", item
                        ))
                    )
                }
                false => write!(
                    f,
                    indent(&format_args!(" &", soft_line_break_or_space(), item))
                ),
            }
        } else if index > 1 {
            is_chain_indented = true;
            write!(f, [" & ", indent(&item)]);
        } else {
            write!(f, [" & ", item]);
        }
        is_prev_object_like = is_object_like;
    }
}
