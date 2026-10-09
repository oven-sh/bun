//! Reads `.oxlintrc.json` and `.eslintrc.json`, and turns them into the objects of a flat
//! configuration.

#[path = "oxlint_categories.rs"]
mod categories;

use super::flat::{ConfigError, Reader, Semantics};
use super::merge::RuleSetting;
use super::{Config, ConfigObject, Pattern, path, presets};
use crate::context::Severity;
use crate::js_plugin;
use crate::linter::registry::{Registry, oxlint_rule_key, parse_rule_id, plugin_of_oxlint};
use crate::linter::resolved::find_js_rule;
use crate::linter::space::trim_end;
use crate::options::Json;
use crate::rule::{Meta, Plugin};
use bun_core::strings;
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
/// for `ignores`.
fn ignore_pattern_to_minimatch(pattern: &[u8]) -> Vec<u8> {
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
fn override_pattern(pattern: &[u8]) -> Pattern {
    match pattern.strip_prefix(b"./") {
        Some(rest) => Pattern::new(rest),
        None if strings::contains_char(pattern, b'/') => Pattern::new(pattern),
        None => Pattern::new(&[b"**/", pattern].concat()),
    }
}

fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
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
        // A plugin that an override names is known everywhere.
        self.load_js_plugins(json, directory)?;
        for item in json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            self.load_js_plugins(item, directory)?;
        }
        for name in strings_of(json.get(b"extends")) {
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
        match self.plugin_names(json)? {
            Some(plugins) => self.plugins.extend(plugins),
            None => {
                (self.plugins).extend([&b"typescript"[..], b"unicorn", b"oxc"].map(<[u8]>::to_vec))
            }
        }
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
                        .map(|it| Pattern::new(&ignore_pattern_to_minimatch(it)))
                        .collect(),
                ),
                is_global_ignores: true,
                ignores_inside_only: self.flavor == RcFlavor::Oxlint,
                ..ConfigObject::default()
            });
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
            if files.is_empty() {
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
                files: Some(files.iter().map(|it| vec![override_pattern(it)]).collect()),
                ignores: (!excluded.is_empty())
                    .then(|| excluded.iter().map(|it| override_pattern(it)).collect()),
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
                .map(|it| ignore_pattern_to_minimatch(it))
                .collect(),
            RcFlavor::Oxlint => [
                &b"**/node_modules/"[..],
                b"**/.git/",
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
        rc.reader.objects.append(&mut rc.overrides);
        if flavor == RcFlavor::Oxlint {
            // What is said about a rule of a plugin that oxlint does not have on has no effect.
            let mut objects = std::mem::take(&mut rc.reader.objects);
            for object in &mut objects {
                (object.rules).retain(|it| it.written_for.is_none_or(|it| rc.has_plugin(it)));
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
        Ok(rc.reader.finish(Semantics {
            keeps_options: flavor == RcFlavor::Eslint,
            accepts_all_plugins: true,
        }))
    }
}
