//! Lets two programs take turns at a search when it is not known which of them is quicker.

use bun_engine_text::Text;

use crate::Error;
use crate::compile::{Compiler, Options, Purpose};
use crate::context::{Context, Memory, Outcome};
use crate::interpreter::{Memo, Pause, end_address};
use crate::meter::{BUDGET, FUEL, Report};
use crate::program::Program;
use crate::tree::Tree;

/// The plain program is given up only after that many turns of repeated groups.
const MAX_TURNS: u64 = 100_000_000;
/// It takes longer.
const WEIGHT_OF_INTERPRETED_TURN: u64 = 2;
const FIRST_FUEL: u32 = 1 << 10;
const HEAD_START: u64 = 2 * FIRST_FUEL as u64;

pub struct Rivals {
    plain: Box<Program>,
    memoizing: Option<Box<Program>>,
    /// Whether another try could still make the memoizing program.
    can_be_two: bool,
    are_sticky: bool,
}

impl Rivals {
    /// The memoizing program is left out if it cannot be made now, and [`Rivals::can_be_two`] then holds.
    pub fn new(
        compiler: &mut Compiler,
        tree: &Tree,
        options: &Options<'_>,
    ) -> Result<Rivals, Error> {
        let mut rivals = Rivals {
            plain: compiler.compile_for(Purpose::Counting, tree, options)?,
            memoizing: None,
            can_be_two: true,
            are_sticky: tree.is_sticky(),
        };
        rivals.make_memoizing(compiler, tree, options);
        Ok(rivals)
    }

    /// Makes the memoizing program, unless there is one or there can be none.
    pub fn make_memoizing(&mut self, compiler: &mut Compiler, tree: &Tree, options: &Options<'_>) {
        if !self.can_be_two {
            return;
        }
        match compiler.compile_for(Purpose::Memoizing, tree, options) {
            // There is nothing to remember, or the pattern needs more than this program can hold.
            Ok(program) => {
                self.memoizing = Some(program).filter(|it| !it.sites.sites.is_empty());
                self.can_be_two = false;
            }
            // Another try, with more memory or less of the stack in use, can do better.
            Err(Error::OutOfMemory | Error::TooDeeplyNested) => {}
            Err(_) => self.can_be_two = false,
        }
    }

    /// Whether [`Rivals::make_memoizing`] has anything left to do.
    pub fn can_be_two(&self) -> bool {
        self.can_be_two
    }

    /// Machine code for it takes a [`Racing`] where other code takes a [`Context`].
    pub fn plain(&self) -> &Program {
        &self.plain
    }

    /// Whether there is another one.
    pub fn are_two(&self) -> bool {
        self.memoizing.is_some()
    }

    /// The bytes of memory that they hold.
    pub fn size(&self) -> usize {
        self.plain.size() + self.memoizing.as_ref().map_or(0, |it| it.size())
    }
}

/// What a race leaves to the next one with the same rivals and the same subject.
pub struct Notes {
    memory: Memory,
    memo: Memo,
    captures: Vec<u32>,
    /// The memo is for searches from here on.
    valid_from: u32,
    /// Half of what the plain program has done while it was slow, less what the memoizing one has done.
    owed: i64,
    /// With less the memoizing program is not expected to get to the end.
    least_worth_starting: i64,
    /// What it has done since it has last lost.
    work_that_has_paid: i64,
}

impl Notes {
    pub fn new() -> Notes {
        Notes {
            memory: Memory::new(0),
            memo: Memo::new(),
            captures: Vec::new(),
            valid_from: 0,
            owed: 0,
            least_worth_starting: 1,
            work_that_has_paid: 0,
        }
    }

    /// For other rivals, or another subject.
    pub fn clear(&mut self) {
        const SIZE_KEPT: usize = 1 << 16;
        match self.size() > SIZE_KEPT {
            true => *self = Notes::new(),
            false => {
                self.memo.clear();
                (self.valid_from, self.owed) = (0, 0);
                (self.least_worth_starting, self.work_that_has_paid) = (1, 0);
            }
        }
    }

    /// Whether they say nothing.
    pub fn are_blank(&self) -> bool {
        self.memo.is_empty() && self.owed == 0 && self.least_worth_starting == 1
    }

    /// One against the plain program lets it go first until it has done as much again.
    fn note_win(&mut self, work: u64, was_contested: bool) {
        self.work_that_has_paid = (self.work_that_has_paid + work as i64).min(BUDGET as i64);
        self.least_worth_starting = 1;
        if was_contested {
            self.owed = self.work_that_has_paid;
        }
    }

    fn note_loss(&mut self, work: u64) {
        self.least_worth_starting = (2 * work).min(BUDGET / 8) as i64;
        self.work_that_has_paid = 0;
    }

    /// The bytes of memory that they hold.
    pub fn size(&self) -> usize {
        self.memory.size() + self.memo.size() + self.captures.capacity() * size_of::<u32>()
    }
}

/// A search for [`Context::race`].
#[derive(Clone, Copy)]
pub struct Search<'a> {
    pub subject: Text<'a>,
    pub start: u32,
    /// With this context, just now.
    pub has_been_too_slow: bool,
}

pub struct Raced {
    /// Not [`Outcome::TooSlow`].
    pub outcome: Outcome,
    /// Whether the plain program has needed no help.
    pub was_quick: bool,
}

/// What a program knows of the search.
struct Side<'a> {
    program: &'a Program,
    /// All attempts before this one fail.
    attempt: u32,
    work_since_start: u64,
}

impl<'a> Side<'a> {
    fn new(program: &'a Program) -> Side<'a> {
        Side {
            program,
            attempt: 0,
            work_since_start: 0,
        }
    }

    /// Whether it should start again, from an attempt that is that far from the end.
    fn can_afford_start(&self, units: usize) -> bool {
        const WORK_PER_UNIT: u64 = 32;
        !self.program.walks_back() || self.work_since_start >= units as u64 * WORK_PER_UNIT
    }
}

#[repr(C)]
pub struct Racing<'a> {
    /// Of the plain program.
    context: Context,
    plain: Side<'a>,
    memoizing: Option<Side<'a>>,
    notes: &'a mut Notes,
    search: Search<'a>,
    /// Of the memoizing program, once it has started.
    pause: Option<Pause>,
    outcome: Option<Outcome>,
    farthest: usize,
    budget: u64,
    memoizing_work: u64,
    slow_work: u64,
    saved_work: u64,
    turns: u64,
}

impl Racing<'_> {
    /// What the plain program has been given last.
    pub(crate) fn fuel(&self) -> u32 {
        self.context.meter.fuel
    }

    fn answer(&self) -> Option<Outcome> {
        (self.outcome).filter(|it| matches!(it, Outcome::Match { .. } | Outcome::NoMatch))
    }

    fn take_turn(&mut self, fuel: u32) {
        let (Some(side), notes) = (&mut self.memoizing, &mut *self.notes) else {
            return;
        };
        let start = self.search.start.max(self.plain.attempt);
        let pause = self.pause.get_or_insert_with(|| Pause::before(start));
        let (captures, memory) = (&mut notes.captures, &mut notes.memory);
        let (subject, memo) = (self.search.subject, Some(&mut notes.memo));
        self.outcome = (side.program).go_on(subject, captures, memory, memo, pause, fuel);
        side.attempt = side.attempt.max(pause.attempt().unwrap_or(0));
        side.work_since_start += pause.work();
        let gained = pause.reached().saturating_sub(self.farthest);
        self.farthest += gained;
        let budget = self.budget + gained as u64 * u64::from(side.program.work_per_unit());
        self.budget = budget.min(BUDGET).saturating_sub(pause.work());
        self.memoizing_work += pause.work();
        notes.owed -= pause.work() as i64;
        if self.budget == 0 && self.outcome.is_none() {
            notes.clear();
        }
    }

    /// Spares the memoizing program the attempts that the plain one has seen fail.
    fn skip_failed_attempts(&mut self) {
        let (notes, start) = (&mut *self.notes, self.plain.attempt);
        if let (Some(side), Some(pause)) = (&mut self.memoizing, &mut self.pause)
            && self.budget != 0
            && side.program.latest_attempt(pause, &mut notes.memory) < start as usize
            && side.can_afford_start(self.search.subject.len() - start as usize)
        {
            notes.memo.abandon_attempt();
            (*pause, self.outcome, side.work_since_start) = (Pause::before(start), None, 0);
        }
    }

    /// Lets the memoizing program do what it is owed.
    fn catch_up(&mut self) -> Result<(), Outcome> {
        let is_worth_it = self.notes.owed >= self.notes.least_worth_starting;
        if self.memoizing.is_none() || self.pause.is_none() && !is_worth_it {
            return Ok(());
        }
        self.skip_failed_attempts();
        while self.notes.owed > 0 && self.budget != 0 && self.outcome.is_none() {
            self.take_turn(self.notes.owed.min(FUEL.into()) as u32);
            if self.context.meter.should_stop() {
                return Err(Outcome::Interrupted);
            }
        }
        match self.answer() {
            Some(_) => Err(Outcome::TooSlow),
            None => Ok(()),
        }
    }

    /// Where the plain program had better go on.
    fn later_start(&self) -> Option<u32> {
        let (attempt, length) = (self.memoizing.as_ref()?.attempt, self.search.subject.len());
        let is_later = attempt > self.search.start.max(self.plain.attempt);
        (is_later && self.plain.can_afford_start(length - attempt as usize)).then_some(attempt)
    }

    /// More fuel for the plain program, or why it ends. It is too slow if the other one is ahead.
    pub(crate) fn poll(&mut self, mut report: Report, turns: u64) -> Result<u32, Outcome> {
        const MOST_UNITS_PER_CYCLE: u64 = 32;
        self.saved_work += report.saved_work;
        let saved = (self.saved_work).min(report.work - report.work / MOST_UNITS_PER_CYCLE);
        (report.work, self.saved_work) = (report.work - saved, self.saved_work - saved);
        let (meter, subject) = (&mut self.context.meter, self.search.subject);
        if meter.should_stop() {
            return Err(Outcome::Interrupted);
        }
        meter.has_polled |= u32::from(self.search.has_been_too_slow);
        self.turns += turns;
        let is_slow = meter.charge(&report, end_address(subject), HEAD_START);
        self.plain.attempt = meter.attempt(subject.len()).unwrap_or(0);
        self.plain.work_since_start += report.work;
        meter.fuel = FUEL.min(meter.fuel * 2);
        if is_slow {
            self.slow_work += report.work;
            self.notes.owed = (self.notes.owed + report.work as i64 / 2).min(BUDGET as i64);
            self.catch_up()?;
            let budget = BUDGET * if self.memoizing.is_some() { 1 } else { 2 };
            if self.turns > MAX_TURNS && self.slow_work > budget {
                return Err(Outcome::TooComplex);
            }
            if self.later_start().is_some() {
                return Err(Outcome::TooSlow);
            }
        }
        Ok(self.context.meter.fuel)
    }

    fn interpret(&mut self, captures: &mut [u32]) -> Outcome {
        let (plain, subject) = (self.plain.program, self.search.subject);
        let mut pause = Pause::before(self.search.start);
        self.context.meter.has_polled = 0;
        loop {
            let (fuel, memory) = (self.fuel(), &mut self.context.memory);
            let outcome = plain.go_on(subject, captures, memory, None, &mut pause, fuel);
            let turns = pause.take_turns() * WEIGHT_OF_INTERPRETED_TURN;
            let polled = || self.poll(pause.report(plain, subject), turns).err();
            if let Some(outcome) = outcome.or_else(polled) {
                return outcome;
            }
        }
    }

    fn run(&mut self, mut native: Option<RunNative<'_>>, captures: &mut [u32]) -> Outcome {
        if let Err(outcome) = self.catch_up() {
            return outcome;
        }
        loop {
            self.search.start = self.later_start().unwrap_or(self.search.start);
            self.plain.work_since_start = 0;
            let outcome = match &mut native {
                Some(run) => run(self.search.start, captures, self),
                None => self.interpret(captures),
            };
            if outcome != Outcome::TooSlow || self.answer().is_some() {
                return outcome;
            }
        }
    }

    /// After the plain program has given up with that outcome.
    fn go_on_alone(&mut self, outcome: Outcome) -> Outcome {
        if self.memoizing.is_none() {
            return outcome;
        }
        self.notes.memory.take_stack_of(&mut self.context.memory);
        self.outcome = None;
        self.skip_failed_attempts();
        while self.budget != 0 && self.outcome.is_none() {
            if self.context.meter.should_stop() {
                return Outcome::Interrupted;
            }
            self.take_turn(FUEL);
        }
        outcome
    }

    fn finish(&mut self, mut outcome: Outcome, is_sticky: bool, captures: &mut [u32]) -> Outcome {
        if let Outcome::TooComplex | Outcome::OutOfMemory = outcome {
            outcome = self.go_on_alone(outcome);
        }
        if let Some(answer) = self.answer() {
            outcome = answer;
            captures.copy_from_slice(&self.notes.captures);
            self.notes
                .note_win(self.memoizing_work, self.slow_work != 0);
        } else if self.pause.is_some() {
            self.notes.note_loss(self.memoizing_work);
        }
        match outcome {
            Outcome::Match { end, .. } if self.pause.is_some() => {
                self.notes.memo.note_match(end);
                self.notes.valid_from = end;
            }
            Outcome::Match { .. } => {}
            // Otherwise the end of the subject has been reached.
            Outcome::NoMatch if is_sticky => self.notes.memo.abandon_attempt(),
            _ => self.notes.clear(),
        }
        self.notes.memory.trim();
        outcome
    }
}

/// Runs machine code for the plain program from a start.
pub type RunNative<'a> = &'a mut dyn FnMut(u32, &mut [u32], &mut Racing<'_>) -> Outcome;

impl Context {
    /// Like [`Program::exec`], for a pattern that takes too long at times.
    pub fn race(
        &mut self,
        rivals: &Rivals,
        native: Option<RunNative<'_>>,
        notes: &mut Notes,
        mut search: Search<'_>,
        captures: &mut [u32],
    ) -> Raced {
        self.meter.fuel = FIRST_FUEL;
        if search.has_been_too_slow {
            let attempt = self.meter.attempt(search.subject.len());
            search.start = search.start.max(attempt.unwrap_or(0));
            self.meter.go_on();
        }
        if search.start < notes.valid_from {
            notes.clear();
        }
        let max_words = self.memory.max_stack_words;
        notes.memory.max_stack_words = max_words / 4;
        notes.memo.set_max_size(max_words * size_of::<u32>() / 4);
        notes.captures.clear();
        let has_captures = notes.captures.try_reserve(captures.len()).is_ok();
        if has_captures {
            notes.captures.resize(captures.len(), 0);
        }
        let memoizing = rivals.memoizing.as_ref().filter(|_| has_captures);
        let mut racing = Racing {
            context: core::mem::replace(self, Context::new()),
            plain: Side::new(&rivals.plain),
            memoizing: memoizing.map(|it| Side::new(it)),
            notes,
            search,
            pause: None,
            outcome: None,
            farthest: search.start as usize,
            budget: BUDGET,
            memoizing_work: 0,
            slow_work: 0,
            saved_work: 0,
            turns: 0,
        };
        let outcome = racing.run(native, captures);
        let raced = Raced {
            outcome: racing.finish(outcome, rivals.are_sticky, captures),
            was_quick: racing.slow_work == 0 && racing.pause.is_none(),
        };
        *self = racing.context;
        raced
    }
}

#[cfg(test)]
mod tests {
    use bun_engine_standalone as _;

    use super::*;
    use crate::program::UNSET;
    use crate::{Flags, Mode, Pattern, Width};

    include!("tests/support/cases.rs");

    fn compile(purpose: Purpose, source: &str, letters: &str) -> Box<Program> {
        let units: Vec<u16> = source.encode_utf16().collect();
        let flags = Flags::parse(Text::from_ascii(letters)).unwrap();
        let options = Options {
            width: Width::Utf16,
            mode: Mode::Captures,
            sample: Text::EMPTY,
            stack_limit: 0,
        };
        let pattern = Pattern::new(Text::Utf16(&units), flags).unwrap();
        (Compiler::default().compile_for(purpose, pattern.tree(), &options)).unwrap()
    }

    #[test]
    fn each_rival_has_the_known_answers_however_often_it_pauses() {
        for &(source, letters, subject, start, expected) in CASES {
            let units: Vec<u16> = subject.encode_utf16().collect();
            let expected = expected.iter().map(|&it| it.try_into().unwrap_or(UNSET));
            let expected: Vec<u32> = expected.collect();
            for (purpose, fuel, size) in [
                (Purpose::Counting, 1, 0),
                (Purpose::Memoizing, FUEL, 1 << 20),
                (Purpose::Memoizing, 1, 1 << 20),
                (Purpose::Memoizing, 100, 0),
            ] {
                let program = compile(purpose, source, letters);
                let mut captures = vec![7; program.capture_entries()];
                let (mut memory, mut memo) = (Memory::new(1 << 16), Memo::new());
                memo.set_max_size(size);
                let (subject, mut pause) = (Text::Utf16(&units), Pause::before(start));
                let outcome = core::iter::repeat_with(|| {
                    let memo = Some(&mut memo);
                    program.go_on(subject, &mut captures, &mut memory, memo, &mut pause, fuel)
                });
                let found = match outcome.flatten().next() {
                    Some(Outcome::Match { start, end }) => [&[start, end], &captures[..]].concat(),
                    _ => Vec::new(),
                };
                assert_eq!(found, expected, "/{source}/{letters}");
            }
        }
    }
}
