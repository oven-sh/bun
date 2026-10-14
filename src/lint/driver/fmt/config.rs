//! Finds and reads the configuration of the formatter: Prettier's `resolveConfig`.
//!
//! The configuration of a file is in the first directory, from that of the file upwards, that has
//! a file of one of [`NAMES`]. `.editorconfig` files count besides, and less.
//!
//! Where the working directory has a configuration file of oxfmt, things are as in oxfmt
//! ([`Flavor::Oxfmt`]): which files are configuration files, how patterns are read, which
//! `.editorconfig` counts, and which files are ignored (`files.rs`).

use super::cli::{Options, Precedence};
use super::tailwind::SetBy;
use super::{editorconfig, tailwind};
use crate::configs::NAMES_OF_VITE;
use crate::gitignore::{self, Chain};
use crate::paths::package_of;
use crate::run::{Environment, Fatal};
use crate::{evaluate, fs, paths};
use bun_ast::Expr;
use bun_ast::expr::Data;
use bun_collections::index_sort::sort_slice;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::sort_imports::{Settings as SortSettings, SortImports};
use bun_format::tailwind::Oxc;
use bun_lint::glob::Picomatch;
use bun_lint::json::{self, Notation};
use bun_lint::linter::config::{glob_refusal, strings_of};
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::{Arc, OnceLock};

/// The names of configuration files, by priority: oxfmt's, then Prettier's `CONFIG_FILES`.
const NAMES: [&[u8]; 24] = [
    b".oxfmtrc.json",
    b".oxfmtrc.jsonc",
    b"oxfmt.config.ts",
    b"oxfmt.config.mts",
    b"package.json",
    b"package.yaml",
    b".prettierrc",
    b".prettierrc.json",
    b".prettierrc.yml",
    b".prettierrc.yaml",
    b".prettierrc.json5",
    b".prettierrc.js",
    b"prettier.config.js",
    b".prettierrc.ts",
    b"prettier.config.ts",
    b".prettierrc.mjs",
    b"prettier.config.mjs",
    b".prettierrc.mts",
    b"prettier.config.mts",
    b".prettierrc.cjs",
    b"prettier.config.cjs",
    b".prettierrc.cts",
    b"prettier.config.cts",
    b".prettierrc.toml",
];

/// How many of [`NAMES`] are oxfmt's.
const NAMES_OF_OXFMT: usize = 4;

/// Whose command line this one behaves like.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Flavor {
    Prettier,
    Oxfmt,
}

/// The options that the formatter has.
const OPTIONS: [&[u8]; 28] = [
    b"cursorOffset",
    b"parser",
    b"jsxBracketSameLine",
    b"rangeStart",
    b"rangeEnd",
    b"insertPragma",
    b"requirePragma",
    b"checkIgnorePragma",
    b"printWidth",
    b"tabWidth",
    b"useTabs",
    b"endOfLine",
    b"semi",
    b"singleQuote",
    b"jsxSingleQuote",
    b"quoteProps",
    b"trailingComma",
    b"bracketSpacing",
    b"bracketSameLine",
    b"arrowParens",
    b"objectWrap",
    b"singleAttributePerLine",
    b"experimentalOperatorPosition",
    b"experimentalTernaries",
    b"embeddedLanguageFormatting",
    b"proseWrap",
    b"htmlWhitespaceSensitivity",
    b"vueIndentScriptAndStyle",
];

/// Returns true for Prettier's own options. Flags can also set Bun's extra features.
pub(super) fn is_option_of_prettier(name: &[u8]) -> bool {
    OPTIONS.contains(&name)
}

/// Those of [`OPTIONS`] whose value is a string.
const OPTIONS_WITH_STRINGS: [&[u8]; 10] = [
    b"parser",
    b"endOfLine",
    b"quoteProps",
    b"trailingComma",
    b"arrowParens",
    b"objectWrap",
    b"experimentalOperatorPosition",
    b"embeddedLanguageFormatting",
    b"proseWrap",
    b"htmlWhitespaceSensitivity",
];

/// What else there is at the top of a configuration file of Prettier.
const OTHER_KEYS: [&[u8]; 4] = [b"$schema", b"overrides", b"plugins", b"filepath"];

/// The name [`SortSettings`] uses for `sortImports` when a flag or `[fmt]` sets it.
const SORT_IMPORTS_OF_BUN: &[u8] = b"bun.sortImports";

/// `sortTailwindcss` when a flag or `[fmt]` sets it.
const SORT_TAILWINDCSS_OF_BUN: &[u8] = b"bun.sortTailwindcss";

/// The largest number that is read. It stands for `Infinity` and for `max_line_length = off`.
pub(super) const NO_END: &[u8] = b"4294967295";

/// Options by name, with their values as they are written in JSON, a string without its quotes. The string of an option
/// that takes none has them, so that `"80"` is not 80.
type Settings = Vec<(Vec<u8>, Vec<u8>)>;

/// A pattern of an override.
struct Pattern {
    glob: bun_glob::Pattern,
    /// As it is written.
    text: Box<[u8]>,
    has_slash: bool,
}

/// An element of `overrides`.
struct Override {
    files: Vec<Pattern>,
    excluded: Vec<Pattern>,
    settings: Settings,
    /// `plugins`, if it has that.
    plugins: Option<Plugins>,
    is_oxfmt: bool,
}

/// A list of plugins.
#[derive(Default)]
struct Plugins {
    /// One of them is not built in: its options are not known here. Not `prettier-plugin-svelte`, which may be.
    names_others: bool,
    /// One of them is `prettier-plugin-tailwindcss`.
    sorts_classes: bool,
    oxc: Oxc,
    /// Those that may print what this formatter formats in another way.
    missing: Vec<Vec<u8>>,
    /// How the names of the files end that they add to what Prettier reads.
    endings: Vec<&'static [u8]>,
    /// The packages among them: not paths, not objects.
    packages: Vec<Vec<u8>>,
}

/// A configuration file that has been read.
pub(crate) struct Config {
    pub(crate) path: Vec<u8>,
    settings: Settings,
    overrides: Vec<Override>,
    /// It is oxfmt's, whose lines are 100 wide unless it says otherwise.
    is_oxfmt: bool,
    /// For the files for which no override has a list of its own.
    plugins: Plugins,
    /// `ignorePatterns` of oxfmt.
    pub(crate) ignores: Chain,
}

/// What counts for the files of a directory.
pub(crate) struct Scope {
    pub(crate) config: Option<Arc<Config>>,
    /// From the farthest to the nearest.
    editorconfigs: Vec<Arc<editorconfig::File>>,
}

impl Scope {
    pub(crate) fn has_editorconfig(&self) -> bool {
        !self.editorconfigs.is_empty()
    }
}

/// An element of oxc's `GlobSet`.
pub(crate) fn glob_of_oxc(pattern: &[u8]) -> bun_glob::Pattern {
    bun_glob::Pattern::of_oxc_glob_set(pattern)
}

/// Parses a pattern from Prettier's `overrides` or command line.
pub(crate) fn glob_of_prettier(pattern: &[u8], how: Picomatch) -> bun_glob::Pattern {
    bun_glob::Pattern::with_dots(
        &bun_lint::glob::from_picomatch(pattern, how),
        bun_glob::Dots::SkipTraversal,
    )
}

fn patterns(json: Option<&Json>, is_oxfmt: bool) -> Vec<Pattern> {
    patterns_of(strings_of(json).into_iter(), is_oxfmt)
}

fn patterns_of<'t>(all: impl Iterator<Item = &'t [u8]>, is_oxfmt: bool) -> Vec<Pattern> {
    let pattern = |text: &[u8]| Pattern {
        glob: if is_oxfmt {
            glob_of_oxc(text)
        } else {
            glob_of_prettier(text, Picomatch::Micromatch)
        },
        text: text.into(),
        has_slash: strings::contains_char(text, b'/'),
    };
    all.map(pattern).collect()
}

const PLUGIN_FOR_CLASSES: &[u8] = b"prettier-plugin-tailwindcss";
/// It reads JavaScript and TypeScript with another parser, and what is printed is the same.
const PLUGIN_OF_OXC: &[u8] = b"@prettier/plugin-oxc";
/// One version of it is built in: see [`Configs::svelte_for`].
const PLUGIN_FOR_SVELTE: &[u8] = b"prettier-plugin-svelte";

/// Who formats the Svelte in a file.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Svelte {
    Bun,
    /// The project's own, with its plugin.
    Prettier,
    Nobody,
}

pub(super) fn is_plugin_for_svelte(name: &[u8]) -> bool {
    package_of(name) == PLUGIN_FOR_SVELTE
}

/// What the last `svelte` in `settings` says: `true`, `false` or a table, which turns it on.
fn svelte_in(settings: &Settings) -> Option<bool> {
    let about_it = settings.iter().rfind(|it| it.0 == b"svelte");
    about_it.map(|it| it.1 != b"false")
}

/// What the plugins that sort imports and classes do is built in.
pub(super) fn is_built_in_plugin(name: &[u8]) -> bool {
    let name = package_of(name);
    name.ends_with(b"/prettier-plugin-sort-imports")
        || name == b"prettier-plugin-organize-imports"
        || name == PLUGIN_FOR_CLASSES
        || name == PLUGIN_OF_OXC
}

/// What an element of `plugins` names. One that is no string is a module that a configuration in JavaScript has imported,
/// which is known by what it exports.
fn name_of(plugin: &Json) -> Option<&[u8]> {
    let has =
        |export: &[u8], key: &[u8]| plugin.get(export).is_some_and(|it| it.get(key).is_some());
    match plugin.as_str() {
        None if has(b"options", b"tailwindConfig") => Some(PLUGIN_FOR_CLASSES),
        None if has(b"parsers", b"oxc") => Some(PLUGIN_OF_OXC),
        name => name,
    }
}

/// See [`Oxc`]. `plugins`: in the order of their list.
fn oxc_among<'p>(plugins: impl Iterator<Item = &'p [u8]>) -> Oxc {
    let mut oxc = Oxc::Absent;
    for name in plugins.map(package_of) {
        oxc = match (name == PLUGIN_OF_OXC, oxc) {
            (true, _) => Oxc::Behind,
            (false, Oxc::Behind) if name == PLUGIN_FOR_CLASSES => Oxc::Before,
            (false, oxc) => oxc,
        };
    }
    oxc
}

fn is_plugin_for_classes(name: &[u8]) -> bool {
    package_of(name) == PLUGIN_FOR_CLASSES
}

fn is_built_in(plugin: &Json) -> bool {
    name_of(plugin).is_some_and(is_built_in_plugin)
}

/// Plugins that add a language to Prettier, or change what it makes of one kind of file, and leave the others as they are, with
/// how the names of those files end. Without them the rest of a project is formatted the same.
const PLUGINS_FOR_LANGUAGES: [(&[u8], &[&[u8]]); 23] = [
    // Its order of the fields is not that of `sortPackageJson`, which is oxfmt's.
    (b"prettier-plugin-packagejson", &[b"/package.json"]),
    (PLUGIN_FOR_SVELTE, &[b".svelte"]),
    (b"prettier-plugin-astro", &[b".astro"]),
    (b"@prettier/plugin-pug", &[b".pug", b".jade"]),
    (b"@prettier/plugin-php", &[b".php"]),
    (
        b"@prettier/plugin-ruby",
        &[b".rb", b".rake", b".gemspec", b".rbs", b".haml"],
    ),
    (
        b"@prettier/plugin-xml",
        &[b".xml", b".svg", b".xsd", b".xsl", b".xslt", b".wsdl"],
    ),
    (b"prettier-plugin-toml", &[b".toml"]),
    (b"prettier-plugin-java", &[b".java"]),
    (b"prettier-plugin-kotlin", &[b".kt", b".kts"]),
    (
        b"prettier-plugin-sh",
        &[b".sh", b".bash", b".zsh", b"Dockerfile", b".env"],
    ),
    (b"prettier-plugin-prisma", &[b".prisma"]),
    (b"prettier-plugin-solidity", &[b".sol"]),
    (b"prettier-plugin-sql", &[b".sql"]),
    (b"prettier-plugin-rust", &[b".rs"]),
    (b"prettier-plugin-nginx", &[b".nginx", b".nginxconf"]),
    (b"prettier-plugin-ini", &[b".ini"]),
    (b"prettier-plugin-properties", &[b".properties"]),
    (b"prettier-plugin-gherkin", &[b".feature"]),
    (b"prettier-plugin-apex", &[b".cls", b".trigger", b".apex"]),
    (b"prettier-plugin-marko", &[b".marko"]),
    (b"prettier-plugin-ejs", &[b".ejs"]),
    (b"prettier-plugin-elm", &[b".elm"]),
];

fn endings_of_plugin(name: &[u8]) -> Option<&'static [&'static [u8]]> {
    PLUGINS_FOR_LANGUAGES
        .iter()
        .find(|it| it.0 == package_of(name))
        .map(|it| it.1)
}

/// Whether what is formatted without the plugin `name` may be another text than with it.
pub(super) fn is_missing_plugin(name: &[u8]) -> bool {
    !is_built_in_plugin(name) && endings_of_plugin(name).is_none()
}

/// `value` as Prettier shows it in a warning: `["a", 1]`, `{ a: true }`.
pub(super) fn write_as_shown(out: &mut Vec<u8>, value: &Json) {
    let separate = |out: &mut Vec<u8>, index: usize| {
        if index > 0 {
            out.extend_from_slice(b", ");
        }
    };
    match value {
        Json::Array(items) => {
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                separate(out, index);
                write_as_shown(out, item);
            }
            out.push(b']');
        }
        Json::Object(entries) if !entries.is_empty() => {
            out.extend_from_slice(b"{ ");
            for (index, (key, value)) in entries.iter().enumerate() {
                separate(out, index);
                let is_plain = |it: &u8| it.is_ascii_alphanumeric() || matches!(it, b'$' | b'_');
                match key.iter().all(is_plain) && !key.first().is_none_or(u8::is_ascii_digit) {
                    true => out.extend_from_slice(key),
                    false => write_json(out, &Json::String(key.clone())),
                }
                out.extend_from_slice(b": ");
                write_as_shown(out, value);
            }
            out.extend_from_slice(b" }");
        }
        _ => write_json(out, value),
    }
}

/// The object `before` with the keys of the object `after`, both as JSON. `after` if one is no object.
fn merged_objects(before: &[u8], after: &[u8]) -> Vec<u8> {
    let object = |text| bun_lint::json::parse(text).and_then(Json::into_object);
    let (Some(mut entries), Some(added)) = (object(before), object(after)) else {
        return after.to_vec();
    };
    for (name, value) in added {
        entries.retain(|it| it.0 != name);
        entries.push((name, value));
    }
    let mut text = Vec::new();
    write_json(&mut text, &Json::Object(entries));
    text
}

/// `experimentalTailwindcss` is the old name.
fn is_tailwind(name: &[u8]) -> bool {
    matches!(name, b"sortTailwindcss" | b"experimentalTailwindcss")
}

/// A string, or `true` or `false`, as a setting.
fn text_or_bool(value: &Json) -> Option<Vec<u8>> {
    match value {
        Json::String(text) => Some(text.clone()),
        Json::Bool(value) => Some(if *value { &b"true"[..] } else { b"false" }.to_vec()),
        _ => None,
    }
}

fn settings(json: &Json, is_oxfmt: bool) -> Settings {
    let mut settings = Vec::new();
    for (name, value) in json.as_object().unwrap_or_default() {
        let is_option = OPTIONS.contains(&&name[..]);
        let text = match value {
            // As JSON, a string too: the plugin that sorts classes refuses a value of the wrong type.
            Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_)
                if !is_oxfmt && name.starts_with(b"tailwind") =>
            {
                let mut text = Vec::new();
                write_json(&mut text, value);
                text
            }
            Json::String(text) if is_option && !OPTIONS_WITH_STRINGS.contains(&&name[..]) => {
                [b"\"", &text[..], b"\""].concat()
            }
            Json::String(text) => text.clone(),
            // For oxfmt it is as good as not there.
            Json::Null if is_option && !is_oxfmt => b"null".to_vec(),
            Json::Bool(value) => if *value { &b"true"[..] } else { b"false" }.to_vec(),
            // `Infinity` is not JSON. A YAML file can have it. No number is read that has more than 32 bits.
            Json::Number(number) if *number >= f64::from(u32::MAX) => NO_END.to_vec(),
            Json::Number(number) => {
                bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *number).to_vec()
            }
            // What is about the order of imports, as JSON.
            Json::Array(_) | Json::Object(_)
                if name == b"plugins"
                    || name.starts_with(b"importOrder")
                    || name.ends_with(b"ortImports")
                    || (is_oxfmt && is_tailwind(name)) =>
            {
                let mut text = Vec::new();
                write_json(&mut text, value);
                text
            }
            Json::Object(_)
                if name == b"sortPackageJson" || name == b"experimentalSortPackageJson" =>
            {
                let name = &b"sortPackageJson".to_vec();
                let sorts_scripts = value.get(b"sortScripts").and_then(Json::as_bool) == Some(true);
                settings.push((name.clone(), b"true".to_vec()));
                settings.push((
                    b"sortPackageJson.sortScripts".to_vec(),
                    if sorts_scripts {
                        b"true".to_vec()
                    } else {
                        b"false".to_vec()
                    },
                ));
                continue;
            }
            // On, and each of its properties by itself.
            Json::Object(properties) if name == b"jsdoc" || (is_oxfmt && name == b"svelte") => {
                settings.push((name.clone(), b"{}".to_vec()));
                for (property, value) in properties {
                    if let Some(value) = text_or_bool(value) {
                        settings.push(([&name[..], b".", &property[..]].concat(), value));
                    }
                }
                continue;
            }
            // A feature of oxfmt that is configured, and so is on.
            Json::Object(_) if is_oxfmt => b"true".to_vec(),
            // To be shown in a warning.
            Json::Array(_) | Json::Object(_) if !is_oxfmt && !OTHER_KEYS.contains(&&name[..]) => {
                let mut text = Vec::new();
                write_json(&mut text, value);
                text
            }
            _ => continue,
        };
        settings.push((name.clone(), text));
    }
    settings
}

/// The options of Prettier in `json`, but for `plugins`, as the flags of the command line have them. `None`: one of its
/// keys is no option that is known here.
pub(super) fn as_flags(json: &Json) -> Option<Vec<(&'static [u8], Vec<u8>)>> {
    settings(json, false)
        .into_iter()
        .filter(|it| it.0 != b"plugins")
        .map(|(name, value)| Some((*OPTIONS.iter().find(|it| ***it == name[..])?, value)))
        .collect()
}

impl Override {
    /// Prettier's `pathMatchesGlobs`. `relative`: from the directory of the configuration file.
    fn matches(&self, relative: &[u8]) -> bool {
        if self.is_oxfmt {
            let matches = |it: &Pattern| it.glob.matches(relative);
            return self.files.iter().any(matches) && !self.excluded.iter().any(matches);
        }
        let name = paths::basename(relative);
        [false, true].into_iter().any(|with_slashes| {
            // This is micromatch's `basename` option. For `files` patterns without a slash, `excludeFiles` patterns are
            // matched against the file name too, whether or not they have a slash themselves.
            // A pattern that equals the path character for character always matches, whatever it means as a glob.
            // micromatch checks that before it looks at `basename`.
            let matches = |it: &Pattern| {
                it.glob.matches(if with_slashes { relative } else { name }) || *it.text == *relative
            };
            self.files
                .iter()
                .filter(|it| it.has_slash == with_slashes)
                .any(matches)
                && !self.excluded.iter().any(matches)
        })
    }
}

/// Prettier's words for a `printWidth` or a `tabWidth` that is no integer. `is_flag`: it is on the command line, where
/// `value` is a text that Prettier makes a number of.
fn not_an_integer(name: &[u8], value: &[u8], is_flag: bool) -> Option<Vec<u8>> {
    let flag: &[u8] = match name {
        b"printWidth" => b"--print-width",
        b"tabWidth" => b"--tab-width",
        _ => return None,
    };
    let number = bun_core::fmt::js_string_to_number(value);
    // `tabWidth: -1` is one, and for Prettier `Infinity`.
    if number.is_infinite() || number.fract() == 0.0 {
        return None;
    }
    let mut buffer = [0; 124];
    let (name, received) = match is_flag {
        true if number.is_nan() => (flag, &b"null"[..]),
        true => (flag, bun_core::fmt::FormatDouble::dtoa(&mut buffer, number)),
        false => (name, value),
    };
    Some(
        [
            b"Invalid ",
            name,
            b" value. Expected an integer, but received ",
            received,
            b".",
        ]
        .concat(),
    )
}

/// Whether `error` is what Prettier ends the run with, and 1.
pub(super) fn is_invalid_value(error: &[u8]) -> bool {
    error.starts_with(b"Invalid ") && strings::contains(error, b" value. Expected ")
}

/// oxfmt's limits.
fn check_print_width(value: &[u8]) -> Result<(), Fatal> {
    match bun_core::fmt::parse_decimal::<u32>(value) {
        Some(1..=320) => Ok(()),
        _ => Err(Fatal(
            b"Invalid printWidth: The line width should be between 1 and 320".to_vec(),
        )),
    }
}

fn check_tab_width(value: &[u8]) -> Result<(), Fatal> {
    match bun_core::fmt::parse_decimal::<u32>(value) {
        Some(0..=24) => Ok(()),
        _ => Err(Fatal(
            b"Invalid tabWidth: The indent width should be between 0 and 24".to_vec(),
        )),
    }
}

/// `validate` of oxfmt, as far as it goes: `get`: the value of an option.
fn check_widths<'v>(get: impl Fn(&[u8]) -> Option<&'v [u8]>) -> Result<(), Fatal> {
    get(b"printWidth").map_or(Ok(()), check_print_width)?;
    get(b"tabWidth").map_or(Ok(()), check_tab_width)
}

/// `useTabs` in `settings`.
fn use_tabs_in<'s>(
    settings: impl DoubleEndedIterator<Item = (&'s [u8], &'s [u8])>,
) -> Option<bool> {
    let mut settings = settings;
    let value = settings.rfind(|it| it.0 == b"useTabs")?.1;
    Some(value == b"true")
}

/// Where the first key is that a map in `value` has for the second time. Only scalars are compared, by what they stand for:
/// `a` is `"a"`. `as_texts`: `1` is `"1"` too.
fn repeated_key(value: &Expr, as_texts: bool) -> Option<i32> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    match &value.data {
        Data::EArray(it) => (it.slice().iter()).find_map(|it| repeated_key(it, as_texts)),
        Data::EObject(it) => {
            let mut seen: Vec<Json> = Vec::new();
            for property in it.properties.iter() {
                let (Some(key), Some(value)) = (&property.key, &property.value) else {
                    continue;
                };
                let is_scalar = !matches!(key.data, Data::EArray(_) | Data::EObject(_));
                if let Some(mut scalar) = json::from_parsed(key).filter(|_| is_scalar) {
                    if as_texts && scalar.as_str().is_none() {
                        let mut text = Vec::new();
                        write_json(&mut text, &scalar);
                        scalar = Json::String(text);
                    }
                    if seen.contains(&scalar) {
                        return Some(key.loc.start);
                    }
                    seen.push(scalar);
                }
                if let Some(at) = repeated_key(value, as_texts) {
                    return Some(at);
                }
            }
            None
        }
        _ => None,
    }
}

/// The first key that a map in a text has for the second time.
struct RepeatedKey<'a> {
    /// Without a byte order mark.
    text: &'a [u8],
    /// What of `text` is before the key.
    before: &'a [u8],
}

fn before_repeated_key(text: &[u8], as_texts: bool) -> Option<RepeatedKey<'_>> {
    // Here `<<` puts the keys of another map into this one.
    if strings::contains(text, b"<<") {
        return None;
    }
    let find = |it: &Expr| repeated_key(it, as_texts);
    let at = json::with_parsed(Notation::Yaml, text, find).ok()??;
    let text = strings::without_utf8_bom(text);
    let before = text.get(..usize::try_from(at).ok()?)?;
    // A key in quotes is where its text starts.
    let before = before.strip_suffix(b"\"").unwrap_or(before);
    let before = before.strip_suffix(b"'").unwrap_or(before);
    Some(RepeatedKey { text, before })
}

/// What js-yaml, which reads YAML for ESLint 8, throws about a key that a map in `text` has twice: the message of its
/// `YAMLException`, with `makeSnippet`.
pub(crate) fn duplicated_mapping_key(text: &[u8]) -> Option<Vec<u8>> {
    use bstr::ByteSlice;
    let RepeatedKey { text, before } = before_repeated_key(text, true)?;
    let position = before.chars().count();
    let mut buffer: Vec<char> = text.chars().collect();
    if !matches!(buffer.last(), Some('\n' | '\r')) {
        buffer.push('\n');
    }
    // Where each line starts and ends.
    let mut lines: Vec<(usize, usize)> = Vec::new();
    let (mut start, mut at) = (0, 0);
    while let Some(&c) = buffer.get(at) {
        let len = match (c, buffer.get(at + 1)) {
            ('\r', Some('\n')) => 2,
            ('\n' | '\r' | '\0', _) => 1,
            _ => 0,
        };
        if len > 0 {
            lines.push((start, at));
            start = at + len;
        }
        at += len.max(1);
    }
    let found = lines.iter().position(|it| position <= it.1)?;
    let number_width = (found + 2).min(lines.len()).to_string().len();
    let half = (79 - (1 + number_width + 3)) / 2 - 1;
    let column = position - lines[found].0;
    // `getLine`: the text, and where that column is in it.
    let line = |at: usize| {
        let (mut start, mut end) = lines[at];
        let position = start + column;
        let (mut head, mut tail) = ("", "");
        if position > start + half {
            head = " ... ";
            start = position - half + head.len();
        }
        if end > position + half {
            tail = " ...";
            end = position + half - tail.len();
        }
        let shown = buffer.get(start..end).unwrap_or_default().iter();
        let shown: String = shown.map(|&c| if c == '\t' { '→' } else { c }).collect();
        let text = format!(" {:>number_width$} | {head}{shown}{tail}\n", at + 1);
        (text, (position + head.len()).saturating_sub(start))
    };
    let mut out = format!("duplicated mapping key ({}:{})\n\n", found + 1, column + 1);
    for at in found.saturating_sub(3)..found {
        out.push_str(&line(at).0);
    }
    let (text, caret) = line(found);
    out.push_str(&text);
    out.extend(std::iter::repeat_n('-', 1 + number_width + 3 + caret));
    out.push_str("^\n");
    for at in (found + 1..lines.len()).take(2) {
        out.push_str(&line(at).0);
    }
    out.pop();
    Some(out.into_bytes())
}

/// What the `yaml` package, which reads YAML for Prettier, says about a key that a map in `text` has twice: its
/// `prettifyError`.
fn repeated_key_in_yaml(text: &[u8]) -> Option<Vec<u8>> {
    use bstr::ByteSlice;
    let RepeatedKey { text, before } = before_repeated_key(text, false)?;
    let line_start = strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
    let line_end = strings::index_of_char_usize(&text[line_start..], b'\n')
        .map_or(text.len(), |it| line_start + it);
    let number = strings::count_char(before, b'\n') + 1;
    let mut column = strings::utf8_decoded_len_utf16(&before[line_start..]) as usize;
    let mut out = format!(
        "Map keys must be unique at line {number}, column {}:\n\n",
        column + 1
    );
    let chars = |it: &[u8]| it.chars().collect::<Vec<char>>();
    let written = &text[line_start..line_end];
    let mut line = chars(written.strip_suffix(b"\r").unwrap_or(written));
    if column >= 60 && line.len() > 80 {
        let cut = (column - 39).min(line.len() - 79);
        line = (['…'].into_iter())
            .chain(line[cut..].iter().copied())
            .collect();
        column -= cut - 1;
    }
    if line.len() > 80 {
        line.truncate(79);
        line.push('…');
    }
    // The line before it too, if nothing but blanks is before the key.
    if line_start > 0 && line.iter().take(column).all(|it| *it == ' ') {
        let start =
            strings::last_index_of_char(&text[..line_start - 1], b'\n').map_or(0, |it| it + 1);
        let mut above = chars(&text[start..line_start]);
        if above.len() > 80 {
            above.truncate(79);
            above.extend(['…', '\n']);
        }
        out.extend(above);
    }
    out.extend(line);
    out.push('\n');
    out.extend(std::iter::repeat_n(' ', column));
    out.push('^');
    Some(out.into_bytes())
}

/// Of a file that `--config` names: `.oxfmtrc.json`, `oxfmt.config.ts`, `config/oxfmtrc.json`.
fn is_name_of_oxfmt(name: &[u8]) -> bool {
    strings::contains(name, b"oxfmt")
}

/// Display name of the Prettier config `NAMES[at]` in `directory`, or `None` if it isn't one. Never runs the file.
fn of_prettier(directory: &[u8], at: usize) -> Option<Vec<u8>> {
    let name = *NAMES.get(at)?;
    if !name.starts_with(b"package.") {
        return Some(name.to_vec());
    }
    let package = json::parse(&fs::read(&paths::join(directory, name)).ok()?)?;
    let has_it = !matches!(package.get(b"prettier")?, Json::Null | Json::Bool(false));
    has_it.then(|| [b"prettier in ", name].concat())
}

/// Which formatters are among the dependencies of a project. That tells what one without a configuration file is
/// formatted with.
#[derive(Copy, Clone, Default)]
struct Formatters {
    oxfmt: bool,
    /// It brings oxfmt, as `vp fmt`, whose options are the `fmt` of the `vite.config.ts`.
    vite_plus: bool,
    prettier: bool,
}

impl Formatters {
    /// Those in the `package.json` nearest to `directory`.
    fn depended_on(directory: &[u8]) -> Formatters {
        let nearest = paths::ancestors(directory)
            .find_map(|it| fs::read(&paths::join(it, b"package.json")).ok())
            .and_then(|text| json::parse(&text));
        let Some(json) = nearest else {
            return Formatters::default();
        };
        let has = |name: &[u8]| {
            [&b"dependencies"[..], b"devDependencies"]
                .iter()
                .any(|key| json.get(key).is_some_and(|it| it.get(name).is_some()))
        };
        Formatters {
            oxfmt: has(b"oxfmt"),
            vite_plus: has(b"vite-plus"),
            prettier: has(b"prettier"),
        }
    }
}

impl Plugins {
    /// `json`: the options that may have `plugins`.
    fn of(json: &Json) -> Option<Plugins> {
        let plugins = json.get(b"plugins")?.as_array()?;
        Some(Plugins {
            names_others: !(plugins.iter()).all(|it| {
                is_built_in(it) || name_of(it).is_some_and(|it| package_of(it) == PLUGIN_FOR_SVELTE)
            }),
            sorts_classes: (plugins.iter().filter_map(name_of)).any(is_plugin_for_classes),
            oxc: oxc_among(plugins.iter().filter_map(name_of)),
            missing: (plugins.iter())
                .map(|it| name_of(it).unwrap_or(b"(an object)"))
                .filter(|it| is_missing_plugin(it))
                .map(<[u8]>::to_vec)
                .collect(),
            packages: (plugins.iter().filter_map(Json::as_str))
                .filter(|it| !it.starts_with(b".") && !it.starts_with(b"/"))
                .filter(|it| !it.starts_with(b"file:"))
                .map(<[u8]>::to_vec)
                .collect(),
            endings: (plugins.iter())
                .filter_map(|it| endings_of_plugin(it.as_str()?))
                .flatten()
                .copied()
                .collect(),
        })
    }
}

impl Config {
    /// What `of` makes of the last override that is for the file at `path`, of those of which it makes something.
    fn in_last_override<'s, T>(
        &'s self,
        path: &[u8],
        of: impl Fn(&'s Override) -> Option<T>,
    ) -> Option<T> {
        let overrides = self.overrides.iter().rev();
        let mut found = overrides.filter_map(|it| Some((it, of(it)?)));
        let mut relative = None;
        let is_for_it = |it: &(&Override, T)| {
            let directory = paths::dirname(&self.path);
            (it.0).matches(relative.get_or_insert_with(|| paths::relative(directory, path)))
        };
        found.find(is_for_it).map(|it| it.1)
    }

    fn new(path: &[u8], json: &Json, is_oxfmt: bool) -> Config {
        let overrides = json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default();
        let ignored: Vec<&[u8]> = (json
            .get(b"ignorePatterns")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter())
        .filter_map(Json::as_str)
        .collect();
        Config {
            path: path.to_vec(),
            settings: settings(json, is_oxfmt),
            overrides: (overrides.iter())
                .map(|it| Override {
                    files: patterns(it.get(b"files"), is_oxfmt),
                    excluded: patterns(it.get(b"excludeFiles"), is_oxfmt),
                    settings: (it.get(b"options"))
                        .map(|it| settings(it, is_oxfmt))
                        .unwrap_or_default(),
                    plugins: it.get(b"options").and_then(Plugins::of),
                    is_oxfmt,
                })
                .collect(),
            is_oxfmt,
            plugins: Plugins::of(json).unwrap_or_default(),
            ignores: gitignore::with_lines(None, paths::dirname(path), ignored.iter().copied()),
        }
    }
}

/// How to format a file.
#[derive(Default)]
pub(crate) struct Resolved {
    pub(crate) options: FormatOptions,
    /// `insertFinalNewline: false` of oxfmt.
    pub(crate) omits_final_newline: bool,
    /// One of [`Configs::unsupported_options`] is among those of the file.
    pub(crate) has_unsupported_option: bool,
    /// What oxc's parser reports and recovers from is formatted, as in the tests of its formatter. oxfmt refuses it.
    pub(crate) formats_what_has_errors: bool,
}

/// Adds what the `tsconfig.json` at `path` says about JSX, after what the files that it extends say.
fn read_tsconfig(path: &[u8], settings: &mut Settings) {
    struct Open {
        path: Vec<u8>,
        json: Json,
        /// How many of the files that it extends have been looked at.
        extended: usize,
    }
    let open = |path: Vec<u8>| {
        let json = bun_lint::json::parse(&fs::read(&path).ok()?)?;
        Some(Open {
            path,
            json,
            extended: 0,
        })
    };
    // Each extends the next.
    let mut chain = Vec::from_iter(open(path.to_vec()));
    while let Some(last) = chain.last_mut() {
        let extended = match last.json.get(b"extends") {
            Some(one @ Json::String(_)) => std::slice::from_ref(one),
            Some(Json::Array(all)) => &all[..],
            _ => &[],
        };
        let Some(name) = extended.get(last.extended) else {
            for name in [
                &b"jsx"[..],
                b"jsxFactory",
                b"jsxFragmentFactory",
                b"reactNamespace",
            ] {
                if let Some(value) = (last.json)
                    .get(b"compilerOptions")
                    .and_then(|it| it.get(name))
                    .and_then(Json::as_str)
                {
                    let name = [b"tsconfig.", name].concat();
                    settings.retain(|it| it.0 != name);
                    settings.push((name, value.to_vec()));
                }
            }
            chain.pop();
            continue;
        };
        last.extended += 1;
        let Some(name) = name.as_str() else {
            continue;
        };
        let directory = paths::dirname(&last.path);
        let candidates = |base: Vec<u8>| {
            [
                base.clone(),
                [&base[..], b".json"].concat(),
                paths::join(&base, b"tsconfig.json"),
            ]
        };
        let found = match name.starts_with(b".") || paths::is_absolute(name) {
            true => candidates(paths::resolve(directory, name))
                .into_iter()
                .find(|it| fs::is_file(it)),
            // A package.
            false => paths::ancestors(directory)
                .flat_map(|it| candidates(paths::join(&paths::join(it, b"node_modules"), name)))
                .find(|it| fs::is_file(it)),
        };
        // Not one that extends itself.
        let found = found.filter(|found| chain.iter().all(|it| it.path != *found));
        chain.extend(found.and_then(open));
    }
}

pub(crate) type Found = Result<Arc<Scope>, Fatal>;

/// What is in a directory, of what matters for its [`Scope`].
#[derive(Default)]
struct Listed {
    /// The configuration files, as indices into [`NAMES`].
    candidates: Vec<usize>,
    has_editorconfig: bool,
    is_project_root: bool,
}

pub(crate) struct Configs<'c> {
    options: Cow<'c, Options>,
    environment: &'c Environment<'c>,
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// `[[fmt.overrides]]`. Globs are relative to `start_of_bunfig`.
    overrides: Vec<Override>,
    /// [`Options::start_of_bunfig`]
    start_of_bunfig: Vec<u8>,
    /// `--config`
    named: Option<Result<Arc<Config>, Fatal>>,
    /// [`Configs::name`]
    arguments: Guarded<Vec<Vec<u8>>>,
    /// [`Configs::lacks_file`]
    lacks_file: OnceLock<bool>,
    /// [`Configs::note`]
    note: OnceLock<Vec<u8>>,
    /// Who asks has seen to it that the configuration files of a file count.
    counts_everywhere: bool,
    pub(crate) flavor: Flavor,
    /// By directory: see [`Configs::tsconfig_of`].
    tsconfigs: Guarded<FxHashMap<Vec<u8>, Arc<Settings>>>,
    /// [`Configs::has_svelte_plugin_of_bun`]
    has_svelte_plugin_of_bun: OnceLock<bool>,
    /// How to sort imports, by the options that say so: they are read once, not for every file.
    sort_imports: Guarded<Vec<(SortSettings, Option<Arc<SortImports>>)>>,
    /// With oxfmt, the one `.editorconfig` that counts: the nearest to the working directory.
    editorconfig_of_oxfmt: Option<Arc<editorconfig::File>>,
    /// For the user.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
    /// The options that are set, change what the tool prints, and have no effect here.
    pub(crate) unsupported_options: Guarded<Vec<Vec<u8>>>,
    /// For `sortTailwindcss`.
    pub(crate) classes: Arc<tailwind::Classes>,
}

impl<'c> Configs<'c> {
    pub(crate) fn new(options: &'c Options, environment: &'c Environment<'c>) -> Configs<'c> {
        Configs::with(Cow::Borrowed(options), environment, false)
    }

    /// The bunfig whose `[fmt]` was read: its path from the working directory.
    pub(crate) fn bunfig(&self) -> Option<&[u8]> {
        (self.options.has_section_of_bunfig).then_some(&self.options.bunfig[..])
    }

    /// The same for a rule of the linter, with options that nobody else keeps. The linter says whose configuration counts.
    pub(crate) fn owning(options: Options, environment: &'c Environment<'c>) -> Configs<'c> {
        Configs::with(Cow::Owned(options), environment, true)
    }

    fn with(
        options: Cow<'c, Options>,
        environment: &'c Environment<'c>,
        counts_everywhere: bool,
    ) -> Configs<'c> {
        let (is_like_oxfmt, reads_editorconfig) = (options.is_like_oxfmt, options.editorconfig);
        let named = options.config.clone();
        // Patterns in bunfig.toml are Bun's globs. `is_oxfmt` below makes `excludeFiles` match against the path, like `files`.
        let pattern = |text: &Vec<u8>| Pattern {
            glob: bun_glob::Pattern::of_bunfig(text),
            text: text[..].into(),
            has_slash: strings::contains_char(text, b'/'),
        };
        let strings = |all: &[Vec<u8>]| all.iter().map(pattern).collect();
        let overrides = (options.overrides.iter())
            .map(|it| Override {
                files: strings(&it.files),
                excluded: strings(&it.excluded),
                settings: (it.format.iter())
                    .map(|it| (it.0.to_vec(), it.1.clone()))
                    .collect(),
                plugins: None,
                is_oxfmt: true,
            })
            .collect();
        let mut configs = Configs {
            start_of_bunfig: options.start_of_bunfig(&environment.cwd),
            options,
            overrides,
            environment,
            by_directory: Guarded::new(FxHashMap::default()),
            named: None,
            arguments: Default::default(),
            lacks_file: OnceLock::new(),
            note: OnceLock::new(),
            counts_everywhere,
            flavor: Flavor::Prettier,
            tsconfigs: Guarded::new(FxHashMap::default()),
            has_svelte_plugin_of_bun: OnceLock::new(),
            sort_imports: Guarded::new(Vec::new()),
            editorconfig_of_oxfmt: None,
            warnings: Guarded::new(Vec::new()),
            unsupported_options: Guarded::new(Vec::new()),
            classes: Arc::default(),
        };
        let mut formatters = Formatters::default();
        let mut is_oxfmt = match configs.for_directory(&environment.cwd) {
            Ok(scope) => match &scope.config {
                Some(config) => config.is_oxfmt,
                None => is_like_oxfmt.unwrap_or_else(|| {
                    formatters = Formatters::depended_on(&environment.cwd);
                    let has_oxfmt = formatters.oxfmt || formatters.vite_plus;
                    let has_prettier = formatters.prettier;
                    // Depending on both suggests a migration to oxfmt, so oxfmt wins.
                    if has_oxfmt && has_prettier {
                        configs.note.get_or_init(|| {
                            b"No config file found, and package.json depends on both oxfmt and prettier\n  Formatting like oxfmt. Add a config file to change that.".to_vec()
                        });
                    }
                    has_oxfmt
                }),
            },
            // The name of the one that cannot be used tells.
            Err(_) => paths::ancestors(&environment.cwd)
                .find_map(|directory| {
                    NAMES
                        .iter()
                        .position(|name| fs::is_file(&paths::join(directory, name)))
                })
                .is_some_and(|at| at < NAMES_OF_OXFMT),
        };
        if let Some(path) = &named {
            let path = paths::resolve(&environment.cwd, &paths::from_native(path));
            // A name that does not tell is of the tool that the project uses.
            let name = paths::basename(&path);
            is_oxfmt = is_name_of_oxfmt(name)
                || (is_oxfmt && !strings::contains(name, b"prettier") && name != b"package.json");
            configs.named = Some(match configs.load(&path, is_oxfmt) {
                Ok(Some(config)) => Ok(config),
                Ok(None) if NAMES_OF_VITE.contains(&name) => Err(Fatal(
                    [
                        b"Failed to load configuration file.\nExpected a `fmt` field in the default export of ",
                        &path[..],
                    ]
                    .concat(),
                )),
                Ok(None) => Ok(Arc::new(Config::new(&path, &Json::Null, is_oxfmt))),
                Err(error) => Err(error),
            });
        } else if is_oxfmt && formatters.vite_plus {
            // One for the whole project: the nearest from the working directory upwards that has `fmt`.
            configs.named = paths::ancestors(&environment.cwd)
                .filter_map(|directory| {
                    (NAMES_OF_VITE.iter())
                        .map(|name| paths::join(directory, name))
                        .find(|path| fs::is_file(path))
                })
                .find_map(|path| configs.load(&path, true).transpose());
        }
        if is_oxfmt {
            configs.flavor = Flavor::Oxfmt;
            // What was found on the way was found as Prettier finds it.
            configs.by_directory.get_mut().clear();
            if reads_editorconfig {
                configs.editorconfig_of_oxfmt = paths::ancestors(&environment.cwd)
                    .find_map(editorconfig::File::read_as_oxfmt)
                    .map(Arc::new);
            }
        }
        configs
    }

    /// What is wrong with the configuration that the run starts with. oxfmt stops there.
    pub(crate) fn check(&self) -> Result<(), Fatal> {
        if let Some(Err(error)) = &self.named {
            return Err(Fatal(error.0.clone()));
        }
        if self.flavor == Flavor::Oxfmt {
            // `build_and_validate`: the configuration, and the first `[*]` of the `.editorconfig` for what it leaves open.
            let scope = self.for_directory(&self.environment.cwd)?;
            let settings = (self.config_of(&scope)?.into_iter()).flat_map(|it| &it.settings);
            let settings: Vec<(&[u8], &[u8])> = settings.map(|it| (&it.0[..], &it.1[..])).collect();
            let use_tabs = use_tabs_in(settings.iter().copied());
            let of_editorconfig = (scope.editorconfigs.first())
                .map(|it| editorconfig::options_of_root_for_oxfmt(it, use_tabs))
                .unwrap_or_default();
            let of_editorconfig = of_editorconfig.iter().map(|it| (it.0, &it.1[..]));
            let all: Vec<(&[u8], &[u8])> = of_editorconfig.chain(settings).collect();
            check_widths(|name| all.iter().rfind(|it| it.0 == name).map(|it| it.1))?;
        }
        Ok(())
    }

    fn warn(&self, parts: &[&[u8]]) {
        let warning = parts.concat();
        let mut warnings = self.warnings.lock();
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }

    /// Prettier's `loadConfig`. `None`: the file has no configuration, like most `package.json`.
    fn load(&self, path: &[u8], is_oxfmt: bool) -> Result<Option<Arc<Config>>, Fatal> {
        let name = paths::basename(path);
        let read = || {
            fs::read(path).map_err(|error| {
                Fatal(
                    [
                        b"Cannot read the configuration file ",
                        path,
                        b": ",
                        &fs::describe(&error),
                    ]
                    .concat(),
                )
            })
        };
        let run = || evaluate::evaluate(self.environment, evaluate::PRETTIER, path);
        let fail = |why: &[u8]| {
            Fatal([b"Cannot load the configuration file ", path, b":\n", why].concat())
        };
        let parse = |notation| json::parse_as(notation, &read()?).map_err(|why| fail(&why));
        let json = if name == b"package.json" {
            let text = read()?;
            // Most have no such word in them.
            if !strings::contains(&text, b"\"prettier\"") {
                return Ok(None);
            }
            match json::parse(&text)
                .as_ref()
                .and_then(|it| it.get(b"prettier"))
            {
                None | Some(Json::Null | Json::Bool(false)) => return Ok(None),
                Some(config) => config.clone(),
            }
        } else if name == b"package.yaml" {
            // One that cannot be read has no configuration, as for Prettier.
            let text = read()?;
            match json::parse_as(Notation::Yaml, &text)
                .as_ref()
                .ok()
                .filter(|_| repeated_key_in_yaml(&text).is_none())
                .and_then(|it| it.get(b"prettier"))
            {
                None | Some(Json::Null | Json::Bool(false)) => return Ok(None),
                Some(config) => config.clone(),
            }
        } else if name.ends_with(b".json") || name.ends_with(b".jsonc") {
            json::parse(&read()?)
                .ok_or_else(|| Fatal([b"JSON Error in \"", path, b"\""].concat()))?
        } else if !name.iter().skip(1).any(|it| *it == b'.') {
            // `.prettierrc`, and what `--config` names without an extension, like `/dev/null`: YAML, which JSON is a part of.
            let text = read()?;
            if let Some(why) = repeated_key_in_yaml(&text) {
                return Err(fail(&why));
            }
            match json::parse(&text) {
                Some(json @ Json::Object(_)) => json,
                _ => json::parse_as(Notation::Yaml, &text).map_err(|why| fail(&why))?,
            }
        } else if name.ends_with(b".yaml") || name.ends_with(b".yml") {
            let text = read()?;
            if let Some(why) = repeated_key_in_yaml(&text) {
                return Err(fail(&why));
            }
            json::parse_as(Notation::Yaml, &text).map_err(|why| fail(&why))?
        } else if name.ends_with(b".json5") {
            parse(Notation::Json5)?
        } else if name.ends_with(b".toml") {
            parse(Notation::Toml)?
        } else {
            run()?
        };
        let json = match json {
            // The name of a package or of a file that has the configuration.
            Json::String(_) => run()?,
            Json::Bool(_) | Json::Number(_) => {
                let kind: &[u8] = match json {
                    Json::Bool(_) => b"boolean",
                    _ => b"number",
                };
                let start: &[u8] = b"Config is only allowed to be an object, but received ";
                return Err(fail(&[start, kind, b" in \"", path, b"\""].concat()));
            }
            json => json,
        };
        if matches!(json, Json::Null) {
            return Ok(None);
        }
        if json
            .get(b"plugins")
            .is_some_and(|it| it.as_array().is_none())
        {
            return Err(fail(b"\"plugins\" must be an array"));
        }
        let is_override = |it: &Json| match it.get(b"files") {
            Some(Json::String(_)) => true,
            Some(files) => (files.as_array())
                .is_some_and(|it| it.iter().all(|it| matches!(it, Json::String(_)))),
            None => false,
        };
        if json
            .get(b"overrides")
            .is_some_and(|it| !it.as_array().is_some_and(|it| it.iter().all(is_override)))
        {
            return Err(fail(
                b"\"overrides\" must be an array of objects, each with \"files\" set to a pattern or an array of patterns",
            ));
        }
        if is_oxfmt
            && let Some(refusal) = (json.get(b"overrides").and_then(Json::as_array))
                .unwrap_or_default()
                .iter()
                .flat_map(|it| [it.get(b"files"), it.get(b"excludeFiles")])
                .flat_map(strings_of)
                .find_map(glob_refusal)
        {
            return Err(Fatal(
                [&b"Failed to parse configuration.\n"[..], &refusal[..]].concat(),
            ));
        }
        let ignored = json
            .get(b"ignorePatterns")
            .and_then(Json::as_array)
            .unwrap_or_default();
        if is_oxfmt
            && let Some(pattern) = (ignored.iter().filter_map(Json::as_str))
                .find(|it| strings::split(it, b"/").any(|part| part == b".."))
        {
            return Err(Fatal(
                [
                    b"Failed to parse configuration.\nInvalid pattern `",
                    pattern,
                    b"` in `ignorePatterns`: `..` is not supported, patterns are resolved within the config file's directory",
                ]
                .concat(),
            ));
        }
        if is_oxfmt
            && let Some(line) = gitignore::refused_line(ignored.iter().filter_map(Json::as_str))
        {
            return Err(Fatal(
                [
                    b"Failed to parse configuration.\nFailed to add ignore pattern `",
                    &line[..],
                    b"` from `ignorePatterns`",
                ]
                .concat(),
            ));
        }
        let config = Config::new(path, &json, is_oxfmt);
        let of_overrides = config.overrides.iter().filter_map(|it| it.plugins.as_ref());
        let mut missing: Vec<&[u8]> = Vec::new();
        for name in [&config.plugins]
            .into_iter()
            .chain(of_overrides)
            .flat_map(|it| &it.missing)
        {
            if !missing.contains(&&name[..]) {
                missing.push(name);
            }
        }
        // Without the flag the files are left alone because of them, which is said at the end.
        if !missing.is_empty() && self.options.allow_unsupported {
            let end: &[u8] = match missing.len() {
                1 => b" has no effect because bun fmt does not include that plugin",
                _ => b" have no effect because bun fmt does not include those plugins",
            };
            self.warn(&[&missing.join(&b", "[..]), b" in ", path, end]);
        }
        Ok(Some(Arc::new(config)))
    }

    /// What counts in `directory`, whose parent has `above`. `entries`: the name of each, and whether it is a directory.
    fn scope<'n>(
        &self,
        directory: &[u8],
        entries: impl Iterator<Item = (&'n [u8], bool)>,
        above: Option<&Scope>,
    ) -> Found {
        let count = if self.flavor == Flavor::Oxfmt {
            NAMES_OF_OXFMT
        } else {
            NAMES.len()
        };
        // Prettier asks the file system for each name, and one that does not tell `A` from `a` has `.prettierrc` if
        // `.PrettierRC` is there.
        let is_called = |name: &[u8], wanted: &[u8]| {
            name == wanted
                || (name.eq_ignore_ascii_case(wanted)
                    && bun_sys::exists(&paths::join(directory, wanted)))
        };
        let mut listed = Listed::default();
        for (name, is_directory) in
            entries.filter(|it| matches!(it.0.first(), Some(b'.' | b'p' | b'o' | b'P' | b'O')))
        {
            // In a worktree `.git` is a file.
            if is_called(name, b".git") || (is_directory && is_called(name, b".hg")) {
                listed.is_project_root = true;
            } else if !is_directory && is_called(name, b".editorconfig") {
                listed.has_editorconfig = true;
            } else if !is_directory {
                listed.candidates.extend(
                    NAMES
                        .iter()
                        .position(|it| is_called(name, it))
                        .filter(|at| *at < count),
                );
            }
        }
        self.scope_of(directory, listed, above)
    }

    /// What counts in `directory`, which has `listed`, and whose parent has `above`.
    fn scope_of(&self, directory: &[u8], listed: Listed, above: Option<&Scope>) -> Found {
        let Listed {
            mut candidates,
            has_editorconfig,
            is_project_root,
        } = listed;
        let mut config = above.and_then(|it| it.config.clone());
        if self.named.is_none() && self.options.config_lookup && self.counts_in(directory) {
            // One after the other: a `package.json` need not have a configuration.
            sort_slice(&mut candidates[..]);
            candidates.dedup();
            if let [first, second, ..] = candidates[..]
                && second < NAMES_OF_OXFMT
            {
                return Err(Fatal(
                    [
                        b"Both '",
                        NAMES[first],
                        b"' and '",
                        NAMES[second],
                        b"' found in ",
                        directory,
                        b".",
                    ]
                    .concat(),
                ));
            }
            let mut candidates = candidates.into_iter();
            for at in candidates.by_ref() {
                if let Some(found) =
                    self.load(&paths::join(directory, NAMES[at]), at < NAMES_OF_OXFMT)?
                {
                    if at < NAMES_OF_OXFMT
                        && let Some(other) = candidates.find_map(|it| of_prettier(directory, it))
                    {
                        self.note_ignored(&found.path, &other);
                    }
                    config = Some(found);
                    break;
                }
            }
        }
        if self.flavor == Flavor::Oxfmt {
            let editorconfigs = self.editorconfig_of_oxfmt.iter().map(Arc::clone).collect();
            return Ok(Arc::new(Scope {
                config,
                editorconfigs,
            }));
        }
        let own = if has_editorconfig && self.options.editorconfig {
            editorconfig::File::read(directory)
        } else {
            None
        };
        let starts_over = is_project_root || own.as_ref().is_some_and(|it| it.is_root);
        let mut editorconfigs = match (starts_over, above) {
            (false, Some(above)) => above.editorconfigs.clone(),
            _ => Vec::new(),
        };
        editorconfigs.extend(own.map(Arc::new));
        Ok(Arc::new(Scope {
            config,
            editorconfigs,
        }))
    }

    /// Records that the oxfmt config at `used` won over the Prettier config `ignored` in the same directory.
    fn note_ignored(&self, used: &[u8], ignored: &[u8]) {
        self.note.get_or_init(|| {
            let used = paths::relative(&self.environment.cwd, used);
            let end = b" is ignored. Use --config to pick it.";
            [b"Using ", &used[..], b". ", ignored, end].concat()
        });
    }

    /// One-time note for the user about which of two config files was picked.
    pub(crate) fn note(&self) -> Option<&[u8]> {
        // The lookup also runs before `--config` is applied. Ignore what it found then.
        let is_looked_for = self.named.is_none() && self.options.config_lookup;
        self.note.get().filter(|_| is_looked_for).map(|it| &it[..])
    }

    /// Whether the working directory has no configuration file, in it or above it.
    fn lacks_file(&self) -> bool {
        let has_none = || {
            let own = self.for_directory(&self.environment.cwd);
            own.is_ok_and(|it| it.config.is_none())
        };
        *self.lacks_file.get_or_init(has_none)
    }

    /// True if the run isn't imitating another tool: no Prettier or oxfmt config applies to the working directory, and no
    /// flag asks for one.
    pub(crate) fn is_native(&self) -> bool {
        self.flavor == Flavor::Prettier
            && self.options.is_like_oxfmt.is_none()
            && self.named.is_none()
            && (!self.options.config_lookup || self.lacks_file())
    }

    /// Says that `directory` is an argument, or that a file in it is one.
    pub(crate) fn name(&self, directory: &[u8]) {
        let mut arguments = self.arguments.lock();
        if !arguments.iter().any(|it| it == directory) {
            arguments.push(directory.to_vec());
        }
    }

    /// Whether a configuration file in `directory` counts. It can be a program. So in a run whose working directory has none,
    /// those count that are on the way to the working directory or below it, and the same for what is [named](Configs::name):
    /// not those of what a pattern merely leads to.
    fn counts_in(&self, directory: &[u8]) -> bool {
        let is_for = |it: &[u8]| {
            paths::is_at_or_inside(it, directory) || paths::is_at_or_inside(directory, it)
        };
        self.counts_everywhere
            || is_for(&self.environment.cwd)
            || !self.lacks_file()
            || self.arguments.lock().iter().any(|it| is_for(it))
    }

    /// What counts for the files in `directory`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        let directory = if self.options.disable_nested_config {
            &self.environment.cwd[..]
        } else {
            directory
        };
        let mut missing: Vec<&[u8]> = Vec::new();
        let mut above: Option<Found> = None;
        for ancestor in paths::ancestors(directory) {
            match self.by_directory.lock().get(ancestor) {
                Some(known) => {
                    above = Some(known.clone());
                    break;
                }
                None => missing.push(ancestor),
            }
        }
        for directory in missing.into_iter().rev() {
            let entries = fs::list(directory).map_or_else(Vec::new, |it| it.entries);
            let entries = entries.iter().map(|it| (&it.name[..], it.is_directory));
            let found = match &above {
                Some(Ok(above)) => self.scope(directory, entries, Some(above)),
                None => self.scope(directory, entries, None),
                // A configuration file that cannot be used does not matter below a nearer one.
                Some(Err(error)) => {
                    self.scope(directory, entries, None)
                        .and_then(|scope| match scope.config {
                            Some(_) => Ok(scope),
                            None => Err(error.clone()),
                        })
                }
            };
            self.by_directory
                .lock()
                .insert(directory.to_vec(), found.clone());
            above = Some(found);
        }
        above.unwrap_or_else(|| Err(Fatal(b"The path of a directory is empty.".to_vec())))
    }

    /// The same for a directory whose parent has `above`. `entries`: the name of each, and whether it is a directory.
    pub(crate) fn for_listed_directory<'n>(
        &self,
        directory: &[u8],
        entries: impl Iterator<Item = (&'n [u8], bool)>,
        above: &Arc<Scope>,
    ) -> Found {
        if self.options.disable_nested_config {
            return Ok(Arc::clone(above));
        }
        let found = self.scope(directory, entries, Some(above));
        self.by_directory
            .lock()
            .insert(directory.to_vec(), found.clone());
        found
    }

    /// `ignorePatterns` of the configuration file for what has `scope`.
    pub(crate) fn ignores_of<'s>(&'s self, scope: &'s Scope) -> &'s Chain {
        self.config_of(scope)
            .ok()
            .flatten()
            .map_or(&None, |it| &it.ignores)
    }

    /// The configuration file for what has `scope`.
    pub(crate) fn config_of<'s>(
        &'s self,
        scope: &'s Scope,
    ) -> Result<Option<&'s Arc<Config>>, Fatal> {
        match &self.named {
            _ if !self.options.config_lookup => Ok(None),
            Some(named) => named.as_ref().map(Some).map_err(Fatal::clone),
            None => Ok(scope.config.as_ref()),
        }
    }

    /// What the `.editorconfig` files of `scope` say about the file at `path`. `use_tabs`: what its configuration file says.
    fn of_editorconfig(
        &self,
        scope: &Scope,
        path: Option<&[u8]>,
        use_tabs: Option<bool>,
    ) -> editorconfig::Found {
        match (self.options.config_lookup, self.flavor, path) {
            (false, ..) | (true, Flavor::Prettier, None) => Vec::new(),
            (true, Flavor::Prettier, Some(path)) => {
                editorconfig::options_for(scope.editorconfigs.iter().map(|it| &**it), path)
            }
            (true, Flavor::Oxfmt, _) => (scope.editorconfigs.first())
                .map(|it| match path {
                    Some(path) => editorconfig::options_for_oxfmt(it, path, use_tabs),
                    None => editorconfig::options_of_root_for_oxfmt(it, use_tabs),
                })
                .unwrap_or_default(),
        }
    }

    /// Whether a file says something about the file at `path`, which is what `--config-precedence=prefer-file` asks: there is
    /// a configuration file, or a section of an `.editorconfig` is for it.
    fn has_files_for(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        self.config_of(scope).is_ok_and(|it| it.is_some())
            || !self.of_editorconfig(scope, path, None).is_empty()
    }

    /// Whether the files that have `scope` are printed as oxfmt prints them: the run is like oxfmt, or their
    /// configuration file is one of oxfmt's, in a directory below where the run has started.
    pub(crate) fn is_oxfmt_for(&self, scope: &Scope) -> bool {
        self.flavor == Flavor::Oxfmt
            || (self.config_of(scope).ok().flatten()).is_some_and(|config| config.is_oxfmt)
    }

    /// The plugins that the configuration names for the file at `path`, which has `scope`: the last list that applies
    /// is the list. `None`: text without a file name, which no override matches.
    fn plugins_for<'s>(&'s self, scope: &'s Scope, path: Option<&[u8]>) -> Option<&'s Plugins> {
        let config = self.config_of(scope).ok().flatten()?;
        let of_override =
            path.and_then(|path| config.in_last_override(path, |it| it.plugins.as_ref()));
        Some(of_override.unwrap_or(&config.plugins))
    }

    /// See [`Plugins::missing`], for the file at `path`, which has `scope`.
    pub(crate) fn missing_plugins<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> &'s [Vec<u8>] {
        (self.plugins_for(scope, path)).map_or(&[][..], |it| &it.missing[..])
    }

    /// Whether the config or `--plugin` names a plugin that isn't built in, for the file at `path`, which has `scope`.
    pub(crate) fn names_other_plugins(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.names_others)
            || (self.names_plugin_for_svelte(scope, path) && !self.has_svelte_plugin_of_bun())
            || !(self.options.plugins.iter()).all(|it| self.is_built_in(it))
    }

    /// Whether the config or `--plugin` names `prettier-plugin-tailwindcss` for the file at `path`, which has `scope`.
    fn names_plugin_for_classes(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.sorts_classes)
            || (self.options.plugins.iter()).any(|it| is_plugin_for_classes(it))
    }

    /// See [`Oxc`], for the file at `path`, which has `scope` and the option `parser`.
    fn oxc_for(&self, scope: &Scope, path: Option<&[u8]>, parser: Option<&[u8]>) -> Oxc {
        let of_config = self
            .plugins_for(scope, path)
            .map_or(Oxc::Absent, |it| it.oxc);
        match of_config {
            _ if parser.is_some_and(|it| !it.starts_with(b"oxc")) => Oxc::Absent,
            // The code in MDX is Babel's.
            _ if path.is_some_and(|it| it.ends_with(b".mdx")) => Oxc::Absent,
            Oxc::Absent => oxc_among(self.options.plugins.iter().map(|it| &it[..])),
            oxc => oxc,
        }
    }

    /// See [`Plugins::endings`], for the file at `path`, which has `scope`.
    fn endings_of_plugins<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> impl Iterator<Item = &'static [u8]> + use<'s, 'c> {
        let of_flags = (self.options.plugins.iter())
            .filter_map(|it| endings_of_plugin(it))
            .flatten();
        let of_config = self.plugins_for(scope, path).into_iter();
        of_config
            .flat_map(|it| &it.endings)
            .chain(of_flags)
            .copied()
    }

    /// Whether Prettier reads the file at `path`, which has `scope`, with a plugin that adds a language.
    pub(crate) fn is_read_by_plugin(&self, scope: &Scope, path: &[u8]) -> bool {
        (self.endings_of_plugins(scope, Some(path))).any(|ending| path.ends_with(ending))
            && !(path.ends_with(b".svelte") && self.svelte_for(scope, Some(path)) == Svelte::Nobody)
    }

    /// The plugin that adds the language of the file at `path`, which has `scope`, if Prettier reads it with one.
    pub(crate) fn plugin_that_reads(&self, scope: &Scope, path: &[u8]) -> Option<&'static [u8]> {
        PLUGINS_FOR_LANGUAGES
            .iter()
            .find(|it| it.1.iter().any(|ending| path.ends_with(ending)))
            .filter(|_| self.is_read_by_plugin(scope, path))
            .map(|it| it.0)
    }

    /// The packages that Prettier loads as plugins for the file at `path`, which has `scope`.
    pub(crate) fn packages_of_plugins<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> impl Iterator<Item = &'s [u8]> + use<'s, 'c> {
        (self.plugins_for(scope, path).into_iter())
            .flat_map(|it| &it.packages)
            .chain(&self.options.plugins)
            .map(|it| &it[..])
    }

    /// The configuration file for the files that have `scope`.
    pub(crate) fn path_of_config<'s>(&'s self, scope: &'s Scope) -> Option<&'s [u8]> {
        (self.config_of(scope).ok().flatten()).map(|config| &config.path[..])
    }

    /// Whether the `prettier-plugin-svelte` that the project's own Prettier would load prints what is printed here: it is
    /// 4.1.1. 4.1.0 prints 19 of 7,047 real components in another way, 3.x has another parser. One that is not installed
    /// is the newest. It is looked for from the working directory, like every package in `prettier.rs`.
    fn has_svelte_plugin_of_bun(&self) -> bool {
        *self.has_svelte_plugin_of_bun.get_or_init(|| {
            tailwind::version_of_package(PLUGIN_FOR_SVELTE, &self.environment.cwd)
                .is_none_or(|it| it == [4, 1, 1])
        })
    }

    /// Whether the plugin `name` is not needed: what it does is done here, or a flag or `[fmt]` says who formats Svelte.
    pub(crate) fn is_built_in(&self, name: &[u8]) -> bool {
        let is_up_to_flags = || {
            matches!(self.options.config_precedence, Precedence::CliOverride)
                && self.svelte_of_flags(None).is_some()
        };
        is_built_in_plugin(name)
            || (package_of(name) == PLUGIN_FOR_SVELTE
                && (self.has_svelte_plugin_of_bun() || is_up_to_flags()))
    }

    /// Whether `--no-svelte` or `svelte = false` in `[fmt]` keeps a component in `directory`, which has `scope`, from being
    /// formatted: it is there, and with `--config-precedence` it counts. An override can still turn it on for some files.
    pub(crate) fn turns_svelte_off(&self, scope: &Scope, directory: &[u8]) -> bool {
        self.svelte_of_flags(None) == Some(false)
            && self.svelte_for(scope, Some(&paths::join(directory, b"a.svelte"))) == Svelte::Nobody
    }

    /// Whether a flag or `[fmt]` turns it off for the file at `path`.
    pub(crate) fn turns_svelte_off_for(&self, path: &[u8]) -> bool {
        self.svelte_of_flags(Some(path)) == Some(false)
    }

    /// Whether an override of `[fmt]` has `svelte = false`, and nothing counts for more in `directory`, which has `scope`.
    pub(crate) fn turns_svelte_off_for_some(&self, scope: &Scope, directory: &[u8]) -> bool {
        let path = paths::join(directory, b"a.svelte");
        (self.overrides.iter()).any(|it| svelte_in(&it.settings) == Some(false))
            && self.svelte_with(scope, Some(&path), Some(false)) == Svelte::Nobody
    }

    /// Whether `--parser svelte`, or the same in `[fmt]`, is there.
    pub(crate) fn asks_for_parser_of_svelte(&self) -> bool {
        (self.options.format.iter()).any(|it| it.0 == b"parser" && it.1 == b"svelte")
    }

    /// Whether a flag or the config asks for a part of the file at `path`, which has `scope`, or for where the cursor ends up.
    fn is_about_part(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        let is_about_part =
            |name: &[u8]| matches!(name, b"rangeStart" | b"rangeEnd" | b"cursorOffset");
        let has_it = |settings: &Settings| settings.iter().any(|it| is_about_part(&it.0));
        self.options.format.iter().any(|it| is_about_part(it.0))
            || self.config_of(scope).ok().flatten().is_some_and(|config| {
                let in_override = |it: &Override| has_it(&it.settings).then_some(());
                has_it(&config.settings)
                    || path.is_some_and(|it| config.in_last_override(it, in_override).is_some())
            })
    }

    /// Who formats the Svelte in the file at `path`, which has `scope`: a component, or the blocks of Svelte in a Markdown
    /// file. `None`: text without a file name.
    ///
    /// `--svelte`, `--no-svelte` and `svelte` in `[fmt]` say whether Bun does. So does the config: oxfmt's with `svelte`,
    /// Prettier's by naming the plugin. With another version of that installed than the one that is built in, the files go
    /// to the Prettier of the project. Which of the two counts is up to `--config-precedence`, as for every option. Where
    /// neither says anything, Bun does if no config applies.
    fn svelte_for(&self, scope: &Scope, path: Option<&[u8]>) -> Svelte {
        self.svelte_with(scope, path, self.svelte_of_flags(path))
    }

    /// The same if the flags and `[fmt]` say `of_flags` about it.
    fn svelte_with(&self, scope: &Scope, path: Option<&[u8]>, of_flags: Option<bool>) -> Svelte {
        let by = |is_on: bool| if is_on { Svelte::Bun } else { Svelte::Nobody };
        let of_flags = || of_flags.map(by);
        let of_files = || match self.is_oxfmt_for(scope) {
            true => self.svelte_of_oxfmt(scope, path).map(by),
            false if !self.names_plugin_for_svelte(scope, path) => None,
            false if self.has_svelte_plugin_of_bun() => Some(Svelte::Bun),
            false => Some(Svelte::Prettier),
        };
        let said = match self.options.config_precedence {
            Precedence::CliOverride => of_flags().or_else(of_files),
            Precedence::FileOverride => of_files().or_else(of_flags),
            Precedence::PreferFile if self.has_files_for(scope, path) => of_files(),
            Precedence::PreferFile => of_flags(),
        };
        said.unwrap_or_else(|| by(self.is_native_in(scope)))
    }

    /// Whether Svelte in the file at `path`, which has `scope`, is formatted here. See [`Configs::svelte_for`].
    pub(crate) fn formats_svelte(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        self.svelte_for(scope, path) == Svelte::Bun && !self.is_part_for_prettier(scope, path)
    }

    /// Nothing here formats a part of a component. oxfmt has no such options.
    fn is_part_for_prettier(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        !self.is_oxfmt_for(scope) && self.is_about_part(scope, path)
    }

    /// Whether the file at `path`, which has `scope`, is a component that would be formatted here but for a range or a cursor.
    pub(crate) fn leaves_svelte_for_part(&self, scope: &Scope, path: &[u8]) -> bool {
        path.ends_with(b".svelte")
            && self.is_part_for_prettier(scope, Some(path))
            && self.svelte_for(scope, Some(path)) == Svelte::Bun
    }

    /// What `--svelte`, `--no-svelte` or `svelte` in `[fmt]` says about the file at `path`. The last override that is for the
    /// file and has the key counts for more than the section.
    fn svelte_of_flags(&self, path: Option<&[u8]>) -> Option<bool> {
        let mut relative = None;
        let mut is_for_it = |it: &Override| {
            let start = &self.start_of_bunfig;
            path.is_some_and(|path| {
                it.matches(relative.get_or_insert_with(|| paths::relative(start, path)))
            })
        };
        let overrides = self.overrides.iter().rev();
        let mut said = overrides.filter_map(|it| Some((it, svelte_in(&it.settings)?)));
        let in_override = said.find(|it| is_for_it(it.0)).map(|it| it.1);
        let about_it = || self.options.format.iter().rfind(|it| it.0 == b"svelte");
        in_override.or_else(|| about_it().map(|it| it.1 != b"false"))
    }

    /// Whether the config or `--plugin` names `prettier-plugin-svelte` for the file at `path`, which has `scope`.
    fn names_plugin_for_svelte(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.endings_of_plugins(scope, path)).any(|it| it == b".svelte")
    }

    /// What `svelte` in the configuration of oxfmt says about the file at `path`, which has `scope`. An override can turn it
    /// on and off. Text without a file name is not formatted.
    fn svelte_of_oxfmt(&self, scope: &Scope, path: Option<&[u8]>) -> Option<bool> {
        let config = (self.config_of(scope).ok().flatten()).filter(|it| it.is_oxfmt)?;
        let Some(path) = path else {
            return Some(false);
        };
        config
            .in_last_override(path, |it| svelte_in(&it.settings))
            .or_else(|| svelte_in(&config.settings))
    }

    /// Returns true if Bun's own choices apply in `scope`: the run is in native mode and the directory has no Prettier
    /// config. That's where TOML and Svelte get formatted and generated files get skipped.
    pub(crate) fn is_native_in(&self, scope: &Scope) -> bool {
        self.is_native() && self.config_of(scope).is_ok_and(|it| it.is_none())
    }

    /// The option `parser` for the file at `path`, which has `scope`, if it is set.
    pub(crate) fn parser_for(&self, scope: &Scope, path: &[u8]) -> Option<Box<[u8]>> {
        let is_about_parser = |it: &(Vec<u8>, Vec<u8>)| it.0 == b"parser";
        let may_be_set = self.options.format.iter().any(|it| it.0 == b"parser")
            || (self.overrides.iter()).any(|it| it.settings.iter().any(is_about_parser))
            || self.config_of(scope).ok().flatten().is_some_and(|config| {
                config.settings.iter().any(is_about_parser)
                    || config
                        .overrides
                        .iter()
                        .any(|it| it.settings.iter().any(is_about_parser))
            });
        match may_be_set {
            true => self.options_for(scope, path).ok()?.options.parser,
            false => None,
        }
    }

    /// Prettier's `getOptionsForFile`: how to format the file at `path`, which has `scope`.
    pub(crate) fn options_for(&self, scope: &Scope, path: &[u8]) -> Result<Resolved, Fatal> {
        self.options_of(scope, Some(path))
    }

    /// The same for text without a file name, like `prettier --parser x < file`. `scope` is the working directory's.
    /// Overrides and `.editorconfig` sections match on a name, so they don't apply.
    pub(crate) fn options_without_name(&self, scope: &Scope) -> Result<Resolved, Fatal> {
        self.options_of(scope, None)
    }

    fn options_of(&self, scope: &Scope, path: Option<&[u8]>) -> Result<Resolved, Fatal> {
        let directory = path.map_or(&self.environment.cwd[..], paths::dirname);
        let config = self.config_of(scope)?;
        let is_oxfmt = self.is_oxfmt_for(scope);
        let mut from_config: Vec<(&[u8], &[u8])> = Vec::new();
        if let Some(config) = config {
            from_config.extend(config.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            let relative = path.map(|path| paths::relative(paths::dirname(&config.path), path));
            let is_for_it = |it: &&Override| relative.as_ref().is_some_and(|path| it.matches(path));
            for it in config.overrides.iter().filter(is_for_it) {
                from_config.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
            // oxfmt has no such option.
            if config.is_oxfmt {
                from_config.retain(|it| it.0 != b"parser");
            }
        }
        let mut from_files: Vec<(&[u8], &[u8])> = Vec::new();
        let use_tabs = use_tabs_in(from_config.iter().copied());
        let from_editorconfig = self.of_editorconfig(scope, path, use_tabs);
        // oxfmt does not know `max_line_length = off`, Prettier does not know `insert_final_newline`.
        let counts = |it: &&(&[u8], Vec<u8>)| match is_oxfmt {
            true => (it.0, &it.1[..]) != (b"printWidth", NO_END),
            false => it.0 != b"insertFinalNewline",
        };
        from_files.extend(
            from_editorconfig
                .iter()
                .filter(counts)
                .map(|it| (it.0, &it.1[..])),
        );
        if is_oxfmt && !from_files.iter().any(|it| it.0 == b"printWidth") {
            from_files.push((b"printWidth", b"100"));
        }
        from_files.extend(from_config);
        let mut from_flags: Vec<(&[u8], &[u8])> =
            (self.options.format.iter().map(|it| (it.0, &it.1[..]))).collect();
        if let Some(path) = path.filter(|_| !self.overrides.is_empty()) {
            let relative = paths::relative(&self.start_of_bunfig, path);
            for it in self.overrides.iter().filter(|it| it.matches(&relative)) {
                from_flags.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
        }
        // Bun's `sortImports` does more than oxfmt's, so it gets its own name.
        for it in from_flags.iter_mut().filter(|it| it.0 == b"sortImports") {
            it.0 = SORT_IMPORTS_OF_BUN;
        }
        // Its paths start somewhere else than those of a configuration file.
        for it in from_flags
            .iter_mut()
            .filter(|it| it.0 == b"sortTailwindcss")
        {
            it.0 = SORT_TAILWINDCSS_OF_BUN;
        }
        let of_flags = from_flags.iter().copied();
        let all: Vec<(&[u8], &[u8])> = match self.options.config_precedence {
            Precedence::CliOverride => from_files.into_iter().chain(of_flags).collect(),
            Precedence::FileOverride => of_flags.chain(from_files).collect(),
            Precedence::PreferFile if self.has_files_for(scope, path) => from_files,
            Precedence::PreferFile => of_flags.collect(),
        };
        // Prettier looks at the flags first, also at one that a file takes the place of.
        let mut flags = self.options.format.iter();
        if !is_oxfmt && let Some(refusal) = flags.find_map(|it| not_an_integer(it.0, &it.1, true)) {
            return Err(Fatal(refusal));
        }
        if is_oxfmt {
            check_widths(|name| all.iter().rfind(|it| it.0 == name).map(|it| it.1))?;
        }
        let mut resolved = Resolved::default();
        let mut sort = SortSettings::default();
        let _ = resolved.options.set(b"filepath", path.unwrap_or_default());
        resolved.options.format_javascript = Some(super::format_block);
        resolved.options.parse_javascript = Some(super::parse_javascript);
        resolved.options.parse_parts = Some(super::parse_parts);
        resolved.options.embedded_html = true;
        resolved.options.toml = self.is_native_in(scope);
        resolved.options.svelte.is_on = self.formats_svelte(scope, path);
        if is_oxfmt {
            let _ = resolved.options.set(b"flavor", b"oxfmt");
            // It sorts the keys of a `package.json` unless it is told not to.
            let _ = resolved.options.set(b"sortPackageJson", b"true");
        }
        let mut sort_imports: Option<Vec<u8>> = None;
        let mut sort_tailwindcss: Option<Vec<u8>> = None;
        // Whether the last one that was read is a flag's or of `[fmt]`.
        let mut is_tailwindcss_of_bun = false;
        let tailwindcss_set_by = |is_of_bun: bool| match config {
            Some(config) if config.is_oxfmt && !is_of_bun => {
                SetBy::Oxfmt(paths::dirname(&config.path))
            }
            _ => SetBy::Bun(&self.start_of_bunfig),
        };
        // oxfmt-only options are also valid under a Prettier config when a flag or `[fmt]` sets them.
        let is_known = |name: &[u8]| {
            let name = match name {
                b"sortTailwindcss" => SORT_TAILWINDCSS_OF_BUN,
                _ => name,
            };
            is_oxfmt || from_flags.iter().any(|it| it.0 == name)
        };
        // Prettier knows the options of the plugins that it has loaded.
        let knows_all_options = !is_oxfmt && !self.names_other_plugins(scope, path);
        let names_plugin_for_svelte = self.names_plugin_for_svelte(scope, path);
        let mut unknown: Vec<(&[u8], &[u8])> = Vec::new();
        // `sortTailwindcss` as the options of the plugin have it.
        let mut of_plugin =
            (!is_oxfmt && self.names_plugin_for_classes(scope, path)).then(Vec::new);
        for (name, value) in all {
            if let Some(entries) = &mut of_plugin
                && let Some(entry) = tailwind::option_of_plugin(name, value)
            {
                let entry = entry.map_err(Fatal)?;
                entries.retain(|it: &(Vec<u8>, Json)| it.0 != entry.0);
                entries.push(entry);
                continue;
            }
            match name {
                SORT_IMPORTS_OF_BUN => _ = sort.set(name, value),
                // An override of oxfmt changes the keys that it has. `experimentalSortImports` is the old name.
                name if is_oxfmt && name.ends_with(b"ortImports") => {
                    let merged = sort_imports
                        .as_deref()
                        .map_or_else(|| value.to_vec(), |before| merged_objects(before, value));
                    sort.set(b"sortImports", &merged);
                    sort_imports = Some(merged);
                }
                name if sort.set(name, value) => {}
                b"insertFinalNewline" if is_known(name) => {
                    resolved.omits_final_newline = value == b"false"
                }
                b"sortPackageJson" | b"sortPackageJson.sortScripts" if is_known(name) => {
                    let _ = resolved.options.set(name, value);
                }
                b"experimentalSortPackageJson" if is_oxfmt => {
                    let _ = resolved.options.set(b"sortPackageJson", value);
                }
                // What another version of the plugin takes is for that version to say.
                b"svelteSortOrder"
                | b"svelteAllowShorthand"
                | b"svelteIndentScriptAndStyle"
                | b"svelte.sortOrder"
                | b"svelte.allowShorthand"
                | b"svelte.indentScriptAndStyle"
                    if resolved.options.svelte.is_on =>
                {
                    if resolved.options.set(name, value).is_err() {
                        return Err(Fatal(
                            [b"Invalid ", name, b" value: ", value, b"."].concat(),
                        ));
                    }
                }
                // The other options of the plugin, and all of them where its files are not formatted here.
                b"svelteSortOrder"
                | b"svelteAllowShorthand"
                | b"svelteIndentScriptAndStyle"
                | b"svelte5CompilerPath"
                    if names_plugin_for_svelte => {}
                // `Configs::svelte_for` has looked at it.
                name if (name == b"svelte" || name.starts_with(b"svelte.")) && is_known(name) => {}
                name if name == b"jsdoc" || name.starts_with(b"jsdoc.") => {
                    if resolved.options.set(name, value).is_err() {
                        return Err(Fatal(
                            [b"Invalid ", name, b" value: ", value, b"."].concat(),
                        ));
                    }
                }
                // An override changes the keys that it has.
                name if name == SORT_TAILWINDCSS_OF_BUN || is_tailwind(name) && is_known(name) => {
                    let was_of_bun = is_tailwindcss_of_bun;
                    is_tailwindcss_of_bun = name == SORT_TAILWINDCSS_OF_BUN;
                    sort_tailwindcss = Some(match &sort_tailwindcss {
                        Some(before) if was_of_bun != is_tailwindcss_of_bun => {
                            let set_by = tailwindcss_set_by(was_of_bun);
                            merged_objects(&tailwind::with_whole_paths(before, set_by), value)
                        }
                        Some(before) => merged_objects(before, value),
                        None => value.to_vec(),
                    });
                }
                name if is_tailwind(name) && value != b"false" => {
                    resolved.has_unsupported_option = true;
                    let mut unsupported = self.unsupported_options.lock();
                    if !unsupported.iter().any(|it| it == name) {
                        unsupported.push(name.to_vec());
                    }
                }
                name if OPTIONS.contains(&name) && resolved.options.set(name, value).is_err() => {
                    return Err(Fatal(match not_an_integer(name, value, false) {
                        Some(refusal) if !is_oxfmt => refusal,
                        _ => [b"Invalid ", name, b" value: ", value, b"."].concat(),
                    }));
                }
                name if knows_all_options
                    && !OPTIONS.contains(&name)
                    && !OTHER_KEYS.contains(&name) =>
                {
                    unknown.push((name, value));
                }
                _ => {}
            }
        }
        // `svelte = false` leaves the files alone with every config, also with the `parser` that the README of the plugin has for
        // them.
        if resolved.options.parser.as_deref() == Some(b"svelte")
            && !resolved.options.svelte.is_on
            && self.svelte_of_flags(path) == Some(false)
        {
            resolved.options.parser = None;
        }
        if !is_oxfmt
            && resolved.options.parser.is_none()
            && let Some(parser) = path.and_then(super::files::parser_by_interpreter)
        {
            let _ = resolved.options.set(b"parser", parser);
        }
        for name in &self.options.plugins {
            sort.add_plugin(name);
        }
        for (name, value) in sort.of_plugins_not_named().chain(unknown) {
            // A string and what else there is in JSON are told apart by their looks here.
            let is_json = name.starts_with(b"tailwind");
            let json = json::parse(value).filter(|it| is_json || !matches!(it, Json::String(_)));
            let mut shown = Vec::new();
            write_as_shown(
                &mut shown,
                &json.unwrap_or_else(|| Json::String(value.to_vec())),
            );
            self.warn(&[b"Ignored unknown option { ", name, b": ", &shown, b" }."]);
        }
        if sort.organizes_imports() {
            for (name, value) in self.tsconfig_of(directory).iter() {
                sort.set(name, value);
            }
        }
        resolved.options.sort_imports = self.sort_imports(sort)?;
        // A flag or `[fmt]` counts for more than the plugin.
        let (value, set_by) = match (sort_tailwindcss, of_plugin) {
            (Some(value), _) => (value, tailwindcss_set_by(is_tailwindcss_of_bun)),
            (None, Some(entries)) => {
                if let Some(warning) = tailwind::warning_of_plugin(&entries) {
                    self.warn(&[&warning]);
                }
                let mut value = Vec::new();
                write_json(&mut value, &Json::Object(entries));
                // Not the file that `--config` names.
                let found = scope.config.as_ref().map(|it| paths::dirname(&it.path));
                (value, SetBy::Plugin(found.unwrap_or(&self.environment.cwd)))
            }
            (None, None) => (b"false".to_vec(), SetBy::Bun(&self.start_of_bunfig)),
        };
        if value != b"false" {
            let places = (set_by, directory);
            let mut tailwind = tailwind::for_file(&self.classes, &value, places);
            tailwind.oxc = self.oxc_for(scope, path, resolved.options.parser.as_deref());
            resolved.options.tailwind = Some(Arc::new(tailwind));
        }
        Ok(resolved)
    }

    /// What the `tsconfig.json` nearest to `directory` says about JSX, as settings for the sorting
    /// of imports.
    fn tsconfig_of(&self, directory: &[u8]) -> Arc<Settings> {
        if let Some(known) = self.tsconfigs.lock().get(directory) {
            return Arc::clone(known);
        }
        let nearest = paths::ancestors(directory)
            .map(|it| paths::join(it, b"tsconfig.json"))
            .find(|it| fs::is_file(it));
        let mut settings = Settings::new();
        if let Some(path) = nearest {
            read_tsconfig(&path, &mut settings);
        }
        let settings = Arc::new(settings);
        self.tsconfigs
            .lock()
            .insert(directory.to_vec(), Arc::clone(&settings));
        settings
    }

    fn sort_imports(&self, settings: SortSettings) -> Result<Option<Arc<SortImports>>, Fatal> {
        let mut known = self.sort_imports.lock();
        if let Some((_, how)) = known.iter().find(|it| it.0 == settings) {
            return Ok(how.clone());
        }
        let how = settings.compile().map_err(Fatal)?;
        known.push((settings, how.clone()));
        Ok(how)
    }
}
