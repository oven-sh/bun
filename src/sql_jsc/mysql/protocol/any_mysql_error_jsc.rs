use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::mysql::protocol::any_mysql_error::Error;

use super::error_packet_jsc::{create_mysql_error, MySQLErrorOptions};

pub fn mysql_error_to_js(
    global_object: &JSGlobalObject,
    message: Option<&[u8]>,
    err: Error,
) -> JSValue {
    let msg: &[u8] = message.unwrap_or_else(|| <&'static str>::from(err).as_bytes());
    let code: &'static [u8] = match err {
        Error::ConnectionClosed => b"ERR_MYSQL_CONNECTION_CLOSED",
        Error::Overflow => b"ERR_MYSQL_OVERFLOW",
        Error::AuthenticationFailed => b"ERR_MYSQL_AUTHENTICATION_FAILED",
        Error::UnsupportedAuthPlugin => b"ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
        Error::UnsupportedProtocolVersion => b"ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION",
        Error::LocalInfileNotSupported => b"ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
        Error::WrongNumberOfParametersProvided => b"ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        Error::UnsupportedColumnType => b"ERR_MYSQL_UNSUPPORTED_COLUMN_TYPE",
        Error::InvalidLocalInfileRequest => b"ERR_MYSQL_INVALID_LOCAL_INFILE_REQUEST",
        Error::InvalidAuthSwitchRequest => b"ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST",
        Error::InvalidQueryBinding => b"ERR_MYSQL_INVALID_QUERY_BINDING",
        Error::InvalidResultRow => b"ERR_MYSQL_INVALID_RESULT_ROW",
        Error::InvalidBinaryValue => b"ERR_MYSQL_INVALID_BINARY_VALUE",
        Error::InvalidEncodedInteger => b"ERR_MYSQL_INVALID_ENCODED_INTEGER",
        Error::InvalidEncodedLength => b"ERR_MYSQL_INVALID_ENCODED_LENGTH",
        Error::InvalidPrepareOKPacket => b"ERR_MYSQL_INVALID_PREPARE_OK_PACKET",
        Error::InvalidOKPacket => b"ERR_MYSQL_INVALID_OK_PACKET",
        Error::InvalidEOFPacket => b"ERR_MYSQL_INVALID_EOF_PACKET",
        Error::InvalidErrorPacket => b"ERR_MYSQL_INVALID_ERROR_PACKET",
        Error::UnexpectedPacket => b"ERR_MYSQL_UNEXPECTED_PACKET",
        Error::ConnectionTimedOut => b"ERR_MYSQL_CONNECTION_TIMEOUT",
        Error::IdleTimeout => b"ERR_MYSQL_IDLE_TIMEOUT",
        Error::LifetimeTimeout => b"ERR_MYSQL_LIFETIME_TIMEOUT",
        Error::PasswordRequired => b"ERR_MYSQL_PASSWORD_REQUIRED",
        Error::MissingAuthData => b"ERR_MYSQL_MISSING_AUTH_DATA",
        Error::FailedToEncryptPassword => b"ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD",
        Error::InvalidPublicKey => b"ERR_MYSQL_INVALID_PUBLIC_KEY",
        Error::UnknownError => b"ERR_MYSQL_UNKNOWN_ERROR",
        Error::InvalidState => b"ERR_MYSQL_INVALID_STATE",
        Error::JSError => {
            return global_object.take_exception(bun_core::err!("JSError"));
        }
        Error::JSTerminated => {
            return global_object.take_exception(bun_core::err!("JSTerminated"));
        }
        Error::OutOfMemory => {
            return global_object.create_out_of_memory_error();
        }
        Error::ShortRead => {
            unreachable!("Assertion failed: ShortRead should be handled by the caller in mysql");
        }
    };

    create_mysql_error(
        global_object,
        msg,
        // TODO(port): confirm exact options struct name/shape from error_packet_jsc.rs
        MySQLErrorOptions {
            code,
            errno: None,
            sql_state: None,
        },
    )
    .unwrap_or_else(|ex| global_object.take_exception(ex.into()))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/protocol/any_mysql_error_jsc.zig (60 lines)
//   confidence: medium
//   todos:      1
//   notes:      Error enum variants & MySQLErrorOptions shape depend on sibling ports; take_exception arg type may need adjusting
// ──────────────────────────────────────────────────────────────────────────
