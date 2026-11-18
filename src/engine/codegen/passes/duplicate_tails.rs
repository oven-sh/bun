//! Copies small blocks in which ways meet into the ways, above all where that settles what the block tests.

use super::Analyses;
use super::bounds::Bounds;
use super::copier::{Copier, as_jump};
use super::orderings::Orderings;
use crate::analysis::{Cfg, Dominators, Frequencies};
use crate::ir::{Block, Edge, Function, Op, Table, Value};
use crate::target::Target;

const GREATEST_COST_OF_TAIL: u32 = 2;
const MOST_SUCCESSORS_OF_TAIL: usize = 3;
const MOST_PREDECESSORS_OF_TAIL: usize = 16;
const GREATEST_COST_OF_SETTLED_TEST: u32 = 4;
const GREATEST_COST_OF_PATH: u32 = 8;
const MOST_BLOCKS_ON_PATH: usize = 8;
const MOST_DOMINATORS_SEARCHED: usize = 8;
/// Values that outlive a copied block need parameters up to the next block that all ways go through.
const MOST_COPIED_BLOCKS_IN_A_ROW: u8 = 6;
const LEAST_BUDGET: usize = 64;
const VALUES_PER_UNIT_OF_BUDGET: usize = 4;

#[derive(Clone, Copy)]
struct BlockState {
    ways_in: u32,
    /// From blocks that are not cold. All but one of them take an instruction.
    jumps_in: u32,
    is_copied: bool,
    is_visited: bool,
    /// Once visited: among the block and its dominators, up to one in which ways meet and which is not copied.
    copied_in_a_row: u8,
}

struct Step {
    /// The edge that the block is certain to take.
    taken: Option<Edge>,
    cost: u32,
    pays: bool,
}

struct Duplication<'a> {
    cfg: &'a Cfg,
    dominators: &'a Dominators,
    frequencies: &'a Frequencies,
    copier: Copier,
    blocks: Table<Block, BlockState>,
    path: Vec<Step>,
    budget: usize,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let cfg = analyses.cfg(function);
    let is_tail =
        |&block: &Block| cfg.predecessors(block).len() > 1 && cfg.loop_headed_by(block).is_none();
    if !cfg.order().iter().any(is_tail) {
        return;
    }
    let (cfg, dominators, frequencies) = analyses.all(function);
    let mut duplication = Duplication {
        cfg,
        dominators,
        frequencies,
        copier: Copier::new(function),
        blocks: function.block_table(BlockState {
            ways_in: 0,
            jumps_in: 0,
            is_copied: false,
            is_visited: false,
            copied_in_a_row: 0,
        }),
        path: Vec::new(),
        budget: LEAST_BUDGET + function.value_count() / VALUES_PER_UNIT_OF_BUDGET,
    };
    for entry in function.entries() {
        duplication.blocks[entry.block].ways_in = 1;
    }
    for &block in cfg.order() {
        duplication.count_ways_out(function, block, frequencies.is_cold(block), 1);
    }
    let mut changed = false;
    for &block in cfg.order() {
        changed |= duplication.visit(function, block);
    }
    if changed {
        duplication.copier.repair_uses(function, analyses);
    }
}

fn ends_with_jump(function: &Function, block: Block) -> bool {
    *function.op(function.last(block)) == Op::Jump
}

impl Duplication<'_> {
    fn count_ways_out(&mut self, function: &Function, block: Block, is_cold: bool, by: i32) {
        let jumps = !is_cold && ends_with_jump(function, block);
        for edge in function.successors(block) {
            let target = &mut self.blocks[function.target(edge)];
            target.ways_in = target.ways_in.strict_add_signed(by);
            target.jumps_in = target.jumps_in.strict_add_signed(by * i32::from(jumps));
        }
    }

    fn visit(&mut self, function: &mut Function, block: Block) -> bool {
        let is_join = self.cfg.predecessors(block).len() > 1;
        self.blocks[block].copied_in_a_row = match (self.blocks[block].is_copied, is_join) {
            (false, true) => 0,
            (is_copied, _) => self.copied_above(block) + u8::from(is_copied),
        };
        self.blocks[block].is_visited = true;
        if self.blocks[block].ways_in == 0 {
            self.count_ways_out(function, block, self.frequencies.is_cold(block), -1);
            return false;
        }
        let mut changed = false;
        for edge in function.successors(block) {
            if self.cfg.predecessors(function.target(edge)).len() > 1 {
                changed |= self.follow(function, edge);
            }
        }
        changed
    }

    /// The dominators that have not been visited are on the path that is being copied.
    fn copied_above(&self, block: Block) -> u8 {
        let (mut count, mut above) = (0, self.dominators.parent(block));
        while let Some(dominator) = above {
            if self.blocks[dominator].is_visited {
                return count + self.blocks[dominator].copied_in_a_row;
            }
            (count, above) = (count + 1, self.dominators.parent(dominator));
        }
        count
    }

    fn follow(&mut self, function: &mut Function, first: Edge) -> bool {
        let source = function.source(first);
        let is_cold = function.is_rare(first) || self.frequencies.is_cold(source);
        self.plan_path(function, first, is_cold);
        if self.path.is_empty() {
            return false;
        }
        let tail = &mut self.blocks[function.target(first)];
        tail.ways_in -= 1;
        tail.jumps_in -=
            u32::from(!self.frequencies.is_cold(source) && ends_with_jump(function, source));
        let mut edge = as_jump(function, first);
        let into = function.source(edge);
        for position in 0..self.path.len() {
            let (tail, Step { taken, cost, .. }) = (function.target(edge), &self.path[position]);
            let taken = *taken;
            let spent = 1 + *cost as usize + function.params(tail).len();
            self.budget = self.budget.saturating_sub(spent);
            self.blocks[tail].is_copied = true;
            if taken.is_some_and(|taken| function.is_rare(taken)) {
                self.make_rare(function, first);
            }
            self.copier.copy_body(function, edge);
            self.copier.copy_end(function, tail, into, taken);
            if taken.is_some() {
                edge = function.successor(into, 0);
            }
        }
        for new in function.successors(into) {
            self.budget = self.budget.saturating_sub(function.args(new).len());
        }
        self.count_ways_out(function, into, is_cold, 1);
        self.copier.end_path(into);
        true
    }

    /// Up to the last block that is worth the copies.
    fn plan_path(&mut self, function: &mut Function, first: Edge, is_cold: bool) {
        self.path.clear();
        let (mut edge, mut total, mut unpaid) = (first, 0, 0);
        while self.path.len() < MOST_BLOCKS_ON_PATH
            && let Some(step) = self.plan_step(function, first, edge, is_cold, unpaid)
        {
            total += step.cost;
            unpaid = if step.pays { 0 } else { unpaid + step.cost };
            if total > GREATEST_COST_OF_PATH || unpaid > GREATEST_COST_OF_SETTLED_TEST {
                break;
            }
            let taken = step.taken;
            self.path.push(step);
            let Some(taken) = taken else {
                break;
            };
            edge = taken;
        }
        self.copier.forget_stand_ins();
        while self.path.pop_if(|step| !step.pays).is_some() {}
    }

    /// For the target of `edge`, which is reached by way of `first`.
    fn plan_step(
        &mut self,
        function: &mut Function,
        first: Edge,
        edge: Edge,
        is_cold: bool,
        unpaid: u32,
    ) -> Option<Step> {
        let tail = function.target(edge);
        let (last, params) = (function.last(tail), function.params(tail).len());
        if self.cfg.loop_headed_by(tail).is_some()
            || params >= self.budget
            || self.copied_above(tail) >= MOST_COPIED_BLOCKS_IN_A_ROW
        {
            return None;
        }
        let preview = self.copier.preview_target(function, edge)?;
        let (end, mut cost) = (*function.op(last), preview.cost);
        let taken = preview.taken.or_else(|| {
            let holds = self.known_on_the_way(function, first, tail)?;
            let is_computed_here = end == Op::Branch(function.previous(last));
            cost -= u32::from(is_computed_here).min(cost);
            Some(function.successor(tail, usize::from(!holds)))
        });
        if taken.is_none()
            && (function.successors(tail).len() > MOST_SUCCESSORS_OF_TAIL
                || !matches!(end, Op::Branch(_) | Op::Switch(..) | Op::Return(_)))
        {
            return None;
        }
        let owed = unpaid + cost;
        let pays = if taken.is_some() && end != Op::Jump || preview.settled_check_fails.is_some() {
            let replaces_original = edge == first && self.blocks[tail].ways_in == 1;
            owed <= GREATEST_COST_OF_SETTLED_TEST && (owed == 0 || !is_cold || replaces_original)
        } else {
            !is_cold
                && owed <= GREATEST_COST_OF_TAIL
                && (self.tests_comparison_passed_in(function, tail)
                    || self.saves_jump(function, first, edge, cost))
        };
        Some(Step { taken, cost, pays })
    }

    fn tests_comparison_passed_in(&self, function: &Function, tail: Block) -> bool {
        let Op::Branch(condition) = *function.op(function.last(tail)) else {
            return false;
        };
        let passed = self.copier.stand_in(condition);
        passed != condition && matches!(function.op(passed), Op::Compare(..) | Op::FloatCompare(..))
    }

    fn saves_jump(&self, function: &Function, first: Edge, edge: Edge, cost: u32) -> bool {
        let tail = function.target(edge);
        let takes_jump = edge != first
            || ends_with_jump(function, function.source(first)) && self.blocks[tail].jumps_in > 1;
        let mut successors = function.successors(tail);
        let needs_few_params = successors.len() == 0
            || successors.any(|edge| self.cfg.is_backward(function, edge))
            || !ends_with_jump(function, tail)
                && function.params(tail).len() + cost as usize <= GREATEST_COST_OF_TAIL as usize;
        takes_jump
            && needs_few_params
            && self.cfg.predecessors(tail).len() <= MOST_PREDECESSORS_OF_TAIL
    }

    /// Whether the block takes its first edge, as far as the branches that lead to `first` tell.
    fn known_on_the_way(&self, function: &Function, first: Edge, tail: Block) -> Option<bool> {
        let Op::Branch(condition) = *function.op(function.last(tail)) else {
            return None;
        };
        let along = |value| self.copier.stand_in(value);
        let condition = along(condition);
        let comparison = match *function.op(condition) {
            Op::Compare(cond, operands) => Some((cond, operands.map(along))),
            _ => None,
        };
        let decide = |known: Value, holds: bool| {
            if known == condition {
                return Some(holds);
            }
            let (wanted, [a, b]) = comparison?;
            let Op::Compare(cond, [c, d]) = *function.op(known) else {
                return None;
            };
            let cond = if holds { cond } else { cond.inverted() };
            if (a, b) == (c, d) {
                Orderings::from(cond).decide(wanted)
            } else if (a, b) == (d, c) {
                Orderings::from(cond.commuted()).decide(wanted)
            } else if a == c && function.op(b).is_constant() && function.op(d).is_constant() {
                let [a, b, d] = [a, b, d].map(|value| Bounds::evident(function, value));
                Orderings::between(&a.where_holds(cond, &d), &b).decide(wanted)
            } else {
                None
            }
        };
        let (mut way, mut block) = (Some(first), function.source(first));
        for _ in 0..MOST_DOMINATORS_SEARCHED {
            if let Some((known, holds)) = way.and_then(|way| condition_for(function, way))
                && let Some(result) = decide(known, holds)
            {
                return Some(result);
            }
            way = match *self.cfg.predecessors(block) {
                [only] => Some(only),
                _ => None,
            };
            block = self.dominators.parent(block)?;
        }
        None
    }

    fn make_rare(&self, function: &mut Function, mut edge: Edge) {
        if function.successors(function.source(edge)).len() == 1 {
            let [only] = *self.cfg.predecessors(function.source(edge)) else {
                return;
            };
            edge = only;
        }
        let mut both = function.successors(function.source(edge));
        if condition_for(function, edge).is_some() && !both.any(|edge| function.is_rare(edge)) {
            function.set_rare(edge, true);
        }
    }
}

/// The value that the source of the edge branches on, and whether it is not zero if the edge is taken.
fn condition_for(function: &Function, edge: Edge) -> Option<(Value, bool)> {
    let source = function.source(edge);
    let Op::Branch(condition) = *function.op(function.last(source)) else {
        return None;
    };
    let position = function.successors(source).position(|own| own == edge)?;
    Some((condition, position == 0))
}
