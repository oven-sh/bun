//! Ways through one node.

use bun_engine_codegen::ir::{
    Block, Entity, Function, Op, State, Successor, Table, Type, Value as Ssa,
};

use super::Lowering;

const MOST_COPIED_ARGS: usize = 4;

/// That a condition holds.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Odds {
    Low,
    Even,
    High,
}

impl Odds {
    pub(super) fn low_unless(is_expected: bool) -> Self {
        if is_expected { Self::Even } else { Self::Low }
    }
}

/// Where the ways come together again.
#[derive(Clone, Copy)]
pub(super) struct Meeting {
    join: Block,
    result: Ssa,
    afterwards: Block,
}

/// Where several ways lead that all give the same.
#[derive(Clone, Copy, Default)]
pub(super) struct Detour(Option<Block>);

/// Up to two.
pub(super) fn count_uses(function: &Function) -> Table<Ssa, u8> {
    let mut uses = function.value_table(0);
    let mut count = |values: &[Ssa]| values.iter().for_each(|&it| uses[it] = uses[it].min(1) + 1);
    for block in function.blocks() {
        (function.instructions(block)).for_each(|value| count(function.operands(value)));
        (function.successors(block)).for_each(|edge| count(function.args(edge)));
    }
    (0..function.state_count()).for_each(|it| count(function.state(State::from_index(it))));
    uses
}

impl Lowering<'_> {
    /// Each way from here on ends with `give`. With `Type::Void` it gives `NONE`.
    pub(super) fn part(&mut self, ty: Type) -> Meeting {
        let function = &mut self.graph.function;
        let (join, afterwards) = match self.open.expand() {
            Some(_) => {
                let join = function.new_block();
                (join, join)
            }
            None => {
                self.open = function.block_of(self.at);
                (function.split_before(self.at), Block::NONE)
            }
        };
        let result = if ty == Type::Void {
            Ssa::NONE
        } else {
            function.add_param(join, ty)
        };
        Meeting {
            join,
            result,
            afterwards,
        }
    }

    pub(super) fn give(&mut self, meeting: Meeting, value: Ssa) {
        self.ir().jump(meeting.join, value.expand().as_slice());
        self.arrivals.push(self.open);
    }

    pub(super) fn meet(&mut self, meeting: Meeting) -> Ssa {
        self.open = meeting.afterwards;
        meeting.result
    }

    fn new_block(&mut self) -> Block {
        self.graph.function.new_block()
    }

    /// Goes to `target` if the condition holds, and on if it does not.
    fn leave_if(&mut self, condition: Ssa, odds: Odds, target: Block) {
        if self.graph.function.is_int_constant(condition, 0) {
            return;
        }
        let rest = self.new_block();
        let way = |block: Block, is_rare| Successor {
            is_rare,
            ..block.into()
        };
        let ways = (
            way(target, odds == Odds::Low),
            way(rest, odds == Odds::High),
        );
        self.ir().branch(condition, ways.0, ways.1);
        self.open = rest;
    }

    pub(super) fn detour_if(&mut self, condition: Ssa, odds: Odds, detour: &mut Detour) {
        if !self.graph.function.is_int_constant(condition, 0) {
            let target = *(detour.0).get_or_insert_with(|| self.graph.function.new_block());
            self.leave_if(condition, odds, target);
        }
    }

    pub(super) fn take_detour(&mut self, detour: &mut Detour) {
        let target = *(detour.0).get_or_insert_with(|| self.graph.function.new_block());
        self.ir().jump(target, &[]);
    }

    /// Goes on there, unless no way has led there. The current way has ended.
    pub(super) fn follow(&mut self, detour: Detour) -> bool {
        detour.0.inspect(|&block| self.open = block).is_some()
    }

    /// After the other ways have ended.
    pub(super) fn meet_after(
        &mut self,
        meeting: Meeting,
        detour: Detour,
        along: impl FnOnce(&mut Self) -> Ssa,
    ) -> Ssa {
        if self.follow(detour) {
            let given = along(self);
            self.give(meeting, given);
        }
        self.meet(meeting)
    }

    /// Goes on in a block that `repeat_if` comes back to, and gives the value that changes from turn to turn.
    pub(super) fn begin_loop(&mut self, first: Ssa) -> Ssa {
        let (header, ty) = (self.new_block(), self.graph.function.type_of(first));
        let value = self.graph.function.add_param(header, ty);
        self.ir().jump(header, &[first]);
        self.open = header;
        value
    }

    pub(super) fn repeat_if(&mut self, condition: Ssa, value: Ssa, next: Ssa) {
        let (header, rest) = (self.graph.function.block_of(value), self.new_block());
        (self.ir()).branch(condition, Successor::new(header, &[next]), rest);
        self.open = rest;
    }

    /// `choose` for several values.
    pub(super) fn choose_all<const COUNT: usize>(
        &mut self,
        condition: Ssa,
        odds: Odds,
        types: [Type; COUNT],
        then: impl FnOnce(&mut Self) -> [Ssa; COUNT],
        or: impl FnOnce(&mut Self) -> [Ssa; COUNT],
    ) -> [Ssa; COUNT] {
        let (meeting, taken) = (self.part(Type::Void), self.new_block());
        let results = types.map(|ty| self.graph.function.add_param(meeting.join, ty));
        self.leave_if(condition, odds, taken);
        let given = or(self);
        self.ir().jump(meeting.join, &given);
        self.open = taken;
        let given = then(self);
        self.ir().jump(meeting.join, &given);
        self.meet(meeting);
        results
    }

    /// The result is what `then` gives if the condition holds. Goes on if it does not.
    pub(super) fn give_if(
        &mut self,
        meeting: Meeting,
        condition: Ssa,
        odds: Odds,
        then: impl FnOnce(&mut Self) -> Ssa,
    ) {
        if self.graph.function.is_int_constant(condition, 0) {
            return;
        }
        let taken = self.new_block();
        self.leave_if(condition, odds, taken);
        let rest = core::mem::replace(&mut self.open, taken);
        let given = then(self);
        self.give(meeting, given);
        self.open = rest;
    }

    pub(super) fn answer_if(&mut self, meeting: Meeting, condition: Ssa, odds: Odds, answer: bool) {
        self.give_if(meeting, condition, odds, |this| this.int32(answer.into()));
    }

    /// What `then` or `or` gives, of which only one is run.
    pub(super) fn choose(
        &mut self,
        condition: Ssa,
        odds: Odds,
        ty: Type,
        then: impl FnOnce(&mut Self) -> Ssa,
        or: impl FnOnce(&mut Self) -> Ssa,
    ) -> Ssa {
        match self.graph.function.int_constant(condition) {
            Some(0) => return or(self),
            Some(_) => return then(self),
            None => {}
        }
        let meeting = self.part(ty);
        self.give_if(meeting, condition, odds, then);
        let given = or(self);
        self.give(meeting, given);
        self.meet(meeting)
    }

    /// `value` if the condition holds.
    pub(super) fn unless(
        &mut self,
        condition: Ssa,
        value: Ssa,
        or: impl FnOnce(&mut Self) -> Ssa,
    ) -> Ssa {
        self.choose(condition, Odds::Even, Type::I64, |_| value, or)
    }

    pub(super) fn when(&mut self, condition: Ssa, odds: Odds, then: impl FnOnce(&mut Self)) {
        let then = |this: &mut Self| {
            then(this);
            Ssa::NONE
        };
        self.choose(condition, odds, Type::Void, then, |_| Ssa::NONE);
    }

    /// If all that is done with what has replaced the node is to branch on it, each way does so itself.
    pub(super) fn branch_directly(&mut self, node: Ssa, replacement: Ssa) {
        let function = &mut self.graph.function;
        if self.arrivals.is_empty() || !matches!(function.op(replacement), Op::Param(_)) {
            return;
        }
        let join = function.block_of(replacement);
        let end = function.first(join).expand().map(|it| *function.op(it));
        if let Some(end @ (Op::Branch(subject) | Op::Switch(subject, _))) = end
            && subject == node
            && self.uses[node] == 1
        {
            for edge in function.successors(join) {
                if function.args(edge).len() > MOST_COPIED_ARGS {
                    function.split_edge(edge);
                }
            }
            self.bypass(join, join, end);
        }
    }

    /// `join` leads to `last`, which does nothing but end like that.
    fn bypass(&mut self, join: Block, last: Block, end: Op) -> bool {
        let mut is_bypassed = true;
        for position in 0..self.arrivals.len() {
            let (function, way) = (&mut self.graph.function, self.arrivals[position]);
            if function.is_removed(way) || *function.op(function.last(way)) != Op::Jump {
                continue;
            }
            let (jump, edge) = (function.last(way), function.successor(way, 0));
            if function.target(edge) != join {
                continue;
            }
            let given = function.args(edge)[0];
            if function.first(way) == jump && function.params(way) == [given] {
                is_bypassed &= self.bypass(way, last, end);
            } else if let Some(constant) = function.int_constant(given) {
                let taken = match end {
                    Op::Switch(_, cases) => {
                        let keys = function.cases(cases);
                        (keys.iter().position(|&key| key == constant)).unwrap_or(keys.len())
                    }
                    _ => usize::from(constant == 0),
                };
                function.clear_successors(way);
                function.push_copy_of(way, function.successor(last, taken));
            } else if let Op::Branch(_) = end {
                *function.op_mut(jump) = Op::Branch(given);
                function.clear_successors(way);
                for edge in function.successors(last) {
                    function.push_copy_of(way, edge);
                }
            } else {
                is_bypassed = false;
            }
        }
        if is_bypassed {
            self.graph.function.remove_block(join);
        }
        is_bypassed
    }
}
