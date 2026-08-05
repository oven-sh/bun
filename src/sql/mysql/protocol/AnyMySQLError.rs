// NOTE: not `thiserror::Error` — that derive requires a per-variant `#[error("...")]`
// attr. We hand-roll Display via `IntoStaticStr` so the message == the variant name,
// and impl `std::error::Error` manually below.
#[derive(strum::IntoStaticStr, strum::EnumString, Debug, Copy, Clone, Eq, PartialEq)]
pub enum Error {
    ConnectionClosed,
    ConnectionFailed,
    ConnectionRefused,
    ConnectionTimedOut,
    LifetimeTimeout,
    IdleTimeout,
    PasswordRequired,
    MissingAuthData,
    AuthenticationFailed,
    FailedToEncryptPassword,
    InvalidPublicKey,
    PublicKeyRetrievalNotAllowed,
    UnsupportedAuthPlugin,
    UnsupportedProtocolVersion,

    LocalInfileNotSupported,
    JSError,
    JSTerminated,
    OutOfMemory,
    Overflow,

    WrongNumberOfParametersProvided,
    TooManyParameters,

    UnsupportedColumnType,

    InvalidLocalInfileRequest,
    InvalidAuthSwitchRequest,
    InvalidQueryBinding,
    InvalidResultRow,
    InvalidBinaryValue,
    InvalidEncodedInteger,
    InvalidEncodedLength,

    InvalidPrepareOKPacket,
    InvalidOKPacket,
    InvalidEOFPacket,
    InvalidErrorPacket,
    UnexpectedPacket,
    PacketsOutOfOrder,
    ShortRead,
    UnknownError,
    InvalidState,
}

bun_core::impl_tag_error!(Error);

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
