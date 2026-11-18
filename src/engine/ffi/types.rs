use core::ffi::CStr;
use core::ops::RangeInclusive;

use bun_engine_asm::{FloatWidth, Sign, Size};

use crate::convert::MAX_SAFE_INTEGER;

/// The numbers are known to the embedder.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum NativeType {
    Char = 0,
    Int8 = 1,
    Uint8 = 2,
    Int16 = 3,
    Uint16 = 4,
    Int32 = 5,
    Uint32 = 6,
    Int64 = 7,
    Uint64 = 8,
    Double = 9,
    Float = 10,
    Bool = 11,
    Pointer = 12,
    Void = 13,
    CString = 14,
    /// A number if it is exact, as is the next.
    Int64Fast = 15,
    Uint64Fast = 16,
    Function = 17,
    /// Not converted.
    Value = 19,
    /// The address of the bytes of a view.
    Buffer = 20,
    /// How many bytes a view has.
    BufferLength = 21,
}

/// What a type is to the calling convention.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Representation {
    Nothing,
    Integer(Size, Sign),
    /// A byte that is zero or not.
    Bool,
    Float(FloatWidth),
}

impl Representation {
    /// `None` for nothing.
    pub fn size(self) -> Option<Size> {
        match self {
            Representation::Nothing => None,
            Representation::Integer(size, _) => Some(size),
            Representation::Bool => Some(Size::S8),
            Representation::Float(width) => Some(width.width().size()),
        }
    }
}

impl NativeType {
    pub const ALL: [NativeType; 21] = [
        NativeType::Char,
        NativeType::Int8,
        NativeType::Uint8,
        NativeType::Int16,
        NativeType::Uint16,
        NativeType::Int32,
        NativeType::Uint32,
        NativeType::Int64,
        NativeType::Uint64,
        NativeType::Double,
        NativeType::Float,
        NativeType::Bool,
        NativeType::Pointer,
        NativeType::Void,
        NativeType::CString,
        NativeType::Int64Fast,
        NativeType::Uint64Fast,
        NativeType::Function,
        NativeType::Value,
        NativeType::Buffer,
        NativeType::BufferLength,
    ];

    pub fn from_number(number: u8) -> Option<NativeType> {
        Self::ALL.into_iter().find(|&it| it as u8 == number)
    }

    pub fn c_name(self) -> &'static CStr {
        match self {
            NativeType::Char => c"char",
            NativeType::Int8 => c"i8",
            NativeType::Uint8 => c"u8",
            NativeType::Int16 => c"i16",
            NativeType::Uint16 => c"u16",
            NativeType::Int32 => c"i32",
            NativeType::Uint32 => c"u32",
            NativeType::Int64 => c"i64",
            NativeType::Uint64 => c"u64",
            NativeType::Double => c"f64",
            NativeType::Float => c"f32",
            NativeType::Bool => c"bool",
            NativeType::Pointer => c"ptr",
            NativeType::Void => c"void",
            NativeType::CString => c"cstring",
            NativeType::Int64Fast => c"i64_fast",
            NativeType::Uint64Fast => c"u64_fast",
            NativeType::Function => c"function",
            NativeType::Value => c"jsvalue",
            NativeType::Buffer => c"buffer",
            NativeType::BufferLength => c"buffer_length",
        }
    }

    pub fn name(self) -> &'static str {
        self.c_name().to_str().unwrap_or_default()
    }

    pub fn representation(self) -> Representation {
        use Representation::{Bool, Float, Integer, Nothing};
        match self {
            NativeType::Char | NativeType::Int8 => Integer(Size::S8, Sign::Signed),
            NativeType::Uint8 => Integer(Size::S8, Sign::Unsigned),
            NativeType::Int16 => Integer(Size::S16, Sign::Signed),
            NativeType::Uint16 => Integer(Size::S16, Sign::Unsigned),
            NativeType::Int32 => Integer(Size::S32, Sign::Signed),
            NativeType::Uint32 => Integer(Size::S32, Sign::Unsigned),
            NativeType::Int64 | NativeType::Int64Fast => Integer(Size::S64, Sign::Signed),
            NativeType::Uint64
            | NativeType::Uint64Fast
            | NativeType::Pointer
            | NativeType::CString
            | NativeType::Function
            | NativeType::Value
            | NativeType::Buffer
            | NativeType::BufferLength => Integer(Size::S64, Sign::Unsigned),
            NativeType::Double => Float(FloatWidth::F64),
            NativeType::Float => Float(FloatWidth::F32),
            NativeType::Bool => Bool,
            NativeType::Void => Nothing,
        }
    }

    /// What is a number, for a type of which the rest is a BigInt.
    pub fn exact_range(self) -> RangeInclusive<i64> {
        let greatest = MAX_SAFE_INTEGER as i64;
        match self {
            NativeType::Int64Fast => -greatest..=greatest,
            NativeType::Uint64Fast => 0..=greatest - 1,
            _ => 0..=greatest,
        }
    }

    pub fn can_be_argument(self) -> bool {
        self != NativeType::Void
    }

    pub fn can_be_result(self) -> bool {
        !matches!(self, NativeType::Buffer | NativeType::BufferLength)
    }
}
