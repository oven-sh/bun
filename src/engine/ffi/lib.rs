//! Calls between scripts and native code whose signature is known only at run time.
//!
//! Outside of registers a native value is a slot: 64 bits, to which an integer is extended as its sign says and of
//! which a float of 32 bits takes the low half.
//!
//! A compiler that knows its callee to be an [`FfiFunction`] can make the call itself. [`Signature::layout`] says where
//! the arguments go, [`value_to_slot`] and [`slot_to_value`] what is not worth doing in line. The frame has to be the
//! top call frame, and an exception may be pending afterwards.

#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]

mod callback;
mod convention;
mod convert;
mod function;
mod signature;
pub mod stubs;
mod threadsafe;
mod types;

use bun_engine_vm::{Cx, JsResult, RealmSlot, Thrown, options};

pub use callback::FfiCallback;
pub use convention::{Convention, Layout, Place};
pub use convert::{CStrings, slot_to_value, value_to_slot};
pub use function::FfiFunction;
pub use signature::Signature;
pub use threadsafe::{Dispatch, Invocation};
pub use types::{NativeType, Representation};

/// Whether the slot is one of this crate's.
pub fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let global = cx.global();
    match slot {
        RealmSlot::ffi_function_shape => {
            global.init_ffi_function_shape(FfiFunction::create_shape(cx));
        }
        RealmSlot::ffi_callback_shape => {
            global.init_ffi_callback_shape(FfiCallback::create_shape(cx));
        }
        RealmSlot::open_ffi_callbacks => {
            global.init_open_ffi_callbacks(callback::OpenCallbacks::create(cx));
        }
        _ => return false,
    }
    true
}

fn check_can_generate_code(cx: &Cx) -> JsResult<()> {
    if !options().use_jit {
        return Err(cx.throw_type_error("bun:ffi requires the JIT"));
    }
    Ok(())
}

#[cold]
fn throw_no_room_for_code(cx: &Cx) -> Thrown {
    cx.throw_out_of_memory_with(
        "Out of memory: bun:ffi failed to allocate executable memory for the invoke thunk",
    )
}
