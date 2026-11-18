//! Calls of functions, and of the run time.

use bun_engine_asm::{Gpr, RegisterSet, Target as CallTarget, abi as registers};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, Block, EffectFlags, Effects, Heap, Input, Origin, Output,
    PatchpointData, PatchpointFlags, Type, Value,
};
use bun_engine_wasm_format::{CodeIndex, FuncIndex, FunctionFlags, TableIndex, TypeIndex};
use smallvec::SmallVec;

use super::control::{Target, Way};
use super::emit::{Callee, Site, Sites};
use super::inlining::Node;
use super::references::Fact;
use super::translator::{Activation, NONE, Operand, Translator, Visited, ir_type};
use crate::abi::{
    Callable, FunctionElement, FunctionSlot, Operation, Place, Signature, Trap, frame,
};
use crate::cast::RttCheck;
use crate::output::InlineFrame;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CallKind {
    Plain,
    Tail,
}

const HEADER_SIZE: u32 = (frame::ARGUMENTS + frame::CALLEE_FRAME_FROM_STACK_POINTER) as u32;
const ALL_BUT_STACK: RegisterSet = registers::ALL.difference(RegisterSet::of(
    &[registers::STACK_POINTER, registers::FRAME_POINTER],
    &[],
));

type Inputs = SmallVec<[(Value, Input); 8]>;

/// Where a [`Callable`] is.
#[derive(Clone, Copy)]
struct CallableAt {
    base: Value,
    offset: i32,
}

#[derive(Clone, Copy)]
enum Destination {
    Code(CodeIndex),
    Import(FuncIndex),
    Callable(CallableAt),
}

fn outgoing(offset: i32) -> i32 {
    offset + frame::CALLEE_FRAME_FROM_STACK_POINTER
}

fn in_registers(args: &[Value], registers: &[Gpr]) -> Inputs {
    let places = args.iter().zip(registers);
    (places.map(|(&arg, &reg)| (arg, Input::Fixed(reg.into())))).collect()
}

impl Translator<'_> {
    fn effects_of_call(writes: Heap) -> Effects {
        Effects {
            reads: Heap::EVERYTHING,
            writes,
            flags: EffectFlags::EXITS | EffectFlags::CONTROL_DEPENDENT,
        }
    }

    /// Goes on where the call returns.
    fn emit_call(
        &mut self,
        data: &PatchpointData,
        operands: &[(Value, Input)],
        results: &[(Type, Output)],
        handler: u32,
    ) -> Value {
        self.fresh_object = Value::NONE;
        if handler == NONE {
            return self.b.patchpoint(data, operands, results);
        }
        let (block, next) = (self.b.block(), self.b.new_block());
        let successors = [next.into(), Block::NONE.rare()];
        let call = (self.b).terminal_patchpoint(data, operands, results, &successors);
        let (edge, landing) = (
            self.b.successor(block, 1),
            self.controls[handler as usize].landing,
        );
        self.controls[handler as usize].landing = self.arrive(landing, Way::Edge(edge), 0);
        self.b.switch_to(next);
        call
    }

    fn emit_native_call(
        &mut self,
        address: usize,
        operands: &[(Value, Input)],
        result: Type,
        effects: Effects,
        handler: u32,
    ) -> Value {
        let action = Action::Call(CallTarget::Address(address));
        let token = match handler {
            NONE => Sites::NOTHING,
            _ => self.sites.add(Site::Throw(self.scope_of(handler))),
        };
        let mut data = PatchpointData::new(action, token, effects);
        data.flags = PatchpointFlags::UNEXTENDED_RESULTS;
        data.clobbers_late = match handler {
            NONE => registers::CALLER_SAVED,
            _ => ALL_BUT_STACK - self.b.pinned,
        };
        data.clobbers_upper_halves = registers::CALLEE_SAVED_LOW_HALF;
        let results = [(result, Output::Fixed(registers::RETURN_GPRS[0].into()))];
        let results = &results[..usize::from(result != Type::Void)];
        self.emit_call(&data, operands, results, handler)
    }

    fn emit_operation(
        &mut self,
        operation: Operation,
        args: &[Value],
        result: Type,
        effects: Effects,
        handler: u32,
    ) -> Value {
        let address = self.env.stubs.operations[operation as usize];
        let operands = in_registers(args, &registers::ARGUMENT_GPRS[1..]);
        self.b.outgoing_bytes = self.b.outgoing_bytes.max(HEADER_SIZE);
        self.emit_native_call(address, &operands, result, effects, handler)
    }

    /// For a function that fills or moves bytes.
    pub(super) fn call_for_bytes(&mut self, address: usize, args: [Value; 3], writes: Heap) {
        let effects = Effects {
            flags: EffectFlags::CONTROL_DEPENDENT,
            ..Self::effects_of_call(writes)
        };
        let operands = in_registers(&args, &registers::ARGUMENT_GPRS);
        self.emit_native_call(address, &operands, Type::Void, effects, NONE);
    }

    /// For one that throws nothing that can be caught.
    pub(super) fn call_operation(
        &mut self,
        operation: Operation,
        args: &[Value],
        result: Type,
        writes: Heap,
    ) -> Value {
        let effects = Self::effects_of_call(writes);
        self.emit_operation(operation, args, result, effects, NONE)
    }

    /// With immediates of the instruction before its operands, which are popped.
    pub(super) fn call_for_instruction<const OPERANDS: usize>(
        &mut self,
        operation: Operation,
        immediates: &[u32],
        result: Type,
        writes: Heap,
    ) -> Value {
        let mut args: SmallVec<[Value; 5]> = (immediates.iter())
            .map(|&immediate| self.b.const32(immediate as i32))
            .collect();
        args.extend(self.pop_values::<OPERANDS>());
        self.call_operation(operation, &args, result, writes)
    }

    /// For one that does not return.
    pub(super) fn call_throwing(&mut self, operation: Operation, args: &[Value], handler: u32) {
        let effects = Self::effects_of_call(self.named.mutable);
        self.emit_operation(operation, args, Type::Void, effects, handler);
        self.end_unreachable();
    }

    fn note_call(&mut self, site: u32) {
        self.sites_seen = site + 1;
        if let Some(count) = self.inlining.count(self.activation.node, site) {
            self.note_count(count);
        }
    }

    pub(super) fn call_function(&mut self, func: FuncIndex, site: u32, kind: CallKind) -> Visited {
        self.note_call(site);
        let ty = self.module.func_type_index(func);
        let args = self.pop_many(self.types.func_type(ty).params.len());
        self.call_known(func, site, kind, &args)
    }

    fn call_known(
        &mut self,
        func: FuncIndex,
        site: u32,
        kind: CallKind,
        args: &[Operand],
    ) -> Visited {
        let ty = self.module.func_type_index(func);
        let Some(code) = self.module.code_index(func) else {
            self.call_machine_code(Destination::Import(func), ty, kind, args);
            return Ok(());
        };
        let mut callees = self.inlining.callees(self.activation.node, site);
        let node = callees.find(|&node| self.inlining[node].code == code);
        match node {
            Some(node) => self.call_node(node, kind, args),
            None => {
                self.call_machine_code(Destination::Code(code), ty, kind, args);
                Ok(())
            }
        }
    }

    fn call_node(&mut self, node: Node, kind: CallKind, args: &[Operand]) -> Visited {
        let code = self.inlining[node].code;
        let repeated = (self.inlining.replaced_by(node))
            .map(|known| self.inlining[known])
            .find(|known| known.code == code && known.repeats);
        if let Some(repeated) = repeated {
            self.start_over(repeated.body as usize, repeated.first_local, args);
        } else if self.inlining[node].is_inlined {
            self.inline(node, kind, args)?;
        } else {
            let ty = self.module.func_type_index(self.module.func_index(code));
            self.call_machine_code(Destination::Code(code), ty, kind, args);
        }
        Ok(())
    }

    fn inline(&mut self, node: Node, kind: CallKind, args: &[Operand]) -> Visited {
        let (caller, origin) = (self.activation, self.b.origin);
        let body = self.module.body(self.inlining[node].code);
        let is_tail = kind == CallKind::Tail;
        let caller_origin = if is_tail {
            caller.caller_origin
        } else {
            origin
        };
        let owns_frame = is_tail && caller.owns_frame;
        let frame = *self.inlining[node].frame.get_or_insert_with(|| {
            self.sites.add_inline_frame(InlineFrame {
                func: body.func_index(),
                caller: if owns_frame {
                    InlineFrame::NO_CALLER
                } else {
                    Sites::inline_frame(caller_origin)
                },
            })
        });
        self.activation = Activation {
            node,
            depth: caller.depth + 1,
            first_local: self.locals.len(),
            outer_handler: if is_tail {
                caller.outer_handler
            } else {
                self.handler()
            },
            caller_origin,
            owns_frame,
            hints: self.module.branch_hints().of(body.func_index()),
            innermost_loop: (Block::NONE, 0),
        };
        self.b.origin = Origin(frame + 1);
        (self.unused_comparison, self.last_test) = (Value::NONE, None);
        self.translated_bytes += body.bytes().len() as u32;
        self.enter_body(&body, args);
        body.driver().run(self)?;
        (self.activation, self.b.origin, self.last_test) = (caller, origin, None);
        if is_tail && self.is_live {
            self.return_from_body();
        }
        Ok(())
    }

    fn call_machine_code(
        &mut self,
        destination: Destination,
        ty: TypeIndex,
        kind: CallKind,
        args: &[Operand],
    ) {
        let signature = Signature::new(self.types.func_type(ty));
        let places = args.iter().zip(&signature.params);
        let mut operands: Inputs = places
            .map(|(arg, &place)| match place {
                Place::Register(reg) => (arg.value, Input::Fixed(reg)),
                Place::Stack(offset) => (arg.value, Input::Outgoing(outgoing(offset))),
            })
            .collect();
        let callee = match destination {
            Destination::Code(code) => Callee::Code(code),
            Destination::Import(func) => Callee::Import(func),
            Destination::Callable(CallableAt { base, offset }) => {
                operands.push((base, Input::Register));
                Callee::Callable { offset }
            }
        };
        let room = HEADER_SIZE + signature.stack_bytes;
        let effects = Self::effects_of_call(self.named.mutable);

        if kind == CallKind::Tail && self.activation.owns_frame {
            if signature.stack_bytes != 0 {
                self.b.outgoing_bytes = self.b.outgoing_bytes.max(room);
            }
            let token = self.sites.add(Site::TailCall(callee, ty));
            let data = PatchpointData::new(Action::Custom, token, effects);
            self.b.terminal_patchpoint(&data, &operands, &[], &[]);
            self.is_live = false;
            return;
        }

        self.b.outgoing_bytes = self.b.outgoing_bytes.max(room);
        let may_leave_instance = match destination {
            Destination::Code(code) => {
                (self.module.facts(code).flags).contains(FunctionFlags::HAS_TAIL_CALL)
            }
            Destination::Import(_) | Destination::Callable(_) => true,
        };
        let origin = self.b.origin;
        let handler = match kind {
            CallKind::Plain => self.handler(),
            CallKind::Tail => {
                self.b.origin = self.activation.caller_origin;
                self.activation.outer_handler
            }
        };
        let token = self.sites.add(Site::Call {
            callee,
            may_leave_instance,
            scope: self.scope_of(handler),
        });
        let mut data = PatchpointData::new(Action::CustomCall, token, effects);
        data.clobbers_late = ALL_BUT_STACK - self.b.pinned;
        if may_leave_instance {
            data.flags = PatchpointFlags::MOVES_STACK_POINTER;
        }
        self.emit_call_with_results(&data, &operands, ty, &signature, handler);
        self.b.origin = origin;
        if kind == CallKind::Tail {
            self.return_from_body();
        }
    }

    fn emit_call_with_results(
        &mut self,
        data: &PatchpointData,
        operands: &[(Value, Input)],
        ty: TypeIndex,
        signature: &Signature,
        handler: u32,
    ) {
        let types = self.types.func_type(ty).results;
        let outputs = types.iter().zip(&signature.results);
        let outputs = outputs.map(|(&ty, &place)| match place {
            Place::Register(reg) => (ir_type(ty), Output::Fixed(reg)),
            Place::Stack(offset) => (ir_type(ty), Output::Outgoing(outgoing(offset))),
        });
        // A call that ends a block has no results in memory.
        let is_fetched = |output| handler != NONE && matches!(output, Output::Outgoing(_));
        let (fetched, returned): (SmallVec<[_; 2]>, SmallVec<[_; 2]>) =
            outputs.clone().partition(|&(_, output)| is_fetched(output));
        let call = self.emit_call(data, operands, &returned, handler);
        let fetch = if fetched.is_empty() {
            Value::NONE
        } else {
            let mut effects = Effects::with_flags(EffectFlags::CONTROL_DEPENDENT);
            effects.reads = Heap::EVERYTHING;
            let data = PatchpointData::new(Action::Custom, Sites::NOTHING, effects);
            self.b.patchpoint(&data, &[], &fetched)
        };
        let mut sources = [(call, returned.len(), 0), (fetch, fetched.len(), 0)];
        for (&ty, (_, output)) in types.iter().zip(outputs) {
            let (source, count, position) = &mut sources[usize::from(is_fetched(output))];
            let value = if *count == 1 {
                *source
            } else {
                self.b.extract(*source, *position)
            };
            *position += 1;
            self.push(value, ty);
        }
    }

    pub(super) fn call_element(
        &mut self,
        ty: TypeIndex,
        table: TableIndex,
        site: u32,
        kind: CallKind,
    ) -> Visited {
        self.note_call(site);
        let index = self.pop_value();
        let args = self.pop_many(self.types.func_type(ty).params.len());
        let size_log2 = FunctionElement::SIZE_LOG2;
        let base = self.element_address(table, index, size_log2, Trap::IndirectCallOutOfBounds);
        if !self.is_live {
            return Ok(());
        }
        let callable = CallableAt { base, offset: 0 };
        let heap = self.heaps.table(self.b.function, self.module, table);
        self.call_by_guess(callable, heap.into(), ty, site, kind, &args, |this| {
            let declared = this.module.table(table).element;
            let expected = this.types.heap_type(ty);
            let rtt = this.b.load(Type::I64, base, Callable::RTT, heap);
            if !this.types.is_heap_subtype(declared.heap_type(), expected) {
                this.check_signature(rtt, ty);
            } else if declared.is_nullable() {
                let is_null = this.b.is_zero(rtt);
                this.trap_if(is_null, Trap::SignatureMismatch);
            }
        })
    }

    fn check_signature(&mut self, rtt: Value, ty: TypeIndex) {
        let trap_if = |this: &mut Self, fails| this.trap_if(fails, Trap::SignatureMismatch);
        let check = RttCheck::new(self.types, ty);
        if let RttCheck::Is { expected } = check {
            let differs = self.b.not_equal(rtt, expected);
            return trap_if(self, differs);
        }
        let (other, done) = (self.b.new_block(), self.b.new_block());
        let is_same = self.b.equal(rtt, self.types.rtt(ty).address());
        self.b.branch(is_same, done, other.rare());
        self.b.switch_to(other);
        let is_null = self.b.is_zero(rtt);
        trap_if(self, is_null);
        let holds = self.check_rtt(rtt, self.instance, check, trap_if);
        let fails = self.b.is_zero(holds);
        trap_if(self, fails);
        self.b.jump(done, &[]);
        self.b.switch_to(done);
    }

    pub(super) fn call_reference(&mut self, ty: TypeIndex, site: u32, kind: CallKind) -> Visited {
        self.note_call(site);
        let function = self.pop();
        let args = self.pop_many(self.types.func_type(ty).params.len());
        let expected = self.types.heap_type(ty).non_null().into();
        if let Some(Fact::Function(func)) = self.facts.of(function.value)
            && (self.types).is_subtype(self.type_of_reference_to(func), expected)
        {
            return self.call_known(func, site, kind, &args);
        }
        self.check_not_null(function, Trap::NullFunction);
        if !self.is_live {
            return Ok(());
        }
        let (base, offset) = (function.value, self.env.host.function_callable);
        let callable = CallableAt { base, offset };
        let access = Access::new(Heap::NOTHING, AccessFlags::IMMUTABLE);
        self.call_by_guess(callable, access, ty, site, kind, &args, |_| {})
    }

    /// Tests for the functions that were reached so far. `check` precedes a call of any other.
    fn call_by_guess(
        &mut self,
        callable: CallableAt,
        access: Access,
        ty: TypeIndex,
        site: u32,
        kind: CallKind,
        args: &[Operand],
        check: impl FnOnce(&mut Self),
    ) -> Visited {
        let guesses = self.inlining.callees(self.activation.node, site);
        let guess_count = guesses.len();
        if guess_count == 0 {
            check(self);
            self.call_machine_code(Destination::Callable(callable), ty, kind, args);
            return Ok(());
        }

        let rarely_misses = self.inlining.rarely_misses(self.activation.node, site);
        let CallableAt { base, offset } = callable;
        let results = self.types.func_type(ty).results;
        let (height, mut done) = (self.stack.len(), Target::UNREACHED);
        let instance = (self.b).load(Type::I64, base, offset + Callable::INSTANCE, access);
        let slot = self
            .b
            .load(Type::I64, base, offset + Callable::SLOT, access);
        let is_own = self.b.equal(instance, self.instance);
        let edge = self.fork(is_own, Some(true));
        let mut unknown = self.arrive(Target::UNREACHED, Way::Edge(edge), 0);
        for (position, node) in (1..).zip(guesses) {
            let expected = self.env.slots + self.inlining[node].code.usize() * FunctionSlot::SIZE;
            let is_right = self.b.equal(slot, expected);
            let is_last = position == guess_count;
            let edge = self.fork(is_right, (is_last && rarely_misses).then_some(true));
            let wrong = if is_last { unknown } else { Target::UNREACHED };
            let wrong = self.arrive(wrong, Way::Edge(edge), 0);
            self.call_node(node, kind, args)?;
            if self.is_live {
                done = self.arrive(done, self.here(), results.len());
            }
            self.stack.truncate(height);
            if is_last {
                unknown = wrong;
            } else {
                self.meet(wrong, &[]);
            }
        }
        self.meet(unknown, &[]);
        check(self);
        self.call_machine_code(Destination::Callable(callable), ty, kind, args);
        if self.is_live {
            done = self.arrive(done, self.here(), results.len());
        }
        self.stack.truncate(height);
        self.meet(done, results);
        Ok(())
    }
}
