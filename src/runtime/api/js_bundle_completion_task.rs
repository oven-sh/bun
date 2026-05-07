//! `JSBundleCompletionTask` — owns one in-flight `Bun.build()`.
//!
//! LAYERING: this type lives in `bun_runtime` (not `bun_bundler_jsc`) because
//! its fields name `bun_runtime` types (`JSBundler::Config`, `Plugin`,
//! `HTMLBundle::Route`). `bun_bundler_jsc` is a lower-tier crate and cannot
//! depend on `bun_runtime`; keeping the struct there forces an opaque stub at
//! every use site. The struct is defined here and `bun_bundler_jsc` consumes it
//! through the `bun_bundler::bundle_v2::CompletionStruct` trait
//! (layout-agnostic).

use core::ptr::{self, NonNull};
use std::io::Write as _;

use bun_aio::KeepAlive;
use bun_alloc::Arena;
use bun_bundler::bundle_v2::{
    dispatch, BundleThread, BundleV2, BundleV2Result, CompletionStruct, FileMap as Bv2FileMap,
    JSBundleCompletionTask as Bv2OpaqueCompletion, JSBundlerPlugin,
};
use bun_bundler::options::{self, OutputFile, OutputKind, Side};
use bun_bundler::output_file::Value as OutputFileValue;
use bun_bundler::transpiler::Transpiler;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsError};
use bun_jsc::AnyTask::AnyTask;
use bun_jsc::event_loop::EventLoop;
use bun_logger as logger;
use bun_options_types::schema::api;
use bun_core::env::OperatingSystem;
use bun_paths::resolve_path::{join_abs_string, join_abs_string_buf, platform};
use bun_paths::{self as paths, PathBuffer, SEP};
use bun_ptr::{RefCount, RefCounted};
use bun_standalone_graph::StandaloneModuleGraph::{
    self as standalone_graph, target_base_public_path, to_executable, CompileErrorReason,
    CompileResult, Flags as StandaloneFlags,
};
use bun_options_types::WindowsOptions;
use bun_string::String as BunString;
use bun_str::strings;
use bun_sys::{self as sys, Dir, Fd, OpenDirOptions};
use bun_jsc::WorkPool;

use crate::api::js_bundler::js_bundler::{Config as JSBundlerConfig, Plugin, PluginJscExt};
use crate::api::js_bundler::BuildArtifact;
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::node::fs::{self as node_fs, args as fs_args, NodeFS};
use crate::node::types::{
    Encoding, FileSystemFlags, PathLike, PathOrFileDescriptor, StringOrBuffer,
};
use crate::server::html_bundle;

/// Mirrors Zig `BundleV2.JSBundleCompletionTask`. See module doc for the
/// layering rationale.
pub struct JSBundleCompletionTask {
    pub ref_count: RefCount<Self>,
    pub config: JSBundlerConfig,
    pub jsc_event_loop: *mut EventLoop,
    pub task: AnyTask,
    pub global_this: *const JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub env: *const bun_dotenv::Loader<'static>,
    pub log: logger::Log,
    pub cancelled: bool,

    pub html_build_task: Option<*mut html_bundle::Route>,

    pub result: BundleV2Result,

    /// intrusive queue link (UnboundedQueue)
    pub next: *mut JSBundleCompletionTask,
    /// arena-owned by BundleThread heap
    pub transpiler: *mut BundleV2<'static>,
    pub plugins: Option<NonNull<Plugin>>,
    pub started_at_ns: u64,
}

// `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
impl RefCounted for JSBundleCompletionTask {
    type DestructorCtx = ();
    fn debug_name() -> &'static str {
        "JSBundleCompletionTask"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: last ref dropped; allocation came from `Box::into_raw`.
        let mut boxed = unsafe { Box::from_raw(this) };
        boxed.poll_ref.disable();
        if let Some(plugin) = boxed.plugins.take() {
            // SAFETY: `plugin` is the live FFI handle stashed at construction;
            // last-ref drop is the only place that releases it (Zig: `plugin.deinit()`).
            unsafe { Plugin::destroy(plugin.as_ptr()) };
        }
        // Owned fields (`config`, `log`, `result`, `promise`) drop with the Box.
    }
}

// SAFETY: enqueued onto the bundle thread; field access is serialized by
// the producer/consumer handshake (`UnboundedQueue` + `Waker`).
unsafe impl Send for JSBundleCompletionTask {}

/// `BundleV2.createAndScheduleCompletionTask` — construct, take a process-keepalive
/// ref, and hand the task to the bundle-thread singleton.
pub fn create_and_schedule_completion_task(
    config: JSBundlerConfig,
    plugins: Option<NonNull<Plugin>>,
    global_this: &JSGlobalObject,
    event_loop: *mut EventLoop,
) -> Result<*mut JSBundleCompletionTask, bun_core::Error> {
    // SAFETY: `bun_vm()` returns the JS-thread VirtualMachine; non-null for a Bun global.
    let vm = global_this.bun_vm();
    let completion = Box::into_raw(Box::new(JSBundleCompletionTask {
        ref_count: RefCount::init(),
        config,
        jsc_event_loop: event_loop,
        task: AnyTask::default(),
        global_this,
        promise: jsc::JSPromiseStrong::default(),
        poll_ref: KeepAlive::init(),
        env: vm.transpiler.env,
        log: logger::Log::init(),
        cancelled: false,
        html_build_task: None,
        result: BundleV2Result::Pending,
        next: ptr::null_mut(),
        transpiler: ptr::null_mut(),
        plugins,
        started_at_ns: 0,
    }));
    // SAFETY: freshly-boxed allocation with ref_count == 1; sole handle.
    unsafe {
        (*completion).task = AnyTask::init::<JSBundleCompletionTask>(
            completion,
            JSBundleCompletionTask::on_complete_anytask,
        );
        if let Some(plugin) = (*completion).plugins {
            (*plugin.as_ptr()).set_config(completion.cast());
        }
    }

    // Ensure this exists before we spawn the thread to prevent any race
    // conditions from creating two
    let _ = WorkPool::get();

    bun_bundler::bundle_v2::singleton::enqueue::<JSBundleCompletionTask>(completion);

    // SAFETY: `completion` is live (refcount==1); `vm` outlives this call.
    unsafe { (*completion).poll_ref.ref_(vm) };

    Ok(completion)
}

/// `BundleV2.generateFromJavaScript` — schedule a build and return its Promise.
pub fn generate_from_javascript(
    config: JSBundlerConfig,
    plugins: Option<NonNull<Plugin>>,
    global_this: &JSGlobalObject,
    event_loop: *mut EventLoop,
) -> Result<JSValue, bun_core::Error> {
    let completion =
        create_and_schedule_completion_task(config, plugins, global_this, event_loop)?;
    // SAFETY: `completion` is the freshly-boxed allocation; sole owner on the JS
    // thread until the enqueued task runs.
    unsafe {
        (*completion).promise = jsc::JSPromiseStrong::init(global_this);
        Ok((*completion).promise.value())
    }
}

/// `if (s.slice().len > 0) s.slice() else null` for the windows-options block.
#[inline]
fn opt_box(s: &[u8]) -> Option<Box<[u8]>> {
    if s.is_empty() { None } else { Some(Box::from(s)) }
}

impl JSBundleCompletionTask {
    /// Returns true if the promises were handled and resolved from
    /// BundlePlugin.ts; false means the caller should resolve immediately.
    fn run_on_end_callbacks(
        global_this: &JSGlobalObject,
        plugin: &mut Plugin,
        promise: &JSPromise,
        build_result: JSValue,
        rejection: jsc::JsResult<JSValue>,
    ) -> jsc::JsResult<bool> {
        let value = plugin.run_on_end_callbacks(global_this, promise, build_result, rejection)?;
        Ok(value != JSValue::UNDEFINED)
    }

    fn to_js_error(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> Result<(), jsc::JsTerminated> {
        let throw_on_error = self.config.throw_on_error;

        let build_result = JSValue::create_empty_object(global_this, 3);
        match JSValue::create_empty_array(global_this, 0) {
            Ok(v) => build_result.put(global_this, b"outputs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };
        build_result.put(global_this, b"success", JSValue::FALSE);
        match bun_logger_jsc::log_to_js_array(&self.log, global_this) {
            Ok(v) => build_result.put(global_this, b"logs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };

        let did_handle_callbacks = if let Some(plugin) = self.plugins {
            // SAFETY: `plugin` is a live FFI handle for the duration of this task.
            let plugin = unsafe { &mut *plugin.as_ptr() };
            let rejection = if throw_on_error {
                bun_logger_jsc::log_to_js_aggregate_error(
                    &self.log,
                    global_this,
                    BunString::static_(b"Bundle failed"),
                )
            } else {
                Ok(JSValue::UNDEFINED)
            };
            match Self::run_on_end_callbacks(global_this, plugin, promise, build_result, rejection)
            {
                Ok(b) => b,
                Err(e) => return promise.reject(global_this, Err(e)),
            }
        } else {
            false
        };

        if !did_handle_callbacks {
            if throw_on_error {
                let aggregate_error = bun_logger_jsc::log_to_js_aggregate_error(
                    &self.log,
                    global_this,
                    BunString::static_(b"Bundle failed"),
                );
                return promise.reject(global_this, aggregate_error);
            } else {
                return promise.resolve(global_this, build_result);
            }
        }
        Ok(())
    }

    /// Port of `JSBundleCompletionTask.doCompilation`.
    fn do_compilation(&mut self, output_files: &mut Vec<OutputFile>) -> CompileResult {
        /// `defer { if root_dir != cwd, root_dir.close() }` — Zig captures
        /// `root_dir` by reference; the POSIX path reassigns it.
        struct DirGuard(Dir);
        impl Drop for DirGuard {
            fn drop(&mut self) {
                if self.0.fd != Fd::cwd() {
                    self.0.close();
                }
            }
        }

        // PORT NOTE: reshaped for borrowck — `self.config` is reborrowed for
        // every field projection so the `&mut self` receiver stays usable for
        // `self.env` below.
        let compile_options = self
            .config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");

        let entry_point_index: usize = 'brk: {
            for (i, output_file) in output_files.iter().enumerate() {
                if output_file.output_kind == OutputKind::EntryPoint
                    && output_file.side.unwrap_or(Side::Server) == Side::Server
                {
                    break 'brk i;
                }
            }
            return CompileResult::fail(CompileErrorReason::NoEntryPoint);
        };

        let mut outbuf = paths::path_buffer_pool::get();
        // SAFETY: `FileSystem::instance()` is the process-lifetime singleton
        // initialized during VM startup before any `Bun.build` is reachable.
        let top_level_dir =
            unsafe { (*bun_resolver::fs::FileSystem::instance()).top_level_dir };

        // Always get an absolute path for the outfile to ensure it works
        // correctly with PE metadata operations.
        // Add .exe extension for Windows targets if not already present.
        // PORT NOTE: collapsed to a single owned `Box<[u8]>` so the
        // `&mut outbuf` borrow ends before the rest of `self` is touched.
        let full_outfile_path: Box<[u8]> = {
            let outdir_slice = &self.config.outdir.list;
            let outfile_slice = &compile_options.outfile.list;
            let joined: &[u8] = if !outdir_slice.is_empty() {
                join_abs_string_buf::<platform::Auto>(
                    top_level_dir,
                    &mut outbuf[..],
                    &[outdir_slice, outfile_slice],
                )
            } else if paths::is_absolute(outfile_slice) {
                outfile_slice
            } else {
                // For relative paths, ensure we make them absolute relative to the current working directory
                join_abs_string_buf::<platform::Auto>(
                    top_level_dir,
                    &mut outbuf[..],
                    &[outfile_slice],
                )
            };
            if compile_options.compile_target.os == OperatingSystem::Windows
                && !joined.ends_with(b".exe")
            {
                let mut v = Vec::with_capacity(joined.len() + 4);
                v.extend_from_slice(joined);
                v.extend_from_slice(b".exe");
                v.into_boxed_slice()
            } else {
                Box::from(joined)
            }
        };

        let dirname: &[u8] = paths::dirname(&full_outfile_path).unwrap_or(b".");
        let basename: &[u8] = paths::basename(&full_outfile_path);

        let mut root_dir = DirGuard(Dir::cwd());

        // On Windows, don't change root_dir, just pass the full relative path
        // On POSIX, change root_dir to the target directory and pass basename
        let outfile_for_executable: &[u8] = if cfg!(windows) {
            &full_outfile_path
        } else {
            basename
        };

        if !(dirname.is_empty() || dirname == b".") {
            #[cfg(not(windows))]
            {
                // On POSIX, makeOpenPath and change root_dir
                root_dir.0 = match root_dir.0.make_open_path(dirname, OpenDirOptions::default()) {
                    Ok(d) => d,
                    Err(err) => {
                        return CompileResult::fail_fmt(format_args!(
                            "Failed to open output directory {}: {}",
                            bstr::BStr::new(dirname),
                            bstr::BStr::new(err.name()),
                        ));
                    }
                };
            }
            #[cfg(windows)]
            {
                // On Windows, ensure directories exist but don't change root_dir
                if let Err(err) = sys::make_path(root_dir.0, dirname) {
                    return CompileResult::fail_fmt(format_args!(
                        "Failed to create output directory {}: {}",
                        bstr::BStr::new(dirname),
                        bstr::BStr::new(err.name()),
                    ));
                }
            }
        }

        // Use the target-specific base path for compile mode, not the user-configured public_path
        let module_prefix =
            target_base_public_path(compile_options.compile_target.os, b"root/");

        let mut flags = StandaloneFlags::default();
        if !compile_options.autoload_dotenv {
            flags |= StandaloneFlags::DISABLE_DEFAULT_ENV_FILES;
        }
        if !compile_options.autoload_bunfig {
            flags |= StandaloneFlags::DISABLE_AUTOLOAD_BUNFIG;
        }
        if !compile_options.autoload_tsconfig {
            flags |= StandaloneFlags::DISABLE_AUTOLOAD_TSCONFIG;
        }
        if !compile_options.autoload_package_json {
            flags |= StandaloneFlags::DISABLE_AUTOLOAD_PACKAGE_JSON;
        }

        // SAFETY: `self.env` is the per-VM `DotEnv.Loader` stashed at
        // construction; valid for the lifetime of the VirtualMachine.
        let env = unsafe { &mut *(self.env as *mut bun_dotenv::Loader) };

        let result = match to_executable(
            &compile_options.compile_target,
            output_files,
            root_dir.0.fd,
            module_prefix,
            outfile_for_executable,
            env,
            self.config.format,
            WindowsOptions {
                hide_console: compile_options.windows_hide_console,
                icon: opt_box(&compile_options.windows_icon_path.list),
                title: opt_box(&compile_options.windows_title.list),
                publisher: opt_box(&compile_options.windows_publisher.list),
                version: opt_box(&compile_options.windows_version.list),
                description: opt_box(&compile_options.windows_description.list),
                copyright: opt_box(&compile_options.windows_copyright.list),
            },
            &compile_options.exec_argv.list,
            if compile_options.executable_path.list.is_empty() {
                None
            } else {
                Some(&compile_options.executable_path.list)
            },
            flags,
        ) {
            Ok(r) => r,
            Err(err) => {
                return CompileResult::fail_fmt(format_args!(
                    "{}",
                    bstr::BStr::new(err.name())
                ));
            }
        };

        if matches!(result, CompileResult::Success) {
            let entry = &mut output_files[entry_point_index];
            entry.dest_path = full_outfile_path.clone();
            entry.is_executable = true;
        }

        // Write external sourcemap files next to the compiled executable and
        // keep them in the output array. Destroy all other non-entry-point files.
        // With --splitting, there can be multiple sourcemap files (one per chunk).
        let mut kept: usize = 0;
        // PORT NOTE: reshaped for borrowck — Zig wrote `output_files.items[kept]
        // = current.*` while iterating `&mut output_files.items`. Swap-compact in
        // place via index iteration so each loop body holds at most one `&mut`
        // into `output_files`.
        for i in 0..output_files.len() {
            let keep_this = if i == entry_point_index {
                true
            } else if matches!(result, CompileResult::Success)
                && output_files[i].output_kind == OutputKind::Sourcemap
                && matches!(output_files[i].value, OutputFileValue::Buffer { .. })
            {
                let bytes_len = match &output_files[i].value {
                    OutputFileValue::Buffer { bytes } => bytes.len(),
                    _ => 0,
                };
                if bytes_len > 0 {
                    // Derive the .map filename from the sourcemap's own dest_path,
                    // placed in the same directory as the compiled executable.
                    let derived_map_basename: Box<[u8]>;
                    let map_basename: &[u8] = if !output_files[i].dest_path.is_empty() {
                        paths::basename(&output_files[i].dest_path)
                    } else {
                        let mut v = Vec::with_capacity(full_outfile_path.len() + 4);
                        v.extend_from_slice(&full_outfile_path);
                        v.extend_from_slice(b".map");
                        derived_map_basename = v.into_boxed_slice();
                        paths::basename(&derived_map_basename)
                    };

                    let sourcemap_full_path: Box<[u8]> =
                        if dirname.is_empty() || dirname == b"." {
                            Box::from(map_basename)
                        } else {
                            let mut v =
                                Vec::with_capacity(dirname.len() + 1 + map_basename.len());
                            v.extend_from_slice(dirname);
                            v.push(SEP);
                            v.extend_from_slice(map_basename);
                            v.into_boxed_slice()
                        };

                    // Write the sourcemap file to disk next to the executable
                    let mut pathbuf = PathBuffer::uninit();
                    let write_path: &[u8] =
                        if cfg!(windows) { &sourcemap_full_path } else { map_basename };
                    let bytes: &[u8] = match &output_files[i].value {
                        OutputFileValue::Buffer { bytes } => bytes,
                        // SAFETY: `Buffer` arm checked above.
                        _ => unsafe { core::hint::unreachable_unchecked() },
                    };
                    let write_args = fs_args::WriteFile {
                        encoding: Encoding::Buffer,
                        flag: FileSystemFlags::W,
                        mode: node_fs::DEFAULT_PERMISSION,
                        file: PathOrFileDescriptor::Path(PathLike::String(
                            bun_str::PathString::init(write_path),
                        )),
                        flush: false,
                        data: StringOrBuffer::EncodedSlice(
                            bun_str::zig_string::Slice::from_utf8_never_free(bytes),
                        ),
                        dirfd: root_dir.0.fd,
                        signal: None,
                    };
                    match NodeFS::write_file_with_path_buffer(&mut pathbuf, &write_args) {
                        Err(err) => {
                            bun_core::Output::err(
                                err,
                                "failed to write sourcemap file '{s}'",
                                (bstr::BStr::new(write_path),),
                            );
                            // current.deinit() — `OutputFile` drops below.
                            false
                        }
                        Ok(()) => {
                            output_files[i].dest_path = sourcemap_full_path;
                            true
                        }
                    }
                } else {
                    false
                }
            } else {
                false
            };

            if keep_this {
                output_files.swap(kept, i);
                kept += 1;
            }
            // PORT NOTE: Zig called `current.deinit()` on dropped entries; in
            // Rust the trailing entries are dropped by `truncate` below.
        }
        output_files.truncate(kept);

        result
    }

    /// AnyTask trampoline: `onComplete` runs on the JS thread once the bundle
    /// thread posts back via `complete_on_bundle_thread`.
    fn on_complete_anytask(ctx: *mut Self) -> bun_event_loop::JsResult<()> {
        // SAFETY: `ctx` is the Box::into_raw allocation registered in `task`.
        let this = unsafe { &mut *ctx };
        // For the +1 taken by `complete_on_bundle_thread` enqueue.
        let _drop_ref = scopeguard::guard(ctx, |p| unsafe { RefCount::<Self>::deref(p) });

        // SAFETY: bun_vm() is non-null for a Bun global.
        this.poll_ref.unref(unsafe { (*this.global_this).bun_vm() });
        if this.cancelled {
            return Ok(());
        }

        if let Some(html_build_task) = this.html_build_task {
            this.plugins = None;
            // SAFETY: `html_build_task` is a backref set by `HTMLBundle::Route` which
            // bumped its own refcount before scheduling and stays alive until this returns.
            unsafe { html_bundle::Route::on_complete(&mut *html_build_task, this) };
            return Ok(());
        }

        // SAFETY: `global_this` was stashed at construction on the JS thread; this
        // callback runs on that same thread (enqueued via `enqueue_task_concurrent`).
        let global_this = unsafe { &*this.global_this };
        // PORT NOTE: `Strong::swap` ties the returned `&mut JSPromise` to
        // `&mut this.promise` even though the cell lives on the GC heap (raw
        // ptr deref inside). Detach via raw ptr so `this` can be reborrowed
        // for `result`/`config`/`log` below — Zig stored `*JSPromise`.
        let promise: *mut JSPromise = this.promise.swap();
        // SAFETY: GC-owned cell; valid for the duration of this JS-thread callback.
        let promise = unsafe { &mut *promise };

        // PORT NOTE: reshaped for borrowck — `do_compilation` borrows
        // `&mut self` while needing `&mut output_files` from inside
        // `self.result`. Temporarily move the Vec out via `take` so the
        // method gets a disjoint `&mut self`.
        if matches!(this.result, BundleV2Result::Value(_)) && this.config.compile.is_some() {
            let mut output_files = match &mut this.result {
                BundleV2Result::Value(build) => core::mem::take(&mut build.output_files),
                // SAFETY: arm checked above.
                _ => unsafe { core::hint::unreachable_unchecked() },
            };
            let compile_result = this.do_compilation(&mut output_files);
            // `defer compile_result.deinit()` — `CompileResult` is a Rust enum
            // with owned `Vec<u8>` payloads; drops at end of scope.

            if let CompileResult::Err(err) = &compile_result {
                // `bun.handleOom(log.addError(..., bun.handleOom(dupe(..))))`
                this.log
                    .add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!("{}", bstr::BStr::new(err.slice())),
                    )
                    .expect("oom");
                // `this.result.value.deinit()` — owned fields drop with the
                // overwrite below; `output_files` (moved out above) drops here.
                drop(output_files);
                this.result = BundleV2Result::Err(bun_core::err!("CompilationFailed"));
            } else {
                // Put the compacted output_files back.
                match &mut this.result {
                    BundleV2Result::Value(build) => build.output_files = output_files,
                    // SAFETY: arm checked above.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }
            }
        }

        // PORT NOTE: reshaped for borrowck — `to_js_error` borrows `&mut self`,
        // which would overlap a `&mut this.result` match scrutinee. Dispatch
        // the pending/err arms first, then take a fresh `&mut` for Value.
        if matches!(this.result, BundleV2Result::Pending) {
            unreachable!();
        }
        if matches!(this.result, BundleV2Result::Err(_)) {
            return Ok(this.to_js_error(promise, global_this)?);
        }
        match &mut this.result {
            BundleV2Result::Value(build) => {
                let output_files = &mut build.output_files;
                let output_files_js =
                    match JSValue::create_empty_array(global_this, output_files.len()) {
                        Ok(v) => v,
                        Err(e) => return Ok(promise.reject(global_this, Err(e))?),
                    };
                if output_files_js == JSValue::ZERO {
                    panic!(
                        "Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun."
                    );
                }

                // PORT NOTE: reshaped for borrowck — `output_file.to_js()` needs
                // `&mut OutputFile` while the path computation reads
                // `this.config`. Snapshot the config slices once outside the
                // loop so the per-file `&mut` doesn't overlap `&this.config`.
                let outdir_is_abs = !this.config.outdir.is_empty()
                    && bun_paths::is_absolute(&this.config.outdir.list);
                let outdir = this.config.outdir.list.clone();
                let dir = this.config.dir.list.clone();
                // SAFETY: `FileSystem::instance()` is the process-lifetime singleton
                // initialized during VM startup before any `Bun.build` is reachable.
                let top_level_dir =
                    unsafe { (*bun_resolver::fs::FileSystem::instance()).top_level_dir };

                let mut to_assign_on_sourcemap = JSValue::ZERO;
                for (i, output_file) in output_files.iter_mut().enumerate() {
                    let path: Box<[u8]> = if !outdir.is_empty() {
                        if outdir_is_abs {
                            Box::from(join_abs_string::<platform::Auto>(
                                &outdir,
                                &[&output_file.dest_path],
                            ))
                        } else {
                            Box::from(join_abs_string::<platform::Auto>(
                                top_level_dir,
                                &[&dir, &outdir, &output_file.dest_path],
                            ))
                        }
                    } else {
                        output_file.dest_path.clone()
                    };
                    let result = output_file.to_js(Some(&path), global_this);
                    if to_assign_on_sourcemap != JSValue::ZERO {
                        // SAFETY: codegen FFI — `to_assign_on_sourcemap` is the
                        // `BuildArtifact` JS wrapper produced by the previous
                        // iteration's `to_js`; `result` is a fresh JS cell.
                        unsafe {
                            BuildArtifactPrototype__sourcemapSetCachedValue(
                                to_assign_on_sourcemap,
                                global_this.as_ptr(),
                                result,
                            );
                        }
                        if let Some(artifact) = to_assign_on_sourcemap.as_::<BuildArtifact>() {
                            // SAFETY: `as_` returned a live `*mut BuildArtifact`
                            // owned by the JS wrapper; the borrow lasts only for
                            // this `set` call (no other Rust alias exists).
                            unsafe { (*artifact).sourcemap.set(global_this, result) };
                        }
                        to_assign_on_sourcemap = JSValue::ZERO;
                    }

                    if output_file.source_map_index != u32::MAX {
                        to_assign_on_sourcemap = result;
                    }

                    if let Err(e) = output_files_js.put_index(global_this, i as u32, result) {
                        return Ok(promise.reject(global_this, Err(e))?);
                    }
                }

                let build_output = JSValue::create_empty_object(global_this, 4);
                build_output.put(global_this, b"outputs", output_files_js);
                build_output.put(global_this, b"success", JSValue::TRUE);
                match bun_logger_jsc::log_to_js_array(&this.log, global_this) {
                    Ok(v) => build_output.put(global_this, b"logs", v),
                    Err(e) => return Ok(promise.reject(global_this, Err(e))?),
                };

                // metafile: { json: <lazy parsed>, markdown?: string }
                if let Some(metafile) = &build.metafile {
                    let metafile_js_str =
                        match jsc::bun_string_jsc::create_utf8_for_js(global_this, metafile) {
                            Ok(v) => v,
                            Err(e) => return Ok(promise.reject(global_this, Err(e))?),
                        };
                    let metafile_md_str = match &build.metafile_markdown {
                        Some(md) => {
                            match jsc::bun_string_jsc::create_utf8_for_js(global_this, md) {
                                Ok(v) => v,
                                Err(e) => return Ok(promise.reject(global_this, Err(e))?),
                            }
                        }
                        None => JSValue::UNDEFINED,
                    };
                    // SAFETY: FFI into C++; all args are valid encoded JSValues / live global ptr.
                    unsafe {
                        Bun__setupLazyMetafile(
                            global_this.as_ptr(),
                            build_output,
                            metafile_js_str,
                            metafile_md_str,
                        );
                    }
                }

                let did_handle_callbacks = if let Some(plugin) = this.plugins {
                    // SAFETY: `plugin` is a live FFI handle for the duration of this task.
                    let plugin = unsafe { &mut *plugin.as_ptr() };
                    match Self::run_on_end_callbacks(
                        global_this,
                        plugin,
                        promise,
                        build_output,
                        Ok(JSValue::UNDEFINED),
                    ) {
                        Ok(b) => b,
                        Err(e) => return Ok(promise.reject(global_this, Err(e))?),
                    }
                } else {
                    false
                };

                if !did_handle_callbacks {
                    return Ok(promise.resolve(global_this, build_output)?);
                }
            }
            // SAFETY: Pending/Err already returned above.
            _ => unsafe { core::hint::unreachable_unchecked() },
        }
        Ok(())
    }
}

// ─── C++ FFI (codegen) ───────────────────────────────────────────────────────
// `jsc.conv` — sysv64 on Windows-x64, C elsewhere. These are C++ symbols
// emitted by `generate-classes.ts` / `BundlerMetafile.cpp`, not Rust symbols,
// so a local extern block is the correct binding (not a re-declaration of a
// Rust fn).
#[cfg(all(windows, target_arch = "x86_64"))]
unsafe extern "sysv64" {
    fn Bun__setupLazyMetafile(
        global_this: *mut JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
    fn BuildArtifactPrototype__sourcemapSetCachedValue(
        this_value: JSValue,
        global: *mut JSGlobalObject,
        value: JSValue,
    );
}
#[cfg(not(all(windows, target_arch = "x86_64")))]
unsafe extern "C" {
    fn Bun__setupLazyMetafile(
        global_this: *mut JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
    fn BuildArtifactPrototype__sourcemapSetCachedValue(
        this_value: JSValue,
        global: *mut JSGlobalObject,
        value: JSValue,
    );
}

// ─── CompletionDispatch vtable ───────────────────────────────────────────────
// §Dispatch — the bundler holds `JSBundleCompletionTask` as a
// `dispatch::CompletionHandle` (erased owner + this `&'static` vtable) so the
// struct layout stays in `bun_runtime`.
static COMPLETION_VTABLE: dispatch::CompletionDispatch = dispatch::CompletionDispatch {
    result_is_err: |c| {
        // SAFETY: `c` is a live backref the bundler set in `BundleThread`.
        matches!(unsafe { &(*c.as_ptr().cast::<JSBundleCompletionTask>()).result }, BundleV2Result::Err(_))
    },
    enqueue_task_concurrent: |c, task| {
        // SAFETY: `c` is a live backref; `jsc_event_loop` is valid for the
        // process lifetime once `Bun.build` is reachable.
        unsafe {
            (*(*c.as_ptr().cast::<JSBundleCompletionTask>()).jsc_event_loop)
                .enqueue_task_concurrent(task)
        }
    },
};

// ─── CompletionStruct impl ───────────────────────────────────────────────────
// Hands BundleThread the field accessors it needs without exposing the layout.
impl bun_threading::Node for JSBundleCompletionTask {
    fn next(&self) -> *mut Self {
        self.next
    }
    fn set_next(&mut self, n: *mut Self) {
        self.next = n;
    }
}

impl CompletionStruct for JSBundleCompletionTask {
    /// Port of `JSBundleCompletionTask.configureBundler` — the post-init half
    /// (everything after `transpiler.* = try Transpiler.init(...)`).
    /// `Transpiler::init` itself is called by `create_and_configure_transpiler`
    /// (Rust cannot zero-init `Transpiler<'a>` and write it in place).
    fn configure_bundler(
        &mut self,
        transpiler: &mut Transpiler<'_>,
        bump: &Arena,
    ) -> Result<(), bun_core::Error> {
        let config = &mut self.config;

        transpiler.options.env.behavior = config.env_behavior;
        transpiler.options.env.prefix = Box::from(config.env_prefix.list.as_slice());
        // PORT NOTE: Zig `&config.features` (a `*StringSet` borrow). The Rust
        // `BundleOptions.bundler_feature_flags: Option<Box<StringSet>>` owns,
        // so clone the set rather than alias.
        transpiler.options.bundler_feature_flags = Some(Box::new(config.features.clone()?));
        if config.force_node_env != options::ForceNodeEnv::Unspecified {
            transpiler.options.force_node_env = config.force_node_env;
        }

        transpiler.options.entry_points = config.entry_points.keys().to_vec().into_boxed_slice();
        // Convert API JSX config back to options.JSX.Pragma
        let jsx_import = &config.jsx.import_source;
        transpiler.options.jsx = options::jsx::Pragma {
            factory: if !config.jsx.factory.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    Box::default(),
                    &config.jsx.factory,
                )?
            } else {
                options::jsx::defaults::FACTORY
                    .iter()
                    .map(|s| Box::<[u8]>::from(*s))
                    .collect()
            },
            fragment: if !config.jsx.fragment.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    Box::default(),
                    &config.jsx.fragment,
                )?
            } else {
                options::jsx::defaults::FRAGMENT
                    .iter()
                    .map(|s| Box::<[u8]>::from(*s))
                    .collect()
            },
            runtime: options::jsx::Runtime::from(config.jsx.runtime),
            development: config.jsx.development,
            package_name: if !jsx_import.is_empty() {
                Box::from(&**jsx_import)
            } else {
                Box::from(b"react".as_slice())
            },
            classic_import_source: if !jsx_import.is_empty() {
                Box::from(&**jsx_import)
            } else {
                Box::from(b"react".as_slice())
            },
            side_effects: config.jsx.side_effects,
            parse: true,
            import_source: options::jsx::ImportSource {
                development: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 16);
                    let _ = write!(&mut v, "{}/jsx-dev-runtime", bstr::BStr::new(jsx_import));
                    v.into_boxed_slice()
                } else {
                    Box::from(b"react/jsx-dev-runtime".as_slice())
                },
                production: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 12);
                    let _ = write!(&mut v, "{}/jsx-runtime", bstr::BStr::new(jsx_import));
                    v.into_boxed_slice()
                } else {
                    Box::from(b"react/jsx-runtime".as_slice())
                },
            },
        };
        transpiler.options.no_macros = config.no_macros;
        transpiler.options.loaders =
            options::loaders_from_transform_options(config.loaders.clone(), config.target)?;
        transpiler.options.entry_naming = config.names.entry_point.data.clone();
        transpiler.options.chunk_naming = config.names.chunk.data.clone();
        transpiler.options.asset_naming = config.names.asset.data.clone();

        transpiler.options.output_format = config.format;
        transpiler.options.bytecode = config.bytecode;
        transpiler.options.compile = config.compile.is_some();

        // For compile mode, set the public_path to the target-specific base path
        // This ensures embedded resources like yoga.wasm are correctly found
        if let Some(compile_opts) = &config.compile {
            let base_public_path =
                target_base_public_path(compile_opts.compile_target.os, b"root/");
            transpiler.options.public_path = Box::from(base_public_path);
        } else {
            transpiler.options.public_path = Box::from(config.public_path.list.as_slice());
        }

        transpiler.options.output_dir = Box::from(config.outdir.list.as_slice());
        transpiler.options.root_dir = Box::from(config.rootdir.list.as_slice());
        transpiler.options.minify_syntax = config.minify.syntax;
        transpiler.options.minify_whitespace = config.minify.whitespace;
        transpiler.options.minify_identifiers = config.minify.identifiers;
        transpiler.options.keep_names = config.minify.keep_names;
        transpiler.options.inlining = config.minify.syntax;
        transpiler.options.source_map = config.source_map;
        transpiler.options.packages = config.packages;
        transpiler.options.allow_unresolved = match &config.allow_unresolved {
            Some(a) => options::AllowUnresolved::from_strings(
                a.keys().to_vec().into_boxed_slice(),
            ),
            None => options::AllowUnresolved::All,
        };
        transpiler.options.code_splitting = config.code_splitting;
        transpiler.options.emit_dce_annotations =
            config.emit_dce_annotations.unwrap_or(!config.minify.whitespace);
        transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.compile_to_standalone_html = 'brk: {
            if config.compile.is_none() || config.target != options::Target::Browser {
                break 'brk false;
            }
            // Only activate standalone HTML when all entrypoints are HTML files
            for ep in config.entry_points.keys() {
                if !ep.ends_with(b".html") {
                    break 'brk false;
                }
            }
            config.entry_points.count() > 0
        };
        // When compiling to standalone HTML, don't use the bun executable compile path
        if transpiler.options.compile_to_standalone_html {
            transpiler.options.compile = false;
            config.compile = None;
        }
        transpiler.options.banner = config.banner.list.as_slice().into();
        transpiler.options.footer = config.footer.list.as_slice().into();
        transpiler.options.react_fast_refresh = config.react_fast_refresh;
        transpiler.options.metafile = config.metafile;
        transpiler.options.metafile_json_path =
            Box::from(config.metafile_json_path.list.as_slice());
        transpiler.options.metafile_markdown_path =
            Box::from(config.metafile_markdown_path.list.as_slice());
        if config.optimize_imports.count() > 0 {
            // PORT NOTE: Zig `&config.optimize_imports` is a borrow into
            // `*JSBundleCompletionTask` (lives for the bundle). The Rust
            // `BundleOptions.optimize_imports: Option<&'a StringSet>` borrows
            // arena lifetime — bump-alloc a copy so `'a == 'bump`.
            transpiler.options.optimize_imports =
                Some(&*bump.alloc(config.optimize_imports.clone()?));
        }

        if transpiler.options.compile {
            // Emitting DCE annotations is nonsensical in --compile.
            transpiler.options.emit_dce_annotations = false;
        }

        transpiler.configure_linker();
        transpiler.configure_defines()?;

        if !transpiler.options.production {
            transpiler.options.conditions.append_slice(&[b"development"])?;
        }
        // SAFETY: `transpiler.env` is the dotenv loader installed by
        // `Transpiler::init`; non-null and valid for `'a`.
        transpiler.resolver.env_loader =
            NonNull::new(unsafe { transpiler.env.cast::<bun_dotenv::Loader<'_>>() });
        // CYCLEBREAK: `Resolver.opts` is the resolver-crate FORWARD_DECL subset
        // — re-project from the now-mutated `transpiler.options` (Zig assigned
        // the struct by value: `resolver.opts = transpiler.options`).
        transpiler.sync_resolver_opts();
        Ok(())
    }

    fn complete_on_bundle_thread(&mut self) {
        // SAFETY: jsc_event_loop is the JS-thread EventLoop; valid for process lifetime.
        unsafe {
            (*self.jsc_event_loop)
                .enqueue_task_concurrent(jsc::ConcurrentTask::create(self.task.task()));
        }
    }
    fn set_result(&mut self, result: BundleV2Result) {
        self.result = result;
    }
    fn set_log(&mut self, log: logger::Log) {
        self.log = log;
    }
    fn set_transpiler(&mut self, this: *mut BundleV2<'_>) {
        self.transpiler = this.cast();
    }
    fn plugins(&self) -> Option<NonNull<JSBundlerPlugin>> {
        // `Plugin` and `JSBundlerPlugin` are the same `bun_bundler` opaque.
        self.plugins
    }
    fn file_map(&mut self) -> Option<NonNull<Bv2FileMap>> {
        // `FileMap` and `Bv2FileMap` are the same `bun_bundler` type.
        if self.config.files.map.is_empty() {
            None
        } else {
            Some(NonNull::from(&mut self.config.files))
        }
    }
    fn as_js_bundle_completion_task(&mut self) -> dispatch::CompletionHandle {
        dispatch::CompletionHandle {
            owner: NonNull::from(self).cast::<Bv2OpaqueCompletion>(),
            vtable: &COMPLETION_VTABLE,
        }
    }

    fn create_and_configure_transpiler<'a>(
        &mut self,
        bump: &'a Arena,
    ) -> Result<&'a mut Transpiler<'a>, bun_core::Error> {
        // Zig: `transpiler.* = try bun.Transpiler.init(alloc, &completion.log,
        //        api.TransformOptions{ ... }, completion.env);`
        let config = &self.config;
        let opts = api::TransformOptions {
            define: if config.define.count() > 0 {
                Some(api::StringMap {
                    keys: config.define.keys().to_vec(),
                    values: config.define.values().to_vec(),
                })
            } else {
                None
            },
            entry_points: config.entry_points.keys().to_vec(),
            target: Some(config.target.to_api()),
            absolute_working_dir: if !config.dir.list.is_empty() {
                Some(Box::from(config.dir.list.as_slice()))
            } else {
                None
            },
            inject: Vec::new(),
            external: config.external.keys().to_vec(),
            main_fields: Vec::new(),
            extension_order: Vec::new(),
            env_files: Vec::new(),
            conditions: config.conditions.keys().to_vec(),
            // PORT NOTE: Zig read `transpiler.options.ignore_dce_annotations`
            // off the *uninitialized* out-param (i.e. whatever the previous
            // build left there). The Rust port has no prior `Transpiler` here;
            // use the config value, which `configure_bundler` reapplies anyway.
            ignore_dce_annotations: config.ignore_dce_annotations,
            drop: config.drop.keys().to_vec(),
            // PORT NOTE: same uninitialized-read for `bunfig_path`; default empty.
            bunfig_path: Box::default(),
            jsx: Some(config.jsx.clone()),
            ..Default::default()
        };

        let log: *mut logger::Log = &mut self.log;
        // SAFETY: `self.env` is the per-VM dotenv loader stashed at
        // construction; cast erases `'_` (bun_dotenv::Loader is invariant on
        // its arena lifetime, but `Transpiler::init` only stores the pointer).
        let env = self.env as *mut bun_dotenv::Loader<'static>;
        let t = Transpiler::init(bump, log, opts, Some(env))?;
        let transpiler: &'a mut Transpiler<'a> = bump.alloc(t);

        // Post-init field wiring (the rest of Zig `configureBundler`).
        // PORT NOTE: reborrow through a raw ptr so `&mut self` is usable
        // again after handing `&'a mut Transpiler` (which is tied to `bump`,
        // not `self`) to the trait method.
        let tp: *mut Transpiler<'a> = transpiler;
        // SAFETY: `tp` aliases nothing in `self`; lives in `bump`.
        self.configure_bundler(unsafe { &mut *tp }, bump)?;
        // SAFETY: `tp` was the unique `&'a mut` slot from `bump.alloc`; the
        // reborrow above has ended.
        Ok(unsafe { &mut *tp })
    }

    fn init_and_run<'a>(
        &mut self,
        transpiler: &'a mut Transpiler<'a>,
        bump: &'a Arena,
        thread_pool: *mut bun_threading::ThreadPool,
    ) -> Result<(), bun_core::Error> {
        // `jsc.AnyEventLoop.init(allocator)` — Mini loop owned by the bump.
        // The linker stores `Option<NonNull<AnyEventLoop<'static>>>` (lifetime
        // erased BACKREF — see LinkerContext.rs:50); cast through raw to erase
        // `'a` since the loop lives exactly as long as `bump` and `BundleV2`.
        let any_loop = bump.alloc(bun_event_loop::AnyEventLoop::default());
        let event_loop: bun_bundler::linker_context_mod::EventLoop = Some(
            NonNull::from(&mut *any_loop).cast::<bun_event_loop::AnyEventLoop<'static>>(),
        );

        // Zig passed the same `heap` by value (mimalloc handle struct copy);
        // bumpalo arenas can't be aliased that way, so `BundleV2` owns its
        // own arena (its only consumer is `linker.graph.bump`, repointed in
        // `BundleV2::init`). Transpiler/AST allocations stay in `bump`.
        let heap = Arena::new();

        // SAFETY: `thread_pool` is the leaked `WorkPool` singleton (`OnceLock`-
        // backed, process-lifetime). `BundleV2::init` only converts it to
        // `*mut` for `worker_pool`; no `&mut` uniqueness is actually required.
        let worker_pool = unsafe { thread_pool.as_mut() };

        let mut bv2 = BundleV2::init(
            transpiler, None, bump, event_loop, false, worker_pool, heap,
        )?;

        bv2.plugins = self.plugins();
        bv2.completion = Some(self.as_js_bundle_completion_task());
        // SAFETY: `file_map` returns a `NonNull` into `self.config.files`,
        // which outlives `bv2` (both live until `generate_in_new_thread`
        // returns). `BundleV2.file_map: Option<&'a FileMap>` — erase to `'a`.
        bv2.file_map = self.file_map().map(|p| unsafe { &*p.as_ptr() });

        self.set_transpiler(&mut *bv2 as *mut BundleV2<'_>);

        // Snapshot entry points as `&[&[u8]]` (Zig `keys()` is `[][]const u8`).
        let entry_points: Vec<&[u8]> =
            self.config.entry_points.keys().iter().map(|b| &**b).collect();

        let run = bv2.run_from_js_in_new_thread(&entry_points);

        // Zig: `defer { ast_memory_allocator.pop(); this.deinitWithoutFreeingArena(); }`
        // (the AST-allocator pop lives in `generate_in_new_thread`).
        // `errdefer { source_maps.*_wait_group.wait(); }` — only on error path.
        match run {
            Ok(build) => {
                self.set_result(BundleV2Result::Value(build));
                bv2.deinit_without_freeing_arena();
                Ok(())
            }
            Err(err) => {
                bv2.linker.source_maps.line_offset_wait_group.wait();
                bv2.linker.source_maps.quoted_contents_wait_group.wait();
                bv2.deinit_without_freeing_arena();
                Err(err)
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/JSBundleCompletionTask.zig (621 lines)
//   confidence: medium
//   notes:      LAYERING MOVE from bun_bundler_jsc — struct depends on
//               bun_runtime types (Config/Plugin/HTMLBundleRoute). All Zig
//               bodies now ported: configureBundler split across
//               create_and_configure_transpiler (Transpiler::init call) +
//               configure_bundler (post-init option wiring); init_and_run
//               wraps BundleV2::init + run_from_js_in_new_thread +
//               wait-group drain + deinit_without_freeing_arena;
//               do_compilation drives StandaloneModuleGraph.to_executable +
//               sourcemap side-file writes via NodeFS.write_file_with_path_buffer.
// ──────────────────────────────────────────────────────────────────────────
