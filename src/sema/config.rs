//! Reads a `tsconfig.json` (`extends`, `files`, `include`, `exclude`, `references`, `${configDir}`) and finds the files
//! it includes.
//!
//! A port of `internal/tsoptions/tsconfigparsing.go` and `internal/vfs/vfsmatch/vfsmatch.go`.

use crate::config_options::{Declaration, In, converted, is_enum, is_file_path, is_list};
use crate::content_mapper::{self, ExtensionRewrite, Mapper};
use crate::json::{Json, TsConfigSourceFile};
use crate::resolve::{
    Host, Options, ancestors, combine_paths, contains_path, displayed_path,
    equate_string_case_insensitive, extra_supported_extensions, file_extension_is_one_of,
    get_base_file_name, get_path_components, get_relative_path_from_directory,
    is_refused_network_path, is_rooted_disk_path, is_same_path, join, known_extension,
    remove_file_extension, root_length, supported_extensions, to_path, typescript_path,
};
use crate::session::Session;
use crate::util::{FxHashSet, SharedSort};
use crate::verify::{ConfigLocation, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;

mod build_options;

pub use self::build_options::{
    compile_build_overrides, default_options_of_aot_package, find_package_with_compiler_options,
    load_for_aot_package, load_for_build, load_for_build_with_unlisted_files,
    load_options_for_build, load_referenced_projects_for_build,
};

/// A configuration file error: TypeScript's message code and the message arguments.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfigError {
    pub code: u32,
    pub args: Vec<Vec<u8>>,
    /// Its span, if it has one: file, start, end.
    pub at: Option<(Vec<u8>, u32, u32)>,
    /// The message chain below it: indentation level, code, message arguments.
    pub chain: Vec<(u32, u32, Vec<Vec<u8>>)>,
    /// `GetProgramDiagnostics`, not `GetConfigFileParsingDiagnostics`: the file could be read, but its options are
    /// inconsistent.
    pub is_about_options: bool,
    /// `RelatedInformation`: span, code and message arguments. It's in the same file as `at`, or in the project's
    /// configuration file if `at` is `None`.
    pub related: Vec<(u32, u32, u32, Vec<Vec<u8>>)>,
    /// The file, or one it extends, is missing, is not JSON, or extends itself: what was read is not what was written.
    pub is_unreadable: bool,
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
            is_unreadable: false,
        }
    }

    /// Converts `problems` in the configuration file at `config_path`, which may not exist. The file is parsed once for
    /// all of them, because each of thousands of `paths` can have one. Its syntax tree stays in `session`.
    pub fn from_problems<'a>(
        host: &dyn Host,
        session: &Session,
        config_path: &[u8],
        problems: impl IntoIterator<Item = &'a Problem>,
    ) -> Vec<ConfigError> {
        let mut problems = problems.into_iter().peekable();
        if problems.peek().is_none() {
            return Vec::new();
        }
        let file = (!config_path.is_empty())
            .then(|| host.read(config_path))
            .flatten()
            .and_then(|text| TsConfigSourceFile::parse(host, session, text));
        problems
            .map(|problem| Self::from_problem(file.as_ref(), config_path, problem))
            .collect()
    }

    fn from_problem(
        file: Option<&TsConfigSourceFile>,
        config_path: &[u8],
        problem: &Problem,
    ) -> ConfigError {
        let at = file
            .and_then(|file| problem.span_in(file))
            .map(|(from, to)| (config_path.to_vec(), from, to));
        ConfigError {
            code: problem.code,
            args: problem.args.clone(),
            at,
            chain: problem.chain.clone(),
            is_about_options: true,
            // Only a problem that's itself reported in a program file (`Files::include_problems_in`) has related
            // information in one, and those don't come through here.
            related: (problem.related.iter())
                .filter(|it| it.0 == crate::program::IN_CONFIGURATION)
                .map(|&(_, from, to, code)| (from, to, code, Vec::new()))
                .collect(),
            is_unreadable: false,
        }
    }
}

/// `core.ProjectReference`
#[derive(Clone)]
pub struct ProjectReference {
    /// The referenced project's directory or configuration file.
    pub path: Vec<u8>,
    pub circular: bool,
}

/// `ParsedCommandLine`
#[derive(Clone)]
pub struct Project {
    /// The configuration file. Empty if there is none.
    pub config_path: Vec<u8>,
    pub options: Options,
    /// The root files in TypeScript's order: the entries of `files`, then the matches of `include`.
    pub files: Vec<Vec<u8>>,
    /// The directory that `exclude` is relative to.
    base: Vec<u8>,
    /// `exclude`, or by default the directories the project writes to.
    exclude: Vec<Vec<u8>>,
    pub references: Vec<ProjectReference>,
    /// `ProjectReferences() != nil`: `references` is an array, whatever it contains.
    pub has_references: bool,
    pub errors: Vec<ConfigError>,
    /// The merged `compilerOptions` of all the files that were read, which `options` is built from. `paths` is omitted,
    /// because there can be thousands and `options.paths` has them.
    pub raw_compiler_options: Vec<(Vec<u8>, Json)>,
    pub written: VerbatimSpecs,
    /// Of a project that was loaded without listing its root files: `files` is empty, and this lists them.
    pub unlisted_files: Option<RootFileSpecs>,
}

/// `files`, `include` and `exclude` of a project, and the options that decide which files they match.
#[derive(Clone)]
pub struct RootFileSpecs {
    base: Vec<u8>,
    literal: Vec<Vec<u8>>,
    include: Vec<Vec<u8>>,
    exclude: Vec<Vec<u8>>,
    allow_js: bool,
    resolve_json_module: bool,
}

impl RootFileSpecs {
    /// `on_match` gets each file that `include` matches as soon as its directory is listed. A few of them aren't in the result.
    pub fn list(&self, host: &dyn Host, on_match: &mut dyn FnMut(&[u8])) -> Vec<Vec<u8>> {
        let options = Options {
            allow_js: self.allow_js,
            resolve_json_module: self.resolve_json_module,
            ..Options::default()
        };
        let specs = (&self.literal[..], &self.include[..], &self.exclude[..]);
        file_names_from_specs_noting(host, &self.base, &options, specs, on_match)
    }
}

/// `files`, `include` and `exclude` exactly as written in the file that sets them. Entries from an extended file aren't
/// made relative to the extending file, and nothing is dropped. `None` if no file sets it. This isn't how TypeScript
/// interprets them. `bun lint`'s import graph reads them for oxlint's rule about which files a `tsconfig.json` applies
/// to.
#[derive(Clone, Default)]
pub struct VerbatimSpecs {
    pub files: Option<Vec<Vec<u8>>>,
    pub include: Option<Vec<Vec<u8>>>,
    pub exclude: Option<Vec<Vec<u8>>>,
}

impl Project {
    /// Returns the files the project would have if it included the whole directory `dir`, minus what it excludes.
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

    pub fn roots(&self, host: &dyn Host) -> Roots {
        let case_sensitive = host.is_case_sensitive();
        let specs = self.options.include_specs.iter();
        let include: Vec<Vec<u8>> = specs.map(|it| it.1.clone()).collect();
        let base = join(b"", &self.base);
        let extra_extensions = extra_supported_extensions(host, &self.options);
        let patterns =
            GlobMatcher::new(&include, &self.exclude, &base, case_sensitive, Usage::Files);
        let base: Vec<Vec<u8>> = (PathParts::split_directory(typescript_path(&base)).iter())
            .map(|it| it.to_vec())
            .collect();
        let begins_with_base = |pattern: &GlobPattern| {
            let mut first = pattern.components.iter().zip(&base);
            pattern.components.len() >= base.len()
                && first.all(|it| matches!(it.0, Component::Literal(name) if name == it.1))
        };
        Roots {
            literal: (self.options.file_specs.iter())
                .map(|it| it.1.clone())
                .collect(),
            has_include: !include.is_empty(),
            include_begins_with_base: patterns.includes.iter().map(begins_with_base).collect(),
            exclude_begins_with_base: patterns.excludes.iter().map(begins_with_base).collect(),
            patterns,
            base,
            extension_groups: supported_extensions(&self.options),
            extra_extensions: extra_extensions.map(<[u8]>::to_vec).collect(),
            case_sensitive,
        }
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

/// Decides whether a file is a root file of a project using only `files`, `include` and `exclude`, without listing
/// directories. It's for a caller that already has a file, and a project that was read through a host that can't list
/// directories.
pub struct Roots {
    /// `files`, as paths.
    literal: Vec<Vec<u8>>,
    has_include: bool,
    patterns: GlobMatcher,
    /// The path components of the directory the patterns are relative to, and which patterns begin with them. That part
    /// of a path is compared once instead of once per pattern.
    base: Vec<Vec<u8>>,
    include_begins_with_base: Vec<bool>,
    exclude_begins_with_base: Vec<bool>,
    /// `supported_extensions`, `extra_supported_extensions`
    extension_groups: &'static [&'static [&'static [u8]]],
    extra_extensions: Vec<Vec<u8>>,
    case_sensitive: bool,
}

/// A path split into its components. It's split once for all the projects it's tested against.
pub struct SplitFilePath<'a> {
    path: &'a [u8],
    names: Vec<&'a [u8]>,
}

impl<'a> SplitFilePath<'a> {
    pub fn new(path: &'a [u8]) -> SplitFilePath<'a> {
        let names = PathParts::split_directory(typescript_path(path));
        SplitFilePath { path, names }
    }
}

impl Roots {
    /// True if `getFileNamesFromConfigSpecs` would find the file, which must exist and not be a JSON file. `is_file` is
    /// called for sibling files with the same name and another extension, because `a.ts` replaces `a.js`.
    pub fn has(&self, file: &SplitFilePath, is_file: &dyn Fn(&[u8]) -> bool) -> bool {
        let path = file.path;
        let is_literal = |path: &[u8]| {
            (self.literal.iter()).any(|it| is_same_path(it, path, self.case_sensitive))
        };
        if is_literal(path) {
            return true;
        }
        if !self.matches(file) {
            return false;
        }
        // `hasFileWithHigherPriorityExtension`
        for extension in extension_group(path, self.extension_groups) {
            if path.ends_with(extension) && (extension != b".ts" || !path.ends_with(b".d.ts")) {
                break;
            }
            // A declaration file has always been loaded alongside its JavaScript.
            if extension == b".d.ts" && (path.ends_with(b".js") || path.ends_with(b".jsx")) {
                continue;
            }
            let other = change_extension(path, extension);
            if (is_literal(&other) || self.matches(&SplitFilePath::new(&other))) && is_file(&other)
            {
                return false;
            }
        }
        true
    }

    /// True if `include` matches the file and `exclude` doesn't.
    fn matches(&self, file: &SplitFilePath) -> bool {
        let (path, directory) = (file.path, &file.names);
        let has_extension = |it: &[u8]| path.len() > it.len() && path.ends_with(it);
        let is_supported = self
            .extension_groups
            .iter()
            .any(|group| group.iter().any(|it| has_extension(it)))
            || self.extra_extensions.iter().any(|it| has_extension(it));
        let whole = PathParts {
            directory,
            name: b"",
        };
        if !self.has_include || !is_supported {
            return false;
        }
        let equal = |a: &[u8], b: &[u8]| {
            a == b || !self.case_sensitive && equate_string_case_insensitive(a, b)
        };
        let count = self.base.len();
        let is_below_base =
            directory.len() >= count && self.base.iter().zip(directory).all(|it| equal(it.0, it.1));
        let has = |(pattern, begins_with_base): (&GlobPattern, &bool)| match begins_with_base {
            true => is_below_base && pattern.match_parts(whole, count, count, false),
            false => pattern.matches(whole),
        };
        let mut exclude = (self.patterns.excludes.iter()).zip(&self.exclude_begins_with_base);
        let mut include = (self.patterns.includes.iter()).zip(&self.include_begins_with_base);
        // `GlobMatcher::matches_file`
        !exclude.any(has) && include.any(has)
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

/// `findConfigFile`, as `tscCompilation` calls it. Returns the `tsconfig.json` in `dir` or in its nearest ancestor
/// directory that has one.
pub fn find_config_file(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    ancestors(dir)
        .map(|dir| join(dir, b"tsconfig.json"))
        .find(|candidate| host.is_file(candidate))
}

/// `computeConfigFileName`, for a file in `dir`. Returns the `tsconfig.json`, or else the `jsconfig.json`, in `dir` or
/// in its nearest ancestor directory that has either.
pub fn find_config(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    find_config_below(host, dir, &CONFIG_NAMES, |_| false)
}

/// `find_config`, no further up than the directory that has the `package.json`. What's above it configures another
/// project, which the package is published without.
pub fn find_config_of_package(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    find_config_below(host, dir, &CONFIG_NAMES, |dir| {
        host.is_file(&join(dir, b"package.json"))
    })
}

const CONFIG_NAMES: [&[u8]; 2] = [b"tsconfig.json", b"jsconfig.json"];

fn find_config_below(
    host: &dyn Host,
    dir: &[u8],
    names: &[&[u8]],
    is_highest: impl Fn(&[u8]) -> bool,
) -> Option<Vec<u8>> {
    for dir in ancestors(dir) {
        let candidates = names.iter().map(|name| join(dir, name));
        let found = candidates.into_iter().find(|it| host.is_file(it));
        if found.is_some() || dir.ends_with(b"/node_modules") || is_highest(dir) {
            return found;
        }
    }
    None
}

/// One configuration file with its extended configuration files merged in.
#[derive(Default, Clone)]
struct Raw {
    /// `options`. Paths are absolute, or start with `${configDir}`. No value is `null`.
    compiler: Vec<(Vec<u8>, Json)>,
    /// `explicitNullFields`: the options that are `null` in `raw`, which only covers the file itself.
    explicit_null_fields: Vec<Vec<u8>>,
    /// All the options in `raw`, whatever their values.
    raw_fields: Vec<Vec<u8>>,
    files: List,
    include: List,
    exclude: List,
    references: List,
    content_mappers: List,
    /// `rawConfig.GetOrZero("extends") != nil`
    has_extends: bool,
    /// See `Project::unlisted_files`.
    leaves_root_files_unlisted: bool,
}

/// `files`, `include`, `exclude` or `references`.
#[derive(Default, Clone)]
struct List {
    /// `rawConfig.Has`: the property exists, whatever its value.
    is_specified: bool,
    /// `propOfRaw.wrongValue` isn't `"no-prop"`: the value is an array.
    is_array: bool,
    /// `propOfRaw.sliceValue`. `convertArrayLiteralElementsToJson` drops `null` elements, and a list of only `null`s is
    /// nil. Elements of the wrong type stay in it.
    items: Option<Vec<Json>>,
    /// See [`VerbatimSpecs`].
    verbatim: Option<Vec<Json>>,
}

impl List {
    fn of(value: Option<&Json>) -> List {
        let array = value.and_then(Json::as_array);
        let items = array.and_then(|items| {
            let non_null: Vec<Json> = (items.iter())
                .filter(|item| !matches!(item, Json::Null))
                .cloned()
                .collect();
            (items.is_empty() || !non_null.is_empty()).then_some(non_null)
        });
        List {
            is_specified: value.is_some(),
            is_array: array.is_some(),
            verbatim: items.clone(),
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

    fn verbatim_strings(&self) -> Option<Vec<Vec<u8>>> {
        let strings = self.verbatim.as_ref()?.iter().filter_map(Json::as_str);
        Some(strings.map(<[u8]>::to_vec).collect())
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

/// `isNetworkPathValue`
pub fn is_network_path_value(value: &[u8], base: &[u8]) -> bool {
    let value = strings::replace_owned(value, b"\\", b"/");
    is_refused_network_path(&displayed_path(&join(base, &value)), &displayed_path(base))
}

/// `normalizeNonListOptionValue`, for an option that `IsFilePath`.
pub(crate) fn normalize_non_list_option_value(value: &[u8], base: &[u8]) -> Vec<u8> {
    let value = strings::replace_owned(value, b"\\", b"/");
    if starts_with_config_dir_template(&value) {
        value
    } else {
        join(base, &value)
    }
}

/// `compilerOptionContainsConfigDirTemplate`
fn contains_config_dir_template(key: &[u8], value: &Json) -> bool {
    let mut paths = match value {
        Json::Array(paths) => paths.iter(),
        path => std::slice::from_ref(path).iter(),
    };
    is_file_path(key) && paths.any(|it| it.as_str().is_some_and(starts_with_config_dir_template))
}

/// `compilerOptionsParser.ParseOption`. A field with its zero value (`""`, or `None` for a nil list) is simply absent
/// from `all_options`. A path that starts with `${configDir}` is in `unresolvedPaths`, which is applied last, so it wins
/// over a later value of the same file that doesn't.
fn parse_compiler_options(key: &[u8], value: Option<Json>, all_options: &mut Vec<(Vec<u8>, Json)>) {
    let is_unresolved = |value: &Json| contains_config_dir_template(key, value);
    if (all_options.iter()).any(|(name, value)| name == key && is_unresolved(value))
        && !value.as_ref().is_some_and(is_unresolved)
    {
        return;
    }
    all_options.retain(|(name, _)| name != key);
    let value = value.filter(|value| value.as_str() != Some(b""));
    all_options.extend(value.map(|value| (key.to_vec(), value)));
}

/// `mergeCompilerOptions`: the values of `source` take precedence. `""` is its field's zero value, which every reader
/// treats as unspecified, so it isn't copied. `explicit_null_fields`: the options that are `null` in `rawSource`, which
/// unsets them. A command line's options are their own `rawSource`.
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

/// `parseConfig`, preceded by `ParseExtendedConfig`. The files' syntax trees stay in `session`.
fn parse_config(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    errors: &mut Vec<ConfigError>,
) -> Option<Raw> {
    // The files waiting for the files they extend, outermost first, and `resolutionStack`, which has the path of each.
    // This is a loop instead of recursion because an `extends` chain can be arbitrarily long.
    let (mut waiting, mut stack): (Vec<PendingConfig>, FxHashSet<Vec<u8>>) = Default::default();
    let mut extends_cycles = ExtendsCycles::default();
    let mut to_read = Some(path.to_vec());
    // A file that has been read, with everything it extends. `Some(None)`: it can't be used.
    let mut read: Option<Option<Raw>> = None;
    loop {
        if let Some(path) = to_read.take() {
            match open_config(
                host,
                session,
                &path,
                &stack,
                &waiting,
                &mut extends_cycles,
                errors,
            ) {
                Some(open) if open.extended.is_some() => {
                    stack.insert(open.resolved_path.clone());
                    waiting.push(open);
                }
                open => read = Some(open.map(|it| it.own)),
            }
        }
        let Some(innermost) = waiting.last_mut() else {
            return read.flatten();
        };
        if let (Some(Some(extended)), Some((path, reported, cycles_hit))) =
            (read.take(), innermost.being_read.take())
        {
            // A file with errors isn't cached, so its errors are reported for every file that extends it. The result
            // for a file in an `extends` cycle depends on where the cycle was entered, so it's only cached for this
            // call.
            if extends_cycles.hits != cycles_hit {
                extends_cycles.cached.push((path.clone(), extended.clone()));
            } else if errors.len() == reported {
                host.cache_extended_config(&path, &|| std::sync::Arc::new(extended.clone()));
            }
            innermost.inherit(&path, extended, host.is_case_sensitive());
        }
        while let Some(path) = innermost.extended.as_mut().and_then(Iterator::next) {
            if let Some((_, cached_config)) = extends_cycles.cached.iter().find(|it| it.0 == path) {
                extends_cycles.hits += 1;
                innermost.inherit(&path, cached_config.clone(), host.is_case_sensitive());
                continue;
            }
            let cached_config = host.extended_config(&path);
            match cached_config
                .as_ref()
                .and_then(|it| it.downcast_ref::<Raw>())
            {
                Some(cached_config) => {
                    innermost.inherit(&path, cached_config.clone(), host.is_case_sensitive())
                }
                None => {
                    innermost.being_read = Some((path.clone(), errors.len(), extends_cycles.hits));
                    to_read = Some(path);
                    break;
                }
            }
        }
        if to_read.is_none() {
            stack.remove(&innermost.resolved_path);
            read = Some(waiting.pop().map(PendingConfig::merged));
        }
    }
}

/// `mergeParsedCompilerOptions`. An option that `source` specifies, even with an invalid value, removes the path in
/// `target` that starts with `${configDir}`.
fn merge_parsed_compiler_options(target: &mut Vec<(Vec<u8>, Json)>, source: &mut Raw) {
    target.retain(|(key, value)| {
        !(source.raw_fields.contains(key) && contains_config_dir_template(key, value))
    });
    let specified = std::mem::take(&mut source.compiler);
    merge_compiler_options(target, specified, &source.explicit_null_fields);
}

/// A configuration file, and what it has inherited so far.
struct PendingConfig {
    path: Vec<u8>,
    resolved_path: Vec<u8>,
    own: Raw,
    inherited: Raw,
    /// The rest of `extendedConfigPath`. `None`: the file has no `extends`.
    extended: Option<std::vec::IntoIter<Vec<u8>>>,
    /// The extended file that's being read, and the values of `errors.len()` and `ExtendsCycles::hits` before that.
    being_read: Option<(Vec<u8>, usize, usize)>,
}

/// The `extends` cycles that one `parse_config` call has run into.
#[derive(Default)]
struct ExtendsCycles {
    /// The files at which a cycle was closed. TS18000 is reported once for each. TypeScript caches such a file the
    /// first time, and the cached result has no errors.
    closed: FxHashSet<Vec<u8>>,
    /// How many times a cycle was hit or an entry of `cached` was used.
    hits: usize,
    /// The files that hit a cycle, with their results for this `parse_config` call. A result depends on where the cycle
    /// was entered.
    cached: Vec<(Vec<u8>, Raw)>,
}

/// The part of [`parse_config`] that handles the file itself. `stack`: `resolutionStack`.
fn open_config(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    stack: &FxHashSet<Vec<u8>>,
    waiting: &[PendingConfig],
    extends_cycles: &mut ExtendsCycles,
    errors: &mut Vec<ConfigError>,
) -> Option<PendingConfig> {
    let text = host.read(path);
    let Some(file) = text.and_then(|text| TsConfigSourceFile::parse(host, session, text)) else {
        errors.push(ConfigError::unreadable(5083, &[&displayed_path(path)]));
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
            ..ConfigError::unreadable(d.code, &[])
        }
    }));
    // `ParseExtendedConfig`: an extended file that doesn't parse is ignored.
    if !stack.is_empty() && errors.len() > reported {
        return None;
    }
    let is_case_sensitive = host.is_case_sensitive();
    let resolved_path = to_path(path, is_case_sensitive).into_owned();
    if stack.contains(&resolved_path) {
        extends_cycles.hits += 1;
        if extends_cycles.closed.insert(resolved_path) {
            // typescript-go passes no argument, and prints `{0}`. TypeScript 6 prints the files.
            let files = waiting.iter().map(|it| &it.path[..]).chain([path]);
            let files: Vec<_> = files.map(displayed_path).collect();
            errors.push(ConfigError::unreadable(18000, &[&files.join(&b" -> "[..])]));
        }
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
            errors.push(ConfigError {
                at: file.root_expression_span().map(at),
                ..ConfigError::unreadable(5092, &[name])
            });
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
    // `onPropertySet` is called for every property, so this returns the nodes of all the values of `name`.
    let values_of = |name: &[u8]| -> Vec<_> {
        (file.root.into_iter().flat_map(|root| file.properties(root)))
            .filter(|property| property.1 == name)
            .map(|property| file.initializer(property.0))
            .collect()
    };
    let from_problem = |problem: crate::config_options::Problem| ConfigError {
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
    for value_node in values_of(b"compilerOptions") {
        let problems =
            crate::config_options::problems(&file, value_node, In::CompilerOptions, base);
        // `convertJsonOption`: an invalid value is treated as unspecified. So is an invalid element of a list.
        let omitted: Vec<_> = (problems.iter())
            .map(|problem| (problem.property, problem.index))
            .collect();
        errors.extend(problems.into_iter().map(from_problem));
        for (property, key) in file.properties(value_node) {
            let is_omitted = |index| omitted.contains(&(property, index));
            let value = file.convert_property_value_to_json(file.initializer(property));
            // `convertJsonOptionOfListType` of `null`, and of a list of only `null`s.
            let is_nil_list = match &value {
                Json::Null => is_list(key),
                Json::Array(items) => !items.is_empty() && items.iter().all(|it| *it == Json::Null),
                _ => false,
            };
            // `convertJsonOptionOfEnumType` turns `""` into nil.
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
    // For a repeated name, `raw` has the last value.
    let compiler = json.get(b"compilerOptions").and_then(Json::as_object);
    let raw_fields = || compiler.into_iter().flatten();
    own.raw_fields = raw_fields().map(|option| option.0.clone()).collect();
    own.explicit_null_fields = raw_fields()
        .filter(|option| option.1 == Json::Null)
        .map(|option| option.0.clone())
        .collect();
    // `convertJsonOption` for the properties outside `compilerOptions`.
    if let Some(root) = file.root {
        let problems = crate::config_options::problems(&file, root, In::Root, base);
        errors.extend(problems.into_iter().map(from_problem));
    }
    for value_node in values_of(b"typeAcquisition") {
        let problems =
            crate::config_options::problems(&file, value_node, In::TypeAcquisition, base);
        errors.extend(problems.into_iter().map(from_problem));
    }
    own.files = List::of(json.get(b"files"));
    own.include = List::of(json.get(b"include"));
    own.exclude = List::of(json.get(b"exclude"));
    own.references = List::of(json.get(b"references"));
    own.content_mappers = List::of(json.get(b"contentMappers"));
    let extends = json.get(b"extends");
    own.has_extends = extends.is_some_and(|extends| *extends != Json::Null);
    // `getExtendsConfigPathOrArray`. With several `extends`, the last one wins.
    let mut extended_config_path = None;
    for value_node in values_of(b"extends") {
        let names: Vec<(usize, Vec<u8>)> =
            match &mut file.convert_property_value_to_json(value_node) {
                Json::String(one) => vec![(0, std::mem::take(one))],
                // `convertArrayLiteralExpressionToJson` drops `null`s, so the index only counts the other elements.
                // TypeScript still looks up the node with it.
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
            let value = file.elements(value_node).nth(*i).unwrap_or(value_node);
            for error in &mut errors[reported..] {
                error.at = Some(at(file.span(value)));
            }
        }
        extended_config_path = Some(found);
    }
    // Without `extends` nothing is merged, and a `null` in the file itself doesn't unset anything.
    Some(PendingConfig {
        path: path.to_vec(),
        resolved_path,
        own,
        inherited: Raw::default(),
        extended: extended_config_path.map(Vec::into_iter),
        being_read: None,
    })
}

impl PendingConfig {
    /// `extended`: the file at `extended_path`, which is the next of the files this one extends.
    fn inherit(&mut self, extended_path: &[u8], mut extended: Raw, is_case_sensitive: bool) {
        let (own, inherited) = (&self.own, &mut self.inherited);
        merge_parsed_compiler_options(&mut inherited.compiler, &mut extended);
        // A property that the extending file doesn't specify itself takes its value from the last extended file,
        // relative to that file's directory.
        // `relativeDifference`: from the extending file's directory. 18003 prints the result.
        let (base, extended_dir) = (
            dirname::<Posix>(&self.path),
            dirname::<Posix>(extended_path),
        );
        let relative_difference =
            get_relative_path_from_directory(base, extended_dir, is_case_sensitive);
        let rebase = |specs: Vec<Json>| -> Vec<Json> {
            specs
                .into_iter()
                .map(|spec| match &spec {
                    // Not normalized, because `..` after `**` is an error that hasn't been reported yet.
                    Json::String(path)
                        if !(starts_with_config_dir_template(path)
                            || is_rooted_disk_path(path)) =>
                    {
                        Json::String(combine_paths(&relative_difference, path))
                    }
                    _ => spec,
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
                    verbatim: extended.verbatim,
                };
            }
        };
        inherit(&own.include, &mut inherited.include, extended.include);
        inherit(&own.exclude, &mut inherited.exclude, extended.exclude);
        inherit(&own.files, &mut inherited.files, extended.files);
        // The last extended file that has the property wins, even if its value isn't a list.
        if extended.content_mappers.is_specified {
            inherited.content_mappers = extended.content_mappers;
        }
    }

    /// Returns the file merged with everything it has inherited.
    fn merged(self) -> Raw {
        let (mut own, mut inherited) = (self.own, self.inherited);
        if inherited.include.is_specified {
            own.include = inherited.include;
        }
        if inherited.exclude.is_specified {
            own.exclude = inherited.exclude;
        }
        if inherited.files.is_specified {
            own.files = inherited.files;
        }
        if inherited.content_mappers.items.is_some() && !own.content_mappers.is_specified {
            own.content_mappers = inherited.content_mappers;
        }
        merge_parsed_compiler_options(&mut inherited.compiler, &mut own);
        own.compiler = inherited.compiler;
        own
    }
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
    if is_network_path_value(&extended, base) {
        errors.push(ConfigError::new(5116, &[&extended]));
        return None;
    }
    if is_rooted_disk_path(&extended) || extended.starts_with(b"./") || extended.starts_with(b"../")
    {
        let mut path = join(base, &extended);
        if !host.is_file(&path) && !path.ends_with(b".json") {
            path.extend_from_slice(b".json");
            if !host.is_file(&path) {
                errors.push(ConfigError::unreadable(6053, &[&extended]));
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
        errors.push(ConfigError::unreadable(6053, &[&extended]));
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
    base: &[u8],
    problems: &mut Vec<Problem>,
) -> Vec<Vec<u8>> {
    specs
        .into_iter()
        .filter(|spec| {
            // `?` is a wildcard in a spec, so `/??/` isn't a network path here.
            let path = join(base, spec);
            let path = displayed_path(&path);
            let code = if path.starts_with(b"//")
                && is_refused_network_path(&path, &displayed_path(base))
            {
                5116
            // `disallowTrailingRecursion`
            } else if key == b"include" && invalid_trailing_recursion(spec) {
                5010
            } else if invalid_dot_dot_after_recursive_wildcard(spec) {
                5065
            } else {
                return true;
            };
            problems.push(Problem::new(
                code,
                &[spec],
                ConfigLocation::TopElement(key, spec.clone()),
            ));
            false
        })
        .collect()
}

/// `GetParsedCommandLineOfConfigFilePath`. `overrides` returns the options that a command line adds, which are applied
/// after everything in the configuration file and may depend on whether the file has `references`. Returns `Err` if the
/// file can't be read, so there's no project. A file that the parser gives up on counts as empty, with the error. The
/// result owns its memory, and `session` only holds data that isn't needed afterwards.
pub fn load_overriding(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    overrides: &dyn Fn(bool) -> Vec<(Vec<u8>, Json)>,
) -> Result<Project, Vec<ConfigError>> {
    let mut errors = Vec::new();
    let raw = parse_config(host, session, path, &mut errors);
    let Some(mut raw) = raw.or_else(|| host.read(path).map(|_| Raw::default())) else {
        return Err(errors);
    };
    let base = dirname::<Posix>(path);
    let references = get_project_references(&raw.references, base, &mut Vec::new());
    let has_references = references.is_some_and(|list| !list.is_empty());
    merge_compiler_options(&mut raw.compiler, overrides(has_references), &[]);
    Ok(project_from_raw(host, session, path, base, raw, errors))
}

/// Returns the project that's checked when there's no configuration file: only `files`, or everything under `dir` if
/// `files` is empty, with `compiler` as `compilerOptions`.
pub fn without_config(host: &dyn Host, dir: &[u8], compiler: Json, files: Vec<Vec<u8>>) -> Project {
    let raw = Raw {
        compiler: compiler.into_object().unwrap_or_default(),
        files: List {
            is_specified: !files.is_empty(),
            is_array: !files.is_empty(),
            items: (!files.is_empty()).then(|| files.into_iter().map(Json::String).collect()),
            verbatim: None,
        },
        ..Raw::default()
    };
    project_from_raw(host, &Session::new(), b"", dir, raw, Vec::new())
}

/// `getProjectReferences`. `None` is nil.
fn get_project_references(
    references: &List,
    base: &[u8],
    problems: &mut Vec<Problem>,
) -> Option<Vec<ProjectReference>> {
    let references = references.items.as_ref()?.iter().enumerate();
    let references = references.filter_map(|(index, reference)| {
        // `parseProjectReference`
        reference.as_object()?;
        let mut report = |code, args: &[&[u8]], property: &'static [u8]| {
            let at = ConfigLocation::ReferenceProperty(index, property);
            problems.push(Problem::new(code, args, at));
        };
        let Some(path) = reference.get(b"path").and_then(Json::as_str) else {
            report(5024, &[b"reference.path", b"string"], b"path");
            return None;
        };
        if path.is_empty() {
            report(18051, &[b"reference.path"], b"path");
            return None;
        }
        if is_network_path_value(path, base) {
            report(5116, &[path], b"path");
            return None;
        }
        let circular = reference.get(b"circular");
        if circular.is_some_and(|circular| circular.as_bool().is_none()) {
            report(5024, &[b"reference.circular", b"boolean"], b"circular");
        }
        Some(ProjectReference {
            path: join(base, path),
            circular: circular.and_then(Json::as_bool) == Some(true),
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
        let is_unresolved = contains_config_dir_template(key, value);
        match value {
            Json::String(s) if is_unresolved => *s = substitute_config_dir(s, base),
            // In every path of the list, wherever it has the template.
            Json::Array(list) if is_unresolved => {
                for item in list {
                    if let Json::String(s) = item {
                        *s = substitute_config_dir(s, base);
                    }
                }
            }
            Json::Object(patterns) if key == b"paths" => {
                for (_, targets) in patterns {
                    if let Json::Array(targets) = targets {
                        for target in targets {
                            // A `paths` substitution is text that messages quote, so it's stored as a displayed path.
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
    if !options.paths.is_empty() {
        options.paths = host.shared_paths(std::mem::take(&mut options.paths));
    }
    options.use_case_sensitive_file_names = host.is_case_sensitive();
    options.verify(&compiler, config_path);
    let about_options = &options.problems;
    errors.extend(ConfigError::from_problems(
        host,
        session,
        config_path,
        about_options,
    ));
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
            ConfigLocation::Top(b"files"),
        ));
    }
    // Emitted files aren't read back in as input.
    if !raw.exclude.is_array {
        let output_dirs: Vec<Json> = [b"outDir".as_slice(), b"declarationDir"]
            .iter()
            .filter_map(|key| compiler.get(key).and_then(Json::as_str))
            .filter(|dir| !dir.is_empty())
            .map(|dir| Json::String(displayed_path(dir).into_owned()))
            .collect();
        if !output_dirs.is_empty() {
            raw.exclude.items = Some(output_dirs);
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
    let validated_include = validate_specs(raw.include.strings(), b"include", base, &mut problems);
    let include = substitute_all(validated_include.clone());
    options.include_specs = validated_include
        .into_iter()
        .zip(include.iter().cloned())
        .collect();
    let exclude = substitute_all(validate_specs(
        raw.exclude.strings(),
        b"exclude",
        base,
        &mut problems,
    ));
    let mut validated_files = raw.files.strings();
    validated_files.retain(|spec| {
        let is_network_path = is_network_path_value(spec, base);
        if is_network_path {
            let at = ConfigLocation::TopElement(b"files", spec.clone());
            problems.push(Problem::new(5116, &[spec], at));
        }
        !is_network_path
    });
    let references = get_project_references(&raw.references, base, &mut problems);
    let outside_options = ConfigError::from_problems(host, session, config_path, &problems);
    errors.extend(outside_options.into_iter().map(|error| ConfigError {
        is_about_options: false,
        ..error
    }));
    let mut problems = Vec::new();
    options.content_mappers = content_mappers(
        host,
        session,
        &raw.content_mappers,
        &options,
        &match config_path {
            b"" => join(base, b"tsconfig.json"),
            _ => config_path.to_vec(),
        },
        &mut problems,
    );
    let about_mappers = ConfigError::from_problems(host, session, config_path, &problems);
    errors.extend(about_mappers.into_iter().map(|error| ConfigError {
        is_about_options: false,
        ..error
    }));
    if !options.content_mappers.is_empty() {
        options.content_mapper_extension_rewrites =
            content_mapper::extension_rewrites(&options.content_mappers, host.is_case_sensitive());
        options.compiler_options_for_content_mappers =
            Some(marshal_compiler_options(&compiler, config_path));
    }
    let literal = substitute_all(validated_files.clone());
    options.file_specs = validated_files
        .into_iter()
        .zip(literal.iter().map(|name| join(base, name)))
        .collect();
    let unlisted_files = raw.leaves_root_files_unlisted.then(|| RootFileSpecs {
        base: base.to_vec(),
        literal: literal.clone(),
        include: include.clone(),
        exclude: exclude.clone(),
        allow_js: options.allow_js,
        resolve_json_module: options.resolve_json_module,
    });
    let files = match &unlisted_files {
        Some(_) => Vec::new(),
        None => file_names_from_specs(host, base, &options, &literal, &include, &exclude),
    };
    let is_known_to_be_empty = files.is_empty() && unlisted_files.is_none();
    if is_known_to_be_empty && can_report_no_inputs && !config_path.is_empty() {
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
    Project {
        config_path: config_path.to_vec(),
        options,
        files,
        unlisted_files,
        base: base.to_vec(),
        exclude,
        has_references: references.is_some(),
        references: references.unwrap_or_default(),
        errors,
        written: VerbatimSpecs {
            files: raw.files.verbatim_strings(),
            include: raw.include.verbatim_strings(),
            exclude: raw.exclude.verbatim_strings(),
        },
        raw_compiler_options: match compiler.into_object() {
            Some(mut options) => {
                options.retain(|option| option.0 != b"paths");
                options
            }
            None => Vec::new(),
        },
    }
}

/// `parseContentMapper`. Returns `None` if `value` isn't an object or has an error.
fn parse_content_mapper(value: &Json, index: usize, problems: &mut Vec<Problem>) -> Option<Mapper> {
    value.as_object()?;
    let reported = problems.len();
    let mut requires = |property: &[u8], value_type: &[u8]| {
        let at = ConfigLocation::ContentMapper(index, b"");
        problems.push(Problem::new(5024, &[property, value_type], at));
    };
    let mut mapper = Mapper::default();
    match value.get(b"package").and_then(Json::as_str) {
        Some(package) if !package.is_empty() => mapper.package = package.to_vec(),
        _ => requires(b"contentMapper.package", b"string"),
    }
    // `parseStringArrayStrict`
    let extensions = value.get(b"extensions").and_then(Json::as_array);
    let extensions = extensions.and_then(|list| {
        let strings = list.iter().map(|it| it.as_str().map(<[u8]>::to_vec));
        strings.collect::<Option<Vec<_>>>()
    });
    match extensions {
        Some(extensions) => mapper.extensions = extensions,
        None => requires(b"contentMapper.extensions", b"string[]"),
    }
    if let Some(outputs) = (value.get(b"outputExtensions")).filter(|it| **it != Json::Null) {
        match string_map(outputs) {
            Some(outputs) => mapper.output_extensions = outputs,
            None => requires(b"contentMapper.outputExtensions", b"object or null"),
        }
    }
    match value.get(b"options") {
        Some(options @ Json::Object(_)) => mapper.options = Some(options.clone()),
        Some(_) => requires(b"contentMapper.options", b"object"),
        None => {}
    }
    (problems.len() == reported).then_some(mapper)
}

/// `parseStringStringMapStrict`. The result is sorted by source extension.
fn string_map(value: &Json) -> Option<Vec<ExtensionRewrite>> {
    let entries = value.as_object()?.iter().map(|(source, target)| {
        Some(ExtensionRewrite {
            source: source.clone(),
            target: target.as_str()?.to_vec(),
        })
    });
    let mut entries: Vec<ExtensionRewrite> = entries.collect::<Option<_>>()?;
    // If a name is repeated, the last value counts.
    entries.reverse();
    entries.shared_sort_by(|a, b| a.source.cmp(&b.source));
    entries.dedup_by(|next, first| next.source == first.source);
    Some(entries)
}

/// The part of `parseJsonConfigFileContentWorker` about `contentMappers`. Returns the mappers that are in use. Their
/// packages are looked up from `containing_file`, and only their `package.json` is read.
fn content_mappers(
    host: &dyn Host,
    session: &Session,
    list: &List,
    options: &Options,
    containing_file: &[u8],
    problems: &mut Vec<Problem>,
) -> Vec<Mapper> {
    let is_case_sensitive = host.is_case_sensitive();
    // Each mapper with its index in the list.
    let mut mappers: Vec<(usize, Mapper)> = Vec::new();
    for (index, element) in list.items.iter().flatten().enumerate() {
        mappers.extend(parse_content_mapper(element, index, problems).map(|it| (index, it)));
    }
    let canonical = |extension: &[u8]| to_path(extension, is_case_sensitive).into_owned();
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    for (index, mapper) in &mut mappers {
        let index = *index;
        mapper.extensions.retain(|extension| {
            let code = if !extension.starts_with(b".") {
                18065
            } else if content_mapper::contains_path_separator(extension) {
                18123
            } else if content_mapper::has_reserved_source_extension(extension) {
                18066
            } else if !seen.insert(canonical(extension)) {
                18067
            } else {
                return true;
            };
            let at = ConfigLocation::ContentMapperExtension(index, extension.clone());
            problems.push(Problem::new(code, &[extension], at));
            false
        });
        let mut report = |code: u32, extension: &[u8]| {
            let at = ConfigLocation::ContentMapper(index, b"outputExtensions");
            problems.push(Problem::new(code, &[extension], at));
        };
        for ExtensionRewrite { source, target } in &mapper.output_extensions {
            for extension in [source, target] {
                if content_mapper::contains_path_separator(extension) {
                    report(18123, extension);
                } else if !content_mapper::is_valid_extension(extension) {
                    report(18118, extension);
                }
            }
            let mut registered = mapper.extensions.iter();
            if !registered.any(|it| canonical(it) == canonical(source)) {
                report(18119, source);
            }
        }
    }
    if mappers.is_empty() {
        return Vec::new();
    }
    // Without permission to run them, their extensions aren't registered and their files are unknown files.
    if host.content_mapper_processes().is_none() {
        problems.push(Problem::new(18068, &[], ConfigLocation::ContentMappersKey));
        return Vec::new();
    }
    let mut resolved = Vec::new();
    for (index, mut mapper) in mappers {
        // `null` has no mappings, and it turns the package's off.
        let has_own_outputs = (list.items.iter().flatten().nth(index))
            .is_some_and(|element| element.get(b"outputExtensions").is_some());
        if let Err(mut problem) = resolve_content_mapper_manifest(
            host,
            session,
            containing_file,
            &mut mapper,
            has_own_outputs,
        ) {
            problem.at = ConfigLocation::ContentMapper(index, b"package");
            problems.push(*problem);
            continue;
        }
        for source in &mapper.extensions {
            let target = content_mapper::output_extension(&mapper, source, is_case_sensitive);
            let is_identity = |target: &[u8]| {
                target == &source[..] || !is_case_sensitive && target.eq_ignore_ascii_case(source)
            };
            if let Some(target) = target.filter(|target| !is_identity(target))
                && !options.rewrite_relative_import_extensions
            {
                let at = ConfigLocation::ContentMapper(index, b"");
                problems.push(Problem::new(18120, &[source, target], at));
            }
        }
        resolved.push(mapper);
    }
    resolved
}

/// `resolveContentMapperManifest`: fills in what the `package.json` of `mapper.package` says about the mapper.
/// `has_own_outputs`: the configuration file sets `outputExtensions`, so the package's defaults don't apply.
fn resolve_content_mapper_manifest(
    host: &dyn Host,
    session: &Session,
    containing_file: &[u8],
    mapper: &mut Mapper,
    has_own_outputs: bool,
) -> Result<(), Box<Problem>> {
    let package = mapper.package.clone();
    let error = |code: u32| Box::new(Problem::new(code, &[&package], ConfigLocation::Nowhere));
    let directory =
        crate::resolve::resolve_package_directory(host, session, &package, containing_file);
    let directory = directory.ok_or_else(|| error(18075))?;
    let contents = host.read(&join(&directory, b"package.json"));
    let contents = contents.ok_or_else(|| error(18075))?;
    let fields = host.parse_json(session.arena(), &contents);
    let fields = fields.filter(|it| it.as_object().is_some());
    let fields = fields.ok_or_else(|| error(18076))?;
    let text = |name: &[u8]| fields.get(name).and_then(Json::as_str).unwrap_or_default();
    if text(b"name").is_empty() {
        return Err(error(18077));
    }
    let manifest = fields
        .get(b"typescript")
        .and_then(|it| it.get(b"contentMapper"));
    let manifest = manifest.filter(|it| it.as_object().is_some());
    let manifest = manifest.ok_or_else(|| error(18078))?;
    let exec = manifest.get(b"exec").and_then(Json::as_array);
    let exec = exec.and_then(|list| {
        let strings = list.iter().map(|it| it.as_str().map(<[u8]>::to_vec));
        strings.collect::<Option<Vec<_>>>()
    });
    let exec = exec.filter(|it| !it.is_empty());
    let exec = exec.ok_or_else(|| error(18079))?;
    let outputs = match manifest.get(b"outputExtensions") {
        Some(outputs) => string_map(outputs).ok_or_else(|| error(18122))?,
        None => Vec::new(),
    };
    for ExtensionRewrite { source, target } in &outputs {
        let mut both = [source, target].into_iter();
        if let Some(extension) = both.find(|it| content_mapper::contains_path_separator(it)) {
            let problem = Problem::new(18123, &[extension], ConfigLocation::Nowhere);
            return Err(Box::new(problem));
        }
        if !content_mapper::is_valid_extension(source)
            || !content_mapper::is_valid_extension(target)
        {
            let args: [&[u8]; 3] = [&package, source, target];
            return Err(Box::new(Problem::new(
                18121,
                &args,
                ConfigLocation::Nowhere,
            )));
        }
    }
    mapper.name = text(b"name").to_vec();
    mapper.version = text(b"version").to_vec();
    mapper.exec = exec;
    mapper.dynamic_config = manifest.get(b"dynamicConfig").and_then(Json::as_bool) == Some(true);
    mapper.package_directory = directory;
    if !has_own_outputs {
        mapper.output_extensions = outputs;
    }
    Ok(())
}

/// `json.Marshal(CompilerOptions)`: `compiler` with each enum as its number, each library as its file name, and paths as
/// they're displayed.
fn marshal_compiler_options(compiler: &Json, config_path: &[u8]) -> Json {
    let number_of = |name: &[u8], value: &[u8]| -> Option<f64> {
        let values: &[(&[u8], u8)] = match name {
            b"target" => &[
                (b"es5", 1),
                (b"es6", 2),
                (b"es2015", 2),
                (b"es2016", 3),
                (b"es2017", 4),
                (b"es2018", 5),
                (b"es2019", 6),
                (b"es2020", 7),
                (b"es2021", 8),
                (b"es2022", 9),
                (b"es2023", 10),
                (b"es2024", 11),
                (b"es2025", 12),
                (b"es2026", 13),
                (b"esnext", 99),
            ],
            b"module" => &[
                (b"commonjs", 1),
                (b"amd", 2),
                (b"umd", 3),
                (b"system", 4),
                (b"es6", 5),
                (b"es2015", 5),
                (b"es2020", 6),
                (b"es2022", 7),
                (b"esnext", 99),
                (b"node16", 100),
                (b"node18", 101),
                (b"node20", 102),
                (b"nodenext", 199),
                (b"preserve", 200),
            ],
            b"moduleResolution" => &[
                (b"classic", 1),
                (b"node", 2),
                (b"node10", 2),
                (b"node16", 3),
                (b"nodenext", 99),
                (b"bundler", 100),
            ],
            b"jsx" => &[
                (b"preserve", 1),
                (b"react", 2),
                (b"react-native", 3),
                (b"react-jsx", 4),
                (b"react-jsxdev", 5),
            ],
            b"moduleDetection" => &[(b"auto", 1), (b"legacy", 2), (b"force", 3)],
            b"newLine" => &[(b"crlf", 1), (b"lf", 2)],
            _ => return None,
        };
        let found = values.iter().find(|it| it.0 == value)?;
        Some(f64::from(found.1))
    };
    let displayed = |path: &Json| match path.as_str() {
        Some(path) => Json::String(displayed_path(path).into_owned()),
        None => path.clone(),
    };
    let options = compiler.as_object().unwrap_or_default().iter();
    let mut marshaled: Vec<(Vec<u8>, Json)> = options
        .map(|(name, value)| {
            let value = match value {
                Json::String(text) if is_enum(name) => match number_of(name, text) {
                    Some(number) => Json::Number(number),
                    None => value.clone(),
                },
                Json::Array(libs) if name == b"lib" => {
                    let file_name = |lib: &Json| match lib.as_str() {
                        Some(lib) => {
                            let lib = crate::resolve::lib_map_get(lib).unwrap_or(lib);
                            Json::String([b"lib.", lib, b".d.ts"].concat())
                        }
                        None => lib.clone(),
                    };
                    Json::Array(libs.iter().map(file_name).collect())
                }
                Json::String(_) if is_file_path(name) || name == b"pathsBasePath" => {
                    displayed(value)
                }
                Json::Array(paths) if is_file_path(name) => {
                    Json::Array(paths.iter().map(displayed).collect())
                }
                _ => value.clone(),
            };
            (name.clone(), value)
        })
        .collect();
    if !config_path.is_empty() {
        let config_file_path = Json::String(displayed_path(config_path).into_owned());
        marshaled.push((b"configFilePath".to_vec(), config_file_path));
    }
    marshaled.push((b"runExternalCode".to_vec(), Json::Bool(true)));
    Json::Object(marshaled)
}

/// `ChangeExtension`
pub(crate) fn change_extension(path: &[u8], extension: &[u8]) -> Vec<u8> {
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

/// `getMatchedIncludeSpec`: returns the source text of the first of `specs` (source text, substituted text) that the
/// file at `path` matches. Its caller treats `""` as no match.
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
                .is_some_and(|pattern| pattern.matches_path(typescript_path(path)))
        })
        .map(|spec| spec.0.as_slice())
        .filter(|spec| !spec.is_empty())
}

fn file_names_from_specs(
    host: &dyn Host,
    base: &[u8],
    options: &Options,
    literal: &[Vec<u8>],
    include: &[Vec<u8>],
    exclude: &[Vec<u8>],
) -> Vec<Vec<u8>> {
    file_names_from_specs_noting(
        host,
        base,
        options,
        (literal, include, exclude),
        &mut |_| {},
    )
}

/// `getFileNamesFromConfigSpecs`. See `RootFileSpecs::list`.
fn file_names_from_specs_noting(
    host: &dyn Host,
    base: &[u8],
    options: &Options,
    (literal, include, exclude): (&[Vec<u8>], &[Vec<u8>], &[Vec<u8>]),
    on_match: &mut dyn FnMut(&[u8]),
) -> Vec<Vec<u8>> {
    let case_sensitive = host.is_case_sensitive();
    let key = |file: &[u8]| to_path(file, case_sensitive).into_owned();
    let supported = supported_extensions(options);
    let mut literal_files = OrderedFiles::default();
    // The files in insertion order, with `None` for a removed one, and each file's index by key.
    // `ArrayHashMap::ordered_remove` moves every later entry, and a folder of demos that each exist as `.js` and `.tsx`
    // removes every other file.
    let mut wildcard_files: Vec<Option<Vec<u8>>> = Vec::new();
    let mut wildcard_indices = crate::util::FxHashMap::<Vec<u8>, usize>::default();
    let mut wildcard_json_files = OrderedFiles::default();
    for name in literal {
        let file = join(base, name);
        literal_files.insert(key(&file), file);
    }
    if !include.is_empty() {
        let mut extensions: Vec<&[u8]> = supported.iter().flat_map(|g| g.iter().copied()).collect();
        extensions.extend(extra_supported_extensions(host, options));
        if options.resolve_json_module {
            extensions.push(b".json");
        }
        let mut json_only: Option<Vec<GlobPattern>> = None;
        for file in match_files(
            host,
            base,
            &extensions,
            exclude,
            include,
            case_sensitive,
            on_match,
        ) {
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
                if patterns
                    .iter()
                    .any(|p| p.matches_path(typescript_path(&file)))
                {
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
                if literal_files.contains_key(&other) || wildcard_indices.contains_key(&other) {
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
                let lower = key(&change_extension(&file, extension));
                let listed = wildcard_indices.remove(&lower);
                if let Some(listed) = listed.and_then(|at| wildcard_files.get_mut(at)) {
                    *listed = None;
                }
            }
            let key = key(&file);
            if !literal_files.contains_key(&key) && !wildcard_indices.contains_key(&key) {
                wildcard_indices.insert(key, wildcard_files.len());
                wildcard_files.push(Some(file));
            }
        }
    }
    (literal_files.into_entries().1.into_iter())
        .chain(wildcard_files.into_iter().flatten())
        .chain(wildcard_json_files.into_entries().1)
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
    /// `*`: any characters except `/`.
    Star,
    /// `?`: one character except `/`.
    Question,
}

enum Component {
    Literal(Vec<u8>),
    /// Contains `*` or `?`. In an include pattern it doesn't match `node_modules` and the like.
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

/// `nextPathPartParts`: the path components of `directory`, followed by `name`, which is a single component or empty.
#[derive(Copy, Clone)]
struct PathParts<'a> {
    directory: &'a [&'a [u8]],
    name: &'a [u8],
}

impl<'a> PathParts<'a> {
    /// Returns the components of `directory`, which is a `typescript_path`. A leading `/` becomes a first component
    /// `""`. Called once per directory, not once per pattern and name in it.
    fn split_directory(directory: &[u8]) -> Vec<&[u8]> {
        let root = directory.starts_with(b"/").then_some(&b""[..]);
        let names = strings::split(directory, b"/").filter(|p| !p.is_empty());
        root.into_iter().chain(names).collect()
    }

    fn get(self, index: usize) -> Option<&'a [u8]> {
        match self.directory.get(index) {
            Some(&part) => Some(part),
            None => (index == self.directory.len() && !self.name.is_empty()).then_some(self.name),
        }
    }
}

impl GlobPattern {
    /// `compileGlobPattern`. Returns `None` if it matches nothing.
    fn compile(
        spec: &[u8],
        base: &[u8],
        usage: Usage,
        case_sensitive: bool,
    ) -> Option<GlobPattern> {
        let absolute = join(base, spec);
        let mut parts = get_path_components(typescript_path(&absolute));
        if usage != Usage::Exclude && parts.last() == Some(&&b"**"[..]) {
            return None;
        }
        // No path part contains a `/`, so nothing matches below `//server` or `http://host`.
        let root = parts[0];
        parts[0] = root.strip_suffix(b"/").unwrap_or(root);
        if is_implicit_glob(parts.last().copied().unwrap_or(b"")) {
            parts.push(&b"**"[..]);
            parts.push(&b"*"[..]);
        }
        // Consecutive `**` count as one, in tsc too.
        parts.dedup_by(|a, b| *a == b"**" && *b == b"**");
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

    fn matches_path(&self, path: &[u8]) -> bool {
        let directory = &PathParts::split_directory(path);
        self.matches(PathParts {
            directory,
            name: b"",
        })
    }

    fn matches(&self, path: PathParts) -> bool {
        self.match_parts(path, 0, 0, false)
    }

    /// `matchPathParts`. `from`: index of the first part of `path` that isn't matched yet. `at`: index of the first
    /// component to match. `prefix_only`: true if files under the directory could match.
    ///
    /// typescript-go tries each number of parts for a `**` in turn, recursively. That's one stack level per `**`, and
    /// with n of them the time grows like a power of n. This gives the same answers.
    fn match_parts(&self, path: PathParts, from: usize, at: usize, prefix_only: bool) -> bool {
        // The numbers of parts that the components so far can match, in ascending order.
        let mut first: smallvec::SmallVec<[usize; 16]> = smallvec::SmallVec::new();
        let mut second = first.clone();
        let (mut reached, mut next) = (&mut first, &mut second);
        reached.push(from);
        for component in &self.components[at.min(self.components.len())..] {
            for &from in reached.iter() {
                let Some(part) = path.get(from) else {
                    if prefix_only {
                        return true;
                    }
                    // Only a `**` can match nothing.
                    let is_new = next.last().is_none_or(|&last| last < from);
                    if is_new && matches!(component, Component::DoubleAsterisk) {
                        next.push(from);
                    }
                    continue;
                };
                match component {
                    // A `**` that starts inside the previous run ends where that run ends.
                    Component::DoubleAsterisk if next.last().is_some_and(|&last| from <= last) => {}
                    Component::DoubleAsterisk => {
                        let is_traversable = |part: &[u8]| {
                            self.is_exclude || !is_hidden(part) && !is_package_folder(part)
                        };
                        let mut to = from;
                        next.push(to);
                        while path.get(to).is_some_and(is_traversable) {
                            to += 1;
                            next.push(to);
                        }
                    }
                    Component::Literal(literal) => {
                        if self.equal(literal, part) {
                            next.push(from + 1);
                        }
                    }
                    Component::Wildcard(segments) => {
                        if (self.is_exclude || !is_package_folder(part))
                            && self.match_wildcard(segments, part)
                        {
                            next.push(from + 1);
                        }
                    }
                }
            }
            if next.is_empty() {
                return false;
            }
            std::mem::swap(&mut reached, &mut next);
            next.clear();
        }
        let is_whole = |&from: &usize| path.get(from).is_none();
        reached.iter().any(is_whole) || self.is_exclude && !prefix_only
    }

    /// How many parts of `directory` the literal components at the start match, one each: `match_parts` can start behind them, for every name in the directory.
    fn match_start(&self, directory: &[&[u8]]) -> Option<usize> {
        let mut matched = 0;
        for (component, part) in self.components.iter().zip(directory) {
            let Component::Literal(literal) = component else {
                break;
            };
            if !self.equal(literal, part) {
                return None;
            }
            matched += 1;
        }
        Some(matched)
    }

    /// `stringsEqual`
    fn equal(&self, a: &[u8], b: &[u8]) -> bool {
        a == b || !self.case_sensitive && equate_string_case_insensitive(a, b)
    }

    /// `matchWildcard`
    fn match_wildcard(&self, segments: &[Segment], s: &[u8]) -> bool {
        // In an include pattern, a leading wildcard doesn't match a hidden file.
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

    /// `shouldIncludeMinJs`: `*` doesn't match `.min.js` files unless the pattern mentions `.min.`.
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

/// `unicode.ToLower`, which doesn't turn U+0130 into two characters like `char::to_lowercase` does.
fn to_lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// `strings.ToLower`
pub(crate) fn strings_to_lower(text: &[u8]) -> Vec<u8> {
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

    fn in_directory<'a>(&'a self, directory: &'a [&'a [u8]]) -> DirectoryMatcher<'a> {
        let starts_of = |patterns: &'a [GlobPattern]| {
            let starts = patterns
                .iter()
                .map(|pattern| (pattern, pattern.match_start(directory)));
            starts.collect()
        };
        DirectoryMatcher {
            matcher: self,
            directory,
            includes: starts_of(&self.includes),
            excludes: starts_of(&self.excludes),
        }
    }
}

type PatternStart<'a> = (&'a GlobPattern, Option<usize>);

/// A `GlobMatcher` for the names in one directory.
struct DirectoryMatcher<'a> {
    matcher: &'a GlobMatcher,
    directory: &'a [&'a [u8]],
    includes: Vec<PatternStart<'a>>,
    excludes: Vec<PatternStart<'a>>,
}

impl DirectoryMatcher<'_> {
    fn matches(&self, (pattern, start): PatternStart<'_>, name: &[u8], prefix_only: bool) -> bool {
        let path = PathParts {
            directory: self.directory,
            name,
        };
        start.is_some_and(|start| pattern.match_parts(path, start, start, prefix_only))
    }

    /// Returns the index of the include pattern that the file matches.
    fn matches_file(&self, name: &[u8]) -> Option<usize> {
        if self
            .excludes
            .iter()
            .any(|&pattern| self.matches(pattern, name, false))
        {
            return None;
        }
        if self.includes.is_empty() {
            return (!self.matcher.had_includes).then_some(0);
        }
        self.includes
            .iter()
            .position(|&pattern| self.matches(pattern, name, false))
    }

    fn matches_directory(&self, name: &[u8]) -> bool {
        if self
            .excludes
            .iter()
            .any(|&pattern| self.matches(pattern, name, false))
        {
            return false;
        }
        if self.includes.is_empty() {
            return !self.matcher.had_includes;
        }
        self.includes
            .iter()
            .any(|&pattern| self.matches(pattern, name, true))
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
            absolute[..end.max(root_length(absolute))].to_vec()
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
        include_bases.shared_sort();
    } else {
        include_bases.shared_sort_by(|a, b| compare_strings_case_insensitive(a, b));
    }
    for base in include_bases {
        if (out.iter()).all(|known| !contains_path(known, &base, case_sensitive)) {
            out.push(base);
        }
    }
    out
}

/// `matchFiles`: returns the files under `path` with one of `extensions` that `includes` match and `excludes` don't.
/// They're ordered by include pattern and then in traversal order, which is a directory's files before its
/// subdirectories, each sorted.
fn match_files(
    host: &dyn Host,
    path: &[u8],
    extensions: &[&[u8]],
    excludes: &[Vec<u8>],
    includes: &[Vec<u8>],
    case_sensitive: bool,
    on_match: &mut dyn FnMut(&[u8]),
) -> Vec<Vec<u8>> {
    /// A directory's matching entries: the files, each with the include pattern it matches, and the subdirectories.
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
            let directory = &PathParts::split_directory(typescript_path(&prefix));
            let files_here = self.files.in_directory(directory);
            let directories_here = self.directories.in_directory(directory);
            Listed {
                files: files
                    .into_iter()
                    .filter(|file| file_extension_is_one_of(file, self.extensions))
                    .filter_map(|file| {
                        let index = files_here.matches_file(&file)?;
                        Some((index, [&prefix[..], &file[..]].concat()))
                    })
                    .collect(),
                directories: directories
                    .into_iter()
                    .filter(|name| directories_here.matches_directory(name))
                    .map(|name| [&prefix[..], &name[..]].concat())
                    .collect(),
            }
        }
    }
    struct Visitor<'a> {
        matchers: Matchers<'a>,
        case_sensitive: bool,
        visited: FxHashSet<Vec<u8>>,
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
    // The traversal visits the directories sequentially, in the order that determines the file order. Before that, this
    // loop lists each directory and matches its entries, many directories at a time.
    let mut level: Vec<Vec<u8>> = bases.clone();
    let mut requested: FxHashSet<Vec<u8>> = Default::default();
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
            for (_, file) in &listed.files {
                on_match(file);
            }
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
