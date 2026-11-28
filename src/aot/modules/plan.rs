#[cfg(test)]
mod tests;

use super::bindings::{
    AnswerMember, CopiedExports, Holder, ImportBinding, ModuleExport, ModuleRequest,
    SyntheticExportId, list_in_order_of_stars,
};
use super::commonjs_exports::AliasTarget;
use super::evaluation_ahead_of_link::EvaluationAheadOfLink;
use super::failures::ModuleFailureId;
use super::graph::{ModuleGraph, find};
use super::imports::{MockedModules, NamedMember};
use super::interop::{ImportPhase, ModuleKind};
use super::order::{OrderParts, SiteKey};
use super::requests::{Spelling, list_names_of_statements};
use super::spelled_files::TextThatSpellsFile;
use super::test_run_evictions::{NamedByCopies, is_marked};
use super::wrapped::InnerModuleKind;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut, map_each};
use crate::load::contents::load_names::{
    PathAlone, find_module_looked_up_in_cache, find_why_resolver_takes_name_for_path,
};
use crate::load::sources::EntryPoint;
use crate::statistics::{Stage, StepClock};
use bun_ast::Loader;
use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::hir::{ExprId, FnId, ImportEqualsId, StmtId};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sort_by_number::SortByNumber;
use core::ops::Range;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::collections::VecDeque;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleRef {
    File(FileId),
    Inner {
        file: FileId,
        callback: FnId,
    },
    /// The facade of a CommonJS module: the synthetic ES module that wraps it so that `import` can load it.
    Facade(FileId),
    Check(FileId),
    Runtime(RuntimeModule),
    External {
        importer: FileId,
        specifier: Atom,
        type_attribute: Option<Loader>,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Shape {
    EsModule,
    Names,
    Value,
    AsToday,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Site {
    Evaluate {
        target: ModuleRef,
        is_bare: bool,
        records: bool,
    },
    AsToday,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum View {
    Namespace(ModuleRef),
    Exports(ModuleRef),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Member {
    Variable(SyntheticExportId),
    Copy(SyntheticExportId),
    Binding(Sym),
    Undefined,
    Marker(bool),
    OnObject,
}

/// What a getter of a module's exports returns where every variable of `holders` is set. It throws elsewhere.
pub struct MemberBehindGetters {
    pub holders: SmallVec<[Sym; 2]>,
    pub member: Member,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct StoredSite {
    pub referrer: ModuleRef,
    pub target: ModuleRef,
    pub is_bare: bool,
}

struct LinkedFiles {
    by_importer: Vec<Vec<(ModuleRef, ImportPhase)>>,
    is_target: Vec<bool>,
    leads_to_target: Vec<bool>,
    is_gone_through: Vec<bool>,
}

struct Importer {
    file: FileId,
    next: u32,
    modules_ahead: usize,
    was_below_deferred_import: bool,
}

#[derive(Default)]
struct WalkOfImports {
    root_number: u32,
    last_root_that_came_to: Vec<u32>,
    path: Vec<Importer>,
    evaluation: EvaluationAheadOfLink,
}

impl WalkOfImports {
    fn begin(&mut self, root: FileId, file_count: usize) {
        self.root_number += 1;
        self.last_root_that_came_to.resize(file_count, 0);
        self.evaluation.begin(file_count);
        self.take_if_unseen(root);
        self.enter(root, ImportPhase::Evaluation);
    }

    fn enter(&mut self, file: FileId, phase: ImportPhase) {
        let evaluation = &mut self.evaluation;
        self.path.push(Importer {
            file,
            next: 0,
            modules_ahead: evaluation.count_modules_ahead(),
            was_below_deferred_import: evaluation.is_below_deferred_import,
        });
        evaluation.is_below_deferred_import |= phase == ImportPhase::Defer;
        evaluation.enter(file);
    }

    fn leave(&mut self) {
        let left = self.path.pop().expect("a file was entered");
        self.evaluation.leave();
        self.evaluation.pass_import(left.file, left.modules_ahead);
        self.evaluation.is_below_deferred_import = left.was_below_deferred_import;
    }

    fn pass_without_entering(&mut self, file: FileId, phase: ImportPhase) {
        self.evaluation.come_back_to(file);
        if phase != ImportPhase::Defer {
            let modules_ahead = self.evaluation.count_modules_ahead();
            self.evaluation.pass_import(file, modules_ahead);
        }
    }

    fn take_if_unseen(&mut self, file: FileId) -> bool {
        let last = &mut self.last_root_that_came_to[file.idx()];
        core::mem::replace(last, self.root_number) != self.root_number
    }
}

fn find_files_that_lead_to(
    targets: Vec<FileId>,
    imports: &[(FileId, FileId)],
    file_count: usize,
) -> Vec<bool> {
    let mut leads_there = vec![false; file_count];
    if targets.is_empty() {
        return leads_there;
    }
    let mut bounds = vec![0u32; file_count + 1];
    for &(imported, _) in imports {
        bounds[imported.idx()] += 1;
    }
    let mut end = 0;
    for bound in &mut bounds {
        end += *bound;
        *bound = end;
    }
    let mut importers = vec![FileId(0); imports.len()];
    for &(imported, importer) in imports {
        bounds[imported.idx()] -= 1;
        importers[bounds[imported.idx()] as usize] = importer;
    }
    let mut pending = targets;
    while let Some(file) = pending.pop() {
        if core::mem::replace(&mut leads_there[file.idx()], true) {
            continue;
        }
        let (first, end) = (bounds[file.idx()], bounds[file.idx() + 1]);
        pending.extend_from_slice(&importers[first as usize..end as usize]);
    }
    leads_there
}

pub(super) struct Plan {
    order: OrderParts,
    inner_callbacks: Vec<FnId>,
    keeps_module_object: Vec<bool>,
    reaches_module_objects: Vec<bool>,
    exposes_global_object: Vec<bool>,
    is_found_by_name: Vec<bool>,
    is_every_require_seen: bool,
    is_namespace_seen: Vec<bool>,
    is_marker_stored: Vec<bool>,
    is_imported_as_namespace: Vec<bool>,
    externals_imported_as_namespace: Vec<ModuleRef>,
    externals_named_by_mocks: Vec<ModuleRef>,
    absent_modules: Vec<ModuleRef>,
    test_files_that_ask_loader: Vec<FileId>,
    may_be_mocked: Vec<bool>,
    is_named_by_mock: Vec<bool>,
    is_any_module_named_by_mock: bool,
    /// The files whose mocks all have known names, with the names.
    names_of_mocks: FxHashMap<FileId, Vec<Atom>>,
    spied_names: FxHashSet<Atom>,
    runtime_modules_named_by_mocks: Vec<RuntimeModule>,
    names_without_code_that_mocks_give: Vec<Atom>,
    files_with_late_stars: Vec<FileId>,
    mocked_runtime_modules: Vec<RuntimeModule>,
    may_mock_every_module: bool,
    originals_beside_mocks_may_run: bool,
    /// The files that a mock names and that lie on no cycle of loads, where originals of mocks may run.
    runs_as_original: Vec<bool>,
    exposed_runtime_modules: Vec<RuntimeModule>,
    exposes_all_runtime_modules: bool,
    runs_tests: bool,
    is_imported_without_extension: Vec<bool>,
    is_imported_with_other_extension: Vec<bool>,
    is_imported_as_directory: Vec<bool>,
    may_evict_every_module: bool,
    pub(super) named_by_copies: NamedByCopies,
    reaches_entries_of_cache: Option<bool>,
    library_modules_stored_in_cache: Vec<RuntimeModule>,
    asks_loader_functions: bool,
    is_closed_world: bool,
    computed_names_ask_loader_functions: bool,
    answers_for_names_itself: bool,
    names_of_statements: FxHashMap<FileId, Vec<Atom>>,
    may_be_reevaluated: Vec<bool>,
    has_es_module_that_runs_again: Vec<bool>,
    replaced_variables: Vec<Sym>,
    makers_of_imported_requires: Vec<FileId>,
    erased_statements: Vec<(FileId, StmtId)>,
    pub named_members: FxHashMap<(ModuleRef, Atom), NamedMember<ImportBinding>>,
    pub variables: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    pub(super) inner_requests: Vec<Vec<ModuleRequest>>,
    final_requests: Vec<ModuleRequest>,
    final_ranges: FxHashMap<ModuleRef, Range<u32>>,
    final_checks: FxHashMap<FileId, Vec<(SyntheticExportId, ModuleFailureId)>>,
    pub is_finished: bool,
    pub(super) are_holders_settled: bool,
    pub(super) test_run: crate::test_runs::TestRunPlan,
}

impl Plan {
    pub(super) fn new(order: OrderParts, mut erased_statements: Vec<(FileId, StmtId)>) -> Plan {
        erased_statements.sort_unstable();
        let inner_modules = order.numbers.inner_modules().iter();
        Plan {
            inner_callbacks: inner_modules.map(|inner| inner.1).collect(),
            keeps_module_object: vec![false; order.numbers.len()],
            reaches_module_objects: vec![false; order.numbers.len()],
            exposes_global_object: vec![false; order.numbers.len()],
            is_found_by_name: vec![false; order.numbers.len()],
            is_every_require_seen: false,
            is_namespace_seen: vec![false; order.numbers.len()],
            is_marker_stored: vec![false; order.numbers.len()],
            is_imported_as_namespace: vec![false; order.numbers.len()],
            externals_imported_as_namespace: Vec::new(),
            externals_named_by_mocks: Vec::new(),
            absent_modules: Vec::new(),
            test_files_that_ask_loader: Vec::new(),
            may_be_mocked: vec![false; order.numbers.len()],
            is_named_by_mock: vec![false; order.numbers.len()],
            is_any_module_named_by_mock: false,
            names_of_mocks: FxHashMap::default(),
            spied_names: FxHashSet::default(),
            runtime_modules_named_by_mocks: Vec::new(),
            names_without_code_that_mocks_give: Vec::new(),
            files_with_late_stars: Vec::new(),
            mocked_runtime_modules: Vec::new(),
            may_mock_every_module: false,
            originals_beside_mocks_may_run: false,
            runs_as_original: Vec::new(),
            exposed_runtime_modules: Vec::new(),
            exposes_all_runtime_modules: false,
            runs_tests: false,
            is_imported_without_extension: vec![false; order.numbers.len()],
            is_imported_with_other_extension: vec![false; order.numbers.len()],
            is_imported_as_directory: vec![false; order.numbers.len()],
            may_evict_every_module: false,
            named_by_copies: NamedByCopies::default(),
            reaches_entries_of_cache: None,
            library_modules_stored_in_cache: Vec::new(),
            asks_loader_functions: false,
            is_closed_world: false,
            computed_names_ask_loader_functions: false,
            answers_for_names_itself: false,
            names_of_statements: FxHashMap::default(),
            may_be_reevaluated: vec![false; order.numbers.len()],
            has_es_module_that_runs_again: vec![false; order.numbers.len()],
            replaced_variables: Vec::new(),
            makers_of_imported_requires: Vec::new(),
            order,
            erased_statements,
            named_members: FxHashMap::default(),
            variables: FxHashMap::default(),
            inner_requests: Vec::new(),
            final_requests: Vec::new(),
            final_ranges: FxHashMap::default(),
            final_checks: FxHashMap::default(),
            is_finished: false,
            are_holders_settled: false,
            test_run: crate::test_runs::TestRunPlan::default(),
        }
    }

    pub(super) fn reopen(&mut self) {
        self.is_finished = false;
        self.are_holders_settled = false;
    }

    fn has(&self, set: &[bool], module: ModuleRef) -> bool {
        let number = self.order.numbers.number_of(module);
        number.is_some_and(|number| set[number])
    }

    fn add(&mut self, set: fn(&mut Plan) -> &mut Vec<bool>, module: ModuleRef) {
        if let Some(number) = self.order.numbers.number_of(module) {
            set(self)[number] = true;
        }
    }

    pub(super) fn set_marker_is_stored(&mut self, module: ModuleRef) {
        self.add(|plan| &mut plan.is_marker_stored, module);
    }

    pub(super) fn set_is_imported_as_namespace(&mut self, module: ModuleRef) {
        self.add(|plan| &mut plan.is_imported_as_namespace, module);
        if matches!(module, ModuleRef::External { .. }) {
            self.externals_imported_as_namespace.push(module);
        }
    }

    pub(super) fn set_may_be_mocked(&mut self, module: ModuleRef) {
        match module {
            ModuleRef::Runtime(module) => self.mocked_runtime_modules.push(module),
            _ => self.add(|plan| &mut plan.may_be_mocked, module),
        }
    }

    pub(super) fn set_is_named_by_mock(&mut self, module: ModuleRef) {
        self.is_any_module_named_by_mock = true;
        match module {
            ModuleRef::Runtime(module) => {
                if !self.runtime_modules_named_by_mocks.contains(&module) {
                    self.runtime_modules_named_by_mocks.push(module);
                }
            }
            ModuleRef::External { .. } => self.externals_named_by_mocks.push(module),
            _ => self.add(|plan| &mut plan.is_named_by_mock, module),
        }
    }

    pub(super) fn set_absent_modules(&mut self, modules: Vec<ModuleRef>) {
        self.absent_modules = modules;
    }

    pub(super) fn set_test_files_that_ask_loader(&mut self, files: Vec<FileId>) {
        self.test_files_that_ask_loader = files;
    }

    pub(super) fn set_names_of_mocks(&mut self, mocked: &MockedModules) {
        self.names_of_mocks.clone_from(mocked.names());
        (self.spied_names).clone_from(mocked.spied_names());
    }

    pub(super) fn expose_runtime_module(&mut self, module: RuntimeModule) {
        if !self.exposed_runtime_modules.contains(&module) {
            self.exposed_runtime_modules.push(module);
        }
    }

    pub(super) fn expose_all_runtime_modules(&mut self) {
        self.exposes_all_runtime_modules = true;
    }

    pub(super) fn set_runs_tests(&mut self) {
        self.runs_tests = true;
    }

    pub(super) fn set_is_imported_by_alias(&mut self, module: ModuleRef, spelling: Spelling) {
        match spelling {
            Spelling::WithoutExtension => {
                self.add(|plan| &mut plan.is_imported_without_extension, module);
            }
            Spelling::WithOtherExtension => {
                self.add(|plan| &mut plan.is_imported_with_other_extension, module);
            }
            Spelling::AsDirectory => self.add(|plan| &mut plan.is_imported_as_directory, module),
        }
    }

    pub(super) fn set_may_be_reevaluated(&mut self, module: ModuleRef, is_es_module: bool) {
        self.add(|plan| &mut plan.may_be_reevaluated, module);
        if is_es_module && let Some(number) = self.order.numbers.number_of(module) {
            let component = self.order.component_of[number];
            self.has_es_module_that_runs_again[component as usize] = true;
        }
    }

    pub(super) fn set_every_module_may_be_evicted(&mut self) {
        self.may_evict_every_module = true;
    }

    pub(super) fn set_reaches_entries_of_cache(&mut self, reaches: bool) {
        self.reaches_entries_of_cache = Some(reaches);
    }

    pub(super) fn set_library_modules_stored_in_cache(&mut self, modules: &[RuntimeModule]) {
        self.library_modules_stored_in_cache = modules.to_vec();
    }

    pub(super) fn set_every_module_may_be_mocked(&mut self) {
        self.may_mock_every_module = true;
    }

    pub(super) fn set_originals_beside_mocks_may_run(&mut self, runs_as_original: Vec<bool>) {
        self.originals_beside_mocks_may_run = true;
        self.runs_as_original = runs_as_original;
    }

    pub(super) fn set_files_with_late_stars(&mut self, files: Vec<FileId>) {
        self.files_with_late_stars = files;
    }

    pub(super) fn set_names_without_code_that_mocks_give(&mut self, names: Vec<Atom>) {
        for name in names {
            if !self.names_without_code_that_mocks_give.contains(&name) {
                self.names_without_code_that_mocks_give.push(name);
            }
        }
    }

    pub(super) fn set_replaced_variables(&mut self, mut variables: Vec<Sym>) {
        variables.sort_unstable();
        variables.dedup();
        self.replaced_variables = variables;
    }

    pub(super) fn set_makers_of_imported_requires(&mut self, mut makers: Vec<FileId>) {
        makers.sort_unstable();
        makers.dedup();
        self.makers_of_imported_requires = makers;
    }

    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        self.order.numbers.inner_modules()
    }

    fn inner_modules_of(&self, file: FileId) -> Range<usize> {
        let inner_modules = self.order.numbers.inner_modules();
        let start = inner_modules.partition_point(|inner| inner.0 < file);
        let end = inner_modules.partition_point(|inner| inner.0 <= file);
        start..end
    }

    fn inner_callbacks_of(&self, file: FileId) -> &[FnId] {
        &self.inner_callbacks[self.inner_modules_of(file)]
    }
}

impl ModuleGraph {
    pub fn shape(&self, module: ModuleRef) -> Shape {
        match module {
            ModuleRef::File(_) | ModuleRef::Inner { .. } if !self.is_code_of_program(module) => {
                Shape::AsToday
            }
            ModuleRef::File(file) => match self.kind(file) {
                ModuleKind::SourceText => Shape::EsModule,
                ModuleKind::CommonJs => self.commonjs().shape(module),
                _ => Shape::AsToday,
            },
            ModuleRef::Inner { file, callback } => {
                match self
                    .wrapped()
                    .of_callback(file, callback)
                    .map(|inner| inner.kind)
                {
                    Some(InnerModuleKind::Esm) => Shape::EsModule,
                    Some(InnerModuleKind::CommonJs) => self.commonjs().shape(module),
                    None => Shape::AsToday,
                }
            }
            ModuleRef::Facade(_) | ModuleRef::Check(_) => Shape::EsModule,
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => Shape::AsToday,
        }
    }

    pub fn is_code_of_program(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.order.is_code_of_program, module)
    }

    pub fn stored_site(&self, file: FileId, call: ExprId) -> Option<Site> {
        let site = self.find_stored_site(file, SiteKey::Call(call))?;
        Some(self.finish_site(site))
    }

    /// The module that the function evaluates which the call makes.
    pub fn requested_module(&self, file: FileId, call: ExprId) -> Option<Site> {
        let site = self.find_stored_site(file, SiteKey::Request(call))?;
        Some(self.finish_site(site))
    }

    /// The module around a call that evaluates a module, or that makes a function that does.
    pub fn find_referrer(&self, file: FileId, call: ExprId) -> Option<ModuleRef> {
        let keys = [SiteKey::Call(call), SiteKey::Request(call)];
        let site = keys
            .into_iter()
            .find_map(|key| self.find_stored_site(file, key))?;
        Some(site.referrer)
    }

    /// The module around the call that makes such a function.
    pub fn find_requester(&self, file: FileId, call: ExprId) -> Option<ModuleRef> {
        let site = self.find_stored_site(file, SiteKey::Request(call))?;
        Some(site.referrer)
    }

    pub fn site(&self, file: FileId, call: ExprId) -> Option<Site> {
        if let Some(site) = self.stored_site(file, call) {
            return Some(site);
        }
        let row = self.row_by_file.get(file.idx()).copied().flatten()?;
        let sites = &self.rows[row as usize].sites;
        let (first, last) = (sites.first()?.0, sites.last()?.0);
        let kinds = [
            ImportSiteKind::Require(call),
            ImportSiteKind::ImportMetaRequire(call),
        ];
        let is_site = |&kind: &ImportSiteKind| {
            let is_within = first <= kind && kind <= last;
            is_within && sites.binary_search_by_key(&kind, |site| site.0).is_ok()
        };
        kinds.iter().any(is_site).then_some(Site::AsToday)
    }

    pub fn import_equals_site(&self, file: FileId, declaration: ImportEqualsId) -> Option<Site> {
        if let Some(site) = self.find_stored_site(file, SiteKey::ImportEquals(declaration)) {
            return Some(self.finish_site(site));
        }
        let kind = ImportSiteKind::ImportEquals(declaration);
        self.find_site_answer(file, kind).map(|_| Site::AsToday)
    }

    pub fn site_at(&self, file: FileId, site: ImportSiteKind) -> Option<Site> {
        match site {
            ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                self.site(file, call)
            }
            ImportSiteKind::ImportEquals(declaration) => self.import_equals_site(file, declaration),
            _ => None,
        }
    }

    fn finish_site(&self, site: StoredSite) -> Site {
        let shows_mark = self.shape(site.target) == Shape::EsModule
            && self.plan.has(&self.plan.is_namespace_seen, site.target);
        let is_child_of_referrer = match (site.target, site.referrer) {
            (ModuleRef::Inner { .. }, _) => false,
            (_, ModuleRef::Inner { file, .. }) => self.keeps_module_object(ModuleRef::File(file)),
            (_, referrer) => self.keeps_module_object(referrer),
        };
        Site::Evaluate {
            target: site.target,
            is_bare: site.is_bare,
            records: shows_mark
                || is_child_of_referrer
                || self.keeps_module_object(site.target)
                || (self.plan.is_every_require_seen && matches!(site.target, ModuleRef::File(_))),
        }
    }

    pub fn is_site_read_as_value(&self, file: FileId, call: ExprId) -> bool {
        let Some(is_unread_in_every_shape) = find(&self.row(file).unread_sites, call) else {
            return true;
        };
        if is_unread_in_every_shape {
            return false;
        }
        let Some(site) = self.find_stored_site(file, SiteKey::Call(call)) else {
            return true;
        };
        !self.stands_without_object(site.target)
            || (self.holders_of_call(file, call)).any(|holder| holder.is_needed_as_value)
    }

    fn holders_of_call(&self, file: FileId, call: ExprId) -> impl Iterator<Item = &Holder> {
        let holders = self.holders(file);
        let by_call = self.row(file).holders_by_call.get_or_init(|| {
            let mut by_call: Vec<u32> = (0..holders.len() as u32).collect();
            by_call.sort_by_u32(|&at| holders[at as usize].call.0);
            by_call
        });
        let first = by_call.partition_point(|&at| holders[at as usize].call.0 < call.0);
        (by_call[first..].iter())
            .map(|&at| &holders[at as usize])
            .take_while(move |holder| holder.call == call)
    }

    fn stands_without_object(&self, module: ModuleRef) -> bool {
        match self.shape(module) {
            Shape::EsModule | Shape::Names => true,
            Shape::Value | Shape::AsToday => false,
        }
    }

    pub fn holder(&self, file: FileId, symbol: SymbolId) -> Option<View> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        (!holders[at].is_needed_as_value).then_some(holders[at].view)
    }

    /// The holder in `const { name } = holder`, where each name is read from the module.
    pub fn module_of_destructured_holder(&self, file: FileId, holder: ExprId) -> Option<ModuleRef> {
        let (symbol, module) = find(&self.row(file).destructured_holders, holder)?;
        self.holder(file, symbol).is_some().then_some(module)
    }

    pub fn destructured_holders(
        &self,
        file: FileId,
    ) -> impl Iterator<Item = (ExprId, ModuleRef)> + '_ {
        let holders = self.row(file).destructured_holders.iter();
        holders.filter_map(move |&(holder, (symbol, module))| {
            self.holder(file, symbol)
                .is_some()
                .then_some((holder, module))
        })
    }

    pub fn call_of_holder(&self, file: FileId, symbol: SymbolId) -> Option<ExprId> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        (!holders[at].is_needed_as_value).then_some(holders[at].call)
    }

    fn holder_of_unmarked_copy(
        &self,
        file: FileId,
        symbol: SymbolId,
    ) -> Option<(Holder, CopiedExports)> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        let holder = holders[at];
        let copy = holder.copy?;
        (holder.is_needed_as_value && copy.runs_once && !copy.has_marker).then_some((holder, copy))
    }

    pub fn holder_of_answer(
        &self,
        file: FileId,
        symbol: SymbolId,
    ) -> Option<(ExprId, CopiedExports)> {
        let (holder, copy) = self.holder_of_unmarked_copy(file, symbol)?;
        let holds_answer = copy.may_hold_answer && !copy.is_looked_at && !copy.is_called_through;
        holds_answer.then_some((holder.call, copy))
    }

    pub fn holder_of_copy(
        &self,
        file: FileId,
        symbol: SymbolId,
    ) -> Option<(ExprId, CopiedExports)> {
        let (holder, copy) = self.holder_of_unmarked_copy(file, symbol)?;
        let reads_answer = copy.is_of_ordinary_object
            && self.holder_of_answer(file, symbol).is_none()
            && !self.names_read_on_answer(file, symbol).is_empty();
        reads_answer.then_some((holder.call, copy))
    }

    pub fn names_read_on_answer(&self, file: FileId, holder: SymbolId) -> &[(SymbolId, Atom)] {
        let names = &self.row(file).names_read_on_answers;
        let start = names.partition_point(|name| name.0 < holder);
        let count = names[start..].partition_point(|name| name.0 == holder);
        &names[start..start + count]
    }

    pub fn answer_member(&self, file: FileId, access: ExprId) -> Option<AnswerMember> {
        let member = find(&self.row(file).answer_members, access)?;
        let is_read_on_answer = self.holder_of_answer(file, member.holder).is_some()
            || (member.name.is_some() && self.holder_of_copy(file, member.holder).is_some());
        is_read_on_answer.then_some(member)
    }

    pub fn member(&self, file: FileId, access: ExprId) -> Option<Member> {
        let row = self.row(file);
        if let Some((module, member)) = find(&row.fixed_members, access) {
            if matches!(member, Member::Binding(_)) && !self.runs_body_once(module) {
                return None;
            }
            return Some(self.finish_fixed_member(module, member));
        }
        let Some(binding) = find(&row.members, access) else {
            let member = self.commonjs().own_member(file, access);
            return match self.stores_what_variable_holds(file, access, member) {
                true => Some(Member::Undefined),
                false => member,
            };
        };
        let accessed = find(&row.accessed, access)?;
        self.finish_member(accessed.module, binding, accessed.is_imported)
    }

    pub fn member_behind_getters(
        &self,
        file: FileId,
        access: ExprId,
    ) -> Option<MemberBehindGetters> {
        let accessed = find(&self.row(file).accessed, access)?;
        let (mut module, mut name) = (accessed.module, accessed.name);
        if accessed.is_imported
            || self.shape(module) != Shape::Value
            || !self.runs_body_once(ModuleRef::File(file))
        {
            return None;
        }
        let mut holders = SmallVec::new();
        for _ in 0..=self.commonjs().module_count() {
            let ModuleRef::Inner {
                file: written_in, ..
            } = module
            else {
                return None;
            };
            if written_in != file || !self.runs_body_once(module) {
                return None;
            }
            let getter = self.commonjs().read_getter(module, name)?;
            let (source, name_there) = match getter.target {
                AliasTarget::Binding(symbol) => {
                    let member = Member::Binding(symbol);
                    return Some(MemberBehindGetters { holders, member });
                }
                AliasTarget::Member { module, name } => (module, name),
            };
            holders.push(Sym {
                file,
                id: getter.holder?,
            });
            match self.member(file, getter.returned)? {
                Member::OnObject => (module, name) = (source, name_there),
                Member::Copy(_) => return None,
                member => return Some(MemberBehindGetters { holders, member }),
            }
        }
        None
    }

    /// `limit` of `__export(lib, { limit: () => limit }); lib.limit`: the variables of the file that members name.
    pub fn bindings_read_as_members(&self, file: FileId) -> impl Iterator<Item = SymbolId> + '_ {
        let members = self.row(file).fixed_members.iter();
        members.filter_map(move |&(_, (_, member))| match member {
            Member::Binding(symbol) if symbol.file == file => Some(symbol.id),
            _ => None,
        })
    }

    fn stores_what_variable_holds(
        &self,
        file: FileId,
        access: ExprId,
        member: Option<Member>,
    ) -> bool {
        let Some(Member::Variable(export)) = member else {
            return false;
        };
        let module = self.commonjs().module_of_store_of_nothing(file, access);
        module.is_some_and(|module| {
            self.synthetic_export(export).module == module && self.runs_body_once(module)
        })
    }

    pub fn runs_body_once(&self, module: ModuleRef) -> bool {
        let begins_once = match module {
            ModuleRef::File(file) => {
                self.caches_evaluation_error(module) && !self.may_be_reevaluated(file)
            }
            ModuleRef::Inner { .. } => true,
            _ => false,
        };
        begins_once && !self.may_be_evicted(module) && !self.may_be_mocked(module)
    }

    pub fn member_named(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        match self.plan.named_members.get(&(module, name)) {
            Some(&NamedMember::Fixed(member)) => Some(self.finish_fixed_member(module, member)),
            Some(&NamedMember::Binding(binding)) => self.finish_member(module, binding, false),
            None => {
                let variable = self.variable_of(module, name)?;
                Some(self.commonjs().required_member(module, variable))
            }
        }
    }

    pub fn binding_of_member_named(&self, module: ModuleRef, name: Atom) -> Option<ImportBinding> {
        match self.plan.named_members.get(&(module, name)) {
            Some(&NamedMember::Binding(binding)) => Some(binding),
            Some(NamedMember::Fixed(_)) | None => None,
        }
    }

    fn is_object_seen(&self, module: ModuleRef) -> bool {
        match self.shape(module) {
            Shape::EsModule => self.plan.has(&self.plan.is_namespace_seen, module),
            Shape::Names => false,
            Shape::Value | Shape::AsToday => true,
        }
    }

    fn finish_fixed_member(&self, module: ModuleRef, member: Member) -> Member {
        match member {
            Member::Marker(_) if self.is_object_seen(module) => Member::OnObject,
            Member::Marker(_) => self.marker(module).map_or(Member::OnObject, Member::Marker),
            _ => member,
        }
    }

    fn finish_member(
        &self,
        accessed: ModuleRef,
        binding: ImportBinding,
        is_imported: bool,
    ) -> Option<Member> {
        let is_es_module = match self.shape(accessed) {
            Shape::EsModule => true,
            Shape::Names | Shape::Value => false,
            Shape::AsToday => return None,
        };
        match binding {
            ImportBinding::Variable(symbol) => {
                match is_es_module || self.stands_without_object(accessed) {
                    true => Some(Member::Binding(symbol)),
                    false => Some(Member::OnObject),
                }
            }
            ImportBinding::Synthetic(_) if is_es_module => None,
            ImportBinding::Synthetic(variable) => Some(match is_imported {
                true => self.commonjs().imported_member(variable),
                false => self.commonjs().required_member(accessed, variable),
            }),
            _ => None,
        }
    }

    pub fn variable_of(&self, module: ModuleRef, name: Atom) -> Option<SyntheticExportId> {
        self.plan.variables.get(&(module, name)).copied()
    }

    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        let erased_statements = &self.plan.erased_statements;
        erased_statements.binary_search(&(file, statement)).is_ok()
            || self.commonjs().erased(file, statement)
            || self.is_placeholder(file)
    }

    pub fn half(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.order.is_half, module)
    }

    pub fn may_run_before(&self, importer: ModuleRef, exporter: ModuleRef) -> bool {
        self.half(importer) || self.may_run_before_on_one_ring(importer, exporter)
    }

    pub fn may_run_before_on_one_ring(&self, importer: ModuleRef, exporter: ModuleRef) -> bool {
        let order = &self.plan.order;
        let component =
            |module: ModuleRef| Some(order.component_of[order.numbers.number_of(module)?]);
        component(importer) == component(exporter)
            || self.plan.has(&order.is_required_at_any_time, importer)
    }

    pub fn is_loaded_by_loader(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self.plan.has(&self.plan.order.is_loaded_by_loader, module)
    }

    pub fn is_required_during_load(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.is_required_during_load, module)
    }

    pub fn may_fail_in_require(&self, file: FileId) -> bool {
        self.plan
            .has(&self.plan.order.may_fail_in_require, ModuleRef::File(file))
    }

    pub fn is_importable_during_evaluation(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.is_importable_during_evaluation, module)
    }

    pub fn is_imported_as_namespace(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.is_imported_as_namespace, module)
            || self.plan.externals_imported_as_namespace.contains(&module)
    }

    pub fn runs_tests(&self) -> bool {
        self.plan.runs_tests
    }

    pub fn lists_files_in_cache(&self) -> bool {
        self.plan.runs_tests
    }

    pub fn may_be_evicted(&self, module: ModuleRef) -> bool {
        !matches!(module, ModuleRef::Inner { .. })
            && (self.plan.may_evict_every_module
                || is_marked(&self.plan.test_run.may_be_evicted, module))
    }

    pub fn is_reloadable(&self, file: FileId) -> bool {
        is_marked(&self.plan.test_run.is_reloadable, ModuleRef::File(file))
    }

    pub fn is_named_by_copies(&self, module: ModuleRef) -> bool {
        self.plan.named_by_copies.contains(module)
    }

    pub fn reaches_entries_of_cache(&self) -> bool {
        let plan = &self.plan;
        plan.may_evict_every_module
            || (self.lists_files_in_cache() && plan.reaches_entries_of_cache.unwrap_or(true))
    }

    pub fn may_entry_in_cache_stand_under(&self, name: &[u8]) -> bool {
        let stored = &self.plan.library_modules_stored_in_cache;
        !stored.is_empty()
            && find_module_looked_up_in_cache(name).is_some_and(|module| stored.contains(&module))
    }

    pub fn rejects_require_cache_override(&self, module: RuntimeModule) -> bool {
        let stored = &self.plan.library_modules_stored_in_cache;
        module != RuntimeModule::Bun && !stored.contains(&module)
    }

    pub fn is_imported_by_alias(&self, module: ModuleRef, spelling: Spelling) -> bool {
        let set = match spelling {
            Spelling::WithoutExtension => &self.plan.is_imported_without_extension,
            Spelling::WithOtherExtension => &self.plan.is_imported_with_other_extension,
            Spelling::AsDirectory => &self.plan.is_imported_as_directory,
        };
        self.plan.has(set, module)
    }

    pub fn may_be_reevaluated(&self, file: FileId) -> bool {
        matches!(
            self.kind(file),
            ModuleKind::SourceText | ModuleKind::CommonJs
        ) && self
            .plan
            .has(&self.plan.may_be_reevaluated, ModuleRef::File(file))
    }

    pub fn is_instantiated_ahead(&self, file: FileId) -> bool {
        self.has_instances(file) || self.is_in_rerun_component(file)
    }

    pub fn is_in_rerun_component(&self, file: FileId) -> bool {
        let order = &self.plan.order;
        let module = ModuleRef::File(file);
        self.kind(file) == ModuleKind::SourceText
            && self.half(module)
            && order.numbers.number_of(module).is_some_and(|number| {
                self.plan.has_es_module_that_runs_again[order.component_of[number] as usize]
            })
    }

    pub fn makes_scope_ahead(&self, file: FileId) -> bool {
        self.is_instantiated_ahead(file) && self.may_be_reevaluated(file)
    }

    pub fn may_be_mocked(&self, module: ModuleRef) -> bool {
        let plan = &self.plan;
        (plan.may_mock_every_module && module != ModuleRef::Runtime(RuntimeModule::BunTest))
            || match module {
                ModuleRef::Runtime(module) => plan.mocked_runtime_modules.contains(&module),
                _ => plan.has(&plan.may_be_mocked, module),
            }
    }

    pub fn is_named_by_mock(&self, module: ModuleRef) -> bool {
        let plan = &self.plan;
        match module {
            ModuleRef::Runtime(module) => plan.runtime_modules_named_by_mocks.contains(&module),
            ModuleRef::External { .. } => {
                plan.may_mock_every_module || plan.externals_named_by_mocks.contains(&module)
            }
            _ => plan.may_mock_every_module || plan.has(&plan.is_named_by_mock, module),
        }
    }

    /// The names that the mocks of the file have, if they are known.
    pub fn names_of_mocks(&self, file: FileId) -> Option<&[Atom]> {
        match self.plan.may_mock_every_module {
            true => None,
            false => self.plan.names_of_mocks.get(&file).map(|names| &names[..]),
        }
    }

    /// Whether a spy may add the name to any mock.
    pub fn is_installed_by_spy(&self, name: Atom) -> bool {
        self.plan.spied_names.contains(&name)
    }

    pub fn is_any_module_named_by_mock(&self) -> bool {
        self.plan.may_mock_every_module || self.plan.is_any_module_named_by_mock
    }

    pub fn is_exposed_by_test_runner(&self, module: RuntimeModule) -> bool {
        let plan = &self.plan;
        plan.exposes_all_runtime_modules || plan.exposed_runtime_modules.contains(&module)
    }

    pub fn is_named_to_test_runner(&self, module: RuntimeModule) -> bool {
        let named = &self.plan.exposed_runtime_modules;
        named.contains(&module)
    }

    pub fn runtime_modules_named_by_mocks(&self) -> &[RuntimeModule] {
        &self.plan.runtime_modules_named_by_mocks
    }

    pub fn is_name_without_code_that_mocks_give(&self, name: Atom) -> bool {
        (self.plan.names_without_code_that_mocks_give).contains(&name)
    }

    /// Whether no file or package provides the requested module, and mocks name it.
    pub fn is_absent_module(&self, module: ModuleRef) -> bool {
        self.plan.absent_modules.contains(&module)
    }

    pub fn is_found_by_loader_for_test_file(&self, module: ModuleRef, importer: FileId) -> bool {
        matches!(module, ModuleRef::External { importer: asks, .. } if asks == importer)
            && (self.plan.test_files_that_ask_loader)
                .binary_search(&importer)
                .is_ok()
            && self.external_kind(module) != Some(ExternalKind::HostValue)
    }

    pub fn is_made_by_mocks_alone(&self, module: ModuleRef) -> bool {
        let names = &self.plan.names_without_code_that_mocks_give;
        matches!(module, ModuleRef::External { specifier, type_attribute: None, .. } if names.contains(&specifier))
    }

    pub fn is_require_made_by_file_imported(&self, file: FileId) -> bool {
        let makers = &self.plan.makers_of_imported_requires;
        makers.binary_search(&file).is_ok()
    }

    pub fn holds_replaceable_variable(&self, file: FileId) -> bool {
        let replaced = &self.plan.replaced_variables;
        let first = replaced.partition_point(|variable| variable.file < file);
        replaced
            .get(first)
            .is_some_and(|variable| variable.file == file)
    }

    #[inline]
    pub fn is_replaceable(&self, variable: Sym) -> bool {
        let replaced = &self.plan.replaced_variables;
        !replaced.is_empty() && replaced.binary_search(&variable).is_ok()
    }

    pub fn caches_evaluation_error(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(_) => self.is_code_of_program(module),
            ModuleRef::Facade(_) | ModuleRef::Check(_) => true,
            ModuleRef::Inner { file, callback } => {
                let inner = self.wrapped().of_callback(file, callback);
                inner.is_some_and(|inner| inner.caches_evaluation_error)
            }
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        }
    }

    pub fn find_commonjs_main(&self, entry_points: &[EntryPoint]) -> Option<FileId> {
        match entry_points {
            [entry_point] if self.kind(entry_point.file) == ModuleKind::CommonJs => {
                Some(entry_point.file)
            }
            _ => None,
        }
    }

    pub fn keeps_module_object(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.keeps_module_object, module)
    }

    pub fn reaches_module_objects(&self, module: ModuleRef) -> bool {
        let plan = &self.plan;
        plan.has(&plan.reaches_module_objects, module)
    }

    pub fn exposes_global_object(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.exposes_global_object, module)
    }

    pub fn originals_beside_mocks_may_run(&self) -> bool {
        self.plan.originals_beside_mocks_may_run
    }

    /// Whether the compiled code of a CommonJS file may run a second time, as the original of its mock.
    pub fn may_run_as_original(&self, file: FileId) -> bool {
        let module = ModuleRef::File(file);
        self.plan.originals_beside_mocks_may_run
            && self.kind(file) == ModuleKind::CommonJs
            && self.plan.runs_as_original.get(file.idx()) == Some(&true)
            && matches!(self.shape(module), Shape::Value | Shape::AsToday)
    }

    pub fn is_found_by_name(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.is_found_by_name, module)
    }

    pub fn settled(&self, module: ModuleRef, name: Atom) -> bool {
        self.commonjs().settled(module, name)
    }

    pub fn ignores_this(&self, module: ModuleRef, name: Atom) -> bool {
        self.commonjs().ignores_this(module, name)
    }

    pub(super) fn is_marker_stored(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.is_marker_stored, module)
    }

    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        match self.shape(module) {
            Shape::EsModule => (!self.is_marker_stored(module)).then_some(true),
            Shape::Names | Shape::Value => self.commonjs().marker(module),
            Shape::AsToday => None,
        }
    }

    pub fn marker_for_imports(&self, module: ModuleRef) -> Option<bool> {
        match self.shape(module) {
            Shape::Names | Shape::Value => self.commonjs().marker_for_imports(module),
            Shape::EsModule | Shape::AsToday => self.marker(module),
        }
    }

    pub fn facade(&self, module: ModuleRef) -> Option<ModuleRef> {
        self.commonjs().facade(module)
    }

    pub fn exports_of(&self, module: ModuleRef) -> &[ModuleExport] {
        match module {
            ModuleRef::File(file) if self.has_record(file) => self.exports(file),
            ModuleRef::Facade(file) => self.commonjs().facade_exports(file),
            _ => &[],
        }
    }

    #[inline]
    pub fn inner_modules(&self, file: FileId) -> &[FnId] {
        match self.plan.inner_callbacks.is_empty() {
            true => &[],
            false => self.plan.inner_callbacks_of(file),
        }
    }

    pub fn inner_module(&self, file: FileId, callback: FnId) -> Option<ModuleRef> {
        let module = ModuleRef::Inner { file, callback };
        self.plan.order.numbers.number_of(module).map(|_| module)
    }

    pub fn in_order_of_stars<'a>(
        &self,
        module: ModuleRef,
        requests: &'a [ModuleRequest],
    ) -> Cow<'a, [ModuleRequest]> {
        match module {
            ModuleRef::File(file)
                if self.plan.files_with_late_stars.binary_search(&file).is_ok() =>
            {
                Cow::Owned(list_in_order_of_stars(requests))
            }
            _ => Cow::Borrowed(requests),
        }
    }

    pub fn requests_of(&self, module: ModuleRef) -> &[ModuleRequest] {
        if let Some(range) = self.plan.final_ranges.get(&module) {
            return &self.plan.final_requests[range.start as usize..range.end as usize];
        }
        match module {
            ModuleRef::File(file) if self.has_record(file) => self.requests(file),
            ModuleRef::Inner { file, callback } => {
                let inner_modules = self.plan.inner_modules();
                match inner_modules.binary_search(&(file, callback)) {
                    Ok(position) => &self.plan.inner_requests[position],
                    Err(_) => &[],
                }
            }
            _ => &[],
        }
    }

    pub fn look_at(&mut self, module: ModuleRef) {
        self.plan.reopen();
        self.commonjs_exports.look_at(module);
    }

    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.commonjs().name_sources(module)
    }

    pub fn object_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.commonjs().object_sources(module)
    }

    pub fn set_keeps_module_object(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.keeps_module_object, module);
        self.look_at(module);
    }

    pub fn set_reaches_module_objects(&mut self, module: ModuleRef) {
        self.plan
            .add(|plan| &mut plan.reaches_module_objects, module);
    }

    pub fn set_exposes_global_object(&mut self, module: ModuleRef) {
        self.plan
            .add(|plan| &mut plan.exposes_global_object, module);
    }

    pub fn asks_loader_functions(&self) -> bool {
        self.plan.asks_loader_functions
    }

    pub fn names_of_statements(&self, file: FileId) -> &[Atom] {
        let listed = self.plan.names_of_statements.get(&file);
        listed.map_or(&[], |names| names)
    }

    pub fn list_names_of_statements(&mut self, files: &Files<'_>) {
        let es_modules = self.record_files().iter().copied();
        let es_modules = es_modules.filter(|&file| self.kind(file) == ModuleKind::SourceText);
        self.plan.names_of_statements = es_modules
            .map(|file| (file, list_names_of_statements(files, file)))
            .collect();
    }

    pub fn set_asks_loader_functions(&mut self) {
        self.plan.asks_loader_functions = true;
    }

    /// The program loads only compiled code: at run time the loader refuses every file that is not in the image.
    pub fn is_closed_world(&self) -> bool {
        self.plan.is_closed_world
    }

    pub fn set_closed_world(&mut self) {
        self.plan.is_closed_world = true;
    }

    pub fn computed_names_ask_loader_functions(&self) -> bool {
        self.plan.computed_names_ask_loader_functions
    }

    pub fn set_computed_names_ask_loader_functions(&mut self) {
        self.plan.computed_names_ask_loader_functions = true;
    }

    pub fn set_answers_for_names_itself(&mut self) {
        self.plan.answers_for_names_itself = true;
    }

    pub(crate) fn find_why_name_is_path_alone(
        &self,
        files: &Files<'_>,
        file: FileId,
        name: ExprId,
    ) -> Option<PathAlone> {
        if self.plan.answers_for_names_itself {
            return None;
        }
        find_why_resolver_takes_name_for_path(files.analysis(file), &files.atoms, name)
    }

    pub fn knows_texts_that_spell_files(&self) -> bool {
        self.plan.order.texts_that_spell_files.is_some()
    }

    pub fn texts_that_spell_files_in(&self, file: FileId) -> &[TextThatSpellsFile] {
        let texts = self.plan.order.texts_that_spell_files.as_deref();
        let texts = texts.unwrap_or_default();
        let start = texts.partition_point(|text| text.written_in < file);
        let count = texts[start..].partition_point(|text| text.written_in == file);
        &texts[start..start + count]
    }

    pub fn set_is_found_by_name(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.is_found_by_name, module);
    }

    pub fn set_namespace_is_seen(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.is_namespace_seen, module);
    }

    pub fn finish_plan(&mut self, in_parallel: InParallel<'_>) {
        if self.plan.is_finished {
            return;
        }
        let mut steps = StepClock::new(Stage::BindModules);
        self.settle_holders();
        steps.end("plan: holders");
        let kinds = vec![ModuleKind::CommonJs, ModuleKind::Data];
        let found = map_each(kinds, in_parallel, &|kind| self.find_linked_files(kind));
        let [linked_files, data_files] = <[LinkedFiles; 2]>::try_from(found)
            .unwrap_or_else(|_| unreachable!("as many as kinds"));
        steps.end("plan: linked files");
        let prefixes = self.collect_prefixes(&linked_files, in_parallel);
        steps.end("plan: prefixes");
        self.plan.final_checks = self.settle_checks(&linked_files, in_parallel);
        steps.end("plan: checks");
        (self.plan.final_requests, self.plan.final_ranges) =
            self.settle_requests(prefixes, &data_files, in_parallel);
        steps.end("plan: requests");
        self.plan.is_every_require_seen = self.plan.reaches_module_objects.contains(&true)
            || self.plan.exposes_global_object.contains(&true)
            || self.plan.may_mock_every_module
            || self.plan.may_be_mocked.contains(&true);
        self.plan.is_finished = true;
    }

    pub(super) fn settle_holders(&mut self) {
        let module_of = |view: View| match view {
            View::Namespace(module) | View::Exports(module) => module,
        };
        let holders = self.rows.iter().flat_map(|row| &row.holders);
        let needs_object: Vec<bool> = holders
            .map(|holder| !self.stands_without_object(module_of(holder.view)))
            .collect();
        let holders = self.rows.iter_mut().flat_map(|row| &mut row.holders);
        for (holder, needs_object) in holders.zip(needs_object) {
            holder.is_needed_as_value |= needs_object;
        }
        self.plan.are_holders_settled = true;
    }

    /// Keeps the checks of the names that a file below the importer stores.
    fn settle_checks(
        &self,
        linked: &LinkedFiles,
        in_parallel: InParallel<'_>,
    ) -> FxHashMap<FileId, Vec<(SyntheticExportId, ModuleFailureId)>> {
        type Checks = Vec<(SyntheticExportId, ModuleFailureId)>;
        let importers = self.record_files().iter().copied();
        let mut importers: Vec<(FileId, Checks)> = importers
            .filter(|&file| !self.is_left_out(ModuleRef::File(file)))
            .map(|file| (file, self.commonjs().checked_copies(file).to_vec()))
            .filter(|(_, checks)| !checks.is_empty())
            .collect();
        for_each_mut(&mut importers, in_parallel, &|(importer, checks)| {
            checks.retain(|&(copy, failure)| {
                let owner = Some(self.synthetic_export(copy).module);
                let mut files = [self.failure(failure).exporter(), owner].into_iter();
                !files.any(|module| module.is_some_and(|module| self.is_left_out(module)))
            });
            let mut not_found: FxHashSet<SyntheticExportId> =
                checks.iter().map(|check| check.0).collect();
            let mut seen = FxHashSet::from_iter([*importer]);
            let mut pending = VecDeque::from([*importer]);
            while !not_found.is_empty()
                && let Some(file) = pending.pop_front()
            {
                for &(imported, _) in &linked.by_importer[file.idx()] {
                    let ModuleRef::File(imported) = imported else {
                        continue;
                    };
                    if !linked.leads_to_target[imported.idx()] || !seen.insert(imported) {
                        continue;
                    }
                    for copy in self.commonjs().copies(imported) {
                        not_found.remove(copy);
                    }
                    pending.push_back(imported);
                }
            }
            let mut checked = FxHashSet::default();
            let mocks_may_answer = self.reaches_mock(*importer);
            checks.retain(|&(copy, failure)| {
                !not_found.contains(&copy)
                    && checked.insert((copy, mocks_may_answer.then_some(failure)))
            });
        });
        let importers = importers.into_iter();
        importers.filter(|(_, checks)| !checks.is_empty()).collect()
    }

    pub fn checks_of(&self, importer: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        let checks = self.plan.final_checks.get(&importer);
        checks.map_or(&[], |it| &it[..])
    }

    /// The targets below the root, depth first in the order of the imports, with the modules of the runtime that stand in front of one
    /// and the ES modules that run in front of one.
    fn collect_prefix(
        &self,
        root: FileId,
        linked: &LinkedFiles,
        walk: &mut WalkOfImports,
    ) -> Vec<ModuleRef> {
        if !linked.leads_to_target[root.idx()] {
            return Vec::new();
        }
        let mut prefix = Vec::new();
        let mut length_at_last_target = 0;
        let mut modules_of_runtime = FxHashSet::default();
        walk.begin(root, linked.by_importer.len());
        while let Some(importer) = walk.path.last_mut() {
            let imports = &linked.by_importer[importer.file.idx()];
            let Some(&(imported, phase)) = imports.get(importer.next as usize) else {
                walk.leave();
                continue;
            };
            importer.next += 1;
            let ModuleRef::File(file) = imported else {
                if modules_of_runtime.insert(imported) {
                    prefix.push(imported);
                }
                continue;
            };
            let is_unseen = walk.take_if_unseen(file);
            if !linked.is_target[file.idx()] {
                match is_unseen && linked.is_gone_through[file.idx()] {
                    true => walk.enter(file, phase),
                    false => walk.pass_without_entering(file, phase),
                }
            } else if is_unseen {
                if self.kind(file) == ModuleKind::CommonJs {
                    let ahead = walk.evaluation.take_modules_ahead().iter();
                    prefix.extend(ahead.copied().map(ModuleRef::File));
                }
                prefix.push(self.facade(imported).unwrap_or(imported));
                length_at_last_target = prefix.len();
            }
        }
        prefix.truncate(length_at_last_target);
        prefix
    }

    fn find_linked_file(&self, request: &ModuleRequest) -> Option<FileId> {
        let ModuleRef::File(target) = request.target else {
            return None;
        };
        let is_followed = request.kind == ModuleRequestKind::Import
            && (self.is_code_of_program(request.target)
                || self.plan.order.makes_values_at_load[target.idx()])
            && (!self.is_left_out(request.target) || self.is_placeholder(target));
        is_followed.then_some(target)
    }

    fn find_linked_files(&self, kind_of_targets: ModuleKind) -> LinkedFiles {
        let mut successors = Vec::new();
        successors.resize_with(self.row_by_file.len(), Vec::new);
        let (mut targets, mut imports) = (Vec::new(), Vec::new());
        let mut importers_of_runtime = Vec::new();
        for &file in self.record_files() {
            if !self.is_es_module_of_program(file) {
                continue;
            }
            for request in self.requests(file) {
                if let ModuleRef::Runtime(_) = request.target
                    && request.kind == ModuleRequestKind::Import
                    && kind_of_targets == ModuleKind::CommonJs
                {
                    successors[file.idx()].push((request.target, request.phase));
                    importers_of_runtime.push(file);
                }
                let Some(target) = self.find_linked_file(request) else {
                    continue;
                };
                match self.kind(target) {
                    ModuleKind::SourceText => {}
                    kind if kind == kind_of_targets => targets.push(target),
                    _ => continue,
                }
                successors[file.idx()].push((request.target, request.phase));
                imports.push((target, file));
            }
        }
        let mut is_target = vec![false; successors.len()];
        for &target in &targets {
            is_target[target.idx()] = true;
        }
        let leads_to_target = find_files_that_lead_to(targets, &imports, successors.len());
        let mut is_gone_through =
            find_files_that_lead_to(importers_of_runtime, &imports, successors.len());
        for (is_gone_through, leads_to_target) in is_gone_through.iter_mut().zip(&leads_to_target) {
            *is_gone_through |= leads_to_target;
        }
        if kind_of_targets != ModuleKind::CommonJs {
            for imported in &mut successors {
                imported.retain(|&(module, _)| {
                    matches!(module, ModuleRef::File(file) if leads_to_target[file.idx()])
                });
            }
        }
        LinkedFiles {
            by_importer: successors,
            is_target,
            leads_to_target,
            is_gone_through,
        }
    }

    fn find_entries_of_cycles(&self, linked: &LinkedFiles) -> Vec<FileId> {
        let component_of = &self.plan.order.component_of;
        let mut sizes = vec![0u32; component_of.len()];
        for &component in component_of {
            sizes[component as usize] += 1;
        }
        let mut is_entered = vec![false; linked.by_importer.len()];
        for &root in &self.plan.order.prefix_roots {
            is_entered[root.idx()] = true;
        }
        for (importer, imported) in linked.by_importer.iter().enumerate() {
            for &(target, _) in imported {
                if let ModuleRef::File(target) = target {
                    is_entered[target.idx()] |=
                        component_of[importer] != component_of[target.idx()];
                }
            }
        }
        let files = self.record_files().iter().copied();
        files
            .filter(|&file| {
                is_entered[file.idx()]
                    && sizes[component_of[file.idx()] as usize] > 1
                    && !linked.by_importer[file.idx()].is_empty()
            })
            .collect()
    }

    pub fn facade_dependencies(&self, file: FileId) -> Vec<FileId> {
        let mut owners = Vec::new();
        for &copy in self.commonjs().copies(file) {
            if let ModuleRef::File(owner) = self.synthetic_export(copy).module
                && owner != file
                && !owners.contains(&owner)
                && self.facade(ModuleRef::File(owner)).is_some()
            {
                owners.push(owner);
            }
        }
        owners
    }

    fn is_es_module_of_program(&self, file: FileId) -> bool {
        self.is_code_of_program(ModuleRef::File(file)) && self.kind(file) == ModuleKind::SourceText
    }

    fn is_prefix_root(&self, file: FileId) -> bool {
        self.plan.order.prefix_roots.binary_search(&file).is_ok()
    }

    fn collect_prefixes(
        &self,
        linked_files: &LinkedFiles,
        in_parallel: InParallel<'_>,
    ) -> Vec<(FileId, Vec<ModuleRef>)> {
        let roots = self.record_files().iter().copied();
        let mut prefixes: Vec<(FileId, Vec<ModuleRef>)> = roots
            .filter(|&file| self.is_es_module_of_program(file) && self.is_prefix_root(file))
            .map(|root| (root, Vec::new()))
            .collect();
        let mut parts: Vec<&mut [(FileId, Vec<ModuleRef>)]> = prefixes.chunks_mut(16).collect();
        for_each_mut(&mut parts, in_parallel, &|part| {
            let mut walk = WalkOfImports::default();
            for (root, prefix) in part.iter_mut() {
                if !self.is_loaded_by_loader(ModuleRef::File(*root)) {
                    *prefix = self.collect_prefix(*root, linked_files, &mut walk);
                }
            }
        });
        prefixes
    }

    fn settle_requests(
        &self,
        prefixes: Vec<(FileId, Vec<ModuleRef>)>,
        data_files: &LinkedFiles,
        in_parallel: InParallel<'_>,
    ) -> (Vec<ModuleRequest>, FxHashMap<ModuleRef, Range<u32>>) {
        let mut requests: Vec<ModuleRequest> = Vec::new();
        let mut ranges = FxHashMap::default();
        let is_es_module = |file: FileId| self.is_es_module_of_program(file);
        let is_prefix_root = |file: FileId| self.is_prefix_root(file);
        let mut prefixes = prefixes.into_iter();
        let mut data_prefixes: Vec<(FileId, Vec<ModuleRef>)> = self
            .find_entries_of_cycles(data_files)
            .into_iter()
            .map(|entry| (entry, Vec::new()))
            .collect();
        for_each_mut(&mut data_prefixes, in_parallel, &|(entry, prefix)| {
            *prefix = self.collect_prefix(*entry, data_files, &mut WalkOfImports::default());
        });
        let mut data_prefixes = data_prefixes.into_iter().peekable();
        for &file in self.record_files() {
            let module = ModuleRef::File(file);
            if !is_es_module(file) {
                continue;
            }
            let start = requests.len();
            if !self.checks_of(file).is_empty() {
                requests.push(ModuleRequest::hoisted_import(ModuleRef::Check(file)));
            }
            if is_prefix_root(file) {
                let (root, prefix) = prefixes.next().expect("a prefix for each root");
                debug_assert_eq!(root, file);
                requests.extend(prefix.into_iter().map(ModuleRequest::hoisted_import));
            }
            if let Some((_, prefix)) = data_prefixes.next_if(|(entry, _)| *entry == file) {
                requests.extend(prefix.into_iter().map(ModuleRequest::hoisted_import));
            }
            let written = self.requests(file);
            let has_facade = |request: &ModuleRequest| {
                request.kind == ModuleRequestKind::Import && self.facade(request.target).is_some()
            };
            if requests.len() == start && !written.iter().any(has_facade) {
                continue;
            }
            requests.extend(written.iter().map(|&written| match written.kind {
                ModuleRequestKind::Import => ModuleRequest {
                    target: self.facade(written.target).unwrap_or(written.target),
                    ..written
                },
                ModuleRequestKind::Require => written,
            }));
            ranges.insert(module, start as u32..requests.len() as u32);
        }
        for &facade in self.record_files() {
            let file = ModuleRef::File(facade);
            if self.facade(file).is_none() {
                continue;
            }
            let start = requests.len() as u32;
            let completes_at = |module: ModuleRef| !self.half(module);
            requests.push(ModuleRequest::require(file, completes_at(file)));
            for owner in self.facade_dependencies(facade) {
                let completes = completes_at(ModuleRef::File(owner));
                requests.push(ModuleRequest::require(ModuleRef::Facade(owner), completes));
            }
            ranges.insert(ModuleRef::Facade(facade), start..requests.len() as u32);
        }
        (requests, ranges)
    }
}
