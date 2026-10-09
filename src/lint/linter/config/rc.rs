//! Reads `.oxlintrc.json` and `.eslintrc.json`, and turns them into the objects of a flat
//! configuration.

#[path = "oxlint_categories.rs"]
mod categories;

use super::flat::{ConfigError, Reader, Semantics};
use super::merge::RuleSetting;
use super::{Config, ConfigObject, Pattern, path, presets, shape};
use crate::context::Severity;
use crate::fix::SuggestionKind;
use crate::js_plugin;
use crate::linter::registry::{Registry, oxlint_rule_key, parse_rule_id, plugin_of_oxlint};
use crate::linter::resolved::find_js_rule;
use crate::linter::space::trim_end;
use crate::options::Json;
use crate::rule::{Meta, Plugin};
use bun_core::strings;
use rustc_hash::FxHashMap;
use std::sync::Arc;

/// Whose file it is. The two agree on the format and differ in what some of it means.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RcFlavor {
    /// `.oxlintrc.json`:
    /// - The rules of the category `correctness` warn unless `categories` says otherwise.
    /// - A rule setting that is only a severity resets the options of the rule.
    /// - What is extended passes on its rules, categories, plugins and overrides only. All overrides
    ///   come after all rules, and their patterns are relative to the file that extends.
    /// - A rule of ESLint that typescript-eslint extends (`no-unused-vars`) understands TypeScript:
    ///   the extension runs in its place, and is reported under its own name.
    Oxlint,
    /// `.eslintrc.json`
    Eslint,
}

/// The category that oxlint has the rule in: `correctness`, `suspicious`, `pedantic`, `perf`, `style`, `restriction`, `nursery`.
pub fn oxlint_category(plugin: Plugin, name: &str) -> Option<&'static str> {
    let has = |lists: &[(&str, &str)]| {
        (lists
            .iter()
            .filter(|it| Plugin::of_oxlint_prefix(it.0.as_bytes()) == Some(plugin.in_oxlint())))
        .any(|it| strings::split(it.1.as_bytes(), b" ").any(|it| it == name.as_bytes()))
    };
    categories::CATEGORIES
        .iter()
        .find(|it| has(it.1))
        .map(|it| it.0)
}

/// Whether oxlint runs the rule on code that is TypeScript, or on code that is not: its `should_run`, as far as that goes by the
/// language.
pub fn oxlint_runs_on(meta: &Meta, is_typescript: bool) -> bool {
    let lists = match is_typescript {
        true => categories::NOT_TYPESCRIPT,
        false => categories::TYPESCRIPT_ONLY,
    };
    // oxlint has most of the rules that typescript-eslint extends under the names of ESLint.
    let is_of = |plugin: Plugin| {
        plugin == meta.plugin.in_oxlint()
            || (plugin == Plugin::Eslint && meta.extends_base_rule == Some(meta.name))
    };
    !(lists.iter())
        .filter(|it| Plugin::of_oxlint_prefix(it.0.as_bytes()).is_some_and(is_of))
        .any(|it| strings::split(it.1.as_bytes(), b" ").any(|it| it == meta.name.as_bytes()))
}

/// Fixes of rules for which the lists say nothing, or not enough: the plugin, the rule, the `messageId` of the report or nothing
/// for all of them, and what `--fix` of oxlint 1.87 makes of the fix. Each was tried.
const PROBED_FIXES: [(Plugin, &str, &str, SuggestionKind); 3] = [
    // `a ? true : false`, `a ? a : b`
    (
        Plugin::Eslint,
        "no-unneeded-ternary",
        "",
        SuggestionKind::DangerousFix,
    ),
    // `if (!!a)`. `if (Boolean(a))` is fixed.
    (
        Plugin::Eslint,
        "no-extra-boolean-cast",
        "unexpectedNegation",
        SuggestionKind::Suggestion,
    ),
    // `a as string`, by tsgolint 7.0
    (
        Plugin::TypeScript,
        "non-nullable-type-assertion-style",
        "",
        SuggestionKind::Suggestion,
    ),
];

/// The rules of ESLint whose suggestions oxlint 1.87 makes with `--fix-dangerously` only. Each was tried.
const DANGEROUS_SUGGESTIONS: [&str; 3] = ["eqeqeq", "radix", "require-await"];

/// What becomes of the fix and the suggestions of a rule for ESLint with a configuration of oxlint, so that `--fix`,
/// `--fix-suggestions` and `--fix-dangerously` change what they change with oxlint.
#[derive(Copy, Clone, Default)]
pub(crate) struct OxlintChanges {
    /// The rule of oxlint changes nothing, whatever the flags.
    pub(crate) are_dropped: bool,
    /// The fix is a suggestion of this kind.
    pub(crate) fix: Option<SuggestionKind>,
    /// The suggestions are of this kind.
    pub(crate) suggestions: Option<SuggestionKind>,
}

/// `meta`: what the rule is reported as.
pub(crate) fn oxlint_changes(meta: &Meta, message_id: &str) -> OxlintChanges {
    if meta.follows_oxlint {
        return OxlintChanges::default();
    }
    let is_in = |list: &[(&str, &str)]| {
        (list.iter())
            .filter(|it| Plugin::of_oxlint_prefix(it.0.as_bytes()) == Some(meta.plugin))
            .any(|it| strings::split(it.1.as_bytes(), b" ").any(|it| it == meta.name.as_bytes()))
    };
    let probed = (PROBED_FIXES.iter()).find(|it| {
        it.0 == meta.plugin && it.1 == meta.name && (it.2.is_empty() || it.2 == message_id)
    });
    let only_suggests =
        || is_in(categories::ONLY_SUGGESTIONS).then_some(SuggestionKind::Suggestion);
    let is_dangerous = meta.plugin == Plugin::Eslint && DANGEROUS_SUGGESTIONS.contains(&meta.name);
    OxlintChanges {
        are_dropped: probed.is_none() && is_in(categories::WITHOUT_FIX),
        fix: probed.map(|it| it.3).or_else(only_suggests),
        suggestions: is_dangerous.then_some(SuggestionKind::DangerousFix),
    }
}

/// Whether oxlint has a rule that is called `name`, in whatever plugin.
pub(crate) fn is_rule_of_oxlint(name: &[u8]) -> bool {
    strings::split(categories::RULE_NAMES.as_bytes(), b" ").any(|it| it == name)
}

/// What an element of `plugins` can be for oxlint 1.80, after `eslint-plugin-` or `oxlint-plugin-`. Each was tried.
const PLUGIN_NAMES: [&[u8]; 23] = [
    b"eslint",
    b"react",
    b"react-hooks",
    b"react_hooks",
    b"unicorn",
    b"typescript",
    b"typescript-eslint",
    b"@typescript-eslint",
    b"oxc",
    b"deepscan",
    b"import",
    b"import-x",
    b"jsdoc",
    b"jest",
    b"vitest",
    b"jsx-a11y",
    b"jsx_a11y",
    b"nextjs",
    b"react-perf",
    b"react_perf",
    b"promise",
    b"node",
    b"vue",
];

/// The files that are linted if nothing else says so.
const LINTED_FILES: &[u8] = b"**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}";
/// By oxlint, which lints the scripts in the last three.
const LINTED_FILES_OF_OXLINT: &[u8] = b"**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte,astro}";

/// `convertIgnorePatternToMinimatch` of `@eslint/compat`: a pattern of a `.gitignore` as a pattern
/// for `ignores`. For oxlint `{a,b}` is one of the two.
pub(super) fn ignore_pattern_to_minimatch(pattern: &[u8], flavor: RcFlavor) -> Vec<u8> {
    let (negation, pattern): (&[u8], _) = match pattern.strip_prefix(b"!") {
        Some(rest) => (b"!", rest),
        None => (b"", pattern),
    };
    let pattern = trim_end(pattern);
    if matches!(pattern, b"" | b"**" | b"/**" | b"**/") {
        return [negation, pattern].concat();
    }
    let first_slash = strings::index_of_char_usize(pattern, b'/');
    let everywhere: &[u8] = if first_slash.is_none_or(|at| at == pattern.len() - 1) {
        b"**/"
    } else {
        b""
    };
    let without_slash = if first_slash == Some(0) {
        &pattern[1..]
    } else {
        pattern
    };
    // Braces and parentheses mean nothing in a `.gitignore`.
    let mut escaped = Vec::with_capacity(without_slash.len());
    let mut at = 0;
    while at < without_slash.len() {
        match without_slash[at] {
            b'\\' if at + 1 < without_slash.len() => {
                escaped.extend_from_slice(&without_slash[at..at + 2]);
                at += 2;
                continue;
            }
            b'{' if flavor == RcFlavor::Oxlint => {}
            b'{' | b'(' => escaped.push(b'\\'),
            _ => {}
        }
        escaped.push(without_slash[at]);
        at += 1;
    }
    let inside: &[u8] = if pattern.ends_with(b"/**") {
        b"/*"
    } else {
        b""
    };
    [negation, everywhere, &escaped, inside].concat()
}

/// A pattern of `overrides[].files`: one without a slash matches in every directory.
fn override_pattern(pattern: &[u8], flavor: RcFlavor) -> Pattern {
    if flavor == RcFlavor::Oxlint {
        return Pattern::of_oxlint(pattern);
    }
    match pattern.strip_prefix(b"./") {
        Some(rest) => Pattern::new(rest),
        None if strings::contains_char(pattern, b'/') => Pattern::new(pattern),
        None => Pattern::new(&[b"**/", pattern].concat()),
    }
}

pub(super) fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
    match json {
        Some(Json::String(one)) => vec![&one[..]],
        Some(Json::Array(items)) => items.iter().filter_map(Json::as_str).collect(),
        _ => Vec::new(),
    }
}

/// `"allow"` and `"deny"` are oxlint's names for `"off"` and `"error"`.
fn with_eslint_severities(rules: &Json) -> Json {
    let severity = |value: &Json| match value.as_str() {
        Some(b"allow") => Json::Number(0.0),
        Some(b"deny") => Json::Number(2.0),
        _ => value.clone(),
    };
    let entries = rules
        .as_object()
        .unwrap_or_default()
        .iter()
        .map(|(id, value)| {
            let value = match value {
                Json::Array(items) if !items.is_empty() => {
                    let mut items = items.clone();
                    items[0] = severity(&items[0]);
                    Json::Array(items)
                }
                value => severity(value),
            };
            (id.clone(), value)
        });
    Json::Object(entries.collect())
}

/// Loads a JavaScript plugin: [`Host::load`](crate::js_plugin::Host::load). It is given the directory of the file that names the
/// plugin, the specifier, and the name that the file gives the plugin, if it does.
pub type LoadPlugin<'l> =
    dyn FnMut(&[u8], &[u8], Option<&[u8]>) -> Result<Arc<js_plugin::Plugin>, Vec<u8>> + 'l;

struct Rc<'r, 'l> {
    reader: Reader<'r>,
    flavor: RcFlavor,
    /// Reads the file that `extends` names, relative to the directory given first.
    load: &'l mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
    /// `None`: JavaScript plugins are skipped.
    load_plugin: Option<&'l mut LoadPlugin<'l>>,
    /// `categories`, the later entries overriding the earlier ones.
    categories: Vec<(Vec<u8>, Severity)>,
    /// `plugins` of all files and overrides. A file without it stands for typescript, unicorn and oxc.
    plugins: Vec<Vec<u8>>,
    /// In oxlint the overrides of all files come after the rules of all files.
    overrides: Vec<ConfigObject>,
    /// [`Config::option_of_oxlint`]
    options: Vec<(Vec<u8>, Json)>,
    /// `plugins` of all files, without those of overrides.
    plugins_of_files: Vec<Vec<u8>>,
}

/// The plugins of oxlint, in the order in which it prints them.
const PRINTED_PLUGINS: [&[u8]; 14] = [
    b"react",
    b"unicorn",
    b"typescript",
    b"oxc",
    b"import",
    b"jsdoc",
    b"jest",
    b"vitest",
    b"jsx-a11y",
    b"nextjs",
    b"react-perf",
    b"promise",
    b"node",
    b"vue",
];

/// The categories of oxlint, in the order in which it prints them.
const PRINTED_CATEGORIES: [&[u8]; 7] = [
    b"correctness",
    b"suspicious",
    b"pedantic",
    b"perf",
    b"style",
    b"restriction",
    b"nursery",
];

/// `settings` as oxlint prints them without a file.
const PRINTED_SETTINGS: &[u8] = br#"{
  "jsx-a11y": { "polymorphicPropName": null, "components": {}, "attributes": {} },
  "next": { "rootDir": [] },
  "react": { "formComponents": [], "linkComponents": [], "version": null, "componentWrapperFunctions": [] },
  "jsdoc": {
    "ignorePrivate": false,
    "ignoreInternal": false,
    "ignoreReplacesDocs": true,
    "overrideReplacesDocs": true,
    "augmentsExtendsReplacesDocs": false,
    "implementsReplacesDocs": false,
    "exemptDestructuredRootsFromChecks": false,
    "tagNamePreference": {}
  },
  "vitest": { "typecheck": false },
  "jest": { "version": null }
}"#;

/// `"deny"`, or `["deny", [..]]`.
fn printed_setting(severity: Severity, options: &[Json]) -> Json {
    let severity: &[u8] = match severity {
        Severity::Off => b"allow",
        Severity::Warn => b"warn",
        Severity::Error => b"deny",
    };
    let severity = Json::String(severity.to_vec());
    match options {
        [] => severity,
        options => Json::Array(vec![severity, Json::Array(options.to_vec())]),
    }
}

/// `rules` of `json` as oxlint prints them in an override: as they are written.
fn printed_rules(json: &Json) -> Json {
    let rules = json.get(b"rules").and_then(Json::as_object);
    let printed = rules.unwrap_or_default().iter().filter_map(|(id, value)| {
        let setting = RuleSetting::new(id, value)?;
        Some((
            id.clone(),
            printed_setting(setting.severity, &setting.options),
        ))
    });
    Json::Object(printed.collect())
}

/// `globals` of `json`, with the one name that oxlint has for each value.
fn printed_globals(json: &Json) -> Option<Json> {
    let globals = json.get(b"globals")?.as_object()?.iter();
    let printed = globals.map(|(name, value)| {
        let value: &[u8] = match value {
            Json::Bool(true) => b"writable",
            Json::String(it) if matches!(&it[..], b"writable" | b"writeable") => b"writable",
            Json::String(it) if &it[..] == b"off" => b"off",
            _ => b"readonly",
        };
        (name.clone(), Json::String(value.to_vec()))
    });
    Some(Json::Object(printed.collect()))
}

/// The patterns at `key` of an override, as `GlobSet` has them.
fn printed_patterns(json: &Json, key: &[u8]) -> Option<Json> {
    let patterns = strings_of(Some(json.get(key)?)).into_iter();
    let printed = patterns.map(|it| match it.strip_prefix(b"./") {
        Some(rest) => rest.to_vec(),
        None if strings::contains_char(it, b'/') => it.to_vec(),
        None => [b"**/", it].concat(),
    });
    Some(Json::Array(printed.map(Json::String).collect()))
}

impl Rc<'_, '_> {
    /// `languageOptions` for `env`, `globals`, `parser` and `parserOptions`.
    fn language_options(&self, json: &Json) -> Json {
        let mut entries = Vec::new();
        for (from, to) in [
            (&b"env"[..], &b"$env"[..]),
            (b"globals", b"globals"),
            (b"parser", b"parser"),
            (b"parserOptions", b"parserOptions"),
        ] {
            if let Some(value) = json.get(from) {
                entries.push((to.to_vec(), value.clone()));
            }
        }
        // In an `.eslintrc` these two are parser options.
        for key in [&b"ecmaVersion"[..], b"sourceType"] {
            if let Some(value) = json.get(b"parserOptions").and_then(|it| it.get(key)) {
                entries.push((key.to_vec(), value.clone()));
            }
        }
        if entries.is_empty() {
            Json::Null
        } else {
            Json::Object(entries)
        }
    }

    fn rules(&mut self, json: &Json) -> Result<Vec<RuleSetting>, ConfigError> {
        let Some(rules) = json.get(b"rules") else {
            return Ok(Vec::new());
        };
        let mut rules = with_eslint_severities(rules);
        // All names of a rule are one rule, so what the file says last about it counts.
        if self.flavor == RcFlavor::Oxlint
            && let Json::Object(entries) = &mut rules
        {
            for (id, _) in entries {
                if find_js_rule(&self.reader.js_plugins, id).is_none() {
                    *id = oxlint_rule_key(id);
                }
            }
        }
        self.reader.rules(&rules, &[])
    }

    /// Loads what `jsPlugins` of `json` names, which is a file in `directory` or one of its overrides.
    fn load_js_plugins(&mut self, json: &Json, directory: &[u8]) -> Result<(), ConfigError> {
        for plugin in json
            .get(b"jsPlugins")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            let specifier = plugin
                .as_str()
                .or_else(|| plugin.get(b"specifier").and_then(Json::as_str))
                .unwrap_or(b"?");
            let Some(load) = &mut self.load_plugin else {
                self.reader.note(&[
                    b"jsPlugins are not supported: \"",
                    specifier,
                    b"\". Its rules are skipped.",
                ]);
                continue;
            };
            let alias = plugin.get(b"name").and_then(Json::as_str);
            let loaded = load(directory, specifier, alias).map_err(|why| {
                ConfigError::new(&[b"Failed to load JS plugin: ", specifier, b"\n  ", &why])
            })?;
            let name = &loaded.name[..];
            if PLUGIN_NAMES.contains(&name) {
                return Err(ConfigError::new(&[
                    b"Plugin name '",
                    name,
                    b"' is reserved, and cannot be used for JS plugins.\n\nThe '",
                    name,
                    b"' plugin is built in. To use an external '",
                    name,
                    b"' plugin instead, provide a custom alias:\n\n\"jsPlugins\": [{ \"name\": \"",
                    name,
                    b"-js\", \"specifier\": \"eslint-plugin-",
                    name,
                    b"\" }]\n\nThen reference rules using your alias:\n\n\"rules\": {\n  \"",
                    name,
                    b"-js/rule-name\": \"error\"\n}",
                ]));
            }
            let all = &mut self.reader.js_plugins;
            if !all.iter().any(|it| it.name == loaded.name) {
                all.push(loaded);
            }
        }
        Ok(())
    }

    /// Adds the objects for the file `json`, which is in `directory`. `is_extended`: another file
    /// extends it.
    fn file(
        &mut self,
        json: &Json,
        directory: &[u8],
        is_extended: bool,
        depth: usize,
    ) -> Result<(), ConfigError> {
        if json.as_object().is_none() {
            return Err(ConfigError::new(&[b"Unexpected non-object config."]));
        }
        if depth > 32 {
            return Err(ConfigError::new(&[b"Too many levels of \"extends\"."]));
        }
        if is_extended && self.flavor == RcFlavor::Oxlint {
            shape::check(json)?;
        }
        // A plugin that an override names is known everywhere.
        self.load_js_plugins(json, directory)?;
        for item in json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            self.load_js_plugins(item, directory)?;
        }
        let extends = match json.get(b"extends") {
            Some(Json::Array(items)) => &items[..],
            Some(one) => std::slice::from_ref(one),
            None => &[],
        };
        for extended in extends {
            // What an `oxlint.config.ts` has imported.
            if extended.as_object().is_some() {
                self.file(extended, directory, true, depth + 1)?;
                continue;
            }
            let Some(name) = extended.as_str() else {
                continue;
            };
            if self.flavor == RcFlavor::Oxlint && name.starts_with(b"eslint:") {
                return Err(ConfigError::new(&[
                    b"Unsupported named config \"",
                    name,
                    b"\" in extends. Oxlint does not support ESLint shared configs. If this is a file path, add a file extension (e.g., \".json\").",
                ]));
            }
            if let Some(objects) = presets::find(name) {
                for object in &objects {
                    let object = self.reader.object(object)?;
                    self.reader.objects.push(object);
                }
                continue;
            }
            let is_path = matches!(name, [b'.' | b'/', ..] | [_, b':', b'/' | b'\\', ..]);
            if self.flavor == RcFlavor::Eslint && !is_path {
                return Err(ConfigError::new(&[
                    b"It extends \"",
                    name,
                    b"\". A configuration that is a package is not supported yet.",
                ]));
            }
            let Some(extended) = (self.load)(directory, name) else {
                return Err(ConfigError::new(&[
                    b"Failed to load config \"",
                    name,
                    b"\" to extend from.",
                ]));
            };
            let file = path::resolve(directory, name);
            let read = self.file(&extended, path::dirname(&file), true, depth + 1);
            read.map_err(|error| match self.flavor {
                RcFlavor::Oxlint => ConfigError::new(&[
                    b"invalid config file ",
                    directory,
                    b"/",
                    name,
                    b": ",
                    &error.message,
                ]),
                RcFlavor::Eslint => error,
            })?;
        }
        for (category, severity) in json
            .get(b"categories")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            let severity = match severity.as_str() {
                Some(b"allow") => Some(Severity::Off),
                Some(b"deny") => Some(Severity::Error),
                _ => crate::linter::severity_of(severity),
            };
            let Some(severity) = severity else {
                return Err(ConfigError::new(&[
                    b"Key \"categories\": Key \"",
                    category,
                    b"\": Expected severity.",
                ]));
            };
            self.categories.retain(|it| it.0 != *category);
            self.categories.push((category.clone(), severity));
        }
        let plugins = (self.plugin_names(json)?).unwrap_or_else(|| {
            [&b"typescript"[..], b"unicorn", b"oxc"]
                .map(<[u8]>::to_vec)
                .into()
        });
        self.plugins_of_files.extend_from_slice(&plugins);
        self.plugins.extend(plugins);
        // oxlint takes all patterns relative to the file that extends.
        let base_path = (self.flavor == RcFlavor::Eslint
            && directory != &self.reader.base_path[..])
            .then(|| directory.to_vec());
        let passes_everything_on = !is_extended || self.flavor == RcFlavor::Eslint;

        let ignore_patterns = strings_of(json.get(b"ignorePatterns"));
        if !ignore_patterns.is_empty() && passes_everything_on {
            self.reader.objects.push(ConfigObject {
                base_path: base_path.clone(),
                ignores: Some(
                    ignore_patterns
                        .iter()
                        .map(|it| Pattern::new(&ignore_pattern_to_minimatch(it, self.flavor)))
                        .collect(),
                ),
                is_global_ignores: true,
                ignores_inside_only: self.flavor == RcFlavor::Oxlint,
                ..ConfigObject::default()
            });
        }
        for (name, value) in (json.get(b"options").and_then(Json::as_object)).unwrap_or_default() {
            self.options.retain(|it| it.0 != *name);
            self.options.push((name.clone(), value.clone()));
        }
        let mut linter_options = Vec::new();
        for key in [&b"noInlineConfig"[..], b"reportUnusedDisableDirectives"] {
            let value = json
                .get(key)
                .or_else(|| json.get(b"options").and_then(|it| it.get(key)));
            if let Some(value) = value {
                let value = if value.as_str() == Some(b"deny") {
                    Json::Number(2.0)
                } else {
                    value.clone()
                };
                linter_options.push((key.to_vec(), value));
            }
        }
        let mut base = ConfigObject {
            rules: self.rules(json)?,
            ..ConfigObject::default()
        };
        if passes_everything_on {
            base.language_options = self.language_options(json);
            base.settings = json.get(b"settings").cloned().unwrap_or(Json::Null);
            base.linter_options = Json::Object(linter_options);
        }
        self.reader.objects.push(base);

        for item in json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            let files = strings_of(item.get(b"files"));
            if files.is_empty() && self.flavor == RcFlavor::Eslint {
                return Err(ConfigError::new(&[
                    b"Key \"overrides\": Key \"files\": Expected value to be a non-empty array.",
                ]));
            }
            let excluded = strings_of(
                item.get(b"excludeFiles")
                    .or_else(|| item.get(b"excludedFiles")),
            );
            if let Some(plugins) = self.plugin_names(item)? {
                self.plugins.extend(plugins);
            }
            let object = ConfigObject {
                base_path: base_path.clone(),
                files: Some(
                    (files.iter())
                        .map(|it| vec![override_pattern(it, self.flavor)])
                        .collect(),
                ),
                ignores: (!excluded.is_empty()).then(|| {
                    (excluded.iter())
                        .map(|it| override_pattern(it, self.flavor))
                        .collect()
                }),
                language_options: self.language_options(item),
                settings: item.get(b"settings").cloned().unwrap_or(Json::Null),
                rules: self.rules(item)?,
                ..ConfigObject::default()
            };
            match self.flavor {
                RcFlavor::Oxlint => self.overrides.push(object),
                RcFlavor::Eslint => self.reader.objects.push(object),
            }
        }
        Ok(())
    }

    /// `plugins` of `json`. oxlint refuses a name that it does not know. For ESLint it is a package, with rules that are not here.
    fn plugin_names(&self, json: &Json) -> Result<Option<Vec<Vec<u8>>>, ConfigError> {
        let Some(plugins) = json.get(b"plugins").and_then(Json::as_array) else {
            return Ok(None);
        };
        let mut names = Vec::with_capacity(plugins.len());
        for written in plugins.iter().filter_map(Json::as_str) {
            let name = (written.strip_prefix(b"eslint-plugin-"))
                .or_else(|| written.strip_prefix(b"oxlint-plugin-"))
                .unwrap_or(written);
            if self.flavor == RcFlavor::Oxlint && !PLUGIN_NAMES.contains(&name) {
                return Err(ConfigError::new(&[
                    b"Failed to parse config with error Error(\"Unknown plugin: '",
                    written,
                    b"'.\", line: 0, column: 0)",
                ]));
            }
            let scope = name.strip_suffix(b"/eslint-plugin").unwrap_or(name);
            if self.flavor == RcFlavor::Eslint && Plugin::of_prefix(scope).is_none() {
                return Err(ConfigError::new(&[
                    b"It uses the plugin \"",
                    written,
                    b"\". In a configuration of ESLint 8 a plugin that is not built in is not supported yet.",
                ]));
            }
            names.push(name.to_vec());
        }
        Ok(Some(names))
    }

    /// Whether the rules of `plugin` run.
    fn has_plugin(&self, plugin: Plugin) -> bool {
        plugin == Plugin::Eslint
            || (self.plugins.iter()).any(|it| {
                Plugin::of_oxlint_prefix(plugin_of_oxlint(it)) == Some(plugin.in_oxlint())
            })
    }

    /// Adds a setting for each of the rules in `lists` that exist here: the plugins as oxlint calls them, each with the names of
    /// its rules.
    fn add_settings(
        &self,
        lists: &[(&str, &str)],
        severity: Severity,
        settings: &mut Vec<RuleSetting>,
    ) {
        for (plugin, names) in lists {
            let Some(plugin) =
                Plugin::of_oxlint_prefix(plugin.as_bytes()).filter(|it| self.has_plugin(*it))
            else {
                continue;
            };
            for name in strings::split(names.as_bytes(), b" ").filter(|it| !it.is_empty()) {
                let Some(entry) = self.reader.registry.get_preferring(plugin, name, true) else {
                    continue;
                };
                settings.push(RuleSetting {
                    id: crate::linter::RuleId::Known(entry.meta).to_vec().into(),
                    plugin: Box::default(),
                    written_for: Some(plugin),
                    severity,
                    options: Vec::new(),
                    has_only_severity: true,
                });
            }
        }
    }

    /// The rules that `categories` turns on, which everything else overrides.
    fn category_rules(&self) -> Vec<RuleSetting> {
        let mut settings = Vec::new();
        for (category, severity) in &self.categories {
            if let Some((_, lists)) = categories::CATEGORIES
                .iter()
                .find(|it| it.0.as_bytes() == &category[..])
            {
                self.add_settings(lists, *severity, &mut settings);
            }
        }
        settings
    }

    /// The rules that `categories` turns on, of the plugins that are on, which do not exist here and about which the files say
    /// nothing: as [`oxlint_rule_key`] writes them.
    fn lacking_rules(&self) -> Vec<Vec<u8>> {
        let is_named = |key: &[u8]| {
            let objects = self.reader.objects.iter().chain(&self.overrides);
            objects.flat_map(|it| &it.rules).any(|it| *it.id == *key)
        };
        let mut lacking = Vec::new();
        for (category, _) in (self.categories.iter()).filter(|it| it.1 != Severity::Off) {
            let lists = categories::CATEGORIES.iter();
            let lists = lists.filter(|it| it.0.as_bytes() == &category[..]);
            for (plugin, names) in lists.flat_map(|it| it.1) {
                let plugin = plugin.as_bytes();
                let is_on = |it: &Vec<u8>| plugin_of_oxlint(it) == plugin;
                if plugin != b"eslint" && !self.plugins.iter().any(is_on) {
                    continue;
                }
                let exists = |name: &[u8]| {
                    Plugin::of_oxlint_prefix(plugin).is_some_and(|it| {
                        self.reader
                            .registry
                            .get_preferring(it, name, true)
                            .is_some()
                    })
                };
                let names = strings::split(names.as_bytes(), b" ").filter(|it| !it.is_empty());
                let keys = names
                    .filter(|name| !exists(name))
                    .map(|name| oxlint_rule_key(&[plugin, b"/", name].concat()));
                lacking.extend(keys.filter(|key| !is_named(key)));
            }
        }
        lacking
    }

    /// What oxlint's `--print-config` prints for the file `json`: what it says, with the plugins of what it extends, and with the
    /// rules that are on wherever no override is. `categories_at`: which object has the rules of the categories.
    fn printed(&self, json: &Json, categories_at: usize) -> Vec<(Vec<u8>, Json)> {
        let mut rules: Vec<(Vec<u8>, &RuleSetting)> = Vec::new();
        let mut places: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        for (at, object) in self.reader.objects.iter().enumerate() {
            let is_told = |it: &&RuleSetting| {
                (at != categories_at || it.severity != Severity::Off)
                    && it.written_for.is_none_or(|it| self.has_plugin(it))
            };
            let is_native =
                |it: &&RuleSetting| find_js_rule(&self.reader.js_plugins, &it.id).is_none();
            for setting in object.rules.iter().filter(is_told).filter(is_native) {
                let key = oxlint_rule_key(&setting.id);
                match places.get(&key) {
                    Some(&place) => rules[place].1 = setting,
                    None => {
                        places.insert(key.clone(), rules.len());
                        rules.push((key, setting));
                    }
                }
            }
        }
        // Those of ESLint first.
        rules.sort_by(|a, b| parse_rule_id(&a.0).cmp(&parse_rule_id(&b.0)));
        let rules =
            (rules.into_iter()).map(|(key, it)| (key, printed_setting(it.severity, &it.options)));
        let is_on =
            |name: &&&[u8]| (self.plugins_of_files.iter()).any(|it| plugin_of_oxlint(it) == **name);
        let plugins = PRINTED_PLUGINS.iter().filter(is_on);
        let plugins = plugins.map(|it| Json::String(it.to_vec()));
        let written = json.get(b"categories").and_then(Json::as_object);
        let categories = PRINTED_CATEGORIES.iter().filter_map(|name| {
            written?.iter().find(|it| it.0 == **name)?;
            let severity = self.categories.iter().find(|it| it.0 == **name)?.1;
            Some((name.to_vec(), printed_setting(severity, &[])))
        });
        let mut settings = crate::json::parse(PRINTED_SETTINGS).unwrap_or(Json::Null);
        if let Json::Object(known) = &mut settings {
            for (plugin, defaults) in known {
                let own = json.get(b"settings").and_then(|it| it.get(plugin));
                let (Json::Object(defaults), Some(own)) = (defaults, own) else {
                    continue;
                };
                for (key, value) in defaults {
                    if let Some(own) = own.get(key) {
                        *value = own.clone();
                    }
                }
            }
        }
        let overrides = json.get(b"overrides").and_then(Json::as_array);
        let overrides = overrides.unwrap_or_default().iter().map(|item| {
            let or_null = |it: Option<Json>| it.unwrap_or(Json::Null);
            let entries = [
                (&b"files"[..], printed_patterns(item, b"files")),
                (
                    &b"excludeFiles"[..],
                    printed_patterns(item, b"excludeFiles"),
                ),
                (&b"env"[..], Some(or_null(item.get(b"env").cloned()))),
                (&b"globals"[..], Some(or_null(printed_globals(item)))),
                (
                    &b"plugins"[..],
                    Some(or_null(item.get(b"plugins").cloned())),
                ),
                (&b"jsPlugins"[..], item.get(b"jsPlugins").cloned()),
                (&b"rules"[..], Some(printed_rules(item))),
            ];
            let entries = entries.into_iter();
            Json::Object(
                entries
                    .filter_map(|(key, it)| Some((key.to_vec(), it?)))
                    .collect(),
            )
        });
        let overrides: Vec<Json> = overrides.collect();
        let builtin = Json::Object(vec![(b"builtin".to_vec(), Json::Bool(true))]);
        let empty = || Json::Object(Vec::new());
        let has_overrides = !overrides.is_empty();
        let ignored = json.get(b"ignorePatterns").cloned();
        let entries = [
            (&b"$schema"[..], json.get(b"$schema").cloned()),
            (&b"plugins"[..], Some(Json::Array(plugins.collect()))),
            (&b"jsPlugins"[..], json.get(b"jsPlugins").cloned()),
            (&b"categories"[..], Some(Json::Object(categories.collect()))),
            (&b"rules"[..], Some(Json::Object(rules.collect()))),
            (&b"settings"[..], Some(settings)),
            (
                &b"env"[..],
                Some(json.get(b"env").cloned().unwrap_or(builtin)),
            ),
            (
                &b"globals"[..],
                Some(printed_globals(json).unwrap_or_else(empty)),
            ),
            (
                &b"overrides"[..],
                has_overrides.then_some(Json::Array(overrides)),
            ),
            (&b"options"[..], json.get(b"options").cloned()),
            (
                &b"ignorePatterns"[..],
                Some(ignored.unwrap_or_else(|| Json::Array(Vec::new()))),
            ),
            (&b"extends"[..], json.get(b"extends").cloned()),
        ];
        let entries = entries.into_iter();
        entries
            .filter_map(|(key, it)| Some((key.to_vec(), it?)))
            .collect()
    }

    /// `should_run` of the rules of oxlint, as far as it goes by the kind of file: objects that turn rules off, whatever else is
    /// configured.
    fn rules_by_kind_of_file(&self) -> Vec<ConfigObject> {
        let kinds: [(&[u8], &[(&str, &str)]); 3] = [
            (b"**/*.{js,mjs,cjs,jsx}", categories::TYPESCRIPT_ONLY),
            (b"**/*.{ts,mts,cts,tsx}", categories::NOT_TYPESCRIPT),
            (b"**/*.d.{ts,mts,cts}", categories::NOT_DECLARATIONS),
        ];
        let objects = kinds.into_iter().map(|(files, lists)| {
            let mut rules = Vec::new();
            self.add_settings(lists, Severity::Off, &mut rules);
            ConfigObject {
                files: Some(vec![vec![Pattern::new(files)]]),
                rules,
                ..ConfigObject::default()
            }
        });
        objects.collect()
    }
}

impl Config {
    /// From `.oxlintrc.json` or `.eslintrc.json`. `base_path`: the directory that the file is in,
    /// absolute.
    ///
    /// `load(directory, name)` reads a file that `extends` names, relative to `directory`.
    /// It is not asked for the configurations that ESLint and typescript-eslint publish:
    /// `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `typescript-eslint/strict`, ..
    ///
    /// The plugins that `jsPlugins` names are skipped, with a note.
    pub fn from_rc_json(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        flavor: RcFlavor,
        load: &mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
    ) -> Result<Config, ConfigError> {
        Self::from_rc(registry, base_path, json, flavor, load, None)
    }

    /// The same, with the plugins that `jsPlugins` names.
    pub fn from_rc_json_with_plugins(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        flavor: RcFlavor,
        load: &mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
        load_plugin: &mut LoadPlugin<'_>,
    ) -> Result<Config, ConfigError> {
        Self::from_rc(registry, base_path, json, flavor, load, Some(load_plugin))
    }

    fn from_rc<'l>(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        flavor: RcFlavor,
        load: &'l mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
        load_plugin: Option<&'l mut LoadPlugin<'l>>,
    ) -> Result<Config, ConfigError> {
        let base_path = path::resolve(b"/", base_path);
        let mut rc = Rc {
            reader: Reader {
                registry,
                base_path: base_path.clone(),
                prefers_typescript_rules: flavor == RcFlavor::Oxlint,
                objects: Vec::new(),
                notes: Vec::new(),
                unknown_rules: Vec::new(),
                js_plugins: Vec::new(),
                js_locations: Vec::new(),
                defaults: 0,
            },
            flavor,
            load,
            load_plugin,
            categories: match flavor {
                RcFlavor::Oxlint => vec![(b"correctness".to_vec(), Severity::Warn)],
                RcFlavor::Eslint => Vec::new(),
            },
            plugins: Vec::new(),
            overrides: Vec::new(),
            options: Vec::new(),
            plugins_of_files: Vec::new(),
        };
        rc.reader.objects.push(ConfigObject {
            files: Some(vec![vec![Pattern::new(match flavor {
                RcFlavor::Eslint => LINTED_FILES,
                RcFlavor::Oxlint => LINTED_FILES_OF_OXLINT,
            })]]),
            ..ConfigObject::default()
        });
        // What each ignores by itself. For ESLint these are patterns of a `.gitignore`.
        let ignored: Vec<Vec<u8>> = match flavor {
            RcFlavor::Eslint => [&b".*"[..], b"!.eslintrc.*", b"/**/node_modules/*"]
                .iter()
                .map(|it| ignore_pattern_to_minimatch(it, flavor))
                .collect(),
            // Not `node_modules`: a `.gitignore` has that.
            RcFlavor::Oxlint => [
                &b"**/.git/"[..],
                b"**/.jj/",
                b"**/*.min.*",
                b"**/*-min.*",
                b"**/*_min.*",
            ]
            .iter()
            .map(|it| it.to_vec())
            .collect(),
        };
        rc.reader.objects.push(ConfigObject {
            ignores: Some(ignored.iter().map(|it| Pattern::new(it)).collect()),
            is_global_ignores: true,
            ..ConfigObject::default()
        });
        // The place of the rules of the categories, which are known when all files are read.
        let categories_at = rc.reader.objects.len();
        rc.reader.objects.push(ConfigObject::default());
        rc.file(json, &base_path, false, 0)?;
        rc.reader.objects[categories_at].rules = rc.category_rules();
        let lacking = rc.lacking_rules();
        if !lacking.is_empty() {
            rc.reader.note(&[
                lacking.len().to_string().as_bytes(),
                b" rules that the categories turn on do not exist here yet and did not run: ",
                &lacking.join(&b", "[..]),
            ]);
        }
        let printed_for_oxlint = match flavor {
            RcFlavor::Oxlint => rc.printed(json, categories_at),
            RcFlavor::Eslint => Vec::new(),
        };
        rc.reader.objects.append(&mut rc.overrides);
        if flavor == RcFlavor::Oxlint {
            // What is said about a rule of a plugin that oxlint does not have on has no effect.
            let mut objects = std::mem::take(&mut rc.reader.objects);
            for object in &mut objects {
                (object.rules).retain(|it| it.written_for.is_none_or(|it| rc.has_plugin(it)));
            }
            // Only with `import` does oxlint look at other files, which `oxc/no-barrel-file` has to know.
            if !rc.has_plugin(Plugin::Import) {
                objects.push(ConfigObject {
                    settings: Json::Object(vec![(b"$withoutModules".to_vec(), Json::Bool(true))]),
                    ..ConfigObject::default()
                });
            }
            rc.reader.objects = objects;
            let is_off = |id: &[u8]| {
                let plugin = parse_rule_id(id).0;
                PLUGIN_NAMES.contains(&plugin)
                    && !(rc.plugins.iter()).any(|it| plugin_of_oxlint(it) == plugin)
            };
            let mut unknown_rules = std::mem::take(&mut rc.reader.unknown_rules);
            unknown_rules.retain(|id| !is_off(id));
            rc.reader.unknown_rules = unknown_rules;
            let mut by_kind_of_file = rc.rules_by_kind_of_file();
            rc.reader.objects.append(&mut by_kind_of_file);
        }
        let options_of_oxlint = std::mem::take(&mut rc.options);
        Ok(Config {
            options_of_oxlint,
            printed_for_oxlint,
            ..rc.reader.finish(Semantics {
                keeps_options: flavor == RcFlavor::Eslint,
                accepts_all_plugins: true,
                is_legacy: false,
            })
        })
    }

    /// What oxlint refuses in `json`, which is a whole `.oxlintrc.json`, whatever it says.
    pub fn check_shape_for_oxlint(json: &Json) -> Result<(), ConfigError> {
        shape::check(json)
    }
}
