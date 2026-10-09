//! The configuration of a run: ESLint's flat configuration, an array of objects of which those
//! that match a file are merged. `@eslint/config-array` and `lib/config` of ESLint.
//!
//! - [`Config::from_flat_json`]: an `eslint.config.*` that has been evaluated.
//! - [`Config::from_rc_json`]: an `.oxlintrc.json`.
//! - [`Config::from_legacy`]: the files of ESLint 8, with all that they extend and the files above them.
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
//!     // With `settings`: the file, and which object this is of what it exports.
//!     "$source": { "config": "/app/eslint.config.js", "index": 3 },
//!     // With `languageOptions.parser`: see `describeParser` in `evaluate-eslint.js`.
//!     "$parser": { "module": "/app/node_modules/@typescript-eslint/parser/dist/index.js", "export": [], "functions": ["parse", "parseForESLint"], "values": { "version": "8.0.0" } },
//!     // Where it is: see `js_plugin::Processor::new`.
//!     "$processor": { "plugin": { "module": "/app/node_modules/@eslint/markdown/dist/index.js", "export": ["default"] }, "prefix": "markdown", "name": "markdown" },
//!     "rules": { "eqeqeq": ["error", "smart"] },
//!     "settings": {}
//!   }
//! ]
//! ```
//!
//! What JSON cannot express is written as `{ "$unserializable": "function" }`. In `files` and
//! `ignores` such a matcher is an error: which files it is for cannot be told. ESLint's own default
//! objects are not part of the array.

mod brace_expansion;
mod cache;
pub(crate) mod eslint8;
mod eslintrc;
mod fast_glob;
mod flat;
mod for_eslint;
mod glob_part;
mod merge;
mod minimatch;
mod number_of_rules;
mod path;
mod presets;
mod rc;
mod shape;

use super::globals::Tables;
use super::registry::Registry;
use super::resolved::{
    ConfiguredJsRule, ConfiguredRule, LinterOptions, ResolvedConfig, find_js_rule,
};
use super::schema;
use crate::context::Severity;
use crate::js_plugin;
use crate::language::LanguageOptions;
use crate::options::{Json, Options};
use crate::rule::{Meta, Plugin};
use crate::runner::RuleEntry;
use bun_core::strings;
use cache::Cache;
pub use eslintrc::{Eslint8, LegacyFailure, LegacyFile, LegacyKind, LegacyOptions, LoadLegacy};
pub use fast_glob::FastGlob;
use fast_glob::Matcher;
pub use flat::{ConfigError, LoadLocatedPlugin};
use merge::RuleSetting;
use minimatch::{How, Minimatch, SplitPath};
pub(crate) use rc::is_rule_of_oxlint;
pub use rc::{LoadPlugin, oxlint_category, oxlint_runs_on};
pub(crate) use rc::{OxlintChanges, oxlint_changes};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::sync::Arc;

#[doc(hidden)]
pub mod testing {
    use super::minimatch::{How, Minimatch};

    /// `new Minimatch(pattern, { dot: true, flipNegate }).match(path, partial)`
    pub fn minimatch(pattern: &[u8], path: &[u8], flip_negate: bool, partial: bool) -> bool {
        Minimatch::new(pattern).matches_path(
            path,
            How {
                flip_negate,
                partial,
            },
        )
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
        self.0.matches_path(path, How::default())
    }

    /// `match(path, true)`: whether something in the directory `path` can match.
    pub fn matches_partially(&self, path: &[u8]) -> bool {
        self.0.matches_path(
            path,
            How {
                partial: true,
                ..How::default()
            },
        )
    }
}

/// A pattern in `files` or `ignores`.
struct Pattern {
    matcher: Matcher,
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
            matcher: Matcher::Minimatch(Minimatch::new(&normalized)),
            is_negated: normalized.starts_with(b"!"),
            is_universal: normalized == b"*"
                || normalized.starts_with(b"!")
                || normalized.ends_with(b"/*")
                || normalized.ends_with(b"/**"),
        }
    }

    /// An element of `files` or `excludeFiles` of an override of oxlint. A `!` at its start makes it match what it would not
    /// match without, and takes nothing back. oxlint lints a file for what it is called, not because an override is for it.
    fn of_oxlint(written: &[u8]) -> Pattern {
        Pattern {
            matcher: Matcher::FastGlob(FastGlob::new(written)),
            is_negated: false,
            is_universal: true,
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
    /// `ignorePatterns` of oxlint, which say nothing about what is outside of the base path.
    ignores_inside_only: bool,
    language_options: Json,
    linter_options: Json,
    settings: Json,
    rules: Vec<RuleSetting>,
    /// The prefixes of the plugins that are implemented here.
    plugins: Vec<Box<[u8]>>,
    /// The prefixes of the plugins that are not implemented here.
    foreign_plugins: Vec<Box<[u8]>>,
    /// All of them as `--print-config` has them: `prefix:name@version`, or the prefix of one that does not say what it is called.
    printed_plugins: Vec<Box<[u8]>>,
    /// The object is invalid: the message of ESLint, which it gives when the object is merged.
    error: Option<Vec<u8>>,
    language: Option<Box<[u8]>>,
    processor: Option<Box<[u8]>>,
    /// `$processor`
    processor_location: Option<Arc<js_plugin::Processor>>,
    /// `$source`: `{ config, index }`, the configuration file, and which object this is of what it exports. One with `settings`
    /// has it.
    source: Option<Json>,
    /// `$parser`
    parser_location: Option<Json>,
    /// `$changesLinter`: see [`ResolvedConfig::changes_linter`].
    changes_linter: bool,
    /// Of an override of oxlint that has `plugins`: those, and those of the files, as sets. The settings at the start of its
    /// `rules` that yield are what `categories` turn on.
    plugins_of_override: Option<(u32, u32)>,
}

impl Default for ConfigObject {
    fn default() -> Self {
        ConfigObject {
            base_path: None,
            files: None,
            ignores: None,
            is_global_ignores: false,
            ignores_inside_only: false,
            language_options: Json::Null,
            linter_options: Json::Null,
            settings: Json::Null,
            rules: Vec::new(),
            plugins: Vec::new(),
            foreign_plugins: Vec::new(),
            printed_plugins: Vec::new(),
            error: None,
            language: None,
            processor: None,
            processor_location: None,
            source: None,
            parser_location: None,
            changes_linter: false,
            plugins_of_override: None,
        }
    }
}

/// What is found for an argument of ESLint 8 in which a name starts with a dot (`.storybook`, `.*.js`) is not ignored for such a
/// name: its `dotfiles`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Dotfiles {
    AsConfigured,
    Linted,
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

/// Which elements of the `files` of all objects can match a file, by what its path starts with. Most patterns of `overrides` name
/// a directory first, and most files are in none of these.
#[derive(Default)]
struct Heads {
    /// The elements of which a pattern starts with these names, without magic, each with its object.
    by_head: FxHashMap<Box<[u8]>, SmallVec<[(u32, u32); 2]>>,
    /// For each element: all that it can match starts with one of the keys that have it.
    is_listed: Vec<bool>,
    /// For each object, the number of its first element, and whether all of its elements are listed.
    objects: Vec<(u32, bool)>,
}

type Bits = SmallVec<[u64; 4]>;

fn has_bit(bits: &Bits, index: usize) -> bool {
    bits[index / 64] & (1 << (index % 64)) != 0
}

/// What is listed for a path: a bit for each element, and one for each object.
struct Listed {
    elements: Bits,
    objects: Bits,
}

/// What a path starts with that all of `patterns` match. One of them that says so is enough.
fn heads_of(patterns: &[Pattern]) -> Option<Vec<&[u8]>> {
    (patterns.iter()).find_map(|it| it.matcher.heads())
}

impl Heads {
    fn new(objects: &[ConfigObject]) -> Heads {
        let mut heads = Heads::default();
        for (index, object) in objects.iter().enumerate() {
            let first = heads.is_listed.len();
            for patterns in object.files.iter().flatten() {
                let element = heads.is_listed.len() as u32;
                let of_element = heads_of(patterns).filter(|_| object.base_path.is_none());
                heads.is_listed.push(of_element.is_some());
                for head in of_element.into_iter().flatten() {
                    let listed = heads.by_head.entry(head.into()).or_default();
                    if listed.last() != Some(&(element, index as u32)) {
                        listed.push((element, index as u32));
                    }
                }
            }
            let are_all_listed =
                object.files.is_some() && heads.is_listed[first..].iter().all(|it| *it);
            heads.objects.push((first as u32, are_all_listed));
        }
        heads
    }

    /// What is listed for what `path` starts with. `None`: it cannot be told.
    fn of(&self, path: &[u8]) -> Option<Listed> {
        if self.by_head.is_empty() || bun_core::strings::contains(path, b"//") {
            return None;
        }
        let mut found = Listed {
            elements: smallvec::smallvec![0; self.is_listed.len().div_ceil(64)],
            objects: smallvec::smallvec![0; self.objects.len().div_ceil(64)],
        };
        let mut look_up = |head: &[u8]| {
            for &(element, object) in self.by_head.get(head).into_iter().flatten() {
                found.elements[element as usize / 64] |= 1 << (element % 64);
                found.objects[object as usize / 64] |= 1 << (object % 64);
            }
        };
        for (at, &byte) in path.iter().enumerate() {
            if byte == b'/' {
                look_up(&path[..at]);
            }
        }
        look_up(path);
        Some(found)
    }

    /// Whether `files` of `object` can match the path that `found` is for.
    fn allows_object(&self, found: &Listed, object: usize) -> bool {
        !self.objects[object].1 || has_bit(&found.objects, object)
    }

    /// The same for its `nth` element.
    fn allows(&self, found: &Listed, object: usize, nth: usize) -> bool {
        let element = self.objects[object].0 as usize + nth;
        !self.is_listed[element] || has_bit(&found.elements, element)
    }
}

/// The configuration of a run. All threads share it.
pub struct Config {
    base_path: Vec<u8>,
    objects: Vec<ConfigObject>,
    /// A rule setting that is only a severity keeps the options of the one it overrides.
    keeps_options: bool,
    /// Any plugin that is not implemented here counts as configured.
    accepts_all_plugins: bool,
    /// It is made of the files of ESLint 8.
    is_legacy: bool,
    /// `--no-ignore` of ESLint 8: a file that is named is linted, whatever ignores it. What is found in a directory is not.
    lints_all_that_is_named: bool,
    /// Which object has the patterns with which ESLint 8 ignores what starts with a dot.
    dot_patterns: Option<usize>,
    /// A rule of ESLint that typescript-eslint extends stands for the extension, as in oxlint.
    prefers_typescript_rules: bool,
    /// `options` of an `.oxlintrc.json` and of what it extends.
    options_of_oxlint: Vec<(Vec<u8>, Json)>,
    /// [`Config::printed_for_oxlint`]
    printed_for_oxlint: Vec<(Vec<u8>, Json)>,
    notes: Vec<Vec<u8>>,
    unknown_rules: Vec<Box<[u8]>>,
    js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// `$jsPlugins`: where the plugin with a prefix is.
    js_locations: Vec<(Box<[u8]>, Json)>,
    heads: Heads,
    cache: Cache,
}

/// `shouldIgnorePath` for the `ignores` of one object.
fn is_ignored_by(ignores: &[Pattern], path: &SplitPath, mut is_ignored: bool) -> bool {
    for pattern in ignores {
        match (is_ignored, pattern.is_negated) {
            (false, false) => is_ignored = pattern.matcher.matches(path, false),
            (true, true) => is_ignored = !pattern.matcher.matches(path, true),
            _ => {}
        }
    }
    is_ignored
}

/// What the `ignorePatterns` of an `.oxlintrc.json` say about `path`: the last of them that matches it counts. `None`: none does.
fn last_match(ignores: &[Pattern], path: &[u8]) -> Option<bool> {
    let parts = SplitPath::new(path);
    let mut patterns = ignores.iter().rev();
    Some(
        !patterns
            .find(|it| it.matcher.matches(&parts, true))?
            .is_negated,
    )
}

/// `Gitignore::matched_path_or_any_parents` of the crate `ignore`, which oxlint asks: what is said about `path`, or else about the
/// nearest directory that it is in about which anything is said. So a `!` takes a file out of a directory that is ignored, which it
/// cannot in a `.gitignore`.
fn last_match_or_of_parents(ignores: &[Pattern], mut path: &[u8]) -> Option<bool> {
    loop {
        if let Some(found) = last_match(ignores, path) {
            return Some(found);
        }
        let inner = path.strip_suffix(b"/").unwrap_or(path);
        path = inner.get(..=strings::last_index_of_char(inner, b'/')?)?;
    }
}

/// [`is_ignored_by`] for `ignorePatterns` with a `!`. A directory in which a `!` can match is not ignored: it has to be read.
fn is_ignored_by_oxlint(ignores: &[Pattern], path: &[u8], is_ignored: bool) -> bool {
    let can_hold_exceptions = |directory: &[u8]| {
        let how = How {
            flip_negate: true,
            partial: true,
        };
        let mut exceptions = ignores.iter().filter(|it| it.is_negated);
        exceptions.any(|it| it.matcher.matches_path(directory, how))
    };
    match (
        last_match_or_of_parents(ignores, path),
        path.strip_suffix(b"/"),
    ) {
        (Some(true), Some(directory)) => !can_hold_exceptions(directory),
        (found, _) => found.unwrap_or(is_ignored),
    }
}

/// `pathMatches`
fn path_matches<'o>(
    files: impl IntoIterator<Item = &'o Vec<Pattern>>,
    ignores: Option<&[Pattern]>,
    path: &SplitPath,
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

    /// What oxlint's `--print-config` prints, if it is made of an `.oxlintrc.json`.
    pub fn printed_for_oxlint(&self) -> Json {
        Json::Object(self.printed_for_oxlint.clone())
    }

    /// `options[name]` of an `.oxlintrc.json`, or else of what it extends.
    pub fn option_of_oxlint(&self, name: &[u8]) -> Option<&Json> {
        let mut options = self.options_of_oxlint.iter();
        Some(&options.find(|it| it.0 == name)?.1)
    }

    /// The rules that are configured, other than as `"off"`, and do not exist here. They are
    /// skipped.
    pub fn unknown_rules(&self) -> &[Box<[u8]>] {
        &self.unknown_rules
    }

    /// `shouldIgnorePath(this.ignores, ..)`. `relative` is relative to the base path, and ends with
    /// a slash if it is a directory.
    fn is_ignored_globally(&self, relative: &[u8], dotfiles: Dotfiles) -> bool {
        let parts = SplitPath::new(relative);
        let mut is_ignored = false;
        // See `Config::relative`.
        let is_outside = relative.starts_with(b"/");
        let skipped = self.dot_patterns.filter(|_| dotfiles == Dotfiles::Linted);
        let objects = self.objects.iter().enumerate();
        for (index, object) in objects.filter(|it| it.1.is_global_ignores) {
            if is_outside && object.ignores_inside_only || skipped == Some(index) {
                continue;
            }
            let ignores = object.ignores.as_deref().unwrap_or_default();
            let has_exceptions =
                object.ignores_inside_only && ignores.iter().any(|it| it.is_negated);
            let Some(base_path) = &object.base_path else {
                is_ignored = match has_exceptions {
                    true => is_ignored_by_oxlint(ignores, relative, is_ignored),
                    false => is_ignored_by(ignores, &parts, is_ignored),
                };
                continue;
            };
            let mut own = path::relative(base_path, &path::resolve(&self.base_path, relative));
            if own.is_empty() || path::is_external(&own) {
                continue;
            }
            if relative.ends_with(b"/") {
                own.push(b'/');
            }
            is_ignored = match has_exceptions {
                true => is_ignored_by_oxlint(ignores, &own, is_ignored),
                false => is_ignored_by(ignores, &SplitPath::new(&own), is_ignored),
            };
        }
        is_ignored
    }

    /// What the patterns see of `path`, which is absolute: it is relative to the base path. For oxlint nothing is outside of
    /// a configuration: what is not in the base path is matched by its absolute path.
    fn relative(&self, path: &[u8]) -> Vec<u8> {
        let relative = path::relative(&self.base_path, path);
        match self.prefers_typescript_rules && path::is_external(&relative) {
            true => path::rooted(path),
            false => relative,
        }
    }

    /// [`Config::is_directory_ignored`] for a directory inside the base path of which it is known that
    /// no directory that it is in is ignored.
    pub fn is_directory_ignored_in(&self, directory: &[u8], dotfiles: Dotfiles) -> bool {
        let mut relative = self.relative(directory);
        if relative.is_empty() {
            return false;
        }
        relative.push(b'/');
        self.is_ignored_globally(&relative, dotfiles)
    }

    /// Whether a file inside the base path is ignored, if the directory that it is in is not.
    pub fn is_file_ignored_in(&self, file: &[u8], dotfiles: Dotfiles) -> bool {
        self.is_ignored_globally(&self.relative(file), dotfiles)
    }

    /// ESLint's `isDirectoryIgnored`. `directory` is absolute.
    pub fn is_directory_ignored(&self, directory: &[u8], dotfiles: Dotfiles) -> bool {
        let relative = self.relative(directory);
        if relative.is_empty() {
            return false;
        }
        if path::is_external(&relative) {
            return true;
        }
        // A directory is ignored if one that it is in is.
        let mut end = usize::from(relative.starts_with(b"/"));
        while end < relative.len() {
            end += bun_core::strings::index_of_char_usize(&relative[end..], b'/')
                .unwrap_or(relative.len() - end);
            if self.is_ignored_globally(&[&relative[..end], b"/"].concat(), dotfiles) {
                return true;
            }
            end += 1;
        }
        false
    }

    /// ESLint's `getConfigWithStatus`. `file` is absolute.
    pub fn get(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        let relative = self.relative(file);
        if path::is_external(&relative) {
            return FileConfig::External;
        }
        let is_ignored = || {
            self.is_directory_ignored(path::dirname(file), Dotfiles::AsConfigured)
                || self.is_ignored_globally(&relative, Dotfiles::AsConfigured)
        };
        if !self.lints_all_that_is_named && is_ignored() {
            return FileConfig::Ignored;
        }
        // ESLint 8 lints what it is told to, whatever it is called.
        self.get_if(registry, file, !self.is_legacy)
    }

    /// The same for a file that is known not to be ignored, and to be inside the base path:
    /// whoever walks the directories has asked [`Config::is_directory_ignored`] on the way.
    pub fn get_unless_ignored(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        self.get_if(registry, file, true)
    }

    /// The same for a file that a pattern among the arguments matches. ESLint 8 lints that, whatever it is called.
    pub fn get_for_pattern(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        self.get_if(registry, file, !self.is_legacy)
    }

    /// `must_match`: a file that no `files` is for has no configuration.
    fn get_if(&self, registry: &Registry, file: &[u8], must_match: bool) -> FileConfig {
        let relative = self.relative(file);
        let parts = SplitPath::new(&relative);
        let mut matching: Vec<u32> = Vec::new();
        let mut is_matched = false;
        let listed = self.heads.of(&relative);
        for (index, object) in self.objects.iter().enumerate() {
            if (listed.as_ref()).is_some_and(|found| !self.heads.allows_object(found, index)) {
                continue;
            }
            let own = object
                .base_path
                .as_ref()
                .map(|base_path| path::relative(base_path, file));
            if own.as_ref().is_some_and(|it| path::is_external(it)) {
                continue;
            }
            let ignores = object.ignores.as_deref();
            // Whether the object applies, and whether that makes ESLint lint the file.
            let status = |parts: &SplitPath| -> (bool, bool) {
                let Some(files) = &object.files else {
                    let is_ignored = ignores.is_some_and(|it| is_ignored_by(it, parts, false));
                    return (!object.is_global_ignores && !is_ignored, false);
                };
                let can_match = (files.iter().enumerate())
                    .filter(|it| {
                        (listed.as_ref()).is_none_or(|found| self.heads.allows(found, index, it.0))
                    })
                    .map(|it| it.1);
                let is_universal = |all: &&Vec<Pattern>| all.iter().all(|it| it.is_universal);
                match path_matches(
                    can_match.clone().filter(|it| !is_universal(it)),
                    ignores,
                    parts,
                ) {
                    true => (true, true),
                    false => (
                        path_matches(can_match.filter(is_universal), ignores, parts),
                        false,
                    ),
                }
            };
            let (applies, is_linted) = match &own {
                Some(own) => status(&SplitPath::new(own)),
                None => status(&parts),
            };
            if applies {
                matching.push(index as u32);
            }
            is_matched |= is_linted;
        }
        if !is_matched && must_match {
            return FileConfig::Unconfigured;
        }
        FileConfig::Matched(
            self.cache
                .resolved(&matching, || self.merge(registry, &matching)),
        )
    }

    /// [`ConfiguredRule::reported_as`]. `written_for`: the plugin that the configuration names the rule with.
    fn reported_as(
        &self,
        registry: &Registry,
        entry: &'static RuleEntry,
        written_for: Option<Plugin>,
    ) -> &'static Meta {
        let meta = entry.meta;
        let is_extension =
            meta.plugin == Plugin::TypeScript && meta.extends_base_rule == Some(meta.name);
        if !self.prefers_typescript_rules || !is_extension {
            return meta;
        }
        // A few are in both plugins.
        let is_in = |plugin: Plugin| oxlint_category(plugin, meta.name).is_some();
        if !is_in(Plugin::Eslint)
            || is_in(Plugin::TypeScript) && written_for == Some(Plugin::TypeScript)
        {
            return meta;
        }
        (registry.get(Plugin::Eslint, meta.name.as_bytes())).map_or(meta, |it| it.meta)
    }

    /// ESLint's `throwRuleNotFoundError` for a plugin that is there. `plugins`: the prefixes of those that the file has.
    fn missing_js_rule(&self, registry: &Registry, id: &[u8], plugins: &[&[u8]]) -> Vec<u8> {
        let (prefix, name) = super::registry::parse_rule_id(id);
        let has_it = |other: &&&[u8]| match **other {
            b"@" => registry.get(Plugin::Eslint, name).is_some(),
            other => match find_js_rule(&self.js_plugins, &[other, b"/", name].concat()) {
                Some(found) => found.is_some(),
                None => Plugin::of_prefix(other).is_some_and(|it| registry.get(it, name).is_some()),
            },
        };
        let mut message = [
            b"Key \"rules\": Key \"",
            id,
            b"\": Could not find \"",
            name,
            b"\" in plugin \"",
            prefix,
            b"\".",
        ]
        .concat();
        if let Some(&other) = plugins.iter().find(has_it) {
            message.extend_from_slice(&[b" Did you mean \"", other, b"/", name, b"\"?"].concat());
        }
        message
    }

    /// What ESLint, or oxlint, says about options that the schema of a rule of a JavaScript plugin does not allow.
    /// `lines`: of [`schema::validate_js`].
    fn js_options_error(&self, rule: &js_plugin::Rule, options: &[Json], lines: &[u8]) -> Vec<u8> {
        if !self.prefers_typescript_rules {
            return [b"Key \"rules\": Key \"", &rule.id[..], b"\":\n", lines].concat();
        }
        let start: &[u8] = b"Failed to setup JS plugin options:\nError: ";
        if rule.schema == js_plugin::Schema::None {
            return [start, b"Rule '", &rule.id, b"' does not accept options"].concat();
        }
        let mut printed = Vec::new();
        let options = Json::Array(schema::with_js_defaults(rule, options));
        super::message::write_json_indented(&mut printed, &options, 0);
        [
            start,
            b"Options validation failed for rule '",
            &rule.id,
            b"':\nOptions:\n",
            &printed,
            b"\nErrors:\n",
            super::space::trim_end(lines),
        ]
        .concat()
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
        let mut plugins: Vec<&[u8]> = Vec::new();
        // In oxlint `categories` say something about the plugins that overrides add only if one of the overrides names other
        // plugins than all that are on for the file.
        let of_overrides = || {
            let objects = indices.iter();
            objects.filter_map(|index| self.objects.get(*index as usize)?.plugins_of_override)
        };
        let all_plugins = of_overrides().fold(0, |all, (own, of_files)| all | own | of_files);
        let have_categories = of_overrides().any(|(own, _)| own != all_plugins);
        for object in indices
            .iter()
            .filter_map(|index| self.objects.get(*index as usize))
        {
            if object.error.is_some() {
                config.error.clone_from(&object.error);
                return config;
            }
            let of_object = object.plugins.iter().chain(&object.foreign_plugins);
            plugins.extend(of_object.map(|it| &it[..]));
            let merge_into = match self.is_legacy {
                true => eslintrc::merge_into,
                false => merge::deep_merge_into,
            };
            merge_into(&mut language_options, &object.language_options);
            merge_into(&mut settings, &object.settings);
            linter.merge_json(&object.linter_options);
            match self.is_legacy {
                true => eslintrc::merge_rules(&mut rules, &object.rules),
                false => {
                    let skipped = match object.plugins_of_override.is_some() && !have_categories {
                        true => object.rules.iter().take_while(|it| it.yields).count(),
                        false => 0,
                    };
                    let settings = object.rules.get(skipped..).unwrap_or_default();
                    merge::merge_rules(&mut rules, settings, self.keeps_options);
                }
            }
            for plugin in &object.foreign_plugins {
                if !config.foreign_plugins.contains(plugin) {
                    config.foreign_plugins.push(plugin.clone());
                }
            }
            for plugin in &object.printed_plugins {
                if !config.printed_plugins.contains(plugin) {
                    config.printed_plugins.push(plugin.clone());
                }
            }
            if object.language.is_some() {
                config.language_name.clone_from(&object.language);
            }
            if object.processor.is_some() {
                config.processor.clone_from(&object.processor);
                (config.processor_location).clone_from(&object.processor_location);
            }
        }
        let eslint_8 = match (self.is_legacy).then(|| eslintrc::resolve(&mut language_options)) {
            Some(Ok(eslint_8)) => Some(Arc::new(eslint_8)),
            Some(Err(message)) => {
                config.error = Some(message);
                return config;
            }
            None => None,
        };
        // Another language validates its own.
        if config.is_javascript() {
            config.validate_language_options(&language_options);
        }
        let whose = match (self.is_legacy, self.prefers_typescript_rules) {
            (true, _) => Tables::Eslint8,
            (false, true) => Tables::Oxlint,
            (false, false) => Tables::Today,
        };
        config.language = LanguageOptions::from_json_for(&language_options, &settings, whose);
        // oxlint has no `parser`.
        config.language.refuses_what_parser_refuses = !self.prefers_typescript_rules;
        config.language.is_oxlint = self.prefers_typescript_rules;
        config.language.eslint_8 = eslint_8;
        let parser_location = (indices.iter().rev())
            .find_map(|index| self.objects.get(*index as usize)?.parser_location.as_ref());
        config.linter = linter;
        config.parser_name = (language_options.get(b"parser"))
            .and_then(Json::as_str)
            .map(Box::from);
        config.changes_linter = (indices.iter())
            .any(|index| (self.objects.get(*index as usize)).is_some_and(|it| it.changes_linter));
        if config.is_for_eslint() && !config.changes_linter {
            config.for_eslint = for_eslint::build(&for_eslint::Parts {
                language: config.language_name.as_deref(),
                language_options: &language_options,
                settings: &settings,
                linter,
                rules: &rules,
                parser: parser_location.filter(|it| it.get(b"module").is_some()),
                plugins: &plugins,
                locations: &self.js_locations,
                js_plugins: &self.js_plugins,
            })
            .map(Arc::new);
        }
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
                    plugin if plugins.contains(&plugin) => None,
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
            // For ESLint 8 that is a message in every file.
            let eslint_8 = config.language.eslint_8.as_ref();
            if eslint_8.is_some_and(|it| it.lacks_rule(&setting.id, &self.js_plugins)) {
                if setting.severity != Severity::Off {
                    config.missing_rules.push(setting.id);
                }
                continue;
            }
            // What `jsPlugins` names hides a plugin of the same name that is implemented here.
            let js = find_js_rule(&self.js_plugins, &setting.id);
            // So does a plugin that is not the one which is implemented here under that name.
            let prefix = super::registry::parse_rule_id(&setting.id).0;
            let is_foreign = config.foreign_plugins.iter().any(|it| **it == *prefix);
            // Not what is written with a name that oxlint has for the plugin here, `node/..`, or comes from a category.
            let is_native_for_oxlint =
                self.prefers_typescript_rules && setting.written_for.is_some();
            let is_hidden = js.is_some()
                && self.accepts_all_plugins
                && !is_native_for_oxlint
                && !config.prefers_native_rules_of(prefix);
            let native = match is_foreign || is_hidden {
                true => None,
                false => config.find_rule(registry, &setting.id),
            };
            let entry = match (native, js) {
                (Some(entry), _) => entry,
                (None, Some(Some(rule))) => {
                    let options: Arc<[Json]> = setting.options.into();
                    // ESLint 8 has validated them already, and takes any for a rule without a schema.
                    let validated = match self.is_legacy {
                        true => Ok(schema::with_js_defaults(rule, &options)),
                        false => schema::validate_js(rule, &options),
                    };
                    if setting.severity != Severity::Off
                        && config.error.is_none()
                        && let Err(lines) = &validated
                    {
                        config.error = Some(self.js_options_error(rule, &options, lines));
                    }
                    let configured = self.cache.js_rule(rule, &options, || {
                        let options =
                            validated.unwrap_or_else(|_| schema::with_js_defaults(rule, &options));
                        js_plugin::Configured::new(Arc::clone(rule), &options)
                    });
                    config.js_rules.push(ConfiguredJsRule {
                        configured,
                        severity: setting.severity,
                        options,
                        position: config.rules.len(),
                    });
                    continue;
                }
                (None, Some(None)) => {
                    if setting.severity != Severity::Off && config.error.is_none() {
                        config.error = Some(self.missing_js_rule(registry, &setting.id, &plugins));
                    }
                    continue;
                }
                (None, None) => {
                    config.has_skipped_rules |= setting.severity != Severity::Off;
                    continue;
                }
            };
            let options: Arc<[Json]> = setting.options.into();
            // Many configurations have the same options for a rule. One that has an error, or the rule off, validates nothing.
            let is_validated =
                !options.is_empty() && config.error.is_none() && setting.severity != Severity::Off;
            let index = is_validated.then(|| registry.index_of(entry)).flatten();
            if !self.is_legacy && !index.is_some_and(|it| self.cache.is_valid(it, &options)) {
                config.validate(entry, setting.severity, &options);
                if let Some(index) = index.filter(|_| config.error.is_none()) {
                    self.cache.set_valid(index, &options);
                }
            }
            let instance = (setting.severity != Severity::Off).then(|| {
                self.cache.rule(registry, entry, &options, || {
                    Arc::from((entry.build)(&Options::new(&options)))
                })
            });
            let reported_as = self.reported_as(registry, entry, setting.written_for);
            config.rules.push(
                ConfiguredRule::new(entry, setting.severity, options, instance)
                    .report_as(reported_as),
            );
        }
        if !self.js_plugins.is_empty() {
            // ESLint looks for a rule in the plugins that the objects for the file have.
            let has = |it: &&Arc<js_plugin::Plugin>| {
                self.accepts_all_plugins || plugins.contains(&&it.name[..])
            };
            config.js_plugins = self.js_plugins.iter().filter(has).cloned().collect();
            let sources: Vec<&Json> = indices
                .iter()
                .filter_map(|index| self.objects.get(*index as usize)?.source.as_ref())
                .collect();
            config.js_settings = Some(js_plugin::FileSettings::from_objects(
                &config.language,
                &sources,
                parser_location,
            ));
        }
        // From here on: a rule that is turned off can be configured without its plugin.
        if !self.accepts_all_plugins {
            let mut implemented: Vec<Plugin> = Vec::new();
            let is_foreign =
                |it: &&&[u8]| config.foreign_plugins.iter().any(|other| **other == ***it);
            let built_in = plugins.iter().filter(|it| !is_foreign(it));
            for plugin in built_in.filter_map(|it| Plugin::of_prefix(it)) {
                if !implemented.contains(&plugin) {
                    implemented.push(plugin);
                }
            }
            config.plugins = Some(implemented);
        }
        config
    }
}
