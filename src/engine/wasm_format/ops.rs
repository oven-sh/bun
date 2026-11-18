//! Operations and immediates of instructions.

use bun_engine_asm::{FloatWidth, Sign, Size};

use crate::index::{MemoryIndex, TagIndex};
use crate::reader::Reader;
use crate::types::ValType;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum IntBinaryOp {
    Add,
    Sub,
    Mul,
    And,
    Or,
    Xor,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum IntUnaryOp {
    Clz,
    Ctz,
    Popcnt,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum FloatBinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Min,
    Max,
    Copysign,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum FloatUnaryOp {
    Abs,
    Neg,
    Sqrt,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct MemArg {
    /// Fits the address type of the memory.
    pub offset: u64,
    pub memory: MemoryIndex,
}

/// In the order of the opcodes.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum LoadOp {
    I32Load,
    I64Load,
    F32Load,
    F64Load,
    I32Load8S,
    I32Load8U,
    I32Load16S,
    I32Load16U,
    I64Load8S,
    I64Load8U,
    I64Load16S,
    I64Load16U,
    I64Load32S,
    I64Load32U,
}

impl LoadOp {
    pub const ALL: [Self; 14] = [
        Self::I32Load,
        Self::I64Load,
        Self::F32Load,
        Self::F64Load,
        Self::I32Load8S,
        Self::I32Load8U,
        Self::I32Load16S,
        Self::I32Load16U,
        Self::I64Load8S,
        Self::I64Load8U,
        Self::I64Load16S,
        Self::I64Load16U,
        Self::I64Load32S,
        Self::I64Load32U,
    ];

    /// In memory.
    #[inline]
    pub const fn size(self) -> Size {
        use Size::*;
        const SIZES: [Size; 14] = [
            S32, S64, S32, S64, S8, S8, S16, S16, S8, S8, S16, S16, S32, S32,
        ];
        SIZES[self as usize]
    }

    /// `Unsigned` if nothing is extended.
    #[inline]
    pub const fn sign(self) -> Sign {
        match self {
            Self::I32Load8S
            | Self::I32Load16S
            | Self::I64Load8S
            | Self::I64Load16S
            | Self::I64Load32S => Sign::Signed,
            _ => Sign::Unsigned,
        }
    }

    #[inline]
    pub const fn value_type(self) -> ValType {
        const I32: ValType = ValType::I32;
        const I64: ValType = ValType::I64;
        const F32: ValType = ValType::F32;
        const F64: ValType = ValType::F64;
        const TYPES: [ValType; 14] = [
            I32, I64, F32, F64, I32, I32, I32, I32, I64, I64, I64, I64, I64, I64,
        ];
        TYPES[self as usize]
    }
}

/// In the order of the opcodes.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum StoreOp {
    I32Store,
    I64Store,
    F32Store,
    F64Store,
    I32Store8,
    I32Store16,
    I64Store8,
    I64Store16,
    I64Store32,
}

impl StoreOp {
    pub const ALL: [Self; 9] = [
        Self::I32Store,
        Self::I64Store,
        Self::F32Store,
        Self::F64Store,
        Self::I32Store8,
        Self::I32Store16,
        Self::I64Store8,
        Self::I64Store16,
        Self::I64Store32,
    ];

    /// In memory.
    #[inline]
    pub const fn size(self) -> Size {
        use Size::*;
        const SIZES: [Size; 9] = [S32, S64, S32, S64, S8, S16, S8, S16, S32];
        SIZES[self as usize]
    }

    #[inline]
    pub const fn value_type(self) -> ValType {
        const I32: ValType = ValType::I32;
        const I64: ValType = ValType::I64;
        const F32: ValType = ValType::F32;
        const F64: ValType = ValType::F64;
        const TYPES: [ValType; 9] = [I32, I64, F32, F64, I32, I32, I64, I64, I64];
        TYPES[self as usize]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum VectorLoadOp {
    Whole,
    /// Reads 8 bytes and doubles the size of each lane.
    Extend(Size, Sign),
    Splat(Size),
    /// Reads 4 or 8 bytes and clears the rest, as the load of a float does.
    Zero(FloatWidth),
}

impl VectorLoadOp {
    /// Of what is read.
    #[inline]
    pub const fn log2_bytes(self) -> u8 {
        match self {
            Self::Whole => 4,
            Self::Extend(..) => 3,
            Self::Splat(size) => size.log2_bytes(),
            Self::Zero(width) => width.width().size().log2_bytes(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum LaneType {
    Int(Size),
    Float(FloatWidth),
}

impl LaneType {
    #[inline]
    pub const fn size(self) -> Size {
        match self {
            Self::Int(size) => size,
            Self::Float(width) => width.width().size(),
        }
    }

    /// The type on the operand stack.
    #[inline]
    pub const fn value_type(self) -> ValType {
        match self {
            Self::Int(size) => ValType::int(size.width()),
            Self::Float(width) => ValType::float(width),
        }
    }
}

/// Whether control arrives from the instruction before.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Flow {
    Live,
    /// The point is reached only by other edges, if at all. What the block left on the operand stack is void.
    Dead,
}

#[derive(Clone, Copy)]
pub struct BrTable<'a> {
    pub(crate) reader: Reader<'a>,
    pub(crate) count: u32,
    pub(crate) default: u32,
}

impl<'a> BrTable<'a> {
    #[inline]
    pub fn default_label(&self) -> u32 {
        self.default
    }

    /// Without the default.
    #[inline]
    pub fn labels(&self) -> impl ExactSizeIterator<Item = u32> + use<'a> {
        let mut reader = self.reader;
        (0..self.count).map(move |_| reader.u32().expect("a label that was read before"))
    }
}

/// A clause of `try_table`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Catch {
    /// `None` catches all, and passes no payload.
    pub tag: Option<TagIndex>,
    /// Whether the `exnref` follows the payload.
    pub passes_exnref: bool,
    /// Counts from outside the `try_table`.
    pub label: u32,
}

#[derive(Clone, Copy)]
pub struct Catches<'a> {
    pub(crate) reader: Reader<'a>,
    pub(crate) count: u32,
}

impl Catches<'_> {
    pub(crate) const PASSES_EXNREF: u8 = 1;
    pub(crate) const ALL_TAGS: u8 = 2;

    fn read(&mut self) -> Option<Catch> {
        let kind = self.reader.u8()?;
        let tag = if kind & Self::ALL_TAGS == 0 {
            Some(TagIndex(self.reader.u32()?))
        } else {
            None
        };
        Some(Catch {
            tag,
            passes_exnref: kind & Self::PASSES_EXNREF != 0,
            label: self.reader.u32()?,
        })
    }
}

impl Iterator for Catches<'_> {
    type Item = Catch;

    fn next(&mut self) -> Option<Catch> {
        self.count = self.count.checked_sub(1)?;
        Some(self.read().expect("a clause that was read before"))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.count as usize, Some(self.count as usize))
    }
}

impl ExactSizeIterator for Catches<'_> {}
