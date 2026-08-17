#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("ConnectionClosed")]
    ConnectionClosed,
    #[error("DeflateInitFailed")]
    DeflateInitFailed,
    #[error("InflateInitFailed")]
    InflateInitFailed,
    /// Script entered along the way (a socket / TLS callback) left a JS exception: propagate it.
    #[error("JSError")]
    Js(bun_jsc::JsError),
}

impl From<bun_jsc::JsError> for Error {
    fn from(e: bun_jsc::JsError) -> Self {
        Self::Js(e)
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::InvalidOptions => "InvalidOptions",
            Self::ConnectionClosed => "ConnectionClosed",
            Self::DeflateInitFailed => "DeflateInitFailed",
            Self::InflateInitFailed => "InflateInitFailed",
            Self::Js(_) => "JSError",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
