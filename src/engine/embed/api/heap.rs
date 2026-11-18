use core::ffi::c_void;

use bun_engine_macros::export;
use bun_engine_text::{PropertyName, StringImpl};
use bun_engine_vm::heap::{
    Allocator, Callback, Heap, HeapAnalyzer, HeapObserver, HeapSizes, IsoSpace, MarkingConstraint,
    Request, RootReason, Scope, Space, WeakImpl, WeakOwner, barrier, duplicate_strong_slot,
    free_root_words, free_strong_slot, try_allocate_root_words,
};
use bun_engine_vm::{
    CellKind, Gc, GlobalObject, InternalFunction, JsCell, JsFunction, JsObject, Value, Visitor, Vm,
};

use crate::abi::returned_by_value;

returned_by_value! {
    RootReason = RootReason::None,
}

/// What classes in C++ inherit, besides the internal methods.
macro_rules! inherited {
    ($($symbol:literal = $type:ident.$method:ident($argument:ty) $(-> $result:ty)?;)*) => {$(
        const _: () = {
            #[unsafe(export_name = $symbol)]
            unsafe extern "C" fn inherited(cell: &JsCell, argument: $argument) $(-> $result)? {
                // SAFETY: the class of the cell extends the type.
                unsafe { ($type::OPS.$method)(cell, argument) }
            }
        };
    )*};
}

inherited! {
    "engine_Cell_visit_children" = JsCell.visit_children(&mut Visitor);
    "engine_Cell_estimated_size" = JsCell.estimated_size(&Vm) -> usize;
    "engine_Object_visit_children" = JsObject.visit_children(&mut Visitor);
    "engine_Object_estimated_size" = JsObject.estimated_size(&Vm) -> usize;
    "engine_Object_analyze_heap" = JsObject.analyze_heap(&mut HeapAnalyzer);
    "engine_Function_visit_children" = JsFunction.visit_children(&mut Visitor);
    "engine_InternalFunction_visit_children" = InternalFunction.visit_children(&mut Visitor);
    "engine_GlobalObject_visit_children" = GlobalObject.visit_children(&mut Visitor);
    "engine_GlobalObject_analyze_heap" = GlobalObject.analyze_heap(&mut HeapAnalyzer);
}

#[export]
unsafe fn allocator_allocate(allocator: &Allocator, heap: &Heap) -> *mut c_void {
    // SAFETY: a constructor follows.
    match unsafe { allocator.try_allocate_uninitialized(heap) } {
        0 => bun_alloc::out_of_memory(),
        cell => core::ptr::with_exposed_provenance_mut(cell),
    }
}

#[export]
unsafe fn space_try_allocate(space: &Space, heap: &Heap, size: usize) -> *mut c_void {
    // SAFETY: as above.
    core::ptr::with_exposed_provenance_mut(unsafe { space.try_allocate_uninitialized(heap, size) })
}

#[export]
fn heap_create_iso_space(
    heap: &Heap,
    size: usize,
    destroy: Option<unsafe extern "C" fn(*mut JsCell)>,
    has_output_constraints: bool,
) -> &IsoSpace {
    let space = heap.create_iso_space(size, destroy);
    if has_output_constraints {
        heap.constrain_by_cells_in(space);
    }
    space
}

#[export]
unsafe fn cell_is_live(cell: *const JsCell) -> bool {
    // SAFETY: it has not been destroyed.
    unsafe { (*cell).heap_unchecked().is_live(cell.addr()) }
}

#[export]
fn cell_lock(cell: &JsCell) {
    cell.lock_raw();
}

#[export]
fn write_barrier_slow_path(cell: &JsCell) {
    barrier::slow_path(cell);
}

#[export]
unsafe fn move_words(source: *const u64, target: *mut u64, count: usize) {
    // SAFETY: both have that many.
    unsafe { barrier::move_words(source, target, count) }
}

#[export]
fn heap_collect(heap: &Heap, scope: Option<&Scope>) {
    heap.collect(scope.copied());
}

#[export]
unsafe fn heap_request_collection(
    heap: &Heap,
    scope: Option<&Scope>,
    is_idle: bool,
    did_finish: Option<unsafe extern "C" fn(*mut c_void)>,
    context: *mut c_void,
) {
    heap.request_collection(Request {
        scope: scope.copied(),
        is_idle,
        // SAFETY: the two go together.
        did_finish: did_finish.map(|it| unsafe { Callback::new(it, context) }),
    });
}

#[export]
fn heap_report_abandoned_object_graph(heap: &Heap) {
    heap.report_abandoned_object_graph();
}

#[export]
fn heap_collect_and_sweep(heap: &Heap, scope: Option<&Scope>) {
    heap.collect_and_sweep(scope.copied());
}

#[export]
fn heap_collect_if_necessary(heap: &Heap) {
    heap.collect_if_necessary();
}

#[export]
fn heap_collect_if_deferred(heap: &Heap) {
    heap.collect_if_deferred();
}

#[export]
fn heap_collection_scope(heap: &Heap, scope: &mut Scope) -> bool {
    heap.collection_scope().map(|it| *scope = it).is_some()
}

#[export]
fn heap_set_initial_allocation_budget(heap: &Heap, bytes: usize) {
    heap.set_initial_allocation_budget(bytes);
}

#[export]
fn heap_report_extra_memory_allocated(heap: &Heap, cell: Option<&JsCell>, bytes: usize) {
    match cell {
        Some(cell) => heap.report_extra_memory_allocated(cell, bytes),
        None => heap.report_extra_memory_allocated_by_many(bytes),
    }
}

#[export]
fn heap_report_untracked_extra_memory(heap: &Heap, bytes: usize) {
    heap.report_untracked_extra_memory(bytes);
}

#[export]
unsafe fn heap_add_finalizer(
    heap: &Heap,
    cell: Gc<JsCell>,
    finalizer: unsafe extern "C" fn(*mut JsCell, *mut c_void),
    context: *mut c_void,
) {
    // SAFETY: the two go together.
    unsafe { heap.add_finalizer(cell, finalizer, context) }
}

#[export]
unsafe fn heap_add_marking_constraint(
    heap: &Heap,
    execute: unsafe extern "C" fn(*mut c_void, &mut Visitor),
    destroy: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
    depends_on_marking: bool,
) {
    // SAFETY: as above.
    let constraint =
        unsafe { MarkingConstraint::new(execute, destroy, context, depends_on_marking) };
    heap.add_marking_constraint(constraint);
}

#[export]
unsafe fn heap_add_observer(heap: &Heap, observer: &HeapObserver) {
    // SAFETY: it removes itself before it goes.
    unsafe { heap.add_observer(observer) }
}

#[export]
fn heap_remove_observer(heap: &Heap, observer: &HeapObserver) {
    heap.remove_observer(observer);
}

#[export]
fn heap_protect(heap: &Heap, value: Value) {
    heap.protect(value);
}

#[export]
fn heap_unprotect(heap: &Heap, value: Value) -> bool {
    heap.unprotect(value)
}

#[export]
unsafe fn heap_for_each_protected_cell(
    heap: &Heap,
    context: *const c_void,
    visit: unsafe extern "C" fn(*const c_void, Gc<JsCell>),
) {
    // SAFETY: the two go together.
    heap.for_each_protected_cell(|cell| unsafe { visit(context, cell) });
}

#[export]
unsafe fn heap_for_each_live_cell(
    heap: &Heap,
    context: *const c_void,
    visit: unsafe extern "C" fn(*const c_void, Gc<JsCell>),
) {
    // SAFETY: as above.
    heap.for_each_live_cell(|cell| unsafe { visit(context, cell) });
}

#[export]
fn heap_size(heap: &Heap) -> usize {
    heap.size()
}

#[export]
fn heap_sizes(heap: &Heap, sizes: &mut HeapSizes) {
    *sizes = heap.sizes();
}

#[export]
fn heap_capacity(heap: &Heap) -> usize {
    heap.capacity()
}

#[export]
fn heap_object_count(heap: &Heap) -> usize {
    heap.object_count()
}

#[export]
fn heap_block_bytes(heap: &Heap) -> usize {
    heap.block_bytes()
}

#[export]
fn heap_extra_memory_size(heap: &Heap) -> usize {
    heap.extra_memory_size()
}

#[export]
fn heap_array_buffer_size(heap: &Heap) -> usize {
    heap.array_buffer_size()
}

#[export]
fn strong_slot_allocate(vm: &Vm, value: Option<Value>) -> usize {
    vm.heap.allocate_strong_slot(Value::bits_of(value))
}

#[export]
unsafe fn strong_slot_duplicate(slot: usize) -> usize {
    // SAFETY: that of a handle.
    unsafe { duplicate_strong_slot(slot) }
}

#[export]
unsafe fn strong_slot_free(slot: usize) {
    // SAFETY: that of a handle which lets go of it.
    unsafe { free_strong_slot(slot) }
}

#[export]
unsafe fn weak_allocate(
    cell: Gc<JsCell>,
    owner: *const WeakOwner,
    context: *mut c_void,
) -> &'static WeakImpl {
    // SAFETY: C++ has the right to use the heap, and an owner outlives its handles.
    unsafe { (cell.heap_unchecked()).allocate_weak_handle(cell, owner, context) }
}

#[export]
fn root_try_allocate(words: usize) -> *mut c_void {
    try_allocate_root_words(words).cast()
}

#[export]
unsafe fn root_free(memory: *mut c_void, words: usize) {
    // SAFETY: from `root_try_allocate`.
    unsafe { free_root_words(memory.cast(), words) }
}

#[export]
fn visitor_append(visitor: &mut Visitor, cell: Gc<JsCell>) {
    visitor.append(cell);
}

#[export]
fn visitor_append_hidden(visitor: &mut Visitor, cell: Gc<JsCell>) {
    // SAFETY: a cell.
    unsafe { visitor.append_hidden_word(cell.address() as u64) }
}

#[export]
fn visitor_is_marked(visitor: &Visitor, cell: Gc<JsCell>) -> bool {
    visitor.is_marked(cell)
}

#[export]
fn visitor_add_opaque_root(visitor: &mut Visitor, root: *const c_void) -> bool {
    visitor.add_opaque_root(root)
}

#[export]
fn visitor_contains_opaque_root(visitor: &Visitor, root: *const c_void) -> bool {
    visitor.contains_opaque_root(root)
}

#[export]
fn visitor_report_extra_memory(visitor: &mut Visitor, bytes: usize) {
    visitor.report_extra_memory(bytes);
}

#[export]
fn visitor_replace_referrer(visitor: &mut Visitor, cell: usize) -> usize {
    visitor.replace_referrer(cell)
}

#[export]
fn visitor_replace_root_reason(visitor: &mut Visitor, reason: RootReason) -> RootReason {
    visitor.replace_root_reason(reason)
}

#[export]
fn analyzer_property_edge(
    analyzer: &mut HeapAnalyzer,
    from: Gc<JsCell>,
    to: Gc<JsCell>,
    name: PropertyName<'_>,
) {
    analyzer.property_edge(from, to, name);
}

#[export]
fn analyzer_index_edge(analyzer: &mut HeapAnalyzer, from: Gc<JsCell>, to: Gc<JsCell>, index: u32) {
    analyzer.index_edge(from, to, index);
}

#[export]
fn analyzer_label(analyzer: &mut HeapAnalyzer, cell: Gc<JsCell>, label: &StringImpl) {
    analyzer.label(cell, label);
}

#[export]
fn analyzer_wrapped_object(analyzer: &mut HeapAnalyzer, cell: Gc<JsCell>, wrapped: *const c_void) {
    analyzer.wrapped_object(cell, wrapped);
}
