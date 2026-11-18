//! Shifts of all lanes by the same distance.

use super::integer::MacroAssembler;
use super::opcode::{Sse, SseShiftImm};
use crate::assembly::FloatAssembly;
use crate::operand::{Shift, Size, Width};
use crate::register::{Fpr, Gpr};
use crate::vector::VectorShift;
use crate::vector::lanes::splat;

/// Bytes are shifted as words, and where there is no arithmetic shift it is made of a logical one.
fn instructions(op: VectorShift) -> (SseShiftImm, Sse) {
    use VectorShift::*;
    match op {
        I8x16Shl | I16x8Shl => (SseShiftImm::Psllw, Sse::Psllw),
        I8x16ShrS | I8x16ShrU | I16x8ShrU => (SseShiftImm::Psrlw, Sse::Psrlw),
        I16x8ShrS => (SseShiftImm::Psraw, Sse::Psraw),
        I32x4Shl => (SseShiftImm::Pslld, Sse::Pslld),
        I32x4ShrS => (SseShiftImm::Psrad, Sse::Psrad),
        I32x4ShrU => (SseShiftImm::Psrld, Sse::Psrld),
        I64x2Shl => (SseShiftImm::Psllq, Sse::Psllq),
        I64x2ShrS | I64x2ShrU => (SseShiftImm::Psrlq, Sse::Psrlq),
    }
}

/// The subtraction that extends the sign after a logical shift.
fn sign_extension(op: VectorShift) -> Option<Sse> {
    match op {
        VectorShift::I8x16ShrS => Some(Sse::Psubb),
        VectorShift::I64x2ShrS => Some(Sse::Psubq),
        _ => None,
    }
}

fn addition(lanes: Size) -> Sse {
    match lanes {
        Size::S8 => Sse::Paddb,
        Size::S16 => Sse::Paddw,
        Size::S32 => Sse::Paddd,
        Size::S64 => Sse::Paddq,
    }
}

impl MacroAssembler {
    pub(super) fn shift_lanes_by_constant(
        &mut self,
        op: VectorShift,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        let lanes = op.lanes();
        let amount = amount % lanes.bits();
        match (op, amount) {
            (_, 0) => return self.move_vector(dst, src),
            (_, 1) if op.kind() == Shift::Left => {
                return self.sse_binary(addition(lanes), dst, src, src);
            }
            (VectorShift::I8x16Shl, 2) => {
                self.sse_binary(Sse::Paddb, dst, src, src);
                return self.sse_binary(Sse::Paddb, dst, dst, dst);
            }
            (VectorShift::I8x16ShrS, 7) => return self.zero_op(Sse::Pcmpgtb, dst, src),
            (VectorShift::I64x2ShrS, 63) => return self.spread_sign64(dst, src),
            _ => {}
        }
        self.sse_shift(instructions(op).0, dst, src, amount);
        if lanes == Size::S8 {
            let kept = if op.kind() == Shift::Left {
                0xff << amount
            } else {
                0xff >> amount
            };
            self.sse_with_constant(Sse::Pand, dst, dst, splat(lanes, kept));
        }
        if let Some(sub) = sign_extension(op) {
            let sign = splat(lanes, 1 << (lanes.bits() - 1 - amount));
            self.sse_with_constant(Sse::Pxor, dst, dst, sign);
            self.sse_with_constant(sub, dst, dst, sign);
        }
    }

    /// The instructions read the low half of the count, so the high half holds bits that are shifted as well.
    pub(super) fn shift_lanes_by_register(
        &mut self,
        op: VectorShift,
        dst: Fpr,
        src: Fpr,
        amount: Gpr,
    ) {
        let (lanes, shift, count) = (op.lanes(), instructions(op).1, self.scratch_fpr(0));
        self.asm.movd_to_xmm(Width::W32, count, amount);
        self.sse_with_constant(Sse::Pand, count, count, (lanes.bits() - 1).into());
        if lanes == Size::S8 {
            self.sse_with_constant(Sse::Por, count, count, 0xff << 64);
            self.sse_binary(shift, dst, src, count);
            self.asm.sse(shift, count, count, count);
            self.sse_with_constant(Sse::Pshufb, count, count, splat(lanes, 8));
            self.sse_binary(Sse::Pand, dst, dst, count);
            if op == VectorShift::I8x16ShrS {
                self.sse_with_constant(Sse::Pavgb, count, count, 0);
            }
        } else if op == VectorShift::I64x2ShrS {
            self.sse_with_constant(Sse::Por, count, count, 1 << 127);
            self.sse_binary(shift, dst, src, count);
            self.asm.sse(shift, count, count, count);
            self.asm.sse(Sse::Punpckhqdq, count, count, count);
        } else {
            self.sse_binary(shift, dst, src, count);
        }
        if let Some(sub) = sign_extension(op) {
            self.sse_binary(Sse::Pxor, dst, dst, count);
            self.asm.sse(sub, dst, dst, count);
        }
    }
}
