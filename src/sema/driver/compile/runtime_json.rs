use bun_ast::e::{JsonValue, ObjectJSON};
use bun_parsers::json::ParsedJson;
use bun_sema::json::Json;
use bun_sema::session::Arena;

enum RuntimeJson {
    Rejected,
    NotAnObject,
    Object(Json),
}

fn runtime_json_value(value: &JsonValue) -> Option<Json> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    Some(match value {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(value) => Json::Bool(*value),
        JsonValue::Number(number) => Json::Number(number.value()),
        JsonValue::String(text) => Json::String(text.slice().to_vec()),
        JsonValue::Array(array) => {
            let items = array.get().items();
            let mut elements = Vec::with_capacity(items.len());
            for item in items {
                elements.push(runtime_json_value(item)?);
            }
            Json::Array(elements)
        }
        JsonValue::Object(object) => runtime_json_object(object.get())?,
    })
}

fn runtime_json_object(object: &ObjectJSON) -> Option<Json> {
    let properties = object.properties();
    let mut entries = Vec::with_capacity(properties.len());
    for property in properties {
        let value = runtime_json_value(&property.value)?;
        entries.push((property.key.slice().to_vec(), value));
    }
    Some(Json::Object(entries))
}

fn parse_runtime_json(
    arena: &Arena,
    name: &'static [u8],
    text: &[u8],
    parse: fn(&bun_ast::Source, &mut bun_ast::Log) -> bun_parsers::Result<ParsedJson>,
) -> RuntimeJson {
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(name, text);
    let mut log = bun_ast::Log::init();
    let Ok(parsed) = parse(&source, &mut log) else {
        return RuntimeJson::Rejected;
    };
    let bun_ast::expr::Data::EObjectJSON(root) = parsed.root.data else {
        return RuntimeJson::NotAnObject;
    };
    runtime_json_object(root.get()).map_or(RuntimeJson::Rejected, RuntimeJson::Object)
}

pub(super) fn parse_runtime_package_json(arena: &Arena, text: &[u8]) -> Option<Json> {
    match parse_runtime_json(arena, b"package.json", text, ParsedJson::parse_package_json) {
        RuntimeJson::Object(json) => Some(json),
        RuntimeJson::NotAnObject | RuntimeJson::Rejected => None,
    }
}

pub(super) fn parse_runtime_tsconfig(arena: &Arena, text: &[u8]) -> Option<Json> {
    match parse_runtime_json(arena, b"tsconfig.json", text, ParsedJson::parse_jsonc) {
        RuntimeJson::Object(json) => Some(json),
        RuntimeJson::NotAnObject => Some(Json::Object(Vec::new())),
        RuntimeJson::Rejected => None,
    }
}
