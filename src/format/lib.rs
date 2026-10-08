//! The formatter: prints the syntax of a file the way Prettier does.
//!
//! See `CLAUDE.md` in this directory.
//!
//! The intermediate representation and the printer (`ir/`) come from
//! [Biome](https://github.com/biomejs/biome) by way of `oxc_formatter_core`, and the rules for
//! JavaScript and TypeScript (`js/`) are a port of
//! [`oxc_formatter`](https://github.com/oxc-project/oxc/tree/main/crates/oxc_formatter) to the
//! syntax tree of `bun check`. Both are under the MIT license. What they implement is
//! [Prettier](https://github.com/prettier/prettier), also under the MIT license, which is the
//! specification wherever they differ from it.

pub mod css;
pub mod cursor;
pub mod graphql;
pub mod handlebars;
mod ir;
mod js;
pub mod json;
pub mod markdown;
pub mod options;
pub mod pragma;
pub mod range;
pub mod verify;
pub mod yaml;

/// Sorting imports.
pub mod sort_imports {
    pub use crate::js::sort_imports::{Settings, SortImports, sorted_text};
}

pub use ir::run::{Scratch, dump_document, format};
pub use options::FormatOptions;

// Not in the prelude: a glob import cannot shadow the macros of the same names in `std`.
pub(crate) use crate::ir::macros::{best_fitting, format_args, write};

/// What nearly every file of this crate needs.
pub(crate) mod prelude {
    pub(crate) use crate::ir::prelude::*;
    pub(crate) use crate::js::prelude::*;
    pub(crate) use crate::options::*;
    pub(crate) use bun_lint::ast::*;
    pub(crate) use bun_lint::span::{Span, Spanned};
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum FormatError {
    /// The file has syntax errors. It is left as it is.
    SyntaxError,
    /// The syntax is nested so deeply that formatting it would overflow the stack. The file is left
    /// as it is.
    NestedTooDeeply,
    /// A bug in the formatter: the document it wrote is malformed.
    InvalidDocument,
}
