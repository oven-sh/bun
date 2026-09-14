//! The typed AST the parser hands to the code generator.
//!
//! Every expression node carries its C type, and every implicit conversion has already
//! been made explicit as a `Cast`/`Decay` node by `sema`, so later stages never have to
//! re-derive C's conversion rules.

use std::rc::Rc;

use crate::token::Loc;
use crate::types::{BitField, FuncType, Type, TypeCtx};

pub(crate) type LocalId = u32;
pub(crate) type GlobalId = u32;
pub(crate) type FuncId = u32;
pub(crate) type LabelId = u32;
pub(crate) type StrId = u32;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    And,
    Or,
    Xor,
    Shl,
    Shr,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl BinOp {
    pub(crate) fn is_compare(self) -> bool {
        matches!(
            self,
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge
        )
    }
}

#[derive(Clone, Debug)]
pub(crate) enum CompoundOp {
    /// `lhs = (T)((op_ty)lhs op rhs)`.
    Arith(BinOp),
    /// `ptr += index * scale` (or `-=`).
    PtrAdd { scale: u64, sub: bool },
}

#[derive(Debug)]
pub(crate) struct Expr {
    pub(crate) kind: ExprKind,
    pub(crate) ty: Type,
    pub(crate) loc: Loc,
    /// Evaluating this expression creates new basic blocks (`&&`, `||`, `?:`).
    pub(crate) has_control_flow: bool,
    /// How deep a walk of the expression recurses: one for every operand on the way down that is
    /// not its parent's `spine_child`, which every walk goes on to by a loop. Bounded
    /// (`MAX_EXPR_NESTING`), so that the walks that cannot fail have room.
    pub(crate) nesting: u16,
    /// Height of the expression tree, which a sum of ten thousand terms has ten thousand of: for
    /// the analyses that would rather give up on a tall expression than walk it.
    pub(crate) depth: u32,
}

#[derive(Clone, Debug)]
pub(crate) enum ExprKind {
    /// An integer (or pointer) constant, already wrapped to `ty`.
    IntLit(i64),
    FloatLit(f64),
    /// A `long double` constant of the x87 format. Its value is an object in constant data.
    LongDoubleLit(crate::extended::Extended),
    Local(LocalId),
    /// A file-scope variable, static local or string literal.
    Global(GlobalId),
    Func(FuncId),
    /// A string literal: an lvalue of type `char[n]`.
    StrLit(StrId),
    Neg(Box<Expr>),
    BitNot(Box<Expr>),
    LogNot(Box<Expr>),
    /// Both operands already have the operation's type (shifts: rhs is `int`).
    Binary(BinOp, Box<Expr>, Box<Expr>),
    /// `ptr ± index * scale`; `index` has type `long long`.
    PtrAdd {
        ptr: Box<Expr>,
        index: Box<Expr>,
        scale: u64,
        sub: bool,
    },
    /// `(a - b) / scale`.
    PtrDiff {
        a: Box<Expr>,
        b: Box<Expr>,
        scale: u64,
    },
    LogAnd(Box<Expr>, Box<Expr>),
    LogOr(Box<Expr>, Box<Expr>),
    Cond(Box<Expr>, Box<Expr>, Box<Expr>),
    /// `rhs` already has the type of `lhs`.
    Assign(Box<Expr>, Box<Expr>),
    CompoundAssign {
        lhs: Box<Expr>,
        rhs: Box<Expr>,
        op: CompoundOp,
        op_ty: Type,
    },
    /// `scale` is 1 for arithmetic types and the element size for pointers.
    IncDec {
        lhs: Box<Expr>,
        inc: bool,
        post: bool,
        scale: u64,
        /// For a pointer to a variable length array: the step in bytes, instead of `scale`.
        dynamic_scale: Option<Box<Expr>>,
    },
    Comma(Box<Expr>, Box<Expr>),
    /// Conversion of a scalar to `ty` (or of anything to void).
    Cast(Box<Expr>),
    AddrOf(Box<Expr>),
    Deref(Box<Expr>),
    /// A member at a byte offset inside a struct/union expression.
    Member(Box<Expr>, u64),
    /// A bit-field member: `field` locates it relative to the byte at `offset`.
    BitField {
        base: Box<Expr>,
        offset: u64,
        field: BitField,
    },
    /// Array-to-pointer or function-to-pointer conversion.
    Decay(Box<Expr>),
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
    },
    /// GNU `({ ...; value; })`. `result` is the final expression statement, if any.
    StmtExpr {
        stmts: Vec<Stmt>,
        result: Option<Box<Expr>>,
    },
    /// A block-scope compound literal: an unnamed local that is initialized each time the
    /// expression is evaluated. An lvalue.
    CompoundLiteral {
        local: LocalId,
        zero_first: bool,
        items: Vec<InitItem>,
    },
    /// A compiler builtin that becomes an instruction sequence.
    Intrinsic(Intrinsic, Vec<Expr>),
    /// `va_start(ap, ...)`; the operand is the address of the va_list object.
    VaStart(Box<Expr>),
    /// `va_arg(ap, type)`; the operand is the address of the va_list object and the node's
    /// type is the requested type.
    VaArg(Box<Expr>),
    /// `va_copy(dst, src)`; both operands are addresses of va_list objects.
    VaCopy(Box<Expr>, Box<Expr>),
    /// A complex value from its real and imaginary parts, both of the part type.
    ComplexMake(Box<Expr>, Box<Expr>),
    /// `__real__ z` (false) or `__imag__ z` (true); an lvalue when `z` is.
    ComplexPart(Box<Expr>, bool),
    /// `alloca(size)`: `size` is a `size_t`; the second field is the alignment in bytes.
    Alloca(Box<Expr>, u64),
    /// A scalar of the vector's element type copied into every lane.
    VecSplat(Box<Expr>),
    /// An argument for a `transparent_union` parameter: a union object whose first bytes
    /// are the operand, which has the type of one of the union's members.
    TransparentUnion(Box<Expr>),
    /// A vector built from one expression per lane, each of the element type.
    VecInit(Vec<Expr>),
    /// `v[i]`: one lane of a vector; an lvalue when the vector is. The index is an `int`.
    VecElem(Box<Expr>, Box<Expr>),
    /// A vector builtin; the node's type is the result type.
    VecBuiltin(VecBuiltin, Vec<Expr>),
    /// An atomic memory operation.
    Atomic(Box<AtomicExpr>),
    /// Something the compiler can type-check but not generate code for (`long double`
    /// arithmetic). It is only an error if code generation reaches it, so the dead arms of
    /// header macros such as `isnan` can mention it.
    Unsupported(Rc<str>),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ReduceOp {
    Add,
    Mul,
    Min,
    Max,
    /// Of floating lanes, by IEEE 754-2019: a NaN if any lane is one.
    Minimum,
    Maximum,
    And,
    Or,
    Xor,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum VecBuiltin {
    /// Two vectors and the byte indices (into the 32 bytes `a:b`) of the result.
    Shuffle([u8; 16]),
    /// `__builtin_shuffle` with a run-time mask: `a`, `b`, and an integer vector of lane
    /// indices, taken modulo the lane count (twice that with two inputs).
    ShuffleDynamic {
        two_inputs: bool,
    },
    /// `mask`, `a`, `b`: bitwise `(mask & a) | (~mask & b)`.
    Select,
    /// `__builtin_convertvector`: from the operand's element type to the node's.
    Convert,
    /// A conversion named by a BIR `VConvertKind`.
    ConvertKind(u8),
    Abs,
    Min,
    Max,
    /// Of floating lanes, by IEEE 754-2019 (`bir::VLaneOp::FMin`): a NaN where either lane is one,
    /// -0 below +0.
    Minimum,
    Maximum,
    Sqrt,
    Reduce(ReduceOp),
    /// The top bit of every lane, lane 0 in bit 0, as an `int`.
    Bitmask,
    /// Whether `a & b` is all zero bits, as an `int`.
    TestZero,
    /// Saturating lane-wise add / subtract (8- and 16-bit lanes).
    AddSat {
        signed: bool,
    },
    SubSat {
        signed: bool,
    },
    /// Unsigned `(a + b + 1) >> 1` (8- and 16-bit lanes).
    AverageUnsigned,
    /// The lanes of `a` then `b`, each saturated to half the width; `signed` is the
    /// range of the result lanes.
    Narrow {
        signed: bool,
    },
    /// Signed 16-bit pairs multiplied and added into 32-bit lanes.
    DotProduct,
    /// Bytes of `a` picked by the bytes of `b`; an index of 16 or more gives 0.
    Swizzle,
    /// Widening multiply of the low or high half of the lanes: twice as wide, half as many.
    ExtMul {
        signed: bool,
        high: bool,
    },
    /// The upper 16 bits of each 16x16 product.
    MulHigh16 {
        signed: bool,
    },
}

/// What a compound atomic update computes from the old value and the operand.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum RmwOp {
    /// `old op value`, carried out in `op_ty` like a compound assignment.
    Arith(BinOp),
    /// `old ± value * scale` on a pointer; `value` is a `long long`.
    PtrAdd {
        scale: u64,
        sub: bool,
    },
    Exchange,
    /// `~(old & value)`.
    Nand,
    Min,
    Max,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum CasResult {
    /// The value that was in memory (`__sync_val_compare_and_swap`); `expected` is a value.
    Old,
    /// Whether the exchange happened (`__sync_bool_compare_and_swap`); `expected` is a value.
    Success,
    /// C11: `expected` is a pointer; on failure the value seen is written through it.
    SuccessWriteBack,
}

/// An atomic operation. `addr` is a pointer to the object, whose (non-atomic) type is
/// `object`; memory orders are BIR `MemOrder` values.
#[derive(Clone, Debug)]
pub(crate) enum AtomicExpr {
    Load {
        addr: Expr,
        order: u8,
    },
    /// Evaluates to the stored value.
    Store {
        addr: Expr,
        value: Expr,
        order: u8,
    },
    /// Evaluates to the old value, or to the new one when `want_new`.
    Rmw {
        addr: Expr,
        value: Expr,
        op: RmwOp,
        op_ty: Type,
        order: u8,
        want_new: bool,
    },
    Cas {
        addr: Expr,
        expected: Expr,
        desired: Expr,
        success: u8,
        failure: u8,
        result: CasResult,
    },
    Fence(u8),
}

impl AtomicExpr {
    pub(crate) fn for_each_child<'e>(&'e self, mut f: impl FnMut(&'e Expr)) {
        match self {
            AtomicExpr::Load { addr, .. } => f(addr),
            AtomicExpr::Store { addr, value, .. } | AtomicExpr::Rmw { addr, value, .. } => {
                f(addr);
                f(value);
            }
            AtomicExpr::Cas {
                addr,
                expected,
                desired,
                ..
            } => {
                f(addr);
                f(expected);
                f(desired);
            }
            AtomicExpr::Fence(_) => {}
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Intrinsic {
    /// `__builtin_unreachable()`.
    Unreachable,
    /// `__builtin_trap()`.
    Trap,
    Bswap,
    Clz,
    Ctz,
    Popcount,
    /// The high 64 bits of the 128-bit product of two 64-bit operands; signed or unsigned
    /// as the operand type is.
    MulHigh,
    /// `__builtin_frame_address(0)`.
    FrameAddress,
    /// The bits of a `float` or `double` as an integer of the same size, or the reverse:
    /// the operand's and the result's types say which.
    Bitcast,
    /// x86-64 `cpuid(leaf, subleaf)`; the third operand is the address of four `unsigned`
    /// that receive eax, ebx, ecx and edx.
    CpuId,
    /// `x` (32 or 64 bits) rotated by `n` (an `int`, taken modulo the width).
    RotL,
    RotR,
    /// The IEEE 754-2019 minimum and maximum of two `float`s or two `double`s.
    FMinimum,
    FMaximum,
    /// `atomic_thread_fence(memory_order_seq_cst)`: `mfence`, `lock; orl $0, (%rsp)`, `dmb ish`.
    FullBarrier,
    /// `memcpy`/`memmove(dst, src, n)`: the operands, as `void *`, `const void *` and
    /// `size_t`. Its value is `dst`, or nothing when its type is `void` (the call was a
    /// statement). A statement that copies a whole scalar local to or from memory moves
    /// the value instead (see `punned_local`).
    MemCopy,
    /// `memset(dst, byte, n)`, likewise.
    MemSet,
    /// A memory barrier as strong as `atomic_thread_fence(memory_order_acq_rel)`: what an
    /// `asm` statement that clobbers memory promises.
    Barrier,
    /// An `asm` statement assembled at compile time: `Program::asm_blocks[n]`. The operands are
    /// the values its code expects in registers, in the block's order, followed by one address
    /// per register output, where that result is stored.
    InlineAsm(u32),
    /// An operation on `long double` objects, given their addresses; see `x87.rs` for each
    /// one's operands. The comparisons have type `int`, the others `void`.
    X87(crate::x87::X87Op),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum AsmResult {
    I32,
    I64,
    F32,
    F64,
}

/// See `Intrinsic::InlineAsm`. Registers are numbered as in BIR: general 0..15, xmm 16..31.
#[derive(Clone, Debug)]
pub(crate) struct AsmBlock {
    /// Not to be removed, duplicated or moved across memory accesses.
    pub(crate) side_effects: bool,
    pub(crate) code: Vec<u8>,
    pub(crate) input_registers: Vec<u8>,
    pub(crate) outputs: Vec<(AsmResult, u8)>,
    pub(crate) clobbers: Vec<u8>,
}

/// The tallest expression the analyses that compare or classify whole expressions look into
/// (`Expr::depth`); of a taller one they say what is always safe to say.
pub(crate) const TALLEST_ANALYSED: u32 = 64;

impl Expr {
    /// The operand that a long chain goes on in: the left one of a binary operator, of `,`, `&&`
    /// and `||` (`a + b + c` is `(a + b) + c`), the last one of `?:` (`p ? x : q ? y : z`). A chain
    /// is as long as the program likes, so a walk goes down this operand by a loop and recurses
    /// into the others only.
    pub(crate) fn spine_child(&self) -> Option<&Expr> {
        match &self.kind {
            ExprKind::Binary(_, a, _)
            | ExprKind::Comma(a, _)
            | ExprKind::LogAnd(a, _)
            | ExprKind::LogOr(a, _) => Some(a),
            ExprKind::Cond(_, _, otherwise) => Some(otherwise),
            _ => None,
        }
    }

    /// `self` and the expressions down its spine, outermost first.
    pub(crate) fn spine(&self) -> Vec<&Expr> {
        let mut spine = vec![self];
        let mut at = self;
        while let Some(next) = at.spine_child() {
            spine.push(next);
            at = next;
        }
        spine
    }

    /// Calls `f` with `self` and with every expression under it (statement expressions' bodies
    /// apart), in no particular order.
    pub(crate) fn for_each_descendant<'e>(&'e self, f: &mut impl FnMut(&'e Expr)) {
        for at in self.spine() {
            f(at);
            let spine = at.spine_child();
            at.for_each_child(|child| {
                if !spine.is_some_and(|next| std::ptr::eq(next, child)) {
                    child.for_each_descendant(f);
                }
            });
        }
    }

    pub(crate) fn for_each_child<'e>(&'e self, mut f: impl FnMut(&'e Expr)) {
        match &self.kind {
            ExprKind::IntLit(_)
            | ExprKind::FloatLit(_)
            | ExprKind::LongDoubleLit(_)
            | ExprKind::Local(_)
            | ExprKind::Global(_)
            | ExprKind::Func(_)
            | ExprKind::StrLit(_)
            | ExprKind::Unsupported(_) => {}
            ExprKind::Neg(a)
            | ExprKind::BitNot(a)
            | ExprKind::LogNot(a)
            | ExprKind::Cast(a)
            | ExprKind::AddrOf(a)
            | ExprKind::Deref(a)
            | ExprKind::Member(a, _)
            | ExprKind::BitField { base: a, .. }
            | ExprKind::Decay(a)
            | ExprKind::VaStart(a)
            | ExprKind::VaArg(a)
            | ExprKind::VecSplat(a)
            | ExprKind::TransparentUnion(a)
            | ExprKind::ComplexPart(a, _)
            | ExprKind::Alloca(a, _) => f(a),
            ExprKind::IncDec {
                lhs, dynamic_scale, ..
            } => {
                f(lhs);
                if let Some(scale) = dynamic_scale {
                    f(scale);
                }
            }
            ExprKind::Binary(_, a, b)
            | ExprKind::PtrAdd {
                ptr: a, index: b, ..
            }
            | ExprKind::PtrDiff { a, b, .. }
            | ExprKind::LogAnd(a, b)
            | ExprKind::LogOr(a, b)
            | ExprKind::Assign(a, b)
            | ExprKind::CompoundAssign { lhs: a, rhs: b, .. }
            | ExprKind::VaCopy(a, b)
            | ExprKind::VecElem(a, b)
            | ExprKind::ComplexMake(a, b)
            | ExprKind::Comma(a, b) => {
                f(a);
                f(b);
            }
            ExprKind::Cond(a, b, c) => {
                f(a);
                f(b);
                f(c);
            }
            ExprKind::Call { callee, args } => {
                f(callee);
                args.iter().for_each(f);
            }
            ExprKind::StmtExpr { result, .. } => {
                if let Some(result) = result {
                    f(result);
                }
            }
            ExprKind::CompoundLiteral { items, .. } => {
                for item in items {
                    match item {
                        InitItem::Scalar { expr, .. }
                        | InitItem::Copy { expr, .. }
                        | InitItem::Bits { expr, .. } => f(expr),
                        InitItem::Bytes { .. } => {}
                    }
                }
            }
            ExprKind::Intrinsic(_, args)
            | ExprKind::VecInit(args)
            | ExprKind::VecBuiltin(_, args) => args.iter().for_each(f),
            ExprKind::Atomic(atomic) => atomic.for_each_child(f),
        }
    }

    pub(crate) fn is_lvalue(&self) -> bool {
        match &self.kind {
            ExprKind::Local(_)
            | ExprKind::Global(_)
            | ExprKind::Deref(_)
            | ExprKind::StrLit(_)
            | ExprKind::CompoundLiteral { .. } => true,
            ExprKind::Member(base, _)
            | ExprKind::BitField { base, .. }
            | ExprKind::ComplexPart(base, _)
            | ExprKind::VecElem(base, _) => base.is_lvalue(),
            _ => false,
        }
    }
}

/// One piece of an elaborated initializer: what to write at `offset` inside the object.
#[derive(Clone, Debug)]
pub(crate) enum InitItem {
    /// A scalar; `expr` already has the type of the target sub-object.
    Scalar { offset: u64, expr: Expr },
    /// Raw bytes (a string literal initialising a char array).
    Bytes { offset: u64, bytes: Vec<u8> },
    /// A whole struct/union copied from a struct-typed expression.
    Copy { offset: u64, expr: Expr, size: u64 },
    /// A bit-field; `expr` has the bit-field's declared type.
    Bits {
        offset: u64,
        field: BitField,
        expr: Expr,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct SwitchCase {
    /// Already converted to the promoted type of the controlling expression.
    pub(crate) value: i64,
    /// Last value of a GNU case range `value ... high`; equal to `value` otherwise.
    pub(crate) high: i64,
    pub(crate) label: LabelId,
}

#[derive(Clone, Debug)]
pub(crate) enum Stmt {
    Empty,
    Expr(Expr),
    /// Runs a local's initializer. `zero_first` clears the whole object before `items`.
    LocalInit {
        local: LocalId,
        zero_first: bool,
        items: Vec<InitItem>,
    },
    Block(Vec<Stmt>),
    If(Expr, Box<Stmt>, Option<Box<Stmt>>),
    While(Expr, Box<Stmt>),
    DoWhile(Box<Stmt>, Expr),
    For {
        init: Option<Box<Stmt>>,
        cond: Option<Box<Expr>>,
        step: Option<Box<Expr>>,
        body: Box<Stmt>,
    },
    Switch {
        cond: Box<Expr>,
        body: Box<Stmt>,
        cases: Vec<SwitchCase>,
        default: Option<LabelId>,
    },
    /// A statement with the labels in front of it, in order: `case`/`default` labels (the values
    /// live on the enclosing `Switch`) and named ones.
    Label(Vec<LabelId>, Box<Stmt>),
    Goto(LabelId),
    Break,
    Continue,
    /// `goto *expr;`: `expr` is one of the function's label addresses (`&&label`).
    GotoComputed(Expr),
    /// Allocates a variable length array object: `size` is its size in bytes (a `size_t`).
    VlaAlloc {
        local: LocalId,
        size: Expr,
        align: u64,
    },
    /// The part of a block from its first variable length array declaration to its end
    /// (leaving it releases the arrays), or from the declaration of a variable with
    /// `__attribute__((cleanup(f)))` to its end (leaving it, by any path, runs `cleanup`:
    /// the call `f(&variable)`).
    VlaScope {
        id: u32,
        cleanup: Option<Box<Expr>>,
        body: Vec<Stmt>,
    },
    /// The value already has the function's return type.
    Return(Option<Expr>),
}

/// The scalar local whose whole value `memcpy(operand, ..)` or `memcpy(.., operand, ..)` of
/// `bytes` bytes reads or writes: `operand` is `&local`, possibly converted to `void *`.
pub(crate) fn punned_local(
    operand: &Expr,
    bytes: u64,
    locals: &[LocalVar],
    tcx: &crate::types::TypeCtx,
) -> Option<LocalId> {
    let mut e = operand;
    while let ExprKind::Cast(inner) = &e.kind {
        if !e.ty.is_ptr() || !inner.ty.is_ptr() {
            return None;
        }
        e = inner;
    }
    let ExprKind::AddrOf(object) = &e.kind else {
        return None;
    };
    let ExprKind::Local(id) = object.kind else {
        return None;
    };
    let local = locals.get(id as usize)?;
    let ty = &local.ty;
    let plain = (ty.is_integer() && !ty.is_int128()) || ty.is_float() || ty.is_ptr();
    (plain && !local.volatile && !ty.is_atomic() && tcx.size_of(ty) == Some(bytes)).then_some(id)
}

impl LocalVar {
    /// Every `&variable` is one that `punned_local` recognised.
    pub(crate) fn only_punned(&self) -> bool {
        self.addr_count > 0 && self.addr_count == self.punned_count
    }
}

#[derive(Debug)]
pub(crate) struct LocalVar {
    pub(crate) ty: Type,
    /// A stricter alignment requested with `_Alignas` / `aligned`.
    pub(crate) align: Option<u64>,
    /// `&x` appears somewhere, so the variable must live in memory.
    pub(crate) addr_taken: bool,
    /// How many times its address is taken, and how many of those are the operand of a
    /// `memcpy` statement that moves the whole variable: if that is all of them, the
    /// variable does not need to live in memory after all.
    pub(crate) addr_count: u32,
    pub(crate) punned_count: u32,
    /// Declared `volatile`: it lives in memory and every access is a load or store.
    pub(crate) volatile: bool,
    /// Declared `register`: its address cannot be taken.
    pub(crate) register: bool,
}

#[derive(Debug)]
pub(crate) struct FuncBody {
    /// The locals that receive the parameters, in order.
    pub(crate) params: Vec<LocalId>,
    pub(crate) locals: Vec<LocalVar>,
    pub(crate) stmts: Vec<Stmt>,
    pub(crate) nlabels: u32,
    /// The labels whose address is taken; `&&label` evaluates to its position here plus one.
    pub(crate) address_labels: Vec<LabelId>,
    /// For every label, the `VlaScope`s (outermost first) it is defined inside.
    pub(crate) label_vla_paths: Vec<Vec<u32>>,
}

#[derive(Debug)]
pub(crate) struct Function {
    pub(crate) name: Rc<str>,
    pub(crate) ty: Rc<FuncType>,
    pub(crate) is_static: bool,
    /// Some declaration gives the function external linkage for real: anything but a
    /// plain `inline` definition, which C11 6.7.4p7 makes an "inline definition" only.
    pub(crate) external: bool,
    /// A Microsoft `inline` definition: every unit that uses the function has one, the
    /// program keeps one for the units that only declare it, and none is exported.
    pub(crate) linkonce: bool,
    /// `__asm__("name")`: the symbol to link against instead of `name`.
    pub(crate) link_name: Option<Rc<str>>,
    /// `__attribute__((constructor))` / `((destructor))` and its priority (65535 when none
    /// is given, which sorts last).
    pub(crate) constructor: Option<u32>,
    pub(crate) destructor: Option<u32>,
    /// `__attribute__((weak))`, and where.
    pub(crate) weak: Option<Loc>,
    /// `bir::INLINE_*`: `always_inline`, `noinline`, and whether some declaration says `inline`.
    pub(crate) inlining: u8,
    pub(crate) body: Option<FuncBody>,
    /// The parameters' names as the last declaration that names them spells them.
    pub(crate) param_names: Vec<Option<Rc<str>>>,
    /// Location of the first use, for "declared but never defined" diagnostics.
    pub(crate) first_use: Option<Loc>,
    pub(crate) loc: Loc,
}

#[derive(Clone, Debug)]
pub(crate) enum RelocTarget {
    Global(GlobalId),
    Func(FuncId),
    Str(StrId),
}

#[derive(Clone, Debug)]
pub(crate) struct DataReloc {
    pub(crate) offset: u64,
    pub(crate) target: RelocTarget,
    pub(crate) addend: i64,
}

#[derive(Debug)]
pub(crate) struct Global {
    pub(crate) name: Rc<str>,
    pub(crate) ty: Type,
    /// A definition (possibly tentative) has been seen; otherwise only `extern` declarations.
    pub(crate) defined: bool,
    /// Initial bytes; shorter than the object means the tail is zero. Empty for zero-init.
    pub(crate) init: Vec<u8>,
    pub(crate) relocs: Vec<DataReloc>,
    pub(crate) has_initializer: bool,
    pub(crate) align: Option<u64>,
    pub(crate) link_name: Option<Rc<str>>,
    /// Internal linkage: `static`, a block-scope static, or an unnamed object.
    pub(crate) is_static: bool,
    /// `_Thread_local`: lives in the tls segment, one copy per thread.
    pub(crate) thread_local: bool,
    /// Bytes past `sizeof` that an initialized flexible array member takes (GNU C).
    pub(crate) extra_size: u64,
    /// `__attribute__((weak))` or `#pragma weak`: if only declared, its address is null when
    /// nothing defines it.
    pub(crate) weak: bool,
    /// Any number of units may define it, with the same contents, and the program has one:
    /// `__declspec(selectany)`, and the `static` objects of Microsoft's inline functions.
    pub(crate) linkonce: bool,
}

/// A string literal's array: its bytes with the terminator, and the alignment of its elements.
pub(crate) struct StringLiteral {
    pub(crate) bytes: Rc<[u8]>,
    pub(crate) align: u64,
}

/// A whole translation unit after parsing and semantic analysis.
pub(crate) struct Program {
    /// Size of the target's va_list object, for `va_copy`.
    pub(crate) va_list_size: u64,
    pub(crate) tcx: TypeCtx,
    pub(crate) globals: Vec<Global>,
    pub(crate) funcs: Vec<Function>,
    pub(crate) strings: Vec<StringLiteral>,
    pub(crate) warnings: Vec<(Loc, String)>,
    /// Other external names of functions: `__attribute__((alias("target")))`.
    pub(crate) function_aliases: Vec<(Rc<str>, FuncId)>,
    pub(crate) asm_blocks: Vec<AsmBlock>,
}

impl ExprKind {
    /// Takes the `spine_child` out, leaving a leaf behind (the other operands go with it).
    fn take_spine_child(&mut self) -> Option<Box<Expr>> {
        if !matches!(
            self,
            ExprKind::Binary(..)
                | ExprKind::Comma(..)
                | ExprKind::LogAnd(..)
                | ExprKind::LogOr(..)
                | ExprKind::Cond(..)
        ) {
            return None;
        }
        match std::mem::replace(self, ExprKind::IntLit(0)) {
            ExprKind::Binary(_, next, _)
            | ExprKind::Comma(next, _)
            | ExprKind::LogAnd(next, _)
            | ExprKind::LogOr(next, _)
            | ExprKind::Cond(_, _, next) => Some(next),
            _ => None,
        }
    }
}

/// A chain is dropped link by link, not by a recursion as deep as it is long.
impl Drop for Expr {
    fn drop(&mut self) {
        let mut next = self.kind.take_spine_child();
        while let Some(mut link) = next {
            next = link.kind.take_spine_child();
        }
    }
}

/// And copied likewise.
impl Clone for Expr {
    fn clone(&self) -> Expr {
        let mut above = Vec::new();
        let mut at = self;
        while let Some(next) = at.spine_child() {
            above.push(at);
            at = next;
        }
        let mut copy = at.with_kind(at.kind.clone());
        for parent in above.into_iter().rev() {
            let next = Box::new(copy);
            copy = parent.with_kind(match &parent.kind {
                ExprKind::Binary(op, _, b) => ExprKind::Binary(*op, next, b.clone()),
                ExprKind::Comma(_, b) => ExprKind::Comma(next, b.clone()),
                ExprKind::LogAnd(_, b) => ExprKind::LogAnd(next, b.clone()),
                ExprKind::LogOr(_, b) => ExprKind::LogOr(next, b.clone()),
                ExprKind::Cond(c, a, _) => ExprKind::Cond(c.clone(), a.clone(), next),
                // (Nothing else has a `spine_child`.)
                other => other.clone(),
            });
        }
        copy
    }
}

impl Expr {
    /// What `pick` makes of the kind of expression this is, or the expression back if it makes
    /// nothing of it. (An `Expr` is dropped by a function of its own, so its parts are not moved
    /// out of it by a pattern.)
    pub(crate) fn unwrap_kind<T>(
        mut self,
        pick: impl FnOnce(ExprKind) -> Result<T, ExprKind>,
    ) -> Result<T, Expr> {
        match pick(std::mem::replace(&mut self.kind, ExprKind::IntLit(0))) {
            Ok(picked) => Ok(picked),
            Err(kind) => {
                self.kind = kind;
                Err(self)
            }
        }
    }

    /// `self` with another `kind`.
    fn with_kind(&self, kind: ExprKind) -> Expr {
        Expr {
            kind,
            ty: self.ty.clone(),
            loc: self.loc,
            has_control_flow: self.has_control_flow,
            nesting: self.nesting,
            depth: self.depth,
        }
    }
}
