#[cfg(test)]
mod tests;

use super::bindings::{ModuleRequest, SpelledModule};
use super::exports::ExportTables;
use super::failures::{
    FailureEffect, FailureOrder, ModuleFailureKind, NumberedFailures, PendingFailure, SitePart,
    WrittenPart,
};
use super::graph::StoredSiteAnswer;
use super::interop::{ImportPhase, Interop, ModuleKind, file_interop};
use super::module_set::ModuleSet;
use super::order::{EvaluationOrder, PlannedSites};
use super::{BindInput, ModuleRef};
use crate::builtins::{RuntimeModule, table};
use crate::diagnostics::{Span, range_of_node};
use crate::ir::for_each_mut;
use crate::load::Sources;
use crate::load::named_loads::{
    NamedModule, is_followed_further_than_bundler, is_path_that_program_may_write,
    modules_named_in, names_plugin,
};
use crate::load::sources::{SourceKind, parsed_source};
use crate::options::ReplacedModule;
use crate::statistics::ComputedImport;
use bun_core::strings;
use bun_resolve_builtins::Alias;
use bun_sema::atom::Atom;
use bun_sema::components::strongly_connected_components;
use bun_sema::hir::{self, ExportId, ImportId, NodeData, StmtId, StmtKind};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, is_module_call_of_plugin,
    is_name_read_by_transpiler,
};
use bun_sema::program::{
    CodeAnswer, CompiledModule, ComputedTarget, ComputedTargets, FileId, Files,
};
use bun_sema::resolve::{CodeFailure, ExternalKind};
use bun_sema::util::{FxHashMap, FxHashSet};
use core::ops::Range;
use std::collections::hash_map::Entry;

const MAX_SCANNED_REQUESTS: usize = 16;

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum ScannedSite {
    Module(ModuleRef),
    Unresolved,
    AllModules,
    /// A range of `FileScan::spellings`.
    Candidates(Range<u32>),
    Erased,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct RequestDraft {
    pub target: ModuleRef,
    pub phase: ImportPhase,
    pub is_star_export: bool,
}

pub(super) struct FileScan {
    pub interop: Interop,
    pub sites: Vec<ScannedSite>,
    pub candidates: Vec<ModuleRef>,
    pub spellings: Vec<SpelledModule>,
    pub externals: Vec<(Atom, ExternalKind)>,
    /// The compiled files behind specifiers that the loader of the run time answers for: `leave_imports_of_test_files_to_loader`.
    pub left_to_loader: Vec<(Atom, FileId)>,
    pub requests: Vec<RequestDraft>,
    pub failures: Vec<PendingFailure>,
    pub computed_imports: Vec<ComputedImport<Span>>,
}

impl FileScan {
    /// What a site that is `ScannedSite::Candidates` may name.
    pub(super) fn modules_spelled_in(&self, range: &Range<u32>) -> impl Iterator<Item = ModuleRef> {
        let spelled = &self.spellings[range.start as usize..range.end as usize];
        spelled.iter().map(|spelled| spelled.module)
    }
}

pub(super) struct Scans {
    by_file: Vec<Option<FileScan>>,
}

impl Scans {
    pub(super) fn of(&self, file: FileId) -> &FileScan {
        self.find(file).expect("a file the loader did not compile")
    }

    pub(super) fn find(&self, file: FileId) -> Option<&FileScan> {
        self.by_file[file.idx()].as_ref()
    }

    pub(super) fn find_mut(&mut self, file: FileId) -> Option<&mut FileScan> {
        self.by_file[file.idx()].as_mut()
    }
}

/// A plugin answers for the whole program, so a package's own program goes by the application's word.
pub(super) fn program_names_plugin(input: &BindInput<'_, '_>) -> bool {
    match input.application {
        Some(application) => application.graph.names_plugin(),
        None => names_plugin(input.files),
    }
}

pub(super) fn scan_files(input: &BindInput<'_, '_>) -> Scans {
    let (files, sources) = (input.files, input.sources);
    let compiled_files = files.compiled_files().iter();
    let mut slots: Vec<(FileId, Option<FileScan>)> =
        compiled_files.map(|&file| (file, None)).collect();
    let mut mocked_paths = find_paths_only_mocks_answer(files, sources);
    // The test file that holds the mock may lie in another program than the file that imports the name.
    let told = input.mocked_modules.iter();
    mocked_paths.extend(told.filter_map(ReplacedModule::file_path).cloned());
    let names_plugin = program_names_plugin(input);
    let program = Program {
        runs_tests: input.runs_tests,
        loads_code_from_disk: input.loads_code_from_disk,
        mocks_any_module: input.mocks_any_module,
        asks_loader_where_bundler_does: !input.runs_tests && names_plugin,
        asks_loader_for_names_not_found: input.runs_tests && names_plugin,
    };
    for_each_mut(&mut slots, input.in_parallel, &|(file, scan)| {
        *scan = Some(scan_file(files, sources, &mocked_paths, program, *file));
    });
    let mut by_file = Vec::new();
    by_file.resize_with(files.modules.len(), || None);
    for (file, scan) in slots {
        by_file[file.idx()] = scan;
    }
    Scans { by_file }
}

/// The runner starts a test file after the test files before it, and one of those may have taken a file out of `require.cache`. An import statement
/// is bound to the instance that the loader holds when the importer is linked: behind `delete require.cache[path]` that is one from disk, and code that reads the
/// variables of the compiled instance would see another module than `require(path)` answers. So the loader of the run time links such a statement of a test file,
/// as it links an import of code that the build has not seen. It answers with the compiled module as long as nothing has taken that out.
/// Modules on a cycle are linked together: by the time one of them can be taken out, the test file is bound to it.
/// Returns whether there is such a statement.
pub(super) fn leave_imports_of_test_files_to_loader(
    input: &BindInput<'_, '_>,
    scans: &mut Scans,
    may_load_again: &dyn Fn(FileId) -> bool,
) -> bool {
    struct Statement {
        importer: FileId,
        site: usize,
        specifier: Atom,
        type_attribute: Option<bun_ast::Loader>,
        target: FileId,
    }
    // The entry points of a program that test files are built upon are all of its files.
    if input.application.is_none() && !input.runner_starts_entry_points {
        return false;
    }
    // A test file under a tsconfig.json of its own is lowered as a program of its own, by the application's word: both have to say the same of each statement.
    let is_left = |importer: FileId, specifier: Atom, target: FileId| match input.application {
        Some(application) => (application.to_application)(importer).is_some_and(|file| {
            application
                .graph
                .leaves_statement_to_loader(file, specifier)
        }),
        None => may_load_again(target),
    };
    let mut statements = Vec::new();
    for &importer in input.files.entry_points() {
        let Some(scan) = scans.find(importer) else {
            continue;
        };
        let sites = input.files.analysis(importer).import_sites.iter();
        for (index, (site, answer)) in sites.zip(&scan.sites).enumerate() {
            let is_statement = matches!(site_form(site.kind), SiteForm::Declaration);
            if let (
                true,
                ImportSpecifier::Constant(specifier),
                &ScannedSite::Module(ModuleRef::File(target)),
            ) = (is_statement, site.specifier, answer)
                && is_left(importer, specifier, target)
            {
                let hir = input.files.hir(importer);
                statements.push(Statement {
                    importer,
                    site: index,
                    specifier,
                    type_attribute: find_type_attribute(input.files, hir, site),
                    target,
                });
            }
        }
    }
    if statements.is_empty() {
        return false;
    }
    let imported_files = |file: u32| -> Vec<u32> {
        let requests = scans
            .find(FileId(file))
            .map_or(&[][..], |scan| &scan.requests);
        let files = requests.iter().filter_map(|request| match request.target {
            ModuleRef::File(target) => Some(target.0),
            _ => None,
        });
        files.collect()
    };
    let edges: Vec<Vec<u32>> = (0..input.files.modules.len() as u32)
        .map(imported_files)
        .collect();
    let (cycle_of, _) = strongly_connected_components(&edges);
    statements.retain(|it| cycle_of[it.importer.idx()] != cycle_of[it.target.idx()]);
    let mut first_statements: FxHashMap<(FileId, FileId), ModuleRef> = FxHashMap::default();
    for statement in &statements {
        let &Statement {
            importer,
            site,
            specifier,
            type_attribute,
            target,
        } = statement;
        let scan = scans.find_mut(importer).expect("the file was scanned");
        // The loader has one module under two spellings of its path, and under two types: `with { type: "yaml" }` and `with { type: "text" }` of one
        // file get what the first of them loaded. So has the importer: the first statement stands for all.
        let first = first_statements.entry((importer, target));
        let is_new = matches!(first, Entry::Vacant(_));
        let left = *first.or_insert(ModuleRef::External {
            importer,
            specifier,
            type_attribute,
        });
        scan.sites[site] = ScannedSite::Module(left);
        if !scan.left_to_loader.contains(&(specifier, target)) {
            scan.left_to_loader.push((specifier, target));
        }
        if !is_new {
            continue;
        }
        for request in &mut scan.requests {
            if request.target == ModuleRef::File(target) {
                request.target = left;
            }
        }
        scan.externals
            .push((specifier, ExternalKind::UncompiledCode));
    }
    !statements.is_empty()
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Spelling {
    WithoutExtension,
    UnderAnotherExtension,
    AsFolder,
}

fn without_extension_of_file(path: &[u8]) -> &[u8] {
    let start_of_name = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
    match strings::last_index_of_char(path, b'.') {
        Some(dot) if dot > start_of_name => &path[..dot],
        _ => path,
    }
}

pub(super) fn find_spelling(
    sources: &Sources,
    importer: FileId,
    specifier: &[u8],
    target: FileId,
) -> Option<Spelling> {
    if !specifier.starts_with(b"./") && !specifier.starts_with(b"../") {
        return None;
    }
    let written = path_named(sources, importer, specifier);
    let path = sources.public_path(target);
    let folder = strings::last_index_of_char(path, b'/').map(|slash| &path[..slash]);
    match &written[..] {
        written if written == path => None,
        written if written == without_extension_of_file(path) => Some(Spelling::WithoutExtension),
        written if Some(written) == folder => Some(Spelling::AsFolder),
        written if without_extension_of_file(written) == without_extension_of_file(path) => {
            Some(Spelling::UnderAnotherExtension)
        }
        _ => None,
    }
}

// What `specifier` names from the file: the path of a relative one, else its text.
fn path_named(sources: &Sources, file: FileId, specifier: &[u8]) -> Vec<u8> {
    // `mock.module("file:./a.ts", ..)`
    let specifier = match specifier.strip_prefix(b"file:") {
        Some(path) if path.starts_with(b"./") || path.starts_with(b"../") => path,
        _ => specifier,
    };
    if !specifier.starts_with(b"./") && !specifier.starts_with(b"../") {
        return specifier.to_vec();
    }
    let importer = sources.public_path(file);
    let end_of_folder = strings::last_index_of_char(importer, b'/').unwrap_or(0);
    let mut parts: Vec<&[u8]> = strings::split(&importer[..end_of_folder], b"/").collect();
    for part in strings::split(specifier, b"/") {
        match part {
            b"." => {}
            b".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join(&b'/')
}

// A test may mock a module that exists nowhere. Whoever imports that path gets the mock from the loader at run time.
// `build.module("dep", ..)` in the `setup` of a plugin: from then on the loader answers for the name as it is written, also where a package has the name.
fn find_paths_only_mocks_answer(files: &Files<'_>, sources: &Sources) -> FxHashSet<Vec<u8>> {
    let mut paths = FxHashSet::default();
    for &file in files.compiled_files() {
        let Some(compiled) = files.compiled(file) else {
            continue;
        };
        let sites = compiled.analysis.import_sites.iter();
        for (site, answer) in sites.zip(compiled.code_answers) {
            if let (ImportSiteKind::MockModule(call), ImportSpecifier::Constant(specifier)) =
                (site.kind, site.specifier)
                && (matches!(answer, CodeAnswer::NotFound(_))
                    || is_module_call_of_plugin(files.hir(file), files.bound(file), call))
            {
                paths.insert(path_named(sources, file, files.atoms.bytes(specifier)));
            }
        }
    }
    paths
}

#[derive(Copy, Clone)]
struct Program {
    runs_tests: bool,
    loads_code_from_disk: bool,
    mocks_any_module: bool,
    asks_loader_where_bundler_does: bool,
    asks_loader_for_names_not_found: bool,
}

fn scan_file(
    files: &Files<'_>,
    sources: &Sources,
    mocked_paths: &FxHashSet<Vec<u8>>,
    program: Program,
    file: FileId,
) -> FileScan {
    let compiled = files.compiled(file);
    let mut scanner = FileScanner {
        file,
        files,
        sources,
        mocked_paths,
        runs_tests: program.runs_tests,
        loads_code_from_disk: program.loads_code_from_disk,
        mocks_any_module: program.mocks_any_module,
        asks_loader_where_bundler_does: program.asks_loader_where_bundler_does,
        asks_loader_for_names_not_found: program.asks_loader_for_names_not_found,
        hir: files.hir(file),
        compiled: compiled.expect("the loader analyzes every compiled file"),
        named_in_choices: parsed_source(files, file)
            .map_or(&[][..], |source| source.named_modules()),
        candidates: Vec::new(),
        spellings: Vec::new(),
        externals: Vec::new(),
        failures: Vec::new(),
        computed_imports: Vec::new(),
    };
    let sites = scanner.scan_sites();
    if parsed_source(files, file).is_some_and(|source| source.parse_failure.is_some()) {
        debug_assert!(sites.is_empty());
        let site = ImportSiteKind::ExportFrom(ExportId(0));
        let kind = ModuleFailureKind::NotAProgram {
            is_loaded_at_start: true,
            is_silent: false,
        };
        let written = WrittenPart::new(0, SitePart::Specifier, site, 0..0);
        scanner.failures.push(written.fail(file, kind));
    }
    let named = scanner.named_in_choices.iter();
    let named_modules = named.map(|it| ModuleRef::Runtime(it.module));
    scanner.candidates.extend(named_modules);
    let interop = file_interop(files, sources, file);
    let mut requests = match interop.kind {
        ModuleKind::SourceText => scanner.collect_requests(&sites),
        _ => Vec::new(),
    };
    for request in &mut requests {
        if let ModuleRef::File(target) = request.target {
            request.phase = phase_towards(file_interop(files, sources, target).kind, request.phase);
        }
    }
    FileScan {
        interop,
        sites,
        candidates: scanner.candidates,
        spellings: scanner.spellings,
        externals: scanner.externals,
        left_to_loader: Vec::new(),
        requests,
        failures: scanner.failures,
        computed_imports: scanner.computed_imports,
    }
}

struct FileScanner<'a, 's> {
    file: FileId,
    files: &'a Files<'s>,
    sources: &'a Sources,
    mocked_paths: &'a FxHashSet<Vec<u8>>,
    runs_tests: bool,
    loads_code_from_disk: bool,
    mocks_any_module: bool,
    asks_loader_where_bundler_does: bool,
    asks_loader_for_names_not_found: bool,
    hir: &'a hir::File<'s>,
    compiled: &'a CompiledModule<'s>,
    named_in_choices: &'a [NamedModule],
    candidates: Vec<ModuleRef>,
    spellings: Vec<SpelledModule>,
    externals: Vec<(Atom, ExternalKind)>,
    failures: Vec<PendingFailure>,
    computed_imports: Vec<ComputedImport<Span>>,
}

impl FileScanner<'_, '_> {
    fn scan_sites(&mut self) -> Vec<ScannedSite> {
        let sites = self.compiled.analysis.import_sites;
        let answers = self.compiled.code_answers;
        debug_assert_eq!(sites.len(), answers.len());
        let answered_sites = sites.iter().zip(answers).zip(0..);
        answered_sites
            .map(|((site, &answer), index)| self.scan_site(index, site, answer))
            .collect()
    }

    fn scan_site(&mut self, index: u32, site: &ImportSite, answer: CodeAnswer<'_>) -> ScannedSite {
        if self.asks_loader_where_bundler_does
            && is_followed_further_than_bundler(self.files, self.file, site)
            && let Some(scanned) = self.leave_site_to_loader(answer)
        {
            return scanned;
        }
        match site.specifier {
            ImportSpecifier::Constant(specifier) => {
                let scanned = self.scan_constant_site(index, site, specifier, answer);
                self.with_type_attribute(site, scanned)
            }
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => self.scan_computed_site(site, answer),
        }
    }

    // No spelling: the call asks the loader whatever the name is.
    // The loader finds an entry point and no other file with code: where the build has not made the file one, the call stays linked.
    fn leave_site_to_loader(&mut self, answer: CodeAnswer<'_>) -> Option<ScannedSite> {
        let CodeAnswer::File(target) = answer else {
            return None;
        };
        let is_found_by_loader = match self.sources.kind(target) {
            SourceKind::Program => self.files.entry_points().contains(&target),
            SourceKind::Data => true,
            _ => false,
        };
        if !is_found_by_loader {
            return None;
        }
        self.candidates.push(ModuleRef::File(target));
        let at = self.spellings.len() as u32;
        Some(ScannedSite::Candidates(at..at))
    }

    // `import data from "./data.txt" with { type: "toml" }` of a file outside the program. `bun run` hands the loader the types that it knows, of import statements alone.
    // An import() hands over its options when it runs.
    fn with_type_attribute(&self, site: &ImportSite, scanned: ScannedSite) -> ScannedSite {
        let ScannedSite::Module(ModuleRef::External {
            importer,
            specifier,
            ..
        }) = scanned
        else {
            return scanned;
        };
        ScannedSite::Module(ModuleRef::External {
            importer,
            specifier,
            type_attribute: find_type_attribute(self.files, self.hir, site),
        })
    }

    fn scan_computed_site(&mut self, site: &ImportSite, answer: CodeAnswer<'_>) -> ScannedSite {
        let targets = match answer {
            CodeAnswer::Computed(targets) => targets,
            _ => {
                debug_assert!(false, "a computed specifier has a computed answer");
                return ScannedSite::AllModules;
            }
        };
        match targets {
            ComputedTargets::Modules {
                files,
                host_modules,
                spellings,
            } => {
                if !files.is_empty() {
                    let node = diagnostic_node(self.hir, site);
                    let texts = files
                        .iter()
                        .map(|&file| self.files.hir(file).text.len() as u64);
                    self.computed_imports.push(ComputedImport {
                        site: Span::of_node(self.hir, self.file, node),
                        files: files.len() as u32,
                        bytes: texts.sum(),
                    });
                }
                let files = files.iter().map(|&file| ModuleRef::File(file));
                self.candidates.extend(files);
                let runtime_modules = host_modules
                    .iter()
                    .filter_map(|id| RuntimeModule::from_registry_id(id.0));
                self.candidates
                    .extend(runtime_modules.map(ModuleRef::Runtime));
                let start = self.spellings.len() as u32;
                // A value that stands in no list is resolved when the call runs.
                let spelled: Vec<SpelledModule> = (spellings.iter())
                    .filter(|(spelling, _)| !self.is_package_that_loader_answers_for(*spelling))
                    .filter_map(find_spelled_module)
                    .collect();
                self.spellings.extend(spelled);
                self.add_spellings_named_in(site, start);
                ScannedSite::Candidates(start..self.spellings.len() as u32)
            }
            ComputedTargets::All { .. } => {
                let start = self.spellings.len() as u32;
                self.add_spellings_named_in(site, start);
                match self.spellings.len() as u32 {
                    end if end == start => ScannedSite::AllModules,
                    end => ScannedSite::Candidates(start..end),
                }
            }
        }
    }

    /// The spellings of the site begin at `start`. Each stands there once.
    fn add_spellings_named_in(&mut self, site: &ImportSite, start: u32) {
        let (bound, decisions) = (
            self.files.bound(self.file),
            &self.compiled.analysis.decisions,
        );
        let is_read = is_name_read_by_transpiler(self.hir, bound, decisions, site.kind);
        for named in modules_named_in(self.named_in_choices, site.specifier_node) {
            // `import.meta.require(quiet ? "bun:os" : "bun:fs")` asks the loader, which knows neither.
            let name = self.files.atoms.bytes(named.name);
            if !is_read && Alias::bun_prefixed_builtin(name).is_some() {
                continue;
            }
            let mut spelled = self.spellings[start as usize..].iter();
            if !spelled.any(|it| it.spelling == named.name) {
                self.spellings.push(SpelledModule {
                    spelling: named.name,
                    module: ModuleRef::Runtime(named.module),
                });
            }
        }
    }

    fn scan_constant_site(
        &mut self,
        index: u32,
        site: &ImportSite,
        specifier: Atom,
        answer: CodeAnswer<'_>,
    ) -> ScannedSite {
        // Which of the two answers shows when the file is linked or the call runs, so the loader of the run time is asked. It finds the file of the package in its image.
        if matches!(site_form(site.kind), SiteForm::Declaration | SiteForm::Load)
            && matches!(answer, CodeAnswer::File(_) | CodeAnswer::External { .. })
            && self.is_package_that_loader_answers_for(specifier)
        {
            self.externals
                .push((specifier, ExternalKind::UncompiledCode));
            return ScannedSite::Module(ModuleRef::External {
                importer: self.file,
                specifier,
                type_attribute: None,
            });
        }
        let reason = match (self.answer_of(answer), site_form(site.kind)) {
            (Ok(ScannedSite::Erased) | Err(CodeFailure::ModuleNotFound), SiteForm::Load)
                if self.may_be_written_by_program(site, specifier) =>
            {
                self.externals
                    .push((specifier, ExternalKind::UncompiledCode));
                return ScannedSite::Module(ModuleRef::External {
                    importer: self.file,
                    specifier,
                    type_attribute: None,
                });
            }
            (Err(CodeFailure::ModuleNotFound), SiteForm::Declaration)
                if self.may_be_written_by_program(site, specifier) =>
            {
                self.externals
                    .push((specifier, ExternalKind::UncompiledCode));
                return ScannedSite::Module(ModuleRef::External {
                    importer: self.file,
                    specifier,
                    type_attribute: None,
                });
            }
            (Ok(ScannedSite::Erased), SiteForm::Load) => CodeFailure::ModuleNotFound,
            (Ok(ScannedSite::Erased), SiteForm::Declaration) if is_jsx_site(site.kind) => {
                CodeFailure::ModuleNotFound
            }
            (Ok(ScannedSite::Erased) | Err(_), SiteForm::Resolve) => {
                return ScannedSite::AllModules;
            }
            // A test may mock a module that no file stands for.
            (Err(_), SiteForm::GetBuiltinModule | SiteForm::Mock) => return ScannedSite::Erased,
            // It answers with the modules of the registry, and none of those is an ES module.
            (Ok(ScannedSite::Module(ModuleRef::Runtime(module))), SiteForm::GetBuiltinModule)
                if table::is_es_module(module) =>
            {
                return ScannedSite::Erased;
            }
            (
                Ok(answer),
                SiteForm::Declaration
                | SiteForm::Load
                | SiteForm::Resolve
                | SiteForm::GetBuiltinModule
                | SiteForm::Mock,
            ) => return answer,
            // `virtual:config`: no file and no package has such a name, so only a plugin answers for it, and a preload or a test may bring one. The loader of the run time is asked. A name that may be a package stays a failure: code that nobody has seen costs the whole program, and an optional dependency that is absent is common.
            // Not so in a test run that names `Bun.plugin`: `onResolve({ filter: /^aliased$/ }, ..)` answers for any name, and what a plugin loads is code that nobody has seen.
            (Err(_), SiteForm::Declaration | SiteForm::Load)
                if (self.runs_tests && self.has_scheme_of_its_own(specifier))
                    || self.asks_loader_for_names_not_found
                    || (!self.mocked_paths.is_empty() && self.is_answered_by_mock(specifier))
                    || self.may_be_answered_by_mock_out_of_sight() =>
            {
                let kind = ExternalKind::UncompiledCode;
                self.externals.push((specifier, kind));
                return ScannedSite::Module(ModuleRef::External {
                    importer: self.file,
                    specifier,
                    type_attribute: None,
                });
            }
            (Err(reason), SiteForm::Declaration | SiteForm::Load) => reason,
        };
        let (start, end) = range_of_node(self.hir, diagnostic_node(self.hir, site));
        let written = WrittenPart::new(index as usize, SitePart::Specifier, site.kind, start..end);
        let kind = ModuleFailureKind::Unresolved { specifier, reason };
        self.failures.push(written.fail(self.file, kind));
        ScannedSite::Unresolved
    }

    // `writeFileSync(join(import.meta.dirname, "made.mjs"), text); await import(join(import.meta.dirname, "made.mjs"))`: the build knows the path, and the file is not
    // there yet. The loader of the run time is asked when the call runs, and fails as in plain Bun where the file is still missing.
    fn may_be_written_by_program(&self, site: &ImportSite, specifier: Atom) -> bool {
        let specifier = self.files.atoms.bytes(specifier);
        let is_asked_behind_other_code = match site.kind {
            ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_) => true,
            // A test file is loaded behind the test files in front of it, and what one of those writes is there by then.
            ImportSiteKind::Import(_)
            | ImportSiteKind::ExportFrom(_)
            | ImportSiteKind::ExportStar(_) => self.runs_tests,
            _ => false,
        };
        self.loads_code_from_disk
            && is_asked_behind_other_code
            && is_path_that_program_may_write(self.sources.public_path(self.file), specifier)
    }

    fn has_scheme_of_its_own(&self, specifier: Atom) -> bool {
        let specifier = self.files.atoms.bytes(specifier);
        let Some(colon) = strings::index_of_char_usize(specifier, b':') else {
            return false;
        };
        let scheme = &specifier[..colon];
        // One letter is a drive.
        scheme.len() > 1
            && scheme[0].is_ascii_alphabetic()
            && (scheme.iter()).all(|byte| byte.is_ascii_alphanumeric() || b"+-.".contains(byte))
            && !matches!(
                scheme,
                b"node" | b"bun" | b"file" | b"data" | b"blob" | b"http" | b"https"
            )
    }

    // The name of a package stands in the list only as it is written. A path there may be that of a file that a mock is laid over.
    // An executable runs where no disk has the package, so nobody there could say what the name stands for without the plugin.
    fn is_package_that_loader_answers_for(&self, specifier: Atom) -> bool {
        let name = self.files.atoms.bytes(specifier);
        self.runs_tests
            && !self.mocked_paths.is_empty()
            && !matches!(name.first(), None | Some(b'.' | b'/'))
            && strings::index_of_char_usize(name, b':').is_none()
            && self.mocked_paths.contains(name)
    }

    // `const { mock } = require("bun:test"); mock.module("made-up", ..)`, `fake("made-up")` where `fake` calls `mock.module(name, ..)`: no site says which
    // names such a program mocks. The loader of the run time is asked, and fails as in plain Bun where nobody has mocked the name by then.
    fn may_be_answered_by_mock_out_of_sight(&self) -> bool {
        self.runs_tests && self.mocks_any_module
    }

    fn is_answered_by_mock(&self, specifier: Atom) -> bool {
        let specifier = self.files.atoms.bytes(specifier);
        (self.mocked_paths).contains(&path_named(self.sources, self.file, specifier))
    }

    fn answer_of(&mut self, answer: CodeAnswer<'_>) -> Result<ScannedSite, CodeFailure> {
        let module = match answer {
            CodeAnswer::File(file) => ModuleRef::File(file),
            CodeAnswer::HostModule(id) => match RuntimeModule::from_registry_id(id.0) {
                Some(module) => ModuleRef::Runtime(module),
                None => return Err(CodeFailure::BuiltinModuleNotFound),
            },
            CodeAnswer::External { specifier, kind } => {
                self.externals.push((specifier, kind));
                ModuleRef::External {
                    importer: self.file,
                    specifier,
                    type_attribute: None,
                }
            }
            CodeAnswer::Erased => return Ok(ScannedSite::Erased),
            CodeAnswer::Computed(_) => {
                debug_assert!(false, "a constant specifier has one answer");
                return Ok(ScannedSite::AllModules);
            }
            CodeAnswer::NotFound(reason) => return Err(reason),
        };
        Ok(ScannedSite::Module(module))
    }

    fn collect_requests(&self, sites: &[ScannedSite]) -> Vec<RequestDraft> {
        let mut requests = RequestList::default();
        for (site, answer) in self.compiled.analysis.import_sites.iter().zip(sites) {
            let target = match answer {
                ScannedSite::Module(target) => *target,
                _ => continue,
            };
            let (phase, is_star_export) = match site.kind {
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::ExportFrom(_) => (ImportPhase::Evaluation, false),
                ImportSiteKind::Import(_) if is_replaced_by_object(target) => continue,
                ImportSiteKind::Import(import) => (import_phase(self.hir, import), false),
                ImportSiteKind::ExportStar(statement) => (
                    ImportPhase::Evaluation,
                    is_star_export_entry(self.hir, statement),
                ),
                _ => continue,
            };
            requests.add(RequestDraft {
                target,
                phase,
                is_star_export,
            });
        }
        requests.drafts
    }
}

fn find_type_attribute(
    files: &Files<'_>,
    hir: &hir::File<'_>,
    site: &ImportSite,
) -> Option<bun_ast::Loader> {
    let is_statement = matches!(
        site.kind,
        ImportSiteKind::Import(_) | ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
    );
    let (true, Some(attributes)) = (is_statement, site.attributes.some()) else {
        return None;
    };
    let written = hir.import_attribute(attributes, bun_sema::atom::known::r#type);
    let written = written.map(|it| files.atoms.bytes(it));
    written.and_then(bun_ast::Loader::from_string)
}

/// `import .. from "bun"` runs as `var .. = Bun` and loads no module.
pub(super) fn is_replaced_by_object(target: ModuleRef) -> bool {
    match target {
        ModuleRef::Runtime(module) => table::object_replacing_namespace(module).is_some(),
        _ => false,
    }
}

fn find_spelled_module(&(spelling, target): &(Atom, ComputedTarget)) -> Option<SpelledModule> {
    let module = match target {
        ComputedTarget::File(file) => ModuleRef::File(file),
        ComputedTarget::HostModule(id) => {
            ModuleRef::Runtime(RuntimeModule::from_registry_id(id.0)?)
        }
    };
    Some(SpelledModule { spelling, module })
}

#[derive(Copy, Clone)]
pub(super) enum SiteForm {
    Declaration,
    Load,
    Resolve,
    GetBuiltinModule,
    Mock,
}

pub(super) fn site_form(site: ImportSiteKind) -> SiteForm {
    match site {
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => SiteForm::Declaration,
        ImportSiteKind::ImportMetaResolve(_) => SiteForm::Resolve,
        ImportSiteKind::GetBuiltinModule(_) => SiteForm::GetBuiltinModule,
        ImportSiteKind::MockModule(_) => SiteForm::Mock,
        _ => SiteForm::Load,
    }
}

pub(super) fn is_jsx_site(site: ImportSiteKind) -> bool {
    matches!(
        site,
        ImportSiteKind::JsxRuntime | ImportSiteKind::JsxPackage
    )
}

fn diagnostic_node(hir: &hir::File<'_>, site: &ImportSite) -> NodeData {
    if let Some(specifier) = site.specifier_node.some() {
        return NodeData::Expr(specifier);
    }
    match site.kind {
        ImportSiteKind::JsxRuntime | ImportSiteKind::JsxPackage => NodeData::None,
        ImportSiteKind::Import(import) => NodeData::Stmt(hir[import].stmt),
        ImportSiteKind::ExportFrom(export) => NodeData::Stmt(hir[export].stmt),
        ImportSiteKind::ExportStar(statement) => NodeData::Stmt(statement),
        ImportSiteKind::ImportEquals(import) => NodeData::Stmt(hir[import].stmt),
        ImportSiteKind::ImportCall(call)
        | ImportSiteKind::Require(call)
        | ImportSiteKind::RequireResolve(call)
        | ImportSiteKind::ImportMetaRequire(call)
        | ImportSiteKind::ImportMetaResolve(call)
        | ImportSiteKind::GetBuiltinModule(call)
        | ImportSiteKind::MockModule(call)
        | ImportSiteKind::ImportByTestRunner(call)
        | ImportSiteKind::RequireByTestRunner(call) => NodeData::Expr(call),
    }
}

pub(super) fn import_phase(hir: &hir::File<'_>, import: ImportId) -> ImportPhase {
    match hir[import].is_deferred {
        true => ImportPhase::Defer,
        false => ImportPhase::Evaluation,
    }
}

/// An imported CommonJS file runs while its importer is linked, whether the import is deferred or not.
pub(super) fn phase_towards(target: ModuleKind, written: ImportPhase) -> ImportPhase {
    match target {
        ModuleKind::CommonJs => ImportPhase::Evaluation,
        _ => written,
    }
}

fn is_star_export_entry(hir: &hir::File<'_>, statement: StmtId) -> bool {
    matches!(hir[statement].kind, StmtKind::ExportStar { alias, .. } if alias.is_none())
}

#[derive(Default)]
struct RequestList {
    drafts: Vec<RequestDraft>,
    positions: FxHashMap<(ModuleRef, ImportPhase), u32>,
}

impl RequestList {
    fn add(&mut self, draft: RequestDraft) {
        match self.find(draft.target, draft.phase) {
            Some(position) => self.drafts[position].is_star_export |= draft.is_star_export,
            None => self.push(draft),
        }
    }

    fn find(&self, target: ModuleRef, phase: ImportPhase) -> Option<usize> {
        if self.drafts.len() > MAX_SCANNED_REQUESTS {
            let position = self.positions.get(&(target, phase));
            return position.map(|&position| position as usize);
        }
        let mut drafts = self.drafts.iter();
        drafts.position(|draft| draft.target == target && draft.phase == phase)
    }

    fn push(&mut self, draft: RequestDraft) {
        self.drafts.push(draft);
        if self.drafts.len() > MAX_SCANNED_REQUESTS {
            let first = self.positions.len();
            let unindexed_drafts = self.drafts[first..].iter().zip(first as u32..);
            let entries =
                unindexed_drafts.map(|(draft, position)| ((draft.target, draft.phase), position));
            self.positions.extend(entries);
        }
    }
}

pub(super) struct FinishedRequests {
    /// By record file.
    pub files: Vec<Vec<ModuleRequest>>,
    /// In the order of `ModuleSet::inner_modules`.
    pub inner_modules: Vec<(ModuleRef, Vec<ModuleRequest>)>,
}

/// The modules that a mock names, and those that hand their names on by `export *`.
fn find_modules_with_names_of_mocks(
    scans: &Scans,
    modules: &ModuleSet,
    mocked_modules: &FxHashSet<ModuleRef>,
) -> FxHashSet<ModuleRef> {
    let mut found = mocked_modules.clone();
    if found.is_empty() {
        return found;
    }
    let mut files_with_star_over: FxHashMap<ModuleRef, Vec<FileId>> = FxHashMap::default();
    for &file in &modules.record_files {
        let requests = scans.find(file).map_or(&[][..], |scan| &scan.requests[..]);
        for draft in requests.iter().filter(|draft| draft.is_star_export) {
            files_with_star_over
                .entry(draft.target)
                .or_default()
                .push(file);
        }
    }
    let mut pending: Vec<ModuleRef> = found.iter().copied().collect();
    while let Some(module) = pending.pop() {
        for &file in files_with_star_over
            .get(&module)
            .map_or(&[][..], |files| &files[..])
        {
            if found.insert(ModuleRef::File(file)) {
                pending.push(ModuleRef::File(file));
            }
        }
    }
    found
}

/// What a module imports, which runs in front of its body, and then what its sites evaluate, in the order of the text.
pub(super) fn finish_requests(
    scans: &Scans,
    modules: &ModuleSet,
    tables: &ExportTables,
    order: &EvaluationOrder,
    sites: &PlannedSites,
    mocked_modules: &FxHashSet<ModuleRef>,
) -> FinishedRequests {
    let has_names_of_mock = find_modules_with_names_of_mocks(scans, modules, mocked_modules);
    let finish_file = |&file: &FileId| {
        // The names of a mock that comes ahead of the load are the names of the module. Which of them a star hands on, beside what the other stars of the file have, is known when the mock has run.
        let follows_every_star = tables.follows_every_star(file)
            || (has_names_of_mock.contains(&ModuleRef::File(file))
                && !mocked_modules.contains(&ModuleRef::File(file)));
        let finish_request = |draft: &RequestDraft| ModuleRequest {
            phase: draft.phase,
            is_dynamic_star_export: draft.is_star_export
                && (follows_every_star || tables.has_dynamic_names(draft.target)),
            ..ModuleRequest::import(draft.target)
        };
        match scans.find(file) {
            Some(scan) => scan.requests.iter().map(finish_request).collect(),
            None => Vec::new(),
        }
    };
    let inner_modules = modules.inner_modules().iter();
    let mut finished = FinishedRequests {
        files: modules.record_files.iter().map(finish_file).collect(),
        inner_modules: inner_modules
            .map(|&(file, callback)| (ModuleRef::Inner { file, callback }, Vec::new()))
            .collect(),
    };
    let mut seen = FxHashSet::default();
    for (requests, &file) in finished.files.iter_mut().zip(&modules.record_files) {
        seen.clear();
        let evaluated = sites.of(file).iter().filter(|site| site.evaluates);
        let evaluated = evaluated.map(|site| (site.referrer, site.target));
        for (referrer, target) in evaluated.chain(sites.candidates_of(file).iter().copied()) {
            if !seen.insert((referrer, target)) {
                continue;
            }
            // Behind a site of such a target it has run to its end, or it lies on a cycle that the requests show.
            let completes = modules.keeps_error(target) || !order.exposed(target);
            let request = ModuleRequest::require(target, completes);
            match referrer {
                ModuleRef::Inner { file, callback } => {
                    let position = modules.inner_module_position(file, callback);
                    let position = position.expect("a site in an unlisted module");
                    finished.inner_modules[position].1.push(request);
                }
                _ => requests.push(request),
            }
        }
    }
    finished
}

pub(super) fn finish_site_answers(
    files: &Files<'_>,
    scans: &Scans,
    file: FileId,
    failures: &NumberedFailures,
) -> Vec<(ImportSiteKind, StoredSiteAnswer)> {
    let scan = scans.of(file);
    let sites = files.analysis(file).import_sites;
    debug_assert_eq!(sites.len(), scan.sites.len());
    let answered_sites = sites.iter().zip(&scan.sites).zip(0..);
    let finish_site = |((site, answer), index): ((&ImportSite, &ScannedSite), u32)| {
        let stored_answer = match answer {
            ScannedSite::Module(module) => StoredSiteAnswer::Module(*module),
            ScannedSite::Unresolved => finish_unresolved_site(scan, file, index, failures),
            ScannedSite::AllModules => StoredSiteAnswer::AllModules,
            ScannedSite::Candidates(range) => StoredSiteAnswer::Candidates(range.clone()),
            ScannedSite::Erased => StoredSiteAnswer::Erased,
        };
        (site.kind, stored_answer)
    };
    answered_sites.map(finish_site).collect()
}

fn finish_unresolved_site(
    scan: &FileScan,
    file: FileId,
    index: u32,
    failures: &NumberedFailures,
) -> StoredSiteAnswer {
    let order = FailureOrder {
        site: index,
        part: SitePart::Specifier,
    };
    let list = &scan.failures;
    let position = list.binary_search_by_key(&order, |pending| pending.order);
    let pending = &list[position.expect("an unresolved site without a failure")];
    match pending.failure.effect() {
        FailureEffect::ThrowsAtSite => StoredSiteAnswer::Failed(failures.id_of(file, order)),
        FailureEffect::StopsBuild => StoredSiteAnswer::Erased,
    }
}
