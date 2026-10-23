//! The lookup table from a node to the ids of the comments attached to it.
//!
//! Almost every node that's looked up has no comments, so a bitset has one bit per node that tells whether it has any.
//! Only if the bit is set do we search a list sorted by [`Node::index`](bun_lint::ast::Node::index). The HIR stores
//! which expressions are parenthesized the same way.

use super::ast_nodes::AstNodes;
use super::attach::{Attached, Owner, Placement};
use bun_lint::ast::{File, Node};
use bun_lint::span::Span;

const LEADING: u8 = Placement::Leading as u8;
const TRAILING: u8 = Placement::Trailing as u8;
/// Used instead of a [`Placement`] for a group that has no comments and only marks the node as ignored (Prettier's
/// `node.prettierIgnore`).
const IGNORED: u8 = 3;

/// The comments of one node with one placement.
#[derive(Copy, Clone)]
struct CommentGroup {
    /// The [`AstKind`](super::ast_nodes::AstKind) of the node. Several `AstNodes` can share one node of
    /// `bun_lint::ast`.
    kind: u8,
    placement: u8,
    /// One of the comments is a `prettier-ignore` comment that applies to the node.
    ignores_owner: bool,
    /// A range of `Owners::comment_ids`.
    first: u32,
    len: u32,
}

#[derive(Copy, Clone)]
struct OwnerEntry {
    /// [`Node::index`](bun_lint::ast::Node::index), or the start offset of a name or a `(`.
    id: u32,
    first_group: u32,
    groups: u32,
}

#[derive(Default)]
pub(crate) struct Owners {
    /// Grouped by owner and placement, and in source order within a group.
    comment_ids: Vec<u32>,
    groups: Vec<CommentGroup>,
    /// Each is sorted by `id`.
    nodes: Vec<OwnerEntry>,
    names: Vec<OwnerEntry>,
    cast_parens: Vec<OwnerEntry>,
    /// One bit per node, indexed by `Node::index`. Set if the node is in `nodes`.
    owner_bitset: Vec<u64>,
    /// Sorted start offsets of the owners that aren't next to their comment.
    relocated_owner_starts: Vec<u32>,
}

/// The ids of the comments attached to one node.
#[derive(Copy, Clone, Default)]
pub(crate) struct OwnedIds<'a> {
    pub(crate) leading: &'a [u32],
    pub(crate) trailing: &'a [u32],
    pub(crate) dangling: &'a [u32],
    pub(crate) is_ignored: bool,
}

fn sort_key(owner: Owner<'_>, placement: u8) -> u64 {
    let (owner_class, id, kind) = match owner {
        Owner::Node(node) => (0, node.raw().index(), node.kind() as u8),
        Owner::Name(start) => (1, start, 0),
        Owner::CastParens(_, open) => (2, open, 0),
    };
    (owner_class << 48) | (u64::from(id) << 16) | (u64::from(kind) << 8) | u64::from(placement)
}

impl Owners {
    pub(crate) const EMPTY: Owners = Owners {
        comment_ids: Vec::new(),
        groups: Vec::new(),
        nodes: Vec::new(),
        names: Vec::new(),
        cast_parens: Vec::new(),
        owner_bitset: Vec::new(),
        relocated_owner_starts: Vec::new(),
    };

    pub(crate) fn new(file: &File<'_>, attached: Attached<'_>) -> Owners {
        let mut sort_keys: Vec<(u64, u32)> =
            Vec::with_capacity(attached.attachments.len() + attached.ignored_nodes.len());
        for (index, attachment) in attached.attachments.iter().enumerate() {
            sort_keys.push((
                sort_key(attachment.owner, attachment.placement as u8),
                index as u32,
            ));
        }
        for owner in &attached.ignored_nodes {
            sort_keys.push((sort_key(*owner, IGNORED), u32::MAX));
        }
        if !sort_keys.is_sorted() {
            crate::sort::sort(&mut sort_keys);
        }
        let mut owners = Owners {
            comment_ids: Vec::with_capacity(attached.attachments.len()),
            owner_bitset: vec![0; file.node_count() as usize / 64 + 1],
            relocated_owner_starts: attached.relocated_owner_starts,
            ..Owners::default()
        };
        let mut previous_key = u64::MAX;
        for (sort_key, index) in sort_keys {
            let (owner_class, id) = (sort_key >> 48, (sort_key >> 16) as u32);
            if sort_key >> 16 != previous_key >> 16 || previous_key == u64::MAX {
                let entry = OwnerEntry {
                    id,
                    first_group: owners.groups.len() as u32,
                    groups: 0,
                };
                match owner_class {
                    0 => {
                        owners.nodes.push(entry);
                        if let Some(word) = owners.owner_bitset.get_mut(id as usize / 64) {
                            *word |= 1 << (id % 64);
                        }
                    }
                    1 => owners.names.push(entry),
                    _ => owners.cast_parens.push(entry),
                }
            }
            let entries = match owner_class {
                0 => &mut owners.nodes,
                1 => &mut owners.names,
                _ => &mut owners.cast_parens,
            };
            if sort_key != previous_key
                && let Some(entry) = entries.last_mut()
            {
                entry.groups += 1;
                owners.groups.push(CommentGroup {
                    kind: (sort_key >> 8) as u8,
                    placement: sort_key as u8,
                    ignores_owner: false,
                    first: owners.comment_ids.len() as u32,
                    len: 0,
                });
            }
            previous_key = sort_key;
            if let (Some(attachment), Some(group)) = (
                attached.attachments.get(index as usize),
                owners.groups.last_mut(),
            ) {
                owners.comment_ids.push(index);
                group.len += 1;
                group.ignores_owner |= attachment.ignores_owner;
            }
        }
        owners
    }

    fn lookup(&self, entries: &[OwnerEntry], id: u32, kind: u8) -> OwnedIds<'_> {
        let mut owned = OwnedIds::default();
        let Ok(at) = entries.binary_search_by_key(&id, |entry| entry.id) else {
            return owned;
        };
        let Some(entry) = entries.get(at) else {
            return owned;
        };
        let groups = (self
            .groups
            .get(entry.first_group as usize..)
            .unwrap_or_default())
        .iter()
        .take(entry.groups as usize)
        .filter(|group| group.kind == kind);
        for group in groups {
            let ids = (self.comment_ids)
                .get(group.first as usize..(group.first + group.len) as usize)
                .unwrap_or_default();
            match group.placement {
                IGNORED => owned.is_ignored = true,
                LEADING => owned.leading = ids,
                TRAILING => owned.trailing = ids,
                _ => owned.dangling = ids,
            }
            owned.is_ignored |= group.ignores_owner;
        }
        owned
    }

    #[inline]
    pub(crate) fn of_node(&self, node: AstNodes<'_>) -> OwnedIds<'_> {
        let raw = node.raw();
        match self.is_owner(raw) {
            true => self.lookup(&self.nodes, raw.index(), node.kind() as u8),
            false => OwnedIds::default(),
        }
    }

    /// True if one of the `AstNodes` backed by `raw` owns a comment or is ignored.
    #[inline]
    pub(crate) fn is_owner(&self, raw: Node<'_>) -> bool {
        let index = raw.index();
        (self.owner_bitset.get(index as usize / 64))
            .is_some_and(|word| word & (1 << (index % 64)) != 0)
    }

    #[inline]
    pub(crate) fn of_name(&self, start: u32) -> OwnedIds<'_> {
        match self.names.is_empty() {
            true => OwnedIds::default(),
            false => self.lookup(&self.names, start, 0),
        }
    }

    #[inline]
    pub(crate) fn of_cast_parens(&self, open: u32) -> OwnedIds<'_> {
        match self.cast_parens.is_empty() {
            true => OwnedIds::default(),
            false => self.lookup(&self.cast_parens, open, 0),
        }
    }

    /// True if a node that starts inside `span` owns a comment that isn't next to it.
    #[inline]
    pub(crate) fn has_relocated_owner_in(&self, span: Span) -> bool {
        !self.relocated_owner_starts.is_empty() && {
            let at = self
                .relocated_owner_starts
                .partition_point(|start| *start < span.start);
            self.relocated_owner_starts
                .get(at)
                .is_some_and(|start| *start < span.end)
        }
    }
}
