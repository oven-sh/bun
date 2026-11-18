use core::ffi::c_void;
use core::ptr;

use bun_sys::windows::kernel32::AddVectoredExceptionHandler;
use bun_sys::windows::{
    CONTEXT, EXCEPTION_ACCESS_VIOLATION, EXCEPTION_CONTINUE_EXECUTION, EXCEPTION_CONTINUE_SEARCH,
    EXCEPTION_RECORD,
};

use super::{Registers, redirect};

#[repr(C)]
struct Exception {
    record: *const EXCEPTION_RECORD,
    context: *mut CONTEXT,
}

pub(super) fn install_handler() -> bool {
    const FIRST: u32 = 1;
    // SAFETY: the handler stays.
    !unsafe { AddVectoredExceptionHandler(FIRST, handle) }.is_null()
}

/// # Safety
/// For the system.
unsafe extern "system" fn handle(exception: *mut c_void) -> i32 {
    // SAFETY: the system gave us these.
    let is_handled = unsafe {
        let exception = &*exception.cast::<Exception>();
        let record = &*exception.record;
        record.ExceptionCode == EXCEPTION_ACCESS_VIOLATION
            && redirect(
                record.ExceptionInformation[1],
                &mut registers(&mut *exception.context),
            )
    };
    match is_handled {
        true => EXCEPTION_CONTINUE_EXECUTION,
        false => EXCEPTION_CONTINUE_SEARCH,
    }
}

fn word(register: &mut u64) -> &mut usize {
    // SAFETY: an integer of the same size and alignment.
    unsafe { &mut *ptr::from_mut(register).cast() }
}

#[cfg(target_arch = "x86_64")]
fn registers(context: &mut CONTEXT) -> Registers<'_> {
    Registers {
        pc: word(&mut context.Rip),
        fp: context.Rbp as usize,
        second_argument: word(&mut context.Rsi),
        third_argument: word(&mut context.Rdx),
    }
}

#[cfg(target_arch = "aarch64")]
fn registers(context: &mut CONTEXT) -> Registers<'_> {
    let [_, second, third, ..] = &mut context.X;
    Registers {
        pc: word(&mut context.Pc),
        fp: context.Fp as usize,
        second_argument: word(second),
        third_argument: word(third),
    }
}
