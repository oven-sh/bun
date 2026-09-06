//! String helpers that mirror the JavaScript semantics turndown relies on
//! (`String.prototype.trim`, `\s`), plus Markdown escaping.

use super::dom::{NodeData, Ref, next_in_preorder};
use super::scan;

/// Splits on `\n`. (`str::split` is off-limits in this tree; the SIMD byte
/// search finds each newline and `\n` is always a char boundary.)
pub(crate) fn lines(s: &str) -> impl Iterator<Item = &str> {
    let mut rest = Some(s);
    core::iter::from_fn(move || {
        let cur = rest?;
        match scan::find_byte(cur.as_bytes(), b'\n') {
            Some(i) => {
                rest = Some(&cur[i + 1..]);
                Some(&cur[..i])
            }
            None => {
                rest = None;
                Some(cur)
            }
        }
    })
}

/// JavaScript `\s` / `String.prototype.trim` whitespace: WhiteSpace +
/// LineTerminator code points.
#[inline]
pub(crate) fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | ' '
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// The subset turndown's whitespace collapsing treats as inter-word space
/// (`/[ \r\n\t]+/`). Everything else in `\s` (nbsp, etc.) is preserved.
#[inline]
pub(crate) fn is_ascii_ws(c: char) -> bool {
    matches!(c, ' ' | '\r' | '\n' | '\t')
}

pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `String.prototype.trim` applied in place.
pub(crate) fn js_trim_in_place(s: &mut String) {
    let end = s.trim_end_matches(is_js_whitespace).len();
    s.truncate(end);
    let start = s.len() - s.trim_start_matches(is_js_whitespace).len();
    if start > 0 {
        s.drain(..start);
    }
}

pub(crate) fn leading_newlines(s: &str) -> usize {
    s.bytes().take_while(|&b| b == b'\n').count()
}

/// Appends the concatenated text of every text node under `node` (DOM
/// `textContent`), leaving out dropped (`is_skipped`) subtrees.
pub(crate) fn push_text_content(node: Ref<'_>, out: &mut String) {
    if let Some(t) = node.as_text() {
        out.push_str(&t.borrow());
        return;
    }
    let mut cur = node.first_child.get();
    while let Some(n) = cur {
        if let Some(t) = n.as_text() {
            out.push_str(&t.borrow());
        }
        cur = next_in_preorder(n, node, !n.tag().is_skipped());
    }
}

/// Iterates the text nodes under `root` in document order (forwards) or
/// reverse document order (backwards). Dropped (`is_skipped`) subtrees are
/// treated as absent, as they are everywhere else.
fn text_nodes<'a>(root: Ref<'a>, backwards: bool) -> impl Iterator<Item = Ref<'a>> {
    // Reverse pre-order: last_child chain, then previous siblings, then up.
    fn prev_in_order<'a>(node: Ref<'a>, root: Ref<'a>) -> Option<Ref<'a>> {
        if !node.tag().is_skipped()
            && let Some(c) = node.last_child.get()
        {
            return Some(c);
        }
        let mut cur = node;
        loop {
            if core::ptr::eq(cur, root) {
                return None;
            }
            if let Some(s) = cur.previous_sibling.get() {
                return Some(s);
            }
            cur = cur.parent.get()?;
        }
    }
    let first = if root.as_text().is_some() {
        Some(root)
    } else if backwards {
        root.last_child.get()
    } else {
        root.first_child.get()
    };
    let mut cur = first;
    core::iter::from_fn(move || {
        loop {
            let n = cur?;
            cur = if core::ptr::eq(n, root) {
                None
            } else if backwards {
                prev_in_order(n, root)
            } else {
                next_in_preorder(n, root, !n.tag().is_skipped())
            };
            if matches!(n.data, NodeData::Text(_)) {
                return Some(n);
            }
        }
    })
}

/// The leading whitespace run of `node.textContent`, split the way
/// turndown's `edgeWhitespace` regex does: `ascii` is the initial
/// `[ \t\r\n]*` run and `rest` is whatever `\s*` follows it (nbsp and
/// friends, possibly with more ASCII space after them). For all-whitespace
/// content the whole text counts as leading.
pub(crate) fn leading_whitespace(node: Ref<'_>, ascii: &mut String, rest: &mut String) {
    ascii.clear();
    rest.clear();
    for t in text_nodes(node, false) {
        let t = t.as_text().unwrap().borrow();
        for c in t.chars() {
            if !is_js_whitespace(c) {
                return;
            }
            if rest.is_empty() && is_ascii_ws(c) {
                ascii.push(c);
            } else {
                rest.push(c);
            }
        }
    }
}

/// The trailing whitespace run of `node.textContent`: `ascii` is the final
/// `[ \t\r\n]*` run and `rest` is the non-ASCII-whitespace part before it.
/// Empty for all-whitespace content (turndown attributes it all to the
/// leading side).
pub(crate) fn trailing_whitespace(node: Ref<'_>, rest: &mut String, ascii: &mut String) {
    ascii.clear();
    rest.clear();
    // Collected in reverse; flipped at the end.
    let mut saw_non_ws = false;
    'outer: for t in text_nodes(node, true) {
        let t = t.as_text().unwrap().borrow();
        for c in t.chars().rev() {
            if !is_js_whitespace(c) {
                saw_non_ws = true;
                break 'outer;
            }
            if rest.is_empty() && is_ascii_ws(c) {
                ascii.push(c);
            } else {
                rest.push(c);
            }
        }
    }
    if !saw_non_ws {
        ascii.clear();
        rest.clear();
        return;
    }
    reverse_in_place(ascii);
    reverse_in_place(rest);
}

fn reverse_in_place(s: &mut String) {
    if s.len() > 1 {
        let rev: String = s.chars().rev().collect();
        *s = rev;
    }
}

/// Whether `node.textContent` ends with an ASCII space (`/ $/`).
pub(crate) fn text_content_ends_with_space(node: Ref<'_>) -> bool {
    for t in text_nodes(node, true) {
        let t = t.as_text().unwrap().borrow();
        if !t.is_empty() {
            return t.ends_with(' ');
        }
    }
    false
}

/// Whether `node.textContent` starts with an ASCII space (`/^ /`).
pub(crate) fn text_content_starts_with_space(node: Ref<'_>) -> bool {
    for t in text_nodes(node, false) {
        let t = t.as_text().unwrap().borrow();
        if !t.is_empty() {
            return t.starts_with(' ');
        }
    }
    false
}

/// Escapes Markdown-significant characters in a run of prose so the text
/// round-trips as literal text. Follows turndown's `escapeMarkdown`, with
/// two deliberate differences that only ever remove backslashes a reader
/// would otherwise see:
///
/// - line-start constructs (`-`, `+ `, `#`, `>`, `1. `, `=`, `~~~`) are only
///   escaped when the text actually lands at the start of a line, and
/// - `_` between two ASCII alphanumerics is left alone, since CommonMark
///   never treats an intraword underscore as emphasis.
///
/// `<` followed by something that could open a tag or autolink is escaped
/// too (turndown leaves it, which lets literal `&lt;div&gt;` text turn back
/// into markup).
pub(crate) fn escape_markdown_into(text: &str, at_line_start: bool, out: &mut String) {
    let bytes = text.as_bytes();
    if bytes.is_empty() {
        return;
    }

    let mut i = 0;
    if at_line_start {
        i = escape_line_start(text, out);
    }

    // Hop between candidate bytes with the SIMD scanner; prose has few of
    // them, so most of the text is copied in a handful of large pushes.
    // Everything matched is ASCII, so slicing at it keeps UTF-8 intact.
    let mut run_start = i;
    while let Some(off) = scan::find_any(&bytes[i..], b"\\*`[]_<") {
        let at = i + off;
        let esc = match bytes[at] {
            b'_' => {
                let prev_alnum = at > 0 && bytes[at - 1].is_ascii_alphanumeric();
                let next_alnum = at + 1 < bytes.len() && bytes[at + 1].is_ascii_alphanumeric();
                !(prev_alnum && next_alnum)
            }
            b'<' => {
                at + 1 < bytes.len()
                    && (bytes[at + 1].is_ascii_alphabetic()
                        || matches!(bytes[at + 1], b'/' | b'!' | b'?'))
            }
            _ => true,
        };
        if esc {
            out.push_str(&text[run_start..at]);
            out.push('\\');
            run_start = at;
        }
        i = at + 1;
    }
    out.push_str(&text[run_start..]);
}

/// Handles turndown's `^`-anchored escapes. Returns how many input bytes
/// were consumed (always a prefix of ASCII digits / `=`).
fn escape_line_start(text: &str, out: &mut String) -> usize {
    let bytes = text.as_bytes();
    match bytes[0] {
        b'-' | b'>' => {
            out.push('\\');
            0
        }
        b'+' if bytes.get(1) == Some(&b' ') => {
            out.push('\\');
            0
        }
        b'=' => {
            // `/^(=+)/` → `\$1`
            out.push('\\');
            let n = bytes.iter().take_while(|&&b| b == b'=').count();
            out.push_str(&text[..n]);
            n
        }
        b'#' => {
            // `/^(#{1,6}) /`
            let n = bytes.iter().take_while(|&&b| b == b'#').count();
            if n <= 6 && bytes.get(n) == Some(&b' ') {
                out.push('\\');
            }
            0
        }
        b'~' if bytes.starts_with(b"~~~") => {
            out.push('\\');
            0
        }
        b'0'..=b'9' => {
            // `/^(\d+)\. /` → `$1\. `
            let n = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            if bytes.get(n) == Some(&b'.') && bytes.get(n + 1) == Some(&b' ') {
                out.push_str(&text[..n]);
                out.push_str("\\.");
                n + 1
            } else {
                0
            }
        }
        _ => 0,
    }
}
