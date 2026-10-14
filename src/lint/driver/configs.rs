//! Finds and loads config files. This is ESLint's `ConfigLoader`.
//!
//! A file uses the closest config: walk up from the file's directory and stop at the first directory that has a file
//! named in [`NAMES`]. If a directory has several, the one that comes first in [`NAMES`] wins. Configs are never merged.
//!
//! ESLint 8's files ([`eslintrc::NAMES`]) are only used if no directory on the way up has a file from [`NAMES`], because
//! neither ESLint nor oxlint reads them next to a config of its own. These are merged with the ones in parent directories.
//!
//! A tool never reads another tool's config files. The config that applies to the working directory picks the tool, and only
//! that tool's files count further down, because templates, fixtures and examples contain all sorts. If both an ESLint and an
//! oxlint config apply there, oxlint's wins: a project with both is moving to oxlint.
//!
//! Only a config file, a dependency in package.json, `--config` or `--flavor` pick the tool. Other flags never do, with one
//! exception: `--no-eslintrc`, `--env` and `--rulesdir` only exist in ESLint 8, so without a config file they mean an ESLint 8 run.

use crate::cli::{Options, Override, Tool, merge};
use crate::embedded::Framework;
use crate::gitignore::{self, Files, OfGit};
use crate::print_config::object;
use crate::run::{Environment, Fatal};
use crate::{Linter, eslintrc, evaluate, fs, native, paths, rulesdir};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{Configuration, Host, Route};
use bun_lint::language::InferGlobals;
use bun_lint::linter::config::json_for_oxlint;
use bun_lint::linter::{
    Config, FileConfig, InJavaScript, LegacyFile, LegacyOptions, NamedPlugin, Registry,
    ResolvedConfig, formatting_rules, is_plugin_of_oxlint, oxlint_category_of_key,
    oxlint_filter_keys, oxlint_rule_key, parse_rule_id, plugin_of_oxlint,
};
use bun_lint::options::Json;
use bun_lint::rule::{Plugin, minor_of};
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::{Arc, OnceLock};

/// The parsed `package.json` of the package that `specifier` names, found in `node_modules` from `directory` up. `None`
/// if `specifier` is a path.
pub(crate) fn installed_package(directory: &[u8], specifier: &[u8]) -> Option<Json> {
    if specifier.starts_with(b".") || paths::is_absolute(specifier) {
        return None;
    }
    let names = if specifier.starts_with(b"@") { 2 } else { 1 };
    let package: Vec<&[u8]> = strings::split(specifier, b"/").take(names).collect();
    let file = [
        b"node_modules/",
        &package.join(&b"/"[..])[..],
        b"/package.json",
    ]
    .concat();
    let json = paths::ancestors(directory).find_map(|it| fs::read(&paths::join(it, &file)).ok())?;
    bun_lint::json::parse(&json)
}

/// The installed version of that package.
fn installed_version(directory: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
    let package = installed_package(directory, specifier)?;
    Some(package.get(b"version")?.as_str()?.to_vec())
}

/// Whose rules of the game apply: what is ignored without being asked for, what a pattern means.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Flavor {
    /// `eslint.config.*`
    Eslint,
    /// `.oxlintrc.json`
    Oxlint,
    /// `.eslintrc.*`
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
const NAMES: [(&[u8], Flavor, Syntax); 10] = [
    (b"eslint.config.js", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cjs", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.ts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.mts", Flavor::Eslint, Syntax::Program),
    (b"eslint.config.cts", Flavor::Eslint, Syntax::Program),
    (b".oxlintrc.json", Flavor::Oxlint, Syntax::Json),
    (b".oxlintrc.jsonc", Flavor::Oxlint, Syntax::Json),
    (b"oxlint.config.ts", Flavor::Oxlint, Syntax::Program),
    (b"oxlint.config.mts", Flavor::Oxlint, Syntax::Program),
];

/// The config used when there's no config file: which files are linted, and with which rules. For `$severityByKind` see
/// `Reader::grade_by_kind`, for `$forReact` see `ResolvedConfig::outside_of_react`, for `$withoutWarnings` see
/// `Reader::without_warnings`. The words `UNUSED_ON_PURPOSE` and `TEST_GLOBALS` are replaced with the constants of that name,
/// and the `basePath` `"PROJECT"` with the project's directory, so that a project in `~/test/app` isn't all tests.
///
/// The first `rules` only sets options. With `$defaultOptions` they're the rules' default options in a project with no config file:
/// a later setting that's just a severity keeps them, and one with options is merged over them key by key, as ESLint does with a
/// rule's own `meta.defaultOptions`. That goes for the presets below, bunfig.toml, `--rule` and `/* eslint */` comments.
///
/// `react/jsx-uses-react` reports nothing. In a file with JSX it keeps `no-unused-vars` quiet about `React`, or about the `h` of
/// a `@jsx h` comment. It's an error so that `--quiet` doesn't skip it.
const BUILT_IN: &[u8] = br#"[
    { "ignores": ["**/.git/", "**/*.min.js"] },
    { "files": ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"] },
    {
        "$defaultOptions": true,
        "rules": {
            "no-constant-binary-expression": ["off", { "allowLiteralToggle": true }],
            "no-empty-pattern": ["off", { "allowObjectPatternsAsParameters": true }],
            "no-fallthrough": ["off", { "commentPattern": "(?i:falls?[\\s-]?through|no\\s?break)" }],
            "no-irregular-whitespace": ["off", {
                "skipComments": true, "skipTemplates": true, "skipJSXText": true, "skipRegExps": true
            }],
            "no-loss-of-precision": ["off", { "ignoreDecimals": true }],
            "no-unused-expressions": ["off", { "allowShortCircuit": true, "allowTernary": true }],
            "no-unused-vars": ["off", UNUSED_ON_PURPOSE],
            "react/jsx-key": ["off", { "checkArraysOutsideJSX": false }],
            "@typescript-eslint/no-loss-of-precision": ["off", { "ignoreDecimals": true }],
            "@typescript-eslint/no-unused-expressions": ["off", { "allowShortCircuit": true, "allowTernary": true }],
            "@typescript-eslint/no-misused-promises": ["off", { "checksVoidReturn": {
                "arguments": true, "attributes": false, "inheritedMethods": true,
                "properties": true, "returns": true, "variables": true
            } }],
            "@typescript-eslint/no-namespace": ["off", { "allowDeclarations": true }],
            "@typescript-eslint/no-unused-vars": ["off", UNUSED_ON_PURPOSE]
        }
    },
    {
        "extends": ["eslint:recommended"],
        "$severityByKind": true,
        "languageOptions": {
            "$env": { "browser": true, "node": true, "serviceworker": true },
            "globals": {
                "Bun": "readonly", "HTMLRewriter": "readonly", "ShadowRealm": "readonly",
                "BuildMessage": "readonly", "ResolveMessage": "readonly",
                "BuildError": "readonly", "ResolveError": "readonly"
            },
            "parserOptions": { "ecmaFeatures": { "jsx": true } }
        },
        "settings": {
            "import/core-modules": ["bun", "bun:ffi", "bun:jsc", "bun:sqlite", "bun:test"],
            "import/extensions": [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"],
            "import/external-module-folders": ["node_modules", "node_modules/@types"],
            "import/parsers": { "@typescript-eslint/parser": [".ts", ".mts", ".cts", ".tsx"] },
            "import/resolver": { "typescript": true }
        },
        "rules": { "no-unused-vars": "warn" }
    },
    {
        "files": [
            "**/*{.,_,-}{test,spec,e2e,cy}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
            "**/*[sS]etup*{[tT]est,[jJ]est,[vV]itest}*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
            "**/*{[tT]est,[jJ]est,[vV]itest}*[sS]etup*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"
        ],
        "languageOptions": TEST_GLOBALS
    },
    {
        "basePath": "PROJECT",
        "files": ["**/{__tests__,__mocks__,test,tests,spec,e2e,cypress}/**"],
        "languageOptions": TEST_GLOBALS
    },
    {
        "files": ["**/*.{ts,mts,cts,tsx}"],
        "extends": ["typescript-eslint/TYPESCRIPT"],
        "$severityByKind": true,
        "rules": {
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-vars": "warn"
        }
    },
    {
        "rules": {
            "bun:test/no-disabled-tests": "warn",
            "bun:test/no-export": "warn",
            "bun:test/no-focused-tests": "error",
            "bun:test/valid-describe-callback": "error",
            "bun:test/valid-expect": "error",
            "bun:test/valid-expect-in-promise": "error"
        }
    },
    { "rules": { "react/jsx-uses-react": "error" } },
    {
        "$forReact": true,
        "rules": {
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "react/jsx-key": "error"
        }
    },
    {
        "files": ["**/*.d.{ts,mts,cts}", "**/*.d.*.ts"],
        "$withoutWarnings": true,
        "linterOptions": { "reportUnusedDisableDirectives": "off" }
    }
]"#;

/// Options for both `no-unused-vars` rules in [`BUILT_IN`]. A name that starts with `_` is unused on purpose.
const UNUSED_ON_PURPOSE: &[u8] = br#"{
    "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_",
    "destructuredArrayIgnorePattern": "^_", "ignoreRestSiblings": true
}"#;

const TEST_GLOBALS: &[u8] = br#"{
    "$env": { "jest": true, "mocha": true },
    "globals": {
        "expectTypeOf": "readonly", "vi": "readonly", "fdescribe": "readonly",
        "cy": "readonly", "Cypress": "readonly", "assert": "readonly", "chai": "readonly"
    }
}"#;

/// Parses [`BUILT_IN`]. `with_types` also turns on the rules that need types.
fn built_in_json(with_types: bool, project: &[u8]) -> Json {
    let preset: &[u8] = match with_types {
        true => b"recommended-type-checked",
        false => b"recommended",
    };
    let text = strings::replace_owned(BUILT_IN, b"TYPESCRIPT", preset);
    let text = strings::replace_owned(&text, b"UNUSED_ON_PURPOSE", UNUSED_ON_PURPOSE);
    let text = strings::replace_owned(&text, b"TEST_GLOBALS", TEST_GLOBALS);
    let mut json = bun_lint::json::parse(&text).unwrap_or(Json::Null);
    // Set here and not in the text, because a path can hold anything.
    if let Json::Array(objects) = &mut json {
        for object in objects {
            if let Json::Object(entries) = object
                && let Some(base_path) = entries.iter_mut().find(|it| it.0 == b"basePath")
            {
                base_path.1 = Json::String(project.to_vec());
            }
        }
    }
    json
}

/// [`BUILT_IN`] on its own: the rules that are on when nothing is configured.
pub(crate) fn defaults(registry: &Registry) -> Option<Config> {
    Config::without_a_file(registry, b"/", &built_in_json(false, b"/"), Vec::new()).ok()
}

/// The files whose `lint` and `fmt` are the configurations of oxlint and oxfmt in a project of Vite+, by priority.
pub(crate) const NAMES_OF_VITE: [&[u8]; 6] = [
    b"vite.config.ts",
    b"vite.config.mts",
    b"vite.config.cts",
    b"vite.config.js",
    b"vite.config.mjs",
    b"vite.config.cjs",
];

/// What is wrong with one of [`NAMES_OF_VITE`] that `--config` names and that says nothing about linting. One that is found is
/// passed over.
const HAS_NO_LINT_FIELD: &[u8] = b"Expected a `lint` field in the default export of ";

fn has_no_lint_field(found: &Found) -> bool {
    matches!(found, Err(Fatal(why)) if why.starts_with(HAS_NO_LINT_FIELD))
}

/// Whether a run in `cwd` stands in for oxlint, as far as can be told without a configuration being read: by `--flavor`, or else by
/// whose file is the nearest.
pub(crate) fn is_for_oxlint(flavor: Option<Tool>, cwd: &[u8]) -> bool {
    let is_there = |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
    let mut directories = paths::ancestors(cwd);
    match flavor {
        Some(tool) => tool == Tool::Oxlint,
        // Of two side by side oxlint's.
        None => directories
            .find_map(|directory| {
                let mut there = NAMES
                    .iter()
                    .filter(|it| is_there(directory, it.0))
                    .peekable();
                there.peek()?;
                Some(there.any(|it| it.1 == Flavor::Oxlint))
            })
            .unwrap_or(false),
    }
}

/// The configuration file of ESLint that counts in `cwd`: the nearest, if there is none of oxlint beside it.
pub(crate) fn file_of_eslint(cwd: &[u8]) -> Option<Vec<u8>> {
    paths::ancestors(cwd).find_map(|directory| {
        let is_there = |name: &&[u8]| fs::is_file(&paths::join(directory, name));
        let of = |flavor: Flavor| NAMES.iter().filter(move |it| it.1 == flavor).map(|it| it.0);
        if of(Flavor::Oxlint).any(|it| is_there(&it)) {
            return Some(None);
        }
        let mut names = of(Flavor::Eslint).chain(eslintrc::NAMES.iter().copied());
        let found = names.find(is_there)?;
        let is_one = found != b"package.json" || eslintrc::has_one(directory);
        is_one.then(|| Some(paths::join(directory, found)))
    })?
}

/// Whether the file at `path`, which `--config` names, has what only a configuration file of oxlint has.
fn is_written_for_oxlint(path: &[u8]) -> bool {
    let Some(json) = fs::read(path)
        .ok()
        .and_then(|it| bun_lint::json::parse(&it))
    else {
        return false;
    };
    let only_there: [&[u8]; 3] = [b"categories", b"jsPlugins", b"options"];
    let schema = json.get(b"$schema").and_then(Json::as_str);
    only_there.iter().any(|it| json.get(it).is_some())
        || schema.is_some_and(|it| strings::contains(it, b"oxlint"))
}

/// Checks `directory/package.json` for React in `dependencies`, `devDependencies` or `peerDependencies`.
///
/// Returns `None` when this file can't decide and the caller should use the next one up: it doesn't exist, isn't a JSON
/// object, or has none of the three fields (a nested `{ "type": "module" }`, for example). An empty `"dependencies": {}`
/// still counts as a decision.
pub(crate) fn depends_on_react(directory: &[u8]) -> Option<bool> {
    let package = fs::read(&paths::join(directory, b"package.json")).ok()?;
    let package = bun_lint::json::parse(&package).filter(|it| it.as_object().is_some())?;
    let fields: [&[u8]; 3] = [b"dependencies", b"devDependencies", b"peerDependencies"];
    let mut declared = fields.iter().filter_map(|it| package.get(it)).peekable();
    declared.peek()?;
    Some(declared.any(|it| it.get(b"react").is_some()))
}

/// A configuration that has been read.
pub(crate) struct Loaded {
    pub(crate) config: Config,
    pub(crate) flavor: Flavor,
    /// The file it was loaded from. ESLint 8 merges several files, so there it's the closest one.
    pub(crate) file: Option<Vec<u8>>,
    /// Whether the rules that need types run, where that is the same for all files:
    /// `options.typeAware` of an `.oxlintrc.json`. `None`: the configuration of each file says.
    pub(crate) wants_types: Option<bool>,
    /// `options.denyWarnings`
    pub(crate) denies_warnings: bool,
    /// `options.maxWarnings`
    pub(crate) max_warnings: Option<i64>,
    /// Not `options.respectEslintDisableDirectives: false`
    pub(crate) respects_eslint_comments: bool,
    /// `options.typeCheck`
    pub(crate) checks_types: bool,
    /// With an `eslint.config.js`, if the package `eslint` is installed: what ESLint's own `Linter` is told.
    pub(crate) for_eslint: Option<ForEslint>,
}

/// What ESLint's own `Linter` is told that is the same for all files of a configuration file.
pub(crate) struct ForEslint {
    /// JSON: see `Host::lint_with_eslint`.
    pub(crate) run: Vec<u8>,
    /// For a file whose configuration has what JSON cannot say.
    pub(crate) whole: Configuration,
}

impl Loaded {
    /// What kind of file with scripts in it the file at `path` is, if these are what is linted: oxlint does that.
    pub(crate) fn framework(&self, path: &[u8]) -> Option<Framework> {
        Framework::of(path).filter(|_| self.flavor == Flavor::Oxlint)
    }

    /// How the file at `path`, which has `config`, is linted. oxlint has no processors.
    pub(crate) fn routes(&self, config: &ResolvedConfig, path: &[u8]) -> Route {
        match config.route(path) {
            Route::Processor if !matches!(self.flavor, Flavor::Eslint | Flavor::EslintRc) => {
                Route::Unsupported
            }
            Route::Eslint if self.for_eslint.is_none() => Route::Unsupported,
            route => route,
        }
    }
}

pub(crate) type Found = Result<Arc<Loaded>, Fatal>;

pub(crate) struct Loader<'l> {
    pub(crate) linter: &'l Linter,
    options: &'l Options,
    environment: &'l Environment<'l>,
    /// Loads the plugins that are written in JavaScript.
    js_plugins: &'l Host<'l>,
    /// By directory: the configuration of the files in it.
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// By the path of the file, which is empty for none. Each is read once, by the first to ask.
    by_file: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Found>>>>,
    /// For the user, in the order in which they came up.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
    /// What a configuration asks for and cannot be done, a line for each: rules that do not exist here, files in a language that
    /// is not read here. To do less than the tool that is replaced, and find no problems, is worse than to fail.
    pub(crate) unsupported: Guarded<Vec<Vec<u8>>>,
    /// What the user could change to his advantage, a line for each. Nothing is wrong.
    pub(crate) advice: Guarded<Vec<Vec<u8>>>,
    /// [`eslintrc::uses_flat_config`]
    flat_config: Option<bool>,
    /// [`Loader::is_command_line_of_eslint_8`]
    is_legacy: OnceLock<bool>,
    /// [`rulesdir::load`]: once, for the files of all directories.
    rulesdir: OnceLock<Result<Json, Fatal>>,
    /// [`Loader::tool`]
    tool: OnceLock<Option<Flavor>>,
    /// [`Loader::passed_over`]
    passed_over: OnceLock<(Vec<u8>, Vec<u8>)>,
    /// The working directory has an `eslint.config.*`, in it or above it, and that is what the run is for.
    has_file_of_eslint: OnceLock<bool>,
    /// [`Loader::lacks_file`]
    lacks_file: OnceLock<bool>,
    /// [`Loader::name`]
    named: Guarded<Vec<Vec<u8>>>,
    /// [`Loader::refused`]
    refused: OnceLock<Vec<u8>>,
    /// [`Loader::mistake`]
    mistake: OnceLock<Vec<u8>>,
    /// The [built-in plugins](Loader::built_in_plugins) whose package is installed too, and what `$jsPlugins` has for that: it
    /// has the rules that are not here, and those that leave a file to it.
    packages_of_built_in: Guarded<Vec<(Vec<u8>, Json)>>,
    /// `options.typeAware` of the configuration of the working directory, if that is one of oxlint.
    wants_types: OnceLock<Option<bool>>,
    /// The project is one of Vite+ without a configuration file of a linter: [`NAMES_OF_VITE`] are the files that count.
    is_of_vite: OnceLock<bool>,
    /// Where the search for files began, and the `tsconfig.json` and `jsconfig.json` in the directories that it listed:
    /// `Inferred` need not ask the system for them.
    pub(crate) searched_from: Guarded<Vec<Vec<u8>>>,
    pub(crate) tsconfigs: Guarded<Vec<Vec<u8>>>,
    /// Cache for [`Loader::is_of_react`], keyed by directory.
    of_react: Guarded<FxHashMap<Vec<u8>, bool>>,
}

fn strings_of(items: &[Vec<u8>]) -> Json {
    Json::Array(items.iter().cloned().map(Json::String).collect())
}

pub(crate) fn severity_name(severity: Severity) -> Json {
    Json::String(match severity {
        Severity::Off => b"off".to_vec(),
        Severity::Warn => b"warn".to_vec(),
        Severity::Error => b"error".to_vec(),
    })
}

/// `normalizePackageName(name, "eslint-plugin")`, if that is another name.
pub(crate) fn plugin_longhand(name: &[u8]) -> Option<Vec<u8>> {
    let long = match name {
        [b'@', scoped @ ..] => match strings::index_of_char_usize(scoped, b'/') {
            None => [name, b"/eslint-plugin"].concat(),
            Some(slash) if scoped[slash + 1..].starts_with(b"eslint-plugin") => return None,
            Some(slash) => [&name[..=slash + 1], b"eslint-plugin-", &scoped[slash + 1..]].concat(),
        },
        _ if name.starts_with(b"eslint-plugin-") => return None,
        _ => [b"eslint-plugin-", name].concat(),
    };
    Some(long)
}

/// Whether an entry of `plugins` in bunfig.toml, or `--plugin`, is a path and not the name of a package.
fn is_path_of_plugin(specifier: &[u8]) -> bool {
    specifier.starts_with(b".") || paths::is_absolute(specifier)
}

/// `getShorthandName(name, "eslint-plugin")`
pub(crate) fn plugin_shorthand(name: &[u8]) -> Vec<u8> {
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
    name.strip_prefix(b"eslint-plugin-")
        .unwrap_or(name)
        .to_vec()
}

/// Globals from `[lint.globals]` and `--global a,b:true`. The flag wins.
fn globals_of(options: &Options) -> Option<Json> {
    let mut globals = options.globals.clone();
    for name in &options.global {
        let (name, value): (&[u8], &[u8]) = match name.strip_suffix(b":true") {
            Some(name) => (name, b"writable"),
            None => (name, b"readonly"),
        };
        globals.retain(|it| it.0 != name);
        globals.push((name.to_vec(), Json::String(value.to_vec())));
    }
    (!globals.is_empty()).then_some(Json::Object(globals))
}

/// Rule settings from oxlint's `-A`, `-W` and `-D` (when they name a rule), then from ESLint's `--rule`. The oxlint flags
/// only set a severity, so the rule keeps whatever options it has.
fn rules_of(options: &Options, cwd: &[u8]) -> Vec<(Vec<u8>, Json)> {
    let filters = options.filters.iter();
    let filters = filters.filter(|it| !is_category(&it.1));
    let mut rules = Vec::new();
    for (severity, rule) in filters {
        merge(&mut rules, vec![(rule.clone(), severity_name(*severity))]);
    }
    merge(
        &mut rules,
        options.from_the_working_directory(&options.rule, &options.rules_of_bunfig, false, cwd),
    );
    rules
}

/// The config format to write an override in.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Shape {
    /// An object in an `eslint.config.js`.
    Flat,
    /// An entry of `overrides` in an `.oxlintrc.json`.
    Oxlint,
    /// The same in an `.eslintrc.json`.
    Legacy,
}

/// oxlint's `validateConfigExtends`: what a program exports extends objects that it has imported, no files.
fn check_extends_of_program(config: &Json) -> Result<(), Vec<u8>> {
    const NO_PATHS: &[u8] = b" (strings/paths are not supported).";
    let Some(extends) = config.get(b"extends") else {
        return Ok(());
    };
    let Some(items) = extends.as_array() else {
        return Err([b"`extends` must be an array of config objects", NO_PATHS].concat());
    };
    for (index, item) in items.iter().enumerate() {
        if item.as_object().is_none() {
            let index = index.to_string();
            let must_be: &[u8] = b"]` must be a config object";
            return Err([b"`extends[", index.as_bytes(), must_be, NO_PATHS].concat());
        }
        if bun_core::StackCheck::init().is_safe_to_recurse() {
            check_extends_of_program(item)?;
        }
    }
    Ok(())
}

/// `preprocessConfig` under `--no-ignore`: an object that only has `ignores` loses them.
fn without_global_ignores(mut json: Json) -> Json {
    match &mut json {
        Json::Array(items) if bun_core::StackCheck::init().is_safe_to_recurse() => {
            Json::Array(items.drain(..).map(without_global_ignores).collect())
        }
        Json::Object(entries) => {
            let is_meta = |key: &[u8]| matches!(key, b"name" | b"basePath");
            let is_ignores = |key: &[u8]| matches!(key, b"ignores" | b"$ignorePatterns");
            if entries.iter().any(|it| is_ignores(&it.0))
                && entries.iter().filter(|it| !is_meta(&it.0)).count() == 1
            {
                entries.retain(|it| !is_ignores(&it.0));
            }
            json
        }
        _ => json,
    }
}

/// The categories of oxlint's rules, but `nursery`.
pub(crate) const CATEGORIES: [&[u8]; 6] = [
    b"correctness",
    b"suspicious",
    b"pedantic",
    b"perf",
    b"style",
    b"restriction",
];

/// Whether `-A`, `-W` and `-D` of oxlint take `name` for something else than a rule.
pub(crate) fn is_category(name: &[u8]) -> bool {
    CATEGORIES.contains(&name) || matches!(name, b"all" | b"nursery")
}

/// Collects the `rules` of every file that `json` extends. oxlint keeps the first setting it finds for a rule, and it looks
/// at the last entry of `extends` first, so that's the order here.
fn rules_of_extended(
    json: &Json,
    directory: &[u8],
    load: &mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
    into: &mut Vec<(Vec<u8>, Json)>,
) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return;
    }
    let extends = match json.get(b"extends") {
        Some(Json::Array(items)) => &items[..],
        Some(one) => std::slice::from_ref(one),
        None => &[],
    };
    for extended in extends.iter().rev() {
        let (file, directory) = match extended.as_str() {
            // An `oxlint.config.ts` extends objects it has imported.
            None => (Cow::Borrowed(extended), directory.to_vec()),
            Some(name) => {
                let name = paths::portable(directory, name);
                let Some(file) = load(directory, &name) else {
                    continue;
                };
                let path = paths::resolve(directory, &name);
                (Cow::Owned(file), paths::dirname(&path).to_vec())
            }
        };
        let rules = file.get(b"rules").and_then(Json::as_object);
        into.extend(rules.unwrap_or_default().iter().cloned());
        rules_of_extended(&file, &directory, load, into);
    }
}

/// Whether an `.oxlintrc.json` means a rule of a JavaScript plugin by `id`. `-A`, `-W` and `-D` never change those.
fn is_of_js_plugin(id: &[u8]) -> bool {
    let prefix = parse_rule_id(id).0;
    !prefix.is_empty() && Plugin::of_oxlint_prefix(&plugin_of_oxlint(prefix)).is_none()
}

/// oxlint's `-A`, `-W` and `-D`, one after the other. They come after the `rules` of the file and of what it extends
/// (`inherited`, from [`rules_of_extended`]), and before its `overrides`. A category is about all of its rules, also those
/// that `rules` names.
fn apply_filters(
    entries: &mut Vec<(Vec<u8>, Json)>,
    filters: &[(Severity, Vec<u8>)],
    inherited: &[(Vec<u8>, Json)],
) {
    type Entries = Vec<(Vec<u8>, Json)>;
    /// The object `name` of the file, which is made if it is not there.
    fn section<'e>(entries: &'e mut Entries, name: &[u8]) -> Option<&'e mut Entries> {
        if !entries
            .iter()
            .any(|it| it.0 == name && matches!(it.1, Json::Object(_)))
        {
            entries.retain(|it| it.0 != name);
            entries.push((name.to_vec(), Json::Object(Vec::new())));
        }
        match entries.iter_mut().find(|it| it.0 == name) {
            Some((_, Json::Object(section))) => Some(section),
            _ => None,
        }
    }
    /// Gives the entries that `is_meant` holds for the severity, and adds one for `key` if there is none. The options stay,
    /// unless the rule is turned off: oxlint forgets the rule then, so `-A eqeqeq -D eqeqeq` ends up with the default options.
    fn put(
        section: Option<&mut Entries>,
        key: &[u8],
        severity: Severity,
        is_meant: impl Fn(&[u8]) -> bool,
    ) {
        let Some(section) = section else {
            return;
        };
        let mut is_there = false;
        for (_, value) in section.iter_mut().filter(|it| is_meant(&it.0)) {
            is_there = true;
            match value {
                Json::Array(items) if !items.is_empty() && severity != Severity::Off => {
                    items[0] = severity_name(severity);
                }
                value => *value = severity_name(severity),
            }
        }
        if !is_there && !key.is_empty() {
            section.push((key.to_vec(), severity_name(severity)));
        }
    }
    fn put_category(entries: &mut Entries, category: &[u8], severity: Severity) {
        put(section(entries, b"categories"), category, severity, |it| {
            it == category
        });
        put(section(entries, b"rules"), b"", severity, |it| {
            oxlint_category_of_key(&oxlint_rule_key(it)).map(str::as_bytes) == Some(category)
        });
    }
    let of_the_file = entries.iter().find(|it| it.0 == b"categories");
    let of_the_file = of_the_file.map_or_else(|| Json::Object(Vec::new()), |it| it.1.clone());
    if !filters.is_empty() {
        entries.push((b"$categoriesOfTheFile".to_vec(), of_the_file));
    }
    // oxlint merges the files first, so a flag changes an inherited rule like one of the file's own, and the options stay.
    let has_key = |rules: &[(Vec<u8>, Json)], key: &[u8]| {
        rules.iter().any(|it| oxlint_rule_key(&it.0) == key)
    };
    if let Some(own) = section(entries, b"rules").filter(|_| !inherited.is_empty()) {
        for (id, setting) in inherited {
            if !has_key(own, &oxlint_rule_key(id)) {
                own.push((id.clone(), setting.clone()));
            }
        }
    }
    for (severity, name) in filters {
        if name == b"all" {
            if *severity == Severity::Off
                && let Some(own) = section(entries, b"rules")
            {
                // Dropping an inherited rule here would bring back what the extended file says about it.
                own.retain(|it| {
                    is_of_js_plugin(&it.0) || has_key(inherited, &oxlint_rule_key(&it.0))
                });
                put(Some(own), b"", Severity::Off, |it| !is_of_js_plugin(it));
            }
            CATEGORIES
                .iter()
                .for_each(|category| put_category(entries, category, *severity));
        } else if CATEGORIES.contains(&&name[..]) || name == b"nursery" {
            put_category(entries, name, *severity);
        } else if !is_of_js_plugin(name) {
            for key in oxlint_filter_keys(name) {
                put(section(entries, b"rules"), &key, *severity, |it| {
                    oxlint_rule_key(it) == key
                });
            }
        }
    }
}

impl<'l> Loader<'l> {
    pub(crate) fn new(
        linter: &'l Linter,
        options: &'l Options,
        environment: &'l Environment<'l>,
        js_plugins: &'l Host<'l>,
    ) -> Loader<'l> {
        Loader {
            linter,
            options,
            environment,
            js_plugins,
            by_directory: Guarded::new(FxHashMap::default()),
            by_file: Guarded::new(FxHashMap::default()),
            warnings: Guarded::new(Vec::new()),
            unsupported: Guarded::new(Vec::new()),
            advice: Guarded::new(Vec::new()),
            flat_config: eslintrc::uses_flat_config(),
            is_legacy: OnceLock::new(),
            rulesdir: OnceLock::new(),
            tool: OnceLock::new(),
            passed_over: OnceLock::new(),
            has_file_of_eslint: OnceLock::new(),
            lacks_file: OnceLock::new(),
            named: Default::default(),
            refused: OnceLock::new(),
            mistake: OnceLock::new(),
            packages_of_built_in: Guarded::new(Vec::new()),
            wants_types: OnceLock::new(),
            is_of_vite: OnceLock::new(),
            searched_from: Default::default(),
            tsconfigs: Default::default(),
            of_react: Default::default(),
        }
    }

    /// Whether somebody takes `searched_from` and `tsconfigs`: `InferGlobals::ByOptions`.
    pub(crate) fn notes_tsconfigs(&self) -> bool {
        self.options.infer_globals.is_none() && self.options.infers_globals_by_options
    }

    /// One that reads the configuration files of ESLint 8, whatever else there is.
    pub(crate) fn of_eslint_8(
        linter: &'l Linter,
        options: &'l Options,
        environment: &'l Environment<'l>,
        js_plugins: &'l Host<'l>,
    ) -> Loader<'l> {
        let loader = Loader::new(linter, options, environment, js_plugins);
        let _ = loader.is_legacy.set(true);
        loader
    }

    pub(crate) fn warn(&self, parts: &[&[u8]]) {
        let warning = parts.concat();
        let mut warnings = self.warnings.lock();
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }

    /// Adds to [`Loader::advice`].
    pub(crate) fn advise(&self, line: Vec<u8>) {
        let mut advice = self.advice.lock();
        if !advice.contains(&line) {
            advice.push(line);
        }
    }

    /// Adds a line of [`Config::advice`]. "<package> <version> is installed, but .. match <ours>" has the version from the
    /// plugin's `meta.version`, which can be stale: eslint-plugin-react-hooks 7.1.1 says 7.0.0. Its package.json decides.
    fn advise_if_true(&self, line: &[u8], directory: &[u8]) {
        let words: Vec<&[u8]> = strings::split(line, b" ").collect();
        if let [package, said, .., b"match", ours] = words[..]
            && let Some(installed) = installed_version(directory, package)
            && installed != said
        {
            if minor_of(&installed) < minor_of(ours) {
                self.advise(
                    [
                        package,
                        b" ",
                        &installed,
                        &line[package.len() + 1 + said.len()..],
                    ]
                    .concat(),
                );
            }
            return;
        }
        self.advise(line.to_vec());
    }

    /// Says so if the `typescript` of the project is older than the one as which types are checked. It reads one file.
    pub(crate) fn advise_about_typescript(&self) {
        let installed = installed_version(self.cwd(), b"typescript");
        if let Some(installed) = installed.filter(|it| minor_of(it).is_some_and(|it| it < (7, 0))) {
            let line = [
                b"typescript ",
                &installed[..],
                b" is installed, but bun lint checks types like TypeScript 7",
            ];
            self.advise(line.concat());
        }
    }

    /// Says which rules ran in JavaScript that are built in. `sources`: the prefix of each plugin in `jsPlugins`, the directory of
    /// the file that names it, and how.
    fn advise_about_js_plugins(&self, config: &Config, sources: &[(Box<[u8]>, Vec<u8>, Vec<u8>)]) {
        for InJavaScript {
            prefix,
            plugin,
            built_in,
            others,
        } in config.in_javascript(self.linter.registry())
        {
            let Some((_, directory, specifier)) = sources.iter().find(|it| *it.0 == *prefix) else {
                continue;
            };
            let installed = installed_version(directory, specifier);
            let ours = plugin.follows();
            let (rules, them): (&[u8], &[u8]) = match built_in {
                1 => (b" rule", b"it"),
                _ => (b" rules", b"them"),
            };
            let native = crate::format::oxlint::plugin(prefix);
            let mut line = [
                built_in.to_string().as_bytes(),
                b" \"",
                prefix,
                b"\"",
                rules,
                b" ran in JavaScript from ",
                &specifier[..],
            ]
            .concat();
            if let Some(installed) = &installed {
                line.extend_from_slice(&[b" ", &installed[..]].concat());
            }
            line.extend_from_slice(&[b", but bun lint has ", them, b" built in"].concat());
            if let Some(ours) = ours {
                line.extend_from_slice(&[b" (version ", ours.as_bytes(), b")"].concat());
            }
            line.extend_from_slice(&[b"\n  To use the built-in", rules, b", "].concat());
            let for_the_others = match others {
                1 => " for the other rule.".to_owned(),
                _ => format!(" for the other {others} rules."),
            };
            let the_others: &[u8] = match others {
                1 => b"the other rule",
                _ => b"the other rules",
            };
            // `plugins` takes no name of a plugin that is always there.
            line.extend_from_slice(&match (others, plugin.is_always_there()) {
                (0, true) => [b"remove ", &specifier[..], b" from \"jsPlugins\"."].concat(),
                (0, false) => [
                    b"remove ",
                    &specifier[..],
                    b" from \"jsPlugins\" and add \"",
                    native,
                    b"\" to \"plugins\".",
                ]
                .concat(),
                (_, true) => [
                    b"give the plugin another name: \"jsPlugins\": [{ \"name\": \"",
                    prefix,
                    b"-js\", \"specifier\": \"",
                    &specifier[..],
                    b"\" }]. Then rename ",
                    the_others,
                    b" to \"",
                    prefix,
                    b"-js/..\".",
                ]
                .concat(),
                (_, false) => [
                    b"rename ",
                    them,
                    b" to \"",
                    native,
                    b"/..\" and add \"",
                    native,
                    b"\" to \"plugins\". Keep ",
                    &specifier[..],
                    for_the_others.as_bytes(),
                ]
                .concat(),
            });
            if installed.as_deref().and_then(minor_of) != ours.map(str::as_bytes).and_then(minor_of)
            {
                line.extend_from_slice(b" Reports may differ.");
            }
            self.advise(line);
        }
    }

    /// Adds to [`Loader::unsupported`].
    pub(crate) fn cannot_do(&self, parts: &[&[u8]]) {
        let line = parts.concat();
        let mut unsupported = self.unsupported.lock();
        if !unsupported.contains(&line) {
            unsupported.push(line);
        }
    }

    fn cwd(&self) -> &[u8] {
        &self.environment.cwd
    }

    /// Whether every file has the same configuration, wherever it is.
    fn has_one_configuration(&self) -> bool {
        self.options.config.is_some() || !self.options.config_lookup
    }

    /// Whether a configuration file has been read besides that of the working directory. oxlint then does not say how many rules
    /// there are.
    pub(crate) fn has_nested_configurations(&self) -> bool {
        // The empty key is the built-in configuration, which `lacks_file` loads only to compare with.
        let by_file = self.by_file.lock();
        by_file.keys().filter(|it| !it.is_empty()).count() > 1
    }

    /// [`Options::start_of_bunfig`]
    fn start_of_bunfig(&self) -> Vec<u8> {
        self.options.start_of_bunfig(self.cwd())
    }

    /// Where the patterns start in the file that `--config` names, or `config` in bunfig.toml.
    fn start_of_named_config(&self) -> Vec<u8> {
        match self.options.is_config_of_bunfig {
            true => self.start_of_bunfig(),
            false => self.cwd().to_vec(),
        }
    }

    /// `ignorePatterns` of bunfig.toml and `--ignore-pattern`, each with where they start.
    fn ignore_patterns(&self) -> [(Vec<u8>, &[Vec<u8>]); 2] {
        let all = &self.options.ignore_pattern;
        let (of_bunfig, of_flags) =
            all.split_at(self.options.ignore_patterns_of_bunfig.min(all.len()));
        [
            (self.start_of_bunfig(), of_bunfig),
            (self.cwd().to_vec(), of_flags),
        ]
    }

    /// Writes `[[lint.overrides]]` as config objects in the given `shape`. The command line's rules and globals go last, as
    /// one more override that matches every file. `base_path` is what the config resolves patterns against, unless an
    /// override says otherwise.
    fn overrides(&self, shape: Shape, base_path: &[u8]) -> Vec<Json> {
        let text = |it: &[u8]| Json::String(it.to_vec());
        let start = self.start_of_bunfig();
        let write = |it: &Override| {
            let mut entries = vec![(&b"files"[..], strings_of(&it.files))];
            if !it.excluded.is_empty() {
                let key: &[u8] = match shape {
                    Shape::Flat => b"ignores",
                    Shape::Oxlint => b"excludeFiles",
                    Shape::Legacy => b"excludedFiles",
                };
                entries.push((key, strings_of(&it.excluded)));
            }
            // Tells each config reader to parse the patterns as Bun's globs instead of its own tool's.
            entries.push((b"$globsOfBun", Json::Bool(true)));
            match shape {
                _ if base_path == start => {}
                Shape::Flat => entries.push((b"basePath", text(&start))),
                Shape::Oxlint => entries.push((b"$basePath", text(&start))),
                // See `legacy_config`.
                Shape::Legacy => {}
            }
            if !it.rules.is_empty() {
                let is_oxlint = shape == Shape::Oxlint;
                let rules = (self.options).from_the_working_directory(
                    &it.rules,
                    &it.places,
                    is_oxlint,
                    self.cwd(),
                );
                entries.push((b"rules", Json::Object(rules)));
            }
            match (it.globals.is_empty(), Json::Object(it.globals.clone())) {
                (true, _) => {}
                (false, globals) if shape == Shape::Flat => {
                    entries.push((b"languageOptions", object(vec![(b"globals", globals)])));
                }
                (false, globals) => entries.push((b"globals", globals)),
            }
            if !it.settings.is_empty() {
                entries.push((b"settings", Json::Object(it.settings.clone())));
            }
            object(entries)
        };
        let alone = self.options.of_command_line.as_deref();
        let last = alone.map(|alone| Override {
            files: vec![b"**/*".to_vec()],
            rules: rules_of(alone, self.cwd()),
            globals: (globals_of(alone).and_then(Json::into_object)).unwrap_or_default(),
            ..Override::default()
        });
        let last = last.filter(|it| !it.rules.is_empty() || !it.globals.is_empty());
        (self.options.overrides.iter().chain(&last))
            .map(write)
            .collect()
    }

    /// ESLint's `overrideConfig`, as `translateOptions` makes it from the command line.
    fn override_config(&self, base_path: &[u8]) -> Vec<Json> {
        let options = self.options;
        let mut language_options = Vec::new();
        if let Some(globals) = globals_of(options) {
            language_options.push((&b"globals"[..], globals));
        }
        if !options.parser_options.is_empty() {
            language_options.push((
                b"parserOptions",
                Json::Object(options.parser_options.clone()),
            ));
        }
        if let Some(parser) = &options.parser {
            language_options.push((b"parser", Json::String(parser.clone())));
        }
        let mut first = Vec::new();
        if !language_options.is_empty() {
            first.push((&b"languageOptions"[..], object(language_options)));
        }
        first.push((b"rules", Json::Object(rules_of(options, self.cwd()))));
        if !options.settings.is_empty() {
            first.push((b"settings", Json::Object(options.settings.clone())));
        }
        let mut linter_options = Vec::new();
        if options.report_unused_disable_directives {
            linter_options.push((
                &b"reportUnusedDisableDirectives"[..],
                severity_name(Severity::Error),
            ));
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
            // The others are `named_plugins`. By the name of the package, which is how the rules here know that it is theirs.
            let plugins = self.built_in_plugins(Flavor::Eslint).map(|name| {
                let long = plugin_longhand(name).unwrap_or_else(|| name.clone());
                (plugin_shorthand(name), Json::String(long))
            });
            first.push((b"plugins", Json::Object(plugins.collect())));
            let packages = self.packages_of_built_in.lock().clone();
            if !packages.is_empty() {
                first.push((b"$jsPlugins", Json::Object(packages)));
            }
        }
        let mut all = vec![object(first)];
        all.extend(self.overrides(Shape::Flat, base_path));
        if let Some(extensions) = &options.ext {
            let patterns = extensions.iter().map(|extension| {
                let dot: &[u8] = if extension.starts_with(b".") {
                    b""
                } else {
                    b"."
                };
                Json::String([b"**/*", dot, extension].concat())
            });
            all.push(object(vec![(b"files", Json::Array(patterns.collect()))]));
        }
        all
    }

    /// What ESLint's `calculateConfigArray` adds to what a configuration file exports.
    fn added(&self, base_path: &[u8]) -> Vec<Json> {
        let mut added = Vec::new();
        for (start, patterns) in self.ignore_patterns() {
            if !patterns.is_empty() {
                added.push(object(vec![
                    (b"basePath", Json::String(start)),
                    (b"ignores", strings_of(patterns)),
                ]));
            }
        }
        added.extend(self.override_config(base_path));
        added
    }

    /// `file`: the configuration file, if there is one, and what it says. `None`: the package `eslint` is not installed.
    fn for_eslint(
        &self,
        file: Option<(&[u8], &Config)>,
        base_path: &[u8],
        named: &[NamedPlugin],
    ) -> Option<ForEslint> {
        let has_eslint =
            |it: &[u8]| fs::is_file(&paths::join(it, b"node_modules/eslint/package.json"));
        let is_found_from = |from: &&[u8]| {
            std::iter::successors(Some(*from), |it| {
                Some(paths::dirname(it)).filter(|up| up.len() < it.len())
            })
            .any(has_eslint)
        };
        // Not every project has it above the configuration file: it is where the parser and the plugins are, whose peer it is.
        let modules = file.into_iter().flat_map(|it| it.1.modules());
        let file = file.map(|it| it.0);
        let from = std::iter::once(file.map_or_else(|| self.cwd(), paths::dirname))
            .chain(modules.map(paths::dirname))
            .find(is_found_from)?;
        let options = self.options;
        let native = |path: &[u8]| Json::String(paths::to_native(path.to_vec()));
        let only_errors = options.quiet && options.max_warnings == -1;
        let about_layout = formatting_rules().map(|it| Json::String(it.into()));
        let mut added: Vec<Json> = Self::object_of_named(named).into_iter().collect();
        added.extend(self.added(base_path));
        let mut run = Vec::new();
        bun_lint::linter::write_json(
            &mut run,
            &object(vec![
                (b"from", native(from)),
                (b"basePath", native(base_path)),
                (b"allowInlineConfig", Json::Bool(options.inline_config)),
                (b"onlyErrors", Json::Bool(only_errors)),
                (b"aboutLayout", Json::Array(about_layout.collect())),
                (b"file", file.map_or(Json::Null, native)),
                (b"ignores", Json::Bool(options.ignore)),
                (b"added", Json::Array(added)),
            ]),
        );
        Some(ForEslint {
            run,
            whole: Configuration::whole(),
        })
    }

    /// Calls [`native::split_pairs`] with this run's settings.
    fn split_pairs(&self, objects: Vec<Json>) -> Vec<Json> {
        let types = match self.options.type_aware {
            Some(true) => native::Types::On,
            Some(false) => native::Types::Off,
            None if self.options.type_check => native::Types::On,
            None => native::Types::WhenNeeded,
        };
        native::split_pairs(self.linter.registry(), objects, types)
    }

    /// ESLint's `calculateConfigArray`. `file_config` is what the config file exports. `is_of_eslint` is false if that's
    /// Bun's built-in config instead. `named`: [`Loader::named_plugins`].
    fn flat(
        &self,
        base_path: &[u8],
        file_config: Json,
        is_of_eslint: bool,
        named: Vec<NamedPlugin>,
    ) -> Result<Config, Fatal> {
        let mut all = vec![file_config];
        // `built_in` has already added these.
        if is_of_eslint {
            all.extend(Self::object_of_named(&named));
            all.extend(self.added(base_path));
        }
        let mut all = Json::Array(all);
        if !self.options.ignore {
            all = without_global_ignores(all);
        }
        let mut load_plugin =
            |location: &Json, prefix: &[u8]| self.js_plugins.load_located(location, prefix);
        let registry = self.linter.registry();
        let mut config = match is_of_eslint {
            true => Config::from_flat_json_with_plugins(
                registry,
                base_path,
                &all,
                &mut load_plugin,
                named,
            ),
            false => Config::without_a_file(registry, base_path, &all, named),
        }
        .map_err(|error| Fatal(error.message))?;
        let installed = installed_version(base_path, b"eslint");
        if installed.is_some_and(|it| minor_of(&it).is_some_and(|it| it.0 < 10)) {
            config.follow_eslint(9);
        }
        config.infer_globals(self.infers_globals_besides());
        Ok(config)
    }

    /// [`LanguageOptions::infers_globals`](bun_lint::language::LanguageOptions) beside a configuration file.
    fn infers_globals_besides(&self) -> InferGlobals {
        match self.options.infer_globals {
            Some(true) => InferGlobals::Besides,
            _ => InferGlobals::No,
        }
    }

    /// An `.oxlintrc.json`, with what the command line adds.
    fn rc(&self, path: &[u8], mut json: Json) -> Result<Config, Fatal> {
        let options = self.options;
        let mut load = |directory: &[u8], name: &[u8]| {
            // It is a path if it looks like one: it has an extension. oxlint does not know the names of packages.
            let has_extension = strings::last_index_of_char(paths::basename(name), b'.') > Some(0);
            if !name.starts_with(b".") && !paths::is_absolute(name) && !has_extension {
                return None;
            }
            bun_lint::json::parse_like_oxlint(&fs::read(&paths::resolve(directory, name)).ok()?)
        };
        let mut inherited = Vec::new();
        if !options.filters.is_empty() {
            rules_of_extended(&json, paths::dirname(path), &mut load, &mut inherited);
        }
        if let Json::Object(entries) = &mut json {
            let mut put =
                |key: &[u8], add: Vec<Json>| match entries.iter_mut().find(|it| it.0 == key) {
                    Some((_, Json::Array(items))) => items.extend(add),
                    Some((_, other)) => {
                        let first = std::mem::replace(other, Json::Null);
                        *other = Json::Array(std::iter::once(first).chain(add).collect());
                    }
                    None => entries.push((key.to_vec(), Json::Array(add))),
                };
            let mut last = vec![(
                &b"files"[..],
                Json::Array(vec![Json::String(b"**/*".to_vec())]),
            )];
            if !options.rule.is_empty() {
                let places = &options.rules_of_bunfig;
                let rules =
                    options.from_the_working_directory(&options.rule, places, true, self.cwd());
                last.push((b"rules", Json::Object(rules)));
            }
            if let Some(globals) = globals_of(options) {
                last.push((b"globals", globals));
            }
            if !options.parser_options.is_empty() {
                last.push((
                    b"parserOptions",
                    Json::Object(options.parser_options.clone()),
                ));
            }
            if !options.settings.is_empty() {
                last.push((b"settings", Json::Object(options.settings.clone())));
            }
            if last.len() > 1 {
                put(b"overrides", vec![object(last)]);
            }
            if !options.overrides.is_empty() {
                put(
                    b"overrides",
                    self.overrides(Shape::Oxlint, paths::dirname(path)),
                );
            }
            apply_filters(entries, &options.filters, &inherited);
            let turned_on = self
                .built_in_plugins(Flavor::Oxlint)
                .map(|it| (plugin_shorthand(it), true));
            // A flag counts for more.
            let of_flags = options.plugins.iter().map(|it| (it.0.to_vec(), it.1));
            let switches: Vec<(Vec<u8>, bool)> = turned_on.chain(of_flags).collect();
            if !switches.is_empty() {
                let mut plugins: Vec<Json> = match entries.iter().find(|it| it.0 == b"plugins") {
                    Some((_, Json::Array(plugins))) => plugins.clone(),
                    _ => [&b"unicorn"[..], b"typescript", b"oxc"]
                        .iter()
                        .map(|it| Json::String(it.to_vec()))
                        .collect(),
                };
                for (name, is_on) in &switches {
                    plugins.retain(|it| {
                        it.as_str().map(plugin_of_oxlint) != Some(plugin_of_oxlint(name))
                    });
                    if *is_on {
                        plugins.push(Json::String(name.clone()));
                    }
                }
                entries.retain(|it| it.0 != b"plugins");
                entries.push((b"plugins".to_vec(), Json::Array(plugins)));
            }
            let of_file = (entries.iter().find(|it| it.0 == b"options"))
                .and_then(|it| it.1.get(b"reportUnusedDisableDirectives"))
                .and_then(|it| match it.as_str()? {
                    b"allow" | b"off" => Some(Severity::Off),
                    b"warn" => Some(Severity::Warn),
                    b"deny" | b"error" => Some(Severity::Error),
                    _ => None,
                });
            let unused = match options.report_unused_disable_directives {
                // oxlint warns.
                true => Some(Severity::Warn),
                false => options
                    .report_unused_disable_directives_severity
                    .or(of_file),
            };
            if let Some(severity) = unused {
                entries.retain(|it| it.0 != b"reportUnusedDisableDirectives");
                entries.push((
                    b"reportUnusedDisableDirectives".to_vec(),
                    severity_name(severity),
                ));
            }
        }
        let named = self.named_plugins(Flavor::Oxlint)?;
        if let (Json::Object(entries), false) = (&mut json, named.is_empty()) {
            let added = named.iter().map(|(plugin, location)| {
                object(vec![
                    (b"name", Json::String(plugin.name.to_vec())),
                    (
                        b"specifier",
                        location.get(b"module").cloned().unwrap_or(Json::Null),
                    ),
                ])
            });
            match entries.iter_mut().find(|it| it.0 == b"jsPlugins") {
                Some((_, Json::Array(items))) => items.extend(added),
                _ => entries.push((b"jsPlugins".to_vec(), Json::Array(added.collect()))),
            }
        }
        let mut sources = Vec::new();
        let mut load_plugin = |directory: &[u8], specifier: &[u8], alias: Option<&[u8]>| {
            let is_it = |it: &&NamedPlugin| {
                alias == Some(&it.0.name[..])
                    && it.1.get(b"module").and_then(Json::as_str) == Some(specifier)
            };
            if let Some(known) = named.iter().find(is_it) {
                return Ok(Arc::clone(&known.0));
            }
            let loaded = self.js_plugins.load(directory, specifier, alias)?;
            if (named.iter()).any(|it| it.0.name == loaded.name && it.0.location != loaded.location)
            {
                let twice = b"\" is loaded twice: here, and by plugins in bunfig.toml or --plugin";
                return Err([b"The plugin \"", &loaded.name[..], twice].concat());
            }
            sources.push((loaded.name.clone(), directory.to_vec(), specifier.to_vec()));
            Ok(loaded)
        };
        // The patterns are from the directory of the file.
        let mut config = Config::from_rc_json_with_plugins(
            self.linter.registry(),
            paths::dirname(path),
            &json,
            &mut load,
            &mut load_plugin,
        )
        .map_err(|error| {
            Fatal(
                [
                    b"Cannot use the configuration file ",
                    path,
                    b":\n",
                    &error.message[..],
                ]
                .concat(),
            )
        })?;
        self.advise_about_js_plugins(&config, &sources);
        config.infer_globals(self.infers_globals_besides());
        Ok(config)
    }

    /// Loads what `plugins` in bunfig.toml and `--plugin` name. They add to whatever the configuration is.
    fn named_plugins(&self, flavor: Flavor) -> Result<Vec<NamedPlugin>, Fatal> {
        let checked = self.load_named_plugins(flavor).and_then(|plugins| {
            // What is wrong with their rules in bunfig.toml is said of bunfig.toml. ESLint 8 takes more than the others: any options
            // for a rule without a schema, and a rule that does not exist is a finding.
            if matches!(flavor, Flavor::Eslint | Flavor::Oxlint) {
                let is_eslint = flavor == Flavor::Eslint;
                native::check_rules(self.linter, self.options, &plugins, Some(is_eslint))?;
            }
            Ok(plugins)
        });
        checked.map_err(|it| self.fatal(it))
    }

    fn load_named_plugins(&self, flavor: Flavor) -> Result<Vec<NamedPlugin>, native::Mistake> {
        let options = self.options;
        let mut plugins: Vec<NamedPlugin> = Vec::new();
        for (at, specifier) in options.plugin.iter().enumerate() {
            let written = options.plugins_of_bunfig.get(at);
            // ESLint 8 has `--plugin` itself, for names.
            if flavor == Flavor::EslintRc && written.is_none() && !is_path_of_plugin(specifier) {
                continue;
            }
            let mistake = |message: Vec<u8>| native::Mistake::new(message, written.map(|it| it.at));
            let is_built_in = |name: &[u8]| self.is_built_in(flavor, name);
            // `a/b/rule` would be the rule `b/rule` of `a`.
            let is_name = |name: &[u8]| {
                let slashes = strings::count_char(name, b'/');
                !name.is_empty()
                    && slashes <= usize::from(name.starts_with(b"@"))
                    && !strings::contains_char(name, b':')
            };
            let is_path = is_path_of_plugin(specifier);
            // As with ESLint, `perfectionist` is eslint-plugin-perfectionist.
            let long = plugin_longhand(specifier).filter(|_| !is_path);
            let package = long.as_deref().unwrap_or(specifier);
            let built_in = |name: &[u8]| {
                let why: &[u8] = match flavor {
                    Flavor::BuiltIn => b"\" is built in\n  Its rules work without it, so remove it from plugins\n  To run the package as well, give it another name: { name = \"",
                    Flavor::Oxlint if Plugin::spelled(name).all(|it| it.has_no_rules()) => b"\" needs another name\n  oxlint keeps that one for its own rules, which bun lint doesn't have: { name = \"",
                    _ => b"\" needs another name\n  That one is a built-in plugin's: { name = \"",
                };
                let parts: [&[u8]; 7] = [
                    b"The plugin \"",
                    name,
                    why,
                    name,
                    b"-js\", specifier = \"",
                    package,
                    b"\" }",
                ];
                mistake(parts.concat())
            };
            let alias = written.and_then(|it| it.alias.as_deref());
            let short = plugin_shorthand(specifier);
            if specifier.is_empty() || short.is_empty() {
                let message = b"A plugin needs a specifier\n  A path, or the name of a package";
                return Err(mistake(message.to_vec()));
            }
            // A path in bunfig.toml is relative to that file.
            let of_bunfig = paths::resolve(self.cwd(), &self.options.bunfig);
            let of_bunfig = paths::dirname(&of_bunfig);
            let directory = written.map_or_else(|| self.cwd(), |_| of_bunfig);
            // Not a package that it needs.
            let is_missing = |why: &[u8], name: &[u8]| {
                strings::contains(why, &[b"Cannot find module '", name, b"'"].concat())
            };
            // It is there, and what its package.json says that it starts with is not.
            let is_installed = |package: &[u8]| {
                let file = [b"node_modules/", package, b"/package.json"].concat();
                paths::ancestors(directory).any(|it| fs::is_file(&paths::join(it, &file)))
            };
            let lacks_entry_point = |package: &[u8]| {
                let parts: [&[u8]; 5] = [
                    b"Cannot load the plugin \"",
                    specifier,
                    b"\"\n  ",
                    package,
                    b" is installed, but its entry point cannot be found\n  Check \"main\" and \"exports\" in its package.json",
                ];
                mistake(parts.concat())
            };
            let cannot_load = |why: Vec<u8>| {
                let why = why.strip_prefix(b"ResolveMessage: ").unwrap_or(&why);
                let why = why.strip_suffix(b" imported from .").unwrap_or(why);
                mistake([b"Cannot load the plugin \"", &specifier[..], b"\"\n  ", why].concat())
            };
            // By its name, before anything is looked for: `plugins = ["react"]` is what turns it on in oxlint.
            if !is_path && is_built_in(alias.unwrap_or(&short)) {
                let has_rules = Plugin::spelled(&short).any(|it| !it.has_no_rules());
                match (flavor, alias) {
                    (_, Some(alias)) => return Err(built_in(alias)),
                    // All its rules are there anyway. A configuration file further down may need it.
                    (Flavor::BuiltIn, None) => continue,
                    (Flavor::Oxlint, None) if !has_rules => return Err(built_in(&short)),
                    // It turns the plugin on, as in the file: see `built_in_plugins`.
                    (Flavor::Eslint, None) => {
                        // It is loaded when a rule is asked of it.
                        match self.js_plugins.resolve(directory, package) {
                            Ok(file) => {
                                let mut packages = self.packages_of_built_in.lock();
                                if !packages.iter().any(|it| it.0 == short) {
                                    let location = object(vec![
                                        (b"module", Json::String(file)),
                                        (b"export", strings_of(&[b"default".to_vec()])),
                                    ]);
                                    packages.push((short, location));
                                }
                            }
                            // The rule leaves many a file to the package.
                            Err(why) if is_missing(&why, package) && short == b"prettier" => {
                                let hint = b" is not installed\n  Without Prettier, turn on bun/format instead of prettier/prettier";
                                let start = b"Cannot load the plugin \"";
                                return Err(mistake(
                                    [start, &specifier[..], b"\"\n  ", package, hint].concat(),
                                ));
                            }
                            Err(why) if is_missing(&why, package) => {}
                            Err(why) => return Err(cannot_load(why)),
                        }
                        continue;
                    }
                    _ => continue,
                }
            }
            let file = is_path.then(|| paths::resolve(directory, specifier));
            // ESLint calls a plugin what its flag calls it.
            let of_flag =
                (flavor == Flavor::Eslint && written.is_none() && !is_path && is_name(&short))
                    .then_some(&short[..]);
            let load = |name: &[u8]| self.js_plugins.load(directory, name, alias.or(of_flag));
            // The long name first: `vue` is not eslint-plugin-vue. One that is there and fails is not passed over.
            let (loaded, found_as) = match (&file, &long) {
                (Some(file), _) => (load(file), &file[..]),
                (None, None) => (load(specifier), &specifier[..]),
                (None, Some(long)) => match load(long) {
                    Err(why) if is_missing(&why, long) => match load(specifier) {
                        // Its rules are there with every configuration, unless a package of the project hides them.
                        Err(why)
                            if is_missing(&why, specifier)
                                && Plugin::spelled(&short).any(Plugin::is_always_there) =>
                        {
                            continue;
                        }
                        Err(why) if is_missing(&why, specifier) && is_installed(long) => {
                            return Err(lacks_entry_point(long));
                        }
                        Err(why) if is_missing(&why, specifier) => {
                            let parts: [&[u8]; 7] = [
                                b"Cannot load the plugin \"",
                                specifier,
                                b"\"\n  Neither ",
                                long,
                                b" nor ",
                                specifier,
                                b" is installed",
                            ];
                            return Err(mistake(parts.concat()));
                        }
                        Ok(other) if other.has_nothing => {
                            let parts: [&[u8]; 7] = [
                                b"Cannot load the plugin \"",
                                specifier,
                                b"\"\n  ",
                                long,
                                b" is not installed, and the package ",
                                specifier,
                                b" is not an ESLint plugin",
                            ];
                            return Err(mistake(parts.concat()));
                        }
                        loaded => (loaded, &specifier[..]),
                    },
                    loaded => (loaded, &long[..]),
                },
            };
            let plugin = loaded.map_err(|why| {
                match !is_path && is_missing(&why, found_as) && is_installed(found_as) {
                    true => lacks_entry_point(found_as),
                    false => cannot_load(why),
                }
            })?;
            let name = &plugin.name[..];
            if !is_name(name) {
                let parts: [&[u8]; 5] = [
                    b"\"",
                    name,
                    b"\" can't be the name of a plugin\n  Give it another: { name = \"..\", specifier = \"",
                    specifier,
                    b"\" }",
                ];
                return Err(mistake(parts.concat()));
            }
            if is_built_in(name) {
                return Err(built_in(name));
            }
            // As for a plugin that a configuration file has imported.
            let location = plugin.location.clone().unwrap_or_else(|| {
                object(vec![
                    (b"module", Json::String(found_as.to_vec())),
                    (b"export", Json::Array(Vec::new())),
                ])
            });
            match plugins.iter().find(|it| it.0.name == plugin.name) {
                None => plugins.push((plugin, location)),
                // Named twice, by `--plugin` too.
                Some(other) if other.1 == location => {}
                Some(_) => {
                    let parts: [&[u8]; 7] = [
                        b"Two plugins are called \"",
                        &plugin.name,
                        b"\"\n  Give this one another name: { name = \"",
                        &plugin.name,
                        b"-2\", specifier = \"",
                        specifier,
                        b"\" }",
                    ];
                    return Err(mistake(parts.concat()));
                }
            }
        }
        Ok(plugins)
    }

    /// Whether, with such a configuration, the rules here are those of the plugin called `name`, so that no package is loaded.
    fn is_built_in(&self, flavor: Flavor, name: &[u8]) -> bool {
        match flavor {
            // The others are packages there, like any other. So are these under `--no-native-plugin-rules`.
            Flavor::Eslint | Flavor::EslintRc => {
                Plugin::is_native_under_eslint(name) && self.linter.registry().answers_for(name)
            }
            // It keeps the names jsdoc and vue to itself, though there are no such rules here.
            Flavor::Oxlint => is_plugin_of_oxlint(name),
            Flavor::BuiltIn => Plugin::spelled(name).any(|it| !it.has_no_rules()),
        }
    }

    /// The entries of `plugins` in bunfig.toml and of `--plugin` that are [built in](Loader::is_built_in): they are not loaded.
    /// With a configuration file they say what `plugins` in the file says.
    fn built_in_plugins(&self, flavor: Flavor) -> impl Iterator<Item = &Vec<u8>> {
        let is_built_in = move |name: &[u8]| self.is_built_in(flavor, name);
        let options = self.options;
        let aliased = |at: usize| {
            options
                .plugins_of_bunfig
                .get(at)
                .is_some_and(|it| it.alias.is_some())
        };
        (options.plugin.iter().enumerate())
            .filter(move |it| !aliased(it.0) && is_built_in(&plugin_shorthand(it.1)))
            .map(|it| it.1)
    }

    /// The object that has `named`, for a configuration of ESLint: there a rule is of a plugin that an object has.
    fn object_of_named(named: &[NamedPlugin]) -> Option<Json> {
        let entries = |of: &dyn Fn(&NamedPlugin) -> Json| {
            Json::Object(
                named
                    .iter()
                    .map(|it| (it.0.name.to_vec(), of(it)))
                    .collect(),
            )
        };
        (!named.is_empty()).then(|| {
            object(vec![
                (
                    b"plugins",
                    entries(&|it| {
                        it.0.id
                            .as_ref()
                            .map_or(Json::Null, |it| Json::String(it.to_vec()))
                    }),
                ),
                (b"$jsPlugins", entries(&|it| it.1.clone())),
            ])
        })
    }

    /// Keeps `mistake` as it is printed, with the line of bunfig.toml that it is about.
    fn fatal(&self, mistake: native::Mistake) -> Fatal {
        let colors = self.environment.stderr.colors;
        let printed = mistake.print(self.cwd(), &self.options.bunfig, colors);
        let _ = self.mistake.set(printed);
        Fatal(mistake.message)
    }

    fn built_in(&self) -> Found {
        // What oxlint does without a file.
        if self.has_defaults_of_oxlint() {
            self.check_flags(Flavor::Oxlint, None)?;
            let path = paths::join(self.cwd(), b".oxlintrc.json");
            return Ok(Arc::new(Loaded {
                config: self.rc(&path, Json::Object(Vec::new()))?,
                flavor: Flavor::Oxlint,
                file: None,
                wants_types: Some(false),
                denies_warnings: false,
                max_warnings: None,
                respects_eslint_comments: true,
                checks_types: false,
                for_eslint: None,
            }));
        }
        self.check_flags(Flavor::BuiltIn, None)?;
        let plugins = self.named_plugins(Flavor::BuiltIn)?;
        native::check_rules(self.linter, self.options, &plugins, None)
            .map_err(|it| self.fatal(it))?;
        // The repository first, so that a file gets the same answer from every directory in it, even from a `test` folder that
        // has a package.json of its own.
        let has_package = |it: &&[u8]| fs::is_file(&paths::join(it, b"package.json"));
        let project = paths::ancestors(self.cwd())
            .find(|it| gitignore::is_root(it))
            .or_else(|| paths::ancestors(self.cwd()).find(has_package))
            .unwrap_or_else(|| self.cwd());
        // Every file is in it, on whatever drive.
        let mut objects = vec![built_in_json(
            self.options.type_aware == Some(true),
            project,
        )];
        let mut of_user = native::categories(self.linter.registry(), self.options);
        of_user.extend(self.added(b"/"));
        objects.extend(self.split_pairs(of_user));
        let mut config = self.flat(b"/", Json::Array(objects), false, plugins)?;
        // Without a word: where the run has types, which then cost nothing more.
        config.infer_globals(match self.options.infer_globals {
            Some(true) => InferGlobals::Instead,
            None if self.options.type_aware == Some(true) => InferGlobals::Instead,
            None if self.options.infers_globals_by_options => InferGlobals::ByOptions,
            Some(false) | None => InferGlobals::No,
        });
        Ok(Arc::new(Loaded {
            config,
            flavor: Flavor::BuiltIn,
            file: None,
            // Without `--type-aware`, the only rules on that need types are the ones the user turned on.
            wants_types: Some(true),
            denies_warnings: false,
            max_warnings: None,
            respects_eslint_comments: true,
            checks_types: false,
            for_eslint: None,
        }))
    }

    /// Reads the configuration file at `path`. `base_path`: what the patterns of a flat
    /// configuration are relative to.
    fn read(&self, path: &[u8], base_path: &[u8]) -> Found {
        let name = paths::basename(path);
        let is_of_vite = NAMES_OF_VITE.contains(&name);
        let known = (NAMES.iter().find(|it| it.0 == name).map(|it| (it.1, it.2)))
            .or_else(|| is_of_vite.then_some((Flavor::Oxlint, Syntax::Program)));
        let is_json = name.ends_with(b".json") || name.ends_with(b".jsonc");
        let syntax = known.map_or(
            if is_json {
                Syntax::Json
            } else {
                Syntax::Program
            },
            |it| it.1,
        );
        let json = match syntax {
            Syntax::Program => evaluate::evaluate(self.environment, evaluate::ESLINT, path)?,
            Syntax::Json => {
                let text = fs::read(path).map_err(|error| {
                    Fatal(
                        [
                            b"Cannot read the configuration file ",
                            path,
                            b": ",
                            &fs::describe(&error),
                        ]
                        .concat(),
                    )
                })?;
                let for_oxlint = || {
                    json_for_oxlint(path, &text).map_err(|why| {
                        Fatal([b"Cannot use the configuration file ", path, b":\n", &why].concat())
                    })
                };
                let json = match known.map(|it| it.0) {
                    Some(Flavor::Oxlint) => bun_lint::json::parse(&for_oxlint()?),
                    Some(_) => bun_lint::json::parse(&text),
                    // A file by another name is oxlint's if it's an object.
                    None => match bun_lint::json::parse(&text) {
                        Some(other) if other.as_object().is_none() => Some(other),
                        _ => bun_lint::json::parse(&for_oxlint()?),
                    },
                };
                json.ok_or_else(|| {
                    Fatal([b"The configuration file ", path, b" is not valid JSON."].concat())
                })?
            }
        };
        if is_of_vite && json == Json::Null {
            return Err(Fatal([HAS_NO_LINT_FIELD, path].concat()));
        }
        // A file by another name is what it looks like.
        let flavor = known.map_or_else(
            || match (&json, syntax) {
                (Json::Object(_), Syntax::Json) => Flavor::Oxlint,
                _ => Flavor::Eslint,
            },
            |it| it.0,
        );
        self.check_flags(flavor, Some(path))?;
        if flavor == Flavor::Oxlint {
            let cannot_use = |why: &[u8]| {
                Fatal([b"Cannot use the configuration file ", path, b":\n", why].concat())
            };
            if syntax == Syntax::Program {
                check_extends_of_program(&json).map_err(|why| cannot_use(&why))?;
            } else if json.as_object().is_none() {
                let why: [&[u8]; 3] = [
                    b"Failed to parse oxlint config ",
                    path,
                    b".\nExpected a JSON object.",
                ];
                return Err(cannot_use(&why.concat()));
            }
            Config::check_shape_for_oxlint(&json).map_err(|error| cannot_use(&error.message))?;
            let is_nested = self.options.config.is_none()
                && (paths::dirname(path).strip_prefix(self.cwd()))
                    .is_some_and(|rest| rest.starts_with(b"/"));
            let options = json.get(b"options").and_then(Json::as_object);
            if let Some((name, _)) = options.and_then(|it| it.first()).filter(|_| is_nested) {
                return Err(cannot_use(
                    &[
                        b"The `options.",
                        &name[..],
                        b"` option is only supported in the root config.",
                    ]
                    .concat(),
                ));
            }
        }
        let named = match flavor {
            // `rc` loads them.
            Flavor::Oxlint => Vec::new(),
            _ => self.named_plugins(Flavor::Eslint)?,
        };
        let config = match flavor {
            Flavor::Eslint | Flavor::BuiltIn | Flavor::EslintRc => {
                // ESLint throws.
                if json == Json::Null {
                    return Err(Fatal(
                        [b"The configuration file ", path, b" exports nothing."].concat(),
                    ));
                }
                let is_empty = match &json {
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
                self.flat(
                    base_path,
                    if is_empty {
                        Json::Array(Vec::new())
                    } else {
                        json
                    },
                    true,
                    named.clone(),
                )
                .map_err(|Fatal(why)| Fatal(self.name_place(Some(path), &why)))?
            }
            Flavor::Oxlint => self.rc(path, json)?,
        };
        for note in config.notes() {
            self.warn(&[note]);
        }
        for line in config.advice() {
            self.advise_if_true(line, paths::dirname(path));
        }
        self.warn_about_unknown_rules(&config, &paths::relative(self.cwd(), path));
        let option = |name: &[u8]| config.option_of_oxlint(name);
        let is_on = |name: &[u8]| option(name).and_then(Json::as_bool) == Some(true);
        let wants_types = match flavor {
            Flavor::Eslint | Flavor::EslintRc => None,
            Flavor::Oxlint => Some(is_on(b"typeAware")),
            Flavor::BuiltIn => Some(false),
        };
        let denies_warnings = is_on(b"denyWarnings");
        let max_warnings = match option(b"maxWarnings") {
            Some(Json::Number(count)) => Some(*count as i64),
            _ => None,
        };
        let respects_eslint_comments =
            option(b"respectEslintDisableDirectives").and_then(Json::as_bool) != Some(false);
        let checks_types = is_on(b"typeCheck");
        let for_eslint = match flavor {
            Flavor::Eslint => self.for_eslint(Some((path, &config)), base_path, &named),
            _ => None,
        };
        Ok(Arc::new(Loaded {
            config,
            flavor,
            file: Some(path.to_vec()),
            wants_types,
            denies_warnings,
            max_warnings,
            respects_eslint_comments,
            checks_types,
            for_eslint,
        }))
    }

    /// Warns once per plugin, listing every rule of it that `config` sets and Bun doesn't have. `file` is the config file.
    fn warn_about_unknown_rules(&self, config: &Config, file: &[u8]) {
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
            let (noun, is, it): (&[u8], &[u8], &[u8]) = match rules.len() {
                1 => (b" rule in ", b" is", b"it"),
                _ => (b" rules in ", b" are", b"them"),
            };
            let hint = match Plugin::of_oxlint_prefix(plugin).is_some_and(Plugin::has_no_rules) {
                true => [
                    b"\n  bun lint has no \"",
                    plugin,
                    b"\" rules. Turn ",
                    it,
                    b" off or remove ",
                    it,
                    b".",
                ]
                .concat(),
                false => Vec::new(),
            };
            self.cannot_do(&[
                &count,
                noun,
                file,
                is,
                b" not supported: ",
                &rules.join(&b", "[..]),
                &hint,
            ]);
        }
    }

    /// The configuration in the file at `path`, which is empty for the one that is built in or,
    /// under `--no-config-lookup`, for none.
    fn load(&self, path: &[u8], base_path: &[u8]) -> Found {
        let slot = Arc::clone(self.by_file.lock().entry(path.to_vec()).or_default());
        slot.get_or_init(|| match path {
            b"" if !self.options.config_lookup => {
                self.check_flags(Flavor::Eslint, None)?;
                let named = self.named_plugins(Flavor::Eslint)?;
                Ok(Arc::new(Loaded {
                    config: self.flat(base_path, Json::Array(Vec::new()), true, named.clone())?,
                    flavor: Flavor::Eslint,
                    file: None,
                    wants_types: None,
                    denies_warnings: false,
                    max_warnings: None,
                    respects_eslint_comments: true,
                    checks_types: false,
                    for_eslint: self.for_eslint(None, base_path, &named),
                }))
            }
            b"" => self.built_in(),
            path => self.read(path, base_path),
        })
        .clone()
    }

    /// The tool whose config files count: `--flavor`, or else the tool whose config applies to the working directory.
    /// `None` if no config applies there.
    fn tool(&self) -> Option<Flavor> {
        *self.tool.get_or_init(|| {
            let options = self.options;
            let wanted = options.flavor.map(|it| match it {
                Tool::Eslint => Flavor::Eslint,
                Tool::Oxlint => Flavor::Oxlint,
            });
            let reads_flat = self.flat_config != Some(false);
            let is_there =
                |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
            let names = || {
                NAMES
                    .iter()
                    .filter(move |it| reads_flat || it.1 != Flavor::Eslint)
            };
            let found = paths::ancestors(self.cwd()).find_map(|directory| {
                let mut names = names().filter(|it| wanted.is_none_or(|wanted| wanted == it.1));
                let found = names.find(|it| is_there(directory, it.0))?;
                Some((directory, found.0, found.1))
            });
            let names_file_of_oxlint = (options.config.as_ref()).is_some_and(|it| {
                is_written_for_oxlint(&paths::resolve(self.cwd(), &paths::from_native(it)))
            });
            if wanted.is_none() && options.config.is_none() {
                let nearest = |flavor: Flavor| {
                    paths::ancestors(self.cwd()).find_map(|directory| {
                        let mut names = names().filter(|it| it.1 == flavor);
                        let found = names.find(|it| is_there(directory, it.0))?;
                        Some(paths::join(directory, found.0))
                    })
                };
                let legacy = || {
                    let names = || eslintrc::NAMES.iter().filter(|it| **it != b"package.json");
                    paths::ancestors(self.cwd()).find_map(|directory| {
                        let found = names().find(|it| is_there(directory, it))?;
                        Some(paths::join(directory, found))
                    })
                };
                let pass_over = |of_eslint: &[u8], of_oxlint: &[u8]| {
                    let shown = |it: &[u8]| paths::relative(self.cwd(), it);
                    let _ = self.passed_over.set((shown(of_eslint), shown(of_oxlint)));
                };
                match (nearest(Flavor::Eslint), nearest(Flavor::Oxlint)) {
                    (Some(of_eslint), Some(of_oxlint)) => {
                        pass_over(&of_eslint, &of_oxlint);
                        return Some(Flavor::Oxlint);
                    }
                    (None, Some(of_oxlint)) => {
                        if let Some(of_eslint) = legacy() {
                            pass_over(&of_eslint, &of_oxlint);
                        }
                    }
                    _ => {}
                }
            }
            if let Some((_, _, flavor)) = found {
                return Some(flavor);
            }
            let can_be_legacy =
                wanted == Some(Flavor::Eslint) || wanted.is_none() && !names_file_of_oxlint;
            if can_be_legacy && paths::ancestors(self.cwd()).any(eslintrc::has_one) {
                return Some(Flavor::EslintRc);
            }
            let decided = wanted.or_else(|| names_file_of_oxlint.then_some(Flavor::Oxlint));
            let of_the_package = self.tool_of_the_package(decided.is_some());
            decided.or(of_the_package)
        })
    }

    /// Whether files without a config file get oxlint's defaults instead of Bun's.
    fn has_defaults_of_oxlint(&self) -> bool {
        self.tool() == Some(Flavor::Oxlint)
    }

    /// Rejects a flag of another tool that can't work with a `flavor` config. `file` is the config file, if there is one.
    fn check_flags(&self, flavor: Flavor, file: Option<&[u8]>) -> Result<(), Fatal> {
        let Some((flag, whose)) = self.options.flag_that_means_nothing_to(flavor) else {
            return Ok(());
        };
        let tool: &[u8] = match flavor {
            Flavor::Oxlint => b"oxlint",
            Flavor::EslintRc => b"ESLint 8",
            Flavor::Eslint | Flavor::BuiltIn => b"ESLint",
        };
        let uses = match file {
            Some(file) => [
                &paths::relative(self.cwd(), file)[..],
                b", an ",
                tool,
                b" config.",
            ]
            .concat(),
            None if flavor == Flavor::BuiltIn => b"Bun's defaults.".to_vec(),
            None => [tool, b"'s defaults."].concat(),
        };
        let refusal = [
            &flag[..],
            b" is an ",
            whose,
            b" flag and has no effect here\n  This run uses ",
            &uses,
        ]
        .concat();
        Err(Fatal(self.refused.get_or_init(|| refusal).clone()))
    }

    /// Prefixes `why`, ESLint's message about an invalid config, with a line that says where the mistake is. That's `file`
    /// (the config file), bunfig.toml or `--rule`.
    pub(crate) fn name_place(&self, file: Option<&[u8]>, why: &[u8]) -> Vec<u8> {
        // ESLint 9's wording first, then ESLint 8's.
        let is_about = |id: &[u8]| {
            let says = |before: &[u8]| strings::contains(why, &[before, id, b"\""].concat());
            says(b"Key \"rules\": Key \"")
                || why.starts_with(b"CLIOptions") && says(b"Configuration for rule \"")
        };
        let rule = self.options.rule.iter().position(|it| is_about(&it.0));
        let mut of_overrides = self.options.overrides.iter().flat_map(|it| &it.rules);
        let place = match (rule, file) {
            (Some(at), _) if at < self.options.rules_of_bunfig.len() => self.options.bunfig.clone(),
            (None, _) if of_overrides.any(|it| is_about(&it.0)) => self.options.bunfig.clone(),
            (Some(_), _) => b"--rule".to_vec(),
            (None, Some(file)) => paths::relative(self.cwd(), file),
            (None, None) => return why.to_vec(),
        };
        [b"Invalid config in ", &place[..], b"\n", why].concat()
    }

    /// The formatted error for an invalid rule setting in bunfig.toml or `--rule`. Only set when there's no config file.
    pub(crate) fn mistake(&self) -> Option<&[u8]> {
        self.mistake.get().map(Vec::as_slice)
    }

    /// What [`Loader::check_flags`] has failed with. Neither tool has an exit code for it.
    pub(crate) fn refused(&self) -> Option<&[u8]> {
        self.refused.get().map(Vec::as_slice)
    }

    /// The same for the file `name` of `directory`, which is one of [`Loader::names`] and would count but for a command line for
    /// ESLint 8.
    fn check_flags_of_eslint_8(&self, directory: &[u8], name: &[u8]) -> Result<(), Fatal> {
        if self.options.config.is_some() {
            return Ok(());
        }
        let flavor = (NAMES.iter().find(|it| it.0 == name)).map_or(Flavor::Oxlint, |it| it.1);
        self.check_flags(flavor, Some(&paths::join(directory, name)))
    }

    /// Without any configuration file: oxlint, if the nearest `package.json` that depends on one of the two tools depends on it.
    /// ESLint does not run without a configuration file.
    /// `is_decided`: the command line has said which tool it is.
    fn tool_of_the_package(&self, is_decided: bool) -> Option<Flavor> {
        let (path, has_oxlint, has_eslint) = self.tools_of_the_package()?;
        if has_oxlint && has_eslint && !is_decided {
            self.warn(&[
                b"No config file found, and ",
                &paths::relative(self.cwd(), &path),
                b" depends on both eslint and oxlint\n  Using oxlint's defaults. Add a config file to change that.",
            ]);
        }
        has_oxlint.then_some(Flavor::Oxlint)
    }

    /// The nearest `package.json` that depends on one of the two tools, and whether it depends on oxlint, which comes with Vite+, and on
    /// ESLint.
    fn tools_of_the_package(&self) -> Option<(Vec<u8>, bool, bool)> {
        paths::ancestors(self.cwd()).find_map(|directory| {
            let path = paths::join(directory, b"package.json");
            let json = bun_lint::json::parse(&fs::read(&path).ok()?)?;
            let has = |name: &[u8]| {
                [&b"dependencies"[..], b"devDependencies"]
                    .iter()
                    .any(|it| json.get(it).is_some_and(|it| it.get(name).is_some()))
            };
            let (has_oxlint, has_eslint) = (has(b"oxlint") || has(b"vite-plus"), has(b"eslint"));
            if has(b"vite-plus") {
                let _ = self.is_of_vite.set(true);
            }
            (has_oxlint || has_eslint).then_some((path, has_oxlint, has_eslint))
        })
    }

    /// The ESLint config that is ignored and the oxlint config that is used, relative to the working directory. Set when both
    /// apply there and neither `--config` nor `--flavor` picked one.
    pub(crate) fn passed_over(&self) -> Option<&(Vec<u8>, Vec<u8>)> {
        self.tool();
        self.passed_over.get()
    }

    /// Those of [`NAMES`] that count.
    fn names(&self) -> impl Iterator<Item = &'static [u8]> {
        let (reads_flat, tool) = (self.flat_config != Some(false), self.tool());
        let is_of_vite = tool == Some(Flavor::Oxlint) && self.is_of_vite.get() == Some(&true);
        let names = NAMES.iter().filter(move |it| {
            (reads_flat || it.1 != Flavor::Eslint) && tool.is_none_or(|tool| tool == it.1)
        });
        let of_vite = NAMES_OF_VITE.iter().filter(move |_| is_of_vite);
        names.map(|it| it.0).chain(of_vite.copied())
    }

    /// The name of the configuration file among `names`, those of `directory`, and whether one of these can be a file of ESLint 8.
    /// ESLint asks the file system, and one that folds case has `ESLint.config.js` for `eslint.config.js`. oxlint compares the names.
    fn pick<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
    ) -> (Option<&'static [u8]>, bool) {
        let (mut best, mut has_legacy) = (None, false);
        for name in names.filter(|name| {
            (name.get(..7)).is_some_and(|it| it.eq_ignore_ascii_case(b"eslint."))
                || name.starts_with(b".")
                || name.starts_with(b"oxlint.")
                || name.starts_with(b"vite.")
                || *name == b"package.json"
        }) {
            // Whoever is told so asks the file system.
            has_legacy |= (eslintrc::NAMES.iter()).any(|it| it.eq_ignore_ascii_case(name));
            let position = self.names().position(|it| it == name).or_else(|| {
                self.names().position(|it| {
                    it.starts_with(b"eslint.")
                        && it.eq_ignore_ascii_case(name)
                        && fs::is_file(&paths::join(directory, it))
                })
            });
            best = match (best, position) {
                (Some(best), Some(position)) => Some(position.min(best)),
                (best, position) => best.or(position),
            };
        }
        (best.and_then(|best| self.names().nth(best)), has_legacy)
    }

    /// The configuration file of ESLint 9 or of oxlint that the files in `directory` have, if it is looked for: where it is, and
    /// its name.
    fn found<'d>(&self, directory: &'d [u8]) -> Option<(&'d [u8], &'static [u8])> {
        paths::ancestors(directory).find_map(|directory| {
            let mut names = self.names();
            let name = names.find(|name| fs::is_file(&paths::join(directory, name)))?;
            Some((directory, name))
        })
    }

    /// Whether the command line is one for ESLint 8: it has a flag that only that has, and no file of another tool counts, or
    /// `--config` names one of its files.
    fn is_command_line_of_eslint_8(&self) -> bool {
        *self.is_legacy.get_or_init(|| {
            let options = self.options;
            let has_flag =
                !options.eslintrc || !options.env.is_empty() || !options.rulesdir.is_empty();
            let Some(path) = &options.config else {
                let is_for_oxlint = options.flavor == Some(Tool::Oxlint);
                return has_flag && !is_for_oxlint && self.found(self.cwd()).is_none();
            };
            if has_flag {
                return true;
            }
            // A file that can be either is one of oxlint, whatever the working directory has.
            eslintrc::is_one(&paths::resolve(self.cwd(), &paths::from_native(path)))
        })
    }

    /// ESLint 8's `cliConfig`.
    fn legacy_command_line(&self) -> Json {
        let options = self.options;
        let mut entries = Vec::new();
        if !options.env.is_empty() {
            let env = options.env.iter().map(|it| (it.clone(), Json::Bool(true)));
            entries.push((&b"env"[..], Json::Object(env.collect())));
        }
        if let Some(globals) = globals_of(options) {
            entries.push((b"globals", globals));
        }
        if !options.ignore_pattern.is_empty() {
            entries.push((b"ignorePatterns", strings_of(&options.ignore_pattern)));
        }
        if let Some(parser) = &options.parser {
            entries.push((b"parser", Json::String(parser.clone())));
        }
        if !options.parser_options.is_empty() {
            let parser_options = Json::Object(options.parser_options.clone());
            entries.push((b"parserOptions", parser_options));
        }
        // The others of bunfig.toml are `named_plugins`.
        let count = options.plugins_of_bunfig.len();
        let of_bunfig = self.built_in_plugins(Flavor::EslintRc);
        let of_bunfig = of_bunfig.filter(|it| options.plugin[..count].contains(it));
        let of_flag = options.plugin[count..]
            .iter()
            .filter(|it| !is_path_of_plugin(it));
        let names: Vec<Vec<u8>> = of_bunfig.chain(of_flag).cloned().collect();
        if !names.is_empty() {
            entries.push((b"plugins", strings_of(&names)));
        }
        if !options.settings.is_empty() {
            entries.push((b"settings", Json::Object(options.settings.clone())));
        }
        let rules = rules_of(options, self.cwd());
        if !rules.is_empty() {
            entries.push((b"rules", Json::Object(rules)));
        }
        if !options.overrides.is_empty() {
            // ESLint 8 also lints files that only an override matches, unless a pattern of it ends with `*`
            // (`isAdditionalTargetPath`). Wrapping them in an override for `*` keeps them from adding files.
            let overrides = Json::Array(self.overrides(Shape::Legacy, self.cwd()));
            let for_all = vec![(&b"files"[..], strings_of(&[b"*".to_vec()]))];
            let for_all = object([for_all, vec![(b"overrides", overrides)]].concat());
            entries.push((b"overrides", Json::Array(vec![for_all])));
        }
        let unused = match options.report_unused_disable_directives {
            true => Some(Severity::Error),
            false => options.report_unused_disable_directives_severity,
        };
        if let Some(severity) = unused {
            entries.push((b"reportUnusedDisableDirectives", severity_name(severity)));
        }
        object(entries)
    }

    /// The configuration of ESLint 8 for what is in `directory`, which has a file of it. `None`: without any such file.
    fn legacy(&self, directory: Option<&[u8]>) -> Found {
        let key = [directory.unwrap_or_default(), b"\0"].concat();
        let slot = Arc::clone(self.by_file.lock().entry(key).or_default());
        slot.get_or_init(|| self.read_legacy(directory)).clone()
    }

    fn read_legacy(&self, directory: Option<&[u8]>) -> Found {
        let (options, cwd) = (self.options, self.cwd());
        let file = match &options.config {
            Some(path) => Some(paths::resolve(cwd, &paths::from_native(path))),
            None => directory.and_then(file_of_eslint),
        };
        self.check_flags(Flavor::EslintRc, file.as_deref())?;
        let rules = (!options.rulesdir.is_empty()).then(|| {
            self.rulesdir
                .get_or_init(|| rulesdir::load(self.environment, &options.rulesdir))
        });
        let rules = rules
            .map(|it| it.as_ref().map_err(Fatal::clone))
            .transpose()?;
        let absolute = |path: &Vec<u8>| paths::resolve(cwd, &paths::from_native(path));
        let plugins_from = options.resolve_plugins_relative_to.as_ref().map(absolute);
        let command_line = paths::join(cwd, b"__placeholder__.js");
        let mut modules = eslintrc::Modules {
            environment: self.environment,
            registry: self.linter.registry(),
            plugins_from: plugins_from.clone(),
            command_line: (command_line.clone(), self.legacy_command_line()),
            printed: Vec::new(),
        };
        let mut files = match directory {
            Some(directory) => eslintrc::cascade(directory, cwd, &mut modules)?,
            None => Vec::new(),
        };
        let cascade = files.len();
        // `createCLIConfigArray`
        if let Some(path) = &options.config {
            let start = self.start_of_named_config();
            files.push(eslintrc::named(&absolute(path), &start, &mut modules)?);
        }
        if options.ignore {
            let path = options.ignore_path.as_ref().map(absolute);
            files.extend(eslintrc::ignore_file(
                path.as_deref(),
                &self.start_of_ignore_path(),
            )?);
        }
        // Only if no file says anything.
        if files.is_empty() && options.eslintrc {
            files.extend(eslintrc::personal(cwd, &mut modules)?);
        }
        let mut of_command_line = modules.command_line.1.clone();
        // The patterns of a bunfig.toml that is elsewhere start there. They come last, as they do in the one object.
        let [(start, ignored), (_, ignored_by_flags)] = self.ignore_patterns();
        let elsewhere = (start != cwd).then(|| {
            let mut entries = Vec::new();
            if let Json::Object(all) = &mut of_command_line {
                all.retain(|it| it.0 != b"ignorePatterns");
                if !ignored_by_flags.is_empty() {
                    all.push((b"ignorePatterns".to_vec(), strings_of(ignored_by_flags)));
                }
                if !ignored.is_empty() {
                    entries.push((b"ignorePatterns".to_vec(), strings_of(ignored)));
                }
                entries.extend(all.extract_if(.., |it| it.0 == b"overrides"));
            }
            LegacyFile {
                path: paths::join(&start, b"__placeholder__.js"),
                name: b"CLIOptions".to_vec(),
                base_path: start.clone(),
                json: Json::Object(entries),
            }
        });
        files.push(LegacyFile {
            path: command_line,
            name: b"CLIOptions".to_vec(),
            base_path: cwd.to_vec(),
            json: of_command_line,
        });
        files.extend(elsewhere);
        let mut load = |kind, request: &[u8], from: &[u8], entry: &[u8]| {
            let short = plugin_shorthand(request);
            eslintrc::load(kind, request, &short, from, entry, &mut modules)
        };
        let mut load_plugin =
            |location: &Json, prefix: &[u8]| self.js_plugins.load_located(location, prefix);
        let named = self.named_plugins(Flavor::EslintRc)?;
        let mut config = Config::from_legacy(
            self.linter.registry(),
            &LegacyOptions {
                root: b"/",
                cwd,
                ignore: options.ignore,
                extensions: options.ext.as_deref(),
                rules,
                plugins_from: plugins_from.as_deref(),
                cascade,
                named: &named,
            },
            &mut files,
            &mut load,
            &mut load_plugin,
        )
        .map_err(|error| Fatal(self.name_place(file.as_deref(), &error.message)))?;
        for note in config.notes() {
            self.warn(&[note]);
        }
        for line in config.advice() {
            self.advise(line.clone());
        }
        self.warn_about_unknown_rules(&config, b"your .eslintrc config");
        config.infer_globals(self.infers_globals_besides());
        Ok(Arc::new(Loaded {
            config,
            flavor: Flavor::EslintRc,
            file,
            wants_types: None,
            denies_warnings: false,
            max_warnings: None,
            respects_eslint_comments: true,
            checks_types: false,
            for_eslint: None,
        }))
    }

    /// The configuration in the file `name` of `directory`. oxlint refuses a directory that has two of its files.
    fn load_the_only_one(&self, directory: &[u8], name: &[u8]) -> Found {
        let mut of_oxlint = NAMES.iter().filter(|it| it.1 == Flavor::Oxlint);
        if of_oxlint.clone().any(|it| it.0 == name)
            && let Some(other) =
                of_oxlint.find(|it| it.0 != name && fs::is_file(&paths::join(directory, it.0)))
        {
            return Err(Fatal(
                [
                    b"Both '",
                    name,
                    b"' and '",
                    other.0,
                    b"' found in ",
                    directory,
                    b".\nDelete one of the configuration files.",
                ]
                .concat(),
            ));
        }
        self.load(&paths::join(directory, name), directory)
    }

    /// What the files have that no configuration file is found for.
    fn without_a_file(&self) -> Found {
        match self.is_command_line_of_eslint_8() {
            true => self.legacy(None),
            false => self.load(b"", self.cwd()),
        }
    }

    /// Whether the working directory has no configuration file, in it or above it, and every directory tells for itself.
    fn lacks_file(&self) -> bool {
        *self.lacks_file.get_or_init(|| {
            let (own, none) = (self.for_directory(self.cwd()), self.without_a_file());
            matches!((own, none), (Ok(own), Ok(none)) if Arc::ptr_eq(&own, &none))
        })
    }

    /// Says that `directory` is an argument, or that a file in it is one.
    pub(crate) fn name(&self, directory: &[u8]) {
        let mut named = self.named.lock();
        if !named.iter().any(|it| it == directory) {
            named.push(directory.to_vec());
        }
    }

    /// Whether a configuration file counts for what is in `directory`. A configuration file is a program, or names programs. So in
    /// a run whose working directory has none, those count that are in or below the working directory, and those of what is
    /// [named](Loader::name): not those of what a pattern merely leads to.
    fn counts_in(&self, directory: &[u8]) -> bool {
        paths::is_at_or_inside(self.cwd(), directory)
            || !self.lacks_file()
            || (self.named.lock().iter()).any(|it| paths::is_at_or_inside(it, directory))
    }

    /// The configuration of the files that are in `directory`: ESLint's `loadConfigArrayForFile`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        if !self.counts_in(directory) {
            return self.without_a_file();
        }
        if self.is_command_line_of_eslint_8() {
            if let Some((directory, name)) = self.found(directory) {
                self.check_flags_of_eslint_8(directory, name)?;
            }
            let mut above = paths::ancestors(directory).filter(|_| self.options.eslintrc);
            return self.legacy(above.find(|it| eslintrc::has_one(it)));
        }
        if self.has_one_configuration() {
            return match &self.options.config {
                Some(path) => self.load(
                    &paths::resolve(self.cwd(), &paths::from_native(path)),
                    &self.start_of_named_config(),
                ),
                None => self.load(b"", self.cwd()),
            };
        }
        // oxlint's `--disable-nested-config`: that of the working directory is for everything.
        let directory = if self.options.disable_nested_config {
            self.cwd()
        } else {
            directory
        };
        let mut asked: Vec<&[u8]> = Vec::new();
        let mut found = None;
        // How many of `asked` have the configuration of the nearest directory with a file of ESLint 8.
        let mut legacy = None;
        let reads_legacy = self.tool() != Some(Flavor::Oxlint);
        for ancestor in paths::ancestors(directory) {
            if let Some(known) = self.by_directory.lock().get(ancestor) {
                found = Some(known.clone());
                break;
            }
            asked.push(ancestor);
            let name = (self.names()).find(|name| fs::is_file(&paths::join(ancestor, name)));
            let loaded = name.map(|name| self.load_the_only_one(ancestor, name));
            if let Some(loaded) = loaded.filter(|it| !has_no_lint_field(it)) {
                found = Some(loaded);
                break;
            }
            if legacy.is_none() && reads_legacy && eslintrc::has_one(ancestor) {
                legacy = Some(asked.len());
            }
        }
        let is_other = |it: &Found| {
            (it.as_ref()).is_ok_and(|it| matches!(it.flavor, Flavor::Eslint | Flavor::Oxlint))
        };
        if let Some(count) = legacy.filter(|_| !found.as_ref().is_some_and(is_other)) {
            asked.truncate(count);
            let last = asked.last().copied();
            found = Some(match self.flat_config {
                Some(true) => Err(Fatal(
                    [
                        b"ESLINT_USE_FLAT_CONFIG is true, but ",
                        last.unwrap_or_default(),
                        b" has an .eslintrc config and no eslint.config.js",
                    ]
                    .concat(),
                )),
                _ => self.legacy(last),
            });
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
        let has_one = self.has_one_configuration() && !self.is_command_line_of_eslint_8();
        if has_one || self.options.disable_nested_config || !self.counts_in(directory) {
            return Ok(Arc::clone(inherited));
        }
        // From here on they count, also those above it.
        if !self.counts_in(paths::dirname(directory)) {
            return self.for_directory(directory);
        }
        let picked = self.pick(directory, names);
        if let (Some(name), _) = picked
            && self.is_command_line_of_eslint_8()
        {
            self.check_flags_of_eslint_8(directory, name)?;
        }
        if !self.options.eslintrc {
            return Ok(Arc::clone(inherited));
        }
        let is_legacy = || matches!(inherited.flavor, Flavor::EslintRc | Flavor::BuiltIn);
        match picked {
            (Some(name), _) if !self.is_command_line_of_eslint_8() => {
                let loaded = self.load_the_only_one(directory, name);
                match has_no_lint_field(&loaded) {
                    true => Ok(Arc::clone(inherited)),
                    false => loaded,
                }
            }
            (_, true)
                if is_legacy()
                    && self.flat_config != Some(true)
                    && eslintrc::has_one(directory) =>
            {
                self.legacy(Some(directory))
            }
            _ => Ok(Arc::clone(inherited)),
        }
    }

    /// Whether the run stands in for oxlint, where the configuration of the working directory cannot be read.
    pub(crate) fn is_for_oxlint(&self) -> bool {
        let is_json = |it: &Vec<u8>| it.ends_with(b".json") || it.ends_with(b".jsonc");
        let is_there =
            |it: &Vec<u8>| fs::is_file(&paths::resolve(self.cwd(), &paths::from_native(it)));
        match &self.options.config {
            Some(path) if is_there(path) => is_json(path) && !self.is_command_line_of_eslint_8(),
            _ => self.has_defaults_of_oxlint(),
        }
    }

    /// Whether a directory called `name`, which `loaded` ignores, can have a configuration file in it that counts. Nothing
    /// of a project is in the directories of Git and Jujutsu.
    pub(crate) fn looks_for_configurations_in(&self, loaded: &Loaded, name: &[u8]) -> bool {
        loaded.flavor == Flavor::Oxlint
            && !self.has_one_configuration()
            && !self.options.disable_nested_config
            && !matches!(name, b".git" | b".jj")
    }

    /// Whether `loaded` is what a directory without a configuration file has in a run for an `eslint.config.*`. ESLint has none
    /// for a file there, which ends the run. For a directory there it has one without a file, whose base path is the working
    /// directory: what is not in that is ignored.
    pub(crate) fn lacks_file_of_eslint(&self, loaded: &Loaded) -> bool {
        let has_one = || {
            let is_there = |it: &[u8]| self.names().any(|name| fs::is_file(&paths::join(it, name)));
            self.tool() == Some(Flavor::Eslint) && paths::ancestors(self.cwd()).any(is_there)
        };
        loaded.flavor == Flavor::BuiltIn && *self.has_file_of_eslint.get_or_init(has_one)
    }

    /// Returns true if the closest package.json that [lists dependencies](depends_on_react), from `directory` up, has React.
    /// Only the built-in defaults care, so this is always false with an ESLint or oxlint config.
    pub(crate) fn is_of_react(&self, loaded: &Loaded, directory: &[u8]) -> bool {
        if loaded.flavor != Flavor::BuiltIn {
            return false;
        }
        if let Some(known) = self.of_react.lock().get(directory) {
            return *known;
        }
        let found = paths::ancestors(directory).find_map(depends_on_react) == Some(true);
        self.of_react.lock().insert(directory.to_vec(), found);
        found
    }

    /// Resolves the config for one file. Use this instead of `loaded.config.get()`, which doesn't know about React projects.
    pub(crate) fn config_of(&self, loaded: &Loaded, path: &[u8]) -> FileConfig {
        match loaded.config.get(self.linter.registry(), path) {
            FileConfig::Matched(config) if !self.is_of_react(loaded, paths::dirname(path)) => {
                FileConfig::Matched(config.outside_of_react())
            }
            config => config,
        }
    }

    /// Whether the rules that need types run on a file that has `config`, which is from `loaded`.
    pub(crate) fn wants_types(&self, loaded: &Loaded, config: &ResolvedConfig) -> bool {
        // With no config file and no flag, the rules decide. A rule that only uses types when they're available isn't a
        // reason to type check.
        if loaded.flavor == Flavor::BuiltIn && self.options.type_aware.is_none() {
            return self.options.type_check || config.language.has_rule_that_requires_types;
        }
        // oxlint reads `options` in the configuration of the working directory only.
        let of_the_run = || {
            let root = self.for_directory(self.cwd()).ok()?;
            root.wants_types
                .filter(|_| root.flavor == Flavor::Oxlint && loaded.flavor == Flavor::Oxlint)
        };
        self.options
            .type_aware
            .or_else(|| *self.wants_types.get_or_init(of_the_run))
            .or(loaded.wants_types)
            .unwrap_or(config.language.wants_types)
    }

    /// Whether `.gitignore` counts for what has the configuration `loaded`.
    pub(crate) fn reads_ignore_files(&self, loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint || (loaded.flavor == Flavor::BuiltIn && self.options.ignore)
    }

    /// Where the patterns start in the file that `--ignore-path`, or `ignorePath` of bunfig.toml, names.
    fn start_of_ignore_path(&self) -> Vec<u8> {
        match self.options.ignore_file_name_of_bunfig {
            Some(_) => self.start_of_bunfig(),
            None => self.cwd().to_vec(),
        }
    }

    /// The name of the files that count in every directory beside `.gitignore`. To oxlint, what `--ignore-path` has is such a
    /// name.
    pub(crate) fn ignore_file_name(&self, loaded: &Loaded) -> Option<&[u8]> {
        match &self.options.ignore_path {
            _ if !self.options.ignore => None,
            None => Some(b".eslintignore"),
            Some(name) => (loaded.flavor == Flavor::Oxlint).then_some(
                self.options
                    .ignore_file_name_of_bunfig
                    .as_ref()
                    .unwrap_or(name),
            ),
        }
    }

    /// Whether a file that is an argument is left out all the same, as by oxlint: `.eslintignore`
    /// or `--ignore-path` has a pattern for it, or `--ignore-pattern` is one. `.gitignore` is not asked. `path`: where it is.
    pub(crate) fn ignores_named_file(&self, argument: &[u8], path: &[u8], loaded: &Loaded) -> bool {
        if loaded.flavor != Flavor::Oxlint {
            return false;
        }
        let is_in_file = self.ignore_file_name(loaded).is_some_and(|file| {
            let (start, file) = (self.start_of_ignore_path(), paths::from_native(file));
            // How it is spelled counts for oxlint. From below bunfig.toml it is spelled as from there.
            match start == self.cwd() {
                true => gitignore::has_argument(&start, &file, argument),
                false => gitignore::has_argument(&start, &file, &paths::relative(&start, path)),
            }
        });
        is_in_file || self.is_ignored_by_the_run(path, loaded)
    }

    /// The same for the name of what is read from standard input, about which the files are not asked.
    pub(crate) fn is_ignored_by_the_run(&self, path: &[u8], loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint
            && self.options.ignore
            && gitignore::is_ignored(&self.patterns_of_the_run(), path, false)
    }

    /// For oxlint `--ignore-pattern` is for the whole run, whatever configuration file is nearest.
    fn patterns_of_the_run(&self) -> gitignore::Chain {
        let mut chain = gitignore::Chain::default();
        for (start, patterns) in self.ignore_patterns() {
            chain = gitignore::with_lines(chain, &start, patterns.iter().map(|it| &it[..]));
        }
        chain
    }

    /// The ignore files that count in `directory`, where a search starts. `None`: oxlint does not search it, because those of
    /// Git have it. `are_all_in_repositories`: [`gitignore::are_all_in_repositories`] of the run.
    pub(crate) fn ignore_files_at(
        &self,
        directory: &[u8],
        loaded: &Loaded,
        are_all_in_repositories: impl FnOnce() -> bool,
    ) -> Option<Files> {
        if !self.reads_ignore_files(loaded) {
            return Some(Files::default());
        }
        let of_git = match OfGit::for_search(directory, are_all_in_repositories) {
            Some(of_git) => of_git,
            None if loaded.flavor == Flavor::Oxlint => return None,
            None => OfGit::above_and_in(directory, true),
        };
        let name = self.ignore_file_name(loaded).map(paths::from_native);
        let mut files = Files::above_and_in(directory, name.as_deref(), of_git);
        if !self.options.ignore {
            return Some(files);
        }
        if loaded.flavor == Flavor::Oxlint {
            // For oxlint `--ignore-pattern` is for the whole run, whatever configuration file is nearest.
            for (start, patterns) in self.ignore_patterns() {
                let lines = patterns.iter().map(|it| &it[..]);
                files.named = gitignore::with_lines(files.named, &start, lines);
            }
        } else if let Some(path) = &self.options.ignore_path {
            let path = paths::resolve(self.cwd(), &paths::from_native(path));
            let start = self.start_of_ignore_path();
            files.named = gitignore::with_file(files.named, &start, &path, true);
        }
        Some(files)
    }

    pub(crate) fn environment(&self) -> &'l Environment<'l> {
        self.environment
    }
}
