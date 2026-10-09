//! Whether a file is as a plugin leaves it, as far as the formatter can tell.
//!
//! A plugin prints every import anew, on one line, and with other empty lines than there were.
//! Most of the time the formatter undoes all of that: the imports were sorted before. Then the
//! file does not have to be parsed again.

use super::babel::Model;
use super::generator::{Piece, PieceKind};
use bun_core::strings;

/// How what is on both sides of the whitespace `text[from..to]` is laid out: on one line, on two
/// lines, or with an empty line between. `None`: it is not whitespace.
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

/// Whether the imports `written` and `printed` have the same tokens, but for a `,` before a `}`
/// and a `;` at the end. There are no comments in them.
fn has_same_tokens(written: &[u8], printed: &[u8]) -> bool {
    let (mut written, mut printed) = (written.trim_ascii_start(), printed.trim_ascii_start());
    loop {
        match (written, printed) {
            ([], []) | ([], [b';']) => return true,
            ([quote @ (b'"' | b'\''), ..], [other, ..]) if quote == other => {
                let len = bun_lint::tokens::token_len(written);
                if written.get(..len) != printed.get(..len) {
                    return false;
                }
                (written, printed) = (&written[len..], &printed[len..]);
            }
            ([a, rest_written @ ..], [b, rest_printed @ ..]) if a == b => {
                (written, printed) = (rest_written, rest_printed)
            }
            ([b',', rest @ ..], [b'}', ..]) if rest.trim_ascii_start().starts_with(b"}") => {
                written = rest
            }
            _ => return false,
        }
        (written, printed) = (written.trim_ascii_start(), printed.trim_ascii_start());
    }
}

/// Whether formatting `new_text` gives what formatting the file of `model` gives.
///
/// - The two are the same up to `from`.
/// - `pieces`: the statements and the comments of `new_text` from `new_from` to `new_rest_start`.
/// - From `new_rest_start`, it is the text of the file from `model.rest_start`.
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

    // The pieces of the file, in order.
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
                // A comment in a statement.
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
        let (written, printed) = (
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
                written == printed || (!is_exact && !is_broken && has_same_tokens(written, printed))
            }
            PieceKind::Directive(_) => {
                written == printed || (!is_exact && has_same_tokens(written, printed))
            }
            PieceKind::Interpreter | PieceKind::Comment(_) => written == printed,
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
