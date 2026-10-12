//! Validates the `compilerOptions` of a config file: unknown options and values of the wrong type.

use crate::hir::{ExprId, PropId};
use crate::json::{Json, TsConfigSourceFile};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Element {
    String,
    /// `IsFilePath`
    FilePath,
    Object,
    /// A key of `LibMap`
    Lib,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
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
    /// `propertyAssignment`
    pub property: PropId,
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
/// expressed as a single word, or `text` is not a valid value for it. What is no key of the
/// `EnumMap` of the option is left as it is written, for `invalid_enum_type`.
pub fn from_text(name: &[u8], text: &[u8]) -> Option<(&'static [u8], Json)> {
    let &(name, kind) = OPTIONS.get_ascii_case_insensitive(name)?;
    let value = match kind {
        Kind::Boolean if text.eq_ignore_ascii_case(b"true") => Json::Bool(true),
        Kind::Boolean if text.eq_ignore_ascii_case(b"false") => Json::Bool(false),
        Kind::Boolean | Kind::Object | Kind::List(Element::Object) | Kind::ListOrElement => {
            return None;
        }
        Kind::String | Kind::FilePath => Json::String(text.to_vec()),
        Kind::OneOf(..) => Json::String(
            convert_json_option_of_enum_type(kind, text.trim_ascii())
                .unwrap_or_else(|| text.to_vec()),
        ),
        Kind::Number => Json::Number(std::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()?),
        // `ParseListTypeOption`: a flag is no list. Only the items of an enum-valued list are
        // trimmed.
        Kind::List(Element::String | Element::FilePath | Element::Lib)
            if text.trim_ascii().starts_with(b"-") =>
        {
            Json::Array(Vec::new())
        }
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
                .map(|item| {
                    let key = convert_json_option_of_enum_type(kind, item);
                    Json::String(key.unwrap_or_else(|| item.to_vec()))
                })
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

/// `createDiagnosticForInvalidEnumType` for `value`, which `from_text` has made of the option
/// `name`: the allowed values, if it is no key of `EnumMap` or has an item that is none.
pub fn invalid_enum_type(name: &[u8], value: &Json) -> Option<Vec<&'static [u8]>> {
    let kind = OPTIONS.get_ascii_case_insensitive(name)?.1;
    let is_key = |item: &Json| {
        (item.as_str()).is_some_and(|it| convert_json_option_of_enum_type(kind, it).is_some())
    };
    match kind {
        Kind::OneOf(now, _) => (!is_key(value)).then(|| now.to_vec()),
        Kind::List(Element::Lib) => {
            let has_only_keys = value.as_array()?.iter().all(is_key);
            (!has_only_keys).then(|| crate::resolve::LIBS.iter().collect())
        }
        _ => None,
    }
}

/// `convertJsonOptionOfEnumType`: the key of `EnumMap` that `value` is, in whatever letter case.
/// `kind` is that of the option, or that of the list that has the option for its `Elements`.
fn convert_json_option_of_enum_type(kind: Kind, value: &[u8]) -> Option<Vec<u8>> {
    let key = crate::config::strings_to_lower(value);
    let is_key = match kind {
        Kind::OneOf(now, once) => now.iter().chain(once).any(|&one| one == key),
        Kind::List(Element::Lib) => crate::resolve::LIBS.contains(&key),
        _ => false,
    };
    is_key.then_some(key)
}

/// The rest of `convertJsonOption`, for a value of the right type. `convertJsonOptionOfListType`
/// converts the elements first, those for which `is_invalid` holds to nil. Unless
/// `listPreserveFalsyValues`, what is falsy then is left out: not `""` as a path.
pub fn converted(
    name: &[u8],
    value: &Json,
    base_path: &[u8],
    is_invalid: impl Fn(usize) -> bool,
) -> Json {
    let is_falsy = |item: &Json| match item {
        Json::Null | Json::Bool(false) => true,
        Json::Number(number) => *number == 0.0,
        Json::String(text) => text.is_empty() && name != b"moduleSuffixes",
        _ => false,
    };
    let kind = kind_of(name);
    match (kind, value) {
        (Some(Kind::List(_)), Json::Array(items)) => Json::Array(
            (items.iter().enumerate())
                .filter(|(index, _)| !is_invalid(*index))
                .map(|(_, item)| converted_non_list(kind, item, base_path))
                .filter(|item| !is_falsy(item))
                .collect(),
        ),
        _ => converted_non_list(kind, value, base_path),
    }
}

/// `converted` for a value that is no list. `kind` is that of the option, or that of the list that
/// has the option for its `Elements`.
fn converted_non_list(kind: Option<Kind>, value: &Json, base_path: &[u8]) -> Json {
    match (kind, value) {
        (Some(Kind::FilePath | Kind::List(Element::FilePath)), Json::String(path)) => Json::String(
            crate::config::normalize_non_list_option_value(path, base_path),
        ),
        (Some(kind @ (Kind::OneOf(..) | Kind::List(Element::Lib))), Json::String(text)) => {
            convert_json_option_of_enum_type(kind, text).map_or_else(|| value.clone(), Json::String)
        }
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

/// `CommandLineOptionTypeList` is the kind of the option `name`.
pub(crate) fn is_list(name: &[u8]) -> bool {
    matches!(kind_of(name), Some(Kind::List(_)))
}

/// `CommandLineOptionTypeEnum` is the kind of the option `name`.
pub(crate) fn is_enum(name: &[u8]) -> bool {
    matches!(kind_of(name), Some(Kind::OneOf(..)))
}

/// `CommandLineCompilerOptionsMap.Get(name)`, its name: `name` in whatever letter case. The map has
/// the command-line-only options too.
pub fn possible_option(name: &[u8]) -> Option<&'static [u8]> {
    let is_name = |option: &&'static [u8]| option.eq_ignore_ascii_case(name);
    match OPTIONS.get_ascii_case_insensitive(name) {
        Some(option) => Some(option.0),
        None => COMMAND_LINE_ONLY_OPTIONS.iter().find(is_name),
    }
}

/// Which object of a configuration file the options are in.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum In {
    CompilerOptions,
    /// `tsconfigRootOptionsMap`. What it does not have is not an error, but for `excludes`.
    Root,
    TypeAcquisition,
}

/// `typeAcquisitionDecls`
const TYPE_ACQUISITION_OPTIONS: [(&[u8], Kind); 4] = [
    (b"enable", Kind::Boolean),
    (b"include", Kind::List(Element::String)),
    (b"exclude", Kind::List(Element::String)),
    (b"disableFilenameBasedTypeAcquisition", Kind::Boolean),
];

/// `*CommandLineOption`, as far as `convertToJson` reads it.
#[derive(Copy, Clone)]
pub(crate) enum Declaration {
    /// `tsconfigRootOptionsMap`
    Root,
    Of(&'static [u8], Kind),
}

impl Declaration {
    /// `ElementOptions.Get(key)`, if that is its name.
    pub(crate) fn element(self, key: &[u8]) -> Option<Declaration> {
        let named = |names: &[&'static [u8]]| names.iter().copied().find(|name| *name == key);
        match self {
            Declaration::Root => {
                let name = named(&[
                    b"files",
                    b"include",
                    b"exclude",
                    b"references",
                    b"extends",
                    b"compileOnSave",
                    b"compilerOptions",
                    b"typeAcquisition",
                ])?;
                Some(Declaration::Of(name, kind_of_root(name)?))
            }
            Declaration::Of(b"compilerOptions", Kind::Object) => {
                let option = OPTIONS.get_ascii_case_insensitive(key)?;
                (option.0 == key).then_some(Declaration::Of(option.0, option.1))
            }
            Declaration::Of(b"typeAcquisition", Kind::Object) => {
                let mut options = TYPE_ACQUISITION_OPTIONS.iter();
                let option = options.find(|option| option.0 == key)?;
                Some(Declaration::Of(option.0, option.1))
            }
            Declaration::Of(..) => None,
        }
    }

    /// `Name`
    pub(crate) fn name(self) -> &'static [u8] {
        match self {
            Declaration::Root => b"undefined",
            Declaration::Of(name, _) => name,
        }
    }

    /// `getCompilerOptionValueTypeString`
    pub(crate) fn takes(self) -> &'static [u8] {
        match self {
            Declaration::Root | Declaration::Of(_, Kind::Object) => b"object",
            Declaration::Of(_, Kind::Boolean) => b"boolean",
            Declaration::Of(_, Kind::String | Kind::FilePath) => b"string",
            Declaration::Of(_, Kind::Number) => b"number",
            Declaration::Of(_, Kind::OneOf(..)) => b"enum",
            Declaration::Of(_, Kind::List(_)) => b"Array",
            Declaration::Of(_, Kind::ListOrElement) => b"string or Array",
        }
    }
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

/// The errors of `onPropertySet`, which runs `convertJsonOption`, for each property of the object
/// `written` of `file`.
pub fn problems(file: &TsConfigSourceFile, written: ExprId, within: In) -> Vec<Problem> {
    let mut out = Vec::new();
    for (property, name) in file.properties(written) {
        let name = &name.to_vec();
        let value = &file.convert_property_value_to_json(file.initializer(property));
        let name_span = Some(file.name_span(property));
        let value_span = Some(file.span(file.initializer(property)));
        if within == In::CompilerOptions && COMMAND_LINE_ONLY_OPTIONS.contains(name) {
            out.push(Problem {
                property,
                index: None,
                code: 6266,
                args: vec![name.clone()],
                span: name_span,
            });
            continue;
        }
        if within == In::Root && name == b"excludes" {
            out.push(Problem {
                property,
                index: None,
                code: 6114,
                args: Vec::new(),
                span: name_span,
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
            In::CompilerOptions => kind_of(name),
            In::TypeAcquisition => (TYPE_ACQUISITION_OPTIONS.iter())
                .find(|option| option.0 == &name[..])
                .map(|option| option.1),
        };
        let Some(kind) = kind else {
            let (suggestion, with, without) = match within {
                In::Root => continue,
                In::TypeAcquisition => {
                    let mut options = TYPE_ACQUISITION_OPTIONS.iter();
                    let other_case = options.find(|option| option.0.eq_ignore_ascii_case(name));
                    (other_case.map(|option| option.0), 17018, 17010)
                }
                In::CompilerOptions => (possible_option(name), 5025, 5023),
            };
            let (code, args) = match suggestion {
                Some(suggestion) => (with, vec![name.clone(), suggestion.to_vec()]),
                None => (without, vec![name.clone()]),
            };
            out.push(Problem {
                property,
                index: None,
                code,
                args,
                span: name_span,
            });
            continue;
        };
        let mut wrong = |takes: &[u8]| {
            out.push(Problem {
                property,
                index: None,
                code: 5024,
                args: vec![name.clone(), takes.to_vec()],
                span: value_span,
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
                    let elements: Vec<ExprId> = file.elements(file.initializer(property)).collect();
                    // `commandLineOptionElements`
                    let of_element = match &name[..] {
                        b"customConditions" => b"condition".to_vec(),
                        b"plugins" => b"plugin".to_vec(),
                        _ => name.clone(),
                    };
                    // `convertArrayLiteralExpressionToJson` leaves out what is `null`, so an element
                    // has its index among the others. Its node is looked up by it all the same.
                    let mut among_others = 0;
                    for (index, item) in items.iter().enumerate() {
                        let at = among_others;
                        among_others += usize::from(*item != Json::Null);
                        let (code, args) = match (element, item) {
                            (_, Json::Null)
                            | (Element::String | Element::FilePath, Json::String(_))
                            | (Element::Object, Json::Object(_)) => continue,
                            (Element::Lib, Json::String(lib))
                                if lib.is_empty()
                                    || convert_json_option_of_enum_type(kind, lib).is_some() =>
                            {
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
                            property,
                            index: Some(index),
                            code,
                            args,
                            span: elements.get(at).map(|&element| file.span(element)),
                        });
                    }
                }
            },
            // `getCompilerOptionValueTypeString` is the name of the kind.
            Kind::OneOf(now, _) => match value.as_str() {
                None => wrong(b"enum"),
                Some(b"") => {}
                Some(specified) => {
                    if convert_json_option_of_enum_type(kind, specified).is_none() {
                        out.push(Problem {
                            property,
                            index: None,
                            code: 6046,
                            args: not_one_of(&mut now.iter().copied()),
                            span: value_span,
                        });
                    }
                }
            },
            _ => {}
        }
    }
    out
}
