//! What ahead-of-time compilation asks of the types beyond what checking does.

mod alterations;
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
mod first_stores;
mod flows;
pub mod given;
mod identity;
mod int32_fields;
mod integers;
mod javascript;
mod kinds;
mod libraries;
pub mod locked_builtins;
mod locked_builtins_generated;
mod mapped_arguments;
mod overrides;
mod reported_by_lint;
mod rows;
mod sloppy;
mod storage;
mod subtypes;
mod trust;
mod undeclared_fields;

pub use callees::{Callee, OnlyFunction};
pub use captures::{Activation, Capture, CapturedVariable, DeclaredClosure, NotCopied, Receiver};
pub use escape::argument_use;
pub use classes::{ClassFacts, MethodStore, ReplacedMethods};
pub use commonjs::{CommonJsExports, ExportsMention};
pub use first_stores::FirstStore;
pub use identity::Identity;
pub use int32_fields::{Contrary, FlowNode, FlowSource, Int32Verdict, NumberFlow, RunBy, expected_int32};
pub use javascript::CodeOfImport;
pub use kinds::kind;
pub use flows::{Answer, BuiltIn, Candidate, GaveUp, KindsDeclared, Literal, Meeting, Membership, Noted, OriginOfData, Place, Question, Reach, Share, WhyForeign};
pub use subtypes::{Cause, FieldTypes, OpensForTheLog, Sizes, Subtypes};
pub use storage::{Evaluates, Primitive, Recovery, ReferenceRead, Storage};
pub use reported_by_lint::{AotCheck, AotCheckKind};
pub use trust::{Claim, is_global_of_the_engine};

use super::{Checker, Program};
use super::relate::Relation;
use crate::atom::{Atom, known};
use crate::bind::Parent;
use crate::hir::{ExprId, ExprKind, ExprTag, ExprsByKind, FileKind, StmtId};
use crate::local::MaybeLocal;
use crate::program::{FileId, Sym};
use crate::types::{TypeData, TypeId};
use crate::util::{InParallel, for_each_mut};

const DEEPEST_NEST_OF_A_TASK: u32 = 1000;
const STACK_OF_A_LEVEL: usize = 16 << 10;
const MAX_STACK_FOR_A_NEST: usize = 2 << 30;

fn longest_chain(parents: &[Parent], above: impl Fn(Parent) -> Option<usize>) -> u32 {
    if parents.len() <= DEEPEST_NEST_OF_A_TASK as usize / 2 {
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
    pub fn extra_stack_beyond_task(&self, files: &[FileId]) -> usize {
        let deepest = files.iter().map(|&file| self.deepest_nest(file)).max().unwrap_or(0);
        if deepest <= DEEPEST_NEST_OF_A_TASK { 0 } else { (deepest as usize * STACK_OF_A_LEVEL).min(MAX_STACK_FOR_A_NEST) }
    }

    fn deepest_nest(&self, file: FileId) -> u32 {
        *self.aot.deepest_nests.get_or_init(self.files.modules.len(), file, || {
            let bound = self.files.bound(file);
            let of_expressions = longest_chain(&bound.expr_parent, |parent| if let Parent::Expr(above) = parent { above.is_some().then(|| above.idx()) } else { None });
            let of_statements = longest_chain(&bound.stmt_parent, |parent| if let Parent::Stmt(above) = parent { above.is_some().then(|| above.idx()) } else { None });
            of_expressions + of_statements
        })
    }
}

/// What `Checker::is_provably_assignable` may make before it gives up.
const FUEL: u64 = 1 << 14;

thread_local! {
    static IS_WARMING_UP: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct OnceLock<T> {
    made: std::sync::OnceLock<T>,
    made_while_warming_up: std::sync::OnceLock<Box<T>>,
}

impl<T> Default for OnceLock<T> {
    fn default() -> OnceLock<T> {
        OnceLock::new()
    }
}

impl<T> OnceLock<T> {
    const fn new() -> OnceLock<T> {
        OnceLock { made: std::sync::OnceLock::new(), made_while_warming_up: std::sync::OnceLock::new() }
    }

    fn get(&self) -> Option<&T> {
        match self.made.get() {
            None if IS_WARMING_UP.get() => self.made_while_warming_up.get().map(|made| &**made),
            made => made,
        }
    }

    fn get_or_init(&self, make: impl FnOnce() -> T) -> &T {
        match self.made.get() {
            Some(made) => made,
            None if IS_WARMING_UP.get() => self.made_while_warming_up.get_or_init(|| Box::new(make())),
            None => self.made.get_or_init(make),
        }
    }

    fn set(&self, value: T) -> Result<(), T> {
        match IS_WARMING_UP.get() {
            true => self.made_while_warming_up.set(Box::new(value)).map_err(|value| *value),
            false => self.made.set(value),
        }
    }

    fn is_made_for_good(&self) -> bool {
        self.made.get().is_some()
    }

    fn set_for_warming_up(&self, value: T) {
        let _ = self.made_while_warming_up.set(Box::new(value));
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn while_warming_up<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let kept = std::mem::take(&mut self.aot);
        let kept_by_translator = self.translator.take();
        IS_WARMING_UP.set(true);
        let result = work(self);
        IS_WARMING_UP.set(false);
        let compared = self.aot.flows.take_pairs_compared();
        self.aot = kept;
        self.translator = kept_by_translator;
        self.aot.flows.add_pairs_compared(compared);
        result
    }

    pub fn is_warming_up(&self) -> bool {
        IS_WARMING_UP.get()
    }

    pub fn has_answers_that_depend_on_order(&self) -> bool {
        !self.task.listings.is_empty() || self.task.order_dependent_variances.iter().any(|it| it.compared | it.failed | it.inferred != 0)
    }

    pub fn while_translating<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let before = std::mem::replace(&mut self.aot.is_translating, true);
        let result = work(self);
        self.aot.is_translating = before;
        result
    }

    pub fn while_translating_behind_the_check<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let before = std::mem::replace(&mut self.aot.is_behind_the_check, true);
        let result = self.while_translating(work);
        self.aot.is_behind_the_check = before;
        result
    }

    pub(in crate::check) fn is_translating(&self) -> bool {
        self.aot.is_translating
    }

    pub(in crate::check) fn is_behind_the_check(&self) -> bool {
        self.aot.is_behind_the_check
    }

    pub(in crate::check) fn asks_out_of_order(&self) -> bool {
        self.aot.is_translating || self.is_searching_from_doors()
    }
}

/// A table by file. Each entry is made once, by whoever asks for it first, and is only read from then on. What is in it follows from
/// the trees and the symbols alone, so that it does not matter who that is.
struct ByFile<T>(OnceLock<Box<[OnceLock<T>]>>);

impl<T> Default for ByFile<T> {
    fn default() -> ByFile<T> {
        ByFile(OnceLock::new())
    }
}

impl<T> ByFile<T> {
    /// `files`: how many the program has.
    fn get_or_init(&self, files: usize, file: FileId, make: impl FnOnce() -> T) -> &T {
        self.0.get_or_init(|| (0..files).map(|_| OnceLock::new()).collect())[file.idx()].get_or_init(make)
    }
}

struct ByExpression<T> {
    file: FileId,
    round: u32,
    of_file: Vec<(u32, T)>,
    of_other_files: crate::util::FxHashMap<(FileId, ExprId), T>,
}

impl<T> Default for ByExpression<T> {
    fn default() -> ByExpression<T> {
        ByExpression { file: FileId(u32::MAX), round: 1, of_file: Vec::new(), of_other_files: Default::default() }
    }
}

impl<T: Copy> ByExpression<T> {
    fn turn_to(&mut self, file: FileId, expressions: usize, blank: T) {
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
            return self.of_other_files.get(&at);
        }
        self.of_file.get(at.1.idx()).filter(|entry| entry.0 == self.round).map(|entry| &entry.1)
    }

    #[inline]
    fn insert(&mut self, at: (FileId, ExprId), answer: T) {
        match self.of_file.get_mut(at.1.idx()) {
            Some(entry) if at.0 == self.file => *entry = (self.round, answer),
            _ => {
                self.of_other_files.insert(at, answer);
            }
        }
    }

    fn clear(&mut self) {
        self.round += 1;
        self.of_other_files.clear();
    }
}

struct WaysUp {
    file: FileId,
    from_expressions: Vec<Parent>,
    from_statements: Vec<Parent>,
}

impl Default for WaysUp {
    fn default() -> WaysUp {
        WaysUp { file: FileId(u32::MAX), from_expressions: Vec::new(), from_statements: Vec::new() }
    }
}

impl Checker<'_, '_> {
    fn find_ways_up_in(&mut self, file: FileId) {
        if self.aot.ways_up.file == file {
            return;
        }
        const NOT_FOUND: Parent = Parent::Expr(ExprId::NONE);
        let bound = self.bound(file);
        let (mut from_expressions, mut from_statements) = (std::mem::take(&mut self.aot.ways_up.from_expressions), std::mem::take(&mut self.aot.ways_up.from_statements));
        from_expressions.clear();
        from_expressions.resize(bound.expr_parent.len(), NOT_FOUND);
        from_statements.clear();
        from_statements.resize(bound.stmt_parent.len(), NOT_FOUND);
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
                Parent::Expr(e) if e.is_some() => from_expressions[e.idx()],
                Parent::Stmt(stmt) if stmt.is_some() => from_statements[stmt.idx()],
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => above,
                _ => NOT_FOUND,
            };
            if known != NOT_FOUND {
                match start {
                    Parent::Expr(e) => from_expressions[e.idx()] = known,
                    Parent::Stmt(stmt) => from_statements[stmt.idx()] = known,
                    _ => {}
                }
                continue;
            }
            let mut at = start;
            let found = loop {
                at = match at {
                    Parent::Expr(e) if e.is_some() => {
                        if from_expressions[e.idx()] != NOT_FOUND {
                            break from_expressions[e.idx()];
                        }
                        passed.push(at);
                        bound.expr_parent[e.idx()]
                    }
                    Parent::Stmt(stmt) if stmt.is_some() => {
                        if from_statements[stmt.idx()] != NOT_FOUND {
                            break from_statements[stmt.idx()];
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
                    Parent::Expr(e) => from_expressions[e.idx()] = found,
                    Parent::Stmt(stmt) => from_statements[stmt.idx()] = found,
                    _ => {}
                }
            }
        }
        self.aot.ways_up = WaysUp { file, from_expressions, from_statements };
    }

    #[inline]
    pub fn way_up_from_expression(&self, file: FileId, e: ExprId) -> Parent {
        if file == self.aot.ways_up.file { self.aot.ways_up.from_expressions[e.idx()] } else { self.bound(file).expr_parent[e.idx()] }
    }

    #[inline]
    pub fn way_up_from_statement(&self, file: FileId, stmt: StmtId) -> Parent {
        if file == self.aot.ways_up.file { self.aot.ways_up.from_statements[stmt.idx()] } else { self.bound(file).stmt_parent[stmt.idx()] }
    }

    #[inline]
    pub(super) fn symbol_kept_for(&self, file: FileId, e: ExprId, name: Atom) -> Option<Option<Sym>> {
        let kept = &self.aot.symbols_named;
        if file != kept.file {
            return None;
        }
        kept.get((file, e)).filter(|known| known.0 == name).map(|known| known.1)
    }

    #[inline]
    pub(super) fn keep_symbol_for(&mut self, file: FileId, e: ExprId, name: Atom, found: Option<Sym>) {
        if file == self.aot.symbols_named.file {
            self.aot.symbols_named.insert((file, e), (name, found));
        }
    }
}

/// What holds for every checker of the program, a field for each part of this module that has such. It belongs to the program: it
/// mentions no type, nor anything else that is numbered by task. Each table is made once and is only read from then on. Whoever asks
/// first makes what follows from the trees and the symbols alone. Whoever sets the program up says what is for the bundler to say.
/// What takes types to find is noted file by file, by the task that has them, and put together when no task is running.
#[derive(Default)]
pub(super) struct Shared {
    /// `exprs_by_kind_of`
    exprs_by_kind: ByFile<ExprsByKind>,
    names_written_in_code: std::sync::OnceLock<crate::util::FxHashSet<Atom>>,
    deepest_nests: ByFile<u32>,
    classes: classes::Shared,
    commonjs: commonjs::Shared,
    escape: escape::Shared,
    identity: identity::Shared,
    integers: integers::Shared,
    javascript: javascript::Shared,
    kinds: kinds::Shared,
    overrides: overrides::Shared,
    storage: storage::Shared,
    undeclared_fields: undeclared_fields::Shared,
    is_given_up: std::sync::atomic::AtomicBool,
}

impl Program<'_> {
    pub fn give_up(&self) {
        self.aot.is_given_up.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn is_given_up(&self) -> bool {
        self.aot.is_given_up.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// What the queries of this module have found so far, a field for each part of it. It belongs to a checker.
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
    is_behind_the_check: bool,
    symbols_named: ByExpression<(Atom, Option<Sym>)>,
    ways_up: WaysUp,
}

impl<'p, 's> Checker<'p, 's> {
    /// `exprs_by_kind`, for a file that need not be the one the task is at. That keeps the index of one file. This one stays.
    fn exprs_by_kind_of(&self, file: FileId) -> &'p ExprsByKind {
        let program = self.p;
        program.aot.exprs_by_kind.get_or_init(program.files.modules.len(), file, || ExprsByKind::outside(self.hir(file), program.files.module(file).cut))
    }

    pub fn is_written_in_code(&self, name: Atom) -> bool {
        let program = self.p;
        let written = program.aot.names_written_in_code.get_or_init(|| {
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
                let by_kind = self.exprs_by_kind_of(file);
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

    pub fn in_slices<T: Sync, R: Send>(&mut self, items: &[T], size: usize, in_parallel: Option<InParallel<'_>>, work: &(dyn Fn(&mut Checker<'p, 's>, &[T]) -> R + Sync)) -> Vec<R> {
        let Some(in_parallel) = in_parallel else { return items.chunks(size).map(|slice| work(self, slice)).collect() };
        let program = self.p;
        let mut slices: Vec<(&[T], Option<R>)> = items.chunks(size).map(|slice| (slice, None)).collect();
        for_each_mut(&mut slices, in_parallel, &|(slice, result)| {
            let mut c = program.checker();
            c.begin_stack_budget();
            let made = work(&mut c, slice);
            *result = (!c.take_ran_out_of_stack() && c.times_half_of_stack_was_in_use() == 0).then_some(made);
        });
        slices.into_iter().map(|(slice, result)| result.unwrap_or_else(|| work(self, slice))).collect()
    }

    /// Of an interface that extends `Array` or `ReadonlyArray`, such as `NodeArray<T>`, and of an intersection with an array, a tuple or
    /// such an interface, `number[] & { tag: string }`: the type of the elements. Its objects are arrays that have been given more
    /// properties. Not of a class that extends `Array`, nor of an intersection with one: what such a class makes has another prototype,
    /// where it may find other methods, and the engine does not take it for an array.
    pub fn element_of_array_subtype(&mut self, ty: TypeId) -> Option<TypeId> {
        if !matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Intersection(_)) {
            return None;
        }
        let known = if self.answers_are_provisional() { None } else { self.aot.flows.array_subtypes.get(&ty).copied() };
        let is_array = match known {
            Some(known) => known,
            None => {
                let (found, is_cacheable) = self.compute_cacheable(|c| c.is_array_subtype(ty));
                if is_cacheable {
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
            TypeData::Ref { .. } => !self.is_array_or_tuple(ty) && !self.is_type_of_instances(ty) && self.is_array_like(ty),
            TypeData::Intersection(parts) => {
                !parts.iter().any(|&part| self.is_type_of_instances(part) && self.is_array_like(part))
                    && parts.iter().any(|&part| self.is_array_or_tuple(part) || self.element_of_array_subtype(part).is_some())
            }
            _ => false,
        }
    }

    /// `any`, `unknown`, `never`, `void`: no value is known for what it is by it.
    /// `{}`, `Object`, an interface without members: a string or a number is one as well. `object` is not meant.
    /// A type that data from outside the program is looked at as: whatever the data holds is there.
    pub fn admits_primitives(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::OBJECT || matches!(self.data(ty), TypeData::Union(_)) {
            return false;
        }
        let by_itself = match self.aot.flows.accepts_primitives_itself.get(&ty) {
            Some(&known) => known,
            None => {
                let found = self.is_empty_object_type(ty) || ty == self.global_ref(known::Object, &[]);
                self.aot.flows.accepts_primitives_itself.insert(ty, found);
                found
            }
        };
        by_itself || self.is_tainted(ty)
    }

    /// `is_assignable`, for a question that checking the program need not have asked, and whose answer only saves something. `false` also
    /// where it is not known: where the checker has run into one of its limits, behind which is the error type, to which everything
    /// is assignable. `e as T[K]`: to be assignable to `T[K]` is to be assignable to all values of `T` at once, an intersection that is
    /// distributed over those that are unions. TypeScript builds up to 100,000 of them, each with members of its own.
    ///
    /// TypeScript's limits end every question, after minutes and gigabytes. This one may make `FUEL` things, see `burn`.
    pub fn is_provably_assignable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_provably_related(source, target, Relation::Assignable)
    }

    /// The same for any relation.
    fn is_provably_related(&mut self, source: TypeId, target: TypeId, relation: Relation) -> bool {
        if self.aot.flows.cut_short.contains(&(source, target, relation as u8)) {
            self.aot.flows.times_not_known += 1;
            return false;
        }
        let (cuts, fuel) = (self.cuts(), self.fuel.get());
        let is_kept = fuel == u64::MAX && !self.answers_are_provisional();
        if is_kept && let Some(&known) = self.aot.flows.provably_related.get(&(source, target, relation as u8)) {
            return known;
        }
        let was_too_complex = self.relation_too_complex;
        let had_run_out_of_stack = self.ran_out_of_stack.get();
        let most = fuel.min(FUEL);
        self.fuel.set(most);
        let is_related = self.related(source, target, relation);
        let burnt = most - self.fuel.get();
        self.fuel.set(if fuel == u64::MAX { fuel } else { fuel - burnt });
        if self.cuts() != cuts {
            self.ran_out_of_stack.set(had_run_out_of_stack);
            self.aot.flows.times_not_known += 1;
            self.aot.flows.cut_short.insert((source, target, relation as u8));
            return false;
        }
        if is_kept && self.relation_too_complex == was_too_complex {
            self.aot.flows.provably_related.insert((source, target, relation as u8), is_related);
        }
        is_related
    }

    pub fn questions_cut_short(&self) -> Vec<(TypeId, TypeId, u8)> {
        self.aot.flows.cut_short.iter().copied().filter(|question| !question.is_local()).collect()
    }

    pub fn know_questions_cut_short(&mut self, questions: &[(TypeId, TypeId, u8)]) {
        self.aot.flows.cut_short.extend(questions.iter().copied());
    }

    pub fn says_nothing(&self, ty: TypeId) -> bool {
        ty.is_any() || ty.is_never() || matches!(ty, TypeId::UNKNOWN | TypeId::VOID | TypeId::UNRESOLVED)
    }
}
