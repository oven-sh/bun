//! Calls of functions of scripts. The stack pointer is where the header of the new frame goes.

use bun_engine_asm::{Gpr, Target, abi};
use bun_engine_baseline::ic::abi as ic;
use bun_engine_baseline::registers::CODE_BLOCK;
use bun_engine_bytecode::Specialization;
use bun_engine_codegen::ir::{
    Action, EffectFlags, Effects, Heap, Input, Output, PatchpointFlags, State, Type, Value as Ssa,
};
use bun_engine_vm::{CallFrame, SpeculatedType as T};
use smallvec::SmallVec;

use super::emit::{Call, Callee, Native, Site};
use super::operations::UNPINNED;
use super::{Lowering, Odds};
use crate::graph::{Kind, heaps};
use crate::runtime::registers::{CALLEE, EXECUTABLE, in_new_frame};
use crate::runtime::varargs::Form;

impl Lowering<'_> {
    fn arrange(&mut self, kind: Kind) -> (Call, SmallVec<[(Ssa, Input); 12]>) {
        let operands = self.operands();
        let (target, rest) = operands.split_at(match kind {
            Kind::DirectCall
            | Kind::DirectConstruct
            | Kind::DirectTailCall
            | Kind::ResumeGenerator => 1,
            Kind::NativeCall | Kind::NativeConstruct | Kind::NativeTailCall => 2,
            _ => 0,
        });
        let (&callee, arguments) = rest.split_first().expect("a callee");
        let words = (CallFrame::HEADER_WORDS + arguments.len()).next_multiple_of(2);
        let outgoing = &mut self.graph.function.outgoing_bytes;
        *outgoing = (*outgoing).max(in_new_frame(words * 8) as u32);

        let mut inputs = SmallVec::new();
        let how = if let [executable] = *target {
            inputs.push((executable, Input::Fixed(EXECUTABLE.into())));
            Callee::Known
        } else if let [function, realm] = *target {
            let address = |it| self.graph.constant(it).expect("a constant") as usize;
            Callee::Native(Native {
                function: address(function),
                realm: address(realm),
            })
        } else {
            inputs.push((callee, Input::Fixed(CALLEE.into())));
            if T::FUNCTION.contains(self.graph.inherent_type(self.graph.root(callee))) {
                Callee::Function
            } else {
                Callee::Anything
            }
        };
        let place = |offset| Input::Outgoing(in_new_frame(offset));
        inputs.push((callee, place(CallFrame::OFFSET_OF_CALLEE)));
        let offsets = (CallFrame::OFFSET_OF_THIS..).step_by(8);
        inputs.extend(arguments.iter().copied().zip(offsets.map(place)));
        let call = Call {
            origin: self.origin,
            callee: how,
            specialization: match kind {
                Kind::Construct | Kind::DirectConstruct => Specialization::Construct,
                _ => Specialization::Call,
            },
            count: match kind {
                Kind::ResumeGenerator => 0,
                _ => arguments.len() as u32,
            },
        };
        (call, inputs)
    }

    pub(super) fn call(&mut self, kind: Kind) -> Ssa {
        let (call, inputs) = self.arrange(kind);
        let mut data = self.patchpoint(Action::Custom, Site::Call(call), Effects::CALL);
        data.flags = PatchpointFlags::MOVES_STACK_POINTER;
        (data.clobbers_late, data.state) = (UNPINNED, self.state);
        let result = (Type::I64, Output::Fixed(abi::RETURN_GPRS[0].into()));
        self.ir().patchpoint(&data, &inputs, &[result])
    }

    pub(super) fn cached(&mut self, access: u32) -> Ssa {
        let access = self.graph.cached_accesses[access as usize];
        let steps = access.steps(self.entries);
        let places = [ic::BASE, ic::KEY, ic::VALUE].map(|it| Input::Fixed(it.into()));
        let mut inputs: SmallVec<[_; 8]> = self.operands().into_iter().zip(places).collect();
        inputs.push((
            self.word(access.start() as u64),
            Input::Fixed(ic::ENTRY.into()),
        ));
        let in_register = |gpr: Gpr| (Type::I64, Output::Fixed(gpr.into()));

        let mut effects = Effects::with_flags(EffectFlags::CONTROL_DEPENDENT);
        (effects.reads, effects.writes) = (heaps::WORLD, heaps::SIDE_STATE);
        let action = Action::Call(Target::Address(steps.first));
        let mut data = self.patchpoint(action, Site::Nothing, effects);
        data.clobbers_late = ic::OVERWRITTEN_BY_LOOKUP;
        if !access.only_looks() {
            (data.effects.writes, data.clobbers_late) = (Heap::EVERYTHING, abi::CALLER_SAVED);
            data.clobbers_upper_halves = abi::CALLEE_SAVED_LOW_HALF;
        }
        let [case, shape, name] = ic::HANDED_ON;
        let results = [ic::RESULT, case, shape, name].map(in_register);
        let first = self.ir().patchpoint(&data, &inputs, &results);
        let found = self.ir().extract(first, 0);
        let needs_more = self.ir().is_zero(found);
        let second = |this: &mut Self| {
            for (position, gpr) in (1..).zip(ic::HANDED_ON) {
                inputs.push((this.ir().extract(first, position), Input::Fixed(gpr.into())));
            }
            let owner = this.word(this.graph.frame_at(this.origin).code_block as u64);
            inputs.push((owner, Input::Fixed(CODE_BLOCK.into())));
            let site = Site::SecondStep(this.origin, steps.second);
            let mut data = this.patchpoint(Action::Custom, site, Effects::CALL);
            data.flags = PatchpointFlags::MOVES_STACK_POINTER;
            (data.clobbers_late, data.state) = (UNPINNED, this.state);
            (this.ir()).patchpoint(&data, &inputs, &[in_register(ic::RESULT)])
        };
        self.choose(needs_more, Odds::Low, Type::I64, second, |_| found)
    }

    pub(super) fn call_varargs(&mut self, kind: Kind, lists: u32) -> Ssa {
        let mut operands = self.operands();
        operands[2..].reverse();
        let specialization = match kind {
            Kind::ConstructVarargs => Specialization::Construct,
            _ => Specialization::Call,
        };
        let form = Form::new(lists, operands.len() as u32 - 2, specialization);
        let is_tail_call = kind == Kind::TailCallVarargs;
        let site = Site::CallVarargs(self.origin, form, is_tail_call);
        let mut data = self.patchpoint(Action::Custom, site, Effects::CALL);
        data.flags = PatchpointFlags::MOVES_STACK_POINTER;
        (data.clobbers_late, data.state) = (UNPINNED, self.state);
        let places = (0..).step_by(8).map(Input::Outgoing);
        let inputs: SmallVec<[_; 8]> = operands.into_iter().zip(places).collect();
        let result = (Type::I64, Output::Fixed(abi::RETURN_GPRS[0].into()));
        let results = (!is_tail_call).then_some(result);
        self.ir().patchpoint(&data, &inputs, results.as_slice())
    }

    pub(super) fn tail_call(&mut self, kind: Kind) {
        let (call, inputs) = self.arrange(kind);
        let mut data = self.patchpoint(Action::Custom, Site::TailCall(call), Effects::CALL);
        data.clobbers_late = UNPINNED;
        data.state = if call.callee == Callee::Anything {
            self.state
        } else {
            State::NONE
        };
        self.ir().patchpoint(&data, &inputs, &[]);
        self.ir().unreachable();
    }
}
