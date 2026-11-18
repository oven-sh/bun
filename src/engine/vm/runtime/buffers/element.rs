//! The types of the elements of typed arrays.

use core::ops::{BitOr, BitXor};

use bun_alloc::AllocError;
use bun_engine_number::{float16_from_f64, float16_to_f64, to_int32, to_uint8_clamp};
use bun_engine_text::{PropertyName, names};
use bun_highway::elements::Lane;

use super::atomics::AtomicBits;
use crate::{CellType, Cx, GcFree, JsBigInt, JsResult, Value, Vm};

/// In the order of the cell types.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum ElementType {
    Int8,
    Uint8,
    Uint8Clamped,
    Int16,
    Uint16,
    Int32,
    Uint32,
    Float16,
    Float32,
    Float64,
    BigInt64,
    BigUint64,
}

/// `with_element_type!(element_type, T => expression)` has `T` name the `Element` of that type.
#[macro_export]
macro_rules! with_element_type {
    ($element_type:expr, $alias:ident => $body:expr) => {
        $crate::with_element_type!($element_type, $alias => $body, bigint $alias => $body)
    };
    ($element_type:expr, $number:ident => $for_number:expr, bigint => $for_bigint:expr) => {
        $crate::with_element_type!($element_type, $number => $for_number, bigint _Unused => $for_bigint)
    };
    ($element_type:expr, $number:ident => $for_number:expr, bigint $bigint:ident => $for_bigint:expr) => {
        match $element_type {
            $crate::ElementType::Int8 => { type $number = i8; $for_number }
            $crate::ElementType::Uint8 => { type $number = u8; $for_number }
            $crate::ElementType::Uint8Clamped => { type $number = $crate::ClampedU8; $for_number }
            $crate::ElementType::Int16 => { type $number = i16; $for_number }
            $crate::ElementType::Uint16 => { type $number = u16; $for_number }
            $crate::ElementType::Int32 => { type $number = i32; $for_number }
            $crate::ElementType::Uint32 => { type $number = u32; $for_number }
            $crate::ElementType::Float16 => { type $number = $crate::Float16; $for_number }
            $crate::ElementType::Float32 => { type $number = f32; $for_number }
            $crate::ElementType::Float64 => { type $number = f64; $for_number }
            $crate::ElementType::BigInt64 => { type $bigint = i64; $for_bigint }
            $crate::ElementType::BigUint64 => { type $bigint = u64; $for_bigint }
        }
    };
}

/// `with_bits_type!(element_type, K => expression)` has `K` name the unsigned integer of that size.
#[macro_export]
macro_rules! with_bits_type {
    ($element_type:expr, $alias:ident => $body:expr) => {
        match $element_type.size_shift() {
            0 => {
                type $alias = u8;
                $body
            }
            1 => {
                type $alias = u16;
                $body
            }
            2 => {
                type $alias = u32;
                $body
            }
            _ => {
                type $alias = u64;
                $body
            }
        }
    };
}

impl ElementType {
    pub const COUNT: usize = Self::ALL.len();
    pub const ALL: [ElementType; 12] = [
        ElementType::Int8,
        ElementType::Uint8,
        ElementType::Uint8Clamped,
        ElementType::Int16,
        ElementType::Uint16,
        ElementType::Int32,
        ElementType::Uint32,
        ElementType::Float16,
        ElementType::Float32,
        ElementType::Float64,
        ElementType::BigInt64,
        ElementType::BigUint64,
    ];

    /// Two bits for each type of view, from `Int8Array` on: the logarithm of the size of an element.
    pub const PACKED_SIZE_SHIFTS: u32 = {
        let (mut packed, mut index) = (0, 0);
        while index < Self::COUNT {
            packed |= Self::ALL[index].size().ilog2() << (index * 2);
            index += 1;
        }
        packed
    };

    #[inline(always)]
    pub const fn of_cell_type(cell_type: CellType) -> Option<ElementType> {
        let index = cell_type.0.wrapping_sub(CellType::Int8Array.0);
        if index as usize >= Self::COUNT {
            return None;
        }
        // SAFETY: the number of a variant.
        Some(unsafe { core::mem::transmute::<u8, ElementType>(index) })
    }

    #[inline(always)]
    pub const fn cell_type(self) -> CellType {
        CellType(CellType::Int8Array.0 + self as u8)
    }

    #[inline(always)]
    pub const fn size(self) -> usize {
        with_element_type!(self, T => size_of::<T>())
    }

    /// The logarithm of the size.
    #[inline(always)]
    pub const fn size_shift(self) -> u32 {
        Self::PACKED_SIZE_SHIFTS >> (self as u32 * 2) & 3
    }

    /// The bits of the element that the value converts to.
    pub fn bits_from_value(self, cx: &mut Cx, value: Value) -> JsResult<u64> {
        fn convert<T: Element>(cx: &mut Cx, value: Value) -> JsResult<u64> {
            Ok(T::from_value(cx, value)?.to_bits().into())
        }
        with_element_type!(self, T => convert::<T>(cx, value))
    }

    #[inline(always)]
    pub const fn is_bigint(self) -> bool {
        matches!(self, ElementType::BigInt64 | ElementType::BigUint64)
    }

    #[inline(always)]
    pub const fn is_float(self) -> bool {
        matches!(
            self,
            ElementType::Float16 | ElementType::Float32 | ElementType::Float64
        )
    }

    /// An integer that can be negative.
    #[inline(always)]
    pub const fn is_signed(self) -> bool {
        matches!(
            self,
            ElementType::Int8 | ElementType::Int16 | ElementType::Int32 | ElementType::BigInt64
        )
    }

    /// The highest bit.
    #[inline(always)]
    pub const fn sign_bit(self) -> u64 {
        1 << (self.size() * 8 - 1)
    }

    /// Of a type that is no float, zero.
    #[inline(always)]
    pub const fn bits_of_infinity(self) -> u64 {
        match self {
            ElementType::Float16 => 0x7c00,
            ElementType::Float32 => f32::INFINITY.to_bits() as u64,
            ElementType::Float64 => f64::INFINITY.to_bits(),
            _ => 0,
        }
    }

    /// The highest bit of the fraction is set, and no other.
    #[inline(always)]
    pub const fn bits_of_nan(self) -> u64 {
        self.bits_of_infinity() | self.bits_of_infinity() >> 1
    }

    /// Whether converting an element of `source` to this type leaves its bits as they are.
    #[inline]
    pub const fn has_bits_of(self, source: ElementType) -> bool {
        match (self, source) {
            (ElementType::Uint8Clamped, ElementType::Int8) => false,
            _ if self.is_float() || source.is_float() => self as u8 == source as u8,
            _ => self.size() == source.size(),
        }
    }

    /// `[[TypedArrayName]]`
    pub const fn name(self) -> PropertyName<'static> {
        match self {
            ElementType::Int8 => names::Int8Array,
            ElementType::Uint8 => names::Uint8Array,
            ElementType::Uint8Clamped => names::Uint8ClampedArray,
            ElementType::Int16 => names::Int16Array,
            ElementType::Uint16 => names::Uint16Array,
            ElementType::Int32 => names::Int32Array,
            ElementType::Uint32 => names::Uint32Array,
            ElementType::Float16 => names::Float16Array,
            ElementType::Float32 => names::Float32Array,
            ElementType::Float64 => names::Float64Array,
            ElementType::BigInt64 => names::BigInt64Array,
            ElementType::BigUint64 => names::BigUint64Array,
        }
    }
}

const _: () = assert!(ElementType::BigUint64.cell_type().0 == CellType::BigUint64Array.0);

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct ClampedU8(pub u8);

/// The bits of an IEEE 754 binary16 value.
#[derive(Clone, Copy, Default, Debug)]
#[repr(transparent)]
pub struct Float16(pub u16);

/// # Safety
/// Has the size that `TYPE` says and no padding, and any bits are a value.
pub unsafe trait Element: Copy + Default + GcFree + 'static {
    const TYPE: ElementType;

    /// The unsigned integer of the same size.
    type Bits: Bits;

    fn to_value(self, vm: &Vm) -> Value;

    /// ToNumber or ToBigInt, and then the conversion operation of the type.
    fn from_value(cx: &mut Cx, value: Value) -> JsResult<Self>;

    /// The same for a number or a BigInt, whichever the type takes. `None` for anything else.
    fn from_numeric(value: Value) -> Option<Self>;

    /// The element that is the same value, if there is one. Any NaN stands for NaN.
    fn exactly(value: Value) -> Option<Self>;

    fn is_nan(self) -> bool {
        false
    }

    #[inline(always)]
    fn to_bits(self) -> Self::Bits {
        const { assert!(size_of::<Self>() == size_of::<Self::Bits>()) };
        // SAFETY: of the same size, and any bits are a value.
        unsafe { core::mem::transmute_copy(&self) }
    }

    #[inline(always)]
    fn from_bits(bits: Self::Bits) -> Self {
        const { assert!(size_of::<Self>() == size_of::<Self::Bits>()) };
        // SAFETY: as above.
        unsafe { core::mem::transmute_copy(&bits) }
    }
}

/// An unsigned integer.
pub trait Bits:
    Element + Ord + Into<u64> + BitOr<Output = Self> + BitXor<Output = Self> + AtomicBits + Lane
{
    /// Keeps the low bits.
    fn truncate(wide: u64) -> Self;

    fn swap_bytes(self) -> Self;

    fn try_zeroed_vec(length: usize) -> Result<Vec<Self>, AllocError> {
        let zeroed = Box::try_new_zeroed_slice(length).map_err(|_| AllocError)?;
        // SAFETY: any bits are a value.
        Ok(unsafe { zeroed.assume_init() }.into_vec())
    }
}

macro_rules! bits {
    ($($type:ty)*) => {$(
        impl Bits for $type {
            #[inline(always)]
            fn truncate(wide: u64) -> $type {
                wide as $type
            }

            #[inline(always)]
            fn swap_bytes(self) -> $type {
                <$type>::swap_bytes(self)
            }
        }
    )*};
}

bits!(u8 u16 u32 u64);

pub trait NumberElement: Element {
    /// A type that numbers are converted to in the same way, so that the two share their code.
    type Target: NumberElement;

    /// One whose bits mean the same.
    type Source: NumberElement;

    fn from_int32(value: i32) -> Self;

    fn from_uint32(value: u32) -> Self;

    fn from_double(value: f64) -> Self;

    fn convert<T: NumberElement>(self) -> T;

    fn to_number_value(self) -> Value;
}

macro_rules! number_methods {
    () => {
        #[inline(always)]
        fn to_value(self, _: &Vm) -> Value {
            self.to_number_value()
        }

        #[inline(always)]
        fn from_value(cx: &mut Cx, value: Value) -> JsResult<Self> {
            match value.as_int32() {
                Some(integer) => Ok(Self::from_int32(integer)),
                None => value.to_number(cx).map(Self::from_double),
            }
        }

        #[inline(always)]
        fn from_numeric(value: Value) -> Option<Self> {
            match value.as_int32() {
                Some(integer) => Some(Self::from_int32(integer)),
                None => value.as_double().map(Self::from_double),
            }
        }
    };
}

macro_rules! integer_elements {
    ($($type:ty, $name:ident, $bits:ty, $widen:ident($wide:ty);)*) => {$(
        // SAFETY: an integer of that size.
        unsafe impl Element for $type {
            const TYPE: ElementType = ElementType::$name;

            type Bits = $bits;

            number_methods!();

            #[inline]
            fn exactly(value: Value) -> Option<$type> {
                let number = value.as_number()?;
                let integer = number as $type;
                (f64::from(integer) == number).then_some(integer)
            }
        }

        impl NumberElement for $type {
            type Target = $bits;
            type Source = $type;

            #[inline(always)]
            fn from_int32(value: i32) -> $type {
                value as $type
            }

            #[inline(always)]
            fn from_uint32(value: u32) -> $type {
                value as $type
            }

            #[inline(always)]
            fn from_double(value: f64) -> $type {
                to_int32(value) as $type
            }

            #[inline(always)]
            fn convert<T: NumberElement>(self) -> T {
                T::$widen(<$wide>::from(self))
            }

            #[inline(always)]
            fn to_number_value(self) -> Value {
                self.into()
            }
        }
    )*};
}

integer_elements! {
    i8, Int8, u8, from_int32(i32);
    u8, Uint8, u8, from_int32(i32);
    i16, Int16, u16, from_int32(i32);
    u16, Uint16, u16, from_int32(i32);
    i32, Int32, u32, from_int32(i32);
    u32, Uint32, u32, from_uint32(u32);
}

// SAFETY: a byte.
unsafe impl Element for ClampedU8 {
    const TYPE: ElementType = ElementType::Uint8Clamped;

    type Bits = u8;

    number_methods!();

    #[inline]
    fn exactly(value: Value) -> Option<ClampedU8> {
        u8::exactly(value).map(ClampedU8)
    }
}

impl NumberElement for ClampedU8 {
    type Target = ClampedU8;
    type Source = u8;

    #[inline(always)]
    fn from_int32(value: i32) -> ClampedU8 {
        ClampedU8(value.clamp(0, 255) as u8)
    }

    #[inline(always)]
    fn from_uint32(value: u32) -> ClampedU8 {
        ClampedU8(value.min(255) as u8)
    }

    #[inline(always)]
    fn from_double(value: f64) -> ClampedU8 {
        ClampedU8(to_uint8_clamp(value))
    }

    #[inline(always)]
    fn convert<T: NumberElement>(self) -> T {
        self.0.convert()
    }

    #[inline(always)]
    fn to_number_value(self) -> Value {
        self.0.into()
    }
}

impl From<Float16> for f64 {
    #[inline(always)]
    fn from(value: Float16) -> f64 {
        float16_to_f64(value.0)
    }
}

macro_rules! float_elements {
    ($($type:ty, $name:ident, $bits:ty, |$value:ident| $narrow:expr;)*) => {$(
        // SAFETY: a floating-point number of that size.
        unsafe impl Element for $type {
            const TYPE: ElementType = ElementType::$name;

            type Bits = $bits;

            number_methods!();

            #[inline]
            fn exactly(value: Value) -> Option<$type> {
                let number = value.as_number()?;
                let element = Self::from_double(number);
                (f64::from(element) == number || number.is_nan()).then_some(element)
            }

            #[inline(always)]
            fn is_nan(self) -> bool {
                f64::from(self).is_nan()
            }
        }

        impl NumberElement for $type {
            type Target = $type;
            type Source = $type;

            #[inline(always)]
            fn from_int32(value: i32) -> $type {
                Self::from_double(value.into())
            }

            #[inline(always)]
            fn from_uint32(value: u32) -> $type {
                Self::from_double(value.into())
            }

            #[inline(always)]
            fn from_double($value: f64) -> $type {
                $narrow
            }

            #[inline(always)]
            fn convert<T: NumberElement>(self) -> T {
                T::from_double(self.into())
            }

            #[inline(always)]
            fn to_number_value(self) -> Value {
                Value::double(self.into())
            }
        }
    )*};
}

float_elements! {
    Float16, Float16, u16, |value| Float16(float16_from_f64(value));
    f32, Float32, u32, |value| value as f32;
    f64, Float64, u64, |value| value;
}

macro_rules! bigint_elements {
    ($($type:ty, $name:ident, $exact:ident;)*) => {$(
        // SAFETY: an integer of that size.
        unsafe impl Element for $type {
            const TYPE: ElementType = ElementType::$name;

            type Bits = u64;

            #[inline]
            fn to_value(self, vm: &Vm) -> Value {
                JsBigInt::from_small(vm, self).into()
            }

            #[inline]
            fn from_value(cx: &mut Cx, value: Value) -> JsResult<$type> {
                value.to_biguint64(cx).map(|bits| bits as $type)
            }

            #[inline]
            fn from_numeric(value: Value) -> Option<$type> {
                Some(value.as_bigint()?.value().to_u64_wrapping() as $type)
            }

            #[inline]
            fn exactly(value: Value) -> Option<$type> {
                value.as_bigint()?.value().$exact()
            }
        }
    )*};
}

bigint_elements! {
    i64, BigInt64, to_i64;
    u64, BigUint64, to_u64;
}
