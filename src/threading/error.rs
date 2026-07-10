#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Timeout")]
    Timeout,
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Timeout => "Timeout",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
