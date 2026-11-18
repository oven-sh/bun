use super::assembler::FprMem;
use super::integer::MacroAssembler;
use super::opcode::{
    AvxUnary, BitCount, Cc, MoveMask, ShiftOp, Sse, SseImm, SseMerge, SseMergeLoad, SseStore,
    SseUnary, SseUnaryImm,
};
use super::shuffle::Plan;
use super::vector_binary::{self, has_fma};
use super::vector_unary::{self, HIGH_HALF_TWICE};
use crate::assembly::{FloatAssembly, Reuse, ScratchNeeds, VectorAssembly};
use crate::features::X64Features;
use crate::label::Label;
use crate::operand::{Address, Amount, FloatWidth, Sign, Size, TestCond, Width};
use crate::register::{Fpr, Gpr};
use crate::vector::lanes::{count, splat};
use crate::vector::pattern::Pattern;
use crate::vector::{Relaxed, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary};

pub(super) fn has_avx2(features: X64Features) -> bool {
    features.contains(X64Features::AVX | X64Features::AVX2)
}

fn has_avx(features: X64Features) -> bool {
    features.contains(X64Features::AVX)
}

fn fprs(fprs: u8) -> ScratchNeeds {
    ScratchNeeds { gprs: 0, fprs }
}

fn without_avx(features: X64Features, reuse: Reuse) -> Reuse {
    if has_avx(features) {
        Reuse::empty()
    } else {
        reuse
    }
}

impl MacroAssembler {
    /// For lanes of 8 and 16 bits.
    fn broadcast(&mut self, lanes: Size, dst: Fpr, src: impl Into<FprMem>) {
        let op = match lanes {
            Size::S8 => AvxUnary::Vpbroadcastb,
            _ => AvxUnary::Vpbroadcastw,
        };
        self.asm.avx_unary(op, dst, src);
    }

    fn splat_first_lane(&mut self, lanes: Size, vector: Fpr) {
        match lanes {
            Size::S8 | Size::S16 if has_avx2(self.asm.features) => {
                self.broadcast(lanes, vector, vector);
            }
            Size::S8 | Size::S16 => {
                let indices = Pattern::duplicate(lanes, 0).bits();
                self.sse_with_constant(Sse::Pshufb, vector, vector, indices);
            }
            Size::S32 => self
                .asm
                .sse_unary_imm(SseUnaryImm::Pshufd, vector, vector, 0),
            Size::S64 => self.asm.sse(Sse::Punpcklqdq, vector, vector, vector),
        }
    }

    /// Stays among the instructions for floats if that takes no move.
    fn permute_floats(&mut self, dst: Fpr, src: Fpr, order: u8) {
        if self.has_avx() || dst == src {
            self.asm.sse_imm(SseImm::Shufps, dst, src, src, order);
        } else {
            self.asm.sse_unary_imm(SseUnaryImm::Pshufd, dst, src, order);
        }
    }

    fn all_lanes_true(&mut self, equal: Sse, dst: Gpr, src: Fpr) {
        let zeros = self.scratch_fpr(0);
        self.zero_op(equal, zeros, src);
        self.set_boolean(dst, false, |masm| {
            masm.asm.sse_unary(SseUnary::Ptest, zeros, zeros);
            Cc::E
        });
    }

    fn signs_of_words(&mut self, dst: Gpr, src: Fpr) {
        let bytes = self.scratch_fpr(0);
        self.zero_vector(bytes);
        if self.has_avx() {
            self.asm.sse(Sse::Packsswb, bytes, src, bytes);
            self.asm.move_mask(MoveMask::Pmovmskb, dst, bytes);
        } else {
            self.asm.sse(Sse::Packsswb, bytes, bytes, src);
            self.asm.move_mask(MoveMask::Pmovmskb, dst, bytes);
            self.asm.shift_imm(ShiftOp::Shr, Size::S32, dst, 8);
        }
    }
}

impl VectorAssembly for MacroAssembler {
    fn move_vector_constant(&mut self, dst: Fpr, bits: u128) {
        let (low32, low64) = (u64::from(bits as u32), bits as u64);
        if bits == u128::MAX {
            self.set_all_bits(dst);
        } else if bits == 0 {
            self.zero_vector(dst);
        } else if bits == low32.into() {
            self.move_float_constant(FloatWidth::F32, dst, low32);
        } else if bits == low64.into() {
            self.move_float_constant(FloatWidth::F64, dst, low64);
        } else if bits == splat(Size::S32, low32) && self.has_avx() {
            let constant = self.asm.constant(low32.into(), 4);
            self.load_vector_splat(Size::S32, dst, constant);
        } else if bits == splat(Size::S64, low64) {
            let constant = self.asm.constant(low64.into(), 8);
            self.load_vector_splat(Size::S64, dst, constant);
        } else {
            let constant = self.asm.constant(bits, 16);
            self.asm.sse_unary(SseUnary::Movaps, dst, constant);
        }
    }

    fn load_vector_extend(&mut self, from: Size, sign: Sign, dst: Fpr, src: Address) {
        let op = match (from, sign) {
            (Size::S8, Sign::Signed) => SseUnary::Pmovsxbw,
            (Size::S8, Sign::Unsigned) => SseUnary::Pmovzxbw,
            (Size::S16, Sign::Signed) => SseUnary::Pmovsxwd,
            (Size::S16, Sign::Unsigned) => SseUnary::Pmovzxwd,
            (Size::S32, Sign::Signed) => SseUnary::Pmovsxdq,
            (Size::S32, Sign::Unsigned) => SseUnary::Pmovzxdq,
            (Size::S64, _) => unreachable!("no lane is larger"),
        };
        self.asm.sse_unary(op, dst, src);
    }

    fn load_vector_splat(&mut self, lanes: Size, dst: Fpr, src: Address) {
        match lanes {
            Size::S8 | Size::S16 if has_avx2(self.asm.features) => self.broadcast(lanes, dst, src),
            Size::S8 | Size::S16 => {
                self.zero_vector(dst);
                self.asm.pinsr(lanes, dst, dst, src, 0);
                self.splat_first_lane(lanes, dst);
            }
            Size::S32 if self.has_avx() => self.asm.avx_unary(AvxUnary::Vbroadcastss, dst, src),
            Size::S32 => {
                self.load_f32(dst, src);
                self.permute_floats(dst, dst, 0);
            }
            Size::S64 => self.asm.sse_unary(SseUnary::Movddup, dst, src),
        }
    }

    fn load_vector_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, src: Address) {
        assert!(lane < count(lanes));
        let vector = self.first_source(dst, vector);
        match (lanes, lane) {
            (Size::S64, 0) => self
                .asm
                .sse_merge_load(SseMergeLoad::Movlps, dst, vector, src),
            (Size::S64, _) => self
                .asm
                .sse_merge_load(SseMergeLoad::Movhps, dst, vector, src),
            _ => self.asm.pinsr(lanes, dst, vector, src, lane),
        }
    }

    fn store_vector_lane(&mut self, lanes: Size, dst: Address, vector: Fpr, lane: u8) {
        assert!(lane < count(lanes));
        match (lanes, lane) {
            (Size::S32, 0) => self.store_f32(dst, vector),
            (Size::S64, 0) => self.store_f64(dst, vector),
            (Size::S64, _) => self.asm.sse_store(SseStore::Movhps, dst, vector),
            _ => self.asm.pextr(lanes, dst, vector, lane),
        }
    }

    fn splat_int(&mut self, lanes: Size, dst: Fpr, src: Gpr) {
        self.asm.movd_to_xmm(lanes.width(), dst, src);
        self.splat_first_lane(lanes, dst);
    }

    fn splat_float(&mut self, lanes: FloatWidth, dst: Fpr, src: Fpr) {
        match lanes {
            FloatWidth::F32 => self.permute_floats(dst, src, 0),
            FloatWidth::F64 => self.asm.sse_unary(SseUnary::Movddup, dst, src),
        }
    }

    fn extract_int_lane(&mut self, lanes: Size, sign: Sign, dst: Gpr, vector: Fpr, lane: u8) {
        assert!(lane < count(lanes));
        let extends_sign = sign == Sign::Signed && lanes < Size::S32;
        if lane == 0 && (extends_sign || lanes >= Size::S32) {
            self.asm.movd_from_xmm(lanes.width(), dst, vector);
        } else {
            self.asm.pextr(lanes, dst, vector, lane);
        }
        if extends_sign {
            self.asm.movsx(lanes, Width::W32, dst, dst);
        }
    }

    fn extract_float_lane(&mut self, lanes: FloatWidth, dst: Fpr, vector: Fpr, lane: u8) {
        assert!(lane < count(lanes.width().size()));
        match (lanes, lane) {
            (_, 0) => self.move_vector(dst, vector),
            (FloatWidth::F32, 1) => self.asm.sse_unary(SseUnary::Movshdup, dst, vector),
            (FloatWidth::F32, _) => self.permute_floats(dst, vector, lane),
            (FloatWidth::F64, _) => self.permute_floats(dst, vector, HIGH_HALF_TWICE),
        }
    }

    fn replace_int_lane(&mut self, lanes: Size, dst: Fpr, vector: Fpr, lane: u8, value: Gpr) {
        assert!(lane < count(lanes));
        let vector = self.first_source(dst, vector);
        self.asm.pinsr(lanes, dst, vector, value, lane);
    }

    fn replace_float_lane(
        &mut self,
        lanes: FloatWidth,
        dst: Fpr,
        vector: Fpr,
        lane: u8,
        value: Fpr,
    ) {
        assert!(lane < count(lanes.width().size()));
        let doublewords = match lanes {
            FloatWidth::F32 => 1 << lane,
            FloatWidth::F64 => 3 << (2 * lane),
        };
        if lane == 0 {
            self.blend(Size::S32, dst, vector, value, doublewords);
        } else if !self.has_avx() && dst == value && dst != vector {
            self.splat_float(lanes, dst, value);
            self.blend(Size::S32, dst, vector, dst, doublewords);
        } else {
            let vector = self.first_source(dst, vector);
            match lanes {
                FloatWidth::F32 => {
                    self.asm
                        .sse_imm(SseImm::Insertps, dst, vector, value, lane << 4);
                }
                FloatWidth::F64 => self.asm.sse_merge(SseMerge::Movlhps, dst, vector, value),
            }
        }
    }

    fn vector_unary(&mut self, op: VectorUnary, dst: Fpr, src: Fpr) {
        self.unary_form(vector_unary::Form::of(op), dst, src);
    }

    fn vector_binary(&mut self, op: VectorBinary, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let (form, reversed) = vector_binary::Form::of(op);
        let (lhs, rhs) = if reversed { (rhs, lhs) } else { (lhs, rhs) };
        self.binary_form(form, dst, lhs, rhs);
    }

    fn vector_ternary(&mut self, op: VectorTernary, dst: Fpr, a: Fpr, b: Fpr, c: Fpr) {
        use FloatWidth::{F32, F64};
        use VectorTernary::*;
        match op {
            Bitselect => self.select_bits(dst, a, b, c),
            F32x4RelaxedMadd => self.mul_add(F32, false, dst, a, b, c),
            F32x4RelaxedNmadd => self.mul_add(F32, true, dst, a, b, c),
            F64x2RelaxedMadd => self.mul_add(F64, false, dst, a, b, c),
            F64x2RelaxedNmadd => self.mul_add(F64, true, dst, a, b, c),
            I8x16RelaxedLaneselect => self.select_lanes(Size::S8, dst, a, b, c),
            I16x8RelaxedLaneselect => self.select_lanes(Size::S16, dst, a, b, c),
            I32x4RelaxedLaneselect => self.select_lanes(Size::S32, dst, a, b, c),
            I64x2RelaxedLaneselect => self.select_lanes(Size::S64, dst, a, b, c),
            I32x4RelaxedDotI8x16I7x16AddS => self.dot_add(dst, a, b, c),
        }
    }

    fn vector_shift(&mut self, op: VectorShift, dst: Fpr, src: Fpr, amount: impl Into<Amount>) {
        match amount.into() {
            Amount::Imm(amount) => self.shift_lanes_by_constant(op, dst, src, amount),
            Amount::Reg(amount) => self.shift_lanes_by_register(op, dst, src, amount),
        }
    }

    fn vector_reduce(&mut self, op: VectorReduce, dst: Gpr, src: Fpr) {
        match op {
            VectorReduce::AnyTrue => self.set_boolean(dst, false, |masm| {
                masm.asm.sse_unary(SseUnary::Ptest, src, src);
                Cc::Ne
            }),
            VectorReduce::I8x16AllTrue => self.all_lanes_true(Sse::Pcmpeqb, dst, src),
            VectorReduce::I16x8AllTrue => self.all_lanes_true(Sse::Pcmpeqw, dst, src),
            VectorReduce::I32x4AllTrue => self.all_lanes_true(Sse::Pcmpeqd, dst, src),
            VectorReduce::I64x2AllTrue => self.all_lanes_true(Sse::Pcmpeqq, dst, src),
            VectorReduce::I8x16Bitmask => self.asm.move_mask(MoveMask::Pmovmskb, dst, src),
            VectorReduce::I16x8Bitmask => self.signs_of_words(dst, src),
            VectorReduce::I32x4Bitmask => self.asm.move_mask(MoveMask::Movmskps, dst, src),
            VectorReduce::I64x2Bitmask => self.asm.move_mask(MoveMask::Movmskpd, dst, src),
        }
    }

    fn vector_shuffle(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr, lanes: [u8; 16]) {
        let pattern = Pattern::new(lanes);
        let pattern = if lhs == rhs {
            pattern.folded()
        } else {
            pattern
        };
        self.shuffle(Plan::new(self.asm.features, pattern), dst, lhs, rhs);
    }

    fn branch_test_vector(&mut self, cond: TestCond, vector: Fpr, target: Label) {
        assert!(matches!(cond, TestCond::Zero | TestCond::NonZero));
        self.asm.sse_unary(SseUnary::Ptest, vector, vector);
        self.asm.jcc(cond.into(), target);
    }

    const BYTE_MASK_SHIFT: u8 = 0;

    fn move_byte_mask(&mut self, dst: Gpr, mask: Fpr) {
        self.asm.move_mask(MoveMask::Pmovmskb, dst, mask);
    }

    fn first_in_byte_mask(&mut self, dst: Gpr, mask: Gpr) {
        let op = if self.asm.has(X64Features::BMI1) {
            BitCount::Tzcnt
        } else {
            BitCount::Bsf
        };
        self.asm.bit_count(op, Width::W32, dst, mask);
    }

    fn narrow_to_bytes(&mut self, sign: Sign, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let op = match sign {
            Sign::Signed => Sse::Packsswb,
            Sign::Unsigned => Sse::Packuswb,
        };
        self.sse_binary(op, dst, lhs, rhs);
    }

    fn test_bit_in_bytes(&mut self, dst: Fpr, value: Fpr, bit: Fpr) {
        let common = self.dst_unless(dst, bit);
        self.sse_binary(Sse::Pand, common, value, bit);
        self.sse_binary(Sse::Pcmpeqb, dst, common, bit);
    }

    fn relaxed(features: X64Features) -> Relaxed {
        let mut relaxed = Relaxed::SECOND_OPERAND_MIN_MAX
            | Relaxed::WRAPPING_Q15
            | Relaxed::UNSATURATED_TRUNC
            | Relaxed::WRAPPING_SWIZZLE
            | Relaxed::UNSIGNED_DOT;
        relaxed.set(Relaxed::FUSED_MADD, has_fma(features));
        relaxed.set(Relaxed::TOP_BIT_LANESELECT, has_avx(features));
        relaxed
    }

    fn scratch_for_unary(_: X64Features, op: VectorUnary) -> ScratchNeeds {
        fprs(vector_unary::Form::of(op).scratch_fprs())
    }

    fn scratch_for_binary(features: X64Features, op: VectorBinary) -> ScratchNeeds {
        let (form, _) = vector_binary::Form::of(op);
        fprs(form.scratch_fprs(has_avx(features)))
    }

    fn scratch_for_ternary(features: X64Features, op: VectorTernary) -> ScratchNeeds {
        use VectorTernary::*;
        let is_one_instruction = match op {
            F32x4RelaxedMadd | F32x4RelaxedNmadd | F64x2RelaxedMadd | F64x2RelaxedNmadd => {
                has_fma(features)
            }
            I8x16RelaxedLaneselect | I32x4RelaxedLaneselect | I64x2RelaxedLaneselect => {
                has_avx(features)
            }
            Bitselect | I16x8RelaxedLaneselect | I32x4RelaxedDotI8x16I7x16AddS => false,
        };
        fprs((!is_one_instruction).into())
    }

    fn scratch_for_shift(_: X64Features, op: VectorShift, by_constant: bool) -> ScratchNeeds {
        fprs((!by_constant || op == VectorShift::I8x16ShrS).into())
    }

    fn scratch_for_reduce(_: X64Features, op: VectorReduce) -> ScratchNeeds {
        use VectorReduce::*;
        fprs((!matches!(op, AnyTrue | I8x16Bitmask | I32x4Bitmask | I64x2Bitmask)).into())
    }

    fn scratch_for_shuffle(features: X64Features, lanes: [u8; 16]) -> ScratchNeeds {
        fprs(Plan::new(features, Pattern::new(lanes)).scratch_fprs(has_avx(features)))
    }

    fn scratch_for_branch_test(_: X64Features) -> ScratchNeeds {
        fprs(0)
    }

    fn reuse_for_unary(features: X64Features, op: VectorUnary) -> Reuse {
        let mut reuse = Reuse::empty();
        reuse.set(
            Reuse::FIRST,
            vector_unary::Form::of(op).starts_with_a_copy(),
        );
        without_avx(features, reuse)
    }

    fn reuse_for_binary(features: X64Features, op: VectorBinary) -> Reuse {
        let (form, reversed) = vector_binary::Form::of(op);
        let reuse = form.reuse();
        if reversed && reuse == Reuse::FIRST {
            without_avx(features, Reuse::SECOND)
        } else {
            without_avx(features, reuse)
        }
    }

    fn reuse_for_ternary(features: X64Features, op: VectorTernary) -> Reuse {
        use VectorTernary::*;
        match op {
            F32x4RelaxedMadd | F32x4RelaxedNmadd | F64x2RelaxedMadd | F64x2RelaxedNmadd
                if has_fma(features) =>
            {
                Reuse::all()
            }
            F32x4RelaxedMadd | F64x2RelaxedMadd => {
                without_avx(features, Reuse::FIRST | Reuse::SECOND)
            }
            F32x4RelaxedNmadd | F64x2RelaxedNmadd => without_avx(features, Reuse::THIRD),
            I32x4RelaxedDotI8x16I7x16AddS => without_avx(features, Reuse::SECOND),
            _ => without_avx(features, Reuse::FIRST),
        }
    }

    fn reuse_for_shift(features: X64Features) -> Reuse {
        without_avx(features, Reuse::FIRST)
    }

    fn reuse_for_shuffle(features: X64Features, lanes: [u8; 16]) -> Reuse {
        Plan::new(features, Pattern::new(lanes)).reuse(has_avx(features))
    }

    fn reuse_for_replace_lane(features: X64Features) -> Reuse {
        without_avx(features, Reuse::FIRST)
    }
}
