use crate::jsc::JSGlobalObject;
use crate::mysql::my_sql_value::{DateTime, Time};
use crate::shared::sql_data_cell::SQLDataCell;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::ColumnDefinition41;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::stack_reader::PacketReader;

bun_core::declare_scope!(MySQLDecodeBinaryValue, visible);

/// MySQL's "binary" pseudo-charset ID. Columns with this character_set value
/// are true binary types (BINARY, VARBINARY, BLOB), as opposed to string columns
/// with binary collations (e.g., utf8mb4_bin) which have different character_set values.
pub(crate) const BINARY_CHARSET: u16 = 63;

pub(crate) fn decode_binary_value(
    global_object: &JSGlobalObject,
    column: &ColumnDefinition41,
    raw: bool,
    bigint: bool,
    reader: PacketReader<'_>,
) -> crate::Result<SQLDataCell> {
    bun_core::scoped_log!(
        MySQLDecodeBinaryValue,
        "decodeBinaryValue: {}",
        <&'static str>::from(column.column_type)
    );
    let unsigned = column.flags.contains(ColumnFlags::UNSIGNED);
    match column.column_type {
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
            let length = reader.byte()?;
            if !matches!(length, 0 | 8 | 12) {
                return Err(crate::Error::InvalidBinaryValue);
            }
            let data = reader.read(length as usize)?;
            if raw {
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let time = Time::from_binary(data.slice());
            if time.microseconds >= 1_000_000 {
                return Err(crate::Error::InvalidBinaryValue);
            }

            // As the text protocol sends it: the fraction padded to the column's precision.
            use std::io::Write;
            let mut buffer = [0u8; 32];
            let mut w = &mut buffer[..];
            let decimals = u32::from(column.decimals.min(6));
            write!(
                w,
                "{}{:02}:{:02}:{:02}",
                if time.negative { "-" } else { "" },
                u64::from(time.days) * 24 + u64::from(time.hours),
                time.minutes,
                time.seconds
            )
            .map_err(|_| crate::Error::InvalidBinaryValue)?;
            if decimals > 0 {
                write!(
                    w,
                    ".{:0width$}",
                    time.microseconds / 10u32.pow(6 - decimals),
                    width = decimals as usize
                )
                .map_err(|_| crate::Error::InvalidBinaryValue)?;
            }
            let remaining = w.len();
            Ok(SQLDataCell::string(&buffer[..buffer.len() - remaining]))
        }
        FieldType::MYSQL_TYPE_DATE
        | FieldType::MYSQL_TYPE_TIMESTAMP
        | FieldType::MYSQL_TYPE_DATETIME => {
            let length = reader.byte()?;
            if !matches!(length, 0 | 4 | 7 | 11) {
                return Err(crate::Error::InvalidBinaryValue);
            }
            let data = reader.read(length as usize)?;
            if raw {
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            // A zero-length binary DATETIME is MySQL's "0000-00-00 00:00:00"
            // sentinel — surface it as Invalid Date (NaN), not the Unix epoch,
            // so it agrees with the text path's from_text().
            if length == 0 {
                return Ok(SQLDataCell::date(f64::NAN));
            }
            // Map JsError variants to their
            // interned crate::Error names so `?` can widen here.
            let ts = DateTime::from_binary(data.slice())
                .to_js_timestamp(global_object)
                .map_err(|e| match e {
                    bun_jsc::JsError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
                    bun_jsc::JsError::Thrown | bun_jsc::JsError::Terminated => crate::Error::Thrown,
                })?;
            Ok(SQLDataCell::date(ts))
        }

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
            if column.flags.contains(ColumnFlags::BINARY) && column.character_set == BINARY_CHARSET
            {
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
            let data = reader.encode_len_string()?;
            // BIT(1) is a special case, it's a boolean
            if column.column_length == 1 && !raw {
                let slice = data.slice();
                Ok(SQLDataCell::bool(!slice.is_empty() && slice[0] == 1))
            } else {
                Ok(SQLDataCell::raw(Some(&data)))
            }
        }
        _ => {
            let data = reader.read(column.column_length as usize)?;
            Ok(SQLDataCell::raw(Some(&data)))
        }
    }
}
