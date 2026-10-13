//! Reads JSON, with comments and trailing commas allowed, JSON5, TOML and YAML: the values of Bun's
//! parsers as [`Json`].

use crate::linter::write_json;
use crate::options::Json;
use crate::utils::text::{number_to_string, string_from_code_points};
use bun_ast::E::JsonValue;
use bun_ast::expr::Data;
use bun_ast::{ASTMemoryAllocator, Expr, Log, Source};
use bun_core::strings;
use bun_parsers::json::ParsedJson;
use bun_parsers::json5::JSON5Parser;
use bun_parsers::toml::TOML;
use bun_parsers::yaml::{CyclicAliases, YAML};
use std::borrow::Cow;

/// Limits how deep a value from a config file can be nested. Most code that walks a config recurses without checking the
/// stack, with frames of other sizes and maybe on another thread. So whatever builds a value for it only gets a quarter of
/// the smallest stack.
#[derive(Copy, Clone)]
pub(crate) struct RoomToNest(bun_core::StackCheck);

impl RoomToNest {
    pub(crate) fn new() -> RoomToNest {
        let smallest = bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize;
        RoomToNest(bun_core::StackCheck::init().with_at_most(smallest / 4))
    }

    #[inline]
    pub(crate) fn has_more(self) -> bool {
        self.0.is_safe_to_recurse()
    }
}

/// `None` if `text` is not JSON.
pub fn parse(text: &[u8]) -> Option<Json> {
    // Which the parser takes for `{}`.
    if text.is_empty() {
        return None;
    }
    let mut allocator = ASTMemoryAllocator::default();
    let _scope = allocator.enter();
    let source = Source::init_path_string(b"".as_slice(), text);
    let mut log = Log::init();
    let parsed = ParsedJson::parse_jsonc_document(&source, &mut log).ok()?;
    let root = match parsed.root.data {
        Data::ENull(_) => JsonValue::Null,
        Data::EBoolean(it) => JsonValue::Boolean(it.value),
        Data::ENumber(it) => JsonValue::Number(it),
        Data::EString(it) => JsonValue::String(it.get().data),
        Data::EArrayJSON(it) => JsonValue::Array(it),
        Data::EObjectJSON(it) => JsonValue::Object(it),
        _ => return None,
    };
    // The parser warns about a key that is written twice.
    convert(&root, RoomToNest::new(), log.warnings > 0)
}

/// `None`: it is nested too deeply.
fn convert(value: &JsonValue, room: RoomToNest, has_repeats: bool) -> Option<Json> {
    if !room.has_more() {
        return None;
    }
    Some(match value {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(it) => Json::Bool(*it),
        JsonValue::Number(it) => Json::Number(it.value()),
        JsonValue::String(it) => Json::String(it.slice().to_vec()),
        JsonValue::Array(it) => {
            let mut items = Vec::with_capacity(it.get().items().len());
            for item in it.get().items() {
                items.push(convert(item, room, has_repeats)?);
            }
            Json::Array(items)
        }
        JsonValue::Object(it) => {
            let mut entries = Vec::with_capacity(it.get().properties().len());
            for property in it.get().properties() {
                let value = convert(&property.value, room, has_repeats)?;
                entries.push((property.key.slice().to_vec(), value));
            }
            match has_repeats {
                true => Json::object(entries),
                false => Json::Object(entries),
            }
        }
    })
}

/// The end of the string that starts at `start`, if serde_json takes it.
fn end_of_strict_string(text: &[u8], start: usize) -> Option<usize> {
    let unit = |at: usize| {
        let digits = std::str::from_utf8(text.get(at..at + 4)?).ok()?;
        let is_hex = digits.bytes().all(|it| it.is_ascii_hexdigit());
        u16::from_str_radix(digits, 16).ok().filter(|_| is_hex)
    };
    let mut at = start + 1;
    loop {
        match (*text.get(at)?, text.get(at + 1)) {
            (b'"', _) => return Some(at + 1),
            (b'\\', Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't')) => at += 2,
            (b'\\', Some(b'u')) => match unit(at + 2)? {
                0xd800..=0xdbff => {
                    let is_pair = text.get(at + 6..at + 8) == Some(b"\\u")
                        && matches!(unit(at + 8)?, 0xdc00..=0xdfff);
                    at = is_pair.then_some(at + 12)?;
                }
                0xdc00..=0xdfff => return None,
                _ => at += 6,
            },
            (b'\\' | 0..=0x1f, _) => return None,
            _ => at += 1,
        }
    }
}

/// The end of the number that starts at `start`, if it is one of JSON: not `01`, `1.`, `.5`, `0x10`.
fn end_of_strict_number(text: &[u8], start: usize) -> Option<usize> {
    let digits = |at: usize| {
        let count = text[at..]
            .iter()
            .take_while(|it| it.is_ascii_digit())
            .count();
        (count > 0).then_some(at + count)
    };
    let first = start + usize::from(text[start] == b'-');
    let mut at = match text.get(first)? {
        b'0' => first + 1,
        _ => digits(first)?,
    };
    if text.get(at) == Some(&b'.') {
        at = digits(at + 1)?;
    }
    if matches!(text.get(at), Some(b'e' | b'E')) {
        at = digits(at + 1 + usize::from(matches!(text.get(at + 1), Some(b'+' | b'-'))))?;
    }
    (!text.get(at).is_some_and(u8::is_ascii_alphanumeric)).then_some(at)
}

/// [`parse`], for an `.oxlintrc.json`. oxlint takes out the comments, among them those that start with `#`, and has serde_json
/// read the rest. That refuses what Bun's parser takes from JavaScript: `'a'`, `0x10`, `"\x61"`, a byte order mark.
pub fn parse_like_oxlint(text: &[u8]) -> Option<Json> {
    let line_end = |at: usize| {
        strings::index_of_char_usize(&text[at..], b'\n').map_or(text.len(), |it| at + it)
    };
    let mut cleaned = Cow::Borrowed(text);
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        at = match (byte, text.get(at + 1)) {
            (b'"', _) => end_of_strict_string(text, at)?,
            (b'-' | b'0'..=b'9', _) => end_of_strict_number(text, at)?,
            (b'#', _) => {
                let end = line_end(at);
                cleaned.to_mut()[at..end].fill(b' ');
                end
            }
            (b'/', Some(b'/')) => line_end(at),
            (b'/', Some(b'*')) => at + 4 + strings::index_of(&text[at + 2..], b"*/")?,
            (b' ' | b'\t' | b'\n' | b'\r' | b'{' | b'}' | b'[' | b']' | b':' | b',', _) => at + 1,
            // `true`, `false`, `null`
            (b'a'..=b'z', _) => at + 1,
            _ => return None,
        };
    }
    parse(&cleaned)
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Notation {
    Json5,
    Toml,
    Yaml,
}

/// The value that `text` is in `notation`, as `JSON.stringify` writes it: what is not a finite number
/// is `null`, a date of TOML is a string, as it is written. No document of YAML is `null`, several are
/// an array. A repeated key is there once, at its first place, with its last value. `Err`: what is wrong with `text`.
pub fn parse_as(notation: Notation, text: &[u8]) -> Result<Json, Vec<u8>> {
    with_parsed(notation, text, from_parsed)
        .map_err(|error| error.message)?
        .ok_or_else(|| b"This file is nested too deeply".to_vec())
}

/// A syntax error and its position. Lines and columns start at 1.
pub struct SyntaxError {
    pub message: Vec<u8>,
    pub line: i32,
    pub column: i32,
}

/// Calls `read` with the value that `text` is in `notation` as Bun's parser makes it, where each part knows its place in
/// `text`. The value does not outlive the call. `Err`: what is wrong with `text`.
pub fn with_parsed<T>(
    notation: Notation,
    text: &[u8],
    read: impl FnOnce(&Expr) -> T,
) -> Result<T, SyntaxError> {
    let arena = bun_alloc::Arena::new();
    let mut allocator = ASTMemoryAllocator::borrowing(&arena);
    let _scope = allocator.enter();
    let text = bun_core::strings::without_utf8_bom(text);
    let source = Source::init_path_string(b"".as_slice(), text);
    let mut log = Log::init();
    let root = match notation {
        Notation::Json5 => JSON5Parser::parse(&source, &mut log, &arena).ok(),
        Notation::Toml => TOML::parse(&source, &mut log, &arena, false).ok(),
        Notation::Yaml => YAML::parse(&source, &mut log, &arena, CyclicAliases::Reject).ok(),
    };
    let Some(root) = root else {
        let first = log.msgs.first().map(|it| &it.data);
        let place = first.and_then(|it| it.location.as_ref());
        return Err(SyntaxError {
            message: first.map_or_else(|| b"Syntax error".to_vec(), |it| it.text.to_vec()),
            line: place.map_or(1, |it| it.line),
            column: place.map_or(1, |it| it.column),
        });
    };
    Ok(read(&root))
}

/// A value of one of Bun's parsers, or a part of one, as [`parse_as`] returns it. `None`: it is nested too deep.
pub fn from_parsed(expr: &Expr) -> Option<Json> {
    from_expr(expr, RoomToNest::new())
}

fn from_expr(expr: &Expr, room: RoomToNest) -> Option<Json> {
    if !room.has_more() {
        return None;
    }
    Some(match &expr.data {
        Data::EBoolean(it) => Json::Bool(it.value),
        // `.inf` of YAML, `inf` of TOML, `Infinity` of JSON5. What is no number is `null`, as for `JSON.stringify`.
        Data::ENumber(it) if !it.value().is_nan() => Json::Number(it.value()),
        Data::EString(it) if it.is_utf16 => Json::String(string_from_code_points(
            it.slice16().iter().map(|unit| u32::from(*unit)),
        )),
        Data::EString(it) => Json::String(it.slice8().to_vec()),
        Data::EArray(it) => {
            let mut items = Vec::with_capacity(it.slice().len());
            for item in it.slice() {
                items.push(from_expr(item, room)?);
            }
            Json::Array(items)
        }
        Data::EObject(it) => {
            let mut entries = Vec::with_capacity(it.properties.len());
            for property in it.properties.iter() {
                let (Some(key), Some(value)) = (&property.key, &property.value) else {
                    continue;
                };
                // `String(key)`, but for a key that is an array or an object.
                let key = match &mut from_expr(key, room)? {
                    Json::String(key) => std::mem::take(key),
                    Json::Number(key) => number_to_string(*key),
                    key => {
                        let mut text = Vec::new();
                        write_json(&mut text, key);
                        text
                    }
                };
                entries.push((key, from_expr(value, room)?));
            }
            Json::object(entries)
        }
        _ => Json::Null,
    })
}
