use crate::jsc::{ErrorCode, JSGlobalObject, JSValue, StringJsc as _};
use bun_core::String as BunString;
use bun_core::fmt as bun_fmt;

use bun_sql::postgres::PostgresProtocol as protocol;
use bun_sql::postgres::PostgresTypes as types;
use bun_sql::postgres::PostgresTypes::{AnyPostgresError, Int4, Short};
use bun_sql::postgres::Status;
use bun_sql::postgres::protocol::{ReaderContext, WriterContext};

use crate::jsc::js_error_to_postgres;
use crate::postgres::PostgresSQLConnection;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use crate::postgres::Signature;
use crate::shared::QueryBindingIterator;

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

/// The PostgreSQL wire protocol uses 16-bit integers for parameter and column counts.
const MAX_PARAMETERS: usize = u16::MAX as usize;

/// The type the server declared for a parameter (ParameterDescription), or the
/// one `Signature` declared when Bind is written before the server answers.
/// OIDs outside the built-in range are user-defined types and bind as text.
fn parameter_tag(oid: Int4) -> types::Tag {
    Short::try_from(oid).map_or(types::Tag::text, types::Tag)
}

/// The binary Bind encodings `write_bind` implements.
#[derive(Clone, Copy)]
enum BinaryEncoding {
    Bool,
    Timestamp,
    Bytea,
    Int4,
    Float8,
}

/// A parameter is sent in the binary format only when the JS value has an
/// exact binary encoding for the declared type. Every other value is sent as
/// text for the server to parse or reject, as string parameters always are.
fn binary_encoding(tag: types::Tag, value: JSValue) -> Option<BinaryEncoding> {
    let encoding = match tag {
        types::Tag::bool if value.is_boolean() => BinaryEncoding::Bool,
        types::Tag::timestamp | types::Tag::timestamptz if value.is_date() || value.is_number() => {
            BinaryEncoding::Timestamp
        }
        types::Tag::bytea if value.is_cell() && value.js_type().is_array_buffer_like() => {
            BinaryEncoding::Bytea
        }
        types::Tag::int4 if is_int4(value) => BinaryEncoding::Int4,
        types::Tag::float8 if value.is_number() => BinaryEncoding::Float8,
        _ => return None,
    };
    Some(encoding)
}

/// A number that `int4` holds exactly.
fn is_int4(value: JSValue) -> bool {
    if !value.is_number() {
        return false;
    }
    let number = value.as_number();
    number.trunc() == number && number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX)
}

pub(crate) fn write_bind<Context: WriterContext>(
    name: &[u8],
    cursor_name: &BunString,
    global: &JSGlobalObject,
    values_array: JSValue,
    columns_value: JSValue,
    parameter_fields: &[Int4],
    result_fields: &[protocol::FieldDescription],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"B")?;
    let length = writer.length()?;

    // The bun.String overload is `bun_string` on NewWriter.
    writer.bun_string(cursor_name)?;
    writer.string(name)?;

    if parameter_fields.len() > MAX_PARAMETERS {
        return Err(AnyPostgresError::TooManyParameters);
    }

    let len: u16 = u16::try_from(parameter_fields.len()).expect("int cast");

    // The number of parameter format codes that follow (denoted C
    // below). This can be zero to indicate that there are no
    // parameters or that the parameters all use the default format
    // (text); or one, in which case the specified format code is
    // applied to all parameters; or it can equal the actual number
    // of parameters.
    writer.short(len)?;

    let mut iter = QueryBindingIterator::init(values_array, columns_value, global)
        .map_err(js_error_to_postgres)?;
    for (i, &oid) in parameter_fields.iter().enumerate() {
        iter.to(i as u32);
        let value = match iter.next().map_err(js_error_to_postgres)? {
            Some(value) => value,
            None if iter.any_failed() => return Err(AnyPostgresError::InvalidQueryBinding),
            None => JSValue::UNDEFINED,
        };
        let format_code: u16 = match binary_encoding(parameter_tag(oid), value) {
            Some(_) => 1,
            None => 0,
        };
        writer.short(format_code)?;
    }

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    writer.short(len)?;

    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    iter.to(0);
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        // A value with no declared parameter is written as text. The server then
        // rejects the Bind with 08P01 and names both counts, which is a better
        // error than anything that could be produced here.
        let tag = parameter_fields
            .get(i)
            .map_or(types::Tag::text, |&oid| parameter_tag(oid));
        i += 1;
        if value.is_empty_or_undefined_or_null() {
            bun_core::scoped_log!(Postgres, "  -> NULL");
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            writer.int4((-1i32) as u32)?;
            continue;
        }
        bun_core::scoped_log!(Postgres, "  -> {}", tag.tag_name().unwrap_or("(unknown)"));

        let l = writer.length()?;
        match binary_encoding(tag, value) {
            Some(BinaryEncoding::Bool) => writer.write(&[u8::from(value.as_boolean())])?,
            Some(BinaryEncoding::Timestamp) => writer.int8(
                crate::postgres::types::date::from_js(global, value)
                    .map_err(js_error_to_postgres)?,
            )?,
            Some(BinaryEncoding::Bytea) => {
                if let Some(buffer) = value.as_array_buffer(global) {
                    bun_core::scoped_log!(Postgres, "    {} bytes", buffer.byte_slice().len());
                    writer.write(buffer.byte_slice())?;
                }
            }
            Some(BinaryEncoding::Int4) => writer.int4(value.as_number() as i32 as u32)?,
            Some(BinaryEncoding::Float8) => writer.f64(value.as_number())?,
            None => match tag {
                types::Tag::jsonb | types::Tag::json => {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    let str = value
                        .json_stringify_fast(global)
                        .map_err(js_error_to_postgres)?;
                    writer.write(str.to_utf8().slice())?;
                }
                // Text input for bytea takes any character sequence, so a value
                // that is neither bytes nor a string has no encoding the server
                // could reject.
                types::Tag::bytea if !value.is_string() => {
                    let received = JSGlobalObject::determine_specific_type(global, value)
                        .map_err(js_error_to_postgres)?;
                    return Err(js_error_to_postgres(
                        global
                            .err(
                                ErrorCode::INVALID_ARG_TYPE,
                                format_args!(
                                    "A bytea parameter must be a string, Buffer, ArrayBuffer or TypedArray. Received {received}"
                                ),
                            )
                            .throw(),
                    ));
                }
                _ if value.is_date() => {
                    let mut buf = [0u8; 64];
                    let Some(iso) = value.to_iso_string(global, &mut buf) else {
                        return Err(js_error_to_postgres(
                            crate::postgres::types::date::throw_invalid_date(global),
                        ));
                    };
                    writer.write(iso)?;
                }
                _ => {
                    let str = BunString::from_js(value, global).map_err(js_error_to_postgres)?;
                    if str.tag() == bun_core::Tag::Dead {
                        return Err(AnyPostgresError::OutOfMemory);
                    }
                    writer.write(str.to_utf8().slice())?;
                }
            },
        }
        l.write_excluding_self()?;
    }

    let mut any_non_text_fields: bool = false;
    for field in result_fields {
        if field.type_tag().is_binary_format_supported() {
            any_non_text_fields = true;
            break;
        }
    }

    if any_non_text_fields {
        if result_fields.len() > MAX_PARAMETERS {
            return Err(AnyPostgresError::TooManyParameters);
        }
        writer.short(result_fields.len())?;
        for field in result_fields {
            writer.short(field.type_tag().format_code())?;
        }
    } else {
        writer.short(0)?;
    }

    length.write()?;
    Ok(())
}

pub(crate) fn write_query<Context: WriterContext>(
    query: &[u8],
    name: &[u8],
    params: &[Int4],
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    {
        let q = protocol::Parse {
            name,
            params,
            query,
        };
        q.write_internal(&mut writer)?;
        bun_core::scoped_log!(Postgres, "Parse: {}", bun_fmt::quote(query));
    }

    {
        let d = protocol::Describe {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
        };
        d.write_internal(writer)?;
        bun_core::scoped_log!(Postgres, "Describe: {}", bun_fmt::quote(name));
    }

    Ok(())
}

pub(crate) fn prepare_and_query_with_signature<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    array_value: JSValue,
    writer: protocol::NewWriter<Context>,
    signature: &mut Signature,
) -> Result<(), AnyPostgresError> {
    writer.atomically(|mut writer| {
        write_query(
            query,
            &signature.prepared_statement_name,
            &signature.fields,
            writer,
        )?;
        write_bind(
            &signature.prepared_statement_name,
            &BunString::EMPTY,
            global,
            array_value,
            JSValue::ZERO,
            &[],
            &[],
            writer,
        )?;
        let exec = protocol::Execute {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(
                &signature.prepared_statement_name,
            ),
            ..Default::default()
        };
        exec.write_internal(&mut writer)?;

        writer.write(&protocol::FLUSH)?;
        writer.write(&protocol::SYNC)?;
        Ok(())
    })
}

pub(crate) fn bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    statement: &PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.atomically(|mut writer| {
        write_bind(
            &statement.signature.prepared_statement_name,
            &BunString::EMPTY,
            global,
            array_value,
            columns_value,
            &statement.parameters,
            &statement.fields,
            writer,
        )?;
        let exec = protocol::Execute {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(
                &statement.signature.prepared_statement_name,
            ),
            ..Default::default()
        };
        exec.write_internal(&mut writer)?;

        writer.write(&protocol::FLUSH)?;
        writer.write(&protocol::SYNC)?;
        Ok(())
    })
}

/// Atomically sends Parse + [Describe] + Bind + Execute + Flush + Sync as a single message batch.
/// This is required for unnamed prepared statements to work correctly with connection poolers
/// like PgBouncer in transaction mode, which may reassign server connections between protocol
/// round-trips. Without this, Parse and Bind+Execute could be routed to different backend
/// connections, causing queries to execute against the wrong prepared statement.
pub(crate) fn parse_and_bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    statement: &PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    include_describe: bool,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let name = &statement.signature.prepared_statement_name;

    writer.atomically(|mut writer| {
        // Parse
        {
            let q = protocol::Parse {
                name,
                params: &statement.signature.fields,
                query,
            };
            q.write_internal(&mut writer)?;
            bun_core::scoped_log!(Postgres, "Parse: {}", bun_fmt::quote(query));
        }

        // Describe (needed on first execution to learn parameter/result types for caching)
        if include_describe {
            let d = protocol::Describe {
                p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
            };
            d.write_internal(writer)?;
            bun_core::scoped_log!(Postgres, "Describe: {}", bun_fmt::quote(name));
        }

        // Bind — use server-provided types if available (binary format), otherwise
        // fall back to signature types (text format for unknowns). The server will
        // handle text-to-type conversion based on the parameter types from Parse.
        let param_fields = if !statement.parameters.is_empty() {
            &statement.parameters[..]
        } else {
            &statement.signature.fields[..]
        };
        let result_fields = &statement.fields;

        write_bind(
            name,
            &BunString::EMPTY,
            global,
            array_value,
            columns_value,
            param_fields,
            result_fields,
            writer,
        )?;

        // Execute
        let exec = protocol::Execute {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
            ..Default::default()
        };
        exec.write_internal(&mut writer)?;

        writer.write(&protocol::FLUSH)?;
        writer.write(&protocol::SYNC)?;
        Ok(())
    })
}

pub(crate) fn execute_query<Context: WriterContext>(
    query: &[u8],
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    // A simple Query ('Q') is its own sync point: the backend always answers it
    // with exactly one ReadyForQuery. Do not append a Sync here: it would elicit
    // a second, unaccounted ReadyForQuery that re-arms advance() mid-prepare.
    protocol::write_query(query, &mut writer)?;
    writer.write(&protocol::FLUSH)?;
    Ok(())
}

pub(crate) fn on_data<Context: ReaderContext>(
    connection: &PostgresSQLConnection,
    mut reader: protocol::NewReader<Context>,
) -> Result<(), AnyPostgresError> {
    use MessageType as M;
    loop {
        // `fail()` inside a handler tears the connection down (status = Failed,
        // socket closed, queue rejected). Stop dispatching: later messages in
        // the same read must not act on the dead connection.
        if connection.status.get() == Status::Failed {
            return Ok(());
        }
        reader.mark_message_start();
        let c = reader.int::<u8>()?;
        bun_core::scoped_log!(Postgres, "read: {}", c as char);

        // The SSLRequest reply is a bare Byte1('S'|'N') with no Int32 length;
        // it is the only unframed backend byte and must be handled before the
        // frame peek below.
        if let TlsStatus::MessageSent(n) = connection.tls_status.get() {
            match c {
                b'S' => {
                    debug_assert!(n == 8);
                    connection.tls_status.set(TlsStatus::SslOk);
                    connection.setup_tls();
                    return Ok(());
                }
                b'N' => {
                    connection.tls_status.set(TlsStatus::SslNotAvailable);
                    bun_core::scoped_log!(Postgres, "Server does not support SSL");
                    if matches!(
                        connection.ssl_mode,
                        SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull
                    ) {
                        connection.fail(
                            b"Server does not support SSL",
                            AnyPostgresError::TLSNotAvailable,
                        );
                        return Ok(());
                    }
                    continue;
                }
                _ => return Err(AnyPostgresError::UnexpectedMessage),
            }
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

        if connection.status.get() == Status::Failed {
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

use crate::postgres::postgres_sql_connection::{SslMode, TlsStatus};
