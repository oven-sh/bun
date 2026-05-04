//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_logger::{self as logger, Location, Log, Msg};
use bun_str::{self as string, ZigString};

// TODO(port): `bun.api.BuildMessage` / `bun.api.ResolveMessage` live under
// `src/runtime/api/` per repo layout → `bun_runtime::api::*`. Phase B: confirm crate path.
use bun_runtime::api::{BuildMessage, ResolveMessage};

pub fn msg_from_js(global_object: &JSGlobalObject, file: &[u8], err: JSValue) -> JsResult<Msg> {
    // TODO(port): `jsc.ZigException.Holder` — exact Rust path TBD in bun_jsc.
    let mut zig_exception_holder = bun_jsc::zig_exception::Holder::init();
    if let Some(value) = err.to_error() {
        value.to_zig_exception(global_object, zig_exception_holder.zig_exception());
    } else {
        zig_exception_holder.zig_exception().message = err.to_bun_string(global_object)?;
    }

    Ok(Msg {
        data: logger::Data {
            text: zig_exception_holder.zig_exception().message.to_owned_slice()?,
            location: Some(Location {
                // TODO(port): Location.file ownership — Zig borrowed the caller's slice;
                // Rust field type (Box<[u8]> vs &'static [u8]) is decided in bun_logger.
                file: Box::<[u8]>::from(file),
                line: 0,
                column: 0,
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    })
}

pub fn msg_to_js(this: Msg, global_object: &JSGlobalObject) -> Result<JSValue, bun_alloc::AllocError> {
    match this.metadata {
        logger::Metadata::Build => BuildMessage::create(global_object, this),
        logger::Metadata::Resolve { .. } => ResolveMessage::create(global_object, this, b""),
    }
}

pub fn level_from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Option<logger::log::Level>> {
    if value.is_empty() || value.is_undefined() {
        return Ok(None);
    }

    if !value.is_string() {
        return Err(global_this.throw_invalid_arguments("Expected logLevel to be a string", format_args!("")));
    }

    // TODO(port): `Log.Level.Map` is a ComptimeStringMap in Zig → `phf::Map` in bun_logger;
    // `.fromJS` is the JSC-aware lookup helper. Phase B: wire `Level::map_from_js`.
    logger::log::Level::map_from_js(global_this, value)
}

pub fn log_to_js(this: &Log, global: &JSGlobalObject, message: &[u8]) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();
    // On-stack array: conservative GC stack scan keeps these JSValues alive (see PORTING.md §JSC).
    let mut errors_stack: [JSValue; 256] = [JSValue::ZERO; 256];

    let count = u16::try_from(msgs.len().min(errors_stack.len())).unwrap();
    match count {
        0 => Ok(JSValue::UNDEFINED),
        1 => {
            let msg = msgs[0].clone();
            Ok(match msg.metadata {
                logger::Metadata::Build => BuildMessage::create(global, msg)?,
                logger::Metadata::Resolve { .. } => ResolveMessage::create(global, msg, b"")?,
            })
        }
        _ => {
            for (i, msg) in msgs[..usize::from(count)].iter().enumerate() {
                errors_stack[i] = match msg.metadata {
                    logger::Metadata::Build => BuildMessage::create(global, msg.clone())?,
                    logger::Metadata::Resolve { .. } => ResolveMessage::create(global, msg.clone(), b"")?,
                };
            }
            let out = ZigString::init(message);
            let agg = global.create_aggregate_error(&errors_stack[..usize::from(count)], &out)?;
            Ok(agg)
        }
    }
}

/// unlike `to_js`, this always produces an AggregateError object
pub fn log_to_js_aggregate_error(this: &Log, global: &JSGlobalObject, message: bun_str::String) -> JsResult<JSValue> {
    global.create_aggregate_error_with_array(message, log_to_js_array(this, global)?)
}

pub fn log_to_js_array(this: &Log, global: &JSGlobalObject) -> JsResult<JSValue> {
    let msgs: &[Msg] = this.msgs.as_slice();

    let arr = JSValue::create_empty_array(global, msgs.len())?;
    for (i, msg) in msgs.iter().enumerate() {
        arr.put_index(global, u32::try_from(i).unwrap(), msg_to_js(msg.clone(), global)?)?;
    }

    Ok(arr)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/logger_jsc/logger_jsc.zig (93 lines)
//   confidence: medium
//   todos:      4
//   notes:      bun.api.{Build,Resolve}Message crate path + ZigException::Holder path need Phase-B confirmation; Msg/Location field init uses ..Default — verify bun_logger struct shapes.
// ──────────────────────────────────────────────────────────────────────────
