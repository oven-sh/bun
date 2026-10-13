//! What oxlint refuses in a configuration file before it looks at what the file says: a key that it does not know, and a value of
//! another kind than it expects. The words are those of its reader.

use super::flat::ConfigError;
use super::oxlint_options::{check_as, compact, is_integer, write_debug, write_number, wrong_type};
use crate::options::Json;
use bun_core::strings as bytes;
use bun_glob::pattern::{Unclosed, UnclosedKind, unclosed};
use std::borrow::Cow;

const KEYS: &[&str] = &[
    "$schema",
    "plugins",
    "jsPlugins",
    "categories",
    "rules",
    "settings",
    "env",
    "globals",
    "overrides",
    "options",
    "ignorePatterns",
    "extends",
];
const KEYS_OF_OVERRIDES: &[&str] = &[
    "files",
    "excludeFiles",
    "env",
    "globals",
    "plugins",
    "jsPlugins",
    "rules",
];
/// The keys for which `null` is as good as nothing. For every other key it's a value of the wrong kind.
const NULLABLE: &[&str] = &["$schema", "plugins", "jsPlugins"];
const NULLABLE_IN_OVERRIDES: &[&str] = &["env", "globals", "plugins", "jsPlugins"];
/// `options` and `settings`, in the notation of `oxlint_fields.rs`. What is in `version` is looked at below.
const OPTIONS: &[u8] = b"(OxlintOptions typeAware:?b typeCheck:?b denyWarnings:?b maxWarnings:?n4 \
    reportUnusedDisableDirectives:?A respectEslintDisableDirectives:?b)";
const SETTINGS: &[u8] = b"(WellKnownOxlintSettings~ \
    jsx-a11y:(JSXA11yPluginSettings~ polymorphicPropName+:?s components:{s} attributes:{[s]}) \
    next:(NextPluginSettings~ rootDir:|OneOrMany s[s];) \
    react:(ReactPluginSettings~ \
    formComponents:[|CustomComponent s\
    (C~^ name!:s attribute!:s formAttribute@:s linkAttribute@@:s)\
    (C~^ name!:s attributes!:[s] formAttribute@:[s] linkAttribute@@:[s]);] \
    linkComponents:[|CustomComponent s\
    (C~^ name!:s attribute!:s formAttribute@:s linkAttribute@@:s)\
    (C~^ name!:s attributes!:[s] formAttribute@:[s] linkAttribute@@:[s]);] \
    version:* componentWrapperFunctions:[s]) \
    jsdoc:(JSDocPluginSettings~ ignorePrivate:b ignoreInternal:b ignoreReplacesDocs:b overrideReplacesDocs:b \
    augmentsExtendsReplacesDocs:b implementsReplacesDocs:b exemptDestructuredRootsFromChecks:b \
    tagNamePreference:{|TagNamePreference s(T~^ message!:s replacement!:s)(T~^ message!:s)b;}) \
    vitest:(VitestPluginSettings~ typecheck:b) \
    jest:(JestPluginSettings~ version:*))";
const CATEGORIES: &[&str] = &[
    "correctness",
    "suspicious",
    "pedantic",
    "perf",
    "style",
    "restriction",
    "nursery",
];

fn refusal(parts: &[&[u8]]) -> ConfigError {
    ConfigError::new(&[
        b"Failed to parse config with error Error(\"",
        &parts.concat(),
        b"\", line: 0, column: 0)",
    ])
}

/// The same for a text that is not yet written like a string of Rust.
fn refusal_in_words(text: &[u8]) -> ConfigError {
    let mut message = b"Failed to parse config with error Error(".to_vec();
    write_debug(&mut message, text);
    message.extend_from_slice(b", line: 0, column: 0)");
    ConfigError { message }
}

fn wrong_kind(found: &Json, expected: &str) -> ConfigError {
    refusal_in_words(&wrong_type(found, expected.as_bytes()))
}

type Entries = [(Vec<u8>, Json)];

fn map<'j>(json: &'j Json, expected: &str) -> Result<&'j Entries, ConfigError> {
    json.as_object().ok_or_else(|| wrong_kind(json, expected))
}

fn sequence(json: &Json) -> Result<&[Json], ConfigError> {
    (json.as_array()).ok_or_else(|| wrong_kind(json, "a sequence"))
}

fn strings(json: &Json) -> Result<(), ConfigError> {
    match sequence(json)?.iter().find(|it| it.as_str().is_none()) {
        Some(other) => Err(wrong_kind(other, "a string")),
        None => Ok(()),
    }
}

fn says_something(entry: &(Vec<u8>, Json), nullable: &[&str]) -> bool {
    entry.1 != Json::Null || !nullable.iter().any(|it| it.as_bytes() == entry.0)
}

fn global(json: &Json) -> Result<(), ConfigError> {
    match json {
        Json::Bool(_) => Ok(()),
        Json::String(it) => match &it[..] {
            b"readonly" | b"readable" | b"writable" | b"writeable" | b"off" => Ok(()),
            _ => Err(refusal(&[b"Invalid global value"])),
        },
        _ => Err(wrong_kind(
            json,
            "'readonly', 'writable', 'off', or a boolean",
        )),
    }
}

fn boolean(json: &Json) -> Result<(), ConfigError> {
    match json.as_bool() {
        Some(_) => Ok(()),
        None => Err(wrong_kind(json, "a boolean")),
    }
}

/// `what`: `field`, or `variant`. What starts with a `$` is not of the file: it says how a value of a program was written down.
fn known_keys(entries: &Entries, known: &[&str], what: &str) -> Result<(), ConfigError> {
    let is_known =
        |key: &[u8]| key.starts_with(b"$") || known.iter().any(|it| it.as_bytes() == key);
    let Some((key, _)) = entries.iter().find(|it| !is_known(&it.0)) else {
        return Ok(());
    };
    let known: Vec<String> = known.iter().map(|it| format!("`{it}`")).collect();
    Err(refusal(&[
        b"unknown ",
        what.as_bytes(),
        b" `",
        key,
        b"`, expected one of ",
        known.join(", ").as_bytes(),
    ]))
}

/// What oxlint and oxfmt refuse the pattern `written` with. `None`: they take it.
pub fn glob_refusal(written: &[u8]) -> Option<Vec<u8>> {
    let Unclosed { kind, at } = unclosed(written)?;
    let (what, open, close) = match kind {
        UnclosedKind::Class => ("character class", '[', ']'),
        UnclosedKind::Braces => ("brace expansion", '{', '}'),
        UnclosedKind::Escape => {
            let why = format!(
                "`: trailing backslash at byte {at} has no character to escape (to match a literal '\\', use '\\\\')"
            );
            return Some([b"Invalid glob pattern `", written, why.as_bytes()].concat());
        }
    };
    let why = format!(
        "`: unclosed {what} at byte {at}; missing '{close}' (to match a literal '{open}', escape it as '\\{open}' or '[{open}]')"
    );
    Some([b"Invalid glob pattern `", written, why.as_bytes()].concat())
}

/// A value that a file and an override can have.
fn value(key: &[u8], json: &Json) -> Result<(), ConfigError> {
    match key {
        b"plugins" | b"ignorePatterns" => strings(json),
        b"files" | b"excludeFiles" => {
            strings(json)?;
            let patterns = json.as_array().unwrap_or_default().iter();
            match patterns.filter_map(Json::as_str).find_map(glob_refusal) {
                Some(why) => Err(refusal(&[&bytes::replace_owned(&why, b"\\", b"\\\\")])),
                None => Ok(()),
            }
        }
        b"jsPlugins" => sequence(json).map(|_| ()),
        b"rules" => {
            let expected = "Record<string, SeverityConf | [SeverityConf, ...any[]]>";
            map(json, expected)?.iter().try_for_each(|it| rule(&it.1))
        }
        b"globals" => map(json, "a map")?.iter().try_for_each(|it| global(&it.1)),
        b"env" => map(json, "a map")?.iter().try_for_each(|it| boolean(&it.1)),
        _ => Ok(()),
    }
}

/// `{:?}` of a `serde_json::Value`
fn write_debug_of_value(out: &mut Vec<u8>, json: &Json) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return;
    }
    let comma = |at: usize| -> &'static [u8] { if at == 0 { b"" } else { b", " } };
    match json {
        Json::Null => out.extend_from_slice(b"Null"),
        Json::Bool(true) => out.extend_from_slice(b"Bool(true)"),
        Json::Bool(false) => out.extend_from_slice(b"Bool(false)"),
        Json::Number(it) => {
            out.extend_from_slice(b"Number(");
            write_number(out, *it);
            out.push(b')');
        }
        Json::String(it) => {
            out.extend_from_slice(b"String(");
            write_debug(out, it);
            out.push(b')');
        }
        Json::Array(items) => {
            out.extend_from_slice(b"Array [");
            for (at, item) in items.iter().enumerate() {
                out.extend_from_slice(comma(at));
                write_debug_of_value(out, item);
            }
            out.push(b']');
        }
        Json::Object(entries) => {
            out.extend_from_slice(b"Object {");
            for (at, (key, item)) in entries.iter().enumerate() {
                out.extend_from_slice(comma(at));
                write_debug(out, key);
                out.extend_from_slice(b": ");
                write_debug_of_value(out, item);
            }
            out.push(b'}');
        }
    }
}

/// The severity of a rule.
fn severity(json: &Json) -> Result<(), ConfigError> {
    let mut text = b"Failed to parse rule severity, expected ".to_vec();
    match json {
        Json::String(it) if matches!(&it[..], b"allow" | b"off" | b"deny" | b"error" | b"warn") => {
            return Ok(());
        }
        Json::Number(it) if [0.0, 1.0, 2.0].contains(it) && is_integer(*it) => return Ok(()),
        Json::String(it) => {
            let known = br#"one of "allow", "off", "deny", "error" or "warn", but got "#;
            text.extend_from_slice(known);
            write_debug(&mut text, it);
        }
        Json::Number(it) => {
            text.extend_from_slice(b"one of `0`, `1` or `2`, but got ");
            match is_integer(*it) && *it < 0.0 {
                true => text.extend_from_slice(b"a negative number"),
                false => write_number(&mut text, *it),
            }
        }
        other => {
            text.extend_from_slice(b"a string or a number, but got ");
            write_debug_of_value(&mut text, other);
        }
    }
    Err(refusal_in_words(&text))
}

/// What is said about a rule: a severity, or a list that starts with one.
fn rule(json: &Json) -> Result<(), ConfigError> {
    let expected: &[u8] = match json {
        Json::String(_) | Json::Number(_) => return severity(json),
        Json::Array(items) => match items.first() {
            Some(first) => return severity(first),
            None => b"[SeverityConf, ...any[]",
        },
        _ => b"SeverityConf | [SeverityConf, ...any[]]",
    };
    let mut text = b"Failed to rule value ".to_vec();
    write_debug(&mut text, &compact(json));
    text.extend_from_slice(&[b" with error \"Type should be `", expected, b"`\""].concat());
    Err(refusal_in_words(&text))
}

/// `settings.jest.version`: a number, or a text that starts with one.
fn jest_version(version: &Json) -> Result<(), ConfigError> {
    let mut why = Vec::new();
    match version {
        Json::Null => return Ok(()),
        Json::Number(it) if is_integer(*it) && *it >= 0.0 => return Ok(()),
        Json::Number(it) if is_integer(*it) => {
            why.extend_from_slice(b"Jest version cannot be negative: ");
            write_number(&mut why, *it);
        }
        Json::String(text) => {
            let numbers = text.strip_prefix(b"v").unwrap_or(text);
            let major = bytes::split(numbers, b".").next().unwrap_or_default();
            if std::str::from_utf8(major).is_ok_and(|it| it.parse::<u64>().is_ok()) {
                return Ok(());
            }
            why.extend_from_slice(b"Invalid Jest version string: ");
            write_debug(&mut why, text);
        }
        _ => {
            let expected = "Expected Jest version as a number or string";
            return Err(wrong_kind(version, expected));
        }
    }
    Err(refusal_in_words(&why))
}

/// `settings.react.version` is up to three numbers with dots between them.
fn settings(json: &Json) -> Result<(), ConfigError> {
    check_as(SETTINGS, json).map_err(|why| refusal_in_words(&why))?;
    if let Some(version) = json.get(b"jest").and_then(|it| it.get(b"version")) {
        jest_version(version)?;
    }
    let version = json.get(b"react").and_then(|it| it.get(b"version"));
    let Some(version) = version.filter(|it| **it != Json::Null) else {
        return Ok(());
    };
    let Some(text) = version.as_str() else {
        let expected = r#"a version string like "18.2.0" or "17.0""#;
        return Err(wrong_kind(version, expected));
    };
    if text.is_empty() {
        return Err(refusal(&[
            b"version string cannot be empty for settings.react.version",
        ]));
    }
    let is_number = |it: &[u8]| std::str::from_utf8(it).is_ok_and(|it| it.parse::<u32>().is_ok());
    let mut parts = bytes::split(text, b".");
    for (name, part) in ["major", "minor", "patch"].iter().zip(&mut parts) {
        if !is_number(part) {
            let name = name.as_bytes();
            return Err(refusal(&[
                b"invalid ",
                name,
                b" version in settings.react.version",
            ]));
        }
    }
    match parts.next() {
        Some(_) => Err(refusal(&[
            b"version string in settings.react.version has too many components, expected major.minor.patch",
        ])),
        None => Ok(()),
    }
}

/// oxlint's reader takes a list for a struct, with the fields in their order. Some of an override can be left out at the end.
fn override_in_a_list(items: &[Json]) -> Result<(), ConfigError> {
    for (at, key) in KEYS_OF_OVERRIDES.iter().enumerate() {
        match items.get(at) {
            Some(Json::Null) if NULLABLE_IN_OVERRIDES.contains(key) => {}
            Some(item) => value(key.as_bytes(), item)?,
            None if matches!(*key, "files" | "env" | "globals") => {
                let why =
                    format!("invalid length {at}, expected struct OxlintOverride with 7 elements");
                return Err(refusal_in_words(why.as_bytes()));
            }
            None => {}
        }
    }
    if items.len() > KEYS_OF_OVERRIDES.len() {
        let why = format!(
            "invalid length {}, expected fewer elements in array",
            items.len()
        );
        return Err(refusal_in_words(why.as_bytes()));
    }
    Ok(())
}

/// `item` of `overrides` with its keys, if it is a list.
pub(super) fn override_with_keys(item: &Json) -> Cow<'_, Json> {
    let Json::Array(items) = item else {
        return Cow::Borrowed(item);
    };
    let entries = (KEYS_OF_OVERRIDES.iter().zip(items)).filter(|it| *it.1 != Json::Null);
    let entries = entries.map(|(key, item)| (key.as_bytes().to_vec(), item.clone()));
    Cow::Owned(Json::Object(entries.collect()))
}

/// `json` is a whole file.
pub(super) fn check(json: &Json) -> Result<(), ConfigError> {
    let Some(entries) = json.as_object() else {
        return Ok(());
    };
    known_keys(entries, KEYS, "field")?;
    for (key, json) in entries.iter().filter(|it| says_something(it, NULLABLE)) {
        match &key[..] {
            b"$schema" if json.as_str().is_none() => return Err(wrong_kind(json, "a string")),
            b"categories" => {
                for entry in map(json, "a map")? {
                    known_keys(std::slice::from_ref(entry), CATEGORIES, "variant")?;
                    check_as(b"A", &entry.1).map_err(|why| refusal_in_words(&why))?;
                }
            }
            b"settings" => settings(json)?,
            b"options" => check_as(OPTIONS, json).map_err(|why| refusal_in_words(&why))?,
            b"extends" => {
                let is_known = |it: &&Json| it.as_str().is_some() || it.as_object().is_some();
                if let Some(other) = sequence(json)?.iter().find(|it| !is_known(it)) {
                    return Err(wrong_kind(other, "path string"));
                }
            }
            b"overrides" => {
                for item in sequence(json)? {
                    if let Json::Array(items) = item {
                        override_in_a_list(items)?;
                        continue;
                    }
                    let entries = map(item, "struct OxlintOverride")?;
                    known_keys(entries, KEYS_OF_OVERRIDES, "field")?;
                    if item.get(b"files").is_none() {
                        return Err(refusal(&[b"missing field `files`"]));
                    }
                    let mut entries =
                        (entries.iter()).filter(|it| says_something(it, NULLABLE_IN_OVERRIDES));
                    entries.try_for_each(|it| value(&it.0, &it.1))?;
                }
            }
            key => value(key, json)?,
        }
    }
    Ok(())
}
