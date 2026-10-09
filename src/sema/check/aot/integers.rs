//! Which numbers are integers, and in what range.
//!
//! An integer is a number without a fraction, other than `-0`, of a magnitude up to which a double stands for every integer. Compiled
//! code relies on an answer without a test, so what is not shown to hold is not answered.
//!
//! An expression is gone through by its syntax: literals, operators, `.length`, a few built-in functions, and names. A name stands for
//! what its variable holds, and every store to a variable is in the file that declares it, so all of them are looked at. What a store
//! stores may depend on what the variable holds (`i++`), or another one does. So there are two steps. The first finds, for all the
//! variables that depend on each other, the least ranges that every store stays within, with the ends of a range moved outward to one of a
//! few numbers, so that it ends: whatever the order it is done in, it ends with the same ranges. The second goes through the stores of a
//! variable once more, with those ranges for what is read, and takes what comes out as it is.
//!
//! What is known of a variable where it is read is more than what it holds over its whole life. The control flow nodes of the binder are
//! followed back from the read to the stores that reach it. At the head of a loop that stores to the variable the walk ends with what
//! the variable holds over its whole life. The binder makes no node for `i < n`, which narrows no type. Such a test is found by the
//! syntax, around the read or before it among the statements, and is applied where the walk comes by the flow node at which the
//! test read the variable: nothing was stored in between on that path. The flow nodes are made for narrowing types, and leave out a few
//! ways that control takes. A variable that is stored to where that matters, or by other code than the code that declares it, is only
//! known for what it holds over its whole life: `runs_off_the_flow`, `Place::is_stored_elsewhere`.

use super::ByFile;
use super::kinds::kind;
use crate::atom::{Atom, known};
use crate::bind::{Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::Checker;
use crate::check::errors::Container;
use crate::hir::{
    BinOp, CallId, Chain, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, FnKind, IdList, MemberId, MemberKind, PatId, PropKey, StmtId, StmtKind, UnOp,
    VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{EnumValue, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::rc::Rc;
use std::sync::OnceLock;

/// Up to here a double stands for every integer.
const MOST_EXACT: i64 = 1 << 53;
pub(super) const INT32: (i64, i64) = (i32::MIN as i64, i32::MAX as i64);
const MOST_UINT32: i64 = u32::MAX as i64;
/// A count does not pass `MOST_EXACT`: what is added to it or taken from it at a time is at most this. See `sum`.
const MOST_STEP: i64 = 1024;
/// What is computed in one go, and not counted up to, is an integer up to here: a literal, a product, a sum of two such. So nothing but counting gets near `MOST_EXACT`.
const MOST_COMPUTED: i64 = 1 << 52;
/// The engine makes no longer string.
const MOST_STRING_LENGTH: i64 = i32::MAX as i64;
const MOST_ARRAY_LENGTH: i64 = u32::MAX as i64;
/// A walk that takes more steps ends with what the variable holds over its whole life.
const MOST_STEPS: u32 = 100_000;
/// A loop with more flow nodes counts as storing to every variable.
const MOST_NODES_IN_LOOP: usize = 100_000;

/// The typed arrays of integers that are numbers, with the least and the most that an element can be.
const ARRAYS_OF_INTEGERS: [(&[u8], i64, i64); 7] = [
    (b"Int8Array", i8::MIN as i64, i8::MAX as i64),
    (b"Uint8Array", 0, u8::MAX as i64),
    (b"Uint8ClampedArray", 0, u8::MAX as i64),
    (b"Int16Array", i16::MIN as i64, i16::MAX as i64),
    (b"Uint16Array", 0, u16::MAX as i64),
    (b"Int32Array", INT32.0, INT32.1),
    (b"Uint32Array", 0, MOST_UINT32),
];


/// What a value can be: an integer from `least` to `most`, none if `least` is the greater, `undefined` or `null` if `nil`, and nothing else.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Numbers {
    least: i64,
    most: i64,
    nil: bool,
}

/// `None`: it can be anything.
type Found = Option<Numbers>;

impl Numbers {
    /// No value gets there.
    const NOTHING: Numbers = Numbers { least: 1, most: 0, nil: false };
    const NIL: Numbers = Numbers { least: 1, most: 0, nil: true };

    fn integers(least: i64, most: i64) -> Numbers {
        if least > most { Numbers::NOTHING } else { Numbers { least, most, nil: false } }
    }

    fn has_no_number(self) -> bool {
        self.least > self.most
    }

    /// The least and the most of the numbers among it.
    fn range(self) -> Option<(i64, i64)> {
        (!self.has_no_number()).then_some((self.least, self.most))
    }

    /// The same, of what is a number for sure.
    fn numbers(self) -> Option<(i64, i64)> {
        if self.nil { None } else { self.range() }
    }

    /// The one or the other.
    fn or(self, other: Numbers) -> Numbers {
        let nil = self.nil || other.nil;
        if self.has_no_number() {
            return Numbers { nil, ..other };
        }
        if other.has_no_number() {
            return Numbers { nil, ..self };
        }
        Numbers { least: self.least.min(other.least), most: self.most.max(other.most), nil }
    }

    /// What is both.
    fn and(self, other: Numbers) -> Numbers {
        Numbers { nil: self.nil && other.nil, ..self.within(other.least, other.most) }
    }

    /// Without the numbers below `least` or above `most`.
    fn within(self, least: i64, most: i64) -> Numbers {
        Numbers { nil: self.nil, ..Numbers::integers(self.least.max(least), self.most.min(most)) }
    }

    /// What is truthy of it. Zero in the middle of the range stays.
    fn truthy(self) -> Numbers {
        Numbers::integers(if self.least == 0 { 1 } else { self.least }, if self.most == 0 { -1 } else { self.most })
    }

    /// As an operator on 32 bits takes it: `undefined` and `null` become zero.
    fn with_nil_as_zero(self) -> Numbers {
        if self.nil { Numbers { nil: false, ..self.or(Numbers::integers(0, 0)) } } else { self }
    }

    /// With the least and the most moved outward to one of a few numbers.
    fn rounded(self) -> Numbers {
        if self.has_no_number() {
            return self;
        }
        let least = if self.least >= 0 {
            0
        } else if self.least >= INT32.0 {
            INT32.0
        } else {
            -MOST_EXACT
        };
        let most = if self.most <= INT32.1 {
            INT32.1
        } else if self.most <= MOST_UINT32 {
            MOST_UINT32
        } else {
            MOST_EXACT
        };
        Numbers { least, most, nil: self.nil }
    }
}

fn either(a: Found, b: Found) -> Found {
    Some(a?.or(b?))
}

fn both(a: Found, b: Found) -> Found {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.and(b)),
        (a, b) => a.or(b),
    }
}

/// How a name is looked at.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum View {
    /// As its value is kept: what the variable holds over its whole life. A narrower answer would have to be tested for.
    Kept,
    /// With all that is known where it is read. It goes into what is computed from the value, which costs nothing.
    Here,
}

/// What variables are taken to hold over their whole lives.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Basis {
    /// What the first step finds.
    Rough,
    /// What the second step finds.
    Exact,
}

/// Something that is stored to a place.
#[derive(Copy, Clone)]
pub(super) enum Store {
    /// The value of the expression: an initializer, the right side of `=`, an argument.
    Value(ExprId),
    /// What the expression, which is `target op= value`, `target++` or the like, computes.
    Computed(ExprId),
    /// A call passes nothing for the parameter.
    Nil,
}

/// A variable, a parameter or a `#private` field.
#[derive(Default)]
pub(super) struct Place {
    /// Everything that is ever stored to it is among `stores`.
    pub(super) is_followed: bool,
    pub(super) stores: Vec<Store>,
    /// It holds `undefined` before anything is stored to it.
    pub(super) starts_nil: bool,
    is_parameter: bool,
    /// Something is stored to it after its declaration.
    is_assigned: bool,
    /// The code that declares it, as far as one control flow goes.
    container: Option<Container>,
    /// Other code stores to it, at a time that the control flow of `container` does not tell.
    is_stored_elsewhere: bool,
    /// What its type says. Every store is held to that.
    by_type: Found,
}

/// What a pass over the expressions of a file finds.
#[derive(Default)]
struct Uses {
    /// What is stored to through `as` or `satisfies`, which the binder does not take for a store.
    stored_through_assertions: FxHashSet<SymbolId>,
    /// By function declaration: the calls by its name. `None`: it is also used as a value.
    calls: FxHashMap<SymbolId, Option<Vec<CallId>>>,
    /// By `#private` field: the accesses that store to it.
    private_stores: FxHashMap<SymbolId, Vec<ExprId>>,
    /// `eval(..)`
    has_direct_eval: bool,
}

/// A test that has turned out so that the variable was from `least` to `most` when it was read at the flow node `at`.
struct Test {
    at: FlowId,
    least: i64,
    most: i64,
}

type Tests = SmallVec<[Test; 4]>;

/// From the read of a variable back to the stores that reach it.
struct Walk {
    at: Sym,
    basis: Basis,
    tests: Tests,
    by_type: Found,
    is_parameter: bool,
    /// By join of paths: what was found there.
    joins: FxHashMap<FlowId, Found>,
    steps: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Child {
    Expr(ExprId),
    Stmt(StmtId),
    Other,
}

#[derive(Default)]
pub(super) struct Shared {
    /// The names that some file leaves to the other files to declare.
    free_names: OnceLock<FxHashSet<Atom>>,
    /// `uses_of_integers_in`
    uses: ByFile<Uses>,
}

#[derive(Default)]
pub(super) struct State {
    places: FxHashMap<Sym, Rc<Place>>,
    /// What the first and the second step have found.
    rough: FxHashMap<Sym, Found>,
    exact: FxHashMap<Sym, Found>,
    /// While the first step is at it: what the places it has come by hold as far as is known, and those places in the order it came by them.
    assumed: FxHashMap<Sym, Found>,
    settling: Vec<Sym>,
    is_settling: bool,
    /// Goes up whenever an entry of `assumed` changes.
    round: u32,
    /// With the `round` that the entry goes for. 0: for good.
    values: FxHashMap<(FileId, ExprId, View, Basis), (Found, u32)>,
    /// By place and head of a loop: whether the loop stores to the place.
    loops: FxHashMap<(Sym, FlowId), bool>,
}

// ───────────────────────────── operators ─────────────────────────────

fn integer(value: f64) -> Found {
    let is_integer = value.fract() == 0.0 && value.abs() <= MOST_COMPUTED as f64 && !(value == 0.0 && value.is_sign_negative());
    is_integer.then(|| Numbers::integers(value as i64, value as i64))
}

/// What `ToInt32` makes of it. `None`: any int32.
fn to_int32(it: Numbers) -> Option<(i64, i64)> {
    let (least, most) = it.with_nil_as_zero().range()?;
    (least >= INT32.0 && most <= INT32.1).then_some((least, most))
}

/// The same for `ToUint32`.
fn to_uint32(it: Numbers) -> Option<(i64, i64)> {
    let (least, most) = it.with_nil_as_zero().range()?;
    (least >= 0 && most <= MOST_UINT32).then_some((least, most))
}

/// The least number of the form 2^k - 1 that `value`, which is not negative, is not above.
fn ones(value: i64) -> i64 {
    (1i64 << (64 - value.leading_zeros())) - 1
}

/// Of the sum of two integers. A RULE OF THE LANGUAGE AS IT IS COMPILED: a count does not pass the last integer that is exact. Where one of the two is a step, what
/// lies beyond is cut off: only a count is that near, and it takes 2^42 steps to get there from what is computed in one go. Compiled code goes on counting exactly then,
/// where a double is rounded. An end of a range that lies at the limit is where a count was cut off, or moved outward to (`Numbers::rounded`).
fn sum(a: (i64, i64), b: (i64, i64)) -> Option<(i64, i64)> {
    let (least, most) = (a.0 + b.0, a.1 + b.1);
    let is_step = |it: (i64, i64)| it.0 >= -MOST_STEP && it.1 <= MOST_STEP;
    if is_step(a) || is_step(b) {
        return Some((least.clamp(-MOST_EXACT, MOST_EXACT), most.clamp(-MOST_EXACT, MOST_EXACT)));
    }
    let is_count = |it: (i64, i64)| it.0 == -MOST_EXACT || it.1 == MOST_EXACT;
    let limit = if is_count(a) || is_count(b) { MOST_EXACT } else { MOST_COMPUTED };
    (least >= -limit && most <= limit).then_some((least, most))
}

/// An operator on 32 bits, which yields a number.
fn bitwise(op: BinOp, a: Found, b: Found) -> (i64, i64) {
    let (x, y) = (a.and_then(to_int32), b.and_then(to_int32));
    let count = y.filter(|y| y.0 == y.1).map(|y| y.0 & 31);
    match op {
        // What is not negative lets through no more than it has.
        BinOp::BitAnd => match [x, y].into_iter().flatten().filter(|it| it.0 >= 0).map(|it| it.1).min() {
            Some(most) => (0, most),
            None => INT32,
        },
        BinOp::BitOr => match (x, y) {
            (Some(x), Some((0, 0))) => x,
            (Some((0, 0)), Some(y)) => y,
            (Some(x), Some(y)) if x.0 >= 0 && y.0 >= 0 => (x.0.max(y.0), ones(x.1.max(y.1))),
            _ => INT32,
        },
        BinOp::BitXor => match (x, y) {
            (Some(x), Some(y)) if x.0 >= 0 && y.0 >= 0 => (0, ones(x.1.max(y.1))),
            _ => INT32,
        },
        BinOp::Shl => match (x, count) {
            (Some(x), Some(count)) if x.0 >= 0 && x.1 << count <= INT32.1 => (x.0 << count, x.1 << count),
            _ => INT32,
        },
        BinOp::Shr => match (x, count) {
            (Some(x), Some(count)) => (x.0 >> count, x.1 >> count),
            (Some(x), None) => (x.0.min(0), x.1.max(-1)),
            _ => INT32,
        },
        _ => match (a.and_then(to_uint32), count) {
            (Some(x), Some(count)) => (x.0 >> count, x.1 >> count),
            (Some(x), None) => (0, x.1),
            (None, Some(count)) => (0, MOST_UINT32 >> count),
            (None, None) => (0, MOST_UINT32),
        },
    }
}

/// `a op b`, for an operator on numbers.
fn combined(op: BinOp, a: Found, b: Found) -> Found {
    if a == Some(Numbers::NOTHING) || b == Some(Numbers::NOTHING) {
        return Some(Numbers::NOTHING);
    }
    let (least, most) = match op {
        // It takes no bigint.
        BinOp::UShr => bitwise(op, a, b),
        // These take two bigints or none, and what something is known of is none.
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr => {
            if a.is_none() && b.is_none() {
                return None;
            }
            bitwise(op, a, b)
        }
        _ => {
            let (a, b) = (a?.numbers()?, b?.numbers()?);
            match op {
                BinOp::Add => sum(a, b)?,
                BinOp::Sub => sum(a, (-b.1, -b.0))?,
                BinOp::Mul => {
                    // Zero times a negative number is negative zero.
                    let has_zero = |it: (i64, i64)| it.0 <= 0 && it.1 >= 0;
                    if has_zero(a) && b.0 < 0 || has_zero(b) && a.0 < 0 {
                        return None;
                    }
                    let products = [a.0 as i128 * b.0 as i128, a.0 as i128 * b.1 as i128, a.1 as i128 * b.0 as i128, a.1 as i128 * b.1 as i128];
                    let least = products.into_iter().fold(i128::MAX, i128::min);
                    let most = products.into_iter().fold(i128::MIN, i128::max);
                    if least < -(MOST_COMPUTED as i128) || most > MOST_COMPUTED as i128 {
                        return None;
                    }
                    (least as i64, most as i64)
                }
                // By zero it is no number. The remainder has the sign of what is divided even where it is zero.
                BinOp::Rem => {
                    if a.0 < 0 || b.0 <= 0 && b.1 >= 0 {
                        return None;
                    }
                    (0, a.1.min(b.0.abs().max(b.1.abs()) - 1))
                }
                _ => return None,
            }
        }
    };
    Some(Numbers::integers(least, most))
}

/// `-a`. Zero negated is negative zero.
fn negated(a: Found) -> Found {
    let a = a?;
    if a == Numbers::NOTHING {
        return Some(a);
    }
    let (least, most) = a.numbers()?;
    (least > 0 || most < 0).then(|| Numbers::integers(-most, -least))
}

/// `a && b`, `a || b`, `a ?? b`. As it is kept, all of `a` that is a number counts: that is what the value is before it is chosen.
fn chosen(op: BinOp, a: Found, b: Found, view: View) -> Found {
    let a = a?;
    let stays = match op {
        BinOp::And if view == View::Here => a.within(0, 0),
        BinOp::And => a,
        BinOp::Or if view == View::Here => a.truthy(),
        _ => Numbers { nil: false, ..a },
    };
    if op == BinOp::Nullish && !a.nil {
        return Some(stays);
    }
    Some(stays.or(b?))
}

/// Whether control never gets from the statement to what follows it.
fn never_completes(hir: &File, stmt: StmtId) -> bool {
    match hir[stmt].kind {
        StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) | StmtKind::Continue(_) => true,
        StmtKind::Block(list) => hir.ids(list).next_back().is_some_and(|last| never_completes(hir, last)),
        StmtKind::If { yes, no, .. } => no.is_some() && never_completes(hir, yes) && never_completes(hir, no),
        _ => false,
    }
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is asked ─────────────────────────────

    /// Every number that the expression can yield is an integer from the first to the second, and not `-0`. What else it can yield, its
    /// type says. Of a name: what the variable holds over its whole life, which is how its value is kept. In an untyped file no type is
    /// gone by, and an answer says besides that the expression yields numbers, `undefined` or `null` and nothing else.
    pub fn integers_of_expr(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        self.numbers_in(file, e, View::Kept, Basis::Exact)?.range()
    }

    /// The same for every number that a variable, a parameter or a `#private` field ever holds. Of a parameter it is known where every
    /// call of the function is: a function declaration that is not exported and only ever called by its name. Of any other field it is
    /// not: whoever gets hold of the object can store to it.
    pub fn integers_of_symbol(&mut self, sym: Sym) -> Option<(i64, i64)> {
        if !self.place_of_integers(sym).is_followed {
            return None;
        }
        self.numbers_held_by(sym, Basis::Exact)?.range()
    }

    /// The same for every number of the type: what is held to the type is one of them. The type `0` is also that of `-0`. A value of the
    /// type of a member of a numeric enum is not that member, nor one of the members: flags are combined, `A | B`, `~A`.
    pub fn integers_of_type(&mut self, ty: TypeId) -> Option<(i64, i64)> {
        self.numbers_by_type(ty)?.range()
    }

    /// The same for one part of the union `of`, whatever the other parts are.
    pub fn integers_of_part(&mut self, part: TypeId, of: TypeId) -> Option<(i64, i64)> {
        let is_beside_enum = self.has_member_of_numeric_enum(of);
        self.numbers_by_part(part, is_beside_enum)?.range()
    }

    /// Of `target++`, `--target` and the like: the number that the target holds before.
    pub fn integers_before_update(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        let ExprKind::Unary { operand, .. } = self.hir(file)[e].kind else { return None };
        self.numbers_in(file, operand, View::Here, Basis::Exact)?.numbers()
    }

    /// Of those, and of `target op= value`: the number that is stored to the target.
    pub fn integers_stored_by(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        self.numbers_computed_by(file, e, Basis::Exact)?.range()
    }

    // ───────────────────────────── types ─────────────────────────────

    fn numbers_by_type(&mut self, ty: TypeId) -> Found {
        if ty.is_never() {
            return None;
        }
        let is_beside_enum = self.has_member_of_numeric_enum(ty);
        let mut all = Numbers::NOTHING;
        for &part in self.parts(ty) {
            all = all.or(self.numbers_by_part(part, is_beside_enum)?);
        }
        Some(Numbers { nil: all.nil || self.admits_nil(ty), ..all })
    }

    fn has_member_of_numeric_enum(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::EnumLit { value: EnumValue::Number(_), .. }))
    }

    /// `x === 0` makes a `0` of a number that may be `-0`, and nothing tests it. So the type `0` says nothing. No test makes
    /// `TypeFlags | 0` of a number: a value of that type comes out of a place of that type, which holds int32s like a place for the enum.
    fn numbers_by_part(&self, part: TypeId, is_beside_enum: bool) -> Found {
        match self.data(part) {
            TypeData::NumberLit { bits, .. } => integer(f64::from_bits(*bits)).filter(|it| it.least != 0 || is_beside_enum),
            TypeData::EnumLit { value: EnumValue::Number(bits), .. } => {
                integer(f64::from_bits(*bits)).filter(|it| it.least >= INT32.0 && it.most <= INT32.1)?;
                Some(Numbers::integers(INT32.0, INT32.1))
            }
            _ if part.is_undefined() || part.is_null() => Some(Numbers::NIL),
            _ => None,
        }
    }

    fn is_type_of_numbers(&self, ty: TypeId) -> bool {
        !ty.is_never() && self.every_type(ty, |c, part| c.is_number_like(part))
    }

    /// Whether the value of the expression is of the checker's type of it. Where nothing holds the program to the types of the file, no type is
    /// gone by: what an expression is, its text shows (`kinds.rs`) or nothing does.
    fn goes_by_its_type(&mut self, file: FileId, e: ExprId) -> bool {
        !self.is_untyped_file(file) && self.has_declared_type(file, e)
    }

    /// The type that the value of the expression is of for a fact, and whether it may be `undefined` besides. What a coercion yields is
    /// not looked at, and it goes where the value goes: `x as Small`, `const n = x as 1 | 2 | 3; n`, `(foo as Item[]).length`.
    fn type_relied_on(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let (held, may_be_undefined) = self.type_held_to(file, e);
        let yielded = self.type_yielded_by(file, e);
        (if yielded != self.type_of_expr(file, e) { yielded } else { held }, may_be_undefined)
    }

    pub(super) fn is_instance_of_global(&self, ty: TypeId, names: &[&[u8]]) -> bool {
        // `Int32Array & { 0: number }`: the other types only say more of its properties.
        if let TypeData::Intersection(parts) = self.data(ty) {
            return parts.iter().any(|&part| self.is_instance_of_global(part, names));
        }
        let TypeData::Ref { target, .. } = self.data(ty) else { return false };
        let name = self.files().symbol(*target).name;
        // An anonymous class has none.
        if name.is_none() {
            return false;
        }
        let text = self.atoms().bytes(name);
        names.iter().any(|&it| it == text) && self.global_type_symbol(name) == Some(*target)
    }

    /// The most that `length` of a value of the type can be. `None`: it is not only strings and arrays. Of those it is their own property, and
    /// nothing can be put in its place. Of a typed array it is a getter of the prototype, which an own property shadows.
    fn most_length_of(&mut self, ty: TypeId) -> Option<i64> {
        let mut most = None;
        for &part in self.parts(ty) {
            let of_part = if self.is_string_like(part) {
                MOST_STRING_LENGTH
            // Also what a class that extends `Array` makes. Not `any`, which is assignable to everything.
            } else if !self.says_nothing(part) && self.is_array_like(part) {
                MOST_ARRAY_LENGTH
            } else {
                return None;
            };
            most = Some(most.map_or(of_part, |most: i64| most.max(of_part)));
        }
        most
    }

    /// The numbers that `obj[index]` can yield, where `obj` is a typed array of integers and `index` a number.
    fn numbers_of_element(&mut self, file: FileId, obj: ExprId, index: ExprId) -> Found {
        let key = self.type_relied_on(file, index).0;
        let ty = self.type_relied_on(file, obj).0;
        if !self.is_type_of_numbers(key) || ty.is_never() {
            return None;
        }
        let mut all = Numbers::NOTHING;
        for &part in self.parts(ty) {
            let &(_, least, most) = ARRAYS_OF_INTEGERS.iter().find(|it| self.is_instance_of_global(part, &[it.0]))?;
            all = all.or(Numbers::integers(least, most));
        }
        Some(all)
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn numbers_in(&mut self, file: FileId, e: ExprId, view: View, basis: Basis) -> Found {
        if e.is_none() {
            return None;
        }
        let key = (file, e, view, basis);
        let state = &self.aot.integers;
        if let Some(&(found, round)) = state.values.get(&key)
            && (round == 0 || state.is_settling && round == state.round)
        {
            return found;
        }
        if self.is_half_of_stack_in_use() {
            return None;
        }
        let mut found = self.numbers_by_syntax(file, e, view, basis);
        let kind = self.hir(file)[e].kind;
        let has_type_of_its_own = matches!(
            kind,
            ExprKind::Ident(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::As { .. }
                | ExprKind::NonNull(_)
        );
        if has_type_of_its_own && self.goes_by_its_type(file, e) {
            let (ty, may_be_undefined) = self.type_relied_on(file, e);
            let by_type = self.numbers_by_type(ty);
            if let ExprKind::Index { obj, index, .. } = kind {
                // Outside the array, or where the object has no such key, it yields `undefined`, whatever the type says.
                found = both(by_type, self.numbers_of_element(file, obj, index)).map(|it| Numbers { nil: true, ..it });
            } else {
                found = both(found, by_type);
                if let Some(found) = &mut found {
                    found.nil = if self.is_type_of_numbers(ty) { may_be_undefined } else { found.nil || may_be_undefined };
                }
            }
        }
        let state = &mut self.aot.integers;
        let round = if state.is_settling { state.round } else { 0 };
        state.values.insert(key, (found, round));
        found
    }

    fn numbers_by_syntax(&mut self, file: FileId, e: ExprId, view: View, basis: Basis) -> Found {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Number(index) => integer(hir.numbers[index as usize]),
            ExprKind::Null => Some(Numbers::NIL),
            ExprKind::Ident(name) => self.numbers_of_name(file, e, name, view, basis),
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void => Some(Numbers::NIL),
                UnOp::Minus => negated(self.numbers_in(file, operand, View::Here, basis)),
                // What is a number stays what it is.
                UnOp::Plus | UnOp::PostInc | UnOp::PostDec => {
                    let operand = self.numbers_in(file, operand, View::Here, basis)?;
                    if operand == Numbers::NOTHING {
                        return Some(operand);
                    }
                    operand.numbers().map(|(least, most)| Numbers::integers(least, most))
                }
                UnOp::BitNot => match self.numbers_truncated(file, operand, basis) {
                    Some(Numbers::NOTHING) => Some(Numbers::NOTHING),
                    Some(operand) => Some(match to_int32(operand) {
                        Some((least, most)) => Numbers::integers(-most - 1, -least - 1),
                        None => Numbers::integers(INT32.0, INT32.1),
                    }),
                    None => self.is_number_by_its_type(file, e).then(|| Numbers::integers(INT32.0, INT32.1)),
                },
                UnOp::PreInc | UnOp::PreDec => self.numbers_computed_by(file, e, basis),
                UnOp::Not | UnOp::Typeof | UnOp::Delete => None,
            },
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => self.numbers_in(file, right, view, basis),
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    let (a, b) = (self.numbers_in(file, left, view, basis), self.numbers_in(file, right, view, basis));
                    chosen(op, a, b, view)
                }
                _ => self.numbers_of_binary(file, e, op, left, right, basis),
            },
            ExprKind::Assign { op, target, value } => match op {
                None => self.numbers_in(file, value, view, basis),
                Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)) => {
                    let (a, b) = (self.numbers_in(file, target, view, basis), self.numbers_in(file, value, view, basis));
                    chosen(op, a, b, view)
                }
                Some(_) => self.numbers_computed_by(file, e, basis),
            },
            ExprKind::Cond { yes, no, .. } => either(self.numbers_in(file, yes, view, basis), self.numbers_in(file, no, view, basis)),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Instantiation { expr, .. } => self.numbers_in(file, expr, view, basis),
            ExprKind::As { expr, .. } | ExprKind::NonNull(expr) if self.is_untyped_file(file) => self.numbers_in(file, expr, view, basis),
            // `as` converts what is of no kind that the type has: `undefined as number` is NaN, `null as number` zero, `5 as boolean` true. A
            // number stays itself where the type has numbers, and anything does where the type says nothing.
            ExprKind::As { expr, .. } => {
                let operand = self.numbers_in(file, expr, view, basis)?;
                let target = self.type_of_expr(file, e);
                let stays_itself = operand == Numbers::NOTHING || self.says_nothing(target) || !operand.nil && self.some_type(target, |c, part| c.is_number_like(part));
                stays_itself.then_some(operand)
            }
            ExprKind::NonNull(expr) => self.numbers_in(file, expr, view, basis).map(|it| Numbers { nil: false, ..it }),
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => self.numbers_of_property(file, e, obj, name, basis),
            ExprKind::Call(call) => self.numbers_of_call(file, e, call, basis),
            _ => None,
        }
    }

    /// Whether the checker has the expression, which is an operation, yield numbers and nothing else. What compiles it sees to that.
    fn is_number_by_its_type(&mut self, file: FileId, e: ExprId) -> bool {
        // `a & 1`: a number and a bigint do not mix.
        if self.is_untyped_file(file) {
            return self.kinds_yielded_by(file, e) == kind::NUMBER;
        }
        if !self.goes_by_its_type(file, e) {
            return false;
        }
        let ty = self.type_of_expr(file, e);
        self.is_type_of_numbers(ty)
    }

    /// `left op right`, for an operator on numbers. `e`: the whole, also where it is `left op= right`.
    fn numbers_of_binary(&mut self, file: FileId, e: ExprId, op: BinOp, left: ExprId, right: ExprId, basis: Basis) -> Found {
        let is_bitwise = matches!(op, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr);
        if !is_bitwise {
            if !matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem) {
                return None;
            }
            let (a, b) = (self.numbers_in(file, left, View::Here, basis), self.numbers_in(file, right, View::Here, basis));
            return combined(op, a, b);
        }
        let (a, b) = (self.numbers_truncated(file, left, basis), self.numbers_truncated(file, right, basis));
        match combined(op, a, b) {
            // Of two numbers it is an int32.
            None => self.is_number_by_its_type(file, e).then(|| Numbers::integers(INT32.0, INT32.1)),
            found => found,
        }
    }

    /// The expression as an operator on 32 bits takes it, which drops what comes after the point.
    fn numbers_truncated(&mut self, file: FileId, e: ExprId, basis: Basis) -> Found {
        match self.hir(file)[e].kind {
            ExprKind::Binary { op: BinOp::Div, left, right } => self.numbers_of_quotient(file, left, right, basis),
            _ => self.numbers_in(file, e, View::Here, basis),
        }
    }

    /// `left / right` without what comes after the point, where neither is negative. The quotient of two integers that are exact is not
    /// rounded up to the next integer: the two are too far apart for that.
    fn numbers_of_quotient(&mut self, file: FileId, left: ExprId, right: ExprId, basis: Basis) -> Found {
        let (a, b) = (self.numbers_in(file, left, View::Here, basis)?, self.numbers_in(file, right, View::Here, basis)?);
        if a == Numbers::NOTHING || b == Numbers::NOTHING {
            return Some(Numbers::NOTHING);
        }
        let (a, b) = (a.numbers()?, b.numbers()?);
        (a.0 >= 0 && b.0 > 0).then(|| Numbers::integers(a.0 / b.1, a.1 / b.0))
    }

    /// What `target op= value`, `target++` or the like stores.
    fn numbers_computed_by(&mut self, file: FileId, e: ExprId, basis: Basis) -> Found {
        let (op, operand) = match self.hir(file)[e].kind {
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PostInc, operand } => (BinOp::Add, operand),
            ExprKind::Unary { op: UnOp::PreDec | UnOp::PostDec, operand } => (BinOp::Sub, operand),
            ExprKind::Assign { op: Some(op), target, value } => return self.numbers_of_binary(file, e, op, target, value, basis),
            _ => return None,
        };
        combined(op, self.numbers_in(file, operand, View::Here, basis), Some(Numbers::integers(1, 1)))
    }

    // ───────────────────────────── names, properties, calls ─────────────────────────────

    fn numbers_of_name(&mut self, file: FileId, e: ExprId, name: Atom, view: View, basis: Basis) -> Found {
        let bound = self.bound(file);
        let local = bound.expr_symbol[e.idx()];
        if local.is_none() {
            // Nothing can be stored to the `undefined` of the global object.
            return (name == known::undefined).then_some(Numbers::NIL);
        }
        let mut at = Sym { file, id: local };
        if bound.symbols[local.idx()].flags.contains(SymFlags::ALIAS) {
            at = self.files().resolve_alias(self.files().sym(file, local))?;
            // What is found in JavaScript is a prediction.
            if self.is_untyped_file(at.file) && !self.is_untyped_file(file) {
                return None;
            }
        }
        let place = self.place_of_integers(at);
        if !place.is_followed {
            return None;
        }
        let held = self.numbers_held_by(at, basis);
        if view == View::Kept || at.file != file {
            return held;
        }
        // Between a test or a store and the read, code that the control flow does not tell of may store to it.
        let is_read_elsewhere = place.container != Some(self.container_of_flow(file, bound.expr_parent[e.idx()]));
        let is_constant = !place.is_assigned && !place.starts_nil;
        let is_no_more_known = if is_constant { held.is_none() } else { place.is_stored_elsewhere || is_read_elsewhere };
        if is_no_more_known {
            return held;
        }
        let Some(tests) = self.tests_passed_before(file, e, at, basis) else { return held };
        if is_constant {
            // It is what it was when it was tested.
            return held.map(|held| tests.iter().fold(held, |held, test| held.within(test.least, test.most)));
        }
        let flow = bound.expr_flow[e.idx()];
        if flow.is_none() || flow == UNREACHABLE {
            return held;
        }
        let mut walk = Walk { at, basis, tests, by_type: place.by_type, is_parameter: place.is_parameter, joins: FxHashMap::default(), steps: 0 };
        self.numbers_at(&mut walk, flow)
    }

    /// The `#private` field that `e`, which is `obj.name`, names. `NONE`: it names none.
    pub(super) fn private_field_named_by(&self, file: FileId, e: ExprId, name: Atom) -> SymbolId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&class) = bound.private_class.get(&e) else { return SymbolId::NONE };
        let member = hir[class].members.iter().find(|&member| hir[member].key == PropKey::Private(name));
        member.map_or(SymbolId::NONE, |member| bound.member_symbol[member.idx()])
    }

    /// `e`, which is `obj.name`.
    fn numbers_of_property(&mut self, file: FileId, e: ExprId, obj: ExprId, name: Atom, basis: Basis) -> Found {
        let field = self.private_field_named_by(file, e, name);
        if field.is_some() {
            let at = Sym { file, id: field };
            return if self.place_of_integers(at).is_followed { self.numbers_held_by(at, basis) } else { None };
        }
        if name != known::length {
            return None;
        }
        if self.is_untyped_file(file) {
            return match self.kinds_yielded_by(file, obj) {
                kind::STRING => Some(Numbers::integers(0, MOST_STRING_LENGTH)),
                kind::ARRAY => Some(Numbers::integers(0, MOST_ARRAY_LENGTH)),
                of if of == kind::ARRAY | kind::STRING => Some(Numbers::integers(0, MOST_ARRAY_LENGTH.max(MOST_STRING_LENGTH))),
                _ => None,
            };
        }
        if !self.goes_by_its_type(file, e) {
            return None;
        }
        let ty = self.type_relied_on(file, obj).0;
        let most = self.most_length_of(ty)?;
        Some(Numbers::integers(0, most))
    }

    /// Whether the expression is the name of the global object `name`, which a declaration file declares and nothing in the program does.
    pub(super) fn names_global_object(&mut self, file: FileId, e: ExprId, name: &[u8]) -> bool {
        let ExprKind::Ident(written) = self.hir(file)[e].kind else { return false };
        self.bound(file).expr_symbol[e.idx()].is_none()
            && self.atoms().bytes(written) == name
            && self.symbol_of_identifier(file, e, written).is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
    }

    /// A call of a built-in function that yields an integer whenever it yields. Nothing can be put in the place of one: a function of `Math`, a
    /// method of a string, which has no properties of its own. Not a method of an array: an own property shadows it, and may yield
    /// any number.
    fn numbers_of_call(&mut self, file: FileId, e: ExprId, call: CallId, basis: Basis) -> Found {
        let hir = self.hir(file);
        let call = &hir[call];
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[call.callee].kind else { return None };
        if call.chain != Chain::No || hir.ids(call.args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            return None;
        }
        let name = self.atoms().bytes(name);
        if self.names_global_object(file, obj, b"Math") {
            return self.numbers_of_math(file, name, call.args, basis);
        }
        let is_untyped = self.is_untyped_file(file);
        if !matches!(name, b"indexOf" | b"lastIndexOf" | b"search" | b"codePointAt") || !is_untyped && !self.goes_by_its_type(file, e) {
            return None;
        }
        let is_string = |c: &mut Self, e: ExprId| {
            if is_untyped {
                return c.kinds_yielded_by(file, e) == kind::STRING;
            }
            let ty = c.type_relied_on(file, e).0;
            !ty.is_never() && c.every_type(ty, |c, part| c.is_string_like(part))
        };
        if !is_string(self, obj) {
            return None;
        }
        match name {
            b"codePointAt" => Some(Numbers { least: 0, most: 0x10FFFF, nil: true }),
            // It hands over to `Symbol.search` of what it is given, which yields what it likes. A string is made a RegExp of the engine.
            b"search" if !hir.ids(call.args).next().is_some_and(|pattern| is_string(self, pattern)) => None,
            _ => Some(Numbers::integers(-1, MOST_STRING_LENGTH)),
        }
    }

    /// `Math.name(args)`
    fn numbers_of_math(&mut self, file: FileId, name: &[u8], args: IdList<ExprId>, basis: Basis) -> Found {
        let hir = self.hir(file);
        match name {
            // They make an int32 of whatever they are given, and throw for a bigint.
            b"imul" => return Some(Numbers::integers(INT32.0, INT32.1)),
            b"clz32" => return Some(Numbers::integers(0, 32)),
            b"floor" | b"trunc" => {
                if let Some(arg) = hir.ids(args).next()
                    && let ExprKind::Binary { op: BinOp::Div, left, right } = hir[arg].kind
                {
                    return self.numbers_of_quotient(file, left, right, basis);
                }
            }
            b"ceil" | b"round" | b"abs" | b"sign" | b"min" | b"max" => {}
            _ => return None,
        }
        let mut given: SmallVec<[(i64, i64); 4]> = SmallVec::new();
        for arg in hir.ids(args) {
            let arg = self.numbers_in(file, arg, View::Here, basis)?;
            if arg == Numbers::NOTHING {
                return Some(arg);
            }
            given.push(arg.numbers()?);
        }
        let &(least, most) = given.first()?;
        Some(match name {
            b"min" => Numbers::integers(given.iter().fold(least, |least, it| least.min(it.0)), given.iter().fold(most, |most, it| most.min(it.1))),
            b"max" => Numbers::integers(given.iter().fold(least, |least, it| least.max(it.0)), given.iter().fold(most, |most, it| most.max(it.1))),
            b"abs" if least >= 0 => Numbers::integers(least, most),
            b"abs" if most <= 0 => Numbers::integers(-most, -least),
            b"abs" => Numbers::integers(0, most.max(-least)),
            b"sign" => Numbers::integers(least.signum(), most.signum()),
            // An integer is left as it is.
            _ => Numbers::integers(least, most),
        })
    }

    // ───────────────────────────── places ─────────────────────────────

    /// The code that a direct child of `parent` is part of, as far as one control flow goes. A function that is called where it is written
    /// counts as a function: an `async` one goes on after the code around it has.
    pub(super) fn container_of_flow(&self, file: FileId, mut parent: Parent) -> Container {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return Container::Fn(func),
                Parent::ParamDefault(p) => return Container::Fn(bound.param_fn[p.idx()]),
                Parent::MemberInit(member) => return Container::Member(member),
                Parent::Module(module) => return Container::Module(module),
                Parent::File => return Container::File,
                Parent::None => return Container::Other,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    fn is_labeled_statement(&self, file: FileId, stmt: StmtId) -> bool {
        matches!(self.bound(file).stmt_parent[stmt.idx()], Parent::Stmt(label) if label.is_some() && matches!(self.hir(file)[label].kind, StmtKind::Labeled { .. }))
    }

    /// Whether the flow nodes do not tell when the expression is evaluated. As the binder has it, `continue` with the label of a `for` loop
    /// goes to the head of the loop, past the update; `break` and `continue` leave a `try` statement past its `finally` block; and
    /// every test of a `switch` is the first.
    pub(super) fn runs_off_the_flow(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut child = Child::Expr(e);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            match parent {
                Parent::Case(_) => return true,
                Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                    StmtKind::For { update, .. } if child == Child::Expr(update) && self.is_labeled_statement(file, outer) => return true,
                    StmtKind::Try { finalizer, .. } if child == Child::Stmt(finalizer) => return true,
                    _ => {}
                },
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => return false,
                _ => {}
            }
            child = match parent {
                Parent::Expr(outer) => Child::Expr(outer),
                Parent::Stmt(outer) => Child::Stmt(outer),
                _ => Child::Other,
            };
            parent = self.parent_of_node(file, parent);
        }
    }

    /// The variable or the `#private` field that the expression names, whatever it is asserted to be. `NONE`: it names neither.
    fn place_named_by(&self, file: FileId, mut e: ExprId) -> SymbolId {
        let hir = self.hir(file);
        loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => e = expr,
                ExprKind::Ident(_) => return self.bound(file).expr_symbol[e.idx()],
                ExprKind::Dot { name, .. } => return self.private_field_named_by(file, e, name),
                _ => return SymbolId::NONE,
            }
        }
    }

    /// The checker that asks first finds them, from the tree and the symbols of the file alone.
    fn uses_of_integers_in(&self, file: FileId) -> &'p Uses {
        let program = self.p;
        program.aot.integers.uses.get_or_init(program.files.modules.len(), file, || self.find_uses_of_integers_in(file))
    }

    /// Whether the variable or the parameter is stored to as `(a as T) = value`, which the binder does not take for a store.
    pub(super) fn is_stored_through_assertions(&self, file: FileId, symbol: SymbolId) -> bool {
        self.uses_of_integers_in(file).stored_through_assertions.contains(&symbol)
    }

    /// Whether the file has an `eval(..)`, which names what it likes.
    pub(super) fn has_direct_eval(&self, file: FileId) -> bool {
        self.uses_of_integers_in(file).has_direct_eval
    }

    fn find_uses_of_integers_in(&self, file: FileId) -> Uses {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind_of(file);
        let mut uses = Uses::default();
        let is_eval = |call: &ExprId| matches!(hir[*call].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name) == b"eval"));
        uses.has_direct_eval = by_kind.of(ExprTag::Call).iter().any(is_eval);
        uses.stored_through_assertions.extend(self.variables_of_reified_namespaces(file));
        for tag in [ExprTag::As, ExprTag::Satisfies] {
            for &e in by_kind.of(tag) {
                if bound.get_assignment_target(hir, e).is_some() {
                    uses.stored_through_assertions.insert(self.place_named_by(file, e));
                }
            }
        }
        for &e in by_kind.of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            if symbol.is_none() || !bound.symbols[symbol.idx()].flags.contains(SymFlags::FUNCTION) || bound.is_unchecked(e.idx()) || bound.is_in_type_query(e) {
                continue;
            }
            let call = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(call) if hir[call].callee == e && hir[call].chain == Chain::No => Some(call),
                    _ => None,
                },
                _ => None,
            };
            let calls = uses.calls.entry(symbol).or_insert_with(|| Some(Vec::new()));
            match call {
                Some(call) => calls.iter_mut().for_each(|calls| calls.push(call)),
                None => *calls = None,
            }
        }
        if !bound.private_class.is_empty() {
            for &e in by_kind.of(ExprTag::Dot) {
                let field = self.place_named_by(file, e);
                if field.is_some() && bound.get_assignment_target(hir, e).is_some() {
                    uses.private_stores.entry(field).or_default().push(e);
                }
            }
        }
        uses
    }

    /// Whether only the file itself refers to what it declares at its top level by the name. What a script declares there, every file sees.
    fn is_seen_by_its_file_only(&mut self, file: FileId, name: Atom) -> bool {
        if self.files().module(file).is_module() {
            return true;
        }
        let free_names = self.p.aot.integers.free_names.get_or_init(|| {
            let mut names = FxHashSet::default();
            for module in self.files().modules.iter().filter(|module| !module.is_opaque()) {
                for &(e, _) in module.bound.free_idents.iter() {
                    if let ExprKind::Ident(name) = module.hir[e].kind {
                        names.insert(name);
                    }
                }
            }
            names
        });
        !free_names.contains(&name)
    }

    pub(super) fn place_of_integers(&mut self, at: Sym) -> Rc<Place> {
        if let Some(known) = self.aot.integers.places.get(&at) {
            return Rc::clone(known);
        }
        let place = Rc::new(self.stores_to_place(at).unwrap_or_default());
        self.aot.integers.places.insert(at, Rc::clone(&place));
        place
    }

    /// `None`: not every store to it is seen, or it is no place.
    fn stores_to_place(&mut self, at: Sym) -> Option<Place> {
        let file = at.file;
        let bound = self.bound(file);
        let symbol = bound.symbols.get(at.id.idx())?;
        let uses = self.uses_of_integers_in(file);
        if symbol.flags.contains(SymFlags::MERGED) || uses.stored_through_assertions.contains(&at.id) || uses.has_direct_eval {
            return None;
        }
        let mut place = Place { is_followed: true, ..Place::default() };
        for &decl in symbol.decls.iter() {
            let declared_in = match decl {
                Decl::Var(pat) => self.add_initializer_of_variable(file, pat, symbol.name, &mut place)?,
                Decl::Param(pat) => self.add_arguments_for_parameter(file, pat, uses, &mut place)?,
                Decl::Member(member) => self.add_initializer_of_private_field(file, member, &mut place)?,
                _ => return None,
            };
            if *place.container.get_or_insert(declared_in) != declared_in && !matches!(declared_in, Container::Other) {
                return None;
            }
        }
        let names = bound.assignments_to(at.id).iter().map(|&(_, target)| target);
        let targets: Vec<ExprId> = names.chain(uses.private_stores.get(&at.id).into_iter().flatten().copied()).collect();
        for target in targets {
            place.stores.push(self.store_to_target(file, target)?);
            place.is_assigned = true;
            place.is_stored_elsewhere |= place.container != Some(self.container_of_flow(file, bound.expr_parent[target.idx()])) || self.runs_off_the_flow(file, target);
        }
        if !self.is_untyped_file(file) {
            let ty = self.type_stored_to(self.files().sym(file, at.id));
            place.by_type = self.numbers_by_type(ty);
        }
        Some(place)
    }

    /// What is stored to a variable: the values of its initializer and of `=`, `||=`, `&&=`, `??=`, and the expressions `target op= value`, `target++` that compute what they
    /// store. `None`: not every store to it is seen.
    pub(super) fn expressions_stored_to(&mut self, at: Sym) -> Option<(Vec<ExprId>, Vec<ExprId>)> {
        let place = self.place_of_integers(at);
        if !place.is_followed {
            return None;
        }
        let (mut values, mut computed) = (Vec::new(), Vec::new());
        for store in &place.stores {
            match *store {
                Store::Value(value) => values.push(value),
                Store::Computed(by) => computed.push(by),
                Store::Nil => return None,
            }
        }
        Some((values, computed))
    }

    /// How `target`, which something is stored to, gets its value. `None`: in a way that is not followed, as part of a pattern.
    pub(super) fn store_to_target(&self, file: FileId, target: ExprId) -> Option<Store> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[target.idx()] else { return None };
        match hir[parent.some()?].kind {
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => Some(Store::Computed(parent)),
            // Not what a pattern falls back on: `[target = 1] = list`.
            ExprKind::Assign { op, target: to, value } if to == target && !bound.is_shorthand_property_assignment(hir, parent) && bound.get_assignment_target(hir, parent).is_none() => {
                Some(match op {
                    None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => Store::Value(value),
                    Some(_) => Store::Computed(parent),
                })
            }
            _ => None,
        }
    }

    /// `pat` is the name that a `var`, `let`, `const` or `using` declares. Yields the code that declares it.
    fn add_initializer_of_variable(&mut self, file: FileId, pat: PatId, name: Atom, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What a pattern takes out of an object or an iterator is not followed.
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
        let (declaration, stmt) = (&hir[d], bound.var_stmt[d.idx()].some()?);
        // Nor is what a `catch` clause is handed.
        if declaration.flags.contains(Flags::AMBIENT) || !matches!(hir[stmt].kind, StmtKind::Var(_)) {
            return None;
        }
        let around = bound.stmt_parent[stmt.idx()];
        if matches!(around, Parent::Stmt(head) if head.is_some() && matches!(hir[head].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt)) {
            return None;
        }
        let declared_in = self.container_of_flow(file, around);
        match declared_in {
            Container::File if (matches!(around, Parent::File) || declaration.kind == VarKind::Var) && !self.is_seen_by_its_file_only(file, name) => return None,
            // `N.name = value`, from anywhere.
            Container::Module(_) if declaration.flags.contains(Flags::EXPORT) => return None,
            Container::Other => return None,
            _ => {}
        }
        match declaration.init.some() {
            Some(init) => {
                place.stores.push(Store::Value(init));
                place.is_stored_elsewhere |= self.runs_off_the_flow(file, init);
            }
            None => place.starts_nil = true,
        }
        // It is there before its declaration is come by. Whether anything reads it by then is known.
        place.starts_nil |= self.starts_undefined(self.files().sym(file, bound.pat_symbol[pat.idx()]));
        Some(declared_in)
    }

    fn add_initializer_of_private_field(&mut self, file: FileId, member: MemberId, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let m = &hir[member];
        let is_field = m.kind == MemberKind::Property && matches!(m.key, PropKey::Private(_)) && matches!(bound.member_owner[member.idx()], MemberOwner::Class(_));
        if !is_field || m.flags.intersects(Flags::ACCESSOR | Flags::AMBIENT) {
            return None;
        }
        match m.init.some() {
            Some(init) => place.stores.push(Store::Value(init)),
            None => place.starts_nil = true,
        }
        // No control flow tells when a field of which object is stored to.
        Some(Container::Other)
    }

    /// Whether the function, or an arrow function in it, mentions its `arguments` object.
    pub(super) fn mentions_arguments_object(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        bound.arguments_objects.iter().any(|&e| {
            let mut around = self.enclosing_fn_of_expr(file, e);
            while let Some(arrow) = around.filter(|&it| hir[it].kind == FnKind::Arrow) {
                around = bound.fns[arrow.idx()].enclosing.some();
            }
            around == Some(func)
        })
    }

    /// `pat` is the name of a parameter. Every call of the function has to be seen.
    fn add_arguments_for_parameter(&mut self, file: FileId, pat: PatId, uses: &Uses, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else { return None };
        let func = bound.param_fn[p.idx()];
        let (f, param) = (&hir[func], &hir[p]);
        if f.kind != FnKind::Decl
            || matches!(f.body, FnBody::None)
            || f.flags.intersects(Flags::EXPORT | Flags::DEFAULT | Flags::AMBIENT)
            || param.flags.intersects(Flags::REST | Flags::PARAMETER_PROPERTY)
        {
            return None;
        }
        // A function and nothing else, with one body.
        let id = bound.fn_symbol[func.idx()];
        let symbol = bound.symbols.get(id.idx())?;
        let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
        let bodies = symbol.decls.iter().filter(|decl| matches!(**decl, Decl::Fn(it) if !matches!(hir[it].body, FnBody::None))).count();
        if symbol.flags.intersects(is_more) || bodies != 1 || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_))) {
            return None;
        }
        // `export { name }`
        if hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == f.name)) {
            return None;
        }
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return None };
        if matches!(bound.stmt_parent[stmt.idx()], Parent::File) && !self.is_seen_by_its_file_only(file, f.name) {
            return None;
        }
        // In JavaScript a function in a block is a `var` besides, by which it is called from outside the block.
        if hir.is_js && !matches!(bound.stmt_parent[stmt.idx()], Parent::File | Parent::FnBody(_)) {
            return None;
        }
        // Through `arguments` a parameter can be stored to, and the function be had as a value.
        if self.mentions_arguments_object(file, func) {
            return None;
        }
        // A function that the body declares by the name takes the place of what is passed. The binder gives it a symbol of its own.
        let name = bound.symbols.get(bound.pat_symbol[pat.idx()].idx())?.name;
        if matches!(f.body, FnBody::Block(body) if hir.ids(body).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(inner) if hir[inner].name == name))) {
            return None;
        }
        let index = f.params.iter().position(|it| it == p)?;
        place.is_parameter = true;
        place.stores.extend(param.default.some().map(Store::Value));
        for &call in uses.calls.get(&id).map_or(Some(&[][..]), |calls| calls.as_deref())? {
            let args = hir[call].args;
            if hir.ids(args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
                return None;
            }
            place.stores.push(hir.ids(args).nth(index).map_or(Store::Nil, Store::Value));
        }
        Some(Container::Fn(func))
    }

    // ───────────────────────────── what a place holds over its whole life ─────────────────────────────

    fn numbers_held_by(&mut self, at: Sym, basis: Basis) -> Found {
        match basis {
            Basis::Rough => self.numbers_held_roughly(at),
            Basis::Exact => {
                if let Some(&known) = self.aot.integers.exact.get(&at) {
                    return known;
                }
                let found = self.numbers_stored_to(at);
                self.aot.integers.exact.insert(at, found);
                found
            }
        }
    }

    /// The first step. It starts from no place holding anything, and goes through the stores to all the places it comes by until nothing
    /// is stored anywhere that is not held there already.
    fn numbers_held_roughly(&mut self, at: Sym) -> Found {
        let state = &mut self.aot.integers;
        if let Some(&settled) = state.rough.get(&at) {
            return settled;
        }
        if let Some(&assumed) = state.assumed.get(&at) {
            return assumed;
        }
        state.assumed.insert(at, Some(Numbers::NOTHING));
        state.settling.push(at);
        if state.is_settling {
            return Some(Numbers::NOTHING);
        }
        state.is_settling = true;
        state.round += 1;
        loop {
            let mut has_changed = false;
            let mut next = 0;
            while let Some(&place) = self.aot.integers.settling.get(next) {
                next += 1;
                let Some(&Some(so_far)) = self.aot.integers.assumed.get(&place) else { continue };
                let found = self.numbers_stored_to(place).map(|found| so_far.or(found.rounded()));
                if found != Some(so_far) {
                    let state = &mut self.aot.integers;
                    state.assumed.insert(place, found);
                    state.round += 1;
                    has_changed = true;
                }
            }
            if !has_changed {
                break;
            }
        }
        let state = &mut self.aot.integers;
        state.is_settling = false;
        state.settling.clear();
        let settled = std::mem::take(&mut state.assumed);
        let found = settled.get(&at).copied().flatten();
        state.rough.extend(settled);
        found
    }

    /// All that is stored to the place, given what the first step has places hold.
    fn numbers_stored_to(&mut self, at: Sym) -> Found {
        let place = self.place_of_integers(at);
        if !place.is_followed {
            return None;
        }
        // A type that says which integers is gone by: that is how the place is described.
        if let Some(by_type) = place.by_type
            && !by_type.has_no_number()
        {
            return Some(Numbers { nil: by_type.nil || place.starts_nil, ..by_type });
        }
        let mut all = if place.starts_nil { Numbers::NIL } else { Numbers::NOTHING };
        for &store in &place.stores {
            all = all.or(self.numbers_stored_by(at.file, store, View::Kept, Basis::Rough)?);
        }
        Some(all)
    }

    fn numbers_stored_by(&mut self, file: FileId, store: Store, view: View, basis: Basis) -> Found {
        match store {
            Store::Value(e) => self.numbers_in(file, e, view, basis),
            Store::Computed(e) => self.numbers_computed_by(file, e, basis),
            Store::Nil => Some(Numbers::NIL),
        }
    }

    // ───────────────────────────── what a variable holds where it is read ─────────────────────────────

    /// What the variable holds when control is at the flow node, on its way to the read.
    fn numbers_at(&mut self, walk: &mut Walk, start: FlowId) -> Found {
        let bound = self.bound(walk.at.file);
        let (mut least, mut most) = (i64::MIN, i64::MAX);
        let mut flow = start;
        let found = loop {
            walk.steps += 1;
            if walk.steps > MOST_STEPS || self.is_half_of_stack_in_use() {
                break self.numbers_held_by(walk.at, walk.basis);
            }
            for test in walk.tests.iter().filter(|test| test.at == flow) {
                (least, most) = (least.max(test.least), most.min(test.most));
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break Some(Numbers::NOTHING),
                // A parameter has been handed something. Any other variable holds `undefined`, or cannot be read yet.
                Flow::Start { .. } | Flow::StartInvoked { .. } => {
                    break if walk.is_parameter { self.numbers_held_by(walk.at, walk.basis) } else { Some(Numbers::NIL) };
                }
                Flow::Assign { before, target } => match self.numbers_stored_at(walk, target) {
                    Some(stored) => break both(stored, walk.by_type),
                    None => flow = before,
                },
                // After a `finally` block only some of the paths into the block count. All of them are taken.
                Flow::Cond { before, .. } | Flow::Switch { before, .. } | Flow::Call { before, .. } | Flow::Reduce { before, .. } | Flow::ArrayMutation { before, .. } => {
                    flow = before;
                }
                Flow::Label { start, len } => {
                    if let Some(&known) = walk.joins.get(&flow) {
                        break known;
                    }
                    let mut all = Some(Numbers::NOTHING);
                    for &edge in bound.edges(start, len) {
                        all = either(all, self.numbers_at(walk, edge));
                        if all.is_none() {
                            break;
                        }
                    }
                    walk.joins.insert(flow, all);
                    break all;
                }
                // The first edge is the way in.
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break Some(Numbers::NOTHING),
                    [entry] => flow = entry,
                    [entry, ..] => {
                        if self.is_stored_to_in_loop(walk.at, flow) {
                            break self.numbers_held_by(walk.at, walk.basis);
                        }
                        flow = entry;
                    }
                },
            }
        };
        found.map(|found| found.within(least, most))
    }

    pub(super) fn is_store_to_place(&self, at: Sym, target: FlowTarget) -> bool {
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        match target {
            FlowTarget::Var(d) => bound.pat_symbol[hir[d].pat.idx()] == at.id,
            FlowTarget::Pat(pat) => bound.pat_symbol[pat.idx()] == at.id,
            FlowTarget::Expr(e) => matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == at.id,
        }
    }

    /// What is stored at an assignment node. `None`: it stores to something else.
    fn numbers_stored_at(&mut self, walk: &Walk, target: FlowTarget) -> Option<Found> {
        if !self.is_store_to_place(walk.at, target) {
            return None;
        }
        let file = walk.at.file;
        Some(match target {
            FlowTarget::Var(d) => self.numbers_in(file, self.hir(file)[d].init, View::Here, walk.basis),
            FlowTarget::Pat(_) => None,
            FlowTarget::Expr(e) => match self.store_to_target(file, e) {
                Some(store) => self.numbers_stored_by(file, store, View::Here, walk.basis),
                None => None,
            },
        })
    }

    /// Whether an assignment node for the place can be come by between one time control is at the head of the loop and the next.
    pub(super) fn is_stored_to_in_loop(&mut self, at: Sym, head: FlowId) -> bool {
        if let Some(&known) = self.aot.integers.loops.get(&(at, head)) {
            return known;
        }
        let bound = self.bound(at.file);
        let mut seen = FxHashSet::default();
        seen.insert(head);
        let mut work: Vec<FlowId> = match bound.flow[head.idx()] {
            Flow::Loop { start, len } => bound.edges(start, len).iter().skip(1).copied().collect(),
            _ => Vec::new(),
        };
        let mut is_stored_to = false;
        while let Some(flow) = work.pop() {
            if !seen.insert(flow) {
                continue;
            }
            if seen.len() > MOST_NODES_IN_LOOP {
                is_stored_to = true;
                break;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable | Flow::Start { .. } | Flow::StartInvoked { .. } => {}
                Flow::Label { start, len } | Flow::Loop { start, len } => work.extend_from_slice(bound.edges(start, len)),
                Flow::Assign { before, target } => {
                    if self.is_store_to_place(at, target) {
                        is_stored_to = true;
                        break;
                    }
                    work.push(before);
                }
                Flow::Cond { before, .. } | Flow::Switch { before, .. } | Flow::Call { before, .. } | Flow::Reduce { before, .. } | Flow::ArrayMutation { before, .. } => {
                    work.push(before);
                }
            }
        }
        self.aot.integers.loops.insert((at, head), is_stored_to);
        is_stored_to
    }

    // ───────────────────────────── tests ─────────────────────────────

    /// The tests of the variable `at` that have turned out one way whenever control gets to the expression `e`: it is in the branch they
    /// lead to, or comes after a statement that leaves if they turn out the other way. `None`: the flow nodes do not tell how control gets there.
    fn tests_passed_before(&mut self, file: FileId, e: ExprId, at: Sym, basis: Basis) -> Option<Tests> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut passed: SmallVec<[(ExprId, bool); 8]> = SmallVec::new();
        let mut child = Child::Expr(e);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let mut siblings: IdList<StmtId> = IdList::EMPTY;
            let mut is_outermost = false;
            match parent {
                Parent::Expr(outer) if outer.is_some() => match hir[outer].kind {
                    ExprKind::Cond { test, yes, .. } if child == Child::Expr(yes) => passed.push((test, true)),
                    ExprKind::Cond { test, no, .. } if child == Child::Expr(no) => passed.push((test, false)),
                    ExprKind::Binary { op: BinOp::And, left, right } if child == Child::Expr(right) => passed.push((left, true)),
                    ExprKind::Binary { op: BinOp::Or, left, right } if child == Child::Expr(right) => passed.push((left, false)),
                    _ => {}
                },
                Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                    StmtKind::If { test, yes, .. } if child == Child::Stmt(yes) => passed.push((test, true)),
                    StmtKind::If { test, no, .. } if child == Child::Stmt(no) => passed.push((test, false)),
                    StmtKind::While { test, body } if child == Child::Stmt(body) => passed.push((test, true)),
                    StmtKind::For { test, update, body, .. } if child == Child::Stmt(body) || child == Child::Expr(update) => {
                        // See `runs_off_the_flow`.
                        if child == Child::Expr(update) && self.is_labeled_statement(file, outer) {
                            return None;
                        }
                        if test.is_some() {
                            passed.push((test, true));
                        }
                    }
                    StmtKind::Block(list) => siblings = list,
                    // Control gets into the statements of a clause at the first of them.
                    StmtKind::Switch { cases, .. } => {
                        let bodies = cases.iter().map(|case| hir[case].body);
                        siblings = bodies.into_iter().find(|&body| hir.ids(body).any(|it| child == Child::Stmt(it))).unwrap_or(IdList::EMPTY);
                    }
                    _ => {}
                },
                Parent::FnBody(func) => {
                    if let FnBody::Block(list) = hir[func].body {
                        siblings = list;
                    }
                    is_outermost = true;
                }
                Parent::File => {
                    siblings = hir.body;
                    is_outermost = true;
                }
                Parent::Module(module) => {
                    siblings = hir[module].body;
                    is_outermost = true;
                }
                Parent::None | Parent::ParamDefault(_) | Parent::MemberInit(_) => is_outermost = true,
                _ => {}
            }
            if let Child::Stmt(child) = child {
                for before in hir.ids(siblings).take_while(|&it| it != child) {
                    let StmtKind::If { test, yes, no } = hir[before].kind else { continue };
                    if never_completes(hir, yes) {
                        passed.push((test, false));
                    }
                    if no.is_some() && never_completes(hir, no) {
                        passed.push((test, true));
                    }
                }
            }
            if is_outermost {
                break;
            }
            child = match parent {
                Parent::Expr(outer) => Child::Expr(outer),
                Parent::Stmt(outer) => Child::Stmt(outer),
                _ => Child::Other,
            };
            parent = self.parent_of_node(file, parent);
        }
        let mut tests = Tests::new();
        for (test, holds) in passed {
            self.add_tests_of_variable(file, test, holds, at, basis, &mut tests);
        }
        Some(tests)
    }

    /// What follows for the variable from `test` having turned out truthy, if `holds`, or falsy.
    fn add_tests_of_variable(&mut self, file: FileId, test: ExprId, holds: bool, at: Sym, basis: Basis, tests: &mut Tests) {
        if self.is_half_of_stack_in_use() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (op, left, right) = match hir[test].kind {
            ExprKind::Unary { op: UnOp::Not, operand } => return self.add_tests_of_variable(file, operand, !holds, at, basis, tests),
            // Both have turned out that way.
            ExprKind::Binary { op: BinOp::And | BinOp::Or, left, right } => {
                if matches!(hir[test].kind, ExprKind::Binary { op: BinOp::And, .. }) == holds {
                    self.add_tests_of_variable(file, left, holds, at, basis, tests);
                    self.add_tests_of_variable(file, right, holds, at, basis, tests);
                }
                return;
            }
            ExprKind::Binary { op, left, right } => (op, left, right),
            _ => return,
        };
        let names_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == at.id;
        // `other < name` is `name > other`.
        let (name, other, op) = if names_it(left) {
            (left, right, op)
        } else if names_it(right) {
            let mirrored = match op {
                BinOp::Lt => BinOp::Gt,
                BinOp::Le => BinOp::Ge,
                BinOp::Gt => BinOp::Lt,
                BinOp::Ge => BinOp::Le,
                op => op,
            };
            (right, left, mirrored)
        } else {
            return;
        };
        if !matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::EqEqEq | BinOp::EqEq | BinOp::NotEqEq | BinOp::NotEq) {
            return;
        }
        let Some(other) = self.numbers_in(file, other, View::Here, basis) else { return };
        let flow = bound.expr_flow[name.idx()];
        // Nothing has been compared with yet, so nothing has passed.
        if other == Numbers::NOTHING {
            return tests.push(Test { at: flow, least: 1, most: 0 });
        }
        // With what is no number, `<` and the like are false either way.
        let Some((low, high)) = other.numbers() else { return };
        let (least, most) = match (op, holds) {
            (BinOp::Lt, true) | (BinOp::Ge, false) => (i64::MIN, high - 1),
            (BinOp::Le, true) | (BinOp::Gt, false) => (i64::MIN, high),
            (BinOp::Gt, true) | (BinOp::Le, false) => (low + 1, i64::MAX),
            (BinOp::Ge, true) | (BinOp::Lt, false) => (low, i64::MAX),
            (BinOp::EqEqEq | BinOp::EqEq, true) | (BinOp::NotEqEq | BinOp::NotEq, false) => (low, high),
            _ => return,
        };
        tests.push(Test { at: flow, least, most });
    }
}
