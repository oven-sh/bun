#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// B-1: gate Phase-A draft module; expose opaque FFI handles only. Body preserved for B-2.
#[cfg(any())] pub mod tcc;
#[repr(C)] pub struct Opaque { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
