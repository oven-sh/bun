//! Chooses instructions.

use bun_engine_asm::x64::{
    Alu, BitCount, RAX, RCX, RDX, ShiftOp, ShiftX, Sse, Unary as UnaryOp, single_instruction,
};
use bun_engine_asm::{AtomicOp, Bank, Cond, Scale, Sign, Size, Width, X64Features};

use super::address::{AddressParts, Base, Matched};
use super::instruction::{Inst, Source, Test};
use crate::ir::{
    Access, AccessFlags, Binary, Checked, Heap, Load, Op, Store, Type, Unary, Value, Wide,
};
use crate::machine::{Lowering, Place, Role};

fn alu_for(op: Binary) -> Option<Alu> {
    match op {
        Binary::Add => Some(Alu::Add),
        Binary::Sub => Some(Alu::Sub),
        Binary::And => Some(Alu::And),
        Binary::Or => Some(Alu::Or),
        Binary::Xor => Some(Alu::Xor),
        _ => None,
    }
}

impl Lowering<'_, Inst> {
    fn has(&self, features: X64Features) -> bool {
        self.features.contains(features)
    }

    pub(super) fn select(&mut self, value: Value) {
        let ty = self.type_of(value);
        match self.op(value) {
            Op::Unary(op, operand) => self.select_unary(value, op, operand),
            Op::Binary(op, [lhs, rhs]) if ty.is_int() => {
                self.select_int_binary(value, op, lhs, rhs)
            }
            Op::Binary(op, [lhs, rhs]) => self.select_float_binary(value, op, lhs, rhs),
            Op::Compare(..) | Op::FloatCompare(..) => {
                self.def(value);
                let test = self.use_comparison_for_result(value);
                self.finish(Inst::Set(test));
            }
            Op::Select([condition, then, or]) => self.select_choice(value, condition, then, or),
            Op::Wide(op, [lhs_low, lhs_high, rhs_low, rhs_high]) => {
                self.def_early(value, 0);
                self.def_element(value, 1);
                [lhs_low, lhs_high, rhs_low]
                    .into_iter()
                    .for_each(|operand| self.use_register(operand));
                self.use_value(
                    rhs_high,
                    if op == Wide::Sub {
                        Role::LateUse
                    } else {
                        Role::Use
                    },
                    Place::Register,
                );
                self.finish(Inst::Wide(op));
            }
            Op::MulWide(sign, [lhs, rhs]) => {
                self.def_fixed(value, 0, RAX);
                self.def_fixed(value, 1, RDX);
                self.finish_multiplication(sign, Width::W64, lhs, rhs);
            }
            Op::Load {
                kind: Load::Narrow(size, sign),
                ..
            } => self.select_load(value, value, size, sign, Width::W32),
            Op::Load {
                kind: Load::Full,
                address,
                offset,
                ..
            } => {
                if ty.is_int() {
                    return self.select_load(
                        value,
                        value,
                        ty.width().size(),
                        Sign::Unsigned,
                        ty.width(),
                    );
                }
                self.def(value);
                let address = self.use_address(address, offset, Role::Use);
                self.finish(Inst::LoadFloat(ty, address));
            }
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => {
                self.select_store(value, kind, stored, address, offset, access);
            }
            Op::AtomicUpdate {
                op,
                size,
                args: [operand, address],
                ..
            } => {
                self.select_atomic_update(value, op, size, operand, address);
            }
            Op::AtomicCompareExchange {
                size,
                args: [expected, replacement, address],
                ..
            } => {
                self.def_fixed(value, 0, RAX);
                self.use_fixed(expected, Role::Use, RAX);
                self.use_late(replacement);
                let address = self.use_address(address, 0, Role::LateUse);
                self.finish(Inst::AtomicCompareExchange(size, address));
            }
            Op::Fence { reads, writes } => {
                if reads != Heap::NOTHING && writes != Heap::NOTHING {
                    self.finish(Inst::Fence);
                }
            }
            Op::Check(condition, _) => {
                let test = self.use_condition(condition, value);
                self.exit_of(value, None);
                self.finish(Inst::Check(test));
            }
            Op::Checked(op, [lhs, rhs], _) => self.select_checked(value, op, lhs, rhs),
            Op::Branch(condition) => {
                let test = self.use_condition(condition, value);
                self.finish(Inst::Branch(test));
            }
            Op::JumpTable(index, _) => {
                self.temp(Bank::Gpr);
                self.temp(Bank::Gpr);
                self.finish_with_extended_use(index, Inst::JumpTable);
            }
            Op::Load {
                kind,
                address,
                offset,
                ..
            } => {
                self.def(value);
                let address = self.use_address(address, offset, Role::Use);
                self.finish(Inst::LoadVector(kind, address));
            }
            Op::LoadLane {
                lanes,
                lane,
                args: [vector, address],
                offset,
                ..
            } => {
                self.def_tied(value, 1, None);
                self.use_register(vector);
                let address = self.use_address(address, offset, Role::Use);
                self.finish(Inst::LoadLane(lanes, lane, address));
            }
            Op::StoreLane {
                lanes,
                lane,
                args: [vector, address],
                offset,
                ..
            } => {
                self.use_register(vector);
                let address = self.use_address(address, offset, Role::Use);
                self.finish(Inst::StoreLane(lanes, lane, address));
            }
            Op::VectorBinary(op, [lhs, rhs])
                if let Some((op, is_reversed)) = single_instruction(op)
                    && self.has(X64Features::AVX) =>
            {
                let (lhs, rhs) = if is_reversed { (rhs, lhs) } else { (lhs, rhs) };
                self.select_sse(value, op, lhs, rhs, true);
            }
            _ => {
                let instruction = self.match_vector(value);
                self.finish(Inst::Vector(instruction));
            }
        }
    }

    fn use_comparison_for_result(&mut self, value: Value) -> Test {
        match self.op(value) {
            Op::Compare(Cond::Eq | Cond::Ne, [_, rhs]) if self.int_constant(rhs) == Some(0) => {
                self.use_condition(value, value)
            }
            _ => self.use_comparison(value, false, (self.use_count(value) == 1).then_some(value)),
        }
    }

    fn select_load(&mut self, result: Value, load: Value, size: Size, sign: Sign, to: Width) {
        self.def(result);
        let parts = self.parts_of_load(load);
        let address = self.use_parts(parts, Role::Use);
        self.finish(Inst::Extend(size, sign, to, Source::Memory(address)));
    }

    fn select_extension(
        &mut self,
        value: Value,
        from: Size,
        sign: Sign,
        to: Width,
        operand: Value,
    ) {
        self.def_tied(value, 1, None);
        self.use_value(operand, Role::Use, Place::RegisterOrMemory);
        self.finish(Inst::Extend(from, sign, to, Source::Value));
    }

    fn select_sign_extension_to_64(&mut self, value: Value, operand: Value) {
        let loaded = match self.op(operand) {
            Op::Load {
                kind: Load::Narrow(size, Sign::Signed),
                ..
            } => Some(size),
            Op::Load {
                kind: Load::Full, ..
            } => Some(Size::S32),
            _ => None,
        };
        if let Some(size) = loaded.filter(|_| self.can_absorb(operand, value)) {
            self.absorb(operand);
            return self.select_load(value, operand, size, Sign::Signed, Width::W64);
        }
        match self.op(operand) {
            Op::Unary(Unary::SignExtend(size), inner)
                if !self.is_materialized(operand) && self.is_nearby(operand) =>
            {
                self.select_extension(value, size, Sign::Signed, Width::W64, inner);
            }
            _ => self.select_extension(value, Size::S32, Sign::Signed, Width::W64, operand),
        }
    }

    fn select_unary(&mut self, value: Value, op: Unary, operand: Value) {
        let (ty, from) = (self.type_of(value), self.type_of(operand));
        match op {
            Unary::Neg if ty.is_int() => {
                self.select_in_place(value, operand, Inst::Unary(UnaryOp::Neg, ty.width()))
            }
            Unary::SignExtend(size) => {
                self.select_extension(value, size, Sign::Signed, ty.width(), operand)
            }
            Unary::Widen(Sign::Signed) => self.select_sign_extension_to_64(value, operand),
            Unary::Widen(Sign::Unsigned) => self.zero_extend(value, operand),
            Unary::CountOnes => self.select_bit_count(value, BitCount::Popcnt, operand),
            Unary::CountLeadingZeros if self.has(X64Features::LZCNT) => {
                self.select_bit_count(value, BitCount::Lzcnt, operand);
            }
            Unary::CountTrailingZeros if self.has(X64Features::BMI1) => {
                self.select_bit_count(value, BitCount::Tzcnt, operand);
            }
            Unary::CountLeadingZeros | Unary::CountTrailingZeros => {
                self.def_tied(value, 2, None);
                self.temp(Bank::Gpr);
                self.use_value(operand, Role::Use, Place::RegisterOrMemory);
                let scan = if op == Unary::CountLeadingZeros {
                    BitCount::Bsr
                } else {
                    BitCount::Bsf
                };
                self.finish(Inst::BitScan(scan, ty.width()));
            }
            Unary::Bitcast => {
                self.def(value);
                self.use_value(operand, Role::Use, Place::RegisterOrMemory);
                self.finish(Inst::Bitcast(ty));
            }
            Unary::IntToFloat(Sign::Signed) => {
                let matched = self.match_value_or_load(operand, value);
                self.def(value);
                let source = self.use_matched(matched, Role::Use);
                self.finish(Inst::SignedToFloat(from.width(), ty.float_width(), source));
            }
            Unary::IntToFloat(Sign::Unsigned)
                if from == Type::I32 && self.is_zero_extended(operand) =>
            {
                self.def(value);
                self.use_value(operand, Role::Use, Place::RegisterOrMemory);
                self.finish(Inst::SignedToFloat(
                    Width::W64,
                    ty.float_width(),
                    Source::Value,
                ));
            }
            _ => self.select_shared(value),
        }
    }

    fn select_in_place(&mut self, value: Value, operand: Value, instruction: Inst) {
        self.def_tied(value, 1, None);
        self.use_value(operand, Role::Use, Place::RegisterOrMemory);
        self.finish(instruction);
    }

    fn select_bit_count(&mut self, value: Value, op: BitCount, operand: Value) {
        let matched = self.match_value_or_load(operand, value);
        self.def_tied(value, 1, None);
        let source = self.use_matched(matched, Role::Use);
        self.finish(Inst::BitCount(op, self.type_of(value).width(), source));
    }

    fn select_lea(&mut self, value: Value, parts: AddressParts) {
        self.def_tied(
            value,
            1,
            (parts.index.is_some() && !matches!(parts.base, Base::None)).then_some(2),
        );
        let address = self.use_parts(parts, Role::Use);
        self.finish(Inst::Lea(self.type_of(value).width(), address));
    }

    /// Puts what is best read from memory or needed later on the right.
    fn order_operands(&mut self, lhs: Value, rhs: Value, user: Value) -> (Value, Value) {
        let belongs_right =
            |value| self.op(value).is_floating() || self.is_absorbable_load(value, user);
        let swaps =
            !belongs_right(rhs) && (belongs_right(lhs) || self.suits_result_better(rhs, lhs, user));
        if swaps { (rhs, lhs) } else { (lhs, rhs) }
    }

    /// For `result = lhs; result op= rhs`.
    fn use_two_address(
        &mut self,
        value: Value,
        lhs: Value,
        rhs: Matched,
        commutes: bool,
    ) -> Source {
        self.def_tied(
            value,
            1,
            (commutes && matches!(rhs, Matched::Value(_))).then_some(2),
        );
        self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
        let is_read_first = commutes && matches!(rhs, Matched::Value(_));
        self.use_matched(
            rhs,
            if is_read_first {
                Role::Use
            } else {
                Role::LateUse
            },
        )
    }

    fn select_add(&mut self, value: Value, lhs: Value, rhs: Value) -> bool {
        let has_constant = |value| {
            matches!(self.op(value), Op::Binary(Binary::Add, [_, constant]) if self.immediate(constant).is_some())
                && self.use_count(value) == 1
                && self.is_nearby(value)
        };
        if let Some(offset) = self.immediate(rhs) {
            let is_compound = match self.op(lhs) {
                Op::Binary(Binary::Add, [a, b]) => {
                    !self.is_absorbable_load(a, lhs) && !self.is_absorbable_load(b, lhs)
                }
                Op::SlotAddress(_) => true,
                _ => self.scaled(lhs).is_some(),
            };
            if is_compound && self.use_count(lhs) == 1 {
                let parts = self.address_parts(lhs, offset);
                self.select_lea(value, parts);
                return true;
            }
        } else if self.scaled(lhs).is_some()
            || self.scaled(rhs).is_some()
            || has_constant(lhs)
            || has_constant(rhs)
        {
            let parts = self.sum_parts(lhs, rhs, 0);
            self.select_lea(value, parts);
            return true;
        }
        false
    }

    fn select_int_binary(&mut self, value: Value, op: Binary, lhs: Value, rhs: Value) {
        let width = self.type_of(value).width();
        match op {
            Binary::Add if self.select_add(value, lhs, rhs) => {}
            Binary::Sub if self.int_constant(lhs) == Some(0) => {
                self.select_in_place(value, rhs, Inst::Unary(UnaryOp::Neg, width));
            }
            Binary::Xor if self.int_constant(rhs) == Some(-1) => {
                self.select_in_place(value, lhs, Inst::Unary(UnaryOp::Not, width));
            }
            Binary::And if self.select_mask(value, width, lhs, rhs) => {}
            Binary::Add | Binary::Sub | Binary::And | Binary::Or | Binary::Xor => {
                let (lhs, rhs) = if op.is_commutative() {
                    self.order_operands(lhs, rhs, value)
                } else {
                    (lhs, rhs)
                };
                let matched = self.match_source(rhs, value);
                let source = self.use_two_address(value, lhs, matched, op.is_commutative());
                self.finish(Inst::Alu(alu_for(op).unwrap(), width, source));
            }
            Binary::Mul => self.select_mul(value, width, lhs, rhs),
            Binary::Div | Binary::UnsignedDiv | Binary::Rem | Binary::UnsignedRem => {
                if matches!(op, Binary::Div | Binary::UnsignedDiv) {
                    self.def_fixed(value, 0, RAX);
                    self.temp_fixed(RDX);
                } else {
                    self.def_fixed_early(value, RDX);
                    self.overwrite(RAX);
                }
                self.use_fixed(lhs, Role::Use, RAX);
                self.use_value(rhs, Role::LateUse, Place::RegisterOrMemory);
                let sign = if matches!(op, Binary::Div | Binary::Rem) {
                    Sign::Signed
                } else {
                    Sign::Unsigned
                };
                self.finish(Inst::Divide(sign, width));
            }
            Binary::MulHigh(sign) => {
                self.def_fixed(value, 0, RDX);
                self.overwrite(RAX);
                self.finish_multiplication(sign, width, lhs, rhs);
            }
            Binary::Shl => self.select_shift(value, ShiftOp::Shl, Some(ShiftX::Shlx), lhs, rhs),
            Binary::Shr => self.select_shift(value, ShiftOp::Shr, Some(ShiftX::Shrx), lhs, rhs),
            Binary::Sar => self.select_shift(value, ShiftOp::Sar, Some(ShiftX::Sarx), lhs, rhs),
            Binary::RotateLeft => self.select_shift(value, ShiftOp::Rol, None, lhs, rhs),
            Binary::RotateRight => self.select_shift(value, ShiftOp::Ror, None, lhs, rhs),
            Binary::TotalDiv | Binary::TotalRem | Binary::Min | Binary::Max | Binary::CopySign => {
                unreachable!("has no instruction")
            }
        }
    }

    fn finish_multiplication(&mut self, sign: Sign, width: Width, lhs: Value, rhs: Value) {
        self.use_fixed(lhs, Role::Use, RAX);
        self.use_value(rhs, Role::Use, Place::RegisterOrMemory);
        self.finish(Inst::MulRdxRax(sign, width));
    }

    fn select_mask(&mut self, value: Value, width: Width, lhs: Value, rhs: Value) -> bool {
        match self.constant_bits(rhs) {
            Some(0xff) => self.select_extension(value, Size::S8, Sign::Unsigned, Width::W32, lhs),
            Some(0xffff) => {
                self.select_extension(value, Size::S16, Sign::Unsigned, Width::W32, lhs)
            }
            Some(0xffff_ffff) => {
                self.select_extension(value, Size::S32, Sign::Unsigned, Width::W32, lhs)
            }
            Some(mask @ ..0xffff_ffff)
                if width == Width::W64 && !self.is_absorbable_load(lhs, value) =>
            {
                let source = self.use_two_address(value, lhs, Matched::Imm(mask as i32), true);
                self.finish(Inst::Alu(Alu::And, Width::W32, source));
            }
            None if self.has(X64Features::BMI1) => {
                let complemented = |operand| match self.op(operand) {
                    Op::Binary(Binary::Xor, [inner, ones])
                        if self.int_constant(ones) == Some(-1) =>
                    {
                        (!self.is_materialized(operand) && self.is_nearby(operand)).then_some(inner)
                    }
                    _ => None,
                };
                let Some((inner, other)) = complemented(lhs)
                    .zip(Some(rhs))
                    .or_else(|| complemented(rhs).zip(Some(lhs)))
                else {
                    return false;
                };
                self.def(value);
                self.use_register(inner);
                self.use_value(other, Role::Use, Place::RegisterOrMemory);
                self.finish(Inst::AndNot(width));
            }
            _ => return false,
        }
        true
    }

    fn select_mul(&mut self, value: Value, width: Width, lhs: Value, rhs: Value) {
        let (lhs, rhs) = self.order_operands(lhs, rhs, value);
        match self.immediate(rhs) {
            Some(factor @ (3 | 5 | 9)) => {
                let scale = Scale::from_log2((factor - 1).ilog2() as u8).unwrap();
                self.select_lea(
                    value,
                    AddressParts {
                        base: Base::Value(lhs),
                        index: Some((lhs, scale)),
                        offset: 0,
                    },
                );
            }
            _ => {
                let matched = self.match_source(rhs, value);
                let source = self.use_two_address(value, lhs, matched, true);
                self.finish(Inst::Mul(width, source));
            }
        }
    }

    fn select_shift(
        &mut self,
        value: Value,
        op: ShiftOp,
        without_rcx: Option<ShiftX>,
        lhs: Value,
        mut amount: Value,
    ) {
        let width = self.type_of(value).width();
        if let Some(constant) = self.int_constant(amount) {
            return match constant as u8 % width.bits() {
                0 => self.copy(value, lhs),
                constant => self.select_in_place(value, lhs, Inst::ShiftImm(op, width, constant)),
            };
        }
        let counted = u64::from(width.bits() - 1);
        if let Op::Binary(Binary::And, [inner, mask]) = self.op(amount)
            && self
                .constant_bits(mask)
                .is_some_and(|mask| mask & counted == counted)
            && !self.is_materialized(amount)
        {
            amount = inner;
        }
        match without_rcx.filter(|_| self.has(X64Features::BMI2)) {
            Some(op) => {
                self.def(value);
                self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
                self.use_register(amount);
                self.finish(Inst::ShiftX(op, width));
            }
            None => {
                self.def_tied(value, 1, None);
                self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
                self.use_fixed(amount, Role::LateUse, RCX);
                let has_upper_half = width == Width::W32 && !self.is_zero_extended(lhs);
                self.finish(Inst::ShiftCl(op, width, has_upper_half));
            }
        }
    }

    fn select_checked(&mut self, value: Value, op: Checked, lhs: Value, rhs: Value) {
        let (lhs, rhs) = if op == Checked::Sub {
            (lhs, rhs)
        } else {
            self.order_operands(lhs, rhs, value)
        };
        let can_undo = op != Checked::Mul
            && self.representative(lhs) != self.representative(rhs)
            && self.representative(lhs) == lhs
            && !self.op(lhs).is_floating();
        let matched = self
            .immediate(rhs)
            .map_or(Matched::Value(rhs), Matched::Imm);
        let source = self.use_two_address(value, lhs, matched, op == Checked::Mul);
        self.exit_of(value, can_undo.then_some(lhs));
        self.finish(Inst::Checked(op, self.type_of(value).width(), source));
    }

    fn select_float_binary(&mut self, value: Value, op: Binary, lhs: Value, rhs: Value) {
        let is_single = self.type_of(value) == Type::F32;
        let pick = |single, double| if is_single { single } else { double };
        let (op, reads_whole_vector) = match op {
            Binary::Add => (pick(Sse::Addss, Sse::Addsd), false),
            Binary::Sub => (pick(Sse::Subss, Sse::Subsd), false),
            Binary::Mul => (pick(Sse::Mulss, Sse::Mulsd), false),
            Binary::Div => (pick(Sse::Divss, Sse::Divsd), false),
            Binary::And => (Sse::Andps, true),
            Binary::Or => (Sse::Orps, true),
            Binary::Xor => (Sse::Xorps, true),
            _ => return self.select_shared(value),
        };
        self.select_sse(value, op, lhs, rhs, !reads_whole_vector);
    }

    fn select_sse(&mut self, value: Value, op: Sse, lhs: Value, rhs: Value, may_read_memory: bool) {
        let (lhs, rhs) = if op.commutes() {
            self.order_operands(lhs, rhs, value)
        } else {
            (lhs, rhs)
        };
        let matched = if may_read_memory {
            self.match_value_or_load(rhs, value)
        } else {
            Matched::Value(rhs)
        };
        let keeps_rhs = !self.has(X64Features::AVX) && !op.commutes();
        self.def_tied(
            value,
            1,
            (!keeps_rhs && matches!(matched, Matched::Value(_))).then_some(2),
        );
        self.use_register(lhs);
        let role = if keeps_rhs { Role::LateUse } else { Role::Use };
        let source = if may_read_memory {
            self.use_matched(matched, role)
        } else {
            self.use_value(rhs, role, Place::Register);
            Source::Value
        };
        self.finish(Inst::Sse(op, source));
    }

    fn select_choice(&mut self, value: Value, condition: Value, then: Value, or: Value) {
        self.def_tied(value, 2, Some(1));
        if !self.type_of(value).is_int() {
            self.use_register(then);
            self.use_register(or);
            let test = self.use_condition(condition, value);
            return self.finish(Inst::SelectFloat(test));
        }
        if self.op(or).is_constant() {
            self.use_value(then, Role::LateUse, Place::RegisterOrMemory);
            self.use_value(or, Role::Use, Place::Anywhere);
        } else if self.op(then).is_constant() {
            self.use_value(then, Role::Use, Place::Anywhere);
            self.use_value(or, Role::LateUse, Place::RegisterOrMemory);
        } else {
            self.use_value(then, Role::Use, Place::RegisterOrMemory);
            self.use_value(or, Role::Use, Place::RegisterOrMemory);
        }
        let test = self.use_condition(condition, value);
        self.finish(Inst::Select(test));
    }

    /// A load of what the store overwrites, which only serves to compute `stored`.
    fn is_old_value(&self, value: Value, store: Value, size: Size) -> bool {
        let Op::Store {
            args: [_, address],
            offset,
            access,
            ..
        } = self.op(store)
        else {
            unreachable!("not a store")
        };
        let Op::Load {
            kind,
            address: loaded_from,
            offset: loaded_at,
            access: read,
        } = self.op(value)
        else {
            return false;
        };
        let loaded = if let Load::Narrow(size, _) = kind {
            size
        } else {
            self.type_of(value).width().size()
        };
        (loaded, loaded_from, loaded_at) == (size, address, offset)
            && read.has(AccessFlags::TRAPS) == access.has(AccessFlags::TRAPS)
            && self.can_absorb(value, store)
    }

    fn select_update(
        &mut self,
        store: Value,
        size: Size,
        stored: Value,
        address: Value,
        offset: i32,
    ) -> bool {
        if self.use_count(stored) != 1 || !self.is_in_this_block(stored) {
            return false;
        }
        let unary = match self.op(stored) {
            Op::Unary(Unary::Neg, old) => Some((UnaryOp::Neg, old)),
            Op::Binary(Binary::Xor, [old, ones]) if self.int_constant(ones) == Some(-1) => {
                Some((UnaryOp::Not, old))
            }
            _ => None,
        };
        if let Some((op, old)) = unary.filter(|&(_, old)| self.is_old_value(old, store, size)) {
            self.absorb(old);
            let address = self.use_address(address, offset, Role::Use);
            self.finish(Inst::UpdateUnary(op, size, address));
            return true;
        }
        let Op::Binary(op, [lhs, rhs]) = self.op(stored) else {
            return false;
        };
        let Some(alu) = alu_for(op) else { return false };
        let (old, operand) = if self.is_old_value(lhs, store, size) {
            (lhs, rhs)
        } else if op.is_commutative() && self.is_old_value(rhs, store, size) {
            (rhs, lhs)
        } else {
            return false;
        };
        self.absorb(old);
        let src = self.use_stored(operand, size, Role::Use);
        let address = self.use_address(address, offset, Role::Use);
        self.finish(Inst::Update {
            op: alu,
            size,
            src,
            address,
            is_atomic: false,
        });
        true
    }

    fn select_store(
        &mut self,
        store: Value,
        kind: Store,
        stored: Value,
        address: Value,
        offset: i32,
        access: Access,
    ) {
        let ty = self.type_of(stored);
        if ty == Type::V128 || ty.is_float() && !self.op(stored).is_constant() {
            self.use_register(stored);
            let address = self.use_address(address, offset, Role::Use);
            return self.finish(Inst::StoreFloat(ty, address));
        }
        let size = if let Store::Narrow(size) = kind {
            size
        } else {
            ty.width().size()
        };
        if access.has(AccessFlags::ATOMIC) {
            self.temp(Bank::Gpr);
            self.use_value(stored, Role::Use, Place::Anywhere);
            let address = self.use_address(address, offset, Role::Use);
            return self.finish(Inst::AtomicStore(size, address));
        }
        if ty.is_int() && self.select_update(store, size, stored, address, offset) {
            return;
        }
        let stored = match self.constant_bits(stored) {
            Some(bits) if ty.is_float() => self.intern(ty.width().into(), bits),
            _ => stored,
        };
        let src = self.use_stored(stored, size, Role::Use);
        let address = self.use_address(address, offset, Role::Use);
        self.finish(Inst::Store(size, src, address));
    }

    fn select_atomic_update(
        &mut self,
        value: Value,
        op: AtomicOp,
        size: Size,
        operand: Value,
        address: Value,
    ) {
        let alu = match op {
            AtomicOp::Add => Some(Alu::Add),
            AtomicOp::Sub => Some(Alu::Sub),
            AtomicOp::And => Some(Alu::And),
            AtomicOp::Or => Some(Alu::Or),
            AtomicOp::Xor => Some(Alu::Xor),
            AtomicOp::Exchange => None,
        };
        if let Some(op) = alu.filter(|_| !self.is_materialized(value)) {
            let src = self.use_stored(operand, size, Role::Use);
            let address = self.use_address(address, 0, Role::Use);
            self.finish(Inst::Update {
                op,
                size,
                src,
                address,
                is_atomic: true,
            });
        } else if matches!(op, AtomicOp::Add | AtomicOp::Sub | AtomicOp::Exchange) {
            self.def_tied(value, 1, None);
            self.use_value(operand, Role::Use, Place::Anywhere);
            let address = self.use_address(address, 0, Role::LateUse);
            self.finish(Inst::AtomicExchange(op, size, address));
        } else {
            self.def_fixed_early(value, RAX);
            self.temp(Bank::Gpr);
            self.use_register(operand);
            let address = self.use_address(address, 0, Role::Use);
            self.finish(Inst::AtomicLoop(op, size, address));
        }
    }
}
