//! Links each node to the last one before it whose first bytes have the same hash.

use crate::window::{
    BATCH, Bytes, FIRST_NODE, GROUP, MAX_OFFSET, MatchFinder, Node, RING, SLIDE, node_count, reach,
    replace, slide_list, slide_table,
};
use crate::{Result, copy_prefix, grow, grow_to_array, wrapped, wrapped_mut};
use core::hint::cold_path;
use core::ops::Range;

#[derive(Default)]
pub(crate) struct Storage {
    heads: Vec<Node>,
    links: Vec<Node>,
}

fn file_first_node(heads: &mut [Node]) {
    copy_prefix(heads, &[FIRST_NODE as Node]);
}

/// Keeps the links of all nodes.
pub(crate) struct HashLists<'a, const PREFIX_LEN: u32, const HEADS: usize> {
    heads: &'a mut [Node; HEADS],
    links: &'a mut [Node],
    /// After how many bytes the data may repeat itself from node `periodic_from` on.
    period: usize,
    periodic_from: usize,
    /// Whether `heads` lacks the last nodes.
    has_repeated: bool,
}

impl<'a, const PREFIX_LEN: u32, const HEADS: usize> HashLists<'a, PREFIX_LEN, HEADS> {
    pub(crate) fn new(storage: &'a mut Storage, input_len: usize) -> Result<Self> {
        storage.heads.clear();
        let heads = grow_to_array(&mut storage.heads)?;
        file_first_node(heads);
        let mut lists = Self {
            heads,
            links: grow(&mut storage.links, node_count(input_len))?,
            period: 0,
            periodic_from: usize::MAX / 2,
            has_repeated: false,
        };
        lists.leave_out(0..FIRST_NODE + 1);
        Ok(lists)
    }

    pub(crate) fn links(&self) -> &[Node] {
        self.links
    }

    pub(crate) fn is_in_run(&self) -> bool {
        self.period == 1
    }

    #[inline(always)]
    pub(crate) fn next(&self, node: usize) -> usize {
        let Some(&next) = self.links.get(node) else {
            cold_path();
            return 0;
        };
        next.into()
    }

    #[inline(always)]
    fn link(&mut self, window: &Bytes, groups: Range<usize>) {
        let (links, _) = self.links.as_chunks_mut();
        let links = links.get_mut(groups.start..groups.end).unwrap_or_default();
        for (index, links) in links.iter_mut().enumerate() {
            replace::<PREFIX_LEN, _>(self.heads, window, groups.start + index, links);
        }
    }

    #[cold]
    fn update_heads(&mut self, window: &Bytes, end: usize) {
        for group in end - self.period.div_ceil(GROUP)..end {
            replace::<PREFIX_LEN, _>(self.heads, window, group, &mut [0; _]);
        }
    }
}

/// Gives `nodes` the links of the nodes `distance` before them, moved up as far.
fn repeat(links: &mut [Node], nodes: Range<usize>, distance: usize) {
    let (old, new) = links.split_at_mut_checked(nodes.start).unwrap_or_default();
    let old = old.get(nodes.start - distance..).unwrap_or_default();
    for (new, old) in new.iter_mut().zip(old).take(nodes.len()) {
        *new = old.wrapping_add(distance as Node);
    }
}

impl<const PREFIX_LEN: u32, const HEADS: usize> MatchFinder for HashLists<'_, PREFIX_LEN, HEADS> {
    #[inline(never)]
    fn insert(&mut self, window: &Bytes, groups: Range<usize>) {
        let nodes = groups.start * GROUP..groups.end * GROUP;
        let hashed = |node| reach(window, node).split_at(BATCH + 3).0;
        let (here, before) = (hashed(nodes.start), hashed(nodes.start - self.period));
        let is_periodic = here.last_chunk::<8>() == before.last_chunk() && here == before;
        // Where the data repeats itself the links do so too, which takes no hashes.
        if is_periodic {
            let distance = BATCH.next_multiple_of(self.period.max(1));
            if nodes.start >= self.periodic_from + distance + self.period {
                repeat(self.links, nodes, distance);
                self.has_repeated = true;
                return;
            }
        }
        if core::mem::take(&mut self.has_repeated) {
            self.update_heads(window, groups.start);
        }
        self.link(window, groups);
        if !is_periodic || self.period == 0 {
            // At another place in aligned records each time, since some have the same bytes nearer by.
            let sample = nodes.end - 1 - nodes.end / BATCH;
            self.period = MAX_OFFSET.min(sample - self.next(sample));
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
pub(crate) struct RecentLinks<'a, const PREFIX_LEN: u32, const HEADS: usize> {
    heads: &'a mut Vec<Node>,
    ring: [[Node; GROUP]; RING / GROUP],
    /// The group after the last in `heads`, or 0 if that has to be cleared first.
    groups_end: usize,
}

impl<'a, const PREFIX_LEN: u32, const HEADS: usize> RecentLinks<'a, PREFIX_LEN, HEADS> {
    pub(crate) fn new(heads: &'a mut Vec<Node>) -> Result<Self> {
        heads.clear();
        heads.try_reserve_exact(HEADS)?;
        Ok(Self {
            heads,
            ring: [[0; _]; _],
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
            // After a slide, no node can match it.
            file_first_node(self.heads);
            self.groups_end = FIRST_NODE / GROUP + 1;
        }
        let Some(heads) = self.heads.first_chunk_mut::<HEADS>() else {
            return;
        };
        for group in self.groups_end.max(groups.start)..groups.end {
            replace::<PREFIX_LEN, _>(heads, window, group, wrapped_mut(&mut self.ring, group));
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
