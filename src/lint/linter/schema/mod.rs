//! The options that a rule accepts: ESLint's `meta.schema` and `meta.defaultOptions`.
//!
//! ESLint validates the options of every rule that is enabled, and refuses a configuration with
//! options that the schema of the rule does not allow. The schemas are data here (116 KB of JSON for
//! 259 rules, which is parsed for a rule when options for it are validated), not part of the rules.
//!
//! The default options are merged into the options for validating and for comparing only. A rule
//! is made from the options as they are written, and knows its defaults itself.

mod data;
mod validate;

use crate::linter::message::{RuleId, write_json};
use crate::options::Json;
use crate::rule::Meta;
use validate::Validator;

/// `[meta.schema]` or `[meta.schema, meta.defaultOptions]`. `None` if the rule takes no options.
fn find(id: &[u8]) -> Option<Json> {
    let at = data::SCHEMAS
        .binary_search_by(|it| it.0.as_bytes().cmp(id))
        .ok()?;
    crate::json::parse(data::SCHEMAS[at].1.as_bytes())
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
    let found = find(id);
    let parts = found.as_ref().and_then(Json::as_array).unwrap_or_default();
    let options = match parts.get(1).and_then(Json::as_array) {
        Some(defaults) => deep_merge_arrays(defaults, options),
        None => options.to_vec(),
    };
    if options.is_empty() && !matches!(parts.first(), Some(Json::Object(_))) {
        return Ok(());
    }
    // `getRuleOptionsSchema`
    let entry = |key: &[u8], value: Json| (key.to_vec(), value);
    let schema = match parts.first() {
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
    if validator.validate(&schema, &mut Json::Array(options)) {
        return Ok(());
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
