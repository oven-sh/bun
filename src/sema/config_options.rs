//! What is wrong with the `compilerOptions` of a configuration file as they are written: an option there is no such thing as, or a value
//! that is not the kind of thing the option takes.
//!
//! Configuration files are written for all versions of TypeScript. What an older version took and the current one has removed is let
//! through without a word. Only what never meant anything is a mistake.

use crate::json::Json;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Element {
    String,
    Object,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Kind {
    Boolean,
    String,
    Number,
    Object,
    List(Element),
    /// What it can be, and what it could be once. Upper and lower case are the same.
    OneOf(&'static [&'static str], &'static [&'static str]),
}

/// `optionDeclarations`, less what is only for the command line. Sorted by name.
const OPTIONS: &[(&str, Kind)] = &[
    ("all", Kind::Boolean),
    ("allowArbitraryExtensions", Kind::Boolean),
    ("allowImportingTsExtensions", Kind::Boolean),
    ("allowJs", Kind::Boolean),
    ("allowSyntheticDefaultImports", Kind::Boolean),
    ("allowUmdGlobalAccess", Kind::Boolean),
    ("allowUnreachableCode", Kind::Boolean),
    ("allowUnusedLabels", Kind::Boolean),
    ("alwaysStrict", Kind::Boolean),
    ("assumeChangesOnlyAffectDirectDependencies", Kind::Boolean),
    ("baseUrl", Kind::String),
    ("charset", Kind::String),
    ("checkJs", Kind::Boolean),
    ("checkers", Kind::Number),
    ("composite", Kind::Boolean),
    ("customConditions", Kind::List(Element::String)),
    ("declaration", Kind::Boolean),
    ("declarationDir", Kind::String),
    ("declarationMap", Kind::Boolean),
    ("deduplicatePackages", Kind::Boolean),
    ("diagnostics", Kind::Boolean),
    ("disableReferencedProjectLoad", Kind::Boolean),
    ("disableSizeLimit", Kind::Boolean),
    ("disableSolutionSearching", Kind::Boolean),
    ("disableSourceOfProjectReferenceRedirect", Kind::Boolean),
    ("downlevelIteration", Kind::Boolean),
    ("emitBOM", Kind::Boolean),
    ("emitDeclarationOnly", Kind::Boolean),
    ("emitDecoratorMetadata", Kind::Boolean),
    ("erasableSyntaxOnly", Kind::Boolean),
    ("esModuleInterop", Kind::Boolean),
    ("exactOptionalPropertyTypes", Kind::Boolean),
    ("experimentalDecorators", Kind::Boolean),
    ("explainFiles", Kind::Boolean),
    ("extendedDiagnostics", Kind::Boolean),
    ("forceConsistentCasingInFileNames", Kind::Boolean),
    ("generateCpuProfile", Kind::String),
    ("generateTrace", Kind::String),
    ("ignoreDeprecations", Kind::String),
    ("importHelpers", Kind::Boolean),
    (
        "importsNotUsedAsValues",
        Kind::OneOf(&["remove", "preserve", "error"], &[]),
    ),
    ("incremental", Kind::Boolean),
    ("init", Kind::Boolean),
    ("inlineSourceMap", Kind::Boolean),
    ("inlineSources", Kind::Boolean),
    ("isolatedDeclarations", Kind::Boolean),
    ("isolatedModules", Kind::Boolean),
    (
        "jsx",
        Kind::OneOf(
            &[
                "preserve",
                "react-native",
                "react-jsx",
                "react-jsxdev",
                "react",
            ],
            &[],
        ),
    ),
    ("jsxFactory", Kind::String),
    ("jsxFragmentFactory", Kind::String),
    ("jsxImportSource", Kind::String),
    ("keyofStringsOnly", Kind::Boolean),
    ("lib", Kind::List(Element::String)),
    ("libReplacement", Kind::Boolean),
    ("listEmittedFiles", Kind::Boolean),
    ("listFiles", Kind::Boolean),
    ("mapRoot", Kind::String),
    ("maxNodeModuleJsDepth", Kind::Number),
    (
        "module",
        Kind::OneOf(
            &[
                "commonjs", "es6", "es2015", "es2020", "es2022", "esnext", "node16", "node18",
                "node20", "nodenext", "preserve",
            ],
            &["none", "amd", "system", "umd"],
        ),
    ),
    (
        "moduleDetection",
        Kind::OneOf(&["auto", "legacy", "force"], &[]),
    ),
    (
        "moduleResolution",
        Kind::OneOf(
            &["node16", "nodenext", "bundler"],
            &["classic", "node", "node10"],
        ),
    ),
    ("moduleSuffixes", Kind::List(Element::String)),
    ("newLine", Kind::OneOf(&["crlf", "lf"], &[])),
    ("noCheck", Kind::Boolean),
    ("noEmit", Kind::Boolean),
    ("noEmitHelpers", Kind::Boolean),
    ("noEmitOnError", Kind::Boolean),
    ("noErrorTruncation", Kind::Boolean),
    ("noFallthroughCasesInSwitch", Kind::Boolean),
    ("noImplicitAny", Kind::Boolean),
    ("noImplicitOverride", Kind::Boolean),
    ("noImplicitReturns", Kind::Boolean),
    ("noImplicitThis", Kind::Boolean),
    ("noImplicitUseStrict", Kind::Boolean),
    ("noLib", Kind::Boolean),
    ("noPropertyAccessFromIndexSignature", Kind::Boolean),
    ("noResolve", Kind::Boolean),
    ("noStrictGenericChecks", Kind::Boolean),
    ("noUncheckedIndexedAccess", Kind::Boolean),
    ("noUncheckedSideEffectImports", Kind::Boolean),
    ("noUnusedLocals", Kind::Boolean),
    ("noUnusedParameters", Kind::Boolean),
    ("out", Kind::String),
    ("outDir", Kind::String),
    ("outFile", Kind::String),
    ("paths", Kind::Object),
    ("plugins", Kind::List(Element::Object)),
    ("pprofDir", Kind::String),
    ("preserveConstEnums", Kind::Boolean),
    ("preserveSymlinks", Kind::Boolean),
    ("preserveValueImports", Kind::Boolean),
    ("preserveWatchOutput", Kind::Boolean),
    ("pretty", Kind::Boolean),
    ("project", Kind::String),
    ("quiet", Kind::Boolean),
    ("reactNamespace", Kind::String),
    ("removeComments", Kind::Boolean),
    ("resolveJsonModule", Kind::Boolean),
    ("resolvePackageJsonExports", Kind::Boolean),
    ("resolvePackageJsonImports", Kind::Boolean),
    ("rewriteRelativeImportExtensions", Kind::Boolean),
    ("rootDir", Kind::String),
    ("rootDirs", Kind::List(Element::String)),
    ("singleThreaded", Kind::Boolean),
    ("skipDefaultLibCheck", Kind::Boolean),
    ("skipLibCheck", Kind::Boolean),
    ("sourceMap", Kind::Boolean),
    ("sourceRoot", Kind::String),
    ("stableTypeOrdering", Kind::Boolean),
    ("strict", Kind::Boolean),
    ("strictBindCallApply", Kind::Boolean),
    ("strictBuiltinIteratorReturn", Kind::Boolean),
    ("strictFunctionTypes", Kind::Boolean),
    ("strictNullChecks", Kind::Boolean),
    ("strictPropertyInitialization", Kind::Boolean),
    ("stripInternal", Kind::Boolean),
    ("suppressExcessPropertyErrors", Kind::Boolean),
    ("suppressImplicitAnyIndexErrors", Kind::Boolean),
    (
        "target",
        Kind::OneOf(
            &[
                "es6", "es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021",
                "es2022", "es2023", "es2024", "es2025", "esnext",
            ],
            &["es3", "es5"],
        ),
    ),
    ("traceResolution", Kind::Boolean),
    ("tsBuildInfoFile", Kind::String),
    ("typeRoots", Kind::List(Element::String)),
    ("types", Kind::List(Element::String)),
    ("useDefineForClassFields", Kind::Boolean),
    ("useUnknownInCatchVariables", Kind::Boolean),
    ("verbatimModuleSyntax", Kind::Boolean),
    ("version", Kind::Boolean),
];

/// The options declared `IsCommandLineOnly` (tsoptions).
const COMMAND_LINE_ONLY_OPTIONS: [&str; 6] = [
    "help",
    "ignoreConfig",
    "listFilesOnly",
    "locale",
    "showConfig",
    "watch",
];

/// What older versions took and TypeScript 7 has no such option as.
const REMOVED: &[&str] = &[
    "charset",
    "importsNotUsedAsValues",
    "keyofStringsOnly",
    "noImplicitUseStrict",
    "noStrictGenericChecks",
    "out",
    "preserveValueImports",
    "suppressExcessPropertyErrors",
    "suppressImplicitAnyIndexErrors",
];

/// Something wrong with an option.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Problem {
    /// The option, as it is written.
    pub name: String,
    /// The code of TypeScript's message, and what goes into it.
    pub code: u32,
    pub args: Vec<String>,
    /// Where it is in the file: from, to.
    pub span: Option<(u32, u32)>,
}

/// What `--name text` on a command line means: the option as it is spelled, whatever the case of `name`, and its value. `None`: there is
/// no such option, it takes something that cannot be written in a word, or `text` is not the kind of thing it takes.
pub fn from_text(name: &str, text: &str) -> Option<(&'static str, Json)> {
    let &(name, kind) = OPTIONS
        .iter()
        .find(|option| option.0.eq_ignore_ascii_case(name))?;
    let value = match kind {
        Kind::Boolean if text.eq_ignore_ascii_case("true") => Json::Bool(true),
        Kind::Boolean if text.eq_ignore_ascii_case("false") => Json::Bool(false),
        Kind::Boolean | Kind::Object | Kind::List(Element::Object) => return None,
        Kind::String | Kind::OneOf(..) => Json::String(text.to_owned()),
        Kind::Number => Json::Number(text.trim().parse().ok()?),
        // `ParseListTypeOption`: of the items only those that are one of a few words are trimmed.
        Kind::List(Element::String) => Json::Array(
            text.trim()
                .split(',')
                .map(|item| if name == "lib" { item.trim() } else { item })
                .filter(|item| !item.is_empty())
                .map(|item| Json::String(item.to_owned()))
                .collect(),
        ),
    };
    Some((name, value))
}

/// Whether the option `name`, whatever its case, is one of a few words or yes or no, and the words it can be.
pub fn choices(name: &str) -> Option<&'static [&'static str]> {
    match OPTIONS
        .iter()
        .find(|option| option.0.eq_ignore_ascii_case(name))?
        .1
    {
        Kind::Boolean => Some(&["true", "false"]),
        Kind::OneOf(now, _) => Some(now),
        _ => None,
    }
}

fn kind_of(name: &str) -> Option<Kind> {
    OPTIONS
        .binary_search_by_key(&name, |option| option.0)
        .ok()
        .map(|at| OPTIONS[at].1)
}

/// `getSpellingSuggestion`: the option whose name is nearest to `name`, if any is near.
fn nearest(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    // The same but for upper and lower case is as near as can be.
    if let Some(option) = OPTIONS.iter().find(|o| o.0.to_lowercase() == lower) {
        return Some(option.0);
    }
    let most = (name.len() as f64 * 0.34).floor().max(1.0) as usize;
    OPTIONS
        .iter()
        .filter(|o| o.0.len().abs_diff(name.len()) <= most)
        .map(|o| (distance(&lower, &o.0.to_lowercase()), o.0))
        .filter(|&(distance, _)| distance <= most)
        .min_by_key(|&(distance, _)| distance)
        .map(|(_, name)| name)
}

/// How many letters have to be put in, taken out or changed to make `a` of `b`.
fn distance(a: &str, b: &str) -> usize {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let changed = diagonal + usize::from(x != y);
            diagonal = row[j + 1];
            row[j + 1] = changed.min(row[j] + 1).min(row[j + 1] + 1);
        }
    }
    row[b.len()]
}

/// Where the options are written in `text`: for each, the name, where the name is and where the value is.
fn spans(text: &[u8]) -> Vec<(String, (u32, u32), (u32, u32))> {
    let mut out = Vec::new();
    let mut at = 0;
    // How many brackets are open, and at which count `compilerOptions` opened.
    let (mut depth, mut inside) = (0usize, None);
    // The last name met where a name can be, and where the value after it starts.
    let mut name: Option<(String, (u32, u32))> = None;
    let mut value: Option<(String, (u32, u32), u32)> = None;
    let mut last_end = 0;
    while at < text.len() {
        let c = text[at];
        match c {
            b'/' if text.get(at + 1) == Some(&b'/') => {
                at += bun_core::strings::index_of_char_usize(&text[at..], b'\n')
                    .unwrap_or(text.len() - at);
                continue;
            }
            b'/' if text.get(at + 1) == Some(&b'*') => {
                at += bun_core::strings::index_of(&text[at..], b"*/")
                    .map_or(text.len() - at, |end| end + 2);
                continue;
            }
            b' ' | b'\t' | b'\r' | b'\n' => {
                at += 1;
                continue;
            }
            _ => {}
        }
        let is_at_options = inside.is_some_and(|opened| depth == opened);
        // A value starts with whatever comes after the colon.
        if is_at_options
            && c != b':'
            && let Some((name, span)) =
                name.take_if(|_| value.is_none() && text[..at].ends_with_colon())
        {
            value = Some((name, span, at as u32));
        }
        match c {
            b'"' | b'\'' => {
                let start = at;
                at += 1;
                while at < text.len() && text[at] != c {
                    at += 1 + usize::from(text[at] == b'\\');
                }
                at = (at + 1).min(text.len());
                last_end = at;
                if value.is_none() {
                    let written = String::from_utf8_lossy(
                        &text[start + 1..at.saturating_sub(1).max(start + 1)],
                    );
                    name = Some((written.into_owned(), (start as u32, at as u32)));
                }
                continue;
            }
            b'{' | b'[' => {
                if c == b'{'
                    && depth == 1
                    && inside.is_none()
                    && name.as_ref().is_some_and(|n| n.0 == "compilerOptions")
                {
                    inside = Some(2);
                    name = None;
                }
                depth += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                if inside.is_some_and(|opened| depth < opened) {
                    if let Some((name, span, start)) = value.take() {
                        out.push((name, span, (start, last_end as u32)));
                    }
                    return out;
                }
                last_end = at + 1;
            }
            b',' if is_at_options => {
                if let Some((name, span, start)) = value.take() {
                    out.push((name, span, (start, last_end as u32)));
                }
                name = None;
            }
            b':' | b',' => {}
            _ => last_end = at + 1,
        }
        at += 1;
    }
    out
}

trait EndsWithColon {
    fn ends_with_colon(&self) -> bool;
}

impl EndsWithColon for [u8] {
    /// Whether the last thing written is a colon. Comments between a colon and a value are rare enough to be taken for part of the value.
    fn ends_with_colon(&self) -> bool {
        self.iter()
            .rev()
            .find(|c| !c.is_ascii_whitespace())
            .is_some_and(|&c| c == b':')
    }
}

/// `convertJsonOption` for each of `options`, which is what `compilerOptions` says in the file that reads `text`. `as_typescript_does`:
/// going by TypeScript 7 alone, to which what only older versions took means nothing, and which suggests nothing but another case.
pub fn problems(text: &[u8], options: &[(String, Json)], as_typescript_does: bool) -> Vec<Problem> {
    let spans = spans(text);
    let span_of = |name: &str, of_value: bool| {
        spans
            .iter()
            .find(|s| s.0 == name)
            .map(|s| if of_value { s.2 } else { s.1 })
    };
    let mut out = Vec::new();
    for (name, value) in options {
        if COMMAND_LINE_ONLY_OPTIONS.contains(&name.as_str()) {
            out.push(Problem {
                name: name.clone(),
                code: 6266,
                args: vec![name.clone()],
                span: span_of(name, false),
            });
            continue;
        }
        let is_removed = |name: &str| as_typescript_does && REMOVED.contains(&name);
        let Some(kind) = kind_of(name).filter(|_| !is_removed(name)) else {
            let meant = if as_typescript_does {
                OPTIONS
                    .iter()
                    .map(|option| option.0)
                    .find(|known| known.eq_ignore_ascii_case(name) && !is_removed(known))
            } else {
                nearest(name)
            };
            let (code, args) = match meant {
                Some(meant) => (5025, vec![name.clone(), meant.to_owned()]),
                None => (5023, vec![name.clone()]),
            };
            out.push(Problem {
                name: name.clone(),
                code,
                args,
                span: span_of(name, false),
            });
            continue;
        };
        // `null` takes back what a configuration this one extends says.
        if matches!(value, Json::Null) {
            continue;
        }
        let mut wrong = |takes: &str| {
            out.push(Problem {
                name: name.clone(),
                code: 5024,
                args: vec![name.clone(), takes.to_owned()],
                span: span_of(name, true),
            });
        };
        match kind {
            Kind::Boolean if value.as_bool().is_none() => wrong("boolean"),
            Kind::String if value.as_str().is_none() => wrong("string"),
            Kind::Number if !matches!(value, Json::Number(_)) => wrong("number"),
            Kind::Object if value.as_object().is_none() => wrong("object"),
            Kind::List(element) => match value.as_array() {
                None => wrong("Array"),
                Some(items) => {
                    let (is_right, takes): (fn(&Json) -> bool, _) = match element {
                        Element::String => (|item| item.as_str().is_some(), "string"),
                        Element::Object => (|item| item.as_object().is_some(), "object"),
                    };
                    if !items.iter().all(is_right) {
                        wrong(takes);
                    }
                }
            },
            Kind::OneOf(now, once) => match value.as_str() {
                None => wrong("string"),
                Some(said) => {
                    let said = said.to_lowercase();
                    // `es3` and `none` are not even among what is deprecated.
                    let once = once
                        .iter()
                        .filter(|one| !(as_typescript_does && matches!(**one, "es3" | "none")));
                    if !now.iter().chain(once).any(|&one| one == said) {
                        out.push(Problem {
                            name: name.clone(),
                            code: 6046,
                            args: vec![format!("--{name}"), format!("'{}'", now.join("', '"))],
                            span: span_of(name, true),
                        });
                    }
                }
            },
            _ => {}
        }
    }
    out
}
