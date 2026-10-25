use super::code_barrels::ImportRequests;
use super::projects::Projects;
use super::*;
use crate::file_analysis::FileAnalysis;
use crate::fold::FoldInputs;
use crate::import_sites::{ExportedRequire, JsxMode};
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeHost, CodeImportKind, CodeOptions, CodeResolution, DeclaredSideEffects, EnclosingPackage,
    HostPayload, JsxSettings, ProjectResolvers, SiteResolution, TranspileSettings,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MainModule {
    EntryPoint,
    EntryPointOfProcessOrWorker,
    Elsewhere,
}

pub struct CompileInputs<'a, 's> {
    pub entry_points: &'a [Vec<u8>],
    pub main_module: MainModule,
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

pub(super) struct CodeLoadContext<'a, 's: 'r, 'r> {
    pub(super) session: &'s Session,
    pub(super) host: &'a dyn CodeHost,
    pub(super) inputs: &'a CompileInputs<'a, 's>,
    pub(super) resolver: &'a Resolver<'r>,
    pub(super) options: &'s Options,
    pub(super) atoms: Interner<'s>,
    pub(super) projects: Projects<'s>,
    pub(super) project_resolvers: ProjectResolvers<'r>,
    pub(super) entry_points: Vec<CodeTarget<'r>>,
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
        CodeLoadContext {
            session,
            host: compile.host,
            inputs: compile.inputs,
            resolver,
            options,
            atoms: compile.inputs.atoms,
            projects: Projects::new(session),
            project_resolvers: ProjectResolvers::new(),
            entry_points: entry_points.collect(),
            is_case_sensitive: compile.host.is_case_sensitive(),
        }
    }

    pub(super) fn finish(build: Option<Self>) {
        if let Some(build) = build {
            build.project_resolvers.add_links_to(build.resolver);
        }
    }

    pub(super) fn is_entry_point(&self, key: LoadKey<'_>) -> bool {
        self.entry_points.iter().any(|entry_point| {
            entry_point.key.loader == key.loader
                && is_same_path(entry_point.key.path, key.path, self.is_case_sensitive)
        })
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
}

impl<'r> CodeTarget<'r> {
    pub(super) fn of_path(path: &'r [u8], loader: HostLoader) -> CodeTarget<'r> {
        CodeTarget {
            key: LoadKey { path, loader },
            host_module: None,
            increases_depth: false,
            has_loader_attribute: false,
        }
    }
}

pub(super) struct Analyzed<'s, 'r> {
    pub(super) analysis: FileAnalysis<'s>,
    pub(super) settings: &'r TranspileSettings,
    pub(super) jsx: Option<JsxSettings>,
    pub(super) jsx_mode: JsxMode,
    pub(super) declared_module_type: DeclaredModuleType,
    pub(super) is_package_type_module: bool,
    pub(super) package: Option<EnclosingPackage<'r>>,
    pub(super) side_effects: DeclaredSideEffects<'r>,
    pub(super) is_aot_source: bool,
}

pub(super) struct LoadedCode<'s, 'r> {
    pub(super) analyzed: Analyzed<'s, 'r>,
    pub(super) resolutions: Vec<SiteResolution<'r>>,
    pub(super) implied: Vec<CodeResolution<'r>>,
    pub(super) targets: Vec<CodeTarget<'r>>,
    pub(super) targets_by_specifier: FxHashMap<(Atom, CodeImportKind), u32>,
    pub(super) types_answers: Vec<(Atom, ResolutionMode, u32)>,
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
