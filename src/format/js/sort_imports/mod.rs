//! Sorts a file's imports the way Prettier's plugins and oxfmt do.
//!
//! Prettier's plugins are preprocessors: they turn a file's text into another text, which Prettier then parses and
//! formats. [`sorted_text`] returns that text. It matches the plugin's output byte for byte, so the formatter handles
//! it exactly as Prettier would, including comments in odd places. Most files already have sorted imports, which
//! `layout.rs` detects without parsing anything again.

mod babel;
mod compare;
mod generator;
mod ianvs;
mod layout;
mod native;
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
    /// `sortImports` from bunfig.toml or `--sort-imports`. Runs oxfmt's sorter plus `native.rs`.
    Native(oxfmt::Options),
    Organize(organize::Options),
}

/// How to sort imports: validated [`Settings`] with their regular expressions compiled. One is built per run and shared
/// by all files and threads.
#[derive(Debug)]
pub struct SortImports {
    how: How,
}

impl SortImports {
    /// True if `format` sorts the imports instead of [`sorted_text`]. Its output then has the file's tokens in a
    /// different order.
    pub fn is_applied_by_format(&self) -> bool {
        matches!(self.how, How::Oxfmt(_) | How::Native(_))
    }

    /// Checks that `after`, the parsed output of [`sorted_text`], still imports what `before` does. Always true for the
    /// Prettier plugins, which may remove imports on purpose.
    pub fn keeps_imports<'a, 'b>(&self, before: &'a File<'a>, after: &'b File<'b>) -> bool {
        !matches!(self.how, How::Native(_)) || native::keeps_imports(before, after)
    }

    /// True if [`sorted_text`] needs to know which imports are used, so the file has to be bound with its symbols and
    /// scopes. Without them, all imports count as used.
    pub fn needs_symbols(&self) -> bool {
        matches!(&self.how, How::Organize(options) if !options.skips_destructive_code_actions)
    }

    /// True if imports are sorted in code embedded in a file of another language. `prettier-plugin-organize-imports`
    /// asks TypeScript about the file at `filepath`, which isn't the embedded code, and gets no changes.
    pub fn applies_to_embedded_code(&self) -> bool {
        !matches!(self.how, How::Organize(_))
    }
}

/// `file`'s text with its imports sorted. It has to be parsed and formatted in place of `file`. Returns `None` if
/// formatting `file` gives the same result.
pub fn sorted_text<'a>(file: &'a File<'a>, how: &SortImports) -> Option<Vec<u8>> {
    if file.has_parse_errors() || matches!(how.how, How::Oxfmt(_)) {
        return None;
    }
    if matches!(how.how, How::Native(_)) {
        return native::preprocess(file);
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
        How::Oxfmt(_) | How::Native(_) | How::Organize(_) => None,
    }
}
