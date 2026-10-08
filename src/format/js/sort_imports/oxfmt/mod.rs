//! `sortImports` of oxfmt 0.72, which is modelled on `sort-imports` of eslint-plugin-perfectionist:
//! a port of `oxc_formatter/src/ir_transform/sort_imports`.
//!
//! Imports are sorted while they are formatted. A run of imports is written in the order of the
//! source, which the comments need, but not into the document: it is captured ([`ImportRun`]).
//! What goes into the document is a reference to each line of it, in the order they are sorted
//! into. Nothing is parsed again and no element is copied.

mod glob;
mod options;
mod run;

pub(super) use options::{Options, compile};
pub(crate) use run::ImportRun;
