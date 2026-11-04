//! Checks if a file is already the way a plugin would leave it, as far as the formatter can tell.
//!
//! A plugin reprints every import on one line, with different empty lines than before. Most of the time the formatter
//! undoes all of that, because the imports were already sorted. In that case the file doesn't have to be parsed again.

use super::babel::Model;
use super::generator::{Piece, PieceKind};
use bun_core::strings;

/// How the code on both sides of the whitespace `text[from..to]` is laid out: 0 for one line, 1 for two lines, 2 for an
/// empty line between. Returns `None` if it isn't all whitespace.
fn gap(text: &[u8], from: u32, to: u32) -> Option<u8> {
    let gap = text.get(from as usize..to as usize)?;
    if !gap
        .iter()
        .all(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
    {
        return None;
    }
    let breaks = strings::count_char(gap, b'\n')
        + gap
            .iter()
            .zip(gap.iter().skip(1).chain(b" "))
            .filter(|it| *it.0 == b'\r' && *it.1 != b'\n')
            .count();
    Some(breaks.min(2) as u8)
}

/// True if the imports `source` and `printed` have the same tokens, apart from a `,` before a `}` and a `;` at the
/// end. Neither contains comments.
fn has_same_tokens(source: &[u8], printed: &[u8]) -> bool {
    let (mut source, mut printed) = (source.trim_ascii_start(), printed.trim_ascii_start());
    loop {
        match (source, printed) {
            ([], []) | ([], [b';']) => return true,
            ([quote @ (b'"' | b'\''), ..], [other, ..]) if quote == other => {
                let len = bun_lint::tokens::token_len(source);
                if source.get(..len) != printed.get(..len) {
                    return false;
                }
                (source, printed) = (&source[len..], &printed[len..]);
            }
            ([a, rest_source @ ..], [b, rest_printed @ ..]) if a == b => {
                (source, printed) = (rest_source, rest_printed)
            }
            ([b',', rest @ ..], [b'}', ..]) if rest.trim_ascii_start().starts_with(b"}") => {
                source = rest
            }
            _ => return false,
        }
        (source, printed) = (source.trim_ascii_start(), printed.trim_ascii_start());
    }
}

/// True if formatting `new_text` gives the same output as formatting `model`'s file.
///
/// - The two are identical up to `from`.
/// - `pieces` are `new_text`'s statements and comments from `new_from` to `new_rest_start`.
/// - From `new_rest_start` on, `new_text` is the file's text from `model.rest_start`.
pub(super) fn is_unchanged(
    model: &Model,
    from: u32,
    new_text: &[u8],
    new_from: u32,
    pieces: &[Piece],
    new_rest_start: u32,
) -> bool {
    if !model.is_contiguous {
        return false;
    }
    let text = model.text;
    let is_ignore = |piece: &Piece| matches!(piece.kind, PieceKind::Comment(id) if model.comment_value(id).trim_ascii() == b"prettier-ignore");
    let is_exact = pieces.iter().any(is_ignore);

    // The file's pieces, in order.
    let interpreter = model
        .interpreter
        .iter()
        .map(|it| (PieceKind::Interpreter, it.0));
    let directives = model
        .directives
        .iter()
        .enumerate()
        .map(|(index, it)| (PieceKind::Directive(index as u32), it.span));
    let imports = (model.declarations.iter().enumerate())
        .filter_map(|(index, it)| Some((PieceKind::Import(index as u32), it.span?)));
    let mut statements = interpreter
        .chain(directives)
        .chain(imports)
        .filter(|it| it.1.start >= from)
        .peekable();
    let mut comments = model
        .comments
        .iter()
        .enumerate()
        .filter(|it| it.1.span.start >= from)
        .peekable();

    let (mut end, mut new_end) = (from, new_from);
    let mut is_first = from == model.text_start();
    for piece in pieces {
        let next_comment = comments.peek().map(|it| it.1.span.start);
        let (kind, span) = match statements.peek().copied() {
            Some(statement) if next_comment.is_none_or(|comment| statement.1.start < comment) => {
                // A comment inside a statement.
                if next_comment.is_some_and(|comment| comment < statement.1.end) {
                    return false;
                }
                statements.next();
                statement
            }
            _ => match comments.next() {
                Some((id, comment)) => (PieceKind::Comment(id as u32), comment.span),
                None => return false,
            },
        };
        if kind != piece.kind {
            return false;
        }
        let (gap, new_gap) = (
            gap(text, end, span.start),
            gap(new_text, new_end, piece.start),
        );
        if gap.is_none() || new_gap.is_none() || (gap != new_gap && !is_first) {
            return false;
        }
        is_first = false;
        let (source, printed) = (
            model.file.slice(span),
            new_text
                .get(piece.start as usize..piece.end as usize)
                .unwrap_or_default(),
        );
        let is_same = match kind {
            PieceKind::Import(index) => {
                let attributes = model.declarations[index as usize].import.attributes();
                let is_broken = attributes.is_some_and(|it| {
                    let first = it
                        .entries()
                        .first()
                        .map_or_else(|| it.braces_span().end, |first| first.span().start);
                    strings::index_of_any(
                        model
                            .file
                            .slice(bun_lint::span::Span::new(it.braces_span().start, first)),
                        b"\n\r",
                    )
                    .is_some()
                });
                source == printed || (!is_exact && !is_broken && has_same_tokens(source, printed))
            }
            PieceKind::Directive(_) => {
                source == printed || (!is_exact && has_same_tokens(source, printed))
            }
            PieceKind::Interpreter | PieceKind::Comment(_) => source == printed,
        };
        if !is_same {
            return false;
        }
        (end, new_end) = (span.end, piece.end);
    }
    if statements.next().is_some() || comments.next().is_some() {
        return false;
    }
    let (gap, new_gap) = (
        gap(text, end, model.rest_start),
        gap(new_text, new_end, new_rest_start),
    );
    gap.is_some()
        && new_gap.is_some()
        && (gap == new_gap || model.rest_start as usize >= text.len())
}
