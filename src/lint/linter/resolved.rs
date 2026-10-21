//! The resolved config of one file.

use super::instances::Instance;
use super::registry::{Deprecated, Registry, formatting_rule, parse_rule_id};
use crate::ast::File;
use crate::context::Severity;
use crate::js_plugin::{self, Route};
use crate::language::{LanguageOptions, Parser};
use crate::languages::{Dialect, LineBreaks};
use crate::options::Json;
use crate::oxlint_order::Ran as InOxlint;
use crate::rule::{Meta, Plugin};
use crate::rule_set::RuleBits;
use crate::runner::{Listeners, RuleEntry};
use std::sync::{Arc, OnceLock};

/// ESLint's `linterOptions`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct LinterOptions {
    /// Config comments are ignored, and each one is reported.
    pub no_inline_config: bool,
    pub report_unused_disable_directives: Severity,
    pub report_unused_inline_configs: Severity,
}

impl Default for LinterOptions {
    /// Matches ESLint's default config.
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
    /// The array elements after the severity.
    pub options: Arc<[Json]>,
    /// `RuleSetting::defaults`. A config comment's options are merged over these. `options` already includes them.
    pub(super) defaults: Vec<Json>,
    /// The rule built from `options`, set the first time a linter runs it. It points into that linter's table, so a
    /// config belongs to one linter.
    pub(super) instance: OnceLock<Instance>,
    /// The error ESLint's rule throws for these options even though its schema accepts them, from
    /// [`Rule::validate`](crate::rule::Rule::validate). ESLint stops at the first file the rule runs on (see
    /// [`LintResult::thrown`](super::LintResult::thrown)). Computed the first time a linter runs the rule.
    pub(super) options_error: OnceLock<Option<Arc<[u8]>>>,
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
            defaults: Vec::new(),
            instance: OnceLock::new(),
            options_error: OnceLock::new(),
            reported_as: entry.meta,
            name: None,
            or_else: None,
        }
    }

    /// The rule that reports are attributed to. oxlint has most of the rules typescript-eslint extends under their
    /// ESLint names, and we run the extension for those.
    pub fn reported_as(&self) -> &'static Meta {
        self.reported_as
    }

    pub(crate) fn with_defaults(mut self, defaults: Vec<Json>) -> Self {
        self.defaults = defaults;
        self
    }

    pub(crate) fn report_as(mut self, meta: &'static Meta) -> Self {
        self.reported_as = meta;
        self
    }

    /// The name the config gave it, if it's an extra named instance of the rule. See
    /// [`RuleId::Named`](super::RuleId::Named).
    pub fn name(&self) -> Option<&Arc<[u8]>> {
        self.name.as_ref()
    }

    pub(crate) fn named(mut self, name: Option<Arc<[u8]>>) -> Self {
        self.name = name;
        self
    }

    /// The package's rule that this one replaces. It runs on the files this one [hands
    /// back](crate::ast::File::hand_back).
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
    /// The array elements after the severity.
    pub options: Arc<[Json]>,
    /// How many of [`ResolvedConfig::rules`] come before it in the config.
    pub position: usize,
}

/// An entry of ESLint's `rules` for a [formatting rule](formatting_rule), which never runs.
#[derive(Clone)]
pub struct FormattingRule {
    pub rule: &'static Deprecated,
    pub severity: Severity,
    /// The array elements after the severity. Not validated.
    pub options: Vec<Json>,
    /// How many of [`ResolvedConfig::rules`] and of [`ResolvedConfig::js_rules`] come before it in the config.
    pub position: (usize, usize),
}

/// An entry of ESLint's `rules`.
#[derive(Copy, Clone)]
pub enum Entry<'c> {
    Native(&'c ConfiguredRule),
    Js(&'c ConfiguredJsRule),
    Formatting(&'c FormattingRule),
}

/// Like [`formatting_rule`], but returns `None` if `id` refers to some other rule: one from a plugin the built-in rules
/// don't replace (which includes every plugin in `foreign`), or one from `--rulesdir`.
pub(crate) fn find_formatting_rule(
    registry: &Registry,
    id: &[u8],
    foreign: &[Box<[u8]>],
    js_plugins: &[Arc<js_plugin::Plugin>],
) -> Option<&'static Deprecated> {
    let rule = formatting_rule(id)?;
    let prefix = parse_rule_id(id).0;
    let is_other_rule = !registry.replaces_plugin(prefix)
        || foreign.iter().any(|it| **it == *prefix)
        || prefix.is_empty() && find_js_rule(js_plugins, id).is_some();
    (!is_other_rule).then_some(rule)
}

pub(crate) fn find_js_rule<'p>(
    plugins: &'p [Arc<js_plugin::Plugin>],
    id: &[u8],
) -> Option<Option<&'p Arc<js_plugin::Rule>>> {
    let (prefix, name) = parse_rule_id(id);
    let plugin = plugins.iter().find(|it| *it.name == *prefix)?;
    match plugin.rule(name) {
        // `--rulesdir` rules have no prefix, and neither do ESLint's core rules.
        None if prefix.is_empty() => None,
        found => Some(found),
    }
}

/// State shared by every file that uses a config.
#[derive(Clone)]
pub(super) struct Prepared {
    /// The enabled rules.
    pub(super) on: RuleBits,
    /// The enabled rules in config order. With an oxlint config, they're sorted by oxlint's rule numbers instead.
    pub(super) order: Box<[Slot]>,
    /// Each rule's listeners, indexed like `order`.
    pub(super) listeners: Listeners,
    /// The rule instances, indexed like `order`. The linter builds this list and knows its concrete type.
    pub(super) rules: Arc<dyn std::any::Any + Send + Sync>,
    /// The error thrown by the first rule that rejects its options.
    pub(super) options_error: Option<Arc<[u8]>>,
    /// The enabled rules that need types.
    pub(super) typed: Box<[&'static Meta]>,
    /// True if an enabled rule needs the module graph, which means a file may be linted again.
    pub(super) needs_modules: bool,
}

#[derive(Copy, Clone)]
pub(super) struct Slot {
    /// Index in [`ResolvedConfig::rules`].
    pub(super) at: u32,
    /// The rule's number in the linter's rule set.
    pub(super) number: u16,
    /// With an oxlint config, how oxlint runs the rule. Otherwise only `when` is meaningful.
    pub(super) in_oxlint: InOxlint,
    pub(super) severity: Severity,
}

/// True if the rule resolves imports according to `settings["import/resolver"]`.
pub(crate) fn needs_resolver(meta: &Meta) -> bool {
    meta.plugin == Plugin::Import && meta.needs_modules
}

/// [`ResolvedConfig::skipped`]
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Skipped {
    #[default]
    None,
    /// Only rules of oxlint's `jsdoc` plugin, which report nothing in a file without a `/**` comment.
    OnlyJsdoc,
    Any,
}

/// A file's config. Equivalent to what ESLint's `configs.getConfig(path)` returns.
#[derive(Clone, Default)]
pub struct ResolvedConfig {
    /// `languageOptions` and `settings`.
    pub language: LanguageOptions,
    pub linter: LinterOptions,
    /// In config order, which is the order the rules run in.
    pub(super) rules: Vec<ConfiguredRule>,
    /// Built from `rules` the first time a linter uses this config. A config belongs to one linter.
    pub(super) prepared: OnceLock<Prepared>,
    /// True if any of `rules` has a [name](ConfiguredRule::name).
    pub has_named_rules: bool,
    /// [`ResolvedConfig::may_hand_back`]
    pub(super) may_hand_back: bool,
    /// The file the plugin was loaded from, for the first enabled rule that [replaces a package's
    /// rule](ConfiguredRule::or_else). `None` if the config didn't load the plugin from a module file.
    pub(super) package_module: Option<Arc<[u8]>>,
    /// True if `settings["import/resolver"]` lists a resolver the built-in rules can't emulate.
    pub has_unknown_resolver: bool,
    /// JavaScript plugin rules, including disabled ones. They run only if
    /// [`LintOptions::js_plugins`](super::LintOptions) is set.
    pub js_rules: Vec<ConfiguredJsRule>,
    /// Formatting rules, including disabled ones. `bun fmt` does their job.
    pub formatting_rules: Vec<FormattingRule>,
    /// Plugins with [no built-in rules](Plugin::has_no_rules) whose rules oxlint's `categories` turn on.
    pub plugins_without_rules: Vec<Plugin>,
    /// The parts of `language` that JavaScript plugin rules see. Set if `js_plugins` isn't empty.
    pub js_settings: Option<Arc<js_plugin::FileSettings>>,
    /// Like `js_settings`, for [`LanguageOptions::without_module_syntax`].
    pub js_settings_without_module_syntax: Option<Arc<js_plugin::FileSettings>>,
    /// The JavaScript plugins whose rules the config and the file's comments can refer to. Each one shadows the
    /// built-in plugin with the same name.
    pub js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// Configured plugins that aren't built in, by rule prefix. Their rules are skipped.
    pub foreign_plugins: Vec<Box<[u8]>>,
    /// An `eslint.config.js`'s plugins as `--print-config` prints them (`prefix:name@version`), without ESLint's own.
    pub printed_plugins: Vec<Box<[u8]>>,
    /// True if any rule that doesn't exist is skipped, whatever its name.
    pub skips_unknown_rules: bool,
    /// Tells whether any enabled rule is skipped for this file. If so, we can't know that an `eslint-disable` without
    /// rule names is unused.
    pub skipped: Skipped,
    /// With ESLint 8 config files: the enabled rules that have no definition, in config order. Each one is reported at
    /// the start of the file.
    pub missing_rules: Vec<Box<[u8]>>,
    /// True if an ESLint rule that typescript-eslint extends resolves to the extension, as in oxlint.
    pub prefers_typescript_rules: bool,
    /// True if there's no ESLint or oxlint config, so every built-in rule is available [under any of its
    /// names](Registry::find_by_any_name).
    pub has_every_rule: bool,
    /// True if `oxlint-disable` and the like work as `eslint-disable` does. ESLint ignores them, so they're ignored
    /// with an ESLint config.
    pub understands_oxlint_comments: bool,
    /// The built-in plugins registered by the config objects that apply to the file. For ESLint, no other plugin's
    /// rules exist there, so a comment can't refer to them. `None` means all plugins, as with `.oxlintrc.json`.
    pub plugins: Option<Vec<Plugin>>,
    /// `language`, if it's configured: `js/js`, `json/json`, ..
    pub language_name: Option<Box<[u8]>>,
    /// `languageOptions`, if the language isn't JavaScript. That language defines their meaning.
    pub other_language_options: Option<Json>,
    /// The language that `language_name` refers to, if it isn't JavaScript and Bun lints the file itself:
    /// [`Route::Language`].
    pub dialect: Option<Dialect>,
    /// The language's line breaks, for every [`Route`]. Defaults to ECMAScript's if Bun doesn't know the language.
    pub line_breaks: LineBreaks,
    /// The name of the `processor`, if one is configured.
    pub processor: Option<Box<[u8]>>,
    /// Where to load the processor from, if the config is an `eslint.config.js`.
    pub processor_location: Option<Arc<js_plugin::Processor>>,
    /// The name of `languageOptions.parser`, if one is configured.
    pub parser_name: Option<Box<[u8]>>,
    /// True if one of the plugins is eslint-plugin-html. Loading it patches ESLint's `Linter` to extract the scripts
    /// from an HTML file.
    pub changes_linter: bool,
    /// This whole config for ESLint's own `Linter`, if that's what lints the file ([`Route::Eslint`]) and the config
    /// can be serialized as JSON.
    pub for_eslint: Option<Arc<js_plugin::Configuration>>,
    /// ESLint's error message, if the config is invalid and ESLint would refuse to run.
    pub error: Option<Vec<u8>>,
}

impl ResolvedConfig {
    pub fn rule(&self, entry: &RuleEntry) -> Option<&ConfiguredRule> {
        let (plugin, name) = (entry.meta.plugin, entry.meta.name);
        let is_match = |it: &&ConfiguredRule| {
            it.name.is_none() && it.entry.meta.plugin == plugin && it.entry.meta.name == name
        };
        self.rules.iter().find(is_match)
    }

    /// The config's entries for built-in rules, including disabled ones, in config order.
    pub fn configured(&self) -> std::slice::Iter<'_, ConfiguredRule> {
        self.rules.iter()
    }

    /// All of the config's rule entries, in config order.
    pub fn entries(&self) -> impl Iterator<Item = Entry<'_>> {
        let mut native = self.rules.iter().enumerate().peekable();
        let mut js = self.js_rules.iter().enumerate().peekable();
        let mut formatting = self.formatting_rules.iter().peekable();
        std::iter::from_fn(move || {
            let seen = (
                native.peek().map_or(self.rules.len(), |it| it.0),
                js.peek().map_or(self.js_rules.len(), |it| it.0),
            );
            let is_next = |it: &&FormattingRule| it.position.0 <= seen.0 && it.position.1 <= seen.1;
            if let Some(rule) = formatting.next_if(is_next) {
                return Some(Entry::Formatting(rule));
            }
            if let Some((_, rule)) = js.next_if(|it| it.1.position <= seen.0) {
                return Some(Entry::Js(rule));
            }
            Some(Entry::Native(native.next()?.1))
        })
    }

    /// True if any enabled rule satisfies `is_match`.
    pub fn has_enabled(&self, is_match: impl Fn(&Meta) -> bool) -> bool {
        let mut on = self.rules.iter().filter(|it| it.severity != Severity::Off);
        on.any(|it| is_match(it.entry.meta))
    }

    /// True if an enabled rule has its [package's rule](ConfiguredRule::or_else) to hand a file back to.
    pub fn may_hand_back(&self) -> bool {
        self.may_hand_back
    }

    /// Returns the rule instance whose [`ConfiguredRule::name`] is `id`. Only the config can create named instances.
    pub fn named_rule(&self, id: &[u8]) -> Option<&ConfiguredRule> {
        let mut named = self.rules.iter().filter(|_| self.has_named_rules);
        named.find(|it| it.name.as_deref() == Some(id))
    }

    /// Returns `js_settings` or `js_settings_without_module_syntax`, whichever matches `file`'s source type. `file`
    /// must use this config.
    pub(crate) fn js_settings_of(&self, file: &File) -> Option<&Arc<js_plugin::FileSettings>> {
        match file.language().source_type == self.language.source_type {
            true => self.js_settings.as_ref(),
            false => self.js_settings_without_module_syntax.as_ref(),
        }
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
        // The schemas come from ESLint's rules and don't predict what oxlint rejects. Its rules accept other values and
        // shapes (`"import/max-dependencies": ["error", 2]`, `"sort-keys": ["asc", { "minKeys": 1 }]`) and ignore what
        // they don't recognize. Rejecting options oxlint accepts would fail a run that works with oxlint, so with an
        // oxlint config nothing is validated and the rule gets the options as they are.
        if severity == Severity::Off
            || self.error.is_some()
            || entry.meta.follows_oxlint
            || self.prefers_typescript_rules
            // The driver has already validated these options and prints its own error messages.
            || self.has_every_rule
        {
            return;
        }
        // No schema allows a BigInt, and `JSON.stringify` throws on it while ESLint builds the error message.
        if options.iter().find_map(super::schema::placeholder) == Some(b"bigint") {
            self.error = Some(b"TypeError: Do not know how to serialize a BigInt".to_vec());
        } else if let Err(lines) = super::schema::validate(entry.meta, options, false) {
            let id = name.map_or_else(|| super::RuleId::Known(entry.meta).to_vec(), <[u8]>::to_vec);
            self.error = Some([b"Key \"rules\": Key \"", &id[..], b"\":\n", &lines].concat());
        }
    }

    /// Looks up the JavaScript plugin rule that the config, or a comment in one of its files, calls `id`. Returns
    /// `Some(None)` if the plugin exists but has no such rule.
    pub fn find_js_rule(&self, id: &[u8]) -> Option<Option<&Arc<js_plugin::Rule>>> {
        find_js_rule(&self.js_plugins, id)
    }

    pub fn js_rule(&self, rule: &Arc<js_plugin::Rule>) -> Option<&ConfiguredJsRule> {
        (self.js_rules.iter()).find(|it| Arc::ptr_eq(&it.configured.rule, rule))
    }

    /// Looks up the built-in rule that the config, or a comment in one of its files, calls `id`.
    pub fn find_rule(&self, registry: &Registry, id: &[u8]) -> Option<&'static RuleEntry> {
        // A foreign plugin shadows the built-in plugin with the same prefix.
        let prefix = parse_rule_id(id).0;
        if self.foreign_plugins.iter().any(|it| **it == *prefix) {
            return None;
        }
        if self.has_every_rule {
            return registry.find_by_any_name(id);
        }
        let found = registry
            .find_preferring(id, self.prefers_typescript_rules)
            .filter(|it| !(self.has_unknown_resolver && needs_resolver(it.meta)));
        if let Some(plugins) = &self.plugins {
            let has = |plugin: Plugin| plugin.is_always_available() || plugins.contains(&plugin);
            return found.filter(|it| has(it.meta.plugin));
        }
        if found.is_some() || !self.prefers_typescript_rules {
            return found;
        }
        // For these two plugins oxlint ignores the prefix and looks the rule up by name: `no-explicit-any` is
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

    /// Records that `categories` turn on rules of `plugin`, which has [no built-in rules](Plugin::has_no_rules).
    pub(crate) fn skip_rules_of(&mut self, plugin: Plugin) {
        if !self.plugins_without_rules.contains(&plugin) {
            self.plugins_without_rules.push(plugin);
        }
        self.skip(plugin == Plugin::Jsdoc);
    }

    /// Records that an enabled rule is skipped. `is_jsdoc_rule` is true for a rule of oxlint's `jsdoc` plugin.
    pub(crate) fn skip(&mut self, is_jsdoc_rule: bool) {
        self.skipped = self.skipped.max(match is_jsdoc_rule {
            true => Skipped::OnlyJsdoc,
            false => Skipped::Any,
        });
    }

    /// Looks up the formatting rule that a comment in one of the config's files calls `id`. See
    /// [`find_formatting_rule`]. oxlint has no such rules.
    pub fn formatting_rule(&self, registry: &Registry, id: &[u8]) -> Option<&'static Deprecated> {
        let rule = find_formatting_rule(registry, id, &self.foreign_plugins, &self.js_plugins)?;
        let plugin = Plugin::from_prefix(parse_rule_id(id).0)?;
        let has_plugin = plugin.is_always_available()
            || (self.plugins.as_ref()).is_none_or(|all| all.contains(&plugin));
        (has_plugin && !self.prefers_typescript_rules).then_some(rule)
    }

    /// True if the rule `id`, which isn't built in, is skipped silently. That's the case if its plugin is configured
    /// and is either not built in or only partly built in.
    pub fn is_foreign(&self, id: &[u8]) -> bool {
        let prefix = parse_rule_id(id).0;
        let is_implemented_in_part = match self.has_every_rule {
            true => Plugin::spelled(prefix).any(|plugin| !plugin.is_whole()),
            false => Plugin::from_prefix(prefix).is_some_and(|plugin| {
                !plugin.is_whole()
                    && (self.plugins.as_ref()).is_none_or(|all| all.contains(&plugin))
            }),
        };
        self.skips_unknown_rules
            || is_implemented_in_part
            || self.foreign_plugins.iter().any(|it| **it == *prefix)
    }

    /// True if `language` is ESLint's own JavaScript language.
    pub fn is_javascript(&self) -> bool {
        (self.language_name.as_deref()).is_none_or(|it| matches!(it, b"@/js" | b"js/js"))
    }

    /// ESLint's `normalizeLanguageName`
    pub(crate) fn normalized_language_name(&self) -> &[u8] {
        match self.language_name.as_deref() {
            None | Some(b"@/js") => b"js/js",
            Some(name) => name,
        }
    }

    /// ESLint's `doesRuleSupportLanguage`
    pub(crate) fn supports_language(&self, rule: &Meta) -> bool {
        let name = self.normalized_language_name();
        rule.languages.is_empty()
            || rule.is_on_in_any_language
            || rule.languages.iter().any(|it| it.as_bytes() == name)
    }

    /// True if some files with this config may take [`Route::Eslint`].
    pub(crate) fn may_route_to_eslint(&self) -> bool {
        !self.is_javascript() || self.language.parser == Parser::Other || self.changes_linter
    }

    /// Returns how the file at `path` is linted, ignoring any processor. This is also the route of a processor's
    /// output.
    pub fn route_without_processor(&self, path: &[u8]) -> Route {
        let is_parsed_natively = (self.language.parser != Parser::Other && !self.changes_linter)
            || bun_sema::resolve::ScriptKind::from_file_name(path).is_some();
        match self.is_javascript() && is_parsed_natively {
            true => Route::Native,
            false if self.dialect.is_some() => Route::Language,
            false => Route::Eslint,
        }
    }

    /// Returns how the file at `path` is linted. With a processor, neither the language nor the parser reads the file
    /// itself.
    pub fn route(&self, path: &[u8]) -> Route {
        match (self.route_without_processor(path), &self.processor) {
            (Route::Native | Route::Language | Route::Eslint, Some(_)) => Route::Processor,
            (route, _) => route,
        }
    }
}

impl LinterOptions {
    /// Merges ESLint's `linterOptions` into `self`. Missing keys keep their current value.
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
    /// Builds a config from a single ESLint config object, without matching `files` or `ignores`. Reads `rules`,
    /// `languageOptions`, `linterOptions`, `settings`, and `plugins` as an array of the prefixes of plugins that aren't
    /// built in. Rules that don't exist are added to `unknown`.
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

    /// Adds one `rules` entry for a caller that has the rule itself instead of its name. Only the test suites use it,
    /// and it's not a second way to read `rules`. `options` are the array elements after the severity.
    pub fn configure(&mut self, entry: &'static RuleEntry, severity: Severity, options: &[Json]) {
        let options: Arc<[Json]> = options.into();
        self.validate(entry, None, severity, &options);
        self.rules
            .push(ConfiguredRule::new(entry, severity, options));
        self.prepared = OnceLock::new();
    }
}
