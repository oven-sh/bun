use crate::jsc::JSGlobalObject;
use crate::mysql::my_sql_value::DateTime;
use bun_core::parse_int;

use bun_sql::mysql::protocol::ColumnDefinition41;
use bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::encode_int::decode_length_int;
use bun_sql::mysql::protocol::packet_reader::PacketReader;

use crate::shared::sql_data_cell::SQLDataCell;

use super::decode_binary_value::{self, decode_binary_value};

bun_core::declare_scope!(MySQLResultSet, visible);

pub(crate) struct Row<'a> {
    pub columns: &'a [ColumnDefinition41],
    pub binary: bool,
    pub raw: bool,
    pub bigint: bool,
    pub global_object: &'a JSGlobalObject,
}

impl<'a> Row<'a> {
    fn parse_value(&self, column: &ColumnDefinition41, value: &[u8]) -> SQLDataCell {
        bun_core::scoped_log!(
            MySQLResultSet,
            "parseValue: {} {}",
            <&'static str>::from(column.column_type),
            bstr::BStr::new(value)
        );
        use bun_sql::mysql::protocol::FieldType::*;
        match column.column_type {
            MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
                let val: f64 = bun_core::parse_double(value).unwrap_or(f64::NAN);
                SQLDataCell::float8(val)
            }
            // YEAR arrives as a bare ASCII integer in the text protocol; parse it
            // like SHORT so `.simple()` returns the same JS number as the binary path.
            MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_YEAR => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u16 = parse_int::<u16>(value, 10).unwrap_or(0);
                    SQLDataCell::uint4(val as u32)
                } else {
                    let val: i16 = parse_int::<i16>(value, 10).unwrap_or(0);
                    SQLDataCell::int4(val as i32)
                }
            }
            MYSQL_TYPE_LONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u32 = parse_int::<u32>(value, 10).unwrap_or(0);
                    SQLDataCell::uint4(val)
                } else {
                    let val: i32 = parse_int::<i32>(value, 10).unwrap_or(i32::MIN);
                    SQLDataCell::int4(val)
                }
            }
            MYSQL_TYPE_INT24 => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u32 = parse_int::<u32>(value, 10).unwrap_or(0);
                    SQLDataCell::uint4(val)
                } else {
                    // -8_388_608 is the minimum value of a signed 24-bit int
                    let val: i32 = parse_int::<i32>(value, 10).unwrap_or(-8_388_608);
                    SQLDataCell::int4(val)
                }
            }
            MYSQL_TYPE_LONGLONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u64 = parse_int::<u64>(value, 10).unwrap_or(0);
                    if val <= u32::MAX as u64 {
                        return SQLDataCell::uint4(u32::try_from(val).expect("int cast"));
                    }
                    if self.bigint {
                        return SQLDataCell::uint8(val);
                    }
                } else {
                    let val: i64 = parse_int::<i64>(value, 10).unwrap_or(0);
                    if val >= i32::MIN as i64 && val <= i32::MAX as i64 {
                        return SQLDataCell::int4(i32::try_from(val).expect("int cast"));
                    }
                    if self.bigint {
                        return SQLDataCell::int8(val);
                    }
                }

                SQLDataCell::string(value)
            }
            MYSQL_TYPE_JSON => SQLDataCell::json(value),

            MYSQL_TYPE_TIME => {
                // lets handle TIME special case as string
                // -838:59:50 to 838:59:59 is valid
                SQLDataCell::string(value)
            }
            MYSQL_TYPE_DATE | MYSQL_TYPE_DATETIME | MYSQL_TYPE_TIMESTAMP => {
                // MySQL's DATE/DATETIME/TIMESTAMP text has no timezone, so parse
                // the components directly and convert them as UTC — matching the
                // binary path. Routing through JS Date.parse here would instead
                // read "2024-06-15 12:00:00" as local time and make the text and
                // binary protocols disagree on non-UTC hosts. Zero/invalid dates
                // fall through to NaN (Invalid Date).
                let date = match DateTime::from_text(value) {
                    Some(dt) => dt.to_js_timestamp(self.global_object).unwrap_or(f64::NAN),
                    None => f64::NAN,
                };
                SQLDataCell::date(date)
            }
            // NEWDECIMAL is always sent as an ASCII decimal string regardless of the
            // column's BINARY flag / charset. Computed decimals (SUM/AVG/arithmetic/CAST)
            // carry the BINARY flag and charset 63, so the catch-all arm's binary-charset
            // heuristic would wrongly return them as a Buffer.
            MYSQL_TYPE_NEWDECIMAL => SQLDataCell::string(value),
            MYSQL_TYPE_BIT => {
                // BIT(1) is a special case, it's a boolean
                if column.column_length == 1 {
                    SQLDataCell::bool(value.first() == Some(&1))
                } else {
                    SQLDataCell::raw(value)
                }
            }
            _ => {
                // Only treat as binary if character_set indicates the binary pseudo-charset.
                // The BINARY flag alone is insufficient because VARCHAR/CHAR columns
                // with _bin collations (e.g., utf8mb4_bin) also have the BINARY flag set,
                // but should return strings, not buffers.
                if column.flags.contains(ColumnFlags::BINARY)
                    && column.character_set == decode_binary_value::BINARY_CHARSET
                {
                    SQLDataCell::raw(value)
                } else {
                    SQLDataCell::string(value)
                }
            }
        }
    }

    fn decode_text(&self, reader: PacketReader<'_>) -> Result<Vec<SQLDataCell>, AnyMySQLError> {
        let mut cells = Vec::with_capacity(self.columns.len());

        for (index, column) in self.columns.iter().enumerate() {
            let Some(result) = decode_length_int(reader.peek()) else {
                return Err(AnyMySQLError::InvalidResultRow);
            };
            // The NULL marker is the byte 0xfb alone: a length of 251 is `0xfc 0xfb 0x00`.
            let mut value = if result.bytes_read == 1 && result.value == 0xfb {
                reader.skip(result.bytes_read);
                // this dont matter if is raw because we will sent as null too like in postgres
                SQLDataCell::null()
            } else if self.raw {
                SQLDataCell::raw(reader.encode_len_string()?)
            } else {
                reader.skip(result.bytes_read);
                let string_data = reader.read(usize::try_from(result.value).expect("int cast"))?;
                self.parse_value(column, string_data)
            };
            value.set_column(
                u32::try_from(index).expect("int cast"),
                &column.name_or_index,
            );
            cells.push(value);
        }

        Ok(cells)
    }

    fn decode_binary(&self, reader: PacketReader<'_>) -> Result<Vec<SQLDataCell>, AnyMySQLError> {
        // Header
        let _ = reader.int::<u8>()?;

        // Null bitmap
        let bitmap_bytes = (self.columns.len() + 7 + 2) / 8;
        let null_bitmap = reader.read(bitmap_bytes)?;

        let mut cells = Vec::with_capacity(self.columns.len());
        // Skip first 2 bits of null bitmap (reserved)
        let bitmap_offset: usize = 2;

        for (i, column) in self.columns.iter().enumerate() {
            let byte_pos = (bitmap_offset + i) >> 3;
            let bit_pos = ((bitmap_offset + i) & 7) as u8;
            let is_null = (null_bitmap[byte_pos] & (1u8 << bit_pos)) != 0;

            let mut value = if is_null {
                SQLDataCell::null()
            } else {
                decode_binary_value(self.global_object, column, self.raw, self.bigint, reader)?
            };
            value.set_column(u32::try_from(i).expect("int cast"), &column.name_or_index);
            cells.push(value);
        }

        Ok(cells)
    }

    pub(crate) fn decode(
        &self,
        reader: PacketReader<'_>,
    ) -> Result<Vec<SQLDataCell>, AnyMySQLError> {
        if self.binary {
            self.decode_binary(reader)
        } else {
            self.decode_text(reader)
        }
    }
}
