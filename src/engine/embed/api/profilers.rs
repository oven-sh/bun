use core::ffi::{c_char, c_void};
use core::mem::ManuallyDrop;

use bun_engine_inspector::profiling::{
    AnyRealm, BlockRange, CodeRange, Coverage, Gaps, HeapProfiler, SamplingProfiler, SnapshotKind,
    class_name, count_cells, count_protected_cells,
};
use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{
    Executable, FastHashSet, Gc, JsCell, LineColumn, ScriptExecutable, SourceProvider, Vm,
};

#[export]
fn coverage_enable(vm: &Vm) {
    Coverage::of(vm).enable(vm);
}

#[export]
fn coverage_is_enabled(vm: &Vm) -> bool {
    vm.collects_coverage().get()
}

#[export]
unsafe fn coverage_blocks(
    vm: &Vm,
    source_id: usize,
    with_gaps: bool,
    context: *mut c_void,
    take: unsafe extern "C" fn(*mut c_void, *const BlockRange, usize),
) {
    let gaps = if with_gaps { Gaps::With } else { Gaps::Without };
    let blocks = Coverage::of(vm).blocks(source_id, gaps);
    // SAFETY: the two go together.
    unsafe { take(context, blocks.as_ptr(), blocks.len()) }
}

#[export]
unsafe fn coverage_code_ranges(
    vm: &Vm,
    source_id: usize,
    context: *mut c_void,
    take: unsafe extern "C" fn(*mut c_void, *const CodeRange, usize),
) {
    let ranges = Coverage::of(vm).code_ranges(source_id);
    // SAFETY: as above.
    unsafe { take(context, ranges.as_ptr(), ranges.len()) }
}

#[export]
unsafe fn coverage_source_providers(
    vm: &Vm,
    context: *mut c_void,
    add: unsafe extern "C" fn(*mut c_void, &SourceProvider),
) {
    let mut seen = FastHashSet::default();
    vm.heap.for_each_live_cell(|cell| {
        if let Some(executable) = cell.downcast::<ScriptExecutable>()
            && seen.insert(executable.provider().id())
        {
            // SAFETY: as above.
            unsafe { add(context, executable.anchor().provider()) }
        }
    });
}

#[export]
unsafe fn heap_count_cells(
    vm: &Vm,
    only_protected: bool,
    context: *mut c_void,
    add: unsafe extern "C" fn(*mut c_void, *const c_char, usize),
) {
    let counts = if only_protected {
        count_protected_cells(vm)
    } else {
        count_cells(vm)
    };
    for (name, count) in counts {
        // SAFETY: as above.
        unsafe { add(context, name.as_str().as_ptr().cast(), count) }
    }
}

#[export]
fn heap_counted_name(cell: &JsCell) -> *const c_char {
    class_name(cell).as_str().as_ptr().cast()
}

#[export]
fn heap_profiler_has_snapshot(vm: &Vm) -> bool {
    HeapProfiler::of(vm).has_snapshot()
}

#[export]
fn heap_profiler_clear_snapshots(vm: &Vm) {
    HeapProfiler::of(vm).clear_snapshots();
}

#[export]
unsafe fn heap_snapshot(vm: &Vm, is_for_debugging: bool) -> Option<StringRef> {
    let kind = if is_for_debugging {
        SnapshotKind::GcDebugging
    } else {
        SnapshotKind::Inspector
    };
    // SAFETY: C++ has the right to run scripts, and lends it for the call.
    let mut realms = unsafe { AnyRealm::assume(vm) };
    (HeapProfiler::of(vm).snapshot(&mut realms, kind, &|_| true)).ok()
}

#[export]
unsafe fn heap_v8_snapshot(vm: &Vm) -> Option<StringRef> {
    // SAFETY: as above.
    let mut realms = unsafe { AnyRealm::assume(vm) };
    HeapProfiler::of(vm).v8_snapshot(&mut realms).ok()
}

/// C++ frees them.
#[export]
unsafe fn heap_v8_snapshot_bytes(vm: &Vm, length: &mut usize) -> *mut u8 {
    // SAFETY: as above.
    let mut realms = unsafe { AnyRealm::assume(vm) };
    let Ok(bytes) = HeapProfiler::of(vm).v8_snapshot_bytes(&mut realms) else {
        *length = 0;
        return core::ptr::null_mut();
    };
    *length = bytes.len();
    ManuallyDrop::new(bytes).as_mut_ptr()
}

#[export]
fn total_compile_seconds() -> f64 {
    bun_engine_vm::code::total_compile_seconds()
}

#[export]
fn sampling_profiler_exists(vm: &Vm) -> bool {
    SamplingProfiler::exists(vm)
}

#[export]
fn sampling_profiler_set_interval(vm: &Vm, microseconds: f64) {
    SamplingProfiler::set_interval_microseconds(vm, microseconds);
}

#[export]
fn sampling_profiler_start(vm: &Vm) {
    SamplingProfiler::start(vm);
}

#[export]
fn sampling_profiler_pause(vm: &Vm) {
    SamplingProfiler::pause(vm);
}

#[export]
fn sampling_profiler_clear(vm: &Vm) {
    SamplingProfiler::clear(vm);
}

/// A frame has a name, an executable, the start of its code and where in the code it was.
#[export]
unsafe fn sampling_profiler_release_traces(
    vm: &Vm,
    context: *mut c_void,
    add_trace: unsafe extern "C" fn(*mut c_void, f64, usize),
    add_frame: unsafe extern "C" fn(
        *mut c_void,
        &StringImpl,
        Option<Gc<Executable>>,
        Option<&LineColumn>,
        Option<&LineColumn>,
    ),
) {
    for trace in SamplingProfiler::take_profile(vm).traces() {
        // SAFETY: they go together.
        unsafe { add_trace(context, trace.timestamp, trace.frames().count()) };
        for frame in trace.frames() {
            let (name, executable) = (frame.name(), frame.executable());
            let (start, position) = (frame.start_of_code(), frame.position());
            // SAFETY: as above.
            unsafe { add_frame(context, name, executable, start.as_ref(), position.as_ref()) };
        }
    }
}

#[export]
fn sampling_profiler_take_traces_as_json(vm: &Vm) -> Option<StringRef> {
    SamplingProfiler::take_traces_as_json(vm).ok()
}

#[export]
fn sampling_profiler_top_functions(vm: &Vm) -> StringRef {
    SamplingProfiler::top_functions_report(vm)
}

#[export]
fn sampling_profiler_top_bytecodes(vm: &Vm) -> StringRef {
    SamplingProfiler::top_bytecodes_report(vm)
}
