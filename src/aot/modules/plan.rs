#[cfg(test)]
mod tests;

use super::bindings::{
    AnswerMember, CopiedExports, Holder, ImportBinding, ModuleExport, ModuleRequest,
    SyntheticExportId,
};
use super::failures::ModuleFailureId;
use super::graph::{ModuleGraph, find};
use super::imports::NamedMember;
use super::interop::ModuleKind;
use super::order::{OrderParts, SiteKey};
use super::requests::Spelling;
use super::spelled_files::TextThatSpellsFile;
use super::test_run_evictions::{NamedByCopies, is_marked};
use super::wrapped::InnerModuleKind;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut};
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
use bun_sema::util::{FxHashMap, FxHashSet};
use core::ops::Range;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleRef {
    File(FileId),
    Inner {
        file: FileId,
        callback: FnId,
    },
    Face(FileId),
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

#[derive(Copy, Clone, Debug)]
pub(super) struct StoredSite {
    pub referrer: ModuleRef,
    pub target: ModuleRef,
    pub is_bare: bool,
}

struct LinkedFiles {
    by_importer: Vec<Vec<FileId>>,
}

impl LinkedFiles {
    fn leads_to_target(&self, es_module: FileId) -> bool {
        !self.by_importer[es_module.idx()].is_empty()
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
    names_way_to_module_objects: Vec<bool>,
    is_found_by_name: Vec<bool>,
    is_first_require_seen: bool,
    is_namespace_seen: Vec<bool>,
    is_marker_stored: Vec<bool>,
    is_imported_as_namespace: Vec<bool>,
    externals_imported_as_namespace: Vec<ModuleRef>,
    externals_named_by_mocks: Vec<ModuleRef>,
    may_be_mocked: Vec<bool>,
    is_named_by_mock: Vec<bool>,
    runtime_modules_named_by_mocks: Vec<RuntimeModule>,
    names_without_code_that_mocks_give: Vec<Atom>,
    mocked_runtime_modules: Vec<RuntimeModule>,
    may_mock_every_module: bool,
    originals_beside_mocks_may_run: bool,
    runtime_modules_handed_out_by_test_runner: Vec<RuntimeModule>,
    test_runner_hands_out_every_runtime_module: bool,
    runs_tests: bool,
    is_reached_without_extension: Vec<bool>,
    is_reached_under_another_extension: Vec<bool>,
    is_reached_as_folder: Vec<bool>,
    may_evict_every_module: bool,
    pub(super) named_by_copies: NamedByCopies,
    reaches_entries_of_cache: Option<bool>,
    library_modules_stored_in_cache: Vec<RuntimeModule>,
    asks_loader_functions: bool,
    computed_names_ask_loader_functions: bool,
    answers_for_names_itself: bool,
    lists_names_of_statements: bool,
    runs_again: Vec<bool>,
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
            names_way_to_module_objects: vec![false; order.numbers.len()],
            is_found_by_name: vec![false; order.numbers.len()],
            is_first_require_seen: false,
            is_namespace_seen: vec![false; order.numbers.len()],
            is_marker_stored: vec![false; order.numbers.len()],
            is_imported_as_namespace: vec![false; order.numbers.len()],
            externals_imported_as_namespace: Vec::new(),
            externals_named_by_mocks: Vec::new(),
            may_be_mocked: vec![false; order.numbers.len()],
            is_named_by_mock: vec![false; order.numbers.len()],
            runtime_modules_named_by_mocks: Vec::new(),
            names_without_code_that_mocks_give: Vec::new(),
            mocked_runtime_modules: Vec::new(),
            may_mock_every_module: false,
            originals_beside_mocks_may_run: false,
            runtime_modules_handed_out_by_test_runner: Vec::new(),
            test_runner_hands_out_every_runtime_module: false,
            runs_tests: false,
            is_reached_without_extension: vec![false; order.numbers.len()],
            is_reached_under_another_extension: vec![false; order.numbers.len()],
            is_reached_as_folder: vec![false; order.numbers.len()],
            may_evict_every_module: false,
            named_by_copies: NamedByCopies::default(),
            reaches_entries_of_cache: None,
            library_modules_stored_in_cache: Vec::new(),
            asks_loader_functions: false,
            computed_names_ask_loader_functions: false,
            answers_for_names_itself: false,
            lists_names_of_statements: false,
            runs_again: vec![false; order.numbers.len()],
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

    pub(super) fn set_is_handed_out_by_test_runner(&mut self, module: RuntimeModule) {
        if !self
            .runtime_modules_handed_out_by_test_runner
            .contains(&module)
        {
            self.runtime_modules_handed_out_by_test_runner.push(module);
        }
    }

    pub(super) fn set_test_runner_hands_out_every_runtime_module(&mut self) {
        self.test_runner_hands_out_every_runtime_module = true;
    }

    pub(super) fn set_runs_tests(&mut self) {
        self.runs_tests = true;
    }

    pub(super) fn set_is_reached_by(&mut self, module: ModuleRef, spelling: Spelling) {
        match spelling {
            Spelling::WithoutExtension => {
                self.add(|plan| &mut plan.is_reached_without_extension, module);
            }
            Spelling::UnderAnotherExtension => {
                self.add(|plan| &mut plan.is_reached_under_another_extension, module);
            }
            Spelling::AsFolder => self.add(|plan| &mut plan.is_reached_as_folder, module),
        }
    }

    pub(super) fn set_runs_again(&mut self, module: ModuleRef, is_es_module: bool) {
        self.add(|plan| &mut plan.runs_again, module);
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

    pub(super) fn set_originals_beside_mocks_may_run(&mut self) {
        self.originals_beside_mocks_may_run = true;
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
            ModuleRef::Face(_) | ModuleRef::Check(_) => Shape::EsModule,
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
        Site::Evaluate {
            target: site.target,
            is_bare: site.is_bare,
            records: shows_mark
                || self.keeps_module_object(site.referrer)
                || self.keeps_module_object(site.target)
                || (self.plan.is_first_require_seen && matches!(site.target, ModuleRef::File(_)))
                || matches!(site.target, ModuleRef::File(file) if self.tracks_first_load(file)),
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
        let mut holders = self.holders(file).iter();
        !self.stands_without_object(site.target)
            || holders.any(|holder| holder.call == call && holder.is_needed_as_value)
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
            ModuleRef::File(file) => self.keeps_error(module) && !self.runs_again(file),
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

    pub fn may_be_imported_while_it_runs(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.may_be_imported_while_it_runs, module)
    }

    pub fn is_es_module_to_imports(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.is_es_module_to_imports, module)
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

    pub fn tracks_first_load(&self, file: FileId) -> bool {
        (!self.plan.library_modules_stored_in_cache.is_empty() || self.plan.asks_loader_functions)
            && self.kind(file) == ModuleKind::CommonJs
            && self.is_code_of_program(ModuleRef::File(file))
    }

    pub fn is_held_under_name_without_prefix(&self, module: RuntimeModule) -> bool {
        let stored = &self.plan.library_modules_stored_in_cache;
        module != RuntimeModule::Bun && !stored.contains(&module)
    }

    pub fn is_reached_by(&self, module: ModuleRef, spelling: Spelling) -> bool {
        let set = match spelling {
            Spelling::WithoutExtension => &self.plan.is_reached_without_extension,
            Spelling::UnderAnotherExtension => &self.plan.is_reached_under_another_extension,
            Spelling::AsFolder => &self.plan.is_reached_as_folder,
        };
        self.plan.has(set, module)
    }

    pub fn runs_again(&self, file: FileId) -> bool {
        matches!(
            self.kind(file),
            ModuleKind::SourceText | ModuleKind::CommonJs
        ) && self.plan.has(&self.plan.runs_again, ModuleRef::File(file))
    }

    pub fn is_instantiated_ahead(&self, file: FileId) -> bool {
        let order = &self.plan.order;
        let module = ModuleRef::File(file);
        self.kind(file) == ModuleKind::SourceText
            && self.half(module)
            && order.numbers.number_of(module).is_some_and(|number| {
                self.plan.has_es_module_that_runs_again[order.component_of[number] as usize]
            })
    }

    pub fn makes_scope_ahead(&self, file: FileId) -> bool {
        self.is_instantiated_ahead(file) && self.runs_again(file)
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

    pub fn is_handed_out_by_test_runner(&self, module: RuntimeModule) -> bool {
        let plan = &self.plan;
        plan.test_runner_hands_out_every_runtime_module
            || plan
                .runtime_modules_handed_out_by_test_runner
                .contains(&module)
    }

    pub fn is_named_to_test_runner(&self, module: RuntimeModule) -> bool {
        let named = &self.plan.runtime_modules_handed_out_by_test_runner;
        named.contains(&module)
    }

    pub fn runtime_modules_named_by_mocks(&self) -> &[RuntimeModule] {
        &self.plan.runtime_modules_named_by_mocks
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

    pub fn keeps_error(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(_) => self.is_code_of_program(module),
            ModuleRef::Face(_) | ModuleRef::Check(_) => true,
            ModuleRef::Inner { file, callback } => {
                let inner = self.wrapped().of_callback(file, callback);
                inner.is_some_and(|inner| inner.keeps_error)
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

    pub fn names_way_to_module_objects(&self, module: ModuleRef) -> bool {
        let plan = &self.plan;
        plan.has(&plan.names_way_to_module_objects, module)
    }

    pub fn originals_beside_mocks_may_run(&self) -> bool {
        self.plan.originals_beside_mocks_may_run
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

    pub fn face(&self, module: ModuleRef) -> Option<ModuleRef> {
        self.commonjs().face(module)
    }

    pub fn exports_of(&self, module: ModuleRef) -> &[ModuleExport] {
        match module {
            ModuleRef::File(file) if self.has_record(file) => self.exports(file),
            ModuleRef::Face(file) => self.commonjs().exports_of_face(file),
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

    pub fn set_keeps_module_object(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.keeps_module_object, module);
        self.look_at(module);
    }

    pub fn set_names_way_to_module_objects(&mut self, module: ModuleRef) {
        self.plan
            .add(|plan| &mut plan.names_way_to_module_objects, module);
    }

    pub fn asks_loader_functions(&self) -> bool {
        self.plan.asks_loader_functions
    }

    pub fn lists_names_of_statements(&self) -> bool {
        self.plan.lists_names_of_statements
    }

    pub fn set_lists_names_of_statements(&mut self) {
        self.plan.lists_names_of_statements = true;
    }

    pub fn set_asks_loader_functions(&mut self) {
        self.plan.asks_loader_functions = true;
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
        let linked_files = self.find_linked_files(ModuleKind::CommonJs);
        let data_files = self.find_linked_files(ModuleKind::Data);
        steps.end("plan: linked files");
        let prefixes = self.collect_prefixes(&linked_files, in_parallel);
        steps.end("plan: prefixes");
        self.plan.final_checks = self.settle_checks(&linked_files, &prefixes, in_parallel);
        steps.end("plan: checks");
        (self.plan.final_requests, self.plan.final_ranges) =
            self.settle_requests(prefixes, &data_files, in_parallel);
        steps.end("plan: requests");
        let mut first_requests = self.plan.order.first_requests_of_host.iter();
        self.plan.is_first_require_seen = self.plan.names_way_to_module_objects.contains(&true)
            && first_requests.any(|&file| {
                self.kind(file) == ModuleKind::SourceText && !linked_files.leads_to_target(file)
            });
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

    fn settle_checks(
        &self,
        linked: &LinkedFiles,
        prefixes: &[(FileId, Vec<ModuleRef>)],
        in_parallel: InParallel<'_>,
    ) -> FxHashMap<FileId, Vec<(SyntheticExportId, ModuleFailureId)>> {
        type Checks = Vec<(SyntheticExportId, ModuleFailureId)>;
        let has_checks = |root: FileId| !self.commonjs().checked_copies(root).is_empty();
        let mut roots: Vec<(FileId, &[ModuleRef], Checks)> = prefixes
            .iter()
            .filter(|(root, _)| has_checks(*root))
            .map(|(root, prefix)| (*root, &prefix[..], Vec::new()))
            .collect();
        for_each_mut(&mut roots, in_parallel, &|(root, prefix, checks)| {
            let root = *root;
            let written = self.commonjs().checked_copies(root);
            let mut is_linked = vec![false; linked.by_importer.len()];
            is_linked[root.idx()] = true;
            let mut importers = vec![root];
            while let Some(file) = importers.pop() {
                for &target in &linked.by_importer[file.idx()] {
                    if !core::mem::replace(&mut is_linked[target.idx()], true) {
                        importers.push(target);
                    }
                }
            }
            let mut left = written.to_vec();
            left.retain(|&(_, failure)| is_linked[self.failure(failure).importer.idx()]);
            if !self.is_loaded_by_loader(ModuleRef::File(root)) {
                let stored = self.find_copies_stored_by(prefix.iter().copied());
                left.retain(|(copy, _)| stored.contains(copy));
            }
            *checks = left;
        });
        let roots = roots.into_iter();
        roots
            .filter(|(_, _, checks)| !checks.is_empty())
            .map(|(root, _, checks)| (root, checks))
            .collect()
    }

    fn find_copies_stored_by(
        &self,
        modules: impl Iterator<Item = ModuleRef>,
    ) -> FxHashSet<SyntheticExportId> {
        let mut stored = FxHashSet::default();
        for module in modules {
            if let ModuleRef::Face(face) = module {
                stored.extend(self.commonjs().copies(face));
            }
        }
        stored
    }

    pub fn checks_of(&self, root: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        self.plan.final_checks.get(&root).map_or(&[], |it| &it[..])
    }

    #[cfg(test)]
    pub fn check_every_written_importer(&mut self) {
        for root in self.plan.order.prefix_roots.clone() {
            let written = self.commonjs().checked_copies(root).to_vec();
            if !written.is_empty() {
                self.plan.final_checks.insert(root, written);
            }
        }
    }

    pub fn find_check_of_copy_that_nothing_stores(&self) -> Option<(FileId, ModuleRef)> {
        let mut roots: Vec<FileId> = self.plan.final_checks.keys().copied().collect();
        roots.sort_unstable();
        roots.retain(|&root| !self.is_loaded_by_loader(ModuleRef::File(root)));
        roots.into_iter().find_map(|root| {
            let requests = self.requests_of(ModuleRef::File(root)).iter();
            let in_front = requests.take_while(|it| it.target != ModuleRef::Check(root));
            let stored = self.find_copies_stored_by(in_front.map(|it| it.target));
            let is_read = |&&(export, failure): &&(SyntheticExportId, ModuleFailureId)| {
                let written = self.failure(failure);
                let importer = Some(ModuleRef::File(written.importer));
                let owner = Some(self.synthetic_export(export).module);
                let mut linked = [importer, written.exporter(), owner].into_iter().flatten();
                !linked.any(|module| self.is_left_out(module))
            };
            let mut checks = self.checks_of(root).iter();
            let missing = checks.find(|check| !stored.contains(&check.0) && is_read(check))?;
            Some((root, self.synthetic_export(missing.0).module))
        })
    }

    fn collect_prefix(&self, root: FileId, linked: &LinkedFiles) -> Vec<ModuleRef> {
        let mut prefix = Vec::new();
        if !linked.leads_to_target(root) {
            return prefix;
        }
        let order = &self.plan.order;
        let is_read_by_require = order.required_prefix_roots.binary_search(&root).is_ok();
        let runs_in_its_turn =
            |file: FileId| !is_read_by_require && order.is_es_module_to_imports[file.idx()];
        let mut is_seen = vec![false; linked.by_importer.len()];
        is_seen[root.idx()] = true;
        let mut importers = vec![root];
        let mut next = 0;
        while let Some(&file) = importers.get(next) {
            next += 1;
            for &target in &linked.by_importer[file.idx()] {
                if core::mem::replace(&mut is_seen[target.idx()], true) {
                    continue;
                }
                if self.kind(target) == ModuleKind::SourceText {
                    importers.push(target);
                } else if !runs_in_its_turn(target) {
                    let target = ModuleRef::File(target);
                    prefix.push(self.face(target).unwrap_or(target));
                }
            }
        }
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
        for &file in self.record_files() {
            if !self.is_code_of_program(ModuleRef::File(file))
                || self.kind(file) != ModuleKind::SourceText
            {
                continue;
            }
            let requests = self.requests(file).iter();
            let linked = requests.filter_map(|request| self.find_linked_file(request));
            for target in linked {
                match self.kind(target) {
                    ModuleKind::SourceText => {}
                    kind if kind == kind_of_targets => targets.push(target),
                    _ => continue,
                }
                successors[file.idx()].push(target);
                imports.push((target, file));
            }
        }
        let leads_to_target = find_files_that_lead_to(targets, &imports, successors.len());
        for imported in &mut successors {
            imported.retain(|&file| leads_to_target[file.idx()]);
        }
        LinkedFiles {
            by_importer: successors,
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
            for &target in imported {
                is_entered[target.idx()] |= component_of[importer] != component_of[target.idx()];
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

    #[cfg(test)]
    pub fn prefix_roots(&self) -> &[FileId] {
        &self.plan.order.prefix_roots
    }

    pub fn faces_behind(&self, file: FileId) -> Vec<FileId> {
        let mut owners = Vec::new();
        for &copy in self.commonjs().copies(file) {
            if let ModuleRef::File(owner) = self.synthetic_export(copy).module
                && owner != file
                && !owners.contains(&owner)
                && self.face(ModuleRef::File(owner)).is_some()
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
        for_each_mut(&mut prefixes, in_parallel, &|(root, prefix)| {
            if !self.is_loaded_by_loader(ModuleRef::File(*root)) {
                *prefix = self.collect_prefix(*root, linked_files);
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
            *prefix = self.collect_prefix(*entry, data_files);
        });
        let mut data_prefixes = data_prefixes.into_iter().peekable();
        for &file in self.record_files() {
            let module = ModuleRef::File(file);
            if !is_es_module(file) {
                continue;
            }
            let start = requests.len();
            if is_prefix_root(file) {
                let (root, prefix) = prefixes.next().expect("a prefix for each root");
                debug_assert_eq!(root, file);
                requests.extend(prefix.into_iter().map(ModuleRequest::hoisted_import));
                if !self.checks_of(file).is_empty() {
                    requests.push(ModuleRequest::hoisted_import(ModuleRef::Check(file)));
                }
            }
            if let Some((_, prefix)) = data_prefixes.next_if(|(entry, _)| *entry == file) {
                requests.extend(prefix.into_iter().map(ModuleRequest::hoisted_import));
            }
            requests.extend(
                self.requests(file)
                    .iter()
                    .map(|&written| match written.kind {
                        ModuleRequestKind::Import => ModuleRequest {
                            target: self.face(written.target).unwrap_or(written.target),
                            ..written
                        },
                        ModuleRequestKind::Require => written,
                    }),
            );
            ranges.insert(module, start as u32..requests.len() as u32);
        }
        for &face in self.record_files() {
            let file = ModuleRef::File(face);
            if self.face(file).is_none() {
                continue;
            }
            let start = requests.len() as u32;
            let completes_at = |module: ModuleRef| !self.half(module);
            requests.push(ModuleRequest::require(file, completes_at(file)));
            for owner in self.faces_behind(face) {
                let completes = completes_at(ModuleRef::File(owner));
                requests.push(ModuleRequest::require(ModuleRef::Face(owner), completes));
            }
            ranges.insert(ModuleRef::Face(face), start..requests.len() as u32);
        }
        (requests, ranges)
    }
}
