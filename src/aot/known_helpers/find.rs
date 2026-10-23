use super::canonical::{CanonicalInput, OuterName, canonical_function};
use super::quiet::{Quiet, is_absent_from_object_prototype, is_locked};
use super::table::{Table, TableEntry, signature_of};
use super::{Reference, Shape};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, MemberLookup, Mutability};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, Decl, FnOwner, Parent,
    StoreKind, SymbolId,
};
use bun_sema::fold::{Decision, Decisions};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, MemberKey, NodeData, StmtId,
    StmtKind,
};
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{FileId, Files};
use bun_sema::util::FxHashMap;
use smallvec::SmallVec;
use std::cell::OnceCell;

const MAX_ALTERNATIVES: usize = 8;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KnownReference {
    Itself,
    Helper {
        symbol: SymbolId,
        is_initialized_first: bool,
    },
    Global {
        symbol: SymbolId,
        builtin: BuiltinId,
        is_initialized_first: bool,
    },
}

#[derive(Clone, Debug)]
pub struct KnownFunction {
    pub shape: Shape,
    pub functions: Box<[FnId]>,
    pub references: Box<[KnownReference]>,
    /// Whenever the function runs, each helper that it names is that helper and each built-in that it names is that built-in: the bindings are settled before it can run, and start-up locks the built-ins.
    pub relies_on_facts: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct HeldFunction {
    pub definition: FnId,
    pub closure: FnId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Certainty {
    #[default]
    MayHoldOtherValues,
    OnceInitialized,
    Always,
}

#[derive(Clone, Default, Debug)]
pub struct BindingValues {
    pub functions: SmallVec<[HeldFunction; 2]>,
    pub certainty: Certainty,
    /// No code of the file runs while the binding is still empty: it is a function declaration, or it is defined in the head of a file that nothing enters ahead of its body.
    pub holds_from_the_start: bool,
}

#[derive(Default)]
pub struct FileHelpers {
    functions: Box<[(FnId, KnownFunction)]>,
    bindings: Box<[(SymbolId, BindingValues)]>,
    head_allows_reads_of_open_globals: bool,
}

impl FileHelpers {
    pub fn function(&self, function: FnId) -> Option<&KnownFunction> {
        let at = self
            .functions
            .binary_search_by_key(&function, |entry| entry.0);
        at.ok().map(|at| &self.functions[at].1)
    }

    pub fn binding(&self, symbol: SymbolId) -> Option<&BindingValues> {
        let at = self.bindings.binary_search_by_key(&symbol, |entry| entry.0);
        at.ok().map(|at| &self.bindings[at].1)
    }

    pub fn functions(&self) -> impl ExactSizeIterator<Item = (FnId, &KnownFunction)> {
        self.functions.iter().map(|entry| (entry.0, &entry.1))
    }

    pub fn bindings(&self) -> impl ExactSizeIterator<Item = (SymbolId, &BindingValues)> {
        self.bindings.iter().map(|entry| (entry.0, &entry.1))
    }

    /// What `Quiet::allows_reads_of_open_globals` is for the head of the file: code of other files that runs while the head does has no way to call into the file.
    pub fn head_allows_reads_of_open_globals(&self) -> bool {
        self.head_allows_reads_of_open_globals
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Verdict {
    Unknown,
    InProgress,
    Accepted,
    Rejected,
}

struct Matched {
    entry: &'static TableEntry,
    outer_names: Vec<OuterName>,
    functions: Vec<FnId>,
    globals: Vec<ExprId>,
    references: Vec<KnownReference>,
    verdict: Verdict,
    relies_on_facts: Option<bool>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Alternative {
    Function(FnId),
    ResultOfCall(FnId),
    Other,
}

#[derive(Copy, Clone)]
struct Definition {
    value: ExprId,
    statement: Option<StmtId>,
    is_stored_again: bool,
}

struct Finder<'a, 's> {
    atoms: &'a Interner<'s>,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    is_es_module: bool,
    is_held_early: &'a dyn Fn() -> bool,
    matched: FxHashMap<FnId, Matched>,
    bindings: FxHashMap<SymbolId, BindingValues>,
    end_of_head: OnceCell<u32>,
    end_of_silent_head: OnceCell<u32>,
    exports_function_declaration: OnceCell<bool>,
}

pub(super) struct FindInput<'a, 's> {
    pub(super) atoms: &'a Interner<'s>,
    pub(super) hir: &'a hir::File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) decisions: &'a Decisions<'s>,
    pub(super) module_format: ModuleFormat,
    /// Code of another file can call what the file exports before the file has run to its end.
    pub(super) is_held_early: &'a dyn Fn() -> bool,
}

fn runs_something(_: hir::CallId) -> bool {
    false
}

fn find_global(path: &[&str]) -> Option<BuiltinId> {
    let (root, members) = path.split_first()?;
    let mut builtin = table::global(table::find_name(root.as_bytes())?)?;
    for member in members {
        let name = table::find_name(member.as_bytes())?;
        let MemberLookup::Found(found) = table::member(builtin, name) else {
            return None;
        };
        builtin = found;
    }
    Some(builtin)
}

pub(super) fn find_in_file(
    files: &Files<'_>,
    file: FileId,
    is_held_early: &dyn Fn() -> bool,
) -> FileHelpers {
    let Some(compiled) = files.compiled(file) else {
        return FileHelpers::default();
    };
    find(&FindInput {
        atoms: &files.atoms,
        hir: files.hir(file),
        bound: files.bound(file),
        decisions: &compiled.analysis.decisions,
        module_format: compiled.analysis.module_format,
        is_held_early,
    })
}

pub(super) fn find(input: &FindInput<'_, '_>) -> FileHelpers {
    let mut finder = Finder {
        atoms: input.atoms,
        hir: input.hir,
        bound: input.bound,
        decisions: input.decisions,
        is_es_module: input.module_format == ModuleFormat::Esm,
        is_held_early: input.is_held_early,
        matched: FxHashMap::default(),
        bindings: FxHashMap::default(),
        end_of_head: OnceCell::new(),
        end_of_silent_head: OnceCell::new(),
        exports_function_declaration: OnceCell::new(),
    };
    finder.match_functions();
    if finder.matched.is_empty() {
        return FileHelpers::default();
    }
    finder.verify_functions();
    finder.collect_bindings();
    finder.collect_facts();
    finder.finish()
}

impl<'a, 's> Finder<'a, 's> {
    fn quiet(&self) -> Quiet<'a, 's> {
        Quiet {
            atoms: self.atoms,
            hir: self.hir,
            bound: self.bound,
            decisions: self.decisions,
            allows_reads_of_open_globals: false,
            runs_nothing: &runs_something,
        }
    }
}

impl Finder<'_, '_> {
    fn match_functions(&mut self) {
        let table = Table::get();
        let input = CanonicalInput {
            hir: self.hir,
            bound: self.bound,
            atoms: self.atoms,
            max_bytes: table.max_bytes(),
            is_outer_name: &|_| false,
        };
        for function in (0..self.hir.fns.len() as u32).map(FnId) {
            if matches!(self.hir[function].body, FnBody::None)
                || !table.has_signature(signature_of(self.hir, function))
                || self.decisions.is_dead_function(function)
            {
                continue;
            }
            let Some(canonical) = canonical_function(&input, function) else {
                continue;
            };
            let Some(entry) = table.find(&canonical.bytes) else {
                continue;
            };
            if entry.references.len() != canonical.outer_names.len() {
                continue;
            }
            self.matched.insert(
                function,
                Matched {
                    entry,
                    outer_names: canonical.outer_names,
                    functions: canonical.inner_functions,
                    globals: canonical.globals,
                    references: Vec::new(),
                    verdict: Verdict::Unknown,
                    relies_on_facts: None,
                },
            );
        }
    }

    fn sorted_matches(&self) -> Vec<FnId> {
        let mut functions: Vec<FnId> = self.matched.keys().copied().collect();
        functions.sort_unstable();
        functions
    }

    fn verify_functions(&mut self) {
        for function in self.sorted_matches() {
            self.verify(function);
        }
    }

    fn verify(&mut self, function: FnId) -> bool {
        let Some(matched) = self.matched.get_mut(&function) else {
            return false;
        };
        match matched.verdict {
            Verdict::Accepted => return true,
            Verdict::Rejected | Verdict::InProgress => return false,
            Verdict::Unknown => matched.verdict = Verdict::InProgress,
        }
        let entry = matched.entry;
        let outer_names = matched.outer_names.clone();
        let references: Option<Vec<KnownReference>> = entry
            .references
            .iter()
            .zip(&outer_names)
            .map(|(&reference, &outer)| self.verify_reference(function, reference, outer))
            .collect();
        let matched = self.matched.get_mut(&function).expect("it was found above");
        match references {
            Some(references) => {
                matched.references = references;
                matched.verdict = Verdict::Accepted;
                true
            }
            None => {
                matched.verdict = Verdict::Rejected;
                false
            }
        }
    }

    fn verify_reference(
        &mut self,
        function: FnId,
        reference: Reference,
        outer: OuterName,
    ) -> Option<KnownReference> {
        let OuterName::Symbol(symbol) = outer else {
            return None;
        };
        match reference {
            Reference::Itself => {
                (self.find_owner(function)? == symbol).then_some(KnownReference::Itself)
            }
            Reference::Helper(helper) => {
                let values = self.values_of(symbol);
                let mut held = values.functions.iter();
                let is_of_family = !values.functions.is_empty()
                    && held
                        .all(|held| self.matched[&held.definition].entry.shape.helper() == helper);
                is_of_family.then(|| KnownReference::Helper {
                    symbol,
                    is_initialized_first: self.is_initialized_before(symbol, function),
                })
            }
            Reference::Global(path) => {
                let builtin = find_global(path)?;
                self.is_alias_of_global(symbol, path)
                    .then(|| KnownReference::Global {
                        symbol,
                        builtin,
                        is_initialized_first: self.is_initialized_before(symbol, function),
                    })
            }
        }
    }

    // `var __defProp = Object.defineProperty;`: what the path held when the variable was initialized.
    fn is_alias_of_global(&self, symbol: SymbolId, path: &[&str]) -> bool {
        let recorded = self.bound.binding_stability_ignoring(symbol, &|_| true);
        let definition = self.find_definition(symbol);
        definition.is_some_and(|definition| {
            !definition.is_stored_again
                && recorded == BindingStability::Stable
                && self.names_global(definition.value, path)
        })
    }

    fn names_global(&self, expression: ExprId, path: &[&str]) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some((last, holders)) = path.split_last() else {
            return false;
        };
        let expression = hir.skip_type_assertions(expression);
        if self.decisions.decision(expression) != Decision::Unknown {
            return false;
        }
        let is_last = |name: Atom| self.atoms.bytes(name) == last.as_bytes();
        match hir[expression].kind {
            ExprKind::Ident(name) => {
                holders.is_empty()
                    && is_last(name)
                    && bound.binding(expression) == Binding::Free
                    && bound
                        .dynamic_lookup_scope(NodeData::Expr(expression))
                        .is_none()
            }
            ExprKind::Dot {
                chain: Chain::No, ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => match hir.member_key(expression) {
                Some((object, MemberKey::Name(name))) => {
                    is_last(name) && self.names_global(object, holders)
                }
                Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => false,
            },
            _ => false,
        }
    }

    fn creation_of(&self, function: FnId) -> Option<ExprId> {
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => Some(expression),
            FnOwner::None | FnOwner::Stmt(_) | FnOwner::Member(_) | FnOwner::Type(_) => None,
        }
    }

    fn find_owner(&self, function: FnId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = match bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => expression,
            FnOwner::Stmt(_) => return bound.declared_symbol(Decl::Fn(function)).some(),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => return None,
        };
        loop {
            let parent = match bound.parent_of_expr(child) {
                Parent::Expr(parent) => parent,
                Parent::VarInit(declaration) => {
                    return bound
                        .declared_symbol(Decl::Var(hir[declaration].pat))
                        .some();
                }
                _ => return None,
            };
            match hir[parent].kind {
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::And | BinOp::Nullish | BinOp::Comma,
                    ..
                } => {}
                ExprKind::Cond { test, .. } if test != child => {}
                ExprKind::Call(call) if hir[call].callee == child && hir[call].args.is_empty() => {}
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == child => {
                    return match bound.binding(target) {
                        Binding::Symbol(symbol)
                            if matches!(hir[target].kind, ExprKind::Ident(_)) =>
                        {
                            Some(symbol)
                        }
                        _ => None,
                    };
                }
                _ if hir.type_assertion_operand(parent) == Some(child) => {}
                _ => return None,
            }
            child = parent;
        }
    }

    fn enclosing_statement(&self, expression: ExprId) -> Option<StmtId> {
        let mut child = expression;
        loop {
            match self.bound.parent_of_expr(child) {
                Parent::Expr(parent) => child = parent,
                Parent::VarInit(declaration) => {
                    return self.bound.var_stmt[declaration.idx()].some();
                }
                Parent::Stmt(statement) => return Some(statement),
                _ => return None,
            }
        }
    }

    fn is_in_straight_line(&self, statement: StmtId) -> bool {
        matches!(
            self.bound.parent_of_stmt(statement),
            Parent::File | Parent::FnBody(_)
        )
    }

    fn is_initialized_before(&self, symbol: SymbolId, function: FnId) -> bool {
        let Some(definition) = self.find_definition(symbol) else {
            return false;
        };
        let created = self.creation_of(function);
        let created = created.and_then(|created| self.enclosing_statement(created));
        let (Some(defined), Some(created)) = (definition.statement, created) else {
            return false;
        };
        self.is_in_straight_line(defined)
            && self.bound.parent_of_stmt(defined) == self.bound.parent_of_stmt(created)
            && self.hir[defined].start < self.hir[created].start
    }

    fn find_definition(&self, symbol: SymbolId) -> Option<Definition> {
        let (hir, bound) = (self.hir, self.bound);
        let stores = bound.stores_to(symbol);
        let is_live = |target: ExprId| !self.decisions.is_dead_expr(target);
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(value) => Some(Definition {
                value,
                statement: self.enclosing_statement(value),
                is_stored_again: stores.iter().any(|store| is_live(store.target)),
            }),
            BindingInitializer::Opaque if bound.binding_kind(symbol) == BindingKind::Var => {
                let mut live = stores.iter().filter(|store| is_live(store.target));
                let (store, None) = (live.next()?, live.next()) else {
                    return None;
                };
                if store.kind != StoreKind::Assign {
                    return None;
                }
                let Parent::Expr(assignment) = bound.parent_of_expr(store.target) else {
                    return None;
                };
                let ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } = hir[assignment].kind
                else {
                    return None;
                };
                let Parent::Stmt(statement) = bound.parent_of_expr(assignment) else {
                    return None;
                };
                (target == store.target).then_some(Definition {
                    value,
                    statement: Some(statement),
                    is_stored_again: false,
                })
            }
            _ => None,
        }
    }

    fn is_undefined_this(&self, expression: ExprId) -> bool {
        if !self.is_es_module || !matches!(self.hir[expression].kind, ExprKind::This) {
            return false;
        }
        let statement = self.enclosing_statement(expression);
        statement.is_some_and(|it| self.bound.parent_of_stmt(it) == Parent::File)
    }

    // A bundler's `((x) => typeof require !== "undefined" ? require : ..)(function (x) { .. })` answers `require`.
    fn is_call_of_require_factory(&self, call: hir::CallId) -> bool {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(hir[call].callee)].kind {
            ExprKind::Fn(function) => self
                .matched
                .get(&function)
                .is_some_and(|matched| matched.entry.shape == Shape::RequireFactoryPrefersRequire),
            _ => false,
        }
    }

    // Code of another file that holds the exports of a file that has not run to its end finds nothing to call in a CommonJS file that has stored no export yet, and the function declarations in an ES module.
    fn may_start_early(&self) -> bool {
        self.is_es_module && self.exports_function_declaration() && (self.is_held_early)()
    }

    fn head_allows_reads_of_open_globals(&self) -> bool {
        !self.may_start_early()
    }

    fn ask_quiet_of_head<R>(&self, ask: impl FnOnce(&Quiet<'_, '_>) -> R) -> R {
        ask(&Quiet {
            allows_reads_of_open_globals: self.head_allows_reads_of_open_globals(),
            runs_nothing: &|call| self.is_call_of_require_factory(call),
            ..self.quiet()
        })
    }

    fn end_of_head(&self) -> u32 {
        *self
            .end_of_head
            .get_or_init(|| self.ask_quiet_of_head(|quiet| quiet.find_end_of_head()))
    }

    /// Nothing of the file but quiet code runs until the variable holds the value.
    fn is_in_head(&self, definition: Definition) -> bool {
        let hir = self.hir;
        let Some(statement) = definition.statement else {
            return false;
        };
        if self.bound.parent_of_stmt(statement) != Parent::File {
            return false;
        }
        match hir[statement].kind {
            StmtKind::Var(_) => hir[definition.value].pos < self.end_of_head(),
            // `name = value;` is never quiet.
            _ => {
                hir[statement].start <= self.end_of_head()
                    && self.ask_quiet_of_head(|quiet| quiet.is_quiet_expression(definition.value))
            }
        }
    }

    /// Nothing of the program runs between the start of the file and the expression.
    fn is_in_silent_head(&self, expression: ExprId) -> bool {
        let end = *self
            .end_of_silent_head
            .get_or_init(|| self.quiet().find_end_of_head());
        let statement = self.enclosing_statement(expression);
        statement.is_some_and(|it| self.bound.parent_of_stmt(it) == Parent::File)
            && self.hir[expression].pos < end
    }

    fn exports_function_declaration(&self) -> bool {
        *self
            .exports_function_declaration
            .get_or_init(|| self.find_exported_function_declaration())
    }

    fn find_exported_function_declaration(&self) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        hir.ids(hir.body)
            .any(|statement| match hir[statement].kind {
                StmtKind::Fn(function) => hir[function]
                    .flags
                    .intersects(Flags::EXPORT | Flags::DEFAULT),
                StmtKind::ExportNamed(export) if !hir[export].has_module_specifier => hir[export]
                    .items
                    .iter()
                    .any(|item| match bound.exported_binding(item) {
                        Binding::Symbol(symbol) => {
                            bound.binding_kind(symbol) == BindingKind::Function
                        }
                        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
                    }),
                _ => false,
            })
    }

    fn is_defined_in_head(&self, symbol: SymbolId) -> bool {
        let definition = self.find_definition(symbol);
        !self.may_start_early() && definition.is_some_and(|definition| self.is_in_head(definition))
    }

    // `this && this.__helper` in the head of a CommonJS file: `this` is the object that the file exports, and it is still as it was made.
    fn reads_untouched_exports(&self, this: ExprId, member: ExprId) -> bool {
        if self.is_es_module {
            return false;
        }
        let (hir, quiet) = (self.hir, self.quiet());
        let member = hir.skip_type_assertions(member);
        let Some((object, MemberKey::Name(name))) = hir.member_key(member) else {
            return false;
        };
        let is_plain_read = matches!(
            hir[member].kind,
            ExprKind::Dot {
                chain: Chain::No,
                ..
            } | ExprKind::Index {
                chain: Chain::No,
                ..
            }
        );
        is_plain_read
            && quiet.is_this_of_file(this)
            && quiet.is_this_of_file(object)
            && is_absent_from_object_prototype(self.atoms, name)
            && self.is_in_silent_head(member)
    }

    fn is_written_in(&self, function: FnId, expression: ExprId) -> bool {
        let hir = self.hir;
        let (start, end) = match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(owner) => (hir[owner].pos, hir[owner].end),
            FnOwner::Stmt(owner) => (hir[owner].start, hir[owner].loc.end),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => return false,
        };
        (start..end).contains(&hir[expression].pos)
    }

    fn collect_alternatives(
        &self,
        expression: ExprId,
        alternatives: &mut SmallVec<[Alternative; 4]>,
    ) {
        let hir = self.hir;
        if self.decisions.is_dead_expr(expression) {
            return;
        }
        let expression = hir.skip_type_assertions(expression);
        if alternatives.len() >= MAX_ALTERNATIVES {
            alternatives.push(Alternative::Other);
            return;
        }
        match hir[expression].kind {
            ExprKind::Fn(function) => alternatives.push(Alternative::Function(function)),
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } if self.is_undefined_this(hir.skip_type_assertions(left))
                || self.reads_untouched_exports(left, right) => {}
            ExprKind::Binary {
                op: BinOp::Or | BinOp::And | BinOp::Nullish,
                left,
                right,
            } => {
                self.collect_alternatives(left, alternatives);
                self.collect_alternatives(right, alternatives);
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.collect_alternatives(right, alternatives),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                self.collect_alternatives(branches.yes, alternatives);
                if !self.quiet().names_locked_object(test) {
                    self.collect_alternatives(branches.no, alternatives);
                }
            }
            ExprKind::Call(call) if hir[call].args.is_empty() => {
                match hir[hir.skip_type_assertions(hir[call].callee)].kind {
                    ExprKind::Fn(function) => {
                        alternatives.push(Alternative::ResultOfCall(function));
                    }
                    _ => alternatives.push(Alternative::Other),
                }
            }
            _ => alternatives.push(Alternative::Other),
        }
    }

    fn returned_function(&self, function: FnId) -> Option<FnId> {
        let hir = self.hir;
        let FnBody::Block(statements) = hir[function].body else {
            return None;
        };
        let StmtKind::Return(value) = hir[hir.ids(statements).last()?].kind else {
            return None;
        };
        let returns = self.bound.fns[function.idx()].returns;
        if returns.len() != 1 || value.is_none() {
            return None;
        }
        match hir[hir.skip_type_assertions(value)].kind {
            ExprKind::Fn(returned) => Some(returned),
            _ => None,
        }
    }

    fn values_of(&mut self, symbol: SymbolId) -> BindingValues {
        if let Some(values) = self.bindings.get(&symbol) {
            return values.clone();
        }
        let values = self.compute_values(symbol);
        self.bindings.insert(symbol, values.clone());
        values
    }

    fn compute_values(&mut self, symbol: SymbolId) -> BindingValues {
        let (hir, bound) = (self.hir, self.bound);
        if let BindingInitializer::Function(function) = bound.binding_initializer(hir, symbol) {
            if !self.verify(function) {
                return BindingValues::default();
            }
            // What a helper stores to its own name is a part of the helper.
            let stability = bound
                .binding_stability_ignoring(symbol, &|target| self.is_written_in(function, target));
            let is_stable = stability == BindingStability::Stable;
            let is_declaration = bound.binding_kind(symbol) == BindingKind::Function;
            return BindingValues {
                functions: SmallVec::from_slice(&[HeldFunction {
                    definition: function,
                    closure: function,
                }]),
                certainty: match is_stable && is_declaration {
                    true => Certainty::Always,
                    false => Certainty::MayHoldOtherValues,
                },
                holds_from_the_start: is_stable && is_declaration,
            };
        }
        let Some(definition) = self.find_definition(symbol) else {
            return BindingValues::default();
        };
        let mut alternatives = SmallVec::new();
        self.collect_alternatives(definition.value, &mut alternatives);
        let mut values = BindingValues::default();
        let mut has_other = definition.is_stored_again;
        for alternative in alternatives {
            let held = match alternative {
                Alternative::Function(function) => Some(HeldFunction {
                    definition: function,
                    closure: function,
                }),
                Alternative::ResultOfCall(function) => {
                    let returned = self.returned_function(function);
                    returned.map(|closure| HeldFunction {
                        definition: function,
                        closure,
                    })
                }
                Alternative::Other => None,
            };
            match held {
                Some(held) if self.verify(held.definition) => values.functions.push(held),
                Some(_) | None => has_other = true,
            }
        }
        let recorded = bound.binding_stability_ignoring(symbol, &|_| true);
        has_other |= recorded != BindingStability::Stable;
        values.certainty = match (has_other, bound.binding_kind(symbol)) {
            (true, _) => Certainty::MayHoldOtherValues,
            (false, BindingKind::Let | BindingKind::Const) => Certainty::Always,
            (false, _) => Certainty::OnceInitialized,
        };
        values.holds_from_the_start =
            !has_other && !self.may_start_early() && self.is_in_head(definition);
        values
    }

    // The longest path of names that the table knows, from each global that the function names.
    fn names_only_locked_globals(&self, globals: &[ExprId]) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let find_name = |name: Atom| table::find_name(self.atoms.bytes(name));
        globals.iter().all(|&global| {
            let ExprKind::Ident(name) = hir[global].kind else {
                return false;
            };
            let Some(mut builtin) = find_name(name).and_then(table::global) else {
                return false;
            };
            if !is_locked(builtin) {
                return false;
            }
            let mut object = global;
            while let Parent::Expr(parent) = bound.parent_of_expr(object)
                && let Some((accessed, MemberKey::Name(name))) = hir.member_key(parent)
                && accessed == object
                && let Some(name) = find_name(name)
                && let MemberLookup::Found(member) = table::member(builtin, name)
            {
                if table::entry(member).mutability != Mutability::AlwaysLocked {
                    return false;
                }
                (builtin, object) = (member, parent);
            }
            true
        })
    }

    fn is_fact(&mut self, reference: KnownReference) -> bool {
        match reference {
            KnownReference::Itself => true,
            KnownReference::Helper {
                symbol,
                is_initialized_first,
            } => {
                let values = self.values_of(symbol);
                let [held] = values.functions[..] else {
                    return false;
                };
                let is_settled = values.holds_from_the_start
                    || (is_initialized_first && values.certainty != Certainty::MayHoldOtherValues);
                is_settled && self.relies_on_facts(held.definition)
            }
            KnownReference::Global {
                symbol,
                builtin,
                is_initialized_first,
            } => is_locked(builtin) && (is_initialized_first || self.is_defined_in_head(symbol)),
        }
    }

    fn relies_on_facts(&mut self, function: FnId) -> bool {
        let Some(matched) = self.matched.get(&function) else {
            return false;
        };
        if let Some(known) = matched.relies_on_facts {
            return known;
        }
        let references = matched.references.clone();
        let answer = matched.verdict == Verdict::Accepted
            && self.names_only_locked_globals(&matched.globals)
            && references
                .into_iter()
                .all(|reference| self.is_fact(reference));
        let matched = self.matched.get_mut(&function).expect("it was found above");
        matched.relies_on_facts = Some(answer);
        answer
    }

    fn collect_facts(&mut self) {
        for function in self.sorted_matches() {
            self.relies_on_facts(function);
        }
    }

    fn collect_bindings(&mut self) {
        for function in self.sorted_matches() {
            if self.matched[&function].verdict != Verdict::Accepted {
                continue;
            }
            if let Some(owner) = self.find_owner(function) {
                self.values_of(owner);
            }
        }
    }

    fn finish(self) -> FileHelpers {
        let head_allows_reads_of_open_globals = self.head_allows_reads_of_open_globals();
        let accepted = self.matched.into_iter().filter_map(|(function, matched)| {
            (matched.verdict == Verdict::Accepted).then(|| {
                let known = KnownFunction {
                    shape: matched.entry.shape,
                    functions: matched.functions.into_boxed_slice(),
                    references: matched.references.into_boxed_slice(),
                    relies_on_facts: matched.relies_on_facts.unwrap_or(false),
                };
                (function, known)
            })
        });
        let mut functions: Vec<(FnId, KnownFunction)> = accepted.collect();
        functions.sort_unstable_by_key(|entry| entry.0);
        let held = self.bindings.into_iter();
        let mut bindings: Vec<(SymbolId, BindingValues)> =
            held.filter(|entry| !entry.1.functions.is_empty()).collect();
        bindings.sort_unstable_by_key(|entry| entry.0);
        FileHelpers {
            functions: functions.into_boxed_slice(),
            bindings: bindings.into_boxed_slice(),
            head_allows_reads_of_open_globals,
        }
    }
}
