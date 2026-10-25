//! When the bodies of the modules run, as far as the text of the program says it.

#[cfg(test)]
mod tests;

use super::exports::{ExportTables, Resolution};
use super::interop::{ImportPhase, ModuleKind, RequireResult};
use super::module_set::ModuleSet;
use super::requests::{FileScan, ScannedSite, Scans};
use super::wrapped::{InnerModule, WrappedModules};
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
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnId, ImportEqualsId, MemberKey, StmtId, StmtKind,
    VarKind,
};
use bun_sema::import_sites::{ImportSite, ImportSiteKind, OwnRequire, find_own_require};
use bun_sema::program::{FileId, Files};
use bun_sema::util::{FxHashMap, SharedSort};
use std::cell::{OnceCell, RefCell};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum SitePosition {
    /// Every run of the body passes it: it is in no function, branch, loop or `try`, behind no `return` and no `await`.
    InOrder,
    /// The body runs it where it is written, or not at all.
    Sometimes,
    /// It runs when a function does, or a handler outlives what it throws.
    Late,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum SiteKey {
    Call(ExprId),
    ImportEquals(ImportEqualsId),
}

/// `require(K)`, `module.require(K)`, `import.meta.require(K)`, `import a = require(K)`, a call of what `createRequire` made for the file itself, `require_x()` and `init_x()` of a bundle.
#[derive(Copy, Clone, Debug)]
pub(super) struct PlannedSite {
    pub key: SiteKey,
    pub referrer: ModuleRef,
    pub target: ModuleRef,
    pub position: SitePosition,
    /// The callee is the loader's function by binding, so that what comes out is the module. The lowering tests at most whether a `var` is filled yet: a call of one that is not throws.
    pub is_proven: bool,
    /// `false`: the run time's loader takes the site, as it always did.
    pub evaluates: bool,
    pub start: u32,
}

#[derive(Default)]
struct FileSites {
    sites: Vec<PlannedSite>,
    /// What `import(K)` and a computed specifier name, with the module that they are written in.
    other_loads: Vec<(ModuleRef, ModuleRef)>,
    /// Of those, what a computed specifier of `require` names.
    required_candidates: Vec<(ModuleRef, ModuleRef)>,
}

/// A number for each file and, behind the files, for each inner module.
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

    pub(super) fn modules(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        let files = (0..self.file_count as u32).map(|file| ModuleRef::File(FileId(file)));
        let inner_modules = self.inner_modules.iter();
        files.chain(inner_modules.map(|&(file, callback)| ModuleRef::Inner { file, callback }))
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

/// By file, in the order of the text.
pub(super) struct PlannedSites {
    by_file: Vec<Vec<PlannedSite>>,
    candidates_by_file: Vec<Vec<(ModuleRef, ModuleRef)>>,
}

impl PlannedSites {
    pub(super) fn of(&self, file: FileId) -> &[PlannedSite] {
        &self.by_file[file.idx()]
    }

    /// The modules that a computed specifier of `require` in the file can name and that the site evaluates itself, each with the module that the site is written in.
    pub(super) fn candidates_of(&self, file: FileId) -> &[(ModuleRef, ModuleRef)] {
        &self.candidates_by_file[file.idx()]
    }

    /// An ES module answers `require` with its namespace object unless it exports the name "module.exports", which the export tables know.
    pub(super) fn settle(&mut self, files: &Files<'_>, modules: &ModuleSet, tables: &ExportTables) {
        let name = files.atoms.lookup(b"module.exports");
        let lacks_name = |module: ModuleRef, name: Atom| {
            matches!(
                tables.resolve_in(modules, module, name).resolution,
                Resolution::NotFound | Resolution::Ambiguous
            )
        };
        for site in self.by_file.iter_mut().flatten() {
            let interop = modules.interop(site.target);
            site.evaluates &= match interop.kind {
                ModuleKind::SourceText => {
                    interop.require_result == RequireResult::Namespace
                        && !tables.has_dynamic_names(site.target)
                        && name.is_none_or(|name| lacks_name(site.target, name))
                }
                ModuleKind::CommonJs => true,
                _ => false,
            };
        }
    }
}

pub(super) struct EvaluationOrder {
    parts: OrderParts,
    is_on_cycle: Vec<bool>,
    needs_loader: Vec<bool>,
}

impl EvaluationOrder {
    fn has(&self, set: &[bool], module: ModuleRef) -> bool {
        let number = self.parts.numbers.number_of(module);
        number.is_some_and(|number| set[number])
    }

    /// A late site names the module, or a module that a late site may run asks for it.
    pub(super) fn exposed(&self, module: ModuleRef) -> bool {
        self.has(&self.parts.is_exposed, module)
    }

    /// Somebody may look at the module while its body runs.
    pub(super) fn half(&self, module: ModuleRef) -> bool {
        self.has(&self.parts.is_half, module)
    }

    /// An ES module that something other than an import starts: an entry point, or what `import()` or `require` names.
    pub(super) fn is_prefix_root(&self, file: FileId) -> bool {
        self.parts.prefix_roots.binary_search(&file).is_ok()
    }

    /// A file of the program that is code, or an inner module of one.
    pub(super) fn is_code_of_program(&self, module: ModuleRef) -> bool {
        self.has(&self.parts.is_code_of_program, module)
    }

    pub(super) fn into_parts(self) -> OrderParts {
        self.parts
    }

    fn can_evaluate(&self, modules: &ModuleSet, referrer: ModuleRef, target: ModuleRef) -> bool {
        // Whoever requires an ES module while its body runs gets an object without keys, which is no view of its variables.
        let is_seen_whole = match modules.interop(target).kind {
            ModuleKind::SourceText => !self.has(&self.is_on_cycle, target),
            _ => true,
        };
        self.is_code_of_program(referrer)
            && self.is_code_of_program(target)
            && !self.has(&self.needs_loader, target)
            && is_seen_whole
    }
}

pub(super) struct OrderParts {
    pub numbers: ModuleNumbers,
    pub is_code_of_program: Vec<bool>,
    pub is_exposed: Vec<bool>,
    pub is_half: Vec<bool>,
    pub prefix_roots: Vec<FileId>,
}

#[cfg(test)]
impl OrderParts {
    pub(super) fn without_sites(file_count: usize) -> OrderParts {
        OrderParts {
            numbers: ModuleNumbers::new(file_count, Vec::new()),
            is_code_of_program: vec![false; file_count],
            is_exposed: vec![false; file_count],
            is_half: vec![false; file_count],
            prefix_roots: Vec::new(),
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
    /// For the body of the file and of each inner module: where the first `return` or `using` stands.
    first_turns: OnceCell<Vec<(CodeUnit, u32)>>,
    may_replace_require: OnceCell<bool>,
    may_replace_module: OnceCell<bool>,
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
            may_replace_module: OnceCell::new(),
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
            // In a pattern `target = value` is a default, which is evaluated only where nothing comes for the target.
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

    // The body that runs the node, and how. `None`: a function runs it, a handler is around it, or the text does not say.
    fn find_body(&self, start: Node) -> Option<(CodeUnit, SitePosition)> {
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
                            StmtKind::Try { .. } => return None,
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
        let Some((unit, position)) = self.find_body(node) else {
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

    /// Whoever replaces a name that the loader gives the file decides what a call through it answers.
    pub(super) fn may_replace(&self, variable: CommonJsVariable) -> bool {
        let known = match variable {
            CommonJsVariable::Require => &self.may_replace_require,
            _ => &self.may_replace_module,
        };
        *known.get_or_init(|| {
            let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
            let binding = Binding::CommonJs(variable);
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
        matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(variable)
    }

    // The forms that the lowering turns into the operation without a test of the callee against the loader's function.
    fn is_proven_call(&self, site: ImportSiteKind, call: ExprId, kind: ModuleKind) -> bool {
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
            ImportSiteKind::ImportMetaRequire(_) => kind == ModuleKind::SourceText,
            ImportSiteKind::Require(_) if self.is_free(callee, CommonJsVariable::Require) => {
                !self.may_replace(CommonJsVariable::Require)
            }
            ImportSiteKind::Require(_) => match hir.member_key(callee) {
                Some((object, MemberKey::Name(_))) => {
                    // `require.call(..)` and `require.apply(..)` are tested.
                    self.is_free(hir.skip_type_assertions(object), CommonJsVariable::Module)
                        && !self.may_replace(CommonJsVariable::Module)
                }
                Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) => false,
                None => find_own_require(hir, bound, None, callee) == Some(OwnRequire::Made),
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
) -> FileSites {
    let mut planned = FileSites::default();
    let sites = files.analysis(file).import_sites;
    let loads_modules = |site: &ImportSite| {
        loading_call(site.kind).is_some() || matches!(site.kind, ImportSiteKind::ImportEquals(_))
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
            ScannedSite::Unresolved | ScannedSite::AllModules | ScannedSite::Erased => continue,
        };
        let (key, node, start, is_proven) = match site.kind {
            ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => (
                SiteKey::Call(call),
                Node::Expression(call),
                hir[call].pos,
                text.is_proven_call(site.kind, call, scan.interop.kind),
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
            _ => continue,
        };
        let (referrer, position) = text.locate(node, start);
        planned.sites.push(PlannedSite {
            key,
            referrer,
            target,
            // A test of the callee is a branch around the site.
            position: match is_proven {
                true => position,
                false => position.max(SitePosition::Sometimes),
            },
            is_proven,
            evaluates: true,
            start,
        });
    }
    if !text.inner_modules.is_empty() {
        add_calls_of_inner_modules(&text, &mut planned);
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

fn add_calls_of_inner_modules(text: &FileText<'_, '_>, planned: &mut FileSites) {
    let hir = text.hir;
    for call in (0..hir.exprs.len() as u32).map(ExprId) {
        if !matches!(hir[call].kind, ExprKind::Call(_)) || text.decisions.is_dead_expr(call) {
            continue;
        }
        let Some(inner) = text.wrapped.of_call(text.files, text.file, call) else {
            continue;
        };
        let (referrer, position) = text.locate(Node::Expression(call), hir[call].pos);
        planned.sites.push(PlannedSite {
            key: SiteKey::Call(call),
            referrer,
            target: ModuleRef::Inner {
                file: text.file,
                callback: inner.callback,
            },
            position,
            is_proven: true,
            evaluates: true,
            start: hir[call].pos,
        });
    }
}

// Every request, of whichever kind, and by target the modules that import it.
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

fn find_modules_on_cycles(edges: &[Vec<u32>]) -> Vec<bool> {
    let (component_of, components) = strongly_connected_components(edges);
    let is_on_cycle = |(module, targets): (usize, &Vec<u32>)| {
        components[component_of[module] as usize].len() > 1 || targets.contains(&(module as u32))
    };
    edges.iter().enumerate().map(is_on_cycle).collect()
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

fn find_prefix_roots(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    is_code_of_program: &[bool],
    planned: &[(FileId, FileSites)],
) -> Vec<FileId> {
    let entry_points = input.sources.entry_points().iter();
    let entry_points = entry_points.map(|entry| ModuleRef::File(entry.file));
    let loaded = planned.iter().flat_map(|(_, file_sites)| {
        let required = file_sites.sites.iter().map(|site| site.target);
        required.chain(file_sites.other_loads.iter().map(|load| load.1))
    });
    let application_roots = input.application.into_iter().flat_map(|application| {
        let roots = application.graph.prefix_roots().iter();
        roots.filter_map(|&root| Some(ModuleRef::File((application.to_local)(root)?)))
    });
    let mut roots: Vec<FileId> = entry_points
        .chain(loaded)
        .chain(application_roots)
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
        *file_sites = plan_file_sites(files, scans.of(*file), modules, *file);
    });
    let (edges, importers) = collect_edges(scans, modules, &numbers, &planned);
    let is_code_of_program = find_program_code(input, scans, modules, &numbers);
    // The run time's own algorithm waits for promises, asks the host for code that was not compiled, and finds out what a deferred import has to evaluate.
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
    let late_targets = planned.iter().flat_map(|(_, file_sites)| {
        let sites = file_sites.sites.iter();
        let late_sites = sites.filter(|site| site.position == SitePosition::Late);
        let other_loads = file_sites.other_loads.iter().map(|load| load.1);
        late_sites.map(|site| site.target).chain(other_loads)
    });
    // The host, or a name that the build does not know, loads an entry point at any time.
    let entry_points = input.sources.entry_points().iter();
    let loaded_by_name = entry_points
        .filter(|entry| !matches!(entry.kind, EntryPointKind::Main | EntryPointKind::Library));
    let late_targets = late_targets.chain(loaded_by_name.map(|entry| ModuleRef::File(entry.file)));
    let is_exposed_in_application = |module: &ModuleRef| {
        let application = input.application?;
        let module = application.application_module(*module)?;
        Some(application.graph.exposed(module))
    };
    let exposed_in_application = numbers.modules();
    let exposed_in_application =
        exposed_in_application.filter(|module| is_exposed_in_application(module) == Some(true));
    let late_targets = late_targets.chain(exposed_in_application);
    let late_targets = late_targets.filter_map(|target| Some(numbers.number_of(target)? as u32));
    let is_exposed = find_reached(&edges, late_targets.collect());
    let is_on_cycle = find_modules_on_cycles(&edges);
    let is_half = is_on_cycle.iter().zip(&is_exposed);
    let is_half = is_half
        .map(|(&on_cycle, &exposed)| on_cycle || exposed)
        .collect();
    let prefix_roots = find_prefix_roots(input, scans, &is_code_of_program, &planned);
    let parts = OrderParts {
        numbers,
        is_code_of_program,
        is_exposed,
        is_half,
        prefix_roots,
    };
    let order = EvaluationOrder {
        parts,
        is_on_cycle,
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
