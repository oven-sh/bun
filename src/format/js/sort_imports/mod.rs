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
mod organize;
mod oxfmt;
mod settings;
mod sort;
mod trivago;

pub(crate) use oxfmt::ImportRun;
pub use settings::Settings;

use bun_lint::ast::File;

#[derive(Debug)]
enum How {
    Trivago(trivago::Options),
    Ianvs(ianvs::Options),
    Oxfmt(oxfmt::Options),
    Organize(organize::Options),
}

/// How to sort imports: [`Settings`] that have been checked, with their regular expressions
/// compiled. One is made for a run and shared by all files and threads.
#[derive(Debug)]
pub struct SortImports {
    how: How,
}

impl SortImports {
    /// Whether it is `format` that sorts the imports, and not [`sorted_text`]: then what it writes
    /// has the tokens of the file in another order.
    pub fn is_applied_by_format(&self) -> bool {
        matches!(self.how, How::Oxfmt(_))
    }

    /// Whether [`sorted_text`] asks which imports are used: the file has to be bound with its
    /// symbols and scopes. Without them, all imports count as used.
    pub fn needs_symbols(&self) -> bool {
        matches!(&self.how, How::Organize(options) if !options.skips_destructive_code_actions)
    }

    /// Whether the imports of code in a file of another language are sorted. `prettier-plugin-organize-imports` asks
    /// TypeScript about the file at `filepath`, which is not the code, and gets no changes.
    pub fn applies_to_embedded_code(&self) -> bool {
        !matches!(self.how, How::Organize(_))
    }
}

/// The text of `file` with its imports sorted. It has to be parsed and formatted in place of
/// `file`. `None`: formatting `file` gives the same.
pub fn sorted_text<'a>(file: &'a File<'a>, how: &SortImports) -> Option<Vec<u8>> {
    if file.has_parse_errors() || matches!(how.how, How::Oxfmt(_)) {
        return None;
    }
    // Prettier's `guessEndOfLine`
    let text = file.text();
    let end_of_line: &[u8] = match bun_core::strings::index_of_char_usize(text, b'\n') {
        Some(at) if at > 0 && text[at - 1] == b'\r' => b"\r\n",
        _ => b"\n",
    };
    if let How::Organize(options) = &how.how {
        return organize::preprocess(file, options, end_of_line);
    }
    let mut model = babel::Model::new(file)?;
    match &how.how {
        How::Trivago(options) => trivago::preprocess(&mut model, options, end_of_line),
        How::Ianvs(options) => ianvs::preprocess(&mut model, options, end_of_line),
        How::Oxfmt(_) | How::Organize(_) => None,
    }
}
