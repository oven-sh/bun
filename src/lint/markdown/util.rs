//! The plugin's `util.js`.

use bun_core::strings;
use bun_lint::options::Object;
use bun_lint::regex::Regex;
use bun_lint::rule::Meta;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::sync::LazyLock;

/// `illegalShorthandTailPattern`
pub(crate) static ILLEGAL_SHORTHAND_TAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/\]\[\s+\]$/u"));

/// The start and end of each match of `htmlCommentPattern`, `/<!--[\s\S]*?-->/gu`, in `value`.
pub(crate) fn html_comments(value: &[u8]) -> impl Iterator<Item = (usize, usize)> {
    let mut from = 0;
    std::iter::from_fn(move || {
        let start = from + strings::index_of(value.get(from..)?, b"<!--")?;
        let end = start + 4 + strings::index_of(value.get(start + 4..)?, b"-->")? + 3;
        from = end;
        Some((start, end))
    })
}

/// `value.replace(htmlCommentPattern, "").trim().length === 0`
pub(crate) fn is_only_comments(value: &[u8]) -> bool {
    let mut from = 0;
    for (start, end) in html_comments(value) {
        if !strings::is_all_js_whitespace(&value[from..start]) {
            return false;
        }
        from = end;
    }
    strings::is_all_js_whitespace(&value[from..])
}

/// `stripHtmlComments(value)`: replaces every UTF-16 code unit of a comment with a space, except line breaks. So UTF-16
/// indices into the result are also valid in `value`, but byte offsets aren't.
pub(crate) fn strip_html_comments(value: &[u8]) -> Cow<'_, [u8]> {
    let mut stripped = Vec::new();
    let mut from = 0;
    for (start, end) in html_comments(value) {
        stripped.reserve(value.len());
        stripped.extend_from_slice(&value[from..start]);
        push_as_spaces(&value[start..end], true, &mut stripped);
        from = end;
    }
    if from == 0 {
        return Cow::Borrowed(value);
    }
    stripped.extend_from_slice(&value[from..]);
    Cow::Owned(stripped)
}

/// One of upstream's regular expressions for tags. They all have the flags `giu`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum TagPattern {
    /// `<(?<tagName>[a-z0-9]+(?:-[a-z0-9]+)*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>`
    Opening,
    /// `<img(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>`
    Img,
    /// `<\/?[a-z0-9]+(?:-[a-z0-9]+)*(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?(?:\/\s*)?>`
    OpeningOrClosing,
}

/// The offsets of a tag and of its name.
#[derive(Copy, Clone)]
pub(crate) struct Tag {
    pub(crate) start: usize,
    pub(crate) name: (usize, usize),
    pub(crate) end: usize,
}

/// The length of the prefix of `text` that matches `[a-z0-9]+(?:-[a-z0-9]+)*`. With the flags `i` and `u`, U+017F
/// matches `s` and U+212A matches `k`.
fn tag_name_len(text: &[u8]) -> usize {
    let part_len = |from: usize| {
        let mut at = from;
        loop {
            at += match text.get(at..).unwrap_or_default() {
                [b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9', ..] => 1,
                [0xC5, 0xBF, ..] => 2,
                [0xE2, 0x84, 0xAA, ..] => 3,
                _ => return at - from,
            };
        }
    };
    let mut len = part_len(0);
    while len > 0 && text.get(len) == Some(&b'-') {
        match part_len(len + 1) {
            0 => break,
            part => len += 1 + part,
        }
    }
    len
}

/// The matches of `pattern` in `html`, in linear time. The regular expressions are quadratic on unclosed tags, because
/// they scan the rest of the input from every `<`.
pub(crate) fn tags(html: &[u8], pattern: TagPattern) -> impl Iterator<Item = Tag> {
    // Opening quotes from which the scan is already known to find no closing `>`.
    let mut dead_end_quotes: FxHashSet<usize> = FxHashSet::default();
    // For `'` and for `"`, the offset after which that quote doesn't appear again.
    let mut no_quote_from = [html.len(); 2];
    // A range that's known to have no `>` and no quote in it.
    let mut plain = (0, 0);
    // `closing` finds the `>` where `(?:[^>"']|"[^"]*"|'[^']*')*` stops if it starts matching at `from`.
    let mut seen = Vec::new();
    let mut closing = move |mut from: usize| {
        seen.clear();
        let found = loop {
            if !(plain.0..=plain.1).contains(&from) {
                let rest = html.get(from..).unwrap_or_default();
                plain = (
                    from,
                    from + strings::index_of_any(rest, b">\"'").unwrap_or(rest.len()),
                );
            }
            let at = plain.1;
            let quote = match html.get(at) {
                Some(b'>') => break Some(at),
                Some(&quote) if !dead_end_quotes.contains(&at) => quote,
                _ => break None,
            };
            seen.push(at);
            let none_from = &mut no_quote_from[usize::from(quote == b'"')];
            let end = match at + 1 < *none_from {
                true => strings::index_of_char_usize(&html[at + 1..], quote),
                false => None,
            };
            match end {
                Some(len) => from = at + 1 + len + 1,
                None => {
                    *none_from = (*none_from).min(at + 1);
                    break None;
                }
            }
        };
        if found.is_none() {
            dead_end_quotes.extend(&seen);
        }
        found
    };
    let mut from = 0;
    std::iter::from_fn(move || {
        loop {
            let start = from + strings::index_of_char_usize(html.get(from..)?, b'<')?;
            from = start + 1;
            let is_closing =
                pattern == TagPattern::OpeningOrClosing && html.get(from) == Some(&b'/');
            let name = from + usize::from(is_closing);
            let rest = &html[name..];
            let name_end = name
                + match pattern {
                    TagPattern::Img => match rest.get(..3) {
                        Some(it) if it.eq_ignore_ascii_case(b"img") => 3,
                        _ => 0,
                    },
                    _ => tag_name_len(rest),
                };
            if name_end == name {
                continue;
            }
            let rest = &html[name_end..];
            let end = match (strings::js_whitespace_len(rest), rest) {
                (blank @ 1.., _) => closing(name_end + blank),
                (_, [b'>', ..]) => Some(name_end),
                (_, [b'/', rest @ ..]) => {
                    let blanks = match pattern {
                        TagPattern::OpeningOrClosing => {
                            rest.len() - strings::trim_js_whitespace_start(rest).len()
                        }
                        _ => 0,
                    };
                    (rest.get(blanks) == Some(&b'>')).then_some(name_end + 1 + blanks)
                }
                _ => None,
            };
            if let Some(end) = end {
                from = end + 1;
                return Some(Tag {
                    start,
                    name: (name, name_end),
                    end: end + 1,
                });
            }
        }
    })
}

/// The start and end of the first `</h{depth}>` in `html` at or after `from`. Whitespace is allowed before the `>`.
fn closing_heading_tag(html: &[u8], mut from: usize, depth: u8) -> Option<(usize, usize)> {
    loop {
        let start = from + strings::index_of(html.get(from..)?, b"</")?;
        from = start + 2;
        if let [b'h' | b'H', digit, rest @ ..] = &html[from..]
            && *digit == depth
            && let [b'>', ..] = strings::trim_js_whitespace_start(rest)
        {
            let blanks = rest.len() - strings::trim_js_whitespace_start(rest).len();
            return Some((start, from + 2 + blanks + 1));
        }
    }
}

/// An `h1` to `h6` element in HTML.
#[derive(Copy, Clone)]
pub(crate) struct HtmlHeading {
    pub(crate) start: usize,
    pub(crate) end: usize,
    /// The content between the tags.
    pub(crate) children: (usize, usize),
}

/// The matches of `/<h(?<depth>[1-6])[^>]*>(?<children>[\s\S]*?)<\/h\k<depth>\s*>/giu` in `html` whose depth is in the
/// inclusive range `depths`. It runs in linear time, unlike the regular expression.
pub(crate) fn html_headings(html: &[u8], depths: (u8, u8)) -> impl Iterator<Item = HtmlHeading> {
    // The next closing tag for each depth. `None` means there are no more.
    let mut closing: [Option<(usize, usize)>; 6] = [Some((0, 0)); 6];
    let mut from = 0;
    std::iter::from_fn(move || {
        loop {
            let start = from + strings::index_of_char_usize(html.get(from..)?, b'<')?;
            from = start + 1;
            let [b'h' | b'H', digit @ b'1'..=b'6', rest @ ..] = &html[from..] else {
                continue;
            };
            if !(depths.0..=depths.1).contains(&(digit - b'0')) {
                continue;
            }
            // If there's no `>` left, no later tag is closed either.
            let children_start = from + 2 + strings::index_of_char_usize(rest, b'>')? + 1;
            let known = &mut closing[usize::from(digit - b'1')];
            if known.is_some_and(|it| it.0 < children_start) {
                *known = closing_heading_tag(html, children_start, *digit);
            }
            if let Some((children_end, end)) = *known {
                from = end;
                return Some(HtmlHeading {
                    start,
                    end,
                    children: (children_start, children_end),
                });
            }
        }
    })
}

/// Appends one space for each UTF-16 code unit of `text`.
pub(crate) fn push_as_spaces(text: &[u8], keeps_line_breaks: bool, out: &mut Vec<u8>) {
    for (_, c) in strings::wtf8_codepoints(text) {
        match c {
            0x0A | 0x0D if keeps_line_breaks => out.push(c as u8),
            0x10000.. => out.extend_from_slice(b"  "),
            _ => out.push(b' '),
        }
    }
}

/// `value.split(lineEndingPattern)`
pub(crate) fn lines(value: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(value);
    std::iter::from_fn(move || {
        let text = rest?;
        let Some(at) = strings::index_of_any(text, b"\r\n") else {
            rest = None;
            return Some(text);
        };
        let len = 1 + usize::from(text[at..].starts_with(b"\r\n"));
        rest = Some(&text[at + len..]);
        Some(&text[..at])
    })
}

/// A regex from a rule's options, or `None` for `""`. Upstream compiles it in `create()`, so an invalid pattern ends the run.
/// `Err` is the error ESLint prints then. The rule returns it from `validate`, and never sees a file.
pub(crate) type PatternOption = Result<Option<Regex>, Vec<u8>>;

/// `pattern === "" ? null : new RegExp(pattern, flags)`
pub(crate) fn pattern_option(rule: &Meta, pattern: &str, flags: &str) -> PatternOption {
    if pattern.is_empty() {
        return Ok(None);
    }
    Regex::new(pattern, flags).map(Some).map_err(|error| {
        format!(
            "SyntaxError: Error while loading rule 'markdown/{}': Invalid regular expression: /{pattern}/{flags}: {}",
            rule.name,
            error.reason()
        )
        .into_bytes()
    })
}

/// The default of the `frontmatterTitle` option.
const FRONT_MATTER_TITLE: &str =
    "^(?!\\s*['\"]title[:=]['\"])\\s*\\{?\\s*['\"]?title['\"]?\\s*[:=]";

/// `frontmatterTitle === "" ? null : new RegExp(frontmatterTitle, "iu")`
pub(crate) fn front_matter_title(rule: &Meta, options: Object<'_>) -> PatternOption {
    let pattern = options
        .str("frontmatterTitle")
        .unwrap_or(FRONT_MATTER_TITLE);
    pattern_option(rule, pattern, "iu")
}

/// `frontmatterHasTitle(value, pattern)`
pub(crate) fn front_matter_has_title(value: &[u8], pattern: Option<&Regex>) -> bool {
    pattern.is_some_and(|pattern| lines(value).any(|line| pattern.test(line)))
}

/// `new Set(options[key].map(identifier => normalizeIdentifier(identifier).toLowerCase()))`
pub(crate) fn identifiers(options: Object<'_>, key: &str, default: &[&str]) -> FxHashSet<Vec<u8>> {
    let identifier_of = |it: &&str| bun_format::markdown::identifier_of(it.as_bytes());
    match options.has(key) {
        true => options.strings(key).iter().map(identifier_of).collect(),
        false => default.iter().map(identifier_of).collect(),
    }
}
