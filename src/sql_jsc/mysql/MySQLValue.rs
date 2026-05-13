//! `Value` union + JSC bridges for MySQL type encoding. Split from
//! `sql/mysql/MySQLTypes.zig` so the protocol layer keeps the pure
//! `CharacterSet`/`FieldType` enums without `JSValue` references.

use crate::jsc::{
    IntegerRange, JSGlobalObject, JSGlobalObjectSqlExt as _, JSType, JSValue, JsError, JsResult,
    MarkedArgumentBuffer, StringJsc as _, bun_string_jsc, js_error_to_mysql,
};
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_core::{OwnedString, String as BunString};

use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error;
use bun_sql::shared::Data;

use crate::jsc::webcore::Blob;

pub fn field_type_from_js(
    global_object: &JSGlobalObject,
    value: JSValue,
    unsigned: &mut bool,
) -> JsResult<FieldType> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(FieldType::MYSQL_TYPE_NULL);
    }

    if value.is_cell() {
        let tag = value.js_type();
        if tag.is_string_like() {
            return Ok(FieldType::MYSQL_TYPE_STRING);
        }

        if tag == JSType::JSDate {
            return Ok(FieldType::MYSQL_TYPE_DATETIME);
        }

        if tag.is_typed_array_or_array_buffer() {
            return Ok(FieldType::MYSQL_TYPE_BLOB);
        }

        if tag == JSType::HeapBigInt {
            if value.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
                return Ok(FieldType::MYSQL_TYPE_LONGLONG);
            }
            if value.is_big_int_in_uint64_range(0, u64::MAX) {
                *unsigned = true;
                return Ok(FieldType::MYSQL_TYPE_LONGLONG);
            }
            return Err(global_object
                .err_out_of_range(format_args!(
                    "The value is out of range. It must be >= {} and <= {}.",
                    i64::MIN,
                    u64::MAX
                ))
                .throw());
        }

        if global_object.has_exception() {
            return Err(JsError::Thrown);
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

        // It's something internal
        if !tag.is_indexable() {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "Cannot bind this type to query parameter"
            )));
        }

        // We will JSON.stringify anything else.
        if tag.is_object() {
            return Ok(FieldType::MYSQL_TYPE_JSON);
        }
    }

    if value.is_any_int() {
        let int = value.to_int64();

        if int >= 0 {
            if int <= i32::MAX as i64 {
                return Ok(FieldType::MYSQL_TYPE_LONG);
            }
            if int <= u32::MAX as i64 {
                *unsigned = true;
                return Ok(FieldType::MYSQL_TYPE_LONG);
            }
            if int >= i64::MAX {
                *unsigned = true;
                return Ok(FieldType::MYSQL_TYPE_LONGLONG);
            }
            return Ok(FieldType::MYSQL_TYPE_LONGLONG);
        }
        if int >= i32::MIN as i64 {
            return Ok(FieldType::MYSQL_TYPE_LONG);
        }
        return Ok(FieldType::MYSQL_TYPE_LONGLONG);
    }

    if value.is_number() {
        return Ok(FieldType::MYSQL_TYPE_DOUBLE);
    }

    if value.is_boolean() {
        return Ok(FieldType::MYSQL_TYPE_TINY);
    }

    Ok(FieldType::MYSQL_TYPE_VARCHAR)
}

pub enum Value {
    Null,
    Bool(bool),
    Short(i16),
    Ushort(u16),
    Int(i32),
    Uint(u32),
    Long(i64),
    Ulong(u64),
    Float(f32),
    Double(f64),

    String(ZigStringSlice),
    StringData(Data),
    Bytes(Bytes),
    BytesData(Data),
    Date(DateTime),
    Time(Time),
    // Decimal(Decimal),
}

/// BLOB parameter bytes. `MySQLQuery.bind()` fills every `Value` before
/// `execute.write()` reads any of them, and converting later parameters
/// can run user JS (array index getters, toJSON, toString coercion). That
/// JS could `transfer()`/detach an earlier ArrayBuffer, or drop the last
/// JS reference to it and force GC, while we still hold a borrowed slice
/// into it. Pinning the backing `ArrayBuffer` makes it non-detachable for
/// the duration (`transfer()` then hands the user a copy), and the
/// caller's stack-scoped `MarkedArgumentBuffer` roots the wrapper so GC
/// can't sweep the cell whose `RefPtr<ArrayBuffer>` keeps the storage
/// alive — `params` is on the malloc heap and isn't scanned. `Drop`
/// unpins.
pub struct Bytes {
    pub slice: ZigStringSlice,
    /// JS ArrayBuffer/view to `unpinArrayBuffer` in `Drop`. `JSValue::ZERO`
    /// when the slice is owned (FastTypedArray dupe), borrowed from a
    /// Blob store (nothing to unpin), or empty. GC rooting of this value
    /// is the caller's responsibility via the `MarkedArgumentBuffer`
    /// passed to `from_js`.
    pub pinned: JSValue,
}

impl Default for Bytes {
    fn default() -> Self {
        Self {
            slice: ZigStringSlice::empty(),
            pinned: JSValue::ZERO,
        }
    }
}

impl Drop for Bytes {
    fn drop(&mut self) {
        if !self.pinned.is_empty() {
            // `pinned` is rooted by the caller's MarkedArgumentBuffer for the
            // lifetime of this Value (see struct doc); the FFI itself is `safe fn`.
            JSC__JSValue__unpinArrayBuffer(self.pinned);
        }
        // self.slice dropped automatically
    }
}

// Value's Zig `deinit` only forwarded to payload deinit; Rust auto-drops enum
// payloads (ZigStringSlice, Bytes, Data all impl Drop), so no explicit Drop.

impl Value {
    pub fn to_data(&self, field_type: FieldType) -> Result<Data, any_mysql_error::Error> {
        let mut buffer = [0u8; 15]; // Large enough for all fixed-size types
        let mut pos: usize = 0;
        match self {
            Value::Null => return Ok(Data::Empty),
            Value::Bool(b) => {
                buffer[0] = if *b { 1 } else { 0 };
                pos = 1;
            }
            Value::Short(s) => {
                buffer[0..2].copy_from_slice(&s.to_le_bytes());
                pos = 2;
            }
            Value::Ushort(s) => {
                buffer[0..2].copy_from_slice(&s.to_le_bytes());
                pos = 2;
            }
            Value::Int(i) => {
                buffer[0..4].copy_from_slice(&i.to_le_bytes());
                pos = 4;
            }
            Value::Uint(i) => {
                buffer[0..4].copy_from_slice(&i.to_le_bytes());
                pos = 4;
            }
            Value::Long(l) => {
                buffer[0..8].copy_from_slice(&l.to_le_bytes());
                pos = 8;
            }
            Value::Ulong(l) => {
                buffer[0..8].copy_from_slice(&l.to_le_bytes());
                pos = 8;
            }
            Value::Float(f) => {
                buffer[0..4].copy_from_slice(&f.to_bits().to_le_bytes());
                pos = 4;
            }
            Value::Double(d) => {
                buffer[0..8].copy_from_slice(&d.to_bits().to_le_bytes());
                pos = 8;
            }
            Value::Date(d) => {
                pos = d.to_binary(field_type, &mut buffer) as usize;
            }
            Value::Time(d) => {
                pos = d.to_binary(field_type, &mut buffer) as usize;
            }
            // Value::Decimal(dec) => return dec.to_binary(field_type),
            Value::StringData(data) | Value::BytesData(data) => {
                // TODO(port): Zig returned `data` by value (copy of Data union);
                // `bun_sql::shared::Data` is not `Clone` in the Rust port, so
                // return a `Temporary` aliasing the same bytes. `to_data` callers
                // must keep `self` alive until the returned `Data` is consumed.
                let s = data.slice();
                return Ok(if s.is_empty() {
                    Data::Empty
                } else {
                    Data::Temporary(bun_ptr::RawSlice::new(s))
                });
            }
            Value::String(slice) => {
                let s = slice.slice();
                return Ok(if s.is_empty() {
                    Data::Empty
                } else {
                    Data::Temporary(bun_ptr::RawSlice::new(s))
                });
            }
            Value::Bytes(b) => {
                let s = b.slice.slice();
                return Ok(if s.is_empty() {
                    Data::Empty
                } else {
                    Data::Temporary(bun_ptr::RawSlice::new(s))
                });
            }
        }

        Data::create(&buffer[0..pos]).map_err(|_| any_mysql_error::Error::OutOfMemory)
    }

    pub fn from_js(
        value: JSValue,
        global_object: &JSGlobalObject,
        field_type: FieldType,
        unsigned: bool,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<Value, any_mysql_error::Error> {
        if value.is_empty_or_undefined_or_null() {
            return Ok(Value::Null);
        }
        match field_type {
            FieldType::MYSQL_TYPE_TINY => Ok(Value::Bool(value.to_boolean())),
            FieldType::MYSQL_TYPE_SHORT => {
                if unsigned {
                    return Ok(Value::Ushort(
                        global_object
                            .validate_integer_range::<u16>(
                                value,
                                0,
                                IntegerRange {
                                    min: u16::MIN as i128,
                                    max: u16::MAX as i128,
                                    field_name: b"u16",
                                    ..Default::default()
                                },
                            )
                            .map_err(js_error_to_mysql)?,
                    ));
                }
                Ok(Value::Short(
                    global_object
                        .validate_integer_range::<i16>(
                            value,
                            0,
                            IntegerRange {
                                min: i16::MIN as i128,
                                max: i16::MAX as i128,
                                field_name: b"i16",
                                ..Default::default()
                            },
                        )
                        .map_err(js_error_to_mysql)?,
                ))
            }
            FieldType::MYSQL_TYPE_LONG => {
                if unsigned {
                    return Ok(Value::Uint(
                        global_object
                            .validate_integer_range::<u32>(
                                value,
                                0,
                                IntegerRange {
                                    min: u32::MIN as i128,
                                    max: u32::MAX as i128,
                                    field_name: b"u32",
                                    ..Default::default()
                                },
                            )
                            .map_err(js_error_to_mysql)?,
                    ));
                }
                Ok(Value::Int(
                    global_object
                        .validate_integer_range::<i32>(
                            value,
                            0,
                            IntegerRange {
                                min: i32::MIN as i128,
                                max: i32::MAX as i128,
                                field_name: b"i32",
                                ..Default::default()
                            },
                        )
                        .map_err(js_error_to_mysql)?,
                ))
            }
            FieldType::MYSQL_TYPE_LONGLONG => {
                if unsigned {
                    return Ok(Value::Ulong(
                        global_object
                            .validate_big_int_range::<u64>(
                                value,
                                0,
                                IntegerRange {
                                    min: 0,
                                    max: u64::MAX as i128,
                                    field_name: b"u64",
                                    ..Default::default()
                                },
                            )
                            .map_err(js_error_to_mysql)?,
                    ));
                }
                Ok(Value::Long(
                    global_object
                        .validate_big_int_range::<i64>(
                            value,
                            0,
                            IntegerRange {
                                min: i64::MIN as i128,
                                max: i64::MAX as i128,
                                field_name: b"i64",
                                ..Default::default()
                            },
                        )
                        .map_err(js_error_to_mysql)?,
                ))
            }

            FieldType::MYSQL_TYPE_FLOAT => Ok(Value::Float(
                value.coerce_f64(global_object).map_err(js_error_to_mysql)? as f32,
            )),
            FieldType::MYSQL_TYPE_DOUBLE => Ok(Value::Double(
                value.coerce_f64(global_object).map_err(js_error_to_mysql)?,
            )),
            FieldType::MYSQL_TYPE_TIME => Ok(Value::Time(Time::from_js(value, global_object)?)),
            FieldType::MYSQL_TYPE_DATE
            | FieldType::MYSQL_TYPE_TIMESTAMP
            | FieldType::MYSQL_TYPE_DATETIME => {
                Ok(Value::Date(DateTime::from_js(value, global_object)?))
            }
            FieldType::MYSQL_TYPE_TINY_BLOB
            | FieldType::MYSQL_TYPE_MEDIUM_BLOB
            | FieldType::MYSQL_TYPE_LONG_BLOB
            | FieldType::MYSQL_TYPE_BLOB => {
                if value.js_type().is_array_buffer_like() {
                    // Later parameters in the same bind loop may run user
                    // JS (toString/toJSON/getters) that can transfer() or
                    // detach this buffer before execute.write() reads it.
                    // Pin the backing ArrayBuffer so it stays non-detachable
                    // until Value drop unpins it; borrowing the slice is
                    // then safe without a copy. See `Bytes`.
                    let mut ptr: *const u8 = core::ptr::null();
                    let mut len: usize = 0;
                    return match JSC__JSValue__borrowBytesForOffThread(value, &mut ptr, &mut len) {
                        // detached / null
                        0 => Ok(Value::Bytes(Bytes::default())),
                        // FastTypedArray — tiny, GC-movable vector; dupe.
                        1 => Ok(Value::Bytes(Bytes {
                            // SAFETY: ptr/len returned from helper are valid for the
                            // duration of this call; init_dupe copies immediately.
                            slice: ZigStringSlice::init_dupe(unsafe {
                                core::slice::from_raw_parts(ptr, len)
                            })
                            .map_err(|_| any_mysql_error::Error::OutOfMemory)?,
                            pinned: JSValue::ZERO,
                        })),
                        // Oversize/Wasteful/DataView/JSArrayBuffer — pinned
                        // by the helper. Root the wrapper so GC can't
                        // collect it (and free the backing store despite
                        // the pin) if user JS drops the last reference from
                        // a later parameter.
                        2 => {
                            roots.append(value);
                            Ok(Value::Bytes(Bytes {
                                // SAFETY: backing ArrayBuffer is pinned (non-detachable) and
                                // rooted via `roots`; slice stays valid until Bytes::drop unpins.
                                slice: ZigStringSlice::from_utf8_never_free(unsafe {
                                    core::slice::from_raw_parts(ptr, len)
                                }),
                                pinned: value,
                            }))
                        }
                        _ => unreachable!(),
                    };
                }

                if let Some(blob) = value.as_class_ref::<Blob>() {
                    if blob.needs_to_read_file() {
                        return Err(js_error_to_mysql(global_object.throw_invalid_arguments(
                            format_args!("File blobs are not supported"),
                        )));
                    }
                    // Blob byte stores are immutable from JS (no detach),
                    // but user JS running for a later parameter could drop
                    // the last reference and force GC. Root the wrapper so
                    // the store survives until execute.write() has read it.
                    roots.append(value);
                    return Ok(Value::Bytes(Bytes {
                        slice: ZigStringSlice::from_utf8_never_free(blob.shared_view()),
                        pinned: JSValue::ZERO,
                    }));
                }

                if value.is_string() {
                    let str = OwnedString::new(
                        BunString::from_js(value, global_object).map_err(js_error_to_mysql)?,
                    );
                    return Ok(Value::String(str.to_utf8()));
                }

                Err(js_error_to_mysql(global_object.throw_invalid_arguments(
                    format_args!("Expected a string, blob, or array buffer"),
                )))
            }

            FieldType::MYSQL_TYPE_JSON => {
                let mut str = OwnedString::new(BunString::empty());
                // Use jsonStringifyFast for SIMD-optimized serialization
                value
                    .json_stringify_fast(global_object, &mut str)
                    .map_err(js_error_to_mysql)?;
                Ok(Value::String(str.to_utf8()))
            }

            //   FieldType::MYSQL_TYPE_VARCHAR | FieldType::MYSQL_TYPE_VAR_STRING | FieldType::MYSQL_TYPE_STRING => {
            _ => {
                let str = OwnedString::new(
                    BunString::from_js(value, global_object).map_err(js_error_to_mysql)?,
                );
                Ok(Value::String(str.to_utf8()))
            }
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct DateTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    pub microsecond: u32,
}

impl DateTime {
    pub fn from_data(data: &Data) -> Result<DateTime, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Self::from_binary(data.slice()))
    }

    pub fn from_binary(val: &[u8]) -> DateTime {
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
            // TODO(port): Zig used bun.Output.panic; confirm bun_core panic helper
        }
    }

    pub fn to_binary(&self, field_type: FieldType, buffer: &mut [u8]) -> u8 {
        match field_type {
            FieldType::MYSQL_TYPE_YEAR => {
                buffer[0] = 2;
                buffer[1..3].copy_from_slice(&self.year.to_le_bytes());
                3
            }
            FieldType::MYSQL_TYPE_DATE => {
                buffer[0] = 4;
                buffer[1..3].copy_from_slice(&self.year.to_le_bytes());
                buffer[3] = self.month;
                buffer[4] = self.day;
                5
            }
            FieldType::MYSQL_TYPE_DATETIME => {
                buffer[0] = if self.microsecond == 0 { 7 } else { 11 };
                buffer[1..3].copy_from_slice(&self.year.to_le_bytes());
                buffer[3] = self.month;
                buffer[4] = self.day;
                buffer[5] = self.hour;
                buffer[6] = self.minute;
                buffer[7] = self.second;
                if self.microsecond == 0 {
                    8
                } else {
                    buffer[8..12].copy_from_slice(&self.microsecond.to_le_bytes());
                    12
                }
            }
            _ => 0,
        }
    }

    pub fn to_js_timestamp(&self, global_object: &JSGlobalObject) -> JsResult<f64> {
        global_object.gregorian_date_time_to_ms(
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

    pub fn from_unix_timestamp(timestamp: i64, microseconds: u32) -> DateTime {
        let mut ts = timestamp;
        let days = ts.div_euclid(86400);
        ts = ts.rem_euclid(86400);

        let hour = ts.div_euclid(3600);
        ts = ts.rem_euclid(3600);

        let minute = ts.div_euclid(60);
        let second = ts.rem_euclid(60);

        let date = gregorian_date(i32::try_from(days).expect("int cast"));
        DateTime {
            year: date.year,
            month: date.month,
            day: date.day,
            hour: u8::try_from(hour).expect("int cast"),
            minute: u8::try_from(minute).expect("int cast"),
            second: u8::try_from(second).expect("int cast"),
            microsecond: microseconds,
        }
    }

    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // TODO(port): Zig calls toJSTimestamp() with no args here but the fn takes globalObject and is fallible; preserved bug
        JSValue::from_date_number(
            global_object,
            self.to_js_timestamp(global_object).unwrap_or(f64::NAN),
        )
    }

    pub fn from_js(
        value: JSValue,
        global_object: &JSGlobalObject,
    ) -> Result<DateTime, any_mysql_error::Error> {
        // TODO(port): narrow error set
        if value.is_date() {
            // this is actually ms not seconds
            let total_ms = value.get_unix_timestamp();
            let ts: i64 = (total_ms / 1000.0).floor() as i64;
            let ms: u32 = (total_ms - (ts as f64 * 1000.0)) as u32;
            return Ok(DateTime::from_unix_timestamp(ts, ms * 1000));
        }

        if value.is_number() {
            let total_ms = value.as_number();
            let ts: i64 = (total_ms / 1000.0).floor() as i64;
            let ms: u32 = (total_ms - (ts as f64 * 1000.0)) as u32;
            return Ok(DateTime::from_unix_timestamp(ts, ms * 1000));
        }

        Err(js_error_to_mysql(global_object.throw_invalid_arguments(
            format_args!("Expected a date or number"),
        )))
    }
}

#[derive(Default, Clone, Copy)]
pub struct Time {
    pub negative: bool,
    pub days: u32,
    pub hours: u8,
    pub minutes: u8,
    pub seconds: u8,
    pub microseconds: u32,
}

impl Time {
    pub fn from_js(
        value: JSValue,
        global_object: &JSGlobalObject,
    ) -> Result<Time, any_mysql_error::Error> {
        // TODO(port): narrow error set
        if value.is_date() {
            let total_ms = value.get_unix_timestamp();
            let ts: i64 = (total_ms / 1000.0).floor() as i64;
            let ms: u32 = (total_ms - (ts as f64 * 1000.0)) as u32;
            Ok(Time::from_unix_timestamp(ts, ms * 1000))
        } else if value.is_number() {
            let total_ms = value.as_number();
            let ts: i64 = (total_ms / 1000.0).floor() as i64;
            let ms: u32 = (total_ms - (ts as f64 * 1000.0)) as u32;
            Ok(Time::from_unix_timestamp(ts, ms * 1000))
        } else {
            Err(js_error_to_mysql(global_object.throw_invalid_arguments(
                format_args!("Expected a date or number"),
            )))
        }
    }

    pub fn from_unix_timestamp(timestamp: i64, microseconds: u32) -> Time {
        let days = timestamp.div_euclid(86400);
        let hours = timestamp.rem_euclid(86400).div_euclid(3600);
        let minutes = timestamp.rem_euclid(3600).div_euclid(60);
        let seconds = timestamp.rem_euclid(60);
        Time {
            negative: timestamp < 0,
            days: u32::try_from(days).expect("int cast"),
            hours: u8::try_from(hours).expect("int cast"),
            minutes: u8::try_from(minutes).expect("int cast"),
            seconds: u8::try_from(seconds).expect("int cast"),
            microseconds,
        }
    }

    pub fn to_unix_timestamp(&self) -> i64 {
        let mut total_ms: i64 = 0;
        total_ms = total_ms.saturating_add((self.days as i64).saturating_mul(86400000));
        total_ms = total_ms.saturating_add((self.hours as i64).saturating_mul(3600000));
        total_ms = total_ms.saturating_add((self.minutes as i64).saturating_mul(60000));
        total_ms = total_ms.saturating_add((self.seconds as i64).saturating_mul(1000));
        total_ms
    }

    pub fn from_data(data: &Data) -> Result<Time, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Self::from_binary(data.slice()))
    }

    pub fn from_binary(val: &[u8]) -> Time {
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

    pub fn to_js_timestamp(&self) -> f64 {
        let mut total_ms: i64 = 0;
        total_ms = total_ms.saturating_add((self.days as i64) * 86400000);
        total_ms = total_ms.saturating_add((self.hours as i64) * 3600000);
        total_ms = total_ms.saturating_add((self.minutes as i64) * 60000);
        total_ms = total_ms.saturating_add((self.seconds as i64) * 1000);
        total_ms = total_ms.saturating_add((self.microseconds / 1000) as i64);

        if self.negative {
            total_ms = -total_ms;
        }

        total_ms as f64
    }

    pub fn to_js(self, _global_object: &JSGlobalObject) -> JSValue {
        JSValue::js_double_number(self.to_js_timestamp())
    }

    pub fn to_binary(&self, field_type: FieldType, buffer: &mut [u8]) -> u8 {
        match field_type {
            FieldType::MYSQL_TYPE_TIME | FieldType::MYSQL_TYPE_TIME2 => {
                buffer[1] = if self.negative { 1 } else { 0 };
                buffer[2..6].copy_from_slice(&self.days.to_le_bytes());
                buffer[6] = self.hours;
                buffer[7] = self.minutes;
                buffer[8] = self.seconds;
                if self.microseconds == 0 {
                    buffer[0] = 8; // length
                    9
                } else {
                    buffer[0] = 12; // length
                    buffer[9..13].copy_from_slice(&self.microseconds.to_le_bytes());
                    12
                }
            }
            _ => unreachable!(),
        }
    }
}

pub struct Decimal {
    // MySQL DECIMAL is stored as a sequence of base-10 digits
    pub digits: Box<[u8]>,
    pub scale: u8,
    pub negative: bool,
}

impl Decimal {
    pub fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        // PERF(port): was stack-fallback (std.heap.stackFallback(64, ...)) — profile in Phase B
        let mut str: Vec<u8> = Vec::new();

        if self.negative {
            str.push(b'-');
        }

        let decimal_pos = self.digits.len() - self.scale as usize;
        for (i, digit) in self.digits.iter().enumerate() {
            if i == decimal_pos && self.scale > 0 {
                str.push(b'.');
            }
            str.push(digit + b'0');
        }

        bun_string_jsc::create_utf8_for_js(global_object, &str).unwrap_or(JSValue::ZERO)
    }

    pub fn to_binary(&self, _field_type: FieldType) -> Result<Data, bun_core::Error> {
        // Zig: `bun.todoPanic(@src(), "Decimal.toBinary not implemented", .{});`
        // Intentional shipped runtime "feature not yet implemented" — distinct
        // from a Phase-A porting placeholder. The `Decimal` arm of `Value` is
        // commented out, so this is unreachable today.
        bun_core::todo_panic!("Decimal.toBinary not implemented")
    }

    // pub fn from_data(data: &Data) -> Result<Decimal, bun_core::Error> {
    //     Ok(Self::from_binary(data.slice()))
    // }

    // pub fn from_binary(_: &[u8]) -> Decimal {
    //     bun_core::todo_panic!("Decimal.fromBinary not implemented")
    // }
}

// Helper functions for date calculations
fn is_leap_year(year: u16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: u16, month: u8) -> u8 {
    const DAYS: [u8; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if month == 2 && is_leap_year(year) {
        return 29;
    }
    DAYS[month as usize - 1]
}

struct Date {
    year: u16,
    month: u8,
    day: u8,
}

fn gregorian_date(days: i32) -> Date {
    // Convert days since 1970-01-01 to year/month/day
    let mut d = days;
    let mut y: u16 = 1970;

    while d >= 365 + is_leap_year(y) as i32 {
        d -= 365 + is_leap_year(y) as i32;
        y += 1;
    }

    let mut m: u8 = 1;
    while d >= days_in_month(y, m) as i32 {
        d -= days_in_month(y, m) as i32;
        m += 1;
    }

    Date {
        year: y,
        month: m,
        day: u8::try_from(d + 1).expect("int cast"),
    }
}

// TODO(port): move to sql_jsc_sys (or bun_jsc_sys)
unsafe extern "C" {
    /// By-value `JSValue`; C++ side null-checks and reads its own heap state.
    /// No caller-side preconditions → `safe fn`.
    safe fn JSC__JSValue__unpinArrayBuffer(v: JSValue);
    /// 0 = detached/null, 1 = FastTypedArray (GC-movable — caller should dupe;
    /// no unpin needed), 2 = pinned ArrayBuffer (caller must `unpinArrayBuffer`).
    /// Out-params are `&mut` (same ABI as `*mut`), so the only obligation left
    /// is on the *returned* slice, not the call itself → `safe fn`.
    safe fn JSC__JSValue__borrowBytesForOffThread(
        v: JSValue,
        out_ptr: &mut *const u8,
        out_len: &mut usize,
    ) -> i32;
}

// ported from: src/sql_jsc/mysql/MySQLValue.zig
