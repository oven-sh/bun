//! The syntax of HTML and XPath, apart from any DOM.
#![forbid(unsafe_code)]

#[cfg(test)]
use bun_sema_standalone as _;

mod chars;
pub mod escape;
pub mod html;
pub mod names;
pub mod xpath;

pub use chars::{Chars, Text, Unit};
