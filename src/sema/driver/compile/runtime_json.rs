use bun_ast::e::{JsonValue, ObjectJSON};
use bun_parsers::json::ParsedJson;
use bun_sema::json::Json;
use bun_sema::session::Arena;

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
    in_place_of_another_value: Option<Json>,
) -> Option<Json> {
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(name, text);
    let mut log = bun_ast::Log::init();
    let parsed = parse(&source, &mut log).ok()?;
    match parsed.root.data {
        bun_ast::expr::Data::EObjectJSON(root) => runtime_json_object(root.get()),
        _ => in_place_of_another_value,
    }
}

pub(super) fn parse_runtime_package_json(arena: &Arena, text: &[u8]) -> Option<Json> {
    let parse = ParsedJson::parse_package_json;
    parse_runtime_json(arena, b"package.json", text, parse, None)
}

pub(super) fn parse_runtime_tsconfig(arena: &Arena, text: &[u8]) -> Option<Json> {
    let (parse, empty) = (ParsedJson::parse_jsonc, Json::Object(Vec::new()));
    parse_runtime_json(arena, b"tsconfig.json", text, parse, Some(empty))
}
