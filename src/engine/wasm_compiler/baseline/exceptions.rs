//! Throwing and catching.

use bun_engine_asm::Code;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{BlockType, Catch, Flow, HeapType, TagIndex, ValType};

use super::calls::Parameter;
use super::control::BlockKind;
use super::edges::Carried;
use super::frame::CALLEE_WORDS_SIZE;
use super::operand::{Operand, bank};
use super::{Compiled, Function};
use crate::abi::{INSTANCE, InstanceLayout, Operation, RESULT_GPRS, Trap, payload_offsets};
use crate::clauses::{Scope, Scopes};
use crate::output::{CallSite, Clause};

#[derive(Default)]
pub(super) struct Handlers {
    scopes: Scopes,
    /// By scope. `None` while nothing can be thrown in it.
    landings: Vec<Option<Landing>>,
    call_sites: Vec<(Label, Scope)>,
}

#[derive(Clone, Copy)]
struct Landing {
    from_call: Label,
    /// With the exception and its tag in their registers.
    from_inner_scope: Label,
}

impl Handlers {
    pub(super) fn clear(&mut self) {
        self.scopes.clear();
        self.landings.clear();
        self.call_sites.clear();
    }

    pub(super) fn finish(&mut self, code: &Code) -> (Vec<CallSite>, Vec<Clause>) {
        let clauses = self.scopes.finish();
        let site = |&(end, scope): &(Label, Scope)| CallSite {
            return_offset: code.offset_of(end),
            first_clause: self.scopes.first_clause(scope),
            handler_offset: code.offset_of(self.landings[scope.index()].expect("used").from_call),
            inline_frame: u32::MAX,
        };
        let sites = self.call_sites.iter().map(site);
        let sites = sites.filter(|site| site.first_clause != u32::MAX);
        (sites.collect(), clauses)
    }
}

const EXCEPTION: Gpr = RESULT_GPRS[0];
const TAG: Gpr = RESULT_GPRS[1];
const EXNREF: ValType = HeapType::EXN.non_null().value_type();

impl Function<'_> {
    fn landing(&mut self, scope: Scope) -> Landing {
        *self.handlers.landings[scope.index()].get_or_insert_with(|| Landing {
            from_call: self.masm.new_label(),
            from_inner_scope: self.masm.new_label(),
        })
    }

    /// After a call that may throw.
    #[inline]
    pub(super) fn note_call_site(&mut self, scope: Scope) {
        if scope != Scope::NONE {
            self.landing(scope);
            let end = self.masm.mark();
            self.handlers.call_sites.push((end, scope));
        }
    }

    pub(super) fn open_try(&mut self, kind: BlockKind, ty: BlockType) {
        self.settle(self.height() - self.param_count(ty));
        let outer = self.innermost().handler;
        let scope = self.handlers.scopes.open(outer);
        self.handlers.landings.push(None);
        self.open(kind, ty, scope);
    }

    fn outer_handler(&self) -> Scope {
        self.blocks[self.blocks.len() - 2].handler
    }

    /// For what is thrown in `scope`. Nothing gets into the function that it does not catch.
    fn landing_or_nowhere(&mut self, scope: Scope) -> Landing {
        if scope != Scope::NONE {
            return self.landing(scope);
        }
        let nowhere = self.trap_label(Trap::Unreachable);
        Landing {
            from_call: nowhere,
            from_inner_scope: nowhere,
        }
    }

    pub(super) fn end_try_delegating(&mut self, to: Scope, flow: Flow) -> Compiled {
        let from = self.innermost().handler;
        self.handlers.scopes.delegate(from, to);
        if let Some(landing) = self.handlers.landings[from.index()] {
            let target = self.landing_or_nowhere(to);
            self.masm.alias(landing.from_call, target.from_call);
            (self.masm).alias(landing.from_inner_scope, target.from_inner_scope);
        }
        self.close(flow)
    }

    pub(super) fn end_try_without_catch(&mut self, flow: Flow) -> Compiled {
        self.end_try_delegating(self.outer_handler(), flow)
    }

    /// Leaves the exception and its tag in their registers.
    fn enter_handler(&mut self, landing: Landing, base: u32) {
        self.masm.bind(landing.from_call);
        self.forget_registers(base);
        self.load_checked_memory();
        let caught = Address::new(INSTANCE, InstanceLayout::caught(self.env.host));
        self.masm.load64(EXCEPTION, caught);
        let tag = Address::new(EXCEPTION, self.env.host.exception_tag);
        self.masm.load64(TAG, tag);
        self.masm.bind(landing.from_inner_scope);
    }

    fn branch_unless_tag_is(&mut self, tag: TagIndex) -> Label {
        let unmatched = self.masm.new_label();
        let expected = Address::new(INSTANCE, self.env.layout.tag(tag));
        self.masm.branch64(Cond::Ne, TAG, expected, unmatched);
        unmatched
    }

    fn payload(&self, offset: u32) -> Address {
        Address::new(EXCEPTION, self.env.host.exception_payload + offset as i32)
    }

    pub(super) fn start_catch(&mut self, tag: Option<TagIndex>, flow: Flow) -> Compiled {
        self.leave_arm(flow)?;
        let block = *self.innermost();
        let (is_reached, exception, scope) = match block.kind {
            BlockKind::Catch {
                unmatched,
                exception,
                scope,
            } => {
                if let Some(label) = unmatched {
                    self.masm.bind(label);
                    self.forget_registers(block.base);
                }
                (unmatched.is_some(), exception, scope)
            }
            _ => {
                let exception = self.frame.exception(self.catch_depth);
                self.catch_depth += 1;
                self.innermost().handler = self.outer_handler();
                let landing = self.handlers.landings[block.handler.index()];
                if let Some(landing) = landing {
                    self.enter_handler(landing, block.base);
                    (self.masm).store64(self.frame_address(exception), EXCEPTION);
                }
                (landing.is_some(), exception, block.handler)
            }
        };
        self.handlers.scopes.add(scope, tag);
        let tag = tag.filter(|_| is_reached);
        let unmatched = tag.map(|tag| self.branch_unless_tag_is(tag));
        self.innermost().kind = BlockKind::Catch {
            unmatched,
            exception,
            scope,
        };
        self.is_dead = !is_reached;

        let types = tag.map_or(&[][..], |tag| self.module.tag_params(tag));
        for (&ty, offset) in types.iter().zip(payload_offsets(types)) {
            self.registers.locked = RegisterSet::of(&[EXCEPTION], &[]);
            let reg = self.take(bank(ty.kind()));
            self.load(ty.kind(), reg, self.payload(offset));
            self.push_register(ty, reg);
        }
        self.check_size()
    }

    pub(super) fn end_catch(&mut self, flow: Flow) -> Compiled {
        let block = *self.innermost();
        self.catch_depth -= 1;
        if let BlockKind::Catch {
            unmatched: Some(entry),
            ..
        } = block.kind
        {
            let outer = self.landing_or_nowhere(block.handler);
            self.masm.alias(entry, outer.from_inner_scope);
        }
        self.close(flow)
    }

    pub(super) fn end_try_table(&mut self, first_catch: u32, flow: Flow) -> Compiled {
        let block = *self.innermost();
        let mut flow = flow;
        if let Some(landing) = self.handlers.landings[block.handler.index()] {
            self.leave_arm(flow)?;
            flow = Flow::Dead;
            self.enter_handler(landing, block.base);
            let mut catches_all = false;
            for index in first_catch as usize..self.catches.len() {
                let catch = self.catches[index];
                self.handlers.scopes.add(block.handler, catch.tag);
                let unmatched = catch.tag.map(|tag| self.branch_unless_tag_is(tag));
                self.branch_with_payload(catch)?;
                match unmatched {
                    Some(label) => self.masm.bind(label),
                    None => {
                        catches_all = true;
                        break;
                    }
                }
            }
            if !catches_all {
                let outer = self.landing_or_nowhere(self.outer_handler());
                self.masm.jump(outer.from_inner_scope);
            }
        }
        self.catches.truncate(first_catch as usize);
        self.close(flow)
    }

    fn branch_with_payload(&mut self, catch: Catch) -> Compiled {
        let index = self.block_index(catch.label + 1);
        if index == 0 && self.blocks[0].target.is_none() {
            self.blocks[0].target = Some(self.target_for_return());
        }
        let block = &self.blocks[index];
        let base = block.base;
        let goes_in_register = block.arity == 1 && !block.is_loop();
        let types = catch.tag.map_or(&[][..], |tag| self.module.tag_params(tag));
        let mut carried = Carried::Nothing;
        for ((&ty, offset), position) in types.iter().zip(payload_offsets(types)).zip(base..) {
            if goes_in_register {
                self.registers.locked = RegisterSet::of(&[EXCEPTION, TAG], &[]);
                let reg = self.take(bank(ty.kind()));
                self.load(ty.kind(), reg, self.payload(offset));
                carried = Carried::One(Operand::in_register(ty, reg));
            } else {
                let slot = self.frame_address(self.frame.operand(position));
                self.transfer(ty.kind(), slot, self.payload(offset));
            }
        }
        if catch.passes_exnref {
            if goes_in_register {
                carried = Carried::One(Operand::in_register(EXNREF, EXCEPTION));
            } else {
                let slot = self.frame_address(self.frame.operand(base + types.len() as u32));
                self.masm.store64(slot, EXCEPTION);
            }
        }
        let start = self.steps.len();
        let target = self.late_route(index, carried);
        self.emit_steps_from(start);
        self.masm.jump(target);
        self.check_size()
    }

    /// What a handler in this function reads has to be in the frame.
    fn save_for_handler(&mut self) -> Scope {
        let handler = self.innermost().handler;
        if handler != Scope::NONE {
            self.write_back_all(self.registers.dirty);
        }
        handler
    }

    pub(super) fn throw_new(&mut self, tag: TagIndex) -> Compiled {
        let handler = self.save_for_handler();
        let types = self.module.tag_params(tag);
        let size = payload_offsets(types).last().expect("the size");
        let size = size.next_multiple_of(16);
        self.lower_stack(size);
        let payload = Address::new(abi::STACK_POINTER, CALLEE_WORDS_SIZE as i32);
        let first = self.stack.len() - types.len();
        for (index, offset) in (first..self.stack.len()).zip(payload_offsets(types)) {
            self.store_operand(payload.plus(offset as i32), self.stack[index]);
        }
        let arguments = [
            Parameter::Immediate(tag.0.into()),
            Parameter::Address(payload),
        ];
        self.call_operation(Operation::Throw, &arguments);
        self.note_call_site(handler);
        self.stack_depth -= size;
        self.check_size()
    }

    pub(super) fn throw_again(&mut self, exception: Operand) {
        let handler = self.save_for_handler();
        self.call_operation(Operation::ThrowRef, &[Parameter::Value(exception)]);
        self.note_call_site(handler);
    }
}
