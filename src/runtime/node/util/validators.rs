use core::fmt;

use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult};
use bun_str::ZigString;

pub fn get_type_name(global_object: &JSGlobalObject, value: JSValue) -> ZigString {
    let js_type = value.js_type();
    if js_type.is_array() {
        return *ZigString::static_(b"array");
    }
    value.js_type_string(global_object).get_zig_string(global_object)
}

#[cold]
pub fn throw_err_invalid_arg_value(
    global_this: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsError {
    // TODO(port): exact shape of `global.ERR(code, fmt, args).throw()` builder API
    global_this.err(jsc::node::ErrorCode::INVALID_ARG_VALUE, args).throw()
}

#[cold]
pub fn throw_err_invalid_arg_type_with_message(
    global_this: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsError {
    // TODO(port): exact shape of `global.ERR(code, fmt, args).throw()` builder API
    global_this.err(jsc::node::ErrorCode::INVALID_ARG_TYPE, args).throw()
}

// PORT NOTE: Zig took `comptime name_fmt: string, name_args: anytype` and did
// comptime string concatenation (`"The \"" ++ name_fmt ++ "\" ..."`) plus tuple
// concatenation (`name_args ++ .{expected_type, actual_type}`). Rust cannot
// concat a caller-supplied format string at compile time, so callers pass the
// already-formatted name as `fmt::Arguments` and we embed it via `{}`.
#[cold]
pub fn throw_err_invalid_arg_type(
    global_this: &JSGlobalObject,
    name: fmt::Arguments<'_>,
    expected_type: &'static str,
    value: JSValue,
) -> JsError {
    let actual_type = get_type_name(global_this, value);
    throw_err_invalid_arg_type_with_message(
        global_this,
        format_args!(
            "The \"{}\" property must be of type {}, got {}",
            name, expected_type, actual_type
        ),
    )
}

#[cold]
pub fn throw_range_error(global_this: &JSGlobalObject, args: fmt::Arguments<'_>) -> JsError {
    // TODO(port): exact shape of `global.ERR(code, fmt, args).throw()` builder API
    global_this.err(jsc::node::ErrorCode::OUT_OF_RANGE, args).throw()
}

// PORT NOTE: Zig had `comptime min_value: ?i64, comptime max_value: ?i64` with a
// `comptime { @compileError }` bounds check. `Option<i64>` is not a valid const-
// generic type on stable, so demoted to runtime params + debug_assert.
// PERF(port): was comptime monomorphization — profile in Phase B.
pub fn validate_integer(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &[u8],
    min_value: Option<i64>,
    max_value: Option<i64>,
) -> JsResult<i64> {
    if !value.is_number() {
        return Err(global_this.throw_invalid_argument_type_value(name, b"number", value));
    }

    if !value.is_integer() {
        return Err(global_this.throw_range_error_msg(value.as_number(), name, b"an integer"));
    }

    if let Some(min) = min_value {
        debug_assert!(
            min >= jsc::MIN_SAFE_INTEGER,
            "min_value must be greater than or equal to jsc::MIN_SAFE_INTEGER"
        );
    }
    if let Some(max) = max_value {
        debug_assert!(
            max <= jsc::MAX_SAFE_INTEGER,
            "max_value must be less than or equal to jsc::MAX_SAFE_INTEGER"
        );
    }

    let min: f64 = min_value.unwrap_or(jsc::MIN_SAFE_INTEGER) as f64;
    let max: f64 = max_value.unwrap_or(jsc::MAX_SAFE_INTEGER) as f64;

    let num = value.as_number();

    if num < min || num > max {
        return Err(global_this.throw_range_error_min_max(num, name, min as i64, max as i64));
    }

    Ok(num as i64)
}

pub fn validate_integer_or_big_int(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &[u8],
    min_value: Option<i64>,
    max_value: Option<i64>,
) -> JsResult<i64> {
    let min = min_value.unwrap_or(jsc::MIN_SAFE_INTEGER);
    let max = max_value.unwrap_or(jsc::MAX_SAFE_INTEGER);

    if value.is_big_int() {
        let num = value.to::<i64>();
        if num < min || num > max {
            return Err(global_this.throw_range_error_min_max(num, name, min, max));
        }
        return Ok(num);
    }

    if !value.is_number() {
        return Err(global_this.throw_invalid_argument_type_value(name, b"number", value));
    }

    let num = value.as_number();

    if !value.is_any_int() {
        return Err(global_this.throw_range_error_msg(num, name, b"an integer"));
    }

    let int = value.as_int52();
    if int < min || int > max {
        return Err(global_this.throw_range_error_min_max(int, name, min, max));
    }
    Ok(int)
}

pub fn validate_int32(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
    min_value: Option<i32>,
    max_value: Option<i32>,
) -> JsResult<i32> {
    let min = min_value.unwrap_or(i32::MIN);
    let max = max_value.unwrap_or(i32::MAX);
    // The defaults for min and max correspond to the limits of 32-bit integers.
    if !value.is_number() {
        return Err(throw_err_invalid_arg_type(global_this, name, "number", value));
    }
    if !value.is_any_int() {
        let formatter = jsc::ConsoleObject::Formatter::new(global_this);
        return Err(throw_range_error(
            global_this,
            format_args!(
                "The value of \"{}\" is out of range. It must be an integer. Received {}",
                name,
                value.to_fmt(&formatter)
            ),
        ));
    }
    let num = value.as_number();
    // Use floating point comparison here to ensure values out of i32 range get caught instead of clamp/truncated.
    if num < (min as f64) || num > (max as f64) {
        let formatter = jsc::ConsoleObject::Formatter::new(global_this);
        return Err(throw_range_error(
            global_this,
            format_args!(
                "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                name,
                min,
                max,
                value.to_fmt(&formatter)
            ),
        ));
    }
    Ok(num as i32)
}

pub fn validate_uint32(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
    greater_than_zero: bool,
) -> JsResult<u32> {
    if !value.is_number() {
        return Err(throw_err_invalid_arg_type(global_this, name, "number", value));
    }
    if !value.is_any_int() {
        let formatter = jsc::ConsoleObject::Formatter::new(global_this);
        return Err(throw_range_error(
            global_this,
            format_args!(
                "The value of \"{}\" is out of range. It must be an integer. Received {}",
                name,
                value.to_fmt(&formatter)
            ),
        ));
    }
    let num: i64 = value.as_int52();
    let min: i64 = if greater_than_zero { 1 } else { 0 };
    let max: i64 = i64::from(u32::MAX);
    if num < min || num > max {
        let formatter = jsc::ConsoleObject::Formatter::new(global_this);
        return Err(throw_range_error(
            global_this,
            format_args!(
                "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                name,
                min,
                max,
                value.to_fmt(&formatter)
            ),
        ));
    }
    // Zig: @truncate(@as(u63, @intCast(num))) — bounds check above guarantees 0..=u32::MAX.
    Ok(num as u32)
}

pub fn validate_string(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<()> {
    if !value.is_string() {
        return Err(throw_err_invalid_arg_type(global_this, name, "string", value));
    }
    Ok(())
}

pub fn validate_number(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &[u8],
    maybe_min: Option<f64>,
    maybe_max: Option<f64>,
) -> JsResult<f64> {
    if !value.is_number() {
        return Err(global_this.throw_invalid_argument_type_value(name, b"number", value));
    }

    let num: f64 = value.as_number();
    let mut valid = true;
    if let Some(min) = maybe_min {
        if num < min {
            valid = false;
        }
    }
    if let Some(max) = maybe_max {
        if num > max {
            valid = false;
        }
    }
    if (maybe_min.is_some() || maybe_max.is_some()) && num.is_nan() {
        valid = false;
    }
    if !valid {
        let name = bstr::BStr::new(name);
        if let (Some(min), Some(max)) = (maybe_min, maybe_max) {
            return Err(throw_range_error(
                global_this,
                format_args!(
                    "The value of \"{}\" is out of range. It must be >= {} && <= {}. Received {}",
                    name, min, max, num
                ),
            ));
        } else if let Some(min) = maybe_min {
            return Err(throw_range_error(
                global_this,
                format_args!(
                    "The value of \"{}\" is out of range. It must be >= {}. Received {}",
                    name, min, num
                ),
            ));
        } else if let Some(max) = maybe_max {
            return Err(throw_range_error(
                global_this,
                format_args!(
                    "The value of \"{}\" is out of range. It must be <= {}. Received {}",
                    name, max, num
                ),
            ));
        }
    }
    Ok(num)
}

pub fn validate_boolean(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<bool> {
    if !value.is_boolean() {
        return Err(throw_err_invalid_arg_type(global_this, name, "boolean", value));
    }
    Ok(value.as_boolean())
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct ValidateObjectOptions: u8 {
        const ALLOW_NULLABLE = 1 << 0;
        const ALLOW_ARRAY    = 1 << 1;
        const ALLOW_FUNCTION = 1 << 2;
    }
}

impl ValidateObjectOptions {
    #[inline]
    pub fn allow_nullable(self) -> bool {
        self.contains(Self::ALLOW_NULLABLE)
    }
    #[inline]
    pub fn allow_array(self) -> bool {
        self.contains(Self::ALLOW_ARRAY)
    }
    #[inline]
    pub fn allow_function(self) -> bool {
        self.contains(Self::ALLOW_FUNCTION)
    }
}

// PERF(port): `options` was `comptime` in Zig (monomorphized per call site) — profile in Phase B.
pub fn validate_object(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
    options: ValidateObjectOptions,
) -> JsResult<()> {
    if !options.allow_nullable() && !options.allow_array() && !options.allow_function() {
        if value.is_null() || value.js_type().is_array() {
            return Err(throw_err_invalid_arg_type(global_this, name, "object", value));
        }

        if !value.is_object() {
            return Err(throw_err_invalid_arg_type(global_this, name, "object", value));
        }
    } else {
        if !options.allow_nullable() && value.is_null() {
            return Err(throw_err_invalid_arg_type(global_this, name, "object", value));
        }

        if !options.allow_array() && value.js_type().is_array() {
            return Err(throw_err_invalid_arg_type(global_this, name, "object", value));
        }

        if !value.is_object() && (!options.allow_function() || !value.js_type().is_function()) {
            return Err(throw_err_invalid_arg_type(global_this, name, "object", value));
        }
    }
    Ok(())
}

pub fn validate_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
    min_length: Option<i32>,
) -> JsResult<()> {
    if !value.js_type().is_array() {
        let actual_type = get_type_name(global_this, value);
        return Err(throw_err_invalid_arg_type_with_message(
            global_this,
            format_args!(
                "The \"{}\" property must be an instance of Array, got {}",
                name, actual_type
            ),
        ));
    }
    if let Some(min_length) = min_length {
        // TODO(port): Zig compared `usize < ?i32` (peer-type widened); cast to match.
        if (value.get_length(global_this) as i64) < i64::from(min_length) {
            return Err(throw_err_invalid_arg_value(
                global_this,
                format_args!("{} must be longer than {}", name, min_length),
            ));
        }
    }
    Ok(())
}

pub fn validate_string_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<usize> {
    validate_array(global_this, value, name, None)?;
    let mut i: usize = 0;
    let mut iter = value.array_iterator(global_this)?;
    while let Some(item) = iter.next()? {
        if !item.is_string() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                format_args!("{}[{}]", name, i),
                "string",
                value,
            ));
        }
        i += 1;
    }
    Ok(i)
}

pub fn validate_boolean_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<usize> {
    validate_array(global_this, value, name, None)?;
    let mut i: usize = 0;
    let mut iter = value.array_iterator(global_this)?;
    while let Some(item) = iter.next()? {
        if !item.is_boolean() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                format_args!("{}[{}]", name, i),
                "boolean",
                value,
            ));
        }
        i += 1;
    }
    Ok(i)
}

pub fn validate_function(
    global: &JSGlobalObject,
    name: &[u8],
    value: JSValue,
) -> JsResult<JSValue> {
    if !value.is_function() {
        return Err(global.throw_invalid_argument_type_value(name, b"function", value));
    }
    Ok(value)
}

pub fn validate_undefined(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<()> {
    if !value.is_undefined() {
        return Err(throw_err_invalid_arg_type(global_this, name, "undefined", value));
    }
    Ok(())
}

/// Zig used `@typeInfo(T).@"enum".fields` to iterate variants and match by
/// `@tagName`. Rust has no field reflection; enums opt in via this trait.
/// Implementors should typically `#[derive(strum::EnumString, strum::VariantNames)]`
/// and provide `VALUES_INFO` as the `|`-joined variant names.
// TODO(port): consider a `#[derive(StringEnum)]` proc-macro to generate this.
pub trait StringEnum: Sized {
    /// `|`-joined list of variant names (matches Zig's comptime-built `values_info`).
    const VALUES_INFO: &'static str;
    /// Match `s` against variant names exactly (Zig: `str.eqlComptime(field.name)`).
    fn from_bun_string(s: &bun_str::String) -> Option<Self>;
}

pub fn validate_string_enum<T: StringEnum>(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: fmt::Arguments<'_>,
) -> JsResult<T> {
    let str = value.to_bun_string(global_this)?;
    // `str` drops (derefs) at scope exit — Zig had `defer str.deref()`.
    if let Some(v) = T::from_bun_string(&str) {
        return Ok(v);
    }

    Err(throw_err_invalid_arg_type_with_message(
        global_this,
        format_args!("{} must be one of: {}", name, T::VALUES_INFO),
    ))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/util/validators.zig (301 lines)
//   confidence: medium
//   todos:      5
//   notes:      comptime fmt-string concat reshaped to fmt::Arguments; ERR()/throwRangeError JSGlobalObject method shapes guessed; validateStringEnum needs StringEnum trait impls per enum
// ──────────────────────────────────────────────────────────────────────────
