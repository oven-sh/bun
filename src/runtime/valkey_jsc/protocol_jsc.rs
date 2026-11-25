//! `to_js` bridges for the RESP protocol types.
//! The protocol parser, `RESPValue` union, and `ValkeyReader` stay in
//! `valkey/`; only the `JSGlobalObject`/`JSValue`-touching conversions live
//! here so `valkey/` is JSC-free.

use crate::jsc::{Error as JscError, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_valkey::command::{Reply, maps_to_pairs};
use bun_valkey::valkey_protocol::{RESPValue, RedisError};

pub(crate) fn valkey_error_to_js(global: &JSGlobalObject, msg: &[u8], err: RedisError) -> JSValue {
    let error_code: JscError = match err {
        RedisError::ConnectionClosed => JscError::REDIS_CONNECTION_CLOSED,
        RedisError::InvalidResponse => JscError::REDIS_INVALID_RESPONSE,
        RedisError::InvalidBulkString => JscError::REDIS_INVALID_BULK_STRING,
        RedisError::InvalidInteger => JscError::REDIS_INVALID_INTEGER,
        RedisError::InvalidDouble
        | RedisError::InvalidBoolean
        | RedisError::InvalidNull
        | RedisError::InvalidMap
        | RedisError::InvalidSet
        | RedisError::InvalidVerbatimString
        | RedisError::InvalidBlobError
        | RedisError::InvalidAttribute
        | RedisError::InvalidPush => JscError::REDIS_INVALID_RESPONSE,
        RedisError::AuthenticationFailed => JscError::REDIS_AUTHENTICATION_FAILED,
        RedisError::InvalidCommand => JscError::REDIS_INVALID_COMMAND,
        RedisError::UnsupportedProtocol => JscError::REDIS_INVALID_RESPONSE,
        RedisError::InvalidResponseType => JscError::REDIS_INVALID_RESPONSE_TYPE,
        RedisError::ConnectionTimeout => JscError::REDIS_CONNECTION_TIMEOUT,
        RedisError::IdleTimeout => JscError::REDIS_IDLE_TIMEOUT,
        RedisError::NestingDepthExceeded => JscError::REDIS_INVALID_RESPONSE,
        RedisError::LineTooLong => JscError::REDIS_INVALID_RESPONSE,
        RedisError::ServerError => JscError::REDIS_SERVER_ERROR,
    };

    if !msg.is_empty() {
        return error_code.fmt(global, format_args!("{}", bstr::BStr::new(msg)));
    }
    error_code.fmt(
        global,
        format_args!("Valkey error: {}", <&'static str>::from(err)),
    )
}

/// For what `reply` refuses. The command has run, so the data goes along.
#[cold]
pub(crate) fn binary_key_error(
    this: &mut RESPValue,
    global: &JSGlobalObject,
    reply: Reply,
) -> JsResult<JSValue> {
    maps_to_pairs(this);
    let reply = reply_to_js(this, global, reply)?;
    let error = JscError::ENCODING_INVALID_ENCODED_DATA.fmt(
        global,
        format_args!(
            "The reply has a key that is not UTF-8 text, which an object cannot hold. \
             error.reply has it as [key, value] pairs"
        ),
    );
    error.put_non_enumerable(global, b"reply", reply);
    Ok(error)
}

#[cold]
pub(crate) fn results_to_js(
    results: &mut [(RESPValue, Reply)],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, results.iter_mut(), |(value, reply)| {
        if reply.refuses(value) {
            return binary_key_error(value, global, *reply);
        }
        reply_to_js(value, global, *reply)
    })
}

pub(crate) fn resp_value_to_js(this: &mut RESPValue, global: &JSGlobalObject) -> JsResult<JSValue> {
    reply_to_js(this, global, Reply::Value)
}

fn valkey_str_to_js_value(
    global: &JSGlobalObject,
    str: &mut Box<[u8]>,
    as_buffer: bool,
) -> JsResult<JSValue> {
    if as_buffer {
        // The parser's payload is an owned allocation that is only converted
        // once; adopt it as the Buffer backing store instead of copying it
        // into a fresh ArrayBuffer.
        JSValue::create_buffer_from_box(global, core::mem::take(str))
    } else {
        bun_string_jsc::create_utf8_for_js(global, str)
    }
}

pub(crate) fn reply_to_js(
    this: &mut RESPValue,
    global: &JSGlobalObject,
    reply: Reply,
) -> JsResult<JSValue> {
    match this {
        RESPValue::SimpleString(str) => valkey_str_to_js_value(global, str, reply == Reply::Buffer),
        RESPValue::BulkString(Some(str)) | RESPValue::VerbatimString(str) => {
            valkey_str_to_js_value(global, str, reply.keeps_bytes())
        }
        RESPValue::Error(str) => Ok(valkey_error_to_js(global, str, RedisError::ServerError)),
        RESPValue::Integer(int) => Ok(JSValue::js_number(*int as f64)),
        RESPValue::Array(array) if reply == Reply::Page => {
            JSValue::create_array_from_iter(global, array.iter_mut().enumerate(), |it| match it {
                (0, cursor @ RESPValue::BulkString(_)) => resp_value_to_js(cursor, global),
                (_, item) => reply_to_js(item, global, Reply::Binary),
            })
        }
        RESPValue::Array(array) => {
            JSValue::create_array_from_iter(global, array.iter_mut(), |item| {
                reply_to_js(item, global, reply)
            })
        }
        RESPValue::Null | RESPValue::BulkString(None) => Ok(JSValue::NULL),
        RESPValue::Double(d) => Ok(JSValue::js_number(*d)),
        RESPValue::Boolean(b) => Ok(JSValue::from(*b)),
        RESPValue::Map(entries) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);
            for entry in entries.iter_mut() {
                let js_key = resp_value_to_js(&mut entry.key, global)?;
                let js_value = reply_to_js(&mut entry.value, global, reply)?;

                JSValue::put_to_property_key(js_obj, global, js_key, js_value)?;
            }
            Ok(js_obj)
        }
        RESPValue::Set(set) => JSValue::create_array_from_iter(global, set.iter_mut(), |item| {
            reply_to_js(item, global, reply)
        }),
        RESPValue::Push(push) => {
            let js_obj = JSValue::create_empty_object_with_null_prototype(global);

            // Add the push type
            let kind_str = bun_string_jsc::create_utf8_for_js(global, &push.kind)?;
            js_obj.put(global, b"type", kind_str);

            // Add the data as an array
            let data_array =
                JSValue::create_array_from_iter(global, push.data.iter_mut(), |item| {
                    reply_to_js(item, global, reply)
                })?;
            js_obj.put(global, b"data", data_array);

            Ok(js_obj)
        }
        // BigInt when the payload is an integer literal; modules and Lua can
        // put anything after `(`, so other text stays a string.
        RESPValue::BigNumber(str) => {
            if reply != Reply::Buffer
                && let Some(big) = JSValue::big_int_from_decimal(global, str)?
            {
                return Ok(big);
            }
            valkey_str_to_js_value(global, str, reply == Reply::Buffer)
        }
    }
}
