//! Turns faults of compiled code into traps. The handler takes no lock and allocates nothing.

#[cfg_attr(unix, path = "unix.rs")]
#[cfg_attr(windows, path = "windows.rs")]
mod system;

use core::ptr;
use std::sync::LazyLock;

use bun_engine_wasm_compiler::abi::{Trap, callee_word, frame};

use crate::code::InstalledCode;
use crate::outcome::Failure;

/// No system maps anything below.
const LOWEST_ADDRESS: usize = 4096;
/// Leaves room for the value of null and the widest access.
pub(crate) const NULL_GUARD_SIZE: u32 = LOWEST_ADDRESS as u32 - 64;

pub(crate) fn install_handler() -> bool {
    static IS_INSTALLED: LazyLock<bool> = LazyLock::new(system::install_handler);
    *IS_INSTALLED
}

/// The registers of the thread that faulted.
struct Registers<'a> {
    pc: &'a mut usize,
    fp: usize,
    second_argument: &'a mut usize,
    third_argument: &'a mut usize,
}

/// Gives `false` and changes nothing if the fault is not for us.
///
/// # Safety
/// An instruction of this thread faulted when it accessed `address`.
unsafe fn redirect(address: usize, registers: &mut Registers<'_>) -> bool {
    // SAFETY: the thread is running it.
    let Some(code) = (unsafe { InstalledCode::running_at(*registers.pc) }) else {
        return false;
    };
    let engine = code.engine();
    if !engine.options().handle_faults {
        return false;
    }
    let callee = ptr::with_exposed_provenance::<u64>(registers.fp + frame::CALLEE as usize);
    // SAFETY: generated code always has a frame there, which is the caller's if the stack ends at the entry.
    if unsafe { callee.read() } != callee_word(code.func()).into() {
        return false;
    }
    // SAFETY: it is that of a function.
    let instance = unsafe { engine.instance_of_frame(registers.fp) };
    let trap = if address < LOWEST_ADDRESS {
        Trap::NullReference
    } else if instance.memories().any(|memory| memory.faults_at(address)) {
        Trap::MemoryOutOfBounds
    } else {
        return false;
    };
    *registers.second_argument = Failure::trap(trap).word();
    *registers.third_argument = *registers.pc + 1;
    *registers.pc = engine.stubs().trap;
    true
}
