//! The options that a rule accepts: ESLint's `meta.schema` and `meta.defaultOptions`.
//!
//! ESLint validates the options of every rule that is enabled, and refuses a configuration with
//! options that the schema of the rule does not allow. The schemas are data here (117 KB for 340 rules,
//! of which that of a rule is parsed when options for it are validated), not part of the rules.
//!
//! The default options are merged into the options for validating and for comparing only. A rule
//! is made from the options as they are written, and knows its defaults itself.

mod data;
mod validate;

use crate::js_plugin;
use crate::linter::message::{RuleId, write_json};
use crate::options::Json;
use crate::rule::Meta;
use bun_core::strings;
use validate::Validator;

/// The strings of an entry of [`data::NAMES`].
fn names(mut list: &[u8]) -> Json {
    let mut all = Vec::new();
    let mut name: Vec<u8> = Vec::new();
    while let [shared, more, rest @ ..] = list
        && let Some((added, rest)) = rest.split_at_checked(*more as usize)
    {
        name.truncate(*shared as usize);
        name.extend_from_slice(added);
        all.push(Json::String(name.clone()));
        list = rest;
    }
    Json::Array(all)
}

/// Writes `text` with what each `{"$":n}` stands for in its place. As text: to parse is dear however short the text is.
fn write_with_shared(out: &mut Vec<u8>, mut text: &[u8]) {
    const REFERENCE: &[u8] = b"{\"$\":";
    while let Some(at) = strings::index_of(text, REFERENCE) {
        let (before, reference) = text.split_at(at);
        out.extend_from_slice(before);
        let digits = &reference[REFERENCE.len()..];
        let end = strings::index_of_char_usize(digits, b'}').unwrap_or(digits.len());
        let shared = bun_core::fmt::parse_decimal::<usize>(&digits[..end]);
        if let Some(shared) = shared.and_then(|it| data::SHARED.get(it)) {
            write_with_shared(out, shared.as_bytes());
        }
        text = digits.get(end + 1..).unwrap_or_default();
    }
    out.extend_from_slice(text);
}

/// Puts what each `{"$names":n}` stands for in its place.
fn put_names(json: &mut Json) {
    let list = match &*json {
        Json::Object(entries) => match &entries[..] {
            [(key, Json::Number(index))] if key == b"$names" => data::NAMES.get(*index as usize),
            _ => None,
        },
        _ => None,
    };
    if let Some(list) = list {
        *json = names(list);
        return;
    }
    match json {
        Json::Object(entries) => entries.iter_mut().for_each(|it| put_names(&mut it.1)),
        Json::Array(items) => items.iter_mut().for_each(put_names),
        _ => {}
    }
}

/// `[meta.schema]` or `[meta.schema, meta.defaultOptions]`. `None` if the rule takes no options.
fn find(id: &[u8]) -> Option<Json> {
    let at = data::SCHEMAS
        .binary_search_by(|it| it.0.as_bytes().cmp(id))
        .ok()?;
    let mut text = Vec::new();
    write_with_shared(&mut text, data::SCHEMAS[at].1.as_bytes());
    let mut found = crate::json::parse(&text)?;
    if strings::contains(&text, b"{\"$names\":") {
        put_names(&mut found);
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
fn deep_merge_arrays(defaults: &[Json], options: &[Json]) -> Vec<Json> {
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

/// Validates `options`, which are what follows the severity, as ESLint's `validateRulesConfig` does.
/// `Err`: the lines of its message that follow `Key "rules": Key "<rule>":`.
pub(crate) fn validate(meta: &'static Meta, options: &[Json]) -> Result<(), Vec<u8>> {
    validate_by_id(&RuleId::Known(meta).to_vec(), options)
}

/// The same for the rule that ESLint calls `id`, whether it is implemented or not.
pub fn validate_by_id(id: &[u8], options: &[Json]) -> Result<(), Vec<u8>> {
    // Nearly no rule needs options: `generate-schemas.mjs` lists those that do.
    if options.is_empty() && !data::NEED_OPTIONS.iter().any(|it| it.as_bytes() == id) {
        return Ok(());
    }
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
    match find(id)? {
        Json::Array(parts) => parts.into_iter().next(),
        _ => None,
    }
}

/// Validates `options` with `schema`, which is `meta.schema`, as ESLint 8 does: it knows no `meta.defaultOptions`.
pub(crate) fn validate_as_eslint_8(schema: Option<&Json>, options: &[Json]) -> Result<(), Vec<u8>> {
    validate_with(schema, &[], options).map(drop)
}

/// The same for a rule of a JavaScript plugin. `Ok`: ESLint's `context.options`, which are `options` with the default options of
/// the rule, and with the defaults that its schema has.
pub fn validate_js(rule: &js_plugin::Rule, options: &[Json]) -> Result<Vec<Json>, Vec<u8>> {
    match &rule.schema {
        js_plugin::Schema::Any => Ok(with_js_defaults(rule, options)),
        js_plugin::Schema::None => validate_with(None, &rule.default_options, options),
        js_plugin::Schema::Json(schema) => {
            validate_with(Some(schema), &rule.default_options, options)
        }
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
    };
    let mut options = Json::Array(options);
    if validator.validate(&schema, &mut options) {
        return Ok(match options {
            Json::Array(options) => options,
            _ => Vec::new(),
        });
    }
    let mut message = Vec::new();
    for error in &validator.errors {
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
