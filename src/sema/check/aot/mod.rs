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
mod mapped_arguments;
mod sloppy;
mod storage;
mod subtypes;
mod trust;
mod undeclared_fields;

pub use callees::{Callee, Hole, OnlyFunction};
pub use captures::{Activation, Capture, CapturedVariable, DeclaredClosure, NotCopied, Receiver};
pub use escape::argument_use;
pub use classes::{ClassFacts, MethodStore, ReplacedMethods};
pub use commonjs::{CommonJsExports, ExportsMention};
pub use first_stores::FirstStore;
pub use identity::Identity;
pub use int32_fields::{Contrary, FlowNode, FlowSource, Int32Verdict, NumberFlow, RunBy, expected_int32};
pub use javascript::CodeOfImport;
pub use kinds::kind;
pub use flows::{Answer, BuiltIn, Candidate, GaveUp, Literal, Meeting, Membership, Noted, OriginOfData, Place, Question, Reach, Share, WhyForeign};
pub use subtypes::{Cause, FieldTypes, Sizes, Subtypes};
pub use storage::{Evaluates, Primitive, Recovery, ReferenceRead, Storage};
pub use trust::{Claim, is_builtin_of_the_engine, is_locked_global_of_the_engine};

use super::{Checker, Program};
use super::relate::Relation;
use crate::atom::known;
use crate::bind::Parent;
use crate::hir::ExprsByKind;
use crate::local::MaybeLocal;
use crate::program::FileId;
use crate::types::{TypeData, TypeId};
use crate::util::{InParallel, for_each_mut};

const DEEPEST_NEST_OF_A_TASK: u32 = 1000;
const STACK_OF_A_LEVEL: usize = 16 << 10;
const MOST_STACK_FOR_A_NEST: usize = 2 << 30;

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
    pub fn stack_beyond_that_of_a_task(&self, files: &[FileId]) -> usize {
        let deepest = files.iter().map(|&file| self.deepest_nest(file)).max().unwrap_or(0);
        if deepest <= DEEPEST_NEST_OF_A_TASK { 0 } else { (deepest as usize * STACK_OF_A_LEVEL).min(MOST_STACK_FOR_A_NEST) }
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
const FUEL: u64 = 1 << 16;

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

    fn set_for_warming_up(&self, value: T) {
        let _ = self.made_while_warming_up.set(Box::new(value));
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn while_warming_up<R>(&mut self, work: impl FnOnce(&mut Checker<'p, 's>) -> R) -> R {
        let kept = std::mem::take(&mut self.aot);
        IS_WARMING_UP.set(true);
        let result = work(self);
        IS_WARMING_UP.set(false);
        self.aot = kept;
        result
    }

    pub fn is_warming_up(&self) -> bool {
        IS_WARMING_UP.get()
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

/// What holds for every checker of the program, a field for each part of this module that has such. It belongs to the program: it
/// mentions no type, nor anything else that is numbered by task. Each table is made once and is only read from then on. Whoever asks
/// first makes what follows from the trees and the symbols alone. Whoever sets the program up says what is for the bundler to say.
/// What takes types to find is noted file by file, by the task that has them, and put together when no task is running.
#[derive(Default)]
pub(super) struct Shared {
    /// `exprs_by_kind_of`
    exprs_by_kind: ByFile<ExprsByKind>,
    deepest_nests: ByFile<u32>,
    classes: classes::Shared,
    commonjs: commonjs::Shared,
    escape: escape::Shared,
    integers: integers::Shared,
    javascript: javascript::Shared,
    storage: storage::Shared,
    undeclared_fields: undeclared_fields::Shared,
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
}

impl<'p, 's> Checker<'p, 's> {
    /// `exprs_by_kind`, for a file that need not be the one the task is at. That keeps the index of one file. This one stays.
    fn exprs_by_kind_of(&self, file: FileId) -> &'p ExprsByKind {
        let program = self.p;
        program.aot.exprs_by_kind.get_or_init(program.files.modules.len(), file, || ExprsByKind::new(self.hir(file)))
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
        let is_array = match self.data(ty) {
            TypeData::Ref { .. } => !self.is_array_or_tuple(ty) && !self.is_type_of_instances(ty) && self.is_array_like(ty),
            TypeData::Intersection(parts) => {
                !parts.iter().any(|&part| self.is_type_of_instances(part) && self.is_array_like(part))
                    && parts.iter().any(|&part| self.is_array_or_tuple(part) || self.element_of_array_subtype(part).is_some())
            }
            _ => false,
        };
        if !is_array {
            return None;
        }
        self.index_type_of_type(ty, TypeId::NUMBER)
    }

    /// `any`, `unknown`, `never`, `void`: no value is known for what it is by it.
    /// `{}`, `Object`, an interface without members: a string or a number is one as well. `object` is not meant.
    /// A type that data from outside the program is looked at as: whatever the data holds is there.
    pub fn admits_primitives(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::OBJECT || matches!(self.data(ty), TypeData::Union(_)) {
            return false;
        }
        let by_itself = match self.aot.flows.takes_primitives_by_itself.get(&ty) {
            Some(&known) => known,
            None => {
                let found = self.is_empty_object_type(ty) || ty == self.global_ref(known::Object, &[]);
                self.aot.flows.takes_primitives_by_itself.insert(ty, found);
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
