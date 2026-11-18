//! Instructions with the prefix 0xFD.

use bun_engine_asm::{
    FloatWidth, Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
};

use super::immediates::Access;
use super::{Decoder, Mode, Purpose};
use crate::error::Error;
use crate::module::Features;
use crate::ops::{LaneType, MemArg, VectorLoadOp};
use crate::visitor::Visitor;

pub(crate) const V128_CONST: u32 = 0x0c;

#[derive(Clone, Copy)]
pub(crate) enum VectorOp {
    Invalid,
    Load(VectorLoadOp),
    Store,
    LoadLane(Size),
    StoreLane(Size),
    Const,
    Shuffle,
    Splat(LaneType),
    Extract(LaneType, Sign),
    Replace(LaneType),
    Unary(VectorUnary),
    Binary(VectorBinary),
    Ternary(VectorTernary),
    Shift(VectorShift),
    Reduce(VectorReduce),
}

const OP_COUNT: usize = 0x114;

/// Each line has the number of its first operation. The others follow.
macro_rules! table {
    ($($first:literal => $($op:expr),+;)*) => {{
        let mut table = [VectorOp::Invalid; OP_COUNT];
        $(let mut next = $first;
        $(assert!(matches!(table[next], VectorOp::Invalid));
        table[next] = $op;
        next += 1;)+
        let _ = next;)*
        table
    }};
}

static OPS: [VectorOp; OP_COUNT] = {
    use FloatWidth::{F32, F64};
    use LaneType::{Float, Int};
    use Sign::{Signed, Unsigned};
    use Size::{S8, S16, S32, S64};
    use VectorBinary as B;
    use VectorLoadOp as L;
    use VectorOp::*;
    use VectorReduce as R;
    use VectorShift as S;
    use VectorTernary as T;
    use VectorUnary as U;

    table! {
        0x00 => Load(L::Whole),
            Load(L::Extend(S8, Signed)), Load(L::Extend(S8, Unsigned)),
            Load(L::Extend(S16, Signed)), Load(L::Extend(S16, Unsigned)),
            Load(L::Extend(S32, Signed)), Load(L::Extend(S32, Unsigned));
        0x07 => Load(L::Splat(S8)), Load(L::Splat(S16)), Load(L::Splat(S32)), Load(L::Splat(S64));
        0x0b => Store, Const, Shuffle, Binary(B::I8x16Swizzle);
        0x0f => Splat(Int(S8)), Splat(Int(S16)), Splat(Int(S32)), Splat(Int(S64)),
            Splat(Float(F32)), Splat(Float(F64));
        0x15 => Extract(Int(S8), Signed), Extract(Int(S8), Unsigned), Replace(Int(S8));
        0x18 => Extract(Int(S16), Signed), Extract(Int(S16), Unsigned), Replace(Int(S16));
        0x1b => Extract(Int(S32), Unsigned), Replace(Int(S32)),
            Extract(Int(S64), Unsigned), Replace(Int(S64));
        0x1f => Extract(Float(F32), Unsigned), Replace(Float(F32)),
            Extract(Float(F64), Unsigned), Replace(Float(F64));
        0x23 => Binary(B::I8x16Eq), Binary(B::I8x16Ne), Binary(B::I8x16LtS), Binary(B::I8x16LtU),
            Binary(B::I8x16GtS), Binary(B::I8x16GtU), Binary(B::I8x16LeS), Binary(B::I8x16LeU),
            Binary(B::I8x16GeS), Binary(B::I8x16GeU);
        0x2d => Binary(B::I16x8Eq), Binary(B::I16x8Ne), Binary(B::I16x8LtS), Binary(B::I16x8LtU),
            Binary(B::I16x8GtS), Binary(B::I16x8GtU), Binary(B::I16x8LeS), Binary(B::I16x8LeU),
            Binary(B::I16x8GeS), Binary(B::I16x8GeU);
        0x37 => Binary(B::I32x4Eq), Binary(B::I32x4Ne), Binary(B::I32x4LtS), Binary(B::I32x4LtU),
            Binary(B::I32x4GtS), Binary(B::I32x4GtU), Binary(B::I32x4LeS), Binary(B::I32x4LeU),
            Binary(B::I32x4GeS), Binary(B::I32x4GeU);
        0x41 => Binary(B::F32x4Eq), Binary(B::F32x4Ne), Binary(B::F32x4Lt), Binary(B::F32x4Gt),
            Binary(B::F32x4Le), Binary(B::F32x4Ge);
        0x47 => Binary(B::F64x2Eq), Binary(B::F64x2Ne), Binary(B::F64x2Lt), Binary(B::F64x2Gt),
            Binary(B::F64x2Le), Binary(B::F64x2Ge);
        0x4d => Unary(U::Not), Binary(B::And), Binary(B::AndNot), Binary(B::Or), Binary(B::Xor),
            Ternary(T::Bitselect), Reduce(R::AnyTrue);
        0x54 => LoadLane(S8), LoadLane(S16), LoadLane(S32), LoadLane(S64);
        0x58 => StoreLane(S8), StoreLane(S16), StoreLane(S32), StoreLane(S64);
        0x5c => Load(L::Zero(F32)), Load(L::Zero(F64)),
            Unary(U::F32x4DemoteF64x2Zero), Unary(U::F64x2PromoteLowF32x4);

        0x60 => Unary(U::I8x16Abs), Unary(U::I8x16Neg), Unary(U::I8x16Popcnt),
            Reduce(R::I8x16AllTrue), Reduce(R::I8x16Bitmask),
            Binary(B::I8x16NarrowI16x8S), Binary(B::I8x16NarrowI16x8U);
        0x67 => Unary(U::F32x4Ceil), Unary(U::F32x4Floor), Unary(U::F32x4Trunc),
            Unary(U::F32x4Nearest);
        0x6b => Shift(S::I8x16Shl), Shift(S::I8x16ShrS), Shift(S::I8x16ShrU);
        0x6e => Binary(B::I8x16Add), Binary(B::I8x16AddSatS), Binary(B::I8x16AddSatU),
            Binary(B::I8x16Sub), Binary(B::I8x16SubSatS), Binary(B::I8x16SubSatU);
        0x74 => Unary(U::F64x2Ceil), Unary(U::F64x2Floor);
        0x76 => Binary(B::I8x16MinS), Binary(B::I8x16MinU), Binary(B::I8x16MaxS),
            Binary(B::I8x16MaxU), Unary(U::F64x2Trunc), Binary(B::I8x16AvgrU);
        0x7c => Unary(U::I16x8ExtAddPairwiseI8x16S), Unary(U::I16x8ExtAddPairwiseI8x16U),
            Unary(U::I32x4ExtAddPairwiseI16x8S), Unary(U::I32x4ExtAddPairwiseI16x8U);

        0x80 => Unary(U::I16x8Abs), Unary(U::I16x8Neg), Binary(B::I16x8Q15MulrSatS),
            Reduce(R::I16x8AllTrue), Reduce(R::I16x8Bitmask),
            Binary(B::I16x8NarrowI32x4S), Binary(B::I16x8NarrowI32x4U);
        0x87 => Unary(U::I16x8ExtendLowI8x16S), Unary(U::I16x8ExtendHighI8x16S),
            Unary(U::I16x8ExtendLowI8x16U), Unary(U::I16x8ExtendHighI8x16U);
        0x8b => Shift(S::I16x8Shl), Shift(S::I16x8ShrS), Shift(S::I16x8ShrU);
        0x8e => Binary(B::I16x8Add), Binary(B::I16x8AddSatS), Binary(B::I16x8AddSatU),
            Binary(B::I16x8Sub), Binary(B::I16x8SubSatS), Binary(B::I16x8SubSatU);
        0x94 => Unary(U::F64x2Nearest), Binary(B::I16x8Mul), Binary(B::I16x8MinS),
            Binary(B::I16x8MinU), Binary(B::I16x8MaxS), Binary(B::I16x8MaxU);
        0x9b => Binary(B::I16x8AvgrU),
            Binary(B::I16x8ExtMulLowI8x16S), Binary(B::I16x8ExtMulHighI8x16S),
            Binary(B::I16x8ExtMulLowI8x16U), Binary(B::I16x8ExtMulHighI8x16U);

        0xa0 => Unary(U::I32x4Abs), Unary(U::I32x4Neg);
        0xa3 => Reduce(R::I32x4AllTrue), Reduce(R::I32x4Bitmask);
        0xa7 => Unary(U::I32x4ExtendLowI16x8S), Unary(U::I32x4ExtendHighI16x8S),
            Unary(U::I32x4ExtendLowI16x8U), Unary(U::I32x4ExtendHighI16x8U);
        0xab => Shift(S::I32x4Shl), Shift(S::I32x4ShrS), Shift(S::I32x4ShrU), Binary(B::I32x4Add);
        0xb1 => Binary(B::I32x4Sub);
        0xb5 => Binary(B::I32x4Mul), Binary(B::I32x4MinS), Binary(B::I32x4MinU),
            Binary(B::I32x4MaxS), Binary(B::I32x4MaxU), Binary(B::I32x4DotI16x8S);
        0xbc => Binary(B::I32x4ExtMulLowI16x8S), Binary(B::I32x4ExtMulHighI16x8S),
            Binary(B::I32x4ExtMulLowI16x8U), Binary(B::I32x4ExtMulHighI16x8U);

        0xc0 => Unary(U::I64x2Abs), Unary(U::I64x2Neg);
        0xc3 => Reduce(R::I64x2AllTrue), Reduce(R::I64x2Bitmask);
        0xc7 => Unary(U::I64x2ExtendLowI32x4S), Unary(U::I64x2ExtendHighI32x4S),
            Unary(U::I64x2ExtendLowI32x4U), Unary(U::I64x2ExtendHighI32x4U);
        0xcb => Shift(S::I64x2Shl), Shift(S::I64x2ShrS), Shift(S::I64x2ShrU), Binary(B::I64x2Add);
        0xd1 => Binary(B::I64x2Sub);
        0xd5 => Binary(B::I64x2Mul), Binary(B::I64x2Eq), Binary(B::I64x2Ne), Binary(B::I64x2LtS),
            Binary(B::I64x2GtS), Binary(B::I64x2LeS), Binary(B::I64x2GeS);
        0xdc => Binary(B::I64x2ExtMulLowI32x4S), Binary(B::I64x2ExtMulHighI32x4S),
            Binary(B::I64x2ExtMulLowI32x4U), Binary(B::I64x2ExtMulHighI32x4U);

        0xe0 => Unary(U::F32x4Abs), Unary(U::F32x4Neg);
        0xe3 => Unary(U::F32x4Sqrt), Binary(B::F32x4Add), Binary(B::F32x4Sub), Binary(B::F32x4Mul),
            Binary(B::F32x4Div), Binary(B::F32x4Min), Binary(B::F32x4Max), Binary(B::F32x4Pmin),
            Binary(B::F32x4Pmax);
        0xec => Unary(U::F64x2Abs), Unary(U::F64x2Neg);
        0xef => Unary(U::F64x2Sqrt), Binary(B::F64x2Add), Binary(B::F64x2Sub), Binary(B::F64x2Mul),
            Binary(B::F64x2Div), Binary(B::F64x2Min), Binary(B::F64x2Max), Binary(B::F64x2Pmin),
            Binary(B::F64x2Pmax);
        0xf8 => Unary(U::I32x4TruncSatF32x4S), Unary(U::I32x4TruncSatF32x4U),
            Unary(U::F32x4ConvertI32x4S), Unary(U::F32x4ConvertI32x4U),
            Unary(U::I32x4TruncSatF64x2SZero), Unary(U::I32x4TruncSatF64x2UZero),
            Unary(U::F64x2ConvertLowI32x4S), Unary(U::F64x2ConvertLowI32x4U);

        0x100 => Binary(B::I8x16RelaxedSwizzle),
            Unary(U::I32x4RelaxedTruncF32x4S), Unary(U::I32x4RelaxedTruncF32x4U),
            Unary(U::I32x4RelaxedTruncF64x2SZero), Unary(U::I32x4RelaxedTruncF64x2UZero);
        0x105 => Ternary(T::F32x4RelaxedMadd), Ternary(T::F32x4RelaxedNmadd),
            Ternary(T::F64x2RelaxedMadd), Ternary(T::F64x2RelaxedNmadd);
        0x109 => Ternary(T::I8x16RelaxedLaneselect), Ternary(T::I16x8RelaxedLaneselect),
            Ternary(T::I32x4RelaxedLaneselect), Ternary(T::I64x2RelaxedLaneselect);
        0x10d => Binary(B::F32x4RelaxedMin), Binary(B::F32x4RelaxedMax),
            Binary(B::F64x2RelaxedMin), Binary(B::F64x2RelaxedMax);
        0x111 => Binary(B::I16x8RelaxedQ15MulrS), Binary(B::I16x8RelaxedDotI8x16I7x16S),
            Ternary(T::I32x4RelaxedDotI8x16I7x16AddS);
    }
};

impl VectorOp {
    #[inline]
    pub(crate) fn from_number(number: u32) -> Self {
        OPS.get(number as usize).copied().unwrap_or(Self::Invalid)
    }
}

impl<M: Mode> Decoder<'_, '_, M> {
    #[inline(never)]
    pub(super) fn vector<V: Visitor<Error = M::Error>>(
        &mut self,
        v: &mut V,
    ) -> Result<(), M::Error> {
        ensure!(
            self,
            self.cx.header.features.contains(Features::SIMD),
            parse,
            "wasm-simd is not enabled"
        );
        let number = read!(self, self.reader.u32(), "can't parse wasm extended opcode");
        match VectorOp::from_number(number) {
            VectorOp::Invalid => fail!(self, parse, "invalid extended simd op {number}"),
            VectorOp::Load(op) => v.vector_load(op, self.mem_arg(Access::Vector, op.log2_bytes())?),
            VectorOp::Store => v.vector_store(self.mem_arg(Access::Vector, 4)?),
            VectorOp::LoadLane(size) => {
                let (arg, lane) = self.lane_access(size)?;
                v.vector_load_lane(size, lane, arg)
            }
            VectorOp::StoreLane(size) => {
                let (arg, lane) = self.lane_access(size)?;
                v.vector_store_lane(size, lane, arg)
            }
            VectorOp::Const => {
                let bytes = read!(
                    self,
                    self.reader.array(),
                    "can't parse 128-bit vector constant"
                );
                v.v128_const(u128::from_le_bytes(bytes))
            }
            VectorOp::Shuffle => {
                let lanes: [u8; 16] = read!(
                    self,
                    self.reader.array(),
                    "can't parse 128-bit shuffle immediate"
                );
                ensure!(self, lanes.iter().all(|&lane| lane < 32), parse, "");
                v.vector_shuffle(lanes)
            }
            VectorOp::Splat(ty) => v.vector_splat(ty),
            VectorOp::Extract(ty, sign) => v.vector_extract_lane(ty, sign, self.lane(ty.size())?),
            VectorOp::Replace(ty) => v.vector_replace_lane(ty, self.lane(ty.size())?),
            VectorOp::Unary(op) => v.vector_unary(op),
            VectorOp::Binary(op) => v.vector_binary(op),
            VectorOp::Ternary(op) => v.vector_ternary(op),
            VectorOp::Shift(op) => v.vector_shift(op),
            VectorOp::Reduce(op) => v.vector_reduce(op),
        }
    }

    #[inline]
    fn lane(&mut self, size: Size) -> Result<u8, M::Error> {
        let lane = read!(
            self,
            self.reader.u8(),
            "Could not parse the lane index immediate byte."
        );
        let count = 16 >> size.log2_bytes();
        ensure!(
            self,
            lane < count,
            parse,
            "Lane index immediate is too large, saw {count}, expected an ImmLaneIdx{count}"
        );
        Ok(lane)
    }

    pub(crate) fn vector_mem_arg(&mut self, size: Size) -> Result<MemArg, M::Error> {
        self.mem_arg(Access::Vector, size.log2_bytes())
    }

    fn lane_access(&mut self, size: Size) -> Result<(MemArg, u8), M::Error> {
        let arg = self.vector_mem_arg(size)?;
        Ok((arg, self.lane(size)?))
    }
}
