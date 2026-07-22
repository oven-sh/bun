use crate::jsc::JSGlobalObject;
use crate::mysql::my_sql_value::{DateTime, Time};
use crate::shared::sql_data_cell::SQLDataCell;
use bun_sql::mysql::mysql_types as types;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};

bun_core::declare_scope!(MySQLDecodeBinaryValue, visible);

/// MySQL's "binary" pseudo-charset ID. Columns with this character_set value
/// are true binary types (BINARY, VARBINARY, BLOB), as opposed to string columns
/// with binary collations (e.g., utf8mb4_bin) which have different character_set values.
pub(crate) const BINARY_CHARSET: u16 = 63;

pub(crate) fn decode_binary_value<Context: ReaderContext>(
    global_object: &JSGlobalObject,
    field_type: types::FieldType,
    column_length: u32,
    raw: bool,
    bigint: bool,
    unsigned: bool,
    binary: bool,
    character_set: u16,
    reader: NewReader<Context>,
) -> crate::Result<SQLDataCell> {
    bun_core::scoped_log!(
        MySQLDecodeBinaryValue,
        "decodeBinaryValue: {}",
        <&'static str>::from(field_type)
    );
    match field_type {
        FieldType::MYSQL_TYPE_TINY => {
            if raw {
                let data = reader.read(1)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let val = reader.byte()?;
            if unsigned {
                return Ok(SQLDataCell::uint4(val as u32));
            }
            let ival: i8 = val as i8;
            Ok(SQLDataCell::int4(ival as i32))
        }
        FieldType::MYSQL_TYPE_SHORT => {
            if raw {
                let data = reader.read(2)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            if unsigned {
                return Ok(SQLDataCell::uint4(reader.int::<u16>()? as u32));
            }
            Ok(SQLDataCell::int4(reader.int::<i16>()? as i32))
        }
        FieldType::MYSQL_TYPE_YEAR => {
            // Binary protocol sends YEAR as a fixed 2-byte unsigned field;
            // column_length is the display width (4), not the wire size.
            if raw {
                let data = reader.read(2)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            Ok(SQLDataCell::uint4(reader.int::<u16>()? as u32))
        }
        FieldType::MYSQL_TYPE_INT24 => {
            if raw {
                // Binary protocol sends INT24 as a fixed 4-byte field; consume
                // all 4 to keep the cursor aligned and return only the low 3.
                let data = reader.read(4)?;
                return Ok(SQLDataCell::raw(Some(&data.substring(0, 3))));
            }
            if unsigned {
                return Ok(SQLDataCell::uint4(reader.int_u24()?));
            }
            Ok(SQLDataCell::int4(reader.int_i24()?))
        }
        FieldType::MYSQL_TYPE_LONG => {
            if raw {
                let data = reader.read(4)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            if unsigned {
                return Ok(SQLDataCell::uint4(reader.int::<u32>()?));
            }
            Ok(SQLDataCell::int4(reader.int::<i32>()?))
        }
        FieldType::MYSQL_TYPE_LONGLONG => {
            if raw {
                return Ok(SQLDataCell::raw(Some(&reader.read(8)?)));
            }
            if unsigned {
                let val = reader.int::<u64>()?;
                if val <= u32::MAX as u64 {
                    return Ok(SQLDataCell::uint4(u32::try_from(val).expect("int cast")));
                }
                if bigint {
                    return Ok(SQLDataCell::uint8(val));
                }
                let mut buffer = bun_core::fmt::ItoaBuf::new();
                let slice = bun_core::fmt::itoa(&mut buffer, val);
                return Ok(SQLDataCell::string(slice));
            }
            let val = reader.int::<i64>()?;
            if val >= i32::MIN as i64 && val <= i32::MAX as i64 {
                return Ok(SQLDataCell::int4(i32::try_from(val).expect("int cast")));
            }
            if bigint {
                return Ok(SQLDataCell::int8(val));
            }
            let mut buffer = bun_core::fmt::ItoaBuf::new();
            let slice = bun_core::fmt::itoa(&mut buffer, val);
            Ok(SQLDataCell::string(slice))
        }
        FieldType::MYSQL_TYPE_FLOAT => {
            if raw {
                let data = reader.read(4)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            Ok(SQLDataCell::float8(
                f32::from_bits(reader.int::<u32>()?) as f64
            ))
        }
        FieldType::MYSQL_TYPE_DOUBLE => {
            if raw {
                let data = reader.read(8)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            Ok(SQLDataCell::float8(f64::from_bits(reader.int::<u64>()?)))
        }
        FieldType::MYSQL_TYPE_TIME => {
            match reader.byte()? {
                0 => Ok(SQLDataCell::string(b"00:00:00")),
                l @ (8 | 12) => {
                    let data = reader.read(l as usize)?;
                    let time = Time::from_data(&data)?;

                    let total_hours: u32 = time.hours as u32 + time.days * 24;
                    // -838:59:59 to 838:59:59 is valid (it only store seconds)
                    // it should be represented as HH:MM:SS or HHH:MM:SS if total_hours > 99
                    let mut buffer = [0u8; 32];
                    let sign: &str = if time.negative { "-" } else { "" };
                    let slice: &[u8] = 'brk: {
                        use std::io::Write;
                        let mut w = &mut buffer[..];
                        if total_hours > 99 {
                            if write!(
                                w,
                                "{}{:03}:{:02}:{:02}",
                                sign, total_hours, time.minutes, time.seconds
                            )
                            .is_err()
                            {
                                return Err(crate::Error::InvalidBinaryValue);
                            }
                        } else {
                            if write!(
                                w,
                                "{}{:02}:{:02}:{:02}",
                                sign, total_hours, time.minutes, time.seconds
                            )
                            .is_err()
                            {
                                return Err(crate::Error::InvalidBinaryValue);
                            }
                        }
                        let remaining = w.len();
                        break 'brk &buffer[..32 - remaining];
                    };
                    // reshaped for borrowck — compute remaining before re-borrowing buffer
                    Ok(SQLDataCell::string(slice))
                }
                _ => Err(crate::Error::InvalidBinaryValue),
            }
        }
        FieldType::MYSQL_TYPE_DATE
        | FieldType::MYSQL_TYPE_TIMESTAMP
        | FieldType::MYSQL_TYPE_DATETIME => match reader.byte()? {
            // A zero-length binary DATETIME is MySQL's "0000-00-00 00:00:00"
            // sentinel — surface it as Invalid Date (NaN), not the Unix epoch,
            // so it agrees with the text path's from_text().
            0 => Ok(SQLDataCell::date(f64::NAN)),
            l @ (11 | 7 | 4) => {
                let data = reader.read(l as usize)?;
                let time = DateTime::from_data(&data)?;
                // Map JsError variants to their
                // interned crate::Error names so `?` can widen here.
                let ts = time.to_js_timestamp(global_object).map_err(|e| match e {
                    bun_jsc::JsError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
                    bun_jsc::JsError::Terminated => crate::Error::Terminated,
                    bun_jsc::JsError::Thrown => crate::Error::Thrown,
                })?;
                Ok(SQLDataCell::date(ts))
            }
            _ => Err(crate::Error::InvalidBinaryValue),
        },

        // NEWDECIMAL is always sent as an ASCII decimal string regardless of the
        // column's BINARY flag / charset. Computed decimals (SUM/AVG/arithmetic/CAST)
        // carry the BINARY flag and charset 63, so the binary-charset heuristic in the
        // string/blob arm below would wrongly return them as a Buffer.
        FieldType::MYSQL_TYPE_NEWDECIMAL => {
            if raw {
                let data = reader.encode_len_string()?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let string_data = reader.encode_len_string()?;
            Ok(SQLDataCell::string(string_data.slice()))
        }

        // When the column contains a binary string we return a Buffer otherwise a string
        FieldType::MYSQL_TYPE_ENUM
        | FieldType::MYSQL_TYPE_SET
        | FieldType::MYSQL_TYPE_GEOMETRY
        | FieldType::MYSQL_TYPE_STRING
        | FieldType::MYSQL_TYPE_VARCHAR
        | FieldType::MYSQL_TYPE_VAR_STRING
        | FieldType::MYSQL_TYPE_TINY_BLOB
        | FieldType::MYSQL_TYPE_MEDIUM_BLOB
        | FieldType::MYSQL_TYPE_LONG_BLOB
        | FieldType::MYSQL_TYPE_BLOB => {
            if raw {
                let data = reader.encode_len_string()?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let string_data = reader.encode_len_string()?;
            // Only treat as binary if character_set indicates the binary pseudo-charset.
            // The BINARY flag alone is insufficient because VARCHAR/CHAR columns
            // with _bin collations (e.g., utf8mb4_bin) also have the BINARY flag set,
            // but should return strings, not buffers.
            if binary && character_set == BINARY_CHARSET {
                return Ok(SQLDataCell::raw(Some(&string_data)));
            }
            Ok(SQLDataCell::string(string_data.slice()))
        }

        FieldType::MYSQL_TYPE_JSON => {
            if raw {
                let data = reader.encode_len_string()?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let string_data = reader.encode_len_string()?;
            Ok(SQLDataCell::json(string_data.slice()))
        }
        FieldType::MYSQL_TYPE_BIT => {
            // BIT(1) is a special case, it's a boolean
            if column_length == 1 {
                let data = reader.encode_len_string()?;
                let slice = data.slice();
                Ok(SQLDataCell::bool_(!slice.is_empty() && slice[0] == 1))
            } else {
                let data = reader.encode_len_string()?;
                Ok(SQLDataCell::raw(Some(&data)))
            }
        }
        _ => {
            let data = reader.read(column_length as usize)?;
            Ok(SQLDataCell::raw(Some(&data)))
        }
    }
}
