use crate::ir::{InParallel, for_each_mut};
use crate::known_helpers::{Helper, KnownHelpers, Quiet, Shape};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, CodeUnit, Decl, FunctionFlags, Parent, PatParent, SymbolId,
};
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    self, CallId, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, MemberKey, PatId, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp, VarDeclId,
};
use bun_sema::module_format::evaluates_own_this;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InnerModuleKind {
    /// `var require_x = __commonJS((exports, module) => { .. })`
    CommonJs,
    /// `var init_x = __esm(() => { .. })`: its variables are bindings of the file.
    Esm,
}

/// A module that a bundler wrapped in a function. The function is its body, and a call of the holder evaluates it.
#[derive(Copy, Clone, Debug)]
pub struct InnerModule {
    pub callback: FnId,
    pub kind: InnerModuleKind,
    /// `require_x`, `init_x`. Every mention of it is a call without arguments.
    pub holder: SymbolId,
    pub declaration: VarDeclId,
    /// It declares holders only and has no code.
    pub statement: StmtId,
    /// A call behind a failure throws the same error again. Otherwise it answers as if the body had ended.
    pub keeps_error: bool,
    pub exports_parameter: Option<SymbolId>,
    /// It occurs only as `module.exports`.
    pub module_parameter: Option<SymbolId>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    Holder,
    ExportsParameter,
    ModuleParameter,
}

#[derive(Default)]
struct FileModules {
    /// In the order of the text.
    modules: Box<[InnerModule]>,
    by_callback: Box<[(FnId, u32)]>,
    by_symbol: Box<[(SymbolId, Role, u32)]>,
}

#[derive(Default)]
pub struct WrappedModules {
    files: Vec<FileModules>,
}

struct WrapperShape {
    kind: InnerModuleKind,
    keeps_error: bool,
    /// The function is the first member of a literal: `__commonJS({ "src/x.js"(exports, module) { .. } })`.
    takes_literal: bool,
}

fn classify(shape: Shape) -> Option<WrapperShape> {
    let (kind, keeps_error, takes_literal) = match shape {
        Shape::CommonJsRunsCallbackOnce | Shape::CommonJsRunsCallbackOnceThenDropsIt => {
            (InnerModuleKind::CommonJs, false, false)
        }
        Shape::CommonJsRunsFirstKeyOnce
        | Shape::CommonJsRunsFirstOwnNameOnce
        | Shape::CommonJsRunsFirstOwnNameOnceThenDropsIt => {
            (InnerModuleKind::CommonJs, false, true)
        }
        Shape::EsmRunsFunctionOnce => (InnerModuleKind::Esm, false, false),
        Shape::EsmRunsFunctionOnceRethrows => (InnerModuleKind::Esm, true, false),
        Shape::EsmRunsFirstKeyOnce | Shape::EsmRunsFirstOwnNameOnce => {
            (InnerModuleKind::Esm, false, true)
        }
        Shape::EsmRunsFirstOwnNameOnceRethrows => (InnerModuleKind::Esm, true, true),
        // A body that threw runs again at the next call.
        Shape::CommonJsRunsFirstOwnNameAgainAfterThrow => return None,
        _ => return None,
    };
    Some(WrapperShape {
        kind,
        keeps_error,
        takes_literal,
    })
}

/// Where the code that holds a call of a holder starts to run at the earliest.
#[derive(Copy, Clone)]
enum SiteTime {
    /// A position in the text of the file: the code of the file itself runs in that order.
    At(u32),
    /// When the body of that candidate starts.
    WithBodyOf(usize),
}

struct Candidate {
    module: InnerModule,
    /// Where the call of the helper ends: the holder is set from there on.
    defined_at: u32,
    sites: Vec<SiteTime>,
    is_refused: bool,
}

struct Finder<'a, 's> {
    files: &'a Files<'s>,
    helpers: &'a KnownHelpers,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    /// What `export { .. }` names.
    exported_symbols: FxHashSet<SymbolId>,
    candidates: Vec<Candidate>,
    by_callback: Vec<(FnId, u32)>,
    by_symbol: Vec<(SymbolId, Role, u32)>,
}

fn find_by_key<K: Ord + Copy, T: Copy>(
    entries: &[T],
    key: K,
    key_of: impl Fn(&T) -> K,
) -> Option<T> {
    let at = entries.binary_search_by_key(&key, key_of).ok()?;
    Some(entries[at])
}

// The declaration or the parameter that the pattern is a part of: its defaults and computed keys are evaluated there.
fn parent_of_pattern(bound: &Bound<'_>, mut pattern: PatId) -> Parent {
    loop {
        match bound.pat_parent[pattern.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
            PatParent::Var(declaration) => return Parent::VarInit(declaration),
            PatParent::Param(parameter) => return Parent::ParamDefault(parameter),
            PatParent::None => return Parent::None,
        }
    }
}

/// The functions around an expression, from the innermost out. `None`: the expression stands where this cannot tell.
fn find_functions_around(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> Option<SmallVec<[FnId; 4]>> {
    let mut parent = bound.parent_of_expr(expression);
    let innermost = loop {
        parent = match parent {
            Parent::Expr(outer) => bound.parent_of_expr(outer),
            Parent::Prop(property) | Parent::PropKey(property) | Parent::MethodKey(property) => {
                Parent::Expr(bound.prop_owner[property.idx()])
            }
            Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
            Parent::PatPropDefault(property) | Parent::PatKey(property) => {
                parent_of_pattern(bound, hir[property].value)
            }
            Parent::PatElemDefault(element) => parent_of_pattern(bound, hir[element].pat),
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::ClassExtends(class) | Parent::ClassDecorator(class) => {
                bound.class_owner[class.idx()].to_parent()
            }
            Parent::MemberKey(member)
            | Parent::MemberInit(member)
            | Parent::MemberDecorator(member) => {
                bound.class_owner[bound.member_class(member)?.idx()].to_parent()
            }
            Parent::Stmt(statement) => {
                let scope = bound.scope_of_stmt(statement.some()?).some()?;
                match bound.code_unit(scope) {
                    CodeUnit::File => break None,
                    CodeUnit::Function(function) => break Some(function),
                    CodeUnit::FieldInitializer(member) => {
                        bound.class_owner[bound.member_class(member)?.idx()].to_parent()
                    }
                }
            }
            Parent::File => break None,
            Parent::FnBody(function) => break Some(function),
            Parent::ParamDefault(parameter) => break Some(bound.param_fn[parameter.idx()]),
            Parent::None | Parent::EnumInit(_) | Parent::ParamDecorator(_) | Parent::Module(_) => {
                return None;
            }
        };
    };
    let mut functions = SmallVec::new();
    let mut next = innermost;
    while let Some(function) = next {
        functions.push(function);
        next = bound.fns[function.idx()].enclosing.some();
    }
    debug_assert!(functions.len() <= hir.fns.len());
    Some(functions)
}

fn outermost_type_assertion(hir: &hir::File<'_>, bound: &Bound<'_>, operand: ExprId) -> ExprId {
    let mut outermost = operand;
    while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
        && hir.type_assertion_operand(parent) == Some(outermost)
    {
        outermost = parent;
    }
    outermost
}

/// The call without arguments that a name is the callee of.
fn find_plain_call_of(hir: &hir::File<'_>, bound: &Bound<'_>, name: ExprId) -> Option<ExprId> {
    let callee = outermost_type_assertion(hir, bound, name);
    let Parent::Expr(call) = bound.parent_of_expr(callee) else {
        return None;
    };
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let site = hir[site];
    (site.callee == callee && site.chain == Chain::No && site.args.is_empty()).then_some(call)
}

impl Finder<'_, '_> {
    fn find_plain_parameter(&self, function: FnId, index: usize) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let parameter = hir[hir[function].params.iter().nth(index)?];
        let is_plain = matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && parameter.default.is_none()
            && !parameter.flags.contains(Flags::REST);
        let symbol = bound.declared_symbol(Decl::Param(parameter.pat)).some()?;
        (is_plain && bound.is_stable_binding(symbol)).then_some(symbol)
    }

    fn find_callback(&self, argument: ExprId, takes_literal: bool) -> Option<FnId> {
        let hir = self.hir;
        let argument = hir.skip_type_assertions(argument);
        let written = match (hir[argument].kind, takes_literal) {
            (ExprKind::Fn(_), false) => argument,
            (ExprKind::Object(properties), true) if properties.len() == 1 => {
                let property = hir[properties.at(0)];
                let is_plain = matches!(property.kind, PropKind::Init | PropKind::Method)
                    && matches!(property.key, PropKey::Name(_));
                if !is_plain {
                    return None;
                }
                hir.skip_type_assertions(property.value)
            }
            _ => return None,
        };
        match hir[written].kind {
            ExprKind::Fn(callback) => Some(callback),
            _ => None,
        }
    }

    // The function becomes the body of a module, which has no parameters, no `this`, no `arguments` and no name, and whose value nobody sees.
    fn can_be_body(&self, callback: FnId, kind: InnerModuleKind) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let record = hir[callback];
        let has_own_name = record.kind == FnKind::Expr && record.name != Atom::NONE;
        let flags = bound.function_flags(callback);
        let sees_its_call =
            flags.intersects(FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL);
        let is_plain = matches!(record.kind, FnKind::Expr | FnKind::Arrow | FnKind::Method)
            && !record.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && record.this_param.is_none()
            && matches!(record.body, FnBody::Block(_));
        let reads_this =
            bound.fns[callback.idx()].contains_this || evaluates_own_this(hir, callback);
        if !is_plain || has_own_name || sees_its_call || reads_this {
            return false;
        }
        if record.kind == FnKind::Arrow && bound.file_uses_arguments() {
            return false;
        }
        match kind {
            InnerModuleKind::CommonJs => true,
            // A call of the holder answers what the function returned.
            InnerModuleKind::Esm => {
                let mut returns = bound.ids(bound.fns[callback.idx()].returns);
                returns.all(|statement: StmtId| match hir[statement].kind {
                    StmtKind::Return(value) => value.is_none(),
                    _ => false,
                })
            }
        }
    }

    fn collect_exported_symbols(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for statement in hir.ids(hir.body) {
            let StmtKind::ExportNamed(export) = hir[statement].kind else {
                continue;
            };
            if hir[export].has_module_specifier {
                continue;
            }
            for item in hir[export].items.iter() {
                if let Binding::Symbol(symbol) = bound.exported_binding(item) {
                    self.exported_symbols.insert(symbol);
                }
            }
        }
    }

    fn read_declaration(&self, statement: StmtId, declaration: VarDeclId) -> Option<Candidate> {
        let (hir, bound) = (self.hir, self.bound);
        let record = hir[declaration];
        if !matches!(hir[record.pat].kind, PatKind::Ident(_))
            || record.flags.contains(Flags::EXPORT)
        {
            return None;
        }
        let call = hir.skip_type_assertions(record.init.some()?);
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        if site.chain != Chain::No || site.args.len() != 1 {
            return None;
        }
        let known = self
            .helpers
            .certain_callee(self.files, self.file, site.callee)?;
        let shape = classify(known.shape)?;
        let callback = self.find_callback(hir.id_at(site.args, 0), shape.takes_literal)?;
        if !self.can_be_body(callback, shape.kind) {
            return None;
        }
        let parameter_count = hir[callback].params.len();
        let (exports_parameter, module_parameter) = match (shape.kind, parameter_count) {
            (_, 0) => (None, None),
            (InnerModuleKind::CommonJs, 1) => (Some(self.find_plain_parameter(callback, 0)?), None),
            (InnerModuleKind::CommonJs, 2) => (
                Some(self.find_plain_parameter(callback, 0)?),
                Some(self.find_plain_parameter(callback, 1)?),
            ),
            (InnerModuleKind::CommonJs | InnerModuleKind::Esm, _) => return None,
        };
        let holder = bound.declared_symbol(Decl::Var(record.pat)).some()?;
        let is_only_seen_here = bound.is_stable_binding(holder)
            && !bound.is_visible_to_eval(holder)
            && !self.exported_symbols.contains(&holder);
        if !is_only_seen_here {
            return None;
        }
        Some(Candidate {
            module: InnerModule {
                callback,
                kind: shape.kind,
                holder,
                declaration,
                statement,
                keeps_error: shape.keeps_error,
                exports_parameter,
                module_parameter,
            },
            defined_at: hir[call].end,
            sites: Vec::new(),
            is_refused: false,
        })
    }

    fn collect_candidates(&mut self) {
        let hir = self.hir;
        for statement in hir.ids(hir.body) {
            let StmtKind::Var(declarations) = hir[statement].kind else {
                continue;
            };
            if self.decisions.is_dead_stmt(statement) {
                continue;
            }
            for declaration in declarations.iter() {
                if let Some(candidate) = self.read_declaration(statement, declaration) {
                    self.candidates.push(candidate);
                }
            }
        }
        for (candidate, index) in self.candidates.iter().zip(0..) {
            let module = candidate.module;
            self.by_callback.push((module.callback, index));
            self.by_symbol.push((module.holder, Role::Holder, index));
            if let Some(parameter) = module.exports_parameter {
                self.by_symbol
                    .push((parameter, Role::ExportsParameter, index));
            }
            if let Some(parameter) = module.module_parameter {
                self.by_symbol
                    .push((parameter, Role::ModuleParameter, index));
            }
        }
        self.by_callback
            .shared_sort_unstable_by_key(|entry| entry.0);
        self.by_symbol.shared_sort_unstable_by_key(|entry| entry.0);
    }

    fn candidate_of_callback(&self, function: FnId) -> Option<usize> {
        find_by_key(&self.by_callback, function, |entry| entry.0).map(|entry| entry.1 as usize)
    }

    // `var x_exports = {}`
    fn holds_new_empty_object(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let expression = hir.skip_type_assertions(expression);
        let Binding::Symbol(symbol) = bound.binding(expression) else {
            return false;
        };
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return false;
        };
        let is_empty_literal = match hir[hir.skip_type_assertions(value)].kind {
            ExprKind::Object(properties) => properties.is_empty(),
            _ => false,
        };
        matches!(hir[expression].kind, ExprKind::Ident(_))
            && is_empty_literal
            && bound.is_stable_binding(symbol)
    }

    // A helper that only makes a function, or only defines getters on an object that nobody else has.
    fn runs_nothing(&self, call: CallId) -> bool {
        let hir = self.hir;
        let site = hir[call];
        let Some(known) = self
            .helpers
            .certain_callee(self.files, self.file, site.callee)
        else {
            return false;
        };
        match known.shape.helper() {
            Helper::CommonJs | Helper::Esm => true,
            Helper::Export => {
                let target = hir.ids(site.args).next();
                target.is_some_and(|target| self.holds_new_empty_object(target))
            }
            _ => false,
        }
    }

    fn find_end_of_head(&self) -> u32 {
        let helpers = self.helpers.file(self.file);
        let quiet = Quiet {
            atoms: &self.files.atoms,
            hir: self.hir,
            bound: self.bound,
            decisions: self.decisions,
            allows_reads_of_open_globals: helpers
                .is_some_and(|helpers| helpers.head_allows_reads_of_open_globals()),
            runs_nothing: &|call| self.runs_nothing(call),
        };
        quiet.find_end_of_head()
    }

    fn find_site_time(&self, call: ExprId, end_of_head: u32) -> Option<SiteTime> {
        let hir = self.hir;
        let functions = find_functions_around(hir, self.bound, call)?;
        let Some(&outermost) = functions.last() else {
            return Some(SiteTime::At(hir[call].pos));
        };
        if let Some(around) = self.candidate_of_callback(outermost) {
            return Some(SiteTime::WithBodyOf(around));
        }
        // Nothing calls a function while the head runs.
        Some(SiteTime::At(match hir[outermost].kind {
            FnKind::Decl => end_of_head,
            _ => end_of_head.max(hir[outermost].start),
        }))
    }

    fn is_exports_of(&self, module: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let object = outermost_type_assertion(hir, bound, module);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return false;
        };
        let names_exports = matches!(
            hir.member_key(member),
            Some((accessed, MemberKey::Name(name))) if accessed == object && name == known::exports
        );
        let is_plain = matches!(
            hir[member].kind,
            ExprKind::Dot {
                chain: Chain::No,
                ..
            } | ExprKind::Index {
                chain: Chain::No,
                ..
            }
        );
        let outermost = outermost_type_assertion(hir, bound, member);
        let is_deleted = match bound.parent_of_expr(outermost) {
            Parent::Expr(user) => matches!(
                hir[user].kind,
                ExprKind::Unary {
                    op: UnOp::Delete,
                    ..
                }
            ),
            _ => false,
        };
        names_exports && is_plain && !is_deleted
    }

    // `new.target` and `super` mean those of the nearest function that is no arrow function.
    fn refuse_owner_of(&mut self, expression: ExprId) {
        let Some(functions) = find_functions_around(self.hir, self.bound, expression) else {
            // Every candidate stands at the top of the file, so its function is the outermost one around what it holds.
            for candidate in &mut self.candidates {
                candidate.is_refused = true;
            }
            return;
        };
        for function in functions {
            if let Some(owner) = self.candidate_of_callback(function) {
                self.candidates[owner].is_refused = true;
                return;
            }
            if self.hir[function].kind != FnKind::Arrow {
                return;
            }
        }
    }

    fn read_mentions(&mut self, end_of_head: u32) {
        let (hir, bound) = (self.hir, self.bound);
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[expression].kind {
                ExprKind::Ident(_) => {}
                ExprKind::NewTarget(_) | ExprKind::Super => {
                    if !self.decisions.is_dead_expr(expression) {
                        self.refuse_owner_of(expression);
                    }
                    continue;
                }
                _ => continue,
            }
            if !bound.is_evaluated_ident(expression) || self.decisions.is_dead_expr(expression) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(expression) else {
                continue;
            };
            let Some((_, role, index)) = find_by_key(&self.by_symbol, symbol, |entry| entry.0)
            else {
                continue;
            };
            let index = index as usize;
            match role {
                Role::Holder => {
                    let call = find_plain_call_of(hir, bound, expression);
                    let time = call.and_then(|call| self.find_site_time(call, end_of_head));
                    match time {
                        Some(time) => self.candidates[index].sites.push(time),
                        None => self.candidates[index].is_refused = true,
                    }
                }
                Role::ExportsParameter => {}
                Role::ModuleParameter => {
                    let is_exports = self.is_exports_of(expression);
                    self.candidates[index].is_refused |= !is_exports;
                }
            }
        }
    }

    fn find_starts(&self) -> Vec<u32> {
        // The body of a candidate starts at the first call of its holder. Bodies that only call each other never start.
        let mut starts = vec![u32::MAX; self.candidates.len()];
        loop {
            let mut has_changed = false;
            for (index, candidate) in self.candidates.iter().enumerate() {
                let times = candidate
                    .sites
                    .iter()
                    .map(|&site| self.time_of(site, &starts));
                let start = times.min().unwrap_or(u32::MAX);
                has_changed |= start < starts[index];
                starts[index] = starts[index].min(start);
            }
            if !has_changed {
                return starts;
            }
        }
    }

    fn time_of(&self, site: SiteTime, starts: &[u32]) -> u32 {
        match site {
            SiteTime::At(position) => position,
            SiteTime::WithBodyOf(around) => match self.candidates[around].is_refused {
                // Whoever holds the function that the helper made can call it from there on.
                true => self.candidates[around].defined_at,
                false => starts[around],
            },
        }
    }

    fn count_holders_by_statement(&self) -> FxHashMap<StmtId, usize> {
        let mut counts = FxHashMap::default();
        for candidate in self
            .candidates
            .iter()
            .filter(|candidate| !candidate.is_refused)
        {
            *counts.entry(candidate.module.statement).or_insert(0) += 1;
        }
        counts
    }

    fn count_declarations(&self, statement: StmtId) -> usize {
        match self.hir[statement].kind {
            StmtKind::Var(declarations) => declarations.len(),
            _ => 0,
        }
    }

    // A call ahead of the definition finds the holder empty and throws.
    fn refuse_until_all_fit(&mut self) {
        loop {
            let starts = self.find_starts();
            let holders = self.count_holders_by_statement();
            let misfits: Vec<usize> = (0..self.candidates.len())
                .filter(|&index| {
                    let candidate = &self.candidates[index];
                    let statement = candidate.module.statement;
                    !candidate.is_refused
                        && (starts[index] < candidate.defined_at
                            || holders.get(&statement) != Some(&self.count_declarations(statement)))
                })
                .collect();
            if misfits.is_empty() {
                return;
            }
            for index in misfits {
                self.candidates[index].is_refused = true;
            }
        }
    }

    fn finish(self) -> FileModules {
        let accepted = self
            .candidates
            .iter()
            .filter(|candidate| !candidate.is_refused);
        let modules: Box<[InnerModule]> = accepted.map(|candidate| candidate.module).collect();
        let mut by_callback = Vec::with_capacity(modules.len());
        let mut by_symbol = Vec::with_capacity(modules.len());
        for (module, index) in modules.iter().zip(0..) {
            by_callback.push((module.callback, index));
            by_symbol.push((module.holder, Role::Holder, index));
            if let Some(parameter) = module.exports_parameter {
                by_symbol.push((parameter, Role::ExportsParameter, index));
            }
            if let Some(parameter) = module.module_parameter {
                by_symbol.push((parameter, Role::ModuleParameter, index));
            }
        }
        by_callback.sort_unstable_by_key(|entry: &(FnId, u32)| entry.0);
        by_symbol.sort_unstable_by_key(|entry: &(SymbolId, Role, u32)| entry.0);
        FileModules {
            modules,
            by_callback: by_callback.into_boxed_slice(),
            by_symbol: by_symbol.into_boxed_slice(),
        }
    }
}

fn find_in_file(files: &Files<'_>, helpers: &KnownHelpers, file: FileId) -> FileModules {
    let Some(compiled) = files.compiled(file).filter(|_| helpers.has_functions(file)) else {
        return FileModules::default();
    };
    let mut finder = Finder {
        files,
        helpers,
        file,
        hir: files.hir(file),
        bound: files.bound(file),
        decisions: &compiled.analysis.decisions,
        exported_symbols: FxHashSet::default(),
        candidates: Vec::new(),
        by_callback: Vec::new(),
        by_symbol: Vec::new(),
    };
    finder.collect_exported_symbols();
    finder.collect_candidates();
    if finder.candidates.is_empty() {
        return FileModules::default();
    }
    let end_of_head = finder.find_end_of_head();
    finder.read_mentions(end_of_head);
    finder.refuse_until_all_fit();
    finder.finish()
}

impl WrappedModules {
    pub fn compute(
        files: &Files<'_>,
        helpers: &KnownHelpers,
        in_parallel: InParallel<'_>,
    ) -> WrappedModules {
        let mut wrapped = WrappedModules::default();
        if !helpers.has_bindings() {
            return wrapped;
        }
        let mut found: Vec<(FileId, FileModules)> = files
            .compiled_files()
            .iter()
            .map(|&file| (file, FileModules::default()))
            .collect();
        for_each_mut(&mut found, in_parallel, &|(file, modules)| {
            *modules = find_in_file(files, helpers, *file);
        });
        wrapped
            .files
            .resize_with(files.modules.len(), FileModules::default);
        for (file, modules) in found {
            wrapped.files[file.idx()] = modules;
        }
        wrapped
    }

    /// The inner modules of a file, in the order of the text.
    pub fn of_file(&self, file: FileId) -> &[InnerModule] {
        match self.files.get(file.idx()) {
            Some(found) => &found.modules,
            None => &[],
        }
    }

    pub fn of_callback(&self, file: FileId, callback: FnId) -> Option<&InnerModule> {
        let found = self.files.get(file.idx())?;
        let (_, index) = find_by_key(&found.by_callback, callback, |entry| entry.0)?;
        Some(&found.modules[index as usize])
    }

    fn of_symbol(&self, file: FileId, symbol: SymbolId, role: Role) -> Option<&InnerModule> {
        let found = self.files.get(file.idx())?;
        let (_, found_role, index) = find_by_key(&found.by_symbol, symbol, |entry| entry.0)?;
        (found_role == role).then(|| &found.modules[index as usize])
    }

    fn of_name(
        &self,
        files: &Files<'_>,
        file: FileId,
        name: ExprId,
        role: Role,
    ) -> Option<&InnerModule> {
        let (hir, bound) = (files.hir(file), files.bound(file));
        let name = hir.skip_type_assertions(name);
        match (hir[name].kind, bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => self.of_symbol(file, symbol, role),
            _ => None,
        }
    }

    /// `require_x()`, `init_x()`: the module that the call evaluates.
    pub fn of_call(&self, files: &Files<'_>, file: FileId, call: ExprId) -> Option<&InnerModule> {
        if self.of_file(file).is_empty() {
            return None;
        }
        let hir = files.hir(file);
        let ExprKind::Call(site) = hir[hir.skip_type_assertions(call)].kind else {
            return None;
        };
        self.of_name(files, file, hir[site].callee, Role::Holder)
    }

    /// The inner module whose body holds the expression, be it in a function of that body.
    pub fn enclosing(
        &self,
        files: &Files<'_>,
        file: FileId,
        expression: ExprId,
    ) -> Option<&InnerModule> {
        if self.of_file(file).is_empty() {
            return None;
        }
        let functions = find_functions_around(files.hir(file), files.bound(file), expression)?;
        self.of_callback(file, *functions.last()?)
    }

    /// The inner module whose exports object the expression resolves to by binding: the first parameter of its function, or `.exports` of the second.
    pub fn is_exports_object(
        &self,
        files: &Files<'_>,
        file: FileId,
        expression: ExprId,
    ) -> Option<FnId> {
        if self.of_file(file).is_empty() {
            return None;
        }
        let hir = files.hir(file);
        let expression = hir.skip_type_assertions(expression);
        if let Some(module) = self.of_name(files, file, expression, Role::ExportsParameter) {
            return Some(module.callback);
        }
        let (object, MemberKey::Name(name)) = hir.member_key(expression)? else {
            return None;
        };
        let module = self.of_name(files, file, object, Role::ModuleParameter)?;
        (name == known::exports).then_some(module.callback)
    }

    /// `require_x = __commonJS(..)` has no code.
    pub fn is_erased_declaration(&self, file: FileId, declaration: VarDeclId) -> bool {
        let mut modules = self.of_file(file).iter();
        modules.any(|module| module.declaration == declaration)
    }

    /// Every variable that the statement declares is the holder of an inner module.
    pub fn is_erased_statement(&self, files: &Files<'_>, file: FileId, statement: StmtId) -> bool {
        if self.of_file(file).is_empty() {
            return false;
        }
        match files.hir(file)[statement].kind {
            StmtKind::Var(declarations) => {
                let mut declarations = declarations.iter();
                declarations.all(|declaration| self.is_erased_declaration(file, declaration))
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::run_serially;
    use crate::modules::testing::{file_named, with_graph};

    const BUN: &str = r#"var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);
var __esmRethrows = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn((fn = 0));
    } catch (e) {
      err = [e];
    }
  if (err) throw err[0];
  return res;
};
"#;

    /// The names of the holders of the inner modules of `main.mjs`, each with `!` if it keeps its error.
    fn holders_in(body: &str) -> Vec<String> {
        let main = format!("{BUN}{body}");
        holders_of(&[("main.mjs", main.as_str())], "main.mjs")
    }

    fn holders_of(files: &[(&str, &str)], name: &str) -> Vec<String> {
        with_graph(files, |_, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let wrapped = WrappedModules::compute(files, &helpers, &run_serially);
            let file = file_named(bind_input, name);
            let modules = wrapped.of_file(file).iter();
            modules
                .map(|module| {
                    let name = files.bound(file).symbol(module.holder).name;
                    let name = String::from_utf8_lossy(files.atoms.bytes(name)).into_owned();
                    match module.keeps_error {
                        true => name + "!",
                        false => name,
                    }
                })
                .collect()
        })
    }

    #[test]
    fn a_chain_of_wrapped_modules_is_found() {
        let body = r#"var require_a = __commonJS((exports) => { exports.a = 1; });
var require_b = __commonJS((exports, module) => { var a = require_a(); module.exports = a; });
var value;
var init_c = __esm(() => { value = require_b(); });
var init_d = __esmRethrows(() => { init_c(); });
init_d();
export default require_b();
"#;
        assert_eq!(
            holders_in(body),
            ["require_a", "require_b", "init_c", "init_d!"]
        );
    }

    // The helpers as esbuild and rolldown write them: the function is the one member of a literal.
    #[test]
    fn a_function_that_is_the_first_member_of_a_literal_is_found() {
        let body = r#"var require_a = __commonJS({ "src/a.js"(exports) { exports.a = 1; } });
var require_b = __commonJS({ "src/b.js"(exports, module) { module.exports = require_a(); } });
var value;
var init_c = __esm({ "src/c.js"() { value = require_b(); } });
init_c();
"#;
        let by_keys = r#"var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[Object.keys(fn)[0]])(fn = 0)), res;
};
"#;
        let by_own_names = r#"var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
"#;
        for helpers in [by_keys, by_own_names] {
            let main = format!("{helpers}{body}");
            let found = with_graph(&[("main.mjs", main.as_str())], |_, bind_input| {
                let files = bind_input.files;
                let helpers = KnownHelpers::compute(files, &run_serially);
                let wrapped = WrappedModules::compute(files, &helpers, &run_serially);
                wrapped.of_file(file_named(bind_input, "main.mjs")).len()
            });
            assert_eq!(found, 3, "{helpers}");
        }
    }

    #[test]
    fn a_holder_that_is_more_than_called_is_a_plain_variable() {
        let uses = [
            "console.log(require_a);",
            "require_a(1);",
            "require_a?.();",
            "new require_a();",
            "export { require_a };",
            "require_a = null;",
            "eval(\"\");",
        ];
        for other_use in uses {
            let body = format!(
                "var require_a = __commonJS((exports) => {{ exports.a = 1; }});\nrequire_a();\n{other_use}"
            );
            assert_eq!(holders_in(&body), [""; 0], "{other_use}");
        }
    }

    #[test]
    fn a_function_that_sees_how_it_is_called_is_a_plain_function() {
        let callbacks = [
            "function (exports) { exports.a = arguments.length; }",
            "function (exports) { exports.a = this; }",
            "function (exports) { exports.a = new.target; }",
            "function named(exports) { exports.a = 1; }",
            "(exports) => { exports = {}; }",
            "(exports, module) => { module.id; }",
            "(exports, module) => { delete module.exports; }",
            "(exports, module, more) => {}",
            "(exports = {}) => {}",
            "async (exports) => {}",
            "(exports) => exports",
        ];
        for callback in callbacks {
            let body = format!("var require_a = __commonJS({callback});\nrequire_a();");
            assert_eq!(holders_in(&body), [""; 0], "{callback}");
        }
        let own =
            "(exports) => { exports.f = function () { return [this, arguments, new.target]; }; }";
        let body = format!("var require_a = __commonJS({own});\nrequire_a();");
        assert_eq!(holders_in(&body), ["require_a"]);
        let returns = "var init_a = __esm(() => { return 1; });\ninit_a();";
        assert_eq!(holders_in(returns), [""; 0]);
    }

    #[test]
    fn a_call_that_may_come_ahead_of_the_definition_keeps_the_variable() {
        let ahead = "require_a();\nvar require_a = __commonJS((exports) => {});";
        assert_eq!(holders_in(ahead), [""; 0]);
        let through_a_declaration = r#"function lazy() { return require_a(); }
globalThis.hook(lazy);
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_a_declaration), [""; 0]);
        let declaration_in_the_head = r#"function lazy() { return require_a(); }
var require_a = __commonJS((exports) => {});
globalThis.hook(lazy);
"#;
        assert_eq!(holders_in(declaration_in_the_head), ["require_a"]);
        let through_another_body = r#"var require_b = __commonJS((exports) => { require_a(); });
require_b();
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_another_body), ["require_b"]);
        let behind_code = r#"var require_b = __commonJS((exports) => { require_a(); });
globalThis.effect();
var require_a = __commonJS((exports) => {});
require_b();
"#;
        assert_eq!(holders_in(behind_code), ["require_b", "require_a"]);
    }

    #[test]
    fn a_function_declaration_that_others_can_call_early_keeps_the_variables() {
        let bundle = format!(
            "import {{ one }} from \"./leaf.mjs\";\n{BUN}var require_a = __commonJS((exports) => {{ exports.a = one; }});\nexport function run() {{ return require_a().a; }}\n"
        );
        let holders = |main: &str, leaf: &str, other: &str| {
            let files = [
                ("main.mjs", main),
                ("bundle.mjs", bundle.as_str()),
                ("leaf.mjs", leaf),
                ("other.cjs", other),
            ];
            holders_of(&files, "bundle.mjs")
        };
        let main = "import \"./other.cjs\";\nimport { run } from \"./bundle.mjs\";\nrun();";
        let leaf = "export const one = 1;";
        assert_eq!(holders(main, leaf, ""), ["require_a"]);
        let on_a_cycle = "import { run } from \"./bundle.mjs\";\nexport const one = run;";
        assert_eq!(holders(main, on_a_cycle, ""), [""; 0]);
        let required = "globalThis.hook = () => require(\"./bundle.mjs\").run();";
        assert_eq!(holders(main, leaf, required), [""; 0]);
        let importer_on_a_cycle = "import \"./other.cjs\";\nimport \"./main.mjs\";\nimport { run } from \"./bundle.mjs\";\nexport function early() { return run(); }";
        assert_eq!(holders(importer_on_a_cycle, leaf, ""), [""; 0]);
        let imported_later =
            "import \"./other.cjs\";\nimport(\"./bundle.mjs\").then(bundle => bundle.run());";
        assert_eq!(holders(imported_later, leaf, ""), ["require_a"]);
    }

    #[test]
    fn a_call_in_a_default_or_a_case_is_a_call_like_any_other() {
        for call in [
            "const { a = require_a() } = {};",
            "const [a = require_a()] = [];",
            "switch (1) { case require_a(): }",
            "function late({ a = require_a() }) {} late({});",
            "class C { m(k) { switch (k) { case super.k: return new.target; } } }\nrequire_a();",
        ] {
            let body =
                format!("var require_a = __commonJS((exports) => {{ exports.a = 1; }});\n{call}");
            assert_eq!(holders_in(&body), ["require_a"], "{call}");
        }
    }

    #[test]
    fn a_statement_that_declares_something_else_too_keeps_its_code() {
        let two_holders =
            "var require_a = __commonJS((exports) => {}), require_b = __commonJS((exports) => {});";
        assert_eq!(holders_in(two_holders), ["require_a", "require_b"]);
        let another_variable = "var require_a = __commonJS((exports) => {}), other = 1;";
        assert_eq!(holders_in(another_variable), [""; 0]);
    }

    #[test]
    fn the_exports_of_an_inner_module_are_found_by_binding() {
        let main = format!(
            "{BUN}var require_a = __commonJS((e, m) => {{ e.a = 1; m.exports.b = 2; }});\nrequire_a();"
        );
        with_graph(&[("main.mjs", main.as_str())], |_, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let wrapped = WrappedModules::compute(files, &helpers, &run_serially);
            let file = file_named(bind_input, "main.mjs");
            let [module] = wrapped.of_file(file) else {
                panic!("the file has one inner module");
            };
            let hir = files.hir(file);
            let expressions = (0..hir.exprs.len() as u32).map(ExprId);
            let found = expressions
                .filter(|&it| wrapped.is_exports_object(files, file, it) == Some(module.callback));
            assert_eq!(found.count(), 2);
            assert!(wrapped.is_erased_statement(files, file, module.statement));
        });
    }
}
