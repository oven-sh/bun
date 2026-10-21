//! A run's config: ESLint's flat config, an array of objects where those that match a file are merged. Follows
//! `@eslint/config-array` and ESLint's `lib/config`.
//!
//! - [`Config::from_flat_json`]: an evaluated `eslint.config.*`.
//! - [`Config::from_rc_json`]: an `.oxlintrc.json`.
//! - [`Config::from_legacy`]: ESLint 8's files, with everything they extend and the files in parent directories.
//! - [`Config::get`]: a file's config.
//!
//! # An evaluated `eslint.config.*` as JSON
//!
//! The code that evaluates the file writes its export, awaited and flattened, as
//!
//! ```jsonc
//! [
//!   {
//!     "name": "my/config",
//!     "basePath": "packages/a",
//!     "files": ["**/*.ts", ["src/**", "*.js"]],
//!     "ignores": ["dist/"],
//!     // The rule prefix, mapped to `plugin.meta.name`, or to `null` if it has none.
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
//!     // The processor's name: the string, or `processor.meta.name`.
//!     "processor": "markdown/markdown",
//!     // Present with `settings`: the file, and this object's index in its export.
//!     "$source": { "config": "/app/eslint.config.js", "index": 3 },
//!     // Present with `languageOptions.parser`. See `describeParser` in `evaluate-eslint.js`.
//!     "$parser": { "module": "/app/node_modules/@typescript-eslint/parser/dist/index.js", "export": [], "functions": ["parse", "parseForESLint"], "values": { "version": "8.0.0" } },
//!     // Only together with `basePath`: the lines behind the function that `FlatCompat` puts into `ignores`.
//!     "$ignorePatterns": [".*", "!.eslintrc.*", "/dist"],
//!     // The processor's location. See `js_plugin::Processor::new`.
//!     "$processor": { "plugin": { "module": "/app/node_modules/@eslint/markdown/dist/index.js", "export": ["default"] }, "prefix": "markdown", "name": "markdown" },
//!     "rules": { "eqeqeq": ["error", "smart"] },
//!     "settings": {}
//!   }
//! ]
//! ```
//!
//! A value that JSON can't represent is written as `{ "$unserializable": "function" }`. In `files` and `ignores` such a
//! matcher is an error, because there's no way to tell which files it matches. ESLint's own default objects aren't part
//! of the array.

mod cache;
pub(crate) mod eslint8;
mod eslintrc;
mod flat;
mod for_eslint;
mod ignore_lines;
mod merge;
mod number_of_rules;
mod oxlint_fields;
mod oxlint_options;
mod presets;
mod rc;
mod rust_regex;
mod serde_json;
mod shape;

use super::RuleId;
use super::globals::Tables;
use super::registry::{Registry, formatting_rule};
use super::resolved::{
    ConfiguredJsRule, ConfiguredRule, FormattingRule, LinterOptions, ResolvedConfig, Skipped,
    find_formatting_rule, find_js_rule,
};
use super::schema;
use crate::context::Severity;
use crate::js_plugin;
use crate::language::{GlobalsFromOptions, InferGlobals, LanguageOptions};
use crate::languages::{Dialect, Language, Rejection};
use crate::options::Json;
use crate::paths;
use crate::rule::{Frameworks, Meta, Plugin};
use crate::runner::RuleEntry;
use bun_glob::Candidate;
use cache::Cache;
pub use eslintrc::{Eslint8, LegacyFailure, LegacyFile, LegacyKind, LegacyOptions, LoadLegacy};
pub use flat::{ConfigError, LoadLocatedPlugin, NamedPlugin};
use ignore_lines::IgnoreLines;
use merge::RuleSetting;
pub use rc::{
    LoadPlugin, is_missing_in_oxlint, is_oxlint_plugin, oxlint_category, oxlint_runs_on, strings_of,
};
pub(crate) use rc::{OxlintChanges, oxlint_changes};
pub(crate) use rc::{is_oxlint_rule, is_rule_not_built_in};
use rustc_hash::FxHashMap;
pub use serde_json::json_for_oxlint;
pub use shape::glob_error;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::sync::Arc;

/// A pattern in `files` or `ignores`.
struct Pattern {
    /// For ESLint, the pattern without its leading `!`s.
    matcher: bun_glob::Pattern,
    /// The pattern starts with `!`.
    is_negated: bool,
    /// The pattern starts with an odd number of `!`, which inverts the result.
    is_inverted: bool,
    /// The pattern starts with `#`. minimatch treats it as a comment that matches nothing.
    is_comment: bool,
    /// Directory paths end with `/`. minimatch lets `a` match `a/`, so ESLint patterns also try the path without the slash.
    matches_without_slash: bool,
    /// `*`, `!..`, `../*`, `../**`: it doesn't make ESLint lint a file that nothing else matches.
    is_universal: bool,
    /// Everything it matches ends with `.` and one of these, [packed](packed_extension). Empty if that can't be
    /// determined.
    extensions: SmallVec<[u64; 8]>,
    /// It's `**/*.` plus `extensions`, so it gives the same answer for all files in a directory with the same
    /// extension.
    is_by_extension: bool,
    /// It ends with `/**`, so it gives the same answer for all files in a directory.
    matches_whole_directory: bool,
    /// For a pattern like `**/*{.,_}{test,spec}.{js,ts}`, which only tests the end of the file name and has more than
    /// one brace group: the parts after `**/*`, last one first, each with its alternatives. Otherwise empty.
    ending: Vec<SmallVec<[Box<[u8]>; 8]>>,
}

/// [`Pattern::ending`] for a pattern without a leading `!`.
fn ending_of(pattern: &[u8]) -> Vec<SmallVec<[Box<[u8]>; 8]>> {
    let is_plain = |it: &u8| it.is_ascii_alphanumeric() || matches!(it, b'.' | b'_' | b'-');
    let is_text = |it: &[u8]| !it.is_empty() && it.iter().all(is_plain);
    let (mut parts, mut choices) = (Vec::new(), 0);
    let mut rest = pattern.strip_prefix(b"**/*").unwrap_or_default();
    while let Some(first) = rest.first() {
        let len = match first {
            b'{' => bun_core::strings::index_of_char_usize(rest, b'}').map_or(0, |end| end + 1),
            _ => rest.iter().take_while(|it| is_plain(it)).count(),
        };
        let (part, after) = rest.split_at(len);
        let texts: SmallVec<[&[u8]; 8]> = match part {
            [b'{', texts @ .., b'}'] => bun_core::strings::split(texts, b",").collect(),
            text => smallvec::smallvec![text],
        };
        // Braces around a single text aren't alternatives.
        if !texts.iter().all(|it| is_text(it)) || (*first == b'{' && texts.len() < 2) {
            return Vec::new();
        }
        choices += usize::from(texts.len() > 1);
        parts.push(texts.iter().map(|it| Box::from(*it)).collect());
        rest = after;
    }
    parts.reverse();
    match choices > 1 {
        true => parts,
        false => Vec::new(),
    }
}

/// True if `name` ends with one text from each of `parts`, last part first.
fn ends_with_all(name: &[u8], parts: &[SmallVec<[Box<[u8]>; 8]>]) -> bool {
    let Some((last, before)) = parts.split_first() else {
        return true;
    };
    last.iter().any(|text| {
        // They're a few bytes long, and most differ in the last byte.
        name.len() >= text.len()
            && name
                .iter()
                .rev()
                .zip(text.iter().rev())
                .all(|(a, b)| a == b)
            && ends_with_all(&name[..name.len() - text.len()], before)
    })
}

/// An extension of at most 8 bytes, packed into a number.
fn packed_extension(extension: &[u8]) -> Option<u64> {
    let mut bytes = [0; 8];
    bytes.get_mut(..extension.len())?.copy_from_slice(extension);
    Some(u64::from_le_bytes(bytes))
}

/// [`Pattern::extensions`] for a pattern without a leading `!`: what follows its last `.`, which is a word or words in
/// braces.
fn extensions_of(pattern: &[u8]) -> SmallVec<[u64; 8]> {
    let is_word = |it: &[u8]| !it.is_empty() && it.iter().all(u8::is_ascii_alphanumeric);
    let dot = bun_core::strings::last_index_of_char(pattern, b'.');
    let words: SmallVec<[&[u8]; 8]> = match dot.and_then(|at| pattern.get(at + 1..)) {
        // Braces around a single word aren't alternatives.
        Some([b'{', words @ .., b'}']) if bun_core::strings::contains_char(words, b',') => {
            bun_core::strings::split(words, b",").collect()
        }
        Some(word) => smallvec::smallvec![word],
        None => SmallVec::new(),
    };
    let packed = words
        .iter()
        .map(|it| packed_extension(it).filter(|_| is_word(it)));
    packed.collect::<Option<_>>().unwrap_or_default()
}

impl Pattern {
    fn new(raw_pattern: &[u8]) -> Pattern {
        // `normalizePattern`
        let normalized = match raw_pattern {
            [b'.', b'/', rest @ ..] => rest.to_vec(),
            [b'!', b'.', b'/', rest @ ..] => [b"!", rest].concat(),
            raw_pattern => raw_pattern.to_vec(),
        };
        let bangs = normalized.iter().take_while(|it| **it == b'!').count();
        let is_positive_pattern = bangs == 0 && !normalized.starts_with(b"#");
        let extensions = match is_positive_pattern {
            true => extensions_of(&normalized),
            false => SmallVec::new(),
        };
        Pattern {
            matcher: bun_glob::Pattern::with_dots(
                &crate::glob::from_minimatch(&normalized[bangs..]),
                bun_glob::Dots::SkipTraversal,
            ),
            is_negated: bangs > 0,
            is_inverted: bangs % 2 == 1,
            is_comment: normalized.starts_with(b"#"),
            matches_without_slash: true,
            is_universal: normalized == b"*"
                || normalized.starts_with(b"!")
                || normalized.ends_with(b"/*")
                || normalized.ends_with(b"/**"),
            is_by_extension: !extensions.is_empty()
                && normalized.starts_with(b"**/*.")
                && bun_core::strings::last_index_of_char(&normalized, b'.') == Some(4),
            extensions,
            matches_whole_directory: is_positive_pattern && normalized.ends_with(b"/**"),
            ending: match is_positive_pattern {
                true => ending_of(&normalized),
                false => Vec::new(),
            },
        }
    }

    /// A `files` or `excludeFiles` pattern from an override in an `.oxlintrc.json`.
    fn of_oxlint(raw_pattern: &[u8]) -> Pattern {
        Pattern::for_override(bun_glob::Pattern::of_oxlint(raw_pattern))
    }

    /// A `files` or `excludeFiles` pattern from `[[lint.overrides]]` in bunfig.toml.
    fn of_bunfig(raw_pattern: &[u8]) -> Pattern {
        Pattern::for_override(bun_glob::Pattern::of_bunfig(raw_pattern))
    }

    /// A leading `!` inverts the pattern. Unlike in ESLint, it never un-ignores a file. An override never makes a file linted.
    fn for_override(matcher: bun_glob::Pattern) -> Pattern {
        Pattern {
            matcher,
            is_negated: false,
            is_inverted: false,
            is_comment: false,
            matches_without_slash: false,
            is_universal: true,
            extensions: SmallVec::new(),
            is_by_extension: false,
            matches_whole_directory: false,
            ending: Vec::new(),
        }
    }

    /// `matcher`'s answer for a file, where [`Pattern::ending`] can tell. `**` doesn't match through a `.` or `..`
    /// segment.
    #[inline]
    fn matches_by_ending(&self, path: &Candidate) -> Option<bool> {
        if self.ending.is_empty() {
            return None;
        }
        let (name, path_len) = (path.name(), path.path().len());
        let answer = match ends_with_all(name, &self.ending) {
            true if matches!(name, b"." | b"..") => None,
            true => {
                let before = path.path().get(..path_len - name.len())?;
                (!bun_core::strings::contains(before, b"./")).then_some(true)
            }
            false => Some(false),
        };
        debug_assert!(answer.is_none_or(|it| it == self.matcher.matches_candidate(path)));
        answer
    }

    /// With `flip_negate`, a leading `!` doesn't invert the answer. Only ESLint uses that.
    fn matches(&self, path: &Candidate, flip_negate: bool) -> bool {
        let hit = match path.without_slash() {
            Some(directory) => {
                self.matches_without_slash && self.matcher.matches_candidate(&directory)
                    || self.matcher.matches_candidate(path)
            }
            None => self
                .matches_by_ending(path)
                .unwrap_or_else(|| self.matcher.matches_candidate(path)),
        };
        !self.is_comment && hit != (self.is_inverted && !flip_negate)
    }
}

/// An element of the array.
struct ConfigObject {
    /// Absolute.
    base_path: Option<Vec<u8>>,
    /// One of these lists has to match, with all of its patterns.
    files: Option<Vec<Vec<Pattern>>>,
    ignores: Option<Vec<Pattern>>,
    /// oxlint's or ESLint 8's `ignorePatterns`, used in place of `ignores`.
    ignore_lines: Option<IgnoreLines>,
    /// It only has `ignores`, so what it ignores is ignored globally.
    is_global_ignores: bool,
    /// oxlint's `ignorePatterns`, which don't apply outside the base path.
    ignores_inside_only: bool,
    language_options: Json,
    linter_options: Json,
    /// Set if `settings` is an object. Files for which no other object has settings share this `Arc`.
    settings: Option<Arc<Json>>,
    rules: Vec<RuleSetting>,
    /// The prefixes of the built-in plugins.
    plugins: Vec<Box<[u8]>>,
    /// The prefixes of the plugins that aren't built in.
    foreign_plugins: Vec<Box<[u8]>>,
    /// `$jsPlugins`: each one's index in [`Config::js_locations`].
    js_plugins: Vec<u32>,
    /// All plugins as `--print-config` prints them: `prefix:name@version`, or only the prefix for a plugin without a
    /// name.
    printed_plugins: Vec<Box<[u8]>>,
    /// The object is invalid. This is ESLint's message, which it reports when the object is merged.
    error: Option<Vec<u8>>,
    language: Option<Box<[u8]>>,
    processor: Option<Box<[u8]>>,
    /// `$processor`
    processor_location: Option<Arc<js_plugin::Processor>>,
    /// `$source`: `{ config, index }`, the config file and this object's index in its export. An object with `settings`
    /// has it.
    source: Option<Json>,
    /// `$parser`
    parser_location: Option<Json>,
    /// `$changesLinter`: see [`ResolvedConfig::changes_linter`].
    changes_linter: bool,
    /// `$framework`: skip this object unless the project uses this framework. Empty means it always applies.
    /// `$packageType` does the same with [`Frameworks::TYPE_MODULE`].
    /// Only Bun's built-in config sets them. See [`Config::get_with_frameworks`].
    required_framework: Frameworks,
    /// For an oxlint override that has `plugins`: those plugins and the files' plugins, as bit sets. The leading
    /// settings in its `rules` with `yields` set are the ones that `categories` turns on.
    override_plugin_sets: Option<(u32, u32)>,
    /// The plugins [with no built-in rules](Plugin::has_no_rules) for which oxlint's `categories` turns rules on.
    without_rules: Vec<Plugin>,
}

impl ConfigObject {
    /// True if only the file's directory determines whether it applies.
    fn depends_only_on_directory(&self) -> bool {
        let mut patterns = self.files.iter().flatten().flatten();
        self.files.is_some()
            && self.ignores.is_none()
            && patterns.all(|it| it.matches_whole_directory)
    }

    /// The [`BeforeName`] of the entries of `directory` (absolute) relative to its own base path, if it has one.
    /// `before_name` is the one for [`Config::relative`].
    fn see(&self, config: &Config, directory: &[u8], before_name: &[u8]) -> BeforeName {
        let base_path = self.base_path.as_ref()?;
        match self.is_global_ignores {
            // Computed the same way as in `is_ignored_globally_as`.
            true => paths::relative_to_base_before_name(
                base_path,
                &paths::resolve(&config.base_path, before_name),
            ),
            false => paths::relative_to_base_before_name(base_path, directory),
        }
    }

    /// Keeps `settings` only if it's an object.
    fn settings_of(raw_settings: Json) -> Option<Arc<Json>> {
        matches!(raw_settings, Json::Object(_)).then(|| Arc::new(raw_settings))
    }
}

/// True if merging `settings` into nothing yields the same value. The merge drops `__proto__`, and a flat config keeps
/// only one entry of a duplicated key.
fn merge_is_identity(settings: &Json, is_legacy: bool) -> bool {
    let entries = settings.as_object().unwrap_or_default();
    let is_again = |at: usize, key: &[u8]| entries.iter().take(at).any(|it| it.0 == key);
    let mut entries = entries.iter().enumerate();
    entries.all(|(at, it)| it.0 != b"__proto__" && (is_legacy || !is_again(at, &it.0)))
}

impl Default for ConfigObject {
    fn default() -> Self {
        ConfigObject {
            base_path: None,
            files: None,
            ignores: None,
            ignore_lines: None,
            is_global_ignores: false,
            ignores_inside_only: false,
            language_options: Json::Null,
            linter_options: Json::Null,
            settings: None,
            rules: Vec::new(),
            plugins: Vec::new(),
            foreign_plugins: Vec::new(),
            js_plugins: Vec::new(),
            printed_plugins: Vec::new(),
            error: None,
            language: None,
            processor: None,
            processor_location: None,
            source: None,
            parser_location: None,
            changes_linter: false,
            required_framework: Frameworks::empty(),
            override_plugin_sets: None,
            without_rules: Vec::new(),
        }
    }
}

/// ESLint 8's `dotfiles`: files found for a command-line argument with a dot-prefixed segment (`.storybook`, `.*.js`)
/// aren't ignored for having such a name.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Dotfiles {
    AsConfigured,
    Linted,
}

/// A config's verdict on a file: ESLint's `getConfigWithStatus`.
#[derive(Clone)]
pub enum FileConfig {
    /// It's outside the config's directory.
    External,
    Ignored,
    /// No object with `files` matches it.
    Unconfigured,
    Matched(Arc<ResolvedConfig>),
}

/// An index of which `files` elements, across all objects, can match a file, keyed by the start of its path. Most
/// `overrides` patterns start with a directory name, and most files aren't in any of those directories.
#[derive(Default)]
struct Heads {
    /// The elements that have a pattern starting with these literal path segments, each with its object.
    by_head: FxHashMap<Box<[u8]>, SmallVec<[(u32, u32); 2]>>,
    /// For each element: true if everything it can match starts with one of the keys that list it.
    is_listed: Vec<bool>,
    /// For each object, the number of its first element, and whether all of its elements are listed.
    objects: Vec<(u32, bool)>,
    /// For each extension that a pattern ends with, [packed](packed_extension): what can match a file with that
    /// extension.
    by_extension: Vec<(u64, ExtensionMatches)>,
    /// The same for a file with any other extension, or without one.
    without_extension: ExtensionMatches,
    /// A bit for each object that is [about directories](ConfigObject::depends_only_on_directory).
    directory_only_objects: Bits,
    /// The patterns in `files` that look at more of a file's name than its extension. `None` if a file's objects can't
    /// be derived from these patterns' results, its extension and its directory, or if there are more than 64.
    by_name: Option<Vec<PatternLocation>>,
}

/// A pattern's location: the object, the element of its `files`, and the pattern in that element.
#[derive(Copy, Clone)]
struct PatternLocation {
    object: u32,
    element: u32,
    pattern: u32,
}

/// The results of the [`Heads::by_name`] patterns for a file, one bit each, with the file's [extension](extension_of).
type NameMatchKey = (Option<u64>, u64);

/// The extension of the file at `path`, [packed](packed_extension). One that contains a `/` is harmless, because no
/// pattern's extension does.
fn extension_of(path: &[u8]) -> Option<u64> {
    let dot = bun_core::strings::last_index_of_char(path, b'.')?;
    packed_extension(path.get(dot + 1..)?)
}

type Bits = SmallVec<[u64; 4]>;

/// Indices into [`Config::objects`].
type Indices = SmallVec<[u32; 16]>;

fn has_bit(bits: &Bits, index: usize) -> bool {
    bits[index / 64] & (1 << (index % 64)) != 0
}

/// The entries listed for a path: a bit for each element, and one for each object.
#[derive(Default)]
struct Listed {
    elements: Bits,
    objects: Bits,
}

/// Facts about the files with a given extension.
#[derive(Default)]
struct ExtensionMatches {
    can_match: Listed,
    /// One of these elements makes ESLint lint what it matches.
    can_be_linted: bool,
}

/// The possible starts of a path that all of `patterns` match. One pattern that determines them is enough.
fn heads_of(patterns: &[Pattern]) -> Option<Vec<&[u8]>> {
    let is_plain_pattern = |it: &&Pattern| !it.is_inverted && !it.is_comment;
    patterns
        .iter()
        .filter(is_plain_pattern)
        .find_map(|it| it.matcher.heads())
}

impl Heads {
    fn new<'o>(objects: &'o [ConfigObject]) -> Heads {
        let mut heads = Heads::default();
        for (index, object) in objects.iter().enumerate() {
            let first = heads.is_listed.len();
            for patterns in object.files.iter().flatten() {
                let element = heads.is_listed.len() as u32;
                let element_heads = heads_of(patterns).filter(|_| object.base_path.is_none());
                heads.is_listed.push(element_heads.is_some());
                for head in element_heads.into_iter().flatten() {
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
        let elements = || objects.iter().flat_map(|it| it.files.iter().flatten());
        // All of an element's patterns have to match, so one pattern with known extensions is enough.
        let extensions_of = |element: &'o Vec<Pattern>| {
            let mut known = element.iter().map(|it| &it.extensions[..]);
            known.find(|it| !it.is_empty()).unwrap_or_default()
        };
        let for_extension = |extension: Option<u64>| {
            let can_match = |element: &'o Vec<Pattern>| {
                let needs = extensions_of(element);
                needs.is_empty() || extension.is_some_and(|it| needs.contains(&it))
            };
            let mut found = Listed {
                elements: smallvec::smallvec![0; heads.is_listed.len().div_ceil(64)],
                objects: smallvec::smallvec![0; objects.len().div_ceil(64)],
            };
            for (at, _) in elements().enumerate().filter(|it| can_match(it.1)) {
                found.elements[at / 64] |= 1 << (at % 64);
            }
            for (at, object) in objects.iter().enumerate() {
                if (object.files.as_ref()).is_none_or(|it| it.iter().any(can_match)) {
                    found.objects[at / 64] |= 1 << (at % 64);
                }
            }
            let makes_linted = |it: &'o Vec<Pattern>| !it.iter().all(|it| it.is_universal);
            ExtensionMatches {
                can_match: found,
                can_be_linted: elements().any(|it| can_match(it) && makes_linted(it)),
            }
        };
        let mut extensions: Vec<u64> = elements().flat_map(extensions_of).copied().collect();
        extensions.sort_unstable();
        extensions.dedup();
        let by_extension = extensions.iter().map(|&it| (it, for_extension(Some(it))));
        heads.by_extension = by_extension.collect();
        heads.without_extension = for_extension(None);
        heads.directory_only_objects = smallvec::smallvec![0; objects.len().div_ceil(64)];
        for (at, _) in (objects.iter().enumerate()).filter(|it| it.1.depends_only_on_directory()) {
            heads.directory_only_objects[at / 64] |= 1 << (at % 64);
        }
        let (mut by_name, mut follows) = (Vec::new(), true);
        for (at, object) in objects.iter().enumerate() {
            follows &= object.ignores.is_none() || object.is_global_ignores;
            for (element, patterns) in object.files.iter().flatten().enumerate() {
                let looks_at_name =
                    |it: &&Pattern| !it.is_by_extension && !it.matches_whole_directory;
                for (pattern, _) in patterns
                    .iter()
                    .enumerate()
                    .filter(|it| looks_at_name(&it.1))
                {
                    // It would have to be matched against a different path.
                    follows &= object.base_path.is_none();
                    by_name.push(PatternLocation {
                        object: at as u32,
                        element: element as u32,
                        pattern: pattern as u32,
                    });
                }
            }
        }
        heads.by_name = (follows && by_name.len() <= 64).then_some(by_name);
        heads
    }

    /// Two files in a directory with the same result have the same objects.
    fn name_match_key(&self, objects: &[ConfigObject], path: &Candidate) -> Option<NameMatchKey> {
        let extension = extension_of(path.path());
        let mut match_bits = 0;
        for (bit, pattern_location) in self.by_name.as_ref()?.iter().enumerate() {
            let files = objects
                .get(pattern_location.object as usize)?
                .files
                .as_ref()?;
            let pattern = (files.get(pattern_location.element as usize)?)
                .get(pattern_location.pattern as usize)?;
            let can_match = pattern.extensions.is_empty()
                || extension.is_some_and(|it| pattern.extensions.contains(&it));
            match_bits |= u64::from(can_match && pattern.matches(path, false)) << bit;
        }
        Some((extension, match_bits))
    }

    /// Returns what can match `path`, judging by its extension.
    fn extension_matches(&self, path: &[u8]) -> &ExtensionMatches {
        let extension = extension_of(path);
        let mut known = self.by_extension.iter();
        known
            .find(|it| Some(it.0) == extension)
            .map_or(&self.without_extension, |it| &it.1)
    }

    /// Returns what's listed for the prefixes of `path`, or `None` if that can't be determined.
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

    /// True if the `files` of `object` can match the path that `found` is for.
    fn allows_object(&self, found: &Listed, object: usize) -> bool {
        !self.objects[object].1 || has_bit(&found.objects, object)
    }

    /// The same for its `nth` element.
    fn allows(&self, found: &Listed, object: usize, nth: usize) -> bool {
        let element = self.element(object, nth);
        !self.is_listed[element] || has_bit(&found.elements, element)
    }

    /// The number of the `nth` element in `object`'s `files`.
    fn element(&self, object: usize, nth: usize) -> usize {
        self.objects[object].0 as usize + nth
    }
}

/// A run's config, shared by all threads.
pub struct Config {
    base_path: Vec<u8>,
    objects: Vec<ConfigObject>,
    /// A rule setting that's only a severity keeps the options of the one it overrides.
    keeps_options: bool,
    /// Any plugin that isn't built in counts as configured.
    accepts_all_plugins: bool,
    /// It's built from ESLint 8's files.
    is_legacy: bool,
    /// [`LanguageOptions::eslint_major`]
    eslint_major: u8,
    /// [`LanguageOptions::without_modules`]
    without_modules: bool,
    /// [`LanguageOptions::infers_globals`]
    infers_globals: InferGlobals,
    /// ESLint 8's `--no-ignore`: a file passed by name is linted no matter what ignores it. Files found in a directory
    /// aren't.
    lints_all_named_files: bool,
    /// The index of the object with the patterns that make ESLint 8 ignore dotfiles.
    dot_patterns: Option<usize>,
    /// An ESLint rule that typescript-eslint extends means the extension rule, as in oxlint.
    prefers_typescript_rules: bool,
    /// [`ResolvedConfig::has_every_rule`]
    has_every_rule: bool,
    /// The `options` of an `.oxlintrc.json` and of the files it extends.
    oxlintrc_options: Vec<(Vec<u8>, Json)>,
    /// [`Config::oxlint_print_config`]
    oxlint_print_config: Vec<(Vec<u8>, Json)>,
    notes: Vec<Vec<u8>>,
    advice: Vec<Vec<u8>>,
    unknown_rules: Vec<Box<[u8]>>,
    js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// Each one's index in `js_locations`.
    js_plugin_location_indices: Vec<u32>,
    /// `$jsPlugins`: each prefix with its plugin's location.
    js_locations: Vec<(Box<[u8]>, Json)>,
    /// Objects for different files register different plugins under the same name.
    has_twins: bool,
    heads: Heads,
    cache: Cache,
}

/// The part before the last segment of a path relative to a base path. `None` if the base path is deeper than the
/// directory, so this part isn't the same for all of the directory's entries.
type BeforeName = Option<Vec<u8>>;

/// The directory part of the relative paths that a [`Config`] matches against. It's shared by all entries of one
/// directory.
#[derive(PartialEq, Eq, Debug)]
pub struct Seen {
    /// For [`Config::relative`].
    before_name: BeforeName,
    /// For each object with its own base path, sorted by index. Empty without `before_name`.
    by_objects: Vec<(u32, BeforeName)>,
}

/// A [`Config`] for the entries of one directory.
pub struct Within<'c> {
    config: &'c Config,
    seen: &'c Seen,
    /// `seen.before_name`
    before_name: Option<Candidate<'c>>,
    /// The offset of the name in an entry's path.
    name_at: usize,
    /// [`Config::relative`] of the last entry that was looked up.
    relative: Vec<u8>,
    /// The last merged objects, and the result.
    merged: Option<(Indices, Arc<ResolvedConfig>)>,
    directory_verdicts: DirectoryVerdicts,
    known: Known,
    /// [`Config::missing_frameworks`] for this directory. Set by [`Within::with_frameworks`].
    missing_frameworks: Frameworks,
}

/// For objects that are [about directories](ConfigObject::depends_only_on_directory), by index: whether the object
/// applies to the directory's files, and whether that makes ESLint lint them.
type DirectoryVerdicts = std::cell::RefCell<SmallVec<[(u32, bool, bool); 2]>>;

/// Cached [`Config::matching`] results for the directory's files, keyed by [`Heads::name_match_key`].
type Known = std::cell::RefCell<Vec<(NameMatchKey, Option<Indices>)>>;

/// An entry of a [`Within`]'s directory.
struct Entry<'w> {
    name: &'w [u8],
    prefixes_by_object: &'w [(u32, BeforeName)],
    directory_verdicts: &'w DirectoryVerdicts,
    known: &'w Known,
}

impl Entry<'_> {
    /// The entry's path relative to the base path of the object at `index`, if that's known.
    fn path_relative_to_object(&self, index: usize) -> Option<Vec<u8>> {
        let objects = self.prefixes_by_object;
        let at = objects
            .binary_search_by_key(&index, |it| it.0 as usize)
            .ok()?;
        Some([objects.get(at)?.1.as_deref()?, self.name].concat())
    }

    fn directory_verdict(&self, index: usize) -> Option<(bool, bool)> {
        let verdicts = self.directory_verdicts.borrow();
        let found = verdicts.iter().find(|it| it.0 as usize == index)?;
        Some((found.1, found.2))
    }
}

impl Within<'_> {
    /// Sets the frameworks detected for this directory. [`Within::get`] then skips config objects that require a different
    /// one, like [`Config::get_with_frameworks`].
    pub fn with_frameworks(mut self, detected: Frameworks) -> Self {
        self.missing_frameworks = self.config.missing_frameworks(detected);
        self
    }

    /// Returns the entry at `path` and the relative path that patterns match against, which ends with a slash for a
    /// directory. For `None`, see [`BeforeName`].
    fn see<'w>(
        &'w mut self,
        path: &'w [u8],
        is_directory: bool,
    ) -> Option<(Candidate<'w>, Entry<'w>)> {
        let (name, before_name) = (path.get(self.name_at..)?, self.before_name.as_ref()?);
        self.relative.truncate(before_name.path().len());
        self.relative.extend_from_slice(name);
        debug_assert_eq!(self.relative, self.config.relative(path));
        if is_directory {
            self.relative.push(b'/');
        }
        Some((
            before_name.entry(&self.relative),
            Entry {
                name,
                prefixes_by_object: &self.seen.by_objects,
                directory_verdicts: &self.directory_verdicts,
                known: &self.known,
            },
        ))
    }

    /// [`Config::see`] for the directory at `path`, which is an entry of this one.
    pub fn see_child(&self, path: &[u8]) -> Seen {
        let config = self.config;
        let (Some(name), Some(before_name)) = (path.get(self.name_at..), &self.seen.before_name)
        else {
            return config.see(path);
        };
        let below = |before_name: &[u8]| [before_name, name, b"/"].concat();
        let before_name = below(before_name);
        let by_objects = self.seen.by_objects.iter().map(|(index, known)| {
            let known = known.as_ref().map(|it| below(it));
            (
                *index,
                known.or_else(|| config.objects[*index as usize].see(config, path, &before_name)),
            )
        });
        let seen = Seen {
            by_objects: by_objects.collect(),
            before_name: Some(before_name),
        };
        debug_assert_eq!(seen, config.see(path));
        seen
    }

    /// [`Config::is_directory_ignored`] for the directory at `path`, which is an entry. Assumes the containing
    /// directory isn't ignored.
    pub fn is_directory_ignored(&mut self, path: &[u8], dotfiles: Dotfiles) -> bool {
        let config = self.config;
        match self.see(path, true) {
            Some((parts, _)) if paths::is_external(parts.path()) => true,
            Some((parts, entry)) => config.is_ignored_globally_as(&parts, Some(&entry), dotfiles),
            None => config.is_directory_ignored_in(path, dotfiles),
        }
    }

    /// [`Config::get`] for the file at `path`, which is an entry. Assumes the containing directory isn't ignored.
    /// `is_selected` means a pattern among the arguments matches it. ESLint 8 lints such a file whatever its name.
    pub fn get(
        &mut self,
        registry: &Registry,
        path: &[u8],
        dotfiles: Dotfiles,
        is_selected: bool,
    ) -> FileConfig {
        let config = self.config;
        let must_match = !(is_selected && config.is_legacy);
        let missing = self.missing_frameworks;
        let matching = {
            let Some((parts, entry)) = self.see(path, false) else {
                return match config.is_file_ignored_in(path, dotfiles) {
                    _ if config.is_outside(path) => FileConfig::External,
                    true => FileConfig::Ignored,
                    false => config.get_if(registry, path, must_match, missing),
                };
            };
            if paths::is_external(parts.path()) {
                return FileConfig::External;
            }
            if config.is_ignored_globally_as(&parts, Some(&entry), dotfiles) {
                return FileConfig::Ignored;
            }
            let matching = || config.matching(path, &parts, Some(&entry), must_match);
            let name_key = match must_match {
                true => config.heads.name_match_key(&config.objects, &parts),
                false => None,
            };
            let find = |name_key: NameMatchKey| {
                let known = entry.known.borrow();
                known
                    .iter()
                    .find(|it| it.0 == name_key)
                    .map(|it| it.1.clone())
            };
            match (name_key, name_key.and_then(find)) {
                (_, Some(known)) => {
                    debug_assert_eq!(known, matching());
                    known
                }
                (Some(name_key), None) => {
                    let made = matching();
                    entry.known.borrow_mut().push((name_key, made.clone()));
                    made
                }
                (None, None) => matching(),
            }
        };
        let Some(mut matching) = matching else {
            return FileConfig::Unconfigured;
        };
        config.remove_unmet(&mut matching, missing);
        // Most files in a directory have the same objects.
        let merged = match self.merged.take().filter(|it| it.0 == matching) {
            Some(merged) => merged,
            None => {
                let resolved = config.resolved(registry, &matching);
                (matching, resolved)
            }
        };
        FileConfig::Matched(Arc::clone(&self.merged.insert(merged).1))
    }
}

/// `shouldIgnorePath` for the `ignores` of one object.
fn is_ignored_by(ignores: &[Pattern], path: &Candidate, mut is_ignored: bool) -> bool {
    for pattern in ignores {
        match (is_ignored, pattern.is_negated) {
            (false, false) => is_ignored = pattern.matches(path, false),
            (true, true) => is_ignored = !pattern.matches(path, true),
            _ => {}
        }
    }
    is_ignored
}

/// `pathMatches`
fn path_matches<'o>(
    files: impl IntoIterator<Item = &'o Vec<Pattern>>,
    ignores: Option<&[Pattern]>,
    path: &Candidate,
) -> bool {
    files
        .into_iter()
        .any(|all| all.iter().all(|pattern| pattern.matches(path, false)))
        && !ignores.is_some_and(|ignores| is_ignored_by(ignores, path, false))
}

/// [`Config::shadowed_builtin_plugins`]
pub struct ShadowedBuiltinPlugin<'c> {
    /// The prefix of the JavaScript plugin's rules.
    pub prefix: &'c [u8],
    /// The built-in plugin with the same name.
    pub plugin: Plugin,
    /// How many of its rules that are on somewhere are built in.
    pub built_in: usize,
    /// How many aren't.
    pub others: usize,
}

/// oxlint's error for options that the schema of a JavaScript plugin's rule rejects. `lines` come from
/// [`schema::validate_js`].
fn oxlint_js_options_error(rule: &js_plugin::Rule, options: &[Json], lines: &[u8]) -> Vec<u8> {
    let start: &[u8] = b"Failed to setup JS plugin options:\nError: ";
    let takes_none = match &rule.schema {
        js_plugin::Schema::None => true,
        js_plugin::Schema::Json(Json::Array(items)) => items.is_empty(),
        _ => false,
    };
    if takes_none {
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
        bun_core::strings::trim_js_whitespace_end(lines),
    ]
    .concat()
}

impl Config {
    /// Notes for the user about parts of the config that couldn't be applied.
    pub fn notes(&self) -> &[Vec<u8>] {
        &self.notes
    }

    /// The files that the parsers and JavaScript plugins come from, for those that have their own files.
    pub fn modules(&self) -> impl Iterator<Item = &[u8]> {
        let parsers = self
            .objects
            .iter()
            .filter_map(|it| it.parser_location.as_ref());
        let plugins = self.js_locations.iter().map(|it| &it.1);
        parsers
            .chain(plugins)
            .filter_map(|it| it.get(b"module")?.as_str())
    }

    /// Sets [`LanguageOptions::eslint_major`] for all files. Call it before requesting any file's config.
    pub fn follow_eslint(&mut self, major: u8) {
        self.eslint_major = major;
    }

    /// The same for [`LanguageOptions::infers_globals`].
    pub fn infer_globals(&mut self, how: InferGlobals) {
        self.infers_globals = how;
    }

    /// Things the user may want to know even though nothing is wrong, one line each.
    pub fn advice(&self) -> &[Vec<u8>] {
        &self.advice
    }

    /// Returns what oxlint's `--print-config` prints, if the config was built from an `.oxlintrc.json`.
    pub fn oxlint_print_config(&self) -> Json {
        Json::Object(self.oxlint_print_config.clone())
    }

    /// `options[name]` of an `.oxlintrc.json`, or else of a file it extends.
    pub fn oxlintrc_option(&self, name: &[u8]) -> Option<&Json> {
        let mut options = self.oxlintrc_options.iter();
        Some(&options.find(|it| it.0 == name)?.1)
    }

    /// The plugins in an oxlint config's `jsPlugins` that share a name with a built-in plugin and have an enabled rule
    /// that's built in. Rules written with that name run in JavaScript, as in oxlint.
    pub fn shadowed_builtin_plugins(&self, registry: &Registry) -> Vec<ShadowedBuiltinPlugin<'_>> {
        let mut found: Vec<ShadowedBuiltinPlugin> = Vec::new();
        let mut seen: Vec<&[u8]> = Vec::new();
        let settings = self.objects.iter().flat_map(|it| &it.rules);
        for setting in
            settings.filter(|_| self.prefers_typescript_rules && !self.js_plugins.is_empty())
        {
            let id = &setting.id[..];
            let is_on = setting.severity != Severity::Off && setting.builtin_plugin.is_none();
            if !is_on
                || seen.contains(&id)
                || find_js_rule(&self.js_plugins, id).flatten().is_none()
            {
                continue;
            }
            seen.push(id);
            let prefix = super::registry::parse_rule_id(id).0;
            let Some(plugin) = Plugin::from_oxlint_prefix(prefix) else {
                continue;
            };
            let at = found.iter().position(|it| it.prefix == prefix);
            let at = at.unwrap_or_else(|| {
                found.push(ShadowedBuiltinPlugin {
                    prefix,
                    plugin,
                    built_in: 0,
                    others: 0,
                });
                found.len() - 1
            });
            match registry.find_preferring(id, true) {
                Some(_) => found[at].built_in += 1,
                None => found[at].others += 1,
            }
        }
        found.retain(|it| it.built_in > 0);
        found
    }

    /// The rules that are configured as something other than `"off"` and that Bun doesn't have. They're skipped.
    pub fn unknown_rules(&self) -> &[Box<[u8]>] {
        &self.unknown_rules
    }

    /// `shouldIgnorePath(this.ignores, ..)`. `relative` is relative to the base path, and ends with a slash if it's a
    /// directory.
    fn is_ignored_globally(&self, relative: &[u8], dotfiles: Dotfiles) -> bool {
        self.is_ignored_globally_as(&Candidate::new(relative), None, dotfiles)
    }

    /// The same for a path that's already split.
    fn is_ignored_globally_as(
        &self,
        parts: &Candidate,
        entry: Option<&Entry>,
        dotfiles: Dotfiles,
    ) -> bool {
        let relative = parts.path();
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
            let Some(base_path) = &object.base_path else {
                is_ignored = match &object.ignore_lines {
                    Some(lines) => lines.is_ignored(relative, is_ignored),
                    None => is_ignored_by(ignores, parts, is_ignored),
                };
                continue;
            };
            let computed =
                || paths::relative_to_base(base_path, &paths::resolve(&self.base_path, relative));
            let known = entry.and_then(|it| it.path_relative_to_object(index));
            debug_assert!(known.as_ref().is_none_or(|it| *it == computed()));
            let mut own = known.unwrap_or_else(computed);
            if own.is_empty() || paths::is_external(&own) {
                continue;
            }
            if relative.ends_with(b"/") {
                own.push(b'/');
            }
            is_ignored = match &object.ignore_lines {
                Some(lines) => lines.is_ignored(&own, is_ignored),
                None => is_ignored_by(ignores, &Candidate::new(&own), is_ignored),
            };
        }
        is_ignored
    }

    /// The path that patterns match against for `path`, which is absolute: it's relative to the base path. In oxlint
    /// nothing is outside a config, so a path outside the base path is matched as an absolute path.
    fn relative(&self, path: &[u8]) -> Vec<u8> {
        let relative = paths::relative_to_base(&self.base_path, path);
        match self.prefers_typescript_rules && paths::is_external(&relative) {
            true => paths::rooted(path),
            false => relative,
        }
    }

    /// True if `path`, which is absolute, is outside the base path. ESLint ignores such files.
    pub fn is_outside(&self, path: &[u8]) -> bool {
        paths::is_external(&self.relative(path))
    }

    /// `directory` is absolute.
    pub fn see(&self, directory: &[u8]) -> Seen {
        let before_name = paths::relative_to_base_before_name(&self.base_path, directory);
        let before_name = before_name.map(|seen| {
            if !(self.prefers_typescript_rules && paths::is_external(&seen)) {
                return seen;
            }
            let mut rooted = paths::rooted(directory);
            if !rooted.ends_with(b"/") {
                rooted.push(b'/');
            }
            rooted
        });
        let objects = self.objects.iter().zip(0..);
        let by_objects = before_name.iter().flat_map(|before_name| {
            let with_base_paths = objects.clone().filter(|it| it.0.base_path.is_some());
            with_base_paths.map(|(it, index)| (index, it.see(self, directory, before_name)))
        });
        Seen {
            by_objects: by_objects.collect(),
            before_name,
        }
    }

    /// For the entries of `directory`, which is absolute. `seen` is [`Config::see`] for it.
    pub fn within<'c>(&'c self, directory: &[u8], seen: &'c Seen) -> Within<'c> {
        debug_assert_eq!(*seen, self.see(directory));
        Within {
            config: self,
            seen,
            before_name: seen.before_name.as_deref().map(Candidate::new),
            name_at: directory.len() + usize::from(!directory.ends_with(b"/")),
            relative: seen.before_name.clone().unwrap_or_default(),
            merged: None,
            directory_verdicts: DirectoryVerdicts::default(),
            known: Known::default(),
            missing_frameworks: Frameworks::empty(),
        }
    }

    /// [`Config::is_directory_ignored`] for a directory inside the base path whose ancestors are known not to be
    /// ignored.
    fn is_directory_ignored_in(&self, directory: &[u8], dotfiles: Dotfiles) -> bool {
        let mut relative = self.relative(directory);
        if relative.is_empty() {
            return false;
        }
        if paths::is_external(&relative) {
            return true;
        }
        relative.push(b'/');
        self.is_ignored_globally(&relative, dotfiles)
    }

    /// True if a file inside the base path is ignored. Assumes the containing directory isn't.
    fn is_file_ignored_in(&self, file: &[u8], dotfiles: Dotfiles) -> bool {
        self.is_ignored_globally(&self.relative(file), dotfiles)
    }

    /// ESLint's `isDirectoryIgnored`. `directory` is absolute.
    pub fn is_directory_ignored(&self, directory: &[u8], dotfiles: Dotfiles) -> bool {
        let relative = self.relative(directory);
        if relative.is_empty() {
            return false;
        }
        if paths::is_external(&relative) {
            return true;
        }
        // A directory is ignored if one of its ancestors is.
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
        self.get_with_frameworks(registry, file, Frameworks::all())
    }

    /// Like [`Config::get`], but skips config objects whose [`ConfigObject::required_framework`] isn't in `detected`, the
    /// frameworks the file's project uses.
    pub fn get_with_frameworks(
        &self,
        registry: &Registry,
        file: &[u8],
        detected: Frameworks,
    ) -> FileConfig {
        let relative = self.relative(file);
        if paths::is_external(&relative) {
            return FileConfig::External;
        }
        let is_ignored = || {
            self.is_directory_ignored(paths::dirname(file), Dotfiles::AsConfigured)
                || self.is_ignored_globally(&relative, Dotfiles::AsConfigured)
        };
        if !self.lints_all_named_files && is_ignored() {
            return FileConfig::Ignored;
        }
        // ESLint 8 lints every file it's given, whatever its name.
        let missing = self.missing_frameworks(detected);
        self.get_if(registry, file, !self.is_legacy, missing)
    }

    /// The same for a file that's known to be inside the base path and not ignored: the code that walks the directories
    /// has already called [`Config::is_directory_ignored`] on the way.
    pub fn get_unless_ignored(&self, registry: &Registry, file: &[u8]) -> FileConfig {
        self.get_if(registry, file, true, Frameworks::empty())
    }

    /// With `must_match`, a file that no `files` matches has no config. `missing` is [`Config::missing_frameworks`].
    fn get_if(
        &self,
        registry: &Registry,
        file: &[u8],
        must_match: bool,
        missing: Frameworks,
    ) -> FileConfig {
        let relative = self.relative(file);
        match self.matching(file, &Candidate::new(&relative), None, must_match) {
            Some(mut matching) => {
                self.remove_unmet(&mut matching, missing);
                FileConfig::Matched(self.resolved(registry, &matching))
            }
            None => FileConfig::Unconfigured,
        }
    }

    /// Frameworks that some config object requires and that aren't in `detected`.
    fn missing_frameworks(&self, detected: Frameworks) -> Frameworks {
        let required = self.objects.iter().map(|it| it.required_framework);
        required.fold(Frameworks::empty(), Frameworks::union) - detected
    }

    /// Removes the config objects that require one of the `missing` frameworks from `indices`.
    fn remove_unmet(&self, indices: &mut Indices, missing: Frameworks) {
        if missing.is_empty() {
            return;
        }
        indices.retain(|index| {
            let object = self.objects.get(*index as usize);
            !object.is_some_and(|it| it.required_framework.intersects(missing))
        });
    }

    /// The merged result of the objects at `indices`.
    fn resolved(&self, registry: &Registry, indices: &[u32]) -> Arc<ResolvedConfig> {
        self.cache
            .resolved(indices, || self.merge(registry, indices))
    }

    /// The objects that apply to `file`. `parts` is its [`Config::relative`]. `None` means it has no config.
    fn matching(
        &self,
        file: &[u8],
        parts: &Candidate,
        entry: Option<&Entry>,
        must_match: bool,
    ) -> Option<Indices> {
        let mut matching = Indices::new();
        let mut is_matched = false;
        let listed = self.heads.of(parts.path());
        let extension_matches = self.heads.extension_matches(parts.path());
        if must_match && !extension_matches.can_be_linted {
            return None;
        }
        let by_extension = &extension_matches.can_match;
        for (index, object) in self.objects.iter().enumerate() {
            if !has_bit(&by_extension.objects, index)
                || (listed.as_ref()).is_some_and(|found| !self.heads.allows_object(found, index))
            {
                continue;
            }
            // Already computed for another file in the directory.
            let directory_entry =
                entry.filter(|_| has_bit(&self.heads.directory_only_objects, index));
            if let Some((applies, is_linted)) =
                directory_entry.and_then(|it| it.directory_verdict(index))
            {
                if applies {
                    matching.push(index as u32);
                }
                is_matched |= is_linted;
                continue;
            }
            let own = object.base_path.as_ref().map(|base_path| {
                let known = entry.and_then(|it| it.path_relative_to_object(index));
                debug_assert!(
                    (known.as_ref())
                        .is_none_or(|it| *it == paths::relative_to_base(base_path, file))
                );
                known.unwrap_or_else(|| paths::relative_to_base(base_path, file))
            });
            if own.as_ref().is_some_and(|it| paths::is_external(it)) {
                continue;
            }
            let ignores = object.ignores.as_deref();
            // Returns whether the object applies, and whether that makes ESLint lint the file.
            let status = |parts: &Candidate| -> (bool, bool) {
                let Some(files) = &object.files else {
                    let is_ignored = || ignores.is_some_and(|it| is_ignored_by(it, parts, false));
                    return (!object.is_global_ignores && !is_ignored(), false);
                };
                let can_match = (files.iter().enumerate())
                    .filter(|it| {
                        has_bit(&by_extension.elements, self.heads.element(index, it.0))
                            && (listed.as_ref())
                                .is_none_or(|found| self.heads.allows(found, index, it.0))
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
                Some(own) => status(&Candidate::new(own)),
                None => status(parts),
            };
            if let Some(entry) = directory_entry {
                entry
                    .directory_verdicts
                    .borrow_mut()
                    .push((index as u32, applies, is_linted));
            }
            if applies {
                matching.push(index as u32);
            }
            is_matched |= is_linted;
        }
        (is_matched || !must_match).then_some(matching)
    }

    /// [`ConfiguredRule::reported_as`]. `builtin_plugin` is the plugin that the config writes the rule with.
    fn reported_as(
        &self,
        registry: &Registry,
        entry: &'static RuleEntry,
        builtin_plugin: Option<Plugin>,
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
            || is_in(Plugin::TypeScript) && builtin_plugin == Some(Plugin::TypeScript)
        {
            return meta;
        }
        (registry.get(Plugin::Eslint, meta.name.as_bytes())).map_or(meta, |it| it.meta)
    }

    /// ESLint's `throwRuleNotFoundError` for a plugin that exists. `plugins` are the prefixes of the file's plugins.
    fn missing_js_rule(&self, registry: &Registry, id: &[u8], plugins: &[&[u8]]) -> Vec<u8> {
        let (prefix, name) = super::registry::parse_rule_id(id);
        let has_rule = |other: &&&[u8]| match **other {
            b"@" => registry.get(Plugin::Eslint, name).is_some() || formatting_rule(name).is_some(),
            other => match find_js_rule(&self.js_plugins, &[other, b"/", name].concat()) {
                Some(found) => found.is_some(),
                None => {
                    Plugin::from_prefix(other).is_some_and(|it| registry.get(it, name).is_some())
                }
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
        if let Some(&other) = plugins.iter().find(has_rule) {
            message.extend_from_slice(&[b" Did you mean \"", other, b"/", name, b"\"?"].concat());
        }
        message
    }

    /// ESLint's or oxlint's error for options that the schema of a JavaScript plugin's rule rejects. `lines` come from
    /// [`schema::validate_js`].
    fn js_options_error(&self, rule: &js_plugin::Rule, options: &[Json], lines: &[u8]) -> Vec<u8> {
        match self.prefers_typescript_rules {
            true => oxlint_js_options_error(rule, options, lines),
            false => [b"Key \"rules\": Key \"", &rule.id[..], b"\":\n", lines].concat(),
        }
    }

    /// Configures `rule`, a JavaScript plugin's rule, with `options`. `config` keeps the first error.
    fn js_rule(
        &self,
        config: &mut ResolvedConfig,
        rule: &Arc<js_plugin::Rule>,
        severity: Severity,
        options: Arc<[Json]>,
    ) -> ConfiguredJsRule {
        // ESLint 8 has already validated them, and accepts anything for a rule without a schema.
        let validated = match self.is_legacy {
            true => Ok(schema::with_js_defaults(rule, &options)),
            false => schema::validate_js(rule, &options),
        };
        if severity != Severity::Off
            && config.error.is_none()
            && let Err(lines) = &validated
        {
            config.error = Some(self.js_options_error(rule, &options, lines));
        }
        let configured = self.cache.js_rule(rule, &options, || {
            let options = validated.unwrap_or_else(|_| schema::with_js_defaults(rule, &options));
            js_plugin::Configured::new(Arc::clone(rule), &options)
        });
        ConfiguredJsRule {
            configured,
            severity,
            options,
            position: config.rules.len(),
        }
    }

    /// Merges the objects at `indices`, then does what the constructor of ESLint's `Config` does.
    fn merge(&self, registry: &Registry, indices: &[u32]) -> ResolvedConfig {
        let mut language_options = Json::Null;
        let mut settings: Option<Arc<Json>> = None;
        let mut linter = LinterOptions {
            report_unused_disable_directives: Severity::Off,
            ..LinterOptions::default()
        };
        let mut rules: Vec<RuleSetting> = Vec::new();
        let mut config = ResolvedConfig {
            skips_unknown_rules: self.accepts_all_plugins,
            prefers_typescript_rules: self.prefers_typescript_rules,
            has_every_rule: self.has_every_rule,
            understands_oxlint_comments: self.prefers_typescript_rules,
            ..ResolvedConfig::default()
        };
        let mut plugins: Vec<&[u8]> = Vec::new();
        // The indices of the file's plugins in `js_locations`, if their names don't determine that.
        let mut plugin_indices: Vec<u32> = Vec::new();
        let prefix_at =
            |plugin_index: u32| self.js_locations.get(plugin_index as usize).map(|it| &it.0);
        // In oxlint, `categories` only applies to the plugins that overrides add if one of the overrides lists a
        // different set of plugins than all the plugins that are on for the file.
        let override_sets = || {
            let objects = indices.iter();
            objects.filter_map(|index| self.objects.get(*index as usize)?.override_plugin_sets)
        };
        let all_plugins = override_sets().fold(0, |all, (own, files_set)| all | own | files_set);
        let have_categories = override_sets().any(|(own, _)| own != all_plugins);
        for object in indices
            .iter()
            .filter_map(|index| self.objects.get(*index as usize))
        {
            if object.error.is_some() {
                config.error.clone_from(&object.error);
                return config;
            }
            let object_plugins = object.plugins.iter().chain(&object.foreign_plugins);
            plugins.extend(object_plugins.map(|it| &it[..]));
            for &plugin_index in object.js_plugins.iter().filter(|_| self.has_twins) {
                let is_twin =
                    |it: &u32| *it != plugin_index && prefix_at(*it) == prefix_at(plugin_index);
                if let Some(prefix) =
                    prefix_at(plugin_index).filter(|_| plugin_indices.iter().any(is_twin))
                {
                    let start = b"Key \"plugins\": Cannot redefine plugin \"";
                    config.error = Some([&start[..], &prefix[..], &b"\"."[..]].concat());
                    return config;
                }
                plugin_indices.push(plugin_index);
            }
            let merge_into = match self.is_legacy {
                true => eslintrc::merge_into,
                false => merge::deep_merge_into,
            };
            merge_into(&mut language_options, &object.language_options);
            if let Some(object_settings) = &object.settings {
                if settings.is_none() && merge_is_identity(object_settings, self.is_legacy) {
                    settings = Some(Arc::clone(object_settings));
                } else {
                    let merged = settings.get_or_insert_with(|| Arc::new(Json::Null));
                    merge_into(Arc::make_mut(merged), object_settings);
                }
            }
            linter.merge_json(&object.linter_options);
            match self.is_legacy {
                true => eslintrc::merge_rules(&mut rules, &object.rules),
                false => {
                    let skipped = match object.override_plugin_sets.is_some() && !have_categories {
                        true => object.rules.iter().take_while(|it| it.yields).count(),
                        false => {
                            let category_plugins = object.without_rules.iter();
                            category_plugins.for_each(|it| config.skip_rules_of(*it));
                            0
                        }
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
        // Other languages validate their own options.
        match config.is_javascript() {
            true => config.validate_language_options(&language_options),
            false => config.other_language_options = Some(language_options.clone()),
        }
        let language = self.language_of(registry, &config, &plugins);
        let line_breaks = language.map_or_else(Default::default, |it| it.0.line_breaks());
        let dialect = match language {
            Some((language, name)) => match language.configure(name, &language_options) {
                Ok(configured) => Some(Dialect {
                    language,
                    configured,
                }),
                Err(Rejection::Invalid(message)) => {
                    config.error = Some([&b"Key \"languageOptions\": "[..], &message].concat());
                    None
                }
                Err(Rejection::NeedsPackage) => None,
            },
            None => None,
        };
        config.line_breaks = line_breaks;
        let env_tables = match (self.is_legacy, self.prefers_typescript_rules) {
            (true, _) => Tables::Eslint8,
            (false, true) => Tables::Oxlint,
            (false, false) => Tables::Today,
        };
        let settings = settings.unwrap_or_else(|| Arc::new(Json::Null));
        // oxlint has no such setting.
        config.has_unknown_resolver =
            !self.prefers_typescript_rules && flat::settings_have_unknown_resolver(&settings);
        let make = || GlobalsFromOptions::new(&language_options, env_tables);
        let globals = self.cache.globals(&language_options, make);
        config.language = LanguageOptions::from_json_with(&language_options, settings, globals);
        // oxlint has no `parser`.
        config.language.rejects_what_parser_rejects = !self.prefers_typescript_rules;
        config.language.is_oxlint = self.prefers_typescript_rules;
        config.language.has_no_foreign_config = self.has_every_rule;
        config.language.has_oxc_scopes = self.prefers_typescript_rules;
        config.language.eslint_8 = eslint_8;
        config.language.eslint_major = self.eslint_major;
        config.language.without_modules = self.without_modules;
        config.language.infers_globals = self.infers_globals;
        let decides_by_syntax = self.has_every_rule
            && match config.language.resolve_source_type(&language_options) {
                Ok(decides_by_syntax) => decides_by_syntax,
                Err(message) => {
                    config.error.get_or_insert(message);
                    false
                }
            };
        let parser_location = (indices.iter().rev())
            .find_map(|index| self.objects.get(*index as usize)?.parser_location.as_ref());
        // Excludes the plugins that the file replaces with another plugin of the same name.
        let belongs_to_file = |plugin_index: u32| {
            plugin_indices.contains(&plugin_index)
                || !plugin_indices
                    .iter()
                    .any(|it| prefix_at(*it) == prefix_at(plugin_index))
        };
        let js_plugins: Cow<[Arc<js_plugin::Plugin>]> = match self.has_twins {
            false => Cow::Borrowed(&self.js_plugins),
            true => (self.js_plugins.iter().zip(&self.js_plugin_location_indices))
                .filter(|it| belongs_to_file(*it.1))
                .map(|it| Arc::clone(it.0))
                .collect(),
        };
        let js_locations: Cow<[(Box<[u8]>, Json)]> = match self.has_twins {
            false => Cow::Borrowed(&self.js_locations),
            true => (self.js_locations.iter().zip(0..))
                .filter(|it| belongs_to_file(it.1))
                .map(|it| it.0.clone())
                .collect(),
        };
        config.linter = linter;
        config.parser_name = (language_options.get(b"parser"))
            .and_then(Json::as_str)
            .map(Box::from);
        config.changes_linter = (indices.iter())
            .any(|index| (self.objects.get(*index as usize)).is_some_and(|it| it.changes_linter));
        if config.may_route_to_eslint() && !config.changes_linter {
            config.for_eslint = for_eslint::build(&for_eslint::Parts {
                language: config.language_name.as_deref(),
                language_options: &language_options,
                settings: &config.language.settings,
                linter,
                rules: &rules,
                parser: parser_location.filter(|it| it.get(b"module").is_some()),
                plugins: &plugins,
                locations: &js_locations,
                js_plugins: &js_plugins,
            })
            .map(Arc::new);
        }
        for setting in rules {
            // ESLint's `throwRuleNotFoundError`, where it's certain that ESLint has no such rule.
            if setting.severity != Severity::Off
                && !self.accepts_all_plugins
                && !self.has_every_rule
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
                    plugin
                        if Plugin::from_prefix(plugin).is_some_and(Plugin::is_always_available) =>
                    {
                        None
                    }
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
            // In ESLint 8 that's a message in every file.
            let eslint_8 = config.language.eslint_8.as_ref();
            if eslint_8.is_some_and(|it| it.lacks_rule(&setting.id, &js_plugins)) {
                if setting.severity != Severity::Off {
                    config.missing_rules.push(setting.id);
                }
                continue;
            }
            let foreign = &config.foreign_plugins;
            if !self.prefers_typescript_rules
                && let Some(rule) =
                    find_formatting_rule(registry, &setting.id, foreign, &js_plugins)
            {
                if setting.severity != Severity::Off {
                    config.skipped = Skipped::Any;
                }
                config.formatting_rules.push(FormattingRule {
                    rule,
                    severity: setting.severity,
                    options: setting.options,
                    position: (config.rules.len(), config.js_rules.len()),
                });
                continue;
            }
            // A plugin in `jsPlugins` hides a built-in plugin with the same name.
            let js = find_js_rule(&js_plugins, &setting.id);
            let prefix = super::registry::parse_rule_id(&setting.id).0;
            // Except for a rule written with oxlint's name for the built-in plugin (`node/..`), or one that comes from
            // a category.
            let is_native_for_oxlint =
                self.prefers_typescript_rules && setting.builtin_plugin.is_some();
            let is_hidden = js.is_some()
                && self.accepts_all_plugins
                && !is_native_for_oxlint
                && !config.prefers_native_rules_of(registry, prefix);
            let native = match is_hidden {
                true => None,
                false => config.find_rule(registry, &setting.id),
            };
            // An extra instance of a rule, under a name. If one of the config's plugins has the prefix, the name
            // belongs to that plugin instead.
            let is_free = native.is_none()
                && js.is_none()
                && !config.foreign_plugins.iter().any(|it| **it == *prefix);
            let base = match is_free {
                true => registry.base_of(&setting.id),
                false => None,
            };
            let name: Option<Arc<[u8]>> = base.map(|_| Arc::from(&setting.id[..]));
            let entry = match (native.or(base), js) {
                (Some(entry), _) => entry,
                (None, Some(Some(rule))) => {
                    let options = setting.options.into();
                    let rule = self.js_rule(&mut config, rule, setting.severity, options);
                    config.js_rules.push(rule);
                    continue;
                }
                (None, Some(None)) => {
                    if setting.severity != Severity::Off && config.error.is_none() {
                        config.error = Some(self.missing_js_rule(registry, &setting.id, &plugins));
                    }
                    continue;
                }
                (None, None) => {
                    if setting.severity != Severity::Off {
                        config.skip(prefix == b"jsdoc");
                    }
                    continue;
                }
            };
            let (options, defaults): (Arc<[Json]>, _) = (setting.options.into(), setting.defaults);
            // Many configs have the same options for a rule. A config that has an error, or has the rule off, doesn't
            // validate anything.
            let is_validated =
                !options.is_empty() && config.error.is_none() && setting.severity != Severity::Off;
            let index = is_validated.then(|| registry.index_of(entry)).flatten();
            if !self.is_legacy && !index.is_some_and(|it| self.cache.is_valid(it, &options)) {
                config.validate(entry, name.as_deref(), setting.severity, &options);
                if let Some(index) = index.filter(|_| config.error.is_none()) {
                    self.cache.set_valid(index, &options);
                }
            }
            let or_else = match js.flatten().filter(|_| entry.meta.hands_back) {
                Some(rule) => {
                    let location = js_locations.iter().find(|it| *it.0 == *prefix);
                    let module = location.and_then(|it| it.1.get(b"module")?.as_str());
                    if setting.severity != Severity::Off && config.package_module.is_none() {
                        config.package_module = module.map(Arc::from);
                    }
                    Some(self.js_rule(&mut config, rule, setting.severity, Arc::clone(&options)))
                }
                None => None,
            };
            let reported_as = self.reported_as(registry, entry, setting.builtin_plugin);
            config.has_named_rules |= name.is_some();
            config.may_hand_back |= or_else.is_some() && setting.severity != Severity::Off;
            config.rules.push(
                ConfiguredRule::new(entry, setting.severity, options)
                    .with_defaults(defaults)
                    .report_as(reported_as)
                    .named(name)
                    .or(or_else),
            );
        }
        if self.prefers_typescript_rules {
            let makes_variables = |it: &ConfiguredRule| {
                it.severity != Severity::Off && it.entry.meta.name == "no-unused-vars"
            };
            config.language.parser_tracks_names = !config.rules.iter().any(makes_variables);
            let lacking = (config.rules.iter()).filter(|it| {
                it.severity != Severity::Off && is_missing_in_oxlint(it.reported_as())
            });
            config.language.rules_missing_in_oxlint = lacking.map(|it| it.entry.meta).collect();
        }
        // oxlint looks up the severity of a tsgolint report by the rule's bare name, and finds ESLint's rule first if it's on.
        if self.prefers_typescript_rules {
            let is_on = |it: &ConfiguredRule, plugin: Plugin| {
                it.severity != Severity::Off && it.entry.meta.plugin == plugin
            };
            for at in 0..config.rules.len() {
                let meta = config.rules[at].entry.meta;
                if !is_on(&config.rules[at], Plugin::TypeScript)
                    || !meta.requires_types
                    || meta.extends_base_rule != Some(meta.name)
                {
                    continue;
                }
                let mut eslint_rules = config.rules.iter().filter(|it| is_on(it, Plugin::Eslint));
                if let Some(base) = eslint_rules.find(|it| it.entry.meta.name == meta.name) {
                    config.rules[at].severity = base.severity;
                }
            }
        }
        if !self.js_plugins.is_empty() {
            // ESLint looks for a rule in the plugins of the objects that apply to the file.
            let has = |it: &&Arc<js_plugin::Plugin>| {
                self.accepts_all_plugins || self.has_every_rule || plugins.contains(&&it.name[..])
            };
            config.js_plugins = js_plugins.iter().filter(has).cloned().collect();
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
        // Only set from here on, because a rule that's turned off can be configured without its plugin.
        if !self.accepts_all_plugins && !self.has_every_rule {
            let mut implemented: Vec<Plugin> = Vec::new();
            let is_foreign =
                |it: &&&[u8]| config.foreign_plugins.iter().any(|other| **other == ***it);
            let built_in = plugins.iter().filter(|it| !is_foreign(it));
            for plugin in built_in.filter_map(|it| Plugin::from_prefix(it)) {
                if !implemented.contains(&plugin) {
                    implemented.push(plugin);
                }
            }
            config.plugins = Some(implemented);
        }
        config.language.has_rule_that_requires_types = config.has_enabled(|it| it.requires_types);
        if decides_by_syntax {
            config.language.decide_by_syntax();
            let commonjs = config.language.without_module_syntax.as_deref();
            let commonjs = commonjs.filter(|_| config.js_settings.is_some());
            // There's no config file, so no object has a `$source`.
            config.js_settings_without_module_syntax =
                commonjs.map(|it| js_plugin::FileSettings::from_objects(it, &[], parser_location));
        }
        let on = || (config.rules.iter()).filter(|it| it.severity != Severity::Off);
        // ESLint 10 and later reject a rule that doesn't support the file's language.
        let unsupported = on().filter(|it| !config.supports_language(it.entry.meta));
        let unsupported: Vec<Vec<u8>> = unsupported
            .map(|it| {
                [
                    b"\n\t- \"",
                    &RuleId::Known(it.entry.meta).to_vec()[..],
                    b"\"",
                ]
                .concat()
            })
            .collect();
        // A rule that isn't specific to the language belongs to a package, or expects JavaScript that isn't there.
        let is_fully_native = on().all(|it| !it.entry.meta.languages.is_empty())
            && unsupported.is_empty()
            && (config.js_rules.iter()).all(|it| it.severity == Severity::Off)
            && config.skipped == Skipped::None
            && config.missing_rules.is_empty();
        if !unsupported.is_empty() && config.error.is_none() && self.eslint_major >= 10 {
            config.error = Some(
                [
                    b"Key \"rules\": The following rules do not support the language \"",
                    config.normalized_language_name(),
                    b"\":",
                    &unsupported.concat(),
                ]
                .concat(),
            );
        }
        config.dialect = dialect.filter(|_| is_fully_native);
        config
    }

    /// The built-in language that `config`'s `language` refers to, and its name within the plugin. `plugins` has the
    /// prefixes of the plugins that are configured for the file.
    fn language_of<'c>(
        &self,
        registry: &Registry,
        config: &'c ResolvedConfig,
        plugins: &[&[u8]],
    ) -> Option<(&'static dyn Language, &'c [u8])> {
        let full_name = config.language_name.as_deref()?;
        let slash = bun_core::strings::last_index_of_char(full_name, b'/')?;
        let (prefix, name) = (&full_name[..slash], &full_name[slash + 1..]);
        let is_built_in = plugins.contains(&prefix)
            && !config.foreign_plugins.iter().any(|it| **it == *prefix)
            && !self.is_legacy
            && !self.prefers_typescript_rules;
        let language = registry.language(Plugin::from_prefix(prefix)?, name)?;
        is_built_in.then_some((language, name))
    }
}
