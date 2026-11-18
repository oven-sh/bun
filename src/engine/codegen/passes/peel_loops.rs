//! Puts a copy of the first turn in front of a loop.

use super::Analyses;
use super::copier::{Copier, cost_of_copying};
use super::preheaders::{entering_edges, only_entering_edge};
use crate::analysis::{Cfg, Loop};
use crate::ir::{Block, Function};

const GREATEST_COST: u32 = 1000;

/// For the natural loops that are wanted, unless they are large or cannot be copied. Inner loops come first, so the
/// copy of an outer loop includes their copies.
pub fn peel_loops(
    function: &mut Function,
    analyses: &mut Analyses,
    mut is_wanted: impl FnMut(&Function, &Cfg, Loop) -> bool,
) {
    let cfg = analyses.cfg(function);
    let loops = cfg.loops();
    let mut wanted: Vec<(u32, Block)> = loops
        .keys()
        .filter(|&id| loops[id].is_natural && is_wanted(function, cfg, id))
        .map(|id| (loops[id].depth, loops[id].header))
        .collect();
    wanted.sort_by_key(|&(depth, _)| depth);
    for side_by_side in wanted.chunk_by(|a, b| a.0 == b.0).rev() {
        let (cfg, mut copier) = (analyses.cfg(function), Copier::new(function));
        // A copy that leads to a later loop has to find that one peeled.
        for &(_, header) in side_by_side.iter().rev() {
            if let Some(id) = cfg.loop_headed_by(header)
                && cost_of_copying(function, cfg.blocks_of(id), GREATEST_COST).is_some()
            {
                let entering = only_entering_edge(function, entering_edges(function, cfg, id));
                copier.copy_loop(function, cfg.blocks_of(id), Some(entering));
            }
        }
        copier.repair_uses(function, analyses);
    }
}
