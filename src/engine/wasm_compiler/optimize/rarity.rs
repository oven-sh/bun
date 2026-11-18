//! Marks the edges that lead to what baseline code seldom ran.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Block, Function, Op, Table};

const LEAST_SAMPLES: u32 = 64;
const RATIO: u32 = 10;

/// Whether what ran `count` times is rare in code that ran `total` times.
pub(super) fn is_rare(count: u32, total: u32) -> bool {
    total >= LEAST_SAMPLES && count < total / RATIO
}

#[derive(Default)]
pub(super) struct Rarity {
    /// With the header of the loop for whose turns it holds, or `NONE` if it does for all that is around.
    rare: Vec<(Block, Block)>,
    busy_headers: Vec<Block>,
    is_rare: Table<Block, bool>,
    is_behind_rare: Table<Block, bool>,
}

impl Rarity {
    pub(super) fn clear(&mut self) {
        self.rare.clear();
        self.busy_headers.clear();
    }

    pub(super) fn is_empty(&self) -> bool {
        self.rare.is_empty()
    }

    pub(super) fn note_rare(&mut self, block: Block, in_loop: Block) {
        self.rare.push((block, in_loop));
    }

    /// The loop is worth the best code, however rarely it is entered.
    pub(super) fn note_busy(&mut self, header: Block) {
        self.busy_headers.push(header);
    }

    pub(super) fn mark_edges(&mut self, function: &mut Function, cfg: &Cfg) {
        self.is_rare.refill(function.block_count(), false);
        for &(block, header) in &self.rare {
            // What leaves the loop runs once for all its turns, and so does what comes after.
            let comes_back = |header| cfg.includes(cfg.loop_of(header), block);
            self.is_rare[block] |= cfg.is_reachable(block)
                && (header.is_none() || cfg.loop_headed_by(header).is_some() && comes_back(header));
        }
        for &block in cfg.order().iter().rev() {
            let mut edges = function.successors(block);
            self.is_rare[block] |= *function.op(function.last(block)) == Op::Unreachable
                || edges.len() != 0
                    && edges.all(|edge| {
                        !cfg.is_backward(function, edge) && self.is_rare[function.target(edge)]
                    });
        }
        self.spare_busy_loops(function, cfg);
        for &block in cfg.order() {
            for edge in function.successors(block) {
                if self.is_rare[function.target(edge)] && !self.is_rare[block] {
                    function.set_rare(edge, true);
                }
            }
        }
    }

    fn spare_busy_loops(&mut self, function: &Function, cfg: &Cfg) {
        self.is_behind_rare.refill(function.block_count(), false);
        for &block in cfg.order() {
            let mut earlier = (cfg.predecessors(block).iter())
                .filter(|&&edge| !cfg.is_backward(function, edge))
                .peekable();
            self.is_behind_rare[block] = self.is_rare[block]
                || earlier.peek().is_some()
                    && earlier.all(|&edge| self.is_behind_rare[function.source(edge)]);
        }
        while let Some(block) = self.busy_headers.pop() {
            if core::mem::take(&mut self.is_behind_rare[block]) {
                self.is_rare[block] = false;
                let sources = cfg.predecessors(block).iter();
                (self.busy_headers).extend(sources.map(|&edge| function.source(edge)));
            }
        }
    }
}
