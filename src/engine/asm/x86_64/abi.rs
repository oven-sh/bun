//! What the registers are for.

use super::registers::*;
use crate::register::{Bank, Fpr, Gpr, RegisterSet};

pub const FRAME_POINTER: Gpr = RBP;
pub const STACK_POINTER: Gpr = RSP;
pub const VM: Gpr = R13;
pub const NUMBER_TAG: Gpr = R14;
pub const NOT_CELL_MASK: Gpr = R15;

pub const ARGUMENT_GPRS: [Gpr; 6] = [RDI, RSI, RDX, RCX, R8, R9];
pub const ARGUMENT_FPRS: [Fpr; 8] = [XMM0, XMM1, XMM2, XMM3, XMM4, XMM5, XMM6, XMM7];
pub const RETURN_GPRS: [Gpr; 2] = [RAX, RDX];
pub const RETURN_FPR: Fpr = XMM0;

/// Free for generated code, the first of them where a result is returned. A C function overwrites them.
pub const TEMPORARY_GPRS: [Gpr; 8] = [RAX, RSI, RDX, RCX, R8, R10, RDI, R9];
/// Free for generated code. A C function keeps them.
pub const SAVED_GPRS: [Gpr; 2] = [RBX, R12];
/// Overwritten by a C function, and carry none of its arguments.
pub const NON_ARGUMENT_GPRS: [Gpr; 2] = [RAX, R10];

pub const SCRATCH_GPR: Gpr = R11;
pub const SCRATCH_FPRS: [Fpr; 2] = [XMM15, XMM14];

pub const ALL: RegisterSet =
    RegisterSet::range(Bank::Gpr, 0, 15).union(RegisterSet::range(Bank::Fpr, 0, 15));
pub const PINNED: RegisterSet = RegisterSet::of(&[VM, NUMBER_TAG, NOT_CELL_MASK], &[]);
/// What a C function keeps, besides the stack and frame pointers.
pub const CALLEE_SAVED: RegisterSet = RegisterSet::of(&[RBX, R12, R13, R14, R15], &[]);
/// Those of [`CALLEE_SAVED`] of which a C function keeps the low 64 bits only.
pub const CALLEE_SAVED_LOW_HALF: RegisterSet = RegisterSet::EMPTY;
pub const CALLER_SAVED: RegisterSet = ALL
    .difference(CALLEE_SAVED)
    .difference(RegisterSet::of(&[RSP, RBP], &[]));
