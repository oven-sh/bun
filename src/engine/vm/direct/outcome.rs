use core::cmp::Ordering;
use core::marker::PhantomData;

use bun_engine_text::{MAX_LENGTH, StringRef};

use crate::{
    CellKind, Cx, DateInstance, Gc, JsArray, JsBigInt, JsObject, JsResult, JsString,
    JsStringIterator, JsSymbol, RegExpObject, RegExpStringIterator, SpeculatedType as T,
    StringObject, Value, Vm,
};

/// What a call comes to, and where.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Gives {
    /// Zero if it has thrown.
    Value {
        types: T,
        /// Of an int32.
        min: i32,
        max: i32,
        /// It can also be the first operand, whatever type that has by then.
        or_first_operand: bool,
    },
    /// In 32 bits. `THREW_INT32` if it has thrown, which is not in the range of one that can.
    Int32 { min: i32, max: i32 },
    /// 0 or 1 in 32 bits, or `THREW_BOOLEAN`.
    Boolean,
    /// Never throws.
    Double(T),
    /// The operand at that position, converted as its kind says. Nothing is called.
    Operand(u8),
    /// The bits of a value that is no cell. Nothing is called.
    Constant(u64),
}

impl Gives {
    pub const THREW_INT32: i32 = -2;
    pub const THREW_BOOLEAN: u32 = 2;

    pub const fn needs_call(self) -> bool {
        !matches!(self, Gives::Operand(_) | Gives::Constant(_))
    }

    const fn value(types: T) -> Gives {
        Gives::Value {
            types,
            min: i32::MIN,
            max: i32::MAX,
            or_first_operand: false,
        }
    }

    /// As a value, which can also be of these types.
    const fn or(self, more: T) -> Gives {
        match self {
            Gives::Value {
                types,
                min,
                max,
                or_first_operand,
            } => Gives::Value {
                types: types.union(more),
                min,
                max,
                or_first_operand,
            },
            Gives::Int32 { min, max } => Gives::Value {
                types: T::INT32.union(more),
                min,
                max,
                or_first_operand: false,
            },
            _ => panic!("nothing needs that"),
        }
    }
}

pub(super) trait Register: Copy {
    #[cfg(debug_assertions)]
    fn to_bits(self) -> u64;
}

macro_rules! registers {
    ($($type:ty = |$it:ident| $bits:expr;)*) => {$(
        impl Register for $type {
            #[cfg(debug_assertions)]
            fn to_bits(self) -> u64 {
                let $it = self;
                $bits
            }
        }
    )*};
}

registers! {
    () = |_it| 0;
    u64 = |it| it;
    u32 = |it| it.into();
    i32 = |it| (it as u32).into();
    f64 = |it| f64::to_bits(it);
}

pub(super) trait HasMark {
    const THREW: Self;
}

impl HasMark for u64 {
    const THREW: u64 = 0;
}

impl HasMark for u32 {
    const THREW: u32 = Gives::THREW_BOOLEAN;
}

impl HasMark for i32 {
    const THREW: i32 = Gives::THREW_INT32;
}

/// # Safety
/// `GIVES` is true of what `into_register` returns.
pub(super) unsafe trait Outcome {
    const GIVES: Gives;
    const THROWS: bool = false;
    type Register: Register;

    fn into_register(self) -> Self::Register;
}

// SAFETY: as for `R`.
unsafe impl<R: Outcome<Register: HasMark>> Outcome for JsResult<R> {
    const GIVES: Gives = match R::GIVES {
        Gives::Int32 { min, .. } if min <= Gives::THREW_INT32 => panic!("no room for the mark"),
        gives => gives,
    };
    const THROWS: bool = true;
    type Register = R::Register;

    #[inline(always)]
    fn into_register(self) -> R::Register {
        self.map_or(R::Register::THREW, R::into_register)
    }
}

macro_rules! outcomes {
    ($($type:ty $(where [$($generics:tt)*])? = $gives:expr, |$it:ident| -> $register:ty { $convert:expr })*) => {$(
        // SAFETY: what the type holds, or its constructors see to.
        unsafe impl$(<$($generics)*>)? Outcome for $type {
            const GIVES: Gives = $gives;
            type Register = $register;

            #[inline(always)]
            fn into_register(self) -> $register {
                let $it = self;
                $convert
            }
        }
    )*};
}

macro_rules! cells {
    ($($type:ty,)*) => {
        outcomes! {$(
            Gc<$type> = Gives::value(T::of_cell_type(<$type as CellKind>::CELL_TYPE)),
                |it| -> u64 { it.address() as u64 }
        )*}
    };
}

cells! {
    JsString,
    JsSymbol,
    JsBigInt,
    JsArray,
    DateInstance,
    RegExpObject,
    StringObject,
    JsStringIterator,
    RegExpStringIterator,
}

outcomes! {
    bool = Gives::Boolean, |it| -> u32 { it.into() }
    i32 = Gives::Int32 { min: i32::MIN, max: i32::MAX }, |it| -> i32 { it }
    f64 = Gives::Double(T::FULL_DOUBLE), |it| -> f64 { it }
    Value = Gives::value(T::HEAP_TOP), |it| -> u64 { it.to_bits() }
    IteratorResult = Gives::value(T::FINAL_OBJECT), |it| -> u64 { it.0.address() as u64 }
    Ranged<MIN, MAX> where [const MIN: i32, const MAX: i32] = Gives::Int32 { min: MIN, max: MAX },
        |it| -> i32 { it.0 }
    Real = Gives::Double(T::REAL_DOUBLE), |it| -> f64 { it.0 }
    Time = Gives::Double(T::BOXED_DOUBLE), |it| -> f64 { it.0 }
    FlatOrFirst = Gives::Value { types: T::FLAT_STRING, min: 0, max: 0, or_first_operand: true },
        |it| -> u64 { it.0.address() as u64 }
    Number = Gives::value(T::BOXED_NUMBER), |it| -> u64 { it.0.to_bits() }
    Flat = Gives::value(T::FLAT_STRING), |it| -> u64 { it.0.address() as u64 }
    Or<R, O> where [R: Outcome + Into<Value>, O: Otherwise] = R::GIVES.or(O::TYPE),
        |it| -> u64 { Value::from(it).to_bits() }
    Same<INDEX> where [const INDEX: u8] = Gives::Operand(INDEX), |it| -> () { match it {} }
    Always<VALUE> where [const VALUE: bool] = Gives::Constant(Value::boolean(VALUE).to_bits()),
        |it| -> () { match it {} }
}

pub(super) enum Same<const INDEX: u8> {}

pub(super) enum Always<const VALUE: bool> {}

/// Both ends are in the range.
#[derive(Clone, Copy)]
pub struct Ranged<const MIN: i32, const MAX: i32>(i32);

impl<const MIN: i32, const MAX: i32> Ranged<MIN, MAX> {
    #[inline(always)]
    pub(super) fn new(integer: i32) -> Self {
        debug_assert!((MIN..=MAX).contains(&integer));
        Ranged(integer)
    }
}

impl<const MIN: i32, const MAX: i32> From<Ranged<MIN, MAX>> for Value {
    #[inline(always)]
    fn from(integer: Ranged<MIN, MAX>) -> Value {
        Value::int32(integer.0)
    }
}

/// Where in a string something was found, or -1.
pub type Found = Ranged<-1, { MAX_LENGTH as i32 }>;

impl Found {
    #[inline(always)]
    pub(super) fn is_some(self) -> bool {
        self.0 >= 0
    }
}

impl From<Option<u32>> for Found {
    #[inline(always)]
    fn from(index: Option<u32>) -> Found {
        Found::new(index.map_or(-1, |index| index as i32))
    }
}

impl From<Option<usize>> for Found {
    #[inline(always)]
    fn from(index: Option<usize>) -> Found {
        index.map(|index| index as u32).into()
    }
}

impl From<Ordering> for Ranged<-1, 1> {
    #[inline(always)]
    fn from(order: Ordering) -> Self {
        Ranged(order as i32)
    }
}

impl From<u16> for Ranged<0, 0xffff> {
    #[inline(always)]
    fn from(unit: u16) -> Self {
        Ranged(unit.into())
    }
}

/// No NaN.
#[derive(Clone, Copy)]
pub struct Real(f64);

impl Real {
    #[inline(always)]
    pub(super) fn new(number: f64) -> Real {
        debug_assert!(!number.is_nan());
        Real(number)
    }

    #[inline(always)]
    pub fn get(self) -> f64 {
        self.0
    }
}

/// If NaN, the canonical one.
#[derive(Clone, Copy)]
pub struct Time(f64);

impl Time {
    /// A result of TimeClip.
    #[inline(always)]
    pub(super) fn clipped(time: f64) -> Time {
        debug_assert!(!time.is_nan() || time.to_bits() == Value::PURE_NAN_BITS);
        Time(time)
    }
}

impl From<Time> for Value {
    #[inline(always)]
    fn from(time: Time) -> Value {
        time.0.into()
    }
}

/// An int32 if it can be.
#[derive(Clone, Copy)]
pub struct Number(Value);

impl From<f64> for Number {
    #[inline(always)]
    fn from(number: f64) -> Number {
        Number(Value::number(number))
    }
}

impl From<Number> for Value {
    #[inline(always)]
    fn from(number: Number) -> Value {
        number.0
    }
}

/// A string that is no rope.
#[derive(Clone, Copy)]
pub struct Flat(Gc<JsString>);

impl Flat {
    /// Of a function that takes the characters, or makes them at once.
    #[inline(always)]
    pub(super) fn made_by(string: Gc<JsString>) -> Flat {
        debug_assert!(!string.is_rope());
        Flat(string)
    }

    #[inline(always)]
    pub(super) fn new(vm: &Vm, string: StringRef) -> Flat {
        Flat::made_by(JsString::new(vm, string))
    }
}

impl From<Flat> for Value {
    #[inline(always)]
    fn from(string: Flat) -> Value {
        string.0.into()
    }
}

#[derive(Clone, Copy)]
pub struct FlatOrFirst(Gc<JsString>);

impl FlatOrFirst {
    #[inline(always)]
    pub(super) fn new(result: Gc<JsString>, first_operand: Gc<JsString>) -> FlatOrFirst {
        debug_assert!(result == first_operand || !result.is_rope());
        FlatOrFirst(result)
    }
}

impl From<FlatOrFirst> for Value {
    #[inline(always)]
    fn from(string: FlatOrFirst) -> Value {
        string.0.into()
    }
}

#[derive(Clone, Copy)]
pub struct IteratorResult(Gc<JsObject>);

impl IteratorResult {
    /// `None` at the end.
    #[inline(always)]
    pub fn new(cx: &Cx, value: Option<impl Into<Value>>) -> IteratorResult {
        let is_done = value.is_none();
        IteratorResult(cx.new_iterator_result(value.map_or_default(Into::into), is_done))
    }
}

impl From<IteratorResult> for Value {
    #[inline(always)]
    fn from(result: IteratorResult) -> Value {
        result.0.into()
    }
}

pub trait Otherwise {
    const VALUE: Value;
    const TYPE: T;
}

macro_rules! otherwise {
    ($($alias:ident = $marker:ident, $value:ident, $type:ident;)*) => {$(
        pub enum $marker {}

        impl Otherwise for $marker {
            const VALUE: Value = Value::$value;
            const TYPE: T = T::$type;
        }

        pub type $alias<R> = Or<R, $marker>;
    )*};
}

otherwise! {
    OrUndefined = Missing, UNDEFINED, UNDEFINED;
    OrNull = Null, NULL, NULL;
    OrNan = Nan, NAN, PURE_NAN;
}

pub struct Or<R, O>(Option<R>, PhantomData<O>);

impl<R, O, S: Into<R>> From<Option<S>> for Or<R, O> {
    #[inline(always)]
    fn from(result: Option<S>) -> Or<R, O> {
        Or(result.map(Into::into), PhantomData)
    }
}

impl<R: Into<Value>, O: Otherwise> From<Or<R, O>> for Value {
    #[inline(always)]
    fn from(result: Or<R, O>) -> Value {
        result.0.map_or(O::VALUE, Into::into)
    }
}
