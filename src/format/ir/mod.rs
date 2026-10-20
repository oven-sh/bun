//! The language-independent parts: the intermediate representation, the builders that write it, and the printer.

pub(crate) mod builders;
pub(crate) mod document;
pub(crate) mod element;
pub(crate) mod formatter;
pub(crate) mod macros;
pub(crate) mod printer;
pub(crate) mod run;
pub(crate) mod width;
mod width_tables;

pub(crate) mod prelude {
    pub(crate) use super::builders::*;
    pub(crate) use super::element::{Fallback, FormatElement, GroupId, JsLabels, LabelId, Tag};
    pub(crate) use super::formatter::{Format, Formatter, MemoizeFormat, Memoized};
}
