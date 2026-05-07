#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// B-2: un-gated. Phase-A draft bindings now compile directly.
pub mod bindings;
pub use bindings::{Archive, ArchiveEntry, ArchiveResult};
#[repr(C)] pub struct Opaque { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
