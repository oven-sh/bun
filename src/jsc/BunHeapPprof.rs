//! What `bun_pprof::heap` needs from JavaScriptCore: JavaScript frames and sourcemaps.

use bun_core::Ordinal;
use bun_pprof::heap::{JsThread, RawJsFrame, ResolvedPosition};

use crate::VM;
use crate::virtual_machine::VirtualMachine;

unsafe extern "C" {
    // src/jsc/bindings/BunPprofJSFrames.cpp
    fn Bun__pprof__captureJSFrames(
        vm: *mut VM,
        frame_pointers: *const usize,
        return_addresses: *const usize,
        chain_length: usize,
        out: *mut RawJsFrame,
        capacity: usize,
    ) -> usize;
}

pub fn install() {
    bun_pprof::heap::set_js_frame_source(capture_js_frames);
}

/// Runs inside `malloc`.
fn capture_js_frames(
    frame_pointers: &[usize],
    return_addresses: &[usize],
    out: &mut [RawJsFrame],
) -> JsThread {
    let Some(vm) = VirtualMachine::get_or_null() else {
        return JsThread::default();
    };
    // SAFETY: set by `VirtualMachine::init` on this thread and cleared before it is freed. Read
    // through the pointer: a `&mut VirtualMachine` may be live further up this stack.
    let (jsc_vm, is_shutting_down, worker) =
        unsafe { ((*vm).jsc_vm, (*vm).is_shutting_down, (*vm).worker) };
    // `worker_threads.threadId`: the main thread's context is 1.
    let worker = worker.map_or(0, |w| {
        // SAFETY: the C++-owned `WebWorker` outlives its VM.
        unsafe { &*w.cast::<crate::web_worker::WebWorker>() }
            .execution_context_id()
            .saturating_sub(1)
    });
    // The JSC VM is freed during teardown before this thread forgets its `VirtualMachine`.
    if jsc_vm.is_null() || is_shutting_down {
        return JsThread {
            worker,
            ..JsThread::default()
        };
    }
    debug_assert_eq!(frame_pointers.len(), return_addresses.len());
    let chain = if cfg!(windows) {
        core::ptr::null()
    } else {
        frame_pointers.as_ptr()
    };
    // SAFETY: `jsc_vm` is this thread's live VM; `chain` is null or, like
    // `return_addresses`, `frame_pointers.len()` words; `out` is writable for `out.len()` frames.
    let frames = unsafe {
        Bun__pprof__captureJSFrames(
            jsc_vm,
            chain,
            return_addresses.as_ptr(),
            frame_pointers.len(),
            out.as_mut_ptr(),
            out.len(),
        )
    };
    JsThread {
        frames,
        vm: jsc_vm as usize,
        worker,
    }
}

/// Call it on `vm`'s thread.
pub fn resolve_sampled_positions(vm: &mut VirtualMachine) {
    if !bun_pprof::heap::is_running() {
        return;
    }
    let id = vm.jsc_vm as usize;
    bun_pprof::heap::resolve_js_locations(id, &mut |url, line, column| {
        let (line, column) = (i32::try_from(line).ok()?, i32::try_from(column).ok()?);
        // Stack traces are remapped on the heap collector's thread too.
        let lookup = {
            let _guard = vm.remap_stack_frames_mutex.lock_guard();
            vm.resolve_source_mapping(
                url,
                Ordinal::from_one_based(line),
                Ordinal::from_one_based(column),
                bun_sourcemap::SourceContentHandling::NoSourceContents,
            )
        }?;
        let original = lookup.mapping.original;
        if !original.lines.is_valid() || !original.columns.is_valid() {
            return None;
        }
        Some(ResolvedPosition {
            url: match lookup.display_source_url_if_needed(url) {
                Some(display) => display.to_utf8().to_vec(),
                None => url.to_vec(),
            },
            line: u32::try_from(original.lines.one_based()).ok()?,
            column: u32::try_from(original.columns.one_based()).ok()?,
        })
    });
}

/// `--pprof-heap[=<path>]`
pub struct PprofHeapConfig {
    /// Empty: a generated name in the current directory. From CLI args, hence `'static`.
    pub path: &'static [u8],
}

pub(crate) fn stop_and_write_profile(
    vm: &mut VirtualMachine,
    config: &PprofHeapConfig,
) -> Result<(), crate::CrateError> {
    use bun_paths::AutoAbsPathChecked;

    resolve_sampled_positions(vm);
    let profile = match bun_pprof::heap::stop() {
        Ok(profile) => profile,
        // Script stopped it and has the profile.
        Err(bun_pprof::heap::Error::NotRunning) => return Ok(()),
        Err(_) => return Err(crate::CrateError::WriteFailed),
    };
    let mut path = AutoAbsPathChecked::init_top_level_dir();
    if config.path.is_empty() {
        let mut name = bun_paths::path_buffer_pool::get();
        path.join(&[crate::bun_heap_profiler::default_filename(
            &mut name, ".pb.gz",
        )?])?;
    } else {
        path.join(&[config.path])?;
    }
    crate::bun_heap_profiler::write_profile_file(&mut path, &profile)
}
