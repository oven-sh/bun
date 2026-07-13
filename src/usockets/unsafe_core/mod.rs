//! THE ONLY MODULE ALLOWED `unsafe` (docs/design.md §Strategy 5). Contents: chunked
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
#[cfg(all(test, not(miri), any(target_os = "linux", target_os = "android")))]
pub mod test_support;
pub mod trampolines;
