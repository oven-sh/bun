//! What is where while a call is set up.

use bun_engine_asm::{Address, Gpr, abi};
use bun_engine_vm::CallFrame;

pub(crate) const FP: Gpr = abi::FRAME_POINTER;
pub(crate) const SP: Gpr = abi::STACK_POINTER;
pub(crate) const VM: Gpr = abi::VM;

pub(crate) const CALLEE: Gpr = abi::TEMPORARY_GPRS[0];
pub(crate) const ENTRY: Gpr = abi::TEMPORARY_GPRS[4];
#[cfg(target_arch = "x86_64")]
pub(crate) const EXECUTABLE: Gpr = abi::TEMPORARY_GPRS[3];
#[cfg(target_arch = "aarch64")]
pub(crate) const EXECUTABLE: Gpr = abi::NON_ARGUMENT_GPRS[0];
/// Neither the entry nor the executable.
pub(crate) const TEMPORARIES: [Gpr; 4] = [
    abi::TEMPORARY_GPRS[0],
    abi::TEMPORARY_GPRS[1],
    abi::TEMPORARY_GPRS[2],
    abi::TEMPORARY_GPRS[6],
];

/// For calls with lists.
pub(crate) const FORM: Gpr = abi::ARGUMENT_GPRS[3];
pub(crate) const CONTINUATION: Gpr = abi::SAVED_GPRS[1];

pub(crate) const fn at(base: Gpr, offset: usize) -> Address {
    Address::new(base, offset as i32)
}

/// From the stack pointer to a field of the frame that a call makes.
pub(crate) const fn in_new_frame(offset: usize) -> i32 {
    offset as i32 - CallFrame::LINKAGE_SIZE as i32
}

pub(crate) const fn new_frame(offset: usize) -> Address {
    Address::new(SP, in_new_frame(offset))
}
