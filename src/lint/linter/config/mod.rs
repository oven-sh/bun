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
//!     // Alone with `basePath`: the lines that the function is made of that `FlatCompat` puts into `ignores`.
//!     "$ignorePatterns": [".*", "!.eslintrc.*", "/dist"],
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

use super::globals::Tables;
use super::registry::{Registry, formatting_rule};
use super::resolved::{
    ConfiguredJsRule, ConfiguredRule, FormattingRule, LinterOptions, ResolvedConfig, Skipped,
    find_formatting_rule, find_js_rule,
};
use super::schema;
use crate::context::Severity;
use crate::js_plugin;
use crate::language::{GlobalsOfOptions, InferGlobals, LanguageOptions};
use crate::options::Json;
use crate::paths;
use crate::rule::{Meta, Plugin};
use crate::runner::RuleEntry;
use bun_glob::Candidate;
use cache::Cache;
pub use eslintrc::{Eslint8, LegacyFailure, LegacyFile, LegacyKind, LegacyOptions, LoadLegacy};
pub use flat::{ConfigError, LoadLocatedPlugin, NamedPlugin};
use ignore_lines::IgnoreLines;
use merge::RuleSetting;
pub use rc::{
    LoadPlugin, is_plugin_of_oxlint, oxlint_category, oxlint_lacks, oxlint_runs_on, strings_of,
};
pub(crate) use rc::{OxlintChanges, oxlint_changes};
pub(crate) use rc::{is_rule_not_built_in, is_rule_of_oxlint};
use rustc_hash::FxHashMap;
pub use serde_json::json_for_oxlint;
pub use shape::glob_refusal;
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
    /// `*`, `!..`, `../*`, `../**`: it does not make ESLint lint a file that nothing else matches.
    is_universal: bool,
    /// What it matches ends with `.` and one of these, [packed](packed_extension). Empty: it cannot be told.
    extensions: SmallVec<[u64; 8]>,
    /// It is `**/*.` and `extensions`, so it says the same about all files of a directory that have the same extension.
    is_by_extension: bool,
    /// It ends with `/**`, so it says the same about all files of a directory.
    is_about_directory: bool,
    /// Of `**/*{.,_}{test,spec}.{js,ts}`, a pattern that only asks what the name of a file ends with, and gives a choice more
    /// than once: the parts after `**/*`, the last one first, each with what it can be. Otherwise empty.
    ending: Vec<SmallVec<[Box<[u8]>; 8]>>,
}

/// [`Pattern::ending`] of a pattern without a leading `!`.
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
        // Braces around one text are no choice.
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

/// Whether `name` ends with one text of each of `parts`, the last one first.
fn ends_with_all(name: &[u8], parts: &[SmallVec<[Box<[u8]>; 8]>]) -> bool {
    let Some((last, before)) = parts.split_first() else {
        return true;
    };
    last.iter().any(|text| {
        // They are a few bytes, and most differ in the last one.
        name.len() >= text.len()
            && name
                .iter()
                .rev()
                .zip(text.iter().rev())
                .all(|(a, b)| a == b)
            && ends_with_all(&name[..name.len() - text.len()], before)
    })
}

/// An extension of 8 bytes at most as a number.
fn packed_extension(extension: &[u8]) -> Option<u64> {
    let mut bytes = [0; 8];
    bytes.get_mut(..extension.len())?.copy_from_slice(extension);
    Some(u64::from_le_bytes(bytes))
}

/// [`Pattern::extensions`] of a pattern without a leading `!`: what follows its last `.`, a word or words in braces.
fn extensions_of(pattern: &[u8]) -> SmallVec<[u64; 8]> {
    let is_word = |it: &[u8]| !it.is_empty() && it.iter().all(u8::is_ascii_alphanumeric);
    let dot = bun_core::strings::last_index_of_char(pattern, b'.');
    let words: SmallVec<[&[u8]; 8]> = match dot.and_then(|at| pattern.get(at + 1..)) {
        // Braces around one word are no choice.
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
    fn new(written: &[u8]) -> Pattern {
        // `normalizePattern`
        let normalized = match written {
            [b'.', b'/', rest @ ..] => rest.to_vec(),
            [b'!', b'.', b'/', rest @ ..] => [b"!", rest].concat(),
            written => written.to_vec(),
        };
        let bangs = normalized.iter().take_while(|it| **it == b'!').count();
        let says_what_it_matches = bangs == 0 && !normalized.starts_with(b"#");
        let extensions = match says_what_it_matches {
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
            is_about_directory: says_what_it_matches && normalized.ends_with(b"/**"),
            ending: match says_what_it_matches {
                true => ending_of(&normalized),
                false => Vec::new(),
            },
        }
    }

    /// A `files` or `excludeFiles` pattern from an override in an `.oxlintrc.json`.
    fn of_oxlint(written: &[u8]) -> Pattern {
        Pattern::of_override(bun_glob::Pattern::of_oxc_glob_set(written))
    }

    /// A `files` or `excludeFiles` pattern from `[[lint.overrides]]` in bunfig.toml.
    fn of_bunfig(written: &[u8]) -> Pattern {
        Pattern::of_override(bun_glob::Pattern::of_bunfig(written))
    }

    /// A leading `!` inverts the pattern. Unlike in ESLint, it never un-ignores a file. An override never makes a file linted.
    fn of_override(matcher: bun_glob::Pattern) -> Pattern {
        Pattern {
            matcher,
            is_negated: false,
            is_inverted: false,
            is_comment: false,
            matches_without_slash: false,
            is_universal: true,
            extensions: SmallVec::new(),
            is_by_extension: false,
            is_about_directory: false,
            ending: Vec::new(),
        }
    }

    /// What `matcher` says about a file, where [`Pattern::ending`] tells. `**` doesn't go through a `.` or a `..`.
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

    /// `flip_negate`: a `!` at the start of the pattern is left out of the answer. Only ESLint asks for that.
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
    /// One of these must match: all patterns of it.
    files: Option<Vec<Vec<Pattern>>>,
    ignores: Option<Vec<Pattern>>,
    /// `ignorePatterns` of oxlint or of ESLint 8, which it has in place of `ignores`.
    ignore_lines: Option<IgnoreLines>,
    /// It has `ignores` and nothing else: what it ignores is ignored altogether.
    is_global_ignores: bool,
    /// `ignorePatterns` of oxlint, which say nothing about what is outside of the base path.
    ignores_inside_only: bool,
    language_options: Json,
    linter_options: Json,
    /// If it is an object. The files for which no other object has any share it.
    settings: Option<Arc<Json>>,
    rules: Vec<RuleSetting>,
    /// The prefixes of the plugins that are implemented here.
    plugins: Vec<Box<[u8]>>,
    /// The prefixes of the plugins that are not implemented here.
    foreign_plugins: Vec<Box<[u8]>>,
    /// `$jsPlugins`: where each is in [`Config::js_locations`].
    js_plugins: Vec<u32>,
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
    /// `$forReact`, which `bun lint`'s default config sets. See [`ResolvedConfig::outside_of_react`].
    is_for_react: bool,
    /// Of an override of oxlint that has `plugins`: those, and those of the files, as sets. The settings at the start of its
    /// `rules` that yield are what `categories` turn on.
    plugins_of_override: Option<(u32, u32)>,
    /// The plugins [none of whose rules is here](Plugin::has_no_rules), of which `categories` of oxlint turn rules on.
    without_rules: Vec<Plugin>,
}

impl ConfigObject {
    /// Whether it is for a file depends on the directory alone.
    fn is_about_directories(&self) -> bool {
        let mut patterns = self.files.iter().flatten().flatten();
        self.files.is_some() && self.ignores.is_none() && patterns.all(|it| it.is_about_directory)
    }

    /// What it sees of the entries of `directory`, which is absolute, if it has a base path of its own. `before_name`: of
    /// [`Config::relative`].
    fn see(&self, config: &Config, directory: &[u8], before_name: &[u8]) -> BeforeName {
        let base_path = self.base_path.as_ref()?;
        match self.is_global_ignores {
            // As `is_ignored_globally_as` makes it.
            true => paths::relative_to_base_before_name(
                base_path,
                &paths::resolve(&config.base_path, before_name),
            ),
            false => paths::relative_to_base_before_name(base_path, directory),
        }
    }

    /// What it keeps of `settings` as they are written.
    fn settings_of(written: Json) -> Option<Arc<Json>> {
        matches!(written, Json::Object(_)).then(|| Arc::new(written))
    }
}

/// Whether `settings` merged into none are the same again: `__proto__` is left out, and of a key that is there twice a flat
/// configuration has one.
fn stay_as_they_are(settings: &Json, is_legacy: bool) -> bool {
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
            is_for_react: false,
            plugins_of_override: None,
            without_rules: Vec::new(),
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
    /// For each extension that a pattern ends with, [packed](packed_extension): what can match a file that has it.
    by_extension: Vec<(u64, OfExtension)>,
    /// The same for a file with any other extension, or without one.
    without_extension: OfExtension,
    /// A bit for each object that is [about directories](ConfigObject::is_about_directories).
    about_directories: Bits,
    /// The patterns in `files` that look at more of the name of a file than its extension. `None`: the objects that are for a
    /// file don't follow from what these say about it, its extension and its directory, or there are more than 64.
    by_name: Option<Vec<Place>>,
}

/// Where a pattern is: in which element of `files` of which object.
#[derive(Copy, Clone)]
struct Place {
    object: u32,
    element: u32,
    pattern: u32,
}

/// What [`Heads::by_name`] say about a file, a bit for each, with its [extension](extension_of).
type SaidOfName = (Option<u64>, u64);

/// The extension of the file at `path`, [packed](packed_extension). A `/` in it is in no extension that a pattern has.
fn extension_of(path: &[u8]) -> Option<u64> {
    let dot = bun_core::strings::last_index_of_char(path, b'.')?;
    packed_extension(path.get(dot + 1..)?)
}

type Bits = SmallVec<[u64; 4]>;

/// Where objects are in [`Config::objects`].
type Indices = SmallVec<[u32; 16]>;

fn has_bit(bits: &Bits, index: usize) -> bool {
    bits[index / 64] & (1 << (index % 64)) != 0
}

/// What is listed for a path: a bit for each element, and one for each object.
#[derive(Default)]
struct Listed {
    elements: Bits,
    objects: Bits,
}

/// What is known of the files with an extension.
#[derive(Default)]
struct OfExtension {
    can_match: Listed,
    /// One of these elements makes ESLint lint what it matches.
    can_be_linted: bool,
}

/// What a path starts with that all of `patterns` match. One of them that says so is enough.
fn heads_of(patterns: &[Pattern]) -> Option<Vec<&[u8]>> {
    let says = |it: &&Pattern| !it.is_inverted && !it.is_comment;
    patterns
        .iter()
        .filter(says)
        .find_map(|it| it.matcher.heads())
}

impl Heads {
    fn new<'o>(objects: &'o [ConfigObject]) -> Heads {
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
        let elements = || objects.iter().flat_map(|it| it.files.iter().flatten());
        // All of the patterns of an element have to match, so one that says so is enough.
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
            OfExtension {
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
        heads.about_directories = smallvec::smallvec![0; objects.len().div_ceil(64)];
        for (at, _) in (objects.iter().enumerate()).filter(|it| it.1.is_about_directories()) {
            heads.about_directories[at / 64] |= 1 << (at % 64);
        }
        let (mut by_name, mut follows) = (Vec::new(), true);
        for (at, object) in objects.iter().enumerate() {
            follows &= object.ignores.is_none() || object.is_global_ignores;
            for (element, patterns) in object.files.iter().flatten().enumerate() {
                let looks_at_name = |it: &&Pattern| !it.is_by_extension && !it.is_about_directory;
                for (pattern, _) in patterns
                    .iter()
                    .enumerate()
                    .filter(|it| looks_at_name(&it.1))
                {
                    // It would have to be asked about another path.
                    follows &= object.base_path.is_none();
                    by_name.push(Place {
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

    /// Two files of a directory for which this is the same have the same objects.
    fn said_of_name(&self, objects: &[ConfigObject], path: &Candidate) -> Option<SaidOfName> {
        let extension = extension_of(path.path());
        let mut said = 0;
        for (bit, place) in self.by_name.as_ref()?.iter().enumerate() {
            let files = objects.get(place.object as usize)?.files.as_ref()?;
            let pattern = (files.get(place.element as usize)?).get(place.pattern as usize)?;
            let can_match = pattern.extensions.is_empty()
                || extension.is_some_and(|it| pattern.extensions.contains(&it));
            said |= u64::from(can_match && pattern.matches(path, false)) << bit;
        }
        Some((extension, said))
    }

    /// What can match `path`, going by its extension.
    fn of_extension(&self, path: &[u8]) -> &OfExtension {
        let extension = extension_of(path);
        let mut known = self.by_extension.iter();
        known
            .find(|it| Some(it.0) == extension)
            .map_or(&self.without_extension, |it| &it.1)
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
        let element = self.element(object, nth);
        !self.is_listed[element] || has_bit(&found.elements, element)
    }

    /// The number of the `nth` element of `files` of `object`.
    fn element(&self, object: usize, nth: usize) -> usize {
        self.objects[object].0 as usize + nth
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
    /// [`LanguageOptions::eslint_major`]
    eslint_major: u8,
    /// [`LanguageOptions::without_modules`]
    without_modules: bool,
    /// [`LanguageOptions::infers_globals`]
    infers_globals: InferGlobals,
    /// `--no-ignore` of ESLint 8: a file that is named is linted, whatever ignores it. What is found in a directory is not.
    lints_all_that_is_named: bool,
    /// Which object has the patterns with which ESLint 8 ignores what starts with a dot.
    dot_patterns: Option<usize>,
    /// A rule of ESLint that typescript-eslint extends stands for the extension, as in oxlint.
    prefers_typescript_rules: bool,
    /// [`ResolvedConfig::has_every_rule`]
    has_every_rule: bool,
    /// `options` of an `.oxlintrc.json` and of what it extends.
    options_of_oxlint: Vec<(Vec<u8>, Json)>,
    /// [`Config::printed_for_oxlint`]
    printed_for_oxlint: Vec<(Vec<u8>, Json)>,
    notes: Vec<Vec<u8>>,
    advice: Vec<Vec<u8>>,
    unknown_rules: Vec<Box<[u8]>>,
    js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// For each, where it is in `js_locations`.
    js_plugin_places: Vec<u32>,
    /// `$jsPlugins`: where the plugin with a prefix is.
    js_locations: Vec<(Box<[u8]>, Json)>,
    /// Objects, for different files, have different plugins under one name.
    has_twins: bool,
    heads: Heads,
    cache: Cache,
}

/// What a path that a base path sees has before its last name. `None`: the base path is further down, and it is not the same for
/// all entries of the directory.
type BeforeName = Option<Vec<u8>>;

/// What a [`Config`] sees of the entries of one directory, as far as it is the same for all of them.
#[derive(PartialEq, Eq, Debug)]
pub struct Seen {
    /// Of [`Config::relative`].
    before_name: BeforeName,
    /// For each object with a base path of its own, by its index. Empty without `before_name`.
    by_objects: Vec<(u32, BeforeName)>,
}

/// A [`Config`] for the entries of one directory.
pub struct Within<'c> {
    config: &'c Config,
    seen: &'c Seen,
    /// `seen.before_name`
    before_name: Option<Candidate<'c>>,
    /// Where the name starts in the path of an entry.
    name_at: usize,
    /// [`Config::relative`] of the entry that was asked about last.
    relative: Vec<u8>,
    /// The objects that were merged last, and what they make.
    merged: Option<(Indices, Arc<ResolvedConfig>)>,
    said: Said,
    known: Known,
    /// [`Within::outside_of_react`]
    is_outside_of_react: bool,
}

/// For objects that are [about directories](ConfigObject::is_about_directories), by their index: whether it is for the files of
/// the directory, and whether that makes ESLint lint them.
type Said = std::cell::RefCell<SmallVec<[(u32, bool, bool); 2]>>;

/// [`Config::matching`] for the files of the directory, by [`Heads::said_of_name`].
type Known = std::cell::RefCell<Vec<(SaidOfName, Option<Indices>)>>;

/// An entry of the directory of a [`Within`].
struct Entry<'w> {
    name: &'w [u8],
    seen_by_objects: &'w [(u32, BeforeName)],
    said: &'w Said,
    known: &'w Known,
}

impl Entry<'_> {
    /// What the object at `index`, which has a base path of its own, sees of it, if that is known.
    fn seen_by(&self, index: usize) -> Option<Vec<u8>> {
        let objects = self.seen_by_objects;
        let at = objects
            .binary_search_by_key(&index, |it| it.0 as usize)
            .ok()?;
        Some([objects.get(at)?.1.as_deref()?, self.name].concat())
    }

    fn said_by(&self, index: usize) -> Option<(bool, bool)> {
        let said = self.said.borrow();
        let found = said.iter().find(|it| it.0 as usize == index)?;
        Some((found.1, found.2))
    }
}

impl Within<'_> {
    /// `is_it`: the directory is of a project that doesn't use React, so [`Within::get`] is to leave out what is for React
    /// alone. It saves making the configuration with that: see [`ResolvedConfig::outside_of_react`].
    pub fn outside_of_react(mut self, is_it: bool) -> Self {
        self.is_outside_of_react = is_it && self.config.objects.iter().any(|it| it.is_for_react);
        self
    }

    /// The entry at `path`, and what the patterns see of it, which has a slash behind it for a directory. `None`: see
    /// [`BeforeName`].
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
                seen_by_objects: &self.seen.by_objects,
                said: &self.said,
                known: &self.known,
            },
        ))
    }

    /// [`Config::see`] for the directory at `path`, an entry.
    pub fn see_below(&self, path: &[u8]) -> Seen {
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

    /// [`Config::is_directory_ignored`] for the directory at `path`, an entry, if the directory that it is in is not ignored.
    pub fn is_directory_ignored(&mut self, path: &[u8], dotfiles: Dotfiles) -> bool {
        let config = self.config;
        match self.see(path, true) {
            Some((parts, _)) if paths::is_external(parts.path()) => true,
            Some((parts, entry)) => config.is_ignored_globally_as(&parts, Some(&entry), dotfiles),
            None => config.is_directory_ignored_in(path, dotfiles),
        }
    }

    /// [`Config::get`] for the file at `path`, an entry, if the directory that it is in is not ignored.
    /// `is_selected`: a pattern among the arguments matches it. ESLint 8 lints that, whatever it is called.
    pub fn get(
        &mut self,
        registry: &Registry,
        path: &[u8],
        dotfiles: Dotfiles,
        is_selected: bool,
    ) -> FileConfig {
        let config = self.config;
        let must_match = !(is_selected && config.is_legacy);
        let matching = {
            let Some((parts, entry)) = self.see(path, false) else {
                return match config.is_file_ignored_in(path, dotfiles) {
                    _ if config.is_outside(path) => FileConfig::External,
                    true => FileConfig::Ignored,
                    false => config.get_if(registry, path, must_match),
                };
            };
            if paths::is_external(parts.path()) {
                return FileConfig::External;
            }
            if config.is_ignored_globally_as(&parts, Some(&entry), dotfiles) {
                return FileConfig::Ignored;
            }
            let matching = || config.matching(path, &parts, Some(&entry), must_match);
            let said = match must_match {
                true => config.heads.said_of_name(&config.objects, &parts),
                false => None,
            };
            let find = |said: SaidOfName| {
                let known = entry.known.borrow();
                known.iter().find(|it| it.0 == said).map(|it| it.1.clone())
            };
            match (said, said.and_then(find)) {
                (_, Some(known)) => {
                    debug_assert_eq!(known, matching());
                    known
                }
                (Some(said), None) => {
                    let made = matching();
                    entry.known.borrow_mut().push((said, made.clone()));
                    made
                }
                (None, None) => matching(),
            }
        };
        let Some(mut matching) = matching else {
            return FileConfig::Unconfigured;
        };
        if self.is_outside_of_react {
            let is_for_react = |index: u32| {
                config
                    .objects
                    .get(index as usize)
                    .is_some_and(|it| it.is_for_react)
            };
            matching.retain(|index| !is_for_react(*index));
        }
        // Most files of a directory have the same.
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

/// [`Config::in_javascript`]
pub struct InJavaScript<'c> {
    /// What the rules of the plugin in JavaScript start with.
    pub prefix: &'c [u8],
    /// The plugin here that is called the same.
    pub plugin: Plugin,
    /// How many of its rules that are on somewhere are built in.
    pub built_in: usize,
    /// How many are not.
    pub others: usize,
}

/// What oxlint says about options that the schema of a JavaScript plugin's rule doesn't allow. `lines`: of [`schema::validate_js`].
fn js_options_error_of_oxlint(rule: &js_plugin::Rule, options: &[Json], lines: &[u8]) -> Vec<u8> {
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
    /// What could not be taken over from the configuration, for the user to read.
    pub fn notes(&self) -> &[Vec<u8>] {
        &self.notes
    }

    /// The files that the parsers and the plugins in JavaScript are from, as far as they are from files of their own.
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

    /// Sets [`LanguageOptions::eslint_major`] for all files. To be called before the configuration of a file is asked for.
    pub fn follow_eslint(&mut self, major: u8) {
        self.eslint_major = major;
    }

    /// The same for [`LanguageOptions::infers_globals`].
    pub fn infer_globals(&mut self, how: InferGlobals) {
        self.infers_globals = how;
    }

    /// What the user may want to know, and nothing is wrong: a line for each.
    pub fn advice(&self) -> &[Vec<u8>] {
        &self.advice
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

    /// The plugins in `jsPlugins` of a configuration of oxlint that have the name of a plugin here, and of which a rule is on that
    /// is built in. What is written with that name runs in JavaScript, as with oxlint.
    pub fn in_javascript(&self, registry: &Registry) -> Vec<InJavaScript<'_>> {
        let mut found: Vec<InJavaScript> = Vec::new();
        let mut seen: Vec<&[u8]> = Vec::new();
        let settings = self.objects.iter().flat_map(|it| &it.rules);
        for setting in
            settings.filter(|_| self.prefers_typescript_rules && !self.js_plugins.is_empty())
        {
            let id = &setting.id[..];
            let is_on = setting.severity != Severity::Off && setting.written_for.is_none();
            if !is_on
                || seen.contains(&id)
                || find_js_rule(&self.js_plugins, id).flatten().is_none()
            {
                continue;
            }
            seen.push(id);
            let prefix = super::registry::parse_rule_id(id).0;
            let Some(plugin) = Plugin::of_oxlint_prefix(prefix) else {
                continue;
            };
            let at = found.iter().position(|it| it.prefix == prefix);
            let at = at.unwrap_or_else(|| {
                found.push(InJavaScript {
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

    /// The rules that are configured, other than as `"off"`, and do not exist here. They are
    /// skipped.
    pub fn unknown_rules(&self) -> &[Box<[u8]>] {
        &self.unknown_rules
    }

    /// `shouldIgnorePath(this.ignores, ..)`. `relative` is relative to the base path, and ends with
    /// a slash if it is a directory.
    fn is_ignored_globally(&self, relative: &[u8], dotfiles: Dotfiles) -> bool {
        self.is_ignored_globally_as(&Candidate::new(relative), None, dotfiles)
    }

    /// The same for a path that has been split.
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
            let known = entry.and_then(|it| it.seen_by(index));
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

    /// What the patterns see of `path`, which is absolute: it is relative to the base path. For oxlint nothing is outside of
    /// a configuration: what is not in the base path is matched by its absolute path.
    fn relative(&self, path: &[u8]) -> Vec<u8> {
        let relative = paths::relative_to_base(&self.base_path, path);
        match self.prefers_typescript_rules && paths::is_external(&relative) {
            true => paths::rooted(path),
            false => relative,
        }
    }

    /// Whether `path`, which is absolute, is outside of the base path. ESLint ignores what is.
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

    /// For the entries of `directory`, which is absolute. `seen`: what this configuration sees of them.
    pub fn within<'c>(&'c self, directory: &[u8], seen: &'c Seen) -> Within<'c> {
        debug_assert_eq!(*seen, self.see(directory));
        Within {
            config: self,
            seen,
            before_name: seen.before_name.as_deref().map(Candidate::new),
            name_at: directory.len() + usize::from(!directory.ends_with(b"/")),
            relative: seen.before_name.clone().unwrap_or_default(),
            merged: None,
            said: Said::default(),
            known: Known::default(),
            is_outside_of_react: false,
        }
    }

    /// [`Config::is_directory_ignored`] for a directory inside the base path of which it is known that
    /// no directory that it is in is ignored.
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

    /// Whether a file inside the base path is ignored, if the directory that it is in is not.
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
        if paths::is_external(&relative) {
            return FileConfig::External;
        }
        let is_ignored = || {
            self.is_directory_ignored(paths::dirname(file), Dotfiles::AsConfigured)
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

    /// `must_match`: a file that no `files` is for has no configuration.
    fn get_if(&self, registry: &Registry, file: &[u8], must_match: bool) -> FileConfig {
        let relative = self.relative(file);
        match self.matching(file, &Candidate::new(&relative), None, must_match) {
            Some(matching) => FileConfig::Matched(self.resolved(registry, &matching)),
            None => FileConfig::Unconfigured,
        }
    }

    /// What the objects at `indices` make.
    fn resolved(&self, registry: &Registry, indices: &[u32]) -> Arc<ResolvedConfig> {
        let is_for_all =
            |index: &u32| !(self.objects.get(*index as usize)).is_some_and(|it| it.is_for_react);
        self.cache.resolved(indices, || {
            let mut config = self.merge(registry, indices);
            if !indices.iter().all(is_for_all) {
                let others: Indices = indices.iter().copied().filter(is_for_all).collect();
                config.without_react = Some(self.resolved(registry, &others));
            }
            config
        })
    }

    /// The objects that are for `file`. `parts`: [`Config::relative`] of it. `None`: it has no configuration.
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
        let of_extension = self.heads.of_extension(parts.path());
        if must_match && !of_extension.can_be_linted {
            return None;
        }
        let by_extension = &of_extension.can_match;
        for (index, object) in self.objects.iter().enumerate() {
            if !has_bit(&by_extension.objects, index)
                || (listed.as_ref()).is_some_and(|found| !self.heads.allows_object(found, index))
            {
                continue;
            }
            // Said of another file of the directory.
            let said = entry.filter(|_| has_bit(&self.heads.about_directories, index));
            if let Some((applies, is_linted)) = said.and_then(|it| it.said_by(index)) {
                if applies {
                    matching.push(index as u32);
                }
                is_matched |= is_linted;
                continue;
            }
            let own = object.base_path.as_ref().map(|base_path| {
                let known = entry.and_then(|it| it.seen_by(index));
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
            // Whether the object applies, and whether that makes ESLint lint the file.
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
            if let Some(entry) = said {
                entry
                    .said
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
            b"@" => registry.get(Plugin::Eslint, name).is_some() || formatting_rule(name).is_some(),
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
        match self.prefers_typescript_rules {
            true => js_options_error_of_oxlint(rule, options, lines),
            false => [b"Key \"rules\": Key \"", &rule.id[..], b"\":\n", lines].concat(),
        }
    }

    /// What `options` make of `rule`, which is of a JavaScript plugin. `config` keeps the first error.
    fn js_rule(
        &self,
        config: &mut ResolvedConfig,
        rule: &Arc<js_plugin::Rule>,
        severity: Severity,
        options: Arc<[Json]>,
    ) -> ConfiguredJsRule {
        // ESLint 8 has validated them already, and takes any for a rule without a schema.
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

    /// Merges the objects at `indices`, and does what the constructor of ESLint's `Config` does.
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
        // Where the plugins of the file are in `js_locations`, if that is not plain from their names.
        let mut places: Vec<u32> = Vec::new();
        let prefix_at = |place: u32| self.js_locations.get(place as usize).map(|it| &it.0);
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
            for &place in object.js_plugins.iter().filter(|_| self.has_twins) {
                let is_twin = |it: &u32| *it != place && prefix_at(*it) == prefix_at(place);
                if let Some(prefix) = prefix_at(place).filter(|_| places.iter().any(is_twin)) {
                    let start = b"Key \"plugins\": Cannot redefine plugin \"";
                    config.error = Some([&start[..], &prefix[..], &b"\"."[..]].concat());
                    return config;
                }
                places.push(place);
            }
            let merge_into = match self.is_legacy {
                true => eslintrc::merge_into,
                false => merge::deep_merge_into,
            };
            merge_into(&mut language_options, &object.language_options);
            if let Some(of_object) = &object.settings {
                if settings.is_none() && stay_as_they_are(of_object, self.is_legacy) {
                    settings = Some(Arc::clone(of_object));
                } else {
                    let merged = settings.get_or_insert_with(|| Arc::new(Json::Null));
                    merge_into(Arc::make_mut(merged), of_object);
                }
            }
            linter.merge_json(&object.linter_options);
            match self.is_legacy {
                true => eslintrc::merge_rules(&mut rules, &object.rules),
                false => {
                    let skipped = match object.plugins_of_override.is_some() && !have_categories {
                        true => object.rules.iter().take_while(|it| it.yields).count(),
                        false => {
                            let of_categories = object.without_rules.iter();
                            of_categories.for_each(|it| config.skip_rules_of(*it));
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
        // Another language validates its own.
        if config.is_javascript() {
            config.validate_language_options(&language_options);
        }
        let whose = match (self.is_legacy, self.prefers_typescript_rules) {
            (true, _) => Tables::Eslint8,
            (false, true) => Tables::Oxlint,
            (false, false) => Tables::Today,
        };
        let settings = settings.unwrap_or_else(|| Arc::new(Json::Null));
        // oxlint has no such setting.
        config.has_unknown_resolver =
            !self.prefers_typescript_rules && flat::names_unknown_resolver(&settings);
        let make = || GlobalsOfOptions::new(&language_options, whose);
        let globals = self.cache.globals(&language_options, make);
        config.language = LanguageOptions::from_json_with(&language_options, settings, globals);
        // oxlint has no `parser`.
        config.language.refuses_what_parser_refuses = !self.prefers_typescript_rules;
        config.language.is_oxlint = self.prefers_typescript_rules;
        config.language.stands_alone = self.has_every_rule;
        config.language.has_scopes_of_oxc = self.prefers_typescript_rules;
        config.language.eslint_8 = eslint_8;
        config.language.eslint_major = self.eslint_major;
        config.language.without_modules = self.without_modules;
        config.language.infers_globals = self.infers_globals;
        let parser_location = (indices.iter().rev())
            .find_map(|index| self.objects.get(*index as usize)?.parser_location.as_ref());
        // Without the plugins in whose place the file has another of the same name.
        let is_of_file = |place: u32| {
            places.contains(&place) || !places.iter().any(|it| prefix_at(*it) == prefix_at(place))
        };
        let js_plugins: Cow<[Arc<js_plugin::Plugin>]> = match self.has_twins {
            false => Cow::Borrowed(&self.js_plugins),
            true => (self.js_plugins.iter().zip(&self.js_plugin_places))
                .filter(|it| is_of_file(*it.1))
                .map(|it| Arc::clone(it.0))
                .collect(),
        };
        let js_locations: Cow<[(Box<[u8]>, Json)]> = match self.has_twins {
            false => Cow::Borrowed(&self.js_locations),
            true => (self.js_locations.iter().zip(0..))
                .filter(|it| is_of_file(it.1))
                .map(|it| it.0.clone())
                .collect(),
        };
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
            // ESLint's `throwRuleNotFoundError`, where it can be known that ESLint has no such rule.
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
                    plugin if Plugin::of_prefix(plugin).is_some_and(Plugin::is_always_there) => {
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
            // For ESLint 8 that is a message in every file.
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
            // What `jsPlugins` names hides a plugin of the same name that is implemented here.
            let js = find_js_rule(&js_plugins, &setting.id);
            let prefix = super::registry::parse_rule_id(&setting.id).0;
            // Not what is written with a name that oxlint has for the plugin here, `node/..`, or comes from a category.
            let is_native_for_oxlint =
                self.prefers_typescript_rules && setting.written_for.is_some();
            let is_hidden = js.is_some()
                && self.accepts_all_plugins
                && !is_native_for_oxlint
                && !config.prefers_native_rules_of(registry, prefix);
            let native = match is_hidden {
                true => None,
                false => config.find_rule(registry, &setting.id),
            };
            // One more instance of a rule, under a name. A plugin of the configuration that has the prefix answers for it.
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
            // Many configurations have the same options for a rule. One that has an error, or the rule off, validates nothing.
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
            let reported_as = self.reported_as(registry, entry, setting.written_for);
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
            let lacking = (config.rules.iter())
                .filter(|it| it.severity != Severity::Off && oxlint_lacks(it.reported_as()));
            config.language.rules_that_oxlint_lacks = lacking.map(|it| it.entry.meta).collect();
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
                let mut of_eslint = config.rules.iter().filter(|it| is_on(it, Plugin::Eslint));
                if let Some(base) = of_eslint.find(|it| it.entry.meta.name == meta.name) {
                    config.rules[at].severity = base.severity;
                }
            }
        }
        if !self.js_plugins.is_empty() {
            // ESLint looks for a rule in the plugins that the objects for the file have.
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
        // From here on: a rule that is turned off can be configured without its plugin.
        if !self.accepts_all_plugins && !self.has_every_rule {
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
        config.language.has_rule_that_requires_types = config.has_enabled(|it| it.requires_types);
        config
    }
}
