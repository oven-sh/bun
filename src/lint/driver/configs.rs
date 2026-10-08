//! Finds and reads the configuration files: ESLint's `ConfigLoader`.
//!
//! The configuration of a file is the nearest one: the first directory, from that of the file
//! upwards, that has a file of one of [`NAMES`]. If a directory has several, the first of the list
//! counts. Configurations are not merged.

use crate::cli::Options;
use crate::gitignore::{self, Chain};
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{Config, Linter, RcFlavor, ResolvedConfig};
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
    /// `.eslintrc.json`
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
const NAMES: [(&[u8], Flavor, Syntax); 11] = [
    (b"eslint.config.js", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.ts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cts", Flavor::Eslint, Syntax::Program),
    (b".oxlintrc.json", Flavor::Oxlint, Syntax::Json),
    (b".oxlintrc.jsonc", Flavor::Oxlint, Syntax::Json),
    (b"oxlint.config.ts", Flavor::Oxlint, Syntax::Program),
    (b".eslintrc.json", Flavor::EslintRc, Syntax::Json),
    (b".eslintrc", Flavor::EslintRc, Syntax::Json),
];

/// What is linted, and how, if there is no configuration file.
const BUILT_IN: &[u8] = br#"[
    { "ignores": ["**/.git/"] },
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

/// A configuration that has been read.
pub(crate) struct Loaded {
    pub(crate) config: Config,
    pub(crate) flavor: Flavor,
    /// `None`: there is no file.
    pub(crate) path: Option<Vec<u8>>,
    /// `options.typeAware` of an `.oxlintrc.json`.
    pub(crate) is_type_aware: bool,
}

pub(crate) type Found = Result<Arc<Loaded>, Fatal>;

pub(crate) struct Loader<'l> {
    pub(crate) linter: &'l Linter,
    options: &'l Options,
    environment: &'l Environment<'l>,
    /// By directory: the configuration of the files in it.
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// By the path of the file, which is empty for none. Each is read once, by the first to ask.
    by_file: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Found>>>>,
    /// For the user, in the order in which they came up.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
}

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    Json::Object(entries.into_iter().map(|(key, value)| (key.to_vec(), value)).collect())
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
    name.strip_prefix(b"eslint-plugin-").unwrap_or(name).to_vec()
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
        Json::Array(items) if depth < 64 => {
            Json::Array(items.into_iter().map(|item| without_global_ignores(item, depth + 1)).collect())
        }
        Json::Object(mut entries) => {
            let is_meta = |key: &[u8]| matches!(key, b"name" | b"basePath");
            if entries.iter().any(|it| it.0 == b"ignores") && entries.iter().filter(|it| !is_meta(&it.0)).count() == 1 {
                entries.retain(|it| it.0 != b"ignores");
            }
            Json::Object(entries)
        }
        json => json,
    }
}

/// The categories of oxlint's rules, but `nursery`.
const CATEGORIES: [&[u8]; 6] = [b"correctness", b"suspicious", b"pedantic", b"perf", b"style", b"restriction"];

/// oxlint's `-A`, `-W` and `-D`, which come after the `rules` of the file and before its
/// `overrides`. A category only counts for the rules that `rules` does not name.
fn apply_filters(entries: &mut Vec<(Vec<u8>, Json)>, filters: &[(Severity, Vec<u8>)]) {
    fn put(entries: &mut Vec<(Vec<u8>, Json)>, section: &[u8], key: &[u8], severity: Severity) {
        if !entries.iter().any(|it| it.0 == section && matches!(it.1, Json::Object(_))) {
            entries.retain(|it| it.0 != section);
            entries.push((section.to_vec(), Json::Object(Vec::new())));
        }
        let Some((_, Json::Object(section))) = entries.iter_mut().find(|it| it.0 == section) else {
            return;
        };
        match section.iter_mut().find(|it| it.0 == key) {
            // The options stay.
            Some((_, Json::Array(items))) if !items.is_empty() => items[0] = severity_name(severity),
            Some((_, value)) => *value = severity_name(severity),
            None => section.push((key.to_vec(), severity_name(severity))),
        }
    }
    for (severity, name) in filters {
        if name == b"all" {
            if *severity == Severity::Off {
                entries.retain(|it| it.0 != b"rules");
            }
            CATEGORIES.iter().for_each(|category| put(entries, b"categories", category, *severity));
        } else if CATEGORIES.contains(&&name[..]) || name == b"nursery" {
            put(entries, b"categories", name, *severity);
        } else {
            put(entries, b"rules", name, *severity);
        }
    }
}

impl<'l> Loader<'l> {
    pub(crate) fn new(linter: &'l Linter, options: &'l Options, environment: &'l Environment<'l>) -> Loader<'l> {
        Loader {
            linter,
            options,
            environment,
            by_directory: Guarded::new(FxHashMap::default()),
            by_file: Guarded::new(FxHashMap::default()),
            warnings: Guarded::new(Vec::new()),
        }
    }

    pub(crate) fn warn(&self, parts: &[&[u8]]) {
        let warning = parts.concat();
        let mut warnings = self.warnings.lock();
        if !warnings.contains(&warning) {
            warnings.push(warning);
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
            language_options.push((b"parserOptions", Json::Object(options.parser_options.clone())));
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
            linter_options.push((&b"reportUnusedDisableDirectives"[..], severity_name(Severity::Error)));
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
            let plugins = options.plugin.iter().map(|name| (plugin_shorthand(name), Json::String(name.clone())));
            first.push((b"plugins", Json::Object(plugins.collect())));
        }
        let mut all = vec![object(first)];
        if let Some(extensions) = &options.ext {
            let patterns = extensions.iter().map(|extension| {
                let dot: &[u8] = if extension.starts_with(b".") { b"" } else { b"." };
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
        Config::from_flat_json(self.linter.registry(), base_path, &all).map_err(|error| Fatal(error.message))
    }

    /// An `.oxlintrc.json` or `.eslintrc.json`, with what the command line adds.
    fn rc(&self, path: &[u8], mut json: Json, flavor: RcFlavor) -> Result<Config, Fatal> {
        let options = self.options;
        if let Json::Object(entries) = &mut json {
            let mut put = |key: &[u8], add: Vec<Json>| match entries.iter_mut().find(|it| it.0 == key) {
                Some((_, Json::Array(items))) => items.extend(add),
                Some((_, other)) => {
                    let first = std::mem::replace(other, Json::Null);
                    *other = Json::Array(std::iter::once(first).chain(add).collect());
                }
                None => entries.push((key.to_vec(), Json::Array(add))),
            };
            if !options.ignore_pattern.is_empty() {
                put(b"ignorePatterns", options.ignore_pattern.iter().cloned().map(Json::String).collect());
            }
            let mut last = vec![(&b"files"[..], Json::Array(vec![Json::String(b"**/*".to_vec())]))];
            if !options.rule.is_empty() {
                last.push((b"rules", Json::Object(options.rule.clone())));
            }
            if let Some(globals) = globals_of(options) {
                last.push((b"globals", globals));
            }
            if !options.parser_options.is_empty() {
                last.push((b"parserOptions", Json::Object(options.parser_options.clone())));
            }
            if last.len() > 1 {
                put(b"overrides", vec![object(last)]);
            }
            if !options.ignore {
                entries.retain(|it| it.0 != b"ignorePatterns");
            }
            apply_filters(entries, &options.filters);
            let unused = match options.report_unused_disable_directives {
                true => Some(Severity::Error),
                false => options.report_unused_disable_directives_severity,
            };
            if let Some(severity) = unused {
                entries.retain(|it| it.0 != b"reportUnusedDisableDirectives");
                entries.push((b"reportUnusedDisableDirectives".to_vec(), severity_name(severity)));
            }
        }
        let mut load = |directory: &[u8], name: &[u8]| bun_lint::json::parse(&fs::read(&paths::resolve(directory, name)).ok()?);
        Config::from_rc_json(self.linter.registry(), paths::dirname(path), &json, flavor, &mut load)
            .map_err(|error| Fatal([b"Cannot use the configuration file ", path, b":\n", &error.message[..]].concat()))
    }

    fn built_in(&self) -> Found {
        let preset: &[u8] = match self.options.type_aware {
            Some(true) => b"recommended-type-checked",
            _ => b"recommended",
        };
        let text = strings::replace_owned(BUILT_IN, b"TYPESCRIPT", preset);
        let root = paths::ancestors(self.cwd()).last().unwrap_or(b"/");
        Ok(Arc::new(Loaded {
            config: self.flat(root, bun_lint::json::parse(&text).unwrap_or(Json::Null))?,
            flavor: Flavor::BuiltIn,
            path: None,
            is_type_aware: false,
        }))
    }

    /// Reads the configuration file at `path`. `base_path`: what the patterns of a flat
    /// configuration are relative to.
    fn read(&self, path: &[u8], base_path: &[u8]) -> Found {
        let name = paths::basename(path);
        let known = NAMES.iter().find(|it| it.0 == name).map(|it| (it.1, it.2));
        let is_json = name.ends_with(b".json") || name.ends_with(b".jsonc");
        let syntax = known.map_or(if is_json { Syntax::Json } else { Syntax::Program }, |it| it.1);
        let json = match syntax {
            Syntax::Program => {
                let is_oxlint = known.is_some_and(|it| it.0 == Flavor::Oxlint);
                crate::evaluate::evaluate(self, path, is_oxlint)?
            }
            Syntax::Json => {
                let text = fs::read(path).map_err(|error| {
                    Fatal([b"Cannot read the configuration file ", path, b": ", &fs::describe(&error)].concat())
                })?;
                bun_lint::json::parse(&text)
                    .ok_or_else(|| Fatal([b"The configuration file ", path, b" is not valid JSON."].concat()))?
            }
        };
        // A file by another name is what it looks like.
        let flavor = known.map_or_else(
            || match (&json, syntax) {
                (Json::Object(_), Syntax::Json) => Flavor::Oxlint,
                _ => Flavor::Eslint,
            },
            |it| it.0,
        );
        let is_type_aware = json.get(b"options").and_then(|it| it.get(b"typeAware")).and_then(Json::as_bool) == Some(true);
        let config = match flavor {
            Flavor::Eslint | Flavor::BuiltIn => {
                let is_empty = match &json {
                    Json::Null => true,
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
                self.flat(base_path, if is_empty { Json::Array(Vec::new()) } else { json })?
            }
            Flavor::Oxlint => self.rc(path, json, RcFlavor::Oxlint)?,
            Flavor::EslintRc => self.rc(path, json, RcFlavor::Eslint)?,
        };
        for note in config.notes() {
            self.warn(&[note]);
        }
        self.warn_about_unknown_rules(&config);
        Ok(Arc::new(Loaded {
            config,
            flavor,
            path: Some(path.to_vec()),
            is_type_aware: is_type_aware && flavor == Flavor::Oxlint,
        }))
    }

    /// One line for each plugin that has rules which are configured and do not exist here.
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
                b"@typescript-eslint" | b"typescript" | b"typescript-eslint" => b"typescript-eslint".to_vec(),
                plugin => [b"the plugin \"", plugin, b"\""].concat(),
            };
            match rules[..] {
                [only] => self.warn(&[b"1 rule of ", &of, b" is not supported yet and was skipped: ", only]),
                _ => self.warn(&[&count, b" rules of ", &of, b" are not supported yet and were skipped"]),
            }
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
                path: None,
                is_type_aware: false,
            })),
            b"" => self.built_in(),
            path => self.read(path, base_path),
        })
        .clone()
    }

    /// The name of the configuration file among `names`, which are those of a directory.
    fn pick<'n>(names: impl Iterator<Item = &'n [u8]>) -> Option<&'static [u8]> {
        let candidates = names.filter(|name| name.starts_with(b"eslint.") || name.starts_with(b".") || name.starts_with(b"oxlint."));
        let best = candidates.filter_map(|name| NAMES.iter().position(|it| it.0 == name)).min()?;
        Some(NAMES[best].0)
    }

    /// The configuration of the files that are in `directory`: ESLint's `loadConfigArrayForFile`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        if self.has_one_configuration() {
            return match &self.options.config {
                Some(path) => self.load(&paths::resolve(self.cwd(), &paths::from_native(path)), self.cwd()),
                None => self.load(b"", self.cwd()),
            };
        }
        let mut asked: Vec<&[u8]> = Vec::new();
        let mut found = None;
        for ancestor in paths::ancestors(directory) {
            if let Some(known) = self.by_directory.lock().get(ancestor) {
                found = Some(known.clone());
                break;
            }
            asked.push(ancestor);
            let name = NAMES.iter().map(|it| it.0).find(|name| fs::is_file(&paths::join(ancestor, name)));
            if let Some(name) = name {
                found = Some(self.load(&paths::join(ancestor, name), ancestor));
                break;
            }
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
        if self.has_one_configuration() {
            return Ok(Arc::clone(inherited));
        }
        match Self::pick(names) {
            Some(name) => self.load(&paths::join(directory, name), directory),
            None => Ok(Arc::clone(inherited)),
        }
    }

    /// Whether the rules that need types run on a file that has `config`, which is from `loaded`.
    pub(crate) fn wants_types(&self, loaded: &Loaded, config: &ResolvedConfig) -> bool {
        self.options.type_aware.unwrap_or(match loaded.flavor {
            Flavor::Eslint | Flavor::EslintRc => config.language.wants_types,
            Flavor::Oxlint => loaded.is_type_aware,
            Flavor::BuiltIn => false,
        })
    }

    /// Whether `.gitignore` counts for what has the configuration `loaded`.
    pub(crate) fn reads_ignore_files(&self, loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint && self.options.ignore
    }

    /// The ignore files that count in `directory`, where a search starts.
    pub(crate) fn ignore_files_at(&self, directory: &[u8], loaded: &Loaded) -> Chain {
        if !self.reads_ignore_files(loaded) {
            return None;
        }
        let chain = gitignore::above_and_in(directory);
        match &self.options.ignore_path {
            Some(path) => gitignore::with_file(chain, self.cwd(), &paths::resolve(self.cwd(), &paths::from_native(path))),
            None => chain,
        }
    }

    pub(crate) fn environment(&self) -> &'l Environment<'l> {
        self.environment
    }
}
