//! Validates the `compilerOptions` of a config file: unknown options and values of the wrong type.

use crate::hir::ExprId;
use crate::json::{Json, TsConfigSourceFile};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Element {
    String,
    /// `IsFilePath`
    FilePath,
    Object,
    /// A key of `LibMap`
    Lib,
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
    /// A string or a list of them. Not `null` (`DisallowNullOrUndefined`).
    ListOrElement,
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
        b"lib" => (b"lib", Kind::List(Element::Lib)),
        b"libreplacement" => (b"libReplacement", Kind::Boolean),
        b"listemittedfiles" => (b"listEmittedFiles", Kind::Boolean),
        b"listfiles" => (b"listFiles", Kind::Boolean),
        b"listfilesonly" => (b"listFilesOnly", Kind::Boolean),
        b"maproot" => (b"mapRoot", Kind::String),
        b"maxnodemodulejsdepth" => (b"maxNodeModuleJsDepth", Kind::Number),
        b"module" => (b"module", Kind::OneOf(
            &[b"commonjs", b"es6", b"es2015", b"es2020", b"es2022", b"esnext", b"node16", b"node18", b"node20", b"nodenext", b"preserve"],
            &[b"amd", b"system", b"umd"],
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
            &[b"es5"],
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
    /// Which element of the list it is about. `None`: the whole value.
    pub index: Option<usize>,
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
        Kind::Boolean | Kind::Object | Kind::List(Element::Object) | Kind::ListOrElement => {
            return None;
        }
        Kind::String | Kind::FilePath | Kind::OneOf(..) => Json::String(text.to_vec()),
        Kind::Number => Json::Number(std::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()?),
        // `ParseListTypeOption`: only the items of an enum-valued list are trimmed.
        Kind::List(element @ (Element::String | Element::FilePath | Element::Lib)) => Json::Array(
            bun_core::strings::split(text.trim_ascii(), b",")
                .map(|item| {
                    if element == Element::Lib {
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

/// The items of `value`, which `from_text` has made of the option `name`, that are not among the
/// allowed ones, if the option is a list of those: all that are allowed.
pub fn choices_of_list(name: &[u8], value: &Json) -> Option<Vec<&'static [u8]>> {
    let Kind::List(Element::Lib) = OPTIONS.get_ascii_case_insensitive(name)?.1 else {
        return None;
    };
    let is_allowed = |item: &Json| item.as_str().is_some_and(is_lib);
    (!value.as_array()?.iter().all(is_allowed)).then(|| crate::resolve::LIBS.iter().collect())
}

fn is_lib(name: &[u8]) -> bool {
    crate::resolve::LIBS.contains(&name.to_ascii_lowercase())
}

/// The rest of `convertJsonOption`, for a value of the right type. An enum-valued option that is
/// `""` is `null`. A list is without the elements for which `is_invalid` holds and, unless
/// `listPreserveFalsyValues`, without the falsy ones.
pub fn converted(name: &[u8], value: &Json, is_invalid: impl Fn(usize) -> bool) -> Json {
    let is_falsy = |item: &Json| match item {
        Json::Null | Json::Bool(false) => true,
        Json::Number(number) => *number == 0.0,
        Json::String(text) => text.is_empty() && name != b"moduleSuffixes",
        _ => false,
    };
    match (kind_of(name), value) {
        (Some(Kind::OneOf(..)), Json::String(text)) if text.is_empty() => Json::Null,
        (Some(Kind::List(_)), Json::Array(items)) => Json::Array(
            (items.iter().enumerate())
                .filter(|(index, item)| !is_invalid(*index) && !is_falsy(item))
                .map(|(_, item)| item.clone())
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn kind_of(name: &[u8]) -> Option<Kind> {
    let option = OPTIONS.get_ascii_case_insensitive(name)?;
    (option.0 == name).then_some(option.1)
}

/// `IsFilePath` for the option `name` or for the elements of its list value.
pub fn is_file_path(name: &[u8]) -> bool {
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

/// Which object of a configuration file the options are in.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum In {
    /// For an unknown option, whether to suggest only a different letter case, as TypeScript 7 does.
    CompilerOptions { as_typescript_does: bool },
    /// `tsconfigRootOptionsMap`. What it does not have is not an error.
    Root,
}

/// `tsconfigRootOptionsMap`
fn kind_of_root(name: &[u8]) -> Option<Kind> {
    Some(match name {
        b"files" | b"include" | b"exclude" => Kind::List(Element::String),
        b"references" => Kind::List(Element::Object),
        b"extends" => Kind::ListOrElement,
        b"compileOnSave" => Kind::Boolean,
        b"compilerOptions" | b"typeAcquisition" => Kind::Object,
        _ => return None,
    })
}

/// Runs `convertJsonOption` on each of `options`, the converted value of the object `written` of `file`.
pub fn problems(
    file: &TsConfigSourceFile,
    written: ExprId,
    options: &[(Vec<u8>, Json)],
    within: In,
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
        if within != In::Root && COMMAND_LINE_ONLY_OPTIONS.contains(name) {
            out.push(Problem {
                name: name.clone(),
                index: None,
                code: 6266,
                args: vec![name.clone()],
                span: span_of(name, false),
            });
            continue;
        }
        // `null` unsets the value from a configuration that this one extends. `onPropertySet` looks
        // no further, so an unknown option that is `null` is not reported.
        if matches!(value, Json::Null) && !(within == In::Root && name == b"extends") {
            continue;
        }
        let kind = match within {
            In::Root => kind_of_root(name),
            In::CompilerOptions { .. } => kind_of(name),
        };
        let Some(kind) = kind else {
            let In::CompilerOptions { as_typescript_does } = within else {
                continue;
            };
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
                index: None,
                code,
                args,
                span: span_of(name, false),
            });
            continue;
        };
        let mut wrong = |takes: &[u8]| {
            out.push(Problem {
                name: name.clone(),
                index: None,
                code: 5024,
                args: vec![name.clone(), takes.to_vec()],
                span: span_of(name, true),
            });
        };
        // `createDiagnosticForInvalidEnumType`
        let not_one_of = |allowed: &mut dyn Iterator<Item = &'static [u8]>| {
            let allowed: Vec<&[u8]> = allowed.collect();
            vec![
                [b"--", &name[..]].concat(),
                [b"'", &allowed.join(&b"', '"[..])[..], b"'"].concat(),
            ]
        };
        let kind = match (kind, value) {
            (Kind::ListOrElement, Json::Array(_)) => Kind::List(Element::String),
            (kind, _) => kind,
        };
        match kind {
            Kind::ListOrElement if value.as_str().is_none() => wrong(b"string or Array"),
            Kind::Boolean if value.as_bool().is_none() => wrong(b"boolean"),
            Kind::String | Kind::FilePath if value.as_str().is_none() => wrong(b"string"),
            Kind::Number if !matches!(value, Json::Number(_)) => wrong(b"number"),
            Kind::Object if value.as_object().is_none() => wrong(b"object"),
            Kind::List(element) => match value.as_array() {
                None => wrong(b"Array"),
                // `convertJsonOptionOfListType`: each element is converted by itself.
                Some(items) => {
                    let elements: Vec<ExprId> = (file.property(written, name, b""))
                        .map(|property| file.elements(file.initializer(property)).collect())
                        .unwrap_or_default();
                    // `commandLineOptionElements`
                    let of_element = match &name[..] {
                        b"customConditions" => b"condition".to_vec(),
                        b"plugins" => b"plugin".to_vec(),
                        _ => name.clone(),
                    };
                    for (index, item) in items.iter().enumerate() {
                        let (code, args) = match (element, item) {
                            (_, Json::Null)
                            | (Element::String | Element::FilePath, Json::String(_))
                            | (Element::Object, Json::Object(_)) => continue,
                            (Element::Lib, Json::String(lib)) if lib.is_empty() || is_lib(lib) => {
                                continue;
                            }
                            (Element::Lib, Json::String(_)) => {
                                (6046, not_one_of(&mut crate::resolve::LIBS.iter()))
                            }
                            (Element::String | Element::FilePath, _) => {
                                (5024, vec![of_element.clone(), b"string".to_vec()])
                            }
                            (Element::Object, _) => {
                                (5024, vec![of_element.clone(), b"object".to_vec()])
                            }
                            (Element::Lib, _) => (5024, vec![of_element.clone(), b"enum".to_vec()]),
                        };
                        out.push(Problem {
                            name: name.clone(),
                            index: Some(index),
                            code,
                            args,
                            span: elements.get(index).map(|&element| file.span(element)),
                        });
                    }
                }
            },
            // `getCompilerOptionValueTypeString` is the name of the kind.
            Kind::OneOf(now, once) => match value.as_str() {
                None => wrong(b"enum"),
                Some(b"") => {}
                Some(specified) => {
                    let specified = specified.to_ascii_lowercase();
                    if !now.iter().chain(once).any(|&one| one == specified) {
                        out.push(Problem {
                            name: name.clone(),
                            index: None,
                            code: 6046,
                            args: not_one_of(&mut now.iter().copied()),
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
