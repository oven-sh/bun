//! The configurations that ESLint and typescript-eslint publish, by name, for a project that does
//! not have them installed.

#[path = "presets_data.rs"]
mod data;

use crate::options::Json;
use bun_core::strings;

/// `recommendedTypeChecked` as `recommended-type-checked`.
fn kebab_case(name: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(name.len() + 4);
    for &byte in name {
        if byte.is_ascii_uppercase() {
            out.push(b'-');
        }
        out.push(byte.to_ascii_lowercase());
    }
    out
}

/// The name in the table for what a configuration calls `name`.
fn canonical(name: &[u8]) -> Option<Vec<u8>> {
    let name = name.strip_prefix(b"plugin:").unwrap_or(name);
    if let Some(rest) = name.strip_prefix(b"eslint:") {
        return Some([b"eslint/", rest].concat());
    }
    let slash = strings::last_index_of_char(name, b'/')?;
    let plugin: &[u8] = match &name[..slash] {
        b"eslint" | b"js" | b"@eslint/js" => b"eslint/",
        b"typescript-eslint" | b"@typescript-eslint" | b"typescript" | b"tseslint" => {
            b"typescript/"
        }
        _ => return None,
    };
    Some([plugin, &kebab_case(&name[slash + 1..])].concat())
}

/// The objects of the configuration called `name`:
/// - `eslint:recommended`, `eslint:all`, also as `js/recommended`, `@eslint/js/recommended`
/// - `typescript-eslint/recommended`, `/recommended-type-checked`, `/strict`, `/stylistic`, `/all`,
///   `/base`, `/eslint-recommended`, `/disable-type-checked`, .., also as `@typescript-eslint/..`,
///   `plugin:@typescript-eslint/..`, `tseslint/recommendedTypeChecked`
pub(super) fn find(name: &[u8]) -> Option<Vec<Json>> {
    let name = canonical(name)?;
    let text = strings::replace_owned(data::PRESETS.as_bytes(), b"\"@/", b"\"@typescript-eslint/");
    let all = crate::json::parse(&text)?;
    let mut objects = Vec::new();
    for object in all.get(&name)?.as_array()? {
        match object {
            Json::String(other) => objects.extend(all.get(other)?.as_array()?.iter().cloned()),
            object => objects.push(object.clone()),
        }
    }
    Some(objects)
}
