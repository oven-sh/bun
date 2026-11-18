//! Turns instructions into bytes.

use bun_engine_asm::arm64::{
    AccessSize, AddSub, ArithmeticImm, Arrangement, Assembler, Bitfield, BitmaskImm, Cc, Extend,
    FP, FloatFlags, IndexExtend, LR, Logical, MacroAssembler, Mem as Encoded, MultiplyAdd,
    MultiplyAddLong, NeonBinary, NeonBitwise, NeonByElement, SP, Select, ShiftOp, V30, ZR, abi,
};
use bun_engine_asm::{
    Address, Arm64Features, AtomicOp, Bank, FloatAssembly, Gpr, Label, MacroAssembly, RegisterSet,
    Scratch, ScratchNeeds, Sign, Size, TestCond, VectorAssembly, Width,
};

use super::access::{ADDRESS, Accesses, DATA, VECTOR};
use super::flags::KnownFlags;
use super::instruction::{Accumulation, Addend, Inst, Mask, Setting, Test, ZERO};
use super::memory::size_of;
use crate::client::{Client, Frame};
use crate::ir::{Function, Location, Type, Unary};
use crate::machine::{
    Alignment, Class, Emitter, Isa, Operands, Registers, Shared, SharesInstructions,
};

const RESERVED_ONLY: Scratch = Scratch {
    gprs: [Some(DATA), Some(ADDRESS)],
    fprs: [Some(VECTOR), None],
};
const TRAP: u16 = 1;

#[inline]
fn gpr(operands: &mut Operands<'_>) -> Gpr {
    match operands.assigned() {
        ZERO => ZR,
        number => Gpr::new(number),
    }
}

/// The operands start with the left one.
#[inline]
fn add_sub(
    asm: &mut Assembler,
    op: AddSub,
    width: Width,
    dst: Gpr,
    rhs: Addend,
    operands: &mut Operands<'_>,
) {
    let lhs = gpr(operands);
    match rhs {
        Addend::Imm(imm) => asm.add_sub_imm(op, width, dst, lhs, imm),
        Addend::Shifted(shift, amount) => {
            asm.add_sub_shifted(op, width, dst, lhs, gpr(operands), shift, amount);
        }
        Addend::Extended(extend, amount) => {
            asm.add_sub_extended(op, width, dst, lhs, gpr(operands), extend, amount);
        }
    }
}

#[inline]
fn logical(asm: &mut Assembler, op: Logical, dst: Gpr, rhs: Mask, operands: &mut Operands<'_>) {
    let lhs = gpr(operands);
    match rhs {
        Mask::Imm(imm) => asm.logical_imm(op, dst, lhs, imm),
        Mask::Shifted(width, shift, amount) => {
            asm.logical_shifted(op, width, dst, lhs, gpr(operands), shift, amount);
        }
    }
}

fn set_flags(asm: &mut Assembler, setting: Setting, operands: &mut Operands<'_>) {
    match setting {
        Setting::Compare(op, width, rhs) => add_sub(asm, op, width, ZR, rhs, operands),
        Setting::TestBits(op, rhs) => logical(asm, op, ZR, rhs, operands),
        Setting::NumberedBit(width) => {
            asm.shift(ShiftOp::Lsr, width, DATA, operands.gpr(), operands.gpr());
            asm.tst_imm(DATA, const { BitmaskImm::new(Width::W32, 1).unwrap() });
        }
        Setting::Floats(width) => asm.fcmp(width, operands.fpr(), operands.fpr()),
        Setting::Zero(width) | Setting::Sign(width) => {
            asm.cmp_imm(width, operands.gpr(), ArithmeticImm::ZERO);
        }
        Setting::FloatZero(width) => asm.fcmp_zero(width, operands.fpr()),
    }
}

fn jump_if(masm: &mut MacroAssembler, test: Test, operands: &mut Operands<'_>, target: Label) {
    let asm = masm.assembler();
    match test {
        Test::Flags(FloatFlags::One(cc)) => asm.b_cond(cc, target),
        Test::Flags(FloatFlags::Either(first, second)) => {
            asm.b_cond(first, target);
            asm.b_cond(second, target);
        }
        Test::Zero(width) => asm.cbz(width, operands.gpr(), target),
        Test::NotZero(width) => asm.cbnz(width, operands.gpr(), target),
        Test::BitClear(bit) => asm.tbz(operands.gpr(), bit, target),
        Test::BitSet(bit) => asm.tbnz(operands.gpr(), bit, target),
        Test::VectorZero => masm.branch_test_vector(TestCond::Zero, operands.fpr(), target),
        Test::VectorNotZero => masm.branch_test_vector(TestCond::NonZero, operands.fpr(), target),
        Test::NumberedBitClear(width) => {
            asm.shift(ShiftOp::Lsr, width, DATA, operands.gpr(), operands.gpr());
            asm.tbz(DATA, 0, target);
        }
        Test::NumberedBitSet(width) => {
            asm.shift(ShiftOp::Lsr, width, DATA, operands.gpr(), operands.gpr());
            asm.tbnz(DATA, 0, target);
        }
    }
}

/// `select` takes `then`, `or` and a condition, and writes `dst`.
fn select_on<R: Copy + PartialEq>(
    flags: FloatFlags,
    [dst, then, or]: [R; 3],
    mut select: impl FnMut(R, R, Cc),
) {
    let (flags, then, or) = if dst == then {
        (flags.inverted(), or, then)
    } else {
        (flags, then, or)
    };
    match flags {
        FloatFlags::One(cc) => select(then, or, cc),
        FloatFlags::Either(first, second) => {
            select(then, or, first);
            select(then, dst, second);
        }
    }
}

fn long_multiplication(sign: Sign) -> MultiplyAddLong {
    match sign {
        Sign::Signed => MultiplyAddLong::Smaddl,
        Sign::Unsigned => MultiplyAddLong::Umaddl,
    }
}

fn compare_with_lower_half(asm: &mut Assembler, reg: Gpr) {
    asm.add_sub_extended(AddSub::Subs, Width::W64, ZR, reg, reg, Extend::Sxtw, 0);
}

impl SharesInstructions for Inst {
    const RESERVED: ScratchNeeds = ScratchNeeds { gprs: 2, fprs: 1 };

    fn shared(shared: Shared) -> Self {
        Self::Shared(shared)
    }

    fn scratch_for_unary(_: Arm64Features, _: Unary, _: Type, _: Type) -> ScratchNeeds {
        Self::RESERVED
    }
}

impl Isa for Inst {
    type Masm = MacroAssembler;
    type Flags = KnownFlags;

    fn registers(function: &Function) -> Registers {
        const RESERVED: RegisterSet = RegisterSet::of(&[DATA, ADDRESS, FP, LR, SP], &[VECTOR]);
        Registers {
            allocatable: abi::ALL - RESERVED - function.pinned,
            kept_by_calls: abi::CALLEE_SAVED,
            swaps_gprs: false,
            addresses_float_constants: false,
        }
    }

    fn is_jump(self) -> bool {
        matches!(self, Self::Jump)
    }

    fn prepare(masm: &mut MacroAssembler) {
        masm.set_scratch(RESERVED_ONLY);
    }

    #[inline]
    fn flags_after_move(flags: KnownFlags, _: Location, _: Location) -> KnownFlags {
        flags
    }

    fn align(masm: &mut MacroAssembler, purpose: Alignment, _: Label) {
        if purpose != Alignment::Run {
            masm.align(16, 12);
        }
    }

    fn scratch(bank: Bank) -> Location {
        match bank {
            Bank::Gpr => Location::Gpr(DATA),
            Bank::Fpr => Location::Fpr(VECTOR),
        }
    }

    fn lend_scratch(masm: &mut MacroAssembler, clobbered: RegisterSet) -> Scratch {
        masm.assembler().keep_what_is_there();
        masm.set_scratch(Scratch {
            fprs: [Some(VECTOR), clobbered.contains(V30).then_some(V30)],
            ..RESERVED_ONLY
        })
    }

    fn recover(masm: &mut MacroAssembler, instruction: Self, mut operands: Operands<'_>) {
        let (asm, dst) = (masm.assembler(), operands.gpr());
        match instruction {
            Self::CheckedAddSub(op, width, rhs) => {
                add_sub(asm, op.opposite(), width, dst, rhs, &mut operands);
            }
            Self::CheckedNeg(width) => asm.neg(width, dst, dst),
            _ => unreachable!("keeps its operands"),
        }
    }

    fn emit_move(
        masm: &mut MacroAssembler,
        function: &Function,
        frame: &Frame,
        from: Location,
        to: Location,
        class: Class,
    ) {
        Accesses::new(masm, function, frame).move_between(from, to, class);
    }

    fn emit<C: Client<MacroAssembler>>(
        emitter: &mut Emitter<'_, Self, C>,
        instruction: Self,
        mut operands: Operands<'_>,
    ) {
        let (function, frame) = (emitter.places.function, emitter.frame);
        let stand_in = emitter.flags.stand_in;
        if instruction.makes_flags_unknown() {
            emitter.flags = KnownFlags::default();
        }
        let o = &mut operands;
        let mut memory = Accesses::new(emitter.masm, function, frame);
        let asm = memory.masm.assembler();
        match instruction {
            Self::Copy => {
                let (class, to, from) = (o.class_of_next(), o.location(), o.location());
                if from != to {
                    memory.move_between(from, to, class);
                }
            }
            Self::ZeroExtend => match (o.gpr(), o.location()) {
                (dst, Location::Gpr(src)) => asm.mov(Width::W32, dst, src),
                (dst, Location::Constant(bits)) => {
                    let low = (bits.get() as u32).into();
                    memory.masm.move_constant(Width::W32, dst, low);
                }
                (dst, from @ Location::Frame(_)) => {
                    memory.load_location(AccessSize::S32, dst, from)
                }
                (dst, from) => {
                    memory.load_location(AccessSize::S64, dst, from);
                    memory.masm.assembler().mov(Width::W32, dst, dst);
                }
            },
            Self::Jump => emitter.jump(),
            Self::Return => {
                if frame.size == 0 {
                    emitter.masm.pop_pair(FP, LR);
                } else {
                    emitter.masm.leave_frame();
                }
                emitter.masm.ret();
            }
            Self::Unreachable => asm.brk(TRAP),
            Self::Patchpoint => emitter.patchpoint(operands),
            Self::StoreOutgoing(offset, ty) => {
                let offset = memory.outgoing(offset);
                memory.store_location(size_of(ty), o.location(), offset);
            }
            Self::StoreResult(offset, ty) => {
                memory.store_location(size_of(ty), o.location(), offset);
            }
            Self::LoadOutgoing(offset, ty) if ty.is_int() => {
                memory.load_frame(size_of(ty), o.gpr(), memory.outgoing(offset));
            }
            Self::LoadOutgoing(offset, ty) => {
                memory.load_frame_fpr(size_of(ty), o.fpr(), memory.outgoing(offset));
            }
            Self::Shared(shared) => shared.emit::<Self>(emitter.masm, operands),
            Self::Vector(instruction) => instruction.emit::<Self>(emitter.masm, operands),

            Self::AddSub(op, width, rhs) => add_sub(asm, op, width, o.gpr(), rhs, o),
            Self::Logical(op, rhs) => logical(asm, op, o.gpr(), rhs, o),
            Self::Shift(op, width, is_negated) => {
                let (dst, src, mut amount) = (o.gpr(), gpr(o), gpr(o));
                if is_negated {
                    asm.neg(Width::W32, DATA, amount);
                    amount = DATA;
                }
                asm.shift(op, width, dst, src, amount);
            }
            Self::Extract(width, first) => asm.extr(width, o.gpr(), gpr(o), gpr(o), first),
            Self::MultiplyHigh(sign) => asm.multiply_high(sign, o.gpr(), gpr(o), gpr(o)),
            Self::WithCarry(op) => asm.with_carry(op, Width::W64, o.gpr(), gpr(o), gpr(o)),
            Self::MultiplyLongAndShift(sign, shift, amount) => {
                let dst = o.gpr();
                asm.multiply_add_long(long_multiplication(sign), dst, gpr(o), gpr(o), ZR);
                asm.shift_imm(shift, Width::W64, dst, dst, amount);
            }
            Self::Divide(sign, width) => asm.div(sign, width, o.gpr(), gpr(o), gpr(o)),
            Self::Remainder(sign, width) => emitter.masm.rem(sign, width, o.gpr(), gpr(o), gpr(o)),
            Self::TotalRemainder(width) => {
                let (dst, lhs, rhs) = (o.gpr(), gpr(o), o.gpr());
                asm.div(Sign::Signed, width, DATA, lhs, rhs);
                asm.multiply_add(MultiplyAdd::Msub, width, DATA, DATA, rhs, lhs);
                asm.cmp_imm(width, rhs, ArithmeticImm::ZERO);
                asm.select(Select::Csel, width, dst, DATA, ZR, Cc::Ne);
            }
            Self::CheckedAddSub(op, width, rhs) => {
                emitter.flags = KnownFlags::of_result(width, o.identities()[0]);
                add_sub(asm, op, width, o.gpr(), rhs, o);
                jump_to_exit(emitter, Cc::Vs);
            }
            Self::CheckedNeg(width) => {
                asm.add_sub(AddSub::Subs, width, o.gpr(), ZR, o.gpr());
                jump_to_exit(emitter, Cc::Vs);
            }
            Self::CheckedMul(width) => {
                let (dst, lhs, rhs) = (o.gpr(), gpr(o), gpr(o));
                if width == Width::W32 {
                    asm.multiply_add_long(MultiplyAddLong::Smaddl, dst, lhs, rhs, ZR);
                    compare_with_lower_half(asm, dst);
                } else {
                    asm.multiply_high(Sign::Signed, DATA, lhs, rhs);
                    asm.mul(width, dst, lhs, rhs);
                    asm.add_sub_shifted(AddSub::Subs, width, ZR, DATA, dst, ShiftOp::Asr, 63);
                }
                jump_to_exit(emitter, Cc::Ne);
            }
            Self::CheckedShift(width, amount) => {
                let (dst, src) = (o.gpr(), o.gpr());
                if width == Width::W32 {
                    asm.bitfield_insert(Bitfield::Sbfm, Width::W64, dst, src, amount, 32);
                    compare_with_lower_half(asm, dst);
                } else {
                    asm.shift_imm(ShiftOp::Lsl, width, dst, src, amount);
                    asm.add_sub_shifted(AddSub::Subs, width, ZR, src, dst, ShiftOp::Asr, amount);
                }
                jump_to_exit(emitter, Cc::Ne);
            }
            Self::MultiplyAdd(op, width) => {
                asm.multiply_add(op, width, o.gpr(), gpr(o), gpr(o), gpr(o));
            }
            Self::MultiplyAddLong(op) => asm.multiply_add_long(op, o.gpr(), gpr(o), gpr(o), gpr(o)),
            Self::AddConstant(width, constant) => {
                emitter
                    .masm
                    .add_constant(width, o.gpr(), o.gpr(), constant.into());
            }
            Self::Bitfield(op, width, rotation, last) => {
                asm.bitfield(op, width, o.gpr(), gpr(o), rotation, last);
            }
            Self::Unary(op, width) => asm.unary(op, width, o.gpr(), gpr(o)),
            Self::CountTrailingZeros(width) => {
                emitter.masm.count_trailing_zeros(width, o.gpr(), gpr(o));
            }
            Self::InsertBits(width, rotation, last) => {
                let (dst, kept, inserted) = (o.gpr(), o.gpr(), o.gpr());
                if dst != kept {
                    asm.mov(Width::W64, dst, kept);
                }
                asm.bitfield(Bitfield::Bfm, width, dst, inserted, rotation, last);
            }
            Self::FrameAddress(offset) => memory.add_offset(o.gpr(), FP, offset),

            Self::Load(src) => memory.load(o.gpr(), src, o),
            Self::LoadSigned(width, src) => {
                let (dst, src) = (o.gpr(), memory.encode(src, o));
                memory.masm.assembler().ldrs(width, dst, src);
            }
            Self::LoadFloat(src) => memory.load_fpr(o.fpr(), src, o),
            Self::LoadAndExtendLanes(lanes, sign, src) => {
                let (dst, src) = (o.fpr(), memory.encode(src, o));
                let asm = memory.masm.assembler();
                asm.ldr_fpr(dst, src);
                asm.neon_shift_long(sign, Arrangement::half(lanes), dst, dst, 0);
            }
            Self::LoadSplat(lanes, src) => {
                let (dst, src) = (o.fpr(), memory.register_with(src, o));
                let shape = Arrangement::full(lanes);
                memory.masm.assembler().ld1r(shape, dst, src);
            }
            Self::LoadAcquire(size, sign, src) => {
                let (dst, src) = (o.gpr(), memory.register_with(src, o));
                memory.masm.assembler().ldar(size, dst, src);
                if sign == Sign::Signed {
                    memory.masm.extend(size, sign, Width::W32, dst, dst);
                }
            }
            Self::LoadLane(lanes, lane, src) => {
                let (dst, vector, src) = (o.fpr(), o.fpr(), memory.register_with(src, o));
                memory.masm.move_vector(dst, vector);
                memory.masm.assembler().ld1_lane(lanes, dst, lane, src);
            }
            Self::LoadPair(size, src) => {
                let (low, high, src) = (o.gpr(), o.gpr(), memory.encode_pair(size, src, o));
                memory.masm.assembler().ldp(low, high, src);
            }
            Self::LoadFloatPair(size, src) => {
                let (low, high, src) = (o.fpr(), o.fpr(), memory.encode_pair(size, src, o));
                memory.masm.assembler().ldp_fpr(low, high, src);
            }
            Self::StorePair(size, dst) => {
                let (low, high, dst) = (gpr(o), gpr(o), memory.encode_pair(size, dst, o));
                memory.masm.assembler().stp(low, high, dst);
            }
            Self::StoreFloatPair(size, dst) => {
                let (low, high, dst) = (o.fpr(), o.fpr(), memory.encode_pair(size, dst, o));
                memory.masm.assembler().stp_fpr(low, high, dst);
            }
            Self::Store(dst) => memory.store(gpr(o), dst, o),
            Self::StoreFloat(dst) => memory.store_fpr(o.fpr(), dst, o),
            Self::StoreLane(lanes, lane, dst) => {
                let (vector, dst) = (o.fpr(), memory.register_with(dst, o));
                memory.masm.assembler().st1_lane(lanes, vector, lane, dst);
            }
            Self::StoreRelease(size, dst) => {
                let (src, dst) = (gpr(o), memory.register_with(dst, o));
                memory.masm.assembler().stlr(size, src, dst);
            }
            Self::AtomicUpdate(op, size, preparation) => {
                let (dst, mut operand, address) = (o.gpr(), gpr(o), o.gpr());
                if let Some(preparation) = preparation {
                    if preparation == AtomicOp::Sub {
                        asm.neg(size.width(), DATA, operand);
                    } else {
                        asm.mvn(size.width(), DATA, operand);
                    }
                    operand = DATA;
                }
                asm.atomic_update(op, size, operand, dst, address);
            }
            Self::AtomicLoop(op, size) => {
                let (dst, operand, address) = (o.gpr(), gpr(o), Address::new(o.gpr(), 0));
                emitter
                    .masm
                    .atomic_update(op, size, dst, address, operand, ADDRESS);
            }
            Self::AtomicCompareExchange(size) => {
                let (dst, expected, replacement) = (o.gpr(), gpr(o), gpr(o));
                emitter.masm.atomic_compare_exchange(
                    size,
                    dst,
                    Address::new(o.gpr(), 0),
                    expected,
                    replacement,
                    ADDRESS,
                );
            }
            Self::Fence(barrier) => asm.dmb(barrier),

            Self::FloatBinary(op, width) => asm.float_binary(op, width, o.fpr(), o.fpr(), o.fpr()),
            Self::FloatBits(op) => asm.neon_bitwise(op, o.fpr(), o.fpr(), o.fpr()),
            Self::FloatUnary(op, width) => asm.float_unary(op, width, o.fpr(), o.fpr()),
            Self::Bitcast(to) => match (o.location(), o.location()) {
                (Location::Gpr(dst), Location::Frame(offset)) => {
                    memory.load_frame(size_of(to), dst, offset);
                }
                (Location::Gpr(dst), src) => {
                    let from = if to == Type::I32 {
                        Type::F32
                    } else {
                        Type::F64
                    };
                    asm.fmov_from_fpr(from.float_width(), dst, src.fpr());
                }
                (dst, Location::Frame(offset)) => {
                    memory.load_frame_fpr(size_of(to), dst.fpr(), offset);
                }
                (dst, src) => asm.fmov_to_fpr(to.float_width(), dst.fpr(), src.gpr()),
            },
            Self::IntToFloat(sign, from, to) => asm.cvtf(sign, from, to, o.fpr(), gpr(o)),
            Self::FloatToInt(rounding, from, sign, to) => {
                asm.fcvt_to_gpr(rounding, from, sign, to, o.gpr(), o.fpr());
            }
            Self::FloatToInt32Modular => asm.fjcvtzs(o.gpr(), o.fpr()),

            Self::Lanes(op, shape) => asm.neon(op, shape, o.fpr(), o.fpr(), o.fpr()),
            Self::WideningLanes(op, shape) => asm.neon_long(op, shape, o.fpr(), o.fpr(), o.fpr()),
            Self::MulByLane(shape, lane) => {
                asm.neon_by_element(NeonByElement::Fmul, shape, o.fpr(), o.fpr(), o.fpr(), lane);
            }
            Self::XorAndRotate(amount) => asm.xar(o.fpr(), o.fpr(), o.fpr(), amount),
            Self::LanesWithZero(op, shape) => asm.neon_unary(op, shape, o.fpr(), o.fpr()),
            Self::FloatLanesWithZero(op, shape) => {
                asm.neon_float_unary(op, shape, o.fpr(), o.fpr());
            }
            Self::ThreeVectors(op) => {
                asm.neon_bitwise_three(op, o.fpr(), o.fpr(), o.fpr(), o.fpr());
            }
            Self::AddPairsTo => {
                let dst = o.fpr();
                asm.neon(NeonBinary::Addp, Arrangement::S4, VECTOR, o.fpr(), o.fpr());
                asm.neon(NeonBinary::Add, Arrangement::S4, dst, VECTOR, o.fpr());
            }
            Self::Accumulate(how) => {
                let dst = o.fpr();
                emitter.masm.move_vector(dst, o.fpr());
                let asm = emitter.masm.assembler();
                match how {
                    Accumulation::Lanes(op, shape) => asm.neon(op, shape, dst, o.fpr(), o.fpr()),
                    Accumulation::Long(op, shape) => {
                        asm.neon_long(op, shape, dst, o.fpr(), o.fpr());
                    }
                    Accumulation::Pairs(op, shape) => asm.neon_add_pairs(op, shape, dst, o.fpr()),
                    Accumulation::ShiftedRight(op, shape, amount) => {
                        asm.neon_shift_right(op, shape, dst, o.fpr(), amount);
                    }
                }
            }

            Self::SetFlags(setting) => {
                if emitter.flags.set(setting, o.identities()) {
                    set_flags(asm, setting, o);
                }
            }
            Self::CompareIf(op, width, Some(rhs), or, cc) => {
                asm.compare_imm_if(op, width, gpr(o), rhs, or, stand_in.translate(cc));
            }
            Self::CompareIf(op, width, None, or, cc) => {
                asm.compare_if(op, width, gpr(o), gpr(o), or, stand_in.translate(cc));
            }
            Self::CompareFloatsIf(width, or, cc) => {
                asm.fccmp(width, o.fpr(), o.fpr(), or, stand_in.translate(cc));
            }

            Self::Branch(test) => {
                let (fork, test) = (emitter.fork(), stand_in.translate_test(test));
                let test = if fork.is_inverted {
                    test.inverted()
                } else {
                    test
                };
                jump_if(emitter.masm, test, o, fork.label);
                emitter.finish_fork(&fork);
            }
            Self::Check(test) => {
                let exit = emitter.exit_label();
                jump_if(emitter.masm, stand_in.translate_test(test), o, exit);
                emitter.finish_check(exit);
            }
            Self::Select(op, width, cc) => {
                let ([result, _], cc) = (o.identities(), stand_in.translate(cc));
                let (dst, then, or) = (o.gpr(), gpr(o), gpr(o));
                asm.select(op, width, dst, then, or, cc);
                if (op, then, or) == (Select::Csinc, ZR, ZR) {
                    emitter.flags.note_boolean(result, cc.inverted());
                }
            }
            Self::SelectOnEither(width, first, second) => {
                let registers @ [dst, ..] = [o.gpr(), gpr(o), gpr(o)];
                select_on(
                    FloatFlags::Either(first, second),
                    registers,
                    |then, or, cc| asm.select(Select::Csel, width, dst, then, or, cc),
                );
            }
            Self::SelectFloat(width, flags) => {
                let registers @ [dst, ..] = [o.fpr(), o.fpr(), o.fpr()];
                select_on(
                    stand_in.translate_flags(flags),
                    registers,
                    |then, or, cc| {
                        asm.fcsel(width, dst, then, or, cc);
                    },
                );
            }
            Self::SelectVector(flags) => {
                let (dst, then, or) = (o.fpr(), o.fpr(), o.fpr());
                select_on(
                    stand_in.translate_flags(flags),
                    [DATA, ZR, ZR],
                    |_, or, cc| {
                        asm.select(Select::Csinv, Width::W64, DATA, or, ZR, cc.inverted());
                    },
                );
                let mask = if dst == then || dst == or {
                    VECTOR
                } else {
                    dst
                };
                asm.dup_gpr(Arrangement::D2, mask, DATA);
                if dst == then {
                    asm.neon_bitwise(NeonBitwise::Bif, dst, or, mask);
                } else if dst == or {
                    asm.neon_bitwise(NeonBitwise::Bit, dst, then, mask);
                } else {
                    asm.neon_bitwise(NeonBitwise::Bsl, dst, then, or);
                }
            }
            Self::SetOnEither(first, second) => {
                let dst = o.gpr();
                asm.cset(dst, first);
                asm.select(Select::Csinc, Width::W32, dst, dst, ZR, second.inverted());
            }
            Self::JumpTable => {
                let table =
                    emitter.jump_table(|masm, targets| masm.assembler().jump_table(targets));
                let asm = emitter.masm.assembler();
                asm.adr(DATA, table);
                let entry = Encoded::indexed(Size::S32, DATA, gpr(o), IndexExtend::Uxtw, true);
                asm.ldrs(Width::W64, ADDRESS, entry);
                asm.add_sub(AddSub::Add, Width::W64, DATA, DATA, ADDRESS);
                asm.br(DATA);
            }
        }
    }
}

fn jump_to_exit<C: Client<MacroAssembler>>(emitter: &mut Emitter<'_, Inst, C>, cc: Cc) {
    let exit = emitter.exit_label();
    emitter.masm.assembler().b_cond(cc, exit);
    emitter.finish_check(exit);
}
