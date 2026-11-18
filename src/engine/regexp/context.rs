//! The memory that matching works in, and how it ends.

use core::mem::offset_of;

use bun_engine_unicode::IgnoreCase;

use crate::meter::{BUDGET, Meter};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Match {
        start: u32,
        end: u32,
    },
    NoMatch,
    /// The function given to [`Context::set_poll`] said so.
    Interrupted,
    OutOfMemory,
    /// The search is one for [`Context::race`].
    TooSlow,
    /// Neither side of a race has got to the end.
    TooComplex,
}

const INITIAL_WORDS: usize = 1 << 10;
const MANY_WORDS: usize = 1 << 21;
const KEPT_WORDS: usize = 1 << 16;
const DEFAULT_MAX_STACK_BYTES: usize = 192 << 20;

/// Words that are all initialized, and that generated code finds by address.
#[repr(C)]
pub(crate) struct Words {
    start: usize,
    end: usize,
    words: Vec<u32>,
}

impl Words {
    const fn new() -> Words {
        Words {
            start: 0,
            end: 0,
            words: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn as_mut_slice(&mut self) -> &mut [u32] {
        &mut self.words
    }

    /// Keeps the contents.
    #[inline]
    pub(crate) fn ensure(&mut self, length: usize, max: usize) -> Option<()> {
        if length > self.words.len() {
            self.grow(length, max)?;
        }
        Some(())
    }

    #[cold]
    fn grow(&mut self, length: usize, max: usize) -> Option<()> {
        if length > max {
            return None;
        }
        let (old, words) = (self.words.len(), &mut self.words);
        let more = old.clamp(INITIAL_WORDS, MANY_WORDS);
        let length = (old + more).min(max).max(length);
        // What is not touched costs nothing, whereas a copy needs the memory twice.
        let has_room = length <= words.capacity()
            || old >= MANY_WORDS && words.try_reserve_exact(max - old).is_ok();
        if !has_room {
            words.try_reserve_exact(length - old).ok()?;
        }
        self.words.resize(length, 0);
        self.publish();
        Some(())
    }

    fn trim(&mut self) {
        if self.words.len() > KEPT_WORDS {
            self.words = Vec::new();
            self.publish();
        }
    }

    fn publish(&mut self) {
        let range = self.words.as_mut_ptr_range();
        self.start = range.start.expose_provenance();
        self.end = range.end.expose_provenance();
    }
}

#[repr(C)]
pub(crate) struct Memory {
    pub(crate) stack: Words,
    pub(crate) cells: Words,
    pub(crate) max_stack_words: usize,
}

impl Memory {
    pub(crate) const fn new(max_stack_words: usize) -> Memory {
        Memory {
            stack: Words::new(),
            cells: Words::new(),
            max_stack_words,
        }
    }

    pub(crate) fn trim(&mut self) {
        self.stack.trim();
        self.cells.trim();
    }

    /// With its limit. What is on the stack of the other one is lost.
    pub(crate) fn take_stack_of(&mut self, other: &mut Memory) {
        let own = &self.stack.words;
        if let Some(room) = other.stack.words.get_mut(..own.len()) {
            room.copy_from_slice(own);
            core::mem::swap(&mut self.stack, &mut other.stack);
        }
        (other.stack, self.max_stack_words) = (Words::new(), other.max_stack_words);
    }

    pub(crate) fn size(&self) -> usize {
        (self.stack.words.len() + self.cells.words.len()) * size_of::<u32>()
    }
}

/// One is enough for a thread: matching runs no script.
#[repr(C)]
pub struct Context {
    pub(crate) memory: Memory,
    pub(crate) meter: Meter,
}

impl Context {
    pub const OFFSET_OF_STACK_START: usize = offset_of!(Context, memory.stack.start);
    pub const OFFSET_OF_STACK_END: usize = offset_of!(Context, memory.stack.end);
    pub const OFFSET_OF_CELLS_START: usize = offset_of!(Context, memory.cells.start);
    pub const OFFSET_OF_CELLS_END: usize = offset_of!(Context, memory.cells.end);
    /// Of 32 bits that are cleared when a search starts.
    pub const OFFSET_OF_HAS_POLLED: usize = offset_of!(Context, meter.has_polled);
    /// Of 32 bits with what a program that counts turns starts with.
    pub const OFFSET_OF_FUEL: usize = offset_of!(Context, meter.fuel);

    pub const fn new() -> Context {
        Context {
            memory: Memory::new(DEFAULT_MAX_STACK_BYTES / size_of::<u32>()),
            meter: Meter::new(),
        }
    }

    /// `should_stop` is asked now and then during a long match.
    pub fn set_poll(&mut self, should_stop: Box<dyn FnMut() -> bool>) {
        self.meter.should_stop = Some(should_stop);
    }

    /// `name_pattern` tells one pattern from another, for the search that is under way.
    pub fn set_name_of_pattern(&mut self, name_pattern: Box<dyn Fn() -> usize>) {
        self.meter.name_pattern = Some(name_pattern);
    }

    /// For want of [`Rivals`](crate::Rivals). A search in `body` goes on when it is too slow, until it is too complex.
    pub fn patiently<R>(&mut self, body: impl FnOnce(&mut Context) -> R) -> R {
        self.meter.patience = Some(2 * BUDGET);
        let result = body(self);
        self.meter.patience = None;
        result
    }

    pub fn set_max_stack_size(&mut self, bytes: usize) {
        self.memory = Memory::new(bytes / size_of::<u32>());
    }

    /// About the number of cycles that the interpreter has taken since the last call.
    #[inline]
    pub fn take_work(&mut self) -> u64 {
        core::mem::take(&mut self.meter.interpreted)
    }

    /// Frees what an unusually deep match has left.
    pub fn trim(&mut self) {
        self.memory.trim();
    }
}

macro_rules! helpers {
    ($($(#[$meta:meta])* fn $name:ident $arguments:tt -> $result:ty $body:block)*) => {$(
        #[cfg(target_arch = "x86_64")]
        $(#[$meta])*
        pub extern "sysv64" fn $name $arguments -> $result $body

        #[cfg(not(target_arch = "x86_64"))]
        $(#[$meta])*
        pub extern "C" fn $name $arguments -> $result $body
    )*};
}

/// What generated code calls.
pub mod helper {
    use super::{Context, IgnoreCase, Outcome};
    use crate::meter::{FUEL, Report};
    use crate::race::Racing;

    pub const INTERRUPTED: isize = -2;
    pub const TOO_SLOW: isize = -4;
    pub const TOO_COMPLEX: isize = -5;

    /// In the place of a position that is not known.
    pub const NOWHERE: i32 = 1;

    const MAX_WORK_PER_UNIT: u32 = (1 << 27) - 1;
    const PASSES_VECTORS: u64 = 1 << 27;
    /// Where a description has by how much the work since the last poll is less than the fuel that is used for it.
    pub const SHIFT_OF_SAVED_WORK: u8 = 28;

    /// What code tells about itself when it polls.
    pub fn describe(work_per_unit: u32, passes_vectors: bool) -> u64 {
        u64::from(work_per_unit.min(MAX_WORK_PER_UNIT))
            | (u64::from(passes_vectors) * PASSES_VECTORS)
    }

    /// What is below zero shows how far the code has last gone back, which most of the fuel is likely to be spent on.
    fn report(given: u32, fuel: i64, position: i32, attempt: i32, description: u64) -> Report {
        const LONG_WAY: i64 = 32;
        const UNITS_PER_CYCLE: u64 = 4;
        let spent = fuel.abs_diff(given.into());
        Report {
            work: match description & PASSES_VECTORS != 0 && fuel < -LONG_WAY {
                true => spent / UNITS_PER_CYCLE,
                false => spent,
            },
            saved_work: description >> SHIFT_OF_SAVED_WORK,
            position: position.into(),
            attempt: (attempt != NOWHERE).then_some(attempt.into()),
            work_per_unit: description as u32 & MAX_WORK_PER_UNIT,
        }
    }

    fn encode(polled: Result<u32, Outcome>) -> isize {
        match polled {
            Ok(fuel) => fuel as isize,
            Err(Outcome::TooSlow) => TOO_SLOW,
            Err(Outcome::TooComplex) => TOO_COMPLEX,
            Err(_) => INTERRUPTED,
        }
    }

    helpers! {
        /// Makes room for `words` words at `top`, and returns where `top` is now. Zero if there is no memory.
        fn grow_stack(context: &mut Context, top: usize, words: usize) -> usize {
            let memory = &mut context.memory;
            let used = (top - memory.stack.start) / size_of::<u32>();
            match memory.stack.ensure(used + words, memory.max_stack_words) {
                Some(()) => memory.stack.start + used * size_of::<u32>(),
                None => 0,
            }
        }

        /// Returns the address of `words` words. Zero if there is no memory.
        fn grow_cells(context: &mut Context, words: usize) -> usize {
            match context.memory.cells.ensure(words, usize::MAX) {
                Some(()) => context.memory.cells.start,
                None => 0,
            }
        }

        /// Returns more fuel, or why the search ends, which is negative. Positions count from the end of the subject,
        /// whose address is `end`.
        fn poll(
            context: &mut Context,
            fuel: i64,
            position: i32,
            attempt: i32,
            description: u64,
            end: usize,
        ) -> isize {
            let report = report(FUEL, fuel, position, attempt, description);
            encode(context.meter.poll(&report, end))
        }

        /// The same for a program that counts turns, with those since the last call.
        fn poll_racing(
            racing: &mut Racing<'_>,
            fuel: i64,
            position: i32,
            attempt: i32,
            description: u64,
            turns: u64,
        ) -> isize {
            let report = report(racing.fuel(), fuel, position, attempt, description);
            encode(racing.poll(report, turns))
        }

        /// Not zero if the characters are equal when case is ignored.
        fn equal_ignoring_case(a: u32, b: u32, unicode_aware: u32) -> usize {
            let equivalence = match unicode_aware {
                0 => IgnoreCase::CodeUnits,
                _ => IgnoreCase::CodePoints,
            };
            usize::from(equivalence.canonicalize(a) == equivalence.canonicalize(b))
        }
    }
}
