//! GraphQL: `.graphql` files, and the templates in JavaScript that are GraphQL.
//!
//! The specification is Prettier's `src/language-graphql`, which parses with graphql-js.
//!
//! ```text
//! text ─ parser::parse ─→ Tree ─ comments::attach ─→ [Attached] ─ printer::Builder ─→ the document of `crate::ir`
//! ```

mod comments;
pub(crate) mod embed;
mod parser;
mod printer;
mod range;

use crate::ir::element::{Align, FormatElement, LineMode, Tag};
use crate::js::context::JsFormatContext;
use crate::options::LineEnding;
use crate::range::{Offsets, alignment_size, normalized_len, write_with_line_ending};
use crate::text::{BOM, has_pragma_in_hash_comment as has_pragma, is_blank, trim};
use crate::{FormatError, FormatOptions};

/// Whether Prettier takes the file at `path` for GraphQL.
pub fn is_graphql_path(path: &[u8]) -> bool {
    [&b".graphql"[..], b".gql", b".graphqls"]
        .iter()
        .any(|extension| path.ends_with(extension))
}

/// Everything that is allocated to format a text. It is reused for the next one.
#[derive(Default)]
pub struct Scratch {
    tree: parser::Tree,
    attached: Vec<comments::Attached>,
    document: crate::Scratch,
}

/// Appends the formatted `text` to `out`: Prettier's `formatWithCursor`, without the cursor.
pub fn format(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let original = text;
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(original, first, options);
    let text = &original[first..];
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        range_start: None,
        range_end: None,
        ..options.clone()
    };
    // The offsets after `\r\n` has become `\n`.
    let [start, end] =
        [start, end].map(|offset| normalized_len(original.get(first..offset).unwrap_or_default()));
    let mut normalized = Vec::new();
    let mut text = text;
    if bun_core::strings::contains_char(text, b'\r') {
        write_with_line_ending(text, b"\n", &mut normalized);
        text = &normalized;
    }

    if (start >= end && !text.is_empty())
        || (options.require_pragma && !has_pragma(text, [b"format", b"prettier"]))
        || (options.check_ignore_pragma && has_pragma(text, [b"noformat", b"noprettier"]))
    {
        out.extend_from_slice(original);
        return Ok(());
    }
    out.extend_from_slice(&original[..first]);
    let in_original = |error: FormatError| error.before_normalizing_end_of_line(&original[first..]);
    if start > 0 || end < text.len() {
        return format_range(text, start, end, &options, scratch, out).map_err(in_original);
    }
    let with_pragma;
    if options.insert_pragma
        && !options.require_pragma
        && !has_pragma(text, [b"format", b"prettier"])
    {
        with_pragma = [b"# @format\n\n", text].concat();
        text = &with_pragma;
    }
    format_normalized(text, 0, &options, scratch, out).map_err(in_original)
}

/// Prettier's `formatRange`
fn format_range(
    text: &[u8],
    start: usize,
    end: usize,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    parser::parse(text, &mut scratch.tree).map_err(FormatError::SyntaxErrorAt)?;
    let range = range::calculate_range(text, &scratch.tree, start, end).unwrap_or_default();
    let (before, rest) = text.split_at((range.start as usize).min(text.len()));
    let (slice, after) = rest.split_at((range.len() as usize).min(rest.len()));

    let mut formatted = Vec::new();
    let slice_options = FormatOptions {
        line_ending: LineEnding::Lf,
        ..options.clone()
    };
    let alignment = alignment_size(before, options.indent_width.value());
    format_normalized(slice, alignment, &slice_options, scratch, &mut formatted)?;

    let line_ending = options.line_ending.as_bytes();
    write_with_line_ending(before, line_ending, out);
    write_with_line_ending(trim(&formatted), line_ending, out);
    write_with_line_ending(after, line_ending, out);
    Ok(())
}

/// Prettier's `coreFormat`. `text` has no byte order mark and no `\r`. `alignment`: the number of
/// columns that every line is indented by.
fn format_normalized(
    text: &[u8],
    alignment: usize,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    if is_blank(text) {
        return Ok(());
    }
    let Scratch {
        tree,
        attached,
        document,
    } = scratch;
    parser::parse(text, tree).map_err(FormatError::SyntaxErrorAt)?;
    comments::attach(text, tree, attached);

    // Prettier's `addAlignmentToDoc`. The line break makes the indentation take effect.
    let tab_width = usize::from(options.indent_width.value().max(1));
    let (levels, spaces) = (alignment / tab_width, (alignment % tab_width) as u8);
    let context = JsFormatContext::without_file(text, options.clone(), &[]);
    let root = crate::ir::run::write_with(context, text, document, |f| {
        if spaces > 0 {
            f.write_element(FormatElement::Tag(Tag::StartAlign(Align(spaces))));
        }
        for _ in 0..levels {
            f.write_element(FormatElement::Tag(Tag::StartIndent));
        }
        if alignment > 0 {
            f.write_element(FormatElement::Line(LineMode::Hard));
        }
        let mut builder = printer::Builder {
            text,
            tree,
            attached,
            f,
            is_in_template: false,
        };
        builder.print(tree.root());
        for _ in 0..levels {
            f.write_element(FormatElement::Tag(Tag::EndIndent));
        }
        if spaces > 0 {
            f.write_element(FormatElement::Tag(Tag::EndAlign));
        }
    })?;
    crate::ir::run::print(root, text, options, document, out)
}
