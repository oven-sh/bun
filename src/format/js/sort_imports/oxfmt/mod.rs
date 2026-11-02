//! oxfmt 0.72's `sortImports`, which is modeled on eslint-plugin-perfectionist's `sort-imports`: a port of
//! `oxc_formatter/src/ir_transform/sort_imports`.
//!
//! Imports are sorted while they're formatted. A run of imports is formatted in source order, which the comments need,
//! but it's captured ([`ImportRun`]) instead of going into the document. The document gets a reference to each captured
//! line, in sorted order. Nothing is parsed again and no element is copied.

mod options;
mod run;

pub(super) use options::{Options, compile};
pub(crate) use run::ImportRun;
