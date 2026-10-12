//! Reads JSON, with comments and trailing commas allowed, JSON5, TOML and YAML: the values of Bun's
//! parsers as [`Json`].

use crate::linter::write_json;
use crate::options::Json;
use crate::utils::text::{number_to_string, string_from_code_points};
use bun_ast::E::JsonValue;
use bun_ast::expr::Data;
use bun_ast::{ASTMemoryAllocator, Expr, Log, Source};
use bun_parsers::json::ParsedJson;
use bun_parsers::json5::JSON5Parser;
use bun_parsers::toml::TOML;
use bun_parsers::yaml::{CyclicAliases, YAML};

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
    let parsed = ParsedJson::parse_jsonc_document(&source, &mut Log::init()).ok()?;
    let root = match parsed.root.data {
        Data::ENull(_) => JsonValue::Null,
        Data::EBoolean(it) => JsonValue::Boolean(it.value),
        Data::ENumber(it) => JsonValue::Number(it),
        Data::EString(it) => JsonValue::String(it.get().data),
        Data::EArrayJSON(it) => JsonValue::Array(it),
        Data::EObjectJSON(it) => JsonValue::Object(it),
        _ => return None,
    };
    convert(&root, RoomToNest::new())
}

/// `None`: it is nested too deeply.
fn convert(value: &JsonValue, room: RoomToNest) -> Option<Json> {
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
                items.push(convert(item, room)?);
            }
            Json::Array(items)
        }
        JsonValue::Object(it) => {
            let mut entries = Vec::with_capacity(it.get().properties().len());
            for property in it.get().properties() {
                entries.push((
                    property.key.slice().to_vec(),
                    convert(&property.value, room)?,
                ));
            }
            Json::Object(entries)
        }
    })
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Notation {
    Json5,
    Toml,
    Yaml,
}

/// The value that `text` is in `notation`, as `JSON.stringify` writes it: what is not a finite number
/// is `null`, a date of TOML is a string, as it is written. No document of YAML is `null`, several are
/// an array. A repeated key is there as often as it is written. `Err`: what is wrong with `text`.
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
            Json::Object(entries)
        }
        _ => Json::Null,
    })
}
