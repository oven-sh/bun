#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unexpected")]
    Unexpected,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unexpected => "Unexpected",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
