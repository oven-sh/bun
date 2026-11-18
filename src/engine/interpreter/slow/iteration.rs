use bun_engine_bytecode::CloseMode;
use bun_engine_vm::code::metadata::IteratorNext;
use bun_engine_vm::code::metadata::NewArrayWithSpecies;
use bun_engine_vm::registers::{
    iterator_begin, iterator_leave, iterator_next, iterator_open, iterator_rest, iterator_skip,
    iterator_step,
};
use bun_engine_vm::{self as vm, ArrayAllocationProfile, IterationMode, IteratorRegisters};

use super::{Next, execute};

execute! {
    NewArray(op, cx, f) {
        let profile = f.entry::<ArrayAllocationProfile>(op.metadata);
        // SAFETY: the profile of a code block.
        f.set(op.dst, unsafe { vm::new_array(cx, profile, op.shape, f.run(op.first, op.count)) }?);
    }
    NewArrayFromConstant(op, cx, f) {
        let elements = f.code_block.constant(op.elements.0).expect("an array").cast();
        // SAFETY: as above.
        let array = unsafe { vm::new_array_from_constant(cx, f.entry(op.metadata), elements) }?;
        if let Some(generalized) = array.shared_elements().filter(|&it| it != elements) {
            f.code_block.replace_array_constant(op.elements.0, generalized);
        }
        f.set(op.dst, array);
    }
    NewArrayWithSize(op, cx, f) {
        // SAFETY: as above.
        f.set(op.dst, unsafe { vm::new_array_with_size(cx, f.entry(op.metadata), f.get(op.length)) }?);
    }
    NewArrayWithSpecies(op, cx, f) {
        let (entry, array) = (f.entry::<NewArrayWithSpecies>(op.metadata), f.get(op.array));
        entry.array.record_base(array);
        // SAFETY: as above.
        let result = unsafe { vm::new_array_with_species(cx, &entry.allocation, f.get(op.length), &array.cast::<vm::JsObject>()) }?;
        f.set_profiled(op.dst, op.metadata, result);
    }
    NewArrayWithSpread(op, cx, f) {
        f.set(op.dst, vm::new_array_with_spread(cx, f.run(op.first, op.count))?);
    }
    AppendToArray(op, cx, f) {
        vm::append_to_array(cx, &f.cell(op.array), f.run(op.first, op.count))?;
    }
    Spread(op, cx, f) {
        f.set(op.dst, vm::spread(cx, f.get(op.iterable))?);
    }
    ToArgumentList(op, cx, f) {
        let list = f.get_or_empty(op.value).map(|it| vm::to_argument_list(cx, it)).transpose()?;
        f.set_or_empty(op.dst, list);
    }
    IteratorOpen(op, cx, f) {
        let (iterable, method) = (f.get(op.iterable), f.reg(op.method));
        Next::jump_if(iterator_open(cx, f.state(op.state), f.entry(op.metadata), iterable, method)?.is_true())
    }
    IteratorNext(op, cx, f) {
        let (state, entry) = (f.state::<IteratorRegisters>(op.state), f.entry::<IteratorNext>(op.metadata));
        if state.mode() == IterationMode::Generic {
            entry.modes.record(IterationMode::Generic.flag());
            return Ok(Next::SecondTarget);
        }
        let step = iterator_next(cx, state, entry);
        let value = f.value_of(cx, step)?;
        if let Some(value) = value {
            f.set_profiled(op.value, op.metadata, value);
        }
        Next::jump_if(value.is_none())
    }
    IteratorBegin(op, cx, f) {
        iterator_begin(cx, f.state(op.state), f.entry(op.metadata), f.get(op.iterable))?;
    }
    IteratorStep(op, cx, f) {
        f.set_profiled(op.value, op.metadata, iterator_step(cx, f.state(op.state), f.entry(op.metadata))?);
    }
    IteratorSkip(op, cx, f) {
        iterator_skip(cx, f.state(op.state))?;
    }
    IteratorRest(op, cx, f) {
        f.set(op.dst, iterator_rest(cx, f.state(op.state))?);
    }
    IteratorClose(op, cx, f) {
        iterator_leave(cx, f.state(op.state), f.entry(op.metadata), op.mode == CloseMode::Throw)?;
    }
}
