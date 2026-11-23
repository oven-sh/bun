//! For each hash a binary tree, sorted by the bytes that follow a position. The most recent position is the root.

use core::cell::Cell;
use core::hint::{black_box, cold_path};

use super::hash::Hasher;
use super::{Attached, Bounds, CACHED_UP_TO, MatchState, Reach, WORD, cells, prefetch};
use crate::bytes::{chunk_at, u64_at, word_in};
use crate::window::{FIRST_INDEX, History, WORD_LEN};

/// The roots of the subtrees with what is smaller, and with what is larger.
pub(super) type Node = [Cell<u32>; 2];

#[derive(Clone, Copy)]
pub(super) struct Nodes<'a> {
    nodes: &'a [Node],
    mask: u32,
}

impl<'a> Nodes<'a> {
    /// The compiler sees their number as `mask + 1`, and that a masked index is below it.
    #[inline(always)]
    pub(super) fn checked(self) -> Option<Self> {
        let nodes = self.nodes.get(..self.mask as usize + 1)?;
        Some(Self { nodes, ..self })
    }

    #[inline(always)]
    pub(super) fn get(self, index: u32) -> Option<&'a Node> {
        self.nodes.get((index & self.mask) as usize)
    }

    /// The last index whose node may have been taken by another one.
    #[inline(always)]
    pub(super) fn overwritten(self, current: u32) -> u32 {
        current.saturating_sub(self.mask)
    }
}

/// The last node on the way down that was smaller than the root, or larger.
#[derive(Clone, Copy)]
struct Side<'a> {
    /// Where the next such node goes.
    slot: &'a Cell<u32>,
    /// Up to which position the bytes of the root are the same as its.
    common: u32,
}

impl<'a> Side<'a> {
    #[inline(always)]
    fn extend(&mut self, index: u32, slot: &'a Cell<u32>, common: u32) -> u32 {
        self.slot.set(index);
        *self = Self { slot, common };
        slot.get()
    }
}

/// Makes a node the root, while going down the tree that it takes over.
pub(super) struct Descent<'a> {
    smaller: Side<'a>,
    larger: Side<'a>,
    /// Up to which position the bytes of the root are the same as those of the next node, at least.
    pub(super) known: u32,
}

impl<'a> Descent<'a> {
    #[inline(always)]
    pub(super) fn new([smaller, larger]: &'a Node, at: u32) -> Self {
        let side = |slot| Side { slot, common: at };
        Self {
            smaller: side(smaller),
            larger: side(larger),
            known: at,
        }
    }

    /// Returns the next index. `node` is that of `index`, or a spare one that leads nowhere.
    #[inline(always)]
    pub(super) fn step(&mut self, index: u32, node: &'a Node, end: u32, is_smaller: bool) -> u32 {
        let [smaller, larger] = node;
        if is_smaller {
            self.known = end.min(self.larger.common);
            self.smaller.extend(index, larger, end)
        } else {
            self.known = end.min(self.smaller.common);
            self.larger.extend(index, smaller, end)
        }
    }

    #[inline(always)]
    pub(super) fn finish(self) {
        self.smaller.slot.set(0);
        self.larger.slot.set(0);
    }
}

/// Where the match of `at` at `index` ends, which is not before `known`, and whether what follows it is smaller there.
#[inline(always)]
pub(super) fn compare<const REACH: Reach>(
    history: &History<'_>,
    at: u32,
    index: u32,
    known: u32,
) -> (u32, bool) {
    match REACH {
        Reach::Older => history.compare_index(known, index.wrapping_add(known - at)),
        _ => history.compare(known, index.wrapping_sub(history.index(at))),
    }
}

/// Like [`Tree::prefetch_after`], for hashes of up to 6 bytes. `word` is at the position before.
#[inline(always)]
pub(super) fn prefetch_attached(
    attached: &Attached<'_>,
    history: &History<'_>,
    hasher: Hasher,
    word: u64,
) {
    if attached.hash.len() <= CACHED_UP_TO {
        return;
    }
    prefetch(attached.hash, hasher.hash(word >> 16));
    if let Some(&root) = attached.hash.get(hasher.hash(word >> 8)) {
        prefetch(history.older, Attached::position(root) as usize);
        prefetch(
            attached.chain,
            (2 * root as usize) & attached.chain.len().wrapping_sub(1),
        );
    }
}

/// The first byte of a dictionary is not searched.
#[inline(always)]
pub(super) fn is_attached_node(index: u32) -> bool {
    index > FIRST_INDEX
}

/// Goes down the tree of a dictionary until `visit`, which gets an index of the history and a length, returns true.
#[inline(always)]
pub(super) fn descend_attached(
    attached: &Attached<'_>,
    history: &History<'_>,
    at: u32,
    root: u32,
    attempts: u32,
    mut visit: impl FnMut(u32, u32) -> bool,
) -> Option<()> {
    let (nodes, _) = attached.chain.as_chunks::<2>();
    let mask = (nodes.len() as u32).wrapping_sub(1);
    let nodes = nodes.get(..mask as usize + 1)?;
    let overwritten = attached.end.saturating_sub(mask).max(FIRST_INDEX);
    let (mut smaller_common, mut larger_common, mut known) = (at, at, at);
    let mut index = root;
    for _ in 0..attempts {
        if !is_attached_node(index) {
            break;
        }
        let distance = Attached::position(index).wrapping_sub(at);
        let (end, is_smaller) = history.compare_older(known, distance);
        if visit(index.wrapping_add(attached.delta), end - at) || index <= overwritten {
            break;
        }
        let &[smaller, larger] = nodes.get((index & mask) as usize)?;
        if is_smaller {
            (smaller_common, known, index) = (end, end.min(larger_common), larger);
        } else {
            (larger_common, known, index) = (end, end.min(smaller_common), smaller);
        }
    }
    Some(())
}

/// Indexes the history up to `end`, which takes long, unless it `is_abandoned` on the way.
pub(super) fn fill(
    state: &mut MatchState,
    history: &History<'_>,
    end: u32,
    is_abandoned: impl Fn() -> bool,
) -> Option<()> {
    let min_match = state.tuning.min_match;
    let mut tree = Tree::new(state, min_match);
    let (mut index, end) = (tree.next_to_index, history.index(end));
    let lowest = tree.bounds.lowest(end);
    while index < end && !is_abandoned() {
        index += tree.insert::<{ Reach::Prefix }>(*history, index, lowest)?;
    }
    Some(())
}

pub(super) struct Tree<'a> {
    pub(super) bounds: Bounds,
    pub(super) roots: &'a mut [u32],
    pub(super) nodes: Nodes<'a>,
    pub(super) hash3: &'a mut [u32],
    pub(super) hasher: Hasher,
    pub(super) attempts: u32,
    pub(super) next_to_index: u32,
}

impl<'a> Tree<'a> {
    pub(super) fn new(state: &'a mut MatchState, min_match: u32) -> Self {
        let (tuning, bounds) = (state.tuning, state.bounds());
        let tables = state.tables.split_mut();
        Self {
            bounds,
            roots: tables.hash,
            nodes: Nodes {
                nodes: cells(tables.chain).as_chunks().0,
                mask: (1 << tuning.cycle_log()) - 1,
            },
            hash3: tables.hash3,
            hasher: Hasher::new(min_match, tuning.hash_log),
            attempts: 1 << tuning.search_log,
            next_to_index: state.next_to_index,
        }
    }

    /// For searches at the next two positions: the root of the second, and what that of the first leads to.
    #[inline(always)]
    pub(super) fn prefetch_after(&self, history: &History<'_>, nodes: Nodes<'_>, at: u32) {
        if self.roots.len() <= CACHED_UP_TO {
            return;
        }
        let Some(words) = chunk_at::<{ WORD_LEN + 1 }>(history.prefix, at + 1) else {
            return;
        };
        prefetch(self.roots, self.hasher.hash(word_in::<1, _>(words)));
        if let Some(&root) = self.roots.get(self.hasher.hash(word_in::<0, _>(words))) {
            let root = root.max(history.prefix_index);
            prefetch(history.prefix, history.position(root) as usize);
            prefetch(nodes.nodes, (root & nodes.mask) as usize);
        }
    }

    /// Returns how many positions that takes care of.
    #[inline(never)]
    fn insert<const REACH: Reach>(
        &mut self,
        history: History<'_>,
        current: u32,
        lowest: u32,
    ) -> Option<u32> {
        let history = &history.with_prefix_of::<WORD_LEN>()?;
        let at = history.position(current);
        let root = self
            .roots
            .get_mut(self.hasher.hash(u64_at(history.prefix, at)?))?;
        let mut index = core::mem::replace(root, current);
        let nodes = self.nodes.checked()?;
        let last = nodes.overwritten(current).max(lowest - 1);
        let spare = Node::default();
        let mut descent = Descent::new(nodes.get(current)?, at);
        // Left in memory, as the registers are better used for the rest.
        let mut rare = [current + WORD + 1, at + WORD, lowest, self.attempts, at];
        black_box(&mut rare);
        let [matched_end, longest_end, lowest, attempts, start] = &mut rare;

        while *attempts > 0 {
            let node = if index > last {
                nodes.get(index)?
            } else {
                cold_path();
                if index < *lowest {
                    break;
                }
                &spare
            };
            let (end, is_smaller) = compare::<REACH>(history, at, index, descent.known);
            if end > *longest_end {
                cold_path();
                *longest_end = end;
                *matched_end = (index + (end - *start)).max(*matched_end);
            }
            // There is no telling which is smaller.
            if end == history.end() {
                break;
            }
            index = descent.step(index, node, end, is_smaller);
            *attempts -= 1;
        }
        descent.finish();

        let skipped = (*longest_end - *start).saturating_sub(384).min(192);
        Some(skipped.max(*matched_end - (current + WORD)))
    }

    #[inline(always)]
    pub(super) fn insert_up_to<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        end: u32,
    ) -> Option<()> {
        let end = history.index(end);
        let lowest = self.bounds.lowest(end);
        let mut index = self.next_to_index;
        while index < end {
            index += self.insert::<REACH>(*history, index, lowest)?;
        }
        self.next_to_index = end;
        Some(())
    }
}
