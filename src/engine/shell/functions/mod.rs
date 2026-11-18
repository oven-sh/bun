//! What scripts find in the global object besides the standard library.

mod agent;
mod buffer_accessors;
mod bytecode;
mod coverage;
mod dollar;
mod dollar_vm;
mod ffi;
mod heap;
mod heap_profiler;
mod io;
mod sampling;
mod scripts;
mod tasks;
mod test_objects;
mod tiers;
mod values;
mod wasm;

use bun_engine_vm::{Intrinsic, JsFunction};

pub(crate) use agent::Inbox;
pub(crate) use bytecode::use_disk_cache;
pub(crate) use heap::footprint;
pub(crate) use tasks::drain_microtasks;

use crate::global::define_hidden;
use crate::prelude::*;

/// The name, the code and the `length` of each.
pub(crate) type Functions = &'static [(&'static str, NativeFunction, u32)];

fn define_functions(cx: &Cx, object: &JsObject, functions: Functions, attributes: Attributes) {
    for &(name, function, length) in functions {
        let name = Identifier::from_literal(name);
        let intrinsic = Intrinsic::None;
        object.put_direct_native_function(cx, name.name(), length, function, intrinsic, attributes);
    }
}

fn object_with(cx: &Cx, functions: Functions, attributes: Attributes) -> Gc<JsObject> {
    let object = cx.new_object();
    define_functions(cx, &object, functions, attributes);
    object
}

fn put(cx: &Cx, object: &JsObject, name: &'static str, value: Value) {
    let name = Identifier::from_literal(name);
    object.put_direct(cx, name.name(), value, Attributes::NONE);
}

pub(crate) fn define_globals(cx: &Cx) {
    for functions in [
        agent::GLOBAL_FUNCTIONS,
        bytecode::FUNCTIONS,
        heap::FUNCTIONS,
        heap_profiler::FUNCTIONS,
        io::FUNCTIONS,
        sampling::FUNCTIONS,
        scripts::FUNCTIONS,
        tasks::FUNCTIONS,
        tiers::FUNCTIONS,
        values::FUNCTIONS,
        wasm::FUNCTIONS,
    ] {
        for &(name, function, length) in functions {
            let text = StringRef::from_literal(name);
            define_hidden(
                cx,
                name,
                JsFunction::native(cx, length, &text, function).into(),
            );
        }
    }
    let (loop_count, wasm_loop_count) = tiers::loop_counts();
    define_hidden(cx, "testLoopCount", loop_count.into());
    define_hidden(cx, "wasmTestLoopCount", wasm_loop_count.into());
    define_hidden(cx, "console", Value::UNDEFINED);
    let dollar = dollar::create(cx).into();
    define_hidden(cx, "$", dollar);
    define_hidden(cx, "$262", dollar);
    if State::of(cx).command_line().exposes_vm {
        define_hidden(cx, "$vm", dollar_vm::create(cx).into());
    }
    let performance = object_with(cx, tasks::PERFORMANCE, Attributes::DONT_ENUM);
    define_hidden(cx, "performance", performance.into());
}

pub(crate) fn to_utf8(cx: &mut Cx, value: Value) -> JsResult<Vec<u8>> {
    let bytes = value.to_string_view(cx)?.text().try_to_utf8();
    cx.or_out_of_memory(bytes)
}

fn to_text(cx: &mut Cx, value: Value) -> JsResult<String> {
    Ok(value.to_string_view(cx)?.text().to_string())
}

/// With quotes around a string and brackets around an array.
pub(crate) fn to_console_text(cx: &mut Cx, value: Value) -> JsResult<Vec<u8>> {
    let text = to_utf8(cx, value)?;
    let (open, close): (&[u8], &[u8]) = if value.is_string() {
        (b"\"", b"\"")
    } else if value.is::<bun_engine_vm::JsArray>() {
        (b"[", b"]")
    } else if value.is_bigint() {
        (b"", b"n")
    } else {
        (b"", b"")
    };
    Ok([open, &text, close].concat())
}

fn string(cx: &Cx, text: &str) -> Value {
    JsString::new(cx, StringRef::from_str(text)).into()
}

#[native_abi]
fn return_undefined(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn return_false(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::FALSE)
}

#[native_abi]
fn return_zero(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::ZERO)
}
