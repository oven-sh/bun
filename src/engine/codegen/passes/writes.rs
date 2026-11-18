//! The instructions that write memory, arranged for the question whether any in a part of the function changes a place.

use core::ops::Range;

use super::places::Place;
use crate::analysis::Cfg;
use crate::ir::{Block, Effects, Function, Heap, HeapRange, Table, Value};

const GROUPS: usize = u64::BITS as usize;

#[derive(Clone, Copy, Default)]
struct HeapData {
    /// The bit of its group, if it is written.
    group: u64,
    /// The groups with which it may share memory, once known.
    overlapping: Option<u64>,
}

/// Writes are numbered in the order of the blocks. The heaps that they write form up to 64 groups.
pub(super) struct Writes {
    writes: Vec<Value>,
    /// The number of the first write from each position in the order on.
    first_at: Vec<u32>,
    heaps: Table<Heap, HeapData>,
    groups: Vec<HeapRange>,
    /// A binary tree with the groups of the writes as leaves, and above them their unions. Node `n` has the children
    /// `2 n` and `2 n + 1`.
    tree: Vec<u64>,
}

impl Writes {
    /// Of the blocks that are wanted. `visit` sees their instructions, with the number of the next write.
    pub(super) fn collect(
        function: &Function,
        cfg: &Cfg,
        is_wanted: impl Fn(Block) -> bool,
        mut visit: impl FnMut(Value, Effects, u32),
    ) -> Self {
        let mut writes = Vec::new();
        let mut first_at = Vec::with_capacity(cfg.order().len() + 1);
        let mut heaps = Table::filled(function.heap_count(), HeapData::default());
        let mut written = Vec::new();
        for &block in cfg.order() {
            first_at.push(writes.len() as u32);
            if !is_wanted(block) {
                continue;
            }
            for value in function.instructions(block) {
                let effects = function.effects(value);
                visit(value, effects, writes.len() as u32);
                let heap = effects.writes;
                if heap != Heap::NOTHING {
                    writes.push(value);
                    if core::mem::replace(&mut heaps[heap].group, 1) == 0 {
                        written.push(heap);
                    }
                }
            }
        }
        first_at.push(writes.len() as u32);
        let groups = form_groups(function, written, &mut heaps);
        let leaves = writes.len().next_power_of_two();
        let mut tree = vec![0; 2 * leaves];
        for (leaf, &write) in tree[leaves..].iter_mut().zip(&writes) {
            *leaf = heaps[function.effects(write).writes].group;
        }
        for node in (1..leaves).rev() {
            tree[node] = tree[2 * node] | tree[2 * node + 1];
        }
        Self {
            writes,
            first_at,
            heaps,
            groups,
            tree,
        }
    }

    /// The numbers of the writes in the blocks at these positions.
    #[inline]
    pub(super) fn at_positions(&self, positions: Range<u32>) -> Range<u32> {
        self.first_at[positions.start as usize]..self.first_at[positions.end as usize]
    }

    #[inline]
    pub(super) fn group_of_write(&self, number: u32) -> u64 {
        self.tree[self.tree.len() / 2 + number as usize]
    }

    #[inline]
    pub(super) fn groups_overlapping(&mut self, function: &Function, heap: Heap) -> u64 {
        *self.heaps[heap].overlapping.get_or_insert_with(|| {
            let range = function.heap_range(heap);
            let groups = self.groups.iter().enumerate();
            groups
                .filter(|(_, group)| group.overlaps(range))
                .fold(0, |bits, (bit, _)| bits | 1 << bit)
        })
    }

    fn last_among(&self, numbers: Range<u32>, groups: u64) -> Option<u32> {
        if numbers.is_empty() {
            return None;
        }
        let leaves = self.tree.len() / 2;
        let mut node = leaves + numbers.end as usize - 1;
        while self.tree[node] & groups == 0 {
            node >>= node.trailing_zeros();
            if node == 1 {
                return None;
            }
            node -= 1;
            let last_leaf = ((node + 1) << (leaves.ilog2() - node.ilog2())) - 1;
            if last_leaf < leaves + numbers.start as usize {
                return None;
            }
        }
        while node < leaves {
            node = 2 * node + usize::from(self.tree[2 * node + 1] & groups != 0);
        }
        Some((node - leaves) as u32).filter(|&found| found >= numbers.start)
    }

    /// Whether one of the writes may change what is at the place, in the heaps that overlap `groups`. Without a place,
    /// anything in them. Each write that is looked at takes one from `patience`, and without any the answer is yes.
    pub(super) fn may_change(
        &self,
        function: &Function,
        mut numbers: Range<u32>,
        place: Option<&Place>,
        groups: u64,
        patience: &mut u32,
    ) -> bool {
        while let Some(number) = self.last_among(numbers.clone(), groups) {
            let (Some(place), Some(left)) = (place, patience.checked_sub(1)) else {
                return true;
            };
            *patience = left;
            let write = self.writes[number as usize];
            let is_harmless = !function.effects(write).writes_memory()
                || Place::of(function, write)
                    .is_some_and(|written| written.is_apart_from(function, place));
            if !is_harmless {
                return true;
            }
            numbers.end = number;
        }
        false
    }
}

/// If there are too many heaps, neighbours share a group. Those that include others do so among themselves.
fn form_groups(
    function: &Function,
    mut written: Vec<Heap>,
    heaps: &mut Table<Heap, HeapData>,
) -> Vec<HeapRange> {
    const GROUPS_OF_WIDE_HEAPS: usize = 8;
    let mut groups = Vec::new();
    let mut divide = |members: &[Heap], most: usize| {
        for together in members.chunks(members.len().div_ceil(most).max(1)) {
            let mut hull = HeapRange::EMPTY;
            for &heap in together {
                heaps[heap].group = 1 << groups.len();
                hull = hull.hull(function.heap_range(heap));
            }
            groups.push(hull);
        }
    };
    if written.len() <= GROUPS {
        divide(&written, GROUPS);
        return groups;
    }
    written.sort_unstable_by_key(|&heap| {
        let range = function.heap_range(heap);
        (range.start, !range.end)
    });
    let (mut wide, mut narrow) = (Vec::new(), Vec::new());
    for (position, &heap) in written.iter().enumerate() {
        let next = written.get(position + 1);
        if next.is_some_and(|&next| function.may_alias(heap, next)) {
            wide.push(heap);
        } else {
            narrow.push(heap);
        }
    }
    divide(&wide, GROUPS_OF_WIDE_HEAPS);
    divide(&narrow, GROUPS - GROUPS_OF_WIDE_HEAPS);
    groups
}
