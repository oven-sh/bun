//! The configuration files of ESLint 8 (`.eslintrc.*`, `eslintConfig` in a `package.json`): what `ConfigArrayFactory` of
//! `@eslint/eslintrc` makes of them, as the objects of a flat configuration.
//!
//! A file becomes a list of elements: those of what it extends, its own, those of its overrides. The later overrides the
//! earlier. The files of a directory and of those above it, up to one with `root`, are one list, the outermost first.

use super::flat::{ConfigError, LoadLocatedPlugin, Reader, Semantics};
use super::rc::{RcFlavor, ignore_pattern_to_minimatch, strings_of};
use super::{Config, path, presets};
use crate::linter::registry::Registry;
use crate::options::Json;
use bun_core::strings;

/// A configuration file, or what stands for one: `.eslintignore`, the command line.
pub struct LegacyFile {
    /// Absolute. What it names is looked for from here.
    pub path: Vec<u8>,
    /// What a message calls it.
    pub name: Vec<u8>,
    /// What its patterns are relative to, absolute.
    pub base_path: Vec<u8>,
    pub json: Json,
}

/// What a file names that is not in it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LegacyKind {
    /// In `extends`. The answer: `{ "path", "config" }`.
    Config,
    /// In `plugins`, or in `extends` after `plugin:`. The name is the long one: `eslint-plugin-a`. The answer:
    /// `{ "path", "name", "configs", "environments", "processors", "location" }`, `name` being what `plugins` of a flat
    /// configuration has for it, `processors` their names, and `location` what `$jsPlugins` has.
    Plugin,
    /// `parser`. The answer: `{ "name" }`, which is what `languageOptions.parser` has for it.
    Parser,
}

/// Finds what the file at the path given last names. `Err`: why it cannot be used.
pub type LoadLegacy<'l> = dyn FnMut(LegacyKind, &[u8], &[u8]) -> Result<Json, Vec<u8>> + 'l;

/// What does not depend on the files.
pub struct LegacyOptions<'o> {
    /// A directory that all files are in.
    pub root: &'o [u8],
    /// The working directory.
    pub cwd: &'o [u8],
    /// Not `--no-ignore`: `ignorePatterns` count.
    pub ignore: bool,
    /// `--ext`: what is linted of a directory.
    pub extensions: Option<&'o [Vec<u8>]>,
}

/// For ESLint these are patterns of a `.gitignore`.
const IGNORED: [&[u8]; 3] = [b".*", b"!.eslintrc.*", b"/**/node_modules/*"];

const KEYS: [&[u8]; 14] = [
    b"$schema",
    b"ecmaFeatures",
    b"env",
    b"extends",
    b"globals",
    b"noInlineConfig",
    b"overrides",
    b"parser",
    b"parserOptions",
    b"plugins",
    b"processor",
    b"reportUnusedDisableDirectives",
    b"rules",
    b"settings",
];

/// The options that rules had by default in ESLint 8 and no longer have. A setting that is only a severity keeps them.
const DEFAULTS_OF_ESLINT_8: &[u8] = br#"{ "rules": {
    "no-unused-vars": ["off", { "caughtErrors": "none" }],
    "no-inner-declarations": ["off", "functions", { "blockScopedFunctions": "disallow" }],
    "no-useless-computed-key": ["off", { "enforceForClassMembers": false }]
} }"#;

/// `rules`, with [`DEFAULTS_OF_ESLINT_8`] where a setting has options that say nothing about them.
fn rules_of_eslint_8(rules: &Json) -> Json {
    let with = |options: &[(Vec<u8>, Json)], key: &[u8], value: Json| {
        let mut options = options.to_vec();
        if !options.iter().any(|it| it.0 == key) {
            options.push((key.to_vec(), value));
        }
        Json::Object(options)
    };
    let text = |text: &[u8]| Json::String(text.to_vec());
    let entries = rules.as_object().unwrap_or_default().iter();
    Json::Object(
        entries
            .map(|(id, value)| {
                let items = value.as_array().unwrap_or_default();
                let options: Option<Vec<Json>> = match (&id[..], items) {
                    (b"no-unused-vars", [_, Json::Object(options)]) => {
                        Some(vec![with(options, b"caughtErrors", text(b"none"))])
                    }
                    (b"no-unused-vars", [_, vars @ Json::String(_)]) => Some(vec![with(
                        &[(b"vars".to_vec(), vars.clone())],
                        b"caughtErrors",
                        text(b"none"),
                    )]),
                    (b"no-inner-declarations", [_, mode]) => Some(vec![
                        mode.clone(),
                        with(&[], b"blockScopedFunctions", text(b"disallow")),
                    ]),
                    (b"no-useless-computed-key", [_, Json::Object(options)]) => Some(vec![with(
                        options,
                        b"enforceForClassMembers",
                        Json::Bool(false),
                    )]),
                    _ => None,
                };
                let value = match (options, items.first()) {
                    (Some(options), Some(severity)) => {
                        Json::Array(std::iter::once(severity.clone()).chain(options).collect())
                    }
                    _ => value.clone(),
                };
                (id.clone(), value)
            })
            .collect(),
    )
}

/// `parserOptions.ecmaVersion` of an environment.
fn version_of_environment(name: &[u8]) -> Option<f64> {
    let year: u32 = match name {
        b"es6" => 2015,
        _ => std::str::from_utf8(name.strip_prefix(b"es")?)
            .ok()?
            .parse()
            .ok()?,
    };
    (2015..=2100)
        .contains(&year)
        .then(|| f64::from(year - 2009))
}

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

fn put(json: &mut Json, key: &[u8], value: Json) {
    if !matches!(json, Json::Object(_)) {
        *json = Json::Object(Vec::new());
    }
    if let Json::Object(entries) = json {
        match entries.iter_mut().find(|it| it.0 == key) {
            Some(entry) => entry.1 = value,
            None => entries.push((key.to_vec(), value)),
        }
    }
}

/// `naming.normalizePackageName(name, prefix)`
fn normalize_package_name(name: &[u8], prefix: &[u8]) -> Vec<u8> {
    let name = strings::replace_owned(name, b"\\", b"/");
    let dashed = [prefix, b"-"].concat();
    if let [b'@', scoped @ ..] = &name[..] {
        // `@scope` and `@scope/`, `@scope/prefix`, `@scope/name`
        return match strings::index_of_char_usize(scoped, b'/') {
            None => [&name[..], b"/", prefix].concat(),
            Some(slash) if slash + 1 == scoped.len() => [&name[..], prefix].concat(),
            Some(slash) => {
                let (scope, rest) = (&name[..slash + 2], &scoped[slash + 1..]);
                let first = strings::split(rest, b"/").next().unwrap_or_default();
                match first == prefix || rest.starts_with(&dashed) {
                    true => name.clone(),
                    false => [scope, &dashed, rest].concat(),
                }
            }
        };
    }
    match name.starts_with(&dashed) {
        true => name,
        false => [&dashed[..], &name].concat(),
    }
}

/// `naming.getShorthandName(name, prefix)`
fn shorthand_name(name: &[u8], prefix: &[u8]) -> Vec<u8> {
    let dashed = [prefix, b"-"].concat();
    if let [b'@', scoped @ ..] = name
        && let Some(slash) = strings::index_of_char_usize(scoped, b'/')
    {
        let (scope, rest) = (&name[..slash + 1], &scoped[slash + 1..]);
        if rest == prefix {
            return scope.to_vec();
        }
        if let Some(short) = rest.strip_prefix(&dashed[..]) {
            return [scope, b"/", short].concat();
        }
        return name.to_vec();
    }
    name.strip_prefix(&dashed[..]).unwrap_or(name).to_vec()
}

fn is_absolute(name: &[u8]) -> bool {
    name.starts_with(b"/")
        || matches!(name, [drive, b':', b'/' | b'\\', ..] if drive.is_ascii_alphabetic())
}

/// `isFilePath`
fn is_file_path(name: &[u8]) -> bool {
    matches!(
        name,
        [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..]
    ) || is_absolute(name)
}

/// A pattern of `overrides[].files`: `new Minimatch(pattern, { dot: true, matchBase: !pattern.includes("/") })`.
fn override_pattern(pattern: &[u8]) -> Json {
    Json::String(match strings::contains_char(pattern, b'/') {
        true => pattern.to_vec(),
        false => [b"**/", pattern].concat(),
    })
}

/// `files` and `excludedFiles` of an override.
#[derive(Clone)]
struct Criterion {
    files: Vec<Json>,
    excluded: Vec<Json>,
}

/// Where the normalization is.
#[derive(Clone)]
struct Context<'c> {
    /// The file that is read.
    path: Vec<u8>,
    name: Vec<u8>,
    /// Of the file that is in the cascade, also in what it extends.
    base_path: &'c [u8],
    /// Of the overrides that this is in. All have to match.
    criteria: Vec<Criterion>,
    depth: usize,
}

struct Plugin {
    /// The short name, which the rules have as a prefix.
    id: Vec<u8>,
    loaded: Json,
}

struct Legacy<'r, 'l> {
    reader: Reader<'r>,
    load: &'l mut LoadLegacy<'l>,
    plugins: Vec<Plugin>,
    /// [`LegacyOptions::ignore`]
    ignore: bool,
}

impl Legacy<'_, '_> {
    fn fail<T>(context: &Context, message: &[u8]) -> Result<T, ConfigError> {
        Err(ConfigError::new(&[&context.name, b":\n\t", message]))
    }

    /// `validateConfigSchema`, as far as it is about the names and the kinds of the properties.
    fn validate(json: &Json, context: &Context) -> Result<(), ConfigError> {
        fn check(json: &Json, at: &[u8], problems: &mut Vec<Vec<u8>>) {
            let is_override = !at.is_empty();
            let field = |key: &[u8]| match is_override {
                true => [at, b".", key].concat(),
                false => key.to_vec(),
            };
            let printed = |value: &Json| {
                let mut text = Vec::new();
                crate::linter::write_json(&mut text, value);
                text
            };
            for (key, value) in json.as_object().unwrap_or_default() {
                let only_here: &[&[u8]] = match is_override {
                    true => &[b"files", b"excludedFiles"],
                    false => &[b"root", b"ignorePatterns"],
                };
                if !KEYS.contains(&&key[..]) && !only_here.contains(&&key[..]) {
                    let field = field(key);
                    problems
                        .push([b"Unexpected top-level property \"", &field[..], b"\""].concat());
                    continue;
                }
                let expected: Option<&[u8]> = match &key[..] {
                    b"env" | b"globals" | b"parserOptions" | b"rules" | b"settings"
                    | b"ecmaFeatures"
                        if value.as_object().is_none() =>
                    {
                        Some(b"object")
                    }
                    b"overrides" | b"plugins" if value.as_array().is_none() => Some(b"array"),
                    b"root" | b"noInlineConfig" if value.as_bool().is_none() => Some(b"boolean"),
                    // The command line has a severity.
                    b"reportUnusedDisableDirectives"
                        if value.as_bool().is_none()
                            && crate::linter::severity_of(value).is_none() =>
                    {
                        Some(b"boolean")
                    }
                    b"processor" if value.as_str().is_none() => Some(b"string"),
                    b"parser" if value.as_str().is_none() && *value != Json::Null => {
                        Some(b"string/null")
                    }
                    _ => None,
                };
                if let Some(expected) = expected {
                    problems.push(
                        [
                            b"Property \"",
                            &field(key)[..],
                            b"\" is the wrong type (expected ",
                            expected,
                            b" but got `",
                            &printed(value),
                            b"`)",
                        ]
                        .concat(),
                    );
                }
            }
            if is_override && strings_of(json.get(b"files")).is_empty() {
                problems.push([b"\"", at, b"\" should have required property 'files'"].concat());
            }
            let overrides = json.get(b"overrides").and_then(Json::as_array);
            for (index, item) in overrides.unwrap_or_default().iter().enumerate() {
                let dot: &[u8] = if is_override { b"." } else { b"" };
                let index = index.to_string();
                check(
                    item,
                    &[at, dot, b"overrides[", index.as_bytes(), b"]"].concat(),
                    problems,
                );
            }
        }
        if json.as_object().is_none() {
            return Err(ConfigError::new(&[
                b"ESLint configuration in ",
                &context.name,
                b" is invalid:\n\t- Unexpected non-object config.\n",
            ]));
        }
        let mut problems = Vec::new();
        check(json, b"", &mut problems);
        if problems.is_empty() {
            return Ok(());
        }
        let mut message = [
            b"ESLint configuration in ",
            &context.name[..],
            b" is invalid:\n",
        ]
        .concat();
        for problem in problems {
            message.extend_from_slice(&[b"\t- ", &problem[..], b".\n"].concat());
        }
        Err(ConfigError { message })
    }

    /// `_normalizeConfigData`
    fn config_data(&mut self, json: &Json, context: &Context) -> Result<(), ConfigError> {
        if context.depth > 32 {
            return Self::fail(context, b"Too many levels of \"extends\".");
        }
        Self::validate(json, context)?;
        self.body(json, context)
    }

    /// `_normalizeObjectConfigData` for an element of `overrides`.
    fn override_data(&mut self, json: &Json, context: &Context) -> Result<(), ConfigError> {
        let (files, excluded) = (
            strings_of(json.get(b"files")),
            strings_of(json.get(b"excludedFiles")),
        );
        for pattern in files.iter().chain(&excluded) {
            if is_absolute(pattern) || strings::contains(pattern, b"..") {
                return Err(ConfigError::new(&[
                    b"Invalid override pattern (expected relative path not containing '..'): ",
                    pattern,
                ]));
            }
        }
        let mut context = context.clone();
        context.criteria.push(Criterion {
            files: files.iter().map(|it| override_pattern(it)).collect(),
            excluded: excluded.iter().map(|it| override_pattern(it)).collect(),
        });
        self.body(json, &context)
    }

    /// `_loadPlugin`. `name`: as it is written.
    fn plugin(&mut self, name: &[u8], context: &Context) -> Result<usize, ConfigError> {
        if name.iter().any(u8::is_ascii_whitespace) {
            return Err(ConfigError::new(&[
                b"Whitespace found in plugin name '",
                name,
                b"'",
            ]));
        }
        let request = normalize_package_name(name, b"eslint-plugin");
        let id = shorthand_name(&request, b"eslint-plugin");
        if let Some(at) = self.plugins.iter().position(|it| it.id == id) {
            return Ok(at);
        }
        let loaded = (self.load)(LegacyKind::Plugin, &request, &context.path);
        let loaded = loaded.map_err(|why| ConfigError::new(&[&context.name, b":\n\t", &why]))?;
        self.plugins.push(Plugin { id, loaded });
        Ok(self.plugins.len() - 1)
    }

    /// `_loadExtends`
    fn extends(&mut self, name: &[u8], context: &Context) -> Result<(), ConfigError> {
        let inner = |path: Vec<u8>, what: &[u8]| Context {
            path,
            name: [&context.name[..], " \u{bb} ".as_bytes(), what].concat(),
            depth: context.depth + 1,
            ..context.clone()
        };
        // Those that ESLint and typescript-eslint publish.
        if let Some(objects) = presets::find(name) {
            for preset in &objects {
                self.push(preset.clone(), context)?;
            }
            return Ok(());
        }
        if name.starts_with(b"eslint:") {
            return Self::fail(
                context,
                &[b"Failed to load config \"", name, b"\" to extend from."].concat(),
            );
        }
        if let Some(rest) = name.strip_prefix(b"plugin:") {
            let slash = strings::last_index_of_char(rest, b'/').unwrap_or(0);
            let (plugin_name, config_name) = (&rest[..slash], &rest[(slash + 1).min(rest.len())..]);
            if is_file_path(plugin_name) {
                return Err(ConfigError::new(&[
                    b"'extends' cannot use a file path for plugins.",
                ]));
            }
            let plugin = self.plugin(plugin_name, context)?;
            let loaded = &self.plugins[plugin].loaded;
            let Some(config) = (loaded.get(b"configs")).and_then(|it| it.get(config_name)) else {
                return Self::fail(
                    context,
                    &[b"Failed to load config \"", name, b"\" to extend from."].concat(),
                );
            };
            let config = config.clone();
            let path = loaded.get(b"path").and_then(Json::as_str);
            let path = path.map_or_else(|| context.path.clone(), <[u8]>::to_vec);
            return self.config_data(&config, &inner(path, name));
        }
        let request = if is_file_path(name) {
            name.to_vec()
        } else if name.starts_with(b".") {
            [b"./", name].concat()
        } else {
            normalize_package_name(name, b"eslint-config")
        };
        let loaded = (self.load)(LegacyKind::Config, &request, &context.path);
        let loaded = loaded.map_err(|why| ConfigError::new(&[&context.name, b":\n\t", &why]))?;
        let path = loaded.get(b"path").and_then(Json::as_str);
        let path = path.map_or_else(|| context.path.clone(), <[u8]>::to_vec);
        let config = loaded.get(b"config").cloned().unwrap_or(Json::Null);
        self.config_data(&config, &inner(path, &request))
    }

    /// Adds `flat`, an object of a flat configuration without `files`, for the files that the overrides around are for.
    fn push(&mut self, mut flat: Json, context: &Context) -> Result<(), ConfigError> {
        // An override that says nothing still adds its patterns to what is linted of a directory.
        if flat.as_object().is_none_or(|it| it.is_empty()) && context.criteria.is_empty() {
            return Ok(());
        }
        if !context.criteria.is_empty() {
            // One of each has to match: the alternatives of a flat configuration are lists of patterns that all match.
            let mut alternatives: Vec<Vec<Json>> = vec![Vec::new()];
            for criterion in &context.criteria {
                alternatives = (alternatives.iter())
                    .flat_map(|all| {
                        criterion.files.iter().map(move |pattern| {
                            let mut all = all.clone();
                            all.push(pattern.clone());
                            all
                        })
                    })
                    .take(4096)
                    .collect();
            }
            // What a preset has of its own.
            if let Some(Json::Array(own)) = flat.get(b"files").cloned() {
                alternatives = (alternatives.iter())
                    .flat_map(|all| {
                        own.iter().map(move |pattern| {
                            let mut all = all.clone();
                            match pattern {
                                Json::Array(several) => all.extend(several.iter().cloned()),
                                one => all.push(one.clone()),
                            }
                            all
                        })
                    })
                    .take(4096)
                    .collect();
            }
            let alternatives = alternatives.into_iter().map(Json::Array);
            put(&mut flat, b"files", Json::Array(alternatives.collect()));
            let excluded = context.criteria.iter().flat_map(|it| it.excluded.clone());
            let mut ignores: Vec<Json> = excluded.collect();
            if let Some(Json::Array(own)) = flat.get(b"ignores") {
                ignores.extend(own.iter().cloned());
            }
            if !ignores.is_empty() {
                put(&mut flat, b"ignores", Json::Array(ignores));
            }
            put(
                &mut flat,
                b"basePath",
                Json::String(context.base_path.to_vec()),
            );
        }
        let read = self.reader.object(&flat);
        let read =
            read.map_err(|why| ConfigError::new(&[&context.name, b":\n\t", &why.message]))?;
        self.reader.objects.push(read);
        Ok(())
    }

    /// `env`, with what the environments of plugins stand for: `(globals, parserOptions)`.
    fn environments(&self, env: &Json, context: &Context) -> Result<(Json, Json), ConfigError> {
        let (mut globals, mut parser_options) = (Json::Null, Json::Null);
        for (name, is_enabled) in env.as_object().unwrap_or_default() {
            let is_built_in = version_of_environment(name).is_some()
                || name == b"builtin"
                || crate::linter::globals::environment(name).is_some();
            if is_built_in {
                continue;
            }
            let slash = strings::last_index_of_char(name, b'/');
            let of_plugin = slash.and_then(|slash| {
                let plugin = self.plugins.iter().find(|it| it.id == name[..slash])?;
                plugin.loaded.get(b"environments")?.get(&name[slash + 1..])
            });
            let Some(environment) = of_plugin else {
                return Self::fail(
                    context,
                    &[b"Environment key \"", &name[..], b"\" is unknown\n"].concat(),
                );
            };
            if is_enabled.as_bool() == Some(true) {
                for (from, to) in [
                    (&b"globals"[..], &mut globals),
                    (b"parserOptions", &mut parser_options),
                ] {
                    if let Some(value) = environment.get(from) {
                        super::merge::deep_merge_into(to, value);
                    }
                }
            }
        }
        Ok((globals, parser_options))
    }

    /// Patterns of a `.gitignore` in `base_path`.
    fn ignore_patterns(&mut self, patterns: &[&[u8]], base_path: &[u8]) -> Result<(), ConfigError> {
        if patterns.is_empty() {
            return Ok(());
        }
        let patterns = patterns.iter();
        let patterns =
            patterns.map(|it| Json::String(ignore_pattern_to_minimatch(it, RcFlavor::Eslint)));
        let ignores = self.reader.object(&object(vec![
            (b"basePath", Json::String(base_path.to_vec())),
            (b"ignores", Json::Array(patterns.collect())),
        ]))?;
        self.reader.objects.push(ignores);
        Ok(())
    }

    /// `_normalizeObjectConfigDataBody`
    fn body(&mut self, json: &Json, context: &Context) -> Result<(), ConfigError> {
        for name in strings_of(json.get(b"extends")) {
            if !name.is_empty() {
                self.extends(name, context)?;
            }
        }
        let mut flat: Vec<(&[u8], Json)> = Vec::new();
        let mut language_options: Vec<(&[u8], Json)> = Vec::new();
        if let Some(parser) = json.get(b"parser").and_then(Json::as_str) {
            let loaded = (self.load)(LegacyKind::Parser, parser, &context.path);
            let loaded =
                loaded.map_err(|why| ConfigError::new(&[&context.name, b":\n\t", &why]))?;
            let name = loaded.get(b"name").cloned();
            language_options.push((
                b"parser",
                name.unwrap_or_else(|| Json::String(parser.to_vec())),
            ));
        }
        let (mut plugins, mut locations) = (Vec::new(), Vec::new());
        for name in strings_of(json.get(b"plugins")) {
            let plugin = self.plugin(name, context)?;
            let Plugin { id, loaded } = &self.plugins[plugin];
            plugins.push((
                id.clone(),
                loaded.get(b"name").cloned().unwrap_or(Json::Null),
            ));
            if let Some(location) = loaded.get(b"location") {
                locations.push((id.clone(), location.clone()));
            }
        }
        if json.get(b"plugins").is_some() {
            flat.push((b"plugins", Json::Object(plugins)));
            flat.push((b"$jsPlugins", Json::Object(locations)));
        }
        let (mut globals, mut parser_options) = match json.get(b"env") {
            Some(env) => {
                language_options.push((b"$env", env.clone()));
                self.environments(env, context)?
            }
            None => (Json::Null, Json::Null),
        };
        for (from, to) in [
            (&b"globals"[..], &mut globals),
            (b"parserOptions", &mut parser_options),
        ] {
            if let Some(value) = json.get(from) {
                super::merge::deep_merge_into(to, value);
            }
        }
        if globals != Json::Null {
            language_options.push((b"globals", globals));
        }
        if parser_options != Json::Null {
            language_options.push((b"parserOptions", parser_options));
        }
        if !language_options.is_empty() {
            flat.push((b"languageOptions", object(language_options)));
        }
        let mut linter_options = Vec::new();
        if let Some(value) = json.get(b"noInlineConfig") {
            linter_options.push((&b"noInlineConfig"[..], value.clone()));
        }
        // ESLint warns about them.
        if let Some(value) = json.get(b"reportUnusedDisableDirectives") {
            let severity = match value.as_bool() {
                Some(is_on) => Json::Number(f64::from(u8::from(is_on))),
                None => value.clone(),
            };
            linter_options.push((b"reportUnusedDisableDirectives", severity));
        }
        if !linter_options.is_empty() {
            flat.push((b"linterOptions", object(linter_options)));
        }
        if let Some(settings) = json.get(b"settings") {
            flat.push((b"settings", settings.clone()));
        }
        if let Some(rules) = json.get(b"rules") {
            flat.push((b"rules", rules_of_eslint_8(rules)));
        }
        if let Some(processor) = json.get(b"processor").and_then(Json::as_str) {
            return Self::fail(
                context,
                &[
                    b"ESLint configuration of processor in '",
                    &context.name[..],
                    b"' is invalid: '",
                    processor,
                    b"' was not found.",
                ]
                .concat(),
            );
        }
        if self.ignore {
            self.ignore_patterns(&strings_of(json.get(b"ignorePatterns")), context.base_path)?;
        }
        self.push(object(flat), context)?;
        let overrides = json.get(b"overrides").and_then(Json::as_array);
        for (index, item) in overrides.unwrap_or_default().iter().enumerate() {
            let index = index.to_string();
            let name = [&context.name[..], b"#overrides[", index.as_bytes(), b"]"].concat();
            self.override_data(
                item,
                &Context {
                    name,
                    ..context.clone()
                },
            )?;
        }
        Ok(())
    }
}

/// What `resolveParserOptions` and `resolveGlobals` of ESLint's `Linter` do with the merged configuration of a file: an
/// environment says which version of the language it is for, and what the configuration says itself overrides that.
pub(super) fn resolve_language_options(language_options: &mut Json) {
    let option = |name: &[u8]| {
        let options = language_options.get(b"parserOptions");
        options.and_then(|it| it.get(name)).cloned()
    };
    let env = language_options.get(b"$env").and_then(Json::as_object);
    let enabled = (env.unwrap_or_default().iter())
        .filter(|it| it.1.as_bool() == Some(true))
        .map(|it| &it.0[..]);
    let version_of_env = (enabled.clone().filter_map(version_of_environment)).next_back();
    let returns_globally = enabled
        .clone()
        .any(|it| matches!(it, b"node" | b"commonjs"));
    // A configuration that is built in says it as a flat one does.
    let of_preset = |name: &[u8]| language_options.get(name).cloned();
    let version = (option(b"ecmaVersion").or_else(|| version_of_env.map(Json::Number)))
        .or_else(|| of_preset(b"ecmaVersion"));
    let source_type = option(b"sourceType").or_else(|| of_preset(b"sourceType"));
    let features = option(b"ecmaFeatures");
    if returns_globally
        && features
            .as_ref()
            .is_none_or(|it| it.get(b"globalReturn").is_none())
    {
        let mut features = features.unwrap_or(Json::Null);
        put(&mut features, b"globalReturn", Json::Bool(true));
        let mut options = language_options.get(b"parserOptions").cloned();
        put(options.get_or_insert(Json::Null), b"ecmaFeatures", features);
        put(
            language_options,
            b"parserOptions",
            options.unwrap_or(Json::Null),
        );
    }
    put(
        language_options,
        b"ecmaVersion",
        version.unwrap_or(Json::Number(5.0)),
    );
    let script = || Json::String(b"script".to_vec());
    put(
        language_options,
        b"sourceType",
        source_type.unwrap_or_else(script),
    );
}

impl Config {
    /// From the configuration files of ESLint 8 that count for a directory: the outermost first, then what the command line
    /// adds. See the [module](self).
    pub fn from_legacy(
        registry: &Registry,
        options: &LegacyOptions,
        files: &[LegacyFile],
        load: &mut LoadLegacy<'_>,
        load_plugin: &mut LoadLocatedPlugin<'_>,
    ) -> Result<Config, ConfigError> {
        let mut legacy = Legacy {
            reader: Reader {
                registry,
                base_path: path::resolve(b"/", options.root),
                prefers_typescript_rules: false,
                objects: Vec::new(),
                notes: Vec::new(),
                unknown_rules: Vec::new(),
                js_plugins: Vec::new(),
                js_locations: Vec::new(),
                defaults: 0,
            },
            load,
            plugins: Vec::new(),
            ignore: options.ignore,
        };
        // What ESLint lints of a directory. An override adds its patterns.
        let extensions: Vec<Json> = match options.extensions {
            None => vec![Json::String(b"**/*.js".to_vec())],
            Some(extensions) => (extensions.iter())
                .map(|it| Json::String([b"**/*.", it.strip_prefix(b".").unwrap_or(it)].concat()))
                .collect(),
        };
        for default in [
            object(vec![(b"language", Json::String(b"@/js".to_vec()))]),
            object(vec![(b"files", Json::Array(extensions))]),
            crate::json::parse(DEFAULTS_OF_ESLINT_8).unwrap_or(Json::Null),
        ] {
            let default = legacy.reader.object(&default)?;
            legacy.reader.objects.push(default);
        }
        legacy.ignore_patterns(&IGNORED, options.cwd)?;
        legacy.reader.defaults = legacy.reader.objects.len();
        for file in files {
            legacy.config_data(
                &file.json,
                &Context {
                    path: file.path.clone(),
                    name: file.name.clone(),
                    base_path: &file.base_path,
                    criteria: Vec::new(),
                    depth: 0,
                },
            )?;
        }
        legacy.reader.load_js_plugins(load_plugin)?;
        Ok(legacy.reader.finish(Semantics {
            keeps_options: true,
            accepts_all_plugins: true,
            is_legacy: true,
        }))
    }
}
