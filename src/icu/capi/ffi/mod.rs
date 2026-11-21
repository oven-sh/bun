//! Conversion of C's pointers to Rust's references. All `unsafe` code of `capi` is here. README.md lists the types.

mod dest;
mod export;
#[cfg(any(windows, debug_assertions, bun_debug, bun_asan))]
mod link_only;
mod pointers;
pub(crate) mod raw;
mod source;
mod status;

pub(crate) use crate::common::slice_ext::to_int32;
pub(crate) use crate::sys::ptr::c_bytes;
pub(crate) use export::*;
pub(crate) use pointers::*;
pub(crate) use source::*;
pub(crate) use status::*;

pub(crate) type UChar = u16;
pub(crate) type UChar32 = i32;
pub(crate) type UBool = i8;
