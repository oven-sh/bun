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

/// How deep arrays and objects can be nested.
const MAX_DEPTH: usize = 512;

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
    convert(&root, 0)
}

fn convert(value: &JsonValue, depth: usize) -> Option<Json> {
    if depth > MAX_DEPTH {
        return None;
    }
    Some(match value {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(it) => Json::Bool(*it),
        JsonValue::Number(it) => Json::Number(it.value()),
        JsonValue::String(it) => Json::String(it.slice().to_vec()),
        JsonValue::Array(it) => {
            let items = it.get().items().iter();
            Json::Array(
                items
                    .map(|item| convert(item, depth + 1))
                    .collect::<Option<_>>()?,
            )
        }
        JsonValue::Object(it) => {
            let properties = it.get().properties().iter();
            Json::Object(
                properties
                    .map(|it| Some((it.key.slice().to_vec(), convert(&it.value, depth + 1)?)))
                    .collect::<Option<_>>()?,
            )
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
        let message = log.msgs.first().map(|it| it.data.text.to_vec());
        return Err(message.unwrap_or_else(|| b"Syntax error".to_vec()));
    };
    // An alias of YAML is a value once more: a short text can stand for any number of them.
    let mut left = text.len().saturating_mul(64).clamp(1 << 10, 1 << 23);
    from_expr(&root, 0, &mut left).ok_or_else(|| b"It has too many values".to_vec())
}

/// `left`: how many more values there can be.
fn from_expr(expr: &Expr, depth: usize, left: &mut usize) -> Option<Json> {
    *left = left.checked_sub(1)?;
    if depth > MAX_DEPTH {
        return None;
    }
    Some(match &expr.data {
        Data::EBoolean(it) => Json::Bool(it.value),
        Data::ENumber(it) if it.value().is_finite() => Json::Number(it.value()),
        Data::EString(it) if it.is_utf16 => Json::String(string_from_code_points(
            it.slice16().iter().map(|unit| u32::from(*unit)),
        )),
        Data::EString(it) => Json::String(it.slice8().to_vec()),
        Data::EArray(it) => {
            let mut items = it.slice().iter();
            Json::Array(items.try_fold(Vec::new(), |mut items, item| {
                items.push(from_expr(item, depth + 1, left)?);
                Some(items)
            })?)
        }
        Data::EObject(it) => {
            let mut entries = Vec::with_capacity(it.properties.len());
            for property in it.properties.iter() {
                let (Some(key), Some(value)) = (&property.key, &property.value) else {
                    continue;
                };
                // `String(key)`, but for a key that is an array or an object.
                let key = match from_expr(key, depth + 1, left)? {
                    Json::String(key) => key,
                    Json::Number(key) => number_to_string(key),
                    key => {
                        let mut text = Vec::new();
                        write_json(&mut text, &key);
                        text
                    }
                };
                entries.push((key, from_expr(value, depth + 1, left)?));
            }
            Json::Object(entries)
        }
        _ => Json::Null,
    })
}
