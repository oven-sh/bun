use crate::jsc::{JSGlobalObject, JSValue, StringJsc as _};
use bun_core::String as BunString;
use bun_core::fmt as bun_fmt;
use bun_jsc::ArrayBuffer;

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

fn invalid_bind_value(
    global: &JSGlobalObject,
    index: usize,
    pg_type: &str,
    expected: &str,
    value: JSValue,
) -> AnyPostgresError {
    let received = match JSGlobalObject::determine_specific_type(global, value) {
        Ok(received) => received,
        Err(err) => return js_error_to_postgres(err),
    };
    js_error_to_postgres(global.throw_value(global.ERR_INVALID_ARG_TYPE(format_args!(
        "Query parameter ${} of type {} must be {}. Received {}",
        index + 1,
        pg_type,
        expected,
        received,
    ))))
}

/// How one bound parameter goes on the wire. `param_encoding` decides it once,
/// so the format code and the bytes of a parameter cannot disagree.
enum ParamEncoding {
    Bool(bool),
    Int4(i32),
    Float8(f64),
    /// Microseconds since 2000-01-01.
    Timestamp(i64),
    Bytes(ArrayBuffer),
    /// `JSON.stringify(value)` in text format.
    Json,
    /// `String(value)` in text format. The server parses it as the parameter's type.
    Text,
}

const _: () = assert!(core::mem::size_of::<ParamEncoding>() <= 48);

/// A binary encoder runs only for the JS class it represents exactly. Any other
/// value goes as text, so the server rejects what it cannot parse. Boolean and
/// bytea input accept text that is not such a value (`String([true])`, any
/// string), so those two slots reject here.
#[inline(always)]
fn param_encoding(
    global: &JSGlobalObject,
    tag: types::Tag,
    value: JSValue,
    index: usize,
) -> Result<ParamEncoding, AnyPostgresError> {
    Ok(match tag {
        types::Tag::json | types::Tag::jsonb => ParamEncoding::Json,
        // A string is never converted: the server parses it, so Bun cannot, for
        // example, strip a time zone differently than Postgres does.
        types::Tag::bool
        | types::Tag::bytea
        | types::Tag::int4
        | types::Tag::float8
        | types::Tag::timestamp
        | types::Tag::timestamptz
            if value.is_string() =>
        {
            ParamEncoding::Text
        }
        types::Tag::bool => {
            if !value.is_boolean() {
                return Err(invalid_bind_value(
                    global,
                    index,
                    "boolean",
                    "a boolean or a string",
                    value,
                ));
            }
            ParamEncoding::Bool(value.as_boolean())
        }
        types::Tag::bytea => match value.as_array_buffer(global) {
            Some(buffer) => ParamEncoding::Bytes(buffer),
            None => {
                return Err(invalid_bind_value(
                    global,
                    index,
                    "bytea",
                    "a Buffer, TypedArray, ArrayBuffer or string",
                    value,
                ));
            }
        },
        types::Tag::int4 => exact_int4(value).map_or(ParamEncoding::Text, ParamEncoding::Int4),
        types::Tag::float8 if value.is_number() => ParamEncoding::Float8(value.as_number()),
        types::Tag::timestamp | types::Tag::timestamptz => {
            let ms = if value.is_date() {
                value.get_unix_timestamp()
            } else if value.is_number() {
                value.as_number()
            } else {
                f64::NAN
            };
            // NaN is an Invalid Date. As text, the server's error names it.
            if ms.is_nan() {
                ParamEncoding::Text
            } else {
                ParamEncoding::Timestamp(crate::postgres::types::date::from_unix_ms(ms))
            }
        }
        _ => ParamEncoding::Text,
    })
}

/// The `i32` that a JS number holds exactly, if any.
fn exact_int4(value: JSValue) -> Option<i32> {
    if value.is_int32() {
        return Some(value.as_int32());
    }
    if !value.is_number() {
        return None;
    }
    let double = value.as_number();
    let fits =
        double.trunc() == double && double >= f64::from(i32::MIN) && double <= f64::from(i32::MAX);
    fits.then_some(double as i32)
}

fn write_bind<Context: WriterContext>(
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

    // One format code per parameter. Each starts as text (0). A parameter that
    // is written in binary below sets its own code.
    let format_codes = writer.format_codes(len)?;

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    writer.short(len)?;

    bun_core::scoped_log!(Postgres, "Bind: {} ({} args)", bun_fmt::quote(name), len);
    let mut iter = QueryBindingIterator::init(values_array, columns_value, global)
        .map_err(js_error_to_postgres)?;
    let mut i: usize = 0;
    while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
        let tag: types::Tag = match parameter_fields.get(i) {
            // An extra value goes as text. The server reports the count mismatch (08P01).
            None => types::Tag::text,
            // An OID above `Short::MAX` is a user-defined type.
            Some(&parameter_field) if (Short::MAX as Int4) < parameter_field => types::Tag::text,
            Some(&parameter_field) => types::Tag(Short::try_from(parameter_field).unwrap()),
        };
        if value.is_empty_or_undefined_or_null() {
            bun_core::scoped_log!(Postgres, "  -> NULL");
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            writer.int4((-1i32) as u32)?;
            // A NULL has no bytes for the code to disagree with. It takes its type's code.
            if tag.format_code() == 1 {
                format_codes.set_binary(i)?;
            }
            i += 1;
            continue;
        }
        bun_core::scoped_log!(Postgres, "  -> {}", tag.tag_name().unwrap_or("(unknown)"));

        let binary = match param_encoding(global, tag, value, i)? {
            ParamEncoding::Bool(boolean) => {
                let l = writer.length()?;
                writer.write(&[boolean as u8])?;
                l.write_excluding_self()?;
                true
            }
            ParamEncoding::Int4(int) => {
                let l = writer.length()?;
                writer.int4(int as u32)?;
                l.write_excluding_self()?;
                true
            }
            ParamEncoding::Float8(double) => {
                let l = writer.length()?;
                writer.f64(double)?;
                l.write_excluding_self()?;
                true
            }
            ParamEncoding::Timestamp(microseconds) => {
                let l = writer.length()?;
                writer.int8(microseconds)?;
                l.write_excluding_self()?;
                true
            }
            ParamEncoding::Bytes(buffer) => {
                let bytes = buffer.byte_slice();
                let l = writer.length()?;
                bun_core::scoped_log!(Postgres, "    {} bytes", bytes.len());
                writer.write(bytes)?;
                l.write_excluding_self()?;
                true
            }
            ParamEncoding::Json => {
                // Use jsonStringifyFast for SIMD-optimized serialization
                let str = value
                    .json_stringify_fast(global)
                    .map_err(js_error_to_postgres)?;
                let slice = str.to_utf8();
                let l = writer.length()?;
                writer.write(slice.slice())?;
                l.write_excluding_self()?;
                false
            }
            ParamEncoding::Text => {
                let str = BunString::from_js(value, global).map_err(js_error_to_postgres)?;
                if str.tag() == bun_core::Tag::Dead {
                    return Err(AnyPostgresError::OutOfMemory);
                }
                let slice = str.to_utf8();
                let l = writer.length()?;
                writer.write(slice.slice())?;
                l.write_excluding_self()?;
                false
            }
        };
        if binary {
            format_codes.set_binary(i)?;
        }

        i += 1;
    }
    if iter.any_failed() {
        return Err(AnyPostgresError::InvalidQueryBinding);
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

fn prepare_and_query_with_signature<Context: WriterContext>(
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

fn bind_and_execute<Context: WriterContext>(
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
fn parse_and_bind_and_execute<Context: WriterContext>(
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

/// One batch whose Bind encodes a request's parameters.
pub(crate) enum EncodeRequest<'a> {
    /// Bind + Execute for a statement the server has already parsed.
    BindAndExecute {
        statement: &'a PostgresSQLStatement,
        binding_value: JSValue,
        columns_value: JSValue,
    },
    /// Parse + [Describe] + Bind + Execute for an unnamed statement (`prepare: false`).
    ParseBindAndExecute {
        query: &'a [u8],
        statement: &'a PostgresSQLStatement,
        binding_value: JSValue,
        columns_value: JSValue,
        include_describe: bool,
    },
    /// Parse + Describe + Bind + Execute for a query without parameters.
    PrepareAndQuery {
        query: &'a [u8],
        signature: &'a mut Signature,
        binding_value: JSValue,
    },
}

impl PostgresSQLConnection {
    /// The only caller of the batch writers above.
    pub(crate) fn encode_request(
        &self,
        global: &JSGlobalObject,
        request: EncodeRequest<'_>,
    ) -> Result<(), AnyPostgresError> {
        let writer = self.writer();
        match request {
            EncodeRequest::BindAndExecute {
                statement,
                binding_value,
                columns_value,
            } => bind_and_execute(global, statement, binding_value, columns_value, writer),
            EncodeRequest::ParseBindAndExecute {
                query,
                statement,
                binding_value,
                columns_value,
                include_describe,
            } => parse_and_bind_and_execute(
                global,
                query,
                statement,
                binding_value,
                columns_value,
                include_describe,
                writer,
            ),
            EncodeRequest::PrepareAndQuery {
                query,
                signature,
                binding_value,
            } => prepare_and_query_with_signature(global, query, binding_value, writer, signature),
        }
    }
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
