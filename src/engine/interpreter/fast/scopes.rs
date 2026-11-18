use bun_engine_bytecode::{Register, Width, op};
use bun_engine_vm::code::metadata::{GetGlobal, GetImport, GlobalAccess, ResolveDynamic};
use bun_engine_vm::{
    CellType, Environment, Gc, GlobalBinding, InlineWatchpointSet, JsCell, JsObject, Value,
    ValueProfile, ic,
};

use super::barrier_and_next;
use crate::machine::{EMPTY, Machine, cell, handler, next, slow};

impl<W: Width> Machine<W> {
    #[inline(always)]
    unsafe fn outer_scope(&self, scope: Register, depth: u32) -> Gc<Environment> {
        // SAFETY: the chain is as the generator knew it.
        unsafe {
            let mut environment = cell::<Environment>(self.reg(scope));
            for _ in 0..depth {
                environment = environment.parent().cast_unchecked();
            }
            environment
        }
    }
}

macro_rules! loads {
    ($($name:ident, $Op:ident, |$op:ident| $depth:expr, $is_checked:literal;)*) => { handler! {$(
        fn $name(m, $op: op::$Op) {
            let value = Value::bits_of(m.outer_scope($op.scope, $depth).slot_unchecked($op.slot).get());
            if $is_checked && value == EMPTY {
                slow!(m, op::$Op)
            }
            m.entry::<ValueProfile>($op.metadata).record_bits(value);
            m.set($op.dst, value);
            next!(m, $op)
        }
    )*} };
}

loads! {
    get_scoped, GetScoped, |op| 0, false;
    get_outer, GetOuter, |op| op.depth, false;
    get_scoped_checked, GetScopedChecked, |op| 0, true;
    get_outer_checked, GetOuterChecked, |op| op.depth, true;
}

macro_rules! stores {
    ($($name:ident, $Op:ident, |$op:ident| $depth:expr;)*) => { handler! {$(
        fn $name(m, $op: op::$Op) {
            let (environment, value) = (m.outer_scope($op.scope, $depth), m.get($op.value));
            environment.slot_unchecked($op.slot).set_without_barrier(Value::from_bits_or_empty(value));
            barrier_and_next!(m, $op: op::$Op, environment, value)
        }
    )*} };
}

stores! {
    put_scoped, PutScoped, |op| 0;
    put_outer, PutOuter, |op| op.depth;
}

handler! {
    fn get_internal(m, op: op::GetInternal) {
        m.set(op.dst, Value::bits_of(m.outer_scope(op.scope, op.depth).slot_unchecked(op.slot).get()));
        next!(m, op)
    }

    fn get_import(m, op: op::GetImport) {
        let entry = m.entry::<GetImport>(op.metadata);
        let mut address = entry.slot.get();
        if address <= GetImport::VARIES {
            let module = m.outer_scope(op.scope, op.depth);
            let index = module.slot_unchecked(op.slot + 1).get().and_then(Value::as_index_int32);
            let (GetImport::VARIES, Some(index)) = (address, index) else {
                slow!(m, op::GetImport)
            };
            let target = cell::<Environment>(Value::bits_of(module.slot_unchecked(op.slot).get()));
            address = core::ptr::from_ref(target.slot_unchecked(index)).expose_provenance();
        }
        let value = *core::ptr::with_exposed_provenance::<u64>(address);
        if value == EMPTY {
            slow!(m, op::GetImport)
        }
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn get_global(m, op: op::GetGlobal) {
        let entry = m.entry::<GetGlobal>(op.metadata);
        let (shape, pointer) = (entry.access.shape.get(), entry.access.pointer.get());
        if pointer == 0 {
            slow!(m, op::GetGlobal)
        }
        let value = if shape.is_none() {
            *core::ptr::with_exposed_provenance::<u64>(pointer)
        } else {
            let global = cell::<JsObject>(pointer as u64);
            if global.shape_id() != shape {
                slow!(m, op::GetGlobal)
            }
            Value::bits_of(ic::slot_at(&global, entry.access.byte_offset.get()).get())
        };
        if value == EMPTY {
            slow!(m, op::GetGlobal)
        }
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn put_global(m, op: op::PutGlobal) {
        let (access, value) = (m.entry::<GlobalAccess>(op.metadata), m.get(op.value));
        let (shape, pointer) = (access.shape.get(), access.pointer.get());
        if pointer == 0 {
            slow!(m, op::PutGlobal)
        }
        if shape.is_none() {
            let binding = &*core::ptr::with_exposed_provenance::<GlobalBinding>(pointer);
            if binding.watchpoints().bits() != InlineWatchpointSet::THIN_INVALIDATED {
                slow!(m, op::PutGlobal)
            }
            binding.set_without_barrier(Value::from_bits(value));
            barrier_and_next!(m, op: op::PutGlobal, m.code_block().global(), value)
        }
        let global = cell::<JsObject>(pointer as u64);
        if global.shape_id() != shape {
            slow!(m, op::PutGlobal)
        }
        ic::slot_at(&global, access.byte_offset.get()).set_without_barrier(Some(Value::from_bits(value)));
        barrier_and_next!(m, op: op::PutGlobal, global, value)
    }

    fn resolve_dynamic(m, op: op::ResolveDynamic) {
        let entry = m.entry::<ResolveDynamic>(op.metadata);
        let depth = entry.depth.get();
        if entry.epoch.get() != m.vm.eval_variables_epoch() {
            if entry.shape.get().is_none() {
                slow!(m, op::ResolveDynamic)
            }
            let extensible = m.outer_scope(op.scope, entry.variables_depth.get().into());
            let variables = Value::bits_of(extensible.slot_unchecked(entry.variables_slot.get().into()).get());
            let is_as_it_was = match variables {
                EMPTY => depth != ResolveDynamic::VARIABLES,
                _ => cell::<JsCell>(variables).shape_id() == entry.shape.get(),
            };
            if !is_as_it_was {
                slow!(m, op::ResolveDynamic)
            }
            if depth == ResolveDynamic::VARIABLES {
                m.set(op.dst, variables);
                next!(m, op)
            }
        }
        let holder = match depth {
            ResolveDynamic::GLOBAL => m.code_block().global().address(),
            _ => m.outer_scope(op.scope, depth).address(),
        };
        m.set(op.dst, holder as u64);
        next!(m, op)
    }

    fn get_dynamic(m, op: op::GetDynamic) {
        let (entry, holder) = (m.entry::<GetGlobal>(op.metadata), cell::<JsObject>(m.reg(op.holder)));
        let value = if holder.shape_id() == entry.access.shape.get() {
            Value::bits_of(ic::slot_at(&holder, entry.access.byte_offset.get()).get())
        } else if entry.access.pointer.get() != 0 && holder.cell_type() == CellType::GlobalObject {
            *core::ptr::with_exposed_provenance::<u64>(entry.access.pointer.get())
        } else {
            EMPTY
        };
        if value == EMPTY {
            slow!(m, op::GetDynamic)
        }
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn put_dynamic(m, op: op::PutDynamic) {
        let (access, value) = (m.entry::<GlobalAccess>(op.metadata), m.get(op.value));
        let holder = cell::<JsObject>(m.reg(op.holder));
        if holder.shape_id() == access.shape.get() {
            let slot = ic::slot_at(&holder, access.byte_offset.get());
            if slot.get().is_none() {
                slow!(m, op::PutDynamic)
            }
            slot.set_without_barrier(Some(Value::from_bits(value)));
            barrier_and_next!(m, op: op::PutDynamic, holder, value)
        }
        if access.pointer.get() == 0 || holder.cell_type() != CellType::GlobalObject {
            slow!(m, op::PutDynamic)
        }
        let binding = &*core::ptr::with_exposed_provenance::<GlobalBinding>(access.pointer.get());
        if binding.watchpoints().bits() != InlineWatchpointSet::THIN_INVALIDATED {
            slow!(m, op::PutDynamic)
        }
        binding.set_without_barrier(Value::from_bits(value));
        barrier_and_next!(m, op: op::PutDynamic, m.code_block().global(), value)
    }

    fn get_dynamic_this(m, op: op::GetDynamicThis) {
        let holder = cell::<Environment>(m.reg(op.holder));
        let this = match holder.cell_type() {
            CellType::WithScope => Value::bits_of(holder.slot_unchecked(0).get()),
            _ => Value::UNDEFINED.to_bits(),
        };
        m.set(op.dst, this);
        next!(m, op)
    }
}
