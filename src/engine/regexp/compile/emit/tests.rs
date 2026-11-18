//! Tests of units at known offsets, several at once where they can be.

use core::ops::Range;

use super::Emitter;
use super::output::{Label, Section};
use super::state::Fail;
use crate::Error;
use crate::compile::graph::{Step, masked_units};
use crate::compile::memory::{push, reserve};
use crate::program::{Direction, Op, split_halves};

#[derive(Clone, Copy)]
pub(super) struct Test {
    offset: i32,
    step: Step,
}

#[derive(Clone, Copy)]
pub(super) struct Passed {
    epoch: u32,
    offset: i32,
    /// Nothing for the end of the subject.
    step: Option<Step>,
}

impl Emitter<'_> {
    /// For as long as the epoch lasts, or until the list is cut back.
    pub(super) fn note_passed(&mut self, offset: i32, step: Option<Step>) {
        let epoch = self.state.epoch;
        if self.passed.len() < self.passed.inline_size() {
            self.passed.push(Passed {
                epoch,
                offset,
                step,
            });
        }
    }

    #[inline(always)]
    pub(super) fn has_passed(&self, offset: i32, step: Option<Step>) -> bool {
        let here = |it: &&Passed| (it.epoch, it.offset) == (self.state.epoch, offset);
        let mut known = self.passed.iter().filter(here);
        known.any(|it| match (it.step, step) {
            (Some(found), Some(wanted)) => found == wanted || self.implies(found, wanted),
            (found, wanted) => found == wanted,
        })
    }

    #[inline(never)]
    fn implies(&self, found: Step, wanted: Step) -> bool {
        let any = self.graph.width.max_unit();
        match (found, wanted) {
            (_, Step::Unit { mask, .. }) if mask == any => true,
            (Step::Unit { mask, .. }, _) if mask == any => false,
            (
                Step::Unit { value, mask },
                Step::Unit {
                    value: wanted,
                    mask: ignored,
                },
            ) => mask & !ignored == 0 && value | ignored == wanted,
            (Step::Unit { value, mask }, Step::Class(class)) => {
                masked_units(value, mask).all(|it| self.graph[class].contains(it.into()))
            }
            (Step::Class(found), Step::Class(class)) => {
                self.graph[found].is_subset_of(&self.graph[class])
            }
            (Step::Class(found), Step::Unit { value, mask }) => {
                let passes = |c| c | u32::from(mask) == value.into();
                let mut ranges = self.graph[found].ranges();
                ranges.all(|it| (it.first..=it.last).all(passes))
            }
        }
    }

    /// The offset of the first of the next `units` units in the direction.
    pub(super) fn offset_toward(&self, direction: Direction, units: u32) -> i32 {
        match direction {
            Direction::Forward => self.state.offset,
            Direction::Backward => self.state.offset - units as i32,
        }
    }

    pub(super) fn test(&mut self, offset: i32, step: Step, fail: Fail) -> Result<(), Error> {
        if fail != self.tests_fail {
            self.write_tests()?;
            self.tests_fail = fail;
        }
        match self.has_passed(offset, Some(step)) {
            true => Ok(()),
            false => push(self.tests, Test { offset, step }),
        }
    }

    /// And passes the units.
    pub(super) fn test_steps(&mut self, steps: Range<usize>, fail: Fail) -> Result<(), Error> {
        if fail != self.tests_fail {
            self.write_tests()?;
            self.tests_fail = fail;
        }
        reserve(self.tests, steps.len())?;
        let (mut offset, stride) = (
            self.offset_toward(self.direction, 1),
            self.direction.signed(1),
        );
        self.state.offset += stride * steps.len() as i32;
        for &step in &self.graph.steps[steps] {
            if !self.has_passed(offset, Some(step)) {
                self.tests.push(Test { offset, step });
            }
            offset += stride;
        }
        Ok(())
    }

    #[inline]
    pub(super) fn write_tests(&mut self) -> Result<(), Error> {
        match self.tests.is_empty() {
            true => Ok(()),
            false => self.write_some_tests(),
        }
    }

    fn write_some_tests(&mut self) -> Result<(), Error> {
        let fail = self.target(self.tests_fail)?;
        let mut tests = core::mem::take(self.tests);
        let key = |test: &Test| (matches!(test.step, Step::Class(_)), test.offset);
        if !tests.is_sorted_by_key(key) {
            tests.sort_unstable_by_key(key);
        }
        let classes = tests.partition_point(|test| matches!(test.step, Step::Unit { .. }));
        for adjacent in tests[..classes].chunk_by(|a, b| a.offset + 1 == b.offset) {
            self.write_units(adjacent, fail)?;
        }
        for test in &tests[classes..] {
            if let Step::Class(class) = test.step {
                let op = Op::Class {
                    offset: test.offset as i16,
                    class,
                    fail,
                };
                self.output.op(Section::Main, op)?;
            }
        }
        tests.clear();
        *self.tests = tests;
        Ok(())
    }

    /// Covers the units with few words, which can overlap.
    fn write_units(&mut self, tests: &[Test], fail: Label) -> Result<(), Error> {
        let width = self.graph.width;
        let most = 8 / width.bytes_per_unit() as usize;
        let passes_all =
            |test: &Test| matches!(test.step, Step::Unit { mask, .. } if mask == width.max_unit());
        let mut done = 0;
        while done < tests.len() {
            if passes_all(&tests[done]) {
                done += 1;
                continue;
            }
            let left = tests.len() - done;
            let covering = left.next_power_of_two();
            let (first, count) = if covering <= most && covering <= tests.len() {
                (tests.len() - covering, covering)
            } else {
                (done, most.min(1 << left.ilog2()))
            };
            self.write_word(&tests[first..first + count], fail)?;
            done = first + count;
        }
        Ok(())
    }

    fn write_word(&mut self, tests: &[Test], fail: Label) -> Result<(), Error> {
        let bytes_per_unit = self.graph.width.bytes_per_unit();
        let (mut value, mut mask) = (0u64, 0u64);
        for test in tests.iter().rev() {
            if let Step::Unit {
                value: unit_value,
                mask: unit_mask,
            } = test.step
            {
                value = value << (8 * bytes_per_unit) | u64::from(unit_value);
                mask = mask << (8 * bytes_per_unit) | u64::from(unit_mask);
            }
        }
        let offset = tests[0].offset as i16;
        let op = match tests.len() {
            1 => Op::Unit {
                offset,
                value: value as u16,
                mask: mask as u16,
                fail,
            },
            count => Op::Word {
                bytes: count as u8 * bytes_per_unit as u8,
                offset,
                value: split_halves(value),
                mask: split_halves(mask),
                fail,
            },
        };
        self.output.op(Section::Main, op)
    }
}
