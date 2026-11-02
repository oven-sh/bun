//! ESLint's `languageOptions` and `settings`: what the config tells the linter about a file's code.

use crate::linter::globals::{ConfigGlobals, Tables, environment};
use crate::options::Json;
use bun_sema::resolve::{Dialect, ScriptKind};
use rustc_hash::FxHashMap;
use std::sync::{Arc, OnceLock};

/// ESLint's `languageOptions.sourceType`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceType {
    Module,
    Script,
    /// A script whose top level is a function body: `return` is allowed there, and top-level declarations aren't
    /// global.
    CommonJs,
}

/// How a global variable may be used.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Global {
    /// `"readonly"`, `"readable"`, `false`
    Readonly,
    /// `"writable"`, `"writeable"`, `true`
    Writable,
    /// `"off"`: the variable doesn't exist.
    Off,
}

impl Global {
    /// ESLint's `normalizeConfigGlobal` for a string.
    pub fn of(value: &[u8]) -> Option<Global> {
        Some(match value {
            b"off" => Global::Off,
            b"true" | b"writeable" | b"writable" => Global::Writable,
            b"false" | b"readable" | b"readonly" => Global::Readonly,
            _ => return None,
        })
    }

    /// ESLint's `normalizeConfigGlobal`.
    pub fn from_config_value(value: &Json) -> Option<Global> {
        match value {
            Json::Null | Json::Bool(false) => Some(Global::Readonly),
            Json::Bool(true) => Some(Global::Writable),
            Json::String(value) => Global::of(value),
            _ => None,
        }
    }
}

/// `languageOptions.parser`. Bun parses all code with one parser. Which parser ESLint would use only matters where the
/// two give rules different information.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Parser {
    /// ESLint's default.
    Espree,
    /// `@typescript-eslint/parser`
    TypeScript,
    Other,
}

/// Controls whether a file's globals come from the declarations in its program's types. See
/// [`File::inferred_globals`](crate::ast::File).
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum InferGlobals {
    #[default]
    No,
    /// The inferred globals are added to the config's.
    Besides,
    /// The inferred globals plus the config's own `globals` entries, without its `env`s. A file that isn't in any
    /// program uses the config.
    Instead,
    /// JavaScript files only. The project's options pick which of the linter's tables replace the config's globals, so
    /// none of the project's files are read. The types are only consulted when a name that's in no table is about to be
    /// reported: [`File::is_declared_by_types`](crate::ast::File). TypeScript files use the config.
    ByOptions,
}

impl InferGlobals {
    /// True if globals are inferred for a file, given whether it's JavaScript.
    pub fn is_for(self, is_javascript: bool) -> bool {
        match self {
            InferGlobals::No => false,
            InferGlobals::Besides | InferGlobals::Instead => true,
            InferGlobals::ByOptions => is_javascript,
        }
    }
}

/// The [`LanguageOptions`] fields computed from `$env` and `globals` in `languageOptions`. Most configs in a run share
/// the same values, and `all` is long.
#[derive(Clone, Debug)]
pub(crate) struct GlobalsFromOptions {
    all: Arc<Vec<(Box<[u8]>, Global)>>,
    enabled_own: Vec<Box<[u8]>>,
    shadowed_env_globals: Vec<(Box<[u8]>, Global)>,
    envs: Vec<Box<[u8]>>,
    own: Vec<(Box<[u8]>, Global)>,
}

impl GlobalsFromOptions {
    /// `env_tables` selects the tool whose environment tables `$env` refers to.
    pub(crate) fn new(language_options: &Json, env_tables: Tables) -> GlobalsFromOptions {
        let mut globals: Vec<(Box<[u8]>, Global)> = Vec::new();
        let mut enabled_own_globals: Vec<Box<[u8]>> = Vec::new();
        let mut envs: Vec<Box<[u8]>> = Vec::new();
        let mut own_globals: Vec<(Box<[u8]>, Global)> = Vec::new();
        // `env` from an `.eslintrc` or an `.oxlintrc.json`.
        for (name, is_enabled) in language_options
            .get(b"$env")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            // oxlint has its own `es6` table.
            let name: &[u8] = match env_tables {
                Tables::Today | Tables::Eslint8 if name == b"es6" => b"es2015",
                _ => name,
            };
            if is_enabled.as_bool() == Some(true) {
                envs.push(name.into());
                let variables = environment(name, env_tables).into_iter().flatten();
                globals.extend(variables.map(|(name, setting)| (name.into(), setting)));
            }
        }
        for (name, value) in language_options
            .get(b"globals")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            if let Some(value) = Global::from_config_value(value) {
                globals.push((name[..].into(), value));
                own_globals.push((name[..].into(), value));
                if value != Global::Off {
                    enabled_own_globals.push(name[..].into());
                }
            }
        }
        crate::utils::sort::sort_unstable(&mut enabled_own_globals);
        crate::utils::sort::sort_unstable(&mut envs);
        crate::utils::sort::sort_by(&mut own_globals, |a, b| a.0.cmp(&b.0));
        // If two entries have the same name, the last one wins.
        globals.reverse();
        crate::utils::sort::sort_by(&mut globals, |a, b| a.0.cmp(&b.0));
        let mut shadowed_env_globals: Vec<(Box<[u8]>, Global)> = Vec::new();
        globals.dedup_by(|dropped, kept| {
            let is_same = dropped.0 == kept.0;
            if is_same && env_tables == Tables::Oxlint && kept.1 == Global::Off {
                shadowed_env_globals.push(dropped.clone());
            }
            is_same
        });
        GlobalsFromOptions {
            all: Arc::new(globals),
            enabled_own: enabled_own_globals,
            shadowed_env_globals,
            envs,
            own: own_globals,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LanguageOptions {
    /// The year: 2015, 2016, .. For ES3 and ES5, 3 and 5.
    pub ecma_version: u32,
    pub source_type: SourceType,
    /// `languageOptions.globals`, sorted by name. The globals that the ECMAScript version defines aren't listed.
    pub globals: Arc<Vec<(Box<[u8]>, Global)>>,
    /// The names that `globals` itself enables, not those from an `env`. Sorted.
    pub enabled_own_globals: Vec<Box<[u8]>>,
    /// With an oxlint config: the `env` setting of each variable that `globals` turns off. See
    /// [`File::global`](crate::ast::File::global).
    pub shadowed_env_globals: Vec<(Box<[u8]>, Global)>,
    /// The enabled `env` names, sorted. oxlint exposes them to JavaScript plugins and defines their variables for those
    /// plugins.
    pub envs: Vec<Box<[u8]>>,
    /// The entries of `globals` itself, including the ones it turns off and excluding what an `env` defines. Sorted by
    /// name.
    pub own_globals: Vec<(Box<[u8]>, Global)>,
    pub parser: Parser,
    /// The parser is `@babel/eslint-parser`, which does its own scope analysis. See
    /// [`LanguageOptions::has_function_scope_at_top_level`].
    pub is_babel: bool,
    /// `parserOptions.ecmaFeatures.globalReturn`
    pub global_return: bool,
    /// `parserOptions.ecmaFeatures.impliedStrict`
    pub implied_strict: bool,
    /// `parserOptions.ecmaFeatures.jsx`
    pub jsx: bool,
    /// `parserOptions.sourceType`, which is what `@typescript-eslint/parser` reads.
    pub parser_source_type: Option<SourceType>,
    /// `parserOptions.lib`, lowercased: the TypeScript libraries whose declarations are available. `None` if it isn't
    /// configured.
    pub lib: Option<Vec<Box<[u8]>>>,
    /// `parserOptions.jsxPragma`: the name a JSX element refers to. Defaults to `React`. `None` if it's `null`.
    pub jsx_pragma: Option<Box<[u8]>>,
    /// `parserOptions.jsxFragmentName`: the name a JSX fragment refers to.
    pub jsx_fragment_name: Option<Box<[u8]>>,
    /// `parserOptions.emitDecoratorMetadata`
    pub emit_decorator_metadata: bool,
    /// `parserOptions.experimentalDecorators`
    pub experimental_decorators: bool,
    /// `parserOptions.isolatedDeclarations`
    pub isolated_declarations: bool,
    /// `parserOptions.project`, `projectService` or `programs` requests types.
    pub wants_types: bool,
    /// Reject a file that `parser` would throw on, with that parser's message:
    /// [`parse_error`](crate::linter::parse_error). `false` with an oxlint config, because oxlint has its own parser
    /// and no `parser` option. Then only files that Bun can't parse are rejected.
    pub rejects_what_parser_rejects: bool,
    /// The config is an oxlint config. Where an oxlint rule behaves differently from the ESLint or plugin rule it's a
    /// port of, follow oxlint.
    pub is_oxlint: bool,
    /// There's no ESLint or oxlint config, so no rule has to match an installed package's behavior.
    pub has_no_foreign_config: bool,
    /// Set with `has_no_foreign_config` when each file's syntax decides whether it's a module. `self` then applies to
    /// files with module syntax, and this copy applies to files without it, which are CommonJS.
    /// [`File::new`](crate::ast::File::new) picks one, so [`File::language`](crate::ast::File::language) is correct for
    /// the file. See [`LanguageOptions::resolve_source_type`].
    pub without_module_syntax: Option<Box<LanguageOptions>>,
    /// With an oxlint config. Scopes follow oxc where it differs from typescript-eslint: `namespace A.B { }` is a
    /// namespace `B` declared in the scope of a namespace `A`; outside strict code, a function that JavaScript declares
    /// in a block is a variable of the enclosing function; the name in a JSX closing tag is a reference; the type of a
    /// `catch` parameter and the options of an import type are visited. This doesn't apply to JavaScript plugins, which
    /// oxlint gives typescript-eslint's scopes, or to `rules_missing_in_oxlint`. In those cases a file has [two
    /// analyses](crate::semantic#two-analyses).
    pub has_oxc_scopes: bool,
    /// With an oxlint config: the enabled rules that oxlint could only run as JavaScript plugin rules.
    pub rules_missing_in_oxlint: Vec<&'static crate::rule::Meta>,
    /// A rule is on that can't run without types.
    pub has_rule_that_requires_types: bool,
    /// With an oxlint config where no rule forces every file's variables to be built: the parser itself watches for
    /// names that may be declared twice, which is an error in oxlint. See `Dialect::oxc_names`.
    pub parser_tracks_names: bool,
    /// Set for an ESLint 8 config: the settings that only ESLint 8 has. There, `/* eslint-env mocha */` defines an
    /// environment's variables, and espree only accepts syntax up to the configured `ecmaVersion`.
    pub eslint_8: Option<Arc<crate::linter::config::Eslint8>>,
    /// The ESLint major version whose rule defaults, report positions and messages are used: 8 with ESLint 8 config
    /// files, 9 with an `eslint.config.js` if the installed `eslint` is older than 10, and 10 otherwise. It's also 10
    /// with an oxlint config, where [`is_oxlint`](Self::is_oxlint) decides instead.
    pub eslint_major: u8,
    /// Don't read any file other than the one being linted. oxlint only does that with its `import` plugin.
    pub without_modules: bool,
    pub infers_globals: InferGlobals,
    /// All of `languageOptions.parserOptions`.
    pub parser_options: Json,
    /// ESLint's `settings`.
    pub settings: Arc<Json>,
    /// Computed lazily from the fields above, which must not change afterwards.
    #[doc(hidden)]
    pub config_globals: OnceLock<ConfigGlobals>,
}

/// The per-file parser settings, passed to `bun_sema_parser::summarize_as`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ParseOptions {
    /// The parser whose behavior to follow where parsers disagree about syntax. For espree that's acorn.
    pub dialect: Dialect,
    /// The language, if it differs from what the file name implies.
    pub script_kind: Option<ScriptKind>,
    pub experimental_decorators: bool,
    pub every_file_is_a_module: bool,
}

fn is_truthy(value: Option<&Json>) -> bool {
    match value {
        None | Some(Json::Null | Json::Bool(false)) => false,
        Some(Json::Number(n)) => *n != 0.0 && !n.is_nan(),
        Some(Json::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `parserOptions.ecmaFeatures.globalReturn`
fn wants_global_return(parser_options: &Json) -> bool {
    let features = parser_options.get(b"ecmaFeatures");
    features.and_then(|it| it.get(b"globalReturn")?.as_bool()) == Some(true)
}

fn source_type_of(value: Option<&Json>) -> Option<SourceType> {
    Some(match value?.as_str()? {
        b"module" => SourceType::Module,
        b"script" => SourceType::Script,
        b"commonjs" => SourceType::CommonJs,
        _ => return None,
    })
}

impl LanguageOptions {
    /// The variables that oxlint's `addGlobals` defines for a plugin, in its order: for each enabled `env` the
    /// read-only variables and then the writable ones, followed by the entries of `globals`. A name in `globals` only
    /// appears in that last group, and not at all if it's `"off"`. Unlike oxlint's own rules, plugins only get `Array`
    /// and the like if the `builtin` env is on. oxlint iterates the `env`s and `globals` in hash map order. Here
    /// they're sorted by name.
    /// A native rule that has to behave like a plugin rule uses this instead of `File::global`, which has the variables
    /// of oxlint's own rules.
    pub fn oxlint_plugin_globals(&self) -> Vec<(Box<[u8]>, Global)> {
        let own = &self.own_globals;
        let is_own = |name: &[u8]| own.binary_search_by(|it| (*it.0).cmp(name)).is_ok();
        let mut all: Vec<(Box<[u8]>, Global)> = Vec::new();
        let mut index_of: FxHashMap<&'static [u8], usize> = FxHashMap::default();
        for env in &self.envs {
            let variables = environment(env, Tables::Oxlint).into_iter().flatten();
            let variables: Vec<_> = variables.filter(|it| !is_own(it.0)).collect();
            for wanted in [Global::Readonly, Global::Writable] {
                for &(name, setting) in variables.iter().filter(|it| it.1 == wanted) {
                    // An existing entry keeps its position.
                    let at = *index_of.entry(name).or_insert_with(|| {
                        all.push((name.into(), setting));
                        all.len() - 1
                    });
                    all[at].1 = setting;
                }
            }
        }
        all.extend(own.iter().filter(|it| it.1 != Global::Off).cloned());
        all
    }

    pub const LATEST_ECMA_VERSION: u32 = 2026;

    /// ESLint's `normalizeEcmaVersionForLanguageOptions`.
    pub fn normalize_ecma_version(version: Option<&Json>) -> u32 {
        match version {
            None => 5,
            Some(Json::Number(n)) if *n == 3.0 || *n == 5.0 || *n >= 2015.0 => *n as u32,
            Some(Json::Number(n)) if *n >= 0.0 => *n as u32 + 2009,
            _ => Self::LATEST_ECMA_VERSION,
        }
    }

    /// ESLint's `validateLanguageOptions`. `Err` holds the message, which ESLint prefixes with
    /// `Key "languageOptions": `.
    pub fn validate_json(language_options: &Json) -> Result<(), Vec<u8>> {
        match language_options.get(b"ecmaVersion") {
            None | Some(Json::Number(_)) => {}
            Some(Json::String(version)) if version == b"latest" => {}
            Some(_) => {
                return Err(b"Key \"ecmaVersion\": Expected a number or \"latest\".".to_vec());
            }
        }
        if language_options.get(b"sourceType").is_some()
            && source_type_of(language_options.get(b"sourceType")).is_none()
        {
            return Err(
                b"Key \"sourceType\": Expected \"script\", \"module\", or \"commonjs\".".to_vec(),
            );
        }
        if let Some(globals) = language_options.get(b"globals") {
            let Some(globals) = globals.as_object() else {
                return Err(b"Key \"globals\": Expected an object.".to_vec());
            };
            for (name, value) in globals.iter().filter(|it| it.0 != b"__proto__") {
                if bun_core::strings::trim_js_whitespace(name) != &name[..] {
                    return Err([
                        b"Key \"globals\": Global \"",
                        &name[..],
                        b"\" has leading or trailing whitespace.",
                    ]
                    .concat());
                }
                if Global::from_config_value(value).is_none() {
                    return Err([
                        b"Key \"globals\": Key \"",
                        &name[..],
                        b"\": Expected \"readonly\", \"writable\", or \"off\".",
                    ]
                    .concat());
                }
            }
        }
        if language_options
            .get(b"parserOptions")
            .is_some_and(|it| it.as_object().is_none())
        {
            return Err(b"Key \"parserOptions\": Expected an object.".to_vec());
        }
        let known: [&[u8]; 8] = [
            b"ecmaVersion",
            b"sourceType",
            b"globals",
            b"parser",
            b"parserOptions",
            b"$env",
            b"$sourceTypeBySyntax",
            b"$packageIsModule",
        ];
        match language_options
            .as_object()
            .unwrap_or_default()
            .iter()
            .find(|it| !known.contains(&&it.0[..]))
        {
            Some((key, _)) => Err([b"Unexpected key \"", &key[..], b"\" found."].concat()),
            None => Ok(()),
        }
    }

    /// Built from ESLint's `languageOptions` and `settings` after all config objects are merged. Missing options get
    /// ESLint's defaults, and invalid ones are ignored.
    ///
    /// `$env` is the `env` of an `.eslintrc`. The variables of each environment that's `true` become globals, which
    /// `globals` can override.
    ///
    /// `parser` is a string: `"espree"`, `"@typescript-eslint/parser"`, `"typescript-eslint/parser"` or `"typescript"`,
    /// each with or without `@version`. Anything else is [`Parser::Other`].
    pub fn from_json(language_options: &Json, settings: &Json) -> LanguageOptions {
        Self::from_json_for(language_options, Arc::new(settings.clone()), Tables::Today)
    }

    /// Like [`LanguageOptions::from_json`]. `env_tables` selects the tool whose environment tables `$env` refers to.
    pub(crate) fn from_json_for(
        language_options: &Json,
        settings: Arc<Json>,
        env_tables: Tables,
    ) -> LanguageOptions {
        let globals = GlobalsFromOptions::new(language_options, env_tables);
        Self::from_json_with(language_options, settings, globals)
    }

    /// Like [`LanguageOptions::from_json`], for a caller that already has [`GlobalsFromOptions::new`] of
    /// `language_options`.
    pub(crate) fn from_json_with(
        language_options: &Json,
        settings: Arc<Json>,
        globals: GlobalsFromOptions,
    ) -> LanguageOptions {
        let parser_options = language_options
            .get(b"parserOptions")
            .cloned()
            .unwrap_or(Json::Null);
        let features = parser_options.get(b"ecmaFeatures");
        let feature = |name: &[u8]| {
            features.and_then(|it| it.get(name)).and_then(Json::as_bool) == Some(true)
        };
        let flag = |name: &[u8]| parser_options.get(name).and_then(Json::as_bool) == Some(true);
        let name = |value: Option<&Json>| value.and_then(Json::as_str).map(Box::from);
        let parser_name = language_options.get(b"parser").and_then(Json::as_str);
        let parser_name = parser_name.map(|it| {
            let version = bun_core::strings::last_index_of_char(it, b'@').filter(|at| *at > 0);
            &it[..version.unwrap_or(it.len())]
        });
        let parser = match parser_name {
            None | Some(b"espree") => Parser::Espree,
            Some(b"typescript" | b"@typescript-eslint/parser" | b"typescript-eslint/parser") => {
                Parser::TypeScript
            }
            Some(_) => Parser::Other,
        };
        let is_babel = parser_name == Some(&b"@babel/eslint-parser"[..]);
        let source_type =
            source_type_of(language_options.get(b"sourceType")).unwrap_or(SourceType::Module);
        let mut options = LanguageOptions {
            ecma_version: match language_options.get(b"ecmaVersion") {
                None => Self::LATEST_ECMA_VERSION,
                version => Self::normalize_ecma_version(version),
            },
            source_type,
            globals: globals.all,
            enabled_own_globals: globals.enabled_own,
            shadowed_env_globals: globals.shadowed_env_globals,
            envs: globals.envs,
            own_globals: globals.own,
            parser,
            is_babel,
            global_return: false,
            implied_strict: feature(b"impliedStrict"),
            jsx: feature(b"jsx"),
            parser_source_type: source_type_of(parser_options.get(b"sourceType")),
            lib: parser_options
                .get(b"lib")
                .and_then(Json::as_array)
                .map(|libs| {
                    libs.iter()
                        .filter_map(Json::as_str)
                        .map(|lib| lib.to_ascii_lowercase().into())
                        .collect()
                }),
            jsx_pragma: match parser_options.get(b"jsxPragma") {
                None => Some(b"React"[..].into()),
                pragma => name(pragma),
            },
            jsx_fragment_name: name(parser_options.get(b"jsxFragmentName")),
            emit_decorator_metadata: flag(b"emitDecoratorMetadata"),
            experimental_decorators: flag(b"experimentalDecorators"),
            isolated_declarations: flag(b"isolatedDeclarations"),
            wants_types: [&b"project"[..], b"projectService", b"programs"]
                .iter()
                .any(|key| is_truthy(parser_options.get(key))),
            rejects_what_parser_rejects: true,
            is_oxlint: false,
            has_no_foreign_config: false,
            without_module_syntax: None,
            has_oxc_scopes: false,
            rules_missing_in_oxlint: Vec::new(),
            has_rule_that_requires_types: false,
            parser_tracks_names: false,
            eslint_8: None,
            eslint_major: 10,
            without_modules: false,
            infers_globals: InferGlobals::No,
            parser_options,
            settings,
            config_globals: OnceLock::new(),
        };
        options.set_source_type(source_type);
        options
    }

    fn set_source_type(&mut self, source_type: SourceType) {
        self.source_type = source_type;
        // ESLint turns `globalReturn` off for espree in a module. Babel's parser ignores it there.
        self.global_return = wants_global_return(&self.parser_options)
            && !((self.parser == Parser::Espree || self.is_babel)
                && source_type == SourceType::Module);
        self.config_globals = OnceLock::new();
    }

    /// With `has_no_foreign_config`, picks `sourceType` the way Node does when it runs the file. `language_options` is
    /// the JSON that these options were built from. In order of precedence:
    ///
    /// 1. `parserOptions.sourceType`, from `--parser-options` or `[lint.parserOptions]`. It applies to every file, like
    ///    `languageOptions.sourceType` in an ESLint config object without `files`.
    /// 2. The extension. The built-in config sets `sourceType` for `.mjs`, `.mts`, `.cjs` and `.cts`, and
    ///    `$sourceTypeBySyntax` for the others.
    /// 3. `"type": "module"` in the nearest package.json, which the built-in config passes on as `$packageIsModule`.
    ///    It's ignored with `ecmaFeatures.globalReturn`, because ESLint turns that option off in a module.
    /// 4. The syntax. `"type": "commonjs"` ends up here too. Bun runs a file with an `import` in a CommonJS package as
    ///    a module, and that's how TypeScript and bundled projects are written.
    ///
    /// Returns `true` in case 4. The caller must then call [`LanguageOptions::decide_by_syntax`], which clones these
    /// options, after its last change to them. `Err` describes an invalid `parserOptions.sourceType`.
    pub(crate) fn resolve_source_type(&mut self, language_options: &Json) -> Result<bool, Vec<u8>> {
        let is_set = |key: &[u8]| language_options.get(key).and_then(Json::as_bool) == Some(true);
        if let Some(explicit_source_type) = self.parser_source_type {
            self.set_source_type(explicit_source_type);
            return Ok(false);
        }
        if self.parser_options.get(b"sourceType").is_some() {
            return Err(b"Key \"languageOptions\": Key \"parserOptions\": Key \"sourceType\": Expected \"script\", \"module\", or \"commonjs\".".to_vec());
        }
        Ok(is_set(b"$sourceTypeBySyntax")
            && (!is_set(b"$packageIsModule") || wants_global_return(&self.parser_options)))
    }

    /// Sets [`LanguageOptions::without_module_syntax`].
    pub(crate) fn decide_by_syntax(&mut self) {
        self.set_source_type(SourceType::Module);
        let mut commonjs = self.clone();
        commonjs.set_source_type(SourceType::CommonJs);
        self.without_module_syntax = Some(Box::new(commonjs));
    }

    /// Returns a copy of these options with a different parser.
    pub fn with_parser(&self, parser: Parser) -> LanguageOptions {
        let mut other = self.clone();
        other.parser = parser;
        if let Some(commonjs) = &mut other.without_module_syntax {
            commonjs.parser = parser;
        }
        other
    }

    /// oxlint's `ctx.globals().is_enabled(name)`: `globals` itself lists `name`, and not as `"off"`.
    pub fn is_enabled_own_global(&self, name: &[u8]) -> bool {
        self.enabled_own_globals
            .binary_search_by(|it| (**it).cmp(name))
            .is_ok()
    }

    pub(crate) fn config_globals(&self) -> &ConfigGlobals {
        self.config_globals.get_or_init(|| ConfigGlobals::new(self))
    }

    /// Returns the `sourceType` used for scope analysis. `@typescript-eslint/parser` prefers
    /// `parserOptions.sourceType`, and treats `"commonjs"` as `"script"`. With `has_no_foreign_config`, a CommonJS file
    /// written in TypeScript gets a function scope around it like any other CommonJS file.
    pub fn scope_source_type(&self) -> SourceType {
        match self.parser {
            Parser::TypeScript if self.has_no_foreign_config => self.source_type,
            Parser::TypeScript => match self.parser_source_type.unwrap_or(self.source_type) {
                SourceType::Module => SourceType::Module,
                _ => SourceType::Script,
            },
            _ => self.source_type,
        }
    }

    /// ESLint's `scopeManager.isGlobalReturn()`: there's a function scope between the global scope and the file's code.
    /// With Babel's parser, `"commonjs"` by itself doesn't create one, so `const { Symbol } = a;` at the top level
    /// defines the global variable.
    pub fn has_function_scope_at_top_level(&self) -> bool {
        self.global_return || (self.scope_source_type() == SourceType::CommonJs && !self.is_babel)
    }

    /// The parser settings for the file at `path`.
    pub fn parse_options(&self, path: &[u8]) -> ParseOptions {
        let by_name = ScriptKind::from_file_name(path);
        let script_kind = match self.parser {
            // typescript-estree's `getScriptKind`
            Parser::TypeScript | Parser::Other => match by_name {
                Some(_) => None,
                None => Some(if self.jsx {
                    ScriptKind::Tsx
                } else {
                    ScriptKind::Ts
                }),
            },
            // ESLint 8's espree ignores the file name.
            Parser::Espree => match by_name {
                Some(_) if self.eslint_8.is_none() => None,
                _ => Some(if self.jsx {
                    ScriptKind::Jsx
                } else {
                    ScriptKind::Js
                }),
            },
        };
        let is_script = self.scope_source_type() != SourceType::Module;
        ParseOptions {
            dialect: Dialect {
                oxc: !self.rejects_what_parser_rejects,
                oxc_names: !self.rejects_what_parser_rejects && self.parser_tracks_names,
                module_or_script: self.without_module_syntax.is_some(),
                ..match self.parser {
                    Parser::Espree => Dialect::espree(is_script),
                    Parser::TypeScript | Parser::Other => Dialect::typescript_estree(is_script),
                }
            },
            script_kind,
            experimental_decorators: self.experimental_decorators,
            every_file_is_a_module: self.scope_source_type() == SourceType::Module,
        }
    }
}

impl Default for LanguageOptions {
    fn default() -> Self {
        LanguageOptions {
            ecma_version: Self::LATEST_ECMA_VERSION,
            source_type: SourceType::Module,
            globals: Arc::default(),
            enabled_own_globals: Vec::new(),
            shadowed_env_globals: Vec::new(),
            envs: Vec::new(),
            own_globals: Vec::new(),
            parser: Parser::Espree,
            is_babel: false,
            global_return: false,
            implied_strict: false,
            jsx: false,
            parser_source_type: None,
            lib: None,
            jsx_pragma: Some(b"React"[..].into()),
            jsx_fragment_name: None,
            emit_decorator_metadata: false,
            experimental_decorators: false,
            isolated_declarations: false,
            wants_types: false,
            rejects_what_parser_rejects: true,
            is_oxlint: false,
            has_no_foreign_config: false,
            without_module_syntax: None,
            has_oxc_scopes: false,
            rules_missing_in_oxlint: Vec::new(),
            has_rule_that_requires_types: false,
            parser_tracks_names: false,
            eslint_8: None,
            eslint_major: 10,
            without_modules: false,
            infers_globals: InferGlobals::No,
            parser_options: Json::Null,
            settings: Arc::new(Json::Null),
            config_globals: OnceLock::new(),
        }
    }
}
