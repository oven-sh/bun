use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _};
use bun_core::String as BunString;
use bun_core::fmt as bun_fmt;

use bun_sql::postgres::PostgresProtocol as protocol;
use bun_sql::postgres::PostgresTypes as types;
use bun_sql::postgres::PostgresTypes::{AnyPostgresError, Int4, Short};
use bun_sql::postgres::protocol::{ReaderContext, WriterContext};

use crate::jsc::js_error_to_postgres;
use crate::postgres::PostgresSQLConnection;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use crate::postgres::Signature;
use crate::shared::QueryBindingIterator;

bun_core::declare_scope!(Postgres, visible);

/// Zig: `comptime MessageType: @Type(.enum_literal)` — the set of backend
/// message tags `PostgresSQLConnection.on()` dispatches over. Defined here
/// (the dispatch site) rather than in `bun_sql::postgres::protocol` because
/// it is purely a compile-time switch tag in Zig with no wire encoding.
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
}

/// The PostgreSQL wire protocol uses 16-bit integers for parameter and column counts.
const MAX_PARAMETERS: usize = u16::MAX as usize;

pub fn write_bind<Context: WriterContext>(
    name: &[u8],
    cursor_name: BunString,
    global: &JSGlobalObject,
    values_array: JSValue,
    columns_value: JSValue,
    parameter_fields: &[Int4],
    result_fields: &[protocol::FieldDescription],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"B")?;
    let length = writer.length()?;

    // Zig `.String` (bun.String) vs `.string` ([]const u8) both snake_case to
    // `string`; the bun.String overload is `bun_string` on NewWriter.
    writer.bun_string(&cursor_name)?;
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
    for i in 0..(len as usize) {
        let parameter_field = parameter_fields[i];
        let is_custom_type = (Short::MAX as Int4) < parameter_field;
        let tag: types::Tag = if is_custom_type {
            types::Tag::text
        } else {
            types::Tag(Short::try_from(parameter_field).unwrap())
        };

        let force_text = is_custom_type
            || (tag.is_binary_format_supported()
                && 'brk: {
                    iter.to(i as u32);
                    if let Some(value) = iter.next().map_err(js_error_to_postgres)? {
                        break 'brk value.is_string();
                    }
                    if iter.any_failed() {
                        return Err(AnyPostgresError::InvalidQueryBinding);
                    }
                    break 'brk false;
                });

        if force_text {
            // If they pass a value as a string, let's avoid attempting to
            // convert it to the binary representation. This minimizes the room
            // for mistakes on our end, such as stripping the timezone
            // differently than what Postgres does when given a timestamp with
            // timezone.
            writer.short(0)?;
            continue;
        }

        writer.short(tag.format_code())?;
    }

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    writer.short(len)?;

    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    iter.to(0);
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        let tag: types::Tag = 'brk: {
            if i >= len as usize {
                // parameter in array but not in parameter_fields
                // this is probably a bug a bug in bun lets return .text here so the server will send a error 08P01
                // with will describe better the error saying exactly how many parameters are missing and are expected
                // Example:
                // SQL error: PostgresError: bind message supplies 0 parameters, but prepared statement "PSELECT * FROM test_table WHERE id=$1 .in$0" requires 1
                // errno: "08P01",
                // code: "ERR_POSTGRES_SERVER_ERROR"
                break 'brk types::Tag::text;
            }
            let parameter_field = parameter_fields[i];
            let is_custom_type = (Short::MAX as Int4) < parameter_field;
            break 'brk if is_custom_type {
                types::Tag::text
            } else {
                types::Tag(Short::try_from(parameter_field).unwrap())
            };
        };
        if value.is_empty_or_undefined_or_null() {
            bun_core::scoped_log!(Postgres, "  -> NULL");
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            writer.int4((-1i32) as u32)?;
            i += 1;
            continue;
        }
        bun_core::scoped_log!(Postgres, "  -> {}", tag.tag_name().unwrap_or("(unknown)"));

        // If they pass a value as a string, let's avoid attempting to
        // convert it to the binary representation. This minimizes the room
        // for mistakes on our end, such as stripping the timezone
        // differently than what Postgres does when given a timestamp with
        // timezone.
        let effective_tag = if tag.is_binary_format_supported() && value.is_string() {
            types::Tag::text
        } else {
            tag
        };
        match effective_tag {
            types::Tag::jsonb | types::Tag::json => {
                let mut str = BunString::empty();
                // Use jsonStringifyFast for SIMD-optimized serialization
                value
                    .json_stringify_fast(global, &mut str)
                    .map_err(js_error_to_postgres)?;
                let slice = str.to_utf8_without_ref();
                let l = writer.length()?;
                writer.write(slice.slice())?;
                l.write_excluding_self()?;
                // `str.deref()` and `slice.deinit()` handled by Drop
            }
            types::Tag::bool => {
                let l = writer.length()?;
                writer.write(&[value.to_boolean() as u8])?;
                l.write_excluding_self()?;
            }
            types::Tag::timestamp | types::Tag::timestamptz => {
                let l = writer.length()?;
                writer.int8(
                    crate::postgres::types::date::from_js(global, value)
                        .map_err(js_error_to_postgres)?,
                )?;
                l.write_excluding_self()?;
            }
            types::Tag::bytea => {
                let buf = value.as_array_buffer(global);
                let bytes: &[u8] = match buf.as_ref() {
                    Some(b) => b.byte_slice(),
                    None => b"",
                };
                let l = writer.length()?;
                bun_core::scoped_log!(Postgres, "    {} bytes", bytes.len());
                writer.write(bytes)?;
                l.write_excluding_self()?;
            }
            types::Tag::int4 => {
                let l = writer.length()?;
                writer.int4(value.coerce::<i32>(global).map_err(js_error_to_postgres)? as u32)?;
                l.write_excluding_self()?;
            }
            types::Tag::int4_array => {
                let l = writer.length()?;
                writer.int4(value.coerce::<i32>(global).map_err(js_error_to_postgres)? as u32)?;
                l.write_excluding_self()?;
            }
            types::Tag::float8 => {
                let l = writer.length()?;
                writer.f64(value.to_number(global).map_err(js_error_to_postgres)?)?;
                l.write_excluding_self()?;
            }

            _ => {
                let str = BunString::from_js(value, global).map_err(js_error_to_postgres)?;
                if str.tag() == bun_core::Tag::Dead {
                    return Err(AnyPostgresError::OutOfMemory);
                }
                let slice = str.to_utf8_without_ref();
                let l = writer.length()?;
                writer.write(slice.slice())?;
                l.write_excluding_self()?;
                // `str.deref()` and `slice.deinit()` handled by Drop
            }
        }

        i += 1;
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

pub fn write_query<Context: WriterContext>(
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

pub fn prepare_and_query_with_signature<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    array_value: JSValue,
    mut writer: protocol::NewWriter<Context>,
    signature: &mut Signature,
) -> Result<(), AnyPostgresError> {
    write_query(
        query,
        &signature.prepared_statement_name,
        &signature.fields,
        writer,
    )?;
    write_bind(
        &signature.prepared_statement_name,
        BunString::empty(),
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
}

pub fn bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    statement: &PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    write_bind(
        &statement.signature.prepared_statement_name,
        BunString::empty(),
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
}

/// Atomically sends Parse + [Describe] + Bind + Execute + Flush + Sync as a single message batch.
/// This is required for unnamed prepared statements to work correctly with connection poolers
/// like PgBouncer in transaction mode, which may reassign server connections between protocol
/// round-trips. Without this, Parse and Bind+Execute could be routed to different backend
/// connections, causing queries to execute against the wrong prepared statement.
pub fn parse_and_bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    statement: &PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    include_describe: bool,
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let name = &statement.signature.prepared_statement_name;

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
        BunString::empty(),
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
}

pub fn execute_query<Context: WriterContext>(
    query: &[u8],
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    protocol::write_query(query, &mut writer)?;
    writer.write(&protocol::FLUSH)?;
    writer.write(&protocol::SYNC)?;
    Ok(())
}

pub fn on_data<Context: ReaderContext>(
    connection: &PostgresSQLConnection,
    mut reader: protocol::NewReader<Context>,
) -> Result<(), AnyPostgresError> {
    use MessageType as M;
    loop {
        reader.mark_message_start();
        let c = reader.int::<u8>()?;
        bun_core::scoped_log!(Postgres, "read: {}", c as char);
        match c {
            b'D' => connection.on(M::DataRow, reader.reborrow())?,
            b'd' => connection.on(M::CopyData, reader.reborrow())?,
            b'S' => {
                if let TlsStatus::MessageSent(n) = connection.tls_status.get() {
                    debug_assert!(n == 8);
                    connection.tls_status.set(TlsStatus::SslOk);
                    connection.setup_tls();
                    return Ok(());
                }

                connection.on(M::ParameterStatus, reader.reborrow())?;
            }
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
            b'N' => {
                if matches!(connection.tls_status.get(), TlsStatus::MessageSent(_)) {
                    connection.tls_status.set(TlsStatus::SslNotAvailable);
                    bun_core::scoped_log!(Postgres, "Server does not support SSL");
                    if connection.ssl_mode == SslMode::Require {
                        connection.fail(
                            b"Server does not support SSL",
                            AnyPostgresError::TLSNotAvailable,
                        );
                        return Ok(());
                    }
                    continue;
                }

                connection.on(M::NoticeResponse, reader.reborrow())?;
            }
            b'I' => connection.on(M::EmptyQueryResponse, reader.reborrow())?,
            b'H' => connection.on(M::CopyOutResponse, reader.reborrow())?,
            b'c' => connection.on(M::CopyDone, reader.reborrow())?,
            b'W' => connection.on(M::CopyBothResponse, reader.reborrow())?,

            _ => {
                bun_core::scoped_log!(Postgres, "Unknown message: {}", c as char);
                let to_skip = reader.length()?.saturating_sub(1);
                bun_core::scoped_log!(Postgres, "to_skip: {}", to_skip);
                reader.skip(usize::try_from(to_skip).expect("int cast"))?;
            }
        }
    }
}

// `bun.LinearFifo(*PostgresSQLQuery, .Dynamic)` — element is a raw pointer
// (queries are JS-wrapper-owned, not Box-owned by the queue).
pub type Queue = bun_collections::linear_fifo::LinearFifo<
    *mut PostgresSQLQuery,
    bun_collections::linear_fifo::DynamicBuffer<*mut PostgresSQLQuery>,
>;

use crate::postgres::postgres_sql_connection::{SslMode, TlsStatus};

// ported from: src/sql_jsc/postgres/PostgresRequest.zig
