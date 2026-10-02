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
    OneOf(&'static [&'static [u8]], &'static [&'static [u8]]),
}

/// `optionDeclarations`, less what is only for the command line. Sorted by name.
const OPTIONS: &[(&[u8], Kind)] = &[
    (b"all", Kind::Boolean),
    (b"allowArbitraryExtensions", Kind::Boolean),
    (b"allowImportingTsExtensions", Kind::Boolean),
    (b"allowJs", Kind::Boolean),
    (b"allowSyntheticDefaultImports", Kind::Boolean),
    (b"allowUmdGlobalAccess", Kind::Boolean),
    (b"allowUnreachableCode", Kind::Boolean),
    (b"allowUnusedLabels", Kind::Boolean),
    (b"alwaysStrict", Kind::Boolean),
    (b"assumeChangesOnlyAffectDirectDependencies", Kind::Boolean),
    (b"baseUrl", Kind::String),
    (b"charset", Kind::String),
    (b"checkJs", Kind::Boolean),
    (b"checkers", Kind::Number),
    (b"composite", Kind::Boolean),
    (b"customConditions", Kind::List(Element::String)),
    (b"declaration", Kind::Boolean),
    (b"declarationDir", Kind::String),
    (b"declarationMap", Kind::Boolean),
    (b"deduplicatePackages", Kind::Boolean),
    (b"diagnostics", Kind::Boolean),
    (b"disableReferencedProjectLoad", Kind::Boolean),
    (b"disableSizeLimit", Kind::Boolean),
    (b"disableSolutionSearching", Kind::Boolean),
    (b"disableSourceOfProjectReferenceRedirect", Kind::Boolean),
    (b"downlevelIteration", Kind::Boolean),
    (b"emitBOM", Kind::Boolean),
    (b"emitDeclarationOnly", Kind::Boolean),
    (b"emitDecoratorMetadata", Kind::Boolean),
    (b"erasableSyntaxOnly", Kind::Boolean),
    (b"esModuleInterop", Kind::Boolean),
    (b"exactOptionalPropertyTypes", Kind::Boolean),
    (b"experimentalDecorators", Kind::Boolean),
    (b"explainFiles", Kind::Boolean),
    (b"extendedDiagnostics", Kind::Boolean),
    (b"forceConsistentCasingInFileNames", Kind::Boolean),
    (b"generateCpuProfile", Kind::String),
    (b"generateTrace", Kind::String),
    (b"ignoreDeprecations", Kind::String),
    (b"importHelpers", Kind::Boolean),
    (
        b"importsNotUsedAsValues",
        Kind::OneOf(&[b"remove", b"preserve", b"error"], &[]),
    ),
    (b"incremental", Kind::Boolean),
    (b"init", Kind::Boolean),
    (b"inlineSourceMap", Kind::Boolean),
    (b"inlineSources", Kind::Boolean),
    (b"isolatedDeclarations", Kind::Boolean),
    (b"isolatedModules", Kind::Boolean),
    (
        b"jsx",
        Kind::OneOf(
            &[
                b"preserve",
                b"react-native",
                b"react-jsx",
                b"react-jsxdev",
                b"react",
            ],
            &[],
        ),
    ),
    (b"jsxFactory", Kind::String),
    (b"jsxFragmentFactory", Kind::String),
    (b"jsxImportSource", Kind::String),
    (b"keyofStringsOnly", Kind::Boolean),
    (b"lib", Kind::List(Element::String)),
    (b"libReplacement", Kind::Boolean),
    (b"listEmittedFiles", Kind::Boolean),
    (b"listFiles", Kind::Boolean),
    (b"mapRoot", Kind::String),
    (b"maxNodeModuleJsDepth", Kind::Number),
    (
        b"module",
        Kind::OneOf(
            &[
                b"commonjs",
                b"es6",
                b"es2015",
                b"es2020",
                b"es2022",
                b"esnext",
                b"node16",
                b"node18",
                b"node20",
                b"nodenext",
                b"preserve",
            ],
            &[b"none", b"amd", b"system", b"umd"],
        ),
    ),
    (
        b"moduleDetection",
        Kind::OneOf(&[b"auto", b"legacy", b"force"], &[]),
    ),
    (
        b"moduleResolution",
        Kind::OneOf(
            &[b"node16", b"nodenext", b"bundler"],
            &[b"classic", b"node", b"node10"],
        ),
    ),
    (b"moduleSuffixes", Kind::List(Element::String)),
    (b"newLine", Kind::OneOf(&[b"crlf", b"lf"], &[])),
    (b"noCheck", Kind::Boolean),
    (b"noEmit", Kind::Boolean),
    (b"noEmitHelpers", Kind::Boolean),
    (b"noEmitOnError", Kind::Boolean),
    (b"noErrorTruncation", Kind::Boolean),
    (b"noFallthroughCasesInSwitch", Kind::Boolean),
    (b"noImplicitAny", Kind::Boolean),
    (b"noImplicitOverride", Kind::Boolean),
    (b"noImplicitReturns", Kind::Boolean),
    (b"noImplicitThis", Kind::Boolean),
    (b"noImplicitUseStrict", Kind::Boolean),
    (b"noLib", Kind::Boolean),
    (b"noPropertyAccessFromIndexSignature", Kind::Boolean),
    (b"noResolve", Kind::Boolean),
    (b"noStrictGenericChecks", Kind::Boolean),
    (b"noUncheckedIndexedAccess", Kind::Boolean),
    (b"noUncheckedSideEffectImports", Kind::Boolean),
    (b"noUnusedLocals", Kind::Boolean),
    (b"noUnusedParameters", Kind::Boolean),
    (b"out", Kind::String),
    (b"outDir", Kind::String),
    (b"outFile", Kind::String),
    (b"paths", Kind::Object),
    (b"plugins", Kind::List(Element::Object)),
    (b"pprofDir", Kind::String),
    (b"preserveConstEnums", Kind::Boolean),
    (b"preserveSymlinks", Kind::Boolean),
    (b"preserveValueImports", Kind::Boolean),
    (b"preserveWatchOutput", Kind::Boolean),
    (b"pretty", Kind::Boolean),
    (b"project", Kind::String),
    (b"quiet", Kind::Boolean),
    (b"reactNamespace", Kind::String),
    (b"removeComments", Kind::Boolean),
    (b"resolveJsonModule", Kind::Boolean),
    (b"resolvePackageJsonExports", Kind::Boolean),
    (b"resolvePackageJsonImports", Kind::Boolean),
    (b"rewriteRelativeImportExtensions", Kind::Boolean),
    (b"rootDir", Kind::String),
    (b"rootDirs", Kind::List(Element::String)),
    (b"singleThreaded", Kind::Boolean),
    (b"skipDefaultLibCheck", Kind::Boolean),
    (b"skipLibCheck", Kind::Boolean),
    (b"sourceMap", Kind::Boolean),
    (b"sourceRoot", Kind::String),
    (b"stableTypeOrdering", Kind::Boolean),
    (b"strict", Kind::Boolean),
    (b"strictBindCallApply", Kind::Boolean),
    (b"strictBuiltinIteratorReturn", Kind::Boolean),
    (b"strictFunctionTypes", Kind::Boolean),
    (b"strictNullChecks", Kind::Boolean),
    (b"strictPropertyInitialization", Kind::Boolean),
    (b"stripInternal", Kind::Boolean),
    (b"suppressExcessPropertyErrors", Kind::Boolean),
    (b"suppressImplicitAnyIndexErrors", Kind::Boolean),
    (
        b"target",
        Kind::OneOf(
            &[
                b"es6", b"es2015", b"es2016", b"es2017", b"es2018", b"es2019", b"es2020",
                b"es2021", b"es2022", b"es2023", b"es2024", b"es2025", b"esnext",
            ],
            &[b"es3", b"es5"],
        ),
    ),
    (b"traceResolution", Kind::Boolean),
    (b"tsBuildInfoFile", Kind::String),
    (b"typeRoots", Kind::List(Element::String)),
    (b"types", Kind::List(Element::String)),
    (b"useDefineForClassFields", Kind::Boolean),
    (b"useUnknownInCatchVariables", Kind::Boolean),
    (b"verbatimModuleSyntax", Kind::Boolean),
    (b"version", Kind::Boolean),
];

/// The options declared `IsCommandLineOnly` (tsoptions).
const COMMAND_LINE_ONLY_OPTIONS: [&[u8]; 6] = [
    b"help",
    b"ignoreConfig",
    b"listFilesOnly",
    b"locale",
    b"showConfig",
    b"watch",
];

/// What older versions took and TypeScript 7 has no such option as.
const REMOVED: &[&[u8]] = &[
    b"charset",
    b"importsNotUsedAsValues",
    b"keyofStringsOnly",
    b"noImplicitUseStrict",
    b"noStrictGenericChecks",
    b"out",
    b"preserveValueImports",
    b"suppressExcessPropertyErrors",
    b"suppressImplicitAnyIndexErrors",
];

/// Something wrong with an option.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Problem {
    /// The option, as it is written.
    pub name: Vec<u8>,
    /// The code of TypeScript's message, and what goes into it.
    pub code: u32,
    pub args: Vec<Vec<u8>>,
    /// Where it is in the file: from, to.
    pub span: Option<(u32, u32)>,
}

/// What `--name text` on a command line means: the option as it is spelled, whatever the case of `name`, and its value. `None`: there is
/// no such option, it takes something that cannot be written in a word, or `text` is not the kind of thing it takes.
pub fn from_text(name: &[u8], text: &[u8]) -> Option<(&'static [u8], Json)> {
    let &(name, kind) = OPTIONS
        .iter()
        .find(|option| option.0.eq_ignore_ascii_case(name))?;
    let value = match kind {
        Kind::Boolean if text.eq_ignore_ascii_case(b"true") => Json::Bool(true),
        Kind::Boolean if text.eq_ignore_ascii_case(b"false") => Json::Bool(false),
        Kind::Boolean | Kind::Object | Kind::List(Element::Object) => return None,
        Kind::String | Kind::OneOf(..) => Json::String(text.to_vec()),
        Kind::Number => Json::Number(std::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()?),
        // `ParseListTypeOption`: of the items only those that are one of a few words are trimmed.
        Kind::List(Element::String) => Json::Array(
            text.trim_ascii()
                .split(|&b| b == b',')
                .map(|item| {
                    if name == b"lib" {
                        item.trim_ascii()
                    } else {
                        item
                    }
                })
                .filter(|item| !item.is_empty())
                .map(|item| Json::String(item.to_vec()))
                .collect(),
        ),
    };
    Some((name, value))
}

/// Whether the option `name`, whatever its case, is one of a few words or yes or no, and the words it can be.
pub fn choices(name: &[u8]) -> Option<&'static [&'static [u8]]> {
    match OPTIONS
        .iter()
        .find(|option| option.0.eq_ignore_ascii_case(name))?
        .1
    {
        Kind::Boolean => Some(&[b"true", b"false"]),
        Kind::OneOf(now, _) => Some(now),
        _ => None,
    }
}

fn kind_of(name: &[u8]) -> Option<Kind> {
    OPTIONS
        .binary_search_by_key(&name, |option| option.0)
        .ok()
        .map(|at| OPTIONS[at].1)
}

/// `getSpellingSuggestion`: the option whose name is nearest to `name`, if any is near.
fn nearest(name: &[u8]) -> Option<&'static [u8]> {
    let lower = name.to_ascii_lowercase();
    // The same but for upper and lower case is as near as can be.
    if let Some(option) = OPTIONS.iter().find(|o| o.0.eq_ignore_ascii_case(name)) {
        return Some(option.0);
    }
    let most = (name.len() as f64 * 0.34).floor().max(1.0) as usize;
    OPTIONS
        .iter()
        .filter(|o| o.0.len().abs_diff(name.len()) <= most)
        .map(|o| (distance(&lower, &o.0.to_ascii_lowercase()), o.0))
        .filter(|&(distance, _)| distance <= most)
        .min_by_key(|&(distance, _)| distance)
        .map(|(_, name)| name)
}

/// How many letters have to be put in, taken out or changed to make `a` of `b`.
fn distance(a: &[u8], b: &[u8]) -> usize {
    let (a, b) = (a, b);
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
fn spans(text: &[u8]) -> Vec<(Vec<u8>, (u32, u32), (u32, u32))> {
    let mut out = Vec::new();
    let mut at = 0;
    // How many brackets are open, and at which count `compilerOptions` opened.
    let (mut depth, mut inside) = (0usize, None);
    // The last name met where a name can be, and where the value after it starts.
    let mut name: Option<(Vec<u8>, (u32, u32))> = None;
    let mut value: Option<(Vec<u8>, (u32, u32), u32)> = None;
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
                    let written = &text[start + 1..at.saturating_sub(1).max(start + 1)];
                    name = Some((written.to_vec(), (start as u32, at as u32)));
                }
                continue;
            }
            b'{' | b'[' => {
                if c == b'{'
                    && depth == 1
                    && inside.is_none()
                    && name.as_ref().is_some_and(|n| n.0 == b"compilerOptions")
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
pub fn problems(
    text: &[u8],
    options: &[(Vec<u8>, Json)],
    as_typescript_does: bool,
) -> Vec<Problem> {
    let spans = spans(text);
    let span_of = |name: &[u8], of_value: bool| {
        spans
            .iter()
            .find(|s| s.0 == name)
            .map(|s| if of_value { s.2 } else { s.1 })
    };
    let mut out = Vec::new();
    for (name, value) in options {
        if COMMAND_LINE_ONLY_OPTIONS.contains(&name.as_slice()) {
            out.push(Problem {
                name: name.clone(),
                code: 6266,
                args: vec![name.clone()],
                span: span_of(name, false),
            });
            continue;
        }
        let is_removed = |name: &[u8]| as_typescript_does && REMOVED.contains(&name);
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
                Some(meant) => (5025, vec![name.clone(), meant.to_vec()]),
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
        let mut wrong = |takes: &[u8]| {
            out.push(Problem {
                name: name.clone(),
                code: 5024,
                args: vec![name.clone(), takes.to_vec()],
                span: span_of(name, true),
            });
        };
        match kind {
            Kind::Boolean if value.as_bool().is_none() => wrong(b"boolean"),
            Kind::String if value.as_str().is_none() => wrong(b"string"),
            Kind::Number if !matches!(value, Json::Number(_)) => wrong(b"number"),
            Kind::Object if value.as_object().is_none() => wrong(b"object"),
            Kind::List(element) => match value.as_array() {
                None => wrong(b"Array"),
                Some(items) => {
                    let (is_right, takes): (fn(&Json) -> bool, _) = match element {
                        Element::String => (|item| item.as_str().is_some(), b"string"),
                        Element::Object => (|item| item.as_object().is_some(), b"object"),
                    };
                    if !items.iter().all(is_right) {
                        wrong(takes);
                    }
                }
            },
            Kind::OneOf(now, once) => match value.as_str() {
                None => wrong(b"string"),
                Some(said) => {
                    let said = said.to_ascii_lowercase();
                    // `es3` and `none` are not even among what is deprecated.
                    let once = once
                        .iter()
                        .filter(|one| !(as_typescript_does && matches!(**one, b"es3" | b"none")));
                    if !now.iter().chain(once).any(|&one| one == said) {
                        out.push(Problem {
                            name: name.clone(),
                            code: 6046,
                            args: vec![
                                [b"--", &name[..]].concat(),
                                [b"'", &now.join(&b"', '"[..])[..], b"'"].concat(),
                            ],
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
