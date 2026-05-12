use crate::jsc::JSGlobalObject;
#[allow(unused_imports)]
use crate::mysql::my_sql_value::Value;
use crate::mysql::my_sql_value::{DateTime, Time};
use crate::shared::sql_data_cell::SQLDataCell;
use crate::shared::sql_data_cell::{Tag as CellTag, Value as CellValue};
use bun_sql::mysql::mysql_types as types;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};

bun_core::declare_scope!(MySQLDecodeBinaryValue, visible);

/// MySQL's "binary" pseudo-charset ID. Columns with this character_set value
/// are true binary types (BINARY, VARBINARY, BLOB), as opposed to string columns
/// with binary collations (e.g., utf8mb4_bin) which have different character_set values.
pub const BINARY_CHARSET: u16 = 63;

// TODO(port): narrow error set
pub fn decode_binary_value<Context: ReaderContext>(
    global_object: &JSGlobalObject,
    field_type: types::FieldType,
    column_length: u32,
    raw: bool,
    bigint: bool,
    unsigned: bool,
    binary: bool,
    character_set: u16,
    reader: NewReader<Context>,
) -> Result<SQLDataCell, bun_core::Error> {
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
                return Ok(SQLDataCell {
                    tag: CellTag::Uint4,
                    value: CellValue { uint4: val as u32 },
                    ..Default::default()
                });
            }
            let ival: i8 = val as i8;
            Ok(SQLDataCell {
                tag: CellTag::Int4,
                value: CellValue { int4: ival as i32 },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_SHORT => {
            if raw {
                let data = reader.read(2)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            if unsigned {
                return Ok(SQLDataCell {
                    tag: CellTag::Uint4,
                    value: CellValue {
                        uint4: reader.int::<u16>()? as u32,
                    },
                    ..Default::default()
                });
            }
            Ok(SQLDataCell {
                tag: CellTag::Int4,
                value: CellValue {
                    int4: reader.int::<i16>()? as i32,
                },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_INT24 => {
            if raw {
                let data = reader.read(3)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            if unsigned {
                return Ok(SQLDataCell {
                    tag: CellTag::Uint4,
                    value: CellValue {
                        uint4: reader.int_u24()?,
                    },
                    ..Default::default()
                });
            }
            Ok(SQLDataCell {
                tag: CellTag::Int4,
                value: CellValue {
                    int4: reader.int_i24()?,
                },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_LONG => {
            if raw {
                let data = reader.read(4)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            if unsigned {
                return Ok(SQLDataCell {
                    tag: CellTag::Uint4,
                    value: CellValue {
                        uint4: reader.int::<u32>()?,
                    },
                    ..Default::default()
                });
            }
            Ok(SQLDataCell {
                tag: CellTag::Int4,
                value: CellValue {
                    int4: reader.int::<i32>()?,
                },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_LONGLONG => {
            if raw {
                return Ok(SQLDataCell::raw(Some(&reader.read(8)?)));
            }
            if unsigned {
                let val = reader.int::<u64>()?;
                if val <= u32::MAX as u64 {
                    return Ok(SQLDataCell {
                        tag: CellTag::Uint4,
                        value: CellValue {
                            uint4: u32::try_from(val).expect("int cast"),
                        },
                        ..Default::default()
                    });
                }
                if bigint {
                    return Ok(SQLDataCell {
                        tag: CellTag::Uint8,
                        value: CellValue { uint8: val },
                        ..Default::default()
                    });
                }
                let mut buffer = bun_core::fmt::ItoaBuf::new();
                let slice = bun_core::fmt::itoa(&mut buffer, val);
                return Ok(SQLDataCell {
                    tag: CellTag::String,
                    value: CellValue {
                        string: if !slice.is_empty() {
                            clone_utf8_wtf_impl(slice)
                        } else {
                            core::ptr::null_mut()
                        },
                    },
                    free_value: 1,
                    ..Default::default()
                });
            }
            let val = reader.int::<i64>()?;
            if val >= i32::MIN as i64 && val <= i32::MAX as i64 {
                return Ok(SQLDataCell {
                    tag: CellTag::Int4,
                    value: CellValue {
                        int4: i32::try_from(val).expect("int cast"),
                    },
                    ..Default::default()
                });
            }
            if bigint {
                return Ok(SQLDataCell {
                    tag: CellTag::Int8,
                    value: CellValue { int8: val },
                    ..Default::default()
                });
            }
            let mut buffer = bun_core::fmt::ItoaBuf::new();
            let slice = bun_core::fmt::itoa(&mut buffer, val);
            Ok(SQLDataCell {
                tag: CellTag::String,
                value: CellValue {
                    string: if !slice.is_empty() {
                        clone_utf8_wtf_impl(slice)
                    } else {
                        core::ptr::null_mut()
                    },
                },
                free_value: 1,
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_FLOAT => {
            if raw {
                let data = reader.read(4)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            Ok(SQLDataCell {
                tag: CellTag::Float8,
                value: CellValue {
                    float8: f32::from_bits(reader.int::<u32>()?) as f64,
                },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_DOUBLE => {
            if raw {
                let data = reader.read(8)?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            Ok(SQLDataCell {
                tag: CellTag::Float8,
                value: CellValue {
                    float8: f64::from_bits(reader.int::<u64>()?),
                },
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_TIME => {
            match reader.byte()? {
                0 => {
                    let slice = b"00:00:00";
                    Ok(SQLDataCell {
                        tag: CellTag::String,
                        value: CellValue {
                            string: if !slice.is_empty() {
                                clone_utf8_wtf_impl(slice)
                            } else {
                                core::ptr::null_mut()
                            },
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                }
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
                                return Err(bun_core::err!("InvalidBinaryValue"));
                            }
                        } else {
                            if write!(
                                w,
                                "{}{:02}:{:02}:{:02}",
                                sign, total_hours, time.minutes, time.seconds
                            )
                            .is_err()
                            {
                                return Err(bun_core::err!("InvalidBinaryValue"));
                            }
                        }
                        let remaining = w.len();
                        break 'brk &buffer[..32 - remaining];
                    };
                    // PORT NOTE: reshaped for borrowck — compute remaining before re-borrowing buffer
                    Ok(SQLDataCell {
                        tag: CellTag::String,
                        value: CellValue {
                            string: if !slice.is_empty() {
                                clone_utf8_wtf_impl(slice)
                            } else {
                                core::ptr::null_mut()
                            },
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                }
                _ => Err(bun_core::err!("InvalidBinaryValue")),
            }
        }
        FieldType::MYSQL_TYPE_DATE
        | FieldType::MYSQL_TYPE_TIMESTAMP
        | FieldType::MYSQL_TYPE_DATETIME => match reader.byte()? {
            0 => Ok(SQLDataCell {
                tag: CellTag::Date,
                value: CellValue { date: 0.0 },
                ..Default::default()
            }),
            l @ (11 | 7 | 4) => {
                let data = reader.read(l as usize)?;
                let time = DateTime::from_data(&data)?;
                // PORT NOTE: Zig's `!SQLDataCell` is anyerror; map JsError variants to their
                // interned bun_core::Error names so `?` can widen here.
                let ts = time.to_js_timestamp(global_object).map_err(|e| match e {
                    bun_jsc::JsError::OutOfMemory => bun_core::err!("OutOfMemory"),
                    bun_jsc::JsError::Terminated => bun_core::err!("Terminated"),
                    bun_jsc::JsError::Thrown => bun_core::err!("Thrown"),
                })?;
                Ok(SQLDataCell {
                    tag: CellTag::Date,
                    value: CellValue { date: ts },
                    ..Default::default()
                })
            }
            _ => Err(bun_core::err!("InvalidBinaryValue")),
        },

        // When the column contains a binary string we return a Buffer otherwise a string
        FieldType::MYSQL_TYPE_ENUM
        | FieldType::MYSQL_TYPE_SET
        | FieldType::MYSQL_TYPE_GEOMETRY
        | FieldType::MYSQL_TYPE_NEWDECIMAL
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
            let slice = string_data.slice();
            Ok(SQLDataCell {
                tag: CellTag::String,
                value: CellValue {
                    string: if !slice.is_empty() {
                        clone_utf8_wtf_impl(slice)
                    } else {
                        core::ptr::null_mut()
                    },
                },
                free_value: 1,
                ..Default::default()
            })
        }

        FieldType::MYSQL_TYPE_JSON => {
            if raw {
                let data = reader.encode_len_string()?;
                return Ok(SQLDataCell::raw(Some(&data)));
            }
            let string_data = reader.encode_len_string()?;
            let slice = string_data.slice();
            Ok(SQLDataCell {
                tag: CellTag::Json,
                value: CellValue {
                    json: if !slice.is_empty() {
                        clone_utf8_wtf_impl(slice)
                    } else {
                        core::ptr::null_mut()
                    },
                },
                free_value: 1,
                ..Default::default()
            })
        }
        FieldType::MYSQL_TYPE_BIT => {
            // BIT(1) is a special case, it's a boolean
            if column_length == 1 {
                let data = reader.encode_len_string()?;
                let slice = data.slice();
                Ok(SQLDataCell {
                    tag: CellTag::Bool,
                    value: CellValue {
                        bool_: if !slice.is_empty() && slice[0] == 1 {
                            1
                        } else {
                            0
                        },
                    },
                    ..Default::default()
                })
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

// Zig accesses `bun.String.cloneUTF8(slice).value.WTFStringImpl` directly (union field);
// `leak_wtf_impl()` is the Rust equivalent — transfers the +1 ref to the cell (`free_value = 1`).
#[inline]
fn clone_utf8_wtf_impl(slice: &[u8]) -> bun_core::WTFStringImpl {
    bun_core::String::clone_utf8(slice).leak_wtf_impl()
}

// ported from: src/sql_jsc/mysql/protocol/DecodeBinaryValue.zig
