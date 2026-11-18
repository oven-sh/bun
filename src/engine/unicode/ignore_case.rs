use core::ops::RangeInclusive;

use crate::case::delta;
use crate::tables::{
    CANONICAL_CODE_POINT_DELTAS, CANONICAL_CODE_UNIT_DELTAS, CODE_POINT_RUNS, CODE_UNIT_RUNS,
};

/// How to get from a character to the next one that is equal to it.
#[derive(Clone, Copy)]
pub(crate) enum Step {
    /// Each two neighbours are a pair, from the first of the run.
    Adjacent,
    /// To the other one of a pair.
    Offset(i32),
    /// To the next one of three or more.
    Cycle(i32),
}

pub(crate) struct CaseRun {
    first: u32,
    last: u32,
    step: Step,
}

pub(crate) const fn run(first: u32, last: u32, step: Step) -> CaseRun {
    CaseRun { first, last, step }
}

/// The equivalence that Canonicalize of ECMA-262 defines for a pattern with the flag `i`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IgnoreCase {
    /// By upper case, without the flags `u` and `v`.
    CodeUnits,
    /// By simple case folding.
    CodePoints,
}

impl IgnoreCase {
    #[inline]
    pub fn canonicalize(self, c: u32) -> u32 {
        let deltas = match self {
            IgnoreCase::CodeUnits => &CANONICAL_CODE_UNIT_DELTAS,
            IgnoreCase::CodePoints => &CANONICAL_CODE_POINT_DELTAS,
        };
        c.wrapping_add_signed(delta(c, deltas))
    }

    fn runs_from(self, c: u32) -> &'static [CaseRun] {
        let runs: &[CaseRun] = match self {
            IgnoreCase::CodeUnits => &CODE_UNIT_RUNS,
            IgnoreCase::CodePoints => &CODE_POINT_RUNS,
        };
        &runs[runs.partition_point(|run| run.last < c)..]
    }

    fn next(self, c: u32) -> u32 {
        match self.runs_from(c).first() {
            Some(run) if run.first <= c => match run.step {
                Step::Adjacent => run.first + ((c - run.first) ^ 1),
                Step::Offset(delta) | Step::Cycle(delta) => c.wrapping_add_signed(delta),
            },
            _ => c,
        }
    }

    /// The other characters that are equal to `c`: at most three.
    pub fn equivalents(self, c: u32) -> impl Iterator<Item = u32> {
        core::iter::successors(Some(self.next(c)), move |&at| Some(self.next(at)))
            .take_while(move |&at| at != c)
    }

    /// Calls `add` with ranges that make `range` hold all characters equal to one of its own. They can overlap it and
    /// one another, and come in no order.
    pub fn close_over(self, range: RangeInclusive<u32>, mut add: impl FnMut(RangeInclusive<u32>)) {
        let (first, last) = range.into_inner();
        let runs = self.runs_from(first).iter();
        for run in runs.take_while(|run| run.first <= last) {
            let (from, to) = (run.first.max(first), run.last.min(last));
            match run.step {
                Step::Adjacent if (from, to) == (run.first, run.last) => {}
                Step::Adjacent => {
                    add(from - ((from - run.first) & 1)..=to + (!(to - run.first) & 1));
                }
                Step::Offset(delta) => {
                    add(from.wrapping_add_signed(delta)..=to.wrapping_add_signed(delta));
                }
                Step::Cycle(_) => self.equivalents(from).for_each(|c| add(c..=c)),
            }
        }
    }
}
