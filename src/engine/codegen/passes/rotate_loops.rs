//! Moves the test from the top of a loop to the bottom, with a copy in front of the loop.

use super::copier::{Copier, as_jump};
use super::preheaders::{entering_edges, only_entering_edge};
use super::{Analyses, hoist_loop_invariants};
use crate::analysis::{Cfg, Loop};
use crate::ir::{Block, Edge, Function, Op};
use crate::target::Target;

const GREATEST_COST: u32 = 8;
const MOST_PARAMS: usize = 64;

struct Rotation<'a> {
    entering: &'a [Edge],
    /// If it cannot be the only way into its target.
    staying_to_split: Option<Edge>,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, target: Target) {
    if analyses.cfg(function).loops().len() == 0 {
        return;
    }
    let (cfg, frequencies) = analyses.frequencies(function);
    let mut copier = Copier::new(function);
    let rotations: Vec<Rotation<'_>> = cfg
        .loops()
        .keys()
        .filter(|&found| !frequencies.is_cold(cfg.loops()[found].header))
        .filter_map(|found| plan(function, cfg, &mut copier, found))
        .collect();
    if rotations.is_empty() {
        return;
    }
    // A copy of a header that leads to a later loop has to find that one rotated.
    for rotation in rotations.iter().rev() {
        if let Some(staying) = rotation.staying_to_split {
            function.split_edge(staying);
        }
        let entering = only_entering_edge(function, rotation.entering);
        let preview = copier.preview_target(function, entering);
        let taken = preview.and_then(|preview| preview.taken);
        copier.forget_stand_ins();
        let entering = as_jump(function, entering);
        let (into, header) = (function.source(entering), function.target(entering));
        copier.copy_body(function, entering);
        copier.copy_end(function, header, into, taken);
        copier.end_path(into);
    }
    copier.repair_uses(function, analyses);
    // What follows the test is now certain to run once the loop is entered.
    hoist_loop_invariants::run(function, analyses, target);
}

/// The edge that stays in the loop, if the block ends with a test whose other edge leaves it.
fn staying_edge(function: &Function, cfg: &Cfg, around: Loop, block: Block) -> Option<Edge> {
    if function.successors(block).len() != 2
        || matches!(function.op(function.last(block)), Op::Patchpoint(_))
    {
        return None;
    }
    let edges = [0, 1].map(|position| function.successor(block, position));
    match edges.map(|edge| cfg.includes(around, function.target(edge))) {
        [true, false] => Some(edges[0]),
        [false, true] => Some(edges[1]),
        _ => None,
    }
}

fn plan<'a>(
    function: &mut Function,
    cfg: &'a Cfg,
    copier: &mut Copier,
    rotated: Loop,
) -> Option<Rotation<'a>> {
    let data = cfg.loops()[rotated];
    let staying = staying_edge(function, cfg, rotated, data.header)?;
    let entering = entering_edges(function, cfg, rotated);
    let mut returning = cfg.predecessors(data.header)[entering.len()..].iter();
    let tests_at_bottom = returning
        .any(|&edge| staying_edge(function, cfg, rotated, function.source(edge)).is_some());
    if !data.is_natural
        || tests_at_bottom
        || function.is_rare(staying)
        || function.params(data.header).len() > MOST_PARAMS
    {
        return None;
    }
    let preview = copier.preview_target(function, entering[0]);
    copier.forget_stand_ins();
    if preview?.cost > GREATEST_COST {
        return None;
    }
    let is_shared = cfg.predecessors(function.target(staying)).len() > 1;
    Some(Rotation {
        entering,
        staying_to_split: is_shared.then_some(staying),
    })
}
