//! Reads a `tsconfig.json`: `extends`, `files`, `include`, `exclude`, `references` and `${configDir}`, and finds the files it names.
//!
//! A port of `internal/tsoptions/tsconfigparsing.go` and `internal/vfs/vfsmatch/vfsmatch.go`.

use crate::config_options::{Declaration, In, converted, is_enum, is_file_path, is_list};
use crate::json::{Json, TsConfigSourceFile};
use crate::resolve::{
    Host, Options, ancestors, combine_paths, contains_path, displayed_path,
    equate_string_case_insensitive, extra_supported_extensions, file_extension_is_one_of,
    get_base_file_name, get_relative_path_from_directory, inside, is_rooted_disk_path,
    is_same_path, join, known_extension, remove_file_extension, supported_extensions, to_path,
};
use crate::session::Session;
use crate::verify::{Place, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;

/// A configuration file error: the code of TypeScript's message, and the message arguments.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfigError {
    pub code: u32,
    pub args: Vec<Vec<u8>>,
    /// Its span, if it has one: the file, start, end.
    pub at: Option<(Vec<u8>, u32, u32)>,
    /// The message chain below it: indentation level, code, message arguments.
    pub chain: Vec<(u32, u32, Vec<Vec<u8>>)>,
    /// `GetProgramDiagnostics`, not `GetConfigFileParsingDiagnostics`: the file could be read, but
    /// its options are inconsistent.
    pub is_about_options: bool,
    /// `RelatedInformation`: the span, the code and the message arguments. It is in the file of
    /// `at`, or else in the configuration file of the project.
    pub related: Vec<(u32, u32, u32, Vec<Vec<u8>>)>,
}

impl ConfigError {
    fn new(code: u32, args: &[&[u8]]) -> ConfigError {
        ConfigError {
            code,
            args: args.iter().map(|&a| a.to_vec()).collect(),
            at: None,
            chain: Vec::new(),
            is_about_options: false,
            related: Vec::new(),
        }
    }

    /// `problem`, in the configuration file at `config_path`, which may be absent. The syntax tree
    /// of the file is left in `session`.
    pub fn of_problem(
        host: &dyn Host,
        session: &Session,
        config_path: &[u8],
        problem: &crate::verify::Problem,
    ) -> ConfigError {
        let at = (!config_path.is_empty())
            .then(|| host.read(config_path))
            .flatten()
            .and_then(|text| TsConfigSourceFile::parse(host, session, text))
            .and_then(|file| problem.span_in(&file))
            .map(|(from, to)| (config_path.to_vec(), from, to));
        ConfigError {
            code: problem.code,
            args: problem.args.clone(),
            at,
            chain: problem.chain.clone(),
            is_about_options: true,
            // What is in a file of the program is where the problem itself is reported.
            related: (problem.related.iter())
                .filter(|it| it.0 == crate::program::IN_CONFIGURATION)
                .map(|&(_, from, to, code)| (from, to, code, Vec::new()))
                .collect(),
        }
    }
}

/// `core.ProjectReference`
#[derive(Clone)]
pub struct ProjectReference {
    /// The directory or the configuration file of the referenced project.
    pub path: Vec<u8>,
    pub circular: bool,
}

/// `ParsedCommandLine`
#[derive(Clone)]
pub struct Project {
    /// The configuration file. Empty if there is none.
    pub config_path: Vec<u8>,
    pub options: Options,
    /// The root files, in TypeScript's order: the entries of `files`, then the matches of
    /// `include`.
    pub files: Vec<Vec<u8>>,
    /// The directory that `exclude` is relative to.
    base: Vec<u8>,
    /// `exclude`, or else the directories that the project writes to.
    exclude: Vec<Vec<u8>>,
    pub references: Vec<ProjectReference>,
    /// `ProjectReferences() != nil`: `references` is an array, whatever is in it.
    pub has_references: bool,
    pub errors: Vec<ConfigError>,
    /// The merged `compilerOptions` of all the files that were read, from which `options` is built.
    pub raw_compiler_options: Vec<(Vec<u8>, Json)>,
}

impl Project {
    /// The files that the project would have if it included all of the directory `dir`: not what
    /// it excludes.
    pub fn files_under(&self, host: &dyn Host, dir: &[u8]) -> Vec<Vec<u8>> {
        let include = [join(dir, b"**/*")];
        file_names_from_specs(
            host,
            &self.base,
            &self.options,
            &[],
            &include,
            &self.exclude,
        )
    }

    /// `GetBuildInfoFileName` under `tsc -b` (`options.Build`), where every project has one, incremental or not.
    pub fn get_build_info_file_name(&self) -> Vec<u8> {
        let specified = (self.raw_compiler_options.iter())
            .find(|(name, _)| name == b"tsBuildInfoFile")
            .and_then(|(_, specified)| specified.as_str());
        if let Some(specified) = specified.filter(|specified| !specified.is_empty()) {
            return specified.to_vec();
        }
        if self.config_path.is_empty() {
            return Vec::new();
        }
        let config = remove_file_extension(&self.config_path);
        let options = &self.options;
        let mut name = if options.out_dir.is_empty() {
            config.to_vec()
        } else if options.root_dir.is_empty() {
            join(&options.out_dir, bun_paths::basename_posix(config))
        } else {
            let is_case_sensitive = options.use_case_sensitive_file_names;
            let relative =
                get_relative_path_from_directory(&options.root_dir, config, is_case_sensitive);
            join(&options.out_dir, &relative)
        };
        name.extend_from_slice(b".tsbuildinfo");
        name
    }
}

/// `ResolveConfigFileNameOfProjectReference`
pub fn resolve_config_file_name_of_project_reference(path: &[u8]) -> Vec<u8> {
    if path.ends_with(b".json") {
        path.to_vec()
    } else {
        join(path, b"tsconfig.json")
    }
}

const CONFIG_DIR_TEMPLATE: &[u8] = b"${configDir}";

/// `findConfigFile`, as `tscCompilation` calls it: the `tsconfig.json` in `dir` or in its nearest
/// ancestor directory that has one.
pub fn find_config_file(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    ancestors(dir)
        .map(|dir| join(dir, b"tsconfig.json"))
        .find(|candidate| host.is_file(candidate))
}

/// `computeConfigFileName`, for a file in `dir`: the `tsconfig.json`, or else the `jsconfig.json`,
/// in `dir` or in its nearest ancestor directory that has either.
pub fn find_config(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    for dir in ancestors(dir) {
        let candidates = [b"tsconfig.json", b"jsconfig.json"].map(|name| join(dir, name));
        let found = candidates.into_iter().find(|it| host.is_file(it));
        if found.is_some() || dir.ends_with(b"/node_modules") {
            return found;
        }
    }
    None
}

/// One configuration file with its extended configuration files merged in.
#[derive(Default)]
struct Raw {
    /// `options`. Paths are absolute, or start with `${configDir}`. No value is `null`.
    compiler: Vec<(Vec<u8>, Json)>,
    /// `explicitNullFields`: the options that are `null` in `raw`, which is of the file itself.
    explicit_null_fields: Vec<Vec<u8>>,
    files: List,
    include: List,
    exclude: List,
    references: List,
    /// `rawConfig.GetOrZero("extends") != nil`
    has_extends: bool,
}

/// `files`, `include`, `exclude` or `references`.
#[derive(Default)]
struct List {
    /// `rawConfig.Has`: the property is there, whatever its value.
    is_specified: bool,
    /// `propOfRaw.wrongValue` is not `"no-prop"`: the value is an array.
    is_array: bool,
    /// `propOfRaw.sliceValue`. `convertArrayLiteralElementsToJson` leaves out the elements that are
    /// `null`, and a list of nothing else is nil. An element of the wrong type is still in it.
    items: Option<Vec<Json>>,
}

impl List {
    fn of(value: Option<&Json>) -> List {
        let written = value.and_then(Json::as_array);
        let items = written.and_then(|items| {
            let kept: Vec<Json> = (items.iter())
                .filter(|item| !matches!(item, Json::Null))
                .cloned()
                .collect();
            (items.is_empty() || !kept.is_empty()).then_some(kept)
        });
        List {
            is_specified: value.is_some(),
            is_array: written.is_some(),
            items,
        }
    }

    /// The elements that are strings.
    fn strings(&self) -> Vec<Vec<u8>> {
        let items = self.items.iter().flatten();
        items
            .filter_map(|item| item.as_str().map(<[u8]>::to_vec))
            .collect()
    }

    fn stringify(&self) -> Vec<u8> {
        let mut out = Vec::new();
        Json::Array(self.items.clone().unwrap_or_default()).stringify(&mut out);
        out
    }
}

/// `startsWithConfigDirTemplate`
pub(crate) fn starts_with_config_dir_template(value: &[u8]) -> bool {
    value
        .get(..CONFIG_DIR_TEMPLATE.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(CONFIG_DIR_TEMPLATE))
}

/// `getSubstitutedPathWithConfigDirTemplate`
fn substitute_config_dir(value: &[u8], base: &[u8]) -> Vec<u8> {
    join(base, &value.replacen(CONFIG_DIR_TEMPLATE, b"./", 1))
}

fn substitute_if_template(value: &[u8], base: &[u8]) -> Option<Vec<u8>> {
    starts_with_config_dir_template(value).then(|| substitute_config_dir(value, base))
}

/// `normalizeNonListOptionValue`, of an option that `IsFilePath`.
pub(crate) fn normalize_non_list_option_value(value: &[u8], base: &[u8]) -> Vec<u8> {
    let value = strings::replace_owned(value, b"\\", b"/");
    if starts_with_config_dir_template(&value) {
        value
    } else {
        join(base, &value)
    }
}

/// `ParseCompilerOptions`. A field with its zero value is an option that `all_options` does not
/// have: `""`, and `None`, a list that is nil.
fn parse_compiler_options(key: &[u8], value: Option<Json>, all_options: &mut Vec<(Vec<u8>, Json)>) {
    all_options.retain(|(name, _)| name != key);
    let value = value.filter(|value| value.as_str() != Some(b""));
    all_options.extend(value.map(|value| (key.to_vec(), value)));
}

/// `mergeCompilerOptions`: the values of `source` take precedence. `""` is the zero value of its
/// field, which is to every reader an option that is not specified, and is not copied.
/// `explicit_null_fields`: the options that are `null` in `rawSource`, which unsets them.
/// The options of a command line are their own `rawSource`.
pub fn merge_compiler_options(
    target: &mut Vec<(Vec<u8>, Json)>,
    source: Vec<(Vec<u8>, Json)>,
    explicit_null_fields: &[Vec<u8>],
) {
    target.retain(|(key, _)| !explicit_null_fields.contains(key));
    for (key, value) in source {
        if value.as_str() == Some(b"") || explicit_null_fields.contains(&key) {
            continue;
        }
        target.retain(|(k, _)| *k != key);
        if value != Json::Null {
            target.push((key, value));
        }
    }
}

/// `parseConfig`, and `ParseExtendedConfig` before it. `stack`: `resolutionStack`. The syntax trees
/// of the files are left in `session`.
fn parse_config(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    stack: &mut Vec<Vec<u8>>,
    errors: &mut Vec<ConfigError>,
) -> Option<Raw> {
    let text = host.read(path);
    let Some(file) = text.and_then(|text| TsConfigSourceFile::parse(host, session, text)) else {
        errors.push(ConfigError::new(5083, &[&displayed_path(path)]));
        return None;
    };
    let at = |(from, to): (u32, u32)| (path.to_vec(), from, to);
    let reported = errors.len();
    let args_of = |d: &crate::hir::Diagnostic| -> Vec<Vec<u8>> {
        d.args.iter().map(|arg| arg.to_vec()).collect()
    };
    errors.extend(file.diagnostics().map(|d| {
        ConfigError {
            args: args_of(d),
            at: Some(at(file.diagnostic_span(d))),
            related: (d.related.iter())
                .map(|related| {
                    let (from, to) = file.diagnostic_span(related);
                    (from, to, related.code, args_of(related))
                })
                .collect(),
            ..ConfigError::new(d.code, &[])
        }
    }));
    // `ParseExtendedConfig`: an extended file that does not parse is ignored.
    if !stack.is_empty() && errors.len() > reported {
        return None;
    }
    let is_case_sensitive = host.is_case_sensitive();
    let resolved_path = to_path(path, is_case_sensitive).into_owned();
    if stack.contains(&resolved_path) {
        errors.push(ConfigError::new(18000, &[]));
        return None;
    }
    // `convertConfigFileToObject`
    let json = match file.root {
        Some(root) => file.convert_property_value_to_json(root),
        None => {
            let name = if path.ends_with(b"/jsconfig.json") {
                b"jsconfig.json"
            } else {
                b"tsconfig.json"
            };
            errors.push(ConfigError::new(5092, &[name]));
            Json::Object(Vec::new())
        }
    };
    if let Some(root) = file.root {
        let mut not_json = Vec::new();
        file.conversion_errors(root, Some(Declaration::Root), &mut not_json);
        errors.extend(not_json.into_iter().map(|(code, args, span)| ConfigError {
            args,
            at: Some(at(span)),
            ..ConfigError::new(code, &[])
        }));
    }
    // `onPropertySet` is called for every property: the nodes of all the values of `name`.
    let values_of = |name: &[u8]| -> Vec<_> {
        (file.root.into_iter().flat_map(|root| file.properties(root)))
            .filter(|property| property.1 == name)
            .map(|property| file.initializer(property.0))
            .collect()
    };
    let of_problem = |problem: crate::config_options::Problem| ConfigError {
        args: problem.args,
        at: problem.span.map(at),
        ..ConfigError::new(problem.code, &[])
    };
    let base = dirname::<Posix>(path);
    let mut own = Raw::default();
    // `getDefaultCompilerOptions`
    if path.ends_with(b"/jsconfig.json") {
        for (key, value) in [
            (b"allowJs".as_slice(), Json::Bool(true)),
            (b"maxNodeModuleJsDepth", Json::Number(2.0)),
            (b"skipLibCheck", Json::Bool(true)),
            (b"noEmit", Json::Bool(true)),
        ] {
            own.compiler.push((key.to_vec(), value));
        }
    }
    for written in values_of(b"compilerOptions") {
        let problems = crate::config_options::problems(&file, written, In::CompilerOptions);
        // `convertJsonOption`: an invalid value is treated as unspecified. So is an invalid element
        // of a list.
        let omitted: Vec<_> = (problems.iter())
            .map(|problem| (problem.property, problem.index))
            .collect();
        errors.extend(problems.into_iter().map(of_problem));
        for (property, key) in file.properties(written) {
            let is_omitted = |index| omitted.contains(&(property, index));
            let value = file.convert_property_value_to_json(file.initializer(property));
            // `convertJsonOptionOfListType` of `null`, and of a list of nothing but `null`.
            let is_nil_list = match &value {
                Json::Null => is_list(key),
                Json::Array(items) => !items.is_empty() && items.iter().all(|it| *it == Json::Null),
                _ => false,
            };
            // `convertJsonOptionOfEnumType` makes nil of `""`.
            let is_nil = match &value {
                Json::Null => !is_nil_list,
                Json::String(text) => text.is_empty() && is_enum(key),
                _ => false,
            };
            if is_omitted(None) || is_nil {
                continue;
            }
            if is_nil_list {
                parse_compiler_options(key, None, &mut own.compiler);
                continue;
            }
            let value = converted(key, &value, base, |index| is_omitted(Some(index)));
            parse_compiler_options(key, Some(value), &mut own.compiler);
        }
    }
    // `PathsBasePath`: `paths` can be inherited from a configuration file in another directory.
    if own.compiler.iter().any(|option| option.0 == b"paths") {
        let paths_base_path = Json::String(base.to_vec());
        parse_compiler_options(b"pathsBasePath", Some(paths_base_path), &mut own.compiler);
    }
    // Of a repeated name, `raw` has the last value.
    let compiler = json.get(b"compilerOptions").and_then(Json::as_object);
    own.explicit_null_fields = (compiler.into_iter().flatten())
        .filter(|option| option.1 == Json::Null)
        .map(|option| option.0.clone())
        .collect();
    // `convertJsonOption` for the properties outside `compilerOptions`.
    if let Some(root) = file.root {
        let problems = crate::config_options::problems(&file, root, In::Root);
        errors.extend(problems.into_iter().map(of_problem));
    }
    for written in values_of(b"typeAcquisition") {
        let problems = crate::config_options::problems(&file, written, In::TypeAcquisition);
        errors.extend(problems.into_iter().map(of_problem));
    }
    own.files = List::of(json.get(b"files"));
    own.include = List::of(json.get(b"include"));
    own.exclude = List::of(json.get(b"exclude"));
    own.references = List::of(json.get(b"references"));
    let extends = json.get(b"extends");
    own.has_extends = extends.is_some_and(|extends| *extends != Json::Null);
    // `getExtendsConfigPathOrArray`. Of several `extends`, the last one counts.
    let mut extended_config_path = None;
    for written in values_of(b"extends") {
        let names: Vec<(usize, Vec<u8>)> = match file.convert_property_value_to_json(written) {
            Json::String(one) => vec![(0, one)],
            // `convertArrayLiteralExpressionToJson` leaves out what is `null`, so the index is the
            // one among the others. The node is looked up by it all the same.
            Json::Array(many) => (many.iter().filter(|it| **it != Json::Null))
                .enumerate()
                .filter_map(|(i, e)| Some((i, e.as_str()?.to_vec())))
                .collect(),
            _ => Vec::new(),
        };
        let mut found = Vec::new();
        for (i, name) in &names {
            let reported = errors.len();
            found.extend(extends_config_path(host, session, name, base, errors));
            // `CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic`, at `valueExpression`.
            let value = file.elements(written).nth(*i).unwrap_or(written);
            for error in &mut errors[reported..] {
                error.at = Some(at(file.span(value)));
            }
        }
        extended_config_path = Some(found);
    }
    // Without `extends` nothing is merged, and a `null` of the file itself unsets nothing in it.
    let Some(extended_config_path) = extended_config_path else {
        return Some(own);
    };
    stack.push(resolved_path);
    let mut inherited = Raw::default();
    for extended_path in &extended_config_path {
        let Some(extended) = parse_config(host, session, extended_path, stack, errors) else {
            continue;
        };
        // A property the extending file does not specify itself takes the value from the last of
        // the extended files, relative to that file's directory.
        // `relativeDifference`: from the directory of the extending file. 18003 prints the result.
        let extended_dir = dirname::<Posix>(extended_path);
        let relative_difference =
            get_relative_path_from_directory(base, extended_dir, is_case_sensitive);
        let rebase = |specs: Vec<Json>| -> Vec<Json> {
            specs
                .into_iter()
                .map(|spec| match spec {
                    // Not normalized: `..` after `**` is an error that is still to be reported.
                    Json::String(spec)
                        if !(starts_with_config_dir_template(&spec)
                            || is_rooted_disk_path(&spec)) =>
                    {
                        Json::String(combine_paths(&relative_difference, &spec))
                    }
                    other => other,
                })
                .collect()
        };
        // `setPropertyValue`
        let inherit = |own: &List, inherited: &mut List, extended: List| {
            if !own.is_specified
                && let Some(items) = extended.items
            {
                *inherited = List {
                    is_specified: true,
                    is_array: true,
                    items: Some(rebase(items)),
                };
            }
        };
        inherit(&own.include, &mut inherited.include, extended.include);
        inherit(&own.exclude, &mut inherited.exclude, extended.exclude);
        inherit(&own.files, &mut inherited.files, extended.files);
        let explicit_null_fields = &extended.explicit_null_fields;
        merge_compiler_options(
            &mut inherited.compiler,
            extended.compiler,
            explicit_null_fields,
        );
    }
    stack.pop();
    if inherited.include.is_specified {
        own.include = inherited.include;
    }
    if inherited.exclude.is_specified {
        own.exclude = inherited.exclude;
    }
    if inherited.files.is_specified {
        own.files = inherited.files;
    }
    let specified = std::mem::take(&mut own.compiler);
    merge_compiler_options(
        &mut inherited.compiler,
        specified,
        &own.explicit_null_fields,
    );
    own.compiler = inherited.compiler;
    Some(own)
}

/// `getExtendsConfigPath`
fn extends_config_path(
    host: &dyn Host,
    session: &Session,
    extended: &[u8],
    base: &[u8],
    errors: &mut Vec<ConfigError>,
) -> Option<Vec<u8>> {
    let extended = strings::replace_owned(extended, b"\\", b"/");
    if is_rooted_disk_path(&extended) || extended.starts_with(b"./") || extended.starts_with(b"../")
    {
        let mut path = join(base, &extended);
        if !host.is_file(&path) && !path.ends_with(b".json") {
            path.extend_from_slice(b".json");
            if !host.is_file(&path) {
                errors.push(ConfigError::new(6053, &[&extended]));
                return None;
            }
        }
        return Some(path);
    }
    if extended.is_empty() {
        errors.push(ConfigError::new(18051, &[b"extends"]));
        return None;
    }
    let containing_file = join(base, b"tsconfig.json");
    let found = crate::resolve::resolve_config(host, session, &extended, &containing_file);
    if found.is_none() {
        errors.push(ConfigError::new(6053, &[&extended]));
    }
    found
}

/// `invalidTrailingRecursion`: `**`, `/**`, `**/` and `/**/` at the end, but not `a**b`.
fn invalid_trailing_recursion(spec: &[u8]) -> bool {
    let s = spec.strip_suffix(b"/").unwrap_or(spec);
    s == b"**" || s.ends_with(b"/**")
}

/// `invalidDotDotAfterRecursiveWildcard`
fn invalid_dot_dot_after_recursive_wildcard(s: &[u8]) -> bool {
    let wildcard = if s.starts_with(b"**/") {
        Some(0)
    } else {
        strings::index_of(s, b"/**/")
    };
    let Some(wildcard) = wildcard else {
        return false;
    };
    let last_dot = if s.ends_with(b"/..") {
        Some(s.len())
    } else {
        strings::last_index_of(s, b"/../")
    };
    last_dot.is_some_and(|dot| dot > wildcard)
}

/// `validateSpecs`
fn validate_specs(
    specs: Vec<Vec<u8>>,
    key: &'static [u8],
    problems: &mut Vec<Problem>,
) -> Vec<Vec<u8>> {
    specs
        .into_iter()
        .filter(|spec| {
            // `disallowTrailingRecursion`
            let code = if key == b"include" && invalid_trailing_recursion(spec) {
                5010
            } else if invalid_dot_dot_after_recursive_wildcard(spec) {
                5065
            } else {
                return true;
            };
            problems.push(Problem::new(
                code,
                &[spec],
                Place::TopElement(key, spec.clone()),
            ));
            false
        })
        .collect()
}

/// The same, with `over` applied after everything in the configuration file: the options a command
/// line adds to it, which may depend on whether the file has `references`. The result owns its
/// memory: `session` only holds what is of no use afterwards.
pub fn load_overriding(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    over: &dyn Fn(bool) -> Vec<(Vec<u8>, Json)>,
) -> Project {
    let mut errors = Vec::new();
    let raw = parse_config(host, session, path, &mut Vec::new(), &mut errors);
    let mut raw = raw.unwrap_or_default();
    let base = dirname::<Posix>(path);
    let references = get_project_references(&raw.references, base);
    let has_references = references.is_some_and(|list| !list.is_empty());
    merge_compiler_options(&mut raw.compiler, over(has_references), &[]);
    project_from_raw(host, session, path, base, raw, errors)
}

/// The project consisting of `files` only, or of everything under `dir` if `files` is empty, with
/// `compiler` as `compilerOptions`: the project checked when there is no configuration file.
pub fn without_config(host: &dyn Host, dir: &[u8], compiler: Json, files: Vec<Vec<u8>>) -> Project {
    let raw = Raw {
        compiler: match compiler {
            Json::Object(options) => options,
            _ => Vec::new(),
        },
        files: List {
            is_specified: !files.is_empty(),
            is_array: !files.is_empty(),
            items: (!files.is_empty()).then(|| files.into_iter().map(Json::String).collect()),
        },
        ..Raw::default()
    };
    project_from_raw(host, &Session::new(), b"", dir, raw, Vec::new())
}

/// `getProjectReferences`. `None`: nil.
fn get_project_references(references: &List, base: &[u8]) -> Option<Vec<ProjectReference>> {
    let references = references.items.as_ref()?.iter();
    // `parseProjectReference`
    let references = references.filter_map(|reference| {
        let path = reference.get(b"path").and_then(Json::as_str)?;
        let circular = reference.get(b"circular").and_then(Json::as_bool) == Some(true);
        (!path.is_empty()).then(|| ProjectReference {
            path: join(base, path),
            circular,
        })
    });
    Some(references.collect())
}

/// `parseJsonConfigFileContentWorker`
fn project_from_raw(
    host: &dyn Host,
    session: &Session,
    config_path: &[u8],
    base: &[u8],
    mut raw: Raw,
    mut errors: Vec<ConfigError>,
) -> Project {
    // `handleOptionConfigDirTemplateSubstitution`
    for (key, value) in &mut raw.compiler {
        match value {
            Json::String(s) if is_file_path(key) => {
                if let Some(substituted) = substitute_if_template(s, base) {
                    *s = substituted;
                }
            }
            Json::Array(list) if is_file_path(key) => {
                for item in list {
                    if let Json::String(s) = item
                        && let Some(substituted) = substitute_if_template(s, base)
                    {
                        *s = substituted;
                    }
                }
            }
            Json::Object(patterns) if key == b"paths" => {
                for (_, targets) in patterns {
                    if let Json::Array(targets) = targets {
                        for target in targets {
                            // A substitution is text, which messages quote.
                            if let Json::String(s) = target
                                && let Some(substituted) = substitute_if_template(s, base)
                            {
                                *s = displayed_path(&substituted).into_owned();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let compiler = Json::Object(std::mem::take(&mut raw.compiler));
    let mut options = Options::from_compiler_options(base, &compiler);
    options.use_case_sensitive_file_names = host.is_case_sensitive();
    options.verify(&compiler, config_path);
    errors.extend(
        options
            .problems
            .iter()
            .map(|problem| ConfigError::of_problem(host, session, config_path, problem)),
    );
    // `hasZeroOrNoReferences`
    let has_no_references = raw.references.items.as_ref().is_none_or(Vec::is_empty);
    // Errors outside `compilerOptions`.
    let mut problems = Vec::new();
    let has_empty_files = raw.files.items.as_ref().is_some_and(Vec::is_empty);
    if has_empty_files && has_no_references && !raw.has_extends {
        let config_file_name = displayed_path(config_path);
        problems.push(Problem::new(
            18002,
            &[&config_file_name],
            Place::Top(b"files"),
        ));
    }
    // Emitted files are not read back in as input.
    if !raw.exclude.is_array {
        let written: Vec<Json> = [b"outDir".as_slice(), b"declarationDir"]
            .iter()
            .filter_map(|key| compiler.get(key).and_then(Json::as_str))
            .filter(|dir| !dir.is_empty())
            .map(|dir| Json::String(displayed_path(dir).into_owned()))
            .collect();
        if !written.is_empty() {
            raw.exclude.items = Some(written);
        }
    }
    // `canJsonReportNoInputFiles`
    let can_report_no_inputs = !raw.files.is_specified && !raw.references.is_specified;
    options.is_default_include_spec = raw.files.items.is_none() && raw.include.items.is_none();
    if options.is_default_include_spec {
        raw.include.items = Some(vec![Json::String(b"**/*".to_vec())]);
    }
    let substitute_all = |specs: Vec<Vec<u8>>| -> Vec<Vec<u8>> {
        specs
            .into_iter()
            .map(|spec| substitute_if_template(&spec, base).unwrap_or(spec))
            .collect()
    };
    let validated_include = validate_specs(raw.include.strings(), b"include", &mut problems);
    let include = substitute_all(validated_include.clone());
    options.include_specs = validated_include
        .into_iter()
        .zip(include.iter().cloned())
        .collect();
    let exclude = substitute_all(validate_specs(
        raw.exclude.strings(),
        b"exclude",
        &mut problems,
    ));
    errors.extend(problems.iter().map(|problem| ConfigError {
        is_about_options: false,
        ..ConfigError::of_problem(host, session, config_path, problem)
    }));
    let validated_files = raw.files.strings();
    let literal = substitute_all(validated_files.clone());
    options.file_specs = validated_files
        .into_iter()
        .zip(literal.iter().map(|name| join(base, name)))
        .collect();
    let files = file_names_from_specs(host, base, &options, &literal, &include, &exclude);
    if files.is_empty() && can_report_no_inputs && !config_path.is_empty() {
        errors.push(ConfigError::new(
            18003,
            &[
                &displayed_path(config_path),
                &raw.include.stringify(),
                &raw.exclude.stringify(),
            ],
        ));
    }
    options.files.clone_from(&files);
    let references = get_project_references(&raw.references, base);
    Project {
        config_path: config_path.to_vec(),
        options,
        files,
        base: base.to_vec(),
        exclude,
        has_references: references.is_some(),
        references: references.unwrap_or_default(),
        errors,
        raw_compiler_options: match compiler {
            Json::Object(options) => options,
            _ => Vec::new(),
        },
    }
}

/// `ChangeExtension`
fn change_extension(path: &[u8], extension: &[u8]) -> Vec<u8> {
    match known_extension(path) {
        b"" => path.to_vec(),
        _ => [remove_file_extension(path), extension].concat(),
    }
}

fn extension_group(file: &[u8], extensions: &[&[&'static [u8]]]) -> Vec<&'static [u8]> {
    extensions
        .iter()
        .filter(|group| group.iter().any(|e| file.ends_with(e)))
        .flat_map(|group| group.iter().copied())
        .collect()
}

/// `collections.OrderedMap`
type OrderedFiles = bun_collections::ArrayHashMap<Vec<u8>, Vec<u8>>;

/// `getMatchedIncludeSpec`: the first of `specs` (source text, substituted text) that the file at
/// `path` matches, as its source text. `""` is no match to its caller.
pub fn matched_include_spec<'s>(
    specs: &'s [(Vec<u8>, Vec<u8>)],
    base: &[u8],
    path: &[u8],
    case_sensitive: bool,
) -> Option<&'s [u8]> {
    specs
        .iter()
        .find(|spec| {
            GlobPattern::compile(&spec.1, base, Usage::Files, case_sensitive)
                .is_some_and(|pattern| pattern.matches(path, b""))
        })
        .map(|spec| spec.0.as_slice())
        .filter(|spec| !spec.is_empty())
}

/// `getMatchedFileSpec`: the first of `specs` (source text, path) that names the file at `path`, as
/// its source text. `""` is no match to its callers.
pub fn matched_file_spec<'s>(
    specs: &'s [(Vec<u8>, Vec<u8>)],
    path: &[u8],
    case_sensitive: bool,
) -> Option<&'s [u8]> {
    specs
        .iter()
        .find(|spec| is_same_path(&spec.1, path, case_sensitive))
        .map(|spec| spec.0.as_slice())
        .filter(|spec| !spec.is_empty())
}

/// `getFileNamesFromConfigSpecs`
fn file_names_from_specs(
    host: &dyn Host,
    base: &[u8],
    options: &Options,
    literal: &[Vec<u8>],
    include: &[Vec<u8>],
    exclude: &[Vec<u8>],
) -> Vec<Vec<u8>> {
    let case_sensitive = host.is_case_sensitive();
    let key = |file: &[u8]| to_path(file, case_sensitive).into_owned();
    let supported = supported_extensions(options);
    let mut literal_files = OrderedFiles::default();
    let mut wildcard_files = OrderedFiles::default();
    let mut wildcard_json_files = OrderedFiles::default();
    // The key is the entry as it is written. What is asked below is a path, so only an entry that
    // is one is found.
    for name in literal {
        literal_files.insert(key(name), join(base, name));
    }
    if !include.is_empty() {
        let mut extensions: Vec<&[u8]> = supported.iter().flat_map(|g| g.iter().copied()).collect();
        extensions.extend(extra_supported_extensions(host, options));
        if options.resolve_json_module {
            extensions.push(b".json");
        }
        let mut json_only: Option<Vec<GlobPattern>> = None;
        for file in match_files(host, base, &extensions, exclude, include, case_sensitive) {
            if file.ends_with(b".json") {
                let patterns = json_only.get_or_insert_with(|| {
                    include
                        .iter()
                        .filter(|spec| spec.ends_with(b".json"))
                        .filter_map(|spec| {
                            GlobPattern::compile(spec, base, Usage::Files, case_sensitive)
                        })
                        .collect()
                });
                if patterns.iter().any(|p| p.matches(&file, b"")) {
                    let key = key(&file);
                    if !literal_files.contains_key(&key) && !wildcard_json_files.contains_key(&key)
                    {
                        wildcard_json_files.insert(key, file);
                    }
                }
                continue;
            }
            let group = extension_group(&file, supported);
            // `hasFileWithHigherPriorityExtension`
            let mut has_higher = false;
            for &extension in &group {
                if file.ends_with(extension) && (extension != b".ts" || !file.ends_with(b".d.ts")) {
                    break;
                }
                let other = key(&change_extension(&file, extension));
                if literal_files.contains_key(&other) || wildcard_files.contains_key(&other) {
                    // A declaration file has always been loaded alongside its JavaScript.
                    if extension == b".d.ts" && (file.ends_with(b".js") || file.ends_with(b".jsx"))
                    {
                        continue;
                    }
                    has_higher = true;
                    break;
                }
            }
            if has_higher {
                continue;
            }
            // `removeWildcardFilesWithLowerPriorityExtension`
            for &extension in group.iter().rev() {
                if file.ends_with(extension) {
                    break;
                }
                wildcard_files.ordered_remove(&key(&change_extension(&file, extension)));
            }
            let key = key(&file);
            if !literal_files.contains_key(&key) && !wildcard_files.contains_key(&key) {
                wildcard_files.insert(key, file);
            }
        }
    }
    [literal_files, wildcard_files, wildcard_json_files]
        .into_iter()
        .flat_map(|files| files.into_entries().1)
        .collect()
}

// ───────────────────────────── vfsmatch ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Usage {
    Files,
    Directories,
    Exclude,
}

enum Segment {
    Literal(Vec<u8>),
    /// `*`: any characters but `/`.
    Star,
    /// `?`: one character but `/`.
    Question,
}

enum Component {
    Literal(Vec<u8>),
    /// With `*` or `?` in it. In an include pattern it does not match `node_modules` and the like.
    Wildcard(Vec<Segment>),
    /// `**`: any number of directories.
    DoubleAsterisk,
}

struct GlobPattern {
    components: Vec<Component>,
    is_exclude: bool,
    case_sensitive: bool,
    exclude_min_js: bool,
}

/// `IsImplicitGlob`: `foo` is treated as `foo/**/*` if it has no extension and no wildcard.
fn is_implicit_glob(last: &[u8]) -> bool {
    strings::index_of_any(last, b".*?").is_none()
}

fn is_hidden(name: &[u8]) -> bool {
    name.starts_with(b".")
}

fn is_package_folder(name: &[u8]) -> bool {
    name.eq_ignore_ascii_case(b"node_modules")
        || name.eq_ignore_ascii_case(b"jspm_packages")
        || name.eq_ignore_ascii_case(b"bower_components")
}

/// The path components of `prefix` followed by `suffix`, which is a single component or empty. The
/// root comes first, as `""`.
fn path_parts<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> impl Iterator<Item = &'a [u8]> + Clone {
    let root = prefix.starts_with(b"/").then_some(&b""[..]);
    root.into_iter()
        .chain(strings::split(prefix, b"/").filter(|p| !p.is_empty()))
        .chain((!suffix.is_empty()).then_some(suffix))
}

impl GlobPattern {
    /// `compileGlobPattern`. `None`: it matches nothing.
    fn compile(
        spec: &[u8],
        base: &[u8],
        usage: Usage,
        case_sensitive: bool,
    ) -> Option<GlobPattern> {
        let absolute = join(base, spec);
        let mut parts: Vec<&[u8]> = std::iter::once(&b""[..])
            .chain(strings::split(&absolute, b"/").filter(|p| !p.is_empty()))
            .collect();
        if usage != Usage::Exclude && parts.last() == Some(&&b"**"[..]) {
            return None;
        }
        if is_implicit_glob(parts.last().copied().unwrap_or(b"")) {
            parts.push(b"**");
            parts.push(b"*");
        }
        Some(GlobPattern {
            components: parts
                .into_iter()
                .map(|part| {
                    if part == b"**" {
                        Component::DoubleAsterisk
                    } else if strings::index_of_any(part, b"*?").is_none() {
                        Component::Literal(part.to_vec())
                    } else {
                        Component::Wildcard(parse_segments(part))
                    }
                })
                .collect(),
            is_exclude: usage == Usage::Exclude,
            case_sensitive,
            exclude_min_js: usage == Usage::Files,
        })
    }

    fn matches(&self, prefix: &[u8], suffix: &[u8]) -> bool {
        self.match_parts(path_parts(prefix, suffix), 0, false)
    }

    /// Whether files under the directory could match.
    fn matches_prefix(&self, prefix: &[u8], suffix: &[u8]) -> bool {
        self.match_parts(path_parts(prefix, suffix), 0, true)
    }

    /// `matchPathParts`
    fn match_parts<'a>(
        &self,
        mut parts: impl Iterator<Item = &'a [u8]> + Clone,
        mut at: usize,
        prefix_only: bool,
    ) -> bool {
        loop {
            let before = parts.clone();
            let Some(part) = parts.next() else {
                // Only trailing `**` can match nothing.
                return prefix_only
                    || self.components[at.min(self.components.len())..]
                        .iter()
                        .all(|c| matches!(c, Component::DoubleAsterisk));
            };
            let Some(component) = self.components.get(at) else {
                return self.is_exclude && !prefix_only;
            };
            match component {
                Component::DoubleAsterisk => {
                    if self.match_parts(before, at + 1, prefix_only) {
                        return true;
                    }
                    if !self.is_exclude && (is_hidden(part) || is_package_folder(part)) {
                        return false;
                    }
                    continue;
                }
                Component::Literal(literal) => {
                    if !self.equal(literal, part) {
                        return false;
                    }
                }
                Component::Wildcard(segments) => {
                    if !self.is_exclude && is_package_folder(part) {
                        return false;
                    }
                    if !self.match_wildcard(segments, part) {
                        return false;
                    }
                }
            }
            at += 1;
        }
    }

    /// `stringsEqual`
    fn equal(&self, a: &[u8], b: &[u8]) -> bool {
        a == b || !self.case_sensitive && equate_string_case_insensitive(a, b)
    }

    /// `matchWildcard`
    fn match_wildcard(&self, segments: &[Segment], s: &[u8]) -> bool {
        // In an include pattern a wildcard at the start does not match a hidden file.
        if !self.is_exclude
            && is_hidden(s)
            && matches!(segments.first(), Some(Segment::Star | Segment::Question))
        {
            return false;
        }
        self.match_segments(segments, s) && self.should_include_min_js(s, segments)
    }

    /// `matchSegments`: backtracks only to the most recent `*`.
    fn match_segments(&self, segments: &[Segment], s: &[u8]) -> bool {
        let next_char = |at: usize| at + s[at..].char_indices().next().map_or(1, |c| c.1);
        let (mut segment, mut at) = (0, 0);
        let mut star: Option<(usize, usize)> = None;
        while at < s.len() {
            match segments.get(segment) {
                Some(Segment::Literal(literal)) => {
                    let end = at + literal.len();
                    if s.get(at..end).is_some_and(|part| self.equal(literal, part)) {
                        at = end;
                        segment += 1;
                        continue;
                    }
                }
                Some(Segment::Question) => {
                    at = next_char(at);
                    segment += 1;
                    continue;
                }
                Some(Segment::Star) => {
                    star = Some((segment, at));
                    segment += 1;
                    continue;
                }
                None => {}
            }
            match star {
                Some((star_segment, star_at)) if star_at < s.len() => {
                    let star_at = next_char(star_at);
                    star = Some((star_segment, star_at));
                    at = star_at;
                    segment = star_segment + 1;
                }
                _ => return false,
            }
        }
        segments[segment.min(segments.len())..]
            .iter()
            .all(|s| matches!(s, Segment::Star))
    }

    /// `shouldIncludeMinJs`: `*` does not match `.min.js` files unless the pattern mentions `.min.`.
    fn should_include_min_js(&self, name: &[u8], segments: &[Segment]) -> bool {
        if !self.exclude_min_js {
            return true;
        }
        let is_min_js = if self.case_sensitive {
            name.ends_with(b".min.js")
        } else {
            name.to_ascii_lowercase().ends_with(b".min.js")
        };
        // `patternMentionsMinSuffix`
        !is_min_js
            || segments.iter().any(|segment| match segment {
                Segment::Literal(literal) if self.case_sensitive => {
                    strings::contains(literal, b".min.")
                }
                Segment::Literal(literal) => {
                    strings::contains(&strings_to_lower(literal), b".min.")
                }
                _ => false,
            })
    }
}

/// `unicode.ToLower`: not the two characters that `char::to_lowercase` makes of U+0130.
fn to_lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// `strings.ToLower`
fn strings_to_lower(text: &[u8]) -> Vec<u8> {
    let mut lower = Vec::with_capacity(text.len());
    for c in text.chars().map(to_lower) {
        lower.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
    }
    lower
}

/// `CompareStringsCaseInsensitive`
pub(crate) fn compare_strings_case_insensitive(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    a.chars().map(to_lower).cmp(b.chars().map(to_lower))
}

/// `parseSegments`: `*.ts` is a star and `.ts`.
fn parse_segments(s: &[u8]) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, &c) in s.iter().enumerate() {
        if c == b'*' || c == b'?' {
            if i > start {
                out.push(Segment::Literal(s[start..i].to_vec()));
            }
            out.push(if c == b'*' {
                Segment::Star
            } else {
                Segment::Question
            });
            start = i + 1;
        }
    }
    if start < s.len() {
        out.push(Segment::Literal(s[start..].to_vec()));
    }
    out
}

struct GlobMatcher {
    includes: Vec<GlobPattern>,
    excludes: Vec<GlobPattern>,
    had_includes: bool,
}

impl GlobMatcher {
    fn new(
        includes: &[Vec<u8>],
        excludes: &[Vec<u8>],
        base: &[u8],
        case_sensitive: bool,
        usage: Usage,
    ) -> GlobMatcher {
        GlobMatcher {
            had_includes: !includes.is_empty(),
            includes: includes
                .iter()
                .filter_map(|spec| GlobPattern::compile(spec, base, usage, case_sensitive))
                .collect(),
            excludes: excludes
                .iter()
                .filter_map(|spec| GlobPattern::compile(spec, base, Usage::Exclude, case_sensitive))
                .collect(),
        }
    }

    /// The index of the include pattern the file matches.
    fn matches_file(&self, prefix: &[u8], name: &[u8]) -> Option<usize> {
        if self.excludes.iter().any(|p| p.matches(prefix, name)) {
            return None;
        }
        if self.includes.is_empty() {
            return (!self.had_includes).then_some(0);
        }
        self.includes.iter().position(|p| p.matches(prefix, name))
    }

    fn matches_directory(&self, prefix: &[u8], name: &[u8]) -> bool {
        if self.excludes.iter().any(|p| p.matches(prefix, name)) {
            return false;
        }
        if self.includes.is_empty() {
            return !self.had_includes;
        }
        self.includes.iter().any(|p| p.matches_prefix(prefix, name))
    }
}

/// `getIncludeBasePath`
fn include_base_path(absolute: &[u8]) -> Vec<u8> {
    match strings::index_of_any(absolute, b"*?") {
        // `HasExtension`
        None if !strings::contains_char(get_base_file_name(absolute), b'.') => absolute.to_vec(),
        None => {
            let directory = dirname::<Posix>(absolute);
            directory.strip_suffix(b"/").unwrap_or(directory).to_vec()
        }
        Some(wildcard) => {
            let end = strings::last_index_of_char(&absolute[..wildcard], b'/').unwrap_or(0);
            absolute[..end].to_vec()
        }
    }
}

/// `getBasePaths`: the directories to start the search from, none nested in another. A rooted
/// include is taken as it is written: from its first `.` or `..` on, nothing is reduced.
fn base_paths(path: &[u8], includes: &[Vec<u8>], case_sensitive: bool) -> Vec<Vec<u8>> {
    let mut out = vec![path.to_vec()];
    let mut include_bases: Vec<Vec<u8>> = includes
        .iter()
        .map(|include| {
            let names = strings::split_any(include, b"/\\");
            let reduced = names.take_while(|name| !matches!(*name, b"." | b".."));
            let end: usize = match is_rooted_disk_path(include) {
                true => reduced.map(|name| name.len() + 1).sum(),
                false => include.len(),
            };
            let (reduced, written) = include.split_at(end.min(include.len()));
            let written = strings::split_any(written, b"/\\").filter(|name| !name.is_empty());
            let absolute = written.fold(join(path, reduced), |dir, name| inside(&dir, name));
            include_base_path(&absolute)
        })
        .collect();
    if case_sensitive {
        include_bases.sort();
    } else {
        include_bases.sort_by(|a, b| compare_strings_case_insensitive(a, b));
    }
    // `ContainsPath` is relative to `path` and reduces the components.
    let contains = |parent: &[u8], child: &[u8]| {
        contains_path(&join(path, parent), &join(path, child), case_sensitive)
    };
    for base in include_bases {
        if out.iter().all(|known| !contains(known, &base)) {
            out.push(base);
        }
    }
    out
}

/// `matchFiles`: the files under `path` with one of `extensions` that `includes` match and
/// `excludes` do not, ordered by include pattern and then in traversal order: the files of a
/// directory before its subdirectories, each sorted.
fn match_files(
    host: &dyn Host,
    path: &[u8],
    extensions: &[&[u8]],
    excludes: &[Vec<u8>],
    includes: &[Vec<u8>],
    case_sensitive: bool,
) -> Vec<Vec<u8>> {
    /// The matching entries of a directory: the files, each with the include pattern it matches,
    /// and the subdirectories.
    struct Listed {
        files: Vec<(usize, Vec<u8>)>,
        directories: Vec<Vec<u8>>,
    }
    struct Matchers<'a> {
        host: &'a dyn Host,
        files: GlobMatcher,
        directories: GlobMatcher,
        extensions: &'a [&'a [u8]],
    }
    impl Matchers<'_> {
        fn list(&self, path: &[u8]) -> Listed {
            let (files, directories) = self.host.entries(path);
            let prefix = if path.ends_with(b"/") {
                path.to_vec()
            } else {
                [path, b"/"].concat()
            };
            Listed {
                files: files
                    .into_iter()
                    .filter(|file| file_extension_is_one_of(file, self.extensions))
                    .filter_map(|file| {
                        let index = self.files.matches_file(&prefix, &file)?;
                        Some((index, [&prefix[..], &file[..]].concat()))
                    })
                    .collect(),
                directories: directories
                    .into_iter()
                    .filter(|directory| self.directories.matches_directory(&prefix, directory))
                    .map(|directory| [&prefix[..], &directory[..]].concat())
                    .collect(),
            }
        }
    }
    struct Visitor<'a> {
        matchers: Matchers<'a>,
        case_sensitive: bool,
        visited: crate::util::FxHashSet<Vec<u8>>,
        /// Listings computed ahead of the traversal.
        listed: crate::util::FxHashMap<Vec<u8>, Listed>,
        results: Vec<Vec<Vec<u8>>>,
    }
    impl Visitor<'_> {
        fn visit(&mut self, path: &[u8]) {
            // A symlink can form a cycle.
            let real = self.matchers.host.realpath(path);
            let canonical = to_path(&real, self.case_sensitive).into_owned();
            if !self.visited.insert(canonical) {
                return;
            }
            let listed = match self.listed.remove(path) {
                Some(listed) => listed,
                None => self.matchers.list(path),
            };
            for (index, file) in listed.files {
                self.results[index].push(file);
            }
            for directory in listed.directories {
                self.visit(&directory);
            }
        }
    }
    let path = join(b"", path);
    let files = GlobMatcher::new(includes, excludes, &path, case_sensitive, Usage::Files);
    let directories = GlobMatcher::new(
        includes,
        excludes,
        &path,
        case_sensitive,
        Usage::Directories,
    );
    let buckets = files.includes.len().max(1);
    let mut visitor = Visitor {
        matchers: Matchers {
            host,
            files,
            directories,
            extensions,
        },
        case_sensitive,
        visited: Default::default(),
        listed: Default::default(),
        results: (0..buckets).map(|_| Vec::new()).collect(),
    };
    let bases = base_paths(&path, includes, case_sensitive);
    // The traversal visits the directories sequentially, in the order that determines the order of
    // the files. The entries of each directory and which of them match have been computed by then,
    // for many directories at a time.
    let mut level: Vec<Vec<u8>> = bases.clone();
    let mut requested: crate::util::FxHashSet<Vec<u8>> = Default::default();
    while !level.is_empty() {
        let found: Vec<bun_threading::Guarded<Option<Listed>>> =
            level.iter().map(|_| Default::default()).collect();
        host.parallel(level.len(), &|i| {
            host.realpath(&level[i]);
            *found[i].lock() = Some(visitor.matchers.list(&level[i]));
        });
        let mut next = Vec::new();
        for (path, listed) in level.into_iter().zip(found) {
            let listed = listed.lock().take().unwrap();
            for directory in &listed.directories {
                if requested.insert(host.realpath(directory)) {
                    next.push(directory.clone());
                }
            }
            visitor.listed.insert(path, listed);
        }
        level = next;
    }
    for base in bases {
        visitor.visit(&base);
    }
    visitor.results.into_iter().flatten().collect()
}
