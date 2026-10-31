//! JSON syntax validation for Node's lazily materialized package maps.
//! Diagnostics follow https://github.com/nodejs/node/blob/v24.21.0/deps/v8/src/json/json-parser.cc.
//! V8 diagnostic templates are BSD-3-Clause licensed; see node_json_diagnostic.LICENSE.

#[derive(Clone, Copy)]
enum State {
    End,
    Value,
    ObjectKey(bool),
    Colon,
    ObjectNext,
    ArrayFirst,
    ArrayNext,
}

#[derive(Clone, Copy)]
enum Issue {
    Unexpected,
    At(&'static str),
}

pub(crate) fn syntax_error(bytes: &[u8]) -> Option<Box<[u16]>> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut cursor = 0;
    let mut states = vec![State::End, State::Value];
    while let Some(state) = states.pop() {
        while bytes
            .get(cursor)
            .is_some_and(|c| matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
        {
            cursor += 1;
        }
        let issue = match state {
            State::End => (cursor != bytes.len())
                .then_some(Issue::At("Unexpected non-whitespace character after JSON")),
            State::Value => match bytes.get(cursor) {
                Some(b'{') => {
                    cursor += 1;
                    states.push(State::ObjectKey(true));
                    None
                }
                Some(b'[') => {
                    cursor += 1;
                    states.push(State::ArrayFirst);
                    None
                }
                Some(b'"') => scan_string(text, &mut cursor),
                Some(b'-' | b'0'..=b'9') => scan_number(bytes, &mut cursor),
                Some(b't' | b'f' | b'n') => {
                    let literal: &[u8] = match bytes[cursor] {
                        b't' => b"true",
                        b'f' => b"false",
                        _ => b"null",
                    };
                    let mut issue = None;
                    for expected in literal {
                        if bytes.get(cursor) != Some(expected) {
                            issue = Some(Issue::Unexpected);
                            break;
                        }
                        cursor += 1;
                    }
                    issue
                }
                _ => Some(Issue::Unexpected),
            },
            State::ObjectKey(first) => {
                if first && bytes.get(cursor) == Some(&b'}') {
                    cursor += 1;
                    None
                } else if bytes.get(cursor) == Some(&b'"') {
                    let issue = scan_string(text, &mut cursor);
                    states.extend([State::ObjectNext, State::Value, State::Colon]);
                    issue
                } else {
                    Some(Issue::At(if first {
                        "Expected property name or '}' in JSON"
                    } else {
                        "Expected double-quoted property name in JSON"
                    }))
                }
            }
            State::Colon => {
                if bytes.get(cursor) == Some(&b':') {
                    cursor += 1;
                    None
                } else {
                    Some(Issue::At("Expected ':' after property name in JSON"))
                }
            }
            State::ObjectNext => match bytes.get(cursor) {
                Some(b',') => {
                    cursor += 1;
                    states.push(State::ObjectKey(false));
                    None
                }
                Some(b'}') => {
                    cursor += 1;
                    None
                }
                _ => Some(Issue::At(
                    "Expected ',' or '}' after property value in JSON",
                )),
            },
            State::ArrayFirst => {
                if bytes.get(cursor) == Some(&b']') {
                    cursor += 1;
                } else {
                    states.extend([State::ArrayNext, State::Value]);
                }
                None
            }
            State::ArrayNext => match bytes.get(cursor) {
                Some(b',') => {
                    cursor += 1;
                    states.extend([State::ArrayNext, State::Value]);
                    None
                }
                Some(b']') => {
                    cursor += 1;
                    None
                }
                _ => Some(Issue::At("Expected ',' or ']' after array element in JSON")),
            },
        };
        if let Some(issue) = issue {
            return Some(render(text, cursor, issue));
        }
    }
    None
}

fn scan_string(text: &str, cursor: &mut usize) -> Option<Issue> {
    let bytes = text.as_bytes();
    *cursor += 1;
    loop {
        match bytes.get(*cursor) {
            None => return Some(Issue::At("Unterminated string in JSON")),
            Some(b'"') => {
                *cursor += 1;
                return None;
            }
            Some(b'\\') => {
                *cursor += 1;
                match bytes.get(*cursor) {
                    Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => *cursor += 1,
                    Some(b'u') => {
                        for _ in 0..4 {
                            *cursor += 1;
                            if !bytes.get(*cursor).is_some_and(u8::is_ascii_hexdigit) {
                                return Some(Issue::At("Bad Unicode escape in JSON"));
                            }
                        }
                        *cursor += 1;
                    }
                    None => return Some(Issue::Unexpected),
                    _ if text[*cursor..]
                        .chars()
                        .next()
                        .is_some_and(|c| c as u32 > 255) =>
                    {
                        return Some(Issue::Unexpected);
                    }
                    _ => return Some(Issue::At("Bad escaped character in JSON")),
                }
            }
            Some(0..=0x1f) => {
                return Some(Issue::At("Bad control character in string literal in JSON"));
            }
            _ => *cursor += 1,
        }
    }
}

fn scan_number(bytes: &[u8], cursor: &mut usize) -> Option<Issue> {
    if bytes.get(*cursor) == Some(&b'-') {
        *cursor += 1;
    }
    if bytes.get(*cursor) == Some(&b'0') {
        *cursor += 1;
        if bytes.get(*cursor).is_some_and(u8::is_ascii_digit) {
            return Some(Issue::Unexpected);
        }
    } else {
        let start = *cursor;
        while bytes.get(*cursor).is_some_and(u8::is_ascii_digit) {
            *cursor += 1;
        }
        if *cursor == start {
            return Some(Issue::At("No number after minus sign in JSON"));
        }
    }
    if bytes.get(*cursor) == Some(&b'.') {
        *cursor += 1;
        let start = *cursor;
        while bytes.get(*cursor).is_some_and(u8::is_ascii_digit) {
            *cursor += 1;
        }
        if *cursor == start {
            return Some(Issue::At("Unterminated fractional number in JSON"));
        }
    }
    if matches!(bytes.get(*cursor), Some(b'e' | b'E')) {
        *cursor += 1;
        if matches!(bytes.get(*cursor), Some(b'+' | b'-')) {
            *cursor += 1;
        }
        let start = *cursor;
        while bytes.get(*cursor).is_some_and(u8::is_ascii_digit) {
            *cursor += 1;
        }
        if *cursor == start {
            return Some(Issue::At("Exponent part is missing a number in JSON"));
        }
    }
    None
}

fn render(text: &str, byte_position: usize, issue: Issue) -> Box<[u16]> {
    let position = text[..byte_position].encode_utf16().count();
    let token = text[byte_position..].encode_utf16().next();
    let at = match issue {
        Issue::At(message) => Some(message),
        Issue::Unexpected => match token {
            None => return "Unexpected end of JSON input".encode_utf16().collect(),
            Some(0x22) => Some("Unexpected string in JSON"),
            Some(0x2d | 0x30..=0x39) => Some("Unexpected number in JSON"),
            _ => None,
        },
    };
    if let Some(message) = at {
        let (mut line, mut column) = (1usize, 1usize);
        let mut prefix = text[..byte_position].encode_utf16().peekable();
        while let Some(unit) = prefix.next() {
            if unit == 13 && prefix.peek() == Some(&10) {
                prefix.next();
            }
            if matches!(unit, 10 | 13) {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }
        return format!("{message} at position {position} (line {line} column {column})")
            .encode_utf16()
            .collect();
    }
    if matches!(text, "[object Object]" | "undefined" | "Infinity" | "NaN") {
        return format!("\"{text}\" is not valid JSON")
            .encode_utf16()
            .collect();
    }
    let mut message: Vec<u16> = "Unexpected token '".encode_utf16().collect();
    message.push(token.expect("end of input was handled above"));
    message.extend("', ".encode_utf16());
    // V8 includes ten UTF-16 units on either side when the input has at least 21 units.
    let length = text.encode_utf16().count();
    let (start, end, before, after) = if length < 21 {
        (0, length, false, false)
    } else if position < 10 {
        (0, position + 10, false, true)
    } else if position < length - 10 {
        (position - 10, position + 10, true, true)
    } else {
        (position - 10, length, true, false)
    };
    if before {
        message.extend("...".encode_utf16());
    }
    message.push(0x22);
    message.extend(text.encode_utf16().skip(start).take(end - start));
    message.push(0x22);
    if after {
        message.extend("...".encode_utf16());
    }
    message.extend(" is not valid JSON".encode_utf16());
    message.into_boxed_slice()
}
