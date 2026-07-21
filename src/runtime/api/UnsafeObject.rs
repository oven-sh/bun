use bun_jsc::ZigStringJsc as _;
use bun_jsc::virtual_machine::GCLevel;
use bun_jsc::zig_string::ZigString;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSType, JSValue, JsResult, Local, Scope};

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
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

#[bun_jsc::host_fn(scoped)]
pub(crate) fn gc_aggression_level<'s>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global;
    // we hold no other Rust borrow of the VM across these accesses.
    let vm = scope.bun_vm().as_mut();
    let ret = scope.number(vm.aggressive_garbage_collection as i32 as f64);
    let value = frame.scoped_argument(scope, 0);

    if !value.is_undefined_or_null() {
        match value.coerce::<i32>(scope)? {
            1 => vm.aggressive_garbage_collection = GCLevel::Mild,
            2 => vm.aggressive_garbage_collection = GCLevel::Aggressive,
            0 => vm.aggressive_garbage_collection = GCLevel::None,
            _ => {}
        }
    }
    Ok(ret)
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn array_buffer_to_string<'s>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    let args = frame.scoped_arguments::<2>(scope);
    let Some(arg) = args.get(0) else {
        return Err(scope.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    };
    if !arg.is_cell() || !arg.js_type().is_typed_array_or_array_buffer() {
        return Err(scope.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    }

    let array_buffer = jsc::ArrayBuffer::from_typed_array(global, arg.unscoped());
    match array_buffer.typed_array_type {
        JSType::Uint16Array | JSType::Int16Array => {
            // Uint16Array/Int16Array storage is u16-aligned with even byte length;
            // bytemuck checks both at runtime.
            let utf16: &[u16] = bytemuck::cast_slice(array_buffer.byte_slice());
            let zig_str = ZigString::init_utf16(utf16);
            Ok(scope.local(zig_str.to_js(global)))
        }
        _ => Ok(scope.local(ZigString::init(array_buffer.slice()).to_js(global))),
    }
}

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
#[bun_jsc::host_fn(scoped)]
fn memory_footprint<'s>(scope: &mut Scope<'s>, _frame: &CallFrame) -> JsResult<Local<'s>> {
    let bytes = Bun__memoryFootprint();
    if bytes == 0 {
        return Ok(scope.undefined());
    }
    Ok(scope.number(bytes as f64))
}

#[bun_jsc::host_fn(scoped)]
fn dump_mimalloc<'s>(scope: &mut Scope<'s>, _frame: &CallFrame) -> JsResult<Local<'s>> {
    // Print the process-wide mimalloc stats to stderr via
    // `mi_stats_print_out` directly.
    extern "C" fn dump(text: *const core::ffi::c_char, _arg: *mut core::ffi::c_void) {
        // SAFETY: mimalloc passes a valid NUL-terminated string.
        let text = unsafe { core::ffi::CStr::from_ptr(text) };
        let _ = bun_core::Output::error_writer().write_all(text.to_bytes());
    }
    // SAFETY: `dump` matches `mi_output_fun` and does not unwind.
    unsafe { bun_alloc::mimalloc::mi_stats_print_out(Some(dump), core::ptr::null_mut()) };
    bun_core::Output::flush();
    if bun_alloc::heap_breakdown::ENABLED {
        dump_zone_malloc_stats();
    }
    Ok(scope.undefined())
}
