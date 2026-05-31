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

/// Decode a Postgres `timestamp` (WITHOUT TIME ZONE) text value as UTC, so the
/// text/simple-query path agrees with the binary path (which is already UTC).
/// Postgres emits these as `YYYY-MM-DD HH:MM:SS[.ffffff]` with no offset;
/// without this they'd go through JS `Date.parse` and be read as local time on
/// non-UTC hosts. Returns `None` for anything that isn't this exact shape
/// (e.g. `infinity`, BC dates, 5+ digit years), so the caller falls back to
/// `Date.parse`. `timestamptz` and `date` already decode correctly via
/// `Date.parse` and must NOT be routed here.
pub fn timestamp_text_to_ms_utc(global_object: &JSGlobalObject, bytes: &[u8]) -> Option<f64> {
    fn parse_u(bytes: &[u8]) -> Option<i32> {
        if bytes.is_empty() {
            return None;
        }
        let mut n: i32 = 0;
        for &c in bytes {
            if !c.is_ascii_digit() {
                return None;
            }
            n = n.checked_mul(10)?.checked_add(i32::from(c - b'0'))?;
        }
        Some(n)
    }

    if bytes.len() < 19
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b' '
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let year = parse_u(&bytes[0..4])?;
    let month = parse_u(&bytes[5..7])?;
    let day = parse_u(&bytes[8..10])?;
    let hour = parse_u(&bytes[11..13])?;
    let minute = parse_u(&bytes[14..16])?;
    let second = parse_u(&bytes[17..19])?;

    let millisecond = if bytes.len() > 19 {
        if bytes[19] != b'.' {
            return None;
        }
        let frac = &bytes[20..];
        if frac.is_empty() || frac.len() > 6 || !frac.iter().all(u8::is_ascii_digit) {
            return None;
        }
        // Fractional seconds → milliseconds (JS Date is ms-precision, like the
        // binary path's f64 truncation).
        let mut micro = parse_u(frac)?;
        for _ in 0..(6 - frac.len()) {
            micro *= 10;
        }
        micro / 1000
    } else {
        0
    };

    global_object
        .gregorian_date_time_to_ms_utc(year, month, day, hour, minute, second, millisecond)
        .ok()
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

// Zig `toJS(value: anytype)` dispatches on `@TypeOf(value)` at comptime over a
// closed set {i64, *Data}. Rust has no comptime type-switch; modeled as a trait
// with per-type impls so `tag_jsc::to_js_with_type` can dispatch uniformly. The
// `else => @compileError(...)` arm is the natural "no impl" compile error.
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
