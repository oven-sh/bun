#[cfg(test)]
mod tests;

use super::exports::{ExportTables, Resolution};
use super::interop::{ImportPhase, ModuleKind, RequireResult};
use super::module_set::ModuleSet;
use super::requests::{FileScan, ScannedSite, Scans};
use super::spelled_files::{
    TextThatSpellsFile, find_texts_that_spell_files, is_every_file_found_by_name,
    list_what_made_names_may_find, program_loads_by_name_that_no_pattern_holds,
    take_or_list_texts_that_spell_files,
};
use super::wrapped::{InnerModule, InnerModuleKind, WrappedModules};
use super::{BindInput, ModuleRef};
use crate::ir::for_each_mut;
use crate::load::{EntryPointKind, SourceKind};
use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, Bound, CodeUnit, CommonJsVariable, FnOwner, Parent, has_mapped_arguments,
};
use bun_sema::components::strongly_connected_components;
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnId, ImportEqualsId, NodeData, StmtId, StmtKind,
    VarKind,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, OwnRequire, find_module_printed_as_require, find_own_require,
    may_call_have_made_base_of_require,
};
use bun_sema::program::{FileId, Files};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use std::borrow::Cow;
use std::cell::{OnceCell, RefCell};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum SitePosition {
    InOrder,
    Sometimes,
    Late,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum SiteKey {
    Call(ExprId),
    ImportEquals(ImportEqualsId),
}

#[derive(Copy, Clone, Debug)]
pub(super) struct PlannedSite {
    pub key: SiteKey,
    pub referrer: ModuleRef,
    pub target: ModuleRef,
    pub position: SitePosition,
    pub is_proven: bool,
    pub evaluates: bool,
    pub start: u32,
}

#[derive(Default)]
struct FileSites {
    sites: Vec<PlannedSite>,
    other_loads: Vec<(ModuleRef, ModuleRef)>,
    required_candidates: Vec<(ModuleRef, ModuleRef)>,
    requires_by_unknown_name_in_body: bool,
}

pub(super) struct ModuleNumbers {
    file_count: usize,
    inner_modules: Vec<(FileId, FnId)>,
}

impl ModuleNumbers {
    pub(super) fn new(file_count: usize, mut inner_modules: Vec<(FileId, FnId)>) -> ModuleNumbers {
        inner_modules.shared_sort_unstable();
        ModuleNumbers {
            file_count,
            inner_modules,
        }
    }
    pub(super) fn len(&self) -> usize {
        self.file_count + self.inner_modules.len()
    }

    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        &self.inner_modules
    }

    pub(super) fn number_of(&self, module: ModuleRef) -> Option<usize> {
        match module {
            ModuleRef::File(file) => (file.idx() < self.file_count).then_some(file.idx()),
            ModuleRef::Inner { file, callback } => {
                let position = self.inner_modules.binary_search(&(file, callback)).ok()?;
                Some(self.file_count + position)
            }
            _ => None,
        }
    }
}

pub(super) struct PlannedSites {
    by_file: Vec<Vec<PlannedSite>>,
    candidates_by_file: Vec<Vec<(ModuleRef, ModuleRef)>>,
}

impl PlannedSites {
    pub(super) fn of(&self, file: FileId) -> &[PlannedSite] {
        &self.by_file[file.idx()]
    }

    pub(super) fn candidates_of(&self, file: FileId) -> &[(ModuleRef, ModuleRef)] {
        &self.candidates_by_file[file.idx()]
    }

    pub(super) fn settle(&mut self, files: &Files<'_>, modules: &ModuleSet, tables: &ExportTables) {
        let name = files.atoms.lookup(b"module.exports");
        let lacks_name = |module: ModuleRef, name: Atom| {
            matches!(
                tables.resolve_in(modules, module, name).resolution,
                Resolution::NotFound | Resolution::Ambiguous
            )
        };
        let answers_as_the_build_says = |target: ModuleRef| {
            let interop = modules.interop(target);
            match interop.kind {
                ModuleKind::SourceText => {
                    interop.require_result == RequireResult::Namespace
                        && !modules.looks_for_forms_first(target)
                        && !tables.has_dynamic_names(target)
                        && name.is_none_or(|name| lacks_name(target, name))
                }
                ModuleKind::CommonJs => !modules.looks_for_forms_first(target),
                _ => false,
            }
        };
        for site in self.by_file.iter_mut().flatten() {
            site.evaluates &= answers_as_the_build_says(site.target);
        }
        for candidates in &mut self.candidates_by_file {
            candidates.retain(|&(_, target)| answers_as_the_build_says(target));
        }
    }
}

pub(super) struct EvaluationOrder {
    parts: OrderParts,
    is_on_cycle: Vec<bool>,
    is_half_at_link: Vec<bool>,
    needs_loader: Vec<bool>,
}

impl EvaluationOrder {
    fn has(&self, set: &[bool], module: ModuleRef) -> bool {
        let number = self.parts.numbers.number_of(module);
        number.is_some_and(|number| set[number])
    }

    pub(super) fn half(&self, module: ModuleRef) -> bool {
        self.has(&self.parts.is_half, module)
    }

    pub(super) fn half_at_link(&self, module: ModuleRef) -> bool {
        self.has(&self.is_half_at_link, module)
    }

    pub(super) fn is_prefix_root(&self, file: FileId) -> bool {
        self.parts.prefix_roots.binary_search(&file).is_ok()
    }

    pub(super) fn is_code_of_program(&self, module: ModuleRef) -> bool {
        self.has(&self.parts.is_code_of_program, module)
    }

    pub(super) fn into_parts(self) -> OrderParts {
        self.parts
    }

    fn can_evaluate(&self, modules: &ModuleSet, referrer: ModuleRef, target: ModuleRef) -> bool {
        let is_seen_whole = match modules.interop(target).kind {
            ModuleKind::SourceText => !self.has(&self.is_on_cycle, target),
            _ => true,
        };
        self.is_code_of_program(referrer)
            && self.is_code_of_program(target)
            && !self.has(&self.needs_loader, target)
            && !self.has(&self.parts.is_importable_during_evaluation, target)
            && is_seen_whole
    }
}

pub(super) struct OrderParts {
    pub numbers: ModuleNumbers,
    pub is_code_of_program: Vec<bool>,
    pub is_half: Vec<bool>,
    pub component_of: Vec<u32>,
    pub is_required_at_any_time: Vec<bool>,
    pub is_loaded_by_loader: Vec<bool>,
    pub is_required_during_load: Vec<bool>,
    pub is_importable_during_evaluation: Vec<bool>,
    pub makes_values_at_load: Vec<bool>,
    pub is_imported_as_es_module: Vec<bool>,
    pub prefix_roots: Vec<FileId>,
    pub required_prefix_roots: Vec<FileId>,
    pub texts_that_spell_files: Option<Vec<TextThatSpellsFile>>,
}

#[cfg(test)]
impl OrderParts {
    pub(super) fn without_sites(file_count: usize) -> OrderParts {
        OrderParts {
            numbers: ModuleNumbers::new(file_count, Vec::new()),
            is_code_of_program: vec![false; file_count],
            is_half: vec![false; file_count],
            component_of: (0..file_count as u32).collect(),
            is_required_at_any_time: vec![false; file_count],
            is_loaded_by_loader: vec![false; file_count],
            is_required_during_load: vec![false; file_count],
            is_importable_during_evaluation: vec![false; file_count],
            makes_values_at_load: vec![false; file_count],
            is_imported_as_es_module: vec![false; file_count],
            prefix_roots: Vec::new(),
            required_prefix_roots: Vec::new(),
            texts_that_spell_files: None,
        }
    }
}

pub(super) struct FileText<'a, 's> {
    files: &'a Files<'s>,
    wrapped: &'a WrappedModules,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    inner_modules: &'a [InnerModule],
    has_top_level_await: bool,
    first_turns: OnceCell<Vec<(CodeUnit, u32)>>,
    may_replace_require: OnceCell<bool>,
    called_only_where_written: RefCell<FxHashMap<FnId, bool>>,
}

#[derive(Copy, Clone)]
enum Node {
    Expression(ExprId),
    Statement(StmtId),
    Function(FnId),
}

impl<'a, 's> FileText<'a, 's> {
    pub(super) fn new(
        files: &'a Files<'s>,
        wrapped: &'a WrappedModules,
        file: FileId,
    ) -> FileText<'a, 's> {
        let analysis = files.analysis(file);
        FileText {
            files,
            wrapped,
            file,
            hir: files.hir(file),
            bound: files.bound(file),
            decisions: &analysis.decisions,
            inner_modules: wrapped.of_file(file),
            has_top_level_await: analysis.has_live_top_level_await,
            first_turns: OnceCell::new(),
            may_replace_require: OnceCell::new(),
            called_only_where_written: RefCell::default(),
        }
    }

    fn is_body(&self, unit: CodeUnit) -> bool {
        match unit {
            CodeUnit::File => true,
            CodeUnit::Function(function) => self.is_callback_of_inner_module(function),
            CodeUnit::FieldInitializer(_) => false,
        }
    }

    fn is_callback_of_inner_module(&self, function: FnId) -> bool {
        !self.inner_modules.is_empty() && self.wrapped.of_callback(self.file, function).is_some()
    }

    fn find_first_turns(&self) -> Vec<(CodeUnit, u32)> {
        let (hir, bound) = (self.hir, self.bound);
        let mut first_turns: Vec<(CodeUnit, u32)> = Vec::new();
        for statement in (0..hir.stmts.len() as u32).map(StmtId) {
            let is_turn = match hir[statement].kind {
                StmtKind::Return(_) => true,
                StmtKind::Var(declarations) => declarations.iter().any(|declaration| {
                    matches!(hir[declaration].kind, VarKind::Using | VarKind::AwaitUsing)
                }),
                _ => false,
            };
            if !is_turn || self.decisions.is_dead_stmt(statement) {
                continue;
            }
            let scope = bound.scope_of_stmt(statement);
            if scope.is_none() {
                continue;
            }
            let unit = bound.code_unit(scope);
            if !self.is_body(unit) {
                continue;
            }
            let start = hir[statement].start;
            match first_turns.iter_mut().find(|entry| entry.0 == unit) {
                Some(entry) => entry.1 = entry.1.min(start),
                None => first_turns.push((unit, start)),
            }
        }
        first_turns
    }

    fn enclosing_module(&self, expression: ExprId) -> ModuleRef {
        if self.inner_modules.is_empty() {
            return ModuleRef::File(self.file);
        }
        match self.wrapped.enclosing(self.files, self.file, expression) {
            Some(inner) => ModuleRef::Inner {
                file: self.file,
                callback: inner.callback,
            },
            None => ModuleRef::File(self.file),
        }
    }

    fn as_commonjs_module(&self, inner: &InnerModule) -> Option<ModuleRef> {
        (inner.kind == InnerModuleKind::CommonJs).then_some(ModuleRef::Inner {
            file: self.file,
            callback: inner.callback,
        })
    }

    pub(super) fn find_inner_commonjs_module_of_call(&self, call: ExprId) -> Option<ModuleRef> {
        self.as_commonjs_module(self.wrapped.of_call(self.files, self.file, call)?)
    }

    pub(super) fn calls_of_inner_commonjs_modules(
        &self,
    ) -> impl Iterator<Item = (ExprId, ModuleRef)> + '_ {
        let calls = self.wrapped.calls_in(self.file);
        calls.filter_map(|(call, inner)| Some((call, self.as_commonjs_module(inner)?)))
    }

    pub(super) fn always_evaluates(&self, parent: ExprId, operand: ExprId) -> bool {
        let hir = self.hir;
        let is_choice = |op: BinOp| matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
        match hir[parent].kind {
            ExprKind::Cond { test, .. } => operand == test,
            ExprKind::Binary { op, left, .. } => !is_choice(op) || operand == left,
            ExprKind::Assign {
                op: Some(op),
                value,
                ..
            } => !is_choice(op) || operand != value,
            ExprKind::Assign {
                op: None, value, ..
            } => operand != value || self.bound.get_assignment_target(hir, parent).is_none(),
            ExprKind::Index { obj, chain, .. } => chain == Chain::No || operand == obj,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                hir[call].chain == Chain::No || hir[call].callee == operand
            }
            _ => true,
        }
    }

    fn statement_always_evaluates(&self, statement: StmtId, expression: ExprId) -> bool {
        match self.hir[statement].kind {
            StmtKind::Expr(_)
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::Directive { .. } => true,
            StmtKind::If { test, .. } => test == expression,
            StmtKind::Switch { expr, .. } => expr == expression,
            StmtKind::ForIn { expr, .. } => expr == expression,
            StmtKind::ForOf { expr, is_await, .. } => expr == expression && !is_await,
            _ => false,
        }
    }

    pub(super) fn is_called_where_written(&self, function: FnId) -> bool {
        let hir = self.hir;
        let mut known = self.called_only_where_written.borrow_mut();
        !hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
            && *known
                .entry(function)
                .or_insert_with(|| self.bound.is_called_only_where_written(hir, function))
    }

    fn find_body(&self, start: Node, goes_past_try: bool) -> Option<(CodeUnit, SitePosition)> {
        let (hir, bound) = (self.hir, self.bound);
        let mut position = SitePosition::InOrder;
        let mut node = start;
        loop {
            node = match node {
                Node::Expression(child) => match bound.parent_of_expr(child) {
                    Parent::Expr(parent) if parent.is_some() => {
                        if !self.always_evaluates(parent, child) {
                            position = SitePosition::Sometimes;
                        }
                        Node::Expression(parent)
                    }
                    Parent::Prop(property)
                    | Parent::PropKey(property)
                    | Parent::MethodKey(property) => {
                        Node::Expression(bound.prop_owner[property.idx()])
                    }
                    Parent::VarInit(declaration) => {
                        Node::Statement(bound.var_stmt[declaration.idx()])
                    }
                    Parent::Stmt(statement) => {
                        if !self.statement_always_evaluates(statement, child) {
                            position = SitePosition::Sometimes;
                        }
                        Node::Statement(statement)
                    }
                    Parent::FnBody(function) => Node::Function(function),
                    Parent::ParamDefault(parameter) => {
                        position = SitePosition::Sometimes;
                        Node::Function(bound.param_fn[parameter.idx()])
                    }
                    Parent::File => return Some((CodeUnit::File, position)),
                    _ => return None,
                },
                Node::Statement(child) => match bound.parent_of_stmt(child) {
                    Parent::File => return Some((CodeUnit::File, position)),
                    Parent::FnBody(function) => Node::Function(function),
                    Parent::Stmt(parent) => {
                        match hir[parent].kind {
                            StmtKind::Block(_) => {}
                            StmtKind::Try { .. } if !goes_past_try => return None,
                            _ => position = SitePosition::Sometimes,
                        }
                        Node::Statement(parent)
                    }
                    _ => return None,
                },
                Node::Function(function) if self.is_callback_of_inner_module(function) => {
                    return Some((CodeUnit::Function(function), position));
                }
                Node::Function(function) => {
                    let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
                        return None;
                    };
                    if !self.is_called_where_written(function) {
                        return None;
                    }
                    position = SitePosition::Sometimes;
                    Node::Expression(written)
                }
            };
        }
    }

    fn locate(&self, node: Node, start: u32) -> (ModuleRef, SitePosition) {
        let Some((unit, position)) = self.find_body(node, false) else {
            let fallback = match node {
                Node::Expression(expression) => self.enclosing_module(expression),
                Node::Statement(_) | Node::Function(_) => ModuleRef::File(self.file),
            };
            return (fallback, SitePosition::Late);
        };
        let module = match unit {
            CodeUnit::Function(callback) => ModuleRef::Inner {
                file: self.file,
                callback,
            },
            CodeUnit::File | CodeUnit::FieldInitializer(_) => ModuleRef::File(self.file),
        };
        let first_turns = self.first_turns.get_or_init(|| self.find_first_turns());
        let first_turn = first_turns.iter().find(|entry| entry.0 == unit);
        let may_be_skipped = first_turn.is_some_and(|entry| entry.1 < start)
            || (unit == CodeUnit::File && self.has_top_level_await);
        match may_be_skipped {
            true => (module, position.max(SitePosition::Sometimes)),
            false => (module, position),
        }
    }

    pub(super) fn may_replace_require(&self) -> bool {
        *self.may_replace_require.get_or_init(|| {
            let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
            let binding = Binding::CommonJs(CommonJsVariable::Require);
            let mut stores = bound.runtime.unbound_name_stores().iter();
            let mut evals = bound.runtime.eval_scopes().iter();
            let mut idents = bound.ident_bindings().iter();
            stores.any(|&(target, _)| {
                bound.binding(target) == binding && !decisions.is_dead_expr(target)
            }) || evals.any(|&(call, _)| !decisions.is_dead_expr(call))
                || (has_mapped_arguments(hir, CodeUnit::File)
                    && idents.any(|&(ident, binding)| {
                        binding == Binding::Arguments(CodeUnit::File)
                            && !decisions.is_dead_expr(ident)
                    }))
        })
    }

    pub(super) fn is_free(&self, expression: ExprId, variable: CommonJsVariable) -> bool {
        let scope_object = self.bound.dynamic_lookup_scope(NodeData::Expr(expression));
        matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(variable)
            && scope_object.is_none()
    }

    fn is_proven_call(
        &self,
        site: ImportSiteKind,
        call: ExprId,
        kind: ModuleKind,
        runs_tests: bool,
    ) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Call(id) = hir[call].kind else {
            return false;
        };
        let mut arguments = hir.ids(hir[id].args);
        if hir[id].chain != Chain::No
            || arguments.any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_)))
        {
            return false;
        }
        let callee = hir.skip_type_assertions(hir[id].callee);
        match site {
            ImportSiteKind::ImportMetaRequire(_) => {
                kind == ModuleKind::SourceText
                    && !bound.import_meta_may_be_modified()
                    && (!runs_tests || hir.member_key(callee).is_some())
            }
            ImportSiteKind::Require(_)
                if self.is_free(callee, CommonJsVariable::Require)
                    || find_module_printed_as_require(hir, bound, callee).is_some() =>
            {
                !self.may_replace_require()
            }
            ImportSiteKind::Require(_) => match hir.member_key(callee) {
                Some(_) => false,
                None => {
                    !runs_tests
                        && find_own_require(hir, bound, None, callee) == Some(OwnRequire::Made)
                        && !may_call_have_made_base_of_require(hir, bound, callee)
                }
            },
            _ => false,
        }
    }
}

fn plan_file_sites(
    files: &Files<'_>,
    scan: &FileScan,
    modules: &ModuleSet,
    file: FileId,
    runs_tests: bool,
) -> FileSites {
    let mut planned = FileSites::default();
    let sites = files.analysis(file).import_sites;
    let is_required_for_jsx = |site: ImportSiteKind| {
        let is_jsx_site = matches!(
            site,
            ImportSiteKind::JsxRuntime | ImportSiteKind::JsxPackage
        );
        is_jsx_site && scan.interop.kind == ModuleKind::CommonJs
    };
    let loads_modules = |site: &ImportSite| {
        loading_call(site.kind).is_some()
            || matches!(site.kind, ImportSiteKind::ImportEquals(_))
            || is_required_for_jsx(site.kind)
    };
    if !sites.iter().any(loads_modules) && modules.wrapped.of_file(file).is_empty() {
        return planned;
    }
    let text = FileText::new(files, &modules.wrapped, file);
    let hir = text.hir;
    for (site, answer) in sites.iter().zip(&scan.sites) {
        let target = match answer {
            &ScannedSite::Module(target) => target,
            ScannedSite::Candidates(range) => {
                if let Some(call) = loading_call(site.kind) {
                    let referrer = text.enclosing_module(call);
                    let spelled = &scan.spellings[range.start as usize..range.end as usize];
                    let loads = spelled.iter().map(|spelled| (referrer, spelled.module));
                    if !matches!(site.kind, ImportSiteKind::ImportCall(_)) {
                        planned.required_candidates.extend(loads.clone());
                    }
                    planned.other_loads.extend(loads);
                }
                continue;
            }
            ScannedSite::AllModules => {
                if let ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) =
                    site.kind
                {
                    planned.requires_by_unknown_name_in_body |=
                        text.find_body(Node::Expression(call), true).is_some();
                }
                continue;
            }
            ScannedSite::Unresolved | ScannedSite::Erased => continue,
        };
        let (key, node, start, is_proven) = match site.kind {
            ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => (
                SiteKey::Call(call),
                Node::Expression(call),
                hir[call].pos,
                text.is_proven_call(site.kind, call, scan.interop.kind, runs_tests),
            ),
            ImportSiteKind::ImportEquals(declaration) => {
                let (key, statement) = (SiteKey::ImportEquals(declaration), hir[declaration].stmt);
                (key, Node::Statement(statement), hir[statement].start, true)
            }
            ImportSiteKind::ImportCall(call) => {
                planned
                    .other_loads
                    .push((text.enclosing_module(call), target));
                continue;
            }
            kind if is_required_for_jsx(kind) => {
                let load = (ModuleRef::File(file), target);
                planned.required_candidates.push(load);
                planned.other_loads.push(load);
                continue;
            }
            _ => continue,
        };
        let (referrer, position) = text.locate(node, start);
        planned.sites.push(PlannedSite {
            key,
            referrer,
            target,
            position: match is_proven {
                true => position,
                false => position.max(SitePosition::Sometimes),
            },
            is_proven,
            evaluates: true,
            start,
        });
    }
    for (call, inner) in modules.wrapped.calls_in(file) {
        let (referrer, position) = text.locate(Node::Expression(call), hir[call].pos);
        planned.sites.push(PlannedSite {
            key: SiteKey::Call(call),
            referrer,
            target: ModuleRef::Inner {
                file,
                callback: inner.callback,
            },
            position,
            is_proven: true,
            evaluates: true,
            start: hir[call].pos,
        });
    }
    planned.sites.shared_sort_by_key(|site| site.start);
    planned
}

fn loading_call(site: ImportSiteKind) -> Option<ExprId> {
    match site {
        ImportSiteKind::ImportCall(call)
        | ImportSiteKind::Require(call)
        | ImportSiteKind::ImportMetaRequire(call) => Some(call),
        _ => None,
    }
}

fn collect_edges(
    scans: &Scans,
    modules: &ModuleSet,
    numbers: &ModuleNumbers,
    planned: &[(FileId, FileSites)],
) -> (Vec<Vec<u32>>, Vec<Vec<u32>>) {
    let mut all = vec![Vec::<u32>::new(); numbers.len()];
    let mut importers = vec![Vec::new(); numbers.len()];
    let mut add = |referrer: ModuleRef, target: ModuleRef| {
        let (Some(referrer), Some(target)) =
            (numbers.number_of(referrer), numbers.number_of(target))
        else {
            return;
        };
        if !all[referrer].contains(&(target as u32)) {
            all[referrer].push(target as u32);
        }
    };
    for &file in &modules.compiled_files {
        for request in &scans.of(file).requests {
            add(ModuleRef::File(file), request.target);
            if let Some(target) = numbers.number_of(request.target) {
                importers[target].push(file.0);
            }
        }
    }
    for (_, file_sites) in planned {
        for site in &file_sites.sites {
            add(site.referrer, site.target);
        }
        for &(referrer, target) in &file_sites.other_loads {
            add(referrer, target);
        }
    }
    (all, importers)
}

fn find_modules_on_cycles(edges: &[Vec<u32>]) -> (Vec<bool>, Vec<u32>) {
    let (component_of, components) = strongly_connected_components(edges);
    let is_on_cycle = |(module, targets): (usize, &Vec<u32>)| {
        components[component_of[module] as usize].len() > 1 || targets.contains(&(module as u32))
    };
    let is_on_cycle = edges.iter().enumerate().map(is_on_cycle).collect();
    (is_on_cycle, component_of)
}

fn find_reached(edges: &[Vec<u32>], mut pending: Vec<u32>) -> Vec<bool> {
    let mut is_reached = vec![false; edges.len()];
    while let Some(module) = pending.pop() {
        if !core::mem::replace(&mut is_reached[module as usize], true) {
            pending.extend_from_slice(&edges[module as usize]);
        }
    }
    is_reached
}

struct FilesStartedByTestRunner {
    started_behind_first: Vec<u32>,
    reached_by_several: Vec<u32>,
}

impl FilesStartedByTestRunner {
    fn find(
        edges: &[Vec<u32>],
        candidates: &[(u32, u32)],
        started: &[u32],
        started_behind_first: Vec<u32>,
    ) -> Self {
        const NOBODY: u32 = u32::MAX;
        let follow = |module: u32, pending: &mut Vec<u32>| {
            pending.extend_from_slice(&edges[module as usize]);
            let first = candidates.partition_point(|load| load.0 < module);
            let of_module = candidates[first..]
                .iter()
                .take_while(|load| load.0 == module);
            pending.extend(of_module.map(|load| load.1));
        };
        let mut first_to_reach = vec![NOBODY; edges.len()];
        let mut is_reached_by_several = vec![false; edges.len()];
        let mut reached_by_several = Vec::new();
        let (mut pending, mut reached_again) = (Vec::new(), Vec::new());
        for (number, &file) in started.iter().enumerate() {
            pending.push(file);
            while let Some(module) = pending.pop() {
                let first = &mut first_to_reach[module as usize];
                if *first == NOBODY {
                    *first = number as u32;
                    follow(module, &mut pending);
                } else if *first != number as u32 {
                    reached_again.push(module);
                }
            }
            while let Some(module) = reached_again.pop() {
                if !core::mem::replace(&mut is_reached_by_several[module as usize], true) {
                    reached_by_several.push(module);
                    follow(module, &mut reached_again);
                }
            }
        }
        FilesStartedByTestRunner {
            started_behind_first,
            reached_by_several,
        }
    }

    fn find_reached(&self, edges: &[Vec<u32>], mut pending: Vec<u32>) -> Vec<bool> {
        pending.retain(|module| self.started_behind_first.binary_search(module).is_err());
        pending.extend_from_slice(&self.reached_by_several);
        let mut is_reached = find_reached(edges, pending);
        for &file in &self.started_behind_first {
            is_reached[file as usize] = true;
        }
        is_reached
    }
}

fn find_program_code(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    numbers: &ModuleNumbers,
) -> Vec<bool> {
    let mut is_code = vec![false; numbers.len()];
    for &file in &modules.compiled_files {
        is_code[file.idx()] = input.sources.kind(file) == SourceKind::Program
            && matches!(
                scans.of(file).interop.kind,
                ModuleKind::SourceText | ModuleKind::CommonJs
            );
    }
    for entry_point in input.sources.entry_points() {
        if entry_point.kind == EntryPointKind::Library {
            is_code[entry_point.file.idx()] = false;
        }
    }
    for &(file, callback) in numbers.inner_modules() {
        let number = numbers.number_of(ModuleRef::Inner { file, callback });
        is_code[number.expect("the list has the module")] = is_code[file.idx()];
    }
    is_code
}

struct LoadsSeenByProgram {
    is_loaded_by_loader: Vec<bool>,
    is_required_during_load: Vec<bool>,
    is_importable_during_evaluation: Vec<bool>,
}

fn list_what_file_may_require<'a>(
    file: FileId,
    file_sites: &'a FileSites,
    found_by_made_names: &'a [(FileId, FileId)],
) -> impl Iterator<Item = (ModuleRef, ModuleRef)> + 'a {
    let first = found_by_made_names.partition_point(|found| found.0 < file);
    let found = found_by_made_names[first..].iter();
    let found = found.take_while(move |found| found.0 == file);
    let found = found.map(|found| (ModuleRef::File(found.0), ModuleRef::File(found.1)));
    let sites = file_sites.sites.iter();
    let sites = sites.map(|site| (site.referrer, site.target));
    sites
        .chain(file_sites.required_candidates.iter().copied())
        .chain(found)
}

fn find_loads_seen_by_program(
    scans: &Scans,
    modules: &ModuleSet,
    numbers: &ModuleNumbers,
    edges: &[Vec<u32>],
    is_code_of_program: &[bool],
    planned: &[(FileId, FileSites)],
    found_by_made_names: &[(FileId, FileId)],
) -> LoadsSeenByProgram {
    let count = is_code_of_program.len();
    let mut seen = LoadsSeenByProgram {
        is_loaded_by_loader: vec![false; count],
        is_required_during_load: vec![false; count],
        is_importable_during_evaluation: vec![false; count],
    };
    let kind_of = |module: ModuleRef| match module {
        ModuleRef::File(file) if is_code_of_program[file.idx()] => {
            Some((file, scans.of(file).interop.kind))
        }
        _ => None,
    };
    let files_of_program = modules.compiled_files.iter();
    let files_of_program = files_of_program.filter_map(|&file| kind_of(ModuleRef::File(file)));
    let es_modules = files_of_program
        .clone()
        .filter(|known| known.1 == ModuleKind::SourceText);
    let imports = es_modules.flat_map(|(importer, _)| {
        let requests = scans.of(importer).requests.iter();
        requests.filter_map(move |request| Some((importer, kind_of(request.target)?)))
    });
    let imports = imports.filter(|(_, known)| known.1 == ModuleKind::CommonJs);
    let imports: Vec<(FileId, FileId)> = imports
        .map(|(importer, known)| (importer, known.0))
        .collect();
    for (file, file_sites) in planned {
        let mut loads = file_sites.other_loads.iter();
        if scans.of(*file).interop.kind == ModuleKind::CommonJs
            && loads.any(|load| load.1 == ModuleRef::File(*file))
        {
            seen.is_importable_during_evaluation[file.idx()] = true;
        }
    }
    if imports.is_empty() {
        return seen;
    }

    let mut edges = Cow::Borrowed(edges);
    for &(asker, found) in found_by_made_names {
        edges.to_mut()[asker.idx()].push(found.0);
    }
    let edges = &edges[..];
    let imported = imports.iter().map(|(_, file)| file.0).collect();
    let runs_during_load = find_reached(edges, imported);
    let mut component_of = None;
    let mut components_that_lead_back = Vec::new();
    let mut components_imported_back = Vec::new();
    let mut files_imported_back = Vec::new();
    for (file, file_sites) in planned {
        if scans.of(*file).interop.kind == ModuleKind::CommonJs {
            let mut required = None;
            for load in &file_sites.other_loads {
                let &(referrer, target) = load;
                let Some((target, kind)) = kind_of(target) else {
                    continue;
                };
                if kind != ModuleKind::SourceText && kind != ModuleKind::CommonJs {
                    continue;
                }
                let Some(referrer) = numbers.number_of(referrer) else {
                    continue;
                };
                if !runs_during_load[referrer] {
                    continue;
                }
                let component_of =
                    component_of.get_or_insert_with(|| strongly_connected_components(edges).0);
                if component_of[referrer] != component_of[target.idx()] {
                    continue;
                }
                if kind == ModuleKind::SourceText {
                    components_imported_back.push(component_of[referrer]);
                    continue;
                }
                let required: &FxHashSet<_> =
                    required.get_or_insert_with(|| file_sites.required_candidates.iter().collect());
                if !required.contains(load) {
                    files_imported_back.push(target);
                }
            }
        }
        let required = list_what_file_may_require(*file, file_sites, found_by_made_names);
        for (referrer, target) in required {
            let Some((target, ModuleKind::SourceText)) = kind_of(target) else {
                continue;
            };
            let Some(referrer) = numbers.number_of(referrer) else {
                continue;
            };
            if !runs_during_load[referrer] {
                continue;
            }
            seen.is_required_during_load[target.idx()] = true;
            if scans.of(*file).interop.kind != ModuleKind::CommonJs {
                continue;
            }
            let component_of =
                component_of.get_or_insert_with(|| strongly_connected_components(edges).0);
            if component_of[referrer] == component_of[target.idx()] {
                components_that_lead_back.push(component_of[referrer]);
            }
        }
    }
    let Some(component_of) = component_of else {
        return seen;
    };
    for &(importer, file) in &imports {
        seen.is_importable_during_evaluation[file.idx()] |= components_imported_back
            .contains(&component_of[file.idx()])
            && component_of[importer.idx()] == component_of[file.idx()];
    }
    for file in files_imported_back {
        seen.is_importable_during_evaluation[file.idx()] = true;
    }
    if components_that_lead_back.is_empty() {
        return seen;
    }
    let leads_back = |module: usize| components_that_lead_back.contains(&component_of[module]);
    let mut askers = vec![Vec::new(); count];
    let mut asks = |referrer: ModuleRef, target: ModuleRef| {
        if let (Some(referrer), Some(target)) =
            (numbers.number_of(referrer), numbers.number_of(target))
        {
            askers[target].push(referrer as u32);
        }
    };
    for &file in &modules.compiled_files {
        for request in &scans.of(file).requests {
            asks(ModuleRef::File(file), request.target);
        }
    }
    for (file, file_sites) in planned {
        let required = list_what_file_may_require(*file, file_sites, found_by_made_names);
        for (referrer, target) in required {
            asks(referrer, target);
        }
    }
    let cycles = (0..count).filter(|&module| leads_back(module));
    let comes_to_cycle = find_reached(&askers, cycles.map(|module| module as u32).collect());
    for (file, _) in files_of_program {
        seen.is_loaded_by_loader[file.idx()] = comes_to_cycle[file.idx()];
    }
    for (importer, file) in imports {
        seen.is_importable_during_evaluation[file.idx()] |=
            leads_back(file.idx()) && component_of[importer.idx()] == component_of[file.idx()];
    }
    seen
}

fn find_importers_that_ask_for_several_types(modules: &ModuleSet) -> Vec<u32> {
    let typed = || {
        let statements = modules.left_to_loader.iter();
        statements.filter_map(|&((importer, _, asked), file)| Some((importer, asked?, file)))
    };
    let mut first_types = FxHashMap::default();
    let mut asked_under_several = FxHashSet::default();
    for (_, asked, file) in typed() {
        if *first_types.entry(file).or_insert(asked) != asked {
            asked_under_several.insert(file);
        }
    }
    let asking = typed().filter(|it| asked_under_several.contains(&it.2));
    asking.map(|it| it.0.0).collect()
}

fn find_prefix_roots(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    is_code_of_program: &[bool],
    planned: &[(FileId, FileSites)],
) -> Vec<FileId> {
    let entry_points = input.sources.entry_points().iter();
    let entry_points = entry_points.map(|entry| ModuleRef::File(entry.file));
    let loaded = planned.iter().flat_map(|(_, file_sites)| {
        let required = file_sites.sites.iter().map(|site| site.target);
        required.chain(file_sites.other_loads.iter().map(|load| load.1))
    });
    let left_to_loader = modules.left_to_loader.iter();
    let left_to_loader = left_to_loader.map(|statement| ModuleRef::File(statement.1));
    let mut roots: Vec<FileId> = entry_points
        .chain(loaded)
        .chain(left_to_loader)
        .filter_map(|module| match module {
            ModuleRef::File(file) if is_code_of_program[file.idx()] => Some(file),
            _ => None,
        })
        .filter(|&file| scans.of(file).interop.kind == ModuleKind::SourceText)
        .collect();
    roots.shared_sort_unstable();
    roots.dedup();
    roots
}

pub(super) fn compute_order(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> (EvaluationOrder, PlannedSites) {
    let files = input.files;
    let file_count = files.modules.len();
    let numbers = ModuleNumbers::new(file_count, modules.inner_modules().to_vec());
    let compiled_files = modules.compiled_files.iter();
    let mut planned: Vec<(FileId, FileSites)> = compiled_files
        .map(|&file| (file, FileSites::default()))
        .collect();
    for_each_mut(&mut planned, input.in_parallel, &|(file, file_sites)| {
        *file_sites = plan_file_sites(files, scans.of(*file), modules, *file, input.runs_tests);
    });
    let (edges, importers) = collect_edges(scans, modules, &numbers, &planned);
    let is_code_of_program = find_program_code(input, scans, modules, &numbers);
    let needs_loader_itself = |&&file: &&FileId| {
        let scan = scans.of(file);
        let mut requests = scan.requests.iter();
        (scan.interop.kind == ModuleKind::SourceText
            && files.analysis(file).has_live_top_level_await)
            || requests.any(|request| {
                request.phase == ImportPhase::Defer || modules.is_uncompiled_code(request.target)
            })
    };
    let seeds = modules.compiled_files.iter().filter(needs_loader_itself);
    let needs_loader = find_reached(&importers, seeds.map(|file| file.0).collect());
    let required_late = planned.iter().flat_map(|(_, file_sites)| {
        let sites = file_sites.sites.iter();
        let late_sites = sites.filter(|site| site.position == SitePosition::Late);
        late_sites.map(|site| site.target)
    });
    let other_loads = planned.iter().flat_map(|it| &it.1.other_loads);
    let other_loads = other_loads.map(|load| load.1);
    let required_candidates = planned.iter().flat_map(|it| &it.1.required_candidates);
    let required_candidates = required_candidates.map(|load| load.1);
    let entry_points = input.sources.entry_points().iter();
    let loaded_by_name = entry_points
        .filter(|entry| !matches!(entry.kind, EntryPointKind::Main | EntryPointKind::Library));
    let texts_that_spell_files = find_texts_that_spell_files(input, modules);
    let spelled = texts_that_spell_files.iter().flatten();
    let loaded_by_name = loaded_by_name.map(|entry| entry.file);
    let loaded_by_name = loaded_by_name.chain(spelled.map(|text| text.spelled));
    let is_every_file_found = is_every_file_found_by_name(input, modules);
    let found = modules
        .compiled_files
        .iter()
        .filter(|_| is_every_file_found);
    let found = found.filter(|file| is_code_of_program[file.idx()]);
    let loaded_by_name = loaded_by_name.chain(found.copied());
    let is_es_module = |&file: &FileId| {
        is_code_of_program[file.idx()] && scans.of(file).interop.kind == ModuleKind::SourceText
    };
    let es_modules_found_by_name: Vec<FileId> =
        loaded_by_name.clone().filter(is_es_module).collect();
    let loaded_by_name = loaded_by_name.map(ModuleRef::File);
    let late_targets = other_loads.chain(loaded_by_name.clone());
    let number_of = |target: ModuleRef| Some(numbers.number_of(target)? as u32);
    let required_at_any_time = required_late.clone().chain(required_candidates);
    let required_at_any_time = required_at_any_time.chain(loaded_by_name);
    let runner_starts_each_once = input.runner_starts_entry_points && !input.entry_points_run_again;
    let written_and_found = files.entry_points().iter();
    let found = written_and_found.skip(input.written_entry_point_count);
    let mut found_by_load: Vec<u32> = found.map(|file| file.0).collect();
    found_by_load.sort_unstable();
    let is_started = |kind: EntryPointKind, file: FileId| match kind {
        EntryPointKind::Main => true,
        EntryPointKind::Additional => {
            runner_starts_each_once && found_by_load.binary_search(&file.0).is_err()
        }
        EntryPointKind::LoadedByTestRunner
        | EntryPointKind::HostLoadedModule
        | EntryPointKind::ImportedModule
        | EntryPointKind::Library => false,
    };
    let is_spelled = |file: FileId| {
        let mut texts = texts_that_spell_files.iter().flatten();
        texts.any(|text| text.spelled == file)
    };
    let started = input.sources.entry_points().iter();
    let started = started.filter(|entry| is_started(entry.kind, entry.file));
    let started_behind_first = started.clone().filter(|entry| {
        entry.kind == EntryPointKind::Additional && !is_every_file_found && !is_spelled(entry.file)
    });
    let mut started_behind_first: Vec<u32> = started_behind_first.map(|it| it.file.0).collect();
    started_behind_first.sort_unstable();
    let started: Vec<u32> = started.map(|entry| entry.file.0).collect();
    let candidates = planned.iter().flat_map(|it| &it.1.required_candidates);
    let mut candidates: Vec<(u32, u32)> = candidates
        .filter_map(|&(referrer, target)| Some((number_of(referrer)?, number_of(target)?)))
        .collect();
    candidates.sort_unstable();
    let started_by_runner =
        FilesStartedByTestRunner::find(&edges, &candidates, &started, started_behind_first);
    let is_required_at_any_time = started_by_runner
        .find_reached(&edges, required_at_any_time.filter_map(number_of).collect());
    let linked_late: Vec<u32> = late_targets.filter_map(number_of).collect();
    let late_targets = linked_late.iter().copied();
    let late_targets = late_targets.chain(required_late.filter_map(number_of));
    let is_exposed = started_by_runner.find_reached(&edges, late_targets.collect());
    let (is_on_cycle, component_of) = find_modules_on_cycles(&edges);
    let is_half = is_on_cycle.iter().zip(&is_exposed);
    let mut is_half: Vec<bool> = is_half
        .map(|(&on_cycle, &exposed)| on_cycle || exposed)
        .collect();
    let waits = needs_loader.contains(&true);
    let mut is_half_at_link: Vec<bool> = importers
        .iter()
        .zip(&is_half)
        .map(|(importers, &half)| {
            half && (waits || importers.iter().any(|&importer| is_half[importer as usize]))
        })
        .collect();
    for target in linked_late {
        is_half_at_link[target as usize] = true;
    }
    let finds_main_by_name = modules.runs_code_out_of_sight
        || (texts_that_spell_files.is_some() && program_loads_by_name_that_no_pattern_holds(input));
    let main_entry_points = (input.sources.entry_points().iter())
        .filter(|entry| entry.kind == EntryPointKind::Main && finds_main_by_name);
    for entry in main_entry_points {
        is_half[entry.file.idx()] = true;
    }
    let prefix_roots = find_prefix_roots(input, scans, modules, &is_code_of_program, &planned);
    let texts_beside_every_file = match is_every_file_found {
        true => take_or_list_texts_that_spell_files(input, modules),
        false => None,
    };
    let texts = texts_that_spell_files.as_deref();
    let texts = texts.or(texts_beside_every_file.as_deref());
    let require_in_their_bodies = planned.iter();
    let require_in_their_bodies = require_in_their_bodies
        .filter(|of_file| of_file.1.requires_by_unknown_name_in_body)
        .map(|of_file| of_file.0);
    let found_by_made_names = list_what_made_names_may_find(
        texts.unwrap_or_default(),
        require_in_their_bodies,
        &es_modules_found_by_name,
    );
    let mut loads = find_loads_seen_by_program(
        scans,
        modules,
        &numbers,
        &edges,
        &is_code_of_program,
        &planned,
        &found_by_made_names,
    );
    let ask_for_several_types = find_importers_that_ask_for_several_types(modules);
    if !ask_for_several_types.is_empty() {
        let comes_to_them = find_reached(&importers, ask_for_several_types);
        let is_loaded_by_loader = loads.is_loaded_by_loader.iter_mut();
        for (is_loaded, (comes, is_code)) in
            is_loaded_by_loader.zip(comes_to_them.iter().zip(&is_code_of_program))
        {
            *is_loaded |= *comes && *is_code;
        }
    }
    let mut makes_values_at_load = vec![false; file_count];
    let mut is_imported_as_es_module = vec![false; file_count];
    for &file in &modules.compiled_files {
        makes_values_at_load[file.idx()] = scans.of(file).interop.kind == ModuleKind::Data
            && crate::module_keys::makes_values_at_load(input.sources.loader(file));
        is_imported_as_es_module[file.idx()] = files.is_imported_as_es_module(file);
    }
    let required = planned.iter().flat_map(|(_, file_sites)| {
        let named = file_sites.sites.iter().map(|site| site.target);
        named.chain(file_sites.required_candidates.iter().map(|load| load.1))
    });
    let mut is_found_by_load = vec![false; file_count];
    let written_and_found = files.entry_points().iter();
    for &file in written_and_found.skip(input.written_entry_point_count) {
        is_found_by_load[file.idx()] = true;
    }
    let found_by_name = (input.sources.entry_points().iter())
        .filter(|entry| !matches!(entry.kind, EntryPointKind::Main | EntryPointKind::Library))
        .filter(|entry| !input.runner_starts_entry_points || is_found_by_load[entry.file.idx()])
        .map(|entry| ModuleRef::File(entry.file));
    let mut is_required = vec![false; file_count];
    for target in required.chain(found_by_name) {
        if let ModuleRef::File(target) = target {
            is_required[target.idx()] = true;
        }
    }
    let required_prefix_roots: Vec<FileId> = (prefix_roots.iter().copied())
        .filter(|root| is_required[root.idx()])
        .collect();
    let parts = OrderParts {
        numbers,
        is_code_of_program,
        is_half,
        component_of,
        is_required_at_any_time,
        is_loaded_by_loader: loads.is_loaded_by_loader,
        is_required_during_load: loads.is_required_during_load,
        is_importable_during_evaluation: loads.is_importable_during_evaluation,
        makes_values_at_load,
        is_imported_as_es_module,
        prefix_roots,
        required_prefix_roots,
        texts_that_spell_files,
    };
    let order = EvaluationOrder {
        parts,
        is_on_cycle,
        is_half_at_link,
        needs_loader,
    };
    let mut sites = PlannedSites {
        by_file: vec![Vec::new(); file_count],
        candidates_by_file: vec![Vec::new(); file_count],
    };
    for (file, mut file_sites) in planned {
        for site in &mut file_sites.sites {
            site.evaluates = order.can_evaluate(modules, site.referrer, site.target);
        }
        sites.by_file[file.idx()] = file_sites.sites;
        let mut candidates = file_sites.required_candidates;
        candidates.retain(|&(referrer, target)| order.can_evaluate(modules, referrer, target));
        sites.candidates_by_file[file.idx()] = candidates;
    }
    (order, sites)
}
