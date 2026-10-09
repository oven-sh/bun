//! ESLint's `languageOptions` and `settings`: what the configuration says about the code of a
//! file.

use crate::linter::globals::ConfigGlobals;
use crate::options::Json;
use bun_sema::resolve::{Dialect, ScriptKind};
use std::sync::{Arc, OnceLock};

/// ESLint's `languageOptions.sourceType`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceType {
    Module,
    Script,
    /// A script whose top level is the body of a function: `return` is allowed there, and what is
    /// declared there is not global.
    CommonJs,
}

/// How a global variable may be used.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Global {
    /// `"readonly"`, `"readable"`, `false`
    Readonly,
    /// `"writable"`, `"writeable"`, `true`
    Writable,
    /// `"off"`: it does not exist.
    Off,
}

impl Global {
    /// ESLint's `normalizeConfigGlobal` of a string.
    pub fn of(value: &[u8]) -> Option<Global> {
        Some(match value {
            b"off" => Global::Off,
            b"true" | b"writeable" | b"writable" => Global::Writable,
            b"false" | b"readable" | b"readonly" => Global::Readonly,
            _ => return None,
        })
    }

    /// ESLint's `normalizeConfigGlobal`.
    pub fn of_json(value: &Json) -> Option<Global> {
        match value {
            Json::Null | Json::Bool(false) => Some(Global::Readonly),
            Json::Bool(true) => Some(Global::Writable),
            Json::String(value) => Global::of(value),
            _ => None,
        }
    }
}

/// `languageOptions.parser`. All code is parsed by the same parser here. Which one ESLint would
/// use matters where the two differ in what they tell the rules.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Parser {
    /// ESLint's default.
    Espree,
    /// `@typescript-eslint/parser`
    TypeScript,
    Other,
}

#[derive(Clone, Debug)]
pub struct LanguageOptions {
    /// The year: 2015, 2016, .. For ES3 and ES5, 3 and 5.
    pub ecma_version: u32,
    pub source_type: SourceType,
    /// `languageOptions.globals`. Sorted by name. What the ECMAScript version defines is not
    /// listed here.
    pub globals: Vec<(Box<[u8]>, Global)>,
    /// The names that `globals` itself turns on, without those of an `env`. Sorted.
    pub written_globals: Vec<Box<[u8]>>,
    /// An `env` is on in which oxlint has `Temporal`, which is none of its built-in globals.
    pub has_temporal_in_env: bool,
    pub parser: Parser,
    /// `parserOptions.ecmaFeatures.globalReturn`
    pub global_return: bool,
    /// `parserOptions.ecmaFeatures.impliedStrict`
    pub implied_strict: bool,
    /// `parserOptions.ecmaFeatures.jsx`
    pub jsx: bool,
    /// `parserOptions.sourceType`, which is what `@typescript-eslint/parser` goes by.
    pub parser_source_type: Option<SourceType>,
    /// `parserOptions.lib`, in lower case: the libraries of TypeScript whose declarations are
    /// known. `None` if it is not configured.
    pub lib: Option<Vec<Box<[u8]>>>,
    /// `parserOptions.jsxPragma`: what a JSX element refers to. `React` unless configured, `None`
    /// if it is `null`.
    pub jsx_pragma: Option<Box<[u8]>>,
    /// `parserOptions.jsxFragmentName`: what a JSX fragment refers to.
    pub jsx_fragment_name: Option<Box<[u8]>>,
    /// `parserOptions.emitDecoratorMetadata`
    pub emit_decorator_metadata: bool,
    /// `parserOptions.experimentalDecorators`
    pub experimental_decorators: bool,
    /// `parserOptions.isolatedDeclarations`
    pub isolated_declarations: bool,
    /// `parserOptions.project`, `projectService` or `programs` ask for types.
    pub wants_types: bool,
    /// A file that `parser` throws on is refused, with its message: [`parse_error`](crate::linter::parse_error). `false` with a
    /// configuration of oxlint, which has a parser of its own and no `parser`: only what cannot be parsed here is refused.
    pub refuses_what_parser_refuses: bool,
    /// The configuration is one of oxlint: where a rule of oxlint does something else than the rule of ESLint or of the plugin
    /// that it is a port of, oxlint is followed.
    pub is_oxlint: bool,
    /// The configuration is one of ESLint 8: what only that has a say about. There `/* eslint-env mocha */` defines the variables of
    /// an environment, and espree reads the edition of the language that is configured and no later one.
    pub eslint_8: Option<Arc<crate::linter::config::Eslint8>>,
    /// All of `languageOptions.parserOptions`.
    pub parser_options: Json,
    /// ESLint's `settings`.
    pub settings: Json,
    /// Computed from the fields above the first time it is asked for. They must not change after
    /// that.
    #[doc(hidden)]
    pub config_globals: OnceLock<ConfigGlobals>,
}

/// What the parser is told about a file: arguments of `bun_js_parser::sema::summarize_as`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ParseOptions {
    /// Whose reading of the syntax counts where parsers differ: that of acorn for espree.
    pub dialect: Dialect,
    /// The language, if it is not the one that the name of the file stands for.
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

fn source_type_of(value: Option<&Json>) -> Option<SourceType> {
    Some(match value?.as_str()? {
        b"module" => SourceType::Module,
        b"script" => SourceType::Script,
        b"commonjs" => SourceType::CommonJs,
        _ => return None,
    })
}

impl LanguageOptions {
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

    /// ESLint's `validateLanguageOptions`. `Err`: the message, which ESLint prefixes with
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
                if crate::linter::trim_js_space(name) != &name[..] {
                    return Err([
                        b"Key \"globals\": Global \"",
                        &name[..],
                        b"\" has leading or trailing whitespace.",
                    ]
                    .concat());
                }
                if Global::of_json(value).is_none() {
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
        let known: [&[u8]; 6] = [
            b"ecmaVersion",
            b"sourceType",
            b"globals",
            b"parser",
            b"parserOptions",
            b"$env",
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

    /// From ESLint's `languageOptions` and `settings` after all configuration objects are merged.
    /// What is missing has ESLint's default. What is invalid is ignored.
    ///
    /// `$env` is the `env` of an `.eslintrc`: the variables of each environment that is `true` are
    /// globals, which `globals` overrides.
    ///
    /// `parser` is a string: `"espree"`, `"@typescript-eslint/parser"`, `"typescript-eslint/parser"`
    /// or `"typescript"`, each with or without `@version`. Any other is [`Parser::Other`].
    pub fn from_json(language_options: &Json, settings: &Json) -> LanguageOptions {
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
        let parser = match language_options.get(b"parser").and_then(Json::as_str) {
            None => Parser::Espree,
            Some(written) => {
                let version =
                    bun_core::strings::last_index_of_char(written, b'@').filter(|at| *at > 0);
                match &written[..version.unwrap_or(written.len())] {
                    b"espree" => Parser::Espree,
                    b"typescript" | b"@typescript-eslint/parser" | b"typescript-eslint/parser" => {
                        Parser::TypeScript
                    }
                    _ => Parser::Other,
                }
            }
        };
        let source_type =
            source_type_of(language_options.get(b"sourceType")).unwrap_or(SourceType::Module);
        let mut globals: Vec<(Box<[u8]>, Global)> = Vec::new();
        let mut written_globals: Vec<Box<[u8]>> = Vec::new();
        let mut has_temporal_in_env = false;
        // `env` of an `.eslintrc` or an `.oxlintrc.json`.
        for (name, is_enabled) in language_options
            .get(b"$env")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            let name: &[u8] = if name == b"es6" { b"es2015" } else { name };
            if is_enabled.as_bool() == Some(true) {
                has_temporal_in_env |= matches!(
                    name,
                    b"browser" | b"node" | b"serviceworker" | b"shared-node-browser" | b"worker"
                );
                let variables = crate::linter::globals::environment(name)
                    .into_iter()
                    .flatten();
                globals.extend(variables.map(|(name, setting)| (name.into(), setting)));
            }
        }
        for (name, value) in language_options
            .get(b"globals")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            if let Some(value) = Global::of_json(value) {
                globals.push((name[..].into(), value));
                if value != Global::Off {
                    written_globals.push(name[..].into());
                }
            }
        }
        crate::utils::sort::sort_unstable(&mut written_globals);
        // The last of two entries with the same name counts.
        globals.reverse();
        crate::utils::sort::sort_by(&mut globals, |a, b| a.0.cmp(&b.0));
        globals.dedup_by(|a, b| a.0 == b.0);
        LanguageOptions {
            ecma_version: match language_options.get(b"ecmaVersion") {
                None => Self::LATEST_ECMA_VERSION,
                version => Self::normalize_ecma_version(version),
            },
            source_type,
            globals,
            written_globals,
            has_temporal_in_env,
            parser,
            // ESLint turns it off for espree in a module.
            global_return: feature(b"globalReturn")
                && !(parser == Parser::Espree && source_type == SourceType::Module),
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
            refuses_what_parser_refuses: true,
            is_oxlint: false,
            eslint_8: None,
            parser_options,
            settings: settings.clone(),
            config_globals: OnceLock::new(),
        }
    }

    /// oxlint's `ctx.globals().is_enabled(name)`: `globals` itself has `name`, and not as `"off"`.
    pub fn is_written_global(&self, name: &[u8]) -> bool {
        self.written_globals
            .binary_search_by(|it| (**it).cmp(name))
            .is_ok()
    }

    pub(crate) fn config_globals(&self) -> &ConfigGlobals {
        self.config_globals.get_or_init(|| ConfigGlobals::new(self))
    }

    /// The `sourceType` that the scopes of a file are analyzed with. `@typescript-eslint/parser`
    /// prefers `parserOptions.sourceType`, and takes `"commonjs"` for `"script"`.
    pub fn scope_source_type(&self) -> SourceType {
        match self.parser {
            Parser::TypeScript => match self.parser_source_type.unwrap_or(self.source_type) {
                SourceType::Module => SourceType::Module,
                _ => SourceType::Script,
            },
            _ => self.source_type,
        }
    }

    /// ESLint's `scopeManager.isGlobalReturn()`: between the global scope and the code of the file
    /// is the scope of a function.
    pub fn has_function_scope_at_top_level(&self) -> bool {
        self.global_return || self.scope_source_type() == SourceType::CommonJs
    }

    /// What to tell the parser about the file at `path`.
    pub fn parse_options(&self, path: &[u8]) -> ParseOptions {
        let by_name = ScriptKind::from_file_name(path);
        let script_kind = match self.parser {
            // `getScriptKind` of typescript-estree
            Parser::TypeScript | Parser::Other => match by_name {
                Some(_) => None,
                None => Some(if self.jsx {
                    ScriptKind::Tsx
                } else {
                    ScriptKind::Ts
                }),
            },
            // For the espree of ESLint 8 the name of a file says nothing.
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
            dialect: match self.parser {
                Parser::Espree => Dialect::espree(is_script),
                Parser::TypeScript | Parser::Other => Dialect::typescript_estree(is_script),
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
            globals: Vec::new(),
            written_globals: Vec::new(),
            has_temporal_in_env: false,
            parser: Parser::Espree,
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
            refuses_what_parser_refuses: true,
            is_oxlint: false,
            eslint_8: None,
            parser_options: Json::Null,
            settings: Json::Null,
            config_globals: OnceLock::new(),
        }
    }
}
