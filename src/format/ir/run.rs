//! From a file to its formatted text.

use super::formatter::Formatter;
use crate::cursor::CursorRegion;
use crate::{FormatError, FormatOptions};
use bun_lint::ast::File;

/// Everything that is allocated to format a file. It is reused for the next file.
#[derive(Default)]
pub struct Scratch {
    formatter: super::formatter::FormatterBuffers,
    propagate: super::document::PropagateBuffers,
    printer: super::printer::PrinterBuffers,
}

/// Appends the formatted text of `file` to `out`.
pub fn format<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    format_with(file, options, scratch, out, crate::js::format_file)
}

/// The same for the document that `write` writes.
pub(crate) fn format_with<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<(), FormatError> {
    format_with_marks(file, options, CursorRegion::NONE, scratch, out, write).map(|_| ())
}

/// The same. Returns where the ends of `cursor` are in what is appended to `out`.
pub(crate) fn format_with_marks<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    cursor: CursorRegion,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<[Option<u32>; 2], FormatError> {
    let root = write_document(file, options, cursor, scratch, write)?;
    out.reserve(file.text().len() + file.text().len() / 8);
    super::printer::print(
        root,
        &scratch.formatter.storage,
        file.text(),
        super::printer::PrinterOptions::new(options, file.text()),
        &mut scratch.printer,
        out,
    )
    .map_err(|_| FormatError::InvalidDocument)?;
    Ok(scratch.printer.marks)
}

/// The document of `file`, for debugging.
pub fn dump_document<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Result<String, FormatError> {
    let root = write_document(file, options, CursorRegion::NONE, scratch, crate::js::format_file)?;
    Ok(super::debug::dump(root, &scratch.formatter.storage, file.text()))
}

fn write_document<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    cursor: CursorRegion,
    scratch: &mut Scratch,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<super::element::Interned, FormatError> {
    if file.has_parse_errors() {
        return Err(FormatError::SyntaxError);
    }
    // The file keeps them, so that they live as long as the handles.
    let comments = file.extension(|| {
        let mut comments = Vec::new();
        crate::js::comments::collect(file, &mut comments);
        comments
    });
    let comments = comments.map_or(&[][..], |comments: &Vec<crate::js::comments::Comment>| comments);
    let mut context = crate::js::context::JsFormatContext::new(file, options.clone(), comments);
    context.cursor = cursor;
    let buffers = std::mem::take(&mut scratch.formatter);
    let mut formatter = Formatter::new(context, buffers);
    write(file, &mut formatter);
    let ran_out_of_stack = formatter.context().ran_out_of_stack;
    let (root, buffers) = formatter.finish();
    scratch.formatter = buffers;
    if ran_out_of_stack {
        return Err(FormatError::NestedTooDeeply);
    }
    super::document::propagate_expand(root, &mut scratch.formatter.storage, &mut scratch.propagate);
    Ok(root)
}
