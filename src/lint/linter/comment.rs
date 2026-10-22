//! `ConfigCommentParser` from `@eslint/plugin-kit`: parses the text of a directive comment.

use super::{json_v8, levn};
use crate::options::Json;
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};

/// A list with fewer names than this gets a linear search.
const LINEAR_SEARCH_MAX: usize = 16;

/// `/* label value -- justification */`. All are slices of the text that was parsed.
#[derive(Copy, Clone, Debug)]
pub(crate) struct DirectiveComment<'t> {
    pub(crate) label: &'t [u8],
    pub(crate) value: &'t [u8],
    pub(crate) justification: &'t [u8],
}

/// The definition of whitespace in a directive comment. oxlint is written in Rust, whose `char::is_whitespace` includes
/// U+0085 but not U+FEFF.
#[derive(Copy, Clone)]
pub(crate) enum Space {
    /// The characters that `\s` matches.
    Js,
    /// The `White_Space` property.
    Unicode,
}

impl Space {
    fn trim_start(self, text: &[u8]) -> &[u8] {
        match self {
            Space::Js => strings::trim_js_whitespace_start(text),
            Space::Unicode => strings::trim_unicode_whitespace_start(text),
        }
    }

    fn trim_end(self, text: &[u8]) -> &[u8] {
        match self {
            Space::Js => strings::trim_js_whitespace_end(text),
            Space::Unicode => strings::trim_unicode_whitespace_end(text),
        }
    }

    fn trim(self, text: &[u8]) -> &[u8] {
        self.trim_end(self.trim_start(text))
    }
}

/// The start and end of the dashes in the first `\s-{2,}\s`.
fn find_justification_separator(text: &[u8], space: Space) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], b"--") {
        let dashes = from + found;
        let after = dashes + text[dashes..].iter().take_while(|b| **b == b'-').count();
        let (before, following) = (&text[..dashes], &text[after..]);
        if space.trim_end(before).len() < before.len()
            && space.trim_start(following).len() < following.len()
        {
            return Some((dashes, after));
        }
        from = after;
    }
    None
}

/// `parseDirective`. `text` is the comment without its delimiters.
pub(crate) fn parse_directive(text: &[u8], space: Space) -> Option<DirectiveComment<'_>> {
    let (directive, justification) = match find_justification_separator(text, space) {
        Some((start, end)) => (space.trim(&text[..start]), space.trim(&text[end..])),
        None => (space.trim(text), &text[text.len()..]),
    };
    // `^([a-z]+(?:-[a-z]+)*)(?:\s|$)`
    let mut end = 0;
    loop {
        let word = directive[end..]
            .iter()
            .take_while(|b| b.is_ascii_lowercase())
            .count();
        if word == 0 {
            return None;
        }
        end += word;
        match directive.get(end) {
            Some(b'-') => end += 1,
            Some(_) if space.trim_start(&directive[end..]).len() == directive.len() - end => {
                return None;
            }
            _ => break,
        }
    }
    Some(DirectiveComment {
        label: &directive[..end],
        value: space.trim(&directive[end..]),
        justification,
    })
}

/// `parseListConfig`: the distinct names in a comma-separated list, in order.
pub(crate) fn parse_list_config(text: &[u8]) -> Vec<&[u8]> {
    let mut names: Vec<&[u8]> = Vec::new();
    // All the names, once there are many.
    let mut seen: FxHashSet<&[u8]> = FxHashSet::default();
    for name in strings::split(text, b",") {
        let name = match strings::trim_js_whitespace(name) {
            [b'\'', inner @ .., b'\''] | [b'"', inner @ .., b'"'] => inner,
            name => name,
        };
        if name.is_empty() {
            continue;
        }
        let is_new = match names.len() {
            0..LINEAR_SEARCH_MAX => !names.contains(&name),
            len => {
                if len == LINEAR_SEARCH_MAX {
                    seen.extend(&names);
                }
                seen.insert(name)
            }
        };
        if is_new {
            names.push(name);
        }
    }
    names
}

/// `parseStringConfig`: `name` or `name:value`, separated by commas or whitespace. A name's last value wins.
pub(crate) fn parse_string_config(text: &[u8]) -> Vec<(Vec<u8>, Option<Vec<u8>>)> {
    let text = strings::trim_js_whitespace(text);
    // `.replace(/(?<!\s)\s*([:,])\s*/gu, "$1")`
    let skip_space = |mut at: usize| {
        while strings::js_whitespace_len(&text[at..]) > 0 {
            at += strings::js_whitespace_len(&text[at..]);
        }
        at
    };
    let mut collapsed = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if strings::js_whitespace_len_back(&text[..at]) == 0 {
            let mark = skip_space(at);
            if let Some(&byte @ (b':' | b',')) = text.get(mark) {
                collapsed.push(byte);
                at = skip_space(mark + 1);
                continue;
            }
        }
        let len = bun_core::lexer::char_and_size(&text[at..], 0).1.max(1);
        collapsed.extend_from_slice(&text[at..at + len]);
        at += len;
    }
    // `.split(/\s|,+/u)`
    let mut items: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::new();
    // Each name's index in `items`, once there are many.
    let mut index_by_key: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
    let mut at = 0;
    while at < collapsed.len() {
        let start = at;
        while at < collapsed.len()
            && collapsed[at] != b','
            && strings::js_whitespace_len(&collapsed[at..]) == 0
        {
            at += 1;
        }
        let name = &collapsed[start..at];
        at += strings::js_whitespace_len(&collapsed[at..]).max(1);
        if name.is_empty() {
            continue;
        }
        let mut parts = strings::split(name, b":");
        let key = parts.next().unwrap_or_default();
        let value = parts.next().map(<[u8]>::to_vec);
        if items.len() == LINEAR_SEARCH_MAX && index_by_key.is_empty() {
            index_by_key.extend(items.iter().enumerate().map(|(i, it)| (it.0.clone(), i)));
        }
        let existing_index = match items.len() {
            0..LINEAR_SEARCH_MAX => items.iter().position(|it| it.0 == key),
            _ => index_by_key.get(key).copied(),
        };
        match existing_index.and_then(|it| items.get_mut(it)) {
            Some(item) => item.1 = value,
            None => {
                if items.len() >= LINEAR_SEARCH_MAX {
                    index_by_key.insert(key.to_vec(), items.len());
                }
                items.push((key.to_vec(), value));
            }
        }
    }
    items
}

fn is_valid_severity(value: &Json) -> bool {
    match value {
        Json::Number(n) => *n == 0.0 || *n == 1.0 || *n == 2.0,
        Json::String(s) => matches!(&s[..], b"off" | b"warn" | b"error"),
        _ => false,
    }
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'/')
}

/// How ESLint rewrites a comment without commas before passing it to `JSON.parse`.
fn normalize_for_json(text: &[u8]) -> Vec<u8> {
    // `.replace(/(?<![-a-zA-Z0-9/])([-a-zA-Z0-9/]+):/gu, '"$1":')`
    let mut quoted = Vec::with_capacity(text.len() + 16);
    let mut at = 0;
    while at < text.len() {
        let name_at = |at: usize| text[at..].iter().take_while(|b| is_name_byte(**b)).count();
        let mut run = name_at(at);
        // The colon in `bun:test/no-focused-tests` is part of the name, quoted or not.
        if text[at..].starts_with(b"bun:test/") && run == 3 {
            run += 1 + name_at(at + 4);
        }
        if run == 0 {
            quoted.push(text[at]);
            at += 1;
            continue;
        }
        let name = &text[at..at + run];
        at += run;
        match text.get(at) {
            Some(b':') => {
                quoted.push(b'"');
                quoted.extend_from_slice(name);
                quoted.extend_from_slice(b"\":");
                at += 1;
            }
            _ => quoted.extend_from_slice(name),
        }
    }
    // `.replace(/([\]0-9])\s+(?=")/u, "$1,")`, which replaces the first match only.
    let mut at = 0;
    while at < quoted.len() {
        if quoted[at] == b']' || quoted[at].is_ascii_digit() {
            let mut end = at + 1;
            while strings::js_whitespace_len(&quoted[end..]) > 0 {
                end += strings::js_whitespace_len(&quoted[end..]);
            }
            if end > at + 1 && quoted.get(end) == Some(&b'"') {
                quoted.splice(at + 1..end, *b",");
                break;
            }
        }
        at += 1;
    }
    quoted
}

/// `parseJSONLikeConfig`. `Err` holds the message.
pub(crate) fn parse_json_like_config(text: &[u8]) -> Result<Vec<(Vec<u8>, Json)>, Vec<u8>> {
    if let Some(items) = levn::parse_object(text) {
        let severity_of = |value: &Json| match value {
            Json::Array(items) => items.first().is_some_and(is_valid_severity),
            value => is_valid_severity(value),
        };
        if items.iter().all(|it| severity_of(&it.1)) {
            return Ok(items);
        }
    }
    let normalized = normalize_for_json(text);
    let mut wrapped = Vec::with_capacity(normalized.len() + 2);
    wrapped.push(b'{');
    wrapped.extend_from_slice(&normalized);
    wrapped.push(b'}');
    match json_v8::parse(&wrapped) {
        Ok(value) => Ok(value.into_object().unwrap_or_default()),
        Err(error) => {
            let mut message = b"Failed to parse JSON from '".to_vec();
            message.extend_from_slice(&normalized);
            message.extend_from_slice(b"': ");
            message.extend_from_slice(&error);
            Err(message)
        }
    }
}
