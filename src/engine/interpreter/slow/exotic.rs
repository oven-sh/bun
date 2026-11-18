use bun_engine_bytecode::Register;
use bun_engine_vm::code::metadata::{self, ForInGet};
use bun_engine_vm::ic::operations;
use bun_engine_vm::{
    ClonedArguments, ForIn, ForInRegisters, JsObject, MappedArguments, Value, clone_object,
    copy_rest, for_in_has_own, for_in_next, for_in_open,
};

use super::{Frame, Next, execute};

impl Frame<'_> {
    /// Of an instruction that uses the current key on `base`.
    fn profiled_for_in(self, state: Register, entry: &metadata::ForIn, base: Value) -> ForIn {
        let for_in = self.state::<ForInRegisters>(state).get();
        entry.modes.record(for_in.profile_for(base));
        for_in
    }
}

execute! {
    CreateDirectArguments(op, cx, f) {
        f.code_block.note_argument_count(f.header);
        f.set(op.dst, MappedArguments::direct_from_frame(cx, f.header)?);
    }
    CreateScopedArguments(op, cx, f) {
        f.code_block.note_argument_count(f.header);
        f.set(op.dst, MappedArguments::scoped_from_frame(cx, f.header, f.cell(op.scope))?);
    }
    CreateUnmappedArguments(op, cx, f) {
        f.code_block.note_argument_count(f.header);
        f.set(op.dst, ClonedArguments::from_frame(cx, f.header)?);
    }
    GetFromArguments(op, cx, f) {
        let arguments = f.cell::<MappedArguments>(op.arguments);
        // SAFETY: verified to be a parameter, each of which has a slot.
        f.set_profiled(op.dst, op.metadata, unsafe { arguments.slot_unchecked(op.index) }.get());
    }
    PutToArguments(op, cx, f) {
        let arguments = f.cell::<MappedArguments>(op.arguments);
        // SAFETY: as above.
        unsafe { arguments.slot_unchecked(op.index).set(&arguments, f.get(op.value)) };
    }
    EnsureArguments(op, cx, f) {
        if f.reg_or_empty(op.arguments).is_none() {
            f.code_block.note_argument_count(f.header);
            if op.mapped {
                f.set(op.arguments, MappedArguments::direct_from_frame(cx, f.header)?);
            } else {
                f.set(op.arguments, ClonedArguments::from_frame(cx, f.header)?);
            }
        }
    }

    CopyDataProperties(op, cx, f) {
        f.cell::<JsObject>(op.target).copy_data_properties(cx, f.get(op.source))?;
    }
    CloneObject(op, cx, f) {
        f.set_profiled(op.dst, op.metadata, clone_object(cx, f.get(op.source))?);
    }
    CopyRest(op, cx, f) {
        let excluded = &f.code_block.code().name_lists[op.excluded.index()];
        let computed = f.collect(op.first, op.count);
        f.set(op.dst, copy_rest(cx, f.get(op.source), excluded, &computed)?);
    }

    GetPrivateName(op, cx, f) {
        let value = operations::get_private_name(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.cell(op.name))?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    PutPrivateName(op, cx, f) {
        let (base, value) = (f.get(op.base), f.get(op.value));
        operations::put_private_name(cx, f.code_block, f.entry(op.metadata), base, f.cell(op.name), value)?;
    }
    DefinePrivateName(op, cx, f) {
        let (base, value) = (f.reg(op.base), f.get(op.value));
        operations::define_private_name(cx, f.code_block, f.entry(op.metadata), base, f.cell(op.name), value)?;
    }
    HasPrivateName(op, cx, f) {
        f.set(op.dst, operations::has_private_name(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.cell(op.name))?);
    }
    SetPrivateBrand(op, cx, f) {
        operations::set_private_brand(cx, f.code_block, f.entry(op.metadata), f.reg(op.base), f.cell(op.brand))?;
    }
    CheckPrivateBrand(op, cx, f) {
        operations::check_private_brand(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.cell(op.brand))?;
    }
    HasPrivateBrand(op, cx, f) {
        f.set(op.dst, operations::has_private_name(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.cell(op.brand))?);
    }

    ForInOpen(op, cx, f) {
        Next::jump_if(!for_in_open(cx, f.state(op.state), f.get(op.base))?.is_true())
    }
    ForInNext(op, cx, f) {
        let step = for_in_next(cx, f.state(op.state), f.entry(op.metadata), f.reg(op.base));
        let name = f.value_of(cx, step)?;
        if let Some(name) = name {
            f.set(op.name, name);
        }
        Next::jump_if(name.is_none())
    }
    ForInGet(op, cx, f) {
        let (base, entry) = (f.get(op.base), &f.entry::<ForInGet>(op.metadata).for_in);
        let for_in = f.profiled_for_in(op.state, entry, base);
        let value = match for_in.object_with_slot(base) {
            // SAFETY: a slot of the shape, which has no accessor.
            Some((object, offset)) => unsafe { object.get_direct_unchecked(offset) },
            None => operations::get_by_val(cx, f.code_block, entry, base, for_in.key(f.reg(op.name)))?,
        };
        f.set_profiled(op.dst, op.metadata, value);
    }
    ForInPut(op, cx, f) {
        let (base, value, entry) = (f.get(op.base), f.get(op.value), f.entry::<metadata::ForIn>(op.metadata));
        let for_in = f.profiled_for_in(op.state, entry, base);
        if let Some((object, offset)) = for_in.object_with_writable_slot(base) {
            // SAFETY: the slot of a writable data property.
            unsafe { object.put_direct_unchecked(offset, value) };
        } else {
            let operation = if op.strict { operations::put_by_val::<true> } else { operations::put_by_val::<false> };
            operation(cx, f.code_block, entry, base, for_in.key(f.reg(op.name)), value)?;
        }
    }
    ForInHas(op, cx, f) {
        let (base, entry) = (f.get(op.base), f.entry::<metadata::ForIn>(op.metadata));
        let for_in = f.profiled_for_in(op.state, entry, base);
        let answer = match for_in.object_with_slot(base) {
            Some(_) => Value::TRUE,
            None => operations::in_by_val(cx, f.code_block, entry, base, for_in.key(f.reg(op.name)))?,
        };
        f.set(op.dst, answer);
    }
    ForInHasOwn(op, cx, f) {
        f.set(op.dst, for_in_has_own(cx, f.state(op.state), f.entry(op.metadata), f.get(op.base), f.cell(op.name))?);
    }
}
