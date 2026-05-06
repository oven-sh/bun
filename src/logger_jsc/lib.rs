//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

#![allow(unused, nonstandard_style)]

use std::borrow::Cow;

use bun_logger::{self as logger, Data, Level, Location, Log, Metadata, Msg};
use bun_string::ZigString;

// B-2: `bun_jsc` is now green; the local Track-A shadow stubs are gone and we
// link against the real crate's stub surface. PORTING.md §JSC: `bun.JSError!T`
// → `bun_jsc::JsResult<T>`.
use bun_jsc::{
    self as jsc, comptime_string_map_jsc, BuildMessage, JSGlobalObject, JSValue, JsError, JsResult,
    ResolveMessage,
};

pub fn msg_from_js(global_object: &JSGlobalObject, file: &'static [u8], err: JSValue) -> JsResult<Msg> {
    let mut zig_exception_holder = jsc::zig_exception::Holder::init();

    if let Some(value) = err.to_error() {
        value.to_zig_exception(global_object, zig_exception_holder.zig_exception());
    } else {
        zig_exception_holder.zig_exception().message = err.to_bun_string(global_object)?;
    }

    Ok(Msg {
        data: Data {
            text: Cow::Owned(zig_exception_holder.zig_exception().message.to_owned_slice()),
            location: Some(Location { file, line: 0, column: 0, ..Default::default() }),
        },
        ..Default::default()
    })
}

pub fn msg_to_js(this: Msg, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    match this.metadata {
        Metadata::Build => BuildMessage::create(global_object, this),
        Metadata::Resolve(_) => ResolveMessage::create(global_object, this, bun_string::String::empty()),
    }
}

pub fn level_from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Option<Level>> {
    if value.is_empty() || value.is_undefined() {
        return Ok(None);
    }

    if !value.is_string() {
        return Err(global_this.throw_invalid_arguments(format_args!("Expected logLevel to be a string")));
    }

    // Zig: `Log.Level.Map.fromJS` — ComptimeStringMap JSC-aware lookup.
    // Rust: `Level::MAP` is the `phf::Map`; the `.fromJS` helper lives in
    // `bun_jsc::comptime_string_map_jsc`.
    comptime_string_map_jsc::from_js(&Level::MAP, global_this, value)
}

pub fn log_to_js(this: &Log, global: &JSGlobalObject, message: &[u8]) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();
    // On-stack array: conservative GC stack scan keeps these JSValues alive (see PORTING.md §JSC).
    let mut errors_stack: [JSValue; 256] = [JSValue::default(); 256];

    let count = u16::try_from(msgs.len().min(errors_stack.len())).unwrap();
    match count {
        0 => Ok(JSValue::UNDEFINED),
        1 => {
            let msg = msgs[0].clone()?;
            Ok(match msg.metadata {
                Metadata::Build => BuildMessage::create(global, msg)?,
                Metadata::Resolve(_) => {
                    ResolveMessage::create(global, msg, bun_string::String::empty())?
                }
            })
        }
        _ => {
            for (i, msg) in msgs[..usize::from(count)].iter().enumerate() {
                errors_stack[i] = match msg.metadata {
                    Metadata::Build => BuildMessage::create(global, msg.clone()?)?,
                    Metadata::Resolve(_) => {
                        ResolveMessage::create(global, msg.clone()?, bun_string::String::empty())?
                    }
                };
            }
            let out = ZigString::init(message);
            let agg = global.create_aggregate_error(&errors_stack[..usize::from(count)], &out)?;
            Ok(agg)
        }
    }
}

/// unlike `to_js`, this always produces an AggregateError object
pub fn log_to_js_aggregate_error(this: &Log, global: &JSGlobalObject, message: bun_string::String) -> JsResult<JSValue> {
    global.create_aggregate_error_with_array(message, log_to_js_array(this, global)?)
}

pub fn log_to_js_array(this: &Log, global: &JSGlobalObject) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();

    let arr = JSValue::create_empty_array(global, msgs.len())?;
    for (i, msg) in msgs.iter().enumerate() {
        arr.put_index(global, u32::try_from(i).unwrap(), msg_to_js(msg.clone()?, global)?)?;
    }
    Ok(arr)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/logger_jsc/logger_jsc.zig (93 lines)
//   confidence: medium
//   notes:      B-2 un-gated (6/6). Compiles against real `bun_jsc` —
//               `ZigException` now has its `#[repr(C)]` field surface
//               (`.message`), so `msg_from_js` is fully ported (both
//               branches). `Data.text` lifetime resolved via
//               `Cow<'static, [u8]>` + `to_owned_slice()`.
// ──────────────────────────────────────────────────────────────────────────
