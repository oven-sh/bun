//! Where an instruction finds two operands.

use core::marker::ConstParamTy;

use crate::code::Op;
use crate::machine::{Machine, Number};

/// `Last` is the last result, `Imm` is in the record, and `Wide` has a record of its own.
#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Form {
    SlotSlot,
    LastSlot,
    SlotLast,
    SlotImm,
    LastImm,
    SlotWide,
    LastWide,
    ImmSlot,
    ImmLast,
}

impl<'a> Machine<'a, '_> {
    /// Also gives the last record. `first` and `second` are the slots, as many as it takes.
    #[inline(always)]
    pub(crate) fn pair<T: Number, const FORM: Form>(
        &mut self,
        op: &'a Op,
        first: impl FnOnce() -> u16,
        second: impl FnOnce() -> u16,
        imm: impl FnOnce() -> u32,
    ) -> Option<(T, T, &'a Op)> {
        let slot = |m: &Self, slot| T::from_slot(m.get(slot));
        Some(match FORM {
            Form::SlotSlot => (slot(self, first()), slot(self, second()), op),
            Form::LastSlot => (T::last(self), slot(self, first()), op),
            Form::SlotLast => (slot(self, first()), T::last(self), op),
            Form::SlotImm => (slot(self, first()), T::from_immediate(imm()), op),
            Form::LastImm => (T::last(self), T::from_immediate(imm()), op),
            Form::ImmSlot => (T::from_immediate(imm()), slot(self, first()), op),
            Form::ImmLast => (T::from_immediate(imm()), T::last(self), op),
            Form::SlotWide | Form::LastWide => {
                let lhs = match FORM {
                    Form::SlotWide => slot(self, first()),
                    _ => T::last(self),
                };
                let wide = self.pc.take()?;
                (lhs, T::from_slot(wide.whole()), wide)
            }
        })
    }

    /// For an instruction that has a result.
    #[inline(always)]
    pub(crate) fn inputs<T: Number, const FORM: Form>(
        &mut self,
        op: &'a Op,
    ) -> Option<(T, T, &'a Op)> {
        self.pair::<T, FORM>(op, || op.b, || op.c(), || op.imm)
    }
}
