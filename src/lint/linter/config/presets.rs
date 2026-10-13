//! The configs that ESLint and typescript-eslint publish, by name, for a project that doesn't have them installed.
//!
//! `generate-presets.mjs` writes them to `presets.txt`, from @eslint/js 10.0.1 and @typescript-eslint/eslint-plugin 8.71.1. Each
//! line is `name<tab>JSON`. The JSON is an array of config objects, where a string stands for the objects of the config with
//! that name.

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
    let mut objects = Vec::new();
    for object in parse(&canonical(name)?)? {
        match &object {
            Json::String(other) => objects.extend(parse(other)?),
            _ => objects.push(object),
        }
    }
    Some(objects)
}

/// The line of `presets.txt` for `name`. Release builds embed the file compressed and inflate it on first use.
fn parse(name: &[u8]) -> Option<Vec<Json>> {
    let lines = bun_zstd::embed_compressed!(
        "src/lint/linter/config/presets.txt",
        include_bytes!("presets.txt")
    );
    let json = strings::split(lines, b"\n")
        .filter_map(|line| strings::split_once_char(line, b'\t'))
        .find(|it| it.0 == name)?
        .1;
    crate::json::parse(json)?.into_array()
}
