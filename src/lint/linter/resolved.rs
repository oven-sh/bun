//! What is configured for one file.

use super::registry::{Registry, parse_rule_id};
use crate::context::Severity;
use crate::language::{LanguageOptions, Parser};
use crate::options::{Json, Options};
use crate::rule::Plugin;
use crate::runner::{AnyRule, RuleEntry};
use std::sync::Arc;

/// ESLint's `linterOptions`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct LinterOptions {
    /// Comments do not configure, and each that would is reported.
    pub no_inline_config: bool,
    pub report_unused_disable_directives: Severity,
    pub report_unused_inline_configs: Severity,
}

impl Default for LinterOptions {
    /// As in ESLint's default configuration.
    fn default() -> Self {
        LinterOptions {
            no_inline_config: false,
            report_unused_disable_directives: Severity::Warn,
            report_unused_inline_configs: Severity::Off,
        }
    }
}

/// `0`, `1`, `2`, `"off"`, `"warn"`, `"error"`
pub fn severity_of(value: &Json) -> Option<Severity> {
    Some(match value {
        Json::Number(n) if *n == 0.0 => Severity::Off,
        Json::Number(n) if *n == 1.0 => Severity::Warn,
        Json::Number(n) if *n == 2.0 => Severity::Error,
        Json::String(s) => match &s[..] {
            b"off" => Severity::Off,
            b"warn" => Severity::Warn,
            b"error" => Severity::Error,
            _ => return None,
        },
        _ => return None,
    })
}

/// An entry of ESLint's `rules`.
#[derive(Clone)]
pub struct ConfiguredRule {
    pub entry: &'static RuleEntry,
    pub severity: Severity,
    /// What follows the severity.
    pub options: Arc<[Json]>,
    /// `None` if it is off.
    instance: Option<Arc<dyn AnyRule>>,
}

impl ConfiguredRule {
    /// `instance`: the rule made from `options`. It is not needed for a rule that is off.
    pub fn new(entry: &'static RuleEntry, severity: Severity, options: Arc<[Json]>, instance: Option<Arc<dyn AnyRule>>) -> Self {
        ConfiguredRule {
            entry,
            severity,
            options,
            instance,
        }
    }

    pub fn instance(&self) -> Option<&dyn AnyRule> {
        self.instance.as_deref()
    }
}

/// The configuration of a file: what ESLint's `configs.getConfig(path)` returns.
#[derive(Clone, Default)]
pub struct ResolvedConfig {
    /// `languageOptions` and `settings`.
    pub language: LanguageOptions,
    pub linter: LinterOptions,
    /// In the order of the configuration, which is the order the rules run in.
    pub rules: Vec<ConfiguredRule>,
    /// The plugins that are configured and that are not implemented here, by the prefix of their
    /// rules. Their rules are skipped.
    pub foreign_plugins: Vec<Box<[u8]>>,
    /// A rule that does not exist is skipped, whatever its name.
    pub skips_unknown_rules: bool,
    /// A rule of ESLint that typescript-eslint extends stands for the extension, as in oxlint.
    pub prefers_typescript_rules: bool,
    /// `language`, if it is configured: `js/js`, `json/json`, .. Only JavaScript can be linted.
    pub language_name: Option<Box<[u8]>>,
    /// The name of the `processor`, if one is configured. None is implemented.
    pub processor: Option<Box<[u8]>>,
    /// The configuration is invalid, and ESLint would refuse to run: its message.
    pub error: Option<Vec<u8>>,
}

impl ResolvedConfig {
    pub fn rule(&self, entry: &RuleEntry) -> Option<&ConfiguredRule> {
        let (plugin, name) = (entry.meta.plugin, entry.meta.name);
        self.rules.iter().find(|it| it.entry.meta.plugin == plugin && it.entry.meta.name == name)
    }

    pub(crate) fn validate_language_options(&mut self, language_options: &Json) {
        if let Err(message) = LanguageOptions::validate_json(language_options) {
            self.error = Some([&b"Key \"languageOptions\": "[..], &message].concat());
        }
    }

    /// ESLint's `validateRulesConfig` for one rule. The first error is kept.
    pub(crate) fn validate(&mut self, entry: &'static RuleEntry, severity: Severity, options: &[Json]) {
        if severity != Severity::Off
            && self.error.is_none()
            && let Err(lines) = super::schema::validate(entry.meta, options)
        {
            let id = super::RuleId::Known(entry.meta).to_vec();
            self.error = Some([b"Key \"rules\": Key \"", &id[..], b"\":\n", &lines].concat());
        }
    }

    /// The rule that the configuration, or a comment of a file that it is for, calls `id`.
    pub fn find_rule(&self, registry: &Registry, id: &[u8]) -> Option<&'static RuleEntry> {
        let found = registry.find_preferring(id, self.prefers_typescript_rules);
        if found.is_some() || !self.prefers_typescript_rules {
            return found;
        }
        // oxlint goes by the name without the plugin: `no-explicit-any` is
        // `typescript/no-explicit-any`, and `@typescript-eslint/no-undef` is `no-undef`.
        let name = parse_rule_id(id).1;
        registry.get(Plugin::TypeScript, name).or_else(|| registry.get(Plugin::Eslint, name))
    }

    /// Whether the rule called `id`, which does not exist here, is skipped silently: it is of a
    /// plugin that is configured.
    pub fn is_foreign(&self, id: &[u8]) -> bool {
        let plugin = parse_rule_id(id).0;
        self.skips_unknown_rules || self.foreign_plugins.iter().any(|it| **it == *plugin)
    }

    /// Whether the file at `path` can be linted: it is JavaScript or TypeScript, as it is. Not if a
    /// processor is to take the code out of it, if its `language` is another, or if a parser that is
    /// not known here is to read what is not called like JavaScript (`.vue`, `.svelte`).
    pub fn is_supported(&self, path: &[u8]) -> bool {
        self.processor.is_none()
            && self.language_name.as_deref().is_none_or(|it| matches!(it, b"@/js" | b"js/js"))
            && (self.language.parser != Parser::Other || bun_sema::resolve::ScriptKind::from_file_name(path).is_some())
    }
}

impl LinterOptions {
    /// From ESLint's `linterOptions`. What is missing stays as it is in `self`.
    pub fn merge_json(&mut self, json: &Json) {
        if let Some(value) = json.get(b"noInlineConfig").and_then(Json::as_bool) {
            self.no_inline_config = value;
        }
        match json.get(b"reportUnusedDisableDirectives") {
            Some(Json::Bool(value)) => {
                self.report_unused_disable_directives = if *value { Severity::Warn } else { Severity::Off };
            }
            Some(value) => {
                if let Some(severity) = severity_of(value) {
                    self.report_unused_disable_directives = severity;
                }
            }
            None => {}
        }
        if let Some(severity) = json.get(b"reportUnusedInlineConfigs").and_then(severity_of) {
            self.report_unused_inline_configs = severity;
        }
    }
}

impl ResolvedConfig {
    /// From one configuration object of ESLint that applies to the file as it is: `rules`,
    /// `languageOptions`, `linterOptions`, `settings`, and `plugins` as an array of the prefixes of
    /// the plugins that are not implemented here. Rules that do not exist are added to `unknown`.
    pub fn from_json(registry: &Registry, json: &Json, unknown: &mut Vec<Box<[u8]>>) -> ResolvedConfig {
        let null = Json::Null;
        let mut config = ResolvedConfig {
            language: LanguageOptions::from_json(
                json.get(b"languageOptions").unwrap_or(&null),
                json.get(b"settings").unwrap_or(&null),
            ),
            ..ResolvedConfig::default()
        };
        config.validate_language_options(json.get(b"languageOptions").unwrap_or(&null));
        if let Some(linter) = json.get(b"linterOptions") {
            config.linter.merge_json(linter);
        }
        for plugin in json.get(b"plugins").and_then(Json::as_array).unwrap_or_default() {
            if let Some(plugin) = plugin.as_str() {
                config.foreign_plugins.push(plugin.into());
            }
        }
        for (id, value) in json.get(b"rules").and_then(Json::as_object).unwrap_or_default() {
            let Some(entry) = registry.find(id) else {
                unknown.push(id[..].into());
                continue;
            };
            let value: &[Json] = match value {
                Json::Array(items) => items,
                value => std::slice::from_ref(value),
            };
            let Some(severity) = value.first().and_then(severity_of) else {
                continue;
            };
            let options: Arc<[Json]> = value[1..].into();
            config.validate(entry, severity, &options);
            let instance = (severity != Severity::Off).then(|| Arc::from((entry.build)(&Options::new(&options))));
            config.rules.push(ConfiguredRule::new(entry, severity, options, instance));
        }
        config
    }
}
