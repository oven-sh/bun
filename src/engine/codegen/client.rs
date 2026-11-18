//! What the back end asks of the compiler that uses it while it emits code.

use bun_engine_asm::{Fpr, Gpr, Label, RegisterSet};

use crate::ir::{Function, Location, Origin, Slot, Table, Token};
use crate::machine::StateLocations;

/// The frame pointer and the stack pointer are multiples of 16.
pub struct Frame {
    /// From the stack pointer up to the frame pointer.
    pub size: u32,
    pub(crate) slot_offsets: Table<Slot, i32>,
}

impl Frame {
    /// From the frame pointer.
    pub fn offset_of(&self, slot: Slot) -> i32 {
        self.slot_offsets[slot]
    }
}

pub struct ExitSite<'a> {
    pub function: &'a Function,
    pub frame: &'a Frame,
    pub token: Token,
    pub origin: Origin,
    pub state: StateLocations<'a>,
}

pub struct PatchpointSite<'a> {
    pub function: &'a Function,
    pub frame: &'a Frame,
    pub token: Token,
    pub origin: Origin,
    pub results: &'a [Location],
    pub operands: &'a [Location],
    pub state: StateLocations<'a>,
    pub scratch_gprs: &'a [Gpr],
    pub scratch_fprs: &'a [Fpr],
    /// Hold values that are needed afterwards and that the patchpoint does not produce.
    pub live_registers: RegisterSet,
    /// Those of `live_registers` that hold 128 bits.
    pub live_vectors: RegisterSet,
    pub successors: &'a [Label],
    /// The successor whose code comes next, if any.
    pub falls_through_to: Option<usize>,
}

pub struct CallSite<'a> {
    pub function: &'a Function,
    pub frame: &'a Frame,
    pub token: Token,
    pub origin: Origin,
    pub return_address: Label,
    pub state: StateLocations<'a>,
    /// Where an unwinder resumes, once it has restored the frame pointer, the stack pointer and what is pinned.
    pub handlers: &'a [Label],
}

/// The scratch registers of the macro assembler are set to those that the code may overwrite: what is never
/// allocated, and the usual ones where a patchpoint clobbers them both early and late.
pub trait Client<Masm> {
    /// Enters the frame and moves the stack pointer down by its size. Keeps the parameters.
    fn prologue(&mut self, masm: &mut Masm, entry: usize, frame: &Frame);

    /// Code for all the exits with this token, which needs neither state nor origin.
    fn shared_exit(&mut self, masm: &mut Masm, token: Token) -> Option<Label>;

    /// For the other exits. Placed after the body of the function. Control does not fall out of it.
    fn exit(&mut self, masm: &mut Masm, site: &ExitSite<'_>);

    /// Follows the jump of a check. What it emits keeps the registers and may jump to `exit` too. Returns whether
    /// there is anything.
    fn after_check(&mut self, _masm: &mut Masm, _token: Token, _exit: Label) -> bool {
        false
    }

    fn patchpoint(&mut self, masm: &mut Masm, site: &PatchpointSite<'_>);

    /// Precedes the call instruction. What it emits keeps the operands.
    fn before_call(&mut self, _masm: &mut Masm, _token: Token, _origin: Origin) {}

    /// Follows the call instruction. What it emits keeps the results.
    fn after_call(&mut self, masm: &mut Masm, site: &CallSite<'_>);

    /// Follows all else that is emitted for a patchpoint that does not end its block. Nothing reads the registers.
    fn after_patchpoint(&mut self, _masm: &mut Masm, _dead: impl FnOnce() -> RegisterSet) {}

    /// For the code that patchpoints want out of the way.
    fn out_of_line(&mut self, masm: &mut Masm);
}
