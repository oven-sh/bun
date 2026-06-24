//! Source-faithful layout witness for EXP-054.
//!
//! `build.rs` compiles Bun's real `src/runtime/napi/node_api.h` and checks the
//! C-side LP64 layout. This file mirrors the five Rust `#[repr(C)]` definitions
//! from `src/runtime/napi/napi_body.rs` and verifies their size/alignment/offsets
//! match the same constants. Passing means EXP-054 has no current layout-drift
//! evidence on x86_64 Linux; the remaining action is CI hardening.

#![allow(non_camel_case_types)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem;

type napi_env = *mut c_void;
type napi_value = *mut c_void;
type napi_callback_info = *mut c_void;
type napi_status = c_uint;
type napi_property_attributes = c_uint;
type napi_callback = Option<extern "C" fn(napi_env, napi_callback_info) -> napi_value>;
type napi_addon_register_func = extern "C" fn(napi_env, napi_value) -> napi_value;

#[repr(C)]
pub struct napi_property_descriptor {
    pub utf8name: *const c_char,
    pub name: napi_value,
    pub method: napi_callback,
    pub getter: napi_callback,
    pub setter: napi_callback,
    pub value: napi_value,
    pub attributes: napi_property_attributes,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct napi_extended_error_info {
    pub error_message: *const c_char,
    pub engine_reserved: *mut c_void,
    pub engine_error_code: u32,
    pub error_code: napi_status,
}

#[repr(C)]
pub struct napi_type_tag {
    lower: u64,
    upper: u64,
}

#[repr(C)]
pub struct napi_node_version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub release: *const c_char,
}

#[repr(C)]
pub struct struct_napi_module {
    pub nm_version: c_int,
    pub nm_flags: c_uint,
    pub nm_filename: *const c_char,
    pub nm_register_func: napi_addon_register_func,
    pub nm_modname: *const c_char,
    pub nm_priv: *mut c_void,
    pub reserved: [*mut c_void; 4],
}

macro_rules! assert_size {
    ($t:ty, $n:expr) => {
        const _: () = assert!(mem::size_of::<$t>() == $n);
    };
}

macro_rules! assert_align {
    ($t:ty, $n:expr) => {
        const _: () = assert!(mem::align_of::<$t>() == $n);
    };
}

macro_rules! assert_offset {
    ($t:ty, $field:ident, $n:expr) => {
        const _: () = assert!(mem::offset_of!($t, $field) == $n);
    };
}

assert_size!(napi_property_descriptor, 64);
assert_align!(napi_property_descriptor, 8);
assert_offset!(napi_property_descriptor, utf8name, 0);
assert_offset!(napi_property_descriptor, name, 8);
assert_offset!(napi_property_descriptor, method, 16);
assert_offset!(napi_property_descriptor, getter, 24);
assert_offset!(napi_property_descriptor, setter, 32);
assert_offset!(napi_property_descriptor, value, 40);
assert_offset!(napi_property_descriptor, attributes, 48);
assert_offset!(napi_property_descriptor, data, 56);

assert_size!(napi_extended_error_info, 24);
assert_align!(napi_extended_error_info, 8);
assert_offset!(napi_extended_error_info, error_message, 0);
assert_offset!(napi_extended_error_info, engine_reserved, 8);
assert_offset!(napi_extended_error_info, engine_error_code, 16);
assert_offset!(napi_extended_error_info, error_code, 20);

assert_size!(napi_type_tag, 16);
assert_align!(napi_type_tag, 8);
assert_offset!(napi_type_tag, lower, 0);
assert_offset!(napi_type_tag, upper, 8);

assert_size!(napi_node_version, 24);
assert_align!(napi_node_version, 8);
assert_offset!(napi_node_version, major, 0);
assert_offset!(napi_node_version, minor, 4);
assert_offset!(napi_node_version, patch, 8);
assert_offset!(napi_node_version, release, 16);

assert_size!(struct_napi_module, 72);
assert_align!(struct_napi_module, 8);
assert_offset!(struct_napi_module, nm_version, 0);
assert_offset!(struct_napi_module, nm_flags, 4);
assert_offset!(struct_napi_module, nm_filename, 8);
assert_offset!(struct_napi_module, nm_register_func, 16);
assert_offset!(struct_napi_module, nm_modname, 24);
assert_offset!(struct_napi_module, nm_priv, 32);
assert_offset!(struct_napi_module, reserved, 40);

fn main() {
    println!("EXP-054 Rust mirror layout matched Bun's C N-API header layout on LP64");
}
