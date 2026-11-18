//! What the registers are for.

use super::registers::*;
use crate::register::{Bank, Fpr, Gpr, RegisterSet};

pub const FRAME_POINTER: Gpr = FP;
pub const STACK_POINTER: Gpr = SP;
pub const VM: Gpr = X21;
pub const NUMBER_TAG: Gpr = X22;
pub const NOT_CELL_MASK: Gpr = X23;

pub const ARGUMENT_GPRS: [Gpr; 8] = [X0, X1, X2, X3, X4, X5, X6, X7];
pub const ARGUMENT_FPRS: [Fpr; 8] = [V0, V1, V2, V3, V4, V5, V6, V7];
pub const RETURN_GPRS: [Gpr; 2] = [X0, X1];
pub const RETURN_FPR: Fpr = V0;

/// Free for generated code, the first of them where a result is returned. A C function overwrites them.
pub const TEMPORARY_GPRS: [Gpr; 16] = [
    X0, X1, X2, X3, X4, X5, X6, X7, X8, X9, X10, X11, X12, X13, X14, X15,
];
/// Free for generated code. A C function keeps them.
pub const SAVED_GPRS: [Gpr; 7] = [X19, X20, X24, X25, X26, X27, X28];
/// Overwritten by a C function, and carry none of its arguments.
pub const NON_ARGUMENT_GPRS: [Gpr; 2] = [X9, X10];

/// A jump or call that leaves the code may overwrite the first.
pub const SCRATCH_GPRS: [Gpr; 2] = [X16, X17];
pub const SCRATCH_FPRS: [Fpr; 2] = [V31, V30];

/// Without x18, which belongs to the operating system on macOS, Windows and Android.
pub const ALL: RegisterSet = RegisterSet::range(Bank::Gpr, 0, 31)
    .union(RegisterSet::range(Bank::Fpr, 0, 31))
    .difference(RegisterSet::of(&[X18], &[]));
pub const PINNED: RegisterSet = RegisterSet::of(&[VM, NUMBER_TAG, NOT_CELL_MASK], &[]);
/// What a C function keeps, besides the stack and frame pointers.
pub const CALLEE_SAVED: RegisterSet =
    RegisterSet::range(Bank::Gpr, 19, 28).union(CALLEE_SAVED_LOW_HALF);
/// Those of [`CALLEE_SAVED`] of which a C function keeps the low 64 bits only.
pub const CALLEE_SAVED_LOW_HALF: RegisterSet = RegisterSet::range(Bank::Fpr, 8, 15);
pub const CALLER_SAVED: RegisterSet = ALL
    .difference(CALLEE_SAVED)
    .difference(RegisterSet::of(&[SP, FP], &[]));
