//! Validates the `compilerOptions` of a config file: unknown options and values of the wrong type.

use crate::hir::ExprId;
use crate::json::{Json, TsConfigSourceFile};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Element {
    String,
    /// `IsFilePath`
    FilePath,
    Object,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Kind {
    Boolean,
    String,
    /// `IsFilePath`
    FilePath,
    Number,
    Object,
    List(Element),
    /// The allowed values, and the formerly allowed values. Case-insensitive.
    OneOf(&'static [&'static [u8]], &'static [&'static [u8]]),
}

bun_core::comptime_string_map! {
    /// `CommandLineCompilerOptionsMap`, without the command-line-only options: maps the lowercased
    /// name to the name and the kind of value it accepts.
    static OPTIONS: (&'static [u8], Kind) = {
        b"all" => (b"all", Kind::Boolean),
        b"allowarbitraryextensions" => (b"allowArbitraryExtensions", Kind::Boolean),
        b"allowimportingtsextensions" => (b"allowImportingTsExtensions", Kind::Boolean),
        b"allowjs" => (b"allowJs", Kind::Boolean),
        b"allowsyntheticdefaultimports" => (b"allowSyntheticDefaultImports", Kind::Boolean),
        b"allowumdglobalaccess" => (b"allowUmdGlobalAccess", Kind::Boolean),
        b"allowunreachablecode" => (b"allowUnreachableCode", Kind::Boolean),
        b"allowunusedlabels" => (b"allowUnusedLabels", Kind::Boolean),
        b"alwaysstrict" => (b"alwaysStrict", Kind::Boolean),
        b"assumechangesonlyaffectdirectdependencies" => (b"assumeChangesOnlyAffectDirectDependencies", Kind::Boolean),
        b"baseurl" => (b"baseUrl", Kind::FilePath),
        b"checkjs" => (b"checkJs", Kind::Boolean),
        b"checkers" => (b"checkers", Kind::Number),
        b"composite" => (b"composite", Kind::Boolean),
        b"customconditions" => (b"customConditions", Kind::List(Element::String)),
        b"declaration" => (b"declaration", Kind::Boolean),
        b"declarationdir" => (b"declarationDir", Kind::FilePath),
        b"declarationmap" => (b"declarationMap", Kind::Boolean),
        b"deduplicatepackages" => (b"deduplicatePackages", Kind::Boolean),
        b"diagnostics" => (b"diagnostics", Kind::Boolean),
        b"disablereferencedprojectload" => (b"disableReferencedProjectLoad", Kind::Boolean),
        b"disablesizelimit" => (b"disableSizeLimit", Kind::Boolean),
        b"disablesolutionsearching" => (b"disableSolutionSearching", Kind::Boolean),
        b"disablesourceofprojectreferenceredirect" => (b"disableSourceOfProjectReferenceRedirect", Kind::Boolean),
        b"downleveliteration" => (b"downlevelIteration", Kind::Boolean),
        b"emitbom" => (b"emitBOM", Kind::Boolean),
        b"emitdeclarationonly" => (b"emitDeclarationOnly", Kind::Boolean),
        b"emitdecoratormetadata" => (b"emitDecoratorMetadata", Kind::Boolean),
        b"erasablesyntaxonly" => (b"erasableSyntaxOnly", Kind::Boolean),
        b"esmoduleinterop" => (b"esModuleInterop", Kind::Boolean),
        b"exactoptionalpropertytypes" => (b"exactOptionalPropertyTypes", Kind::Boolean),
        b"experimentaldecorators" => (b"experimentalDecorators", Kind::Boolean),
        b"explainfiles" => (b"explainFiles", Kind::Boolean),
        b"extendeddiagnostics" => (b"extendedDiagnostics", Kind::Boolean),
        b"forceconsistentcasinginfilenames" => (b"forceConsistentCasingInFileNames", Kind::Boolean),
        b"generatecpuprofile" => (b"generateCpuProfile", Kind::String),
        b"generatetrace" => (b"generateTrace", Kind::String),
        b"ignoredeprecations" => (b"ignoreDeprecations", Kind::String),
        b"importhelpers" => (b"importHelpers", Kind::Boolean),
        b"incremental" => (b"incremental", Kind::Boolean),
        b"init" => (b"init", Kind::Boolean),
        b"inlinesourcemap" => (b"inlineSourceMap", Kind::Boolean),
        b"inlinesources" => (b"inlineSources", Kind::Boolean),
        b"isolateddeclarations" => (b"isolatedDeclarations", Kind::Boolean),
        b"isolatedmodules" => (b"isolatedModules", Kind::Boolean),
        b"jsx" => (b"jsx", Kind::OneOf(&[b"preserve", b"react-native", b"react-jsx", b"react-jsxdev", b"react"], &[])),
        b"jsxfactory" => (b"jsxFactory", Kind::String),
        b"jsxfragmentfactory" => (b"jsxFragmentFactory", Kind::String),
        b"jsximportsource" => (b"jsxImportSource", Kind::String),
        b"lib" => (b"lib", Kind::List(Element::String)),
        b"libreplacement" => (b"libReplacement", Kind::Boolean),
        b"listemittedfiles" => (b"listEmittedFiles", Kind::Boolean),
        b"listfiles" => (b"listFiles", Kind::Boolean),
        b"listfilesonly" => (b"listFilesOnly", Kind::Boolean),
        b"maproot" => (b"mapRoot", Kind::String),
        b"maxnodemodulejsdepth" => (b"maxNodeModuleJsDepth", Kind::Number),
        b"module" => (b"module", Kind::OneOf(
            &[b"commonjs", b"es6", b"es2015", b"es2020", b"es2022", b"esnext", b"node16", b"node18", b"node20", b"nodenext", b"preserve"],
            &[b"none", b"amd", b"system", b"umd"],
        )),
        b"moduledetection" => (b"moduleDetection", Kind::OneOf(&[b"auto", b"legacy", b"force"], &[])),
        b"moduleresolution" => (b"moduleResolution", Kind::OneOf(
            &[b"node16", b"nodenext", b"bundler"],
            &[b"classic", b"node", b"node10"],
        )),
        b"modulesuffixes" => (b"moduleSuffixes", Kind::List(Element::String)),
        b"newline" => (b"newLine", Kind::OneOf(&[b"crlf", b"lf"], &[])),
        b"nocheck" => (b"noCheck", Kind::Boolean),
        b"noemit" => (b"noEmit", Kind::Boolean),
        b"noemithelpers" => (b"noEmitHelpers", Kind::Boolean),
        b"noemitonerror" => (b"noEmitOnError", Kind::Boolean),
        b"noerrortruncation" => (b"noErrorTruncation", Kind::Boolean),
        b"nofallthroughcasesinswitch" => (b"noFallthroughCasesInSwitch", Kind::Boolean),
        b"noimplicitany" => (b"noImplicitAny", Kind::Boolean),
        b"noimplicitoverride" => (b"noImplicitOverride", Kind::Boolean),
        b"noimplicitreturns" => (b"noImplicitReturns", Kind::Boolean),
        b"noimplicitthis" => (b"noImplicitThis", Kind::Boolean),
        b"nolib" => (b"noLib", Kind::Boolean),
        b"nopropertyaccessfromindexsignature" => (b"noPropertyAccessFromIndexSignature", Kind::Boolean),
        b"noresolve" => (b"noResolve", Kind::Boolean),
        b"nouncheckedindexedaccess" => (b"noUncheckedIndexedAccess", Kind::Boolean),
        b"nouncheckedsideeffectimports" => (b"noUncheckedSideEffectImports", Kind::Boolean),
        b"nounusedlocals" => (b"noUnusedLocals", Kind::Boolean),
        b"nounusedparameters" => (b"noUnusedParameters", Kind::Boolean),
        b"outdir" => (b"outDir", Kind::FilePath),
        b"outfile" => (b"outFile", Kind::FilePath),
        b"paths" => (b"paths", Kind::Object),
        b"plugins" => (b"plugins", Kind::List(Element::Object)),
        b"pprofdir" => (b"pprofDir", Kind::String),
        b"preserveconstenums" => (b"preserveConstEnums", Kind::Boolean),
        b"preservesymlinks" => (b"preserveSymlinks", Kind::Boolean),
        b"preservewatchoutput" => (b"preserveWatchOutput", Kind::Boolean),
        b"pretty" => (b"pretty", Kind::Boolean),
        b"project" => (b"project", Kind::String),
        b"quiet" => (b"quiet", Kind::Boolean),
        b"reactnamespace" => (b"reactNamespace", Kind::String),
        b"removecomments" => (b"removeComments", Kind::Boolean),
        b"resolvejsonmodule" => (b"resolveJsonModule", Kind::Boolean),
        b"resolvepackagejsonexports" => (b"resolvePackageJsonExports", Kind::Boolean),
        b"resolvepackagejsonimports" => (b"resolvePackageJsonImports", Kind::Boolean),
        b"rewriterelativeimportextensions" => (b"rewriteRelativeImportExtensions", Kind::Boolean),
        b"rootdir" => (b"rootDir", Kind::FilePath),
        b"rootdirs" => (b"rootDirs", Kind::List(Element::FilePath)),
        b"singlethreaded" => (b"singleThreaded", Kind::Boolean),
        b"skipdefaultlibcheck" => (b"skipDefaultLibCheck", Kind::Boolean),
        b"skiplibcheck" => (b"skipLibCheck", Kind::Boolean),
        b"sourcemap" => (b"sourceMap", Kind::Boolean),
        b"sourceroot" => (b"sourceRoot", Kind::String),
        b"stabletypeordering" => (b"stableTypeOrdering", Kind::Boolean),
        b"strict" => (b"strict", Kind::Boolean),
        b"strictbindcallapply" => (b"strictBindCallApply", Kind::Boolean),
        b"strictbuiltiniteratorreturn" => (b"strictBuiltinIteratorReturn", Kind::Boolean),
        b"strictfunctiontypes" => (b"strictFunctionTypes", Kind::Boolean),
        b"strictnullchecks" => (b"strictNullChecks", Kind::Boolean),
        b"strictpropertyinitialization" => (b"strictPropertyInitialization", Kind::Boolean),
        b"stripinternal" => (b"stripInternal", Kind::Boolean),
        b"target" => (b"target", Kind::OneOf(
            &[b"es6", b"es2015", b"es2016", b"es2017", b"es2018", b"es2019", b"es2020", b"es2021", b"es2022", b"es2023", b"es2024", b"es2025", b"esnext"],
            &[b"es3", b"es5"],
        )),
        b"traceresolution" => (b"traceResolution", Kind::Boolean),
        b"tsbuildinfofile" => (b"tsBuildInfoFile", Kind::FilePath),
        b"typeroots" => (b"typeRoots", Kind::List(Element::FilePath)),
        b"types" => (b"types", Kind::List(Element::String)),
        b"usedefineforclassfields" => (b"useDefineForClassFields", Kind::Boolean),
        b"useunknownincatchvariables" => (b"useUnknownInCatchVariables", Kind::Boolean),
        b"verbatimmodulesyntax" => (b"verbatimModuleSyntax", Kind::Boolean),
        b"version" => (b"version", Kind::Boolean),
    };
}

bun_core::comptime_string_set! {
    /// The options declared `IsCommandLineOnly` (tsoptions).
    static COMMAND_LINE_ONLY_OPTIONS = { b"help", b"ignoreConfig", b"listFilesOnly", b"locale", b"showConfig", b"watch" };
}

/// An error in an option.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Problem {
    /// The option name, as spelled in the source.
    pub name: Vec<u8>,
    /// The code of TypeScript's message, and the message arguments.
    pub code: u32,
    pub args: Vec<Vec<u8>>,
    /// Its span in the file: start, end.
    pub span: Option<(u32, u32)>,
}

/// Parses `--name text` from a command line: the canonical spelling of the option, which `name`
/// matches case-insensitively, and its value. `None`: there is no such option, its value cannot be
/// expressed as a single word, or `text` is not a valid value for it.
pub fn from_text(name: &[u8], text: &[u8]) -> Option<(&'static [u8], Json)> {
    let &(name, kind) = OPTIONS.get_ascii_case_insensitive(name)?;
    let value = match kind {
        Kind::Boolean if text.eq_ignore_ascii_case(b"true") => Json::Bool(true),
        Kind::Boolean if text.eq_ignore_ascii_case(b"false") => Json::Bool(false),
        Kind::Boolean | Kind::Object | Kind::List(Element::Object) => return None,
        Kind::String | Kind::FilePath | Kind::OneOf(..) => Json::String(text.to_vec()),
        Kind::Number => Json::Number(std::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()?),
        // `ParseListTypeOption`: only the items of an enum-valued list are trimmed.
        Kind::List(Element::String | Element::FilePath) => Json::Array(
            bun_core::strings::split(text.trim_ascii(), b",")
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

/// If the option `name`, matched case-insensitively, is enum-valued or boolean: its allowed values.
pub fn choices(name: &[u8]) -> Option<&'static [&'static [u8]]> {
    match OPTIONS.get_ascii_case_insensitive(name)?.1 {
        Kind::Boolean => Some(&[b"true", b"false"]),
        Kind::OneOf(now, _) => Some(now),
        _ => None,
    }
}

fn kind_of(name: &[u8]) -> Option<Kind> {
    let option = OPTIONS.get_ascii_case_insensitive(name)?;
    (option.0 == name).then_some(option.1)
}

/// `IsFilePath` for the option `name` or for the elements of its list value.
pub(crate) fn is_file_path(name: &[u8]) -> bool {
    matches!(
        kind_of(name),
        Some(Kind::FilePath | Kind::List(Element::FilePath))
    )
}

/// `getSpellingSuggestion`, as `createUnknownOptionError` called it before TypeScript 7: the option
/// whose name is closest to `name`.
fn nearest(name: &[u8]) -> Option<&'static [u8]> {
    let names = OPTIONS.values().map(|option| option.0);
    crate::check::regexp_scanner::get_spelling_suggestion(name, names, |name| name, Ord::cmp)
}

/// Runs `convertJsonOption` on each of `options`, the converted value of `written` (the `compilerOptions` object of `file`).
/// `as_typescript_does`: for an unknown option, suggest only a different letter case, as TypeScript 7 does.
pub fn problems(
    file: &TsConfigSourceFile,
    written: ExprId,
    options: &[(Vec<u8>, Json)],
    as_typescript_does: bool,
) -> Vec<Problem> {
    let span_of = |name: &[u8], of_value: bool| {
        let property = file.property(written, name, b"")?;
        Some(if of_value {
            file.span(file.initializer(property))
        } else {
            file.name_span(property)
        })
    };
    let mut out = Vec::new();
    for (name, value) in options {
        if COMMAND_LINE_ONLY_OPTIONS.contains(name) {
            out.push(Problem {
                name: name.clone(),
                code: 6266,
                args: vec![name.clone()],
                span: span_of(name, false),
            });
            continue;
        }
        // `null` unsets the value from a configuration that this one extends. `onPropertySet` looks
        // no further, so an unknown option that is `null` is not reported.
        if matches!(value, Json::Null) {
            continue;
        }
        let Some(kind) = kind_of(name) else {
            let suggestion = if as_typescript_does {
                OPTIONS
                    .get_ascii_case_insensitive(name)
                    .map(|option| option.0)
            } else {
                nearest(name)
            };
            let (code, args) = match suggestion {
                Some(suggestion) => (5025, vec![name.clone(), suggestion.to_vec()]),
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
            Kind::String | Kind::FilePath if value.as_str().is_none() => wrong(b"string"),
            Kind::Number if !matches!(value, Json::Number(_)) => wrong(b"number"),
            Kind::Object if value.as_object().is_none() => wrong(b"object"),
            Kind::List(element) => match value.as_array() {
                None => wrong(b"Array"),
                Some(items) => {
                    let (is_right, takes): (fn(&Json) -> bool, _) = match element {
                        Element::String | Element::FilePath => {
                            (|item| item.as_str().is_some(), b"string")
                        }
                        Element::Object => (|item| item.as_object().is_some(), b"object"),
                    };
                    if !items.iter().all(is_right) {
                        wrong(takes);
                    }
                }
            },
            Kind::OneOf(now, once) => match value.as_str() {
                None => wrong(b"string"),
                Some(specified) => {
                    let specified = specified.to_ascii_lowercase();
                    // `es3` and `none` are not even among the deprecated values.
                    let once = once
                        .iter()
                        .filter(|one| !(as_typescript_does && matches!(**one, b"es3" | b"none")));
                    if !now.iter().chain(once).any(|&one| one == specified) {
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
