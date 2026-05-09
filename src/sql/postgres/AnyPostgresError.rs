// Variant names intentionally match the Zig error tags 1:1 (including
// SCREAMING_CASE) so that `IntoStaticStr` yields the same string as Zig's
// `@errorName`, which JS `error.code` / snapshot tests depend on.
// NOTE: not `thiserror::Error` — that derive requires a per-variant
// `#[error("...")]` attr (and would conflict with the manual Display below).
// We hand-roll Display via `IntoStaticStr` so the message == the variant name
// (matching Zig `@errorName`), and impl `std::error::Error` manually.
#[allow(non_camel_case_types)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, strum::IntoStaticStr, strum::EnumString)]
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

bun_core::impl_tag_error!(AnyPostgresError);

bun_core::named_error_set!(AnyPostgresError);

// Reverse of the above: `bun_core::Error` is just an interned name; recover the
// matching variant by name (or `JSError` as a catch-all). Needed because the
// protocol `write_internal` helpers were widened to `bun_core::Error` while
// callers (e.g. `PostgresRequest`) still propagate `AnyPostgresError`.
impl From<bun_core::Error> for AnyPostgresError {
    fn from(e: bun_core::Error) -> Self {
        e.name().parse().unwrap_or(AnyPostgresError::JSError)
    }
}

/// Options for creating a PostgresError
// These slices borrow from the parsed wire buffer for the duration of
// `createPostgresError`; the `'a` lifetime ties them to that buffer.
pub struct PostgresErrorOptions<'a> {
    pub code: &'a [u8],
    pub errno: Option<&'a [u8]>,
    pub detail: Option<&'a [u8]>,
    pub hint: Option<&'a [u8]>,
    pub severity: Option<&'a [u8]>,
    pub position: Option<&'a [u8]>,
    pub internal_position: Option<&'a [u8]>,
    pub internal_query: Option<&'a [u8]>,
    pub r#where: Option<&'a [u8]>,
    pub schema: Option<&'a [u8]>,
    pub table: Option<&'a [u8]>,
    pub column: Option<&'a [u8]>,
    pub data_type: Option<&'a [u8]>,
    pub constraint: Option<&'a [u8]>,
    pub file: Option<&'a [u8]>,
    pub line: Option<&'a [u8]>,
    pub routine: Option<&'a [u8]>,
}

impl Default for PostgresErrorOptions<'_> {
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

// ported from: src/sql/postgres/AnyPostgresError.zig
