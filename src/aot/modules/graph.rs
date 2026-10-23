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
    row_by_file: Vec<Option<u32>>,
    /// Ascending by file.
    rows: Vec<FileRow>,
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

pub(super) struct FileRow {
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
    pub files: Vec<FileRow>,
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

fn external_key(key: (FileId, Atom)) -> (FileId, u32) {
    (key.0, key.1.0)
}

fn spelled_in<'a>(row: &'a FileRow, range: &Range<u32>) -> &'a [SpelledModule] {
    &row.spellings[range.start as usize..range.end as usize]
}

// The modules whose namespace object something in the file may look at.
fn add_seen_namespaces(file: &FileRow, seen: &mut Vec<ModuleRef>) {
    seen.extend_from_slice(&file.namespace_values);
    for (site, answer) in &file.sites {
        match (site, answer) {
            (ImportSiteKind::ImportCall(_), StoredSiteAnswer::Module(module)) => seen.push(*module),
            (ImportSiteKind::ImportCall(_), StoredSiteAnswer::Candidates(range)) => {
                seen.extend(spelled_in(file, range).iter().map(|spelled| spelled.module));
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
        self.row(file).interop.kind
    }

    pub fn interop(&self, module: ModuleRef) -> Interop {
        match module {
            ModuleRef::File(file) => self.row(file).interop,
            ModuleRef::Inner { .. } => INNER_MODULE,
            // A face that has the loader capture what the file exports goes by the rule of the file.
            ModuleRef::Face(file) if self.commonjs_exports.face_captures(file) => Interop {
                export_rule: self.row(file).interop.export_rule,
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
        &self.row(file).requests
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
        let row = self.find_row(file)?;
        let index = row
            .sites
            .binary_search_by_key(&site, |&(kind, _)| kind)
            .ok()?;
        Some(match &row.sites[index].1 {
            StoredSiteAnswer::Module(module) => SiteAnswer::Module(*module),
            StoredSiteAnswer::AllModules => SiteAnswer::Computed(Candidates::All),
            StoredSiteAnswer::Candidates(range) => {
                SiteAnswer::Computed(Candidates::Modules(spelled_in(row, range)))
            }
            StoredSiteAnswer::Failed(failure) => SiteAnswer::Failed(*failure),
            StoredSiteAnswer::Erased => SiteAnswer::Erased,
        })
    }

    pub fn import_binding(&self, file: FileId, symbol: SymbolId) -> ImportBinding {
        let imports = &self.row(file).imports;
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
        &self.row(file).members
    }

    /// For each of `bound_members`, the module that the access is written on.
    pub fn accessed_modules(&self, file: FileId) -> &[(ExprId, AccessedModule)] {
        &self.row(file).accessed
    }

    pub(super) fn fixed_members(&self, file: FileId) -> &[(ExprId, (ModuleRef, Member))] {
        &self.row(file).fixed_members
    }

    pub(super) fn find_stored_site(&self, file: FileId, key: SiteKey) -> Option<StoredSite> {
        let sites = &self.find_row(file)?.evaluating_sites;
        let index = sites.binary_search_by_key(&key, |&(key, _)| key).ok()?;
        Some(sites[index].1)
    }

    pub(super) fn unread_sites(&self, file: FileId) -> &[(ExprId, bool)] {
        &self.row(file).unread_sites
    }

    /// By symbol. One that is needed as a value is an ordinary binding that holds the object. Final behind `finish_plan`.
    pub fn holders(&self, file: FileId) -> &[Holder] {
        debug_assert!(
            self.is_plan_finished(),
            "a shape has changed since the plan was finished"
        );
        &self.row(file).holders
    }

    pub(super) fn all_holders(&self) -> impl Iterator<Item = &Holder> {
        self.rows.iter().flat_map(|row| &row.holders)
    }

    pub(super) fn all_holders_mut(&mut self) -> impl Iterator<Item = &mut Holder> {
        self.rows.iter_mut().flat_map(|row| &mut row.holders)
    }

    pub fn jsx_binding(&self, file: FileId, import: JsxImport) -> ImportBinding {
        let mut bindings = self.row(file).jsx.iter();
        let binding = bindings.find(|(bound_import, _)| *bound_import == import);
        binding.expect("a JSX import that is not in use").1
    }

    /// The program never evaluates these files, which are in order.
    pub fn leave_out_files(&mut self, files: &[FileId], in_parallel: InParallel<'_>) {
        for row in &mut self.rows {
            row.has_no_side_effects = false;
        }
        if files.is_empty() {
            return self.finish_plan(in_parallel);
        }
        self.mark_plan_unfinished();
        self.pass_requests_through(files);
        self.left_out_files = files.to_vec();
        let ModuleGraph {
            rows,
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
        for row in rows {
            row.exports
                .retain(|export| !leads_to_left_out_file(export.binding));
            row.required_names.retain(|name| !is_left_out(name.module));
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
        for row in &mut self.rows {
            let module = ModuleRef::File(row.file);
            row.requests.retain(|request| keeps(module, request));
        }
        let plan = &mut self.plan;
        #[allow(clippy::needless_collect)] // ends the borrow of `plan`
        let inner_modules: Vec<ModuleRef> = plan
            .inner_modules()
            .iter()
            .map(|&(file, callback)| ModuleRef::Inner { file, callback })
            .collect();
        for (module, requests) in inner_modules.into_iter().zip(&mut plan.inner_requests) {
            requests.retain(|request| keeps(module, request));
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

    fn pass_requests_through(&mut self, left_out_files: &[FileId]) {
        let is_left_out = |file: FileId| left_out_files.binary_search(&file).is_ok();
        let mut lists = Vec::with_capacity(self.rows.len() + self.plan.inner_requests.len());
        let mut seen = FxHashSet::default();
        // With each request: whether the file has written it itself.
        let mut pending: Vec<(ModuleRequest, bool)> = Vec::new();
        let is_import = |request: &&ModuleRequest| request.kind == ModuleRequestKind::Import;
        let of_files = self.rows.iter().map(|row| &row.requests);
        for written in of_files.chain(&self.plan.inner_requests) {
            let mut passed_on = Vec::with_capacity(written.len());
            seen.clear();
            pending.extend(written.iter().rev().map(|&request| (request, true)));
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
                        match passed_on.iter_mut().find(is_same) {
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
                        if !passed_on.iter().any(is_asked_for) {
                            passed_on.push(ModuleRequest {
                                is_dynamic_star_export: false,
                                ..request
                            });
                        }
                    }
                }
            }
            lists.push(passed_on);
        }
        let mut lists = lists.into_iter();
        for (row, requests) in self.rows.iter_mut().zip(&mut lists) {
            row.requests = requests;
        }
        self.plan.inner_requests = lists.collect();
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
        for row in &mut self.rows {
            let file = row.file;
            row.exports
                .retain(|export| find_use(file, export) != ExportUse::None);
            for export in &mut row.exports {
                export.is_read_from_object = find_use(file, export) == ExportUse::ReadFromObject;
            }
        }
    }

    pub fn import_bindings(&self, file: FileId) -> &[(SymbolId, ImportBinding)] {
        &self.row(file).imports
    }

    pub fn jsx_bindings(&self, file: FileId) -> &[(JsxImport, ImportBinding)] {
        &self.row(file).jsx
    }

    pub fn exports(&self, file: FileId) -> &[ModuleExport] {
        &self.row(file).exports
    }

    pub fn unread_exports(&self, file: FileId) -> &[SymbolId] {
        &self.row(file).unread_exports
    }

    pub fn find_export(&self, module: ModuleRef, name: Atom, atoms: &Interner<'_>) -> ExportLookup {
        let row = match module {
            ModuleRef::File(file) => self.row(file),
            _ => return ExportLookup::Unknown,
        };
        if !row.interop.has_export_table() {
            return ExportLookup::Unknown;
        }
        let exports = &row.exports;
        let name_bytes = atoms.bytes(name);
        let position = exports
            .binary_search_by(|export| compare_code_units(atoms.bytes(export.name), name_bytes));
        match position.map(|position| exports[position]) {
            Ok(export) if export.can_be_ambiguous => ExportLookup::Unknown,
            Ok(export) => ExportLookup::Found(export.binding),
            Err(_) if name == known::__esModule => ExportLookup::Unknown,
            Err(_) if row.has_dynamic_names && name != known::default => ExportLookup::Unknown,
            Err(_) => ExportLookup::Absent,
        }
    }

    pub fn required_names(&self, file: FileId) -> &[RequiredName] {
        &self.row(file).required_names
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
        self.row_by_file.len()
    }

    pub fn record_files(&self) -> &[FileId] {
        &self.record_files
    }

    pub fn other_modules(&self) -> &[ModuleRef] {
        &self.other_modules
    }

    pub fn has_record(&self, file: FileId) -> bool {
        self.find_row(file).is_some()
    }

    pub fn is_library(&self, file: FileId) -> bool {
        self.row(file).is_library
    }

    pub fn runtime_module(&self, file: FileId) -> Option<RuntimeModule> {
        self.row(file).runtime_module
    }

    pub fn has_top_level_await(&self, file: FileId) -> bool {
        self.row(file).has_top_level_await
    }

    /// By `sideEffects` of its package.
    pub fn has_no_side_effects(&self, file: FileId) -> bool {
        self.row(file).has_no_side_effects
    }

    pub fn has_dynamic_names(&self, file: FileId) -> bool {
        self.row(file).has_dynamic_names
    }

    pub(super) fn new(parts: GraphParts, in_parallel: InParallel<'_>) -> ModuleGraph {
        let mut rows = parts.files;
        remove_unread_data_exports(&mut rows);
        let mut plan = parts.plan;
        let mut row_by_file = vec![None; parts.file_count];
        for (index, row) in rows.iter_mut().enumerate() {
            plan.named_members.append(&mut row.named_members);
            add_seen_namespaces(row, &mut plan.seen_namespaces);
            row.sites.shared_sort_unstable_by_key(|&(kind, _)| kind);
            row_by_file[row.file.idx()] = Some(to_u32(index));
            row.check();
        }
        debug_assert!(rows.is_sorted_by(|a, b| a.file < b.file));
        let mut plan = Plan::new(plan, &parts.synthetic_exports);
        plan.inner_requests = parts.inner_requests;
        let mut external_kinds = parts.external_kinds;
        external_kinds.shared_sort_unstable_by_key(|entry| external_key(entry.0));
        debug_assert!(external_kinds.is_sorted_by(|a, b| external_key(a.0) < external_key(b.0)));
        let mut graph = ModuleGraph {
            project: parts.project,
            row_by_file,
            record_files: rows.iter().map(|row| row.file).collect(),
            rows,
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
        graph.finish_plan(in_parallel);
        graph
    }

    fn find_row(&self, file: FileId) -> Option<&FileRow> {
        let index = self.row_by_file.get(file.idx()).copied().flatten()?;
        Some(&self.rows[index as usize])
    }

    fn row(&self, file: FileId) -> &FileRow {
        self.find_row(file).expect("a file without a module record")
    }
}

impl FileRow {
    fn check(&self) {
        debug_assert!(self.sites.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(self.imports.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(self.members.is_sorted_by(|a, b| a.0 < b.0));
        let accessed = self.accessed.iter().map(|it| it.0);
        debug_assert!(self.members.iter().map(|it| it.0).eq(accessed));
        debug_assert!(self.evaluating_sites.is_sorted_by(|a, b| a.0 < b.0));
        debug_assert!(self.holders.is_sorted_by(|a, b| a.symbol < b.symbol));
        debug_assert!(self.exports.is_empty() || self.interop.has_export_table());
        debug_assert!(!self.has_top_level_await || self.interop.kind == ModuleKind::SourceText);
    }
}
