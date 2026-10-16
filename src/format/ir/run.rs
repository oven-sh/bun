//! From a file to its formatted text.

use super::element::Interned;
use super::formatter::Formatter;
use crate::cursor::CursorRegion;
use crate::js::comments;
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
    /// Their ids, for the second pass.
    unprinted_comment_ids: Vec<u32>,
}

/// Appends the formatted text of `file` to `out`: the document that `write` writes. Returns where the ends of `cursor` are
/// in what is appended.
///
/// Every comment is owned by a node or a name, and whoever writes that has to write the comment. Prettier throws if a comment
/// is left over. Here the file is formatted once more, and the statement or the class member that such a comment is in writes
/// it after itself: the comment moves, and the file is formatted. `--debug-unprinted-comments` lists these comments.
pub(crate) fn format_with_marks<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    cursor: CursorRegion,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    write: impl Fn(&'a File<'a>, &mut Formatter<'a>),
) -> Result<[Option<u32>; 2], FormatError> {
    if options.debug_comments == DebugComments::Owners {
        let has_tree_of_babel = crate::js::context::has_tree_of_babel(file, options);
        let attach_options = crate::js::attach::Options {
            has_tree_of_babel,
            experimental_ternaries: options.experimental_ternaries,
            flavor: options.flavor,
        };
        let cast_parens = comments::cast_parens(file, options.flavor, has_tree_of_babel);
        crate::js::attach::list(file, &cast_parens, attach_options, out);
        return Ok([None; 2]);
    }
    let mut root = write_document(file, options, cursor, scratch, Vec::new(), &write);
    if options.debug_comments == DebugComments::Unprinted {
        out.append(&mut scratch.unprinted_comments);
        return Ok([None; 2]);
    }
    if matches!(root, Err(FormatError::InvalidDocument)) {
        let comments_without_printer = std::mem::take(&mut scratch.unprinted_comment_ids);
        root = write_document(
            file,
            options,
            cursor,
            scratch,
            comments_without_printer,
            &write,
        );
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
    comments_without_printer: Vec<u32>,
    write: &impl Fn(&'a File<'a>, &mut Formatter<'a>),
) -> Result<Interned, FormatError> {
    if file.has_parse_errors() {
        return Err(FormatError::SyntaxError);
    }
    let comments = comments::of_file(file, options);
    let mut context = JsFormatContext::new(file, options.clone(), comments);
    context.cursor = cursor;
    context.comments_without_printer = comments_without_printer;
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
    scratch.unprinted_comment_ids.clear();
    for comment in formatter.context().comments().unprinted() {
        use std::io::Write;
        scratch.unprinted_comment_ids.push(comment.id());
        let Some(attachment) = formatter.context().comments().attachment(comment) else {
            continue;
        };
        let owner = (crate::js::ast_nodes::AST_KIND_NAMES)
            .get(attachment.owner_kind as usize)
            .unwrap_or(&"Name");
        let _ = writeln!(
            scratch.unprinted_comments,
            "{} {} {:?} {owner} {:?}",
            comment.span().start,
            comment.span().end,
            attachment.placement,
            attachment.marker
        );
    }
    let (root, buffers) = formatter.finish();
    scratch.formatter = buffers;
    if ran_out_of_stack {
        return Err(FormatError::NestedTooDeeply);
    }
    // Prettier's `ensureAllCommentsPrinted`: a file is left alone rather than written without one of its comments.
    if !scratch.unprinted_comment_ids.is_empty() {
        return Err(FormatError::InvalidDocument);
    }
    Ok(root)
}
