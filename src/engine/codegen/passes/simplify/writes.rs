//! What may have been written on the way from one point of the walk to a later one that it dominates.

use crate::analysis::{Cfg, Dominators, Loop};
use crate::ir::{Block, Function, Heap, HeapRange, Table};

/// A set of groups of heaps that are written.
type Groups = u64;

#[derive(Clone, Copy, Default)]
struct HeapData {
    group: Groups,
    overlapping: Option<Groups>,
}

#[derive(Clone, Copy, Default)]
struct BlockData {
    /// In the block and those that it dominates.
    below: Groups,
    /// In the subtrees of the children that the walk has entered.
    passed: Groups,
    log_end: u32,
}

#[derive(Default)]
pub(super) struct Writes {
    heaps: Table<Heap, HeapData>,
    groups: Vec<HeapRange>,
    blocks: Table<Block, BlockData>,
    loops: Table<Loop, Groups>,
    expected: Groups,
    /// From the root of the tree of dominators down to the current point.
    log: Vec<Groups>,
    /// The last time that was handed out.
    marked: u32,
}

impl Writes {
    pub(super) fn reset(&mut self, function: &Function, cfg: &Cfg) {
        self.heaps
            .refill(function.heap_count(), HeapData::default());
        self.groups.clear();
        self.blocks
            .refill(function.block_count(), BlockData::default());
        self.loops.refill(cfg.loops().len(), 0);
    }

    /// Before the walk. The last group takes all heaps for which there is none left.
    pub(super) fn expect(&mut self, function: &Function, heap: Heap) {
        if self.heaps[heap].group == 0 {
            let range = function.heap_range(heap);
            match self.groups.get_mut(Groups::BITS as usize - 1) {
                Some(last) => *last = last.hull(range),
                None => self.groups.push(range),
            }
            self.heaps[heap].group = 1 << (self.groups.len() - 1);
        }
        self.expected |= self.heaps[heap].group;
    }

    /// For the blocks against the order, once the writes in the block are expected.
    pub(super) fn sum_up(&mut self, cfg: &Cfg, dominators: &Dominators, block: Block) {
        let in_block = core::mem::take(&mut self.expected);
        self.blocks[block].below |= in_block;
        let below = self.blocks[block].below;
        if let Some(parent) = dominators.parent(block) {
            self.blocks[parent].below |= below;
        }
        if let Some(own) = cfg.loop_of(block).expand() {
            self.loops[own] |= in_block;
            let data = &cfg.loops()[own];
            if let Some(outer) = data.parent.expand().filter(|_| data.header == block) {
                let inner = self.loops[own];
                self.loops[outer] |= inner;
            }
        }
    }

    /// `source` is the only block from which control comes, apart from those that `block` dominates.
    pub(super) fn enter(
        &mut self,
        cfg: &Cfg,
        dominators: &Dominators,
        block: Block,
        source: Option<Block>,
    ) {
        const MOST_LOOPS_ENTERED: u32 = 4;
        let Some(parent) = dominators.parent(block) else {
            self.log.clear();
            return;
        };
        let below = self.blocks[block].below;
        let above = &mut self.blocks[parent];
        self.log.truncate(above.log_end as usize);
        self.marked = above.log_end;
        let mut between = if source == Some(parent) {
            0
        } else {
            above.passed
        };
        above.passed |= below;
        let mut around = cfg.loop_of(block);
        for step in 0.. {
            if around.is_none() || cfg.includes(around, parent) {
                break;
            }
            if step == MOST_LOOPS_ENTERED {
                between = Groups::MAX;
                break;
            }
            between |= self.loops[around];
            around = cfg.loops()[around].parent;
        }
        if between != 0 {
            self.log.push(between);
        }
    }

    pub(super) fn leave(&mut self, block: Block) {
        self.blocks[block].log_end = self.log.len() as u32;
    }

    #[inline]
    pub(super) fn write(&mut self, heap: Heap) {
        let group = self.heaps[heap].group;
        match self
            .log
            .get_mut(self.marked as usize..)
            .and_then(<[_]>::last_mut)
        {
            Some(last) => *last |= group,
            None => self.log.push(group),
        }
    }

    #[inline]
    pub(super) fn now(&mut self) -> u32 {
        self.marked = self.log.len() as u32;
        self.marked
    }

    pub(super) fn may_have_changed(&mut self, function: &Function, heap: Heap, since: u32) -> bool {
        const PATIENCE: usize = 32;
        let written = &self.log[since as usize..];
        if written.is_empty() || heap == Heap::NOTHING {
            return false;
        }
        let groups = *self.heaps[heap].overlapping.get_or_insert_with(|| {
            let (range, bits) = (function.heap_range(heap), (0..).map(|bit| 1 << bit));
            let overlapping = self
                .groups
                .iter()
                .zip(bits)
                .filter(|(group, _)| group.overlaps(range));
            overlapping.fold(0, |all, (_, bit)| all | bit)
        });
        groups != 0 && (written.len() > PATIENCE || written.iter().any(|&some| some & groups != 0))
    }
}
