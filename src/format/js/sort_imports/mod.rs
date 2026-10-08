//! Sorting the imports of a file, the way the plugins of Prettier and oxfmt do it.
//!
//! The plugins of Prettier are preprocessors: they turn the text of a file into another text,
//! which Prettier then parses and formats. [`sorted_text`] is that text. It is byte for byte what
//! the plugin makes, so that whatever Prettier makes of it, comments in odd places included, the
//! formatter makes of it too. Most files have their imports sorted already: that is found out
//! without parsing anything again (`layout.rs`).

mod babel;
mod builtins;
mod collation_tables;
mod compare;
mod generator;
mod ianvs;
mod layout;
mod oxfmt;
mod settings;
mod sort;
mod trivago;

pub use settings::Settings;

use bun_lint::ast::File;

#[derive(Debug)]
enum How {
    Trivago(trivago::Options),
    Ianvs(ianvs::Options),
    Oxfmt(oxfmt::Options),
}

/// How to sort imports: [`Settings`] that have been checked, with their regular expressions
/// compiled. One is made for a run and shared by all files and threads.
#[derive(Debug)]
pub struct SortImports {
    how: How,
}

/// The text of `file` with its imports sorted. It has to be parsed and formatted in place of
/// `file`. `None`: formatting `file` gives the same.
pub fn sorted_text<'a>(file: &'a File<'a>, how: &SortImports) -> Option<Vec<u8>> {
    if file.has_parse_errors() || matches!(how.how, How::Oxfmt(_)) {
        return None;
    }
    let mut model = babel::Model::new(file)?;
    // Prettier's `guessEndOfLine`
    let text = file.text();
    let end_of_line: &[u8] = match bun_core::strings::index_of_char_usize(text, b'\n') {
        Some(at) if at > 0 && text[at - 1] == b'\r' => b"\r\n",
        _ => b"\n",
    };
    match &how.how {
        How::Trivago(options) => trivago::preprocess(&mut model, options, end_of_line),
        How::Ianvs(options) => ianvs::preprocess(&mut model, options, end_of_line),
        How::Oxfmt(_) => None,
    }
}
