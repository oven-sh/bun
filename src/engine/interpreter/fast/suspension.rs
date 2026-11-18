use bun_engine_bytecode::{Register, ResumeMode, Specialization, SuspendKind, op};
use bun_engine_vm::code::metadata;
use bun_engine_vm::heap::barrier;
use bun_engine_vm::ic::CallProfile;
use bun_engine_vm::{
    CellType, Coroutine, Gc, JsAsyncFunctionGenerator, JsPromise, RealmSlot, Value, ValueProfile,
    try_async_return_quickly,
};

use crate::machine::{EMPTY, cell, dispatch, go, handler, jump, next, slow};
use crate::slow::calls::write_header;
use crate::slow::suspension::{RESUMPTION_MODE, RESUMPTION_VALUE, mode_value, prepare_resumption};
use crate::stubs;

const NORMAL: u64 = mode_value(ResumeMode::Normal).to_bits();

handler! {
    fn resume_dispatch(m, op: op::ResumeDispatch) {
        if m.frame().argument_count_including_this() != 0 {
            next!(m, op)
        }
        let point = cell::<Coroutine>(m.reg(Register::THIS)).point();
        let code_block = m.code_block();
        dispatch!(m, m.at_offset(code_block.suspend_point_unchecked(point).resume))
    }

    fn suspend(m, op: op::Suspend) {
        let (coroutine, code_block) = (cell::<Coroutine>(m.reg(op.generator)), m.code_block());
        let registers = code_block.saved_registers_unchecked(op.point);
        coroutine.save_without_barrier(m.frame(), registers, op.point, op.kind);
        if !m.needs_no_barrier(&coroutine) {
            go!(m, remember_and_suspend::<W>)
        }
        go!(m, stubs::return_value; m.get(op.value))
    }

    #[cold]
    #[inline(never)]
    fn remember_and_suspend(m, op: op::Suspend) {
        barrier::slow_path(&cell(m.reg(op.generator)));
        go!(m, stubs::return_value; m.get(op.value))
    }

    fn r#await(m, op: op::Await) {
        let generator = m.reg(op.generator);
        if generator == EMPTY {
            go!(m, first_await::<W>)
        }
        let (global, value) = (m.code_block().global(), Value::from_bits(m.get(op.value)));
        if !cell::<JsAsyncFunctionGenerator>(generator).try_await_quickly(m.vm, &global, value) {
            slow!(m, op::Await)
        }
        go!(m, finish_await::<W>; generator)
    }

    #[inline(never)]
    fn first_await(m, op: op::Await) {
        let Some(generator) = JsAsyncFunctionGenerator::try_create_quickly(m.vm, m.frame(), &m.code_block()) else {
            slow!(m, op::Await)
        };
        m.set(op.generator, generator.address() as u64);
        go!(m, r#await::<W>)
    }

    #[inline(never)]
    fn finish_await(m, op: op::Await, generator) {
        let (generator, code_block) = (cell::<JsAsyncFunctionGenerator>(generator), m.code_block());
        let registers = code_block.saved_registers_unchecked(op.point);
        generator.save_without_barrier(m.frame(), registers, op.point, SuspendKind::Await);
        if !m.needs_no_barrier(&generator) {
            go!(m, remember_and_await::<W>)
        }
        go!(m, stubs::return_value; generator.promise().address())
    }

    #[cold]
    #[inline(never)]
    fn remember_and_await(m, op: op::Await) {
        let generator = cell::<JsAsyncFunctionGenerator>(m.reg(op.generator));
        barrier::slow_path(&generator);
        go!(m, stubs::return_value; generator.promise().address())
    }

    fn resume(m, op: op::Resume) {
        let (coroutine, code_block) = (m.reg(Register::THIS), m.code_block());
        cell::<Coroutine>(coroutine).restore(m.frame(), code_block.saved_registers_unchecked(op.point));
        m.set(op.generator, coroutine);
        next!(m, op)
    }

    fn resume_after_yield(m, op: op::ResumeAfterYield) {
        if m.reg(RESUMPTION_MODE) != NORMAL {
            slow!(m, op::ResumeAfterYield)
        }
        let value = m.reg(RESUMPTION_VALUE);
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        jump!(m, op.normal)
    }

    fn resume_after_await(m, op: op::ResumeAfterAwait) {
        if m.reg(RESUMPTION_MODE) != NORMAL {
            slow!(m, op::ResumeAfterAwait)
        }
        let value = m.reg(RESUMPTION_VALUE);
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn generator_return(m, op: op::GeneratorReturn) {
        cell::<Coroutine>(m.reg(op.generator)).complete();
        go!(m, stubs::return_value; m.get(op.value))
    }

    fn async_return(m, op: op::AsyncReturn) {
        let (generator, value) = (m.get(op.generator), Value::from_bits(m.get(op.value)));
        let generator = (generator != EMPTY).then(|| cell(generator));
        match try_async_return_quickly(m.vm, &m.code_block().global(), generator, value) {
            Some(promise) => go!(m, stubs::return_value; promise.address()),
            None => slow!(m, op::AsyncReturn),
        }
    }

    fn new_promise(m, op: op::NewPromise) {
        let Some(promise) = JsPromise::try_new_quickly(m.vm, &m.code_block().global()) else {
            slow!(m, op::NewPromise)
        };
        m.set(op.dst, promise.address() as u64);
        next!(m, op)
    }

    fn create_promise(m, op: op::CreatePromise) {
        let (new_target, global) = (m.get(op.new_target) as usize, m.code_block().global());
        if m.entry::<metadata::WeakCell>(op.metadata).bits() != new_target
            || global.slot_if_initialized(RealmSlot::promise_constructor).map_or(0, Gc::address) != new_target
        {
            slow!(m, op::CreatePromise)
        }
        let Some(promise) = JsPromise::try_new_quickly(m.vm, &global) else { slow!(m, op::CreatePromise) };
        m.set(op.dst, promise.address() as u64);
        next!(m, op)
    }

    fn resume_generator(m, op: op::ResumeGenerator) {
        let generator = m.get(op.generator);
        if !m.has_type(generator, CellType::Generator) || !cell::<Coroutine>(generator).is_suspended() {
            go!(m, resume_generator_slow::<W>)
        }
        let coroutine = cell::<Coroutine>(generator);
        let callee = coroutine.callee();
        let executable = coroutine.executable();
        let profile = &m.entry::<metadata::Call>(op.metadata).profile;
        let seen = profile.executable().bits();
        if profile.callee().bits() != callee.address()
            && seen != executable.address()
            && seen != CallProfile::MEGAMORPHIC
            && !profile.try_count(callee.address(), executable.address())
        {
            go!(m, resume_generator_slow::<W>)
        }
        coroutine.mark_executing();
        let (value, mode) = (m.get(op.value), m.get(op.mode));
        m.set(Register::outgoing_argument(op.frame, 0), value);
        m.set(Register::outgoing_argument(op.frame, 1), mode);
        let new_frame = m.fp.sub(op.frame as usize);
        let code_block = executable.code_block(Specialization::Call).map_or(0, Gc::address);
        write_header(new_frame, code_block, callee.address() as u64, 0, generator);
        m.frame().set_call_site(m.start().addr() as u32);
        let entry = executable.entry(Specialization::Call);
        go!(m, stubs::call::<op::ResumeGenerator, W>; executable.address(), entry, new_frame.addr())
    }

    #[inline(never)]
    fn resume_generator_slow(m, op: op::ResumeGenerator) {
        let prepared = prepare_resumption(m.vm, m.frame(), m.start());
        let new_frame = m.fp.sub(op.frame as usize);
        go!(m, stubs::call::<op::ResumeGenerator, W>; prepared.executable, prepared.entry, new_frame.addr())
    }
}
