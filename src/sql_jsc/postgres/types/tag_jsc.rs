//! JSC bridges for the postgres `Tag` OID enum. The enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

use crate::jsc::{JSGlobalObject, JSType, JSValue, JsResult};
use bun_sql::postgres::types::tag::Tag;

/// A buffer stands for its bytes. An Int32Array is a list of numbers, like an Array.
pub(crate) fn is_bytes(js_type: JSType) -> bool {
    js_type.is_array_buffer_like() && js_type != JSType::Int32Array
}

/// The type declared in Parse for `value`.
pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Tag> {
    if value.is_int32() {
        return Ok(Tag::int4);
    }

    if value.is_number() {
        return Ok(from_double(value.as_double()));
    }

    if value.is_boolean() {
        return Ok(Tag::bool);
    }

    if value.is_cell() {
        let tag = value.js_type();
        if tag.is_string_like() || tag == JSType::JSDate {
            return Ok(Tag::unspecified);
        }

        if is_bytes(tag) {
            return Ok(Tag::bytea);
        }

        if tag == JSType::HeapBigInt {
            if value.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
                return Ok(Tag::int8);
            }

            return Ok(Tag::numeric);
        }

        // Ban these types:
        if tag == JSType::NumberObject {
            return Err(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
                "Number object is ambiguous and cannot be used as a PostgreSQL type"
            ))));
        }

        if tag == JSType::BooleanObject {
            return Err(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
                "Boolean object is ambiguous and cannot be used as a PostgreSQL type"
            ))));
        }

        // It's something internal
        if !tag.is_indexable() && bun_jsc::DOMURL::cast(value).is_none() {
            return Err(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
                "Unknown object is not a valid PostgreSQL type"
            ))));
        }
    }

    Ok(Tag::unspecified)
}

fn from_double(number: f64) -> Tag {
    let is_safe_integer =
        number.trunc() == number && number.abs() <= bun_jsc::MAX_SAFE_INTEGER as f64;
    // An integer type would drop the sign of -0.
    if !is_safe_integer || (number == 0.0 && number.is_sign_negative()) {
        return Tag::float8;
    }

    if number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX) {
        return Tag::int4;
    }

    Tag::int8
}
