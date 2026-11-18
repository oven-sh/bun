//! The machine code of a module.

mod feedback;
mod group;
mod installed;
mod loops;
mod retired;
mod tiering;

use bun_engine_wasm_compiler::optimize::{self, Feedback, Level};
use bun_engine_wasm_compiler::{CompiledFunction, Environment, baseline};
use bun_engine_wasm_format::CodeIndex;

pub(crate) use self::feedback::{Callees, note_second_callee};
pub(crate) use self::group::{CodeGroup, compile_lazily};
pub(crate) use self::installed::InstalledCode;
pub use self::installed::Kind as CodeKind;
pub(crate) use self::retired::RetiredCode;
pub(crate) use self::tiering::{tier_up_at_entry, tier_up_in_loop};

/// Memory that one compilation leaves to the next.
#[derive(Default)]
pub struct Compilers {
    pub baseline: baseline::Compiler,
    pub optimizing: optimize::Compiler,
}

/// Makes code that never asks for better code, to be entered at the start or at a loop. `None` is for good.
pub type Optimizer = fn(
    &mut Compilers,
    &Environment<'_>,
    CodeIndex,
    Option<u32>,
    &dyn Feedback,
) -> Option<CompiledFunction>;

pub fn optimize_fully(
    compilers: &mut Compilers,
    env: &Environment<'_>,
    code: CodeIndex,
    loop_entry: Option<u32>,
    feedback: &dyn Feedback,
) -> Option<CompiledFunction> {
    let optimizing = &mut compilers.optimizing;
    optimizing
        .compile(env, code, loop_entry, Level::Full, feedback)
        .ok()
}

/// What a thread needs of its stack to compile.
const STACK_FOR_COMPILERS: usize = if cfg!(bun_asan) { 192 << 10 } else { 64 << 10 };
