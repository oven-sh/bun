//! From a file to its formatted text.

use super::element::Interned;
use super::formatter::Formatter;
use crate::cursor::CursorRegion;
use crate::js::comments::{ParsedBy, collect};
use crate::js::context::JsFormatContext;
use crate::{FormatError, FormatOptions};
use bun_lint::ast::File;

/// Everything that is allocated to format a file. It is reused for the next file.
#[derive(Default)]
pub struct Scratch {
    formatter: super::formatter::FormatterBuffers,
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
    print(root, file.text(), options, scratch, out)?;
    Ok(scratch.printer.marks)
}

impl Scratch {
    /// Where the marks around the cursor were in what has been printed last.
    pub(crate) fn marks(&self) -> [Option<u32>; 2] {
        self.printer.marks
    }
}

/// Appends the text of the document `root`, which [`write_with`] has returned, to `out`.
pub(crate) fn print(
    root: Interned,
    source: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let printer_options = super::printer::PrinterOptions::new(options, source);
    super::printer::print(
        root,
        &scratch.formatter.storage,
        source,
        printer_options,
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
    let root = write_document(
        file,
        options,
        CursorRegion::NONE,
        scratch,
        crate::js::format_file,
    )?;
    Ok(super::debug::dump(
        root,
        &scratch.formatter.storage,
        file.text(),
    ))
}

fn write_document<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    cursor: CursorRegion,
    scratch: &mut Scratch,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<Interned, FormatError> {
    if file.has_parse_errors() {
        return Err(FormatError::SyntaxError);
    }
    // The file keeps them, so that they live as long as the handles.
    let comments = file.extension(|| {
        let mut comments = Vec::new();
        collect(
            file,
            options.flavor,
            ParsedBy::WhatItsNameSays,
            &mut comments,
        );
        comments
    });
    let comments = comments.map_or(&[][..], |comments: &Vec<crate::js::comments::Comment>| {
        comments
    });
    let mut context = JsFormatContext::new(file, options.clone(), comments);
    context.cursor = cursor;
    write_with(context, file.text(), scratch, |f| write(file, f))
}

/// Calls `write` to write a document whose source text is `source`. For a text that is not
/// JavaScript, `context` is one [without a file](JsFormatContext::without_file).
pub(crate) fn write_with<'a>(
    context: JsFormatContext<'a>,
    source: &'a [u8],
    scratch: &mut Scratch,
    write: impl FnOnce(&mut Formatter<'a>),
) -> Result<Interned, FormatError> {
    let buffers = std::mem::take(&mut scratch.formatter);
    let mut formatter = Formatter::new(context, source, buffers);
    write(&mut formatter);
    finish(formatter, scratch)
}

/// Gives the vectors of `formatter` back to `scratch`. Returns where the document is.
fn finish(formatter: Formatter<'_>, scratch: &mut Scratch) -> Result<Interned, FormatError> {
    let ran_out_of_stack = formatter.context().ran_out_of_stack;
    let (root, buffers) = formatter.finish();
    scratch.formatter = buffers;
    if ran_out_of_stack {
        return Err(FormatError::NestedTooDeeply);
    }
    Ok(root)
}
