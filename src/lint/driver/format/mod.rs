//! Prints the results.

mod json;
mod stylish;
mod unix;

use crate::results::FileResult;

/// `--format`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Format {
    Stylish,
    Json,
    JsonWithMetadata,
    Unix,
}

impl Format {
    pub(crate) fn by_name(name: &[u8]) -> Option<Format> {
        Some(match name {
            b"stylish" => Format::Stylish,
            b"json" => Format::Json,
            b"json-with-metadata" => Format::JsonWithMetadata,
            b"unix" => Format::Unix,
            _ => return None,
        })
    }

    /// Whether it reads [`FileResult::text`].
    pub(crate) fn reads_text(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata)
    }
}

/// ESLint's `ResultsMeta`, and what else a format wants to know.
pub(crate) struct Meta<'m> {
    pub(crate) cwd: &'m [u8],
    pub(crate) color: bool,
    /// `--color`, `--no-color`
    pub(crate) color_option: Option<bool>,
    /// `maxWarnings` and `foundWarnings`, if there are too many.
    pub(crate) max_warnings_exceeded: Option<(i64, usize)>,
}

/// What ESLint's formatter of that name returns for `results`, which are sorted by path.
pub(crate) fn format(format: Format, results: &[FileResult], meta: &Meta) -> Vec<u8> {
    let mut out = Vec::new();
    match format {
        Format::Stylish => stylish::write(&mut out, results, meta.color),
        Format::Json => json::write_results(&mut out, results),
        Format::JsonWithMetadata => json::write_with_metadata(&mut out, results, meta),
        Format::Unix => unix::write(&mut out, results),
    }
    out
}
