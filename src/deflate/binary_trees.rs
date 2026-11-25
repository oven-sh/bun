//! Finds matches of 3 bytes at the last two nodes with the same 3-byte hash, and longer ones in a search tree per 4-byte hash.

use crate::format::MAX_MATCH_LEN;
use crate::hash_lists::{self, HashLists, RecentLinks};
use crate::window::{
    Bytes, MatchFinder, Node, UNINDEXED, match_len, node_count, oldest_for, reach, slide_list,
    u32_at, u64_at,
};
use crate::{Result, grow};
use core::cell::Cell;
use core::ops::Range;

#[derive(Default)]
pub(crate) struct Storage {
    lists3: hash_lists::Storage,
    roots: Vec<Node>,
    children: Vec<Node>,
}

pub(crate) struct BinaryTrees<'a> {
    lists3: HashLists<'a, 3, { 1 << 16 }>,
    roots: RecentLinks<'a, 4, { 1 << 16 }>,
    /// The lesser and the greater child of each node.
    children: &'a mut [Node],
}

impl<'a> BinaryTrees<'a> {
    pub(crate) fn new(storage: &'a mut Storage, input_len: usize) -> Result<Self> {
        Ok(Self {
            lists3: HashLists::new(&mut storage.lists3, input_len)?,
            roots: RecentLinks::new(&mut storage.roots)?,
            children: grow(&mut storage.children, 2 * node_count(input_len))?,
        })
    }

    /// Makes `node` the root of its tree and reports ever longer matches. Returns whether one had `nice_len`.
    #[inline(always)]
    pub(crate) fn find_matches(
        &mut self,
        window: &Bytes,
        node: usize,
        max_len: usize,
        nice_len: usize,
        depth: usize,
        mut report: impl FnMut(usize, usize),
    ) -> bool {
        let (prefix, oldest) = (u32_at(reach(window, node), 0), oldest_for(node));
        let near = self.lists3.next(node);
        for candidate in [near, self.lists3.next(near)] {
            if (u32_at(window, candidate) ^ prefix) << 8 == 0 {
                if candidate >= oldest {
                    report(3, node - candidate);
                }
                break;
            }
        }
        self.reroot(window, node, max_len, nice_len, depth, report)
    }

    /// Makes each of `nodes` the root of its tree. They are covered by a match at `offset`.
    #[inline(never)]
    pub(crate) fn skip(
        &mut self,
        window: &Bytes,
        nodes: Range<usize>,
        offset: usize,
        input_end: usize,
        nice_len: usize,
        depth: usize,
    ) {
        let mut match_end = nodes.end;
        for node in nodes {
            let nice_len = nice_len.min(input_end - node);
            let root = self.roots.before(node);
            if root + offset == node {
                let (here, there) = (reach(window, node), reach(window, root));
                let len = match_len(here, there, match_end - node, nice_len);
                match_end = match_end.max(node + len);
                let (children, _) = self.children.as_chunks_mut::<2>();
                if len == nice_len
                    && let Ok([from, to]) = children.get_disjoint_mut([root, node])
                {
                    *to = *from;
                    continue;
                }
            }
            self.reroot(window, node, nice_len, nice_len, depth, |_, _| {});
        }
    }

    #[inline(always)]
    fn reroot(
        &mut self,
        window: &Bytes,
        node: usize,
        max_len: usize,
        nice_len: usize,
        mut depth: usize,
        mut report: impl FnMut(usize, usize),
    ) -> bool {
        let max_len = max_len.min(MAX_MATCH_LEN);
        if max_len <= UNINDEXED {
            return false;
        }
        let children = Cell::from_mut(&mut *self.children).as_slice_of_cells();
        let (children, _) = children.as_chunks::<2>();
        // Where the next node that is less goes, and the next that is greater.
        let Some([less, greater]) = children.get(node) else {
            return false;
        };
        let (mut less, mut greater) = (less, greater);
        // How much all that is left of the tree has in common with `here`.
        let (mut less_len, mut greater_len, mut len) = (0, 0, 0);
        let (here, oldest) = (reach(window, node), oldest_for(node));
        let mut candidate = self.roots.before(node);
        let mut best_len = 3;
        while candidate >= oldest
            && let Some([left, right]) = children.get(candidate)
        {
            let bytes = reach(window, candidate);
            // A no-op that spares bounds checks.
            len %= 512;
            let (ours, theirs) = loop {
                let (ours, theirs) = (u64_at(here, len), u64_at(bytes, len));
                if ours != theirs {
                    len += (ours ^ theirs).trailing_zeros() as usize / 8;
                    break (ours, theirs);
                }
                len += 8;
                if len >= max_len {
                    break (0, 0);
                }
            };
            if len > best_len {
                len = len.min(max_len);
                best_len = len;
                report(len, node - candidate);
                if len >= nice_len.min(max_len) {
                    less.set(left.get());
                    greater.set(right.get());
                    return true;
                }
            }
            if theirs.swap_bytes() < ours.swap_bytes() {
                less.set(candidate as Node);
                (less, less_len) = (right, len);
                candidate = right.get().into();
            } else {
                // Not cold, but as a conditional move the next loads would wait for the comparison.
                core::hint::cold_path();
                greater.set(candidate as Node);
                (greater, greater_len) = (left, len);
                candidate = left.get().into();
            }
            len = less_len.min(greater_len);
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        less.set(0);
        greater.set(0);
        false
    }
}

impl MatchFinder for BinaryTrees<'_> {
    fn insert(&mut self, window: &Bytes, groups: Range<usize>) {
        self.lists3.insert(window, groups.start..groups.end);
        self.roots.insert(window, groups);
    }

    fn leave_out(&mut self, nodes: Range<usize>) {
        self.lists3.leave_out(nodes);
    }

    fn slide(&mut self) {
        self.lists3.slide();
        self.roots.slide();
        slide_list::<2>(self.children);
    }
}
