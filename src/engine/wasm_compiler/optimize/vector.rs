//! Vectors of 128 bits.

use bun_engine_asm::{
    Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
};
use bun_engine_codegen::ir::{Lanes, Load, Op, Type, Value};
use bun_engine_wasm_format::{LaneType, MemArg, ValType, VectorLoadOp, VisitVector};

use super::translator::{Translator, Visited};

fn lanes(ty: LaneType) -> Lanes {
    match ty {
        LaneType::Int(size) => Lanes::Int(size),
        LaneType::Float(width) => Lanes::Float(width),
    }
}

impl Translator<'_> {
    fn push_vector(&mut self, value: Value) -> Visited {
        self.push(value, ValType::V128);
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVector for Translator<'_> {
    fn v128_const(&mut self, bits: u128) -> Visited {
        let value = self.b.const_v128(bits);
        self.push_vector(value)
    }

    fn vector_load(&mut self, op: VectorLoadOp, arg: MemArg) -> Visited {
        let index = self.pop_value();
        let at = self.locate(index, arg, op.log2_bytes());
        let kind = match op {
            VectorLoadOp::Whole => Load::Full,
            VectorLoadOp::Extend(size, sign) => Load::VectorExtend(size, sign),
            VectorLoadOp::Splat(size) => Load::VectorSplat(size),
            VectorLoadOp::Zero(width) => Load::VectorZero(width.width().size()),
        };
        let value = (self.b).load_vector(kind, at.address, at.offset, at.for_load());
        self.push_vector(value)
    }

    fn vector_store(&mut self, arg: MemArg) -> Visited {
        let [index, vector] = self.pop_values();
        let at = self.locate(index, arg, VectorLoadOp::Whole.log2_bytes());
        self.b.store(vector, at.address, at.offset, at.for_store());
        Ok(())
    }

    fn vector_load_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Visited {
        let [index, vector] = self.pop_values();
        let at = self.locate(index, arg, size.log2_bytes());
        let op = Op::LoadLane {
            lanes: size,
            lane,
            args: [vector, at.address],
            offset: at.offset,
            access: at.for_load(),
        };
        let value = self.b.insert(op, Type::V128);
        self.push_vector(value)
    }

    fn vector_store_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Visited {
        let [index, vector] = self.pop_values();
        let at = self.locate(index, arg, size.log2_bytes());
        let op = Op::StoreLane {
            lanes: size,
            lane,
            args: [vector, at.address],
            offset: at.offset,
            access: at.for_store(),
        };
        self.b.insert(op, Type::Void);
        Ok(())
    }

    fn vector_splat(&mut self, ty: LaneType) -> Visited {
        let scalar = self.pop_value();
        let value = self.b.splat(lanes(ty), scalar);
        self.push_vector(value)
    }

    fn vector_extract_lane(&mut self, ty: LaneType, sign: Sign, lane: u8) -> Visited {
        let vector = self.pop_value();
        let value = self.b.extract_lane(lanes(ty), sign, vector, lane);
        self.push(value, ty.value_type());
        Ok(())
    }

    fn vector_replace_lane(&mut self, ty: LaneType, lane: u8) -> Visited {
        let [vector, scalar] = self.pop_values();
        let value = self.b.replace_lane(lanes(ty), vector, lane, scalar);
        self.push_vector(value)
    }

    fn vector_shuffle(&mut self, lanes: [u8; 16]) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let value = self.b.shuffle(lhs, rhs, lanes);
        self.push_vector(value)
    }

    fn vector_unary(&mut self, op: VectorUnary) -> Visited {
        let operand = self.pop_value();
        let value = self.b.vector_unary(op, operand);
        self.push_vector(value)
    }

    fn vector_binary(&mut self, op: VectorBinary) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let value = self.b.vector_binary(op, lhs, rhs);
        self.push_vector(value)
    }

    fn vector_ternary(&mut self, op: VectorTernary) -> Visited {
        let operands = self.pop_values();
        let value = self.b.vector_ternary(op, operands);
        self.push_vector(value)
    }

    fn vector_shift(&mut self, op: VectorShift) -> Visited {
        let [vector, amount] = self.pop_values();
        let value = self.b.vector_shift(op, vector, amount);
        self.push_vector(value)
    }

    fn vector_reduce(&mut self, op: VectorReduce) -> Visited {
        let vector = self.pop_value();
        let value = self.b.vector_reduce(op, vector);
        self.push(value, ValType::I32);
        Ok(())
    }
}
