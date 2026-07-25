#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidQueryBinding")]
    InvalidQueryBinding,
    #[error("BufferTooSmall")]
    BufferTooSmall,
    #[error("InvalidEscapeSequence")]
    InvalidEscapeSequence,
    #[error("UnknownEscapeSequence")]
    UnknownEscapeSequence,
    #[error("InvalidBuffer")]
    InvalidBuffer,
    #[error("InvalidSign")]
    InvalidSign,
    #[error("PBKDFD2")]
    PBKDFD2,
    #[error("InvalidServerKey")]
    InvalidServerKey,
    #[error("InvalidServerSignature")]
    InvalidServerSignature,
    #[error("UnsupportedArrayType")]
    UnsupportedArrayType,
    #[error("JSError")]
    JSError,
    #[error("AuthenticationFailed")]
    AuthenticationFailed,
    #[error("InvalidBinaryValue")]
    InvalidBinaryValue,
    #[error("Terminated")]
    Terminated,
    #[error("Thrown")]
    Thrown,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Postgres(#[from] bun_sql::postgres::AnyPostgresError),
    #[error(transparent)]
    MySqlProtocol(#[from] bun_sql::mysql::protocol::Error),
    #[error(transparent)]
    Sql(#[from] bun_sql::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidQueryBinding => "InvalidQueryBinding",
            Self::BufferTooSmall => "BufferTooSmall",
            Self::InvalidEscapeSequence => "InvalidEscapeSequence",
            Self::UnknownEscapeSequence => "UnknownEscapeSequence",
            Self::InvalidBuffer => "InvalidBuffer",
            Self::InvalidSign => "InvalidSign",
            Self::PBKDFD2 => "PBKDFD2",
            Self::InvalidServerKey => "InvalidServerKey",
            Self::InvalidServerSignature => "InvalidServerSignature",
            Self::UnsupportedArrayType => "UnsupportedArrayType",
            Self::JSError => "JSError",
            Self::AuthenticationFailed => "AuthenticationFailed",
            Self::InvalidBinaryValue => "InvalidBinaryValue",
            Self::Terminated => "Terminated",
            Self::Thrown => "Thrown",
            Self::Alloc(_) => "OutOfMemory",
            Self::Postgres(e) => <&'static str>::from(e),
            Self::MySqlProtocol(e) => <&'static str>::from(e),
            Self::Sql(e) => e.name(),
        }
    }
}

/// Crate-local mirror of `bun_jsc::JSGlobalObject::throw_error` that accepts
/// this crate's [`Error`] instead of `bun_jsc::CrateError`.
pub trait ThrowSqlError {
    fn throw_sql_error(&self, err: Error, fmt: &'static str) -> bun_jsc::JsError;
}

impl ThrowSqlError for bun_jsc::JSGlobalObject {
    fn throw_sql_error(&self, err: Error, fmt: &'static str) -> bun_jsc::JsError {
        use bun_jsc::StringJsc;
        if matches!(err, Error::Alloc(_)) {
            return self.throw_out_of_memory();
        }
        debug_assert!(err != Error::JSError);
        let msg = format!("{} {}", err.name(), fmt);
        let instance = bun_core::String::borrow_utf8(msg.as_bytes()).to_error_instance(self);
        self.throw_value(instance)
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
