use super::effects::{ProgramOrigins, compute_origins};
use super::{
    BunTypes, CompileRequest, EntryPointFailure, EntryPoints, LoadFailure, LoadedProgram,
    WithoutBunTypes,
};
use crate::{
    Libs, default_compiler_options, diagnostic_from_config_error, host, use_dedicated_pool,
};
use bun_sema::check::Program;
use bun_sema::check::aot::{FileOrigin, containers_completed_by_bun_types};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::FileKind;
use bun_sema::json::Json;
use bun_sema::program::{CodeView, CompileInputs, FileId, Files, LoggedSteps, RootFileNames};
use bun_sema::resolve::{
    CodeFailure, CodeHost, CodeImportForm, CodeImportKind, CodeOptions, CodeRequest,
    CodeResolution, ComputedCandidate, ComputedCodeRequest, ComputedResolution, ExternalKind, Host,
    HostResolution, Options, Resolver, is_javascript, is_same_path, is_typescript_file_name, join,
};
use bun_sema::session::{Session, SessionSlot};
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_threading::Guarded;
use std::borrow::Cow;
use std::cell::UnsafeCell;
use std::sync::atomic::AtomicBool;

const FILES_FREED_IN_A_RUN: usize = 32;

pub fn load_program<'s>(
    session: &'s Session,
    host: &dyn CodeHost,
    request: &CompileRequest<'_, 's>,
) -> Result<LoadedProgram<'s>, LoadFailure> {
    use_dedicated_pool("Bun Compile");
    let mut steps = LoggedSteps::begin(host);
    let entry_paths = match request.entry_points {
        EntryPoints::Written(specifiers) | EntryPoints::WrittenAndFound(specifiers, ..) => {
            resolve_entry_points(host, request.code, specifiers)?
        }
        EntryPoints::Resolved(paths) => paths.to_vec(),
    };
    debug_assert!(!entry_paths.is_empty() || request.code.tsconfig_override.is_some());
    let mut project = find_project(host, request, &entry_paths)?;
    if request.code.tsconfig_override.is_none() {
        add_files_of_other_projects(host, &mut project, &entry_paths);
    }
    if request.code.transpiles_by_working_directory && request.code.tsconfig_override.is_none() {
        project
            .options
            .transpile_as(&options_of_working_directory(host, request.code));
    }
    if project.options.emit_decorator_metadata && !project.options.experimental_decorators {
        project.options.experimental_decorators = true;
        project.errors.retain(|error| {
            let option = error.args.first().map(Vec::as_slice);
            error.code != 5052 || option != Some(&b"emitDecoratorMetadata"[..])
        });
    }
    project
        .errors
        .retain(|error| error.code != 18003 && error.code != 18002);
    let unlisted_files = project.unlisted_files.take();
    let first_files = host.compiler_declarations();
    let mut last_files = Vec::new();
    let options = &mut project.options;
    options.allows_es_module_mark = request.code.allows_es_module_mark;
    options.builds_executable = request.code.builds_executable;
    options
        .current_directory
        .clone_from(&request.code.working_directory);
    options
        .custom_conditions
        .extend_from_slice(&request.code.custom_conditions);
    let has_bun_types_installed = choose_libraries(host, options, request.libs);
    let is_application = request.project_origin != FileOrigin::Runtime;
    let brings_bun_types =
        is_application && !has_bun_types_installed && take_bun_types_of_host(host, options);
    let has_bun_types = has_bun_types_installed || brings_bun_types;
    options.orders_files_as_listed = !is_application;
    if is_application && has_bun_types {
        last_files.append(&mut host.declarations_beside_bun_types(has_bun_types_installed));
    }
    if is_application && !has_bun_types {
        if let Some(path) = host.declarations_in_place_of_bun_types() {
            options.declarations_of_last_resort.clone_from(&path);
            last_files.push(path);
        }
    }
    let with_declarations = |files: Vec<Vec<u8>>| [&first_files[..], &files, &last_files].concat();
    let list_files = |on_match: &mut dyn FnMut(&[u8])| {
        with_declarations(
            unlisted_files
                .as_ref()
                .map_or(Vec::new(), |it| it.list(host, on_match)),
        )
    };
    let listed_files = with_declarations(std::mem::take(&mut project.files));
    let finds_entry_points = matches!(request.entry_points, EntryPoints::WrittenAndFound(..));
    let config_path = project.config_path.clone();
    let found_entry_paths: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
    let list_with_found = || {
        let found = found_entry_paths.lock();
        if !config_path.is_empty() || !found.iter().any(|path| is_typescript_file_name(path)) {
            return None;
        }
        let all = [&entry_paths[..], &found[..]].concat();
        Some(with_declarations(
            default_project(host, request.code, &all).files,
        ))
    };
    let root_files = match unlisted_files {
        Some(_) => {
            options.own_roots = Some(usize::MAX);
            RootFileNames::Unlisted(&list_files)
        }
        None if finds_entry_points => {
            options.own_roots = Some(usize::MAX);
            options.files.clone_from(&listed_files);
            RootFileNames::ListedAndFound(&listed_files, &list_with_found)
        }
        None => {
            options.own_roots = Some(listed_files.len());
            options.files.clone_from(&listed_files);
            RootFileNames::Listed(&listed_files)
        }
    };
    options.emits_declarations = false;
    let find_entry_points = |code: &dyn CodeView<'_>| match request.entry_points {
        EntryPoints::WrittenAndFound(_, find) => {
            let found = find(code);
            found_entry_paths.lock().extend_from_slice(&found);
            found
        }
        _ => Vec::new(),
    };
    steps.end("entry points, project, libraries");
    let files = Files::load_for_compile(
        session,
        host,
        project.options,
        root_files,
        &CompileInputs {
            entry_points: &entry_paths,
            finds_entry_points: finds_entry_points.then_some(&find_entry_points),
            code: request.code,
            fold: request.fold,
            atoms: request.atoms,
        },
    );
    steps.end("the files: the sum of the lines above, from the walk on");
    host.loaded();
    let files: &'s Files<'s> = session.arena().alloc(files);
    free_unread_leaves(files, host);
    steps.end("free the leaves that nothing reads, settle the texts");
    let checker_session = session.keep(SessionSlot::new());
    let node_counts = Program::count_nodes(files);
    let program = Program::with_node_counts(checker_session.session(), files, &node_counts);
    program.find_symbols_of_compiler();
    let program = &*session.arena().alloc(UnsafeCell::new(program));
    steps.end("count nodes, make the checker");
    let config_path = &project.config_path;
    let problems = ConfigError::from_problems(host, session, config_path, files.program_problems());
    let errors = project.errors.iter().chain(&problems);
    let origins = compute_origins(files, host, request.project_origin);
    steps.end("origins of the files");
    let bun_types = if !is_application || has_bun_types_installed {
        BunTypes::Installed
    } else if brings_bun_types {
        BunTypes::Brought
    } else {
        BunTypes::Missing(WithoutBunTypes {
            incomplete_containers: containers_completed_by_bun_types(files),
            errors_with_bun_types: host.errors_with_bun_types().map(<[_]>::to_vec),
        })
    };
    let has_configuration_file = !config_path.is_empty();
    let diagnostics = ProgramOrigins {
        files: Some(files),
        origins: &origins,
        project_origin: request.project_origin,
        bun_types: &bun_types,
        has_configuration_file,
    }
    .apply_effects(configuration_diagnostics(host, config_path, errors));
    Ok(LoadedProgram {
        program,
        files,
        checker_session,
        node_counts,
        is_checker_freed: AtomicBool::new(false),
        cycles_entered: Default::default(),
        origins,
        project_origin: request.project_origin,
        diagnostics,
        bun_types,
        has_configuration_file,
        files_left_to_loader: Default::default(),
    })
}

fn free_unread_leaves(files: &Files<'_>, host: &dyn CodeHost) {
    let is_unread = |&file: &FileId| {
        let module = files.module(file);
        let is_source = matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx);
        module.is_leaf && is_source && !files.is_compiled(file)
    };
    let file_ids: Vec<FileId> = (0..files.modules.len())
        .map(|index| FileId(index as u32))
        .collect();
    let runs: Vec<&[FileId]> = file_ids.chunks(FILES_FREED_IN_A_RUN).collect();
    host.parallel(runs.len(), &|run| {
        for file in runs[run] {
            let is_unread = is_unread(file);
            if is_unread {
                // SAFETY: no file that is read refers to it, no task of a build checks it, and no task has begun.
                unsafe { files.free_tree(*file) };
            }
            // SAFETY: no task has begun, and what the load has reported holds no part of a text.
            unsafe { files.settle_text(*file, !is_unread) };
        }
    });
}

fn configuration_diagnostics<'e>(
    host: &dyn Host,
    config_path: &[u8],
    errors: impl Iterator<Item = &'e ConfigError>,
) -> Vec<crate::Diagnostic> {
    let mut last = None;
    errors
        .map(|error| diagnostic_from_config_error(host, config_path, error, &mut last))
        .collect()
}

pub struct FileFinderTables {
    session: Session,
    options: Options,
}

impl Default for FileFinderTables {
    fn default() -> FileFinderTables {
        FileFinderTables {
            session: Session::new(),
            options: Options::default(),
        }
    }
}

pub struct FileFinder<'a> {
    resolver: Resolver<'a>,
    host: &'a dyn CodeHost,
    code: &'a CodeOptions,
}

impl<'a> FileFinder<'a> {
    pub fn new(
        tables: &'a FileFinderTables,
        host: &'a dyn CodeHost,
        code: &'a CodeOptions,
    ) -> FileFinder<'a> {
        let resolver = Resolver::for_compile(&tables.session, host, &tables.options, code);
        FileFinder {
            resolver,
            host,
            code,
        }
    }

    pub fn find_entry_point(&self, specifier: &[u8]) -> Option<Vec<u8>> {
        let resolution = self.resolver.resolve_code(&CodeRequest {
            specifier,
            importer: b"",
            directory: &self.code.working_directory,
            kind: CodeImportKind::EntryPoint,
            form: CodeImportForm::Static,
        });
        match resolution {
            CodeResolution::File(file) if file.host_module.is_none() => Some(file.path.to_vec()),
            _ => None,
        }
    }

    pub fn find_import(&self, importer: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
        self.find_loaded(importer, specifier, CodeImportKind::Import)
    }

    pub fn find_required(&self, importer: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
        self.find_loaded(importer, specifier, CodeImportKind::Require)
    }

    fn find_loaded(
        &self,
        importer: &[u8],
        specifier: &[u8],
        kind: CodeImportKind,
    ) -> Option<Vec<u8>> {
        let resolution = self.resolver.resolve_code(&CodeRequest {
            specifier,
            importer,
            directory: &self.host.directory_of(importer),
            kind,
            form: CodeImportForm::Macro,
        });
        match resolution {
            CodeResolution::File(file) if file.host_module.is_none() => Some(file.path.to_vec()),
            CodeResolution::External {
                specifier: path,
                kind: ExternalKind::UncompiledCode,
            } => Some(path.to_vec()),
            _ => None,
        }
    }
}

pub fn resolve_names_known_in_part(
    host: &dyn CodeHost,
    code: &CodeOptions,
    directory: &[u8],
    names: &[(&[u8], Option<&[u8]>)],
) -> Option<Vec<Vec<u8>>> {
    let session = Session::new();
    let options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &options, code);
    let request = ComputedCodeRequest {
        prefix: b"",
        suffix: b"",
        importer: b"",
        directory,
        kind: CodeImportKind::EntryPoint,
        form: CodeImportForm::Static,
    };
    let ComputedResolution::Candidates { candidates, .. } =
        resolver.resolve_alternative_code(&request, names)
    else {
        return None;
    };
    let files = candidates.iter().filter_map(|candidate| match candidate {
        ComputedCandidate::File(file) if file.host_module.is_none() => Some(file.path.to_vec()),
        ComputedCandidate::File(_) | ComputedCandidate::HostModule(_) => None,
    });
    Some(files.collect())
}

fn resolve_entry_points(
    host: &dyn CodeHost,
    code: &CodeOptions,
    specifiers: &[Vec<u8>],
) -> Result<Vec<Vec<u8>>, LoadFailure> {
    let session = Session::new();
    let options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &options, code);
    let mut paths = Vec::with_capacity(specifiers.len());
    let mut unresolved_entry_points = Vec::new();
    for (index, specifier) in specifiers.iter().enumerate() {
        let resolution = resolver.resolve_code(&CodeRequest {
            specifier,
            importer: b"",
            directory: &code.working_directory,
            kind: CodeImportKind::EntryPoint,
            form: CodeImportForm::Static,
        });
        let failure = match resolution {
            CodeResolution::File(file) if file.host_module.is_none() => {
                paths.push(file.path.to_vec());
                continue;
            }
            CodeResolution::File(_) | CodeResolution::HostModule(_) => {
                EntryPointFailure::BuiltinModule
            }
            CodeResolution::External { .. } => EntryPointFailure::External,
            CodeResolution::NotFound(_)
                if host.resolve_runtime_module(specifier) != HostResolution::Unclaimed =>
            {
                EntryPointFailure::BuiltinModule
            }
            CodeResolution::NotFound(failure) => EntryPointFailure::NotFound(failure),
            CodeResolution::Erased => EntryPointFailure::NotFound(CodeFailure::ModuleNotFound),
        };
        unresolved_entry_points.push((index, failure));
    }
    if unresolved_entry_points.is_empty() {
        return Ok(paths);
    }
    Err(LoadFailure {
        unresolved_entry_points,
        diagnostics: Vec::new(),
    })
}

fn find_config_of_program(
    host: &dyn CodeHost,
    code: &CodeOptions,
    directory: &[u8],
) -> Option<Vec<u8>> {
    let found = config::find_config(host, directory)?;
    let below = code
        .working_directory
        .strip_prefix(&host.directory_of(&found)[..]);
    let is_of_project = below.is_some_and(|below| below.is_empty() || below[0] == b'/');
    let is_of_dependency = !is_of_project && bun_core::strings::contains(&found, b"/node_modules/");
    (!is_of_dependency).then_some(found)
}

fn find_project(
    host: &dyn CodeHost,
    request: &CompileRequest<'_, '_>,
    entry_paths: &[Vec<u8>],
) -> Result<config::Project, LoadFailure> {
    let code = request.code;
    let first_of_project = match code.tsconfig_override {
        Some(_) => 0,
        None => first_entry_point_of_largest_project(host, code, entry_paths),
    };
    let of_project = &entry_paths[first_of_project..];
    let config_path = match &code.tsconfig_override {
        Some(path) if host.is_dir(path) => Some(join(path, b"tsconfig.json")),
        Some(path) => Some(path.clone()),
        None => {
            let directory = match of_project.first() {
                Some(path) => host.directory_of(path),
                None => Cow::Borrowed(&code.working_directory[..]),
            };
            find_config_of_program(host, code, &directory)
        }
    };
    let Some(config_path) = config_path else {
        return Ok(default_project(host, code, entry_paths));
    };
    if code.tsconfig_override.is_some() && !code.builds_executable && !host.is_file(&config_path) {
        return Ok(default_project(host, code, entry_paths));
    }
    let project = config::load_for_build_with_unlisted_files(host, &Session::new(), &config_path);
    let project = project.map(|project| match code.tsconfig_override {
        Some(_) => project,
        None => find_project_of_first_entry_point(host, project, of_project),
    });
    project.map_err(|errors| LoadFailure {
        unresolved_entry_points: Vec::new(),
        diagnostics: without_files(request.project_origin)
            .apply_effects(configuration_diagnostics(host, &config_path, errors.iter())),
    })
}

fn first_entry_point_of_largest_project(
    host: &dyn CodeHost,
    code: &CodeOptions,
    entry_paths: &[Vec<u8>],
) -> usize {
    struct Project {
        config_path: Option<Vec<u8>>,
        first: usize,
        count: usize,
    }
    let mut projects: Vec<Project> = Vec::new();
    let mut of_folder: FxHashMap<Cow<'_, [u8]>, usize> = FxHashMap::default();
    for (position, path) in entry_paths.iter().enumerate() {
        let folder = of_folder.entry(host.directory_of(path));
        let index = *folder.or_insert_with_key(|folder| {
            let config_path = find_config_of_program(host, code, folder);
            let known = projects.iter().position(|it| it.config_path == config_path);
            known.unwrap_or_else(|| {
                projects.push(Project {
                    config_path,
                    first: position,
                    count: 0,
                });
                projects.len() - 1
            })
        });
        projects[index].count += 1;
    }
    let configured = projects.iter().filter(|it| it.config_path.is_some());
    let largest = configured.rev().max_by_key(|it| it.count);
    largest.map_or(0, |it| it.first)
}

fn options_of_working_directory(host: &dyn CodeHost, code: &CodeOptions) -> Options {
    let config_path = config::find_config_in(host, &code.working_directory);
    let stated = config_path
        .and_then(|path| config::load_options_for_build(host, &Session::new(), &path).ok());
    stated
        .unwrap_or_else(|| default_project(host, code, &[]))
        .options
}

fn find_project_of_first_entry_point(
    host: &dyn CodeHost,
    nearest: config::Project,
    entry_paths: &[Vec<u8>],
) -> config::Project {
    let Some(entry_path) = entry_paths
        .first()
        .filter(|_| nearest.only_has_references())
    else {
        return nearest;
    };
    let is_entry_point = |path: &Vec<u8>| is_same_path(path, entry_path, host.is_case_sensitive());
    let referenced = config::load_referenced_projects_for_build(host, &nearest);
    let mut referenced = referenced.into_iter();
    referenced
        .find(|project| project.files.iter().any(is_entry_point))
        .unwrap_or(nearest)
}

fn add_files_of_other_projects(
    host: &dyn CodeHost,
    program: &mut config::Project,
    entry_paths: &[Vec<u8>],
) {
    let mut config_of_folder: FxHashMap<Cow<'_, [u8]>, Option<Vec<u8>>> = FxHashMap::default();
    let mut referenced_by: FxHashMap<Vec<u8>, ReferencedProjects> = FxHashMap::default();
    let mut added = vec![program.config_path.clone()];
    let mut files: Option<FxHashSet<Vec<u8>>> = None;
    let (allows_js, resolves_json) = (
        program.options.allow_js,
        program.options.resolve_json_module,
    );
    let is_root_file_of_program = |path: &[u8]| {
        (allows_js || !is_javascript(path)) && (resolves_json || !path.ends_with(b".json"))
    };
    let mut add = |project: config::Project, added: &mut Vec<Vec<u8>>| {
        if !added.contains(&project.config_path) {
            added.push(project.config_path);
            program.list_files(host);
            let files = files.get_or_insert_with(|| program.files.iter().cloned().collect());
            let new_files = project
                .files
                .into_iter()
                .filter(|path| is_root_file_of_program(path))
                .filter(|path| files.insert(path.clone()));
            program.files.extend(new_files);
        }
    };
    for entry_path in entry_paths.iter().skip(1) {
        let folder = host.directory_of(entry_path);
        let nearest = config_of_folder
            .entry(folder)
            .or_insert_with_key(|folder| config::find_config(host, folder));
        let Some(config_path) = nearest else {
            continue;
        };
        if !referenced_by.contains_key(config_path) {
            if added.contains(config_path) {
                continue;
            }
            let Ok(project) = config::load_for_build(host, &Session::new(), config_path) else {
                added.push(config_path.clone());
                continue;
            };
            if !project.only_has_references() {
                add(project, &mut added);
                continue;
            }
            let projects = config::load_referenced_projects_for_build(host, &project);
            referenced_by.insert(config_path.clone(), ReferencedProjects::new(projects));
        }
        let referenced = referenced_by.get_mut(config_path);
        if let Some(project) = referenced.and_then(|it| it.take_project_of(entry_path)) {
            add(project, &mut added);
        }
    }
}

struct ReferencedProjects {
    projects: Vec<Option<config::Project>>,
    project_of_file: FxHashMap<Vec<u8>, usize>,
}

impl ReferencedProjects {
    fn new(projects: Vec<config::Project>) -> ReferencedProjects {
        let mut project_of_file = FxHashMap::default();
        for (index, project) in projects.iter().enumerate() {
            for path in &project.files {
                project_of_file.entry(path.clone()).or_insert(index);
            }
        }
        ReferencedProjects {
            projects: projects.into_iter().map(Some).collect(),
            project_of_file,
        }
    }

    fn take_project_of(&mut self, path: &[u8]) -> Option<config::Project> {
        self.projects[*self.project_of_file.get(path)?].take()
    }
}

fn without_files(project_origin: FileOrigin) -> ProgramOrigins<'static, 'static> {
    ProgramOrigins {
        files: None,
        origins: &[],
        project_origin,
        bun_types: &BunTypes::Installed,
        has_configuration_file: true,
    }
}

fn default_project(
    host: &dyn Host,
    code: &CodeOptions,
    entry_paths: &[Vec<u8>],
) -> config::Project {
    let mut options = default_compiler_options();
    if let Json::Object(options) = &mut options {
        config::merge_compiler_options(options, config::compile_build_overrides(), &[]);
        options.retain(|option| option.0 != b"verbatimModuleSyntax");
    }
    let directory = &code.working_directory;
    let mut project = config::without_config(host, directory, options, entry_paths.to_vec());
    project.files.retain(|path| is_typescript_file_name(path));
    project
}

fn choose_libraries(host: &dyn Host, options: &mut Options, libs: Libs<'_>) -> bool {
    options.lib_dir = match libs {
        Libs::Bundled(_) => host::BUNDLED_LIBS.to_vec(),
        Libs::Directory(directory) => host::from_native(directory),
    };
    let has_bun_types_installed = options
        .effective_type_roots()
        .iter()
        .any(|root| host.is_file(&[&root[..], b"/bun/package.json"].concat()));
    if has_bun_types_installed {
        name_bun_types(options);
    }
    has_bun_types_installed
}

fn name_bun_types(options: &mut Options) {
    let types = options.types.get_or_insert_default();
    let is_named = (types.iter()).any(|name| matches!(&name[..], b"bun" | b"bun-types" | b"*"));
    if !is_named {
        types.push(b"bun".to_vec());
    }
}

fn take_bun_types_of_host(host: &dyn CodeHost, options: &mut Options) -> bool {
    let Some(root) = host.type_root_in_place_of_bun_types() else {
        return false;
    };
    let roots = options.effective_type_roots();
    let has_bun_types_package = roots.iter().any(|root| {
        let directories = [Some(&root[..]), root.strip_suffix(b"/@types")];
        (directories.into_iter().flatten())
            .any(|it| host.is_file(&[it, b"/bun-types/package.json"].concat()))
    });
    options.type_root_of_last_resort = Some(root);
    let (named, other): (&[u8], &[u8]) = match has_bun_types_package {
        true => (b"bun-types", b"bun"),
        false => (b"bun", b"bun-types"),
    };
    let types = options.types.get_or_insert_default();
    types.retain(|name| name != other);
    if !types.iter().any(|name| name == named) {
        types.push(named.to_vec());
    }
    true
}
