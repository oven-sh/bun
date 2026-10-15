use crate::jsc::{JSGlobalObject, JSValue, JsError};
use bun_sql::mysql::protocol::any_mysql_error::Error;
use bun_sql::mysql::protocol::error_packet::MySQLErrorOptions;

use super::error_packet_jsc::create_mysql_error;

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
    // `None`: the message of the variant.
    message: impl MaybeBytes,
    err: Error,
) -> JSValue {
    let code: &'static [u8] = match err {
        Error::ConnectionClosed => b"ERR_MYSQL_CONNECTION_CLOSED",
        Error::ConnectionFailed => b"ERR_MYSQL_CONNECTION_FAILED",
        Error::ConnectionRefused => b"ERR_MYSQL_CONNECTION_REFUSED",
        Error::ConnectionTimedOut => b"ERR_MYSQL_CONNECTION_TIMEOUT",
        Error::LifetimeTimeout => b"ERR_MYSQL_LIFETIME_TIMEOUT",
        Error::IdleTimeout => b"ERR_MYSQL_IDLE_TIMEOUT",
        Error::MissingAuthData => b"ERR_MYSQL_MISSING_AUTH_DATA",
        Error::AuthenticationFailed => b"ERR_MYSQL_AUTHENTICATION_FAILED",
        Error::FailedToEncryptPassword => b"ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD",
        Error::InvalidPublicKey => b"ERR_MYSQL_INVALID_PUBLIC_KEY",
        Error::PublicKeyRetrievalNotAllowed => b"ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
        Error::UnsupportedAuthPlugin => b"ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
        Error::UnsupportedProtocolVersion => b"ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION",
        Error::Overflow => b"ERR_MYSQL_OVERFLOW",
        Error::QueryCancelled => b"ERR_MYSQL_QUERY_CANCELLED",
        Error::WrongNumberOfParametersProvided => b"ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        Error::UnsupportedColumnType => b"ERR_MYSQL_UNSUPPORTED_COLUMN_TYPE",
        Error::InvalidAuthSwitchRequest => b"ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST",
        Error::InvalidResultRow => b"ERR_MYSQL_INVALID_RESULT_ROW",
        Error::InvalidBinaryValue => b"ERR_MYSQL_INVALID_BINARY_VALUE",
        Error::InvalidEncodedInteger => b"ERR_MYSQL_INVALID_ENCODED_INTEGER",
        Error::InvalidEncodedLength => b"ERR_MYSQL_INVALID_ENCODED_LENGTH",
        Error::InvalidPrepareOKPacket => b"ERR_MYSQL_INVALID_PREPARE_OK_PACKET",
        Error::InvalidOKPacket => b"ERR_MYSQL_INVALID_OK_PACKET",
        Error::InvalidEOFPacket => b"ERR_MYSQL_INVALID_EOF_PACKET",
        Error::InvalidErrorPacket => b"ERR_MYSQL_INVALID_ERROR_PACKET",
        Error::UnexpectedPacket => b"ERR_MYSQL_UNEXPECTED_PACKET",
        Error::MalformedPacket => b"ERR_MYSQL_MALFORMED_PACKET",
        Error::UnknownError => b"ERR_MYSQL_UNKNOWN_ERROR",
        Error::JSError => {
            return global_object.take_exception(JsError::Thrown);
        }
        Error::OutOfMemory => {
            return global_object.create_out_of_memory_error();
        }
        Error::ShortRead => {
            unreachable!("Assertion failed: ShortRead should be handled by the caller in mysql");
        }
    };

    let default_message;
    let message: &[u8] = match message.as_maybe_bytes() {
        Some(message) => message,
        None => {
            default_message = err.to_string();
            default_message.as_bytes()
        }
    };

    create_mysql_error(
        global_object,
        message,
        &MySQLErrorOptions {
            code,
            errno: None,
            sql_state: None,
        },
    )
    .unwrap_or_else(|ex| global_object.take_exception(ex))
}
