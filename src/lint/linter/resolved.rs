//! What is configured for one file.

use super::registry::{Registry, parse_rule_id};
use crate::context::Severity;
use crate::js_plugin::{self, Route};
use crate::language::{LanguageOptions, Parser};
use crate::options::{Json, Options};
use crate::rule::{Meta, Plugin};
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

/// The options that only the rule of oxlint has: keys of the first option, which is an object. With a configuration of oxlint they
/// are not validated.
const ONLY_OF_OXLINT: [(Plugin, &str, &[&str]); 2] = [
    (
        Plugin::TypeScript,
        "no-unused-vars",
        &["fix", "reportVarsOnlyUsedAsTypes"],
    ),
    (Plugin::Import, "no-cycle", &["ignoreTypes"]),
];

/// An entry of ESLint's `rules`.
#[derive(Clone)]
pub struct ConfiguredRule {
    pub entry: &'static RuleEntry,
    pub severity: Severity,
    /// What follows the severity.
    pub options: Arc<[Json]>,
    /// `None` if it is off.
    instance: Option<Arc<dyn AnyRule>>,
    /// What ESLint's rule throws for these options, which its schema accepts: [`Rule::validate`](crate::rule::Rule::validate).
    /// ESLint stops at the first file on which the rule runs: [`LintResult::thrown`](super::LintResult::thrown).
    refusal: Option<Arc<[u8]>>,
    /// See [`ConfiguredRule::reported_as`].
    reported_as: &'static Meta,
}

impl ConfiguredRule {
    /// `instance`: the rule made from `options`. It is not needed for a rule that is off.
    pub fn new(
        entry: &'static RuleEntry,
        severity: Severity,
        options: Arc<[Json]>,
        instance: Option<Arc<dyn AnyRule>>,
    ) -> Self {
        let refusal = match severity {
            Severity::Off => None,
            _ => (entry.validate)(&Options::new(&options))
                .err()
                .map(Arc::from),
        };
        ConfiguredRule {
            entry,
            severity,
            options,
            instance,
            refusal,
            reported_as: entry.meta,
        }
    }

    /// The rule that its messages are of. oxlint has most of the rules that typescript-eslint extends under the names of ESLint,
    /// and the extension runs in their place.
    pub fn reported_as(&self) -> &'static Meta {
        self.reported_as
    }

    pub(crate) fn report_as(mut self, meta: &'static Meta) -> Self {
        self.reported_as = meta;
        self
    }

    pub fn refusal(&self) -> Option<&[u8]> {
        self.refusal.as_deref()
    }

    pub fn instance(&self) -> Option<&dyn AnyRule> {
        self.instance.as_deref()
    }
}

/// An entry of ESLint's `rules` for a rule of a JavaScript plugin.
#[derive(Clone)]
pub struct ConfiguredJsRule {
    /// The rule, with its default options merged into `options`.
    pub configured: Arc<js_plugin::Configured>,
    pub severity: Severity,
    /// What follows the severity.
    pub options: Arc<[Json]>,
}

pub(crate) fn find_js_rule<'p>(
    plugins: &'p [Arc<js_plugin::Plugin>],
    id: &[u8],
) -> Option<Option<&'p Arc<js_plugin::Rule>>> {
    let (prefix, name) = parse_rule_id(id);
    let plugin = plugins.iter().find(|it| *it.name == *prefix)?;
    Some(plugin.rule(name))
}

/// The configuration of a file: what ESLint's `configs.getConfig(path)` returns.
#[derive(Clone, Default)]
pub struct ResolvedConfig {
    /// `languageOptions` and `settings`.
    pub language: LanguageOptions,
    pub linter: LinterOptions,
    /// In the order of the configuration, which is the order the rules run in.
    pub rules: Vec<ConfiguredRule>,
    /// Those of JavaScript plugins, also the ones that are off. They run if [`LintOptions::js_plugins`](super::LintOptions) is
    /// there, and are skipped otherwise.
    pub js_rules: Vec<ConfiguredJsRule>,
    /// What the rules of JavaScript plugins see of `language`. It is there if `js_plugins` is not empty.
    pub js_settings: Option<Arc<js_plugin::FileSettings>>,
    /// The JavaScript plugins whose rules the configuration and the comments of the file can name. The name of one hides
    /// the plugin of the same name that is implemented here.
    pub js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// The plugins that are configured and that are not implemented here, by the prefix of their
    /// rules. Their rules are skipped.
    pub foreign_plugins: Vec<Box<[u8]>>,
    /// A rule that does not exist is skipped, whatever its name.
    pub skips_unknown_rules: bool,
    /// A rule that is configured for the file, and not off, is skipped. Nobody can say then that an `eslint-disable` without
    /// names is unused.
    pub has_skipped_rules: bool,
    /// A rule of ESLint that typescript-eslint extends stands for the extension, as in oxlint.
    pub prefers_typescript_rules: bool,
    /// `oxlint-disable` and the like mean what `eslint-disable` means. ESLint ignores them, and so does a configuration of
    /// ESLint.
    pub understands_oxlint_comments: bool,
    /// The plugins, of those that are implemented here, that the configuration objects for the file have. For ESLint the rules
    /// of any other do not exist there, and a comment cannot name them. `None`: all of them, as with `.oxlintrc.json`.
    pub plugins: Option<Vec<Plugin>>,
    /// `language`, if it is configured: `js/js`, `json/json`, .. Only JavaScript can be linted.
    pub language_name: Option<Box<[u8]>>,
    /// The name of the `processor`, if one is configured.
    pub processor: Option<Box<[u8]>>,
    /// Where it is, if the configuration is an `eslint.config.js`.
    pub processor_location: Option<Arc<js_plugin::Processor>>,
    /// The configuration is invalid, and ESLint would refuse to run: its message.
    pub error: Option<Vec<u8>>,
}

impl ResolvedConfig {
    pub fn rule(&self, entry: &RuleEntry) -> Option<&ConfiguredRule> {
        let (plugin, name) = (entry.meta.plugin, entry.meta.name);
        self.rules
            .iter()
            .find(|it| it.entry.meta.plugin == plugin && it.entry.meta.name == name)
    }

    pub(crate) fn validate_language_options(&mut self, language_options: &Json) {
        if let Err(message) = LanguageOptions::validate_json(language_options) {
            self.error = Some([&b"Key \"languageOptions\": "[..], &message].concat());
        }
    }

    /// ESLint's `validateRulesConfig` for one rule. The first error is kept.
    pub(crate) fn validate(
        &mut self,
        entry: &'static RuleEntry,
        severity: Severity,
        options: &[Json],
    ) {
        // The rule gets them. The schema, which is that of ESLint's rule, does not know them.
        let only_of_oxlint = (ONLY_OF_OXLINT.iter())
            .find(|it| it.0 == entry.meta.plugin && it.1 == entry.meta.name)
            .filter(|_| self.prefers_typescript_rules);
        let without_them: Vec<Json>;
        let options = match (only_of_oxlint, options) {
            (Some((_, _, keys)), [Json::Object(entries), rest @ ..]) => {
                let is_known =
                    |it: &&(Vec<u8>, Json)| !keys.iter().any(|key| key.as_bytes() == &it.0[..]);
                let first = Json::Object(entries.iter().filter(is_known).cloned().collect());
                without_them = std::iter::once(first).chain(rest.iter().cloned()).collect();
                &without_them[..]
            }
            _ => options,
        };
        // The schemas are those of the rules for ESLint.
        if severity != Severity::Off
            && self.error.is_none()
            && !entry.meta.follows_oxlint
            && let Err(lines) = super::schema::validate(entry.meta, options)
        {
            let id = super::RuleId::Known(entry.meta).to_vec();
            self.error = Some([b"Key \"rules\": Key \"", &id[..], b"\":\n", &lines].concat());
        }
    }

    /// The rule of a JavaScript plugin that the configuration, or a comment of a file that it is for, calls `id`.
    /// `Some(None)`: the plugin has no such rule.
    pub fn find_js_rule(&self, id: &[u8]) -> Option<Option<&Arc<js_plugin::Rule>>> {
        find_js_rule(&self.js_plugins, id)
    }

    pub fn js_rule(&self, rule: &Arc<js_plugin::Rule>) -> Option<&ConfiguredJsRule> {
        (self.js_rules.iter()).find(|it| Arc::ptr_eq(&it.configured.rule, rule))
    }

    /// The rule that the configuration, or a comment of a file that it is for, calls `id`. Not one of a JavaScript plugin.
    pub fn find_rule(&self, registry: &Registry, id: &[u8]) -> Option<&'static RuleEntry> {
        let found = registry.find_preferring(id, self.prefers_typescript_rules);
        if let Some(plugins) = &self.plugins {
            let has = |plugin: Plugin| plugin == Plugin::Eslint || plugins.contains(&plugin);
            return found.filter(|it| has(it.meta.plugin));
        }
        if found.is_some() || !self.prefers_typescript_rules {
            return found;
        }
        // Between these two plugins oxlint goes by the name: `no-explicit-any` is
        // `typescript/no-explicit-any`, and `@typescript-eslint/no-undef` is `no-undef`.
        let (plugin, name) = parse_rule_id(id);
        let is_known = matches!(
            plugin,
            b"" | b"eslint" | b"typescript" | b"typescript-eslint" | b"@typescript-eslint"
        );
        if !is_known {
            return None;
        }
        registry
            .get(Plugin::TypeScript, name)
            .or_else(|| registry.get(Plugin::Eslint, name))
    }

    /// Whether the rule called `id`, which does not exist here, is skipped silently: it is of a
    /// plugin that is configured, and that is not implemented here or only in part.
    pub fn is_foreign(&self, id: &[u8]) -> bool {
        let prefix = parse_rule_id(id).0;
        let is_implemented_in_part = match Plugin::of_prefix(prefix) {
            None | Some(Plugin::Eslint | Plugin::TypeScript) => false,
            Some(plugin) => (self.plugins.as_ref()).is_none_or(|all| all.contains(&plugin)),
        };
        self.skips_unknown_rules
            || is_implemented_in_part
            || self.foreign_plugins.iter().any(|it| **it == *prefix)
    }

    /// How the file at `path` is linted.
    pub fn route(&self, path: &[u8]) -> Route {
        let is_javascript = self
            .language_name
            .as_deref()
            .is_none_or(|it| matches!(it, b"@/js" | b"js/js"));
        let is_read_here = self.language.parser != Parser::Other
            || bun_sema::resolve::ScriptKind::from_file_name(path).is_some();
        match &self.processor {
            _ if !is_javascript || !is_read_here => Route::Unsupported,
            Some(_) => Route::Processor,
            None => Route::Native,
        }
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
                self.report_unused_disable_directives = if *value {
                    Severity::Warn
                } else {
                    Severity::Off
                };
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
    pub fn from_json(
        registry: &Registry,
        json: &Json,
        unknown: &mut Vec<Box<[u8]>>,
    ) -> ResolvedConfig {
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
        for plugin in json
            .get(b"plugins")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            if let Some(plugin) = plugin.as_str() {
                config.foreign_plugins.push(plugin.into());
            }
        }
        for (id, value) in json
            .get(b"rules")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
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
            let instance = (severity != Severity::Off)
                .then(|| Arc::from((entry.build)(&Options::new(&options))));
            config
                .rules
                .push(ConfiguredRule::new(entry, severity, options, instance));
        }
        config
    }
}
