//! Moves what is the same in every turn of a loop to before the loop.

use bun_engine_asm::Sign;

use super::Analyses;
use super::places::Place;
use super::preheaders::{edge_from_preheader, entering_edges};
use super::writes::Writes;
use crate::analysis::{Cfg, Frequencies, Loop};
use crate::ir::{
    AccessFlags, Binary, Block, Edge, EffectFlags, Effects, Entity, Function, Heap, Op, State,
    Table, Type, Unary, Value,
};
use crate::target::Target;

const MOST_LOOPS_TRIED: usize = 8;
const MOST_WRITES_COMPARED: u32 = 16;
const MOST_USES_ABSORBED: u8 = 8;
const GREATEST_SCALE_LOG2: i64 = 3;
/// How often a block has to run for each time the loop is entered.
const LEAST_SHARE: f32 = 0.25;
const STAYS: u32 = u32::MAX;

/// A loop around the current block. Levels count from the outermost.
struct Level {
    id: Loop,
    first: u32,
    /// The last position to which an edge leads from the blocks so far that are in no further loop.
    furthest: u32,
    entries: f32,
    accepts: bool,
    is_cold: bool,
    /// Ends the block before the loop, once there is such a block.
    entering: Edge,
}

#[derive(Clone, Copy)]
struct Usage {
    count: u8,
    /// Instruction selection makes the value a part of each user.
    is_absorbed: bool,
    /// For a value that moves only if a user does: a position at which it could be.
    could_be_at: u32,
}

struct Hoisting<'a> {
    cfg: &'a Cfg,
    frequencies: &'a Frequencies,
    target: Target,
    writes: Writes,
    writes_passed: u32,
    levels: Vec<Level>,
    /// From the headers of the levels before this, control may leave or turn back before it gets here.
    first_without_exit: usize,
    /// The same for anything that can be observed.
    first_without_effect: usize,
    /// From the headers of the levels before this, there are ways around the current block.
    first_certain: usize,
    /// Empty until it is needed.
    usage: Table<Value, Usage>,
    old_block_count: usize,
    positions_of_new_blocks: Vec<u32>,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, target: Target) {
    let loops = analyses.cfg(function).loops();
    if !loops.values().any(|data| data.is_natural) {
        return;
    }
    let (cfg, frequencies) = analyses.frequencies(function);
    let is_in_loop = |block| !cfg.loop_of(block).is_none();
    let mut hoisting = Hoisting {
        cfg,
        frequencies,
        target,
        writes: Writes::collect(function, cfg, is_in_loop, |_, _, _| {}),
        writes_passed: 0,
        levels: Vec::new(),
        first_without_exit: 0,
        first_without_effect: 0,
        first_certain: 0,
        usage: Table::default(),
        old_block_count: function.block_count(),
        positions_of_new_blocks: Vec::new(),
    };
    for &block in cfg.order() {
        if is_in_loop(block) {
            hoisting.visit(function, block);
        }
    }
    if !hoisting.positions_of_new_blocks.is_empty() {
        analyses.invalidate();
    }
}

impl Hoisting<'_> {
    fn visit(&mut self, function: &mut Function, block: Block) {
        self.enter(function, block);
        let (mut value, last) = (function.first(block), function.last(block));
        while value != last {
            let next = function.next(value);
            let effects = function.effects(value);
            if !self.try_to_hoist(function, value, effects) {
                self.pass(effects);
            }
            value = next;
        }
        if let Op::Patchpoint(_) | Op::Node { .. } | Op::WideNode { .. } = function.op(last) {
            self.pass(function.effects(last));
        }
        for edge in function.successors(block) {
            if self.cfg.is_backward(function, edge) {
                self.pass(Effects::with_flags(EffectFlags::EXITS));
            } else if let Some(level) = self.levels.last_mut() {
                level.furthest = level.furthest.max(self.cfg.position(function.target(edge)));
            }
        }
    }

    fn enter(&mut self, function: &Function, block: Block) {
        let around = |level: &Level| self.cfg.includes(level.id, block);
        self.levels.truncate(self.levels.partition_point(around));
        self.first_without_exit = self.first_without_exit.min(self.levels.len());
        self.first_without_effect = self.first_without_effect.min(self.levels.len());
        let position = self.cfg.position(block);
        if let Some(id) = self.cfg.loop_headed_by(block) {
            let entering = entering_edges(function, self.cfg, id).iter();
            self.levels.push(Level {
                id,
                first: position,
                furthest: position,
                entries: entering.map(|&edge| self.frequencies.of_edge(edge)).sum(),
                accepts: self.cfg.loops()[id].is_natural,
                is_cold: self.frequencies.is_cold(block),
                entering: Edge::NONE,
            });
        }
        let innermost = self.levels.iter().rev().take(MOST_LOOPS_TRIED);
        let certain = innermost.take_while(|level| level.furthest <= position);
        self.first_certain = self.levels.len() - certain.count();
    }

    fn pass(&mut self, effects: Effects) {
        if effects.must_execute() {
            self.first_without_effect = self.levels.len();
            self.writes_passed += u32::from(effects.writes_memory());
            if effects.has(EffectFlags::EXITS) {
                self.first_without_exit = self.levels.len();
            }
        }
    }

    #[inline]
    fn could_be_at(&self, value: Value) -> Option<u32> {
        (value.index() < self.usage.len())
            .then(|| self.usage[value].could_be_at)
            .filter(|&position| position != STAYS)
    }

    #[inline]
    fn position_of_block(&self, block: Block) -> u32 {
        if block.index() < self.old_block_count {
            self.cfg.position(block)
        } else if block.is_none() {
            0
        } else {
            self.positions_of_new_blocks[block.index() - self.old_block_count]
        }
    }

    #[inline]
    fn position_of(&self, function: &Function, value: Value) -> u32 {
        self.could_be_at(value)
            .unwrap_or_else(|| self.position_of_block(function.block_of(value)))
    }

    /// The first level that all of the values come before.
    fn first_level_after(&self, function: &Function, values: &[Value]) -> Option<usize> {
        let innermost = self.levels.last()?.first;
        let mut latest = 0;
        for &value in values {
            latest = latest.max(self.position_of(function, value));
            if latest >= innermost {
                return None;
            }
        }
        Some(self.levels.partition_point(|level| level.first <= latest))
    }

    fn try_to_hoist(&mut self, function: &mut Function, value: Value, effects: Effects) -> bool {
        let exits = effects.must_execute();
        if !effects.at_most_exits() || exits && matches!(function.op(value), Op::Patchpoint(_)) {
            return false;
        }
        let Some(mut first) = self.first_level_after(function, function.operands(value)) else {
            return false;
        };
        if exits {
            first = first.max(self.first_without_effect.max(self.first_certain));
        } else if effects.has(EffectFlags::CONTROL_DEPENDENT) {
            first = first.max(self.first_without_exit.max(self.first_certain));
        }
        let state = function.state(function.state_of(value));
        let keeps_state = match self.first_level_after(function, state) {
            Some(level) => {
                first = first.max(level);
                true
            }
            None if exits && self.is_known_on_entry(function, state) => {
                first = first.max(self.levels.len() - 1);
                false
            }
            None => return false,
        };
        let Some(level) = self.choose_level(function, value, effects, first) else {
            return false;
        };
        if self.is_cheaper_in_place(function, value) {
            self.usage[value].could_be_at = self.levels[level].first - 1;
            return false;
        }
        let entering = self.entering_edge(function, level);
        if !keeps_state {
            enter_state(function, value, entering);
        }
        let end = function.last(function.source(entering));
        self.move_before(function, value, end, level);
        if exits {
            self.first_without_exit = self.first_without_exit.max(level);
            self.first_without_effect = self.first_without_effect.max(level);
        }
        true
    }

    /// The values are parameters of the innermost loop or come before it.
    fn is_known_on_entry(&self, function: &Function, state: &[Value]) -> bool {
        self.levels.last().is_some_and(|level| {
            let header = self.cfg.loops()[level.id].header;
            state.iter().all(|&value| {
                self.position_of(function, value) < level.first
                    || matches!(function.op(value), Op::Param(_))
                        && function.block_of(value) == header
            })
        })
    }

    fn choose_level(
        &mut self,
        function: &Function,
        value: Value,
        effects: Effects,
        mut first: usize,
    ) -> Option<usize> {
        let block = function.block_of(value);
        if self.frequencies.is_cold(block) {
            first = first.max(self.levels.partition_point(|level| !level.is_cold));
        }
        // Bytes that do not change once they have been read may still be set on the way to the first read.
        let (read, only_so_far) = match function.op(value).access() {
            Some(access) if effects.has(EffectFlags::CONTROL_DEPENDENT) => {
                (access.heap(), access.has(AccessFlags::IMMUTABLE))
            }
            _ => (effects.reads, false),
        };
        let (mut groups, mut place) = (0, None);
        if read != Heap::NOTHING && first < self.levels.len() {
            first = first.max(self.levels.len().saturating_sub(MOST_LOOPS_TRIED));
            groups = self.writes.groups_overlapping(function, read);
            place = Place::of(function, value);
        }
        let frequency = self.frequencies.of_block(block);
        let is_suitable = |&index: &usize| {
            let level = &self.levels[index];
            let positions = self.cfg.loops()[level.id].positions();
            let mut writes = self.writes.at_positions(positions);
            if only_so_far {
                writes.end = self.writes_passed;
            }
            let mut patience = MOST_WRITES_COMPARED;
            level.accepts
                && frequency >= level.entries * LEAST_SHARE
                && !self
                    .writes
                    .may_change(function, writes, place.as_ref(), groups, &mut patience)
        };
        (first..self.levels.len())
            .take(MOST_LOOPS_TRIED)
            .find(is_suitable)
    }

    /// It takes no instruction of its own here, and before the loop it would not free enough registers.
    fn is_cheaper_in_place(&mut self, function: &Function, value: Value) -> bool {
        let least_freed = match *function.op(value) {
            Op::Compare(..) | Op::Binary(Binary::And, _) => 2,
            Op::FloatCompare(..) => 1,
            Op::Binary(Binary::Add | Binary::Shl, _) if function.type_of(value) == Type::I64 => 1,
            _ => return false,
        };
        if self.usage.len() == 0 {
            self.usage = count_uses(function, self.cfg, self.target);
        }
        let usage = self.usage[value];
        let operands = function.operands(value).iter();
        usage.is_absorbed
            && usage.count <= MOST_USES_ABSORBED
            && operands
                .filter(|&&operand| self.has_one_use(function, operand))
                .count()
                < least_freed
    }

    fn has_one_use(&self, function: &Function, mut value: Value) -> bool {
        while self.usage[value].count == 1 {
            match *function.op(value) {
                Op::Unary(Unary::Wrap | Unary::Widen(Sign::Unsigned), same_register) => {
                    value = same_register;
                }
                ref op => return !op.is_floating(),
            }
        }
        false
    }

    fn entering_edge(&mut self, function: &mut Function, level: usize) -> Edge {
        let level = &mut self.levels[level];
        if level.entering.is_none() {
            level.entering = edge_from_preheader(function, self.cfg, level.id);
            self.positions_of_new_blocks.resize(
                function.block_count() - self.old_block_count,
                level.first - 1,
            );
        }
        level.entering
    }

    /// With the operands that have waited for a user to move, of which a sum may have such operands itself.
    fn move_before(&self, function: &mut Function, value: Value, next: Value, level: usize) {
        function.move_before(value, next);
        for position in 0..function.operands(value).len() {
            let operand = function.operands(value)[position];
            if self.could_be_at(operand).is_some()
                && self.position_of_block(function.block_of(operand)) >= self.levels[level].first
            {
                self.move_before(function, operand, value, level);
            }
        }
    }
}

/// Gives the state the values of the first turn.
fn enter_state(function: &mut Function, value: Value, entering: Edge) {
    let (state, header) = (function.state_of(value), function.target(entering));
    let on_entry = |&kept: &Value| match *function.op(kept) {
        Op::Param(position) if function.block_of(kept) == header => {
            function.args(entering)[position as usize]
        }
        _ => kept,
    };
    let values: Vec<Value> = function.state(state).iter().map(on_entry).collect();
    let state = function.map_state(state, |kept| kept);
    function.state_mut(state).copy_from_slice(&values);
    function.set_state_of(value, state);
}

fn count_uses(function: &Function, cfg: &Cfg, target: Target) -> Table<Value, Usage> {
    let mut usage = function.value_table(Usage {
        count: 0,
        is_absorbed: true,
        could_be_at: STAYS,
    });
    let mut add = |value: Value, is_absorbed: bool| {
        let usage = &mut usage[value];
        usage.count = usage.count.saturating_add(1);
        usage.is_absorbed &= is_absorbed;
    };
    let mut last_state = State::NONE;
    for &block in cfg.order() {
        for user in function.instructions(block) {
            for (position, &operand) in function.operands(user).iter().enumerate() {
                add(operand, absorbs(function, user, position, target));
            }
            let state = function.state_of(user);
            if !state.is_none() && core::mem::replace(&mut last_state, state) != state {
                for &kept in function.state(state) {
                    add(kept, false);
                }
            }
        }
        for edge in function.successors(block) {
            for &arg in function.args(edge) {
                add(arg, false);
            }
        }
    }
    usage
}

fn absorbs(function: &Function, user: Value, position: usize, target: Target) -> bool {
    let operand = function.op(function.operands(user)[position]);
    match *function.op(user) {
        Op::Branch(_) | Op::Check(..) | Op::Select(_) => {
            position == 0 && !matches!(operand, Op::Binary(Binary::Add | Binary::Shl, _))
        }
        Op::Load { offset, .. } | Op::Store { offset, .. } => {
            position + 1 == function.operands(user).len() && (offset == 0 || target.is_x64())
        }
        Op::Binary(Binary::Add, _) => matches!(*operand, Op::Binary(Binary::Shl, [_, amount])
            if function.int_constant(amount).is_some_and(|amount| (0..=GREATEST_SCALE_LOG2).contains(&amount))),
        _ => false,
    }
}
