use core::ptr;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSValue};
use bun_core::String as BunString;
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
use crate::shared::sql_data_cell::{Flags as SQLDataCellFlags, SQLDataCell, Tag, Value};

use super::decode_binary_value::{self, decode_binary_value};

pub use bun_sql::mysql::protocol::ResultSetHeader as Header;

bun_core::declare_scope!(MySQLResultSet, visible);

pub struct Row<'a> {
    pub values: Box<[SQLDataCell]>,
    // `columns` is borrowed from the connection's column-definition buffer; see deinit note below.
    pub columns: &'a [ColumnDefinition41],
    pub binary: bool,
    pub raw: bool,
    pub bigint: bool,
    pub global_object: &'a JSGlobalObject,
}

impl<'a> Row<'a> {
    pub fn to_js(
        &mut self,
        global_object: &JSGlobalObject,
        array: JSValue,
        structure: JSValue,
        flags: SQLDataCellFlags,
        result_mode: SQLQueryResultMode,
        // PORT NOTE: Zig `?CachedStructure` is by-value; passed by ref here because CachedStructure is non-Copy (owns Strong + Box).
        cached_structure: Option<&CachedStructure>,
    ) -> crate::jsc::JsResult<JSValue> {
        let mut names: *mut ExternColumnIdentifier = ptr::null_mut();
        let mut names_count: u32 = 0;
        if let Some(c) = cached_structure {
            if let Some(f) = c.fields.as_deref() {
                names = f.as_ptr().cast_mut();
                names_count = f.len() as u32;
            }
        }

        SQLDataCell::construct_object_from_data_cell(
            global_object,
            array,
            structure,
            self.values.as_mut_ptr(),
            self.values.len() as u32,
            flags,
            result_mode as u8,
            names,
            names_count,
        )
    }

    pub fn decode_internal<Context: ReaderContext>(
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
                *cell = SQLDataCell {
                    tag: Tag::Float8,
                    value: Value { float8: val },
                    ..SQLDataCell::default()
                };
            }
            MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u16 = parse_int::<u16>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell {
                        tag: Tag::Uint4,
                        value: Value { uint4: val as u32 },
                        ..SQLDataCell::default()
                    };
                } else {
                    let val: i16 = parse_int::<i16>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell {
                        tag: Tag::Int4,
                        value: Value { int4: val as i32 },
                        ..SQLDataCell::default()
                    };
                }
            }
            MYSQL_TYPE_LONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u32 = parse_int::<u32>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell {
                        tag: Tag::Uint4,
                        value: Value { uint4: val },
                        ..SQLDataCell::default()
                    };
                } else {
                    let val: i32 = parse_int::<i32>(value.slice(), 10).unwrap_or(i32::MIN);
                    *cell = SQLDataCell {
                        tag: Tag::Int4,
                        value: Value { int4: val },
                        ..SQLDataCell::default()
                    };
                }
            }
            MYSQL_TYPE_INT24 => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    // TODO(port): Zig used u24; Rust has no u24 — u32 parse then mask not needed (text protocol bounds)
                    let val: u32 = parse_int::<u32>(value.slice(), 10).unwrap_or(0);
                    *cell = SQLDataCell {
                        tag: Tag::Uint4,
                        value: Value { uint4: val },
                        ..SQLDataCell::default()
                    };
                } else {
                    // std.math.minInt(i24) == -8_388_608
                    let val: i32 = parse_int::<i32>(value.slice(), 10).unwrap_or(-8_388_608);
                    *cell = SQLDataCell {
                        tag: Tag::Int4,
                        value: Value { int4: val },
                        ..SQLDataCell::default()
                    };
                }
            }
            MYSQL_TYPE_LONGLONG => {
                if column.flags.contains(ColumnFlags::UNSIGNED) {
                    let val: u64 = parse_int::<u64>(value.slice(), 10).unwrap_or(0);
                    if val <= u32::MAX as u64 {
                        *cell = SQLDataCell {
                            tag: Tag::Uint4,
                            value: Value {
                                uint4: u32::try_from(val).expect("int cast"),
                            },
                            ..SQLDataCell::default()
                        };
                        return;
                    }
                    if self.bigint {
                        *cell = SQLDataCell {
                            tag: Tag::Uint8,
                            value: Value { uint8: val },
                            ..SQLDataCell::default()
                        };
                        return;
                    }
                } else {
                    let val: i64 = parse_int::<i64>(value.slice(), 10).unwrap_or(0);
                    if val >= i32::MIN as i64 && val <= i32::MAX as i64 {
                        *cell = SQLDataCell {
                            tag: Tag::Int4,
                            value: Value {
                                int4: i32::try_from(val).expect("int cast"),
                            },
                            ..SQLDataCell::default()
                        };
                        return;
                    }
                    if self.bigint {
                        *cell = SQLDataCell {
                            tag: Tag::Int8,
                            value: Value { int8: val },
                            ..SQLDataCell::default()
                        };
                        return;
                    }
                }

                let slice = value.slice();
                *cell = SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: clone_wtf_string_or_null(slice),
                    },
                    free_value: 1,
                    ..SQLDataCell::default()
                };
            }
            MYSQL_TYPE_JSON => {
                let slice = value.slice();
                *cell = SQLDataCell {
                    tag: Tag::Json,
                    value: Value {
                        json: clone_wtf_string_or_null(slice),
                    },
                    free_value: 1,
                    ..SQLDataCell::default()
                };
            }

            MYSQL_TYPE_TIME => {
                // lets handle TIME special case as string
                // -838:59:50 to 838:59:59 is valid
                let slice = value.slice();
                *cell = SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: clone_wtf_string_or_null(slice),
                    },
                    free_value: 1,
                    ..SQLDataCell::default()
                };
            }
            MYSQL_TYPE_DATE | MYSQL_TYPE_DATETIME | MYSQL_TYPE_TIMESTAMP => {
                let mut str = BunString::init(value.slice());
                // `str` derefs on Drop.
                let date = 'brk: {
                    match crate::jsc::bun_string_jsc::parse_date(&mut str, self.global_object) {
                        Ok(d) => break 'brk d,
                        Err(err) => {
                            let _ = self.global_object.take_exception(err);
                            break 'brk f64::NAN;
                        }
                    }
                };
                *cell = SQLDataCell {
                    tag: Tag::Date,
                    value: Value { date },
                    ..SQLDataCell::default()
                };
            }
            MYSQL_TYPE_BIT => {
                // BIT(1) is a special case, it's a boolean
                if column.column_length == 1 {
                    let slice = value.slice();
                    *cell = SQLDataCell {
                        tag: Tag::Bool,
                        value: Value {
                            bool_: if !slice.is_empty() && slice[0] == 1 {
                                1
                            } else {
                                0
                            },
                        },
                        ..SQLDataCell::default()
                    };
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
                    let slice = value.slice();
                    *cell = SQLDataCell {
                        tag: Tag::String,
                        value: Value {
                            string: clone_wtf_string_or_null(slice),
                        },
                        free_value: 1,
                        ..SQLDataCell::default()
                    };
                }
            }
        }
    }

    fn decode_text<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        let cells = vec![
            SQLDataCell {
                tag: Tag::Null,
                value: Value { null: 0 },
                ..SQLDataCell::default()
            };
            self.columns.len()
        ]
        .into_boxed_slice();
        let mut cells = scopeguard::guard(cells, |mut cells| {
            for value in cells.iter_mut() {
                value.deinit();
            }
        });

        for (index, value) in cells.iter_mut().enumerate() {
            if let Some(result) = decode_length_int(reader.peek()) {
                let column = &self.columns[index];
                if result.value == 0xfb {
                    // NULL value
                    reader.skip(result.bytes_read);
                    // this dont matter if is raw because we will sent as null too like in postgres
                    *value = SQLDataCell {
                        tag: Tag::Null,
                        value: Value { null: 0 },
                        ..SQLDataCell::default()
                    };
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

        let cells = vec![
            SQLDataCell {
                tag: Tag::Null,
                value: Value { null: 0 },
                ..SQLDataCell::default()
            };
            self.columns.len()
        ]
        .into_boxed_slice();
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

            if is_null {
                *value = SQLDataCell {
                    tag: Tag::Null,
                    value: Value { null: 0 },
                    ..SQLDataCell::default()
                };
                continue;
            }

            let column = &self.columns[i];
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
            )?;
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

    // Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub fn decode<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(reader)
    }
}

impl<'a> Drop for Row<'a> {
    fn drop(&mut self) {
        for value in self.values.iter_mut() {
            // TODO(port): if SQLDataCell gains `impl Drop`, delete this loop and the Drop impl entirely.
            value.deinit();
        }
        // self.columns is intentionally left out.
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────

#[inline]
fn clone_wtf_string_or_null(slice: &[u8]) -> bun_core::WTFStringImpl {
    // Zig: `bun.String.cloneUTF8(slice).value.WTFStringImpl` — extracts the raw
    // WTFStringImpl* from a freshly-cloned bun.String (ownership transferred to the cell,
    // freed via `free_value = 1`).
    if !slice.is_empty() {
        BunString::clone_utf8(slice).leak_wtf_impl()
    } else {
        ptr::null_mut()
    }
}

// ported from: src/sql_jsc/mysql/protocol/ResultSet.zig
