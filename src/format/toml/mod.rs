//! TOML, the way oxfmt formats it. Prettier has no TOML.
//!
//! oxfmt does it with the crate [`oxc-toml`](https://crates.io/crates/oxc-toml) (MIT license, Ferenc
//! Tamás, VoidZero Inc. and contributors), a fork of taplo, whose formatter `printer.rs` is a port of,
//! as far as oxfmt's options reach. Keys and values are written as they are in the text. What changes
//! is white space, empty lines, and whether an array is on one line.
//!
//! ```text
//! text ─ Bun's scanner of TOML ─→ tokens ─ tree::build ─→ taplo's tree ─ printer::print ─→ text
//! ```
//!
//! What Bun does not read as TOML is a syntax error. oxfmt writes such a text again around its errors,
//! and not always in the same order.

mod printer;
mod tree;

use crate::text::BOM;
use crate::{FormatError, FormatOptions};
use bun_parsers::toml::TOML;

/// Why [`format`] takes `text` for something else than TOML, in the words of Bun's parser, and at which byte, not counting
/// a byte order mark. The text is read once more for it.
#[cold]
pub fn syntax_error(text: &[u8]) -> Option<(Vec<u8>, u32)> {
    let (message, offset) = TOML::tokens(text).err()?;
    let bom = match text.starts_with(BOM) {
        true => BOM.len(),
        false => 0,
    };
    Some((message, offset.saturating_sub(bom) as u32))
}

/// Appends the formatted `text` to `out`.
pub fn format(text: &[u8], options: &FormatOptions, out: &mut Vec<u8>) -> Result<(), FormatError> {
    // Of a text that is nothing but white space, oxfmt makes nothing.
    if (text.iter()).all(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r')) {
        return Ok(());
    }
    let tokens = TOML::tokens(text).map_err(|_| FormatError::SyntaxError)?;
    let elements = tree::build(text, &tokens)?;
    if text.starts_with(BOM) {
        out.extend_from_slice(BOM);
    }
    printer::print(text, &elements, options, out);
    Ok(())
}
