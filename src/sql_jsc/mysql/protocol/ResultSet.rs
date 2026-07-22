use crate::jsc::{JSGlobalObject, JSValue};
use crate::mysql::my_sql_value::DateTime;
use bun_core::parse_int;

use bun_sql::mysql::protocol::ColumnDefinition41;
use bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::encode_int::decode_length_int;
use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};
use bun_sql::shared::ColumnIdentifier as NameOrIndex;
use bun_sql::shared::Data;
use bun_sql::shared::SQLQueryResultMode;

use crate::shared::CachedStructure;
use crate::shared::sql_data_cell::{Flags as SQLDataCellFlags, SQLDataCell};

use super::decode_binary_value::{self, decode_binary_value};

pub use bun_sql::mysql::protocol::ResultSetHeader as Header;

bun_core::declare_scope!(MySQLResultSet, visible);

pub(crate) struct Row<'a> {
    pub values: Box<[SQLDataCell]>,
    // `columns` is borrowed from the connection's column-definition buffer; see deinit note below.
    pub columns: &'a [ColumnDefinition41],
    pub binary: bool,
    pub raw: bool,
    pub bigint: bool,
    pub global_object: &'a JSGlobalObject,
}

impl<'a> Row<'a> {
    pub(crate) fn to_js(
        &mut self,
        global_object: &JSGlobalObject,
        array: JSValue,
        structure: JSValue,
        flags: SQLDataCellFlags,
        result_mode: SQLQueryResultMode,
        // Passed by ref because CachedStructure is non-Copy (owns Strong + Box).
        cached_structure: Option<&CachedStructure>,
    ) -> crate::jsc::JsResult<JSValue> {
        SQLDataCell::to_js_object(
            global_object,
            array,
            structure,
            self.values.as_mut(),
            flags,
            result_mode as u8,
            cached_structure,
        )
    }

    fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        if self.binary {
            self.decode_binary(reader)
        } else {
            self.decode_text(reader)
        }
    }

    fn parse_value_and_set_cell(
        &self,
        cell: &mut SQLDataCell,
        column: &ColumnDefinition41,
        value: &Data,
    ) {
        bun_core::scoped_log!(
            MySQLResultSet,
            "parseValueAndSetCell: {} {}",
            <&'static str>::from(column.column_type),
            bstr::BStr::new(value.slice())
        );
        use bun_sql::mysql::protocol::FieldType::*;
        match column.column_type {
            MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
                let val: f64 = bun_core::parse_double(value.slice()).unwrap_or(f64::NAN);
                *cell = SQLDataCell::float8(val);
            }
            // YEAR arrives as a bare ASCII integer in the text protocol; parse it
            // like SHORT so `.simple()` returns the same JS number as the binary path.
            MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_YEAR => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u16 = parse_int::<u16>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell::uint4(val as u32);
                } else {
                    let val: i16 = parse_int::<i16>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell::int4(val as i32);
                }
            }
            MYSQL_TYPE_LONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u32 = parse_int::<u32>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell::uint4(val);
                } else {
                    let val: i32 = parse_int::<i32>(value.slice(), 10).unwrap_or(i32::MIN);
                    *cell = SQLDataCell::int4(val);
                }
            }
            MYSQL_TYPE_INT24 => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u32 = parse_int::<u32>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell::uint4(val);
                } else {
                    // -8_388_608 is the minimum value of a signed 24-bit int
                    let val: i32 = parse_int::<i32>(value.slice(), 10).unwrap_or(-8_388_608);
                    *cell = SQLDataCell::int4(val);
                }
            }
            MYSQL_TYPE_LONGLONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u64 = parse_int::<u64>(value.slice(), 10).unwrap_or(0);
                    if val <= u32::MAX as u64 {
                        *cell = SQLDataCell::uint4(u32::try_from(val).expect("int cast"));
                        return;
                    }
                    if self.bigint {
                        *cell = SQLDataCell::uint8(val);
                        return;
                    }
                } else {
                    let val: i64 = parse_int::<i64>(value.slice(), 10).unwrap_or(0);
                    if val >= i32::MIN as i64 && val <= i32::MAX as i64 {
                        *cell = SQLDataCell::int4(i32::try_from(val).expect("int cast"));
                        return;
                    }
                    if self.bigint {
                        *cell = SQLDataCell::int8(val);
                        return;
                    }
                }

                *cell = SQLDataCell::string(value.slice());
            }
            MYSQL_TYPE_JSON => {
                *cell = SQLDataCell::json(value.slice());
            }

            MYSQL_TYPE_TIME => {
                // lets handle TIME special case as string
                // -838:59:50 to 838:59:59 is valid
                *cell = SQLDataCell::string(value.slice());
            }
            MYSQL_TYPE_DATE | MYSQL_TYPE_DATETIME | MYSQL_TYPE_TIMESTAMP => {
                // MySQL's DATE/DATETIME/TIMESTAMP text has no timezone, so parse
                // the components directly and convert them as UTC — matching the
                // binary path. Routing through JS Date.parse here would instead
                // read "2024-06-15 12:00:00" as local time and make the text and
                // binary protocols disagree on non-UTC hosts. Zero/invalid dates
                // fall through to NaN (Invalid Date).
                let date = match DateTime::from_text(value.slice()) {
                    Some(dt) => dt.to_js_timestamp(self.global_object).unwrap_or(f64::NAN),
                    None => f64::NAN,
                };
                *cell = SQLDataCell::date(date);
            }
            // NEWDECIMAL is always sent as an ASCII decimal string regardless of the
            // column's BINARY flag / charset. Computed decimals (SUM/AVG/arithmetic/CAST)
            // carry the BINARY flag and charset 63, so the catch-all arm's binary-charset
            // heuristic would wrongly return them as a Buffer.
            MYSQL_TYPE_NEWDECIMAL => {
                *cell = SQLDataCell::string(value.slice());
            }
            MYSQL_TYPE_BIT => {
                // BIT(1) is a special case, it's a boolean
                if column.column_length == 1 {
                    let slice = value.slice();
                    *cell = SQLDataCell::bool_(!slice.is_empty() && slice[0] == 1);
                } else {
                    *cell = SQLDataCell::raw(value);
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
                    *cell = SQLDataCell::raw(value);
                } else {
                    *cell = SQLDataCell::string(value.slice());
                }
            }
        }
    }

    fn decode_text<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        let cells = vec![SQLDataCell::null(); self.columns.len()].into_boxed_slice();
        let mut cells = scopeguard::guard(cells, |mut cells| {
            for value in cells.iter_mut() {
                value.deinit();
            }
        });

        for (index, value) in cells.iter_mut().enumerate() {
            if let Some(result) = decode_length_int(reader.peek()) {
                let column = &self.columns[index];
                // The NULL marker is the single literal byte 0xfb. A 251-byte
                // value is length-encoded as `0xfc 0xfb 0x00` and also decodes
                // to value 251, so the marker must be distinguished by its
                // 1-byte encoding or row decoding desynchronizes.
                if result.bytes_read == 1 && result.value == 0xfb {
                    // NULL value
                    reader.skip(result.bytes_read);
                    // this dont matter if is raw because we will sent as null too like in postgres
                    *value = SQLDataCell::null();
                } else {
                    if self.raw {
                        let data = reader.encode_len_string()?;
                        *value = SQLDataCell::raw(&data);
                    } else {
                        reader.skip(result.bytes_read);
                        let string_data =
                            reader.read(usize::try_from(result.value).expect("int cast"))?;
                        self.parse_value_and_set_cell(value, column, &string_data);
                    }
                }
                value.index = match column.name_or_index {
                    // The indexed columns can be out of order.
                    NameOrIndex::Index(i) => i,
                    _ => u32::try_from(index).expect("int cast"),
                };
                value.is_indexed_column = match column.name_or_index {
                    NameOrIndex::Duplicate => 2,
                    NameOrIndex::Index(_) => 1,
                    NameOrIndex::Name(_) => 0,
                };
            } else {
                return Err(AnyMySQLError::InvalidResultRow);
            }
        }

        self.values = scopeguard::ScopeGuard::into_inner(cells);
        Ok(())
    }

    fn decode_binary<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        // Header
        let _ = reader.int::<u8>()?;

        // Null bitmap
        let bitmap_bytes = (self.columns.len() + 7 + 2) / 8;
        let null_bitmap = reader.read(bitmap_bytes)?;

        let cells = vec![SQLDataCell::null(); self.columns.len()].into_boxed_slice();
        let mut cells = scopeguard::guard(cells, |mut cells| {
            for value in cells.iter_mut() {
                value.deinit();
            }
        });
        // Skip first 2 bits of null bitmap (reserved)
        let bitmap_offset: usize = 2;

        for (i, value) in cells.iter_mut().enumerate() {
            let byte_pos = (bitmap_offset + i) >> 3;
            let bit_pos = ((bitmap_offset + i) & 7) as u8;
            let is_null = (null_bitmap.slice()[byte_pos] & (1u8 << bit_pos)) != 0;

            let column = &self.columns[i];
            if is_null {
                *value = SQLDataCell::null();
            } else {
                *value = decode_binary_value(
                    self.global_object,
                    column.column_type,
                    column.column_length,
                    self.raw,
                    self.bigint,
                    column.flags.contains(ColumnFlags::UNSIGNED),
                    column.flags.contains(ColumnFlags::BINARY),
                    column.character_set,
                    reader,
                )
                .map_err(|e| match e {
                    crate::Error::MySqlProtocol(e) => e,
                    other => other
                        .name()
                        .parse()
                        .unwrap_or(AnyMySQLError::InvalidBinaryValue),
                })?;
            }
            value.index = match column.name_or_index {
                // The indexed columns can be out of order.
                NameOrIndex::Index(idx) => idx,
                _ => u32::try_from(i).expect("int cast"),
            };
            value.is_indexed_column = match column.name_or_index {
                NameOrIndex::Duplicate => 2,
                NameOrIndex::Index(_) => 1,
                NameOrIndex::Name(_) => 0,
            };
        }

        self.values = scopeguard::ScopeGuard::into_inner(cells);
        Ok(())
    }

    // See Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub(crate) fn decode<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(reader)
    }
}

impl<'a> Drop for Row<'a> {
    fn drop(&mut self) {
        for value in self.values.iter_mut() {
            // SQLDataCell deliberately has no `impl Drop` — it is an FFI struct
            // whose ownership is normally transferred to C++ — so the cells
            // still owned by this row must be freed manually here.
            value.deinit();
        }
        // self.columns is intentionally left out.
    }
}
