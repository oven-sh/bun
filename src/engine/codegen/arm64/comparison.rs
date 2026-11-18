//! Single comparisons.

use bun_engine_asm::arm64::{
    AddSub, BitmaskImm, Cc, ConditionalCompare, FloatFlags, Logical, Nzcv,
};
use bun_engine_asm::{Cond, FloatCond, FloatWidth, Width};

use super::instruction::{Addend, Inst, Mask, Setting, Test};
use super::operand::{Matched, arithmetic_imm};
use crate::ir::{Binary, Op, Type, Value};
use crate::machine::{Lowering, Role};

/// An instruction that sets the flags.
#[derive(Clone, Copy)]
pub(super) enum Setter {
    Zero(Width, Value),
    /// With a mask that is one run of ones.
    Field(Width, Value, u64),
    Compare(Width, Matched<AddSub, Addend>),
    TestBits(Matched<Logical, Mask>),
    NumberedBit(Width, Value, Value),
    /// The right side is `NONE` for zero.
    Floats(FloatWidth, Value, Value),
}

#[derive(Clone, Copy)]
pub(super) struct Comparison {
    pub(super) setter: Setter,
    pub(super) flags: FloatFlags,
}

/// How much the instruction can do to its operands.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Form {
    Any,
    Conditional,
}

const CONDITIONAL_IMM_END: u64 = 32;

fn fits(form: Form, constant: i64) -> bool {
    match form {
        Form::Any => arithmetic_imm(AddSub::Subs, constant).is_some(),
        Form::Conditional => constant.unsigned_abs() < CONDITIONAL_IMM_END,
    }
}

/// The same comparison with the constant next to `constant`, which is at neither end of the range.
fn with_neighbour(cond: Cond, constant: i64) -> Option<(Cond, i64)> {
    Some(match cond {
        Cond::Eq | Cond::Ne => return None,
        Cond::Lt => (Cond::Le, constant.wrapping_sub(1)),
        Cond::Ge => (Cond::Gt, constant.wrapping_sub(1)),
        Cond::Le => (Cond::Lt, constant.wrapping_add(1)),
        Cond::Gt => (Cond::Ge, constant.wrapping_add(1)),
        Cond::Below => (Cond::BelowEq, constant.wrapping_sub(1)),
        Cond::AboveEq => (Cond::Above, constant.wrapping_sub(1)),
        Cond::BelowEq => (Cond::Below, constant.wrapping_add(1)),
        Cond::Above => (Cond::AboveEq, constant.wrapping_add(1)),
    })
}

/// Flags under which `cc` holds.
pub(super) fn flags_for(cc: Cc) -> Nzcv {
    match cc {
        Cc::Eq | Cc::Le => Nzcv::Z,
        Cc::Hs | Cc::Hi => Nzcv::C,
        Cc::Mi | Cc::Lt => Nzcv::N,
        Cc::Vs => Nzcv::V,
        Cc::Ne | Cc::Lo | Cc::Pl | Cc::Vc | Cc::Ls | Cc::Ge | Cc::Gt => Nzcv::empty(),
    }
}

impl Comparison {
    fn new(setter: Setter, cc: Cc) -> Self {
        let flags = FloatFlags::One(cc);
        Self { setter, flags }
    }

    pub(super) fn inverted_if(self, is_inverted: bool) -> Self {
        let flags = if is_inverted {
            self.flags.inverted()
        } else {
            self.flags
        };
        Self { flags, ..self }
    }

    /// A jump that does without the flags, and its operands.
    pub(super) fn direct_test(self) -> Option<(Test, [Value; 2])> {
        let FloatFlags::One(cc) = self.flags else {
            return None;
        };
        let (if_set, value, bit) = match (self.setter, cc) {
            (Setter::Zero(width, value), Cc::Eq | Cc::Ne) => {
                (Test::NotZero(width), value, Value::NONE)
            }
            (Setter::Zero(width, value), Cc::Lt | Cc::Ge) => {
                (Test::BitSet(width.bits() - 1), value, Value::NONE)
            }
            (Setter::Field(_, value, mask), _) if mask.is_power_of_two() => {
                (Test::BitSet(mask.ilog2() as u8), value, Value::NONE)
            }
            (Setter::NumberedBit(width, value, bit), _) => {
                (Test::NumberedBitSet(width), value, bit)
            }
            _ => return None,
        };
        let test = if matches!(cc, Cc::Ne | Cc::Lt) {
            if_set
        } else {
            if_set.inverted()
        };
        Some((test, [value, bit]))
    }
}

impl Lowering<'_, Inst> {
    pub(super) fn can_repeat(&self, value: Value) -> bool {
        !self.is_materialized(value) && self.is_nearby(value)
    }

    fn match_and(&self, lhs: Value, rhs: Value) -> Comparison {
        let width = self.type_of(lhs).width();
        for (value, other) in [(lhs, rhs), (rhs, lhs)] {
            if let Op::Binary(Binary::Shl, [one, bit]) = self.op(other)
                && self.int_constant(one) == Some(1)
                && self.can_repeat(other)
            {
                return Comparison::new(Setter::NumberedBit(width, value, bit), Cc::Ne);
            }
        }
        let matched = self.match_logical(Logical::Ands, lhs, rhs);
        if let (Mask::Shifted(..), Some(mask)) = (matched.form, self.constant_bits(rhs))
            && let Some(imm) = BitmaskImm::new(Width::W32, mask).filter(|_| mask >> 32 == 0)
        {
            let (op, form, rhs) = (Logical::Ands, Mask::Imm(imm), Value::NONE);
            let narrow = Matched { op, form, lhs, rhs };
            return Comparison::new(Setter::TestBits(narrow), Cc::Ne);
        }
        Comparison::new(Setter::TestBits(matched), Cc::Ne)
    }

    /// Whether `value` is not zero.
    pub(super) fn match_truth(&mut self, value: Value, form: Form) -> Comparison {
        let width = self.type_of(value).width();
        if !self.can_repeat(value) {
            return Comparison::new(Setter::Zero(width, value), Cc::Ne);
        }
        let is_alone = self.use_count(value) == 1;
        match self.op(value) {
            Op::Compare(cond, [lhs, rhs]) => return self.match_compare(cond, lhs, rhs, form),
            Op::FloatCompare(cond, [lhs, rhs]) => {
                return self.match_float_compare(cond, lhs, rhs, form);
            }
            Op::Binary(Binary::Sub | Binary::Xor, [lhs, rhs])
                if is_alone && !self.is_zero(lhs) && !self.is_zero(rhs) =>
            {
                return self.match_compare(Cond::Ne, lhs, rhs, form);
            }
            Op::Binary(Binary::Add, [lhs, rhs]) if is_alone => {
                return Comparison::new(self.match_sum(lhs, rhs, form), Cc::Ne);
            }
            _ => {}
        }
        let field = self.match_field(value, |field| {
            let is_register = field.first == 0 && matches!(field.count, 32 | 64);
            let is_worth_a_test = form == Form::Any && (is_alone || field.count == 1);
            (is_register || is_worth_a_test).then_some(field)
        });
        let setter = match (field, self.op(value)) {
            (Some(field), _) => match (field.first, field.count) {
                (0, 32) => Setter::Zero(Width::W32, field.source),
                (0, 64) => Setter::Zero(Width::W64, field.source),
                _ => {
                    let is_low = field.source_end() <= 32;
                    let width = if is_low { Width::W32 } else { Width::W64 };
                    let mask = field.source_mask();
                    match self.complemented(field.source) {
                        Some(inner) if field.count == 1 => {
                            return Comparison::new(Setter::Field(width, inner, mask), Cc::Eq);
                        }
                        _ => Setter::Field(width, field.source, mask),
                    }
                }
            },
            (None, Op::Binary(Binary::And, [lhs, rhs])) if form == Form::Any && is_alone => {
                return self.match_and(lhs, rhs);
            }
            _ => Setter::Zero(width, value),
        };
        Comparison::new(setter, Cc::Ne)
    }

    /// For the zero and sign flags of `lhs + rhs`.
    fn match_sum(&mut self, lhs: Value, rhs: Value, form: Form) -> Setter {
        let (lhs, rhs) = if self.belongs_right(lhs, rhs) {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        self.match_setter(AddSub::Adds, lhs, rhs, form)
    }

    fn match_setter(&self, op: AddSub, lhs: Value, rhs: Value, form: Form) -> Setter {
        let width = self.type_of(lhs).width();
        let matched = match form {
            Form::Any => self.match_add_sub(op, lhs, rhs),
            Form::Conditional => Matched {
                op,
                form: Addend::PLAIN,
                lhs,
                rhs,
            },
        };
        Setter::Compare(width, matched)
    }

    fn match_sign(&mut self, value: Value, form: Form) -> Comparison {
        let width = self.type_of(value).width();
        if self.can_repeat(value) && form == Form::Any {
            let last = self.match_field(value, |field| {
                (field.is_signed || field.end() == width.bits()).then_some(field)
            });
            if let Some(field) = last.filter(|field| field.source_end() != width.bits()) {
                let mask = 1 << (field.source_end() - 1);
                return Comparison::new(Setter::Field(Width::W64, field.source, mask), Cc::Ne);
            }
            if let Some(field) = last {
                return Comparison::new(Setter::Zero(width, field.source), Cc::Lt);
            }
        }
        Comparison::new(Setter::Zero(width, value), Cc::Lt)
    }

    fn match_compare(
        &mut self,
        mut cond: Cond,
        mut lhs: Value,
        mut rhs: Value,
        form: Form,
    ) -> Comparison {
        if self.belongs_right(lhs, rhs) {
            (cond, lhs, rhs) = (cond.commuted(), rhs, lhs);
        }
        let ty = self.type_of(lhs);
        let Some(mut constant) = self.int_constant(rhs) else {
            if matches!(cond, Cond::Eq | Cond::Ne) {
                for (value, other) in [(lhs, rhs), (rhs, lhs)] {
                    if let Some(negated) = self.negated(other) {
                        return Comparison::new(self.match_sum(value, negated, form), cond.into());
                    }
                }
            }
            let setter = self.match_setter(AddSub::Subs, lhs, rhs, form);
            return Comparison::new(setter, cond.into());
        };
        match (cond, constant) {
            (Cond::Ne | Cond::Above, 0) | (Cond::AboveEq, 1) => {
                return self.match_truth_of(lhs, form);
            }
            (Cond::Eq | Cond::BelowEq, 0) | (Cond::Below, 1) => {
                return self.match_truth_of(lhs, form).inverted_if(true);
            }
            (Cond::Lt, 0) | (Cond::Le, -1) => return self.match_sign(lhs, form),
            (Cond::Ge, 0) | (Cond::Gt, -1) => return self.match_sign(lhs, form).inverted_if(true),
            (Cond::Gt | Cond::Le, 0) if self.folded_addend(lhs).is_none() => {
                return Comparison::new(Setter::Zero(ty.width(), lhs), cond.into());
            }
            (Cond::Eq | Cond::Ne, _) => {
                if let Op::Binary(Binary::And, [_, mask]) = self.op(lhs)
                    && mask == rhs
                    && self.constant_bits(mask).is_some_and(u64::is_power_of_two)
                {
                    return self.match_truth_of(lhs, form).inverted_if(cond == Cond::Ne);
                }
            }
            _ => {}
        }
        // What is next to a constant that fits, and does not fit itself, is far from the ends.
        if !fits(form, constant)
            && let Some(neighbour) = with_neighbour(cond, constant).filter(|&(_, c)| fits(form, c))
        {
            (cond, constant) = neighbour;
            rhs = self.intern(ty, constant as u64);
        }
        // The constant gets into a register outside the loop.
        if form == Form::Any
            && self.is_in_loop()
            && self.use_count(lhs) == 1
            && self.folded_addend(lhs).is_some()
        {
            (cond, lhs, rhs) = (cond.commuted(), rhs, lhs);
        }
        let setter = self.match_setter(AddSub::Subs, lhs, rhs, form);
        Comparison::new(setter, cond.into())
    }

    /// Comparisons of comparisons have been looked through where that is wanted.
    fn match_truth_of(&mut self, value: Value, form: Form) -> Comparison {
        if matches!(self.op(value), Op::Compare(..) | Op::FloatCompare(..)) {
            return Comparison::new(Setter::Zero(Width::W32, value), Cc::Ne);
        }
        self.match_truth(value, form)
    }

    fn match_float_compare(
        &self,
        mut cond: FloatCond,
        mut lhs: Value,
        mut rhs: Value,
        form: Form,
    ) -> Comparison {
        let width = self.type_of(lhs).float_width();
        let magnitude = u64::MAX >> (65 - width.width().bits());
        let is_zero = |value| {
            self.constant_bits(value)
                .is_some_and(|bits| bits & magnitude == 0)
        };
        if is_zero(lhs) {
            (cond, lhs, rhs) = (cond.commuted(), rhs, lhs);
        }
        if is_zero(rhs) {
            if matches!(cond, FloatCond::Ordered | FloatCond::Unordered) {
                rhs = lhs;
            } else if form == Form::Any {
                rhs = Value::NONE;
            }
        }
        Comparison {
            setter: Setter::Floats(width, lhs, rhs),
            flags: cond.into(),
        }
    }

    pub(super) fn finish_comparison(&mut self, comparison: Comparison) {
        let setting = match comparison.setter {
            Setter::Zero(width, value) => {
                self.use_register(value);
                match comparison.flags {
                    FloatFlags::One(Cc::Lt | Cc::Ge) => Setting::Sign(width),
                    _ => Setting::Zero(width),
                }
            }
            Setter::Field(width, value, mask) => {
                self.use_register(value);
                let mask = BitmaskImm::new(width, mask).unwrap();
                Setting::TestBits(Logical::Ands, Mask::Imm(mask))
            }
            Setter::Compare(width, matched) => {
                self.use_add_sub(matched, Role::Use);
                Setting::Compare(matched.op, width, matched.form)
            }
            Setter::TestBits(matched) => {
                self.use_logical(matched);
                Setting::TestBits(matched.op, matched.form)
            }
            Setter::NumberedBit(width, value, bit) => {
                self.use_register(value);
                self.use_register(bit);
                Setting::NumberedBit(width)
            }
            Setter::Floats(width, lhs, rhs) => {
                self.use_register(lhs);
                match rhs.expand() {
                    Some(rhs) => {
                        self.use_register(rhs);
                        Setting::Floats(width)
                    }
                    None => Setting::FloatZero(width),
                }
            }
        };
        self.finish(Inst::SetFlags(setting));
    }

    /// Compares if `cc` holds, and otherwise sets the flags to `or`. The setter has the conditional form.
    pub(super) fn finish_conditional_setter(&mut self, setter: Setter, or: Nzcv, cc: Cc) {
        use ConditionalCompare::{Ccmn, Ccmp};
        let instruction = match setter {
            Setter::Zero(width, value) => {
                self.use_or_zero(value, Role::Use);
                Inst::CompareIf(Ccmp, width, Some(0), or, cc)
            }
            Setter::Compare(width, Matched { op, lhs, rhs, .. }) => {
                self.use_or_zero(lhs, Role::Use);
                let constant = self
                    .int_constant(rhs)
                    .filter(|&constant| fits(Form::Conditional, constant));
                if constant.is_none() {
                    self.use_register(rhs);
                }
                let subtracts = (op == AddSub::Subs) != constant.is_some_and(|c| c < 0);
                let op = if subtracts { Ccmp } else { Ccmn };
                let imm = constant.map(|constant| constant.unsigned_abs() as u8);
                Inst::CompareIf(op, width, imm, or, cc)
            }
            Setter::Floats(width, lhs, rhs) => {
                self.use_register(lhs);
                self.use_register(rhs);
                Inst::CompareFloatsIf(width, or, cc)
            }
            _ => unreachable!("has no conditional form"),
        };
        self.finish(instruction);
    }

    /// An instruction is saved if this comes first among several.
    pub(super) fn needs_unconditional_form(&mut self, value: Value) -> bool {
        match self.match_truth(value, Form::Any).setter {
            Setter::Zero(..) => false,
            Setter::Compare(_, matched) => {
                let plain = self.match_truth(value, Form::Conditional).setter;
                let has_short_constant = matches!(plain, Setter::Compare(_, plain)
                    if self.int_constant(plain.rhs).is_some_and(|c| fits(Form::Conditional, c)));
                !matches!(matched.form, Addend::Shifted(_, 0)) && !has_short_constant
            }
            Setter::Floats(_, _, rhs) => rhs.is_none(),
            Setter::Field(..) | Setter::TestBits(_) | Setter::NumberedBit(..) => true,
        }
    }

    pub(super) fn is_boolean(&self, value: Value, depth: u32) -> bool {
        let inner = |value| depth != 0 && self.is_boolean(value, depth - 1);
        match self.op(value) {
            Op::Compare(..) | Op::FloatCompare(..) => true,
            Op::Binary(Binary::And, [a, b]) => inner(a) || inner(b),
            Op::Binary(Binary::Or | Binary::Xor, [a, b]) => inner(a) && inner(b),
            Op::Unary(crate::ir::Unary::Widen(_), narrow) => inner(narrow),
            Op::Const32(0 | 1) => true,
            _ => {
                self.type_of(value) == Type::I64 && matches!(self.int_constant(value), Some(0 | 1))
            }
        }
    }
}
