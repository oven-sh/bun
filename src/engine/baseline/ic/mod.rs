//! The code that searches the cases of a site, and does what they say.
//!
//! An access has two steps, both called with the stack pointer aligned. The first calls nothing. If that does not
//! suffice, it returns zero in `RESULT`, having done nothing and kept the other registers of [`abi`]. The second comes
//! right after it, with the call site stored, and does not return if it throws. An accessor returns straight to its
//! caller, which restores the stack pointer. The second overwrites all registers that are not pinned.

#![forbid(unsafe_code)]

mod by_value;
mod calls;
mod elements;
mod entries;
mod handlers;
mod megamorphic;
mod search;

use bun_engine_asm::prelude::*;
use bun_engine_exec_memory::NativeFrames;

pub(crate) use elements::{Absent, Elements, has_element, load_element, store_element};
pub use entries::{Entries, Steps};
pub(crate) use handlers::{load_array_length, load_custom_function};
pub(crate) use search::load_first_answer;

pub mod abi {
    use bun_engine_asm::{Gpr, RegisterSet, abi};

    use crate::registers::*;

    pub const RESULT: Gpr = T0;
    pub const BASE: Gpr = T1;
    /// The address of a name that is part of the instruction, or else the value of the key.
    pub const KEY: Gpr = T2;
    /// What to store, or the receiver.
    pub const VALUE: Gpr = T6;
    /// The address of what both steps start from.
    pub const ENTRY: Gpr = T7;

    /// The address of a native function whose arguments are being put in place: in the second step, to begin with,
    /// the one of `ic::operations` that does what the case does not.
    pub(crate) const OPERATION: Gpr = abi::NON_ARGUMENT_GPRS[1];

    /// From the first step to the second: the case that applies, or zero.
    pub(super) const CASE: Gpr = T4;
    pub(super) const SHAPE: Gpr = T5;
    /// The address of the name that the key stands for.
    pub(super) const NAME: Gpr = T3;

    /// What the second step gets from the first.
    pub const HANDED_ON: [Gpr; 3] = [CASE, SHAPE, NAME];

    /// By the first step of an access that stores nothing. One that does overwrites what a C function may.
    pub const OVERWRITTEN_BY_LOOKUP: RegisterSet =
        RegisterSet::of(&[T0, T1, T2, T3, T4, T5, T6, T7], &[F0, F1])
            .union(RegisterSet::of(SCRATCH_GPRS, &abi::SCRATCH_FPRS));

    #[cfg(target_arch = "x86_64")]
    const SCRATCH_GPRS: &[Gpr] = &[abi::SCRATCH_GPR];
    #[cfg(target_arch = "aarch64")]
    const SCRATCH_GPRS: &[Gpr] = &abi::SCRATCH_GPRS;
}

struct Emitter<'a> {
    m: &'a mut MacroAssembler,
    frames: &'a mut NativeFrames,
    /// Returns from the first step without a case.
    miss: Label,
    /// Returns from it with the case.
    defer: Label,
    write_barrier: Label,
    names: Vec<(Label, &'static str)>,
}

impl Emitter<'_> {
    fn routine(&mut self, name: &'static str, emit: impl FnOnce(&mut Self)) -> Label {
        self.m.align(16, 15);
        let start = self.m.here();
        self.names.push((start, name));
        emit(self);
        start
    }

    fn labels<const N: usize>(&mut self) -> [Label; N] {
        core::array::from_fn(|_| self.m.new_label())
    }
}

pub fn entries() -> Option<&'static Entries<usize>> {
    crate::thunks::get().map(|thunks| &thunks.entries)
}
