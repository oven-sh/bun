use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_sql::postgres::types::int_types::Short;
use bun_sql::shared::Data;

pub const TO: i32 = 1184;
pub const FROM: [Short; 3] = [1082, 1114, 1184];

// Postgres stores timestamp and timestampz as microseconds since 2000-01-01
// This is a signed 64-bit integer.
const POSTGRES_EPOCH_DATE: i64 = 946_684_800_000;

// std.time.us_per_ms
const US_PER_MS: i64 = 1000;

pub fn from_binary(bytes: &[u8]) -> f64 {
    let microseconds = i64::from_be_bytes(bytes[0..8].try_into().unwrap());
    let double_microseconds: f64 = microseconds as f64;
    (double_microseconds / US_PER_MS as f64) + POSTGRES_EPOCH_DATE as f64
}

pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<i64> {
    let double_value = if value.is_date() {
        value.get_unix_timestamp()
    } else if value.is_number() {
        value.as_number()
    } else if value.is_string() {
        // Zig: `catch @panic("unreachable")` → .expect; `defer str.deref()` → Drop on bun_str::String.
        let str = value.to_bun_string(global_object).expect("unreachable");
        str.parse_date(global_object)?
    } else {
        return Ok(0);
    };

    let unix_timestamp: i64 = double_value as i64;
    Ok((unix_timestamp - POSTGRES_EPOCH_DATE) * US_PER_MS)
}

// Zig `toJS(value: anytype)` dispatches on `@TypeOf(value)` at comptime over a
// closed set {i64, *Data}. Rust has no comptime type-switch; split into two fns.
// TODO(port): if callers need uniform dispatch, introduce a `DateToJs` trait.

pub fn to_js_i64(global_object: &JSGlobalObject, value: i64) -> JSValue {
    // Convert from Postgres timestamp (μs since 2000-01-01) to Unix timestamp (ms)
    let ms = value.div_euclid(US_PER_MS) + POSTGRES_EPOCH_DATE;
    JSValue::from_date_number(global_object, ms as f64)
}

pub fn to_js_data(global_object: &JSGlobalObject, mut value: Data) -> JSValue {
    // Zig: `defer value.deinit()` on `*Data` — function consumes the Data.
    // Taking `Data` by value lets Drop free it after we read the NUL-terminated slice.
    JSValue::from_date_string(global_object, value.slice_z().as_ptr())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/date.zig (55 lines)
//   confidence: medium
//   todos:      1
//   notes:      `toJS(anytype)` split into to_js_i64/to_js_data; Short type from bun_sql int_types
// ──────────────────────────────────────────────────────────────────────────
