//! Puts the blocks in the order that makes for the fewest jumps.

use super::emit::{Isa, Places};
use crate::analysis::{Cfg, Frequencies};
use crate::ir::{Action, Block, Edge, Op, Table};

/// By how much an edge has to outweigh one that keeps the blocks in their order.
const INERTIA: f32 = 2.0;

#[derive(Clone, Copy)]
pub(super) struct Piece {
    /// Its moves come before the block. Its source jumps to them.
    pub(super) approach: Edge,
    pub(super) block: Block,
}

#[derive(Clone, Copy)]
struct Placement {
    /// Where a jump to the block really has to go.
    destination: Block,
    first_move: u32,
    /// The edge whose code comes right before that of the block.
    entered_by: Edge,
    weight: f32,
    is_approach: bool,
    /// The edge to the block that comes next.
    left_by: Edge,
    proposals: u8,
}

#[derive(Default)]
pub(super) struct Layout {
    pub(super) pieces: Vec<Piece>,
    placements: Table<Block, Placement>,
    kept: Vec<Block>,
}

impl Layout {
    #[inline]
    pub(super) fn destination(&self, mut block: Block) -> Block {
        while self.placements[block].destination != block {
            block = self.placements[block].destination;
        }
        block
    }

    /// The position among all moves of the first that is in the block.
    #[inline]
    pub(super) fn first_move(&self, block: Block) -> usize {
        self.placements[block].first_move as usize
    }

    pub(super) fn is_approach(&self, edge: Edge, destination: Block) -> bool {
        let placement = &self.placements[destination];
        placement.is_approach && placement.entered_by == edge
    }

    pub(super) fn compute<I: Isa>(
        &mut self,
        places: Places<'_>,
        cfg: &Cfg,
        frequencies: &Frequencies,
        instructions: &[I],
        is_thorough: bool,
    ) {
        self.skip_empty_blocks(places, cfg, instructions);
        self.kept.clear();
        for is_cold in [false, true] {
            let is_kept = |&&block: &&Block| {
                self.placements[block].destination == block && frequencies.is_cold(block) == is_cold
            };
            self.kept.extend(cfg.order().iter().filter(is_kept));
        }
        self.pieces.clear();
        if !is_thorough {
            let approach = Edge::NONE;
            (self.pieces).extend(self.kept.iter().map(|&block| Piece { approach, block }));
            return;
        }
        for index in 0..self.kept.len() {
            self.find_follower(places, cfg, frequencies, self.kept[index]);
        }
        for index in 0..self.kept.len() {
            self.find_approach(places, cfg, frequencies, self.kept[index]);
        }
        for &first in &self.kept {
            let placement = &self.placements[first];
            if !placement.is_approach && !placement.entered_by.is_none() {
                continue;
            }
            self.pieces.push(Piece {
                approach: placement.entered_by,
                block: first,
            });
            let mut last = first;
            while let Some(edge) = self.placements[last].left_by.expand() {
                last = self.destination(places.function.target(edge));
                self.pieces.push(Piece {
                    approach: Edge::NONE,
                    block: last,
                });
            }
        }
    }

    fn skip_empty_blocks<I: Isa>(&mut self, places: Places<'_>, cfg: &Cfg, instructions: &[I]) {
        let (function, moves) = (places.function, &places.allocation.moves);
        let unplaced = Placement {
            destination: Block::NONE,
            first_move: 0,
            entered_by: Edge::NONE,
            weight: 0.0,
            is_approach: false,
            left_by: Edge::NONE,
            proposals: 0,
        };
        self.placements.refill(function.block_count(), unplaced);
        let mut end = moves.len();
        for &block in cfg.order().iter().rev() {
            let data = &places.code.blocks[block];
            let after = end;
            while end != 0 && moves[end - 1].0 >= data.first {
                end -= 1;
            }
            let mut destination = block;
            let only_jumps =
                data.end - data.first == 1 && instructions[data.first as usize].is_jump();
            if only_jumps && after == end && !cfg.predecessors(block).is_empty() {
                let edge = function.successor(block, 0);
                let does_nothing = places.moves_at_source(cfg, edge).is_empty()
                    && places.moves_at_start(cfg, block).next().is_none();
                // A header may turn out to lead nowhere but to itself.
                if does_nothing && cfg.loop_headed_by(block).is_none() {
                    destination = function.target(edge);
                    if !cfg.is_backward(function, edge) {
                        destination = self.placements[destination].destination;
                    }
                }
            }
            let placement = &mut self.placements[block];
            (placement.destination, placement.first_move) = (destination, end as u32);
        }
    }

    /// The edges whose target can follow the block, with their weights, the best first.
    fn choices(
        &self,
        places: Places<'_>,
        cfg: &Cfg,
        frequencies: &Frequencies,
        block: Block,
    ) -> [(Edge, f32); 2] {
        let function = places.function;
        let count = match *function.op(function.last(block)) {
            Op::Branch(_) => 2,
            Op::JumpTable(..) => 0,
            _ => 1,
        };
        let mut choices = [(Edge::NONE, 0.0); 2];
        let mut positions = [u32::MAX; 2];
        for (index, edge) in function.successors(block).take(count).enumerate() {
            let target = self.destination(function.target(edge));
            if cfg.position(target) > cfg.position(block)
                && frequencies.is_cold(target) == frequencies.is_cold(block)
            {
                choices[index] = (edge, frequencies.of_edge(edge));
                positions[index] = cfg.position(target);
            }
        }
        if positions[1] < positions[0] {
            choices.swap(0, 1);
        }
        if choices[0].1 * INERTIA < choices[1].1 {
            choices.swap(0, 1);
        }
        choices
    }

    /// A block that loses its follower to a better claim looks for another.
    fn find_follower(
        &mut self,
        places: Places<'_>,
        cfg: &Cfg,
        frequencies: &Frequencies,
        mut block: Block,
    ) {
        let function = places.function;
        loop {
            let proposals = usize::from(self.placements[block].proposals);
            let choices = self.choices(places, cfg, frequencies, block);
            let Some(&(edge, weight)) = choices.get(proposals).filter(|it| !it.0.is_none()) else {
                return;
            };
            self.placements[block].proposals += 1;
            let target = self.destination(function.target(edge));
            let Placement {
                entered_by: rival,
                weight: weight_of_rival,
                ..
            } = self.placements[target];
            if let Some(rival) = rival.expand() {
                let is_later = cfg.position(block) > cfg.position(function.source(rival));
                let prevails = if is_later {
                    weight * INERTIA >= weight_of_rival
                } else {
                    weight > weight_of_rival * INERTIA
                };
                if !prevails {
                    continue;
                }
            }
            let placement = &mut self.placements[target];
            (placement.entered_by, placement.weight) = (edge, weight);
            self.placements[block].left_by = edge;
            let Some(rival) = rival.expand() else {
                return;
            };
            block = function.source(rival);
            self.placements[block].left_by = Edge::NONE;
        }
    }

    /// The moves of an edge that is reached by a jump may go in front of its target.
    fn find_approach(
        &mut self,
        places: Places<'_>,
        cfg: &Cfg,
        frequencies: &Frequencies,
        block: Block,
    ) {
        let function = places.function;
        let left_by = self.placements[block].left_by;
        let edges = function.successors(block);
        let is_call = matches!(
            *function.op(function.last(block)),
            Op::Patchpoint(patchpoint) if function.patchpoint(patchpoint).action != Action::Custom
        );
        if edges.len() < 2 || is_call || frequencies.is_cold(block) {
            return;
        }
        for edge in edges.filter(|&edge| edge != left_by) {
            if places.moves_at_source(cfg, edge).is_empty() {
                continue;
            }
            let (target, weight) = (
                self.destination(function.target(edge)),
                frequencies.of_edge(edge),
            );
            let known = self.placements[target];
            let inertia = if known.is_approach { 1.0 } else { INERTIA };
            if weight > known.weight * inertia && !frequencies.is_cold(target) {
                if let Some(rival) = known.entered_by.expand()
                    && !known.is_approach
                {
                    self.placements[function.source(rival)].left_by = Edge::NONE;
                }
                let placement = &mut self.placements[target];
                (placement.entered_by, placement.weight) = (edge, weight);
                placement.is_approach = true;
            }
        }
    }
}
