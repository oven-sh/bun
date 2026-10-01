//! Configuration diagnostics that do not depend on the program: 5051 5052 5053 5059 5061 5062 5063 5066 5067 5069 5089 5090 5091 5095
//! 5096 5102 5108 5109 5110 6266 6304 6379 18035.
//!
//! A port of `verifyCompilerOptions` (TypeScript 7.0.2, compiler/program.go) without the checks that depend on output paths. 6266 is
//! reported by `convertJsonOption` (tsoptions) while the configuration is parsed.

use crate::check::errors_x_regexp_scanner::{is_identifier_part, is_identifier_start};
use crate::json::Json;
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

/// The codes, in order, each once. `options` is what has been made of `compiler`, the `compilerOptions` as they are written.
pub fn verify_compiler_options(compiler: &Json, options: &Options) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    let flag = |name: &str| compiler.get(name).and_then(Json::as_bool);
    let is_true = |name: &str| flag(name) == Some(true);
    let is_false = |name: &str| flag(name) == Some(false);
    let text = |name: &str| compiler.get(name).and_then(Json::as_str).unwrap_or("");
    let lower = |name: &str| text(name).to_ascii_lowercase();
    let said = |name: &str| !text(name).is_empty();

    // `convertJsonOption` reports a command-line-only option by its key, whatever its value.
    if COMMAND_LINE_ONLY_OPTIONS
        .iter()
        .any(|name| compiler.get(name).is_some())
    {
        out.push(6266);
    }

    // What is no longer there.
    if said("baseUrl") || said("outFile") || flag("downlevelIteration").is_some() {
        out.push(5102);
    }
    if lower("target") == "es5"
        || matches!(lower("module").as_str(), "amd" | "system" | "umd")
        || matches!(
            lower("moduleResolution").as_str(),
            "classic" | "node10" | "node"
        )
        || is_false("alwaysStrict")
        || is_false("esModuleInterop")
        || is_false("allowSyntheticDefaultImports")
    {
        out.push(5108);
    }

    if (is_true("strictPropertyInitialization") || is_true("exactOptionalPropertyTypes"))
        && !options.strict_null_checks
    {
        out.push(5052);
    }
    // `GetEmitDeclarations`
    let emits_declarations = is_true("declaration") || is_true("composite");
    if is_true("isolatedDeclarations") {
        if options.allow_js {
            out.push(5053);
        }
        if !emits_declarations {
            out.push(5069);
        }
    }
    if is_true("inlineSourceMap") && (is_true("sourceMap") || said("mapRoot")) {
        out.push(5053);
    }
    if is_true("composite") {
        if is_false("declaration") {
            out.push(6304);
        }
        if is_false("incremental") {
            out.push(6379);
        }
    }
    if let Some(paths) = compiler.get("paths").and_then(Json::as_object) {
        for (pattern, value) in paths {
            if !has_at_most_one_asterisk(pattern) {
                out.push(5061);
            }
            let Some(items) = parsed_list(value) else {
                out.push(5063);
                continue;
            };
            // `options.Paths` keeps only the strings of each list.
            let mut substitutions = items.iter().filter_map(Json::as_str).peekable();
            if substitutions.peek().is_none() {
                out.push(5066);
            }
            for substitution in substitutions {
                if !has_at_most_one_asterisk(substitution) {
                    out.push(5062);
                }
                if !path_is_relative(substitution)
                    && !path_is_absolute(substitution)
                    && !starts_with_config_dir_template(substitution)
                {
                    out.push(5090);
                }
            }
        }
    }
    if !is_true("sourceMap")
        && !is_true("inlineSourceMap")
        && (is_true("inlineSources") || said("sourceRoot"))
    {
        out.push(5051);
    }
    if said("mapRoot") && !(is_true("sourceMap") || is_true("declarationMap")) {
        out.push(5069);
    }
    if (said("declarationDir") || is_true("declarationMap") || is_true("emitDeclarationOnly"))
        && !emits_declarations
    {
        out.push(5069);
    }
    // `options.Lib != nil`
    if compiler.get("lib").and_then(parsed_list).is_some() && is_true("noLib") {
        out.push(5053);
    }
    if (is_true("isolatedModules") || is_true("verbatimModuleSyntax"))
        && is_false("preserveConstEnums")
    {
        out.push(5091);
    }
    if is_true("checkJs") && !options.allow_js {
        out.push(5052);
    }
    if is_true("emitDecoratorMetadata") && !is_true("experimentalDecorators") {
        out.push(5052);
    }
    let is_automatic = matches!(options.jsx, JsxEmit::ReactJsx | JsxEmit::ReactJsxDev);
    if said("jsxFactory") {
        if said("reactNamespace") {
            out.push(5053);
        }
        if is_automatic {
            out.push(5089);
        }
        if !is_entity_name(text("jsxFactory")) {
            out.push(5067);
        }
    } else if said("reactNamespace") && !is_identifier(text("reactNamespace")) {
        out.push(5059);
    }
    if said("jsxFragmentFactory") {
        if !said("jsxFactory") {
            out.push(5052);
        }
        if is_automatic {
            out.push(5089);
        }
        if !is_entity_name(text("jsxFragmentFactory")) {
            out.push(18035);
        }
    }
    if said("reactNamespace") && is_automatic
        || said("jsxImportSource") && options.jsx == JsxEmit::React
    {
        out.push(5089);
    }
    if is_true("allowImportingTsExtensions")
        && !(is_true("noEmit")
            || is_true("emitDeclarationOnly")
            || is_true("rewriteRelativeImportExtensions"))
    {
        out.push(5096);
    }
    // `GetModuleResolutionKind`: like Node, or like a bundler. Both know of `exports` and `imports` in a package.json, and there is
    // nothing else left.
    let is_bundler = !options.resolves_like_node;
    let module = options.module;
    if is_bundler
        && !(module >= ModuleKind::Es2015 && module <= ModuleKind::EsNext)
        && module != ModuleKind::Preserve
        && module != ModuleKind::CommonJs
    {
        out.push(5095);
    }
    if module.is_node() && !options.resolves_like_node {
        out.push(5109);
    } else if options.resolves_like_node && !module.is_node() {
        out.push(5110);
    }
    out.sort_unstable();
    out.dedup();
    out
}
