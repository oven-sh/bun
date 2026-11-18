use bun_engine_bytecode::{Register, Width, op};
use bun_engine_vm::code::metadata::{Flags, IteratorNext};
use bun_engine_vm::registers::{self, iterator_next_slow};
use bun_engine_vm::{
    CellType, IterationMode, IteratorRecord, IteratorRegisters, JsArray, JsCell, Step, Value,
};

use super::operate;
use crate::machine::{Machine, UNDEFINED, cell, go, handler, jump, next, slow};
use crate::slow::Frame;
use crate::stubs;

const ARRAY: u64 = IterationMode::Array.marker().to_bits();
const DONE: u64 = IteratorRecord::DONE.to_bits();

#[inline(always)]
fn has_seen(modes: &Flags, mode: IterationMode) -> bool {
    modes.0.get() & mode.flag() != 0
}

impl<W: Width> Machine<W> {
    #[inline(always)]
    unsafe fn open_array(&self, state: Register, array: u64) {
        // SAFETY: the caller's.
        unsafe {
            self.set(state, array);
            self.set(state.nth(1), ARRAY);
            self.set(state.nth(2), self.box_int32(0));
        }
    }
}

handler! {
    fn iterator_open(m, op: op::IteratorOpen) {
        let (iterable, method, modes) = (m.get(op.iterable), m.reg(op.method), m.entry::<Flags>(op.metadata));
        let Some(cell_type) = m.as_cell(iterable).map(|it| it.cell_type()) else { slow!(m, op::IteratorOpen) };
        if cell_type == CellType::Array {
            let global = m.code_block().global();
            if method == global.array_prototype_values().address() as u64
                && global.array_iterator_protocol_is_pristine()
                && has_seen(modes, IterationMode::Array)
            {
                m.open_array(op.state, iterable);
                jump!(m, op.opened)
            }
        } else if matches!(cell_type, CellType::Generator | CellType::FinalObject | CellType::IteratorHelper)
            && m.has_type(method, CellType::Function)
            && has_seen(modes, IterationMode::Generic)
        {
            m.set(op.state.nth(2), m.box_int32(0));
            next!(m, op)
        }
        slow!(m, op::IteratorOpen)
    }

    fn iterator_next(m, op: op::IteratorNext) {
        let (method, entry) = (m.reg(op.state.nth(1)), m.entry::<IteratorNext>(op.metadata));
        if method == ARRAY && has_seen(&entry.modes, IterationMode::Array) {
            let (array, index) = (cell::<JsArray>(m.reg(op.state)), m.reg(op.state.nth(2)) as u32);
            if let Some(value) = array.try_get_dense(index) {
                entry.array.record_shape(&array);
                entry.value.record(value);
                m.set(op.state.nth(2), m.box_int32(index as i32 + 1));
                m.set(op.value, value.to_bits());
                next!(m, op)
            }
        } else if !IterationMode::is_marker(Value::from_bits(method)) {
            entry.modes.record(IterationMode::Generic.flag());
            jump!(m, op.generic)
        }
        go!(m, iterator_next_other::<W>)
    }

    #[inline(never)]
    fn iterator_next_other(m, op: op::IteratorNext) {
        let entry = m.entry::<IteratorNext>(op.metadata);
        match m.state::<IteratorRegisters>(op.state).try_step(m.vm, entry) {
            Step::FAILED => go!(m, iterator_next_by_call::<W>),
            Step::DONE => jump!(m, op.done),
            value => {
                entry.value.record_bits(value.bits());
                m.set(op.value, value.bits());
            }
        }
        next!(m, op)
    }

    #[inline(never)]
    fn iterator_next_by_call(m, op: op::IteratorNext) {
        let (entry, (cx, _)) = (m.entry::<IteratorNext>(op.metadata), Frame::enter(m.vm, m.frame(), m.start()));
        match iterator_next_slow(cx, m.state(op.state), entry) {
            Step::FAILED => go!(m, stubs::throw),
            Step::DONE => jump!(m, op.done),
            value => {
                entry.value.record_bits(value.bits());
                m.set(op.value, value.bits());
            }
        }
        next!(m, op)
    }

    fn iterator_begin(m, op: op::IteratorBegin) {
        let (iterable, global) = (m.get(op.iterable), m.code_block().global());
        if !m.has_type(iterable, CellType::Array)
            || !global.is_original_array_shape(&cell::<JsCell>(iterable).shape())
            || !global.array_iterator_protocol_is_pristine()
            || !has_seen(m.entry(op.metadata), IterationMode::Array)
        {
            slow!(m, op::IteratorBegin)
        }
        m.open_array(op.state, iterable);
        next!(m, op)
    }

    fn iterator_step(m, op: op::IteratorStep) {
        let entry = m.entry::<IteratorNext>(op.metadata);
        if m.reg(op.state.nth(1)) != ARRAY || !has_seen(&entry.modes, IterationMode::Array) {
            go!(m, iterator_step_other::<W>)
        }
        let (array, index) = (cell::<JsArray>(m.reg(op.state)), m.reg(op.state.nth(2)) as u32);
        let Some(value) = array.try_get_dense(index) else { go!(m, iterator_step_other::<W>) };
        entry.array.record_shape(&array);
        entry.value.record(value);
        m.set(op.state.nth(2), m.box_int32(index as i32 + 1));
        m.set(op.value, value.to_bits());
        next!(m, op)
    }

    #[inline(never)]
    fn iterator_step_other(m, op: op::IteratorStep) {
        let entry = m.entry::<IteratorNext>(op.metadata);
        let value = match m.state::<IteratorRegisters>(op.state).try_step(m.vm, entry) {
            Step::FAILED => go!(m, iterator_step_by_call::<W>),
            Step::DONE => UNDEFINED,
            value => value.bits(),
        };
        entry.value.record_bits(value);
        m.set(op.value, value);
        next!(m, op)
    }

    #[inline(never)]
    fn iterator_step_by_call(m, op: op::IteratorStep) {
        let entry = m.entry::<IteratorNext>(op.metadata);
        let value = operate!(m, |cx, _f| registers::iterator_step_slow(cx, m.state(op.state), entry));
        entry.value.record(value);
        m.set(op.value, value.to_bits());
        next!(m, op)
    }

    fn iterator_close(m, op: op::IteratorClose) {
        if m.reg(op.state.nth(2)) != DONE
            && (m.reg(op.state.nth(1)) != ARRAY || !m.code_block().global().array_iterator_protocol_is_pristine())
        {
            slow!(m, op::IteratorClose)
        }
        m.entry::<Flags>(op.metadata).record(m.state::<IteratorRegisters>(op.state).mode().flag());
        next!(m, op)
    }

    fn spread(m, op: op::Spread) {
        let iterable = Value::from_bits(m.get(op.iterable));
        m.set(op.dst, operate!(m, |cx, _f| registers::spread(cx, iterable)).to_bits());
        next!(m, op)
    }

    fn new_array_with_spread(m, op: op::NewArrayWithSpread) {
        let lowest = m.fp.offset(op.first.offset() as isize + 1 - op.count as isize).cast();
        let array = operate!(m, |cx, _f| registers::new_array_with_spread(cx, lowest, op.count as usize));
        m.set(op.dst, array.to_bits());
        next!(m, op)
    }

    fn iterator_skip(m, op: op::IteratorSkip) {
        let index = m.reg(op.state.nth(2)) as u32;
        if m.reg(op.state.nth(1)) != ARRAY || cell::<JsArray>(m.reg(op.state)).try_get_dense(index).is_none() {
            slow!(m, op::IteratorSkip)
        }
        m.set(op.state.nth(2), m.box_int32(index as i32 + 1));
        next!(m, op)
    }
}
