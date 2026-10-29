#[cfg(test)]
mod tests;

use super::ApplicationGraph;
use super::bindings::{ImportBinding, ModuleExport, ModuleRequest, SyntheticExportId};
use super::graph::{ModuleGraph, find};
use super::imports::NamedMember;
use super::interop::{ImportPhase, ModuleKind};
use super::order::{OrderParts, SiteKey};
use super::reached_targets::ReachedTargets;
use super::wrapped::InnerModuleKind;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut};
use crate::load::sources::EntryPoint;
use crate::options::WaysBetweenModuleObjects;
use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::hir::{ExprId, FnId, ImportEqualsId, StmtId};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};
use bun_sema::util::FxHashMap;
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
    },
}

impl ModuleRef {
    pub fn map_file(self, map: &dyn Fn(FileId) -> Option<FileId>) -> Option<ModuleRef> {
        Some(match self {
            ModuleRef::File(file) => ModuleRef::File(map(file)?),
            ModuleRef::Inner { file, callback } => ModuleRef::Inner {
                file: map(file)?,
                callback,
            },
            ModuleRef::Face(file) => ModuleRef::Face(map(file)?),
            ModuleRef::Check(file) => ModuleRef::Check(map(file)?),
            ModuleRef::Runtime(_) => self,
            ModuleRef::External {
                importer,
                specifier,
            } => ModuleRef::External {
                importer: map(importer)?,
                specifier,
            },
        })
    }
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
    /// By ES module, in the order of its requests.
    by_importer: Vec<Vec<FileId>>,
    /// By ES module.
    targets_below: ReachedTargets,
}

pub(super) struct Plan {
    order: OrderParts,
    /// The callbacks of `order.numbers.inner_modules()`.
    inner_callbacks: Vec<FnId>,
    keeps_module_object: Vec<bool>,
    names_way_to_module_objects: Vec<bool>,
    ways_not_followed_out_of_sight: WaysBetweenModuleObjects,
    ways_followed_for_their_names: WaysBetweenModuleObjects,
    lets_process_out_of_sight: bool,
    /// A `require` of a file may run before the loader has come to a CommonJS file, and code names a way between module objects: whether one did says which file has the id ".".
    is_first_require_seen: bool,
    is_namespace_seen: Vec<bool>,
    /// A file stores `__esModule` on what `require` of the module answers.
    is_marker_stored: Vec<bool>,
    /// The statements that define inner modules, and those of modules that cannot be loaded.
    erased_statements: Vec<(FileId, StmtId)>,
    pub named_members: FxHashMap<(ModuleRef, Atom), NamedMember<ImportBinding>>,
    pub variables: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    /// What the inner modules ask for.
    pub(super) inner_requests: Vec<Vec<ModuleRequest>>,
    final_requests: Vec<ModuleRequest>,
    final_ranges: FxHashMap<ModuleRef, Range<u32>>,
    pub is_finished: bool,
}

impl Plan {
    pub(super) fn new(order: OrderParts, mut erased_statements: Vec<(FileId, StmtId)>) -> Plan {
        erased_statements.sort_unstable();
        let inner_modules = order.numbers.inner_modules().iter();
        Plan {
            inner_callbacks: inner_modules.map(|inner| inner.1).collect(),
            keeps_module_object: vec![false; order.numbers.len()],
            names_way_to_module_objects: vec![false; order.numbers.len()],
            ways_not_followed_out_of_sight: WaysBetweenModuleObjects::default(),
            ways_followed_for_their_names: WaysBetweenModuleObjects::default(),
            lets_process_out_of_sight: false,
            is_first_require_seen: false,
            is_namespace_seen: vec![false; order.numbers.len()],
            is_marker_stored: vec![false; order.numbers.len()],
            order,
            erased_statements,
            named_members: FxHashMap::default(),
            variables: FxHashMap::default(),
            inner_requests: Vec::new(),
            final_requests: Vec::new(),
            final_ranges: FxHashMap::default(),
            is_finished: false,
        }
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
                || (self.plan.is_first_require_seen && matches!(site.target, ModuleRef::File(_))),
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

    /// `E.N`, `R.N`, `d.N` and `ns.N`, where the access is bound to a name of a module.
    pub fn member(&self, file: FileId, access: ExprId) -> Option<Member> {
        if let Some((module, member)) = find(&self.row(file).fixed_members, access) {
            return Some(self.finish_fixed_member(module, member));
        }
        let Some(binding) = find(&self.row(file).members, access) else {
            return self.commonjs().own_member(file, access);
        };
        let accessed = find(&self.row(file).accessed, access)?;
        self.finish_member(accessed.module, binding, accessed.is_imported)
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

    /// An ES module that the CommonJS file leads to by a `require` imports the file.
    pub fn may_be_imported_while_it_runs(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(_))
            && self
                .plan
                .has(&self.plan.order.may_be_imported_while_it_runs, module)
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
        self.plan.is_finished = false;
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

    /// A module object goes where nothing follows it, and the files that these lead to from there have no module objects.
    pub fn ways_not_followed_out_of_sight(&self) -> WaysBetweenModuleObjects {
        self.plan.ways_not_followed_out_of_sight
    }

    pub fn set_ways_not_followed_out_of_sight(&mut self, ways: WaysBetweenModuleObjects) {
        self.plan.ways_not_followed_out_of_sight = ways;
    }

    /// A module object goes where nothing follows it, and these are followed from there because a file names them: whether anybody reads them of a module object is the engine's to say.
    pub fn ways_followed_for_their_names(&self) -> WaysBetweenModuleObjects {
        self.plan.ways_followed_for_their_names
    }

    pub fn set_ways_followed_for_their_names(&mut self, ways: WaysBetweenModuleObjects) {
        self.plan.ways_followed_for_their_names = ways;
    }

    /// `process` goes where nothing follows it, and the main module has no module object.
    pub fn lets_process_out_of_sight(&self) -> bool {
        self.plan.lets_process_out_of_sight
    }

    pub fn set_lets_process_out_of_sight(&mut self, lets: bool) {
        self.plan.lets_process_out_of_sight = lets;
    }

    pub fn set_names_way_to_module_objects(&mut self, module: ModuleRef) {
        self.plan
            .add(|plan| &mut plan.names_way_to_module_objects, module);
    }

    pub fn set_namespace_is_seen(&mut self, module: ModuleRef) {
        self.plan.add(|plan| &mut plan.is_namespace_seen, module);
    }

    /// `finish_plan` has to follow.
    pub fn adopt_plan(&mut self, application: &ApplicationGraph<'_>) {
        let (theirs, their_plan) = (application.graph, &application.graph.plan);
        let modules: Vec<ModuleRef> = self.plan.order.numbers.modules().collect();
        let mut left_out_inner_modules = Vec::new();
        for module in modules {
            let Some(their_module) = application.application_module(module) else {
                continue;
            };
            if theirs.keeps_module_object(their_module) {
                self.set_keeps_module_object(module);
            }
            if theirs.names_way_to_module_objects(their_module) {
                self.set_names_way_to_module_objects(module);
            }
            if their_plan.has(&their_plan.is_namespace_seen, their_module) {
                self.set_namespace_is_seen(module);
            }
            if matches!(module, ModuleRef::Inner { .. }) && theirs.is_left_out(their_module) {
                left_out_inner_modules.push(module);
            }
        }
        self.leave_out_inner_modules(&left_out_inner_modules);
    }

    /// Behind the last change to a shape and to the files that are left out: which holders do without the object, and what each module asks for at last.
    pub fn finish_plan(&mut self, in_parallel: InParallel<'_>) {
        if self.plan.is_finished {
            return;
        }
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
        let linked_files = self.find_linked_files(ModuleKind::CommonJs);
        let data_files = self.find_linked_files(ModuleKind::Data);
        (self.plan.final_requests, self.plan.final_ranges) =
            self.settle_requests(&linked_files, &data_files, in_parallel);
        // Nothing of the program runs before the loader has come to the first CommonJS file that the imports below an entry point lead to.
        let mut first_requests = self.plan.order.first_requests_of_host.iter();
        self.plan.is_first_require_seen = self.plan.names_way_to_module_objects.contains(&true)
            && first_requests.any(|&file| {
                self.kind(file) == ModuleKind::SourceText
                    && !linked_files.targets_below.leads_to_target(file)
            });
        self.plan.is_finished = true;
    }

    // The files of that kind, or their faces, that imports between ES modules reach from `root`, in the order in which `bun run` loads them: what a module imports comes behind everything that was asked for before.
    fn collect_prefix(&self, root: FileId, linked: &LinkedFiles) -> Vec<ModuleRef> {
        let below = &linked.targets_below;
        let mut prefix = Vec::new();
        let mut remaining = below.start_walk(root);
        if remaining.is_empty() {
            return prefix;
        }
        let mut is_seen = vec![false; linked.by_importer.len()];
        is_seen[root.idx()] = true;
        let mut importers = vec![root];
        let mut next = 0;
        while let Some(&file) = importers.get(next) {
            next += 1;
            for &target in &linked.by_importer[file.idx()] {
                if !below.is_target(target) {
                    if remaining.has_some_below(below, target)
                        && !core::mem::replace(&mut is_seen[target.idx()], true)
                    {
                        importers.push(target);
                    }
                } else if remaining.take(below, target) {
                    let target = ModuleRef::File(target);
                    prefix.push(self.face(target).unwrap_or(target));
                    if remaining.is_empty() {
                        return prefix;
                    }
                }
            }
        }
        prefix
    }

    // The file of the program that is linked with whoever makes the request.
    fn find_linked_file(&self, request: &ModuleRequest) -> Option<FileId> {
        let ModuleRef::File(target) = request.target else {
            return None;
        };
        let is_followed = request.kind == ModuleRequestKind::Import
            && request.phase == ImportPhase::Evaluation
            && (self.is_code_of_program(request.target)
                || self.plan.order.makes_values_at_load[target.idx()])
            && (!self.is_left_out(request.target) || self.is_placeholder(target));
        is_followed.then_some(target)
    }

    fn find_linked_files(&self, kind_of_targets: ModuleKind) -> LinkedFiles {
        let mut successors = Vec::new();
        successors.resize_with(self.row_by_file.len(), Vec::new);
        let mut targets = Vec::new();
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
            }
        }
        let targets_below = ReachedTargets::compute(targets.into_iter(), &successors);
        for targets in &mut successors {
            targets.retain(|&target| targets_below.leads_to_target(target));
        }
        LinkedFiles {
            by_importer: successors,
            targets_below,
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

    fn settle_requests(
        &self,
        linked_files: &LinkedFiles,
        data_files: &LinkedFiles,
        in_parallel: InParallel<'_>,
    ) -> (Vec<ModuleRequest>, FxHashMap<ModuleRef, Range<u32>>) {
        let mut requests: Vec<ModuleRequest> = Vec::new();
        let mut ranges = FxHashMap::default();
        let is_es_module = |file: FileId| {
            self.is_code_of_program(ModuleRef::File(file))
                && self.kind(file) == ModuleKind::SourceText
        };
        let prefix_roots = &self.plan.order.prefix_roots;
        let is_prefix_root = |file: FileId| prefix_roots.binary_search(&file).is_ok();
        let roots = self.record_files().iter().copied();
        let mut prefixes: Vec<(FileId, Vec<ModuleRef>)> = roots
            .filter(|&file| is_es_module(file) && is_prefix_root(file))
            .map(|root| (root, Vec::new()))
            .collect();
        for_each_mut(&mut prefixes, in_parallel, &|(root, prefix)| {
            // The loader runs the files of such a root where it comes to them.
            if !self.is_loaded_by_loader(ModuleRef::File(*root)) {
                *prefix = self.collect_prefix(*root, linked_files);
            }
        });
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
                if !self.commonjs().checked_copies(file).is_empty() {
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
            let completes_at =
                |module: ModuleRef| self.keeps_error(module) || !self.exposed(module);
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
