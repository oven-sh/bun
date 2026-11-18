//! Comparisons and tests, and the branches that need no flags.

use super::constant::ConstantMove;
use super::immediate::{ArithmeticImm, BitmaskImm};
use super::macro_assembler::{MacroAssembler, all_ones, unsigned};
use super::opcode::{AddSub, Bitfield, Cc};
use super::registers::{SP, ZR};
use crate::label::Label;
use crate::operand::{Cond, Memory, RegOrImm, RegOrMem, Size, Src, TestCond, Width};
use crate::register::Gpr;

enum Mask {
    Reg(Gpr),
    /// With the narrowest width that gives the same outcome.
    Constant(Width, u64),
}

impl Mask {
    #[inline(always)]
    fn new(width: Width, cond: TestCond, value: Gpr, mask: RegOrImm) -> Self {
        let mask = match mask {
            RegOrImm::Reg(mask) if mask != value => return Self::Reg(mask),
            RegOrImm::Reg(_) => all_ones(width),
            RegOrImm::Imm(mask) | RegOrImm::Untrusted(mask) => unsigned(width, mask),
        };
        if mask >> 32 == 0 && matches!(cond, TestCond::Zero | TestCond::NonZero) {
            Self::Constant(Width::W32, mask)
        } else {
            Self::Constant(width, mask)
        }
    }
}

/// What a test with a constant comes down to.
#[derive(Clone, Copy)]
enum Test {
    /// `Zero` or `NonZero` of the whole value.
    Whole,
    Bit {
        number: u8,
        holds_if_set: bool,
    },
    Masked,
}

#[inline(always)]
fn classify(width: Width, cond: TestCond, mask: u64) -> Test {
    let sign = width.bits() - 1;
    match cond {
        TestCond::Zero | TestCond::NonZero if mask == all_ones(width) => Test::Whole,
        TestCond::Zero | TestCond::NonZero if mask.is_power_of_two() => Test::Bit {
            number: mask.trailing_zeros() as u8,
            holds_if_set: cond == TestCond::NonZero,
        },
        TestCond::Negative | TestCond::NonNegative if mask >> sign != 0 => Test::Bit {
            number: sign,
            holds_if_set: cond == TestCond::Negative,
        },
        _ => Test::Masked,
    }
}

/// The comparison with zero as a test of all bits.
#[inline(always)]
fn test_for_zero(cond: Cond) -> Option<TestCond> {
    match cond {
        Cond::Eq | Cond::BelowEq => Some(TestCond::Zero),
        Cond::Ne | Cond::Above => Some(TestCond::NonZero),
        Cond::Lt => Some(TestCond::Negative),
        Cond::Ge => Some(TestCond::NonNegative),
        Cond::Le | Cond::Gt | Cond::Below | Cond::AboveEq => None,
    }
}

/// The same comparison with the constant next to `value`, unless that is at the end of the range.
fn with_neighbour(cond: Cond, value: i64) -> Option<(Cond, i64)> {
    let (cond, step) = match cond {
        Cond::Eq | Cond::Ne => return None,
        Cond::Lt => (Cond::Le, -1),
        Cond::Ge => (Cond::Gt, -1),
        Cond::Le => (Cond::Lt, 1),
        Cond::Gt => (Cond::Ge, 1),
        Cond::Below => (Cond::BelowEq, -1),
        Cond::AboveEq => (Cond::Above, -1),
        Cond::BelowEq => (Cond::Below, 1),
        Cond::Above => (Cond::AboveEq, 1),
    };
    Some((cond, value.wrapping_add(step)))
}

#[inline(always)]
fn low_bytes(size: Size, value: i32) -> u32 {
    assert!(size < Size::S32);
    value as u32 & ((1 << size.bits()) - 1)
}

#[inline(always)]
fn with_sign_of_low_bytes(size: Size, value: i32) -> i32 {
    let above = 32 - size.bits();
    value << above >> above
}

impl MacroAssembler {
    #[inline(always)]
    pub(super) fn set_flags_for_compare(
        &mut self,
        width: Width,
        cond: Cond,
        lhs: RegOrMem,
        rhs: Src,
    ) -> Cc {
        let lhs = self.register_for(width, lhs.into());
        if let Src::Imm(rhs) | Src::Untrusted(rhs) = rhs {
            return self.compare_with_constant(width, cond, lhs, rhs);
        }
        let rhs = self.register_for(width, rhs);
        self.add_sub_registers(AddSub::Subs, width, ZR, lhs, rhs);
        cond.into()
    }

    #[inline(always)]
    fn compare_with_constant(&mut self, width: Width, cond: Cond, lhs: Gpr, rhs: i64) -> Cc {
        match AddSub::Subs.with_constant(width, rhs) {
            Some((op, imm)) => {
                self.asm.add_sub_imm(op, width, ZR, lhs, imm);
                cond.into()
            }
            None => self.compare_with_long_constant(width, cond, lhs, rhs),
        }
    }

    fn compare_with_long_constant(&mut self, width: Width, cond: Cond, lhs: Gpr, rhs: i64) -> Cc {
        // The unsigned range ends at constants that are short, the signed range beside constants that are not.
        if let Some((cond, rhs)) = with_neighbour(cond, rhs)
            && let Some((op, imm)) = AddSub::Subs.with_constant(width, rhs)
        {
            self.asm.add_sub_imm(op, width, ZR, lhs, imm);
            return cond.into();
        }
        let (temp, constant) = (
            self.scratch_beside(lhs),
            ConstantMove::new(width, rhs as u64),
        );
        if matches!(cond, Cond::Eq | Cond::Ne)
            && constant.instructions() > 1
            && let Some((op, high)) = AddSub::Sub.with_constant(width, rhs & !0xfff)
            && let Some(low) = ArithmeticImm::new(rhs as u64 & 0xfff)
        {
            self.asm.add_sub_imm(op, width, temp, lhs, high);
            self.asm.cmp_imm(width, temp, low);
            return cond.into();
        }
        self.asm.move_constant(temp, constant);
        self.add_sub_registers(AddSub::Subs, width, ZR, lhs, temp);
        cond.into()
    }

    #[inline(always)]
    pub(super) fn compare_and_branch(
        &mut self,
        width: Width,
        cond: Cond,
        lhs: RegOrMem,
        rhs: Src,
        target: Label,
    ) {
        if let Src::Imm(rhs) | Src::Untrusted(rhs) = rhs
            && unsigned(width, rhs) == 0
            && lhs != RegOrMem::Reg(SP)
            && let Some(cond) = test_for_zero(cond)
        {
            return self.test_and_branch(width, cond, lhs, RegOrImm::Imm(-1), target);
        }
        let cc = self.set_flags_for_compare(width, cond, lhs, rhs);
        self.asm.b_cond(cc, target);
    }

    /// Loads one or two bytes, and returns `rhs` extended in the same way for a comparison of 32 bits.
    #[inline(always)]
    pub(super) fn load_narrow_to_compare(
        &mut self,
        size: Size,
        cond: Cond,
        lhs: Memory,
        rhs: i32,
    ) -> (Gpr, i32) {
        let fits = |value: i32| {
            AddSub::Subs
                .with_constant(Width::W32, value.into())
                .is_some()
        };
        let (with_zeros, with_sign) = (
            low_bytes(size, rhs) as i32,
            with_sign_of_low_bytes(size, rhs),
        );
        // Extending the sign also keeps the unsigned order.
        if cond.is_signed() || !fits(with_zeros) && fits(with_sign) {
            (self.load_data_signed(size, lhs), with_sign)
        } else {
            (self.load_data(size, lhs), with_zeros)
        }
    }

    /// Loads one or two bytes, and returns the mask for a test of 32 bits.
    #[inline(always)]
    pub(super) fn load_narrow_to_test(
        &mut self,
        size: Size,
        cond: TestCond,
        value: Memory,
        mask: i32,
    ) -> (Gpr, TestCond, u32) {
        let mask = low_bytes(size, mask);
        let (cond, mask) = match cond {
            TestCond::Negative => (TestCond::NonZero, mask & 1 << (size.bits() - 1)),
            TestCond::NonNegative => (TestCond::Zero, mask & 1 << (size.bits() - 1)),
            TestCond::Zero | TestCond::NonZero => (cond, mask),
        };
        // What is above the bytes is clear, so the mask may be repeated there.
        let repeated = mask * (u32::MAX / low_bytes(size, -1));
        let is_better = !mask.is_power_of_two()
            && (repeated == u32::MAX || BitmaskImm::new(Width::W32, repeated.into()).is_some());
        let mask = if is_better { repeated } else { mask };
        (self.load_data(size, value), cond, mask)
    }

    #[inline(always)]
    fn load_data_signed(&mut self, size: Size, src: Memory) -> Gpr {
        let data = self.data_scratch();
        let src = self.mem_for_load(size, src, data);
        self.asm.ldrs(Width::W32, data, src);
        data
    }

    #[inline(always)]
    pub(super) fn set_flags_for_test(
        &mut self,
        width: Width,
        cond: TestCond,
        value: RegOrMem,
        mask: RegOrImm,
    ) -> Cc {
        let value = self.register_for(width, value.into());
        match Mask::new(width, cond, value, mask) {
            Mask::Constant(width, mask) => self.test_with_constant(width, value, mask),
            Mask::Reg(mask) => self.asm.tst(width, value, mask),
        }
        cond.into()
    }

    fn test_with_constant(&mut self, width: Width, value: Gpr, mask: u64) {
        if mask == all_ones(width) {
            return self.asm.tst(width, value, value);
        }
        if let Some(mask) = BitmaskImm::new(width, mask) {
            return self.asm.tst_imm(value, mask);
        }
        let mask = self.constant_beside(value, width, mask as i64);
        self.asm.tst(width, value, mask);
    }

    #[inline(always)]
    pub(super) fn test_and_branch(
        &mut self,
        width: Width,
        cond: TestCond,
        value: RegOrMem,
        mask: RegOrImm,
        target: Label,
    ) {
        let value = self.register_for(width, value.into());
        match Mask::new(width, cond, value, mask) {
            Mask::Constant(width, mask) => match classify(width, cond, mask) {
                Test::Whole if cond == TestCond::Zero => {
                    return self.asm.cbz(width, value, target);
                }
                Test::Whole => return self.asm.cbnz(width, value, target),
                Test::Bit {
                    number,
                    holds_if_set,
                } => return self.branch_on_bit(value, number, holds_if_set, target),
                Test::Masked => self.test_with_constant(width, value, mask),
            },
            Mask::Reg(mask) => self.asm.tst(width, value, mask),
        }
        self.asm.b_cond(cond.into(), target);
    }

    #[inline]
    pub(super) fn branch_on_bit(&mut self, value: Gpr, number: u8, if_set: bool, target: Label) {
        if if_set {
            self.asm.tbnz(value, number, target);
        } else {
            self.asm.tbz(value, number, target);
        }
    }

    #[inline(always)]
    pub(super) fn test_and_set(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Gpr,
        value: RegOrMem,
        mask: RegOrImm,
    ) {
        let value = self.register_for(width, value.into());
        if let Mask::Constant(width, mask) = Mask::new(width, cond, value, mask)
            && let Test::Bit {
                number,
                holds_if_set: true,
            } = classify(width, cond, mask)
        {
            return self
                .asm
                .bitfield_extract(Bitfield::Ubfm, width, dst, value, number, 1);
        }
        let cc = self.set_flags_for_test(width, cond, value.into(), mask);
        self.asm.cset(dst, cc);
    }
}
