//! Finds and loads config files. This is ESLint's `ConfigLoader`.
//!
//! A file uses the closest config: walk up from the file's directory and stop at the first directory that has a file
//! named in [`NAMES`]. If a directory has several config files for the same tool, the one listed first in [`NAMES`]
//! wins. Configs are never merged.
//!
//! ESLint 8's files ([`eslintrc::NAMES`]) are only used if no directory on the way up has a file from [`NAMES`],
//! because neither ESLint nor oxlint reads them next to its own config. These are merged with the ones in parent
//! directories.
//!
//! A tool never reads another tool's config files. The config that applies to the working directory picks the tool, and
//! only that tool's files apply in subdirectories, because templates, fixtures and examples contain all sorts of
//! configs. If both an ESLint and an oxlint config apply there, oxlint's wins, because a project with both is migrating
//! to oxlint. If no config applies there, each subdirectory picks its tool the same way ([`Loader::tool_in`]), so a
//! package gets the same config as in a run started inside it.
//!
//! Only a config file, a dependency in package.json, `--config` or `--flavor` pick the tool. Other flags never do, with
//! one exception: `--no-eslintrc`, `--env` and `--rulesdir` only exist in ESLint 8, so without a config file they mean
//! an ESLint 8 run.

use crate::cli::{Options, Override, Tool, Wildcard, merge};
use crate::embedded::Framework;
use crate::gitignore::{self, Files, GitIgnores};
use crate::print_config::object;
use crate::run::{Environment, Fatal};
use crate::{Linter, eslintrc, evaluate, fs, native, paths, rulesdir};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{Configuration, Host, Route};
use bun_lint::language::InferGlobals;
use bun_lint::linter::config::json_for_oxlint;
use bun_lint::linter::{
    Config, FileConfig, LegacyFile, LegacyOptions, NamedPlugin, Registry, ResolvedConfig,
    ShadowedBuiltinPlugin, canonical_oxlint_plugin, formatting_rules, is_oxlint_plugin,
    oxlint_category_of_key, oxlint_filter_keys, oxlint_rule_key, parse_rule_id,
};
use bun_lint::options::Json;
use bun_lint::rule::{Frameworks, Plugin, minor_of};
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

/// Returns the nearest `package.json`, walking up from `directory`, that lists one of `tools` in `dependencies` or
/// `devDependencies`. The result is its path and one flag per tool. A `package.json` that lists none of them is
/// skipped, because a monorepo lists its tools in the root `package.json`.
pub(crate) fn package_that_depends_on<const N: usize>(
    directory: &[u8],
    tools: [&[u8]; N],
) -> Option<(Vec<u8>, [bool; N])> {
    paths::ancestors(directory).find_map(|directory| {
        let path = paths::join(directory, b"package.json");
        let json = bun_lint::json::parse(&fs::read(&path).ok()?)?;
        let has = tools.map(|name| {
            [&b"dependencies"[..], b"devDependencies"]
                .iter()
                .any(|it| json.get(it).is_some_and(|it| it.get(name).is_some()))
        });
        has.contains(&true).then_some((path, has))
    })
}

/// The installed version of the package that `specifier` names.
fn installed_version(directory: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
    let package = installed_package(directory, specifier)?;
    Some(package.get(b"version")?.as_str()?.to_vec())
}

/// Which tool's conventions apply: what's ignored by default, what a pattern means.
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
    /// JavaScript or TypeScript that has to be executed.
    Program,
    Json,
}

/// Configuration file names, in priority order.
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
/// `Reader::set_severity_by_kind`, for `$framework` and `$packageType` see `Config::get_with_frameworks`, for
/// `$withoutWarnings` see `Reader::without_warnings`, for `$sourceTypeBySyntax` and `$packageIsModule` see
/// `LanguageOptions::resolve_source_type`. The words `UNUSED_ON_PURPOSE` and `TEST_GLOBALS` are replaced with the
/// constants of that name, and the `basePath` `"PROJECT"` with the project's directory, so that a project in
/// `~/test/app` isn't all tests.
///
/// The first `rules` only sets options. With `$defaultOptions` they're the rules' default options in a project with no
/// config file: a later setting that's just a severity keeps them, and one with options is merged over them key by key,
/// as ESLint does with a rule's own `meta.defaultOptions`. That goes for the presets below, bunfig.toml, `--rule` and
/// `/* eslint */` comments.
///
/// `react/jsx-uses-react` reports nothing. In a file with JSX it keeps `no-unused-vars` quiet about `React`, or about
/// the `h` of a `@jsx h` comment. It's an error so that `--quiet` doesn't skip it.
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
    { "files": ["**/*.cts"], "languageOptions": { "sourceType": "commonjs" } },
    {
        "files": ["**/*.{js,jsx,ts,tsx}"],
        "ignores": ["**/*.d.ts"],
        "languageOptions": { "$sourceTypeBySyntax": true }
    },
    { "$packageType": "module", "languageOptions": { "$packageIsModule": true } },
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
        "$framework": "react",
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
    // Set here and not in the text, because a path can contain any character.
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
    Config::without_config_file(registry, b"/", &built_in_json(false, b"/"), Vec::new()).ok()
}

/// In a Vite+ project, the files whose `lint` and `fmt` fields are the oxlint and oxfmt configs, in priority order.
pub(crate) const VITE_CONFIG_NAMES: [&[u8]; 6] = [
    b"vite.config.ts",
    b"vite.config.mts",
    b"vite.config.cts",
    b"vite.config.js",
    b"vite.config.mjs",
    b"vite.config.cjs",
];

/// The error for a [`VITE_CONFIG_NAMES`] file passed with `--config` that has no `lint` field. A file found by lookup
/// is skipped instead.
const HAS_NO_LINT_FIELD: &[u8] = b"Expected a `lint` field in the default export of ";

fn has_no_lint_field(found: &Found) -> bool {
    matches!(found, Err(Fatal(why)) if why.starts_with(HAS_NO_LINT_FIELD))
}

/// True if a run in `cwd` emulates oxlint, as far as can be told without reading a configuration: by `--flavor`, or
/// else by which tool's file is nearest.
pub(crate) fn emulates_oxlint(flavor: Option<Tool>, cwd: &[u8]) -> bool {
    let file_exists = |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
    let mut directories = paths::ancestors(cwd);
    match flavor {
        Some(tool) => tool == Tool::Oxlint,
        // If both are in the same directory, oxlint's wins.
        None => directories
            .find_map(|directory| {
                let mut present = NAMES
                    .iter()
                    .filter(|it| file_exists(directory, it.0))
                    .peekable();
                present.peek()?;
                Some(present.any(|it| it.1 == Flavor::Oxlint))
            })
            .unwrap_or(false),
    }
}

/// The ESLint configuration file that applies in `cwd`: the nearest one, unless an oxlint config is as near or nearer.
pub(crate) fn eslint_config_file(cwd: &[u8]) -> Option<Vec<u8>> {
    paths::ancestors(cwd).find_map(|directory| {
        let file_exists = |name: &&[u8]| fs::is_file(&paths::join(directory, name));
        let names_for =
            |flavor: Flavor| NAMES.iter().filter(move |it| it.1 == flavor).map(|it| it.0);
        if names_for(Flavor::Oxlint).any(|it| file_exists(&it)) {
            return Some(None);
        }
        let mut names = names_for(Flavor::Eslint).chain(eslintrc::NAMES.iter().copied());
        let found = names.find(file_exists)?;
        let is_config = found != b"package.json" || eslintrc::has_eslintrc_file(directory);
        is_config.then(|| Some(paths::join(directory, found)))
    })?
}

/// True if the file at `path`, passed with `--config`, has fields that only an oxlint config has.
fn looks_like_oxlint_config(path: &[u8], pipes: &fs::NamedPipes) -> bool {
    let Some(json) = (pipes.read(path))
        .ok()
        .and_then(|it| bun_lint::json::parse(&it))
    else {
        return false;
    };
    let oxlint_only_keys: [&[u8]; 3] = [b"categories", b"jsPlugins", b"options"];
    let schema = json.get(b"$schema").and_then(Json::as_str);
    oxlint_only_keys.iter().any(|it| json.get(it).is_some())
        || schema.is_some_and(|it| strings::contains(it, b"oxlint"))
}

/// Result of [`read_frameworks`] for one package.json.
#[derive(Copy, Clone)]
pub(crate) struct PackageFrameworks {
    /// The [`Frameworks`] listed in `dependencies`, `devDependencies` or `peerDependencies`. `None` if the file has
    /// none of the three fields (a nested `{ "type": "module" }`, for example), so the caller should use the next
    /// package.json up. An empty `"dependencies": {}` is `Some`.
    listed: Option<Frameworks>,
    /// [`Frameworks::TYPE_MODULE`] or empty. The nearest package.json always decides this, as in Node and Bun's
    /// resolver.
    module_type: Frameworks,
}

/// Reads `directory/package.json`. Returns `None` if it doesn't exist or isn't a JSON object.
pub(crate) fn read_frameworks(directory: &[u8]) -> Option<PackageFrameworks> {
    let package = fs::read(&paths::join(directory, b"package.json")).ok()?;
    let package = bun_lint::json::parse(&package).filter(|it| it.as_object().is_some())?;
    let fields: [&[u8]; 3] = [b"dependencies", b"devDependencies", b"peerDependencies"];
    let fields: Vec<&Json> = fields.iter().filter_map(|it| package.get(it)).collect();
    let is_listed = |name: &str| fields.iter().any(|it| it.get(name.as_bytes()).is_some());
    let listed = Frameworks::PACKAGES.iter().filter(|it| is_listed(it.0));
    Some(PackageFrameworks {
        listed: (!fields.is_empty()).then(|| listed.map(|it| it.1).collect()),
        module_type: match package.get(b"type").and_then(Json::as_str) {
            Some(b"module") => Frameworks::TYPE_MODULE,
            _ => Frameworks::empty(),
        },
    })
}

/// Combines a directory's `own` [`read_frameworks`] result with its `parent` directory's frameworks. The closest
/// package.json wins, except that a package without a test runner inherits the one from above.
///
/// `is_repository_root`: [`gitignore::is_root`] of the directory. A test runner isn't inherited from outside the
/// repository, such as from a package.json in the home directory. Nothing else stops there: a submodule without a
/// package.json is still part of the React project around it.
pub(crate) fn inherit_frameworks(
    parent: Frameworks,
    own: Option<PackageFrameworks>,
    is_repository_root: bool,
) -> Frameworks {
    let module_type = own.map_or(parent & Frameworks::TYPE_MODULE, |it| it.module_type);
    let parent = match is_repository_root {
        true => parent - Frameworks::TEST_RUNNERS,
        false => parent,
    };
    let frameworks = match own.and_then(|it| it.listed) {
        // With both runners' plugins on, each problem would be reported twice.
        Some(own) if own.intersects(Frameworks::TEST_RUNNERS) => own,
        Some(own) => own | (parent & Frameworks::TEST_RUNNERS),
        None => parent,
    };
    (frameworks - Frameworks::TYPE_MODULE) | module_type
}

pub(crate) struct Loaded {
    pub(crate) config: Config,
    pub(crate) flavor: Flavor,
    /// The file it was loaded from. ESLint 8 merges several files, so there it's the closest one.
    pub(crate) file: Option<Vec<u8>>,
    /// `options.typeAware` in an `.oxlintrc.json`: whether the type-aware rules run, for all files. `None` means each
    /// file's configuration decides.
    pub(crate) wants_types: Option<bool>,
    /// `options.denyWarnings`
    pub(crate) denies_warnings: bool,
    /// `options.maxWarnings`
    pub(crate) max_warnings: Option<i64>,
    /// False for `options.respectEslintDisableDirectives: false`.
    pub(crate) respects_eslint_comments: bool,
    /// `options.typeCheck`
    pub(crate) checks_types: bool,
    /// With an `eslint.config.js`, if the `eslint` package is installed: the input for ESLint's own `Linter`.
    pub(crate) for_eslint: Option<ForEslint>,
}

/// The input for ESLint's own `Linter` that's the same for all files under one configuration file.
pub(crate) struct ForEslint {
    /// JSON: see `Host::lint_with_eslint`.
    pub(crate) run: Vec<u8>,
    /// For a file whose configuration has values that JSON can't represent.
    pub(crate) whole: Configuration,
}

impl Loaded {
    /// The [`Framework`] of the file at `path`, if its embedded scripts are what gets linted, as oxlint does.
    pub(crate) fn framework(&self, path: &[u8]) -> Option<Framework> {
        Framework::of(path).filter(|_| self.flavor == Flavor::Oxlint)
    }

    /// How the file at `path`, whose configuration is `config`, is linted. oxlint has no processors.
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
    /// Loads JavaScript plugins.
    js_plugins: &'l Host<'l>,
    /// The configuration for the files in each directory.
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// Keyed by the config file's path, which is empty for no file. Each file is read once, by the first thread that
    /// needs it.
    by_file: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Found>>>>,
    /// Warnings for the user, in the order they came up.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
    /// Things a configuration asks for that aren't supported, one line each: rules that don't exist here, files in a
    /// language that isn't parsed here. Silently doing less than the tool being replaced and finding no problems is
    /// worse than failing.
    pub(crate) unsupported: Guarded<Vec<Vec<u8>>>,
    /// Suggestions for the user, one line each. They aren't problems.
    pub(crate) advice: Guarded<Vec<Vec<u8>>>,
    /// [`eslintrc::uses_flat_config`]
    flat_config: Option<bool>,
    /// [`Loader::is_eslint_8_command_line`]
    is_legacy: OnceLock<bool>,
    /// [`rulesdir::load`], run once for all directories.
    rulesdir: OnceLock<Result<Json, Fatal>>,
    /// [`Loader::tool`]
    tool: OnceLock<Option<Flavor>>,
    /// [`Loader::ignored_eslint_config`]
    ignored_eslint_config: OnceLock<(Vec<u8>, Vec<u8>)>,
    /// [`Loader::ignored_eslint_configs_below`]
    ignored_eslint_configs_below: Guarded<Vec<(Vec<u8>, Vec<u8>)>>,
    /// Cache for [`Loader::has_oxlint_config`], keyed by directory.
    has_oxlint_config: Guarded<FxHashMap<Vec<u8>, bool>>,
    /// True if the working directory or one of its parents has an `eslint.config.*`, and ESLint is the run's tool.
    has_eslint_config_file: OnceLock<bool>,
    /// [`Loader::lacks_file`]
    lacks_file: OnceLock<bool>,
    /// [`Loader::name`]
    named: Guarded<Vec<Vec<u8>>>,
    /// [`Loader::refused`]
    refused: OnceLock<Vec<u8>>,
    /// [`Loader::mistake`]
    mistake: OnceLock<Vec<u8>>,
    /// The [built-in plugins](Loader::built_in_plugins) whose package is also installed, each with its `$jsPlugins`
    /// entry. The package provides the rules that aren't implemented here, and the ones that hand a file over to it.
    built_in_plugin_packages: Guarded<Vec<(Vec<u8>, Json)>>,
    /// `options.typeAware` from the working directory's configuration, if it's an oxlint config.
    wants_types: OnceLock<Option<bool>>,
    /// True for a Vite+ project without a linter config file, so the [`VITE_CONFIG_NAMES`] files are the ones that
    /// apply.
    is_vite_plus: OnceLock<bool>,
    /// The directories the file search started from, and the `tsconfig.json` and `jsconfig.json` files in the
    /// directories it listed, so `Inferred` doesn't have to hit the file system for them.
    pub(crate) searched_from: Guarded<Vec<Vec<u8>>>,
    pub(crate) tsconfigs: Guarded<Vec<Vec<u8>>>,
    /// Cache for [`Loader::detect_frameworks`], keyed by directory.
    frameworks: Guarded<FxHashMap<Vec<u8>, Frameworks>>,
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

/// `normalizePackageName(name, "eslint-plugin")`, or `None` if that's the same name.
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

/// True if an entry of `plugins` in bunfig.toml, or a `--plugin` value, is a path rather than a package name.
fn is_plugin_path(specifier: &[u8]) -> bool {
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

/// Rule settings from oxlint's `-A`, `-W` and `-D` (when they name a rule), then from ESLint's `--rule`. The oxlint
/// flags only set a severity, so the rule keeps whatever options it has.
fn rules_of(options: &Options, cwd: &[u8]) -> Vec<(Vec<u8>, Json)> {
    let filters = options.filters.iter();
    let filters = filters.filter(|it| !is_category(&it.1));
    let mut rules = Vec::new();
    for (severity, rule) in filters {
        merge(&mut rules, vec![(rule.clone(), severity_name(*severity))]);
    }
    merge(
        &mut rules,
        options.rebase_rule_paths(&options.rule, &options.bunfig_rules, false, cwd),
    );
    rules
}

/// `wildcards` as the value of [`native::WILDCARDS`].
fn wildcards_of(wildcards: &[Wildcard]) -> Json {
    let ids = wildcards.iter().map(|it| Json::String(it.id.clone()));
    Json::Array(ids.collect())
}

/// The config format to write an override in.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Shape {
    /// An object in an `eslint.config.js`.
    Flat,
    /// The same, in Bun's built-in config. It can have [`native::WILDCARDS`].
    Native,
    /// An entry of `overrides` in an `.oxlintrc.json`.
    Oxlint,
    /// The same in an `.eslintrc.json`.
    Legacy,
}

/// oxlint's `validateConfigExtends`: a config exported by a program can only extend objects it imported, not files.
fn check_program_extends(config: &Json) -> Result<(), Vec<u8>> {
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
            check_program_extends(item)?;
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
            let is_ignores =
                |key: &[u8]| matches!(key, b"ignores" | b"$ignorePatterns" | b"$gitignoreLines");
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

/// oxlint's rule categories, except `nursery`.
pub(crate) const CATEGORIES: [&[u8]; 6] = [
    b"correctness",
    b"suspicious",
    b"pedantic",
    b"perf",
    b"style",
    b"restriction",
];

/// True if oxlint's `-A`, `-W` and `-D` treat `name` as something other than a rule.
pub(crate) fn is_category(name: &[u8]) -> bool {
    CATEGORIES.contains(&name) || matches!(name, b"all" | b"nursery")
}

/// Collects the `rules` of every file that `json` extends. oxlint keeps the first setting it finds for a rule, and it
/// looks at the last entry of `extends` first, so that's the order here.
fn extended_rules(
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
        extended_rules(&file, &directory, load, into);
    }
}

/// True if `id` in an `.oxlintrc.json` refers to a JavaScript plugin's rule. `-A`, `-W` and `-D` never change those.
fn is_from_js_plugin(id: &[u8]) -> bool {
    let prefix = parse_rule_id(id).0;
    !prefix.is_empty() && Plugin::from_oxlint_prefix(&canonical_oxlint_plugin(prefix)).is_none()
}

/// Applies oxlint's `-A`, `-W` and `-D` in order. They apply after the `rules` of the file and of the files it extends
/// (`inherited`, from [`extended_rules`]), and before its `overrides`. A category covers all of its rules, including
/// those listed in `rules`.
fn apply_filters(
    entries: &mut Vec<(Vec<u8>, Json)>,
    filters: &[(Severity, Vec<u8>)],
    inherited: &[(Vec<u8>, Json)],
) {
    type Entries = Vec<(Vec<u8>, Json)>;
    /// The file's `name` object, created if it's missing.
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
    /// Sets the severity of the entries that `is_target` matches, and adds an entry for `key` if there are none.
    /// Options are kept unless the rule is turned off. oxlint drops the rule in that case, so `-A eqeqeq -D eqeqeq`
    /// ends up with the default options.
    fn put(
        section: Option<&mut Entries>,
        key: &[u8],
        severity: Severity,
        is_target: impl Fn(&[u8]) -> bool,
    ) {
        let Some(section) = section else {
            return;
        };
        let mut is_found = false;
        for (_, value) in section.iter_mut().filter(|it| is_target(&it.0)) {
            is_found = true;
            match value {
                Json::Array(items) if !items.is_empty() && severity != Severity::Off => {
                    items[0] = severity_name(severity);
                }
                value => *value = severity_name(severity),
            }
        }
        if !is_found && !key.is_empty() {
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
    let file_categories = entries.iter().find(|it| it.0 == b"categories");
    let file_categories =
        file_categories.map_or_else(|| Json::Object(Vec::new()), |it| it.1.clone());
    if !filters.is_empty() {
        entries.push((b"$categoriesOfTheFile".to_vec(), file_categories));
    }
    // oxlint merges the files first, so a flag changes an inherited rule like one of the file's own, and the options
    // stay.
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
                    is_from_js_plugin(&it.0) || has_key(inherited, &oxlint_rule_key(&it.0))
                });
                put(Some(own), b"", Severity::Off, |it| !is_from_js_plugin(it));
            }
            CATEGORIES
                .iter()
                .for_each(|category| put_category(entries, category, *severity));
        } else if CATEGORIES.contains(&&name[..]) || name == b"nursery" {
            put_category(entries, name, *severity);
        } else if !is_from_js_plugin(name) {
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
            ignored_eslint_config: OnceLock::new(),
            ignored_eslint_configs_below: Default::default(),
            has_oxlint_config: Default::default(),
            has_eslint_config_file: OnceLock::new(),
            lacks_file: OnceLock::new(),
            named: Default::default(),
            refused: OnceLock::new(),
            mistake: OnceLock::new(),
            built_in_plugin_packages: Guarded::new(Vec::new()),
            wants_types: OnceLock::new(),
            is_vite_plus: OnceLock::new(),
            searched_from: Default::default(),
            tsconfigs: Default::default(),
            frameworks: Default::default(),
        }
    }

    /// True if anything reads `searched_from` and `tsconfigs`, which only `InferGlobals::ByOptions` does.
    pub(crate) fn collects_tsconfigs(&self) -> bool {
        self.options.infer_globals.is_none() && self.options.infers_globals_by_options
    }

    /// A loader that reads ESLint 8's configuration files, whatever else exists.
    pub(crate) fn for_eslint_8(
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

    /// Adds a line of [`Config::advice`]. "<package> <version> is installed, but .. match <ours>" has the version from
    /// the plugin's `meta.version`, which can be stale: eslint-plugin-react-hooks 7.1.1 says 7.0.0. The version in its
    /// package.json is used instead.
    fn advise_if_true(&self, line: &[u8], directory: &[u8]) {
        let words: Vec<&[u8]> = strings::split(line, b" ").collect();
        if let [package, claimed, .., b"match", ours] = words[..]
            && let Some(installed) = installed_version(directory, package)
            && installed != claimed
        {
            if minor_of(&installed) < minor_of(ours) {
                self.advise(
                    [
                        package,
                        b" ",
                        &installed,
                        &line[package.len() + 1 + claimed.len()..],
                    ]
                    .concat(),
                );
            }
            return;
        }
        self.advise(line.to_vec());
    }

    /// Adds advice if the project's `typescript` is older than the version whose behavior the type checker follows. It
    /// reads one file.
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

    /// Adds advice about rules that ran in JavaScript even though they're built in. `sources` has, for each plugin in
    /// `jsPlugins`, its prefix, the directory of the file that lists it, and its specifier.
    fn advise_about_js_plugins(&self, config: &Config, sources: &[(Box<[u8]>, Vec<u8>, Vec<u8>)]) {
        for ShadowedBuiltinPlugin {
            prefix,
            plugin,
            built_in,
            others,
        } in config.shadowed_builtin_plugins(self.linter.registry())
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
            // `plugins` doesn't accept the name of a plugin that's always on.
            line.extend_from_slice(&match (others, plugin.is_always_available()) {
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
    pub(crate) fn add_unsupported(&self, parts: &[&[u8]]) {
        let line = parts.concat();
        let mut unsupported = self.unsupported.lock();
        if !unsupported.contains(&line) {
            unsupported.push(line);
        }
    }

    fn cwd(&self) -> &[u8] {
        &self.environment.cwd
    }

    /// True if every file uses the same configuration, wherever it is.
    fn has_one_configuration(&self) -> bool {
        self.options.config.is_some() || !self.options.config_lookup
    }

    /// True if a configuration file other than the working directory's has been read. In that case oxlint doesn't print
    /// the number of rules.
    pub(crate) fn has_nested_configurations(&self) -> bool {
        // The empty key is the built-in configuration, which `lacks_file` loads only to compare with.
        let by_file = self.by_file.lock();
        by_file.keys().filter(|it| !it.is_empty()).count() > 1
    }

    /// [`Options::bunfig_base_directory`]
    fn bunfig_base_directory(&self) -> Vec<u8> {
        self.options.bunfig_base_directory(self.cwd())
    }

    /// The directory that patterns are relative to in the file passed with `--config` or set as `config` in
    /// bunfig.toml.
    fn named_config_base_directory(&self) -> Vec<u8> {
        match self.options.config_is_from_bunfig {
            true => self.bunfig_base_directory(),
            false => self.cwd().to_vec(),
        }
    }

    /// bunfig.toml's `ignorePatterns` and the `--ignore-pattern` values, each with the directory they're relative to.
    fn ignore_patterns(&self) -> [(Vec<u8>, &[Vec<u8>]); 2] {
        let all = &self.options.ignore_pattern;
        let (bunfig_patterns, flag_patterns) =
            all.split_at(self.options.bunfig_ignore_pattern_count.min(all.len()));
        [
            (self.bunfig_base_directory(), bunfig_patterns),
            (self.cwd().to_vec(), flag_patterns),
        ]
    }

    /// Writes `[[lint.overrides]]` as config objects in the given `shape`. The command line's rules and globals go
    /// last, as one more override that matches every file. `base_path` is what the config resolves patterns against,
    /// unless an override says otherwise.
    fn overrides(&self, shape: Shape, base_path: &[u8]) -> Vec<Json> {
        let text = |it: &[u8]| Json::String(it.to_vec());
        let start = self.bunfig_base_directory();
        let write = |it: &Override| {
            let mut entries = vec![(&b"files"[..], strings_of(&it.files))];
            if !it.excluded.is_empty() {
                let key: &[u8] = match shape {
                    Shape::Flat | Shape::Native => b"ignores",
                    Shape::Oxlint => b"excludeFiles",
                    Shape::Legacy => b"excludedFiles",
                };
                entries.push((key, strings_of(&it.excluded)));
            }
            // Tells each config reader to parse the patterns as Bun's globs instead of its own tool's.
            entries.push((b"$globsOfBun", Json::Bool(true)));
            match shape {
                _ if base_path == start => {}
                Shape::Flat | Shape::Native => entries.push((b"basePath", text(&start))),
                Shape::Oxlint => entries.push((b"$basePath", text(&start))),
                // See `legacy_config`.
                Shape::Legacy => {}
            }
            if !it.rules.is_empty() {
                let is_oxlint = shape == Shape::Oxlint;
                let rules = (self.options).rebase_rule_paths(
                    &it.rules,
                    &it.rule_locations,
                    is_oxlint,
                    self.cwd(),
                );
                entries.push((b"rules", Json::Object(rules)));
            }
            if shape == Shape::Native && !it.wildcards.is_empty() {
                entries.push((native::WILDCARDS, wildcards_of(&it.wildcards)));
            }
            match (it.globals.is_empty(), Json::Object(it.globals.clone())) {
                (true, _) => {}
                (false, globals) if matches!(shape, Shape::Flat | Shape::Native) => {
                    entries.push((b"languageOptions", object(vec![(b"globals", globals)])));
                }
                (false, globals) => entries.push((b"globals", globals)),
            }
            if !it.settings.is_empty() {
                entries.push((b"settings", Json::Object(it.settings.clone())));
            }
            object(entries)
        };
        let from_args = self.options.command_line_options.as_deref();
        let last = from_args.map(|from_args| Override {
            files: vec![b"**/*".to_vec()],
            rules: rules_of(from_args, self.cwd()),
            wildcards: from_args.wildcards.clone(),
            globals: (globals_of(from_args).and_then(Json::into_object)).unwrap_or_default(),
            ..Override::default()
        });
        let is_empty =
            |it: &Override| it.rules.is_empty() && it.globals.is_empty() && it.wildcards.is_empty();
        let last = last.filter(|it| !is_empty(it));
        let all = self.options.overrides.iter().chain(&last);
        let mut override_objects: Vec<Json> = all.map(write).collect();
        // The last one matches every file, even outside bunfig.toml's directory. The built-in config's base path is
        // `/`.
        if shape == Shape::Native
            && last.is_some()
            && let Some(Json::Object(entries)) = override_objects.last_mut()
        {
            entries.retain(|it| it.0 != b"basePath");
        }
        override_objects
    }

    /// ESLint's `overrideConfig`, as `translateOptions` builds it from the command line. `shape` is [`Shape::Flat`] or
    /// [`Shape::Native`].
    fn override_config(&self, base_path: &[u8], shape: Shape) -> Vec<Json> {
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
        if shape == Shape::Native && !options.wildcards.is_empty() {
            first.push((native::WILDCARDS, wildcards_of(&options.wildcards)));
        }
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
            // The rest are handled by `named_plugins`. The value is the package name, which is how the built-in rules
            // recognize their plugin.
            let plugins = self.built_in_plugins(Flavor::Eslint).map(|name| {
                let long = plugin_longhand(name).unwrap_or_else(|| name.clone());
                (plugin_shorthand(name), Json::String(long))
            });
            first.push((b"plugins", Json::Object(plugins.collect())));
            let packages = self.built_in_plugin_packages.lock().clone();
            if !packages.is_empty() {
                first.push((b"$jsPlugins", Json::Object(packages)));
            }
        }
        let mut all = vec![object(first)];
        all.extend(self.overrides(shape, base_path));
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

    /// The objects that ESLint's `calculateConfigArray` appends to a configuration file's exports. For `shape`, see
    /// [`Loader::override_config`].
    fn added(&self, base_path: &[u8], shape: Shape) -> Vec<Json> {
        let mut added = Vec::new();
        // Without a config file, bunfig.toml's patterns are `.gitignore` lines, as they are with every config file but an
        // `eslint.config.*`.
        let bunfig_key: &[u8] = match shape {
            Shape::Native => b"$gitignoreLines",
            _ => b"ignores",
        };
        let keys = [bunfig_key, b"ignores"];
        for ((start, patterns), key) in self.ignore_patterns().into_iter().zip(keys) {
            if !patterns.is_empty() {
                added.push(object(vec![
                    (b"basePath", Json::String(start)),
                    (key, strings_of(patterns)),
                ]));
            }
        }
        added.extend(self.override_config(base_path, shape));
        added
    }

    /// `file` is the configuration file, if any, with its parsed config. Returns `None` if the `eslint` package isn't
    /// installed.
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
        // Not every project has it in a parent of the configuration file. It's always next to the parser and plugins,
        // since it's their peer dependency.
        let modules = file.into_iter().flat_map(|it| it.1.modules());
        let file = file.map(|it| it.0);
        let from = std::iter::once(file.map_or_else(|| self.cwd(), paths::dirname))
            .chain(modules.map(paths::dirname))
            .find(is_found_from)?;
        let options = self.options;
        let native = |path: &[u8]| Json::String(paths::to_native(path.to_vec()));
        let only_errors = options.quiet && options.max_warnings == -1;
        let about_layout = formatting_rules().map(|it| Json::String(it.into()));
        let mut added: Vec<Json> = Self::named_plugins_object(named).into_iter().collect();
        added.extend(self.added(base_path, Shape::Flat));
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

    /// ESLint's `calculateConfigArray`. `file_config` is what the config file exports. `is_eslint_config` is false if
    /// that's Bun's built-in config instead. `named` comes from [`Loader::named_plugins`].
    fn flat(
        &self,
        base_path: &[u8],
        file_config: Json,
        is_eslint_config: bool,
        named: Vec<NamedPlugin>,
    ) -> Result<Config, Fatal> {
        let mut all = vec![file_config];
        // `built_in` has already added these.
        if is_eslint_config {
            all.extend(Self::named_plugins_object(&named));
            all.extend(self.added(base_path, Shape::Flat));
        }
        let mut all = Json::Array(all);
        if !self.options.ignore {
            all = without_global_ignores(all);
        }
        let mut load_plugin =
            |location: &Json, prefix: &[u8]| self.js_plugins.load_located(location, prefix);
        let registry = self.linter.registry();
        let mut config = match is_eslint_config {
            true => Config::from_flat_json_with_plugins(
                registry,
                base_path,
                &all,
                &mut load_plugin,
                named,
            ),
            false => Config::without_config_file(registry, base_path, &all, named),
        }
        .map_err(|error| Fatal(error.message))?;
        let installed = installed_version(base_path, b"eslint");
        if installed.is_some_and(|it| minor_of(&it).is_some_and(|it| it.0 < 10)) {
            config.follow_eslint(9);
        }
        config.infer_globals(self.infers_globals_besides());
        Ok(config)
    }

    /// The [`LanguageOptions::infers_globals`](bun_lint::language::LanguageOptions) value to use with a configuration
    /// file.
    fn infers_globals_besides(&self) -> InferGlobals {
        match self.options.infer_globals {
            Some(true) => InferGlobals::Besides,
            _ => InferGlobals::No,
        }
    }

    /// Builds the config from an `.oxlintrc.json` plus what the command line adds.
    fn rc(&self, path: &[u8], mut json: Json) -> Result<Config, Fatal> {
        let options = self.options;
        let mut load = |directory: &[u8], name: &[u8]| {
            // It counts as a path if it looks like one, meaning it has an extension. oxlint doesn't resolve package
            // names.
            let has_extension = strings::last_index_of_char(paths::basename(name), b'.') > Some(0);
            if !name.starts_with(b".") && !paths::is_absolute(name) && !has_extension {
                return None;
            }
            bun_lint::json::parse_like_oxlint(&fs::read(&paths::resolve(directory, name)).ok()?)
        };
        let mut inherited = Vec::new();
        if !options.filters.is_empty() {
            extended_rules(&json, paths::dirname(path), &mut load, &mut inherited);
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
                let locations = &options.bunfig_rules;
                let rules = options.rebase_rule_paths(&options.rule, locations, true, self.cwd());
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
            // Flags take precedence.
            let flag_switches = options.plugins.iter().map(|it| (it.0.to_vec(), it.1));
            let switches: Vec<(Vec<u8>, bool)> = turned_on.chain(flag_switches).collect();
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
                        it.as_str().map(canonical_oxlint_plugin)
                            != Some(canonical_oxlint_plugin(name))
                    });
                    if *is_on {
                        plugins.push(Json::String(name.clone()));
                    }
                }
                entries.retain(|it| it.0 != b"plugins");
                entries.push((b"plugins".to_vec(), Json::Array(plugins)));
            }
            let file_severity = (entries.iter().find(|it| it.0 == b"options"))
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
                    .or(file_severity),
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
            let is_same_plugin = |it: &&NamedPlugin| {
                alias == Some(&it.0.name[..])
                    && it.1.get(b"module").and_then(Json::as_str) == Some(specifier)
            };
            if let Some(known) = named.iter().find(is_same_plugin) {
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
        // Patterns are relative to the file's directory.
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

    /// Loads the plugins listed in bunfig.toml's `plugins` and in `--plugin`. They're added to whatever configuration
    /// is used.
    fn named_plugins(&self, flavor: Flavor) -> Result<Vec<NamedPlugin>, Fatal> {
        let checked = self.load_named_plugins(flavor).and_then(|plugins| {
            // Problems with their rules in bunfig.toml are reported against bunfig.toml. ESLint 8 is more lenient than
            // the others: it accepts any options for a rule without a schema, and it reports a rule that doesn't exist
            // as a lint message.
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
            let bunfig_entry = options.bunfig_plugins.get(at);
            // ESLint 8 has its own `--plugin`, which takes names.
            if flavor == Flavor::EslintRc && bunfig_entry.is_none() && !is_plugin_path(specifier) {
                continue;
            }
            let mistake =
                |message: Vec<u8>| native::Mistake::new(message, bunfig_entry.map(|it| it.at));
            let is_built_in = |name: &[u8]| self.is_built_in(flavor, name);
            // `a/b/rule` would be the rule `b/rule` of `a`.
            let is_name = |name: &[u8]| {
                let slashes = strings::count_char(name, b'/');
                !name.is_empty()
                    && slashes <= usize::from(name.starts_with(b"@"))
                    && !strings::contains_char(name, b':')
            };
            let is_path = is_plugin_path(specifier);
            // As with ESLint, `perfectionist` means eslint-plugin-perfectionist.
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
            let alias = bunfig_entry.and_then(|it| it.alias.as_deref());
            let short = plugin_shorthand(specifier);
            if specifier.is_empty() || short.is_empty() {
                let message = b"A plugin needs a specifier\n  A path, or the name of a package";
                return Err(mistake(message.to_vec()));
            }
            // A path in bunfig.toml is relative to that file.
            let bunfig_path = paths::resolve(self.cwd(), &self.options.bunfig);
            let bunfig_directory = paths::dirname(&bunfig_path);
            let directory = bunfig_entry.map_or_else(|| self.cwd(), |_| bunfig_directory);
            // The plugin itself is missing, not a package it depends on.
            let is_missing = |why: &[u8], name: &[u8]| {
                strings::contains(why, &[b"Cannot find module '", name, b"'"].concat())
            };
            // The package is installed, but the entry point in its package.json doesn't exist.
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
            // Checked by name before anything is resolved, because `plugins = ["react"]` is how oxlint turns it on.
            if !is_path && is_built_in(alias.unwrap_or(&short)) {
                let has_rules = Plugin::spelled(&short).any(|it| !it.has_no_rules());
                match (flavor, alias) {
                    (_, Some(alias)) => return Err(built_in(alias)),
                    // All its rules are available anyway. A configuration file in a subdirectory may need it.
                    (Flavor::BuiltIn, None) => continue,
                    (Flavor::Oxlint, None) if !has_rules => return Err(built_in(&short)),
                    // It turns the plugin on, as `plugins` in the file would. See `built_in_plugins`.
                    (Flavor::Eslint, None) => {
                        // It's loaded lazily, when one of its rules is needed.
                        match self.js_plugins.resolve(directory, package) {
                            Ok(file) => {
                                let mut packages = self.built_in_plugin_packages.lock();
                                if !packages.iter().any(|it| it.0 == short) {
                                    let location = object(vec![
                                        (b"module", Json::String(file)),
                                        (b"export", strings_of(&[b"default".to_vec()])),
                                    ]);
                                    packages.push((short, location));
                                }
                            }
                            // The rule hands many files over to the package.
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
            // ESLint names a plugin after the flag's value.
            let name_from_flag =
                (flavor == Flavor::Eslint && bunfig_entry.is_none() && !is_path && is_name(&short))
                    .then_some(&short[..]);
            let load = |name: &[u8]| {
                self.js_plugins
                    .load(directory, name, alias.or(name_from_flag))
            };
            // Try the long name first, because `vue` isn't eslint-plugin-vue. A package that exists but fails to load
            // isn't skipped.
            let (loaded, found_as) = match (&file, &long) {
                (Some(file), _) => (load(file), &file[..]),
                (None, None) => (load(specifier), &specifier[..]),
                (None, Some(long)) => match load(long) {
                    Err(why) if is_missing(&why, long) => match load(specifier) {
                        // Its rules are available with every configuration, unless one of the project's packages
                        // shadows them.
                        Err(why)
                            if is_missing(&why, specifier)
                                && Plugin::spelled(&short).any(Plugin::is_always_available) =>
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
                        Ok(other) if other.has_no_plugin_properties => {
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
            // Same shape as for a plugin imported by a configuration file.
            let location = plugin.location.clone().unwrap_or_else(|| {
                object(vec![
                    (b"module", Json::String(found_as.to_vec())),
                    (b"export", Json::Array(Vec::new())),
                ])
            });
            match plugins.iter().find(|it| it.0.name == plugin.name) {
                None => plugins.push((plugin, location)),
                // Listed twice, once by `--plugin`.
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

    /// True if, with a `flavor` configuration, the built-in rules implement the plugin called `name`, so no package is
    /// loaded.
    fn is_built_in(&self, flavor: Flavor, name: &[u8]) -> bool {
        match flavor {
            // With ESLint the other plugins are ordinary packages. So are these under `--no-native-plugin-rules`.
            Flavor::Eslint | Flavor::EslintRc => {
                Plugin::is_native_under_eslint(name) && self.linter.registry().replaces_plugin(name)
            }
            // oxlint reserves the names jsdoc and vue, though those rules aren't implemented here.
            Flavor::Oxlint => is_oxlint_plugin(name),
            Flavor::BuiltIn => Plugin::spelled(name).any(|it| !it.has_no_rules()),
        }
    }

    /// The entries of bunfig.toml's `plugins` and of `--plugin` that are [built in](Loader::is_built_in), so they
    /// aren't loaded. With a configuration file, they work like entries of the file's `plugins`.
    fn built_in_plugins(&self, flavor: Flavor) -> impl Iterator<Item = &Vec<u8>> {
        let is_built_in = move |name: &[u8]| self.is_built_in(flavor, name);
        let options = self.options;
        let aliased = |at: usize| {
            options
                .bunfig_plugins
                .get(at)
                .is_some_and(|it| it.alias.is_some())
        };
        (options.plugin.iter().enumerate())
            .filter(move |it| !aliased(it.0) && is_built_in(&plugin_shorthand(it.1)))
            .map(|it| it.1)
    }

    /// The config object that declares `named`, for an ESLint configuration, where a rule's plugin has to be declared
    /// in some object.
    fn named_plugins_object(named: &[NamedPlugin]) -> Option<Json> {
        let entries = |to_json: &dyn Fn(&NamedPlugin) -> Json| {
            Json::Object(
                named
                    .iter()
                    .map(|it| (it.0.name.to_vec(), to_json(it)))
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

    /// Saves `mistake` in its printed form, with the bunfig.toml line it's about.
    fn fatal(&self, mistake: native::Mistake) -> Fatal {
        let colors = self.environment.stderr.colors;
        let printed = mistake.print(self.cwd(), &self.options.bunfig, colors);
        let _ = self.mistake.set(printed);
        Fatal(mistake.message)
    }

    fn built_in(&self) -> Found {
        // oxlint's behavior without a config file.
        if self.uses_oxlint_defaults() {
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
        // The repository first, so that a file gets the same answer from every directory in it, even from a `test`
        // folder that has its own package.json.
        let has_package = |it: &&[u8]| fs::is_file(&paths::join(it, b"package.json"));
        let project = paths::ancestors(self.cwd())
            .find(|it| gitignore::is_root(it))
            .or_else(|| paths::ancestors(self.cwd()).find(has_package))
            .unwrap_or_else(|| self.cwd());
        // The base path is `/`, which contains every file on any drive.
        let mut objects = vec![built_in_json(
            self.options.type_aware == Some(true),
            project,
        )];
        let mut user_objects = native::categories(self.linter.registry(), self.options);
        user_objects.extend(self.added(b"/", Shape::Native));
        let user_objects = self.split_pairs(user_objects);
        objects.extend(native::expand_wildcards(
            self.linter.registry(),
            &plugins,
            user_objects,
        ));
        let mut config = self.flat(b"/", Json::Array(objects), false, plugins)?;
        // On by default when the run has types anyway, since then it costs nothing extra.
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

    /// Reads the configuration file at `path`. `base_path` is what a flat configuration's patterns are relative to.
    fn read(&self, path: &[u8], base_path: &[u8]) -> Found {
        let name = paths::basename(path);
        let is_vite_plus = VITE_CONFIG_NAMES.contains(&name);
        let known = (NAMES.iter().find(|it| it.0 == name).map(|it| (it.1, it.2)))
            .or_else(|| is_vite_plus.then_some((Flavor::Oxlint, Syntax::Program)));
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
                let text = self.options.pipes.read(path).map_err(|error| {
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
                    // A file with any other name is oxlint's if it's an object.
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
        if is_vite_plus && json == Json::Null {
            return Err(Fatal([HAS_NO_LINT_FIELD, path].concat()));
        }
        // A file with any other name is classified by its content.
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
                check_program_extends(&json).map_err(|why| cannot_use(&why))?;
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
                .map_err(|Fatal(why)| Fatal(self.prefix_with_source(Some(path), &why)))?
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
        let option = |name: &[u8]| config.oxlintrc_option(name);
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

    /// Warns once per plugin, listing every rule of it that `config` sets and Bun doesn't have. `file` is the config
    /// file.
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
            let hint = match Plugin::from_oxlint_prefix(plugin).is_some_and(Plugin::has_no_rules) {
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
            self.add_unsupported(&[
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

    /// The configuration from the file at `path`. An empty `path` means the built-in configuration or, under
    /// `--no-config-lookup`, an empty one.
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

    /// The tool whose config files apply: `--flavor`, or else the tool whose config applies to the working directory.
    /// `None` if no config applies there.
    fn tool(&self) -> Option<Flavor> {
        *self.tool.get_or_init(|| {
            let options = self.options;
            let wanted = options.flavor.map(|it| match it {
                Tool::Eslint => Flavor::Eslint,
                Tool::Oxlint => Flavor::Oxlint,
            });
            let reads_flat = self.flat_config != Some(false);
            let file_exists =
                |directory: &[u8], name: &[u8]| fs::is_file(&paths::join(directory, name));
            let names = || {
                NAMES
                    .iter()
                    .filter(move |it| reads_flat || it.1 != Flavor::Eslint)
            };
            let found = paths::ancestors(self.cwd()).find_map(|directory| {
                let mut names = names().filter(|it| wanted.is_none_or(|wanted| wanted == it.1));
                let found = names.find(|it| file_exists(directory, it.0))?;
                Some((directory, found.0, found.1))
            });
            let config_flag_is_oxlint = (options.config.as_ref()).is_some_and(|it| {
                let path = paths::resolve(self.cwd(), &paths::from_native(it));
                looks_like_oxlint_config(&path, &options.pipes)
            });
            if wanted.is_none()
                && options.config.is_none()
                && let Some((oxlint_config, eslint_config)) = self.nearest_oxlint_config(self.cwd())
            {
                if let Some(eslint_config) = eslint_config {
                    let _ = self
                        .ignored_eslint_config
                        .set((eslint_config, oxlint_config));
                }
                return Some(Flavor::Oxlint);
            }
            if let Some((_, _, flavor)) = found {
                return Some(flavor);
            }
            let can_be_legacy =
                wanted == Some(Flavor::Eslint) || wanted.is_none() && !config_flag_is_oxlint;
            if can_be_legacy && paths::ancestors(self.cwd()).any(eslintrc::has_eslintrc_file) {
                return Some(Flavor::EslintRc);
            }
            let decided = wanted.or_else(|| config_flag_is_oxlint.then_some(Flavor::Oxlint));
            let from_package_json = self.tool_from_package_json(decided.is_some());
            decided.or(from_package_json)
        })
    }

    /// Returns the nearest oxlint config, walking up from `directory`, and the ESLint config that also applies there
    /// and is ignored, if any. Both paths are relative to the working directory.
    fn nearest_oxlint_config(&self, directory: &[u8]) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
        let nearest = |names: &mut dyn Iterator<Item = &'static [u8]>| {
            let names: Vec<&[u8]> = names.collect();
            paths::ancestors(directory).find_map(|directory| {
                let mut files = names.iter().map(|name| paths::join(directory, name));
                let found = files.find(|it| fs::is_file(it))?;
                Some(paths::relative(self.cwd(), &found))
            })
        };
        let oxlint_config = nearest(&mut self.config_names_for(Some(Flavor::Oxlint)))?;
        let legacy = eslintrc::NAMES.iter().filter(|it| **it != b"package.json");
        let eslint_config = nearest(&mut self.config_names_for(Some(Flavor::Eslint)))
            .or_else(|| nearest(&mut legacy.copied()));
        Some((oxlint_config, eslint_config))
    }

    /// True if `directory` or one of its ancestors has an oxlint config. Only called when [`Loader::tool`] is `None`.
    fn has_oxlint_config(&self, directory: &[u8]) -> bool {
        if let Some(known) = self.has_oxlint_config.lock().get(directory) {
            return *known;
        }
        let mut names = self.config_names_for(Some(Flavor::Oxlint));
        let has_own_config = names.any(|name| fs::is_file(&paths::join(directory, name)));
        if has_own_config
            && let Some((oxlint_config, Some(eslint_config))) =
                self.nearest_oxlint_config(directory)
        {
            self.ignore_eslint_config_below(eslint_config, oxlint_config);
        }
        let parent = Some(paths::dirname(directory)).filter(|it| it.len() < directory.len());
        let has_config = has_own_config || parent.is_some_and(|it| self.has_oxlint_config(it));
        (self.has_oxlint_config.lock()).insert(directory.to_vec(), has_config);
        has_config
    }

    /// Returns the tool whose config files apply to files in `directory`. That's [`Loader::tool`], or else the tool
    /// that config files would pick in a run started in `directory`. `None` means there's no oxlint config, so ESLint
    /// and ESLint 8 configs apply.
    fn tool_in(&self, directory: &[u8]) -> Option<Flavor> {
        let oxlint_if_configured = || (self.has_oxlint_config(directory)).then_some(Flavor::Oxlint);
        self.tool().or_else(oxlint_if_configured)
    }

    fn ignore_eslint_config_below(&self, eslint_config: Vec<u8>, oxlint_config: Vec<u8>) {
        let mut all = self.ignored_eslint_configs_below.lock();
        if !all.iter().any(|it| it.0 == eslint_config) {
            all.push((eslint_config, oxlint_config));
        }
    }

    /// True if files without a config file get oxlint's defaults instead of Bun's.
    fn uses_oxlint_defaults(&self) -> bool {
        self.tool() == Some(Flavor::Oxlint)
    }

    /// Rejects a flag of another tool that can't work with a `flavor` config. `file` is the config file, if there is
    /// one.
    fn check_flags(&self, flavor: Flavor, file: Option<&[u8]>) -> Result<(), Fatal> {
        let Some((flag, tool_name)) = self.options.first_unsupported_flag(flavor) else {
            return Ok(());
        };
        let rejection = [
            &flag[..],
            b" is an ",
            tool_name,
            b" flag and has no effect here\n  ",
            &self.describe(flavor, file),
        ]
        .concat();
        Err(Fatal(self.refused.get_or_init(|| rejection).clone()))
    }

    /// A sentence that says which config a run uses: "This run uses .oxlintrc.json, an oxlint config."
    fn describe(&self, flavor: Flavor, file: Option<&[u8]>) -> Vec<u8> {
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
        [b"This run uses ", &uses[..]].concat()
    }

    /// Rejects `plugin/*` wildcards if `cwd_config`, the working directory's config, isn't Bun's own. Only native mode
    /// expands them, so they would do nothing. A config file in a nested directory isn't a reason to fail: the
    /// wildcards still apply to the rest of the project.
    pub(crate) fn check_wildcards(&self, cwd_config: &Loaded) -> Result<(), Fatal> {
        let Some(wildcard) = native::first_wildcard(self.options) else {
            return Ok(());
        };
        if cwd_config.flavor == Flavor::BuiltIn {
            return Ok(());
        }
        let message = [
            b"\"",
            &wildcard.id[..],
            b"\" only works with Bun's own lint config\n  ",
            &self.describe(cwd_config.flavor, cwd_config.file.as_deref()),
        ]
        .concat();
        Err(self.fatal(native::Mistake::new(message, wildcard.key_at)))
    }

    /// Prefixes `why`, ESLint's message about an invalid config, with a line that says where the mistake is. That's
    /// `file` (the config file), bunfig.toml or `--rule`.
    pub(crate) fn prefix_with_source(&self, file: Option<&[u8]>, why: &[u8]) -> Vec<u8> {
        // ESLint 9's wording first, then ESLint 8's.
        let is_about = |id: &[u8]| {
            let mentions = |before: &[u8]| strings::contains(why, &[before, id, b"\""].concat());
            mentions(b"Key \"rules\": Key \"")
                || why.starts_with(b"CLIOptions") && mentions(b"Configuration for rule \"")
        };
        let rule = self.options.rule.iter().position(|it| is_about(&it.0));
        let mut override_rules = self.options.overrides.iter().flat_map(|it| &it.rules);
        let locations = &self.options.bunfig_rules;
        let source = match (rule, file) {
            (Some(at), _) if locations.get(at).is_some_and(|it| it.setting.is_some()) => {
                self.options.bunfig.clone()
            }
            (None, _) if override_rules.any(|it| is_about(&it.0)) => self.options.bunfig.clone(),
            (Some(_), _) => b"--rule".to_vec(),
            (None, Some(file)) => paths::relative(self.cwd(), file),
            (None, None) => return why.to_vec(),
        };
        [b"Invalid config in ", &source[..], b"\n", why].concat()
    }

    /// The formatted error for an invalid rule setting in bunfig.toml or `--rule`. Only set when there's no config
    /// file.
    pub(crate) fn mistake(&self) -> Option<&[u8]> {
        self.mistake.get().map(Vec::as_slice)
    }

    /// The error [`Loader::check_flags`] failed with, if any. Neither tool has an exit code for it.
    pub(crate) fn refused(&self) -> Option<&[u8]> {
        self.refused.get().map(Vec::as_slice)
    }

    /// [`Loader::check_flags`] for the file `name` in `directory`. It's one of [`Loader::names`] and would apply if the
    /// command line weren't an ESLint 8 one.
    fn check_eslint_8_flags(&self, directory: &[u8], name: &[u8]) -> Result<(), Fatal> {
        if self.options.config.is_some() {
            return Ok(());
        }
        let flavor = (NAMES.iter().find(|it| it.0 == name)).map_or(Flavor::Oxlint, |it| it.1);
        self.check_flags(flavor, Some(&paths::join(directory, name)))
    }

    /// The tool to use when there's no configuration file: oxlint, if the nearest `package.json` that depends on either
    /// tool depends on oxlint. ESLint doesn't run without a configuration file. `is_decided` means the command line
    /// already picked the tool.
    fn tool_from_package_json(&self, is_decided: bool) -> Option<Flavor> {
        let (path, has_oxlint, has_eslint) = self.tools_in_package_json()?;
        if has_oxlint && has_eslint && !is_decided {
            self.warn(&[
                b"No config file found, and ",
                &paths::relative(self.cwd(), &path),
                b" depends on both eslint and oxlint\n  Using oxlint's defaults. Add a config file to change that.",
            ]);
        }
        has_oxlint.then_some(Flavor::Oxlint)
    }

    /// The nearest `package.json` that depends on either tool, whether it depends on oxlint (which also comes with
    /// Vite+), and whether it depends on ESLint.
    fn tools_in_package_json(&self) -> Option<(Vec<u8>, bool, bool)> {
        let (path, [has_oxlint, has_vite_plus, has_eslint]) =
            package_that_depends_on(self.cwd(), [b"oxlint", b"vite-plus", b"eslint"])?;
        if has_vite_plus {
            let _ = self.is_vite_plus.set(true);
        }
        Some((path, has_oxlint || has_vite_plus, has_eslint))
    }

    /// The ESLint config that is ignored and the oxlint config that is used, relative to the working directory. Set
    /// when both apply there and neither `--config` nor `--flavor` picked one.
    pub(crate) fn ignored_eslint_config(&self) -> Option<&(Vec<u8>, Vec<u8>)> {
        self.tool();
        self.ignored_eslint_config.get()
    }

    /// Returns the pairs described at [`Loader::ignored_eslint_config`] for subdirectories, sorted. Only filled when no
    /// config applies to the working directory, and only for directories the run has visited.
    pub(crate) fn ignored_eslint_configs_below(&self) -> Vec<(Vec<u8>, Vec<u8>)> {
        let mut all = self.ignored_eslint_configs_below.lock().clone();
        bun_lint::utils::sort::sort_unstable(&mut all);
        all
    }

    /// The [`NAMES`] that apply to this run.
    fn names(&self) -> impl Iterator<Item = &'static [u8]> {
        self.config_names_for(self.tool())
    }

    /// Returns the [`NAMES`] that `tool` reads. With `None` that's all of them, oxlint's first.
    fn config_names_for(&self, tool: Option<Flavor>) -> impl Iterator<Item = &'static [u8]> {
        let reads_flat = self.flat_config != Some(false);
        let is_vite_plus = tool == Some(Flavor::Oxlint) && self.is_vite_plus.get() == Some(&true);
        let names_for = move |flavor: Flavor| {
            let is_selected = tool.is_none_or(|tool| tool == flavor);
            NAMES.iter().filter(move |it| is_selected && it.1 == flavor)
        };
        let eslint_names = names_for(Flavor::Eslint).filter(move |_| reads_flat);
        let vite_names = VITE_CONFIG_NAMES.iter().filter(move |_| is_vite_plus);
        let names = names_for(Flavor::Oxlint).chain(eslint_names).map(|it| it.0);
        names.chain(vite_names.copied())
    }

    /// Picks the configuration file among `names`, the entries of `directory`, and also returns whether one of them
    /// could be an ESLint 8 file. ESLint asks the file system, so on a case-insensitive one `ESLint.config.js` is found
    /// as `eslint.config.js`. oxlint compares the names.
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
            // The caller checks the file system if this is true.
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

    /// The ESLint 9 or oxlint configuration file that lookup finds for the files in `directory`, as its directory and
    /// its name.
    fn found<'d>(&self, directory: &'d [u8]) -> Option<(&'d [u8], &'static [u8])> {
        paths::ancestors(directory).find_map(|directory| {
            let mut names = self.names();
            let name = names.find(|name| fs::is_file(&paths::join(directory, name)))?;
            Some((directory, name))
        })
    }

    /// True if the command line is an ESLint 8 one: either it has an ESLint 8-only flag and no other tool's file
    /// applies, or `--config` points to an ESLint 8 file.
    fn is_eslint_8_command_line(&self) -> bool {
        *self.is_legacy.get_or_init(|| {
            let options = self.options;
            let has_flag =
                !options.eslintrc || !options.env.is_empty() || !options.rulesdir.is_empty();
            let Some(path) = &options.config else {
                let emulates_oxlint = options.flavor == Some(Tool::Oxlint);
                return has_flag && !emulates_oxlint && self.found(self.cwd()).is_none();
            };
            if has_flag {
                return true;
            }
            // A file that could be either tool's is treated as oxlint's, whatever the working directory has.
            let path = paths::resolve(self.cwd(), &paths::from_native(path));
            eslintrc::is_eslintrc_file(&path, &options.pipes)
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
        // bunfig.toml's other plugins are handled by `named_plugins`.
        let count = options.bunfig_plugins.len();
        let built_in_from_bunfig = self.built_in_plugins(Flavor::EslintRc);
        let built_in_from_bunfig =
            built_in_from_bunfig.filter(|it| options.plugin[..count].contains(it));
        let names_from_flag = options.plugin[count..]
            .iter()
            .filter(|it| !is_plugin_path(it));
        let names: Vec<Vec<u8>> = built_in_from_bunfig
            .chain(names_from_flag)
            .cloned()
            .collect();
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

    /// The ESLint 8 configuration for the files in `directory`, which has an ESLint 8 file. `None` means there's no
    /// such file.
    fn legacy(&self, directory: Option<&[u8]>) -> Found {
        let key = [directory.unwrap_or_default(), b"\0"].concat();
        let slot = Arc::clone(self.by_file.lock().entry(key).or_default());
        slot.get_or_init(|| self.read_legacy(directory)).clone()
    }

    fn read_legacy(&self, directory: Option<&[u8]>) -> Found {
        let (options, cwd) = (self.options, self.cwd());
        let file = match &options.config {
            Some(path) => Some(paths::resolve(cwd, &paths::from_native(path))),
            None => directory.and_then(eslint_config_file),
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
            pipes: &options.pipes,
        };
        let mut files = match directory {
            Some(directory) => eslintrc::cascade(directory, cwd, &mut modules)?,
            None => Vec::new(),
        };
        let cascade = files.len();
        // `createCLIConfigArray`
        if let Some(path) = &options.config {
            let start = self.named_config_base_directory();
            files.push(eslintrc::named(&absolute(path), &start, &mut modules)?);
        }
        if options.ignore {
            let path = options.ignore_path.as_ref().map(absolute);
            let start = self.ignore_file_base_directory(path.as_deref());
            files.extend(eslintrc::ignore_file(
                path.as_deref(),
                &start,
                &options.pipes,
            )?);
        }
        // Only if no other file was found.
        if files.is_empty() && options.eslintrc {
            files.extend(eslintrc::personal(cwd, &mut modules)?);
        }
        let mut command_line_options = modules.command_line.1.clone();
        // If bunfig.toml is in another directory, its patterns are relative to that directory. They come last, as they
        // do in the single object.
        let [(start, ignored), (_, ignored_by_flags)] = self.ignore_patterns();
        let bunfig_legacy_file = (start != cwd).then(|| {
            let mut entries = Vec::new();
            if let Json::Object(all) = &mut command_line_options {
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
            json: command_line_options,
        });
        files.extend(bunfig_legacy_file);
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
        .map_err(|error| Fatal(self.prefix_with_source(file.as_deref(), &error.message)))?;
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

    /// Loads the file `name` in `directory`. oxlint rejects a directory that has two of its config files.
    fn load_sole_config(&self, directory: &[u8], name: &[u8]) -> Found {
        let mut oxlint_names = NAMES.iter().filter(|it| it.1 == Flavor::Oxlint);
        if oxlint_names.clone().any(|it| it.0 == name)
            && let Some(other) =
                oxlint_names.find(|it| it.0 != name && fs::is_file(&paths::join(directory, it.0)))
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

    /// The configuration for files that have no configuration file.
    fn without_config_file(&self) -> Found {
        match self.is_eslint_8_command_line() {
            true => self.legacy(None),
            false => self.load(b"", self.cwd()),
        }
    }

    /// True if neither the working directory nor any of its parents has a configuration file, so each subdirectory is
    /// looked up on its own.
    fn lacks_file(&self) -> bool {
        *self.lacks_file.get_or_init(|| {
            let (own, none) = (self.for_directory(self.cwd()), self.without_config_file());
            matches!((own, none), (Ok(own), Ok(none)) if Arc::ptr_eq(&own, &none))
        })
    }

    /// Records that `directory`, or a file in it, was passed as an argument.
    pub(crate) fn name(&self, directory: &[u8]) {
        let mut named = self.named.lock();
        if !named.iter().any(|it| it == directory) {
            named.push(directory.to_vec());
        }
    }

    /// True if configuration files apply to the files in `directory`. A configuration file is a program, or refers to
    /// programs. So in a run whose working directory has none, only those at or below the working directory apply, plus
    /// those for paths passed as [arguments](Loader::name), but not those that a pattern merely happens to reach.
    fn applies_in(&self, directory: &[u8]) -> bool {
        paths::is_at_or_inside(self.cwd(), directory)
            || !self.lacks_file()
            || (self.named.lock().iter()).any(|it| paths::is_at_or_inside(it, directory))
    }

    /// The configuration for the files in `directory`. It's ESLint's `loadConfigArrayForFile`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        if !self.applies_in(directory) {
            return self.without_config_file();
        }
        if self.is_eslint_8_command_line() {
            if let Some((directory, name)) = self.found(directory) {
                self.check_eslint_8_flags(directory, name)?;
            }
            let mut above = paths::ancestors(directory).filter(|_| self.options.eslintrc);
            return self.legacy(above.find(|it| eslintrc::has_eslintrc_file(it)));
        }
        if self.has_one_configuration() {
            return match &self.options.config {
                Some(path) => self.load(
                    &paths::resolve(self.cwd(), &paths::from_native(path)),
                    &self.named_config_base_directory(),
                ),
                None => self.load(b"", self.cwd()),
            };
        }
        // oxlint's `--disable-nested-config`: the working directory's config applies to everything.
        let directory = if self.options.disable_nested_config {
            self.cwd()
        } else {
            directory
        };
        let mut uncached: Vec<&[u8]> = Vec::new();
        let mut found = None;
        // The number of leading `uncached` entries that use the config of the nearest directory with an ESLint 8 file.
        let mut legacy = None;
        let tool = self.tool_in(directory);
        let reads_legacy = tool != Some(Flavor::Oxlint);
        for ancestor in paths::ancestors(directory) {
            if let Some(known) = self.by_directory.lock().get(ancestor) {
                found = Some(known.clone());
                break;
            }
            uncached.push(ancestor);
            let mut names = self.config_names_for(tool);
            let name = names.find(|name| fs::is_file(&paths::join(ancestor, name)));
            let loaded = name.map(|name| self.load_sole_config(ancestor, name));
            if let Some(loaded) = loaded.filter(|it| !has_no_lint_field(it)) {
                found = Some(loaded);
                break;
            }
            if legacy.is_none() && reads_legacy && eslintrc::has_eslintrc_file(ancestor) {
                legacy = Some(uncached.len());
            }
        }
        let is_other = |it: &Found| {
            (it.as_ref()).is_ok_and(|it| matches!(it.flavor, Flavor::Eslint | Flavor::Oxlint))
        };
        if let Some(count) = legacy.filter(|_| !found.as_ref().is_some_and(is_other)) {
            uncached.truncate(count);
            let last = uncached.last().copied();
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
        for directory in uncached {
            by_directory.insert(directory.to_vec(), found.clone());
        }
        found
    }

    /// [`Loader::for_directory`] for a directory whose entries are `names` and whose parent uses `inherited`.
    pub(crate) fn for_listed_directory<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
        inherited: &Arc<Loaded>,
    ) -> Found {
        let has_single_config = self.has_one_configuration() && !self.is_eslint_8_command_line();
        if has_single_config || self.options.disable_nested_config || !self.applies_in(directory) {
            return Ok(Arc::clone(inherited));
        }
        // Config files apply from here down, including the ones in parent directories.
        if !self.applies_in(paths::dirname(directory)) {
            return self.for_directory(directory);
        }
        let picked = match self.pick(directory, names) {
            // The directory is below an oxlint config, which wins.
            (Some(name), _)
                if self.tool().is_none()
                    && self.tool_in(directory) == Some(Flavor::Oxlint)
                    && !self
                        .config_names_for(Some(Flavor::Oxlint))
                        .any(|it| it == name) =>
            {
                if let Some(oxlint_config) = &inherited.file {
                    let display_path = |it: &[u8]| paths::relative(self.cwd(), it);
                    self.ignore_eslint_config_below(
                        display_path(&paths::join(directory, name)),
                        display_path(oxlint_config),
                    );
                }
                (None, false)
            }
            picked => picked,
        };
        if let (Some(name), _) = picked
            && self.is_eslint_8_command_line()
        {
            self.check_eslint_8_flags(directory, name)?;
        }
        if !self.options.eslintrc {
            return Ok(Arc::clone(inherited));
        }
        let is_legacy = || matches!(inherited.flavor, Flavor::EslintRc | Flavor::BuiltIn);
        match picked {
            (Some(name), _) if !self.is_eslint_8_command_line() => {
                let loaded = self.load_sole_config(directory, name);
                match has_no_lint_field(&loaded) {
                    true => Ok(Arc::clone(inherited)),
                    false => loaded,
                }
            }
            (_, true)
                if is_legacy()
                    && self.flat_config != Some(true)
                    && eslintrc::has_eslintrc_file(directory) =>
            {
                self.legacy(Some(directory))
            }
            _ => Ok(Arc::clone(inherited)),
        }
    }

    /// True if the run emulates oxlint, for when the working directory's configuration can't be read.
    pub(crate) fn emulates_oxlint(&self) -> bool {
        let is_json = |it: &Vec<u8>| it.ends_with(b".json") || it.ends_with(b".jsonc");
        let file_exists =
            |it: &Vec<u8>| fs::is_file(&paths::resolve(self.cwd(), &paths::from_native(it)));
        match &self.options.config {
            Some(path) if file_exists(path) => is_json(path) && !self.is_eslint_8_command_line(),
            _ => self.uses_oxlint_defaults(),
        }
    }

    /// True if a directory called `name`, which `loaded` ignores, can still contain a configuration file that applies.
    /// Git's and Jujutsu's directories never contain project files.
    pub(crate) fn looks_for_configurations_in(&self, loaded: &Loaded, name: &[u8]) -> bool {
        loaded.flavor == Flavor::Oxlint
            && !self.has_one_configuration()
            && !self.options.disable_nested_config
            && !matches!(name, b".git" | b".jj")
    }

    /// True if `loaded` is the fallback for a directory without a configuration file, in a run that uses an
    /// `eslint.config.*`. ESLint has no configuration for a file there, which ends the run. For a directory there, it
    /// uses an empty configuration whose base path is the working directory, so anything outside that is ignored.
    pub(crate) fn lacks_eslint_config_file(&self, loaded: &Loaded) -> bool {
        let has_eslint_file = || {
            let has_config_file =
                |it: &[u8]| self.names().any(|name| fs::is_file(&paths::join(it, name)));
            self.tool() == Some(Flavor::Eslint) && paths::ancestors(self.cwd()).any(has_config_file)
        };
        loaded.flavor == Flavor::BuiltIn
            && *self.has_eslint_config_file.get_or_init(has_eslint_file)
    }

    /// Detects the frameworks used by files in `directory`, from its package.json and the ones above it.
    /// Only Bun's built-in config needs this, so the result is empty with an ESLint or oxlint config.
    pub(crate) fn detect_frameworks(&self, loaded: &Loaded, directory: &[u8]) -> Frameworks {
        if loaded.flavor != Flavor::BuiltIn {
            return Frameworks::empty();
        }
        if let Some(cached) = self.frameworks.lock().get(directory) {
            return *cached;
        }
        let parent = Some(paths::dirname(directory)).filter(|it| it.len() < directory.len());
        let parent = parent.map_or(Frameworks::empty(), |it| self.detect_frameworks(loaded, it));
        let is_repository_root = gitignore::is_root(directory);
        let detected = inherit_frameworks(parent, read_frameworks(directory), is_repository_root);
        (self.frameworks.lock()).insert(directory.to_vec(), detected);
        detected
    }

    /// Resolves the config for one file. Use this instead of `loaded.config.get()`, which doesn't know which frameworks
    /// the project uses.
    pub(crate) fn config_of(&self, loaded: &Loaded, path: &[u8]) -> FileConfig {
        let detected = self.detect_frameworks(loaded, paths::dirname(path));
        (loaded.config).get_with_frameworks(self.linter.registry(), path, detected)
    }

    /// True if the type-aware rules run on a file whose configuration is `config`, which comes from `loaded`.
    pub(crate) fn wants_types(&self, loaded: &Loaded, config: &ResolvedConfig) -> bool {
        // With no config file and no flag, the rules decide. A rule that only uses types when they're available isn't a
        // reason to type check.
        if loaded.flavor == Flavor::BuiltIn && self.options.type_aware.is_none() {
            return self.options.type_check || config.language.has_rule_that_requires_types;
        }
        // oxlint only reads `options` from the working directory's configuration.
        let root_wants_types = || {
            let root = self.for_directory(self.cwd()).ok()?;
            root.wants_types
                .filter(|_| root.flavor == Flavor::Oxlint && loaded.flavor == Flavor::Oxlint)
        };
        self.options
            .type_aware
            .or_else(|| *self.wants_types.get_or_init(root_wants_types))
            .or(loaded.wants_types)
            .unwrap_or(config.language.wants_types)
    }

    /// True if `.gitignore` applies to files that use `loaded`.
    pub(crate) fn reads_ignore_files(&self, loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint || (loaded.flavor == Flavor::BuiltIn && self.options.ignore)
    }

    /// The directory that patterns are relative to in the file given by `--ignore-path` or bunfig.toml's `ignorePath`.
    fn ignore_path_base_directory(&self) -> Vec<u8> {
        match self.options.bunfig_ignore_file_name {
            Some(_) => self.bunfig_base_directory(),
            None => self.cwd().to_vec(),
        }
    }

    /// Same, given that file's path as `file`. A repository's `info/exclude` patterns are relative to the directory Git
    /// uses for them.
    fn ignore_file_base_directory(&self, file: Option<&[u8]>) -> Vec<u8> {
        file.and_then(|it| gitignore::root_of_exclude_file(it, self.cwd()))
            .unwrap_or_else(|| self.ignore_path_base_directory())
    }

    /// The name of the ignore files that apply in every directory in addition to `.gitignore`. oxlint treats the value
    /// of `--ignore-path` as such a name.
    pub(crate) fn ignore_file_name(&self, loaded: &Loaded) -> Option<&[u8]> {
        match &self.options.ignore_path {
            _ if !self.options.ignore => None,
            None => Some(b".eslintignore"),
            Some(name) => (loaded.flavor == Flavor::Oxlint).then_some(
                self.options
                    .bunfig_ignore_file_name
                    .as_ref()
                    .unwrap_or(name),
            ),
        }
    }

    /// True if a file passed as an argument is still skipped, as oxlint does: a pattern in `.eslintignore` or the
    /// `--ignore-path` file matches it, or an `--ignore-pattern` does. `.gitignore` isn't consulted. `path` is the
    /// file's path.
    pub(crate) fn ignores_named_file(&self, argument: &[u8], path: &[u8], loaded: &Loaded) -> bool {
        if loaded.flavor != Flavor::Oxlint {
            return false;
        }
        let is_in_file = self.ignore_file_name(loaded).is_some_and(|file| {
            let (start, file) = (self.ignore_path_base_directory(), paths::from_native(file));
            let resolved = paths::resolve(&start, &file);
            let Ok(text) = self.options.pipes.read(&resolved) else {
                return false;
            };
            if let Some(root) = gitignore::root_of_exclude_file(&resolved, self.cwd()) {
                return gitignore::ignores_argument(
                    &text,
                    &resolved,
                    &paths::relative(&root, path),
                );
            }
            // oxlint matches the argument as spelled. In a run from below bunfig.toml, it's respelled relative to
            // bunfig.toml's directory.
            match start == self.cwd() {
                true => gitignore::ignores_argument(&text, &file, argument),
                false => gitignore::ignores_argument(&text, &file, &paths::relative(&start, path)),
            }
        });
        is_in_file || self.is_ignored_by_flags(path, loaded)
    }

    /// Same for the file name given for standard input, for which the ignore files aren't consulted.
    pub(crate) fn is_ignored_by_flags(&self, path: &[u8], loaded: &Loaded) -> bool {
        loaded.flavor == Flavor::Oxlint
            && self.options.ignore
            && gitignore::is_ignored(&self.flag_ignore_patterns(), path, false)
    }

    /// For oxlint, `--ignore-pattern` applies to the whole run, whichever configuration file is nearest.
    fn flag_ignore_patterns(&self) -> gitignore::Chain {
        let mut chain = gitignore::Chain::default();
        for (start, patterns) in self.ignore_patterns() {
            chain = gitignore::with_lines(chain, &start, patterns.iter().map(|it| &it[..]));
        }
        chain
    }

    /// The ignore files that apply in `directory`, where a search starts. `None` if oxlint doesn't search it because
    /// Git's ignore files exclude it. `are_all_in_repositories` is the run's [`gitignore::are_all_in_repositories`].
    pub(crate) fn ignore_files_at(
        &self,
        directory: &[u8],
        loaded: &Loaded,
        are_all_in_repositories: &dyn Fn() -> bool,
    ) -> Option<Files> {
        if !self.reads_ignore_files(loaded) {
            return Some(Files::default());
        }
        let is_for_oxc = loaded.flavor == Flavor::Oxlint;
        let git_ignores =
            match GitIgnores::for_search(directory, is_for_oxc, are_all_in_repositories) {
                Some(git_ignores) => git_ignores,
                None if is_for_oxc => return None,
                None => GitIgnores::above_and_in(directory, true, is_for_oxc),
            };
        let name = self.ignore_file_name(loaded).map(paths::from_native);
        let pipes = &self.options.pipes;
        let mut files = Files::above_and_in(directory, name.as_deref(), git_ignores, pipes);
        if !self.options.ignore {
            return Some(files);
        }
        if loaded.flavor == Flavor::Oxlint {
            // For oxlint, `--ignore-pattern` applies to the whole run, whichever configuration file is nearest.
            for (start, patterns) in self.ignore_patterns() {
                let lines = patterns.iter().map(|it| &it[..]);
                files.named = gitignore::with_lines(files.named, &start, lines);
            }
        } else if let Some(path) = &self.options.ignore_path {
            let path = paths::resolve(self.cwd(), &paths::from_native(path));
            let start = self.ignore_file_base_directory(Some(&path));
            if let Ok(text) = pipes.read(&path) {
                files.named = gitignore::with_text(files.named, &start, &text, true);
            }
        }
        Some(files)
    }

    pub(crate) fn environment(&self) -> &'l Environment<'l> {
        self.environment
    }
}
