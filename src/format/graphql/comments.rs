//! Decides which node a comment belongs to: Prettier's `attachComments` (`src/main/comments/attach.js`), which has no
//! special cases for GraphQL.

use super::parser::{NodeId, Tree};
use crate::text::has_newline_backwards;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Placement {
    Leading,
    Trailing,
    /// Inside a node that has no children.
    Dangling,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attached {
    pub(crate) node: NodeId,
    /// The index in `Tree::comments`.
    pub(crate) comment: u32,
    pub(crate) placement: Placement,
}

/// Fills `attached`, sorted by node and then by position.
pub(crate) fn attach(text: &[u8], tree: &Tree, attached: &mut Vec<Attached>) {
    attached.clear();
    // The nodes that contain the previous comment, outermost first. Comments are in source order, so the search for the
    // next one starts at the innermost of these nodes that contains it, not at the root.
    let mut path = vec![tree.root()];
    for (index, comment) in tree.comments.iter().enumerate() {
        while let [_, .., last] = path[..]
            && !(tree.span(last).start <= comment.start && comment.end <= tree.span(last).end)
        {
            path.pop();
        }
        // Prettier's `decorateComment`: finds the innermost node that contains the comment, and that node's children
        // right before and after the comment.
        let mut enclosing = path.last().copied().unwrap_or_else(|| tree.root());
        let (mut preceding, mut following);
        'descend: loop {
            (preceding, following) = (None, None);
            let children = tree.children(enclosing);
            let (mut left, mut right) = (0, children.len());
            while left < right {
                let middle = left + (right - left) / 2;
                let Some(&child) = children.get(middle) else {
                    break;
                };
                let span = tree.span(child);
                if span.start <= comment.start && comment.end <= span.end {
                    enclosing = child;
                    path.push(child);
                    continue 'descend;
                }
                if span.end <= comment.start {
                    preceding = Some(child);
                    left = middle + 1;
                } else {
                    following = Some(child);
                    right = middle;
                }
            }
            break;
        }

        let leading = following.map(|node| (node, Placement::Leading));
        let trailing = preceding.map(|node| (node, Placement::Trailing));
        let (node, placement) = match has_newline_backwards(text, comment.start as usize) {
            true => leading.or(trailing),
            false => trailing.or(leading),
        }
        .unwrap_or((enclosing, Placement::Dangling));
        attached.push(Attached {
            node,
            comment: index as u32,
            placement,
        });
    }
    crate::sort::sort_by_key(&mut attached[..], |it| (it.node, it.comment));
}
