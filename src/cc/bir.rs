//! BIR: the serialized form of a compiled C translation unit.
//!
//! This file is the Rust mirror of `Source/JavaScriptCore/ffi/BIR.h` in WebKit. Opcode
//! byte values and the encoding order must match that header exactly.
//!
//! Layout (little-endian; varuint = unsigned LEB128, varint = signed LEB128,
//! str = varuint length + bytes, type = u8):
//!
//! ```text
//! magic "BIR0"
//! u8 arch, u8 os, u8 pointerBytes (8), u8 reserved (0)
//! varuint nsigs;    sig*:    { varuint nrets (0..4); type*; u8 flags (bit0 = variadic); varuint nparams; param* }
//!                   param:   u8 kind, then Value: type | ByValStack: varuint size, varuint align, u8 exhausts
//!                            | IndirectResult: nothing
//! varuint nexterns; extern*: { str name; u8 kind (ExternKind, | 0x80 weak); varuint sig }   (sig is 0 for Data)
//! data:             { varuint size; varuint align; varuint readOnly; varuint ninit; u8[ninit];
//!                     varuint nrelocs; reloc*: { varuint offset; u8 kind; varuint index; varint addend } }
//!                   (readOnly: how many leading bytes the program never writes: the constants. The loader
//!                   protects the whole pages among them once the relocations are applied.)
//! tls:              { varuint size; varuint align; varuint ninit; u8[ninit]; varuint nrelocs; reloc* }
//!                   (applied to each thread's copy; kind Tls: the address of that copy + index)
//! varuint nfuncs;   decl*:   { str name; varuint sig; u8 flags (bit0 = exported, bit1 = calls setjmp,
//!                             bit2 = always_inline, bit3 = noinline, bit4 = declared `inline`) }
//!                   body*:   { varuint nlocals; type*; varuint nslots; { varuint size; varuint align }*;
//!                              varuint nblocks; { varuint ninsts; inst* }* }
//! varuint nexports; export*: { str name; varuint func; u8 ffiRet; varuint nargs; u8 ffiArg* }
//! varuint nlibraries; str*
//! varuint nconstructors; varuint func*     (`void f(void)`; the loader calls them in this order)
//! varuint ndestructors; varuint func*      (`void f(void)`; recorded, never called)
//! ```
//!
//! Instruction operands are documented in BIR.h; the writer's `inst` method is the
//! authoritative Rust rendering of that list, including the 128-bit vector operations
//! (`lane`, then `signed` where the operation has it, then the operands) and the atomics.

use std::fmt::Write as _;

/// What a module starts with.
pub const MAGIC: [u8; 4] = *b"BIR0";
/// Where the writable part of the data starts when there are constants before it: a multiple of
/// the largest page size of any target (Apple arm64's), so that no page holds both.
pub(crate) const DATA_PAGE: u64 = 16384;
/// What the loader accepts, which `validate` holds a module to and the front end says in its own
/// words, with a place, before one is ever written.
/// An argument passed by value on the stack:
pub(crate) const MAX_BY_VALUE_SIZE: u64 = 1 << 20;
pub(crate) const MAX_BY_VALUE_ALIGN: u64 = 16;
/// The alignment of a stack slot, of `StackAlloc` and of the data and thread-local segments:
pub(crate) const MAX_ALIGN: u64 = 4096;
pub(crate) const MAX_SLOT_SIZE: u64 = 1 << 28;
/// The size of the data segment and of the thread-local one:
pub(crate) const MAX_SEGMENT_SIZE: u64 = 1 << 30;
/// Or'ed into an extern's kind byte: `__attribute__((weak))`. Null when nothing defines it.
pub(crate) const WEAK_EXTERN: u8 = 0x80;
/// Function declaration flags that steer the backend's inliner.
pub(crate) const INLINE_ALWAYS: u8 = 4;
pub(crate) const INLINE_NEVER: u8 = 8;
pub(crate) const INLINE_HINT: u8 = 16;
pub(crate) const POINTER_BYTES: u8 = 8;
/// Or'ed into the MemKind byte of a Load or Store.
pub(crate) const VOLATILE_ACCESS: u8 = 0x80;

/// Machine type of a BIR value.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub(crate) enum Ty {
    Void = 0,
    I32 = 1,
    I64 = 2,
    F32 = 3,
    F64 = 4,
    V128 = 5,
}

impl Ty {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Ty::Void => "void",
            Ty::I32 => "i32",
            Ty::I64 => "i64",
            Ty::F32 => "f32",
            Ty::F64 => "f64",
            Ty::V128 => "v128",
        }
    }

    pub(crate) fn is_int(self) -> bool {
        matches!(self, Ty::I32 | Ty::I64)
    }

    pub(crate) fn is_float(self) -> bool {
        matches!(self, Ty::F32 | Ty::F64)
    }

    /// Whether values of this type travel in floating-point/vector registers.
    pub(crate) fn uses_float_registers(self) -> bool {
        matches!(self, Ty::F32 | Ty::F64 | Ty::V128)
    }
}

/// The lane shape of a 128-bit vector operation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum Lane {
    I8x16 = 0,
    I16x8 = 1,
    I32x4 = 2,
    I64x2 = 3,
    F32x4 = 4,
    F64x2 = 5,
}

impl Lane {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Lane::I8x16 => "i8x16",
            Lane::I16x8 => "i16x8",
            Lane::I32x4 => "i32x4",
            Lane::I64x2 => "i64x2",
            Lane::F32x4 => "f32x4",
            Lane::F64x2 => "f64x2",
        }
    }

    pub(crate) fn count(self) -> u8 {
        match self {
            Lane::I8x16 => 16,
            Lane::I16x8 => 8,
            Lane::I32x4 | Lane::F32x4 => 4,
            Lane::I64x2 | Lane::F64x2 => 2,
        }
    }

    pub(crate) fn is_float(self) -> bool {
        matches!(self, Lane::F32x4 | Lane::F64x2)
    }

    /// The type a single lane has as a scalar value.
    pub(crate) fn scalar_ty(self) -> Ty {
        match self {
            Lane::I8x16 | Lane::I16x8 | Lane::I32x4 => Ty::I32,
            Lane::I64x2 => Ty::I64,
            Lane::F32x4 => Ty::F32,
            Lane::F64x2 => Ty::F64,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum RelocKind {
    Data = 0,
    Func = 1,
    Extern = 2,
    /// In the tls segment only: the address of the same thread's copy + index.
    Tls = 3,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum MemKind {
    I8S = 0,
    I8U = 1,
    I16S = 2,
    I16U = 3,
    I32 = 4,
    I64 = 5,
    F32 = 6,
    F64 = 7,
    V128 = 8,
}

impl MemKind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            MemKind::I8S => "i8s",
            MemKind::I8U => "i8u",
            MemKind::I16S => "i16s",
            MemKind::I16U => "i16u",
            MemKind::I32 => "i32",
            MemKind::I64 => "i64",
            MemKind::F32 => "f32",
            MemKind::F64 => "f64",
            MemKind::V128 => "v128",
        }
    }

    /// The type of the value a load of this kind produces / a store consumes.
    pub(crate) fn value_ty(self) -> Ty {
        match self {
            MemKind::I8S | MemKind::I8U | MemKind::I16S | MemKind::I16U | MemKind::I32 => Ty::I32,
            MemKind::I64 => Ty::I64,
            MemKind::F32 => Ty::F32,
            MemKind::F64 => Ty::F64,
            MemKind::V128 => Ty::V128,
        }
    }
}

macro_rules! op_enum {
    ($name:ident { $($variant:ident = $value:expr),* $(,)? }) => {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub(crate) enum $name {
            $($variant = $value),*
        }

        impl $name {
            pub(crate) fn name(self) -> &'static str {
                match self {
                    $($name::$variant => stringify!($variant)),*
                }
            }
        }
    };
}

// Two value operands.
op_enum!(BinOp {
    Add = 0x10,
    Sub = 0x11,
    Mul = 0x12,
    Div = 0x13,
    UDiv = 0x14,
    Rem = 0x15,
    URem = 0x16,
    And = 0x17,
    Or = 0x18,
    Xor = 0x19,
    Shl = 0x1a,
    ShrS = 0x1b,
    ShrU = 0x1c,
    MulHigh = 0x2c,
    UMulHigh = 0x2d,
    // Rotations: the amount is an i32 taken modulo the width, as for the shifts.
    RotL = 0x2e,
    RotR = 0x2f,
    Eq = 0x20,
    Ne = 0x21,
    Lt = 0x22,
    Le = 0x23,
    Gt = 0x24,
    Ge = 0x25,
    ULt = 0x26,
    ULe = 0x27,
    UGt = 0x28,
    UGe = 0x29,
});

impl BinOp {
    pub(crate) fn is_shift(self) -> bool {
        matches!(
            self,
            BinOp::Shl | BinOp::ShrS | BinOp::ShrU | BinOp::RotL | BinOp::RotR
        )
    }

    pub(crate) fn is_compare(self) -> bool {
        (0x20..=0x29).contains(&(self as u8))
    }

    fn int_only(self) -> bool {
        matches!(
            self,
            BinOp::UDiv
                | BinOp::Rem
                | BinOp::URem
                | BinOp::And
                | BinOp::Or
                | BinOp::Xor
                | BinOp::Shl
                | BinOp::ShrS
                | BinOp::ShrU
                | BinOp::RotL
                | BinOp::RotR
                | BinOp::ULt
                | BinOp::ULe
                | BinOp::UGt
                | BinOp::UGe
                | BinOp::MulHigh
                | BinOp::UMulHigh
        )
    }
}

// One value operand, result type implied by the opcode.
op_enum!(UnOp {
    Neg = 0x1d,
    Clz = 0x1e,
    Ctz = 0x1f,
    Popcnt = 0x2a,
    Bswap = 0x2b,
    SExt8 = 0x30,
    SExt16 = 0x31,
    SExt32 = 0x32,
    ZExt32 = 0x33,
    Trunc = 0x34,
    FPromote = 0x39,
    FDemote = 0x3a,
});

// Explicit result type + one value operand.
op_enum!(ConvOp {
    SToF = 0x35,
    UToF = 0x36,
    FToS = 0x37,
    FToU = 0x38,
    Bitcast = 0x3b,
});

// Vector operations that take a lane shape.
op_enum!(VLaneOp {
    Splat = 0x70,
    Add = 0x73,
    Sub = 0x74,
    Mul = 0x75,
    Div = 0x76,
    Rem = 0x77,
    Min = 0x78,
    Max = 0x79,
    Neg = 0x7a,
    Abs = 0x7b,
    Sqrt = 0x7c,
    Shl = 0x81,
    ShrS = 0x82,
    ShrU = 0x83,
    Eq = 0x84,
    Ne = 0x85,
    Lt = 0x86,
    Le = 0x87,
    Gt = 0x88,
    Ge = 0x89,
    Bitmask = 0x8d,
    AddSat = 0x90,
    SubSat = 0x91,
    AvgU = 0x92,
    Narrow = 0x94,
});

impl VLaneOp {
    /// Whether the encoding carries a `signed` byte.
    fn has_signed(self) -> bool {
        matches!(
            self,
            VLaneOp::Div
                | VLaneOp::Rem
                | VLaneOp::Min
                | VLaneOp::Max
                | VLaneOp::Eq
                | VLaneOp::Ne
                | VLaneOp::Lt
                | VLaneOp::Le
                | VLaneOp::Gt
                | VLaneOp::Ge
                | VLaneOp::AddSat
                | VLaneOp::SubSat
                | VLaneOp::Narrow
        )
    }

    fn operands(self) -> usize {
        match self {
            VLaneOp::Splat | VLaneOp::Neg | VLaneOp::Abs | VLaneOp::Sqrt | VLaneOp::Bitmask => 1,
            _ => 2,
        }
    }
}

// Vector operations on all 128 bits.
op_enum!(VBitsOp {
    And = 0x7d,
    Or = 0x7e,
    Xor = 0x7f,
    Not = 0x80,
    Select = 0x8a,
    AnyTrue = 0x8e,
    Dot = 0x95,
    Swizzle = 0x96,
});

impl VBitsOp {
    fn operands(self) -> usize {
        match self {
            VBitsOp::Not | VBitsOp::AnyTrue => 1,
            VBitsOp::Select => 3,
            _ => 2,
        }
    }
}

/// `MemOrder` values.
pub(crate) mod order {
    pub(crate) const RELAXED: u8 = 0;
    pub(crate) const ACQUIRE: u8 = 1;
    pub(crate) const RELEASE: u8 = 2;
    pub(crate) const ACQ_REL: u8 = 3;
    pub(crate) const SEQ_CST: u8 = 4;
}

/// `AtomicOp` values.
pub(crate) mod atomic_op {
    pub(crate) const ADD: u8 = 0;
    pub(crate) const SUB: u8 = 1;
    pub(crate) const AND: u8 = 2;
    pub(crate) const OR: u8 = 3;
    pub(crate) const XOR: u8 = 4;
    pub(crate) const EXCHANGE: u8 = 5;
}

/// Number of `VConvertKind` values.
pub(crate) const VCONVERT_KINDS: u8 = 26;

mod opcode {
    pub(super) const CONST_V128: u8 = 0x05;
    pub(super) const V_EXTRACT: u8 = 0x71;
    pub(super) const V_REPLACE: u8 = 0x72;
    pub(super) const V_SHUFFLE: u8 = 0x8b;
    pub(super) const V_EXT_MUL: u8 = 0x93;
    pub(super) const TLS_ADDR: u8 = 0x5a;
    pub(super) const FRAME_ADDRESS: u8 = 0x5b;
    pub(super) const CPU_ID: u8 = 0x5c;
    pub(super) const INLINE_ASM: u8 = 0x5d;
    pub(super) const V_CONVERT: u8 = 0x8c;
    pub(super) const ATOMIC_LOAD: u8 = 0xa0;
    pub(super) const ATOMIC_STORE: u8 = 0xa1;
    pub(super) const ATOMIC_RMW: u8 = 0xa2;
    pub(super) const ATOMIC_CAS: u8 = 0xa3;
    pub(super) const FENCE: u8 = 0xa4;
    pub(super) const CONST_I32: u8 = 0x01;
    pub(super) const CONST_I64: u8 = 0x02;
    pub(super) const CONST_F32: u8 = 0x03;
    pub(super) const CONST_F64: u8 = 0x04;
    pub(super) const LOAD: u8 = 0x40;
    pub(super) const STORE: u8 = 0x41;
    pub(super) const SLOT_ADDR: u8 = 0x42;
    pub(super) const DATA_ADDR: u8 = 0x43;
    pub(super) const FUNC_ADDR: u8 = 0x44;
    pub(super) const EXTERN_ADDR: u8 = 0x45;
    pub(super) const LOCAL_GET: u8 = 0x46;
    pub(super) const LOCAL_SET: u8 = 0x47;
    pub(super) const CALL: u8 = 0x50;
    pub(super) const CALL_EXTERN: u8 = 0x51;
    pub(super) const CALL_INDIRECT: u8 = 0x52;
    pub(super) const SELECT: u8 = 0x53;
    pub(super) const MEM_COPY: u8 = 0x54;
    pub(super) const MEM_SET: u8 = 0x55;
    pub(super) const VA_START: u8 = 0x56;
    pub(super) const STACK_ALLOC: u8 = 0x57;
    pub(super) const STACK_SAVE: u8 = 0x58;
    pub(super) const STACK_RESTORE: u8 = 0x59;
    pub(super) const JUMP: u8 = 0x60;
    pub(super) const BR: u8 = 0x61;
    pub(super) const SWITCH: u8 = 0x62;
    pub(super) const RET: u8 = 0x63;
    pub(super) const RET_VOID: u8 = 0x64;
    pub(super) const UNREACHABLE: u8 = 0x65;
    pub(super) const TRAP: u8 = 0x66;
}

/// A value id.
pub(crate) type V = u32;

/// Machine code the frontend assembled from an `asm` statement, with every operand in
/// the register named here. Registers, x86-64: 0..15 = rax rcx rdx rbx rsp rbp rsi rdi
/// r8..r15 (not rsp, rbp), 16..31 = xmm0..15.
#[derive(Clone, PartialEq, Debug)]
pub(crate) struct InlineAsm {
    /// Bit 0: has effects beyond its results (`volatile`, a "memory" clobber, a memory
    /// operand it may write).
    pub(crate) flags: u8,
    pub(crate) code: Vec<u8>,
    pub(crate) inputs: Vec<(V, u8)>,
    /// One result each, numbered like a call's.
    pub(crate) outputs: Vec<(Ty, u8)>,
    pub(crate) clobbers: Vec<u8>,
}

#[derive(Clone, PartialEq, Debug)]
pub(crate) enum Inst {
    ConstI32(i32),
    ConstI64(i64),
    ConstF32(u32),
    ConstF64(u64),
    ConstV128([u8; 16]),
    /// `signed` is only encoded for the operations that have it.
    VLane(VLaneOp, Lane, bool, Vec<V>),
    VBits(VBitsOp, Vec<V>),
    VExtract(Lane, bool, u8, V),
    VReplace(Lane, u8, V, V),
    /// A `Load` / `Store` with the volatile bit: performed exactly as written.
    VolatileLoad(MemKind, V, i64),
    VolatileStore(MemKind, V, V, i64),
    VShuffle(V, V, [u8; 16]),
    /// Result lane shape, signed, high half, operands.
    VExtMul(Lane, bool, bool, V, V),
    TlsAddr(u64),
    /// `__builtin_frame_address(0)`: `[it]` is the caller's frame pointer and `[it + 8]` the
    /// return address.
    FrameAddress,
    /// x86-64 `cpuid` of (leaf, subleaf): four I32 results, eax ebx ecx edx.
    CpuId(V, V),
    InlineAsm(Box<InlineAsm>),
    VConvert(u8, V),
    AtomicLoad(MemKind, u8, V),
    AtomicStore(MemKind, u8, V, V),
    AtomicRmw(u8, MemKind, u8, V, V),
    AtomicCas(MemKind, u8, u8, V, V, V),
    Fence(u8),
    Bin(BinOp, V, V),
    Un(UnOp, V),
    Conv(ConvOp, Ty, V),
    Load(MemKind, V, i64),
    Store(MemKind, V, V, i64),
    SlotAddr(u32),
    DataAddr(u64),
    FuncAddr(u32),
    ExternAddr(u32),
    LocalGet(u32),
    LocalSet(u32, V),
    Call(u32, Vec<V>),
    CallExtern(u32, Vec<V>),
    CallIndirect(u32, V, Vec<V>),
    Select(V, V, V),
    MemCopy(V, V, V),
    MemSet(V, V, V),
    /// Initializes the target ABI's va_list object at the given address.
    VaStart(V),
    /// Bytes and alignment; the memory lives until the function returns or a StackRestore.
    StackAlloc(V, u64),
    StackSave,
    StackRestore(V),
    Jump(u32),
    Br(V, u32, u32),
    Switch(V, u32, Vec<(i64, u32)>),
    Ret(Vec<V>),
    RetVoid,
    Unreachable,
    Trap,
}

impl Inst {
    pub(crate) fn is_terminator(&self) -> bool {
        matches!(
            self,
            Inst::Jump(_)
                | Inst::Br(..)
                | Inst::Switch(..)
                | Inst::Ret(_)
                | Inst::RetVoid
                | Inst::Unreachable
                | Inst::Trap
        )
    }

    /// Calls `f` on every value operand.
    pub(crate) fn for_each_value_mut(&mut self, mut f: impl FnMut(&mut V)) {
        match self {
            Inst::ConstI32(_)
            | Inst::ConstI64(_)
            | Inst::ConstF32(_)
            | Inst::ConstF64(_)
            | Inst::ConstV128(_)
            | Inst::Fence(_)
            | Inst::SlotAddr(_)
            | Inst::DataAddr(_)
            | Inst::TlsAddr(_)
            | Inst::FrameAddress
            | Inst::FuncAddr(_)
            | Inst::ExternAddr(_)
            | Inst::LocalGet(_)
            | Inst::Jump(_)
            | Inst::RetVoid
            | Inst::StackSave
            | Inst::Unreachable
            | Inst::Trap => {}
            Inst::VLane(_, _, _, args) | Inst::VBits(_, args) => args.iter_mut().for_each(f),
            Inst::InlineAsm(asm) => asm.inputs.iter_mut().for_each(|(v, _)| f(v)),
            Inst::VExtract(_, _, _, a) | Inst::VConvert(_, a) | Inst::AtomicLoad(_, _, a) => f(a),
            Inst::VReplace(_, _, a, b)
            | Inst::VShuffle(a, b, _)
            | Inst::VExtMul(_, _, _, a, b)
            | Inst::AtomicStore(_, _, a, b)
            | Inst::CpuId(a, b)
            | Inst::AtomicRmw(_, _, _, a, b) => {
                f(a);
                f(b);
            }
            Inst::AtomicCas(_, _, _, a, b, c) => {
                f(a);
                f(b);
                f(c);
            }
            Inst::Bin(_, a, b) => {
                f(a);
                f(b);
            }
            Inst::Un(_, a)
            | Inst::Conv(_, _, a)
            | Inst::Load(_, a, _)
            | Inst::VolatileLoad(_, a, _)
            | Inst::LocalSet(_, a)
            | Inst::StackAlloc(a, _)
            | Inst::StackRestore(a)
            | Inst::VaStart(a) => f(a),
            Inst::Store(_, v, a, _) | Inst::VolatileStore(_, v, a, _) => {
                f(v);
                f(a);
            }
            Inst::Call(_, args) | Inst::CallExtern(_, args) => args.iter_mut().for_each(f),
            Inst::CallIndirect(_, p, args) => {
                f(p);
                args.iter_mut().for_each(f);
            }
            Inst::Select(a, b, c) | Inst::MemCopy(a, b, c) | Inst::MemSet(a, b, c) => {
                f(a);
                f(b);
                f(c);
            }
            Inst::Br(c, _, _) | Inst::Switch(c, _, _) => f(c),
            Inst::Ret(values) => values.iter_mut().for_each(f),
        }
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct Sig {
    /// 0 to 4 results, each in the next result register of its class.
    pub(crate) rets: Vec<Ty>,
    pub(crate) variadic: bool,
    pub(crate) params: Vec<Param>,
}

/// Which register class a stack-passed composite closes to later arguments (AArch64).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub(crate) enum Exhausts {
    Nothing = 0,
    IntegerRegisters = 1,
    FloatRegisters = 2,
}

/// One machine-level parameter, after the frontend applied the target's C ABI.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Param {
    /// A scalar in the next register of its class.
    Value(Ty),
    /// `size` bytes copied into the stack argument area; the value is their address.
    ByValStack {
        size: u64,
        align: u64,
        exhausts: Exhausts,
    },
    /// The address a memory-class result is written to (x8 on AArch64).
    IndirectResult,
}

impl Param {
    /// The type of the parameter's value inside the callee and of the operand at a call.
    pub(crate) fn value_ty(self) -> Ty {
        match self {
            Param::Value(t) => t,
            Param::ByValStack { .. } | Param::IndirectResult => Ty::I64,
        }
    }
}

/// Function: a function in another library. Data: an object in another library, of which
/// only the address is used.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum ExternKind {
    Function = 0,
    Data = 1,
}

#[derive(Clone, Debug)]
pub(crate) struct Extern {
    pub(crate) name: String,
    pub(crate) kind: ExternKind,
    /// `__attribute__((weak))`: the loader resolves it to null when nothing defines it.
    pub(crate) weak: bool,
    /// 0 and unused for `Data`.
    pub(crate) sig: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct Reloc {
    pub(crate) offset: u64,
    pub(crate) kind: RelocKind,
    pub(crate) index: u64,
    pub(crate) addend: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct Data {
    pub(crate) size: u64,
    pub(crate) align: u64,
    /// The constants come first; this is where they end.
    pub(crate) read_only: u64,
    pub(crate) init: Vec<u8>,
    pub(crate) relocs: Vec<Reloc>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Slot {
    pub(crate) size: u64,
    pub(crate) align: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct Func {
    pub(crate) name: String,
    pub(crate) sig: u32,
    pub(crate) exported: bool,
    /// Calls `setjmp` or another function that can return twice: never to be inlined.
    pub(crate) returns_twice: bool,
    /// `INLINE_ALWAYS`, `INLINE_NEVER`, `INLINE_HINT`: bits of the flags byte as they are.
    pub(crate) inlining: u8,
    pub(crate) locals: Vec<Ty>,
    pub(crate) slots: Vec<Slot>,
    pub(crate) blocks: Vec<Vec<Inst>>,
}

#[derive(Clone, Debug)]
pub(crate) struct Export {
    pub(crate) name: String,
    pub(crate) func: u32,
    pub(crate) ret: u8,
    pub(crate) args: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct Module {
    pub(crate) arch: u8,
    pub(crate) os: u8,
    pub(crate) sigs: Vec<Sig>,
    pub(crate) externs: Vec<Extern>,
    pub(crate) data: Data,
    pub(crate) tls: Tls,
    pub(crate) funcs: Vec<Func>,
    pub(crate) exports: Vec<Export>,
    /// Shared libraries to search for externs, in order.
    pub(crate) libraries: Vec<String>,
    /// `__attribute__((constructor))` functions, in the order the loader calls them once the
    /// module is ready to run.
    pub(crate) constructors: Vec<u32>,
    /// `__attribute__((destructor))` functions, in the order they would run. A module is
    /// never unloaded in an orderly way, so nothing calls them.
    pub(crate) destructors: Vec<u32>,
}

/// The image every thread's copy of the thread-local objects starts from.
#[derive(Clone, Debug, Default)]
pub(crate) struct Tls {
    pub(crate) size: u64,
    pub(crate) align: u64,
    pub(crate) init: Vec<u8>,
    /// Applied to each thread's copy when it is created.
    pub(crate) relocs: Vec<Reloc>,
}

// ───────────────────────────── writer ─────────────────────────────

struct Writer {
    out: Vec<u8>,
}

impl Writer {
    fn u8(&mut self, b: u8) {
        self.out.push(b);
    }

    fn varuint(&mut self, mut v: u64) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                self.out.push(byte);
                return;
            }
            self.out.push(byte | 0x80);
        }
    }

    fn varint(&mut self, mut v: i64) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            let done = (v == 0 && byte & 0x40 == 0) || (v == -1 && byte & 0x40 != 0);
            if done {
                self.out.push(byte);
                return;
            }
            self.out.push(byte | 0x80);
        }
    }

    fn str(&mut self, s: &str) {
        self.varuint(s.len() as u64);
        self.out.extend_from_slice(s.as_bytes());
    }

    fn relocs(&mut self, relocs: &[Reloc]) {
        self.varuint(relocs.len() as u64);
        for r in relocs {
            self.varuint(r.offset);
            self.u8(r.kind as u8);
            self.varuint(r.index);
            self.varint(r.addend);
        }
    }

    fn ty(&mut self, t: Ty) {
        self.u8(t as u8);
    }

    fn v(&mut self, v: V) {
        self.varuint(u64::from(v));
    }

    fn args(&mut self, args: &[V]) {
        self.varuint(args.len() as u64);
        for &a in args {
            self.v(a);
        }
    }

    fn inst(&mut self, inst: &Inst) {
        match inst {
            Inst::ConstI32(c) => {
                self.u8(opcode::CONST_I32);
                self.varint(i64::from(*c));
            }
            Inst::ConstI64(c) => {
                self.u8(opcode::CONST_I64);
                self.varint(*c);
            }
            Inst::ConstF32(bits) => {
                self.u8(opcode::CONST_F32);
                self.out.extend_from_slice(&bits.to_le_bytes());
            }
            Inst::ConstF64(bits) => {
                self.u8(opcode::CONST_F64);
                self.out.extend_from_slice(&bits.to_le_bytes());
            }
            Inst::ConstV128(bytes) => {
                self.u8(opcode::CONST_V128);
                self.out.extend_from_slice(bytes);
            }
            Inst::VLane(op, lane, signed, args) => {
                self.u8(*op as u8);
                self.u8(*lane as u8);
                if op.has_signed() {
                    self.u8(u8::from(*signed));
                }
                for &a in args {
                    self.v(a);
                }
            }
            Inst::VBits(op, args) => {
                self.u8(*op as u8);
                for &a in args {
                    self.v(a);
                }
            }
            Inst::VExtract(lane, signed, index, a) => {
                self.u8(opcode::V_EXTRACT);
                self.u8(*lane as u8);
                self.u8(u8::from(*signed));
                self.u8(*index);
                self.v(*a);
            }
            Inst::VReplace(lane, index, vec, scalar) => {
                self.u8(opcode::V_REPLACE);
                self.u8(*lane as u8);
                self.u8(*index);
                self.v(*vec);
                self.v(*scalar);
            }
            Inst::VShuffle(a, b, indices) => {
                self.u8(opcode::V_SHUFFLE);
                self.v(*a);
                self.v(*b);
                self.out.extend_from_slice(indices);
            }
            Inst::VExtMul(lane, signed, high, a, b) => {
                self.u8(opcode::V_EXT_MUL);
                self.u8(*lane as u8);
                self.u8(u8::from(*signed));
                self.u8(u8::from(*high));
                self.v(*a);
                self.v(*b);
            }
            Inst::FrameAddress => self.u8(opcode::FRAME_ADDRESS),
            Inst::CpuId(leaf, subleaf) => {
                self.u8(opcode::CPU_ID);
                self.v(*leaf);
                self.v(*subleaf);
            }
            Inst::InlineAsm(asm) => {
                self.u8(opcode::INLINE_ASM);
                self.u8(asm.flags);
                self.varuint(asm.code.len() as u64);
                self.out.extend_from_slice(&asm.code);
                self.varuint(asm.inputs.len() as u64);
                for &(v, register) in &asm.inputs {
                    self.v(v);
                    self.u8(register);
                }
                self.varuint(asm.outputs.len() as u64);
                for &(ty, register) in &asm.outputs {
                    self.ty(ty);
                    self.u8(register);
                }
                self.varuint(asm.clobbers.len() as u64);
                self.out.extend_from_slice(&asm.clobbers);
            }
            Inst::TlsAddr(offset) => {
                self.u8(opcode::TLS_ADDR);
                self.varuint(*offset);
            }
            Inst::VConvert(kind, a) => {
                self.u8(opcode::V_CONVERT);
                self.u8(*kind);
                self.v(*a);
            }
            Inst::AtomicLoad(kind, order, addr) => {
                self.u8(opcode::ATOMIC_LOAD);
                self.u8(*kind as u8);
                self.u8(*order);
                self.v(*addr);
            }
            Inst::AtomicStore(kind, order, value, addr) => {
                self.u8(opcode::ATOMIC_STORE);
                self.u8(*kind as u8);
                self.u8(*order);
                self.v(*value);
                self.v(*addr);
            }
            Inst::AtomicRmw(op, kind, order, value, addr) => {
                self.u8(opcode::ATOMIC_RMW);
                self.u8(*op);
                self.u8(*kind as u8);
                self.u8(*order);
                self.v(*value);
                self.v(*addr);
            }
            Inst::AtomicCas(kind, success, failure, expected, desired, addr) => {
                self.u8(opcode::ATOMIC_CAS);
                self.u8(*kind as u8);
                self.u8(*success);
                self.u8(*failure);
                self.v(*expected);
                self.v(*desired);
                self.v(*addr);
            }
            Inst::Fence(order) => {
                self.u8(opcode::FENCE);
                self.u8(*order);
            }
            Inst::Bin(op, a, b) => {
                self.u8(*op as u8);
                self.v(*a);
                self.v(*b);
            }
            Inst::Un(op, a) => {
                self.u8(*op as u8);
                self.v(*a);
            }
            Inst::Conv(op, ty, a) => {
                self.u8(*op as u8);
                self.ty(*ty);
                self.v(*a);
            }
            Inst::Load(kind, addr, off) | Inst::VolatileLoad(kind, addr, off) => {
                let volatile = matches!(inst, Inst::VolatileLoad(..));
                self.u8(opcode::LOAD);
                self.u8(*kind as u8 | if volatile { VOLATILE_ACCESS } else { 0 });
                self.v(*addr);
                self.varint(*off);
            }
            Inst::Store(kind, value, addr, off) | Inst::VolatileStore(kind, value, addr, off) => {
                let volatile = matches!(inst, Inst::VolatileStore(..));
                self.u8(opcode::STORE);
                self.u8(*kind as u8 | if volatile { VOLATILE_ACCESS } else { 0 });
                self.v(*value);
                self.v(*addr);
                self.varint(*off);
            }
            Inst::SlotAddr(s) => {
                self.u8(opcode::SLOT_ADDR);
                self.varuint(u64::from(*s));
            }
            Inst::DataAddr(o) => {
                self.u8(opcode::DATA_ADDR);
                self.varuint(*o);
            }
            Inst::FuncAddr(f) => {
                self.u8(opcode::FUNC_ADDR);
                self.varuint(u64::from(*f));
            }
            Inst::ExternAddr(e) => {
                self.u8(opcode::EXTERN_ADDR);
                self.varuint(u64::from(*e));
            }
            Inst::LocalGet(l) => {
                self.u8(opcode::LOCAL_GET);
                self.varuint(u64::from(*l));
            }
            Inst::LocalSet(l, v) => {
                self.u8(opcode::LOCAL_SET);
                self.varuint(u64::from(*l));
                self.v(*v);
            }
            Inst::Call(f, args) => {
                self.u8(opcode::CALL);
                self.varuint(u64::from(*f));
                self.args(args);
            }
            Inst::CallExtern(e, args) => {
                self.u8(opcode::CALL_EXTERN);
                self.varuint(u64::from(*e));
                self.args(args);
            }
            Inst::CallIndirect(sig, p, args) => {
                self.u8(opcode::CALL_INDIRECT);
                self.varuint(u64::from(*sig));
                self.v(*p);
                self.args(args);
            }
            Inst::Select(c, a, b) => {
                self.u8(opcode::SELECT);
                self.v(*c);
                self.v(*a);
                self.v(*b);
            }
            Inst::MemCopy(d, s, n) => {
                self.u8(opcode::MEM_COPY);
                self.v(*d);
                self.v(*s);
                self.v(*n);
            }
            Inst::MemSet(d, b, n) => {
                self.u8(opcode::MEM_SET);
                self.v(*d);
                self.v(*b);
                self.v(*n);
            }
            Inst::Jump(b) => {
                self.u8(opcode::JUMP);
                self.varuint(u64::from(*b));
            }
            Inst::Br(c, t, e) => {
                self.u8(opcode::BR);
                self.v(*c);
                self.varuint(u64::from(*t));
                self.varuint(u64::from(*e));
            }
            Inst::Switch(v, default, cases) => {
                self.u8(opcode::SWITCH);
                self.v(*v);
                self.varuint(u64::from(*default));
                self.varuint(cases.len() as u64);
                for (case, block) in cases {
                    self.varint(*case);
                    self.varuint(u64::from(*block));
                }
            }
            Inst::Ret(values) => {
                self.u8(opcode::RET);
                for &v in values {
                    self.v(v);
                }
            }
            Inst::RetVoid => self.u8(opcode::RET_VOID),
            Inst::Unreachable => self.u8(opcode::UNREACHABLE),
            Inst::Trap => self.u8(opcode::TRAP),
            Inst::VaStart(a) => {
                self.u8(opcode::VA_START);
                self.v(*a);
            }
            Inst::StackAlloc(bytes, align) => {
                self.u8(opcode::STACK_ALLOC);
                self.v(*bytes);
                self.varuint(*align);
            }
            Inst::StackSave => self.u8(opcode::STACK_SAVE),
            Inst::StackRestore(a) => {
                self.u8(opcode::STACK_RESTORE);
                self.v(*a);
            }
        }
    }
}

impl Module {
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut w = Writer { out: Vec::new() };
        w.out.extend_from_slice(&MAGIC);
        w.u8(self.arch);
        w.u8(self.os);
        w.u8(POINTER_BYTES);
        w.u8(0);

        w.varuint(self.sigs.len() as u64);
        for sig in &self.sigs {
            w.varuint(sig.rets.len() as u64);
            for &t in &sig.rets {
                w.ty(t);
            }
            w.u8(u8::from(sig.variadic));
            w.varuint(sig.params.len() as u64);
            for &p in &sig.params {
                match p {
                    Param::Value(t) => {
                        w.u8(0);
                        w.ty(t);
                    }
                    Param::ByValStack {
                        size,
                        align,
                        exhausts,
                    } => {
                        w.u8(1);
                        w.varuint(size);
                        w.varuint(align);
                        w.u8(exhausts as u8);
                    }
                    Param::IndirectResult => w.u8(2),
                }
            }
        }

        w.varuint(self.externs.len() as u64);
        for e in &self.externs {
            w.str(&e.name);
            w.u8(e.kind as u8 | if e.weak { WEAK_EXTERN } else { 0 });
            w.varuint(u64::from(e.sig));
        }

        w.varuint(self.data.size);
        w.varuint(self.data.align);
        w.varuint(self.data.read_only);
        w.varuint(self.data.init.len() as u64);
        w.out.extend_from_slice(&self.data.init);
        w.relocs(&self.data.relocs);

        w.varuint(self.tls.size);
        w.varuint(self.tls.align.max(1));
        w.varuint(self.tls.init.len() as u64);
        w.out.extend_from_slice(&self.tls.init);
        w.relocs(&self.tls.relocs);

        w.varuint(self.funcs.len() as u64);
        for f in &self.funcs {
            w.str(&f.name);
            w.varuint(u64::from(f.sig));
            w.u8(u8::from(f.exported) | (u8::from(f.returns_twice) << 1) | f.inlining);
        }
        for f in &self.funcs {
            w.varuint(f.locals.len() as u64);
            for &l in &f.locals {
                w.ty(l);
            }
            w.varuint(f.slots.len() as u64);
            for s in &f.slots {
                w.varuint(s.size);
                w.varuint(s.align);
            }
            w.varuint(f.blocks.len() as u64);
            for block in &f.blocks {
                w.varuint(block.len() as u64);
                for inst in block {
                    w.inst(inst);
                }
            }
        }

        w.varuint(self.exports.len() as u64);
        for e in &self.exports {
            w.str(&e.name);
            w.varuint(u64::from(e.func));
            w.u8(e.ret);
            w.varuint(e.args.len() as u64);
            w.out.extend_from_slice(&e.args);
        }
        w.varuint(self.libraries.len() as u64);
        for library in &self.libraries {
            w.str(library);
        }
        for table in [&self.constructors, &self.destructors] {
            w.varuint(table.len() as u64);
            for &func in table {
                w.varuint(u64::from(func));
            }
        }
        w.out
    }
}

// ───────────────────────────── validation ─────────────────────────────

/// Value numbering and typing of one function, computed by [`analyze`].
pub(crate) struct FuncInfo {
    /// Type of each value id (parameters first).
    pub(crate) value_types: Vec<Ty>,
    /// For each block, for each instruction, the values it defines.
    pub(crate) defs: Vec<Vec<Def>>,
}

/// The consecutive value ids an instruction defines (`count` is 0 for none).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Def {
    pub(crate) first: V,
    pub(crate) count: u32,
}

/// Numbers the values of `func` and checks every rule of the BIR spec for it.
pub(crate) fn analyze(module: &Module, func_index: usize) -> Result<FuncInfo, String> {
    let func = &module.funcs[func_index];
    let fail = |block: usize, inst: usize, msg: String| -> String {
        format!(
            "function '{}' block {} inst {}: {}",
            func.name, block, inst, msg
        )
    };
    let Some(sig) = module.sigs.get(func.sig as usize) else {
        return Err(format!("function '{}': sig index out of range", func.name));
    };
    for (i, &l) in func.locals.iter().enumerate() {
        if l == Ty::Void {
            return Err(format!(
                "function '{}': local {} has type void",
                func.name, i
            ));
        }
    }
    for (i, s) in func.slots.iter().enumerate() {
        if s.align == 0 || !s.align.is_power_of_two() || s.align > MAX_ALIGN {
            return Err(format!(
                "function '{}': slot {} alignment is not a power of two up to {MAX_ALIGN}",
                func.name, i
            ));
        }
        if s.size > MAX_SLOT_SIZE {
            return Err(format!("function '{}': slot {} is too large", func.name, i));
        }
    }
    if func.blocks.is_empty() {
        return Err(format!("function '{}': no blocks", func.name));
    }

    let nparams = sig.params.len();
    let mut value_types: Vec<Ty> = sig.params.iter().map(|p| p.value_ty()).collect();
    for &p in &sig.params {
        match p {
            Param::Value(Ty::Void) => {
                return Err(format!("function '{}': void parameter", func.name));
            }
            Param::ByValStack { size, align, .. }
                if !matches!(align, 8 | MAX_BY_VALUE_ALIGN)
                    || size == 0
                    || size > MAX_BY_VALUE_SIZE
                    || size % 8 != 0 =>
            {
                return Err(format!(
                    "function '{}': ByValStack of {size} bytes aligned to {align}",
                    func.name
                ));
            }
            _ => {}
        }
    }
    if sig.rets.len() > 4 || sig.rets.contains(&Ty::Void) {
        return Err(format!("function '{}': invalid results", func.name));
    }
    let mut defs: Vec<Vec<Def>> = Vec::with_capacity(func.blocks.len());
    let nblocks = func.blocks.len() as u32;

    for (bi, block) in func.blocks.iter().enumerate() {
        let block_first_value = value_types.len();
        let mut block_defs = Vec::with_capacity(block.len());
        if block.is_empty() {
            return Err(format!(
                "function '{}' block {}: empty block (no terminator)",
                func.name, bi
            ));
        }
        for (ii, inst) in block.iter().enumerate() {
            let is_last = ii + 1 == block.len();
            if inst.is_terminator() != is_last {
                return Err(fail(
                    bi,
                    ii,
                    if is_last {
                        "block does not end in a terminator".to_string()
                    } else {
                        "terminator in the middle of a block".to_string()
                    },
                ));
            }
            // Operand lookup: parameters anywhere, other values only from this block.
            let use_value = |v: V| -> Result<Ty, String> {
                let idx = v as usize;
                if idx < nparams || (idx >= block_first_value && idx < value_types.len()) {
                    return Ok(value_types[idx]);
                }
                if idx < value_types.len() {
                    return Err(fail(
                        bi,
                        ii,
                        format!("v{v} is used outside the block that defines it"),
                    ));
                }
                Err(fail(bi, ii, format!("v{v} is used before it is defined")))
            };
            let expect = |v: V, want: Ty| -> Result<(), String> {
                let got = use_value(v)?;
                if got != want {
                    return Err(fail(
                        bi,
                        ii,
                        format!("v{v} has type {}, expected {}", got.name(), want.name()),
                    ));
                }
                Ok(())
            };
            let check_block = |b: u32| -> Result<(), String> {
                if b >= nblocks {
                    return Err(fail(bi, ii, format!("block {b} out of range")));
                }
                Ok(())
            };
            let check_call =
                |callee: &Sig, args: &[V], allow_variadic: bool| -> Result<Vec<Ty>, String> {
                    let variadic = callee.variadic && allow_variadic;
                    if args.len() < callee.params.len()
                        || (args.len() > callee.params.len() && !variadic)
                    {
                        return Err(fail(
                            bi,
                            ii,
                            format!(
                                "call passes {} arguments, signature has {}",
                                args.len(),
                                callee.params.len()
                            ),
                        ));
                    }
                    for (i, &a) in args.iter().enumerate() {
                        match callee.params.get(i) {
                            Some(&p) => expect(a, p.value_ty())?,
                            None => {
                                use_value(a)?;
                            }
                        }
                    }
                    Ok(callee.rets.clone())
                };

            let mut call_results: Option<Vec<Ty>> = None;
            let result: Option<Ty> = match inst {
                Inst::ConstI32(_) => Some(Ty::I32),
                Inst::ConstI64(_) => Some(Ty::I64),
                Inst::ConstF32(_) => Some(Ty::F32),
                Inst::ConstF64(_) => Some(Ty::F64),
                Inst::ConstV128(_) => Some(Ty::V128),
                Inst::VLane(op, lane, _, args) => {
                    if args.len() != op.operands() {
                        return Err(fail(
                            bi,
                            ii,
                            format!("V{} has the wrong number of operands", op.name()),
                        ));
                    }
                    let integer_only = matches!(
                        op,
                        VLaneOp::Rem
                            | VLaneOp::Shl
                            | VLaneOp::ShrS
                            | VLaneOp::ShrU
                            | VLaneOp::Bitmask
                            | VLaneOp::AddSat
                            | VLaneOp::SubSat
                            | VLaneOp::AvgU
                            | VLaneOp::Narrow
                    );
                    let narrow_lanes = match op {
                        VLaneOp::AddSat | VLaneOp::SubSat | VLaneOp::AvgU => {
                            matches!(lane, Lane::I8x16 | Lane::I16x8)
                        }
                        VLaneOp::Narrow => matches!(lane, Lane::I16x8 | Lane::I32x4),
                        _ => true,
                    };
                    if !narrow_lanes {
                        return Err(fail(
                            bi,
                            ii,
                            format!("V{} is not defined for {}", op.name(), lane.name()),
                        ));
                    }
                    if (integer_only && lane.is_float())
                        || (*op == VLaneOp::Sqrt && !lane.is_float())
                    {
                        return Err(fail(
                            bi,
                            ii,
                            format!("V{} is not defined for {}", op.name(), lane.name()),
                        ));
                    }
                    match op {
                        VLaneOp::Splat => {
                            expect(args[0], lane.scalar_ty())?;
                            Some(Ty::V128)
                        }
                        VLaneOp::Shl | VLaneOp::ShrS | VLaneOp::ShrU => {
                            expect(args[0], Ty::V128)?;
                            expect(args[1], Ty::I32)?;
                            Some(Ty::V128)
                        }
                        VLaneOp::Bitmask => {
                            expect(args[0], Ty::V128)?;
                            Some(Ty::I32)
                        }
                        _ => {
                            for &a in args {
                                expect(a, Ty::V128)?;
                            }
                            Some(Ty::V128)
                        }
                    }
                }
                Inst::VBits(op, args) => {
                    if args.len() != op.operands() {
                        return Err(fail(
                            bi,
                            ii,
                            format!("V{} has the wrong number of operands", op.name()),
                        ));
                    }
                    for &a in args {
                        expect(a, Ty::V128)?;
                    }
                    Some(if *op == VBitsOp::AnyTrue {
                        Ty::I32
                    } else {
                        Ty::V128
                    })
                }
                Inst::VExtract(lane, _, index, a) => {
                    if *index >= lane.count() {
                        return Err(fail(
                            bi,
                            ii,
                            format!("lane index {index} is out of range for {}", lane.name()),
                        ));
                    }
                    expect(*a, Ty::V128)?;
                    Some(lane.scalar_ty())
                }
                Inst::VReplace(lane, index, vec, scalar) => {
                    if *index >= lane.count() {
                        return Err(fail(
                            bi,
                            ii,
                            format!("lane index {index} is out of range for {}", lane.name()),
                        ));
                    }
                    expect(*vec, Ty::V128)?;
                    expect(*scalar, lane.scalar_ty())?;
                    Some(Ty::V128)
                }
                Inst::VShuffle(a, b, indices) => {
                    if indices.iter().any(|&i| i >= 32) {
                        return Err(fail(bi, ii, "VShuffle byte index out of range".to_string()));
                    }
                    expect(*a, Ty::V128)?;
                    expect(*b, Ty::V128)?;
                    Some(Ty::V128)
                }
                Inst::VExtMul(lane, _, _, a, b) => {
                    if !matches!(lane, Lane::I16x8 | Lane::I32x4 | Lane::I64x2) {
                        return Err(fail(
                            bi,
                            ii,
                            format!("VExtMul is not defined for {}", lane.name()),
                        ));
                    }
                    expect(*a, Ty::V128)?;
                    expect(*b, Ty::V128)?;
                    Some(Ty::V128)
                }
                Inst::FrameAddress => Some(Ty::I64),
                Inst::CpuId(leaf, subleaf) => {
                    // Arch 0 is x86-64.
                    if module.arch != 0 {
                        return Err(fail(bi, ii, "CpuId outside x86-64".to_string()));
                    }
                    expect(*leaf, Ty::I32)?;
                    expect(*subleaf, Ty::I32)?;
                    call_results = Some(vec![Ty::I32; 4]);
                    None
                }
                Inst::InlineAsm(asm) => {
                    if module.arch != 0 {
                        return Err(fail(bi, ii, "InlineAsm outside x86-64".to_string()));
                    }
                    if asm.flags > 1
                        || asm.code.len() > 4096
                        || asm.inputs.len() > 16
                        || asm.outputs.len() > 16
                    {
                        return Err(fail(bi, ii, "InlineAsm out of bounds".to_string()));
                    }
                    let usable = |r: u8| r < 32 && r != 4 && r != 5;
                    for &(v, register) in &asm.inputs {
                        let ty = use_value(v)?;
                        let vector = register >= 16;
                        let fits = match ty {
                            Ty::I32 | Ty::I64 => !vector,
                            Ty::F32 | Ty::F64 | Ty::V128 => vector,
                            Ty::Void => false,
                        };
                        if !usable(register) || !fits {
                            return Err(fail(
                                bi,
                                ii,
                                "InlineAsm input in a wrong register".to_string(),
                            ));
                        }
                    }
                    for &(ty, register) in &asm.outputs {
                        let vector = register >= 16;
                        let fits = match ty {
                            Ty::I32 | Ty::I64 => !vector,
                            Ty::F32 | Ty::F64 | Ty::V128 => vector,
                            Ty::Void => false,
                        };
                        if !usable(register) || !fits {
                            return Err(fail(
                                bi,
                                ii,
                                "InlineAsm output in a wrong register".to_string(),
                            ));
                        }
                    }
                    if asm.clobbers.iter().any(|&r| !usable(r)) {
                        return Err(fail(
                            bi,
                            ii,
                            "InlineAsm clobbers a wrong register".to_string(),
                        ));
                    }
                    call_results = Some(asm.outputs.iter().map(|(ty, _)| *ty).collect());
                    None
                }
                Inst::TlsAddr(o) => {
                    if *o > module.tls.size {
                        return Err(fail(bi, ii, format!("tls offset {o} out of range")));
                    }
                    Some(Ty::I64)
                }
                Inst::VConvert(kind, a) => {
                    if *kind >= VCONVERT_KINDS {
                        return Err(fail(bi, ii, format!("unknown VConvert kind {kind}")));
                    }
                    expect(*a, Ty::V128)?;
                    Some(Ty::V128)
                }
                Inst::AtomicLoad(kind, order, addr) => {
                    if matches!(kind, MemKind::F32 | MemKind::F64 | MemKind::V128)
                        || *order > order::SEQ_CST
                    {
                        return Err(fail(bi, ii, "invalid AtomicLoad".to_string()));
                    }
                    expect(*addr, Ty::I64)?;
                    Some(kind.value_ty())
                }
                Inst::AtomicStore(kind, order, value, addr)
                | Inst::AtomicRmw(_, kind, order, value, addr) => {
                    let integer = matches!(
                        kind,
                        MemKind::I8U | MemKind::I16U | MemKind::I32 | MemKind::I64
                    );
                    if !integer || *order > order::SEQ_CST {
                        return Err(fail(
                            bi,
                            ii,
                            "invalid atomic memory kind or order".to_string(),
                        ));
                    }
                    if let Inst::AtomicRmw(op, ..) = inst {
                        if *op > atomic_op::EXCHANGE {
                            return Err(fail(bi, ii, format!("unknown atomic operation {op}")));
                        }
                    }
                    expect(*value, kind.value_ty())?;
                    expect(*addr, Ty::I64)?;
                    if matches!(inst, Inst::AtomicRmw(..)) {
                        Some(kind.value_ty())
                    } else {
                        None
                    }
                }
                Inst::AtomicCas(kind, success, failure, expected, desired, addr) => {
                    let integer = matches!(
                        kind,
                        MemKind::I8U | MemKind::I16U | MemKind::I32 | MemKind::I64
                    );
                    if !integer || *success > order::SEQ_CST || *failure > order::SEQ_CST {
                        return Err(fail(
                            bi,
                            ii,
                            "invalid atomic memory kind or order".to_string(),
                        ));
                    }
                    expect(*expected, kind.value_ty())?;
                    expect(*desired, kind.value_ty())?;
                    expect(*addr, Ty::I64)?;
                    Some(kind.value_ty())
                }
                Inst::Fence(order) => {
                    if *order > order::SEQ_CST {
                        return Err(fail(bi, ii, "invalid fence order".to_string()));
                    }
                    None
                }
                Inst::Bin(op, a, b) => {
                    let ta = use_value(*a)?;
                    if op.int_only() && !ta.is_int() {
                        return Err(fail(
                            bi,
                            ii,
                            format!("{} needs integer operands", op.name()),
                        ));
                    }
                    if op.is_shift() {
                        expect(*b, Ty::I32)?;
                        Some(ta)
                    } else {
                        expect(*b, ta)?;
                        Some(if op.is_compare() { Ty::I32 } else { ta })
                    }
                }
                Inst::Un(op, a) => match op {
                    UnOp::Neg => Some(use_value(*a)?),
                    UnOp::Clz | UnOp::Ctz | UnOp::Popcnt | UnOp::Bswap => {
                        let ta = use_value(*a)?;
                        if !ta.is_int() {
                            return Err(fail(
                                bi,
                                ii,
                                format!("{} needs an integer operand", op.name()),
                            ));
                        }
                        Some(ta)
                    }
                    UnOp::SExt8 | UnOp::SExt16 => {
                        expect(*a, Ty::I32)?;
                        Some(Ty::I32)
                    }
                    UnOp::SExt32 | UnOp::ZExt32 => {
                        expect(*a, Ty::I32)?;
                        Some(Ty::I64)
                    }
                    UnOp::Trunc => {
                        expect(*a, Ty::I64)?;
                        Some(Ty::I32)
                    }
                    UnOp::FPromote => {
                        expect(*a, Ty::F32)?;
                        Some(Ty::F64)
                    }
                    UnOp::FDemote => {
                        expect(*a, Ty::F64)?;
                        Some(Ty::F32)
                    }
                },
                Inst::Conv(op, ty, a) => {
                    let ta = use_value(*a)?;
                    let ok = match op {
                        ConvOp::SToF | ConvOp::UToF => ty.is_float() && ta.is_int(),
                        ConvOp::FToS | ConvOp::FToU => ty.is_int() && ta.is_float(),
                        ConvOp::Bitcast => matches!(
                            (ta, *ty),
                            (Ty::I32, Ty::F32)
                                | (Ty::F32, Ty::I32)
                                | (Ty::I64, Ty::F64)
                                | (Ty::F64, Ty::I64)
                        ),
                    };
                    if !ok {
                        return Err(fail(
                            bi,
                            ii,
                            format!("{} {} <- {} is invalid", op.name(), ty.name(), ta.name()),
                        ));
                    }
                    Some(*ty)
                }
                Inst::Load(kind, addr, offset) | Inst::VolatileLoad(kind, addr, offset) => {
                    if i32::try_from(*offset).is_err() {
                        return Err(fail(bi, ii, "Load offset does not fit 32 bits".to_string()));
                    }
                    expect(*addr, Ty::I64)?;
                    Some(kind.value_ty())
                }
                Inst::Store(kind, value, addr, offset)
                | Inst::VolatileStore(kind, value, addr, offset) => {
                    if i32::try_from(*offset).is_err() {
                        return Err(fail(
                            bi,
                            ii,
                            "Store offset does not fit 32 bits".to_string(),
                        ));
                    }
                    if matches!(kind, MemKind::I8S | MemKind::I16S) {
                        return Err(fail(bi, ii, "Store with a signed memory kind".to_string()));
                    }
                    expect(*value, kind.value_ty())?;
                    expect(*addr, Ty::I64)?;
                    None
                }
                Inst::SlotAddr(s) => {
                    if *s as usize >= func.slots.len() {
                        return Err(fail(bi, ii, format!("slot {s} out of range")));
                    }
                    Some(Ty::I64)
                }
                Inst::DataAddr(o) => {
                    if *o > module.data.size {
                        return Err(fail(bi, ii, format!("data offset {o} out of range")));
                    }
                    Some(Ty::I64)
                }
                Inst::FuncAddr(f) => {
                    if *f as usize >= module.funcs.len() {
                        return Err(fail(bi, ii, format!("function {f} out of range")));
                    }
                    Some(Ty::I64)
                }
                Inst::ExternAddr(e) => {
                    if *e as usize >= module.externs.len() {
                        return Err(fail(bi, ii, format!("extern {e} out of range")));
                    }
                    Some(Ty::I64)
                }
                Inst::LocalGet(l) => match func.locals.get(*l as usize) {
                    Some(&t) => Some(t),
                    None => return Err(fail(bi, ii, format!("local {l} out of range"))),
                },
                Inst::LocalSet(l, v) => match func.locals.get(*l as usize) {
                    Some(&t) => {
                        expect(*v, t)?;
                        None
                    }
                    None => return Err(fail(bi, ii, format!("local {l} out of range"))),
                },
                Inst::Call(f, args) => {
                    let callee = module
                        .funcs
                        .get(*f as usize)
                        .and_then(|f| module.sigs.get(f.sig as usize))
                        .ok_or_else(|| fail(bi, ii, format!("function {f} out of range")))?;
                    call_results = Some(check_call(callee, args, true)?);
                    None
                }
                Inst::CallExtern(e, args) => {
                    let callee = module
                        .externs
                        .get(*e as usize)
                        .filter(|e| e.kind == ExternKind::Function)
                        .and_then(|e| module.sigs.get(e.sig as usize))
                        .ok_or_else(|| {
                            fail(
                                bi,
                                ii,
                                format!("extern {e} is out of range or not a function"),
                            )
                        })?;
                    call_results = Some(check_call(callee, args, true)?);
                    None
                }
                Inst::CallIndirect(s, p, args) => {
                    let callee = module
                        .sigs
                        .get(*s as usize)
                        .ok_or_else(|| fail(bi, ii, format!("sig {s} out of range")))?;
                    expect(*p, Ty::I64)?;
                    call_results = Some(check_call(callee, args, true)?);
                    None
                }
                Inst::Select(c, a, b) => {
                    expect(*c, Ty::I32)?;
                    let ta = use_value(*a)?;
                    expect(*b, ta)?;
                    Some(ta)
                }
                Inst::MemCopy(d, s, n) => {
                    expect(*d, Ty::I64)?;
                    expect(*s, Ty::I64)?;
                    expect(*n, Ty::I64)?;
                    None
                }
                Inst::MemSet(d, b, n) => {
                    expect(*d, Ty::I64)?;
                    expect(*b, Ty::I32)?;
                    expect(*n, Ty::I64)?;
                    None
                }
                Inst::Jump(b) => {
                    check_block(*b)?;
                    None
                }
                Inst::Br(c, t, e) => {
                    expect(*c, Ty::I32)?;
                    check_block(*t)?;
                    check_block(*e)?;
                    None
                }
                Inst::Switch(v, default, cases) => {
                    let tv = use_value(*v)?;
                    if !tv.is_int() {
                        return Err(fail(bi, ii, "Switch on a non-integer value".to_string()));
                    }
                    check_block(*default)?;
                    let mut seen = std::collections::BTreeSet::new();
                    for (case, b) in cases {
                        check_block(*b)?;
                        if tv == Ty::I32 && i32::try_from(*case).is_err() {
                            return Err(fail(
                                bi,
                                ii,
                                format!("case {case} does not fit the i32 scrutinee"),
                            ));
                        }
                        if !seen.insert(*case) {
                            return Err(fail(bi, ii, format!("duplicate case {case}")));
                        }
                    }
                    None
                }
                Inst::Ret(values) => {
                    if values.is_empty() || values.len() != sig.rets.len() {
                        return Err(fail(
                            bi,
                            ii,
                            format!(
                                "Ret with {} values, the signature has {} results",
                                values.len(),
                                sig.rets.len()
                            ),
                        ));
                    }
                    for (&v, &t) in values.iter().zip(&sig.rets) {
                        expect(v, t)?;
                    }
                    None
                }
                Inst::RetVoid => {
                    if !sig.rets.is_empty() {
                        return Err(fail(bi, ii, "RetVoid in a non-void function".to_string()));
                    }
                    None
                }
                Inst::Unreachable | Inst::Trap => None,
                Inst::VaStart(a) => {
                    if !sig.variadic {
                        return Err(fail(
                            bi,
                            ii,
                            "VaStart in a function that is not variadic".to_string(),
                        ));
                    }
                    expect(*a, Ty::I64)?;
                    None
                }
                Inst::StackAlloc(bytes, align) => {
                    if !align.is_power_of_two() || *align > MAX_ALIGN {
                        return Err(fail(
                            bi,
                            ii,
                            format!("StackAlloc alignment is not a power of two up to {MAX_ALIGN}"),
                        ));
                    }
                    expect(*bytes, Ty::I64)?;
                    Some(Ty::I64)
                }
                Inst::StackSave => Some(Ty::I64),
                Inst::StackRestore(a) => {
                    expect(*a, Ty::I64)?;
                    None
                }
            };
            let types = call_results.unwrap_or_else(|| result.into_iter().collect());
            block_defs.push(Def {
                first: value_types.len() as V,
                count: types.len() as u32,
            });
            value_types.extend(types);
        }
        defs.push(block_defs);
    }
    Ok(FuncInfo { value_types, defs })
}

/// Checks the module-level tables, then every function.
pub(crate) fn validate(module: &Module) -> Result<(), String> {
    for (i, e) in module.externs.iter().enumerate() {
        match e.kind {
            ExternKind::Function if e.sig as usize >= module.sigs.len() => {
                return Err(format!("extern {i} '{}': sig out of range", e.name));
            }
            ExternKind::Data if e.sig != 0 => {
                return Err(format!("extern {i} '{}': data extern with a sig", e.name));
            }
            _ => {}
        }
    }
    let data = &module.data;
    if data.align == 0 || !data.align.is_power_of_two() || data.align > MAX_ALIGN {
        return Err(format!(
            "data alignment is not a power of two up to {MAX_ALIGN}"
        ));
    }
    if data.size > MAX_SEGMENT_SIZE {
        return Err("data is too large".to_string());
    }
    if data.init.len() as u64 > data.size {
        return Err("data ninit exceeds size".to_string());
    }
    if data.read_only > data.size {
        return Err("data readOnly exceeds size".to_string());
    }
    let tls = &module.tls;
    for (segment, size, relocs) in [
        ("data", data.size, &data.relocs),
        ("tls", tls.size, &tls.relocs),
    ] {
        for r in relocs {
            if r.offset.checked_add(8).is_none_or(|end| end > size) {
                return Err(format!(
                    "reloc at {} is outside the {segment} segment",
                    r.offset
                ));
            }
            let limit = match r.kind {
                RelocKind::Data => data.size + 1,
                RelocKind::Func => module.funcs.len() as u64,
                RelocKind::Extern => module.externs.len() as u64,
                RelocKind::Tls if segment == "tls" => tls.size + 1,
                RelocKind::Tls => {
                    return Err(format!(
                        "reloc at {}: a Tls reloc outside the tls segment",
                        r.offset
                    ));
                }
            };
            if r.index >= limit {
                return Err(format!(
                    "{segment} reloc at {}: index {} out of range",
                    r.offset, r.index
                ));
            }
        }
    }
    if tls.size > 0 && (tls.align == 0 || !tls.align.is_power_of_two() || tls.align > MAX_ALIGN) {
        return Err(format!(
            "tls alignment is not a power of two up to {MAX_ALIGN}"
        ));
    }
    if tls.size > MAX_SEGMENT_SIZE {
        return Err("tls is too large".to_string());
    }
    if tls.init.len() as u64 > tls.size {
        return Err("tls ninit exceeds size".to_string());
    }
    for i in 0..module.funcs.len() {
        analyze(module, i)?;
    }
    for e in &module.exports {
        let Some(f) = module.funcs.get(e.func as usize) else {
            return Err(format!("export '{}': function out of range", e.name));
        };
        if !f.exported {
            return Err(format!(
                "export '{}': function is not flagged exported",
                e.name
            ));
        }
        let sig = &module.sigs[f.sig as usize];
        if sig.params.len() != e.args.len() {
            return Err(format!(
                "export '{}': argument count does not match the signature",
                e.name
            ));
        }
        if e.ret > 13 || e.args.iter().any(|&a| a > 12) {
            return Err(format!("export '{}': invalid FFI type", e.name));
        }
    }
    for (what, table) in [
        ("constructor", &module.constructors),
        ("destructor", &module.destructors),
    ] {
        for &func in table {
            let Some(f) = module.funcs.get(func as usize) else {
                return Err(format!("{what}: function {func} out of range"));
            };
            let sig = &module.sigs[f.sig as usize];
            if !sig.rets.is_empty() || !sig.params.is_empty() || sig.variadic {
                return Err(format!(
                    "{what} '{}' is not a void f(void) function",
                    f.name
                ));
            }
        }
    }
    Ok(())
}

// ───────────────────────────── disassembler ─────────────────────────────

fn sig_string(sig: &Sig) -> String {
    let mut s = String::from("(");
    for (i, p) in sig.params.iter().enumerate() {
        if i > 0 {
            s.push_str(", ");
        }
        match p {
            Param::Value(t) => s.push_str(t.name()),
            Param::ByValStack {
                size,
                align,
                exhausts,
            } => {
                let _ = write!(s, "byval({size}, align {align}");
                match exhausts {
                    Exhausts::Nothing => {}
                    Exhausts::IntegerRegisters => s.push_str(", exhausts int"),
                    Exhausts::FloatRegisters => s.push_str(", exhausts float"),
                }
                s.push(')');
            }
            Param::IndirectResult => s.push_str("sret"),
        }
    }
    if sig.variadic {
        if !sig.params.is_empty() {
            s.push_str(", ");
        }
        s.push_str("...");
    }
    s.push_str(") -> ");
    match sig.rets.as_slice() {
        [] => s.push_str("void"),
        [t] => s.push_str(t.name()),
        many => {
            s.push('(');
            for (i, t) in many.iter().enumerate() {
                if i > 0 {
                    s.push_str(", ");
                }
                s.push_str(t.name());
            }
            s.push(')');
        }
    }
    s
}

fn ffi_type_name(t: u8) -> &'static str {
    match t {
        0 => "char",
        1 => "int8",
        2 => "uint8",
        3 => "int16",
        4 => "uint16",
        5 => "int32",
        6 => "uint32",
        7 => "int64",
        8 => "uint64",
        9 => "double",
        10 => "float",
        11 => "bool",
        12 => "pointer",
        13 => "void",
        _ => "?",
    }
}

fn args_string(args: &[V]) -> String {
    let mut s = String::new();
    for (i, a) in args.iter().enumerate() {
        if i > 0 {
            s.push_str(", ");
        }
        let _ = write!(s, "v{a}");
    }
    s
}

pub(crate) fn disassemble(module: &Module) -> Result<String, String> {
    let mut out = String::new();
    let arch = if module.arch == 0 { "x86_64" } else { "arm64" };
    let os = match module.os {
        0 => "linux",
        1 => "darwin",
        2 => "windows",
        _ => "freebsd",
    };
    let _ = writeln!(out, "bir module {arch}-{os}");
    for (i, s) in module.sigs.iter().enumerate() {
        let _ = writeln!(out, "sig {i}: {}", sig_string(s));
    }
    for (i, e) in module.externs.iter().enumerate() {
        let _ = match e.kind {
            ExternKind::Function => writeln!(
                out,
                "extern {i}: {} sig {}{}",
                e.name,
                e.sig,
                if e.weak { " weak" } else { "" }
            ),
            ExternKind::Data => writeln!(
                out,
                "extern {i}: {} data{}",
                e.name,
                if e.weak { " weak" } else { "" }
            ),
        };
    }
    let d = &module.data;
    let _ = writeln!(
        out,
        "data: size {} align {} read-only {} init {} bytes",
        d.size,
        d.align,
        d.read_only,
        d.init.len()
    );
    for chunk_start in (0..d.init.len()).step_by(16) {
        let chunk = &d.init[chunk_start..(chunk_start + 16).min(d.init.len())];
        let _ = write!(out, "  {chunk_start:06x}:");
        for b in chunk {
            let _ = write!(out, " {b:02x}");
        }
        out.push_str("  |");
        for &b in chunk {
            out.push(if (0x20..0x7f).contains(&b) {
                b as char
            } else {
                '.'
            });
        }
        out.push_str("|\n");
    }
    if module.tls.size > 0 {
        let _ = writeln!(
            out,
            "tls: size {} align {} init {} bytes",
            module.tls.size,
            module.tls.align,
            module.tls.init.len()
        );
    }
    for (prefix, relocs) in [("", &d.relocs), ("tls ", &module.tls.relocs)] {
        for r in relocs {
            let target = match r.kind {
                RelocKind::Data => format!("data+{}", r.index),
                RelocKind::Func => format!("func {}", r.index),
                RelocKind::Extern => format!("extern {}", r.index),
                RelocKind::Tls => format!("tls+{}", r.index),
            };
            let _ = writeln!(
                out,
                "  {prefix}reloc @{}: {} addend {}",
                r.offset, target, r.addend
            );
        }
    }
    for (fi, f) in module.funcs.iter().enumerate() {
        let info = analyze(module, fi)?;
        let sig = &module.sigs[f.sig as usize];
        let _ = writeln!(
            out,
            "\nfunc {fi} {}{}: sig {} {}{}",
            f.name,
            if f.exported { " (exported)" } else { "" },
            f.sig,
            sig_string(sig),
            [
                (INLINE_ALWAYS, " always_inline"),
                (INLINE_NEVER, " noinline"),
                (INLINE_HINT, " inline"),
            ]
            .iter()
            .filter(|(bit, _)| f.inlining & bit != 0)
            .map(|(_, text)| *text)
            .collect::<String>()
        );
        for (i, l) in f.locals.iter().enumerate() {
            let _ = writeln!(out, "  local {i}: {}", l.name());
        }
        for (i, s) in f.slots.iter().enumerate() {
            let _ = writeln!(out, "  slot {i}: size {} align {}", s.size, s.align);
        }
        for (bi, block) in f.blocks.iter().enumerate() {
            let _ = writeln!(out, "  block {bi}:");
            for (ii, inst) in block.iter().enumerate() {
                out.push_str("    ");
                let def = info.defs[bi][ii];
                for k in 0..def.count {
                    let v = def.first + k;
                    let _ = write!(
                        out,
                        "{}v{v}:{}",
                        if k > 0 { ", " } else { "" },
                        info.value_types[v as usize].name()
                    );
                }
                if def.count > 0 {
                    out.push_str(" = ");
                }
                let _ = match inst {
                    Inst::ConstI32(c) => writeln!(out, "ConstI32 {c}"),
                    Inst::ConstI64(c) => writeln!(out, "ConstI64 {c}"),
                    Inst::ConstF32(bits) => writeln!(out, "ConstF32 {:?}", f32::from_bits(*bits)),
                    Inst::ConstF64(bits) => writeln!(out, "ConstF64 {:?}", f64::from_bits(*bits)),
                    Inst::ConstV128(bytes) => {
                        let _ = write!(out, "ConstV128");
                        for b in bytes {
                            let _ = write!(out, " {b:02x}");
                        }
                        writeln!(out)
                    }
                    Inst::VLane(op, lane, signed, args) => writeln!(
                        out,
                        "V{} {}{} {}",
                        op.name(),
                        lane.name(),
                        if op.has_signed() {
                            if *signed { " signed" } else { " unsigned" }
                        } else {
                            ""
                        },
                        args_string(args)
                    ),
                    Inst::VBits(op, args) => writeln!(out, "V{} {}", op.name(), args_string(args)),
                    Inst::VExtract(lane, signed, index, a) => writeln!(
                        out,
                        "VExtract {} {} [{index}] v{a}",
                        lane.name(),
                        if *signed { "signed" } else { "unsigned" }
                    ),
                    Inst::VReplace(lane, index, vec, scalar) => {
                        writeln!(out, "VReplace {} [{index}] v{vec}, v{scalar}", lane.name())
                    }
                    Inst::VShuffle(a, b, indices) => {
                        let _ = write!(out, "VShuffle v{a}, v{b} [");
                        for (i, b) in indices.iter().enumerate() {
                            let _ = write!(out, "{}{b}", if i > 0 { " " } else { "" });
                        }
                        writeln!(out, "]")
                    }
                    Inst::VConvert(kind, a) => writeln!(out, "VConvert kind {kind} v{a}"),
                    Inst::VExtMul(lane, signed, high, a, b) => writeln!(
                        out,
                        "VExtMul {} {} {} v{a}, v{b}",
                        lane.name(),
                        if *signed { "signed" } else { "unsigned" },
                        if *high { "high" } else { "low" }
                    ),
                    Inst::TlsAddr(o) => writeln!(out, "TlsAddr {o}"),
                    Inst::FrameAddress => writeln!(out, "FrameAddress"),
                    Inst::CpuId(leaf, subleaf) => writeln!(out, "CpuId v{leaf}, v{subleaf}"),
                    Inst::InlineAsm(asm) => {
                        let code: Vec<String> =
                            asm.code.iter().map(|b| format!("{b:02x}")).collect();
                        let inputs: Vec<String> = asm
                            .inputs
                            .iter()
                            .map(|(v, r)| format!("v{v} in r{r}"))
                            .collect();
                        let outputs: Vec<String> = asm
                            .outputs
                            .iter()
                            .map(|(ty, r)| format!("{} from r{r}", ty.name()))
                            .collect();
                        writeln!(
                            out,
                            "InlineAsm{} [{}] ({}) -> ({}) clobbers {:?}",
                            if asm.flags & 1 != 0 { " effects" } else { "" },
                            code.join(" "),
                            inputs.join(", "),
                            outputs.join(", "),
                            asm.clobbers
                        )
                    }
                    Inst::AtomicLoad(kind, order, addr) => {
                        writeln!(out, "AtomicLoad {} order {order} [v{addr}]", kind.name())
                    }
                    Inst::AtomicStore(kind, order, value, addr) => {
                        writeln!(
                            out,
                            "AtomicStore {} order {order} v{value} -> [v{addr}]",
                            kind.name()
                        )
                    }
                    Inst::AtomicRmw(op, kind, order, value, addr) => {
                        let name = ["Add", "Sub", "And", "Or", "Xor", "Exchange"]
                            .get(*op as usize)
                            .copied()
                            .unwrap_or("?");
                        writeln!(
                            out,
                            "AtomicRmw {name} {} order {order} v{value}, [v{addr}]",
                            kind.name()
                        )
                    }
                    Inst::AtomicCas(kind, success, failure, expected, desired, addr) => writeln!(
                        out,
                        "AtomicCas {} order {success}/{failure} v{expected}, v{desired}, [v{addr}]",
                        kind.name()
                    ),
                    Inst::Fence(order) => writeln!(out, "Fence order {order}"),
                    Inst::Bin(op, a, b) => writeln!(out, "{} v{a}, v{b}", op.name()),
                    Inst::Un(op, a) => writeln!(out, "{} v{a}", op.name()),
                    Inst::Conv(op, ty, a) => writeln!(out, "{} {} v{a}", op.name(), ty.name()),
                    Inst::Load(k, a, off) => writeln!(out, "Load {} [v{a} + {off}]", k.name()),
                    Inst::VolatileLoad(k, a, off) => {
                        writeln!(out, "Load volatile {} [v{a} + {off}]", k.name())
                    }
                    Inst::VolatileStore(k, v, a, off) => {
                        writeln!(out, "Store volatile {} v{v} -> [v{a} + {off}]", k.name())
                    }
                    Inst::Store(k, v, a, off) => {
                        writeln!(out, "Store {} v{v} -> [v{a} + {off}]", k.name())
                    }
                    Inst::SlotAddr(s) => writeln!(out, "SlotAddr {s}"),
                    Inst::DataAddr(o) => writeln!(out, "DataAddr {o}"),
                    Inst::FuncAddr(f) => writeln!(out, "FuncAddr {f}"),
                    Inst::ExternAddr(e) => writeln!(out, "ExternAddr {e}"),
                    Inst::LocalGet(l) => writeln!(out, "LocalGet {l}"),
                    Inst::LocalSet(l, v) => writeln!(out, "LocalSet {l}, v{v}"),
                    Inst::Call(c, args) => {
                        let name = module
                            .funcs
                            .get(*c as usize)
                            .map_or("?", |f| f.name.as_str());
                        writeln!(out, "Call {c} <{name}> ({})", args_string(args))
                    }
                    Inst::CallExtern(c, args) => {
                        let name = module
                            .externs
                            .get(*c as usize)
                            .map_or("?", |e| e.name.as_str());
                        writeln!(out, "CallExtern {c} <{name}> ({})", args_string(args))
                    }
                    Inst::CallIndirect(s, p, args) => {
                        writeln!(out, "CallIndirect sig {s} v{p} ({})", args_string(args))
                    }
                    Inst::Select(c, a, b) => writeln!(out, "Select v{c}, v{a}, v{b}"),
                    Inst::MemCopy(d, s, n) => writeln!(out, "MemCopy v{d}, v{s}, v{n}"),
                    Inst::MemSet(d, b, n) => writeln!(out, "MemSet v{d}, v{b}, v{n}"),
                    Inst::Jump(b) => writeln!(out, "Jump block {b}"),
                    Inst::Br(c, t, e) => writeln!(out, "Br v{c}, block {t}, block {e}"),
                    Inst::Switch(v, default, cases) => {
                        let _ = write!(out, "Switch v{v}, default block {default}");
                        for (case, b) in cases {
                            let _ = write!(out, ", {case} => block {b}");
                        }
                        writeln!(out)
                    }
                    Inst::Ret(values) => writeln!(out, "Ret {}", args_string(values)),
                    Inst::RetVoid => writeln!(out, "RetVoid"),
                    Inst::Unreachable => writeln!(out, "Unreachable"),
                    Inst::Trap => writeln!(out, "Trap"),
                    Inst::VaStart(a) => writeln!(out, "VaStart v{a}"),
                    Inst::StackAlloc(bytes, align) => {
                        writeln!(out, "StackAlloc v{bytes} align {align}")
                    }
                    Inst::StackSave => writeln!(out, "StackSave"),
                    Inst::StackRestore(a) => writeln!(out, "StackRestore v{a}"),
                };
            }
        }
    }
    if !module.exports.is_empty() {
        out.push('\n');
    }
    for e in &module.exports {
        let _ = write!(out, "export {} = func {}: (", e.name, e.func);
        for (i, &a) in e.args.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(ffi_type_name(a));
        }
        let _ = writeln!(out, ") -> {}", ffi_type_name(e.ret));
    }
    for library in &module.libraries {
        let _ = writeln!(out, "library {library}");
    }
    for (what, table) in [
        ("constructor", &module.constructors),
        ("destructor", &module.destructors),
    ] {
        for &func in table {
            let name = module
                .funcs
                .get(func as usize)
                .map_or("?", |f| f.name.as_str());
            let _ = writeln!(out, "{what} func {func} {name}");
        }
    }
    Ok(out)
}

// ───────────────────────────── function builder ─────────────────────────────

/// Builds one function body. Value ids handed out while building are provisional
/// (emission order); [`FuncBuilder::finish`] renumbers them into block order as the
/// format requires.
pub(crate) struct FuncBuilder {
    nparams: u32,
    locals: Vec<Ty>,
    slots: Vec<Slot>,
    /// Each instruction with the first provisional id it defines and how many.
    blocks: Vec<Vec<(Inst, V, u32)>>,
    cur: usize,
    value_types: Vec<Ty>,
}

impl FuncBuilder {
    pub(crate) fn new(params: &[Ty]) -> FuncBuilder {
        FuncBuilder {
            nparams: params.len() as u32,
            locals: Vec::new(),
            slots: Vec::new(),
            blocks: vec![Vec::new()],
            cur: 0,
            value_types: params.to_vec(),
        }
    }

    pub(crate) fn add_local(&mut self, ty: Ty) -> u32 {
        self.locals.push(ty);
        (self.locals.len() - 1) as u32
    }

    pub(crate) fn add_slot(&mut self, size: u64, align: u64) -> u32 {
        self.slots.push(Slot { size, align });
        (self.slots.len() - 1) as u32
    }

    pub(crate) fn new_block(&mut self) -> u32 {
        self.blocks.push(Vec::new());
        (self.blocks.len() - 1) as u32
    }

    pub(crate) fn switch_to(&mut self, block: u32) {
        self.cur = block as usize;
    }

    pub(crate) fn is_terminated(&self) -> bool {
        self.blocks[self.cur]
            .last()
            .is_some_and(|(i, _, _)| i.is_terminator())
    }

    pub(crate) fn value_ty(&self, v: V) -> Ty {
        self.value_types[v as usize]
    }

    /// Appends `inst`. Code emitted after a terminator lands in a fresh, unreachable block.
    fn push(&mut self, inst: Inst, results: &[Ty]) -> V {
        if self.is_terminated() {
            let dead = self.new_block();
            self.switch_to(dead);
        }
        let first = self.value_types.len() as V;
        self.value_types.extend_from_slice(results);
        self.blocks[self.cur].push((inst, first, results.len() as u32));
        first
    }

    /// Emits an instruction that defines a value of type `ty`.
    pub(crate) fn def(&mut self, inst: Inst, ty: Ty) -> V {
        self.push(inst, &[ty])
    }

    /// Emits a call that defines one value per entry of `results`; returns the first.
    pub(crate) fn def_many(&mut self, inst: Inst, results: &[Ty]) -> V {
        self.push(inst, results)
    }

    /// Emits an instruction that defines nothing.
    pub(crate) fn effect(&mut self, inst: Inst) {
        self.push(inst, &[]);
    }

    pub(crate) fn const_i32(&mut self, c: i32) -> V {
        self.def(Inst::ConstI32(c), Ty::I32)
    }

    pub(crate) fn const_i64(&mut self, c: i64) -> V {
        self.def(Inst::ConstI64(c), Ty::I64)
    }

    /// An integer constant of machine type `ty` (I32 constants keep the low 32 bits).
    pub(crate) fn const_int(&mut self, ty: Ty, c: i64) -> V {
        if ty == Ty::I32 {
            self.const_i32(c as i32)
        } else {
            self.const_i64(c)
        }
    }

    pub(crate) fn bin(&mut self, op: BinOp, a: V, b: V) -> V {
        let ty = if op.is_compare() {
            Ty::I32
        } else {
            self.value_ty(a)
        };
        self.def(Inst::Bin(op, a, b), ty)
    }

    pub(crate) fn un(&mut self, op: UnOp, a: V) -> V {
        let ty = match op {
            UnOp::Neg | UnOp::Clz | UnOp::Ctz | UnOp::Popcnt | UnOp::Bswap => self.value_ty(a),
            UnOp::SExt8 | UnOp::SExt16 | UnOp::Trunc => Ty::I32,
            UnOp::SExt32 | UnOp::ZExt32 => Ty::I64,
            UnOp::FPromote => Ty::F64,
            UnOp::FDemote => Ty::F32,
        };
        self.def(Inst::Un(op, a), ty)
    }

    /// A lane-shaped vector operation; the result type follows from the operation.
    pub(crate) fn vlane(&mut self, op: VLaneOp, lane: Lane, signed: bool, args: Vec<V>) -> V {
        let ty = if op == VLaneOp::Bitmask {
            Ty::I32
        } else {
            Ty::V128
        };
        self.def(Inst::VLane(op, lane, signed, args), ty)
    }

    pub(crate) fn vbits(&mut self, op: VBitsOp, args: Vec<V>) -> V {
        let ty = if op == VBitsOp::AnyTrue {
            Ty::I32
        } else {
            Ty::V128
        };
        self.def(Inst::VBits(op, args), ty)
    }

    pub(crate) fn conv(&mut self, op: ConvOp, ty: Ty, a: V) -> V {
        self.def(Inst::Conv(op, ty, a), ty)
    }

    pub(crate) fn load(&mut self, kind: MemKind, addr: V, offset: i64) -> V {
        self.def(Inst::Load(kind, addr, offset), kind.value_ty())
    }

    pub(crate) fn local_get(&mut self, local: u32) -> V {
        let ty = self.locals[local as usize];
        self.def(Inst::LocalGet(local), ty)
    }

    /// Ends the current block with `term` unless it already ended.
    pub(crate) fn terminate(&mut self, term: Inst) {
        if !self.is_terminated() {
            self.push(term, &[]);
        }
    }

    pub(crate) fn finish(mut self, name: String, sig: u32, exported: bool) -> Func {
        // Blocks that were created but never filled or never terminated (unreachable
        // joins, code after a return) still need exactly one terminator.
        for block in &mut self.blocks {
            if !block.last().is_some_and(|(i, _, _)| i.is_terminator()) {
                block.push((Inst::Unreachable, 0, 0));
            }
        }
        // Blocks nothing jumps to (the rest of a block after `return`, the arms of an `if`
        // on a constant) are dropped: they would only make the function look bigger.
        let mut reachable = vec![false; self.blocks.len()];
        let mut pending = vec![0usize];
        while let Some(index) = pending.pop() {
            if index >= self.blocks.len() || std::mem::replace(&mut reachable[index], true) {
                continue;
            }
            match self.blocks[index].last() {
                Some((Inst::Jump(to), _, _)) => pending.push(*to as usize),
                Some((Inst::Br(_, then, other), _, _)) => {
                    pending.push(*then as usize);
                    pending.push(*other as usize);
                }
                Some((Inst::Switch(_, default, cases), _, _)) => {
                    pending.push(*default as usize);
                    pending.extend(cases.iter().map(|(_, to)| *to as usize));
                }
                _ => {}
            }
        }
        let mut new_index = vec![0u32; self.blocks.len()];
        let mut kept = 0u32;
        for (index, keep) in reachable.iter().enumerate() {
            new_index[index] = kept;
            kept += u32::from(*keep);
        }
        let mut index = 0;
        self.blocks.retain(|_| {
            index += 1;
            reachable[index - 1]
        });
        for block in &mut self.blocks {
            match block.last_mut() {
                Some((Inst::Jump(to), _, _)) => *to = new_index[*to as usize],
                Some((Inst::Br(_, then, other), _, _)) => {
                    *then = new_index[*then as usize];
                    *other = new_index[*other as usize];
                }
                Some((Inst::Switch(_, default, cases), _, _)) => {
                    *default = new_index[*default as usize];
                    for (_, to) in cases {
                        *to = new_index[*to as usize];
                    }
                }
                _ => {}
            }
        }
        // Values nobody uses, whose computation cannot be observed, are not computed:
        // the low half of a product of which only the high half is wanted, the index of
        // an access that was folded.
        let mut uses = vec![0u32; self.value_types.len()];
        for block in &mut self.blocks {
            for (inst, _, _) in block.iter_mut() {
                inst.for_each_value_mut(|v| uses[*v as usize] += 1);
            }
        }
        for block in &mut self.blocks {
            let mut at = block.len();
            while at > 0 {
                at -= 1;
                let (inst, first, count) = &mut block[at];
                let unobservable = match inst {
                    Inst::ConstI32(_)
                    | Inst::ConstI64(_)
                    | Inst::ConstF32(_)
                    | Inst::ConstF64(_)
                    | Inst::ConstV128(_)
                    | Inst::Un(..)
                    | Inst::Conv(..)
                    | Inst::Select(..)
                    | Inst::LocalGet(_)
                    | Inst::SlotAddr(_)
                    | Inst::DataAddr(_)
                    | Inst::FuncAddr(_)
                    | Inst::ExternAddr(_) => true,
                    // Division traps on zero.
                    Inst::Bin(op, ..) => {
                        !matches!(op, BinOp::Div | BinOp::UDiv | BinOp::Rem | BinOp::URem)
                    }
                    _ => false,
                };
                if unobservable && *count == 1 && uses[*first as usize] == 0 {
                    inst.for_each_value_mut(|v| uses[*v as usize] -= 1);
                    block.remove(at);
                }
            }
        }
        let mut remap: Vec<V> = vec![0; self.value_types.len()];
        for (i, slot) in remap.iter_mut().enumerate().take(self.nparams as usize) {
            *slot = i as V;
        }
        let mut next = self.nparams;
        for block in &self.blocks {
            for (_, first, count) in block {
                for k in 0..*count {
                    remap[(*first + k) as usize] = next;
                    next += 1;
                }
            }
        }
        let blocks = self
            .blocks
            .into_iter()
            .map(|block| {
                block
                    .into_iter()
                    .map(|(mut inst, _, _)| {
                        inst.for_each_value_mut(|v| *v = remap[*v as usize]);
                        inst
                    })
                    .collect()
            })
            .collect();
        Func {
            name,
            sig,
            exported,
            returns_twice: false,
            inlining: 0,
            locals: self.locals,
            slots: self.slots,
            blocks,
        }
    }
}
