//! Configuration diagnostics that do not depend on the program: 5051 5052 5053 5059 5061 5062 5063 5066 5067 5069 5074 5089 5090 5091
//! 5095 5096 5098 5102 5108 5109 5110 6266 6304 6379 18035.
//!
//! A port of `verifyCompilerOptions` (TypeScript 7.0.2, compiler/program.go) without the checks that depend on output paths. 6266 is
//! reported by `convertJsonOption` (tsoptions) while the configuration is parsed.

use crate::check::errors_x_regexp_scanner::{is_identifier_part, is_identifier_start};
use crate::json::Json;
use crate::json_places::{self, Value};
use crate::resolve::{JsxEmit, ModuleKind, Options};

/// The options declared `IsCommandLineOnly` (tsoptions).
const COMMAND_LINE_ONLY_OPTIONS: [&str; 6] = [
    "help",
    "ignoreConfig",
    "listFilesOnly",
    "locale",
    "showConfig",
    "watch",
];

/// `configDirTemplate` (tsoptions)
const CONFIG_DIR_TEMPLATE: &str = "${configDir}";

/// `hasZeroOrOneAsteriskCharacter`
fn has_at_most_one_asterisk(text: &str) -> bool {
    text.bytes().filter(|&b| b == b'*').count() <= 1
}

/// `PathIsRelative`
fn path_is_relative(path: &str) -> bool {
    matches!(
        path.as_bytes(),
        [b'.'] | [b'.', b'.'] | [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..]
    )
}

/// `PathIsAbsolute`: `GetEncodedRootLength(path) != 0`
fn path_is_absolute(path: &str) -> bool {
    match path.as_bytes() {
        // A POSIX, UNC or untitled (`^/`) root
        [b'/' | b'\\', ..] | [b'^', b'/', ..] => true,
        // A DOS volume: `c:`, `c:/` or `c:\`, but not `c:d`
        [volume, b':'] | [volume, b':', b'/' | b'\\', ..] if volume.is_ascii_alphabetic() => true,
        // A URL
        _ => path.contains("://"),
    }
}

/// `startsWithConfigDirTemplate` (tsoptions): parsing replaces the template by the directory of the configuration file, which makes
/// the path absolute.
fn starts_with_config_dir_template(path: &str) -> bool {
    path.get(..CONFIG_DIR_TEMPLATE.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(CONFIG_DIR_TEMPLATE))
}

/// The elements of a list option as tsoptions parses it. `None` is Go's nil slice: `value` is not an array, or it is a non-empty array
/// of nothing but `null`.
fn parsed_list(value: &Json) -> Option<&[Json]> {
    value
        .as_array()
        .filter(|items| items.is_empty() || items.iter().any(|item| !matches!(item, Json::Null)))
}

/// `IsWhiteSpaceLike`
fn is_white_space_like(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '\u{200B}' | '\u{FEFF}')
}

/// `IsIdentifierText`
fn is_identifier(text: &str) -> bool {
    let mut chars = text.chars().map(u32::from);
    chars.next().is_some_and(is_identifier_start) && chars.all(is_identifier_part)
}

/// `ParseIsolatedEntityName`: whether `text` is an identifier or a qualified name. Keywords count as identifiers, and white space may
/// surround each name. Comments, `\u` escapes and a leading `#!` line are not supported: a text that contains one is rejected.
pub fn is_entity_name(text: &str) -> bool {
    let mut names = text
        .split('.')
        .map(|name| name.trim_matches(is_white_space_like));
    // `tokenIsIdentifierOrKeyword` holds for a private identifier, so `parseEntityName` accepts `#a` as the first name.
    // `parseRightSideOfDot` rejects it after a dot.
    names
        .next()
        .is_some_and(|first| is_identifier(first.strip_prefix('#').unwrap_or(first)))
        && names.all(is_identifier)
}

/// Where in the configuration file something wrong with the options is pointed out.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub enum Place {
    /// `NewCompilerDiagnostic`
    #[default]
    Nowhere,
    /// `createCompilerOptionsDiagnostic`: at the word `compilerOptions`.
    CompilerOptions,
    /// `createDiagnosticForOption`: at the name of whichever of two options is written first, the second of which may be none.
    Key(&'static str, &'static str),
    /// At what the option is set to.
    Value(&'static str),
    /// `createDiagnosticForOptionPaths`: at a pattern in `paths`, or at what is to be tried for it.
    PathsKey(String),
    PathsValue(String),
    /// `createDiagnosticForOptionPathKeyValue`: at one of those.
    PathsElement(String, usize),
}

/// Something wrong with the options.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Problem {
    pub code: u32,
    pub args: Vec<String>,
    /// `AddMessageChain`: what is said below it. How far it is indented, the code, what goes into the message.
    pub chain: Vec<(u32, u32, Vec<String>)>,
    pub at: Place,
}

impl Problem {
    pub fn new(code: u32, args: &[&str], at: Place) -> Problem {
        Problem {
            code,
            args: args.iter().map(|&a| a.to_owned()).collect(),
            chain: Vec::new(),
            at,
        }
    }

    /// With `code` said below it, `level` steps in.
    pub fn with(mut self, level: u32, code: u32, args: &[&str]) -> Problem {
        self.chain
            .push((level, code, args.iter().map(|&a| a.to_owned()).collect()));
        self
    }

    /// From where to where it is in the configuration file that reads `text`. `None`: it is about no place in it.
    pub fn span_in(&self, text: &[u8]) -> Option<(u32, u32)> {
        if self.at == Place::Nowhere {
            return None;
        }
        let root = json_places::parse(text)?;
        let options = root.member("compilerOptions", "")?;
        let of = |value: &Value| (value.from, value.to);
        let paths = || options.value.member("paths", "");
        let found = match &self.at {
            Place::Nowhere | Place::CompilerOptions => None,
            Place::Key(name, other) => options
                .value
                .member(name, other)
                .map(|m| (m.name_from, m.name_to)),
            Place::Value(name) => options.value.member(name, "").map(|m| of(&m.value)),
            Place::PathsKey(key) => paths()
                .and_then(|p| p.value.member(key, ""))
                .map(|m| (m.name_from, m.name_to)),
            Place::PathsValue(key) => paths()
                .and_then(|p| p.value.member(key, ""))
                .map(|m| of(&m.value)),
            Place::PathsElement(key, index) => paths()
                .and_then(|p| p.value.member(key, ""))
                .and_then(|m| m.value.element(*index))
                .map(of),
        };
        Some(found.unwrap_or((options.name_from, options.name_to)))
    }
}

/// `ModuleKind.String`
fn module_kind_name(module: ModuleKind) -> &'static str {
    match module {
        ModuleKind::CommonJs => "CommonJS",
        ModuleKind::Amd => "AMD",
        ModuleKind::Umd => "UMD",
        ModuleKind::System => "System",
        ModuleKind::Es2015 => "ES2015",
        ModuleKind::Es2020 => "ES2020",
        ModuleKind::Es2022 => "ES2022",
        ModuleKind::EsNext => "ESNext",
        ModuleKind::Node16 => "Node16",
        ModuleKind::Node18 => "Node18",
        ModuleKind::Node20 => "Node20",
        ModuleKind::NodeNext => "NodeNext",
        ModuleKind::Preserve => "Preserve",
    }
}

/// `GetRelativePathFromFile`, both being absolute.
pub(crate) fn relative_from_file(from: &str, to: &str) -> String {
    let from: Vec<&str> = crate::resolve::parent_dir(from)
        .split('/')
        .filter(|p| !p.is_empty())
        .collect();
    let to: Vec<&str> = to.split('/').filter(|p| !p.is_empty()).collect();
    let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - shared];
    parts.extend(&to[shared..]);
    match parts.first() {
        None => ".".to_owned(),
        Some(&"..") => parts.join("/"),
        Some(_) => format!("./{}", parts.join("/")),
    }
}

/// `options` is what has been made of `compiler`, the `compilerOptions` as they are written, in the configuration file at `config_path`,
/// which is empty if there is none.
pub fn verify_compiler_options(
    compiler: &Json,
    options: &Options,
    config_path: &str,
) -> Vec<Problem> {
    let mut out: Vec<Problem> = Vec::new();
    let flag = |name: &str| compiler.get(name).and_then(Json::as_bool);
    let is_true = |name: &str| flag(name) == Some(true);
    let is_false = |name: &str| flag(name) == Some(false);
    let text = |name: &str| compiler.get(name).and_then(Json::as_str).unwrap_or("");
    let lower = |name: &str| text(name).to_ascii_lowercase();
    let said = |name: &str| !text(name).is_empty();
    // `createDiagnosticForOptionName`
    fn about(
        out: &mut Vec<Problem>,
        code: u32,
        one: &'static str,
        other: &'static str,
        more: &[&str],
    ) {
        let mut args = vec![one, other];
        args.extend_from_slice(more);
        out.push(Problem::new(code, &args, Place::Key(one, other)));
    }
    // `createRemovedOptionDiagnostic`
    fn removed(out: &mut Vec<Problem>, name: &'static str, value: &str) {
        out.push(if value.is_empty() {
            Problem::new(5102, &[name], Place::Key(name, ""))
        } else {
            Problem::new(5108, &[name, value], Place::Value(name))
        });
    }

    // `convertJsonOption` reports a command-line-only option by its key, whatever its value.
    for name in COMMAND_LINE_ONLY_OPTIONS {
        if compiler.get(name).is_some() {
            out.push(Problem::new(6266, &[name], Place::Key(name, "")));
        }
    }

    // What is no longer there.
    if said("baseUrl") {
        removed(&mut out, "baseUrl", "");
        if !config_path.is_empty() {
            let suggestion = format!("{}/*", relative_from_file(config_path, text("baseUrl")));
            let instead = format!("\"paths\": {{\"*\": [\"{suggestion}\"]}}");
            out.last_mut().unwrap().chain.push((1, 5106, vec![instead]));
        }
    }
    if said("outFile") {
        removed(&mut out, "outFile", "");
    }
    if lower("target") == "es5" {
        removed(&mut out, "target", "ES5");
    }
    match lower("module").as_str() {
        "amd" => removed(&mut out, "module", "AMD"),
        "system" => removed(&mut out, "module", "System"),
        "umd" => removed(&mut out, "module", "UMD"),
        _ => {}
    }
    let resolution_said = lower("moduleResolution");
    if resolution_said == "classic" {
        removed(&mut out, "moduleResolution", "Classic");
    }
    if is_false("alwaysStrict") {
        removed(&mut out, "alwaysStrict", "false");
    }
    if is_false("esModuleInterop") {
        removed(&mut out, "esModuleInterop", "false");
    }
    if is_false("allowSyntheticDefaultImports") {
        removed(&mut out, "allowSyntheticDefaultImports", "false");
    }
    if matches!(resolution_said.as_str(), "node10" | "node") {
        removed(&mut out, "moduleResolution", "node10");
    }
    if flag("downlevelIteration").is_some() {
        removed(&mut out, "downlevelIteration", "");
    }

    for name in ["strictPropertyInitialization", "exactOptionalPropertyTypes"] {
        if is_true(name) && !options.strict_null_checks {
            about(&mut out, 5052, name, "strictNullChecks", &[]);
        }
    }
    // `GetEmitDeclarations`
    let emits_declarations = is_true("declaration") || is_true("composite");
    let needs_declarations = ["declaration", "composite"];
    if is_true("isolatedDeclarations") {
        if options.allow_js {
            about(&mut out, 5053, "allowJs", "isolatedDeclarations", &[]);
        }
        if !emits_declarations {
            about(
                &mut out,
                5069,
                "isolatedDeclarations",
                "declaration",
                &["composite"],
            );
        }
    }
    if is_true("inlineSourceMap") {
        if is_true("sourceMap") {
            about(&mut out, 5053, "sourceMap", "inlineSourceMap", &[]);
        }
        if said("mapRoot") {
            about(&mut out, 5053, "mapRoot", "inlineSourceMap", &[]);
        }
    }
    if is_true("composite") {
        if is_false("declaration") {
            about(&mut out, 6304, "declaration", "", &[]);
        }
        if is_false("incremental") {
            about(&mut out, 6379, "declaration", "", &[]);
        }
    }
    if !said("tsBuildInfoFile") && is_true("incremental") && config_path.is_empty() {
        out.push(Problem::new(5074, &[], Place::CompilerOptions));
    }
    if let Some(paths) = compiler.get("paths").and_then(Json::as_object) {
        for (pattern, value) in paths {
            if !has_at_most_one_asterisk(pattern) {
                out.push(Problem::new(
                    5061,
                    &[pattern],
                    Place::PathsKey(pattern.clone()),
                ));
            }
            let Some(items) = parsed_list(value) else {
                out.push(Problem::new(
                    5063,
                    &[pattern],
                    Place::PathsValue(pattern.clone()),
                ));
                continue;
            };
            // `options.Paths` keeps only the strings of each list.
            let substitutions: Vec<&str> = items.iter().filter_map(Json::as_str).collect();
            if substitutions.is_empty() {
                out.push(Problem::new(
                    5066,
                    &[pattern],
                    Place::PathsValue(pattern.clone()),
                ));
            }
            for (index, substitution) in substitutions.into_iter().enumerate() {
                let at = || Place::PathsElement(pattern.clone(), index);
                if !has_at_most_one_asterisk(substitution) {
                    out.push(Problem::new(5062, &[substitution, pattern], at()));
                }
                if !path_is_relative(substitution)
                    && !path_is_absolute(substitution)
                    && !starts_with_config_dir_template(substitution)
                {
                    out.push(Problem::new(5090, &[], at()));
                }
            }
        }
    }
    if !is_true("sourceMap") && !is_true("inlineSourceMap") {
        if is_true("inlineSources") {
            about(&mut out, 5051, "inlineSources", "", &[]);
        }
        if said("sourceRoot") {
            about(&mut out, 5051, "sourceRoot", "", &[]);
        }
    }
    if said("mapRoot") && !(is_true("sourceMap") || is_true("declarationMap")) {
        about(&mut out, 5069, "mapRoot", "sourceMap", &["declarationMap"]);
    }
    if said("declarationDir") && !emits_declarations {
        about(
            &mut out,
            5069,
            "declarationDir",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    if is_true("declarationMap") && !emits_declarations {
        about(
            &mut out,
            5069,
            "declarationMap",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    // `options.Lib != nil`
    if compiler.get("lib").and_then(parsed_list).is_some() && is_true("noLib") {
        about(&mut out, 5053, "lib", "noLib", &[]);
    }
    if (is_true("isolatedModules") || is_true("verbatimModuleSyntax"))
        && is_false("preserveConstEnums")
    {
        let by = if is_true("verbatimModuleSyntax") {
            "verbatimModuleSyntax"
        } else {
            "isolatedModules"
        };
        about(&mut out, 5091, by, "preserveConstEnums", &[]);
    }
    if is_true("checkJs") && !options.allow_js {
        about(&mut out, 5052, "checkJs", "allowJs", &[]);
    }
    if is_true("emitDeclarationOnly") && !emits_declarations {
        about(
            &mut out,
            5069,
            "emitDeclarationOnly",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    if is_true("emitDecoratorMetadata") && !is_true("experimentalDecorators") {
        about(
            &mut out,
            5052,
            "emitDecoratorMetadata",
            "experimentalDecorators",
            &[],
        );
    }
    // `JsxEmit.String`
    let jsx = match options.jsx {
        JsxEmit::ReactJsx => "react-jsx",
        JsxEmit::ReactJsxDev => "react-jsxdev",
        JsxEmit::React => "react",
        _ => "",
    };
    let is_automatic = matches!(options.jsx, JsxEmit::ReactJsx | JsxEmit::ReactJsxDev);
    // `Option_0_cannot_be_specified_when_option_jsx_is_1`
    let not_with_jsx = |out: &mut Vec<Problem>, name: &'static str| {
        out.push(Problem::new(5089, &[name, jsx], Place::Key(name, "")));
    };
    if said("jsxFactory") {
        if said("reactNamespace") {
            about(&mut out, 5053, "reactNamespace", "jsxFactory", &[]);
        }
        if is_automatic {
            not_with_jsx(&mut out, "jsxFactory");
        }
        if !is_entity_name(text("jsxFactory")) {
            out.push(Problem::new(
                5067,
                &[text("jsxFactory")],
                Place::Value("jsxFactory"),
            ));
        }
    } else if said("reactNamespace") && !is_identifier(text("reactNamespace")) {
        out.push(Problem::new(
            5059,
            &[text("reactNamespace")],
            Place::Value("reactNamespace"),
        ));
    }
    if said("jsxFragmentFactory") {
        if !said("jsxFactory") {
            about(&mut out, 5052, "jsxFragmentFactory", "jsxFactory", &[]);
        }
        if is_automatic {
            not_with_jsx(&mut out, "jsxFragmentFactory");
        }
        if !is_entity_name(text("jsxFragmentFactory")) {
            out.push(Problem::new(
                18035,
                &[text("jsxFragmentFactory")],
                Place::Value("jsxFragmentFactory"),
            ));
        }
    }
    if said("reactNamespace") && is_automatic {
        not_with_jsx(&mut out, "reactNamespace");
    }
    if said("jsxImportSource") && options.jsx == JsxEmit::React {
        not_with_jsx(&mut out, "jsxImportSource");
    }
    if is_true("allowImportingTsExtensions")
        && !(is_true("noEmit")
            || is_true("emitDeclarationOnly")
            || is_true("rewriteRelativeImportExtensions"))
    {
        out.push(Problem::new(
            5096,
            &[],
            Place::Value("allowImportingTsExtensions"),
        ));
    }
    // `GetModuleResolutionKind`
    let module = options.module;
    let resolution = match resolution_said.as_str() {
        "classic" => "Classic",
        "node10" | "node" => "Node10",
        "node16" => "Node16",
        "nodenext" => "NodeNext",
        "bundler" => "Bundler",
        _ if module == ModuleKind::NodeNext => "NodeNext",
        _ if module.is_node() => "Node16",
        _ => "Bundler",
    };
    // `moduleResolutionSupportsPackageJsonExportsAndImports`
    if matches!(resolution, "Classic" | "Node10") {
        for name in ["resolvePackageJsonExports", "resolvePackageJsonImports"] {
            if is_true(name) {
                about(&mut out, 5098, name, "", &[]);
            }
        }
        if compiler
            .get("customConditions")
            .and_then(parsed_list)
            .is_some()
        {
            about(&mut out, 5098, "customConditions", "", &[]);
        }
    }
    if resolution == "Bundler"
        && !(module >= ModuleKind::Es2015 && module <= ModuleKind::EsNext)
        && module != ModuleKind::Preserve
        && module != ModuleKind::CommonJs
    {
        out.push(Problem::new(
            5095,
            &["bundler"],
            Place::Value("moduleResolution"),
        ));
    }
    let resolves_like_node = matches!(resolution, "Node16" | "NodeNext");
    if module.is_node() && !resolves_like_node {
        // `ModuleKindToModuleResolutionKind`
        let wanted = if module == ModuleKind::NodeNext {
            "NodeNext"
        } else {
            "Node16"
        };
        out.push(Problem::new(
            5109,
            &[wanted, module_kind_name(module)],
            Place::Value("moduleResolution"),
        ));
    } else if resolves_like_node && !module.is_node() {
        out.push(Problem::new(
            5110,
            &[resolution, resolution],
            Place::Value("module"),
        ));
    }
    out
}
