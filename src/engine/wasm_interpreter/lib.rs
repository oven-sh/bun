//! Runs WebAssembly where no machine code is generated.
//!
//! A function is translated when it is first called. Locals and operands get slots in a frame, and instructions name
//! the slots that they read and write. See `code` for the form, and `machine` for how it runs.

#![forbid(unsafe_code)]
#![feature(adt_const_params, explicit_tail_calls, rust_preserve_none_cc)]
#![allow(incomplete_features, improper_ctypes_definitions)]

mod code;
mod entry;
mod handlers;
mod machine;
mod run;
mod translate;

pub use entry::{call, catches, resume};
