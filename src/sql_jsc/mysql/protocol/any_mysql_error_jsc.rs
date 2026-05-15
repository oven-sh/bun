use crate::jsc::{JSGlobalObject, JSValue, JsError};
use bun_sql::mysql::protocol::any_mysql_error::Error;
use bun_sql::mysql::protocol::error_packet::MySQLErrorOptions;

use super::error_packet_jsc::create_mysql_error;

/// Coerces the assorted error types callers thread through (`AnyMySQLError`
/// enum or the interned `bun_core::Error`) into the Zig-style error *name*
/// that the match below keys on. In Zig both are the same `error.Foo` value;
/// in Rust we bridge them via name string.
pub trait IntoAnyMySQLError: Copy {
    fn mysql_error_name(self) -> &'static str;
}

impl IntoAnyMySQLError for Error {
    #[inline]
    fn mysql_error_name(self) -> &'static str {
        <&'static str>::from(self)
    }
}

impl IntoAnyMySQLError for bun_core::Error {
    #[inline]
    fn mysql_error_name(self) -> &'static str {
        self.name()
    }
}

/// Zig `?[]const u8`. Callers pass either a bare byte-ish value (`&str`,
/// `&[u8]`, `&[u8; N]`, `&Vec<u8>`) or the same wrapped in `Option<_>`, so
/// this trait — rather than `AsRef<[u8]>` directly — lets one signature
/// accept both shapes without touching every callsite.
pub trait MaybeBytes {
    fn as_maybe_bytes(&self) -> Option<&[u8]>;
}
impl MaybeBytes for str {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        Some(self.as_bytes())
    }
}
impl MaybeBytes for [u8] {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        Some(self)
    }
}
impl<const N: usize> MaybeBytes for [u8; N] {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        Some(self.as_slice())
    }
}
impl MaybeBytes for Vec<u8> {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        Some(self.as_slice())
    }
}
impl MaybeBytes for String {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        Some(self.as_bytes())
    }
}
impl<T: MaybeBytes + ?Sized> MaybeBytes for &T {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        (**self).as_maybe_bytes()
    }
}
impl<T: MaybeBytes> MaybeBytes for Option<T> {
    #[inline]
    fn as_maybe_bytes(&self) -> Option<&[u8]> {
        self.as_ref().and_then(|b| b.as_maybe_bytes())
    }
}

pub fn mysql_error_to_js(
    global_object: &JSGlobalObject,
    // Zig: `?[]const u8` — `message orelse @errorName(err)`.
    message: impl MaybeBytes,
    err: impl IntoAnyMySQLError,
) -> JSValue {
    let name = err.mysql_error_name();
    let msg: &[u8] = message.as_maybe_bytes().unwrap_or(name.as_bytes());

    let code: &'static [u8] = match name {
        "ConnectionClosed" => b"ERR_MYSQL_CONNECTION_CLOSED",
        "Overflow" => b"ERR_MYSQL_OVERFLOW",
        "AuthenticationFailed" => b"ERR_MYSQL_AUTHENTICATION_FAILED",
        "UnsupportedAuthPlugin" => b"ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
        "UnsupportedProtocolVersion" => b"ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION",
        "LocalInfileNotSupported" => b"ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
        "WrongNumberOfParametersProvided" => b"ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        "UnsupportedColumnType" => b"ERR_MYSQL_UNSUPPORTED_COLUMN_TYPE",
        "InvalidLocalInfileRequest" => b"ERR_MYSQL_INVALID_LOCAL_INFILE_REQUEST",
        "InvalidAuthSwitchRequest" => b"ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST",
        "InvalidQueryBinding" => b"ERR_MYSQL_INVALID_QUERY_BINDING",
        "InvalidResultRow" => b"ERR_MYSQL_INVALID_RESULT_ROW",
        "InvalidBinaryValue" => b"ERR_MYSQL_INVALID_BINARY_VALUE",
        "InvalidEncodedInteger" => b"ERR_MYSQL_INVALID_ENCODED_INTEGER",
        "InvalidEncodedLength" => b"ERR_MYSQL_INVALID_ENCODED_LENGTH",
        "InvalidPrepareOKPacket" => b"ERR_MYSQL_INVALID_PREPARE_OK_PACKET",
        "InvalidOKPacket" => b"ERR_MYSQL_INVALID_OK_PACKET",
        "InvalidEOFPacket" => b"ERR_MYSQL_INVALID_EOF_PACKET",
        "InvalidErrorPacket" => b"ERR_MYSQL_INVALID_ERROR_PACKET",
        "UnexpectedPacket" => b"ERR_MYSQL_UNEXPECTED_PACKET",
        "ConnectionTimedOut" => b"ERR_MYSQL_CONNECTION_TIMEOUT",
        "IdleTimeout" => b"ERR_MYSQL_IDLE_TIMEOUT",
        "LifetimeTimeout" => b"ERR_MYSQL_LIFETIME_TIMEOUT",
        "PasswordRequired" => b"ERR_MYSQL_PASSWORD_REQUIRED",
        "MissingAuthData" => b"ERR_MYSQL_MISSING_AUTH_DATA",
        "FailedToEncryptPassword" => b"ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD",
        "InvalidPublicKey" => b"ERR_MYSQL_INVALID_PUBLIC_KEY",
        "InvalidState" => b"ERR_MYSQL_INVALID_STATE",
        "JSError" => {
            return global_object.take_exception(JsError::Thrown);
        }
        "JSTerminated" => {
            return global_object.take_exception(JsError::Terminated);
        }
        "OutOfMemory" => {
            return global_object.create_out_of_memory_error();
        }
        "ShortRead" => {
            unreachable!("Assertion failed: ShortRead should be handled by the caller in mysql");
        }
        // "UnknownError" + any name not in the AnyMySQLError set (possible when
        // the caller hands us a raw `bun_core::Error`).
        _ => b"ERR_MYSQL_UNKNOWN_ERROR",
    };

    create_mysql_error(
        global_object,
        msg,
        MySQLErrorOptions {
            code,
            errno: None,
            sql_state: None,
        },
    )
    .unwrap_or_else(|ex| global_object.take_exception(ex))
}

// ported from: src/sql_jsc/mysql/protocol/any_mysql_error_jsc.zig
