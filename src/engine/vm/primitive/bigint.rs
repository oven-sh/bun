use core::cell::Cell;
use core::cmp::Ordering;
use core::mem::offset_of;
use core::num::NonZeroUsize;
use core::ops::Deref;

use bun_engine_bigint::{
    self as bigint, BigIntRef, DivisorCache, Error, ErrorKind, Fill, LiteralRadix, New, Outcome,
    SmallBigInt,
};
use bun_engine_text::{StringRef, Text};

use crate::heap::{ATOM_SIZE, EXACT_CUTOFF, Never};
use crate::services::Service;
use crate::vm::Root;
use crate::{
    CellKind, CellType, CellTypeRange, Class, ClassOps, Cx, ErrorType, Extends, Gc, GcFree, JsCell,
    JsResult, JsString, Shape, Thrown, TypeFlags, Visitor, Vm, ascii_literal,
};

/// The digits of the magnitude follow, the least significant first. The last is not zero.
#[repr(C)]
pub struct JsBigInt {
    base: JsCell,
    length: u32,
    /// The low byte is 1 if the value is negative. The others are zero until the hash is asked for.
    sign_and_hash: Cell<u32>,
}

#[unsafe(export_name = "engine_class_BigInt")]
static BIGINT_CLASS: Class = Class::new::<JsBigInt>(
    ascii_literal!("BigInt"),
    None,
    CellTypeRange::new(CellType::BigInt, CellType::BigInt),
);

impl !GcFree for JsBigInt {}

impl Deref for JsBigInt {
    type Target = JsCell;

    #[inline(always)]
    fn deref(&self) -> &JsCell {
        &self.base
    }
}

// SAFETY: starts with a `JsCell`.
unsafe impl Extends<JsCell> for JsBigInt {}

// SAFETY: refers to no cell but its shape, which is a root.
unsafe impl CellKind for JsBigInt {
    type Base = JsCell;
    type Init = Never;

    const CLASS: &'static Class = &BIGINT_CLASS;
    const CELL_TYPE: CellType = CellType::BigInt;
    const FLAGS: TypeFlags = TypeFlags::SHAPE_IS_IMMORTAL;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = JsCell::OPS;

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.is_bigint()
    }

    fn shape_of(init: &Never) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut JsBigInt, init: Never) {
        match init {}
    }

    fn trace_fields(&self, _: &mut Visitor) {}
}

pub(crate) struct State {
    /// The first word of a new cell.
    header: Cell<u64>,
    zero: Root<JsBigInt>,
    divisors: DivisorCache,
}

impl State {
    pub(crate) const OFFSET_OF_HEADER: usize = offset_of!(State, header);
}

impl Default for State {
    fn default() -> State {
        State {
            header: Cell::new(0),
            zero: Root::new(),
            divisors: DivisorCache::default(),
        }
    }
}

impl Service for State {
    fn initialize(&self, vm: &Vm) {
        self.header.set(JsCell::header_for(&vm.shapes.bigint()));
        let zero = Unfinished::try_new(vm, 0, []).unwrap_or_else(|_| bun_alloc::out_of_memory());
        self.zero.set(Some(zero.finish(0, false)));
    }

    fn visit(&self, visitor: &mut Visitor) {
        self.zero.visit(visitor);
    }
}

/// A new cell that nothing refers to yet.
struct Unfinished {
    cell: *mut JsBigInt,
    capacity: usize,
}

impl Unfinished {
    /// `operands` are the cells that the digits will be made from.
    #[inline(always)]
    fn try_new<const N: usize>(
        vm: &Vm,
        capacity: usize,
        operands: [&JsBigInt; N],
    ) -> Result<Unfinished, Error> {
        const MAX_BUMPED: usize = (EXACT_CUTOFF - JsBigInt::OFFSET_OF_DIGITS) / size_of::<u64>();
        let atoms = || JsBigInt::allocation_size(capacity).div_ceil(ATOM_SIZE);
        let bumped = (capacity <= MAX_BUMPED)
            .then(|| vm.heap.cells.try_bump_atoms(atoms()))
            .flatten();
        let address = match bumped {
            Some(address) => address,
            None => Self::allocate(vm, capacity, operands)
                .ok_or(Error::OutOfMemory)?
                .get(),
        };
        let cell = core::ptr::with_exposed_provenance_mut::<JsBigInt>(address);
        // SAFETY: a new cell of that size. The collector reads nothing but the header.
        unsafe { cell.cast::<u64>().write(vm.services.bigints.header.get()) };
        Ok(Unfinished { cell, capacity })
    }

    #[inline(never)]
    fn allocate<const N: usize>(
        vm: &Vm,
        capacity: usize,
        operands: [&JsBigInt; N],
    ) -> Option<NonZeroUsize> {
        assert!(capacity <= bigint::MAX_LENGTH + 1);
        let size = JsBigInt::allocation_size(capacity);
        let address = vm.heap.cells.try_allocate(&vm.heap, size);
        for operand in operands {
            Gc::from(operand).keep_alive();
        }
        NonZeroUsize::new(address)
    }

    /// Of any value.
    #[inline(always)]
    fn digits(&mut self) -> &mut [u64] {
        // SAFETY: the rest of the cell. The empty block stands for storing the bytes that are there, after which
        // they count as initialized.
        unsafe {
            let digits = self.cell.add(1).cast::<u64>();
            if cfg!(any(debug_assertions, miri)) {
                digits.write_bytes(0xa5, self.capacity);
            } else {
                core::arch::asm!("/* {0} */", in(reg) digits, options(nostack, preserves_flags));
            }
            core::slice::from_raw_parts_mut(digits, self.capacity)
        }
    }

    #[inline(always)]
    fn finish(self, length: u32, is_negative: bool) -> Gc<JsBigInt> {
        assert!(length as usize <= self.capacity);
        // SAFETY: the last fields of the cell to be written.
        unsafe {
            (&raw mut (*self.cell).length).write(length);
            (&raw mut (*self.cell).sign_and_hash).write(Cell::new(is_negative.into()));
            Gc::from_address(self.cell.expose_provenance())
        }
    }
}

impl JsBigInt {
    /// 32 bits that never change: the number of digits, which is zero for zero.
    pub const OFFSET_OF_LENGTH: usize = offset_of!(JsBigInt, length);
    /// A byte that never changes: 1 if it is negative, which zero is not.
    pub const OFFSET_OF_SIGN: usize = offset_of!(JsBigInt, sign_and_hash);
    /// 32 bits, to be shifted right by `HASH_SHIFT`. Zero until it has been asked for.
    pub const OFFSET_OF_HASH: usize = offset_of!(JsBigInt, sign_and_hash);
    pub const HASH_SHIFT: u32 = 8;
    /// 64 bits each. They never change, and what follows them is not initialized.
    pub const OFFSET_OF_DIGITS: usize = size_of::<JsBigInt>();

    #[inline(always)]
    pub const fn allocation_size(digit_count: usize) -> usize {
        Self::OFFSET_OF_DIGITS + digit_count * size_of::<u64>()
    }

    /// The only one in use that is zero.
    #[inline(always)]
    pub fn zero(vm: &Vm) -> Gc<JsBigInt> {
        // SAFETY: set when the `Vm` is made.
        unsafe { vm.services.bigints.zero.get().unwrap_unchecked() }
    }

    #[inline(always)]
    pub fn from_small(vm: &Vm, value: impl Into<SmallBigInt>) -> Gc<JsBigInt> {
        let value = value.into();
        if value.is_zero() {
            return Self::zero(vm);
        }
        let mut cell =
            Unfinished::try_new(vm, 2, []).unwrap_or_else(|_| bun_alloc::out_of_memory());
        cell.digits().copy_from_slice(&value.padded_digits());
        cell.finish(value.length() as u32, value.is_negative())
    }

    pub fn try_copy_of(vm: &Vm, value: BigIntRef<'_>) -> Result<Gc<JsBigInt>, Error> {
        if value.is_zero() {
            return Ok(Self::zero(vm));
        }
        let mut cell = Unfinished::try_new(vm, value.digits().len(), [])?;
        cell.digits().copy_from_slice(value.digits());
        Ok(cell.finish(value.digits().len() as u32, value.is_negative()))
    }

    /// Of a magnitude that may have leading zeros, the least significant word first.
    pub fn try_from_words(
        vm: &Vm,
        is_negative: bool,
        words: &[u64],
    ) -> Result<Gc<JsBigInt>, Error> {
        Self::try_copy_of(vm, BigIntRef::from_words(is_negative, words)?)
    }

    pub fn from_words(cx: &Cx, is_negative: bool, words: &[u64]) -> JsResult<Gc<JsBigInt>> {
        Self::try_from_words(cx, is_negative, words).map_err(|error| Self::throw(cx, error))
    }

    /// `operands` are the cells that `fill` reads.
    #[inline(always)]
    fn try_from_fill<F: Fill, const N: usize>(
        vm: &Vm,
        fill: F,
        operands: [&JsBigInt; N],
    ) -> Result<Gc<JsBigInt>, Error> {
        const MAX_UNUSED_DIGITS: usize = 8;
        let capacity = fill.digit_count();
        let mut cell = Unfinished::try_new(vm, capacity, operands)?;
        let filled = match fill.fill(cell.digits(), &mut || vm.is_termination_requested()) {
            Ok(filled) if !F::CAN_FALL_SHORT || filled.length != 0 => filled,
            other => {
                // A stale word on the stack can still make the cell show up in a walk of the heap.
                cell.finish(0, false);
                return other.map(|_| Self::zero(vm));
            }
        };
        let result = cell.finish(filled.length, filled.is_negative);
        if F::CAN_FALL_SHORT && capacity - filled.length as usize > MAX_UNUSED_DIGITS {
            return Ok(result.in_a_cell_of_its_size(vm));
        }
        Ok(result)
    }

    #[cold]
    #[inline(never)]
    fn in_a_cell_of_its_size(&self, vm: &Vm) -> Gc<JsBigInt> {
        let copy = Self::try_copy_of(vm, self.value());
        copy.unwrap_or_else(|_| self.into())
    }

    #[inline]
    fn try_from_new(vm: &Vm, new: Result<New<impl Fill>, Error>) -> Result<Gc<JsBigInt>, Error> {
        match new? {
            New::Small(small) => Ok(Self::from_small(vm, small)),
            New::Large(fill) => Self::try_from_fill(vm, fill, []),
        }
    }

    /// The result of an operation on `first` and `second`.
    #[inline(always)]
    fn from_outcome(
        cx: &Cx,
        first: &JsBigInt,
        second: &JsBigInt,
        outcome: Result<Outcome<impl Fill>, Error>,
    ) -> JsResult<Gc<JsBigInt>> {
        let result = match outcome {
            Ok(Outcome::First) => return Ok(first.into()),
            Ok(Outcome::Second) => return Ok(second.into()),
            Ok(Outcome::New(New::Small(small))) => return Ok(Self::from_small(cx, small)),
            Ok(Outcome::New(New::Large(fill))) => Self::try_from_fill(cx, fill, [first, second]),
            Err(error) => Err(error),
        };
        result.map_err(|error| Self::throw(cx, error))
    }

    /// NumberToBigInt
    pub fn from_number(cx: &Cx, number: f64) -> JsResult<Gc<JsBigInt>> {
        Self::try_from_new(cx, bigint::from_number(number)).map_err(|error| Self::throw(cx, error))
    }

    /// StringToBigInt
    pub fn from_string(cx: &Cx, text: Text<'_>) -> JsResult<Option<Gc<JsBigInt>>> {
        let parsed = Self::try_from_new(cx, bigint::from_string(text));
        Self::unless_invalid(cx, parsed)
    }

    /// The same, but throws a SyntaxError for what is not an integer.
    pub fn parse(cx: &Cx, text: Text<'_>) -> JsResult<Gc<JsBigInt>> {
        Self::try_from_new(cx, bigint::from_string(text)).map_err(|error| Self::throw(cx, error))
    }

    /// `characters` have no sign, prefix, suffix or separators. `None` if they are not all digits.
    pub fn from_characters(
        cx: &Cx,
        characters: Text<'_>,
        radix: LiteralRadix,
        is_negative: bool,
    ) -> JsResult<Option<Gc<JsBigInt>>> {
        let parsed = bigint::from_literal(characters, radix, is_negative);
        Self::unless_invalid(cx, Self::try_from_new(cx, parsed))
    }

    /// For a constant of code.
    pub(crate) fn from_literal(
        cx: &Cx,
        characters: Text<'_>,
        radix: LiteralRadix,
        is_negative: bool,
    ) -> JsResult<Gc<JsBigInt>> {
        let parsed = bigint::from_literal(characters, radix, is_negative);
        Self::try_from_new(cx, parsed).map_err(|error| match error {
            Error::TooBig => cx.throw_out_of_memory(),
            _ => Self::throw(cx, error),
        })
    }

    fn unless_invalid<T>(cx: &Cx, parsed: Result<T, Error>) -> JsResult<Option<T>> {
        match parsed {
            Ok(value) => Ok(Some(value)),
            Err(Error::InvalidText) => Ok(None),
            Err(error) => Err(Self::throw(cx, error)),
        }
    }

    #[cold]
    #[inline(never)]
    pub fn throw(cx: &Cx, error: Error) -> Thrown {
        match error.kind() {
            ErrorKind::RangeError => cx.throw_range_error(error.message()),
            ErrorKind::SyntaxError => cx.throw_error(ErrorType::SyntaxError, error.message()),
            ErrorKind::OutOfMemoryError => cx.throw_out_of_memory_with(error.message()),
            ErrorKind::Interruption => cx.throw_termination(),
        }
    }

    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub fn value(&self) -> BigIntRef<'_> {
        let digits = core::ptr::with_exposed_provenance(self.address() + Self::OFFSET_OF_DIGITS);
        // SAFETY: inside the cell, initialized, and never changed.
        let digits = unsafe { core::slice::from_raw_parts(digits, self.length as usize) };
        BigIntRef::new(self.is_negative(), digits)
    }

    #[inline(always)]
    pub fn is_zero(&self) -> bool {
        self.length == 0
    }

    #[inline(always)]
    pub fn is_negative(&self) -> bool {
        self.sign_and_hash.get() & 1 != 0
    }

    /// 24 bits that are not all zero, as for a string.
    #[inline]
    pub fn hash(&self) -> u32 {
        match self.sign_and_hash.get() >> Self::HASH_SHIFT {
            0 => self.compute_hash(),
            hash => hash,
        }
    }

    #[inline(never)]
    fn compute_hash(&self) -> u32 {
        let hash = (self.value().hash() >> Self::HASH_SHIFT).max(1);
        self.sign_and_hash
            .update(|sign| sign | hash << Self::HASH_SHIFT);
        hash
    }

    /// `None` if the string is not an integer.
    pub fn compare_to_string(&self, cx: &Cx, string: &JsString) -> JsResult<Option<Ordering>> {
        let view = string.view(cx)?;
        let ordering = bigint::from_string(view.text()).and_then(|new| match new {
            New::Small(small) => Ok(self.value().cmp(&small.as_ref())),
            New::Large(fill) => Ok(self
                .value()
                .cmp(&Self::try_from_fill(cx, fill, [self])?.value())),
        });
        Self::unless_invalid(cx, ordering)
    }

    /// `radix` is from 2 to 36.
    pub fn to_string_ref(&self, cx: &Cx, radix: u32) -> JsResult<StringRef> {
        self.value()
            .to_string_ref(radix, &mut || cx.is_termination_requested())
            .map_err(|error| Self::throw(cx, error))
    }

    pub fn to_js_string(&self, cx: &Cx, radix: u32) -> JsResult<Gc<JsString>> {
        Ok(JsString::new(cx, self.to_string_ref(cx, radix)?))
    }

    pub fn as_int_n(cx: &Cx, bits: u64, x: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
        Self::from_outcome(cx, x, x, Ok(bigint::as_int_n(bits, x.value())))
    }

    pub fn as_uint_n(cx: &Cx, bits: u64, x: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
        Self::from_outcome(cx, x, x, bigint::as_uint_n(bits, x.value()))
    }
}

macro_rules! unary_operators {
    ($($name:ident)*) => {$(
        pub fn $name(cx: &Cx, x: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
            Self::from_outcome(cx, x, x, Ok(bigint::$name(x.value())))
        }
    )*};
}

/// An operator has a copy of its code for each pattern of lengths, which is cut down to what those lengths need.
macro_rules! binary_operators {
    ($($name:ident, [$($lengths:pat),*], |$cx:ident, $x:ident, $y:ident| $outcome:expr;)*) => {$(
        pub fn $name(cx: &Cx, x: &JsBigInt, y: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
            #[inline(always)]
            fn apply($cx: &Cx, x: &JsBigInt, y: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
                let ($x, $y) = (x.value(), y.value());
                JsBigInt::from_outcome($cx, x, y, $outcome)
            }

            #[inline(never)]
            fn apply_to_any_length(cx: &Cx, x: &JsBigInt, y: &JsBigInt) -> JsResult<Gc<JsBigInt>> {
                apply(cx, x, y)
            }

            match (x.length, y.length) {
                $($lengths => apply(cx, x, y),)*
                _ => apply_to_any_length(cx, x, y),
            }
        }
    )*};
}

impl JsBigInt {
    unary_operators!(unary_minus bitwise_not increment decrement);

    binary_operators! {
        add, [(1, 1), (2, 1 | 2), (4, 4)], |cx, x, y| Ok(bigint::add(x, y));
        subtract, [(1, 1), (2, 1 | 2), (4, 4)], |cx, x, y| Ok(bigint::subtract(x, y));
        multiply, [(1, 1), (2, 2), (4, 4)], |cx, x, y| bigint::multiply(x, y);
        divide, [(1, 1), (2, 1)], |cx, x, y| bigint::divide(x, y, &cx.services.bigints.divisors);
        remainder, [(1, 1), (2, 1), (4, 4), (8, 4)], |cx, x, y| bigint::remainder(x, y, &cx.services.bigints.divisors);
        exponentiate, [], |cx, x, y| bigint::exponentiate(x, y);
        left_shift, [(1, 1)], |cx, x, y| bigint::left_shift(x, y);
        signed_right_shift, [(1, 1)], |cx, x, y| bigint::signed_right_shift(x, y);
        bitwise_and, [(1, 1)], |cx, x, y| Ok(bigint::bitwise_and(x, y));
        bitwise_or, [(1, 1)], |cx, x, y| Ok(bigint::bitwise_or(x, y));
        bitwise_xor, [(1, 1)], |cx, x, y| Ok(bigint::bitwise_xor(x, y));
    }
}
