//! The formatter: prints the syntax of a file the way Prettier does.
//!
//! See `CLAUDE.md` in this directory.
//!
//! The intermediate representation and the printer (`ir/`) come from [Biome](https://github.com/biomejs/biome) by way
//! of `oxc_formatter_core`, and the rules for JavaScript and TypeScript (`js/`) are a port of
//! [`oxc_formatter`](https://github.com/oxc-project/oxc/tree/main/crates/oxc_formatter) to `bun check`'s syntax tree.
//! Both are under the MIT license. Both implement [Prettier](https://github.com/prettier/prettier), also under the MIT
//! license, which is the specification wherever they differ from it.

#![forbid(unsafe_code)]
// For code that only `--debug-check` runs: `#[optimize(size)]` roughly halves its size, and its speed doesn't matter.
#![feature(optimize_attribute)]

pub mod css;
pub mod cursor;
mod front_matter;
pub mod graphql;
pub mod handlebars;
pub mod html;
mod ir;
mod js;
pub mod json;
pub mod markdown;
pub mod options;
pub mod pragma;
pub mod range;
pub mod sort;
mod stack;
pub mod svelte;
pub mod syntax_error;
pub mod tailwind;
mod text;
pub mod toml;
pub mod verify;
pub mod yaml;

/// Helpers for callers that handle Flow files.
pub mod flow {
    pub use crate::js::print::flow::{
        is_parsed_by_babel_flow, may_have_comment_types, uncommented,
    };
}

/// Import sorting.
pub mod sort_imports {
    pub use crate::js::sort_imports::{Settings, SortImports, sorted_text};
}

pub use ir::run::Scratch;
pub use options::FormatOptions;

// Not in the prelude: a glob import can't shadow the `std` macros with the same names.
pub(crate) use crate::ir::macros::{best_fitting, format_args, write};

/// Imports that nearly every file in this crate needs.
pub(crate) mod prelude {
    pub(crate) use crate::ir::prelude::*;
    pub(crate) use crate::js::prelude::*;
    pub(crate) use crate::options::*;
    pub(crate) use bun_lint::ast::*;
    pub(crate) use bun_lint::span::{Span, Spanned};
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum FormatError {
    /// The file has syntax errors and is left as is. The caller already has the errors from the script parser.
    SyntaxError,
    /// The same, from one of this crate's parsers.
    SyntaxErrorAt(syntax_error::SyntaxError),
    /// The syntax is nested so deeply that formatting it would overflow the stack. The file is left as is.
    NestedTooDeeply,
    /// The formatted text is [longer than a string can be](is_too_long). The file is left as is.
    TooLong,
    /// A bug in the formatter: the document it wrote is malformed.
    InvalidDocument,
}

/// True if a text of `len` bytes is longer than a JavaScript string can be, which is where Prettier fails with
/// `RangeError: Invalid string length`. Something nested `n` deep is indented by `n * n` spaces.
#[inline]
pub(crate) fn is_too_long(len: usize) -> bool {
    len as u64 > bun_lint::fix::MAX_STRING_LENGTH
}

impl FormatError {
    /// See [`syntax_error::SyntaxError::before_normalizing_end_of_line`].
    #[cold]
    pub(crate) fn before_normalizing_end_of_line(self, original: &[u8]) -> FormatError {
        match self {
            FormatError::SyntaxErrorAt(error) => {
                FormatError::SyntaxErrorAt(error.before_normalizing_end_of_line(original))
            }
            other => other,
        }
    }
}
