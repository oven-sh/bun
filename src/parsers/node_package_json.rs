//! Node's package reader validates the outer object and selected strings, not unused values.
//! https://github.com/nodejs/node/blob/v24.21.0/src/node_modules.cc#L139-L267

use std::borrow::Cow;
use std::ops::Range;

use crate::json::ParsedJson;
use crate::json_index::{FLAG_HAS_CTRL_IN_STRING, StructuralIndex};

pub const FIELDS: [&[u8]; 5] = [b"name", b"main", b"type", b"exports", b"imports"];

#[derive(Default)]
pub struct NodePackageJson {
    pub fields: [Option<Range<usize>>; 5],
    pub needs_recovery: bool,
    pub json_errors: [Option<Box<[u16]>>; 2],
}

impl NodePackageJson {
    pub fn parse(contents: &[u8]) -> crate::Result<Self> {
        let offset = if contents.starts_with(b"\xef\xbb\xbf") {
            3
        } else {
            0
        };
        let text = &contents[offset..];
        let invalid = crate::Error::SyntaxError;
        let mut index = StructuralIndex::for_node_package_json(text);
        let mut cursor = 0;
        if text.get(index.at(cursor)) != Some(&b'{') {
            return Err(invalid);
        }
        cursor += 1;
        let mut result = Self::default();
        let mut seen = 0u8;
        loop {
            let start = index.at(cursor);
            if text.get(start) == Some(&b'}') {
                cursor += 1;
                break;
            }
            if text.get(start) != Some(&b'"') {
                return Err(invalid);
            }
            let end = index.at(cursor + 1);
            if text.get(end) != Some(&b'"') || end <= start {
                return Err(invalid);
            }
            let field = FIELDS.iter().position(|key| *key == &text[start + 1..end]);
            if let Some(field) = field {
                result.needs_recovery |= seen & (1 << field) != 0;
                seen |= 1 << field;
            } else {
                result.needs_recovery |=
                    bun_core::strings::contains_char(&text[start + 1..end], b'\\');
            }
            cursor += 2;
            if text.get(index.at(cursor)) != Some(&b':') {
                return Err(invalid);
            }
            cursor += 1;
            let value_start = index.at(cursor);
            let first = *text.get(value_start).ok_or(invalid)?;
            let value_end = match first {
                b'{' | b'[' => {
                    let mut depth = 1usize;
                    cursor += 1;
                    while depth != 0 {
                        match text.get(index.at(cursor)).ok_or(invalid)? {
                            b'"' => {
                                cursor += 1;
                                if text.get(index.at(cursor)) != Some(&b'"') {
                                    return Err(invalid);
                                }
                            }
                            b'{' | b'[' => depth += 1,
                            b'}' | b']' => depth -= 1,
                            _ => {}
                        }
                        cursor += 1;
                    }
                    index.at(cursor)
                }
                b'"' => {
                    let end = index.at(cursor + 1);
                    if text.get(end) != Some(&b'"') {
                        return Err(invalid);
                    }
                    cursor += 2;
                    end + 1
                }
                b'}' | b']' | b',' | b':' => return Err(invalid),
                _ => {
                    cursor += 1;
                    let mut end = index.at(cursor);
                    while end > value_start && matches!(text[end - 1], b' ' | b'\n' | b'\r' | b'\t')
                    {
                        end -= 1;
                    }
                    end
                }
            };
            if let Some(field) = field {
                let value = &text[value_start..value_end];
                let string = (first == b'"').then(|| string_value(value)).flatten();
                let valid_string = string.is_some();
                result.needs_recovery |= field == 1 && first == b'"' && !valid_string;
                if (field == 0 || field == 2) && !valid_string {
                    return Err(invalid);
                }
                if (field == 3 || field == 4) && first == b'"' && !valid_string {
                    return Err(invalid);
                }
                if (valid_string
                    && (field != 2 || matches!(string.as_deref(), Some(b"module" | b"commonjs"))))
                    || (field >= 3 && matches!(first, b'{' | b'['))
                {
                    result.fields[field] = Some(value_start + offset..value_end + offset);
                }
            }
            match text.get(index.at(cursor)) {
                Some(b'}') => {
                    cursor += 1;
                    break;
                }
                Some(b',') => {
                    cursor += 1;
                    if text.get(index.at(cursor)) == Some(&b'}') {
                        return Err(invalid);
                    }
                }
                _ => return Err(invalid),
            }
        }
        // Node checks the document's closing token but does not consume trailing objects.
        let mut last = index.at(cursor - 1);
        while index.at(cursor) < text.len() {
            last = index.at(cursor);
            cursor += 1;
        }
        if text.get(last) != Some(&b'}')
            || index.index_error.is_some()
            || index.flags & FLAG_HAS_CTRL_IN_STRING != 0
            || std::str::from_utf8(text).is_err()
        {
            return Err(invalid);
        }
        for field in 3..5 {
            let Some(range) = result.fields[field].as_ref() else {
                continue;
            };
            let raw = &contents[range.clone()];
            if let Some(json) = map_json_source(raw) {
                result.needs_recovery |= raw.first() == Some(&b'"');
                result.json_errors[field - 3] = crate::node_json_diagnostic::syntax_error(&json);
            }
        }
        Ok(result)
    }
}

pub fn map_json_source(text: &[u8]) -> Option<Cow<'_, [u8]>> {
    let value = if text.first() == Some(&b'"') {
        string_value(text)?
    } else {
        Cow::Borrowed(text)
    };
    matches!(value.first(), Some(b'{' | b'[')).then_some(value)
}

fn string_value(text: &[u8]) -> Option<Cow<'_, [u8]>> {
    if !text.iter().any(|b| *b == b'\\' || *b < 0x20) {
        return std::str::from_utf8(text)
            .ok()
            .map(|_| Cow::Borrowed(&text[1..text.len() - 1]));
    }
    let source = bun_ast::Source::init_path_string_owned(b"package.json", text.to_vec());
    let parsed = ParsedJson::parse_json(&source, &mut bun_ast::Log::default()).ok()?;
    let value = parsed.root.as_utf8_string_literal()?;
    std::str::from_utf8(value).ok()?;
    Some(Cow::Owned(value.to_vec()))
}
