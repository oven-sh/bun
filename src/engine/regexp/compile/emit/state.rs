//! What is known where code is being written, what has been put off, and where failures go.

use super::Emitter;
use super::output::{Label, ROOT, Section};
use crate::Error;
use crate::compile::graph::{Id, MAX_REACH, NEAR};
use crate::compile::memory::push;
use crate::program::{
    Direction, LoopId, MAX_LENGTH, Op, Pairs, Place, Room, ScopeId, ScopeKind, Slot,
};

#[derive(Clone, Copy)]
pub(super) struct State {
    /// From the position to where the pattern has got.
    pub(super) offset: i32,
    pub(super) room: Room,
    /// Changes whenever something is done that a failure has to undo.
    pub(super) epoch: u32,
    pub(super) scope: ScopeId,
    /// The scope once the actions are done.
    pub(super) planned: ScopeId,
    /// Equal to the position once the actions are done.
    pub(super) anchor: Option<Place>,
    /// Whether an action that starts a turn is put off. It cannot be done twice without `turn_undo`.
    pub(super) is_before_turn: bool,
    /// The actions before this one are done.
    pub(super) first_action: u32,
    pub(super) is_reachable: bool,
}

impl State {
    pub(super) const INITIAL: State = State {
        offset: 0,
        room: Room::NONE,
        epoch: 0,
        scope: ROOT,
        planned: ROOT,
        anchor: None,
        is_before_turn: false,
        first_action: 0,
        is_reachable: true,
    };
}

#[derive(Clone, Copy)]
pub(super) enum Action {
    /// Keeps what a failure needs.
    Protect(Op),
    /// Writes captures.
    Record(Op),
}

/// To come back to.
#[derive(Clone, Copy)]
pub(super) struct Snapshot {
    pub(super) state: State,
    actions: u32,
}

/// What a node has to give back when it is done.
#[derive(Clone, Copy)]
pub(super) struct Entry {
    epoch: u32,
    pub(super) planned: ScopeId,
    actions: u32,
}

/// A place in the subject that the pattern has got to.
#[derive(Clone, Copy)]
pub(super) struct Spot {
    epoch: u32,
    offset: i32,
    pub(super) place: Place,
}

impl Spot {
    pub(super) const NOWHERE: Spot = Spot {
        epoch: NEVER,
        offset: 0,
        place: Place {
            slot: Slot {
                cell: 0,
                scope: ROOT,
            },
            delta: 0,
        },
    };
}

pub(super) enum Located {
    Offset(i16),
    Place(Place),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Fail(u32);

impl Fail {
    pub(super) const NO_MATCH: Fail = Fail(0);
}

/// How to get back to an earlier state.
#[derive(Clone, Copy)]
pub(super) struct Undo {
    position: Restore,
    captures: Option<(Slot, Pairs)>,
    scope: ScopeId,
}

#[derive(Clone, Copy)]
enum Restore {
    Load { from: Place, metered: bool },
    Pop(LoopId),
}

impl Undo {
    pub(super) fn pop(id: LoopId, in_turn: ScopeId) -> Undo {
        Undo {
            position: Restore::Pop(id),
            captures: None,
            scope: in_turn,
        }
    }

    pub(super) fn with_captures(self, slot: Slot, pairs: Pairs) -> Undo {
        Undo {
            captures: Some((slot, pairs)),
            scope: slot.scope,
            ..self
        }
    }
}

/// What is tried after a failure.
#[derive(Clone, Copy)]
pub(super) struct Alternative {
    /// For as long as the epoch lasts.
    direct: Label,
    epoch: u32,
    after_undo: AfterUndo,
}

#[derive(Clone, Copy)]
enum AfterUndo {
    Written(Label),
    Unwritten(Undo),
}

const NEVER: u32 = u32::MAX;

/// How often code that runs once may go back far without counting that as work.
pub(super) const FREE_RETURNS: usize = 8;

impl Emitter<'_> {
    /// Writes an operation after the tests that wait.
    pub(super) fn op(&mut self, op: Op) -> Result<(), Error> {
        self.write_tests()?;
        self.output.op(Section::Main, op)
    }

    pub(super) fn jump(&mut self, to: Label) -> Result<(), Error> {
        if self.state.is_reachable {
            self.op(Op::Jump { to })?;
            self.state.is_reachable = false;
        }
        Ok(())
    }

    pub(super) fn go_again(&mut self, to: Label) -> Result<(), Error> {
        if self.state.is_reachable {
            self.op(Op::Again { to })?;
            self.state.is_reachable = false;
        }
        Ok(())
    }

    pub(super) fn jump_to_fail(&mut self, fail: Fail) -> Result<(), Error> {
        if self.state.is_reachable {
            let to = self.target(fail)?;
            self.jump(to)?;
        }
        Ok(())
    }

    /// The state says what holds for all that come to the label.
    pub(super) fn bind(&mut self, label: Label) -> Result<(), Error> {
        self.write_tests()?;
        let state = &mut self.state;
        state.is_reachable = true;
        self.output
            .bind(label, Section::Main, state.room, state.scope);
        Ok(())
    }

    /// For a place that is reached with different positions and nothing put off.
    pub(super) fn bind_settled(
        &mut self,
        label: Label,
        room: Room,
        scope: ScopeId,
    ) -> Result<(), Error> {
        self.write_tests()?;
        self.state = State {
            offset: 0,
            room,
            epoch: self.new_epoch(),
            scope: self.output.without_reservations(scope),
            planned: scope,
            anchor: None,
            is_before_turn: false,
            first_action: self.actions.len() as u32,
            is_reachable: true,
        };
        self.bind(label)
    }

    fn new_epoch(&mut self) -> u32 {
        self.epochs += 1;
        self.epochs
    }

    pub(super) fn snapshot(&mut self) -> Result<Snapshot, Error> {
        self.write_tests()?;
        Ok(Snapshot {
            state: self.state,
            actions: self.actions.len() as u32,
        })
    }

    pub(super) fn restore(&mut self, snapshot: &Snapshot) -> Result<(), Error> {
        self.write_tests()?;
        self.state = snapshot.state;
        self.actions.truncate(snapshot.actions as usize);
        Ok(())
    }

    pub(super) fn entry(&self) -> Entry {
        Entry {
            epoch: self.state.epoch,
            planned: self.state.planned,
            actions: self.actions.len() as u32,
        }
    }

    pub(super) fn is_unchanged_since(&self, entry: Entry) -> bool {
        self.state.epoch == entry.epoch
    }

    /// Gives up the cells that were taken since.
    pub(super) fn release(&mut self, entry: Entry) -> Result<(), Error> {
        if self.state.planned == entry.planned || !self.state.is_reachable {
            return Ok(());
        }
        let first = entry.actions.max(self.state.first_action) as usize;
        let reads_released = |action: &Action| match action {
            Action::Record(Op::CapturePlace { place, .. }) => place.slot.scope > entry.planned,
            _ => false,
        };
        let has_to_record = self.actions[first..].iter().any(reads_released);
        let mut kept = first;
        for index in first..self.actions.len() {
            if let action @ Action::Record(_) = self.actions[index] {
                self.actions[kept] = action;
                kept += 1;
            }
        }
        self.actions.truncate(kept);
        if has_to_record {
            self.commit()?;
        }
        let state = &mut self.state;
        state.planned = entry.planned;
        if state.scope > entry.planned && !state.is_before_turn {
            state.scope = self.output.without_reservations(entry.planned);
        }
        state.anchor = state.anchor.filter(|it| it.slot.scope <= entry.planned);
        Ok(())
    }

    /// For when the turn can no longer fail.
    pub(super) fn release_turn(&mut self, turn: Entry) -> Result<(), Error> {
        self.write_tests()?;
        // Alternatives that are still to be written need the actions as they are.
        let pending = self.state.first_action as usize..self.actions.len();
        self.state.first_action = pending.end as u32;
        for index in pending {
            if let Action::Record(op) = self.actions[index] {
                self.record(op)?;
            }
        }
        self.release(turn)?;
        self.state.is_before_turn = false;
        Ok(())
    }

    /// For cells above those that are taken.
    pub(super) fn plan_scope(&mut self, cells: u32, kind: ScopeKind) -> Result<Slot, Error> {
        let parent = self.state.planned;
        let height = self.output.height(parent) + cells;
        let slot = self.output.add_scope(parent, height, kind)?;
        self.state.planned = slot.scope;
        Ok(slot)
    }

    pub(super) fn record(&mut self, op: Op) -> Result<(), Error> {
        push(self.actions, Action::Record(op))
    }

    pub(super) fn pending_actions(&self) -> usize {
        self.actions.len() - self.state.first_action as usize
    }

    /// Does what has been put off, except for moving.
    pub(super) fn commit(&mut self) -> Result<(), Error> {
        self.write_tests()?;
        for index in self.state.first_action as usize..self.actions.len() {
            let (Action::Protect(op) | Action::Record(op)) = self.actions[index];
            self.output.op(Section::Main, op)?;
        }
        self.state.first_action = self.actions.len() as u32;
        self.state.scope = self.output.without_reservations(self.state.planned);
        self.state.is_before_turn = false;
        self.state.epoch = self.new_epoch();
        Ok(())
    }

    /// For when nothing can fail any more.
    pub(super) fn write_records(&mut self) -> Result<(), Error> {
        for index in self.state.first_action as usize..self.actions.len() {
            if let Action::Record(op) = self.actions[index] {
                self.op(op)?;
            }
        }
        Ok(())
    }

    /// Does all that has been put off.
    pub(super) fn settle(&mut self) -> Result<(), Error> {
        if !self.state.is_reachable {
            return Ok(());
        }
        self.commit()?;
        self.advance(self.state.offset)?;
        self.state.offset = 0;
        Ok(())
    }

    /// Nothing is put off.
    pub(super) fn advance(&mut self, by: i32) -> Result<(), Error> {
        if by != 0 {
            self.op(Op::Advance { by })?;
            let state = &mut self.state;
            state.room = state.room.moved(by).unwrap_or(Room::NONE);
            state.anchor = state.anchor.and_then(|anchor| {
                let delta = anchor.delta.checked_add(by)?;
                Some(Place { delta, ..anchor })
            });
        }
        Ok(())
    }

    /// After an operation that has moved the position by a distance that depends on the subject.
    pub(super) fn moved(&mut self, at_least: u32, rest: u32) {
        let room = self
            .state
            .room
            .moved(self.direction.signed(at_least as i32));
        self.state.room = room.unwrap_or(Room::NONE).with(self.direction, rest);
        self.state.anchor = None;
    }

    pub(super) fn keep_offsets_short(&mut self) -> Result<(), Error> {
        match self.state.offset.unsigned_abs() > 8 * MAX_REACH {
            true => self.settle(),
            false => Ok(()),
        }
    }

    pub(super) fn room_at(&self, place: Place) -> Option<Room> {
        match self.output.program.scopes[place.slot.scope.index()].kind {
            ScopeKind::Position(room) => room.moved(place.delta),
            _ => None,
        }
    }

    /// A place that will be equal to the position, and is known to have that room.
    pub(super) fn anchor(&mut self, room: Room) -> Result<Place, Error> {
        if let Some(anchor) = self.state.anchor
            && self.room_at(anchor).is_some_and(|known| known.covers(room))
        {
            return Ok(anchor);
        }
        let slot = self.plan_scope(1, ScopeKind::Position(self.state.room))?;
        self.weigh(slot);
        push(self.actions, Action::Protect(Op::Save { slot }))?;
        let anchor = Place { slot, delta: 0 };
        self.state.anchor = Some(anchor);
        Ok(anchor)
    }

    /// Where the pattern has got.
    pub(super) fn spot(&mut self) -> Result<Spot, Error> {
        let offset = self.state.offset;
        let anchor = self.anchor(Room {
            ahead: offset.max(0).unsigned_abs(),
            behind: offset.min(0).unsigned_abs(),
        })?;
        Ok(Spot {
            epoch: self.state.epoch,
            offset,
            place: Place {
                delta: anchor.delta + offset,
                ..anchor
            },
        })
    }

    pub(super) fn locate(&mut self, spot: Spot) -> Located {
        match spot.epoch == self.state.epoch {
            true => Located::Offset(spot.offset as i16),
            false => Located::Place(self.weigh_place(spot.place)),
        }
    }

    /// Fails unless that many units follow where the pattern has got.
    pub(super) fn need(&mut self, units: u32, fail: Fail) -> Result<(), Error> {
        self.need_toward(self.direction, units, fail)
    }

    pub(super) fn has_toward(&self, direction: Direction, units: u32) -> bool {
        self.count_toward(direction, units) <= self.state.room.toward(direction).into()
    }

    fn count_toward(&self, direction: Direction, units: u32) -> i64 {
        i64::from(direction.signed(self.state.offset)) + i64::from(units)
    }

    pub(super) fn need_toward(
        &mut self,
        direction: Direction,
        units: u32,
        fail: Fail,
    ) -> Result<(), Error> {
        if self.has_toward(direction, units) || !self.state.is_reachable {
            return Ok(());
        }
        let count = self.count_toward(direction, units);
        if count > MAX_LENGTH.into() || units > MAX_LENGTH {
            return self.jump_to_fail(fail);
        }
        if fail != self.tests_fail {
            self.write_tests()?;
        }
        let op = Op::Need {
            direction,
            count: count as u32,
            fail: self.target(fail)?,
        };
        self.output.op(Section::Main, op)?;
        self.state.room = self.state.room.with(direction, count as u32);
        Ok(())
    }

    fn add_alternative(&mut self, alternative: Alternative) -> Result<Fail, Error> {
        push(self.alternatives, alternative)?;
        Ok(Fail(self.alternatives.len() as u32 - 1))
    }

    /// Whether going back to before the node that many times has to count as work.
    pub(super) fn is_costly(&mut self, id: Id, times: usize) -> bool {
        if self.graph[id].extent() <= NEAR {
            return false;
        }
        let left = self.free_returns_left.checked_sub(times);
        let left = left.filter(|_| !self.repeats);
        self.free_returns_left = left.unwrap_or(self.free_returns_left);
        left.is_none()
    }

    /// Makes it possible to get back to the state as it is afterwards.
    pub(super) fn plan_undo(&mut self, metered: bool) -> Result<Undo, Error> {
        if let Some(mut undo) = self.turn.undo.filter(|_| self.state.is_before_turn) {
            let restored = match &mut undo.position {
                Restore::Load {
                    from,
                    metered: is_metered,
                } => {
                    *is_metered |= metered;
                    self.room_at(*from).unwrap_or_default()
                }
                Restore::Pop(id) => self.output.program.loops[id.index()].room,
            };
            if restored.covers(self.state.room) {
                return Ok(undo);
            }
            self.commit()?;
        }
        let from = self.anchor(self.state.room)?;
        Ok(Undo {
            position: Restore::Load { from, metered },
            captures: None,
            scope: self.output.without_reservations(self.state.planned),
        })
    }

    /// `op` is the first action of a turn that cannot be done twice.
    pub(super) fn protect_turn(&mut self, op: Op, undo: Undo) -> Result<(), Error> {
        self.turn.undo = Some(undo);
        self.state.is_before_turn = true;
        push(self.actions, Action::Protect(op))
    }

    /// Failures go to `direct`, which expects the present state.
    pub(super) fn fail_to(&mut self, direct: Label, undo: Undo) -> Result<Fail, Error> {
        self.add_alternative(Alternative {
            direct,
            epoch: self.state.epoch,
            after_undo: AfterUndo::Unwritten(undo),
        })
    }

    /// The same for code that only tests.
    pub(super) fn fail_directly_to(&mut self, direct: Label) -> Result<Fail, Error> {
        self.fail_to_either(direct, direct)
    }

    /// Failures go to `direct` in this epoch and to `later` after it.
    pub(super) fn fail_to_either(&mut self, direct: Label, later: Label) -> Result<Fail, Error> {
        self.add_alternative(Alternative {
            direct,
            epoch: self.state.epoch,
            after_undo: AfterUndo::Written(later),
        })
    }

    /// Where a failure goes from here.
    pub(super) fn target(&mut self, fail: Fail) -> Result<Label, Error> {
        let alternative = self.alternatives[fail.0 as usize];
        match alternative.epoch == self.state.epoch {
            true => Ok(alternative.direct),
            false => self.later_target(fail),
        }
    }

    /// Where a failure goes in a later epoch.
    pub(super) fn later_target(&mut self, fail: Fail) -> Result<Label, Error> {
        let alternative = self.alternatives[fail.0 as usize];
        let undo = match alternative.after_undo {
            AfterUndo::Written(label) => return Ok(label),
            AfterUndo::Unwritten(undo) => undo,
        };
        let label = self.output.label()?;
        self.write_undo(label, Section::Cold, undo)?;
        let to = alternative.direct;
        self.output.op(Section::Cold, Op::Jump { to })?;
        self.alternatives[fail.0 as usize].after_undo = AfterUndo::Written(label);
        Ok(label)
    }

    pub(super) fn write_undo(
        &mut self,
        label: Label,
        section: Section,
        undo: Undo,
    ) -> Result<(), Error> {
        self.output.bind(label, section, Room::NONE, undo.scope);
        let op = match undo.position {
            Restore::Pop(id) => Op::Pop { id },
            Restore::Load { from, metered } => Op::Load {
                from: self.weigh_place(from),
                metered,
            },
        };
        self.output.op(section, op)?;
        match undo.captures {
            Some((slot, pairs)) => self.output.op(section, Op::RestoreCaptures { slot, pairs }),
            None => Ok(()),
        }
    }
}
