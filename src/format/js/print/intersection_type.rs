use crate::js::utils::typescript::{is_object_like_type, union_leading_comments};
use crate::prelude::*;
use crate::{format_args, write};

/// `A & B`
pub(crate) fn write_ts_intersection_type<'a>(_ty: TypeNode<'a>, types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    match types.len() {
        1 => write!(f, types.first()),
        _ => write!(f, group(&format_with(|f| format_intersection_types(types, f)))),
    }
}

/// Prettier's `printIntersectionType`: object types stay on the line of the `&`, other types go
/// on a line of their own if it does not all fit.
fn format_intersection_types<'a>(types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    let is_operator_at_start = f.options().experimental_operator_position == OperatorPosition::Start;
    let mut is_prev_object_like = false;
    let mut is_chain_indented = false;

    for (index, item) in types.iter().enumerate() {
        let is_object_like = is_object_like_type(item);
        let content = format_with(|f| {
            // The comments before a union are outside of its parentheses.
            if matches!(item.kind(), TypeKind::Union(members) if members.len() > 1) {
                write!(f, FormatLeadingComments::Comments(union_leading_comments(item, f).0));
            }
            write!(f, item);
        });

        if index == 0 {
            write!(f, content);
        } else if is_prev_object_like && is_object_like {
            match is_chain_indented {
                true => write!(f, [" & ", indent(&content)]),
                false => write!(f, [" & ", content]),
            }
        } else if !(is_prev_object_like || is_object_like) || f.comments().has_leading_own_line_comment(item.span().start)
        {
            match is_operator_at_start {
                true => write!(f, indent(&format_args!(soft_line_break_or_space(), "& ", content))),
                false => write!(f, indent(&format_args!(" &", soft_line_break_or_space(), content))),
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
