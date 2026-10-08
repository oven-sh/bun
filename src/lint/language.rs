//! ESLint's `languageOptions` and `settings`: what the configuration says about the code of a
//! file.

use crate::options::Json;
use bun_sema::resolve::ScriptKind;

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
    /// All of `languageOptions.parserOptions`.
    pub parser_options: Json,
    /// ESLint's `settings`.
    pub settings: Json,
}

/// What the parser is told about a file: arguments of `bun_js_parser::sema::summarize`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ParseOptions {
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

    pub fn global(&self, name: &[u8]) -> Option<Global> {
        let at = self.globals.binary_search_by(|it| (*it.0).cmp(name)).ok()?;
        Some(self.globals[at].1)
    }

    /// ESLint's `normalizeEcmaVersionForLanguageOptions`.
    pub fn normalize_ecma_version(version: Option<&Json>) -> u32 {
        match version {
            None => 5,
            Some(Json::Number(n)) if *n == 3.0 || *n == 5.0 || *n >= 2015.0 => *n as u32,
            Some(Json::Number(n)) if *n >= 0.0 => *n as u32 + 2009,
            _ => Self::LATEST_ECMA_VERSION,
        }
    }

    /// From ESLint's `languageOptions` and `settings` after all configuration objects are merged.
    /// What is missing has ESLint's default. What is invalid is ignored.
    ///
    /// `parser` is a string: `"espree"`, `"@typescript-eslint/parser"`, `"typescript-eslint/parser"`
    /// or `"typescript"`, each with or without `@version`. Any other is [`Parser::Other`].
    pub fn from_json(language_options: &Json, settings: &Json) -> LanguageOptions {
        let parser_options = language_options.get(b"parserOptions").cloned().unwrap_or(Json::Null);
        let features = parser_options.get(b"ecmaFeatures");
        let feature = |name: &[u8]| features.and_then(|it| it.get(name)).and_then(Json::as_bool) == Some(true);
        let flag = |name: &[u8]| parser_options.get(name).and_then(Json::as_bool) == Some(true);
        let name = |value: Option<&Json>| value.and_then(Json::as_str).map(Box::from);
        let parser = match language_options.get(b"parser").and_then(Json::as_str) {
            None => Parser::Espree,
            Some(written) => {
                let version = bun_core::strings::last_index_of_char(written, b'@').filter(|at| *at > 0);
                match &written[..version.unwrap_or(written.len())] {
                    b"espree" => Parser::Espree,
                    b"typescript" | b"@typescript-eslint/parser" | b"typescript-eslint/parser" => Parser::TypeScript,
                    _ => Parser::Other,
                }
            }
        };
        let source_type = source_type_of(language_options.get(b"sourceType")).unwrap_or(SourceType::Module);
        let mut globals: Vec<(Box<[u8]>, Global)> = Vec::new();
        for (name, value) in language_options.get(b"globals").and_then(Json::as_object).unwrap_or_default() {
            if let Some(value) = Global::of_json(value) {
                globals.push((name[..].into(), value));
            }
        }
        // The last of two entries with the same name counts.
        globals.reverse();
        globals.sort_by(|a, b| a.0.cmp(&b.0));
        globals.dedup_by(|a, b| a.0 == b.0);
        LanguageOptions {
            ecma_version: match language_options.get(b"ecmaVersion") {
                None => Self::LATEST_ECMA_VERSION,
                version => Self::normalize_ecma_version(version),
            },
            source_type,
            globals,
            parser,
            // ESLint turns it off for espree in a module.
            global_return: feature(b"globalReturn") && !(parser == Parser::Espree && source_type == SourceType::Module),
            implied_strict: feature(b"impliedStrict"),
            jsx: feature(b"jsx"),
            parser_source_type: source_type_of(parser_options.get(b"sourceType")),
            lib: parser_options.get(b"lib").and_then(Json::as_array).map(|libs| {
                libs.iter().filter_map(Json::as_str).map(|lib| lib.to_ascii_lowercase().into()).collect()
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
            parser_options,
            settings: settings.clone(),
        }
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
                None => Some(if self.jsx { ScriptKind::Tsx } else { ScriptKind::Ts }),
            },
            Parser::Espree => match by_name {
                Some(_) => None,
                None => Some(if self.jsx { ScriptKind::Jsx } else { ScriptKind::Js }),
            },
        };
        ParseOptions {
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
            parser_options: Json::Null,
            settings: Json::Null,
        }
    }
}
