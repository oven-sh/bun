//! Finds and reads the configuration files: ESLint's `ConfigLoader`.
//!
//! The configuration of a file is the nearest one: the first directory, from that of the file
//! upwards, that has a file of one of [`NAMES`]. If a directory has several, the first of the list
//! counts. Configurations are not merged.
//!
//! The files of ESLint 8 ([`eslintrc::NAMES`]) count where none of these does, in no directory further up either: neither ESLint
//! nor oxlint reads them beside a file of its own. They are merged with those above them.
//!
//! No tool reads the files of another. So the one that the configuration of the working directory is for decides whose files
//! count further down: templates, fixtures and examples have all sorts. `--flavor` says it where that directory has both.

use crate::cli::{Options, Tool};
use crate::embedded::Framework;
use crate::gitignore::{self, Chain};
use crate::run::{Environment, Fatal};
use crate::{eslintrc, evaluate, fs, paths};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{Host, Route};
use bun_lint::linter::{
    Config, LegacyFile, LegacyOptions, Linter, RcFlavor, ResolvedConfig, oxlint_category_of_key,
    oxlint_filter_keys, oxlint_rule_key, plugin_of_oxlint,
};
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

/// Whose rules of the game apply: what is ignored without being asked for, what a pattern means.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Flavor {
    /// `eslint.config.*`
    Eslint,
    /// `.oxlintrc.json`
    Oxlint,
    /// `.eslintrc.*`
    EslintRc,
    /// No configuration file was found.
    BuiltIn,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Syntax {
    /// JavaScript or TypeScript, to be run.
    Program,
    Json,
}

/// The names of configuration files, by priority.
const NAMES: [(&[u8], Flavor, Syntax); 10] = [
    (b"eslint.config.js", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.ts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cts", Flavor::Eslint, Syntax::Program),
    (b".oxlintrc.json", Flavor::Oxlint, Syntax::Json),
    (b".oxlintrc.jsonc", Flavor::Oxlint, Syntax::Json),
    (b"oxlint.config.ts", Flavor::Oxlint, Syntax::Program),
    (b"oxlint.config.mts", Flavor::Oxlint, Syntax::Program),
];

/// What is linted, and how, if there is no configuration file.
const BUILT_IN: &[u8] = br#"[
    { "ignores": ["**/.git/", "**/*.min.js"] },
    { "files": ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"] },
    {
        "extends": ["eslint:recommended"],
        "languageOptions": {
            "$env": { "browser": true, "node": true },
            "globals": { "Bun": "readonly" },
            "parserOptions": { "ecmaFeatures": { "jsx": true } }
        }
    },
    { "files": ["**/*.{ts,mts,cts,tsx}"], "extends": ["typescript-eslint/TYPESCRIPT"] }
]"#;

/// The files whose `lint` is the configuration of oxlint in a project of Vite+, by priority.
const NAMES_OF_VITE: [&[u8]; 6] = [
    b"vite.config.ts",
    b"vite.config.mts",
    b"vite.config.cts",
    b"vite.config.js",
    b"vite.config.mjs",
    b"vite.config.cjs",
];

/// What is wrong with one of [`NAMES_OF_VITE`] that `--config` names and that says nothing about linting. One that is found is
/// passed over.
const HAS_NO_LINT_FIELD: &[u8] = b"Expected a `lint` field in the default export of ";

fn has_no_lint_field(found: &Found) -> bool {
    matches!(found, Err(Fatal(why)) if why.starts_with(HAS_NO_LINT_FIELD))
}

/// Whether a run in `cwd` stands in for oxlint, as far as can be told without a configuration being read: by `--flavor`, or else by
/// whose file is the nearest.
pub(crate) fn is_for_oxlint(flavor: Option<Tool>, cwd: &[u8]) -> bool {
    let is_there = |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
    let mut directories = paths::ancestors(cwd);
    match flavor {
        Some(tool) => tool == Tool::Oxlint,
        // Of two side by side oxlint's.
        None => directories
            .find_map(|directory| {
                let mut there = NAMES
                    .iter()
                    .filter(|it| is_there(directory, it.0))
                    .peekable();
                there.peek()?;
                Some(there.any(|it| it.1 == Flavor::Oxlint))
            })
            .unwrap_or(false),
    }
}

/// Whether the file at `path`, which `--config` names, has what only a configuration file of oxlint has.
fn is_written_for_oxlint(path: &[u8]) -> bool {
    let Some(json) = fs::read(path)
        .ok()
        .and_then(|it| bun_lint::json::parse(&it))
    else {
        return false;
    };
    let only_there: [&[u8]; 3] = [b"categories", b"jsPlugins", b"options"];
    let schema = json.get(b"$schema").and_then(Json::as_str);
    only_there.iter().any(|it| json.get(it).is_some())
        || schema.is_some_and(|it| strings::contains(it, b"oxlint"))
}

/// A configuration that has been read.
pub(crate) struct Loaded {
    pub(crate) config: Config,
    pub(crate) flavor: Flavor,
    /// Whether the rules that need types run, where that is the same for all files:
    /// `options.typeAware` of an `.oxlintrc.json`. `None`: the configuration of each file says.
    pub(crate) wants_types: Option<bool>,
    /// `options.denyWarnings`
    pub(crate) denies_warnings: bool,
    /// `options.maxWarnings`
    pub(crate) max_warnings: Option<i64>,
    /// Not `options.respectEslintDisableDirectives: false`
    pub(crate) respects_eslint_comments: bool,
    /// `options.typeCheck`
    pub(crate) checks_types: bool,
}

impl Loaded {
    /// What kind of file with scripts in it the file at `path` is, if these are what is linted: oxlint does that.
    pub(crate) fn framework(&self, path: &[u8]) -> Option<Framework> {
        Framework::of(path).filter(|_| self.flavor == Flavor::Oxlint)
    }

    /// How the file at `path`, which has `config`, is linted. Only an `eslint.config.js` has processors.
    pub(crate) fn routes(&self, config: &ResolvedConfig, path: &[u8]) -> Route {
        match config.route(path) {
            Route::Processor if self.flavor != Flavor::Eslint => Route::Unsupported,
            route => route,
        }
    }
}

pub(crate) type Found = Result<Arc<Loaded>, Fatal>;

pub(crate) struct Loader<'l> {
    pub(crate) linter: &'l Linter,
    options: &'l Options,
    environment: &'l Environment<'l>,
    /// Loads the plugins that are written in JavaScript.
    js_plugins: &'l Host<'l>,
    /// By directory: the configuration of the files in it.
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// By the path of the file, which is empty for none. Each is read once, by the first to ask.
    by_file: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Found>>>>,
    /// For the user, in the order in which they came up.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
    /// What a configuration asks for and cannot be done, a line for each: rules that do not exist here, files in a language that
    /// is not read here. To do less than the tool that is replaced, and find no problems, is worse than to fail.
    pub(crate) unsupported: Guarded<Vec<Vec<u8>>>,
    /// [`eslintrc::uses_flat_config`]
    flat_config: Option<bool>,
    /// [`Loader::is_command_line_of_eslint_8`]
    is_legacy: OnceLock<bool>,
    /// [`Loader::tool`]
    tool: OnceLock<Option<Flavor>>,
    /// `options.typeAware` of the configuration of the working directory, if that is one of oxlint.
    wants_types: OnceLock<Option<bool>>,
    /// The project is one of Vite+ without a configuration file of a linter: [`NAMES_OF_VITE`] are the files that count.
    is_of_vite: OnceLock<bool>,
}

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    Json::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_vec(), value))
            .collect(),
    )
}

fn strings_of(items: &[Vec<u8>]) -> Json {
    Json::Array(items.iter().cloned().map(Json::String).collect())
}

fn severity_name(severity: Severity) -> Json {
    Json::String(match severity {
        Severity::Off => b"off".to_vec(),
        Severity::Warn => b"warn".to_vec(),
        Severity::Error => b"error".to_vec(),
    })
}

/// `getShorthandName(name, "eslint-plugin")`
fn plugin_shorthand(name: &[u8]) -> Vec<u8> {
    if let [b'@', scoped @ ..] = name
        && let Some(slash) = strings::index_of_char_usize(scoped, b'/')
    {
        let (scope, rest) = (&name[..=slash], &scoped[slash + 1..]);
        return match rest.strip_prefix(b"eslint-plugin") {
            Some(b"") => scope.to_vec(),
            Some([b'-', rest @ ..]) => [scope, b"/", rest].concat(),
            _ => name.to_vec(),
        };
    }
    name.strip_prefix(b"eslint-plugin-")
        .unwrap_or(name)
        .to_vec()
}

/// `--global a,b:true`
fn globals_of(options: &Options) -> Option<Json> {
    if options.global.is_empty() {
        return None;
    }
    let mut globals: Vec<(Vec<u8>, Json)> = Vec::new();
    for name in &options.global {
        let (name, value): (&[u8], &[u8]) = match name.strip_suffix(b":true") {
            Some(name) => (name, b"writable"),
            None => (name, b"readonly"),
        };
        globals.retain(|it| it.0 != name);
        globals.push((name.to_vec(), Json::String(value.to_vec())));
    }
    Some(Json::Object(globals))
}

/// `preprocessConfig` under `--no-ignore`: an object that only has `ignores` loses them.
fn without_global_ignores(json: Json, depth: usize) -> Json {
    match json {
        Json::Array(items) if depth < 64 => Json::Array(
            items
                .into_iter()
                .map(|item| without_global_ignores(item, depth + 1))
                .collect(),
        ),
        Json::Object(mut entries) => {
            let is_meta = |key: &[u8]| matches!(key, b"name" | b"basePath");
            if entries.iter().any(|it| it.0 == b"ignores")
                && entries.iter().filter(|it| !is_meta(&it.0)).count() == 1
            {
                entries.retain(|it| it.0 != b"ignores");
            }
            Json::Object(entries)
        }
        json => json,
    }
}

/// The categories of oxlint's rules, but `nursery`.
const CATEGORIES: [&[u8]; 6] = [
    b"correctness",
    b"suspicious",
    b"pedantic",
    b"perf",
    b"style",
    b"restriction",
];

/// oxlint's `-A`, `-W` and `-D`, one after the other. They come after the `rules` of the file and
/// before its `overrides`. A category is about all of its rules, also those that `rules` names.
fn apply_filters(entries: &mut Vec<(Vec<u8>, Json)>, filters: &[(Severity, Vec<u8>)]) {
    type Entries = Vec<(Vec<u8>, Json)>;
    /// The object `name` of the file, which is made if it is not there.
    fn section<'e>(entries: &'e mut Entries, name: &[u8]) -> Option<&'e mut Entries> {
        if !entries
            .iter()
            .any(|it| it.0 == name && matches!(it.1, Json::Object(_)))
        {
            entries.retain(|it| it.0 != name);
            entries.push((name.to_vec(), Json::Object(Vec::new())));
        }
        match entries.iter_mut().find(|it| it.0 == name) {
            Some((_, Json::Object(section))) => Some(section),
            _ => None,
        }
    }
    /// Gives the entries that `is_meant` holds for the severity, and adds one for `key` if there is none. The options stay.
    fn put(
        section: Option<&mut Entries>,
        key: &[u8],
        severity: Severity,
        is_meant: impl Fn(&[u8]) -> bool,
    ) {
        let Some(section) = section else {
            return;
        };
        let mut is_there = false;
        for (_, value) in section.iter_mut().filter(|it| is_meant(&it.0)) {
            is_there = true;
            match value {
                Json::Array(items) if !items.is_empty() => items[0] = severity_name(severity),
                value => *value = severity_name(severity),
            }
        }
        if !is_there && !key.is_empty() {
            section.push((key.to_vec(), severity_name(severity)));
        }
    }
    fn put_category(entries: &mut Entries, category: &[u8], severity: Severity) {
        put(section(entries, b"categories"), category, severity, |it| {
            it == category
        });
        put(section(entries, b"rules"), b"", severity, |it| {
            oxlint_category_of_key(&oxlint_rule_key(it)).map(str::as_bytes) == Some(category)
        });
    }
    for (severity, name) in filters {
        if name == b"all" {
            if *severity == Severity::Off {
                entries.retain(|it| it.0 != b"rules");
            }
            CATEGORIES
                .iter()
                .for_each(|category| put_category(entries, category, *severity));
        } else if CATEGORIES.contains(&&name[..]) || name == b"nursery" {
            put_category(entries, name, *severity);
        } else {
            for key in oxlint_filter_keys(name) {
                put(section(entries, b"rules"), &key, *severity, |it| {
                    oxlint_rule_key(it) == key
                });
            }
        }
    }
}

impl<'l> Loader<'l> {
    pub(crate) fn new(
        linter: &'l Linter,
        options: &'l Options,
        environment: &'l Environment<'l>,
        js_plugins: &'l Host<'l>,
    ) -> Loader<'l> {
        Loader {
            linter,
            options,
            environment,
            js_plugins,
            by_directory: Guarded::new(FxHashMap::default()),
            by_file: Guarded::new(FxHashMap::default()),
            warnings: Guarded::new(Vec::new()),
            unsupported: Guarded::new(Vec::new()),
            flat_config: eslintrc::uses_flat_config(),
            is_legacy: OnceLock::new(),
            tool: OnceLock::new(),
            wants_types: OnceLock::new(),
            is_of_vite: OnceLock::new(),
        }
    }

    pub(crate) fn warn(&self, parts: &[&[u8]]) {
        let warning = parts.concat();
        let mut warnings = self.warnings.lock();
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }

    /// Adds to [`Loader::unsupported`].
    pub(crate) fn cannot_do(&self, parts: &[&[u8]]) {
        let line = parts.concat();
        let mut unsupported = self.unsupported.lock();
        if !unsupported.contains(&line) {
            unsupported.push(line);
        }
    }

    fn cwd(&self) -> &[u8] {
        &self.environment.cwd
    }

    /// Whether every file has the same configuration, wherever it is.
    fn has_one_configuration(&self) -> bool {
        self.options.config.is_some() || !self.options.config_lookup
    }

    /// ESLint's `overrideConfig`, as `translateOptions` makes it from the command line.
    fn override_config(&self) -> Vec<Json> {
        let options = self.options;
        let mut language_options = Vec::new();
        if let Some(globals) = globals_of(options) {
            language_options.push((&b"globals"[..], globals));
        }
        if !options.parser_options.is_empty() {
            language_options.push((
                b"parserOptions",
                Json::Object(options.parser_options.clone()),
            ));
        }
        if let Some(parser) = &options.parser {
            language_options.push((b"parser", Json::String(parser.clone())));
        }
        let mut first = Vec::new();
        if !language_options.is_empty() {
            first.push((&b"languageOptions"[..], object(language_options)));
        }
        first.push((b"rules", Json::Object(options.rule.clone())));
        let mut linter_options = Vec::new();
        if options.report_unused_disable_directives {
            linter_options.push((
                &b"reportUnusedDisableDirectives"[..],
                severity_name(Severity::Error),
            ));
        } else if let Some(severity) = options.report_unused_disable_directives_severity {
            linter_options.push((b"reportUnusedDisableDirectives", severity_name(severity)));
        }
        if let Some(severity) = options.report_unused_inline_configs {
            linter_options.push((b"reportUnusedInlineConfigs", severity_name(severity)));
        }
        if !linter_options.is_empty() {
            first.push((b"linterOptions", object(linter_options)));
        }
        if !options.plugin.is_empty() {
            let plugins = options
                .plugin
                .iter()
                .map(|name| (plugin_shorthand(name), Json::String(name.clone())));
            first.push((b"plugins", Json::Object(plugins.collect())));
        }
        let mut all = vec![object(first)];
        if let Some(extensions) = &options.ext {
            let patterns = extensions.iter().map(|extension| {
                let dot: &[u8] = if extension.starts_with(b".") {
                    b""
                } else {
                    b"."
                };
                Json::String([b"**/*", dot, extension].concat())
            });
            all.push(object(vec![(b"files", Json::Array(patterns.collect()))]));
        }
        all
    }

    /// ESLint's `calculateConfigArray`. `file_config`: what the configuration file exports.
    fn flat(&self, base_path: &[u8], file_config: Json) -> Result<Config, Fatal> {
        let mut all = vec![file_config];
        if !self.options.ignore_pattern.is_empty() {
            all.push(object(vec![
                (b"basePath", Json::String(self.cwd().to_vec())),
                (b"ignores", strings_of(&self.options.ignore_pattern)),
            ]));
        }
        all.extend(self.override_config());
        let mut all = Json::Array(all);
        if !self.options.ignore {
            all = without_global_ignores(all, 0);
        }
        let mut load_plugin =
            |location: &Json, prefix: &[u8]| self.js_plugins.load_located(location, prefix);
        Config::from_flat_json_with_plugins(
            self.linter.registry(),
            base_path,
            &all,
            &mut load_plugin,
        )
        .map_err(|error| Fatal(error.message))
    }

    /// An `.oxlintrc.json` or `.eslintrc.json`, with what the command line adds.
    fn rc(&self, path: &[u8], mut json: Json, flavor: RcFlavor) -> Result<Config, Fatal> {
        let options = self.options;
        if let Json::Object(entries) = &mut json {
            let mut put =
                |key: &[u8], add: Vec<Json>| match entries.iter_mut().find(|it| it.0 == key) {
                    Some((_, Json::Array(items))) => items.extend(add),
                    Some((_, other)) => {
                        let first = std::mem::replace(other, Json::Null);
                        *other = Json::Array(std::iter::once(first).chain(add).collect());
                    }
                    None => entries.push((key.to_vec(), Json::Array(add))),
                };
            if !options.ignore_pattern.is_empty() && options.ignore {
                put(
                    b"ignorePatterns",
                    options
                        .ignore_pattern
                        .iter()
                        .cloned()
                        .map(Json::String)
                        .collect(),
                );
            }
            let mut last = vec![(
                &b"files"[..],
                Json::Array(vec![Json::String(b"**/*".to_vec())]),
            )];
            if !options.rule.is_empty() {
                last.push((b"rules", Json::Object(options.rule.clone())));
            }
            if let Some(globals) = globals_of(options) {
                last.push((b"globals", globals));
            }
            if !options.parser_options.is_empty() {
                last.push((
                    b"parserOptions",
                    Json::Object(options.parser_options.clone()),
                ));
            }
            if last.len() > 1 {
                put(b"overrides", vec![object(last)]);
            }
            // oxlint's `--no-ignore` is about the command line and `.eslintignore` only.
            if !options.ignore && flavor == RcFlavor::Eslint {
                entries.retain(|it| it.0 != b"ignorePatterns");
            }
            apply_filters(entries, &options.filters);
            if flavor == RcFlavor::Oxlint && !options.plugins.is_empty() {
                let mut plugins: Vec<Json> = match entries.iter().find(|it| it.0 == b"plugins") {
                    Some((_, Json::Array(plugins))) => plugins.clone(),
                    _ => [&b"unicorn"[..], b"typescript", b"oxc"]
                        .iter()
                        .map(|it| Json::String(it.to_vec()))
                        .collect(),
                };
                for (name, is_on) in &options.plugins {
                    plugins.retain(|it| {
                        it.as_str().map(plugin_of_oxlint) != Some(plugin_of_oxlint(name))
                    });
                    if *is_on {
                        plugins.push(Json::String(name.to_vec()));
                    }
                }
                entries.retain(|it| it.0 != b"plugins");
                entries.push((b"plugins".to_vec(), Json::Array(plugins)));
            }
            let of_file = (entries
                .iter()
                .find(|it| it.0 == b"options")
                .filter(|_| flavor == RcFlavor::Oxlint))
            .and_then(|it| it.1.get(b"reportUnusedDisableDirectives"))
            .and_then(|it| match it.as_str()? {
                b"allow" | b"off" => Some(Severity::Off),
                b"warn" => Some(Severity::Warn),
                b"deny" | b"error" => Some(Severity::Error),
                _ => None,
            });
            let unused = match (options.report_unused_disable_directives, flavor) {
                // oxlint warns.
                (true, RcFlavor::Oxlint) => Some(Severity::Warn),
                (true, RcFlavor::Eslint) => Some(Severity::Error),
                (false, _) => options
                    .report_unused_disable_directives_severity
                    .or(of_file),
            };
            if let Some(severity) = unused {
                entries.retain(|it| it.0 != b"reportUnusedDisableDirectives");
                entries.push((
                    b"reportUnusedDisableDirectives".to_vec(),
                    severity_name(severity),
                ));
            }
        }
        // An `.eslintrc.json` that `--config` names is for the working directory, wherever it is. What
        // it extends is next to it. The patterns of oxlint are from the directory of the file.
        let base_path = if options.config.is_some() && flavor == RcFlavor::Eslint {
            self.cwd()
        } else {
            paths::dirname(path)
        };
        let mut moved: Vec<(Vec<u8>, Vec<u8>)> =
            vec![(base_path.to_vec(), paths::dirname(path).to_vec())];
        let mut load = |directory: &[u8], name: &[u8]| {
            // For oxlint it is a path if it looks like one: it has an extension. It does not know the names of packages.
            let has_extension = strings::last_index_of_char(paths::basename(name), b'.') > Some(0);
            if !name.starts_with(b".") && !paths::is_absolute(name) && !has_extension {
                return None;
            }
            // Where the reader takes a file to be, and where it is.
            let real = moved
                .iter()
                .find(|it| it.0 == directory)
                .map_or(directory, |it| &it.1[..]);
            let file = paths::resolve(real, name);
            let taken_for = paths::resolve(directory, name);
            if taken_for != file {
                moved.push((
                    paths::dirname(&taken_for).to_vec(),
                    paths::dirname(&file).to_vec(),
                ));
            }
            bun_lint::json::parse(&fs::read(&file).ok()?)
        };
        let mut load_plugin = |directory: &[u8], specifier: &[u8], alias: Option<&[u8]>| {
            let directory = if directory == base_path {
                paths::dirname(path)
            } else {
                directory
            };
            self.js_plugins.load(directory, specifier, alias)
        };
        Config::from_rc_json_with_plugins(
            self.linter.registry(),
            base_path,
            &json,
            flavor,
            &mut load,
            &mut load_plugin,
        )
        .map_err(|error| {
            Fatal(
                [
                    b"Cannot use the configuration file ",
                    path,
                    b":\n",
                    &error.message[..],
                ]
                .concat(),
            )
        })
    }

    fn built_in(&self) -> Found {
        // What oxlint does without a file.
        if self.tool() == Some(Flavor::Oxlint) {
            let path = paths::join(self.cwd(), b".oxlintrc.json");
            return Ok(Arc::new(Loaded {
                config: self.rc(&path, Json::Object(Vec::new()), RcFlavor::Oxlint)?,
                flavor: Flavor::Oxlint,
                wants_types: Some(false),
                denies_warnings: false,
                max_warnings: None,
                respects_eslint_comments: true,
                checks_types: false,
            }));
        }
        let preset: &[u8] = match self.options.type_aware {
            Some(true) => b"recommended-type-checked",
            _ => b"recommended",
        };
        let text = strings::replace_owned(BUILT_IN, b"TYPESCRIPT", preset);
        let root = paths::ancestors(self.cwd()).last().unwrap_or(b"/");
        Ok(Arc::new(Loaded {
            config: self.flat(root, bun_lint::json::parse(&text).unwrap_or(Json::Null))?,
            flavor: Flavor::BuiltIn,
            wants_types: Some(false),
            denies_warnings: false,
            max_warnings: None,
            respects_eslint_comments: true,
            checks_types: false,
        }))
    }

    /// Reads the configuration file at `path`. `base_path`: what the patterns of a flat
    /// configuration are relative to.
    fn read(&self, path: &[u8], base_path: &[u8]) -> Found {
        let name = paths::basename(path);
        let is_of_vite = NAMES_OF_VITE.contains(&name);
        let known = (NAMES.iter().find(|it| it.0 == name).map(|it| (it.1, it.2)))
            .or_else(|| is_of_vite.then_some((Flavor::Oxlint, Syntax::Program)));
        let is_json = name.ends_with(b".json") || name.ends_with(b".jsonc");
        let syntax = known.map_or(
            if is_json {
                Syntax::Json
            } else {
                Syntax::Program
            },
            |it| it.1,
        );
        let json = match syntax {
            Syntax::Program => evaluate::evaluate(
                self.environment,
                evaluate::ESLINT,
                path,
                self.options.config_cache,
            )?,
            Syntax::Json => {
                let text = fs::read(path).map_err(|error| {
                    Fatal(
                        [
                            b"Cannot read the configuration file ",
                            path,
                            b": ",
                            &fs::describe(&error),
                        ]
                        .concat(),
                    )
                })?;
                bun_lint::json::parse(&text).ok_or_else(|| {
                    Fatal([b"The configuration file ", path, b" is not valid JSON."].concat())
                })?
            }
        };
        if is_of_vite && json == Json::Null {
            return Err(Fatal([HAS_NO_LINT_FIELD, path].concat()));
        }
        // A file by another name is what it looks like.
        let flavor = known.map_or_else(
            || match (&json, syntax) {
                (Json::Object(_), Syntax::Json) => Flavor::Oxlint,
                _ => Flavor::Eslint,
            },
            |it| it.0,
        );
        if flavor == Flavor::Oxlint {
            let cannot_use = |why: &[u8]| {
                Fatal([b"Cannot use the configuration file ", path, b":\n", why].concat())
            };
            Config::check_shape_for_oxlint(&json).map_err(|error| cannot_use(&error.message))?;
            let is_nested = self.options.config.is_none()
                && (paths::dirname(path).strip_prefix(self.cwd()))
                    .is_some_and(|rest| rest.starts_with(b"/"));
            let options = json.get(b"options").and_then(Json::as_object);
            if let Some((name, _)) = options.and_then(|it| it.first()).filter(|_| is_nested) {
                return Err(cannot_use(
                    &[
                        b"The `options.",
                        &name[..],
                        b"` option is only supported in the root config.",
                    ]
                    .concat(),
                ));
            }
        }
        let config = match flavor {
            Flavor::Eslint | Flavor::BuiltIn => {
                // ESLint throws.
                if json == Json::Null {
                    return Err(Fatal(
                        [b"The configuration file ", path, b" exports nothing."].concat(),
                    ));
                }
                let is_empty = match &json {
                    Json::Array(items) => items.is_empty(),
                    Json::Object(entries) => entries.is_empty(),
                    _ => false,
                };
                if is_empty {
                    self.warn(&[
                        b"The configuration file ",
                        path,
                        b" is empty. Export [{}] if that is what you want.",
                    ]);
                }
                self.flat(
                    base_path,
                    if is_empty {
                        Json::Array(Vec::new())
                    } else {
                        json
                    },
                )?
            }
            Flavor::Oxlint => self.rc(path, json, RcFlavor::Oxlint)?,
            Flavor::EslintRc => self.rc(path, json, RcFlavor::Eslint)?,
        };
        for note in config.notes() {
            self.warn(&[note]);
        }
        self.warn_about_unknown_rules(&config);
        let option = |name: &[u8]| config.option_of_oxlint(name);
        let is_on = |name: &[u8]| option(name).and_then(Json::as_bool) == Some(true);
        let wants_types = match flavor {
            Flavor::Eslint | Flavor::EslintRc => None,
            Flavor::Oxlint => Some(is_on(b"typeAware")),
            Flavor::BuiltIn => Some(false),
        };
        let denies_warnings = is_on(b"denyWarnings");
        let max_warnings = match option(b"maxWarnings") {
            Some(Json::Number(count)) => Some(*count as i64),
            _ => None,
        };
        let respects_eslint_comments =
            option(b"respectEslintDisableDirectives").and_then(Json::as_bool) != Some(false);
        let checks_types = is_on(b"typeCheck");
        Ok(Arc::new(Loaded {
            config,
            flavor,
            wants_types,
            denies_warnings,
            max_warnings,
            respects_eslint_comments,
            checks_types,
        }))
    }

    /// One line for each plugin that has rules which are configured and do not exist here, with all of them.
    fn warn_about_unknown_rules(&self, config: &Config) {
        let mut by_plugin: Vec<(&[u8], Vec<&[u8]>)> = Vec::new();
        for id in config.unknown_rules() {
            let (plugin, _) = bun_lint::linter::parse_rule_id(id);
            match by_plugin.iter_mut().find(|it| it.0 == plugin) {
                Some(entry) => entry.1.push(id),
                None => by_plugin.push((plugin, vec![id])),
            }
        }
        for (plugin, rules) in by_plugin {
            let count = format!("{}", rules.len()).into_bytes();
            let of: Vec<u8> = match plugin {
                b"" => b"ESLint".to_vec(),
                b"@typescript-eslint" | b"typescript" | b"typescript-eslint" => {
                    b"typescript-eslint".to_vec()
                }
                plugin => [b"the plugin \"", plugin, b"\""].concat(),
            };
            let noun: &[u8] = match rules.len() {
                1 => b" rule of ",
                _ => b" rules of ",
            };
            self.cannot_do(&[
                &count,
                noun,
                &of,
                b" did not run: ",
                &rules.join(&b", "[..]),
            ]);
        }
    }

    /// The configuration in the file at `path`, which is empty for the one that is built in or,
    /// under `--no-config-lookup`, for none.
    fn load(&self, path: &[u8], base_path: &[u8]) -> Found {
        let slot = Arc::clone(self.by_file.lock().entry(path.to_vec()).or_default());
        slot.get_or_init(|| match path {
            b"" if !self.options.config_lookup => Ok(Arc::new(Loaded {
                config: self.flat(base_path, Json::Array(Vec::new()))?,
                flavor: Flavor::Eslint,
                wants_types: None,
                denies_warnings: false,
                max_warnings: None,
                respects_eslint_comments: true,
                checks_types: false,
            })),
            b"" => self.built_in(),
            path => self.read(path, base_path),
        })
        .clone()
    }

    /// Whose configuration files count: `--flavor`, or else the tool that the working directory has a configuration of.
    /// `None`: it has none.
    fn tool(&self) -> Option<Flavor> {
        *self.tool.get_or_init(|| {
            let options = self.options;
            let wanted = options.flavor.map(|it| match it {
                Tool::Eslint => Flavor::Eslint,
                Tool::Oxlint => Flavor::Oxlint,
            });
            let reads_flat = self.flat_config != Some(false);
            let is_there =
                |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
            let names = || {
                NAMES
                    .iter()
                    .filter(move |it| reads_flat || it.1 != Flavor::Eslint)
            };
            let found = paths::ancestors(self.cwd()).find_map(|directory| {
                let mut names = names().filter(|it| wanted.is_none_or(|wanted| wanted == it.1));
                let found = names.find(|it| is_there(directory, it.0))?;
                Some((directory, found.0, found.1))
            });
            // Flags that only oxlint has, or a file that only it reads.
            let is_for_oxlint = !options.filters.is_empty()
                || !options.plugins.is_empty()
                || options.deny_warnings
                || options.disable_nested_config
                || options.fix_suggestions
                || (options.config.as_ref()).is_some_and(|it| {
                    is_written_for_oxlint(&paths::resolve(self.cwd(), &paths::from_native(it)))
                });
            if let Some((directory, name, flavor)) = found {
                let mut others = names().filter(|it| it.1 != flavor);
                let other = others.find(|it| is_there(directory, it.0));
                let other = other.filter(|_| wanted.is_none() && options.config.is_none());
                let Some(other) = other.map(|it| (it.0, it.1)) else {
                    return Some(flavor);
                };
                // Who has both runs oxlint first, and ESLint for what oxlint does not have.
                if !is_for_oxlint {
                    let used = match flavor {
                        Flavor::Oxlint => name,
                        _ => other.0,
                    };
                    self.warn(&[
                        b"Both ",
                        name,
                        b" and ",
                        other.0,
                        b" found in ",
                        directory,
                        b": using ",
                        used,
                        b". Use --flavor=eslint for the other.",
                    ]);
                }
                return Some(Flavor::Oxlint);
            }
            let can_be_legacy =
                wanted == Some(Flavor::Eslint) || wanted.is_none() && !is_for_oxlint;
            if can_be_legacy && paths::ancestors(self.cwd()).any(eslintrc::has_one) {
                return Some(Flavor::EslintRc);
            }
            let decided = wanted.or_else(|| is_for_oxlint.then_some(Flavor::Oxlint));
            let of_the_package = self.tool_of_the_package(decided.is_some());
            decided.or(of_the_package)
        })
    }

    /// Without any configuration file: oxlint, if the nearest `package.json` that depends on one of the two tools depends on it.
    /// ESLint does not run without a configuration file.
    /// `is_decided`: the command line has said which tool it is.
    fn tool_of_the_package(&self, is_decided: bool) -> Option<Flavor> {
        let found = paths::ancestors(self.cwd()).find_map(|directory| {
            let path = paths::join(directory, b"package.json");
            let json = bun_lint::json::parse(&fs::read(&path).ok()?)?;
            let has = |name: &[u8]| {
                [&b"dependencies"[..], b"devDependencies"]
                    .iter()
                    .any(|it| json.get(it).is_some_and(|it| it.get(name).is_some()))
            };
            let (has_oxlint, has_eslint) = (has(b"oxlint") || has(b"vite-plus"), has(b"eslint"));
            if has(b"vite-plus") {
                let _ = self.is_of_vite.set(true);
            }
            if has_oxlint && has_eslint && !is_decided {
                self.warn(&[
                    b"No configuration file found, and ",
                    &path,
                    b" has both eslint and oxlint: using the defaults of oxlint. Use --flavor=eslint for the other.",
                ]);
            }
            (has_oxlint || has_eslint).then(|| has_oxlint.then_some(Flavor::Oxlint))
        });
        found.flatten()
    }

    /// Those of [`NAMES`] that count.
    fn names(&self) -> impl Iterator<Item = &'static [u8]> {
        let (reads_flat, tool) = (self.flat_config != Some(false), self.tool());
        let is_of_vite = tool == Some(Flavor::Oxlint) && self.is_of_vite.get() == Some(&true);
        let names = NAMES.iter().filter(move |it| {
            (reads_flat || it.1 != Flavor::Eslint) && tool.is_none_or(|tool| tool == it.1)
        });
        let of_vite = NAMES_OF_VITE.iter().filter(move |_| is_of_vite);
        names.map(|it| it.0).chain(of_vite.copied())
    }

    /// The name of the configuration file among `names`, which are those of a directory, and whether one of these can be a file
    /// of ESLint 8.
    fn pick<'n>(&self, names: impl Iterator<Item = &'n [u8]>) -> (Option<&'static [u8]>, bool) {
        let (mut best, mut has_legacy) = (None, false);
        for name in names.filter(|name| {
            name.starts_with(b"eslint.")
                || name.starts_with(b".")
                || name.starts_with(b"oxlint.")
                || name.starts_with(b"vite.")
                || *name == b"package.json"
        }) {
            has_legacy |= eslintrc::NAMES.contains(&name);
            let position = self.names().position(|it| it == name);
            best = match (best, position) {
                (Some(best), Some(position)) => Some(position.min(best)),
                (best, position) => best.or(position),
            };
        }
        (best.and_then(|best| self.names().nth(best)), has_legacy)
    }

    /// Whether the command line is one for ESLint 8: it has a flag that only that has, or `--config` names one of its files.
    fn is_command_line_of_eslint_8(&self) -> bool {
        *self.is_legacy.get_or_init(|| {
            let options = self.options;
            if !options.eslintrc || !options.env.is_empty() || !options.rulesdir.is_empty() {
                return true;
            }
            let Some(path) = &options.config else {
                return false;
            };
            // A file that can be either is one of oxlint, whatever the working directory has.
            eslintrc::is_one(&paths::resolve(self.cwd(), &paths::from_native(path)))
        })
    }

    /// ESLint 8's `cliConfig`.
    fn legacy_command_line(&self) -> Json {
        let options = self.options;
        let mut entries = Vec::new();
        if !options.env.is_empty() {
            let env = options.env.iter().map(|it| (it.clone(), Json::Bool(true)));
            entries.push((&b"env"[..], Json::Object(env.collect())));
        }
        if let Some(globals) = globals_of(options) {
            entries.push((b"globals", globals));
        }
        if !options.ignore_pattern.is_empty() {
            entries.push((b"ignorePatterns", strings_of(&options.ignore_pattern)));
        }
        if let Some(parser) = &options.parser {
            entries.push((b"parser", Json::String(parser.clone())));
        }
        if !options.parser_options.is_empty() {
            let parser_options = Json::Object(options.parser_options.clone());
            entries.push((b"parserOptions", parser_options));
        }
        if !options.plugin.is_empty() {
            entries.push((b"plugins", strings_of(&options.plugin)));
        }
        if !options.rule.is_empty() {
            entries.push((b"rules", Json::Object(options.rule.clone())));
        }
        let unused = match options.report_unused_disable_directives {
            true => Some(Severity::Error),
            false => options.report_unused_disable_directives_severity,
        };
        if let Some(severity) = unused {
            entries.push((b"reportUnusedDisableDirectives", severity_name(severity)));
        }
        object(entries)
    }

    /// The configuration of ESLint 8 for what is in `directory`, which has a file of it. `None`: without any such file.
    fn legacy(&self, directory: Option<&[u8]>) -> Found {
        let key = [directory.unwrap_or_default(), b"\0"].concat();
        let slot = Arc::clone(self.by_file.lock().entry(key).or_default());
        slot.get_or_init(|| self.read_legacy(directory)).clone()
    }

    fn read_legacy(&self, directory: Option<&[u8]>) -> Found {
        let (options, cwd) = (self.options, self.cwd());
        if let Some(rules) = options.rulesdir.first() {
            return Err(Fatal(
                [b"--rulesdir ", &rules[..], b" is not supported."].concat(),
            ));
        }
        let absolute = |path: &Vec<u8>| paths::resolve(cwd, &paths::from_native(path));
        let mut files = match directory {
            Some(directory) => eslintrc::cascade(directory, cwd)?,
            None => Vec::new(),
        };
        if options.ignore {
            let path = options.ignore_path.as_ref().map(absolute);
            files.extend(eslintrc::ignore_file(path.as_deref(), cwd)?);
        }
        if let Some(path) = &options.config {
            files.push(eslintrc::named(&absolute(path), cwd)?);
        }
        files.push(LegacyFile {
            path: paths::join(cwd, b"__placeholder__.js"),
            name: b"CLIOptions".to_vec(),
            base_path: cwd.to_vec(),
            json: self.legacy_command_line(),
        });
        let plugins_from = options.resolve_plugins_relative_to.as_ref();
        let plugins_from = plugins_from.map_or_else(|| cwd.to_vec(), absolute);
        let mut load = |kind, request: &[u8], from: &[u8]| {
            let short = plugin_shorthand(request);
            eslintrc::load(kind, request, &short, from, &plugins_from)
        };
        let mut load_plugin =
            |location: &Json, prefix: &[u8]| self.js_plugins.load_located(location, prefix);
        let config = Config::from_legacy(
            self.linter.registry(),
            &LegacyOptions {
                root: paths::ancestors(cwd).last().unwrap_or(b"/"),
                cwd,
                ignore: options.ignore,
                extensions: options.ext.as_deref(),
            },
            &files,
            &mut load,
            &mut load_plugin,
        )
        .map_err(|error| Fatal(error.message))?;
        for note in config.notes() {
            self.warn(&[note]);
        }
        self.warn_about_unknown_rules(&config);
        Ok(Arc::new(Loaded {
            config,
            flavor: Flavor::EslintRc,
            wants_types: None,
            denies_warnings: false,
            max_warnings: None,
            respects_eslint_comments: true,
            checks_types: false,
        }))
    }

    /// The configuration in the file `name` of `directory`. oxlint refuses a directory that has two of its files.
    fn load_the_only_one(&self, directory: &[u8], name: &[u8]) -> Found {
        let mut of_oxlint = NAMES.iter().filter(|it| it.1 == Flavor::Oxlint);
        if of_oxlint.clone().any(|it| it.0 == name)
            && let Some(other) =
                of_oxlint.find(|it| it.0 != name && fs::is_file(&paths::join(directory, it.0)))
        {
            return Err(Fatal(
                [
                    b"Both '",
                    name,
                    b"' and '",
                    other.0,
                    b"' found in ",
                    directory,
                    b".\nDelete one of the configuration files.",
                ]
                .concat(),
            ));
        }
        self.load(&paths::join(directory, name), directory)
    }

    /// The configuration of the files that are in `directory`: ESLint's `loadConfigArrayForFile`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        if self.is_command_line_of_eslint_8() {
            let mut above = paths::ancestors(directory).filter(|_| self.options.eslintrc);
            return self.legacy(above.find(|it| eslintrc::has_one(it)));
        }
        if self.has_one_configuration() {
            return match &self.options.config {
                Some(path) => self.load(
                    &paths::resolve(self.cwd(), &paths::from_native(path)),
                    self.cwd(),
                ),
                None => self.load(b"", self.cwd()),
            };
        }
        // oxlint's `--disable-nested-config`: that of the working directory is for everything.
        let directory = if self.options.disable_nested_config {
            self.cwd()
        } else {
            directory
        };
        let mut asked: Vec<&[u8]> = Vec::new();
        let mut found = None;
        // How many of `asked` have the configuration of the nearest directory with a file of ESLint 8.
        let mut legacy = None;
        for ancestor in paths::ancestors(directory) {
            if let Some(known) = self.by_directory.lock().get(ancestor) {
                found = Some(known.clone());
                break;
            }
            asked.push(ancestor);
            let name = (self.names()).find(|name| fs::is_file(&paths::join(ancestor, name)));
            let loaded = name.map(|name| self.load_the_only_one(ancestor, name));
            if let Some(loaded) = loaded.filter(|it| !has_no_lint_field(it)) {
                found = Some(loaded);
                break;
            }
            if legacy.is_none() && eslintrc::has_one(ancestor) {
                legacy = Some(asked.len());
            }
        }
        let is_other = |it: &Found| {
            (it.as_ref()).is_ok_and(|it| matches!(it.flavor, Flavor::Eslint | Flavor::Oxlint))
        };
        if let Some(count) = legacy.filter(|_| !found.as_ref().is_some_and(is_other)) {
            asked.truncate(count);
            let last = asked.last().copied();
            found = Some(match self.flat_config {
                Some(true) => Err(Fatal(
                    [
                        b"ESLINT_USE_FLAT_CONFIG is true, and ",
                        last.unwrap_or_default(),
                        b" has a configuration file of ESLint 8 and no eslint.config.js.",
                    ]
                    .concat(),
                )),
                _ => self.legacy(last),
            });
        }
        let found = found.unwrap_or_else(|| self.load(b"", self.cwd()));
        let mut by_directory = self.by_directory.lock();
        for directory in asked {
            by_directory.insert(directory.to_vec(), found.clone());
        }
        found
    }

    /// The same for a directory whose entries are `names`, and whose parent has `inherited`.
    pub(crate) fn for_listed_directory<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
        inherited: &Arc<Loaded>,
    ) -> Found {
        let has_one = self.has_one_configuration() && !self.is_command_line_of_eslint_8();
        if has_one || self.options.disable_nested_config || !self.options.eslintrc {
            return Ok(Arc::clone(inherited));
        }
        let is_legacy = matches!(inherited.flavor, Flavor::EslintRc | Flavor::BuiltIn);
        match self.pick(names) {
            (Some(name), _) if !self.is_command_line_of_eslint_8() => {
                let loaded = self.load_the_only_one(directory, name);
                match has_no_lint_field(&loaded) {
                    true => Ok(Arc::clone(inherited)),
                    false => loaded,
                }
            }
            (_, true)
                if is_legacy && self.flat_config != Some(true) && eslintrc::has_one(directory) =>
            {
                self.legacy(Some(directory))
            }
            _ => Ok(Arc::clone(inherited)),
        }
    }

    /// Whether a directory called `name`, which `loaded` ignores, can have a configuration file in it that counts. Nothing
    /// of a project is in the directories of Git and Jujutsu.
    pub(crate) fn looks_for_configurations_in(&self, loaded: &Loaded, name: &[u8]) -> bool {
        loaded.flavor == Flavor::Oxlint
            && !self.has_one_configuration()
            && !self.options.disable_nested_config
            && !matches!(name, b".git" | b".jj")
    }

    /// Whether the rules that need types run on a file that has `config`, which is from `loaded`.
    pub(crate) fn wants_types(&self, loaded: &Loaded, config: &ResolvedConfig) -> bool {
        // oxlint reads `options` in the configuration of the working directory only.
        let of_the_run = || {
            let root = self.for_directory(self.cwd()).ok()?;
            root.wants_types
                .filter(|_| root.flavor == Flavor::Oxlint && loaded.flavor == Flavor::Oxlint)
        };
        self.options
            .type_aware
            .or_else(|| *self.wants_types.get_or_init(of_the_run))
            .or(loaded.wants_types)
            .unwrap_or(config.language.wants_types)
    }

    /// Whether `.gitignore` counts for what has the configuration `loaded`.
    pub(crate) fn reads_ignore_files(&self, loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint || (loaded.flavor == Flavor::BuiltIn && self.options.ignore)
    }

    /// The names of the ignore files that count in a directory, the one that overrides the other
    /// last.
    pub(crate) fn ignore_file_names(&self) -> &'static [&'static [u8]] {
        // `--ignore-path` names the file that is read instead.
        if self.options.ignore && self.options.ignore_path.is_none() {
            &[b".gitignore", b".eslintignore"]
        } else {
            &[b".gitignore"]
        }
    }

    /// Whether a file that is an argument is left out all the same, as by oxlint: `.eslintignore`
    /// or `--ignore-path` has a pattern for it. `.gitignore` is not asked.
    pub(crate) fn ignores_named_file(&self, path: &[u8], loaded: &Loaded) -> bool {
        if loaded.flavor != Flavor::Oxlint || !self.options.ignore {
            return false;
        }
        let file = self
            .options
            .ignore_path
            .as_deref()
            .map_or_else(|| b".eslintignore".to_vec(), paths::from_native);
        let file = paths::resolve(self.cwd(), &file);
        gitignore::is_ignored(
            &gitignore::with_file(None, paths::dirname(&file), &file, true),
            path,
            false,
        )
    }

    /// The ignore files that count in `directory`, where a search starts.
    pub(crate) fn ignore_files_at(&self, directory: &[u8], loaded: &Loaded) -> Chain {
        if !self.reads_ignore_files(loaded) {
            return None;
        }
        let mut chain = gitignore::above_and_in(directory, self.ignore_file_names());
        // For oxlint `--ignore-pattern` is for the whole run, whatever configuration file is nearest.
        let patterns = &self.options.ignore_pattern;
        if loaded.flavor == Flavor::Oxlint && self.options.ignore && !patterns.is_empty() {
            chain = gitignore::with_text(chain, self.cwd(), &patterns.join(&b'\n'), true);
        }
        match self
            .options
            .ignore_path
            .as_ref()
            .filter(|_| self.options.ignore)
        {
            Some(path) => gitignore::with_file(
                chain,
                self.cwd(),
                &paths::resolve(self.cwd(), &paths::from_native(path)),
                true,
            ),
            None => chain,
        }
    }

    pub(crate) fn environment(&self) -> &'l Environment<'l> {
        self.environment
    }
}
