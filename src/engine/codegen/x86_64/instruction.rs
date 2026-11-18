//! Instructions without their registers. Comments list the operands. A memory operand has its base and then its
//! index at the place where a value would be.

use bun_engine_asm::x64::{Alu, BitCount, Cc, FloatFlags, RBP, ShiftOp, ShiftX, Sse, Unary};
use bun_engine_asm::{AtomicOp, FloatWidth, Gpr, Scale, Sign, Size, Width, X64Features};

use crate::ir::{Checked, Function, Load, Op, Type, Value, Wide};
use crate::machine::{Instruction, Lowering, Place, Shared, VectorInstruction};

#[derive(Clone, Copy, Debug)]
pub(crate) struct Amode {
    pub(crate) offset: i32,
    pub(crate) has_base: bool,
    pub(crate) index: Option<Scale>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Source {
    Value,
    Imm(i32),
    Memory(Amode),
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Stored {
    Value,
    Imm(i32),
}

/// Sets the flags from the left operand and the right.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Test {
    Compare(Size, Cc, Source),
    CompareMemory(Size, Cc, Amode, Stored),
    And(Size, Cc, Stored),
    AndMemory(Size, Cc, Amode, Stored),
    /// One operand, against zero.
    Zero(Size, Cc),
    Bit(Width, Cc, Stored),
    Float(FloatWidth, FloatFlags, Source),
    /// One operand.
    Vector(Cc),
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Inst {
    Copy,
    ZeroExtend,
    Jump,
    Return,
    Unreachable,
    Patchpoint,
    StoreOutgoing(i32, Type),
    LoadOutgoing(i32, Type),
    StoreResult(i32, Type),
    Shared(Shared),
    Vector(VectorInstruction),

    /// Result, left, right.
    Alu(Alu, Width, Source),
    Mul(Width, Source),
    Checked(Checked, Width, Source),
    AndNot(Width),
    /// Result, address.
    Lea(Width, Amode),
    /// Result, source.
    Unary(Unary, Width),
    ShiftImm(ShiftOp, Width, u8),
    Extend(Size, Sign, Width, Source),
    BitCount(BitCount, Width, Source),
    /// Result, temporary, source.
    BitScan(BitCount, Width),
    /// Result, source, amount. A shift by zero may leave the upper half as it is, so it can be cleared first.
    ShiftCl(ShiftOp, Width, bool),
    ShiftX(ShiftX, Width),
    /// Both of rax and rdx, rax, right.
    Divide(Sign, Width),
    MulRdxRax(Sign, Width),
    /// Low and high result, left low and high, right low and high.
    Wide(Wide),

    /// Result, address.
    LoadFloat(Type, Amode),
    LoadVector(Load, Amode),
    /// Result, vector, address.
    LoadLane(Size, u8, Amode),
    /// Value, address.
    StoreLane(Size, u8, Amode),
    Store(Size, Stored, Amode),
    StoreFloat(Type, Amode),
    Update {
        op: Alu,
        size: Size,
        src: Stored,
        address: Amode,
        is_atomic: bool,
    },
    /// Address.
    UpdateUnary(Unary, Size, Amode),
    /// Temporary, value, address.
    AtomicStore(Size, Amode),
    /// Result, operand, address.
    AtomicExchange(AtomicOp, Size, Amode),
    /// rax, temporary, operand, address.
    AtomicLoop(AtomicOp, Size, Amode),
    /// rax, rax, replacement, address.
    AtomicCompareExchange(Size, Amode),
    Fence,

    /// Result, left, right.
    Sse(Sse, Source),
    /// Result, source.
    Bitcast(Type),
    SignedToFloat(Width, FloatWidth, Source),

    Branch(Test),
    Check(Test),
    /// Result, and those of the test.
    Set(Test),
    /// Result, then, else, and those of the test.
    Select(Test),
    SelectFloat(Test),
    /// Two temporaries, index.
    JumpTable,
}

impl Instruction for Inst {
    type Features = X64Features;
    type Selection = ();

    const COPY: Self = Self::Copy;
    const ZERO_EXTEND: Self = Self::ZeroExtend;
    const JUMP: Self = Self::Jump;
    const RETURN: Self = Self::Return;
    const UNREACHABLE: Self = Self::Unreachable;
    const PATCHPOINT: Self = Self::Patchpoint;
    const FRAME_POINTER: Gpr = RBP;

    fn store_outgoing(offset: i32, ty: Type) -> Self {
        Self::StoreOutgoing(offset, ty)
    }

    fn load_outgoing(offset: i32, ty: Type) -> Self {
        Self::LoadOutgoing(offset, ty)
    }

    fn store_result(offset: i32, ty: Type) -> Self {
        Self::StoreResult(offset, ty)
    }

    fn fills_upper_half(_: &Function, _: Op) -> bool {
        false
    }

    #[inline]
    fn is_as_cheap_as_a_move(ty: Type, bits: u64) -> bool {
        bits == 0 || ty.is_int()
    }

    fn place_to_store_from(constant: Option<u64>) -> Place {
        if constant.is_some_and(|bits| i32::try_from(bits as i64).is_ok()) {
            Place::Anywhere
        } else {
            Place::Register
        }
    }

    fn lower(lowering: &mut Lowering<'_, Self>, value: Value) {
        lowering.select(value);
    }
}
