//! How the paths that meet at a label come to agree on what the registers hold.
//!
//! Below the base of a block that was branched to, all operands are in their slots. A value that goes along alone is
//! in a register, several are in their slots. The first branch to the end of a block notes where the locals are. Later
//! ones take from that what is cheap to forget, and conform to the rest.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{CodeTooLarge, Reg};
use bun_engine_wasm_format::ValType;

use super::Function;
use super::control::BlockKind;
use super::moves::Step;
use super::operand::{Operand, Place, bank};
use super::registers::Local;

#[derive(Clone, Copy)]
pub(super) struct Target {
    pub(super) label: Label,
    /// Says whose the registers are.
    pub(super) snapshot: u32,
    pub(super) held: RegisterSet,
    pub(super) dirty: RegisterSet,
    pub(super) result: Option<Reg>,
}

/// From this many values on, a branch leaves them where the next one finds them.
const VALUES_SETTLED_AT_ONCE: u32 = 8;

/// The values that go along with a branch.
#[derive(Clone, Copy)]
pub(super) enum Carried {
    Nothing,
    One(Operand),
    /// So many from the top of the stack.
    Top(u32),
}

/// Whether what does no harm to the path that goes on may be done ahead of the branch.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Ahead {
    Allowed,
    TooLate,
}

/// Code between a branch and its target that is out of the way.
#[derive(Clone, Copy)]
pub(super) struct Detour {
    entry: Label,
    target: Label,
    steps_end: u32,
}

impl<'a> Function<'a> {
    #[inline]
    pub(super) fn snapshot(&mut self) -> u32 {
        let registers = &mut self.registers;
        *registers.snapshot.get_or_insert_with(|| {
            self.snapshots.push(registers.local_of);
            self.snapshots.len() as u32 - 1
        })
    }

    /// With the registers as they are.
    #[inline]
    pub(super) fn new_target(&mut self, result: Option<Reg>) -> Target {
        Target {
            label: self.masm.new_label(),
            snapshot: self.snapshot(),
            held: self.registers.cached,
            dirty: self.registers.dirty,
            result,
        }
    }

    /// What every branch starts with.
    #[inline]
    pub(super) fn save_for_first_branch(&mut self, base: u32) {
        self.settle(base);
        self.write_back_all(self.registers.dirty - self.registers.unsaved);
    }

    #[inline]
    pub(super) fn carried_to(&mut self, index: usize) -> Carried {
        let block = &self.blocks[index];
        match block.arity {
            0 => Carried::Nothing,
            1 if !block.is_loop() => Carried::One(self.top()),
            count => self.prepare_for_slots(count),
        }
    }

    #[inline(never)]
    fn prepare_for_slots(&mut self, count: u32) -> Carried {
        // Where a branch carries many values, they go in their slots once instead of being written out at each branch.
        if count >= VALUES_SETTLED_AT_ONCE {
            self.settle(self.height());
            return Carried::Top(count);
        }
        for position in self.height() - count..self.height() {
            if let Place::Sum(..) = self.stack[position as usize].place() {
                self.put_in_slot(position);
            }
        }
        Carried::Top(count)
    }

    /// The label of the block at `index`, and from `self.steps.len()` before the call what has to be done on the way.
    /// The values that go along are on the stack.
    #[inline]
    pub(super) fn route(&mut self, index: usize) -> Label {
        let mut carried = self.carried_to(index);
        let block = &self.blocks[index];
        let base = block.base;
        let Some(target) = block.target else {
            return self.first_route(index, carried);
        };
        self.settle(base);
        if let (Carried::One(value), Some(result)) = (carried, target.result) {
            carried = Carried::One(self.move_top_ahead(value, result));
        }
        self.plan(index, carried, Ahead::Allowed)
    }

    fn first_route(&mut self, index: usize, carried: Carried) -> Label {
        if index == 0 {
            self.blocks[0].target = Some(self.target_for_return());
            return self.route(0);
        }
        let base = self.blocks[index].base;
        self.save_for_first_branch(base);
        let result = match carried {
            Carried::Nothing => None,
            Carried::One(_) => Some(self.own_top()),
            Carried::Top(count) => {
                self.plan_slots(base, count);
                None
            }
        };
        let target = self.new_target(result);
        self.blocks[index].target = Some(target);
        target.label
    }

    /// Like [`Self::route`], after [`Self::save_for_first_branch`], and without emitting anything.
    pub(super) fn late_route(&mut self, index: usize, carried: Carried) -> Label {
        if self.blocks[index].target.is_none() {
            let result = match carried {
                Carried::One(value) => Some(value.register()),
                Carried::Nothing | Carried::Top(_) => None,
            };
            self.blocks[index].target = Some(self.new_target(result));
        }
        self.plan(index, carried, Ahead::TooLate)
    }

    fn move_top_ahead(&mut self, value: Operand, result: Reg) -> Operand {
        let available = self.registers.free - self.registers.locked;
        if !available.contains(result) {
            return value;
        }
        self.pop();
        self.move_operand(result, value);
        self.registers.locked.insert(result);
        self.push_register(value.ty(), result);
        Operand::in_register(value.ty(), result)
    }

    /// From the lowest up, as no value moves away from the bottom.
    #[inline(never)]
    fn plan_slots(&mut self, base: u32, count: u32) {
        let first = self.height() - count;
        for index in 0..count {
            let value = self.locate(self.stack[(first + index) as usize]);
            let step = Step::to_frame(self.frame.operand(base + index), value);
            self.steps.extend(step);
        }
    }

    /// Those of `target.held` that hold the same local now.
    #[inline]
    fn in_place(&self, target: &Target) -> RegisterSet {
        let registers = &self.registers;
        let mut same = target.held & registers.cached;
        if registers.snapshot != Some(target.snapshot) {
            let owners = &self.snapshots[target.snapshot as usize];
            for reg in same {
                if owners[reg.index()] != registers.local_of[reg.index()] {
                    same.remove(reg);
                }
            }
        }
        same
    }

    fn plan(&mut self, index: usize, carried: Carried, ahead: Ahead) -> Label {
        let block = &self.blocks[index];
        let (kind, base) = (block.kind, block.base);
        let mut target = block.target.expect("a block that was branched to");
        let is_bound = block.is_loop();
        let unsaved = self.registers.unsaved;

        let same = self.in_place(&target);
        let mut missing = target.held - same;
        if !is_bound {
            let forgotten = missing - target.dirty - block.pinned;
            target.held -= forgotten;
            missing -= forgotten;
            target.dirty |= same & self.registers.dirty & unsaved;
        }
        let mut stores = self.registers.dirty - (same & target.dirty);
        for reg in missing {
            let local = self.snapshots[target.snapshot as usize][reg.index()];
            let ty = self.locals[usize::from(local)].ty;
            if let Some(source) = self.register_of(local.into()) {
                if !is_bound && (stores & unsaved).contains(source) {
                    target.dirty.insert(reg);
                }
                if target.dirty.contains(reg) {
                    stores.remove(source);
                }
            }
            self.add_move(reg, Operand::of_local(ty, local.into()));
        }
        match kind {
            BlockKind::Body => stores = RegisterSet::EMPTY,
            BlockKind::Loop(number) => {
                for reg in stores {
                    if self.locals[self.registers.local_in(reg) as usize].dead_at_loop == number {
                        stores.remove(reg);
                    }
                }
            }
            _ => {}
        }
        self.blocks[index].target = Some(target);

        if ahead == Ahead::Allowed {
            let now = if is_bound { stores } else { stores - unsaved };
            self.write_back_all(now);
            stores -= now;
        }
        for reg in stores {
            let Local { ty, offset, .. } = self.locals[self.registers.local_in(reg) as usize];
            self.steps.push(Step::Store(ty.kind(), offset, reg));
        }
        match carried {
            Carried::Nothing => {}
            Carried::One(value) => {
                self.add_move(target.result.expect("a register for the value"), value);
            }
            Carried::Top(count) => self.plan_slots(base, count),
        }
        self.moves.finish(&mut self.steps);
        target.label
    }

    /// For control that goes nowhere else.
    #[inline]
    pub(super) fn conform_to_block(&mut self, index: usize) -> Label {
        let start = self.steps.len();
        let label = self.route(index);
        self.emit_steps_from(start);
        label
    }

    #[inline]
    pub(super) fn jump_to_block(&mut self, index: usize) -> Result<(), CodeTooLarge> {
        let label = self.conform_to_block(index);
        self.masm.jump(label);
        self.check_size()
    }

    /// A label to jump to from code that follows and changes nothing.
    pub(super) fn label_for_branch(&mut self, index: usize) -> Result<Label, CodeTooLarge> {
        let start = self.steps.len();
        let target = self.route(index);
        if self.steps.len() == start {
            return Ok(target);
        }
        let entry = self.masm.new_label();
        if self.steps.len() - start <= Reg::COUNT {
            self.detour(entry, target);
        } else {
            let past = self.masm.new_label();
            self.masm.jump(past);
            self.masm.bind(entry);
            self.emit_steps_from(start);
            self.masm.jump(target);
            self.masm.bind(past);
        }
        self.check_size()?;
        Ok(entry)
    }

    /// If the condition holds.
    #[inline]
    pub(super) fn branch_to_block(&mut self, index: usize) -> Result<(), CodeTooLarge> {
        if !self.blocks[index].is_loop() {
            let label = self.label_for_branch(index)?;
            self.branch_on_condition(label);
            return Ok(());
        }
        let start = self.steps.len();
        let label = self.route(index);
        if self.steps.len() == start {
            self.branch_on_condition(label);
            return Ok(());
        }
        let past = self.masm.new_label();
        self.invert_condition();
        self.branch_on_condition(past);
        self.emit_steps_from(start);
        self.masm.jump(label);
        self.masm.bind(past);
        self.check_size()
    }

    /// Takes the steps that were planned last.
    pub(super) fn detour(&mut self, entry: Label, target: Label) {
        self.detours.push(Detour {
            entry,
            target,
            steps_end: self.steps.len() as u32,
        });
    }

    /// Control does not get here.
    #[inline]
    pub(super) fn emit_detours(&mut self) {
        if !self.detours.is_empty() {
            self.emit_pending_detours();
        }
    }

    fn emit_pending_detours(&mut self) {
        let mut start = 0;
        for index in 0..self.detours.len() {
            let detour = self.detours[index];
            self.masm.bind(detour.entry);
            for step in start..detour.steps_end {
                self.emit_step(self.steps[step as usize]);
            }
            self.masm.jump(detour.target);
            start = detour.steps_end;
        }
        self.detours.clear();
        self.steps.clear();
    }

    /// Takes over what holds at the label. The stack ends at `base`.
    pub(super) fn adopt(&mut self, target: &Target, base: u32) {
        let same = self.in_place(target);
        let registers = &mut self.registers;
        if registers.snapshot != Some(target.snapshot) {
            registers.local_of = self.snapshots[target.snapshot as usize];
            registers.snapshot = Some(target.snapshot);
        }
        for reg in target.held - same {
            self.locals[registers.local_in(reg) as usize].hint = reg;
        }
        registers.cached = target.held;
        registers.dirty = target.dirty & target.held;
        registers.free = registers.allocatable - target.held;
        registers.locked = RegisterSet::EMPTY;
        self.stack.truncate(base as usize);
        self.lowest_lazy = base;
        self.is_dead = false;
    }

    /// For where all is in the frame.
    pub(super) fn forget_registers(&mut self, base: u32) {
        self.unbind_all(self.registers.cached);
        self.registers.free = self.registers.allocatable;
        self.registers.locked = RegisterSet::EMPTY;
        self.stack.truncate(base as usize);
        self.lowest_lazy = base;
        self.is_dead = false;
    }

    pub(super) fn push_carried(&mut self, target: &Target, types: &[ValType]) {
        match target.result {
            Some(reg) => {
                debug_assert!(bank(types[0].kind()) == reg.bank());
                self.push_register(types[0], reg);
            }
            None => types.iter().for_each(|&ty| self.push_slot(ty)),
        }
    }
}
