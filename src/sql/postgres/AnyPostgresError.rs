// Variant names (including SCREAMING_CASE) are exactly the strings that
// `IntoStaticStr` yields, which JS `error.code` / snapshot tests depend on —
// do not rename them.
// NOTE: not `thiserror::Error` — that derive requires a per-variant
// `#[error("...")]` attr (and would conflict with the manual Display below).
// We hand-roll Display via `IntoStaticStr` so the message == the variant name,
// and impl `std::error::Error` manually.
#[allow(non_camel_case_types)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, strum::IntoStaticStr, strum::EnumString)]
pub enum AnyPostgresError {
    ConnectionClosed,
    ConnectionFailed,
    ConnectionRefused,
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
    QueryCancelled,
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

// Reverse of the above: `crate::Error` is just an interned name; recover the
// matching variant by name (or `JSError` as a catch-all). Needed because the
// protocol `write_internal` helpers were widened to `crate::Error` while
// callers (e.g. `PostgresRequest`) still propagate `AnyPostgresError`.
impl From<crate::Error> for AnyPostgresError {
    fn from(e: crate::Error) -> Self {
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

// `createPostgresError` / `postgresErrorToJS` live as extension-trait methods
// in the `bun_sql_jsc` crate; the base crate has no mention of jsc.
