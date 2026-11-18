//! Repeated groups that keep a frame for each turn.

use super::Emitter;
use super::output::{Label, Section, between_turns_of};
use super::repeat::{Count, Repeat};
use super::state::{Fail, Undo};
use crate::Error;
use crate::compile::graph::Traits;
use crate::compile::memory::push;
use crate::program::{Loop, LoopId, Op, Room, ScopeKind, SiteId, Slot};

#[derive(Clone, Copy)]
struct Labels {
    turn: Label,
    pop: Label,
    retreat: Label,
    /// Between turns, where the loop can end.
    done: Label,
}

/// For all that can be done between two turns, or for all that starts with a turn.
#[derive(Clone, Copy)]
struct Sites {
    of_all: Option<SiteId>,
    of_turn: Option<SiteId>,
}

impl Emitter<'_> {
    #[inline(never)]
    fn enter_stacked(&mut self, repeat: Repeat) -> Result<(LoopId, Labels), Error> {
        self.settle()?;
        let id = LoopId(self.output.program.loops.len() as u32);
        let turns = self.plan_scope(1, ScopeKind::Turns(id))?;
        let in_turn = self.plan_scope(0, ScopeKind::InTurn(id))?.scope;
        let labels = Labels {
            turn: self.output.label()?,
            pop: self.output.label()?,
            retreat: self.output.label()?,
            done: self.output.label()?,
        };
        let it = Loop {
            turns,
            in_turn,
            between_turns: between_turns_of(id),
            end_cell: turns.cell + 1,
            pairs: repeat.pairs,
            room: Room::NONE,
            back_into_turn: labels.pop,
        };
        push(&mut self.output.program.loops, it)?;
        self.op(Op::Enter { id })?;
        Ok((id, labels))
    }

    fn turns(&self, id: LoopId) -> Count {
        Count::Number(self.output.program.loops[id.index()].turns)
    }

    #[inline(never)]
    fn start_turn(
        &mut self,
        id: LoopId,
        repeat: Repeat,
        no_turn: Label,
        pop: Label,
    ) -> Result<Fail, Error> {
        let in_turn = self.output.program.loops[id.index()].in_turn;
        self.state.planned = in_turn;
        self.protect_turn(Op::Push { id }, Undo::pop(id, in_turn))?;
        let turn_fails = self.fail_to_either(no_turn, pop)?;
        self.need_turn(repeat, turn_fails)?;
        self.output.program.loops[id.index()].room = self.state.room;
        self.count_turn(repeat.is_counted)?;
        Ok(turn_fails)
    }

    #[inline(never)]
    fn end_turn(&mut self, id: LoopId, repeat: Repeat, back: Fail, to: Label) -> Result<(), Error> {
        if self.state.is_reachable {
            self.settle()?;
            self.spend_on_empty_turn(repeat)?;
            let back_into_turn = self.later_target(back)?;
            let it = &mut self.output.program.loops[id.index()];
            it.back_into_turn = back_into_turn;
            it.end_cell = self.output.program.scopes[self.state.planned.index()].height;
            self.op(Op::Turned { id, to })?;
            self.state.is_reachable = false;
        }
        let it = self.output.program.loops[id.index()];
        let kind = ScopeKind::BetweenTurns(id);
        let between_turns = self.output.add_scope(it.turns.scope, it.end_cell, kind)?;
        self.output.program.loops[id.index()].between_turns = between_turns.scope;
        for cell in it.turns.cell..it.end_cell.min(it.turns.cell + 4) {
            self.weigh(Slot { cell, ..it.turns });
        }
        Ok(())
    }

    fn write_pop(&mut self, id: LoopId, pop: Label, section: Section) -> Result<(), Error> {
        let in_turn = self.output.program.loops[id.index()].in_turn;
        self.write_undo(pop, section, Undo::pop(id, in_turn))
    }

    fn write_retreat(&mut self, id: LoopId, retreat: Label, none: Label) -> Result<(), Error> {
        self.output
            .bind(retreat, Section::Cold, Room::NONE, between_turns_of(id));
        self.output.op(Section::Cold, Op::Retreat { id, none })
    }

    /// What follows the loop is left out if it can read what the last turn has captured.
    #[inline(never)]
    fn site_between_turns(&mut self, id: LoopId, repeat: Repeat) -> Result<Sites, Error> {
        let surroundings = self.surroundings;
        self.repeats = true;
        self.surround_with_count(self.turns(id), repeat, 0)?;
        let site = self.site()?;
        self.surroundings = surroundings;
        let is_read = self.graph[repeat.body].is(Traits::REFERENCED);
        Ok(Sites {
            of_turn: site.filter(|_| is_read),
            of_all: site.filter(|_| !is_read),
        })
    }

    fn start_of_turn(&mut self, id: LoopId, label: Label, room: Room) -> Result<(), Error> {
        self.bind_settled(label, room, self.state.planned)?;
        self.state.scope = between_turns_of(id);
        self.bind(label)
    }

    /// One turn, which goes on at `then`.
    fn stacked_turn(
        &mut self,
        id: LoopId,
        repeat: Repeat,
        no_turn: Label,
        pop: Label,
        then: Label,
        sites: Sites,
    ) -> Result<(), Error> {
        let turns = self.output.program.loops[id.index()].turns;
        let required = (repeat.min != 0).then(|| (turns, repeat.min.saturating_add(1)));
        let outside = self.enter_loop(required);
        self.surround_with_count(self.turns(id), repeat, 1)?;
        let turn_fails = self.start_turn(id, repeat, no_turn, pop)?;
        self.precedes_visit = sites.of_all.is_some();
        let back = self.node(repeat.body, repeat.rest, turn_fails)?;
        self.end_turn(id, repeat, back, then)?;
        self.leave_loop(&outside);
        self.repeats = true;
        Ok(())
    }

    pub(super) fn stacked_greedy(&mut self, repeat: Repeat, fail: Fail) -> Result<Fail, Error> {
        let (id, labels) = self.enter_stacked(repeat)?;
        let room = self.room_between_turns(repeat);
        let sites = self.site_between_turns(id, repeat)?;
        self.start_of_turn(id, labels.turn, room)?;
        self.visit(sites.of_all, labels.retreat)?;
        self.branch_on_count(self.turns(id), repeat.max, true, labels.done)?;
        self.visit(sites.of_turn, labels.done)?;
        self.stacked_turn(id, repeat, labels.done, labels.pop, labels.turn, sites)?;
        self.write_pop(id, labels.pop, Section::Main)?;
        let between_turns = self.output.program.loops[id.index()].between_turns;
        self.bind_settled(labels.done, room, between_turns)?;
        self.doubt_visit(sites.of_turn.is_some(), Section::Main)?;
        let none = self.later_target(fail)?;
        self.write_retreat(id, labels.retreat, none)?;
        self.branch_on_count(self.turns(id), repeat.min, false, labels.retreat)?;
        self.fail_to_either(labels.retreat, labels.retreat)
    }

    pub(super) fn stacked_lazy(&mut self, repeat: Repeat, fail: Fail) -> Result<Fail, Error> {
        let (id, labels) = self.enter_stacked(repeat)?;
        let room = self.room_between_turns(repeat);
        let sites = self.site_between_turns(id, repeat)?;
        if repeat.min == 0 {
            self.jump(labels.done)?;
        }
        self.start_of_turn(id, labels.turn, room)?;
        self.visit(sites.of_turn, labels.retreat)?;
        self.stacked_turn(id, repeat, labels.retreat, labels.pop, labels.done, sites)?;
        let between_turns = self.output.program.loops[id.index()].between_turns;
        self.bind_settled(labels.done, room, between_turns)?;
        self.visit(sites.of_all, labels.retreat)?;
        if repeat.min > 1 {
            self.branch_on_count(self.turns(id), repeat.min, false, labels.turn)?;
        }
        let none = self.later_target(fail)?;
        self.write_pop(id, labels.pop, Section::Cold)?;
        self.write_retreat(id, labels.retreat, none)?;
        let (direct, later) = self.bind_retry(repeat.body)?;
        if let Some(op) = self.compare_count(self.turns(id), repeat.max, true, labels.retreat) {
            self.output.op(Section::Cold, op)?;
        }
        self.output
            .op(Section::Cold, Op::Jump { to: labels.turn })?;
        self.fail_to_either(direct, later)
    }
}
