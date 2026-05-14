//! Port of src/sql_jsc/postgres/DataCell.zig

use core::mem::size_of;

use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::String as BunString;
use bun_core::err;

use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::AnyPostgresError;
use bun_sql::shared::data::Data;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as PostgresSQLQueryResultMode;

pub use crate::shared::sql_data_cell::SQLDataCell;
// Zig nested-type style (`SQLDataCell.Tag.Bytea`) → flat re-exports; see sed
// rewrite below replacing `SQLDataCell::X` with bare `X`.
pub use crate::shared::sql_data_cell::{Array, Flags, Raw, Tag, TypedArray, Value};
use bun_sql::shared::column_identifier::ColumnIdentifier;

// TODO(port): narrow error set — Zig used inferred error sets that flow into
// AnyPostgresError. Phase B should confirm AnyPostgresError covers all variants
// referenced via `err!(...)` here.
type Result<T, E = AnyPostgresError> = core::result::Result<T, E>;

bun_core::declare_scope!(Postgres, visible);
bun_core::declare_scope!(PostgresDataCell, visible);

fn parse_bytea(hex: &[u8]) -> Result<SQLDataCell> {
    let len = hex.len() / 2;
    let mut buf = vec![0u8; len].into_boxed_slice();
    // errdefer free(buf) → Box drops on `?`

    let written = bun_core::decode_hex_to_bytes(&mut buf, hex)
        .map_err(|_| AnyPostgresError::InvalidByteSequence)?;
    let ptr = bun_core::heap::into_raw(buf).cast::<u8>();

    Ok(SQLDataCell {
        tag: Tag::Bytea,
        value: Value {
            bytea: [ptr as usize, written],
        },
        free_value: 1,
        ..Default::default()
    })
}

fn unescape_postgres_string<'a>(
    input: &[u8],
    buffer: &'a mut [u8],
) -> Result<&'a mut [u8], bun_core::Error> {
    let mut out_index: usize = 0;
    let mut i: usize = 0;

    while i < input.len() {
        if out_index >= buffer.len() {
            return Err(err!("BufferTooSmall"));
        }

        if input[i] == b'\\' && i + 1 < input.len() {
            i += 1;
            match input[i] {
                // Common escapes
                b'b' => buffer[out_index] = 0x08,   // Backspace
                b'f' => buffer[out_index] = 0x0C,   // Form feed
                b'n' => buffer[out_index] = b'\n',  // Line feed
                b'r' => buffer[out_index] = b'\r',  // Carriage return
                b't' => buffer[out_index] = b'\t',  // Tab
                b'"' => buffer[out_index] = b'"',   // Double quote
                b'\\' => buffer[out_index] = b'\\', // Backslash
                b'\'' => buffer[out_index] = b'\'', // Single quote

                // JSON allows forward slash escaping
                b'/' => buffer[out_index] = b'/',

                // PostgreSQL hex escapes (used for unicode too)
                b'x' => {
                    if i + 2 >= input.len() {
                        return Err(err!("InvalidEscapeSequence"));
                    }
                    let hex_value = bun_core::fmt::parse_int::<u8>(&input[i + 1..i + 3], 16)
                        .map_err(|_| err!("InvalidEscapeSequence"))?;
                    buffer[out_index] = hex_value;
                    i += 2;
                }

                _ => return Err(err!("UnknownEscapeSequence")),
            }
        } else {
            buffer[out_index] = input[i];
        }
        out_index += 1;
        i += 1;
    }

    Ok(&mut buffer[0..out_index])
}

fn try_slice(slice: &[u8], count: usize) -> &[u8] {
    if slice.len() <= count {
        return b"";
    }
    &slice[count..]
}

const MAX_ARRAY_NESTING_DEPTH: usize = 100;

// PERF(port): `array_type` and `is_json_sub_array` were `comptime` in Zig (per-variant
// monomorphization). Demoted to runtime here because they are only used in value
// position (branch selectors), never type position. Profile in Phase B.
fn parse_array(
    bytes: &[u8],
    bigint: bool,
    array_type: types::Tag,
    global_object: &JSGlobalObject,
    offset: Option<&mut usize>,
    is_json_sub_array: bool,
    depth: usize,
) -> Result<SQLDataCell> {
    if depth > MAX_ARRAY_NESTING_DEPTH {
        return Err(AnyPostgresError::UnsupportedArrayFormat);
    }
    let closing_brace: u8 = if is_json_sub_array { b']' } else { b'}' };
    let opening_brace: u8 = if is_json_sub_array { b'[' } else { b'{' };
    if bytes.len() < 2 || bytes[0] != opening_brace {
        return Err(AnyPostgresError::UnsupportedArrayFormat);
    }
    // empty array
    if bytes.len() == 2 && bytes[1] == closing_brace {
        if let Some(offset_ptr) = offset {
            *offset_ptr = 2;
        }
        return Ok(SQLDataCell {
            tag: Tag::Array,
            value: Value {
                array: Array {
                    ptr: core::ptr::null_mut(),
                    len: 0,
                    cap: 0,
                },
            },
            ..Default::default()
        });
    }

    // errdefer { for cell in array { cell.deinit() }; array.deinit() }
    // → scopeguard: SQLDataCell has FFI-side resources that Vec::drop won't release.
    let array = scopeguard::guard(Vec::<SQLDataCell>::new(), |mut a| {
        for cell in a.iter_mut() {
            cell.deinit();
        }
        // Vec storage drops here
    });
    let mut array = array;

    let mut stack_buffer = [0u8; 16 * 1024];

    let mut slice = &bytes[1..];
    let mut reached_end = false;
    let separator: u8 = match array_type {
        types::Tag::box_array => b';',
        _ => b',',
    };

    while !slice.is_empty() {
        let ch = slice[0];
        if ch == closing_brace {
            if reached_end {
                // cannot reach end twice
                return Err(AnyPostgresError::UnsupportedArrayFormat);
            }
            // end of array
            reached_end = true;
            slice = try_slice(slice, 1);
            break;
        } else if ch == opening_brace {
            let mut sub_array_offset: usize = 0;
            let sub_array = parse_array(
                slice,
                bigint,
                array_type,
                global_object,
                Some(&mut sub_array_offset),
                is_json_sub_array,
                depth + 1,
            )?;
            // errdefer sub_array.deinit() — Vec::push cannot fail in Rust (aborts on OOM)
            array.push(sub_array);
            slice = try_slice(slice, sub_array_offset);
            continue;
        } else if ch == b'"' {
            // parse string
            let mut current_idx: usize = 0;
            let source = &slice[1..];
            // simple escape check to avoid something like "\\\\" and "\""
            let mut is_escaped = false;
            for (index, &byte) in source.iter().enumerate() {
                if byte == b'"' && !is_escaped {
                    current_idx = index + 1;
                    break;
                }
                is_escaped = !is_escaped && byte == b'\\';
            }
            // did not find a closing quote
            if current_idx == 0 {
                return Err(AnyPostgresError::UnsupportedArrayFormat);
            }
            match array_type {
                types::Tag::bytea_array => {
                    // this is a bytea array so we need to parse the bytea strings
                    let bytea_bytes = &slice[1..current_idx];
                    if bytea_bytes.starts_with(b"\\\\x") {
                        // its a bytea string lets parse it as a bytea
                        array.push(parse_bytea(&bytea_bytes[3..][0..bytea_bytes.len() - 3])?);
                        slice = try_slice(slice, current_idx + 1);
                        continue;
                    }
                    // invalid bytea array
                    return Err(AnyPostgresError::UnsupportedByteaFormat);
                }
                types::Tag::timestamptz_array
                | types::Tag::timestamp_array
                | types::Tag::date_array => {
                    let date_str = &slice[1..current_idx];
                    let mut str = BunString::init(date_str);
                    // defer str.deref() → Drop on BunString
                    array.push(SQLDataCell {
                        tag: Tag::Date,
                        value: Value {
                            date: crate::jsc::bun_string_jsc::parse_date(&mut str, global_object)
                                .map_err(crate::jsc::js_error_to_postgres)?,
                        },
                        ..Default::default()
                    });

                    slice = try_slice(slice, current_idx + 1);
                    continue;
                }
                types::Tag::json_array | types::Tag::jsonb_array => {
                    let str_bytes = &slice[1..current_idx];
                    let needs_dynamic_buffer = str_bytes.len() > stack_buffer.len();
                    let mut dyn_buffer: Vec<u8>;
                    let buffer: &mut [u8] = if needs_dynamic_buffer {
                        dyn_buffer = vec![0u8; str_bytes.len()];
                        &mut dyn_buffer[..]
                    } else {
                        &mut stack_buffer[0..str_bytes.len()]
                    };
                    let unescaped = unescape_postgres_string(str_bytes, buffer)
                        .map_err(|_| AnyPostgresError::InvalidByteSequence)?;
                    array.push(SQLDataCell {
                        tag: Tag::Json,
                        value: Value {
                            json: if !unescaped.is_empty() {
                                BunString::clone_utf8(unescaped).leak_wtf_impl()
                                // TODO(port): .value.WTFStringImpl accessor name
                            } else {
                                core::ptr::null_mut()
                            },
                        },
                        free_value: 1,
                        ..Default::default()
                    });
                    slice = try_slice(slice, current_idx + 1);
                    continue;
                }
                _ => {}
            }
            let str_bytes = &slice[1..current_idx];
            if str_bytes.is_empty() {
                // empty string
                array.push(SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: core::ptr::null_mut(),
                    },
                    free_value: 1,
                    ..Default::default()
                });
                slice = try_slice(slice, current_idx + 1);
                continue;
            }
            let needs_dynamic_buffer = str_bytes.len() > stack_buffer.len();
            let mut dyn_buffer: Vec<u8>;
            let buffer: &mut [u8] = if needs_dynamic_buffer {
                dyn_buffer = vec![0u8; str_bytes.len()];
                &mut dyn_buffer[..]
            } else {
                &mut stack_buffer[0..str_bytes.len()]
            };
            let string_bytes = unescape_postgres_string(str_bytes, buffer)
                .map_err(|_| AnyPostgresError::InvalidByteSequence)?;
            array.push(SQLDataCell {
                tag: Tag::String,
                value: Value {
                    string: if !string_bytes.is_empty() {
                        BunString::clone_utf8(string_bytes).leak_wtf_impl()
                    } else {
                        core::ptr::null_mut()
                    },
                },
                free_value: 1,
                ..Default::default()
            });

            slice = try_slice(slice, current_idx + 1);
            continue;
        } else if ch == separator {
            // next element or positive number, just advance
            slice = try_slice(slice, 1);
            continue;
        } else {
            match array_type {
                // timez, date, time, interval are handled like single string cases
                types::Tag::timetz_array
                | types::Tag::date_array
                | types::Tag::time_array
                | types::Tag::interval_array
                // text array types
                | types::Tag::bpchar_array
                | types::Tag::varchar_array
                | types::Tag::char_array
                | types::Tag::text_array
                | types::Tag::name_array
                | types::Tag::numeric_array
                | types::Tag::money_array
                | types::Tag::varbit_array
                | types::Tag::int2vector_array
                | types::Tag::bit_array
                | types::Tag::path_array
                | types::Tag::xml_array
                | types::Tag::point_array
                | types::Tag::lseg_array
                | types::Tag::box_array
                | types::Tag::polygon_array
                | types::Tag::line_array
                | types::Tag::cidr_array
                | types::Tag::circle_array
                | types::Tag::macaddr8_array
                | types::Tag::macaddr_array
                | types::Tag::inet_array
                | types::Tag::aclitem_array
                | types::Tag::pg_database_array
                | types::Tag::pg_database_array2 => {
                    // this is also a string until we reach "," or "}" but a single word string like Bun
                    let mut current_idx: usize = 0;

                    for (index, &byte) in slice.iter().enumerate() {
                        if byte == b'}' || byte == separator {
                            current_idx = index;
                            break;
                        }
                    }
                    if current_idx == 0 {
                        return Err(AnyPostgresError::UnsupportedArrayFormat);
                    }
                    let element = &slice[0..current_idx];
                    // lets handle NULL case here, if is a string "NULL" it will have quotes, if its a NULL it will be just NULL
                    if element == b"NULL" {
                        array.push(SQLDataCell {
                            tag: Tag::Null,
                            value: Value { null: 0 },
                            ..Default::default()
                        });
                        slice = try_slice(slice, current_idx);
                        continue;
                    }
                    if array_type == types::Tag::date_array {
                        let mut str = BunString::init(element);
                        array.push(SQLDataCell {
                            tag: Tag::Date,
                            value: Value { date: crate::jsc::bun_string_jsc::parse_date(&mut str, global_object).map_err(crate::jsc::js_error_to_postgres)? },
                            ..Default::default()
                        });
                    } else {
                        // the only escape sequency possible here is \b
                        if element == b"\\b" {
                            array.push(SQLDataCell {
                                tag: Tag::String,
                                value: Value {
                                    string: BunString::clone_utf8(b"\x08").leak_wtf_impl(),
                                },
                                free_value: 1,
                                ..Default::default()
                            });
                        } else {
                            array.push(SQLDataCell {
                                tag: Tag::String,
                                value: Value {
                                    string: if !element.is_empty() {
                                        BunString::clone_utf8(element).leak_wtf_impl()
                                    } else {
                                        core::ptr::null_mut()
                                    },
                                },
                                free_value: 1,
                                ..Default::default()
                            });
                        }
                    }
                    slice = try_slice(slice, current_idx);
                    continue;
                }
                _ => {
                    // non text array, NaN, Null, False, True etc are special cases here
                    match slice[0] {
                        b'N' => {
                            // null or nan
                            if slice.len() < 3 {
                                return Err(AnyPostgresError::UnsupportedArrayFormat);
                            }
                            if slice.len() >= 4 {
                                if &slice[0..4] == b"NULL" {
                                    array.push(SQLDataCell {
                                        tag: Tag::Null,
                                        value: Value { null: 0 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 4);
                                    continue;
                                }
                            }
                            if &slice[0..3] == b"NaN" {
                                array.push(SQLDataCell {
                                    tag: Tag::Float8,
                                    value: Value { float8: f64::NAN },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 3);
                                continue;
                            }
                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                        }
                        b'f' => {
                            // false
                            if array_type == types::Tag::json_array || array_type == types::Tag::jsonb_array {
                                if slice.len() < 5 {
                                    return Err(AnyPostgresError::UnsupportedArrayFormat);
                                }
                                if &slice[0..5] == b"false" {
                                    array.push(SQLDataCell {
                                        tag: Tag::Bool,
                                        value: Value { bool_: 0 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 5);
                                    continue;
                                }
                            } else {
                                array.push(SQLDataCell {
                                    tag: Tag::Bool,
                                    value: Value { bool_: 0 },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 1);
                                continue;
                            }
                        }
                        b't' => {
                            // true
                            if array_type == types::Tag::json_array || array_type == types::Tag::jsonb_array {
                                if slice.len() < 4 {
                                    return Err(AnyPostgresError::UnsupportedArrayFormat);
                                }
                                if &slice[0..4] == b"true" {
                                    array.push(SQLDataCell {
                                        tag: Tag::Bool,
                                        value: Value { bool_: 1 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 4);
                                    continue;
                                }
                            } else {
                                array.push(SQLDataCell {
                                    tag: Tag::Bool,
                                    value: Value { bool_: 1 },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 1);
                                continue;
                            }
                        }
                        b'I' | b'i' => {
                            // infinity
                            if bun_core::strings::starts_with_case_insensitive_ascii(slice, b"Infinity") {
                                if matches!(
                                    array_type,
                                    types::Tag::date_array | types::Tag::timestamp_array | types::Tag::timestamptz_array
                                ) {
                                    array.push(SQLDataCell {
                                        tag: Tag::Date,
                                        value: Value { date: f64::INFINITY },
                                        ..Default::default()
                                    });
                                } else {
                                    array.push(SQLDataCell {
                                        tag: Tag::Float8,
                                        value: Value { float8: f64::INFINITY },
                                        ..Default::default()
                                    });
                                }
                                slice = try_slice(slice, 8);
                                continue;
                            }

                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                        }
                        b'+' => {
                            slice = try_slice(slice, 1);
                            continue;
                        }
                        b'-' | b'0'..=b'9' => {
                            // parse number, detect float, int, if starts with - it can be -Infinity or -Infinity
                            let mut is_negative = false;
                            let mut is_float = false;
                            let mut current_idx: usize = 0;
                            let mut is_infinity = false;
                            // track exponent stuff (1.1e-12, 1.1e+12)
                            let mut has_exponent = false;
                            let mut has_negative_sign = false;
                            let mut has_positive_sign = false;
                            // PORT NOTE: reshaped for borrowck — Zig mutates `slice` mid-loop while
                            // iterating it (the Infinity arm). We capture the advance amount and
                            // apply after the loop.
                            let mut advance_after: Option<usize> = None;
                            for (index, &byte) in slice.iter().enumerate() {
                                match byte {
                                    b'0'..=b'9' => {}
                                    _ if byte == closing_brace || byte == separator => {
                                        current_idx = index;
                                        // end of element
                                        break;
                                    }
                                    b'e' => {
                                        if !is_float {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        if has_exponent {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        has_exponent = true;
                                        continue;
                                    }
                                    b'+' => {
                                        if !has_exponent {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        if has_positive_sign {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        has_positive_sign = true;
                                        continue;
                                    }
                                    b'-' => {
                                        if index == 0 {
                                            is_negative = true;
                                            continue;
                                        }
                                        if !has_exponent {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        if has_negative_sign {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        has_negative_sign = true;
                                        continue;
                                    }
                                    b'.' => {
                                        // we can only have one dot and the dot must be before the exponent
                                        if is_float {
                                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                                        }
                                        is_float = true;
                                    }
                                    b'I' | b'i' => {
                                        // infinity
                                        is_infinity = true;
                                        let element = if is_negative { &slice[1..] } else { slice };
                                        if bun_core::strings::starts_with_case_insensitive_ascii(element, b"Infinity") {
                                            let val = if is_negative { -f64::INFINITY } else { f64::INFINITY };
                                            if matches!(
                                                array_type,
                                                types::Tag::date_array
                                                    | types::Tag::timestamp_array
                                                    | types::Tag::timestamptz_array
                                            ) {
                                                array.push(SQLDataCell {
                                                    tag: Tag::Date,
                                                    value: Value { date: val },
                                                    ..Default::default()
                                                });
                                            } else {
                                                array.push(SQLDataCell {
                                                    tag: Tag::Float8,
                                                    value: Value { float8: val },
                                                    ..Default::default()
                                                });
                                            }
                                            advance_after = Some(8 + (is_negative as usize));
                                            break;
                                        }

                                        return Err(AnyPostgresError::UnsupportedArrayFormat);
                                    }
                                    _ => {
                                        return Err(AnyPostgresError::UnsupportedArrayFormat);
                                    }
                                }
                            }
                            if let Some(n) = advance_after {
                                slice = try_slice(slice, n);
                            }
                            if is_infinity {
                                continue;
                            }
                            if current_idx == 0 {
                                return Err(AnyPostgresError::UnsupportedArrayFormat);
                            }
                            let element = &slice[0..current_idx];
                            if is_float || array_type == types::Tag::float8_array {
                                array.push(SQLDataCell {
                                    tag: Tag::Float8,
                                    value: Value {
                                        float8: bun_core::parse_double(element).unwrap_or(f64::NAN),
                                    },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, current_idx);
                                continue;
                            }
                            match array_type {
                                types::Tag::int8_array => {
                                    if bigint {
                                        array.push(SQLDataCell {
                                            tag: Tag::Int8,
                                            value: Value {
                                                int8: bun_core::fmt::parse_decimal::<i64>(element)
                                                    .ok_or(AnyPostgresError::UnsupportedArrayFormat)?,
                                            },
                                            ..Default::default()
                                        });
                                    } else {
                                        array.push(SQLDataCell {
                                            tag: Tag::String,
                                            value: Value {
                                                string: if !element.is_empty() {
                                                    BunString::clone_utf8(element).leak_wtf_impl()
                                                } else {
                                                    core::ptr::null_mut()
                                                },
                                            },
                                            free_value: 1,
                                            ..Default::default()
                                        });
                                    }
                                    slice = try_slice(slice, current_idx);
                                    continue;
                                }
                                types::Tag::cid_array | types::Tag::xid_array | types::Tag::oid_array => {
                                    array.push(SQLDataCell {
                                        tag: Tag::Uint4,
                                        value: Value {
                                            uint4: bun_core::fmt::parse_decimal::<u32>(element).unwrap_or(0),
                                        },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, current_idx);
                                    continue;
                                }
                                _ => {
                                    let value = bun_core::fmt::parse_decimal::<i32>(element)
                                        .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;

                                    array.push(SQLDataCell {
                                        tag: Tag::Int4,
                                        value: Value {
                                            // @intCast(value) — i32 → i32, identity here
                                            int4: value,
                                        },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, current_idx);
                                    continue;
                                }
                            }
                        }
                        _ => {
                            if array_type == types::Tag::json_array || array_type == types::Tag::jsonb_array {
                                if slice[0] == b'[' {
                                    let mut sub_array_offset: usize = 0;
                                    let sub_array = parse_array(
                                        slice,
                                        bigint,
                                        array_type,
                                        global_object,
                                        Some(&mut sub_array_offset),
                                        true,
                                        depth + 1,
                                    )?;
                                    array.push(sub_array);
                                    slice = try_slice(slice, sub_array_offset);
                                    continue;
                                }
                            }
                            return Err(AnyPostgresError::UnsupportedArrayFormat);
                        }
                    }
                }
            }
        }
    }

    if let Some(offset_ptr) = offset {
        *offset_ptr = bytes.len() - slice.len();
    }

    // postgres dont really support arrays with more than 2^31 elements, 2ˆ32 is the max we support, but users should never reach this branch
    if !reached_end || array.len() > u32::MAX as usize {
        bun_core::hint::cold();
        return Err(AnyPostgresError::UnsupportedArrayFormat);
    }

    // disarm errdefer
    let mut array = scopeguard::ScopeGuard::into_inner(array);
    let len = array.len() as u32;
    let cap = array.capacity() as u32;
    let ptr = array.as_mut_ptr();
    core::mem::forget(array);
    Ok(SQLDataCell {
        tag: Tag::Array,
        value: Value {
            array: Array { ptr, len, cap },
        },
        free_value: 1,
        ..Default::default()
    })
}

// Helper: typed-array binary path shared by .int4_array / .float4_array.
// PORT NOTE: Zig used `inline ... => |tag|` to capture the comptime tag and call
// `tag.toJSTypedArrayType()` / `tag.byteArrayType()` / `tag.pgArrayType()` in type
// position. Those return types, so we monomorphize over the element type here.
fn from_bytes_typed_array<Elem: bun_sql::postgres::types::tag::WireByteSwap>(
    tag: types::Tag,
    bytes: &[u8],
) -> Result<SQLDataCell> {
    if bytes.len() < 12 {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    // https://github.com/postgres/postgres/blob/master/src/backend/utils/adt/arrayfuncs.c#L1549-L1645
    let dimensions_raw: types::int4 =
        u32::from_ne_bytes(bytes[0..4].try_into().expect("infallible: size matches"));
    let contains_nulls: types::int4 =
        u32::from_ne_bytes(bytes[4..8].try_into().expect("infallible: size matches"));

    let dimensions = dimensions_raw.swap_bytes();
    if dimensions > 1 {
        return Err(AnyPostgresError::MultidimensionalArrayNotSupportedYet);
    }

    if contains_nulls != 0 {
        return Err(AnyPostgresError::NullsInArrayNotSupportedYet);
    }

    let js_typed_array_type = crate::postgres::types::tag_jsc::to_js_typed_array_type(tag)
        .map_err(|_| AnyPostgresError::InvalidBinaryData)?;

    if dimensions == 0 {
        return Ok(SQLDataCell {
            tag: Tag::TypedArray,
            value: Value {
                typed_array: TypedArray {
                    head_ptr: core::ptr::null_mut(),
                    ptr: core::ptr::null_mut(),
                    len: 0,
                    byte_len: 0,
                    type_: js_typed_array_type,
                },
            },
            ..Default::default()
        });
    }

    // dimensions == 1 here. The 1-D binary array header is 20 bytes:
    // ndim(4) + flags(4) + elemtype(4) + len(4) + lbound(4), followed by
    // `len` elements each prefixed by a 4-byte length. `len` is
    // server-controlled, so validate it against bytes.len before
    // slice() iterates to avoid reading/writing past the buffer.
    if bytes.len() < 20 {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    let array_len: i32 =
        i32::from_ne_bytes(bytes[12..16].try_into().expect("infallible: size matches"))
            .swap_bytes();
    if array_len < 0 {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    // slice() consumes 2 * @sizeOf(element) bytes per element (the
    // 4-byte length prefix + the 4-byte value for int4/float4).
    let element_stride: usize = size_of::<Elem>() * 2;
    let max_elements = (bytes.len() - 20) / element_stride;
    if usize::try_from(array_len).expect("int cast") > max_elements {
        return Err(AnyPostgresError::InvalidBinaryData);
    }

    // Zig: `tag.pgArrayType().init(bytes).slice()` byte-swaps the wire
    // header and elements in place inside the recv buffer. The Rust port
    // cannot soundly mutate through a pointer derived from `bytes: &[u8]`
    // — the `readonly` LLVM parameter attribute lets the optimizer elide
    // those writes, which in the release-asan build left the header `len`
    // un-byte-swapped (3 → 0x03000000) and produced a 192MB OOB memcpy in
    // SQLClient.cpp. Parse into an owned buffer instead; freed via
    // `free_value = 1` after C++ has copied it into the JS typed array.
    let array_len = array_len as usize;
    let elem_size = size_of::<Elem>();
    let out_bytes = array_len * elem_size;
    let (head_ptr, free_value) = if array_len == 0 {
        (core::ptr::null_mut::<u8>(), 0u8)
    } else {
        let mut out: Box<[u8]> = vec![0u8; out_bytes].into_boxed_slice();
        for i in 0..array_len {
            // Wire layout per element for the 4-byte types this path
            // supports (int4/float4): [elem_size length prefix][elem_size value]
            // — same stride `slice()` walks in the Zig spec.
            let src_off = 20 + i * element_stride + (element_stride - elem_size);
            // `bytes.len() >= 20 + array_len*element_stride` was validated
            // above; `out` has `array_len*elem_size` bytes. The trait's
            // `from_unaligned_ne_bytes`/`write_unaligned_ne_bytes` are safe
            // `from_ne_bytes`/`to_ne_bytes` round-trips (bounds-checked), so
            // the per-element POD cast needs no raw-pointer access.
            let val: Elem = Elem::from_unaligned_ne_bytes(&bytes[src_off..src_off + elem_size])
                .wire_byte_swap();
            val.write_unaligned_ne_bytes(&mut out[i * elem_size..(i + 1) * elem_size]);
        }
        (Box::into_raw(out).cast::<u8>(), 1u8)
    };

    Ok(SQLDataCell {
        tag: Tag::TypedArray,
        value: Value {
            typed_array: TypedArray {
                head_ptr,
                ptr: head_ptr,
                len: array_len as u32,
                byte_len: out_bytes as u32,
                type_: js_typed_array_type,
            },
        },
        free_value,
        ..Default::default()
    })
}

pub fn from_bytes(
    binary: bool,
    bigint: bool,
    oid: types::Tag,
    bytes: &[u8],
    global_object: &JSGlobalObject,
) -> Result<SQLDataCell> {
    use types::Tag as T;
    match oid {
        // TODO: .int2_array, .float8_array
        T::int4_array => {
            if binary {
                from_bytes_typed_array::<i32>(T::int4_array, bytes)
            } else {
                parse_array(bytes, bigint, T::int4_array, global_object, None, false, 0)
            }
        }
        T::float4_array => {
            if binary {
                from_bytes_typed_array::<f32>(T::float4_array, bytes)
            } else {
                parse_array(bytes, bigint, T::float4_array, global_object, None, false, 0)
            }
        }
        T::int2 => {
            if binary {
                Ok(SQLDataCell {
                    tag: Tag::Int4,
                    value: Value { int4: parse_binary_int2(bytes)? as i32 },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: Tag::Int4,
                    value: Value { int4: bun_core::fmt::parse_decimal::<i32>(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        T::cid | T::xid | T::oid => {
            if binary {
                Ok(SQLDataCell {
                    tag: Tag::Uint4,
                    value: Value { uint4: parse_binary_oid(bytes)? },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: Tag::Uint4,
                    value: Value { uint4: bun_core::fmt::parse_decimal::<u32>(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        T::int4 => {
            if binary {
                Ok(SQLDataCell {
                    tag: Tag::Int4,
                    value: Value { int4: parse_binary_int4(bytes)? },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: Tag::Int4,
                    value: Value { int4: bun_core::fmt::parse_decimal::<i32>(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        // postgres when reading bigint as int8 it returns a string unless type: { bigint: postgres.BigInt is set
        T::int8 => {
            if bigint {
                // .int8 is a 64-bit integer always string
                Ok(SQLDataCell {
                    tag: Tag::Int8,
                    value: Value { int8: bun_core::fmt::parse_decimal::<i64>(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: if !bytes.is_empty() {
                            BunString::clone_utf8(bytes).leak_wtf_impl()
                        } else {
                            core::ptr::null_mut()
                        },
                    },
                    free_value: 1,
                    ..Default::default()
                })
            }
        }
        T::float8 => {
            if binary && bytes.len() == 8 {
                Ok(SQLDataCell {
                    tag: Tag::Float8,
                    value: Value { float8: parse_binary_float8(bytes)? },
                    ..Default::default()
                })
            } else {
                let float8: f64 = bun_core::parse_double(bytes).unwrap_or(f64::NAN);
                Ok(SQLDataCell {
                    tag: Tag::Float8,
                    value: Value { float8 },
                    ..Default::default()
                })
            }
        }
        T::float4 => {
            if binary && bytes.len() == 4 {
                Ok(SQLDataCell {
                    tag: Tag::Float8,
                    value: Value { float8: parse_binary_float4(bytes)? as f64 },
                    ..Default::default()
                })
            } else {
                let float4: f64 = bun_core::parse_double(bytes).unwrap_or(f64::NAN);
                Ok(SQLDataCell {
                    tag: Tag::Float8,
                    value: Value { float8: float4 },
                    ..Default::default()
                })
            }
        }
        T::numeric => {
            if binary {
                // this is probrably good enough for most cases
                // PERF(port): was stack-fallback (1024-byte stackFallback allocator)
                let mut numeric_buffer: Vec<u8> = Vec::new();

                // if is binary format lets display as a string because JS cant handle it in a safe way
                let result = parse_binary_numeric(bytes, &mut numeric_buffer)
                    .map_err(|_| AnyPostgresError::UnsupportedNumericFormat)?;
                Ok(SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: BunString::clone_utf8(result.slice()).leak_wtf_impl(),
                    },
                    free_value: 1,
                    ..Default::default()
                })
            } else {
                // nice text is actually what we want here
                Ok(SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: if !bytes.is_empty() {
                            BunString::clone_utf8(bytes).leak_wtf_impl()
                        } else {
                            core::ptr::null_mut()
                        },
                    },
                    free_value: 1,
                    ..Default::default()
                })
            }
        }
        T::jsonb | T::json => Ok(SQLDataCell {
            tag: Tag::Json,
            value: Value {
                json: if !bytes.is_empty() {
                    BunString::clone_utf8(bytes).leak_wtf_impl()
                } else {
                    core::ptr::null_mut()
                },
            },
            free_value: 1,
            ..Default::default()
        }),
        T::bool => {
            if binary {
                Ok(SQLDataCell {
                    tag: Tag::Bool,
                    value: Value { bool_: (!bytes.is_empty() && bytes[0] == 1) as u8 },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: Tag::Bool,
                    value: Value { bool_: (!bytes.is_empty() && bytes[0] == b't') as u8 },
                    ..Default::default()
                })
            }
        }
        tag @ (T::date | T::timestamp | T::timestamptz) => {
            if bytes.is_empty() {
                return Ok(SQLDataCell {
                    tag: Tag::Null,
                    value: Value { null: 0 },
                    ..Default::default()
                });
            }
            if binary && bytes.len() == 8 {
                match tag {
                    T::timestamptz => Ok(SQLDataCell {
                        tag: Tag::DateWithTimeZone,
                        value: Value { date_with_time_zone: crate::postgres::types::date::from_binary(bytes) },
                        ..Default::default()
                    }),
                    T::timestamp => Ok(SQLDataCell {
                        tag: Tag::Date,
                        value: Value { date: crate::postgres::types::date::from_binary(bytes) },
                        ..Default::default()
                    }),
                    _ => unreachable!(),
                }
            } else {
                if bun_core::strings::eql_case_insensitive_ascii(bytes, b"NULL", true) {
                    return Ok(SQLDataCell {
                        tag: Tag::Null,
                        value: Value { null: 0 },
                        ..Default::default()
                    });
                }
                let mut str = BunString::init(bytes);
                Ok(SQLDataCell {
                    tag: Tag::Date,
                    value: Value { date: crate::jsc::bun_string_jsc::parse_date(&mut str, global_object).map_err(crate::jsc::js_error_to_postgres)? },
                    ..Default::default()
                })
            }
        }
        tag @ (T::time | T::timetz) => {
            if bytes.is_empty() {
                return Ok(SQLDataCell {
                    tag: Tag::Null,
                    value: Value { null: 0 },
                    ..Default::default()
                });
            }
            if binary {
                if tag == T::time && bytes.len() == 8 {
                    // PostgreSQL sends time as microseconds since midnight in binary format
                    let microseconds = i64::from_ne_bytes(bytes[0..8].try_into().expect("infallible: size matches")).swap_bytes();

                    // Use C++ helper for formatting
                    let mut buffer = [0u8; 32];
                    let len = Postgres__formatTime(microseconds, &mut buffer, 32);

                    Ok(SQLDataCell {
                        tag: Tag::String,
                        value: Value {
                            string: BunString::clone_utf8(&buffer[0..len]).leak_wtf_impl(),
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                } else if tag == T::timetz && bytes.len() == 12 {
                    // PostgreSQL sends timetz as microseconds since midnight (8 bytes) + timezone offset in seconds (4 bytes)
                    let microseconds = i64::from_ne_bytes(bytes[0..8].try_into().expect("infallible: size matches")).swap_bytes();
                    let tz_offset_seconds = i32::from_ne_bytes(bytes[8..12].try_into().expect("infallible: size matches")).swap_bytes();

                    // Use C++ helper for formatting with timezone
                    let mut buffer = [0u8; 48];
                    let len = Postgres__formatTimeTz(microseconds, tz_offset_seconds, &mut buffer, 48);

                    Ok(SQLDataCell {
                        tag: Tag::String,
                        value: Value {
                            string: BunString::clone_utf8(&buffer[0..len]).leak_wtf_impl(),
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                } else {
                    Err(AnyPostgresError::InvalidBinaryData)
                }
            } else {
                // Text format - just return as string
                Ok(SQLDataCell {
                    tag: Tag::String,
                    value: Value {
                        string: if !bytes.is_empty() {
                            BunString::clone_utf8(bytes).leak_wtf_impl()
                        } else {
                            core::ptr::null_mut()
                        },
                    },
                    free_value: 1,
                    ..Default::default()
                })
            }
        }

        T::bytea => {
            if binary {
                Ok(SQLDataCell {
                    tag: Tag::Bytea,
                    value: Value { bytea: [bytes.as_ptr() as usize, bytes.len()] },
                    ..Default::default()
                })
            } else {
                if bytes.starts_with(b"\\x") {
                    return parse_bytea(&bytes[2..]);
                }
                Err(AnyPostgresError::UnsupportedByteaFormat)
            }
        }
        // text array types
        // PERF(port): was `inline` switch — each tag was a comptime arg to parseArray.
        // Demoted to runtime; see parse_array note.
        tag @ (T::bpchar_array
        | T::varchar_array
        | T::char_array
        | T::text_array
        | T::name_array
        | T::json_array
        | T::jsonb_array
        // special types handled as text array
        | T::path_array
        | T::xml_array
        | T::point_array
        | T::lseg_array
        | T::box_array
        | T::polygon_array
        | T::line_array
        | T::cidr_array
        | T::numeric_array
        | T::money_array
        | T::varbit_array
        | T::bit_array
        | T::int2vector_array
        | T::circle_array
        | T::macaddr8_array
        | T::macaddr_array
        | T::inet_array
        | T::aclitem_array
        | T::tid_array
        | T::pg_database_array
        | T::pg_database_array2
        // numeric array types
        | T::int8_array
        | T::int2_array
        | T::float8_array
        | T::oid_array
        | T::xid_array
        | T::cid_array
        // special types
        | T::bool_array
        | T::bytea_array
        // time types
        | T::time_array
        | T::date_array
        | T::timetz_array
        | T::timestamp_array
        | T::timestamptz_array
        | T::interval_array) => parse_array(bytes, bigint, tag, global_object, None, false, 0),
        _ => Ok(SQLDataCell {
            tag: Tag::String,
            value: Value {
                string: if !bytes.is_empty() {
                    BunString::clone_utf8(bytes).leak_wtf_impl()
                } else {
                    core::ptr::null_mut()
                },
            },
            free_value: 1,
            ..Default::default()
        }),
    }
}

// #define pg_hton16(x)        (x)
// #define pg_hton32(x)        (x)
// #define pg_hton64(x)        (x)

// #define pg_ntoh16(x)        (x)
// #define pg_ntoh32(x)        (x)
// #define pg_ntoh64(x)        (x)

// PORT NOTE: Zig's pg_ntoT used @typeInfo to accept either an array or an int and
// recurse through @bitCast. All call sites pass a uN already, so we drop the
// reflection and provide direct byte-swap helpers.
#[inline]
fn pg_ntoh16(x: u16) -> u16 {
    x.swap_bytes()
}

#[inline]
fn pg_ntoh32(x: u32) -> u32 {
    x.swap_bytes()
}

enum PGNummericString<'a> {
    Static(&'static [u8]),
    Dynamic(&'a [u8]),
}

impl<'a> PGNummericString<'a> {
    pub fn slice(&self) -> &[u8] {
        match self {
            PGNummericString::Static(value) => value,
            PGNummericString::Dynamic(value) => value,
        }
    }
}

fn parse_binary_numeric<'a>(
    input: &[u8],
    result: &'a mut Vec<u8>,
) -> Result<PGNummericString<'a>, bun_core::Error> {
    // Reference: https://github.com/postgres/postgres/blob/50e6eb731d98ab6d0e625a0b87fb327b172bbebd/src/backend/utils/adt/numeric.c#L7612-L7740
    if input.len() < 8 {
        return Err(err!("InvalidBuffer"));
    }
    // PORT NOTE: std.io.fixedBufferStream → manual cursor over &[u8]
    let mut cursor = input;
    macro_rules! read_be {
        ($ty:ty) => {{
            const N: usize = size_of::<$ty>();
            if cursor.len() < N {
                return Err(err!("InvalidBuffer"));
            }
            let v = <$ty>::from_be_bytes(cursor[..N].try_into().expect("infallible: size matches"));
            cursor = &cursor[N..];
            v
        }};
    }

    // Read header values using big-endian
    let ndigits: i16 = read_be!(i16);
    let weight: i16 = read_be!(i16);
    let sign: u16 = read_be!(u16);
    let dscale: i16 = read_be!(i16);
    bun_core::scoped_log!(
        PostgresDataCell,
        "ndigits: {}, weight: {}, sign: {}, dscale: {}",
        ndigits,
        weight,
        sign,
        dscale
    );

    // Handle special cases
    match sign {
        0xC000 => return Ok(PGNummericString::Static(b"NaN")),
        0xD000 => return Ok(PGNummericString::Static(b"Infinity")),
        0xF000 => return Ok(PGNummericString::Static(b"-Infinity")),
        0x4000 | 0x0000 => {}
        _ => return Err(err!("InvalidSign")),
    }

    if ndigits == 0 {
        return Ok(PGNummericString::Static(b"0"));
    }

    // Add negative sign if needed
    if sign == 0x4000 {
        result.push(b'-');
    }

    // Calculate decimal point position
    let mut decimal_pos: i32 = (weight as i32 + 1) * 4;
    if decimal_pos <= 0 {
        decimal_pos = 1;
    }
    let _ = decimal_pos; // matches Zig: computed but unused below
    // Output all digits before the decimal point

    let mut scale_start: i32 = 0;
    if weight < 0 {
        result.push(b'0');
        scale_start = weight as i32 + 1;
    } else {
        let mut idx: usize = 0;
        let mut first_non_zero = false;

        while idx <= weight as usize {
            // PORT NOTE: Zig peer-type-widened `idx < ndigits`; compare in i32 to avoid usize→i16 truncation.
            let digit: u16 = if i32::try_from(idx).expect("int cast") < i32::from(ndigits) {
                read_be!(u16)
            } else {
                0
            };
            bun_core::scoped_log!(PostgresDataCell, "digit: {}", digit);
            let digit_str: [u8; 4] = bun_core::fmt::itoa_padded::<4>(u64::from(digit));
            let digit_len = 4usize;
            if !first_non_zero {
                // In the first digit, suppress extra leading decimal zeroes
                let mut start_idx: usize = 0;
                while start_idx < digit_len && digit_str[start_idx] == b'0' {
                    start_idx += 1;
                }
                if start_idx == digit_len {
                    idx += 1;
                    continue;
                }
                let digit_slice = &digit_str[start_idx..digit_len];
                result.extend_from_slice(digit_slice);
                first_non_zero = true;
            } else {
                result.extend_from_slice(&digit_str[0..digit_len]);
            }
            idx += 1;
        }
    }
    // If requested, output a decimal point and all the digits that follow it.
    // We initially put out a multiple of 4 digits, then truncate if needed.
    if dscale > 0 {
        result.push(b'.');
        // negative scale means we need to add zeros before the decimal point
        // greater than ndigits means we need to add zeros after the decimal point
        let mut idx: isize = scale_start as isize;
        let end: usize = result.len() + usize::try_from(dscale).expect("int cast");
        while idx < dscale as isize {
            if idx >= 0 && idx < dscale as isize {
                let digit: u16 = if cursor.len() >= 2 {
                    let v = u16::from_be_bytes(
                        cursor[..2].try_into().expect("infallible: size matches"),
                    );
                    cursor = &cursor[2..];
                    v
                } else {
                    0
                };
                bun_core::scoped_log!(PostgresDataCell, "dscale digit: {}", digit);
                let digit_str: [u8; 4] = bun_core::fmt::itoa_padded::<4>(u64::from(digit));
                let digit_len = 4usize;
                result.extend_from_slice(&digit_str[0..digit_len]);
            } else {
                bun_core::scoped_log!(PostgresDataCell, "dscale digit: 0000");
                result.extend_from_slice(b"0000");
            }
            idx += 4;
        }
        if result.len() > end {
            result.truncate(end);
        }
    }
    // PORT NOTE: reshaped for borrowck — return borrowed slice of `result`
    Ok(PGNummericString::Dynamic(result.as_slice()))
}

// PORT NOTE: Zig's `parseBinary(comptime tag, comptime ReturnType, bytes)` returns a
// type that varies per arm. Rust cannot express that as a single fn without an output
// trait, so it is split per-tag. Call sites in this file are updated.
pub fn parse_binary_float8(bytes: &[u8]) -> Result<f64, AnyPostgresError> {
    Ok(f64::from_bits(parse_binary_int8(bytes)? as u64))
}

pub fn parse_binary_int8(bytes: &[u8]) -> Result<i64, AnyPostgresError> {
    // pq_getmsgfloat8
    if bytes.len() != 8 {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    Ok(i64::from_ne_bytes(bytes[0..8].try_into().expect("infallible: size matches")).swap_bytes())
}

pub fn parse_binary_int4(bytes: &[u8]) -> Result<i32, AnyPostgresError> {
    // pq_getmsgint
    match bytes.len() {
        1 => Ok(bytes[0] as i32),
        2 => Ok(pg_ntoh16(u16::from_ne_bytes(
            bytes[0..2].try_into().expect("infallible: size matches"),
        )) as i32),
        4 => Ok(pg_ntoh32(u32::from_ne_bytes(
            bytes[0..4].try_into().expect("infallible: size matches"),
        )) as i32),
        _ => Err(AnyPostgresError::UnsupportedIntegerSize),
    }
}

pub fn parse_binary_oid(bytes: &[u8]) -> Result<u32, AnyPostgresError> {
    match bytes.len() {
        1 => Ok(bytes[0] as u32),
        2 => Ok(pg_ntoh16(u16::from_ne_bytes(
            bytes[0..2].try_into().expect("infallible: size matches"),
        )) as u32),
        4 => Ok(pg_ntoh32(u32::from_ne_bytes(
            bytes[0..4].try_into().expect("infallible: size matches"),
        ))),
        _ => Err(AnyPostgresError::UnsupportedIntegerSize),
    }
}

pub fn parse_binary_int2(bytes: &[u8]) -> Result<i16, AnyPostgresError> {
    // pq_getmsgint
    match bytes.len() {
        1 => Ok(bytes[0] as i16),
        2 => {
            // PostgreSQL stores numbers in big-endian format, so we must read as big-endian
            // Read as raw 16-bit unsigned integer
            let value: u16 =
                u16::from_ne_bytes(bytes[0..2].try_into().expect("infallible: size matches"));
            // Convert from big-endian to native-endian (we always use little endian)
            Ok(value.swap_bytes() as i16) // Cast to signed 16-bit integer (i16)
        }
        _ => Err(AnyPostgresError::UnsupportedIntegerSize),
    }
}

pub fn parse_binary_float4(bytes: &[u8]) -> Result<f32, AnyPostgresError> {
    // pq_getmsgfloat4
    Ok(f32::from_bits(parse_binary_int4(bytes)? as u32))
}

pub struct Putter<'a> {
    pub list: &'a mut [SQLDataCell],
    pub fields: &'a [protocol::FieldDescription],
    pub binary: bool,
    pub bigint: bool,
    pub count: usize,
    pub global_object: &'a JSGlobalObject,
}

impl<'a> Putter<'a> {
    /// Mirrors Zig field defaults: `binary = false`, `bigint = false`, `count = 0`.
    /// (Cannot `impl Default` — `list`/`fields`/`global_object` are borrows with no default.)
    pub fn new(
        list: &'a mut [SQLDataCell],
        fields: &'a [protocol::FieldDescription],
        global_object: &'a JSGlobalObject,
    ) -> Self {
        Self {
            list,
            fields,
            binary: false,
            bigint: false,
            count: 0,
            global_object,
        }
    }

    pub fn to_js(
        &mut self,
        global_object: &JSGlobalObject,
        array: JSValue,
        structure: JSValue,
        flags: Flags,
        result_mode: PostgresSQLQueryResultMode,
        cached_structure: Option<&PostgresCachedStructure>,
    ) -> Result<JSValue, AnyPostgresError> {
        // TODO(port): jsc.JSObject.ExternColumnIdentifier path — confirm bun_jsc export name
        let mut names: *mut crate::jsc::ExternColumnIdentifier = core::ptr::null_mut();
        let mut names_count: u32 = 0;
        if let Some(c) = cached_structure {
            if let Some(f) = c.fields.as_ref() {
                names = f.as_ptr().cast_mut();
                names_count = f.len() as u32;
            }
        }

        Ok(SQLDataCell::construct_object_from_data_cell(
            global_object,
            array,
            structure,
            self.list.as_mut_ptr(),
            self.fields.len() as u32,
            flags,
            result_mode as u8,
            names,
            names_count,
        )
        .map_err(crate::jsc::js_error_to_postgres)?)
    }

    fn put_impl<const IS_RAW: bool>(
        &mut self,
        index: u32,
        optional_bytes: Option<&mut Data>,
    ) -> Result<bool> {
        // Bounds check to prevent crash when fields/list arrays are empty
        if (index as usize) >= self.fields.len() {
            bun_core::scoped_log!(
                Postgres,
                "putImpl: index {} >= fields.len {}, ignoring extra field",
                index,
                self.fields.len()
            );
            return Ok(false);
        }
        if (index as usize) >= self.list.len() {
            bun_core::scoped_log!(
                Postgres,
                "putImpl: index {} >= list.len {}, ignoring extra field",
                index,
                self.list.len()
            );
            return Ok(false);
        }

        let field = &self.fields[index as usize];
        let oid = field.type_oid;
        bun_core::scoped_log!(Postgres, "index: {}, oid: {}", index, oid);
        let cell: &mut SQLDataCell = &mut self.list[index as usize];
        if IS_RAW {
            *cell = SQLDataCell::raw(optional_bytes);
        } else {
            let tag = if (types::short::MAX as u32) < oid {
                types::Tag::text
            } else {
                // types::Tag is `#[repr(transparent)] struct Tag(pub Short)` —
                // construct directly, no transmute needed.
                types::Tag(oid as types::short)
            };
            *cell = if let Some(data) = optional_bytes {
                from_bytes(
                    (field.binary || self.binary) && tag.is_binary_format_supported(),
                    self.bigint,
                    tag,
                    data.slice(),
                    self.global_object,
                )?
            } else {
                SQLDataCell {
                    tag: Tag::Null,
                    value: Value { null: 0 },
                    ..Default::default()
                }
            };
        }
        self.count += 1;
        cell.index = match &field.name_or_index {
            // The indexed columns can be out of order.
            ColumnIdentifier::Index(i) => *i,
            _ => index,
        };

        // TODO: when duplicate and we know the result will be an object
        // and not a .values() array, we can discard the data
        // immediately.
        cell.is_indexed_column = match &field.name_or_index {
            ColumnIdentifier::Duplicate => 2,
            ColumnIdentifier::Index(_) => 1,
            ColumnIdentifier::Name(_) => 0,
        };
        Ok(true)
    }

    pub fn put_raw(&mut self, index: u32, optional_bytes: Option<&mut Data>) -> Result<bool> {
        self.put_impl::<true>(index, optional_bytes)
    }

    pub fn put(&mut self, index: u32, optional_bytes: Option<&mut Data>) -> Result<bool> {
        self.put_impl::<false>(index, optional_bytes)
    }
}

// External C++ formatting functions
// TODO(port): move to <area>_sys
unsafe extern "C" {
    // `&mut [u8; N]` is ABI-identical to `*mut u8` (thin pointer to a `Sized`
    // array == pointer to its first element); the reference type discharges the
    // "valid for `buffer_size` bytes" precondition, so → `safe fn`. The C++
    // side never writes past `buffer_size`, and the only two callers pass
    // exactly these fixed-size stack arrays.
    safe fn Postgres__formatTime(
        microseconds: i64,
        buffer: &mut [u8; 32],
        buffer_size: usize,
    ) -> usize;
    safe fn Postgres__formatTimeTz(
        microseconds: i64,
        tz_offset_seconds: i32,
        buffer: &mut [u8; 48],
        buffer_size: usize,
    ) -> usize;
}

// ported from: src/sql_jsc/postgres/DataCell.zig
