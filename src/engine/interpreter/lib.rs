//! The bytecode interpreter.

#![feature(explicit_tail_calls, naked_functions_rustic_abi, rust_preserve_none_cc)]
#![allow(incomplete_features, improper_ctypes_definitions)]

mod fast;
mod machine;
mod slow;
#[cfg_attr(target_arch = "aarch64", path = "stubs_aarch64.rs")]
#[cfg_attr(target_arch = "x86_64", path = "stubs_x86_64.rs")]
mod stubs;
mod table;

pub use slow::calls::{
    FillVarargsFrame, PrepareFixedCall, PreparedCall, SizeVarargsFrame, replace_frame,
};
pub use slow::{Outcome, SlowPath, outcome};
pub use table::{
    OPERATIONS, SLOW_PATHS, fixed_call_preparation, return_point, varargs_call_preparation,
};

use machine::Handler;

/// For an `Executable`.
pub fn entry() -> usize {
    stubs::entry as Handler as usize
}

/// Where an exception is caught.
pub fn catch_entry() -> usize {
    stubs::catch_entry as Handler as usize
}

/// To jump to with the frame pointer and the `Vm` in their registers. Runs the instruction at the call site.
pub fn resume_entry() -> usize {
    stubs::resume_at_call_site as Handler as usize
}
