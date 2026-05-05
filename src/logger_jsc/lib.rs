//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

#![allow(unused, nonstandard_style)]

use bun_logger::{self as logger, Data, Level, Location, Log, Metadata, Msg};
use bun_string::ZigString;

// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_jsc::JSValue
// TODO(b2-blocked): bun_jsc::JsResult
// TODO(b2-blocked): bun_jsc::JsError
// `bun_jsc` is currently red (transitive dep `bun_css` fails `cargo check`).
// Local shadow stubs mirror bun_jsc's B-2 Track-A surface so the bodies below
// type-check against real `bun_logger` types. Swap to
// `use bun_jsc::{JSGlobalObject, JSValue, JsResult, JsError, BuildMessage,
// ResolveMessage, comptime_string_map_jsc}` once `cargo check -p bun_jsc` is
// green; the swap is mechanical (signatures match bun_jsc's lib.rs verbatim).
// PORTING.md §JSC: `bun.JSError!T` → `bun_jsc::JsResult<T>`.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSGlobalObject(pub usize);
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSValue(pub usize);

/// `bun.JSError` — `error{Thrown, OutOfMemory, Terminated}`. Mirrors
/// `bun_jsc::JsError` exactly so `?`-propagation shape is final.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum JsError {
    Thrown,
    OutOfMemory,
    Terminated,
}
pub type JsResult<T> = Result<T, JsError>;
impl From<bun_alloc::AllocError> for JsError {
    fn from(_: bun_alloc::AllocError) -> Self { JsError::OutOfMemory }
}

impl JSValue {
    pub const UNDEFINED: JSValue = JSValue(0xa);
    #[inline] pub fn is_empty(self) -> bool { self.0 == 0 }
    #[inline] pub fn is_undefined(self) -> bool { self.0 == Self::UNDEFINED.0 }
    pub fn is_string(self) -> bool {
        // TODO(b2-blocked): bun_jsc::JSValue::is_string
        todo!("JSValue::is_string — blocked on bun_jsc")
    }
    pub fn create_empty_array(_global: &JSGlobalObject, _len: usize) -> JsResult<JSValue> {
        // TODO(b2-blocked): bun_jsc::JSValue::create_empty_array
        todo!("JSValue::create_empty_array — blocked on bun_jsc")
    }
    pub fn put_index(self, _global: &JSGlobalObject, _i: u32, _out: JSValue) -> JsResult<()> {
        // TODO(b2-blocked): bun_jsc::JSValue::put_index
        todo!("JSValue::put_index — blocked on bun_jsc")
    }
}

impl JSGlobalObject {
    pub fn throw_invalid_arguments(&self, _args: core::fmt::Arguments<'_>) -> JsError {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_invalid_arguments
        todo!("JSGlobalObject::throw_invalid_arguments — blocked on bun_jsc")
    }
    pub fn create_aggregate_error(
        &self,
        _errors: &[JSValue],
        _message: &ZigString,
    ) -> JsResult<JSValue> {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::create_aggregate_error
        todo!("JSGlobalObject::create_aggregate_error — blocked on bun_jsc")
    }
    pub fn create_aggregate_error_with_array(
        &self,
        _message: bun_string::String,
        _errors_array: JSValue,
    ) -> JsResult<JSValue> {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::create_aggregate_error_with_array
        todo!("JSGlobalObject::create_aggregate_error_with_array — blocked on bun_jsc")
    }
}

mod jsc {
    pub use super::{JSGlobalObject, JSValue};

    pub mod comptime_string_map_jsc {
        use super::*;
        /// Look up `input` (after stringifying) in a comptime `phf::Map`.
        /// Mirrors `bun_jsc::comptime_string_map_jsc::from_js`.
        pub fn from_js<V: Copy>(
            _map: &'static phf::Map<&'static [u8], V>,
            _global: &JSGlobalObject,
            _input: JSValue,
        ) -> super::super::JsResult<Option<V>> {
            // TODO(b2-blocked): bun_jsc::comptime_string_map_jsc::from_js
            todo!("comptime_string_map_jsc::from_js — blocked on bun_jsc")
        }
    }

    /// `bun.api.BuildMessage` — wraps a `bun.logger.Msg` for JS exposure.
    pub struct BuildMessage;
    impl BuildMessage {
        pub fn create(
            _global: &JSGlobalObject,
            _msg: bun_logger::Msg,
        ) -> Result<JSValue, bun_alloc::AllocError> {
            // TODO(b2-blocked): bun_jsc::BuildMessage::create
            todo!("BuildMessage::create — blocked on bun_jsc")
        }
    }

    /// `bun.api.ResolveMessage` — wraps a resolver error for JS exposure.
    pub struct ResolveMessage;
    impl ResolveMessage {
        pub fn create(
            _global: &JSGlobalObject,
            _msg: &bun_logger::Msg,
            _referrer: &[u8],
        ) -> Result<JSValue, bun_alloc::AllocError> {
            // TODO(b2-blocked): bun_jsc::ResolveMessage::create
            todo!("ResolveMessage::create — blocked on bun_jsc")
        }
    }
}

pub fn msg_from_js(global_object: &JSGlobalObject, file: &[u8], err: JSValue) -> JsResult<Msg> {
    // TODO(b2-blocked): bun_jsc::zig_exception::Holder
    // TODO(b2-blocked): bun_jsc::JSValue::to_error
    // TODO(b2-blocked): bun_jsc::JSValue::to_zig_exception
    // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
    // ALSO blocked on bun_logger retyping `Str` (`Data.text`/`Location.file`
    // are `&'static [u8]`); un-gating today would force `Box::leak`, which
    // PORTING.md §Forbidden bans. Re-gated until both land.
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
    todo!("logger_jsc::msg_from_js — blocked on bun_jsc::zig_exception::Holder + bun_logger::Str retyping")
}

pub fn msg_to_js(this: Msg, global_object: &JSGlobalObject) -> Result<JSValue, bun_alloc::AllocError> {
    match this.metadata {
        Metadata::Build => jsc::BuildMessage::create(global_object, this),
        Metadata::Resolve(_) => jsc::ResolveMessage::create(global_object, &this, b""),
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
    jsc::comptime_string_map_jsc::from_js(&Level::MAP, global_this, value)
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
//   todos:      see TODO(b2-blocked) markers
//   notes:      B-2 un-gated (5/6). Bodies now compile against real bun_logger
//               types via a local shadow of bun_jsc's Track-A stub surface
//               (JSValue/JSGlobalObject/JsError/BuildMessage/ResolveMessage/
//               comptime_string_map_jsc). `msg_from_js` remains gated: it
//               needs bun_jsc::zig_exception::Holder AND bun_logger to retype
//               `Str` away from `&'static [u8]` (un-gating today would force
//               Box::leak, banned by PORTING.md §Forbidden). Once
//               `cargo check -p bun_jsc` is green, swap the shadow block for
//               `use bun_jsc::{...}` — signatures match verbatim.
// ──────────────────────────────────────────────────────────────────────────
