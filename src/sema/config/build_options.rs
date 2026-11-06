use super::*;
use crate::resolve::{get_root_length, path_is_relative};

#[derive(Copy, Clone, PartialEq, Eq)]
enum RootFiles {
    Listed,
    Unlisted,
    Skipped,
}

impl ConfigError {
    pub(super) fn unreadable(code: u32, args: &[&[u8]]) -> ConfigError {
        ConfigError {
            is_unreadable: true,
            ..ConfigError::new(code, args)
        }
    }
}

pub fn compile_build_overrides() -> Vec<(Vec<u8>, Json)> {
    vec![
        (b"noEmit".to_vec(), Json::Bool(true)),
        (b"allowImportingTsExtensions".to_vec(), Json::Bool(true)),
        (b"noCheck".to_vec(), Json::Bool(false)),
        (b"traceResolution".to_vec(), Json::Bool(false)),
    ]
}

const OUTPUT_OPTIONS: [&[u8]; 20] = [
    b"charset",
    b"declarationDir",
    b"declarationMap",
    b"emitDeclarationOnly",
    b"importHelpers",
    b"importsNotUsedAsValues",
    b"incremental",
    b"inlineSourceMap",
    b"inlineSources",
    b"mapRoot",
    b"noImplicitUseStrict",
    b"out",
    b"outDir",
    b"outFile",
    b"prepend",
    b"preserveValueImports",
    b"rootDir",
    b"sourceMap",
    b"sourceRoot",
    b"tsBuildInfoFile",
];

fn is_removed_and_means_nothing(option: &(Vec<u8>, Json)) -> bool {
    let is_one_of = |values: &[&[u8]]| {
        let written = option.1.as_str();
        written.is_some_and(|it| values.iter().any(|value| it.eq_ignore_ascii_case(value)))
    };
    match &option.0[..] {
        b"downlevelIteration" => true,
        b"alwaysStrict" | b"esModuleInterop" | b"allowSyntheticDefaultImports" => {
            matches!(option.1, Json::Bool(false))
        }
        b"target" => is_one_of(&[b"es5"]),
        b"module" => is_one_of(&[b"amd", b"umd", b"system"]),
        b"moduleResolution" => is_one_of(&[b"node", b"node10", b"classic"]),
        _ => false,
    }
}

const UNKNOWN_OPTION_CODE: u32 = 5023;

pub fn load_for_build(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
) -> Result<Project, Vec<ConfigError>> {
    load(host, session, path, RootFiles::Listed)
}

pub fn load_for_build_with_unlisted_files(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
) -> Result<Project, Vec<ConfigError>> {
    let mut project = load(host, session, path, RootFiles::Unlisted)?;
    if !project.references.is_empty() {
        project.list_files(host);
    }
    Ok(project)
}

pub fn load_options_for_build(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
) -> Result<Project, Vec<ConfigError>> {
    load(host, session, path, RootFiles::Skipped)
}

impl Project {
    pub fn only_has_references(&self) -> bool {
        debug_assert!(self.unlisted_files.is_none() || self.references.is_empty());
        self.files.is_empty() && !self.references.is_empty()
    }

    pub fn list_files(&mut self, host: &dyn Host) {
        if let Some(unlisted) = self.unlisted_files.take() {
            self.files = unlisted.list(host, &mut |_| {});
            self.options.files.clone_from(&self.files);
        }
    }
}

fn load_referenced_projects(
    host: &dyn Host,
    project: &Project,
    load: impl Fn(&[u8]) -> Option<Project>,
) -> Vec<Project> {
    let is_case_sensitive = host.is_case_sensitive();
    let paths_of = |project: &Project| -> Vec<Vec<u8>> {
        let references = project.references.iter().rev();
        references
            .map(|it| resolve_config_file_name_of_project_reference(&it.path))
            .collect()
    };
    let mut seen = vec![project.config_path.clone()];
    let mut pending = paths_of(project);
    let mut projects = Vec::new();
    while let Some(path) = pending.pop() {
        if seen
            .iter()
            .any(|it| is_same_path(it, &path, is_case_sensitive))
        {
            continue;
        }
        seen.push(path.clone());
        if let Some(referenced) = load(&path) {
            pending.extend(paths_of(&referenced));
            projects.push(referenced);
        }
    }
    projects
}

pub fn load_referenced_projects_for_build(host: &dyn Host, solution: &Project) -> Vec<Project> {
    load_referenced_projects(host, solution, |path| {
        load_for_build(host, &Session::new(), path).ok()
    })
}

fn find_outputs_of_referenced_projects(
    host: &dyn Host,
    project: &Project,
) -> Vec<(Vec<u8>, Vec<u8>)> {
    let referenced = load_referenced_projects(host, project, |path| {
        let (session, mut errors) = (Session::new(), Vec::new());
        let mut raw = parse_config(host, &session, path, &mut errors)?;
        skip_root_files(&mut raw);
        Some(project_from_raw(
            host,
            &session,
            path,
            dirname::<Posix>(path),
            raw,
            errors,
        ))
    });
    let outputs = referenced.iter().filter_map(|referenced| {
        let options = &referenced.options;
        let written = [&options.declaration_dir, &options.out_dir];
        let output_directory = written
            .into_iter()
            .find(|directory| !directory.is_empty())?;
        let root_directory = match options.root_dir.is_empty() {
            true => dirname::<Posix>(&referenced.config_path),
            false => &options.root_dir[..],
        };
        Some((output_directory.clone(), root_directory.to_vec()))
    });
    outputs.collect()
}

fn skip_root_files(raw: &mut Raw) {
    raw.files = List {
        is_specified: true,
        is_array: true,
        items: None,
        verbatim: None,
    };
    raw.include = List {
        is_specified: true,
        is_array: true,
        items: Some(Vec::new()),
        verbatim: None,
    };
}

fn load(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    root_files: RootFiles,
) -> Result<Project, Vec<ConfigError>> {
    let mut errors = Vec::new();
    let raw = parse_config(host, session, path, &mut errors);
    let Some(raw) = raw.or_else(|| host.read(path).map(|_| Raw::default())) else {
        return Err(errors);
    };
    Ok(project_for_build(
        host, session, path, raw, errors, root_files,
    ))
}

fn project_for_build(
    host: &dyn Host,
    session: &Session,
    path: &[u8],
    mut raw: Raw,
    mut errors: Vec<ConfigError>,
    root_files: RootFiles,
) -> Project {
    let base = dirname::<Posix>(path);
    merge_compiler_options(&mut raw.compiler, compile_build_overrides(), &[]);
    exclude_output_directories(&mut raw, base);
    raw.compiler
        .retain(|option| !OUTPUT_OPTIONS.contains(&&option.0[..]));
    raw.compiler
        .retain(|option| !is_removed_and_means_nothing(option));
    let names_output_option = |error: &ConfigError| {
        error
            .args
            .first()
            .is_some_and(|option| OUTPUT_OPTIONS.contains(&&option[..]))
    };
    errors.retain(|error| error.code != UNKNOWN_OPTION_CODE || !names_output_option(error));
    let base_url = take_base_url(&mut raw.compiler, base);
    let assigns_class_fields = raw.compiler.iter().any(|option| {
        option.0 == b"useDefineForClassFields" && matches!(option.1, Json::Bool(false))
    });
    match root_files {
        RootFiles::Listed => {}
        RootFiles::Unlisted => raw.leaves_root_files_unlisted = true,
        RootFiles::Skipped => skip_root_files(&mut raw),
    }
    let mut project = project_from_raw(host, session, path, base, raw, errors);
    project.options.imports_need_no_extension = true;
    project.options.use_define_for_class_fields = !assigns_class_fields;
    project.options.emit_standard_class_fields = !assigns_class_fields;
    project.options.referenced_outputs = find_outputs_of_referenced_projects(host, &project);
    if let Some(base_url) = base_url {
        project.options.paths_base_dir.clone_from(&base_url);
        project.options.base_url = base_url;
    }
    project
}

pub fn default_options_of_aot_package() -> Vec<(Vec<u8>, Json)> {
    let text = |value: &[u8]| Json::String(value.to_vec());
    let options: [(&[u8], Json); 7] = [
        (b"target", text(b"esnext")),
        (b"module", text(b"preserve")),
        (b"moduleResolution", text(b"bundler")),
        (b"noEmit", Json::Bool(true)),
        (b"allowImportingTsExtensions", Json::Bool(true)),
        (b"skipLibCheck", Json::Bool(true)),
        (b"strict", Json::Bool(true)),
    ];
    options.map(|(name, value)| (name.to_vec(), value)).into()
}

/// The nearest `package.json` that states `compilerOptions`, up to `node_modules`.
pub fn find_package_with_compiler_options(host: &dyn Host, dir: &[u8]) -> Option<Vec<u8>> {
    for dir in ancestors(dir) {
        let path = join(dir, b"package.json");
        let text = host.is_file(&path).then(|| host.read(&path)).flatten();
        let session = Session::new();
        if let Some(file) = text.and_then(|text| TsConfigSourceFile::parse(host, &session, text))
            && let Some(root) = file.root
            && (file.property(root, b"compilerOptions", Some(b"name"))).is_some()
        {
            return Some(path);
        }
        if dir.ends_with(b"/node_modules") {
            return None;
        }
    }
    None
}

pub fn load_for_aot_package(host: &dyn Host, session: &Session, manifest_path: &[u8]) -> Project {
    let mut errors = Vec::new();
    let stated = parse_config(host, session, manifest_path, &mut errors).unwrap_or_default();
    let mut compiler = default_options_of_aot_package();
    merge_compiler_options(&mut compiler, stated.compiler, &[]);
    let raw = Raw {
        compiler,
        ..Raw::default()
    };
    let mut project = project_for_build(
        host,
        session,
        manifest_path,
        raw,
        errors,
        RootFiles::Skipped,
    );
    let options = &mut project.options;
    let type_roots = options.effective_type_roots();
    let has_bun_types = |root: &Vec<u8>| host.is_file(&join(root, b"bun/package.json"));
    if options.types.is_none() && type_roots.iter().any(has_bun_types) {
        options.types = Some(vec![b"bun".to_vec()]);
    }
    project
}

impl Project {
    pub fn key_of_compiler_options(&self) -> Vec<u8> {
        let mut options: Vec<&(Vec<u8>, Json)> = self.raw_compiler_options.iter().collect();
        options.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let mut key = self.options.base_url.clone();
        for (name, value) in options {
            key.push(b'\n');
            key.extend_from_slice(name);
            value.stringify(&mut key);
            if name == b"types" {
                key.extend_from_slice(&self.config_path);
            }
        }
        key
    }
}

fn exclude_output_directories(raw: &mut Raw, base: &[u8]) {
    if raw.exclude.is_array {
        return;
    }
    let directories: Vec<Json> = (raw.compiler.iter())
        .filter(|option| option.0 == b"outDir" || option.0 == b"declarationDir")
        .filter_map(|option| option.1.as_str())
        .filter(|directory| !directory.is_empty())
        .map(|directory| match substitute_if_template(directory, base) {
            Some(substituted) => displayed_path(&substituted).into_owned(),
            None => displayed_path(directory).into_owned(),
        })
        .map(Json::String)
        .collect();
    if !directories.is_empty() {
        raw.exclude.items = Some(directories);
    }
}

fn take_base_url(compiler: &mut Vec<(Vec<u8>, Json)>, base: &[u8]) -> Option<Vec<u8>> {
    let index = compiler.iter().position(|option| option.0 == b"baseUrl")?;
    let written = compiler.remove(index).1.into_string()?;
    let base_url = substitute_if_template(&written, base).unwrap_or_else(|| join(base, &written));
    let paths = compiler.iter_mut().find(|option| option.0 == b"paths");
    let Some((_, Json::Object(patterns))) = paths else {
        return Some(base_url);
    };
    for (_, substitutions) in patterns {
        let Json::Array(substitutions) = substitutions else {
            continue;
        };
        for substitution in substitutions {
            if let Json::String(text) = substitution
                && !path_is_relative(text)
                && get_root_length(text) == 0
                && !starts_with_config_dir_template(text)
            {
                *text = displayed_path(&join(&base_url, text)).into_owned();
            }
        }
    }
    Some(base_url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::ModuleDetection;

    fn text(value: &str) -> Json {
        Json::String(value.into())
    }

    fn paths_option(substitutions: [&str; 4]) -> (Vec<u8>, Json) {
        let substitutions = Json::Array(substitutions.map(text).into());
        let patterns = vec![(b"@/*".to_vec(), substitutions)];
        (b"paths".to_vec(), Json::Object(patterns))
    }

    #[test]
    fn compile_build_overrides_take_precedence() {
        let mut compiler = vec![
            (b"noEmit".to_vec(), Json::Bool(false)),
            (b"noCheck".to_vec(), Json::Bool(true)),
            (b"traceResolution".to_vec(), Json::Bool(true)),
        ];
        merge_compiler_options(&mut compiler, compile_build_overrides(), &[]);
        let options = Options::from_compiler_options(b"/project", &Json::Object(compiler));
        assert!(options.no_emit);
        assert!(!options.no_check);
        assert!(options.allow_importing_ts_extensions);
        assert!(!options.trace_resolution);
        assert_eq!(options.module_detection, ModuleDetection::Auto);
        assert!(options.problems.is_empty());
    }

    #[test]
    fn base_url_is_removed_and_bare_substitutions_become_absolute() {
        let strict = (b"strict".to_vec(), Json::Bool(true));
        let mut compiler = vec![
            (b"baseUrl".to_vec(), text("/project/base")),
            strict.clone(),
            paths_option(["src/*", "./lib/*", "../up/*", "/rooted/*"]),
        ];
        let base_url = take_base_url(&mut compiler, b"/project");
        assert_eq!(base_url.as_deref(), Some(&b"/project/base"[..]));
        let rewritten = paths_option(["/project/base/src/*", "./lib/*", "../up/*", "/rooted/*"]);
        assert_eq!(compiler, [strict, rewritten]);
    }

    #[test]
    fn relative_base_url_is_resolved_from_configuration_directory() {
        let mut compiler = vec![(b"baseUrl".to_vec(), text("./src"))];
        let base_url = take_base_url(&mut compiler, b"/project");
        assert_eq!(base_url.as_deref(), Some(&b"/project/src"[..]));
        assert!(compiler.is_empty());
    }

    #[test]
    fn paths_without_base_url_are_unchanged() {
        let written = paths_option(["src/*", "./lib/*", "../up/*", "/rooted/*"]);
        let mut compiler = vec![written.clone()];
        assert_eq!(take_base_url(&mut compiler, b"/project"), None);
        assert_eq!(compiler, [written]);
    }

    #[test]
    fn config_dir_template_is_not_joined_to_base_url() {
        let mut compiler = vec![
            (b"baseUrl".to_vec(), text("${configDir}/base")),
            paths_option(["${configDir}/src/*", "src/*", "./lib/*", "/rooted/*"]),
        ];
        let base_url = take_base_url(&mut compiler, b"/project");
        assert_eq!(base_url.as_deref(), Some(&b"/project/base"[..]));
        let rewritten = paths_option([
            "${configDir}/src/*",
            "/project/base/src/*",
            "./lib/*",
            "/rooted/*",
        ]);
        assert_eq!(compiler, [rewritten]);
    }

    #[test]
    fn rewritten_options_have_no_removed_option_error() {
        let mut compiler = vec![
            (b"baseUrl".to_vec(), text("/project")),
            paths_option(["src/*", "./lib/*", "../up/*", "/rooted/*"]),
        ];
        let as_written = Json::Object(compiler.clone());
        let errors = Options::from_compiler_options(b"/project", &as_written).errors;
        assert_eq!(errors, [5090, 5102]);
        take_base_url(&mut compiler, b"/project");
        let rewritten = Json::Object(compiler);
        let errors = Options::from_compiler_options(b"/project", &rewritten).errors;
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn unreadable_error_is_marked() {
        assert!(ConfigError::unreadable(5083, &[b"/a/tsconfig.json"]).is_unreadable);
        assert!(!ConfigError::new(5083, &[b"/a/tsconfig.json"]).is_unreadable);
    }
}
