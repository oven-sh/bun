mod mutations;
mod builtin_constants;
mod builtins_generated;
mod callees;
mod captures;
mod class_bindings;
mod classes;
mod commonjs;
mod creation;
mod escape;
mod escape_closure;
mod findings;
mod first_stores;
mod flows;
pub mod nullish_flow;
mod identity;
mod int32_fields;
mod int32_proofs;
mod integers;
mod javascript;
mod kinds;
pub mod locked_builtins;
mod locked_builtins_generated;
mod mapped_arguments;
mod lint_checks;
mod type_flags;
mod sloppy;
mod storage;
mod subtypes;
mod symbols;
mod trust;
mod type_caches;
mod bun_types;
mod undeclared_fields;
mod validation;

pub use callees::{Callee, SingleFunction};
pub use captures::{Activation, Capture, CapturedVariable, DeclaredClosure, NotCopiedReason, Receiver};
pub use escape::argument_use;
pub use classes::{AddedMembers, ClassFacts, MethodStore, ReplacedMethods};
pub use commonjs::{CommonJsExports, ExportsReference};
pub use first_stores::FirstStore;
pub use identity::Identity;
pub use int32_fields::{NotInt32Reason, FlowNode, FlowSource, Int32Verdict, NumberFlow, CodeOwner, expected_int32};
pub use javascript::ImportedCode;
pub use kinds::kind;
pub use flows::{SubtypeAnswer, BuiltIn, Candidate, TruncatedSearch, KindsDeclared, Literal, SearchBarrier, Membership, FlowNotes, DataOrigin, Place, SubtypeQuery, LayoutUsage, FilePartition, UntypedReason};
pub use subtypes::{Cause, FieldTypes, LoggingRelaxation, Sizes, Subtypes};
pub use storage::{EvaluationTime, Primitive, ReferenceRead, Storage};
pub use symbols::{ConstantSymbol, FieldKey};
pub use lint_checks::{AotCheck, AotCheckKind};
pub use trust::{Claim, is_engine_global, is_typed_array_class};
pub use validation::{Constant, OtherKeys, Placeholder, PlanNode, Planned, PlannedMember, PlannedPrimitive, Rule, ValidationCall, ValidationPlan};

use super::{Checker, Program};
use super::relate::Relation;
use crate::atom::{Atom, known};
use crate::bind::Parent;
use crate::hir::{ExprId, ExprKind, ExprTag, ExprsByKind, FileKind, StmtId};
use crate::local::MaybeLocal;
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Origin, TypeData, TypeId, tf};
use crate::util::{InParallel, for_each_mut};

const MAX_TASK_NESTING: u32 = 1000;
const STACK_PER_LEVEL: usize = 16 << 10;
const MAX_NESTING_STACK: usize = 2 << 30;

fn longest_chain(parents: &[Parent], above: impl Fn(Parent) -> Option<usize>) -> u32 {
    if parents.len() <= MAX_TASK_NESTING as usize / 2 {
        return 0;
    }
    let mut lengths = vec![0u32; parents.len()];
    let (mut path, mut longest): (Vec<usize>, u32) = (Vec::new(), 0);
    for node in 0..parents.len() {
        let (mut at, mut length) = (Some(node), 0);
        while let Some(on) = at {
            if lengths[on] != 0 {
                length = lengths[on];
                break;
            }
            path.push(on);
            at = above(parents[on]);
        }
        while let Some(on) = path.pop() {
            length += 1;
            lengths[on] = length;
        }
        longest = longest.max(length);
    }
    longest
}

impl Program<'_> {
    pub fn extra_stack_for_nesting(&self, files: &[FileId]) -> usize {
        let deepest = files.iter().map(|&file| self.max_nesting_depth(file)).max().unwrap_or(0);
        if deepest <= MAX_TASK_NESTING { 0 } else { (deepest as usize * STACK_PER_LEVEL).min(MAX_NESTING_STACK) }
    }

    fn max_nesting_depth(&self, file: FileId) -> u32 {
        *self.aot.max_nesting_depths.get_or_init(self.files.modules.len(), file, || {
            let bound = self.files.bound(file);
            let expr_predictions = longest_chain(&bound.expr_parent, |parent| if let Parent::Expr(above) = parent { above.is_some().then(|| above.idx()) } else { None });
            let of_statements = longest_chain(&bound.stmt_parent, |parent| if let Parent::Stmt(above) = parent { above.is_some().then(|| above.idx()) } else { None });
            expr_predictions + of_statements
        })
    }
}

const FUEL: u64 = 1 << 14;
const MAX_VALUE_BOUND_DEPTH: u8 = 6;
const MAX_VALUE_BOUND_STEPS: u32 = 64;

thread_local! {
    static IS_WARMING_UP: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct OnceLock<T> {
    created: std::sync::OnceLock<T>,
    warmup_value: std::sync::OnceLock<Box<T>>,
}

impl<T> Default for OnceLock<T> {
    fn default() -> OnceLock<T> {
        OnceLock::new()
    }
}

impl<T> OnceLock<T> {
    const fn new() -> OnceLock<T> {
        OnceLock { created: std::sync::OnceLock::new(), warmup_value: std::sync::OnceLock::new() }
    }

    fn get(&self) -> Option<&T> {
        match self.created.get() {
            None if IS_WARMING_UP.get() => self.warmup_value.get().map(|created| &**created),
            created => created,
        }
    }

    fn get_or_init(&self, make: impl FnOnce() -> T) -> &T {
        match self.created.get() {
            Some(created) => created,
            None if IS_WARMING_UP.get() => self.warmup_value.get_or_init(|| Box::new(make())),
            None => self.created.get_or_init(make),
        }
    }

    fn set(&self, value: T) -> Result<(), T> {
        match IS_WARMING_UP.get() {
            true => self.warmup_value.set(Box::new(value)).map_err(|value| *value),
            false => self.created.set(value),
        }
    }

    fn is_finalized(&self) -> bool {
        self.created.get().is_some()
    }

    fn set_warmup_value(&self, value: T) {
        let _ = self.warmup_value.set(Box::new(value));
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn during_warmup<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let retained = std::mem::take(&mut self.aot);
        let kept_by_translator = self.translator.take();
        IS_WARMING_UP.set(true);
        let result = work(self);
        IS_WARMING_UP.set(false);
        let compared = self.aot.flows.take_pairs_compared();
        self.aot = retained;
        self.translator = kept_by_translator;
        self.aot.flows.add_pairs_compared(compared);
        result
    }

    pub fn is_warming_up(&self) -> bool {
        IS_WARMING_UP.get()
    }

    pub fn has_order_dependent_results(&self) -> bool {
        !self.task.listings.is_empty() || self.task.order_dependent_variances.iter().any(|it| it.compared | it.failed | it.inferred != 0)
    }

    pub fn during_translation<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let before = std::mem::replace(&mut self.aot.is_translating, true);
        let result = work(self);
        self.aot.is_translating = before;
        result
    }

    pub fn during_translation_after_check<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let before = std::mem::replace(&mut self.aot.is_after_check, true);
        let result = self.during_translation(work);
        self.aot.is_after_check = before;
        result
    }

    pub(in crate::check) fn is_translating(&self) -> bool {
        self.aot.is_translating
    }

    pub(in crate::check) fn is_after_check(&self) -> bool {
        self.aot.is_after_check
    }

    pub(in crate::check) fn queries_out_of_order(&self) -> bool {
        self.aot.is_translating || self.is_searching_from_sources()
    }
}

struct ByFile<T>(OnceLock<Box<[OnceLock<T>]>>);

impl<T> Default for ByFile<T> {
    fn default() -> ByFile<T> {
        ByFile(OnceLock::new())
    }
}

impl<T> ByFile<T> {
    fn get_or_init(&self, files: usize, file: FileId, make: impl FnOnce() -> T) -> &T {
        self.0.get_or_init(|| (0..files).map(|_| OnceLock::new()).collect())[file.idx()].get_or_init(make)
    }

    fn initialized(&self) -> impl Iterator<Item = &T> {
        self.0.get().into_iter().flat_map(|by_file| by_file.iter().filter_map(OnceLock::get))
    }
}

struct ByExpression<T> {
    file: FileId,
    round: u32,
    of_file: Vec<(u32, T)>,
    other_files: crate::util::FxHashMap<(FileId, ExprId), T>,
}

impl<T> Default for ByExpression<T> {
    fn default() -> ByExpression<T> {
        ByExpression { file: FileId(u32::MAX), round: 1, of_file: Vec::new(), other_files: Default::default() }
    }
}

impl<T: Copy> ByExpression<T> {
    fn switch_to_file(&mut self, file: FileId, expressions: usize, blank: T) {
        if self.file == file {
            return;
        }
        self.file = file;
        self.round += 1;
        if self.of_file.len() < expressions {
            self.of_file.resize(expressions, (0, blank));
        }
    }

    #[inline]
    fn get(&self, at: (FileId, ExprId)) -> Option<&T> {
        if at.0 != self.file {
            return self.other_files.get(&at);
        }
        self.of_file.get(at.1.idx()).filter(|entry| entry.0 == self.round).map(|entry| &entry.1)
    }

    #[inline]
    fn insert(&mut self, at: (FileId, ExprId), answer: T) {
        match self.of_file.get_mut(at.1.idx()) {
            Some(entry) if at.0 == self.file => *entry = (self.round, answer),
            _ => {
                self.other_files.insert(at, answer);
            }
        }
    }

    fn clear(&mut self) {
        self.round += 1;
        self.other_files.clear();
    }

    #[inline]
    fn get_in_file(&self, at: (FileId, ExprId)) -> Option<&T> {
        if at.0 != self.file {
            return None;
        }
        self.of_file.get(at.1.idx()).filter(|entry| entry.0 == self.round).map(|entry| &entry.1)
    }

    #[inline]
    fn insert_in_file(&mut self, at: (FileId, ExprId), answer: T) {
        if at.0 == self.file
            && let Some(entry) = self.of_file.get_mut(at.1.idx())
        {
            *entry = (self.round, answer);
        }
    }
}

struct ParentLinks {
    file: FileId,
    expr_parents: Vec<Parent>,
    stmt_parents: Vec<Parent>,
}

impl Default for ParentLinks {
    fn default() -> ParentLinks {
        ParentLinks { file: FileId(u32::MAX), expr_parents: Vec::new(), stmt_parents: Vec::new() }
    }
}

impl Checker<'_, '_> {
    fn compute_parent_links(&mut self, file: FileId) {
        if self.aot.parent_links.file == file {
            return;
        }
        const NOT_FOUND: Parent = Parent::Expr(ExprId::NONE);
        let bound = self.bound(file);
        let (mut expr_parents, mut stmt_parents) = (std::mem::take(&mut self.aot.parent_links.expr_parents), std::mem::take(&mut self.aot.parent_links.stmt_parents));
        expr_parents.clear();
        expr_parents.resize(bound.expr_parent.len(), NOT_FOUND);
        stmt_parents.clear();
        stmt_parents.resize(bound.stmt_parent.len(), NOT_FOUND);
        let mut passed: Vec<Parent> = Vec::new();
        let expressions = (0..bound.expr_parent.len() as u32).map(|e| Parent::Expr(ExprId(e)));
        let statements = (0..bound.stmt_parent.len() as u32).map(|stmt| Parent::Stmt(StmtId(stmt)));
        for start in statements.rev().chain(expressions.rev()) {
            let above = match start {
                Parent::Expr(e) => bound.expr_parent[e.idx()],
                Parent::Stmt(stmt) => bound.stmt_parent[stmt.idx()],
                _ => NOT_FOUND,
            };
            let known = match above {
                Parent::Expr(e) if e.is_some() => expr_parents[e.idx()],
                Parent::Stmt(stmt) if stmt.is_some() => stmt_parents[stmt.idx()],
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => above,
                _ => NOT_FOUND,
            };
            if known != NOT_FOUND {
                match start {
                    Parent::Expr(e) => expr_parents[e.idx()] = known,
                    Parent::Stmt(stmt) => stmt_parents[stmt.idx()] = known,
                    _ => {}
                }
                continue;
            }
            let mut at = start;
            let found = loop {
                at = match at {
                    Parent::Expr(e) if e.is_some() => {
                        if expr_parents[e.idx()] != NOT_FOUND {
                            break expr_parents[e.idx()];
                        }
                        passed.push(at);
                        bound.expr_parent[e.idx()]
                    }
                    Parent::Stmt(stmt) if stmt.is_some() => {
                        if stmt_parents[stmt.idx()] != NOT_FOUND {
                            break stmt_parents[stmt.idx()];
                        }
                        passed.push(at);
                        bound.stmt_parent[stmt.idx()]
                    }
                    Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => break at,
                    _ => self.parent_of_node(file, at),
                };
            };
            for below in passed.drain(..) {
                match below {
                    Parent::Expr(e) => expr_parents[e.idx()] = found,
                    Parent::Stmt(stmt) => stmt_parents[stmt.idx()] = found,
                    _ => {}
                }
            }
        }
        self.aot.parent_links = ParentLinks { file, expr_parents, stmt_parents };
    }

    #[inline]
    pub(in crate::check) fn translation_cached_call(&self, file: FileId, call: ExprId) -> Option<super::call::ResolvedCall> {
        self.aot.resolved_calls.get_in_file((file, call)).copied()
    }

    #[inline]
    pub(in crate::check) fn cache_call_for_translation(&mut self, file: FileId, call: ExprId, resolved: super::call::ResolvedCall) {
        self.aot.resolved_calls.insert_in_file((file, call), resolved);
    }

    #[inline]
    pub fn expr_parent_link(&self, file: FileId, e: ExprId) -> Parent {
        if file == self.aot.parent_links.file { self.aot.parent_links.expr_parents[e.idx()] } else { self.bound(file).expr_parent[e.idx()] }
    }

    #[inline]
    pub fn stmt_parent_link(&self, file: FileId, stmt: StmtId) -> Parent {
        if file == self.aot.parent_links.file { self.aot.parent_links.stmt_parents[stmt.idx()] } else { self.bound(file).stmt_parent[stmt.idx()] }
    }

    #[inline]
    pub(super) fn cached_symbol_for(&self, file: FileId, e: ExprId, name: Atom) -> Option<Option<Sym>> {
        let retained = &self.aot.symbols_named;
        if file != retained.file {
            return None;
        }
        retained.get((file, e)).filter(|known| known.0 == name).map(|known| known.1)
    }

    #[inline]
    pub(super) fn cache_symbol_for(&mut self, file: FileId, e: ExprId, name: Atom, found: Option<Sym>) {
        if file == self.aot.symbols_named.file {
            self.aot.symbols_named.insert((file, e), (name, found));
        }
    }
}

#[derive(Default)]
pub(super) struct Shared {
    exprs_by_kind: ByFile<ExprsByKind>,
    names_in_code: std::sync::OnceLock<crate::util::FxHashSet<Atom>>,
    max_nesting_depths: ByFile<u32>,
    captures: captures::Shared,
    classes: classes::Shared,
    commonjs: commonjs::Shared,
    escape: escape::Shared,
    flows: flows::Shared,
    identity: identity::Shared,
    integers: integers::Shared,
    javascript: javascript::Shared,
    kinds: kinds::Shared,
    storage: storage::Shared,
    symbols: symbols::Shared,
    type_caches: type_caches::TypeCaches,
    undeclared_fields: undeclared_fields::Shared,
    has_bailed_out: std::sync::atomic::AtomicBool,
}

impl Program<'_> {
    pub fn give_up(&self) {
        self.aot.has_bailed_out.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn has_bailed_out(&self) -> bool {
        self.aot.has_bailed_out.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn release_translation_caches(&self) {
        self.aot.flows.release();
        self.aot.type_caches.release();
        self.aot.captures.release();
    }
}

#[derive(Default)]
pub(super) struct State {
    callees: callees::State,
    captures: captures::State,
    commonjs: commonjs::State,
    creation: creation::State,
    undeclared_fields: undeclared_fields::State,
    escape: escape::State,
    escape_closure: escape_closure::State,
    trust: trust::State,
    flows: flows::State,
    identity: identity::State,
    integers: integers::State,
    kinds: kinds::State,
    mapped_arguments: mapped_arguments::State,
    javascript: javascript::State,
    storage: storage::State,
    is_translating: bool,
    is_after_check: bool,
    symbols_named: ByExpression<(Atom, Option<Sym>)>,
    resolved_calls: ByExpression<super::call::ResolvedCall>,
    parent_links: ParentLinks,
    non_nullable_types: crate::util::FxHashMap<TypeId, TypeId>,
}

impl<'p, 's> Checker<'p, 's> {
    pub fn non_nullable(&mut self, ty: TypeId) -> TypeId {
        if !self.aot.is_translating {
            return self.compute_non_nullable(ty);
        }
        if let Some(&known) = self.aot.non_nullable_types.get(&ty) {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.compute_non_nullable(ty));
        if is_cacheable {
            self.aot.non_nullable_types.insert(ty, found);
        }
        found
    }

    fn file_exprs_by_kind(&self, file: FileId) -> &'p ExprsByKind {
        let program = self.p;
        program.aot.exprs_by_kind.get_or_init(program.files.modules.len(), file, || ExprsByKind::outside(self.hir(file), program.files.module(file).cut))
    }

    pub fn occurs_in_code(&self, name: Atom) -> bool {
        let program = self.p;
        let written = program.aot.names_in_code.get_or_init(|| {
            let mut names = crate::util::FxHashSet::default();
            for file in (0..program.files.modules.len() as u32).map(FileId) {
                let hir = self.hir(file);
                if hir.kind == FileKind::Declaration {
                    continue;
                }
                let cut = program.files.module(file).cut;
                let is_cut = |pos: u32| {
                    let after = cut.partition_point(|range| range.0 <= pos);
                    after != 0 && pos < cut[after - 1].1
                };
                let by_kind = self.file_exprs_by_kind(file);
                for &e in by_kind.of(ExprTag::Dot).iter().chain(by_kind.of(ExprTag::String)) {
                    if let ExprKind::Dot { name, .. } | ExprKind::String(name) = hir[e].kind {
                        names.insert(name);
                    }
                }
                names.extend(hir.props.iter().filter(|prop| !is_cut(prop.pos)).filter_map(|prop| prop.key.name()));
                names.extend(hir.pat_props.iter().filter(|prop| !is_cut(prop.pos)).filter_map(|prop| prop.key.name()));
                for class in hir.classes.iter().filter(|class| !is_cut(class.start)) {
                    names.extend(class.members.iter().filter_map(|member| hir[member].key.name()));
                }
            }
            names
        });
        written.contains(&name)
    }

    pub fn map_slices<T: Sync, R: Send>(&mut self, items: &[T], size: usize, in_parallel: Option<InParallel<'_>>, work: &(dyn Fn(&mut Checker<'p, 's>, &[T]) -> R + Sync)) -> Vec<R> {
        let Some(in_parallel) = in_parallel else { return items.chunks(size).map(|slice| work(self, slice)).collect() };
        let program = self.p;
        let mut slices: Vec<(&[T], Option<R>)> = items.chunks(size).map(|slice| (slice, None)).collect();
        for_each_mut(&mut slices, in_parallel, &|(slice, result)| {
            let mut c = program.checker();
            c.begin_stack_budget();
            let created = work(&mut c, slice);
            *result = (!c.take_ran_out_of_stack() && c.stack_half_used_count() == 0).then_some(created);
        });
        slices.into_iter().map(|(slice, result)| result.unwrap_or_else(|| work(self, slice))).collect()
    }

    pub fn array_subtype_element(&mut self, ty: TypeId) -> Option<TypeId> {
        if !matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Intersection(_)) {
            return None;
        }
        let known = if self.results_are_provisional() { None } else { self.shared_type_flag(ty, type_flags::ARRAY_SUBTYPE_KNOWN, type_flags::IS_ARRAY_SUBTYPE).or_else(|| self.aot.flows.array_subtypes.get(&ty).copied()) };
        let is_array = match known {
            Some(known) => known,
            None => {
                let (found, is_cacheable) = self.compute_cacheable(|c| c.is_array_subtype(ty));
                if is_cacheable && !self.publish_type_flag(ty, type_flags::ARRAY_SUBTYPE_KNOWN, type_flags::IS_ARRAY_SUBTYPE, found) {
                    self.aot.flows.array_subtypes.insert(ty, found);
                }
                found
            }
        };
        if !is_array {
            return None;
        }
        self.index_type_of_type(ty, TypeId::NUMBER)
    }

    fn is_array_subtype(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { .. } => !self.is_array_or_tuple(ty) && !self.is_instance_type(ty) && self.is_array_like(ty),
            TypeData::Intersection(parts) => {
                !parts.iter().any(|&part| self.is_instance_type(part) && self.is_array_like(part))
                    && parts.iter().any(|&part| self.is_array_or_tuple(part) || self.array_subtype_element(part).is_some())
            }
            _ => false,
        }
    }

    pub fn accepts_primitives(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::OBJECT || matches!(self.data(ty), TypeData::Union(_)) {
            return false;
        }
        let by_itself = match self.shared_type_flag(ty, type_flags::ACCEPTS_PRIMITIVES_KNOWN, type_flags::ACCEPTS_PRIMITIVES).or_else(|| self.aot.flows.accepts_primitives_cache.get(&ty).copied()) {
            Some(known) => known,
            None => {
                let (found, is_cacheable) = self.compute_cacheable(|c| c.is_empty_object_type(ty) || ty == c.global_ref(known::Object, &[]) || c.is_mapped_over_possible_primitive(ty));
                if !is_cacheable || !self.publish_type_flag(ty, type_flags::ACCEPTS_PRIMITIVES_KNOWN, type_flags::ACCEPTS_PRIMITIVES, found) {
                    self.aot.flows.accepts_primitives_cache.insert(ty, found);
                }
                found
            }
        };
        by_itself || self.is_tainted(ty)
    }

    pub fn value_bound(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return self.base_constraint(ty);
        }
        if let Some(&known) = self.aot.flows.value_bounds.get(&ty) {
            return known;
        }
        let mut steps_left = MAX_VALUE_BOUND_STEPS;
        let bound = self.bound_through_conditional_types(ty, 0, &mut steps_left);
        let bound = bound.unwrap_or_else(|| self.base_constraint(ty));
        self.aot.flows.value_bounds.insert(ty, bound);
        bound
    }

    pub fn is_base_constraint_too_narrow(&mut self, ty: TypeId) -> bool {
        self.has_type_variables(ty) && self.parts(ty).to_vec().into_iter().any(|part| self.has_type_variables(part) && self.value_bound(part) != self.base_constraint(part))
    }

    fn bound_through_conditional_types(&mut self, ty: TypeId, depth: u8, steps_left: &mut u32) -> Option<TypeId> {
        if !self.has_type_variables(ty) {
            return None;
        }
        if depth > MAX_VALUE_BOUND_DEPTH || *steps_left == 0 {
            return Some(TypeId::UNKNOWN);
        }
        *steps_left -= 1;
        match *self.data(ty) {
            TypeData::Cond { .. } => {
                let arms = [self.cond_true(ty), self.cond_false(ty)];
                let bounds = arms.map(|arm| self.bound_through_conditional_types(arm, depth + 1, steps_left).unwrap_or_else(|| self.base_constraint(arm)));
                Some(self.union(&bounds))
            }
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::IndexedAccess { .. } => {
                let constraint = self.constraint_of(ty).filter(|&constraint| constraint != ty)?;
                self.bound_through_conditional_types(constraint, depth + 1, steps_left)
            }
            TypeData::Substitution { base, constraint } => {
                let (of_base, of_constraint) = (self.bound_through_conditional_types(base, depth + 1, steps_left), self.bound_through_conditional_types(constraint, depth + 1, steps_left));
                if of_base.is_none() && of_constraint.is_none() {
                    return None;
                }
                let of_base = of_base.unwrap_or_else(|| self.base_constraint(base));
                Some(if of_base == TypeId::UNKNOWN { of_constraint.unwrap_or_else(|| self.base_constraint(constraint)) } else { of_base })
            }
            TypeData::Union(ref parts) => {
                let found: Vec<Option<TypeId>> = parts.iter().map(|&part| self.bound_through_conditional_types(part, depth + 1, steps_left)).collect();
                if found.iter().all(Option::is_none) {
                    return None;
                }
                let bounds: Vec<TypeId> = found.into_iter().zip(parts.iter()).map(|(bound, &part)| bound.unwrap_or_else(|| self.base_constraint(part))).collect();
                Some(self.union(&bounds))
            }
            TypeData::Intersection(ref parts) => parts.iter().any(|&part| self.bound_through_conditional_types(part, depth + 1, steps_left).is_some()).then_some(TypeId::UNKNOWN),
            _ => None,
        }
    }

    fn is_mapped_over_possible_primitive(&mut self, ty: TypeId) -> bool {
        let TypeData::Anon { origin: Origin::Mapped(file, node), mapper } = *self.data(ty) else { return false };
        let Some(variable) = self.homomorphic_type_variable(file, node, MapperId::IDENTITY) else { return false };
        let source = self.instantiate(variable, mapper);
        if !self.is_instantiable(source) {
            return self.is_mapped_over_possible_primitive(source);
        }
        let bound = self.value_bound(source);
        let parts = match self.data(bound) {
            TypeData::Union(parts) => parts.to_vec(),
            _ => vec![bound],
        };
        parts.into_iter().any(|part| part == TypeId::UNKNOWN || part.is_any() || self.flags(part) & tf::PRIMITIVE != 0 || self.is_empty_object_type(part))
    }

    pub(in crate::check) fn base_constraint_within_budget(&mut self, ty: TypeId) -> Option<TypeId> {
        if self.fuel.get() != u64::MAX {
            return self.resolved_base_constraint_without_budget(ty);
        }
        if self.aot.flows.constraints_not_known.contains(&ty) {
            self.aot.flows.unknown_count += 1;
            return None;
        }
        let had_stack_overflow = self.ran_out_of_stack.get();
        self.fuel.set(FUEL);
        let constraint = self.resolved_base_constraint_without_budget(ty);
        let left = self.fuel.replace(u64::MAX);
        if left != 0 {
            return constraint;
        }
        self.ran_out_of_stack.set(had_stack_overflow);
        self.aot.flows.unknown_count += 1;
        self.aot.flows.constraints_not_known.insert(ty);
        None
    }

    pub fn is_provably_assignable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_provably_related(source, target, Relation::Assignable)
    }

    fn is_provably_related(&mut self, source: TypeId, target: TypeId, relation: Relation) -> bool {
        let source = if source != target && self.is_base_constraint_too_narrow(source) {
            let bound = self.map_type(source, |c, part| if c.has_type_variables(part) { c.value_bound(part) } else { part });
            if bound.is_any() { TypeId::UNKNOWN } else { bound }
        } else {
            source
        };
        if self.aot.flows.truncated.contains(&(source, target, relation as u8)) {
            self.aot.flows.unknown_count += 1;
            return false;
        }
        let (cuts, fuel) = (self.cuts(), self.fuel.get());
        let is_kept = fuel == u64::MAX && !self.results_are_provisional();
        if is_kept && let Some(&known) = self.aot.flows.provably_related.get(&(source, target, relation as u8)) {
            return known;
        }
        let was_too_complex = self.relation_too_complex;
        let had_stack_overflow = self.ran_out_of_stack.get();
        let maximum = fuel.min(FUEL);
        self.fuel.set(maximum);
        let is_related = self.related(source, target, relation);
        let burnt = maximum - self.fuel.get();
        self.fuel.set(if fuel == u64::MAX { fuel } else { fuel - burnt });
        if self.cuts() != cuts {
            self.ran_out_of_stack.set(had_stack_overflow);
            self.aot.flows.unknown_count += 1;
            self.aot.flows.truncated.insert((source, target, relation as u8));
            return false;
        }
        if is_kept && self.relation_too_complex == was_too_complex {
            self.aot.flows.provably_related.insert((source, target, relation as u8), is_related);
        }
        is_related
    }

    pub fn truncated_queries(&self) -> Vec<(TypeId, TypeId, u8)> {
        self.aot.flows.truncated.iter().copied().filter(|query| !query.is_local()).collect()
    }

    pub fn set_truncated_queries(&mut self, queries: &[(TypeId, TypeId, u8)]) {
        self.aot.flows.truncated.extend(queries.iter().copied());
    }

    pub fn is_uninformative(&self, ty: TypeId) -> bool {
        ty.is_any() || ty.is_never() || matches!(ty, TypeId::UNKNOWN | TypeId::VOID | TypeId::UNRESOLVED)
    }
}
