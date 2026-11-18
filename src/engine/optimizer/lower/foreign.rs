//! Calls of C functions that are not those of the run time.

use bun_engine_asm::{Target, abi};
use bun_engine_codegen::ir::{Action, Input, Type, Unary, Value as Ssa};
use bun_engine_ffi::{NativeType, Place};
use bun_engine_vm::Value;
use smallvec::SmallVec;

use super::emit::{Site, Threw};
use super::{Lowering, Odds};
use crate::graph::Kind;
use crate::runtime::operations::BIGINT_FROM_BITS;

impl Lowering<'_> {
    fn address_in(&self, operand: Ssa) -> usize {
        self.graph.constant(operand).expect("a constant") as usize
    }

    pub(super) fn call_custom(&mut self, results: &[Type]) -> Ssa {
        let operands = self.operands();
        let data = self.operation(self.address_in(operands[0]), Threw::IfPending);
        self.call_native(data, &operands[1..], results)
    }

    pub(super) fn call_custom_getter(&mut self) -> Ssa {
        let (result, undefined) = (
            self.call_custom(&[Type::I64]),
            self.word(Value::UNDEFINED.to_bits()),
        );
        let is_empty = self.ir().is_zero(result);
        self.ir().select(is_empty, undefined, result)
    }

    pub(super) fn call_clock(&mut self, function: Ssa, realm: Ssa) -> Ssa {
        let action = Action::Call(Target::Address(self.address_in(function)));
        let data = self.patchpoint(action, Site::Nothing, Kind::CallClock.effects());
        let frame = self.graph.function.pinned(abi::FRAME_POINTER);
        self.call_native(data, &[realm, frame], &[Type::I64])
    }

    pub(super) fn call_foreign(&mut self, signature: u32) -> Ssa {
        let (operands, signature) = (self.operands(), self.graph.signatures[signature as usize]);
        let layout = signature.layout();
        let outgoing = &mut self.graph.function.outgoing_bytes;
        *outgoing = (*outgoing).max(layout.stack_bytes);
        let places = layout.places.iter().map(|&place| match place {
            Place::Gpr(register) => Input::Fixed(register.into()),
            Place::Fpr(register) => Input::Fixed(register.into()),
            Place::Stack(offset) => Input::Outgoing(offset as i32),
        });
        let mut inputs: SmallVec<[_; 8]> = operands[1..].iter().copied().zip(places).collect();
        if let Some((register, count)) = layout.float_count {
            inputs.push((self.int32(count as i32), Input::Fixed(register.into())));
        }
        let data = &mut self.operation(self.address_in(operands[0]), Threw::IfPending);
        match signature.result() {
            NativeType::Double => self.call_with_inputs(data, &inputs, &[Type::F64]),
            NativeType::Float => {
                let float = self.call_with_inputs(data, &inputs, &[Type::F32]);
                self.ir().convert(Unary::Promote, Type::F64, float)
            }
            _ => self.call_with_inputs(data, &inputs, &[Type::I64]),
        }
    }

    pub(super) fn box_foreign_integer(&mut self, bits: Ssa, from: u32) -> Ssa {
        let from = NativeType::from_number(from as u8).expect("from the builder");
        let exact = from.exact_range();
        let meeting = self.part(Type::I64);
        if !matches!(from, NativeType::Int64Fast | NativeType::Uint64Fast) {
            let is_null = self.ir().is_zero(bits);
            self.give_if(meeting, is_null, Odds::Low, |this| {
                this.word(Value::NULL.to_bits())
            });
        }
        let distance = self.ir().sub(bits, *exact.start());
        let is_inexact = self.ir().above(distance, exact.end() - exact.start());
        self.give_if(meeting, is_inexact, Odds::Low, |this| {
            let is_signed = this.int32((from == NativeType::Int64Fast).into());
            this.call_operation(BIGINT_FROM_BITS, &[bits, is_signed])
        });
        let number = self.box_int52(bits);
        self.give(meeting, number);
        self.meet(meeting)
    }
}
