use bun_builtin_sources::Manifest;
use bun_sema::atom::Interner;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{
    CodeFile, CodeResolution, ComputedCandidate, ComputedResolution, ParsedFile, SiteResolution,
};
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};

use super::{Application, KnownRegions, Library, LibraryTree, ReachInput, SiteTarget, Walk};
use crate::builtins::{BuiltinNames, Platforms, RuntimeFunction, RuntimeModule, RuntimeUses};
use crate::ir::InParallel;
use crate::load::runtime_modules::{RuntimeFileKind, RuntimeModules};
use crate::load::sources::{ParsedSource, SourceKind, find_runtime_function};
use crate::modules::ModuleRef;

/// Decides which of Bun's own files a load reads: those that code asks for which the program can run.
pub(crate) struct ReachWhileLoading<'a> {
    /// `Application::Asks`
    pub asks: &'a RuntimeUses,
    state: Guarded<State>,
    function_files: Guarded<FxHashMap<RuntimeFunction, Option<FileId>>>,
}

#[derive(Default)]
struct State {
    known: KnownRegions,
    /// The imports that the load was told of, each with the version of the file that imports.
    told: FxHashSet<(FileId, u32, FileId)>,
}

pub(crate) struct LoadInput<'a> {
    pub runtime_modules: &'a RuntimeModules,
    pub manifest: &'static Manifest,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
}

// A file is known by its number among all of Bun's own files, read or not.
struct FilesBeingLoaded<'a, 's> {
    runtime_modules: &'a RuntimeModules,
    manifest: &'static Manifest,
    atoms: &'a Interner<'s>,
    files: &'a [ParsedFile<'a, 's>],
    positions: Vec<Option<u32>>,
    code_files: Vec<FileId>,
    function_files: &'a Guarded<FxHashMap<RuntimeFunction, Option<FileId>>>,
}

impl<'a, 's> FilesBeingLoaded<'a, 's> {
    fn parsed(&self, file: FileId) -> Option<&'a ParsedFile<'a, 's>> {
        Some(&self.files[self.positions[file.idx()]? as usize])
    }

    fn file_at(&self, path: &[u8]) -> Option<FileId> {
        self.runtime_modules.number_of(path).map(FileId)
    }

    fn kind_of(&self, file: FileId) -> Option<RuntimeFileKind> {
        (self.runtime_modules).file_kind(self.runtime_modules.path_of(file.0))
    }

    fn module_at(&self, file: CodeFile<'_>) -> Option<ModuleRef> {
        self.file_at(file.path).map(ModuleRef::File)
    }

    fn module_of_resolution(&self, resolution: CodeResolution<'_>) -> Option<ModuleRef> {
        match resolution {
            CodeResolution::File(file) => self.module_at(file),
            CodeResolution::HostModule(id) => {
                RuntimeModule::from_registry_id(id.0).map(ModuleRef::Runtime)
            }
            CodeResolution::External { .. }
            | CodeResolution::Erased
            | CodeResolution::NotFound(_) => None,
        }
    }
}

impl<'s> Library<'s> for FilesBeingLoaded<'_, 's> {
    fn file_count(&self) -> usize {
        self.positions.len()
    }

    fn code_files(&self) -> &[FileId] {
        &self.code_files
    }

    fn atoms(&self) -> &Interner<'s> {
        self.atoms
    }

    fn tree(&self, file: FileId) -> Option<LibraryTree<'_, 's>> {
        let parsed = self.parsed(file)?;
        Some(LibraryTree {
            hir: parsed.file.hir,
            bound: parsed.file.bound,
            analysis: parsed.file.analysis,
            source: parsed
                .payload
                .and_then(|it| it.downcast_ref::<ParsedSource>()),
        })
    }

    fn version(&self, file: FileId) -> u32 {
        self.parsed(file).map_or(0, |parsed| parsed.version)
    }

    fn kind(&self, file: FileId) -> SourceKind {
        match self.kind_of(file) {
            Some(RuntimeFileKind::Module(module)) => SourceKind::RuntimeModule(module),
            Some(RuntimeFileKind::Functions) => SourceKind::RuntimeFunctions,
            Some(RuntimeFileKind::Declarations | RuntimeFileKind::Configuration) | None => {
                SourceKind::TypesOnly
            }
        }
    }

    fn find_site_target(&self, file: FileId, site: ImportSiteKind) -> Option<SiteTarget> {
        let parsed = &self.parsed(file)?.file;
        let mut sites = parsed.analysis.import_sites.iter();
        let index = sites.position(|it| it.kind == site)?;
        Some(match parsed.resolutions[index] {
            SiteResolution::Constant(resolution) => match self.module_of_resolution(resolution) {
                Some(module) => SiteTarget::Module(module),
                None => SiteTarget::Nothing,
            },
            SiteResolution::Computed(ComputedResolution::All { .. }) => SiteTarget::AnyModule,
            SiteResolution::Computed(ComputedResolution::Candidates { candidates, .. }) => {
                let modules = candidates.iter().filter_map(|candidate| match *candidate {
                    ComputedCandidate::File(file) => self.module_at(file),
                    ComputedCandidate::HostModule(id) => {
                        RuntimeModule::from_registry_id(id.0).map(ModuleRef::Runtime)
                    }
                });
                SiteTarget::OneOf(modules.collect())
            }
        })
    }

    fn find_module_file(&self, module: RuntimeModule) -> Option<FileId> {
        self.file_at(self.runtime_modules.module_path(module)?)
    }

    fn find_function_file(&self, function: RuntimeFunction) -> Option<FileId> {
        let mut known = self.function_files.lock();
        *known
            .entry(function)
            .or_insert_with(|| self.file_at(&self.runtime_modules.function_file_path(function)?))
    }

    fn runtime_module(&self, file: FileId) -> Option<RuntimeModule> {
        match self.kind_of(file)? {
            RuntimeFileKind::Module(module) => Some(module),
            _ => None,
        }
    }

    fn runtime_function(&self, file: FileId, export_name: &[u8]) -> Option<RuntimeFunction> {
        let path = self.runtime_modules.path_of(file.0);
        find_runtime_function(self.manifest, path, export_name)
    }
}

impl<'a> ReachWhileLoading<'a> {
    /// What the walks of the load have read off the files of the program that it has made. `is_last_asked`: nobody asks again.
    pub(crate) fn known_regions(
        &self,
        runtime_modules: &RuntimeModules,
        files: &Files<'_>,
        is_last_asked: bool,
    ) -> KnownRegions {
        let find = |file: FileId| files.by_path.get(runtime_modules.path_of(file.0));
        let mut state = self.state.lock();
        let known = state.known.renumbered(&find);
        if is_last_asked {
            *state = State::default();
        }
        known
    }

    pub(crate) fn new(asks: &'a RuntimeUses) -> Self {
        ReachWhileLoading {
            asks,
            state: Guarded::new(State::default()),
            function_files: Guarded::default(),
        }
    }

    /// `CodeHost::choose_imports_to_follow`. What code asks for and no import of its file leads to is not read for that code, as where
    /// every import is followed.
    pub(crate) fn choose_imports(
        &self,
        input: &LoadInput<'_>,
        files: &[ParsedFile<'_, '_>],
        in_parallel: InParallel<'_>,
    ) -> Vec<(u32, Vec<u8>)> {
        let Some(first) = files.first() else {
            return Vec::new();
        };
        let runtime_modules = input.runtime_modules;
        let mut positions = vec![None; runtime_modules.file_count()];
        for (position, file) in (0u32..).zip(files) {
            if let Some(number) = runtime_modules.number_of(file.file.path) {
                positions[number as usize] = Some(position);
            }
        }
        let numbers = (0u32..).zip(&positions);
        let code_files = numbers.filter_map(|(number, position)| position.map(|_| FileId(number)));
        let library = FilesBeingLoaded {
            runtime_modules,
            manifest: input.manifest,
            atoms: first.file.atoms,
            files,
            code_files: code_files.collect(),
            positions,
            function_files: &self.function_files,
        };
        let reach_input = ReachInput {
            application: Application::Asks(self.asks),
            library: &library,
            names: input.names,
            platform: input.platform,
            can_load_code_at_run_time: false,
            further: &RuntimeUses::default(),
            keeps_code_without_names: false,
            holds_guessed_code: false,
        };
        let mut state = self.state.lock();
        let State { known, told } = &mut *state;
        let mut walk = Walk::new(&reach_input, Some(known));
        walk.notes_imports = true;
        walk.run(in_parallel);
        let mut imports = walk.imports;
        imports.retain(|&(importer, imported)| {
            told.insert((importer, library.version(importer), imported))
        });
        imports.sort_unstable();
        imports
            .into_iter()
            .filter_map(|(importer, imported)| {
                let path = runtime_modules.path_of(imported.0).to_vec();
                Some((library.positions[importer.idx()]?, path))
            })
            .collect()
    }
}
