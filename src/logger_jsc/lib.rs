//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

#![allow(unused, nonstandard_style)]

use bun_logger::{self as logger, Data, Level, Location, Log, Metadata, Msg};
use bun_string::ZigString;

// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_jsc::JSValue
// TODO(b2-blocked): bun_jsc::JsResult
// `bun_jsc` is currently red (concurrent B-2 un-gating). Local opaque stubs mirror
// bun_jsc's `stub_ty!` shape (`#[repr(transparent)] struct(usize)`, Copy+Default) so
// the swap to `use bun_jsc::{JSGlobalObject, JSValue, JsResult}` is mechanical once
// that crate is green. PORTING.md §JSC: `bun.JSError!T` → `bun_jsc::JsResult<T>`.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSGlobalObject(pub usize);
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSValue(pub usize);
pub type JsResult<T> = Result<T, JSValue>;
mod jsc {
    pub use super::{JSGlobalObject, JSValue};
}

pub fn msg_from_js(global_object: &JSGlobalObject, file: &[u8], err: JSValue) -> JsResult<Msg> {
    // TODO(b2-blocked): bun_jsc::zig_exception::Holder
    // TODO(b2-blocked): bun_jsc::JSValue::to_error
    // TODO(b2-blocked): bun_jsc::JSValue::to_zig_exception
    // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
    #[cfg(any())]
    {
        let mut zig_exception_holder = jsc::zig_exception::Holder::init();
        if let Some(value) = err.to_error() {
            value.to_zig_exception(global_object, zig_exception_holder.zig_exception());
        } else {
            zig_exception_holder.zig_exception().message = err.to_bun_string(global_object)?;
        }

        return Ok(Msg {
            data: Data {
                // TODO(port): lifetime — `Data.text`/`Location.file` are currently
                // `&'static [u8]` in bun_logger; Zig owned this via allocator.dupe.
                // Revisit once bun_logger retypes `Str` to owned (see logger TODO(port)).
                text: zig_exception_holder.zig_exception().message.to_owned_slice(),
                location: Some(Location { file, line: 0, column: 0, ..Default::default() }),
            },
            ..Default::default()
        });
    }
    let _ = (global_object, file, err);
    todo!("logger_jsc::msg_from_js — blocked on bun_jsc::zig_exception::Holder + JSValue methods")
}

pub fn msg_to_js(this: Msg, global_object: &JSGlobalObject) -> Result<JSValue, bun_alloc::AllocError> {
    // TODO(b2-blocked): bun_jsc::BuildMessage
    // TODO(b2-blocked): bun_jsc::ResolveMessage
    #[cfg(any())]
    {
        return match this.metadata {
            Metadata::Build => jsc::BuildMessage::create(global_object, this),
            Metadata::Resolve(_) => jsc::ResolveMessage::create(global_object, &this, b""),
        };
    }
    let _ = (this, global_object);
    todo!("logger_jsc::msg_to_js — blocked on bun_jsc::{{BuildMessage, ResolveMessage}}")
}

pub fn level_from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Option<Level>> {
    // TODO(b2-blocked): bun_jsc::JSValue::is_undefined
    // TODO(b2-blocked): bun_jsc::JSValue::is_string
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_invalid_arguments
    // TODO(b2-blocked): bun_jsc::comptime_string_map_jsc::from_js
    #[cfg(any())]
    {
        if value.is_empty() || value.is_undefined() {
            return Ok(None);
        }

        if !value.is_string() {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected logLevel to be a string")));
        }

        // Zig: `Log.Level.Map.fromJS` — ComptimeStringMap JSC-aware lookup.
        // Rust: `Level::MAP` is the `phf::Map`; the `.fromJS` helper lives in
        // `bun_jsc::comptime_string_map_jsc`.
        return jsc::comptime_string_map_jsc::from_js(&Level::MAP, global_this, value);
    }
    let _ = (global_this, value);
    todo!("logger_jsc::level_from_js — blocked on bun_jsc JSValue/JSGlobalObject methods")
}

pub fn log_to_js(this: &Log, global: &JSGlobalObject, message: &[u8]) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();
    // On-stack array: conservative GC stack scan keeps these JSValues alive (see PORTING.md §JSC).
    let mut errors_stack: [JSValue; 256] = [JSValue::default(); 256];

    let count = u16::try_from(msgs.len().min(errors_stack.len())).unwrap();
    // TODO(b2-blocked): bun_jsc::BuildMessage
    // TODO(b2-blocked): bun_jsc::ResolveMessage
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::create_aggregate_error
    #[cfg(any())]
    {
        return match count {
            0 => Ok(JSValue::UNDEFINED),
            1 => {
                let msg = msgs[0].clone()?;
                Ok(match msg.metadata {
                    Metadata::Build => jsc::BuildMessage::create(global, msg)?,
                    Metadata::Resolve(_) => jsc::ResolveMessage::create(global, &msg, b"")?,
                })
            }
            _ => {
                for (i, msg) in msgs[..usize::from(count)].iter().enumerate() {
                    errors_stack[i] = match msg.metadata {
                        Metadata::Build => jsc::BuildMessage::create(global, msg.clone()?)?,
                        Metadata::Resolve(_) => jsc::ResolveMessage::create(global, msg, b"")?,
                    };
                }
                let out = ZigString::init(message);
                let agg = global.create_aggregate_error(&errors_stack[..usize::from(count)], &out)?;
                Ok(agg)
            }
        };
    }
    let _ = (errors_stack, count, message, global);
    todo!("logger_jsc::log_to_js — blocked on bun_jsc::{{BuildMessage, ResolveMessage, JSGlobalObject::create_aggregate_error}}")
}

/// unlike `to_js`, this always produces an AggregateError object
pub fn log_to_js_aggregate_error(this: &Log, global: &JSGlobalObject, message: bun_string::String) -> JsResult<JSValue> {
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::create_aggregate_error_with_array
    #[cfg(any())]
    {
        return global.create_aggregate_error_with_array(message, log_to_js_array(this, global)?);
    }
    let _ = (this, global, message);
    todo!("logger_jsc::log_to_js_aggregate_error — blocked on bun_jsc::JSGlobalObject::create_aggregate_error_with_array")
}

pub fn log_to_js_array(this: &Log, global: &JSGlobalObject) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();

    // TODO(b2-blocked): bun_jsc::JSValue::create_empty_array
    // TODO(b2-blocked): bun_jsc::JSValue::put_index
    #[cfg(any())]
    {
        let arr = JSValue::create_empty_array(global, msgs.len())?;
        for (i, msg) in msgs.iter().enumerate() {
            arr.put_index(global, u32::try_from(i).unwrap(), msg_to_js(msg.clone()?, global)?)?;
        }
        return Ok(arr);
    }
    let _ = (msgs, global);
    todo!("logger_jsc::log_to_js_array — blocked on bun_jsc::JSValue::{{create_empty_array, put_index}}")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/logger_jsc/logger_jsc.zig (93 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) markers
//   notes:      B-2 un-gated. Signatures now use real bun_jsc::{JSGlobalObject,
//               JSValue} (currently opaque stub_ty! newtypes). Every fn body
//               re-gated on bun_jsc methods that the B-1 stub surface does not
//               yet export (JSValue methods, JSGlobalObject methods,
//               zig_exception::Holder, BuildMessage, ResolveMessage,
//               comptime_string_map_jsc). Metadata/Level/Log/Msg shapes
//               corrected against bun_logger.
// ──────────────────────────────────────────────────────────────────────────
