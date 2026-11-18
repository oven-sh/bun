//! What an instruction does.

use bun_engine_asm::{
    AtomicOp, Cond, FloatCond, FloatWidth, Gpr, Rounding, Sign, Size, VectorBinary, VectorReduce,
    VectorShift, VectorTernary, VectorUnary, Width,
};

use super::entities::{
    Cases, Heap, Patchpoint, Slot, Span, State, Value, Variable, VectorConstant,
};
use super::node::NodeKind;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Type {
    Void,
    I32,
    I64,
    F32,
    F64,
    V128,
    /// Several results, which only `Extract` reads.
    Tuple,
}

impl Type {
    #[inline]
    pub fn is_int(self) -> bool {
        matches!(self, Self::I32 | Self::I64)
    }

    #[inline]
    pub fn is_float(self) -> bool {
        matches!(self, Self::F32 | Self::F64)
    }

    /// Fits in a register.
    #[inline]
    pub fn is_data(self) -> bool {
        !matches!(self, Self::Void | Self::Tuple)
    }

    /// Of an integer or a float.
    #[inline]
    pub fn width(self) -> Width {
        match self {
            Self::I32 | Self::F32 => Width::W32,
            Self::I64 | Self::F64 => Width::W64,
            _ => unreachable!("not a scalar"),
        }
    }

    #[inline]
    pub fn float_width(self) -> FloatWidth {
        match self {
            Self::F32 => FloatWidth::F32,
            Self::F64 => FloatWidth::F64,
            _ => unreachable!("not a float"),
        }
    }

    #[inline]
    pub fn bytes(self) -> u32 {
        match self {
            Self::I32 | Self::F32 => 4,
            Self::I64 | Self::F64 => 8,
            Self::V128 => 16,
            Self::Void | Self::Tuple => unreachable!("has no size"),
        }
    }
}

impl From<Width> for Type {
    #[inline]
    fn from(width: Width) -> Self {
        match width {
            Width::W32 => Self::I32,
            Width::W64 => Self::I64,
        }
    }
}

impl From<FloatWidth> for Type {
    #[inline]
    fn from(width: FloatWidth) -> Self {
        match width {
            FloatWidth::F32 => Self::F32,
            FloatWidth::F64 => Self::F64,
        }
    }
}

/// Where in the client's program an instruction comes from.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct Origin(pub u32);

/// Tells the client which of its exits, patchpoints or calls is meant.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Token(pub u32);

/// 64 bits that do not raise the alignment of [`Op`].
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Bits64([u32; 2]);

impl Bits64 {
    #[inline]
    pub fn new(bits: u64) -> Self {
        Self([bits as u32, (bits >> 32) as u32])
    }

    #[inline]
    pub fn get(self) -> u64 {
        u64::from(self.0[0]) | u64::from(self.0[1]) << 32
    }
}

impl core::fmt::Debug for Bits64 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:#x}", self.get())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Unary {
    /// Of an integer or a float.
    Neg,
    CountLeadingZeros,
    CountTrailingZeros,
    CountOnes,
    /// Reverses the low bytes and clears the rest.
    SwapBytes(Size),
    /// The low 8 or 16 bits, within the type of the operand.
    SignExtend(Size),
    /// From I32 to I64.
    Widen(Sign),
    /// From I64 to I32.
    Wrap,
    Abs,
    Sqrt,
    Round(Rounding),
    /// From F32 to F64.
    Promote,
    /// From F64 to F32.
    Demote,
    IntToFloat(Sign),
    /// Rounds toward zero. What does not fit gives any integer.
    FloatToInt(Sign),
    FloatToIntSaturating(Sign),
    /// ToInt32 of an F64, for targets that have an instruction for it.
    FloatToInt32Modular,
    /// From the low 16 bits of an I32 to F64, for targets that support it.
    HalfBitsToFloat,
    FloatToHalfBits,
    /// Between an integer and a float of the same width.
    Bitcast,
    /// Replaces every NaN of an F64 with the canonical one.
    CanonicalizeNan,
    /// The operand, about which no pass assumes anything.
    Opaque,
    /// The integer, of which no more than so many low bits are set where control gets here.
    FitsIn(u8),
}

/// The operands and the result have one type, except that shifts are by an I32, modulo the width.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Binary {
    Add,
    Sub,
    Mul,
    /// Of floats, or of signed integers whose quotient exists and fits.
    Div,
    /// The quotient exists and fits.
    Rem,
    UnsignedDiv,
    UnsignedRem,
    /// Signed. Division by zero gives zero and the quotient wraps.
    TotalDiv,
    /// Signed. Division by zero gives zero.
    TotalRem,
    MulHigh(Sign),
    /// `And`, `Or` and `Xor` are also of the bits of floats.
    And,
    Or,
    Xor,
    Shl,
    Shr,
    Sar,
    RotateLeft,
    RotateRight,
    /// Of floats: NaN if either is, and −0 is less than 0.
    Min,
    Max,
    CopySign,
}

impl Binary {
    #[inline]
    pub fn is_commutative(self) -> bool {
        matches!(
            self,
            Self::Add
                | Self::Mul
                | Self::MulHigh(_)
                | Self::And
                | Self::Or
                | Self::Xor
                | Self::Min
                | Self::Max
        )
    }

    #[inline]
    pub fn is_shift(self) -> bool {
        matches!(
            self,
            Self::Shl | Self::Shr | Self::Sar | Self::RotateLeft | Self::RotateRight
        )
    }

    /// For integers, some operands are not allowed.
    #[inline]
    pub fn is_partial(self) -> bool {
        matches!(
            self,
            Self::Div | Self::Rem | Self::UnsignedDiv | Self::UnsignedRem
        )
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Checked {
    Add,
    Sub,
    Mul,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Wide {
    Add,
    Sub,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Load {
    /// One or two bytes, extended to I32.
    Narrow(Size, Sign),
    /// As many bytes as the type has.
    Full,
    /// Eight bytes, with lanes of this size doubled.
    VectorExtend(Size, Sign),
    VectorSplat(Size),
    /// Four or eight bytes into the low lane, and zeros.
    VectorZero(Size),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Store {
    /// The low bytes of an integer that has more.
    Narrow(Size),
    Full,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Lanes {
    Int(Size),
    Float(FloatWidth),
}

impl Lanes {
    pub fn scalar(self) -> Type {
        match self {
            Self::Int(size) => size.width().into(),
            Self::Float(width) => width.into(),
        }
    }

    pub fn count(self) -> u8 {
        match self {
            Self::Int(size) => 16 / size.bytes(),
            Self::Float(width) => 16 / width.width().size().bytes(),
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct AccessFlags: u8 {
        /// A fault is how the program learns of a bad address.
        const TRAPS = 1 << 0;
        /// For loads: wherever the address is at hand, the bytes are the same.
        const IMMUTABLE = 1 << 1;
        /// For loads: the address can be read wherever it can be computed, and so can each value that reaches it through
        /// parameters and variables.
        const ALWAYS_READABLE = 1 << 2;
        /// Sequentially consistent. The address is aligned.
        const ATOMIC = 1 << 3;
    }
}

/// The heap that a memory instruction touches, and how.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Access(u32);

impl Access {
    const HEAP_BITS: u32 = 24;

    #[inline]
    pub const fn new(heap: Heap, flags: AccessFlags) -> Self {
        assert!(heap.0 >> Self::HEAP_BITS == 0);
        Self(heap.0 | (flags.bits() as u32) << Self::HEAP_BITS)
    }

    #[inline]
    pub fn heap(self) -> Heap {
        Heap(self.0 & ((1 << Self::HEAP_BITS) - 1))
    }

    #[inline]
    pub fn flags(self) -> AccessFlags {
        AccessFlags::from_bits_retain((self.0 >> Self::HEAP_BITS) as u8)
    }

    #[inline]
    pub fn has(self, flag: AccessFlags) -> bool {
        self.flags().intersects(flag)
    }
}

impl From<Heap> for Access {
    #[inline]
    fn from(heap: Heap) -> Self {
        Self::new(heap, AccessFlags::empty())
    }
}

impl core::fmt::Debug for Access {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", self.heap())?;
        self.flags()
            .iter_names()
            .try_for_each(|(name, _)| write!(f, " {name}"))
    }
}

/// Where control goes when a check fails. It does not come back.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Exit {
    pub token: Token,
    pub state: State,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Op {
    // These are in no block and can be used anywhere. A function has one value for each.
    Const32(i32),
    Const64(Bits64),
    ConstF32(u32),
    ConstF64(Bits64),
    ConstV128(VectorConstant),
    /// A register that holds the same value throughout the function.
    Pinned(Gpr),
    SlotAddress(Slot),
    /// A pinned register or the frame pointer plus a constant. Only instruction selection makes these.
    Displaced(Gpr, i32),

    /// The parameter of the value's block at this position.
    Param(u32),
    /// What is left of a value that another has replaced, until its uses are redirected.
    Alias(Value),
    /// What is left of a value that has been removed.
    Removed,

    Unary(Unary, Value),
    Binary(Binary, [Value; 2]),
    /// Gives an I32 that is 0 or 1.
    Compare(Cond, [Value; 2]),
    FloatCompare(FloatCond, [Value; 2]),
    /// The second if the first, an integer, is not zero, or else the third.
    Select([Value; 3]),
    /// Low and high half of each operand, to a tuple of low and high half.
    Wide(Wide, [Value; 4]),
    /// From two I64 to a tuple of low and high half.
    MulWide(Sign, [Value; 2]),
    Extract(Value, u32),

    Load {
        kind: Load,
        address: Value,
        offset: i32,
        access: Access,
    },
    /// The value, then the address.
    Store {
        kind: Store,
        args: [Value; 2],
        offset: i32,
        access: Access,
    },
    /// The vector, then the address.
    LoadLane {
        lanes: Size,
        lane: u8,
        args: [Value; 2],
        offset: i32,
        access: Access,
    },
    StoreLane {
        lanes: Size,
        lane: u8,
        args: [Value; 2],
        offset: i32,
        access: Access,
    },
    /// The operand, then the address. Gives the old value, extended with zeros.
    AtomicUpdate {
        op: AtomicOp,
        size: Size,
        args: [Value; 2],
        access: Access,
    },
    /// What is expected, what replaces it, and the address. Gives the old value, extended with zeros.
    AtomicCompareExchange {
        size: Size,
        args: [Value; 3],
        access: Access,
    },
    /// With nothing to write it orders stores only, and with nothing to read loads only.
    Fence {
        reads: Heap,
        writes: Heap,
    },

    /// Exits if the integer is not zero.
    Check(Value, Exit),
    /// Exits if the signed result does not fit.
    Checked(Checked, [Value; 2], Exit),
    Patchpoint(Patchpoint),

    VectorUnary(VectorUnary, Value),
    VectorBinary(VectorBinary, [Value; 2]),
    VectorTernary(VectorTernary, [Value; 3]),
    /// By an I32.
    VectorShift(VectorShift, [Value; 2]),
    VectorReduce(VectorReduce, Value),
    Shuffle([Value; 2], VectorConstant),
    Splat(Lanes, Value),
    ExtractLane {
        lanes: Lanes,
        sign: Sign,
        lane: u8,
        vector: Value,
    },
    /// The vector, then the scalar.
    ReplaceLane {
        lanes: Lanes,
        lane: u8,
        args: [Value; 2],
    },

    /// The first `count` of `args` are the operands.
    Node {
        kind: NodeKind,
        count: u8,
        args: [Value; 2],
        data: u32,
        state: State,
    },
    WideNode {
        kind: NodeKind,
        args: Span<Value>,
        data: u32,
        state: State,
    },

    GetVariable(Variable),
    SetVariable(Variable, Value),

    // These end a block, as does a patchpoint that says so.
    Jump,
    /// Takes the first edge if the integer is not zero.
    Branch(Value),
    /// Takes the edge at the position of the key that matches, or the last.
    Switch(Value, Cases),
    /// The I32 is a position in the cases, which are positions of edges.
    JumpTable(Value, Cases),
    /// The values go to the result locations of the function.
    Return(Span<Value>),
    Unreachable,
}

const _: () = assert!(size_of::<Op>() == 20);

macro_rules! inline_operands {
    ($op:expr, $one:path, $first:path, $none:expr) => {
        match $op {
            Op::Alias(a)
            | Op::Unary(_, a)
            | Op::Extract(a, _)
            | Op::Load { address: a, .. }
            | Op::Check(a, _)
            | Op::VectorUnary(_, a)
            | Op::VectorReduce(_, a)
            | Op::Splat(_, a)
            | Op::ExtractLane { vector: a, .. }
            | Op::SetVariable(_, a)
            | Op::Branch(a)
            | Op::Switch(a, _)
            | Op::JumpTable(a, _) => $one(a),
            Op::Binary(_, args)
            | Op::Compare(_, args)
            | Op::FloatCompare(_, args)
            | Op::MulWide(_, args)
            | Op::Store { args, .. }
            | Op::LoadLane { args, .. }
            | Op::StoreLane { args, .. }
            | Op::AtomicUpdate { args, .. }
            | Op::Checked(_, args, _)
            | Op::VectorBinary(_, args)
            | Op::VectorShift(_, args)
            | Op::Shuffle(args, _)
            | Op::ReplaceLane { args, .. } => args,
            Op::Select(args)
            | Op::AtomicCompareExchange { args, .. }
            | Op::VectorTernary(_, args) => args,
            Op::Wide(_, args) => args,
            Op::Node { count, args, .. } => $first(args, *count),
            Op::Const32(_)
            | Op::Const64(_)
            | Op::ConstF32(_)
            | Op::ConstF64(_)
            | Op::ConstV128(_)
            | Op::Pinned(_)
            | Op::SlotAddress(_)
            | Op::Displaced(..)
            | Op::Param(_)
            | Op::Removed
            | Op::Fence { .. }
            | Op::Patchpoint(_)
            | Op::WideNode { .. }
            | Op::GetVariable(_)
            | Op::Jump
            | Op::Return(_)
            | Op::Unreachable => $none,
        }
    };
}

#[inline]
fn first(args: &[Value; 2], count: u8) -> &[Value] {
    &args[..count.into()]
}

#[inline]
fn first_mut(args: &mut [Value; 2], count: u8) -> &mut [Value] {
    &mut args[..count.into()]
}

impl Op {
    /// The kind and the data of a node.
    #[inline]
    pub fn node(&self) -> Option<(NodeKind, u32)> {
        match *self {
            Self::Node { kind, data, .. } | Self::WideNode { kind, data, .. } => Some((kind, data)),
            _ => None,
        }
    }

    #[inline]
    pub fn node_mut(&mut self) -> Option<(&mut NodeKind, &mut u32)> {
        match self {
            Self::Node { kind, data, .. } | Self::WideNode { kind, data, .. } => Some((kind, data)),
            _ => None,
        }
    }

    /// All operands but those of a patchpoint, wide node or return and those in a state.
    #[inline]
    pub fn inline_operands(&self) -> &[Value] {
        inline_operands!(self, core::slice::from_ref, first, &[])
    }

    #[inline]
    pub fn inline_operands_mut(&mut self) -> &mut [Value] {
        inline_operands!(self, core::slice::from_mut, first_mut, &mut [])
    }

    #[inline]
    pub fn is_floating(&self) -> bool {
        self.is_constant()
            || matches!(
                self,
                Self::Pinned(_) | Self::SlotAddress(_) | Self::Displaced(..)
            )
    }

    #[inline]
    pub fn is_constant(&self) -> bool {
        matches!(
            self,
            Self::Const32(_)
                | Self::Const64(_)
                | Self::ConstF32(_)
                | Self::ConstF64(_)
                | Self::ConstV128(_)
        )
    }

    #[inline]
    pub fn exit(&self) -> Option<Exit> {
        match *self {
            Self::Check(_, exit) | Self::Checked(_, _, exit) => Some(exit),
            _ => None,
        }
    }

    #[inline]
    pub fn access(&self) -> Option<Access> {
        match *self {
            Self::Load { access, .. }
            | Self::Store { access, .. }
            | Self::LoadLane { access, .. }
            | Self::StoreLane { access, .. }
            | Self::AtomicUpdate { access, .. }
            | Self::AtomicCompareExchange { access, .. } => Some(access),
            _ => None,
        }
    }
}
