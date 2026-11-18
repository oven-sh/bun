//! Calls of functions of the run time.

use bun_engine_asm::{RegisterSet, Target, abi};
use bun_engine_codegen::ir::{
    Action, EffectFlags, Effects, Heap, Input, Output, PatchpointData, PatchpointFlags, Type,
    Value as Ssa,
};
use bun_engine_interpreter::OPERATIONS;
use smallvec::SmallVec;

use super::Lowering;
use super::emit::{Site, Threw};
use crate::builder::{Built, Refusal};
use crate::graph::{Kind, heaps};
use crate::runtime::operations::{Address, Operation};

/// What a call of a function of a script leaves nothing in.
pub(super) const UNPINNED: RegisterSet = abi::ALL.difference(abi::PINNED).difference(
    RegisterSet::of(&[abi::STACK_POINTER, abi::FRAME_POINTER], &[]),
);

/// The collector looks at everything, and what is reached through a cell is not to be read from before it has run. What
/// is in a storage keeps its value when that is replaced or rearranged, but not its place.
pub(super) fn while_collecting(writes: Heap) -> Effects {
    let writes = match writes {
        Heap::NOTHING
        | heaps::STRING_FIBER
        | heaps::LAST_MATCH
        | heaps::SEARCH
        | heaps::VIEW_VECTOR
        | heaps::WEAK_TABLES => heaps::BACKING,
        heaps::COLLECTIONS => heaps::COLLECTIONS_AND_VECTORS,
        heaps::OBJECTS | heaps::LAYOUT | heaps::ROOM | heaps::VECTORS => heaps::OBJECTS,
        heaps::WORLD | heaps::ELEMENTS_AND_SHAPES => heaps::WORLD,
        _ => Heap::EVERYTHING,
    };
    Effects {
        reads: Heap::EVERYTHING,
        writes,
        flags: EffectFlags::CONTROL_DEPENDENT,
    }
}

impl Lowering<'_> {
    pub(super) fn call_native(
        &mut self,
        mut data: PatchpointData,
        args: &[Ssa],
        results: &[Type],
    ) -> Ssa {
        let (mut gprs, mut fprs) = (abi::ARGUMENT_GPRS.iter(), abi::ARGUMENT_FPRS.iter());
        let place = |&arg: &Ssa| {
            let register = if self.graph.function.type_of(arg).is_float() {
                (*fprs.next().unwrap()).into()
            } else {
                (*gprs.next().unwrap()).into()
            };
            (arg, Input::Fixed(register))
        };
        let inputs: SmallVec<[_; 6]> = args.iter().map(place).collect();
        self.call_with_inputs(&mut data, &inputs, results)
    }

    pub(super) fn call_with_inputs(
        &mut self,
        data: &mut PatchpointData,
        inputs: &[(Ssa, Input)],
        results: &[Type],
    ) -> Ssa {
        data.flags = PatchpointFlags::UNEXTENDED_RESULTS;
        data.clobbers_late = abi::CALLER_SAVED;
        data.clobbers_upper_halves = abi::CALLEE_SAVED_LOW_HALF;
        // An unwinder restores no registers.
        let function = &self.graph.function;
        let mut held = function.state(data.state).iter();
        if held.any(|&value| !function.op(value).is_constant()) {
            data.clobbers_late = UNPINNED;
        }
        let place = |(&ty, &gpr): (&Type, &bun_engine_asm::Gpr)| {
            let register = if ty.is_float() {
                abi::RETURN_FPR.into()
            } else {
                gpr.into()
            };
            (ty, Output::Fixed(register))
        };
        let results: SmallVec<[_; 2]> = results.iter().zip(&abi::RETURN_GPRS).map(place).collect();
        self.ir().patchpoint(data, inputs, &results)
    }

    /// A function of its arguments and of what never changes.
    pub(super) fn call_leaf(&mut self, function: Address, args: &[Ssa], result: Type) -> Ssa {
        let action = Action::Call(Target::Address(function.get()));
        let effects = Effects::with_flags(EffectFlags::CONTROL_DEPENDENT);
        let data = self.patchpoint(action, Site::Nothing, effects);
        self.call_native(data, args, &[result])
    }

    /// The same, of strings that are no ropes by now. Gives an I32.
    pub(super) fn call_on_text(&mut self, function: Address, args: &[Ssa]) -> Ssa {
        let action = Action::Call(Target::Address(function.get()));
        let mut effects = Effects::with_flags(EffectFlags::CONTROL_DEPENDENT);
        effects.reads = heaps::STRING_FIBER;
        let data = self.patchpoint(action, Site::Nothing, effects);
        self.call_native(data, args, &[Type::I32])
    }

    /// Reads and writes what the node does, and neither collects nor throws.
    pub(super) fn call_quietly(&mut self, function: Address, args: &[Ssa], result: Type) -> Ssa {
        self.call_quietly_for(function, args, &[result])
    }

    pub(super) fn call_quietly_for(
        &mut self,
        function: Address,
        args: &[Ssa],
        results: &[Type],
    ) -> Ssa {
        let mut effects = self.graph.function.effects(self.at);
        effects.flags = EffectFlags::CONTROL_DEPENDENT;
        self.call_with_effects(function, args, results, effects)
    }

    pub(super) fn call_with_effects(
        &mut self,
        function: Address,
        args: &[Ssa],
        results: &[Type],
        effects: Effects,
    ) -> Ssa {
        let action = Action::Call(Target::Address(function.get()));
        let data = self.patchpoint(action, Site::Nothing, effects);
        self.call_native(data, args, results)
    }

    pub(super) fn operation(&mut self, function: usize, threw: Threw) -> PatchpointData {
        let kind = self.graph.kind(self.at).expect("a node");
        debug_assert!(kind.can_collect() && (kind.can_throw() || threw == Threw::Never));
        let mut effects = while_collecting(kind.effects().writes);
        effects.flags.set(EffectFlags::EXITS, threw != Threw::Never);
        let action = Action::Call(Target::Address(function));
        let mut data = self.patchpoint(action, Site::Operation(self.origin, threw), effects);
        if threw != Threw::Never {
            data.state = self.state;
        }
        data
    }

    pub(super) fn global(&mut self) -> Ssa {
        self.word(self.graph.frame_at(self.origin).global as u64)
    }

    /// Does what the node may do. The first argument is the global object of the realm of the code.
    pub(super) fn call_operation(&mut self, operation: Operation, args: &[Ssa]) -> Ssa {
        let global = self.global();
        self.call_operation_in(global, operation, args, &[operation.result])
    }

    /// One that returns a second word.
    pub(super) fn call_operation_for_pair(&mut self, operation: Operation, args: &[Ssa]) -> Ssa {
        let global = self.global();
        self.call_operation_in(global, operation, args, &[operation.result, Type::I64])
    }

    pub(super) fn call_operation_in(
        &mut self,
        realm: Ssa,
        operation: Operation,
        args: &[Ssa],
        results: &[Type],
    ) -> Ssa {
        let data = self.operation(operation.address.get(), operation.threw);
        let mut all: SmallVec<[Ssa; 6]> = smallvec::smallvec![realm];
        all.extend_from_slice(args);
        self.call_native(data, &all, results)
    }

    pub(super) fn interpret(&mut self, opcode: u32, registers: Ssa, start: Ssa) -> Built<Ssa> {
        let function = OPERATIONS[opcode as usize].ok_or(Refusal::Unsupported)?;
        let data = self.operation(function as usize, Threw::IfZero);
        debug_assert!(self.graph.kind(self.at) == Some(Kind::Interpret));
        let vm = self.vm();
        Ok(self.call_native(data, &[vm, registers, start], &[Type::I64; 2]))
    }
}
