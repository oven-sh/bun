#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("SourceTooLarge")]
    SourceTooLarge,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

/// Already logged by `Source::check_parseable_len`.
impl From<bun_ast::SourceTooLarge> for Error {
    fn from(_: bun_ast::SourceTooLarge) -> Self {
        Error::SourceTooLarge
    }
}
