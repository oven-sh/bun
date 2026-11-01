use std::cell::{Cell, RefCell};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::collections::{FxHashMap as HashMap, FxHashSet as HashSet, IdBitSet, IdMap};

use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, ErrorCategory, SourceLocation,
};
use crate::hir::environment::Environment;
use crate::hir::object_shape::HookKind;
use crate::hir::visitors::{self, pattern_operands, terminal_operands};
use crate::hir::{
    AliasingEffect, BlockId, HirFunction, Identifier, IdentifierId, InstructionValue, Place,
    PrimitiveValue, PropertyLiteral, Terminal, Type, UnaryOperator,
};

const ERROR_DESCRIPTION: &str = "React refs are values that are not needed for rendering. \
    Refs should only be accessed outside of render, such as in event handlers or effects. \
    Accessing a ref value (the `current` property) during render can cause your component \
    not to update as expected (https://react.dev/reference/react/useRef)";

// --- RefId ---

type RefId = u32;

// --- RefAccessType / RefAccessRefType / RefFnType ---

/// Corresponds to TS `RefAccessType`.
///
/// PartialEq matches the TS `tyEqual` semantics: Ref ignores ref_id,
/// RefValue compares loc but ignores ref_id. This is critical for fixpoint
/// convergence — join creates fresh ref_ids, and comparing them would
/// prevent the environment from stabilizing.
#[derive(Debug, Clone)]
enum RefAccessType {
    None,
    Nullable,
    Guard {
        ref_id: RefId,
    },
    Ref {
        ref_id: RefId,
    },
    RefValue {
        loc: Option<SourceLocation>,
        ref_id: Option<RefId>,
    },
    Structure {
        value: Option<Rc<RefAccessRefType>>,
        fn_type: Option<RefFnType>,
    },
}

impl PartialEq for RefAccessType {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        match (self.view(), other.view()) {
            (a @ View::Structure(..), b @ View::Structure(..)) => are_equal(a, b),
            (a, b) => are_equal_leaves(a, b),
        }
    }
}

impl Eq for RefAccessType {}

/// Corresponds to TS `RefAccessRefType` — the subset of `RefAccessType` that can appear
/// inside `Structure.value` and be joined via `join_ref_access_ref_types`.
///
/// PartialEq mirrors RefAccessType: Ref ignores ref_id, RefValue compares
/// loc only.
#[derive(Debug, Clone)]
enum RefAccessRefType {
    Ref {
        ref_id: RefId,
    },
    RefValue {
        loc: Option<SourceLocation>,
        ref_id: Option<RefId>,
    },
    Structure {
        value: Option<Rc<RefAccessRefType>>,
        fn_type: Option<RefFnType>,
    },
}

impl PartialEq for RefAccessRefType {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        match (self.view(), other.view()) {
            (a @ View::Structure(..), b @ View::Structure(..)) => are_equal(a, b),
            (a, b) => are_equal_leaves(a, b),
        }
    }
}

impl Eq for RefAccessRefType {}

#[derive(Debug, Clone)]
struct RefFnType {
    read_ref_effect: bool,
    /// Where the first error in the function is, and whether that is about an update.
    access: Option<(SourceLocation, bool)>,
    return_type: Rc<RefAccessType>,
}

/// Either of the two types.
#[derive(Clone, Copy)]
enum View<'a> {
    None,
    Nullable,
    Guard(RefId),
    Ref(RefId),
    RefValue(&'a Option<SourceLocation>, Option<RefId>),
    Structure(&'a Option<Rc<RefAccessRefType>>, &'a Option<RefFnType>),
}

trait Viewed {
    fn view(&self) -> View<'_>;
}

impl Viewed for RefAccessType {
    #[inline]
    fn view(&self) -> View<'_> {
        match self {
            RefAccessType::None => View::None,
            RefAccessType::Nullable => View::Nullable,
            RefAccessType::Guard { ref_id } => View::Guard(*ref_id),
            RefAccessType::Ref { ref_id } => View::Ref(*ref_id),
            RefAccessType::RefValue { loc, ref_id } => View::RefValue(loc, *ref_id),
            RefAccessType::Structure { value, fn_type } => View::Structure(value, fn_type),
        }
    }
}

impl Viewed for RefAccessRefType {
    #[inline]
    fn view(&self) -> View<'_> {
        match self {
            RefAccessRefType::Ref { ref_id } => View::Ref(*ref_id),
            RefAccessRefType::RefValue { loc, ref_id } => View::RefValue(loc, *ref_id),
            RefAccessRefType::Structure { value, fn_type } => View::Structure(value, fn_type),
        }
    }
}

// Statements in a row nest these types, a level a statement (`o1 = {a: o0}`), and nothing asks the stack
// meanwhile. So what goes through one goes level by level, and does not call itself.

/// TS `tyEqual`, where not both are a `Structure`.
#[inline]
fn are_equal_leaves(a: View<'_>, b: View<'_>) -> bool {
    match (a, b) {
        (View::None, View::None)
        | (View::Nullable, View::Nullable)
        | (View::Ref(_), View::Ref(_)) => true,
        (View::Guard(a), View::Guard(b)) => a == b,
        (View::RefValue(a, _), View::RefValue(b, _)) => a == b,
        _ => false,
    }
}

/// TS `tyEqual`
fn are_equal<'a>(mut a: View<'a>, mut b: View<'a>) -> bool {
    let mut others: SmallVec<[(View<'a>, View<'a>); 2]> = SmallVec::new();
    loop {
        match (a, b) {
            (View::Structure(a_value, a_fn), View::Structure(b_value, b_fn)) => {
                match (a_value, b_value) {
                    (None, None) => {}
                    (Some(a), Some(b)) if Rc::ptr_eq(a, b) => {}
                    (Some(a), Some(b)) => others.push((a.view(), b.view())),
                    _ => return false,
                }
                match (a_fn, b_fn) {
                    (None, None) => {}
                    (Some(a), Some(b)) if a.read_ref_effect != b.read_ref_effect => return false,
                    (Some(a), Some(b)) if Rc::ptr_eq(&a.return_type, &b.return_type) => {}
                    (Some(a), Some(b)) => others.push((a.return_type.view(), b.return_type.view())),
                    _ => return false,
                }
            }
            _ if are_equal_leaves(a, b) => {}
            _ => return false,
        }
        match others.pop() {
            Some(next) => (a, b) = next,
            None => return true,
        }
    }
}

/// The one can stand for the other: the ids are the same too, and what they hold is shared.
fn is_the_same(a: View<'_>, b: View<'_>) -> bool {
    match (a, b) {
        (View::None, View::None) | (View::Nullable, View::Nullable) => true,
        (View::Guard(a), View::Guard(b)) | (View::Ref(a), View::Ref(b)) => a == b,
        (View::RefValue(a_loc, a), View::RefValue(b_loc, b)) => a_loc == b_loc && a == b,
        (View::Structure(a_value, a_fn), View::Structure(b_value, b_fn)) => {
            let is_same_value = match (a_value, b_value) {
                (None, None) => true,
                (Some(a), Some(b)) => Rc::ptr_eq(a, b),
                _ => false,
            };
            is_same_value
                && match (a_fn, b_fn) {
                    (None, None) => true,
                    (Some(a), Some(b)) => {
                        a.read_ref_effect == b.read_ref_effect
                            && Rc::ptr_eq(&a.return_type, &b.return_type)
                    }
                    _ => false,
                }
        }
        _ => false,
    }
}

/// `joined`, which comes from `a` and `b`, behind a pointer: theirs, if it came out as one of them. Then the next
/// join with it, and `==`, see that by the pointer and do not go down.
fn kept<T: Viewed>(joined: T, a: &Rc<T>, b: &Rc<T>) -> Rc<T> {
    if is_the_same(joined.view(), b.view()) {
        Rc::clone(b)
    } else if is_the_same(joined.view(), a.view()) {
        Rc::clone(a)
    } else {
        Rc::new(joined)
    }
}

enum Held {
    Value(Rc<RefAccessRefType>),
    Returned(Rc<RefAccessType>),
}

/// Whether to drop it is to drop something that holds something in its turn.
fn is_last_of_more<T: Viewed>(it: &Rc<T>) -> bool {
    Rc::strong_count(it) == 1
        && matches!(it.view(), View::Structure(value, fn_type) if value.is_some() || fn_type.is_some())
}

/// Drops what a `Structure` holds.
fn dismantle(value: &mut Option<Rc<RefAccessRefType>>, fn_type: &mut Option<RefFnType>) {
    let is_deep = value.as_ref().is_some_and(is_last_of_more)
        || (fn_type.as_ref()).is_some_and(|it| is_last_of_more(&it.return_type));
    if !is_deep {
        return;
    }
    let mut held: SmallVec<[Held; 4]> = SmallVec::new();
    let mut take = |value: &mut Option<Rc<RefAccessRefType>>, fn_type: &mut Option<RefFnType>| {
        held.extend(value.take().map(Held::Value));
        held.extend(fn_type.take().map(|it| Held::Returned(it.return_type)));
        held.pop()
    };
    let mut next = take(value, fn_type);
    while let Some(it) = next {
        next = match it {
            Held::Value(it) => match Rc::into_inner(it).as_mut() {
                Some(RefAccessRefType::Structure { value, fn_type }) => take(value, fn_type),
                _ => take(&mut None, &mut None),
            },
            Held::Returned(it) => match Rc::into_inner(it).as_mut() {
                Some(RefAccessType::Structure { value, fn_type }) => take(value, fn_type),
                _ => take(&mut None, &mut None),
            },
        };
    }
}

impl Drop for RefAccessType {
    #[inline]
    fn drop(&mut self) {
        if let RefAccessType::Structure { value, fn_type } = self {
            dismantle(value, fn_type);
        }
    }
}

impl Drop for RefAccessRefType {
    #[inline]
    fn drop(&mut self) {
        if let RefAccessRefType::Structure { value, fn_type } = self {
            dismantle(value, fn_type);
        }
    }
}

impl RefAccessType {
    /// Try to convert a `RefAccessType` to a `RefAccessRefType` (the Ref/RefValue/Structure subset).
    fn to_ref_type(&self) -> Option<RefAccessRefType> {
        match self {
            RefAccessType::Ref { ref_id } => Some(RefAccessRefType::Ref { ref_id: *ref_id }),
            RefAccessType::RefValue { loc, ref_id } => Some(RefAccessRefType::RefValue {
                loc: *loc,
                ref_id: *ref_id,
            }),
            RefAccessType::Structure { value, fn_type } => Some(RefAccessRefType::Structure {
                value: value.clone(),
                fn_type: fn_type.clone(),
            }),
            _ => None,
        }
    }

    /// Convert a `RefAccessRefType` back to a `RefAccessType`.
    fn from_ref_type(ref_type: &RefAccessRefType) -> Self {
        match ref_type {
            RefAccessRefType::Ref { ref_id } => RefAccessType::Ref { ref_id: *ref_id },
            RefAccessRefType::RefValue { loc, ref_id } => RefAccessType::RefValue {
                loc: *loc,
                ref_id: *ref_id,
            },
            RefAccessRefType::Structure { value, fn_type } => RefAccessType::Structure {
                value: value.clone(),
                fn_type: fn_type.clone(),
            },
        }
    }
}

// --- Join operations ---

/// What was joined, by the addresses of the two, which are held so that the addresses stay theirs.
type Joined<T> = RefCell<HashMap<[*const T; 2], ([Rc<T>; 2], Rc<T>)>>;

struct Joins {
    /// `EnvironmentConfig::joined_ref_values_keep_their_place`
    keeps_place: bool,
    stack: bun_core::StackCheck,
    is_out_of_stack: Cell<bool>,
    /// How many ids were made. The next one.
    new_ids: Cell<u32>,
    values: Joined<RefAccessRefType>,
    returned: Joined<RefAccessType>,
}

impl Joins {
    /// As `Environment::has_stack`, which `validate_no_ref_access_in_render` tells in the end.
    fn has_stack(&self) -> bool {
        if !self.stack.is_safe_to_recurse() {
            self.is_out_of_stack.set(true);
        }
        !self.is_out_of_stack.get()
    }

    fn next_ref_id(&self) -> RefId {
        let id = self.new_ids.get();
        self.new_ids.set(id.wrapping_add(1));
        id
    }

    /// `join(a, b)` behind a pointer. What types hold is shared, so that the same two meet again and again on the way
    /// down: they are joined once. Not where that makes an id: each time it is another.
    fn once<T: Viewed>(
        &self,
        joined: &Joined<T>,
        a: &Rc<T>,
        b: &Rc<T>,
        join: impl FnOnce() -> T,
    ) -> Rc<T> {
        let key = [Rc::as_ptr(a), Rc::as_ptr(b)];
        if let Some((_, known)) = joined.borrow().get(&key) {
            return Rc::clone(known);
        }
        let new_ids = self.new_ids.get();
        let it = kept(join(), a, b);
        if new_ids == self.new_ids.get() && self.has_stack() {
            let of = [Rc::clone(a), Rc::clone(b)];
            joined.borrow_mut().insert(key, (of, Rc::clone(&it)));
        }
        it
    }
}

fn join_ref_access_ref_types(
    a: &RefAccessRefType,
    b: &RefAccessRefType,
    joins: &Joins,
) -> RefAccessRefType {
    if !joins.has_stack() {
        return a.clone();
    }
    let keeps_place = joins.keeps_place;
    match (a, b) {
        (
            RefAccessRefType::RefValue { ref_id: a_id, .. },
            RefAccessRefType::RefValue { ref_id: b_id, .. },
        ) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessRefType::RefValue {
                    loc: None,
                    ref_id: None,
                }
            }
        }
        (RefAccessRefType::RefValue { .. }, _) if keeps_place => a.clone(),
        (_, RefAccessRefType::RefValue { .. }) if keeps_place => b.clone(),
        (RefAccessRefType::RefValue { .. }, _) => RefAccessRefType::RefValue {
            loc: None,
            ref_id: None,
        },
        (_, RefAccessRefType::RefValue { .. }) => RefAccessRefType::RefValue {
            loc: None,
            ref_id: None,
        },
        (RefAccessRefType::Ref { ref_id: a_id }, RefAccessRefType::Ref { ref_id: b_id }) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessRefType::Ref {
                    ref_id: joins.next_ref_id(),
                }
            }
        }
        (RefAccessRefType::Ref { .. }, _) | (_, RefAccessRefType::Ref { .. }) => {
            RefAccessRefType::Ref {
                ref_id: joins.next_ref_id(),
            }
        }
        (
            RefAccessRefType::Structure {
                value: a_value,
                fn_type: a_fn,
            },
            RefAccessRefType::Structure {
                value: b_value,
                fn_type: b_fn,
            },
        ) => {
            let fn_type = match (a_fn, b_fn) {
                (None, other) | (other, None) => other.clone(),
                (Some(a_fn), Some(b_fn)) => Some(RefFnType {
                    read_ref_effect: a_fn.read_ref_effect || b_fn.read_ref_effect,
                    access: a_fn.access.or(b_fn.access),
                    return_type: if Rc::ptr_eq(&a_fn.return_type, &b_fn.return_type) {
                        Rc::clone(&a_fn.return_type)
                    } else {
                        let (a, b) = (&a_fn.return_type, &b_fn.return_type);
                        joins.once(&joins.returned, a, b, || join_ref_access_types(a, b, joins))
                    },
                }),
            };
            let value = match (a_value, b_value) {
                (None, other) | (other, None) => other.clone(),
                (Some(a_val), Some(b_val)) if Rc::ptr_eq(a_val, b_val) => Some(Rc::clone(a_val)),
                (Some(a), Some(b)) => Some(joins.once(&joins.values, a, b, || {
                    join_ref_access_ref_types(a, b, joins)
                })),
            };
            RefAccessRefType::Structure { value, fn_type }
        }
    }
}

fn join_ref_access_types(a: &RefAccessType, b: &RefAccessType, joins: &Joins) -> RefAccessType {
    match (a, b) {
        (RefAccessType::None, other) | (other, RefAccessType::None) => other.clone(),
        (RefAccessType::Guard { ref_id: a_id }, RefAccessType::Guard { ref_id: b_id }) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessType::None
            }
        }
        (RefAccessType::Guard { .. }, RefAccessType::Nullable)
        | (RefAccessType::Nullable, RefAccessType::Guard { .. }) => RefAccessType::None,
        (RefAccessType::Guard { .. }, other) | (other, RefAccessType::Guard { .. }) => {
            other.clone()
        }
        (RefAccessType::Nullable, other) | (other, RefAccessType::Nullable) => other.clone(),
        _ => match (a.to_ref_type(), b.to_ref_type()) {
            (Some(a_ref), Some(b_ref)) => {
                RefAccessType::from_ref_type(&join_ref_access_ref_types(&a_ref, &b_ref, joins))
            }
            (Some(r), None) | (None, Some(r)) => RefAccessType::from_ref_type(&r),
            _ => RefAccessType::None,
        },
    }
}

fn join_ref_access_types_many(types: &[RefAccessType], joins: &Joins) -> RefAccessType {
    types.iter().fold(RefAccessType::None, |acc, t| {
        join_ref_access_types(&acc, t, joins)
    })
}

// --- Env ---

/// What `refTypeOfType` asks of the type of an identifier.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TypeKind {
    Ref,
    RefValue,
    Other,
}

impl TypeKind {
    fn of(ty: &Type) -> Self {
        if crate::hir::is_ref_value_type(ty) {
            TypeKind::RefValue
        } else if crate::hir::is_use_ref_type(ty) {
            TypeKind::Ref
        } else {
            TypeKind::Other
        }
    }
}

struct Env {
    joins: Joins,
    /// Whether the type of any identifier is that of a ref or of the value of one.
    has_ref_types: bool,
    /// By identifier. Empty if none is a ref's or a ref value's.
    type_kinds: Vec<TypeKind>,
    /// Whether `data` holds anything that is reported: a ref, the value of one, a guard, a function that reads one.
    has_refs: bool,
    /// Whether `data` holds a guard.
    has_guards: bool,
    changed: bool,
    /// Counts the rounds of all functions.
    round: u32,
    /// By identifier in `data`: the round that read it last.
    read_in: Vec<Cell<u32>>,
    /// The latest of the rounds that had read what was changed afterwards.
    read_before_change_in: u32,
    data: IdMap<IdentifierId, RefAccessType>,
    /// What was set to `None` and is not in `data`. Only `get_or_type_of` tells that from what was never set.
    set_to_none: IdBitSet<IdentifierId>,
    /// By identifier: the one that stands for it in `data`.
    temporaries: Vec<IdentifierId>,
}

impl Env {
    fn new(env: &Environment) -> Self {
        let has_ref_types = env.types.iter().any(crate::hir::is_ref_or_ref_value);
        let type_kind_of =
            |identifier: &Identifier| TypeKind::of(&env.types[identifier.type_.0 as usize]);
        Self {
            joins: Joins {
                keeps_place: env.config.joined_ref_values_keep_their_place,
                stack: env.stack(),
                is_out_of_stack: Cell::new(false),
                new_ids: Cell::new(0),
                values: Joined::default(),
                returned: Joined::default(),
            },
            has_ref_types,
            type_kinds: match has_ref_types {
                true => env.identifiers.iter().map(type_kind_of).collect(),
                false => Vec::new(),
            },
            has_refs: false,
            has_guards: false,
            changed: false,
            round: 0,
            read_in: vec![Cell::new(0); env.identifiers.len()],
            read_before_change_in: 0,
            data: IdMap::default(),
            set_to_none: IdBitSet::default(),
            temporaries: (0..env.identifiers.len() as u32)
                .map(IdentifierId)
                .collect(),
        }
    }

    fn define(&mut self, key: IdentifierId, value: IdentifierId) {
        self.temporaries[key.0 as usize] = value;
    }

    fn reset_changed(&mut self) {
        self.changed = false;
    }

    fn has_changed(&self) -> bool {
        self.changed
    }

    fn start_round(&mut self) -> u32 {
        self.changed = false;
        self.round += 1;
        self.round
    }

    /// Whether another round after the one that began as `round` would change nothing: nothing was changed after
    /// it was read, so it would read the same, and join it with what already has it. A join of refs makes a new id.
    fn is_settled_since(&self, round: u32) -> bool {
        !self.has_refs && self.read_before_change_in < round
    }

    /// Whether to look for what is reported. A debug build always looks, and asserts what it finds.
    #[inline]
    fn may_report(&self) -> bool {
        self.has_refs || cfg!(debug_assertions)
    }

    #[inline]
    fn may_report_guards(&self) -> bool {
        self.has_guards || cfg!(debug_assertions)
    }

    #[inline]
    fn temporary(&self, key: IdentifierId) -> IdentifierId {
        self.temporaries[key.0 as usize]
    }

    #[inline]
    fn get(&self, key: IdentifierId) -> Option<&RefAccessType> {
        let key = self.temporary(key);
        self.read_in[key.0 as usize].set(self.round);
        self.data.get(key)
    }

    /// `get` for what has no part in what is set: a validation, or whether to set at all.
    #[inline]
    fn peek(&self, key: IdentifierId) -> Option<&RefAccessType> {
        self.data.get(self.temporary(key))
    }

    /// `get(key) ?? refTypeOfType(place)`
    fn get_or_type_of(&self, key: IdentifierId, place: IdentifierId) -> RefAccessType {
        match self.get(key) {
            Some(ty) => ty.clone(),
            None if self.set_to_none.contains(self.temporary(key)) => RefAccessType::None,
            None => self.ref_type_of_type(place),
        }
    }

    #[inline]
    fn set(&mut self, key: IdentifierId, value: RefAccessType) {
        // Where no type is a ref's, nothing tells `None` from what was never set.
        if self.has_ref_types || !matches!(value, RefAccessType::None) {
            self.join(key, value);
        }
    }

    fn join(&mut self, key: IdentifierId, value: RefAccessType) {
        let operand_id = self.temporary(key);
        let current = self.data.get(operand_id);
        match &value {
            // Joined with it, what is there stays.
            RefAccessType::None => {
                if current.is_none() {
                    self.set_to_none.insert(operand_id);
                }
                return;
            }
            RefAccessType::Nullable => {}
            RefAccessType::Guard { .. } => {
                self.has_refs = true;
                self.has_guards = true;
            }
            RefAccessType::Ref { .. } | RefAccessType::RefValue { .. } => self.has_refs = true,
            RefAccessType::Structure { fn_type, .. } => {
                self.has_refs |= fn_type.as_ref().is_some_and(|it| it.read_ref_effect);
            }
        }
        if current.is_some_and(|current| is_the_same(value.view(), current.view())) {
            return;
        }
        let widened_value =
            join_ref_access_types(&value, current.unwrap_or(&RefAccessType::None), &self.joins);
        if current.is_none() && widened_value == RefAccessType::None {
            // No change needed
        } else if current.map_or(true, |c| c != &widened_value) {
            self.changed = true;
            let read_in = self.read_in[operand_id.0 as usize].get();
            self.read_before_change_in = self.read_before_change_in.max(read_in);
        }
        self.data.insert(operand_id, widened_value);
    }

    #[inline]
    fn type_kind(&self, id: IdentifierId) -> TypeKind {
        match self.type_kinds.get(id.0 as usize) {
            Some(&kind) => kind,
            None => TypeKind::Other,
        }
    }

    fn ref_type_of_type(&self, id: IdentifierId) -> RefAccessType {
        match self.type_kind(id) {
            TypeKind::RefValue => RefAccessType::RefValue {
                loc: None,
                ref_id: None,
            },
            TypeKind::Ref => RefAccessType::Ref {
                ref_id: self.joins.next_ref_id(),
            },
            TypeKind::Other => RefAccessType::None,
        }
    }

    fn is_ref_type(&self, id: IdentifierId) -> bool {
        self.type_kind(id) == TypeKind::Ref
    }
}

// --- Helper functions ---

fn destructure(ty: &RefAccessType) -> View<'_> {
    let RefAccessType::Structure {
        value: Some(inner), ..
    } = ty
    else {
        return ty.view();
    };
    let mut inner: &RefAccessRefType = inner;
    while let RefAccessRefType::Structure {
        value: Some(next), ..
    } = inner
    {
        inner = next;
    }
    inner.view()
}

/// TS `eachInstructionValueOperand`
fn each_operand(
    value: &InstructionValue,
    functions: &[HirFunction],
    visit: &mut dyn FnMut(&Place),
) {
    visitors::operands(value, functions).for_each(visit);
}

/// The identifiers that are interpolated as JSX children.
fn collect_interpolated_as_jsx(func: &HirFunction) -> IdBitSet<IdentifierId> {
    let mut interpolated_as_jsx = IdBitSet::default();
    for (_, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::JsxExpression {
                    children: Some(children),
                    ..
                }
                | InstructionValue::JsxFragment { children, .. } => {
                    interpolated_as_jsx.extend(children.iter().map(|child| child.identifier));
                }
                _ => {}
            }
        }
    }
    interpolated_as_jsx
}

// --- Validation helpers ---

#[cold]
#[inline(never)]
fn ref_access_error(loc: Option<SourceLocation>, message: &'static str) -> CompilerDiagnostic {
    CompilerDiagnostic::new(
        ErrorCategory::Refs,
        "Cannot access refs during render",
        Some(ERROR_DESCRIPTION.to_string()),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc,
        message: Some(message.to_string()),
        identifier_name: None,
    })
}

const UPDATE: &str = "Cannot update ref during render";

/// `access`: [`RefFnType::access`] of the function. A linter can say where that is.
#[cold]
#[inline(never)]
fn function_accesses_ref(
    loc: Option<SourceLocation>,
    access: Option<(SourceLocation, bool)>,
) -> CompilerDiagnostic {
    let error = ref_access_error(loc, "This function accesses a ref value");
    match access {
        Some((access, is_update)) => error.with_detail(CompilerDiagnosticDetail::Error {
            loc: Some(access),
            message: Some(
                match is_update {
                    true => "The ref is updated here",
                    false => "The ref is accessed here",
                }
                .to_string(),
            ),
            identifier_name: None,
        }),
        None => error,
    }
}

#[cold]
#[inline(never)]
fn ref_access_error_with_init_hint(loc: Option<SourceLocation>) -> CompilerDiagnostic {
    ref_access_error(loc, "Cannot access ref value during render").with_detail(
        CompilerDiagnosticDetail::Hint {
            message: "To initialize a ref only once, check that the ref is null with the pattern `if (ref.current == null) { ref.current = ... }`".to_string(),
        },
    )
}

fn validate_no_direct_ref_value_access(
    errors: &mut Vec<CompilerDiagnostic>,
    operand: &Place,
    env: &Env,
) {
    if let Some(View::RefValue(loc, _)) = env.peek(operand.identifier).map(destructure) {
        errors.push(ref_access_error(
            loc.or(operand.loc),
            "Cannot access ref value during render",
        ));
    }
}

fn validate_no_ref_value_access(errors: &mut Vec<CompilerDiagnostic>, env: &Env, operand: &Place) {
    match env.peek(operand.identifier).map(destructure) {
        Some(View::RefValue(loc, _)) => {
            errors.push(ref_access_error(
                loc.or(operand.loc),
                "Cannot access ref value during render",
            ));
        }
        Some(View::Structure(_, Some(fn_type))) if fn_type.read_ref_effect => {
            errors.push(ref_access_error(
                operand.loc,
                "Cannot access ref value during render",
            ));
        }
        _ => {}
    }
}

/// Whether `validate_no_ref_passed_to_function` reports it. What `validate_no_direct_ref_value_access` reports is
/// among that.
fn is_reported_when_passed(env: &Env, operand: &Place) -> bool {
    match env.peek(operand.identifier).map(destructure) {
        Some(View::RefValue(..) | View::Ref(_)) => true,
        Some(View::Structure(_, Some(fn_type))) => fn_type.read_ref_effect,
        _ => false,
    }
}

fn validate_no_ref_passed_to_function(
    errors: &mut Vec<CompilerDiagnostic>,
    env: &Env,
    operand: &Place,
    loc: Option<SourceLocation>,
) {
    let error_loc = match env.peek(operand.identifier).map(destructure) {
        Some(View::RefValue(ref_loc, _)) => ref_loc.or(loc),
        Some(View::Ref(_)) => loc,
        Some(View::Structure(_, Some(fn_type))) if fn_type.read_ref_effect => loc,
        _ => return,
    };
    errors.push(ref_access_error(
        error_loc,
        "Passing a ref to a function may read its value during render",
    ));
}

fn validate_no_ref_update(
    errors: &mut Vec<CompilerDiagnostic>,
    env: &Env,
    operand: &Place,
    loc: Option<SourceLocation>,
) {
    let error_loc = match env.peek(operand.identifier).map(destructure) {
        Some(View::RefValue(ref_loc, _)) => ref_loc.or(loc),
        Some(View::Ref(_)) => loc,
        _ => return,
    };
    errors.push(ref_access_error(error_loc, UPDATE));
}

fn guard_check(errors: &mut Vec<CompilerDiagnostic>, operand: &Place, env: &Env) {
    if matches!(
        env.peek(operand.identifier),
        Some(RefAccessType::Guard { .. })
    ) {
        debug_assert!(env.has_guards);
        errors.push(ref_access_error(
            operand.loc,
            "Cannot access ref value during render",
        ));
    }
}

// --- Main entry point ---

pub(crate) fn validate_no_ref_access_in_render(func: &HirFunction, env: &mut Environment) {
    let mut ref_env = Env::new(env);
    collect_temporaries_sidemap(func, &mut ref_env);
    let mut errors: Vec<CompilerDiagnostic> = Vec::new();
    validate_no_ref_access_in_render_impl(
        func,
        &env.identifiers,
        &env.types,
        &env.functions,
        &*env,
        &mut ref_env,
        &mut errors,
    );
    if !ref_env.joins.has_stack() {
        env.ran_out_of_stack();
    }
    for diagnostic in errors {
        env.record_diagnostic(diagnostic);
    }
}

fn collect_temporaries_sidemap(func: &HirFunction, env: &mut Env) {
    for (_, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::LoadLocal { place, .. } => {
                    let temp = env.temporary(place.identifier);
                    env.define(instr.lvalue.identifier, temp);
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    let temp = env.temporary(value.identifier);
                    env.define(instr.lvalue.identifier, temp);
                    env.define(lvalue.place.identifier, temp);
                }
                InstructionValue::PropertyLoad {
                    object, property, ..
                } => {
                    if env.is_ref_type(object.identifier)
                        && matches!(property, PropertyLiteral::String(s) if s == b"current")
                    {
                        continue;
                    }
                    let temp = env.temporary(object.identifier);
                    env.define(instr.lvalue.identifier, temp);
                }
                _ => {}
            }
        }
    }
}

fn validate_no_ref_access_in_render_impl(
    func: &HirFunction,
    identifiers: &[Identifier],
    types: &[Type],
    functions: &[HirFunction],
    env: &Environment,
    ref_env: &mut Env,
    errors: &mut Vec<CompilerDiagnostic>,
) -> RefAccessType {
    if !env.has_stack() {
        return RefAccessType::None;
    }

    let mut return_values: Vec<RefAccessType> = Vec::new();

    // Process params
    for param in &func.params {
        let place = param.place();
        ref_env.set(place.identifier, ref_env.ref_type_of_type(place.identifier));
    }

    let mut interpolated_as_jsx: Option<IdBitSet<IdentifierId>> = None;

    let mut is_settled = false;

    // Fixed-point iteration (up to 10 iterations)
    for iteration in 0..10 {
        if iteration > 0 && !ref_env.has_changed() {
            break;
        }
        let round = ref_env.start_round();
        return_values.clear();
        let mut safe_blocks: Vec<(BlockId, RefId)> = Vec::new();

        for (_, block) in &func.body.blocks {
            safe_blocks.retain(|(block_id, _)| *block_id != block.id);

            // Process phis
            for phi in &block.phis {
                let joined =
                    (phi.operands.values()).fold(RefAccessType::None, |joined, operand| {
                        match ref_env.get(operand.identifier) {
                            Some(ty) => join_ref_access_types(&joined, ty, &ref_env.joins),
                            None => joined,
                        }
                    });
                ref_env.set(phi.place.identifier, joined);
            }

            // Process instructions
            for &instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];
                match &instr.value {
                    InstructionValue::ComputedLoad { object, .. }
                    | InstructionValue::PropertyLoad { object, .. } => {
                        if let InstructionValue::ComputedLoad { property, .. } = &instr.value {
                            validate_no_direct_ref_value_access(errors, property, ref_env);
                        }
                        let lookup_type = match ref_env.get(object.identifier) {
                            Some(RefAccessType::Structure {
                                value: Some(value), ..
                            }) => RefAccessType::from_ref_type(value),
                            Some(RefAccessType::Ref { ref_id }) => RefAccessType::RefValue {
                                loc: instr.loc,
                                ref_id: Some(*ref_id),
                            },
                            _ => ref_env.ref_type_of_type(instr.lvalue.identifier),
                        };
                        ref_env.set(instr.lvalue.identifier, lookup_type);
                    }
                    InstructionValue::TypeCastExpression { value: place, .. }
                    | InstructionValue::LoadContext { place, .. }
                    | InstructionValue::LoadLocal { place, .. } => {
                        ref_env.set(
                            instr.lvalue.identifier,
                            ref_env.get_or_type_of(place.identifier, instr.lvalue.identifier),
                        );
                    }
                    InstructionValue::StoreContext { lvalue, value, .. }
                    | InstructionValue::StoreLocal { lvalue, value, .. } => {
                        for place in [&lvalue.place, &instr.lvalue] {
                            ref_env.set(
                                place.identifier,
                                ref_env.get_or_type_of(value.identifier, place.identifier),
                            );
                        }
                    }
                    InstructionValue::Destructure { value, lvalue, .. } => {
                        let lookup_type = match ref_env.get(value.identifier) {
                            Some(RefAccessType::Structure {
                                value: Some(value), ..
                            }) => Some(RefAccessType::from_ref_type(value)),
                            _ => None,
                        };
                        // Otherwise each is set to `None`.
                        if lookup_type.is_some() || ref_env.has_ref_types {
                            ref_env.set(
                                instr.lvalue.identifier,
                                lookup_type.clone().unwrap_or_else(|| {
                                    ref_env.ref_type_of_type(instr.lvalue.identifier)
                                }),
                            );
                            for pattern_place in pattern_operands(&lvalue.pattern) {
                                ref_env.set(
                                    pattern_place.identifier,
                                    lookup_type.clone().unwrap_or_else(|| {
                                        ref_env.ref_type_of_type(pattern_place.identifier)
                                    }),
                                );
                            }
                        }
                    }
                    InstructionValue::ObjectMethod { lowered_func, .. }
                    | InstructionValue::FunctionExpression { lowered_func, .. } => {
                        let inner = &functions[lowered_func.func.0 as usize];
                        let mut inner_errors: Vec<CompilerDiagnostic> = Vec::new();
                        let result = validate_no_ref_access_in_render_impl(
                            inner,
                            identifiers,
                            types,
                            functions,
                            env,
                            ref_env,
                            &mut inner_errors,
                        );
                        let mut details = inner_errors.iter().flat_map(|it| &it.details);
                        let access = details.find_map(|it| match it {
                            CompilerDiagnosticDetail::Error {
                                loc: Some(loc),
                                message,
                                ..
                            } => Some((*loc, message.as_deref() == Some(UPDATE))),
                            _ => None,
                        });
                        let (return_type, read_ref_effect) = if inner_errors.is_empty() {
                            (result, false)
                        } else {
                            (RefAccessType::None, true)
                        };
                        // Joined with what another round has left, the same again gives that.
                        let is_known = matches!(
                            ref_env.peek(instr.lvalue.identifier),
                            Some(RefAccessType::Structure { fn_type: Some(known), .. })
                                if known.read_ref_effect == read_ref_effect
                                    && is_the_same(known.return_type.view(), return_type.view())
                        );
                        if !is_known {
                            ref_env.set(
                                instr.lvalue.identifier,
                                RefAccessType::Structure {
                                    value: None,
                                    fn_type: Some(RefFnType {
                                        read_ref_effect,
                                        access,
                                        return_type: Rc::new(return_type),
                                    }),
                                },
                            );
                        }
                    }
                    InstructionValue::MethodCall { property, .. }
                    | InstructionValue::CallExpression {
                        callee: property, ..
                    } => {
                        let callee = property;
                        let mut return_type = RefAccessType::None;
                        let mut did_error = false;

                        if let Some(RefAccessType::Structure {
                            fn_type: Some(fn_ty),
                            ..
                        }) = ref_env.get(callee.identifier)
                        {
                            return_type = (*fn_ty.return_type).clone();
                            if fn_ty.read_ref_effect {
                                did_error = true;
                                errors.push(function_accesses_ref(callee.loc, fn_ty.access));
                            }
                        }

                        /*
                         * If we already reported an error on this instruction, don't report
                         * duplicate errors
                         */
                        if !did_error && ref_env.may_report() {
                            let ref_env = &*ref_env;
                            let is_ref_lvalue = ref_env.is_ref_type(instr.lvalue.identifier);
                            let callee_identifier = &identifiers[callee.identifier.0 as usize];
                            let callee_type = &types[callee_identifier.type_.0 as usize];
                            let hook_kind = env.get_hook_kind_for_type(callee_type).ok().flatten();

                            if is_ref_lvalue
                                || (hook_kind.is_some()
                                    && !matches!(hook_kind, Some(&HookKind::UseState))
                                    && !matches!(hook_kind, Some(&HookKind::UseReducer)))
                            {
                                /*
                                 * Allow passing refs or ref-accessing functions when:
                                 * 1. lvalue is a ref (mergeRefs pattern)
                                 * 2. calling hooks (independently validated)
                                 */
                                each_operand(&instr.value, functions, &mut |operand| {
                                    validate_no_direct_ref_value_access(errors, operand, ref_env);
                                });
                            } else if interpolated_as_jsx
                                .get_or_insert_with(|| collect_interpolated_as_jsx(func))
                                .contains(instr.lvalue.identifier)
                            {
                                each_operand(&instr.value, functions, &mut |operand| {
                                    validate_no_ref_value_access(errors, ref_env, operand);
                                });
                            } else if hook_kind.is_none() && instr.effects.is_some() {
                                let mut visited_effects: HashSet<(IdentifierId, bool)> =
                                    HashSet::default();
                                // A call with n arguments has about n * n effects.
                                let mut frozen: Option<HashSet<IdentifierId>> = None;
                                for effect in instr.effects.as_ref().unwrap() {
                                    let (place, ref_passed): (&Place, Option<bool>) = match effect {
                                        AliasingEffect::Freeze { value, .. } => {
                                            (value, Some(false))
                                        }
                                        AliasingEffect::Mutate { value, .. }
                                        | AliasingEffect::MutateTransitive { value }
                                        | AliasingEffect::MutateConditionally { value }
                                        | AliasingEffect::MutateTransitiveConditionally { value } => {
                                            (value, Some(true))
                                        }
                                        AliasingEffect::Render { place } => (place, Some(true)),
                                        AliasingEffect::Capture { from, .. }
                                        | AliasingEffect::Alias { from, .. }
                                        | AliasingEffect::MaybeAlias { from, .. }
                                        | AliasingEffect::Assign { from, .. }
                                        | AliasingEffect::CreateFrom { from, .. } => {
                                            (from, Some(true))
                                        }
                                        AliasingEffect::ImmutableCapture { from, .. } => {
                                            (from, None)
                                        }
                                        AliasingEffect::Create { .. }
                                        | AliasingEffect::CreateFunction { .. }
                                        | AliasingEffect::Apply(_)
                                        | AliasingEffect::Impure { .. }
                                        | AliasingEffect::MutateFrozen { .. }
                                        | AliasingEffect::MutateGlobal { .. } => continue,
                                    };
                                    if !is_reported_when_passed(ref_env, place) {
                                        debug_assert!({
                                            let mut reported = Vec::new();
                                            validate_no_ref_passed_to_function(
                                                &mut reported,
                                                ref_env,
                                                place,
                                                place.loc,
                                            );
                                            validate_no_direct_ref_value_access(
                                                &mut reported,
                                                place,
                                                ref_env,
                                            );
                                            reported.is_empty()
                                        });
                                        continue;
                                    }
                                    let ref_passed = ref_passed.unwrap_or_else(|| {
                                        !frozen
                                            .get_or_insert_with(|| {
                                                (instr.effects.iter().flatten())
                                                    .filter_map(|effect| match effect {
                                                        AliasingEffect::Freeze {
                                                            value, ..
                                                        } => Some(value.identifier),
                                                        _ => None,
                                                    })
                                                    .collect()
                                            })
                                            .contains(&place.identifier)
                                    });
                                    if visited_effects.insert((place.identifier, ref_passed)) {
                                        if ref_passed {
                                            validate_no_ref_passed_to_function(
                                                errors, ref_env, place, place.loc,
                                            );
                                        } else {
                                            validate_no_direct_ref_value_access(
                                                errors, place, ref_env,
                                            );
                                        }
                                    }
                                }
                            } else {
                                each_operand(&instr.value, functions, &mut |operand| {
                                    validate_no_ref_passed_to_function(
                                        errors,
                                        ref_env,
                                        operand,
                                        operand.loc,
                                    );
                                });
                            }
                        }
                        ref_env.set(instr.lvalue.identifier, return_type);
                    }
                    InstructionValue::ObjectExpression { .. }
                    | InstructionValue::ArrayExpression { .. } => {
                        let mut value = RefAccessType::None;
                        each_operand(&instr.value, functions, &mut |operand| {
                            if ref_env.may_report() {
                                validate_no_direct_ref_value_access(errors, operand, ref_env);
                            }
                            if let Some(ty) = ref_env.get(operand.identifier) {
                                value = join_ref_access_types(&value, ty, &ref_env.joins);
                            }
                        });
                        match &value {
                            RefAccessType::None
                            | RefAccessType::Guard { .. }
                            | RefAccessType::Nullable => {
                                ref_env.set(instr.lvalue.identifier, RefAccessType::None);
                            }
                            _ => {
                                // Joined with what another round has left, the same again gives that.
                                let is_known = matches!(
                                    ref_env.peek(instr.lvalue.identifier),
                                    Some(RefAccessType::Structure { value: Some(known), .. })
                                        if is_the_same(known.view(), value.view())
                                );
                                if !is_known {
                                    ref_env.set(
                                        instr.lvalue.identifier,
                                        RefAccessType::Structure {
                                            value: value.to_ref_type().map(Rc::new),
                                            fn_type: None,
                                        },
                                    );
                                }
                            }
                        }
                    }
                    InstructionValue::PropertyDelete { object, .. }
                    | InstructionValue::PropertyStore { object, .. }
                    | InstructionValue::ComputedDelete { object, .. }
                    | InstructionValue::ComputedStore { object, .. } => {
                        let target = ref_env.get(object.identifier).cloned();
                        let mut found_safe = false;
                        if matches!(&instr.value, InstructionValue::PropertyStore { .. }) {
                            if let Some(RefAccessType::Ref { ref_id }) = &target {
                                if let Some(pos) = safe_blocks.iter().position(|(_, r)| r == ref_id)
                                {
                                    safe_blocks.remove(pos);
                                    found_safe = true;
                                }
                            }
                        }
                        if !found_safe {
                            validate_no_ref_update(errors, ref_env, object, instr.loc);
                        }
                        match &instr.value {
                            InstructionValue::ComputedDelete { property, .. }
                            | InstructionValue::ComputedStore { property, .. } => {
                                validate_no_ref_value_access(errors, ref_env, property);
                            }
                            _ => {}
                        }
                        match &instr.value {
                            InstructionValue::ComputedStore { value, .. }
                            | InstructionValue::PropertyStore { value, .. } => {
                                validate_no_direct_ref_value_access(errors, value, ref_env);
                                let value_type = ref_env.get(value.identifier).cloned();
                                if let Some(RefAccessType::Structure { .. }) = &value_type {
                                    let mut object_type = value_type.unwrap();
                                    if let Some(t) = &target {
                                        object_type =
                                            join_ref_access_types(&object_type, t, &ref_env.joins);
                                    }
                                    ref_env.set(object.identifier, object_type);
                                }
                            }
                            _ => {}
                        }
                    }
                    InstructionValue::StartMemoize { .. }
                    | InstructionValue::FinishMemoize { .. } => {}
                    InstructionValue::LoadGlobal { binding, .. } => {
                        if binding.name() == b"undefined" {
                            ref_env.set(instr.lvalue.identifier, RefAccessType::Nullable);
                        }
                    }
                    InstructionValue::Primitive { value, .. } => {
                        if matches!(value, PrimitiveValue::Null | PrimitiveValue::Undefined) {
                            ref_env.set(instr.lvalue.identifier, RefAccessType::Nullable);
                        }
                    }
                    // The rest does nothing but with what is reported.
                    _ if !ref_env.may_report() => {}
                    InstructionValue::JsxExpression { .. }
                    | InstructionValue::JsxFragment { .. } => {
                        each_operand(&instr.value, functions, &mut |operand| {
                            validate_no_direct_ref_value_access(errors, operand, ref_env);
                        });
                    }
                    InstructionValue::UnaryExpression {
                        operator, value, ..
                    } => {
                        if *operator == UnaryOperator::Not {
                            if let Some(&RefAccessType::RefValue {
                                ref_id: Some(ref_id),
                                ..
                            }) = ref_env.get(value.identifier)
                            {
                                /*
                                 * Record an error suggesting the `if (ref.current == null)` pattern,
                                 * but also record the lvalue as a guard so that we don't emit a
                                 * second error for the write to the ref
                                 */
                                ref_env
                                    .set(instr.lvalue.identifier, RefAccessType::Guard { ref_id });
                                errors.push(ref_access_error_with_init_hint(value.loc));
                            } else {
                                validate_no_ref_value_access(errors, ref_env, value);
                            }
                        } else {
                            validate_no_ref_value_access(errors, ref_env, value);
                        }
                    }
                    InstructionValue::BinaryExpression { left, right, .. } => {
                        let left_type = ref_env.get(left.identifier);
                        let right_type = ref_env.get(right.identifier);
                        let mut nullish = false;
                        let mut found_ref_id: Option<RefId> = None;

                        if let Some(RefAccessType::RefValue {
                            ref_id: Some(id), ..
                        }) = left_type
                        {
                            found_ref_id = Some(*id);
                        } else if let Some(RefAccessType::RefValue {
                            ref_id: Some(id), ..
                        }) = right_type
                        {
                            found_ref_id = Some(*id);
                        }

                        if matches!(left_type, Some(RefAccessType::Nullable))
                            || matches!(right_type, Some(RefAccessType::Nullable))
                        {
                            nullish = true;
                        }

                        if let Some(ref_id) = found_ref_id {
                            if nullish {
                                ref_env
                                    .set(instr.lvalue.identifier, RefAccessType::Guard { ref_id });
                            } else {
                                validate_no_ref_value_access(errors, ref_env, left);
                                validate_no_ref_value_access(errors, ref_env, right);
                            }
                        } else {
                            validate_no_ref_value_access(errors, ref_env, left);
                            validate_no_ref_value_access(errors, ref_env, right);
                        }
                    }
                    _ => {
                        each_operand(&instr.value, functions, &mut |operand| {
                            validate_no_ref_value_access(errors, ref_env, operand);
                        });
                    }
                }

                // Guard values are derived from ref.current, so they can only be used
                // in if statement targets
                if ref_env.may_report_guards() {
                    each_operand(&instr.value, functions, &mut |operand| {
                        guard_check(errors, operand, ref_env);
                    });
                }

                if !ref_env.has_ref_types {
                    continue;
                }
                if ref_env.is_ref_type(instr.lvalue.identifier)
                    && !matches!(
                        ref_env.get(instr.lvalue.identifier),
                        Some(RefAccessType::Ref { .. })
                    )
                {
                    let existing = ref_env
                        .get(instr.lvalue.identifier)
                        .cloned()
                        .unwrap_or(RefAccessType::None);
                    ref_env.set(
                        instr.lvalue.identifier,
                        join_ref_access_types(
                            &existing,
                            &RefAccessType::Ref {
                                ref_id: ref_env.joins.next_ref_id(),
                            },
                            &ref_env.joins,
                        ),
                    );
                }
                if ref_env.type_kind(instr.lvalue.identifier) == TypeKind::RefValue
                    && !matches!(
                        ref_env.get(instr.lvalue.identifier),
                        Some(RefAccessType::RefValue { .. })
                    )
                {
                    let existing = ref_env
                        .get(instr.lvalue.identifier)
                        .cloned()
                        .unwrap_or(RefAccessType::None);
                    ref_env.set(
                        instr.lvalue.identifier,
                        join_ref_access_types(
                            &existing,
                            &RefAccessType::RefValue {
                                loc: instr.loc,
                                ref_id: None,
                            },
                            &ref_env.joins,
                        ),
                    );
                }
            }

            // Check if terminal is an `if` — push safe block for guard
            if let Terminal::If {
                test, fallthrough, ..
            } = &block.terminal
            {
                if let Some(RefAccessType::Guard { ref_id }) = ref_env.get(test.identifier) {
                    if !safe_blocks.iter().any(|(_, r)| r == ref_id) {
                        safe_blocks.push((*fallthrough, *ref_id));
                    }
                }
            }

            // Process terminal operands
            let is_return = matches!(&block.terminal, Terminal::Return { .. });
            if !is_return && !ref_env.may_report() {
                continue;
            }
            for operand in terminal_operands(&block.terminal) {
                if !is_return {
                    validate_no_ref_value_access(errors, ref_env, operand);
                    if !matches!(&block.terminal, Terminal::If { .. }) {
                        guard_check(errors, operand, ref_env);
                    }
                } else {
                    // Allow functions containing refs to be returned, but not direct ref values
                    validate_no_direct_ref_value_access(errors, operand, ref_env);
                    guard_check(errors, operand, ref_env);
                    if let Some(ty) = ref_env.get(operand.identifier) {
                        return_values.push(ty.clone());
                    }
                }
            }
        }

        if !errors.is_empty() {
            debug_assert!(ref_env.has_refs);
            return RefAccessType::None;
        }

        debug_assert!(!is_settled || !ref_env.has_changed());
        // No round follows the last: that it changed something says that the environment did not converge.
        is_settled = iteration < 9 && ref_env.is_settled_since(round);
        if is_settled && !cfg!(debug_assertions) {
            ref_env.reset_changed();
        }
    }

    if ref_env.has_changed() {
        errors.push(CompilerDiagnostic::new(
            crate::diagnostics::ErrorCategory::Invariant,
            "Ref type environment did not converge",
            None,
        ));
        return RefAccessType::None;
    }

    join_ref_access_types_many(&return_values, &ref_env.joins)
}
