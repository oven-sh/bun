//! Reads ESLint's flat configuration from JSON.

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
use crate::rule::{Kind, Plugin, minor_of};
use crate::runner::RuleEntry;
use std::sync::Arc;

/// A JavaScript plugin that is loaded already, and what `$jsPlugins` would have for it: `{ module, export }`. These come from
/// `plugins` in bunfig.toml and from `--plugin`.
pub type NamedPlugin = (Arc<js_plugin::Plugin>, Json);

/// Why a configuration cannot be used. The text is ESLint's where ESLint has one.
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

/// Loads a JavaScript plugin: [`Host::load_located`](crate::js_plugin::Host). It is given what `$jsPlugins` has for the plugin, and
/// the prefix of its rules.
pub type LoadLocatedPlugin<'l> =
    dyn FnMut(&Json, &[u8]) -> Result<Arc<js_plugin::Plugin>, Vec<u8>> + 'l;

/// What depends on the kind of the configuration file: the fields of these names of [`Config`].
#[derive(Copy, Clone)]
pub(super) struct Semantics {
    pub(super) keeps_options: bool,
    pub(super) accepts_all_plugins: bool,
    pub(super) is_legacy: bool,
}

/// What is collected while the objects are read.
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
    /// The JavaScript plugins that are loaded.
    pub(super) js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// For each, where it is in `js_locations`.
    pub(super) js_plugin_places: Vec<u32>,
    /// `$jsPlugins`: where the plugin with a prefix can be loaded from.
    pub(super) js_locations: Vec<(Box<[u8]>, Json)>,
    /// How many of the objects are ESLint's own.
    pub(super) defaults: usize,
    /// The names of the plugins of the configuration that are not [built in](is_built_in).
    pub(super) foreign_prefixes: Vec<Box<[u8]>>,
    /// How many of `js_plugins` and of `js_locations`, from the first, are [`NamedPlugin`]s.
    pub(super) named: usize,
    /// [`names_unknown_resolver`] somewhere.
    pub(super) has_unknown_resolver: bool,
    /// The names of the plugins of which a rule is on that is answered for here and can hand a file back.
    pub(super) handing_back: Vec<Box<[u8]>>,
}

/// Whether the plugin that a configuration has as `prefix` is the one that is implemented here: it has the name that is usual
/// for it. `name`: what the plugin says it is called, with its version, if it says so. Under another name, as `ts` or `node` in
/// `@antfu/eslint-config`, or if another plugin has the name, as `import-x` has `import` there, it runs as what it is:
/// JavaScript. So its rules are called what the configuration calls them, in reports and in comments. The same if the rules
/// here [do not answer for it](Registry::answers_for) and `can_be_loaded`: the configuration says where its own are.
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
    // ESLint has its own rules in a plugin that is called `@`.
    let answers = registry.answers_for(prefix) || !can_be_loaded;
    prefix == b"@" || answers && Plugin::answers_in_place_of(prefix, package)
}

/// What a plugin is called: what it says, with its version; else the package that it was exported from, if it was found in a module.
/// `name`, `located`: what `plugins` and `$jsPlugins` of the object have for it. eslint-plugin-import, eslint-plugin-react and
/// eslint-plugin-import-lite, which `@antfu/eslint-config` has as `import`, all say nothing.
fn called<'j>(name: &'j Json, located: Option<&'j Json>) -> Option<&'j [u8]> {
    let module = || located?.get(b"module")?.as_str();
    name.as_str().or_else(|| module().map(package_of))
}

/// Adds the names of the plugins in `json`, which is what a configuration file exports or a part of it, that are not
/// [built in](is_built_in). An object can have the rules of a plugin that an object after it has.
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
        if !is_built_in(registry, prefix, called(name, located), located.is_some())
            && !into.iter().any(|it| **it == prefix[..])
        {
            into.push(prefix[..].into());
        }
    }
    if let Some(extends) = json.get(b"extends") {
        add_foreign_prefixes(registry, extends, into);
    }
}

/// Whether `settings` has an `import/resolver`, or a parser in `import/parsers`, that the rules here do not do the same as, or a
/// regular expression that is not written as a string, which they do not read. The package answers then.
pub(super) fn names_unknown_resolver(settings: &Json) -> bool {
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
    // `new Set(..)` throws at it.
    let core_modules = settings.get(b"import/core-modules");
    if matches!(
        core_modules,
        Some(Json::Bool(_) | Json::Number(_) | Json::Object(_))
    ) {
        return true;
    }
    // `resolverReducer`: it goes into arrays, and throws at what is no string and no object.
    let written = settings.get(b"import/resolver");
    let mut pending: Vec<&Json> = written.filter(|it| it.is_truthy()).into_iter().collect();
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

/// The same for what a configuration file exports, or a part of it.
fn has_unknown_resolver(json: &Json) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    if let Json::Array(items) = json {
        return items.iter().any(has_unknown_resolver);
    }
    json.get(b"settings").is_some_and(names_unknown_resolver)
        || (json.get(b"extends")).is_some_and(has_unknown_resolver)
}

const META_KEYS: [&[u8]; 2] = [b"name", b"basePath"];

/// `Kind::Problem` rules that [warn by default](Reader::grade_by_kind) anyway. An error fails CI, so it has to be right nearly
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

/// `Config "name": ` or `Config (unnamed): `, which the message of a `ConfigError` starts with.
fn config_name(json: &Json) -> Vec<u8> {
    match json.get(b"name").and_then(Json::as_str) {
        Some(name) if !name.is_empty() => [b"Config \"", name, b"\": "].concat(),
        _ => b"Config (unnamed): ".to_vec(),
    }
}

/// What `structuredClone` throws at the options of a rule: `serializeOption` in evaluate-describe.js.
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

/// `ObjectSchema.validate` with `flatConfigSchema`: what is wrong with a configuration object. ESLint
/// finds out when the object is merged, so only if it matches a file.
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
            // Not of ESLint: see `Config::from_flat_json_with_plugins`.
            b"$changesLinter" | b"$defaultOptions" | b"$forReact" | b"$globsOfBun" | b"$ignorePatterns"
            | b"$jsPlugins" | b"$otherPlugins" | b"$parser" | b"$pluginModules" | b"$processor" | b"$severityByKind" | b"$source"
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

    /// Warns that an oxlint config turns off `id`, which isn't a rule. oxlint rejects such a config. The rules here are those of
    /// one version of oxlint, so a config for a later one can name a rule that isn't known here.
    fn note_unknown_rule_that_is_off(&mut self, id: &[u8]) {
        let hint = match self.registry.why_missing(id) {
            Missing::OfPluginWithoutRules(_) => return,
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

    /// Says so if the rules here, which answer for the plugin with the prefix `prefix`, are those of a later version than the one
    /// that is installed. `name`: what the plugin says it is: `<package>@<version>`.
    pub(super) fn advise_about_version(&mut self, prefix: &[u8], name: &[u8]) {
        let Some(at) = bun_core::strings::last_index_of_char(name, b'@').filter(|at| *at > 0)
        else {
            return;
        };
        let (package, installed) = (&name[..at], &name[at + 1..]);
        let Some(ours) = Plugin::of_prefix(prefix).and_then(Plugin::follows) else {
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

    /// The patterns in `items`, which are validated already. `json`: the object that has them.
    fn patterns(
        &self,
        json: &Json,
        key: &str,
        items: &[Json],
    ) -> Result<Vec<Pattern>, ConfigError> {
        // Overrides from bunfig.toml are marked with `$globsOfBun`.
        let are_of_bun = json.get(b"$globsOfBun").is_some();
        let patterns = items.iter().map(|item| match item {
            Json::String(pattern) if are_of_bun => Ok(Pattern::of_bunfig(pattern)),
            Json::String(pattern) => Ok(Pattern::new(pattern)),
            // Which files it is for cannot be told. To lint fewer files than ESLint and find no problems is worse than not to lint.
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

    /// The rule here that answers for `id`. Without one, the plugin is loaded that the configuration has for it.
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

    /// The rules of an object.
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
                // Also for a rule that is off, as in oxlint. ESLint does not look at such a rule.
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
                // oxlint checks the options of every entry before it lints, also of one that is off or in an override that
                // matches no file. ESLint checks them for the files that the rule is on for.
                if self.prefers_typescript_rules
                    && let Err(lines) = crate::linter::schema::validate_js(rule, &setting.options)
                {
                    let message = super::js_options_error_of_oxlint(rule, &setting.options, &lines);
                    return Err(ConfigError { message });
                }
                // A worker reads JSON.
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
            setting.written_for = match self.prefers_typescript_rules {
                _ if is_foreign => None,
                _ if self.has_every_rule => self.native_rule(id).map(|it| it.meta.plugin),
                true => Plugin::of_oxlint_prefix(prefix),
                false => Plugin::of_prefix(prefix),
            };
            if !matches!(prefix, b"eslint" | b"typescript" | b"typescript-eslint") {
                setting.plugin = parse_rule_id(id).0.into();
            }
            match self.native_rule(id) {
                Some(entry) => {
                    let is_new = !self.handing_back.iter().any(|it| **it == *prefix);
                    if entry.meta.hands_back && setting.severity != Severity::Off && is_new {
                        self.handing_back.push(prefix.into());
                    }
                    setting.id = crate::linter::RuleId::Known(entry.meta).to_vec().into()
                }
                // One more instance of a rule of ESLint, which is of no plugin.
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
                        self.note_unknown_rule_that_is_off(id);
                    }
                }
            }
            settings.push(setting);
        }
        Ok(settings)
    }

    /// `$severityByKind`, which `bun lint`'s default config sets. Enabled `Kind::Problem` rules become errors, except those in
    /// [`WARN_BY_DEFAULT`]. Every other enabled rule becomes a warning.
    fn grade_by_kind(&self, settings: &mut [RuleSetting]) {
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

    /// `assertValidBaseConfig`, with what `wrapConfigErrorWithDetails` adds.
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

    /// One object of a flat configuration, without its `extends`.
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
            match is_built_in(self.registry, prefix, called(name, located), can_be_loaded) {
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
            self.refuse_second(prefix, location, modules_of(prefix))?;
        }
        for (prefix, location) in json
            .get(b"$jsPlugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            self.refuse_second(prefix, location, modules_of(prefix))?;
            // `twin`: which of the plugins that objects have under that name.
            let is_it = |it: &(Box<[u8]>, Json)| {
                *it.0 == prefix[..] && it.1.get(b"twin") == location.get(b"twin")
            };
            let known = self.js_locations.iter().position(is_it);
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
            self.grade_by_kind(&mut object.rules);
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
        object.is_for_react = json.get(b"$forReact").is_some();
        object.processor_location = json
            .get(b"$processor")
            .filter(|it| it.as_object().is_some())
            .map(js_plugin::Processor::new);
        Ok(object)
    }

    /// `processExtends` of `@eslint/config-helpers`: an object, after the objects that it extends.
    /// An element of `extends` is an object, an array of objects, or the name of one of the
    /// configurations that ESLint and typescript-eslint publish.
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

/// `extendConfigFiles`: every combination of a pattern of the one and a pattern of the other.
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
    /// From an `eslint.config.*` that has been evaluated: see the [module](super). `base_path`: the
    /// directory that the file is in, absolute. An object can have `extends`, as if the file used
    /// `defineConfig()`.
    pub fn from_flat_json(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, None, Vec::new(), false)
    }

    /// The same, with the plugins that are not implemented here. An object has beside `plugins` the key `$jsPlugins`, with
    /// where each of its plugins can be loaded from, by its prefix. One is loaded if a rule of it is enabled that does not exist
    /// here. A rule that does exist here runs in place of the one of the plugin.
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
    pub fn without_a_file(
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
            js_plugin_places: Vec::new(),
            js_locations: Vec::new(),
            defaults: 0,
            foreign_prefixes: Vec::new(),
            named: 0,
            has_unknown_resolver: has_unknown_resolver(json),
            handing_back: Vec::new(),
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
    /// ESLint's `Cannot redefine plugin`, for a plugin that the configuration has as `prefix` and a [`NamedPlugin`]. `location`:
    /// where the former is, which is `null` for one that no module exports. The configuration can have imported the same
    /// package: then it is one plugin, for ESLint too. `modules`: all the modules that are the former, if there is more than
    /// the one of `location`: one module can have what another exports, and a package can have one build to import and one to
    /// require.
    pub(super) fn refuse_second(
        &self,
        prefix: &[u8],
        location: &Json,
        modules: Option<&Json>,
    ) -> Result<(), ConfigError> {
        // `[]` and `["default"]` are the same for what has no `default`.
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

    /// Before anything is read.
    pub(super) fn add_named(&mut self, named: Vec<NamedPlugin>) {
        self.named = named.len();
        for (plugin, location) in named {
            self.js_plugin_places.push(self.js_locations.len() as u32);
            self.js_locations.push((plugin.name.clone(), location));
            // It is asked for by name, so nothing here stands in for it: `@stylistic` is not left to `bun fmt`.
            self.foreign_prefixes.push(plugin.name.clone());
            self.js_plugins.push(plugin);
        }
    }

    /// Loads the plugins of which a rule is enabled that does not exist here, and takes note of those that the configuration has
    /// described, for which nothing is loaded: a comment can name a rule of them, and whether there is such a rule is to be known.
    pub(super) fn load_js_plugins(
        &mut self,
        load: &mut LoadLocatedPlugin<'_>,
    ) -> Result<(), ConfigError> {
        for (place, (prefix, location)) in self.js_locations.iter_mut().enumerate() {
            // A `NamedPlugin`.
            if self.js_plugin_places.contains(&(place as u32)) {
                continue;
            }
            let mut unknown = self.unknown_rules.iter();
            // A rule of `--rulesdir`, which has no prefix, can have the name of a rule that exists here.
            if prefix.is_empty()
                || unknown.any(|id| parse_rule_id(id).0 == &prefix[..])
                || self.handing_back.contains(prefix)
                || location.get(b"described").is_some()
            {
                self.js_plugins.push(load(location, prefix).map_err(|why| {
                    ConfigError::new(&[b"Failed to load the plugin \"", prefix, b"\": ", &why])
                })?);
                self.js_plugin_places.push(place as u32);
            }
            // Only where it is is of any more use.
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
            lints_all_that_is_named: false,
            dot_patterns: None,
            prefers_typescript_rules: self.prefers_typescript_rules,
            has_every_rule: self.has_every_rule,
            options_of_oxlint: Vec::new(),
            printed_for_oxlint: Vec::new(),
            notes: self.notes,
            advice: self.advice,
            unknown_rules: self.unknown_rules,
            js_plugins: self.js_plugins,
            js_plugin_places: self.js_plugin_places,
            has_twins: (self.js_locations.iter()).any(|it| it.1.get(b"twin").is_some()),
            js_locations: self.js_locations,
            cache: Default::default(),
        }
    }
}
