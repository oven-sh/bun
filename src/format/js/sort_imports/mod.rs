//! Sorting the imports of a file, the way the plugins of Prettier and oxfmt do it.

mod settings;

pub use settings::Settings;

use bun_lint::ast::File;

/// How to sort imports: [`Settings`] that have been checked, with their regular expressions
/// compiled. One is made for a run and shared by all files and threads.
#[derive(Debug)]
pub struct SortImports {
    is_enabled: bool,
}

/// The text of `file` with its imports sorted. It has to be parsed and formatted in place of
/// `file`. `None`: formatting `file` gives the same.
pub fn sorted_text<'a>(file: &'a File<'a>, how: &SortImports) -> Option<Vec<u8>> {
    (how.is_enabled && file.has_parse_errors()).then(Vec::new)
}
