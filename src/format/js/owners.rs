//! The comments of a file, by what owns them.
//!
//! What [`attach`](super::attach::attach) decides is kept the way a file keeps which expressions are in parentheses: a bit for
//! each node says whether it owns anything, and a list that is sorted by [`Node::index`](bun_lint::ast::Node::index) is only
//! searched if the bit is set. Nearly every node that is asked owns nothing.

use super::ast_nodes::AstNodes;
use super::attach::{Attached, Owner, Placement};
use super::comments::Comment;
use bun_lint::ast::File;
use bun_lint::span::Span;

const LEADING: u8 = Placement::Leading as u8;
const TRAILING: u8 = Placement::Trailing as u8;
/// Stands in for a [`Placement`] in a group that has no comments and only marks the node as ignored
/// (Prettier's `node.prettierIgnore`).
const IGNORED: u8 = 3;

/// The comments that one node has in one place.
#[derive(Copy, Clone)]
struct CommentGroup {
    /// The [`AstKind`](super::ast_nodes::AstKind): several nodes are made of one node of `bun_lint::ast`.
    kind: u8,
    placement: u8,
    first: u32,
    len: u32,
}

#[derive(Copy, Clone)]
struct OwnerEntry {
    /// [`Node::index`](bun_lint::ast::Node::index), or where a name or a `(` is.
    id: u32,
    first_group: u32,
    groups: u32,
}

#[derive(Default)]
pub(crate) struct Owners {
    /// Those of the same owner and placement are next to each other, in the order of the source.
    comments: Vec<Comment>,
    groups: Vec<CommentGroup>,
    /// Each is sorted by `id`.
    nodes: Vec<OwnerEntry>,
    names: Vec<OwnerEntry>,
    cast_parens: Vec<OwnerEntry>,
    /// A bit for each node: it is in `nodes`.
    owner_bitset: Vec<u64>,
    /// Where the nodes start that own a comment which is not next to them or in them. Sorted.
    relocated_owner_starts: Vec<u32>,
}

/// What a node owns.
#[derive(Copy, Clone, Default)]
pub(crate) struct OwnedComments<'a> {
    pub(crate) leading: &'a [Comment],
    pub(crate) trailing: &'a [Comment],
    pub(crate) dangling: &'a [Comment],
    /// Prettier's `hasNodeIgnoreComment`: it is written as it is in the source.
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
        comments: Vec::new(),
        groups: Vec::new(),
        nodes: Vec::new(),
        names: Vec::new(),
        cast_parens: Vec::new(),
        owner_bitset: Vec::new(),
        relocated_owner_starts: Vec::new(),
    };

    /// `comments`: those of `file` in the order of the source, which is the order of `attached`.
    pub(crate) fn new(file: &File<'_>, comments: &[Comment], attached: Attached<'_>) -> Owners {
        let mut sort_keys: Vec<(u64, u32)> =
            Vec::with_capacity(comments.len() + attached.ignored_nodes.len());
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
            comments: Vec::with_capacity(comments.len()),
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
                    first: owners.comments.len() as u32,
                    len: 0,
                });
            }
            previous_key = sort_key;
            if let (Some(comment), Some(group)) =
                (comments.get(index as usize), owners.groups.last_mut())
            {
                owners.comments.push(*comment);
                group.len += 1;
            }
        }
        owners
    }

    fn lookup(&self, entries: &[OwnerEntry], id: u32, kind: u8) -> OwnedComments<'_> {
        let mut owned_comments = OwnedComments::default();
        let Ok(at) = entries.binary_search_by_key(&id, |entry| entry.id) else {
            return owned_comments;
        };
        let Some(entry) = entries.get(at) else {
            return owned_comments;
        };
        let groups = (self
            .groups
            .get(entry.first_group as usize..)
            .unwrap_or_default())
        .iter()
        .take(entry.groups as usize)
        .filter(|group| group.kind == kind);
        for group in groups {
            let comments = (self.comments)
                .get(group.first as usize..(group.first + group.len) as usize)
                .unwrap_or_default();
            match group.placement {
                IGNORED => owned_comments.is_ignored = true,
                LEADING => owned_comments.leading = comments,
                TRAILING => owned_comments.trailing = comments,
                _ => owned_comments.dangling = comments,
            }
            owned_comments.is_ignored |= comments
                .iter()
                .any(|comment| comment.is_active_ignore_comment());
        }
        owned_comments
    }

    #[inline]
    pub(crate) fn of_node(&self, node: AstNodes<'_>) -> OwnedComments<'_> {
        let index = node.raw().index();
        let owns_comments = (self.owner_bitset.get(index as usize / 64))
            .is_some_and(|word| word & (1 << (index % 64)) != 0);
        match owns_comments {
            true => self.lookup(&self.nodes, index, node.kind() as u8),
            false => OwnedComments::default(),
        }
    }

    /// Of the name that starts at `start`.
    #[inline]
    pub(crate) fn of_name(&self, start: u32) -> OwnedComments<'_> {
        match self.names.is_empty() {
            true => OwnedComments::default(),
            false => self.lookup(&self.names, start, 0),
        }
    }

    /// Of the parentheses that open at `open` and follow a type cast comment.
    #[inline]
    pub(crate) fn of_cast_parens(&self, open: u32) -> OwnedComments<'_> {
        match self.cast_parens.is_empty() {
            true => OwnedComments::default(),
            false => self.lookup(&self.cast_parens, open, 0),
        }
    }

    /// Whether something in `span` owns a comment that is somewhere else.
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
