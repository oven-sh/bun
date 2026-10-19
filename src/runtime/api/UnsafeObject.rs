use bun_core::EncodedSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::virtual_machine::{GCLevel, VirtualMachine};
use bun_jsc::{self as jsc, JSType, JSValue, JsResult};

pub(crate) fn gc_aggression_level(level: Option<f64>) -> i32 {
    let vm = VirtualMachine::get().as_mut();
    let previous = vm.aggressive_garbage_collection as i32;
    match level.map(|level| level as i32) {
        Some(1) => vm.aggressive_garbage_collection = GCLevel::Mild,
        Some(2) => vm.aggressive_garbage_collection = GCLevel::Aggressive,
        Some(0) => vm.aggressive_garbage_collection = GCLevel::None,
        _ => {}
    }
    previous
}

pub(crate) fn array_buffer_to_string<'a>(
    cx: &mut JsScope<'a>,
    buffer: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let buffer = buffer.to_js();
    if !buffer.is_cell() || !buffer.js_type().is_typed_array_or_array_buffer() {
        return Err(global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    }

    let array_buffer = jsc::ArrayBuffer::from_typed_array(global, buffer);
    match array_buffer.typed_array_type {
        // The empty slice of a detached view is not aligned.
        JSType::Uint16Array | JSType::Int16Array if !array_buffer.byte_slice().is_empty() => {
            // Uint16Array/Int16Array storage is u16-aligned with even byte length;
            // bytemuck checks both at runtime.
            let utf16: &[u16] = bytemuck::cast_slice(array_buffer.byte_slice());
            Ok(EncodedSlice::utf16(utf16).to_js(global))
        }
        _ => Ok(EncodedSlice::latin1(array_buffer.slice()).to_js(global)),
    }
}

unsafe extern "C" {
    safe fn dump_zone_malloc_stats();
    safe fn Bun__memoryFootprint() -> usize;
}

/// Accurate per-process memory footprint in bytes.
/// Backed by `task_info(TASK_VM_INFO).phys_footprint` (Darwin), `Pss:` from
/// `/proc/self/smaps_rollup` (Linux), `PrivateUsage` (Windows). Returns
/// `undefined` when no platform-specific accessor is available so the caller
/// can `?? process.memoryUsage.rss()`.
pub(crate) fn memory_footprint() -> Option<usize> {
    match Bun__memoryFootprint() {
        0 => None,
        bytes => Some(bytes),
    }
}

pub(crate) fn set_jit_policy(cx: &mut JsScope<'_>, scale: f64) -> JsResult<()> {
    let global = cx.global();
    if !(scale.is_finite() && scale >= 1.0) {
        return Err(global.throw_range_error(
            scale,
            jsc::RangeErrorOptions {
                field_name: b"scale",
                msg: b"a finite number >= 1",
                ..Default::default()
            },
        ));
    }
    global.vm().set_startup_jit_deferral_scale(scale);
    Ok(())
}

pub(crate) fn mimalloc_dump() {
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
}
