use crate::jsc::{
    JSArrayIterator, JSGlobalObject, JSType, JSValue, JsError, JsResult, StringJsc as _,
    VirtualMachineSqlExt as _,
};
use bun_core::String as BunString;
use bun_core::fmt as bun_fmt;

use bun_sql::postgres::frontend::{self, Length};
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::{AnyPostgresError, Int4};

use crate::jsc::js_error_to_postgres;
use crate::postgres::types::{date, tag_jsc};
use crate::postgres::{PostgresSQLConnection, PostgresSQLStatement};

bun_core::declare_scope!(Postgres, visible);

/// `None` is NULL, which fits every type.
pub(crate) fn declared_types(
    global: &JSGlobalObject,
    values: JSValue,
) -> JsResult<Vec<Option<Int4>>> {
    let mut iter = JSArrayIterator::init(values, global)?;
    // Parse takes `u16::MAX` parameters and refuses a longer list.
    let mut declared = Vec::with_capacity((iter.len as usize).min(u16::MAX as usize));
    while let Some(value) = iter.next()? {
        declared.push(if value.is_empty_or_undefined_or_null() {
            None
        } else {
            Some(Int4::from(tag_jsc::from_js(global, value)?.0))
        });
    }
    Ok(declared)
}

/// A value past the described parameters goes as text: the server reports the count (08P01).
fn parameter_tag(statement: &PostgresSQLStatement, index: usize) -> types::Tag {
    statement
        .parameter_types()
        .get(index)
        .map_or(types::Tag::text, |&oid| types::Tag::from_oid(oid))
}

fn is_list(js_type: JSType) -> bool {
    js_type.is_array() || js_type == JSType::Int32Array
}

/// A list goes as JSON, an array literal or `String(list)`, an object with `toString` as JSON or that string.
pub(crate) fn needs_parameter_types(global: &JSGlobalObject, values: JSValue) -> JsResult<bool> {
    let mut iter = JSArrayIterator::init(values, global)?;
    while let Some(value) = iter.next()? {
        let js_type = value.js_type();
        if !js_type.is_object()
            || js_type.is_string_like()
            || js_type == JSType::JSDate
            || tag_jsc::is_bytes(js_type)
        {
            continue;
        }
        if is_list(js_type) || value.implements_to_string(global)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Replaces each value by the text that `bind_and_execute` sends for it, unless it can encode the value
/// itself without running JS. Once per request: it would take that text for a string.
/// `true`: it replaced one, so user code may have run.
pub(crate) fn stage_parameters(
    global: &JSGlobalObject,
    values: JSValue,
    statement: &PostgresSQLStatement,
) -> JsResult<bool> {
    let mut iter = JSArrayIterator::init(values, global)?;
    let mut index: u32 = 0;
    let mut replaced = false;
    while let Some(value) = iter.next()? {
        let tag = parameter_tag(statement, index as usize);
        if let Some(text) = parameter_text(global, value, tag, index, statement.is_named())? {
            values.put_index(global, index, text)?;
            replaced = true;
        }
        index += 1;
    }
    Ok(replaced)
}

fn parameter_text(
    global: &JSGlobalObject,
    value: JSValue,
    tag: types::Tag,
    index: u32,
    prepared: bool,
) -> JsResult<Option<JSValue>> {
    let js_type = value.js_type();
    if value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if js_type.is_string_like() {
        // With `prepare: false` the type is only known next to some values, and the same query
        // has to store the same string the same way next to all of them.
        if prepared && tag.is_json() {
            return Ok(Some(value.json_stringify_fast(global)?.into_js(global)?));
        }
        if js_type.is_string() {
            return Ok(None);
        }
        return Ok(Some(value.to_js_string(global)?.to_js()));
    }
    if tag == types::Tag::bytea {
        if js_type.is_array_buffer_like() {
            return Ok(None);
        }
        // Its input function takes any text: the server would store `String(value)`.
        let received = JSGlobalObject::determine_specific_type(global, value)?;
        return Err(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
            "Query parameter ${} of type bytea must be a Buffer, TypedArray, ArrayBuffer or string. Received {}",
            index + 1,
            received,
        ))));
    }
    if !js_type.is_object() || js_type == JSType::JSDate {
        return Ok(None);
    }

    if !tag.is_json() {
        if is_list(js_type) && tag.array_element().is_some() {
            return array_literal(global, value, tag).map(Some);
        }
        if is_list(js_type) || value.implements_to_string(global)? {
            return Ok(Some(value.to_js_string(global)?.to_js()));
        }
    }
    Ok(Some(value.json_stringify_fast(global)?.into_js(global)?))
}

fn array_literal(global: &JSGlobalObject, list: JSValue, tag: types::Tag) -> JsResult<JSValue> {
    let kind = match tag.array_element() {
        Some(element) if element.is_json() => 1,
        _ if tag.array_delimiter() == b';' => 2,
        _ => 0,
    };
    let function = global
        .bun_vm()
        .sql_state()
        .postgresql_context
        .get()
        .array_literal_fn
        .get()
        .unwrap();
    let literal = function.call(
        global,
        JSValue::UNDEFINED,
        &[list, JSValue::js_number_from_int32(kind)],
    )?;
    // `call` does nothing for a script context that is gone, and `undefined` would bind as NULL.
    if !literal.is_string() {
        return Err(JsError::Terminated);
    }
    Ok(literal)
}

/// An accessor of `values` still runs user code, and so does the `toString()` of bytes that a retry sends as text.
pub(crate) fn bind_and_execute(
    connection: &PostgresSQLConnection,
    global: &JSGlobalObject,
    statement: &PostgresSQLStatement,
    values: JSValue,
    formats: types::ResultFormats,
) -> Result<(), AnyPostgresError> {
    let len = statement.parameter_types().len();
    let name = &statement.name;
    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);

    let (length, format_codes) = connection.encode_more(|out| {
        let length = frontend::begin(out, b'B');
        // The unnamed portal.
        out.push(0);
        out.extend_from_slice(name);
        out.push(0);

        frontend::count(out, len)?;
        let format_codes = out.len();
        out.resize(format_codes + len * 2, 0);
        frontend::count(out, len)?;
        Ok((length, format_codes))
    })?;

    let mut iter = JSArrayIterator::init(values, global).map_err(js_error_to_postgres)?;
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        // User code can have read another ParameterDescription since `len`.
        let tag = match i < len {
            true => parameter_tag(statement, i),
            false => types::Tag::text,
        };
        let awaits_text = connection.encode_more(|out| {
            if value.is_empty_or_undefined_or_null() {
                out.extend_from_slice(&(-1i32).to_be_bytes());
                return Ok(None);
            }
            let value_length = Length::reserve(out);
            if write_binary_parameter(out, global, tag, value) {
                out[format_codes + i * 2 + 1] = 1;
            } else if value.is_date() {
                date::write_text(out, global, value, tag);
            } else {
                return Ok(Some(value_length));
            }
            value_length.end_value(out).map(|()| None)
        })?;
        if let Some(value_length) = awaits_text {
            let str = BunString::from_js(value, global).map_err(js_error_to_postgres)?;
            connection.encode_more(|out| {
                out.extend_from_slice(str.to_utf8().slice());
                value_length.end_value(out)
            })?;
        }
        i += 1;
    }

    connection.encode_more(|out| {
        let fields = &statement.columns.get().fields;
        if fields
            .iter()
            .any(|field| field.type_tag().is_binary_in(formats))
        {
            frontend::count(out, fields.len())?;
            for field in fields {
                out.extend_from_slice(&field.type_tag().format_code(formats).to_be_bytes());
            }
        } else {
            out.extend_from_slice(&[0, 0]);
        }

        length.end_message(out)?;
        out.extend_from_slice(&frontend::EXECUTE_AND_SYNC);
        Ok(())
    })
}

fn write_binary_parameter(
    out: &mut Vec<u8>,
    global: &JSGlobalObject,
    tag: types::Tag,
    value: JSValue,
) -> bool {
    match tag {
        types::Tag::bool if value.is_boolean() => out.push(value.as_boolean() as u8),
        types::Tag::int4 if value.is_int32() => {
            out.extend_from_slice(&value.as_int32().to_be_bytes())
        }
        types::Tag::float8 if value.is_number() => {
            out.extend_from_slice(&value.as_number().to_be_bytes())
        }
        types::Tag::bytea => {
            let Some(buffer) = value.as_array_buffer(global) else {
                return false;
            };
            out.extend_from_slice(buffer.byte_slice());
        }
        types::Tag::timestamp | types::Tag::timestamptz if value.is_date() => {
            let Some(microseconds) = date::to_binary(value) else {
                return false;
            };
            out.extend_from_slice(&microseconds.to_be_bytes());
        }
        _ => return false,
    }
    true
}
