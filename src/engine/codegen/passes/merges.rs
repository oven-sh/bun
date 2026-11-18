//! For 64 things that blocks change, finds the blocks where it depends on the way in what last changed them.

use core::ops::Range;

use crate::analysis::{Ancestry, Cfg, Dominators};
use crate::ir::{Block, Edge, Function};

#[derive(Clone, Copy, Default)]
struct Changes {
    inside: u64,
    /// Between the end of the nearest dominator and the start of the block.
    on_the_way: u64,
    /// Both, for the block and its dominators below the one it jumps to.
    below_jump: u64,
}

impl Changes {
    #[inline]
    fn any(self) -> u64 {
        self.inside | self.on_the_way
    }
}

/// Blocks go by their rank in the tree of dominators.
pub(super) struct Merges<'a> {
    cfg: &'a Cfg,
    tree: &'a [Ancestry],
    changes: Vec<Changes>,
}

impl<'a> Merges<'a> {
    pub(super) fn new(cfg: &'a Cfg, dominators: &'a Dominators) -> Self {
        let tree = dominators.by_rank();
        Self {
            cfg,
            tree,
            changes: vec![Changes::default(); tree.len()],
        }
    }

    #[inline]
    pub(super) fn rank(&self, block: Block) -> u32 {
        self.cfg.position(block) + 1
    }

    #[inline]
    pub(super) fn block(&self, rank: u32) -> Block {
        self.cfg.order()[rank as usize - 1]
    }

    #[inline]
    pub(super) fn parent(&self, rank: u32) -> u32 {
        self.tree[rank as usize].parent
    }

    pub(super) fn all_ranks(&self) -> Range<u32> {
        1..self.tree.len() as u32
    }

    /// Of the block at `rank`, which is the result if there is none.
    pub(super) fn first_dominator_after(&self, passed: u32, mut rank: u32) -> u32 {
        loop {
            let Ancestry { parent, jump, .. } = self.tree[rank as usize];
            if parent <= passed {
                return rank;
            }
            rank = if jump > passed { jump } else { parent };
        }
    }

    #[inline]
    pub(super) fn add_changes(&mut self, rank: u32, bits: u64) {
        self.changes[rank as usize].inside |= bits;
    }

    #[inline]
    pub(super) fn changed_in(&self, rank: u32) -> u64 {
        self.changes[rank as usize].inside
    }

    #[inline]
    pub(super) fn merged_at(&self, rank: u32) -> u64 {
        self.changes[rank as usize].on_the_way
    }

    pub(super) fn clear(&mut self, ranks: Range<u32>) {
        self.changes[ranks.start as usize..ranks.end as usize].fill(Changes::default());
    }

    /// `ranks` has all changes, and the whole of each loop whose header it has. Ways that leave it and come back do not
    /// count.
    pub(super) fn compute(&mut self, function: &Function, ranks: Range<u32>) {
        const EXACT_ROUNDS: u32 = 4;
        let all_natural = self.carry_around_loops(ranks.clone());
        for round in 1.. {
            self.sweep(function, ranks.clone());
            if all_natural || round > EXACT_ROUNDS {
                break;
            }
            let mut changed = false;
            for rank in ranks.clone() {
                if self.heads_loop_with_other_entries(rank) {
                    let bits = if round == EXACT_ROUNDS {
                        u64::MAX
                    } else {
                        self.changed_along(function, rank, ranks.start, |source| source >= rank)
                    };
                    let known = &mut self.changes[rank as usize].on_the_way;
                    changed |= bits & !*known != 0;
                    *known |= bits;
                }
            }
            if !changed {
                break;
            }
        }
    }

    fn heads_loop_with_other_entries(&self, rank: u32) -> bool {
        self.cfg
            .loop_headed_by(self.block(rank))
            .is_some_and(|found| !self.cfg.loops()[found].is_natural)
    }

    /// Returns whether the loops are natural.
    fn carry_around_loops(&mut self, ranks: Range<u32>) -> bool {
        let loops = self.cfg.loops();
        let mut all_natural = true;
        if loops.len() == 0 {
            return all_natural;
        }
        for rank in ranks.clone().rev() {
            let Some(mut around) = self.cfg.loop_of(self.block(rank)).expand() else {
                continue;
            };
            if loops[around].positions().start + 1 == rank {
                all_natural &= loops[around].is_natural;
                self.changes[rank as usize].on_the_way = self.changes[rank as usize].any();
                let Some(parent) = loops[around].parent.expand() else {
                    continue;
                };
                around = parent;
            }
            let header = loops[around].positions().start + 1;
            if header >= ranks.start {
                self.changes[header as usize].on_the_way |= self.changes[rank as usize].any();
            }
        }
        all_natural
    }

    fn sweep(&mut self, function: &Function, ranks: Range<u32>) {
        for rank in ranks.clone() {
            if self.cfg.predecessors(self.block(rank)).len() > 1 {
                self.changes[rank as usize].on_the_way |=
                    self.changed_along(function, rank, ranks.start, |source| source < rank);
            }
            let Ancestry { parent, jump, .. } = self.tree[rank as usize];
            let mut below_jump = self.changes[rank as usize].any();
            if jump != parent {
                let between = self.tree[parent as usize].jump;
                below_jump |= self.changes[parent as usize].below_jump
                    | self.changes[between as usize].below_jump;
            }
            self.changes[rank as usize].below_jump = below_jump;
        }
    }

    /// From the end of the nearest dominator of the block to its start, by way of the wanted predecessors.
    #[inline]
    fn changed_along(
        &self,
        function: &Function,
        rank: u32,
        least: u32,
        is_wanted: impl Fn(u32) -> bool,
    ) -> u64 {
        let top = self.parent(rank);
        let stop = top.max(least - 1);
        let mut bits = 0;
        for &edge in self.cfg.predecessors(self.block(rank)) {
            let mut at = self.source_rank(function, edge);
            if !is_wanted(at) {
                continue;
            }
            while at > stop {
                let Ancestry { parent, jump, .. } = self.tree[at as usize];
                let changes = self.changes[at as usize];
                if jump >= top {
                    (bits, at) = (bits | changes.below_jump, jump);
                } else {
                    (bits, at) = (bits | changes.any(), parent);
                }
            }
        }
        bits
    }

    #[inline]
    pub(super) fn source_rank(&self, function: &Function, edge: Edge) -> u32 {
        self.rank(function.source(edge))
    }

    /// The nearest dominator of the block, or the block, in which or on the way to which one of `bits` changes. The
    /// result is less than `least`, which is not zero, if none is left from there on.
    #[inline]
    pub(super) fn last_change(&self, mut rank: u32, bits: u64, least: u32) -> u32 {
        while rank >= least {
            let (changes, ancestry) = (self.changes[rank as usize], self.tree[rank as usize]);
            if changes.below_jump & bits == 0 {
                rank = ancestry.jump;
            } else if changes.any() & bits == 0 {
                rank = ancestry.parent;
            } else {
                break;
            }
        }
        rank
    }
}
