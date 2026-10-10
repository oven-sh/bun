//! What is configured for one file.

use super::instances::Instance;
use super::registry::{Registry, parse_rule_id};
use crate::context::Severity;
use crate::js_plugin::{self, Route};
use crate::language::{LanguageOptions, Parser};
use crate::options::Json;
use crate::rule::{Meta, Plugin, When};
use crate::rule_set::RuleBits;
use crate::runner::RuleEntry;
use std::sync::{Arc, OnceLock};

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
    /// The rule made from `options`, as soon as a linter has linted with it. It is in the table of that linter: a configuration is for
    /// one.
    pub(super) instance: OnceLock<Instance>,
    /// What ESLint's rule throws for these options, which its schema accepts: [`Rule::validate`](crate::rule::Rule::validate).
    /// ESLint stops at the first file on which the rule runs: [`LintResult::thrown`](super::LintResult::thrown). A linter asks the
    /// first time that it lints with it.
    pub(super) refusal: OnceLock<Option<Arc<[u8]>>>,
    /// See [`ConfiguredRule::reported_as`].
    reported_as: &'static Meta,
    /// See [`ConfiguredRule::name`].
    name: Option<Arc<[u8]>>,
    /// See [`ConfiguredRule::or_else`].
    or_else: Option<Box<ConfiguredJsRule>>,
}

impl ConfiguredRule {
    pub fn new(entry: &'static RuleEntry, severity: Severity, options: Arc<[Json]>) -> Self {
        ConfiguredRule {
            entry,
            severity,
            options,
            instance: OnceLock::new(),
            refusal: OnceLock::new(),
            reported_as: entry.meta,
            name: None,
            or_else: None,
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

    /// What the configuration calls it, if it is one more instance of the rule under a name:
    /// [`RuleId::Named`](super::RuleId::Named).
    pub fn name(&self) -> Option<&Arc<[u8]>> {
        self.name.as_ref()
    }

    pub(crate) fn named(mut self, name: Option<Arc<[u8]>>) -> Self {
        self.name = name;
        self
    }

    /// The rule of the package in whose place this one answers, for the files that it
    /// [hands back](crate::ast::File::hand_back).
    pub fn or_else(&self) -> Option<&ConfiguredJsRule> {
        self.or_else.as_deref()
    }

    pub(crate) fn or(mut self, rule: Option<ConfiguredJsRule>) -> Self {
        self.or_else = rule.map(Box::new);
        self
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
    /// How many of [`ResolvedConfig::rules`] the configuration has before it.
    pub position: usize,
}

pub(crate) fn find_js_rule<'p>(
    plugins: &'p [Arc<js_plugin::Plugin>],
    id: &[u8],
) -> Option<Option<&'p Arc<js_plugin::Rule>>> {
    let (prefix, name) = parse_rule_id(id);
    let plugin = plugins.iter().find(|it| *it.name == *prefix)?;
    match plugin.rule(name) {
        // Beside the rules of `--rulesdir`, which have no prefix, there are those of ESLint.
        None if prefix.is_empty() => None,
        found => Some(found),
    }
}

/// What is the same for all files that have a configuration.
#[derive(Clone)]
pub(super) struct Prepared {
    /// The rules that are on.
    pub(super) on: RuleBits,
    /// They, in the order of the configuration. Those of a configuration of oxlint: by the numbers that oxlint gives
    /// its rules.
    pub(super) order: Box<[Slot]>,
    /// What the first of them that refuses its options throws.
    pub(super) refusal: Option<Arc<[u8]>>,
    /// Those that need types.
    pub(super) typed: Box<[&'static Meta]>,
}

#[derive(Copy, Clone)]
pub(super) struct Slot {
    /// Where it is in [`ResolvedConfig::rules`].
    pub(super) at: u32,
    /// In the set of the rules of the linter.
    pub(super) number: u16,
    /// With a configuration of oxlint: when oxlint reports what the rule reports.
    pub(super) when: When,
}

/// Whether the rule finds the files that imports name as `settings["import/resolver"]` says.
pub(crate) fn needs_resolver(meta: &Meta) -> bool {
    meta.plugin == Plugin::Import && meta.needs_modules
}

/// The configuration of a file: what ESLint's `configs.getConfig(path)` returns.
#[derive(Clone, Default)]
pub struct ResolvedConfig {
    /// `languageOptions` and `settings`.
    pub language: LanguageOptions,
    pub linter: LinterOptions,
    /// In the order of the configuration, which is the order the rules run in.
    pub(super) rules: Vec<ConfiguredRule>,
    /// What a linter has made of them, the first time that it has linted with the configuration, which is for one linter.
    pub(super) prepared: OnceLock<Prepared>,
    /// One of them has a [name](ConfiguredRule::name).
    pub has_named_rules: bool,
    /// The file that the plugin was loaded from whose rule one of them [stands in for](ConfiguredRule::or_else), if it is on and
    /// the plugin is from a file of its own.
    pub(super) package_module: Option<Arc<[u8]>>,
    /// `settings["import/resolver"]` names a resolver that the rules here do not do the same as.
    pub has_unknown_resolver: bool,
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
    /// The plugins of an `eslint.config.js` as `--print-config` has them, but for ESLint's own: `prefix:name@version`.
    pub printed_plugins: Vec<Box<[u8]>>,
    /// A rule that does not exist is skipped, whatever its name.
    pub skips_unknown_rules: bool,
    /// A rule that is configured for the file, and not off, is skipped. Nobody can say then that an `eslint-disable` without
    /// names is unused.
    pub has_skipped_rules: bool,
    /// With the configuration files of ESLint 8: the rules that are on and that it has no definition of, in the order of the
    /// configuration. Each is a message at the start of the file.
    pub missing_rules: Vec<Box<[u8]>>,
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
    /// The name of `languageOptions.parser`, if one is configured.
    pub parser_name: Option<Box<[u8]>>,
    /// One of the plugins is eslint-plugin-html, which changes ESLint's `Linter` when the configuration file loads it: that then
    /// finds the scripts in a file.
    pub changes_linter: bool,
    /// All of this for ESLint's own `Linter`, if that is what lints such a file ([`Route::Eslint`]) and if JSON can say it.
    pub for_eslint: Option<Arc<js_plugin::Configuration>>,
    /// The configuration is invalid, and ESLint would refuse to run: its message.
    pub error: Option<Vec<u8>>,
}

impl ResolvedConfig {
    pub fn rule(&self, entry: &RuleEntry) -> Option<&ConfiguredRule> {
        let (plugin, name) = (entry.meta.plugin, entry.meta.name);
        let is_it = |it: &&ConfiguredRule| {
            it.name.is_none() && it.entry.meta.plugin == plugin && it.entry.meta.name == name
        };
        self.rules.iter().find(is_it)
    }

    /// What the configuration says about the rules that are built in, also about those that it turns off, in its order.
    pub fn configured(&self) -> std::slice::Iter<'_, ConfiguredRule> {
        self.rules.iter()
    }

    /// Whether a rule is on of which `is_it` says so.
    pub fn has_enabled(&self, is_it: impl Fn(&Meta) -> bool) -> bool {
        let mut on = self.rules.iter().filter(|it| it.severity != Severity::Off);
        on.any(|it| is_it(it.entry.meta))
    }

    /// Whether a rule is on that has the rule of its package beside it, to which it can hand a file back.
    pub fn may_hand_back(&self) -> bool {
        let mut on = self.rules.iter().filter(|it| it.severity != Severity::Off);
        on.any(|it| it.or_else.is_some())
    }

    /// The instance of a rule that the configuration calls `id`: [`ConfiguredRule::name`]. Only the configuration gives names.
    pub fn named_rule(&self, id: &[u8]) -> Option<&ConfiguredRule> {
        let mut named = self.rules.iter().filter(|_| self.has_named_rules);
        named.find(|it| it.name.as_deref() == Some(id))
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
        name: Option<&[u8]>,
        severity: Severity,
        options: &[Json],
    ) {
        // The schemas are those of the rules for ESLint, and a poor witness of what oxlint refuses: its rules take other values
        // and other shapes (`"import/max-dependencies": ["error", 2]`, `"sort-keys": ["asc", { "minKeys": 1 }]`) and pass over
        // what they do not know. To refuse what it takes ends a run that works with it: beside its configuration they refuse
        // nothing, and the rule gets the options.
        if severity != Severity::Off
            && self.error.is_none()
            && !entry.meta.follows_oxlint
            && !self.prefers_typescript_rules
            && let Err(lines) = super::schema::validate(entry.meta, options)
        {
            let id = name.map_or_else(|| super::RuleId::Known(entry.meta).to_vec(), <[u8]>::to_vec);
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
        // A plugin that is not the one which is implemented here under that name hides it.
        let prefix = parse_rule_id(id).0;
        if self.foreign_plugins.iter().any(|it| **it == *prefix) {
            return None;
        }
        let found = registry
            .find_preferring(id, self.prefers_typescript_rules)
            .filter(|it| !(self.has_unknown_resolver && needs_resolver(it.meta)));
        if let Some(plugins) = &self.plugins {
            let has = |plugin: Plugin| plugin.is_always_there() || plugins.contains(&plugin);
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
        let is_implemented_in_part = Plugin::of_prefix(prefix).is_some_and(|plugin| {
            !plugin.is_whole() && (self.plugins.as_ref()).is_none_or(|all| all.contains(&plugin))
        });
        self.skips_unknown_rules
            || is_implemented_in_part
            || self.foreign_plugins.iter().any(|it| **it == *prefix)
    }

    /// Whether `language` is that of ESLint itself.
    pub fn is_javascript(&self) -> bool {
        (self.language_name.as_deref()).is_none_or(|it| matches!(it, b"@/js" | b"js/js"))
    }

    /// Whether there are files that [`Route::Eslint`] is the way of.
    pub(crate) fn is_for_eslint(&self) -> bool {
        !self.is_javascript() || self.language.parser == Parser::Other || self.changes_linter
    }

    /// How the file at `path` is linted after a processor, or if there is none.
    pub fn route_as_it_is(&self, path: &[u8]) -> Route {
        let is_read_here = (self.language.parser != Parser::Other && !self.changes_linter)
            || bun_sema::resolve::ScriptKind::from_file_name(path).is_some();
        match self.is_javascript() && is_read_here {
            true => Route::Native,
            false => Route::Eslint,
        }
    }

    /// How the file at `path` is linted. With a processor neither the language nor the parser reads the file itself.
    pub fn route(&self, path: &[u8]) -> Route {
        match (self.route_as_it_is(path), &self.processor) {
            (Route::Native | Route::Eslint, Some(_)) => Route::Processor,
            (route, _) => route,
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
            config.configure(entry, severity, &value[1..]);
        }
        config
    }

    /// What an entry of `rules` does, for whoever has the rule and not its name: the test suites. It is
    /// not a second way to read `rules`. `options`: what follows the severity.
    pub fn configure(&mut self, entry: &'static RuleEntry, severity: Severity, options: &[Json]) {
        let options: Arc<[Json]> = options.into();
        self.validate(entry, None, severity, &options);
        self.rules
            .push(ConfiguredRule::new(entry, severity, options));
        self.prepared = OnceLock::new();
    }
}
