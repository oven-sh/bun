//! The configuration files of ESLint 8 (`.eslintrc.*`, `eslintConfig` in a `package.json`): what `ConfigArrayFactory` of
//! `@eslint/eslintrc` makes of them, as the objects of a flat configuration.
//!
//! A file becomes a list of elements: those of what it extends, its own, those of its overrides. The later overrides the
//! earlier. The files of a directory and of those above it, up to one with `root`, are one list, the outermost first.
//!
//! 1. [`Legacy::config_data`]: the elements, as `ConfigArrayFactory` makes them.
//! 2. [`Legacy::validate_elements`]: `ConfigValidator.validateConfigArray`, which looks at all of them, whatever files they are for.
//! 3. [`Legacy::convert`]: an object of a flat configuration for each.
//! 4. [`resolve`]: for the elements that are for a file, what `Linter` of ESLint 8 makes of `env` and `parserOptions`.

use super::flat::{ConfigError, LoadLocatedPlugin, Reader, Semantics};
use super::ignore_lines::IgnoreLines;
use super::merge::RuleSetting;
use super::rc::strings_of;
use super::{Config, ConfigObject, eslint8, presets};
use crate::context::Severity;
use crate::js_plugin;
use crate::language::Global;
use crate::linter::message::{RuleId, write_js_string};
use crate::linter::registry::{Registry, parse_rule_id};
use crate::linter::resolved::{ConfiguredRule, ResolvedConfig, find_js_rule};
use crate::linter::{schema, write_json};
use crate::options::Json;
use crate::paths::{self, Style};
use bun_core::strings;
use std::sync::Arc;

/// A configuration file, or what stands for one: `.eslintignore`, the command line.
pub struct LegacyFile {
    /// Absolute. What it names is looked for from here.
    pub path: Vec<u8>,
    /// What a message calls it.
    pub name: Vec<u8>,
    /// What its patterns are relative to, absolute.
    pub base_path: Vec<u8>,
    pub json: Json,
}

/// What a file names that is not in it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LegacyKind {
    /// In `extends`. The answer: `{ "path", "config" }`.
    Config,
    /// In `plugins`, or in `extends` after `plugin:`. The name is the long one: `eslint-plugin-a`. The answer:
    /// `{ "path", "name", "configs", "environments", "processors", "location" }`, `name` being what `plugins` of a flat
    /// configuration has for it, `processors` their names, and `location` what `$jsPlugins` has. One that is implemented here
    /// has `name` alone.
    Plugin,
    /// `parser`. The answer: `{ "name", "path", "location" }`: what `languageOptions.parser` has for it, its file, and what
    /// `$parser` has. One that is read here has no `location`.
    Parser,
}

/// Why what a file names cannot be used.
pub struct LegacyFailure {
    /// `error.message`. For a configuration that is found and cannot be read: with `Cannot read config file: ` and its path.
    pub message: Vec<u8>,
    /// Nothing is found by the name: `MODULE_NOT_FOUND`, and not for something that the module requires.
    pub is_missing: bool,
}

/// Finds what a file names. It is given the kind, the name, [`LegacyFile::path`] of the file that names it, and that of the file
/// among those given to [`Config::from_legacy`] which that is, or which extends it: ESLint looks for plugins from the directory
/// of the latter.
pub type LoadLegacy<'l> =
    dyn FnMut(LegacyKind, &[u8], &[u8], &[u8]) -> Result<Json, LegacyFailure> + 'l;

/// What does not depend on the files.
pub struct LegacyOptions<'o> {
    /// A directory that all files are in.
    pub root: &'o [u8],
    /// The working directory.
    pub cwd: &'o [u8],
    /// Not `--no-ignore`: `ignorePatterns` count.
    pub ignore: bool,
    /// `--ext`: what is linted of a directory.
    pub extensions: Option<&'o [Vec<u8>]>,
    /// `--rulesdir`: what `$jsPlugins` has for a plugin, for the rules that have no prefix. ESLint looks among them before it looks
    /// among its own. Its `rules` has their names as keys.
    pub rules: Option<&'o Json>,
    /// `--resolve-plugins-relative-to`, absolute. It is only named in messages here.
    pub plugins_from: Option<&'o [u8]>,
    /// How many of the files, from the first, are those of the directories. What one of them extends can have `root`, too.
    pub cascade: usize,
}

/// `DotPatterns` of `IgnorePattern`. For ESLint these are lines of a `.gitignore`.
const DOT_PATTERNS: [&[u8]; 3] = [b".*", b"!.eslintrc.*", b"!../"];
/// `DefaultPatterns`
const DEFAULT_PATTERNS: [&[u8]; 1] = [b"/**/node_modules/*"];

/// The name of the element that the flags of the command line make.
const COMMAND_LINE: &[u8] = b"CLIOptions";

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

fn text(text: &[u8]) -> Json {
    Json::String(text.to_vec())
}

fn put(json: &mut Json, key: &[u8], value: Json) {
    if !matches!(json, Json::Object(_)) {
        *json = Json::Object(Vec::new());
    }
    if let Json::Object(entries) = json {
        match entries.iter_mut().find(|it| it.0 == key) {
            Some(entry) => entry.1 = value,
            None => entries.push((key.to_vec(), value)),
        }
    }
}

/// Takes what `json` has for `key` out of it.
fn take(json: &mut Json, key: &[u8]) -> Option<Json> {
    let Json::Object(entries) = json else {
        return None;
    };
    let at = entries.iter().position(|it| it.0 == key)?;
    Some(entries.remove(at).1)
}

// ───────────────────────────── what has changed since ESLint 8 ─────────────────────────────

/// The options that rules had by default in ESLint 8 and no longer have.
const DEFAULTS_OF_ESLINT_8: &[u8] = br#"{
    "no-constant-condition": [{ "checkLoops": true }],
    "no-implicit-coercion": [{ "allow": ["- -", "-"] }],
    "no-inner-declarations": ["functions", { "blockScopedFunctions": "disallow" }],
    "no-shadow-restricted-names": [{ "reportGlobalThis": false }],
    "no-unused-vars": [{ "caughtErrors": "none" }],
    "no-useless-computed-key": [{ "enforceForClassMembers": false }]
}"#;

fn defaults_of_eslint_8() -> Json {
    crate::json::parse(DEFAULTS_OF_ESLINT_8).unwrap_or(Json::Null)
}

/// The same for the rules of typescript-eslint, which are those of version 8 here, by the major version that is installed: up to
/// 5, and 6 and 7, which have the same.
const DEFAULTS_OF_TYPESCRIPT_ESLINT: &[u8] = br#"{
    "5": {
        "no-floating-promises": [{ "checkThenables": true }],
        "no-shadow": [{ "hoist": "functions" }],
        "no-unused-vars": [{ "caughtErrors": "none" }],
        "prefer-nullish-coalescing": [{ "ignoreMixedLogicalExpressions": true, "ignoreTernaryTests": true }],
        "require-array-sort-compare": [{ "ignoreStringArrays": false }],
        "restrict-plus-operands": [{
            "allowAny": false,
            "allowBoolean": false,
            "allowNullish": false,
            "allowNumberAndString": false,
            "allowRegExp": false,
            "skipCompoundAssignments": true
        }],
        "restrict-template-expressions": [{
            "allow": [],
            "allowAny": false,
            "allowBoolean": false,
            "allowNullish": false,
            "allowRegExp": false
        }],
        "strict-boolean-expressions": [{ "allowNullableEnum": true }]
    },
    "6": {
        "no-floating-promises": [{ "checkThenables": true }],
        "no-shadow": [{ "hoist": "functions" }],
        "no-unused-vars": [{ "caughtErrors": "none" }],
        "only-throw-error": [{ "allowRethrowing": false }],
        "prefer-nullish-coalescing": [{ "ignoreConditionalTests": false }],
        "restrict-template-expressions": [{ "allow": [] }]
    }
}"#;

/// Puts `setting`, which is for the rule `id`, into the words of version 8 of typescript-eslint, if it has an option that only
/// version `major` and those before it take.
fn in_the_words_of_today(major: u32, id: &[u8], setting: &mut Json) {
    let Json::Array(setting) = setting else {
        return;
    };
    let Some(Json::Object(options)) = setting.get_mut(1) else {
        return;
    };
    match id {
        b"@typescript-eslint/restrict-plus-operands" if major <= 5 => {
            for (key, value) in options {
                if let Json::Bool(checks) = value
                    && key[..] == *b"checkCompoundAssignments"
                {
                    *key = b"skipCompoundAssignments".to_vec();
                    *checks = !*checks;
                }
            }
        }
        // It says nothing to the rule.
        b"@typescript-eslint/explicit-module-boundary-types" if major <= 5 => {
            options.retain(|it| it.0 != b"shouldTrackReferences" || !matches!(it.1, Json::Bool(_)))
        }
        // The rule asks whether it is "always".
        b"@typescript-eslint/no-empty-object-type" => {
            for (key, value) in options {
                if key[..] == *b"allowObjectTypes" && *value == text(b"in-type-alias-with-name") {
                    *value = text(b"never");
                }
            }
        }
        _ => {}
    }
}

/// A setting that turns a rule off and has `options`. A setting that is only a severity keeps them.
fn off_with(options: &Json) -> Json {
    let options = options.as_array().unwrap_or_default().iter().cloned();
    Json::Array(std::iter::once(text(b"off")).chain(options).collect())
}

/// `option` with what `default` has and it says nothing about. A list has the items of both.
fn with_default(default: &Json, option: &Json) -> Json {
    match (default, option) {
        (Json::Object(default), Json::Object(option)) => {
            let mut merged = option.clone();
            for (key, value) in default {
                match merged.iter_mut().find(|it| it.0 == *key) {
                    Some(existing) => existing.1 = with_default(value, &existing.1),
                    None => merged.push((key.clone(), value.clone())),
                }
            }
            Json::Object(merged)
        }
        (Json::Array(default), Json::Array(option)) => {
            let more = default.iter().filter(|it| !option.contains(it));
            Json::Array(option.iter().chain(more).cloned().collect())
        }
        _ => option.clone(),
    }
}

/// The options to give the rule `id` of today for it to do what that of ESLint 8 does with `options`, which are not empty.
/// `defaults`: [`Legacy::defaults`].
fn options_for_today(defaults: &Json, id: &[u8], options: &[Json]) -> Vec<Json> {
    let Some(defaults) = defaults.get(id).and_then(Json::as_array) else {
        return options.to_vec();
    };
    let written = |at: usize| match (id, options.get(at)?) {
        (b"no-unused-vars" | b"@typescript-eslint/no-unused-vars", vars @ Json::String(_)) => {
            Some(object(vec![(b"vars", vars.clone())]))
        }
        (_, option) => Some(option.clone()),
    };
    (0..defaults.len().max(options.len()))
        .filter_map(|at| match (defaults.get(at), written(at)) {
            (Some(default), Some(option)) => Some(with_default(default, &option)),
            (default, option) => option.or_else(|| default.cloned()),
        })
        .collect()
}

/// `parserOptions.ecmaVersion` of an environment.
fn version_of_environment(name: &[u8]) -> Option<f64> {
    let year: u32 = match name {
        b"es6" => 2015,
        _ => std::str::from_utf8(name.strip_prefix(b"es")?)
            .ok()?
            .parse()
            .ok()?,
    };
    (2015..=2024)
        .contains(&year)
        .then(|| f64::from(year - 2009))
}

// ───────────────────────────── names ─────────────────────────────

/// `naming.normalizePackageName(name, prefix)`
fn normalize_package_name(name: &[u8], prefix: &[u8]) -> Vec<u8> {
    let name = strings::replace_owned(name, b"\\", b"/");
    let dashed = [prefix, b"-"].concat();
    if let [b'@', scoped @ ..] = &name[..] {
        // `@scope` and `@scope/`, `@scope/prefix`, `@scope/name`
        let changed = match strings::index_of_char_usize(scoped, b'/') {
            // There is no scope.
            _ if scoped.is_empty() || scoped.starts_with(b"/") => None,
            None => Some([&name[..], b"/", prefix].concat()),
            Some(slash) if slash + 1 == scoped.len() => Some([&name[..], prefix].concat()),
            Some(slash) => {
                let (scope, rest) = (&name[..slash + 2], &scoped[slash + 1..]);
                let first = strings::split(rest, b"/").next().unwrap_or_default();
                let is_long = first == prefix || rest.starts_with(&dashed);
                (!is_long).then(|| [scope, &dashed, rest].concat())
            }
        };
        return changed.unwrap_or(name);
    }
    match name.starts_with(&dashed) {
        true => name,
        false => [&dashed[..], &name].concat(),
    }
}

/// `naming.getShorthandName(name, prefix)`
fn shorthand_name(name: &[u8], prefix: &[u8]) -> Vec<u8> {
    let dashed = [prefix, b"-"].concat();
    if let [b'@', scoped @ ..] = name
        && let Some(slash) = strings::index_of_char_usize(scoped, b'/').filter(|it| *it > 0)
    {
        let (scope, rest) = (&name[..slash + 1], &scoped[slash + 1..]);
        if rest == prefix {
            return scope.to_vec();
        }
        if let Some(short) = rest.strip_prefix(&dashed[..]).filter(|it| !it.is_empty()) {
            return [scope, b"/", short].concat();
        }
        return name.to_vec();
    }
    name.strip_prefix(&dashed[..]).unwrap_or(name).to_vec()
}

/// `isFilePath`
fn is_file_path(name: &[u8]) -> bool {
    matches!(
        name,
        [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..]
    ) || paths::is_absolute_as(Style::Windows, name)
}

// ───────────────────────────── the words of ESLint ─────────────────────────────

/// An error of ESLint. What `_loadExtends` adds to the message of one with a `messageTemplate` is not printed.
struct Thrown {
    message: Vec<u8>,
    has_template: bool,
}

/// `messages/extend-config-missing.js`
fn config_missing(name: &[u8], importer: &[u8]) -> ConfigError {
    ConfigError::new(&[
        b"ESLint couldn't find the config \"",
        name,
        b"\" to extend from. Please check that the name of the config is correct.\n\nThe config \"",
        name,
        b"\" was referenced from the config file in \"",
        importer,
        b"\".",
    ])
}

/// `messages/plugin-invalid.js`
fn plugin_invalid(name: &[u8], importer: &[u8]) -> ConfigError {
    let without_prefix = name.strip_prefix(b"plugin:").unwrap_or(name);
    ConfigError::new(&[
        b"\"",
        name,
        b"\" is invalid syntax for a config specifier.\n\n* If your intention is to extend from a configuration exported from the plugin, add the configuration name after a slash: e.g. \"",
        name,
        b"/myConfig\".\n* If this is the name of a shareable config instead of a plugin, remove the \"plugin:\" prefix: i.e. \"",
        without_prefix,
        b"\".\n\n\"",
        name,
        b"\" was referenced from the config file in \"",
        importer,
        b"\".",
    ])
}

/// `messages/plugin-missing.js`
fn plugin_missing(request: &[u8], from: &[u8], importer: &[u8]) -> Vec<u8> {
    [
        b"ESLint couldn't find the plugin \"",
        request,
        b"\".\n\n(The package \"",
        request,
        b"\" was not found when loaded as a Node module from the directory \"",
        from,
        b"\".)\n\nIt's likely that the plugin isn't installed correctly.\n\nThe plugin \"",
        request,
        b"\" was referenced from the config file in \"",
        importer,
        b"\".",
    ]
    .concat()
}

/// `messages/whitespace-found.js`
fn whitespace_found(request: &[u8]) -> Vec<u8> {
    [
        b"ESLint couldn't find the plugin \"",
        request,
        b"\". because there is whitespace in the name. Please check your configuration and remove all whitespace from the plugin name.",
    ]
    .concat()
}

/// `messages/plugin-conflict.js`. Each: the file of the plugin, and the name of the element that has it.
fn plugin_conflict(id: &[u8], plugins: [(&[u8], &[u8]); 2]) -> Vec<u8> {
    let mut message = [
        b"ESLint couldn't determine the plugin \"",
        id,
        b"\" uniquely.\n",
    ]
    .concat();
    for (file, importer) in plugins {
        message.extend_from_slice(&[b"\n- ", file, b" (loaded in \"", importer, b"\")"].concat());
    }
    message.extend_from_slice(
        b"\n\nPlease remove the \"plugins\" setting from either config or remove either plugin installation.",
    );
    message
}

/// `JSON.stringify(value)`. There is nothing to write of a function.
fn printed(value: &Json) -> Vec<u8> {
    if value.get(b"$unserializable").is_some() {
        return b"undefined".to_vec();
    }
    let mut text = Vec::new();
    write_json(&mut text, value);
    text
}

/// `util.inspect(value)` with `"` for `'`, on one line.
fn inspect(value: &Json, depth: usize, out: &mut Vec<u8>) {
    let is_identifier = |key: &[u8]| {
        key.first().is_some_and(|it| !it.is_ascii_digit())
            && (key.iter()).all(|it| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$'))
    };
    match value {
        Json::String(value) => out.extend_from_slice(&[b"\"", &value[..], b"\""].concat()),
        Json::Array(items) if items.is_empty() => out.extend_from_slice(b"[]"),
        Json::Object(entries) if entries.is_empty() => out.extend_from_slice(b"{}"),
        Json::Array(_) if depth > 2 => out.extend_from_slice(b"[Array]"),
        Json::Object(_) if depth > 2 => out.extend_from_slice(b"[Object]"),
        Json::Array(items) => {
            for (at, item) in items.iter().enumerate() {
                out.extend_from_slice(if at == 0 { b"[ " } else { b", " });
                inspect(item, depth + 1, out);
            }
            out.extend_from_slice(b" ]");
        }
        Json::Object(entries) => {
            for (at, (key, item)) in entries.iter().enumerate() {
                out.extend_from_slice(if at == 0 { b"{ " } else { b", " });
                match is_identifier(key) {
                    true => out.extend_from_slice(key),
                    false => out.extend_from_slice(&[b"\"", &key[..], b"\""].concat()),
                }
                out.extend_from_slice(b": ");
                inspect(item, depth + 1, out);
            }
            out.extend_from_slice(b" }");
        }
        value => write_js_string(out, value),
    }
}

// ───────────────────────────── `validateConfigSchema` ─────────────────────────────

/// What `formatErrors` makes of an error of the keyword `type`.
fn wrong_type(field: &[u8], expected: &[u8], value: &Json) -> Vec<u8> {
    [
        b"Property \"",
        field,
        b"\" is the wrong type (expected ",
        expected,
        b" but got `",
        &printed(value),
        b"`)",
    ]
    .concat()
}

/// The same of an error of another keyword.
fn invalid(field: &[u8], message: &[u8], value: &Json) -> Vec<u8> {
    [b"\"", field, b"\" ", message, b". Value: ", &printed(value)].concat()
}

/// `#/definitions/stringOrStrings`, or `stringOrStringsRequired`, which has `minItems`: 1.
fn string_or_strings(field: &[u8], value: &Json, min_items: usize) -> Vec<Vec<u8>> {
    let of_list = match value {
        Json::String(_) => return Vec::new(),
        Json::Array(items) if items.len() < min_items => {
            invalid(field, b"should NOT have fewer than 1 items", value)
        }
        Json::Array(items) => {
            let Some((at, item)) = (items.iter().enumerate()).find(|it| it.1.as_str().is_none())
            else {
                return Vec::new();
            };
            let field = [field, b"[", at.to_string().as_bytes(), b"]"].concat();
            wrong_type(&field, b"string", item)
        }
        _ => wrong_type(field, b"array", value),
    };
    vec![
        wrong_type(field, b"string", value),
        of_list,
        invalid(field, b"should match exactly one schema in oneOf", value),
    ]
}

/// What a property of a configuration has to be.
#[derive(Copy, Clone)]
enum Expected {
    Boolean,
    String,
    StringOrNull,
    Object,
    Array,
    Strings,
    /// `files`
    StringsRequired,
    Overrides,
}

/// `baseConfigProperties`, in the order in which Ajv looks at them.
const PROPERTIES: [(&[u8], Expected); 14] = [
    (b"$schema", Expected::String),
    (b"env", Expected::Object),
    (b"extends", Expected::Strings),
    (b"globals", Expected::Object),
    (b"overrides", Expected::Overrides),
    (b"parser", Expected::StringOrNull),
    (b"parserOptions", Expected::Object),
    (b"plugins", Expected::Array),
    (b"processor", Expected::String),
    (b"rules", Expected::Object),
    (b"settings", Expected::Object),
    (b"noInlineConfig", Expected::Boolean),
    (b"reportUnusedDisableDirectives", Expected::Boolean),
    (b"ecmaFeatures", Expected::Object),
];
/// What only `#/definitions/objectConfig` has.
const PROPERTIES_OF_FILE: [(&[u8], Expected); 2] = [
    (b"root", Expected::Boolean),
    (b"ignorePatterns", Expected::Strings),
];
/// What only `#/definitions/overrideConfig` has.
const PROPERTIES_OF_OVERRIDE: [(&[u8], Expected); 2] = [
    (b"excludedFiles", Expected::Strings),
    (b"files", Expected::StringsRequired),
];

/// The errors that Ajv has for `json`, which is at `at` in a configuration, as `formatErrors` writes them. It stops at the first
/// thing that is wrong.
fn problems_of(json: &Json, at: &[u8], own: &[(&[u8], Expected); 2]) -> Vec<Vec<u8>> {
    let entries = match json.as_object() {
        Some(entries) if json.get(b"$unserializable").is_none() => entries,
        _ => return vec![wrong_type(at, b"object", json)],
    };
    let field = |key: &[u8]| match at {
        b"" => key.to_vec(),
        at => [at, b".", key].concat(),
    };
    let properties = || own.iter().chain(&PROPERTIES);
    if let Some((key, _)) = (entries.iter()).find(|it| !properties().any(|known| known.0 == it.0)) {
        return vec![[b"Unexpected top-level property \"", &field(key)[..], b"\""].concat()];
    }
    for &(key, expected) in properties() {
        let field = field(key);
        let Some(value) = json.get(key) else {
            if matches!(expected, Expected::StringsRequired) {
                return vec![invalid(at, b"should have required property 'files'", json)];
            }
            continue;
        };
        let of_type = |is_it: bool, name: &[u8]| match is_it {
            true => Vec::new(),
            false => vec![wrong_type(&field, name, value)],
        };
        let problems = match expected {
            Expected::Boolean => of_type(value.as_bool().is_some(), b"boolean"),
            Expected::String => of_type(value.as_str().is_some(), b"string"),
            Expected::StringOrNull => of_type(
                value.as_str().is_some() || *value == Json::Null,
                b"string/null",
            ),
            Expected::Object => of_type(value.as_object().is_some(), b"object"),
            Expected::Array => of_type(value.as_array().is_some(), b"array"),
            Expected::Strings => string_or_strings(&field, value, 0),
            Expected::StringsRequired => string_or_strings(&field, value, 1),
            Expected::Overrides => match value.as_array() {
                None => vec![wrong_type(&field, b"array", value)],
                Some(items) => (items.iter().enumerate())
                    .map(|(index, item)| {
                        let at = [&field[..], b"[", index.to_string().as_bytes(), b"]"].concat();
                        problems_of(item, &at, &PROPERTIES_OF_OVERRIDE)
                    })
                    .find(|it| !it.is_empty())
                    .unwrap_or_default(),
            },
        };
        if !problems.is_empty() {
            return problems;
        }
    }
    Vec::new()
}

/// `validateConfigSchema`
fn validate_schema(json: &Json, context: &Context) -> Result<(), ConfigError> {
    // The flag has a severity, and goes another way in ESLint.
    let without_flag = (context.name == COMMAND_LINE).then(|| {
        let mut json = json.clone();
        take(&mut json, b"reportUnusedDisableDirectives");
        json
    });
    let problems = problems_of(
        without_flag.as_ref().unwrap_or(json),
        b"",
        &PROPERTIES_OF_FILE,
    );
    if problems.is_empty() {
        return Ok(());
    }
    let source = match context.name.is_empty() {
        true => &context.path,
        false => &context.name,
    };
    let mut message = [b"ESLint configuration in ", &source[..], b" is invalid:\n"].concat();
    for problem in problems {
        message.extend_from_slice(&[b"\t- ", &problem[..], b".\n"].concat());
    }
    Err(ConfigError { message })
}

// ───────────────────────────── `validateRuleOptions` ─────────────────────────────

/// `0`, `1`, `2`, `"off"`, `"warn"`, `"error"`, the words in any case of letters.
fn severity_of(value: &Json) -> Option<Severity> {
    match value {
        Json::String(word) => crate::linter::severity_of(&Json::String(word.to_ascii_lowercase())),
        value => crate::linter::severity_of(value),
    }
}

/// What ESLint has for the name of a rule.
#[derive(Copy, Clone)]
enum Definition<'r> {
    /// Nothing.
    Missing,
    /// A rule of a plugin that is written in JavaScript.
    Js(&'r js_plugin::Rule),
    /// A rule of its own, or of a plugin that is implemented here.
    Native,
}

/// `validateRuleOptions` without a source. `Ok`: the severity. `Err`: the message.
fn validate_rule(id: &[u8], value: &Json, definition: Definition) -> Result<Severity, Vec<u8>> {
    let items: &[Json] = match value {
        Json::Array(items) => items,
        value => std::slice::from_ref(value),
    };
    let fail =
        |lines: &[u8]| Err([b"Configuration for rule \"", id, b"\" is invalid:\n", lines].concat());
    let Some(severity) = items.first().and_then(severity_of) else {
        let mut passed = Vec::new();
        match items.first() {
            Some(first) => inspect(first, 0, &mut passed),
            None => passed.extend_from_slice(b"undefined"),
        }
        return fail(&[
            b"\tSeverity should be one of the following: 0 = off, 1 = warn, 2 = error (you passed '",
            &passed[..],
            b"').\n",
        ]
        .concat());
    };
    let options = items.get(1..).unwrap_or_default();
    if severity == Severity::Off {
        return Ok(severity);
    }
    let validated = match (definition, parse_rule_id(id)) {
        (Definition::Missing, _) => Ok(()),
        (Definition::Js(rule), _) => match &rule.schema {
            js_plugin::Schema::Json(schema) => schema::validate_as_eslint_8(Some(schema), options),
            // ESLint 8 validates nothing without a schema.
            js_plugin::Schema::None | js_plugin::Schema::Any => Ok(()),
        },
        (Definition::Native, (b"", name)) => {
            let schema = eslint8::schema_of(name).or_else(|| schema::schema_of(id));
            schema::validate_as_eslint_8(schema.as_ref(), options)
        }
        (Definition::Native, _) => match schema::schema_of(id) {
            Some(_) => schema::validate_by_id(id, options),
            None => Ok(()),
        },
    };
    let Err(lines) = validated else {
        return Ok(severity);
    };
    // ESLint 8 does not say which property it did not expect.
    let mut kept = Vec::with_capacity(lines.len());
    for line in
        strings::split(&lines, b"\n").filter(|it| !it.is_empty() && !it.starts_with(b"\t\t"))
    {
        kept.extend_from_slice(&[line, b"\n"].concat());
    }
    fail(&kept)
}

/// Whether the plugin that ESLint calls `id` is implemented here, in whole or in part.
fn is_implemented_here(id: &[u8]) -> bool {
    crate::rule::Plugin::answers_in_place_of(id, None)
}

/// Whether ESLint 8 has no definition of the rule called `id`. `has_plugin`: whether the elements have a plugin with that id.
/// `js_plugins`: those of them of which it is known what is in them.
fn lacks_rule(
    id: &[u8],
    has_plugin: &dyn Fn(&[u8]) -> bool,
    js_plugins: &[Arc<js_plugin::Plugin>],
) -> bool {
    let (prefix, name) = parse_rule_id(id);
    let is_its_own = prefix.is_empty() && eslint8::has_rule(name);
    match find_js_rule(js_plugins, id) {
        Some(found) => found.is_none() && !is_its_own,
        None if prefix.is_empty() => !is_its_own,
        None => {
            use crate::rule::Plugin;
            !Plugin::of_prefix(prefix).is_some_and(Plugin::is_always_there) && !has_plugin(prefix)
        }
    }
}

fn definition_of<'r>(
    id: &[u8],
    has_plugin: &dyn Fn(&[u8]) -> bool,
    js_plugins: &'r [Arc<js_plugin::Plugin>],
) -> Definition<'r> {
    match find_js_rule(js_plugins, id).flatten() {
        Some(rule) => Definition::Js(rule),
        None if lacks_rule(id, has_plugin, js_plugins) => Definition::Missing,
        None => Definition::Native,
    }
}

// ───────────────────────────── `ConfigArrayFactory` ─────────────────────────────

/// A pattern of `overrides[].files`: `new Minimatch(pattern, { dot: true, matchBase: true })`, which matches a pattern without
/// a slash with the name of the file alone. Each `!` at the start turns it into what it does not match.
fn override_pattern(pattern: &[u8]) -> Json {
    let marks = pattern.iter().take_while(|it| **it == b'!').count();
    let (negation, rest): (&[u8], _) = (if marks % 2 == 1 { b"!" } else { b"" }, &pattern[marks..]);
    Json::String(match strings::contains_char(rest, b'/') {
        true => [negation, rest].concat(),
        false => [negation, b"**/", rest].concat(),
    })
}

/// `files` and `excludedFiles` of an override.
#[derive(Clone)]
struct Criterion {
    files: Vec<Json>,
    excluded: Vec<Json>,
    /// `endsWithWildcard`
    ends_with_wildcard: bool,
    /// No pattern has a slash: it does not matter what they are relative to.
    is_by_name: bool,
}

/// `ConfigArrayFactoryLoadingContext`
#[derive(Clone)]
struct Context<'c> {
    /// `filePath`: the file that is read. Empty for what is built in.
    path: Vec<u8>,
    name: Vec<u8>,
    /// [`LegacyFile::path`] of the file that is in the cascade, also in what it extends.
    entry: &'c [u8],
    /// `matchBasePath`: [`LegacyFile::base_path`] of the same.
    base_path: &'c [u8],
    /// `pluginBasePath`
    plugins_from: &'c [u8],
    /// `type` is `"implicit-processor"`.
    is_implicit_processor: bool,
    /// Of the overrides that this is in. All have to match.
    criteria: Vec<Criterion>,
    depth: usize,
}

/// What has been asked of [`LoadLegacy`] about a plugin.
struct LoadedPlugin {
    request: Vec<u8>,
    /// [`Context::plugins_from`]
    from: Vec<u8>,
    /// [`Context::entry`]: an answer has the configurations that this file extends.
    entry: Vec<u8>,
    answer: Result<Json, LegacyFailure>,
}

/// `IgnorePattern` of `@eslint/eslintrc`: lines of a `.gitignore` in `base_path`, which is absolute.
struct IgnorePattern {
    lines: Vec<Vec<u8>>,
    base_path: Vec<u8>,
}

impl IgnorePattern {
    /// `getPatternsRelativeTo`
    fn add_lines_relative_to(&self, base_path: &[u8], out: &mut Vec<Vec<u8>>) {
        if base_path == &self.base_path[..] {
            out.extend(self.lines.iter().cloned());
            return;
        }
        let prefix = paths::relative_to_base(base_path, &self.base_path);
        for line in &self.lines {
            let (head, body): (&[u8], &[u8]) = match line.strip_prefix(b"!") {
                Some(body) => (b"!", body),
                None => (b"", &line[..]),
            };
            let everywhere: &[u8] = match body.starts_with(b"/") || body.starts_with(b"../") {
                true => b"",
                false => b"/**/",
            };
            out.push([head, b"/", &prefix, everywhere, body].concat());
        }
    }
}

/// `getCommonAncestorPath`
fn common_ancestor(patterns: &[IgnorePattern]) -> &[u8] {
    let mut paths = patterns.iter().map(|it| &it.base_path[..]);
    let mut result = paths.next().unwrap_or_default();
    for b in paths {
        let a = result;
        result = if a.len() < b.len() { a } else { b };
        let mut last_separator = 0;
        for (at, (in_a, in_b)) in a.iter().zip(b).enumerate() {
            if in_a != in_b {
                result = &a[..last_separator];
                break;
            }
            if *in_a == b'/' {
                last_separator = at;
            }
        }
    }
    if result.is_empty() { b"/" } else { result }
}

/// `DependentPlugin`
struct PluginUse {
    /// The short name, which the rules have as a prefix.
    id: Vec<u8>,
    /// `importerName`
    importer: Vec<u8>,
    /// Which of [`Legacy::plugins`]. `Err`: what ESLint throws for a file that the element is for.
    plugin: Result<usize, Thrown>,
}

/// `DependentParser`
struct ParserUse {
    /// What `languageOptions.parser` has for it.
    name: Json,
    /// `$parser`, if it is not read here.
    location: Option<Json>,
    /// What ESLint throws for a file of which this is the parser.
    error: Option<Vec<u8>>,
}

/// `ConfigArrayElement`
struct Element<'c> {
    name: Vec<u8>,
    base_path: &'c [u8],
    criteria: Vec<Criterion>,
    /// `type` is `"config"`.
    is_config: bool,
    root: Option<bool>,
    env: Option<Json>,
    globals: Option<Json>,
    ignore_patterns: Vec<Vec<u8>>,
    no_inline_config: Option<bool>,
    parser: Option<ParserUse>,
    parser_options: Option<Json>,
    plugins: Option<Vec<PluginUse>>,
    processor: Option<Vec<u8>>,
    report_unused_disable_directives: Option<Json>,
    rules: Option<Json>,
    settings: Option<Json>,
}

/// A plugin that the elements have.
struct NamedPlugin {
    id: Box<[u8]>,
    /// Which of [`Legacy::plugins`].
    at: usize,
}

/// `initPluginMemberMaps`: the plugins that the elements have, each id once.
struct Named(Vec<NamedPlugin>);

impl Named {
    fn has(&self, id: &[u8]) -> bool {
        self.0.iter().any(|it| *it.id == *id)
    }

    fn of(elements: &[Element]) -> Named {
        let mut named = Named(Vec::new());
        for used in elements
            .iter()
            .filter_map(|it| it.plugins.as_ref())
            .flatten()
        {
            if let Ok(at) = used.plugin
                && !named.has(&used.id)
            {
                let id = used.id[..].into();
                named.0.push(NamedPlugin { id, at });
            }
        }
        named
    }
}

struct Legacy<'r, 'l, 'c> {
    reader: Reader<'r>,
    load: &'l mut LoadLegacy<'l>,
    options: &'c LegacyOptions<'c>,
    plugins: Vec<LoadedPlugin>,
    elements: Vec<Element<'c>>,
    /// [`DEFAULTS_OF_ESLINT_8`], and of [`DEFAULTS_OF_TYPESCRIPT_ESLINT`] what is for the version that is installed. The keys are the
    /// ids of the rules.
    defaults: Json,
    /// `ignorePatterns` of the elements, in their order.
    ignored: Vec<IgnorePattern>,
    /// The major version of typescript-eslint that is installed, if it is before 8.
    typescript_eslint: Option<u32>,
    /// How often something has been extended.
    extended: usize,
}

impl<'c> Legacy<'_, '_, 'c> {
    /// `_normalizeConfigData`
    fn config_data(&mut self, json: &Json, context: &Context<'c>) -> Result<(), ConfigError> {
        validate_schema(json, context)?;
        self.object_data(json, context)
    }

    /// `_normalizeObjectConfigData`
    fn object_data(&mut self, json: &Json, context: &Context<'c>) -> Result<(), ConfigError> {
        let patterns = |key: &[u8]| {
            let mut patterns = strings_of(json.get(key));
            patterns.retain(|it| !it.is_empty());
            patterns
        };
        let (files, excluded) = (patterns(b"files"), patterns(b"excludedFiles"));
        if files.is_empty() {
            return self.body(json, context);
        }
        for pattern in files.iter().chain(&excluded) {
            if paths::is_absolute_as(Style::Windows, pattern) || strings::contains(pattern, b"..") {
                return Err(ConfigError::new(&[
                    b"Invalid override pattern (expected relative path not containing '..'): ",
                    pattern,
                ]));
            }
        }
        let mut all = files.iter().chain(&excluded);
        let mut context = context.clone();
        context.criteria.push(Criterion {
            ends_with_wildcard: files.iter().any(|it| it.ends_with(b"*")),
            is_by_name: all.all(|it| !strings::contains_char(it, b'/')),
            files: files.iter().map(|it| override_pattern(it)).collect(),
            excluded: excluded.iter().map(|it| override_pattern(it)).collect(),
        });
        self.body(json, &context)
    }

    /// What [`LoadLegacy`] has answered about the plugin at `at`.
    fn answer(&self, at: usize) -> Option<&Json> {
        self.plugins.get(at)?.answer.as_ref().ok()
    }

    /// `_loadPlugin`. `name`: as it is written.
    fn plugin(&mut self, name: &[u8], context: &Context<'c>) -> PluginUse {
        let request = normalize_package_name(name, b"eslint-plugin");
        let id = shorthand_name(&request, b"eslint-plugin");
        let importer = context.name.clone();
        if (0..name.len()).any(|at| strings::js_whitespace_len(&name[at..]) > 0) {
            let thrown = Thrown {
                message: whitespace_found(&request),
                has_template: true,
            };
            return PluginUse {
                id,
                importer,
                plugin: Err(thrown),
            };
        }
        let (from, entry) = (context.plugins_from, context.entry);
        let mut known = self.plugins.iter();
        let is_it =
            |it: &LoadedPlugin| it.request == request && it.from == from && it.entry == entry;
        let at = match known.position(is_it) {
            Some(at) => at,
            None => {
                let answer = (self.load)(LegacyKind::Plugin, &request, &context.path, entry);
                self.plugins.push(LoadedPlugin {
                    request: request.clone(),
                    from: from.to_vec(),
                    entry: entry.to_vec(),
                    answer,
                });
                self.plugins.len() - 1
            }
        };
        let plugin = match self.plugins.get(at).map(|it| &it.answer) {
            Some(Err(failure)) if failure.is_missing => Err(Thrown {
                message: plugin_missing(&request, from, &importer),
                has_template: true,
            }),
            Some(Err(failure)) => Err(Thrown {
                message: [
                    b"Failed to load plugin '",
                    name,
                    b"' declared in '",
                    &importer,
                    b"': ",
                    &failure.message,
                ]
                .concat(),
                has_template: false,
            }),
            _ => Ok(at),
        };
        PluginUse {
            id,
            importer,
            plugin,
        }
    }

    /// `_loadPlugins`
    fn plugins(
        &mut self,
        names: &[Json],
        context: &Context<'c>,
    ) -> Result<Vec<PluginUse>, ConfigError> {
        let mut plugins: Vec<PluginUse> = Vec::with_capacity(names.len());
        for name in names {
            let Some(name) = name.as_str() else {
                return Err(ConfigError::new(&[
                    b"The \"path\" argument must be of type string. Received ",
                    &printed(name),
                ]));
            };
            if is_file_path(name) {
                return Err(ConfigError::new(&[
                    b"Plugins array cannot includes file paths.",
                ]));
            }
            let plugin = self.plugin(name, context);
            match plugins.iter_mut().find(|it| it.id == plugin.id) {
                Some(existing) => *existing = plugin,
                None => plugins.push(plugin),
            }
        }
        Ok(plugins)
    }

    /// `_loadParser`
    fn parser(&mut self, name: &[u8], context: &Context<'c>) -> ParserUse {
        match (self.load)(LegacyKind::Parser, name, &context.path, context.entry) {
            Ok(loaded) => ParserUse {
                name: loaded.get(b"name").cloned().unwrap_or_else(|| text(name)),
                location: loaded.get(b"location").cloned(),
                error: None,
            },
            Err(failure) => ParserUse {
                name: text(name),
                location: None,
                error: Some(
                    [
                        b"Failed to load parser '",
                        name,
                        b"' declared in '",
                        &context.name,
                        b"': ",
                        &failure.message,
                    ]
                    .concat(),
                ),
            },
        }
    }

    /// A configuration of typescript-eslint that is built in, which is written for `eslint.config.js`, as it is written for these
    /// files.
    fn preset(&mut self, objects: Vec<Json>, context: &Context<'c>) -> Result<(), ConfigError> {
        for flat in objects {
            let mut config: Vec<(&[u8], Json)> = Vec::new();
            if let Some(plugins) = flat.get(b"plugins").and_then(Json::as_object) {
                let ids = plugins.iter().map(|it| text(&it.0));
                config.push((b"plugins", Json::Array(ids.collect())));
            }
            let language_options = flat.get(b"languageOptions");
            let option = |key: &[u8]| language_options.and_then(|it| it.get(key));
            if option(b"parser").is_some() {
                config.push((b"parser", text(b"@typescript-eslint/parser")));
            }
            let mut parser_options = option(b"parserOptions").cloned().unwrap_or(Json::Null);
            if let Some(source_type) = option(b"sourceType") {
                put(&mut parser_options, b"sourceType", source_type.clone());
            }
            if parser_options != Json::Null {
                config.push((b"parserOptions", parser_options));
            }
            if let Some(rules) = flat.get(b"rules") {
                config.push((b"rules", rules.clone()));
            }
            let config = match flat.get(b"files") {
                Some(files) => {
                    config.push((b"files", files.clone()));
                    object(vec![(b"overrides", Json::Array(vec![object(config)]))])
                }
                None => object(config),
            };
            self.object_data(&config, context)?;
        }
        Ok(())
    }

    /// `_loadExtends`
    fn extends(&mut self, name: &[u8], context: &Context<'c>) -> Result<(), ConfigError> {
        if context.depth >= 32 {
            return Err(ConfigError::new(&[
                &context.name,
                b":\n\tToo many levels of \"extends\".",
            ]));
        }
        // Files that each extend the next one twice are read 2^n times. ESLint reads them.
        self.extended += 1;
        if self.extended > 4096 {
            return Err(ConfigError::new(&[
                &context.name,
                b":\n\tToo many files in \"extends\".",
            ]));
        }
        let referenced = |message: &[u8]| {
            let from = match context.path.is_empty() {
                true => &context.name,
                false => &context.path,
            };
            ConfigError::new(&[message, b"\nReferenced from: ", from])
        };
        let inner = |path: Vec<u8>, what: &[u8]| Context {
            path,
            name: [&context.name[..], " \u{bb} ".as_bytes(), what].concat(),
            depth: context.depth + 1,
            ..context.clone()
        };
        if name.starts_with(b"eslint:") {
            let flag = match name {
                b"eslint:recommended" => eslint8::RECOMMENDED,
                b"eslint:all" => eslint8::ALL,
                _ => return Err(config_missing(name, &context.name)),
            };
            let rules =
                eslint8::rules_with(flag).map(|it| (it.as_bytes().to_vec(), text(b"error")));
            let config = object(vec![(b"rules", Json::Object(rules.collect()))]);
            return self.object_data(&config, &inner(Vec::new(), name));
        }
        if name.starts_with(b"plugin:") {
            let Some(slash) = strings::last_index_of_char(name, b'/') else {
                return Err(plugin_invalid(name, &context.path));
            };
            let (plugin_name, config_name) = (&name[b"plugin:".len()..slash], &name[slash + 1..]);
            if is_file_path(plugin_name) {
                return Err(referenced(b"'extends' cannot use a file path for plugins."));
            }
            let used = self.plugin(plugin_name, context);
            let at = match used.plugin {
                Ok(at) => at,
                Err(thrown) if thrown.has_template => {
                    return Err(ConfigError::new(&[&thrown.message]));
                }
                Err(thrown) => return Err(referenced(&thrown.message)),
            };
            let what = [b"plugin:", &used.id[..], b"/", config_name].concat();
            let answer = self.answer(at);
            let file = answer.and_then(|it| it.get(b"path")?.as_str());
            let is_built_in = file.is_none();
            let inner = inner(
                file.map_or_else(|| context.path.clone(), <[u8]>::to_vec),
                &what,
            );
            if let Some(config) = answer.and_then(|it| it.get(b"configs")?.get(config_name)) {
                let config = config.clone();
                validate_schema(&config, &inner).map_err(|it| referenced(&it.message))?;
                return self.object_data(&config, &inner);
            }
            return match presets::find(&what).filter(|_| is_built_in) {
                Some(objects) => self.preset(objects, &inner),
                None => Err(config_missing(name, &context.path)),
            };
        }
        // What is asked for is spelled as `extend` in evaluate-eslintrc.js files it: who changes one side changes the other.
        let request = if is_file_path(name) {
            paths::portable(&context.path, name)
        } else if name.starts_with(b".") {
            [b"./", name].concat()
        } else {
            normalize_package_name(name, b"eslint-config")
        };
        let loaded = (self.load)(LegacyKind::Config, &request, &context.path, context.entry);
        let loaded = loaded.map_err(|failure| match failure.is_missing {
            true => config_missing(name, &context.path),
            false => referenced(&failure.message),
        })?;
        let file = loaded.get(b"path").and_then(Json::as_str);
        let inner = inner(
            file.map_or_else(|| context.path.clone(), <[u8]>::to_vec),
            &request,
        );
        let null = Json::Null;
        let config = loaded.get(b"config").unwrap_or(&null);
        validate_schema(config, &inner).map_err(|it| referenced(&it.message))?;
        self.object_data(config, &inner)
    }

    /// `_takeFileExtensionProcessors`: a processor that is called like an extension is for the files that have it.
    fn file_extension_processors(
        &mut self,
        plugins: &[PluginUse],
        context: &Context<'c>,
    ) -> Result<(), ConfigError> {
        for used in plugins {
            let answer = used.plugin.as_ref().ok().and_then(|at| self.answer(*at));
            let names = answer.and_then(|it| it.get(b"processors")?.as_array());
            let names = names.unwrap_or_default().iter().filter_map(Json::as_str);
            let extensions: Vec<Vec<u8>> = names
                .filter(|it| it.starts_with(b"."))
                .map(<[u8]>::to_vec)
                .collect();
            for extension in extensions {
                let processor = [&used.id[..], b"/", &extension].concat();
                let name = [&context.name[..], b"#processors[\"", &processor, b"\"]"].concat();
                let config = object(vec![
                    (
                        b"files",
                        Json::Array(vec![text(&[b"*", &extension[..]].concat())]),
                    ),
                    (b"processor", Json::String(processor)),
                ]);
                self.object_data(
                    &config,
                    &Context {
                        name,
                        is_implicit_processor: true,
                        ..context.clone()
                    },
                )?;
            }
        }
        Ok(())
    }

    /// `_normalizeObjectConfigDataBody`
    fn body(&mut self, json: &Json, context: &Context<'c>) -> Result<(), ConfigError> {
        for name in strings_of(json.get(b"extends")) {
            if !name.is_empty() {
                self.extends(name, context)?;
            }
        }
        let parser = json.get(b"parser").and_then(Json::as_str);
        let parser = parser.filter(|it| !it.is_empty());
        let parser = parser.map(|name| self.parser(name, context));
        let plugins = match json.get(b"plugins").and_then(Json::as_array) {
            Some(names) => Some(self.plugins(names, context)?),
            None => None,
        };
        self.file_extension_processors(plugins.as_deref().unwrap_or_default(), context)?;
        let part = |key: &[u8]| json.get(key).cloned();
        let patterns = strings_of(json.get(b"ignorePatterns"));
        self.elements.push(Element {
            name: context.name.clone(),
            base_path: context.base_path,
            criteria: context.criteria.clone(),
            is_config: !context.is_implicit_processor,
            // What `overrides` extend does not end the cascade.
            root: (json.get(b"root").and_then(Json::as_bool))
                .filter(|_| context.criteria.is_empty()),
            env: part(b"env"),
            globals: part(b"globals"),
            ignore_patterns: patterns.into_iter().map(<[u8]>::to_vec).collect(),
            no_inline_config: json.get(b"noInlineConfig").and_then(Json::as_bool),
            parser,
            parser_options: part(b"parserOptions"),
            plugins,
            processor: (json.get(b"processor").and_then(Json::as_str)).map(<[u8]>::to_vec),
            report_unused_disable_directives: part(b"reportUnusedDisableDirectives"),
            rules: part(b"rules"),
            settings: part(b"settings"),
        });
        let overrides = json.get(b"overrides").and_then(Json::as_array);
        for (index, item) in overrides.unwrap_or_default().iter().enumerate() {
            let index = index.to_string();
            let name = [&context.name[..], b"#overrides[", index.as_bytes(), b"]"].concat();
            self.object_data(
                item,
                &Context {
                    name,
                    ..context.clone()
                },
            )?;
        }
        Ok(())
    }

    /// The elements of `file`.
    fn file(&mut self, file: &'c LegacyFile) -> Result<(), ConfigError> {
        let given = self.options.plugins_from;
        self.config_data(
            &file.json,
            &Context {
                path: file.path.clone(),
                name: file.name.clone(),
                entry: &file.path,
                base_path: &file.base_path,
                plugins_from: given.unwrap_or_else(|| paths::dirname(&file.path)),
                is_implicit_processor: false,
                criteria: Vec::new(),
                depth: 0,
            },
        )
    }

    // ───────────────────────────── `ConfigValidator.validateConfigArray` ─────────────────────────────

    /// What the plugins have under `kind`, which is `environments` or `processors`, for `name`, which starts with the id of one.
    /// Also returns which plugin that is, and what it calls it.
    fn member<'n>(
        &self,
        named: &Named,
        kind: &[u8],
        name: &'n [u8],
    ) -> Option<(usize, &'n [u8], &Json)> {
        named.0.iter().find_map(|&NamedPlugin { ref id, at }| {
            let own = name.strip_prefix(&id[..])?.strip_prefix(b"/")?;
            let found = match self.answer(at)?.get(kind)? {
                Json::Array(names) => names.iter().find(|it| it.as_str() == Some(own))?,
                members => members.get(own)?,
            };
            Some((at, own, found))
        })
    }

    /// Lets the reader know the plugins that are written in JavaScript, as far as a file or a comment can need a rule of them.
    fn load_js_plugins(
        &mut self,
        elements: &[Element],
        named: &Named,
        load: &mut LoadLocatedPlugin<'_>,
    ) -> Result<(), ConfigError> {
        if let Some(location) = self.options.rules {
            let locations = &mut self.reader.js_locations;
            locations.push((Box::default(), location.clone()));
        }
        let mut settings = elements.iter().filter_map(|it| it.settings.as_ref());
        self.reader.has_unknown_resolver = settings.any(super::flat::names_unknown_resolver);
        for &NamedPlugin { ref id, at } in &named.0 {
            let said = |key: &[u8]| self.answer(at)?.get(key)?.as_str();
            if let Some(name) = said(b"name").filter(|_| is_implemented_here(id)) {
                // That of typescript-eslint, which is not loaded.
                let name = match said(b"version") {
                    Some(version) => [name, b"@", version].concat(),
                    None => name.to_vec(),
                };
                self.reader.advise_about_version(id, &name);
            }
            let Some(location) = self.answer(at).and_then(|it| it.get(b"location")) else {
                continue;
            };
            let location = location.clone();
            self.reader.js_locations.push((id.clone(), location));
            // All rules of one that is not implemented here are in it, and a comment can switch them on.
            if !is_implemented_here(id) {
                self.reader
                    .unknown_rules
                    .push([&id[..], b"/"].concat().into());
            }
        }
        let rules = elements
            .iter()
            .filter_map(|it| it.rules.as_ref()?.as_object());
        for (id, value) in rules.flatten() {
            let severity = match value {
                Json::Array(items) => items.first().and_then(severity_of),
                value => severity_of(value),
            };
            let is_on = severity.is_some_and(|it| it != Severity::Off);
            // Also for a rule that can hand a file back to it.
            if is_on && (self.reader.native_rule(id)).is_none_or(|it| it.meta.hands_back) {
                self.reader.unknown_rules.push(id[..].into());
            }
        }
        self.reader.load_js_plugins(load)?;
        // Which of them cannot run here is found out when they are read.
        self.reader.unknown_rules.clear();
        Ok(())
    }

    fn validate_elements(&self, elements: &[Element], named: &Named) -> Result<(), ConfigError> {
        for element in elements {
            let name = &element.name[..];
            for (id, _) in element
                .env
                .as_ref()
                .and_then(Json::as_object)
                .unwrap_or_default()
            {
                if self.member(named, b"environments", id).is_none()
                    && !eslint8::has_environment(id)
                {
                    return Err(ConfigError::new(&[
                        name,
                        b":\n\tEnvironment key \"",
                        id,
                        b"\" is unknown\n",
                    ]));
                }
            }
            for (id, value) in element
                .globals
                .as_ref()
                .and_then(Json::as_object)
                .unwrap_or_default()
            {
                if Global::of_json(value).is_none() {
                    let mut written = Vec::new();
                    write_js_string(&mut written, value);
                    return Err(ConfigError::new(&[
                        b"ESLint configuration of global '",
                        id,
                        b"' in ",
                        name,
                        b" is invalid:\n'",
                        &written,
                        b"' is not a valid configuration for a global (use 'readonly', 'writable', or 'off')",
                    ]));
                }
            }
            if let Some(processor) = element.processor.as_deref().filter(|it| !it.is_empty())
                && self.member(named, b"processors", processor).is_none()
            {
                return Err(ConfigError::new(&[
                    b"ESLint configuration of processor in '",
                    name,
                    b"' is invalid: '",
                    processor,
                    b"' was not found.",
                ]));
            }
            for (id, value) in element
                .rules
                .as_ref()
                .and_then(Json::as_object)
                .unwrap_or_default()
            {
                let has_plugin = |id: &[u8]| named.has(id);
                let definition = definition_of(id, &has_plugin, &self.reader.js_plugins);
                validate_rule(id, value, definition)
                    .map_err(|message| ConfigError::new(&[name, b":\n\t", &message]))?;
            }
        }
        Ok(())
    }

    // ───────────────────────────── as a flat configuration ─────────────────────────────

    /// Reads `flat`, an object of a flat configuration without `files`, for the files that all of `criteria` are for. That does not
    /// make ESLint lint these files.
    fn object(
        &mut self,
        mut flat: Json,
        criteria: &[Criterion],
        base_path: &[u8],
    ) -> Result<ConfigObject, ConfigError> {
        if !criteria.is_empty() {
            // One of each has to match: the alternatives of a flat configuration are lists of patterns that all match.
            let mut alternatives: Vec<Vec<Json>> = vec![Vec::new()];
            for criterion in criteria {
                alternatives = (alternatives.iter())
                    .flat_map(|all| {
                        criterion.files.iter().map(move |pattern| {
                            let mut all = all.clone();
                            all.push(pattern.clone());
                            all
                        })
                    })
                    .take(4096)
                    .collect();
            }
            let alternatives = alternatives.into_iter().map(Json::Array);
            put(&mut flat, b"files", Json::Array(alternatives.collect()));
            let excluded = criteria.iter().flat_map(|it| it.excluded.clone());
            let ignores: Vec<Json> = excluded.collect();
            if !ignores.is_empty() {
                put(&mut flat, b"ignores", Json::Array(ignores));
            }
            // ESLint matches the name of a file that is outside, too.
            if !criteria.iter().all(|it| it.is_by_name) {
                put(&mut flat, b"basePath", text(base_path));
            }
        }
        let mut read = self.reader.object(&flat)?;
        for pattern in read.files.iter_mut().flatten().flatten() {
            pattern.is_universal = true;
        }
        Ok(read)
    }

    /// Lines of a `.gitignore` in `base_path`.
    fn ignore_patterns(&mut self, lines: &[&[u8]], base_path: &[u8]) {
        if !lines.is_empty() {
            self.ignored.push(IgnorePattern {
                lines: lines.iter().map(|it| it.to_vec()).collect(),
                base_path: paths::resolve(&self.reader.base_path, base_path),
            });
        }
    }

    /// `IgnorePattern.createIgnore`: `DotPatterns`, which `Dotfiles::Linted` leaves out, and then all other lines. One list
    /// behind the other says what the two in one list say: the last line that matches decides.
    fn ignores(&self) -> [ConfigObject; 2] {
        let base_path = common_ancestor(&self.ignored);
        let mut lines = Vec::new();
        for pattern in &self.ignored {
            pattern.add_lines_relative_to(base_path, &mut lines);
        }
        let lines: Vec<&[u8]> = lines.iter().map(|it| &it[..]).collect();
        [&DOT_PATTERNS[..], &lines[..]].map(|lines| ConfigObject {
            base_path: Some(base_path.to_vec()),
            ignore_lines: Some(IgnoreLines::of_eslint_8(lines)),
            is_global_ignores: true,
            ..ConfigObject::default()
        })
    }

    /// `rules` of an element.
    fn settings(&mut self, rules: &Json, named: &Named) -> Result<Vec<RuleSetting>, ConfigError> {
        let mut settings = Vec::new();
        for (id, value) in rules.as_object().unwrap_or_default() {
            let items: &[Json] = match value {
                Json::Array(items) => items,
                value => std::slice::from_ref(value),
            };
            let Some(severity) = items.first().and_then(severity_of) else {
                continue;
            };
            let options = match items.get(1..).unwrap_or_default() {
                [] => Vec::new(),
                options => options_for_today(&self.defaults, id, options),
            };
            let severity = Json::Number(f64::from(severity as u8));
            let value = Json::Array(std::iter::once(severity).chain(options).collect());
            // It keeps its name, which the message about it has.
            if lacks_rule(id, &|id| named.has(id), &self.reader.js_plugins) {
                settings.extend(RuleSetting::new(id, &value));
                continue;
            }
            let one = Json::Object(vec![(id.clone(), value)]);
            settings.extend(self.reader.rules(&one)?);
        }
        Ok(settings)
    }

    /// Adds the objects that stand for `element`.
    fn convert(&mut self, element: &Element, named: &Named) -> Result<(), ConfigError> {
        if self.options.ignore {
            let patterns: Vec<&[u8]> = element.ignore_patterns.iter().map(|it| &it[..]).collect();
            self.ignore_patterns(&patterns, element.base_path);
        }
        let mut flat: Vec<(&[u8], Json)> = Vec::new();
        let mut language_options: Vec<(&[u8], Json)> = Vec::new();
        // What `resolve` reads.
        let mut own: Vec<(&[u8], Json)> = Vec::new();
        if let Some(parser) = &element.parser {
            language_options.push((b"parser", parser.name.clone()));
            own.push((
                b"parserError",
                parser.error.as_deref().map_or(Json::Null, text),
            ));
            // Also if there is none: that of an element before this one does not count any more.
            flat.push((b"$parser", parser.location.clone().unwrap_or(Json::Null)));
        }
        let mut error = None;
        if let Some(uses) = &element.plugins {
            // Where they are is known already: `load_js_plugins`.
            let mut plugins = Vec::new();
            for used in uses {
                let answer = match &used.plugin {
                    Ok(at) => self.answer(*at),
                    Err(thrown) => {
                        error.get_or_insert_with(|| thrown.message.clone());
                        None
                    }
                };
                let name = answer.and_then(|it| it.get(b"name")).cloned();
                plugins.push((used.id.clone(), name.unwrap_or(Json::Null)));
            }
            flat.push((b"plugins", Json::Object(plugins)));
        }
        for (key, value) in [
            (&b"$env"[..], &element.env),
            (b"globals", &element.globals),
            (b"parserOptions", &element.parser_options),
        ] {
            language_options.extend(value.clone().map(|it| (key, it)));
        }
        let mut linter_options = Vec::new();
        if let Some(value) = element.no_inline_config {
            linter_options.push((&b"noInlineConfig"[..], Json::Bool(value)));
            own.push((b"nameOfNoInlineConfig", text(&element.name)));
        }
        // ESLint warns about them.
        if let Some(value) = &element.report_unused_disable_directives {
            let severity = match value.as_bool() {
                Some(is_on) => Json::Number(f64::from(u8::from(is_on))),
                None => value.clone(),
            };
            linter_options.push((b"reportUnusedDisableDirectives", severity));
        }
        if !own.is_empty() {
            language_options.push((OWN, object(own)));
        }
        if !language_options.is_empty() {
            flat.push((b"languageOptions", object(language_options)));
        }
        if !linter_options.is_empty() {
            flat.push((b"linterOptions", object(linter_options)));
        }
        flat.extend(element.settings.clone().map(|it| (&b"settings"[..], it)));
        if let Some(processor) = element.processor.as_deref()
            && let Some((at, name, _)) = self.member(named, b"processors", processor)
        {
            let prefix = &processor[..processor.len() - name.len() - 1];
            let file = self.answer(at).and_then(|it| it.get(b"path")).cloned();
            let module = object(vec![
                (b"module", file.unwrap_or(Json::Null)),
                (b"export", Json::Array(Vec::new())),
            ]);
            flat.push((b"processor", text(processor)));
            flat.push((
                b"$processor",
                object(vec![
                    (b"plugin", module),
                    (b"prefix", text(prefix)),
                    (b"name", text(name)),
                ]),
            ));
        }
        let settings = match &element.rules {
            Some(rules) => self.settings(rules, named)?,
            None => Vec::new(),
        };
        // An override that says nothing still adds its patterns to what is linted of a directory.
        if flat.is_empty() && settings.is_empty() && element.criteria.is_empty() {
            return Ok(());
        }
        // `isAdditionalTargetPath`, which is not asked with `--ext`.
        let adds_targets = element.is_config
            && self.options.extensions.is_none()
            && !element.criteria.iter().any(|it| it.ends_with_wildcard);
        let mut read = self.object(object(flat), &element.criteria, element.base_path)?;
        for pattern in (read.files.iter_mut().flatten().flatten()).filter(|_| adds_targets) {
            pattern.is_universal = false;
        }
        read.rules = settings;
        if error.is_some() {
            read.error = error;
        }
        self.reader.objects.push(read);
        Ok(())
    }

    /// `PluginConflictError`: an object for the files that two elements are for which have a plugin of one name from two files.
    fn conflicts(&mut self, elements: &[Element]) -> Result<(), ConfigError> {
        let file_of = |legacy: &Self, used: &PluginUse| {
            let answer = legacy.answer(*used.plugin.as_ref().ok()?)?;
            Some(answer.get(b"path")?.as_str()?.to_vec())
        };
        for (at, later) in elements.iter().enumerate().rev() {
            for used in later.plugins.iter().flatten() {
                let Some(file) = file_of(self, used) else {
                    continue;
                };
                for earlier in elements.iter().take(at).rev() {
                    let mut others = earlier.plugins.iter().flatten();
                    let Some(other) = others.find(|it| it.id == used.id) else {
                        continue;
                    };
                    let Some(other_file) = file_of(self, other).filter(|it| *it != file) else {
                        continue;
                    };
                    // Which files both are for cannot be said in one object.
                    let both = !later.criteria.is_empty() && !earlier.criteria.is_empty();
                    if both && later.base_path != earlier.base_path {
                        continue;
                    }
                    let base_path = match later.criteria.is_empty() {
                        true => earlier.base_path,
                        false => later.base_path,
                    };
                    let criteria = [&earlier.criteria[..], &later.criteria].concat();
                    let mut read = self.object(Json::Object(Vec::new()), &criteria, base_path)?;
                    read.error = Some(plugin_conflict(
                        &used.id,
                        [
                            (&file[..], &used.importer[..]),
                            (&other_file[..], &other.importer[..]),
                        ],
                    ));
                    self.reader.objects.push(read);
                }
            }
        }
        Ok(())
    }

    /// The default options of the version of typescript-eslint that is installed: an object as that for
    /// [`DEFAULTS_OF_ESLINT_8`], before all elements. What `elements` say to its rules is put into the words of today.
    fn follow_typescript_eslint(
        &mut self,
        named: &Named,
        elements: &mut [Element],
    ) -> Result<(), ConfigError> {
        let mut plugins = named.0.iter();
        let version = plugins
            .find(|it| *it.id == *b"@typescript-eslint")
            .and_then(|it| self.answer(it.at)?.get(b"version")?.as_str());
        let Some(version) = version.map(<[u8]>::to_vec) else {
            return Ok(());
        };
        let digits = version.iter().take_while(|it| it.is_ascii_digit()).count();
        let major = std::str::from_utf8(version.get(..digits).unwrap_or_default());
        let major = major.ok().and_then(|it| it.parse::<u32>().ok());
        let Some(major) = major.filter(|it| *it < 8) else {
            return Ok(());
        };
        let all = crate::json::parse(DEFAULTS_OF_TYPESCRIPT_ESLINT).unwrap_or(Json::Null);
        let of_version = all.get(if major <= 5 { b"5" } else { b"6" });
        let mut settings = Vec::new();
        for (name, options) in of_version.and_then(Json::as_object).unwrap_or_default() {
            let id = [b"@typescript-eslint/", &name[..]].concat();
            put(&mut self.defaults, &id, options.clone());
            settings.push((id, off_with(options)));
        }
        let read = (self.reader).object(&object(vec![(b"rules", Json::Object(settings))]))?;
        self.reader.objects.push(read);
        self.reader.defaults = self.reader.objects.len();
        self.typescript_eslint = Some(major);
        for rules in elements.iter_mut().filter_map(|it| it.rules.as_mut()) {
            let Json::Object(rules) = rules else {
                continue;
            };
            for (id, setting) in rules {
                in_the_words_of_today(major, id, setting);
            }
        }
        self.reader.note(&[
            b"typescript-eslint ",
            &version,
            b" is installed. Its rules are those of version 8 here, with the default options of the version that is installed.",
        ]);
        Ok(())
    }

    /// An object for all files, with what [`resolve`] has to know of the whole list.
    fn summary(&mut self, named: &Named) -> Result<(), ConfigError> {
        let mut environments = Vec::new();
        for &NamedPlugin { ref id, at } in &named.0 {
            let of_plugin = self
                .answer(at)
                .and_then(|it| it.get(b"environments")?.as_object());
            for (name, environment) in of_plugin.unwrap_or_default() {
                environments.push(([&id[..], b"/", name].concat(), environment.clone()));
            }
        }
        let ids = named.0.iter().map(|it| text(&it.id));
        let own = object(vec![
            (b"plugins", Json::Array(ids.collect())),
            (b"environments", Json::Object(environments)),
            (b"defaults", self.defaults.clone()),
            (
                b"typescriptEslint",
                (self.typescript_eslint).map_or(Json::Null, |it| Json::Number(f64::from(it))),
            ),
        ]);
        let summary = object(vec![(b"languageOptions", object(vec![(OWN, own)]))]);
        let read = self.reader.object(&summary)?;
        self.reader.objects.push(read);
        Ok(())
    }
}

// ───────────────────────────── `ConfigArray.extractConfig` ─────────────────────────────

/// The key of `languageOptions` under which the objects have what is for [`resolve`] alone.
const OWN: &[u8] = b"$eslint8";

fn merge_values(earlier: &mut Json, later: &Json) {
    match (&mut *earlier, later) {
        (Json::Object(before), Json::Object(after)) => {
            let mut merged = Vec::with_capacity(before.len() + after.len());
            for (key, value) in after.iter().filter(|it| it.0 != b"__proto__") {
                let found = before.iter().position(|it| it.0 == *key);
                merged.push(match found.map(|at| before.remove(at)) {
                    Some(mut entry) => {
                        merge_values(&mut entry.1, value);
                        entry
                    }
                    None => (key.clone(), value.clone()),
                });
            }
            merged.append(before);
            *before = merged;
        }
        (Json::Array(before), Json::Array(after)) => {
            for (at, value) in after.iter().enumerate() {
                match before.get_mut(at) {
                    Some(item) => merge_values(item, value),
                    None => before.push(value.clone()),
                }
            }
        }
        // ESLint goes through the keys of a list as through those of an object.
        (Json::Array(before), Json::Object(_)) => {
            let items = std::mem::take(before).into_iter().enumerate();
            let entries = items.map(|(at, item)| (at.to_string().into_bytes(), item));
            *earlier = Json::Object(entries.collect());
            merge_values(earlier, later);
        }
        (earlier, later) => earlier.clone_from(later),
    }
}

/// `mergeWithoutOverwrite(later, earlier)`, with the result in `earlier`: lists are merged item by item, and the keys of `later`
/// come first. The order of `env` decides which environment has the say about the version of the language.
pub(super) fn merge_into(earlier: &mut Json, later: &Json) {
    if !matches!(later, Json::Object(_)) {
        return;
    }
    if !matches!(earlier, Json::Object(_)) {
        *earlier = Json::Object(Vec::new());
    }
    merge_values(earlier, later);
}

/// `mergeRuleConfigs(later, earlier)`, with the result in `earlier`. A setting that is only a severity keeps the options of the one
/// before it. The rules of `later` come first, which is the order they run in.
pub(super) fn merge_rules(earlier: &mut Vec<RuleSetting>, later: &[RuleSetting]) {
    let mut merged: Vec<RuleSetting> = Vec::with_capacity(earlier.len() + later.len());
    for setting in later {
        let found = earlier.iter().position(|it| it.id == setting.id);
        let before = found.map(|at| earlier.remove(at));
        let new = match before {
            Some(mut before) if setting.has_only_severity => {
                before.severity = setting.severity;
                before
            }
            _ => setting.clone(),
        };
        match merged.iter_mut().find(|it| it.id == new.id) {
            Some(existing) => *existing = new,
            None => merged.push(new),
        }
    }
    merged.append(earlier);
    *earlier = merged;
}

/// What the linter has to know about a file that a configuration of ESLint 8 is for, beyond what a flat one says.
#[derive(Debug)]
pub struct Eslint8 {
    /// `configNameOfNoInlineConfig`
    name_of_no_inline_config: Vec<u8>,
    /// The ids of the plugins of all elements. ESLint looks for a rule in all of them, whatever files they are for.
    plugins: Vec<Box<[u8]>>,
    /// `env`, in the order of ESLint's keys, and whether each is on.
    env: Vec<(Box<[u8]>, bool)>,
    /// `pluginEnvironments`
    environments: Json,
    /// [`Legacy::defaults`]
    defaults: Json,
    /// [`Legacy::typescript_eslint`]
    typescript_eslint: Option<u32>,
    /// `parserOptions` as the files have them.
    parser_options: Json,
    is_espree: bool,
    /// [`Eslint8::edition`] without comments.
    edition: Result<u32, Vec<u8>>,
}

/// `typeof value`
fn type_of(value: &Json) -> &'static [u8] {
    match value {
        Json::Bool(_) => b"boolean",
        Json::Number(_) => b"number",
        Json::String(_) => b"string",
        Json::Null | Json::Array(_) | Json::Object(_) => b"object",
    }
}

/// `normalizeOptions` of espree 9: the edition that acorn is asked for, 3 and 5 to 15. `Err`: what it throws.
fn edition_of(options: &Json) -> Result<u32, Vec<u8>> {
    let version = match options.get(b"ecmaVersion") {
        None => 5.0,
        Some(Json::Number(version)) => *version,
        Some(Json::String(version)) if version == b"latest" => 15.0,
        Some(other) => {
            return Err([
                b"ecmaVersion must be a number or \"latest\". Received value of type ",
                type_of(other),
                b" instead.",
            ]
            .concat());
        }
    };
    let version = if version >= 2015.0 {
        version - 2009.0
    } else {
        version
    };
    let Some(version) = (3..=15u32).find(|it| *it != 4 && f64::from(*it) == version) else {
        return Err(b"Invalid ecmaVersion.".to_vec());
    };
    let source_type = options.get(b"sourceType").map(Json::as_str);
    if !matches!(
        source_type,
        None | Some(Some(b"script" | b"module" | b"commonjs"))
    ) {
        return Err(b"Invalid sourceType.".to_vec());
    }
    let allows_reserved = options.get(b"allowReserved");
    if version != 3 && allows_reserved.is_some_and(Json::is_truthy) {
        return Err(b"`allowReserved` is only supported when ecmaVersion is 3".to_vec());
    }
    if allows_reserved.is_some_and(|it| it.as_bool().is_none()) {
        return Err(b"`allowReserved`, when present, must be `true` or `false`".to_vec());
    }
    if matches!(source_type, Some(Some(b"module"))) && version < 6 {
        return Err(b"sourceType 'module' is not supported when ecmaVersion < 2015. Consider adding `{ ecmaVersion: 2015 }` to the parser options.".to_vec());
    }
    Ok(version)
}

impl Eslint8 {
    /// `getEnv(name).parserOptions`
    fn parser_options_of(&self, environment: &[u8]) -> Option<Json> {
        if let Some(of_plugin) = self.environments.get(environment) {
            return of_plugin.get(b"parserOptions").cloned();
        }
        if let Some(version) = version_of_environment(environment) {
            return Some(object(vec![(b"ecmaVersion", Json::Number(version))]));
        }
        matches!(environment, b"node" | b"commonjs").then(|| {
            let features = object(vec![(b"globalReturn", Json::Bool(true))]);
            object(vec![(b"ecmaFeatures", features)])
        })
    }

    /// The environments that are on in a file whose `/* eslint-env */` comments name `in_file`, in the order of ESLint.
    fn enabled<'e>(&'e self, in_file: &[&'e [u8]]) -> Vec<&'e [u8]> {
        let mut all: Vec<(&[u8], bool)> = self.env.iter().map(|it| (&it.0[..], it.1)).collect();
        for &name in in_file {
            match all.iter_mut().find(|it| it.0 == name) {
                Some(existing) => existing.1 = true,
                None => all.push((name, true)),
            }
        }
        all.into_iter().filter(|it| it.1).map(|it| it.0).collect()
    }

    /// `resolveParserOptions`
    fn resolve_parser_options(&self, in_file: &[&[u8]]) -> Json {
        let mut options = Json::Object(Vec::new());
        for environment in self.enabled(in_file) {
            if let Some(of_environment) = self.parser_options_of(environment) {
                super::merge::deep_merge_into(&mut options, &of_environment);
            }
        }
        super::merge::deep_merge_into(&mut options, &self.parser_options);
        if options.get(b"sourceType").and_then(Json::as_str) == Some(b"module") {
            let mut features = options.get(b"ecmaFeatures").cloned().unwrap_or(Json::Null);
            put(&mut features, b"globalReturn", Json::Bool(false));
            put(&mut options, b"ecmaFeatures", features);
        }
        // `normalizeEcmaVersion`, in which a string is compared as the number that it is.
        let number = match options.get(b"ecmaVersion") {
            Some(Json::String(latest)) if latest == b"latest" && self.is_espree => Some(15.0),
            Some(Json::Number(version)) => Some(*version),
            Some(Json::String(version)) => (std::str::from_utf8(version.trim_ascii()).ok())
                .and_then(|it| it.parse::<f64>().ok())
                .filter(|it| *it >= 2015.0),
            _ => None,
        };
        if let Some(number) = number {
            let edition = if number >= 2015.0 {
                number - 2009.0
            } else {
                number
            };
            put(&mut options, b"ecmaVersion", Json::Number(edition));
        }
        options
    }

    /// The edition of the language that acorn reads a file in whose `/* eslint-env */` comments name `in_file`: 3, and 5 to 15.
    /// `Err`: what espree throws about `parserOptions`, before it reads anything.
    pub(crate) fn edition(&self, in_file: &[&[u8]]) -> Result<u32, Vec<u8>> {
        match in_file {
            [] => self.edition.clone(),
            in_file => edition_of(&self.resolve_parser_options(in_file)),
        }
    }

    /// Whether the rules of typescript-eslint stand in for those of a version before 8, which is installed.
    pub fn has_typescript_eslint_before_8(&self) -> bool {
        self.typescript_eslint.is_some()
    }

    /// Whether ESLint has no definition of the rule called `id`. `js_plugins`: the plugins of the configuration of which it is known
    /// what is in them.
    pub(crate) fn lacks_rule(&self, id: &[u8], js_plugins: &[Arc<js_plugin::Plugin>]) -> bool {
        let has_plugin = |id: &[u8]| self.plugins.iter().any(|it| **it == *id);
        lacks_rule(id, &has_plugin, js_plugins)
    }

    /// The variables of the environment of a plugin that is called `name`.
    pub(crate) fn globals_of_environment(
        &self,
        name: &[u8],
    ) -> impl Iterator<Item = (&[u8], Global)> {
        let globals = self
            .environments
            .get(name)
            .and_then(|it| it.get(b"globals"));
        let globals = globals.and_then(Json::as_object).unwrap_or_default();
        (globals.iter()).filter_map(|(name, value)| Some((&name[..], Global::of_json(value)?)))
    }

    /// What ESLint says about a comment that starts with `label`, where `noInlineConfig` is on.
    pub(crate) fn has_no_effect(&self, label: &[u8], is_block: bool) -> Vec<u8> {
        let (open, close): (&[u8], &[u8]) = if is_block {
            (b"/*", b"*/")
        } else {
            (b"//", b"")
        };
        let name = match &self.name_of_no_inline_config[..] {
            b"" => Vec::new(),
            name => [b" (", name, b")"].concat(),
        };
        [
            b"'",
            open,
            label,
            close,
            b"' has no effect because you have 'noInlineConfig' setting in your config",
            &name,
            b".",
        ]
        .concat()
    }

    /// What `/* eslint id: value */` sets the rule to: the severity, and all its options, whatever the files say. `js`: the rule, if
    /// it is one of a plugin that is written in JavaScript. `Err`: the message of ESLint.
    pub(crate) fn inline_setting(
        &self,
        id: &[u8],
        value: &Json,
        js: Option<&js_plugin::Rule>,
    ) -> Result<Vec<Json>, Vec<u8>> {
        let mut value = value.clone();
        if let Some(major) = self.typescript_eslint {
            in_the_words_of_today(major, id, &mut value);
        }
        let severity = validate_rule(id, &value, js.map_or(Definition::Native, Definition::Js))?;
        let defaults = match js {
            Some(_) => &Json::Null,
            None => &self.defaults,
        };
        let options = match value
            .as_array()
            .and_then(|it| it.get(1..))
            .unwrap_or_default()
        {
            [] => {
                (defaults.get(id).and_then(Json::as_array)).map_or_else(Vec::new, <[Json]>::to_vec)
            }
            options => options_for_today(defaults, id, options),
        };
        let severity = Json::Number(f64::from(severity as u8));
        Ok(std::iter::once(severity).chain(options).collect())
    }
}

impl ResolvedConfig {
    /// Whether `rule` is off, with the options that [`Legacy::defaults`] has for it: no file has turned it on.
    pub fn only_has_defaults(&self, rule: &ConfiguredRule) -> bool {
        let id = RuleId::Known(rule.entry.meta).to_vec();
        let eslint_8 = self.language.eslint_8.as_ref();
        let defaults = eslint_8.and_then(|it| it.defaults.get(&id)?.as_array());
        matches!(rule.severity, Severity::Off) && defaults.is_some_and(|it| *it == *rule.options)
    }

    /// Whether the configuration is one of ESLint 8, which has no definition of the rule that it or a comment calls `id`.
    pub(crate) fn lacks_rule(&self, id: &[u8]) -> bool {
        (self.language.eslint_8.as_ref()).is_some_and(|it| it.lacks_rule(id, &self.js_plugins))
    }

    /// Whether a rule of the plugin `prefix` that exists here runs in place of that of the package, as with an `eslint.config.js`:
    /// the configuration is one of ESLint 8, and the package is loaded for the rules that do not exist here.
    pub(crate) fn prefers_native_rules_of(&self, prefix: &[u8]) -> bool {
        self.language.eslint_8.is_some() && is_implemented_here(prefix)
    }
}

/// What `_verifyWithoutProcessors` of ESLint's `Linter` does with the merged configuration of a file before it parses:
/// an environment says which version of the language it is for and which variables there are, and what the configuration says
/// itself overrides that. `Err`: the parser of the file could not be loaded.
pub(super) fn resolve(language_options: &mut Json) -> Result<Eslint8, Vec<u8>> {
    let own = take(language_options, OWN).unwrap_or(Json::Null);
    if let Some(error) = own.get(b"parserError").and_then(Json::as_str) {
        return Err(error.to_vec());
    }
    let env = language_options.get(b"$env").and_then(Json::as_object);
    let ids = own.get(b"plugins").and_then(Json::as_array);
    let name = own.get(b"nameOfNoInlineConfig").and_then(Json::as_str);
    let parser = language_options.get(b"parser").and_then(Json::as_str);
    let mut eslint_8 = Eslint8 {
        name_of_no_inline_config: name.unwrap_or_default().to_vec(),
        plugins: (ids.unwrap_or_default().iter())
            .filter_map(|it| Some(it.as_str()?.into()))
            .collect(),
        env: (env.unwrap_or_default().iter())
            .map(|(name, value)| (name[..].into(), value.is_truthy()))
            .collect(),
        environments: own.get(b"environments").cloned().unwrap_or(Json::Null),
        defaults: own.get(b"defaults").cloned().unwrap_or(Json::Null),
        typescript_eslint: match own.get(b"typescriptEslint") {
            Some(Json::Number(major)) => Some(*major as u32),
            _ => None,
        },
        parser_options: (language_options.get(b"parserOptions").cloned()).unwrap_or(Json::Null),
        is_espree: parser.is_none_or(|it| it == b"espree"),
        edition: Ok(5),
    };
    let options = eslint_8.resolve_parser_options(&[]);
    eslint_8.edition = edition_of(&options);
    // `resolveGlobals`. The variables of the environments that are built in are added where `$env` is read.
    let mut globals = Json::Null;
    for environment in eslint_8.enabled(&[]) {
        if let Some(of_plugin) = eslint_8.environments.get(environment)
            && let Some(variables) = of_plugin.get(b"globals")
        {
            super::merge::deep_merge_into(&mut globals, variables);
        }
    }
    if let Some(written) = language_options.get(b"globals") {
        super::merge::deep_merge_into(&mut globals, written);
    }
    if globals != Json::Null {
        put(language_options, b"globals", globals);
    }
    // `builtin` is what ES5 has, which is there anyway. For the package `globals` it is what the latest edition has.
    let is_read = |name: &[u8]| name != b"builtin" && eslint_8.environments.get(name).is_none();
    let on = eslint_8.env.iter().filter(|it| is_read(&it.0));
    let on = on.map(|(name, is_on)| (name.to_vec(), Json::Bool(*is_on)));
    put(language_options, b"$env", Json::Object(on.collect()));
    // `createLanguageOptions`
    let year = match options.get(b"ecmaVersion") {
        None => 5.0,
        Some(Json::Number(version)) if *version == 3.0 || *version == 5.0 || *version >= 2015.0 => {
            *version
        }
        Some(Json::Number(version)) => *version + 2009.0,
        Some(_) => 2024.0,
    };
    put(language_options, b"ecmaVersion", Json::Number(year));
    // One that espree refuses is not what the configuration is refused for.
    let source_type = options.get(b"sourceType").and_then(Json::as_str);
    let source_type = source_type.filter(|it| matches!(*it, b"module" | b"commonjs"));
    put(
        language_options,
        b"sourceType",
        text(source_type.unwrap_or(b"script")),
    );
    put(language_options, b"parserOptions", options);
    Ok(eslint_8)
}

impl Config {
    /// From the configuration files of ESLint 8 that count for a directory: the outermost first, then what the command line
    /// adds. See the [module](self).
    pub fn from_legacy(
        registry: &Registry,
        options: &LegacyOptions,
        files: &[LegacyFile],
        load: &mut LoadLegacy<'_>,
        load_plugin: &mut LoadLocatedPlugin<'_>,
    ) -> Result<Config, ConfigError> {
        // A rule of `--rulesdir` that is called like one of ESLint has nothing of that one.
        let replaced = options.rules.and_then(|it| it.get(b"rules")?.as_object());
        let mut defaults = defaults_of_eslint_8();
        if let Json::Object(entries) = &mut defaults {
            let replaced = replaced.unwrap_or_default();
            entries.retain(|it| !replaced.iter().any(|other| other.0 == it.0));
        }
        let mut legacy = Legacy {
            reader: Reader {
                registry,
                base_path: paths::absolute(options.root),
                prefers_typescript_rules: false,
                objects: Vec::new(),
                notes: Vec::new(),
                advice: Vec::new(),
                unknown_rules: Vec::new(),
                js_plugins: Vec::new(),
                js_locations: Vec::new(),
                defaults: 0,
                foreign_prefixes: Vec::new(),
                has_unknown_resolver: false,
                handing_back: Vec::new(),
            },
            load,
            options,
            plugins: Vec::new(),
            elements: Vec::new(),
            defaults,
            ignored: Vec::new(),
            typescript_eslint: None,
            extended: 0,
        };
        // What ESLint lints of a directory. An override adds its patterns.
        let extensions: Vec<Json> = match options.extensions {
            None => vec![text(b"**/*.js")],
            Some(extensions) => (extensions.iter())
                .map(|it| Json::String([b"**/*.", it.strip_prefix(b".").unwrap_or(it)].concat()))
                .collect(),
        };
        let defaults = legacy.defaults.as_object().unwrap_or_default().iter();
        let defaults = defaults.map(|(id, options)| (id.clone(), off_with(options)));
        for default in [
            object(vec![(b"language", text(b"@/js"))]),
            object(vec![(b"files", Json::Array(extensions))]),
            object(vec![(b"rules", Json::Object(defaults.collect()))]),
        ] {
            let default = legacy.reader.object(&default)?;
            legacy.reader.objects.push(default);
        }
        legacy.ignore_patterns(&DEFAULT_PATTERNS, options.cwd);
        legacy.reader.defaults = legacy.reader.objects.len();
        // `_loadConfigInAncestors`: from the innermost, up to one with `root`.
        let (cascade, others) = files.split_at(options.cascade.min(files.len()));
        let mut of_directories: Vec<Vec<Element>> = Vec::new();
        for file in cascade.iter().rev() {
            legacy.file(file)?;
            let elements = std::mem::take(&mut legacy.elements);
            let is_root = elements.iter().rev().find_map(|it| it.root) == Some(true);
            of_directories.push(elements);
            if is_root {
                break;
            }
        }
        legacy.elements = of_directories.into_iter().rev().flatten().collect();
        for file in others {
            legacy.file(file)?;
        }
        let mut elements = std::mem::take(&mut legacy.elements);
        let named = Named::of(&elements);
        legacy.follow_typescript_eslint(&named, &mut elements)?;
        legacy.load_js_plugins(&elements, &named, load_plugin)?;
        legacy.validate_elements(&elements, &named)?;
        for element in &elements {
            legacy.convert(element, &named)?;
        }
        let dot_patterns = legacy.reader.objects.len();
        let ignores = legacy.ignores();
        legacy.reader.objects.extend(ignores);
        legacy.conflicts(&elements)?;
        legacy.summary(&named)?;
        Ok(Config {
            lints_all_that_is_named: !options.ignore,
            dot_patterns: Some(dot_patterns),
            ..legacy.reader.finish(Semantics {
                keeps_options: true,
                accepts_all_plugins: true,
                is_legacy: true,
            })
        })
    }
}
