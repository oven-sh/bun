//! `ConfigCommentParser` of `@eslint/plugin-kit`: how the text of a directive comment is read.

use super::space::{char_len, space_len, space_len_back, trim};
use super::{json_v8, levn};
use crate::options::Json;
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};

/// A list of fewer names than this is searched as it is.
const FEW: usize = 16;

/// `/* label value -- justification */`. All are slices of the text that was parsed.
#[derive(Copy, Clone, Debug)]
pub struct DirectiveComment<'t> {
    pub label: &'t [u8],
    pub value: &'t [u8],
    pub justification: &'t [u8],
}

/// Where the first `\s-{2,}\s` starts and ends.
fn find_justification_separator(text: &[u8]) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], b"--") {
        let dashes = from + found;
        let after = dashes + text[dashes..].iter().take_while(|b| **b == b'-').count();
        let (before, following) = (space_len_back(&text[..dashes]), space_len(&text[after..]));
        if before > 0 && following > 0 {
            return Some((dashes - before, after + following));
        }
        from = after;
    }
    None
}

/// `parseDirective`. `text`: the comment without its delimiters.
pub fn parse_directive(text: &[u8]) -> Option<DirectiveComment<'_>> {
    let (directive, justification) = match find_justification_separator(text) {
        Some((start, end)) => (trim(&text[..start]), trim(&text[end..])),
        None => (trim(text), &text[text.len()..]),
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
            Some(_) if space_len(&directive[end..]) == 0 => return None,
            _ => break,
        }
    }
    Some(DirectiveComment {
        label: &directive[..end],
        value: trim(&directive[end..]),
        justification,
    })
}

/// `parseListConfig`: the distinct names of a list that is separated by commas, in order.
pub fn parse_list_config(text: &[u8]) -> Vec<&[u8]> {
    let mut names: Vec<&[u8]> = Vec::new();
    // All of them, once there are many.
    let mut seen: FxHashSet<&[u8]> = FxHashSet::default();
    for name in strings::split(text, b",") {
        let name = match trim(name) {
            [b'\'', inner @ .., b'\''] | [b'"', inner @ .., b'"'] => inner,
            name => name,
        };
        if name.is_empty() {
            continue;
        }
        let is_new = match names.len() {
            0..FEW => !names.contains(&name),
            len => {
                if len == FEW {
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

/// `parseStringConfig`: `name` or `name:value`, separated by commas or white space. The last value
/// of a name counts.
pub fn parse_string_config(text: &[u8]) -> Vec<(Vec<u8>, Option<Vec<u8>>)> {
    let text = trim(text);
    // `.replace(/(?<!\s)\s*([:,])\s*/gu, "$1")`
    let skip_space = |mut at: usize| {
        while space_len(&text[at..]) > 0 {
            at += space_len(&text[at..]);
        }
        at
    };
    let mut collapsed = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if space_len_back(&text[..at]) == 0 {
            let mark = skip_space(at);
            if let Some(&byte @ (b':' | b',')) = text.get(mark) {
                collapsed.push(byte);
                at = skip_space(mark + 1);
                continue;
            }
        }
        let len = char_len(&text[at..]);
        collapsed.extend_from_slice(&text[at..at + len]);
        at += len;
    }
    // `.split(/\s|,+/u)`
    let mut items: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::new();
    // Where each is in `items`, once there are many.
    let mut places: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
    let mut at = 0;
    while at < collapsed.len() {
        let start = at;
        while at < collapsed.len() && collapsed[at] != b',' && space_len(&collapsed[at..]) == 0 {
            at += 1;
        }
        let name = &collapsed[start..at];
        at += space_len(&collapsed[at..]).max(1);
        if name.is_empty() {
            continue;
        }
        let mut parts = strings::split(name, b":");
        let key = parts.next().unwrap_or_default();
        let value = parts.next().map(<[u8]>::to_vec);
        if items.len() == FEW && places.is_empty() {
            places.extend(items.iter().enumerate().map(|(i, it)| (it.0.clone(), i)));
        }
        let place = match items.len() {
            0..FEW => items.iter().position(|it| it.0 == key),
            _ => places.get(key).copied(),
        };
        match place.and_then(|it| items.get_mut(it)) {
            Some(item) => item.1 = value,
            None => {
                if items.len() >= FEW {
                    places.insert(key.to_vec(), items.len());
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

/// What ESLint makes of a comment without commas before it gives it to `JSON.parse`.
fn normalize_for_json(text: &[u8]) -> Vec<u8> {
    // `.replace(/(?<![-a-zA-Z0-9/])([-a-zA-Z0-9/]+):/gu, '"$1":')`
    let mut quoted = Vec::with_capacity(text.len() + 16);
    let mut at = 0;
    while at < text.len() {
        let run = text[at..].iter().take_while(|b| is_name_byte(**b)).count();
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
            while space_len(&quoted[end..]) > 0 {
                end += space_len(&quoted[end..]);
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

/// `parseJSONLikeConfig`. `Err`: the message.
pub fn parse_json_like_config(text: &[u8]) -> Result<Vec<(Vec<u8>, Json)>, Vec<u8>> {
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
        Ok(Json::Object(items)) => Ok(items),
        Ok(_) => Ok(Vec::new()),
        Err(error) => {
            let mut message = b"Failed to parse JSON from '".to_vec();
            message.extend_from_slice(&normalized);
            message.extend_from_slice(b"': ");
            message.extend_from_slice(&error);
            Err(message)
        }
    }
}
