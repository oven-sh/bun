use crate::jsc::{
    JSArrayIterator, JSGlobalObject, JSType, JSValue, JsError, JsResult, StringJsc as _,
    VirtualMachineSqlExt as _,
};
use bun_core::String as BunString;
use bun_core::fmt as bun_fmt;

use bun_sql::postgres::TLSStatus;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::{AnyPostgresError, Int4};
use bun_sql::postgres::protocol::{ReaderContext, WriterContext};
use bun_sql::shared::SSLMode;

use crate::jsc::js_error_to_postgres;
use crate::postgres::PostgresSQLConnection;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use crate::postgres::Signature;
use crate::postgres::types::{date, tag_jsc};

bun_core::declare_scope!(Postgres, visible);

/// The set of backend message tags `PostgresSQLConnection.on()` dispatches over. Defined here
/// (the dispatch site) rather than in `bun_sql::postgres::protocol` because
/// it is purely a dispatch tag with no wire encoding.
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum MessageType {
    DataRow,
    CopyData,
    ParameterStatus,
    ReadyForQuery,
    CommandComplete,
    BindComplete,
    ParseComplete,
    ParameterDescription,
    RowDescription,
    Authentication,
    NoData,
    BackendKeyData,
    ErrorResponse,
    PortalSuspended,
    CloseComplete,
    CopyInResponse,
    NoticeResponse,
    EmptyQueryResponse,
    CopyOutResponse,
    CopyDone,
    CopyBothResponse,
    NotificationResponse,
}

/// A value past the described parameters goes as text: the server reports the count (08P01).
fn parameter_tag(parameter_types: &[Int4], index: usize) -> types::Tag {
    parameter_types
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

/// Replaces each value by the text that `write_bind` sends for it, unless it can encode the value
/// itself without running JS. Once per request: it would take that text for a string.
/// `true`: it replaced one, so user code may have run.
pub(crate) fn stage_parameters(
    global: &JSGlobalObject,
    values: JSValue,
    parameter_types: &[Int4],
    prepared: bool,
) -> JsResult<bool> {
    let mut iter = JSArrayIterator::init(values, global)?;
    let mut index: u32 = 0;
    let mut replaced = false;
    while let Some(value) = iter.next()? {
        let tag = parameter_tag(parameter_types, index as usize);
        if let Some(text) = parameter_text(global, value, tag, index, prepared)? {
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

/// Runs no JS once `stage_parameters` has seen `values_array`.
fn write_bind<Context: WriterContext>(
    name: &[u8],
    global: &JSGlobalObject,
    values_array: JSValue,
    parameter_fields: &[Int4],
    result_fields: &[protocol::FieldDescription],
    formats: types::ResultFormats,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let len =
        u16::try_from(parameter_fields.len()).map_err(|_| AnyPostgresError::TooManyParameters)?;

    writer.write(b"B")?;
    let length = writer.length()?;

    // The unnamed portal.
    writer.string(b"")?;
    writer.string(name)?;

    writer.short(len)?;
    let format_codes = writer.format_codes(len)?;

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    writer.short(len)?;

    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    let mut iter = JSArrayIterator::init(values_array, global).map_err(js_error_to_postgres)?;
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        let tag = parameter_tag(parameter_fields, i);
        if value.is_empty_or_undefined_or_null() {
            bun_core::scoped_log!(Postgres, "  -> NULL");
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            writer.int4((-1i32) as u32)?;
            i += 1;
            continue;
        }
        bun_core::scoped_log!(Postgres, "  -> {}", tag.tag_name().unwrap_or("(unknown)"));

        let l = writer.length()?;
        if write_binary_parameter(global, tag, value, writer)? {
            format_codes.set_binary(i)?;
        } else if value.is_date() {
            date::write_text(global, value, tag, writer)?;
        } else {
            let str = BunString::from_js(value, global).map_err(js_error_to_postgres)?;
            writer.write(str.to_utf8().slice())?;
        }
        l.write_excluding_self()?;

        i += 1;
    }

    if result_fields
        .iter()
        .any(|field| field.type_tag().is_binary_in(formats))
    {
        writer.short(result_fields.len())?;
        for field in result_fields {
            writer.short(field.type_tag().format_code(formats))?;
        }
    } else {
        writer.short(0)?;
    }

    length.write()?;
    Ok(())
}

fn write_binary_parameter<Context: WriterContext>(
    global: &JSGlobalObject,
    tag: types::Tag,
    value: JSValue,
    writer: protocol::NewWriter<Context>,
) -> Result<bool, AnyPostgresError> {
    match tag {
        types::Tag::bool if value.is_boolean() => writer.write(&[value.as_boolean() as u8])?,
        types::Tag::int4 if value.is_int32() => writer.int4(value.as_int32() as u32)?,
        types::Tag::float8 if value.is_number() => writer.f64(value.as_number())?,
        types::Tag::bytea => {
            let Some(buffer) = value.as_array_buffer(global) else {
                return Ok(false);
            };
            writer.write(buffer.byte_slice())?;
        }
        types::Tag::timestamp | types::Tag::timestamptz if value.is_date() => {
            let Some(microseconds) = date::to_binary(value) else {
                return Ok(false);
            };
            writer.int8(microseconds)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn write_parse<Context: WriterContext>(
    query: &[u8],
    signature: &Signature,
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    bun_core::scoped_log!(Postgres, "Parse: {}", bun_fmt::quote(query));
    protocol::Parse {
        name: &signature.prepared_statement_name,
        params: &signature.fields,
        query,
    }
    .write_internal(&mut writer)
}

fn write_describe<Context: WriterContext>(
    signature: &Signature,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let name = &signature.prepared_statement_name;
    bun_core::scoped_log!(Postgres, "Describe: {}", bun_fmt::quote(name));
    protocol::Describe {
        p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
    }
    .write_internal(writer)
}

pub(crate) fn parse_and_describe<Context: WriterContext>(
    query: &[u8],
    signature: &Signature,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    write_parse(query, signature, writer)?;
    write_describe(signature, writer)?;
    writer.write(&protocol::SYNC)
}

pub(crate) fn bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    statement: &PostgresSQLStatement,
    values: JSValue,
    formats: types::ResultFormats,
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let name = &statement.signature.prepared_statement_name;
    write_bind(
        name,
        global,
        values,
        statement.parameter_types(),
        &statement.fields,
        formats,
        writer,
    )?;
    protocol::Execute {
        p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
        ..Default::default()
    }
    .write_internal(&mut writer)?;
    writer.write(&protocol::SYNC)
}

/// An unnamed statement needs its Parse in the batch of its Bind: PgBouncer in transaction mode
/// may give the next batch to another backend.
pub(crate) fn parse_and_bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    statement: &PostgresSQLStatement,
    values: JSValue,
    formats: types::ResultFormats,
    include_describe: bool,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    write_parse(query, &statement.signature, writer)?;
    if include_describe {
        write_describe(&statement.signature, writer)?;
    }
    bind_and_execute(global, statement, values, formats, writer)
}

pub(crate) fn write_close_statement<Context: WriterContext>(
    name: &[u8],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"C")?;
    let length = writer.length()?;
    writer.write(b"S")?;
    writer.string(name)?;
    length.write()
}

pub(crate) fn write_copy_fail<Context: WriterContext>(
    message: &[u8],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"f")?;
    let length = writer.length()?;
    writer.string(message)?;
    length.write()
}

fn on_ssl_request_reply(
    connection: &PostgresSQLConnection,
    c: u8,
    sent: u8,
) -> Result<(), AnyPostgresError> {
    match c {
        b'S' => {
            debug_assert!(sent == 8);
            connection.tls_status.set(TLSStatus::SslOk);
            connection.setup_tls();
            Ok(())
        }
        b'N' => {
            connection.tls_status.set(TLSStatus::None);
            bun_core::scoped_log!(Postgres, "Server does not support SSL");
            if matches!(
                connection.ssl_mode,
                SSLMode::Require | SSLMode::VerifyCa | SSLMode::VerifyFull
            ) {
                connection.fail(
                    b"Server does not support SSL",
                    AnyPostgresError::TLSNotAvailable,
                );
                return Ok(());
            }
            // Nothing the server sent before our StartupMessage is a reply to it.
            connection.start();
            Ok(())
        }
        _ => Err(AnyPostgresError::UnexpectedMessage),
    }
}

pub(crate) fn on_data<Context: ReaderContext>(
    connection: &PostgresSQLConnection,
    mut reader: protocol::NewReader<Context>,
) -> Result<(), AnyPostgresError> {
    use MessageType as M;
    loop {
        // A handler can `fail()` and user code can close: the rest of the read is dropped.
        if connection.status.get().is_closed() {
            return Ok(());
        }
        reader.mark_message_start();
        let c = reader.int::<u8>()?;
        bun_core::scoped_log!(Postgres, "read: {}", c as char);

        // The SSLRequest reply is a bare Byte1('S'|'N') with no Int32 length;
        // it is the only unframed backend byte and must be handled before the
        // frame peek below.
        if let TLSStatus::MessageSent(n) = connection.tls_status.get() {
            return on_ssl_request_reply(connection, c, n);
        }

        // Every other backend message is Byte1(type) Int32(length) body[length-4].
        // Peek the length here (each handler reads it again) so the handler's
        // net consumption can be checked against it: a handler that leaves the
        // cursor anywhere but the next message's type byte has either scanned a
        // string past the frame or returned with tail bytes still in it, and
        // the stream is unrecoverable (libpq: "message contents do not agree
        // with length in message").
        let (before, length) = reader.peek_length()?;
        let after = before - length;

        match c {
            b'D' => connection.on(M::DataRow, reader.reborrow())?,
            b'd' => connection.on(M::CopyData, reader.reborrow())?,
            b'S' => connection.on(M::ParameterStatus, reader.reborrow())?,
            b'Z' => connection.on(M::ReadyForQuery, reader.reborrow())?,
            b'C' => connection.on(M::CommandComplete, reader.reborrow())?,
            b'2' => connection.on(M::BindComplete, reader.reborrow())?,
            b'1' => connection.on(M::ParseComplete, reader.reborrow())?,
            b't' => connection.on(M::ParameterDescription, reader.reborrow())?,
            b'T' => connection.on(M::RowDescription, reader.reborrow())?,
            b'R' => connection.on(M::Authentication, reader.reborrow())?,
            b'n' => connection.on(M::NoData, reader.reborrow())?,
            b'K' => connection.on(M::BackendKeyData, reader.reborrow())?,
            b'E' => connection.on(M::ErrorResponse, reader.reborrow())?,
            b's' => connection.on(M::PortalSuspended, reader.reborrow())?,
            b'3' => connection.on(M::CloseComplete, reader.reborrow())?,
            b'G' => connection.on(M::CopyInResponse, reader.reborrow())?,
            b'N' => connection.on(M::NoticeResponse, reader.reborrow())?,
            b'I' => connection.on(M::EmptyQueryResponse, reader.reborrow())?,
            b'H' => connection.on(M::CopyOutResponse, reader.reborrow())?,
            b'c' => connection.on(M::CopyDone, reader.reborrow())?,
            b'W' => connection.on(M::CopyBothResponse, reader.reborrow())?,
            b'A' => connection.on(M::NotificationResponse, reader.reborrow())?,

            _ => {
                bun_core::scoped_log!(Postgres, "Unknown message: {}", c as char);
                reader.skip_message()?;
            }
        }

        if connection.status.get().is_closed() {
            return Ok(());
        }
        if reader.peek().len() != after {
            bun_core::scoped_log!(
                Postgres,
                "message contents do not agree with length ({}): '{}' left {} of {}",
                length,
                c as char,
                reader.peek().len(),
                after,
            );
            return Err(AnyPostgresError::InvalidMessage);
        }
    }
}

/// Each entry holds a ref on its query.
pub(crate) type Queue = std::collections::VecDeque<bun_ptr::RefPtr<PostgresSQLQuery>>;
