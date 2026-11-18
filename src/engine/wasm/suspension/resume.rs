//! A function that is replaced by frames that were saved. It gets them for `this`, then a value, and whether to throw it.

use std::sync::OnceLock;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options};
use bun_engine_bytecode::{Specialization, Visibility};
use bun_engine_exec_memory::{CodeHandle, Priority, link, synchronize_instructions};
use bun_engine_text::StringRef;
use bun_engine_vm::call::{self, native_not_a_constructor};
use bun_engine_vm::heap::ParkedStack;
use bun_engine_vm::{Intrinsic, JsFunction, NativeExecutable, Vm};
use bun_engine_wasm_runtime::interpreted::{Linkage, Parked};
use bun_engine_wasm_runtime::{Engine, Incoming, Instance, Outgoing, Thrown, suspension};

use crate::calls;
use crate::engine::engine;
use crate::function::already_thrown;
use crate::host::realm_of as realm_of_instance;
use crate::namespace::{Namespace, Slot};
use crate::prelude::*;

static STUB: OnceLock<CodeHandle> = OnceLock::new();

fn generate(engine: &Engine) -> Option<CodeHandle> {
    let (fp, sp) = (abi::FRAME_POINTER, abi::STACK_POINTER);
    let [first, second] = abi::RETURN_GPRS;
    let mut masm = MacroAssembler::new(Options {
        features: Features::host(),
        shorten_jumps: true,
        seed: 0,
    });
    let throw = masm.external_address(call::throw_from_frame());
    masm.enter_frame();
    let top_call_frame = Address::new(abi::VM, Vm::OFFSET_OF_TOP_CALL_FRAME as i32);
    masm.store64(top_call_frame, fp);
    masm.move_arguments(&[fp.into()]);
    masm.call_address(find_room as *const () as usize);
    masm.branch_if_zero64(first, throw);
    masm.move64(sp, first);
    masm.move_arguments(&[fp.into()]);
    masm.call_address(restore as *const () as usize);
    masm.move64(fp, second);
    masm.branch_if_zero64(first, throw);
    masm.jump_address(engine.end_of_host_call_stub());
    let bytes = masm.finish().ok()?;
    let code = link(&bytes, Priority::Required, |_| unreachable!()).ok()?;
    code.describe(|| "wasm resume".into());
    Some(code)
}

/// Before anything can be suspended. There is no stub where nothing is compiled.
pub(super) fn make_stub(cx: &Cx) -> JsResult<()> {
    if !compiles() {
        return Ok(());
    }
    if STUB.get().is_none() {
        let code = engine().and_then(generate);
        let _ = STUB.set(code.ok_or_else(|| cx.throw_out_of_memory())?);
    }
    synchronize_instructions();
    Ok(())
}

fn compiles() -> bool {
    engine().is_some_and(Engine::compiles)
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let executable = NativeExecutable::create(
        cx,
        0,
        StringRef::empty(),
        match compiles() {
            true => native_not_a_constructor,
            false => resume_interpreted,
        },
        native_not_a_constructor,
        Intrinsic::None,
        Visibility::Private,
    );
    if compiles() {
        let entry = STUB.get().expect("something was suspended").start();
        // SAFETY: no script gets the function.
        unsafe { executable.install(Specialization::Call, entry, None) };
    }
    let init = JsFunction::native_init(cx, cx.native_function_shape(), executable);
    namespace.put(Slot::Resumer, cx.allocate::<JsFunction>(init));
}

/// The interpreter makes the frames again and goes on in them.
#[native_abi]
fn resume_interpreted(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (value, throws) = (frame.argument(0), frame.argument(1) == Value::TRUE);
    let engine = engine().expect("something was suspended");
    // Nothing is allocated until the values are in the slots, which the collector scans.
    let words = frame.this_value().cast::<ParkedStack>().take();
    let linkage = Linkage {
        frame: frame.address(),
        caller: frame.caller_address(),
        return_address: 0,
    };
    // SAFETY: saved on this thread, taken only here, and what they name is alive until the slots have it.
    let parked = unsafe { Parked::new(engine, &words, linkage) };
    let Ok(parked) = parked else {
        return already_thrown(cx);
    };
    let instance = parked.entry().callee().instance();
    let put = |instance: &Instance, results: Outgoing<'_>| match throws {
        true => {
            let _ = cx.throw(value);
            Err(Thrown)
        }
        false => calls::put_results(cx, instance, value, results).map_err(|_| Thrown),
    };
    let take = |results: Incoming<'_>| {
        calls::take_results(realm_of_instance(instance), &results).map_err(|_| Thrown)
    };
    match bun_engine_wasm_interpreter::resume(&parked, put, take) {
        Ok(Some(value)) => Ok(value),
        // It has been suspended again.
        Ok(None) => Ok(Value::UNDEFINED),
        Err(Thrown) => already_thrown(realm_of_instance(instance)),
    }
}

/// # Safety
/// For what the stub calls, before the frame changes.
unsafe fn realm_of<'a>(frame: &CallFrame) -> &'a mut Cx {
    let realm = frame.callee().cast::<JsFunction>().function_realm();
    // SAFETY: generated code runs inside a call that has the `Cx`.
    unsafe { Cx::from_global(realm) }
}

/// The stack pointer, or zero if it has thrown.
#[native_abi]
unsafe fn find_room(frame: &CallFrame) -> usize {
    // SAFETY: the caller's.
    let cx = unsafe { realm_of(frame) };
    let stack = frame.this_value().cast::<ParkedStack>();
    let size = suspension::size_below_entry(stack.word_count());
    let bottom = frame.address().saturating_sub(size);
    if bottom < cx.soft_stack_limit() {
        let _ = cx.throw_stack_overflow();
        return 0;
    }
    bottom
}

#[repr(C)]
struct Restored {
    value: JsResult<Value>,
    innermost_frame: usize,
}

#[native_abi]
unsafe fn restore(frame: &CallFrame) -> Restored {
    let (value, throws) = (frame.argument(0), frame.argument(1) == Value::TRUE);
    let words = frame.this_value().cast::<ParkedStack>().take();
    // SAFETY: the words could be taken, so they have not been before, and the stub has made room.
    let (cx, innermost) = unsafe {
        let cx = realm_of(frame);
        let innermost = suspension::restore(&words, frame.address());
        (cx, CallFrame::from_address(innermost))
    };
    cx.set_top_call_frame(innermost);
    Restored {
        value: if throws {
            Err(cx.throw(value))
        } else {
            Ok(value)
        },
        innermost_frame: innermost.address(),
    }
}
