//! Configuration diagnostics that do not depend on the program: 5051 5052 5053 5059 5061 5062 5063 5066 5067 5069 5074 5089 5090 5091
//! 5095 5096 5102 5108 5109 5110 6266 6304 6379 18035.
//!
//! A port of `verifyCompilerOptions` (TypeScript 7.0.2, compiler/program.go) without the checks that depend on output paths.

use crate::config::{
    Project, resolve_config_file_name_of_project_reference, starts_with_config_dir_template,
};
use crate::json::{Json, TsConfigSourceFile};
use crate::resolve::{JsxEmit, ModuleKind, Options, path_is_relative};
use crate::util::FxHashSet;
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, relative_normalized};
use strings::without_trailing_slash;

/// `hasZeroOrOneAsteriskCharacter`
fn has_at_most_one_asterisk(text: &[u8]) -> bool {
    text.bytes().filter(|&b| b == b'*').count() <= 1
}

/// `PathIsAbsolute`: `GetEncodedRootLength(path) != 0`
fn path_is_absolute(path: &[u8]) -> bool {
    match path {
        // A POSIX, UNC or untitled (`^/`) root
        [b'/' | b'\\', ..] | [b'^', b'/', ..] => true,
        // A DOS volume: `c:`, `c:/` or `c:\`, but not `c:d`
        [volume, b':'] | [volume, b':', b'/' | b'\\', ..] if volume.is_ascii_alphabetic() => true,
        // A URL
        _ => strings::contains(path, b"://"),
    }
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
fn is_identifier(text: &[u8]) -> bool {
    bun_core::lexer::is_identifier(text)
}

/// `ParseIsolatedEntityName`: whether `text` is an identifier or a qualified name. Keywords count as identifiers, and white space may
/// surround each name. Comments, `\u` escapes and a leading `#!` line are not supported: a text that contains one is rejected.
pub fn is_entity_name(text: &[u8]) -> bool {
    let mut names = text
        .split(|&b| b == b'.')
        .map(|name| name.trim_with(is_white_space_like));
    // `tokenIsIdentifierOrKeyword` is true for a private identifier, so `parseEntityName` accepts
    // `#a` as the first name.
    // `parseRightSideOfDot` rejects it after a dot.
    names
        .next()
        .is_some_and(|first| is_identifier(first.strip_prefix(b"#").unwrap_or(first)))
        && names.all(is_identifier)
}

/// The location in the configuration file at which an options diagnostic is reported.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub enum Place {
    /// `NewCompilerDiagnostic`
    #[default]
    Nowhere,
    /// `createCompilerOptionsDiagnostic`: at the property name `compilerOptions`.
    CompilerOptions,
    /// `createDiagnosticForOption`: at the name of whichever of two options appears first in the
    /// file. The second option may be absent.
    Key(&'static [u8], &'static [u8]),
    /// At the value of the option.
    Value(&'static [u8]),
    /// `createDiagnosticForOptionPaths`: at a pattern in `paths`, or at its list of substitutions.
    PathsKey(Vec<u8>),
    PathsValue(Vec<u8>),
    /// `createDiagnosticForOptionPathKeyValue`: at one of those substitutions.
    PathsElement(Vec<u8>, usize),
    /// `ForEachTsConfigPropArray`: at the value of a property that is a sibling of
    /// `compilerOptions`.
    Top(&'static [u8]),
    /// `GetTsConfigPropArrayElementValue`: at the string in that array. No location if it is not in
    /// this file.
    TopElement(&'static [u8], Vec<u8>),
    /// `CreateDiagnosticAtReferenceSyntax`: at an element of `references`. No location if the index
    /// is out of range.
    Reference(usize),
}

/// A diagnostic about the options.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Problem {
    pub code: u32,
    pub args: Vec<Vec<u8>>,
    /// `AddMessageChain`: the chained messages below it. For each: its indentation level, its code,
    /// its message arguments.
    pub chain: Vec<(u32, u32, Vec<Vec<u8>>)>,
    pub at: Place,
}

impl Problem {
    pub fn new(code: u32, args: &[&[u8]], at: Place) -> Problem {
        Problem {
            code,
            args: args.iter().map(|&a| a.to_vec()).collect(),
            chain: Vec::new(),
            at,
        }
    }

    /// Appends `code` to the message chain at indentation `level`.
    pub fn with(mut self, level: u32, code: u32, args: &[&[u8]]) -> Problem {
        self.chain
            .push((level, code, args.iter().map(|&a| a.to_vec()).collect()));
        self
    }

    /// Its span in the configuration file. `None`: it has no location in the file.
    pub fn span_in(&self, file: &TsConfigSourceFile) -> Option<(u32, u32)> {
        if self.at == Place::Nowhere {
            return None;
        }
        let root = file.root?;
        let value_of =
            |object, name: &[u8]| Some(file.initializer(file.property(object, name, b"")?));
        if let Place::Reference(index) = self.at {
            let list = value_of(root, b"references")?;
            return file.elements(list).nth(index).map(|e| file.span(e));
        }
        if let Place::Top(name) | Place::TopElement(name, _) = &self.at {
            let list = value_of(root, name)?;
            let Place::TopElement(_, specified) = &self.at else {
                return Some(file.span(list));
            };
            let is_it = |&e: &_| file.convert_property_value_to_json(e).as_str() == Some(specified);
            return file.elements(list).find(is_it).map(|e| file.span(e));
        }
        let options = file.property(root, b"compilerOptions", b"")?;
        let written = file.initializer(options);
        let in_paths = |key: &[u8]| file.property(value_of(written, b"paths")?, key, b"");
        let found = match &self.at {
            Place::Nowhere
            | Place::CompilerOptions
            | Place::Top(_)
            | Place::TopElement(..)
            | Place::Reference(_) => None,
            Place::Key(name, other) => file
                .property(written, name, other)
                .map(|p| file.name_span(p)),
            Place::Value(name) => value_of(written, name).map(|e| file.span(e)),
            Place::PathsKey(key) => in_paths(key).map(|p| file.name_span(p)),
            Place::PathsValue(key) => in_paths(key).map(|p| file.span(file.initializer(p))),
            Place::PathsElement(key, index) => in_paths(key)
                .and_then(|p| file.elements(file.initializer(p)).nth(*index))
                .map(|e| file.span(e)),
        };
        Some(found.unwrap_or_else(|| file.name_span(options)))
    }
}

/// `GetRelativePathFromFile` for two absolute paths.
pub(crate) fn relative_from_file(from: &[u8], to: &[u8]) -> Vec<u8> {
    let relative = relative_normalized::<Posix, true>(dirname::<Posix>(from), to);
    // `EnsurePathIsNonModuleName`
    if relative == b".." || relative.starts_with(b"../") {
        relative.to_vec()
    } else {
        [b"./", relative].concat()
    }
}

/// `verifyProjectReferences`: the diagnostics for the projects `root` references, directly or
/// transitively, each with the configuration file that references it. `resolved`: the project of a
/// configuration file, if the file exists.
pub fn verify_project_references<'a>(
    root: &'a Project,
    resolved: &dyn Fn(&[u8]) -> Option<&'a Project>,
) -> Vec<(&'a [u8], Problem)> {
    let build_info_file_name = if root.options.suppress_output_path_check {
        Vec::new()
    } else {
        root.get_build_info_file_name()
    };
    let mut out = Vec::new();
    // `rangeResolvedReferenceWorker`: a project and the index of its next reference.
    let mut seen = FxHashSet::from_iter([root.config_path.clone()]);
    let mut pending = vec![(root, 0)];
    while let Some((parent, index)) = pending.pop() {
        let Some(reference) = parent.references.get(index).map(|r| r.path.as_slice()) else {
            continue;
        };
        pending.push((parent, index + 1));
        let path = resolve_config_file_name_of_project_reference(reference);
        let config = resolved(&path);
        if !seen.insert(path) {
            continue;
        }
        let mut say = |code, args: &[&[u8]]| {
            let problem = Problem::new(code, args, Place::Reference(index));
            out.push((parent.config_path.as_slice(), problem));
        };
        let Some(config) = config else {
            say(6053, &[reference]);
            continue;
        };
        if !parent.files.is_empty() {
            if !config.options.composite {
                say(6306, &[reference]);
            }
            if config.options.no_emit {
                say(6310, &[reference]);
            }
        }
        if !build_info_file_name.is_empty()
            && build_info_file_name == config.get_build_info_file_name()
        {
            say(6377, &[&build_info_file_name, reference]);
        }
        pending.push((config, 0));
    }
    out
}

/// `options` was built from `compiler`, the raw `compilerOptions`, in the configuration file at
/// `config_path`, which is empty if there is none.
pub fn verify_compiler_options(
    compiler: &Json,
    options: &Options,
    config_path: &[u8],
) -> Vec<Problem> {
    let mut out: Vec<Problem> = Vec::new();
    let flag = |name: &[u8]| compiler.get(name).and_then(Json::as_bool);
    let is_true = |name: &[u8]| flag(name) == Some(true);
    let is_false = |name: &[u8]| flag(name) == Some(false);
    let text = |name: &[u8]| compiler.get(name).and_then(Json::as_str).unwrap_or(b"");
    let lower = |name: &[u8]| text(name).to_ascii_lowercase();
    let specified = |name: &[u8]| !text(name).is_empty();
    // `createDiagnosticForOptionName`
    fn about(
        out: &mut Vec<Problem>,
        code: u32,
        one: &'static [u8],
        other: &'static [u8],
        more: &[&[u8]],
    ) {
        let mut args = vec![one, other];
        args.extend_from_slice(more);
        out.push(Problem::new(code, &args, Place::Key(one, other)));
    }
    // `createRemovedOptionDiagnostic`
    fn removed(out: &mut Vec<Problem>, name: &'static [u8], value: &[u8]) {
        out.push(if value.is_empty() {
            Problem::new(5102, &[name], Place::Key(name, b""))
        } else {
            Problem::new(5108, &[name, value], Place::Value(name))
        });
    }

    // Removed options.
    if specified(b"baseUrl") {
        removed(&mut out, b"baseUrl", b"");
        if !config_path.is_empty() {
            let mut relative = relative_from_file(config_path, text(b"baseUrl"));
            // So `..` becomes `./..`.
            if !(relative.starts_with(b"./") || relative.starts_with(b"../")) {
                relative.splice(0..0, *b"./");
            }
            let suggestion = without_trailing_slash(&relative);
            let instead = [b"\"paths\": {\"*\": [\"", suggestion, b"/*\"]}"].concat();
            out.last_mut().unwrap().chain.push((1, 5106, vec![instead]));
        }
    }
    if specified(b"outFile") {
        removed(&mut out, b"outFile", b"");
    }
    if lower(b"target") == b"es5" {
        removed(&mut out, b"target", b"ES5");
    }
    match lower(b"module").as_slice() {
        b"amd" => removed(&mut out, b"module", b"AMD"),
        b"system" => removed(&mut out, b"module", b"System"),
        b"umd" => removed(&mut out, b"module", b"UMD"),
        _ => {}
    }
    let resolution_reported = lower(b"moduleResolution");
    if resolution_reported == b"classic" {
        removed(&mut out, b"moduleResolution", b"Classic");
    }
    if is_false(b"alwaysStrict") {
        removed(&mut out, b"alwaysStrict", b"false");
    }
    if is_false(b"esModuleInterop") {
        removed(&mut out, b"esModuleInterop", b"false");
    }
    if is_false(b"allowSyntheticDefaultImports") {
        removed(&mut out, b"allowSyntheticDefaultImports", b"false");
    }
    if matches!(resolution_reported.as_slice(), b"node10" | b"node") {
        removed(&mut out, b"moduleResolution", b"node10");
    }
    if flag(b"downlevelIteration").is_some() {
        removed(&mut out, b"downlevelIteration", b"");
    }

    for name in [
        b"strictPropertyInitialization".as_slice(),
        b"exactOptionalPropertyTypes",
    ] {
        if is_true(name) && !options.strict_null_checks {
            about(&mut out, 5052, name, b"strictNullChecks", &[]);
        }
    }
    // `GetEmitDeclarations`
    let emits_declarations = is_true(b"declaration") || is_true(b"composite");
    let needs_declarations = [b"declaration".as_slice(), b"composite"];
    if is_true(b"isolatedDeclarations") {
        if options.allow_js {
            about(&mut out, 5053, b"allowJs", b"isolatedDeclarations", &[]);
        }
        if !emits_declarations {
            about(
                &mut out,
                5069,
                b"isolatedDeclarations",
                b"declaration",
                &[b"composite"],
            );
        }
    }
    if is_true(b"inlineSourceMap") {
        if is_true(b"sourceMap") {
            about(&mut out, 5053, b"sourceMap", b"inlineSourceMap", &[]);
        }
        if specified(b"mapRoot") {
            about(&mut out, 5053, b"mapRoot", b"inlineSourceMap", &[]);
        }
    }
    if is_true(b"composite") {
        if is_false(b"declaration") {
            about(&mut out, 6304, b"declaration", b"", &[]);
        }
        if is_false(b"incremental") {
            about(&mut out, 6379, b"declaration", b"", &[]);
        }
    }
    if !specified(b"tsBuildInfoFile") && is_true(b"incremental") && config_path.is_empty() {
        out.push(Problem::new(5074, &[], Place::CompilerOptions));
    }
    if let Some(paths) = compiler.get(b"paths").and_then(Json::as_object) {
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
            let substitutions: Vec<&[u8]> = items.iter().filter_map(Json::as_str).collect();
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
    if !is_true(b"sourceMap") && !is_true(b"inlineSourceMap") {
        if is_true(b"inlineSources") {
            about(&mut out, 5051, b"inlineSources", b"", &[]);
        }
        if specified(b"sourceRoot") {
            about(&mut out, 5051, b"sourceRoot", b"", &[]);
        }
    }
    if specified(b"mapRoot") && !(is_true(b"sourceMap") || is_true(b"declarationMap")) {
        about(
            &mut out,
            5069,
            b"mapRoot",
            b"sourceMap",
            &[b"declarationMap"],
        );
    }
    if specified(b"declarationDir") && !emits_declarations {
        about(
            &mut out,
            5069,
            b"declarationDir",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    if is_true(b"declarationMap") && !emits_declarations {
        about(
            &mut out,
            5069,
            b"declarationMap",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    // `options.Lib != nil`
    if compiler.get(b"lib").and_then(parsed_list).is_some() && is_true(b"noLib") {
        about(&mut out, 5053, b"lib", b"noLib", &[]);
    }
    if (is_true(b"isolatedModules") || is_true(b"verbatimModuleSyntax"))
        && is_false(b"preserveConstEnums")
    {
        let by: &[u8] = if is_true(b"verbatimModuleSyntax") {
            b"verbatimModuleSyntax"
        } else {
            b"isolatedModules"
        };
        about(&mut out, 5091, by, b"preserveConstEnums", &[]);
    }
    if is_true(b"checkJs") && !options.allow_js {
        about(&mut out, 5052, b"checkJs", b"allowJs", &[]);
    }
    if is_true(b"emitDeclarationOnly") && !emits_declarations {
        about(
            &mut out,
            5069,
            b"emitDeclarationOnly",
            needs_declarations[0],
            &needs_declarations[1..],
        );
    }
    if is_true(b"emitDecoratorMetadata") && !is_true(b"experimentalDecorators") {
        about(
            &mut out,
            5052,
            b"emitDecoratorMetadata",
            b"experimentalDecorators",
            &[],
        );
    }
    // `JsxEmit.String`
    let jsx: &[u8] = match options.jsx {
        JsxEmit::ReactJsx => b"react-jsx",
        JsxEmit::ReactJsxDev => b"react-jsxdev",
        JsxEmit::React => b"react",
        _ => b"",
    };
    let is_automatic = matches!(options.jsx, JsxEmit::ReactJsx | JsxEmit::ReactJsxDev);
    // `Option_0_cannot_be_specified_when_option_jsx_is_1`
    let not_with_jsx = |out: &mut Vec<Problem>, name: &'static [u8]| {
        out.push(Problem::new(5089, &[name, jsx], Place::Key(name, b"")));
    };
    if specified(b"jsxFactory") {
        if specified(b"reactNamespace") {
            about(&mut out, 5053, b"reactNamespace", b"jsxFactory", &[]);
        }
        if is_automatic {
            not_with_jsx(&mut out, b"jsxFactory");
        }
        if !is_entity_name(text(b"jsxFactory")) {
            out.push(Problem::new(
                5067,
                &[text(b"jsxFactory")],
                Place::Value(b"jsxFactory"),
            ));
        }
    } else if specified(b"reactNamespace") && !is_identifier(text(b"reactNamespace")) {
        out.push(Problem::new(
            5059,
            &[text(b"reactNamespace")],
            Place::Value(b"reactNamespace"),
        ));
    }
    if specified(b"jsxFragmentFactory") {
        if !specified(b"jsxFactory") {
            about(&mut out, 5052, b"jsxFragmentFactory", b"jsxFactory", &[]);
        }
        if is_automatic {
            not_with_jsx(&mut out, b"jsxFragmentFactory");
        }
        if !is_entity_name(text(b"jsxFragmentFactory")) {
            out.push(Problem::new(
                18035,
                &[text(b"jsxFragmentFactory")],
                Place::Value(b"jsxFragmentFactory"),
            ));
        }
    }
    if specified(b"reactNamespace") && is_automatic {
        not_with_jsx(&mut out, b"reactNamespace");
    }
    if specified(b"jsxImportSource") && options.jsx == JsxEmit::React {
        not_with_jsx(&mut out, b"jsxImportSource");
    }
    if is_true(b"allowImportingTsExtensions")
        && !(is_true(b"noEmit")
            || is_true(b"emitDeclarationOnly")
            || is_true(b"rewriteRelativeImportExtensions"))
    {
        out.push(Problem::new(
            5096,
            &[],
            Place::Value(b"allowImportingTsExtensions"),
        ));
    }
    // `GetModuleResolutionKind`: `classic` and `node10` are treated as unspecified.
    let module = options.module;
    let resolution: &[u8] = match resolution_reported.as_slice() {
        b"node16" => b"Node16",
        b"nodenext" => b"NodeNext",
        b"bundler" => b"Bundler",
        _ if module == ModuleKind::NodeNext => b"NodeNext",
        _ if module.is_node() => b"Node16",
        _ => b"Bundler",
    };
    if resolution == b"Bundler"
        && !(module >= ModuleKind::Es2015 && module <= ModuleKind::EsNext)
        && module != ModuleKind::Preserve
        && module != ModuleKind::CommonJs
    {
        out.push(Problem::new(
            5095,
            &[b"bundler".as_slice()],
            Place::Value(b"moduleResolution"),
        ));
    }
    let resolves_like_node = matches!(resolution, b"Node16" | b"NodeNext");
    if module.is_node() && !resolves_like_node {
        // `ModuleKindToModuleResolutionKind`
        let expected: &[u8] = if module == ModuleKind::NodeNext {
            b"NodeNext"
        } else {
            b"Node16"
        };
        out.push(Problem::new(
            5109,
            &[expected, module.name()],
            Place::Value(b"moduleResolution"),
        ));
    } else if resolves_like_node && !module.is_node() {
        out.push(Problem::new(
            5110,
            &[resolution, resolution],
            Place::Value(b"module"),
        ));
    }
    out
}
