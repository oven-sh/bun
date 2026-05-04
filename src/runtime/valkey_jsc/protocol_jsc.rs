//! `to_js` bridges for the RESP protocol types in `valkey/valkey_protocol.zig`.
//! The protocol parser, `RESPValue` union, and `ValkeyReader` stay in
//! `valkey/`; only the `JSGlobalObject`/`JSValue`-touching conversions live
//! here so `valkey/` is JSC-free.

use bun_jsc::{ArrayBuffer, Error as JscError, JSGlobalObject, JSValue, JsError, JsResult};
use bun_str::String as BunString;
use bun_valkey::valkey_protocol::{self as protocol, RESPValue, RedisError};

pub fn valkey_error_to_js(
    global: &JSGlobalObject,
    message: Option<&[u8]>,
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

    if let Some(msg) = message {
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
        BunString::create_utf8_for_js(global, str)
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
            Some(str),
            RedisError::InvalidResponse,
        )),
        RESPValue::Integer(int) => Ok(JSValue::js_number(*int)),
        RESPValue::BulkString(maybe_str) => {
            if let Some(str) = maybe_str {
                valkey_str_to_js_value(global, str, &options)
            } else {
                Ok(JSValue::NULL)
            }
        }
        RESPValue::Array(array) => {
            let js_array = JSValue::create_empty_array(global, array.len())?;
            for (i, item) in array.iter_mut().enumerate() {
                let js_item = resp_value_to_js_with_options(item, global, options)?;
                js_array.put_index(global, u32::try_from(i).unwrap(), js_item)?;
            }
            Ok(js_array)
        }
        RESPValue::Null => Ok(JSValue::NULL),
        RESPValue::Double(d) => Ok(JSValue::js_number(*d)),
        RESPValue::Boolean(b) => Ok(JSValue::from(*b)),
        RESPValue::BlobError(str) => Ok(valkey_error_to_js(
            global,
            Some(str),
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
                let key_str = js_key.to_bun_string(global)?;
                let js_value = resp_value_to_js_with_options(&mut entry.value, global, options)?;

                js_obj.put_may_be_index(global, &key_str, js_value)?;
            }
            Ok(js_obj)
        }
        RESPValue::Set(set) => {
            let js_array = JSValue::create_empty_array(global, set.len())?;
            for (i, item) in set.iter_mut().enumerate() {
                let js_item = resp_value_to_js_with_options(item, global, options)?;
                js_array.put_index(global, u32::try_from(i).unwrap(), js_item)?;
            }
            Ok(js_array)
        }
        RESPValue::Attribute(attribute) => {
            // For now, we just return the value and ignore attributes
            // In the future, we could attach the attributes as a hidden property
            resp_value_to_js_with_options(&mut attribute.value, global, options)
        }
        RESPValue::Push(push) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);

            // Add the push type
            let kind_str = BunString::create_utf8_for_js(global, &push.kind)?;
            js_obj.put(global, "type", kind_str);

            // Add the data as an array
            let data_array = JSValue::create_empty_array(global, push.data.len())?;
            for (i, item) in push.data.iter_mut().enumerate() {
                let js_item = resp_value_to_js_with_options(item, global, options)?;
                data_array.put_index(global, u32::try_from(i).unwrap(), js_item)?;
            }
            js_obj.put(global, "data", data_array);

            Ok(js_obj)
        }
        RESPValue::BigNumber(str) => {
            // Try to parse as number if possible
            // TODO(port): std.fmt.parseInt on []const u8 — RESP big numbers are ASCII digits,
            // so the from_utf8 here is safe (not arbitrary external bytes).
            if let Some(int) = core::str::from_utf8(str)
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
            {
                Ok(JSValue::js_number(int))
            } else {
                // If it doesn't fit in an i64, return as string
                BunString::create_utf8_for_js(global, str)
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/protocol_jsc.zig (147 lines)
//   confidence: medium
//   todos:      1
//   notes:      RESPValue variant payload shapes assumed from usage; jsc::Error.fmt() signature guessed (format_args!).
// ──────────────────────────────────────────────────────────────────────────
