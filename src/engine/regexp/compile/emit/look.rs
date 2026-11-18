//! Lookahead and lookbehind.

use super::Emitter;
use super::alternation::ACTIONS_REPEATED;
use super::memo::Surroundings;
use super::output::Section;
use super::state::Fail;
use crate::Error;
use crate::compile::graph::{Id, Traits};
use crate::compile::memory::push;
use crate::program::{Direction, Look, LookId, Op, Pairs, Room};

impl Emitter<'_> {
    pub(super) fn look(
        &mut self,
        body: Id,
        direction: Direction,
        negated: bool,
        fail: Fail,
    ) -> Result<Fail, Error> {
        let outer = core::mem::replace(&mut self.direction, direction);
        let (repeats, following) = (self.repeats, core::mem::take(&mut self.following));
        let surroundings = core::mem::replace(&mut self.surroundings, Surroundings::NONE);
        match negated {
            true => self.negative_look(body, fail)?,
            false => self.positive_look(body, fail)?,
        }
        self.surroundings = surroundings;
        (self.direction, self.repeats, self.following) = (outer, repeats, following);
        Ok(fail)
    }

    fn look_for(&mut self, body: Id, negated: bool, fail: Fail) -> Result<(), Error> {
        self.need(self.graph[body].min, fail)?;
        let can_visit = self.memoizing.is_some() && !self.graph[body].is(Traits::RIGID);
        match can_visit && self.state.is_reachable {
            true => self.look_visiting(body, negated, fail),
            false => self.node(body, 0, fail).map(drop),
        }
    }

    #[inline(never)]
    fn look_visiting(&mut self, body: Id, negated: bool, fail: Fail) -> Result<(), Error> {
        let (outer, depth) = (self.look.take(), self.looks + 1);
        if negated || !self.graph[body].is(Traits::WRITES) {
            let mark = self.plan_mark()?;
            self.look = Some(LookId(self.output.program.sites.looks.len() as u32));
            let found = Some(self.output.label()?);
            push(&mut self.output.program.sites.looks, Look { mark, found })?;
        }
        self.settle()?;
        self.op(Op::EnterLook { depth })?;
        let (scope, failed) = (self.state.scope, self.output.label()?);
        let to = self.later_target(fail)?;
        self.output.bind(failed, Section::Cold, Room::NONE, scope);
        let leave = |has_found| Op::LeaveLook { depth, has_found };
        self.output.op(Section::Cold, leave(false))?;
        self.output.op(Section::Cold, Op::Jump { to })?;
        let fail = self.fail_to_either(failed, failed)?;

        self.looks = depth;
        self.node(body, 0, fail)?;
        self.looks = depth - 1;
        let look = core::mem::replace(&mut self.look, outer);
        let found = look.map(|it| &mut self.output.program.sites.looks[it.index()].found);
        if !self.state.is_reachable {
            found.map(Option::take);
            return Ok(());
        }
        let found = found.and_then(|it| *it);
        self.settle()?;
        if let Some(found) = found {
            self.bind_settled(found, Room::NONE, scope)?;
        }
        self.op(leave(true))
    }

    fn positive_look(&mut self, body: Id, fail: Fail) -> Result<(), Error> {
        let (entry, offset) = (self.entry(), self.state.offset);
        let origin = match self.graph[body].is(Traits::RIGID) {
            true => None,
            false => Some(self.anchor(self.state.room)?),
        };
        self.look_for(body, false, fail)?;
        if let Some(from) = origin
            && self.state.is_reachable
            && !self.is_unchanged_since(entry)
        {
            self.commit()?;
            self.weigh(from.slot);
            let metered = self.is_costly(body, 1);
            self.op(Op::Load { from, metered })?;
            self.state.room = self.room_at(from).unwrap_or_default();
            self.state.anchor = Some(from);
        }
        self.state.offset = offset;
        Ok(())
    }

    fn negative_look(&mut self, body: Id, fail: Fail) -> Result<(), Error> {
        let passed = self.output.label()?;
        let not_found = match self.graph[body].is(Traits::RIGID) {
            true => self.fail_directly_to(passed)?,
            false => {
                if self.pending_actions() * 2 > ACTIONS_REPEATED {
                    self.commit()?;
                }
                let metered = self.is_costly(body, 1);
                let undo = self.plan_undo(metered)?;
                self.fail_to(passed, undo)?
            }
        };
        let (before, written) = (self.snapshot()?, self.entries_written());
        self.look_for(body, true, not_found)?;
        self.write_tests()?;
        self.jump_to_fail(fail)?;
        self.note_written_since(written, Pairs::NONE)?;
        self.restore(&before)?;
        self.bind(passed)
    }
}
