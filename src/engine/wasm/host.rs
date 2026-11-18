//! What the run time asks of the heap and the `Vm`.

use core::num::NonZeroUsize;
use core::time::Duration;

use bun_engine_vm::heap::{
    ATOM_SIZE, Allocator, Heap, SIZE_CLASS_OF_STEP, Scope, Space, barrier, shape_base,
};
use bun_engine_vm::{
    CallFrame, CellType, Cx, Gc, JsCell, ShapeId, Value, Vm, WaitResult, call, notify_at_address,
    options, wait_at_address,
};
use bun_engine_wasm_compiler::abi::{AllocatorLayout, HostLayout, Trap};
use bun_engine_wasm_format::{FuncIndex, TypeIndex};
use bun_engine_wasm_runtime::{
    Catch, Contents, Expected, Host, HostCall, HostCell, Incoming, Instance, Interrupted, Memory,
    Outgoing, Owned, Tag, Thrown, Urgency, Vm as HostVm, Waited,
};

use crate::calls::{self, Called};
use crate::exception::{self, WasmException};
use crate::function::WasmFunction;
use crate::instance_cell::WasmInstance;
use crate::namespace::{Namespace, Slot};
use crate::object_shape::ObjectShape;
use crate::owned::host_cell;
use crate::store::vm_of;
use crate::tag::WasmTag;
use crate::{global, memory, table, traps};

pub(crate) static HEAP: JsHost = JsHost;

pub(crate) struct JsHost;

/// The realm of the instance, for a method that allocates.
pub(crate) fn realm_of(instance: &Instance) -> &Cx {
    // SAFETY: an instance stays on its thread, and whoever makes the run time allocate has lent its `Cx`.
    unsafe { Cx::from_global(WasmInstance::of(instance).realm()) }
}

/// The same, for a method that runs scripts.
///
/// # Safety
/// Generated code has called the run time, and that is inside a call that has the `Cx`.
unsafe fn realm_of_running<'a>(instance: &Instance) -> &'a mut Cx {
    // SAFETY: the caller's.
    unsafe { Cx::from_global(WasmInstance::of(instance).realm()) }
}

const _: () = assert!(ATOM_SIZE == 1 << AllocatorLayout::STEP_LOG2);

// SAFETY: see the types of the cells.
unsafe impl Host for JsHost {
    fn layout(&self) -> HostLayout {
        HostLayout {
            instance_header_size: WasmInstance::HEADER_SIZE as u32,
            cell_kind: JsCell::OFFSET_OF_TYPE as i32,
            object_kind: CellType::WasmGcObject.0,
            cell_state: JsCell::OFFSET_OF_STATE as i32,
            barrier_threshold_address: barrier::threshold_address(),
            object_types: shape_base() + ObjectShape::OFFSET_OF_TYPE,
            allocators: AllocatorLayout {
                stride: size_of::<Allocator>() as u32,
                start: Allocator::OFFSET_OF_START as i32,
                end: Allocator::OFFSET_OF_END as i32,
                cell_size: Allocator::OFFSET_OF_CELL_SIZE as i32,
                class_of_step: &SIZE_CLASS_OF_STEP,
            },
            function_callable: WasmFunction::OFFSET_OF_CALLABLE as i32,
            exception_tag: WasmException::OFFSET_OF_TAG as i32,
            exception_payload: WasmException::OFFSET_OF_PAYLOAD as i32,
            vm_top_frame: Vm::OFFSET_OF_TOP_CALL_FRAME as i32,
            null_guard_size: 0,
        }
    }

    fn allocators(&self, vm: HostVm) -> usize {
        static EXHAUSTED: [usize; size_of::<Space>() / 8] = [0; _];
        match options().collect_every_n_allocations {
            0 => vm.0 + Vm::OFFSET_OF_HEAP + Heap::offset_of_field("cells"),
            _ => EXHAUSTED.as_ptr().expose_provenance(),
        }
    }

    fn allocate_object(&self, vm: HostVm, size: usize, contents: Contents) -> Option<HostCell> {
        // SAFETY: from the store, and the run time initializes the cell.
        let address = unsafe {
            let heap = &vm_of(vm).heap;
            match contents {
                Contents::Any => heap.cells.try_allocate_uninitialized(heap, size),
                Contents::Zeros => heap.cells.try_allocate_zeroed(heap, size),
            }
        };
        NonZeroUsize::new(address).map(HostCell)
    }

    fn object_type(
        &self,
        instance: &Instance,
        ty: TypeIndex,
        supertype: Option<u64>,
    ) -> Option<(u64, HostCell)> {
        // SAFETY: what this has returned, and the instance keeps the shape.
        let supertype = supertype.map(|it| unsafe { ShapeId::from_bits(it as u32).decode() });
        let ty = instance.module().types().canonical(ty);
        let shape = ObjectShape::for_type(realm_of(instance), ty, supertype.map(Gc::cast)).ok()?;
        Some((JsCell::header_for(&shape), host_cell(shape.cell())))
    }

    fn new_function(&self, instance: &Instance, func: FuncIndex) -> Option<HostCell> {
        let function = WasmFunction::create(realm_of(instance), instance, func);
        Some(host_cell(function.cell()))
    }

    fn new_exception(&self, instance: &Instance, tag: &Tag, owner: HostCell) -> Option<HostCell> {
        let cx = realm_of(instance);
        let shape = Namespace::of(cx).shape(cx, Slot::ExceptionShape);
        // SAFETY: only these own tags, and the run time fills in the payload.
        let exception = unsafe {
            let owner = Gc::<WasmTag>::from_address(owner.address());
            WasmException::try_allocate(cx, shape, tag, Some(owner))
        };
        Some(host_cell(exception?.cell()))
    }

    fn new_owner(&self, instance: &Instance, owned: Owned) -> Option<HostCell> {
        let realm = WasmInstance::of(instance).realm_of_constructor();
        let cx = realm_of(instance).in_realm_shared(realm);
        let shape = |slot| Namespace::of(cx).shape(cx, slot);
        Some(host_cell(match owned {
            Owned::Memory(it) => memory::create(cx, shape(Slot::MemoryShape), &it).cell(),
            Owned::Table(it) => table::create(cx, shape(Slot::TableShape), &it).cell(),
            Owned::Global(it) => global::create(cx, shape(Slot::GlobalShape), &it).cell(),
            Owned::Tag(it) => WasmTag::create(cx, shape(Slot::TagShape), it).cell(),
        }))
    }

    fn write_barrier(&self, _: HostVm, cell: HostCell) {
        // SAFETY: the caller keeps it alive.
        let cell = unsafe { Gc::<JsCell>::from_address(cell.address()) };
        barrier::slow_path(&cell);
    }

    fn throw_trap(&self, instance: &Instance, trap: Trap) {
        let _ = traps::throw(realm_of(instance), trap);
    }

    unsafe fn will_catch(&self, instance: &Instance, exception: HostCell) -> Result<(), Thrown> {
        // SAFETY: the caller's.
        unsafe { self.interrupt(instance) }?;
        let cx = realm_of(instance);
        if cx.has_debugger() {
            // SAFETY: the caller's.
            unsafe { self.throw(instance, exception) };
            if cx.has_pending_termination_exception() {
                return Err(Thrown);
            }
            cx.clear_exception();
        }
        Ok(())
    }

    unsafe fn throw(&self, instance: &Instance, exception: HostCell) {
        // SAFETY: the caller's.
        let (cx, exception) = unsafe {
            let exception = Gc::<WasmException>::from_address(exception.address());
            (realm_of_running(instance), exception)
        };
        let _ = cx.throw(exception.thrown_value());
        cx.notify_debugger_of_exception();
    }

    unsafe fn take_exception(
        &self,
        instance: &Instance,
        is_caught: &dyn Fn(&Tag) -> bool,
    ) -> Option<HostCell> {
        let cx = realm_of(instance);
        // What ends the whole script is caught by nothing.
        if cx.has_pending_termination_exception() {
            return None;
        }
        let value = cx.exception()?.value();
        if cx.has_pending_termination_exception()
            || !exception::tag_of_thrown_value(&value).is_some_and(is_caught)
        {
            return None;
        }
        cx.clear_exception();
        Some(host_cell(WasmException::of_thrown_value(cx, value).cell()))
    }

    unsafe fn interrupt(&self, instance: &Instance) -> Result<(), Thrown> {
        // SAFETY: the caller's.
        let cx = unsafe { realm_of_running(instance) };
        cx.check_traps().map_err(|_| Thrown)
    }

    fn must_terminate(&self, vm: HostVm) -> bool {
        // SAFETY: from the store. It only reads.
        unsafe { vm_of(vm) }.is_termination_requested()
    }

    fn terminate(&self, instance: &Instance) {
        let _ = realm_of(instance).throw_termination();
    }

    unsafe fn unwind(&self, _: HostVm, fp: usize) -> Catch {
        let address = call::throw_from_frame();
        Catch { fp, address }
    }

    fn call(&self, call: HostCall<'_>) -> Result<(), Interrupted> {
        // SAFETY: only a stub leads here.
        let cx = unsafe { realm_of_running(call.instance()) };
        match calls::call_import(cx, call) {
            Ok(Called::Returned) => Ok(()),
            Ok(Called::Suspended) => Err(Interrupted::Suspended),
            Ok(Called::Redirected) => Err(Interrupted::Redirected),
            Err(_) => Err(Interrupted::Thrown),
        }
    }

    unsafe fn put_results(
        &self,
        instance: &Instance,
        returned: u64,
        results: Outgoing<'_>,
    ) -> Result<(), Thrown> {
        // SAFETY: as above, and who jumps to the stub has a value.
        let (cx, returned) = unsafe { (realm_of_running(instance), Value::from_bits(returned)) };
        calls::put_results(cx, instance, returned, results).map_err(|_| Thrown)
    }

    unsafe fn put_arguments(
        &self,
        instance: &Instance,
        function: HostCell,
        fp: usize,
        arguments: Outgoing<'_>,
    ) -> Result<(), Thrown> {
        // SAFETY: as above, and the stub has been called like a function of a script.
        let (cx, function, frame) = unsafe {
            (
                realm_of_running(instance),
                Gc::from_address(function.address()),
                CallFrame::from_address(fp),
            )
        };
        calls::put_arguments(cx, function, frame, arguments).map_err(|_| Thrown)
    }

    unsafe fn take_results(
        &self,
        instance: &Instance,
        _: usize,
        results: Incoming<'_>,
    ) -> Result<u64, Thrown> {
        let value = calls::take_results(realm_of(instance), &results);
        value.map(Value::to_bits).map_err(|_| Thrown)
    }

    fn memory_grew(&self, vm: HostVm, memory: &Memory, old_length: u64) {
        // SAFETY: from the store. Memories grow where scripts may run.
        unsafe { memory::WasmMemory::of(memory).did_grow(vm_of(vm), old_length) };
    }

    fn report_allocation(&self, vm: HostVm, owner: HostCell, bytes: usize) {
        // SAFETY: as above, and the caller keeps the cell alive.
        let (vm, owner) = unsafe { (vm_of(vm), Gc::<JsCell>::from_address(owner.address())) };
        vm.heap.report_extra_memory_allocated(&owner, bytes);
    }

    fn module_grew(&self, instance: &Instance) {
        let module = WasmInstance::of(instance).module();
        module.report_growth(realm_of(instance));
    }

    fn collect_garbage(&self, vm: HostVm, urgency: Urgency) {
        // SAFETY: as above.
        let heap = &unsafe { vm_of(vm) }.heap;
        match urgency {
            Urgency::Soon => heap.collect_if_necessary(),
            Urgency::Now => heap.collect_and_sweep(Some(Scope::Full)),
        }
    }

    unsafe fn wait(
        &self,
        instance: &Instance,
        address: usize,
        expected: Expected,
        timeout: Option<Duration>,
    ) -> Result<Waited, Thrown> {
        let cx = realm_of(instance);
        if cx.embedder().must_not_block.get() {
            let _ = traps::throw(cx, Trap::MemoryOutOfBounds);
            return Err(Thrown);
        }
        // SAFETY: the caller's.
        let has_expected_value = || unsafe { expected.is_at(address) };
        match wait_at_address(cx, address, has_expected_value, timeout) {
            Ok(WaitResult::Ok) => Ok(Waited::Woken),
            Ok(WaitResult::NotEqual) => Ok(Waited::NotEqual),
            Ok(WaitResult::TimedOut) => Ok(Waited::TimedOut),
            Err(_) => Err(Thrown),
        }
    }

    fn notify(&self, address: usize, count: u32) -> u32 {
        notify_at_address(address, count)
    }
}
