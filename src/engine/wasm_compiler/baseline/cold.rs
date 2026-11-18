//! Code that is rarely run, which follows the rest of the function.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Reg};

use super::Function;
use super::frame::CALLEE_WORDS_SIZE;
use super::registers::Local;
use crate::abi::{FunctionSlot, INSTANCE, Operation, RESULT_GPRS, SLOT, Trap};

#[derive(Clone, Copy)]
pub(super) enum Cold {
    CheckEntry {
        entry: Label,
        resume: Label,
    },
    TierUpAtEntry {
        entry: Label,
        resume: Label,
    },
    TierUpInLoop {
        entry: Label,
        resume: Label,
        index: u32,
        snapshot: u32,
        dirty: RegisterSet,
    },
    TakeOverFrame {
        entry: Label,
        resume: Label,
        snapshot: u32,
        held: RegisterSet,
    },
    DivideByMinusOne {
        entry: Label,
        resume: Label,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
    },
    MoveZero {
        entry: Label,
        resume: Label,
        dst: Gpr,
    },
    Operation {
        entry: Label,
        resume: Label,
        operation: Operation,
        /// After the instance. It may take fewer.
        arguments: [Argument; 2],
        result: Option<Gpr>,
        live: RegisterSet,
    },
    NoteOtherCallee {
        entry: Label,
        resume: Label,
    },
    JumpThroughSlot {
        entry: Label,
        slot: usize,
    },
}

/// Where the function goes for each trap.
pub(super) struct Traps {
    /// A bit for each that has a label.
    used: u64,
    labels: [Label; Trap::COUNT],
}

impl Traps {
    pub(super) fn new(any: Label) -> Self {
        Self {
            used: 0,
            labels: [any; Trap::COUNT],
        }
    }
}

impl Function<'_> {
    #[inline]
    pub(super) fn trap_label(&mut self, trap: Trap) -> Label {
        if self.traps.used >> trap as u8 & 1 == 0 {
            self.traps.used |= 1 << trap as u8;
            self.traps.labels[trap as usize] = self.masm.new_label();
        }
        self.traps.labels[trap as usize]
    }

    /// Control does not go on.
    pub(super) fn trap(&mut self, trap: Trap) {
        let label = self.trap_label(trap);
        self.masm.jump(label);
        self.is_dead = true;
    }

    pub(super) fn emit_cold_code(&mut self) {
        self.emit_detours();
        for index in 0..self.cold.len() {
            self.emit_cold(self.cold[index]);
        }
        while self.traps.used != 0 {
            let trap = self.traps.used.trailing_zeros() as usize;
            self.traps.used &= self.traps.used - 1;
            self.masm.bind(self.traps.labels[trap]);
            self.masm.call_address(self.env.stubs.traps[trap]);
        }
    }

    fn local_at(&self, snapshot: u32, reg: Reg) -> Local {
        self.locals[usize::from(self.snapshots[snapshot as usize][reg.index()])]
    }

    fn emit_cold(&mut self, cold: Cold) {
        match cold {
            Cold::CheckEntry { entry, resume } => {
                self.masm.bind(entry);
                self.masm.call_address(self.env.stubs.check_entry);
                self.masm.jump(resume);
            }
            Cold::TierUpAtEntry { entry, resume } => {
                self.masm.bind(entry);
                self.masm.call_address(self.env.stubs.tier_up_at_entry);
                self.masm.jump(resume);
            }
            Cold::TierUpInLoop {
                entry,
                resume,
                index,
                snapshot,
                dirty,
            } => {
                self.masm.bind(entry);
                self.masm.move32(SLOT, index);
                self.masm.call_address(self.env.stubs.tier_up_in_loop);
                self.masm.branch_if_zero64(SLOT, resume);
                for reg in dirty {
                    let Local { ty, offset, .. } = self.local_at(snapshot, reg);
                    self.store(ty.kind(), self.frame_address(offset), reg);
                }
                self.masm.jump_indirect(SLOT);
            }
            Cold::TakeOverFrame {
                entry,
                resume,
                snapshot,
                held,
            } => {
                self.masm.bind(entry);
                let bottom = Address::new(abi::FRAME_POINTER, -(self.frame.size() as i32));
                self.masm.compute_address(abi::STACK_POINTER, bottom);
                self.load_checked_memory();
                for reg in held {
                    let Local { ty, offset, .. } = self.local_at(snapshot, reg);
                    self.load(ty.kind(), reg, self.frame_address(offset));
                }
                self.masm.jump(resume);
            }
            Cold::DivideByMinusOne {
                entry,
                resume,
                width,
                dst,
                lhs,
            } => {
                let overflow = self.trap_label(Trap::IntegerOverflow);
                self.masm.bind(entry);
                (self.masm).branch_neg(width, ResultCond::Overflow, dst, lhs, overflow);
                self.masm.jump(resume);
            }
            Cold::MoveZero { entry, resume, dst } => {
                self.masm.bind(entry);
                self.masm.move32(dst, 0);
                self.masm.jump(resume);
            }
            Cold::Operation {
                entry,
                resume,
                operation,
                arguments: [first, second],
                result,
                live,
            } => {
                let vector_bytes = if self.uses_simd { 16 } else { 8 };
                let size = live.in_bank(Bank::Gpr).len() * 8
                    + live.in_bank(Bank::Fpr).len() * vector_bytes;
                let size = size.next_multiple_of(16) + CALLEE_WORDS_SIZE;
                let (stack_pointer, masm) = (abi::STACK_POINTER, &mut self.masm);
                let saved = Address::new(stack_pointer, CALLEE_WORDS_SIZE as i32);
                masm.bind(entry);
                masm.sub64(stack_pointer, stack_pointer, size);
                masm.store_registers(live, vector_bytes as i32, saved);
                masm.move_arguments(&[INSTANCE.into(), first, second]);
                masm.call_address(self.env.stubs.operations[operation as usize]);
                if let Some(result) = result {
                    masm.move64(result, RESULT_GPRS[0]);
                }
                masm.load_registers(live, vector_bytes as i32, saved);
                masm.add64(stack_pointer, stack_pointer, size);
                masm.jump(resume);
            }
            Cold::NoteOtherCallee { entry, resume } => {
                self.masm.bind(entry);
                self.masm.call_address(self.env.stubs.note_callee);
                self.masm.jump(resume);
            }
            Cold::JumpThroughSlot { entry, slot } => {
                self.masm.bind(entry);
                self.masm.move64(SLOT, slot);
                (self.masm).jump_indirect(Address::new(SLOT, FunctionSlot::ENTRY));
            }
        }
    }
}
