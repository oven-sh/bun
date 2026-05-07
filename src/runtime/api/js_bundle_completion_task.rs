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

use bun_aio::KeepAlive;
use bun_bundler::bundle_v2::{
    dispatch, BundleThread, BundleV2, BundleV2Result, CompletionStruct, FileMap as Bv2FileMap,
    JSBundleCompletionTask as Bv2OpaqueCompletion, JSBundlerPlugin,
};
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsError};
use bun_jsc::AnyTask::AnyTask;
use bun_jsc::event_loop::EventLoop;
use bun_logger as logger;
use bun_paths::resolve_path::{join_abs_string, platform};
use bun_ptr::{RefCount, RefCounted};
use bun_string::String as BunString;
use bun_threading::WorkPool;

use crate::api::js_bundler::js_bundler::{Config as JSBundlerConfig, Plugin, PluginJscExt};
use crate::api::js_bundler::BuildArtifact;
use crate::api::output_file_jsc::OutputFileJsc as _;
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
    pub env: *const bun_dotenv::Loader,
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

        if let BundleV2Result::Value(_) = &this.result {
            if this.config.compile.is_some() {
                // PORT NOTE(compile): `do_compilation` (≈200 lines) calls
                // `bun_standalone_graph::to_executable` + sourcemap-side-file
                // writes via `NodeFS::write_file_with_path_buffer`. The Rust
                // `to_executable` signature has diverged from Zig (no allocator,
                // `Fd` root_dir) and `NodeFS` write-args are still being ported;
                // until those settle, surface a hard error through the same
                // user-visible channel Zig uses on compile failure (log + Err).
                let _ = this.log.add_error(
                    None,
                    logger::Loc::EMPTY,
                    b"Bun.build({ compile }) is not yet supported in this build",
                );
                this.result = BundleV2Result::Err(bun_core::err!("CompilationFailed"));
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
    fn configure_bundler(
        &mut self,
        _transpiler: &mut bun_transpiler::Transpiler<'_>,
        _bump: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error> {
        // Body folded into `create_and_configure_transpiler` (Zig left
        // `*transpiler` uninitialized and let `configureBundler` write it
        // in-place; Rust's `Transpiler<'a>` cannot be zero-init'd, so the
        // allocate + configure pair is one trait call). See
        // `CompletionStruct::create_and_configure_transpiler` doc.
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
        _bump: &'a bun_alloc::Arena,
    ) -> Result<&'a mut bun_transpiler::Transpiler<'a>, bun_core::Error> {
        // PORT NOTE: `Transpiler::init` returns `Transpiler<'a>` by value while
        // this trait wants `&'a mut Transpiler<'a>` (arena-allocated). The
        // arena's `alloc` cannot host the `Transpiler` yet because
        // `Resolver<'a>` borrows the same arena (`allocator: &'a Arena`) —
        // moving the resolver into the bump while it borrows the bump is a
        // self-referential lifetime the borrow checker rejects (tracked in
        // bundle_v2.rs `init`). Until `Transpiler` exposes an in-place
        // arena constructor, surface the error through the existing
        // `BundleThread` error path so `Bun.build` rejects deterministically.
        Err(bun_core::err!("JSBundleCompletionTask::create_and_configure_transpiler"))
    }
    fn init_and_run<'a>(
        &mut self,
        _transpiler: &'a mut bun_transpiler::Transpiler<'a>,
        _bump: &'a bun_alloc::Arena,
        _thread_pool: &'static bun_threading::ThreadPool,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: `BundleV2::init` + `run_from_js_in_new_thread` are
        // un-gated in `bun_bundler`, but `init`'s `event_loop:
        // ungate_support::EventLoop` argument is the linker's erased loop
        // alias (not `bun_jsc::event_loop::EventLoop`). The bridge from
        // `jsc::AnyEventLoop::init(allocator)` to that type is owned by
        // `bun_bundler::ungate_support`; once it grows a `from_mini`/
        // `from_any` constructor this body becomes:
        //   `let bv2 = BundleV2::init(transpiler, None, bump, loop_, false,
        //    Some(thread_pool), heap)?; … bv2.run_from_js_in_new_thread(ep)`.
        Err(bun_core::err!("JSBundleCompletionTask::init_and_run"))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/JSBundleCompletionTask.zig (621 lines)
//   confidence: medium
//   notes:      LAYERING MOVE from bun_bundler_jsc — struct depends on
//               bun_runtime types (Config/Plugin/HTMLBundleRoute). The
//               `Bun.build()` promise-resolution path (on_complete /
//               to_js_error / run_on_end_callbacks / metafile / sourcemap
//               wiring) is now ported here; `do_compilation` and the
//               bundle-thread `init_and_run` body remain blocked on upstream
//               type bridges (`ungate_support::EventLoop`, arena-init
//               `Transpiler`).
// ──────────────────────────────────────────────────────────────────────────
