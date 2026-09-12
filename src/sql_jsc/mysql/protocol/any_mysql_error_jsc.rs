use crate::jsc::{JSGlobalObject, JSValue, JsError};
use bun_sql::mysql::protocol::any_mysql_error::Error;
use bun_sql::mysql::protocol::error_packet::MySQLErrorOptions;

use super::error_packet_jsc::create_mysql_error;

/// Coerces the assorted error types callers thread through (`AnyMySQLError`
/// enum or the interned `crate::Error`) into the error *name*
/// that the match below keys on.
pub(crate) trait IntoAnyMySQLError: Copy {
    fn mysql_error_name(self) -> &'static str;
}

impl IntoAnyMySQLError for Error {
    #[inline]
    fn mysql_error_name(self) -> &'static str {
        <&'static str>::from(self)
    }
}

impl IntoAnyMySQLError for crate::Error {
    #[inline]
    fn mysql_error_name(self) -> &'static str {
        self.name()
    }
}

/// Callers pass either a bare byte-ish value (`&str`,
/// `&[u8]`, `&[u8; N]`, `&Vec<u8>`) or the same wrapped in `Option<_>`, so
/// this trait — rather than `AsRef<[u8]>` directly — lets one signature
/// accept both shapes without touching every callsite.
pub(crate) trait MaybeBytes {
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

pub(crate) fn mysql_error_to_js(
    global_object: &JSGlobalObject,
    // Falls back to the per-variant default message when no message is given.
    message: impl MaybeBytes,
    err: impl IntoAnyMySQLError,
) -> JSValue {
    let name = err.mysql_error_name();

    let (code, default_message): (&'static [u8], &'static [u8]) = match name {
        "ConnectionClosed" => (b"ERR_MYSQL_CONNECTION_CLOSED", b"Connection closed"),
        "ConnectionFailed" => (b"ERR_MYSQL_CONNECTION_FAILED", b"Connection failed"),
        "ConnectionRefused" => (b"ERR_MYSQL_CONNECTION_REFUSED", b"Connection refused"),
        "Overflow" => (
            b"ERR_MYSQL_OVERFLOW",
            b"Packet exceeds the maximum payload length",
        ),
        "AuthenticationFailed" => (b"ERR_MYSQL_AUTHENTICATION_FAILED", b"Authentication failed"),
        "UnsupportedAuthPlugin" => (
            b"ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
            b"Server requested an unsupported authentication plugin",
        ),
        "UnsupportedProtocolVersion" => (
            b"ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION",
            b"Server is using an unsupported protocol version",
        ),
        "LocalInfileNotSupported" => (
            b"ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
            b"LOCAL INFILE is not supported",
        ),
        "WrongNumberOfParametersProvided" => (
            b"ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
            b"Wrong number of parameters provided",
        ),
        "TooManyParameters" => (
            b"ERR_MYSQL_TOO_MANY_PARAMETERS",
            b"Query has too many parameters - the MySQL wire protocol supports a maximum \
              of 65535 parameters per query. Try reducing your batch size",
        ),
        "UnsupportedColumnType" => (
            b"ERR_MYSQL_UNSUPPORTED_COLUMN_TYPE",
            b"Unsupported column type",
        ),
        "InvalidLocalInfileRequest" => (
            b"ERR_MYSQL_INVALID_LOCAL_INFILE_REQUEST",
            b"Invalid LOCAL INFILE request received from the server",
        ),
        "InvalidAuthSwitchRequest" => (
            b"ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST",
            b"Invalid AuthSwitchRequest packet received from the server",
        ),
        "InvalidQueryBinding" => (
            b"ERR_MYSQL_INVALID_QUERY_BINDING",
            b"Failed to bind query parameters",
        ),
        "InvalidResultRow" => (
            b"ERR_MYSQL_INVALID_RESULT_ROW",
            b"Invalid result row received from the server",
        ),
        "InvalidBinaryValue" => (
            b"ERR_MYSQL_INVALID_BINARY_VALUE",
            b"Invalid binary value received from the server",
        ),
        "InvalidEncodedInteger" => (
            b"ERR_MYSQL_INVALID_ENCODED_INTEGER",
            b"Invalid length-encoded integer received from the server",
        ),
        "InvalidEncodedLength" => (
            b"ERR_MYSQL_INVALID_ENCODED_LENGTH",
            b"Invalid length-encoded value received from the server",
        ),
        "InvalidPrepareOKPacket" => (
            b"ERR_MYSQL_INVALID_PREPARE_OK_PACKET",
            b"Invalid prepared statement OK packet received from the server",
        ),
        "InvalidOKPacket" => (
            b"ERR_MYSQL_INVALID_OK_PACKET",
            b"Invalid OK packet received from the server",
        ),
        "InvalidEOFPacket" => (
            b"ERR_MYSQL_INVALID_EOF_PACKET",
            b"Invalid EOF packet received from the server",
        ),
        "InvalidErrorPacket" => (
            b"ERR_MYSQL_INVALID_ERROR_PACKET",
            b"Invalid error packet received from the server",
        ),
        "UnexpectedPacket" => (
            b"ERR_MYSQL_UNEXPECTED_PACKET",
            b"Unexpected packet received from the server",
        ),
        "ConnectionTimedOut" => (b"ERR_MYSQL_CONNECTION_TIMEOUT", b"Connection timed out"),
        "IdleTimeout" => (
            b"ERR_MYSQL_IDLE_TIMEOUT",
            b"Connection closed due to idle timeout",
        ),
        "LifetimeTimeout" => (
            b"ERR_MYSQL_LIFETIME_TIMEOUT",
            b"Connection closed after exceeding its maximum lifetime",
        ),
        "PasswordRequired" => (
            b"ERR_MYSQL_PASSWORD_REQUIRED",
            b"Server requires a password, but none was provided",
        ),
        "MissingAuthData" => (
            b"ERR_MYSQL_MISSING_AUTH_DATA",
            b"Server did not send authentication data during the handshake",
        ),
        "FailedToEncryptPassword" => (
            b"ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD",
            b"Failed to encrypt password with the server's RSA public key",
        ),
        "InvalidPublicKey" => (
            b"ERR_MYSQL_INVALID_PUBLIC_KEY",
            b"Server sent an invalid RSA public key",
        ),
        "PublicKeyRetrievalNotAllowed" => (
            b"ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
            b"The server requested RSA public key retrieval to complete authentication, \
              which is not allowed over an insecure connection. Enable TLS or set \
              allowPublicKeyRetrieval: true",
        ),
        "JSError" => {
            return global_object.take_exception(JsError::Thrown);
        }
        "OutOfMemory" => {
            return global_object.create_out_of_memory_error();
        }
        "ShortRead" => {
            unreachable!("Assertion failed: ShortRead should be handled by the caller in mysql");
        }
        // "UnknownError" + any name not in the AnyMySQLError set (possible when
        // the caller hands us a raw `crate::Error`).
        _ => (b"ERR_MYSQL_UNKNOWN_ERROR", name.as_bytes()),
    };
    let msg: &[u8] = message.as_maybe_bytes().unwrap_or(default_message);

    create_mysql_error(
        global_object,
        msg,
        &MySQLErrorOptions {
            code,
            errno: None,
            sql_state: None,
        },
    )
    .unwrap_or_else(|ex| global_object.take_exception(ex))
}
