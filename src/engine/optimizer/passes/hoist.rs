//! Moves checks, loads and conversions that are the same in every turn of a loop to before the loop.

use bun_engine_codegen::analysis::{Cfg, Frequencies, Loop};
use bun_engine_codegen::ir::{
    AccessFlags, Binary, Block, Builder, Edge, EffectFlags, Entity, Heap, Op, Origin, State, Table,
    Type, Unary, Value as Ssa,
};
use bun_engine_codegen::passes::{Analyses, edge_from_preheader};
use bun_engine_vm::SpeculatedType as T;
use smallvec::SmallVec;

use super::loop_writes::LoopWrites;
use crate::graph::{ExitKind, Graph, Kind, ShapeSet, heaps};

const MOST_LOOPS_TRIED: usize = 4;
const MOST_INPUTS_FOLLOWED: usize = 24;
/// The least chances that a turn comes to an instruction. With this one, a check fails in the first turn anyway.
const CERTAIN: f32 = 0.99;
/// It is worth the risk that the check fails where it does not belong.
const LIKELY: f32 = 0.4;
/// It is worth the work.
const POSSIBLE: f32 = 0.03;
const STAYS: u32 = u32::MAX;

/// A loop around the current block.
struct Level {
    id: Loop,
    /// The position of the header.
    first: u32,
    /// The chance that a turn comes to the next level.
    reach: f32,
    checkpoint: Option<Ssa>,
    may_speculate: bool,
    /// An assumption may have failed on the way in, and there is no invalidation point before that of the header.
    follows_effect: bool,
    entering: Edge,
    /// For what is certain to be reached, and for the rest.
    states: [State; 2],
}

struct Hoisting<'a> {
    graph: &'a mut Graph,
    cfg: &'a Cfg,
    frequencies: &'a Frequencies,
    writes: LoopWrites,
    ends_in_doubt: Table<Block, bool>,
    levels: Vec<Level>,
    /// For each of the innermost levels, the chance that a turn comes to the current block.
    chances: SmallVec<[f32; MOST_LOOPS_TRIED]>,
    /// For what moves only if a user does: a position at which it could be.
    could_be_at: Table<Ssa, u32>,
    /// The latest position at which something is found out about a value, or done to it.
    guarded_at: Table<Ssa, u32>,
    all_guarded_at: u32,
    old_block_count: usize,
    positions_of_new_blocks: Vec<u32>,
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let loops = analyses.cfg(&mut graph.function).loops();
    if !loops.values().any(|it| it.is_natural) {
        return;
    }
    let (cfg, frequencies) = analyses.frequencies(&mut graph.function);
    let mut hoisting = Hoisting {
        writes: LoopWrites::new(graph, cfg),
        ends_in_doubt: ends_in_doubt(graph, cfg),
        levels: Vec::new(),
        chances: SmallVec::new(),
        could_be_at: graph.function.value_table(STAYS),
        guarded_at: graph.function.value_table(0),
        all_guarded_at: 0,
        old_block_count: graph.function.block_count(),
        positions_of_new_blocks: Vec::new(),
        graph,
        cfg,
        frequencies,
    };
    for &block in cfg.order() {
        if !cfg.loop_of(block).is_none() {
            hoisting.visit(block);
        }
    }
    if !hoisting.positions_of_new_blocks.is_empty() {
        analyses.invalidate();
    }
}

/// Where an assumption may have failed since the last invalidation point.
fn ends_in_doubt(graph: &Graph, cfg: &Cfg) -> Table<Block, bool> {
    let function = &graph.function;
    let (mut in_doubt, mut undecided) = (function.block_table(false), Vec::new());
    for &block in cfg.order() {
        let decided = function.instructions_backward(block).find_map(|value| {
            let written = function.effects(value).writes;
            if function.may_alias(written, heaps::WATCHPOINT_STATES) {
                return Some(true);
            }
            (graph.kind(value) == Some(Kind::InvalidationPoint)).then_some(false)
        });
        match decided {
            Some(decided) => in_doubt[block] = decided,
            None => undecided.push(block),
        }
    }
    loop {
        let before = undecided.len();
        undecided.retain(|&block| {
            let mut edges = cfg.predecessors(block).iter();
            in_doubt[block] = edges.any(|&edge| in_doubt[function.source(edge)]);
            !in_doubt[block]
        });
        if undecided.len() == before {
            return in_doubt;
        }
    }
}

/// It takes as long to fetch the result from where it is kept as to compute it.
fn is_cheap(graph: &Graph, value: Ssa) -> bool {
    let function = &graph.function;
    match *function.op(value) {
        Op::Unary(op, _) => matches!(op, Unary::Wrap | Unary::Widen(_) | Unary::Opaque),
        Op::Binary(op, [_, rhs]) => {
            function.type_of(value).is_int()
                && (function.op(rhs).is_constant() && op != Binary::Mul || op == Binary::Add)
        }
        Op::Compare(..) | Op::FloatCompare(..) => true,
        _ => matches!(
            graph.kind(value),
            Some(Kind::BoxInt32 | Kind::BoxBoolean | Kind::BoxDouble | Kind::ShadowFrame)
        ),
    }
}

fn looks_into_operand(graph: &Graph, value: Ssa) -> bool {
    match (graph.function.op(value), graph.node(value)) {
        (_, Some((Kind::CheckType | Kind::IsType, data))) => {
            let check = graph.type_check_at(data);
            check.wanted.intersects(T::CELL) && !check.known.contains(T::HEAP_TOP)
        }
        (_, Some((kind, _))) => !matches!(
            kind,
            Kind::NumberToDouble | Kind::PrimitiveToDouble | Kind::CheckIdentical
        ),
        (op, None) => matches!(op, Op::Load { .. } | Op::Unary(Unary::FitsIn(_), _)),
    }
}

/// What has to be as expected for the instruction to be safe.
fn subjects(graph: &Graph, mut value: Ssa) -> Option<[Ssa; 2]> {
    while let Op::Unary(Unary::FitsIn(_) | Unary::Wrap, operand) = *graph.function.op(value) {
        value = operand;
    }
    let first = *graph.function.operands(value).first()?;
    let owned = graph.what_is_at(first);
    let both = owned.map_or_else(|| [graph.object_at(first); 2], |it| [it.owner, it.pointer]);
    Some(both.map(|it| graph.root(it)))
}

impl Hoisting<'_> {
    fn visit(&mut self, block: Block) {
        self.enter(block);
        let (mut value, last) = (
            self.graph.function.first(block),
            self.graph.function.last(block),
        );
        while value != last {
            let next = self.graph.function.next(value);
            self.try_to_hoist(value);
            self.note_guard(value);
            value = next;
        }
        if let Op::Branch(tested) | Op::Switch(tested, _) = *self.graph.function.op(last) {
            self.guard_what_decides(tested, block);
        }
    }

    /// An access below a test may count on the answer without being tied to it.
    fn guard_what_decides(&mut self, tested: Ssa, block: Block) {
        let mut inputs: SmallVec<[Ssa; 16]> = smallvec::smallvec![tested];
        for position in 0..MOST_INPUTS_FOLLOWED {
            let Some(&input) = inputs.get(position) else {
                return;
            };
            let (graph, function) = (&*self.graph, &self.graph.function);
            match *function.op(input) {
                Op::Compare(_, args) if args.iter().any(|&it| self.is_counter(it)) => {}
                Op::Load { access, .. } if heaps::has_only_values(access.heap()) => {}
                Op::FloatCompare(..) | Op::Checked(..) | Op::Binary(Binary::Mul, _) => {}
                Op::Load { address, .. } => {
                    inputs.extend(subjects(graph, input).into_iter().flatten());
                    inputs.push(address);
                }
                _ if graph.kind(input).is_some_and(Kind::has_effects) => {}
                _ => inputs.extend_from_slice(function.operands(input)),
            }
            self.guard(Some(input), block);
        }
        self.all_guarded_at = self.all_guarded_at.max(self.position_of_block(block));
    }

    /// An integer that the innermost loop counts with says nothing about what stays the same.
    fn is_counter(&self, mut value: Ssa) -> bool {
        let function = &self.graph.function;
        if let Op::Binary(Binary::Add, [from, by]) | Op::Checked(_, [from, by], _) =
            *function.op(value)
            && function.op(by).is_constant()
        {
            value = from;
        }
        matches!(function.op(value), Op::Param(_))
            && function.type_of(value) == Type::I32
            && (self.levels.last()).is_some_and(|it| self.position_of(value) >= it.first)
    }

    fn enter(&mut self, block: Block) {
        let (cfg, function) = (self.cfg, &self.graph.function);
        let around = |level: &Level| cfg.includes(level.id, block);
        self.levels.truncate(self.levels.partition_point(around));
        let turns = |level: &Level| self.frequencies.of_block(cfg.loops()[level.id].header);
        if let Some(id) = cfg.loop_headed_by(block) {
            let edges = cfg.predecessors(block).iter();
            let entering = edges.filter(|&&edge| !cfg.is_backward(function, edge));
            let follows_effect =
                (entering.clone()).any(|&edge| self.ends_in_doubt[function.source(edge)]);
            let entries: f32 = entering.map(|&edge| self.frequencies.of_edge(edge)).sum();
            if let Some(outer) = self.levels.last_mut() {
                outer.reach = entries / turns(outer);
            }
            let is_checkpoint = |&it: &Ssa| self.graph.kind(it) == Some(Kind::Checkpoint);
            let checkpoint = function.instructions(block).find(is_checkpoint);
            let has_failed =
                |it| (self.graph).has_exited(function.origin(it), ExitKind::HoistingFailedAgain);
            self.levels.push(Level {
                id,
                first: cfg.position(block),
                reach: 0.0,
                checkpoint,
                may_speculate: !checkpoint.is_none_or(has_failed),
                follows_effect,
                entering: Edge::NONE,
                states: [State::NONE; 2],
            });
        }
        self.chances.clear();
        let mut chance = self.frequencies.of_block(block) / turns(self.levels.last().unwrap());
        let mut outward = self.levels.iter().rev().take(MOST_LOOPS_TRIED).peekable();
        while let Some(level) = outward.next_if(|level| cfg.loops()[level.id].is_natural) {
            if !self.chances.is_empty() {
                chance *= level.reach;
            }
            self.chances.push(chance);
        }
    }

    fn note_guard(&mut self, value: Ssa) {
        let graph = &*self.graph;
        if let Op::Check(tested, _) = *graph.function.op(value) {
            return self.guard_what_decides(tested, graph.function.block_of(value));
        }
        let guarded = match (*graph.function.op(value), graph.kind(value)) {
            (Op::Store { args, access, .. }, _) if !heaps::has_only_values(access.heap()) => {
                Some(graph.object_at(args[1]))
            }
            (_, Some(kind)) if kind.gives_operand() || kind.effects().writes_memory() => {
                graph.function.operands(value).first().copied()
            }
            _ => None,
        };
        self.guard(guarded, graph.function.block_of(value));
    }

    fn guard(&mut self, guarded: Option<Ssa>, block: Block) {
        let position = self.position_of_block(block);
        if let Some(guarded) = guarded {
            let latest = &mut self.guarded_at[self.graph.root(guarded)];
            *latest = position.max(*latest);
        }
    }

    /// Or of what leads to it by fields that never change.
    fn last_guard_of(&self, mut value: Ssa) -> u32 {
        let mut latest = self.all_guarded_at;
        for _ in 0..MOST_INPUTS_FOLLOWED {
            latest = latest.max(self.guarded_at.get(value).copied().unwrap_or(0));
            match *self.graph.function.op(value) {
                Op::Load {
                    address, access, ..
                } if access.has(AccessFlags::IMMUTABLE) => value = self.graph.root(address),
                _ => return latest,
            }
        }
        STAYS
    }

    fn position_of_block(&self, block: Block) -> u32 {
        match block.index().checked_sub(self.old_block_count) {
            None => self.cfg.position(block),
            Some(_) if block.is_none() => 0,
            Some(index) => self.positions_of_new_blocks[index],
        }
    }

    fn position_of(&self, value: Ssa) -> u32 {
        match self.could_be_at.get(value) {
            Some(&position) if position != STAYS => position,
            _ => self.position_of_block(self.graph.function.block_of(value)),
        }
    }

    fn can_move(&self, value: Ssa) -> bool {
        let (graph, function) = (&*self.graph, &self.graph.function);
        let effects = function.effects(value);
        match *function.op(value) {
            // Not of what has been found to be stored there.
            Op::Unary(Unary::FitsIn(_), operand) => {
                operand.index() + 1 == value.index() || function.op(operand).access().is_some()
            }
            Op::Extract(..) => false,
            _ => {
                effects.at_most_exits()
                    && !effects.has(EffectFlags::CONTROL_DEPENDENT)
                    && (graph.node(value)).is_none_or(|node| self.can_move_node(value, node))
            }
        }
    }

    fn can_move_node(&self, value: Ssa, (kind, data): (Kind, u32)) -> bool {
        let (graph, operands) = (&*self.graph, self.graph.function.operands(value));
        let takes_anything = match kind {
            Kind::CheckType | Kind::IsType => {
                (graph.type_check_at(data).known).contains(graph.inherent_type(operands[0]))
            }
            Kind::CheckIdentical | Kind::IsCellOfType => true,
            _ => false,
        };
        let is_loose = |&operand: &Ssa| graph.is_loose(operand, kind.effects().reads);
        takes_anything || !operands.iter().any(is_loose)
    }

    fn is_changed_in(&self, id: Loop, value: Ssa, read: Heap) -> bool {
        let shapes = match self.graph.node(value) {
            Some((Kind::CheckShape, data)) => ShapeSet(data),
            _ => ShapeSet::ANY,
        };
        let function = &self.graph.function;
        self.writes.may_write(function, id, read)
            || function.may_alias(read, heaps::SHAPE)
                && self.writes.has_transition(self.graph, id, shapes)
    }

    fn try_to_hoist(&mut self, value: Ssa) {
        let Some(innermost) = self.levels.last().filter(|_| !self.chances.is_empty()) else {
            return;
        };
        let mut latest = 0;
        for &operand in self.graph.function.operands(value) {
            latest = latest.max(self.position_of(operand));
            if latest >= innermost.first {
                return;
            }
        }
        if !self.can_move(value) {
            return;
        }
        let function = &self.graph.function;
        let effects = function.effects(value);
        let (exits, read) = (effects.has(EffectFlags::EXITS), effects.reads);
        if looks_into_operand(self.graph, value)
            && let Some(subjects) = subjects(self.graph, value)
        {
            let guarded = subjects.map(|it| self.last_guard_of(it));
            latest = guarded.into_iter().fold(latest, u32::max);
        }
        let mut chosen = None;
        for (index, &chance) in (0..self.levels.len()).rev().zip(&self.chances) {
            let level = &self.levels[index];
            let least = match (exits, level.may_speculate) {
                (false, _) => POSSIBLE,
                (true, true) => LIKELY,
                (true, false) => CERTAIN,
            };
            if latest >= level.first
                || chance < least
                || exits && level.checkpoint.is_none()
                || read != Heap::NOTHING && self.is_changed_in(level.id, value, read)
            {
                break;
            }
            chosen = Some((index, chance));
        }
        let Some((level, chance)) = chosen else {
            return;
        };
        if is_cheap(self.graph, value) {
            self.could_be_at[value] = self.levels[level].first - 1;
            return;
        }
        let entering = self.entering_edge(level);
        if read != Heap::NOTHING && !self.notice_invalidation_before(level)
            || exits && !self.exit_before(value, level, chance < CERTAIN)
        {
            return;
        }
        let function = &self.graph.function;
        self.move_before(value, function.last(function.source(entering)), level);
    }

    fn entering_edge(&mut self, level: usize) -> Edge {
        let (level, graph) = (&mut self.levels[level], &mut *self.graph);
        if level.entering.is_none() {
            let old_value_count = graph.function.value_count();
            level.entering = edge_from_preheader(&mut graph.function, self.cfg, level.id);
            let new_blocks = graph.function.block_count() - self.old_block_count;
            (self.positions_of_new_blocks).resize(new_blocks, level.first - 1);
            let header = graph.function.target(level.entering);
            for position in 0..graph.function.params(header).len() {
                let arg = graph.function.args(level.entering)[position];
                if arg.index() >= old_value_count {
                    let param = graph.function.params(header)[position];
                    graph.declare(arg, graph.inherent_type(param));
                }
            }
        }
        level.entering
    }

    /// Returns false if there is no state to exit to.
    fn notice_invalidation_before(&mut self, level: usize) -> bool {
        if !self.levels[level].follows_effect {
            return true;
        }
        let Some(state) = self.state_before(level, false) else {
            return false;
        };
        let (level, function) = (&mut self.levels[level], &mut self.graph.function);
        let origin = function.origin(level.checkpoint.expect("has the state"));
        let last = function.last(function.source(level.entering));
        let mut ir = Builder::before(function, last);
        ir.origin = origin;
        ir.node(Kind::InvalidationPoint.id(), Type::Void, &[], 0, state);
        level.follows_effect = false;
        true
    }

    /// Returns false if there is no state to exit to.
    fn exit_before(&mut self, value: Ssa, level: usize, is_speculative: bool) -> bool {
        let Some(state) = self.state_before(level, is_speculative) else {
            return false;
        };
        if let Some(exit) = self.graph.function.op(value).exit()
            && is_speculative
        {
            let info = self.graph.exits[exit.token.0 as usize];
            let new = self.graph.exit(info.kind, info.origin, state);
            if let Op::Check(_, exit) | Op::Checked(_, _, exit) = self.graph.function.op_mut(value)
            {
                *exit = new;
            }
        }
        self.graph.function.set_state_of(value, state);
        true
    }

    fn state_before(&mut self, level: usize, is_speculative: bool) -> Option<State> {
        let (level, function) = (&mut self.levels[level], &mut self.graph.function);
        let known = &mut level.states[usize::from(is_speculative)];
        if known.is_none() {
            let (checkpoint, header) = (level.checkpoint?, function.target(level.entering));
            let at_header = function.state_of(checkpoint);
            let on_entry = |&held: &Ssa| match *function.op(held) {
                _ if function.block_of(held) != header => Some(held),
                Op::Param(position) => Some(function.args(level.entering)[position as usize]),
                _ => None,
            };
            let values: Option<SmallVec<[Ssa; 32]>> =
                function.state(at_header).iter().map(on_entry).collect();
            let Some(values) = values else {
                level.checkpoint = None;
                return None;
            };
            let mut values = values.into_iter();
            *known = function.map_state(at_header, |_| values.next().unwrap());
            if is_speculative {
                let origin: Origin = function.origin(checkpoint);
                self.graph.speculative_states.push((*known, origin));
            }
        }
        Some(*known)
    }

    /// With the operands that have waited for a user to move.
    fn move_before(&mut self, value: Ssa, next: Ssa, level: usize) {
        let mut pending: SmallVec<[(Ssa, Ssa); 8]> = smallvec::smallvec![(value, next)];
        while let Some((value, next)) = pending.pop() {
            let block = self.graph.function.block_of(value);
            if self.position_of_block(block) >= self.levels[level].first {
                self.graph.function.move_before(value, next);
                self.could_be_at[value] = STAYS;
                let operands = self.graph.function.operands(value).iter();
                pending.extend(operands.map(|&operand| (operand, value)));
            }
        }
    }
}
