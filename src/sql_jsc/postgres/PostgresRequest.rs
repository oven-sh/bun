use bun_core::fmt as bun_fmt;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_str::String as BunString;

use bun_sql::postgres::PostgresProtocol as protocol;
use bun_sql::postgres::PostgresTypes as types;
use bun_sql::postgres::PostgresTypes::{AnyPostgresError, Int4, Short};

use crate::postgres::PostgresSQLConnection;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use crate::postgres::Signature;
use crate::shared::QueryBindingIterator::QueryBindingIterator;

bun_output::declare_scope!(Postgres, visible);

/// The PostgreSQL wire protocol uses 16-bit integers for parameter and column counts.
const MAX_PARAMETERS: usize = u16::MAX as usize;

// TODO(port): narrow error set
pub fn write_bind<Context>(
    name: &[u8],
    cursor_name: BunString,
    global: &JSGlobalObject,
    values_array: JSValue,
    columns_value: JSValue,
    parameter_fields: &[Int4],
    result_fields: &[protocol::FieldDescription],
    writer: protocol::NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    writer.write(b"B")?;
    let length = writer.length()?;

    // TODO(port): Zig had `.String` (takes bun.String) and `.string` (takes []const u8);
    // both snake_case to `string`. Renamed `.String` → `bun_string` here.
    writer.bun_string(cursor_name)?;
    writer.string(name)?;

    if parameter_fields.len() > MAX_PARAMETERS {
        return Err(bun_core::err!("TooManyParameters"));
    }

    let len: u16 = u16::try_from(parameter_fields.len()).unwrap();

    // The number of parameter format codes that follow (denoted C
    // below). This can be zero to indicate that there are no
    // parameters or that the parameters all use the default format
    // (text); or one, in which case the specified format code is
    // applied to all parameters; or it can equal the actual number
    // of parameters.
    writer.short(len)?;

    let mut iter = QueryBindingIterator::init(values_array, columns_value, global)?;
    for i in 0..(len as usize) {
        let parameter_field = parameter_fields[i];
        let is_custom_type = (Short::MAX as Int4) < parameter_field;
        let tag: types::Tag = if is_custom_type {
            types::Tag::Text
        } else {
            types::Tag::from_raw(Short::try_from(parameter_field).unwrap())
        };

        let force_text = is_custom_type
            || (tag.is_binary_format_supported() && 'brk: {
                iter.to(i as u32);
                if let Some(value) = iter.next()? {
                    break 'brk value.is_string();
                }
                if iter.any_failed() {
                    return Err(bun_core::err!("InvalidQueryBinding"));
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

    bun_output::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    iter.to(0);
    let mut i: usize = 0;
    while let Some(value) = iter.next()? {
        let tag: types::Tag = 'brk: {
            if i >= len as usize {
                // parameter in array but not in parameter_fields
                // this is probably a bug a bug in bun lets return .text here so the server will send a error 08P01
                // with will describe better the error saying exactly how many parameters are missing and are expected
                // Example:
                // SQL error: PostgresError: bind message supplies 0 parameters, but prepared statement "PSELECT * FROM test_table WHERE id=$1 .in$0" requires 1
                // errno: "08P01",
                // code: "ERR_POSTGRES_SERVER_ERROR"
                break 'brk types::Tag::Text;
            }
            let parameter_field = parameter_fields[i];
            let is_custom_type = (Short::MAX as Int4) < parameter_field;
            break 'brk if is_custom_type {
                types::Tag::Text
            } else {
                types::Tag::from_raw(Short::try_from(parameter_field).unwrap())
            };
        };
        if value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(Postgres, "  -> NULL");
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            writer.int4((-1i32) as u32)?;
            i += 1;
            continue;
        }
        #[cfg(feature = "debug_logs")]
        {
            bun_output::scoped_log!(
                Postgres,
                "  -> {}",
                bstr::BStr::new(tag.tag_name().unwrap_or(b"(unknown)"))
            );
        }

        // If they pass a value as a string, let's avoid attempting to
        // convert it to the binary representation. This minimizes the room
        // for mistakes on our end, such as stripping the timezone
        // differently than what Postgres does when given a timestamp with
        // timezone.
        let effective_tag = if tag.is_binary_format_supported() && value.is_string() {
            types::Tag::Text
        } else {
            tag
        };
        match effective_tag {
            types::Tag::Jsonb | types::Tag::Json => {
                let mut str = BunString::empty();
                // Use jsonStringifyFast for SIMD-optimized serialization
                value.json_stringify_fast(global, &mut str)?;
                let slice = str.to_utf8_without_ref();
                let l = writer.length()?;
                writer.write(slice.slice())?;
                l.write_excluding_self()?;
                // `str.deref()` and `slice.deinit()` handled by Drop
            }
            types::Tag::Bool => {
                let l = writer.length()?;
                writer.write(&[value.to_boolean() as u8])?;
                l.write_excluding_self()?;
            }
            types::Tag::Timestamp | types::Tag::Timestamptz => {
                let l = writer.length()?;
                writer.int8(types::date::from_js(global, value)?)?;
                l.write_excluding_self()?;
            }
            types::Tag::Bytea => {
                let mut bytes: &[u8] = b"";
                if let Some(buf) = value.as_array_buffer(global) {
                    bytes = buf.byte_slice();
                }
                let l = writer.length()?;
                bun_output::scoped_log!(Postgres, "    {} bytes", bytes.len());

                writer.write(bytes)?;
                l.write_excluding_self()?;
            }
            types::Tag::Int4 => {
                let l = writer.length()?;
                writer.int4(value.coerce_to_int32(global)? as u32)?;
                l.write_excluding_self()?;
            }
            types::Tag::Int4Array => {
                let l = writer.length()?;
                writer.int4(value.coerce_to_int32(global)? as u32)?;
                l.write_excluding_self()?;
            }
            types::Tag::Float8 => {
                let l = writer.length()?;
                // TODO(port): Zig had @bitCast on the f64 — verify writer.f64 param type
                writer.f64(value.to_number(global)?)?;
                l.write_excluding_self()?;
            }

            _ => {
                let str = BunString::from_js(value, global)?;
                if str.tag() == bun_str::Tag::Dead {
                    return Err(bun_core::err!("OutOfMemory"));
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
            return Err(bun_core::err!("TooManyParameters"));
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

pub fn write_query<Context>(
    query: &[u8],
    name: &[u8],
    params: &[Int4],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    {
        let mut q = protocol::Parse {
            name,
            params,
            query,
        };
        q.write_internal(writer)?;
        bun_output::scoped_log!(Postgres, "Parse: {}", bun_fmt::quote(query));
    }

    {
        let mut d = protocol::Describe {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
        };
        d.write_internal(writer)?;
        bun_output::scoped_log!(Postgres, "Describe: {}", bun_fmt::quote(name));
    }

    Ok(())
}

pub fn prepare_and_query_with_signature<Context>(
    global: &JSGlobalObject,
    query: &[u8],
    array_value: JSValue,
    writer: protocol::NewWriter<Context>,
    signature: &mut Signature,
) -> Result<(), AnyPostgresError> {
    write_query(query, &signature.prepared_statement_name, &signature.fields, writer)?;
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
    let mut exec = protocol::Execute {
        p: protocol::PortalOrPreparedStatement::PreparedStatement(&signature.prepared_statement_name),
    };
    exec.write_internal(writer)?;

    writer.write(&protocol::FLUSH)?;
    writer.write(&protocol::SYNC)?;
    Ok(())
}

// TODO(port): narrow error set
pub fn bind_and_execute<Context>(
    global: &JSGlobalObject,
    statement: &mut PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    writer: protocol::NewWriter<Context>,
) -> Result<(), bun_core::Error> {
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
    let mut exec = protocol::Execute {
        p: protocol::PortalOrPreparedStatement::PreparedStatement(
            &statement.signature.prepared_statement_name,
        ),
    };
    exec.write_internal(writer)?;

    writer.write(&protocol::FLUSH)?;
    writer.write(&protocol::SYNC)?;
    Ok(())
}

/// Atomically sends Parse + [Describe] + Bind + Execute + Flush + Sync as a single message batch.
/// This is required for unnamed prepared statements to work correctly with connection poolers
/// like PgBouncer in transaction mode, which may reassign server connections between protocol
/// round-trips. Without this, Parse and Bind+Execute could be routed to different backend
/// connections, causing queries to execute against the wrong prepared statement.
pub fn parse_and_bind_and_execute<Context>(
    global: &JSGlobalObject,
    query: &[u8],
    statement: &mut PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    include_describe: bool,
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    let name = &statement.signature.prepared_statement_name;

    // Parse
    {
        let mut q = protocol::Parse {
            name,
            params: &statement.signature.fields,
            query,
        };
        q.write_internal(writer)?;
        bun_output::scoped_log!(Postgres, "Parse: {}", bun_fmt::quote(query));
    }

    // Describe (needed on first execution to learn parameter/result types for caching)
    if include_describe {
        let mut d = protocol::Describe {
            p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
        };
        d.write_internal(writer)?;
        bun_output::scoped_log!(Postgres, "Describe: {}", bun_fmt::quote(name));
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
    let mut exec = protocol::Execute {
        p: protocol::PortalOrPreparedStatement::PreparedStatement(name),
    };
    exec.write_internal(writer)?;

    writer.write(&protocol::FLUSH)?;
    writer.write(&protocol::SYNC)?;
    Ok(())
}

// TODO(port): narrow error set
pub fn execute_query<Context>(
    query: &[u8],
    writer: protocol::NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    protocol::write_query(query, writer)?;
    writer.write(&protocol::FLUSH)?;
    writer.write(&protocol::SYNC)?;
    Ok(())
}

// TODO(port): narrow error set
pub fn on_data<Context>(
    connection: &mut PostgresSQLConnection,
    reader: protocol::NewReader<Context>,
) -> Result<(), bun_core::Error> {
    // TODO(port): `.DataRow` etc. are enum-literal tags on `connection.on`; using
    // `protocol::MessageKind::*` as a placeholder — verify actual enum path in Phase B.
    use protocol::MessageKind as M;
    loop {
        reader.mark_message_start();
        let c = reader.int::<u8>()?;
        bun_output::scoped_log!(Postgres, "read: {}", c as char);
        match c {
            b'D' => connection.on(M::DataRow, reader)?,
            b'd' => connection.on(M::CopyData, reader)?,
            b'S' => {
                if let TlsStatus::MessageSent(n) = connection.tls_status {
                    debug_assert!(n == 8);
                    connection.tls_status = TlsStatus::SslOk;
                    connection.setup_tls();
                    return Ok(());
                }

                connection.on(M::ParameterStatus, reader)?;
            }
            b'Z' => connection.on(M::ReadyForQuery, reader)?,
            b'C' => connection.on(M::CommandComplete, reader)?,
            b'2' => connection.on(M::BindComplete, reader)?,
            b'1' => connection.on(M::ParseComplete, reader)?,
            b't' => connection.on(M::ParameterDescription, reader)?,
            b'T' => connection.on(M::RowDescription, reader)?,
            b'R' => connection.on(M::Authentication, reader)?,
            b'n' => connection.on(M::NoData, reader)?,
            b'K' => connection.on(M::BackendKeyData, reader)?,
            b'E' => connection.on(M::ErrorResponse, reader)?,
            b's' => connection.on(M::PortalSuspended, reader)?,
            b'3' => connection.on(M::CloseComplete, reader)?,
            b'G' => connection.on(M::CopyInResponse, reader)?,
            b'N' => {
                if matches!(connection.tls_status, TlsStatus::MessageSent(_)) {
                    connection.tls_status = TlsStatus::SslNotAvailable;
                    bun_output::scoped_log!(Postgres, "Server does not support SSL");
                    if connection.ssl_mode == SslMode::Require {
                        connection.fail(
                            "Server does not support SSL",
                            bun_core::err!("TLSNotAvailable"),
                        );
                        return Ok(());
                    }
                    continue;
                }

                connection.on(M::NoticeResponse, reader)?;
            }
            b'I' => connection.on(M::EmptyQueryResponse, reader)?,
            b'H' => connection.on(M::CopyOutResponse, reader)?,
            b'c' => connection.on(M::CopyDone, reader)?,
            b'W' => connection.on(M::CopyBothResponse, reader)?,

            _ => {
                bun_output::scoped_log!(Postgres, "Unknown message: {}", c as char);
                let to_skip = reader.length()?.saturating_sub(1);
                bun_output::scoped_log!(Postgres, "to_skip: {}", to_skip);
                reader.skip(usize::try_from(to_skip.max(0)).unwrap())?;
            }
        }
    }
}

// TODO(port): `bun.LinearFifo(*PostgresSQLQuery, .Dynamic)` — verify bun_collections::LinearFifo exists;
// element is a raw pointer (queries are JS-wrapper-owned, not Box-owned by the queue).
pub type Queue = bun_collections::LinearFifo<*mut PostgresSQLQuery>;

// TODO(port): TlsStatus / SslMode live on PostgresSQLConnection — import path placeholder.
use crate::postgres::PostgresSQLConnection::{SslMode, TlsStatus};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresRequest.zig (416 lines)
//   confidence: medium
//   todos:      8
//   notes:      NewWriter<Context>/NewReader<Context> kept generic; `.String`/`.string` writer methods collide in snake_case (renamed .String→bun_string); `connection.on` message-tag enum path is a guess; protocol Flush/Sync assumed const items FLUSH/SYNC.
// ──────────────────────────────────────────────────────────────────────────
