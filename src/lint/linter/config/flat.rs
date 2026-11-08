//! Reads ESLint's flat config from JSON.

use super::ignore_lines::IgnoreLines;
use super::merge::RuleSetting;
use super::rc::strings_of;
use super::{Config, ConfigObject, Pattern, presets};
use crate::context::Severity;
use crate::js_plugin;
use crate::linter::registry::{Deprecated, Missing, Registry, parse_rule_id};
use crate::linter::resolved::{find_formatting_rule, find_js_rule, needs_resolver};
use crate::options::Json;
use crate::paths::{self, package_of};
use crate::rule::{Frameworks, Kind, Plugin, minor_of};
use crate::runner::RuleEntry;
use std::sync::Arc;

/// A JavaScript plugin that's already loaded, and what `$jsPlugins` would have for it: `{ module, export }`. These come
/// from `plugins` in bunfig.toml and from `--plugin`.
pub type NamedPlugin = (Arc<js_plugin::Plugin>, Json);

/// Why a config can't be used. The text is ESLint's where ESLint has one.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfigError {
    pub message: Vec<u8>,
}

impl ConfigError {
    pub(super) fn new(parts: &[&[u8]]) -> ConfigError {
        ConfigError {
            message: parts.concat(),
        }
    }
}

/// Loads a JavaScript plugin: [`Host::load_located`](crate::js_plugin::Host). It gets the plugin's `$jsPlugins` entry
/// and the prefix of its rules.
pub type LoadLocatedPlugin<'l> =
    dyn FnMut(&Json, &[u8]) -> Result<Arc<js_plugin::Plugin>, Vec<u8>> + 'l;

/// The settings that depend on the kind of config file. See the [`Config`] fields with the same names.
#[derive(Copy, Clone)]
pub(super) struct Semantics {
    pub(super) keeps_options: bool,
    pub(super) accepts_all_plugins: bool,
    pub(super) is_legacy: bool,
}

/// State collected while the objects are read.
pub(super) struct Reader<'r> {
    pub(super) registry: &'r Registry,
    pub(super) base_path: Vec<u8>,
    pub(super) prefers_typescript_rules: bool,
    /// [`ResolvedConfig::has_every_rule`](crate::linter::ResolvedConfig)
    pub(super) has_every_rule: bool,
    pub(super) objects: Vec<ConfigObject>,
    pub(super) notes: Vec<Vec<u8>>,
    /// [`Config::advice`]
    pub(super) advice: Vec<Vec<u8>>,
    pub(super) unknown_rules: Vec<Box<[u8]>>,
    /// The loaded JavaScript plugins.
    pub(super) js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// Each one's index in `js_locations`.
    pub(super) js_plugin_location_indices: Vec<u32>,
    /// `$jsPlugins`: each prefix with the location its plugin can be loaded from.
    pub(super) js_locations: Vec<(Box<[u8]>, Json)>,
    /// How many of the objects are ESLint's own.
    pub(super) defaults: usize,
    /// The names of the config's plugins that aren't [built in](is_built_in).
    pub(super) foreign_prefixes: Vec<Box<[u8]>>,
    /// How many leading entries of `js_plugins` and of `js_locations` are [`NamedPlugin`]s.
    pub(super) named: usize,
    /// [`settings_have_unknown_resolver`] is true for some object.
    pub(super) has_unknown_resolver: bool,
    /// The names of the plugins with an enabled rule that's built in and can hand a file back to the package.
    pub(super) plugins_handing_back: Vec<Box<[u8]>>,
}

/// True if the plugin that a config registers as `prefix` is the one Bun implements, which requires its usual name.
/// `name` is the plugin's own name with its version, if it has one. Under another name, like `ts` or `node` in
/// `@antfu/eslint-config`, or if a different plugin uses the name, like `import-x` as `import` there, it runs as plain
/// JavaScript. That way its rules keep the names the config gives them, in reports and in comments. The same happens if
/// the built-in rules [don't replace it](Registry::replaces_plugin) and `can_be_loaded`, i.e. the config tells where
/// the plugin's own rules are.
fn is_built_in(
    registry: &Registry,
    prefix: &[u8],
    name: Option<&[u8]>,
    can_be_loaded: bool,
) -> bool {
    let package = name.map(
        |name| match bun_core::strings::last_index_of_char(name, b'@') {
            Some(at) if at > 0 => &name[..at],
            _ => name,
        },
    );
    // ESLint keeps its own rules in a plugin named `@`.
    let answers = registry.replaces_plugin(prefix) || !can_be_loaded;
    prefix == b"@" || answers && Plugin::replaces_package(prefix, package)
}

/// A plugin's name: the name it declares, with its version, or else the package that exports it, if it was found in a
/// module. `name` and `located` are its entries in the object's `plugins` and `$jsPlugins`. eslint-plugin-import,
/// eslint-plugin-react and eslint-plugin-import-lite, which `@antfu/eslint-config` registers as `import`, don't declare
/// a name.
fn plugin_display_name<'j>(name: &'j Json, located: Option<&'j Json>) -> Option<&'j [u8]> {
    let module = || located?.get(b"module")?.as_str();
    name.as_str().or_else(|| module().map(package_of))
}

/// Adds the names of the plugins in `json` that aren't [built in](is_built_in). `json` is a config file's export or
/// part of it. An object can configure rules of a plugin that a later object registers.
fn add_foreign_prefixes(registry: &Registry, json: &Json, into: &mut Vec<Box<[u8]>>) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return;
    }
    if let Json::Array(items) = json {
        for item in items {
            add_foreign_prefixes(registry, item, into);
        }
        return;
    }
    let plugins = json.get(b"plugins").and_then(Json::as_object);
    let located = json.get(b"$jsPlugins");
    for (prefix, name) in plugins.unwrap_or_default() {
        let located = located.and_then(|it| it.get(prefix));
        if !is_built_in(
            registry,
            prefix,
            plugin_display_name(name, located),
            located.is_some(),
        ) && !into.iter().any(|it| **it == prefix[..])
        {
            into.push(prefix[..].into());
        }
    }
    if let Some(extends) = json.get(b"extends") {
        add_foreign_prefixes(registry, extends, into);
    }
}

/// True if `settings` has an `import/resolver` or an `import/parsers` parser that the built-in rules don't emulate, or
/// a regular expression that isn't written as a string, which they don't read. The package's rules run in that case.
pub(super) fn settings_have_unknown_resolver(settings: &Json) -> bool {
    let is_expression = |it: &Json| it.get(b"$regexp").is_some();
    let ignored = settings.get(b"import/ignore").and_then(Json::as_array);
    if ignored.unwrap_or_default().iter().any(is_expression)
        || settings
            .get(b"import/internal-regex")
            .is_some_and(is_expression)
    {
        return true;
    }
    let parsers = settings.get(b"import/parsers").and_then(Json::as_object);
    let is_known_parser = |name: &[u8]| {
        matches!(
            package_of(name),
            b"espree" | b"@typescript-eslint/parser" | b"@typescript-eslint\\parser"
        )
    };
    if (parsers.unwrap_or_default().iter()).any(|it| !is_known_parser(&it.0)) {
        return true;
    }
    let is_known = |name: &[u8]| {
        let name = package_of(name);
        let name = name
            .strip_prefix(b"eslint-import-resolver-")
            .unwrap_or(name);
        matches!(name, b"node" | b"typescript")
    };
    // `new Set(..)` throws on these.
    let core_modules = settings.get(b"import/core-modules");
    if matches!(
        core_modules,
        Some(Json::Bool(_) | Json::Number(_) | Json::Object(_))
    ) {
        return true;
    }
    // `resolverReducer` recurses into arrays, and throws on anything that isn't a string or an object.
    let resolver_setting = settings.get(b"import/resolver");
    let mut pending: Vec<&Json> = resolver_setting
        .filter(|it| it.is_truthy())
        .into_iter()
        .collect();
    while let Some(it) = pending.pop() {
        match it {
            Json::Array(items) => pending.extend(items),
            Json::String(name) if is_known(name) => {}
            Json::Object(entries) if entries.iter().all(|it| is_known(&it.0)) => {}
            Json::Null => {}
            _ => return true,
        }
    }
    false
}

/// [`settings_have_unknown_resolver`] for a config file's export, or part of it.
fn has_unknown_resolver(json: &Json) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    if let Json::Array(items) = json {
        return items.iter().any(has_unknown_resolver);
    }
    json.get(b"settings")
        .is_some_and(settings_have_unknown_resolver)
        || (json.get(b"extends")).is_some_and(has_unknown_resolver)
}

const META_KEYS: [&[u8]; 2] = [b"name", b"basePath"];

/// `Kind::Problem` rules that [warn by default](Reader::set_severity_by_kind) anyway. An error fails CI, so it has to be right nearly
/// every time. These find unused or useless code, or code that people often write on purpose: `while (match = re.exec(text))`,
/// `object.hasOwnProperty(key)`, a regular expression that strips ANSI escapes.
const WARN_BY_DEFAULT: [&[u8]; 29] = [
    b"@typescript-eslint/await-thenable",
    b"@typescript-eslint/ban-ts-comment",
    b"@typescript-eslint/no-duplicate-enum-values",
    b"@typescript-eslint/no-extra-non-null-assertion",
    b"@typescript-eslint/no-non-null-asserted-optional-chain",
    b"@typescript-eslint/no-unsafe-argument",
    b"@typescript-eslint/no-unsafe-assignment",
    b"@typescript-eslint/no-unsafe-call",
    b"@typescript-eslint/no-unsafe-declaration-merging",
    b"@typescript-eslint/no-unsafe-function-type",
    b"@typescript-eslint/no-unsafe-member-access",
    b"@typescript-eslint/no-unsafe-return",
    b"@typescript-eslint/no-unused-vars",
    b"@typescript-eslint/no-wrapper-object-types",
    b"no-cond-assign",
    b"no-constant-condition",
    b"no-control-regex",
    b"no-empty-character-class",
    b"no-empty-pattern",
    b"no-ex-assign",
    b"no-prototype-builtins",
    b"no-self-assign",
    b"no-setter-return",
    b"no-unassigned-vars",
    b"no-unreachable",
    b"no-unused-private-class-members",
    b"no-unused-vars",
    b"no-useless-assignment",
    b"no-useless-backreference",
];

/// `Config "name": ` or `Config (unnamed): `, the prefix of a `ConfigError`'s message.
fn config_name(json: &Json) -> Vec<u8> {
    match json.get(b"name").and_then(Json::as_str) {
        Some(name) if !name.is_empty() => [b"Config \"", name, b"\": "].concat(),
        _ => b"Config (unnamed): ".to_vec(),
    }
}

/// The error that `structuredClone` throws for a rule's options. See `serializeOption` in evaluate-describe.js.
fn uncloneable_option(json: &Json) -> Option<Vec<u8>> {
    fn why(json: &Json) -> Option<&[u8]> {
        match json {
            Json::Array(items) => items.iter().find_map(why),
            Json::Object(_) if json.get(b"$unserializable").is_some() => json.get(b"why")?.as_str(),
            Json::Object(entries) => entries.iter().find_map(|it| why(&it.1)),
            _ => None,
        }
    }
    let rules = json.get(b"rules")?.as_object()?;
    let (id, why) = rules.iter().find_map(|it| Some((&it.0, why(&it.1)?)))?;
    Some([b"Key \"rules\": Key \"", &id[..], b"\": ", why].concat())
}

/// `ValidationStrategy.object`
fn is_object(value: &Json) -> bool {
    matches!(value, Json::Object(_) | Json::Array(_))
}

/// How `flatConfigSchema` validates `linterOptions`.
fn validate_linter_options(value: &Json) -> Option<Vec<u8>> {
    if !is_object(value) {
        return Some(b"Expected an object.".to_vec());
    }
    let is_severity = |it: &Json| crate::linter::severity_of(it).is_some();
    for (key, value) in value.as_object().unwrap_or_default() {
        let problem: Option<&[u8]> = match &key[..] {
            b"noInlineConfig" => value.as_bool().is_none().then_some(b"Expected a boolean."),
            b"reportUnusedDisableDirectives" => (!is_severity(value) && value.as_bool().is_none())
                .then_some(
                    b"Expected one of: \"error\", \"warn\", \"off\", 0, 1, 2, or a boolean.",
                ),
            b"reportUnusedInlineConfigs" => (!is_severity(value))
                .then_some(b"Expected one of: \"error\", \"warn\", \"off\", 0, 1, or 2."),
            _ => return Some([b"Unexpected key \"", &key[..], b"\" found."].concat()),
        };
        if let Some(problem) = problem {
            return Some([b"Key \"", &key[..], b"\": ", problem].concat());
        }
    }
    None
}

/// `ObjectSchema.validate` with `flatConfigSchema`. Returns what's wrong with a config object. ESLint only validates an
/// object when it's merged, so only if it matches a file.
fn validate_object(entries: &[(Vec<u8>, Json)]) -> Option<Vec<u8>> {
    let expected_object = || Some(b"Expected an object.".to_vec());
    for (key, value) in entries {
        let problem: Option<Vec<u8>> = match &key[..] {
            b"basePath" | b"files" | b"ignores" | b"language" | b"processor" => None,
            b"name" if value.as_str().is_none() => Some(b"Property must be a string.".to_vec()),
            b"name" => None,
            b"settings" | b"languageOptions" if !is_object(value) => expected_object(),
            b"settings" | b"languageOptions" => None,
            b"linterOptions" => validate_linter_options(value),
            b"plugins" => match value {
                Json::Object(_) => None,
                Json::Array(_) => Some(
                    b"This appears to be in eslintrc format (array of strings) rather than flat config format (object)."
                        .to_vec(),
                ),
                _ => expected_object(),
            },
            // Bun's own keys. See `Config::from_flat_json_with_plugins`.
            b"$changesLinter" | b"$defaultOptions" | b"$framework" | b"$gitignoreLines" | b"$globsOfBun"
            | b"$ignorePatterns" | b"$jsPlugins" | b"$otherPlugins" | b"$packageType" | b"$parser" | b"$pluginModules" | b"$processor"
            | b"$severityByKind" | b"$source"
            | b"$withoutWarnings" => None,
            b"rules" if !is_object(value) => expected_object(),
            b"rules" => (value.as_object().unwrap_or_default().iter())
                .find(|it| it.0 != b"__proto__" && RuleSetting::new(&it.0, &it.1).is_none())
                .map(|(id, _)| {
                    [
                        b"Key \"",
                        &id[..],
                        b"\": Expected severity of \"off\", 0, \"warn\", 1, \"error\", or 2.",
                    ]
                    .concat()
                }),
            b"env" | b"extends" | b"globals" | b"ignorePatterns" | b"noInlineConfig"
            | b"overrides" | b"parser" | b"parserOptions" | b"reportUnusedDisableDirectives"
            | b"root" => Some(
                b"This appears to be in eslintrc format rather than flat config format.".to_vec(),
            ),
            _ => return Some([b"Unexpected key \"", &key[..], b"\" found."].concat()),
        };
        if let Some(problem) = problem {
            return Some([b"Key \"", &key[..], b"\": ", &problem].concat());
        }
    }
    None
}

impl Reader<'_> {
    pub(super) fn note(&mut self, parts: &[&[u8]]) {
        let note = parts.concat();
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
    }

    /// Warns that an oxlint config turns off `id`, which isn't a rule. oxlint rejects such a config. Bun has the rules
    /// of one oxlint version, so a config for a later version can list a rule that Bun doesn't know.
    fn note_unknown_disabled_rule(&mut self, id: &[u8]) {
        let hint = match self.registry.why_missing(id) {
            Missing::PluginHasNoRules(_) => return,
            Missing::Unknown(Some(close)) => [b"Did you mean \"", &close[..], b"\"?"].concat(),
            Missing::Unknown(None) | Missing::Formatting => {
                b"It has no effect. Fix the name or remove it.".to_vec()
            }
        };
        self.note(&[
            b"Unknown rule \"",
            id,
            b"\" is turned off in the oxlint config\n  ",
            &hint,
        ]);
    }

    /// Adds advice if the built-in rules that replace the plugin registered as `prefix` follow a later version than the
    /// installed one. `name` is the plugin's own name: `<package>@<version>`.
    pub(super) fn advise_about_version(&mut self, prefix: &[u8], name: &[u8]) {
        let Some(at) = bun_core::strings::last_index_of_char(name, b'@').filter(|at| *at > 0)
        else {
            return;
        };
        let (package, installed) = (&name[..at], &name[at + 1..]);
        let Some(ours) = Plugin::from_prefix(prefix).and_then(Plugin::follows) else {
            return;
        };
        if minor_of(installed).is_none_or(|it| Some(it) >= minor_of(ours.as_bytes())) {
            return;
        }
        let line = [
            package,
            b" ",
            installed,
            b" is installed, but bun lint's built-in rules match ",
            ours.as_bytes(),
        ]
        .concat();
        if !self.advice.contains(&line) {
            self.advice.push(line);
        }
    }

    /// The patterns in `items`, which are already validated. `json` is the object that has them.
    fn patterns(
        &self,
        json: &Json,
        key: &str,
        items: &[Json],
    ) -> Result<Vec<Pattern>, ConfigError> {
        // Overrides from bunfig.toml are marked with `$globsOfBun`.
        let are_bun_globs = json.get(b"$globsOfBun").is_some();
        let patterns = items.iter().map(|item| match item {
            Json::String(pattern) if are_bun_globs => Ok(Pattern::of_bunfig(pattern)),
            Json::String(pattern) => Ok(Pattern::new(pattern)),
            // There's no way to tell which files a function matches. Linting fewer files than ESLint and finding no
            // problems is worse than not linting.
            _ => {
                let index = self.objects.len().saturating_sub(self.defaults).to_string();
                Err(ConfigError::new(&[
                    &config_name(json),
                    b"Key \"",
                    key.as_bytes(),
                    b"\": Functions are not supported, at user-defined index ",
                    index.as_bytes(),
                    b".\nFlatCompat from @eslint/eslintrc creates one for each \"overrides\" and \"ignorePatterns\" entry.",
                ]))
            }
        });
        patterns.collect()
    }

    /// The built-in rule that replaces `id`. If there is none, the plugin that the config has for it is loaded.
    pub(super) fn native_rule(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        if self.has_every_rule {
            return self.registry.find_by_any_name(id);
        }
        let prefix = parse_rule_id(id).0;
        let is_foreign = self.foreign_prefixes.iter().any(|it| **it == *prefix);
        (self
            .registry
            .find_preferring(id, self.prefers_typescript_rules))
        .filter(|it| !is_foreign && !(self.has_unknown_resolver && needs_resolver(it.meta)))
    }

    /// [`find_formatting_rule`]. oxlint has no such rules.
    pub(super) fn formatting_rule(&self, id: &[u8]) -> Option<&'static Deprecated> {
        find_formatting_rule(self.registry, id, &self.foreign_prefixes, &self.js_plugins)
            .filter(|_| !self.prefers_typescript_rules)
    }

    /// Reads an object's rules.
    pub(super) fn rules(&mut self, rules: &Json) -> Result<Vec<RuleSetting>, ConfigError> {
        let mut settings = Vec::new();
        for (id, value) in rules.as_object().unwrap_or_default() {
            if id == b"__proto__" {
                continue;
            }
            let id = &id[..];
            let (prefix, name) = parse_rule_id(id);
            let Some(mut setting) = RuleSetting::new(id, value) else {
                return Err(ConfigError::new(&[
                    b"Key \"rules\": Key \"",
                    id,
                    b"\": Expected severity of \"off\", 0, \"warn\", 1, \"error\", or 2.",
                ]));
            };
            let is_about_layout = self.formatting_rule(id).is_some();
            if !is_about_layout && let Some(found) = find_js_rule(&self.js_plugins, id) {
                // This also applies to a rule that's off, as in oxlint. ESLint doesn't look at such a rule.
                let Some(rule) = found else {
                    if !self.prefers_typescript_rules && setting.severity == Severity::Off {
                        continue;
                    }
                    return Err(ConfigError::new(&[
                        b"Rule '",
                        name,
                        b"' not found in plugin '",
                        prefix,
                        b"'",
                    ]));
                };
                // oxlint checks every entry's options before it lints, even if the entry is off or in an override that
                // matches no file. ESLint only checks them for the files where the rule is on.
                if self.prefers_typescript_rules
                    && let Err(lines) = crate::linter::schema::validate_js(rule, &setting.options)
                {
                    let message = super::oxlint_js_options_error(rule, &setting.options, &lines);
                    return Err(ConfigError { message });
                }
                // A worker only gets JSON.
                let kind = setting
                    .options
                    .iter()
                    .find_map(crate::linter::schema::placeholder);
                if let (Some(kind), true) = (kind, setting.severity != Severity::Off) {
                    return Err(ConfigError::new(&[
                        b"Key \"rules\": Key \"",
                        id,
                        b"\": Options for a rule that runs in JavaScript must be JSON, not ",
                        kind,
                        b".",
                    ]));
                }
                setting.plugin = prefix.into();
                settings.push(setting);
                continue;
            }
            let is_foreign = self.foreign_prefixes.iter().any(|it| **it == *prefix);
            setting.builtin_plugin = match self.prefers_typescript_rules {
                _ if is_foreign => None,
                _ if self.has_every_rule => self.native_rule(id).map(|it| it.meta.plugin),
                true => Plugin::from_oxlint_prefix(prefix),
                false => Plugin::from_prefix(prefix),
            };
            if !matches!(prefix, b"eslint" | b"typescript" | b"typescript-eslint") {
                setting.plugin = parse_rule_id(id).0.into();
            }
            match self.native_rule(id) {
                Some(entry) => {
                    let is_new = !self.plugins_handing_back.iter().any(|it| **it == *prefix);
                    if entry.meta.hands_back && setting.severity != Severity::Off && is_new {
                        self.plugins_handing_back.push(prefix.into());
                    }
                    setting.id = crate::linter::RuleId::Known(entry.meta).to_vec().into()
                }
                // An extra instance of one of ESLint's own rules, which don't belong to a plugin.
                None if !is_foreign && self.registry.base_of(id).is_some() => {
                    setting.plugin = Box::default();
                }
                None if is_about_layout => {}
                None => {
                    let is_new = !self.unknown_rules.iter().any(|it| **it == *id);
                    if setting.severity != Severity::Off && is_new {
                        self.unknown_rules.push(id.into());
                    }
                    if setting.severity == Severity::Off && self.prefers_typescript_rules {
                        self.note_unknown_disabled_rule(id);
                    }
                }
            }
            settings.push(setting);
        }
        Ok(settings)
    }

    /// `$severityByKind`, which `bun lint`'s default config sets. Enabled `Kind::Problem` rules become errors, except those in
    /// [`WARN_BY_DEFAULT`]. Every other enabled rule becomes a warning.
    fn set_severity_by_kind(&self, settings: &mut [RuleSetting]) {
        for setting in settings
            .iter_mut()
            .filter(|it| it.severity != Severity::Off)
        {
            let kind = self.native_rule(&setting.id).map(|it| it.meta.kind);
            setting.severity = match kind {
                Some(Kind::Problem) if !WARN_BY_DEFAULT.contains(&&setting.id[..]) => {
                    Severity::Error
                }
                _ => Severity::Warn,
            };
        }
    }

    /// `$withoutWarnings`, which `bun lint`'s default config sets for declaration files. Turns off every rule that the config
    /// objects so far set to warn.
    fn without_warnings(&self) -> Vec<RuleSetting> {
        let so_far = self.objects.iter().flat_map(|it| &it.rules);
        let off = |it: &RuleSetting| RuleSetting {
            severity: Severity::Off,
            options: Vec::new(),
            has_only_severity: true,
            ..it.clone()
        };
        so_far
            .filter(|it| it.severity == Severity::Warn)
            .map(off)
            .collect()
    }

    /// `assertValidBaseConfig`, plus what `wrapConfigErrorWithDetails` adds.
    fn validate_base(&self, json: &Json) -> Result<(), ConfigError> {
        let is_matcher = |it: &Json| it.as_str().is_some() || it.get(b"$unserializable").is_some();
        let only_matchers: &[u8] = b"Expected array to only contain strings and functions";
        let problem: Option<(&[u8], &[u8])> = match json {
            Json::Null => Some((b"", b"Unexpected null config")),
            Json::Object(_) => None,
            _ => Some((b"", b"Unexpected non-object config")),
        };
        let problem = problem.or_else(|| {
            let base_path = json.get(b"basePath")?;
            (base_path.as_str().is_none())
                .then_some((&b"basePath"[..], &b"Expected value to be a string"[..]))
        });
        let problem = problem.or_else(|| {
            let Some(files) = json.get(b"files")?.as_array().filter(|it| !it.is_empty()) else {
                return Some((b"files", b"Expected value to be a non-empty array"));
            };
            files.iter().find_map(|item| match item {
                Json::Array(all) if all.iter().all(is_matcher) => None,
                Json::Array(_) => Some((&b"files"[..], only_matchers)),
                item if is_matcher(item) => None,
                _ => Some((
                    b"files",
                    b"Items must be a string, a function, or an array of strings and functions",
                )),
            })
        });
        let problem = problem.or_else(|| match json.get(b"ignores")?.as_array() {
            None => Some((&b"ignores"[..], &b"Expected value to be an array"[..])),
            Some(all) if all.iter().all(is_matcher) => None,
            Some(_) => Some((b"ignores", only_matchers)),
        });
        let Some((key, message)) = problem else {
            return Ok(());
        };
        let key = match key {
            b"" => Vec::new(),
            key => [b"Key \"", key, b"\": "].concat(),
        };
        let index = self.objects.len().saturating_sub(self.defaults).to_string();
        Err(ConfigError::new(&[
            &config_name(json),
            &key,
            message,
            b" at user-defined index ",
            index.as_bytes(),
            b".",
        ]))
    }

    /// Reads one object of a flat config, without its `extends`.
    pub(super) fn object(&mut self, json: &Json) -> Result<ConfigObject, ConfigError> {
        self.validate_base(json)?;
        let entries = json.as_object().unwrap_or_default();
        let mut object = ConfigObject::default();
        if let Some(base_path) = json.get(b"basePath").and_then(Json::as_str) {
            let base_path = paths::portable(&self.base_path, base_path);
            object.base_path = Some(paths::resolve(&self.base_path, &base_path));
        }
        if let Some(files) = json.get(b"files").and_then(Json::as_array) {
            let mut alternatives = Vec::with_capacity(files.len());
            for item in files {
                alternatives.push(match item {
                    Json::Array(all) => self.patterns(json, "files", all)?,
                    item => self.patterns(json, "files", std::slice::from_ref(item))?,
                });
            }
            object.files = Some(alternatives);
        }
        if let Some(ignores) = json.get(b"ignores").and_then(Json::as_array) {
            object.ignores = Some(self.patterns(json, "ignores", ignores)?);
            object.is_global_ignores = entries
                .iter()
                .filter(|it| !META_KEYS.contains(&&it.0[..]))
                .count()
                == 1;
        }
        if let Some(lines) = json.get(b"$ignorePatterns") {
            object.ignore_lines = Some(IgnoreLines::of_eslint_8(&strings_of(Some(lines))));
            object.is_global_ignores = true;
        }
        if let Some(lines) = json.get(b"$gitignoreLines") {
            object.ignore_lines = Some(IgnoreLines::of_bunfig(&strings_of(Some(lines))));
            object.is_global_ignores = true;
        }
        if let Some(message) = validate_object(entries).or_else(|| uncloneable_option(json)) {
            object.error = Some([&config_name(json)[..], &message].concat());
            return Ok(object);
        }
        for (prefix, name) in json
            .get(b"plugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            let located = json.get(b"$jsPlugins").and_then(|it| it.get(prefix));
            let can_be_loaded =
                located.is_some() || self.js_locations.iter().any(|it| *it.0 == prefix[..]);
            match is_built_in(
                self.registry,
                prefix,
                plugin_display_name(name, located),
                can_be_loaded,
            ) {
                true => {
                    object.plugins.push(prefix[..].into());
                    if let Some(name) = name.as_str() {
                        self.advise_about_version(prefix, name);
                    }
                }
                false => object.foreign_plugins.push(prefix[..].into()),
            }
            if prefix != b"@" {
                object.printed_plugins.push(match name.as_str() {
                    Some(name) => [&prefix[..], b":", name].concat().into(),
                    None => prefix[..].into(),
                });
            }
        }
        let modules_of = |prefix: &[u8]| json.get(b"$pluginModules")?.get(prefix);
        let others = json.get(b"$otherPlugins").and_then(Json::as_object);
        for (prefix, location) in others.unwrap_or_default() {
            self.reject_duplicate_plugin(prefix, location, modules_of(prefix))?;
        }
        for (prefix, location) in json
            .get(b"$jsPlugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            self.reject_duplicate_plugin(prefix, location, modules_of(prefix))?;
            // `twin` distinguishes the plugins that different objects register under the same name.
            let is_same_plugin = |it: &(Box<[u8]>, Json)| {
                *it.0 == prefix[..] && it.1.get(b"twin") == location.get(b"twin")
            };
            let known = self.js_locations.iter().position(is_same_plugin);
            object
                .js_plugins
                .push(known.unwrap_or(self.js_locations.len()) as u32);
            if known.is_none() {
                self.js_locations
                    .push((prefix[..].into(), location.clone()));
            }
        }
        if let Some(rules) = json.get(b"rules") {
            object.rules = self.rules(rules)?;
        }
        if json.get(b"$severityByKind").is_some() {
            self.set_severity_by_kind(&mut object.rules);
        }
        if json.get(b"$defaultOptions").is_some() {
            for setting in &mut object.rules {
                setting.defaults.clone_from(&setting.options);
            }
        }
        if json.get(b"$withoutWarnings").is_some() {
            object.rules = self.without_warnings();
        }
        let part = |key: &[u8]| json.get(key).cloned().unwrap_or(Json::Null);
        object.language_options = part(b"languageOptions");
        object.linter_options = part(b"linterOptions");
        object.settings = ConfigObject::settings_of(part(b"settings"));
        object.language = json.get(b"language").and_then(Json::as_str).map(Box::from);
        object.processor = json.get(b"processor").and_then(Json::as_str).map(Box::from);
        object.source = json.get(b"$source").cloned();
        object.parser_location = json.get(b"$parser").cloned();
        object.changes_linter = json.get(b"$changesLinter").is_some();
        let framework = json.get(b"$framework").and_then(Json::as_str);
        let mut packages = Frameworks::PACKAGES.iter();
        object.required_framework = (packages.find(|it| Some(it.0.as_bytes()) == framework))
            .map_or(Frameworks::empty(), |it| it.1);
        if json.get(b"$packageType").and_then(Json::as_str) == Some(b"module") {
            object.required_framework |= Frameworks::TYPE_MODULE;
        }
        object.processor_location = json
            .get(b"$processor")
            .filter(|it| it.as_object().is_some())
            .map(js_plugin::Processor::new);
        Ok(object)
    }

    /// `processExtends` in `@eslint/config-helpers`: adds an object after the objects it extends. An element of
    /// `extends` is an object, an array of objects, or the name of one of the configs that ESLint and typescript-eslint
    /// publish.
    pub(super) fn object_with_extends(&mut self, json: &Json) -> Result<(), ConfigError> {
        let Some(extends) = json.get(b"extends") else {
            let object = self.object(json)?;
            self.objects.push(object);
            return Ok(());
        };
        let Some(extends) = extends.as_array() else {
            return Err(ConfigError::new(&[
                b"The `extends` property must be an array.",
            ]));
        };
        let own: Vec<(Vec<u8>, Json)> = (json.as_object().unwrap_or_default().iter())
            .filter(|it| it.0 != b"extends")
            .cloned()
            .collect();
        let is_global_ignores = |entries: &[(Vec<u8>, Json)]| {
            entries
                .iter()
                .all(|it| matches!(&it.0[..], b"basePath" | b"ignores" | b"name"))
        };
        let own_json = Json::Object(own.clone());
        let mut extensions: Vec<Json> = Vec::new();
        for element in extends {
            match element {
                Json::String(name) => match presets::find(name) {
                    Some(preset) => extensions.extend(preset),
                    None => {
                        return Err(ConfigError::new(&[
                            b"Plugin config \"",
                            name,
                            b"\" not found.",
                        ]));
                    }
                },
                Json::Array(items) => extensions.extend(items.iter().cloned()),
                element => extensions.push(element.clone()),
            }
        }
        for extension in extensions {
            let Some(mut entries) = extension.into_object() else {
                return Err(ConfigError::new(&[b"Unexpected non-object config."]));
            };
            if entries.iter().any(|it| it.0 == b"basePath") {
                return Err(ConfigError::new(&[
                    b"'basePath' in `extends` is not allowed.",
                ]));
            }
            if entries.iter().any(|it| it.0 == b"extends") {
                return Err(ConfigError::new(&[b"Nested 'extends' is not allowed."]));
            }
            let find = |entries: &[(Vec<u8>, Json)], key: &[u8]| {
                entries.iter().find(|it| it.0 == key).map(|it| it.1.clone())
            };
            let put = |entries: &mut Vec<(Vec<u8>, Json)>, key: &[u8], value: Json| match entries
                .iter_mut()
                .find(|it| it.0 == key)
            {
                Some(entry) => entry.1 = value,
                None => entries.push((key.to_vec(), value)),
            };
            if !is_global_ignores(&entries) {
                if let Some(Json::Array(base_files)) = own_json.get(b"files") {
                    let extension_files = find(&entries, b"files");
                    let extension_files = extension_files
                        .as_ref()
                        .and_then(Json::as_array)
                        .unwrap_or_default();
                    put(
                        &mut entries,
                        b"files",
                        Json::Array(extend_files(base_files, extension_files)),
                    );
                }
                if let Some(Json::Array(base_ignores)) = own_json.get(b"ignores") {
                    let mut all = base_ignores.clone();
                    all.extend(
                        find(&entries, b"ignores")
                            .as_ref()
                            .and_then(Json::as_array)
                            .unwrap_or_default()
                            .iter()
                            .cloned(),
                    );
                    put(&mut entries, b"ignores", Json::Array(all));
                }
                if let Some(by_kind) = own_json.get(b"$severityByKind") {
                    put(&mut entries, b"$severityByKind", by_kind.clone());
                }
            }
            if let Some(base_path) = own_json.get(b"basePath") {
                put(&mut entries, b"basePath", base_path.clone());
            }
            let object = self.object(&Json::Object(entries))?;
            self.objects.push(object);
        }
        if !is_global_ignores(&own) {
            let object = self.object(&own_json)?;
            self.objects.push(object);
        }
        Ok(())
    }
}

/// `extendConfigFiles`: every combination of a pattern from one list and a pattern from the other.
fn extend_files(base: &[Json], extension: &[Json]) -> Vec<Json> {
    if extension.is_empty() {
        return base.to_vec();
    }
    if base.is_empty() {
        return extension.to_vec();
    }
    let all = |item: &Json| match item {
        Json::Array(items) => items.clone(),
        item => vec![item.clone()],
    };
    let mut out = Vec::with_capacity(base.len() * extension.len());
    for a in base {
        for b in extension {
            out.push(Json::Array([all(a), all(b)].concat()));
        }
    }
    out
}

/// ESLint's `defaultConfig`.
const DEFAULT_CONFIG: &[u8] = br#"[
    { "language": "@/js", "linterOptions": { "reportUnusedDisableDirectives": 1 } },
    { "ignores": ["**/node_modules/", ".git/"] },
    { "files": ["**/*.js", "**/*.mjs"] },
    { "files": ["**/*.cjs"], "languageOptions": { "sourceType": "commonjs", "ecmaVersion": "latest" } }
]"#;

impl Config {
    /// Builds a config from an evaluated `eslint.config.*`: see the [module](super). `base_path` is the absolute path
    /// of the file's directory. An object can have `extends`, as if the file used `defineConfig()`.
    pub fn from_flat_json(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, None, Vec::new(), false)
    }

    /// Like [`Config::from_flat_json`], with support for plugins that aren't built in. Next to `plugins`, an object has
    /// the key `$jsPlugins`, which maps each plugin's prefix to where it can be loaded from. A plugin is loaded if one
    /// of its enabled rules isn't built in. A built-in rule runs in place of the plugin's.
    pub fn from_flat_json_with_plugins(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load_plugin: &mut LoadLocatedPlugin<'_>,
        named: Vec<NamedPlugin>,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, Some(load_plugin), named, false)
    }

    /// Builds the config for projects with no ESLint or oxlint config. `json` has the shape of a flat config, but doesn't
    /// have to declare plugins. See [`ResolvedConfig::has_every_rule`](crate::linter::ResolvedConfig).
    pub fn without_config_file(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        named: Vec<NamedPlugin>,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, None, named, true)
    }

    fn from_flat(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load_plugin: Option<&mut LoadLocatedPlugin<'_>>,
        named: Vec<NamedPlugin>,
        has_every_rule: bool,
    ) -> Result<Config, ConfigError> {
        let mut reader = Reader {
            registry,
            base_path: paths::absolute(base_path),
            prefers_typescript_rules: false,
            has_every_rule,
            objects: Vec::new(),
            notes: Vec::new(),
            advice: Vec::new(),
            unknown_rules: Vec::new(),
            js_plugins: Vec::new(),
            js_plugin_location_indices: Vec::new(),
            js_locations: Vec::new(),
            defaults: 0,
            foreign_prefixes: Vec::new(),
            named: 0,
            has_unknown_resolver: has_unknown_resolver(json),
            plugins_handing_back: Vec::new(),
        };
        reader.add_named(named);
        add_foreign_prefixes(registry, json, &mut reader.foreign_prefixes);
        let defaults = crate::json::parse(DEFAULT_CONFIG).unwrap_or(Json::Null);
        for object in defaults.as_array().unwrap_or_default() {
            reader.object_with_extends(object)?;
        }
        reader.defaults = reader.objects.len();
        fn read(reader: &mut Reader, json: &Json) -> Result<(), ConfigError> {
            match json {
                Json::Array(items) if bun_core::StackCheck::init().is_safe_to_recurse() => {
                    items.iter().try_for_each(|item| read(reader, item))
                }
                json => reader.object_with_extends(json),
            }
        }
        read(&mut reader, json)?;
        if let Some(load) = load_plugin {
            reader.load_js_plugins(load)?;
        }
        Ok(reader.finish(Semantics {
            keeps_options: true,
            accepts_all_plugins: false,
            is_legacy: false,
        }))
    }
}

impl Reader<'_> {
    /// ESLint's `Cannot redefine plugin`, for a plugin that the config registers as `prefix` and a [`NamedPlugin`] with
    /// that name. `location` is where the config's plugin is, or `null` if no module exports it. The config may have
    /// imported the same package, and then ESLint also treats them as one plugin. `modules` lists all the modules that
    /// are the config's plugin, if there are more than the one in `location`: one module can re-export another's
    /// exports, and a package can have one build for `import` and one for `require`.
    pub(super) fn reject_duplicate_plugin(
        &self,
        prefix: &[u8],
        location: &Json,
        modules: Option<&Json>,
    ) -> Result<(), ConfigError> {
        // `[]` and `["default"]` are the same for a module without a `default`.
        let is_whole = |it: &Json| {
            let path = it.get(b"export").and_then(Json::as_array);
            path.is_some_and(|it| {
                it.len() <= 1 && it.iter().all(|it| it.as_str() == Some(b"default"))
            })
        };
        let modules = modules.and_then(Json::as_array).unwrap_or_default();
        let is_same = |it: &Json| {
            let Some(module) = it.get(b"module").filter(|_| is_whole(it)) else {
                return false;
            };
            modules.contains(module)
                || (location.get(b"module") == Some(module) && is_whole(location))
        };
        let mut named = self.js_locations.iter().take(self.named);
        match named.any(|it| *it.0 == *prefix && !is_same(&it.1)) {
            true => Err(ConfigError::new(&[
                b"The plugin \"",
                prefix,
                b"\" is loaded twice: here, and by plugins in bunfig.toml or --plugin",
            ])),
            false => Ok(()),
        }
    }

    /// Call this before anything is read.
    pub(super) fn add_named(&mut self, named: Vec<NamedPlugin>) {
        self.named = named.len();
        for (plugin, location) in named {
            self.js_plugin_location_indices
                .push(self.js_locations.len() as u32);
            self.js_locations.push((plugin.name.clone(), location));
            // It was requested by name, so nothing built in replaces it: `@stylistic` isn't left to `bun fmt`.
            self.foreign_prefixes.push(plugin.name.clone());
            self.js_plugins.push(plugin);
        }
    }

    /// Loads the plugins that have an enabled rule that isn't built in. Also registers the plugins that the config has
    /// described, without loading anything: a comment can mention one of their rules, and Bun has to know whether that
    /// rule exists.
    pub(super) fn load_js_plugins(
        &mut self,
        load: &mut LoadLocatedPlugin<'_>,
    ) -> Result<(), ConfigError> {
        for (location_index, (prefix, location)) in self.js_locations.iter_mut().enumerate() {
            // A `NamedPlugin`.
            if self
                .js_plugin_location_indices
                .contains(&(location_index as u32))
            {
                continue;
            }
            let mut unknown = self.unknown_rules.iter();
            // A `--rulesdir` rule has no prefix, so it can have the same name as a built-in rule.
            if prefix.is_empty()
                || unknown.any(|id| parse_rule_id(id).0 == &prefix[..])
                || self.plugins_handing_back.contains(prefix)
                || location.get(b"described").is_some()
            {
                self.js_plugins.push(load(location, prefix).map_err(|why| {
                    ConfigError::new(&[b"Failed to load the plugin \"", prefix, b"\": ", &why])
                })?);
                self.js_plugin_location_indices.push(location_index as u32);
            }
            // From here on only its location is needed.
            if let Json::Object(entries) = location {
                entries.retain(|it| it.0 != b"described");
            }
        }
        let plugins = &self.js_plugins;
        self.unknown_rules
            .retain(|id| find_js_rule(plugins, id).is_none());
        Ok(())
    }

    pub(super) fn finish(self, semantics: Semantics) -> Config {
        Config {
            base_path: self.base_path,
            heads: super::Heads::new(&self.objects),
            objects: self.objects,
            keeps_options: semantics.keeps_options,
            accepts_all_plugins: semantics.accepts_all_plugins,
            is_legacy: semantics.is_legacy,
            eslint_major: if semantics.is_legacy { 8 } else { 10 },
            without_modules: false,
            infers_globals: crate::language::InferGlobals::No,
            lints_all_named_files: false,
            dot_patterns: None,
            prefers_typescript_rules: self.prefers_typescript_rules,
            has_every_rule: self.has_every_rule,
            oxlintrc_options: Vec::new(),
            oxlint_print_config: Vec::new(),
            notes: self.notes,
            advice: self.advice,
            unknown_rules: self.unknown_rules,
            js_plugins: self.js_plugins,
            js_plugin_location_indices: self.js_plugin_location_indices,
            has_twins: (self.js_locations.iter()).any(|it| it.1.get(b"twin").is_some()),
            js_locations: self.js_locations,
            cache: Default::default(),
        }
    }
}
