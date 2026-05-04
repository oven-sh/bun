//! Port of src/sql_jsc/postgres/DataCell.zig

use core::mem::size_of;

use bun_core::err;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_str::String as BunString;

use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::AnyPostgresError;
use bun_sql::shared::data::Data;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as PostgresSQLQueryResultMode;

pub use crate::shared::sql_data_cell::SQLDataCell;

// TODO(port): narrow error set — Zig used inferred error sets that flow into
// AnyPostgresError. Phase B should confirm AnyPostgresError covers all variants
// referenced via `err!(...)` here.
type Result<T, E = AnyPostgresError> = core::result::Result<T, E>;

bun_output::declare_scope!(Postgres, visible);
bun_output::declare_scope!(PostgresDataCell, visible);

fn parse_bytea(hex: &[u8]) -> Result<SQLDataCell> {
    let len = hex.len() / 2;
    let mut buf = vec![0u8; len].into_boxed_slice();
    // errdefer free(buf) → Box drops on `?`

    let written = bun_str::strings::decode_hex_to_bytes(&mut buf, hex)?;
    let ptr = Box::into_raw(buf) as *mut u8;

    Ok(SQLDataCell {
        tag: SQLDataCell::Tag::Bytea,
        value: SQLDataCell::Value {
            bytea: (ptr as usize, written),
        },
        free_value: 1,
        ..Default::default()
    })
}

fn unescape_postgres_string<'a>(input: &[u8], buffer: &'a mut [u8]) -> Result<&'a mut [u8], bun_core::Error> {
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
                b'b' => buffer[out_index] = 0x08, // Backspace
                b'f' => buffer[out_index] = 0x0C, // Form feed
                b'n' => buffer[out_index] = b'\n', // Line feed
                b'r' => buffer[out_index] = b'\r', // Carriage return
                b't' => buffer[out_index] = b'\t', // Tab
                b'"' => buffer[out_index] = b'"', // Double quote
                b'\\' => buffer[out_index] = b'\\', // Backslash
                b'\'' => buffer[out_index] = b'\'', // Single quote

                // JSON allows forward slash escaping
                b'/' => buffer[out_index] = b'/',

                // PostgreSQL hex escapes (used for unicode too)
                b'x' => {
                    if i + 2 >= input.len() {
                        return Err(err!("InvalidEscapeSequence"));
                    }
                    // TODO(port): from_utf8 on 2 hex bytes is safe but technically
                    // violates the no-from_utf8 rule; consider a direct hex decoder.
                    let hex_str = core::str::from_utf8(&input[i + 1..i + 3])
                        .map_err(|_| err!("InvalidEscapeSequence"))?;
                    let hex_value = u8::from_str_radix(hex_str, 16)
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
) -> Result<SQLDataCell> {
    let closing_brace: u8 = if is_json_sub_array { b']' } else { b'}' };
    let opening_brace: u8 = if is_json_sub_array { b'[' } else { b'{' };
    if bytes.len() < 2 || bytes[0] != opening_brace {
        return Err(err!("UnsupportedArrayFormat").into());
    }
    // empty array
    if bytes.len() == 2 && bytes[1] == closing_brace {
        if let Some(offset_ptr) = offset {
            *offset_ptr = 2;
        }
        return Ok(SQLDataCell {
            tag: SQLDataCell::Tag::Array,
            value: SQLDataCell::Value {
                array: SQLDataCell::Array { ptr: core::ptr::null_mut(), len: 0, cap: 0 },
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
        types::Tag::BoxArray => b';',
        _ => b',',
    };

    while !slice.is_empty() {
        let ch = slice[0];
        if ch == closing_brace {
            if reached_end {
                // cannot reach end twice
                return Err(err!("UnsupportedArrayFormat").into());
            }
            // end of array
            reached_end = true;
            slice = try_slice(slice, 1);
            break;
        } else if ch == opening_brace {
            let mut sub_array_offset: usize = 0;
            let sub_array = parse_array(slice, bigint, array_type, global_object, Some(&mut sub_array_offset), is_json_sub_array)?;
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
                return Err(err!("UnsupportedArrayFormat").into());
            }
            match array_type {
                types::Tag::ByteaArray => {
                    // this is a bytea array so we need to parse the bytea strings
                    let bytea_bytes = &slice[1..current_idx];
                    if bytea_bytes.starts_with(b"\\\\x") {
                        // its a bytea string lets parse it as a bytea
                        array.push(parse_bytea(&bytea_bytes[3..][0..bytea_bytes.len() - 3])?);
                        slice = try_slice(slice, current_idx + 1);
                        continue;
                    }
                    // invalid bytea array
                    return Err(err!("UnsupportedByteaFormat").into());
                }
                types::Tag::TimestamptzArray | types::Tag::TimestampArray | types::Tag::DateArray => {
                    let date_str = &slice[1..current_idx];
                    let str = BunString::init(date_str);
                    // defer str.deref() → Drop on BunString
                    array.push(SQLDataCell {
                        tag: SQLDataCell::Tag::Date,
                        value: SQLDataCell::Value { date: str.parse_date(global_object)? },
                        ..Default::default()
                    });

                    slice = try_slice(slice, current_idx + 1);
                    continue;
                }
                types::Tag::JsonArray | types::Tag::JsonbArray => {
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
                        .map_err(|_| err!("InvalidByteSequence"))?;
                    array.push(SQLDataCell {
                        tag: SQLDataCell::Tag::Json,
                        value: SQLDataCell::Value {
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
                    tag: SQLDataCell::Tag::String,
                    value: SQLDataCell::Value { string: core::ptr::null_mut() },
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
                .map_err(|_| err!("InvalidByteSequence"))?;
            array.push(SQLDataCell {
                tag: SQLDataCell::Tag::String,
                value: SQLDataCell::Value {
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
                types::Tag::TimetzArray
                | types::Tag::DateArray
                | types::Tag::TimeArray
                | types::Tag::IntervalArray
                // text array types
                | types::Tag::BpcharArray
                | types::Tag::VarcharArray
                | types::Tag::CharArray
                | types::Tag::TextArray
                | types::Tag::NameArray
                | types::Tag::NumericArray
                | types::Tag::MoneyArray
                | types::Tag::VarbitArray
                | types::Tag::Int2vectorArray
                | types::Tag::BitArray
                | types::Tag::PathArray
                | types::Tag::XmlArray
                | types::Tag::PointArray
                | types::Tag::LsegArray
                | types::Tag::BoxArray
                | types::Tag::PolygonArray
                | types::Tag::LineArray
                | types::Tag::CidrArray
                | types::Tag::CircleArray
                | types::Tag::Macaddr8Array
                | types::Tag::MacaddrArray
                | types::Tag::InetArray
                | types::Tag::AclitemArray
                | types::Tag::PgDatabaseArray
                | types::Tag::PgDatabaseArray2 => {
                    // this is also a string until we reach "," or "}" but a single word string like Bun
                    let mut current_idx: usize = 0;

                    for (index, &byte) in slice.iter().enumerate() {
                        if byte == b'}' || byte == separator {
                            current_idx = index;
                            break;
                        }
                    }
                    if current_idx == 0 {
                        return Err(err!("UnsupportedArrayFormat").into());
                    }
                    let element = &slice[0..current_idx];
                    // lets handle NULL case here, if is a string "NULL" it will have quotes, if its a NULL it will be just NULL
                    if element == b"NULL" {
                        array.push(SQLDataCell {
                            tag: SQLDataCell::Tag::Null,
                            value: SQLDataCell::Value { null: 0 },
                            ..Default::default()
                        });
                        slice = try_slice(slice, current_idx);
                        continue;
                    }
                    if array_type == types::Tag::DateArray {
                        let str = BunString::init(element);
                        array.push(SQLDataCell {
                            tag: SQLDataCell::Tag::Date,
                            value: SQLDataCell::Value { date: str.parse_date(global_object)? },
                            ..Default::default()
                        });
                    } else {
                        // the only escape sequency possible here is \b
                        if element == b"\\b" {
                            array.push(SQLDataCell {
                                tag: SQLDataCell::Tag::String,
                                value: SQLDataCell::Value {
                                    string: BunString::clone_utf8(b"\x08").leak_wtf_impl(),
                                },
                                free_value: 1,
                                ..Default::default()
                            });
                        } else {
                            array.push(SQLDataCell {
                                tag: SQLDataCell::Tag::String,
                                value: SQLDataCell::Value {
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
                                return Err(err!("UnsupportedArrayFormat").into());
                            }
                            if slice.len() >= 4 {
                                if &slice[0..4] == b"NULL" {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Null,
                                        value: SQLDataCell::Value { null: 0 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 4);
                                    continue;
                                }
                            }
                            if &slice[0..3] == b"NaN" {
                                array.push(SQLDataCell {
                                    tag: SQLDataCell::Tag::Float8,
                                    value: SQLDataCell::Value { float8: f64::NAN },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 3);
                                continue;
                            }
                            return Err(err!("UnsupportedArrayFormat").into());
                        }
                        b'f' => {
                            // false
                            if array_type == types::Tag::JsonArray || array_type == types::Tag::JsonbArray {
                                if slice.len() < 5 {
                                    return Err(err!("UnsupportedArrayFormat").into());
                                }
                                if &slice[0..5] == b"false" {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Bool,
                                        value: SQLDataCell::Value { bool_: 0 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 5);
                                    continue;
                                }
                            } else {
                                array.push(SQLDataCell {
                                    tag: SQLDataCell::Tag::Bool,
                                    value: SQLDataCell::Value { bool_: 0 },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 1);
                                continue;
                            }
                        }
                        b't' => {
                            // true
                            if array_type == types::Tag::JsonArray || array_type == types::Tag::JsonbArray {
                                if slice.len() < 4 {
                                    return Err(err!("UnsupportedArrayFormat").into());
                                }
                                if &slice[0..4] == b"true" {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Bool,
                                        value: SQLDataCell::Value { bool_: 1 },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, 4);
                                    continue;
                                }
                            } else {
                                array.push(SQLDataCell {
                                    tag: SQLDataCell::Tag::Bool,
                                    value: SQLDataCell::Value { bool_: 1 },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, 1);
                                continue;
                            }
                        }
                        b'I' | b'i' => {
                            // infinity
                            if slice.len() < 8 {
                                return Err(err!("UnsupportedArrayFormat").into());
                            }

                            if bun_str::strings::eql_case_insensitive_ascii(&slice[0..8], b"Infinity", false) {
                                if matches!(
                                    array_type,
                                    types::Tag::DateArray | types::Tag::TimestampArray | types::Tag::TimestamptzArray
                                ) {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Date,
                                        value: SQLDataCell::Value { date: f64::INFINITY },
                                        ..Default::default()
                                    });
                                } else {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Float8,
                                        value: SQLDataCell::Value { float8: f64::INFINITY },
                                        ..Default::default()
                                    });
                                }
                                slice = try_slice(slice, 8);
                                continue;
                            }

                            return Err(err!("UnsupportedArrayFormat").into());
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
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        if has_exponent {
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        has_exponent = true;
                                        continue;
                                    }
                                    b'+' => {
                                        if !has_exponent {
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        if has_positive_sign {
                                            return Err(err!("UnsupportedArrayFormat").into());
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
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        if has_negative_sign {
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        has_negative_sign = true;
                                        continue;
                                    }
                                    b'.' => {
                                        // we can only have one dot and the dot must be before the exponent
                                        if is_float {
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        is_float = true;
                                    }
                                    b'I' | b'i' => {
                                        // infinity
                                        is_infinity = true;
                                        let element = if is_negative { &slice[1..] } else { slice };
                                        if element.len() < 8 {
                                            return Err(err!("UnsupportedArrayFormat").into());
                                        }
                                        if bun_str::strings::eql_case_insensitive_ascii(&element[0..8], b"Infinity", false) {
                                            let val = if is_negative { -f64::INFINITY } else { f64::INFINITY };
                                            if matches!(
                                                array_type,
                                                types::Tag::DateArray
                                                    | types::Tag::TimestampArray
                                                    | types::Tag::TimestamptzArray
                                            ) {
                                                array.push(SQLDataCell {
                                                    tag: SQLDataCell::Tag::Date,
                                                    value: SQLDataCell::Value { date: val },
                                                    ..Default::default()
                                                });
                                            } else {
                                                array.push(SQLDataCell {
                                                    tag: SQLDataCell::Tag::Float8,
                                                    value: SQLDataCell::Value { float8: val },
                                                    ..Default::default()
                                                });
                                            }
                                            advance_after = Some(8 + (is_negative as usize));
                                            break;
                                        }

                                        return Err(err!("UnsupportedArrayFormat").into());
                                    }
                                    _ => {
                                        return Err(err!("UnsupportedArrayFormat").into());
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
                                return Err(err!("UnsupportedArrayFormat").into());
                            }
                            let element = &slice[0..current_idx];
                            if is_float || array_type == types::Tag::Float8Array {
                                array.push(SQLDataCell {
                                    tag: SQLDataCell::Tag::Float8,
                                    value: SQLDataCell::Value {
                                        float8: bun_core::parse_double(element).unwrap_or(f64::NAN),
                                    },
                                    ..Default::default()
                                });
                                slice = try_slice(slice, current_idx);
                                continue;
                            }
                            match array_type {
                                types::Tag::Int8Array => {
                                    if bigint {
                                        array.push(SQLDataCell {
                                            tag: SQLDataCell::Tag::Int8,
                                            value: SQLDataCell::Value {
                                                int8: parse_int_i64(element)
                                                    .ok_or_else(|| err!("UnsupportedArrayFormat"))?,
                                            },
                                            ..Default::default()
                                        });
                                    } else {
                                        array.push(SQLDataCell {
                                            tag: SQLDataCell::Tag::String,
                                            value: SQLDataCell::Value {
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
                                types::Tag::CidArray | types::Tag::XidArray | types::Tag::OidArray => {
                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Uint4,
                                        value: SQLDataCell::Value {
                                            uint4: parse_int_u32(element).unwrap_or(0),
                                        },
                                        ..Default::default()
                                    });
                                    slice = try_slice(slice, current_idx);
                                    continue;
                                }
                                _ => {
                                    let value = parse_int_i32(element)
                                        .ok_or_else(|| err!("UnsupportedArrayFormat"))?;

                                    array.push(SQLDataCell {
                                        tag: SQLDataCell::Tag::Int4,
                                        value: SQLDataCell::Value {
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
                            if array_type == types::Tag::JsonArray || array_type == types::Tag::JsonbArray {
                                if slice[0] == b'[' {
                                    let mut sub_array_offset: usize = 0;
                                    let sub_array = parse_array(
                                        slice,
                                        bigint,
                                        array_type,
                                        global_object,
                                        Some(&mut sub_array_offset),
                                        true,
                                    )?;
                                    array.push(sub_array);
                                    slice = try_slice(slice, sub_array_offset);
                                    continue;
                                }
                            }
                            return Err(err!("UnsupportedArrayFormat").into());
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
        #[cold]
        fn cold() {}
        cold();
        return Err(err!("UnsupportedArrayFormat").into());
    }

    // disarm errdefer
    let mut array = scopeguard::ScopeGuard::into_inner(array);
    let len = array.len() as u32;
    let cap = array.capacity() as u32;
    let ptr = array.as_mut_ptr();
    core::mem::forget(array);
    Ok(SQLDataCell {
        tag: SQLDataCell::Tag::Array,
        value: SQLDataCell::Value {
            array: SQLDataCell::Array { ptr, len, cap },
        },
        free_value: 1,
        ..Default::default()
    })
}

// Helper: typed-array binary path shared by .int4_array / .float4_array.
// PORT NOTE: Zig used `inline ... => |tag|` to capture the comptime tag and call
// `tag.toJSTypedArrayType()` / `tag.byteArrayType()` / `tag.pgArrayType()` in type
// position. Those return types, so we monomorphize over the element type here.
fn from_bytes_typed_array<Elem>(
    tag: types::Tag,
    bytes: &[u8],
) -> Result<SQLDataCell> {
    if bytes.len() < 12 {
        return Err(err!("InvalidBinaryData").into());
    }
    // https://github.com/postgres/postgres/blob/master/src/backend/utils/adt/arrayfuncs.c#L1549-L1645
    let dimensions_raw: types::int4 = i32::from_ne_bytes(bytes[0..4].try_into().unwrap());
    let contains_nulls: types::int4 = i32::from_ne_bytes(bytes[4..8].try_into().unwrap());

    let dimensions = dimensions_raw.swap_bytes();
    if dimensions > 1 {
        return Err(err!("MultidimensionalArrayNotSupportedYet").into());
    }

    if contains_nulls != 0 {
        return Err(err!("NullsInArrayNotSupportedYet").into());
    }

    let js_typed_array_type = tag.to_js_typed_array_type()?;

    if dimensions == 0 {
        return Ok(SQLDataCell {
            tag: SQLDataCell::Tag::TypedArray,
            value: SQLDataCell::Value {
                typed_array: SQLDataCell::TypedArray {
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
        return Err(err!("InvalidBinaryData").into());
    }
    let array_len: i32 = i32::from_ne_bytes(bytes[12..16].try_into().unwrap()).swap_bytes();
    if array_len < 0 {
        return Err(err!("InvalidBinaryData").into());
    }
    // slice() consumes 2 * @sizeOf(element) bytes per element (the
    // 4-byte length prefix + the 4-byte value for int4/float4).
    let element_stride: usize = size_of::<Elem>() * 2;
    let max_elements = (bytes.len() - 20) / element_stride;
    if usize::try_from(array_len).unwrap() > max_elements {
        return Err(err!("InvalidBinaryData").into());
    }

    // TODO(port): tag.pgArrayType() returns a Zig type whose .init(bytes).slice()
    // byte-swaps elements in place and returns &[Elem]. Phase B: port that helper
    // (PostgresTypes.zig) and call it here.
    let elements: &[Elem] = types::pg_array_init_slice::<Elem>(bytes);

    Ok(SQLDataCell {
        tag: SQLDataCell::Tag::TypedArray,
        value: SQLDataCell::Value {
            typed_array: SQLDataCell::TypedArray {
                head_ptr: if !bytes.is_empty() { bytes.as_ptr() as *mut u8 } else { core::ptr::null_mut() },
                ptr: if !elements.is_empty() { elements.as_ptr() as *mut u8 } else { core::ptr::null_mut() },
                len: elements.len() as u32,
                byte_len: bytes.len() as u32,
                type_: js_typed_array_type,
            },
        },
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
        T::Int4Array => {
            if binary {
                from_bytes_typed_array::<i32>(T::Int4Array, bytes)
            } else {
                parse_array(bytes, bigint, T::Int4Array, global_object, None, false)
            }
        }
        T::Float4Array => {
            if binary {
                from_bytes_typed_array::<f32>(T::Float4Array, bytes)
            } else {
                parse_array(bytes, bigint, T::Float4Array, global_object, None, false)
            }
        }
        T::Int2 => {
            if binary {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Int4,
                    value: SQLDataCell::Value { int4: parse_binary_int2(bytes)? as i32 },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Int4,
                    value: SQLDataCell::Value { int4: parse_int_i32(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        T::Cid | T::Xid | T::Oid => {
            if binary {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Uint4,
                    value: SQLDataCell::Value { uint4: parse_binary_oid(bytes)? },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Uint4,
                    value: SQLDataCell::Value { uint4: parse_int_u32(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        T::Int4 => {
            if binary {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Int4,
                    value: SQLDataCell::Value { int4: parse_binary_int4(bytes)? },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Int4,
                    value: SQLDataCell::Value { int4: parse_int_i32(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            }
        }
        // postgres when reading bigint as int8 it returns a string unless type: { bigint: postgres.BigInt is set
        T::Int8 => {
            if bigint {
                // .int8 is a 64-bit integer always string
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Int8,
                    value: SQLDataCell::Value { int8: parse_int_i64(bytes).unwrap_or(0) },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::String,
                    value: SQLDataCell::Value {
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
        T::Float8 => {
            if binary && bytes.len() == 8 {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Float8,
                    value: SQLDataCell::Value { float8: parse_binary_float8(bytes)? },
                    ..Default::default()
                })
            } else {
                let float8: f64 = bun_core::parse_double(bytes).unwrap_or(f64::NAN);
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Float8,
                    value: SQLDataCell::Value { float8 },
                    ..Default::default()
                })
            }
        }
        T::Float4 => {
            if binary && bytes.len() == 4 {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Float8,
                    value: SQLDataCell::Value { float8: parse_binary_float4(bytes)? as f64 },
                    ..Default::default()
                })
            } else {
                let float4: f64 = bun_core::parse_double(bytes).unwrap_or(f64::NAN);
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Float8,
                    value: SQLDataCell::Value { float8: float4 },
                    ..Default::default()
                })
            }
        }
        T::Numeric => {
            if binary {
                // this is probrably good enough for most cases
                // PERF(port): was stack-fallback (1024-byte stackFallback allocator)
                let mut numeric_buffer: Vec<u8> = Vec::new();

                // if is binary format lets display as a string because JS cant handle it in a safe way
                let result = parse_binary_numeric(bytes, &mut numeric_buffer)
                    .map_err(|_| err!("UnsupportedNumericFormat"))?;
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::String,
                    value: SQLDataCell::Value {
                        string: BunString::clone_utf8(result.slice()).leak_wtf_impl(),
                    },
                    free_value: 1,
                    ..Default::default()
                })
            } else {
                // nice text is actually what we want here
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::String,
                    value: SQLDataCell::Value {
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
        T::Jsonb | T::Json => Ok(SQLDataCell {
            tag: SQLDataCell::Tag::Json,
            value: SQLDataCell::Value {
                json: if !bytes.is_empty() {
                    BunString::clone_utf8(bytes).leak_wtf_impl()
                } else {
                    core::ptr::null_mut()
                },
            },
            free_value: 1,
            ..Default::default()
        }),
        T::Bool => {
            if binary {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Bool,
                    value: SQLDataCell::Value { bool_: (!bytes.is_empty() && bytes[0] == 1) as u8 },
                    ..Default::default()
                })
            } else {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Bool,
                    value: SQLDataCell::Value { bool_: (!bytes.is_empty() && bytes[0] == b't') as u8 },
                    ..Default::default()
                })
            }
        }
        tag @ (T::Date | T::Timestamp | T::Timestamptz) => {
            if bytes.is_empty() {
                return Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Null,
                    value: SQLDataCell::Value { null: 0 },
                    ..Default::default()
                });
            }
            if binary && bytes.len() == 8 {
                match tag {
                    T::Timestamptz => Ok(SQLDataCell {
                        tag: SQLDataCell::Tag::DateWithTimeZone,
                        value: SQLDataCell::Value { date_with_time_zone: types::date::from_binary(bytes) },
                        ..Default::default()
                    }),
                    T::Timestamp => Ok(SQLDataCell {
                        tag: SQLDataCell::Tag::Date,
                        value: SQLDataCell::Value { date: types::date::from_binary(bytes) },
                        ..Default::default()
                    }),
                    _ => unreachable!(),
                }
            } else {
                if bun_str::strings::eql_case_insensitive_ascii(bytes, b"NULL", true) {
                    return Ok(SQLDataCell {
                        tag: SQLDataCell::Tag::Null,
                        value: SQLDataCell::Value { null: 0 },
                        ..Default::default()
                    });
                }
                let str = BunString::init(bytes);
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Date,
                    value: SQLDataCell::Value { date: str.parse_date(global_object)? },
                    ..Default::default()
                })
            }
        }
        tag @ (T::Time | T::Timetz) => {
            if bytes.is_empty() {
                return Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Null,
                    value: SQLDataCell::Value { null: 0 },
                    ..Default::default()
                });
            }
            if binary {
                if tag == T::Time && bytes.len() == 8 {
                    // PostgreSQL sends time as microseconds since midnight in binary format
                    let microseconds = i64::from_ne_bytes(bytes[0..8].try_into().unwrap()).swap_bytes();

                    // Use C++ helper for formatting
                    let mut buffer = [0u8; 32];
                    // SAFETY: buffer is valid for buffer.len() bytes
                    let len = unsafe { Postgres__formatTime(microseconds, buffer.as_mut_ptr(), buffer.len()) };

                    Ok(SQLDataCell {
                        tag: SQLDataCell::Tag::String,
                        value: SQLDataCell::Value {
                            string: BunString::clone_utf8(&buffer[0..len]).leak_wtf_impl(),
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                } else if tag == T::Timetz && bytes.len() == 12 {
                    // PostgreSQL sends timetz as microseconds since midnight (8 bytes) + timezone offset in seconds (4 bytes)
                    let microseconds = i64::from_ne_bytes(bytes[0..8].try_into().unwrap()).swap_bytes();
                    let tz_offset_seconds = i32::from_ne_bytes(bytes[8..12].try_into().unwrap()).swap_bytes();

                    // Use C++ helper for formatting with timezone
                    let mut buffer = [0u8; 48];
                    // SAFETY: buffer is valid for buffer.len() bytes
                    let len = unsafe {
                        Postgres__formatTimeTz(microseconds, tz_offset_seconds, buffer.as_mut_ptr(), buffer.len())
                    };

                    Ok(SQLDataCell {
                        tag: SQLDataCell::Tag::String,
                        value: SQLDataCell::Value {
                            string: BunString::clone_utf8(&buffer[0..len]).leak_wtf_impl(),
                        },
                        free_value: 1,
                        ..Default::default()
                    })
                } else {
                    Err(err!("InvalidBinaryData").into())
                }
            } else {
                // Text format - just return as string
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::String,
                    value: SQLDataCell::Value {
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

        T::Bytea => {
            if binary {
                Ok(SQLDataCell {
                    tag: SQLDataCell::Tag::Bytea,
                    value: SQLDataCell::Value { bytea: (bytes.as_ptr() as usize, bytes.len()) },
                    ..Default::default()
                })
            } else {
                if bytes.starts_with(b"\\x") {
                    return parse_bytea(&bytes[2..]);
                }
                Err(err!("UnsupportedByteaFormat").into())
            }
        }
        // text array types
        // PERF(port): was `inline` switch — each tag was a comptime arg to parseArray.
        // Demoted to runtime; see parse_array note.
        tag @ (T::BpcharArray
        | T::VarcharArray
        | T::CharArray
        | T::TextArray
        | T::NameArray
        | T::JsonArray
        | T::JsonbArray
        // special types handled as text array
        | T::PathArray
        | T::XmlArray
        | T::PointArray
        | T::LsegArray
        | T::BoxArray
        | T::PolygonArray
        | T::LineArray
        | T::CidrArray
        | T::NumericArray
        | T::MoneyArray
        | T::VarbitArray
        | T::BitArray
        | T::Int2vectorArray
        | T::CircleArray
        | T::Macaddr8Array
        | T::MacaddrArray
        | T::InetArray
        | T::AclitemArray
        | T::TidArray
        | T::PgDatabaseArray
        | T::PgDatabaseArray2
        // numeric array types
        | T::Int8Array
        | T::Int2Array
        | T::Float8Array
        | T::OidArray
        | T::XidArray
        | T::CidArray
        // special types
        | T::BoolArray
        | T::ByteaArray
        // time types
        | T::TimeArray
        | T::DateArray
        | T::TimetzArray
        | T::TimestampArray
        | T::TimestamptzArray
        | T::IntervalArray) => parse_array(bytes, bigint, tag, global_object, None, false),
        _ => Ok(SQLDataCell {
            tag: SQLDataCell::Tag::String,
            value: SQLDataCell::Value {
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

fn parse_binary_numeric<'a>(input: &[u8], result: &'a mut Vec<u8>) -> Result<PGNummericString<'a>, bun_core::Error> {
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
            let v = <$ty>::from_be_bytes(cursor[..N].try_into().unwrap());
            cursor = &cursor[N..];
            v
        }};
    }

    // Read header values using big-endian
    let ndigits: i16 = read_be!(i16);
    let weight: i16 = read_be!(i16);
    let sign: u16 = read_be!(u16);
    let dscale: i16 = read_be!(i16);
    bun_output::scoped_log!(
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
            let digit: u16 = if i32::try_from(idx).unwrap() < i32::from(ndigits) { read_be!(u16) } else { 0 };
            bun_output::scoped_log!(PostgresDataCell, "digit: {}", digit);
            // TODO(port): std.fmt.printInt with width=4 fill='0'. NBASE=10000 so digit ∈ [0,9999].
            let digit_str: [u8; 4] = format_digit_4(digit);
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
        let end: usize = result.len() + usize::try_from(dscale).unwrap();
        while idx < dscale as isize {
            if idx >= 0 && idx < dscale as isize {
                let digit: u16 = if cursor.len() >= 2 {
                    let v = u16::from_be_bytes(cursor[..2].try_into().unwrap());
                    cursor = &cursor[2..];
                    v
                } else {
                    0
                };
                bun_output::scoped_log!(PostgresDataCell, "dscale digit: {}", digit);
                let digit_str: [u8; 4] = format_digit_4(digit);
                let digit_len = 4usize;
                result.extend_from_slice(&digit_str[0..digit_len]);
            } else {
                bun_output::scoped_log!(PostgresDataCell, "dscale digit: 0000");
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

#[inline]
fn format_digit_4(d: u16) -> [u8; 4] {
    // NBASE digits are 0..=9999
    [
        b'0' + ((d / 1000) % 10) as u8,
        b'0' + ((d / 100) % 10) as u8,
        b'0' + ((d / 10) % 10) as u8,
        b'0' + (d % 10) as u8,
    ]
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
        return Err(err!("InvalidBinaryData").into());
    }
    Ok(i64::from_ne_bytes(bytes[0..8].try_into().unwrap()).swap_bytes())
}

pub fn parse_binary_int4(bytes: &[u8]) -> Result<i32, AnyPostgresError> {
    // pq_getmsgint
    match bytes.len() {
        1 => Ok(bytes[0] as i32),
        2 => Ok(pg_ntoh16(u16::from_ne_bytes(bytes[0..2].try_into().unwrap())) as i32),
        4 => Ok(pg_ntoh32(u32::from_ne_bytes(bytes[0..4].try_into().unwrap())) as i32),
        _ => Err(err!("UnsupportedIntegerSize").into()),
    }
}

pub fn parse_binary_oid(bytes: &[u8]) -> Result<u32, AnyPostgresError> {
    match bytes.len() {
        1 => Ok(bytes[0] as u32),
        2 => Ok(pg_ntoh16(u16::from_ne_bytes(bytes[0..2].try_into().unwrap())) as u32),
        4 => Ok(pg_ntoh32(u32::from_ne_bytes(bytes[0..4].try_into().unwrap()))),
        _ => Err(err!("UnsupportedIntegerSize").into()),
    }
}

pub fn parse_binary_int2(bytes: &[u8]) -> Result<i16, AnyPostgresError> {
    // pq_getmsgint
    match bytes.len() {
        1 => Ok(bytes[0] as i16),
        2 => {
            // PostgreSQL stores numbers in big-endian format, so we must read as big-endian
            // Read as raw 16-bit unsigned integer
            let value: u16 = u16::from_ne_bytes(bytes[0..2].try_into().unwrap());
            // Convert from big-endian to native-endian (we always use little endian)
            Ok(value.swap_bytes() as i16) // Cast to signed 16-bit integer (i16)
        }
        _ => Err(err!("UnsupportedIntegerSize").into()),
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
        flags: SQLDataCell::Flags,
        result_mode: PostgresSQLQueryResultMode,
        cached_structure: Option<&PostgresCachedStructure>,
    ) -> Result<JSValue, bun_core::Error> {
        // TODO(port): jsc.JSObject.ExternColumnIdentifier path — confirm bun_jsc export name
        let mut names: *mut bun_jsc::ExternColumnIdentifier = core::ptr::null_mut();
        let mut names_count: u32 = 0;
        if let Some(c) = cached_structure {
            if let Some(f) = c.fields.as_ref() {
                names = f.as_ptr() as *mut _;
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
        ))
    }

    fn put_impl<const IS_RAW: bool>(&mut self, index: u32, optional_bytes: Option<&mut Data>) -> Result<bool> {
        // Bounds check to prevent crash when fields/list arrays are empty
        if (index as usize) >= self.fields.len() {
            bun_output::scoped_log!(
                Postgres,
                "putImpl: index {} >= fields.len {}, ignoring extra field",
                index,
                self.fields.len()
            );
            return Ok(false);
        }
        if (index as usize) >= self.list.len() {
            bun_output::scoped_log!(
                Postgres,
                "putImpl: index {} >= list.len {}, ignoring extra field",
                index,
                self.list.len()
            );
            return Ok(false);
        }

        let field = &self.fields[index as usize];
        let oid = field.type_oid;
        bun_output::scoped_log!(Postgres, "index: {}, oid: {}", index, oid);
        let cell: &mut SQLDataCell = &mut self.list[index as usize];
        if IS_RAW {
            *cell = SQLDataCell::raw(optional_bytes);
        } else {
            let tag = if (types::short::MAX as i32) < oid {
                types::Tag::Text
            } else {
                // SAFETY: types::Tag is #[repr(short)]; oid fits in `short` per check above.
                unsafe {
                    core::mem::transmute::<types::short, types::Tag>(
                        types::short::try_from(oid).unwrap(),
                    )
                }
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
                    tag: SQLDataCell::Tag::Null,
                    value: SQLDataCell::Value { null: 0 },
                    ..Default::default()
                }
            };
        }
        self.count += 1;
        cell.index = match &field.name_or_index {
            // The indexed columns can be out of order.
            protocol::NameOrIndex::Index(i) => *i,
            _ => i32::try_from(index).unwrap(),
            // TODO(port): confirm cell.index width — Zig used @intCast(index)
        };

        // TODO: when duplicate and we know the result will be an object
        // and not a .values() array, we can discard the data
        // immediately.
        cell.is_indexed_column = match &field.name_or_index {
            protocol::NameOrIndex::Duplicate => 2,
            protocol::NameOrIndex::Index(_) => 1,
            protocol::NameOrIndex::Name(_) => 0,
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

// TODO(port): std.fmt.parseInt with radix 0 auto-detects base (0x/0o/0b prefixes).
// Postgres text-format integers are always decimal, so radix 10 is used here.
// Phase B: confirm no callers rely on prefix detection.
#[inline]
fn parse_int_i32(s: &[u8]) -> Option<i32> {
    core::str::from_utf8(s).ok()?.parse::<i32>().ok()
}
#[inline]
fn parse_int_i64(s: &[u8]) -> Option<i64> {
    core::str::from_utf8(s).ok()?.parse::<i64>().ok()
}
#[inline]
fn parse_int_u32(s: &[u8]) -> Option<u32> {
    core::str::from_utf8(s).ok()?.parse::<u32>().ok()
}

// External C++ formatting functions
// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Postgres__formatTime(microseconds: i64, buffer: *mut u8, buffer_size: usize) -> usize;
    fn Postgres__formatTimeTz(microseconds: i64, tz_offset_seconds: i32, buffer: *mut u8, buffer_size: usize) -> usize;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/DataCell.zig (1036 lines)
//   confidence: medium
//   todos:      9
//   notes:      comptime tag params demoted to runtime; parseBinary split per-type; SQLDataCell field/variant names + WTFStringImpl accessor are guesses for Phase B; from_utf8 on network bytes flagged for Phase B byte-parser swap
// ──────────────────────────────────────────────────────────────────────────
