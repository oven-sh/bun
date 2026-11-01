use super::code_barrels::ImportRequests;
use super::projects::Projects;
use super::*;
use crate::file_analysis::FileAnalysis;
use crate::fold::{FoldInputs, StoredByMocks};
use crate::hir_from_data::HostValue;
use crate::import_sites::{ExportedRequire, JsxMode};
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeHost, CodeImportForm, CodeImportKind, CodeOptions, CodeRequest, CodeResolution,
    DeclaredSideEffects, EnclosingPackage, HostPayload, JsxSettings, ProjectResolvers,
    SiteResolution, TranspileSettings,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MainModule {
    EntryPoint,
    EntryPointOfProcessOrWorker,
    Elsewhere,
    AnyFile,
}

pub struct CompileInputs<'a, 's> {
    pub entry_points: &'a [Vec<u8>],
    /// Asked each time every file that was found is parsed, until it names nothing new. The load goes on with what it names, and ends as a load of all of them ends.
    pub finds_entry_points: Option<&'a FindsEntryPoints<'a>>,
    pub main_module: MainModule,
    /// The program of the build that has loaded these files. This load folds each file and follows its imports as that one did.
    pub loaded_before: Option<&'a Files<'s>>,
    pub code: &'a CodeOptions,
    pub fold: &'a FoldInputs<'s>,
    pub atoms: Interner<'s>,
}

#[derive(Copy, Clone)]
pub(super) struct CompileLoad<'a, 's> {
    pub(super) host: &'a dyn CodeHost,
    pub(super) inputs: &'a CompileInputs<'a, 's>,
    /// Loads that share parsed files may run in parallel.
    pub(super) shares_parsed_files: bool,
}

impl<'s> Files<'s> {
    /// `parsed`: `Run::of_compile_build` with the atoms of `inputs`.
    pub fn load_for_compile_with_parsed_files<'u: 's>(
        session: &'s Session,
        parsed: Option<&'s Run<'u>>,
        host: &dyn CodeHost,
        options: Options,
        roots: RootFileNames<'_>,
        inputs: &CompileInputs<'_, 's>,
    ) -> Files<'s> {
        let compile = CompileLoad {
            host,
            inputs,
            shares_parsed_files: parsed.is_some(),
        };
        Self::load_with(
            session,
            parsed,
            host,
            options,
            roots,
            &|_| {},
            Some(compile),
        )
    }
}

pub(super) struct CodeLoadContext<'a, 's: 'r, 'r> {
    pub(super) session: &'s Session,
    pub(super) host: &'a dyn CodeHost,
    pub(super) inputs: &'a CompileInputs<'a, 's>,
    pub(super) resolver: &'a Resolver<'r>,
    pub(super) options: &'s Options,
    pub(super) atoms: Interner<'s>,
    pub(super) projects: Projects<'s>,
    pub(super) project_resolvers: ProjectResolvers<'r>,
    /// `CompileInputs::entry_points`
    written_entry_points: Vec<CodeTarget<'r>>,
    keys_of_entry_points: FxHashSet<(Cow<'r, [u8]>, HostLoader)>,
    /// What `CompileInputs::finds_entry_points` has named.
    found_entry_points: Guarded<Vec<CodeTarget<'r>>>,
    main_modules_beside_entry_points: FxHashSet<Vec<u8>>,
    entry_points_only_imported_from_above: FxHashSet<Vec<u8>>,
    pub(super) is_case_sensitive: bool,
    shares_parsed_files: bool,
    files_loaded_before: FxHashMap<(Cow<'a, [u8]>, HostLoader), FileId>,
}

/// A file as `CompileInputs::loaded_before` has it.
#[derive(Copy, Clone)]
pub(super) struct LoadedBefore<'a, 's> {
    pub(super) hir: &'a hir::File<'s>,
    pub(super) compiled: &'s CompiledModule<'s>,
}

const _: fn() = || {
    fn is_shared<T: Sync>() {}
    is_shared::<CodeLoadContext<'static, 'static, 'static>>();
    is_shared::<CodeFiles<'static, 'static>>();
};

impl<'a, 's: 'r, 'r> CodeLoadContext<'a, 's, 'r> {
    pub(super) fn new(
        session: &'s Session,
        resolver: &'a Resolver<'r>,
        options: &'s Options,
        compile: CompileLoad<'a, 's>,
    ) -> CodeLoadContext<'a, 's, 'r> {
        let entry_points = compile.inputs.entry_points.iter().map(|path| {
            let request = resolver.loader_request(path, CodeImportKind::EntryPoint, None, None);
            CodeTarget::of_path(resolver.keep(path), compile.host.loader_of(&request))
        });
        let entry_points: Vec<CodeTarget<'r>> = entry_points.collect();
        let is_case_sensitive = compile.host.is_case_sensitive();
        let keys_of_entry_points = (entry_points.iter())
            .map(|it| (to_path(it.key.path, is_case_sensitive), it.key.loader))
            .collect();
        let code = compile.inputs.code;
        let main_modules_beside_entry_points = (code.main_modules_beside_entry_points.iter())
            .filter_map(|path| {
                let resolution = resolver.resolve_code(&CodeRequest {
                    specifier: path,
                    importer: b"",
                    directory: &code.working_directory,
                    kind: CodeImportKind::EntryPoint,
                    form: CodeImportForm::Static,
                });
                match resolution {
                    CodeResolution::File(file) if file.host_module.is_none() => {
                        Some(to_path(file.path, is_case_sensitive).into_owned())
                    }
                    _ => None,
                }
            })
            .collect();
        let entry_points_only_imported_from_above = (code.entry_points_only_imported_from_above)
            .iter()
            .map(|path| to_path(path, is_case_sensitive).into_owned())
            .collect();
        let loaded_before = compile.inputs.loaded_before;
        let files_loaded_before = loaded_before.into_iter().flat_map(|files| {
            files.loaded_code_files().iter().filter_map(move |&file| {
                let path = to_path(files.module(file).file_name(), is_case_sensitive);
                Some(((path, files.compiled(file)?.loader), file))
            })
        });
        CodeLoadContext {
            session,
            host: compile.host,
            inputs: compile.inputs,
            resolver,
            options,
            atoms: compile.inputs.atoms,
            projects: Projects::new(session),
            project_resolvers: ProjectResolvers::new(),
            written_entry_points: entry_points,
            keys_of_entry_points,
            found_entry_points: Guarded::new(Vec::new()),
            main_modules_beside_entry_points,
            entry_points_only_imported_from_above,
            is_case_sensitive,
            shares_parsed_files: compile.shares_parsed_files,
            files_loaded_before: files_loaded_before.collect(),
        }
    }

    pub(super) fn find_loaded_before(&self, key: LoadKey<'_>) -> Option<LoadedBefore<'a, 's>> {
        let files = self.inputs.loaded_before?;
        let key = self.key_of_read_code(key);
        let path = to_path(key.path, self.is_case_sensitive);
        let &file = self.files_loaded_before.get(&(path, key.loader))?;
        Some(LoadedBefore {
            hir: files.hir(file),
            compiled: files.compiled(file)?,
        })
    }

    /// The I/O threads serve one load at a time.
    pub(super) fn io_pool(&self) -> Option<&'a bun_threading::ThreadPool> {
        match self.shares_parsed_files {
            true => None,
            false => self.host.io_pool(),
        }
    }

    pub(super) fn finish(build: Option<Self>) {
        if let Some(build) = build {
            build.project_resolvers.add_links_to(build.resolver);
        }
    }

    pub(super) fn entry_points(&self) -> Vec<CodeTarget<'r>> {
        let found = self.found_entry_points.lock();
        (self.written_entry_points.iter().chain(found.iter()))
            .copied()
            .collect()
    }

    pub(super) fn entry_point_count(&self) -> usize {
        self.written_entry_points.len() + self.found_entry_points.lock().len()
    }

    pub(super) fn is_entry_point(&self, key: LoadKey<'_>) -> bool {
        let path = to_path(key.path, self.is_case_sensitive);
        let is_same = |found: &CodeTarget<'r>| {
            found.key.loader == key.loader
                && *to_path(found.key.path, self.is_case_sensitive) == *path
        };
        if self.found_entry_points.lock().iter().any(is_same) {
            return true;
        }
        self.keys_of_entry_points.contains(&(path, key.loader))
    }

    /// `None`: the program begins there already.
    pub(super) fn add_entry_point(&self, path: &[u8]) -> Option<CodeTarget<'r>> {
        let resolver = self.resolver;
        let request = resolver.loader_request(path, CodeImportKind::EntryPoint, None, None);
        let target = CodeTarget::of_path(resolver.keep(path), self.host.loader_of(&request));
        if self.is_entry_point(target.key) {
            return None;
        }
        self.found_entry_points.lock().push(target);
        Some(target)
    }

    pub(super) fn is_only_imported_from_above(&self, key: LoadKey<'_>) -> bool {
        let path = to_path(key.path, self.is_case_sensitive);
        self.entry_points_only_imported_from_above.contains(&*path)
    }

    pub(super) fn is_main_module_beside_entry_points(&self, key: LoadKey<'_>) -> bool {
        let path = to_path(key.path, self.is_case_sensitive);
        self.main_modules_beside_entry_points.contains(&*path)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct LoadKey<'r> {
    pub(super) path: &'r [u8],
    pub(super) loader: HostLoader,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct CodeTarget<'r> {
    pub(super) key: LoadKey<'r>,
    pub(super) host_module: Option<HostModuleId>,
    pub(super) increases_depth: bool,
    pub(super) has_loader_attribute: bool,
    /// An import or export statement asks for it, so it is loaded with the graph of the file.
    pub(super) is_loaded_with_importer: bool,
    /// The statement writes a `type` other than "json". The loader of `bun run` keeps one module for a path and all of those.
    pub(super) has_shared_type: bool,
}

impl<'r> CodeTarget<'r> {
    pub(super) fn of_path(path: &'r [u8], loader: HostLoader) -> CodeTarget<'r> {
        CodeTarget {
            key: LoadKey { path, loader },
            host_module: None,
            increases_depth: false,
            has_loader_attribute: false,
            is_loaded_with_importer: false,
            has_shared_type: false,
        }
    }
}

pub(super) struct Analyzed<'s, 'r> {
    pub(super) analysis: FileAnalysis<'s>,
    pub(super) host_values: &'s [(ExprId, HostValue<'s>)],
    pub(super) settings: &'r TranspileSettings,
    pub(super) jsx: Option<JsxSettings>,
    pub(super) jsx_mode: JsxMode,
    pub(super) declared_module_type: DeclaredModuleType,
    pub(super) is_package_type_module: bool,
    pub(super) package: Option<EnclosingPackage<'r>>,
    pub(super) side_effects: DeclaredSideEffects<'r>,
    pub(super) is_aot_source: bool,
    pub(super) import_meta_main: Option<bool>,
    pub(super) is_called_before_it_runs: bool,
    pub(super) stored_by_mocks: StoredByMocks<'s>,
    pub(super) is_only_imported: bool,
}

pub(super) struct LoadedCode<'s, 'r> {
    pub(super) analyzed: Analyzed<'s, 'r>,
    pub(super) resolutions: Vec<SiteResolution<'r>>,
    pub(super) implied: Vec<CodeResolution<'r>>,
    pub(super) targets: Vec<CodeTarget<'r>>,
    pub(super) targets_by_specifier: FxHashMap<(Atom, CodeImportKind), u32>,
    pub(super) types_answers: Vec<(Atom, ResolutionMode, u32)>,
    pub(super) is_in_types_program: bool,
    pub(super) requests: ImportRequests,
    pub(super) exported_requires: Vec<ExportedRequire>,
}

pub(super) struct ParsedCodeFile<'s, 'r> {
    pub(super) parse: Parse<'s>,
    pub(super) specifies_esm: bool,
    pub(super) code: Box<LoadedCode<'s, 'r>>,
    pub(super) payload: Option<HostPayload>,
}

pub(super) struct CodeEntry<'s, 'r> {
    pub(super) key: LoadKey<'r>,
    pub(super) host_module: Option<HostModuleId>,
    pub(super) role: FileRole,
    pub(super) package_depth: u32,
    pub(super) targets: Vec<u32>,
    pub(super) predicted_type_files: Vec<(&'r [u8], bool)>,
    pub(super) jsdoc_imports: Vec<(Atom, ResolutionMode, FileId)>,
    pub(super) loaded: Guarded<Option<Box<Loaded<'s, 'r>>>>,
    pub(super) code: Guarded<Option<Box<LoadedCode<'s, 'r>>>>,
    pub(super) payload: Option<HostPayload>,
    pub(super) settings: Option<&'s TranspileSettings>,
    pub(super) package: Option<EnclosingPackage<'s>>,
    pub(super) side_effects: DeclaredSideEffects<'s>,
    pub(super) file: Option<FileId>,
}

pub(super) struct CodeFiles<'s, 'r> {
    pub(super) session: &'s Session,
    pub(super) atoms: Interner<'s>,
    pub(super) is_case_sensitive: bool,
    pub(super) entries: Vec<CodeEntry<'s, 'r>>,
    pub(super) entry_points: Vec<u32>,
    pub(super) entry_of_file: Vec<Option<u32>>,
    pub(super) is_in_types_program: Vec<bool>,
    pub(super) typed_files_with_other_code: FxHashSet<Vec<u8>>,
    /// `CodeHost::follows_imports_on_request`
    pub(super) reads_code_on_request: bool,
}

pub(super) type ModuleSlots<'s> = Vec<Option<ArenaBox<'s, Module<'s>>>>;

pub(super) type AddFile<'t, 's> =
    &'t mut dyn FnMut(&[u8], bool, &mut ModuleSlots<'s>, &mut Vec<u32>, &mut Found<'s>) -> FileId;

pub(super) struct RootTables<'t, 's> {
    pub(super) host: &'t dyn Host,
    pub(super) modules: &'t mut ModuleSlots<'s>,
    pub(super) depths: &'t mut Vec<u32>,
    pub(super) found: &'t mut Found<'s>,
    pub(super) queued: &'t mut Vec<(SubTask, u32)>,
    pub(super) root_tasks: &'t mut Vec<Option<FileId>>,
}

pub(super) type BuildFile<'b, 'a, 's, 'r> = (
    Option<&'b CodeLoadContext<'a, 's, 'r>>,
    Option<&'b mut LoadedCode<'s, 'r>>,
);

#[derive(Copy, Clone)]
pub(super) struct TypesQuestion<'q, 's, 'r> {
    pub(super) resolver: &'q Resolver<'r>,
    pub(super) from: &'q [u8],
    pub(super) project: Option<&'s Options>,
}
