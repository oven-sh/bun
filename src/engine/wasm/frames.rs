//! What a stack trace shows of the frames of WebAssembly.

use core::num::NonZeroUsize;

use bun_engine_bytecode::Visibility;
use bun_engine_text::StringRef;
use bun_engine_vm::{
    CallFrame, Gc, JsCell, SampledWasmFrame, Value, Vm, WasmFrame, WasmNames, WasmTier,
};
use bun_engine_wasm_compiler::abi::{ENTRY_CALLEE, STUB_CALLEE};
use bun_engine_wasm_format::{FuncIndex, Span};
use bun_engine_wasm_runtime::{CodeKind, Frame, Tag, function_at, interpreted_function};

use crate::engine::engine;
use crate::exception::{self, WasmException};
use crate::host::realm_of;
use crate::instance_cell::WasmInstance;
use crate::owned::host_cell;

const STUB: WasmFrame = WasmFrame {
    names: None,
    function_index: 0,
    visibility: Visibility::Private,
    tier: None,
    is_inlined: false,
};

fn tier_of(kind: CodeKind) -> WasmTier {
    match kind {
        CodeKind::Baseline => WasmTier::Baseline,
        CodeKind::Optimized => WasmTier::Optimized,
        CodeKind::LoopEntry(_) => WasmTier::OptimizedForLoopEntry,
    }
}

/// What runs in the frame, counting the functions that it has inlined from the innermost.
pub fn wasm_frame(_: &Vm, frame: &CallFrame, return_address: usize, depth: u32) -> WasmFrame {
    let Some(engine) = engine() else { return STUB };
    let it = Frame {
        fp: frame.address(),
        return_address,
    };
    // SAFETY: a frame of WebAssembly on the stack of this thread.
    let (functions, kind) = unsafe { (engine.functions_in(it), engine.kind_of_code(it)) };
    let mut functions = functions.skip(depth as usize);
    let Some(func) = functions.next() else {
        return STUB;
    };
    WasmFrame {
        names: instance_of(frame),
        function_index: func.0,
        visibility: Visibility::Public,
        tier: (kind.map(tier_of)).or_else(|| (!engine.compiles()).then_some(WasmTier::Interpreter)),
        is_inlined: functions.next().is_some(),
    }
}

/// See `Hooks::sampled_wasm_frame`.
pub fn sampled_wasm_frame(
    vm: &Vm,
    instance: usize,
    callee: u64,
    address: usize,
) -> Option<SampledWasmFrame> {
    let instance = vm.heap.live_cell_at(instance)?.downcast::<WasmInstance>()?;
    if callee == ENTRY_CALLEE.into() {
        return Some(SampledWasmFrame::stub(WasmTier::StubFromScript));
    }
    if callee == STUB_CALLEE.into() {
        return Some(SampledWasmFrame::stub(WasmTier::StubToScript));
    }
    let (func, tier) = match function_at(address) {
        Some((func, kind)) => (func, tier_of(kind)),
        // The word may be anything, and so may the index that it gives.
        None if !engine()?.compiles() => (interpreted_function(callee)?, WasmTier::Interpreter),
        None => return None,
    };
    Some(SampledWasmFrame {
        name: wasm_names(instance.cell(), func.0).qualified(func.0),
        tier,
    })
}

/// See `Hooks::find_wasm_handler`.
pub fn find_handler(vm: &Vm, frame: &CallFrame, return_address: usize) -> Option<usize> {
    let value = vm.exception()?.value();
    let frame = Frame {
        fp: frame.address(),
        return_address,
    };
    // SAFETY: on the stack of this thread, and the exception has that tag.
    unsafe {
        let handler = engine()?.find_handler(frame, || exception::tag_of_thrown_value(&value))?;
        vm.clear_exception();
        let caught = WasmException::of_thrown_value(realm_of(handler.instance()), value);
        Some(handler.enter_with(host_cell(caught.cell())))
    }
}

/// See `Hooks::wasm_frame_catches`.
pub fn frame_catches(frame: &CallFrame, return_address: usize, thrown: Value) -> bool {
    let Some(engine) = engine() else { return false };
    let tag = || exception::tag_of_thrown_value(&thrown);
    if !engine.compiles() {
        return catches_in_interpreter(frame, return_address, tag);
    }
    let frame = Frame {
        fp: frame.address(),
        return_address,
    };
    // SAFETY: on the stack of this thread.
    unsafe { engine.find_handler(frame, tag) }.is_some()
}

/// The frame runs the function whose word for the callee it has, and goes on at the return address.
fn catches_in_interpreter<'a>(
    frame: &CallFrame,
    site: usize,
    tag: impl FnOnce() -> Option<&'a Tag>,
) -> bool {
    let Some(func) = interpreted_function(frame.callee_bits()) else {
        return false;
    };
    let Some(object) = instance_of(frame).and_then(Gc::downcast::<WasmInstance>) else {
        return false;
    };
    (tag())
        .is_some_and(|tag| bun_engine_wasm_interpreter::catches(object.instance(), func, site, tag))
}

/// The instance is where the prologue of a function of WebAssembly puts it.
fn instance_of(frame: &CallFrame) -> Option<Gc<JsCell>> {
    let cell = NonZeroUsize::new(frame.code_block_bits())?;
    // SAFETY: the instance of the frame, which is alive while the frame is.
    Some(unsafe { Gc::from_address(cell.get()) })
}

/// The names that the module gives the function, if it has a name section.
pub fn wasm_names(cell: Gc<JsCell>, function_index: u32) -> WasmNames {
    let mut names = WasmNames {
        module: StringRef::empty(),
        function: None,
    };
    let Some(object) = cell.downcast::<WasmInstance>() else {
        return names;
    };
    let module = object.instance().module();
    let text = |span: Span| StringRef::try_from_utf8_lossy(module.bytes(span)).ok();
    let Some(section) = module.names() else {
        return names;
    };
    names.module = section.module().and_then(text).unwrap_or_default();
    names.function = section.func(FuncIndex(function_index)).and_then(text);
    names
}
