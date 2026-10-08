use super::array_element_list::ArrayElementList;
use crate::prelude::*;
use crate::write;

/// `[a, b]`
pub(crate) fn write_array_expression<'a>(e: Expr<'a>, elements: List<'a, Expr<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(f, format_dangling_comments(e.span()).with_block_indent());
    } else {
        let group_id = f.group_id("array");
        write!(
            f,
            group(&soft_block_indent(&ArrayElementList::new(e, elements, group_id)))
                .with_group_id(Some(group_id))
                .should_expand(should_break(elements))
        );
    }
    write!(f, "]");
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
            ExprKind::Array(inner) => inner.len() >= 2 && matches!(next, None | Some(ExprKind::Array(_))),
            ExprKind::Object(props) => props.len() >= 2 && matches!(next, None | Some(ExprKind::Object(_))),
            _ => false,
        };
        if !is_uniform {
            return false;
        }
    }
    true
}
