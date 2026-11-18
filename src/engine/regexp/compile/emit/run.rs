//! Repeated characters.

use super::Emitter;
use super::output::{Label, Section};
use super::state::Fail;
use crate::Error;
use crate::compile::graph::{Id, Kind, NEAR, Traits};
use crate::program::{
    ClassId, Comparison, Direction, MAX_LENGTH, Op, Place, SiteId, Stride, UNBOUNDED,
};
use crate::set::CharRange;

/// Of the characters of a subject.
const SHARE_OF_LONG_RUN: f32 = 0.5;

#[derive(Clone, Copy)]
pub(super) struct Run {
    pub(super) class: ClassId,
    pub(super) max: u32,
    pub(super) code_points: bool,
    pub(super) rest: u32,
    pub(super) is_counted: bool,
}

/// Those of a run that has more than one way to end.
#[derive(Clone, Copy)]
pub(super) struct Visits {
    /// Tries the next way.
    seen: Label,
    /// For a run that has to mind its length.
    at_end: Option<SiteId>,
}

impl Emitter<'_> {
    #[inline(never)]
    pub(super) fn run(&mut self, id: Id, rest: u32, fail: Fail) -> Result<Fail, Error> {
        let node = self.graph[id];
        let Kind::Run {
            class,
            max,
            code_points,
            greedy,
            filter,
            is_counted,
        } = node.kind
        else {
            unreachable!("the node is a run")
        };
        if rest >= MAX_LENGTH {
            return Ok(fail);
        }
        let run = Run {
            class,
            max,
            code_points,
            rest,
            is_counted,
        };
        if !greedy {
            return self.lazy_run(id, run, filter, fail);
        }
        if !node.is(Traits::REENTERED) {
            self.settle()?;
            self.pass_greedily(id, run, fail)?;
            return self.after_run(id, fail);
        }
        let floor = self.settle_at_anchor()?;
        let visits = self.pass_greedily(id, run, fail)?;
        let fail = self.after_run(id, fail)?;
        let again = self.output.label()?;
        self.commit()?;
        self.bind_after_giving_back(again, floor, rest)?;
        self.visit_end_of_run(visits)?;
        let stride = match code_points {
            true => Stride::CODE_POINT,
            false => Stride::UNIT,
        };
        self.give_back(id, again, floor, stride, filter, visits, fail)
    }

    fn is_first_run(&self, id: Id) -> bool {
        self.first_run.is_some_and(|it| it.node == id)
    }

    fn site_of_run(&mut self, id: Id, is_wanted: bool) -> Result<Option<SiteId>, Error> {
        let can_be_in_vain = self.graph[id].is(Traits::CAN_BE_IN_VAIN);
        match is_wanted && can_be_in_vain && !self.is_first_run(id) {
            true => self.site(),
            false => Ok(None),
        }
    }

    /// Nothing is put off.
    pub(super) fn pass_greedily(
        &mut self,
        id: Id,
        run: Run,
        fail: Fail,
    ) -> Result<Option<Visits>, Error> {
        let gives_back = self.graph[id].is(Traits::REENTERED);
        let on_the_way = self.site_of_run(id, run.max > NEAR)?;
        let at_end = self.site_of_run(id, gives_back && run.max != UNBOUNDED)?;
        let visits = match gives_back && on_the_way.or(at_end).is_some() {
            true => Some(Visits {
                seen: self.output.label()?,
                at_end,
            }),
            false => None,
        };
        match (on_the_way, visits) {
            (None, _) => self.pass(run)?,
            (Some(site), Some(Visits { seen, .. })) => self.pass_visiting(run, site, seen)?,
            (Some(site), None) => {
                let seen = self.later_target(fail)?;
                self.pass_visiting(run, site, seen)?;
            }
        }
        Ok(visits)
    }

    fn pass_visiting(&mut self, run: Run, site: SiteId, seen: Label) -> Result<(), Error> {
        self.op(Op::VisitRun {
            direction: self.direction,
            code_points: run.code_points,
            class: run.class,
            max: run.max,
            reserve: run.rest,
            site,
            seen,
        })?;
        self.moved(0, run.rest);
        Ok(())
    }

    pub(super) fn visit_end_of_run(&mut self, visits: Option<Visits>) -> Result<(), Error> {
        match visits {
            Some(Visits { seen, at_end }) => self.visit(at_end, seen),
            None => Ok(()),
        }
    }

    /// Where to go once the rest of the pattern has failed wherever the run can end.
    pub(super) fn after_run(&mut self, id: Id, fail: Fail) -> Result<Fail, Error> {
        let Some(first_run) = self.first_run.filter(|it| it.node == id) else {
            return Ok(fail);
        };
        let undo = self.plan_undo(self.is_costly_to_retry(id))?;
        self.fail_to(first_run.restart, undo)
    }

    /// Whether coming back to the end of the node after the rest of the pattern has failed has to count as work.
    fn is_costly_to_retry(&self, id: Id) -> bool {
        self.repeats && !self.is_first_run(id) || self.following > NEAR
    }

    /// Returns a place that is equal to the position.
    pub(super) fn settle_at_anchor(&mut self) -> Result<Place, Error> {
        let (anchor, offset) = (self.anchor(self.state.room)?, self.state.offset);
        self.settle()?;
        Ok(Place {
            delta: anchor.delta + offset,
            ..anchor
        })
    }

    pub(super) fn pass(&mut self, run: Run) -> Result<(), Error> {
        let share = self.frequencies.of_latin1(self.graph[run.class].latin1());
        self.op(Op::Run {
            direction: self.direction,
            code_points: run.code_points,
            is_long: share > SHARE_OF_LONG_RUN,
            is_counted: run.is_counted && self.counts_turns,
            class: run.class,
            max: run.max,
            reserve: run.rest,
        })?;
        self.moved(0, run.rest);
        Ok(())
    }

    pub(super) fn bind_after_giving_back(
        &mut self,
        again: Label,
        floor: Place,
        rest: u32,
    ) -> Result<(), Error> {
        let at_floor = self.room_at(floor).unwrap_or_default();
        self.bind_settled(
            again,
            at_floor.with(self.direction, rest),
            self.state.planned,
        )
    }

    /// Later failures move back toward the floor and go on at `again`.
    pub(super) fn give_back(
        &mut self,
        id: Id,
        again: Label,
        floor: Place,
        stride: Stride,
        filter: Option<ClassId>,
        visits: Option<Visits>,
        fail: Fail,
    ) -> Result<Fail, Error> {
        let op = Op::GiveBack {
            direction: self.direction,
            stride,
            floor: self.weigh_place(floor),
            filter: filter.into(),
            fail: self.later_target(fail)?,
        };
        let (room, scope) = (self.state.room, self.state.scope);
        let (direct, later) = self.bind_retry(id)?;
        if let Some(Visits { seen, .. }) = visits {
            self.output.bind(seen, Section::Cold, room, scope);
        }
        self.output.op(Section::Cold, op)?;
        self.output.op(Section::Cold, Op::Again { to: again })?;
        self.repeats = true;
        self.fail_to_either(direct, later)
    }

    /// Starts cold code that failures come to with the present position.
    pub(super) fn bind_retry(&mut self, id: Id) -> Result<(Label, Label), Error> {
        let (direct, later) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (self.state.room, self.state.scope);
        let undo = self.plan_undo(self.is_costly_to_retry(id))?;
        self.write_undo(later, Section::Cold, undo)?;
        self.output.bind(direct, Section::Cold, room, scope);
        Ok((direct, later))
    }

    /// Goes to `to` if `units` have been passed since `start`.
    pub(super) fn compare_distance(
        &mut self,
        start: Place,
        units: u32,
        has_passed: bool,
        to: Label,
    ) -> Option<Op> {
        let distance = self.direction.signed(i32::try_from(units).ok()?);
        Some(Op::ComparePlace {
            when: match (self.direction, has_passed) {
                (Direction::Forward, true) => Comparison::AtLeast,
                (Direction::Forward, false) => Comparison::Below,
                (Direction::Backward, true) => Comparison::AtMost,
                (Direction::Backward, false) => Comparison::Above,
            },
            offset: 0,
            place: self.weigh_place(Place {
                delta: start.delta.checked_add(distance)?,
                ..start
            }),
            to,
        })
    }

    fn lazy_run(
        &mut self,
        id: Id,
        run: Run,
        passed_at_once: Option<ClassId>,
        fail: Fail,
    ) -> Result<Fail, Error> {
        let site = self.site_of_run(id, true)?;
        let exhausted = match self.first_run.filter(|it| it.node == id) {
            Some(first_run) => first_run.restart,
            None => self.later_target(fail)?,
        };
        let start = self.settle_at_anchor_if(run.max != UNBOUNDED)?;
        let (again, go_on) = (self.output.label()?, self.output.label()?);
        let (room, scope) = (
            self.state.room.with(self.direction, run.rest),
            self.state.planned,
        );
        self.bind_settled(again, room, scope)?;
        let longer = self.output.label()?;
        match (passed_at_once, site) {
            (Some(class), Some(site)) => {
                self.pass_visiting(Run { class, ..run }, site, exhausted)?;
            }
            (Some(class), None) => self.pass(Run { class, ..run })?,
            (None, _) if run.max == UNBOUNDED => self.visit(site, exhausted)?,
            (None, _) => self.visit(site, longer)?,
        }
        self.bind_settled(go_on, room, scope)?;

        let (direct, later) = self.bind_retry(id)?;
        (self.output).bind(longer, Section::Cold, room, self.state.scope);
        self.doubt_visit(site.is_some() && run.max != UNBOUNDED, Section::Cold)?;
        if let Some(op) = start.and_then(|it| self.compare_distance(it, run.max, true, exhausted)) {
            self.output.op(Section::Cold, op)?;
        }
        self.write_cold_step(run.class, run.code_points, run.rest, exhausted)?;
        if run.is_counted && self.counts_turns {
            self.output.op(Section::Cold, Op::CountTurn)?;
        }
        self.output.op(Section::Cold, Op::Again { to: again })?;
        self.repeats = true;
        self.fail_to_either(direct, later)
    }

    fn write_cold_step(
        &mut self,
        class: ClassId,
        code_points: bool,
        rest: u32,
        fail: Label,
    ) -> Result<(), Error> {
        let direction = self.direction;
        let mut cold = |op| self.output.op(Section::Cold, op);
        cold(Op::Need {
            direction,
            count: rest + 1,
            fail,
        })?;
        if code_points {
            return cold(Op::CodePoint {
                direction,
                class,
                reserve: rest,
                fail,
            });
        }
        let all_units = CharRange::new(0, self.graph.width.max_unit().into());
        if !self.graph[class].contains_range(all_units) {
            cold(Op::Class {
                offset: if direction == Direction::Forward {
                    0
                } else {
                    -1
                },
                class,
                fail,
            })?;
        }
        cold(Op::Advance {
            by: direction.signed(1),
        })
    }
}
