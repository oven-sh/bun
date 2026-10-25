use super::effects::{ProgramOrigins, compute_origins};
use super::{
    CompileRequest, EntryPointFailure, EntryPoints, LoadFailure, LoadedProgram, WithoutBunTypes,
};
use crate::{
    Libs, default_compiler_options, diagnostic_from_config_error, host, use_dedicated_pool,
};
use bun_sema::check::Program;
use bun_sema::check::aot::{FileOrigin, containers_completed_by_bun_types};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::FileKind;
use bun_sema::json::Json;
use bun_sema::program::{CompileInputs, FileId, Files, MainModule, RootFileNames};
use bun_sema::resolve::{
    CodeFailure, CodeHost, CodeImportForm, CodeImportKind, CodeOptions, CodeRequest,
    CodeResolution, Host, HostResolution, Options, Resolver, is_same_path, is_typescript_file_name,
    join,
};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet};
use std::borrow::Cow;

const FILES_FREED_IN_A_RUN: usize = 32;

pub fn load_program<'s>(
    session: &'s Session,
    host: &dyn CodeHost,
    request: &CompileRequest<'_, 's>,
) -> Result<LoadedProgram<'s>, LoadFailure> {
    use_dedicated_pool("Bun Compile");
    let entry_paths = match request.entry_points {
        EntryPoints::Written(specifiers) | EntryPoints::WrittenFor(specifiers, _) => {
            resolve_entry_points(host, request.code, specifiers)?
        }
        EntryPoints::Resolved(paths) | EntryPoints::Configured(paths, _) => paths.to_vec(),
    };
    debug_assert!(!entry_paths.is_empty());
    let mut project = find_project(host, request, &entry_paths)?;
    let is_configured = matches!(request.entry_points, EntryPoints::Configured(..));
    if request.code.tsconfig_override.is_none() && !is_configured {
        add_files_of_other_projects(host, &mut project, &entry_paths);
    }
    if request.code.transpiles_by_working_directory && request.code.tsconfig_override.is_none() {
        project
            .options
            .transpile_as(&options_of_working_directory(host, request.code));
    }
    project
        .errors
        .retain(|error| error.code != 18003 && error.code != 18002);
    let unlisted_files = project.unlisted_files.take();
    let first_files = host.compiler_declarations();
    let mut last_files = Vec::new();
    let options = &mut project.options;
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
    let root_files = match unlisted_files {
        Some(_) => {
            options.own_roots = Some(usize::MAX);
            RootFileNames::Unlisted(&list_files)
        }
        None => {
            options.own_roots = Some(listed_files.len());
            options.files.clone_from(&listed_files);
            RootFileNames::Listed(&listed_files)
        }
    };
    options.emits_declarations = false;
    let files = Files::load_for_compile(
        session,
        host,
        project.options,
        root_files,
        &CompileInputs {
            entry_points: &entry_paths,
            main_module: match request.entry_points {
                EntryPoints::Configured(..) => MainModule::Elsewhere,
                EntryPoints::WrittenFor(_, main_module) => main_module,
                EntryPoints::Written(_) | EntryPoints::Resolved(_) => MainModule::EntryPoint,
            },
            code: request.code,
            fold: request.fold,
            atoms: request.atoms,
        },
    );
    host.loaded();
    let files: &'s Files<'s> = session.arena().alloc(files);
    free_unread_leaves(files, host);
    let program = session.arena().alloc(Program::new(session, files));
    let config_path = &project.config_path;
    let problems = ConfigError::from_problems(host, session, config_path, files.program_problems());
    let errors = project.errors.iter().chain(&problems);
    let origins = compute_origins(files, host, request.project_origin);
    let without_bun_types = (is_application && !has_bun_types).then_some(WithoutBunTypes {
        has_configuration_file: !config_path.is_empty(),
        incomplete_containers: containers_completed_by_bun_types(files),
    });
    let diagnostics = ProgramOrigins {
        files: Some(files),
        origins: &origins,
        project_origin: request.project_origin,
        without_bun_types: without_bun_types.as_ref(),
        lacks_installed_bun_types: is_application && !has_bun_types_installed,
    }
    .apply_effects(configuration_diagnostics(host, config_path, errors));
    Ok(LoadedProgram {
        program,
        origins,
        project_origin: request.project_origin,
        diagnostics,
        has_bun_types_installed,
        brings_bun_types,
        without_bun_types,
        is_read_again: false,
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

fn find_project(
    host: &dyn CodeHost,
    request: &CompileRequest<'_, '_>,
    entry_paths: &[Vec<u8>],
) -> Result<config::Project, LoadFailure> {
    let code = request.code;
    let config_path = match (request.entry_points, &code.tsconfig_override) {
        (EntryPoints::Configured(_, Some(manifest_path)), _) => {
            let session = Session::new();
            return Ok(config::load_for_aot_package(host, &session, manifest_path));
        }
        (EntryPoints::Configured(_, None), _) => None,
        (_, Some(path)) if host.is_dir(path) => Some(join(path, b"tsconfig.json")),
        (_, Some(path)) => Some(path.clone()),
        (_, None) => {
            let directory = match entry_paths.first() {
                Some(path) => host.directory_of(path),
                None => Cow::Borrowed(&code.working_directory[..]),
            };
            config::find_config(host, &directory)
        }
    };
    let Some(config_path) = config_path else {
        return Ok(default_project(host, code, entry_paths));
    };
    let project = config::load_for_build_with_unlisted_files(host, &Session::new(), &config_path);
    let project = project.map(|project| match code.tsconfig_override {
        Some(_) => project,
        None => find_project_of_first_entry_point(host, project, entry_paths),
    });
    project.map_err(|errors| LoadFailure {
        unresolved_entry_points: Vec::new(),
        diagnostics: without_files(request.project_origin)
            .apply_effects(configuration_diagnostics(host, &config_path, errors.iter())),
    })
}

pub fn find_configuration_of_each_entry_point(
    host: &dyn CodeHost,
    request: &CompileRequest<'_, '_>,
) -> Option<Vec<Vec<u8>>> {
    let entry_paths = match request.entry_points {
        EntryPoints::Written(specifiers) | EntryPoints::WrittenFor(specifiers, _) => {
            resolve_entry_points(host, request.code, specifiers).ok()?
        }
        EntryPoints::Resolved(paths) | EntryPoints::Configured(paths, _) => paths.to_vec(),
    };
    let mut of_folder: FxHashMap<Vec<u8>, Option<Vec<u8>>> = FxHashMap::default();
    let mut found = Vec::with_capacity(entry_paths.len());
    for entry_path in &entry_paths {
        let folder = host.directory_of(entry_path).into_owned();
        if let Some(Some(known)) = of_folder.get(&folder) {
            found.push(known.clone());
            continue;
        }
        let project = find_project(host, request, core::slice::from_ref(entry_path)).ok()?;
        let nearest = match request.code.tsconfig_override {
            Some(_) => None,
            None => config::find_config(host, &folder),
        };
        let is_chosen_by_folder = nearest.is_none_or(|nearest| nearest == project.config_path);
        of_folder.insert(
            folder,
            is_chosen_by_folder.then(|| project.config_path.clone()),
        );
        found.push(project.config_path);
    }
    Some(found)
}

fn options_of_working_directory(host: &dyn CodeHost, code: &CodeOptions) -> Options {
    let config_path = config::find_config(host, &code.working_directory);
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
    let mut add = |project: config::Project, added: &mut Vec<Vec<u8>>| {
        if !added.contains(&project.config_path) {
            added.push(project.config_path);
            program.list_files(host);
            let files = files.get_or_insert_with(|| program.files.iter().cloned().collect());
            let new_files = project
                .files
                .into_iter()
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
        without_bun_types: None,
        lacks_installed_bun_types: false,
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
