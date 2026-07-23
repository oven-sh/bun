use crate::jsc::{JSGlobalObject, JSValue, JsResult};

// Postgres stores timestamp and timestampz as microseconds since 2000-01-01
// This is a signed 64-bit integer.
const POSTGRES_EPOCH_DATE: i64 = 946_684_800_000;

const US_PER_MS: i64 = 1000;

pub fn from_binary(bytes: &[u8]) -> f64 {
    let microseconds =
        i64::from_be_bytes(bytes[0..8].try_into().expect("infallible: size matches"));
    // Postgres src/include/datatype/timestamp.h: DT_NOEND / DT_NOBEGIN are the
    // i64 endpoints. Return ±Infinity so the JS side can surface the value as a
    // Number (see SQLClient.cpp toJS Date case); without this the arithmetic
    // below yields ~9.224e15 ms, past JS Date's ±8.64e15 range, and timeClip
    // collapses both signs to NaN.
    if microseconds == i64::MAX {
        return f64::INFINITY;
    }
    if microseconds == i64::MIN {
        return f64::NEG_INFINITY;
    }
    let double_microseconds: f64 = microseconds as f64;
    (double_microseconds / US_PER_MS as f64) + POSTGRES_EPOCH_DATE as f64
}

/// `'infinity'` / `'-infinity'` as Postgres emits them for date / timestamp /
/// timestamptz in text format. Returns `Some(±f64::INFINITY)` for those two
/// spellings (case-insensitive), `None` otherwise.
pub fn parse_infinity(bytes: &[u8]) -> Option<f64> {
    if bun_core::strings::eql_case_insensitive_ascii(bytes, b"infinity", true) {
        return Some(f64::INFINITY);
    }
    if bun_core::strings::eql_case_insensitive_ascii(bytes, b"-infinity", true) {
        return Some(f64::NEG_INFINITY);
    }
    None
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
    let parsed = crate::shared::datetime_text::parse_postgres_timestamp(bytes)?;
    global_object
        .gregorian_date_time_to_ms_utc(
            i32::from(parsed.year),
            i32::from(parsed.month),
            i32::from(parsed.day),
            i32::from(parsed.hour),
            i32::from(parsed.minute),
            i32::from(parsed.second),
            // Fractional seconds → milliseconds (JS Date is ms-precision, like
            // the binary path's f64 truncation).
            (parsed.microsecond / 1000) as i32,
        )
        .ok()
}

pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<i64> {
    let double_value = if value.is_date() {
        value.get_unix_timestamp()
    } else if value.is_number() {
        value.as_number()
    } else if value.is_string() {
        let mut str =
            bun_core::OwnedString::new(value.to_bun_string(global_object).expect("unreachable"));
        crate::jsc::bun_string_jsc::parse_date(&mut str, global_object)?
    } else {
        return Ok(0);
    };

    // Round-trip the ±Infinity the decoder produces back to DT_NOEND /
    // DT_NOBEGIN; otherwise `f64::INFINITY as i64` saturates to i64::MAX and
    // the subtract/multiply below overflows.
    if double_value == f64::INFINITY {
        return Ok(i64::MAX);
    }
    if double_value == f64::NEG_INFINITY {
        return Ok(i64::MIN);
    }
    let unix_timestamp: i64 = double_value as i64;
    Ok((unix_timestamp - POSTGRES_EPOCH_DATE) * US_PER_MS)
}
