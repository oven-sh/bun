use super::immediate::FloatImm;
use super::macro_assembler::MacroAssembler;
use super::neon::VectorImm;
use super::neon_opcode::{Arrangement, NeonBinary, NeonFloatBinary, NeonPermute, NeonShiftNarrow};
use super::shuffle::Plan;
use super::vector_arithmetic::Binary;
use crate::assembly::{FloatAssembly, MacroAssembly, Reuse, ScratchNeeds, VectorAssembly};
use crate::features::Arm64Features;
use crate::label::Label;
use crate::operand::{Address, Amount, FloatWidth, Sign, Size, TestCond, Width};
use crate::register::{Fpr, Gpr};
use crate::vector::pattern::Pattern;
use crate::vector::{Relaxed, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary};

fn fprs(fprs: u8) -> ScratchNeeds {
    ScratchNeeds { gprs: 0, fprs }
}

impl MacroAssembler {
    /// Lane 0 of `dst` goes to `lane`, and the others come from `vector`.
    fn fill_in_around_float(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8) {
        if lane != 0 {
            self.asm.ins_element(lanes, dst, lane, dst, 0);
        }
        if lanes == Size::S32 {
            self.asm.ins_element(lanes, dst, lane ^ 1, vector, lane ^ 1);
        }
        let other_half = (lane * lanes.bytes() / 8) ^ 1;
        self.asm
            .ins_element(Size::S64, dst, other_half, vector, other_half);
    }
}

impl VectorAssembly for MacroAssembler {
    fn move_vector_constant(&mut self, dst: Fpr, bits: u128) {
        if let Some(imm) = VectorImm::new(bits) {
            return self.asm.movi(dst, imm);
        }
        let width = match bits.leading_zeros() {
            96.. => FloatWidth::F32,
            64.. => FloatWidth::F64,
            _ => return self.asm.ldr_fpr_constant(dst, bits, 16),
        };
        match FloatImm::new(width, bits as u64) {
            Some(imm) => self.asm.fmov_imm(dst, imm),
            None => self
                .asm
                .ldr_fpr_constant(dst, bits, width.width().size().bytes()),
        }
    }

    fn load_vector_extend(&mut self, from: Size, sign: Sign, dst: Fpr, src: Address) {
        self.load_f64(dst, src);
        self.asm
            .neon_shift_long(sign, Arrangement::half(from), dst, dst, 0);
    }

    fn load_vector_splat(&mut self, lanes: Size, dst: Fpr, src: Address) {
        let shape = Arrangement::full(lanes);
        if src == Address::new(src.base, 0) {
            return self.asm.ld1r(shape, dst, src.base);
        }
        let src = self.mem(lanes, src);
        self.asm.ldr_fpr(dst, src);
        self.asm.dup_element(shape, dst, dst, 0);
    }

    fn load_vector_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, src: Address) {
        let base = self.base_register(src);
        self.move_vector(dst, vector);
        self.asm.ld1_lane(lanes, dst, lane, base);
    }

    fn store_vector_lane(&mut self, lanes: Size, dst: Address, vector: Fpr, lane: u8) {
        if lane == 0 {
            let dst = self.mem(lanes, dst);
            return self.asm.str_fpr(vector, dst);
        }
        let base = self.base_register(dst);
        self.asm.st1_lane(lanes, vector, lane, base);
    }

    fn splat_int(&mut self, lanes: Size, dst: Fpr, src: Gpr) {
        self.asm.dup_gpr(Arrangement::full(lanes), dst, src);
    }

    fn splat_float(&mut self, lanes: FloatWidth, dst: Fpr, src: Fpr) {
        self.asm
            .dup_element(Arrangement::of_floats(lanes), dst, src, 0);
    }

    fn extract_int_lane(&mut self, lanes: Size, sign: Sign, dst: Gpr, vector: Fpr, lane: u8) {
        if sign == Sign::Signed && lanes < Size::S32 {
            self.asm.smov(lanes, Width::W32, dst, vector, lane);
        } else {
            self.asm.umov(lanes, dst, vector, lane);
        }
    }

    fn extract_float_lane(&mut self, lanes: FloatWidth, dst: Fpr, vector: Fpr, lane: u8) {
        if lane == 0 {
            self.move_float(dst, vector);
        } else {
            self.asm.dup_scalar(lanes.width().size(), dst, vector, lane);
        }
    }

    fn replace_int_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, value: Gpr) {
        self.move_vector(dst, vector);
        self.asm.ins_gpr(lanes, dst, lane, value);
    }

    fn replace_float_lane(
        &mut self,
        lanes: FloatWidth,
        dst: Fpr,
        vector: Fpr,
        lane: u8,
        value: Fpr,
    ) {
        let lanes = lanes.width().size();
        if (lanes, lane) == (Size::S64, 1) {
            self.asm
                .neon_permute(NeonPermute::Zip1, Arrangement::D2, dst, vector, value);
        } else if dst == value && dst != vector {
            self.fill_in_around_float(lanes, dst, vector, lane);
        } else {
            self.move_vector(dst, vector);
            self.asm.ins_element(lanes, dst, lane, value, 0);
        }
    }

    fn vector_unary(&mut self, op: VectorUnary, dst: Fpr, src: Fpr) {
        self.unary_lanes(op, dst, src);
    }

    fn vector_binary(&mut self, op: VectorBinary, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.binary_lanes(op, dst, lhs, rhs);
    }

    fn vector_ternary(&mut self, op: VectorTernary, dst: Fpr, a: Fpr, b: Fpr, c: Fpr) {
        use NeonFloatBinary::{Fmla, Fmls};
        use VectorTernary::*;
        let (op, shape) = match op {
            F32x4RelaxedMadd => (Fmla, Arrangement::S4),
            F32x4RelaxedNmadd => (Fmls, Arrangement::S4),
            F64x2RelaxedMadd => (Fmla, Arrangement::D2),
            F64x2RelaxedNmadd => (Fmls, Arrangement::D2),
            I32x4RelaxedDotI8x16I7x16AddS => return self.dot_add(dst, a, b, c),
            Bitselect
            | I8x16RelaxedLaneselect
            | I16x8RelaxedLaneselect
            | I32x4RelaxedLaneselect
            | I64x2RelaxedLaneselect => return self.select_bits(dst, a, b, c),
        };
        self.accumulate(dst, [a, b, c], |masm, sum| {
            masm.asm.neon_float(op, shape, sum, a, b);
        });
    }

    fn vector_shift(&mut self, op: VectorShift, dst: Fpr, src: Fpr, amount: impl Into<Amount>) {
        match amount.into() {
            Amount::Imm(amount) => self.shift_lanes_by_constant(op, dst, src, amount),
            Amount::Reg(amount) => self.shift_lanes_by_register(op, dst, src, amount),
        }
    }

    fn vector_reduce(&mut self, op: VectorReduce, dst: Gpr, src: Fpr) {
        self.reduce_lanes(op, dst, src);
    }

    fn vector_shuffle(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr, lanes: [u8; 16]) {
        self.shuffle(Pattern::new(lanes), dst, lhs, rhs);
    }

    fn branch_test_vector(&mut self, cond: TestCond, vector: Fpr, target: Label) {
        let folded = self.data_scratch();
        self.fold_to_gpr(folded, vector);
        match cond {
            TestCond::Zero => self.asm.cbz(Width::W64, folded, target),
            TestCond::NonZero => self.asm.cbnz(Width::W64, folded, target),
            TestCond::Negative | TestCond::NonNegative => unreachable!("a vector has no sign"),
        }
    }

    const BYTE_MASK_SHIFT: u8 = 2;

    fn move_byte_mask(&mut self, dst: Gpr, mask: Fpr) {
        let nibbles = self.scratch_fpr(0);
        self.asm
            .neon_shift_narrow(NeonShiftNarrow::Shrn, Arrangement::B8, nibbles, mask, 4);
        self.move_f64_to_bits(dst, nibbles);
    }

    fn first_in_byte_mask(&mut self, dst: Gpr, mask: Gpr) {
        self.count_trailing_zeros64(dst, mask);
        self.shr32(dst, dst, Self::BYTE_MASK_SHIFT);
    }

    fn narrow_to_bytes(&mut self, _: Sign, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .neon_permute(NeonPermute::Uzp1, Arrangement::B16, dst, lhs, rhs);
    }

    fn test_bit_in_bytes(&mut self, dst: Fpr, value: Fpr, bit: Fpr) {
        self.asm
            .neon(NeonBinary::Cmtst, Arrangement::B16, dst, value, bit);
    }

    fn relaxed(features: Arm64Features) -> Relaxed {
        let mut relaxed = Relaxed::FUSED_MADD;
        relaxed.set(
            Relaxed::WIDE_DOT_ADD,
            features.contains(Arm64Features::DOTPROD),
        );
        relaxed
    }

    fn scratch_for_unary(_: Arm64Features, _: VectorUnary) -> ScratchNeeds {
        fprs(0)
    }

    fn scratch_for_binary(_: Arm64Features, op: VectorBinary) -> ScratchNeeds {
        fprs(Binary::of(op).scratch_fprs())
    }

    fn scratch_for_ternary(features: Arm64Features, op: VectorTernary) -> ScratchNeeds {
        match op {
            VectorTernary::I32x4RelaxedDotI8x16I7x16AddS => {
                fprs(2 - u8::from(features.contains(Arm64Features::DOTPROD)))
            }
            _ => fprs(op.nan_lanes().is_some().into()),
        }
    }

    fn scratch_for_shift(_: Arm64Features, _: VectorShift, by_constant: bool) -> ScratchNeeds {
        let each = u8::from(!by_constant);
        ScratchNeeds {
            gprs: each,
            fprs: each,
        }
    }

    fn scratch_for_reduce(_: Arm64Features, op: VectorReduce) -> ScratchNeeds {
        use VectorReduce::*;
        fprs(1 + u8::from(matches!(op, I8x16Bitmask | I16x8Bitmask | I32x4Bitmask)))
    }

    fn scratch_for_shuffle(_: Arm64Features, lanes: [u8; 16]) -> ScratchNeeds {
        fprs(Plan::scratch_fprs(Pattern::new(lanes)))
    }

    fn scratch_for_branch_test(_: Arm64Features) -> ScratchNeeds {
        ScratchNeeds { gprs: 1, fprs: 1 }
    }

    fn reuse_for_unary(_: Arm64Features, _: VectorUnary) -> Reuse {
        Reuse::empty()
    }

    fn reuse_for_binary(_: Arm64Features, _: VectorBinary) -> Reuse {
        Reuse::empty()
    }

    fn reuse_for_ternary(_: Arm64Features, op: VectorTernary) -> Reuse {
        if op.nan_lanes().is_some() || op == VectorTernary::I32x4RelaxedDotI8x16I7x16AddS {
            Reuse::THIRD
        } else {
            Reuse::all()
        }
    }

    fn reuse_for_shift(_: Arm64Features) -> Reuse {
        Reuse::empty()
    }

    fn reuse_for_shuffle(_: Arm64Features, lanes: [u8; 16]) -> Reuse {
        Plan::new(Pattern::new(lanes)).reuse()
    }

    fn reuse_for_replace_lane(_: Arm64Features) -> Reuse {
        Reuse::FIRST
    }
}
