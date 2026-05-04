// Variant names intentionally match the Zig error tags 1:1 (including
// SCREAMING_CASE) so that `IntoStaticStr` yields the same string as Zig's
// `@errorName`, which JS `error.code` / snapshot tests depend on.
// NOTE: not `thiserror::Error` — that derive requires a per-variant
// `#[error("...")]` attr (and would conflict with the manual Display below).
// We hand-roll Display via `IntoStaticStr` so the message == the variant name
// (matching Zig `@errorName`), and impl `std::error::Error` manually.
#[allow(non_camel_case_types)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum AnyPostgresError {
    ConnectionClosed,
    ExpectedRequest,
    ExpectedStatement,
    InvalidBackendKeyData,
    InvalidBinaryData,
    InvalidByteSequence,
    InvalidByteSequenceForEncoding,
    InvalidCharacter,
    InvalidMessage,
    InvalidMessageLength,
    InvalidQueryBinding,
    InvalidServerKey,
    InvalidServerSignature,
    InvalidTimeFormat,
    JSError,
    JSTerminated,
    MultidimensionalArrayNotSupportedYet,
    NullsInArrayNotSupportedYet,
    OutOfMemory,
    Overflow,
    PBKDFD2,
    SASL_SIGNATURE_MISMATCH,
    SASL_SIGNATURE_INVALID_BASE64,
    ShortRead,
    TLSNotAvailable,
    TLSUpgradeFailed,
    TooManyParameters,
    UnexpectedMessage,
    UNKNOWN_AUTHENTICATION_METHOD,
    UNSUPPORTED_AUTHENTICATION_METHOD,
    UnsupportedByteaFormat,
    UnsupportedIntegerSize,
    UnsupportedArrayFormat,
    UnsupportedNumericFormat,
    UnknownFormatCode,
}

impl core::fmt::Display for AnyPostgresError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
}

impl std::error::Error for AnyPostgresError {}

impl From<AnyPostgresError> for bun_core::Error {
    fn from(e: AnyPostgresError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Options for creating a PostgresError
// TODO(port): lifetime — these slices borrow from the parsed wire buffer for
// the duration of `createPostgresError`; Phase A forbids struct lifetime
// params, so `&'static [u8]` is a placeholder. Phase B should make this
// `PostgresErrorOptions<'a>` with `&'a [u8]`.
pub struct PostgresErrorOptions {
    pub code: &'static [u8],
    pub errno: Option<&'static [u8]>,
    pub detail: Option<&'static [u8]>,
    pub hint: Option<&'static [u8]>,
    pub severity: Option<&'static [u8]>,
    pub position: Option<&'static [u8]>,
    pub internal_position: Option<&'static [u8]>,
    pub internal_query: Option<&'static [u8]>,
    pub r#where: Option<&'static [u8]>,
    pub schema: Option<&'static [u8]>,
    pub table: Option<&'static [u8]>,
    pub column: Option<&'static [u8]>,
    pub data_type: Option<&'static [u8]>,
    pub constraint: Option<&'static [u8]>,
    pub file: Option<&'static [u8]>,
    pub line: Option<&'static [u8]>,
    pub routine: Option<&'static [u8]>,
}

impl Default for PostgresErrorOptions {
    fn default() -> Self {
        Self {
            code: b"",
            errno: None,
            detail: None,
            hint: None,
            severity: None,
            position: None,
            internal_position: None,
            internal_query: None,
            r#where: None,
            schema: None,
            table: None,
            column: None,
            data_type: None,
            constraint: None,
            file: None,
            line: None,
            routine: None,
        }
    }
}

// Zig re-exported `createPostgresError` / `postgresErrorToJS` from
// `src/sql_jsc/postgres/error_jsc.zig` here. Per PORTING.md, `*_jsc` alias
// re-exports are deleted: in Rust those live as extension-trait methods in
// the `bun_sql_jsc` crate and the base crate has no mention of jsc.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/AnyPostgresError.zig (62 lines)
//   confidence: medium
//   todos:      1
//   notes:      PostgresErrorOptions slice fields use &'static placeholder; Phase B should add <'a> lifetime (borrows wire buffer)
// ──────────────────────────────────────────────────────────────────────────
