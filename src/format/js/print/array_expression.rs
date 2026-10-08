use super::array_element_list::ArrayElementList;
use crate::prelude::*;
use crate::{format_args, write};

/// `[a, b]`
pub(crate) fn write_array_expression<'a>(
    e: Expr<'a>,
    elements: List<'a, Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, "[");
    if elements.is_empty() {
        write!(
            f,
            format_dangling_comments(e.span()).with_soft_block_indent()
        );
    } else {
        let group_id = f.group_id("array");
        // `[, , /* comment */]`: there is no element that the comment could belong to.
        let has_line_comment = !f.is_quiet()
            && elements.iter().all(Expr::is_missing)
            && f.comments()
                .comments_in(e.span())
                .iter()
                .any(|comment| comment.is_line());
        // Where the comma ends that follows the last element that is no hole, if holes follow it.
        let holes_start = (!f.is_quiet()
            && comments_stay_behind_holes(f)
            && elements.last().is_some_and(Expr::is_missing))
        .then(|| elements.iter().rev().find(|it| !it.is_missing()))
        .flatten()
        .map(|last| f.comments().position_after_character(last.span().end, b','));
        let list = format_with(|f| {
            let previous_limit =
                holes_start.map(|start| f.comments_mut().limit_comments_up_to(start));
            write!(f, ArrayElementList::new(e, elements, group_id));
            if let Some(previous_limit) = previous_limit {
                f.comments_mut().restore_view_limit(previous_limit);
            }
        });
        let content = format_args!(list, format_dangling_comments(e.span()));
        write!(
            f,
            group(&soft_block_indent(&content))
                .with_group_id(Some(group_id))
                .should_expand(has_line_comment || should_break(elements))
        );
    }
    write!(f, "]");
}

/// `[1, , /* comment */]`: Prettier attaches the comment to the `1`. oxfmt leaves it where it is.
fn comments_stay_behind_holes(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isConciselyPrintedArray`'s opposite `shouldBreak`: there are at least two elements,
/// all are arrays or all are objects, and each has at least two elements.
fn should_break<'a>(elements: List<'a, Expr<'a>>) -> bool {
    if elements.len() < 2 {
        return false;
    }
    let mut elements = elements.iter().peekable();
    while let Some(element) = elements.next() {
        let next = elements.peek().map(|next| next.kind());
        let is_uniform = match element.kind() {
            ExprKind::Array(inner) => {
                inner.len() >= 2 && matches!(next, None | Some(ExprKind::Array(_)))
            }
            ExprKind::Object(props) => {
                props.len() >= 2 && matches!(next, None | Some(ExprKind::Object(_)))
            }
            _ => false,
        };
        if !is_uniform {
            return false;
        }
    }
    true
}
