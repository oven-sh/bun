//! Machine code for compiled regular expressions.
//!
//! The code is a C function (System V on x86-64) that starts at its first byte:
//!
//! ```text
//! fn(subject: *const unit, start: usize, length: usize, captures: *mut u32, context: &mut Context) -> (usize, usize)
//! ```
//!
//! The subject has the width of the program and `length` units, at most `i32::MAX`. `start` fits in 32 bits.
//! `captures` is as for `Program::exec`. The results are the start and the end of the match, unless the low half of
//! the first is negative: see [`outcome`]. The code for the plain program of `Rivals` takes a `&mut Racing` last.

#![forbid(unsafe_code)]

mod back_reference;
mod call;
mod captures;
mod class;
mod code_point;
mod frame;
mod generator;
mod lanes;
mod run;
mod scan;
mod stack;
mod switch;
mod tables;
mod vector;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, CodeTooLarge, Features};
use bun_engine_regexp::program::Verified;
use bun_engine_regexp::{Outcome, helper};

pub use tables::Tables;

pub const NO_MATCH: u32 = u32::MAX;
pub const INTERRUPTED: u32 = helper::INTERRUPTED as u32;
pub const OUT_OF_MEMORY: u32 = u32::MAX - 2;
pub const TOO_SLOW: u32 = helper::TOO_SLOW as u32;
pub const TOO_COMPLEX: u32 = helper::TOO_COMPLEX as u32;

/// What the results of the code mean.
#[inline]
pub fn outcome(start: usize, end: usize) -> Outcome {
    match start as u32 {
        NO_MATCH => Outcome::NoMatch,
        INTERRUPTED => Outcome::Interrupted,
        OUT_OF_MEMORY => Outcome::OutOfMemory,
        TOO_SLOW => Outcome::TooSlow,
        TOO_COMPLEX => Outcome::TooComplex,
        start => Outcome::Match {
            start,
            end: end as u32,
        },
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub features: Features,
    /// Decides how constants that the pattern has chosen are disguised.
    pub seed: u64,
    /// With the tables.
    pub max_code_size: usize,
    /// With more units after the start, a search is too slow at once.
    pub max_units: Option<u32>,
}

/// Keeps its memory from one program to the next.
#[derive(Default)]
pub struct Compiler {
    masm: Option<MacroAssembler>,
    code: Option<Code>,
    memory: generator::Memory,
}

impl Compiler {
    /// The tables have to live for as long as the code can run.
    pub fn compile(
        &mut self,
        program: Verified<'_>,
        options: &Options,
    ) -> Result<(&Code, Tables), CodeTooLarge> {
        let for_assembler = || bun_engine_asm::Options {
            features: options.features,
            shorten_jumps: true,
            seed: options.seed,
        };
        let masm = (self.masm).get_or_insert_with(|| MacroAssembler::new(for_assembler()));
        masm.restart(for_assembler(), self.code.take());
        let tables = generator::generate(&program, options, masm, &mut self.memory)?;
        Ok((self.code.insert(masm.take_code()?), tables))
    }

    /// Frees what a large program has left.
    pub fn trim(&mut self) {
        const OPS_KEPT: usize = 512;
        if self.memory.capacity() > OPS_KEPT {
            *self = Compiler::default();
        }
    }
}
