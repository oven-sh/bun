#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unexpected")]
    Unexpected,
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unexpected => "Unexpected",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
