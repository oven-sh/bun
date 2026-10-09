//! `@param` tags are put in the order of the parameters of the function behind the comment.

use super::parser::Tag;
use super::text::trim_start;

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// `after`: the text behind the comment. Only if every `@param` has a type and a name, and the names are those
/// of the parameters.
pub(super) fn reorder_param_tags(effective_tags: &mut [(&Tag<'_>, &[u8])], after: &[u8]) {
    let Some(param_start) = effective_tags
        .iter()
        .position(|(_, kind)| *kind == b"param")
    else {
        return;
    };
    let param_end = effective_tags[param_start..]
        .iter()
        .position(|(_, kind)| *kind != b"param")
        .map_or(effective_tags.len(), |at| param_start + at);
    if param_end - param_start < 2 {
        return;
    }
    let mut names: Vec<&[u8]> = Vec::with_capacity(param_end - param_start);
    for (tag, _) in &effective_tags[param_start..param_end] {
        match tag.type_name_comment() {
            (Some(_), Some(name), _) => names.push(name.parsed()),
            _ => return,
        }
    }
    let function_params = extract_function_params(after);
    if function_params.len() != names.len()
        || names == function_params
        || !names.iter().all(|name| function_params.contains(name))
    {
        return;
    }
    crate::sort::sort_by_key(&mut effective_tags[param_start..param_end], |(tag, _)| {
        let name = tag
            .type_name_comment()
            .1
            .map_or(&b""[..], |name| name.parsed());
        function_params
            .iter()
            .position(|param| *param == name)
            .unwrap_or(usize::MAX)
    });
}

fn extract_function_params(after: &[u8]) -> Vec<&[u8]> {
    let trimmed = trim_start(after);
    let Some(paren_start) = find_function_params_start(trimmed) else {
        return Vec::new();
    };
    match find_matching_paren(trimmed, paren_start) {
        Some(paren_end) => parse_param_names(&trimmed[paren_start + 1..paren_end]),
        None => Vec::new(),
    }
}

fn skip_whitespace(bytes: &[u8], i: &mut usize) {
    while bytes.get(*i).is_some_and(u8::is_ascii_whitespace) {
        *i += 1;
    }
}

fn skip_identifier(bytes: &[u8], i: &mut usize) {
    while bytes.get(*i).is_some_and(|&byte| is_identifier_byte(byte)) {
        *i += 1;
    }
}

/// Passes `<T>`.
fn skip_generics(bytes: &[u8], i: &mut usize) {
    if bytes.get(*i) == Some(&b'<')
        && let Some(end) = find_matching_angle(bytes, *i)
    {
        *i = end + 1;
    }
}

/// Whether the word `keyword` is at `i`, with something behind it.
fn is_keyword_at(bytes: &[u8], i: usize, keyword: &[u8]) -> bool {
    bytes[i..].starts_with(keyword)
        && bytes
            .get(i + keyword.len())
            .is_some_and(|&next| !is_identifier_byte(next))
}

/// Where the `(` of the parameters is, if `text` starts with something like a function.
fn find_function_params_start(text: &[u8]) -> Option<usize> {
    let mut i = 0;
    loop {
        skip_whitespace(text, &mut i);
        match [&b"export"[..], b"async", b"default"]
            .iter()
            .find(|keyword| is_keyword_at(text, i, keyword))
        {
            Some(keyword) => i += keyword.len(),
            None => break,
        }
    }
    let is_paren = |i: usize| (text.get(i) == Some(&b'(')).then_some(i);
    // `function name(`
    if text[i..].starts_with(b"function") {
        i += 8;
        skip_whitespace(text, &mut i);
        if text.get(i) == Some(&b'*') {
            i += 1;
        }
        skip_whitespace(text, &mut i);
        skip_identifier(text, &mut i);
        skip_generics(text, &mut i);
        skip_whitespace(text, &mut i);
        return is_paren(i);
    }
    // `const name = (` or `name(`
    if !text
        .get(i)
        .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_' || *byte == b'$')
    {
        return None;
    }
    if [&b"const "[..], b"let ", b"var "]
        .iter()
        .any(|keyword| text[i..].starts_with(keyword))
    {
        while text.get(i).is_some_and(|byte| !byte.is_ascii_whitespace()) {
            i += 1;
        }
        skip_whitespace(text, &mut i);
    }
    let identifier_start = i;
    skip_identifier(text, &mut i);
    if i == identifier_start {
        return None;
    }
    skip_whitespace(text, &mut i);
    skip_generics(text, &mut i);
    skip_whitespace(text, &mut i);
    if text.get(i) == Some(&b'(') {
        return Some(i);
    }
    if text.get(i) == Some(&b'=') && text.get(i + 1).is_some_and(|&next| next != b'=') {
        i += 1;
        skip_whitespace(text, &mut i);
        if is_keyword_at(text, i, b"async") {
            i += 5;
            skip_whitespace(text, &mut i);
        }
        return is_paren(i);
    }
    None
}

/// Passes the string that starts at `i`, up to its closing quote.
fn skip_string(bytes: &[u8], i: &mut usize) {
    let quote = bytes[*i];
    *i += 1;
    while bytes.get(*i).is_some_and(|&byte| byte != quote) {
        *i += if bytes[*i] == b'\\' { 2 } else { 1 };
    }
}

/// Goes on to the next comma that is not in parentheses, angle brackets or a string.
fn skip_to_comma(bytes: &[u8], i: &mut usize) {
    while let Some(&byte) = bytes.get(*i).filter(|&&byte| byte != b',') {
        match byte {
            b'(' => *i = find_matching_paren(bytes, *i).unwrap_or(*i) + 1,
            b'<' => *i = find_matching_angle(bytes, *i).unwrap_or(*i) + 1,
            b'\'' | b'"' | b'`' => {
                skip_string(bytes, i);
                if *i < bytes.len() {
                    *i += 1;
                }
            }
            _ => *i += 1,
        }
    }
}

fn find_matching_angle(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (i, &byte) in bytes.iter().enumerate().skip(start) {
        match byte {
            b'<' => depth += 1,
            b'>' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn find_matching_paren(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = start;
    while let Some(&byte) = bytes.get(i) {
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            b'\'' | b'"' | b'`' => skip_string(bytes, &mut i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// The names of the parameters in `params`. A pattern has none.
fn parse_param_names(params: &[u8]) -> Vec<&[u8]> {
    let mut names = Vec::new();
    let len = params.len();
    let mut i = 0;
    loop {
        skip_whitespace(params, &mut i);
        if i >= len {
            return names;
        }
        if params[i] == b'{' || params[i] == b'[' {
            let (open, close) = if params[i] == b'{' {
                (b'{', b'}')
            } else {
                (b'[', b']')
            };
            let mut depth = 0i32;
            while i < len {
                depth += i32::from(params[i] == open) - i32::from(params[i] == close);
                i += 1;
                if depth == 0 {
                    break;
                }
            }
        } else {
            if params[i..].starts_with(b"...") {
                i += 3;
            }
            let name_start = i;
            skip_identifier(params, &mut i);
            if i > name_start {
                names.push(&params[name_start..i]);
            }
        }
        skip_to_comma(params, &mut i);
        if i < len {
            i += 1;
        }
    }
}
