//! Vectors of 128 bits.

use bun_engine_asm::{
    Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
};
use bun_engine_wasm_format::{LaneType, MemArg, ValKind, VectorLoadOp, VisitVector};

use super::emit::Register;
use super::operands::{Effect, pair, usual};
use super::{Done, Translator};
use crate::run::{moves, vector};

const V128: ValKind = ValKind::V128;

fn halves(bits: u128) -> [u64; 2] {
    [bits as u64, (bits >> 64) as u64]
}

#[deny(clippy::missing_trait_methods)]
impl VisitVector for Translator<'_> {
    fn v128_const(&mut self, bits: u128) -> Done {
        self.produce_with(usual(V128), moves::vector_constant, 0, 0, &halves(bits))
    }

    fn vector_load(&mut self, op: VectorLoadOp, arg: MemArg) -> Done {
        let address = self.pop();
        let address = self.address_in_slot(arg, address)?;
        let handler = vector::for_load(op, address.access, address.source);
        self.produce_with(
            usual(V128),
            handler,
            address.slot,
            address.imm,
            address.more(),
        )
    }

    fn vector_store(&mut self, arg: MemArg) -> Done {
        let (value, address) = (self.pop(), self.pop());
        let (value, address) = (self.in_slot(value, 1)?, self.address_in_slot(arg, address)?);
        self.emit_store(
            vector::for_store(address.access, address.source),
            address,
            value,
        )
    }

    fn vector_load_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Done {
        let (value, address) = (self.pop(), self.pop());
        let (value, address) = (self.in_slot(value, 1)?, self.address_in_slot(arg, address)?);
        let rest = pair(value, lane.into()).into();
        let more = [address.more().first().copied().unwrap_or(rest), rest];
        let (handler, more) = (
            vector::for_load_lane(size, address.access),
            &more[..=address.more().len()],
        );
        self.produce_with(usual(V128), handler, address.slot, address.imm, more)
    }

    fn vector_store_lane(&mut self, size: Size, lane: u8, arg: MemArg) -> Done {
        let (value, address) = (self.pop(), self.pop());
        let (value, address) = (self.in_slot(value, 1)?, self.address_in_slot(arg, address)?);
        self.emit_store(vector::for_store_lane(size, address.access), address, value)?;
        self.extend(pair(0, lane.into()), 0)
    }

    fn vector_splat(&mut self, ty: LaneType) -> Done {
        let [value] = self.pop_in_slots()?;
        self.produce(V128, vector::for_splat(ty.size()), value, 0)
    }

    fn vector_extract_lane(&mut self, ty: LaneType, sign: Sign, lane: u8) -> Done {
        let [value] = self.pop_in_slots()?;
        let result = (ty.value_type().kind(), Effect::Sets(Register::Int));
        let handler = vector::for_extract_lane(ty.size(), sign);
        self.produce_with(result, handler, value, lane.into(), &[])
    }

    fn vector_replace_lane(&mut self, ty: LaneType, lane: u8) -> Done {
        let [whole, value] = self.pop_in_slots()?;
        let handler = vector::for_replace_lane(ty.size());
        self.produce(V128, handler, whole, pair(value, lane.into()))
    }

    fn vector_shuffle(&mut self, lanes: [u8; 16]) -> Done {
        let ([lhs, rhs], lanes) = (self.pop_in_slots()?, halves(u128::from_le_bytes(lanes)));
        self.produce_with(usual(V128), vector::shuffle, lhs, rhs.into(), &lanes)
    }

    fn vector_unary(&mut self, op: VectorUnary) -> Done {
        let [value] = self.pop_in_slots()?;
        self.produce(V128, vector::for_unary(op), value, 0)
    }

    fn vector_binary(&mut self, op: VectorBinary) -> Done {
        let [lhs, rhs] = self.pop_in_slots()?;
        self.produce(V128, vector::for_binary(op), lhs, rhs.into())
    }

    fn vector_ternary(&mut self, op: VectorTernary) -> Done {
        let [a, b, c] = self.pop_in_slots()?;
        self.produce(V128, vector::for_ternary(op), a, pair(b, c))
    }

    fn vector_shift(&mut self, op: VectorShift) -> Done {
        let [value, amount] = self.pop_in_slots()?;
        self.produce(V128, vector::for_shift(op), value, amount.into())
    }

    fn vector_reduce(&mut self, op: VectorReduce) -> Done {
        let [value] = self.pop_in_slots()?;
        self.produce(ValKind::I32, vector::for_reduce(op), value, 0)
    }
}
