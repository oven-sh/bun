use core::fmt;

use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult};

#[cold]
pub(crate) fn throw_err_invalid_arg_value(
    global_this: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsError {
    global_this
        .err(jsc::ErrorCode::INVALID_ARG_VALUE, args)
        .throw()
}

#[cold]
pub(crate) fn throw_err_invalid_arg_type_with_message(
    global_this: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsError {
    global_this
        .err(jsc::ErrorCode::INVALID_ARG_TYPE, args)
        .throw()
}

// Callers pass the
// already-formatted name as anything `Display`-able (e.g. `&str` or
// `format_args!(...)`) and we embed it via `{}`.
#[cold]
pub(crate) fn throw_err_invalid_arg_type(
    global_this: &JSGlobalObject,
    name: impl fmt::Display,
    expected_type: &str,
    value: JSValue,
) -> JsError {
    let actual_type = value.type_name(global_this);
    throw_err_invalid_arg_type_with_message(
        global_this,
        format_args!(
            "The \"{}\" property must be of type {}, got {}",
            name, expected_type, actual_type
        ),
    )
}

#[inline]
pub(crate) fn throw_range_error_msg(
    global_this: &JSGlobalObject,
    value: f64,
    name: &str,
    msg: &[u8],
) -> JsError {
    global_this.throw_range_error(
        bun_core::fmt::NodeNumber(value),
        jsc::RangeErrorOptions {
            field_name: name.as_bytes(),
            msg,
            ..Default::default()
        },
    )
}

// `Option<i64>` is not a valid const-generic type on stable, so the bounds
// are runtime params + debug_assert.
pub(crate) fn validate_integer(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &str,
    min_value: Option<i64>,
    max_value: Option<i64>,
) -> JsResult<i64> {
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
    let min = min_value.unwrap_or(jsc::MIN_SAFE_INTEGER) as f64;
    let max = max_value.unwrap_or(jsc::MAX_SAFE_INTEGER) as f64;
    validate_integral(global_this, value, name, min, max).map(|num| num as i64)
}

pub(crate) fn validate_int32(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &str,
    min_value: Option<i32>,
    max_value: Option<i32>,
) -> JsResult<i32> {
    // The defaults for min and max correspond to the limits of 32-bit integers.
    let min = min_value.unwrap_or(i32::MIN);
    let max = max_value.unwrap_or(i32::MAX);
    validate_integral(global_this, value, name, f64::from(min), f64::from(max))
        .map(|num| num as i32)
}

pub(crate) fn validate_uint32(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &str,
    greater_than_zero: bool,
) -> JsResult<u32> {
    let min = if greater_than_zero { 1.0 } else { 0.0 };
    validate_integral(global_this, value, name, min, f64::from(u32::MAX)).map(|num| num as u32)
}

/// `Number.isInteger`, so -0 and integers beyond 2 ** 53 are integers, which the range then rejects.
fn validate_integral(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: &str,
    min: f64,
    max: f64,
) -> JsResult<f64> {
    if !value.is_number() {
        return Err(global_this.throw_invalid_argument_type_value(name, "number", value));
    }
    let num = value.as_number();
    if !value.is_integer() {
        return Err(throw_range_error_msg(global_this, num, name, b"an integer"));
    }
    if num < min || num > max {
        let range = format!(">= {min} && <= {max}");
        return Err(throw_range_error_msg(
            global_this,
            num,
            name,
            range.as_bytes(),
        ));
    }
    Ok(num)
}

pub(crate) fn validate_string(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display,
) -> JsResult<()> {
    if !value.is_string() {
        return Err(throw_err_invalid_arg_type(
            global_this,
            name,
            "string",
            value,
        ));
    }
    Ok(())
}

pub(crate) fn validate_boolean(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display,
) -> JsResult<bool> {
    if !value.is_boolean() {
        return Err(throw_err_invalid_arg_type(
            global_this,
            name,
            "boolean",
            value,
        ));
    }
    Ok(value.as_boolean())
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct ValidateObjectOptions: u8 {
        const ALLOW_NULLABLE = 1 << 0;
        const ALLOW_ARRAY    = 1 << 1;
        const ALLOW_FUNCTION = 1 << 2;
    }
}

impl ValidateObjectOptions {
    #[inline]
    fn allow_nullable(self) -> bool {
        self.contains(Self::ALLOW_NULLABLE)
    }
    #[inline]
    fn allow_array(self) -> bool {
        self.contains(Self::ALLOW_ARRAY)
    }
    #[inline]
    fn allow_function(self) -> bool {
        self.contains(Self::ALLOW_FUNCTION)
    }
}

pub(crate) fn validate_object(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display + Copy,
    options: ValidateObjectOptions,
) -> JsResult<()> {
    if !options.allow_nullable() && !options.allow_array() && !options.allow_function() {
        if value.is_null() || value.js_type().is_array() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                name,
                "object",
                value,
            ));
        }

        if !value.is_object() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                name,
                "object",
                value,
            ));
        }
    } else {
        if !options.allow_nullable() && value.is_null() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                name,
                "object",
                value,
            ));
        }

        if !options.allow_array() && value.js_type().is_array() {
            return Err(throw_err_invalid_arg_type(
                global_this,
                name,
                "object",
                value,
            ));
        }

        if !value.is_object() && (!options.allow_function() || !value.js_type().is_function()) {
            return Err(throw_err_invalid_arg_type(
                global_this,
                name,
                "object",
                value,
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display + Copy,
    min_length: Option<i32>,
) -> JsResult<()> {
    if !value.js_type().is_array() {
        let actual_type = value.type_name(global_this);
        return Err(throw_err_invalid_arg_type_with_message(
            global_this,
            format_args!(
                "The \"{}\" property must be an instance of Array, got {}",
                name, actual_type
            ),
        ));
    }
    if let Some(min_length) = min_length {
        if (value.get_length(global_this)? as i64) < i64::from(min_length) {
            return Err(throw_err_invalid_arg_value(
                global_this,
                format_args!("{} must be longer than {}", name, min_length),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_string_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display + Copy,
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

pub(crate) fn validate_boolean_array(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display + Copy,
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

pub(crate) fn validate_function(
    global: &JSGlobalObject,
    name: &str,
    value: JSValue,
) -> JsResult<JSValue> {
    if !value.is_function() {
        return Err(global.throw_invalid_argument_type_value(name, "function", value));
    }
    Ok(value)
}

/// Rust has no field reflection; enums opt in via this trait.
/// Implementors should typically `#[derive(strum::EnumString, strum::VariantNames)]`
/// and provide `VALUES_INFO` as the `|`-joined variant names.
pub(crate) trait StringEnum: Sized {
    /// `|`-joined list of variant names.
    const VALUES_INFO: &'static str;
    /// Match `s` against variant names exactly.
    fn from_bun_string(s: &bun_core::String) -> Option<Self>;
}

pub(crate) fn validate_string_enum<T: StringEnum>(
    global_this: &JSGlobalObject,
    value: JSValue,
    name: impl fmt::Display,
) -> JsResult<T> {
    let str = value.to_bun_string(global_this)?;
    if let Some(v) = T::from_bun_string(&str) {
        return Ok(v);
    }

    Err(throw_err_invalid_arg_type_with_message(
        global_this,
        format_args!("{} must be one of: {}", name, T::VALUES_INFO),
    ))
}
