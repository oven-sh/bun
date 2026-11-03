use super::array_element_list::ArrayElementList;
use crate::prelude::*;
use crate::{format_args, write};

/// `[a, b]`
pub(crate) fn write_array_expression<'a>(
    e: Expr<'a>,
    elements: List<'a, Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    let node = AstNodes::ArrayExpression(e);
    write!(f, "[");
    if elements.is_empty() {
        write!(f, dangling_comments(node).with_soft_block_indent());
    } else {
        let group_id = f.group_id("array");
        let has_dangling_line_comment = !f.is_quiet()
            && (f.comments().of_node(node).dangling.iter()).any(|comment| comment.is_line());
        let content = format_args!(
            ArrayElementList::new(elements, group_id),
            dangling_comments(node)
        );
        write!(
            f,
            group(&soft_block_indent(&content))
                .with_group_id(Some(group_id))
                .should_expand(has_dangling_line_comment || should_break(elements))
        );
    }
    write!(f, "]");
}

/// Prettier's `shouldBreak` for an array: there are at least two elements, all are arrays or all are objects, and each
/// has at least two elements.
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
