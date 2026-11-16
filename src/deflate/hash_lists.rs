//! Links each node to the last one before it whose first bytes have the same hash.

use crate::window::{
    Bytes, FIRST_NODE, GROUP, HASHED_GROUPS, Hashes, MAX_OFFSET, MatchFinder, Node, RING, SLIDE,
    node_count, reach, slide_list, slide_table,
};
use crate::{Result, grow, grow_to_array, wrapped, wrapped_mut};
use core::ops::Range;

const HASHED_NODES: usize = HASHED_GROUPS * GROUP;

#[derive(Default)]
pub(crate) struct Storage {
    heads: Vec<Node>,
    links: Vec<Node>,
}

/// Keeps the links of all nodes.
pub(crate) struct HashLists<'a, const HEADS: usize> {
    heads: &'a mut [Node; HEADS],
    links: &'a mut [Node],
    hashes: Hashes,
    /// After how many bytes the data may repeat itself from node `periodic_from` on.
    period: usize,
    periodic_from: usize,
    /// Whether `heads` lacks the last nodes.
    has_repeated: bool,
}

impl<'a, const HEADS: usize> HashLists<'a, HEADS> {
    pub(crate) fn new(storage: &'a mut Storage, prefix_len: u32, input_len: usize) -> Result<Self> {
        storage.heads.clear();
        Ok(Self {
            heads: grow_to_array(&mut storage.heads)?,
            links: grow(&mut storage.links, node_count(input_len))?,
            hashes: Hashes::new(prefix_len, HEADS.ilog2()),
            period: 0,
            periodic_from: usize::MAX / 2,
            has_repeated: false,
        })
    }

    pub(crate) fn links(&self) -> &[Node] {
        self.links
    }

    pub(crate) fn is_in_run(&self) -> bool {
        self.period == 1
    }

    #[inline(always)]
    pub(crate) fn next(&self, node: usize) -> usize {
        self.links.get(node).map_or(0, |&next| next.into())
    }

    #[inline(always)]
    fn link(&mut self, window: &Bytes, groups: Range<usize>) {
        self.hashes.compute(window, groups.start);
        let (links, _) = self.links.as_chunks_mut();
        let links = links.get_mut(groups.start..groups.end).unwrap_or_default();
        for (index, links) in links.iter_mut().enumerate() {
            self.hashes.replace(self.heads, groups.start + index, links);
        }
    }

    /// Gives `nodes` the links of the nodes `distance` before them, moved up as far.
    fn repeat(&mut self, nodes: Range<usize>, distance: usize) {
        let links = self.links.split_at_mut_checked(nodes.start);
        let (old, new) = links.unwrap_or_default();
        let old = old.get(nodes.start - distance..).unwrap_or_default();
        for (new, old) in new.iter_mut().zip(old).take(nodes.len()) {
            *new = old.wrapping_add(distance as Node);
        }
    }

    #[cold]
    fn update_heads(&mut self, window: &Bytes, end: usize) {
        let start = end - self.period.div_ceil(HASHED_NODES) * HASHED_GROUPS;
        for first in (start..end).step_by(HASHED_GROUPS) {
            self.hashes.compute(window, first);
            for group in first..first + HASHED_GROUPS {
                self.hashes.replace(self.heads, group, &mut [0; _]);
            }
        }
    }
}

impl<const HEADS: usize> MatchFinder for HashLists<'_, HEADS> {
    #[inline(never)]
    fn insert(&mut self, window: &Bytes, groups: Range<usize>) {
        let nodes = groups.start * GROUP..groups.end * GROUP;
        let hashed = |node| reach(window, node).split_at(HASHED_NODES + 3).0;
        let (here, before) = (hashed(nodes.start), hashed(nodes.start - self.period));
        let is_periodic = here.last_chunk::<8>() == before.last_chunk() && here == before;
        // Where the data repeats itself the links do so too, which takes no hashes.
        if is_periodic {
            let distance = HASHED_NODES.next_multiple_of(self.period.max(1));
            if nodes.start >= self.periodic_from + distance + self.period {
                self.repeat(nodes, distance);
                self.has_repeated = true;
                return;
            }
        }
        if core::mem::take(&mut self.has_repeated) {
            self.update_heads(window, groups.start);
        }
        self.link(window, groups);
        if !is_periodic || self.period == 0 {
            self.period = MAX_OFFSET.min(nodes.end - 1 - self.next(nodes.end - 1));
            // The first node is not in the list that its bytes belong in.
            self.periodic_from = (nodes.end - self.period).max(FIRST_NODE + 1);
        }
    }

    fn leave_out(&mut self, nodes: Range<usize>) {
        self.links.get_mut(nodes).unwrap_or_default().fill(0);
    }

    fn slide(&mut self) {
        slide_table(self.heads);
        slide_list::<1>(self.links);
        self.periodic_from = self.periodic_from.saturating_sub(SLIDE);
    }
}

/// Only keeps the links of the last [`RING`] nodes, among which are those that the parser has yet to get to.
pub(crate) struct RecentLinks<'a, const HEADS: usize> {
    heads: &'a mut Vec<Node>,
    ring: [[Node; GROUP]; RING / GROUP],
    hashes: Hashes,
    /// The group after the last in `heads`, or 0 if that has to be cleared first.
    groups_end: usize,
}

impl<'a, const HEADS: usize> RecentLinks<'a, HEADS> {
    pub(crate) fn new(heads: &'a mut Vec<Node>, prefix_len: u32) -> Result<Self> {
        heads.clear();
        heads.try_reserve_exact(HEADS)?;
        Ok(Self {
            heads,
            ring: [[0; _]; _],
            hashes: Hashes::new(prefix_len, HEADS.ilog2()),
            groups_end: 0,
        })
    }

    #[inline(always)]
    pub(crate) fn before(&self, node: usize) -> usize {
        (*wrapped(wrapped(&self.ring, node / GROUP), node)).into()
    }

    /// Skips the groups that it has already.
    #[inline(never)]
    pub(crate) fn insert(&mut self, window: &Bytes, groups: Range<usize>) {
        if self.groups_end == 0 {
            self.heads.clear();
            self.heads.resize(HEADS, 0);
        }
        let Some(heads) = self.heads.first_chunk_mut::<HEADS>() else {
            return;
        };
        let start = self
            .groups_end
            .max(groups.start / HASHED_GROUPS * HASHED_GROUPS);
        for first in (start..groups.end).step_by(HASHED_GROUPS) {
            self.hashes.compute(window, first);
            for group in first..groups.end.min(first + HASHED_GROUPS) {
                let old = wrapped_mut(&mut self.ring, group);
                self.hashes.replace(heads, group, old);
            }
        }
        self.groups_end = groups.end;
    }

    pub(crate) fn slide(&mut self) {
        self.groups_end = self.groups_end.saturating_sub(SLIDE / GROUP);
        if self.groups_end != 0 {
            slide_table(self.heads);
            slide_table(self.ring.as_flattened_mut());
        }
    }
}
