//! Which node a comment belongs to: Prettier's `attachComments` (`src/main/comments/attach.js`),
//! which has no special cases for GraphQL.

use super::parser::{NodeId, Tree};
use crate::text::has_newline_backwards;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Placement {
    Leading,
    Trailing,
    /// In a node that has nothing else in it.
    Dangling,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attached {
    pub(crate) node: NodeId,
    /// The index in `Tree::comments`.
    pub(crate) comment: u32,
    pub(crate) placement: Placement,
}

/// Fills `attached`, which is sorted by node, and by position for the same node.
pub(crate) fn attach(text: &[u8], tree: &Tree, attached: &mut Vec<Attached>) {
    attached.clear();
    for (index, comment) in tree.comments.iter().enumerate() {
        // Prettier's `decorateComment`: the innermost node that the comment is in, and its
        // children before and after the comment.
        let mut enclosing = tree.root();
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
    attached.sort_by_key(|it| (it.node, it.comment));
}
