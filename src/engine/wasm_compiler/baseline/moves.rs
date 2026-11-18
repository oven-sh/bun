//! Moves that take place as if at once.

use bun_engine_asm::{MacroAssembly, Reg, RegisterSet};
use bun_engine_wasm_format::ValKind;

use super::Function;
use super::operand::{Operand, Place, scratch};

/// Offsets are in the frame. The destination comes first.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Step {
    Copy(ValKind, Reg, Reg),
    /// Of 32 bits.
    Add(Reg, Reg, i32),
    Load(ValKind, Reg, i32),
    Constant(ValKind, Reg, u64),
    Store(ValKind, i32, Reg),
    StoreConstant(ValKind, i32, u64),
    Transfer(ValKind, i32, i32),
}

impl Step {
    /// `value` was located and is no sum.
    pub(super) fn to_frame(dst: i32, value: Operand) -> Option<Self> {
        let kind = value.kind();
        match value.place() {
            Place::Constant(bits) => Some(Self::StoreConstant(kind, dst, bits)),
            Place::Register(reg) => Some(Self::Store(kind, dst, reg)),
            Place::Slot(src) => (src != dst).then_some(Self::Transfer(kind, dst, src)),
            Place::Local(_) | Place::Sum(..) => unreachable!(),
        }
    }
}

/// To registers, each of which is written once.
pub(super) struct Moves {
    copied_to: RegisterSet,
    /// By the destination.
    sources: [(ValKind, Reg); Reg::COUNT],
    addends: [i32; Reg::COUNT],
    /// What reads no register but its destination.
    last: Vec<Step>,
}

impl Moves {
    /// `buffer` is empty.
    pub(super) fn new(buffer: Vec<Step>) -> Self {
        Self {
            copied_to: RegisterSet::EMPTY,
            sources: [(ValKind::I32, Reg::from_index(0)); Reg::COUNT],
            addends: [0; Reg::COUNT],
            last: buffer,
        }
    }

    pub(super) fn into_buffer(self) -> Vec<Step> {
        self.last
    }

    /// `value` was located and is no sum. Only an `i32` has something added.
    #[inline]
    fn add(&mut self, dst: Reg, value: Operand, addend: i32) {
        let kind = value.kind();
        match value.place() {
            Place::Register(src) if src == dst && addend == 0 => {}
            Place::Register(src) => {
                debug_assert!(!self.copied_to.contains(dst));
                self.copied_to.insert(dst);
                self.sources[dst.index()] = (kind, src);
                self.addends[dst.index()] = addend;
            }
            Place::Constant(bits) => self.last.push(Step::Constant(kind, dst, bits)),
            Place::Slot(src) => {
                self.last.push(Step::Load(kind, dst, src));
                if addend != 0 {
                    self.last.push(Step::Add(dst, dst, addend));
                }
            }
            Place::Local(_) | Place::Sum(..) => unreachable!(),
        }
    }

    /// Puts them in order, and forgets them.
    #[inline]
    pub(super) fn finish(&mut self, steps: &mut Vec<Step>) {
        if !self.copied_to.is_empty() {
            self.order_copies(steps);
        }
        if !self.last.is_empty() {
            steps.append(&mut self.last);
        }
    }

    fn order_copies(&mut self, steps: &mut Vec<Step>) {
        let mut left = core::mem::take(&mut self.copied_to);
        while let Some(first) = left.first() {
            let mut ready = left;
            for dst in left {
                let src = self.sources[dst.index()].1;
                if src != dst {
                    ready.remove(src);
                }
            }
            for dst in ready {
                let (kind, src) = self.sources[dst.index()];
                steps.push(match self.addends[dst.index()] {
                    0 => Step::Copy(kind, dst, src),
                    addend => Step::Add(dst, src, addend),
                });
            }
            left -= ready;
            if ready.is_empty() {
                // Only cycles are left. The one that is opened unwinds before the next needs the scratch register.
                let (kind, src) = self.sources[first.index()];
                let addend = core::mem::take(&mut self.addends[first.index()]);
                let saved = scratch(src.bank());
                steps.push(Step::Copy(kind, saved, src));
                self.sources[first.index()] = (kind, saved);
                if addend != 0 {
                    self.last.push(Step::Add(first, first, addend));
                }
            }
        }
    }
}

impl Function<'_> {
    #[inline]
    pub(super) fn add_move(&mut self, dst: impl Into<Reg>, value: Operand) {
        let (value, addend) = match value.place() {
            Place::Sum(local, addend) => (Operand::of_local(value.ty(), local), addend),
            _ => (value, 0),
        };
        let value = self.locate(value);
        self.moves.add(dst.into(), value, addend);
    }

    #[inline]
    pub(super) fn emit_moves(&mut self) {
        if !self.moves.copied_to.is_empty() || !self.moves.last.is_empty() {
            self.emit_some_moves();
        }
    }

    fn emit_some_moves(&mut self) {
        let start = self.steps.len();
        self.moves.finish(&mut self.steps);
        self.emit_steps_from(start);
    }

    /// Removes them.
    #[inline]
    pub(super) fn emit_steps_from(&mut self, start: usize) {
        for index in start..self.steps.len() {
            self.emit_step(self.steps[index]);
        }
        self.steps.truncate(start);
    }

    pub(super) fn emit_step(&mut self, step: Step) {
        match step {
            Step::Copy(kind, dst, src) => self.copy(kind, dst, src),
            Step::Add(dst, src, addend) => self.masm.add32(dst.gpr(), src.gpr(), addend),
            Step::Load(kind, dst, src) => self.load(kind, dst, self.frame_address(src)),
            Step::Constant(kind, dst, bits) => self.move_constant(kind, dst, bits),
            Step::Store(kind, dst, src) => self.store(kind, self.frame_address(dst), src),
            Step::StoreConstant(kind, dst, bits) => {
                self.store_constant(kind, self.frame_address(dst), bits);
            }
            Step::Transfer(kind, dst, src) => {
                self.transfer(kind, self.frame_address(dst), self.frame_address(src));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use bun_engine_wasm_format::ValType;

    use super::*;

    const REGISTERS: usize = 5;

    /// Every way for a few registers of each bank to be written or not, from any of them.
    #[test]
    fn every_assignment_takes_place_at_once() {
        let mut moves = Moves::new(Vec::new());
        let mut steps = Vec::new();
        let choices = REGISTERS + 2;
        for (ty, first, addends) in [
            (ValType::I32, 0, [0, 0]),
            (ValType::I32, 0, [100, 0]),
            (ValType::I32, 0, [100, 200]),
            (ValType::V128, Reg::COUNT / 2, [0, 0]),
        ] {
            for mut number in 0..choices.pow(REGISTERS as u32) {
                let mut held: [i32; Reg::COUNT] = core::array::from_fn(|index| index as i32);
                let mut expected = held;
                for dst in first..first + REGISTERS {
                    let choice = number % choices;
                    number /= choices;
                    let (value, content) = match choice {
                        0..REGISTERS => {
                            let src = Reg::from_index(first + choice);
                            (Operand::in_register(ty, src), held[src.index()])
                        }
                        REGISTERS => (Operand::in_slot(ty, 1000), 1000),
                        _ => continue,
                    };
                    expected[dst] = content + addends[dst % 2];
                    moves.add(Reg::from_index(dst), value, addends[dst % 2]);
                }
                moves.finish(&mut steps);
                for step in steps.drain(..) {
                    match step {
                        Step::Copy(_, dst, src) => held[dst.index()] = held[src.index()],
                        Step::Add(dst, src, addend) => {
                            assert!(src != scratch(src.bank()));
                            held[dst.index()] = held[src.index()] + addend;
                        }
                        Step::Load(_, dst, src) => held[dst.index()] = src,
                        _ => unreachable!(),
                    }
                }
                let range = first..first + REGISTERS;
                assert_eq!(held[range.clone()], expected[range]);
            }
        }
    }
}
