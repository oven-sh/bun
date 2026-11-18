//! Several ways through one instruction.

use bun_engine_codegen::ir::{Block, State, Successor, Value as Ssa};

use super::Builder;
use super::frame::Junction;
use crate::graph::SavedKnowledge;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Odds {
    Even,
    /// The condition rarely holds.
    Low,
}

pub(super) struct Fork {
    state: State,
    effects: u32,
    is_cut_off: bool,
    knowledge: SavedKnowledge,
    junction: Junction,
}

impl Builder<'_> {
    /// Before the block is ended, as long as the instruction has had no effect.
    pub(super) fn fork(&mut self) -> Fork {
        let mut fork = self.fork_later();
        fork.knowledge = self.knowledge.save();
        fork
    }

    /// The first way has begun. The others start at junctions that it leaves for.
    pub(super) fn fork_later(&mut self) -> Fork {
        Fork {
            state: self.state(),
            effects: self.effects,
            is_cut_off: self.is_cut_off,
            knowledge: SavedKnowledge::default(),
            junction: Junction::default(),
        }
    }

    /// For a junction that carries no value, if the integer is not zero. This way has had no effect yet.
    pub(super) fn leave_if(&mut self, condition: Ssa, odds: Odds, junction: &mut Junction) {
        debug_assert!(!self.has_had_effect);
        self.leave_or_stay(condition, true, odds, junction);
    }

    /// The same once it has. The way that starts at the junction is taken with `enter`.
    pub(super) fn leave_afterwards_if(&mut self, condition: Ssa, odds: Odds, to: &mut Junction) {
        self.leave_or_stay(condition, true, odds, to);
    }

    pub(super) fn leave_unless(&mut self, condition: Ssa, odds: Odds, junction: &mut Junction) {
        debug_assert!(!self.has_had_effect);
        self.leave_or_stay(condition, false, odds, junction);
    }

    fn leave_or_stay(&mut self, condition: Ssa, leaves: bool, odds: Odds, to: &mut Junction) {
        let constant = self.graph.function.int_constant(condition);
        if constant.is_some_and(|it| (it != 0) != leaves) {
            return;
        }
        let function = &mut self.graph.function;
        let away = Successor {
            is_rare: odds == Odds::Low,
            ..(*to.block.get_or_insert_with(|| function.new_block())).into()
        };
        // Nothing leads there if the condition is a constant.
        let next = function.new_block();
        if leaves {
            self.ir().branch(condition, away, next);
        } else {
            self.ir().branch(condition, next, away);
        }
        let position = usize::from(!leaves && constant.is_none());
        let undo = self.assume_condition(condition, leaves);
        self.scratch.clear();
        self.join(
            to,
            self.graph.function.successor(self.block, position),
            false,
            false,
        );
        self.undo_assumption(undo);
        self.assume_condition(condition, !leaves);
        self.block = next;
    }

    /// Takes the way that starts at the junction, to which something leads.
    pub(super) fn resume_at(&mut self, fork: &Fork, junction: &Junction) {
        self.enter(junction).expect("a way there");
        (self.checkpoint, self.has_had_effect) = (fork.state, false);
    }

    /// False if no way leads there.
    pub(super) fn resume_if_reached(&mut self, fork: &Fork, junction: &Junction) -> bool {
        let is_reached = !junction.edges.is_empty();
        if is_reached {
            self.resume_at(fork, junction);
        }
        is_reached
    }

    pub(super) fn take_way(&mut self, fork: &Fork, block: Block) {
        (self.block, self.is_cut_off) = (block, fork.is_cut_off);
        self.checkpoint = fork.state;
        (self.has_had_effect, self.needs_invalidation_point) = (false, false);
        self.knowledge.restore(&fork.knowledge);
    }

    /// Does nothing if control does not get to the end.
    pub(super) fn end_way(&mut self, fork: &mut Fork, result: Option<Ssa>) {
        if !self.block.is_none() {
            self.leave_for(&mut fork.junction, result);
        }
    }

    /// The result, if there is one and control goes on.
    pub(super) fn end_fork(&mut self, fork: &Fork) -> Option<Ssa> {
        self.end_fork_at(fork, &fork.junction)
            .then(|| fork.junction.values.first().copied())?
    }

    /// For ways that meet elsewhere. False if control does not go on.
    pub(super) fn end_fork_at(&mut self, fork: &Fork, junction: &Junction) -> bool {
        if self.enter(junction).is_none() {
            return false;
        }
        if self.effects == fork.effects {
            (self.checkpoint, self.has_had_effect) = (fork.state, false);
        } else {
            self.note_effect();
        }
        true
    }

    /// The same, at the end of the last way.
    pub(super) fn end_last_way(&mut self, mut fork: Fork, result: Option<Ssa>) -> Option<Ssa> {
        if fork.junction.edges.is_empty() {
            return result.filter(|_| !self.block.is_none());
        }
        self.end_way(&mut fork, result);
        self.end_fork(&fork)
    }

    /// `translate` is told whether the integer is not zero.
    pub(super) fn choose(
        &mut self,
        condition: Ssa,
        odds: Odds,
        mut translate: impl FnMut(&mut Self, bool) -> Option<Ssa>,
    ) -> Option<Ssa> {
        if let Some(constant) = self.graph.function.int_constant(condition) {
            return translate(self, constant != 0);
        }
        let (mut fork, mut holds) = (self.fork_later(), Junction::default());
        self.leave_if(condition, odds, &mut holds);
        let result = translate(self, false);
        self.end_way(&mut fork, result);
        self.resume_at(&fork, &holds);
        let result = translate(self, true);
        self.end_last_way(fork, result)
    }
}
