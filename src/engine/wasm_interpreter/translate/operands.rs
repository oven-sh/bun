//! The operand stack. Each operand has slots of its own, but need not be in them.

use bun_engine_wasm_format::{ValKind, ValType};

use super::emit::{Register, Revisable};
use super::{Done, Translator};
use crate::machine::Handler;
use crate::run::moves;

/// For up to three operands and a result.
pub(super) const SCRATCH_SLOTS: u32 = 8;
const SCRATCH_FOR_RESULT: u16 = 3;
/// How far from the top an operand can wait in a local that is not assigned.
const MOST_UNSETTLED: usize = 16;

pub(super) fn width(kind: ValKind) -> u32 {
    if kind == ValKind::V128 { 2 } else { 1 }
}

/// The index of the slot, if every word of a value of that kind can be named by one. A vector at the last index of
/// the window has its second word outside it.
pub(super) fn near(slot: u32, kind: ValKind) -> Option<u16> {
    u16::try_from(slot + width(kind) - 1).ok()?;
    Some(slot as u16)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Place {
    Own,
    /// With its slot.
    Local(u32),
    Constant(u64),
}

#[derive(Clone, Copy)]
pub(super) struct Operand {
    pub(super) kind: ValKind,
    pub(super) slot: u32,
    pub(super) place: Place,
}

impl Operand {
    pub(super) fn constant(self) -> Option<u64> {
        match self.place {
            Place::Constant(bits) => Some(bits),
            _ => None,
        }
    }
}

/// What an instruction can name.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Input {
    Slot(u16),
    Constant(u64),
}

/// What an instruction does to the last results.
#[derive(Clone, Copy)]
pub(super) enum Effect {
    Keeps,
    Sets(Register),
    /// It sets that for integers.
    Forgets,
}

impl Translator<'_> {
    /// That of the next operand.
    #[inline]
    pub(super) fn free_slot(&self) -> u32 {
        (self.operands.last()).map_or(self.first_operand_slot, |it| it.slot + width(it.kind))
    }

    /// That of the operand with this index, which may be the next.
    pub(super) fn slot_at(&self, height: usize) -> u32 {
        (self.operands.get(height)).map_or_else(|| self.free_slot(), |it| it.slot)
    }

    #[inline]
    pub(super) fn push(&mut self, kind: ValKind, place: Place) -> u32 {
        let slot = self.free_slot();
        debug_assert!(self.operands.len() < self.operands.capacity());
        self.operands.push(Operand { kind, slot, place });
        slot
    }

    pub(super) fn push_constant(&mut self, kind: ValKind, bits: u64) -> Done {
        self.push(kind, Place::Constant(bits));
        Ok(())
    }

    pub(super) fn push_all(&mut self, types: &[ValType]) {
        for ty in types {
            self.push(ty.kind(), Place::Own);
        }
    }

    #[inline]
    pub(super) fn pop(&mut self) -> Operand {
        let operand = self.operands.pop().expect("the body was validated");
        self.settled = self.settled.min(self.operands.len());
        operand
    }

    pub(super) fn top(&mut self) -> &mut Operand {
        self.operands.last_mut().expect("the body was validated")
    }

    pub(super) fn truncate(&mut self, height: usize) {
        self.operands.truncate(height);
        self.settled = self.settled.min(height);
    }

    fn scratch(&self, index: u16) -> u16 {
        self.first_scratch_slot + index * 2
    }

    fn load_far(&mut self, kind: ValKind, to: u16, from: u32) -> Done {
        for word in 0..width(kind) {
            let to = to + word as u16;
            self.emit(moves::load_far, to, 0, from + word)?;
            self.did_write(to);
        }
        Ok(())
    }

    fn store_far(&mut self, kind: ValKind, to: u32, from: u16) -> Done {
        (0..width(kind))
            .try_for_each(|word| self.emit(moves::store_far, from + word as u16, 0, to + word))
    }

    /// Operands of one instruction have different numbers below three.
    #[inline]
    pub(super) fn input(&mut self, operand: Operand, number: u16) -> Done<Input> {
        let slot = match operand.place {
            Place::Constant(bits) => return Ok(Input::Constant(bits)),
            Place::Own => operand.slot,
            Place::Local(slot) => slot,
        };
        if let Some(slot) = near(slot, operand.kind) {
            return Ok(Input::Slot(slot));
        }
        let scratch = self.scratch(number);
        self.load_far(operand.kind, scratch, slot)?;
        Ok(Input::Slot(scratch))
    }

    /// For an instruction that cannot name a constant.
    #[inline]
    pub(super) fn in_slot(&mut self, operand: Operand, number: u16) -> Done<u16> {
        match self.input(operand, number)? {
            Input::Slot(slot) => Ok(slot),
            Input::Constant(bits) => {
                let slot = near(operand.slot, operand.kind);
                let slot = slot.unwrap_or_else(|| self.scratch(number));
                self.put_constant(slot, bits)?;
                Ok(slot)
            }
        }
    }

    pub(super) fn pop_in_slots<const N: usize>(&mut self) -> Done<[u16; N]> {
        let mut slots = [0; N];
        for (number, slot) in slots.iter_mut().enumerate().rev() {
            let operand = self.pop();
            *slot = self.in_slot(operand, number as u16)?;
        }
        Ok(slots)
    }

    /// Also tells whether it is the last result of its kind.
    #[inline]
    pub(super) fn pop_in_slot(&mut self) -> Done<(u16, bool)> {
        let operand = self.pop();
        let slot = self.in_slot(operand, 0)?;
        Ok((slot, self.is_last(Register::of(operand.kind), slot)))
    }

    fn put_constant(&mut self, slot: u16, bits: u64) -> Done {
        let (low, high) = (bits as u32, (bits >> 32) as u32);
        self.did_write(slot);
        if high == 0 {
            self.emit(moves::constant, slot, 0, low)
        } else if bits == low as i32 as u64 {
            self.emit(moves::negative_constant, slot, 0, low)
        } else if low == 0 {
            self.emit(moves::high_constant, slot, 0, high)
        } else {
            self.emit(moves::wide_constant, slot, 0, 0)?;
            self.extend_wide(bits)
        }
    }

    /// The operand stays where it is, and so do the inputs of an instruction that is being put together.
    pub(super) fn put(&mut self, to: u32, operand: Operand) -> Done {
        match (operand.place, operand.slot) {
            (Place::Own, slot) | (Place::Local(slot), _) if slot == to => return Ok(()),
            _ => {}
        }
        let Some(near) = near(to, operand.kind) else {
            let from = match self.input(operand, SCRATCH_FOR_RESULT)? {
                Input::Slot(slot) => slot,
                Input::Constant(bits) => {
                    self.put_constant(self.scratch(SCRATCH_FOR_RESULT), bits)?;
                    self.scratch(SCRATCH_FOR_RESULT)
                }
            };
            return self.store_far(operand.kind, to, from);
        };
        match self.input(operand, SCRATCH_FOR_RESULT)? {
            Input::Constant(bits) => self.put_constant(near, bits),
            Input::Slot(from) if operand.kind == ValKind::V128 => {
                self.did_write(near);
                self.did_write(near + 1);
                self.emit(moves::copy_vector, near, from, 0)
            }
            Input::Slot(from) => {
                self.did_write(near);
                self.emit(moves::copy, near, from, 0)
            }
        }
    }

    fn settle_at(&mut self, height: usize) -> Done {
        let operand = self.operands[height];
        self.operands[height].place = Place::Own;
        self.put(operand.slot, operand)
    }

    /// Puts so many in their own slots, and gives the first of these.
    pub(super) fn settle_top(&mut self, count: usize) -> Done<u32> {
        let first = self.operands.len() - count;
        for height in first..self.operands.len() {
            if self.operands[height].place != Place::Own {
                self.settle_at(height)?;
            }
        }
        Ok(self.slot_at(first))
    }

    pub(super) fn pop_settled(&mut self, count: usize) -> Done<u32> {
        let first = self.settle_top(count)?;
        self.truncate(self.operands.len() - count);
        Ok(first)
    }

    /// Those that are in locals.
    pub(super) fn settle_below(&mut self, height: usize) -> Done {
        for height in self.settled..height {
            if let Place::Local(_) = self.operands[height].place {
                self.settle_at(height)?;
            }
        }
        self.settled = self.settled.max(height);
        Ok(())
    }

    /// Before the local is assigned.
    pub(super) fn settle_readers_of(&mut self, slot: u32) -> Done {
        self.settle_below(self.operands.len().saturating_sub(MOST_UNSETTLED))?;
        for height in self.settled..self.operands.len() {
            if self.operands[height].place == Place::Local(slot) {
                self.settle_at(height)?;
            }
        }
        Ok(())
    }

    /// An instruction with one result, and `more` records.
    #[inline]
    pub(super) fn produce_with(
        &mut self,
        (kind, effect): (ValKind, Effect),
        handler: Handler,
        b: u16,
        imm: u32,
        more: &[u64],
    ) -> Done {
        let (slot, record) = (self.push(kind, Place::Own), self.position());
        let near = near(slot, kind);
        let result = near.unwrap_or_else(|| self.scratch(SCRATCH_FOR_RESULT));
        self.emit(handler, result, b, imm)?;
        more.iter().try_for_each(|&bits| self.extend_wide(bits))?;
        match effect {
            Effect::Keeps => (0..width(kind) as u16).for_each(|word| self.did_write(result + word)),
            Effect::Sets(register) => self.did_produce(register, result),
            Effect::Forgets => {
                self.forget_last_results();
                self.did_produce(Register::Int, result);
            }
        }
        if near.is_none() {
            return self.store_far(kind, slot, result);
        }
        self.revisable = Revisable::Result { record };
        Ok(())
    }

    /// One that makes it the last result of its kind, unless it is a vector.
    #[inline]
    pub(super) fn produce(&mut self, kind: ValKind, handler: Handler, b: u16, imm: u32) -> Done {
        self.produce_with(usual(kind), handler, b, imm, &[])
    }

    /// See `run::operation`.
    pub(super) fn operate(
        &mut self,
        handler: Handler,
        operands: usize,
        imm: u32,
        more: Option<u64>,
        result: Option<ValKind>,
    ) -> Done {
        let first = self.pop_settled(operands)?;
        self.emit_low(handler, first, imm)?;
        more.map_or(Ok(()), |bits| self.extend_wide(bits))?;
        self.forget_last_results();
        if let Some(kind) = result {
            self.push_returned(kind);
        }
        Ok(())
    }

    /// What is in its slot, and is the last result for integers whatever its kind.
    pub(super) fn push_returned(&mut self, kind: ValKind) {
        if let Some(slot) = near(self.push(kind, Place::Own), kind) {
            self.did_produce(Register::Int, slot);
        }
    }
}

pub(super) fn usual(kind: ValKind) -> (ValKind, Effect) {
    match kind {
        ValKind::V128 => (kind, Effect::Keeps),
        _ => (kind, Effect::Sets(Register::of(kind))),
    }
}

/// Two slots in the place of `imm`.
pub(super) fn pair(c: u16, d: u16) -> u32 {
    u32::from(c) | u32::from(d) << 16
}
