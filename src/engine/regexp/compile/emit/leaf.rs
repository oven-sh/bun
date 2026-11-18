//! Nodes without children.

use core::ops::Range;

use super::Emitter;
use super::repeat::Count;
use super::run::Run;
use super::state::{Fail, Located, Spot};
use crate::Error;
use crate::compile::graph::{Id, Kind, MAX_REACH, NEAR, Span, Step, Traits};
use crate::compile::memory::push;
use crate::program::{ClassId, Comparison, Direction, Op};

impl Emitter<'_> {
    #[inline(never)]
    pub(super) fn leaf(&mut self, id: Id, rest: u32, fail: Fail) -> Result<(), Error> {
        let direction = self.direction;
        match self.graph[id].kind {
            Kind::Empty => Ok(()),
            Kind::Fail => self.jump_to_fail(fail),
            Kind::Accept => self.accept(),
            Kind::Steps(steps) => self.steps(steps, fail),
            Kind::StepCount { class, count } => {
                let entry = self.entry();
                self.step_count(class, count, rest, fail)?;
                self.release(entry)
            }
            Kind::Pair(class) => {
                self.write_tests()?;
                let offset = self.offset_toward(direction, 2) as i16;
                let fail = self.target(fail)?;
                self.state.offset += direction.signed(2);
                self.op(Op::Pair {
                    offset,
                    class,
                    fail,
                })
            }
            Kind::CodePoint(class) => self.code_point(class, rest, fail),
            Kind::Open(pair) => self.capture(pair, direction.opposite()),
            Kind::Close(pair) => self.capture(pair, direction),
            Kind::Clear(pairs) => self.record(Op::Clear { pairs }),
            Kind::Edge(Direction::Backward) if self.epoch_at_start == Some(self.state.epoch) => {
                match self.state.offset {
                    0 => Ok(()),
                    _ => self.jump_to_fail(fail),
                }
            }
            Kind::Edge(Direction::Forward) if self.has_passed(self.state.offset, None) => Ok(()),
            Kind::Edge(direction) => {
                self.write_tests()?;
                let fail = self.target(fail)?;
                self.op(Op::AtEdge {
                    direction,
                    offset: self.state.offset as i16,
                    fail,
                })
            }
            Kind::Peek {
                side,
                step,
                or_edge,
            } => self.peek(side, step, or_edge, fail),
            Kind::Boundary {
                word,
                other,
                negated,
            } => self.boundary(word, other, negated, fail),
            Kind::BackReference { pairs, ignore_case } => {
                self.settle()?;
                let fail = self.target(fail)?;
                self.op(Op::BackReference {
                    direction,
                    ignore_case,
                    first: pairs.range().start as u32,
                    count: pairs.len() as u32,
                    reserve: rest,
                    fail,
                })?;
                self.moved(0, rest);
                self.note_reference();
                Ok(())
            }
            Kind::NotEmpty => self.not_empty(fail),
            _ => unreachable!("the node has children"),
        }
    }

    /// Fails unless there is room for the node and `rest` more units.
    pub(super) fn need_node(&mut self, id: Id, rest: u32, fail: Fail) -> Result<(), Error> {
        let (node, min) = (&self.graph[id], self.graph[id].min);
        let terms = self
            .graph
            .terms(&id)
            .iter()
            .rev()
            .map(|&it| &self.graph[it]);
        let mut empty = terms.take_while(|it| it.max == 0);
        let is_last = empty.any(|it| it.kind == Kind::Edge(Direction::Forward));
        let has_one_length = node.is(Traits::RIGID) && node.min == node.max;
        if !is_last || !has_one_length || self.direction == Direction::Backward {
            return self.need(min.saturating_add(rest), fail);
        }
        let offset = self.state.offset + min as i32;
        self.write_tests()?;
        let op = Op::AtEdge {
            direction: Direction::Forward,
            offset: offset as i16,
            fail: self.target(fail)?,
        };
        self.op(op)?;
        self.note_passed(offset, None);
        let room = &mut self.state.room;
        room.ahead = room.ahead.max(offset.max(0) as u32);
        self.need(min.saturating_add(rest), fail)
    }

    fn steps(&mut self, steps: Span, fail: Fail) -> Result<(), Error> {
        let Range { mut start, end } = steps.range();
        loop {
            let part = start..end.min(start + MAX_REACH as usize);
            start = part.end;
            self.test_steps(part, fail)?;
            if start == end {
                return Ok(());
            }
            self.keep_offsets_short()?;
        }
    }

    pub(super) fn step(&mut self, step: Step, fail: Fail) -> Result<(), Error> {
        self.test(self.offset_toward(self.direction, 1), step, fail)?;
        self.state.offset += self.direction.signed(1);
        Ok(())
    }

    pub(super) fn step_count(
        &mut self,
        class: ClassId,
        count: u32,
        rest: u32,
        fail: Fail,
    ) -> Result<(), Error> {
        if count > NEAR {
            let start = self.settle_at_anchor()?;
            self.pass(Run {
                class,
                max: count,
                code_points: false,
                rest,
                is_counted: false,
            })?;
            let too_few = self.target(fail)?;
            return self.branch_on_count(Count::Distance(start, 1), count, false, too_few);
        }
        self.write_tests()?;
        let fail = self.target(fail)?;
        self.op(Op::ClassCount {
            offset: self.offset_toward(self.direction, count) as i16,
            count: count as u16,
            class,
            fail,
        })?;
        self.state.offset += self.direction.signed(count as i32);
        Ok(())
    }

    pub(super) fn code_point(
        &mut self,
        class: ClassId,
        rest: u32,
        fail: Fail,
    ) -> Result<(), Error> {
        self.settle()?;
        let fail = self.target(fail)?;
        self.op(Op::CodePoint {
            direction: self.direction,
            class,
            reserve: rest,
            fail,
        })?;
        self.moved(1, rest);
        Ok(())
    }

    /// The entry of the pair that is on that side.
    pub(super) fn entry_of(pair: u16, side: Direction) -> u32 {
        u32::from(pair) * 2 + u32::from(side == Direction::Forward)
    }

    fn capture(&mut self, pair: u16, side: Direction) -> Result<(), Error> {
        let entry = Self::entry_of(pair, side);
        self.note_written(entry)?;
        self.record(Op::Capture {
            offset: self.state.offset as i16,
            entry,
        })
    }

    pub(super) fn hold_capture(&mut self) -> Result<(), Error> {
        let spot = self.spot()?;
        push(self.held, spot)
    }

    pub(super) fn write_held_capture(&mut self, pair: u16) -> Result<(), Error> {
        let opened = self.held.pop().expect("the group has been opened");
        let entry = Self::entry_of(pair, self.direction.opposite());
        let op = match self.locate(opened) {
            Located::Offset(offset) => Op::Capture { offset, entry },
            Located::Place(place) => Op::CapturePlace { place, entry },
        };
        self.record(op)?;
        self.note_written(entry)?;
        self.capture(pair, self.direction)
    }

    fn peek(
        &mut self,
        side: Direction,
        step: Step,
        or_edge: bool,
        fail: Fail,
    ) -> Result<(), Error> {
        let offset = self.offset_toward(side, 1);
        if !or_edge || self.has_toward(side, 1) {
            self.need_toward(side, 1, fail)?;
            return self.test(offset, step, fail);
        }
        let before = self.snapshot()?;
        let passed = self.output.label()?;
        let at_edge = self.fail_directly_to(passed)?;
        self.need_toward(side, 1, at_edge)?;
        self.test(offset, step, fail)?;
        self.restore(&before)?;
        self.bind(passed)
    }

    fn boundary(
        &mut self,
        word: ClassId,
        other: ClassId,
        negated: bool,
        fail: Fail,
    ) -> Result<(), Error> {
        let before = self.snapshot()?;
        let (after_other, passed) = (self.output.label()?, self.output.label()?);
        let no_word = self.fail_directly_to(after_other)?;
        self.peek(Direction::Backward, Step::Class(word), false, no_word)?;
        let (after_word, otherwise) = match negated {
            false => ((other, true), (word, false)),
            true => ((word, false), (other, true)),
        };
        self.peek(
            Direction::Forward,
            Step::Class(after_word.0),
            after_word.1,
            fail,
        )?;
        self.jump(passed)?;
        self.restore(&before)?;
        self.bind(after_other)?;
        self.peek(
            Direction::Forward,
            Step::Class(otherwise.0),
            otherwise.1,
            fail,
        )?;
        self.restore(&before)?;
        self.bind(passed)
    }

    fn not_empty(&mut self, fail: Fail) -> Result<(), Error> {
        let Some((slot, value)) = self.turn.required else {
            return self.fail_if_at(self.turn.start, fail);
        };
        self.commit()?;
        let passed = self.output.label()?;
        self.op(Op::CompareNumber {
            when: Comparison::Below,
            slot,
            value,
            to: passed,
        })?;
        self.fail_if_at(self.turn.start, fail)?;
        self.bind(passed)
    }

    fn fail_if_at(&mut self, spot: Spot, fail: Fail) -> Result<(), Error> {
        self.write_tests()?;
        let offset = self.state.offset as i16;
        match self.locate(spot) {
            Located::Offset(start) if start == offset => self.jump_to_fail(fail),
            Located::Offset(_) => Ok(()),
            Located::Place(place) => {
                let to = self.target(fail)?;
                self.op(Op::ComparePlace {
                    when: Comparison::Equal,
                    offset,
                    place,
                    to,
                })
            }
        }
    }

    fn accept(&mut self) -> Result<(), Error> {
        self.write_tests()?;
        for index in 0..self.owed.len() {
            let pairs = self.owed[index];
            self.op(Op::Clear { pairs })?;
        }
        self.write_records()?;
        let end = self.state.offset as i16;
        let op = match self.locate(self.match_start) {
            Located::Offset(start) => Op::MatchHere { start, end },
            Located::Place(start) => Op::Match { start, end },
        };
        self.op(op)?;
        self.state.is_reachable = false;
        Ok(())
    }
}
