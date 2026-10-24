//! What the build knows of the module graph, as the rest of the front end asks for it.

#[cfg(test)]
mod tests;

use super::ApplicationGraph;
use super::bindings::{
    Holder, ImportBinding, ModuleExport, ModuleRequest, SyntheticExport, SyntheticExportId,
};
use super::failures::ModuleFailureId;
use super::graph::ModuleGraph;
use super::imports::NamedMember;
use super::interop::{ImportPhase, ModuleKind};
use super::order::{ModuleNumbers, OrderParts, SiteKey};
use super::reached_targets::ReachedTargets;
use super::wrapped::InnerModuleKind;
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use crate::ir::parallel::{InParallel, for_each_mut};
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

/// What a holder stands for.
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

/// A site that evaluates its target.
#[derive(Copy, Clone, Debug)]
pub(super) struct StoredSite {
    pub referrer: ModuleRef,
    pub target: ModuleRef,
    pub is_bare: bool,
}

pub(super) struct Plan {
    numbers: ModuleNumbers,
    /// The callbacks of `numbers.inner_modules()`.
    inner_callbacks: Vec<FnId>,
    is_code_of_program: Vec<bool>,
    is_exposed: Vec<bool>,
    is_half: Vec<bool>,
    keeps_module_object: Vec<bool>,
    names_way_to_module_objects: Vec<bool>,
    is_namespace_seen: Vec<bool>,
    prefix_roots: Vec<FileId>,
    /// The statements that define inner modules.
    erased_statements: Vec<(FileId, StmtId)>,
    named_members: FxHashMap<(ModuleRef, Atom), NamedMember<ImportBinding>>,
    variables: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    /// What the inner modules ask for.
    pub(super) inner_requests: Vec<Vec<ModuleRequest>>,
    final_requests: Vec<ModuleRequest>,
    final_ranges: FxHashMap<ModuleRef, Range<u32>>,
    is_finished: bool,
}

pub(super) struct PlanParts {
    pub order: OrderParts,
    pub erased_statements: Vec<(FileId, StmtId)>,
    pub named_members: Vec<((ModuleRef, Atom), NamedMember<ImportBinding>)>,
    pub seen_namespaces: Vec<ModuleRef>,
}

impl Plan {
    pub(super) fn new(parts: PlanParts, synthetic_exports: &[SyntheticExport]) -> Plan {
        let OrderParts {
            numbers,
            is_code_of_program,
            is_exposed,
            is_half,
            prefix_roots,
        } = parts.order;
        let ids = (0..).map(SyntheticExportId);
        let variables = synthetic_exports.iter().zip(ids);
        let mut erased_statements = parts.erased_statements;
        erased_statements.sort_unstable();
        let mut plan = Plan {
            inner_callbacks: numbers
                .inner_modules()
                .iter()
                .map(|inner| inner.1)
                .collect(),
            keeps_module_object: vec![false; numbers.len()],
            names_way_to_module_objects: vec![false; numbers.len()],
            is_namespace_seen: vec![false; numbers.len()],
            numbers,
            is_code_of_program,
            is_exposed,
            is_half,
            prefix_roots,
            erased_statements,
            named_members: parts.named_members.into_iter().collect(),
            variables: variables
                .map(|(export, id)| ((export.module, export.name), id))
                .collect(),
            inner_requests: Vec::new(),
            final_requests: Vec::new(),
            final_ranges: FxHashMap::default(),
            is_finished: false,
        };
        for module in parts.seen_namespaces {
            plan.add(|plan| &mut plan.is_namespace_seen, module);
        }
        plan
    }

    fn has(&self, set: &[bool], module: ModuleRef) -> bool {
        self.numbers
            .number_of(module)
            .is_some_and(|number| set[number])
    }

    fn add(&mut self, set: fn(&mut Plan) -> &mut Vec<bool>, module: ModuleRef) {
        if let Some(number) = self.numbers.number_of(module) {
            set(self)[number] = true;
        }
    }

    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        self.numbers.inner_modules()
    }

    fn inner_modules_of(&self, file: FileId) -> Range<usize> {
        let inner_modules = self.numbers.inner_modules();
        let start = inner_modules.partition_point(|inner| inner.0 < file);
        let end = inner_modules.partition_point(|inner| inner.0 <= file);
        start..end
    }
}

fn find<K: Copy + Ord, V: Copy>(entries: &[(K, V)], key: K) -> Option<V> {
    let at = entries.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(entries[at].1)
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
        self.plan().has(&self.plan().is_code_of_program, module)
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
        let is_site = kinds
            .iter()
            .any(|&kind| self.find_site_answer(file, kind).is_some());
        is_site.then_some(Site::AsToday)
    }

    /// `import a = require(K)`.
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
        let StoredSite {
            referrer,
            target,
            is_bare,
        } = site;
        // From the first `require` on the namespace object of an ES module has `__esModule`.
        let shows_mark = self.shape(target) == Shape::EsModule
            && self.plan().has(&self.plan().is_namespace_seen, target);
        Site::Evaluate {
            target,
            is_bare,
            records: shows_mark
                || self.keeps_module_object(referrer)
                || self.keeps_module_object(target),
        }
    }

    /// `false`: the call is a statement, the initializer of a holder or of a bound pattern, the object of a bound member, or only tested.
    pub fn is_site_read_as_value(&self, file: FileId, call: ExprId) -> bool {
        let Some(is_unread_in_every_shape) = find(self.unread_sites(file), call) else {
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
        let holder = self.find_holder(file, symbol)?;
        (!holder.is_needed_as_value).then_some(holder.view)
    }

    fn find_holder(&self, file: FileId, symbol: SymbolId) -> Option<Holder> {
        let holders = self.holders(file);
        let at = holders
            .binary_search_by_key(&symbol, |holder| holder.symbol)
            .ok()?;
        Some(holders[at])
    }

    /// `E.N`, `R.N`, `d.N` and `ns.N`, where the access is bound to a name of a module.
    pub fn member(&self, file: FileId, access: ExprId) -> Option<Member> {
        if let Some((module, member)) = find(self.fixed_members(file), access) {
            return Some(self.finish_fixed_member(module, member));
        }
        let Some(binding) = find(self.bound_members(file), access) else {
            return self.commonjs().own_member(file, access);
        };
        let accessed = find(self.accessed_modules(file), access)?;
        self.finish_member(accessed.module, binding, accessed.is_imported)
    }

    /// `R.N` for a name that no expression spells: a key of `const { N } = require(K)`, a key of `module.exports = { N }`, the source of a copy.
    pub fn member_named(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        match self.plan().named_members.get(&(module, name)) {
            Some(&NamedMember::Fixed(member)) => Some(self.finish_fixed_member(module, member)),
            Some(&NamedMember::Binding(binding)) => self.finish_member(module, binding, false),
            None => {
                let variable = self.variable_of(module, name)?;
                Some(self.commonjs().required_member(module, variable))
            }
        }
    }

    fn finish_fixed_member(&self, module: ModuleRef, member: Member) -> Member {
        match member {
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
                true => self.commonjs().imported_member(accessed, variable),
                false => self.commonjs().required_member(accessed, variable),
            }),
            _ => None,
        }
    }

    /// The variable of a name of a CommonJS module. `None`: no binding asks for it.
    pub fn variable_of(&self, module: ModuleRef, name: Atom) -> Option<SyntheticExportId> {
        self.plan().variables.get(&(module, name)).copied()
    }

    /// The statement has no code.
    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        self.plan()
            .erased_statements
            .binary_search(&(file, statement))
            .is_ok()
            || self.commonjs().erased(file, statement)
    }

    /// A late site names the module, or a module that a late site may run asks for it.
    pub fn exposed(&self, module: ModuleRef) -> bool {
        self.plan().has(&self.plan().is_exposed, module)
    }

    /// Somebody may look at the module while its body runs: it lies on a cycle of requests, or it is exposed.
    pub fn half(&self, module: ModuleRef) -> bool {
        self.plan().has(&self.plan().is_half, module)
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

    /// A read that the build resolved can reach the module object.
    pub fn keeps_module_object(&self, module: ModuleRef) -> bool {
        self.plan().has(&self.plan().keeps_module_object, module)
    }

    /// Code of the file names a way from one module object to another.
    pub fn names_way_to_module_objects(&self, module: ModuleRef) -> bool {
        self.plan()
            .has(&self.plan().names_way_to_module_objects, module)
    }

    pub fn settled(&self, module: ModuleRef, name: Atom) -> bool {
        self.commonjs().settled(module, name)
    }

    pub fn ignores_this(&self, module: ModuleRef, name: Atom) -> bool {
        self.commonjs().ignores_this(module, name)
    }

    /// Whether whoever requires the module finds `__esModule` on it.
    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        match self.shape(module) {
            Shape::EsModule => Some(true),
            Shape::Names | Shape::Value => self.commonjs().marker(module),
            Shape::AsToday => None,
        }
    }

    pub fn face(&self, module: ModuleRef) -> Option<ModuleRef> {
        self.commonjs().face(module)
    }

    /// The names that the body of a face copies.
    pub fn copies(&self, face: FileId) -> &[SyntheticExportId] {
        self.commonjs().copies(face)
    }

    /// The copies that must not be empty once every CommonJS file of the graph has run, in the order of the imports.
    pub fn checked_copies(&self, check: FileId) -> &[(SyntheticExportId, ModuleFailureId)] {
        self.commonjs().checked_copies(check)
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
        &self.plan().inner_callbacks[self.plan().inner_modules_of(file)]
    }

    pub fn inner_module(&self, file: FileId, callback: FnId) -> Option<ModuleRef> {
        let module = ModuleRef::Inner { file, callback };
        self.plan().numbers.number_of(module).map(|_| module)
    }

    /// With the faces, the checks and the CommonJS files that run first. Final behind `finish_plan`.
    pub fn requests_of(&self, module: ModuleRef) -> &[ModuleRequest] {
        if let Some(range) = self.plan().final_ranges.get(&module) {
            return &self.plan().final_requests[range.start as usize..range.end as usize];
        }
        self.written_requests(module)
    }

    // What the text of the module asks for.
    fn written_requests(&self, module: ModuleRef) -> &[ModuleRequest] {
        match module {
            ModuleRef::File(file) if self.has_record(file) => self.requests(file),
            ModuleRef::Inner { file, callback } => {
                let inner_modules = self.plan().inner_modules();
                match inner_modules.binary_search(&(file, callback)) {
                    Ok(position) => &self.plan().inner_requests[position],
                    Err(_) => &[],
                }
            }
            _ => &[],
        }
    }

    /// The object of the module is a value somewhere: the module is `Value`, and with it every module whose names stand for names of it.
    pub fn look_at(&mut self, module: ModuleRef) {
        self.commonjs_mut().look_at(module);
    }

    /// The modules whose names the text of the module hands on: by a star, by a name that stands for another, or as a whole.
    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.commonjs().name_sources(module)
    }

    /// A read that the build resolved reaches the module object, which shows `exports`.
    pub fn set_keeps_module_object(&mut self, module: ModuleRef) {
        self.plan_mut()
            .add(|plan| &mut plan.keeps_module_object, module);
        self.look_at(module);
    }

    pub fn set_names_way_to_module_objects(&mut self, module: ModuleRef) {
        self.plan_mut()
            .add(|plan| &mut plan.names_way_to_module_objects, module);
    }

    /// Something looks at the namespace object of the ES module.
    pub fn set_namespace_is_seen(&mut self, module: ModuleRef) {
        self.plan_mut()
            .add(|plan| &mut plan.is_namespace_seen, module);
    }

    /// `finish_plan` has to follow.
    pub fn adopt_plan(&mut self, application: &ApplicationGraph<'_>) {
        let theirs = application.graph;
        let modules: Vec<ModuleRef> = self.plan().numbers.modules().collect();
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
            if theirs
                .plan()
                .has(&theirs.plan().is_namespace_seen, their_module)
            {
                self.set_namespace_is_seen(module);
            }
            if matches!(module, ModuleRef::Inner { .. }) && theirs.is_left_out(their_module) {
                left_out_inner_modules.push(module);
            }
        }
        self.leave_out_inner_modules(&left_out_inner_modules);
    }

    pub(super) fn mark_plan_unfinished(&mut self) {
        self.plan_mut().is_finished = false;
    }

    pub(super) fn is_plan_finished(&self) -> bool {
        self.plan().is_finished
    }

    /// Behind the last change to a shape and to the files that are left out: which holders do without the object, and what each module asks for at last.
    pub fn finish_plan(&mut self, in_parallel: InParallel<'_>) {
        if self.is_plan_finished() {
            return;
        }
        self.settle_holders();
        let (requests, ranges) = self.settle_requests(in_parallel);
        let plan = self.plan_mut();
        plan.final_requests = requests;
        plan.final_ranges = ranges;
        plan.is_finished = true;
    }

    fn settle_holders(&mut self) {
        let module_of = |view: View| match view {
            View::Namespace(module) | View::Exports(module) => module,
        };
        let needs_object: Vec<bool> = self
            .all_holders()
            .map(|holder| !self.stands_without_object(module_of(holder.view)))
            .collect();
        for (holder, needs_object) in self.all_holders_mut().zip(needs_object) {
            holder.is_needed_as_value |= needs_object;
        }
    }

    // The CommonJS files, or their faces, that imports between ES modules reach from `root`, depth first, in the order of the imports.
    fn collect_prefix(&self, root: FileId, below: &ReachedTargets) -> Vec<ModuleRef> {
        let mut prefix = Vec::new();
        let mut remaining = below.start_walk(root);
        let mut seen = FxHashSet::default();
        seen.insert(root);
        let mut path = vec![(root, 0)];
        while let Some((file, next)) = path.last_mut() {
            if remaining.is_empty() {
                break;
            }
            let Some(&request) = self.requests(*file).get(*next) else {
                path.pop();
                continue;
            };
            *next += 1;
            let Some(target) = self.find_linked_file(&request) else {
                continue;
            };
            match self.kind(target) {
                ModuleKind::SourceText => {
                    if remaining.has_some_below(below, target) && seen.insert(target) {
                        path.push((target, 0));
                    }
                }
                ModuleKind::CommonJs => {
                    if remaining.take(below, target) {
                        prefix.push(self.face(request.target).unwrap_or(request.target));
                    }
                }
                ModuleKind::Data
                | ModuleKind::RuntimeSource
                | ModuleKind::Runtime
                | ModuleKind::External => {}
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
            && self.is_code_of_program(request.target)
            && !self.is_left_out(request.target);
        is_followed.then_some(target)
    }

    // By ES module: the CommonJS files that imports between ES modules lead to.
    fn find_commonjs_files_below(&self) -> ReachedTargets {
        let mut successors = Vec::new();
        successors.resize_with(self.file_count(), Vec::new);
        let mut commonjs_files = Vec::new();
        for &file in self.record_files() {
            if !self.is_code_of_program(ModuleRef::File(file))
                || self.kind(file) != ModuleKind::SourceText
            {
                continue;
            }
            let linked = self
                .requests(file)
                .iter()
                .filter_map(|request| self.find_linked_file(request));
            for target in linked {
                match self.kind(target) {
                    ModuleKind::SourceText => {}
                    ModuleKind::CommonJs => commonjs_files.push(target),
                    _ => continue,
                }
                successors[file.idx()].push(target);
            }
        }
        ReachedTargets::compute(commonjs_files.into_iter(), &successors)
    }

    /// The ES modules that are linked with `root`, itself first, depth first, in the order of the imports.
    pub fn modules_linked_with(&self, root: FileId) -> Vec<FileId> {
        let mut linked = vec![root];
        let mut seen = FxHashSet::default();
        seen.insert(root);
        let mut path = vec![(root, 0)];
        while let Some((file, next)) = path.last_mut() {
            let Some(&request) = self.requests(*file).get(*next) else {
                path.pop();
                continue;
            };
            *next += 1;
            if let ModuleRef::File(target) = request.target
                && request.kind == ModuleRequestKind::Import
                && request.phase == ImportPhase::Evaluation
                && self.is_code_of_program(request.target)
                && !self.is_left_out(request.target)
                && self.kind(target) == ModuleKind::SourceText
                && seen.insert(target)
            {
                linked.push(target);
                path.push((target, 0));
            }
        }
        linked
    }

    /// The ES modules at which a graph of imports is linked: entry points, and what `import()` or a `require` names.
    pub fn prefix_roots(&self) -> &[FileId] {
        &self.plan().prefix_roots
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
        in_parallel: InParallel<'_>,
    ) -> (Vec<ModuleRequest>, FxHashMap<ModuleRef, Range<u32>>) {
        let mut requests: Vec<ModuleRequest> = Vec::new();
        let mut ranges = FxHashMap::default();
        let commonjs_files_below = self.find_commonjs_files_below();
        let is_es_module = |file: FileId| {
            self.is_code_of_program(ModuleRef::File(file))
                && self.kind(file) == ModuleKind::SourceText
        };
        let is_prefix_root = |file: FileId| self.plan().prefix_roots.binary_search(&file).is_ok();
        let roots = self.record_files().iter().copied();
        let mut prefixes: Vec<(FileId, Vec<ModuleRef>)> = roots
            .filter(|&file| is_es_module(file) && is_prefix_root(file))
            .map(|root| (root, Vec::new()))
            .collect();
        for_each_mut(&mut prefixes, in_parallel, &|(root, prefix)| {
            *prefix = self.collect_prefix(*root, &commonjs_files_below);
        });
        let mut prefixes = prefixes.into_iter();
        for &file in self.record_files() {
            let module = ModuleRef::File(file);
            if !is_es_module(file) {
                continue;
            }
            let start = requests.len();
            if is_prefix_root(file) {
                let (root, prefix) = prefixes.next().expect("a prefix for each root");
                debug_assert_eq!(root, file);
                requests.extend(prefix.into_iter().map(ModuleRequest::import));
                if !self.checked_copies(file).is_empty() {
                    requests.push(ModuleRequest::import(ModuleRef::Check(file)));
                }
            }
            let prefix_end = requests.len();
            for &written in self.requests(file) {
                let request = match written.kind {
                    ModuleRequestKind::Import => ModuleRequest {
                        target: self.face(written.target).unwrap_or(written.target),
                        ..written
                    },
                    ModuleRequestKind::Require => written,
                };
                // Of two equal entries the first stays.
                let is_same = |earlier: &ModuleRequest| {
                    earlier.target == request.target
                        && earlier.phase == request.phase
                        && earlier.kind == request.kind
                };
                match requests[start..prefix_end].iter().position(is_same) {
                    Some(earlier) => {
                        let earlier = &mut requests[start + earlier];
                        earlier.is_dynamic_star_export |= request.is_dynamic_star_export;
                    }
                    None => requests.push(request),
                }
            }
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
