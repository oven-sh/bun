/// `Display` is the default `message` of the JS `MySQLError`.
#[derive(
    thiserror::Error, strum::IntoStaticStr, strum::EnumString, Debug, Copy, Clone, Eq, PartialEq,
)]
pub enum Error {
    #[error("Connection closed")]
    ConnectionClosed,
    #[error("Failed to connect")]
    ConnectionFailed,
    #[error("Connection refused")]
    ConnectionRefused,
    #[error("Connection timed out")]
    ConnectionTimedOut,
    #[error("Connection closed after exceeding its maximum lifetime")]
    LifetimeTimeout,
    #[error("Connection closed due to idle timeout")]
    IdleTimeout,
    #[error("Server did not send authentication data during the handshake")]
    MissingAuthData,
    #[error("Authentication failed")]
    AuthenticationFailed,
    #[error("Failed to encrypt password with the server's RSA public key")]
    FailedToEncryptPassword,
    #[error("Server sent an invalid RSA public key")]
    InvalidPublicKey,
    #[error(
        "The server requested RSA public key retrieval to complete authentication, which is not allowed over an insecure connection. Enable TLS or set allowPublicKeyRetrieval: true"
    )]
    PublicKeyRetrievalNotAllowed,
    #[error("Server requested an unsupported authentication plugin")]
    UnsupportedAuthPlugin,
    #[error("Server is using an unsupported protocol version")]
    UnsupportedProtocolVersion,

    #[error("JavaScript exception")]
    JSError,
    #[error("Out of memory")]
    OutOfMemory,
    #[error("Packet exceeds the maximum payload length")]
    Overflow,

    #[error("Query cancelled")]
    QueryCancelled,
    #[error("Wrong number of parameters provided")]
    WrongNumberOfParametersProvided,

    #[error("Unsupported column type")]
    UnsupportedColumnType,

    #[error("Invalid AuthSwitchRequest packet received from the server")]
    InvalidAuthSwitchRequest,
    #[error("Invalid result row received from the server")]
    InvalidResultRow,
    #[error("Invalid binary value received from the server")]
    InvalidBinaryValue,
    #[error("Invalid length-encoded integer received from the server")]
    InvalidEncodedInteger,
    #[error("Invalid length-encoded value received from the server")]
    InvalidEncodedLength,

    #[error("Invalid prepared statement OK packet received from the server")]
    InvalidPrepareOKPacket,
    #[error("Invalid OK packet received from the server")]
    InvalidOKPacket,
    #[error("Invalid EOF packet received from the server")]
    InvalidEOFPacket,
    #[error("Invalid error packet received from the server")]
    InvalidErrorPacket,
    #[error("Unexpected packet received from the server")]
    UnexpectedPacket,
    #[error("Malformed packet from the server")]
    MalformedPacket,
    #[error("Short read")]
    ShortRead,
    #[error("Unknown error")]
    UnknownError,
}

/// The Rust enum is `Error` per convention; re-export the `AnyMySQLError`
/// spelling as well so cross-crate `use` lines
/// (`bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError`) resolve.
pub type AnyMySQLError = Error;

// Reverse of the above: `crate::Error` is just an interned name; recover the
// matching variant by name (or `UnknownError` as a catch-all). Needed because
// helpers like `decode_binary_value` were widened to `crate::Error` while
// callers (e.g. `ResultSet::Row::decode_binary`) still propagate `AnyMySQLError`.
impl From<crate::Error> for Error {
    fn from(e: crate::Error) -> Self {
        e.name().parse().unwrap_or(Error::UnknownError)
    }
}

// NOTE: `mysql_error_to_js` lives in
// `bun_sql_jsc::mysql::protocol::any_mysql_error_jsc` as an extension fn.
