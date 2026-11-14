use super::canonical::{CanonicalFunction, CanonicalInput, OuterName, canonical_function};
use super::quiet::{
    Quiet, is_absent_from_object_prototype, is_global_name, is_in_statement_of_file, plain_member,
};
use super::table::{Table, TableEntry, signature_of};
use super::{Helper, Reference, Shape, find_by_key};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, MemberLookup, Mutability, is_locked};
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CommonJsVariable, Decl,
    FnOwner, Parent, StoreKind, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Decision, Decisions};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, Flags, FnBody, FnId, MemberKey, StmtId, StmtKind,
};
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{FileId, Files};
use bun_sema::util::FxHashMap;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;
use std::cell::OnceCell;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KnownReference {
    Helper {
        symbol: SymbolId,
        is_initialized_first: bool,
    },
    Global {
        symbol: SymbolId,
        builtin: BuiltinId,
        is_initialized_first: bool,
    },
    Loaded {
        symbol: SymbolId,
        helper: Helper,
    },
    Holder {
        symbol: SymbolId,
    },
}

#[derive(Clone, Debug)]
pub struct KnownFunction {
    pub shape: Shape,
    pub functions: Box<[FnId]>,
    pub references: Box<[KnownReference]>,
    pub relies_on_facts: bool,
    pub names_locked_globals: bool,
    pub is_named_only_to_be_called: bool,
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
    pub holds_from_the_start: bool,
    pub defined_by: Option<StmtId>,
}

#[derive(Default)]
pub struct FileHelpers {
    functions: Box<[(FnId, KnownFunction)]>,
    bindings: Box<[(SymbolId, BindingValues)]>,
    head_allows_reads_of_open_globals: bool,
}

impl FileHelpers {
    pub fn head_allows_reads_of_open_globals(&self) -> bool {
        self.head_allows_reads_of_open_globals
    }

    pub fn function(&self, function: FnId) -> Option<&KnownFunction> {
        find_by_key(&self.functions, function)
    }

    pub fn binding(&self, symbol: SymbolId) -> Option<&BindingValues> {
        find_by_key(&self.bindings, symbol)
    }

    pub fn functions(&self) -> impl ExactSizeIterator<Item = (FnId, &KnownFunction)> {
        self.functions.iter().map(|entry| (entry.0, &entry.1))
    }

    pub fn bindings(&self) -> impl ExactSizeIterator<Item = (SymbolId, &BindingValues)> {
        self.bindings.iter().map(|entry| (entry.0, &entry.1))
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
    canonical: CanonicalFunction,
    references: Vec<KnownReference>,
    verdict: Verdict,
    relies_on_facts: Option<bool>,
}

#[derive(Copy, Clone)]
struct Definition {
    value: ExprId,
    statement: Option<StmtId>,
    is_stored_again: bool,
}

struct Finder<'a, 's> {
    file: &'a FindInput<'a, 's>,
    is_es_module: bool,
    matched: FxHashMap<FnId, Matched>,
    bindings: FxHashMap<SymbolId, BindingValues>,
    end_of_head: OnceCell<u32>,
    end_of_silent_head: OnceCell<u32>,
    may_start_early: OnceCell<bool>,
}

pub(super) struct FindInput<'a, 's> {
    pub(super) atoms: &'a Interner<'s>,
    pub(super) hir: &'a hir::File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) analysis: &'a FileAnalysis<'s>,
    pub(super) decisions: &'a Decisions<'s>,
    pub(super) builtins: &'a ResolvedBuiltins,
    pub(super) module_format: ModuleFormat,
    pub(super) names_added_to_builtins: &'a [(BuiltinId, Atom)],
    pub(super) is_held_early: &'a dyn Fn() -> bool,
}

fn is_call_that_runs_nothing(_: hir::CallId) -> bool {
    false
}

pub(super) fn find_global(path: &[&str]) -> Option<BuiltinId> {
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
    names_added_to_builtins: &[(BuiltinId, Atom)],
    is_held_early: &dyn Fn() -> bool,
) -> FileHelpers {
    let (Some(compiled), Some(source)) = (files.compiled(file), parsed_source(files, file)) else {
        return FileHelpers::default();
    };
    find(&FindInput {
        atoms: &files.atoms,
        hir: files.hir(file),
        bound: files.bound(file),
        analysis: &compiled.analysis,
        decisions: &compiled.analysis.decisions,
        builtins: &source.builtins,
        module_format: compiled.analysis.module_format,
        names_added_to_builtins,
        is_held_early,
    })
}

pub(super) fn find(input: &FindInput<'_, '_>) -> FileHelpers {
    let mut finder = Finder {
        file: input,
        is_es_module: input.module_format == ModuleFormat::Esm,
        matched: FxHashMap::default(),
        bindings: FxHashMap::default(),
        end_of_head: OnceCell::new(),
        end_of_silent_head: OnceCell::new(),
        may_start_early: OnceCell::new(),
    };
    let functions = finder.match_functions();
    if functions.is_empty() {
        return FileHelpers::default();
    }
    for &function in &functions {
        finder.verify(function);
    }
    for &function in &functions {
        if finder.matched[&function].verdict == Verdict::Accepted
            && let Some(owner) = finder.find_owner(function)
        {
            finder.values_of(owner);
        }
    }
    for &function in &functions {
        finder.relies_on_facts(function);
    }
    finder.finish()
}

#[derive(Clone, Copy)]
enum Alternative {
    Function(HeldFunction),
    Undefined,
    Other,
}

impl<'a, 's> Finder<'a, 's> {
    fn quiet(&self) -> Quiet<'a, 's> {
        Quiet {
            atoms: self.file.atoms,
            hir: self.file.hir,
            bound: self.file.bound,
            decisions: self.file.decisions,
            builtins: self.file.builtins,
            allows_reads_of_open_globals: false,
            runs_nothing: &is_call_that_runs_nothing,
        }
    }

    fn match_functions(&mut self) -> Vec<FnId> {
        let table = Table::get();
        let mut functions = Vec::new();
        let input = CanonicalInput {
            file: self.file,
            max_bytes: table.max_bytes,
            is_outer_name: &|_| false,
            known: Some(&table.functions),
        };
        for function in (0..self.file.hir.fns.len() as u32).map(FnId) {
            if matches!(self.file.hir[function].body, FnBody::None)
                || !table
                    .signatures
                    .contains(&signature_of(self.file.hir, function))
                || self.file.decisions.is_dead_function(function)
            {
                continue;
            }
            let Some(canonical) = canonical_function(&input, function) else {
                continue;
            };
            let Some(entry) = table.entries.get(canonical.bytes.as_slice()) else {
                continue;
            };
            if entry.references.len() != canonical.outer_names.len()
                || self.stores_to_name_of_expression(function)
            {
                continue;
            }
            functions.push(function);
            self.matched.insert(
                function,
                Matched {
                    entry,
                    canonical,
                    references: Vec::new(),
                    verdict: Verdict::Unknown,
                    relies_on_facts: None,
                },
            );
        }
        functions
    }

    fn stores_to_name_of_expression(&self, function: FnId) -> bool {
        let bound = self.file.bound;
        let own_name = bound.declared_symbol(Decl::Fn(function));
        bound.binding_kind(own_name) == BindingKind::FunctionName
            && !bound.stores_to(own_name).is_empty()
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
        let outer_names = matched.canonical.outer_names.clone();
        let references: Option<Vec<KnownReference>> = entry
            .references
            .iter()
            .zip(&outer_names)
            .map(|(&reference, &outer)| self.verify_reference(function, reference, outer))
            .collect();
        let matched = self.matched.get_mut(&function).expect("it was found above");
        matched.verdict = match references {
            Some(_) => Verdict::Accepted,
            None => Verdict::Rejected,
        };
        matched.references = references.unwrap_or_default();
        matched.verdict == Verdict::Accepted
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
            Reference::Holder => Some(KnownReference::Holder { symbol }),
            Reference::Helper(helper) if self.is_loaded_from_another_file(symbol) => {
                Some(KnownReference::Loaded { symbol, helper })
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

    fn is_loaded_from_another_file(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        if bound.binding_kind(symbol) == BindingKind::Import {
            return true;
        }
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return false;
        };
        let mut value = hir.skip_type_assertions(value);
        if let Some((object, MemberKey::Name(known::default))) = hir.member_key(value) {
            value = hir.skip_type_assertions(object);
        }
        let ExprKind::Call(site) = hir[value].kind else {
            return false;
        };
        let callee = hir.skip_type_assertions(hir[site].callee);
        bound.is_stable_binding(symbol)
            && bound.binding(callee) == Binding::CommonJs(CommonJsVariable::Require)
    }

    fn is_alias_of_global(&self, symbol: SymbolId, path: &[&str]) -> bool {
        let recorded = self
            .file
            .bound
            .binding_stability_ignoring(symbol, &|_| true);
        let definition = self.find_definition(symbol);
        definition.is_some_and(|definition| {
            !definition.is_stored_again
                && recorded == BindingStability::Stable
                && self.names_global(definition.value, path)
        })
    }

    fn names_global(&self, expression: ExprId, path: &[&str]) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let Some((last, holders)) = path.split_last() else {
            return false;
        };
        let expression = hir.skip_type_assertions(expression);
        if self.file.decisions.decision(expression) != Decision::Unknown {
            return false;
        }
        let is_last = |name: Atom| self.file.atoms.bytes(name) == last.as_bytes();
        match hir[expression].kind {
            ExprKind::Ident(name) => {
                holders.is_empty() && is_last(name) && is_global_name(bound, expression)
            }
            _ => plain_member(hir, expression)
                .is_some_and(|(object, name)| is_last(name) && self.names_global(object, holders)),
        }
    }

    fn find_owner(&self, function: FnId) -> Option<SymbolId> {
        let (hir, bound) = (self.file.hir, self.file.bound);
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

    fn is_initialized_before(&self, symbol: SymbolId, function: FnId) -> bool {
        let Some(definition) = self.find_definition(symbol) else {
            return false;
        };
        let (hir, bound) = (self.file.hir, self.file.bound);
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return false;
        };
        let (Some(defined), Some(created)) =
            (definition.statement, bound.statement_of_expr(written))
        else {
            return false;
        };
        let parent = bound.parent_of_stmt(defined);
        matches!(parent, Parent::File | Parent::FnBody(_))
            && parent == bound.parent_of_stmt(created)
            && (hir[defined].start < hir[created].start
                || (defined == created
                    && matches!(hir[defined].kind, StmtKind::Var(_))
                    && hir[definition.value].end <= hir[written].pos))
    }

    fn find_definition(&self, symbol: SymbolId) -> Option<Definition> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let stores = bound.stores_to(symbol);
        let is_live = |target: ExprId| !self.file.decisions.is_dead_expr(target);
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(value) => Some(Definition {
                value,
                statement: bound.statement_of_expr(value),
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
        self.is_es_module
            && matches!(self.file.hir[expression].kind, ExprKind::This)
            && is_in_statement_of_file(self.file.bound, expression)
    }

    fn is_call_of_require_factory(&self, call: hir::CallId) -> bool {
        let hir = self.file.hir;
        match hir[hir.skip_type_assertions(hir[call].callee)].kind {
            ExprKind::Fn(function) => self
                .matched
                .get(&function)
                .is_some_and(|matched| matched.entry.shape == Shape::RequireFactoryPrefersRequire),
            _ => false,
        }
    }

    fn may_start_early(&self) -> bool {
        *self.may_start_early.get_or_init(|| {
            self.is_es_module && self.exports_function_declaration() && (self.file.is_held_early)()
        })
    }

    fn ask_quiet_of_head<R>(&self, ask: impl FnOnce(&Quiet<'_, '_>) -> R) -> R {
        ask(&Quiet {
            allows_reads_of_open_globals: !self.may_start_early(),
            runs_nothing: &|call| self.is_call_of_require_factory(call),
            ..self.quiet()
        })
    }

    fn end_of_head(&self) -> u32 {
        *self
            .end_of_head
            .get_or_init(|| self.ask_quiet_of_head(|quiet| quiet.find_end_of_head()))
    }

    fn is_in_head(&self, definition: Definition) -> bool {
        let hir = self.file.hir;
        let Some(statement) = definition.statement else {
            return false;
        };
        if self.file.bound.parent_of_stmt(statement) != Parent::File {
            return false;
        }
        match hir[statement].kind {
            StmtKind::Var(_) => hir[definition.value].pos < self.end_of_head(),
            _ => {
                hir[statement].start <= self.end_of_head()
                    && self.ask_quiet_of_head(|quiet| quiet.is_quiet_expression(definition.value))
            }
        }
    }

    fn is_in_silent_head(&self, expression: ExprId) -> bool {
        let end = *self
            .end_of_silent_head
            .get_or_init(|| self.quiet().find_end_of_head());
        is_in_statement_of_file(self.file.bound, expression) && self.file.hir[expression].pos < end
    }

    fn exports_function_declaration(&self) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
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

    fn reads_untouched_exports(&self, this: ExprId, member: ExprId) -> bool {
        if self.is_es_module {
            return false;
        }
        let (hir, quiet) = (self.file.hir, self.quiet());
        let member = hir.skip_type_assertions(member);
        let Some((object, name)) = plain_member(hir, member) else {
            return false;
        };
        quiet.is_this_of_file(this)
            && quiet.is_this_of_file(object)
            && is_absent_from_object_prototype(
                self.file.atoms,
                self.file.names_added_to_builtins,
                name,
            )
            && self.is_in_silent_head(member)
    }

    fn is_written_in(&self, function: FnId, expression: ExprId) -> bool {
        let hir = self.file.hir;
        let (start, end) = match self.file.bound.fns[function.idx()].owner {
            FnOwner::Expr(owner) => (hir[owner].pos, hir[owner].end),
            FnOwner::Stmt(owner) => (hir[owner].start, hir[owner].loc.end),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => return false,
        };
        (start..end).contains(&hir[expression].pos)
    }

    fn collect_alternatives(
        &self,
        expression: ExprId,
        drops_undefined: bool,
        alternatives: &mut SmallVec<[Alternative; 4]>,
    ) -> bool {
        let hir = self.file.hir;
        if self.file.decisions.is_dead_expr(expression) {
            return false;
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            alternatives.push(Alternative::Other);
            return true;
        }
        let expression = hir.skip_type_assertions(expression);
        let held = match hir[expression].kind {
            ExprKind::Fn(function) => Alternative::Function(HeldFunction {
                definition: function,
                closure: function,
            }),
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } if self.is_undefined_this(hir.skip_type_assertions(left))
                || self.reads_untouched_exports(left, right) =>
            {
                if !drops_undefined {
                    alternatives.push(Alternative::Undefined);
                }
                return false;
            }
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                let mut of_left = SmallVec::<[Alternative; 4]>::new();
                let reaches_right = self.collect_alternatives(left, drops_undefined, &mut of_left);
                let may_be_falsy = |held: &Alternative| !matches!(held, Alternative::Function(_));
                alternatives.extend(of_left.into_iter().filter(may_be_falsy));
                if reaches_right {
                    self.collect_alternatives(right, drops_undefined, alternatives);
                }
                return reaches_right;
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                let left = self.collect_alternatives(left, true, alternatives);
                return self.collect_alternatives(right, drops_undefined, alternatives) || left;
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => return self.collect_alternatives(right, drops_undefined, alternatives),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let yes = self.collect_alternatives(branches.yes, drops_undefined, alternatives);
                return (!self.quiet().names_locked_object(test)
                    && self.collect_alternatives(branches.no, drops_undefined, alternatives))
                    || yes;
            }
            ExprKind::Call(call) if hir[call].args.is_empty() => {
                match hir[hir.skip_type_assertions(hir[call].callee)].kind {
                    ExprKind::Fn(definition) => match self.returned_function(definition) {
                        Some(closure) => Alternative::Function(HeldFunction {
                            definition,
                            closure,
                        }),
                        None => Alternative::Other,
                    },
                    _ => Alternative::Other,
                }
            }
            _ => Alternative::Other,
        };
        alternatives.push(held);
        true
    }

    fn returned_function(&self, function: FnId) -> Option<FnId> {
        let hir = self.file.hir;
        let FnBody::Block(statements) = hir[function].body else {
            return None;
        };
        let StmtKind::Return(value) = hir[hir.ids(statements).last()?].kind else {
            return None;
        };
        let returns = self.file.bound.fns[function.idx()].returns;
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
        let (hir, bound) = (self.file.hir, self.file.bound);
        if let BindingInitializer::Function(function) = bound.binding_initializer(hir, symbol) {
            if !self.verify(function) {
                return BindingValues::default();
            }
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
                defined_by: None,
            };
        }
        let Some(definition) = self.find_definition(symbol) else {
            return BindingValues::default();
        };
        let mut alternatives = SmallVec::new();
        self.collect_alternatives(definition.value, false, &mut alternatives);
        let mut values = BindingValues::default();
        let mut has_other = definition.is_stored_again;
        for held in alternatives {
            match held {
                Alternative::Function(held) if self.verify(held.definition) => {
                    values.functions.push(held)
                }
                Alternative::Function(_) | Alternative::Undefined | Alternative::Other => {
                    has_other = true
                }
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
        values.defined_by = definition.statement;
        values
    }

    fn names_only_locked_globals(&self, globals: &[ExprId]) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let find_name = |name: Atom| table::find_name(self.file.atoms.bytes(name));
        globals.iter().all(|&global| {
            let ExprKind::Ident(name) = hir[global].kind else {
                return false;
            };
            let Some(mut builtin) = find_name(name).and_then(table::global) else {
                return false;
            };
            if !is_locked(builtin) || self.file.builtins.is_unlocked(builtin) {
                return false;
            }
            let mut object = global;
            while let Parent::Expr(parent) = bound.parent_of_expr(object)
                && let Some((accessed, MemberKey::Name(name))) = hir.member_key(parent)
                && accessed == object
                && let Some(name) = find_name(name)
                && let MemberLookup::Found(member) = table::member(builtin, name)
            {
                if table::entry(member).mutability != Mutability::AlwaysLocked
                    || self.file.builtins.is_unlocked(member)
                {
                    return false;
                }
                (builtin, object) = (member, parent);
            }
            true
        })
    }

    fn finds_locked_members(&self, shape: Shape) -> bool {
        let is_locked_member = |member: BuiltinId| {
            is_locked(member)
                && table::entry(member).mutability == Mutability::AlwaysLocked
                && !self.file.builtins.is_unlocked(member)
        };
        match shape {
            Shape::ExportStarOfKeysIfMissing => is_locked_member(BuiltinId::ArrayPrototypeForEach),
            _ => true,
        }
    }

    fn is_fact(&mut self, reference: KnownReference) -> bool {
        match reference {
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
            } => {
                is_locked(builtin)
                    && !self.file.builtins.is_unlocked(builtin)
                    && (is_initialized_first || self.is_defined_in_head(symbol))
            }
            KnownReference::Loaded { .. } => false,
            KnownReference::Holder { .. } => true,
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
            && self.finds_locked_members(matched.entry.shape)
            && self.names_only_locked_globals(&matched.canonical.globals)
            && references
                .into_iter()
                .all(|reference| self.is_fact(reference));
        let matched = self.matched.get_mut(&function).expect("it was found above");
        matched.relies_on_facts = Some(answer);
        answer
    }

    fn is_named_only_to_be_called(&self, function: FnId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let Some(owner) = self.find_owner(function) else {
            return false;
        };
        let analysis = self.file.analysis;
        let mut read_without_expression = analysis.bindings_read_without_expression(hir, bound);
        if bound.is_visible_to_eval(owner)
            || self.exports_function_declaration()
            || read_without_expression.any(|binding| binding == Binding::Symbol(owner))
        {
            return false;
        }
        (0..hir.exprs.len() as u32).map(ExprId).all(|name| {
            let names_owner = matches!(hir[name].kind, ExprKind::Ident(_))
                && bound.binding(name) == Binding::Symbol(owner);
            if !names_owner || self.is_written_in(function, name) {
                return true;
            }
            matches!(
                bound.parent_of_expr(name),
                Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(site) if hir[site].callee == name)
            )
        })
    }

    fn finish(self) -> FileHelpers {
        let head_allows_reads_of_open_globals = !self.may_start_early();
        let replace_themselves = self.matched.iter().filter(|(_, matched)| {
            matched.verdict == Verdict::Accepted && matched.entry.shape.replaces_itself()
        });
        let only_called: SmallVec<[FnId; 1]> = replace_themselves
            .map(|(&function, _)| function)
            .filter(|&function| self.is_named_only_to_be_called(function))
            .collect();
        let names_locked_globals: SmallVec<[FnId; 4]> = self
            .matched
            .iter()
            .filter(|(_, matched)| self.names_only_locked_globals(&matched.canonical.globals))
            .map(|(&function, _)| function)
            .collect();
        let accepted = self.matched.into_iter().filter_map(|(function, matched)| {
            (matched.verdict == Verdict::Accepted).then(|| {
                let known = KnownFunction {
                    shape: matched.entry.shape,
                    functions: matched.canonical.inner_functions.into_boxed_slice(),
                    references: matched.references.into_boxed_slice(),
                    relies_on_facts: matched.relies_on_facts.unwrap_or(false),
                    names_locked_globals: names_locked_globals.contains(&function),
                    is_named_only_to_be_called: only_called.contains(&function),
                };
                (function, known)
            })
        });
        let mut functions: Vec<(FnId, KnownFunction)> = accepted.collect();
        functions.shared_sort_unstable_by_key(|entry| entry.0);
        let held = self.bindings.into_iter();
        let mut bindings: Vec<(SymbolId, BindingValues)> =
            held.filter(|entry| !entry.1.functions.is_empty()).collect();
        bindings.shared_sort_unstable_by_key(|entry| entry.0);
        FileHelpers {
            functions: functions.into_boxed_slice(),
            bindings: bindings.into_boxed_slice(),
            head_allows_reads_of_open_globals,
        }
    }
}
