use crate::jsc::JSValue;

/// The number as an `i64` when an integer parameter carries it exactly: a
/// safe integer (`Number.isSafeInteger`) other than `-0`. Every other value
/// binds as a double. `JSValue::is_any_int()` is JSC's Int52 test, which ends
/// at ±2^51, so it is too narrow to decide this.
pub(crate) fn safe_integer(value: JSValue) -> Option<i64> {
    if value.is_int32() {
        return Some(i64::from(value.as_int32()));
    }
    if !value.is_double() {
        return None;
    }
    let number = value.as_double();
    if number.trunc() != number
        || number.abs() > bun_jsc::MAX_SAFE_INTEGER as f64
        || (number == 0.0 && number.is_sign_negative())
    {
        return None;
    }
    Some(number as i64)
}
