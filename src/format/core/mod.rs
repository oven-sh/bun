//! What does not depend on the language: the intermediate representation, the vocabulary to write
//! it in, and the printer.

pub(crate) mod builders;
pub(crate) mod debug;
pub(crate) mod document;
pub(crate) mod element;
pub(crate) mod formatter;
pub(crate) mod macros;
pub(crate) mod printer;
pub(crate) mod width;
mod width_tables;

pub(crate) mod prelude {
    pub(crate) use super::builders::*;
    pub(crate) use super::element::{
        FormatElement, GroupId, Interned, JsLabels, LabelId, LineMode, PrintMode, Tag, TagKind,
        TextWidth,
    };
    pub(crate) use super::formatter::{Elements, Format, Formatter, MemoizeFormat, Memoized};
}
