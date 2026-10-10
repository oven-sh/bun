//! `[lint]` and `[format]` of bunfig.toml. A key is the default of the flag of the same name: `maxWarnings` of
//! `--max-warnings`, `semi = false` of `--no-semi`. A section becomes the same `Options` as a command line does, by the
//! same `Options::set`, and the command line is laid over it. So what a key takes is what its flag takes: the kind of
//! value is read from the table of flags, and a value is refused by what refuses it after the flag.
//!
//! Bun's reader of bunfig.toml finds and parses the file. What it calls with the file is here.

use crate::args::{Param, UsageError, error};
use crate::format::Format;
use bun_ast::expr::Data;
use bun_ast::{Expr, Loc};
use bun_clap::Values;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::json::Notation;
use bun_lint::options::Json;
use bun_lint::utils::text::number_to_string;

/// What is wrong with a section, and where in the file.
pub struct Refusal {
    pub at: Loc,
    pub message: Vec<u8>,
}

/// [`lint`] or [`format`]: what a bunfig.toml says to the command. `Ok(None)`: nothing.
pub type Read<T> = fn(&Expr) -> Result<Option<T>, Refusal>;

/// What `read` makes of `text`, which is what a bunfig.toml has, for a caller that is without Bun's reader of that file:
/// the test harness. `Err`: a line for the user.
pub fn of_text<T>(text: &[u8], read: Read<T>) -> Result<Option<T>, Vec<u8>> {
    bun_lint::json::with_parsed(Notation::Toml, text, read)?.map_err(|it| it.message)
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
        let renamed = self.renamed.iter().map(|it| it.0.to_vec());
        renamed.chain(self.flags.iter().map(|flag| key_of(flag)))
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
                    b"\" cannot be set in bunfig.toml, it says what one run does. Pass --",
                    flag,
                    b" on the command line",
                ],
            );
        }
        let section = self.section.as_bytes();
        let closest = self
            .keys()
            .min_by_key(|it| strings::edit_distance(key.iter().copied(), &it[..]))
            .unwrap_or_default();
        refuse(
            at,
            &[
                b"unknown key \"",
                key,
                b"\" in [",
                section,
                b"]. Did you mean \"",
                &closest,
                b"\"?",
            ],
        )
    }

    /// Takes in `key = value`, as the flag.
    fn set(&self, key: &Key, value: &Expr, set: &mut Set) -> Result<(), Refusal> {
        give(self.param_of(&key.name, key.at)?, value, set)
    }
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
    match (bun_lint::json::from_parsed(value), param.id.value) {
        (Some(Json::Number(number)), b"n") => Ok(number_to_string(number)),
        (_, b"n") => expected("number", value),
        (Some(Json::String(text)), _) => Ok(text),
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
        let Some(Json::String(name)) = bun_lint::json::from_parsed(key) else {
            return None;
        };
        Some((Key { name, at: key.loc }, value))
    });
    Ok(entries.collect())
}

const FORMAT: Table = Table {
    section: "format",
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
    ],
    renamed: &[
        (b"config", b"config"),
        (b"ignorePatterns", b"ignore-pattern"),
    ],
    actions: &[
        b"check",
        b"list-different",
        b"write",
        b"stdin-filepath",
        b"find-config-path",
        b"range-start",
        b"range-end",
        b"cursor-offset",
        b"init",
        b"migrate",
        b"list-files",
        b"verify",
        b"timing",
        b"color",
        b"cwd",
        b"version",
        b"help",
    ],
    others: &[
        b"no-config",
        b"no-editorconfig",
        b"no-semi",
        b"no-bracket-spacing",
        b"no-error-on-unmatched-pattern",
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
    "A flag of `bun format` is in none of the lists of `FORMAT`. If it describes the project it is a key of `[format]` in \
     bunfig.toml: add it to `flags`, to docs/runtime/bunfig.mdx and to the test. If it says what one run does: `actions`."
);

/// What `[format]` of `file` says.
pub fn format(file: &Expr) -> Result<Option<crate::fmt::cli::Options>, Refusal> {
    let Some(section) = file.get(b"format") else {
        return Ok(None);
    };
    let mut options = crate::fmt::cli::Options::default();
    for (key, value) in entries(&section)? {
        // `--no-config` is the opposite of a flag that takes a value.
        if key.name == b"config" && matches!(value.data, Data::EBoolean(it) if !it.value) {
            options.config_lookup = false;
            continue;
        }
        FORMAT.set(&key, value, &mut |flag, value, is_on| {
            options.set(flag, value, is_on)?;
            // With the flag, a wrong value comes out at the first file.
            match options.format.last().filter(|it| key.name == it.0) {
                Some((name, value))
                    if bun_format::FormatOptions::default()
                        .set(name, value)
                        .is_err() =>
                {
                    error(&[b"Invalid ", *name, b" value: ", &value[..], b"."])
                }
                _ => Ok(()),
            }
        })?;
    }
    Ok(Some(options))
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
        (b"rules", b"rule"),
        (b"globals", b"global"),
        (b"parserOptions", b"parser-options"),
        (b"categories", b"allow"),
        (b"categories", b"warn"),
        (b"categories", b"deny"),
    ],
    actions: &[
        b"fix",
        b"fix-dry-run",
        b"fix-suggestions",
        b"fix-dangerously",
        b"init",
        b"stdin",
        b"stdin-filename",
        b"print-config",
        b"rules",
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
        b"parser",
        b"plugin",
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

/// `off`, `warn` or `error`, or the number for it.
fn severity_of(table: &[u8], value: &Expr) -> Result<Severity, Refusal> {
    let text = match bun_lint::json::from_parsed(value) {
        Some(Json::String(text)) => text,
        Some(Json::Number(number)) => number_to_string(number),
        _ => return expected("string", value),
    };
    crate::cli::severity(table, &text).map_err(at(value))
}

fn json_of(value: &Expr) -> Result<Json, Refusal> {
    let json = bun_lint::json::from_parsed(value);
    json.map_or_else(|| refuse(value.loc, &[b"it is nested too deep"]), Ok)
}

/// What `[lint]` of `file` says, and `[format]`, which is for the rule that holds a file against what `bun format` prints.
pub fn lint(file: &Expr) -> Result<Option<crate::cli::Options>, Refusal> {
    let mut options = crate::cli::Options {
        of_bun_format: format(file)?.map(Box::new),
        ..Default::default()
    };
    let Some(section) = file.get(b"lint") else {
        return Ok(options.of_bun_format.is_some().then_some(options));
    };
    for (key, value) in entries(&section)? {
        let set: &mut Set = &mut |flag, value, is_on| options.set(flag, value, is_on);
        match &key.name[..] {
            // One key for two flags, as in `linterOptions` of ESLint.
            b"reportUnusedDisableDirectives" if !matches!(value.data, Data::EBoolean(_)) => {
                give(LINT.param(UNUSED_SEVERITY), value, set)?;
            }
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
            b"globals" => {
                for (name, value) in entries(value)? {
                    let is_writable = match bun_lint::json::from_parsed(value) {
                        Some(Json::Bool(is_writable)) => is_writable,
                        Some(Json::String(it)) if it == b"writable" => true,
                        Some(Json::String(it)) if it == b"readonly" => false,
                        _ => return expected("\"readonly\" or \"writable\"", value),
                    };
                    let suffix: &[u8] = if is_writable { b":true" } else { b"" };
                    set(
                        &b"global"[..],
                        Some(&[&name.name[..], suffix].concat()),
                        true,
                    )
                    .map_err(at(value))?;
                }
            }
            // oxlint goes through `-A`, `-W` and `-D` in their order, and `all` is about every other one.
            b"categories" => {
                let mut categories = entries(value)?;
                bun_lint::utils::sort::sort_by_key(&mut categories, |it| it.0.name != b"all");
                for (name, value) in categories {
                    let is_known = crate::configs::CATEGORIES.contains(&&name.name[..])
                        || matches!(&name.name[..], b"all" | b"nursery");
                    if !is_known {
                        return refuse(name.at, &[b"unknown category \"", &name.name, b"\""]);
                    }
                    let flag: &[u8] = match severity_of(b"categories", value)? {
                        Severity::Off => b"allow",
                        Severity::Warn => b"warn",
                        Severity::Error => b"deny",
                    };
                    set(flag, Some(&name.name), true).map_err(at(value))?;
                }
            }
            // The flags read levn, which has no way to write every string. The values go in behind that.
            b"rules" => {
                for (rule, setting) in entries(value)? {
                    let first = match &setting.data {
                        Data::EArray(items) => items.slice().first().unwrap_or(setting),
                        _ => setting,
                    };
                    severity_of(b"rules", first)?;
                    options.add_rules(vec![(rule.name, json_of(setting)?)]);
                }
            }
            b"parserOptions" => {
                for (name, value) in entries(value)? {
                    options.add_parser_options(vec![(name.name, json_of(value)?)]);
                }
            }
            _ => LINT.set(&key, value, set)?,
        }
    }
    // A flag that only ESLint or only oxlint has tells whom a command line was written for. A key was written for Bun.
    options.forget_whose_flags_it_has();
    Ok(Some(options))
}
