use bun_ast::{Loc, Log, Range, Source};

pub type Result<T, E = Error> = core::result::Result<T, E>;

/// A mistake in the schema, or in a schema that it imports.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct Error {
    pub message: String,
    pub start: usize,
    pub len: usize,
    /// The path and the text that `start` is an offset in, unless it is the schema that was compiled.
    pub imported_file: Option<(Vec<u8>, Vec<u8>)>,
}

impl Error {
    pub(crate) fn add_to(&self, log: &mut Log, path: &[u8], text: &[u8]) {
        let source = match &self.imported_file {
            Some((path, text)) => Source::init_path_string(path, text),
            None => Source::init_path_string(path, text),
        };
        let range = match (i32::try_from(self.start), i32::try_from(self.len)) {
            (Ok(start), Ok(len)) => Range {
                loc: Loc { start },
                len,
            },
            _ => Range::default(),
        };
        log.add_range_error_fmt(Some(&source), range, format_args!("{}", self.message));
    }
}
