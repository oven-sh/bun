//! JSC bridges for `sql/postgres/types/Tag.zig`. The `Tag` OID enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

use crate::jsc::{JSGlobalObject, JSType, JSValue, JsResult};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::tag::Tag;
use bun_sql::shared::Data;

pub(crate) fn to_js_typed_array_type(t: Tag) -> Result<JSType, bun_core::Error> {
    match t {
        Tag::int4_array => Ok(JSType::Int32Array),
        // Tag::int2_array => Ok(JSType::Uint2Array),
        Tag::float4_array => Ok(JSType::Float32Array),
        // Tag::float8_array => Ok(JSType::Float64Array),
        _ => Err(bun_core::err!("UnsupportedArrayType")),
    }
}

/// rest may `unreachable!()` (mirroring Zig's per-monomorphization compile
/// error becoming a runtime impossibility once the `tag` is fixed).
pub trait TagToJs: Sized {
    /// `.numeric | .float4 | .float8 | .int4` arms → `JSValue.jsNumber(value)`.
    fn as_js_number(self) -> f64;
    /// `.int8` arm → `JSValue.fromInt64NoTruncate(global, value)`.
    fn as_i64(self) -> i64;
    /// `.bool` arm → `bool.toJS(global, value)`.
    fn as_bool(self) -> bool;
    /// `.json | .jsonb | .bytea` arms → `json.toJS` / `bytea.toJS`, both of
    /// which take owned `Data` in the Rust port.
    fn into_data(self) -> Data;
    /// `.timestamp | .timestamptz` arm → `date.toJS(global, value)`.
    fn date_to_js(self, global: &JSGlobalObject) -> JSValue;
    /// `else` arm → `string.toJS(global, value)`.
    fn string_to_js(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Tag> {
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

// ported from: src/sql_jsc/postgres/types/tag_jsc.zig
