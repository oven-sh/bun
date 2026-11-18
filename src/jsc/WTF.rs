use core::cell::Cell;
use core::ffi::{c_int, c_void};

use bun_engine_platform::{StackBounds, machine};

/// ECMA-262 §21.4.1.1 Time Value range bound (±8.64e15 ms).
pub const MAX_ECMASCRIPT_TIME: f64 = 8.64e15;

pub use crate::string_builder::StringBuilder;

// `bun_core` is below the crate that asks the system, and declares these.

#[thread_local]
static STACK_END: Cell<usize> = Cell::new(0);

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {
    // A thread's bounds are fixed. On Windows they are the reserved range, and the stack grows inside it.
    if STACK_END.get() == 0 {
        STACK_END.set(StackBounds::current().end);
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    core::ptr::without_provenance_mut(STACK_END.get())
}

#[unsafe(no_mangle)]
extern "C" fn WTF__numberOfProcessorCores() -> c_int {
    machine::processor_count() as c_int
}
