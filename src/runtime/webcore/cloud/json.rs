//! Small credential documents (IMDS/ECS/SSO/process output, GCP tokens) read
//! through Bun's JSON parser in a throwaway arena; callers copy out strings.

use bun_ast::E;
use bun_ast::expr::Data;

#[derive(Clone, Copy)]
pub struct Obj<'a>(pub &'a E::ObjectJSON);

impl<'a> Obj<'a> {
    pub fn str(self, key: &[u8]) -> Option<Box<[u8]>> {
        self.0
            .get(key)?
            .as_str()
            .filter(|s| !s.is_empty())
            .map(Box::from)
    }

    pub fn number(self, key: &[u8]) -> Option<f64> {
        match self.0.get(key)? {
            E::JsonValue::Number(n) => Some(n.value()),
            E::JsonValue::String(s) => core::str::from_utf8(s.slice()).ok()?.trim().parse().ok(),
            _ => None,
        }
    }

    pub fn object(self, key: &[u8]) -> Option<Obj<'a>> {
        self.0.get(key)?.as_object().map(Obj)
    }
}

/// Parses `body` as a JSON object and maps it through `read`; `None` if it is
/// not one.
pub fn parse<R>(body: &[u8], read: impl FnOnce(Obj<'_>) -> R) -> Option<R> {
    let body = body.trim_ascii();
    if body.is_empty() || body.len() > i32::MAX as usize {
        return None;
    }
    let arena = bun_alloc::Arena::default();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"credentials.json", body);
    let Ok(bun_ast::Expr {
        data: Data::EObjectJSON(root),
        ..
    }) = bun_parsers::json::parse_json_into_arena(&source, &mut log, &arena)
    else {
        return None;
    };
    let value = E::JsonValue::Object(root);
    let obj = value.as_object()?;
    Some(read(Obj(obj)))
}

/// Append `s` as a JSON string literal (quotes included).
pub fn push_string(out: &mut Vec<u8>, s: &[u8]) {
    let _ = bun_core::fmt::encode_json_string(&mut bun_core::fmt::VecWriter(out), s);
}
