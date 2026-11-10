use super::code_barrels::ImportRequests;
use super::projects::Projects;
use super::*;
use crate::file_analysis::FileAnalysis;
use crate::fold::FoldInputs;
use crate::hir_from_data::HostValue;
use crate::import_sites::{ExportedRequire, JsxMode};
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeHost, CodeImportKind, CodeOptions, CodeResolution, DeclaredSideEffects, EnclosingPackage,
    HostPayload, JsxSettings, ProjectResolvers, SiteResolution, TranspileSettings,
};

pub struct CompileInputs<'a, 's> {
    pub entry_points: &'a [Vec<u8>],
    pub finds_entry_points: Option<&'a FindsEntryPoints<'a>>,
    pub code: &'a CodeOptions,
    pub fold: &'a FoldInputs<'s>,
    pub atoms: Interner<'s>,
}

#[derive(Copy, Clone)]
pub(super) struct CompileLoad<'a, 's> {
    pub(super) host: &'a dyn CodeHost,
    pub(super) inputs: &'a CompileInputs<'a, 's>,
}

impl<'s> Files<'s> {
    pub fn load_for_compile(
        session: &'s Session,
        host: &dyn CodeHost,
        options: Options,
        roots: RootFileNames<'_>,
        inputs: &CompileInputs<'_, 's>,
    ) -> Files<'s> {
        let compile = CompileLoad { host, inputs };
        Self::load_with(session, None, host, options, roots, &|_| {}, Some(compile))
    }
}

type LoadsThatNameEntryPoints = FxHashMap<(Vec<u8>, HostLoader), Vec<Option<NamingLoad>>>;

pub(super) struct CodeLoadContext<'a, 's: 'r, 'r> {
    pub(super) session: &'s Session,
    pub(super) host: &'a dyn CodeHost,
    pub(super) inputs: &'a CompileInputs<'a, 's>,
    pub(super) resolver: &'a Resolver<'r>,
    pub(super) options: &'s Options,
    pub(super) atoms: Interner<'s>,
    pub(super) projects: Projects<'s>,
    pub(super) project_resolvers: ProjectResolvers<'r>,
    written_entry_points: Vec<CodeTarget<'r>>,
    keys_of_entry_points: FxHashSet<(Cow<'r, [u8]>, HostLoader)>,
    found_entry_points: Guarded<Vec<CodeTarget<'r>>>,
    keys_of_found_entry_points: Guarded<FxHashSet<(Cow<'r, [u8]>, HostLoader)>>,
    loads_that_name_entry_points: Guarded<LoadsThatNameEntryPoints>,
    entry_points_left_out: Guarded<FxHashSet<(Vec<u8>, HostLoader)>>,
    guesses_held_back: Guarded<(Vec<Vec<u8>>, FxHashSet<Vec<u8>>)>,
    are_guesses_out: Guarded<bool>,
    entry_points_that_run_first: FxHashSet<Vec<u8>>,
    pub(super) is_case_sensitive: bool,
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
        let entry_points_that_run_first = (code.entry_points_that_run_first)
            .iter()
            .map(|path| to_path(path, is_case_sensitive).into_owned())
            .collect();
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
            keys_of_found_entry_points: Guarded::new(FxHashSet::default()),
            loads_that_name_entry_points: Guarded::new(FxHashMap::default()),
            entry_points_left_out: Guarded::new(FxHashSet::default()),
            guesses_held_back: Guarded::new((Vec::new(), FxHashSet::default())),
            are_guesses_out: Guarded::new(false),
            entry_points_that_run_first,
            is_case_sensitive,
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

    pub(super) fn written_entry_point_count(&self) -> usize {
        self.written_entry_points.len()
    }

    pub(super) fn entry_point_count(&self) -> usize {
        self.written_entry_points.len() + self.found_entry_points.lock().len()
    }

    pub(super) fn is_entry_point(&self, key: LoadKey<'_>) -> bool {
        let key = (to_path(key.path, self.is_case_sensitive), key.loader);
        self.keys_of_entry_points.contains(&key)
            || self.keys_of_found_entry_points.lock().contains(&key)
    }

    pub(super) fn add_entry_point(&self, path: &[u8]) -> Option<CodeTarget<'r>> {
        let resolver = self.resolver;
        let request = resolver.loader_request(path, CodeImportKind::EntryPoint, None, None);
        let target = CodeTarget::of_path(resolver.keep(path), self.host.loader_of(&request));
        if self.is_entry_point(target.key) || self.is_left_out(target.key) {
            return None;
        }
        let path = to_path(target.key.path, self.is_case_sensitive);
        (self.keys_of_found_entry_points.lock()).insert((path, target.key.loader));
        self.found_entry_points.lock().push(target);
        Some(target)
    }

    fn is_left_out(&self, key: LoadKey<'_>) -> bool {
        let path = to_path(key.path, self.is_case_sensitive).into_owned();
        (self.entry_points_left_out.lock()).contains(&(path, key.loader))
    }

    pub(super) fn hold_back_guess(&self, path: &[u8]) {
        match *self.are_guesses_out.lock() {
            true => self.leave_out_guess_that_never_entered(path),
            false => {
                let key = to_path(path, self.is_case_sensitive).into_owned();
                let mut held_back = self.guesses_held_back.lock();
                if held_back.1.insert(key) {
                    held_back.0.push(path.to_vec());
                }
            }
        }
    }

    pub(super) fn let_no_guess_in(&self, file_whose_loader_decides_its_kind: Option<&[u8]>) {
        *self.are_guesses_out.lock() = true;
        (self.host).note_guesses_left_out(file_whose_loader_decides_its_kind);
        for loads in self.loads_that_name_entry_points.lock().values_mut() {
            loads.retain(|load| !load.is_some_and(|load| load.may_be_left_out));
        }
        for path in self.take_guesses_held_back() {
            self.leave_out_guess_that_never_entered(&path);
        }
    }

    pub(super) fn holds_back_guesses(&self) -> bool {
        !self.guesses_held_back.lock().1.is_empty()
    }

    pub(super) fn take_guesses_held_back(&self) -> Vec<Vec<u8>> {
        let (in_order, mut held_back) = std::mem::take(&mut *self.guesses_held_back.lock());
        let in_order = in_order.into_iter();
        let is_held_back =
            |path: &Vec<u8>| held_back.remove(&*to_path(path, self.is_case_sensitive));
        in_order.filter(is_held_back).collect()
    }

    fn leave_out_guess_that_never_entered(&self, path: &[u8]) {
        let request = (self.resolver).loader_request(path, CodeImportKind::EntryPoint, None, None);
        let path = to_path(path, self.is_case_sensitive).into_owned();
        let key = (path, self.host.loader_of(&request));
        self.entry_points_left_out.lock().insert(key);
    }

    pub(super) fn bring_back_entry_point(&self, path: &[u8]) -> Option<CodeTarget<'r>> {
        let request = (self.resolver).loader_request(path, CodeImportKind::EntryPoint, None, None);
        let key = (
            to_path(path, self.is_case_sensitive).into_owned(),
            self.host.loader_of(&request),
        );
        let was_held_back = self.guesses_held_back.lock().1.remove(&key.0);
        let was_left_out = self.entry_points_left_out.lock().remove(&key);
        (was_held_back || was_left_out)
            .then(|| self.add_entry_point(path))
            .flatten()
    }

    pub(super) fn leave_out_found_entry_points(&self, keys: &[LoadKey<'_>]) -> bool {
        let mut left_out = self.entry_points_left_out.lock();
        for key in keys {
            let path = to_path(key.path, self.is_case_sensitive).into_owned();
            left_out.insert((path, key.loader));
        }
        let mut found = self.found_entry_points.lock();
        let count = found.len();
        found.retain(|it| {
            let path = to_path(it.key.path, self.is_case_sensitive).into_owned();
            !left_out.contains(&(path, it.key.loader))
        });
        let mut known = self.keys_of_found_entry_points.lock();
        known.retain(|it| !left_out.contains(&(it.0.to_vec(), it.1)));
        found.len() != count
    }

    pub(super) fn drop_found_entry_point(&self, path: &[u8]) -> Option<CodeTarget<'r>> {
        let mut found = self.found_entry_points.lock();
        let place = found.iter().position(|it| it.key.path == path)?;
        let dropped = found.remove(place);
        let key = to_path(dropped.key.path, self.is_case_sensitive);
        let mut keys = self.keys_of_found_entry_points.lock();
        keys.retain(|it| it.0 != key || it.1 != dropped.key.loader);
        Some(dropped)
    }

    pub(super) fn note_load_that_names(&self, path: &[u8], load: Option<NamingLoad>) -> bool {
        if load.is_some_and(|load| load.may_be_left_out) && *self.are_guesses_out.lock() {
            return false;
        }
        let request = (self.resolver).loader_request(path, CodeImportKind::EntryPoint, None, None);
        let path = to_path(path, self.is_case_sensitive).into_owned();
        let mut named_by = self.loads_that_name_entry_points.lock();
        let loads = named_by
            .entry((path, self.host.loader_of(&request)))
            .or_default();
        let is_new = !loads.contains(&load);
        if is_new {
            loads.push(load);
        }
        is_new
    }

    pub(super) fn is_mere_guess(&self, key: LoadKey<'_>) -> bool {
        self.loads_that_alone_name(key)
            .is_some_and(|loads| !loads.is_empty() && loads.iter().all(|load| load.may_be_left_out))
    }

    pub(super) fn loads_that_alone_name(&self, key: LoadKey<'_>) -> Option<Vec<NamingLoad>> {
        let path = to_path(key.path, self.is_case_sensitive);
        if (self.keys_of_entry_points).contains(&(path.clone(), key.loader)) {
            return None;
        }
        let named_by = self.loads_that_name_entry_points.lock();
        let loads = named_by.get(&(path.into_owned(), key.loader))?;
        loads.iter().copied().collect()
    }

    pub(super) fn runs_first(&self, key: LoadKey<'_>) -> bool {
        let path = to_path(key.path, self.is_case_sensitive);
        self.entry_points_that_run_first.contains(&*path)
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
    pub(super) is_linked_by_bundler: bool,
    pub(super) is_loaded_with_importer: bool,
    pub(super) has_shared_type: bool,
    pub(super) has_type_of_shared_kind: bool,
}

impl<'r> CodeTarget<'r> {
    pub(super) fn of_path(path: &'r [u8], loader: HostLoader) -> CodeTarget<'r> {
        CodeTarget {
            key: LoadKey { path, loader },
            host_module: None,
            increases_depth: false,
            has_loader_attribute: false,
            is_linked_by_bundler: false,
            is_loaded_with_importer: false,
            has_shared_type: false,
            has_type_of_shared_kind: false,
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
    pub(super) type_where_imported: DeclaredModuleType,
    pub(super) runs_inside_require: bool,
    pub(super) is_package_type_module: bool,
    pub(super) package: Option<EnclosingPackage<'r>>,
    pub(super) side_effects: DeclaredSideEffects<'r>,
    pub(super) is_aot_source: bool,
    pub(super) import_meta_main: Option<bool>,
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
