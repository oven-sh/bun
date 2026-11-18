use super::Cfg;
use crate::ir::{Block, Edge, Function, Op, Table};

pub(crate) const TURNS_OF_A_LOOP: f32 = 10.0;
const RARE_WEIGHT: f32 = 0.001;
const LEAVING_WEIGHT: f32 = 1.0 / (TURNS_OF_A_LOOP - 1.0);
const GREATEST: f32 = 1e30;
const LEAST: f32 = 1e-30;

/// How often blocks run for each time the function is entered, as far as its shape tells.
#[derive(Default)]
pub struct Frequencies {
    blocks: Table<Block, f32>,
    edges: Table<Edge, f32>,
    /// Every way to the block is rare.
    is_cold: Table<Block, bool>,
    ends_unreachable: Table<Block, bool>,
}

impl Frequencies {
    pub fn new(function: &Function, cfg: &Cfg) -> Self {
        let mut frequencies = Self::default();
        frequencies.compute(function, cfg);
        frequencies
    }

    pub fn compute(&mut self, function: &Function, cfg: &Cfg) {
        self.blocks.refill(function.block_count(), 0.0);
        self.edges.refill(function.edge_count(), 0.0);
        self.is_cold.refill(function.block_count(), true);
        self.ends_unreachable.refill(function.block_count(), false);
        for &block in cfg.order().iter().rev() {
            let mut edges = function.successors(block);
            self.ends_unreachable[block] = *function.op(function.last(block)) == Op::Unreachable
                || edges.len() != 0
                    && edges.all(|edge| self.ends_unreachable[function.target(edge)]);
        }
        for entry in function.entries() {
            (self.blocks[entry.block], self.is_cold[entry.block]) = (1.0, false);
        }
        for &block in cfg.order() {
            if cfg.loop_headed_by(block).is_some() {
                self.blocks[block] *= TURNS_OF_A_LOOP;
            }
            self.blocks[block] = self.blocks[block].clamp(LEAST, GREATEST);
            let is_rare = |edge| {
                function.is_rare(edge)
                    || self.ends_unreachable[function.target(edge)] && !self.ends_unreachable[block]
            };
            let weight = |edge| {
                let leaves = cfg
                    .loop_of(block)
                    .expand()
                    .is_some_and(|own| !cfg.includes(own, function.target(edge)));
                if is_rare(edge) {
                    RARE_WEIGHT
                } else if leaves {
                    LEAVING_WEIGHT
                } else {
                    1.0
                }
            };
            let share = self.blocks[block] / function.successors(block).map(weight).sum::<f32>();
            for edge in function.successors(block) {
                self.edges[edge] = share * weight(edge);
                if !cfg.is_backward(function, edge) {
                    let target = function.target(edge);
                    self.is_cold[target] &= self.is_cold[block] || is_rare(edge);
                    self.blocks[target] += self.edges[edge];
                }
            }
        }
    }

    /// Not zero for a block that can be reached.
    #[inline]
    pub fn of_block(&self, block: Block) -> f32 {
        self.blocks[block]
    }

    #[inline]
    pub fn of_edge(&self, edge: Edge) -> f32 {
        self.edges[edge]
    }

    #[inline]
    pub fn is_cold(&self, block: Block) -> bool {
        self.is_cold[block]
    }
}
