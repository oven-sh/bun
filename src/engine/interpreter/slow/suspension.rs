use bun_engine_bytecode::{Register, ResumeMode, Specialization, SuspendKind, op};
use bun_engine_macros::native_abi;
use bun_engine_vm::code::metadata::{self, Flags, WeakCell};
use bun_engine_vm::{
    self as vm, CallFrame, Coroutine, Gc, IterationMode, JsAsyncFunctionGenerator,
    JsAsyncGenerator, JsGenerator, JsPromise, Value, Vm,
};

use super::calls::{PreparedCall, write_header};
use super::{Frame, Next, decode, execute};

pub(crate) const RESUMPTION_VALUE: Register = Register::argument(0);
pub(crate) const RESUMPTION_MODE: Register = Register::argument(1);

pub(crate) const fn mode_value(mode: ResumeMode) -> Value {
    Value::int32(mode as i32)
}

execute! {
    NewPromise(op, cx, f) {
        f.set(op.dst, JsPromise::new(cx));
    }
    CreatePromise(op, cx, f) {
        let new_target = f.get(op.new_target);
        f.entry::<WeakCell>(op.metadata).record(f.code_block, &new_target.cast());
        f.set(op.dst, JsPromise::for_new_target(cx, new_target)?);
    }
    GetDisposeMethod(op, cx, f) {
        f.set(op.dst, vm::get_dispose_method(cx, f.get(op.value), op.is_async)?);
    }
    NewSuppressedError(op, cx, f) {
        f.set(op.dst, vm::ErrorInstance::suppressed(cx, f.reg(op.error), f.reg(op.suppressed)));
    }
    AsyncIteratorOpen(op, cx, f) {
        let opened = vm::open_async_iterator(cx, f.get(op.iterable), f.reg(op.method))?;
        f.entry::<Flags>(op.metadata).record(opened.as_ref().map_or(IterationMode::Generic, |it| it.mode).flag());
        if let Some(record) = &opened {
            f.set(op.state, record.iterator);
            f.set(op.state.nth(1), record.mode.marker());
        }
        Next::jump_if(opened.is_some())
    }
    AsyncIteratorNext(op, cx, f) {
        let mode = IterationMode::of(f.reg(op.state.nth(1)));
        f.entry::<Flags>(op.metadata).record(mode.flag());
        if mode == IterationMode::Generic {
            return Ok(Next::FallThrough);
        }
        let asker = Coroutine::ensure(cx, f.header, f.reg_or_empty(op.generator))?;
        let awaited = vm::request_async_step(cx, f.reg(op.state), asker, f.get_or_empty(op.value))?;
        f.set(op.generator, asker);
        f.set(op.dst, awaited);
        Next::FirstTarget
    }
    ResumeDispatch(op, cx, f) {
        match Coroutine::of_frame(f.header) {
            Some(coroutine) => Next::Offset(f.code_block.body().suspend_points()[coroutine.point().index()].resume),
            None => Next::FallThrough,
        }
    }
    CreateGenerator(op, cx, f) {
        f.entry::<WeakCell>(op.metadata).record(f.code_block, &f.header.callee());
        f.set(op.dst, JsGenerator::for_frame(cx, f.header)?);
    }
    CreateAsyncGenerator(op, cx, f) {
        f.entry::<WeakCell>(op.metadata).record(f.code_block, &f.header.callee());
        f.set(op.dst, JsAsyncGenerator::for_frame(cx, f.header)?);
    }
    Suspend(op, cx, f) {
        let registers = f.code_block.body().saved_registers(op.point);
        // SAFETY: made by this code, which leaves the frame.
        unsafe { f.cell::<Coroutine>(op.generator).save(f.header, registers, op.point, op.kind) };
        Next::Return(f.get(op.value))
    }
    Await(op, cx, f) {
        let generator = JsAsyncFunctionGenerator::ensure(cx, f.header, f.reg_or_empty(op.generator))?;
        generator.await_value(cx, f.get(op.value))?;
        let registers = f.code_block.body().saved_registers(op.point);
        // SAFETY: as above.
        unsafe { generator.save(f.header, registers, op.point, SuspendKind::Await) };
        Next::Return(generator.promise().into())
    }
    Resume(op, cx, f) {
        let coroutine = f.cell::<Coroutine>(Register::THIS);
        // SAFETY: only `resume_dispatch` leads here.
        unsafe { coroutine.restore(f.header, f.code_block.body().saved_registers(op.point)) };
        f.set(op.generator, coroutine);
    }
    ResumeAfterYield(op, cx, f) {
        let (value, mode) = (f.reg(RESUMPTION_VALUE), f.reg(RESUMPTION_MODE));
        if mode == mode_value(ResumeMode::Throw) {
            return Err(cx.throw(value));
        }
        f.set_profiled(op.dst, op.metadata, value);
        Next::jump_if(mode == mode_value(ResumeMode::Normal))
    }
    ResumeAfterAwait(op, cx, f) {
        let value = f.reg(RESUMPTION_VALUE);
        if f.reg(RESUMPTION_MODE) == mode_value(ResumeMode::Throw) {
            return Err(cx.throw(value));
        }
        f.set_profiled(op.dst, op.metadata, value);
    }
    ResumeAfterDelegate(op, cx, f) {
        f.set_profiled(op.value, op.metadata, f.reg(RESUMPTION_VALUE));
        f.set(op.mode, f.reg(RESUMPTION_MODE));
    }
    GeneratorReturn(op, cx, f) {
        f.cell::<Coroutine>(op.generator).complete();
        Next::Return(f.get(op.value))
    }
    GeneratorThrow(op, cx, f) {
        f.cell::<Coroutine>(op.generator).complete();
        return Err(cx.throw_exception(f.cell(op.exception)))
    }
    AsyncReturn(op, cx, f) {
        Next::Return(vm::async_return(cx, f.get_or_empty(op.generator), f.get(op.value))?.into())
    }
    AsyncThrow(op, cx, f) {
        Next::Return(vm::async_throw(cx, f.get_or_empty(op.generator), f.reg(op.value)).into())
    }
    DebugAwait(op, cx, f) {
        if cx.stepping_debugger_count().get() != 0 {
            let coroutine = Coroutine::ensure(cx, f.header, f.reg_or_empty(op.generator))?;
            f.set(op.generator, coroutine);
            cx.debug_await(f.header, op.hook, coroutine);
        }
    }
}

/// A `PrepareFixedCall` that does not throw.
#[native_abi]
#[inline(never)]
pub(crate) unsafe fn prepare_resumption(
    vm: &Vm,
    frame: &CallFrame,
    start: *const u8,
) -> PreparedCall {
    // SAFETY: the caller's, and the new frame is among the locals. What has suspended is a function.
    unsafe {
        let op = decode::<op::ResumeGenerator>(start);
        let (_, f) = Frame::enter(vm, frame, start);
        let generator = f.get(op.generator).cast::<JsGenerator>();
        generator.mark_executing();
        let callee = generator.callee();
        let executable = generator.executable();
        let profile = &f.entry::<metadata::Call>(op.metadata).profile;
        if profile.callee().bits() != callee.address()
            && profile.executable().bits() != executable.address()
            && !profile.try_count(callee.address(), executable.address())
        {
            profile.record(f.code_block, callee.into(), Specialization::Call);
        }
        let (value, mode) = (f.get(op.value), f.get(op.mode));
        f.set(Register::outgoing_argument(op.frame, 0), value);
        f.set(Register::outgoing_argument(op.frame, 1), mode);
        let specialization = bun_engine_bytecode::Specialization::Call;
        write_header(
            frame.slot(-(op.frame as isize)).as_ptr(),
            executable.code_block(specialization).map_or(0, Gc::address),
            callee.address() as u64,
            0,
            generator.address() as u64,
        );
        PreparedCall {
            entry: executable.entry(specialization),
            executable: executable.address(),
        }
    }
}
