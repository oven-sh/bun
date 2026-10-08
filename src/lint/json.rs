//! Reads JSON, with comments and trailing commas allowed: the values of Bun's parser as [`Json`].

use crate::options::Json;
use bun_ast::E::JsonValue;
use bun_ast::expr::Data;
use bun_parsers::json::ParsedJson;

/// How deep arrays and objects can be nested.
const MAX_DEPTH: usize = 512;

/// `None` if `text` is not JSON.
pub fn parse(text: &[u8]) -> Option<Json> {
    // Which the parser takes for `{}`.
    if text.is_empty() {
        return None;
    }
    let mut allocator = bun_ast::ASTMemoryAllocator::default();
    let _scope = allocator.enter();
    let source = bun_ast::Source::init_path_string(b"".as_slice(), text);
    let parsed = ParsedJson::parse_jsonc_document(&source, &mut bun_ast::Log::init()).ok()?;
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
