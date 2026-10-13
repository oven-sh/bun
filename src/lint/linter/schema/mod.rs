//! Schemas for rule options: ESLint's `meta.schema` and `meta.defaultOptions`.
//!
//! ESLint validates the options of every enabled rule, and rejects a config whose options don't
//! match the rule's schema. Here the schemas are data, not part of the rules (200 KB for 360
//! rules, 26 KB compressed). A rule's schema is parsed only when its options are validated.
//!
//! Default options are merged in only for validating and comparing. A rule is built from the
//! options as written, and applies its own defaults.

mod data;
mod plain;
mod validate;

use crate::js_plugin;
use crate::linter::message::{RuleId, write_json};
use crate::options::Json;
use crate::rule::Meta;
use bun_core::strings;
pub use plain::OptionMistake;
pub use validate::Step;
pub(super) use validate::is_equal;
use validate::{SchemaError, Validator};

/// `schemas.txt` as `(rule id, JSON)` pairs, sorted by id. The JSON is `[meta.schema]` or `[meta.schema, meta.defaultOptions]`.
/// A typescript-eslint rule that merges its defaults itself has `[meta.schema, [], defaultOptions]`. A rule that isn't listed
/// takes no options.
///
/// Release builds embed the file compressed and inflate it here, the first time a schema is needed.
fn schemas() -> &'static [(&'static [u8], &'static [u8])] {
    static SCHEMAS: bun_core::Once<Vec<(&'static [u8], &'static [u8])>> = bun_core::Once::new();
    SCHEMAS.get_or_init(|| {
        let lines = bun_zstd::embed_compressed!(
            "src/lint/linter/schema/schemas.txt",
            include_bytes!("schemas.txt")
        );
        strings::split(lines, b"\n")
            .filter_map(|line| strings::split_once_char(line, b'\t'))
            .collect()
    })
}

/// The rule's entry in [`schemas`], parsed. `None` if the rule takes no options.
fn find(id: &[u8]) -> Option<Json> {
    let schemas = schemas();
    let at = schemas.binary_search_by(|it| it.0.cmp(id)).ok()?;
    crate::json::parse(schemas[at].1)
}

/// Options that only `bun lint` has, as `(rule, option)`. Each is a boolean in the rule's first options object. They're valid
/// where there's no ESLint or oxlint config file. With one, the schema is the original's, and so is the error for these.
const OPTIONS_OF_BUN: [(&[u8], &[u8]); 4] = [
    (
        b"@typescript-eslint/no-loss-of-precision",
        b"ignoreDecimals",
    ),
    (b"no-constant-binary-expression", b"allowLiteralToggle"),
    (b"no-loss-of-precision", b"ignoreDecimals"),
    (b"react/jsx-key", b"checkArraysOutsideJSX"),
];

/// [`find`], with [`OPTIONS_OF_BUN`] added to the schema.
fn find_standing_alone(id: &[u8]) -> Option<Json> {
    let found = find(id);
    let mut own = OPTIONS_OF_BUN.iter().filter(|it| it.0 == id).peekable();
    if own.peek().is_none() {
        return found;
    }
    let empty = br#"[[{ "type": "object", "properties": {}, "additionalProperties": false }]]"#;
    let mut found = found.or_else(|| crate::json::parse(empty))?;
    let Json::Array(parts) = &mut found else {
        return Some(found);
    };
    if let Some(Json::Array(items)) = parts.first_mut()
        && let Some(Json::Object(first)) = items.first_mut()
        && let Some((_, Json::Object(properties))) =
            first.iter_mut().find(|it| it.0 == b"properties")
    {
        let boolean = || crate::json::parse(br#"{ "type": "boolean" }"#).unwrap_or(Json::Null);
        properties.extend(own.map(|it| (it.1.to_vec(), boolean())));
    }
    Some(found)
}

/// `deepMergeObjects`
fn deep_merge_objects(first: &Json, second: &Json) -> Json {
    let (Json::Object(first), Json::Object(second)) = (first, second) else {
        return second.clone();
    };
    let mut merged = first.clone();
    for (key, value) in second {
        match merged.iter_mut().find(|it| it.0 == *key) {
            Some(existing) => existing.1 = deep_merge_objects(&existing.1, value),
            None => merged.push((key.clone(), value.clone())),
        }
    }
    Json::Object(merged)
}

/// `deepMergeArrays(defaults, options)`
pub(crate) fn deep_merge_arrays(defaults: &[Json], options: &[Json]) -> Vec<Json> {
    let merged = defaults
        .iter()
        .enumerate()
        .map(|(i, default)| match options.get(i) {
            Some(option) => deep_merge_objects(default, option),
            None => default.clone(),
        });
    merged
        .chain(options.iter().skip(defaults.len()).cloned())
        .collect()
}

/// The options of the rule with its `meta.defaultOptions` merged in: what ESLint has in
/// `config.rules[ruleId].slice(1)`.
pub(crate) fn with_defaults(meta: &'static Meta, options: &[Json]) -> Vec<Json> {
    match find(&RuleId::Known(meta).to_vec())
        .as_ref()
        .and_then(|it| it.as_array()?.get(1)?.as_array())
    {
        Some(defaults) => deep_merge_arrays(defaults, options),
        None => options.to_vec(),
    }
}

/// A rule's `meta.schema`, and `options` merged over its default options. `None` if the rule takes no options. Also `None`
/// for rules ported from oxlint, which have no schema.
pub fn schema_and_defaults(meta: &'static Meta, options: &[Json]) -> Option<(Json, Vec<Json>)> {
    if meta.follows_oxlint {
        return None;
    }
    let found = find_standing_alone(&RuleId::Known(meta).to_vec())?;
    let [schema, defaults @ ..] = found.as_array()? else {
        return None;
    };
    // The defaults that a typescript-eslint rule merges itself come last. See [`schemas`].
    let defaults = defaults.last().and_then(Json::as_array);
    let merged = deep_merge_arrays(defaults.unwrap_or_default(), options);
    Some((schema.clone(), merged))
}

/// Validates `options`, which are what follows the severity, as ESLint's `validateRulesConfig` does.
/// `Err`: the lines of its message that follow `Key "rules": Key "<rule>":`. `stands_alone`: [`OPTIONS_OF_BUN`] are valid too.
pub(crate) fn validate(
    meta: &'static Meta,
    options: &[Json],
    stands_alone: bool,
) -> Result<(), Vec<u8>> {
    // Rules ported from oxlint have no schema. They ignore options they don't know.
    if meta.follows_oxlint {
        return Ok(());
    }
    let find = if stands_alone {
        find_standing_alone
    } else {
        find
    };
    validate_found(&RuleId::Known(meta).to_vec(), options, find)
}

/// Validates `options` (without the severity) and describes the problem in Bun's own words. `rule` is the rule name as the
/// user wrote it.
pub fn mistake_in_options(
    meta: &'static Meta,
    rule: &[u8],
    options: &[Json],
) -> Option<OptionMistake> {
    let id = RuleId::Known(meta).to_vec();
    let needs_some = || data::NEED_OPTIONS.iter().any(|it| it.as_bytes() == id);
    if meta.follows_oxlint || options.is_empty() && !needs_some() {
        return None;
    }
    let found = find_standing_alone(&id);
    let parts = found.as_ref().and_then(Json::as_array).unwrap_or_default();
    let defaults = parts.get(1).and_then(Json::as_array).unwrap_or_default();
    let errors = errors_of(parts.first(), defaults, options).err()?;
    Some(plain::explain(rule, &errors))
}

/// What stands in `json` for something that a configuration file has and JSON has not, other than a regular expression: what
/// it is.
pub(crate) fn placeholder(json: &Json) -> Option<&[u8]> {
    match json {
        Json::Array(items) => items.iter().find_map(placeholder),
        Json::Object(entries) => match json.get(b"$unserializable") {
            Some(kind) => kind.as_str(),
            None => entries.iter().find_map(|it| placeholder(&it.1)),
        },
        _ => None,
    }
}

/// `options` as ajv sees them and as `JSON.stringify` prints them: a `Map`, a `Date` or a `RegExp` is an object without properties.
fn without_placeholders(json: &Json) -> Json {
    let mut copy = json.clone();
    let mut unseen = vec![&mut copy];
    while let Some(next) = unseen.pop() {
        match next {
            Json::Array(items) => unseen.extend(items),
            Json::Object(entries)
                if entries
                    .iter()
                    .any(|it| it.0 == b"$unserializable" || it.0 == b"$regexp") =>
            {
                entries.clear();
            }
            Json::Object(entries) => unseen.extend(entries.iter_mut().map(|it| &mut it.1)),
            _ => {}
        }
    }
    copy
}

/// The same for the rule that ESLint calls `id`, whether it is implemented or not.
pub(crate) fn validate_by_id(id: &[u8], options: &[Json]) -> Result<(), Vec<u8>> {
    validate_found(id, options, find)
}

fn validate_found(
    id: &[u8],
    options: &[Json],
    find: fn(&[u8]) -> Option<Json>,
) -> Result<(), Vec<u8>> {
    // Nearly no rule needs options: `generate-schemas.mjs` lists those that do.
    if options.is_empty() && !data::NEED_OPTIONS.iter().any(|it| it.as_bytes() == id) {
        return Ok(());
    }
    let options = &options.iter().map(without_placeholders).collect::<Vec<_>>()[..];
    let found = find(id);
    let parts = found.as_ref().and_then(Json::as_array).unwrap_or_default();
    validate_with(
        parts.first(),
        parts.get(1).and_then(Json::as_array).unwrap_or_default(),
        options,
    )
    .map(drop)
}

/// `meta.schema` of the rule that ESLint calls `id`. `None`: it takes no options, or there is no such rule.
pub(crate) fn schema_of(id: &[u8]) -> Option<Json> {
    find(id)?.into_array()?.into_iter().next()
}

/// Validates `options` with `schema`, which is `meta.schema`, as ESLint 8 does: it knows no `meta.defaultOptions`.
pub(crate) fn validate_as_eslint_8(schema: Option<&Json>, options: &[Json]) -> Result<(), Vec<u8>> {
    let options = &options.iter().map(without_placeholders).collect::<Vec<_>>()[..];
    validate_with(schema, &[], options).map(drop)
}

/// The same for a rule of a JavaScript plugin. `Ok`: ESLint's `context.options`, which are `options` with the default options of
/// the rule, and with the defaults that its schema has.
pub(crate) fn validate_js(rule: &js_plugin::Rule, options: &[Json]) -> Result<Vec<Json>, Vec<u8>> {
    match &rule.schema {
        js_plugin::Schema::Any => Ok(with_js_defaults(rule, options)),
        js_plugin::Schema::None => validate_with(None, &rule.default_options, options),
        js_plugin::Schema::Json(schema) => {
            validate_with(Some(schema), &rule.default_options, options)
        }
    }
}

impl js_plugin::Rule {
    /// Checks `options` against `meta.schema`, as ESLint does. `Err`: ESLint's lines about what is wrong with them.
    pub fn validate(&self, options: &[Json]) -> Result<(), Vec<u8>> {
        validate_js(self, options).map(drop)
    }
}

/// `options` with the default options of a rule of a JavaScript plugin: what ESLint has for a rule that it does not validate.
pub(crate) fn with_js_defaults(rule: &js_plugin::Rule, options: &[Json]) -> Vec<Json> {
    deep_merge_arrays(&rule.default_options, options)
}

/// `schema`: `meta.schema`, if the rule has one. `defaults`: `meta.defaultOptions`. `Ok`: the options as the validation leaves
/// them, which fills in the defaults of the schema.
fn validate_with(
    schema: Option<&Json>,
    defaults: &[Json],
    options: &[Json],
) -> Result<Vec<Json>, Vec<u8>> {
    let errors = match errors_of(schema, defaults, options) {
        Ok(options) => return Ok(options),
        Err(errors) => errors,
    };
    // Ajv's functions call each other for every level of the options. ESLint reports the `RangeError` like any other error.
    if errors.is_empty() {
        return Err(b"\tMaximum call stack size exceeded\n".to_vec());
    }
    let mut message = Vec::new();
    for error in &errors {
        message.extend_from_slice(b"\tValue ");
        write_json(&mut message, &error.data);
        message.push(b' ');
        message.extend_from_slice(&error.message);
        message.extend_from_slice(b".\n");
        if let Some((property, expected)) = &error.additional_property {
            message.extend_from_slice(b"\t\tUnexpected property \"");
            message.extend_from_slice(property);
            message.extend_from_slice(b"\". Expected properties: ");
            for (i, name) in expected.iter().enumerate() {
                if i > 0 {
                    message.extend_from_slice(b", ");
                }
                message.push(b'"');
                message.extend_from_slice(name);
                message.push(b'"');
            }
            message.extend_from_slice(b".\n");
        }
    }
    Err(message)
}

/// Same as [`validate_with`], but returns the raw Ajv errors. None at all means the stack was too small for the options.
fn errors_of(
    schema: Option<&Json>,
    defaults: &[Json],
    options: &[Json],
) -> Result<Vec<Json>, Vec<SchemaError>> {
    let options = deep_merge_arrays(defaults, options);
    if options.is_empty() && !matches!(schema, Some(Json::Object(_))) {
        return Ok(options);
    }
    // `getRuleOptionsSchema`
    let entry = |key: &[u8], value: Json| (key.to_vec(), value);
    let schema = match schema {
        Some(schema @ Json::Object(_)) => schema.clone(),
        Some(Json::Array(items)) if !items.is_empty() => Json::Object(vec![
            entry(b"type", Json::String(b"array".to_vec())),
            entry(b"items", Json::Array(items.clone())),
            entry(b"minItems", Json::Number(0.0)),
            entry(b"maxItems", Json::Number(items.len() as f64)),
        ]),
        _ => Json::Object(vec![
            entry(b"type", Json::String(b"array".to_vec())),
            entry(b"minItems", Json::Number(0.0)),
            entry(b"maxItems", Json::Number(0.0)),
        ]),
    };
    let mut validator = Validator {
        root: &schema,
        errors: Vec::new(),
        is_out_of_stack: false,
    };
    let mut options = Json::Array(options);
    let is_valid = validator.validate(&schema, &mut options);
    if validator.is_out_of_stack {
        return Err(Vec::new());
    }
    if is_valid {
        return Ok(options.into_array().unwrap_or_default());
    }
    Err(validator.errors)
}
