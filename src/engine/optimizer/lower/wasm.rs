//! Calls of functions that WebAssembly exports.

use bun_engine_asm::prelude::*;
use bun_engine_codegen::ir::{
    Action, Effects, Input, Output, PatchpointFlags, Type, Unary, Value as Ssa,
};
use bun_engine_vm::call::{WasmKind, WasmPlace};
use smallvec::SmallVec;

use super::Lowering;
use super::emit::Site;
use super::operations::UNPINNED;
use crate::graph::WasmCall;
use crate::runtime::registers::VM;

impl Lowering<'_> {
    pub(super) fn call_wasm(&mut self, call: u32) -> Ssa {
        let operands = self.operands();
        let callee = &self.graph.wasm_calls[call as usize].callee;
        let input = |(value, &(kind, place)): (Ssa, &(WasmKind, WasmPlace))| match (place, kind) {
            (WasmPlace::Stack(offset), _) => (value, Input::Outgoing(offset as i32)),
            (WasmPlace::Register(number), WasmKind::F32 | WasmKind::F64) => {
                (value, Input::Fixed(Fpr::new(number).into()))
            }
            (WasmPlace::Register(number), _) => (value, Input::Fixed(Gpr::new(number).into())),
        };
        let pairs = operands.into_iter().zip(&callee.parameters);
        let inputs: SmallVec<[_; 8]> = pairs.map(input).collect();
        let result = callee.result.map(|kind| match kind {
            WasmKind::I32 => (Type::I32, Output::Fixed(abi::RETURN_GPRS[0].into())),
            WasmKind::F32 => (Type::F32, Output::Fixed(abi::RETURN_FPR.into())),
            WasmKind::F64 => (Type::F64, Output::Fixed(abi::RETURN_FPR.into())),
            _ => (Type::I64, Output::Fixed(abi::RETURN_GPRS[0].into())),
        });
        let outgoing = &mut self.graph.function.outgoing_bytes;
        *outgoing = (*outgoing).max(callee.outgoing_bytes);

        let site = Site::CallWasm(self.origin, call);
        let mut data = self.patchpoint(Action::Custom, site, Effects::CALL);
        data.flags = PatchpointFlags::MOVES_STACK_POINTER;
        (data.clobbers_late, data.state) = (UNPINNED, self.state);
        let returned = self.ir().patchpoint(&data, &inputs, result.as_slice());
        match result {
            Some((Type::F32, _)) => self.ir().convert(Unary::Promote, Type::F64, returned),
            _ => returned,
        }
    }
}

impl WasmCall {
    pub(super) fn emit(&self, m: &mut MacroAssembler) {
        let slot = abi::NON_ARGUMENT_GPRS[0];
        m.move64(VM, self.callee.instance);
        let memory_base = Address::new(VM, self.callee.offset_of_memory_base);
        m.load64(abi::NUMBER_TAG, memory_base);
        m.move64(slot, self.callee.slot);
        m.call_indirect(Address::new(slot, 0));
        m.move64(VM, self.vm);
        m.load_tags();
    }
}
