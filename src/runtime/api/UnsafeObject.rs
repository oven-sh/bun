use bun_jsc::ZigStringJsc as _;
use bun_jsc::virtual_machine::GCLevel;
use bun_jsc::zig_string::ZigString;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSType, JSValue, JsResult};

pub fn create(global: &JSGlobalObject) -> JSValue {
    // NB: helper sizes inline capacity from `fns.len()`, fixing the prior
    // `len = 3` vs 4-entry drift.
    jsc::create_host_function_object(
        global,
        &[
            ("gcAggressionLevel", __jsc_host_gc_aggression_level, 1),
            ("arrayBufferToString", __jsc_host_array_buffer_to_string, 1),
            ("mimallocDump", __jsc_host_dump_mimalloc, 1),
            ("memoryFootprint", __jsc_host_memory_footprint, 1),
        ],
    )
}

#[bun_jsc::host_fn]
pub fn gc_aggression_level(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
pub fn array_buffer_to_string(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
        _ => Ok(ZigString::init(array_buffer.slice()).to_js(global)),
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    safe fn dump_zone_malloc_stats();
    safe fn Bun__memoryFootprint() -> usize;
}

/// Accurate per-process memory footprint in bytes. Unlike RSS this excludes
/// pages already returned to the OS that the kernel keeps mapped lazily
/// (Darwin's `MADV_FREE_REUSABLE`), so leak tests are platform-comparable.
/// Backed by `task_info(TASK_VM_INFO).phys_footprint` (Darwin), `Pss:` from
/// `/proc/self/smaps_rollup` (Linux), `PrivateUsage` (Windows). Returns
/// `undefined` when no platform-specific accessor is available so the caller
/// can `?? process.memoryUsage.rss()`.
#[bun_jsc::host_fn]
fn memory_footprint(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let bytes = Bun__memoryFootprint();
    if bytes == 0 {
        return Ok(JSValue::UNDEFINED);
    }
    Ok(JSValue::js_number(bytes as f64))
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
