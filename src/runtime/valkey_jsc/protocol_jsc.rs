//! `to_js` bridges for the RESP protocol types.
//! The protocol parser, `RESPValue` union, and `ValkeyReader` stay in
//! `valkey/`; only the `JSGlobalObject`/`JSValue`-touching conversions live
//! here so `valkey/` is JSC-free.

use crate::jsc::{ErrorCode, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_valkey::valkey_protocol::{RESPValue, RedisError};

/// All callers always provide a message, so the parameter
/// is `impl AsRef<[u8]>` to accept `&str`, `&[u8]`, `&[u8; N]`, `&Box<[u8]>`
/// uniformly without forcing `Some(..)` at every call site.
pub fn valkey_error_to_js(
    global: &JSGlobalObject,
    message: impl AsRef<[u8]>,
    err: RedisError,
) -> JSValue {
    let error_code: ErrorCode = match err {
        RedisError::ConnectionClosed => ErrorCode::REDIS_CONNECTION_CLOSED,
        RedisError::InvalidResponse => ErrorCode::REDIS_INVALID_RESPONSE,
        RedisError::InvalidBulkString => ErrorCode::REDIS_INVALID_BULK_STRING,
        RedisError::InvalidInteger => ErrorCode::REDIS_INVALID_INTEGER,
        RedisError::InvalidDouble
        | RedisError::InvalidBoolean
        | RedisError::InvalidMap
        | RedisError::InvalidSet
        | RedisError::InvalidVerbatimString
        | RedisError::InvalidBlobError
        | RedisError::InvalidAttribute
        | RedisError::InvalidPush => ErrorCode::REDIS_INVALID_RESPONSE,
        RedisError::AuthenticationFailed => ErrorCode::REDIS_AUTHENTICATION_FAILED,
        RedisError::ServerError => ErrorCode::REDIS_SERVER_ERROR,
        RedisError::InvalidCommand => ErrorCode::REDIS_INVALID_COMMAND,
        RedisError::InvalidArgument => ErrorCode::REDIS_INVALID_ARGUMENT,
        RedisError::UnsupportedProtocol => ErrorCode::REDIS_INVALID_RESPONSE,
        RedisError::InvalidResponseType => ErrorCode::REDIS_INVALID_RESPONSE_TYPE,
        RedisError::ConnectionTimeout => ErrorCode::REDIS_CONNECTION_TIMEOUT,
        RedisError::IdleTimeout => ErrorCode::REDIS_IDLE_TIMEOUT,
        RedisError::NestingDepthExceeded => ErrorCode::REDIS_INVALID_RESPONSE,
        RedisError::LineTooLong => ErrorCode::REDIS_INVALID_RESPONSE,
        RedisError::OutOfMemory => return global.create_out_of_memory_error(),
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

pub fn resp_value_to_js(this: RESPValue, global: &JSGlobalObject) -> JsResult<JSValue> {
    resp_value_to_js_with_options(this, global, ToJSOptions::default())
}

#[derive(Clone, Copy, Default)]
pub struct ToJSOptions {
    pub return_as_buffer: bool,
}

fn valkey_str_to_js_value(
    global: &JSGlobalObject,
    str: Box<[u8]>,
    options: ToJSOptions,
) -> JsResult<JSValue> {
    if options.return_as_buffer {
        // The parser's payload is an owned allocation that is only converted
        // once; adopt it as the Buffer backing store instead of copying it
        // into a fresh ArrayBuffer.
        Ok(JSValue::create_buffer_from_box(global, str))
    } else {
        bun_string_jsc::create_utf8_for_js(global, &str)
    }
}

pub fn resp_value_to_js_with_options(
    this: RESPValue,
    global: &JSGlobalObject,
    options: ToJSOptions,
) -> JsResult<JSValue> {
    match this {
        RESPValue::SimpleString(str) => valkey_str_to_js_value(global, str, options),
        RESPValue::Error(str) | RESPValue::BlobError(str) => {
            Ok(valkey_error_to_js(global, &*str, RedisError::ServerError))
        }
        RESPValue::Integer(int) => Ok(JSValue::js_number(int as f64)),
        RESPValue::BulkString(maybe_str) => {
            if let Some(str) = maybe_str {
                valkey_str_to_js_value(global, str, options)
            } else {
                Ok(JSValue::NULL)
            }
        }
        RESPValue::Array(items) | RESPValue::Set(items) => {
            JSValue::create_array_from_iter(global, items.into_iter(), |item| {
                resp_value_to_js_with_options(item, global, options)
            })
        }
        RESPValue::Null => Ok(JSValue::NULL),
        RESPValue::Double(d) => Ok(JSValue::js_number(d)),
        RESPValue::Boolean(b) => Ok(JSValue::from(b)),
        RESPValue::VerbatimString(verbatim) => {
            valkey_str_to_js_value(global, verbatim.content, options)
        }
        RESPValue::Map(entries) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);
            for entry in entries.into_iter() {
                let js_key =
                    resp_value_to_js_with_options(entry.key, global, ToJSOptions::default())?;
                // Route through `put_to_property_key`, which performs
                // index-vs-string property dispatch on the JSValue key.
                let js_value = resp_value_to_js_with_options(entry.value, global, options)?;

                JSValue::put_to_property_key(js_obj, global, js_key, js_value)?;
            }
            Ok(js_obj)
        }
        RESPValue::Attribute(attribute) => {
            // For now, we just return the value and ignore attributes
            // In the future, we could attach the attributes as a hidden property
            resp_value_to_js_with_options(*attribute.value, global, options)
        }
        RESPValue::Push(push) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);

            // Add the push type
            let kind_str = bun_string_jsc::create_utf8_for_js(global, &push.kind)?;
            js_obj.put(global, b"type", kind_str);

            // Add the data as an array
            let data_array =
                JSValue::create_array_from_iter(global, push.data.into_iter(), |item| {
                    resp_value_to_js_with_options(item, global, options)
                })?;
            js_obj.put(global, b"data", data_array);

            Ok(js_obj)
        }
        RESPValue::BigNumber(str) => valkey_str_to_js_value(global, str, options),
    }
}
