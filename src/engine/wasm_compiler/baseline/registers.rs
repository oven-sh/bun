//! What the registers hold: values of the operand stack, and copies of locals.
//!
//! A register is free, or belongs to one operand or one local. What an instruction pops or takes is locked until the
//! next instruction. A register that is both free and locked is the instruction's to overwrite.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Reg, RegOrImm, RegOrMem, Src};
use bun_engine_wasm_format::ValType;
use bun_engine_wasm_format::opcode::{LOCAL_SET, LOCAL_TEE, RETURN};

use super::Function;
use super::memory::FirstMemory;
use super::operand::{Operand, Place, bank, untrusted};
use crate::abi::{ARGUMENT_GPRS, INSTANCE, RESULT_FPRS, RESULT_GPRS};

#[derive(Clone, Copy)]
pub(super) struct Local {
    pub(super) ty: ValType,
    pub(super) offset: i32,
    /// The register that it is in or was last in, or one that nothing is ever in.
    pub(super) hint: Reg,
    /// The index of the last loop that was found to assign it before anything can read it.
    pub(super) dead_at_loop: u32,
}

impl Local {
    #[inline]
    pub(super) fn new(ty: ValType, offset: i32) -> Self {
        Self {
            ty,
            offset,
            hint: Reg::from_gpr(abi::STACK_POINTER),
            dead_at_loop: u32::MAX,
        }
    }
}

/// By the index of the register.
pub(super) type Owners = [u16; Reg::COUNT];

pub(super) struct Registers {
    pub(super) allocatable: RegisterSet,
    pub(super) free: RegisterSet,
    /// Those that belong to locals.
    pub(super) cached: RegisterSet,
    /// Those of `cached` whose local is not up to date in the frame.
    pub(super) dirty: RegisterSet,
    pub(super) locked: RegisterSet,
    pub(super) recent: RegisterSet,
    /// Set aside for the locals that the innermost loop keeps in registers.
    pub(super) pinned: RegisterSet,
    /// Those of `pinned` that may be dirty at a branch.
    pub(super) unsaved: RegisterSet,
    /// Stays when the local leaves the register.
    pub(super) local_of: Owners,
    /// The index of a copy of `local_of` as it is now.
    pub(super) snapshot: Option<u32>,
    pub(super) operand_of: [u32; Reg::COUNT],
}

const ALLOCATABLE: RegisterSet = RegisterSet::of(&abi::TEMPORARY_GPRS, &[])
    .union(RegisterSet::of(&abi::SAVED_GPRS, &[]))
    .union(abi::PINNED)
    .union(abi::ALL.in_bank(Bank::Fpr))
    .difference(RegisterSet::of(&[INSTANCE], &abi::SCRATCH_FPRS));

impl Registers {
    pub(super) fn new(first_memory: FirstMemory) -> Self {
        let allocatable = ALLOCATABLE - first_memory.registers();
        Self {
            allocatable,
            free: allocatable,
            cached: RegisterSet::EMPTY,
            dirty: RegisterSet::EMPTY,
            locked: RegisterSet::EMPTY,
            recent: RegisterSet::EMPTY,
            pinned: RegisterSet::EMPTY,
            unsaved: RegisterSet::EMPTY,
            local_of: [0; Reg::COUNT],
            snapshot: None,
            operand_of: [0; Reg::COUNT],
        }
    }

    /// Those that belong to operands.
    #[inline(always)]
    pub(super) fn operands(&self) -> RegisterSet {
        self.allocatable - self.free - self.cached
    }

    #[inline(always)]
    pub(super) fn local_in(&self, reg: Reg) -> u32 {
        self.local_of[reg.index()].into()
    }

    /// Operands are taken from the other end.
    #[inline]
    pub(super) fn best_for_local(candidates: RegisterSet) -> Option<Reg> {
        let kept = candidates & abi::CALLEE_SAVED;
        let bits = if kept.is_empty() { candidates } else { kept }.bits();
        Some(Reg::from_index(bits.checked_ilog2()? as usize))
    }
}

/// More lazy operands than this are not searched again and again.
const LONGEST_SEARCH: u32 = 16;

impl Function<'_> {
    // The operand stack

    #[inline(always)]
    pub(super) fn height(&self) -> u32 {
        self.stack.len() as u32
    }

    /// What is neither in a register nor in a slot.
    #[inline(always)]
    pub(super) fn push_lazy(&mut self, value: Operand) {
        self.lowest_lazy = self.lowest_lazy.min(self.height());
        self.stack.push(value);
    }

    /// The register is free.
    #[inline(always)]
    pub(super) fn push_register(&mut self, ty: ValType, reg: impl Into<Reg>) {
        let reg = reg.into();
        debug_assert!(self.registers.free.contains(reg));
        self.registers.free.remove(reg);
        self.registers.operand_of[reg.index()] = self.height();
        self.stack.push(Operand::in_register(ty, reg));
    }

    pub(super) fn push_slot(&mut self, ty: ValType) {
        let offset = self.frame.operand(self.height());
        self.stack.push(Operand::in_slot(ty, offset));
    }

    /// Puts back what was just popped.
    pub(super) fn push(&mut self, value: Operand) {
        match value.place() {
            Place::Register(reg) => self.push_register(value.ty(), reg),
            Place::Slot(_) => self.push_slot(value.ty()),
            Place::Constant(_) | Place::Local(_) | Place::Sum(..) => self.push_lazy(value),
        }
    }

    #[inline(always)]
    pub(super) fn pop(&mut self) -> Operand {
        let value = self.stack.pop().expect("the code was validated");
        if let Place::Register(reg) = value.place() {
            self.registers.free.insert(reg);
            self.registers.locked.insert(reg);
        }
        value
    }

    #[inline(always)]
    pub(super) fn pop_gpr(&mut self) -> Gpr {
        let value = self.pop();
        self.gpr(value)
    }

    #[inline(always)]
    pub(super) fn pop_fpr(&mut self) -> Fpr {
        let value = self.pop();
        self.fpr(value)
    }

    #[inline(always)]
    pub(super) fn top(&self) -> Operand {
        *self.stack.last().expect("the code was validated")
    }

    /// Leaves the operand at the top in a register of its own, which is locked.
    pub(super) fn own_top(&mut self) -> Reg {
        let value = self.pop();
        let reg = self.writable(value);
        self.push_register(value.ty(), reg);
        reg
    }

    /// Puts the operands below `end` in their slots.
    #[inline(always)]
    pub(super) fn settle(&mut self, end: u32) {
        if end != 0 && (self.lowest_lazy < end || !self.registers.operands().is_empty()) {
            self.spill_below(self.registers.allocatable, end);
            self.settle_lazy(end);
        }
    }

    fn settle_lazy(&mut self, end: u32) {
        for position in self.lowest_lazy..end {
            let value = self.stack[position as usize];
            if let Place::Constant(_) | Place::Local(_) | Place::Sum(..) = value.place() {
                self.put_in_slot(position);
            }
        }
        self.lowest_lazy = self.lowest_lazy.max(end);
    }

    /// The operand is lazy.
    pub(super) fn put_in_slot(&mut self, position: u32) {
        let (value, offset) = (self.stack[position as usize], self.frame.operand(position));
        self.store_operand(self.frame_address(offset), value);
        self.stack[position as usize] = Operand::in_slot(value.ty(), offset);
    }

    /// Those of the operands below `end` that are in `registers`.
    pub(super) fn spill_below(&mut self, registers: RegisterSet, end: u32) {
        for reg in self.registers.operands() & registers {
            if self.registers.operand_of[reg.index()] < end {
                self.spill(reg);
            }
        }
    }

    fn spill(&mut self, reg: Reg) {
        let position = self.registers.operand_of[reg.index()];
        let ty = self.stack[position as usize].ty();
        let offset = self.frame.operand(position);
        self.store(ty.kind(), self.frame_address(offset), reg);
        self.stack[position as usize] = Operand::in_slot(ty, offset);
        self.registers.free.insert(reg);
    }

    // Reading what was popped

    /// Not to be written unless it is free.
    #[inline(always)]
    pub(super) fn register(&mut self, value: Operand) -> Reg {
        match value.place() {
            Place::Register(reg) => reg,
            Place::Local(local) if let Some(reg) = self.register_of(local) => {
                self.registers.locked.insert(reg);
                reg
            }
            _ => self.bring(value),
        }
    }

    #[inline(always)]
    pub(super) fn gpr(&mut self, value: Operand) -> Gpr {
        self.register(value).gpr()
    }

    #[inline(always)]
    pub(super) fn fpr(&mut self, value: Operand) -> Fpr {
        self.register(value).fpr()
    }

    #[inline(never)]
    fn bring(&mut self, value: Operand) -> Reg {
        let Place::Local(local) = value.place() else {
            return self.writable(value);
        };
        let reg = self.take_for_local(local);
        let Local { ty, offset, .. } = self.locals[local as usize];
        self.load(ty.kind(), reg, self.frame_address(offset));
        self.bind(local, reg);
        reg
    }

    pub(super) fn writable(&mut self, value: Operand) -> Reg {
        if let Place::Register(reg) = value.place() {
            return reg;
        }
        self.lock(value);
        let reg = self.take(bank(value.kind()));
        self.move_operand(reg, value);
        reg
    }

    /// Keeps a local in its register.
    pub(super) fn lock(&mut self, value: Operand) {
        if let Place::Local(local) | Place::Sum(local, _) = value.place()
            && let Some(reg) = self.register_of(local)
        {
            self.registers.locked.insert(reg);
        }
    }

    /// Locates an integer where an instruction can read it. Nothing is put out of its register for it.
    #[inline(always)]
    pub(super) fn source(&mut self, value: Operand) -> Operand {
        let index = match value.place() {
            Place::Local(index) => index,
            Place::Sum(..) => return Operand::in_register(value.ty(), self.writable(value)),
            _ => return value,
        };
        if let Some(reg) = self.register_of(index) {
            self.registers.locked.insert(reg);
            Operand::in_register(value.ty(), reg)
        } else if self.has_room_for(index) {
            Operand::in_register(value.ty(), self.bring(value))
        } else {
            Operand::in_slot(value.ty(), self.locals[index as usize].offset)
        }
    }

    /// `source` was located.
    #[inline(always)]
    pub(super) fn src(&self, source: Operand) -> Src {
        match source.place() {
            Place::Constant(bits) => Untrusted(bits).into(),
            _ => self.reg_or_mem(source).into(),
        }
    }

    /// `source` was located and is no constant.
    #[inline(always)]
    pub(super) fn reg_or_mem(&self, source: Operand) -> RegOrMem {
        match source.place() {
            Place::Slot(offset) => self.frame_address(offset).into(),
            _ => source.register().gpr().into(),
        }
    }

    #[inline(always)]
    pub(super) fn reg_or_imm(&mut self, value: Operand) -> RegOrImm {
        match value.place() {
            Place::Constant(bits) => untrusted(bits),
            _ => self.gpr(value).into(),
        }
    }

    // Taking registers

    #[inline(always)]
    fn unused(&self, bank: Bank) -> RegisterSet {
        let registers = &self.registers;
        (registers.free - registers.locked - registers.pinned).in_bank(bank)
    }

    #[inline(always)]
    pub(super) fn take(&mut self, bank: Bank) -> Reg {
        let reg = match self.unused(bank).first() {
            Some(reg) => reg,
            None => self.make_room_for_operand(bank),
        };
        self.registers.locked.insert(reg);
        reg
    }

    #[inline(always)]
    pub(super) fn take_gpr(&mut self) -> Gpr {
        self.take(Bank::Gpr).gpr()
    }

    /// `operand`, which was popped, if nothing else needs it, and otherwise another of its bank.
    #[inline(always)]
    pub(super) fn reuse(&mut self, operand: impl Into<Reg>) -> Reg {
        let operand = operand.into();
        if self.registers.free.contains(operand) {
            operand
        } else {
            self.take(operand.bank())
        }
    }

    /// For the result of an instruction that has read its operands by the time it writes. `next` is the offset of the
    /// instruction that follows.
    #[inline(always)]
    pub(super) fn result(&mut self, next: usize, bank: Bank) -> Reg {
        match self.register_wanted_at(next, bank, None) {
            Some(reg) => reg,
            None => self.take_for_result(bank),
        }
    }

    /// Like [`Self::result`] and [`Self::reuse`].
    #[inline(always)]
    pub(super) fn result_reusing(&mut self, next: usize, operand: impl Into<Reg>) -> Reg {
        let operand = operand.into();
        let is_free = self.registers.free.contains(operand);
        match self.register_wanted_at(next, operand.bank(), is_free.then_some(operand)) {
            Some(reg) => reg,
            None if is_free => operand,
            None => self.take_for_result(operand.bank()),
        }
    }

    /// What is pushed often turns out to be an argument.
    #[inline(always)]
    fn take_for_result(&mut self, bank: Bank) -> Reg {
        match ARGUMENT_GPRS.get(self.stack.len()) {
            Some(&reg) if self.unused(bank).contains(reg) => {
                self.registers.locked.insert(reg);
                reg.into()
            }
            _ => self.take(bank),
        }
    }

    #[inline(always)]
    fn register_wanted_at(&mut self, next: usize, bank: Bank, or: Option<Reg>) -> Option<Reg> {
        match self.bytes.get(next..).and_then(<[u8]>::first_chunk) {
            Some(&[LOCAL_SET | LOCAL_TEE, low, high]) => self.register_to_assign(low, high, or),
            Some(&[RETURN, ..]) | None => self.register_to_return(bank),
            Some(_) => None,
        }
    }

    #[inline(never)]
    fn register_to_return(&mut self, bank: Bank) -> Option<Reg> {
        let reg = match bank {
            Bank::Gpr => RESULT_GPRS[0].into(),
            Bank::Fpr => RESULT_FPRS[0].into(),
        };
        (self.registers.free - self.registers.pinned)
            .contains(reg)
            .then(|| self.registers.locked.insert(reg))?;
        Some(reg)
    }

    /// The register of a local whose value is not read any more, but for the operands that were popped.
    #[inline(never)]
    fn register_to_assign(&mut self, low: u8, high: u8, or: Option<Reg>) -> Option<Reg> {
        let local = match (low, high) {
            (0..0x80, _) => u32::from(low),
            (_, 0..0x80) => u32::from(low & 0x7f) | u32::from(high) << 7,
            _ => return None,
        };
        let ty = self.locals[local as usize].ty;
        let reg = match self.register_of(local) {
            Some(_) if self.may_be_on_stack(local) => return None,
            Some(reg) => {
                self.unbind(reg);
                reg
            }
            None => (self.free_hint(local).or(or))
                .or_else(|| Registers::best_for_local(self.unused(bank(ty.kind()))))?,
        };
        self.registers.locked.insert(reg);
        Some(reg)
    }

    fn may_be_on_stack(&self, local: u32) -> bool {
        let lazy = self.stack.get(self.lowest_lazy as usize..).unwrap_or(&[]);
        lazy.len() > LONGEST_SEARCH as usize || lazy.iter().any(|value| value.depends_on(local))
    }

    /// The register that the local was last in, if it is free and not set aside for another.
    #[inline]
    fn free_hint(&self, local: u32) -> Option<Reg> {
        let registers = &self.registers;
        Some(self.locals[local as usize].hint).filter(|&hint| {
            registers.free.contains(hint)
                && (!registers.pinned.contains(hint) || registers.local_in(hint) == local)
        })
    }

    /// Whether one is set aside for it and can be had.
    fn has_own_register(&self, local: u32) -> bool {
        let available = self.registers.pinned - self.registers.locked;
        self.free_hint(local)
            .is_some_and(|hint| available.contains(hint))
    }

    /// Whether it can have a register and one is left.
    #[inline]
    fn has_room_for(&self, local: u32) -> bool {
        let unused = self
            .unused(bank(self.locals[local as usize].ty.kind()))
            .bits();
        unused & unused.wrapping_sub(1) != 0 || self.has_own_register(local)
    }

    fn take_for_local(&mut self, local: u32) -> Reg {
        let bank = bank(self.locals[local as usize].ty.kind());
        let hint = self.free_hint(local);
        let reg = hint
            .filter(|&hint| !self.registers.locked.contains(hint))
            .or_else(|| Registers::best_for_local(self.unused(bank)))
            .unwrap_or_else(|| self.make_room(bank));
        self.registers.locked.insert(reg);
        reg
    }

    #[inline(never)]
    fn make_room_for_operand(&mut self, bank: Bank) -> Reg {
        let vacant = (self.registers.free - self.registers.locked).in_bank(bank);
        vacant.first().unwrap_or_else(|| self.make_room(bank))
    }

    /// Returns a free register that is not locked.
    #[inline(never)]
    fn make_room(&mut self, bank: Bank) -> Reg {
        let registers = &mut self.registers;
        let candidates = (registers.allocatable - registers.locked).in_bank(bank);
        let locals = (candidates & registers.cached) - registers.pinned;
        let mut stale = locals - registers.recent;
        if stale.is_empty() {
            registers.recent -= candidates;
            stale = locals;
        }
        let deepest_operand = || {
            (candidates & registers.operands())
                .into_iter()
                .min_by_key(|reg| registers.operand_of[reg.index()])
        };
        let reg = (stale - registers.dirty)
            .first()
            .or_else(|| stale.first())
            .or_else(|| (candidates & registers.free).first())
            .or_else(deepest_operand)
            .or_else(|| (candidates - registers.dirty).first())
            .or_else(|| candidates.first())
            .expect("an instruction locks few registers");
        self.evict(reg);
        reg
    }

    /// What is in the register goes to the frame.
    fn evict(&mut self, reg: Reg) {
        if self.registers.cached.contains(reg) {
            if self.registers.dirty.contains(reg) {
                self.write_back(reg);
            }
            self.unbind(reg);
        } else if !self.registers.free.contains(reg) {
            self.spill(reg);
        }
    }

    /// Frees and locks registers that an instruction is going to overwrite. Operands that were popped stay.
    pub(super) fn claim(&mut self, registers: RegisterSet) {
        self.registers.locked |= registers;
        for reg in registers - self.registers.free {
            let Some(other) = self.unused(reg.bank()).first() else {
                self.evict(reg);
                continue;
            };
            if self.registers.cached.contains(reg) {
                let local = self.registers.local_in(reg);
                let is_dirty = self.registers.dirty.contains(reg);
                self.copy(self.locals[local as usize].ty.kind(), other, reg);
                self.unbind(reg);
                self.bind(local, other);
                if is_dirty {
                    self.registers.dirty.insert(other);
                }
            } else {
                let position = self.registers.operand_of[reg.index()];
                let ty = self.stack[position as usize].ty();
                self.copy(ty.kind(), other, reg);
                self.registers.free.insert(reg);
                self.give_to_operand(position, ty, other);
            }
        }
    }

    /// For an integer that was popped before `registers` were claimed.
    pub(super) fn gpr_outside(&mut self, value: Operand, registers: RegisterSet) -> Gpr {
        match value.place() {
            Place::Register(reg) if registers.contains(reg) => {
                let other = self.take(Bank::Gpr);
                self.copy(value.kind(), other, reg);
                other.gpr()
            }
            _ => self.gpr(value),
        }
    }

    fn give_to_operand(&mut self, position: u32, ty: ValType, reg: Reg) {
        self.registers.free.remove(reg);
        self.registers.operand_of[reg.index()] = position;
        self.stack[position as usize] = Operand::in_register(ty, reg);
    }

    // Locals

    #[inline(always)]
    pub(super) fn register_of(&self, local: u32) -> Option<Reg> {
        let (hint, registers) = (self.locals[local as usize].hint, &self.registers);
        (registers.cached.contains(hint) & (registers.local_in(hint) == local)).then_some(hint)
    }

    /// The register is free and the local has none.
    #[inline(always)]
    pub(super) fn bind(&mut self, local: u32, reg: Reg) {
        debug_assert!(self.register_of(local).is_none());
        let registers = &mut self.registers;
        debug_assert!(registers.free.contains(reg));
        registers.free.remove(reg);
        registers.cached.insert(reg);
        if registers.local_in(reg) != local {
            registers.local_of[reg.index()] = local as u16;
            registers.snapshot = None;
        }
        self.locals[local as usize].hint = reg;
    }

    /// Stores nothing.
    #[inline(always)]
    pub(super) fn unbind(&mut self, reg: Reg) {
        self.unbind_all(RegisterSet::EMPTY.with(reg));
    }

    #[inline(always)]
    pub(super) fn unbind_all(&mut self, unbound: RegisterSet) {
        let registers = &mut self.registers;
        debug_assert!((unbound - registers.cached).is_empty());
        registers.free |= unbound;
        registers.cached -= unbound;
        registers.dirty -= unbound;
    }

    #[inline]
    fn write_back(&mut self, reg: Reg) {
        let Local { ty, offset, .. } = self.locals[self.registers.local_in(reg) as usize];
        self.store(ty.kind(), self.frame_address(offset), reg);
        self.registers.dirty.remove(reg);
    }

    #[inline]
    pub(super) fn write_back_all(&mut self, registers: RegisterSet) {
        for reg in registers {
            self.write_back(reg);
        }
    }

    #[inline(always)]
    pub(super) fn set_local(&mut self, local: u32) {
        let mut value = self.pop();
        if value.is_local(local) {
            return;
        }
        if self.lowest_lazy < self.height() {
            value = self.detach(local, value);
        }
        match (value.place(), self.register_of(local)) {
            (Place::Register(reg), None) if !self.has_own_register(local) => {
                self.bind(local, reg);
                self.registers.dirty.insert(reg);
            }
            (_, old) => self.assign(local, old, value),
        }
    }

    #[inline(never)]
    fn assign(&mut self, local: u32, old: Option<Reg>, value: Operand) {
        let reg = match (value.place(), old) {
            (Place::Register(reg), Some(old)) if !self.registers.pinned.contains(old) => {
                self.unbind(old);
                self.bind(local, reg);
                reg
            }
            (_, Some(old)) => {
                self.move_operand(old, value);
                old
            }
            (Place::Constant(bits), None) if !self.has_room_for(local) => {
                let offset = self.locals[local as usize].offset;
                return self.store_constant(value.kind(), self.frame_address(offset), bits);
            }
            (Place::Sum(source, addend), None)
                if source == local
                    && self.bytes[self.offset] == LOCAL_SET
                    && !self.has_room_for(local) =>
            {
                let offset = self.locals[local as usize].offset;
                return (self.masm).add32_to_memory(self.frame_address(offset), addend);
            }
            (_, None) => {
                self.lock(value);
                let reg = self.take_for_local(local);
                self.move_operand(reg, value);
                self.bind(local, reg);
                reg
            }
        };
        self.registers.locked.insert(reg);
        self.registers.dirty.insert(reg);
    }

    /// Gives the operands that depend on the local a place of their own. Returns where the new value is after that.
    #[inline(never)]
    fn detach(&mut self, local: u32, mut value: Operand) -> Operand {
        let height = self.height();
        if height - self.lowest_lazy > LONGEST_SEARCH {
            self.settle_lazy(height);
            return value;
        }
        let mut heir = None;
        for position in self.lowest_lazy..height {
            let old = self.stack[position as usize];
            if !old.depends_on(local) {
                continue;
            }
            if heir.is_none() && old.is_local(local) {
                heir = Some((position, old));
                continue;
            }
            let reg = self.writable(old);
            self.give_to_operand(position, old.ty(), reg);
            self.registers.locked.remove(reg);
        }
        if let Some((position, old)) = heir {
            if value.depends_on(local) {
                value = Operand::in_register(value.ty(), self.writable(value));
            }
            let reg = match self.register_of(local) {
                Some(reg) => {
                    self.unbind(reg);
                    reg
                }
                None => self.writable(old),
            };
            self.give_to_operand(position, old.ty(), reg);
        }
        value
    }
}
