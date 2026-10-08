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

mod ir;
mod js;
pub mod options;
pub mod verify;

pub use options::FormatOptions;

// Not in the prelude: a glob import cannot shadow the macros of the same names in `std`.
pub(crate) use crate::ir as core;
pub(crate) use crate::ir::macros::{best_fitting, format_args, write};

use bun_lint::ast::File;

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
    /// A bug in the formatter: the document it wrote is malformed.
    InvalidDocument,
}

/// Everything that is allocated to format a file. It is reused for the next file.
#[derive(Default)]
pub struct Scratch {
    formatter: ir::formatter::FormatterBuffers,
    propagate: ir::document::PropagateBuffers,
    printer: ir::printer::PrinterBuffers,
}

/// Appends the formatted text of `file` to `out`.
pub fn format<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let root = write_document(file, options, scratch)?;
    out.reserve(file.text().len() + file.text().len() / 8);
    ir::printer::print(
        root,
        &scratch.formatter.storage,
        file.text(),
        ir::printer::PrinterOptions::new(options, file.text()),
        &mut scratch.printer,
        out,
    )
    .map_err(|_| FormatError::InvalidDocument)
}

/// The document of `file`, for debugging.
pub fn dump_document<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Result<String, FormatError> {
    let root = write_document(file, options, scratch)?;
    Ok(ir::debug::dump(root, &scratch.formatter.storage, file.text()))
}

fn write_document<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Result<ir::element::Interned, FormatError> {
    if file.has_parse_errors() {
        return Err(FormatError::SyntaxError);
    }
    // The file keeps them, so that they live as long as the handles.
    let comments = file.extension(|| {
        let mut comments = Vec::new();
        js::comments::collect(file, &mut comments);
        comments
    });
    let comments = comments.map_or(&[][..], |comments: &Vec<js::comments::Comment>| comments);
    let context = js::context::JsFormatContext::new(file, options.clone(), comments);
    let buffers = std::mem::take(&mut scratch.formatter);
    let mut formatter = ir::formatter::Formatter::new(context, buffers);
    js::format_file(file, &mut formatter);
    let (root, buffers) = formatter.finish();
    scratch.formatter = buffers;
    ir::document::propagate_expand(root, &mut scratch.formatter.storage, &mut scratch.propagate);
    Ok(root)
}
