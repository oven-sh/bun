//! `JSBundleCompletionTask` — owns one in-flight `Bun.build()`.
//!
//! LAYERING: this type lives in `bun_runtime` (not `bun_bundler_jsc`) because
//! its fields name `bun_runtime` types (`JSBundler::Config`, `Plugin`,
//! `HTMLBundle::Route`). `bun_bundler_jsc` is a lower-tier crate and cannot
//! depend on `bun_runtime`; keeping the struct there forces an opaque stub
//! and a cycle of `todo!("blocked_on")` at every use site. The struct is
//! defined here and `bun_bundler_jsc` consumes it through the
//! `bun_bundler::bundle_v2::CompletionStruct` trait (layout-agnostic).

use core::ptr::{self, NonNull};

use bun_aio::KeepAlive;
use bun_bundler::bundle_v2::{
    BundleThread, BundleV2, BundleV2Result, CompletionStruct, FileMap as Bv2FileMap,
    JSBundleCompletionTask as Bv2OpaqueCompletion, JSBundlerPlugin,
};
use bun_jsc::{self as jsc, JSGlobalObject};
use bun_jsc::AnyTask::AnyTask;
use bun_jsc::event_loop::EventLoop;
use bun_logger as logger;
use bun_ptr::{RefCount, RefCounted};
use bun_threading::WorkPool;

use crate::api::js_bundler::js_bundler::{Config as JSBundlerConfig, Plugin, PluginJscExt as _};
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

impl JSBundleCompletionTask {
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

        // `Bun.build()` JS-promise path lives in `bun_bundler_jsc`; the
        // promise-resolution body is wired there via `CompletionStruct`.
        // TODO(port): port `to_js_error` / `do_compilation` / promise resolve
        // path here once `BuildArtifact` is reachable without a tier cycle.
        Ok(())
    }
}

// ─── COMPLETION_DISPATCH vtable ──────────────────────────────────────────────
// The bundler holds `*mut JSBundleCompletionTask` opaquely; field reads are
// routed through this vtable so the struct layout stays in `bun_runtime`.
static COMPLETION_VTABLE: bun_bundler::DeferredBatchTask::CompletionDispatch =
    bun_bundler::DeferredBatchTask::CompletionDispatch {
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

/// Register the `COMPLETION_DISPATCH` vtable so `bun_bundler` can read
/// `result`/`jsc_event_loop` without knowing this struct's layout.
/// Called from `bun_runtime::init()`.
pub fn register_completion_dispatch() {
    bun_bundler::DeferredBatchTask::COMPLETION_DISPATCH.store(
        &COMPLETION_VTABLE as *const _ as *mut _,
        core::sync::atomic::Ordering::Release,
    );
}

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
        // TODO(port): full body in bundler_jsc/JSBundleCompletionTask.zig
        // (configure_bundler — 180 lines of options surgery). Tracked
        // separately; not on the HTMLBundle hot path.
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
    fn as_js_bundle_completion_task(&mut self) -> NonNull<Bv2OpaqueCompletion> {
        NonNull::from(self).cast()
    }
    fn create_and_configure_transpiler<'a>(
        &mut self,
        _bump: &'a bun_alloc::Arena,
    ) -> Result<&'a mut bun_transpiler::Transpiler<'a>, bun_core::Error> {
        // TODO(port): wire `Transpiler::init` + `configure_bundler` once
        // `Transpiler` exposes an arena constructor without the
        // `'a: 'static` bound (bundle_v2.rs:2245 lifetime error upstream).
        Err(bun_core::err!("JSBundleCompletionTask::create_and_configure_transpiler"))
    }
    fn init_and_run<'a>(
        &mut self,
        _transpiler: &'a mut bun_transpiler::Transpiler<'a>,
        _bump: &'a bun_alloc::Arena,
        _thread_pool: &'static bun_threading::ThreadPool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): `BundleV2::init` + `run_from_js_in_new_thread` are
        // gated upstream (bundle_v2::__phase_a_draft).
        Err(bun_core::err!("JSBundleCompletionTask::init_and_run"))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/JSBundleCompletionTask.zig (621 lines)
//   confidence: low
//   notes:      LAYERING MOVE from bun_bundler_jsc — struct depends on
//               bun_runtime types (Config/Plugin/HTMLBundleRoute). Only the
//               HTMLBundle path (`html_build_task`) is fully wired; the
//               `Bun.build()` promise-resolution path (do_compilation,
//               to_js_error) remains in bundler_jsc until BuildArtifact /
//               StandaloneModuleGraph are reachable here.
// ──────────────────────────────────────────────────────────────────────────
