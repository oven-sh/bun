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
}

/// `Bun.unsafe.heapStats()` — leak-instrumentation accessor for tests.
///
/// Returns `{ mimallocCommit, mimallocRss, mimallocPageFaults,
/// bunStringRefBalance, liveArenaHeaps }`. All numbers are process-wide
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

    let obj = JSValue::create_empty_object(global, 5);
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
    Ok(obj)
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
