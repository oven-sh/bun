//! Vectors of 128 bits.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{
    Bank, Reuse, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
};
use bun_engine_wasm_format::{LaneType, MemArg, ValType, VectorLoadOp, VisitVector};

use super::{Compiled, Function};

const VECTOR_SIZE: u8 = 16;

impl Function<'_> {
    /// `immediates` is the number of bytes that follow the opcode.
    fn vector_result<const N: usize>(
        &mut self,
        immediates: usize,
        operands: [Fpr; N],
        reuse: Reuse,
    ) -> Fpr {
        let free = self.registers.free;
        let is_best =
            |&(index, reg): &(usize, Fpr)| reuse.bits() >> index & 1 != 0 && free.contains(reg);
        let best = operands.into_iter().enumerate().find(is_best);
        let next = self.after_prefixed_opcode() + immediates;
        let reusable = best.map_or(operands[0], |(_, reg)| reg);
        self.result_reusing(next, reusable).fpr()
    }

    fn push_vector(&mut self, reg: Fpr) -> Compiled {
        self.push_register(ValType::V128, reg);
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVector for Function<'_> {
    fn v128_const(&mut self, bits: u128) -> Compiled {
        let next = self.after_prefixed_opcode() + usize::from(VECTOR_SIZE);
        let dst = self.result(next, Bank::Fpr).fpr();
        self.masm.move_vector_constant(dst, bits);
        self.push_vector(dst)
    }

    fn vector_load(&mut self, op: VectorLoadOp, arg: MemArg) -> Compiled {
        let index = self.pop();
        let Some(src) = self.access(arg, 1 << op.log2_bytes(), index) else {
            return Ok(());
        };
        let next = self.after_mem_arg(self.after_prefixed_opcode());
        let dst = self.result(next, Bank::Fpr).fpr();
        match op {
            VectorLoadOp::Whole => self.masm.load_vector(dst, src),
            VectorLoadOp::Extend(from, sign) => self.masm.load_vector_extend(from, sign, dst, src),
            VectorLoadOp::Splat(lanes) => self.masm.load_vector_splat(lanes, dst, src),
            VectorLoadOp::Zero(width) => self.masm.load_float(width, dst, src),
        }
        self.push_vector(dst)
    }

    fn vector_store(&mut self, arg: MemArg) -> Compiled {
        let value = self.pop_fpr();
        let index = self.pop();
        if let Some(dst) = self.access(arg, VECTOR_SIZE, index) {
            self.masm.store_vector(dst, value);
        }
        Ok(())
    }

    fn vector_load_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Compiled {
        let vector = self.pop_fpr();
        let index = self.pop();
        let Some(src) = self.access(arg, size.bytes(), index) else {
            return Ok(());
        };
        let dst = self.reuse(vector).fpr();
        self.masm.load_vector_lane(size, dst, vector, lane, src);
        self.push_vector(dst)
    }

    fn vector_store_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Compiled {
        let vector = self.pop_fpr();
        let index = self.pop();
        if let Some(dst) = self.access(arg, size.bytes(), index) {
            self.masm.store_vector_lane(size, dst, vector, lane);
        }
        Ok(())
    }

    fn vector_splat(&mut self, ty: LaneType) -> Compiled {
        let value = self.pop();
        let src = self.register(value);
        let dst = self.result(self.after_prefixed_opcode(), Bank::Fpr).fpr();
        match ty {
            LaneType::Int(lanes) => self.masm.splat_int(lanes, dst, src.gpr()),
            LaneType::Float(lanes) => self.masm.splat_float(lanes, dst, src.fpr()),
        }
        self.push_vector(dst)
    }

    fn vector_extract_lane(&mut self, ty: LaneType, sign: Sign, lane: u8) -> Compiled {
        let vector = self.pop_fpr();
        let next = self.after_prefixed_opcode() + 1;
        let dst = match ty {
            LaneType::Int(lanes) => {
                let dst = self.result(next, Bank::Gpr);
                (self.masm).extract_int_lane(lanes, sign, dst.gpr(), vector, lane);
                dst
            }
            LaneType::Float(lanes) => {
                let dst = self.result_reusing(next, vector);
                (self.masm).extract_float_lane(lanes, dst.fpr(), vector, lane);
                dst
            }
        };
        self.push_register(ty.value_type(), dst);
        Ok(())
    }

    fn vector_replace_lane(&mut self, ty: LaneType, lane: u8) -> Compiled {
        let value = self.pop();
        let value = self.register(value);
        let vector = self.pop_fpr();
        let dst = self.vector_result(1, [vector], Reuse::FIRST);
        match ty {
            LaneType::Int(lanes) => {
                (self.masm).replace_int_lane(lanes, dst, vector, lane, value.gpr());
            }
            LaneType::Float(lanes) => {
                (self.masm).replace_float_lane(lanes, dst, vector, lane, value.fpr());
            }
        }
        self.push_vector(dst)
    }

    fn vector_shuffle(&mut self, lanes: [u8; 16]) -> Compiled {
        let (rhs, lhs) = (self.pop_fpr(), self.pop_fpr());
        let reuse = MacroAssembler::reuse_for_shuffle(self.env.features, lanes);
        let dst = self.vector_result(lanes.len(), [lhs, rhs], reuse);
        self.masm.vector_shuffle(dst, lhs, rhs, lanes);
        self.push_vector(dst)
    }

    fn vector_unary(&mut self, op: VectorUnary) -> Compiled {
        let src = self.pop_fpr();
        let dst = self.vector_result(0, [src], Reuse::FIRST);
        self.masm.vector_unary(op, dst, src);
        self.push_vector(dst)
    }

    fn vector_binary(&mut self, op: VectorBinary) -> Compiled {
        let (rhs, lhs) = (self.pop_fpr(), self.pop_fpr());
        let reuse = MacroAssembler::reuse_for_binary(self.env.features, op);
        let dst = self.vector_result(0, [lhs, rhs], reuse);
        self.masm.vector_binary(op, dst, lhs, rhs);
        self.push_vector(dst)
    }

    fn vector_ternary(&mut self, op: VectorTernary) -> Compiled {
        let (c, b, a) = (self.pop_fpr(), self.pop_fpr(), self.pop_fpr());
        let reuse = MacroAssembler::reuse_for_ternary(self.env.features, op);
        let dst = self.vector_result(0, [a, b, c], reuse);
        self.masm.vector_ternary(op, dst, a, b, c);
        self.push_vector(dst)
    }

    fn vector_shift(&mut self, op: VectorShift) -> Compiled {
        let amount = self.pop();
        let amount = match amount.constant() {
            Some(amount) => (amount as u8).into(),
            None => bun_engine_asm::Amount::from(self.gpr(amount)),
        };
        let src = self.pop_fpr();
        let dst = self.vector_result(0, [src], Reuse::FIRST);
        self.masm.vector_shift(op, dst, src, amount);
        self.push_vector(dst)
    }

    fn vector_reduce(&mut self, op: VectorReduce) -> Compiled {
        let src = self.pop_fpr();
        let dst = self.result(self.after_prefixed_opcode(), Bank::Gpr).gpr();
        self.masm.vector_reduce(op, dst, src);
        self.push_register(ValType::I32, dst);
        Ok(())
    }
}
