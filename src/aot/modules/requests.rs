#[cfg(test)]
mod tests;

use super::bindings::{ModuleRequest, NO_STAR_PLACE, SpelledModule};
use super::exports::ExportTables;
use super::failures::{
    FailureEffect, FailureOrder, ModuleFailureKind, NumberedFailures, PendingFailure, SitePart,
    WrittenPart,
};
use super::graph::StoredSiteAnswer;
use super::interop::{ImportPhase, Interop, ModuleKind, file_interop};
use super::module_set::{ImportTypeKind, ModuleSet};
use super::order::{EvaluationOrder, PlannedSites};
use super::{BindInput, ModuleRef};
use crate::builtins::{RuntimeModule, table};
use crate::diagnostics::range_of_node;
use crate::ir::for_each_mut;
use crate::load::Sources;
use crate::load::contents::load_names::{
    NamedModule, is_followed_further_than_bundler, mentions_plugin, modules_named_in, names_plugin,
};
use crate::load::plugin_modules::FOLDER_OF_DATABASE_NAMESPACE;
use crate::load::sources::{SourceKind, parsed_source};
use crate::module_keys::DATABASE_NAMESPACE;
use bun_core::strings;
use bun_resolve_builtins::Alias;
use bun_sema::atom::Atom;
use bun_sema::components::strongly_connected_components;
use bun_sema::hir::{self, ExportId, ExprId, ExprKind, ImportId, NodeData, StmtId, StmtKind};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, find_names_read_by_transpiler,
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
    Candidates(Range<u32>),
    Erased,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct RequestDraft {
    pub target: ModuleRef,
    pub phase: ImportPhase,
    pub is_star_export: bool,
    pub star_place: u32,
}

pub(super) struct FileScan {
    pub interop: Interop,
    pub sites: Vec<ScannedSite>,
    pub candidates: Vec<ModuleRef>,
    pub spellings: Vec<SpelledModule>,
    pub externals: Vec<(Atom, ExternalKind)>,
    pub left_to_loader: Vec<(Atom, FileId)>,
    pub requests: Vec<RequestDraft>,
    pub failures: Vec<PendingFailure>,
}

impl FileScan {
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

pub(super) fn scan_files(input: &BindInput<'_, '_>) -> Scans {
    let (files, sources) = (input.files, input.sources);
    let compiled_files = files.compiled_files().iter();
    let mut slots: Vec<(FileId, Option<FileScan>)> =
        compiled_files.map(|&file| (file, None)).collect();
    let program = Program {
        runs_tests: input.runs_tests,
        asks_loader_where_bundler_does: !input.runs_tests && names_plugin(input.files),
    };
    for_each_mut(&mut slots, input.in_parallel, &|(file, scan)| {
        *scan = Some(scan_file(files, sources, program, *file));
    });
    let mut by_file = Vec::new();
    by_file.resize_with(files.modules.len(), || None);
    for (file, scan) in slots {
        by_file[file.idx()] = scan;
    }
    Scans { by_file }
}

pub(super) fn request_folders_of_databases_first(
    input: &BindInput<'_, '_>,
    scans: &mut Scans,
) -> Vec<FileId> {
    let files = input.files;
    let namespace_of = |file: FileId| {
        let module = parsed_source(files, file)?.plugin_module.as_ref()?;
        Some(&*module.namespace)
    };
    let mut folders = Vec::new();
    for &database in files.compiled_files() {
        if namespace_of(database) != Some(DATABASE_NAMESPACE) {
            continue;
        }
        let sites = scans.find(database).map_or(&[][..], |scan| &scan.sites);
        let folder = sites.iter().find_map(|site| match *site {
            ScannedSite::Module(ModuleRef::File(file))
                if namespace_of(file) == Some(FOLDER_OF_DATABASE_NAMESPACE) =>
            {
                Some(file)
            }
            _ => None,
        });
        let Some(folder) = folder else {
            continue;
        };
        let is_imported_by_statement = files.compiled_files().iter().any(|&importer| {
            let requests = scans.find(importer).map_or(&[][..], |scan| &scan.requests);
            (requests.iter()).any(|request| request.target == ModuleRef::File(database))
        });
        folders.push((folder, is_imported_by_statement));
    }
    for entry_point in input.sources.entry_points() {
        let Some(scan) = scans.find_mut(entry_point.file) else {
            continue;
        };
        if !matches!(
            scan.interop.kind,
            ModuleKind::SourceText | ModuleKind::CommonJs
        ) {
            continue;
        }
        let run_first = folders.iter().filter(|folder| folder.1);
        let first = run_first.map(|&(folder, _)| RequestDraft {
            target: ModuleRef::File(folder),
            phase: ImportPhase::Evaluation,
            is_star_export: false,
            star_place: NO_STAR_PLACE,
        });
        scan.requests.splice(0..0, first);
    }
    folders.iter().map(|folder| folder.0).collect()
}

fn leave_calls_of_test_run_to_loader(input: &BindInput<'_, '_>, scans: &mut Scans) {
    let files = input.files;
    if !mentions_plugin(files) {
        return;
    }
    let is_asked_of_plugins = |spelling: Atom, module: ModuleRef| match module {
        ModuleRef::File(_) => true,
        ModuleRef::Runtime(RuntimeModule::BunTest) => false,
        ModuleRef::Runtime(_) => {
            !is_replaced_by_object(module)
                && strings::contains_char(files.atoms.bytes(spelling), b':')
        }
        _ => false,
    };
    for &file in files.compiled_files() {
        let Some(scan) = scans.find_mut(file) else {
            continue;
        };
        let FileScan {
            sites,
            spellings,
            candidates,
            ..
        } = scan;
        for spelled in spellings.iter_mut() {
            spelled.is_left_to_loader |= is_asked_of_plugins(spelled.spelling, spelled.module);
        }
        for (site, answer) in files.analysis(file).import_sites.iter().zip(sites) {
            let is_call = matches!(
                site.kind,
                ImportSiteKind::ImportCall(_)
                    | ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
                    | ImportSiteKind::RequireResolve(_)
                    | ImportSiteKind::ImportMetaResolve(_)
            );
            if let (true, ImportSpecifier::Constant(spelling), &mut ScannedSite::Module(module)) =
                (is_call, site.specifier, &mut *answer)
                && is_asked_of_plugins(spelling, module)
            {
                let at = spellings.len() as u32;
                spellings.push(SpelledModule {
                    spelling,
                    module,
                    is_left_to_loader: true,
                });
                candidates.push(module);
                *answer = ScannedSite::Candidates(at..at + 1);
            }
        }
    }
}

pub(super) fn leave_imports_of_test_files_to_loader(
    input: &BindInput<'_, '_>,
    scans: &mut Scans,
    may_load_again: &dyn Fn(FileId) -> bool,
) {
    struct Statement {
        importer: FileId,
        site: usize,
        specifier: Atom,
        type_attribute: Option<bun_ast::Loader>,
        target: FileId,
    }
    if !input.runner_starts_entry_points {
        return;
    }
    let given_to_several_types = match input.runs_in_several_realms {
        true => find_forms_given_to_several_types(input, scans),
        false => FxHashSet::default(),
    };
    leave_calls_of_test_run_to_loader(input, scans);
    let importers = match given_to_several_types.is_empty() {
        true => input.files.entry_points(),
        false => input.files.compiled_files(),
    };
    let mut statements = Vec::new();
    for &importer in importers {
        let Some(scan) = scans.find(importer) else {
            continue;
        };
        let is_test_file =
            given_to_several_types.is_empty() || input.files.entry_points().contains(&importer);
        let sites = input.files.analysis(importer).import_sites.iter();
        for (index, (site, answer)) in sites.zip(&scan.sites).enumerate() {
            let is_statement = matches!(site_form(site.kind), SiteForm::Declaration);
            if let (
                true,
                ImportSpecifier::Constant(specifier),
                &ScannedSite::Module(ModuleRef::File(target)),
            ) = (is_statement, site.specifier, answer)
                && ((is_test_file && may_load_again(target))
                    || given_to_several_types.contains(&target))
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
        return;
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
}

fn find_forms_given_to_several_types(
    input: &BindInput<'_, '_>,
    scans: &Scans,
) -> FxHashSet<FileId> {
    let mut first_types: FxHashMap<FileId, bun_ast::Loader> = FxHashMap::default();
    let mut found = FxHashSet::default();
    for &importer in input.files.compiled_files() {
        let Some(scan) = scans.find(importer) else {
            continue;
        };
        let sites = input.files.analysis(importer).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            if let &ScannedSite::Module(ModuleRef::File(target)) = answer
                && let Some(asked) =
                    find_type_attribute(input.files, input.files.hir(importer), site)
                && *first_types.entry(target).or_insert(asked) != asked
                && input.sources.kind(target) == SourceKind::Data
            {
                found.insert(target);
            }
        }
    }
    found
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Spelling {
    WithoutExtension,
    WithOtherExtension,
    AsDirectory,
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
        written if Some(written) == folder => Some(Spelling::AsDirectory),
        written if without_extension_of_file(written) == without_extension_of_file(path) => {
            Some(Spelling::WithOtherExtension)
        }
        _ => None,
    }
}

fn path_named(sources: &Sources, file: FileId, specifier: &[u8]) -> Vec<u8> {
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

#[derive(Copy, Clone)]
struct Program {
    runs_tests: bool,
    asks_loader_where_bundler_does: bool,
}

fn scan_file(files: &Files<'_>, sources: &Sources, program: Program, file: FileId) -> FileScan {
    let compiled = files.compiled(file);
    let mut scanner = FileScanner {
        file,
        files,
        sources,
        runs_tests: program.runs_tests,
        asks_loader_where_bundler_does: program.asks_loader_where_bundler_does,
        hir: files.hir(file),
        compiled: compiled.expect("the loader analyzes every compiled file"),
        named_in_choices: parsed_source(files, file)
            .map_or(&[][..], |source| source.named_modules()),
        candidates: Vec::new(),
        spellings: Vec::new(),
        externals: Vec::new(),
        failures: Vec::new(),
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
    let requests = match interop.kind {
        ModuleKind::SourceText => scanner.collect_requests(&sites),
        _ => Vec::new(),
    };
    FileScan {
        interop,
        sites,
        candidates: scanner.candidates,
        spellings: scanner.spellings,
        externals: scanner.externals,
        left_to_loader: Vec::new(),
        requests,
        failures: scanner.failures,
    }
}

struct FileScanner<'a, 's> {
    file: FileId,
    files: &'a Files<'s>,
    sources: &'a Sources,
    runs_tests: bool,
    asks_loader_where_bundler_does: bool,
    hir: &'a hir::File<'s>,
    compiled: &'a CompiledModule<'s>,
    named_in_choices: &'a [NamedModule],
    candidates: Vec<ModuleRef>,
    spellings: Vec<SpelledModule>,
    externals: Vec<(Atom, ExternalKind)>,
    failures: Vec<PendingFailure>,
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
        let finds_nothing = matches!(site.kind, ImportSiteKind::ImportCall(_))
            && matches!(answer, CodeAnswer::NotFound(_));
        let is_followed_further = is_followed_further_than_bundler(self.files, self.file, site);
        let asks_loader =
            self.asks_loader_where_bundler_does && (finds_nothing || is_followed_further);
        if asks_loader && let Some(scanned) = self.leave_site_to_loader(site, answer) {
            if let (false, ImportSpecifier::Constant(specifier), CodeAnswer::NotFound(reason)) =
                (is_followed_further, site.specifier, answer)
            {
                self.say_name_is_not_found(index, site, specifier, reason);
            }
            return scanned;
        }
        if let Some(scanned) = self.leave_library_name_to_loader(site, answer) {
            return scanned;
        }
        match site.specifier {
            ImportSpecifier::Constant(specifier) => {
                let scanned = self.scan_constant_site(index, site, specifier, answer);
                self.with_type_attribute(site, scanned)
            }
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => self.scan_computed_site(site, answer, asks_loader),
        }
    }

    fn leave_site_to_loader(
        &mut self,
        site: &ImportSite,
        answer: CodeAnswer<'_>,
    ) -> Option<ScannedSite> {
        let at = self.spellings.len() as u32;
        let target = match answer {
            CodeAnswer::File(target) => target,
            CodeAnswer::NotFound(_) => return Some(ScannedSite::Candidates(at..at)),
            CodeAnswer::HostModule(_)
            | CodeAnswer::External { .. }
            | CodeAnswer::Erased
            | CodeAnswer::Computed(_) => return None,
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
        if let ImportSpecifier::Constant(spelling) = site.specifier {
            self.spellings.push(SpelledModule {
                spelling,
                module: ModuleRef::File(target),
                is_left_to_loader: true,
            });
        }
        Some(ScannedSite::Candidates(at..self.spellings.len() as u32))
    }

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

    fn is_library_name_asked_of_plugins(&self, site: &ImportSite, spelled: SpelledModule) -> bool {
        let loads = matches!(
            site.kind,
            ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
        );
        let name = self.files.atoms.bytes(spelled.spelling);
        self.asks_loader_where_bundler_does
            && loads
            && matches!(spelled.module, ModuleRef::Runtime(_))
            && match is_followed_further_than_bundler(self.files, self.file, site) {
                true => strings::contains_char(name, b':'),
                false => name.starts_with(b"bun:"),
            }
    }

    fn leave_library_name_to_loader(
        &mut self,
        site: &ImportSite,
        answer: CodeAnswer<'_>,
    ) -> Option<ScannedSite> {
        let (CodeAnswer::HostModule(id), ImportSpecifier::Constant(spelling)) =
            (answer, site.specifier)
        else {
            return None;
        };
        let spelled = SpelledModule {
            spelling,
            module: ModuleRef::Runtime(RuntimeModule::from_registry_id(id.0)?),
            is_left_to_loader: true,
        };
        if !self.is_library_name_asked_of_plugins(site, spelled) {
            return None;
        }
        let at = self.spellings.len() as u32;
        self.candidates.push(spelled.module);
        self.spellings.push(spelled);
        Some(ScannedSite::Candidates(at..at + 1))
    }

    fn is_file_that_loader_finds(&self, spelled: SpelledModule) -> bool {
        let is_held = |target: FileId| {
            matches!(
                self.sources.kind(target),
                SourceKind::Program | SourceKind::Data
            )
        };
        matches!(spelled.module, ModuleRef::File(target) if is_held(target))
    }

    fn scan_computed_site(
        &mut self,
        site: &ImportSite,
        answer: CodeAnswer<'_>,
        asks_loader: bool,
    ) -> ScannedSite {
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
                let files = files.iter().map(|&file| ModuleRef::File(file));
                self.candidates.extend(files);
                let runtime_modules = host_modules
                    .iter()
                    .filter_map(|id| RuntimeModule::from_registry_id(id.0));
                self.candidates
                    .extend(runtime_modules.map(ModuleRef::Runtime));
                let start = self.spellings.len() as u32;
                let spelled = spellings.iter().filter_map(find_spelled_module);
                let prefixed = spelled.clone().map(|it| it.spelling);
                let prefixed = prefixed.filter(|&name| self.is_name_for_transpiler_alone(name));
                let unread = self.find_names_for_transpiler_alone_that_it_does_not_read(
                    site,
                    prefixed.collect(),
                );
                let spelled: Vec<SpelledModule> = spelled
                    .filter(|it| !unread.contains(&it.spelling))
                    .map(|spelled| SpelledModule {
                        is_left_to_loader: (asks_loader && self.is_file_that_loader_finds(spelled))
                            || self.is_library_name_asked_of_plugins(site, spelled),
                        ..spelled
                    })
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

    fn is_name_for_transpiler_alone(&self, name: Atom) -> bool {
        Alias::bun_prefixed_builtin(self.files.atoms.bytes(name)).is_some()
    }

    fn find_names_for_transpiler_alone_that_it_does_not_read(
        &self,
        site: &ImportSite,
        mut prefixed: Vec<Atom>,
    ) -> Vec<Atom> {
        if !prefixed.is_empty() {
            let (bound, decisions) = (
                self.files.bound(self.file),
                &self.compiled.analysis.decisions,
            );
            let read = find_names_read_by_transpiler(self.hir, bound, decisions, site);
            prefixed.retain(|name| !read.contains(name));
        }
        prefixed
    }

    fn add_spellings_named_in(&mut self, site: &ImportSite, start: u32) {
        let named = modules_named_in(self.named_in_choices, site.specifier_node);
        let prefixed = named.iter().map(|it| it.name);
        let prefixed = prefixed.filter(|&name| self.is_name_for_transpiler_alone(name));
        let unread =
            self.find_names_for_transpiler_alone_that_it_does_not_read(site, prefixed.collect());
        for named in named {
            if unread.contains(&named.name) {
                continue;
            }
            let mut spelled = self.spellings[start as usize..].iter();
            if !spelled.any(|it| it.spelling == named.name) {
                let spelled = SpelledModule {
                    spelling: named.name,
                    module: ModuleRef::Runtime(named.module),
                    is_left_to_loader: false,
                };
                self.spellings.push(SpelledModule {
                    is_left_to_loader: self.is_library_name_asked_of_plugins(site, spelled),
                    ..spelled
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
        let reason = match (self.answer_of(answer), site_form(site.kind)) {
            (Ok(ScannedSite::Erased), SiteForm::Load) => CodeFailure::ModuleNotFound,
            (Ok(ScannedSite::Erased), SiteForm::Declaration) if is_jsx_site(site.kind) => {
                CodeFailure::ModuleNotFound
            }
            (Ok(ScannedSite::Erased) | Err(_), SiteForm::Resolve) => {
                return ScannedSite::AllModules;
            }
            (Err(_), SiteForm::GetBuiltinModule | SiteForm::Mock) => return ScannedSite::Erased,
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
            (Err(_), SiteForm::Declaration | SiteForm::Load)
                if self.runs_tests || self.names_file_missing_at_build(index) =>
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
        self.say_name_is_not_found(index, site, specifier, reason);
        ScannedSite::Unresolved
    }

    fn say_name_is_not_found(
        &mut self,
        index: u32,
        site: &ImportSite,
        specifier: Atom,
        reason: CodeFailure,
    ) {
        let (start, end) = range_of_node(self.hir, diagnostic_node(self.hir, site));
        let written = WrittenPart::new(index as usize, SitePart::Specifier, site.kind, start..end);
        let kind = ModuleFailureKind::Unresolved { specifier, reason };
        self.failures.push(written.fail(self.file, kind));
    }

    fn names_file_missing_at_build(&self, index: u32) -> bool {
        parsed_source(self.files, self.file).is_some_and(|source| {
            let names = &source.contents.names;
            let is_listed = |sites: &[u32]| sites.binary_search(&index).is_ok();
            is_listed(&names.files_missing_at_build_at)
                || is_listed(&names.data_missing_at_build_at)
        })
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
            let phase = match target {
                ModuleRef::File(file) => {
                    phase_of_request(file_interop(self.files, self.sources, file).kind, phase)
                }
                _ => phase,
            };
            requests.add(RequestDraft {
                target,
                phase,
                is_star_export,
                star_place: NO_STAR_PLACE,
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
    Some(SpelledModule {
        spelling,
        module,
        is_left_to_loader: false,
    })
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

pub(super) fn import_call_type_kind(
    files: &Files<'_>,
    hir: &hir::File<'_>,
    site: &ImportSite,
    call: ExprId,
) -> Option<ImportTypeKind> {
    let has_options = match hir[call].kind {
        ExprKind::ImportCall { args } => args.len() > 1,
        _ => true,
    };
    if !has_options {
        return Some(ImportTypeKind::None);
    }
    let written = hir.import_attribute(site.attributes.some()?, bun_sema::atom::known::r#type)?;
    Some(match files.atoms.bytes(written) {
        b"json" => ImportTypeKind::Json,
        _ => ImportTypeKind::HostDefined,
    })
}

fn phase_of_request(target: ModuleKind, written: ImportPhase) -> ImportPhase {
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
    stars: u32,
}

impl RequestList {
    fn add(&mut self, draft: RequestDraft) {
        let position = match self.find(draft.target, draft.phase) {
            Some(position) => position,
            None => {
                self.push(RequestDraft {
                    is_star_export: false,
                    ..draft
                });
                self.drafts.len() - 1
            }
        };
        let listed = &mut self.drafts[position];
        if draft.is_star_export && !listed.is_star_export {
            listed.is_star_export = true;
            listed.star_place = self.stars;
            self.stars += 1;
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
    pub files: Vec<Vec<ModuleRequest>>,
    pub inner_modules: Vec<(ModuleRef, Vec<ModuleRequest>)>,
    pub files_with_late_stars: Vec<FileId>,
}

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

pub(super) fn finish_requests(
    scans: &Scans,
    modules: &ModuleSet,
    tables: &ExportTables,
    order: &EvaluationOrder,
    sites: &PlannedSites,
    mocked_modules: &FxHashSet<ModuleRef>,
) -> FinishedRequests {
    let modules_with_names_of_mock =
        find_modules_with_names_of_mocks(scans, modules, mocked_modules);
    let finish_file = |&file: &FileId| {
        let is_any_mock_named = !modules_with_names_of_mock.is_empty();
        let has_names_of_mock = modules_with_names_of_mock.contains(&ModuleRef::File(file));
        let reaches_another_mock = || {
            let stars = scans.find(file).into_iter().flat_map(|scan| &scan.requests);
            let mut stars = stars.filter(|draft| draft.is_star_export);
            stars.any(|draft| modules_with_names_of_mock.contains(&draft.target))
        };
        let follows_every_star = tables.follows_every_star(file)
            || (has_names_of_mock
                && (!mocked_modules.contains(&ModuleRef::File(file)) || reaches_another_mock()));
        let finish_request = |draft: &RequestDraft| ModuleRequest {
            phase: draft.phase,
            is_star_export: draft.is_star_export,
            star_place: match is_any_mock_named {
                true => draft.star_place,
                false => NO_STAR_PLACE,
            },
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
        files_with_late_stars: Vec::new(),
    };
    if !modules_with_names_of_mock.is_empty() {
        let has_late_star = |requests: &[ModuleRequest]| {
            let places = requests.iter().map(|it| it.star_place);
            !places.filter(|&place| place != NO_STAR_PLACE).is_sorted()
        };
        let files = modules.record_files.iter().zip(&finished.files);
        let files = files.filter(|(_, requests)| has_late_star(requests));
        finished.files_with_late_stars = files.map(|(&file, _)| file).collect();
        finished.files_with_late_stars.sort_unstable();
    }
    let mut seen = FxHashSet::default();
    for (requests, &file) in finished.files.iter_mut().zip(&modules.record_files) {
        seen.clear();
        let evaluated = sites.of(file).iter().filter(|site| site.evaluates);
        let evaluated = evaluated.map(|site| (site.referrer, site.target));
        for (referrer, target) in evaluated.chain(sites.candidates_of(file).iter().copied()) {
            if !seen.insert((referrer, target)) {
                continue;
            }
            let completes = !order.half(target);
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
