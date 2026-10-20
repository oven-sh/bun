//! Handlebars, as Glimmer reads it: Prettier's `language-handlebars`, with ports of the parsers that it uses.
//!
//! ```text
//! text ─ lexer::lex ─→ [Token] ─ parser::parse ─→ [Statement] ─ tokenizer::build ─→ Tree ─ printer::Printer ─→ Elements
//!        @handlebars/parser                                     simple-html-tokenizer, @glimmer/syntax
//! ```
//!
//! Prettier prints what the parsers give it, and they drop and change things: there is no `<!DOCTYPE html>` in the
//! tree, `{{this/a}}` is `{{a}}`. Its printer changes some more: the lines of a `<script>` are joined. Here the output
//! says what the template says. Where Prettier's does, it is Prettier's. Where it does not, it is what Prettier would
//! have to print, or the text of the smallest node around the place as it is written (`ast::Node::is_as_written`).

mod ast;
mod lexer;
mod parser;
mod printer;
mod tailwind;
mod tokenizer;
mod verify;

use crate::css::doc::{self, Elements};
use crate::options::{HtmlWhitespaceSensitivity, QuoteStyle};
use crate::range::{Offsets, normalized_len};
use crate::stack::Stack;
use crate::syntax_error::{Message, Refusal, Refused};
use crate::text::BOM;
use crate::{FormatError, FormatOptions};
use std::borrow::Cow;

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
    statements: Vec<parser::Statement>,
    tree: ast::Tree,
    elements: Elements,
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
        statements,
        tree,
        ..
    } = scratch;
    tokens.clear();
    statements.clear();
    tree.clear();
    // Positions have 31 bits.
    if content.len() > i32::MAX as usize {
        return Err(Error::Syntax(refusal.note(Message::TooLarge, 0)));
    }
    lexer::lex(content, tokens, refusal)?;
    parser::parse(content, tokens, tree, statements, refusal)?;
    let front_matter =
        (front_matter_end > 0).then(|| tree.add(ast::Kind::FrontMatter, 0, front_matter_end));
    tokenizer::build(content, statements, front_matter, tree, refusal)
}

/// `text`, which has no `\r`, with blanks in the place of its front matter, so that all positions stay. And where the
/// front matter ends.
fn without_front_matter(text: &[u8]) -> (Cow<'_, [u8]>, usize) {
    let front_matter_end = crate::front_matter::parse(text).map_or(0, |it| it.end);
    let mut content = Cow::Borrowed(text);
    if front_matter_end > 0 {
        for byte in &mut content.to_mut()[..front_matter_end] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    (content, front_matter_end)
}

/// `--debug-check`: whether `after`, which `format` has made of `before`, says what that says. See `verify.rs`.
pub fn says_the_same(
    before: &[u8],
    after: &[u8],
    options: &FormatOptions,
) -> Result<bool, FormatError> {
    let mut scratch = Scratch::default();
    let written = [before, after].map(|text| {
        let text = bun_core::strings::crlf_as_lf(text.strip_prefix(BOM).unwrap_or(text));
        let (content, front_matter_end) = without_front_matter(&text);
        let template = parse(
            &content,
            front_matter_end,
            &mut scratch,
            &Refusal::default(),
        )
        .ok()?;
        if scratch.tree.has_lost_text {
            return Some((content.into_owned(), false));
        }
        let mut writer = verify::Writer {
            tree: &scratch.tree,
            source: &content,
            is_white_space_sensitive: !matches!(
                options.html_whitespace_sensitivity,
                HtmlWhitespaceSensitivity::Ignore
            ),
            out: Vec::new(),
            run: Vec::new(),
            pre_depth: 0,
            tailwind: options.tailwind.as_deref(),
            touches: None,
            stack: Stack::new(),
        };
        writer.template(template);
        Some((writer.out, writer.stack.ran_out()))
    });
    let [Some(before), Some(after)] = written else {
        return Ok(false);
    };
    if before.1 || after.1 {
        return Err(FormatError::NestedTooDeeply);
    }
    Ok(before.0 == after.0)
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
    // The offsets after `\r\n` has become `\n`.
    let [start, end] =
        [start, end].map(|offset| normalized_len(original.get(first..offset).unwrap_or_default()));
    let text = bun_core::strings::crlf_as_lf(&original[first..]);
    let text = &text[..];
    if start >= end && !text.is_empty() {
        out.extend_from_slice(original);
        return Ok(());
    }
    let is_range = start > 0 || end < text.len();
    // For Prettier a no-break space is white space too.
    if !is_range && text.trim_ascii().is_empty() {
        out.extend_from_slice(&original[..first]);
        return Ok(());
    }
    let (content, front_matter_end) = without_front_matter(text);
    let refusal = Refusal::default();
    let template =
        parse(&content, front_matter_end, scratch, &refusal).map_err(|error| match error {
            Error::Syntax(_) => FormatError::SyntaxErrorAt(refusal.reason())
                .before_normalizing_end_of_line(&original[first..]),
            Error::NestedTooDeeply => FormatError::NestedTooDeeply,
        })?;
    if scratch.tree.has_lost_text {
        out.extend_from_slice(original);
        return Ok(());
    }
    out.extend_from_slice(&original[..first]);
    // Nothing in a template is something that Prettier formats on its own.
    if is_range {
        return doc::print(
            doc::replace_end_of_line_with_literal_lines(Cow::Borrowed(text)),
            options,
            original,
            out,
        );
    }
    if let Some(tailwind) = &options.tailwind {
        tailwind::sort_classes(&mut scratch.tree, &content, tailwind);
    }
    scratch.elements.clear();
    let mut printer = printer::Printer {
        tree: &scratch.tree,
        source: &content,
        front_matter: &text[..front_matter_end],
        options,
        is_white_space_sensitive: !matches!(
            options.html_whitespace_sensitivity,
            HtmlWhitespaceSensitivity::Ignore
        ),
        single_quote: matches!(options.quote_style, QuoteStyle::Single),
        out: &mut scratch.elements,
        pre_depth: 0,
        stack: Stack::for_tree(),
    };
    printer.template(template);
    if printer.stack.ran_out() {
        return Err(FormatError::NestedTooDeeply);
    }
    let mut printer = doc::Printer::new(options, original, out);
    printer.print(&scratch.elements, 0, 0);
    printer.result()
}
