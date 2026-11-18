//! Calls of functions that WebAssembly exports.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::call::WasmKind;
use bun_engine_vm::{ElementType, JsObject, SpeculatedType as T};
use smallvec::SmallVec;

use super::Builder;
use super::calls::CallSite;
use crate::graph::{CallKind, ExitKind, Kind, WasmCall};

/// Of the arrays whose elements are converted in the same way.
fn element_type(kind: WasmKind) -> Option<ElementType> {
    Some(match kind {
        WasmKind::I32 => ElementType::Int32,
        WasmKind::I64 => ElementType::BigInt64,
        WasmKind::F32 => ElementType::Float32,
        WasmKind::F64 => ElementType::Float64,
        WasmKind::Value | WasmKind::NonNullValue => return None,
    })
}

impl Builder<'_> {
    fn may_pass_to_wasm(&self, kind: WasmKind, value: Ssa) -> bool {
        match element_type(kind) {
            Some(of) => self.may_become_element(of, value),
            None => kind == WasmKind::Value || !self.has_exited(ExitKind::BadType),
        }
    }

    fn pass_to_wasm(&mut self, kind: WasmKind, value: Ssa) -> Ssa {
        match element_type(kind) {
            Some(of) => self.to_element(of, value),
            None if kind == WasmKind::Value => self.graph.root(value),
            None => self.check_type(value, T::HEAP_TOP - T::NULL),
        }
    }

    pub(super) fn call_wasm(&mut self, site: &CallSite<'_>) -> Option<Ssa> {
        let seen = self.results_at(site);
        if site.kind == CallKind::Construct || self.leaves_for_good(site) || seen.is_empty() {
            return None;
        }
        let function = self.constant_cell::<JsObject>(site.callee)?;
        let callee = (self.vm.hooks().wasm_callee)(&function)?;
        let undefined = self.undefined();
        let given = site.arguments[1..].iter().copied();
        let arguments = given.chain(core::iter::repeat(undefined));
        let pairs = || {
            callee
                .parameters
                .iter()
                .map(|it| it.0)
                .zip(arguments.clone())
        };
        if !pairs().all(|(kind, value)| self.may_pass_to_wasm(kind, value)) {
            return None;
        }
        let operands: SmallVec<[Ssa; 8]> =
            (pairs().map(|(kind, value)| self.pass_to_wasm(kind, value))).collect();

        let result = callee.result;
        let kind = match result {
            None => Kind::CallWasm,
            Some(WasmKind::I32) => Kind::CallWasmForInt32,
            Some(WasmKind::I64) => Kind::CallWasmForInt64,
            Some(WasmKind::F32 | WasmKind::F64) => Kind::CallWasmForDouble,
            Some(WasmKind::Value | WasmKind::NonNullValue) => Kind::CallWasmForValue,
        };
        let vm = core::ptr::from_ref(self.vm).addr();
        self.graph.wasm_calls.push(WasmCall { callee, vm });
        let call = self.node(kind, &operands, self.graph.wasm_calls.len() as u32 - 1);
        if site.kind == CallKind::TailCall {
            self.attribute_to_caller(call);
        }
        Some(match result.map(element_type) {
            None => undefined,
            Some(Some(of)) => self.box_number(of, call, seen),
            Some(None) => {
                self.graph.predict(call, seen);
                self.note_result_of(site, call);
                call
            }
        })
    }
}
