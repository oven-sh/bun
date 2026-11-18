//! Compiles a function, and some that it calls, through the optimizing back end.

mod allocation;
mod calls;
mod casts;
mod control;
mod emit;
mod escape;
mod exceptions;
mod feedback;
mod heaps;
mod inlining;
mod locals;
mod loop_entry;
mod map;
mod memory;
mod numeric;
mod rarity;
mod references;
mod translator;
mod variables;
mod vector;

use bun_engine_asm::{MacroAssembler, MacroAssembly, Options as AssemblerOptions, RegisterSet};
pub use bun_engine_codegen::TooComplex;
use bun_engine_codegen::ir::Function;
pub use bun_engine_codegen::passes::Level;
use bun_engine_codegen::{Compiler as BackEnd, Options};
use bun_engine_wasm_format::CodeIndex;

use self::emit::Emitter;
pub use self::feedback::{CallFeedback, Feedback, InliningBudget};
use self::translator::{Buffers, Translator};
use crate::output::{CompiledFunction, Environment};

const MAX_BODY_SIZE: u32 = 100_000;

/// Memory that the compilation of one function leaves to the next.
pub struct Compiler {
    function: Function,
    buffers: Buffers,
    tables: emit::Tables,
    back_end: BackEnd,
}

impl Default for Compiler {
    fn default() -> Self {
        Self {
            function: Function::new(RegisterSet::EMPTY),
            buffers: Buffers::default(),
            tables: emit::Tables::default(),
            back_end: BackEnd::default(),
        }
    }
}

impl Compiler {
    /// The first half of [`Self::compile`].
    pub fn translate(
        &mut self,
        env: &Environment<'_>,
        code: CodeIndex,
        loop_entry: Option<u32>,
        feedback: &dyn Feedback,
    ) -> Result<&Function, TooComplex> {
        if env.module.body_span(code).len > MAX_BODY_SIZE {
            return Err(TooComplex);
        }
        let (function, buffers) = (&mut self.function, core::mem::take(&mut self.buffers));
        let mut translator = Translator::new(env, code, loop_entry, feedback, function, buffers);
        let translated = translator.translate();
        self.buffers = translator.into_buffers();
        translated.map_err(|_| TooComplex)?;
        Ok(&self.function)
    }

    /// With `loop_entry` the code is entered at the start of that loop and takes over a [`crate::baseline::Frame`].
    pub fn compile(
        &mut self,
        env: &Environment<'_>,
        code: CodeIndex,
        loop_entry: Option<u32>,
        level: Level,
        feedback: &dyn Feedback,
    ) -> Result<CompiledFunction, TooComplex> {
        self.translate(env, code, loop_entry, feedback)?;
        self.buffers.sites.finish();
        let mut masm = MacroAssembler::new(AssemblerOptions {
            features: env.features,
            shorten_jumps: true,
            seed: env.seed,
        });
        let (sites, tables) = (&self.buffers.sites, &mut self.tables);
        let mut emitter = Emitter::new(env, code, loop_entry.is_some(), sites, tables, &mut masm);
        let options = Options {
            level,
            records_origins: sites.has_inline_frames(),
        };
        let function = &mut self.function;
        let compiled = (self.back_end).compile(function, options, &mut masm, &mut emitter)?;
        Ok(emitter.finish(masm.finish().map_err(|_| TooComplex)?, &compiled))
    }
}
