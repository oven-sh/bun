#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Already logged by `Source::check_parseable_len`.
    SourceTooLarge,
    Alloc(bun_alloc::AllocError),
}

impl From<bun_ast::SourceTooLarge> for Error {
    fn from(_: bun_ast::SourceTooLarge) -> Self {
        Error::SourceTooLarge
    }
}

impl From<bun_alloc::AllocError> for Error {
    fn from(err: bun_alloc::AllocError) -> Self {
        Error::Alloc(err)
    }
}
