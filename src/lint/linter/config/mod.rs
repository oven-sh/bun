//! The configuration of a run: ESLint's flat configuration, an array of objects of which those
//! that match a file are merged. `@eslint/config-array` and `lib/config` of ESLint.
//!
//! - [`Config::from_flat_json`]: an `eslint.config.*` that has been evaluated.
//! - [`Config::from_rc_json`]: `.oxlintrc.json`, `.eslintrc.json`.
//! - [`Config::get`]: the configuration of a file.
//!
//! # An evaluated `eslint.config.*` as JSON
//!
//! Whoever evaluates the file writes what it exports, after `await` and flattened, as
//!
//! ```jsonc
//! [
//!   {
//!     "name": "my/config",
//!     "basePath": "packages/a",
//!     "files": ["**/*.ts", ["src/**", "*.js"]],
//!     "ignores": ["dist/"],
//!     // The prefix of the rules, and `plugin.meta.name`, or `null` if it has none.
//!     "plugins": { "@typescript-eslint": "@typescript-eslint/eslint-plugin", "react": "eslint-plugin-react" },
//!     "language": "js/js",
//!     "languageOptions": {
//!       "ecmaVersion": 2022,
//!       "sourceType": "module",
//!       "globals": { "window": "readonly" },
//!       // `parser.meta.name`, with or without `@version`. See `LanguageOptions::from_json`.
//!       "parser": "typescript-eslint/parser",
//!       "parserOptions": { "projectService": true }
//!     },
//!     "linterOptions": { "reportUnusedDisableDirectives": "error" },
//!     // The name of the processor: the string, or `processor.meta.name`.
//!     "processor": "markdown/markdown",
//!     "rules": { "eqeqeq": ["error", "smart"] },
//!     "settings": {}
//!   }
//! ]
//! ```
//!
//! What JSON cannot express is written as `{ "$unserializable": "function" }`. In `files` and
//! `ignores` such a matcher never matches, and is noted in [`Config::notes`]. ESLint's own default
//! objects are not part of the array.

mod brace_expansion;
mod cache;
mod flat;
mod glob_part;
mod merge;
mod minimatch;
mod path;
mod presets;
mod rc;

use super::registry::Registry;
use super::resolved::{ConfiguredRule, LinterOptions, ResolvedConfig};
use crate::context::Severity;
use crate::language::LanguageOptions;
use crate::options::{Json, Options};
use cache::Cache;
pub use flat::ConfigError;
use merge::RuleSetting;
use minimatch::{Minimatch, split_path};
pub use rc::RcFlavor;
use std::sync::Arc;

#[doc(hidden)]
pub mod testing {
    use super::minimatch::Minimatch;

    /// `new Minimatch(pattern, { dot: true, flipNegate }).match(path, partial)`
    pub fn minimatch(pattern: &[u8], path: &[u8], flip_negate: bool, partial: bool) -> bool {
        Minimatch::new(pattern).matches_path(path, flip_negate, partial)
    }
}

/// `new Minimatch(pattern, { dot: true })`: a pattern as ESLint matches it, for the patterns on the
/// command line.
pub struct Glob(Minimatch);

impl Glob {
    pub fn new(pattern: &[u8]) -> Glob {
        Glob(Minimatch::new(pattern))
    }

    /// `match(path)`. `path` is separated by `/`.
    pub fn matches(&self, path: &[u8]) -> bool {
        self.0.matches_path(path, false, false)
    }

    /// `match(path, true)`: whether something in the directory `path` can match.
    pub fn matches_partially(&self, path: &[u8]) -> bool {
        self.0.matches_path(path, false, true)
    }
}

/// A pattern in `files` or `ignores`.
struct Pattern {
    matcher: Minimatch,
    /// It starts with `!`.
    is_negated: bool,
    /// `*`, `!..`, `../*`, `../**`: it does not make ESLint lint a file that nothing else matches.
    is_universal: bool,
}

impl Pattern {
    fn new(written: &[u8]) -> Pattern {
        // `normalizePattern`
        let normalized = match written {
            [b'.', b'/', rest @ ..] => rest.to_vec(),
            [b'!', b'.', b'/', rest @ ..] => [b"!", rest].concat(),
            written => written.to_vec(),
        };
        Pattern {
            matcher: Minimatch::new(&normalized),
            is_negated: normalized.starts_with(b"!"),
            is_universal: normalized == b"*"
                || normalized.starts_with(b"!")
                || normalized.ends_with(b"/*")
                || normalized.ends_with(b"/**"),
        }
    }
}

/// An element of the array.
struct ConfigObject {
    /// Absolute.
    base_path: Option<Vec<u8>>,
    /// One of these must match: all patterns of it.
    files: Option<Vec<Vec<Pattern>>>,
    ignores: Option<Vec<Pattern>>,
    /// It has `ignores` and nothing else: what it ignores is ignored altogether.
    is_global_ignores: bool,
    language_options: Json,
    linter_options: Json,
    settings: Json,
    rules: Vec<RuleSetting>,
    /// The prefixes of the plugins that are implemented here.
    plugins: Vec<Box<[u8]>>,
    /// The prefixes of the plugins that are not implemented here.
    foreign_plugins: Vec<Box<[u8]>>,
    /// The object is invalid: the message of ESLint, which it gives when the object is merged.
    error: Option<Vec<u8>>,
    language: Option<Box<[u8]>>,
    processor: Option<Box<[u8]>>,
}

impl Default for ConfigObject {
    fn default() -> Self {
        ConfigObject {
            base_path: None,
            files: None,
            ignores: None,
            is_global_ignores: false,
            language_options: Json::Null,
            linter_options: Json::Null,
            settings: Json::Null,
            rules: Vec::new(),
            plugins: Vec::new(),
            foreign_plugins: Vec::new(),
            error: None,
            language: None,
            processor: None,
        }
    }
}

/// What a configuration says about a file: ESLint's `getConfigWithStatus`.
#[derive(Clone)]
pub enum FileConfig {
    /// It is outside of the directory of the configuration.
    External,
    Ignored,
    /// No object with `files` matches it.
    Unconfigured,
    Matched(Arc<ResolvedConfig>),
}

/// The configuration of a run. All threads share it.
pub struct Config {
    base_path: Vec<u8>,
    objects: Vec<ConfigObject>,
    /// A rule setting that is only a severity keeps the options of the one it overrides.
    keeps_options: bool,
    /// Any plugin that is not implemented here counts as configured.
    accepts_all_plugins: bool,
    /// A rule of ESLint that typescript-eslint extends stands for the extension, as in oxlint.
    prefers_typescript_rules: bool,
    notes: Vec<Vec<u8>>,
    unknown_rules: Vec<Box<[u8]>>,
    cache: Cache,
}

/// `shouldIgnorePath` for the `ignores` of one object.
fn is_ignored_by(ignores: &[Pattern], path: &[&[u8]], mut is_ignored: bool) -> bool {
    for pattern in ignores {
        match (is_ignored, pattern.is_negated) {
            (false, false) => is_ignored = pattern.matcher.matches(path, false),
            (true, true) => is_ignored = !pattern.matcher.matches(path, true),
            _ => {}
        }
    }
    is_ignored
}

/// `pathMatches`
fn path_matches<'o>(
    files: impl IntoIterator<Item = &'o Vec<Pattern>>,
    ignores: Option<&[Pattern]>,
    path: &[&[u8]],
) -> bool {
    files.into_iter().any(|all| {
        all.iter()
            .all(|pattern| pattern.matcher.matches(path, false))
    }) && !ignores.is_some_and(|ignores| is_ignored_by(ignores, path, false))
}

impl Config {
    /// What could not be taken over from the configuration, for the user to read.
    pub fn notes(&self) -> &[Vec<u8>] {
        &self.notes
    }

    /// The rules that are configured, other than as `"off"`, and do not exist here. They are
    /// skipped.
    pub fn unknown_rules(&self) -> &[Box<[u8]>] {
        &self.unknown_rules
    }

    /// `shouldIgnorePath(this.ignores, ..)`. `relative` is relative to the base path, and ends with
    /// a slash if it is a directory.
    fn is_ignored_globally(&self, relative: &[u8]) -> bool {
        let parts = split_path(relative);
        let mut is_ignored = false;
        for object in self.objects.iter().filter(|it| it.is_global_ignores) {
            let ignores = object.ignores.as_deref().unwrap_or_default();
            let Some(base_path) = &object.base_path else {
                is_ignored = is_ignored_by(ignores, &parts, is_ignored);
                continue;
            };
            let mut own = path::relative(base_path, &path::resolve(&self.base_path, relative));
            if own.is_empty() || path::is_external(&own) {
                continue;
            }
            if relative.ends_with(b"/") {
                own.push(b'/');
            }
            is_ignored = is_ignored_by(ignores, &split_path(&own), is_ignored);
        }
        is_ignored
    }

    /// The directory that the patterns are relative to.
    pub fn base_path(&self) -> &[u8] {
        &self.base_path
    }

    /// [`Config::is_directory_ignored`] for a directory inside the base path of which it is known that
    /// no directory that it is in is ignored.
    pub fn is_directory_ignored_in(&self, directory: &[u8]) -> bool {
        let mut relative = path::relative(&self.base_path, directory);
        if relative.is_empty() {
            return false;
        }
        relative.push(b'/');
        self.is_ignored_globally(&relative)
    }

    /// Whether a file inside the base path is ignored, if the directory that it is in is not.
    pub fn is_file_ignored_in(&self, file: &[u8]) -> bool {
        self.is_ignored_globally(&path::relative(&self.base_path, file))
    }

    /// ESLint's `isDirectoryIgnored`. `directory` is absolute.
    pub fn is_directory_ignored(&self, directory: &[u8]) -> bool {
        let relative = path::relative(&self.base_path, directory);
        if relative.is_empty() {
            return false;
        }
        if path::is_external(&relative) {
            return true;
        }
        // A directory is ignored if one that it is in is.
        let mut end = 0;
        while end < relative.len() {
            end += bun_core::strings::index_of_char_usize(&relative[end..], b'/')
                .unwrap_or(relative.len() - end);
            if self.is_ignored_globally(&[&relative[..end], b"/"].concat()) {
                return true;
            }
            end += 1;
        }
        false
    }

    /// ESLint's `getConfigWithStatus`. `file` is absolute.
    pub fn get(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        let relative = path::relative(&self.base_path, file);
        if path::is_external(&relative) {
            return FileConfig::External;
        }
        if self.is_directory_ignored(path::dirname(file)) || self.is_ignored_globally(&relative) {
            return FileConfig::Ignored;
        }
        self.get_unless_ignored(registry, file)
    }

    /// The same for a file that is known not to be ignored, and to be inside the base path:
    /// whoever walks the directories has asked [`Config::is_directory_ignored`] on the way.
    pub fn get_unless_ignored(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        let relative = path::relative(&self.base_path, file);
        let parts = split_path(&relative);
        let mut matching: Vec<u32> = Vec::new();
        let mut is_matched = false;
        for (index, object) in self.objects.iter().enumerate() {
            let own = object
                .base_path
                .as_ref()
                .map(|base_path| path::relative(base_path, file));
            if own.as_ref().is_some_and(|it| path::is_external(it)) {
                continue;
            }
            let own_parts = own.as_ref().map(|it| split_path(it));
            let parts: &[&[u8]] = own_parts.as_ref().map_or(&parts, |it| &it[..]);
            let ignores = object.ignores.as_deref();
            let Some(files) = &object.files else {
                if !object.is_global_ignores
                    && !ignores.is_some_and(|it| is_ignored_by(it, parts, false))
                {
                    matching.push(index as u32);
                }
                continue;
            };
            let is_universal = |all: &&Vec<Pattern>| all.iter().all(|it| it.is_universal);
            if path_matches(files.iter().filter(|it| !is_universal(it)), ignores, parts) {
                matching.push(index as u32);
                is_matched = true;
            } else if path_matches(files.iter().filter(is_universal), ignores, parts) {
                matching.push(index as u32);
            }
        }
        if !is_matched {
            return FileConfig::Unconfigured;
        }
        FileConfig::Matched(
            self.cache
                .resolved(&matching, || self.merge(registry, &matching)),
        )
    }

    /// Merges the objects at `indices`, and does what the constructor of ESLint's `Config` does.
    fn merge(&self, registry: &Registry, indices: &[u32]) -> ResolvedConfig {
        let (mut language_options, mut settings) = (Json::Null, Json::Null);
        let mut linter = LinterOptions {
            report_unused_disable_directives: Severity::Off,
            ..LinterOptions::default()
        };
        let mut rules: Vec<RuleSetting> = Vec::new();
        let mut config = ResolvedConfig {
            skips_unknown_rules: self.accepts_all_plugins,
            prefers_typescript_rules: self.prefers_typescript_rules,
            understands_oxlint_comments: self.prefers_typescript_rules,
            ..ResolvedConfig::default()
        };
        let mut plugins: Vec<&Box<[u8]>> = Vec::new();
        for object in indices
            .iter()
            .filter_map(|index| self.objects.get(*index as usize))
        {
            if object.error.is_some() {
                config.error.clone_from(&object.error);
                return config;
            }
            plugins.extend(object.plugins.iter().chain(&object.foreign_plugins));
            merge::deep_merge_into(&mut language_options, &object.language_options);
            merge::deep_merge_into(&mut settings, &object.settings);
            linter.merge_json(&object.linter_options);
            merge::merge_rules(&mut rules, &object.rules, self.keeps_options);
            for plugin in &object.foreign_plugins {
                if !config.foreign_plugins.contains(plugin) {
                    config.foreign_plugins.push(plugin.clone());
                }
            }
            if object.language.is_some() {
                config.language_name.clone_from(&object.language);
            }
            if object.processor.is_some() {
                config.processor.clone_from(&object.processor);
            }
        }
        config.validate_language_options(&language_options);
        config.language = LanguageOptions::from_json(&language_options, &settings);
        config.linter = linter;
        for setting in rules {
            // ESLint's `throwRuleNotFoundError`, where it can be known that ESLint has no such rule.
            if setting.severity != Severity::Off
                && !self.accepts_all_plugins
                && config.error.is_none()
            {
                let problem = match &setting.plugin[..] {
                    b"" => super::registry::replacement_of(&setting.id).map(|replacement| {
                        let by =
                            bun_core::strings::replace_owned(replacement.as_bytes(), b", ", b",");
                        [
                            b"Rule \"",
                            &setting.id[..],
                            b"\" was removed and replaced by \"",
                            &by,
                            b"\".",
                        ]
                        .concat()
                    }),
                    plugin if plugins.iter().any(|it| ***it == *plugin) => None,
                    plugin => Some(
                        [b"Could not find plugin \"", plugin, b"\" in configuration."].concat(),
                    ),
                };
                if let Some(problem) = problem {
                    config.error = Some(
                        [b"Key \"rules\": Key \"", &setting.id[..], b"\": ", &problem].concat(),
                    );
                }
            }
            let Some(entry) = config.find_rule(registry, &setting.id) else {
                continue;
            };
            let options: Arc<[Json]> = setting.options.into();
            config.validate(entry, setting.severity, &options);
            let instance = (setting.severity != Severity::Off).then(|| {
                self.cache.rule(registry, entry, &options, || {
                    Arc::from((entry.build)(&Options::new(&options)))
                })
            });
            config.rules.push(ConfiguredRule::new(
                entry,
                setting.severity,
                options,
                instance,
            ));
        }
        // From here on: a rule that is turned off can be configured without its plugin.
        config.lacks_typescript_plugin =
            !self.accepts_all_plugins && !plugins.iter().any(|it| ***it == *b"@typescript-eslint");
        config
    }
}
