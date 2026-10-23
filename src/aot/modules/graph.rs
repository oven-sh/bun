#[cfg(test)]
mod tests;

use super::ModuleRef;
use super::bindings::{
    AccessedModule, Candidates, ExportBinding, ExportLookup, ExportUse, Holder, ImportBinding,
    ModuleExport, ModuleRequest, RequiredName, SiteAnswer, SpelledModule, SyntheticExport,
    SyntheticExportId,
};
use super::code_unit_order::compare_code_units;
use super::commonjs_exports::CommonJsExports;
use super::failures::{ModuleFailure, ModuleFailureId};
use super::imports::NamedMember;
use super::interop::{Interop, ModuleKind};
use super::module_set::{ADDED_ES_MODULE, INNER_MODULE};
use super::order::SiteKey;
use super::plan::{Member, Plan, PlanParts, StoredSite};
use super::unread_exports::remove_unread_data_exports;
use super::wrapped::WrappedModules;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::InParallel;
use crate::load::ProjectId;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::SymbolId;
use bun_sema::hir::{ExprId, FnId};
use bun_sema::import_sites::{ImportSiteKind, JsxImport};
use bun_sema::program::FileId;
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashSet, SharedSort};
use core::ops::Range;

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum StoredSiteAnswer {
    Module(ModuleRef),
    AllModules,
    Candidates(Range<u32>),
    Failed(ModuleFailureId),
    Erased,
}

pub struct ModuleGraph {
    project: ProjectId,
    entry_index_by_file: Vec<Option<u32>>,
    entries: Vec<FileEntry>,
    requests: Vec<ModuleRequest>,
    sites: Vec<(ImportSiteKind, StoredSiteAnswer)>,
    spellings: Vec<SpelledModule>,
    imports: Vec<(SymbolId, ImportBinding)>,
    members: Vec<(ExprId, ImportBinding)>,
    accessed: Vec<(ExprId, AccessedModule)>,
    fixed_members: Vec<(ExprId, (ModuleRef, Member))>,
    jsx: Vec<(JsxImport, ImportBinding)>,
    evaluating_sites: Vec<(SiteKey, StoredSite)>,
    unread_sites: Vec<(ExprId, bool)>,
    holders: Vec<Holder>,
    exports: Vec<ModuleExport>,
    unread_exports: Vec<SymbolId>,
    required_names: Vec<RequiredName>,
    record_files: Vec<FileId>,
    left_out_files: Vec<FileId>,
    left_out_inner_modules: Vec<(FileId, FnId)>,
    other_modules: Vec<ModuleRef>,
    external_kinds: Vec<((FileId, Atom), ExternalKind)>,
    synthetic_exports: Vec<SyntheticExport>,
    errors: Vec<ModuleFailure>,
    failures: Vec<ModuleFailure>,
    load_failures: Vec<(FileId, ModuleFailureId)>,
    wrapped: WrappedModules,
    commonjs_exports: CommonJsExports,
    plan: Plan,
}

const fn assert_sync<T: Sync>() {}

const _: () = assert_sync::<ModuleGraph>();

struct FileEntry {
    interop: Interop,
    runtime_module: Option<RuntimeModule>,
    is_library: bool,
    has_dynamic_names: bool,
    has_top_level_await: bool,
    has_no_side_effects: bool,
    requests: Range<u32>,
    sites: Range<u32>,
    imports: Range<u32>,
    members: Range<u32>,
    accessed: Range<u32>,
    fixed_members: Range<u32>,
    jsx: Range<u32>,
    evaluating_sites: Range<u32>,
    unread_sites: Range<u32>,
    holders: Range<u32>,
    exports: Range<u32>,
    unread_exports: Range<u32>,
    required_names: Range<u32>,
}

pub(super) struct FileParts {
    pub file: FileId,
    pub interop: Interop,
    pub runtime_module: Option<RuntimeModule>,
    pub is_library: bool,
    pub has_dynamic_names: bool,
    pub has_top_level_await: bool,
    pub has_no_side_effects: bool,
    pub requests: Vec<ModuleRequest>,
    pub sites: Vec<(ImportSiteKind, StoredSiteAnswer)>,
    pub spellings: Vec<SpelledModule>,
    pub imports: Vec<(SymbolId, ImportBinding)>,
    pub members: Vec<(ExprId, ImportBinding)>,
    pub accessed: Vec<(ExprId, AccessedModule)>,
    pub fixed_members: Vec<(ExprId, (ModuleRef, Member))>,
    pub named_members: Vec<((ModuleRef, Atom), NamedMember<ImportBinding>)>,
    pub jsx: Vec<(JsxImport, ImportBinding)>,
    pub namespace_values: Vec<ModuleRef>,
    pub evaluating_sites: Vec<(SiteKey, StoredSite)>,
    pub unread_sites: Vec<(ExprId, bool)>,
    pub holders: Vec<Holder>,
    pub exports: Vec<ModuleExport>,
    pub unread_exports: Vec<SymbolId>,
    pub required_names: Vec<RequiredName>,
}

pub(super) struct GraphParts {
    pub project: ProjectId,
    pub file_count: usize,
    pub files: Vec<FileParts>,
    pub other_modules: Vec<ModuleRef>,
    pub external_kinds: Vec<((FileId, Atom), ExternalKind)>,
    pub synthetic_exports: Vec<SyntheticExport>,
    pub errors: Vec<ModuleFailure>,
    pub failures: Vec<ModuleFailure>,
    /// Ascending by file.
    pub load_failures: Vec<(FileId, ModuleFailureId)>,
    pub wrapped: WrappedModules,
    pub commonjs_exports: CommonJsExports,
    /// In the order of the plan's list of inner modules.
    pub inner_requests: Vec<Vec<ModuleRequest>>,
    pub plan: PlanParts,
}

fn to_u32(length: usize) -> u32 {
    u32::try_from(length).expect("a module list has more than u32::MAX entries")
}

fn append<T>(list: &mut Vec<T>, items: Vec<T>) -> Range<u32> {
    let start = to_u32(list.len());
    list.extend(items);
    start..to_u32(list.len())
}

// Keeps the order. What is dropped stays in the list, behind the range.
fn retain_in<T: Copy>(list: &mut [T], range: &mut Range<u32>, keeps: impl Fn(T) -> bool) {
    let mut end = range.start;
    for index in range.clone() {
        let item = list[index as usize];
        if keeps(item) {
            list[end as usize] = item;
            end += 1;
        }
    }
    range.end = end;
}

fn slice<'a, T>(list: &'a [T], range: &Range<u32>) -> &'a [T] {
    &list[range.start as usize..range.end as usize]
}

fn external_key(key: (FileId, Atom)) -> (FileId, u32) {
    (key.0, key.1.0)
}

fn rebase_candidates(
    sites: &mut [(ImportSiteKind, StoredSiteAnswer)],
    file_spellings: &Range<u32>,
) {
    for (_, answer) in sites {
        match answer {
            StoredSiteAnswer::Candidates(range) => {
                let first = file_spellings.start;
                *range = range.start + first..range.end + first;
                debug_assert!(range.end <= file_spellings.end);
            }
            StoredSiteAnswer::Module(_)
            | StoredSiteAnswer::AllModules
            | StoredSiteAnswer::Failed(_)
            | StoredSiteAnswer::Erased => {}
        }
    }
}

// The modules whose namespace object something in the file may look at.
fn add_seen_namespaces(file: &FileParts, seen: &mut Vec<ModuleRef>) {
    seen.extend_from_slice(&file.namespace_values);
    for (site, answer) in &file.sites {
        match (site, answer) {
            (ImportSiteKind::ImportCall(_), StoredSiteAnswer::Module(module)) => seen.push(*module),
            (ImportSiteKind::ImportCall(_), StoredSiteAnswer::Candidates(range)) => {
                seen.extend(
                    slice(&file.spellings, range)
                        .iter()
                        .map(|spelled| spelled.module),
                );
            }
            _ => {}
        }
    }
    for export in &file.exports {
        if let ExportBinding::Namespace { module, .. } = export.binding {
            seen.push(module);
        }
    }
}

impl ModuleGraph {
    pub fn project(&self) -> ProjectId {
        self.project
    }

    pub fn kind(&self, file: FileId) -> ModuleKind {
        self.entry(file).interop.kind
    }

    pub fn interop(&self, module: ModuleRef) -> Interop {
        match module {
            ModuleRef::File(file) => self.entry(file).interop,
            ModuleRef::Inner { .. } => INNER_MODULE,
            // A face that has the loader capture what the file exports goes by the rule of the file.
            ModuleRef::Face(file) if self.commonjs_exports.face_captures(file) => Interop {
                export_rule: self.entry(file).interop.export_rule,
                ..ADDED_ES_MODULE
            },
            ModuleRef::Face(_) | ModuleRef::Check(_) => ADDED_ES_MODULE,
            ModuleRef::Runtime(_) => Interop::RUNTIME,
            ModuleRef::External { .. } => {
                let kind = self.external_kind(module);
                debug_assert!(kind.is_some(), "an external module without a recorded kind");
                Interop::of_external(kind.unwrap_or(ExternalKind::UncompiledCode))
            }
        }
    }

    pub fn external_kind(&self, module: ModuleRef) -> Option<ExternalKind> {
        let key = match module {
            ModuleRef::External {
                importer,
                specifier,
            } => external_key((importer, specifier)),
            _ => return None,
        };
        let kinds = &self.external_kinds;
        let index = kinds.binary_search_by_key(&key, |entry| external_key(entry.0));
        index.ok().map(|index| kinds[index].1)
    }

    /// What the text of the file asks for: what it imports, and then what its sites evaluate.
    pub fn requests(&self, file: FileId) -> &[ModuleRequest] {
        slice(&self.requests, &self.entry(file).requests)
    }

    pub(super) fn requests_in(&self, range: &Range<u32>) -> &[ModuleRequest] {
        slice(&self.requests, range)
    }

    pub fn wrapped(&self) -> &WrappedModules {
        &self.wrapped
    }

    pub fn commonjs(&self) -> &CommonJsExports {
        &self.commonjs_exports
    }

    /// `finish_plan` has to follow.
    pub fn commonjs_mut(&mut self) -> &mut CommonJsExports {
        self.mark_plan_unfinished();
        &mut self.commonjs_exports
    }

    pub(super) fn plan(&self) -> &Plan {
        &self.plan
    }

    pub(super) fn plan_mut(&mut self) -> &mut Plan {
        &mut self.plan
    }

    pub fn site_answer(&self, file: FileId, site: ImportSiteKind) -> SiteAnswer<'_> {
        let answer = self.find_site_answer(file, site);
        answer.expect("no live import site at this node")
    }

    /// `None`: no live import site is at that node.
    pub fn find_site_answer(&self, file: FileId, site: ImportSiteKind) -> Option<SiteAnswer<'_>> {
        let entry = &self.entries[self.entry_index(file)? as usize];
        let sites = slice(&self.sites, &entry.sites);
        let index = sites.binary_search_by_key(&site, |&(kind, _)| kind).ok()?;
        Some(match &sites[index].1 {
            StoredSiteAnswer::Module(module) => SiteAnswer::Module(*module),
            StoredSiteAnswer::AllModules => SiteAnswer::Computed(Candidates::All),
            StoredSiteAnswer::Candidates(range) => {
                SiteAnswer::Computed(Candidates::Modules(slice(&self.spellings, range)))
            }
            StoredSiteAnswer::Failed(failure) => SiteAnswer::Failed(*failure),
            StoredSiteAnswer::Erased => SiteAnswer::Erased,
        })
    }

    pub fn import_binding(&self, file: FileId, symbol: SymbolId) -> ImportBinding {
        let imports = slice(&self.imports, &self.entry(file).imports);
        match imports.binary_search_by_key(&symbol, |&(symbol, _)| symbol) {
            Ok(index) => imports[index].1,
            Err(_) => ImportBinding::Local,
        }
    }

    /// A member of a namespace.
    pub fn member_binding(&self, file: FileId, member: ExprId) -> Option<ImportBinding> {
        let members = self.bound_members(file);
        let index = members
            .binary_search_by_key(&member, |&(member, _)| member)
            .ok()?;
        let accessed = self.accessed_modules(file)[index].1;
        let is_namespace =
            accessed.is_imported || self.interop(accessed.module).kind != ModuleKind::CommonJs;
        is_namespace.then_some(members[index].1)
    }

    /// The accesses that are bound to a name of a module: reads, stores and callees.
    pub fn bound_members(&self, file: FileId) -> &[(ExprId, ImportBinding)] {
        slice(&self.members, &self.entry(file).members)
    }

    /// For each of `bound_members`, the module that the access is written on.
    pub fn accessed_modules(&self, file: FileId) -> &[(ExprId, AccessedModule)] {
        slice(&self.accessed, &self.entry(file).accessed)
    }

    pub(super) fn fixed_members(&self, file: FileId) -> &[(ExprId, (ModuleRef, Member))] {
        slice(&self.fixed_members, &self.entry(file).fixed_members)
    }

    pub(super) fn find_stored_site(&self, file: FileId, key: SiteKey) -> Option<StoredSite> {
        let entry = &self.entries[self.entry_index(file)? as usize];
        let sites = slice(&self.evaluating_sites, &entry.evaluating_sites);
        let index = sites.binary_search_by_key(&key, |&(key, _)| key).ok()?;
        Some(sites[index].1)
    }

    pub(super) fn unread_sites(&self, file: FileId) -> &[(ExprId, bool)] {
        slice(&self.unread_sites, &self.entry(file).unread_sites)
    }

    /// By symbol. One that is needed as a value is an ordinary binding that holds the object. Final behind `finish_plan`.
    pub fn holders(&self, file: FileId) -> &[Holder] {
        debug_assert!(
            self.is_plan_finished(),
            "a shape has changed since the plan was finished"
        );
        slice(&self.holders, &self.entry(file).holders)
    }

    pub(super) fn all_holders(&self) -> &[Holder] {
        &self.holders
    }

    pub(super) fn all_holders_mut(&mut self) -> &mut [Holder] {
        &mut self.holders
    }

    pub fn jsx_binding(&self, file: FileId, import: JsxImport) -> ImportBinding {
        let mut bindings = slice(&self.jsx, &self.entry(file).jsx).iter();
        let binding = bindings.find(|(bound_import, _)| *bound_import == import);
        binding.expect("a JSX import that is not in use").1
    }

    /// The program never evaluates these files, which are in order.
    pub fn leave_out_files(&mut self, files: &[FileId], in_parallel: InParallel<'_>) {
        for entry in &mut self.entries {
            entry.has_no_side_effects = false;
        }
        if files.is_empty() {
            return self.finish_plan(in_parallel);
        }
        self.mark_plan_unfinished();
        self.requests = self.pass_requests_through(files);
        self.left_out_files = files.to_vec();
        let ModuleGraph {
            entries,
            exports,
            required_names,
            record_files,
            other_modules,
            synthetic_exports,
            ..
        } = self;
        let is_left_out = |module: ModuleRef| match module {
            ModuleRef::File(file)
            | ModuleRef::Inner { file, .. }
            | ModuleRef::Face(file)
            | ModuleRef::Check(file) => files.binary_search(&file).is_ok(),
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        };
        let leads_to_left_out_file = |binding: ExportBinding| match binding {
            ExportBinding::Variable(symbol) => is_left_out(ModuleRef::File(symbol.file)),
            ExportBinding::Synthetic(id) => is_left_out(synthetic_exports[id.0 as usize].module),
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                is_left_out(module)
            }
        };
        for entry in entries {
            retain_in(exports, &mut entry.exports, |export| {
                !leads_to_left_out_file(export.binding)
            });
            retain_in(required_names, &mut entry.required_names, |name| {
                !is_left_out(name.module)
            });
        }
        record_files.retain(|file| files.binary_search(file).is_err());
        // Each importer has a module of its own for what the build does not compile.
        other_modules.retain(|module| match *module {
            ModuleRef::External { importer, .. } => files.binary_search(&importer).is_err(),
            _ => true,
        });
        self.finish_plan(in_parallel);
    }

    /// A request all of whose sites stand in code that is left out goes. `finish_plan` has to follow.
    pub fn limit_requests(&mut self, keeps: impl Fn(ModuleRef, &ModuleRequest) -> bool) {
        self.mark_plan_unfinished();
        let ModuleGraph {
            entry_index_by_file,
            entries,
            requests,
            plan,
            ..
        } = self;
        for (file, entry) in (0..).map(FileId).zip(entry_index_by_file.iter()) {
            if let Some(entry) = *entry {
                let range = &mut entries[entry as usize].requests;
                retain_in(requests, range, |request| {
                    keeps(ModuleRef::File(file), &request)
                });
            }
        }
        #[allow(clippy::needless_collect)] // ends the borrow of `plan`
        let inner_modules: Vec<ModuleRef> = plan
            .inner_modules()
            .iter()
            .map(|&(file, callback)| ModuleRef::Inner { file, callback })
            .collect();
        for (module, range) in inner_modules.into_iter().zip(&mut plan.inner_requests) {
            retain_in(requests, range, |request| keeps(module, &request));
        }
    }

    /// Wrappers that no code calls that is left. They have no record. `finish_plan` has to follow.
    pub fn leave_out_inner_modules(&mut self, modules: &[ModuleRef]) {
        let mut left_out: Vec<(FileId, FnId)> = modules
            .iter()
            .filter_map(|&module| match module {
                ModuleRef::Inner { file, callback } => Some((file, callback)),
                _ => None,
            })
            .collect();
        left_out.shared_sort_unstable();
        self.limit_requests(|_, request| match request.target {
            ModuleRef::Inner { file, callback } => {
                left_out.binary_search(&(file, callback)).is_err()
            }
            _ => true,
        });
        self.left_out_inner_modules = left_out;
    }

    fn pass_requests_through(&mut self, left_out_files: &[FileId]) -> Vec<ModuleRequest> {
        let is_left_out = |file: FileId| left_out_files.binary_search(&file).is_ok();
        let mut passed_on = Vec::with_capacity(self.requests.len());
        let mut ranges = Vec::with_capacity(self.entries.len() + self.plan.inner_requests.len());
        let mut seen = FxHashSet::default();
        // With each request: whether the file has written it itself.
        let mut pending: Vec<(ModuleRequest, bool)> = Vec::new();
        let is_import = |request: &&ModuleRequest| request.kind == ModuleRequestKind::Import;
        let of_files = self.entries.iter().map(|entry| &entry.requests);
        for written in of_files.chain(&self.plan.inner_requests) {
            let start = to_u32(passed_on.len());
            seen.clear();
            pending.extend(
                slice(&self.requests, written)
                    .iter()
                    .rev()
                    .map(|&request| (request, true)),
            );
            while let Some((request, is_written_here)) = pending.pop() {
                match request.target {
                    // No site of it is left.
                    ModuleRef::File(target) | ModuleRef::Inner { file: target, .. }
                        if is_left_out(target) && request.kind == ModuleRequestKind::Require => {}
                    // The body that its sites are written in does not run.
                    ModuleRef::File(target) if is_left_out(target) => {
                        if seen.insert(request.target) {
                            let imports = self.requests(target).iter().filter(is_import).rev();
                            pending.extend(imports.map(|&request| (request, false)));
                        }
                    }
                    // It goes with its importer, as a file does that only a file asks for that is left out.
                    ModuleRef::External { importer, .. } if is_left_out(importer) => {}
                    // What the file asks for itself stays as it is written, also twice.
                    _ if seen.is_empty() => passed_on.push(request),
                    // A file that is left out may have asked for the same in front of it: that request takes what this one says of the names.
                    _ if is_written_here => {
                        let is_same = |earlier: &&mut ModuleRequest| {
                            earlier.target == request.target && earlier.kind == request.kind
                        };
                        match passed_on[start as usize..].iter_mut().find(is_same) {
                            Some(earlier) => {
                                earlier.is_dynamic_star_export |= request.is_dynamic_star_export
                            }
                            None => passed_on.push(request),
                        }
                    }
                    _ => {
                        let is_asked_for = |earlier: &ModuleRequest| {
                            earlier.target == request.target && earlier.kind == request.kind
                        };
                        if !passed_on[start as usize..].iter().any(is_asked_for) {
                            passed_on.push(ModuleRequest {
                                is_dynamic_star_export: false,
                                ..request
                            });
                        }
                    }
                }
            }
            ranges.push(start..to_u32(passed_on.len()));
        }
        let mut ranges = ranges.into_iter();
        for (entry, range) in self.entries.iter_mut().zip(&mut ranges) {
            entry.requests = range;
        }
        self.plan.inner_requests = ranges.collect();
        passed_on
    }

    pub fn is_left_out(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::Inner { file, callback }
                if self
                    .left_out_inner_modules
                    .binary_search(&(file, callback))
                    .is_ok() =>
            {
                true
            }
            ModuleRef::File(file)
            | ModuleRef::Inner { file, .. }
            | ModuleRef::Face(file)
            | ModuleRef::Check(file) => self.left_out_files.binary_search(&file).is_ok(),
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        }
    }

    pub fn limit_exports(&mut self, find_use: impl Fn(FileId, &ModuleExport) -> ExportUse) {
        for (file, entry) in (0..).map(FileId).zip(&self.entry_index_by_file) {
            let Some(entry) = *entry else {
                continue;
            };
            let range = &mut self.entries[entry as usize].exports;
            retain_in(&mut self.exports, range, |export| {
                find_use(file, &export) != ExportUse::None
            });
            for export in &mut self.exports[range.start as usize..range.end as usize] {
                export.is_read_from_object = find_use(file, export) == ExportUse::ReadFromObject;
            }
        }
    }

    pub fn import_bindings(&self, file: FileId) -> &[(SymbolId, ImportBinding)] {
        slice(&self.imports, &self.entry(file).imports)
    }

    pub fn jsx_bindings(&self, file: FileId) -> &[(JsxImport, ImportBinding)] {
        slice(&self.jsx, &self.entry(file).jsx)
    }

    pub fn exports(&self, file: FileId) -> &[ModuleExport] {
        slice(&self.exports, &self.entry(file).exports)
    }

    pub fn unread_exports(&self, file: FileId) -> &[SymbolId] {
        slice(&self.unread_exports, &self.entry(file).unread_exports)
    }

    pub fn find_export(&self, module: ModuleRef, name: Atom, atoms: &Interner<'_>) -> ExportLookup {
        let entry = match module {
            ModuleRef::File(file) => self.entry(file),
            _ => return ExportLookup::Unknown,
        };
        if !entry.interop.has_export_table() {
            return ExportLookup::Unknown;
        }
        let exports = slice(&self.exports, &entry.exports);
        let name_bytes = atoms.bytes(name);
        let position = exports
            .binary_search_by(|export| compare_code_units(atoms.bytes(export.name), name_bytes));
        match position.map(|position| exports[position]) {
            Ok(export) if export.can_be_ambiguous => ExportLookup::Unknown,
            Ok(export) => ExportLookup::Found(export.binding),
            Err(_) if name == known::__esModule => ExportLookup::Unknown,
            Err(_) if entry.has_dynamic_names && name != known::default => ExportLookup::Unknown,
            Err(_) => ExportLookup::Absent,
        }
    }

    pub fn required_names(&self, file: FileId) -> &[RequiredName] {
        slice(&self.required_names, &self.entry(file).required_names)
    }

    pub fn synthetic_export(&self, id: SyntheticExportId) -> &SyntheticExport {
        &self.synthetic_exports[id.0 as usize]
    }

    pub fn synthetic_exports(&self) -> &[SyntheticExport] {
        &self.synthetic_exports
    }

    pub fn errors(&self) -> &[ModuleFailure] {
        &self.errors
    }

    pub fn failure(&self, id: ModuleFailureId) -> &ModuleFailure {
        &self.failures[id.0 as usize]
    }

    pub fn failures(&self) -> &[ModuleFailure] {
        &self.failures
    }

    /// What the load of the module ends with: an import of it, or of a module that it imports, names nothing.
    pub fn load_failure(&self, file: FileId) -> Option<ModuleFailureId> {
        let index = self
            .load_failures
            .binary_search_by_key(&file, |&(file, _)| file)
            .ok()?;
        Some(self.load_failures[index].1)
    }

    pub fn unloadable_files(&self) -> impl Iterator<Item = FileId> + '_ {
        self.load_failures.iter().map(|&(file, _)| file)
    }

    pub(super) fn file_count(&self) -> usize {
        self.entry_index_by_file.len()
    }

    pub fn record_files(&self) -> &[FileId] {
        &self.record_files
    }

    pub fn other_modules(&self) -> &[ModuleRef] {
        &self.other_modules
    }

    pub fn has_record(&self, file: FileId) -> bool {
        self.entry_index(file).is_some()
    }

    pub fn is_library(&self, file: FileId) -> bool {
        self.entry(file).is_library
    }

    pub fn runtime_module(&self, file: FileId) -> Option<RuntimeModule> {
        self.entry(file).runtime_module
    }

    pub fn has_top_level_await(&self, file: FileId) -> bool {
        self.entry(file).has_top_level_await
    }

    /// By `sideEffects` of its package.
    pub fn has_no_side_effects(&self, file: FileId) -> bool {
        self.entry(file).has_no_side_effects
    }

    pub fn has_dynamic_names(&self, file: FileId) -> bool {
        self.entry(file).has_dynamic_names
    }

    pub(super) fn new(parts: GraphParts, in_parallel: InParallel<'_>) -> ModuleGraph {
        let mut files = parts.files;
        remove_unread_data_exports(&mut files);
        let mut plan = parts.plan;
        for file in &mut files {
            plan.named_members.append(&mut file.named_members);
            add_seen_namespaces(file, &mut plan.seen_namespaces);
        }
        let plan = Plan::new(plan, &parts.synthetic_exports);
        let total = |length: fn(&FileParts) -> usize| files.iter().map(length).sum::<usize>();
        let mut external_kinds = parts.external_kinds;
        external_kinds.shared_sort_unstable_by_key(|entry| external_key(entry.0));
        debug_assert!(external_kinds.is_sorted_by(|a, b| external_key(a.0) < external_key(b.0)));
        let mut graph = ModuleGraph {
            project: parts.project,
            entry_index_by_file: vec![None; parts.file_count],
            entries: Vec::with_capacity(files.len()),
            requests: Vec::with_capacity(total(|file| file.requests.len())),
            sites: Vec::with_capacity(total(|file| file.sites.len())),
            spellings: Vec::with_capacity(total(|file| file.spellings.len())),
            imports: Vec::with_capacity(total(|file| file.imports.len())),
            members: Vec::with_capacity(total(|file| file.members.len())),
            accessed: Vec::with_capacity(total(|file| file.accessed.len())),
            fixed_members: Vec::with_capacity(total(|file| file.fixed_members.len())),
            jsx: Vec::with_capacity(total(|file| file.jsx.len())),
            evaluating_sites: Vec::with_capacity(total(|file| file.evaluating_sites.len())),
            unread_sites: Vec::with_capacity(total(|file| file.unread_sites.len())),
            holders: Vec::with_capacity(total(|file| file.holders.len())),
            exports: Vec::with_capacity(total(|file| file.exports.len())),
            unread_exports: Vec::with_capacity(total(|file| file.unread_exports.len())),
            required_names: Vec::with_capacity(total(|file| file.required_names.len())),
            record_files: Vec::with_capacity(files.len()),
            left_out_files: Vec::new(),
            left_out_inner_modules: Vec::new(),
            other_modules: parts.other_modules,
            external_kinds,
            synthetic_exports: parts.synthetic_exports,
            errors: parts.errors,
            failures: parts.failures,
            load_failures: parts.load_failures,
            wrapped: parts.wrapped,
            commonjs_exports: parts.commonjs_exports,
            plan,
        };
        for file in files {
            graph.add_file(file);
        }
        for requests in parts.inner_requests {
            let range = append(&mut graph.requests, requests);
            graph.plan.inner_requests.push(range);
        }
        graph.finish_plan(in_parallel);
        graph
    }

    fn add_file(&mut self, parts: FileParts) {
        let last_file = self.record_files.last();
        debug_assert!(last_file.is_none_or(|&last| last < parts.file));
        debug_assert!(parts.imports.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(parts.members.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(
            parts
                .members
                .iter()
                .map(|it| it.0)
                .eq(parts.accessed.iter().map(|it| it.0))
        );
        debug_assert!(parts.evaluating_sites.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(parts.holders.is_sorted_by(|a, b| a.symbol < b.symbol));
        debug_assert!(parts.exports.is_empty() || parts.interop.has_export_table());
        debug_assert!(!parts.has_top_level_await || parts.interop.kind == ModuleKind::SourceText);
        let file_spellings = append(&mut self.spellings, parts.spellings);
        let mut sites = parts.sites;
        rebase_candidates(&mut sites, &file_spellings);
        sites.shared_sort_unstable_by_key(|&(kind, _)| kind);
        debug_assert!(sites.is_sorted_by(|a, b| a.0 < b.0));
        self.entry_index_by_file[parts.file.idx()] = Some(to_u32(self.entries.len()));
        self.record_files.push(parts.file);
        self.entries.push(FileEntry {
            interop: parts.interop,
            runtime_module: parts.runtime_module,
            is_library: parts.is_library,
            has_dynamic_names: parts.has_dynamic_names,
            has_top_level_await: parts.has_top_level_await,
            has_no_side_effects: parts.has_no_side_effects,
            requests: append(&mut self.requests, parts.requests),
            sites: append(&mut self.sites, sites),
            imports: append(&mut self.imports, parts.imports),
            members: append(&mut self.members, parts.members),
            accessed: append(&mut self.accessed, parts.accessed),
            fixed_members: append(&mut self.fixed_members, parts.fixed_members),
            jsx: append(&mut self.jsx, parts.jsx),
            evaluating_sites: append(&mut self.evaluating_sites, parts.evaluating_sites),
            unread_sites: append(&mut self.unread_sites, parts.unread_sites),
            holders: append(&mut self.holders, parts.holders),
            exports: append(&mut self.exports, parts.exports),
            unread_exports: append(&mut self.unread_exports, parts.unread_exports),
            required_names: append(&mut self.required_names, parts.required_names),
        });
    }

    fn entry_index(&self, file: FileId) -> Option<u32> {
        self.entry_index_by_file.get(file.idx()).copied().flatten()
    }

    fn entry(&self, file: FileId) -> &FileEntry {
        let index = self.entry_index(file);
        &self.entries[index.expect("a file without a module record") as usize]
    }
}
