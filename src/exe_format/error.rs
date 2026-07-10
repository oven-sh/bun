#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(std::io::Error),
    #[error(transparent)]
    Macho(#[from] crate::macho::MachoError),
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Io(_) => "Io",
            Self::Macho(e) => <&'static str>::from(e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
