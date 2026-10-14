//! From a file to its formatted text.

use super::element::Interned;
use super::formatter::Formatter;
use crate::cursor::CursorRegion;
use crate::js::comments::{self, ParsedBy};
use crate::js::context::JsFormatContext;
use crate::options::DebugComments;
use crate::{FormatError, FormatOptions};
use bun_lint::ast::File;

/// Everything that is allocated to format a file. It is reused for the next file.
#[derive(Default)]
pub struct Scratch {
    formatter: super::formatter::FormatterBuffers,
    printer: super::printer::PrinterBuffers,
    /// A line for each comment of the last file that no printer has printed.
    unprinted_comments: Vec<u8>,
}

/// Appends the formatted text of `file` to `out`: the document that `write` writes. Returns where the ends of `cursor` are
/// in what is appended.
pub(crate) fn format_with_marks<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    cursor: CursorRegion,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<[Option<u32>; 2], FormatError> {
    if options.debug_comments == DebugComments::Owners {
        let mut comments = Vec::new();
        crate::js::comments::collect_in_source_order(file, options.flavor, &mut comments);
        let attach_options = crate::js::attach::Options {
            has_tree_of_babel: file.is_javascript(),
            experimental_ternaries: options.experimental_ternaries,
        };
        let cast_parens = crate::js::comments::cast_parens(file, &comments);
        crate::js::attach::list(file, &comments, &cast_parens, attach_options, out);
        return Ok([None; 2]);
    }
    let root = write_document(file, options, cursor, scratch, write);
    if options.debug_comments == DebugComments::Unprinted {
        out.append(&mut scratch.unprinted_comments);
        return Ok([None; 2]);
    }
    print(root?, file.text(), options, scratch, out)?;
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
    .map_err(FormatError::from)
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
    let comments = comments::of_file(file, options, ParsedBy::WhatItsNameSays);
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
    scratch.unprinted_comments.clear();
    for comment in formatter.context().comments().unprinted() {
        use std::io::Write;
        let owner = (crate::js::ast_nodes::AST_KIND_NAMES)
            .get(comment.owner_kind() as usize)
            .unwrap_or(&"Name");
        let _ = writeln!(
            scratch.unprinted_comments,
            "{} {} {:?} {owner}",
            comment.span.start, comment.span.end, comment.placement
        );
    }
    let (root, buffers) = formatter.finish();
    scratch.formatter = buffers;
    if ran_out_of_stack {
        return Err(FormatError::NestedTooDeeply);
    }
    // Prettier's `ensureAllCommentsPrinted`: a file is left alone rather than written without one of its comments.
    if !scratch.unprinted_comments.is_empty() {
        return Err(FormatError::InvalidDocument);
    }
    Ok(root)
}
