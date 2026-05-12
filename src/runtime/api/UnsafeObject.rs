use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSType, JSValue, JsResult};
use bun_jsc::virtual_machine::GCLevel;
use bun_jsc::zig_string::ZigString;
use bun_jsc::ZigStringJsc as _;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 3);
    // Zig used a comptime anonymous struct + std.meta.fieldNames to iterate (name, fn) pairs.
    // In Rust the elements share a type, so a const array + plain `for` is the direct mapping.
    // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw `JSHostFn` ABI,
    // which is what `JSFunction::create` expects.
    const FIELDS: &[(&str, JSHostFn)] = &[
        ("gcAggressionLevel", __jsc_host_gc_aggression_level),
        ("arrayBufferToString", __jsc_host_array_buffer_to_string),
        ("mimallocDump", __jsc_host_dump_mimalloc),
        ("heapStats", __jsc_host_heap_stats),
        ("heapStatsTrace", __jsc_host_heap_stats_trace),
        ("bmallocScavenge", __jsc_host_bmalloc_scavenge),
    ];
    for &(name, func) in FIELDS {
        object.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, func, 1, Default::default()),
        );
    }
    object
}

#[bun_jsc::host_fn]
pub fn gc_aggression_level(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global;
    // we hold no other Rust borrow of the VM across these accesses.
    let vm = global.bun_vm().as_mut();
    let ret = JSValue::js_number(vm.aggressive_garbage_collection as i32 as f64);
    let value = frame.arguments_old::<1>().ptr[0];

    if !value.is_empty_or_undefined_or_null() {
        match value.coerce::<i32>(global)? {
            1 => vm.aggressive_garbage_collection = GCLevel::Mild,
            2 => vm.aggressive_garbage_collection = GCLevel::Aggressive,
            0 => vm.aggressive_garbage_collection = GCLevel::None,
            _ => {}
        }
    }
    Ok(ret)
}

#[bun_jsc::host_fn]
pub fn array_buffer_to_string(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let args_buf = frame.arguments_old::<2>();
    let args = args_buf.slice();
    if args.len() < 1 || !args[0].is_cell() || !args[0].js_type().is_typed_array_or_array_buffer() {
        return Err(global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    }

    let array_buffer = jsc::ArrayBuffer::from_typed_array(global, args[0]);
    match array_buffer.typed_array_type {
        JSType::Uint16Array | JSType::Int16Array => {
            // Uint16Array/Int16Array storage is u16-aligned with even byte length;
            // bytemuck checks both at runtime.
            let utf16: &[u16] = bytemuck::cast_slice(array_buffer.byte_slice());
            let zig_str = ZigString::init_utf16(utf16);
            Ok(zig_str.to_js(global))
        }
        _ => {
            Ok(ZigString::init(array_buffer.slice()).to_js(global))
        }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    safe fn dump_zone_malloc_stats();
    // src/jsc/bindings/c-bindings.cpp — wraps libpas's
    // `pas_all_heaps_compute_total_non_utility_summary()` under the global
    // pas_heap_lock. Reports zeros on non-libpas builds.
    fn Bun__bmallocHeapStats(
        allocated: *mut usize,
        committed: *mut usize,
        free: *mut usize,
        decommitted: *mut usize,
    );
    // src/jsc/bindings/c-bindings.cpp — `WTF::releaseFastMallocFreeMemory()`
    // (process-wide `bmalloc::api::scavenge()`). Forces libpas to synchronously
    // decommit free pages so that on Darwin — where decommit is
    // `madvise(MADV_FREE_REUSABLE)` and pages otherwise stay in RSS until kernel
    // memory pressure — `process.memoryUsage.rss()` becomes comparable to Linux
    // (`MADV_DONTNEED`). `Bun.gc(true)` does NOT do this; it only runs
    // `mimalloc_cleanup` + JSC GC. NOT `JSC__VM__shrinkFootprint`, which also
    // calls `deleteAllCode` and would perturb the code-cache state under test.
    safe fn Bun__bmallocScavenge();
    // src/jsc/bindings/ZigSourceProvider.cpp — atomic live-instance count of
    // Zig::SourceProvider. Per-iter delta after `delete require.cache[k]` + GC
    // is the proof that JSModuleRecord/ModuleProgramExecutable actually drop
    // their RefPtr<SourceProvider> (i.e. removeEntry → GC sweeps the record →
    // ~JSModuleRecord frees m_sourceCode/m_exportEntries). One steady-state
    // survivor is expected: vm.codeCache() pins iteration-0's provider via the
    // SourceCodeKey it stores. Flat per-iter ⇒ the 31KB/iter darwin RSS is
    // libpas page retention (MADV_FREE_REUSABLE doesn't drop RSS), not a ref.
    safe fn Bun__ZigSourceProvider_liveCount() -> usize;
}

/// `Bun.unsafe.heapStats()` — leak-instrumentation accessor for tests.
///
/// Returns `{ mimallocCommit, mimallocRss, mimallocPageFaults,
/// bunStringRefBalance, liveArenaHeaps, bmallocAllocated, bmallocCommitted,
/// bmallocFree, bmallocDecommitted }`. All numbers are process-wide
/// snapshots; the *per-iteration delta* of each is the leak signal:
///
/// - `bunStringRefBalance`: net +1 refs the Rust side currently holds against
///   `WTF::StringImpl` (every `bun_string::String` create/ref minus every
///   deref/transfer). Linear per-iter growth = forgotten `.deref()` on the
///   Rust side. NOTE: a few uninstrumented FFI handoff paths (out-param writes
///   to C++) make the *absolute* value drift, but the per-iteration delta on a
///   tight loop is exact for that loop's code path.
/// - `mimallocCommit`/`mimallocRss`: `mi_process_info()` totals — covers
///   `bun.default_allocator`, `MimallocArena` (AstAlloc, transpile arena),
///   and anything else routed through mimalloc. Does **not** include
///   `WTF::fastMalloc` (bmalloc), so a BunString leak shows up only in
///   `bunStringRefBalance` and process RSS, not here.
/// - `bmallocAllocated`/`bmallocCommitted`/`bmallocFree`/`bmallocDecommitted`:
///   libpas `pas_all_heaps_compute_total_non_utility_summary()` — covers
///   every `WTF::fastMalloc` / IsoHeap / Gigacage allocation: `StringImpl`,
///   `AtomStringTable` entries, `SourceProvider` source buffers,
///   `UnlinkedCodeBlock`, JSC `Structure`s, etc. Per-iter `bmallocAllocated`
///   growth = retained-in-bmalloc bytes the GC heap and mimalloc can't see.
///   `bmallocCommitted − bmallocAllocated − bmallocFree` ≈ metadata overhead.
///   Reports 0 on non-libpas builds (e.g. `USE_SYSTEM_MALLOC`). Walks every
///   heap under the global pas_heap_lock (no scavenge), so call sparingly.
/// - `liveArenaHeaps`: debug-only count of live `MimallocArena` heaps
///   (`mi_heap_new` − `mi_heap_destroy`). 0 in release builds.
#[bun_jsc::host_fn]
fn heap_stats(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let mut elapsed = 0usize;
    let mut user = 0usize;
    let mut system = 0usize;
    let mut current_rss = 0usize;
    let mut peak_rss = 0usize;
    let mut current_commit = 0usize;
    let mut peak_commit = 0usize;
    let mut page_faults = 0usize;
    // SAFETY: all out-params are valid stack `usize` slots.
    unsafe {
        bun_alloc::mimalloc::mi_process_info(
            &mut elapsed,
            &mut user,
            &mut system,
            &mut current_rss,
            &mut peak_rss,
            &mut current_commit,
            &mut peak_commit,
            &mut page_faults,
        );
    }

    let mut bmalloc_allocated = 0usize;
    let mut bmalloc_committed = 0usize;
    let mut bmalloc_free = 0usize;
    let mut bmalloc_decommitted = 0usize;
    // SAFETY: all out-params are valid stack `usize` slots; the C++ shim
    // unconditionally writes all four (zeros on non-libpas builds).
    unsafe {
        Bun__bmallocHeapStats(
            &mut bmalloc_allocated,
            &mut bmalloc_committed,
            &mut bmalloc_free,
            &mut bmalloc_decommitted,
        );
    }

    let obj = JSValue::create_empty_object(global, 10);
    obj.put(global, b"mimallocCommit", JSValue::js_number(current_commit as f64));
    obj.put(global, b"mimallocRss", JSValue::js_number(current_rss as f64));
    obj.put(global, b"mimallocPageFaults", JSValue::js_number(page_faults as f64));
    obj.put(
        global,
        b"bunStringRefBalance",
        JSValue::js_number(bun_string::rust_wtf_ref_balance() as f64),
    );
    obj.put(
        global,
        b"liveArenaHeaps",
        JSValue::js_number(bun_alloc::live_arena_heaps() as f64),
    );
    obj.put(global, b"bmallocAllocated", JSValue::js_number(bmalloc_allocated as f64));
    obj.put(global, b"bmallocCommitted", JSValue::js_number(bmalloc_committed as f64));
    obj.put(global, b"bmallocFree", JSValue::js_number(bmalloc_free as f64));
    obj.put(global, b"bmallocDecommitted", JSValue::js_number(bmalloc_decommitted as f64));
    obj.put(
        global,
        b"zigSourceProviderLive",
        JSValue::js_number(Bun__ZigSourceProvider_liveCount() as f64),
    );
    Ok(obj)
}

/// `Bun.unsafe.bmallocScavenge()` — force libpas to synchronously decommit free
/// pages (process-wide `WTF::releaseFastMallocFreeMemory()`).
///
/// Call after `Bun.gc(true)` and before sampling `process.memoryUsage.rss()` in
/// leak tests. On Darwin, libpas decommits via `madvise(MADV_FREE_REUSABLE)`
/// (vendor/WebKit/Source/bmalloc/libpas/src/libpas/pas_page_malloc.c:463), so
/// freed pages stay in RSS until the kernel reclaims them under pressure; on
/// Linux it uses `MADV_DONTNEED`, which drops RSS immediately. Without this
/// call, the same correctly-freed allocation pattern reports +31 KB/iter RSS on
/// macOS and ~0 on Linux. `Bun.gc(true)` only runs `mimalloc_cleanup` + JSC GC
/// and never touches the libpas scavenger.
#[bun_jsc::host_fn]
fn bmalloc_scavenge(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Bun__bmallocScavenge();
    Ok(JSValue::UNDEFINED)
}

/// `Bun.unsafe.heapStatsTrace(enable?)` — debug-only per-callsite ref trace.
///
/// `heapStatsTrace(true)` arms tracing; subsequent `heapStatsTrace()` (no
/// arg) drains and returns `[{net, site:"file:line"}]` aggregated since the
/// last drain. Release builds return `[]`.
#[bun_jsc::host_fn]
fn heap_stats_trace(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arg0 = frame.argument(0);
    if arg0.is_boolean() {
        bun_string::rust_wtf_ref_trace_enable(arg0.to_boolean());
        return Ok(JSValue::UNDEFINED);
    }
    let entries = bun_string::rust_wtf_ref_trace_drain();
    let arr = jsc::JSArray::create_empty(global, entries.len()).map_err(|_| jsc::JsError::Thrown)?;
    for (i, (net, site)) in entries.into_iter().enumerate() {
        let row = JSValue::create_empty_object(global, 2);
        row.put(global, b"net", JSValue::js_number(net as f64));
        row.put(
            global,
            b"site",
            jsc::ZigString::init_utf8(site.as_bytes()).to_js(global),
        );
        // SAFETY: `i < entries.len()` and `arr` was sized to `entries.len()`.
        unsafe { arr.put_index(global, i as u32, row) };
    }
    Ok(arr.into())
}

#[bun_jsc::host_fn]
fn dump_mimalloc(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global.
    let _vm = global.bun_vm();
    // TODO(port): blocked_on: bun_alloc::Arena::dump_stats — `VirtualMachine.arena` is now
    // `Option<NonNull<bumpalo::Bump>>` and bumpalo has no `dump_stats()`; the original
    // mimalloc-arena stat dump needs a dedicated shim once the arena type lands.
    if bun_alloc::heap_breakdown::ENABLED {
        dump_zone_malloc_stats();
    }
    Ok(JSValue::UNDEFINED)
}

// ported from: src/runtime/api/UnsafeObject.zig
