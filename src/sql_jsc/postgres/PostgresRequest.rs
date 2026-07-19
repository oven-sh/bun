use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _};
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

/// A query parameter converted to its wire-ready native form. Every JS
/// evaluation that can run user code (index getters, valueOf / toString /
/// toJSON, Proxy traps) happens while building the `Vec<BoundValue>`; once
/// that succeeds the write phase touches only these values, so a throwing
/// conversion cannot leave a half-written Bind in the connection's buffer.
enum BoundValue {
    Null,
    Bool(bool),
    Int4(i32),
    Float8(f64),
    Int8(i64),
    Bytes(Vec<u8>),
}

struct BoundParams {
    format_codes: Vec<Short>,
    values: Vec<BoundValue>,
}

fn tag_for(parameter_fields: &[Int4], i: usize) -> types::Tag {
    if i >= parameter_fields.len() {
        // parameter in array but not in parameter_fields
        // this is probably a bug a bug in bun lets return .text here so the server will send a error 08P01
        // with will describe better the error saying exactly how many parameters are missing and are expected
        // Example:
        // SQL error: PostgresError: bind message supplies 0 parameters, but prepared statement "PSELECT * FROM test_table WHERE id=$1 .in$0" requires 1
        // errno: "08P01",
        // code: "ERR_POSTGRES_SERVER_ERROR"
        return types::Tag::text;
    }
    let parameter_field = parameter_fields[i];
    if (Short::MAX as Int4) < parameter_field {
        types::Tag::text
    } else {
        types::Tag(Short::try_from(parameter_field).unwrap())
    }
}

/// Evaluate every bound JS value into native [`BoundValue`]s and the matching
/// per-parameter format codes. All JS re-entry happens here; the caller writes
/// the Bind message only after this returns `Ok`.
fn encode_bind_params(
    global: &JSGlobalObject,
    values_array: JSValue,
    columns_value: JSValue,
    parameter_fields: &[Int4],
) -> Result<BoundParams, AnyPostgresError> {
    let len = parameter_fields.len();
    let mut iter = QueryBindingIterator::init(values_array, columns_value, global)
        .map_err(js_error_to_postgres)?;

    let mut format_codes: Vec<Short> = Vec::with_capacity(len);
    for i in 0..len {
        let parameter_field = parameter_fields[i];
        let is_custom_type = (Short::MAX as Int4) < parameter_field;
        let tag = tag_for(parameter_fields, i);

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

        // If they pass a value as a string, let's avoid attempting to
        // convert it to the binary representation. This minimizes the room
        // for mistakes on our end, such as stripping the timezone
        // differently than what Postgres does when given a timestamp with
        // timezone.
        format_codes.push(if force_text { 0 } else { tag.format_code() });
    }

    let mut values: Vec<BoundValue> = Vec::with_capacity(len);
    iter.to(0);
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        let tag = tag_for(parameter_fields, i);
        i += 1;
        if value.is_empty_or_undefined_or_null() {
            values.push(BoundValue::Null);
            continue;
        }

        let effective_tag = if tag.is_binary_format_supported() && value.is_string() {
            types::Tag::text
        } else {
            tag
        };
        values.push(match effective_tag {
            types::Tag::jsonb | types::Tag::json => {
                let mut str = BunString::empty();
                // Use jsonStringifyFast for SIMD-optimized serialization
                value
                    .json_stringify_fast(global, &mut str)
                    .map_err(js_error_to_postgres)?;
                BoundValue::Bytes(str.to_utf8_without_ref().slice().to_vec())
            }
            types::Tag::bool => BoundValue::Bool(value.to_boolean()),
            types::Tag::timestamp | types::Tag::timestamptz => BoundValue::Int8(
                crate::postgres::types::date::from_js(global, value).map_err(js_error_to_postgres)?,
            ),
            types::Tag::bytea => BoundValue::Bytes(match value.as_array_buffer(global) {
                Some(b) => b.byte_slice().to_vec(),
                None => Vec::new(),
            }),
            types::Tag::int4 | types::Tag::int4_array => {
                BoundValue::Int4(value.coerce::<i32>(global).map_err(js_error_to_postgres)?)
            }
            types::Tag::float8 => {
                BoundValue::Float8(value.to_number(global).map_err(js_error_to_postgres)?)
            }
            _ => {
                let str = bun_core::OwnedString::new(
                    BunString::from_js(value, global).map_err(js_error_to_postgres)?,
                );
                if str.tag() == bun_core::Tag::Dead {
                    return Err(AnyPostgresError::OutOfMemory);
                }
                BoundValue::Bytes(str.to_utf8_without_ref().slice().to_vec())
            }
        });
    }

    Ok(BoundParams {
        format_codes,
        values,
    })
}

fn write_bind_encoded<Context: WriterContext>(
    name: &[u8],
    cursor_name: BunString,
    params: &BoundParams,
    result_fields: &[protocol::FieldDescription],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"B")?;
    let length = writer.length()?;

    // The bun.String overload is `bun_string` on NewWriter.
    writer.bun_string(&cursor_name)?;
    writer.string(name)?;

    let len = params.format_codes.len();

    // The number of parameter format codes that follow (denoted C
    // below). This can be zero to indicate that there are no
    // parameters or that the parameters all use the default format
    // (text); or one, in which case the specified format code is
    // applied to all parameters; or it can equal the actual number
    // of parameters.
    writer.short(len)?;
    for code in &params.format_codes {
        writer.short(*code)?;
    }

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    writer.short(len)?;

    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    for value in &params.values {
        match value {
            BoundValue::Null => {
                bun_core::scoped_log!(Postgres, "  -> NULL");
                //  As a special case, -1 indicates a
                // NULL parameter value. No value bytes follow in the NULL case.
                writer.int4((-1i32) as u32)?;
            }
            BoundValue::Bool(b) => {
                let l = writer.length()?;
                writer.write(&[*b as u8])?;
                l.write_excluding_self()?;
            }
            BoundValue::Int4(n) => {
                let l = writer.length()?;
                writer.int4(*n as u32)?;
                l.write_excluding_self()?;
            }
            BoundValue::Float8(n) => {
                let l = writer.length()?;
                writer.f64(*n)?;
                l.write_excluding_self()?;
            }
            BoundValue::Int8(n) => {
                let l = writer.length()?;
                writer.int8(*n)?;
                l.write_excluding_self()?;
            }
            BoundValue::Bytes(bytes) => {
                let l = writer.length()?;
                bun_core::scoped_log!(Postgres, "  -> {} bytes", bytes.len());
                writer.write(bytes)?;
                l.write_excluding_self()?;
            }
        }
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

pub(crate) fn prepare_and_query_with_signature<Context: WriterContext>(
    global: &JSGlobalObject,
    query: &[u8],
    array_value: JSValue,
    mut writer: protocol::NewWriter<Context>,
    signature: &mut Signature,
) -> Result<(), AnyPostgresError> {
    // Convert every parameter before the first write so a throwing conversion
    // cannot leave Parse+Describe stranded in the buffer ahead of a Bind that
    // will never be written.
    let params = encode_bind_params(global, array_value, JSValue::ZERO, &[])?;
    write_query(
        query,
        &signature.prepared_statement_name,
        &signature.fields,
        writer,
    )?;
    write_bind_encoded(
        &signature.prepared_statement_name,
        BunString::empty(),
        &params,
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

pub(crate) fn bind_and_execute<Context: WriterContext>(
    global: &JSGlobalObject,
    statement: &PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    mut writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    if statement.parameters.len() > MAX_PARAMETERS {
        return Err(AnyPostgresError::TooManyParameters);
    }
    let params = encode_bind_params(global, array_value, columns_value, &statement.parameters)?;
    write_bind_encoded(
        &statement.signature.prepared_statement_name,
        BunString::empty(),
        &params,
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

    // Bind — use server-provided types if available (binary format), otherwise
    // fall back to signature types (text format for unknowns). The server will
    // handle text-to-type conversion based on the parameter types from Parse.
    // Convert every parameter before the first write so a throwing conversion
    // cannot leave Parse (+Describe) stranded in the buffer.
    let param_fields = if !statement.parameters.is_empty() {
        &statement.parameters[..]
    } else {
        &statement.signature.fields[..]
    };
    if param_fields.len() > MAX_PARAMETERS {
        return Err(AnyPostgresError::TooManyParameters);
    }
    let params = encode_bind_params(global, array_value, columns_value, param_fields)?;

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
    let result_fields = &statement.fields;

    write_bind_encoded(name, BunString::empty(), &params, result_fields, writer)?;

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
        if matches!(connection.tls_status.get(), TlsStatus::MessageSent(_))
            && c != b'S'
            && c != b'N'
        {
            return Err(AnyPostgresError::UnexpectedMessage);
        }
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

                connection.on(M::NoticeResponse, reader.reborrow())?;
            }
            b'I' => connection.on(M::EmptyQueryResponse, reader.reborrow())?,
            b'H' => connection.on(M::CopyOutResponse, reader.reborrow())?,
            b'c' => connection.on(M::CopyDone, reader.reborrow())?,
            b'W' => connection.on(M::CopyBothResponse, reader.reborrow())?,
            b'A' => connection.on(M::NotificationResponse, reader.reborrow())?,

            _ => {
                bun_core::scoped_log!(Postgres, "Unknown message: {}", c as char);
                let length = reader.length()?;
                let to_skip = length - 4;
                bun_core::scoped_log!(Postgres, "to_skip: {}", to_skip);
                reader.skip(usize::try_from(to_skip).expect("int cast"))?;
            }
        }
    }
}

// `bun.LinearFifo(*PostgresSQLQuery, .Dynamic)` — element is a raw pointer
// (queries are JS-wrapper-owned, not Box-owned by the queue).
pub(crate) type Queue = bun_collections::linear_fifo::LinearFifo<
    *mut PostgresSQLQuery,
    bun_collections::linear_fifo::DynamicBuffer<*mut PostgresSQLQuery>,
>;

use crate::postgres::postgres_sql_connection::{SslMode, TlsStatus};
