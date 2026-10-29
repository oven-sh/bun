#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("ConnectionClosed")]
    ConnectionClosed,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::InvalidOptions => "InvalidOptions",
            Self::ConnectionClosed => "ConnectionClosed",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
