//! Reads a `tsconfig.json`: `extends`, `files`, `include`, `exclude`, `references` and `${configDir}`, and finds the files it names.
//!
//! A port of `internal/tsoptions/tsconfigparsing.go` and `internal/vfs/vfsmatch/vfsmatch.go`.

use crate::json::Json;
use crate::resolve::{Host, Options, join, normalize, parent_dir};

/// What is wrong with a configuration file: the code of TypeScript's message, and what goes into it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfigError {
    pub code: u32,
    pub args: Vec<String>,
    /// Where it is, if it is anywhere: the file, from, to.
    pub at: Option<(String, u32, u32)>,
    /// What is said below it: how far it is indented, the code, what goes into the message.
    pub chain: Vec<(u32, u32, Vec<String>)>,
    /// `GetProgramDiagnostics`, not `GetConfigFileParsingDiagnostics`: the file could be read, and what it says does not go together.
    pub is_about_options: bool,
}

impl ConfigError {
    fn new(code: u32, args: &[&str]) -> ConfigError {
        ConfigError {
            code,
            args: args.iter().map(|&a| a.to_owned()).collect(),
            at: None,
            chain: Vec::new(),
            is_about_options: false,
        }
    }

    /// `problem`, in the configuration file at `config_path`, which may be none.
    pub fn of_problem(
        host: &dyn Host,
        config_path: &str,
        problem: &crate::verify::Problem,
    ) -> ConfigError {
        let at = (!config_path.is_empty())
            .then(|| host.read(config_path))
            .flatten()
            .and_then(|text| problem.span_in(&text))
            .map(|(from, to)| (config_path.to_owned(), from, to));
        ConfigError {
            code: problem.code,
            args: problem.args.clone(),
            at,
            chain: problem.chain.clone(),
            is_about_options: true,
        }
    }
}

/// `ParsedCommandLine`
pub struct Project {
    /// The configuration file. Empty if there is none.
    pub config_path: String,
    pub options: Options,
    /// The root files, in TypeScript's order: what `files` names, then what `include` finds.
    pub files: Vec<String>,
    /// `references`: the directory or the configuration file of each project this one refers to.
    pub references: Vec<String>,
    pub errors: Vec<ConfigError>,
    /// `compilerOptions` as it comes out of all that was read, which `options` is made of.
    pub compiler_options_as_written: Vec<(String, Json)>,
}

const CONFIG_DIR_TEMPLATE: &str = "${configDir}";

/// `findConfigFile`: the `tsconfig.json` of `dir` or of the nearest directory around it. A `jsconfig.json` counts where there is no
/// `tsconfig.json` next to it.
pub fn find_config(host: &dyn Host, dir: &str) -> Option<String> {
    let mut dir = dir;
    loop {
        for name in ["tsconfig.json", "jsconfig.json"] {
            let candidate = join(dir, name);
            if host.is_file(&candidate) {
                return Some(candidate);
            }
        }
        let parent = parent_dir(dir);
        if parent == dir || parent.is_empty() {
            return None;
        }
        dir = parent;
    }
}

/// One configuration file with what it extends merged in.
#[derive(Default)]
struct Raw {
    /// `compilerOptions`. Paths are absolute, or start with `${configDir}`.
    compiler: Vec<(String, Json)>,
    files: Option<Vec<String>>,
    include: Option<Vec<String>>,
    exclude: Option<Vec<String>>,
    references: Option<Vec<String>>,
    has_extends: bool,
}

fn starts_with_config_dir_template(value: &str) -> bool {
    value
        .get(..CONFIG_DIR_TEMPLATE.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(CONFIG_DIR_TEMPLATE))
}

/// `getSubstitutedPathWithConfigDirTemplate`
fn substitute_config_dir(value: &str, base: &str) -> String {
    join(base, &value.replacen(CONFIG_DIR_TEMPLATE, "./", 1))
}

fn substitute_if_template(value: &str, base: &str) -> Option<String> {
    starts_with_config_dir_template(value).then(|| substitute_config_dir(value, base))
}

/// Options declared with `IsFilePath`, and lists whose elements are.
const PATH_OPTIONS: &[&str] = &[
    "baseUrl",
    "rootDir",
    "outDir",
    "outFile",
    "declarationDir",
    "tsBuildInfoFile",
];
const PATH_LIST_OPTIONS: &[&str] = &["rootDirs", "typeRoots"];

/// `normalizeNonListOptionValue`
fn absolute_unless_template(value: &str, base: &str) -> String {
    let value = value.replace('\\', "/");
    if starts_with_config_dir_template(&value) {
        value
    } else {
        join(base, &value)
    }
}

fn strings(json: &Json) -> Option<Vec<String>> {
    Some(
        json.as_array()?
            .iter()
            .filter_map(|s| s.as_str().map(str::to_owned))
            .collect(),
    )
}

/// `mergeCompilerOptions`: what `source` says counts. `null` takes back what was said before, so it stays until all is merged.
fn merge_compiler_options(target: &mut Vec<(String, Json)>, source: Vec<(String, Json)>) {
    for (key, value) in source {
        target.retain(|(k, _)| *k != key);
        target.push((key, value));
    }
}

/// `parseDelimitedList`: what is written after a member or an element with no comma in between, from where to where its first token goes.
fn after_missing_commas(
    text: &[u8],
    value: &crate::json_places::Value,
    found: &mut Vec<(u32, u32)>,
) {
    use crate::json_places::Written;
    // Between two of them there is nothing but commas, blanks and comments.
    let has_comma = |from: u32, to: u32| {
        let mut at = from as usize;
        while at < to as usize {
            match text[at] {
                b',' => return true,
                b'/' if text.get(at + 1) == Some(&b'/') => {
                    at += bun_core::strings::index_of_char_usize(&text[at..], b'\n')
                        .unwrap_or(text.len() - at);
                }
                b'/' if text.get(at + 1) == Some(&b'*') => {
                    at += bun_core::strings::index_of(&text[at + 2..], b"*/")
                        .map_or(text.len() - at, |end| end + 4);
                }
                _ => at += 1,
            }
        }
        false
    };
    match &value.what {
        Written::Object(members) => {
            for pair in members.windows(2) {
                if !has_comma(pair[0].value.to, pair[1].name_from) {
                    found.push((pair[1].name_from, pair[1].name_to));
                }
            }
            for member in members {
                after_missing_commas(text, &member.value, found);
            }
        }
        Written::Array(elements) => {
            for pair in elements.windows(2) {
                if !has_comma(pair[0].to, pair[1].from) {
                    let to = match pair[1].what {
                        Written::Other => pair[1].to,
                        _ => pair[1].from + 1,
                    };
                    found.push((pair[1].from, to));
                }
            }
            for element in elements {
                after_missing_commas(text, element, found);
            }
        }
        Written::Other => {}
    }
}

/// `parseConfig`
fn parse_config(
    host: &dyn Host,
    path: &str,
    stack: &mut Vec<String>,
    errors: &mut Vec<ConfigError>,
    as_typescript_does: bool,
) -> Option<Raw> {
    if stack.iter().any(|p| p == path) {
        let mut chain = stack.clone();
        chain.push(path.to_owned());
        errors.push(ConfigError::new(18000, &[&chain.join(" -> ")]));
        return None;
    }
    let Some(text) = host.read(path) else {
        errors.push(ConfigError::new(5083, &[path]));
        return None;
    };
    let json = if Json::is_blank(&text) {
        Json::Object(Vec::new())
    } else {
        match Json::parse(&text) {
            Some(json) => json,
            None => {
                errors.push(ConfigError::new(5014, &[path, "invalid JSON"]));
                return None;
            }
        }
    };
    // `convertConfigFileToObject`
    let json = match json {
        Json::Object(_) => json,
        other => {
            let first_object = match other {
                Json::Array(items) => items
                    .into_iter()
                    .find(|item| matches!(item, Json::Object(_))),
                _ => None,
            };
            first_object.unwrap_or_else(|| {
                let name = if path.ends_with("/jsconfig.json") {
                    "jsconfig.json"
                } else {
                    "tsconfig.json"
                };
                errors.push(ConfigError::new(5092, &[name]));
                Json::Object(Vec::new())
            })
        }
    };
    let base = parent_dir(path);
    let mut own = Raw::default();
    // `SourceFile.Diagnostics`
    if let Some(root) = crate::json_places::parse(&text) {
        let mut found = Vec::new();
        after_missing_commas(&text, &root, &mut found);
        errors.extend(found.into_iter().map(|(from, to)| ConfigError {
            at: Some((path.to_owned(), from, to)),
            ..ConfigError::new(1005, &[","])
        }));
    }
    // `getDefaultCompilerOptions`
    if path.ends_with("/jsconfig.json") {
        for (key, value) in [
            ("allowJs", Json::Bool(true)),
            ("maxNodeModuleJsDepth", Json::Number(2.0)),
            ("skipLibCheck", Json::Bool(true)),
            ("noEmit", Json::Bool(true)),
        ] {
            own.compiler.push((key.to_owned(), value));
        }
    }
    if let Some(compiler) = json.get("compilerOptions").and_then(Json::as_object) {
        let problems = crate::config_options::problems(&text, compiler, as_typescript_does);
        // `convertJsonOption`: what is wrong is as good as not said.
        let left_out: Vec<String> = problems
            .iter()
            .map(|problem| problem.name.clone())
            .collect();
        errors.extend(problems.into_iter().map(|problem| ConfigError {
            code: problem.code,
            args: problem.args,
            at: problem.span.map(|(from, to)| (path.to_owned(), from, to)),
            chain: Vec::new(),
            is_about_options: false,
        }));
        let mut said = Vec::with_capacity(compiler.len());
        for (key, value) in compiler {
            if left_out.contains(key) {
                continue;
            }
            let value = match value {
                Json::String(s) if PATH_OPTIONS.contains(&key.as_str()) => {
                    Json::String(absolute_unless_template(s, base))
                }
                Json::Array(list) if PATH_LIST_OPTIONS.contains(&key.as_str()) => Json::Array(
                    list.iter()
                        .map(|item| match item {
                            Json::String(s) => Json::String(absolute_unless_template(s, base)),
                            other => other.clone(),
                        })
                        .collect(),
                ),
                other => other.clone(),
            };
            // `PathsBasePath`: `paths` can be inherited from a configuration file in another directory.
            if key == "paths" {
                said.push(("pathsBasePath".to_owned(), Json::String(base.to_owned())));
            }
            said.push((key.clone(), value));
        }
        merge_compiler_options(&mut own.compiler, said);
    }
    // `convertJsonOption`, of what is said beside `compilerOptions`.
    for name in ["files", "include", "exclude", "references"] {
        if json
            .get(name)
            .is_some_and(|value| !matches!(value, Json::Array(_) | Json::Null))
        {
            errors.push(ConfigError {
                at: crate::json_places::parse(&text).and_then(|root| {
                    let value = &root.member(name, "")?.value;
                    Some((path.to_owned(), value.from, value.to))
                }),
                ..ConfigError::new(5024, &[name, "Array"])
            });
        }
    }
    own.files = json.get("files").and_then(strings);
    own.include = json.get("include").and_then(strings);
    own.exclude = json.get("exclude").and_then(strings);
    own.references = json.get("references").and_then(Json::as_array).map(|list| {
        list.iter()
            .filter_map(|r| r.get("path").and_then(Json::as_str))
            .map(|p| join(base, p))
            .collect()
    });
    let extends: Vec<(usize, String)> = match json.get("extends") {
        Some(Json::String(one)) => vec![(0, one.clone())],
        Some(Json::Array(many)) => many
            .iter()
            .enumerate()
            .filter_map(|(i, e)| Some((i, e.as_str()?.to_owned())))
            .collect(),
        _ => Vec::new(),
    };
    own.has_extends = json.get("extends").is_some();
    if extends.is_empty() {
        return Some(own);
    }
    stack.push(path.to_owned());
    let mut inherited = Raw::default();
    for (i, name) in &extends {
        let reported = errors.len();
        let Some(extended_path) = extends_config_path(host, name, base, errors) else {
            // `CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic`, at `valueExpression`.
            let at = crate::json_places::parse(&text).and_then(|root| {
                let value = &root.member("extends", "")?.value;
                let value = value.element(*i).unwrap_or(value);
                Some((path.to_owned(), value.from, value.to))
            });
            for error in &mut errors[reported..] {
                error.at = at.clone();
            }
            continue;
        };
        let Some(extended) = parse_config(host, &extended_path, stack, errors, as_typescript_does)
        else {
            continue;
        };
        // What the file that extends does not say itself is as the last of the extended files says it, from where that is.
        let extended_dir = parent_dir(&extended_path);
        let rebase = |specs: Vec<String>| -> Vec<String> {
            specs
                .into_iter()
                .map(|spec| {
                    if starts_with_config_dir_template(&spec) || spec.starts_with('/') {
                        spec
                    } else {
                        // Not normalized: `..` after `**` is an error that is still to be reported.
                        format!("{extended_dir}/{spec}")
                    }
                })
                .collect()
        };
        if own.include.is_none() && extended.include.is_some() {
            inherited.include = extended.include.map(rebase);
        }
        if own.exclude.is_none() && extended.exclude.is_some() {
            inherited.exclude = extended.exclude.map(rebase);
        }
        if own.files.is_none() && extended.files.is_some() {
            inherited.files = extended.files.map(rebase);
        }
        merge_compiler_options(&mut inherited.compiler, extended.compiler);
    }
    stack.pop();
    if inherited.include.is_some() {
        own.include = inherited.include;
    }
    if inherited.exclude.is_some() {
        own.exclude = inherited.exclude;
    }
    if inherited.files.is_some() {
        own.files = inherited.files;
    }
    let said = std::mem::take(&mut own.compiler);
    merge_compiler_options(&mut inherited.compiler, said);
    own.compiler = inherited.compiler;
    Some(own)
}

/// `getExtendsConfigPath`
fn extends_config_path(
    host: &dyn Host,
    extended: &str,
    base: &str,
    errors: &mut Vec<ConfigError>,
) -> Option<String> {
    let extended = extended.replace('\\', "/");
    if extended.starts_with('/') || extended.starts_with("./") || extended.starts_with("../") {
        let mut path = join(base, &extended);
        if !host.is_file(&path) && !path.ends_with(".json") {
            path.push_str(".json");
            if !host.is_file(&path) {
                errors.push(ConfigError::new(6053, &[&extended]));
                return None;
            }
        }
        return Some(path);
    }
    if extended.is_empty() {
        errors.push(ConfigError::new(18051, &["extends"]));
        return None;
    }
    // `resolveNodeLikeWorker`: `.` and `..` are relative names. `normalizePathForCJSResolution` ends them in a `/`, so only the
    // directory is looked into.
    let found = if extended == "." || extended == ".." {
        load_config_from_directory(host, &join(base, &extended))
    } else {
        // `createResolvedModuleHandlingSymlink`: what is in a package is where the links to it lead.
        resolve_config_in_packages(host, &extended, base).map(|found| {
            if found.contains("/node_modules/") {
                host.realpath(&found)
            } else {
                found
            }
        })
    };
    if found.is_none() {
        errors.push(ConfigError::new(6053, &[&extended]));
    }
    found
}

/// `ResolveConfig`: `name` is looked for like a module that `require` names, where only JSON files count, `tsconfig` stands for
/// `index`, and the `tsconfig` field of a `package.json` for `main`.
fn resolve_config_in_packages(host: &dyn Host, name: &str, from_dir: &str) -> Option<String> {
    if let Some(found) = resolve_config_in_package_scope(host, name, from_dir) {
        return Some(found);
    }
    let (package, rest) = split_package_name(name);
    let mut dir = from_dir;
    loop {
        let package_dir = join(dir, &format!("node_modules/{package}"));
        if host.is_dir(&package_dir) {
            let manifest = host
                .read(&join(&package_dir, "package.json"))
                .and_then(|text| Json::parse(&text));
            if let Some(exports) = manifest.as_ref().and_then(|m| m.get("exports")) {
                let subpath = if rest.is_empty() {
                    ".".to_owned()
                } else {
                    format!("./{rest}")
                };
                // A package with `exports` has nothing else to offer.
                return resolve_exports(exports, &subpath)
                    .map(|target| join(&package_dir, &target))
                    .filter(|path| path.ends_with(".json") && host.is_file(path));
            }
            let candidate = if rest.is_empty() {
                package_dir.clone()
            } else {
                join(&package_dir, rest)
            };
            if let Some(found) = config_file_or_directory(host, &candidate) {
                return Some(found);
            }
        }
        let parent = parent_dir(dir);
        if parent == dir || parent.is_empty() {
            return None;
        }
        dir = parent;
    }
}

/// `loadModuleFromImports` and `loadModuleFromSelfNameReference` of a config lookup: `name` through the `imports`, or under the name
/// of the package through the `exports`, of the nearest `package.json` at or above `from_dir` (`getPackageScopeForPath`).
fn resolve_config_in_package_scope(host: &dyn Host, name: &str, from_dir: &str) -> Option<String> {
    let mut scope = from_dir;
    let manifest = loop {
        if let Some(text) = host.read(&join(scope, "package.json")) {
            break Json::parse(&text)?;
        }
        let parent = parent_dir(scope);
        if parent == scope || parent.is_empty() {
            return None;
        }
        scope = parent;
    };
    let target = if name.starts_with('#') {
        let imports = manifest
            .get("imports")
            .filter(|imports| imports.as_object().is_some())?;
        let target = resolve_exports(imports, name)?;
        // `loadModuleFromTargetExportOrImport`: a target that is no path is a module name, looked for from the package.
        if !target.starts_with(['.', '/', '#']) {
            return resolve_config_in_packages(host, &target, scope);
        }
        target
    } else {
        let rest = name.strip_prefix(manifest.get("name")?.as_str()?)?;
        let subpath = match rest.strip_prefix('/') {
            Some(_) => format!(".{rest}"),
            None if rest.is_empty() => ".".to_owned(),
            None => return None,
        };
        resolve_exports(manifest.get("exports")?, &subpath)?
    };
    Some(join(scope, target.strip_prefix("./")?))
        .filter(|path| path.ends_with(".json") && host.is_file(path))
}

fn config_file_or_directory(host: &dyn Host, candidate: &str) -> Option<String> {
    if candidate.ends_with(".json") && host.is_file(candidate) {
        return Some(candidate.to_owned());
    }
    let with_extension = format!("{candidate}.json");
    if host.is_file(&with_extension) {
        return Some(with_extension);
    }
    load_config_from_directory(host, candidate)
}

/// `loadNodeModuleFromDirectory` of a config lookup: the `tsconfig` field of the `package.json` in `candidate`, or else its
/// `tsconfig.json`.
fn load_config_from_directory(host: &dyn Host, candidate: &str) -> Option<String> {
    if !host.is_dir(candidate) {
        return None;
    }
    if let Some(field) = host
        .read(&join(candidate, "package.json"))
        .and_then(|text| Json::parse(&text))
        .and_then(|m| m.get("tsconfig").and_then(Json::as_str).map(str::to_owned))
    {
        let path = join(candidate, &field);
        if host.is_file(&path) {
            return Some(path);
        }
        let with_extension = format!("{path}.json");
        if host.is_file(&with_extension) {
            return Some(with_extension);
        }
    }
    let index = join(candidate, "tsconfig.json");
    host.is_file(&index).then_some(index)
}

/// `@scope/name/rest` is `@scope/name` and `rest`.
fn split_package_name(name: &str) -> (&str, &str) {
    let slashes = if name.starts_with('@') { 2 } else { 1 };
    match name.match_indices('/').nth(slashes - 1) {
        Some((i, _)) => (&name[..i], &name[i + 1..]),
        None => (name, ""),
    }
}

/// What `exports` gives for `subpath` (`.` or `./x`), or `imports` for a `#name`, to `require`.
fn resolve_exports(exports: &Json, subpath: &str) -> Option<String> {
    fn target(json: &Json, star: &str) -> Option<String> {
        match json {
            Json::String(s) => Some(s.replace('*', star)),
            Json::Array(list) => list.iter().find_map(|t| target(t, star)),
            Json::Object(conditions) => conditions
                .iter()
                .filter(|(c, _)| matches!(c.as_str(), "require" | "node" | "types" | "default"))
                .find_map(|(_, t)| target(t, star)),
            _ => None,
        }
    }
    let is_subpath_map = exports
        .as_object()
        .is_some_and(|o| o.iter().any(|(k, _)| k.starts_with(['.', '#'])));
    if !is_subpath_map {
        return if subpath == "." {
            target(exports, "")
        } else {
            None
        };
    }
    let map = exports.as_object()?;
    if let Some((_, exact)) = map.iter().find(|(k, _)| k == subpath && !k.contains('*')) {
        return target(exact, "");
    }
    // The pattern with the longest part before the `*`.
    let mut best: Option<(&str, &Json, &str)> = None;
    for (key, value) in map {
        let Some((before, after)) = key.split_once('*') else {
            continue;
        };
        if subpath.len() >= before.len() + after.len()
            && subpath.starts_with(before)
            && subpath.ends_with(after)
            && best.is_none_or(|(b, ..)| before.len() > b.len())
        {
            best = Some((
                before,
                value,
                &subpath[before.len()..subpath.len() - after.len()],
            ));
        }
    }
    best.and_then(|(_, value, star)| target(value, star))
}

/// `invalidTrailingRecursion`: `**`, `/**`, `**/` and `/**/` at the end, but not `a**b`.
fn invalid_trailing_recursion(spec: &str) -> bool {
    let s = spec.strip_suffix('/').unwrap_or(spec);
    s == "**" || s.ends_with("/**")
}

/// `invalidDotDotAfterRecursiveWildcard`
fn invalid_dot_dot_after_recursive_wildcard(s: &str) -> bool {
    let wildcard = if s.starts_with("**/") {
        Some(0)
    } else {
        s.find("/**/")
    };
    let Some(wildcard) = wildcard else {
        return false;
    };
    let last_dot = if s.ends_with("/..") {
        Some(s.len())
    } else {
        s.rfind("/../")
    };
    last_dot.is_some_and(|dot| dot > wildcard)
}

/// `validateSpecs`
fn validate_specs(
    specs: Vec<String>,
    disallow_trailing_recursion: bool,
    errors: &mut Vec<ConfigError>,
) -> Vec<String> {
    specs
        .into_iter()
        .filter(|spec| {
            if disallow_trailing_recursion && invalid_trailing_recursion(spec) {
                errors.push(ConfigError::new(5010, &[spec]));
                false
            } else if invalid_dot_dot_after_recursive_wildcard(spec) {
                errors.push(ConfigError::new(5065, &[spec]));
                false
            } else {
                true
            }
        })
        .collect()
}

/// Reads the configuration file at `path`, which is absolute.
pub fn load(host: &dyn Host, path: &str) -> Project {
    let mut errors = Vec::new();
    let raw = parse_config(host, path, &mut Vec::new(), &mut errors, false).unwrap_or_default();
    project_from_raw(host, path, parent_dir(path), raw, errors)
}

/// The same, with `over` said after all the configuration file says: what a command line adds to it.
pub fn load_overriding(host: &dyn Host, path: &str, over: Vec<(String, Json)>) -> Project {
    let mut errors = Vec::new();
    let mut raw = parse_config(host, path, &mut Vec::new(), &mut errors, false).unwrap_or_default();
    merge_compiler_options(&mut raw.compiler, over);
    project_from_raw(host, path, parent_dir(path), raw, errors)
}

/// The same, going by TypeScript 7 alone: what only older versions took is as wrong as what never meant anything, and what is wrong is as
/// good as not said.
pub fn load_as_typescript_does(host: &dyn Host, path: &str, over: Vec<(String, Json)>) -> Project {
    let mut errors = Vec::new();
    let mut raw = parse_config(host, path, &mut Vec::new(), &mut errors, true).unwrap_or_default();
    merge_compiler_options(&mut raw.compiler, over);
    project_from_raw(host, path, parent_dir(path), raw, errors)
}

/// The project of `files` alone, or of everything under `dir` if there are none, with `compiler` for `compilerOptions`: what is
/// checked where there is no configuration file.
pub fn without_config(host: &dyn Host, dir: &str, compiler: Json, files: Vec<String>) -> Project {
    let raw = Raw {
        compiler: match compiler {
            Json::Object(options) => options,
            _ => Vec::new(),
        },
        files: (!files.is_empty()).then_some(files),
        ..Raw::default()
    };
    project_from_raw(host, "", dir, raw, Vec::new())
}

/// `parseJsonConfigFileContentWorker`
fn project_from_raw(
    host: &dyn Host,
    config_path: &str,
    base: &str,
    mut raw: Raw,
    mut errors: Vec<ConfigError>,
) -> Project {
    raw.compiler
        .retain(|(_, value)| !matches!(value, Json::Null));
    // `handleOptionConfigDirTemplateSubstitution`
    for (key, value) in &mut raw.compiler {
        match value {
            Json::String(s) if PATH_OPTIONS.contains(&key.as_str()) => {
                if let Some(substituted) = substitute_if_template(s, base) {
                    *s = substituted;
                }
            }
            Json::Array(list) if PATH_LIST_OPTIONS.contains(&key.as_str()) => {
                for item in list {
                    if let Json::String(s) = item
                        && let Some(substituted) = substitute_if_template(s, base)
                    {
                        *s = substituted;
                    }
                }
            }
            Json::Object(patterns) if key == "paths" => {
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
            .map(|problem| ConfigError::of_problem(host, config_path, problem)),
    );
    let has_no_references = raw.references.as_ref().is_none_or(Vec::is_empty);
    if raw.files.as_ref().is_some_and(Vec::is_empty) && has_no_references && !raw.has_extends {
        errors.push(ConfigError::new(18002, &[config_path]));
    }
    // What is written out is not read back in.
    if raw.exclude.is_none() {
        let written: Vec<String> = ["outDir", "declarationDir"]
            .iter()
            .filter_map(|key| compiler.get(key).and_then(Json::as_str))
            .filter(|dir| !dir.is_empty())
            .map(str::to_owned)
            .collect();
        if !written.is_empty() {
            raw.exclude = Some(written);
        }
    }
    let can_report_no_inputs = raw.files.is_none() && raw.references.is_none();
    options.is_default_include_spec = raw.files.is_none() && raw.include.is_none();
    if options.is_default_include_spec {
        raw.include = Some(vec!["**/*".to_owned()]);
    }
    let substitute_all = |specs: Vec<String>| -> Vec<String> {
        specs
            .into_iter()
            .map(|spec| substitute_if_template(&spec, base).unwrap_or(spec))
            .collect()
    };
    let include_as_written = raw.include.clone().unwrap_or_default();
    let exclude_as_written = raw.exclude.clone().unwrap_or_default();
    let validated_include =
        validate_specs(raw.include.take().unwrap_or_default(), true, &mut errors);
    let include = substitute_all(validated_include.clone());
    options.include_specs = validated_include
        .into_iter()
        .zip(include.iter().cloned())
        .collect();
    let exclude = substitute_all(validate_specs(
        raw.exclude.take().unwrap_or_default(),
        false,
        &mut errors,
    ));
    let literal = substitute_all(raw.files.take().unwrap_or_default());
    options.file_specs = literal.iter().map(|name| join(base, name)).collect();
    let files = file_names_from_specs(host, base, &options, &literal, &include, &exclude);
    if files.is_empty() && can_report_no_inputs && !config_path.is_empty() {
        let list = |specs: &[String]| {
            let quoted: Vec<String> = specs.iter().map(|s| format!("\"{s}\"")).collect();
            format!("[{}]", quoted.join(","))
        };
        errors.push(ConfigError::new(
            18003,
            &[
                config_path,
                &list(&include_as_written),
                &list(&exclude_as_written),
            ],
        ));
    }
    options.files = files.clone();
    Project {
        config_path: config_path.to_owned(),
        options,
        files,
        references: raw.references.unwrap_or_default(),
        errors,
        compiler_options_as_written: match compiler {
            Json::Object(options) => options,
            _ => Vec::new(),
        },
    }
}

/// `SupportedTSExtensions`, `AllSupportedExtensions`: in each group what comes first wins.
const TS_EXTENSIONS: &[&[&str]] = &[
    &[".ts", ".tsx", ".d.ts"],
    &[".cts", ".d.cts"],
    &[".mts", ".d.mts"],
];
const ALL_EXTENSIONS: &[&[&str]] = &[
    &[".ts", ".tsx", ".d.ts", ".js", ".jsx"],
    &[".cts", ".d.cts", ".cjs"],
    &[".mts", ".d.mts", ".mjs"],
];

/// `ChangeExtension`: `.d.ts` and its like count as one extension.
fn change_extension(path: &str, extension: &str) -> String {
    for known in [
        ".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
        ".json",
    ] {
        if let Some(stem) = path.strip_suffix(known) {
            return format!("{stem}{extension}");
        }
    }
    match path.rfind('.') {
        Some(dot) if dot > path.rfind('/').map_or(0, |s| s + 1) => {
            format!("{}{extension}", &path[..dot])
        }
        _ => format!("{path}{extension}"),
    }
}

fn extension_group(file: &str, extensions: &[&[&'static str]]) -> Vec<&'static str> {
    extensions
        .iter()
        .filter(|group| group.iter().any(|e| file.ends_with(e)))
        .flat_map(|group| group.iter().copied())
        .collect()
}

/// A map that remembers the order things were put in, as `collections.OrderedMap` does.
#[derive(Default)]
struct OrderedFiles {
    index: crate::util::FxHashMap<String, usize>,
    files: Vec<Option<String>>,
}

impl OrderedFiles {
    fn has(&self, key: &str) -> bool {
        self.index.contains_key(key)
    }
    fn set(&mut self, key: String, file: String) {
        match self.index.get(&key) {
            Some(&i) => self.files[i] = Some(file),
            None => {
                self.index.insert(key, self.files.len());
                self.files.push(Some(file));
            }
        }
    }
    fn delete(&mut self, key: &str) {
        if let Some(i) = self.index.remove(key) {
            self.files[i] = None;
        }
    }
    fn values(self) -> impl Iterator<Item = String> {
        self.files.into_iter().flatten()
    }
}

/// `getMatchedIncludeSpec`: the first of `specs` (as written, as substituted) that the file at `path` matches, as it is written.
pub fn matched_include_spec<'s>(
    specs: &'s [(String, String)],
    base: &str,
    path: &str,
    case_sensitive: bool,
) -> Option<&'s str> {
    specs
        .iter()
        .find(|spec| {
            GlobPattern::compile(&spec.1, base, Usage::Files, case_sensitive)
                .is_some_and(|pattern| pattern.matches(path, ""))
        })
        .map(|spec| spec.0.as_str())
}

/// `getFileNamesFromConfigSpecs`
fn file_names_from_specs(
    host: &dyn Host,
    base: &str,
    options: &Options,
    literal: &[String],
    include: &[String],
    exclude: &[String],
) -> Vec<String> {
    let case_sensitive = host.is_case_sensitive();
    let key = |file: &str| {
        if case_sensitive {
            file.to_owned()
        } else {
            file.to_lowercase()
        }
    };
    let supported = if options.allow_js {
        ALL_EXTENSIONS
    } else {
        TS_EXTENSIONS
    };
    let mut literal_files = OrderedFiles::default();
    let mut wildcard_files = OrderedFiles::default();
    let mut wildcard_json_files = OrderedFiles::default();
    for name in literal {
        let file = join(base, name);
        literal_files.set(key(&file), file);
    }
    if !include.is_empty() {
        let mut extensions: Vec<&str> = supported.iter().flat_map(|g| g.iter().copied()).collect();
        if options.resolve_json_module {
            extensions.push(".json");
        }
        let mut json_only: Option<Vec<GlobPattern>> = None;
        for file in match_files(host, base, &extensions, exclude, include, case_sensitive) {
            if file.ends_with(".json") {
                let patterns = json_only.get_or_insert_with(|| {
                    include
                        .iter()
                        .filter(|spec| spec.ends_with(".json"))
                        .filter_map(|spec| {
                            GlobPattern::compile(spec, base, Usage::Files, case_sensitive)
                        })
                        .collect()
                });
                if patterns.iter().any(|p| p.matches(&file, "")) {
                    let key = key(&file);
                    if !literal_files.has(&key) && !wildcard_json_files.has(&key) {
                        wildcard_json_files.set(key, file);
                    }
                }
                continue;
            }
            let group = extension_group(&file, supported);
            // `hasFileWithHigherPriorityExtension`
            let mut has_higher = false;
            for &extension in &group {
                if file.ends_with(extension) && (extension != ".ts" || !file.ends_with(".d.ts")) {
                    break;
                }
                let other = key(&change_extension(&file, extension));
                if literal_files.has(&other) || wildcard_files.has(&other) {
                    // A declaration file has always been loaded alongside its JavaScript.
                    if extension == ".d.ts" && (file.ends_with(".js") || file.ends_with(".jsx")) {
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
                wildcard_files.delete(&key(&change_extension(&file, extension)));
            }
            let key = key(&file);
            if !literal_files.has(&key) && !wildcard_files.has(&key) {
                wildcard_files.set(key, file);
            }
        }
    }
    literal_files
        .values()
        .chain(wildcard_files.values())
        .chain(wildcard_json_files.values())
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
    Literal(String),
    /// `*`: any characters but `/`.
    Star,
    /// `?`: one character but `/`.
    Question,
}

enum Component {
    Literal(String),
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

/// `IsImplicitGlob`: `foo` stands for `foo/**/*` if it has no extension and no wildcard.
fn is_implicit_glob(last: &str) -> bool {
    !last.contains(['.', '*', '?'])
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_package_folder(name: &str) -> bool {
    name.eq_ignore_ascii_case("node_modules")
        || name.eq_ignore_ascii_case("jspm_packages")
        || name.eq_ignore_ascii_case("bower_components")
}

/// The parts of `prefix` followed by `suffix`, which is one name or nothing. The root comes first, as `""`.
fn path_parts<'a>(prefix: &'a str, suffix: &'a str) -> impl Iterator<Item = &'a str> + Clone {
    let root = prefix.starts_with('/').then_some("");
    root.into_iter()
        .chain(prefix.split('/').filter(|p| !p.is_empty()))
        .chain((!suffix.is_empty()).then_some(suffix))
}

impl GlobPattern {
    /// `compileGlobPattern`. `None`: it matches nothing.
    fn compile(spec: &str, base: &str, usage: Usage, case_sensitive: bool) -> Option<GlobPattern> {
        let absolute = join(base, spec);
        let mut parts: Vec<&str> = std::iter::once("")
            .chain(absolute.split('/').filter(|p| !p.is_empty()))
            .collect();
        if usage != Usage::Exclude && parts.last() == Some(&"**") {
            return None;
        }
        if is_implicit_glob(parts.last().copied().unwrap_or("")) {
            parts.push("**");
            parts.push("*");
        }
        Some(GlobPattern {
            components: parts
                .into_iter()
                .map(|part| {
                    if part == "**" {
                        Component::DoubleAsterisk
                    } else if !part.contains(['*', '?']) {
                        Component::Literal(part.to_owned())
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

    fn matches(&self, prefix: &str, suffix: &str) -> bool {
        self.match_parts(path_parts(prefix, suffix), 0, false)
    }

    /// Whether files under the directory could match.
    fn matches_prefix(&self, prefix: &str, suffix: &str) -> bool {
        self.match_parts(path_parts(prefix, suffix), 0, true)
    }

    /// `matchPathParts`
    fn match_parts<'a>(
        &self,
        mut parts: impl Iterator<Item = &'a str> + Clone,
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

    fn equal(&self, a: &str, b: &str) -> bool {
        if self.case_sensitive {
            a == b
        } else {
            a.len() == b.len() && a.to_lowercase() == b.to_lowercase()
                || a.to_lowercase() == b.to_lowercase()
        }
    }

    /// `matchWildcard`
    fn match_wildcard(&self, segments: &[Segment], s: &str) -> bool {
        // In an include pattern a wildcard at the start does not match a hidden file.
        if !self.is_exclude
            && is_hidden(s)
            && matches!(segments.first(), Some(Segment::Star | Segment::Question))
        {
            return false;
        }
        self.match_segments(segments, s) && self.should_include_min_js(s, segments)
    }

    /// `matchSegments`: only the last `*` is gone back to.
    fn match_segments(&self, segments: &[Segment], s: &str) -> bool {
        let next_char = |at: usize| at + s[at..].chars().next().map_or(1, char::len_utf8);
        let (mut segment, mut at) = (0, 0);
        let mut star: Option<(usize, usize)> = None;
        while at < s.len() {
            match segments.get(segment) {
                Some(Segment::Literal(literal)) => {
                    let end = at + literal.len();
                    if s.is_char_boundary(end.min(s.len()))
                        && s.get(at..end).is_some_and(|part| self.equal(literal, part))
                    {
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
    fn should_include_min_js(&self, name: &str, segments: &[Segment]) -> bool {
        if !self.exclude_min_js {
            return true;
        }
        let is_min_js = if self.case_sensitive {
            name.ends_with(".min.js")
        } else {
            name.to_lowercase().ends_with(".min.js")
        };
        !is_min_js
            || segments.iter().any(|segment| match segment {
                Segment::Literal(literal) if self.case_sensitive => literal.contains(".min."),
                Segment::Literal(literal) => literal.to_lowercase().contains(".min."),
                _ => false,
            })
    }
}

/// `parseSegments`: `*.ts` is a star and `.ts`.
fn parse_segments(s: &str) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, c) in s.char_indices() {
        if c == '*' || c == '?' {
            if i > start {
                out.push(Segment::Literal(s[start..i].to_owned()));
            }
            out.push(if c == '*' {
                Segment::Star
            } else {
                Segment::Question
            });
            start = i + 1;
        }
    }
    if start < s.len() {
        out.push(Segment::Literal(s[start..].to_owned()));
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
        includes: &[String],
        excludes: &[String],
        base: &str,
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

    /// Which include pattern the file matches.
    fn matches_file(&self, prefix: &str, name: &str) -> Option<usize> {
        if self.excludes.iter().any(|p| p.matches(prefix, name)) {
            return None;
        }
        if self.includes.is_empty() {
            return (!self.had_includes).then_some(0);
        }
        self.includes.iter().position(|p| p.matches(prefix, name))
    }

    fn matches_directory(&self, prefix: &str, name: &str) -> bool {
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
fn include_base_path(absolute: &str) -> String {
    match absolute.find(['*', '?']) {
        None => {
            let name = absolute.rsplit('/').next().unwrap_or("");
            if name.contains('.') {
                parent_dir(absolute).to_owned()
            } else {
                absolute.to_owned()
            }
        }
        Some(wildcard) => {
            let end = absolute[..wildcard].rfind('/').unwrap_or(0);
            if end == 0 {
                "/".to_owned()
            } else {
                absolute[..end].to_owned()
            }
        }
    }
}

fn contains_path(parent: &str, child: &str, case_sensitive: bool) -> bool {
    let (parent, child) = if case_sensitive {
        (parent.to_owned(), child.to_owned())
    } else {
        (parent.to_lowercase(), child.to_lowercase())
    };
    parent == "/"
        || child == parent
        || child.starts_with(&parent) && child.as_bytes().get(parent.len()) == Some(&b'/')
}

/// `getBasePaths`: where to start looking, none inside another.
fn base_paths(path: &str, includes: &[String], case_sensitive: bool) -> Vec<String> {
    let mut out = vec![path.to_owned()];
    let mut include_bases: Vec<String> = includes
        .iter()
        .map(|include| include_base_path(&join(path, include)))
        .collect();
    if case_sensitive {
        include_bases.sort();
    } else {
        include_bases.sort_by_key(|p| p.to_lowercase());
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

/// `matchFiles`: the files under `path` with one of `extensions` that `includes` match and `excludes` do not, by include pattern and
/// then in the order they are met: the files of a directory before its directories, each sorted.
fn match_files(
    host: &dyn Host,
    path: &str,
    extensions: &[&str],
    excludes: &[String],
    includes: &[String],
    case_sensitive: bool,
) -> Vec<String> {
    /// What of a directory matches: the files, each with the include pattern it goes by, and the directories.
    struct Listed {
        files: Vec<(usize, String)>,
        directories: Vec<String>,
    }
    struct Matchers<'a> {
        host: &'a dyn Host,
        files: GlobMatcher,
        directories: GlobMatcher,
        extensions: &'a [&'a str],
    }
    impl Matchers<'_> {
        fn list(&self, path: &str) -> Listed {
            let (files, directories) = self.host.entries(path);
            let prefix = if path.ends_with('/') {
                path.to_owned()
            } else {
                format!("{path}/")
            };
            Listed {
                files: files
                    .into_iter()
                    .filter(|file| self.extensions.iter().any(|e| file.ends_with(e)))
                    .filter_map(|file| {
                        let index = self.files.matches_file(&prefix, &file)?;
                        Some((index, format!("{prefix}{file}")))
                    })
                    .collect(),
                directories: directories
                    .into_iter()
                    .filter(|directory| self.directories.matches_directory(&prefix, directory))
                    .map(|directory| format!("{prefix}{directory}"))
                    .collect(),
            }
        }
    }
    struct Visitor<'a> {
        matchers: Matchers<'a>,
        case_sensitive: bool,
        visited: crate::util::FxHashSet<String>,
        /// What has been found out ahead of the walk.
        listed: crate::util::FxHashMap<String, Listed>,
        results: Vec<Vec<String>>,
    }
    impl Visitor<'_> {
        fn visit(&mut self, path: &str) {
            // A link can lead back to where it is.
            let real = self.matchers.host.realpath(path);
            let canonical = if self.case_sensitive {
                real
            } else {
                real.to_lowercase()
            };
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
    let path = normalize(path);
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
    // The walk goes through the directories one after the other, in the order that decides the order of the files. What there is in each and
    // what of it matches has been found out by then, for many directories at once.
    let mut level: Vec<String> = bases.clone();
    let mut asked: crate::util::FxHashSet<String> = Default::default();
    while !level.is_empty() {
        let found: Vec<std::sync::Mutex<Option<Listed>>> =
            level.iter().map(|_| Default::default()).collect();
        host.parallel(level.len(), &|i| {
            host.realpath(&level[i]);
            *found[i].lock().unwrap() = Some(visitor.matchers.list(&level[i]));
        });
        let mut next = Vec::new();
        for (path, listed) in level.into_iter().zip(found) {
            let listed = listed.into_inner().unwrap().unwrap();
            for directory in &listed.directories {
                if asked.insert(host.realpath(directory)) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;
    use std::collections::BTreeMap;

    struct Memory(BTreeMap<String, String>);

    impl Memory {
        fn new(files: &[(&str, &str)]) -> Memory {
            Memory(
                files
                    .iter()
                    .map(|&(p, t)| (p.to_owned(), t.to_owned()))
                    .collect(),
            )
        }
    }

    impl Host for Memory {
        fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
            self.0.get(path).map(|t| t.clone().into_bytes().into())
        }
        fn is_file(&self, path: &str) -> bool {
            self.0.contains_key(path)
        }
        fn is_dir(&self, path: &str) -> bool {
            let prefix = format!("{}/", path.trim_end_matches('/'));
            self.0.keys().any(|k| k.starts_with(&prefix))
        }
        fn realpath(&self, path: &str) -> String {
            path.to_owned()
        }
        fn list_dir(&self, path: &str) -> Vec<String> {
            let prefix = format!("{}/", path.trim_end_matches('/'));
            let mut names: Vec<String> = self
                .0
                .keys()
                .filter_map(|k| k.strip_prefix(&prefix))
                .map(|rest| rest.split('/').next().unwrap().to_owned())
                .collect();
            names.dedup();
            names
        }
        fn parse(
            &self,
            _: &str,
            _: &[u8],
            _: &crate::atom::Interner,
            _: &Options,
        ) -> crate::hir::File {
            unreachable!()
        }
        fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
            (0..count).for_each(work);
        }
    }

    fn files_of(host: &Memory, config: &str) -> Vec<String> {
        load(host, config).files
    }

    #[test]
    fn default_include_skips_packages_hidden_directories_and_min_js() {
        let host = Memory::new(&[
            (
                "/p/tsconfig.json",
                "{ \"compilerOptions\": { \"allowJs\": true } }",
            ),
            ("/p/a.ts", ""),
            ("/p/b.tsx", ""),
            ("/p/c.d.ts", ""),
            ("/p/d.js", ""),
            ("/p/e.min.js", ""),
            ("/p/notes.txt", ""),
            ("/p/.hidden/x.ts", ""),
            ("/p/.dot.ts", ""),
            ("/p/node_modules/m/index.ts", ""),
            ("/p/sub/deep/y.mts", ""),
        ]);
        assert_eq!(
            files_of(&host, "/p/tsconfig.json"),
            [
                "/p/a.ts",
                "/p/b.tsx",
                "/p/c.d.ts",
                "/p/d.js",
                "/p/sub/deep/y.mts"
            ]
        );
    }

    #[test]
    fn files_come_first_and_cannot_be_excluded() {
        let host = Memory::new(&[
            (
                "/p/tsconfig.json",
                r#"{ "files": ["z.ts"], "include": ["src"], "exclude": ["z.ts", "src/skip"] }"#,
            ),
            ("/p/z.ts", ""),
            ("/p/src/a.ts", ""),
            ("/p/src/skip/b.ts", ""),
            ("/p/other/c.ts", ""),
        ]);
        assert_eq!(
            files_of(&host, "/p/tsconfig.json"),
            ["/p/z.ts", "/p/src/a.ts"]
        );
    }

    #[test]
    fn higher_priority_extension_wins() {
        let host = Memory::new(&[
            (
                "/p/tsconfig.json",
                r#"{ "compilerOptions": { "allowJs": true } }"#,
            ),
            ("/p/a.ts", ""),
            ("/p/a.js", ""),
            ("/p/a.d.ts", ""),
            ("/p/b.d.ts", ""),
            ("/p/b.js", ""),
        ]);
        assert_eq!(
            files_of(&host, "/p/tsconfig.json"),
            ["/p/a.ts", "/p/b.d.ts", "/p/b.js"]
        );
    }

    #[test]
    fn out_dir_is_excluded_unless_exclude_is_said() {
        let host = Memory::new(&[
            (
                "/p/tsconfig.json",
                r#"{ "compilerOptions": { "outDir": "dist" } }"#,
            ),
            ("/p/a.ts", ""),
            ("/p/dist/a.d.ts", ""),
        ]);
        assert_eq!(files_of(&host, "/p/tsconfig.json"), ["/p/a.ts"]);
    }

    #[test]
    fn extends_merges_options_and_inherits_specs_from_where_they_are_written() {
        let host = Memory::new(&[
            (
                "/base/tsconfig.base.json",
                r#"{ "compilerOptions": { "strict": false, "noImplicitAny": true, "paths": { "@/*": ["./lib/*"] }, "typeRoots": ["./types"] },
                     "include": ["shared"] }"#,
            ),
            (
                "/p/tsconfig.json",
                r#"{ "extends": "../base/tsconfig.base", "compilerOptions": { "noImplicitAny": null, "strictNullChecks": true } }"#,
            ),
            ("/base/shared/s.ts", ""),
            ("/p/own.ts", ""),
        ]);
        let project = load(&host, "/p/tsconfig.json");
        assert_eq!(project.errors, []);
        assert_eq!(project.files, ["/base/shared/s.ts"]);
        assert!(project.options.strict_null_checks);
        // `null` takes the inherited `noImplicitAny` back, so `strict: false` decides.
        assert!(!project.options.no_implicit_any);
        assert_eq!(project.options.paths_base_dir, "/base");
        assert_eq!(
            project.options.type_roots,
            Some(vec!["/base/types".to_owned()])
        );
    }

    #[test]
    fn extends_an_array_a_package_and_config_dir() {
        let host = Memory::new(&[
            ("/p/node_modules/@tsconfig/strictest/package.json", "{}"),
            (
                "/p/node_modules/@tsconfig/strictest/tsconfig.json",
                r#"{ "compilerOptions": { "noUnusedLocals": true, "outDir": "${configDir}/out" }, "include": ["${configDir}/code"] }"#,
            ),
            (
                "/p/node_modules/preset/package.json",
                r#"{ "exports": { "./base": "./configs/base.json" } }"#,
            ),
            (
                "/p/node_modules/preset/configs/base.json",
                r#"{ "compilerOptions": { "noUnusedLocals": false, "noUnusedParameters": true } }"#,
            ),
            (
                "/p/app/tsconfig.json",
                r#"{ "extends": ["@tsconfig/strictest", "preset/base"] }"#,
            ),
            ("/p/app/code/a.ts", ""),
            ("/p/app/out/a.d.ts", ""),
            ("/p/app/elsewhere.ts", ""),
        ]);
        let project = load(&host, "/p/app/tsconfig.json");
        assert_eq!(project.errors, []);
        assert_eq!(project.files, ["/p/app/code/a.ts"]);
        assert!(!project.options.no_unused_locals);
        assert!(project.options.no_unused_parameters);
    }

    #[test]
    fn errors() {
        let host = Memory::new(&[
            ("/a/tsconfig.json", r#"{ "extends": "./b.json" }"#),
            ("/a/b.json", r#"{ "extends": "./tsconfig.json" }"#),
            ("/c/tsconfig.json", r#"{ "extends": "./missing" }"#),
            ("/c/x.ts", ""),
            ("/d/tsconfig.json", r#"{ "files": [] }"#),
            (
                "/e/tsconfig.json",
                r#"{ "include": ["src/**", "**/../x", "nothing"] }"#,
            ),
        ]);
        let codes =
            |path: &str| -> Vec<u32> { load(&host, path).errors.iter().map(|e| e.code).collect() };
        assert_eq!(codes("/a/tsconfig.json"), [18000, 18003]);
        assert_eq!(codes("/c/tsconfig.json"), [6053]);
        assert_eq!(codes("/d/tsconfig.json"), [18002]);
        assert_eq!(codes("/e/tsconfig.json"), [5010, 5065, 18003]);
    }

    #[test]
    fn wildcards() {
        let pattern = |spec: &str, usage| GlobPattern::compile(spec, "/p", usage, true).unwrap();
        let files = pattern("src/**/*.test.ts", Usage::Files);
        assert!(files.matches("/p/src/a.test.ts", ""));
        assert!(files.matches("/p/src/x/y/", "a.test.ts"));
        assert!(!files.matches("/p/src/a.ts", ""));
        assert!(!files.matches("/p/src/node_modules/a.test.ts", ""));
        assert!(!files.matches("/p/src/.cache/a.test.ts", ""));
        assert!(files.matches_prefix("/p/", "src"));
        assert!(!files.matches_prefix("/p/", "lib"));
        let question = pattern("a?c.ts", Usage::Files);
        assert!(question.matches("/p/abc.ts", ""));
        assert!(!question.matches("/p/ac.ts", ""));
        let exclude = pattern("**/gen", Usage::Exclude);
        // It stands for `**/gen/**/*`: what is in the directory, not the directory.
        assert!(!exclude.matches("/p/x/gen", ""));
        assert!(exclude.matches("/p/x/gen/file.ts", ""));
        assert!(exclude.matches("/p/x/gen/deep/file.ts", ""));
        assert!(exclude.matches("/p/node_modules/gen/file.ts", ""));
        assert!(!exclude.matches("/p/x/generated", ""));
        let insensitive = GlobPattern::compile("SRC/*.TS", "/p", Usage::Files, false).unwrap();
        assert!(insensitive.matches("/p/src/a.ts", ""));
    }

    #[test]
    fn finds_the_nearest_config() {
        let host = Memory::new(&[
            ("/p/tsconfig.json", "{}"),
            ("/p/a/b/x.ts", ""),
            ("/p/js/jsconfig.json", "{}"),
            ("/p/js/x.js", ""),
        ]);
        assert_eq!(
            find_config(&host, "/p/a/b").as_deref(),
            Some("/p/tsconfig.json")
        );
        assert_eq!(
            find_config(&host, "/p/js").as_deref(),
            Some("/p/js/jsconfig.json")
        );
        assert_eq!(find_config(&host, "/q"), None);
        assert!(load(&host, "/p/js/jsconfig.json").options.allow_js);
    }
}
