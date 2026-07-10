#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("KQueueError")]
    KQueueError,
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::KQueueError => "KQueueError",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
