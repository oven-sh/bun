//! What `print/jsx/` and the code around JSX elements share.

use crate::prelude::*;
use crate::{format_args, write};

/// Nothing else is white space in JSX.
pub(crate) fn is_jsx_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\n' | b'\t' | b'\r')
}

pub(crate) fn has_line_break(whitespace: &[u8]) -> bool {
    bun_core::strings::index_of_any(whitespace, b"\r\n").is_some()
}

/// Prettier's `isMeaningfulJsxText`: it is not only white space with a line break in it.
pub(crate) fn is_meaningful_jsx_text(text: &[u8]) -> bool {
    !text.iter().copied().all(is_jsx_whitespace) || !has_line_break(text)
}

/// Whether an element gets parentheses if it breaks.
#[derive(Copy, Clone, Debug)]
pub(crate) enum WrapState {
    /// Where it is, it is set apart already: in an array, in `{}`, as an argument.
    NoWrap,
    WrapOnBreak,
}

/// A space between children. At the end of a line it has to be written as `{" "}`.
pub(crate) struct JsxSpace;

impl<'a> Format<'a> for JsxSpace {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, [if_group_breaks(&format_args!(JsxRawSpace, soft_line_break())), if_group_fits_on_line(&space())]);
    }
}

/// `{" "}`
pub(crate) struct JsxRawSpace;

impl<'a> Format<'a> for JsxRawSpace {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(
            f,
            match f.options().quote_style {
                QuoteStyle::Double => r#"{" "}"#,
                QuoteStyle::Single => "{' '}",
            }
        );
    }
}

/// `{" "}`. `child`: what is in the braces.
pub(crate) fn is_whitespace_jsx_expression<'a>(child: Expr<'a>, comments: &Comments<'a>) -> bool {
    matches!(child.kind(), ExprKind::String(value) if value.bytes() == b" ")
        && !child.is_jsx_text()
        && child.jsx_container_span().is_some_and(|span| !comments.has_comment_in_span(span))
}
