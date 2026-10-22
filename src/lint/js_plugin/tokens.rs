//! A file's tokens and comments as arrays of numbers.
//!
//! A token list is its length, then every start offset, then every end offset, then every [`TokenKind`] as one byte,
//! padded with zeros to a multiple of 4 bytes.

use super::units::Units;
use super::wire;
use crate::ast::svelte::{Role, SvelteKind, SvelteTag};
use crate::ast::{File, jsx_text_value_of};
use crate::estree::Dialect;
use crate::span::Span;
use crate::tokens::{TokenKind, Tokens};
use bun_core::strings;
use smallvec::SmallVec;
use std::borrow::Cow;

fn write_list(tokens: Tokens, offsets: &Units, out: &mut Vec<u8>) {
    let in_units = tokens.map(|it| {
        let start = offsets.to_utf16(it.start());
        (start, offsets.end_to_utf16(it.start(), it.end()), it.kind())
    });
    write_in_units(tokens.count(), in_units, out);
}

/// Appends the list of `count` tokens: each one's start and end in UTF-16 code units, and its kind.
fn write_in_units(
    count: usize,
    tokens: impl Iterator<Item = (u32, u32, TokenKind)> + Clone,
    out: &mut Vec<u8>,
) {
    wire::words(out, &[count as u32]);
    out.reserve(count * 9 + 3);
    for (start, ..) in tokens.clone() {
        out.extend_from_slice(&start.to_le_bytes());
    }
    for (_, end, _) in tokens.clone() {
        out.extend_from_slice(&end.to_le_bytes());
    }
    out.extend(tokens.map(|it| it.2 as u8));
    out.resize(out.len() + (4 - count % 4) % 4, 0);
}

/// Appends the `value` of each token whose value isn't a slice of the source, because espree decodes it. The layout is
/// the count, `[token index, start, end]` for each, then the UTF-16 code units that `start` and `end` index into,
/// padded with zeros to a multiple of 4 bytes.
fn write_decoded_values<'a>(file: &'a File<'a>, out: &mut Vec<u8>) {
    // oxlint decodes names the way espree does.
    let can_have_any = (Dialect::of(file) == Dialect::Espree || file.language().is_oxlint)
        && strings::index_of_any(file.text(), b"\\&\r").is_some();
    if !can_have_any {
        return wire::words(out, &[0]);
    }
    let mut is_after_equals = false;
    let values = file.tokens().enumerate().filter_map(|(index, token)| {
        let is_attribute = core::mem::replace(&mut is_after_equals, token.is_punctuator("="));
        let value = match token.kind() {
            // An attribute's string keeps its source text. With oxlint, all JSX text does.
            TokenKind::JsxText if is_attribute || file.language().is_oxlint => return None,
            TokenKind::JsxText => jsx_text_value_of(token.text(), true),
            _ => token.decoded_value(),
        };
        Some((index, value))
    });
    write_values(values, out);
}

fn write_values<'a>(values: impl Iterator<Item = (usize, Cow<'a, [u8]>)>, out: &mut Vec<u8>) {
    let mut entries = Vec::new();
    let mut units = Vec::new();
    for (index, value) in values {
        let Cow::Owned(value) = value else {
            continue;
        };
        let start = units.len() as u32;
        match strings::wtf8_to_utf16_alloc(&value) {
            Some(value) => units.extend_from_slice(&value),
            None => units.extend(value.iter().map(|&it| u16::from(it))),
        }
        entries.extend_from_slice(&[index as u32, start, units.len() as u32]);
    }
    wire::words(out, &[entries.len() as u32 / 3]);
    wire::words(out, &entries);
    out.extend(units.iter().flat_map(|it| it.to_le_bytes()));
    out.resize(out.len() + units.len() % 2 * 2, 0);
}

/// Appends the tokens, then the comments, then the values that espree decodes.
pub(super) fn write<'a>(file: &'a File<'a>, offsets: &Units, out: &mut Vec<u8>) {
    if offsets.is_in_component() {
        let tokens = write_component(file, offsets, out);
        write_list(file.comments(), offsets, out);
        return write_decoded_component_values(file, &tokens, out);
    }
    write_list(file.tokens(), offsets, out);
    write_list(file.comments(), offsets, out);
    write_decoded_values(file, out);
}

/// A component's tokens as svelte-eslint-parser creates them: the program tokens rules see, the markup text as
/// `HTMLText` tokens for whitespace and non-whitespace runs, and the tokens of code the program only has a copy of,
/// which rules don't see in it: `generics`, a `let:`'s pattern.
fn write_component<'a>(
    file: &'a File<'a>,
    offsets: &Units,
    out: &mut Vec<u8>,
) -> Vec<(u32, u32, TokenKind)> {
    let (Some(component), Some(view)) = (file.svelte(), file.view()) else {
        write_list(file.tokens(), offsets, out);
        return Vec::new();
    };
    let text = component.text();
    let texts = crate::estree::svelte_text_tokens(file);
    let in_texts = |at: u32| {
        let index = texts.partition_point(|it| it.end <= at);
        texts.get(index).is_some_and(|it| it.start <= at)
    };
    // The names after the first in a component's name, `<a.b.c>`, which svelte-eslint-parser has as markup names.
    let mut names: Vec<u32> = (file.svelte_nodes_of(SvelteTag::MemberExpressionName))
        .filter_map(|it| Some(it.child(Role::Property)?.span().start))
        .collect();
    names.sort_unstable();
    // The starts of directive names: `on:click|once`, `style:color`. The nodes are in text order.
    let directives: Vec<u32> = (file.svelte_nodes_of(SvelteTag::DirectiveKey))
        .map(|it| it.span().start)
        .collect();
    // Code the program has a copy of, and only markup in a comment at its source position.
    let is_code = |token: crate::tokens::Token<'_>| {
        !matches!(
            token.kind(),
            TokenKind::HtmlText
                | TokenKind::HtmlIdentifier
                | TokenKind::HtmlComment
                | TokenKind::MustacheKeyword
        )
    };
    // A `let:`'s pattern isn't program code.
    let is_let_pattern = |id| {
        let owner = component.code(id).and_then(|it| file.svelte_node(it.2));
        owner.is_some_and(|it| it.tag() == SvelteTag::Directive && it.kind() == SvelteKind::Let)
    };
    let mut copied: Vec<Span> = (component.codes())
        .filter(|&(id, span, _)| {
            let [written, copies] = view.pieces_in_program(span);
            let is_copied =
                !copies.is_empty() && !written.iter().any(|it| file.tokens_in(*it).any(is_code));
            !span.is_empty() && (is_copied || is_let_pattern(id))
        })
        .map(|(_, span, _)| span)
        .collect();
    copied.sort_unstable_by_key(|it| it.start);
    // One piece of code can contain another.
    copied.dedup_by(|next, it| {
        let is_in = next.start < it.end;
        if is_in {
            it.end = it.end.max(next.end);
        }
        is_in
    });
    let copied_at = |at: u32| {
        let index = copied.partition_point(|it| it.end <= at);
        copied.get(index).filter(|it| it.start <= at).copied()
    };

    // Their spans in the component.
    let mut all: Vec<(u32, u32, TokenKind)> =
        Vec::with_capacity(file.tokens().count() + texts.len());
    let mut push = |start: u32, end: u32, kind: TokenKind| {
        // The parts that overlap copied code are in its tokens, and the text around them gets tokens of its own.
        let mut at = start;
        while at < end {
            if let Some(code) = copied_at(at) {
                at = code.end;
                continue;
            }
            let next = copied.get(copied.partition_point(|it| it.start <= at));
            let until = next.map_or(end, |it| it.start.min(end));
            match (at, until) == (start, end) {
                true => all.push((start, end, kind)),
                false => all.extend(code_tokens(text, Span::new(at, until))),
            }
            at = until;
        }
    };
    for token in file.tokens() {
        let start = view.in_file(token.start());
        let end = view.in_file(token.end() - 1) + 1;
        let word = text.get(start as usize..end as usize).unwrap_or_default();
        let kind = match token.kind() {
            TokenKind::HtmlText if in_texts(start) => continue,
            // `{@attach a}` in a tag.
            TokenKind::HtmlIdentifier if word.starts_with(b"@") => TokenKind::MustacheKeyword,
            TokenKind::HtmlIdentifier => {
                let is_directive = directives.binary_search(&start).is_ok();
                for (from, to, kind) in directive_parts(word, is_directive) {
                    push(start + from, start + to, kind);
                }
                continue;
            }
            TokenKind::Identifier if names.binary_search(&start).is_ok() => {
                TokenKind::HtmlIdentifier
            }
            kind => kind,
        };
        push(start, end, kind);
    }
    for span in &copied {
        let in_component = |token: crate::tokens::Token<'_>| {
            let start = view.in_file(token.start());
            (start, start + token.span().len(), token.kind())
        };
        let [written, copies] = view.pieces_in_program(*span);
        match copies.is_empty() {
            true => all.extend(
                written
                    .iter()
                    .flat_map(|it| file.tokens_in(*it).map(in_component)),
            ),
            false => all.extend(
                copies
                    .iter()
                    .flat_map(|it| file.copied_tokens_in(*it).map(in_component)),
            ),
        }
    }
    all.extend(
        texts
            .iter()
            .map(|it| (it.start, it.end, TokenKind::HtmlText)),
    );
    crate::utils::sort::sort_by_key(&mut all, |it| it.0);
    let in_units = (all.iter()).map(|it| {
        (
            offsets.text_to_utf16(it.0),
            offsets.text_to_utf16(it.1),
            it.2,
        )
    });
    write_in_units(all.len(), in_units, out);
    all
}

fn write_decoded_component_values<'a>(
    file: &'a File<'a>,
    tokens: &[(u32, u32, TokenKind)],
    out: &mut Vec<u8>,
) {
    let Some(view) = file.view().filter(|_| Dialect::of(file) == Dialect::Espree) else {
        return wire::words(out, &[0]);
    };
    let values = tokens
        .iter()
        .enumerate()
        .filter_map(|(index, &(start, end, kind))| {
            if !matches!(
                kind,
                TokenKind::Identifier
                    | TokenKind::Keyword
                    | TokenKind::PrivateIdentifier
                    | TokenKind::Boolean
                    | TokenKind::Null
            ) {
                return None;
            }
            let span = Span::new(start, end);
            let text = file.svelte()?.text().get(start as usize..end as usize)?;
            if !strings::contains_char(text, b'\\') {
                return None;
            }
            for piece in view.pieces_in_program(span).into_iter().flatten() {
                let mut tokens = file.tokens_in(piece).chain(file.copied_tokens_in(piece));
                if let Some(token) = tokens.find(|it| it.span() == piece && it.kind() == kind) {
                    return Some((index, token.decoded_value()));
                }
            }
            None
        });
    write_values(values, out);
}

/// The tokens of a directive's name, `on:click|once`, as svelte-eslint-parser has them: the names and the punctuators
/// between them. One part for any other name. Each with its start and end in `name`.
fn directive_parts(name: &[u8], is_directive: bool) -> SmallVec<[(u32, u32, TokenKind); 3]> {
    let mut parts = SmallVec::new();
    let directive = is_directive
        .then(|| strings::index_of_char_usize(name, b':'))
        .flatten();
    // The modifiers after a name that's code: the `|global` of `transition:slide|global`.
    let mut at = match directive {
        Some(colon) => {
            parts.push((0, colon as u32, TokenKind::HtmlIdentifier));
            colon
        }
        None if name.starts_with(b"|") => 0,
        None => {
            parts.push((0, name.len() as u32, TokenKind::HtmlIdentifier));
            return parts;
        }
    };
    while at < name.len() {
        parts.push((at as u32, at as u32 + 1, TokenKind::Punctuator));
        let start = at + 1;
        let rest = name.get(start..).unwrap_or_default();
        let len = strings::index_of_char_usize(rest, b'|').unwrap_or(rest.len());
        if len > 0 {
            parts.push((
                start as u32,
                (start + len) as u32,
                TokenKind::HtmlIdentifier,
            ));
        }
        at = start + len;
    }
    parts
}

/// The consecutive tokens at `span` in `text`, with their positions in `text`: the parts of a program token around the
/// copied code inside it.
fn code_tokens(text: &[u8], span: Span) -> Vec<(u32, u32, TokenKind)> {
    let mut tokens = Vec::new();
    let inner = text.get(..span.end as usize).unwrap_or_default();
    let mut at = span.start;
    loop {
        let token = crate::tokens::next_token(inner, at);
        let Some(word) = inner
            .get(token.start as usize..token.end as usize)
            .filter(|it| !it.is_empty())
        else {
            return tokens;
        };
        let kind = match word.first().copied().unwrap_or_default() {
            b'"' | b'\'' => TokenKind::String,
            b'`' => TokenKind::Template,
            b'0'..=b'9' => TokenKind::Numeric,
            c if c.is_ascii_alphabetic() || matches!(c, b'_' | b'$') || c >= 0x80 => match word {
                b"true" | b"false" => TokenKind::Boolean,
                b"null" => TokenKind::Null,
                b"extends" | b"typeof" | b"in" | b"const" | b"void" | b"this" | b"new"
                | b"import" | b"function" => TokenKind::Keyword,
                _ => TokenKind::Identifier,
            },
            _ => TokenKind::Punctuator,
        };
        tokens.push((token.start, token.end, kind));
        at = token.end;
    }
}

pub(super) fn write_comments<'a>(file: &'a File<'a>, offsets: &Units, out: &mut Vec<u8>) {
    write_list(file.comments(), offsets, out);
}
