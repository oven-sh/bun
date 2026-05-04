//! JSC bridges for `sql/postgres/types/Tag.zig`. The `Tag` OID enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

use bun_jsc::{JSGlobalObject, JSType, JSValue, JsResult};
use bun_sql::postgres::types::Tag;
use bun_sql::postgres::AnyPostgresError;

use super::bytea;
use super::date;
use super::json;
use super::postgres_string as string;
use super::r#bool;

// PERF(port): was `comptime T: Tag` monomorphization — profile in Phase B.
// TODO(port): narrow error set (Zig inferred `error{UnsupportedArrayType}`).
pub fn to_js_typed_array_type(t: Tag) -> Result<JSType, bun_core::Error> {
    match t {
        Tag::Int4Array => Ok(JSType::Int32Array),
        // Tag::Int2Array => Ok(JSType::Uint2Array),
        Tag::Float4Array => Ok(JSType::Float32Array),
        // Tag::Float8Array => Ok(JSType::Float64Array),
        _ => Err(bun_core::err!("UnsupportedArrayType")),
    }
}

// TODO(port): Zig used `(comptime Type: type, value: Type)` so each call site
// monomorphizes and the per-arm callees (`jsNumber`, `json::to_js`, ...) all
// accept `anytype`. In Rust this needs a trait that every arm's callee accepts,
// or per-type overloads. Left as an unbounded generic for Phase B to resolve.
fn to_js_with_type<T>(
    tag: Tag,
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    match tag {
        Tag::Numeric => Ok(JSValue::js_number(value)),

        Tag::Float4 | Tag::Float8 => Ok(JSValue::js_number(value)),

        Tag::Json | Tag::Jsonb => json::to_js(global, value),

        Tag::Bool => r#bool::to_js(global, value),

        Tag::Timestamp | Tag::Timestamptz => date::to_js(global, value),

        Tag::Bytea => bytea::to_js(global, value),

        Tag::Int8 => Ok(JSValue::from_int64_no_truncate(global, value)),

        Tag::Int4 => Ok(JSValue::js_number(value)),

        _ => string::to_js(global, value),
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
        return Ok(Tag::Numeric);
    }

    if value.is_cell() {
        let tag = value.js_type();
        if tag.is_string_like() {
            return Ok(Tag::Text);
        }

        if tag == JSType::JSDate {
            return Ok(Tag::Timestamptz);
        }

        if tag.is_typed_array_or_array_buffer() {
            if tag == JSType::Int32Array {
                return Ok(Tag::Int4Array);
            }

            return Ok(Tag::Bytea);
        }

        if tag == JSType::HeapBigInt {
            return Ok(Tag::Int8);
        }

        if tag.is_array_like() {
            // We will JSON.stringify anything else.
            return Ok(Tag::Json);
        }

        // Ban these types:
        if tag == JSType::NumberObject {
            // TODO(port): exact `globalObject.ERR(.INVALID_ARG_TYPE, ...).throw()` API shape
            return global
                .ERR_INVALID_ARG_TYPE(
                    "Number object is ambiguous and cannot be used as a PostgreSQL type",
                )
                .throw();
        }

        if tag == JSType::BooleanObject {
            return global
                .ERR_INVALID_ARG_TYPE(
                    "Boolean object is ambiguous and cannot be used as a PostgreSQL type",
                )
                .throw();
        }

        // It's something internal
        if !tag.is_indexable() {
            return global
                .ERR_INVALID_ARG_TYPE("Unknown object is not a valid PostgreSQL type")
                .throw();
        }

        // We will JSON.stringify anything else.
        if tag.is_object() {
            return Ok(Tag::Json);
        }
    }

    if value.is_int32() {
        return Ok(Tag::Int4);
    }

    if value.is_any_int() {
        let int = value.to_int64();
        if int >= i64::from(i32::MIN) && int <= i64::from(i32::MAX) {
            return Ok(Tag::Int4);
        }

        return Ok(Tag::Int8);
    }

    if value.is_number() {
        return Ok(Tag::Float8);
    }

    if value.is_boolean() {
        return Ok(Tag::Bool);
    }

    Ok(Tag::Numeric)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/tag_jsc.zig (155 lines)
//   confidence: medium
//   todos:      3
//   notes:      to_js_with_type's anytype-per-arm dispatch needs a trait in Phase B; ERR(...).throw() API shape guessed
// ──────────────────────────────────────────────────────────────────────────
