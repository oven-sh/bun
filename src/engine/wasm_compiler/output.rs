//! What goes into a compiler and what comes out.

use bun_engine_asm::{Code, Features};
use bun_engine_wasm_format::{CodeIndex, FuncIndex, Module, TagIndex};

use crate::abi::{HostLayout, InstanceLayout, MemoryMode, Stubs};

pub struct Environment<'a> {
    pub module: &'a Module,
    pub layout: &'a InstanceLayout,
    pub host: &'a HostLayout,
    pub stubs: &'a Stubs,
    pub features: Features,
    pub mode: MemoryMode,
    /// The address of the `FunctionSlot` of the first function in the code section.
    pub slots: usize,
    pub seed: u64,
}

/// Where baseline code counts.
#[derive(Clone, Copy, Debug)]
pub struct Counters {
    /// The address of a `CallProfile` for each call of the function.
    pub call_profiles: usize,
    /// The address of an `AtomicI32` for each loop of the function. A turn adds one.
    pub loop_countdowns: usize,
    /// What an entry adds to the countdown of the slot.
    pub entry_increment: i32,
}

/// A place in the code at which the stack can be walked.
#[derive(Clone, Copy, Debug)]
pub struct CallSite {
    pub return_offset: u32,
    /// A position in `clauses`, or `u32::MAX`.
    pub first_clause: u32,
    /// Where to resume with an exception that one of them catches.
    pub handler_offset: u32,
    /// A position in `inline_frames`, or `u32::MAX` for the function itself.
    pub inline_frame: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct Clause {
    /// `None` catches all.
    pub tag: Option<TagIndex>,
    /// A position in `clauses`, or `u32::MAX`.
    pub next: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct InlineFrame {
    pub func: FuncIndex,
    /// A position in `inline_frames`, `u32::MAX` for the function itself, or [`Self::NO_CALLER`].
    pub caller: u32,
}

impl InlineFrame {
    /// A tail call has put it in the place of the function itself.
    pub const NO_CALLER: u32 = u32::MAX - 1;
}

/// A patchable call or jump that goes through the slot of the callee until it is pointed at the code.
#[derive(Clone, Copy, Debug)]
pub struct DirectCall {
    pub end_offset: u32,
    pub callee: CodeIndex,
}

pub struct CompiledFunction {
    pub code: Code,
    pub entry_offset: u32,
    /// From the stack pointer up to the frame pointer.
    pub frame_size: u32,
    /// Ascending. A return address that is not listed has no handler and is in the function itself.
    pub call_sites: Vec<CallSite>,
    pub clauses: Vec<Clause>,
    pub inline_frames: Vec<InlineFrame>,
    /// Ascending. From each offset up to the next, the code belongs to the frame, for faults.
    pub inline_ranges: Vec<(u32, u32)>,
    pub direct_calls: Vec<DirectCall>,
}
