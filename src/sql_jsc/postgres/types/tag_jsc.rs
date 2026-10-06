//! JSC bridges for the postgres `Tag` OID enum. The enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

use crate::jsc::{JSGlobalObject, JSType, JSValue, JsResult};
use bun_sql::postgres::types::tag::Tag;

// `Tag` is a runtime arg rather than a const generic: it is a
// `#[repr(transparent)] struct Tag(Short)` with associated consts (non-exhaustive
// OID space), so it can't be `ConstParamTy`. The body
// is a plain match and the only caller (DataCell) computes the tag at runtime
// anyway.
// `UnsupportedArrayType` is reported via the crate-wide
// `crate::Error`.
pub(crate) fn to_js_typed_array_type(t: Tag) -> crate::Result<JSType> {
    match t {
        Tag::int4_array => Ok(JSType::Int32Array),
        // Tag::int2_array => Ok(JSType::Uint2Array),
        Tag::float4_array => Ok(JSType::Float32Array),
        // Tag::float8_array => Ok(JSType::Float64Array),
        _ => Err(crate::Error::UnsupportedArrayType),
    }
}

pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Tag> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Tag::numeric);
    }

    if value.is_cell() {
        let tag = value.js_type();
        if tag.is_string_like() {
            return Ok(Tag::text);
        }

        if tag == JSType::JSDate {
            return Ok(Tag::timestamptz);
        }

        if tag.is_typed_array_or_array_buffer() {
            if tag == JSType::Int32Array {
                return Ok(Tag::int4_array);
            }

            return Ok(Tag::bytea);
        }

        if tag == JSType::HeapBigInt {
            return Ok(Tag::int8);
        }

        if tag.is_array_like() {
            // We will JSON.stringify anything else.
            return Ok(Tag::json);
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
        if !tag.is_indexable() {
            return Err(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
                "Unknown object is not a valid PostgreSQL type"
            ))));
        }

        // We will JSON.stringify anything else.
        if tag.is_object() {
            return Ok(Tag::json);
        }
    }

    if value.is_int32() {
        return Ok(Tag::int4);
    }

    if value.is_any_int() {
        let int = value.to_int64();
        if int >= i64::from(i32::MIN) && int <= i64::from(i32::MAX) {
            return Ok(Tag::int4);
        }

        return Ok(Tag::int8);
    }

    if value.is_number() {
        return Ok(Tag::float8);
    }

    if value.is_boolean() {
        return Ok(Tag::bool);
    }

    Ok(Tag::numeric)
}
