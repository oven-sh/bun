//! Moves instructions to where they are needed, if control gets there less often.

use super::Analyses;
use crate::analysis::{Cfg, Dominators, Frequencies};
use crate::ir::{
    Block, Edge, Effects, Entity, Function, Heap, HeapRange, Op, State, Table, Type, Value,
};
use crate::target::Target;

const GREATEST_SHARE: f32 = 0.5;
const MOST_BLOCKS_PASSED: usize = 4;
const MOST_LOOPS_LEFT: usize = 8;

/// The nearest place that comes before all uses of a value.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Needed {
    Nowhere,
    In(Block),
    Along(Edge),
}

/// What happens in a block, or in the rest of it.
#[derive(Clone, Copy)]
struct Obstacles {
    writes: HeapRange,
    /// The collector may run.
    calls: bool,
}

impl Obstacles {
    const NONE: Self = Self {
        writes: HeapRange::EMPTY,
        calls: false,
    };
}

struct Sinking<'a> {
    cfg: &'a Cfg,
    dominators: &'a Dominators,
    frequencies: &'a Frequencies,
    needed: Table<Value, Needed>,
    obstacles: Table<Block, Obstacles>,
    /// The position of the first block with a call after the current one.
    next_call: u32,
    last_state: (State, Block),
    old_block_count: usize,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let (cfg, dominators, frequencies) = analyses.all(function);
    if cfg.order().len() < 2 {
        return;
    }
    let mut sinking = Sinking {
        cfg,
        dominators,
        frequencies,
        needed: function.value_table(Needed::Nowhere),
        obstacles: function.block_table(Obstacles::NONE),
        next_call: u32::MAX,
        last_state: (State::NONE, Block::NONE),
        old_block_count: function.block_count(),
    };
    for &block in cfg.order().iter().rev() {
        sinking.visit(function, block);
    }
    if function.block_count() != sinking.old_block_count {
        analyses.invalidate();
    }
}

impl Sinking<'_> {
    fn visit(&mut self, function: &mut Function, block: Block) {
        let has_choice = function.successors(block).len() > 1;
        for edge in function.successors(block) {
            let place = if has_choice && function.is_rare(edge) {
                Needed::Along(edge)
            } else {
                Needed::In(block)
            };
            for &arg in function.args(edge) {
                self.need(function, arg, place);
            }
        }
        let mut rest = Obstacles::NONE;
        let mut value = function.last(block);
        while !value.is_none() {
            let previous = function.previous(value);
            let effects = function.effects(value);
            let place = self.try_to_sink(function, value, effects, rest);
            let place = place.unwrap_or(Needed::In(block));
            for &operand in function.operands(value) {
                self.need(function, operand, place);
            }
            if let Some(state) = function.state_of(value).expand()
                && core::mem::replace(&mut self.last_state, (state, block)) != (state, block)
            {
                for &kept in function.state(state) {
                    self.need(function, kept, place);
                }
            }
            if effects.must_execute() {
                rest.writes = rest.writes.hull(function.heap_range(effects.writes));
                rest.calls |= matches!(
                    function.op(value),
                    Op::Patchpoint(_) | Op::Node { .. } | Op::WideNode { .. }
                );
            }
            value = previous;
        }
        self.obstacles[block] = rest;
        if rest.calls {
            self.next_call = self.cfg.position(block);
        }
    }

    #[inline]
    fn need(&mut self, function: &Function, value: Value, place: Needed) {
        let (known, home) = (self.needed[value], function.block_of(value));
        if known == place
            || known == Needed::In(home)
            || home.is_none()
            || matches!(function.op(value), Op::Param(_))
        {
            return;
        }
        let block_of = |place| match place {
            Needed::Nowhere => None,
            Needed::In(block) => Some(block),
            Needed::Along(edge) => Some(function.source(edge)),
        };
        self.needed[value] = match (block_of(known), block_of(place)) {
            (Some(a), Some(b)) => {
                let common = self.dominators.common_dominator(a, b);
                Needed::In(common.expect("the definition dominates both"))
            }
            _ => place,
        };
    }

    fn try_to_sink(
        &self,
        function: &mut Function,
        value: Value,
        effects: Effects,
        rest: Obstacles,
    ) -> Option<Needed> {
        let home = function.block_of(value);
        let needed = self.needed[value];
        if needed == Needed::In(home)
            || effects.must_execute()
            || !function.type_of(value).is_data()
            || !function.state_of(value).is_none()
            || matches!(function.op(value), Op::Extract(..) | Op::Patchpoint(_))
        {
            return None;
        }
        let place = self.outside_other_loops(function, needed, home)?;
        let (block, frequency, is_cold) = match place {
            Needed::Nowhere => return None,
            Needed::In(block) => (
                block,
                self.frequencies.of_block(block),
                self.frequencies.is_cold(block),
            ),
            Needed::Along(edge) => (function.source(edge), self.frequencies.of_edge(edge), true),
        };
        let is_rarer = is_cold && !self.frequencies.is_cold(home)
            || frequency <= self.frequencies.of_block(home) * GREATEST_SHARE;
        if !is_rarer || !self.can_pass(function, value, effects, rest, block, place) {
            return None;
        }
        let target = match place {
            Needed::Along(edge) if function.target(edge).index() < self.old_block_count => {
                function.split_edge(edge)
            }
            Needed::Along(edge) => function.target(edge),
            _ => block,
        };
        function.move_before(value, function.first(target));
        Some(place)
    }

    /// The last place on the way that is in no loop but those around `home`, unless that is `home`.
    fn outside_other_loops(
        &self,
        function: &Function,
        mut place: Needed,
        home: Block,
    ) -> Option<Needed> {
        for _ in 0..MOST_LOOPS_LEFT {
            let block = match place {
                Needed::Nowhere => return None,
                Needed::In(block) if block == home => return None,
                Needed::In(block) => block,
                Needed::Along(edge) => function.source(edge),
            };
            match self.cfg.loop_of(block).expand() {
                Some(around) if !self.cfg.includes(around, home) => {
                    let data = self.cfg.loops()[around];
                    let inside = if data.is_natural { data.header } else { block };
                    place = Needed::In(self.dominators.parent(inside)?);
                }
                _ => return Some(place),
            }
        }
        None
    }

    /// `block` is the place, or the source of the edge that is.
    fn can_pass(
        &self,
        function: &Function,
        value: Value,
        effects: Effects,
        rest: Obstacles,
        mut block: Block,
        place: Needed,
    ) -> bool {
        // The operands may not tell the collector what an address does.
        let minds_calls = function.type_of(value) == Type::I64;
        let minds_writes = effects.reads != Heap::NOTHING;
        if !minds_calls && !minds_writes {
            return true;
        }
        let read = function.heap_range(effects.reads);
        let stops = |found: Obstacles| minds_calls && found.calls || read.overlaps(found.writes);
        let home = function.block_of(value);
        let passes_block = block != home && place != Needed::In(block);
        if stops(rest) || passes_block && stops(self.obstacles[block]) {
            return false;
        }
        if block == home || !minds_writes && self.next_call >= self.cfg.position(block) {
            return true;
        }
        for _ in 0..MOST_BLOCKS_PASSED {
            let [only] = *self.cfg.predecessors(block) else {
                return false;
            };
            block = function.source(only);
            if block == home {
                return true;
            }
            if stops(self.obstacles[block]) {
                return false;
            }
        }
        false
    }
}
