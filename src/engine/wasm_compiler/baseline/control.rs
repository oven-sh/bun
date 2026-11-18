//! Blocks and branches.

use bun_engine_asm::CodeTooLarge;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{
    BlockType, BrTable, Catches, Flow, FuncIndex, RefType, TableIndex, TagIndex, TypeIndex,
    ValType, VisitControl,
};

use super::calls::{Callee, Leaves};
use super::edges::{Carried, Target};
use super::operand::{self, Operand};
use super::{Compiled, Function};
use crate::abi::{NULL, Place, Trap};
use crate::clauses::Scope;

#[derive(Clone, Copy)]
pub(super) enum BlockKind {
    Body,
    Block,
    /// With its index.
    Loop(u32),
    /// The target for a false condition is the last of `else_targets`.
    If,
    /// The condition is false, and all is as it was in front of the block.
    IfNever,
    IfAlways,
    /// All is as it was at the end of the first arm, to which control came or not.
    ElseNever(Flow),
    Try,
    Catch {
        /// For an exception that no clause so far matches.
        unmatched: Option<Label>,
        /// The offset in the frame.
        exception: i32,
        /// That of the `try`.
        scope: Scope,
    },
    /// Its clauses are those of `catches` from this position on.
    TryTable(u32),
}

#[derive(Clone, Copy)]
pub(super) struct Block {
    pub(super) kind: BlockKind,
    pub(super) ty: BlockType,
    /// The height of the operand stack below the parameters.
    pub(super) base: u32,
    /// The number of values that a branch takes along.
    pub(super) arity: u32,
    /// For what is thrown directly in the block.
    pub(super) handler: Scope,
    /// As in `Registers`, directly in the block.
    pub(super) pinned: RegisterSet,
    pub(super) unsaved: RegisterSet,
    /// Once there is a branch to it.
    pub(super) target: Option<Target>,
    /// During a `br_table`, where that goes for this block.
    entry: Option<Label>,
}

impl Block {
    #[inline(always)]
    pub(super) fn is_loop(&self) -> bool {
        matches!(self.kind, BlockKind::Loop(_))
    }
}

/// With more runs of equal labels, a table is faster than comparisons.
const MOST_RUNS_TO_SEARCH: usize = 5;

impl<'a> Function<'a> {
    #[inline(always)]
    pub(super) fn innermost(&mut self) -> &mut Block {
        self.blocks.last_mut().expect("an open block")
    }

    #[inline(always)]
    pub(super) fn block_index(&self, label: u32) -> usize {
        self.blocks.len() - 1 - label as usize
    }

    #[inline(always)]
    pub(super) fn param_count(&self, ty: BlockType) -> u32 {
        match ty {
            BlockType::Empty | BlockType::Value(_) => 0,
            BlockType::Func(index) => self.module.types().func_type(index).params.len() as u32,
        }
    }

    #[inline(always)]
    pub(super) fn open(&mut self, kind: BlockKind, ty: BlockType, handler: Scope) {
        let is_loop = matches!(kind, BlockKind::Loop(_));
        let (params, results) = match ty {
            BlockType::Empty => (0, 0),
            BlockType::Value(_) => (0, 1),
            BlockType::Func(index) => {
                let ty = self.module.types().func_type(index);
                (ty.params.len() as u32, ty.results.len() as u32)
            }
        };
        let base = match kind {
            BlockKind::Body => 0,
            _ => self.height() - params,
        };
        self.blocks.push(Block {
            kind,
            ty,
            base,
            arity: if is_loop { params } else { results },
            handler,
            pinned: self.registers.pinned,
            unsaved: self.registers.unsaved,
            target: None,
            entry: None,
        });
    }

    #[inline(always)]
    fn open_plain(&mut self, kind: BlockKind, ty: BlockType) {
        let handler = self.innermost().handler;
        self.open(kind, ty, handler);
    }

    /// Ends the innermost block, which is no loop.
    #[inline]
    pub(super) fn close(&mut self, flow: Flow) -> Compiled {
        let index = self.blocks.len() - 1;
        if flow == Flow::Dead {
            self.emit_detours();
        }
        if self.blocks[index].target.is_none() {
            self.blocks.pop();
            self.is_dead = flow == Flow::Dead;
            return Ok(());
        }
        if flow == Flow::Live {
            self.conform_to_block(index);
        }
        let block = self.blocks.pop().expect("an open block");
        let target = block.target.expect("a block that was branched to");
        self.masm.bind(target.label);
        self.adopt(&target, block.base);
        if block.arity != 0 {
            self.push_carried(&target, self.module.types().block_type(&block.ty).results);
        }
        self.check_size()
    }

    /// Ends an arm that another follows.
    pub(super) fn leave_arm(&mut self, flow: Flow) -> Compiled {
        if flow == Flow::Live {
            self.jump_to_block(self.blocks.len() - 1)?;
        }
        self.emit_detours();
        Ok(())
    }

    fn start_else(&mut self, flow: Flow) -> Compiled {
        self.leave_arm(flow)?;
        let target = self.else_targets.pop().expect("an open `if`");
        let block = self.innermost();
        block.kind = BlockKind::Block;
        let (ty, base) = (block.ty, block.base);
        self.masm.bind(target.label);
        self.adopt(&target, base);
        self.push_carried(&target, self.module.types().block_type(&ty).params);
        Ok(())
    }

    fn end_if_without_else(&mut self, flow: Flow) -> Compiled {
        let index = self.blocks.len() - 1;
        let block = &mut self.blocks[index];
        if block.ty != BlockType::Empty || flow == Flow::Dead {
            self.start_else(flow)?;
            return self.close(Flow::Live);
        }
        let otherwise = self.else_targets.pop().expect("an open `if`");
        if block.target.is_none() {
            block.target = Some(otherwise);
            return self.close(flow);
        }
        let base = block.base;
        self.conform_to_block(index);
        self.adopt(&otherwise, base);
        let start = self.steps.len();
        let end = self.late_route(index, Carried::Nothing);
        if self.steps.len() == start {
            self.masm.alias(otherwise.label, end);
        } else {
            self.detour(otherwise.label, end);
        }
        let block = self.blocks.pop().expect("an open block");
        self.masm.bind(end);
        self.adopt(&block.target.expect("a block that was branched to"), base);
        Ok(())
    }

    fn end_body(&mut self, flow: Flow) -> Compiled {
        self.close(flow)?;
        if !self.is_dead {
            self.emit_return();
        }
        Ok(())
    }

    /// Branches out of the body meet in front of a last return.
    pub(super) fn target_for_return(&mut self) -> Target {
        let result = match self.signature.results[..] {
            [Place::Register(reg)] => Some(reg),
            _ => None,
        };
        Target {
            held: RegisterSet::EMPTY,
            dirty: RegisterSet::EMPTY,
            ..self.new_target(result)
        }
    }

    pub(super) fn emit_return(&mut self) {
        match self.signature.results[..] {
            [] => {}
            [Place::Register(reg)] => self.move_operand(reg, self.top()),
            _ => self.move_results(),
        }
        self.masm.leave_frame();
        self.masm.ret();
    }

    #[inline(never)]
    fn move_results(&mut self) {
        let count = self.signature.results.len();
        let first = self.stack.len() - count;
        for index in 0..count {
            let value = self.stack[first + index];
            match self.signature.results[index] {
                Place::Register(reg) => self.add_move(reg, value),
                Place::Stack(offset) => self.store_operand(self.frame_address(offset), value),
            }
        }
        self.emit_moves();
    }

    pub(super) fn jump_to_label(&mut self, label: u32) -> Compiled {
        self.is_dead = true;
        match self.block_index(label) {
            0 => {
                self.emit_return();
                self.check_size()
            }
            index => self.jump_to_block(index),
        }
    }

    fn switch(&mut self, table: BrTable<'_>) -> Compiled {
        let index = self.pop();
        if let Some(chosen) = index.constant() {
            let label = table.labels().nth(chosen as usize);
            return self.jump_to_label(label.unwrap_or_else(|| table.default_label()));
        }
        let default = self.block_index(table.default_label());
        let mut carried = self.carried_to(default);
        let arity = self.blocks[default].arity;
        self.save_for_first_branch(self.height() - arity);
        if arity == 1 {
            let reg = self.own_top();
            carried = Carried::One(Operand::in_register(self.top().ty(), reg));
        }

        let mut labels = core::mem::take(&mut self.table_labels);
        let mut targets = core::mem::take(&mut self.table_targets);
        for label in table.labels().chain([table.default_label()]) {
            let block = self.block_index(label);
            labels.push(*self.blocks[block].entry.get_or_insert_with(|| {
                targets.push(block as u32);
                self.masm.new_label()
            }));
        }
        self.dispatch(index, &labels);
        labels.clear();
        self.table_labels = labels;

        self.emit_detours();
        for block in targets.drain(..) {
            let block = block as usize;
            let entry = self.blocks[block].entry.take().expect("a target");
            if block == 0 {
                self.masm.bind(entry);
                self.emit_return();
            } else {
                let carried = match carried {
                    Carried::One(_) if self.blocks[block].is_loop() => Carried::Top(1),
                    _ => carried,
                };
                let target = self.late_route(block, carried);
                if self.steps.is_empty() {
                    self.masm.alias(entry, target);
                } else {
                    self.masm.bind(entry);
                    self.emit_steps_from(0);
                    self.masm.jump(target);
                }
            }
            self.check_size()?;
        }
        self.table_targets = targets;
        Ok(())
    }

    /// The last label is for every index from there on.
    fn dispatch(&mut self, index: Operand, labels: &[Label]) {
        let mut runs = [(0, labels[0]); MOST_RUNS_TO_SEARCH];
        let mut count = 1;
        for (start, &label) in (0..).zip(labels) {
            if label == runs[count - 1].1 {
                continue;
            }
            if count == runs.len() {
                let index = self.writable(index).gpr();
                let (&default, labels) = labels.split_last().expect("a default");
                (self.masm).branch32(Cond::AboveEq, index, labels.len() as u32, default);
                return self.masm.jump_table(index, labels);
            }
            runs[count] = (start, label);
            count += 1;
        }
        let index = self.gpr(index);
        self.search(index, &runs[..count]);
    }

    fn search(&mut self, index: Gpr, runs: &[(u32, Label)]) {
        let (low, high) = runs.split_at(runs.len() / 2);
        match (low, high) {
            ([], _) => self.masm.jump(high[0].1),
            (&[(_, label)], _) => {
                self.masm.branch32(Cond::Below, index, high[0].0, label);
                self.search(index, high);
            }
            _ => {
                let above = self.masm.new_label();
                self.masm.branch32(Cond::AboveEq, index, high[0].0, above);
                self.search(index, low);
                self.masm.bind(above);
                self.search(index, high);
            }
        }
    }

    pub(super) fn narrow_top(&mut self, ty: impl Into<ValType>) {
        let top = self.stack.last_mut().expect("the code was validated");
        *top = top.with_type(ty.into());
    }

    #[inline(always)]
    pub(super) fn check_size(&self) -> Result<(), CodeTooLarge> {
        /// Only instructions whose code grows with a type get beyond that.
        const BYTES_FOR_EACH_BYTE: usize = 64;
        const FOR_ANY_FUNCTION: usize = 16 << 20;
        match self.masm.size() > FOR_ANY_FUNCTION + self.bytes.len() * BYTES_FOR_EACH_BYTE {
            true => Err(CodeTooLarge),
            false => Ok(()),
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitControl for Function<'_> {
    fn unreachable(&mut self) -> Compiled {
        self.trap(Trap::Unreachable);
        Ok(())
    }

    #[inline(always)]
    fn nop(&mut self) -> Compiled {
        Ok(())
    }

    #[inline]
    fn block(&mut self, ty: BlockType) -> Compiled {
        self.open_plain(BlockKind::Block, ty);
        Ok(())
    }

    #[inline(never)]
    fn loop_(&mut self, ty: BlockType, index: u32) -> Compiled {
        self.enter_loop(ty, index);
        Ok(())
    }

    #[inline(never)]
    fn if_(&mut self, ty: BlockType) -> Compiled {
        let kind = match self.pop_condition(Width::W32) {
            Some(true) => BlockKind::IfAlways,
            Some(false) => {
                self.is_dead = true;
                BlockKind::IfNever
            }
            None => {
                self.save_for_first_branch(self.height());
                let otherwise = self.new_target(None);
                self.invert_condition();
                self.branch_on_condition(otherwise.label);
                self.else_targets.push(otherwise);
                BlockKind::If
            }
        };
        self.open_plain(kind, ty);
        Ok(())
    }

    #[inline(never)]
    fn else_(&mut self, flow: Flow) -> Compiled {
        let block = self.innermost();
        match block.kind {
            BlockKind::IfNever => {
                block.kind = BlockKind::Block;
                self.is_dead = false;
            }
            BlockKind::IfAlways => {
                block.kind = BlockKind::ElseNever(flow);
                self.is_dead = true;
            }
            _ => self.start_else(flow)?,
        }
        Ok(())
    }

    #[inline(never)]
    fn end(&mut self, flow: Flow) -> Compiled {
        match self.innermost().kind {
            BlockKind::Block | BlockKind::IfAlways => self.close(flow),
            BlockKind::Loop(_) => {
                self.leave_loop(flow);
                Ok(())
            }
            BlockKind::If => self.end_if_without_else(flow),
            BlockKind::IfNever => self.close(Flow::Live),
            BlockKind::ElseNever(flow) => self.close(flow),
            BlockKind::Body => self.end_body(flow),
            BlockKind::Try => self.end_try_without_catch(flow),
            BlockKind::Catch { .. } => self.end_catch(flow),
            BlockKind::TryTable(first_catch) => self.end_try_table(first_catch, flow),
        }
    }

    #[inline(never)]
    fn br(&mut self, label: u32) -> Compiled {
        self.jump_to_label(label)
    }

    #[inline(never)]
    fn br_if(&mut self, label: u32) -> Compiled {
        match self.pop_condition(Width::W32) {
            Some(false) => Ok(()),
            Some(true) => self.jump_to_label(label),
            None => self.branch_to_block(self.block_index(label)),
        }
    }

    #[inline(never)]
    fn br_table(&mut self, table: BrTable<'_>) -> Compiled {
        self.switch(table)
    }

    #[inline(never)]
    fn br_on_null(&mut self, label: u32) -> Compiled {
        let value = self.pop();
        let ty = value.ty().as_ref().expect("a reference");
        let non_null = value.with_type(ty.heap_type().non_null().into());
        if value.constant() == Some(NULL as u64) {
            return self.jump_to_label(label);
        }
        if !ty.is_nullable() || value.constant().is_some() {
            self.push(non_null);
            return Ok(());
        }
        // The slot may be where a value goes that the branch takes along, but only once it is taken.
        let reg = self.register(value);
        self.compare_with_null(Cond::Eq, Operand::in_register(value.ty(), reg));
        self.branch_to_block(self.block_index(label))?;
        match value.place() {
            operand::Place::Local(_) => self.push(non_null),
            _ => self.push_register(non_null.ty(), reg),
        }
        Ok(())
    }

    #[inline(never)]
    fn br_on_non_null(&mut self, label: u32) -> Compiled {
        let value = self.top();
        let ty = value.ty().as_ref().expect("a reference");
        if value.constant() == Some(NULL as u64) {
            self.pop();
            return Ok(());
        }
        if !ty.is_nullable() || value.constant().is_some() {
            return self.jump_to_label(label);
        }
        let reg = self.own_top();
        self.compare_with_null(Cond::Ne, Operand::in_register(value.ty(), reg));
        self.branch_to_block(self.block_index(label))?;
        self.pop();
        Ok(())
    }

    fn br_on_cast(&mut self, label: u32, _: RefType, to: RefType) -> Compiled {
        self.branch_on_cast(label, to)
    }

    fn br_on_cast_fail(&mut self, label: u32, _: RefType, to: RefType) -> Compiled {
        self.branch_on_cast_failure(label, to)
    }

    #[inline(never)]
    fn return_(&mut self) -> Compiled {
        self.emit_return();
        self.check_size()
    }

    #[inline(never)]
    fn call(&mut self, func: FuncIndex, site: u32) -> Compiled {
        self.call_function(Callee::Func(func), site, Leaves::No)
    }

    #[inline(never)]
    fn call_indirect(&mut self, ty: TypeIndex, table: TableIndex, site: u32) -> Compiled {
        self.call_function(Callee::Element(ty, table), site, Leaves::No)
    }

    #[inline(never)]
    fn call_ref(&mut self, ty: TypeIndex, site: u32) -> Compiled {
        self.call_function(Callee::Reference(ty), site, Leaves::No)
    }

    #[inline(never)]
    fn return_call(&mut self, func: FuncIndex, site: u32) -> Compiled {
        self.call_function(Callee::Func(func), site, Leaves::Yes)
    }

    #[inline(never)]
    fn return_call_indirect(&mut self, ty: TypeIndex, table: TableIndex, site: u32) -> Compiled {
        self.call_function(Callee::Element(ty, table), site, Leaves::Yes)
    }

    #[inline(never)]
    fn return_call_ref(&mut self, ty: TypeIndex, site: u32) -> Compiled {
        self.call_function(Callee::Reference(ty), site, Leaves::Yes)
    }

    #[inline(never)]
    fn throw(&mut self, tag: TagIndex) -> Compiled {
        self.throw_new(tag)
    }

    #[inline(never)]
    fn throw_ref(&mut self) -> Compiled {
        let exception = self.pop();
        self.throw_again(exception);
        Ok(())
    }

    #[inline(never)]
    fn try_table(&mut self, ty: BlockType, catches: Catches<'_>) -> Compiled {
        let first_catch = self.catches.len() as u32;
        self.catches.extend(catches);
        self.open_try(BlockKind::TryTable(first_catch), ty);
        Ok(())
    }

    #[inline(never)]
    fn try_(&mut self, ty: BlockType) -> Compiled {
        self.open_try(BlockKind::Try, ty);
        Ok(())
    }

    #[inline(never)]
    fn catch(&mut self, tag: TagIndex, flow: Flow) -> Compiled {
        self.start_catch(Some(tag), flow)
    }

    #[inline(never)]
    fn catch_all(&mut self, flow: Flow) -> Compiled {
        self.start_catch(None, flow)
    }

    #[inline(never)]
    fn delegate(&mut self, label: u32, flow: Flow) -> Compiled {
        let handler = self.blocks[self.block_index(label + 1)].handler;
        self.end_try_delegating(handler, flow)
    }

    #[inline(never)]
    fn rethrow(&mut self, label: u32) -> Compiled {
        let BlockKind::Catch { exception, .. } = self.blocks[self.block_index(label)].kind else {
            unreachable!("the code was validated");
        };
        self.throw_again(Operand::in_slot(ValType::EXNREF, exception));
        Ok(())
    }
}
