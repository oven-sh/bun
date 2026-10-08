//! Handlebars, as Glimmer reads it: Prettier's `language-handlebars`.

use crate::{FormatError, FormatOptions};

/// Whether Prettier takes the file at `path` for Handlebars.
pub fn is_handlebars_path(path: &[u8]) -> bool {
    path.ends_with(b".hbs") || path.ends_with(b".handlebars")
}

/// What can be used again for the next file.
#[derive(Default)]
pub struct Scratch {}

/// Appends the formatted `text` to `out`.
pub fn format(_text: &[u8], _options: &FormatOptions, _scratch: &mut Scratch, _out: &mut Vec<u8>) -> Result<(), FormatError> {
    Err(FormatError::SyntaxError)
}
