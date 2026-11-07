//! `Value` union + JSC bridges for MySQL type encoding. Kept separate so the
//! protocol layer keeps the pure `CharacterSet`/`FieldType` enums without
//! `JSValue` references.

use crate::jsc::{
    ErrorCode, JSGlobalObject, JSGlobalObjectSqlExt as _, JSType, JSValue, JsResult,
    MarkedArgumentBuffer, js_error_to_mysql,
};
use bun_core::Utf8Bytes;

use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error;
use bun_sql::mysql::protocol::new_writer::{NewWriter, WriterContext};
use bun_sql::mysql::protocol::prepared_statement::ExecuteParam;

pub(crate) enum Value<'a> {
    Null,
    Bool(bool),
    Int(i32),
    Uint(u32),
    Long(i64),
    Ulong(u64),
    Double(f64),
    String(Utf8Bytes<'static>),
    /// An ArrayBuffer or a view, rooted by the caller. A later parameter's JS can detach or
    /// resize it, so pointer and length are read when the value is written.
    Bytes(&'a JSGlobalObject, JSValue),
    Date(DateTime),
}

impl ExecuteParam for Value<'_> {
    fn field_type(&self) -> FieldType {
        match self {
            Value::Null => FieldType::MYSQL_TYPE_NULL,
            Value::Bool(_) => FieldType::MYSQL_TYPE_TINY,
            Value::Int(_) | Value::Uint(_) => FieldType::MYSQL_TYPE_LONG,
            Value::Long(_) | Value::Ulong(_) => FieldType::MYSQL_TYPE_LONGLONG,
            Value::Double(_) => FieldType::MYSQL_TYPE_DOUBLE,
            // JSON too: MariaDB refuses a parameter declared MYSQL_TYPE_JSON.
            Value::String(_) => FieldType::MYSQL_TYPE_STRING,
            Value::Bytes(..) => FieldType::MYSQL_TYPE_BLOB,
            Value::Date(_) => FieldType::MYSQL_TYPE_DATETIME,
        }
    }

    fn is_unsigned(&self) -> bool {
        matches!(self, Value::Uint(_) | Value::Ulong(_))
    }

    fn write<C: WriterContext>(&self, writer: NewWriter<C>) -> Result<(), any_mysql_error::Error> {
        match self {
            Value::Null => Ok(()),
            Value::Bool(value) => writer.write(&[u8::from(*value)]),
            Value::Int(value) => writer.write(&value.to_le_bytes()),
            Value::Uint(value) => writer.write(&value.to_le_bytes()),
            Value::Long(value) => writer.write(&value.to_le_bytes()),
            Value::Ulong(value) => writer.write(&value.to_le_bytes()),
            Value::Double(value) => writer.write(&value.to_le_bytes()),
            Value::String(value) => writer.write_length_encoded_string(value.slice()),
            Value::Bytes(global_object, value) => {
                let buffer = value.as_array_buffer(global_object).unwrap_or_default();
                writer.write_length_encoded_string(buffer.byte_slice())
            }
            Value::Date(value) => {
                let mut buffer = [0u8; 12];
                writer.write(value.to_binary(&mut buffer))
            }
        }
    }
}

impl<'a> Value<'a> {
    pub(crate) fn from_js(
        global_object: &'a JSGlobalObject,
        value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<Value<'a>, any_mysql_error::Error> {
        Self::convert(global_object, value, roots).map_err(js_error_to_mysql)
    }

    fn convert(
        global_object: &'a JSGlobalObject,
        value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> JsResult<Value<'a>> {
        if value.is_empty_or_undefined_or_null() {
            return Ok(Value::Null);
        }

        if value.is_cell() {
            let tag = value.js_type();
            if tag.is_string_like() {
                return Ok(Value::String(value.to_utf8(global_object)?));
            }

            if tag == JSType::JSDate {
                return Ok(Value::Date(DateTime::from_js(value, global_object)?));
            }

            if tag.is_array_buffer_like() {
                roots.append(value);
                return Ok(Value::Bytes(global_object, value));
            }

            if tag == JSType::HeapBigInt {
                if value.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
                    return Ok(Value::Long(value.to_int64()));
                }
                if value.is_big_int_in_uint64_range(0, u64::MAX) {
                    return Ok(Value::Ulong(value.to_uint64_no_truncate()));
                }
                return Err(global_object
                    .err_out_of_range(format_args!(
                        "The value is out of range. It must be >= {} and <= {}.",
                        i64::MIN,
                        u64::MAX
                    ))
                    .throw());
            }

            // Ban these types:
            if tag == JSType::NumberObject {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Cannot bind NumberObject to query parameter. Use a primitive number instead."
                )));
            }

            if tag == JSType::BooleanObject {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Cannot bind BooleanObject to query parameter. Use a primitive boolean instead."
                )));
            }

            if tag.is_function() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Cannot bind a function to query parameter"
                )));
            }

            // It's something internal
            if !tag.is_indexable() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Cannot bind this type to query parameter"
                )));
            }

            // We will JSON.stringify anything else.
            let json = value.json_stringify_fast(global_object)?;
            if json.is_empty() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Cannot bind an object whose JSON is undefined to query parameter"
                )));
            }
            return Ok(Value::String(json.into_utf8()));
        }

        if value.is_number() {
            let number = value.as_number();
            let is_safe_integer =
                number.trunc() == number && number.abs() <= bun_jsc::MAX_SAFE_INTEGER as f64;
            // -0 stays a double, an integer type would drop its sign
            if !is_safe_integer || (number == 0.0 && number.is_sign_negative()) {
                return Ok(Value::Double(number));
            }
            let int = number as i64;
            return Ok(if let Ok(int) = i32::try_from(int) {
                Value::Int(int)
            } else if let Ok(int) = u32::try_from(int) {
                Value::Uint(int)
            } else {
                Value::Long(int)
            });
        }

        Ok(Value::Bool(value.to_boolean()))
    }
}

#[derive(Default, Clone, Copy)]
pub struct DateTime {
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    microsecond: u32,
}

impl DateTime {
    /// `val` is 4, 7 or 11 bytes long.
    pub(crate) fn from_binary(val: &[u8]) -> DateTime {
        match val.len() {
            4 => {
                // Byte 1: [year LSB]     (8 bits of year)
                // Byte 2: [year MSB]     (8 bits of year)
                // Byte 3: [month]        (8-bit unsigned integer, 1-12)
                // Byte 4: [day]          (8-bit unsigned integer, 1-31)
                DateTime {
                    year: u16::from_le_bytes(
                        val[0..2].try_into().expect("infallible: size matches"),
                    ),
                    month: val[2],
                    day: val[3],
                    ..Default::default()
                }
            }
            7 => {
                //                     Byte 1: [year LSB]     (8 bits of year)
                // Byte 2: [year MSB]     (8 bits of year)
                // Byte 3: [month]        (8-bit unsigned integer, 1-12)
                // Byte 4: [day]          (8-bit unsigned integer, 1-31)
                // Byte 5: [hour]         (8-bit unsigned integer, 0-23)
                // Byte 6: [minute]       (8-bit unsigned integer, 0-59)
                // Byte 7: [second]       (8-bit unsigned integer, 0-59)
                DateTime {
                    year: u16::from_le_bytes(
                        val[0..2].try_into().expect("infallible: size matches"),
                    ),
                    month: val[2],
                    day: val[3],
                    hour: val[4],
                    minute: val[5],
                    second: val[6],
                    ..Default::default()
                }
            }
            11 => {
                //                     Byte 1:    [year LSB]      (8 bits of year)
                // Byte 2:    [year MSB]      (8 bits of year)
                // Byte 3:    [month]         (8-bit unsigned integer, 1-12)
                // Byte 4:    [day]           (8-bit unsigned integer, 1-31)
                // Byte 5:    [hour]          (8-bit unsigned integer, 0-23)
                // Byte 6:    [minute]        (8-bit unsigned integer, 0-59)
                // Byte 7:    [second]        (8-bit unsigned integer, 0-59)
                // Byte 8-11: [microseconds]  (32-bit little-endian unsigned integer
                DateTime {
                    year: u16::from_le_bytes(
                        val[0..2].try_into().expect("infallible: size matches"),
                    ),
                    month: val[2],
                    day: val[3],
                    hour: val[4],
                    minute: val[5],
                    second: val[6],
                    microsecond: u32::from_le_bytes(
                        val[7..11].try_into().expect("infallible: size matches"),
                    ),
                }
            }
            _ => panic!("Invalid datetime length: {}", val.len()),
        }
    }

    /// Parse a MySQL text-protocol DATE/DATETIME/TIMESTAMP string
    /// (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`, or with `.ffffff` fractional
    /// seconds) into components so the text path can treat them as UTC, the
    /// same way the binary path does. Returns `None` for MySQL zero-date
    /// sentinels (`0000-00-00`), impossible calendar values (`2024-02-31`), and
    /// malformed input, so the caller surfaces `Invalid Date` — matching what
    /// the previous `Date.parse` path produced for those.
    pub(crate) fn from_text(text: &[u8]) -> Option<DateTime> {
        let parsed = crate::shared::datetime_text::parse_mysql(text)?;
        let year = u16::try_from(parsed.year).ok()?;
        if parsed.month < 1
            || parsed.month > 12
            || parsed.day < 1
            || parsed.day > days_in_month(year, parsed.month)
            || parsed.hour > 23
            || parsed.minute > 59
            || parsed.second > 59
        {
            return None;
        }
        Some(DateTime {
            year,
            month: parsed.month,
            day: parsed.day,
            hour: parsed.hour,
            minute: parsed.minute,
            second: parsed.second,
            microsecond: parsed.microsecond,
        })
    }

    fn to_binary<'b>(&self, buffer: &'b mut [u8; 12]) -> &'b [u8] {
        buffer[0] = if self.microsecond == 0 { 7 } else { 11 };
        buffer[1..3].copy_from_slice(&self.year.to_le_bytes());
        buffer[3] = self.month;
        buffer[4] = self.day;
        buffer[5] = self.hour;
        buffer[6] = self.minute;
        buffer[7] = self.second;
        buffer[8..12].copy_from_slice(&self.microsecond.to_le_bytes());
        &buffer[..1 + buffer[0] as usize]
    }

    pub(crate) fn to_js_timestamp(&self, global_object: &JSGlobalObject) -> JsResult<f64> {
        // MySQL in permissive sql_mode can store zero / partial-zero dates like
        // "0000-00-00" or "2024-00-15" and send them over the binary protocol.
        // WTF::GregorianDateTime would silently wrap month=0 to December of the
        // prior year, so validate here and surface NaN instead — matching the
        // Invalid Date the text path produces via from_text().
        if self.month < 1
            || self.month > 12
            || self.day < 1
            || self.day > days_in_month(self.year, self.month)
            || self.hour > 23
            || self.minute > 59
            || self.second > 59
        {
            return Ok(f64::NAN);
        }
        // from_js() breaks a Date's epoch into UTC fields, so decode must also
        // treat the stored wall-clock as UTC.
        global_object.gregorian_date_time_to_ms_utc(
            i32::from(self.year),
            i32::from(self.month),
            i32::from(self.day),
            i32::from(self.hour),
            i32::from(self.minute),
            i32::from(self.second),
            if self.microsecond > 0 {
                (self.microsecond / 1000) as i32
            } else {
                0
            },
        )
    }

    fn from_js(value: JSValue, global_object: &JSGlobalObject) -> JsResult<DateTime> {
        let ms = value.get_unix_timestamp();
        if !ms.is_finite() {
            return Err(global_object
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Cannot bind an Invalid Date to query parameter"),
                )
                .throw());
        }
        let date = global_object.ms_to_gregorian_date_time_utc(ms);
        let Some(year) = u16::try_from(date.year).ok().filter(|year| *year <= 9999) else {
            return Err(global_object
                .err_out_of_range(format_args!(
                    "MySQL DATETIME value must be between 0000-01-01 and 9999-12-31"
                ))
                .throw());
        };
        Ok(DateTime {
            year,
            month: date.month as u8,
            day: date.day as u8,
            hour: date.hour as u8,
            minute: date.minute as u8,
            second: date.second as u8,
            microsecond: ms.rem_euclid(1000.0) as u32 * 1000,
        })
    }
}

#[derive(Default, Clone, Copy)]
pub struct Time {
    pub(crate) negative: bool,
    pub(crate) days: u32,
    pub(crate) hours: u8,
    pub(crate) minutes: u8,
    pub(crate) seconds: u8,
    pub(crate) microseconds: u32,
}

impl Time {
    /// `val` is 0, 8 or 12 bytes long.
    pub(crate) fn from_binary(val: &[u8]) -> Time {
        if val.is_empty() {
            return Time::default();
        }

        let mut time = Time::default();
        if val.len() >= 8 {
            time.negative = val[0] != 0;
            time.days = u32::from_le_bytes(val[1..5].try_into().expect("infallible: size matches"));
            time.hours = val[5];
            time.minutes = val[6];
            time.seconds = val[7];
        }

        if val.len() > 8 {
            time.microseconds =
                u32::from_le_bytes(val[8..12].try_into().expect("infallible: size matches"));
        }

        time
    }
}

// Helper functions for date calculations
fn is_leap_year(year: u16) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

fn days_in_month(year: u16, month: u8) -> u8 {
    const DAYS: [u8; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if month == 2 && is_leap_year(year) {
        return 29;
    }
    DAYS[month as usize - 1]
}
