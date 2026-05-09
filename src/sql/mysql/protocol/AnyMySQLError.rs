// NOTE: not `thiserror::Error` — that derive requires a per-variant `#[error("...")]`
// attr. We hand-roll Display via `IntoStaticStr` so the message == the variant name
// (matching Zig `@errorName`), and impl `std::error::Error` manually below.
#[derive(strum::IntoStaticStr, strum::EnumString, Debug, Copy, Clone, Eq, PartialEq)]
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

bun_core::impl_tag_error!(Error);

/// Zig callers name this `AnyMySQLError` (the file basename); the Rust enum is
/// `Error` per convention. Re-export both spellings so cross-crate `use` lines
/// (`bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError`) resolve.
pub type AnyMySQLError = Error;

bun_core::named_error_set!(Error);

// Reverse of the above: `bun_core::Error` is just an interned name; recover the
// matching variant by name (or `UnknownError` as a catch-all). Needed because
// helpers like `decode_binary_value` were widened to `bun_core::Error` while
// callers (e.g. `ResultSet::Row::decode_binary`) still propagate `AnyMySQLError`.
impl From<bun_core::Error> for Error {
    fn from(e: bun_core::Error) -> Self {
        e.name().parse().unwrap_or(Error::UnknownError)
    }
}

// NOTE: `pub const mysqlErrorToJS = @import("../../../sql_jsc/...").mysqlErrorToJS;`
// is a *_jsc alias — deleted per PORTING.md. `mysql_error_to_js` lives in
// `bun_sql_jsc::mysql::protocol::any_mysql_error_jsc` as an extension fn.

// ported from: src/sql/mysql/protocol/AnyMySQLError.zig
