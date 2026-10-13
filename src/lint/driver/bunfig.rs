//! Reads `[lint]` and `[fmt]` from bunfig.toml. A key sets the default for the flag with the same name: `maxWarnings`
//! for `--max-warnings`, `semi = false` for `--no-semi`. A section is turned into the same `Options` as a command line,
//! through the same `Options::set`, and the command line is applied on top of it. So a key takes exactly what its flag
//! takes: the value's type comes from the flag table, and the code that rejects a bad value for the flag rejects it here.
//!
//! A few keys can say more than a flag can: the tables and `overrides` in `[lint]`, and in `[fmt]` both `overrides` and
//! the options of the features that a flag only turns on ([`FEATURES`]).
//!
//! Bun's bunfig.toml loader finds and parses the file, then calls into this module.

use crate::args::{Param, UsageError, error};
use crate::format::Format;
use bun_ast::expr::Data;
use bun_ast::{Expr, Loc};
use bun_clap::Values;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::Step;
use bun_lint::linter::config::glob_refusal;
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_lint::utils::text::number_to_string;

/// What is wrong with a section, and where in the file.
pub struct Refusal {
    pub at: Loc,
    pub message: Vec<u8>,
}

fn refuse<T>(at: Loc, parts: &[&[u8]]) -> Result<T, Refusal> {
    Err(Refusal {
        at,
        message: parts.concat(),
    })
}

fn expected<T>(what: &str, value: &Expr) -> Result<T, Refusal> {
    let received = value.data.tag_name().as_bytes();
    refuse(
        value.loc,
        &[b"expected ", what.as_bytes(), b" but received ", received],
    )
}

/// `Options::set`
type Set<'s> = dyn FnMut(&'static [u8], Option<&[u8]>, bool) -> Result<(), UsageError> + 's;

/// Every flag of a command is in one of the four lists, by its long name.
struct Table {
    section: &'static str,
    params: &'static [Param],
    /// The flags that describe the project. The key is the name in camelCase.
    flags: &'static [&'static [u8]],
    /// The same, with a key that is called otherwise, or that is read by hand.
    renamed: &'static [(&'static [u8], &'static [u8])],
    /// Keys that have no flag.
    without_flag: &'static [&'static [u8]],
    /// The flags that say what one run does. A file that rewrites code without a word, or that prints something else than
    /// the report, is a trap: the key is refused with the name of the flag.
    actions: &'static [&'static [u8]],
    /// The flags that have no key: parts of a configuration file, which bunfig.toml is not one more of, what has no
    /// effect, and the lines of the help that are the opposite of a flag.
    others: &'static [&'static [u8]],
}

const fn contains(list: &[&[u8]], name: &[u8]) -> bool {
    let mut at = 0;
    while at < list.len() {
        if strings::const_bytes_eq(list[at], name) {
            return true;
        }
        at += 1;
    }
    false
}

/// `max-warnings` as a key: `maxWarnings`.
fn key_of(flag: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(flag.len());
    for part in strings::split(flag, b"-") {
        let start = key.len();
        key.extend_from_slice(part);
        if let Some(first) = key.get_mut(start).filter(|_| start > 0) {
            first.make_ascii_uppercase();
        }
    }
    key
}

impl Table {
    const fn has_every_flag(&self) -> bool {
        let mut at = 0;
        while at < self.params.len() {
            let mut is_renamed = false;
            if let Some(name) = self.params[at].names.long {
                let mut other = 0;
                while other < self.renamed.len() {
                    is_renamed |= strings::const_bytes_eq(self.renamed[other].1, name);
                    other += 1;
                }
                if !is_renamed
                    && !contains(self.flags, name)
                    && !contains(self.actions, name)
                    && !contains(self.others, name)
                {
                    return false;
                }
            }
            at += 1;
        }
        true
    }

    /// The flag with the long name `name`, which there is.
    const fn param(&self, name: &[u8]) -> &'static Param {
        let mut at = 0;
        while at < self.params.len() {
            if let Some(long) = self.params[at].names.long
                && strings::const_bytes_eq(long, name)
            {
                return &self.params[at];
            }
            at += 1;
        }
        panic!("A key of bunfig.toml is for a flag that does not exist.")
    }

    const fn only_has_flags(&self) -> bool {
        let mut at = 0;
        while at < self.flags.len() {
            self.param(self.flags[at]);
            at += 1;
        }
        at = 0;
        while at < self.renamed.len() {
            self.param(self.renamed[at].1);
            at += 1;
        }
        true
    }

    fn keys(&self) -> impl Iterator<Item = Vec<u8>> {
        let renamed = self.renamed.iter().map(|it| it.0);
        let written = renamed.chain(self.without_flag.iter().copied());
        (written.map(<[u8]>::to_vec)).chain(self.flags.iter().map(|flag| key_of(flag)))
    }

    /// The flag that `key` is the default of.
    fn param_of(&self, key: &[u8], at: Loc) -> Result<&'static Param, Refusal> {
        let renamed = self.renamed.iter().find(|it| it.0 == key).map(|it| it.1);
        let flag = renamed.or_else(|| self.flags.iter().copied().find(|flag| key_of(flag) == key));
        let param = flag.and_then(|flag| self.params.iter().find(|it| it.names.long == Some(flag)));
        if let Some(param) = param {
            return Ok(param);
        }
        if let Some(flag) = self.actions.iter().find(|flag| key_of(flag) == key) {
            return refuse(
                at,
                &[
                    b"\"",
                    key,
                    b"\" cannot be set in bunfig.toml\n  Use --",
                    flag,
                    b" on the command line",
                ],
            );
        }
        let section = self.section.as_bytes();
        match self.renamed.iter().find(|it| key_of(it.1) == key) {
            Some((meant, _)) => refuse(at, &[&not_a_key(key, section, Some(meant))]),
            None => unknown_key(key, at, section, self.keys()),
        }
    }

    /// Takes in `key = value`, as the flag.
    fn set(&self, key: &Key, value: &Expr, set: &mut Set) -> Result<(), Refusal> {
        give(self.param_of(&key.name, key.at)?, value, set)
    }
}

/// Error message for `key`, which isn't a key of the `section` table. `meant` is the key to suggest, if any.
fn not_a_key(key: &[u8], section: &[u8], meant: Option<&[u8]>) -> Vec<u8> {
    let mut message = [b"Unknown key \"", key, b"\" in [", section, b"]"].concat();
    if let Some(meant) = meant {
        message.extend_from_slice(&[b"\n  Did you mean \"", meant, b"\"?"].concat());
    }
    message
}

/// Rejects `key`, which isn't one of `keys` (all the keys of the `section` table), and suggests the closest one.
fn unknown_key<T>(
    key: &[u8],
    at: Loc,
    section: &[u8],
    keys: impl Iterator<Item = Vec<u8>>,
) -> Result<T, Refusal> {
    let closest = keys
        .map(|it| (strings::edit_distance(key.iter().copied(), &it[..]), it))
        .min_by_key(|it| it.0)
        .filter(|it| it.0 <= key.len().max(3) / 3);
    let closest = closest.as_ref().map(|it| &it.1[..]);
    refuse(at, &[&not_a_key(key, section, closest)])
}

fn at(value: &Expr) -> impl Fn(UsageError) -> Refusal {
    let at = value.loc;
    move |UsageError(message)| Refusal { at, message }
}

/// Takes in `value` as what the flag `param` is given.
fn give(param: &'static Param, value: &Expr, set: &mut Set) -> Result<(), Refusal> {
    let name = param.names.long.unwrap_or_default();
    match (param.takes_value, &value.data) {
        (Values::None, Data::EBoolean(it)) => set(name, None, it.value).map_err(at(value)),
        (Values::None, _) => expected("boolean", value),
        (Values::Many, Data::EArray(items)) => items.slice().iter().try_for_each(|item| {
            set(name, Some(&text_of(param, item, "string")?), true).map_err(at(item))
        }),
        (Values::Many, _) => {
            set(name, Some(&text_of(param, value, "array")?), true).map_err(at(value))
        }
        _ => set(name, Some(&text_of(param, value, "string")?), true).map_err(at(value)),
    }
}

/// What is written after the flag `param` for `value`. A flag takes a number if the help calls what it takes `<n>`.
/// `what`: what is expected where it is a string that is taken.
fn text_of(param: &Param, value: &Expr, what: &str) -> Result<Vec<u8>, Refusal> {
    match (&mut bun_lint::json::from_parsed(value), param.id.value) {
        (Some(Json::Number(number)), b"n") => Ok(number_to_string(*number)),
        (_, b"n") => expected("number", value),
        (Some(Json::String(text)), _) => Ok(std::mem::take(text)),
        _ => expected(what, value),
    }
}

struct Key {
    name: Vec<u8>,
    at: Loc,
}

/// The keys of the table `section`, with their values.
fn entries(section: &Expr) -> Result<Vec<(Key, &Expr)>, Refusal> {
    let Data::EObject(table) = &section.data else {
        return expected("object", section);
    };
    let entries = table.properties.iter().filter_map(|it| {
        let (key, value) = (it.key.as_ref()?, it.value.as_ref()?);
        let name = bun_lint::json::from_parsed(key)?.into_string()?;
        Some((Key { name, at: key.loc }, value))
    });
    Ok(entries.collect())
}

const FORMAT: Table = Table {
    section: "fmt",
    params: crate::fmt::cli::PARAMS,
    flags: &[
        b"disable-nested-config",
        b"editorconfig",
        b"config-precedence",
        b"ignore-path",
        b"with-node-modules",
        b"error-on-unmatched-pattern",
        b"ignore-unknown",
        b"log-level",
        b"threads",
        b"allow-unsupported",
        b"flavor",
        // The options of Prettier: a key is what the option is called in a `.prettierrc`.
        b"print-width",
        b"tab-width",
        b"use-tabs",
        b"semi",
        b"single-quote",
        b"jsx-single-quote",
        b"quote-props",
        b"trailing-comma",
        b"bracket-spacing",
        b"bracket-same-line",
        b"arrow-parens",
        b"object-wrap",
        b"single-attribute-per-line",
        b"html-whitespace-sensitivity",
        b"vue-indent-script-and-style",
        b"prose-wrap",
        b"embedded-language-formatting",
        b"end-of-line",
        b"require-pragma",
        b"check-ignore-pragma",
        b"insert-pragma",
        b"experimental-ternaries",
        b"experimental-operator-position",
        // Features beyond Prettier's options. The first five also take a table, see `FEATURES`.
        b"sort-imports",
        b"sort-tailwindcss",
        b"sort-package-json",
        b"jsdoc",
        b"svelte",
        b"insert-final-newline",
    ],
    renamed: &[
        (b"config", b"config"),
        (b"ignorePatterns", b"ignore-pattern"),
    ],
    without_flag: &[b"overrides"],
    actions: &[
        b"check",
        b"list-different",
        b"write",
        b"stdin-filepath",
        b"staged",
        b"changed",
        b"find-config-path",
        b"range-start",
        b"range-end",
        b"cursor-offset",
        b"init",
        b"doctor",
        b"format",
        b"migrate",
        b"list-files",
        b"debug-check",
        b"timing",
        b"color",
        b"cwd",
        b"version",
        b"help",
        b"all",
        b"help-all",
    ],
    others: &[
        b"no-config",
        b"no-editorconfig",
        b"no-semi",
        b"no-bracket-spacing",
        b"no-error-on-unmatched-pattern",
        b"no-insert-final-newline",
        b"no-svelte",
        b"no-color",
        b"parser",
        b"plugin",
        b"jsx-bracket-same-line",
        b"cache",
        b"cache-location",
        b"cache-strategy",
        b"experimental-cli",
        b"lsp",
    ],
};

const _: () = assert!(FORMAT.only_has_flags());
const _: () = assert!(
    FORMAT.has_every_flag(),
    "A flag of `bun fmt` is in none of the lists of `FORMAT`. If it describes the project it is a key of `[fmt]` in \
     bunfig.toml: add it to `flags`, to docs/runtime/bunfig.mdx and to the test. If it says what one run does: `actions`."
);

/// Value type of an option in a [`Feature`] table.
#[derive(Copy, Clone)]
enum Takes {
    Boolean,
    String,
    Strings,
    /// An array with mixed items. The code that consumes it validates the items.
    Array,
}

impl Takes {
    fn check(self, value: &Expr) -> Result<(), Refusal> {
        match (self, &value.data) {
            (Takes::Boolean, Data::EBoolean(_))
            | (Takes::String, Data::EString(_))
            | (Takes::Array, Data::EArray(_)) => Ok(()),
            (Takes::Strings, Data::EArray(items)) => (items.slice().iter())
                .find(|it| !it.is_string())
                .map_or(Ok(()), |it| expected("string", it)),
            (Takes::Boolean, _) => expected("boolean", value),
            (Takes::String, _) => expected("string", value),
            (Takes::Strings | Takes::Array, _) => expected("array", value),
        }
    }
}

/// How a feature's table is stored in `Options::format`.
#[derive(Copy, Clone)]
enum As {
    /// As one JSON value. The function validates it.
    Json(fn(&[u8]) -> Result<(), Vec<u8>>),
    /// As one entry per option.
    Parts,
}

fn check_sort_imports(json: &[u8]) -> Result<(), Vec<u8>> {
    let mut sort = bun_format::sort_imports::Settings::default();
    sort.set(b"sortImports", json);
    sort.compile().map(|_| ())
}

/// A `[fmt]` key that takes `true`, `false`, or a table of options.
struct Feature {
    flag: &'static [u8],
    /// Its name in `Options::format`.
    name: &'static [u8],
    table: As,
    /// Each option is stored as `<name>.<key>`.
    options: &'static [(&'static [u8], Takes)],
}

const FEATURES: [Feature; 5] = [
    Feature {
        flag: b"sort-imports",
        name: b"sortImports",
        table: As::Json(check_sort_imports),
        options: &[
            (b"sortImports.groups", Takes::Array),
            (b"sortImports.customGroups", Takes::Array),
            (b"sortImports.internalPattern", Takes::Strings),
            (b"sortImports.newlinesBetween", Takes::Boolean),
            (b"sortImports.order", Takes::String),
            (b"sortImports.ignoreCase", Takes::Boolean),
            (b"sortImports.sortSideEffects", Takes::Boolean),
            (b"sortImports.partitionByComment", Takes::Boolean),
            (b"sortImports.partitionByNewline", Takes::Boolean),
        ],
    },
    Feature {
        flag: b"sort-tailwindcss",
        name: b"sortTailwindcss",
        table: As::Json(|_| Ok(())),
        options: &[
            (b"sortTailwindcss.stylesheet", Takes::String),
            (b"sortTailwindcss.config", Takes::String),
            (b"sortTailwindcss.functions", Takes::Strings),
            (b"sortTailwindcss.attributes", Takes::Strings),
            (b"sortTailwindcss.preserveWhitespace", Takes::Boolean),
            (b"sortTailwindcss.preserveDuplicates", Takes::Boolean),
        ],
    },
    Feature {
        flag: b"sort-package-json",
        name: b"sortPackageJson",
        table: As::Parts,
        options: &[(b"sortPackageJson.sortScripts", Takes::Boolean)],
    },
    Feature {
        flag: b"jsdoc",
        name: b"jsdoc",
        table: As::Parts,
        options: &[
            (b"jsdoc.capitalizeDescriptions", Takes::Boolean),
            (b"jsdoc.commentLineStrategy", Takes::String),
            (b"jsdoc.separateTagGroups", Takes::Boolean),
            (b"jsdoc.separateReturnsFromParam", Takes::Boolean),
            (b"jsdoc.bracketSpacing", Takes::Boolean),
            (b"jsdoc.descriptionWithDot", Takes::Boolean),
            (b"jsdoc.addDefaultToDescription", Takes::Boolean),
            (b"jsdoc.preferCodeFences", Takes::Boolean),
            (b"jsdoc.lineWrappingStyle", Takes::String),
            (b"jsdoc.descriptionTag", Takes::Boolean),
            (b"jsdoc.keepUnparsableExampleIndent", Takes::Boolean),
        ],
    },
    Feature {
        flag: b"svelte",
        name: b"svelte",
        table: As::Parts,
        options: &[
            (b"svelte.sortOrder", Takes::String),
            (b"svelte.allowShorthand", Takes::Boolean),
            (b"svelte.indentScriptAndStyle", Takes::Boolean),
        ],
    },
];

impl Feature {
    /// Strips the `<name>.` prefix from an entry of [`Feature::options`].
    fn key_of(&self, name: &'static [u8]) -> &'static [u8] {
        name.get(self.name.len() + 1..).unwrap_or_default()
    }

    /// Applies the `value` that `[fmt]` has for this feature.
    fn set(&self, value: &Expr, options: &mut crate::fmt::cli::Options) -> Result<(), Refusal> {
        let table = match &value.data {
            Data::EBoolean(it) => {
                return options.set(self.flag, None, it.value).map_err(at(value));
            }
            Data::EObject(_) => entries(value)?,
            _ => return expected("boolean or object", value),
        };
        let mut parts = Vec::new();
        for (key, value) in table {
            let mut known = self.options.iter();
            let Some(&(name, takes)) = known.find(|it| self.key_of(it.0) == key.name) else {
                let keys = self.options.iter().map(|it| self.key_of(it.0).to_vec());
                return unknown_key(&key.name, key.at, &[b"fmt.", self.name].concat(), keys);
            };
            takes.check(value)?;
            if matches!(self.table, As::Json(_)) {
                continue;
            }
            let text = match &mut json_of(value)? {
                Json::String(text) => std::mem::take(text),
                other => {
                    let mut text = Vec::new();
                    write_json(&mut text, other);
                    text
                }
            };
            if bun_format::FormatOptions::default()
                .set(name, &text)
                .is_err()
            {
                let hint: &[u8] = match name {
                    b"svelte.sortOrder" => {
                        b"\n  Use \"none\", or all four parts in the order you want: \"options-scripts-markup-styles\""
                    }
                    _ => b"",
                };
                return refuse(
                    value.loc,
                    &[b"Invalid ", name, b" value: ", &text, b".", hint],
                );
            }
            parts.push((name, text));
        }
        let mut whole = Vec::new();
        match self.table {
            As::Json(check) => {
                write_json(&mut whole, &json_of(value)?);
                let at = value.loc;
                check(&whole).map_err(|message| Refusal { at, message })?;
            }
            As::Parts => whole.extend_from_slice(b"true"),
        }
        options.format.push((self.name, whole));
        options.format.extend(parts);
        Ok(())
    }
}

/// What `[fmt]` of `file` says.
pub fn format(file: &Expr) -> Result<Option<crate::fmt::cli::Options>, Refusal> {
    if let Some(section) = file.get(b"format") {
        return refuse(
            section.loc,
            &[b"Unknown section [format]\n  Did you mean [fmt]?"],
        );
    }
    let Some(section) = file.get(b"fmt") else {
        return Ok(None);
    };
    let mut options = crate::fmt::cli::Options::default();
    for (key, value) in entries(&section)? {
        // `--no-config` is the opposite of a flag that takes a value.
        if key.name == b"config" && matches!(value.data, Data::EBoolean(it) if !it.value) {
            options.config_lookup = false;
            continue;
        }
        if key.name == b"overrides" {
            options.overrides = overrides(value)?;
            continue;
        }
        set_in_format(&key, value, &mut options)?;
    }
    Ok(Some(options))
}

/// Applies `key = value` from `[fmt]` or from the `options` of an override.
fn set_in_format(
    key: &Key,
    value: &Expr,
    options: &mut crate::fmt::cli::Options,
) -> Result<(), Refusal> {
    if let Some(feature) = FEATURES.iter().find(|it| it.name == key.name) {
        return feature.set(value, options);
    }
    FORMAT.set(key, value, &mut |flag, value, is_on| {
        options.set(flag, value, is_on)?;
        // The flag only reports an invalid value once the first file is formatted. Here it's checked right away.
        let given = options.format.last().filter(|_| value.is_some());
        match given.filter(|it| key.name == it.0) {
            Some((name, value))
                if bun_format::FormatOptions::default()
                    .set(name, value)
                    .is_err() =>
            {
                error(&[b"Invalid ", *name, b" value: ", &value[..], b"."])
            }
            _ => Ok(()),
        }
    })
}

/// Parses one glob or an array of globs.
fn patterns(value: &Expr) -> Result<Vec<Vec<u8>>, Refusal> {
    let all: Vec<Vec<u8>> = match &mut json_of(value)? {
        Json::String(one) => vec![std::mem::take(one)],
        Json::Array(all) => {
            Takes::Strings.check(value)?;
            all.drain(..).filter_map(Json::into_string).collect()
        }
        _ => return expected("string or array", value),
    };
    match all.iter().find_map(|it| glob_refusal(it)) {
        Some(refusal) => refuse(value.loc, &[&refusal]),
        None => Ok(all),
    }
}

/// Parses `[[fmt.overrides]]`. Same shape as in a `.prettierrc`. `options` takes the `[fmt]` keys that affect output.
fn overrides(value: &Expr) -> Result<Vec<crate::fmt::cli::Override>, Refusal> {
    let items = tables_of(value, b"fmt")?;
    // `parser` only makes sense for some files, so it's allowed here and not at the top level.
    let is_option = |flag: &&&[u8]| crate::fmt::cli::option_of(flag).is_some();
    let options_of = |table: &Expr| {
        let mut options = crate::fmt::cli::Options::default();
        for (key, value) in entries(table)? {
            if key.name == b"parser" {
                let set: &mut Set = &mut |flag, value, is_on| options.set(flag, value, is_on);
                give(FORMAT.param(b"parser"), value, set)?;
                continue;
            }
            let mut keys = FORMAT.flags.iter().filter(is_option).map(|it| key_of(it));
            if !keys.any(|it| it == key.name) {
                let keys = FORMAT.flags.iter().filter(is_option).map(|it| key_of(it));
                let keys = keys.chain([b"parser".to_vec()]);
                return unknown_key(&key.name, key.at, b"fmt.overrides.options", keys);
            }
            set_in_format(&key, value, &mut options)?;
        }
        Ok(options.format)
    };
    let one = |item: &Expr| {
        let mut it = crate::fmt::cli::Override::default();
        for (key, value) in entries(item)? {
            match &key.name[..] {
                b"files" => it.files = patterns(value)?,
                b"excludeFiles" => it.excluded = patterns(value)?,
                b"options" => it.format = options_of(value)?,
                _ => {
                    let keys = [&b"files"[..], b"excludeFiles", b"options"];
                    let keys = keys.iter().map(|it| it.to_vec());
                    return unknown_key(&key.name, key.at, b"fmt.overrides", keys);
                }
            }
        }
        needs_files(item, &it.files)?;
        Ok(it)
    };
    items.iter().map(one).collect()
}

/// The tables in `value`, which is the `overrides` array of `section`.
fn tables_of<'e>(value: &'e Expr, section: &[u8]) -> Result<&'e [Expr], Refusal> {
    match &value.data {
        Data::EArray(items) => Ok(items.slice()),
        Data::EObject(_) => refuse(
            value.loc,
            &[
                b"\"overrides\" is an array of tables\n  Write [[",
                section,
                b".overrides]], with two brackets",
            ],
        ),
        _ => expected("array", value),
    }
}

/// Rejects `item`, an entry of `overrides`, if it has no `files` to say what it applies to.
fn needs_files(item: &Expr, files: &[Vec<u8>]) -> Result<(), Refusal> {
    match files.is_empty() {
        true => refuse(item.loc, &[b"an override needs \"files\""]),
        false => Ok(()),
    }
}

const LINT: Table = Table {
    section: "lint",
    params: crate::cli::PARAMS,
    flags: &[
        b"config",
        b"config-lookup",
        b"flavor",
        b"ext",
        b"ignore-path",
        b"ignore",
        b"warn-ignored",
        b"quiet",
        b"silent",
        b"max-warnings",
        b"deny-warnings",
        b"format",
        b"all",
        b"inline-config",
        b"report-unused-inline-configs",
        b"suppressions-location",
        b"pass-on-unpruned-suppressions",
        b"error-on-unmatched-pattern",
        b"pass-on-no-patterns",
        b"exit-on-fatal-error",
        b"allow-unsupported",
        b"type-aware",
        b"infer-globals",
        b"tsconfig",
        b"project",
        b"type-check",
        b"disable-nested-config",
        b"fix-type",
        b"threads",
    ],
    renamed: &[
        (b"ignorePatterns", b"ignore-pattern"),
        (b"nativePluginRules", NATIVE_PLUGIN_RULES),
        (
            b"reportUnusedDisableDirectives",
            b"report-unused-disable-directives",
        ),
        (b"reportUnusedDisableDirectives", UNUSED_SEVERITY),
        (b"plugins", b"plugin"),
        (b"rules", b"rule"),
        (b"globals", b"global"),
        (b"parserOptions", b"parser-options"),
        (b"categories", b"allow"),
        (b"categories", b"warn"),
        (b"categories", b"deny"),
    ],
    without_flag: &[b"settings", b"overrides"],
    actions: &[
        b"fix",
        b"fix-dry-run",
        b"fix-suggestions",
        b"fix-dangerously",
        b"init",
        b"stdin",
        b"stdin-filename",
        b"staged",
        b"changed",
        b"print-config",
        b"doctor",
        b"rules",
        b"explain",
        b"list-files",
        b"env-info",
        b"stats",
        b"inspect-config",
        b"suppress-all",
        b"suppress-rule",
        b"prune-suppressions",
        b"output-file",
        b"color",
        b"timing",
        b"debug",
        b"cwd",
        b"version",
        b"help",
        b"help-all",
    ],
    others: &[
        b"no-config-lookup",
        b"no-ignore",
        b"no-warn-ignored",
        b"no-color",
        b"no-inline-config",
        b"no-error-on-unmatched-pattern",
        b"no-type-aware",
        b"no-infer-globals",
        b"no-native-plugin-rules",
        b"no-eslintrc",
        b"parser",
        b"eslintrc",
        b"env",
        b"rulesdir",
        b"resolve-plugins-relative-to",
        b"disable-unicorn-plugin",
        b"disable-oxc-plugin",
        b"disable-typescript-plugin",
        b"import-plugin",
        b"react-plugin",
        b"jsdoc-plugin",
        b"jest-plugin",
        b"vitest-plugin",
        b"jsx-a11y-plugin",
        b"nextjs-plugin",
        b"react-perf-plugin",
        b"promise-plugin",
        b"node-plugin",
        b"vue-plugin",
        b"cache",
        b"cache-file",
        b"cache-location",
        b"cache-strategy",
        b"concurrency",
        b"flag",
        b"mcp",
        b"lsp",
    ],
};

const UNUSED_SEVERITY: &[u8] = b"report-unused-disable-directives-severity";
const NATIVE_PLUGIN_RULES: &[u8] = b"native-plugin-rules";

const _: () = assert!(LINT.only_has_flags());
const _: () = assert!(
    LINT.has_every_flag(),
    "A flag of `bun lint` is in none of the lists of `LINT`. If it describes the project it is a key of `[lint]` in \
     bunfig.toml: add it to `flags`, to docs/runtime/bunfig.mdx and to the test. If it says what one run does: `actions`."
);

/// Parses `off`, `warn`, `error`, or the matching number. `of` is the rule or category name, for the error message.
fn severity_of(of: &[u8], value: &Expr) -> Result<Severity, Refusal> {
    let written = json_of(value)?;
    let severity = bun_lint::linter::severity_of(&written);
    severity.map_or_else(
        || refuse(value.loc, &[&crate::native::invalid_severity(of, &written)]),
        Ok,
    )
}

/// Byte offset of a value in bunfig.toml, and of the values nested in it.
#[derive(Clone, Debug, Default)]
pub struct Place {
    pub at: usize,
    pub items: Vec<Place>,
    /// Each key, the key's offset, and its value.
    pub entries: Vec<(Vec<u8>, usize, Place)>,
}

impl Place {
    fn of(value: &Expr) -> Place {
        let mut place = Place {
            at: value.loc.start.max(0) as usize,
            ..Place::default()
        };
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return place;
        }
        match &value.data {
            Data::EArray(items) => place.items = items.slice().iter().map(Place::of).collect(),
            Data::EObject(_) => {
                let entries = entries(value).unwrap_or_default().into_iter();
                let entries = entries
                    .map(|(key, value)| (key.name, key.at.start.max(0) as usize, Place::of(value)));
                place.entries = entries.collect();
            }
            _ => {}
        }
        place
    }

    /// Returns the offset of the value at `path`, or of the deepest value that exists along it. With `is_about_key`,
    /// returns the offset of the last key instead.
    pub(crate) fn find(&self, path: &[Step], is_about_key: bool) -> usize {
        let (mut place, mut at) = (self, self.at);
        for (depth, step) in path.iter().enumerate() {
            let next = match step {
                Step::Index(index) => place.items.get(*index).map(|it| (it.at, it)),
                Step::Key(key) => {
                    let mut entries = place.entries.iter();
                    entries.find(|it| it.0 == *key).map(|it| (it.1, &it.2))
                }
            };
            let Some((key_at, next)) = next else {
                break;
            };
            let is_last = depth + 1 == path.len();
            (place, at) = (
                next,
                if is_last && is_about_key {
                    key_at
                } else {
                    next.at
                },
            );
        }
        at
    }
}

/// One entry of `plugins` in `[lint]`.
#[derive(Clone, Debug)]
pub struct PluginOfBunfig {
    /// `name`: the prefix of its rules, if that isn't the name the plugin has for itself.
    pub alias: Option<Vec<u8>>,
    pub at: usize,
}

/// Parses `plugins`. An entry is a path or the name of a package, or `{ name = "..", specifier = ".." }`, as in oxlint's
/// `jsPlugins`.
fn plugins(value: &Expr) -> Result<(Vec<Vec<u8>>, Vec<PluginOfBunfig>), Refusal> {
    let Data::EArray(items) = &value.data else {
        return expected("array", value);
    };
    let (mut specifiers, mut places) = (Vec::new(), Vec::new());
    for item in items.slice() {
        let text = |value: &Expr| match json_of(value)?.as_str() {
            Some(text) => Ok(text.to_vec()),
            None => expected("string", value),
        };
        let (mut specifier, mut alias) = (None, None);
        match &item.data {
            Data::EObject(_) => {
                for (key, value) in entries(item)? {
                    match &key.name[..] {
                        b"specifier" => specifier = Some(text(value)?),
                        b"name" => {
                            let name = text(value)?;
                            if name.is_empty() {
                                return refuse(value.loc, &[b"A plugin's name can't be empty"]);
                            }
                            alias = Some(name);
                        }
                        _ => {
                            let known = [b"name".to_vec(), b"specifier".to_vec()];
                            return unknown_key(
                                &key.name,
                                key.at,
                                b"lint.plugins",
                                known.into_iter(),
                            );
                        }
                    }
                }
            }
            _ => specifier = Some(text(item)?),
        }
        let Some(specifier) = specifier else {
            return refuse(
                item.loc,
                &[b"A plugin needs a specifier\n  A path, or the name of a package"],
            );
        };
        specifiers.push(specifier);
        places.push(PluginOfBunfig {
            alias,
            at: item.loc.start.max(0) as usize,
        });
    }
    Ok((specifiers, places))
}

/// One entry of `[lint.rules]` or of an override's `rules`.
#[derive(Clone, Debug)]
pub struct RuleOfBunfig {
    pub key_at: usize,
    pub setting: Json,
    pub place: Place,
}

fn json_of(value: &Expr) -> Result<Json, Refusal> {
    let json = bun_lint::json::from_parsed(value);
    json.map_or_else(
        || refuse(value.loc, &[b"this value is nested too deeply"]),
        Ok,
    )
}

/// Parses `[lint.rules]` or an override's `rules`, and records where each entry is. This doesn't go through `--rule`,
/// because that flag parses levn, which can't express every string.
fn rules(table: &Expr) -> Result<(Vec<(Vec<u8>, Json)>, Vec<RuleOfBunfig>), Refusal> {
    let (mut rules, mut places) = (Vec::new(), Vec::new());
    for (rule, setting) in entries(table)? {
        let first = match &setting.data {
            Data::EArray(items) => items.slice().first().unwrap_or(setting),
            _ => setting,
        };
        severity_of(&rule.name, first)?;
        let written = json_of(setting)?;
        places.push(RuleOfBunfig {
            key_at: rule.at.start.max(0) as usize,
            setting: written.clone(),
            place: Place::of(setting),
        });
        rules.push((rule.name, written));
    }
    Ok((rules, places))
}

/// Parses `[[lint.overrides]]`.
fn overrides_of_lint(value: &Expr) -> Result<Vec<crate::cli::Override>, Refusal> {
    let items = tables_of(value, b"lint")?;
    let one = |item: &Expr| {
        let mut it = crate::cli::Override::default();
        for (key, value) in entries(item)? {
            match &key.name[..] {
                b"files" => it.files = patterns(value)?,
                b"excludeFiles" => it.excluded = patterns(value)?,
                b"rules" => (it.rules, it.places) = rules(value)?,
                b"globals" => it.globals = globals(value)?,
                b"settings" => it.settings = settings(value)?,
                _ => {
                    let keys = [
                        &b"files"[..],
                        b"excludeFiles",
                        b"rules",
                        b"globals",
                        b"settings",
                    ];
                    let keys = keys.iter().map(|it| it.to_vec());
                    return unknown_key(&key.name, key.at, b"lint.overrides", keys);
                }
            }
        }
        needs_files(item, &it.files)?;
        Ok(it)
    };
    items.iter().map(one).collect()
}

/// Parses `[lint.globals]` or an override's `globals`. A boolean means what it means to ESLint: whether the global is
/// writable.
fn globals(table: &Expr) -> Result<Vec<(Vec<u8>, Json)>, Refusal> {
    let one = |(name, value): (Key, &Expr)| {
        let kind: &[u8] = match &bun_lint::json::from_parsed(value) {
            Some(Json::Bool(true)) => b"writable",
            Some(Json::Bool(false)) => b"readonly",
            Some(Json::String(it)) if it == b"writable" => b"writable",
            Some(Json::String(it)) if it == b"readonly" => b"readonly",
            Some(Json::String(it)) if it == b"off" => b"off",
            _ => {
                let mut message = Vec::new();
                write_json(&mut message, &json_of(value)?);
                message.extend_from_slice(b" is not a valid value for the global ");
                message.extend_from_slice(&name.name);
                message.extend_from_slice(b"\n  Expected \"readonly\", \"writable\", or \"off\"");
                return refuse(value.loc, &[&message]);
            }
        };
        Ok((name.name, Json::String(kind.to_vec())))
    };
    entries(table)?.into_iter().map(one).collect()
}

/// Parses `[lint.settings]` or an override's `settings`.
fn settings(table: &Expr) -> Result<Vec<(Vec<u8>, Json)>, Refusal> {
    let one = |(name, value): (Key, &Expr)| Ok((name.name, json_of(value)?));
    entries(table)?.into_iter().map(one).collect()
}

/// What `[lint]` of `file` says.
pub fn lint(file: &Expr) -> Result<Option<crate::cli::Options>, Refusal> {
    let mut options = crate::cli::Options::default();
    let Some(section) = file.get(b"lint") else {
        return Ok(None);
    };
    for (key, value) in entries(&section)? {
        let set: &mut Set = &mut |flag, value, is_on| options.set(flag, value, is_on);
        match &key.name[..] {
            // One key for two flags, as in `linterOptions` of ESLint.
            b"reportUnusedDisableDirectives" if !matches!(value.data, Data::EBoolean(_)) => {
                let severity = severity_of(&key.name, value)?;
                options.report_unused_disable_directives_severity = Some(severity);
            }
            b"reportUnusedInlineConfigs" => {
                options.report_unused_inline_configs = Some(severity_of(&key.name, value)?);
            }
            b"maxWarnings" => match json_of(value)? {
                Json::Number(count) if count.fract() == 0.0 => options.max_warnings = count as i64,
                Json::Number(_) => {
                    return refuse(value.loc, &[b"maxWarnings must be a whole number"]);
                }
                _ => return expected("number", value),
            },
            b"fixType" => LINT.set(&key, value, set).map_err(|mut refusal| {
                if refusal.message == crate::cli::INVALID_FIX_TYPE {
                    refusal.message = b"Unknown fix type\n  Expected \"directive\", \"problem\", \"suggestion\", or \"layout\"".to_vec();
                }
                refusal
            })?,
            // With the flag, a wrong name comes out when the report is printed.
            b"format" => {
                LINT.set(&key, value, set)?;
                let name = options.format.as_deref().unwrap_or_default();
                if [false, true]
                    .iter()
                    .all(|it| Format::by_name(name, *it).is_none())
                {
                    return refuse(value.loc, &[&Format::is_missing(name)]);
                }
            }
            b"nativePluginRules" => {
                let text = match &value.data {
                    Data::EBoolean(it) if it.value => b"true".to_vec(),
                    Data::EBoolean(_) => b"false".to_vec(),
                    // With a comma at the end it is a list, whatever is in it.
                    Data::EArray(items) => {
                        let names = items.slice().iter();
                        let names =
                            names.map(|it| text_of(LINT.param(NATIVE_PLUGIN_RULES), it, "string"));
                        [
                            names.collect::<Result<Vec<_>, _>>()?.join(&b","[..]),
                            b",".to_vec(),
                        ]
                        .concat()
                    }
                    _ => return expected("boolean or array", value),
                };
                set(NATIVE_PLUGIN_RULES, Some(&text), true).map_err(at(value))?;
            }
            b"globals" => options.globals = globals(value)?,
            // oxlint goes through `-A`, `-W` and `-D` in their order, and `all` is about every other one.
            b"categories" => {
                let mut categories = entries(value)?;
                bun_lint::utils::sort::sort_by_key(&mut categories, |it| it.0.name != b"all");
                for (name, value) in categories {
                    if !crate::configs::is_category(&name.name) {
                        let known = crate::configs::CATEGORIES.iter().copied();
                        let known = known.chain([&b"nursery"[..], b"all"]).map(<[u8]>::to_vec);
                        return unknown_key(&name.name, name.at, b"lint.categories", known);
                    }
                    let flag: &[u8] = match severity_of(&name.name, value)? {
                        Severity::Off => b"allow",
                        Severity::Warn => b"warn",
                        Severity::Error => b"deny",
                    };
                    set(flag, Some(&name.name), true).map_err(at(value))?;
                }
            }
            b"plugins" => (options.plugin, options.plugins_of_bunfig) = plugins(value)?,
            b"rules" => (options.rule, options.rules_of_bunfig) = rules(value)?,
            b"settings" => options.settings = settings(value)?,
            b"overrides" => options.overrides = overrides_of_lint(value)?,
            b"parserOptions" => {
                for (name, value) in entries(value)? {
                    options.add_parser_options(vec![(name.name, json_of(value)?)]);
                }
            }
            _ => LINT.set(&key, value, set)?,
        }
    }
    options.forget_whose_flags_it_has();
    Ok(Some(options))
}
