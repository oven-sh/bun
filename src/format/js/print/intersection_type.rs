use crate::js::parentheses::ts_type::needs_parentheses;
use crate::js::utils::typescript::is_object_like_type;
use crate::prelude::*;
use crate::write;

/// `A & B`
pub(crate) fn write_ts_intersection_type<'a>(_ty: TypeNode<'a>, types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    write!(f, group(&format_with(|f| format_intersection_types(types, f))));
}

/// Prettier's `printIntersectionType`: object types stay on the line of the `&`, other types go
/// on a line of their own if it does not all fit.
fn format_intersection_types<'a>(types: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    let last_index = types.len().saturating_sub(1);
    let mut is_prev_object_like = false;
    let mut is_chain_indented = false;

    for (index, item) in types.iter().enumerate() {
        let is_object_like = is_object_like_type(item);

        if index == 0 {
            write!(f, item);
        } else if !(is_prev_object_like || is_object_like) || f.comments().has_leading_own_line_comment(item.span().start)
        {
            let content = format_with(|f| {
                if needs_parentheses(item, f) {
                    write!(f, format_leading_comments(item.span()));
                }
                write!(f, item);
            });
            write!(f, soft_line_indent_or_space(&content));
        } else {
            write!(f, space());
            if !is_prev_object_like || !is_object_like {
                is_chain_indented = index > 1;
            }
            match is_chain_indented {
                true => write!(f, indent(&item)),
                false => write!(f, item),
            }
        }

        if index < last_index {
            write!(f, [space(), "&"]);
        }
        is_prev_object_like = is_object_like;
    }
}
