#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Fail")]
    Fail,
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Fail => "Fail",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
