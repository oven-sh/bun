//! Turns instructions into bytes.

use bun_engine_asm::x64::{
    Alu, Assembler, BitCount, BitTest, Cc, FloatFlags, FprMem, GprMem, MacroAssembler, R11, RAX,
    RBP, RDX, RSP, Rm, ShiftOp, SseLoad, SseStore, SseUnary, Unary as UnaryOp, XMM14, XMM15, abi,
};
use bun_engine_asm::{
    Address, AtomicOp, Bank, FloatAssembly, FloatWidth, Fpr, Gpr, Label, MacroAssembly,
    RegisterSet, Scale, Scratch, ScratchNeeds, Sign, Size, VectorAssembly, Width, X64Features,
};

use super::flags::{Compared, Flags};
use super::instruction::{Amode, Inst, Source, Stored, Test};
use crate::client::{Client, Frame};
use crate::ir::{Checked, Function, Load, Location, Type, Unary, Wide};
use crate::machine::{
    Alignment, Class, Emitter, Isa, Operands, Registers, Shared, SharesInstructions,
};

const SCRATCH: Fpr = XMM15;
const RESERVED_ONLY: Scratch = Scratch {
    gprs: [None, None],
    fprs: [Some(SCRATCH), None],
};

fn frame(offset: i32) -> Address {
    Address::new(RBP, offset)
}

fn address(amode: Amode, operands: &mut Operands<'_>) -> Address {
    let base = amode.has_base.then(|| operands.gpr());
    match (base, amode.index) {
        (Some(base), None) => Address::new(base, amode.offset),
        (Some(base), Some(scale)) => Address::indexed(base, operands.gpr(), scale, amode.offset),
        (None, Some(scale)) => Assembler::without_base(operands.gpr(), scale, amode.offset),
        (None, None) => Assembler::absolute(amode.offset),
    }
}

#[inline]
fn gpr_or_memory(operands: &mut Operands<'_>) -> GprMem {
    match operands.location() {
        Location::Frame(offset) => Rm::Mem(frame(offset)),
        location => Rm::Reg(location.gpr()),
    }
}

fn fpr_or_memory(asm: &mut Assembler, operands: &mut Operands<'_>) -> FprMem {
    let size = if operands.class_of_next() == Class::Float32 {
        4
    } else {
        8
    };
    match operands.location() {
        Location::Frame(offset) => Rm::Mem(frame(offset)),
        Location::Constant(bits) => Rm::Mem(asm.constant(bits.get().into(), size)),
        Location::VectorConstant(constant) => {
            Rm::Mem(asm.constant(operands.function().vector_constant(constant), 16))
        }
        location => Rm::Reg(location.fpr()),
    }
}

#[derive(Clone, Copy)]
enum Operand {
    Rm(GprMem),
    Imm(i32),
}

#[inline]
fn source(source: Source, operands: &mut Operands<'_>) -> Operand {
    match source {
        Source::Value => Operand::Rm(gpr_or_memory(operands)),
        Source::Imm(imm) => Operand::Imm(imm),
        Source::Memory(amode) => Operand::Rm(Rm::Mem(address(amode, operands))),
    }
}

fn gpr_source(from: Source, operands: &mut Operands<'_>) -> GprMem {
    match source(from, operands) {
        Operand::Rm(rm) => rm,
        Operand::Imm(_) => unreachable!("takes no constant"),
    }
}

fn fpr_source(asm: &mut Assembler, from: Source, operands: &mut Operands<'_>) -> FprMem {
    match from {
        Source::Value => fpr_or_memory(asm, operands),
        Source::Memory(amode) => Rm::Mem(address(amode, operands)),
        Source::Imm(_) => unreachable!("takes no constant"),
    }
}

fn stored(stored: Stored, operands: &mut Operands<'_>) -> Result<Gpr, i32> {
    match stored {
        Stored::Value => Ok(operands.gpr()),
        Stored::Imm(imm) => Err(imm),
    }
}

#[inline]
fn copy(asm: &mut Assembler, width: Width, dst: Gpr, src: GprMem) {
    if src != Rm::Reg(dst) {
        asm.mov(width, dst, src);
    }
}

/// `rhs` uses `dst` only if the operation commutes or `lhs` is `dst`.
fn two_address(asm: &mut Assembler, width: Width, dst: Gpr, lhs: GprMem, rhs: GprMem) -> GprMem {
    if rhs == Rm::Reg(dst) {
        return lhs;
    }
    copy(asm, width, dst, lhs);
    rhs
}

fn alu(
    asm: &mut Assembler,
    op: Alu,
    width: Width,
    dst: Gpr,
    lhs: GprMem,
    rhs: Operand,
    known: Option<Flags>,
) -> Flags {
    match (op, lhs, rhs, known) {
        (Alu::Add, Rm::Reg(lhs), Operand::Imm(imm), Some(known)) if lhs != dst => {
            asm.lea(width, dst, Address::new(lhs, imm));
            return known.after_writing(dst);
        }
        (Alu::Add, Rm::Reg(lhs), Operand::Rm(Rm::Reg(rhs)), Some(known))
            if lhs != dst && rhs != dst =>
        {
            asm.lea(width, dst, Address::indexed(lhs, rhs, Scale::One, 0));
            return known.after_writing(dst);
        }
        (_, _, Operand::Imm(imm), _) => {
            copy(asm, width, dst, lhs);
            asm.alu_imm(op, width.size(), dst, imm);
        }
        (_, _, Operand::Rm(rhs), _) => {
            let rhs = two_address(asm, width, dst, lhs, rhs);
            asm.alu(op, width.size(), dst, rhs);
        }
    }
    match (op, lhs, rhs) {
        (Alu::And | Alu::Or | Alu::Xor, ..) => Flags::of_logic(dst, width.size()),
        (Alu::Sub, Rm::Reg(lhs), Operand::Rm(Rm::Reg(rhs))) => {
            Flags::of_subtraction(width, dst, lhs, Compared::Reg(rhs))
        }
        _ => Flags::of_arithmetic(dst, width),
    }
}

fn multiply(asm: &mut Assembler, width: Width, dst: Gpr, lhs: GprMem, rhs: Operand) {
    match rhs {
        Operand::Imm(imm) => asm.imul_imm(width, dst, lhs, imm),
        Operand::Rm(rhs) => {
            let rhs = two_address(asm, width, dst, lhs, rhs);
            asm.imul(width, dst, rhs);
        }
    }
}

fn load_float(asm: &mut Assembler, bytes: u32, dst: Fpr, src: Address) {
    match bytes {
        4 => asm.sse_load(SseLoad::Movss, dst, src),
        8 => asm.sse_load(SseLoad::Movsd, dst, src),
        _ => asm.sse_unary(SseUnary::Movups, dst, src),
    }
}

fn store_float(asm: &mut Assembler, bytes: u32, dst: Address, src: Fpr) {
    let op = match bytes {
        4 => SseStore::Movss,
        8 => SseStore::Movsd,
        _ => SseStore::Movups,
    };
    asm.sse_store(op, dst, src);
}

/// Leaves the flags alone unless the value is the address of something in the frame.
fn store_location(
    asm: &mut Assembler,
    function: &Function,
    from: Location,
    dst: Address,
    bytes: u32,
) {
    let size = if bytes == 4 { Size::S32 } else { Size::S64 };
    match from {
        Location::Gpr(src) => asm.mov_store(size, dst, src),
        Location::Fpr(src) => store_float(asm, bytes, dst, src),
        Location::Frame(offset) => {
            load_float(asm, bytes, SCRATCH, frame(offset));
            store_float(asm, bytes, dst, SCRATCH);
        }
        Location::Displaced(base, offset) => {
            asm.mov_store(size, dst, base);
            asm.alu_imm(Alu::Add, size, dst, offset);
        }
        Location::Constant(bits) => match i32::try_from(bits.get() as i64) {
            Ok(short) => asm.mov_store_imm(size, dst, short),
            Err(_) if size == Size::S32 => asm.mov_store_imm(size, dst, bits.get() as i32),
            // A load of what two stores have written waits for both to complete.
            Err(_) => {
                let src = asm.constant(bits.get().into(), 8);
                load_float(asm, bytes, SCRATCH, src);
                store_float(asm, bytes, dst, SCRATCH);
            }
        },
        Location::VectorConstant(constant) => {
            let src = asm.constant(function.vector_constant(constant), 16);
            load_float(asm, bytes, SCRATCH, src);
            store_float(asm, bytes, dst, SCRATCH);
        }
    }
}

/// Leaves the flags alone.
fn load_location(asm: &mut Assembler, width: Width, dst: Gpr, from: Location) {
    match from {
        Location::Gpr(src) => copy(asm, width, dst, Rm::Reg(src)),
        Location::Frame(offset) => asm.mov(width, dst, frame(offset)),
        Location::Displaced(base, offset) => asm.lea(width, dst, Address::new(base, offset)),
        Location::Constant(bits) if width == Width::W32 => {
            asm.mov_imm(dst, (bits.get() as u32).into())
        }
        Location::Constant(bits) => asm.mov_imm(dst, bits.get() as i64),
        Location::Fpr(_) | Location::VectorConstant(_) => unreachable!("not an integer"),
    }
}

/// The condition that holds if the test succeeds, provided that the flags tell already.
fn known_condition(test: Test, known: Flags, mut operands: Operands<'_>) -> Option<Cc> {
    let (size, cc, rhs) = match test {
        Test::Compare(size, cc, rhs) => (size, cc, rhs),
        Test::Zero(size, cc) => (size, cc, Source::Imm(0)),
        _ => return None,
    };
    let Rm::Reg(lhs) = gpr_or_memory(&mut operands) else {
        return None;
    };
    let rhs = match source(rhs, &mut operands) {
        Operand::Imm(imm) => Compared::Imm(imm),
        Operand::Rm(Rm::Reg(reg)) => Compared::Reg(reg),
        Operand::Rm(Rm::Mem(_)) => return None,
    };
    known.condition(size, cc, lhs, rhs)
}

fn set_flags(
    asm: &mut Assembler,
    test: Test,
    known: &mut Flags,
    operands: &mut Operands<'_>,
) -> FloatFlags {
    if let Some(cc) = known_condition(test, *known, operands.clone()) {
        return FloatFlags::One(cc);
    }
    *known = Flags::default();
    FloatFlags::One(match test {
        Test::Compare(size, cc, rhs) => {
            match (gpr_or_memory(operands), source(rhs, operands)) {
                (Rm::Reg(lhs), Operand::Imm(imm)) => {
                    asm.alu_imm(Alu::Cmp, size, lhs, imm);
                    *known = Flags::of_comparison(size, lhs, Compared::Imm(imm));
                }
                (lhs, Operand::Imm(imm)) => asm.alu_imm(Alu::Cmp, size, lhs, imm),
                (Rm::Reg(lhs), Operand::Rm(rhs)) => {
                    asm.alu(Alu::Cmp, size, lhs, rhs);
                    if let Rm::Reg(rhs) = rhs {
                        *known = Flags::of_comparison(size, lhs, Compared::Reg(rhs));
                    }
                }
                (Rm::Mem(lhs), Operand::Rm(Rm::Reg(rhs))) => asm.alu_mem(Alu::Cmp, size, lhs, rhs),
                (Rm::Mem(_), Operand::Rm(Rm::Mem(_))) => unreachable!("two operands in memory"),
            }
            cc
        }
        Test::CompareMemory(size, cc, amode, rhs) => {
            let lhs = address(amode, operands);
            match stored(rhs, operands) {
                Ok(rhs) => asm.alu_mem(Alu::Cmp, size, lhs, rhs),
                Err(imm) => asm.alu_imm(Alu::Cmp, size, lhs, imm),
            }
            cc
        }
        Test::And(size, cc, rhs) | Test::AndMemory(size, cc, _, rhs) => {
            let lhs = match test {
                Test::AndMemory(_, _, amode, _) => Rm::Mem(address(amode, operands)),
                _ => gpr_or_memory(operands),
            };
            match stored(rhs, operands) {
                Ok(rhs) => asm.test(size, lhs, rhs),
                Err(imm) => asm.test_imm(size, lhs, imm),
            }
            cc
        }
        Test::Zero(size, cc) => {
            match gpr_or_memory(operands) {
                Rm::Reg(reg) => {
                    asm.test(size, reg, reg);
                    *known = Flags::of_logic(reg, size);
                }
                memory => asm.alu_imm(Alu::Cmp, size, memory, 0),
            }
            cc
        }
        Test::Bit(width, cc, Stored::Value) => {
            let (value, bit) = (operands.gpr(), operands.gpr());
            asm.bt(width, value, bit);
            cc
        }
        Test::Bit(width, cc, Stored::Imm(bit)) => {
            asm.bit_test_imm(BitTest::Bt, width, gpr_or_memory(operands), bit as u8);
            cc
        }
        Test::Float(width, flags, rhs) => {
            let lhs = operands.fpr();
            let rhs = fpr_source(asm, rhs, operands);
            asm.sse_unary(
                if width == FloatWidth::F32 {
                    SseUnary::Ucomiss
                } else {
                    SseUnary::Ucomisd
                },
                lhs,
                rhs,
            );
            return flags;
        }
        Test::Vector(cc) => {
            let vector = operands.fpr();
            asm.sse_unary(SseUnary::Ptest, vector, vector);
            cc
        }
    })
}

fn set_boolean(
    masm: &mut MacroAssembler,
    test: Test,
    mut known: Flags,
    mut operands: Operands<'_>,
) -> Flags {
    let dst = operands.gpr();
    let clears_first =
        !operands.any_is_in(dst) && known_condition(test, known, operands.clone()).is_none();
    let asm = masm.assembler();
    if clears_first {
        asm.alu(Alu::Xor, Size::S32, dst, dst);
    }
    let flags = set_flags(asm, test, &mut known, &mut operands);
    let (cc, if_unordered) = match flags {
        FloatFlags::One(cc) => (cc, None),
        FloatFlags::EqualAndOrdered => (Cc::E, Some(Cc::Np)),
        FloatFlags::NotEqualOrUnordered => (Cc::Ne, Some(Cc::P)),
    };
    asm.setcc(cc, dst);
    if let Some(parity) = if_unordered {
        let ordered = asm.new_label();
        asm.jcc_short(Cc::Np, ordered);
        asm.setcc(parity, dst);
        asm.bind(ordered);
    }
    if !clears_first {
        asm.movzx(Size::S8, dst, dst);
    }
    known.after_writing(dst)
}

fn select(
    masm: &mut MacroAssembler,
    test: Test,
    mut known: Flags,
    mut operands: Operands<'_>,
) -> Flags {
    let width = if operands.class_of_next() == Class::Int32 {
        Width::W32
    } else {
        Width::W64
    };
    let (dst, then, or) = (operands.gpr(), operands.location(), operands.location());
    let flags = set_flags(masm.assembler(), test, &mut known, &mut operands);
    let starts_with_then = then == Location::Gpr(dst) || matches!(then, Location::Constant(_));
    let (flags, first, second) = if starts_with_then {
        (flags.inverted(), then, or)
    } else {
        (flags, or, then)
    };
    if let FloatFlags::One(cc) = flags {
        load_location(masm.assembler(), width, dst, first);
        let second = if let Location::Frame(offset) = second {
            Rm::Mem(frame(offset))
        } else {
            Rm::Reg(second.gpr())
        };
        masm.assembler().cmov(cc, width, dst, second);
        return known.after_writing(dst);
    }
    let done = masm.new_label();
    if width == Width::W32 && first == Location::Gpr(dst) {
        masm.assembler().mov(width, dst, dst);
    }
    load_location(masm.assembler(), width, dst, first);
    masm.jump_on_float_flags(flags.inverted(), done);
    load_location(masm.assembler(), width, dst, second);
    masm.bind(done);
    known.after_writing(dst)
}

impl SharesInstructions for Inst {
    const RESERVED: ScratchNeeds = ScratchNeeds { gprs: 0, fprs: 1 };

    fn shared(shared: Shared) -> Self {
        Self::Shared(shared)
    }

    fn scratch_for_unary(_: X64Features, op: Unary, _: Type, to: Type) -> ScratchNeeds {
        match op {
            Unary::FloatToHalfBits => ScratchNeeds { gprs: 1, fprs: 2 },
            Unary::IntToFloat(Sign::Unsigned) => ScratchNeeds { gprs: 1, fprs: 0 },
            Unary::FloatToIntSaturating(Sign::Unsigned) if to == Type::I32 => {
                ScratchNeeds { gprs: 1, fprs: 1 }
            }
            _ => Self::RESERVED,
        }
    }
}

impl Isa for Inst {
    type Masm = MacroAssembler;
    type Flags = Flags;

    fn registers(function: &Function) -> Registers {
        Registers {
            allocatable: abi::ALL - RegisterSet::of(&[RSP, RBP], &[SCRATCH]) - function.pinned,
            kept_by_calls: abi::CALLEE_SAVED,
            swaps_gprs: true,
            addresses_float_constants: true,
        }
    }

    fn is_jump(self) -> bool {
        matches!(self, Self::Jump)
    }

    fn prepare(masm: &mut MacroAssembler) {
        masm.set_scratch(RESERVED_ONLY);
    }

    #[inline]
    fn flags_after_move(flags: Flags, from: Location, to: Location) -> Flags {
        match (from, to) {
            (Location::Constant(bits), Location::Gpr(_)) if bits.get() == 0 => Flags::default(),
            (Location::Displaced(..), Location::Frame(_)) => Flags::default(),
            (_, Location::Gpr(dst)) => flags.after_writing(dst),
            _ => flags,
        }
    }

    fn align(masm: &mut MacroAssembler, purpose: Alignment, end: Label) {
        let most_bytes = match purpose {
            Alignment::Loop => 63,
            Alignment::LoopEnteredFromAbove => 31,
            Alignment::Run => 40,
        };
        masm.assembler().keep_together(end, most_bytes);
    }

    fn scratch(_: Bank) -> Location {
        Location::Fpr(SCRATCH)
    }

    fn lend_scratch(masm: &mut MacroAssembler, clobbered: RegisterSet) -> Scratch {
        masm.set_scratch(Scratch {
            gprs: [clobbered.contains(R11).then_some(R11), None],
            fprs: [Some(SCRATCH), clobbered.contains(XMM14).then_some(XMM14)],
        })
    }

    fn recover(masm: &mut MacroAssembler, instruction: Self, mut operands: Operands<'_>) {
        let Self::Checked(op, width, rhs) = instruction else {
            unreachable!("keeps its operands")
        };
        let (dst, lhs) = (operands.gpr(), gpr_or_memory(&mut operands));
        let inverse = if op == Checked::Add {
            Alu::Sub
        } else {
            Alu::Add
        };
        alu(
            masm.assembler(),
            inverse,
            width,
            dst,
            lhs,
            source(rhs, &mut operands),
            None,
        );
    }

    fn emit_move(
        masm: &mut MacroAssembler,
        function: &Function,
        _: &Frame,
        from: Location,
        to: Location,
        class: Class,
    ) {
        match (from, to) {
            (_, Location::Frame(offset)) => {
                let bytes = if class == Class::Float32 {
                    4
                } else {
                    class.slot_size()
                };
                store_location(masm.assembler(), function, from, frame(offset), bytes);
            }
            (Location::Constant(bits), Location::Gpr(dst)) if bits.get() == 0 => {
                masm.move32(dst, 0)
            }
            (Location::Constant(bits), Location::Gpr(dst))
                if bits.get() > u32::MAX.into()
                    && let Some((base, distance)) =
                        function.pinned_near(bits.get(), i32::MIN.into()..=i32::MAX.into()) =>
            {
                masm.compute_address(dst, Address::new(base, distance as i32));
            }
            (_, Location::Gpr(dst)) => {
                load_location(
                    masm.assembler(),
                    if class == Class::Int32 {
                        Width::W32
                    } else {
                        Width::W64
                    },
                    dst,
                    from,
                );
            }
            (Location::Fpr(src), Location::Fpr(dst)) => masm.move_vector(dst, src),
            (Location::Frame(offset), Location::Fpr(dst)) => {
                let bytes = if class == Class::Float32 {
                    4
                } else {
                    class.slot_size()
                };
                load_float(masm.assembler(), bytes, dst, frame(offset));
            }
            (Location::Constant(bits), Location::Fpr(dst)) => {
                let width = if class == Class::Float32 {
                    FloatWidth::F32
                } else {
                    FloatWidth::F64
                };
                masm.move_float_constant(width, dst, bits.get());
            }
            (Location::VectorConstant(constant), Location::Fpr(dst)) => {
                masm.move_vector_constant(dst, function.vector_constant(constant));
            }
            _ => unreachable!("no such move"),
        }
    }

    fn emit<C: Client<MacroAssembler>>(
        emitter: &mut Emitter<'_, Self, C>,
        instruction: Self,
        mut operands: Operands<'_>,
    ) {
        let mut known = core::mem::take(&mut emitter.flags);
        let function = emitter.places.function;
        let o = &mut operands;
        let asm = emitter.masm.assembler();
        match instruction {
            Self::Copy => {
                let (class, to, from) = (o.class_of_next(), o.location(), o.location());
                if from != to {
                    Self::emit_move(emitter.masm, function, emitter.frame, from, to, class);
                    known = Self::flags_after_move(known, from, to);
                }
                emitter.flags = known;
            }
            Self::ZeroExtend => {
                let dst = o.gpr();
                match o.location() {
                    Location::Gpr(src) => asm.mov(Width::W32, dst, src),
                    from => load_location(asm, Width::W32, dst, from),
                }
                emitter.flags = known.after_writing(dst);
            }
            Self::Jump => {
                emitter.flags = known;
                emitter.jump();
            }
            Self::Return => {
                asm.leave();
                asm.ret();
            }
            Self::Unreachable => asm.ud2(),
            Self::Patchpoint => emitter.patchpoint(operands),
            Self::StoreOutgoing(offset, ty) => {
                store_location(
                    asm,
                    function,
                    o.location(),
                    Address::new(RSP, offset),
                    ty.bytes(),
                );
            }
            Self::StoreResult(offset, ty) => {
                store_location(asm, function, o.location(), frame(offset), ty.bytes())
            }
            Self::LoadOutgoing(offset, ty) if ty.is_int() => {
                asm.mov(ty.width(), o.gpr(), Address::new(RSP, offset))
            }
            Self::LoadOutgoing(offset, ty) => {
                load_float(asm, ty.bytes(), o.fpr(), Address::new(RSP, offset))
            }
            Self::Shared(shared) => shared.emit::<Self>(emitter.masm, operands),
            Self::Vector(instruction) => instruction.emit::<Self>(emitter.masm, operands),

            Self::Alu(op, width, rhs) => {
                let (dst, lhs) = (o.gpr(), gpr_or_memory(o));
                emitter.flags = alu(asm, op, width, dst, lhs, source(rhs, o), Some(known));
            }
            Self::Mul(width, rhs) => {
                multiply(asm, width, o.gpr(), gpr_or_memory(o), source(rhs, o))
            }
            Self::Checked(op, width, rhs) => {
                let (dst, lhs, rhs) = (o.gpr(), gpr_or_memory(o), source(rhs, o));
                if op == Checked::Mul {
                    multiply(asm, width, dst, lhs, rhs);
                } else {
                    let op = if op == Checked::Add {
                        Alu::Add
                    } else {
                        Alu::Sub
                    };
                    emitter.flags = alu(asm, op, width, dst, lhs, rhs, None);
                }
                let exit = emitter.exit_label();
                emitter.masm.assembler().jcc(Cc::O, exit);
                emitter.finish_check(exit);
            }
            Self::AndNot(width) => {
                let dst = o.gpr();
                asm.andn(width, dst, o.gpr(), gpr_or_memory(o));
                emitter.flags = Flags::of_logic(dst, width.size());
            }
            Self::Lea(width, amode) => {
                let dst = o.gpr();
                asm.lea(width, dst, address(amode, o));
                emitter.flags = known.after_writing(dst);
            }
            Self::Unary(op, width) => {
                let dst = o.gpr();
                copy(asm, width, dst, gpr_or_memory(o));
                asm.unary(op, width.size(), dst);
                emitter.flags = if op == UnaryOp::Not {
                    known.after_writing(dst)
                } else {
                    Flags::of_arithmetic(dst, width)
                };
            }
            Self::ShiftImm(op, width, amount) => {
                let (dst, src) = (o.gpr(), gpr_or_memory(o));
                let rotates = matches!(op, ShiftOp::Rol | ShiftOp::Ror);
                if let (ShiftOp::Shl, 1, Rm::Reg(src)) = (op, amount, src) {
                    let (lhs, rhs) = (Rm::Reg(src), Operand::Rm(Rm::Reg(src)));
                    emitter.flags = alu(asm, Alu::Add, width, dst, lhs, rhs, Some(known));
                } else if rotates && src != Rm::Reg(dst) && asm.has(X64Features::BMI2) {
                    let left = width.bits() - amount;
                    asm.rorx(
                        width,
                        dst,
                        src,
                        if op == ShiftOp::Rol { left } else { amount },
                    );
                    emitter.flags = known.after_writing(dst);
                } else {
                    copy(asm, width, dst, src);
                    asm.shift_imm(op, width.size(), dst, amount);
                    if !rotates {
                        emitter.flags = Flags::of_arithmetic(dst, width);
                    }
                }
            }
            Self::Extend(from, sign, to, src) => {
                let (dst, src) = (o.gpr(), gpr_source(src, o));
                if from == to.size() {
                    asm.mov(to, dst, src);
                } else if sign == Sign::Signed {
                    asm.movsx(from, to, dst, src);
                } else {
                    asm.movzx(from, dst, src);
                }
                emitter.flags = known.after_writing(dst);
            }
            Self::BitCount(op, width, src) => {
                let (dst, src) = (o.gpr(), gpr_source(src, o));
                if op == BitCount::Popcnt && !src.uses(dst) {
                    // Some processors wait for the old value of the destination.
                    asm.alu(Alu::Xor, Size::S32, dst, dst);
                }
                asm.bit_count(op, width, dst, src);
            }
            Self::BitScan(op, width) => {
                let (dst, if_zero, bits) = (o.gpr(), o.gpr(), i32::from(width.bits()));
                asm.mov_imm(
                    if_zero,
                    if op == BitCount::Bsr {
                        2 * bits - 1
                    } else {
                        bits
                    }
                    .into(),
                );
                asm.bit_count(op, width, dst, gpr_or_memory(o));
                asm.cmov(Cc::E, Width::W32, dst, if_zero);
                if op == BitCount::Bsr {
                    asm.alu_imm(Alu::Xor, Size::S32, dst, bits - 1);
                }
            }
            Self::ShiftCl(op, width, clears_upper_half) => {
                let (dst, src) = (o.gpr(), gpr_or_memory(o));
                if clears_upper_half || src != Rm::Reg(dst) {
                    asm.mov(width, dst, src);
                }
                asm.shift_cl(op, width.size(), dst);
            }
            Self::ShiftX(op, width) => {
                let dst = o.gpr();
                asm.shiftx(op, width, dst, gpr_or_memory(o), o.gpr());
                emitter.flags = known.after_writing(dst);
            }
            Self::Divide(sign, width) | Self::MulRdxRax(sign, width) => {
                o.skip(3);
                let op = match (instruction, sign) {
                    (Self::MulRdxRax(..), Sign::Signed) => UnaryOp::Imul,
                    (Self::MulRdxRax(..), Sign::Unsigned) => UnaryOp::Mul,
                    (_, Sign::Signed) => {
                        asm.extend_sign_into_rdx(width);
                        UnaryOp::Idiv
                    }
                    (_, Sign::Unsigned) => {
                        asm.alu(Alu::Xor, Size::S32, RDX, RDX);
                        UnaryOp::Div
                    }
                };
                asm.unary(op, width.size(), gpr_or_memory(o));
            }
            Self::Wide(op) => {
                let [dst, lhs, rhs] = [(); 3].map(|()| [o.gpr(), o.gpr()]);
                match op {
                    Wide::Add => emitter.masm.add128(dst, lhs, rhs),
                    Wide::Sub => emitter.masm.sub128(dst, lhs, rhs),
                }
            }

            Self::LoadFloat(ty, amode) => {
                load_float(asm, ty.bytes(), o.fpr(), address(amode, o));
                emitter.flags = known;
            }
            Self::LoadVector(kind, amode) => {
                let (dst, src) = (o.fpr(), address(amode, o));
                match kind {
                    Load::VectorExtend(from, sign) => {
                        emitter.masm.load_vector_extend(from, sign, dst, src)
                    }
                    Load::VectorSplat(lanes) => emitter.masm.load_vector_splat(lanes, dst, src),
                    Load::VectorZero(size) => load_float(asm, size.bytes().into(), dst, src),
                    Load::Narrow(..) | Load::Full => unreachable!("has an instruction of its own"),
                }
            }
            Self::LoadLane(lanes, lane, amode) => {
                emitter
                    .masm
                    .load_vector_lane(lanes, o.fpr(), o.fpr(), lane, address(amode, o));
            }
            Self::StoreLane(lanes, lane, amode) => {
                let vector = o.fpr();
                emitter
                    .masm
                    .store_vector_lane(lanes, address(amode, o), vector, lane);
            }
            Self::Store(size, src, amode) => {
                match (stored(src, o), address(amode, o)) {
                    (Ok(src), dst) => asm.mov_store(size, dst, src),
                    (Err(imm), dst) => asm.mov_store_imm(size, dst, imm),
                }
                emitter.flags = known;
            }
            Self::StoreFloat(ty, amode) => {
                let src = o.fpr();
                store_float(asm, ty.bytes(), address(amode, o), src);
                emitter.flags = known;
            }
            Self::Update {
                op,
                size,
                src,
                address: amode,
                is_atomic,
            } => {
                if is_atomic {
                    asm.lock();
                }
                match (stored(src, o), address(amode, o)) {
                    (Ok(src), dst) => asm.alu_mem(op, size, dst, src),
                    (Err(imm), dst) => asm.alu_imm(op, size, dst, imm),
                }
            }
            Self::UpdateUnary(op, size, amode) => asm.unary(op, size, address(amode, o)),
            Self::AtomicStore(size, amode) => {
                let temp = o.gpr();
                load_location(asm, size.width(), temp, o.location());
                asm.xchg(size, address(amode, o), temp);
            }
            Self::AtomicExchange(op, size, amode) => {
                let dst = o.gpr();
                load_location(asm, size.width(), dst, o.location());
                let memory = address(amode, o);
                if op == AtomicOp::Sub {
                    asm.unary(UnaryOp::Neg, size.width().size(), dst);
                }
                if op == AtomicOp::Exchange {
                    asm.xchg(size, memory, dst);
                } else {
                    asm.lock();
                    asm.xadd(size, memory, dst);
                }
                if size < Size::S32 {
                    asm.movzx(size, dst, dst);
                }
            }
            Self::AtomicLoop(op, size, amode) => {
                let (dst, temp, operand) = (o.gpr(), o.gpr(), o.gpr());
                emitter
                    .masm
                    .atomic_update(op, size, dst, address(amode, o), operand, temp);
            }
            Self::AtomicCompareExchange(size, amode) => {
                let (dst, expected, replacement) = (o.gpr(), o.gpr(), o.gpr());
                emitter.masm.atomic_compare_exchange(
                    size,
                    dst,
                    address(amode, o),
                    expected,
                    replacement,
                    RAX,
                );
            }
            Self::Fence => emitter.masm.memory_fence(),

            Self::Sse(op, rhs) => {
                let (dst, mut lhs) = (o.fpr(), o.fpr());
                let mut rhs = fpr_source(asm, rhs, o);
                if !asm.has(X64Features::AVX) && lhs != dst {
                    if rhs == Rm::Reg(dst) {
                        rhs = Rm::Reg(lhs);
                    } else {
                        asm.sse_unary(SseUnary::Movaps, dst, lhs);
                    }
                    lhs = dst;
                }
                asm.sse(op, dst, lhs, rhs);
                emitter.flags = known;
            }
            Self::Bitcast(to) if to.is_int() => match (o.gpr(), fpr_or_memory(asm, o)) {
                (dst, Rm::Reg(src)) => asm.movd_from_xmm(to.width(), dst, src),
                (dst, Rm::Mem(src)) => asm.mov(to.width(), dst, src),
            },
            Self::Bitcast(to) => asm.movd_to_xmm(to.width(), o.fpr(), gpr_or_memory(o)),
            Self::SignedToFloat(from, to, src) => {
                let dst = o.fpr();
                emitter.masm.move_float_constant(to, dst, 0);
                emitter
                    .masm
                    .assembler()
                    .cvtsi2s(from, to, dst, dst, gpr_source(src, o));
            }

            Self::Branch(test) => {
                let flags = set_flags(asm, test, &mut known, o);
                emitter.flags = known;
                let fork = emitter.fork();
                emitter.masm.jump_on_float_flags(
                    if fork.is_inverted {
                        flags.inverted()
                    } else {
                        flags
                    },
                    fork.label,
                );
                emitter.finish_fork(&fork);
            }
            Self::Check(test) => {
                let flags = set_flags(asm, test, &mut known, o);
                emitter.flags = known;
                let exit = emitter.exit_label();
                emitter.masm.jump_on_float_flags(flags, exit);
                emitter.finish_check(exit);
            }
            Self::Set(test) => emitter.flags = set_boolean(emitter.masm, test, known, operands),
            Self::Select(test) => emitter.flags = select(emitter.masm, test, known, operands),
            Self::SelectFloat(test) => {
                let (dst, then, or) = (o.fpr(), o.fpr(), o.fpr());
                let flags = set_flags(asm, test, &mut known, o);
                emitter.flags = known;
                emitter.masm.select_vector_on_flags(flags, dst, then, or);
            }
            Self::JumpTable => {
                let (base, target, index) = (o.gpr(), o.gpr(), o.gpr());
                let table =
                    emitter.jump_table(|masm, targets| masm.assembler().jump_table(targets));
                let asm = emitter.masm.assembler();
                asm.lea(Width::W64, base, Assembler::label_address(table));
                let entry = Address::indexed(base, index, Scale::Four, 0);
                asm.movsx(Size::S32, Width::W64, target, entry);
                asm.alu(Alu::Add, Size::S64, target, base);
                asm.jmp_indirect(target);
            }
        }
    }
}
