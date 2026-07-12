//! THE ONLY MODULE ALLOWED `unsafe` (api.md §Strategy 5). Contents: chunked
//! slab + generations, kind-checked ext downcast, extern "C" trampolines,
//! syscall/FFI edges. Everything here is small, audited, and Miri-testable.

#[allow(non_camel_case_types, non_snake_case)]
pub mod bssl;
pub mod deref;
pub mod ext;
pub mod ffi;
pub mod io;
pub mod poll_access;
pub mod slab;
pub mod trampolines;
