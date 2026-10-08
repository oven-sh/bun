//! The names of tags, emphasis, capital letters, and types.

use super::text::{first_char, last_char, lines, parse_index, push_number, trim, trim_end, trim_start};
use crate::options::QuoteStyle;
use bun_core::strings;
use std::borrow::Cow;

type Bytes<'a> = Cow<'a, [u8]>;

/// The name that stands for all the names of a tag: `TAGS_SYNONYMS` of prettier-plugin-jsdoc.
pub(super) fn normalize_tag_kind(kind: &[u8]) -> &[u8] {
    match kind {
        b"return" => b"returns",
        b"arg" | b"argument" | b"params" => b"param",
        b"yield" => b"yields",
        b"prop" => b"property",
        b"constructor" => b"class",
        b"const" => b"constant",
        b"desc" => b"description",
        b"host" => b"external",
        b"fileoverview" | b"overview" => b"file",
        b"emits" => b"fires",
        b"func" | b"method" => b"function",
        b"var" => b"member",
        b"virtual" => b"abstract",
        b"exception" => b"throws",
        b"examples" => b"example",
        b"hidden" => b"ignore",
        _ => kind,
    }
}

/// Where the `*` is that closes the emphasis that the `*` at `opener` opens.
fn find_emphasis_end(bytes: &[u8], opener: usize) -> Option<usize> {
    let len = bytes.len();
    let mut j = opener + 1;
    while j < len {
        if bytes[j] == b'`' {
            // Code.
            j += 1;
            while j < len && bytes[j] != b'`' {
                j += 1;
            }
            if j < len {
                j += 1;
            }
            continue;
        }
        if bytes[j] == b'*' && bytes.get(j + 1) == Some(&b'*') {
            j += 2;
            continue;
        }
        if bytes[j] == b'*' && j > opener + 1 && !bytes[j - 1].is_ascii_whitespace() {
            return Some(j);
        }
        j += 1;
    }
    None
}

/// `__text__` becomes `**text**`, `*text*` becomes `_text_`.
pub(super) fn normalize_markdown_emphasis(text: &[u8]) -> Bytes<'_> {
    if !strings::contains(text, b"__") && !strings::contains_char(text, b'*') {
        return Cow::Borrowed(text);
    }
    let mut bytes = text.to_vec();
    let len = bytes.len();
    let mut has_changed = false;
    let mut in_code = false;
    let mut i = 0;
    while i < len {
        if bytes[i] == b'`' {
            in_code = !in_code;
        } else if !in_code && bytes[i] == b'_' && bytes.get(i + 1) == Some(&b'_') {
            bytes[i] = b'*';
            bytes[i + 1] = b'*';
            has_changed = true;
            i += 1;
        }
        i += 1;
    }
    in_code = false;
    i = 0;
    while i < len {
        if bytes[i] == b'`' {
            in_code = !in_code;
            i += 1;
            continue;
        }
        if in_code || bytes[i] != b'*' {
            i += 1;
            continue;
        }
        if bytes.get(i + 1) == Some(&b'*') {
            i += 2;
            continue;
        }
        // It opens emphasis if something other than white space follows it.
        if bytes.get(i + 1).is_some_and(|next| !next.is_ascii_whitespace())
            && let Some(closer) = find_emphasis_end(&bytes, i)
        {
            bytes[i] = b'_';
            bytes[closer] = b'_';
            has_changed = true;
            i = closer;
        }
        i += 1;
    }
    if has_changed { Cow::Owned(bytes) } else { Cow::Borrowed(text) }
}

/// Makes the first letter a capital one, if it is an ASCII letter. Not that of code or of a URL. What comes
/// after any number of `- ` counts as the start.
pub(super) fn capitalize_first(text: &[u8]) -> Bytes<'_> {
    let starts_with = |prefix: &[u8]| text.get(..prefix.len()).is_some_and(|start| start.eq_ignore_ascii_case(prefix));
    if text.is_empty() || text.starts_with(b"`") || starts_with(b"http://") || starts_with(b"https://") {
        return Cow::Borrowed(text);
    }
    let mut remaining = text;
    while let Some(rest) = remaining.strip_prefix(b"- ") {
        remaining = rest;
    }
    let prefix_len = text.len() - remaining.len();
    if prefix_len > 0 {
        return match capitalize_first(remaining) {
            Cow::Borrowed(_) => Cow::Borrowed(text),
            Cow::Owned(capitalized) => Cow::Owned([&text[..prefix_len], &capitalized].concat()),
        };
    }
    match text.first() {
        Some(first) if first.is_ascii_lowercase() => {
            let mut result = text.to_vec();
            result[0] = first.to_ascii_uppercase();
            Cow::Owned(result)
        }
        _ => Cow::Borrowed(text),
    }
}

/// `text.replace(/([\w\p{L}])$/u, "$1.")`
pub(super) fn append_trailing_dot(text: &[u8]) -> Bytes<'_> {
    match last_char(text) {
        Some((last, _)) if last.is_alphabetic() || last.is_ascii_digit() || last == '_' => Cow::Owned([text, b"."].concat()),
        _ => Cow::Borrowed(text),
    }
}

/// A type over several lines, without the `*` at the start of each, with `separator` in the place of the
/// line breaks.
fn strip_stars(text: &[u8], separator: u8) -> Vec<u8> {
    let mut result = Vec::with_capacity(text.len());
    for (index, line) in lines(text).enumerate() {
        if index == 0 {
            result.extend_from_slice(line);
            continue;
        }
        result.push(separator);
        let trimmed = trim_start(line);
        result.extend_from_slice(match trimmed.strip_prefix(b"*") {
            Some(rest) => rest.strip_prefix(b" ").unwrap_or(rest),
            None => trimmed,
        });
    }
    result
}

pub(super) fn strip_jsdoc_stars_preserve_newlines(text: &[u8]) -> Vec<u8> {
    match strings::contains_char(text, b'\n') {
        true => strip_stars(text, b'\n'),
        false => text.to_vec(),
    }
}

/// `convertToModernType` of prettier-plugin-jsdoc: `?Type` and `Type?` become `Type | null`, `*` becomes
/// `any`, `Array<T>` becomes `T[]`, `Foo.<T>` becomes `Foo<T>`, and the quotes in `import()` are those of
/// `quote_style`.
pub(super) fn normalize_type(type_str: &[u8], quote_style: QuoteStyle) -> Bytes<'_> {
    normalize_type_impl(type_str, Some(quote_style))
}

/// The same with the quotes as they are, for `@type`, `@typedef` and `@satisfies`.
pub(super) fn normalize_type_preserve_quotes(type_str: &[u8]) -> Bytes<'_> {
    normalize_type_impl(type_str, None)
}

fn normalize_type_impl(type_str: &[u8], quote_style: Option<QuoteStyle>) -> Bytes<'_> {
    if strings::contains_char(type_str, b'\n') {
        let stripped = strip_stars(type_str, b' ');
        return Cow::Owned(normalize_type_impl(&stripped, quote_style).into_owned());
    }
    let trimmed = trim(type_str);
    if is_already_normalized(trimmed) {
        return Cow::Borrowed(trimmed);
    }
    let transformed = without_strings(type_str, normalize_type_inner);
    let unquoted = match quote_style {
        Some(quote_style) => {
            let quoted = normalize_type_quotes(&transformed, quote_style);
            unquote_object_property_names(&quoted).into_owned()
        }
        None => transformed,
    };
    Cow::Owned(fix_object_commas(&unquoted).into_owned())
}

/// `withoutStrings`: `transform` sees `String$N$` in the place of each string.
fn without_strings(type_str: &[u8], transform: impl FnOnce(&[u8]) -> Vec<u8>) -> Vec<u8> {
    if strings::index_of_any(type_str, b"'\"").is_none() {
        // A template literal type is left alone.
        return match strings::contains_char(type_str, b'`') {
            true => type_str.to_vec(),
            false => transform(type_str),
        };
    }
    let mut originals: Vec<&[u8]> = Vec::new();
    let mut modified = Vec::with_capacity(type_str.len());
    let len = type_str.len();
    let mut i = 0;
    while i < len {
        let quote = type_str[i];
        if quote != b'"' && quote != b'\'' {
            modified.push(quote);
            i += 1;
            continue;
        }
        let start = i;
        i += 1;
        while i < len {
            if type_str[i] == b'\\' {
                i += if i + 1 < len { 2 } else { 1 };
                continue;
            }
            i += 1;
            if type_str[i - 1] == quote {
                break;
            }
        }
        modified.extend_from_slice(b"String$");
        push_number(&mut modified, originals.len());
        modified.push(b'$');
        originals.push(&type_str[start..i.min(len)]);
    }
    if strings::contains_char(&modified, b'`') {
        return type_str.to_vec();
    }
    let result = transform(&modified);

    // The strings come back.
    const PREFIX: &[u8] = b"String$";
    let mut restored = Vec::with_capacity(result.len());
    let mut rest = &result[..];
    while let Some(at) = strings::index_of(rest, PREFIX) {
        let after = &rest[at + PREFIX.len()..];
        let digits = after.iter().take_while(|byte| byte.is_ascii_digit()).count();
        let original = (digits > 0 && after.get(digits) == Some(&b'$'))
            .then(|| parse_index(&after[..digits]).and_then(|index| originals.get(index)))
            .flatten();
        match original {
            Some(original) => {
                restored.extend_from_slice(&rest[..at]);
                restored.extend_from_slice(original);
                rest = &after[digits + 1..];
            }
            None => {
                restored.extend_from_slice(&rest[..at + 1]);
                rest = &rest[at + 1..];
            }
        }
    }
    restored.extend_from_slice(rest);
    restored
}

fn normalize_type_inner(type_str: &[u8]) -> Vec<u8> {
    let replaced: Bytes<'_> = match strings::contains_char(type_str, b'*') {
        true => Cow::Owned(strings::replace_owned(type_str, b"*", b" any ")),
        false => Cow::Borrowed(type_str),
    };
    let trimmed = trim(&replaced);
    if (trimmed.starts_with(b"\"") && trimmed.ends_with(b"\"")) || (trimmed.starts_with(b"'") && trimmed.ends_with(b"'")) {
        return trimmed.to_vec();
    }
    // `... type`
    if let Some(stripped) = trimmed.strip_prefix(b"...") {
        let rest = trim_start(stripped);
        if rest.is_empty() {
            return trimmed.to_vec();
        }
        let normalized = normalize_type_inner(rest);
        return match needs_parens_for_union(&normalized) {
            true => [b"...(", &normalized[..], b")"].concat(),
            false => [b"...", &normalized[..]].concat(),
        };
    }
    // `?Type`
    if let Some(rest) = trimmed.strip_prefix(b"?") {
        let inner = trim(rest);
        if !inner.is_empty() {
            return [&normalize_type_core(inner)[..], b" | null"].concat();
        }
    }
    // `Type?`
    if let Some(inner) = trimmed.strip_suffix(b"?")
        && !contains_quotes(trimmed)
        && !inner.is_empty()
        && !strings::contains_char(inner, b'?')
    {
        return [&normalize_type_core(inner)[..], b" | null"].concat();
    }
    normalize_type_core(trimmed)
}

/// Arrays, the dots before `<`, white space. Each member of a union by itself.
fn normalize_type_core(type_str: &[u8]) -> Vec<u8> {
    let trimmed = trim(type_str);
    let parts = split_at_top_level_pipe(trimmed);
    if parts.len() > 1 {
        let normalized: Vec<Vec<u8>> = parts.iter().map(|part| normalize_type_core(trim(part))).collect();
        return normalized.join(&b" | "[..]);
    }
    let mut converted = remove_closure_dot_generics(trimmed).into_owned();
    while let Some(next) = replace_one_array_pattern(&converted) {
        converted = next;
    }
    normalize_type_whitespace(&converted).into_owned()
}

/// Makes `T[]` of one `Array<T>` in `type_str`. `None` if there is none.
fn replace_one_array_pattern(type_str: &[u8]) -> Option<Vec<u8>> {
    let mut search_start = 0;
    while let Some(found) = strings::index_of(&type_str[search_start..], b"Array") {
        let pos = search_start + found;
        search_start = pos + 5;
        if pos > 0 {
            let prev = type_str[pos - 1];
            if prev.is_ascii_alphanumeric() || prev == b'_' || prev == b'$' || prev > 0x7F {
                continue;
            }
        }
        let after_array = &type_str[pos + 5..];
        let inner_start = if after_array.starts_with(b".<") {
            pos + 7
        } else if after_array.starts_with(b"<") {
            pos + 6
        } else {
            continue;
        };
        let Some(end_offset) = find_matching_close_angle(&type_str[inner_start..]) else {
            continue;
        };
        let inner = normalize_type_inner(&type_str[inner_start..inner_start + end_offset]);
        let after = &type_str[inner_start + end_offset + 1..];
        return Some(match needs_parens_for_array(&inner) {
            true => [&type_str[..pos], b"(", &inner, b")[]", after].concat(),
            false => [&type_str[..pos], &inner, b"[]", after].concat(),
        });
    }
    None
}

/// Where the `>` is that closes the `<` before `text`.
fn find_matching_close_angle(text: &[u8]) -> Option<usize> {
    let mut depth = 1i32;
    for (i, &byte) in text.iter().enumerate() {
        match byte {
            b'<' => depth += 1,
            // Not that of `=>`.
            b'>' if i == 0 || text[i - 1] != b'=' => {
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

/// The parts of `type_str` between the `|` that are not in brackets of any kind.
fn split_at_top_level_pipe(type_str: &[u8]) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (i, &byte) in type_str.iter().enumerate() {
        match byte {
            b'(' | b'<' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'>' if i == 0 || type_str[i - 1] != b'=' => depth -= 1,
            b'|' if depth == 0 => {
                parts.push(&type_str[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&type_str[start..]);
    parts
}

/// Whether `trimmed` ends with the `=` of Closure's optional types.
fn has_optional_suffix(trimmed: &[u8]) -> bool {
    trimmed.ends_with(b"=") && !contains_quotes(trimmed)
}

/// For `@returns`, `@yields` and `@throws`: `type=` is `type | undefined`.
pub(super) fn normalize_type_return(type_str: &[u8], quote_style: QuoteStyle) -> Bytes<'_> {
    let trimmed = trim(type_str);
    if has_optional_suffix(trimmed) && trimmed.len() > 1 {
        let normalized = normalize_type(&trimmed[..trimmed.len() - 1], quote_style);
        return Cow::Owned([&normalized[..], b" | undefined"].concat());
    }
    normalize_type(trimmed, quote_style)
}

/// The type without the `=` at its end, and whether there is one.
pub(super) fn strip_optional_type_suffix(type_str: &[u8]) -> (&[u8], bool) {
    let trimmed = trim(type_str);
    if has_optional_suffix(trimmed) {
        let inner = trim_end(&trimmed[..trimmed.len() - 1]);
        if !inner.is_empty() {
            return (inner, true);
        }
    }
    (trimmed, false)
}

fn needs_parens_for_array(type_str: &[u8]) -> bool {
    if type_str.starts_with(b"(") && type_str.ends_with(b")") {
        return false;
    }
    needs_parens_for_union(type_str) || contains_top_level_arrow(type_str)
}

fn contains_top_level_arrow(type_str: &[u8]) -> bool {
    let mut depth = 0i32;
    let mut prev = 0u8;
    for (i, &byte) in type_str.iter().enumerate() {
        match byte {
            b'(' | b'<' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'>' if prev != b'=' => depth -= 1,
            b'=' if depth == 0 && type_str.get(i + 1) == Some(&b'>') => return true,
            _ => {}
        }
        prev = byte;
    }
    false
}

fn needs_parens_for_union(type_str: &[u8]) -> bool {
    if type_str.starts_with(b"(") && type_str.ends_with(b")") {
        return false;
    }
    let mut depth = 0i32;
    let mut prev = 0u8;
    for &byte in type_str {
        match byte {
            b'(' | b'<' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'>' if prev != b'=' => depth -= 1,
            b'|' if depth == 0 => return true,
            _ => {}
        }
        prev = byte;
    }
    false
}

/// `Object.<String, Number>` becomes `Object<String, Number>`.
fn remove_closure_dot_generics(type_str: &[u8]) -> Bytes<'_> {
    if !strings::contains(type_str, b".<") {
        return Cow::Borrowed(type_str);
    }
    let mut result = Vec::with_capacity(type_str.len());
    let mut quote = None;
    for (i, &byte) in type_str.iter().enumerate() {
        match quote {
            Some(open) => {
                if byte == open {
                    quote = None;
                }
            }
            None if byte == b'"' || byte == b'\'' => quote = Some(byte),
            None if byte == b'.' && type_str.get(i + 1) == Some(&b'<') => continue,
            None => {}
        }
        result.push(byte);
    }
    Cow::Owned(result)
}

fn contains_quotes(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\"'").is_some()
}

/// The quotes of the paths in `import()` become those of `quote_style`. No others do.
fn normalize_type_quotes(type_str: &[u8], quote_style: QuoteStyle) -> Bytes<'_> {
    let (source_quote, target_quote) = match quote_style {
        QuoteStyle::Double => (b'\'', b'"'),
        QuoteStyle::Single => (b'"', b'\''),
    };
    if !strings::contains_char(type_str, source_quote) {
        return Cow::Borrowed(type_str);
    }
    let mut result = Vec::with_capacity(type_str.len());
    let len = type_str.len();
    let mut i = 0;
    while i < len {
        if !type_str[i..].starts_with(b"import(") {
            result.push(type_str[i]);
            i += 1;
            continue;
        }
        result.extend_from_slice(b"import(");
        i += 7;
        while i < len && type_str[i] == b' ' {
            result.push(b' ');
            i += 1;
        }
        if i >= len || type_str[i] != source_quote {
            continue;
        }
        result.push(target_quote);
        i += 1;
        while i < len && type_str[i] != source_quote {
            if type_str[i] == b'\\' && i + 1 < len {
                if type_str[i + 1] == source_quote {
                    result.push(source_quote);
                    i += 2;
                } else {
                    // The backslash and the character after it.
                    let char_len = first_char(&type_str[i + 1..]).map_or(1, |(_, len)| len);
                    result.extend_from_slice(&type_str[i..i + 1 + char_len]);
                    i += 1 + char_len;
                }
            } else if type_str[i] == target_quote {
                result.extend_from_slice(&[b'\\', target_quote]);
                i += 1;
            } else {
                result.push(type_str[i]);
                i += 1;
            }
        }
        if i < len {
            result.push(target_quote);
            i += 1;
        }
    }
    Cow::Owned(result)
}

fn is_valid_js_identifier(text: &[u8]) -> bool {
    let is_start = |byte: &u8| byte.is_ascii_alphabetic() || *byte == b'_' || *byte == b'$';
    text.first().is_some_and(is_start) && text.iter().all(|byte| is_start(byte) || byte.is_ascii_digit())
}

/// `"userId": string` becomes `userId: string`.
fn unquote_object_property_names(type_str: &[u8]) -> Bytes<'_> {
    if !strings::contains_char(type_str, b'"') {
        return Cow::Borrowed(type_str);
    }
    let len = type_str.len();
    let mut result = Vec::with_capacity(len);
    let mut i = 0;
    while i < len {
        if type_str[i] != b'"' {
            result.push(type_str[i]);
            i += 1;
            continue;
        }
        let start = i + 1;
        i += 1;
        let mut end = None;
        while i < len {
            if type_str[i] == b'\\' && i + 1 < len {
                i += 2;
                continue;
            }
            i += 1;
            if type_str[i - 1] == b'"' {
                end = Some(i - 1);
                break;
            }
        }
        let Some(end) = end else {
            result.push(b'"');
            result.extend_from_slice(&type_str[start..]);
            continue;
        };
        let content = &type_str[start..end];
        if trim_start(&type_str[i..]).starts_with(b":") && is_valid_js_identifier(content) {
            result.extend_from_slice(content);
        } else {
            result.extend_from_slice(&type_str[start - 1..=end]);
        }
    }
    Cow::Owned(result)
}

/// `fixObjectCommas`: in the type of an object, `; x` becomes `, x`.
fn fix_object_commas(type_str: &[u8]) -> Bytes<'_> {
    let trimmed = trim(type_str);
    if !trimmed.starts_with(b"{")
        || !trimmed.ends_with(b"}")
        || trimmed.len() < 2
        || !strings::contains_char(&trimmed[1..trimmed.len() - 1], b':')
        || !strings::contains(trimmed, b"; ")
    {
        return Cow::Borrowed(type_str);
    }
    let mut result = trimmed.to_vec();
    for i in 0..result.len().saturating_sub(2) {
        if result[i] == b';' && result[i + 1] == b' ' && (result[i + 2].is_ascii_alphanumeric() || result[i + 2] == b'_') {
            result[i] = b',';
        }
    }
    Cow::Owned(result)
}

/// One space in the place of any white space, and spaces around `|`, `&` and `=>`.
pub(super) fn normalize_type_whitespace(type_str: &[u8]) -> Bytes<'_> {
    let trimmed = trim(type_str);
    let len = trimmed.len();
    let mut result = Vec::with_capacity(len + 8);
    let mut prev_was_space = false;
    let mut i = 0;
    while i < len {
        let byte = trimmed[i];
        // A comment stays as it is, up to the end of its line.
        if byte == b'/' && trimmed.get(i + 1) == Some(&b'/') {
            let end = strings::index_of_char_usize(&trimmed[i..], b'\n').map_or(len, |at| i + at + 1);
            result.extend_from_slice(&trimmed[i..end]);
            i = end;
            prev_was_space = false;
            continue;
        }
        let operator_len = match byte {
            b'=' if trimmed.get(i + 1) == Some(&b'>') => 2,
            b'|' | b'&' => 1,
            _ => 0,
        };
        if operator_len > 0 {
            if !prev_was_space && !result.is_empty() {
                result.push(b' ');
            }
            result.extend_from_slice(&trimmed[i..i + operator_len]);
            i += operator_len;
            prev_was_space = trimmed.get(i).is_some_and(|next| !next.is_ascii_whitespace());
            if prev_was_space {
                result.push(b' ');
            }
            continue;
        }
        let (char, char_len) = first_char(&trimmed[i..]).unwrap_or((' ', 1));
        if if byte < 128 { byte.is_ascii_whitespace() } else { char.is_whitespace() } {
            if !prev_was_space {
                result.push(b' ');
                prev_was_space = true;
            }
        } else {
            result.extend_from_slice(&trimmed[i..i + char_len]);
            prev_was_space = false;
        }
        i += char_len;
    }
    if result == trimmed { Cow::Borrowed(trimmed) } else { Cow::Owned(result) }
}

/// Whether nothing in `text` is something that `normalize_type` changes.
fn is_already_normalized(text: &[u8]) -> bool {
    !text.is_empty()
        && strings::index_of_any(text, b"?'\"{}*=&|!\n").is_none()
        && !strings::contains(text, b"Array<")
        && !strings::contains(text, b"Array.<")
        && !text.starts_with(b"...")
        && !strings::contains(text, b"  ")
}
