//! Finds and reads the formatter's configuration. It's Prettier's `resolveConfig`.
//!
//! A file's configuration comes from the first directory, walking up from the file's own, that has a file named in
//! [`NAMES`]. `.editorconfig` files apply too, with lower priority.
//!
//! If the working directory has an oxfmt configuration file, everything works as in oxfmt ([`Flavor::Oxfmt`]): which
//! files are configuration files, how patterns are parsed, which `.editorconfig` applies, and which files are ignored
//! (`files.rs`).

use super::cli::{Options, Precedence};
use super::tailwind::SetBy;
use super::{editorconfig, tailwind};
use crate::configs::{VITE_CONFIG_NAMES, package_that_depends_on};
use crate::gitignore::{self, Chain};
use crate::paths::package_of;
use crate::run::{Environment, Fatal};
use crate::{evaluate, fs, paths};
use bun_ast::Expr;
use bun_ast::expr::Data;
use bun_collections::index_sort::sort_slice;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::json::{PackageJsonPlugin, SortPackageJson};
use bun_format::sort_imports::{Settings as SortSettings, SortImports};
use bun_format::tailwind::Oxc;
use bun_lint::glob::Picomatch;
use bun_lint::json::{self, Notation};
use bun_lint::linter::config::{glob_error, strings_of};
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::{Arc, OnceLock};

/// Configuration file names, in priority order: oxfmt's, then Prettier's `CONFIG_FILES`.
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

/// The number of leading [`NAMES`] that are oxfmt's.
const OXFMT_NAME_COUNT: usize = 4;

/// The tool whose command line this run emulates.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Flavor {
    Prettier,
    Oxfmt,
}

/// The formatter's options.
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
pub(super) fn is_prettier_option(name: &[u8]) -> bool {
    OPTIONS.contains(&name)
}

/// The [`OPTIONS`] whose value is a string.
const STRING_OPTIONS: [&[u8]; 10] = [
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

/// The other top-level keys of a Prettier configuration file.
const OTHER_KEYS: [&[u8]; 4] = [b"$schema", b"overrides", b"plugins", b"filepath"];

/// The name [`SortSettings`] uses for `sortImports` when a flag or `[fmt]` sets it.
const BUN_SORT_IMPORTS: &[u8] = b"bun.sortImports";

/// `sortTailwindcss` when a flag or `[fmt]` sets it.
const BUN_SORT_TAILWINDCSS: &[u8] = b"bun.sortTailwindcss";

/// The largest number that's parsed. It represents `Infinity` and `max_line_length = off`.
pub(super) const UNLIMITED_WIDTH: &[u8] = b"4294967295";

/// Options by name. Values are JSON text, except that strings have no quotes. A string given to an option that doesn't
/// take strings keeps its quotes, so that `"80"` isn't read as 80.
type Settings = Vec<(Vec<u8>, Vec<u8>)>;

/// A pattern in an override.
struct Pattern {
    glob: bun_glob::Pattern,
    /// As written.
    text: Box<[u8]>,
    has_slash: bool,
}

/// An element of `overrides`.
struct Override {
    files: Vec<Pattern>,
    excluded: Vec<Pattern>,
    settings: Settings,
    /// Its `plugins`, if set.
    plugins: Option<Plugins>,
    is_oxfmt: bool,
}

#[derive(Default)]
struct Plugins {
    /// True if one of them isn't built in, so Bun doesn't know its options.
    has_unknown_plugins: bool,
    /// True if one of them is `prettier-plugin-tailwindcss`.
    sorts_classes: bool,
    /// True if one of them is `prettier-plugin-svelte`.
    reads_svelte: bool,
    /// True if one of them is `prettier-plugin-packagejson`.
    sorts_package_json: bool,
    oxc: Oxc,
    /// The plugins that may change the output for files this formatter handles.
    missing: Vec<Vec<u8>>,
    /// The file name endings that they add to what Prettier formats.
    endings: Vec<&'static [u8]>,
    /// The ones that are packages, as opposed to paths or objects.
    packages: Vec<Vec<u8>>,
}

pub(crate) struct Config {
    pub(crate) path: Vec<u8>,
    settings: Settings,
    overrides: Vec<Override>,
    /// True if it's oxfmt's, whose default print width is 100.
    is_oxfmt: bool,
    /// For files where no override has its own list.
    plugins: Plugins,
    /// oxfmt's `ignorePatterns`.
    pub(crate) ignores: Chain,
}

/// The configuration that applies to the files in a directory.
pub(crate) struct Scope {
    pub(crate) config: Option<Arc<Config>>,
    /// Farthest first.
    editorconfigs: Vec<Arc<editorconfig::File>>,
}

impl Scope {
    pub(crate) fn has_editorconfig(&self) -> bool {
        !self.editorconfigs.is_empty()
    }
}

/// An element of oxc's `GlobSet`.
pub(crate) fn oxc_glob(pattern: &[u8]) -> bun_glob::Pattern {
    bun_glob::Pattern::of_oxfmt(pattern)
}

/// Parses a pattern from Prettier's `overrides` or command line.
pub(crate) fn prettier_glob(pattern: &[u8], how: Picomatch) -> bun_glob::Pattern {
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
            oxc_glob(text)
        } else {
            prettier_glob(text, Picomatch::Micromatch)
        },
        text: text.into(),
        has_slash: strings::contains_char(text, b'/'),
    };
    all.map(pattern).collect()
}

const TAILWIND_PLUGIN: &[u8] = b"prettier-plugin-tailwindcss";
/// It parses JavaScript and TypeScript with another parser, but the output is the same.
const OXC_PLUGIN: &[u8] = b"@prettier/plugin-oxc";
/// See [`Configs::formats_svelte`].
const SVELTE_PLUGIN: &[u8] = b"prettier-plugin-svelte";
/// See `src/format/json/sort_package_json/npm.rs`.
const PACKAGE_JSON_PLUGIN: &[u8] = b"prettier-plugin-packagejson";

pub(super) fn is_svelte_plugin(name: &[u8]) -> bool {
    package_of(name) == SVELTE_PLUGIN
}

fn is_package_json_plugin(name: &[u8]) -> bool {
    package_of(name) == PACKAGE_JSON_PLUGIN
}

/// The value of the last `svelte` in `settings`: `true`, `false` or a table, which turns it on.
fn svelte_in(settings: &Settings) -> Option<bool> {
    let svelte_setting = settings.iter().rfind(|it| it.0 == b"svelte");
    svelte_setting.map(|it| it.1 != b"false")
}

/// Returns true for a plugin that's built in. These sort imports, classes or `package.json` keys, or format Svelte.
pub(super) fn is_built_in_plugin(name: &[u8]) -> bool {
    let name = package_of(name);
    name.ends_with(b"/prettier-plugin-sort-imports")
        || name == b"prettier-plugin-organize-imports"
        || name == TAILWIND_PLUGIN
        || name == OXC_PLUGIN
        || name == SVELTE_PLUGIN
        || name == PACKAGE_JSON_PLUGIN
}

/// The plugin name for an element of `plugins`. An element that isn't a string is a module imported by a JavaScript
/// configuration, and it's recognized by its exports.
fn name_of(plugin: &Json) -> Option<&[u8]> {
    let has =
        |export: &[u8], key: &[u8]| plugin.get(export).is_some_and(|it| it.get(key).is_some());
    match plugin.as_str() {
        None if has(b"options", b"tailwindConfig") => Some(TAILWIND_PLUGIN),
        None if has(b"parsers", b"oxc") => Some(OXC_PLUGIN),
        None if has(b"parsers", b"svelte") => Some(SVELTE_PLUGIN),
        None if has(b"options", b"packageSortOrder") => Some(PACKAGE_JSON_PLUGIN),
        name => name,
    }
}

/// See [`Oxc`]. `plugins` is in list order.
fn oxc_among<'p>(plugins: impl Iterator<Item = &'p [u8]>) -> Oxc {
    let mut oxc = Oxc::Absent;
    for name in plugins.map(package_of) {
        oxc = match (name == OXC_PLUGIN, oxc) {
            (true, _) => Oxc::After,
            (false, Oxc::After) if name == TAILWIND_PLUGIN => Oxc::Before,
            (false, oxc) => oxc,
        };
    }
    oxc
}

fn is_tailwind_plugin(name: &[u8]) -> bool {
    package_of(name) == TAILWIND_PLUGIN
}

fn is_built_in(plugin: &Json) -> bool {
    name_of(plugin).is_some_and(is_built_in_plugin)
}

/// Plugins that add a language to Prettier and don't affect other languages, each with its file name endings. The rest
/// of a project is formatted the same without them.
const LANGUAGE_PLUGINS: [(&[u8], &[&[u8]]); 21] = [
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

fn plugin_endings(name: &[u8]) -> Option<&'static [&'static [u8]]> {
    LANGUAGE_PLUGINS
        .iter()
        .find(|it| it.0 == package_of(name))
        .map(|it| it.1)
}

/// True if formatting without the plugin `name` may give different output than with it.
pub(super) fn is_missing_plugin(name: &[u8]) -> bool {
    !is_built_in_plugin(name) && plugin_endings(name).is_none()
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

/// Merges the keys of the object `after` into the object `before`, both given as JSON text. Returns `after` if either
/// isn't an object.
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
            // Kept as JSON, even a string, because the class-sorting plugin rejects a value of the wrong type.
            Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_)
                if !is_oxfmt && name.starts_with(b"tailwind") =>
            {
                let mut text = Vec::new();
                write_json(&mut text, value);
                text
            }
            Json::String(text) if is_option && !STRING_OPTIONS.contains(&&name[..]) => {
                [b"\"", &text[..], b"\""].concat()
            }
            Json::String(text) => text.clone(),
            // oxfmt treats it as absent.
            Json::Null if is_option && !is_oxfmt => b"null".to_vec(),
            Json::Bool(value) => if *value { &b"true"[..] } else { b"false" }.to_vec(),
            // `Infinity` isn't JSON, but a YAML file can have it. Numbers are capped at 32 bits.
            Json::Number(number) if *number >= f64::from(u32::MAX) => UNLIMITED_WIDTH.to_vec(),
            Json::Number(number) => {
                bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *number).to_vec()
            }
            // Import-order options are kept as JSON.
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
            // Turn it on, and store each of its properties separately.
            Json::Object(properties) if name == b"jsdoc" || (is_oxfmt && name == b"svelte") => {
                settings.push((name.clone(), b"{}".to_vec()));
                for (property, value) in properties {
                    if let Some(value) = text_or_bool(value) {
                        settings.push(([&name[..], b".", &property[..]].concat(), value));
                    }
                }
                continue;
            }
            // An oxfmt feature that's configured is also turned on.
            Json::Object(_) if is_oxfmt => b"true".to_vec(),
            // Kept so it can be shown in a warning.
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

/// Prettier's options in `json`, except `plugins`, in the form command-line flags are stored in. `None` if one of its
/// keys isn't a known option.
pub(super) fn as_flags(json: &Json) -> Option<Vec<(&'static [u8], Vec<u8>)>> {
    settings(json, false)
        .into_iter()
        .filter(|it| it.0 != b"plugins")
        .map(|(name, value)| Some((*OPTIONS.iter().find(|it| ***it == name[..])?, value)))
        .collect()
}

impl Override {
    /// Prettier's `pathMatchesGlobs`. `relative` is relative to the configuration file's directory.
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

/// Prettier's error message for a `printWidth` or `tabWidth` that isn't an integer. `is_flag` means it's from the
/// command line, where `value` is text that Prettier converts to a number.
fn not_an_integer(name: &[u8], value: &[u8], is_flag: bool) -> Option<Vec<u8>> {
    let flag: &[u8] = match name {
        b"printWidth" => b"--print-width",
        b"tabWidth" => b"--tab-width",
        _ => return None,
    };
    let number = bun_core::fmt::js_string_to_number(value);
    // `tabWidth: -1` is an integer, and Prettier counts `Infinity` as one too.
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

/// Parses `prettier-plugin-packagejson`'s `packageSortOrder` from its value in [`Settings`]. Returns Prettier's error
/// message if it isn't an array of strings.
fn package_sort_order(value: &[u8]) -> Result<Vec<Vec<u8>>, Vec<u8>> {
    let json = json::parse(value).filter(|it| it.as_str().is_none());
    let json = json.unwrap_or_else(|| Json::String(value.to_vec()));
    let names = json.as_array().map(|all| all.iter().map(Json::as_str));
    let names = names.and_then(|all| all.map(|it| Some(it?.to_vec())).collect());
    names.ok_or_else(|| {
        let mut error_message =
            b"Invalid packageSortOrder value. Expected an array of a string, but received "
                .to_vec();
        write_as_shown(&mut error_message, &json);
        error_message.push(b'.');
        error_message
    })
}

/// True if `error` is one that makes Prettier end the run with exit code 1.
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

/// The part of oxfmt's `validate` that's implemented here. `get` returns an option's value.
fn check_widths<'v>(get: impl Fn(&[u8]) -> Option<&'v [u8]>) -> Result<(), Fatal> {
    get(b"printWidth").map_or(Ok(()), check_print_width)?;
    get(b"tabWidth").map_or(Ok(()), check_tab_width)
}

/// The last `useTabs` in `settings`.
fn use_tabs_in<'s>(
    settings: impl DoubleEndedIterator<Item = (&'s [u8], &'s [u8])>,
) -> Option<bool> {
    let mut settings = settings;
    let value = settings.rfind(|it| it.0 == b"useTabs")?.1;
    Some(value == b"true")
}

/// The offset of the first duplicate key in a map in `value`. Only scalar keys are compared, by value, so `a` equals
/// `"a"`. With `as_texts`, `1` equals `"1"` too.
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

/// The first duplicate map key in a text.
struct RepeatedKey<'a> {
    /// Without a byte order mark.
    text: &'a [u8],
    /// The part of `text` before the key.
    before: &'a [u8],
}

fn before_repeated_key(text: &[u8], as_texts: bool) -> Option<RepeatedKey<'_>> {
    // The parser here expands `<<`, which merges another map's keys into this one.
    if strings::contains(text, b"<<") {
        return None;
    }
    let find = |it: &Expr| repeated_key(it, as_texts);
    let at = json::with_parsed(Notation::Yaml, text, find).ok()??;
    let text = strings::without_utf8_bom(text);
    let before = text.get(..usize::try_from(at).ok()?)?;
    // A quoted key's offset points past the opening quote.
    let before = before.strip_suffix(b"\"").unwrap_or(before);
    let before = before.strip_suffix(b"'").unwrap_or(before);
    Some(RepeatedKey { text, before })
}

/// The error that js-yaml, ESLint 8's YAML parser, throws for a duplicate map key in `text`: its `YAMLException`
/// message, including `makeSnippet`'s output.
pub(crate) fn duplicated_mapping_key(text: &[u8]) -> Option<Vec<u8>> {
    use bstr::ByteSlice;
    let RepeatedKey { text, before } = before_repeated_key(text, true)?;
    let position = before.chars().count();
    let mut buffer: Vec<char> = text.chars().collect();
    if !matches!(buffer.last(), Some('\n' | '\r')) {
        buffer.push('\n');
    }
    // The start and end of each line.
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
        let visible = buffer.get(start..end).unwrap_or_default().iter();
        let visible: String = visible.map(|&c| if c == '\t' { '→' } else { c }).collect();
        let text = format!(" {:>number_width$} | {head}{visible}{tail}\n", at + 1);
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

/// The error that the `yaml` package, Prettier's YAML parser, reports for a duplicate map key in `text`, formatted by
/// its `prettifyError`.
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
    let raw_line = &text[line_start..line_end];
    let mut line = chars(raw_line.strip_suffix(b"\r").unwrap_or(raw_line));
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
    // Also show the previous line if there are only spaces before the key.
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

/// True if a file passed with `--config` is named like an oxfmt config: `.oxfmtrc.json`, `oxfmt.config.ts`,
/// `config/oxfmtrc.json`.
fn is_oxfmt_config_name(name: &[u8]) -> bool {
    strings::contains(name, b"oxfmt")
}

/// Display name of the Prettier config `NAMES[at]` in `directory`, or `None` if it isn't one. Never runs the file.
fn prettier_config_name(directory: &[u8], at: usize) -> Option<Vec<u8>> {
    let name = *NAMES.get(at)?;
    if !name.starts_with(b"package.") {
        return Some(name.to_vec());
    }
    let package = json::parse(&fs::read(&paths::join(directory, name)).ok()?)?;
    let has_config = !matches!(package.get(b"prettier")?, Json::Null | Json::Bool(false));
    has_config.then(|| [b"prettier in ", name].concat())
}

/// Returns `Some(true)` if the nearest config file, walking up from `directory`, is an oxfmt config, and `None` if
/// there's no config file. Only file names and the contents of `package.json` are checked. Nothing is loaded, so a
/// config that is a program doesn't run.
fn is_nearest_config_oxfmt(directory: &[u8]) -> Option<bool> {
    paths::ancestors(directory).find_map(|directory| {
        let at = (0..NAMES.len()).find(|&at| {
            fs::is_file(&paths::join(directory, NAMES[at]))
                && (at < OXFMT_NAME_COUNT || prettier_config_name(directory, at).is_some())
        })?;
        Some(at < OXFMT_NAME_COUNT)
    })
}

/// The formatters among a project's dependencies. They decide which tool a project without a configuration file
/// follows.
#[derive(Copy, Clone, Default)]
struct Formatters {
    oxfmt: bool,
    /// It bundles oxfmt as `vp fmt`, which reads its options from the `fmt` field of `vite.config.ts`.
    vite_plus: bool,
    prettier: bool,
}

impl Formatters {
    /// Returns the formatters listed in the nearest `package.json`, walking up from `directory`, that lists at least
    /// one.
    fn depended_on(directory: &[u8]) -> Formatters {
        let found = package_that_depends_on(directory, [b"oxfmt", b"vite-plus", b"prettier"]);
        let [oxfmt, vite_plus, prettier] = found.map_or([false; 3], |it| it.1);
        Formatters {
            oxfmt,
            vite_plus,
            prettier,
        }
    }
}

impl Plugins {
    /// `json` is an options object that may have `plugins`.
    fn from_options(json: &Json) -> Option<Plugins> {
        let plugins = json.get(b"plugins")?.as_array()?;
        Some(Plugins {
            has_unknown_plugins: !plugins.iter().all(is_built_in),
            sorts_classes: (plugins.iter().filter_map(name_of)).any(is_tailwind_plugin),
            reads_svelte: (plugins.iter().filter_map(name_of)).any(is_svelte_plugin),
            sorts_package_json: (plugins.iter().filter_map(name_of)).any(is_package_json_plugin),
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
                .filter_map(|it| plugin_endings(it.as_str()?))
                .flatten()
                .copied()
                .collect(),
        })
    }
}

impl Config {
    /// Returns `select(override)` for the last override that matches the file at `path`, considering only overrides for
    /// which `select` returns `Some`.
    fn in_last_override<'s, T>(
        &'s self,
        path: &[u8],
        select: impl Fn(&'s Override) -> Option<T>,
    ) -> Option<T> {
        let overrides = self.overrides.iter().rev();
        let mut found = overrides.filter_map(|it| Some((it, select(it)?)));
        let mut relative = None;
        let matches_file = |it: &(&Override, T)| {
            let directory = paths::dirname(&self.path);
            (it.0).matches(relative.get_or_insert_with(|| paths::relative(directory, path)))
        };
        found.find(matches_file).map(|it| it.1)
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
                    plugins: it.get(b"options").and_then(Plugins::from_options),
                    is_oxfmt,
                })
                .collect(),
            is_oxfmt,
            plugins: Plugins::from_options(json).unwrap_or_default(),
            ignores: gitignore::with_lines(None, paths::dirname(path), ignored.iter().copied()),
        }
    }
}

/// How to format a file.
#[derive(Default)]
pub(crate) struct Resolved {
    pub(crate) options: FormatOptions,
    /// oxfmt's `insertFinalNewline: false`.
    pub(crate) omits_final_newline: bool,
    /// True if the file's options include one of [`Configs::unsupported_options`].
    pub(crate) has_unsupported_option: bool,
    /// Format files with errors that oxc's parser recovers from, as oxc's formatter tests do. oxfmt itself rejects
    /// them.
    pub(crate) formats_recoverable_errors: bool,
}

/// Adds the JSX settings from the `tsconfig.json` at `path`, after those of the files it extends.
fn read_tsconfig(path: &[u8], settings: &mut Settings) {
    struct Open {
        path: Vec<u8>,
        json: Json,
        /// The number of extended files processed so far.
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
        // Skip a file that's already in the chain, to avoid a cycle.
        let found = found.filter(|found| chain.iter().all(|it| it.path != *found));
        chain.extend(found.and_then(open));
    }
}

pub(crate) type Found = Result<Arc<Scope>, Fatal>;

/// The directory entries that matter for its [`Scope`].
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
    /// `[[fmt.overrides]]`. Globs are relative to `bunfig_base_directory`.
    overrides: Vec<Override>,
    /// [`Options::bunfig_base_directory`]
    bunfig_base_directory: Vec<u8>,
    /// `--config`
    named: Option<Result<Arc<Config>, Fatal>>,
    /// [`Configs::name`]
    arguments: Guarded<Vec<Vec<u8>>>,
    /// [`Configs::lacks_file`]
    lacks_file: OnceLock<bool>,
    /// [`Configs::note`]
    note: OnceLock<Vec<u8>>,
    /// True if the caller has already made sure that a file's configuration files apply.
    applies_everywhere: bool,
    pub(crate) flavor: Flavor,
    /// Keyed by directory. See [`Configs::tsconfig_of`].
    tsconfigs: Guarded<FxHashMap<Vec<u8>, Arc<Settings>>>,
    /// [`PackageJsonPlugin::has_yarn_or_pnpm_files`]
    has_yarn_or_pnpm_files: OnceLock<bool>,
    /// Compiled import-sorting settings, keyed by the options they came from, so they're compiled once instead of per
    /// file.
    sort_imports: Guarded<Vec<(SortSettings, Option<Arc<SortImports>>)>>,
    /// With oxfmt, the only `.editorconfig` that applies: the one nearest to the working directory.
    oxfmt_editorconfig: Option<Arc<editorconfig::File>>,
    /// Warnings for the user.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
    /// Options that are set and change the original tool's output, but have no effect here.
    pub(crate) unsupported_options: Guarded<Vec<Vec<u8>>>,
    /// For `sortTailwindcss`.
    pub(crate) classes: Arc<tailwind::Classes>,
}

impl<'c> Configs<'c> {
    pub(crate) fn new(options: &'c Options, environment: &'c Environment<'c>) -> Configs<'c> {
        Configs::with(Cow::Borrowed(options), environment, false)
    }

    /// The path of the bunfig whose `[fmt]` was read, relative to the working directory.
    pub(crate) fn bunfig(&self) -> Option<&[u8]> {
        (self.options.has_bunfig_section).then_some(&self.options.bunfig[..])
    }

    /// Like [`Configs::new`], for a lint rule, taking ownership of the options. The linter decides whose configuration
    /// applies.
    pub(crate) fn owning(options: Options, environment: &'c Environment<'c>) -> Configs<'c> {
        Configs::with(Cow::Owned(options), environment, true)
    }

    fn with(
        options: Cow<'c, Options>,
        environment: &'c Environment<'c>,
        applies_everywhere: bool,
    ) -> Configs<'c> {
        let (is_like_oxfmt, reads_editorconfig) = (options.is_like_oxfmt, options.editorconfig);
        let named = options.config.clone();
        // Patterns in bunfig.toml are Bun's globs. `is_oxfmt` below makes `excludeFiles` match against the path, like
        // `files`.
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
            bunfig_base_directory: options.bunfig_base_directory(&environment.cwd),
            options,
            overrides,
            environment,
            by_directory: Guarded::new(FxHashMap::default()),
            named: None,
            arguments: Default::default(),
            lacks_file: OnceLock::new(),
            note: OnceLock::new(),
            applies_everywhere,
            flavor: Flavor::Prettier,
            tsconfigs: Guarded::new(FxHashMap::default()),
            has_yarn_or_pnpm_files: OnceLock::new(),
            sort_imports: Guarded::new(Vec::new()),
            oxfmt_editorconfig: None,
            warnings: Guarded::new(Vec::new()),
            unsupported_options: Guarded::new(Vec::new()),
            classes: Arc::default(),
        };
        let mut formatters = Formatters::default();
        // With `--config`, the project's config files aren't loaded.
        let project_is_oxfmt = match &named {
            Some(_) => Ok(is_like_oxfmt.or_else(|| is_nearest_config_oxfmt(&environment.cwd))),
            None => (configs.for_directory(&environment.cwd))
                .map(|scope| scope.config.as_ref().map(|config| config.is_oxfmt)),
        };
        let mut is_oxfmt = match project_is_oxfmt {
            Ok(Some(is_oxfmt)) => is_oxfmt,
            Ok(None) => is_like_oxfmt.unwrap_or_else(|| {
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
            // The config failed to load, so go by its file name.
            Err(_) => is_nearest_config_oxfmt(&environment.cwd).unwrap_or(false),
        };
        if let Some(path) = &named {
            let path = paths::resolve(&environment.cwd, &paths::from_native(path));
            // If the name doesn't say which tool it's for, assume the tool the project uses.
            let name = paths::basename(&path);
            is_oxfmt = is_oxfmt_config_name(name)
                || (is_oxfmt && !strings::contains(name, b"prettier") && name != b"package.json");
            configs.named = Some(match configs.load(&path, is_oxfmt) {
                Ok(Some(config)) => Ok(config),
                Ok(None) if VITE_CONFIG_NAMES.contains(&name) => Err(Fatal(
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
            // One config for the whole project: the nearest one, walking up from the working directory, that has `fmt`.
            configs.named = paths::ancestors(&environment.cwd)
                .filter_map(|directory| {
                    (VITE_CONFIG_NAMES.iter())
                        .map(|name| paths::join(directory, name))
                        .find(|path| fs::is_file(path))
                })
                .find_map(|path| configs.load(&path, true).transpose());
        }
        if is_oxfmt {
            configs.flavor = Flavor::Oxfmt;
            // Everything cached so far was looked up the way Prettier does it.
            configs.by_directory.get_mut().clear();
            if reads_editorconfig {
                configs.oxfmt_editorconfig = paths::ancestors(&environment.cwd)
                    .find_map(editorconfig::File::read_as_oxfmt)
                    .map(Arc::new);
            }
        }
        configs
    }

    /// Validates the configuration the run starts with. oxfmt stops if it's invalid.
    pub(crate) fn check(&self) -> Result<(), Fatal> {
        if let Some(Err(error)) = &self.named {
            return Err(Fatal(error.0.clone()));
        }
        if self.flavor == Flavor::Oxfmt {
            // `build_and_validate`: the configuration, plus the first `[*]` section of the `.editorconfig` for options
            // it doesn't set.
            let scope = self.for_directory(&self.environment.cwd)?;
            let settings = (self.config_of(&scope)?.into_iter()).flat_map(|it| &it.settings);
            let settings: Vec<(&[u8], &[u8])> = settings.map(|it| (&it.0[..], &it.1[..])).collect();
            let use_tabs = use_tabs_in(settings.iter().copied());
            let editorconfig_options = (scope.editorconfigs.first())
                .map(|it| editorconfig::root_options_for_oxfmt(it, use_tabs))
                .unwrap_or_default();
            let editorconfig_options = editorconfig_options.iter().map(|it| (it.0, &it.1[..]));
            let all: Vec<(&[u8], &[u8])> = editorconfig_options.chain(settings).collect();
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

    /// Prettier's `loadConfig`. `None` if the file has no configuration, like most `package.json` files.
    fn load(&self, path: &[u8], is_oxfmt: bool) -> Result<Option<Arc<Config>>, Fatal> {
        let name = paths::basename(path);
        let read = || {
            self.options.pipes.read(path).map_err(|error| {
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
            // Most don't even contain the word.
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
            // As in Prettier, one that can't be parsed counts as having no configuration.
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
            // `.prettierrc`, or a `--config` file without an extension, like `/dev/null`. It's YAML, which is a
            // superset of JSON.
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
            // The name of a package or file that contains the configuration.
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
            && let Some(pattern_error) = (json.get(b"overrides").and_then(Json::as_array))
                .unwrap_or_default()
                .iter()
                .flat_map(|it| [it.get(b"files"), it.get(b"excludeFiles")])
                .flat_map(strings_of)
                .find_map(glob_error)
        {
            return Err(Fatal(
                [&b"Failed to parse configuration.\n"[..], &pattern_error[..]].concat(),
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
            && let Some(line) = gitignore::rejected_line(ignored.iter().filter_map(Json::as_str))
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
        let override_plugins = config.overrides.iter().filter_map(|it| it.plugins.as_ref());
        let mut missing: Vec<&[u8]> = Vec::new();
        for name in [&config.plugins]
            .into_iter()
            .chain(override_plugins)
            .flat_map(|it| &it.missing)
        {
            if !missing.contains(&&name[..]) {
                missing.push(name);
            }
        }
        // Without the flag, the affected files are skipped, which is reported at the end.
        if !missing.is_empty() && self.options.allow_unsupported {
            let end: &[u8] = match missing.len() {
                1 => b" has no effect because bun fmt does not include that plugin",
                _ => b" have no effect because bun fmt does not include those plugins",
            };
            self.warn(&[&missing.join(&b", "[..]), b" in ", path, end]);
        }
        Ok(Some(Arc::new(config)))
    }

    /// The scope for `directory`, whose parent's scope is `above`. `entries` has each entry's name and whether it's a
    /// directory.
    fn scope<'n>(
        &self,
        directory: &[u8],
        entries: impl Iterator<Item = (&'n [u8], bool)>,
        above: Option<&Scope>,
    ) -> Found {
        let count = if self.flavor == Flavor::Oxfmt {
            OXFMT_NAME_COUNT
        } else {
            NAMES.len()
        };
        // Prettier asks the file system for each name, so on a case-insensitive one `.PrettierRC` is found as
        // `.prettierrc`.
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

    /// The scope for `directory`, given its relevant entries in `listed` and its parent's scope `above`.
    fn scope_of(&self, directory: &[u8], listed: Listed, above: Option<&Scope>) -> Found {
        let Listed {
            mut candidates,
            has_editorconfig,
            is_project_root,
        } = listed;
        let mut config = above.and_then(|it| it.config.clone());
        if self.named.is_none() && self.options.config_lookup && self.applies_in(directory) {
            // Try them in order, because a `package.json` doesn't have to contain a configuration.
            sort_slice(&mut candidates[..]);
            candidates.dedup();
            if let [first, second, ..] = candidates[..]
                && second < OXFMT_NAME_COUNT
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
                    self.load(&paths::join(directory, NAMES[at]), at < OXFMT_NAME_COUNT)?
                {
                    if at < OXFMT_NAME_COUNT
                        && let Some(other) =
                            candidates.find_map(|it| prettier_config_name(directory, it))
                    {
                        self.note_ignored(&found.path, &other);
                    }
                    config = Some(found);
                    break;
                }
            }
        }
        if self.flavor == Flavor::Oxfmt {
            let editorconfigs = self.oxfmt_editorconfig.iter().map(Arc::clone).collect();
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
        // package.json's dependencies are also checked when `--config` is passed, but the note doesn't apply then.
        let is_looked_for = self.named.is_none() && self.options.config_lookup;
        self.note.get().filter(|_| is_looked_for).map(|it| &it[..])
    }

    /// True if neither the working directory nor any of its parents has a configuration file.
    fn lacks_file(&self) -> bool {
        let has_none = || {
            let own = self.for_directory(&self.environment.cwd);
            own.is_ok_and(|it| it.config.is_none())
        };
        *self.lacks_file.get_or_init(has_none)
    }

    /// True if the run isn't imitating another tool: no Prettier or oxfmt config applies to the working directory, and
    /// no flag asks for one.
    pub(crate) fn is_native(&self) -> bool {
        self.flavor == Flavor::Prettier
            && self.options.is_like_oxfmt.is_none()
            && self.named.is_none()
            && (!self.options.config_lookup || self.lacks_file())
    }

    /// Records that `directory`, or a file in it, was passed as an argument.
    pub(crate) fn name(&self, directory: &[u8]) {
        let mut arguments = self.arguments.lock();
        if !arguments.iter().any(|it| it == directory) {
            arguments.push(directory.to_vec());
        }
    }

    /// True if a configuration file in `directory` applies. It can be a program. So in a run whose working directory
    /// has none, only files in the working directory's parents or at or below it apply, and likewise for paths passed
    /// as [arguments](Configs::name), but not files that a pattern merely happens to reach.
    fn applies_in(&self, directory: &[u8]) -> bool {
        let is_for = |it: &[u8]| {
            paths::is_at_or_inside(it, directory) || paths::is_at_or_inside(directory, it)
        };
        self.applies_everywhere
            || is_for(&self.environment.cwd)
            || !self.lacks_file()
            || self.arguments.lock().iter().any(|it| is_for(it))
    }

    /// The scope for the files in `directory`.
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
                // A broken configuration file doesn't matter if there's a nearer one.
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

    /// [`Configs::for_directory`] for a directory whose parent's scope is `above`. `entries` has each entry's name and
    /// whether it's a directory.
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

    /// The `ignorePatterns` of `scope`'s configuration file.
    pub(crate) fn config_ignores<'s>(&'s self, scope: &'s Scope) -> &'s Chain {
        self.config_of(scope)
            .ok()
            .flatten()
            .map_or(&None, |it| &it.ignores)
    }

    /// The configuration file that applies in `scope`.
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

    /// The options that `scope`'s `.editorconfig` files set for the file at `path`. `use_tabs` is the value from its
    /// configuration file.
    fn editorconfig_options(
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
                    None => editorconfig::root_options_for_oxfmt(it, use_tabs),
                })
                .unwrap_or_default(),
        }
    }

    /// True if some file configures the file at `path`, which is what `--config-precedence=prefer-file` checks: there's
    /// a configuration file, or an `.editorconfig` section matches it.
    fn has_config_for(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        self.config_of(scope).is_ok_and(|it| it.is_some())
            || !self.editorconfig_options(scope, path, None).is_empty()
    }

    /// True if files in `scope` are formatted the way oxfmt does: either the run emulates oxfmt, or their configuration
    /// file is oxfmt's, in a subdirectory of where the run started.
    pub(crate) fn is_oxfmt_for(&self, scope: &Scope) -> bool {
        self.flavor == Flavor::Oxfmt
            || (self.config_of(scope).ok().flatten()).is_some_and(|config| config.is_oxfmt)
    }

    /// The plugins the configuration lists for the file at `path` in `scope`. The last list that applies replaces the
    /// others. A `path` of `None` means text without a file name, which no override matches.
    fn plugins_for<'s>(&'s self, scope: &'s Scope, path: Option<&[u8]>) -> Option<&'s Plugins> {
        let config = self.config_of(scope).ok().flatten()?;
        let override_list =
            path.and_then(|path| config.in_last_override(path, |it| it.plugins.as_ref()));
        Some(override_list.unwrap_or(&config.plugins))
    }

    /// [`Plugins::missing`] for the file at `path` in `scope`.
    pub(crate) fn missing_plugins<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> &'s [Vec<u8>] {
        (self.plugins_for(scope, path)).map_or(&[][..], |it| &it.missing[..])
    }

    /// True if the config or `--plugin` lists a plugin that isn't built in, for the file at `path` in `scope`.
    pub(crate) fn lists_unknown_plugins(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.has_unknown_plugins)
            || !(self.options.plugins.iter()).all(|it| is_built_in_plugin(it))
    }

    /// True if the config or `--plugin` lists `prettier-plugin-tailwindcss` for the file at `path` in `scope`.
    fn lists_tailwind_plugin(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.sorts_classes)
            || (self.options.plugins.iter()).any(|it| is_tailwind_plugin(it))
    }

    /// The [`Oxc`] value for the file at `path` in `scope`, whose `parser` option is `parser`.
    fn oxc_for(&self, scope: &Scope, path: Option<&[u8]>, parser: Option<&[u8]>) -> Oxc {
        let config_oxc = self
            .plugins_for(scope, path)
            .map_or(Oxc::Absent, |it| it.oxc);
        match config_oxc {
            _ if parser.is_some_and(|it| !it.starts_with(b"oxc")) => Oxc::Absent,
            // Code in MDX is always parsed with Babel.
            _ if path.is_some_and(|it| it.ends_with(b".mdx")) => Oxc::Absent,
            Oxc::Absent => oxc_among(self.options.plugins.iter().map(|it| &it[..])),
            oxc => oxc,
        }
    }

    /// [`Plugins::endings`] for the file at `path` in `scope`.
    fn all_plugin_endings<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> impl Iterator<Item = &'static [u8]> + use<'s, 'c> {
        let flag_endings = (self.options.plugins.iter())
            .filter_map(|it| plugin_endings(it))
            .flatten();
        let config_plugins = self.plugins_for(scope, path).into_iter();
        config_plugins
            .flat_map(|it| &it.endings)
            .chain(flag_endings)
            .copied()
    }

    /// True if Prettier formats the file at `path` in `scope` with a plugin that adds a language.
    pub(crate) fn is_formatted_by_plugin(&self, scope: &Scope, path: &[u8]) -> bool {
        (self.all_plugin_endings(scope, Some(path))).any(|ending| path.ends_with(ending))
    }

    /// The packages that Prettier loads as plugins for the file at `path` in `scope`.
    pub(crate) fn plugin_packages<'s>(
        &'s self,
        scope: &'s Scope,
        path: Option<&[u8]>,
    ) -> impl Iterator<Item = &'s [u8]> + use<'s, 'c> {
        (self.plugins_for(scope, path).into_iter())
            .flat_map(|it| &it.packages)
            .chain(&self.options.plugins)
            .map(|it| &it[..])
    }

    /// The path of the configuration file that applies in `scope`.
    pub(crate) fn config_file_path<'s>(&'s self, scope: &'s Scope) -> Option<&'s [u8]> {
        (self.config_of(scope).ok().flatten()).map(|config| &config.path[..])
    }

    /// True if `--no-svelte` or `svelte = false` in `[fmt]` keeps a component in `directory`, whose scope is `scope`,
    /// from being formatted: it's set, and `--config-precedence` lets it win. An override can still turn it on for some
    /// files.
    pub(crate) fn turns_svelte_off(&self, scope: &Scope, directory: &[u8]) -> bool {
        self.svelte_from_flags(None) == Some(false)
            && !self.formats_svelte(scope, Some(&paths::join(directory, b"a.svelte")))
    }

    /// True if a flag or `[fmt]` turns Svelte off for the file at `path`.
    pub(crate) fn turns_svelte_off_for(&self, path: &[u8]) -> bool {
        self.svelte_from_flags(Some(path)) == Some(false)
    }

    /// True if a `[fmt]` override has `svelte = false`, and nothing takes precedence over it in `directory`, whose
    /// scope is `scope`.
    pub(crate) fn turns_svelte_off_for_some(&self, scope: &Scope, directory: &[u8]) -> bool {
        let path = paths::join(directory, b"a.svelte");
        (self.overrides.iter()).any(|it| svelte_in(&it.settings) == Some(false))
            && !self.formats_svelte_with(scope, Some(&path), Some(false))
    }

    /// True if `--parser svelte`, or the same in `[fmt]`, is set.
    pub(crate) fn requests_svelte_parser(&self) -> bool {
        (self.options.format.iter()).any(|it| it.0 == b"parser" && it.1 == b"svelte")
    }

    /// Returns true if Bun formats the Svelte in the file at `path` in `scope`. That's a component, or the Svelte
    /// blocks in a Markdown file. `path` is `None` for text without a file name.
    ///
    /// `--svelte`, `--no-svelte` and `svelte` in `[fmt]` decide. So does the config: oxfmt's with `svelte`, Prettier's
    /// by listing the plugin, whichever version of it is installed. If both are set, `--config-precedence` picks one,
    /// as for every option. If neither is set, Svelte is formatted if no config applies.
    pub(crate) fn formats_svelte(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        self.formats_svelte_with(scope, path, self.svelte_from_flags(path))
    }

    /// [`Configs::formats_svelte`], given `flags_value` as the value from the flags and `[fmt]`.
    fn formats_svelte_with(
        &self,
        scope: &Scope,
        path: Option<&[u8]>,
        flags_value: Option<bool>,
    ) -> bool {
        let files_value = || match self.is_oxfmt_for(scope) {
            true => self.svelte_from_oxfmt(scope, path),
            false => self.lists_svelte_plugin(scope, path).then_some(true),
        };
        let decided = match self.options.config_precedence {
            Precedence::CliOverride => flags_value.or_else(files_value),
            Precedence::FileOverride => files_value().or(flags_value),
            Precedence::PreferFile if self.has_config_for(scope, path) => files_value(),
            Precedence::PreferFile => flags_value,
        };
        decided.unwrap_or_else(|| self.is_native_in(scope))
    }

    /// The value that `--svelte`, `--no-svelte` or `svelte` in `[fmt]` sets for the file at `path`. The last override
    /// that matches the file and has the key takes precedence over the section.
    fn svelte_from_flags(&self, path: Option<&[u8]>) -> Option<bool> {
        let mut relative = None;
        let mut matches_file = |it: &Override| {
            let start = &self.bunfig_base_directory;
            path.is_some_and(|path| {
                it.matches(relative.get_or_insert_with(|| paths::relative(start, path)))
            })
        };
        let overrides = self.overrides.iter().rev();
        let mut with_svelte = overrides.filter_map(|it| Some((it, svelte_in(&it.settings)?)));
        let in_override = with_svelte.find(|it| matches_file(it.0)).map(|it| it.1);
        let svelte_setting = || self.options.format.iter().rfind(|it| it.0 == b"svelte");
        in_override.or_else(|| svelte_setting().map(|it| it.1 != b"false"))
    }

    /// True if the config or `--plugin` lists `prettier-plugin-svelte` for the file at `path` in `scope`.
    fn lists_svelte_plugin(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.reads_svelte)
            || (self.options.plugins.iter()).any(|it| is_svelte_plugin(it))
    }

    /// True if the config or `--plugin` lists `prettier-plugin-packagejson` for the file at `path` in `scope`.
    fn lists_package_json_plugin(&self, scope: &Scope, path: Option<&[u8]>) -> bool {
        (self.plugins_for(scope, path)).is_some_and(|it| it.sorts_package_json)
            || (self.options.plugins.iter()).any(|it| is_package_json_plugin(it))
    }

    /// `hasYarnOrPnpmFiles` of `sort-package-json`
    fn has_yarn_or_pnpm_files(&self) -> bool {
        *self.has_yarn_or_pnpm_files.get_or_init(|| {
            let kind = |name: &[u8]| fs::kind(&paths::join(&self.environment.cwd, name));
            let files: [&[u8]; 4] = [
                b"yarn.lock",
                b".yarnrc.yml",
                b"pnpm-lock.yaml",
                b"pnpm-workspace.yaml",
            ];
            files.iter().any(|it| kind(it).is_some()) || kind(b".yarn") == Some(fs::Kind::Directory)
        })
    }

    /// The value that `svelte` in oxfmt's configuration sets for the file at `path` in `scope`. An override can turn it
    /// on or off. Text without a file name isn't formatted.
    fn svelte_from_oxfmt(&self, scope: &Scope, path: Option<&[u8]>) -> Option<bool> {
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

    /// The `parser` option for the file at `path` in `scope`, if it's set.
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

    /// Prettier's `getOptionsForFile`: how to format the file at `path` in `scope`.
    pub(crate) fn options_for(&self, scope: &Scope, path: &[u8]) -> Result<Resolved, Fatal> {
        self.options_of(scope, Some(path))
    }

    /// Same for text without a file name, like `prettier --parser x < file`. `scope` is the working directory's.
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
            let matches_file =
                |it: &&Override| relative.as_ref().is_some_and(|path| it.matches(path));
            for it in config.overrides.iter().filter(matches_file) {
                from_config.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
            // oxfmt has no such option.
            if config.is_oxfmt {
                from_config.retain(|it| it.0 != b"parser");
            }
        }
        let mut from_files: Vec<(&[u8], &[u8])> = Vec::new();
        let use_tabs = use_tabs_in(from_config.iter().copied());
        let from_editorconfig = self.editorconfig_options(scope, path, use_tabs);
        // oxfmt doesn't support `max_line_length = off`, and Prettier doesn't support `insert_final_newline`.
        let is_supported = |it: &&(&[u8], Vec<u8>)| match is_oxfmt {
            true => (it.0, &it.1[..]) != (b"printWidth", UNLIMITED_WIDTH),
            false => it.0 != b"insertFinalNewline",
        };
        from_files.extend(
            from_editorconfig
                .iter()
                .filter(is_supported)
                .map(|it| (it.0, &it.1[..])),
        );
        if is_oxfmt && !from_files.iter().any(|it| it.0 == b"printWidth") {
            from_files.push((b"printWidth", b"100"));
        }
        from_files.extend(from_config);
        let mut from_flags: Vec<(&[u8], &[u8])> =
            (self.options.format.iter().map(|it| (it.0, &it.1[..]))).collect();
        if let Some(path) = path.filter(|_| !self.overrides.is_empty()) {
            let relative = paths::relative(&self.bunfig_base_directory, path);
            for it in self.overrides.iter().filter(|it| it.matches(&relative)) {
                from_flags.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
        }
        // Bun's `sortImports` does more than oxfmt's, so it gets its own name.
        for it in from_flags.iter_mut().filter(|it| it.0 == b"sortImports") {
            it.0 = BUN_SORT_IMPORTS;
        }
        // Its paths are relative to a different directory than a configuration file's.
        for it in from_flags
            .iter_mut()
            .filter(|it| it.0 == b"sortTailwindcss")
        {
            it.0 = BUN_SORT_TAILWINDCSS;
        }
        let flag_settings = from_flags.iter().copied();
        let all: Vec<(&[u8], &[u8])> = match self.options.config_precedence {
            Precedence::CliOverride => from_files.into_iter().chain(flag_settings).collect(),
            Precedence::FileOverride => flag_settings.chain(from_files).collect(),
            Precedence::PreferFile if self.has_config_for(scope, path) => from_files,
            Precedence::PreferFile => flag_settings.collect(),
        };
        // Prettier validates the flags first, even one that a file overrides.
        let mut flags = self.options.format.iter();
        if !is_oxfmt
            && let Some(width_error) = flags.find_map(|it| not_an_integer(it.0, &it.1, true))
        {
            return Err(Fatal(width_error));
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
            // oxfmt sorts `package.json` keys unless told not to.
            let _ = resolved.options.set(b"sortPackageJson", b"true");
        }
        let mut sort_imports: Option<Vec<u8>> = None;
        let mut sort_tailwindcss: Option<Vec<u8>> = None;
        let mut sets_package_json_sorting = false;
        // True if the last value read came from a flag or `[fmt]`.
        let mut is_tailwindcss_from_bun = false;
        let tailwindcss_set_by = |is_from_bun: bool| match config {
            Some(config) if config.is_oxfmt && !is_from_bun => {
                SetBy::Oxfmt(paths::dirname(&config.path))
            }
            _ => SetBy::Bun(&self.bunfig_base_directory),
        };
        // oxfmt-only options are also valid under a Prettier config when a flag or `[fmt]` sets them.
        let is_known = |name: &[u8]| {
            let name = match name {
                b"sortTailwindcss" => BUN_SORT_TAILWINDCSS,
                _ => name,
            };
            is_oxfmt || from_flags.iter().any(|it| it.0 == name)
        };
        // Prettier knows the options of the plugins it loaded.
        let knows_all_options = !is_oxfmt && !self.lists_unknown_plugins(scope, path);
        let lists_svelte_plugin = self.lists_svelte_plugin(scope, path);
        // Prettier validates a plugin's options for every file.
        let mut package_json = (!is_oxfmt && self.lists_package_json_plugin(scope, path))
            .then(PackageJsonPlugin::default);
        let mut unknown: Vec<(&[u8], &[u8])> = Vec::new();
        // The `sortTailwindcss` value built from the plugin's options.
        let mut plugin_entries =
            (!is_oxfmt && self.lists_tailwind_plugin(scope, path)).then(Vec::new);
        for (name, value) in all {
            if let Some(entries) = &mut plugin_entries
                && let Some(entry) = tailwind::plugin_option(name, value)
            {
                let entry = entry.map_err(Fatal)?;
                entries.retain(|it: &(Vec<u8>, Json)| it.0 != entry.0);
                entries.push(entry);
                continue;
            }
            match name {
                BUN_SORT_IMPORTS => _ = sort.set(name, value),
                // An oxfmt override only changes the keys it sets. `experimentalSortImports` is the old name.
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
                    sets_package_json_sorting = true;
                }
                b"packageSortOrder" if package_json.is_some() => {
                    let first = package_sort_order(value).map_err(Fatal)?;
                    package_json = Some(PackageJsonPlugin {
                        first,
                        ..Default::default()
                    });
                }
                b"experimentalSortPackageJson" if is_oxfmt => {
                    let _ = resolved.options.set(b"sortPackageJson", value);
                }
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
                // The plugin's remaining option, and all of its options where Svelte is off, are accepted and ignored.
                b"svelteSortOrder"
                | b"svelteAllowShorthand"
                | b"svelteIndentScriptAndStyle"
                | b"svelte5CompilerPath"
                    if lists_svelte_plugin => {}
                // `Configs::formats_svelte` already handled it.
                name if (name == b"svelte" || name.starts_with(b"svelte.")) && is_known(name) => {}
                name if name == b"jsdoc" || name.starts_with(b"jsdoc.") => {
                    if resolved.options.set(name, value).is_err() {
                        return Err(Fatal(
                            [b"Invalid ", name, b" value: ", value, b"."].concat(),
                        ));
                    }
                }
                // An override only changes the keys it sets.
                name if name == BUN_SORT_TAILWINDCSS || is_tailwind(name) && is_known(name) => {
                    let was_from_bun = is_tailwindcss_from_bun;
                    is_tailwindcss_from_bun = name == BUN_SORT_TAILWINDCSS;
                    sort_tailwindcss = Some(match &sort_tailwindcss {
                        Some(before) if was_from_bun != is_tailwindcss_from_bun => {
                            let set_by = tailwindcss_set_by(was_from_bun);
                            merged_objects(&tailwind::with_absolute_paths(before, set_by), value)
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
                        Some(width_error) if !is_oxfmt => width_error,
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
        // `svelte = false` skips the files with any config, even one that sets the `parser` the plugin's README
        // recommends.
        if resolved.options.parser.as_deref() == Some(b"svelte")
            && !resolved.options.svelte.is_on
            && self.svelte_from_flags(path) == Some(false)
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
        for (name, value) in sort.options_of_unlisted_plugins().chain(unknown) {
            // Strings have no quotes here, so a value is treated as JSON if it parses as something other than a string.
            let is_json = name.starts_with(b"tailwind");
            let json = json::parse(value).filter(|it| is_json || !matches!(it, Json::String(_)));
            let mut display_value = Vec::new();
            write_as_shown(
                &mut display_value,
                &json.unwrap_or_else(|| Json::String(value.to_vec())),
            );
            self.warn(&[
                b"Ignored unknown option { ",
                name,
                b": ",
                &display_value,
                b" }.",
            ]);
        }
        if sort.organizes_imports() {
            for (name, value) in self.tsconfig_of(directory).iter() {
                sort.set(name, value);
            }
        }
        resolved.options.sort_imports = self.sort_imports(sort)?;
        // A flag or `[fmt]` overrides the plugin.
        if let Some(mut plugin) = package_json
            && !sets_package_json_sorting
            && path.is_some_and(|it| paths::basename(it) == b"package.json")
        {
            plugin.has_yarn_or_pnpm_files = self.has_yarn_or_pnpm_files();
            resolved.options.sort_package_json = Some(SortPackageJson {
                plugin: Some(Arc::new(plugin)),
                ..Default::default()
            });
        }
        // A flag or `[fmt]` overrides the plugin.
        let (value, set_by) = match (sort_tailwindcss, plugin_entries) {
            (Some(value), _) => (value, tailwindcss_set_by(is_tailwindcss_from_bun)),
            (None, Some(entries)) => {
                if let Some(warning) = tailwind::plugin_warning(&entries) {
                    self.warn(&[&warning]);
                }
                let mut value = Vec::new();
                write_json(&mut value, &Json::Object(entries));
                // The config found by lookup, not the file passed with `--config`.
                let found = scope.config.as_ref().map(|it| paths::dirname(&it.path));
                (value, SetBy::Plugin(found.unwrap_or(&self.environment.cwd)))
            }
            (None, None) => (b"false".to_vec(), SetBy::Bun(&self.bunfig_base_directory)),
        };
        if value != b"false"
            && let Some(mut tailwind) =
                tailwind::for_file(&self.classes, &value, (set_by, directory))
        {
            tailwind.oxc = self.oxc_for(scope, path, resolved.options.parser.as_deref());
            resolved.options.tailwind = Some(Arc::new(tailwind));
        }
        Ok(resolved)
    }

    /// The JSX settings from the `tsconfig.json` nearest to `directory`, as import-sorting settings.
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
        if let Some((_, compiled)) = known.iter().find(|it| it.0 == settings) {
            return Ok(compiled.clone());
        }
        let compiled = settings.compile().map_err(Fatal)?;
        known.push((settings, compiled.clone()));
        Ok(compiled)
    }
}
