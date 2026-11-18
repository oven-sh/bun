//! JavaScript's regular expressions for code that has no VM: they are interpreted, on any thread.

#![forbid(unsafe_code)]

use core::cell::{Cell, RefCell};
use std::sync::OnceLock;

use bun_core::StackCheck;
use bun_engine_regexp::{Context, Flags, Form, Mode, Options, Outcome, Patient, Pattern, Width};
use bun_engine_text::MAX_LENGTH;
pub use bun_engine_text::Text;

pub mod flags {
    use bun_engine_regexp::Flags;

    pub const HAS_INDICES: u16 = Flags::HAS_INDICES.bits() as u16;
    pub const GLOBAL: u16 = Flags::GLOBAL.bits() as u16;
    pub const IGNORE_CASE: u16 = Flags::IGNORE_CASE.bits() as u16;
    pub const MULTILINE: u16 = Flags::MULTILINE.bits() as u16;
    pub const DOT_ALL: u16 = Flags::DOT_ALL.bits() as u16;
    pub const UNICODE: u16 = Flags::UNICODE.bits() as u16;
    pub const UNICODE_SETS: u16 = Flags::UNICODE_SETS.bits() as u16;
    pub const STICKY: u16 = Flags::STICKY.bits() as u16;
}

/// Where a group starts and ends that took no part in the match.
pub const NO_MATCH: u32 = u32::MAX;

/// Why a pattern is refused.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Error {
    /// The pattern, a quantifier, the number of groups or their depth.
    TooLarge,
    /// A `\p{..}` that the data of Unicode does not have.
    UnknownProperty,
    Syntax,
}

impl From<bun_engine_regexp::Error> for Error {
    fn from(error: bun_engine_regexp::Error) -> Error {
        use bun_engine_regexp::Error as Reason;
        match error {
            Reason::PatternTooLarge
            | Reason::QuantifierTooLarge
            | Reason::MinimumLengthTooLarge
            | Reason::TooManyCaptures
            | Reason::TooDeeplyNested
            | Reason::OutOfMemory => Error::TooLarge,
            Reason::InvalidProperty => Error::UnknownProperty,
            _ => Error::Syntax,
        }
    }
}

/// A few seconds of searching.
const MAX_POLLS: u32 = 1 << 18;

thread_local! {
    static POLLS: Cell<u32> = const { Cell::new(0) };
    static CONTEXT: RefCell<Context> = {
        let mut context = Context::new();
        context.set_poll(Box::new(|| POLLS.replace(POLLS.get() + 1) >= MAX_POLLS));
        RefCell::new(context)
    };
}

struct Programs {
    pattern: Pattern,
    latin1: Patient,
    utf16: OnceLock<Patient>,
}

impl Programs {
    #[inline]
    fn get(&self, text: Text<'_>) -> Option<&Patient> {
        match text {
            Text::Latin1(_) => Some(&self.latin1),
            Text::Utf16(_) => self.utf16.get().or_else(|| {
                let program = compile(&self.pattern, Width::Utf16).ok()?;
                Some(self.utf16.get_or_init(|| program))
            }),
        }
    }

    fn exec(&self, text: Text<'_>, start: u32, captures: &mut [u32]) -> Option<(u32, u32)> {
        let program = self.get(text)?;
        POLLS.set(0);
        let outcome = CONTEXT.with_borrow_mut(|context| {
            let tree = self.pattern.tree();
            let outcome = program.exec(tree, stack_limit, text, start, captures, context);
            context.trim();
            outcome
        });
        match outcome {
            Outcome::Match { start, end } => Some((start, end)),
            _ => None,
        }
    }
}

enum Matcher {
    Form(Box<Form>),
    Programs(Box<Programs>),
}

/// A pattern that is compiled. Threads can share it.
pub struct Compiled {
    matcher: Matcher,
    group_count: u16,
}

impl core::fmt::Debug for Compiled {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.debug_struct("Compiled").finish_non_exhaustive()
    }
}

fn stack_limit() -> usize {
    let here = 0u8;
    let address = (&raw const here).addr();
    address.saturating_sub(StackCheck::init().remaining())
}

fn compile(pattern: &Pattern, width: Width) -> Result<Patient, bun_engine_regexp::Error> {
    let options = Options {
        width,
        mode: Mode::Captures,
        sample: Text::EMPTY,
        stack_limit: stack_limit(),
    };
    Patient::new(pattern.tree(), &options)
}

impl Compiled {
    /// `bits`: of [`flags`].
    pub fn new(pattern: Text<'_>, bits: u16) -> Result<Compiled, Error> {
        let flags = u8::try_from(bits).map_err(|_| Error::Syntax)?;
        let flags = Flags::from_bits_retain(flags);
        if flags.contains(Flags::UNICODE | Flags::UNICODE_SETS) {
            return Err(Error::Syntax);
        }
        let pattern = Pattern::new(pattern, flags)?;
        let group_count = pattern.group_count();
        let matcher = match pattern.form().map_err(|_| Error::TooLarge)? {
            Some(form) => Matcher::Form(Box::new(form)),
            None => Matcher::Programs(Box::new(Programs {
                latin1: compile(&pattern, Width::Latin1)?,
                utf16: OnceLock::new(),
                pattern,
            })),
        };
        Ok(Compiled {
            matcher,
            group_count,
        })
    }

    /// How long the `offsets` of [`Compiled::exec`] have to be: two for the match and two for each group.
    #[inline]
    pub fn offsets_len(&self) -> usize {
        (usize::from(self.group_count) + 1) * 2
    }

    /// Whether there is a match that starts at the index `start` or after it: only at `start` with the `y` flag. With
    /// `u` or `v` an index inside a surrogate pair stands for the start of the pair. `false` as well if the search is
    /// given up, after seconds or for lack of memory, or if `offsets` is too short.
    ///
    /// After a match `offsets` has the start and the end of the match and of each group, as indices in `text`.
    pub fn exec(&self, text: Text<'_>, start: u32, offsets: &mut [u32]) -> bool {
        let Some([match_start, match_end, captures @ ..]) = offsets.get_mut(..self.offsets_len())
        else {
            return false;
        };
        if text.len() > MAX_LENGTH {
            return false;
        }
        let found = match &self.matcher {
            Matcher::Form(form) => form
                .find(text, start as usize)
                .map(|found| (found.start as u32, found.end as u32)),
            Matcher::Programs(programs) => programs.exec(text, start, captures),
        };
        if let Some(found) = found {
            (*match_start, *match_end) = found;
        }
        found.is_some()
    }

    /// Whether there is a match anywhere: only at the start with the `y` flag.
    pub fn is_match(&self, text: Text<'_>) -> bool {
        let mut few = [NO_MATCH; 32];
        match few.get_mut(..self.offsets_len()) {
            Some(offsets) => self.exec(text, 0, offsets),
            None => self.exec(text, 0, &mut vec![NO_MATCH; self.offsets_len()]),
        }
    }
}
