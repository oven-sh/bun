//! Repeated groups whose turns are alike, so that the position says all about them.

use super::output::Section;
use super::repeat::{Count, Repeat};
use super::run::{Run, Visits};
use super::state::Fail;
use super::{Captures, Emitter};
use crate::Error;
use crate::compile::graph::{Id, Kind, Step, Traits};
use crate::program::{Op, Place, Stride, UNBOUNDED};

impl Emitter<'_> {
    pub(super) fn stepped(
        &mut self,
        id: Id,
        repeat: Repeat,
        gives_back: bool,
        fail: Fail,
    ) -> Result<Fail, Error> {
        let length = self.graph[repeat.body].min;
        let needs_floor = gives_back || repeat.min == 0 && !repeat.pairs.is_empty();
        let (floor, visits) = match self.only_step(repeat.body) {
            Some(step) => self.turns_of_one_step(id, repeat, step, needs_floor, fail)?,
            None => (self.alike_turns(repeat, needs_floor, fail)?, None),
        };
        let (Some(floor), Some(stride), true) = (floor, Stride::of_units(length), gives_back)
        else {
            self.capture_last_turn(repeat, floor)?;
            return self.after_run(id, fail);
        };
        let fail = self.after_run(id, fail)?;
        let again = self.output.label()?;
        self.commit()?;
        self.bind_after_giving_back(again, floor, repeat.rest)?;
        self.visit_end_of_run(visits)?;
        self.capture_last_turn(repeat, Some(floor))?;
        self.give_back(id, again, floor, stride, None, visits, fail)
    }

    /// The step, if the body is one apart from parentheses.
    pub(super) fn only_step(&self, body: Id) -> Option<Step> {
        let terms = self.graph.terms(&body).iter().map(|&it| &self.graph[it]);
        let mut tests = terms.filter(|it| !it.is_bookkeeping());
        match (tests.next()?.kind, tests.next()) {
            (Kind::Steps(steps), None) if steps.len() == 1 => {
                Some(self.graph.steps[steps.range().start])
            }
            _ => None,
        }
    }

    /// Returns where the required turns end.
    #[inline(never)]
    fn turns_of_one_step(
        &mut self,
        id: Id,
        repeat: Repeat,
        step: Step,
        needs_floor: bool,
        fail: Fail,
    ) -> Result<(Option<Place>, Option<Visits>), Error> {
        let class = self.graph.class_of_step(step)?;
        match repeat.min {
            0 => {}
            1 => self.step(step, fail)?,
            count => self.step_count(class, count, repeat.rest, fail)?,
        }
        let optional = match repeat.max {
            UNBOUNDED => UNBOUNDED,
            max => max - repeat.min,
        };
        if optional == 0 {
            return Ok((None, None));
        }
        let run = Run {
            class,
            max: optional,
            code_points: false,
            rest: repeat.rest,
            is_counted: repeat.is_counted,
        };
        let floor = self.settle_at_anchor_if(needs_floor)?;
        Ok((floor, self.pass_greedily(id, run, fail)?))
    }

    pub(super) fn settle_at_anchor_if(&mut self, is_needed: bool) -> Result<Option<Place>, Error> {
        match is_needed {
            true => self.settle_at_anchor().map(Some),
            false => self.settle().map(|()| None),
        }
    }

    /// Returns where the required turns end.
    fn alike_turns(
        &mut self,
        repeat: Repeat,
        needs_floor: bool,
        fail: Fail,
    ) -> Result<Option<Place>, Error> {
        let length = self.graph[repeat.body].min;
        let is_counted = (repeat.min, repeat.max) != (0, UNBOUNDED);
        let start = self.settle_at_anchor_if(needs_floor || is_counted)?;
        let count = start.map_or(Count::NotNeeded, |start| Count::Distance(start, length));
        let (head, done) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (self.room_between_turns(repeat), self.state.planned);
        let outside = self.enter_loop(None);
        self.surround_with_count(count, repeat, 1)?;
        self.bind_settled(head, room, scope)?;
        self.branch_on_count(count, repeat.max, true, done)?;
        self.visit_turn(repeat.is_worth_visits, done)?;
        let entry = self.entry();
        let mut turn_fails = self.fail_directly_to(done)?;
        self.need_turn(repeat, turn_fails)?;
        if !self.graph[repeat.body].is(Traits::RIGID) {
            let metered = self.is_costly(repeat.body, 1);
            let undo = self.plan_undo(metered)?;
            turn_fails = self.fail_to(done, undo)?;
        }
        if !repeat.pairs.is_empty() {
            self.captures = Captures::Skipped;
        }
        self.node(repeat.body, repeat.rest, turn_fails)?;
        self.release(entry)?;
        self.settle()?;
        self.count_turn(repeat.is_counted && self.state.is_reachable)?;
        self.go_again(head)?;
        self.leave_loop(&outside);
        self.bind_settled(done, room, scope)?;
        self.doubt_visit(repeat.is_worth_visits, Section::Main)?;
        let too_few = self.target(fail)?;
        self.branch_on_count(count, repeat.min, false, too_few)?;
        let required = self.direction.signed((repeat.min * length) as i32);
        Ok(start.map(|start| Place {
            delta: start.delta + required,
            ..start
        }))
    }

    /// Those of the turn that ends where the pattern has got, if there is one.
    #[inline(never)]
    fn capture_last_turn(&mut self, repeat: Repeat, floor: Option<Place>) -> Result<(), Error> {
        if repeat.pairs.is_empty() {
            return Ok(());
        }
        let length = self.graph[repeat.body].min;
        let Some(start) = floor.filter(|_| repeat.min == 0) else {
            return self.capture_turn(repeat.body);
        };
        let (no_turn, done) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (self.state.room, self.state.planned);
        self.output
            .bind(no_turn, Section::Cold, room, self.state.scope);
        self.output.op(
            Section::Cold,
            Op::Clear {
                pairs: repeat.pairs,
            },
        )?;
        self.output.op(Section::Cold, Op::Jump { to: done })?;
        self.branch_on_count(Count::Distance(start, length), 1, false, no_turn)?;
        self.capture_turn(repeat.body)?;
        self.commit()?;
        self.bind_settled(done, room, scope)
    }

    fn capture_turn(&mut self, body: Id) -> Result<(), Error> {
        let Kind::Sequence(children) = self.graph[body].kind else {
            unreachable!("a group has two parentheses")
        };
        self.state.offset -= self.direction.signed(self.graph[body].min as i32);
        for index in children.range() {
            let child = self.graph.children[index];
            match self.graph[child].is_bookkeeping() {
                true => self.leaf(child, 0, Fail::NO_MATCH)?,
                false => self.state.offset += self.direction.signed(self.graph[child].min as i32),
            }
        }
        Ok(())
    }
}
