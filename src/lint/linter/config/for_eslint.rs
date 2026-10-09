//! What is configured for a file, as JSON for ESLint's own `Linter`: [`Configuration`].

use super::merge::RuleSetting;
use crate::context::Severity;
use crate::js_plugin::{self, Configuration, has_what_json_lacks};
use crate::linter::registry::parse_rule_id;
use crate::linter::resolved::{LinterOptions, find_js_rule};
use crate::options::Json;
use std::sync::Arc;

/// What the objects for a file come to.
pub(super) struct Parts<'p> {
    pub(super) language: Option<&'p [u8]>,
    pub(super) language_options: &'p Json,
    pub(super) settings: &'p Json,
    pub(super) linter: LinterOptions,
    pub(super) rules: &'p [RuleSetting],
    /// `$parser` of the object that `languageOptions.parser` is from, if a module exports the parser.
    pub(super) parser: Option<&'p Json>,
    /// The prefixes of the plugins.
    pub(super) plugins: &'p [&'p [u8]],
    /// `$jsPlugins` of all objects of the configuration: where the plugin with a prefix is.
    pub(super) locations: &'p [(Box<[u8]>, Json)],
    /// Those of which it is known what is in them.
    pub(super) js_plugins: &'p [Arc<js_plugin::Plugin>],
}

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

fn number(severity: Severity) -> Json {
    Json::Number(f64::from(severity as u8))
}

/// `None`: it takes the configuration file itself.
pub(super) fn build(parts: &Parts) -> Option<Configuration> {
    let on = || parts.rules.iter().filter(|it| it.severity != Severity::Off);
    // A parser among the options of another one is written as its name.
    let parser_options = parts.language_options.get(b"parserOptions");
    let has_object = |key: &[u8]| parser_options.is_some_and(|it| it.get(key).is_some());
    if has_object(b"parser")
        || has_object(b"programs")
        || has_what_json_lacks(parts.language_options)
        || has_what_json_lacks(parts.settings)
        || on().any(|it| it.options.iter().any(has_what_json_lacks))
    {
        return None;
    }
    let options = parts.language_options.as_object().unwrap_or_default();
    if parts.parser.is_none() && options.iter().any(|it| it.0 == b"parser") {
        return None;
    }
    let options = options.iter().filter(|it| it.0 != b"parser");
    let rules = on().map(|it| {
        let setting = std::iter::once(number(it.severity)).chain(it.options.iter().cloned());
        (it.id.to_vec(), Json::Array(setting.collect()))
    });
    let language_plugin = parts.language.map(|it| parse_rule_id(it).0);
    let mut plugins: Vec<(Vec<u8>, Json)> = Vec::new();
    for &prefix in parts.plugins {
        if prefix == b"@" || plugins.iter().any(|it| it.0 == prefix) {
            continue;
        }
        let mut is_needed = language_plugin == Some(prefix);
        let mut modules = Vec::new();
        for setting in on().filter(|it| *it.plugin == *prefix) {
            let rule = find_js_rule(parts.js_plugins, &setting.id).flatten();
            match rule.and_then(|it| crate::json::parse(it.location()?)) {
                Some(location) => modules.push((parse_rule_id(&setting.id).1.to_vec(), location)),
                None => is_needed = true,
            }
        }
        let Some((_, location)) = parts.locations.iter().find(|it| *it.0 == *prefix) else {
            match is_needed {
                true => return None,
                false => continue,
            }
        };
        plugins.push((
            prefix.to_vec(),
            object(vec![
                (b"location", location.clone()),
                (b"rules", Json::Object(modules)),
                (b"isNeeded", Json::Bool(is_needed)),
            ]),
        ));
    }
    let linter = object(vec![
        (b"noInlineConfig", Json::Bool(parts.linter.no_inline_config)),
        (
            b"reportUnusedDisableDirectives",
            number(parts.linter.report_unused_disable_directives),
        ),
        (
            b"reportUnusedInlineConfigs",
            number(parts.linter.report_unused_inline_configs),
        ),
    ]);
    let mut config = vec![
        (
            &b"languageOptions"[..],
            Json::Object(options.cloned().collect()),
        ),
        (b"linterOptions", linter),
        (b"rules", Json::Object(rules.collect())),
    ];
    if let Some(language) = parts.language {
        config.push((b"language", Json::String(language.to_vec())));
    }
    if let Json::Object(_) = parts.settings {
        config.push((b"settings", parts.settings.clone()));
    }
    Some(Configuration::new(&object(vec![
        (b"object", object(config)),
        (b"parser", parts.parser.cloned().unwrap_or(Json::Null)),
        (b"plugins", Json::Object(plugins)),
    ])))
}
