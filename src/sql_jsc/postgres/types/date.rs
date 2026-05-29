use crate::jsc::{JSGlobalObject, JSValue, JsResult};
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
    let microseconds =
        i64::from_be_bytes(bytes[0..8].try_into().expect("infallible: size matches"));
    let double_microseconds: f64 = microseconds as f64;
    (double_microseconds / US_PER_MS as f64) + POSTGRES_EPOCH_DATE as f64
}

pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<i64> {
    let double_value = if value.is_date() {
        value.get_unix_timestamp()
    } else if value.is_number() {
        value.as_number()
    } else if value.is_string() {
        // Zig: `catch @panic("unreachable")` → .expect.
        let mut str =
            bun_core::OwnedString::new(value.to_bun_string(global_object).expect("unreachable"));
        crate::jsc::bun_string_jsc::parse_date(&mut str, global_object)?
    } else {
        return Ok(0);
    };

    let unix_timestamp: i64 = double_value as i64;
    Ok((unix_timestamp - POSTGRES_EPOCH_DATE) * US_PER_MS)
}

pub trait DateToJs {
    fn date_to_js(self, global_object: &JSGlobalObject) -> JSValue;
}

impl DateToJs for i64 {
    fn date_to_js(self, global_object: &JSGlobalObject) -> JSValue {
        to_js_i64(global_object, self)
    }
}

impl DateToJs for Data {
    fn date_to_js(self, global_object: &JSGlobalObject) -> JSValue {
        to_js_data(global_object, &self)
    }
}

pub fn to_js<T: DateToJs>(global_object: &JSGlobalObject, value: T) -> JSValue {
    value.date_to_js(global_object)
}

pub fn to_js_i64(global_object: &JSGlobalObject, value: i64) -> JSValue {
    // Convert from Postgres timestamp (μs since 2000-01-01) to Unix timestamp (ms)
    let ms = value.div_euclid(US_PER_MS) + POSTGRES_EPOCH_DATE;
    JSValue::from_date_number(global_object, ms as f64)
}

pub fn to_js_data(global_object: &JSGlobalObject, value: &Data) -> JSValue {
    let z = value.slice_z();
    // SAFETY: ZStr invariant guarantees a readable NUL terminator at `len`; Postgres
    // date payloads contain no interior NULs, satisfying CStr's contract.
    let cstr = unsafe { bun_core::ffi::cstr(z.as_ptr()) };
    JSValue::from_date_string(global_object, cstr)
}

// ported from: src/sql_jsc/postgres/types/date.zig
