//! What oxlint refuses in a configuration file before it looks at what the file says: a key that it does not know, and a value of
//! another kind than it expects. The words are those of its reader.

use super::fast_glob::FastGlob;
use super::flat::ConfigError;
use crate::options::Json;
use bun_core::strings as bytes;

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
const OPTIONS: &[&str] = &[
    "typeAware",
    "typeCheck",
    "denyWarnings",
    "maxWarnings",
    "reportUnusedDisableDirectives",
    "respectEslintDisableDirectives",
];
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

fn wrong_kind(found: &Json, expected: &str) -> ConfigError {
    let found = match found {
        Json::Null => b"null".to_vec(),
        Json::Bool(it) => format!("boolean `{it}`").into_bytes(),
        Json::Number(it) if it.fract() == 0.0 => format!("integer `{}`", *it as i64).into_bytes(),
        Json::Number(it) => format!("floating point `{it}`").into_bytes(),
        Json::String(it) => [b"string \\\"", &it[..], b"\\\""].concat(),
        Json::Array(_) => b"sequence".to_vec(),
        Json::Object(_) => b"map".to_vec(),
    };
    refusal(&[
        b"invalid type: ",
        &found,
        b", expected ",
        expected.as_bytes(),
    ])
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

/// A value that a file and an override can have.
fn value(key: &[u8], json: &Json) -> Result<(), ConfigError> {
    match key {
        b"plugins" | b"ignorePatterns" => strings(json),
        b"files" | b"excludeFiles" => {
            strings(json)?;
            let patterns = json.as_array().unwrap_or_default().iter();
            match patterns
                .filter_map(Json::as_str)
                .find_map(FastGlob::refusal)
            {
                Some(why) => Err(refusal(&[&bytes::replace_owned(&why, b"\\", b"\\\\")])),
                None => Ok(()),
            }
        }
        b"jsPlugins" => sequence(json).map(|_| ()),
        b"rules" => {
            let expected = "Record<string, SeverityConf | [SeverityConf, ...any[]]>";
            map(json, expected).map(|_| ())
        }
        b"globals" => map(json, "a map").map(|_| ()),
        b"env" => map(json, "a map")?.iter().try_for_each(|it| boolean(&it.1)),
        _ => Ok(()),
    }
}

fn options(json: &Json) -> Result<(), ConfigError> {
    let entries = map(json, "struct OxlintOptions")?;
    known_keys(entries, OPTIONS, "field")?;
    for (key, json) in entries.iter().filter(|it| it.1 != Json::Null) {
        match (&key[..], json) {
            (b"maxWarnings", Json::Number(count)) if *count < 0.0 && count.fract() == 0.0 => {
                let count = format!("`{}`", *count as i64);
                let count = count.as_bytes();
                return Err(refusal(&[
                    b"invalid value: integer ",
                    count,
                    b", expected usize",
                ]));
            }
            (b"maxWarnings", Json::Number(count)) if count.fract() == 0.0 => {}
            (b"maxWarnings", _) => return Err(wrong_kind(json, "usize")),
            (b"reportUnusedDisableDirectives", Json::String(_) | Json::Number(_)) => {}
            (b"reportUnusedDisableDirectives", _) => {
                return Err(refusal(&[
                    b"data did not match any variant of untagged enum Repr",
                ]));
            }
            _ => boolean(json)?,
        }
    }
    Ok(())
}

/// `json` is a whole file.
pub(super) fn check(json: &Json) -> Result<(), ConfigError> {
    let Some(entries) = json.as_object() else {
        return Ok(());
    };
    known_keys(entries, KEYS, "field")?;
    for (key, json) in entries.iter().filter(|it| it.1 != Json::Null) {
        match &key[..] {
            b"$schema" if json.as_str().is_none() => return Err(wrong_kind(json, "a string")),
            b"categories" => known_keys(map(json, "a map")?, CATEGORIES, "variant")?,
            b"settings" => map(json, "struct WellKnownOxlintSettings").map(|_| ())?,
            b"options" => options(json)?,
            b"extends" => {
                let is_known = |it: &&Json| it.as_str().is_some() || it.as_object().is_some();
                if let Some(other) = sequence(json)?.iter().find(|it| !is_known(it)) {
                    return Err(wrong_kind(other, "path string"));
                }
            }
            b"overrides" => {
                for item in sequence(json)? {
                    let entries = map(item, "struct OxlintOverride")?;
                    known_keys(entries, KEYS_OF_OVERRIDES, "field")?;
                    if item.get(b"files").is_none() {
                        return Err(refusal(&[b"missing field `files`"]));
                    }
                    let mut entries = entries.iter().filter(|it| it.1 != Json::Null);
                    entries.try_for_each(|it| value(&it.0, &it.1))?;
                }
            }
            key => value(key, json)?,
        }
    }
    Ok(())
}
