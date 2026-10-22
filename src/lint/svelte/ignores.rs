//! A component's `svelte-ignore` comments, as eslint-plugin-svelte's `getSvelteIgnoreItems` finds them
//! (`shared/svelte-compile-warns/ignore-comment.js`): in its code comments and its HTML comments, one item per code, or
//! the comment itself if it names none.

use bun_core::strings;
use bun_lint::prelude::*;
use std::borrow::Cow;

/// A code a `svelte-ignore` comment names, or the comment if it names none.
pub(crate) struct Ignore<'a> {
    /// The comment, with its delimiters, in the component.
    pub(crate) comment: Span,
    /// The code as written, and its span. `None` if the comment names none.
    pub(crate) code: Option<(&'a [u8], Span)>,
    /// Svelte 5's name for the code: `codeForV5`.
    pub(crate) code_for_five: Cow<'a, [u8]>,
}

impl Ignore<'_> {
    /// `range[0]`, which they're sorted by.
    fn start(&self) -> u32 {
        self.code.map_or(self.comment.start, |it| it.1.start)
    }

    /// True if it ignores warnings with the code `code`.
    pub(crate) fn ignores(&self, code: &[u8]) -> bool {
        self.code.is_some_and(|it| it.0 == code) || *self.code_for_five == *code
    }
}

/// `V5_REPLACEMENTS`: the Svelte 4 codes whose Svelte 5 name isn't just the code with `_` for each `-`.
const V5_REPLACEMENTS: &[(&[u8], &[u8])] = &[
    (
        b"non-top-level-reactive-declaration",
        b"reactive_declaration_invalid_placement",
    ),
    (
        b"module-script-reactive-declaration",
        b"reactive_declaration_module_script",
    ),
    (b"empty-block", b"block_empty"),
    (b"avoid-is", b"attribute_avoid_is"),
    (
        b"invalid-html-attribute",
        b"attribute_invalid_property_name",
    ),
    (b"a11y-structure", b"a11y_figcaption_parent"),
    (b"illegal-attribute-character", b"attribute_illegal_colon"),
    (b"invalid-rest-eachblock-binding", b"bind_invalid_each_rest"),
    (b"unused-export-let", b"export_let_unused"),
];

/// `getSvelteIgnoreItems`: from the code comments, then from the HTML comments, last first.
pub(crate) fn ignores_of<'a>(file: &'a File<'a>) -> Vec<Ignore<'a>> {
    let (Some(component), Some(view)) = (file.svelte(), file.view()) else {
        return Vec::new();
    };
    let text = component.text();
    let in_component = |span: Span| {
        let start = view.in_file(span.start);
        Span::new(start, start + span.len())
    };
    let mut found = Vec::new();
    for comment in file.comments() {
        if !matches!(comment.kind(), TokenKind::Line | TokenKind::Block) {
            continue;
        }
        let (at, value) = (
            in_component(comment.span()),
            in_component(comment.comment_value_span()),
        );
        if let Some(text) = text.get(value.start as usize..value.end as usize) {
            add(&mut found, at, text, at.start + 2);
        }
    }
    for token in file
        .tokens()
        .filter(|it| it.kind() == TokenKind::HtmlComment)
    {
        let at = in_component(token.span());
        let inner = (at.start + 4, at.end.saturating_sub(3).max(at.start + 4));
        if let Some(text) = text.get(inner.0 as usize..inner.1 as usize) {
            add(&mut found, at, text, at.start + 4);
        }
    }
    bun_lint::utils::sort::sort_by_key(&mut found, |it| std::cmp::Reverse(it.start()));
    found
}

/// Adds the codes of `value`, the contents of `comment`, which starts at `start` in the component, if it's a
/// `svelte-ignore` comment.
fn add<'a>(found: &mut Vec<Ignore<'a>>, comment: Span, value: &'a [u8], start: u32) {
    // `/^\s*svelte-ignore\s+/`
    let before = value.len() - strings::trim_js_whitespace_start(value).len();
    let Some(rest) = value
        .get(before..)
        .and_then(|it| it.strip_prefix(b"svelte-ignore"))
    else {
        return;
    };
    let after = rest.len() - strings::trim_js_whitespace_start(rest).len();
    if after == 0 {
        return;
    }
    let list_start = before + b"svelte-ignore".len() + after;
    let list = value.get(list_start..).unwrap_or_default();
    let processed = without_notes(list);
    if strings::trim_js_whitespace(&processed).is_empty() {
        found.push(Ignore {
            comment,
            code: None,
            code_for_five: Cow::Borrowed(b""),
        });
        return;
    }
    let start = start + list_start as u32;
    let mut push = |from: usize, to: usize| {
        let code = list.get(from..to).unwrap_or_default();
        found.push(Ignore {
            comment,
            code: Some((code, Span::new(start + from as u32, start + to as u32))),
            code_for_five: for_five(code),
        });
    };
    // `/\s*[\s,]\s*/g`
    let (mut at, mut last_end, mut count) = (0, 0, 0);
    while at < processed.len() {
        let is_separator =
            processed[at] == b',' || strings::js_whitespace_len(&processed[at..]) > 0;
        if !is_separator {
            at += 1;
            continue;
        }
        let mut end = skip_whitespace(&processed, at);
        if processed.get(end) == Some(&b',') {
            end = skip_whitespace(&processed, end + 1);
        }
        if at > last_end {
            push(last_end, at);
            count += 1;
        }
        (last_end, at) = (end, end);
    }
    if count == 0 {
        push(0, processed.len());
    }
}

fn skip_whitespace(text: &[u8], mut at: usize) -> usize {
    while let Some(len) = text
        .get(at..)
        .map(strings::js_whitespace_len)
        .filter(|&it| it > 0)
    {
        at += len;
    }
    at
}

/// `codeList` with each `/\([^)]*\)/gu` blanked, which separates codes.
fn without_notes(list: &[u8]) -> Cow<'_, [u8]> {
    let Some(first) = strings::index_of_char_usize(list, b'(') else {
        return Cow::Borrowed(list);
    };
    let mut out = list.to_vec();
    let mut from = first;
    while let Some(open) = strings::index_of_char_usize(out.get(from..).unwrap_or_default(), b'(') {
        let open = from + open;
        let Some(close) = strings::index_of_char_usize(out.get(open..).unwrap_or_default(), b')')
        else {
            break;
        };
        let close = open + close;
        out[open..=close].fill(b' ');
        from = close + 1;
    }
    Cow::Owned(out)
}

/// `V5_REPLACEMENTS[code] || code.replace(/-/gu, "_")`
fn for_five(code: &[u8]) -> Cow<'_, [u8]> {
    if let Some((_, five)) = V5_REPLACEMENTS.iter().find(|it| it.0 == code) {
        return Cow::Borrowed(five);
    }
    match strings::contains_char(code, b'-') {
        true => Cow::Owned(
            code.iter()
                .map(|&it| if it == b'-' { b'_' } else { it })
                .collect(),
        ),
        false => Cow::Borrowed(code),
    }
}
