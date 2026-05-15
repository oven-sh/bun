//! `createPostgresError` / `postgresErrorToJS` bridges.

use crate::jsc::{JSGlobalObject, JSValue, JsError, JsResult, bun_string_jsc};
use bun_sql::postgres::any_postgres_error::{AnyPostgresError, PostgresErrorOptions};

pub fn create_postgres_error(
    global: &JSGlobalObject,
    message: &[u8],
    options: PostgresErrorOptions,
) -> JsResult<JSValue> {
    let opts_obj = JSValue::create_empty_object(global, 0);
    opts_obj.ensure_still_alive();
    opts_obj.put(
        global,
        b"code",
        bun_string_jsc::create_utf8_for_js(global, options.code)?,
    );
    // PORT NOTE: Zig used `inline for (std.meta.fields(PostgresErrorOptions))` + `@typeInfo`
    // to reflect over every optional field and `put` it by name when `Some`. Rust has no
    // field reflection; expand by hand. Property names must match the Zig struct field
    // names verbatim (camelCase: `internalPosition`, `internalQuery`, `dataType`) since
    // the JS consumer reads `options.internalPosition` etc.
    let optional_fields: [(&'static [u8], Option<&[u8]>); 16] = [
        (b"errno", options.errno),
        (b"detail", options.detail),
        (b"hint", options.hint),
        (b"severity", options.severity),
        (b"position", options.position),
        (b"internalPosition", options.internal_position),
        (b"internalQuery", options.internal_query),
        (b"where", options.r#where),
        (b"schema", options.schema),
        (b"table", options.table),
        (b"column", options.column),
        (b"dataType", options.data_type),
        (b"constraint", options.constraint),
        (b"file", options.file),
        (b"line", options.line),
        (b"routine", options.routine),
    ];
    for (name, value) in optional_fields {
        opts_obj.put_optional_utf8(global, name, value)?;
    }
    opts_obj.put(
        global,
        b"message",
        bun_string_jsc::create_utf8_for_js(global, message)?,
    );

    Ok(opts_obj)
}

pub fn postgres_error_to_js(
    global: &JSGlobalObject,
    message: Option<&[u8]>,
    err: AnyPostgresError,
) -> JSValue {
    use AnyPostgresError::*;
    let code: &'static [u8] = match err {
        ConnectionClosed => b"ERR_POSTGRES_CONNECTION_CLOSED",
        ExpectedRequest => b"ERR_POSTGRES_EXPECTED_REQUEST",
        ExpectedStatement => b"ERR_POSTGRES_EXPECTED_STATEMENT",
        InvalidBackendKeyData => b"ERR_POSTGRES_INVALID_BACKEND_KEY_DATA",
        InvalidBinaryData => b"ERR_POSTGRES_INVALID_BINARY_DATA",
        InvalidByteSequence => b"ERR_POSTGRES_INVALID_BYTE_SEQUENCE",
        InvalidByteSequenceForEncoding => b"ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING",
        InvalidCharacter => b"ERR_POSTGRES_INVALID_CHARACTER",
        InvalidMessage => b"ERR_POSTGRES_INVALID_MESSAGE",
        InvalidMessageLength => b"ERR_POSTGRES_INVALID_MESSAGE_LENGTH",
        InvalidQueryBinding => b"ERR_POSTGRES_INVALID_QUERY_BINDING",
        InvalidServerKey => b"ERR_POSTGRES_INVALID_SERVER_KEY",
        InvalidServerSignature => b"ERR_POSTGRES_INVALID_SERVER_SIGNATURE",
        InvalidTimeFormat => b"ERR_POSTGRES_INVALID_TIME_FORMAT",
        MultidimensionalArrayNotSupportedYet => {
            b"ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET"
        }
        NullsInArrayNotSupportedYet => b"ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET",
        Overflow => b"ERR_POSTGRES_OVERFLOW",
        PBKDFD2 => b"ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2",
        SASL_SIGNATURE_MISMATCH => b"ERR_POSTGRES_SASL_SIGNATURE_MISMATCH",
        SASL_SIGNATURE_INVALID_BASE64 => b"ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64",
        TLSNotAvailable => b"ERR_POSTGRES_TLS_NOT_AVAILABLE",
        TLSUpgradeFailed => b"ERR_POSTGRES_TLS_UPGRADE_FAILED",
        TooManyParameters => {
            let too_many_msg: &[u8] = b"query has too many parameters - the PostgreSQL wire protocol supports a maximum of 65535 parameters per query. Try reducing your batch size.";
            return match create_postgres_error(
                global,
                too_many_msg,
                PostgresErrorOptions {
                    code: b"ERR_POSTGRES_TOO_MANY_PARAMETERS",
                    hint: Some(b"Reduce the number of rows in your batch insert so that total_rows * columns_per_row does not exceed 65535."),
                    ..Default::default()
                },
            ) {
                Ok(v) => v,
                Err(e) => global.take_error(e),
            };
        }
        UnexpectedMessage => b"ERR_POSTGRES_UNEXPECTED_MESSAGE",
        UNKNOWN_AUTHENTICATION_METHOD => b"ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD",
        UNSUPPORTED_AUTHENTICATION_METHOD => b"ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD",
        UnsupportedByteaFormat => b"ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT",
        UnsupportedArrayFormat => b"ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT",
        UnsupportedIntegerSize => b"ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
        UnsupportedNumericFormat => b"ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
        UnknownFormatCode => b"ERR_POSTGRES_UNKNOWN_FORMAT_CODE",
        JSError => {
            return global.take_exception(JsError::Thrown);
        }
        JSTerminated => {
            return global.take_exception(JsError::Terminated);
        }
        OutOfMemory => {
            return global.create_out_of_memory_error();
        }
        ShortRead => {
            unreachable!("Assertion failed: ShortRead should be handled by the caller in postgres");
        }
    };

    let mut buffer_message = [0u8; 256];
    let msg: &[u8] = if let Some(m) = message {
        m
    } else {
        // PORT NOTE: reshaped for borrowck — capture remaining len before re-borrowing buffer.
        use std::io::Write;
        let name: &'static str = <&'static str>::from(err);
        let mut cursor = &mut buffer_message[..];
        if write!(cursor, "Failed to bind query: {}", name).is_ok() {
            let remaining = cursor.len();
            let written = 256 - remaining;
            &buffer_message[..written]
        } else {
            b"Failed to bind query"
        }
    };

    match create_postgres_error(
        global,
        msg,
        PostgresErrorOptions {
            code,
            ..Default::default()
        },
    ) {
        Ok(v) => v,
        Err(e) => global.take_error(e),
    }
}

// ported from: src/sql_jsc/postgres/error_jsc.zig
