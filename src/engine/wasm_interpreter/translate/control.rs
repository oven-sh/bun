//! Blocks and jumps.

use bun_engine_asm::{Cond, Width};
use bun_engine_wasm_compiler::abi::NULL;
use bun_engine_wasm_format::{
    BlockType, BrTable, Catches, Flow, FuncIndex, RefType, TableIndex, TagIndex, TypeIndex,
    ValKind, ValType, VisitControl,
};

use super::condition::Condition;
use super::emit::{Label, Register, Wanted};
use super::operands::{Input, Place};
use super::{Done, Translator};
use crate::handlers::Scope;
use crate::run::{control, moves, reference};

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Body,
    Block,
    Loop,
    If {
        otherwise: Label,
    },
    Try,
    /// With the slot of the exception, and the scope of the `try`.
    Catch {
        exception: u32,
        of: Scope,
    },
    TryTable {
        first_catch: usize,
    },
}

#[derive(Clone, Copy)]
pub(super) struct Block<'a> {
    pub(super) kind: Kind,
    /// The height of the operand stack without the parameters.
    pub(super) base: usize,
    pub(super) first_slot: u32,
    params: &'a [ValType],
    results: &'a [ValType],
    pub(super) label: Label,
    /// For what is thrown directly in it.
    pub(super) scope: Scope,
    /// The position of the last `br_table` that leads to it by a detour, and where that is wanted.
    detour: (u32, Label),
}

impl Block<'_> {
    /// How many values a jump takes along.
    fn arity(&self) -> usize {
        match self.kind {
            Kind::Loop => self.params.len(),
            _ => self.results.len(),
        }
    }
}

/// One of the same kind.
fn alone(ty: ValType) -> &'static [ValType] {
    match ty.kind() {
        ValKind::I32 => &[ValType::I32],
        ValKind::I64 => &[ValType::I64],
        ValKind::F32 => &[ValType::F32],
        ValKind::F64 => &[ValType::F64],
        ValKind::V128 => &[ValType::V128],
        ValKind::Ref => &[ValType::ANYREF],
    }
}

/// More are moved by one instruction.
const MOST_MOVED_SINGLY: usize = 2;

/// What a jump depends on.
#[derive(Clone, Copy)]
enum Test {
    Condition(Condition),
    Cast {
        value: u16,
        to: RefType,
        passes: bool,
    },
}

impl<'a> Translator<'a> {
    pub(super) fn innermost(&mut self) -> &mut Block<'a> {
        self.blocks.last_mut().expect("the body was validated")
    }

    pub(super) fn index_of_label(&self, label: u32) -> usize {
        self.blocks.len() - 1 - label as usize
    }

    fn push_block(
        &mut self,
        kind: Kind,
        params: &'a [ValType],
        results: &'a [ValType],
        scope: Scope,
    ) -> Done {
        let base = self.operands.len() - params.len();
        self.blocks.try_reserve(1)?;
        self.blocks.push(Block {
            kind,
            base,
            first_slot: self.slot_at(base),
            params,
            results,
            label: Label::UNUSED,
            scope,
            detour: (0, Label::UNUSED),
        });
        Ok(())
    }

    pub(super) fn open_body(&mut self, results: &'a [ValType]) -> Done {
        self.push_block(Kind::Body, &[], results, Scope::NONE)
    }

    /// What is below the parameters is in the same place on all paths through the block.
    pub(super) fn open(&mut self, kind: Kind, ty: BlockType, scope: Scope) -> Done {
        let (params, results) = match ty {
            BlockType::Empty => (&[][..], &[][..]),
            BlockType::Value(result) => (&[][..], alone(result)),
            BlockType::Func(index) => {
                let ty = self.module.types().func_type(index);
                (ty.params, ty.results)
            }
        };
        self.settle_below(self.operands.len() - params.len())?;
        self.push_block(kind, params, results, scope)
    }

    fn move_range(&mut self, to: u32, from: u32) -> Done {
        if to == from || from == self.free_slot() {
            return Ok(());
        }
        self.emit_low(moves::move_range, to, from)?;
        self.extend(0, self.free_slot() - from)?;
        self.forget_last_results();
        Ok(())
    }

    /// Before the paths part. Tells whether a jump to the block needs more.
    fn prepare_to_leave_for(&mut self, index: usize) -> Done<bool> {
        let block = self.blocks[index];
        let count = block.arity();
        if let Kind::Body = block.kind {
            if count > 1 {
                self.settle_top(count)?;
            }
            return Ok(true);
        }
        let is_in_place = self.slot_at(self.operands.len() - count) == block.first_slot;
        if is_in_place || count > MOST_MOVED_SINGLY {
            self.settle_top(count)?;
        }
        Ok(!is_in_place && count != 0)
    }

    /// After that. The operands stay as they are.
    fn leave_for(&mut self, index: usize) -> Done {
        let block = self.blocks[index];
        let first = self.operands.len() - block.arity();
        if let Kind::Body = block.kind {
            return self.leave_function(first);
        }
        if block.arity() > MOST_MOVED_SINGLY {
            self.move_range(block.first_slot, self.slot_at(first))?;
        } else {
            let distance = self.slot_at(first) - block.first_slot;
            for height in first..self.operands.len() {
                let operand = self.operands[height];
                self.put(operand.slot - distance, operand)?;
            }
        }
        self.jump_to(index)
    }

    pub(super) fn jump_to(&mut self, index: usize) -> Done {
        let mut label = self.blocks[index].label;
        self.jump(&mut label)?;
        self.blocks[index].label = label;
        Ok(())
    }

    fn leave_function(&mut self, first: usize) -> Done {
        let [result] = self.operands[first..] else {
            self.move_range(0, self.slot_at(first))?;
            return self.emit(control::leave, 0, 0, 0);
        };
        if result.kind == ValKind::V128 {
            self.put(0, result)?;
            return self.emit(control::leave, 0, 0, 0);
        }
        if let Some(Ok(bits)) = result.constant().map(u32::try_from) {
            return self.emit(control::leave_with_constant, 0, 0, bits);
        }
        if result.constant().is_some() {
            self.put(0, result)?;
            return self.emit(control::leave_with::<u64, false>, 0, 0, 0);
        }
        let Input::Slot(slot) = self.input(result, 0)? else {
            unreachable!("not a constant");
        };
        let handler = if self.is_last(Register::Int, slot) {
            control::leave_with::<u64, true>
        } else if self.is_last(Register::Double, slot) {
            control::leave_with::<f64, true>
        } else if self.is_last(Register::Single, slot) {
            control::leave_with::<f32, true>
        } else {
            control::leave_with::<u64, false>
        };
        self.emit(handler, slot, 0, 0)
    }

    fn branch_on(&mut self, test: Test, is_inverted: bool, label: &mut Label) -> Done {
        match test {
            Test::Condition(it) => self.branch(if is_inverted { it.inverted() } else { it }, label),
            Test::Cast { value, to, passes } => {
                let handler =
                    reference::for_branch_on_cast(passes != is_inverted, label.is_bound());
                let target = label.target_for(Wanted::imm(self.position()));
                self.emit(handler, value, 0, target)?;
                self.forget_last_results();
                self.extend_wide(self.record_for(to))
            }
        }
    }

    /// `test` comes after what has to be prepared.
    fn leave_if(&mut self, label: u32, test: impl FnOnce(&mut Self) -> Done<Test>) -> Done {
        let index = self.index_of_label(label);
        let needs_more = self.prepare_to_leave_for(index)?;
        let test = test(self)?;
        if !needs_more {
            let mut label = self.blocks[index].label;
            self.branch_on(test, false, &mut label)?;
            self.blocks[index].label = label;
            return Ok(());
        }
        let mut stay = Label::UNUSED;
        self.branch_on(test, true, &mut stay)?;
        let last_results = self.last_results;
        self.leave_for(index)?;
        self.last_results = last_results;
        self.bind_keeping_last_results(stay);
        Ok(())
    }

    fn leave_if_cast(&mut self, label: u32, to: RefType, passes: bool) -> Done {
        self.leave_if(label, |this| {
            let value = this.top_in_slot()?;
            Ok(Test::Cast { value, to, passes })
        })
    }

    /// At the end of a part of the innermost block that is not the last.
    pub(super) fn leave_part(&mut self, flow: Flow) -> Done {
        if flow == Flow::Live {
            let count = self.innermost().results.len();
            self.settle_top(count)?;
            self.jump_to(self.blocks.len() - 1)?;
        }
        let base = self.innermost().base;
        self.truncate(base);
        self.is_dead = false;
        Ok(())
    }

    pub(super) fn close(&mut self, flow: Flow) -> Done {
        let block = self.blocks.pop().expect("the body was validated");
        let otherwise = match block.kind {
            Kind::If { otherwise } => otherwise,
            _ => Label::UNUSED,
        };
        let is_target = block.label.is_wanted() || otherwise.is_wanted();
        if let Kind::Body = block.kind {
            if flow == Flow::Live {
                self.blocks.push(block);
                self.br(0)?;
                self.blocks.pop();
            }
            if !is_target {
                return Ok(());
            }
            self.bind(block.label);
            self.truncate(0);
            self.push_all(block.results);
            return self.leave_function(0);
        }
        self.is_dead = flow == Flow::Dead && !is_target;
        if is_target {
            if flow == Flow::Live {
                self.settle_top(block.results.len())?;
            }
            self.bind(block.label);
            self.bind(otherwise);
        }
        if flow == Flow::Dead {
            self.truncate(block.base);
            self.push_all(block.results);
        }
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitControl for Translator<'_> {
    fn unreachable(&mut self) -> Done {
        self.emit(control::unreachable, 0, 0, 0)
    }

    fn nop(&mut self) -> Done {
        Ok(())
    }

    fn block(&mut self, ty: BlockType) -> Done {
        let scope = self.innermost().scope;
        self.open(Kind::Block, ty, scope)
    }

    fn loop_(&mut self, ty: BlockType, _: u32) -> Done {
        let scope = self.innermost().scope;
        self.open(Kind::Loop, ty, scope)?;
        let count = self.innermost().params.len();
        self.settle_top(count)?;
        self.innermost().label = Label::Bound(self.bind(Label::UNUSED));
        Ok(())
    }

    fn if_(&mut self, ty: BlockType) -> Done {
        let (condition, scope) = (self.pop_condition()?, self.innermost().scope);
        let mut otherwise = Label::UNUSED;
        self.open(Kind::Block, ty, scope)?;
        let count = self.innermost().params.len();
        self.settle_top(count)?;
        self.branch(condition.inverted(), &mut otherwise)?;
        self.innermost().kind = Kind::If { otherwise };
        Ok(())
    }

    fn else_(&mut self, flow: Flow) -> Done {
        self.leave_part(flow)?;
        let block = self.innermost();
        let Kind::If { otherwise } = core::mem::replace(&mut block.kind, Kind::Block) else {
            unreachable!("the body was validated");
        };
        let params = block.params;
        self.bind(otherwise);
        self.push_all(params);
        Ok(())
    }

    fn end(&mut self, flow: Flow) -> Done {
        match self.innermost().kind {
            Kind::Try => self.end_try(None, flow),
            Kind::Catch { .. } => {
                self.catch_depth -= 1;
                self.close(flow)
            }
            Kind::TryTable { first_catch } => self.end_try_table(first_catch, flow),
            Kind::Loop => {
                self.innermost().label = Label::UNUSED;
                self.close(flow)
            }
            Kind::Body | Kind::Block | Kind::If { .. } => self.close(flow),
        }
    }

    fn br(&mut self, label: u32) -> Done {
        let index = self.index_of_label(label);
        self.prepare_to_leave_for(index)?;
        self.leave_for(index)
    }

    fn br_if(&mut self, label: u32) -> Done {
        let condition = self.pop_condition()?;
        self.leave_if(label, |_| Ok(Test::Condition(condition)))
    }

    fn br_table(&mut self, table: BrTable<'_>) -> Done {
        let (index, _) = self.pop_in_slot()?;
        let count = self.blocks[self.index_of_label(table.default_label())].arity();
        let first_slot = self.settle_top(count)?;
        let labels = || table.labels().chain([table.default_label()]);
        let is_loop = |label| self.blocks[self.index_of_label(label)].label.is_bound();
        let handler = control::for_table(self.is_last(Register::Int, index), labels().any(is_loop));
        self.emit(handler, index, 0, table.labels().len() as u32)?;
        let start = self.position();
        for (number, label) in (0u32..).zip(labels()) {
            let place = if number % 2 == 0 {
                self.extend(0, 0)?;
                Wanted::low(start + number / 2)
            } else {
                Wanted::imm(start + number / 2)
            };
            let index = self.index_of_label(label);
            let block = &mut self.blocks[index];
            let is_direct =
                !matches!(block.kind, Kind::Body) && (count == 0 || block.first_slot == first_slot);
            if !is_direct && block.detour.0 != start {
                block.detour = (start, Label::UNUSED);
            }
            let label = if is_direct {
                &mut block.label
            } else {
                &mut block.detour.1
            };
            let (target, op) = (
                label.target_for(place),
                &mut self.ops[(start + number / 2) as usize],
            );
            match number % 2 {
                0 => op.set_low(target),
                _ => op.imm = target,
            }
        }
        for label in labels() {
            let index = self.index_of_label(label);
            let detour = &mut self.blocks[index].detour;
            if detour.0 == start {
                let (_, label) = core::mem::replace(detour, (0, Label::UNUSED));
                self.bind(label);
                self.leave_for(index)?;
            }
        }
        Ok(())
    }

    fn br_on_null(&mut self, label: u32) -> Done {
        let slot = self.top_in_slot()?;
        let value = self.pop();
        let condition = Condition::with_constant(Width::W64, Cond::Eq, slot, NULL as u64);
        self.leave_if(label, |_| Ok(Test::Condition(condition)))?;
        self.push(value.kind, value.place);
        Ok(())
    }

    fn br_on_non_null(&mut self, label: u32) -> Done {
        self.leave_if(label, |this| {
            let slot = this.top_in_slot()?;
            let condition = Condition::with_constant(Width::W64, Cond::Ne, slot, NULL as u64);
            Ok(Test::Condition(condition))
        })?;
        self.pop();
        Ok(())
    }

    fn br_on_cast(&mut self, label: u32, _: RefType, to: RefType) -> Done {
        self.leave_if_cast(label, to, true)
    }

    fn br_on_cast_fail(&mut self, label: u32, _: RefType, to: RefType) -> Done {
        self.leave_if_cast(label, to, false)
    }

    fn return_(&mut self) -> Done {
        self.br(self.blocks.len() as u32 - 1)
    }

    fn call(&mut self, func: FuncIndex, _: u32) -> Done {
        self.call_function(func)
    }

    fn call_indirect(&mut self, ty: TypeIndex, table: TableIndex, _: u32) -> Done {
        self.call_element(ty, table)
    }

    fn call_ref(&mut self, ty: TypeIndex, _: u32) -> Done {
        self.call_reference(ty)
    }

    fn return_call(&mut self, func: FuncIndex, _: u32) -> Done {
        self.leave_to_function(func)
    }

    fn return_call_indirect(&mut self, ty: TypeIndex, table: TableIndex, _: u32) -> Done {
        self.leave_to_element(ty, table)
    }

    fn return_call_ref(&mut self, ty: TypeIndex, _: u32) -> Done {
        self.leave_to_reference(ty)
    }

    fn throw(&mut self, tag: TagIndex) -> Done {
        self.throw_new(tag)
    }

    fn throw_ref(&mut self) -> Done {
        let exception = self.pop();
        self.throw_again(exception)
    }

    fn try_table(&mut self, ty: BlockType, catches: Catches<'_>) -> Done {
        let first_catch = self.catches.len();
        self.catches.try_reserve(catches.len())?;
        self.catches.extend(catches);
        self.open_try(Kind::TryTable { first_catch }, ty)
    }

    fn try_(&mut self, ty: BlockType) -> Done {
        self.open_try(Kind::Try, ty)
    }

    fn catch(&mut self, tag: TagIndex, flow: Flow) -> Done {
        self.start_catch(Some(tag), flow)
    }

    fn catch_all(&mut self, flow: Flow) -> Done {
        self.start_catch(None, flow)
    }

    fn delegate(&mut self, label: u32, flow: Flow) -> Done {
        let to = self.blocks[self.index_of_label(label + 1)].scope;
        self.end_try(Some(to), flow)
    }

    fn rethrow(&mut self, label: u32) -> Done {
        let Kind::Catch { exception, .. } = self.blocks[self.index_of_label(label)].kind else {
            unreachable!("the body was validated");
        };
        self.throw_again(super::operands::Operand {
            kind: ValKind::Ref,
            slot: exception,
            place: Place::Own,
        })
    }
}
