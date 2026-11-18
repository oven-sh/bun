//! For those who only interpret.

use std::sync::OnceLock;

use bun_engine_text::Text;

use crate::Error;
use crate::compile::Compiler;
use crate::compile::{Mode, Options, compile};
use crate::context::{Context, Outcome};
use crate::program::Program;
use crate::race::{Notes, Rivals, Search};
use crate::tree::Tree;

/// A program that gets help when it takes too long. Threads can share it.
pub struct Patient {
    usual: Program,
    rivals: OnceLock<Rivals>,
}

impl Patient {
    pub fn new(tree: &Tree, options: &Options<'_>) -> Result<Patient, Error> {
        Ok(Patient {
            usual: compile(tree, options)?,
            rivals: OnceLock::new(),
        })
    }

    /// Like [`Program::exec`], but never [`TooSlow`](Outcome::TooSlow). `tree` is the one that it has been made from.
    #[inline]
    pub fn exec(
        &self,
        tree: &Tree,
        stack_limit: impl FnOnce() -> usize,
        subject: Text<'_>,
        start: u32,
        captures: &mut [u32],
        context: &mut Context,
    ) -> Outcome {
        match self.usual.exec(subject, start, captures, context) {
            Outcome::TooSlow => self.race(tree, stack_limit(), subject, start, captures, context),
            outcome => outcome,
        }
    }

    #[cold]
    fn race(
        &self,
        tree: &Tree,
        stack_limit: usize,
        subject: Text<'_>,
        start: u32,
        captures: &mut [u32],
        context: &mut Context,
    ) -> Outcome {
        let options = Options {
            width: self.usual.width(),
            mode: match self.usual.reports_captures() {
                true => Mode::Captures,
                false => Mode::MatchOnly,
            },
            sample: Text::EMPTY,
            stack_limit,
        };
        let mut compiler = Compiler::default();
        let for_now;
        let rivals = match self.rivals.get() {
            Some(rivals) => rivals,
            None => match Rivals::new(&mut compiler, tree, &options) {
                // Another try can still make the memoizing program, so these are not kept.
                Ok(rivals) if rivals.can_be_two() => {
                    for_now = rivals;
                    &for_now
                }
                Ok(rivals) => self.rivals.get_or_init(|| rivals),
                Err(_) => {
                    return context.patiently(|it| self.usual.exec(subject, start, captures, it));
                }
            },
        };
        let search = Search {
            subject,
            start,
            has_been_too_slow: true,
        };
        (context.race(rivals, None, &mut Notes::new(), search, captures)).outcome
    }
}
