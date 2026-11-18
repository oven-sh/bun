//! What baseline code keeps where.

use bun_engine_asm::{Fpr, Gpr, abi};

/// The entries of code blocks that have been replaced count on it.
pub const CODE_BLOCK: Gpr = abi::SAVED_GPRS[0];

pub(crate) const FP: Gpr = abi::FRAME_POINTER;
pub(crate) const SP: Gpr = abi::STACK_POINTER;
pub(crate) const VM: Gpr = abi::VM;
pub(crate) const NUMBER_TAG: Gpr = abi::NUMBER_TAG;

/// Results. May carry a value from one instruction to the next.
pub(crate) const T0: Gpr = abi::TEMPORARY_GPRS[0];
pub(crate) const T1: Gpr = abi::TEMPORARY_GPRS[1];
pub(crate) const T2: Gpr = abi::TEMPORARY_GPRS[2];
pub(crate) const T3: Gpr = abi::TEMPORARY_GPRS[3];
pub(crate) const T4: Gpr = abi::TEMPORARY_GPRS[4];
pub(crate) const T5: Gpr = abi::TEMPORARY_GPRS[5];
pub(crate) const T6: Gpr = abi::TEMPORARY_GPRS[6];
pub(crate) const T7: Gpr = abi::TEMPORARY_GPRS[7];

pub(crate) const F0: Fpr = abi::ARGUMENT_FPRS[0];
pub(crate) const F1: Fpr = abi::ARGUMENT_FPRS[1];
pub(crate) const F2: Fpr = abi::ARGUMENT_FPRS[2];

/// What an entry finds the executable in.
#[cfg(target_arch = "x86_64")]
pub(crate) const EXECUTABLE: Gpr = T3;
#[cfg(target_arch = "aarch64")]
pub(crate) const EXECUTABLE: Gpr = abi::NON_ARGUMENT_GPRS[0];

pub(crate) const ARGUMENTS: &[Gpr] = &abi::ARGUMENT_GPRS;
pub(crate) const SECOND_RESULT: Gpr = abi::RETURN_GPRS[1];
