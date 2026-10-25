#[cfg(test)]
mod tests;

use super::ModuleRef;
use super::bindings::{
    AccessedModule, Candidates, ExportBinding, ExportLookup, ExportUse, Holder, ImportBinding,
    ModuleExport, ModuleRequest, RequiredName, SiteAnswer, SpelledModule, SyntheticExport,
    SyntheticExportId,
};
use super::commonjs_exports::CommonJsExports;
use super::compare_code_units;
use super::failures::{ModuleFailure, ModuleFailureId};
use super::imports::NamedMember;
use super::interop::{Interop, ModuleKind};
use super::order::SiteKey;
use super::plan::{Member, Plan, StoredSite};
use super::unread_exports::remove_unread_data_exports;
use super::wrapped::WrappedModules;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut};
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
    pub(super) project: ProjectId,
    pub(super) row_by_file: Vec<Option<u32>>,
    /// Ascending by file.
    pub(super) rows: Vec<FileRow>,
    pub(super) record_files: Vec<FileId>,
    pub(super) left_out_files: Vec<FileId>,
    pub(super) left_out_inner_modules: Vec<(FileId, FnId)>,
    pub(super) other_modules: Vec<ModuleRef>,
    pub(super) external_kinds: Vec<((FileId, Atom), ExternalKind)>,
    pub(super) synthetic_exports: Vec<SyntheticExport>,
    pub(super) errors: Vec<ModuleFailure>,
    pub(super) failures: Vec<ModuleFailure>,
    /// Ascending by file.
    pub(super) load_failures: Vec<(FileId, ModuleFailureId)>,
    pub(super) wrapped: WrappedModules,
    pub(super) commonjs_exports: CommonJsExports,
    pub(super) plan: Plan,
}

const fn assert_send_and_sync<T: Send + Sync + 'static>() {}

const _: () = assert_send_and_sync::<ModuleGraph>();

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
    /// The accesses that are bound to a name of a module: reads, stores and callees.
    pub members: Vec<(ExprId, ImportBinding)>,
    /// For each of `members`, the module that the access is written on.
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

pub(super) fn find<K: Copy + Ord, V: Copy>(entries: &[(K, V)], key: K) -> Option<V> {
    let at = entries.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(entries[at].1)
}

fn is_among(files: &[FileId], module: ModuleRef) -> bool {
    match module {
        ModuleRef::File(file)
        | ModuleRef::Inner { file, .. }
        | ModuleRef::Face(file)
        | ModuleRef::Check(file) => files.binary_search(&file).is_ok(),
        ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
    }
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
            ModuleRef::Inner { .. } => Interop::INNER_MODULE,
            // A face that has the loader capture what the file exports goes by the rule of the file.
            ModuleRef::Face(file) if self.commonjs_exports.face_captures(file) => Interop {
                export_rule: self.row(file).interop.export_rule,
                ..Interop::ES_MODULE
            },
            ModuleRef::Face(_) | ModuleRef::Check(_) => Interop::ES_MODULE,
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

    pub fn site_answer(&self, file: FileId, site: ImportSiteKind) -> SiteAnswer<'_> {
        let answer = self.find_site_answer(file, site);
        answer.expect("no live import site at this node")
    }

    pub fn find_site_answer(&self, file: FileId, site: ImportSiteKind) -> Option<SiteAnswer<'_>> {
        let row = self.find_row(file)?;
        let sites = &row.sites;
        let index = sites.binary_search_by_key(&site, |&(kind, _)| kind).ok()?;
        Some(match &sites[index].1 {
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
        find(&self.row(file).imports, symbol).unwrap_or(ImportBinding::Local)
    }

    pub fn member_binding(&self, file: FileId, member: ExprId) -> Option<ImportBinding> {
        let row = self.row(file);
        let members = &row.members;
        let index = members
            .binary_search_by_key(&member, |&(member, _)| member)
            .ok()?;
        let accessed = row.accessed[index].1;
        let is_namespace =
            accessed.is_imported || self.interop(accessed.module).kind != ModuleKind::CommonJs;
        is_namespace.then_some(members[index].1)
    }

    pub(super) fn find_stored_site(&self, file: FileId, key: SiteKey) -> Option<StoredSite> {
        find(&self.find_row(file)?.evaluating_sites, key)
    }

    /// By symbol. One that is needed as a value is an ordinary binding that holds the object. Final behind `finish_plan`.
    pub fn holders(&self, file: FileId) -> &[Holder] {
        debug_assert!(
            self.plan.is_finished,
            "a shape has changed since the plan was finished"
        );
        &self.row(file).holders
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
        self.plan.is_finished = false;
        self.pass_requests_through(files);
        self.left_out_files = files.to_vec();
        let synthetic_exports = &self.synthetic_exports;
        let is_left_out = |module: ModuleRef| is_among(files, module);
        let leads_to_left_out_file = |binding: ExportBinding| match binding {
            ExportBinding::Variable(symbol) => is_left_out(ModuleRef::File(symbol.file)),
            ExportBinding::Synthetic(id) => is_left_out(synthetic_exports[id.0 as usize].module),
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                is_left_out(module)
            }
        };
        for row in &mut self.rows {
            row.exports
                .retain(|export| !leads_to_left_out_file(export.binding));
            row.required_names.retain(|name| !is_left_out(name.module));
        }
        self.record_files
            .retain(|file| files.binary_search(file).is_err());
        // Each importer has a module of its own for what the build does not compile.
        self.other_modules.retain(|module| match *module {
            ModuleRef::External { importer, .. } => files.binary_search(&importer).is_err(),
            _ => true,
        });
        self.finish_plan(in_parallel);
    }

    /// A request all of whose sites stand in code that is left out goes. `finish_plan` has to follow.
    pub fn limit_requests(&mut self, keeps: impl Fn(ModuleRef, &ModuleRequest) -> bool) {
        self.plan.is_finished = false;
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
                let is_same = |earlier: &ModuleRequest| {
                    earlier.target == request.target && earlier.kind == request.kind
                };
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
                        match passed_on.iter_mut().find(|earlier| is_same(earlier)) {
                            Some(earlier) => {
                                earlier.is_dynamic_star_export |= request.is_dynamic_star_export
                            }
                            None => passed_on.push(request),
                        }
                    }
                    _ => {
                        if !passed_on.iter().any(is_same) {
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
        let is_inner_left_out = match module {
            ModuleRef::Inner { file, callback } => {
                let left_out = &self.left_out_inner_modules;
                left_out.binary_search(&(file, callback)).is_ok()
            }
            _ => false,
        };
        is_inner_left_out || is_among(&self.left_out_files, module)
    }

    pub fn limit_exports(
        &mut self,
        in_parallel: InParallel<'_>,
        find_use: &(dyn Fn(FileId, &ModuleExport) -> ExportUse + Sync),
    ) {
        const ROWS_IN_A_TASK: usize = 128;
        let mut tasks: Vec<&mut [FileRow]> = self.rows.chunks_mut(ROWS_IN_A_TASK).collect();
        for_each_mut(&mut tasks, in_parallel, &|rows| {
            for row in rows.iter_mut() {
                let file = row.file;
                row.exports.retain_mut(|export| {
                    let export_use = find_use(file, export);
                    export.is_read_from_object = export_use == ExportUse::ReadFromObject;
                    export_use != ExportUse::None
                });
            }
        });
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
        find(&self.load_failures, file)
    }

    pub fn unloadable_files(&self) -> impl Iterator<Item = FileId> + '_ {
        self.load_failures.iter().map(|&(file, _)| file)
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

    pub(super) fn finish(mut self, in_parallel: InParallel<'_>) -> ModuleGraph {
        remove_unread_data_exports(&mut self.rows);
        let (mut named_members, mut seen_namespaces) = (Vec::new(), Vec::new());
        for (index, row) in self.rows.iter_mut().enumerate() {
            named_members.append(&mut row.named_members);
            add_seen_namespaces(row, &mut seen_namespaces);
            row.sites.shared_sort_unstable_by_key(|&(kind, _)| kind);
            let index = u32::try_from(index).expect("a module list has more than u32::MAX entries");
            self.row_by_file[row.file.idx()] = Some(index);
            debug_assert!(row.sites.is_sorted_by(|a, b| a.0 < b.0));
            debug_assert!(row.imports.is_sorted_by(|a, b| a.0 < b.0));
            debug_assert!(row.members.is_sorted_by(|a, b| a.0 < b.0));
            let accessed = row.accessed.iter().map(|it| it.0);
            debug_assert!(row.members.iter().map(|it| it.0).eq(accessed));
            debug_assert!(row.evaluating_sites.is_sorted_by(|a, b| a.0 < b.0));
            debug_assert!(row.holders.is_sorted_by(|a, b| a.symbol < b.symbol));
            debug_assert!(row.exports.is_empty() || row.interop.has_export_table());
            debug_assert!(!row.has_top_level_await || row.interop.kind == ModuleKind::SourceText);
        }
        debug_assert!(self.rows.is_sorted_by(|a, b| a.file < b.file));
        self.record_files = self.rows.iter().map(|row| row.file).collect();
        self.plan.named_members = named_members.into_iter().collect();
        let ids = (0..).map(SyntheticExportId);
        let variables = self.synthetic_exports.iter().zip(ids);
        self.plan.variables = variables
            .map(|(export, id)| ((export.module, export.name), id))
            .collect();
        for module in seen_namespaces {
            self.set_namespace_is_seen(module);
        }
        let external_kinds = &mut self.external_kinds;
        external_kinds.shared_sort_unstable_by_key(|entry| external_key(entry.0));
        debug_assert!(external_kinds.is_sorted_by(|a, b| external_key(a.0) < external_key(b.0)));
        self.finish_plan(in_parallel);
        self
    }

    fn find_row(&self, file: FileId) -> Option<&FileRow> {
        let index = self.row_by_file.get(file.idx()).copied().flatten()?;
        Some(&self.rows[index as usize])
    }

    pub(super) fn row(&self, file: FileId) -> &FileRow {
        self.find_row(file).expect("a file without a module record")
    }
}
