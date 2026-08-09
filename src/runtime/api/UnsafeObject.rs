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
            ("snapshot", __jsc_host_snapshot, 1),
            ("snapshotState", __jsc_host_snapshot_state, 0),
            ("recleanImagePages", __jsc_host_reclean_image_pages, 0),
            ("embedImage", __jsc_host_embed_image, 3),
        ],
    )
}

/// `Bun.unsafe.snapshot(path)`: the caller has quiesced the app; leave JS via an uncatchable termination and write a heap image
/// from the top of the event loop, then exit. A process started from that image resumes in the event loop and gets
/// `process.emit("restore")` before its first tick. Never returns normally.
#[bun_jsc::host_fn]
fn snapshot(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [path, opts] = frame.arguments_as_array::<2>();
    if !path.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "snapshot(path, {{ cancelTimers, keepTimers, envGate }}) expects a file path"
        )));
    }
    if opts.is_object() {
        if let Some(v) = opts.get(global, "cancelTimers")? {
            bun_core::image::set_cancel_timers_at_snapshot(v.to_boolean());
        }
        if let Some(v) = opts.get(global, "keepTimers")? {
            bun_core::image::set_keep_timers_at_snapshot(v.to_boolean());
        }
        // envGate: names of environment variables the imaged boot depended on. The image records their values (or
        // absence) at build time and is only restored by processes whose environment agrees; anything else boots normally.
        if let Some(names) = opts.get(global, "envGate")? {
            if !names.is_undefined_or_null() {
                let mut it = names.array_iterator(global)?;
                let mut joined: Vec<u8> = Vec::new();
                while let Some(name) = it.next()? {
                    let name = name.to_bun_string(global)?.to_owned_slice();
                    if name.is_empty()
                        || bun_core::strings::contains_char(&name, 0)
                        || bun_core::strings::contains_char(&name, b'=')
                    {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "snapshot: envGate entries must be non-empty variable names"
                        )));
                    }
                    joined.extend_from_slice(&name);
                    joined.push(0);
                }
                Bun__imageSetEnvGate(joined.as_ptr(), joined.len());
            }
        }
    }
    let path = path.to_bun_string(global)?.to_owned_slice();
    let cpath = std::ffi::CString::new(path)
        .map_err(|_| global.throw_invalid_arguments(format_args!("path contains NUL")))?;
    // SAFETY: `cpath` is NUL-terminated and outlives the call.
    unsafe { crate::cli::run_command::Bun__requestSnapshot(global.vm(), cpath.as_ptr()) };
    // Unwind every JS frame right now; the outermost EventLoop::tick sees the request and writes the image.
    JSC__VM__throwTerminationExceptionNow(global);
    Err(jsc::JsError::Thrown)
}

unsafe extern "C" {
    safe fn JSC__VM__throwTerminationExceptionNow(global: &JSGlobalObject) -> JSValue;
    /// NUL-separated variable names; copied by the callee.
    safe fn Bun__imageSetEnvGate(names: *const u8, len: usize);
}

/// `Bun.unsafe.recleanImagePages()`: in a process restored from an image, hand pages whose contents drifted back to the
/// image's bytes (transient writes: locks, refcounts) back to the clean file mapping. Cheap (~10ms); call when idle.
#[bun_jsc::host_fn]
fn reclean_image_pages(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if bun_core::image::restored() {
        Bun__imageRecleanPages(global.vm());
    }
    Ok(JSValue::UNDEFINED)
}

unsafe extern "C" {
    safe fn Bun__imageRecleanPages(vm: &bun_jsc::VM);
}

/// `Bun.unsafe.snapshotState()` -> `{ building: boolean, epoch: number }` (epoch 0 = normal boot, N = resumed from an image N times).
#[bun_jsc::host_fn]
fn snapshot_state(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 2);
    obj.put(
        global,
        b"building",
        JSValue::from(bun_core::image::building()),
    );
    obj.put(
        global,
        b"epoch",
        JSValue::js_number(bun_core::image::epoch() as f64),
    );
    Ok(obj)
}

#[bun_jsc::host_fn]
fn gc_aggression_level(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for a Bun-owned global;
    // we hold no other Rust borrow of the VM across these accesses.
    let vm = global.bun_vm().as_mut();
    let ret = JSValue::js_number(vm.aggressive_garbage_collection as i32 as f64);
    let [value] = frame.arguments_as_array::<1>();

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
fn array_buffer_to_string(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
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

/// `Bun.unsafe.embedImage(exePath, imagePath, outPath?)`: what `bun build --compile --compile-image` does in its second pass, for build
/// pipelines that compile via `Bun.build({ compile })`: embed a raw heap image (written by running the executable with `BUN_IMAGE_OUT`)
/// into the compiled executable's section payload so the single file restores from itself. `outPath` defaults to overwriting `exePath`.
#[bun_jsc::host_fn]
fn embed_image(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [exe, img, out] = frame.arguments_as_array::<3>();
    if !exe.is_string() || !img.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "embedImage(exePath, imagePath, outPath?) expects string paths"
        )));
    }
    let exe_path = exe.to_bun_string(global)?.to_owned_slice();
    let img_path = img.to_bun_string(global)?.to_owned_slice();
    let out_path = if out.is_string() {
        out.to_bun_string(global)?.to_owned_slice()
    } else {
        exe_path.clone()
    };
    let image = match bun_sys::File::openat(bun_sys::Fd::cwd(), &img_path, bun_sys::O::RDONLY, 0)
        .and_then(|f| f.read_to_end())
    {
        Ok(b) => b,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "embedImage: cannot read {}: {}",
                bstr::BStr::new(&img_path),
                e
            )));
        }
    };
    let (dir, name) = match bun_core::strings::last_index_of_char(&out_path, b'/') {
        Some(i) => (&out_path[..i.max(1)], &out_path[i + 1..]),
        None => (&b"."[..], &out_path[..]),
    };
    let dir_fd = match bun_sys::open_dir_at(bun_sys::Fd::cwd(), dir) {
        Ok(fd) => fd,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "embedImage: cannot open directory {}: {:?}",
                bstr::BStr::new(dir),
                e
            )));
        }
    };
    let vm = global.bun_vm();
    // SAFETY: process-lifetime loader owned by the VM.
    let env = unsafe { &mut *vm.transpiler.env };
    match bun_standalone_graph::StandaloneModuleGraph::embed_image_into_executable(
        &exe_path, &image, dir_fd, name, env,
    ) {
        Ok(bun_standalone_graph::StandaloneModuleGraph::CompileResult::Err(err)) => Err(global
            .throw_invalid_arguments(format_args!("embedImage: {}", bstr::BStr::new(err.slice())))),
        Ok(_) => Ok(JSValue::js_number(image.len() as f64)),
        Err(e) => Err(global.throw_invalid_arguments(format_args!("embedImage: {}", e.name()))),
    }
}
