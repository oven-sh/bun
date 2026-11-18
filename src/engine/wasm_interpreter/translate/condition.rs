//! Comparisons, which become part of the jumps that depend on them.

use bun_engine_asm::{Cond, FloatCond, FloatWidth, Width};
use bun_engine_wasm_format::{ValKind, ValType};

use super::emit::{Label, Register, Revisable, Wanted};
use super::operands::{Input, Operand, Place};
use super::{Done, Translator};
use crate::run::form::Form;
use crate::run::{comparison, control};

#[derive(Clone, Copy)]
pub(super) enum Relation {
    Int(Width, Cond),
    Float(FloatWidth, FloatCond),
}

impl Relation {
    fn commuted(self) -> Self {
        match self {
            Self::Int(width, cond) => Self::Int(width, cond.commuted()),
            Self::Float(width, cond) => Self::Float(width, cond.commuted()),
        }
    }

    /// Of the operands.
    fn kind(self) -> ValKind {
        match self {
            Self::Int(width, _) => ValType::int(width).kind(),
            Self::Float(width, _) => ValType::float(width).kind(),
        }
    }

    fn register(self) -> Register {
        Register::of(self.kind())
    }
}

#[derive(Clone, Copy)]
pub(super) struct Condition {
    relation: Relation,
    lhs: u16,
    rhs: Input,
}

impl Condition {
    pub(super) fn inverted(self) -> Self {
        let relation = match self.relation {
            Relation::Int(width, cond) => Relation::Int(width, cond.inverted()),
            Relation::Float(width, cond) => Relation::Float(width, cond.inverted()),
        };
        Self { relation, ..self }
    }

    pub(super) fn with_constant(width: Width, cond: Cond, lhs: u16, rhs: u64) -> Self {
        let (relation, rhs) = (Relation::Int(width, cond), Input::Constant(rhs));
        Self { relation, lhs, rhs }
    }
}

/// What gives the bits of a value of the kind.
pub(super) fn immediate(kind: ValKind, bits: u64) -> Option<u32> {
    match kind {
        ValKind::I32 | ValKind::F32 => Some(bits as u32),
        ValKind::F64 => {
            let (value, narrow) = (f64::from_bits(bits), f64::from_bits(bits) as f32);
            (!value.is_nan() && f64::from(narrow).to_bits() == bits).then(|| narrow.to_bits())
        }
        _ => (bits as i32 as u64 == bits).then_some(bits as u32),
    }
}

impl Translator<'_> {
    /// The last result comes first.
    fn arranged(&self, condition: Condition) -> (Condition, bool) {
        let Condition { relation, lhs, rhs } = condition;
        match rhs {
            _ if self.is_last(relation.register(), lhs) => (condition, true),
            Input::Slot(rhs) if self.is_last(relation.register(), rhs) => {
                let (relation, lhs, rhs) = (relation.commuted(), rhs, Input::Slot(lhs));
                (Condition { relation, lhs, rhs }, true)
            }
            _ => (condition, false),
        }
    }

    pub(super) fn compare(&mut self, relation: Relation, lhs: Operand, rhs: Operand) -> Done {
        let kind = relation.kind();
        // Only the second operand can be in the record, and only a constant of the right size fits there. Of two
        // constants the one that does not fit takes the slot, which also keeps an operand that another one stands
        // for, as `int_eqz` makes it, out of the slot that both would name.
        let fits = |it: Operand| {
            it.constant()
                .is_some_and(|bits| immediate(kind, bits).is_some())
        };
        let commutes = match (lhs.constant(), rhs.constant()) {
            (Some(_), Some(_)) => fits(lhs) && !fits(rhs),
            (Some(_), None) => true,
            _ => false,
        };
        let (relation, lhs, rhs) = match commutes {
            true => (relation.commuted(), rhs, lhs),
            false => (relation, lhs, rhs),
        };
        let lhs = self.in_slot(lhs, 0)?;
        let rhs = match rhs.constant().map(|bits| immediate(kind, bits)) {
            Some(None) => {
                let rhs = self.in_slot(rhs, 1)?;
                debug_assert!(rhs != lhs, "both operands of a comparison in one slot");
                Input::Slot(rhs)
            }
            _ => self.input(rhs, 1)?,
        };
        self.compare_again(Condition { relation, lhs, rhs })
    }

    /// With what `pop_comparison` has given.
    pub(super) fn compare_again(&mut self, condition: Condition) -> Done {
        let before = self.last_results;
        let (Condition { relation, lhs, rhs }, is_last) = self.arranged(condition);
        let short = |bits| immediate(relation.kind(), bits).expect("or it would be in a slot");
        let (form, b, imm) = match (rhs, is_last) {
            (Input::Slot(rhs), false) => (Form::SlotSlot, lhs, rhs.into()),
            (Input::Slot(rhs), true) => (Form::LastSlot, rhs, 0),
            (Input::Constant(bits), false) => (Form::SlotImm, lhs, short(bits)),
            (Input::Constant(bits), true) => (Form::LastImm, 0, short(bits)),
        };
        let handler = match relation {
            Relation::Int(width, cond) => comparison::for_int_compare(width, cond, form),
            Relation::Float(width, cond) => comparison::for_float_compare(width, cond, form),
        };
        self.produce(ValKind::I32, handler, b, imm)?;
        if let Revisable::Result { record } = self.revisable {
            self.revisable = Revisable::Condition {
                record,
                condition,
                before,
            };
        }
        Ok(())
    }

    /// Takes back the comparison that has given the operand at the top, if it can.
    pub(super) fn pop_comparison(&mut self) -> Option<Condition> {
        let Revisable::Condition {
            record,
            condition,
            before,
        } = self.revisable
        else {
            return None;
        };
        let (top, result) = (*self.top(), self.ops[record as usize].a);
        (top.place == Place::Own && top.slot == result.into()).then(|| {
            self.pop();
            self.ops.truncate(record as usize);
            self.last_results = before;
            self.revisable = Revisable::Nothing;
            condition
        })
    }

    /// That the operand at the top is not zero.
    pub(super) fn pop_condition(&mut self) -> Done<Condition> {
        if let Some(condition) = self.pop_comparison() {
            return Ok(condition);
        }
        let (slot, _) = self.pop_in_slot()?;
        Ok(Condition::with_constant(Width::W32, Cond::Ne, slot, 0))
    }

    pub(super) fn branch(&mut self, condition: Condition, label: &mut Label) -> Done {
        let (Condition { relation, lhs, rhs }, is_last) = self.arranged(condition);
        let is_backward = label.is_bound();
        let target = label.target_for(Wanted::imm(self.position()));
        if let (Relation::Int(Width::W32, cond @ (Cond::Eq | Cond::Ne)), Input::Constant(0)) =
            (relation, rhs)
        {
            let handler = control::for_branch_on_zero(cond == Cond::Eq, is_last, is_backward);
            return self.emit(handler, lhs, 0, target);
        }
        let short = |bits: u64| match relation {
            Relation::Int(Width::W32, _) => i16::try_from(bits as i32).ok(),
            Relation::Int(Width::W64, _) => i16::try_from(bits as i64).ok(),
            Relation::Float(..) => None,
        };
        let (form, a, b, wide) = match (rhs, is_last) {
            (Input::Slot(rhs), false) => (Form::SlotSlot, lhs, rhs, None),
            (Input::Slot(rhs), true) => (Form::LastSlot, rhs, 0, None),
            (Input::Constant(bits), _) => match (short(bits), is_last) {
                (Some(short), false) => (Form::SlotImm, lhs, short as u16, None),
                (Some(short), true) => (Form::LastImm, 0, short as u16, None),
                (None, false) => (Form::SlotWide, lhs, 0, Some(bits)),
                (None, true) => (Form::LastWide, 0, 0, Some(bits)),
            },
        };
        let handler = match relation {
            Relation::Int(width, cond) => {
                comparison::for_int_branch(width, cond, form, is_backward)
            }
            Relation::Float(width, cond) => {
                comparison::for_float_branch(width, cond, form, is_backward)
            }
        };
        self.emit(handler, a, b, target)?;
        wide.map_or(Ok(()), |bits| self.extend_wide(bits))
    }

    pub(super) fn jump(&mut self, label: &mut Label) -> Done {
        let is_backward = label.is_bound();
        let target = label.target_for(Wanted::imm(self.position()));
        self.emit(control::for_jump(is_backward), 0, 0, target)
    }
}
