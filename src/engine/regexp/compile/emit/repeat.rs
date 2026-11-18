//! Repeated groups.

use super::memo::Surroundings;
use super::output::{Label, Section};
use super::state::{Action, Entry, Fail, Spot};
use super::{Captures, Emitter, Turn};
use crate::Error;
use crate::compile::graph::{Form, Id, Kind, Traits};
use crate::compile::memory::push;
use crate::program::{
    Comparison, Op, Pairs, Place, Room, ScopeKind, Slot, UNBOUNDED, WORK_OF_GOING_BACK,
};

#[derive(Clone, Copy)]
pub(super) struct Repeat {
    pub(super) body: Id,
    pub(super) min: u32,
    pub(super) max: u32,
    pub(super) pairs: Pairs,
    pub(super) rest: u32,
    pub(super) is_counted: bool,
    /// Whether it pays to look if a turn has been taken from the same place before.
    pub(super) is_worth_visits: bool,
}

const TURNS_NOT_WORTH_VISITS: u32 = 16;

/// What code inside a loop changes for itself.
pub(super) struct Outside {
    turn: Turn,
    weight: u32,
    repeats: bool,
    following: u32,
    surroundings: Surroundings,
    is_in_loop: bool,
}

/// How a loop without frames knows the number of its turns.
#[derive(Clone, Copy)]
pub(super) enum Count {
    NotNeeded,
    /// By the distance from the start, in turns of that many units. Zero if they differ but none is empty.
    Distance(Place, u32),
    Number(Slot),
}

impl Emitter<'_> {
    pub(super) fn repeat(&mut self, id: Id, rest: u32, fail: Fail) -> Result<Fail, Error> {
        let node = &self.graph[id];
        let Kind::Repeat {
            body,
            min,
            max,
            greedy,
            form,
            is_counted,
        } = node.kind
        else {
            unreachable!("the node is a loop")
        };
        let repeat = Repeat {
            body,
            min,
            max,
            pairs: node.pairs,
            rest,
            is_counted,
            is_worth_visits: self.repeats
                && min != max
                && node.is(Traits::CAN_BE_IN_VAIN)
                && (form != Form::Possessive || max > TURNS_NOT_WORTH_VISITS),
        };
        let is_stepped = matches!(form, Form::Possessive | Form::Stepped)
            && max != 0
            && self.graph.turns_are_alike(body);
        if min == 0 && !repeat.pairs.is_empty() && !is_stepped {
            self.record(Op::Clear {
                pairs: repeat.pairs,
            })?;
        }
        let written = self.entries_written();
        let back = match form {
            _ if max == 0 => fail,
            _ if is_stepped => self.stepped(id, repeat, form == Form::Stepped, fail)?,
            Form::Possessive => self.possessive(repeat, fail)?,
            Form::Extended => self.extended(repeat, fail)?,
            _ if greedy => self.stacked_greedy(repeat, fail)?,
            _ => self.stacked_lazy(repeat, fail)?,
        };
        self.note_written_since(written, repeat.pairs)?;
        Ok(back)
    }

    pub(super) fn enter_loop(&mut self, required: Option<(Slot, u32)>) -> Outside {
        let outside = Outside {
            turn: self.turn,
            weight: self.weight,
            repeats: self.repeats,
            following: self.following,
            surroundings: self.surroundings,
            is_in_loop: core::mem::replace(&mut self.is_in_loop, true),
        };
        self.turn.required = required;
        self.weight = self.weight.saturating_mul(8);
        self.repeats = true;
        self.following = UNBOUNDED;
        outside
    }

    pub(super) fn leave_loop(&mut self, outside: &Outside) {
        self.turn = outside.turn;
        self.weight = outside.weight;
        self.repeats = outside.repeats;
        self.following = outside.following;
        self.surroundings = outside.surroundings;
        self.is_in_loop = outside.is_in_loop;
    }

    /// What holds wherever a turn can start or the loop can end.
    pub(super) fn room_between_turns(&self, repeat: Repeat) -> Room {
        self.state.room.with(self.direction, repeat.rest)
    }

    pub(super) fn need_turn(&mut self, repeat: Repeat, fail: Fail) -> Result<(), Error> {
        let min = self.graph[repeat.body].min;
        self.need(min.saturating_add(repeat.rest), fail)
    }

    #[inline(never)]
    fn start_count(&mut self, repeat: Repeat) -> Result<Count, Error> {
        let body = &self.graph[repeat.body];
        if repeat.min == 0 && repeat.max == UNBOUNDED {
            self.settle()?;
            return Ok(Count::NotNeeded);
        }
        if body.min != 0 && (body.min == body.max || (repeat.min, repeat.max) == (1, UNBOUNDED)) {
            let length = if body.min == body.max { body.min } else { 0 };
            return Ok(Count::Distance(self.settle_at_anchor()?, length));
        }
        let slot = self.plan_scope(1, ScopeKind::Numbers)?;
        push(self.actions, Action::Protect(Op::Zero { slot }))?;
        self.settle()?;
        Ok(Count::Number(slot))
    }

    /// Goes to `to` if there have been that many turns, or if there have not.
    pub(super) fn compare_count(
        &mut self,
        count: Count,
        turns: u32,
        is_reached: bool,
        to: Label,
    ) -> Option<Op> {
        match count {
            _ if turns == if is_reached { UNBOUNDED } else { 0 } => None,
            Count::NotNeeded => None,
            Count::Distance(start, length) => {
                let units = turns.checked_mul(length.max(1))?;
                self.compare_distance(start, units, is_reached, to)
            }
            Count::Number(slot) => {
                self.weigh(slot);
                Some(Op::CompareNumber {
                    when: if is_reached {
                        Comparison::AtLeast
                    } else {
                        Comparison::Below
                    },
                    slot,
                    value: turns,
                    to,
                })
            }
        }
    }

    pub(super) fn branch_on_count(
        &mut self,
        count: Count,
        turns: u32,
        is_reached: bool,
        to: Label,
    ) -> Result<(), Error> {
        let Some(op) = self.compare_count(count, turns, is_reached, to) else {
            return Ok(());
        };
        if let Op::ComparePlace { when, place, .. } = op {
            let at_slot = self
                .room_at(Place { delta: 0, ..place })
                .unwrap_or_default();
            self.state.room = self.state.room.unless(when, at_slot, place.delta.into());
        }
        self.op(op)
    }

    /// For a loop that does not move.
    pub(super) fn spend_on_empty_turn(&mut self, repeat: Repeat) -> Result<(), Error> {
        match repeat.min != 0 && self.graph[repeat.body].min == 0 {
            true => self.op(Op::Spend {
                work: WORK_OF_GOING_BACK,
            }),
            false => Ok(()),
        }
    }

    /// For a loop without frames, whose turns are all the same from the first on that passes nothing.
    fn start_unstacked_turn(&mut self, repeat: Repeat) -> Result<Option<Spot>, Error> {
        match repeat.min > 1 && self.graph[repeat.body].min == 0 {
            true => self.spot().map(Some),
            false => Ok(None),
        }
    }

    /// Goes to `after_required` if the turn stands for all that are still required.
    #[inline(never)]
    fn end_unstacked_turn(
        &mut self,
        repeat: Repeat,
        count: Count,
        (entry, start): (Entry, Option<Spot>),
        after_required: Label,
    ) -> Result<(), Error> {
        if !self.state.is_reachable {
            return Ok(());
        }
        if let (Some(start), Count::Number(slot)) = (start, count) {
            self.settle()?;
            let (to, value) = (self.output.label()?, repeat.min);
            self.op(Op::ComparePlace {
                when: Comparison::Equal,
                offset: 0,
                place: start.place,
                to,
            })?;
            (self.output).bind(to, Section::Cold, self.state.room, slot.scope);
            (self.output).op(Section::Cold, Op::RaiseTo { slot, value })?;
            (self.output).op(Section::Cold, Op::Again { to: after_required })?;
        }
        self.release(entry)?;
        self.settle()?;
        if let Count::Number(slot) = count {
            let counted = self.output.label()?;
            if repeat.max == UNBOUNDED {
                self.branch_on_count(count, repeat.min, true, counted)?;
            }
            self.spend_on_empty_turn(repeat)?;
            self.weigh(slot);
            self.op(Op::Increment { slot })?;
            self.bind(counted)?;
        }
        self.count_turn(repeat.is_counted)
    }

    fn required_turns(count: Count, repeat: Repeat) -> Option<(Slot, u32)> {
        match count {
            Count::Number(slot) if repeat.min != 0 => Some((slot, repeat.min)),
            _ => None,
        }
    }

    fn possessive(&mut self, repeat: Repeat, fail: Fail) -> Result<Fail, Error> {
        let count = self.start_count(repeat)?;
        let (head, done) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (self.room_between_turns(repeat), self.state.planned);
        let outside = self.enter_loop(Self::required_turns(count, repeat));
        self.surround_with_count(count, repeat, 1)?;
        self.bind_settled(head, room, scope)?;
        self.branch_on_count(count, repeat.max, true, done)?;
        self.visit_turn(repeat.is_worth_visits, done)?;
        let entry = self.entry();
        let turn_fails = match repeat.min == repeat.max {
            true => self.need_turn(repeat, fail).map(|()| fail)?,
            false => self.fail_to_end_of_loop(repeat, done)?,
        };
        let start = self.start_unstacked_turn(repeat)?;
        // A visit fails where nothing else does.
        let can_end_early =
            self.captures == Captures::Written && self.memoizing.is_none() && start.is_none();
        self.last_of_turn = can_end_early.then_some(entry);
        self.node(repeat.body, repeat.rest, turn_fails)?;
        let after_required = if repeat.min == repeat.max { done } else { head };
        self.end_unstacked_turn(repeat, count, (entry, start), after_required)?;
        self.go_again(head)?;
        self.leave_loop(&outside);
        self.bind_settled(done, room, scope)?;
        self.doubt_visit(repeat.is_worth_visits, Section::Main)?;
        if repeat.min != repeat.max {
            let too_few = self.target(fail)?;
            self.branch_on_count(count, repeat.min, false, too_few)?;
        }
        Ok(fail)
    }

    /// With the position and the captures that the turn before has left.
    #[inline(never)]
    fn fail_to_end_of_loop(&mut self, repeat: Repeat, done: Label) -> Result<Fail, Error> {
        let no_room = self.fail_directly_to(done)?;
        self.need_turn(repeat, no_room)?;
        let metered = self.is_costly(repeat.body, 1);
        let undo = self.plan_undo(metered)?;
        let pairs = repeat.pairs;
        if pairs.is_empty() {
            return self.fail_to(done, undo);
        }
        if self.memoizing.is_none() && self.writes_captures_last(repeat.body) {
            self.captures = Captures::Held;
            return self.fail_to(done, undo);
        }
        let slot = self.plan_scope(pairs.entries().len() as u32, ScopeKind::Numbers)?;
        let undo = undo.with_captures(slot, pairs);
        self.protect_turn(Op::SaveCaptures { slot, pairs }, undo)?;
        self.fail_to(done, undo)
    }

    /// Whether nothing fails once a capture is written, if that is put off for as long as possible.
    fn writes_captures_last(&self, body: Id) -> bool {
        let sequence = match self.graph[body].kind {
            Kind::Turn(inner) => inner,
            _ => body,
        };
        let Kind::Sequence(children) = self.graph[sequence].kind else {
            return false;
        };
        let terms = || {
            self.graph
                .children_of(children)
                .iter()
                .map(|&it| &self.graph[it])
        };
        let from_first_close = terms().skip_while(|it| !matches!(it.kind, Kind::Close(_)));
        let mut after_tests = from_first_close.skip_while(|it| matches!(it.kind, Kind::Close(_)));
        terms().all(|it| it.is_bookkeeping() || !it.is(Traits::WRITES))
            && after_tests.all(|it| it.is(Traits::CANNOT_FAIL))
    }

    fn extended(&mut self, repeat: Repeat, fail: Fail) -> Result<Fail, Error> {
        let count = self.start_count(repeat)?;
        let (turn, done) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (self.room_between_turns(repeat), self.state.planned);
        if repeat.min == 0 {
            self.jump(done)?;
        }
        let outside = self.enter_loop(Self::required_turns(count, repeat));
        self.surround_with_count(count, repeat, 1)?;
        self.bind_settled(turn, room, scope)?;
        let exhausted = self.later_target(fail)?;
        self.visit_turn(repeat.is_worth_visits, exhausted)?;
        let entry = self.entry();
        self.need_turn(repeat, fail)?;
        let start = self.start_unstacked_turn(repeat)?;
        self.node(repeat.body, repeat.rest, fail)?;
        self.end_unstacked_turn(repeat, count, (entry, start), done)?;
        if repeat.min > 1 && self.state.is_reachable {
            self.branch_on_count(count, repeat.min, true, done)?;
            self.go_again(turn)?;
        }
        self.leave_loop(&outside);
        self.bind_settled(done, room, scope)?;
        let (direct, later) = self.bind_retry(repeat.body)?;
        if let Some(op) = self.compare_count(count, repeat.max, true, exhausted) {
            self.output.op(Section::Cold, op)?;
        }
        self.output.op(Section::Cold, Op::Again { to: turn })?;
        self.repeats = true;
        self.fail_to_either(direct, later)
    }
}
