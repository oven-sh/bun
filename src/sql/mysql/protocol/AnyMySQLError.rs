// NOTE: not `thiserror::Error` — that derive requires a per-variant `#[error("...")]`
// attr. We hand-roll Display via `IntoStaticStr` so the message == the variant name
// (matching Zig `@errorName`), and impl `std::error::Error` manually below.
#[derive(strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum Error {
    ConnectionClosed,
    ConnectionTimedOut,
    LifetimeTimeout,
    IdleTimeout,
    PasswordRequired,
    MissingAuthData,
    AuthenticationFailed,
    FailedToEncryptPassword,
    InvalidPublicKey,
    UnsupportedAuthPlugin,
    UnsupportedProtocolVersion,

    LocalInfileNotSupported,
    JSError,
    JSTerminated,
    OutOfMemory,
    Overflow,

    WrongNumberOfParametersProvided,

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
    ShortRead,
    UnknownError,
    InvalidState,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
}

impl std::error::Error for Error {}

/// Zig callers name this `AnyMySQLError` (the file basename); the Rust enum is
/// `Error` per convention. Re-export both spellings so cross-crate `use` lines
/// (`bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError`) resolve.
pub type AnyMySQLError = Error;

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// NOTE: `pub const mysqlErrorToJS = @import("../../../sql_jsc/...").mysqlErrorToJS;`
// is a *_jsc alias — deleted per PORTING.md. `mysql_error_to_js` lives in
// `bun_sql_jsc::mysql::protocol::any_mysql_error_jsc` as an extension fn.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/AnyMySQLError.zig (42 lines)
//   confidence: high
//   todos:      0
//   notes:      error set → thiserror+IntoStaticStr enum; *_jsc alias dropped
// ──────────────────────────────────────────────────────────────────────────
