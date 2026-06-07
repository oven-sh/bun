use bun_core::Fd;
use bun_jsc::StringJsc as _;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::virtual_machine::GCLevel;
use bun_jsc::zig_string::ZigString;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSType, JSValue, JsResult};

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
            ("napiLinkSlots", __jsc_host_napi_link_slots, 1),
            ("linkNapiModule", __jsc_host_link_napi_module, 4),
        ],
    )
}

#[bun_jsc::host_fn]
pub(crate) fn gc_aggression_level(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
pub(crate) fn array_buffer_to_string(
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
        _ => Ok(ZigString::init(array_buffer.slice()).to_js(global)),
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
#[bun_jsc::host_fn]
fn memory_footprint(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let bytes = Bun__memoryFootprint();
    if bytes == 0 {
        return Ok(JSValue::UNDEFINED);
    }
    Ok(JSValue::js_number(bytes as f64))
}

/// Return the NAPI link-slot table as an array of
/// `{ index, used, path, offset, length, hash }` so tests (and curious
/// users) can see which stub loaders are populated in the current
/// executable. This inspects the running binary's own table, not a file.
#[bun_jsc::host_fn]
fn napi_link_slots(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let slots = bun_standalone_graph::napi_link::slots();
    let arr = JSValue::create_empty_array(global, slots.len())?;
    for (i, slot) in slots.iter().enumerate() {
        let obj = JSValue::create_empty_object(global, 6);
        obj.put(
            global,
            b"index",
            JSValue::js_number_from_uint64(slot.index() as u64),
        );
        obj.put(global, b"used", JSValue::js_boolean(slot.is_used()));
        obj.put(
            global,
            b"path",
            bun_core::String::clone_utf8(slot.path_slice()).to_js(global)?,
        );
        obj.put(global, b"offset", JSValue::js_number_from_uint64(slot.offset));
        obj.put(global, b"length", JSValue::js_number_from_uint64(slot.length));
        // Hex of the hash's little-endian bytes, matching a byte-wise dump of
        // the on-disk slot.
        let mut hex = [0u8; 16];
        for (j, b) in slot.hash.to_le_bytes().iter().enumerate() {
            const DIGITS: &[u8; 16] = b"0123456789abcdef";
            hex[j * 2] = DIGITS[(b >> 4) as usize];
            hex[j * 2 + 1] = DIGITS[(b & 0xf) as usize];
        }
        obj.put(
            global,
            b"hash",
            bun_core::String::clone_utf8(&hex).to_js(global)?,
        );
        arr.put_index(global, i as u32, obj)?;
    }
    Ok(arr)
}

/// `Bun.unsafe.linkNapiModule(exePath, addonPath, virtualPath, outPath)`
/// Post-process a `bun build --compile` executable: append the Mach-O
/// `.node` image at `addonPath` into the `__BUN,__bun` section and stamp the
/// first free stub slot so that `process.dlopen(virtualPath)` inside the
/// resulting binary resolves to it. Writes the result to `outPath` (which
/// may equal `exePath`). Mach-O only for now.
#[bun_jsc::host_fn]
fn link_napi_module(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_jsc::SysErrorJsc as _;
    use bun_standalone_graph::napi_link::{self, LinkError, Slot};

    if frame.arguments_count() < 4 {
        return Err(global.throw_invalid_arguments(format_args!(
            "linkNapiModule(exePath, addonPath, virtualPath, outPath) requires 4 arguments"
        )));
    }
    let [exe_arg, addon_arg, vpath_arg, out_arg] = frame.arguments_as_array::<4>();
    let exe_path = exe_arg.to_slice_or_null(global)?;
    let addon_path = addon_arg.to_slice_or_null(global)?;
    let virtual_path = vpath_arg.to_slice_or_null(global)?;
    let out_path = out_arg.to_slice_or_null(global)?;

    let exe_bytes = match bun_sys::File::openat(Fd::cwd(), exe_path.slice(), bun_sys::O::RDONLY, 0)
        .and_then(|f| f.read_to_end())
    {
        Ok(b) => b,
        Err(e) => return Err(e.with_path(exe_path.slice()).throw(global)),
    };
    let addon_bytes =
        match bun_sys::File::openat(Fd::cwd(), addon_path.slice(), bun_sys::O::RDONLY, 0)
            .and_then(|f| f.read_to_end())
        {
            Ok(b) => b,
            Err(e) => return Err(e.with_path(addon_path.slice()).throw(global)),
        };

    let out_bytes = match napi_link::link_into_macho(&exe_bytes, &addon_bytes, virtual_path.slice())
    {
        Ok(b) => b,
        Err(LinkError::UnsupportedExecutableFormat) => {
            return Err(global.throw(format_args!(
                "linkNapiModule: executable is not a Mach-O file (only macOS targets are supported for now)"
            )));
        }
        Err(LinkError::NotStandaloneExecutable) => {
            return Err(global.throw(format_args!(
                "linkNapiModule: executable was not produced by `bun build --compile`"
            )));
        }
        Err(LinkError::NoFreeSlot) => {
            return Err(global.throw(format_args!(
                "linkNapiModule: all {} NAPI link slots are in use",
                Slot::COUNT
            )));
        }
        Err(LinkError::PathTooLong) => {
            return Err(global.throw(format_args!(
                "linkNapiModule: virtual path must be < 224 bytes"
            )));
        }
        Err(LinkError::SlotTableMissing) => {
            return Err(global.throw(format_args!(
                "linkNapiModule: executable has no NAPI link slot table (was it built with an older bun?)"
            )));
        }
    };

    let out_file = match bun_sys::File::openat(
        Fd::cwd(),
        out_path.slice(),
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
        0o755,
    ) {
        Ok(f) => f,
        Err(e) => return Err(e.with_path(out_path.slice()).throw(global)),
    };
    if let Err(e) = out_file.write_all(&out_bytes) {
        return Err(e.with_path(out_path.slice()).throw(global));
    }

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn dump_mimalloc(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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
    Ok(JSValue::UNDEFINED)
}
