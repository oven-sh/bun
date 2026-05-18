//! `to_js` bridges for the RESP protocol types in `valkey/valkey_protocol.zig`.
//! The protocol parser, `RESPValue` union, and `ValkeyReader` stay in
//! `valkey/`; only the `JSGlobalObject`/`JSValue`-touching conversions live
//! here so `valkey/` is JSC-free.

use crate::jsc::{
    ArrayBuffer, Error as JscError, JSGlobalObject, JSValue, JsError, JsResult, bun_string_jsc,
};
use bun_core::String as BunString;
use bun_valkey::valkey_protocol::{self as protocol, RESPValue, RedisError};

#[allow(unused_imports)]
use protocol as _; // keep `protocol` referenced for sibling drafts

/// Zig: `valkeyErrorToJS(global, message: ?[]const u8, err)`.
/// All Rust callers always provide a message (never `None`), so the parameter
/// is `impl AsRef<[u8]>` to accept `&str`, `&[u8]`, `&[u8; N]`, `&Box<[u8]>`
/// uniformly without forcing `Some(..)` at every call site.
pub fn valkey_error_to_js(
    global: &JSGlobalObject,
    message: impl AsRef<[u8]>,
    err: RedisError,
) -> JSValue {
    let error_code: JscError = match err {
        RedisError::ConnectionClosed => JscError::REDIS_CONNECTION_CLOSED,
        RedisError::InvalidResponse => JscError::REDIS_INVALID_RESPONSE,
        RedisError::InvalidBulkString => JscError::REDIS_INVALID_BULK_STRING,
        RedisError::InvalidArray => JscError::REDIS_INVALID_ARRAY,
        RedisError::InvalidInteger => JscError::REDIS_INVALID_INTEGER,
        RedisError::InvalidSimpleString => JscError::REDIS_INVALID_SIMPLE_STRING,
        RedisError::InvalidErrorString => JscError::REDIS_INVALID_ERROR_STRING,
        RedisError::InvalidDouble
        | RedisError::InvalidBoolean
        | RedisError::InvalidNull
        | RedisError::InvalidMap
        | RedisError::InvalidSet
        | RedisError::InvalidBigNumber
        | RedisError::InvalidVerbatimString
        | RedisError::InvalidBlobError
        | RedisError::InvalidAttribute
        | RedisError::InvalidPush => JscError::REDIS_INVALID_RESPONSE,
        RedisError::AuthenticationFailed => JscError::REDIS_AUTHENTICATION_FAILED,
        RedisError::InvalidCommand => JscError::REDIS_INVALID_COMMAND,
        RedisError::InvalidArgument => JscError::REDIS_INVALID_ARGUMENT,
        RedisError::UnsupportedProtocol => JscError::REDIS_INVALID_RESPONSE,
        RedisError::InvalidResponseType => JscError::REDIS_INVALID_RESPONSE_TYPE,
        RedisError::ConnectionTimeout => JscError::REDIS_CONNECTION_TIMEOUT,
        RedisError::IdleTimeout => JscError::REDIS_IDLE_TIMEOUT,
        RedisError::NestingDepthExceeded => JscError::REDIS_INVALID_RESPONSE,
        RedisError::JSError => return global.take_exception(JsError::Thrown),
        RedisError::OutOfMemory => {
            let _ = global.throw_out_of_memory();
            return global.take_exception(JsError::Thrown);
        }
        RedisError::JSTerminated => return global.take_exception(JsError::Terminated),
    };

    let msg = message.as_ref();
    if !msg.is_empty() {
        return error_code.fmt(global, format_args!("{}", bstr::BStr::new(msg)));
    }
    error_code.fmt(
        global,
        format_args!("Valkey error: {}", <&'static str>::from(err)),
    )
}

pub fn resp_value_to_js(this: &mut RESPValue, global: &JSGlobalObject) -> JsResult<JSValue> {
    resp_value_to_js_with_options(this, global, ToJSOptions::default())
}

#[derive(Clone, Copy, Default)]
pub struct ToJSOptions {
    pub return_as_buffer: bool,
}

fn valkey_str_to_js_value(
    global: &JSGlobalObject,
    str: &[u8],
    options: &ToJSOptions,
) -> JsResult<JSValue> {
    if options.return_as_buffer {
        // TODO: handle values > 4.7 GB
        ArrayBuffer::create_buffer(global, str)
    } else {
        bun_string_jsc::create_utf8_for_js(global, str)
    }
}

pub fn resp_value_to_js_with_options(
    this: &mut RESPValue,
    global: &JSGlobalObject,
    options: ToJSOptions,
) -> JsResult<JSValue> {
    match this {
        RESPValue::SimpleString(str) => valkey_str_to_js_value(global, str, &options),
        RESPValue::Error(str) => Ok(valkey_error_to_js(
            global,
            &**str,
            RedisError::InvalidResponse,
        )),
        RESPValue::Integer(int) => Ok(JSValue::js_number(*int as f64)),
        RESPValue::BulkString(maybe_str) => {
            if let Some(str) = maybe_str {
                valkey_str_to_js_value(global, str, &options)
            } else {
                Ok(JSValue::NULL)
            }
        }
        RESPValue::Array(array) => {
            JSValue::create_array_from_iter(global, array.iter_mut(), |item| {
                resp_value_to_js_with_options(item, global, options)
            })
        }
        RESPValue::Null => Ok(JSValue::NULL),
        RESPValue::Double(d) => Ok(JSValue::js_number(*d)),
        RESPValue::Boolean(b) => Ok(JSValue::from(*b)),
        RESPValue::BlobError(str) => Ok(valkey_error_to_js(
            global,
            &**str,
            RedisError::InvalidBlobError,
        )),
        RESPValue::VerbatimString(verbatim) => {
            valkey_str_to_js_value(global, &verbatim.content, &options)
        }
        RESPValue::Map(entries) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);
            for entry in entries.iter_mut() {
                let js_key =
                    resp_value_to_js_with_options(&mut entry.key, global, ToJSOptions::default())?;
                // Zig: `js_obj.putMayBeIndex(global, &key_str, value)` — no Rust binding yet,
                // so route through `put_to_property_key` which performs the same
                // index-vs-string property dispatch on the JSValue key.
                let _ = js_key.to_bun_string(global)?; // preserve toString side-effect/exception path
                let js_value = resp_value_to_js_with_options(&mut entry.value, global, options)?;

                JSValue::put_to_property_key(js_obj, global, js_key, js_value)?;
            }
            Ok(js_obj)
        }
        RESPValue::Set(set) => JSValue::create_array_from_iter(global, set.iter_mut(), |item| {
            resp_value_to_js_with_options(item, global, options)
        }),
        RESPValue::Attribute(attribute) => {
            // For now, we just return the value and ignore attributes
            // In the future, we could attach the attributes as a hidden property
            resp_value_to_js_with_options(&mut attribute.value, global, options)
        }
        RESPValue::Push(push) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);

            // Add the push type
            let kind_str = bun_string_jsc::create_utf8_for_js(global, &push.kind)?;
            js_obj.put(global, b"type", kind_str);

            // Add the data as an array
            let data_array =
                JSValue::create_array_from_iter(global, push.data.iter_mut(), |item| {
                    resp_value_to_js_with_options(item, global, options)
                })?;
            js_obj.put(global, b"data", data_array);

            Ok(js_obj)
        }
        RESPValue::BigNumber(str) => {
            // Try to parse as number if possible
            if let Ok(int) = bun_core::fmt::parse_int::<i64>(str, 10) {
                Ok(JSValue::js_number(int as f64))
            } else {
                // If it doesn't fit in an i64, return as string
                bun_string_jsc::create_utf8_for_js(global, str)
            }
        }
    }
}

// ported from: src/runtime/valkey_jsc/protocol_jsc.zig
