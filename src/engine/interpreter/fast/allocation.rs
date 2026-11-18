use bun_engine_bytecode::{Width, op};
use bun_engine_vm::code::metadata::{NewObject, WeakCell};
use bun_engine_vm::heap::Allocator;
use bun_engine_vm::quick_arrays::*;
use bun_engine_vm::scope::is_instance_of;
use bun_engine_vm::{
    CellType, Cx, Environment, Gc, InlineWatchpointSet, JsCell, JsFunction, JsObject, Shape, Value,
};

use crate::machine::{EMPTY, Machine, UNDEFINED, cell, handler, next, slow};

impl<W: Width> Machine<W> {
    #[inline(always)]
    unsafe fn cx(&self) -> &Cx {
        // SAFETY: the realm of the code that is running.
        unsafe { Cx::from_global(self.code_block().global()) }
    }

    /// The slots are not initialized.
    #[inline(always)]
    unsafe fn allocate_object(&self, allocator: &Allocator, shape: Gc<Shape>) -> Option<*mut u64> {
        let object = core::ptr::with_exposed_provenance_mut::<u64>(allocator.try_bump()?);
        // SAFETY: a new cell.
        unsafe {
            object
                .cast::<[u64; 2]>()
                .write([JsCell::header_for(&shape), 0])
        };
        Some(object)
    }
}

const FIRST_SLOT: usize = size_of::<JsObject>() / size_of::<u64>();

/// Not to be made a call of `memset`.
#[inline(always)]
unsafe fn fill(words: *mut u64, range: core::ops::Range<usize>, word: u64) {
    for index in range {
        // SAFETY: the caller's.
        unsafe { words.add(index).write_volatile(word) };
    }
}

macro_rules! set_or_slow {
    ($m:ident, $op:ident: $Op:ty, $made:expr) => {{
        let Some(made) = $made else { slow!($m, $Op) };
        $m.set($op.dst, made.address() as u64);
        next!($m, $op)
    }};
}

handler! {
    fn new_object(m, op: op::NewObject) {
        let entry = m.entry::<NewObject>(op.metadata);
        let Some(allocator) = entry.allocator.get().as_ref() else { slow!(m, op::NewObject) };
        let Some(object) = m.allocate_object(allocator, entry.shape.get().decode()) else {
            slow!(m, op::NewObject)
        };
        fill(object.add(FIRST_SLOT), 0..entry.inline_capacity.get() as usize, EMPTY);
        m.publish();
        m.set(op.dst, object.addr() as u64);
        next!(m, op)
    }

    fn new_object_literal(m, op: op::NewObjectLiteral) {
        let entry = m.entry::<NewObject>(op.metadata);
        let Some(allocator) = entry.allocator.get().as_ref() else { slow!(m, op::NewObjectLiteral) };
        let Some(object) = m.allocate_object(allocator, entry.shape.get().decode()) else {
            slow!(m, op::NewObjectLiteral)
        };
        let slots = object.add(FIRST_SLOT);
        for index in 0..op.count {
            slots.add(index as usize).write_volatile(m.reg(op.first.nth(index)));
        }
        fill(slots, op.count as usize..entry.inline_capacity.get() as usize, EMPTY);
        m.publish();
        m.set(op.dst, object.addr() as u64);
        next!(m, op)
    }

    fn create_this(m, op: op::CreateThis) {
        let new_target = m.reg(op.new_target);
        let seen = m.entry::<WeakCell>(op.metadata).bits();
        if (seen != new_target as usize && seen != WeakCell::MANY)
            || cell::<JsCell>(new_target).cell_type() != CellType::Function
        {
            slow!(m, op::CreateThis)
        }
        let Some(rare_data) = cell::<JsFunction>(new_target).rare_data() else { slow!(m, op::CreateThis) };
        let (Some(shape), Some(allocator)) = (rare_data.object_shape(), rare_data.object_allocator()) else {
            slow!(m, op::CreateThis)
        };
        let Some(object) = m.allocate_object(allocator, shape) else { slow!(m, op::CreateThis) };
        fill(object.add(FIRST_SLOT), 0..shape.inline_capacity(), EMPTY);
        m.publish();
        m.set(op.dst, object.addr() as u64);
        next!(m, op)
    }

    fn create_scope(m, op: op::CreateScope) {
        let code_block = m.code_block();
        let Some(template) = code_block.scope_template_if_created(op.scope) else { slow!(m, op::CreateScope) };
        if template.singleton_watchpoints().bits() != InlineWatchpointSet::THIN_INVALIDATED {
            slow!(m, op::CreateScope)
        }
        let size = Environment::allocation_size(template.slot_count());
        let Some(address) = m.vm.heap.cells.allocator_for(size).and_then(Allocator::try_bump) else {
            slow!(m, op::CreateScope)
        };
        debug_assert!(is_instance_of(cell(m.reg(op.parent)), template.scope().parent()));
        let words = core::ptr::with_exposed_provenance_mut::<u64>(address);
        let header = JsCell::header_for(&code_block.global().environment_shape());
        words.cast::<[u64; 3]>().write([header, m.reg(op.parent), template.address() as u64]);
        let (slots, undefined) = (words.byte_add(Environment::OFFSET_OF_SLOTS), template.undefined_slots() as usize);
        fill(slots, 0..undefined, UNDEFINED);
        fill(slots, undefined..template.slot_count() as usize, EMPTY);
        m.publish();
        m.set(op.dst, address as u64);
        next!(m, op)
    }

    fn new_array(m, op: op::NewArray) {
        let lowest = m.fp.offset(op.first.offset() as isize + 1 - op.count as isize);
        let array = try_new_array(m.cx(), m.entry(op.metadata), lowest, op.count as usize, op.shape);
        set_or_slow!(m, op: op::NewArray, array)
    }

    fn new_array_from_constant(m, op: op::NewArrayFromConstant) {
        let elements = cell(*m.code_block().constants_ptr().add(op.elements.index()));
        let array = try_new_array_from_constant(m.cx(), m.entry(op.metadata), elements);
        set_or_slow!(m, op: op::NewArrayFromConstant, array)
    }

    fn new_array_with_size(m, op: op::NewArrayWithSize) {
        let array = try_new_array_with_size(m.cx(), m.entry(op.metadata), Value::from_bits(m.get(op.length)));
        set_or_slow!(m, op: op::NewArrayWithSize, array)
    }

    fn create_rest(m, op: op::CreateRest) {
        set_or_slow!(m, op: op::CreateRest, try_create_rest(m.cx(), m.frame(), op.skip as usize))
    }

    fn ensure_rest(m, op: op::EnsureRest) {
        if m.reg(op.rest) == EMPTY {
            let Some(array) = try_create_rest(m.cx(), m.frame(), op.skip as usize) else { slow!(m, op::EnsureRest) };
            m.set(op.rest, array.address() as u64);
        }
        next!(m, op)
    }

    fn create_direct_arguments(m, op: op::CreateDirectArguments) {
        let arguments = try_create_direct_arguments(m.cx(), m.frame(), m.code_block().parameters() - 1);
        set_or_slow!(m, op: op::CreateDirectArguments, arguments)
    }

    fn new_function(m, op: op::NewFunction) {
        let code_block = m.code_block();
        let Some(executable) = code_block.function_if_created(op.function) else { slow!(m, op::NewFunction) };
        if executable.singleton_watchpoints().bits() != InlineWatchpointSet::THIN_INVALIDATED {
            slow!(m, op::NewFunction)
        }
        let Some(shape) = code_block.global().slot_if_initialized(executable.shape_slot()) else {
            slow!(m, op::NewFunction)
        };
        let Some(address) = m.vm.heap.cells.allocator_for(size_of::<JsFunction>()).and_then(Allocator::try_bump) else {
            slow!(m, op::NewFunction)
        };
        debug_assert!(is_instance_of(cell(m.reg(op.scope)), executable.info().outer_scope()));
        let words = [JsCell::header_for(&shape.cast_unchecked()), 0, m.reg(op.scope), executable.address() as u64];
        core::ptr::with_exposed_provenance_mut::<[u64; 4]>(address).write(words);
        m.publish();
        m.set(op.dst, address as u64);
        next!(m, op)
    }
}
