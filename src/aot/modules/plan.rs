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
use super::test_run_evictions::{NamedByCopies, is_marked};
use super::wrapped::InnerModuleKind;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut};
use crate::load::contents::load_names::find_module_looked_up_in_cache;
use crate::load::sources::EntryPoint;
use crate::statistics::{Stage, StepClock};
use bun_ast::Loader;
use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::hir::{ExprId, FnId, ImportEqualsId, StmtId};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};
use bun_sema::util::{FxHashMap, FxHashSet};
use core::ops::Range;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleRef {
    File(FileId),
    /// The callback of `__commonJS(cb)` or `__esm(fn)` in a bundle.
    Inner {
        file: FileId,
        callback: FnId,
    },
    /// What an ES importer of a CommonJS file requests in its place: it evaluates the file and takes the copies.
    Face(FileId),
    /// Throws the link error for the first name that an ES graph imports and no CommonJS file of it has stored.
    Check(FileId),
    Runtime(RuntimeModule),
    External {
        importer: FileId,
        specifier: Atom,
        /// `import data from "./data.txt" with { type: "toml" }`: the loader of the run time is asked as the statement asks, and keeps what it answers apart from what an import without the attribute gets.
        type_attribute: Option<Loader>,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Shape {
    EsModule,
    /// No exports object: a variable for each name that somebody reads.
    Names,
    /// One variable holds `module.exports`.
    Value,
    /// The run time's loader has the module, as it always had.
    AsToday,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Site {
    Evaluate {
        target: ModuleRef,
        /// Every run of the body of the referrer passes the site.
        is_bare: bool,
        /// The run time is told that the site has run.
        records: bool,
    },
    AsToday,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum View {
    Namespace(ModuleRef),
    Exports(ModuleRef),
}

/// A member of a module's exports that is read, stored or called.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Member {
    Variable(SyntheticExportId),
    Copy(SyntheticExportId),
    Binding(Sym),
    /// A read: nobody stores the name. A store: nobody reads it, so the value is evaluated and nothing is stored.
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

/// The imports that lead from the ES modules of the program to its files of one other kind.
struct LinkedFiles {
    /// By ES module, in the order of its requests: the files of that kind, and the ES modules that lead to one.
    by_importer: Vec<Vec<FileId>>,
}

impl LinkedFiles {
    fn leads_to_target(&self, es_module: FileId) -> bool {
        !self.by_importer[es_module.idx()].is_empty()
    }
}

// By file: the imports lead from it to one of `targets`, or it is one. An import is the imported file and then its importer.
fn find_files_that_lead_to(
    targets: Vec<FileId>,
    imports: Vec<(FileId, FileId)>,
    file_count: usize,
) -> Vec<bool> {
    let mut leads_there = vec![false; file_count];
    if targets.is_empty() {
        return leads_there;
    }
    // By imported file: where its importers end in `importers`, and once they are filled in, where they begin.
    let mut bounds = vec![0u32; file_count + 1];
    for &(imported, _) in &imports {
        bounds[imported.idx()] += 1;
    }
    let mut end = 0;
    for bound in &mut bounds {
        end += *bound;
        *bound = end;
    }
    let mut importers = vec![FileId(0); imports.len()];
    for &(imported, importer) in &imports {
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
    /// The callbacks of `order.numbers.inner_modules()`.
    inner_callbacks: Vec<FnId>,
    keeps_module_object: Vec<bool>,
    names_way_to_module_objects: Vec<bool>,
    is_found_by_name: Vec<bool>,
    /// A `require` of a file may run before the loader has come to a CommonJS file, and code names a way between module objects: whether one did says which file has the id ".".
    is_first_require_seen: bool,
    is_namespace_seen: Vec<bool>,
    /// A file stores `__esModule` on what `require` of the module answers.
    is_marker_stored: Vec<bool>,
    is_imported_as_namespace: Vec<bool>,
    externals_imported_as_namespace: Vec<ModuleRef>,
    externals_named_by_mocks: Vec<ModuleRef>,
    /// `mock.module` names the module.
    may_be_mocked: Vec<bool>,
    is_named_by_mock: Vec<bool>,
    runtime_modules_named_by_mocks: Vec<RuntimeModule>,
    /// `MockedModules::names_without_code`, each once. Few.
    names_without_code_that_mocks_give: Vec<Atom>,
    /// The order numbers no module of the library.
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
    /// `test_run_evictions::fill_plan_of_copies`
    pub(super) named_by_copies: NamedByCopies,
    /// `ResolvedBuiltins::reaches_module_cache` of some file: it may store other `exports` in the entry of a file. `None`: nobody has looked.
    reaches_entries_of_cache: Option<bool>,
    /// `find_library_modules_stored_in_cache` of the files of the program.
    library_modules_stored_in_cache: Vec<RuntimeModule>,
    /// The host loads the entry point several times in one realm: `AotOptions::entry_points_run_again`.
    runs_again: Vec<bool>,
    /// By `OrderParts::component_of`.
    has_es_module_that_runs_again: Vec<bool>,
    /// Ascending. The test runner stores into them.
    replaced_variables: Vec<Sym>,
    /// The statements that define inner modules, and those of modules that cannot be loaded.
    erased_statements: Vec<(FileId, StmtId)>,
    pub named_members: FxHashMap<(ModuleRef, Atom), NamedMember<ImportBinding>>,
    pub variables: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    /// What the inner modules ask for.
    pub(super) inner_requests: Vec<Vec<ModuleRequest>>,
    final_requests: Vec<ModuleRequest>,
    final_ranges: FxHashMap<ModuleRef, Range<u32>>,
    /// `ModuleGraph::checks_of`
    final_checks: FxHashMap<FileId, Vec<(SyntheticExportId, ModuleFailureId)>>,
    pub is_finished: bool,
    /// `Holder::is_needed_as_value` goes by the shapes as they are.
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
            runs_again: vec![false; order.numbers.len()],
            has_es_module_that_runs_again: vec![false; order.numbers.len()],
            replaced_variables: Vec::new(),
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

    /// A shape, a request or the list of files that are left out changes. `ModuleGraph::finish_plan` has to follow.
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

    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        self.order.numbers.inner_modules()
    }

    fn inner_modules_of(&self, file: FileId) -> Range<usize> {
        let inner_modules = self.order.numbers.inner_modules();
        let start = inner_modules.partition_point(|inner| inner.0 < file);
        let end = inner_modules.partition_point(|inner| inner.0 <= file);
        start..end
    }
}

impl ModuleGraph {
    /// Final behind `finish_plan`.
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
                    // Its variables are the bindings of the file.
                    Some(InnerModuleKind::Esm) => Shape::EsModule,
                    Some(InnerModuleKind::CommonJs) => self.commonjs().shape(module),
                    None => Shape::AsToday,
                }
            }
            ModuleRef::Face(_) | ModuleRef::Check(_) => Shape::EsModule,
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => Shape::AsToday,
        }
    }

    /// A file of the program that is code and no library, or an inner module of one: what a site can evaluate.
    pub fn is_code_of_program(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.order.is_code_of_program, module)
    }

    /// `require(K)`, `module.require(K)`, `import.meta.require(K)`, a call of what `createRequire` made for the file itself, `require_x()` and `init_x()`.
    pub fn site(&self, file: FileId, call: ExprId) -> Option<Site> {
        if let Some(site) = self.find_stored_site(file, SiteKey::Call(call)) {
            return Some(self.finish_site(site));
        }
        let kinds = [
            ImportSiteKind::Require(call),
            ImportSiteKind::ImportMetaRequire(call),
        ];
        let is_site = |&kind: &ImportSiteKind| self.find_site_answer(file, kind).is_some();
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
        // From the first `require` on the namespace object of an ES module has `__esModule`.
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

    /// `false`: the call is a statement, the initializer of a holder or of a bound pattern, the object of a bound member, or only tested.
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

    // Whether everything that is bound to names of the module does without its object.
    fn stands_without_object(&self, module: ModuleRef) -> bool {
        match self.shape(module) {
            Shape::EsModule | Shape::Names => true,
            Shape::Value | Shape::AsToday => false,
        }
    }

    /// A name that stands for a module and holds `true`. A name that has to hold the object is an ordinary binding.
    pub fn holder(&self, file: FileId, symbol: SymbolId) -> Option<View> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        (!holders[at].is_needed_as_value).then_some(holders[at].view)
    }

    /// The call of `require` in the initializer of such a name. What else the initializer does makes an object that nobody looks at.
    pub fn call_of_holder(&self, file: FileId, symbol: SymbolId) -> Option<ExprId> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        (!holders[at].is_needed_as_value).then_some(holders[at].call)
    }

    // A name that holds what a helper makes of an answer of which the text does not say that it has the marker, where the object of the module is there and the helper is called once.
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

    /// `const a = __toESM(require(K))`, where `a` is only read by name: `a` holds what `require` answers in place of the copy, unless the helper would not show that under `default` or the answer lacks one of the names. The call of `require` and the copy.
    pub fn holder_of_answer(
        &self,
        file: FileId,
        symbol: SymbolId,
    ) -> Option<(ExprId, CopiedExports)> {
        let (holder, copy) = self.holder_of_unmarked_copy(file, symbol)?;
        let holds_answer = copy.may_hold_answer && !copy.is_looked_at && !copy.is_called_through;
        holds_answer.then_some((holder.call, copy))
    }

    /// `const a = __importStar(require(K))` and `const a = __toESM(require(K))`, where `a` holds the copy: a name that the answer has when the copy is made is read on the answer, as the getter of the copy does. The call of `require` and the copy.
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

    /// The names that are read through such a name, each once and beside the name, in the order of the text.
    pub fn names_read_on_answer(&self, file: FileId, holder: SymbolId) -> &[(SymbolId, Atom)] {
        let names = &self.row(file).names_read_on_answers;
        let start = names.partition_point(|name| name.0 < holder);
        let count = names[start..].partition_point(|name| name.0 == holder);
        &names[start..start + count]
    }

    /// `a.default` and `a.n` of such a name, where a variable of its own holds the answer.
    pub fn answer_member(&self, file: FileId, access: ExprId) -> Option<AnswerMember> {
        let member = find(&self.row(file).answer_members, access)?;
        let is_read_on_answer = self.holder_of_answer(file, member.holder).is_some()
            || (member.name.is_some() && self.holder_of_copy(file, member.holder).is_some());
        is_read_on_answer.then_some(member)
    }

    /// `E.N`, `R.N`, `d.N` and `ns.N`, where the access is bound to a name of a module.
    pub fn member(&self, file: FileId, access: ExprId) -> Option<Member> {
        if let Some((module, member)) = find(&self.row(file).fixed_members, access) {
            return Some(self.finish_fixed_member(module, member));
        }
        let Some(binding) = find(&self.row(file).members, access) else {
            let member = self.commonjs().own_member(file, access);
            return match self.stores_what_variable_holds(file, access, member) {
                true => Some(Member::Undefined),
                false => member,
            };
        };
        let accessed = find(&self.row(file).accessed, access)?;
        self.finish_member(accessed.module, binding, accessed.is_imported)
    }

    // `exports.n = void 0` at the head of a body that runs once: the variable of the name is born undefined, so nothing is stored.
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

    // No run of the body finds the variables of the module as an earlier run has left them.
    pub fn runs_body_once(&self, module: ModuleRef) -> bool {
        let begins_once = match module {
            // A file whose body threw would be loaded anew by the next `require` if it did not keep the error.
            ModuleRef::File(file) => self.keeps_error(module) && !self.runs_again(file),
            // Every wrapper that makes a module of its callback runs it once, whether or not it threw.
            ModuleRef::Inner { .. } => true,
            _ => false,
        };
        begins_once && !self.may_be_evicted(module) && !self.may_be_mocked(module)
    }

    /// `R.N` for a name that no expression spells: a key of `const { N } = require(K)`, a key of `module.exports = { N }`, the source of a copy.
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

    /// What such a name of an ES module is bound to, where it stands for a name of a CommonJS module: `export { N } from "./k.cjs"`.
    pub fn binding_of_member_named(&self, module: ModuleRef, name: Atom) -> Option<ImportBinding> {
        match self.plan.named_members.get(&(module, name)) {
            Some(&NamedMember::Binding(binding)) => Some(binding),
            Some(NamedMember::Fixed(_)) | None => None,
        }
    }

    // Whoever has the object can store a name on it, define it or delete it.
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

    // `accessed` is the module that the access is written on, which need not be the one that has the variable.
    fn finish_member(
        &self,
        accessed: ModuleRef,
        binding: ImportBinding,
        is_imported: bool,
    ) -> Option<Member> {
        let is_es_module = match self.shape(accessed) {
            Shape::EsModule => true,
            Shape::Names | Shape::Value => false,
            // A library module, whose imports are bound as they always were.
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

    /// The variable of a name of a CommonJS module. `None`: no binding asks for it.
    pub fn variable_of(&self, module: ModuleRef, name: Atom) -> Option<SyntheticExportId> {
        self.plan.variables.get(&(module, name)).copied()
    }

    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        let erased_statements = &self.plan.erased_statements;
        erased_statements.binary_search(&(file, statement)).is_ok()
            || self.commonjs().erased(file, statement)
            || self.is_placeholder(file)
    }

    /// A late site names the module, or a module that a late site may run asks for it.
    pub fn exposed(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.order.is_exposed, module)
    }

    /// Somebody may look at the module while its body runs: it lies on a cycle of requests, or it is exposed.
    pub fn half(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.order.is_half, module)
    }

    /// The body of `importer` may run before the body of `exporter`, which it imports, has finished.
    pub fn may_run_before(&self, importer: ModuleRef, exporter: ModuleRef) -> bool {
        let order = &self.plan.order;
        let component =
            |module: ModuleRef| Some(order.component_of[order.numbers.number_of(module)?]);
        component(importer) == component(exporter)
            || self.plan.has(&order.is_required_at_any_time, importer)
    }

    /// The loader of the run time loads the module and what it imports one by one, as `bun run` does.
    pub fn is_loaded_by_loader(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self.plan.has(&self.plan.order.is_loaded_by_loader, module)
    }

    /// A `require` of the module may run while a graph is being loaded.
    pub fn is_required_during_load(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.is_required_during_load, module)
    }

    /// An ES module that the CommonJS file leads to by a `require` or an `import()` imports the file, or such an `import()` names the file.
    pub fn may_be_imported_while_it_runs(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.may_be_imported_while_it_runs, module)
    }

    /// A file has `import * as` of the module.
    pub fn is_imported_as_namespace(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.is_imported_as_namespace, module)
            || self.plan.externals_imported_as_namespace.contains(&module)
    }

    pub fn runs_tests(&self) -> bool {
        self.plan.runs_tests
    }

    /// `require.cache` lists every file of the program that has run, also one that keeps no status of its own. Only a test run promises that.
    pub fn lists_files_in_cache(&self) -> bool {
        self.plan.runs_tests
    }

    /// `delete require.cache[path]` loads the file anew. `find_files_that_leave` lists the files. Where nobody can say which, one such statement counts for every module.
    /// No path names the callback of a bundler's wrapper, and no text of its own lies on disk.
    pub fn may_be_evicted(&self, module: ModuleRef) -> bool {
        !matches!(module, ModuleRef::Inner { .. })
            && (self.plan.may_evict_every_module
                || is_marked(&self.plan.test_run.may_be_evicted, module))
    }

    /// A copy from disk may name the file to the loader of the host.
    pub fn is_named_by_copies(&self, module: ModuleRef) -> bool {
        self.plan.named_by_copies.contains(module)
    }

    /// A file of the program may get at the entry of a file in `require.cache`.
    pub fn reaches_entries_of_cache(&self) -> bool {
        let plan = &self.plan;
        plan.may_evict_every_module
            || (self.lists_files_in_cache() && plan.reaches_entries_of_cache.unwrap_or(true))
    }

    /// `require.cache["fs"] = { exports: fake }`: an entry of the program may stand under the name, which is one that `require` looks for there.
    pub fn may_entry_in_cache_stand_under(&self, name: &[u8]) -> bool {
        let stored = &self.plan.library_modules_stored_in_cache;
        !stored.is_empty()
            && find_module_looked_up_in_cache(name).is_some_and(|module| stored.contains(&module))
    }

    /// `bun run` reads `require("fs")` as `require("node:fs")` in a CommonJS file that an import has loaded, and as it is written in one that `require` has loaded.
    /// Beside an entry under such a name the two differ, so the run time keeps track of how each CommonJS file of the program was first loaded.
    pub fn tracks_first_load(&self, file: FileId) -> bool {
        !self.plan.library_modules_stored_in_cache.is_empty()
            && self.kind(file) == ModuleKind::CommonJs
            && self.is_code_of_program(ModuleRef::File(file))
    }

    /// A `require` of the program is compiled for the module, whatever `require.cache` holds under the name that it looks for there. So the run time refuses an entry under that name.
    pub fn is_held_under_name_without_prefix(&self, module: RuntimeModule) -> bool {
        let stored = &self.plan.library_modules_stored_in_cache;
        module != RuntimeModule::Bun && !stored.contains(&module)
    }

    /// Of a test run: some file loads the module under a relative name that is not its path. A mock under such a name reaches those files.
    pub fn is_reached_by(&self, module: ModuleRef, spelling: Spelling) -> bool {
        let set = match spelling {
            Spelling::WithoutExtension => &self.plan.is_reached_without_extension,
            Spelling::UnderAnotherExtension => &self.plan.is_reached_under_another_extension,
            Spelling::AsFolder => &self.plan.is_reached_as_folder,
        };
        self.plan.has(set, module)
    }

    /// The body of the ES module runs each time the host loads it. Plain Bun makes a new module of the file each time, so each run has
    /// variables of its own. It finds a CommonJS file in `require.cache` and does not run it again, but for one whose last run threw.
    pub fn runs_again(&self, file: FileId) -> bool {
        matches!(
            self.kind(file),
            ModuleKind::SourceText | ModuleKind::CommonJs
        ) && self.plan.has(&self.plan.runs_again, ModuleRef::File(file))
    }

    /// JavaScript makes the functions that a module declares when the graph is linked, so a file that imports one in a cycle may call it ahead of the body.
    /// A file that runs again keeps what it does not export in an environment of the run, which such a function captures: nothing in the image can hold it.
    /// So the file has a function that makes both, and whoever may come first calls it: `makes_scope_ahead`.
    /// The function of a file calls that of every file that its text requests, as the link goes through the graph. So each ES module on a cycle with such
    /// a file has one, whether or not it has anything to make. No other file is touched.
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
        // The build has to see which calls are spies. A mock of bun:test is named at its call.
        (plan.may_mock_every_module && module != ModuleRef::Runtime(RuntimeModule::BunTest))
            || match module {
                ModuleRef::Runtime(module) => plan.mocked_runtime_modules.contains(&module),
                _ => plan.has(&plan.may_be_mocked, module),
            }
    }

    /// A mock may stand in place of the module. `may_be_mocked` also holds of a module whose object may meet a spy.
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

    /// In no order that means anything. Where a mock's name is computed, none: such a mock is laid over the module as before.
    pub fn runtime_modules_named_by_mocks(&self) -> &[RuntimeModule] {
        &self.plan.runtime_modules_named_by_mocks
    }

    /// The module is none of the program, and a mock gives its name: `import { window } from "vscode"` beside `mock.module("vscode", factory)`. `bun test` takes what a mock has made
    /// out of the loader when the test file ends, with its importers, and the next file's mock is asked when they load again. A compiled importer loads once.
    pub fn is_made_by_mocks_alone(&self, module: ModuleRef) -> bool {
        let names = &self.plan.names_without_code_that_mocks_give;
        matches!(module, ModuleRef::External { specifier, type_attribute: None, .. } if names.contains(&specifier))
    }

    /// Whether the test runner may store another value into the variable, which an ES module exports.
    pub fn is_replaceable(&self, variable: Sym) -> bool {
        let replaced = &self.plan.replaced_variables;
        replaced.binary_search(&variable).is_ok()
    }

    /// A later site of a module whose body threw throws the same error again.
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

    /// The file that has the id "." in every run. Which of several entry points has started the process is not known, and under an ES module the loader of the run time says which file it came to first.
    pub fn find_commonjs_main(&self, entry_points: &[EntryPoint]) -> Option<FileId> {
        match entry_points {
            [entry_point] if self.kind(entry_point.file) == ModuleKind::CommonJs => {
                Some(entry_point.file)
            }
            _ => None,
        }
    }

    /// A read that the build resolved can reach the module object.
    pub fn keeps_module_object(&self, module: ModuleRef) -> bool {
        self.plan.has(&self.plan.keeps_module_object, module)
    }

    /// Code of the file names a way from one module object to another.
    pub fn names_way_to_module_objects(&self, module: ModuleRef) -> bool {
        let plan = &self.plan;
        plan.has(&plan.names_way_to_module_objects, module)
    }

    /// Something in the run may ask for the original of a file beside its mock, which is the file once more, from disk.
    pub fn originals_beside_mocks_may_run(&self) -> bool {
        self.plan.originals_beside_mocks_may_run
    }

    /// A load under a name that the build does not follow may find the file.
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

    /// Whether whoever requires the module finds `__esModule` on it.
    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        match self.shape(module) {
            Shape::EsModule => (!self.is_marker_stored(module)).then_some(true),
            Shape::Names | Shape::Value => self.commonjs().marker(module),
            Shape::AsToday => None,
        }
    }

    /// What `__esModule` says to whoever imports the module.
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

    /// The callbacks in the file that are modules of their own.
    pub fn inner_modules(&self, file: FileId) -> &[FnId] {
        &self.plan.inner_callbacks[self.plan.inner_modules_of(file)]
    }

    pub fn inner_module(&self, file: FileId, callback: FnId) -> Option<ModuleRef> {
        let module = ModuleRef::Inner { file, callback };
        self.plan.order.numbers.number_of(module).map(|_| module)
    }

    /// With the faces, the checks and the CommonJS files that run first. Final behind `finish_plan`.
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

    /// The object of the module is a value somewhere: the module is `Value`, and with it every module whose names stand for names of it.
    pub fn look_at(&mut self, module: ModuleRef) {
        self.plan.reopen();
        self.commonjs_exports.look_at(module);
    }

    /// The modules whose names the text of the module hands on: by a star, by a name that stands for another, or as a whole.
    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.commonjs().name_sources(module)
    }

    /// A read that the build resolved reaches the module object, which shows `exports`.
    pub fn set_keeps_module_object(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.keeps_module_object, module);
        self.look_at(module);
    }

    pub fn set_names_way_to_module_objects(&mut self, module: ModuleRef) {
        self.plan
            .add(|plan| &mut plan.names_way_to_module_objects, module);
    }

    pub fn set_is_found_by_name(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.is_found_by_name, module);
    }

    pub fn set_namespace_is_seen(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.is_namespace_seen, module);
    }

    /// Behind the last change to a shape and to the files that are left out: which holders do without the object, and what each module asks for at last.
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
        // Nothing of the program runs before the loader has come to the first CommonJS file that the imports below an entry point lead to.
        let mut first_requests = self.plan.order.first_requests_of_host.iter();
        self.plan.is_first_require_seen = self.plan.names_way_to_module_objects.contains(&true)
            && first_requests.any(|&file| {
                self.kind(file) == ModuleKind::SourceText && !linked_files.leads_to_target(file)
            });
        self.plan.is_finished = true;
    }

    /// Which holders do without the object, by the shapes as they are. Whoever finds what the program reaches asks that of a graph whose plan is not finished.
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

    // A root is linked with the importers that its requests still lead to, and the CommonJS files below those run ahead of its check: `collect_prefix`. An importer
    // behind a request that has gone is linked where something else loads it, and is checked there. So is a name that an importer takes through a file that is
    // left out: nothing of the root runs the file that has it.
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
            // The loader runs the files of a root of its own where it comes to them, and the check behind them.
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

    /// `CommonJsExports::checked_copies` of the importers that the graph of imports below `root` still has. Final behind `finish_plan`.
    pub fn checks_of(&self, root: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        self.plan.final_checks.get(&root).map_or(&[], |it| &it[..])
    }

    /// Every root checks all that is written below it, whatever has become of its requests.
    #[cfg(test)]
    pub fn check_every_written_importer(&mut self) {
        for root in self.plan.order.prefix_roots.clone() {
            let written = self.commonjs().checked_copies(root).to_vec();
            if !written.is_empty() {
                self.plan.final_checks.insert(root, written);
            }
        }
    }

    /// A check reads the copies of names, and the faces that are hoisted in front of it store them. The first root whose check reads a copy that none of them
    /// stores, with the module that has the name: such an executable throws for a name that is there.
    pub fn find_check_of_copy_that_nothing_stores(&self) -> Option<(FileId, ModuleRef)> {
        let mut roots: Vec<FileId> = self.plan.final_checks.keys().copied().collect();
        roots.sort_unstable();
        // The loader of the run time runs the files below a root of its own where it comes to them, and the check behind them.
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
            let mut read = self.checks_of(root).iter().filter(is_read);
            let missing = read.find(|(export, _)| !stored.contains(export))?;
            Some((root, self.synthetic_export(missing.0).module))
        })
    }

    // The files of that kind, or their faces, that imports between ES modules reach from `root`, in the order in which `bun run` loads them: what a module imports comes behind everything that was asked for before.
    fn collect_prefix(&self, root: FileId, linked: &LinkedFiles) -> Vec<ModuleRef> {
        let mut prefix = Vec::new();
        if !linked.leads_to_target(root) {
            return prefix;
        }
        // The loader behind `import` takes such a file for an ES module: it runs in its turn among the modules, unless a `require` has come to it first.
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

    // The file of the program that is linked with whoever makes the request. `import defer` puts off when the file runs, not when it is linked.
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
        let leads_to_target = find_files_that_lead_to(targets, imports, successors.len());
        for imported in &mut successors {
            imported.retain(|&file| leads_to_target[file.idx()]);
        }
        LinkedFiles {
            by_importer: successors,
        }
    }

    // The ES modules at which an evaluation may come to a cycle of requests that leads to one of the files: something other than an import starts them, or a module outside the cycle imports them.
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

    /// The ES modules at which a graph of imports is linked: entry points, and what `import()` or a `require` names.
    pub fn prefix_roots(&self) -> &[FileId] {
        &self.plan.order.prefix_roots
    }

    /// The faces of the other files that have the names which the face of `file` shows, in the order of its copies.
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

    // `collect_prefix` of each root that has a record, in the order of the records.
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
            // The loader runs the files of such a root where it comes to them.
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
        // `bun run` has made what a data file exports when the graph is loaded. Only a function that is called across a cycle, ahead of the body of its module, can tell.
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
            // The loader of the run time goes by what the module writes, in the order in which it is written.
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
        // Also a face that no list names: `import(K)` asks for it, or another face does.
        for &face in self.record_files() {
            let file = ModuleRef::File(face);
            if self.face(file).is_none() {
                continue;
            }
            let start = requests.len() as u32;
            let completes_at = |module: ModuleRef| !self.half(module);
            // The run time takes what a face captures from the file that its first request names.
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
