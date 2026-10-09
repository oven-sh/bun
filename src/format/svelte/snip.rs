//! The plugin's `snipScriptAndStyleTagContent`: what is in `<script>` and `<style>` is taken out of the text before Svelte
//! parses it, so that nothing in it counts as markup, and an error in it is none of the component's.
//!
//! The plugin keeps what it takes out in an attribute, as Base64. Here the attribute has a number.

use crate::text;
use bun_core::strings;
use rustc_hash::FxHashSet;
use std::borrow::Cow;

/// `snippedTagContentAttribute`
pub(crate) const ATTRIBUTE: &[u8] = "✂prettier:content✂".as_bytes();

pub(crate) struct Snipped {
    /// `text.trim()`
    pub(crate) text: Vec<u8>,
    /// What has been taken out, by the number in the attribute.
    pub(crate) contents: Vec<Vec<u8>>,
    /// `_svelte_ts`: a tag says `lang="ts"`.
    pub(crate) is_typescript: bool,
}

/// A match of `scriptRegex` or `styleRegex`.
struct Match {
    start: usize,
    end: usize,
    /// The first and the second group: between the name and the `>`, and behind that. `None`: it is a comment.
    groups: Option<[(usize, usize); 2]>,
}

/// What has been looked for up to the end of the text, and is not there any more.
#[derive(Default)]
struct Missing {
    comment_end: bool,
    end_tag: bool,
    double_quote: bool,
    single_quote: bool,
    /// From where attributes have been read in vain: there is no `>` at their end.
    attributes_from: FxHashSet<usize>,
}

/// `((?:\s+[^=>'"\/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"\/\s]+)*\s*)>` at `from`. Returns where the `>` is.
fn attributes_end(source: &[u8], from: usize, missing: &mut Missing) -> Option<usize> {
    let white_space = |mut at: usize| {
        while let len @ 1.. = strings::js_whitespace_len(&source[at..]) {
            at += len;
        }
        at
    };
    // Where an attribute may start, and which way to read it is tried next.
    let mut stack: Vec<(usize, u8)> = vec![(from, 0)];
    if missing.attributes_from.contains(&from) {
        return None;
    }
    while let Some((at, way)) = stack.pop() {
        let name = white_space(at);
        let mut name_end = name;
        while name > at && name_end < source.len() {
            if matches!(source[name_end], b'=' | b'>' | b'\'' | b'"' | b'/')
                || strings::js_whitespace_len(&source[name_end..]) > 0
            {
                break;
            }
            name_end += 1;
        }
        let has_name = name_end > name;
        let value = (has_name && source.get(name_end) == Some(&b'=')).then_some(name_end + 1);
        let next = match way {
            // `"[^"]*"`, `'[^']*'`
            0 => value.and_then(|value| {
                let quote = *source.get(value)?;
                let is_missing = match quote {
                    b'"' => &mut missing.double_quote,
                    b'\'' => &mut missing.single_quote,
                    _ => return None,
                };
                if *is_missing {
                    return None;
                }
                let close = strings::index_of_char_usize(&source[value + 1..], quote);
                *is_missing = close.is_none();
                Some(value + 1 + close? + 1)
            }),
            // `[^>\s]+`
            1 => value.and_then(|value| {
                let mut end = value;
                while end < source.len()
                    && source[end] != b'>'
                    && strings::js_whitespace_len(&source[end..]) == 0
                {
                    end += 1;
                }
                (end > value).then_some(end)
            }),
            // The name alone.
            2 => has_name.then_some(name_end),
            // No more attributes: `\s*>`
            _ => {
                if source.get(name) == Some(&b'>') {
                    return Some(name);
                }
                missing.attributes_from.insert(at);
                continue;
            }
        };
        stack.push((at, way + 1));
        if let Some(next) = next.filter(|it| !missing.attributes_from.contains(it)) {
            stack.push((next, 0));
        }
    }
    None
}

/// The first match from `from` on.
fn next_match(source: &[u8], from: usize, tag: &[u8], missing: &mut Missing) -> Option<Match> {
    let mut at = from;
    while let Some(found) = strings::index_of_char_usize(source.get(at..)?, b'<') {
        let start = at + found;
        at = start + 1;
        let rest = &source[at..];
        if let Some(comment) = rest.strip_prefix(b"!--") {
            // `<!--[^]*?-->`
            if missing.comment_end {
                continue;
            }
            match strings::index_of(comment, b"-->") {
                Some(len) => {
                    return Some(Match {
                        start,
                        end: start + 4 + len + 3,
                        groups: None,
                    });
                }
                None => missing.comment_end = true,
            }
            continue;
        }
        if !rest.starts_with(tag) || missing.end_tag {
            continue;
        }
        let attributes = at + tag.len();
        let Some(close) = attributes_end(source, attributes, missing) else {
            continue;
        };
        // `([^]*?)<\/script\s*>`
        let mut search = close + 1;
        loop {
            let Some(found) = strings::index_of(&source[search..], b"</") else {
                missing.end_tag = true;
                break;
            };
            let content_end = search + found;
            search = content_end + 2;
            let Some(behind) = source[search..].strip_prefix(tag) else {
                continue;
            };
            let behind = strings::trim_js_whitespace_start(behind);
            if behind.first() == Some(&b'>') {
                return Some(Match {
                    start,
                    end: source.len() - behind.len() + 1,
                    groups: Some([(attributes, close), (close + 1, content_end)]),
                });
            }
        }
    }
    None
}

/// All matches.
fn matches(source: &[u8], tag: &[u8]) -> Vec<Match> {
    let (mut all, mut from, mut missing) = (Vec::new(), 0, Missing::default());
    while let Some(found) = next_match(source, from, tag, &mut missing) {
        from = found.end;
        all.push(found);
    }
    all
}

/// `/\slang=["']?ts["']?/.test(attributes)`
fn says_typescript(attributes: &[u8]) -> bool {
    let mut from = 0;
    while let Some(found) = strings::index_of(&attributes[from..], b"lang=") {
        let at = from + found;
        from = at + 1;
        let before = &attributes[..at];
        let is_behind_white_space = strings::trim_js_whitespace_end(before).len() < before.len();
        let value = &attributes[at + 5..];
        let value = match value {
            [b'"' | b'\'', rest @ ..] => rest,
            _ => value,
        };
        if is_behind_white_space && value.starts_with(b"ts") {
            return true;
        }
    }
    false
}

struct Pass<'s> {
    tag: &'s [u8],
    placeholder: &'s [u8],
    /// The matches for the other tag: what starts in one of them stays.
    other: &'s [(usize, usize)],
}

/// `snipTagContent`. Returns the new text, and where the matches are in it.
fn snip_tag(
    source: &[u8],
    pass: &Pass<'_>,
    contents: &mut Vec<Vec<u8>>,
    is_typescript: &mut bool,
) -> (Vec<u8>, Vec<(usize, usize)>) {
    let mut out = Vec::with_capacity(source.len());
    let (mut spans, mut copied) = (Vec::new(), 0);
    for found in matches(source, pass.tag) {
        let Some([attributes, content]) = found.groups else {
            continue;
        };
        out.extend_from_slice(&source[copied..found.start]);
        copied = found.start;
        let start = out.len();
        // They are in the order of the text, one behind the other.
        let is_in_other = (pass
            .other
            .partition_point(|it| it.0 < found.start)
            .checked_sub(1))
        .and_then(|at| pass.other.get(at))
        .is_some_and(|it| found.start < it.1);
        if !is_in_other {
            let attributes = &source[attributes.0..attributes.1];
            *is_typescript |= says_typescript(attributes);
            out.push(b'<');
            out.extend_from_slice(pass.tag);
            out.extend_from_slice(attributes);
            out.push(b' ');
            out.extend_from_slice(ATTRIBUTE);
            out.extend_from_slice(b"=\"");
            out.extend_from_slice(contents.len().to_string().as_bytes());
            out.extend_from_slice(b"\">");
            out.extend_from_slice(pass.placeholder);
            out.extend_from_slice(b"</");
            out.extend_from_slice(pass.tag);
            out.push(b'>');
            contents.push(source[content.0..content.1].to_vec());
            copied = found.end;
        }
        spans.push((start, out.len() + (found.end - copied)));
    }
    out.extend_from_slice(&source[copied..]);
    (out, spans)
}

pub(crate) fn snip(source: &[u8]) -> Snipped {
    let (mut contents, mut is_typescript) = (Vec::new(), false);
    let styles: Vec<(usize, usize)> = (matches(source, b"style").iter())
        .filter(|it| it.groups.is_some())
        .map(|it| (it.start, it.end))
        .collect();
    let scripts = Pass {
        tag: b"script",
        placeholder: b"{}",
        other: &styles,
    };
    let (without_scripts, scripts) = snip_tag(source, &scripts, &mut contents, &mut is_typescript);
    let styles = Pass {
        tag: b"style",
        placeholder: b"",
        other: &scripts,
    };
    let (snipped, _) = snip_tag(&without_scripts, &styles, &mut contents, &mut is_typescript);
    Snipped {
        text: strings::trim_js_whitespace(&snipped).to_vec(),
        contents,
        is_typescript,
    }
}

/// `/(<\w+.*?)\s*✂prettier:content✂="(.*?)">.*?(?=<\/)/gi`: where the first match in `text` from `from` on starts, where its
/// first group ends, its second group, and where it ends.
fn snipped_tag(text: &[u8], from: usize) -> Option<(usize, usize, &[u8], usize)> {
    let is_line_break = |at: usize| {
        matches!(text[at], b'\n' | b'\r') || matches!(&text[at..], [0xE2, 0x80, 0xA8 | 0xA9, ..])
    };
    // Before this there is no `<` with a letter behind it that could be the start.
    let mut floor = from;
    let mut search = from;
    loop {
        let attribute = search + strings::index_of(text.get(search..)?, ATTRIBUTE)?;
        search = attribute + ATTRIBUTE.len();
        // `="(.*?)">.*?(?=<\/)`
        let Some(value) = text[search..].strip_prefix(b"=\"") else {
            continue;
        };
        let value_start = search + 2;
        let Some(value_len) = strings::index_of(value, b"\">") else {
            continue;
        };
        let behind = value_start + value_len + 2;
        let Some(rest_len) = strings::index_of(&text[behind..], b"</") else {
            continue;
        };
        if (value_start..behind + rest_len).any(is_line_break) {
            continue;
        }
        // `(<\w+.*?)\s*`: the first `<` with a letter behind it from which no line break is in the way.
        let group_end = floor + strings::trim_js_whitespace_end(&text[floor..attribute]).len();
        let line_start = (floor..group_end)
            .rev()
            .find(|&at| is_line_break(at))
            .map_or(floor, |at| at + 1);
        let start = (line_start..group_end).find(|&at| {
            text[at] == b'<'
                && text
                    .get(at + 1)
                    .is_some_and(|&it| text::is_word_character(it))
        });
        if let Some(start) = start.filter(|&it| it + 1 < group_end) {
            let value = &text[value_start..value_start + value_len];
            return Some((start, group_end, value, behind + rest_len));
        }
        floor = group_end;
    }
}

/// `hasSnippedContent(text) ? unsnipContent(text) : text`
pub(crate) fn unsnip<'a>(text: &'a [u8], contents: &[Vec<u8>]) -> Cow<'a, [u8]> {
    let (mut out, mut copied) = (Vec::new(), 0);
    while let Some((start, group_end, value, end)) = snipped_tag(text, copied) {
        out.extend_from_slice(&text[copied..start]);
        out.extend_from_slice(&text[start..group_end]);
        out.push(b'>');
        let content = (std::str::from_utf8(value).ok())
            .and_then(|it| it.parse::<usize>().ok())
            .and_then(|index| contents.get(index));
        out.extend_from_slice(content.map_or(&b""[..], |it| &it[..]));
        copied = end;
    }
    if copied == 0 {
        return Cow::Borrowed(text);
    }
    out.extend_from_slice(&text[copied..]);
    Cow::Owned(out)
}
