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
use crate::builtins::RuntimeModule;
use crate::diagnostics::{Span, range_of_node};
use crate::ir::for_each_mut;
use crate::load::Sources;
use crate::load::named_loads::{NamedModule, modules_named_in};
use crate::load::sources::parsed_source;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExportId, ExprId, ImportId, NodeData, StmtId, StmtKind};
use bun_sema::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use bun_sema::program::{
    CodeAnswer, CompiledModule, ComputedTarget, ComputedTargets, FileId, Files,
};
use bun_sema::resolve::{CodeFailure, ComputedUnknown, ExternalKind};
use bun_sema::util::{FxHashMap, FxHashSet};
use core::ops::Range;

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
}

pub(super) struct FileScan {
    pub interop: Interop,
    pub sites: Vec<ScannedSite>,
    pub candidates: Vec<ModuleRef>,
    pub spellings: Vec<SpelledModule>,
    pub externals: Vec<(Atom, ExternalKind)>,
    pub requests: Vec<RequestDraft>,
    pub failures: Vec<PendingFailure>,
    pub sites_over_candidate_limit: Vec<Span>,
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
    for_each_mut(&mut slots, input.in_parallel, &|(file, scan)| {
        *scan = Some(scan_file(files, sources, *file));
    });
    let mut by_file = Vec::new();
    by_file.resize_with(files.modules.len(), || None);
    for (file, scan) in slots {
        by_file[file.idx()] = scan;
    }
    Scans { by_file }
}

fn scan_file(files: &Files<'_>, sources: &Sources, file: FileId) -> FileScan {
    let compiled = files.compiled(file);
    let mut scanner = FileScanner {
        file,
        hir: files.hir(file),
        compiled: compiled.expect("the loader analyzes every compiled file"),
        named_in_choices: parsed_source(files, file)
            .map_or(&[][..], |source| source.named_modules()),
        candidates: Vec::new(),
        spellings: Vec::new(),
        externals: Vec::new(),
        failures: Vec::new(),
        sites_over_candidate_limit: Vec::new(),
    };
    let sites = scanner.scan_sites();
    if parsed_source(files, file).is_some_and(|source| source.parse_failure.is_some()) {
        debug_assert!(sites.is_empty());
        let site = ImportSiteKind::ExportFrom(ExportId(0));
        let kind = ModuleFailureKind::NotAProgram {
            is_loaded_at_start: true,
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
        requests,
        failures: scanner.failures,
        sites_over_candidate_limit: scanner.sites_over_candidate_limit,
    }
}

struct FileScanner<'a, 's> {
    file: FileId,
    hir: &'a hir::File<'s>,
    compiled: &'a CompiledModule<'s>,
    named_in_choices: &'a [NamedModule],
    candidates: Vec<ModuleRef>,
    spellings: Vec<SpelledModule>,
    externals: Vec<(Atom, ExternalKind)>,
    failures: Vec<PendingFailure>,
    sites_over_candidate_limit: Vec<Span>,
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
        match site.specifier {
            ImportSpecifier::Constant(specifier) => {
                self.scan_constant_site(index, site, specifier, answer)
            }
            ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => {
                self.scan_computed_site(site, answer)
            }
        }
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
                let files = files.iter().map(|&file| ModuleRef::File(file));
                self.candidates.extend(files);
                let runtime_modules = host_modules
                    .iter()
                    .filter_map(|id| RuntimeModule::from_registry_id(id.0));
                self.candidates
                    .extend(runtime_modules.map(ModuleRef::Runtime));
                let start = self.spellings.len() as u32;
                self.spellings
                    .extend(spellings.iter().filter_map(find_spelled_module));
                self.add_spellings_named_in(site.specifier_node);
                ScannedSite::Candidates(start..self.spellings.len() as u32)
            }
            ComputedTargets::All { cause, .. } => {
                match cause {
                    ComputedUnknown::TooManyCandidates => {
                        let node = diagnostic_node(self.hir, site);
                        let span = Span::of_node(self.hir, self.file, node);
                        self.sites_over_candidate_limit.push(span);
                    }
                    ComputedUnknown::NoPattern
                    | ComputedUnknown::NoConstantPrefix
                    | ComputedUnknown::IncompletePackageName
                    | ComputedUnknown::PackageImports
                    | ComputedUnknown::ConfigPaths
                    | ComputedUnknown::ExternalCandidate => {}
                }
                let start = self.spellings.len() as u32;
                self.add_spellings_named_in(site.specifier_node);
                match self.spellings.len() as u32 {
                    end if end == start => ScannedSite::AllModules,
                    end => ScannedSite::Candidates(start..end),
                }
            }
        }
    }

    fn add_spellings_named_in(&mut self, argument: ExprId) {
        let named = modules_named_in(self.named_in_choices, argument).iter();
        self.spellings.extend(named.map(|it| SpelledModule {
            spelling: it.name,
            module: ModuleRef::Runtime(it.module),
        }));
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
            (Err(_), SiteForm::GetBuiltinModule) => return ScannedSite::Erased,
            (
                Ok(answer),
                SiteForm::Declaration
                | SiteForm::Load
                | SiteForm::Resolve
                | SiteForm::GetBuiltinModule,
            ) => return answer,
            (Err(reason), SiteForm::Declaration | SiteForm::Load) => reason,
        };
        let (start, end) = range_of_node(self.hir, diagnostic_node(self.hir, site));
        let written = WrittenPart::new(index as usize, SitePart::Specifier, site.kind, start..end);
        let kind = ModuleFailureKind::Unresolved { specifier, reason };
        self.failures.push(written.fail(self.file, kind));
        ScannedSite::Unresolved
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
        _ => SiteForm::Load,
    }
}

fn is_jsx_site(site: ImportSiteKind) -> bool {
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
        | ImportSiteKind::GetBuiltinModule(call) => NodeData::Expr(call),
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
            let unindexed_drafts = self.drafts.iter().zip(0..).skip(self.positions.len());
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

/// What a module imports, which runs in front of its body, and then what its sites evaluate, in the order of the text.
pub(super) fn finish_requests(
    scans: &Scans,
    modules: &ModuleSet,
    tables: &ExportTables,
    order: &EvaluationOrder,
    sites: &PlannedSites,
) -> FinishedRequests {
    let finish_file = |&file: &FileId| {
        let follows_every_star = tables.follows_every_star(file);
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
