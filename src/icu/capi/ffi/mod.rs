//! Conversion of C's pointers to Rust's references. All `unsafe` code of `capi` is here. README.md lists the types.

mod call;
mod dest;
mod export;
mod handles;
#[cfg(any(windows, debug_assertions, bun_debug, bun_asan))]
mod link_only;
mod pointers;
pub(crate) mod raw;
mod status;

pub(crate) use crate::common::slice_ext::to_int32;
pub(crate) use crate::sys::ptr::c_bytes;
pub(crate) use call::*;
pub(crate) use dest::*;
pub(crate) use export::*;
pub(crate) use handles::*;
pub(crate) use pointers::*;
pub(crate) use status::*;

pub(crate) type UChar = u16;
pub(crate) type UChar32 = i32;
pub(crate) type UBool = i8;
