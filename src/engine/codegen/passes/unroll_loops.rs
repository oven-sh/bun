//! Writes out the turns of small innermost loops that count: all if they are few, or else several for each way back.

use super::Analyses;
use super::copier::{Copier, cost_of_copying};
use super::induction::{comparison_for, step};
use super::preheaders::entering_edges;
use crate::analysis::{Cfg, Loop};
use crate::ir::{Block, Edge, Function, Heap, Op, Value, evaluate};
use crate::target::Target;

const MOST_LOOPS: usize = 5;
const MOST_TURNS: u32 = 4;
const GREATEST_COST_FOR_ALL_TURNS: u32 = 200;
const GREATEST_COST_FOR_SOME_TURNS: u32 = 70;

struct Unrolling {
    id: Loop,
    entering: Edge,
    returning: Edge,
    /// The number of times that control enters the header, if it is known to be small.
    turns: Option<u32>,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    if analyses.cfg(function).loops().len() == 0 {
        return;
    }
    let (cfg, frequencies) = analyses.frequencies(function);
    let mut found: Vec<Unrolling> = cfg
        .loops()
        .keys()
        .filter(|&id| !frequencies.is_cold(cfg.loops()[id].header))
        .filter_map(|id| plan(function, cfg, id))
        .collect();
    if found.is_empty() {
        return;
    }
    found.sort_by_key(|unrolling| core::cmp::Reverse(cfg.loops()[unrolling.id].depth));
    found.truncate(MOST_LOOPS);
    // A copy that leads to a later loop has to find that one unrolled.
    found.sort_by_key(|unrolling| core::cmp::Reverse(unrolling.id));
    let mut copier = Copier::new(function);
    for unrolling in found {
        let blocks = cfg.blocks_of(unrolling.id);
        if let Some(turns) = unrolling.turns {
            add_turns(function, &mut copier, blocks, unrolling.entering, turns);
        } else {
            let second = copier.copy_loop(function, blocks, None);
            if let [returning] = *second.returning {
                add_turns(function, &mut copier, blocks, returning, MOST_TURNS - 2);
            }
            function.set_target(unrolling.returning, second.header);
        }
    }
    copier.repair_uses(function, analyses);
}

fn add_turns(
    function: &mut Function,
    copier: &mut Copier,
    blocks: &[Block],
    mut entering: Edge,
    count: u32,
) {
    for _ in 0..count {
        let [returning] = *copier.copy_loop(function, blocks, Some(entering)).returning else {
            return;
        };
        entering = returning;
    }
}

fn plan(function: &Function, cfg: &Cfg, id: Loop) -> Option<Unrolling> {
    let (data, blocks) = (cfg.loops()[id], cfg.blocks_of(id));
    let [entering, returning] = *cfg.predecessors(data.header) else {
        return None;
    };
    debug_assert!(entering_edges(function, cfg, id) == [entering]);
    let cost = cost_of_copying(function, blocks, GREATEST_COST_FOR_ALL_TURNS)?;
    if !data.is_natural
        || blocks.iter().any(|&block| cfg.loop_of(block) != id)
        || only_writes(function, blocks)
    {
        return None;
    }
    let count = |position| count_turns(function, cfg, id, [entering, returning], position);
    let turns = (0..function.params(data.header).len()).find_map(count)?;
    (turns.is_some() || cost <= GREATEST_COST_FOR_SOME_TURNS).then_some(Unrolling {
        id,
        entering,
        returning,
        turns,
    })
}

/// A loop that only writes goes at the speed of memory, so more turns in it do not help.
fn only_writes(function: &Function, blocks: &[Block]) -> bool {
    let effects = || {
        let values = blocks
            .iter()
            .flat_map(|&block| function.instructions(block));
        values.map(|value| function.effects(value))
    };
    effects().any(|effects| effects.writes_memory())
        && effects().all(|effects| effects.reads == Heap::NOTHING)
}

/// `None` unless the parameter counts and decides when the loop ends. The inner `None` stands for many or unknown.
fn count_turns(
    function: &Function,
    cfg: &Cfg,
    id: Loop,
    [entering, returning]: [Edge; 2],
    position: usize,
) -> Option<Option<u32>> {
    let header = cfg.loops()[id].header;
    let (counter, next) = (
        function.params(header)[position],
        function.args(returning)[position],
    );
    let (size, _) = step(function, counter, next)?;
    let test = |block: Block, subject: Value| {
        let (then, or) = match function.op(function.last(block)) {
            Op::Branch(_) => (function.successor(block, 0), function.successor(block, 1)),
            _ => return None,
        };
        let stays = |edge| cfg.includes(id, function.target(edge));
        let staying = if stays(then) { then } else { or };
        comparison_for(function, staying, subject).filter(|_| stays(then) != stays(or))
    };
    let (is_ahead, (cond, limit)) = match test(function.source(returning), next) {
        Some(at_bottom) => (true, at_bottom),
        None => (false, test(header, counter)?),
    };
    let ty = function.type_of(counter);
    let first = function.constant_bits(function.args(entering)[position]);
    let (Some(first), Some(limit)) = (first, function.constant_bits(limit)) else {
        return Some(None);
    };
    let tested = |turn: u32| {
        let steps = u64::from(turn + u32::from(is_ahead));
        first.wrapping_add(steps.wrapping_mul(size as u64))
    };
    let last = (0..=MOST_TURNS).find(|&turn| !evaluate::compare(cond, ty, tested(turn), limit));
    Some(last.map(|last| last + 1))
}
