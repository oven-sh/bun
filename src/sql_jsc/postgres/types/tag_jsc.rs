//! JSC bridges for `sql/postgres/types/Tag.zig`. The `Tag` OID enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

use crate::jsc::{JSGlobalObject, JSType, JSValue, JsResult};
use bun_sql::postgres::types::tag::Tag;
use bun_sql::postgres::AnyPostgresError;

// `comptime T: Tag` → const generic per PORTING.md. `Tag` in the Rust port is a
// `#[repr(transparent)] struct Tag(Short)` with associated consts (non-exhaustive
// OID space), so it can't be `ConstParamTy`. Demoted to a runtime arg; the body
// is a plain match and the only caller (DataCell) computes the tag at runtime
// anyway.
// TODO(port): narrow error set (Zig inferred `error{UnsupportedArrayType}`).
pub fn to_js_typed_array_type(t: Tag) -> Result<JSType, bun_core::Error> {
    match t {
        Tag::int4_array => Ok(JSType::Int32Array),
        // Tag::int2_array => Ok(JSType::Uint2Array),
        Tag::float4_array => Ok(JSType::Float32Array),
        // Tag::float8_array => Ok(JSType::Float64Array),
        _ => Err(bun_core::err!("UnsupportedArrayType")),
    }
}

// TODO(port): Zig used `(comptime Type: type, value: Type)` so each call site
// monomorphizes and the per-arm callees (`jsNumber`, `json::to_js`, ...) all
// accept `anytype`. In Rust this needs a trait that every arm's callee accepts,
// or per-type overloads. The body is gated until that trait lands; only the
// signature is exposed for callers to type-check against.
pub fn to_js_with_type<T>(
    tag: Tag,
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    // TODO(port): per-arm dispatch trait (DataCell is the only caller and it
    // always passes `*Data`, so a single concrete impl may suffice).
    match tag {
        Tag::numeric => Ok(JSValue::js_number(value)),
        Tag::float4 | Tag::float8 => Ok(JSValue::js_number(value)),
        Tag::json | Tag::jsonb => super::json::to_js(global, value),
        Tag::bool => super::r#bool::to_js(global, value),
        Tag::timestamp | Tag::timestamptz => super::date::to_js(global, value),
        Tag::bytea => super::bytea::to_js(global, value),
        Tag::int8 => Ok(JSValue::from_int64_no_truncate(global, value)),
        Tag::int4 => Ok(JSValue::js_number(value)),
        _ => super::postgres_string::to_js(global, value),
    }
}

pub fn to_js<T>(
    tag: Tag,
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    // Zig: `toJSWithType(tag, globalObject, @TypeOf(value), value)` — the
    // `@TypeOf` is dropped; the generic `<T>` already names the type.
    to_js_with_type(tag, global, value)
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/tag_jsc.zig (155 lines)
//   confidence: medium
//   todos:      2
//   notes:      to_js_with_type's anytype-per-arm dispatch needs a trait in Phase B; ERR(...).throw() lowered to throw_value(ERR_INVALID_ARG_TYPE(..)); Tag consts are lowercase in the Rust port.
// ──────────────────────────────────────────────────────────────────────────
