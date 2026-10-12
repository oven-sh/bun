//! Finds and reads the configuration of the formatter: Prettier's `resolveConfig`.
//!
//! The configuration of a file is in the first directory, from that of the file upwards, that has
//! a file of one of [`NAMES`]. `.editorconfig` files count besides, and less.
//!
//! Where the working directory has a configuration file of oxfmt, things are as in oxfmt
//! ([`Flavor::Oxfmt`]): which files are configuration files, how patterns are read, which
//! `.editorconfig` counts, and which files are ignored (`files.rs`).

use super::cli::{Options, Precedence};
use super::{editorconfig, tailwind};
use crate::configs::NAMES_OF_VITE;
use crate::gitignore::{self, Chain};
use crate::paths::package_of;
use crate::run::{Environment, Fatal};
use crate::{evaluate, fs, paths};
use bun_collections::index_sort::sort_slice;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::sort_imports::{Settings as SortSettings, SortImports};
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

/// The name [`SortSettings`] uses for `sortImports` when a flag or `[format]` sets it.
const SORT_IMPORTS_OF_BUN: &[u8] = b"bun.sortImports";

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
    /// One of them is not built in: its options are not known here.
    names_others: bool,
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

/// What the plugins that sort imports do is built in.
pub(super) fn is_built_in_plugin(name: &[u8]) -> bool {
    let name = package_of(name);
    name.ends_with(b"/prettier-plugin-sort-imports") || name == b"prettier-plugin-organize-imports"
}

fn is_built_in(plugin: &Json) -> bool {
    plugin.as_str().is_some_and(is_built_in_plugin)
}

/// Plugins that add a language to Prettier and leave the others as they are, with how the names of its files end.
/// Without them the rest of a project is formatted the same.
const PLUGINS_FOR_LANGUAGES: [(&[u8], &[&[u8]]); 22] = [
    (b"prettier-plugin-svelte", &[b".svelte"]),
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
fn write_as_shown(out: &mut Vec<u8>, value: &Json) {
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
    let (Some(Json::Object(mut entries)), Some(Json::Object(added))) =
        (bun_lint::json::parse(before), bun_lint::json::parse(after))
    else {
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
            Json::Object(properties) if name == b"jsdoc" => {
                settings.push((name.clone(), b"{}".to_vec()));
                for (property, value) in properties {
                    if let Some(value) = text_or_bool(value) {
                        settings.push(([b"jsdoc.", &property[..]].concat(), value));
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
            names_others: !plugins.iter().all(is_built_in),
            // One that is not a name is an object that a configuration in JavaScript has imported.
            missing: (plugins.iter())
                .map(|it| it.as_str().unwrap_or(b"(an object)"))
                .filter(|it| is_missing_plugin(it))
                .map(<[u8]>::to_vec)
                .collect(),
            packages: (plugins.iter().filter_map(Json::as_str))
                .filter(|it| !it.starts_with(b".") && !it.starts_with(b"/"))
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
    /// `[[format.overrides]]`. Globs are relative to the working directory.
    overrides: Vec<Override>,
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
            match json::parse_as(Notation::Yaml, &read()?)
                .as_ref()
                .ok()
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
            match json::parse(&text) {
                Some(json @ Json::Object(_)) => json,
                _ => json::parse_as(Notation::Yaml, &text).map_err(|why| fail(&why))?,
            }
        } else if name.ends_with(b".yaml") || name.ends_with(b".yml") {
            parse(Notation::Yaml)?
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
        if of_overrides
            .chain([&config.plugins])
            .any(|it| !it.missing.is_empty())
        {
            self.warn(&[
                b"\"plugins\" in ",
                path,
                b" has no effect because bun format does not load Prettier plugins",
            ]);
        }
        Ok(Some(Arc::new(config)))
    }

    /// What counts in `directory`, whose entries are `names`, and whose parent has `above`.
    fn scope<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
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
        for name in
            names.filter(|name| matches!(name.first(), Some(b'.' | b'p' | b'o' | b'P' | b'O')))
        {
            if is_called(name, b".editorconfig") {
                listed.has_editorconfig = true;
            } else if is_called(name, b".git") || is_called(name, b".hg") {
                listed.is_project_root = true;
            } else {
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
            let names = entries.iter().map(|it| &it.name[..]);
            let found = match &above {
                Some(Ok(above)) => self.scope(directory, names, Some(above)),
                None => self.scope(directory, names, None),
                // A configuration file that cannot be used does not matter below a nearer one.
                Some(Err(error)) => {
                    self.scope(directory, names, None)
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

    /// The same for a directory whose entries are `names`, and whose parent has `above`.
    pub(crate) fn for_listed_directory<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
        above: &Arc<Scope>,
    ) -> Found {
        if self.options.disable_nested_config {
            return Ok(Arc::clone(above));
        }
        let found = self.scope(directory, names, Some(above));
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

    /// Whether the files that have `scope` are printed as oxfmt prints them: the run is like oxfmt, or their
    /// configuration file is one of oxfmt's, in a directory below where the run has started.
    pub(crate) fn is_oxfmt_for(&self, scope: &Scope) -> bool {
        self.flavor == Flavor::Oxfmt
            || (self.config_of(scope).ok().flatten()).is_some_and(|config| config.is_oxfmt)
    }

    /// The plugins that the configuration names for the file at `path`, which has `scope`: the last list that applies
    /// is the list.
    fn plugins_for<'s>(&'s self, scope: &'s Scope, path: &[u8]) -> Option<&'s Plugins> {
        let config = self.config_of(scope).ok().flatten()?;
        let of_override = config.in_last_override(path, |it| it.plugins.as_ref());
        Some(of_override.unwrap_or(&config.plugins))
    }

    /// See [`Plugins::missing`], for the file at `path`, which has `scope`.
    pub(crate) fn missing_plugins<'s>(&'s self, scope: &'s Scope, path: &[u8]) -> &'s [Vec<u8>] {
        (self.plugins_for(scope, path)).map_or(&[][..], |it| &it.missing[..])
    }

    /// See [`Plugins::endings`], for the file at `path`, which has `scope`.
    fn endings_of_plugins<'s>(
        &'s self,
        scope: &'s Scope,
        path: &[u8],
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
        (self.endings_of_plugins(scope, path)).any(|ending| path.ends_with(ending))
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
        path: &[u8],
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

    /// Whether the configuration of oxfmt has `svelte` for the file at `path`, which has `scope`: oxfmt formats a
    /// component only then. An override can turn it on and off.
    pub(crate) fn formats_svelte(&self, scope: &Scope, path: &[u8]) -> bool {
        let Some(config) = (self.config_of(scope).ok().flatten()).filter(|it| it.is_oxfmt) else {
            return false;
        };
        let last_in = |settings: &Settings| {
            let about_it = settings.iter().rfind(|it| it.0 == b"svelte");
            about_it.map(|it| it.1 != b"false")
        };
        config
            .in_last_override(path, |it| last_in(&it.settings))
            .or_else(|| last_in(&config.settings))
            .unwrap_or(false)
    }

    /// Returns true if TOML gets formatted in `scope`. Prettier doesn't format TOML, so this needs native mode and no
    /// Prettier config for the directory.
    pub(crate) fn formats_toml(&self, scope: &Scope) -> bool {
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
        let config = self.config_of(scope)?;
        let is_oxfmt = self.is_oxfmt_for(scope);
        let mut from_config: Vec<(&[u8], &[u8])> = Vec::new();
        if let Some(config) = config {
            from_config.extend(config.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            let relative = paths::relative(paths::dirname(&config.path), path);
            for it in config.overrides.iter().filter(|it| it.matches(&relative)) {
                from_config.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
            // oxfmt has no such option.
            if config.is_oxfmt {
                from_config.retain(|it| it.0 != b"parser");
            }
        }
        let mut from_files: Vec<(&[u8], &[u8])> = Vec::new();
        let from_editorconfig = match (self.options.config_lookup, self.flavor) {
            (false, _) => Vec::new(),
            (true, Flavor::Prettier) => {
                editorconfig::options_for(scope.editorconfigs.iter().map(|it| &**it), path)
            }
            (true, Flavor::Oxfmt) => {
                let use_tabs = use_tabs_in(from_config.iter().copied());
                (scope.editorconfigs.first())
                    .map(|it| editorconfig::options_for_oxfmt(it, path, use_tabs))
                    .unwrap_or_default()
            }
        };
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
        let has_files = config.is_some() || !from_editorconfig.is_empty();
        let mut from_flags: Vec<(&[u8], &[u8])> =
            (self.options.format.iter().map(|it| (it.0, &it.1[..]))).collect();
        if !self.overrides.is_empty() {
            let relative = paths::relative(&self.environment.cwd, path);
            for it in self.overrides.iter().filter(|it| it.matches(&relative)) {
                from_flags.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
        }
        // Bun's `sortImports` does more than oxfmt's, so it gets its own name.
        for it in from_flags.iter_mut().filter(|it| it.0 == b"sortImports") {
            it.0 = SORT_IMPORTS_OF_BUN;
        }
        let of_flags = from_flags.iter().copied();
        let all: Vec<(&[u8], &[u8])> = match self.options.config_precedence {
            Precedence::CliOverride => from_files.into_iter().chain(of_flags).collect(),
            Precedence::FileOverride => of_flags.chain(from_files).collect(),
            Precedence::PreferFile if has_files => from_files,
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
        let _ = resolved.options.set(b"filepath", path);
        resolved.options.format_javascript = Some(super::format_javascript(self.options.verify));
        resolved.options.parse_javascript = Some(super::parse_javascript);
        resolved.options.embedded_html = true;
        resolved.options.toml = self.formats_toml(scope);
        if is_oxfmt {
            let _ = resolved.options.set(b"flavor", b"oxfmt");
            // It sorts the keys of a `package.json` unless it is told not to.
            let _ = resolved.options.set(b"sortPackageJson", b"true");
        }
        let mut sort_imports: Option<Vec<u8>> = None;
        let mut sort_tailwindcss: Option<Vec<u8>> = None;
        // oxfmt-only options are also valid under a Prettier config when a flag or `[format]` sets them.
        let is_known = |name: &[u8]| is_oxfmt || from_flags.iter().any(|it| it.0 == name);
        // Prettier knows the options of the plugins that it has loaded.
        let knows_all_options = !is_oxfmt
            && !(self.plugins_for(scope, path)).is_some_and(|it| it.names_others)
            && (self.options.plugins.iter()).all(|it| is_built_in_plugin(it));
        let mut unknown: Vec<(&[u8], &[u8])> = Vec::new();
        for (name, value) in all {
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
                name if name == b"jsdoc" || name.starts_with(b"jsdoc.") => {
                    if resolved.options.set(name, value).is_err() {
                        return Err(Fatal(
                            [b"Invalid ", name, b" value: ", value, b"."].concat(),
                        ));
                    }
                }
                // An override changes the keys that it has.
                name if is_tailwind(name) && is_known(name) => {
                    sort_tailwindcss = Some(match &sort_tailwindcss {
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
        if !is_oxfmt
            && resolved.options.parser.is_none()
            && let Some(parser) = super::files::parser_by_interpreter(path)
        {
            let _ = resolved.options.set(b"parser", parser);
        }
        for name in &self.options.plugins {
            sort.add_plugin(name);
        }
        for (name, value) in sort.of_plugins_not_named().chain(unknown) {
            // A string and what else there is in JSON are told apart by their looks here.
            let json = json::parse(value).filter(|it| !matches!(it, Json::String(_)));
            let mut shown = Vec::new();
            write_as_shown(
                &mut shown,
                &json.unwrap_or_else(|| Json::String(value.to_vec())),
            );
            self.warn(&[b"Ignored unknown option { ", name, b": ", &shown, b" }."]);
        }
        if sort.organizes_imports() {
            for (name, value) in self.tsconfig_of(paths::dirname(path)).iter() {
                sort.set(name, value);
            }
        }
        resolved.options.sort_imports = self.sort_imports(sort)?;
        if let Some(value) = sort_tailwindcss.filter(|it| it != b"false") {
            // Paths in an oxfmt config are relative to that file. Paths in `[format]` are relative to the working directory.
            let of_config = (config.filter(|it| it.is_oxfmt)).map(|it| paths::dirname(&it.path));
            let tailwind =
                tailwind::for_file(&self.classes, self.environment, &value, (of_config, path));
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
