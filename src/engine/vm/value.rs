use core::num::NonZeroU64;

use crate::{CellKind, Gc, GcFree, JsCell};

/// A value of the language, or a cell that only the engine sees. `==` compares identity, bit for bit.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Value(NonZeroU64);

impl !GcFree for Value {}
impl !Send for Value {}
impl !Sync for Value {}

impl Value {
    pub const NUMBER_TAG: u64 = 0xfffe_0000_0000_0000;
    pub const DOUBLE_OFFSET: u64 = 1 << 49;
    pub const OTHER_TAG: u64 = 0x2;
    pub const BOOL_TAG: u64 = 0x4;
    pub const UNDEFINED_TAG: u64 = 0x8;
    pub const NOT_CELL_MASK: u64 = Self::NUMBER_TAG | Self::OTHER_TAG;
    /// In the callee slot of a frame: not a cell but the description of native code.
    pub const NATIVE_CALLEE_TAG: u64 = 0x3;
    pub const PURE_NAN_BITS: u64 = 0x7ff8_0000_0000_0000;

    pub const NULL: Value = Value::constant(Self::OTHER_TAG);
    pub const UNDEFINED: Value = Value::constant(Self::OTHER_TAG | Self::UNDEFINED_TAG);
    pub const FALSE: Value = Value::constant(Self::OTHER_TAG | Self::BOOL_TAG);
    pub const TRUE: Value = Value::constant(Self::OTHER_TAG | Self::BOOL_TAG | 1);
    pub const NAN: Value = Value::double(f64::from_bits(Self::PURE_NAN_BITS));
    pub const ZERO: Value = Value::int32(0);

    const fn constant(bits: u64) -> Value {
        Value(NonZeroU64::new(bits).unwrap())
    }

    /// # Safety
    /// The bits of a value, whose cell is alive if it has one.
    #[inline(always)]
    pub const unsafe fn from_bits(bits: u64) -> Value {
        // SAFETY: no value is zero.
        Value(unsafe { NonZeroU64::new_unchecked(bits) })
    }

    /// # Safety
    /// Zero, or as for `from_bits`.
    #[inline(always)]
    pub const unsafe fn from_bits_or_empty(bits: u64) -> Option<Value> {
        match NonZeroU64::new(bits) {
            Some(bits) => Some(Value(bits)),
            None => None,
        }
    }

    #[inline(always)]
    pub const fn to_bits(self) -> u64 {
        self.0.get()
    }

    #[inline(always)]
    pub const fn bits_of(value: Option<Value>) -> u64 {
        match value {
            Some(value) => value.to_bits(),
            None => 0,
        }
    }

    #[inline(always)]
    pub const fn slice_as_bits(values: &[Value]) -> &[u64] {
        // SAFETY: what a value is represented as.
        unsafe { core::slice::from_raw_parts(values.as_ptr().cast(), values.len()) }
    }

    #[inline(always)]
    pub const fn int32(value: i32) -> Value {
        // SAFETY: the tag makes it an int32.
        unsafe { Value::from_bits(Self::NUMBER_TAG | value as u32 as u64) }
    }

    /// Stays a double even if it is an integer.
    #[inline(always)]
    pub const fn double(value: f64) -> Value {
        let bits = if value.is_nan() {
            Self::PURE_NAN_BITS
        } else {
            value.to_bits()
        };
        // SAFETY: at least 2^49 and below the tag of an int32.
        unsafe { Value::from_bits(bits + Self::DOUBLE_OFFSET) }
    }

    /// An int32 if the number is one.
    #[inline(always)]
    pub fn number(value: f64) -> Value {
        // The low bits of the sum are those of the nearest integer, unless that is far too large.
        let integer = (value + (3u64 << 51) as f64).to_bits() as i32;
        if f64::from(integer).to_bits() == value.to_bits() {
            Value::int32(integer)
        } else {
            Value::double(value)
        }
    }

    #[inline(always)]
    pub const fn boolean(value: bool) -> Value {
        // SAFETY: `false` or `true`.
        unsafe { Value::from_bits(Self::FALSE.to_bits() | value as u64) }
    }

    #[inline(always)]
    pub const fn is_int32(self) -> bool {
        self.to_bits() >= Self::NUMBER_TAG
    }

    #[inline(always)]
    pub const fn is_number(self) -> bool {
        self.to_bits() & Self::NUMBER_TAG != 0
    }

    #[inline(always)]
    pub const fn is_double(self) -> bool {
        self.is_number() && !self.is_int32()
    }

    #[inline(always)]
    pub const fn is_cell(self) -> bool {
        self.to_bits() & Self::NOT_CELL_MASK == 0
    }

    #[inline(always)]
    pub const fn is_undefined(self) -> bool {
        self.to_bits() == Self::UNDEFINED.to_bits()
    }

    #[inline(always)]
    pub const fn is_null(self) -> bool {
        self.to_bits() == Self::NULL.to_bits()
    }

    #[inline(always)]
    pub const fn is_undefined_or_null(self) -> bool {
        self.to_bits() & !Self::UNDEFINED_TAG == Self::NULL.to_bits()
    }

    #[inline(always)]
    pub const fn is_boolean(self) -> bool {
        self.to_bits() & !1 == Self::FALSE.to_bits()
    }

    #[inline(always)]
    pub const fn is_true(self) -> bool {
        self.to_bits() == Self::TRUE.to_bits()
    }

    #[inline(always)]
    pub const fn is_false(self) -> bool {
        self.to_bits() == Self::FALSE.to_bits()
    }

    #[inline(always)]
    pub const fn as_int32(self) -> Option<i32> {
        if self.is_int32() {
            Some(self.to_bits() as i32)
        } else {
            None
        }
    }

    /// An int32 that is not negative.
    #[inline(always)]
    pub const fn as_index_int32(self) -> Option<u32> {
        if self.to_bits().wrapping_sub(Self::NUMBER_TAG) <= i32::MAX as u64 {
            Some(self.to_bits() as u32)
        } else {
            None
        }
    }

    #[inline(always)]
    pub const fn as_double(self) -> Option<f64> {
        if self.is_double() {
            Some(self.double_unchecked())
        } else {
            None
        }
    }

    #[inline(always)]
    pub const fn as_number(self) -> Option<f64> {
        if self.is_int32() {
            Some(self.to_bits() as i32 as f64)
        } else if self.is_number() {
            Some(self.double_unchecked())
        } else {
            None
        }
    }

    /// Meaningless unless the value is a double.
    #[inline(always)]
    pub const fn double_unchecked(self) -> f64 {
        f64::from_bits(self.to_bits().wrapping_sub(Self::DOUBLE_OFFSET))
    }

    #[inline(always)]
    pub const fn as_boolean(self) -> Option<bool> {
        if self.is_boolean() {
            Some(self.is_true())
        } else {
            None
        }
    }

    /// A number that is an integer from 0 to 2^32 - 1. Negative zero is 0.
    #[inline]
    pub fn as_uint32(self) -> Option<u32> {
        if let Some(index) = self.as_index_int32() {
            return Some(index);
        }
        let number = self.as_double()?;
        let integer = number as u32;
        (f64::from(integer) == number).then_some(integer)
    }

    /// A number that is an array index. Negative zero is 0.
    #[inline]
    pub fn as_array_index(self) -> Option<u32> {
        self.as_uint32().filter(|&index| index != u32::MAX)
    }

    #[inline(always)]
    pub fn as_cell(self) -> Option<Gc<JsCell>> {
        // SAFETY: a value without tags is the address of a live cell.
        self.is_cell()
            .then(|| unsafe { Gc::from_address(self.to_bits() as usize) })
    }

    #[inline(always)]
    pub fn downcast<T: CellKind>(self) -> Option<Gc<T>> {
        self.as_cell()?.downcast()
    }

    #[inline(always)]
    pub fn is<T: CellKind>(self) -> bool {
        self.as_cell().is_some_and(|cell| T::is(&cell))
    }
}

impl Default for Value {
    fn default() -> Value {
        Value::UNDEFINED
    }
}

impl From<bool> for Value {
    #[inline(always)]
    fn from(value: bool) -> Value {
        Value::boolean(value)
    }
}

impl From<f64> for Value {
    #[inline(always)]
    fn from(value: f64) -> Value {
        Value::number(value)
    }
}

macro_rules! from_integer {
    ($($type:ty)*) => {$(
        impl From<$type> for Value {
            #[inline(always)]
            fn from(value: $type) -> Value {
                match i32::try_from(value) {
                    Ok(value) => Value::int32(value),
                    Err(_) => Value::double(value as f64),
                }
            }
        }
    )*};
}

from_integer!(i8 u8 i16 u16 i32 u32 i64 u64 isize usize);

impl<T: CellKind> From<Gc<T>> for Value {
    #[inline(always)]
    fn from(cell: Gc<T>) -> Value {
        // SAFETY: the address of a live cell, which has no tag bit set.
        unsafe { Value::from_bits(cell.address() as u64) }
    }
}

impl<T: CellKind> From<&T> for Value {
    #[inline(always)]
    fn from(cell: &T) -> Value {
        Gc::from(cell).into()
    }
}

impl core::fmt::Debug for Value {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match (*self, self.as_number(), self.as_cell()) {
            (_, Some(number), _) => write!(formatter, "{number}"),
            (_, _, Some(cell)) => write!(formatter, "{cell:?}"),
            (Value::NULL, ..) => formatter.write_str("null"),
            (Value::UNDEFINED, ..) => formatter.write_str("undefined"),
            (Value::TRUE, ..) => formatter.write_str("true"),
            (Value::FALSE, ..) => formatter.write_str("false"),
            _ => write!(formatter, "{:#x}", self.to_bits()),
        }
    }
}
