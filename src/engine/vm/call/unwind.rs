use bun_engine_bytecode::HandlerKind;
use bun_engine_macros::native_abi;

use crate::{CallFrame, CodeBlock, Vm, debugger};

/// The address of the handler, and the offset of its bytecode.
fn find_handler(vm: &Vm, frame: &CallFrame, code_block: &CodeBlock) -> Option<(usize, u32)> {
    let call_site = frame.call_site();
    let Some(compiled) = code_block.compiled().filter(|_| code_block.is_optimized()) else {
        let offset = code_block.bytecode_offset_of(call_site);
        let target = code_block.body().handler_for(offset)?.target;
        let address = (vm.hooks().catch_address)(code_block, target);
        return Some((address, target));
    };
    let mut origin = compiled.origin_of_call_site(call_site);
    let mut may_catch = true;
    loop {
        let inline_frame = origin
            .inline_frame
            .map(|index| compiled.inline_frame(vm, index));
        let code = inline_frame.map_or_else(|| code_block.baseline(), |frame| frame.code_block);
        if may_catch && let Some(handler) = code.body().handler_for(origin.bytecode_offset) {
            let address = compiled.catch_address(call_site, origin, handler.target);
            return Some((address, handler.target));
        }
        let inline_frame = inline_frame?;
        may_catch = !inline_frame.is_tail_call;
        origin = inline_frame.caller;
    }
}

/// Finds where the pending exception is caught, and leaves the place in the `Vm`.
///
/// # Safety
/// `frame` is the innermost frame of generated code, and its call site is current.
#[native_abi]
pub unsafe fn unwind(vm: &Vm, frame: &CallFrame) {
    vm.set_top_call_frame(frame);
    // Code that throws on its way out of a recursion passes neither a prologue nor a loop.
    if vm.is_termination_requested() {
        vm.answer_termination_request();
    }
    let is_catchable = !vm.has_pending_termination_exception();
    if vm.has_debugger() {
        // SAFETY: generated code runs inside a call that has the `Cx`.
        unsafe { debugger::will_unwind(vm) };
    }
    let entry_frame = vm.top_entry_frame();
    let (mut frame, mut return_address) = (frame, 0);
    loop {
        let handler = if !is_catchable {
            None
        } else if frame.has_native_callee() {
            (vm.hooks().find_wasm_handler)(vm, frame, return_address).map(|address| (address, 0))
        } else {
            let code_block = frame.code_block();
            code_block.and_then(|code_block| find_handler(vm, frame, &code_block))
        };
        if let Some((address, bytecode_offset)) = handler {
            return vm.set_catch_target(frame.address(), address, bytecode_offset);
        }
        if vm.has_debugger() && is_catchable {
            vm.set_top_call_frame(frame);
            // SAFETY: as above.
            unsafe { debugger::did_unwind_frame(frame) };
        }
        if let Some(coroutine) = crate::Coroutine::of_frame(frame) {
            coroutine.complete();
        }
        if frame.caller_address() == entry_frame {
            let address = super::return_to_native_code_with_exception();
            return vm.set_catch_target(entry_frame, address, 0);
        }
        return_address = frame.return_address();
        // SAFETY: not the entry frame, so another frame of generated code.
        frame = unsafe { CallFrame::from_address(frame.caller_address()) };
    }
}

impl CodeBlock {
    /// Whether a `catch` that is in the source covers the instruction.
    pub fn has_catch_handler_for(&self, bytecode_offset: u32) -> bool {
        self.body().handlers().iter().any(|handler| {
            handler.kind == HandlerKind::Catch && handler.range.contains(&bytecode_offset)
        })
    }
}
