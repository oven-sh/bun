//! From bytes to calls of a visitor.
//!
//! One loop serves to check code, to run over code that was checked, and to skip it. Checking covers the encoding and
//! what immediates refer to. The types of operands are left to the visitor.

/// Builds an error away from the code that runs. What it names is copied.
macro_rules! fail {
    ($decoder:ident, parse, live: $live:literal, dead: $dead:literal) => {{
        if $decoder.is_dead() {
            fail!($decoder, parse, concat!($dead, " in unreachable context"));
        }
        fail!($decoder, parse, $live)
    }};
    ($decoder:ident, parse, $($reason:tt)*) => {{
        let offset = $decoder.reader.position();
        return Err(M::error(move || Error::parse(offset, format_args!($($reason)*))));
    }};
    ($decoder:ident, validation, $($reason:tt)*) => {
        return Err(M::error(move || Error::validation(format_args!($($reason)*))))
    };
}

macro_rules! ensure {
    ($decoder:ident, $condition:expr, $($error:tt)*) => {
        if M::PURPOSE == Purpose::Check && !$condition {
            fail!($decoder, $($error)*);
        }
    };
}

/// `$read` gives an `Option`.
macro_rules! read {
    ($decoder:ident, $read:expr, $($reason:tt)*) => {
        match $read {
            Some(value) => value,
            None => fail!($decoder, parse, $($reason)*),
        }
    };
}

mod atomic;
mod control;
mod gc;
mod immediates;
mod misc;
pub(crate) mod types;
mod vector;

use core::convert::Infallible;
use core::marker::PhantomData;
use core::mem;

use bun_engine_asm::{Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, Width};

pub(crate) use self::gc::STRUCT_SET;
use self::immediates::Access;
pub(crate) use self::vector::{V128_CONST, VectorOp};
use crate::error::{Error, Missing};
use crate::module::{FunctionFlags, ModuleHeader};
use crate::opcode::{self, *};
use crate::ops::{FloatBinaryOp, FloatUnaryOp, Flow, IntBinaryOp, IntUnaryOp, LoadOp, StoreOp};
use crate::reader::Reader;
use crate::visitor::{
    Visit, VisitControl, VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
    Visitor,
};

pub(crate) const NO_OPCODE: &str = "can't decode opcode";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Purpose {
    Check,
    Run,
    Skip,
}

pub(crate) trait Mode {
    type Error;
    const PURPOSE: Purpose;

    fn error(make: impl FnOnce() -> Error) -> Self::Error;
    fn complete(error: Self::Error, bytes: &[u8], start: usize, end: usize) -> Self::Error;
}

pub(crate) struct Check;

impl Mode for Check {
    type Error = Error;
    const PURPOSE: Purpose = Purpose::Check;

    #[cold]
    #[inline(never)]
    fn error(make: impl FnOnce() -> Error) -> Error {
        make().lacking(Missing::InstructionStart)
    }

    #[cold]
    fn complete(mut error: Error, bytes: &[u8], start: usize, end: usize) -> Error {
        let Some(missing) = error.take_missing() else {
            return error;
        };
        let after_opcode = || opcodes_at(bytes, start);
        match missing {
            Missing::OffsetAfterInstruction => error.set_offset(end),
            Missing::OffsetAfterOpcode => error.set_offset(after_opcode().2),
            Missing::OffsetOfLastByte => error.set_offset(end - 1),
            Missing::OpcodeName => error.prefix_reason(opcode::name(after_opcode().0)),
            Missing::SecondOpcodeNumber => error.prefix_reason(&after_opcode().1.to_string()),
            Missing::InstructionStart | Missing::OperandCheck(_) => {
                return error.lacking(Missing::OperandCheck(start));
            }
        }
        error
    }
}

/// The first byte, the number after a prefix, and the offset after them.
pub(crate) fn opcodes_at(bytes: &[u8], start: usize) -> (u8, u32, usize) {
    let mut reader = Reader::new(bytes, start);
    let first = reader.u8().unwrap_or(UNREACHABLE);
    let second = (first >= GC_PREFIX).then(|| reader.u32()).flatten();
    (first, second.unwrap_or(u32::MAX), reader.position())
}

pub(crate) struct Run<E>(PhantomData<E>);

impl<E> Mode for Run<E> {
    type Error = E;
    const PURPOSE: Purpose = Purpose::Run;

    #[inline(always)]
    fn error(_: impl FnOnce() -> Error) -> E {
        unreachable!("the code was validated")
    }

    #[inline(always)]
    fn complete(error: E, _: &[u8], _: usize, _: usize) -> E {
        error
    }
}

struct Skip;

impl Mode for Skip {
    type Error = Infallible;
    const PURPOSE: Purpose = Purpose::Skip;

    #[inline(always)]
    fn error(_: impl FnOnce() -> Error) -> Infallible {
        unreachable!("the code was validated")
    }

    #[inline(always)]
    fn complete(error: Infallible, _: &[u8], _: usize, _: usize) -> Infallible {
        error
    }
}

struct Ignore;

impl Visit for Ignore {
    type Error = Infallible;

    #[inline(always)]
    fn unhandled(&mut self) -> Result<(), Infallible> {
        Ok(())
    }
}

impl VisitControl for Ignore {}
impl VisitVariable for Ignore {}
impl VisitNumeric for Ignore {}
impl VisitMemory for Ignore {}
impl VisitReference for Ignore {}
impl VisitVector for Ignore {}

/// What is not needed for every instruction.
#[derive(Clone, Copy)]
pub(crate) struct Context<'a> {
    header: &'a ModuleHeader,
    /// The number of open blocks, the body included.
    pub(crate) depth: u32,
    /// Zero in live code, otherwise one more than the number of open blocks that started in dead code.
    pub(crate) dead: u32,
    pub(crate) calls: u32,
    pub(crate) loops: u32,
    pub(crate) flags: FunctionFlags,
}

impl<'a> Context<'a> {
    pub(crate) fn new(header: &'a ModuleHeader) -> Self {
        Self {
            header,
            depth: 1,
            dead: 0,
            calls: 0,
            loops: 0,
            flags: FunctionFlags::empty(),
        }
    }
}

pub(crate) struct Decoder<'c, 'a, M> {
    pub(crate) reader: Reader<'a>,
    pub(crate) cx: &'c mut Context<'a>,
    mode: PhantomData<M>,
}

const INT_CONDS: [Cond; 10] = [
    Cond::Eq,
    Cond::Ne,
    Cond::Lt,
    Cond::Below,
    Cond::Gt,
    Cond::Above,
    Cond::Le,
    Cond::BelowEq,
    Cond::Ge,
    Cond::AboveEq,
];
const FLOAT_CONDS: [FloatCond; 6] = [
    FloatCond::Eq,
    FloatCond::NeOrUnordered,
    FloatCond::Lt,
    FloatCond::Gt,
    FloatCond::Le,
    FloatCond::Ge,
];
const INT_UNARY: [IntUnaryOp; 3] = [IntUnaryOp::Clz, IntUnaryOp::Ctz, IntUnaryOp::Popcnt];
const ARITHMETIC: [IntBinaryOp; 3] = [IntBinaryOp::Add, IntBinaryOp::Sub, IntBinaryOp::Mul];
const BITWISE: [IntBinaryOp; 3] = [IntBinaryOp::And, IntBinaryOp::Or, IntBinaryOp::Xor];
const SHIFTS: [Shift; 5] = [
    Shift::Left,
    Shift::RightArithmetic,
    Shift::RightLogical,
    Shift::RotateLeft,
    Shift::RotateRight,
];
const ROUNDINGS: [Rounding; 4] = [
    Rounding::Up,
    Rounding::Down,
    Rounding::TowardZero,
    Rounding::Nearest,
];
const FLOAT_BINARY: [FloatBinaryOp; 7] = [
    FloatBinaryOp::Add,
    FloatBinaryOp::Sub,
    FloatBinaryOp::Mul,
    FloatBinaryOp::Div,
    FloatBinaryOp::Min,
    FloatBinaryOp::Max,
    FloatBinaryOp::Copysign,
];
const SIGNS: [Sign; 2] = [Sign::Signed, Sign::Unsigned];
const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];

impl<'c, 'a, M: Mode> Decoder<'c, 'a, M> {
    #[inline(always)]
    pub(crate) fn new(reader: Reader<'a>, cx: &'c mut Context<'a>) -> Self {
        Self {
            reader,
            cx,
            mode: PhantomData,
        }
    }

    /// Goes on to the end of the outermost block. When skipping, stops in front of the instruction that ends it.
    /// If the decoder and the context are locals of the caller, the one stays in registers and the other takes none.
    #[inline(always)]
    pub(crate) fn run<V: Visitor<Error = M::Error>>(&mut self, v: &mut V) -> Result<(), M::Error> {
        loop {
            if M::PURPOSE == Purpose::Run && v.flow() == Flow::Dead && self.cx.dead == 0 {
                self.cx.dead = 1;
                self.skip_dead_code();
            }
            let start = self.reader.position();
            match self.step(v, start) {
                Ok(true) => {}
                Ok(false) => return Ok(()),
                Err(error) => {
                    let (bytes, end) = (self.reader.bytes(), self.reader.position());
                    return Err(M::complete(error, bytes, start, end));
                }
            }
        }
    }

    /// For what is too rare or too large to be part of the loop.
    #[inline(always)]
    fn apart<T>(&mut self, function: impl FnOnce(&mut Decoder<'_, 'a, M>) -> T) -> T {
        let mut copy = Decoder::new(self.reader, self.cx);
        let result = function(&mut copy);
        self.reader.set_position(copy.reader.position());
        result
    }

    #[inline(always)]
    pub(crate) fn skip_dead_code(&mut self) {
        let position = skip_block(self.reader, self.cx);
        self.reader.set_position(position);
    }

    /// Returns whether there is more.
    #[inline(always)]
    fn step<V: Visitor<Error = M::Error>>(
        &mut self,
        v: &mut V,
        start: usize,
    ) -> Result<bool, M::Error> {
        use FloatWidth::{F32, F64};
        use Width::{W32, W64};

        v.at(start as u32);
        let op = read!(self, self.reader.u8(), "{NO_OPCODE}");
        let nth = |first: u8| usize::from(op - first);
        // No range patterns: they are tested one after the other, outside the jump table.
        match op {
            UNREACHABLE => self.transfer(|| v.unreachable())?,
            NOP => v.nop()?,
            BLOCK => {
                let ty = self.block_type(op)?;
                self.open_block();
                v.block(ty)?;
            }
            LOOP => {
                let ty = self.block_type(op)?;
                self.open_block();
                self.cx.loops += 1;
                v.loop_(ty, self.cx.loops - 1)?;
            }
            IF => {
                let ty = self.block_type(op)?;
                self.open_block();
                v.if_(ty)?;
            }
            TRY => {
                self.note_if_live(FunctionFlags::HAS_TRY);
                let ty = self.block_type(op)?;
                self.open_block();
                v.try_(ty)?;
            }
            TRY_TABLE => {
                self.note_if_live(FunctionFlags::HAS_TRY_TABLE);
                let ty = self.block_type(op)?;
                let catches = self.apart(|decoder| decoder.catches())?;
                self.open_block();
                v.try_table(ty, catches)?;
            }
            ELSE | CATCH | CATCH_ALL | DELEGATE | END
                if M::PURPOSE == Purpose::Skip && self.cx.depth == 1 =>
            {
                self.reader.set_position(start);
                return Ok(false);
            }
            ELSE => {
                self.ensure_in_block("else block")?;
                v.else_(self.next_arm())?;
            }
            CATCH => {
                self.ensure_in_block("catch block")?;
                let tag = self.tag()?;
                v.catch(tag, self.next_arm())?;
            }
            CATCH_ALL => {
                self.ensure_in_block("catch block")?;
                v.catch_all(self.next_arm())?;
            }
            DELEGATE => {
                let label = self.delegate_label()?;
                v.delegate(label, self.close_block())?;
            }
            END => {
                v.end(self.close_block())?;
                return Ok(self.cx.depth != 0);
            }
            THROW => {
                let tag = self.tag()?;
                self.transfer(|| v.throw(tag))?;
            }
            RETHROW => {
                let label = self.label()?;
                self.transfer(|| v.rethrow(label))?;
            }
            THROW_REF => self.transfer(|| v.throw_ref())?,
            BR => {
                let label = self.label()?;
                self.transfer(|| v.br(label))?;
            }
            BR_IF => v.br_if(self.label()?)?,
            BR_TABLE => {
                let table = self.apart(|decoder| decoder.br_table())?;
                self.transfer(|| v.br_table(table))?;
            }
            RETURN => self.transfer(|| v.return_())?,
            CALL => {
                let func = self.func()?;
                v.call(func, self.call_site())?;
            }
            CALL_INDIRECT => {
                let (ty, table) = self.apart(|decoder| decoder.call_indirect_immediates())?;
                v.call_indirect(ty, table, self.call_site())?;
            }
            CALL_REF => {
                let ty = self.apart(|decoder| decoder.call_ref_type())?;
                v.call_ref(ty, self.call_site())?;
            }
            RETURN_CALL => {
                let func = self.func()?;
                let site = self.tail_call_site();
                self.transfer(|| v.return_call(func, site))?;
            }
            RETURN_CALL_INDIRECT => {
                let (ty, table) = self.apart(|decoder| decoder.call_indirect_immediates())?;
                let site = self.tail_call_site();
                self.transfer(|| v.return_call_indirect(ty, table, site))?;
            }
            RETURN_CALL_REF => {
                let ty = self.apart(|decoder| decoder.call_ref_type())?;
                let site = self.tail_call_site();
                self.transfer(|| v.return_call_ref(ty, site))?;
            }

            DROP => v.drop_()?,
            SELECT => v.select(None)?,
            SELECT_TYPED => v.select(Some(self.apart(|decoder| decoder.select_type())?))?,
            LOCAL_GET => v.local_get(self.local()?)?,
            LOCAL_SET => v.local_set(self.local()?)?,
            LOCAL_TEE => v.local_tee(self.local()?)?,
            GLOBAL_GET => v.global_get(self.global()?)?,
            GLOBAL_SET => v.global_set(self.global()?)?,
            TABLE_GET => v.table_get(self.table()?)?,
            TABLE_SET => v.table_set(self.table()?)?,

            I32_LOAD | I64_LOAD | F32_LOAD | F64_LOAD | I32_LOAD8_S | I32_LOAD8_U
            | I32_LOAD16_S | I32_LOAD16_U | I64_LOAD8_S | I64_LOAD8_U | I64_LOAD16_S
            | I64_LOAD16_U | I64_LOAD32_S | I64_LOAD32_U => {
                let load = LoadOp::ALL[nth(I32_LOAD)];
                let arg = self.mem_arg(Access::Load(op), load.size().log2_bytes())?;
                v.load(load, arg)?;
            }
            I32_STORE | I64_STORE | F32_STORE | F64_STORE | I32_STORE8 | I32_STORE16
            | I64_STORE8 | I64_STORE16 | I64_STORE32 => {
                let store = StoreOp::ALL[nth(I32_STORE)];
                let arg = self.mem_arg(Access::Store(op), store.size().log2_bytes())?;
                v.store(store, arg)?;
            }
            MEMORY_SIZE => v.memory_size(self.sized_memory("current_memory")?)?,
            MEMORY_GROW => v.memory_grow(self.sized_memory("grow_memory")?)?,

            I32_CONST => v.i32_const(self.i32_immediate()?)?,
            I64_CONST => v.i64_const(self.i64_immediate()?)?,
            F32_CONST => v.f32_const(u32::from_le_bytes(self.float_immediate()?))?,
            F64_CONST => v.f64_const(u64::from_le_bytes(self.float_immediate()?))?,

            I32_EQZ => v.int_eqz(W32)?,
            I32_EQ | I32_NE | I32_LT_S | I32_LT_U | I32_GT_S | I32_GT_U | I32_LE_S | I32_LE_U
            | I32_GE_S | I32_GE_U => v.int_compare(W32, INT_CONDS[nth(I32_EQ)])?,
            I64_EQZ => v.int_eqz(W64)?,
            I64_EQ | I64_NE | I64_LT_S | I64_LT_U | I64_GT_S | I64_GT_U | I64_LE_S | I64_LE_U
            | I64_GE_S | I64_GE_U => v.int_compare(W64, INT_CONDS[nth(I64_EQ)])?,
            F32_EQ | F32_NE | F32_LT | F32_GT | F32_LE | F32_GE => {
                v.float_compare(F32, FLOAT_CONDS[nth(F32_EQ)])?
            }
            F64_EQ | F64_NE | F64_LT | F64_GT | F64_LE | F64_GE => {
                v.float_compare(F64, FLOAT_CONDS[nth(F64_EQ)])?
            }

            I32_CLZ | I32_CTZ | I32_POPCNT => v.int_unary(W32, INT_UNARY[nth(I32_CLZ)])?,
            I32_ADD | I32_SUB | I32_MUL => v.int_binary(W32, ARITHMETIC[nth(I32_ADD)])?,
            I32_DIV_S | I32_DIV_U => v.int_div(W32, SIGNS[nth(I32_DIV_S)])?,
            I32_REM_S | I32_REM_U => v.int_rem(W32, SIGNS[nth(I32_REM_S)])?,
            I32_AND | I32_OR | I32_XOR => v.int_binary(W32, BITWISE[nth(I32_AND)])?,
            I32_SHL | I32_SHR_S | I32_SHR_U | I32_ROTL | I32_ROTR => {
                v.int_shift(W32, SHIFTS[nth(I32_SHL)])?
            }
            I64_CLZ | I64_CTZ | I64_POPCNT => v.int_unary(W64, INT_UNARY[nth(I64_CLZ)])?,
            I64_ADD | I64_SUB | I64_MUL => v.int_binary(W64, ARITHMETIC[nth(I64_ADD)])?,
            I64_DIV_S | I64_DIV_U => v.int_div(W64, SIGNS[nth(I64_DIV_S)])?,
            I64_REM_S | I64_REM_U => v.int_rem(W64, SIGNS[nth(I64_REM_S)])?,
            I64_AND | I64_OR | I64_XOR => v.int_binary(W64, BITWISE[nth(I64_AND)])?,
            I64_SHL | I64_SHR_S | I64_SHR_U | I64_ROTL | I64_ROTR => {
                v.int_shift(W64, SHIFTS[nth(I64_SHL)])?
            }

            F32_ABS => v.float_unary(F32, FloatUnaryOp::Abs)?,
            F32_NEG => v.float_unary(F32, FloatUnaryOp::Neg)?,
            F32_CEIL | F32_FLOOR | F32_TRUNC | F32_NEAREST => {
                v.float_round(F32, ROUNDINGS[nth(F32_CEIL)])?
            }
            F32_SQRT => v.float_unary(F32, FloatUnaryOp::Sqrt)?,
            F32_ADD | F32_SUB | F32_MUL | F32_DIV | F32_MIN | F32_MAX | F32_COPYSIGN => {
                v.float_binary(F32, FLOAT_BINARY[nth(F32_ADD)])?
            }
            F64_ABS => v.float_unary(F64, FloatUnaryOp::Abs)?,
            F64_NEG => v.float_unary(F64, FloatUnaryOp::Neg)?,
            F64_CEIL | F64_FLOOR | F64_TRUNC | F64_NEAREST => {
                v.float_round(F64, ROUNDINGS[nth(F64_CEIL)])?
            }
            F64_SQRT => v.float_unary(F64, FloatUnaryOp::Sqrt)?,
            F64_ADD | F64_SUB | F64_MUL | F64_DIV | F64_MIN | F64_MAX | F64_COPYSIGN => {
                v.float_binary(F64, FLOAT_BINARY[nth(F64_ADD)])?
            }

            I32_WRAP_I64 => v.i32_wrap_i64()?,
            I32_TRUNC_F32_S | I32_TRUNC_F32_U => {
                v.truncate_float(F32, SIGNS[nth(I32_TRUNC_F32_S)], W32)?;
            }
            I32_TRUNC_F64_S | I32_TRUNC_F64_U => {
                v.truncate_float(F64, SIGNS[nth(I32_TRUNC_F64_S)], W32)?;
            }
            I64_EXTEND_I32_S | I64_EXTEND_I32_U => {
                v.i64_extend_i32(SIGNS[nth(I64_EXTEND_I32_S)])?;
            }
            I64_TRUNC_F32_S | I64_TRUNC_F32_U => {
                v.truncate_float(F32, SIGNS[nth(I64_TRUNC_F32_S)], W64)?;
            }
            I64_TRUNC_F64_S | I64_TRUNC_F64_U => {
                v.truncate_float(F64, SIGNS[nth(I64_TRUNC_F64_S)], W64)?;
            }
            F32_CONVERT_I32_S | F32_CONVERT_I32_U => {
                v.convert_int_to_float(SIGNS[nth(F32_CONVERT_I32_S)], W32, F32)?;
            }
            F32_CONVERT_I64_S | F32_CONVERT_I64_U => {
                v.convert_int_to_float(SIGNS[nth(F32_CONVERT_I64_S)], W64, F32)?;
            }
            F32_DEMOTE_F64 => v.f32_demote_f64()?,
            F64_CONVERT_I32_S | F64_CONVERT_I32_U => {
                v.convert_int_to_float(SIGNS[nth(F64_CONVERT_I32_S)], W32, F64)?;
            }
            F64_CONVERT_I64_S | F64_CONVERT_I64_U => {
                v.convert_int_to_float(SIGNS[nth(F64_CONVERT_I64_S)], W64, F64)?;
            }
            F64_PROMOTE_F32 => v.f64_promote_f32()?,
            I32_REINTERPRET_F32 => v.reinterpret_float_as_int(F32)?,
            I64_REINTERPRET_F64 => v.reinterpret_float_as_int(F64)?,
            F32_REINTERPRET_I32 => v.reinterpret_int_as_float(F32)?,
            F64_REINTERPRET_I64 => v.reinterpret_int_as_float(F64)?,
            I32_EXTEND8_S | I32_EXTEND16_S => v.int_sign_extend(W32, SIZES[nth(I32_EXTEND8_S)])?,
            I64_EXTEND8_S | I64_EXTEND16_S | I64_EXTEND32_S => {
                v.int_sign_extend(W64, SIZES[nth(I64_EXTEND8_S)])?
            }

            REF_NULL => v.ref_null(self.apart(|decoder| decoder.null_type())?)?,
            REF_IS_NULL => v.ref_is_null()?,
            REF_FUNC => v.ref_func(self.apart(|decoder| decoder.referenced_func())?)?,
            REF_EQ => v.ref_eq()?,
            REF_AS_NON_NULL => v.ref_as_non_null()?,
            BR_ON_NULL => v.br_on_null(self.label()?)?,
            BR_ON_NON_NULL => v.br_on_non_null(self.label()?)?,

            GC_PREFIX => self.apart(|decoder| decoder.gc(v))?,
            MISC_PREFIX => self.apart(|decoder| decoder.misc(v))?,
            VECTOR_PREFIX => {
                self.cx.flags |= FunctionFlags::USES_SIMD;
                self.apart(|decoder| decoder.vector(v))?;
            }
            ATOMIC_PREFIX => self.apart(|decoder| decoder.atomic(v))?,
            _ => fail!(self, parse, "invalid opcode {op}"),
        }
        Ok(true)
    }
}

/// Returns the position of the instruction that ends the block or its arm.
#[inline(never)]
fn skip_block<'a>(reader: Reader<'a>, cx: &mut Context<'a>) -> usize {
    let depth = mem::replace(&mut cx.depth, 1);
    let mut decoder = Decoder::<Skip>::new(reader, cx);
    let Ok(()) = decoder.run(&mut Ignore);
    decoder.cx.depth = depth;
    decoder.reader.position()
}
