//! Writing records, and what is known of the ones that have just been written.

use bun_engine_wasm_format::{OutOfMemory, ValKind};

use super::condition::Condition;
use super::operands::{near, width};
use super::{Done, Translator};
use crate::code::Op;
use crate::machine::Handler;
use crate::run::control;

/// Which of the last results of the machine.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Register {
    Int,
    Single,
    Double,
}

impl Register {
    pub(super) fn of(kind: ValKind) -> Self {
        match kind {
            ValKind::F32 => Self::Single,
            ValKind::F64 => Self::Double,
            _ => Self::Int,
        }
    }
}

/// For each register, the slot that has the same bits.
#[derive(Clone, Copy)]
pub(super) struct LastResults([Option<u16>; 3]);

impl LastResults {
    pub(super) const NONE: Self = Self([None; 3]);
}

/// The last instruction, if nothing but the one before leads to it and nothing has come after it.
#[derive(Clone, Copy)]
pub(super) enum Revisable {
    Nothing,
    /// It has its result in `a` of the record.
    Result {
        record: u32,
    },
    /// It can also be taken back.
    Condition {
        record: u32,
        condition: Condition,
        before: LastResults,
    },
}

/// A place in the code that jumps lead to.
#[derive(Clone, Copy)]
pub(super) enum Label {
    Bound(u32),
    /// With the last of the places that want the target, each of which has the one before.
    Unbound(Wanted),
}

/// Half of a record.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Wanted(u32);

impl Wanted {
    const NONE: Self = Self(u32::MAX);

    pub(super) fn low(record: u32) -> Self {
        Self(record * 2)
    }

    pub(super) fn imm(record: u32) -> Self {
        Self(record * 2 + 1)
    }
}

impl Label {
    pub(super) const UNUSED: Self = Self::Unbound(Wanted::NONE);

    pub(super) fn is_bound(self) -> bool {
        matches!(self, Self::Bound(_))
    }

    pub(super) fn is_wanted(self) -> bool {
        matches!(self, Self::Unbound(last) if last != Wanted::NONE)
    }

    /// What to put in the place for now.
    pub(super) fn target_for(&mut self, place: Wanted) -> u32 {
        match self {
            Self::Bound(target) => *target,
            Self::Unbound(last) => core::mem::replace(last, place).0,
        }
    }
}

const MOST_RECORDS: usize = 1 << 30;

impl Translator<'_> {
    /// The index of the next record.
    pub(super) fn position(&self) -> u32 {
        self.ops.len() as u32
    }

    #[inline]
    fn push_record(&mut self, a: u16, b: u16, imm: u32) -> Done {
        if self.ops.len() == self.ops.capacity() {
            self.make_room()?;
        }
        let next = control::nowhere;
        self.ops.push(Op { a, b, imm, next });
        Ok(())
    }

    #[cold]
    fn make_room(&mut self) -> Done {
        if self.ops.len() >= MOST_RECORDS {
            return Err(OutOfMemory);
        }
        Ok(self.ops.try_reserve(1)?)
    }

    /// An instruction that changes none of the last results.
    #[inline]
    pub(super) fn emit(&mut self, handler: Handler, a: u16, b: u16, imm: u32) -> Done {
        self.ops.last_mut().expect("the first record").next = handler;
        self.revisable = Revisable::Nothing;
        self.push_record(a, b, imm)
    }

    pub(super) fn emit_low(&mut self, handler: Handler, low: u32, imm: u32) -> Done {
        self.emit(handler, low as u16, (low >> 16) as u16, imm)
    }

    /// Another record for the same instruction.
    pub(super) fn extend(&mut self, low: u32, imm: u32) -> Done {
        self.push_record(low as u16, (low >> 16) as u16, imm)
    }

    pub(super) fn extend_wide(&mut self, bits: u64) -> Done {
        self.extend(bits as u32, (bits >> 32) as u32)
    }

    pub(super) fn is_last(&self, register: Register, slot: u16) -> bool {
        self.last_results.0[register as usize] == Some(slot)
    }

    pub(super) fn forget_last_results(&mut self) {
        self.last_results = LastResults::NONE;
    }

    #[inline]
    pub(super) fn did_write(&mut self, slot: u16) {
        for known in &mut self.last_results.0 {
            if *known == Some(slot) {
                *known = None;
            }
        }
    }

    #[inline]
    pub(super) fn did_produce(&mut self, register: Register, slot: u16) {
        self.did_write(slot);
        self.last_results.0[register as usize] = Some(slot);
    }

    /// Lets the last instruction put its result in `to`, if it has put it in `from`.
    pub(super) fn redirect_result(&mut self, from: u32, to: u32, width_of: ValKind) -> bool {
        let (Revisable::Result { record } | Revisable::Condition { record, .. }) = self.revisable
        else {
            return false;
        };
        let (Some(to), result) = (near(to, width_of), &mut self.ops[record as usize].a) else {
            return false;
        };
        if u32::from(*result) != from {
            return false;
        }
        let from = core::mem::replace(result, to);
        let register = (self.last_results.0.iter()).position(|&it| it == Some(from));
        (0..width(width_of) as u16).for_each(|word| self.did_write(to + word));
        if let Some(register) = register {
            self.last_results.0[register] = Some(to);
        }
        self.revisable = Revisable::Nothing;
        true
    }

    /// For jumps to the next instruction, which find the last results as they are.
    pub(super) fn bind_keeping_last_results(&mut self, label: Label) -> u32 {
        let target = self.position() - 1;
        let Label::Unbound(mut place) = label else {
            unreachable!("it is bound once");
        };
        while place != Wanted::NONE {
            let op = &mut self.ops[place.0 as usize / 2];
            place.0 = if place.0 % 2 == 0 {
                let before = op.low();
                op.set_low(target);
                before
            } else {
                core::mem::replace(&mut op.imm, target)
            };
        }
        self.revisable = Revisable::Nothing;
        target
    }

    pub(super) fn bind(&mut self, label: Label) -> u32 {
        self.forget_last_results();
        self.bind_keeping_last_results(label)
    }
}
