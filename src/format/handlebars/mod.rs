//! Handlebars, as Glimmer reads it: Prettier's `language-handlebars`, with ports of the parsers that it uses.
//!
//! ```text
//! text ─ lexer::lex ─→ [Token] ─ parser::parse ─→ [Statement] ─ tokenizer::build ─→ Tree ─ printer::Printer ─→ Elements
//!        @handlebars/parser                                     simple-html-tokenizer, @glimmer/syntax
//! ```
//!
//! Prettier prints what the parsers give it, and they drop and change things: there is no `<!DOCTYPE html>` in the
//! tree, `{{this/a}}` is `{{a}}`. So it is here.

mod ast;
mod lexer;
mod parser;
mod positions;
mod printer;
mod tailwind;
mod tokenizer;

use crate::css::doc::{self, Elements};
use crate::options::{HtmlWhitespaceSensitivity, QuoteStyle};
use crate::range::{Offsets, normalized_len};
use crate::syntax_error::{Message, Refusal, Refused};
use crate::text::{self, BOM};
use crate::{FormatError, FormatOptions};
use std::borrow::Cow;

/// How deep blocks and elements can be in each other, and expressions in parentheses.
const MAX_DEPTH: usize = 256;

#[derive(Copy, Clone, Debug)]
enum Error {
    Syntax(Refused),
    NestedTooDeeply,
}

/// Whether Prettier takes the file at `path` for Handlebars.
pub fn is_handlebars_path(path: &[u8]) -> bool {
    let ends_with = |extension: &[u8]| {
        path.len()
            .checked_sub(extension.len())
            .is_some_and(|at| path[at..].eq_ignore_ascii_case(extension))
    };
    ends_with(b".hbs") || ends_with(b".handlebars")
}

/// What can be used again for the next file.
#[derive(Default)]
pub struct Scratch {
    tokens: Vec<lexer::Token>,
    positions: positions::Positions,
    statements: Vec<parser::Statement>,
    tree: ast::Tree,
    elements: Elements,
    is_damaged: bool,
}

impl Scratch {
    /// Whether what `format` has printed last says something else than the template. The parsers drop and change things,
    /// and so does Prettier's printer: a doctype, the first part of `{{this/a}}`, the line breaks in a `<script>`.
    pub fn is_damaged(&self) -> bool {
        self.is_damaged
    }
}

/// Prettier's `parse`, of a text without `\r` that has blanks in the place of its front matter, which ends at
/// `front_matter_end`. Returns the template.
fn parse(
    content: &[u8],
    front_matter_end: usize,
    scratch: &mut Scratch,
    refusal: &Refusal,
) -> Result<ast::NodeId, Error> {
    let Scratch {
        tokens,
        positions,
        statements,
        tree,
        ..
    } = scratch;
    tokens.clear();
    positions.clear();
    statements.clear();
    tree.clear();
    // Positions have 31 bits.
    if content.len() > i32::MAX as usize {
        return Err(Error::Syntax(refusal.note(Message::TooLarge, 0)));
    }
    lexer::lex(content, tokens, positions, refusal)?;
    parser::parse(content, tokens, tree, statements, refusal)?;
    let front_matter =
        (front_matter_end > 0).then(|| tree.add(ast::Kind::FrontMatter, 0, front_matter_end));
    tokenizer::build(content, statements, positions, front_matter, tree, refusal)
}

/// Appends the formatted `text` to `out`: Prettier's `formatWithCursor`, without the cursor.
pub fn format(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    scratch.is_damaged = false;
    let original = text;
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(original, first, options);
    // The offsets after `\r\n` has become `\n`.
    let [start, end] =
        [start, end].map(|offset| normalized_len(original.get(first..offset).unwrap_or_default()));
    let text = crate::css::normalize_end_of_line(&original[first..]);
    let text = &text[..];
    if start >= end && !text.is_empty() {
        out.extend_from_slice(original);
        return Ok(());
    }
    let is_range = start > 0 || end < text.len();
    if !is_range && text::trim(text).is_empty() {
        out.extend_from_slice(&original[..first]);
        return Ok(());
    }
    // So that all positions stay.
    let front_matter_end = crate::front_matter::parse(text).map_or(0, |it| it.end);
    let mut content = Cow::Borrowed(text);
    if front_matter_end > 0 {
        for byte in &mut content.to_mut()[..front_matter_end] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    let refusal = Refusal::default();
    let template =
        parse(&content, front_matter_end, scratch, &refusal).map_err(|error| match error {
            Error::Syntax(_) => FormatError::SyntaxErrorAt(refusal.reason())
                .before_normalizing_end_of_line(&original[first..]),
            Error::NestedTooDeeply => FormatError::NestedTooDeeply,
        })?;
    out.extend_from_slice(&original[..first]);
    // Nothing in a template is something that Prettier formats on its own.
    if is_range {
        doc::print(
            doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(text)),
            options,
            original,
            out,
        );
        return Ok(());
    }
    if let Some(tailwind) = &options.tailwind {
        tailwind::sort_classes(&mut scratch.tree, &content, tailwind);
    }
    scratch.elements.clear();
    let mut printer = printer::Printer {
        tree: &scratch.tree,
        source: &content,
        front_matter: &text[..front_matter_end],
        positions: &scratch.positions,
        options,
        is_white_space_sensitive: !matches!(
            options.html_whitespace_sensitivity,
            HtmlWhitespaceSensitivity::Ignore
        ),
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        out: &mut scratch.elements,
        is_damaged: false,
        pre_depth: 0,
    };
    printer.template(template);
    scratch.is_damaged = printer.is_damaged
        || scratch.tree.is_damaged
        || positions::Positions::can_be_wrong(&content);
    doc::Printer::new(options, original, out).print(&scratch.elements, 0, 0);
    Ok(())
}
