//! What the data of nodes means.

use core::marker::PhantomData;

use bun_engine_asm::{Cond, FloatCond};
use bun_engine_baseline::ic::{Entries, Steps};
use bun_engine_bytecode::{Body, Register};
use bun_engine_vm::call::WasmCallee;
use bun_engine_vm::code::metadata::{ArrayAccess, GetPrivateName, PutPrivateName};
use bun_engine_vm::ic::{AccessCases, LoadCache, StoreCache};
use bun_engine_vm::{Arithmetic, ExitKind, ExitKinds, SpeculatedType};

use super::facts::ShapeIndex;

macro_rules! data_enums {
    ($($(#[$meta:meta])* $name:ident { $($variant:ident),* $(,)? })*) => {
        $($(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub(crate) enum $name {
            $($variant),*
        }

        impl $name {
            pub(crate) fn from_data(data: u32) -> Self {
                [$(Self::$variant),*][data as usize]
            }
        })*
    };
}

data_enums! {
    Search { IndexOf, Includes }
    Relation { Less, LessEqual, Greater, GreaterEqual }
    /// Those with two operands come first.
    Operator {
        Add, Subtract, Multiply, Divide, Remainder, Exponentiate, BitAnd, BitOr, BitXor, ShiftLeft, ShiftRight,
        ShiftRightUnsigned, ShiftRightUnsignedBits, Negate, BitNot, Increment, Decrement, ToNumber, ToNumeric,
    }
    Conversion { ToString, ToPrimitive, ToPropertyKey, ToPropertyKeyOrNumber }
    /// What `typeof` says.
    TypeName { Undefined, Object, Function, Boolean, Number, String, Symbol, BigInt }
}

impl Relation {
    /// With the operands swapped.
    pub(crate) fn commuted(self) -> Self {
        match self {
            Self::Less => Self::Greater,
            Self::LessEqual => Self::GreaterEqual,
            Self::Greater => Self::Less,
            Self::GreaterEqual => Self::LessEqual,
        }
    }

    pub(crate) fn conditions(self) -> (Cond, FloatCond) {
        match self {
            Self::Less => (Cond::Lt, FloatCond::Lt),
            Self::LessEqual => (Cond::Le, FloatCond::Le),
            Self::Greater => (Cond::Gt, FloatCond::Gt),
            Self::GreaterEqual => (Cond::Ge, FloatCond::Ge),
        }
    }
}

impl TypeName {
    pub(crate) const COUNT: usize = 8;
    pub(crate) const MAY_BE_CALLABLE: SpeculatedType = SpeculatedType::FUNCTION
        .union(SpeculatedType::OTHER_OBJECT)
        .union(SpeculatedType::PROXY);

    /// What has it, where no object poses as undefined.
    pub(crate) fn types(self) -> SpeculatedType {
        use SpeculatedType as T;
        match self {
            Self::Undefined => T::UNDEFINED,
            Self::Object => T::NULL | (T::OBJECT - T::FUNCTION),
            Self::Function => Self::MAY_BE_CALLABLE,
            Self::Boolean => T::BOOLEAN,
            Self::Number => T::FULL_NUMBER,
            Self::String => T::STRING,
            Self::Symbol => T::SYMBOL,
            Self::BigInt => T::BIGINT,
        }
    }

    /// What to check for when `expected` has it.
    pub(crate) fn certain_types(self, expected: SpeculatedType) -> SpeculatedType {
        use SpeculatedType as T;
        let certain = self.types() - T::OTHER_OBJECT - T::PROXY;
        let mut narrower = [T::INT32, T::NULL, certain & T::OBJECT].into_iter();
        narrower.find(|it| it.contains(expected)).unwrap_or(certain)
    }

    /// The one that all values of the type have, in any realm.
    pub(crate) fn of(ty: SpeculatedType) -> Option<Self> {
        if ty.is_empty() || ty.intersects(Self::MAY_BE_CALLABLE - SpeculatedType::FUNCTION) {
            return None;
        }
        let mut all = (0..Self::COUNT as u32).map(Self::from_data);
        all.find(|name| name.types().contains(ty))
    }
}

impl Conversion {
    /// What it leaves as it is.
    pub(crate) fn fixed(self) -> SpeculatedType {
        use SpeculatedType as T;
        match self {
            Self::ToString => T::STRING,
            Self::ToPrimitive => T::HEAP_TOP - T::OBJECT,
            Self::ToPropertyKey => T::STRING | T::SYMBOL,
            Self::ToPropertyKeyOrNumber => T::STRING | T::SYMBOL | T::BOXED_NUMBER,
        }
    }
}

bitflags::bitflags! {
    /// The operands for which an operator on values of any type makes no call. They go above its other data.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct InLine: u32 {
        const INT32 = 1 << 8;
        const NUMBERS = 1 << 9;
        const STRINGS = 1 << 10;
    }
}

impl InLine {
    pub(crate) fn for_operands(expected: &[SpeculatedType]) -> Self {
        use SpeculatedType as T;
        let all_may_be = |ty| expected.iter().all(|it| it.intersects(ty));
        let some_may_be_double =
            (expected.iter()).any(|it| it.intersects(T::FULL_DOUBLE | T::INT52));
        let mut in_line = Self::empty();
        in_line.set(Self::INT32, all_may_be(T::INT32));
        in_line.set(
            Self::NUMBERS,
            all_may_be(T::FULL_NUMBER) && some_may_be_double,
        );
        in_line.set(Self::STRINGS, all_may_be(T::STRING));
        in_line
    }

    /// The other data, and these.
    pub(crate) fn split(data: u32) -> (u32, Self) {
        (data & 0xff, Self::from_bits_truncate(data))
    }
}

bitflags::bitflags! {
    /// What an operator has been seen to give.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct ArithmeticData: u32 {
        const MAY_OVERFLOW_INT32 = 1 << 0;
        const MAY_OVERFLOW_INT52 = 1 << 1;
        const MAY_BE_DOUBLE = 1 << 2;
        const MAY_BE_NEGATIVE_ZERO = 1 << 3;
        /// The first operand has been a double.
        const SAW_DOUBLE_FIRST = 1 << 4;
        const SAW_DOUBLE_SECOND = 1 << 5;
        /// An operand was no int32 when the code counted on it.
        const WAS_NO_INT32 = 1 << 6;
    }
}

impl ArithmeticData {
    pub(crate) fn new(seen: Arithmetic, exits: ExitKinds) -> Self {
        let mut data = Self::empty();
        let overflowed = seen.contains(Arithmetic::RESULT_OVERFLOWED_INT32)
            || exits.contains(ExitKind::Overflow);
        data.set(Self::MAY_OVERFLOW_INT32, overflowed);
        data.set(
            Self::MAY_OVERFLOW_INT52,
            seen.contains(Arithmetic::RESULT_OVERFLOWED_INT52)
                || exits.contains(ExitKind::Int52Overflow),
        );
        data.set(
            Self::MAY_BE_DOUBLE,
            seen.contains(Arithmetic::RESULT_DOUBLE) || exits.contains(ExitKind::NotAnInteger),
        );
        data.set(
            Self::MAY_BE_NEGATIVE_ZERO,
            seen.contains(Arithmetic::RESULT_NEGATIVE_ZERO)
                || exits.contains(ExitKind::NegativeZero),
        );
        data.set(
            Self::SAW_DOUBLE_FIRST,
            seen.contains(Arithmetic::LHS_DOUBLE),
        );
        data.set(
            Self::SAW_DOUBLE_SECOND,
            seen.contains(Arithmetic::RHS_DOUBLE),
        );
        data.set(Self::WAS_NO_INT32, exits.contains(ExitKind::BadType));
        data
    }
}

impl ArithmeticData {
    /// For a function, of which only the results are known.
    pub(crate) fn of_result(seen: SpeculatedType, exits: ExitKinds) -> Self {
        let mut data = Self::new(Arithmetic::empty(), exits);
        if seen.intersects(SpeculatedType::BOXED_DOUBLE) {
            data |= Self::MAY_BE_DOUBLE;
        }
        data
    }
}

/// The data of a conversion that is there only because of the form of a parameter of a block. One that cannot fail
/// has no state.
pub(crate) const ON_EDGE: u32 = 1;
/// The data of an `AsInt32` or `AsInt52` for which −0 is as good as 0.
pub(crate) const AS_INDEX: u32 = 2;

/// The integers that fit in so many bytes.
#[derive(Clone, Copy)]
pub(crate) struct IntegerRange {
    pub(crate) bytes: u32,
    pub(crate) is_signed: bool,
}

impl IntegerRange {
    pub(crate) fn to_data(self) -> u32 {
        self.bytes << 1 | u32::from(self.is_signed)
    }

    pub(crate) fn from_data(data: u32) -> Self {
        Self {
            bytes: data >> 1,
            is_signed: data & 1 != 0,
        }
    }

    /// For less than eight bytes.
    pub(crate) fn least(self) -> i64 {
        -(i64::from(self.is_signed) << (self.bytes * 8 - 1))
    }

    pub(crate) fn greatest(self) -> i64 {
        self.least() + (1 << (self.bytes * 8)) - 1
    }
}

/// The data of a `BoxDouble` whose result is not used if the operand is NaN.
pub(crate) const NOT_NAN: u32 = 1;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct TypeCheck {
    pub(crate) wanted: SpeculatedType,
    /// What need not be looked for is not in here.
    pub(crate) known: SpeculatedType,
    pub(crate) failure: ExitKind,
}

#[derive(Default)]
pub(crate) struct TypeChecks(Vec<TypeCheck>);

impl TypeCheck {
    /// For what does not exit.
    pub(crate) fn describing(wanted: SpeculatedType, known: SpeculatedType) -> Self {
        let failure = ExitKind::BadType;
        Self {
            wanted,
            known,
            failure,
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Awaiting: u32 {
        const SPECIES_IS_PRISTINE = 1 << 0;
        const HAS_CONTEXT = 1 << 1;
        const IS_NO_THENABLE = 1 << 2;
    }
}

bitflags::bitflags! {
    /// About a string that is concatenated.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Fibers: u32 {
        const IS_FLAT = 1 << 0;
        const MAY_WELL_BE_ROPE = 1 << 1;
    }
}

impl Fibers {
    pub(crate) fn for_operand(self, position: usize) -> u32 {
        self.bits() << (2 * position)
    }

    pub(crate) fn of_operand(data: u32, position: usize) -> Self {
        Self::from_bits_truncate(data >> (2 * position))
    }
}

impl TypeChecks {
    const ANYTHING: u32 = 0xffff;

    pub(crate) fn check(&mut self, check: TypeCheck) -> u32 {
        self.0
            .iter()
            .position(|&known| known == check)
            .unwrap_or_else(|| {
                self.0.push(check);
                self.0.len() - 1
            }) as u32
    }

    pub(crate) fn at(&self, data: u32) -> TypeCheck {
        self.0[data as usize]
    }

    /// Of two that only describe operands.
    pub(crate) fn pair(&mut self, checks: [TypeCheck; 2]) -> u32 {
        let [first, second] = checks.map(|it| self.check(it).min(Self::ANYTHING));
        first | second << 16
    }

    pub(crate) fn pair_at(&self, data: u32) -> [TypeCheck; 2] {
        [data & 0xffff, data >> 16].map(|it| match it {
            Self::ANYTHING => {
                TypeCheck::describing(SpeculatedType::HEAP_TOP, SpeculatedType::HEAP_TOP)
            }
            _ => self.at(it),
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Transition {
    pub(crate) from: ShapeIndex,
    pub(crate) to: ShapeIndex,
}

#[derive(Clone, Copy)]
pub(crate) struct Allocation {
    pub(crate) shape: ShapeIndex,
    pub(crate) size: u32,
    /// From the `Vm` to the `Allocator`.
    pub(crate) allocator: i32,
    /// Of what that hands out.
    pub(crate) cell_size: u32,
    pub(crate) vector: Vector,
}

/// The storage that comes with a `NewArray`.
#[derive(Clone, Copy, Default)]
pub(crate) struct Vector {
    pub(crate) allocator: i32,
    pub(crate) cell_size: u32,
    /// Of a `NewArrayOfHoles`, how many elements to have room for at least.
    pub(crate) length: u32,
    /// So many elements are left to the stores that follow.
    pub(crate) initialized: u32,
}

/// The slots of the area that stands in for a frame when the interpreter executes an instruction.
#[derive(Clone, Copy, Default)]
pub(crate) struct ShadowFrame {
    pub(crate) lowest: i32,
    pub(crate) highest: i32,
}

impl ShadowFrame {
    pub(crate) fn include(&mut self, register: Register) {
        (self.lowest, self.highest) = (
            self.lowest.min(register.offset()),
            self.highest.max(register.offset()),
        );
    }
}

macro_rules! caches {
    ($($start:ty { $($name:ident: $entry:ident, $only_looks:literal;)* })*) => {
        #[derive(Clone, Copy, PartialEq, Eq)]
        enum CacheKind {
            $($($name,)*)*
        }

        $(#[expect(non_upper_case_globals, reason = "they stand for the variants")]
        impl Cache<$start> {
            $(pub(crate) const $name: Self = Cache(CacheKind::$name, PhantomData);)*
        })*

        impl CachedAccess {
            pub(crate) fn steps(self, entries: &Entries<usize>) -> Steps<usize> {
                match self.kind {
                    $($(CacheKind::$name => entries.$entry,)*)*
                }
            }

            /// As far as the first step goes.
            pub(crate) fn only_looks(self) -> bool {
                match self.kind {
                    $($(CacheKind::$name => $only_looks,)*)*
                }
            }
        }
    };
}

caches! {
    LoadCache {
        GetById: get_by_id, true;
        GetByIdDirect: get_by_id_direct, true;
    }
    StoreCache {
        PutById: put_by_id, false;
        PutByIdStrict: put_by_id_strict, false;
        PutByIdDirect: put_by_id_direct, false;
    }
    AccessCases {
        GetByIdWithThis: get_by_id_with_this, true;
        InById: in_by_id, true;
        Instanceof: instance_of, true;
        HasPrivateName: has_private_name, true;
        DeleteById: delete_by_id, false;
        DeleteByIdStrict: delete_by_id_strict, false;
        DeleteByVal: delete_by_val, false;
        DeleteByValStrict: delete_by_val_strict, false;
    }
    ArrayAccess {
        GetByVal: get_by_val, true;
        GetByValWithThis: get_by_val_with_this, true;
        InByVal: in_by_val, true;
        PutByVal: put_by_val, false;
        PutByValStrict: put_by_val_strict, false;
        PutByValDirect: put_by_val_direct, false;
    }
    GetPrivateName {
        GetPrivateName: get_private_name, true;
    }
    PutPrivateName {
        CheckPrivateBrand: check_private_brand, true;
        PutPrivateName: put_private_name, false;
        DefinePrivateName: define_private_name, false;
        SetPrivateBrand: set_private_brand, false;
    }
}

/// A kind of access that the baseline tier has entries for, whose steps start from a `Start`.
pub(crate) struct Cache<Start>(CacheKind, PhantomData<Start>);

impl<Start> Clone for Cache<Start> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<Start> Copy for Cache<Start> {}

impl<Start> PartialEq for Cache<Start> {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

#[derive(Clone, Copy)]
pub(crate) struct CachedAccess {
    kind: CacheKind,
    start: usize,
}

impl CachedAccess {
    /// `start` is in the metadata of the instruction.
    pub(crate) fn new<Start>(cache: Cache<Start>, start: &Start) -> CachedAccess {
        CachedAccess {
            kind: cache.0,
            start: core::ptr::from_ref(start).addr(),
        }
    }

    pub(crate) fn start(self) -> usize {
        self.start
    }

    pub(crate) fn notes_shapes(self) -> bool {
        use CacheKind::{GetByVal, InByVal, PutByVal, PutByValDirect, PutByValStrict};
        matches!(
            self.kind,
            GetByVal | InByVal | PutByVal | PutByValStrict | PutByValDirect
        )
    }
}

pub(crate) struct WasmCall {
    pub(crate) callee: WasmCallee,
    /// Its address.
    pub(crate) vm: usize,
}

/// For the slot of a property.
#[derive(Clone, Copy)]
pub(crate) struct SlotSearch {
    /// The address and the `name_hash`. Otherwise they are the last two operands.
    pub(crate) name: Option<(usize, u32)>,
    pub(crate) usual_byte_offset: Option<i32>,
}

/// What follows the callee and `this` among the operands of a call with lists.
#[derive(Clone, Copy)]
pub(crate) struct Lists {
    /// Of the only list, which follows single values. `None` for those and lists that `spread` has made in any order.
    pub(crate) skip_in_list: Option<u32>,
    /// One that is empty stands for the arguments of the frame.
    pub(crate) skip_in_frame: u32,
}

impl Lists {
    pub(crate) const FRAME_BITS: u32 = (Body::MAX_FRAME_WORDS + 1).next_power_of_two().ilog2();
    pub(crate) const SPREAD: u32 = u32::MAX >> Self::FRAME_BITS;

    pub(crate) fn to_data(self) -> u32 {
        let in_list = (self.skip_in_list).map_or(Self::SPREAD, |it| it.min(Self::SPREAD - 1));
        in_list << Self::FRAME_BITS | self.skip_in_frame
    }

    pub(crate) fn from_data(data: u32) -> Self {
        Self {
            skip_in_list: Some(data >> Self::FRAME_BITS).filter(|&it| it != Self::SPREAD),
            skip_in_frame: data & ((1 << Self::FRAME_BITS) - 1),
        }
    }
}
