//! Reads a `tsconfig.json`: `extends`, `files`, `include`, `exclude`, `references` and `${configDir}`, and finds the files it names.
//!
//! A port of `internal/tsoptions/tsconfigparsing.go` and `internal/vfs/vfsmatch/vfsmatch.go`.

use crate::config_options::{In, converted, is_file_path};
use crate::json::{Json, TsConfigSourceFile};
use crate::resolve::{
    Host, Options, ancestors, contains_path, is_same_path, join, known_extension,
    remove_file_extension, supported_extensions, to_file_name_lower_case, to_path,
};
use crate::session::Session;
use crate::verify::{Place, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, relative_normalized};

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
    /// `RelatedInformation`, all of it in the configuration file: the span, and the code of a
    /// message without arguments.
    pub related: Vec<(u32, u32, u32)>,
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
                .map(|&(_, from, to, code)| (from, to, code))
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
        let config = (self.config_path.strip_suffix(b".json")).unwrap_or(&self.config_path);
        let options = &self.options;
        let mut name = if options.out_dir.is_empty() {
            config.to_vec()
        } else if options.root_dir.is_empty() {
            join(&options.out_dir, bun_paths::basename_posix(config))
        } else {
            let relative = relative_normalized::<Posix, true>(&options.root_dir, config);
            join(&options.out_dir, relative)
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

/// `findConfigFile`: the `tsconfig.json` in `dir` or in its nearest ancestor directory. A
/// `jsconfig.json` is used if the same directory has no `tsconfig.json`.
pub fn find_config(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    ancestors(dir)
        .flat_map(|dir| [b"tsconfig.json", b"jsconfig.json"].map(|name| join(dir, name)))
        .find(|candidate| host.is_file(candidate))
}

/// One configuration file with its extended configuration files merged in.
#[derive(Default)]
struct Raw {
    /// `compilerOptions`. Paths are absolute, or start with `${configDir}`.
    compiler: Vec<(Vec<u8>, Json)>,
    files: List,
    include: List,
    exclude: List,
    references: Option<Vec<ProjectReference>>,
    /// `rawConfig.Has("references")`
    has_references: bool,
    has_extends: bool,
}

/// `files`, `include` or `exclude`.
#[derive(Default)]
struct List {
    /// `rawConfig.Has`: the property is there, whatever its value.
    is_specified: bool,
    /// `propOfRaw.sliceValue`. `convertArrayLiteralElementsToJson` leaves out the elements that are
    /// `null`, and a list of nothing else is nil. An element of the wrong type is still in it.
    items: Option<Vec<Json>>,
}

impl List {
    fn of(value: Option<&Json>) -> List {
        let items = value.and_then(Json::as_array).and_then(|items| {
            let kept: Vec<Json> = (items.iter())
                .filter(|item| !matches!(item, Json::Null))
                .cloned()
                .collect();
            (items.is_empty() || !kept.is_empty()).then_some(kept)
        });
        List {
            is_specified: value.is_some(),
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

/// `normalizeNonListOptionValue`
fn absolute_unless_template(value: &[u8], base: &[u8]) -> Vec<u8> {
    let value = strings::replace_owned(value, b"\\", b"/");
    if starts_with_config_dir_template(&value) {
        value
    } else {
        join(base, &value)
    }
}

/// `mergeCompilerOptions`: the values of `source` take precedence. `null` unsets an earlier value,
/// so it is preserved until everything is merged.
fn merge_compiler_options(target: &mut Vec<(Vec<u8>, Json)>, source: Vec<(Vec<u8>, Json)>) {
    for (key, value) in source {
        target.retain(|(k, _)| *k != key);
        target.push((key, value));
    }
}

/// `parseConfig`. The syntax trees of the files are left in `session`.
fn parse_config(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    stack: &mut Vec<Vec<u8>>,
    errors: &mut Vec<ConfigError>,
    as_typescript_does: bool,
) -> Option<Raw> {
    if stack.iter().any(|p| p == path) {
        let mut chain = stack.clone();
        chain.push(path.to_vec());
        errors.push(ConfigError::new(18000, &[&chain.join(&b" -> "[..])]));
        return None;
    }
    let text = host.read(path);
    let Some(file) = text.and_then(|text| TsConfigSourceFile::parse(host, session, text)) else {
        errors.push(ConfigError::new(5083, &[path]));
        return None;
    };
    let at = |(from, to): (u32, u32)| (path.to_vec(), from, to);
    let reported = errors.len();
    errors.extend(
        file.diagnostics()
            .map(|(code, args, from, to)| ConfigError {
                args,
                at: Some(at((from, to))),
                ..ConfigError::new(code, &[])
            }),
    );
    // `ParseExtendedConfig`: an extended file that does not parse is ignored.
    if !stack.is_empty() && errors.len() > reported {
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
    // The node of the value that `name` is set to.
    let value_of = |name: &[u8]| Some(file.initializer(file.property(file.root?, name, b"")?));
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
    if let Some(compiler) = json.get(b"compilerOptions").and_then(Json::as_object)
        && let Some(written) = value_of(b"compilerOptions")
    {
        let within = In::CompilerOptions { as_typescript_does };
        let problems = crate::config_options::problems(&file, written, compiler, within);
        // `convertJsonOption`: an invalid value is treated as unspecified. So is an invalid element
        // of a list.
        let omitted: Vec<(Vec<u8>, Option<usize>)> = problems
            .iter()
            .map(|problem| (problem.name.clone(), problem.index))
            .collect();
        let is_omitted =
            |key: &[u8], index| (omitted.iter()).any(|it| it.0 == key && it.1 == index);
        errors.extend(problems.into_iter().map(|problem| ConfigError {
            code: problem.code,
            args: problem.args,
            at: problem.span.map(at),
            ..ConfigError::new(problem.code, &[])
        }));
        let mut specified = Vec::with_capacity(compiler.len());
        for (key, value) in compiler {
            if is_omitted(key, None) {
                continue;
            }
            let value = match converted(key, value, |index| is_omitted(key, Some(index))) {
                Json::String(s) if is_file_path(key) => {
                    Json::String(absolute_unless_template(&s, base))
                }
                Json::Array(list) if is_file_path(key) => Json::Array(
                    list.into_iter()
                        .map(|item| match item {
                            Json::String(s) => Json::String(absolute_unless_template(&s, base)),
                            other => other,
                        })
                        .collect(),
                ),
                other => other,
            };
            // `PathsBasePath`: `paths` can be inherited from a configuration file in another directory.
            if key == b"paths" {
                specified.push((b"pathsBasePath".to_vec(), Json::String(base.to_vec())));
            }
            specified.push((key.clone(), value));
        }
        merge_compiler_options(&mut own.compiler, specified);
    }
    // `convertJsonOption` for the properties outside `compilerOptions`.
    if let (Some(root), Some(properties)) = (file.root, json.as_object()) {
        let problems = crate::config_options::problems(&file, root, properties, In::Root);
        errors.extend(problems.into_iter().map(|problem| ConfigError {
            code: problem.code,
            args: problem.args,
            at: problem.span.map(at),
            ..ConfigError::new(problem.code, &[])
        }));
    }
    own.files = List::of(json.get(b"files"));
    own.include = List::of(json.get(b"include"));
    own.exclude = List::of(json.get(b"exclude"));
    own.has_references = json.get(b"references").is_some();
    own.references = json
        .get(b"references")
        .and_then(Json::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    let path = r.get(b"path").and_then(Json::as_str)?;
                    let circular = r.get(b"circular").and_then(Json::as_bool) == Some(true);
                    (!path.is_empty()).then(|| ProjectReference {
                        path: join(base, path),
                        circular,
                    })
                })
                .collect()
        });
    let extends: Vec<(usize, Vec<u8>)> = match json.get(b"extends") {
        Some(Json::String(one)) => vec![(0, one.clone())],
        Some(Json::Array(many)) => many
            .iter()
            .enumerate()
            .filter_map(|(i, e)| Some((i, e.as_str()?.to_vec())))
            .collect(),
        _ => Vec::new(),
    };
    own.has_extends = json.get(b"extends").is_some();
    if extends.is_empty() {
        return Some(own);
    }
    stack.push(path.to_vec());
    let mut inherited = Raw::default();
    for (i, name) in &extends {
        let reported = errors.len();
        let Some(extended_path) = extends_config_path(host, session, name, base, errors) else {
            // `CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic`, at `valueExpression`.
            let value =
                value_of(b"extends").map(|value| file.elements(value).nth(*i).unwrap_or(value));
            for error in &mut errors[reported..] {
                error.at = value.map(|value| at(file.span(value)));
            }
            continue;
        };
        let extended = parse_config(
            host,
            session,
            &extended_path,
            stack,
            errors,
            as_typescript_does,
        );
        let Some(extended) = extended else {
            continue;
        };
        // A property the extending file does not specify itself takes the value from the last of
        // the extended files, relative to that file's directory.
        // `relativeDifference`: from the directory of the extending file. 18003 prints the result.
        let extended_dir = dirname::<Posix>(&extended_path);
        let relative_difference = relative_normalized::<Posix, true>(base, extended_dir).to_vec();
        let rebase = |specs: Vec<Json>| -> Vec<Json> {
            specs
                .into_iter()
                .map(|spec| match spec {
                    // Not normalized: `..` after `**` is an error that is still to be reported.
                    Json::String(spec)
                        if !(starts_with_config_dir_template(&spec)
                            || spec.starts_with(b"/")
                            || relative_difference.is_empty()) =>
                    {
                        Json::String([&relative_difference[..], b"/", &spec[..]].concat())
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
                    items: Some(rebase(items)),
                };
            }
        };
        inherit(&own.include, &mut inherited.include, extended.include);
        inherit(&own.exclude, &mut inherited.exclude, extended.exclude);
        inherit(&own.files, &mut inherited.files, extended.files);
        merge_compiler_options(&mut inherited.compiler, extended.compiler);
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
    merge_compiler_options(&mut inherited.compiler, specified);
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
    if extended.starts_with(b"/") || extended.starts_with(b"./") || extended.starts_with(b"../") {
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
    let raw = parse_config(host, session, path, &mut Vec::new(), &mut errors, false);
    let mut raw = raw.unwrap_or_default();
    let has_references = raw.references.as_ref().is_some_and(|list| !list.is_empty());
    merge_compiler_options(&mut raw.compiler, over(has_references));
    project_from_raw(host, session, path, dirname::<Posix>(path), raw, errors)
}

/// The same, following TypeScript 7 only: an option that only older versions accepted is as invalid
/// as an unknown one, and an invalid option is treated as unspecified.
#[cfg(feature = "baselines")]
pub fn load_as_typescript_does(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    over: Vec<(Vec<u8>, Json)>,
) -> Project {
    let mut errors = Vec::new();
    let raw = parse_config(host, session, path, &mut Vec::new(), &mut errors, true);
    let mut raw = raw.unwrap_or_default();
    merge_compiler_options(&mut raw.compiler, over);
    project_from_raw(host, session, path, dirname::<Posix>(path), raw, errors)
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
            items: (!files.is_empty()).then(|| files.into_iter().map(Json::String).collect()),
        },
        ..Raw::default()
    };
    project_from_raw(host, &Session::new(), b"", dir, raw, Vec::new())
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
    raw.compiler
        .retain(|(_, value)| !matches!(value, Json::Null));
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
                            if let Json::String(s) = target
                                && let Some(substituted) = substitute_if_template(s, base)
                            {
                                *s = substituted;
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
    options.verify(&compiler, config_path);
    errors.extend(
        options
            .problems
            .iter()
            .map(|problem| ConfigError::of_problem(host, session, config_path, problem)),
    );
    let has_no_references = raw.references.as_ref().is_none_or(Vec::is_empty);
    // Errors outside `compilerOptions`.
    let mut problems = Vec::new();
    let has_empty_files = raw.files.items.as_ref().is_some_and(Vec::is_empty);
    if has_empty_files && has_no_references && !raw.has_extends {
        problems.push(Problem::new(18002, &[config_path], Place::Top(b"files")));
    }
    // Emitted files are not read back in as input.
    if raw.exclude.items.is_none() {
        let written: Vec<Json> = [b"outDir".as_slice(), b"declarationDir"]
            .iter()
            .filter_map(|key| compiler.get(key).and_then(Json::as_str))
            .filter(|dir| !dir.is_empty())
            .map(|dir| Json::String(dir.to_vec()))
            .collect();
        if !written.is_empty() {
            raw.exclude.items = Some(written);
        }
    }
    // `canJsonReportNoInputFiles`
    let can_report_no_inputs = !raw.files.is_specified && !raw.has_references;
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
    let literal = substitute_all(raw.files.strings());
    // `getMatchedFileSpec` returns the spec as it is written, and `""` is no match to its callers.
    let written = literal.iter().filter(|name| !name.is_empty());
    options.file_specs = written.map(|name| join(base, name)).collect();
    let files = file_names_from_specs(host, base, &options, &literal, &include, &exclude);
    if files.is_empty() && can_report_no_inputs && !config_path.is_empty() {
        errors.push(ConfigError::new(
            18003,
            &[
                config_path,
                &raw.include.stringify(),
                &raw.exclude.stringify(),
            ],
        ));
    }
    options.files.clone_from(&files);
    Project {
        config_path: config_path.to_vec(),
        options,
        files,
        base: base.to_vec(),
        exclude,
        references: raw.references.unwrap_or_default(),
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
/// `path` matches, as its source text.
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
    for name in literal {
        let file = join(base, name);
        literal_files.insert(key(&file), file);
    }
    if !include.is_empty() {
        let mut extensions: Vec<&[u8]> = supported.iter().flat_map(|g| g.iter().copied()).collect();
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

    fn equal(&self, a: &[u8], b: &[u8]) -> bool {
        is_same_path(a, b, self.case_sensitive)
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
        !is_min_js
            || segments.iter().any(|segment| match segment {
                Segment::Literal(literal) if self.case_sensitive => {
                    strings::contains(literal, b".min.")
                }
                Segment::Literal(literal) => {
                    strings::contains(&literal.to_ascii_lowercase(), b".min.")
                }
                _ => false,
            })
    }
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
        None => {
            let name = absolute.rsplit(|&b| b == b'/').next().unwrap_or(b"");
            if strings::contains_char(name, b'.') {
                dirname::<Posix>(absolute).to_vec()
            } else {
                absolute.to_vec()
            }
        }
        Some(wildcard) => {
            let end = strings::last_index_of_char(&absolute[..wildcard], b'/').unwrap_or(0);
            if end == 0 {
                b"/".to_vec()
            } else {
                absolute[..end].to_vec()
            }
        }
    }
}

/// `getBasePaths`: the directories to start the search from, none nested in another.
fn base_paths(path: &[u8], includes: &[Vec<u8>], case_sensitive: bool) -> Vec<Vec<u8>> {
    let mut out = vec![path.to_vec()];
    let mut include_bases: Vec<Vec<u8>> = includes
        .iter()
        .map(|include| include_base_path(&join(path, include)))
        .collect();
    if case_sensitive {
        include_bases.sort();
    } else {
        include_bases.sort_by_key(|p| to_file_name_lower_case(p));
    }
    for base in include_bases {
        if out
            .iter()
            .all(|known| !contains_path(known, &base, case_sensitive))
        {
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
                    .filter(|file| self.extensions.iter().any(|e| file.ends_with(e)))
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
