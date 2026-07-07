//! `JSBundleCompletionTask` — owns one in-flight `Bun.build()`.
//!
//! LAYERING: this type lives in `bun_runtime` (not `bun_bundler_jsc`) because
//! its fields name `bun_runtime` types (`JSBundler::Config`, `Plugin`,
//! `HTMLBundle::Route`). `bun_bundler_jsc` is a lower-tier crate and cannot
//! depend on `bun_runtime`. `bun_bundler` reaches back into the task only
//! through the opaque `bundle_v2::dispatch::JsBundleCompletion` handle, whose
//! `bun_bundle_completion_*` link-time symbols are defined at the bottom of
//! this file. The bundle thread itself (`BundleThread`) lives here too, next
//! to its only client.

use bun_options_types::ForceNodeEnv;
use bun_options_types::TargetExt as _;
use core::ptr::{self, NonNull};
use std::io::Write as _;

use bun_alloc::Arena;
use bun_bundler::bundle_v2::{BuildResult, BundleV2, FileMap as Bv2FileMap, dispatch};
use bun_bundler::options::{self, OutputFile, OutputKind, Side};
use bun_bundler::output_file::Value as OutputFileValue;
use bun_bundler::transpiler::Transpiler;
use bun_core::PathBuffer;
use bun_core::String as BunString;
use bun_core::env::OperatingSystem;
use bun_io::KeepAlive;
use bun_jsc::AnyTask::AnyTask;
use bun_jsc::WorkPool;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_options_types::WindowsOptions;
use bun_options_types::schema::api;
use bun_paths::resolve_path::{join_abs_string, join_abs_string_buf, platform};
use bun_paths::{self as paths, SEP};
use bun_ptr::BackRef;
use bun_ptr::RefCount;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileErrorReason, CompileResult, Flags as StandaloneFlags, target_base_public_path,
    to_executable,
};
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;

use crate::api::js_bundler::BuildArtifact;
use crate::api::js_bundler::js_bundler::{Config as JSBundlerConfig, Plugin, PluginJscExt};
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::node::fs::{self as node_fs, NodeFS, args as fs_args};
use crate::node::types::{Encoding, FileSystemFlags, StringOrBuffer};
use crate::server::html_bundle;
use bun_jsc::node_path::{PathLike, PathOrFileDescriptor};

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
extern "C" fn timer_callback(_: *mut bun_libuv_sys::Timer) {}

pub enum BundleV2Result {
    Pending,
    Err(bun_core::Error),
    Value(BuildResult),
}

/// Originally, bake.DevServer required a separate bundling thread, but that was
/// later removed. Owns the worker pool + completion queue for `BundleV2`;
/// completions are `JSBundleCompletionTask`s enqueued from the JS thread.
pub struct BundleThread {
    pub waker: bun_io::Waker,
    /// Port of `std.Thread.ResetEvent` — single-shot manual-reset event
    /// (futex-backed) used to block `spawn()` until the bundle thread has
    /// initialized its `waker`; set-before-wait does not deadlock.
    pub ready_event: bun_threading::ResetEvent,
    // `bun.UnboundedQueue(JSBundleCompletionTask, .next)` — intrusive over
    // the task's `next` link (see the `bun_threading::Linked` impl below).
    pub queue: bun_threading::unbounded_queue::UnboundedQueue<JSBundleCompletionTask>,
    pub generation: bun_core::Generation,
}

impl BundleThread {
    /// To initialize, put this somewhere in memory, and then call `spawn()`
    // We can't use
    // `mem::zeroed()` here — the platform `Waker`s hold NonNull-validity
    // fields (a `Box<[u8]>` on macOS, a niche-optimised `Option<BackRef>` on
    // Windows), so zeroing them is *language-level* UB even if never read.
    // `placeholder()` yields a fully-initialized inert value instead.
    // `ready_event.wait()` in `spawn()` blocks until `thread_main` overwrites
    // it via `ptr::write`, so the placeholder is never observed live.
    pub fn uninitialized() -> Self {
        Self {
            waker: bun_io::Waker::placeholder(),
            queue: bun_threading::unbounded_queue::UnboundedQueue::new(),
            generation: 0,
            ready_event: bun_threading::ResetEvent::default(),
        }
    }

    /// # Safety
    /// `instance` must be valid for `'static` (the spawned thread runs forever and
    /// accesses it). After this returns the bundle thread concurrently accesses
    /// `*instance`; callers must only touch it via the raw-pointer methods on this
    /// impl (e.g. `enqueue`) and never materialize a `&mut Self`.
    pub unsafe fn spawn(instance: *mut Self) -> std::io::Result<std::thread::JoinHandle<()>> {
        // `std::thread::Builder` (not `std::thread::spawn`) so the spawn error
        // is surfaced to the caller.
        struct SendPtr<T>(*mut T);
        // SAFETY: the pointer is only dereferenced on the bundle thread via raw
        // projections; `BundleThread` itself is never moved across threads.
        unsafe impl<T> Send for SendPtr<T> {}
        let ptr = SendPtr(instance);
        let thread = std::thread::Builder::new()
            .name("Bundler".into())
            .spawn(move || {
                let ptr = ptr;
                // SAFETY: caller guarantees `instance` is valid for 'static; `thread_main`
                // accesses fields only via raw-ptr projection (never `&Self`/`&mut Self`)
                // and is the sole writer of `waker`/`generation`, so concurrent `enqueue()`
                // from other threads is sound.
                unsafe { Self::thread_main(ptr.0) }
            })?;
        // SAFETY: field projection via raw ptr — the spawned thread is concurrently
        // writing `waker`, so we must not hold `&Self`/`&mut Self` here. `ready_event`
        // itself is a sync primitive safe to wait on from this thread.
        unsafe { (*instance).ready_event.wait() };
        Ok(thread)
    }

    /// # Safety
    /// `instance` must point to a live `BundleThread` whose bundle thread has been
    /// spawned (so `waker` is initialized). Called concurrently with `thread_main`.
    pub unsafe fn enqueue(instance: *mut Self, completion: *mut JSBundleCompletionTask) {
        // SAFETY: `completion` is a live, caller-owned task node (non-null).
        let completion = unsafe { core::ptr::NonNull::new_unchecked(completion) };
        // SAFETY: field projections via raw ptr — `thread_main` on the bundle thread
        // accesses the same struct concurrently, so we never materialize `&mut Self`.
        // `UnboundedQueue::push` takes `&self` (lock-free MPSC). `Waker::wake` takes
        // `&self` on all platforms (LinuxWaker/Windows/KEventWaker — the latter uses
        // `AtomicBool` for `has_pending_wake`), so this autorefs to `&Waker` and is
        // safe to call concurrently with `wait(&self)` in `thread_main` and with
        // other `enqueue` callers.
        unsafe {
            (*instance).queue.push(completion);
            (*instance).waker.wake();
        }
    }

    unsafe fn thread_main(instance: *mut Self) {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Bundler"));

        // SAFETY: `waker` is written exactly once here, before `ready_event.set()`
        // releases any thread that could call `enqueue` (which reads `waker`).
        unsafe {
            core::ptr::addr_of_mut!((*instance).waker)
                .write(bun_io::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker")));
        }

        // Unblock the calling thread so it can continue.
        // SAFETY: raw-ptr field projection; spawning thread is blocked in `ready_event.wait()`.
        unsafe { (*instance).ready_event.set() };

        // The libuv Timer lives on stack for the lifetime of this never-returning fn.
        // It MUST be declared at function scope (not inside the `#[cfg(windows)] { ... }`
        // block below) because `timer.init()`/`timer.start()` register `&timer`'s address
        // into the uv loop's intrusive handle queue / timer min-heap, and `waker.wait()`
        // (→ `uv_run`) in the `loop {}` below dereferences that address.
        #[cfg(windows)]
        let mut timer: bun_libuv_sys::Timer = bun_core::ffi::zeroed();
        #[cfg(windows)]
        {
            // SAFETY: raw place read of `waker.loop_.uv_loop` (Copy ptr); field is
            // write-once in `Waker::init()` above and never mutated by `wake()`, so a
            // concurrent `enqueue()` (possible now that `ready_event.set()` has fired)
            // does not conflict. No `&Waker`/`&mut Waker` is materialized here.
            timer.init(unsafe { (*instance).waker.uv_loop() });
            timer.start(u64::MAX, u64::MAX, Some(timer_callback));
        }

        let mut has_bundled = false;
        loop {
            loop {
                // SAFETY: `UnboundedQueue::pop` takes `&self`; concurrent `push` from
                // `enqueue` is the lock-free queue's intended use.
                let completion = unsafe { (*instance).queue.pop() };
                if completion.is_null() {
                    break;
                }
                // SAFETY: queue stores non-null pointers pushed via enqueue(); owner keeps
                // the task alive until complete_on_bundle_thread() signals completion.
                let completion = unsafe { &mut *completion };
                // SAFETY: `generation` is only read/written on this (bundle) thread.
                let generation = unsafe { (*instance).generation };
                // `panic = "abort"` → a Rust panic on this thread enters the
                // crash-handler hook and aborts the whole process.
                // No `catch_unwind` — there is nothing to catch.
                match Self::generate_in_new_thread(completion, generation) {
                    Ok(()) => {}
                    Err(err) => {
                        completion.result = BundleV2Result::Err(err);
                        completion.complete_on_bundle_thread();
                    }
                }
                has_bundled = true;
            }
            // SAFETY: `generation` is only read/written on this (bundle) thread.
            unsafe {
                let g = core::ptr::addr_of_mut!((*instance).generation);
                *g = (*g).saturating_add(1);
            }

            if has_bundled {
                bun_alloc::mimalloc::mi_collect(false);
                has_bundled = false;
            }

            // SAFETY: `Waker::wait` takes `&self`; concurrent `wake()` from `enqueue` is by design.
            unsafe { (*instance).waker.wait() };
        }
    }

    /// This is called from `Bun.build` in JavaScript.
    fn generate_in_new_thread(
        completion: &mut JSBundleCompletionTask,
        generation: bun_core::Generation,
    ) -> Result<(), bun_core::Error> {
        let heap = Arena::new();

        let bump = &heap;
        let ast_memory_store: &mut bun_ast::ASTMemoryAllocator =
            bump.alloc(bun_ast::ASTMemoryAllocator::new(bump));
        ast_memory_store.reset();
        ast_memory_store.push();

        // Allocate + configure folded — see `create_and_configure_transpiler` doc.
        let transpiler = completion.create_and_configure_transpiler(bump)?;

        transpiler.resolver.generation = generation;

        // Construction + run delegated — see
        // `init_and_run` doc. Reborrow `transpiler` through a raw ptr so
        // `completion` can be borrowed again below.
        let transpiler_ptr: *mut Transpiler<'_> = transpiler;
        let run = completion.init_and_run(
            // SAFETY: `transpiler` lives in `bump` for the duration of `heap`.
            unsafe { &mut *transpiler_ptr },
            bump,
            // `WorkPool::get()` returns `&'static ThreadPool`; pass as raw so
            // `init_and_run` can hand it to `BundleV2::init` (which stores `*mut`).
            std::ptr::from_ref(bun_threading::work_pool::WorkPool::get()).cast_mut(),
        );

        // Straight-line teardown: log copy
        // runs on both paths; `completeOnBundleThread` only on success (the error
        // path's `Err` result + complete happens in `thread_main`). The
        // `deinitWithoutFreeingArena` + wait-group drain live inside `init_and_run`
        // (it owns `this`).
        let mut out_log = bun_ast::Log::init();
        // SAFETY: `transpiler.log` is the arena-allocated `*mut Log` set up by
        // `configure_bundler`; valid for the lifetime of `heap`. Raw deref so the
        // `&'a mut Transpiler` consumed by `init_and_run` above is not reborrowed.
        let _ = unsafe { (*(*transpiler_ptr).log).append_to_with_recycled(&mut out_log, true) }; // logger OOM-only
        completion.log = out_log;

        if run.is_ok() {
            completion.complete_on_bundle_thread();
        }

        ast_memory_store.pop();

        // `transpiler` / `ast_memory_store` are arena-allocated, but their
        // containers (`Resolver` caches, `BundleOptions` strings, the AST
        // allocator's own `mi_heap` handle, …) live on the global heap as
        // `Vec`/`Box`/`HashMap`, so dropping `heap` (`mi_heap_destroy`) reclaims
        // the struct bytes but never runs `Transpiler::drop` /
        // `ASTMemoryAllocator::drop` — leaking the resolver's directory/file
        // caches and an entire `mi_heap` per `Bun.build()` call. LSan does not
        // flag the latter (mimalloc bypasses the ASAN `malloc` interceptor), so
        // the symptom is RSS-only: ~32 MB/build linear growth in the
        // bun-build-api "does not leak sourcemap JSON" test.
        //
        // SAFETY: both pointers are the unique `&'a mut` slots returned by
        // `bump.alloc(...)` above; nothing else holds a reference to either
        // past `init_and_run` (`completion.transpiler` was cleared by
        // `deinit_without_freeing_arena`, `pop()` restored the AST-allocator
        // thread-local). The arena bytes themselves are bulk-freed afterwards
        // by `heap`'s `Drop` — `drop_in_place` only releases the *embedded
        // global-heap* state, so there is no double free.
        unsafe {
            core::ptr::drop_in_place(transpiler_ptr);
            core::ptr::drop_in_place(std::ptr::from_mut::<bun_ast::ASTMemoryAllocator>(
                ast_memory_store,
            ));
        }

        run
    }
}

/// Lazily-initialized bundle-thread singleton. Lives next to
/// `JSBundleCompletionTask` (its only completion type) so the queue and the
/// task are concretized on one struct — no generic statics, no erased
/// `OnceLock<NonNull<()>>`.
mod bundle_thread_singleton {
    use super::{BundleThread, JSBundleCompletionTask};
    use bun_core::Output;

    struct Instance(core::ptr::NonNull<BundleThread>);
    // SAFETY: the allocation is a leaked `Box<BundleThread>` valid for
    // `'static`; cross-thread access is mediated entirely through
    // `UnboundedQueue` / `ResetEvent` atomics inside `BundleThread::enqueue`.
    unsafe impl Send for Instance {}
    // SAFETY: `&Instance` only exposes the raw pointer; every dereference path
    // goes through `BundleThread::enqueue`'s atomic queue/waker primitives.
    unsafe impl Sync for Instance {}

    static INSTANCE: std::sync::OnceLock<Instance> = std::sync::OnceLock::new();

    // Blocks the calling thread until the bun build thread is created.
    // OnceLock also blocks other callers of this function until the first caller is done.
    fn load_once_impl() -> Instance {
        let bundle_thread = bun_core::heap::into_raw(Box::new(BundleThread::uninitialized()));
        // SAFETY: bundle_thread is a leaked Box, valid for 'static; `spawn`
        // takes the raw pointer directly so no `&mut` is materialized that
        // would alias the bundle thread's own access.
        let os_thread = unsafe { BundleThread::spawn(bundle_thread) }
            .unwrap_or_else(|_| Output::panic(format_args!("Failed to spawn bun build thread")));
        // `std.Thread.detach()` — drop the JoinHandle without joining.
        drop(os_thread);
        // SAFETY: `into_raw` of a `Box` is never null.
        Instance(unsafe { core::ptr::NonNull::new_unchecked(bundle_thread) })
    }

    pub(super) fn enqueue(completion: *mut JSBundleCompletionTask) {
        // Validate the caller's pointer at the public boundary so the unsafe
        // path below never receives null.
        let completion = core::ptr::NonNull::new(completion).unwrap_or_else(|| {
            Output::panic(format_args!("BundleThread enqueue: null completion"))
        });
        let instance = INSTANCE.get_or_init(load_once_impl).0.as_ptr();
        // SAFETY: `instance` is the leaked 'static singleton whose bundle
        // thread is running; `BundleThread::enqueue` only performs raw-ptr
        // field projections.
        unsafe { BundleThread::enqueue(instance, completion.as_ptr()) };
    }
}

/// See module doc for the layering rationale.
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::deinit, debug_name = "JSBundleCompletionTask")]
pub struct JSBundleCompletionTask {
    // NOTE: this should arguably be a thread-safe refcount, but it is the plain
    // (non-atomic) `RefCount<Self>` — a pre-existing discrepancy. See the
    // `unsafe impl Send` below for the thread-affinity constraint this imposes.
    pub ref_count: RefCount<Self>,
    pub config: JSBundlerConfig,
    // BACKREF — the JS-thread `EventLoop` outlives every completion task; safe
    // `Deref` so call sites read `self.jsc_event_loop.enqueue_task_concurrent(..)`.
    pub jsc_event_loop: BackRef<EventLoop>,
    pub task: AnyTask,
    pub global_this: BackRef<JSGlobalObject>,
    pub promise: jsc::JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub env: *mut bun_dotenv::Loader<'static>,
    pub log: bun_ast::Log,
    pub cancelled: bool,

    pub html_build_task: Option<*mut html_bundle::Route>,

    pub result: BundleV2Result,

    /// intrusive queue link (UnboundedQueue)
    pub next: bun_threading::Link<JSBundleCompletionTask>,
    /// arena-owned by BundleThread heap
    pub transpiler: *mut BundleV2<'static>,
    pub plugins: Option<NonNull<Plugin>>,
    pub started_at_ns: u64,
}

impl JSBundleCompletionTask {
    /// `RefCounted` destructor — last ref dropped.
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destructor` upholds the sole-owner contract.
    fn deinit(this: *mut Self) {
        // SAFETY: refcount hit zero; `this` is the sole owner of a
        // `heap::alloc`'d allocation.
        let mut boxed = unsafe { bun_core::heap::take(this) };
        boxed.poll_ref.disable();
        if let Some(plugin) = boxed.plugins.take() {
            // `plugin` is the live FFI handle stashed at construction;
            // last-ref drop is the only place that releases it.
            Plugin::destroy(plugin.as_ptr());
        }
        // Owned fields (`config`, `log`, `result`, `promise`) drop with the Box.
    }
}

// SAFETY: enqueued onto the bundle thread; field access is serialized by
// the producer/consumer handshake (`UnboundedQueue` + `Waker`). Additionally,
// `ref_count` is the non-atomic `RefCount<Self>` (a `Cell<u32>`; its
// `ThreadLock` asserts single-thread affinity in debug builds only), so all
// `ref_()`/`deref()` calls must happen on the JS thread — the bundle thread
// may hold and transfer an already-taken +1 across the handshake but must
// never touch the count itself.
unsafe impl Send for JSBundleCompletionTask {}

/// `BundleV2.createAndScheduleCompletionTask` — construct, take a process-keepalive
/// ref, and hand the task to the bundle-thread singleton.
pub(crate) fn create_and_schedule_completion_task(
    config: JSBundlerConfig,
    plugins: Option<NonNull<Plugin>>,
    global_this: &JSGlobalObject,
    event_loop: *mut EventLoop,
) -> Result<*mut JSBundleCompletionTask, bun_core::Error> {
    let vm = global_this.bun_vm_ptr();
    let env = global_this.bun_vm().transpiler.env;
    let completion = bun_core::heap::into_raw(Box::new(JSBundleCompletionTask {
        ref_count: RefCount::init(),
        config,
        // `event_loop` is the live JS-thread loop (caller derives it from
        // `vm.event_loop()`); never null once `Bun.build` is reachable.
        jsc_event_loop: BackRef::from(core::ptr::NonNull::new(event_loop).expect("event_loop")),
        task: AnyTask::default(),
        global_this: BackRef::new(global_this),
        promise: jsc::JSPromiseStrong::default(),
        poll_ref: KeepAlive::init(),
        env,
        log: bun_ast::Log::init(),
        cancelled: false,
        html_build_task: None,
        result: BundleV2Result::Pending,
        next: bun_threading::Link::new(),
        transpiler: ptr::null_mut(),
        plugins,
        started_at_ns: 0,
    }));
    // SAFETY: freshly-boxed allocation with ref_count == 1; sole handle.
    unsafe {
        (*completion).task =
            AnyTask::from_typed(completion, JSBundleCompletionTask::on_complete_anytask);
        if let Some(plugin) = (*completion).plugins {
            (*plugin.as_ptr()).set_config(completion.cast());
        }
    }

    // Ensure this exists before we spawn the thread to prevent any race
    // conditions from creating two
    let _ = WorkPool::get();

    bundle_thread_singleton::enqueue(completion);

    // SAFETY: `completion` is live (refcount==1); `vm` outlives this call.
    unsafe {
        (*completion)
            .poll_ref
            .ref_(jsc::virtual_machine::VirtualMachine::event_loop_ctx(vm))
    };

    Ok(completion)
}

/// `BundleV2.generateFromJavaScript` — schedule a build and return its Promise.
pub fn generate_from_javascript(
    config: JSBundlerConfig,
    plugins: Option<NonNull<Plugin>>,
    global_this: &JSGlobalObject,
    event_loop: *mut EventLoop,
) -> Result<JSValue, bun_core::Error> {
    let completion = create_and_schedule_completion_task(config, plugins, global_this, event_loop)?;
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
    if s.is_empty() {
        None
    } else {
        Some(Box::from(s))
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

    /// Mutable borrow of the attached `Plugin`, if any.
    ///
    /// Centralises the `Option<NonNull> → Option<&mut T>` deref so callers
    /// (`to_js_error` / `on_complete_anytask`) stay safe. The plugin is a C++
    /// `JSBundlerPlugin` opaque created by [`PluginJscExt::create`] and
    /// `protect()`-ed for the task's lifetime; it is freed only via
    /// `Plugin::destroy` in `deinit` *after* `take()` clears `self.plugins`.
    /// While the field is `Some` the pointee is therefore live, pinned, and
    /// disjoint from `*self` (separate C++-heap allocation).
    #[inline]
    fn plugins_mut(&mut self) -> Option<&mut Plugin> {
        // SAFETY: see fn doc — C++-heap opaque, live while `self.plugins` is
        // `Some`, disjoint from `*self`. Single JS-mutator thread.
        self.plugins.map(|p| unsafe { &mut *p.as_ptr() })
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
        match bun_ast_jsc::log_to_js_array(&self.log, global_this) {
            Ok(v) => build_result.put(global_this, b"logs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };

        let did_handle_callbacks = if self.plugins.is_some() {
            // Compute `rejection` before borrowing the plugin so `&self.log`
            // does not overlap the `&mut self` taken by `plugins_mut()`.
            let rejection = if throw_on_error {
                bun_ast_jsc::log_to_js_aggregate_error(
                    &self.log,
                    global_this,
                    BunString::static_(b"Bundle failed"),
                )
            } else {
                Ok(JSValue::UNDEFINED)
            };
            // Checked `is_some` above; accessor encapsulates the deref.
            let plugin = self.plugins_mut().unwrap();
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
                let aggregate_error = bun_ast_jsc::log_to_js_aggregate_error(
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
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

        // Always get an absolute path for the outfile to ensure it works
        // correctly with PE metadata operations.
        // Add .exe extension for Windows targets if not already present.
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

        #[cfg(not(windows))]
        let mut root_dir = Dir::cwd();
        #[cfg(windows)]
        let root_dir = Dir::cwd();

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
                root_dir = match root_dir.make_open_path(dirname, OpenDirOptions::default()) {
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
                if let Err(err) = root_dir.make_path(dirname) {
                    return CompileResult::fail_fmt(format_args!(
                        "Failed to create output directory {}: {}",
                        bstr::BStr::new(dirname),
                        bstr::BStr::new(err.name()),
                    ));
                }
            }
        }

        // Use the target-specific base path for compile mode, not the user-configured public_path
        let module_prefix = target_base_public_path(compile_options.compile_target.os, b"root/");

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
        let env = unsafe { &mut *self.env.cast::<bun_dotenv::Loader>() };

        let result = match to_executable(
            &compile_options.compile_target,
            output_files,
            root_dir.fd,
            module_prefix,
            outfile_for_executable,
            env,
            self.config.format,
            &WindowsOptions {
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
                return CompileResult::fail_fmt(format_args!("{}", bstr::BStr::new(err.name())));
            }
        };

        if matches!(result, CompileResult::Success) {
            let entry = &mut output_files[entry_point_index];
            entry.dest_path.clone_from(&full_outfile_path);
            entry.is_executable = true;
        }

        // Write external sourcemap files next to the compiled executable and
        // keep them in the output array. Destroy all other non-entry-point files.
        // With --splitting, there can be multiple sourcemap files (one per chunk).
        let mut kept: usize = 0;
        // Swap-compact in place via index iteration so each loop body holds
        // at most one `&mut` into `output_files`.
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

                    let sourcemap_full_path: Box<[u8]> = if dirname.is_empty() || dirname == b"." {
                        Box::from(map_basename)
                    } else {
                        let mut v = Vec::with_capacity(dirname.len() + 1 + map_basename.len());
                        v.extend_from_slice(dirname);
                        v.push(SEP);
                        v.extend_from_slice(map_basename);
                        v.into_boxed_slice()
                    };

                    // Write the sourcemap file to disk next to the executable
                    let mut pathbuf = PathBuffer::uninit();
                    let write_path: &[u8] = if cfg!(windows) {
                        &sourcemap_full_path
                    } else {
                        map_basename
                    };
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
                            bun_ptr::cow_slice::CowSlice::init_unchecked(write_path, false),
                        )),
                        flush: false,
                        data: StringOrBuffer::EncodedSlice(
                            bun_core::zig_string::Slice::from_utf8_never_free(bytes),
                        ),
                        dirfd: root_dir.fd,
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
            // Trailing (dropped) entries are freed by `truncate` below.
        }
        output_files.truncate(kept);

        result
    }

    /// AnyTask trampoline: `onComplete` runs on the JS thread once the bundle
    /// thread posts back via `complete_on_bundle_thread`.
    fn on_complete_anytask(ctx: *mut Self) -> bun_core::JsResult<()> {
        // SAFETY: `ctx` is the heap::alloc allocation registered in `task`.
        let this = unsafe { &mut *ctx };
        // For the +1 taken by `complete_on_bundle_thread` enqueue.
        // SAFETY: `ctx` is the live heap allocation; `adopt` consumes the prior +1 on Drop.
        let _drop_ref = unsafe { bun_ptr::ScopedRef::<Self>::adopt(ctx) };

        let vm = this.global_this.bun_vm_ptr();
        // SAFETY: `vm` is the live per-thread VM (`global_this.bun_vm_ptr()`).
        this.poll_ref
            .unref(unsafe { jsc::virtual_machine::VirtualMachine::event_loop_ctx(vm) });
        if this.cancelled {
            return Ok(());
        }

        if let Some(html_build_task) = this.html_build_task {
            this.plugins = None;
            // SAFETY: `html_build_task` is a backref set by `HTMLBundle::Route` which
            // bumped its own refcount before scheduling and stays alive until this returns.
            // R-2: deref as shared — `on_complete` takes `&self`.
            unsafe { html_bundle::Route::on_complete(&*html_build_task, this) };
            return Ok(());
        }

        // Copy the BackRef out (it is `Copy`) so `global_this` borrows a local
        // instead of `*this` — `do_compilation`/`to_js_error` below need `&mut *this`.
        let global_this_ref = this.global_this;
        let global_this = global_this_ref.get();
        // `Strong::swap` ties the returned `&mut JSPromise` to
        // `&mut this.promise` even though the cell lives on the GC heap (raw
        // ptr deref inside). Detach via raw ptr so `this` can be reborrowed
        // for `result`/`config`/`log` below.
        let promise: *mut JSPromise = this.promise.swap();
        // SAFETY: GC-owned cell; valid for the duration of this JS-thread callback.
        let promise = unsafe { &mut *promise };

        // `do_compilation` borrows `&mut self` while needing
        // `&mut output_files` from inside `self.result`. Temporarily move the
        // Vec out via `take` so the method gets a disjoint `&mut self`.
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
                this.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{}", bstr::BStr::new(err.slice())),
                );
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

        // `to_js_error` borrows `&mut self`, which would overlap a
        // `&mut this.result` match scrutinee. Dispatch the pending/err arms
        // first, then take a fresh `&mut` for Value.
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

                // `output_file.to_js()` needs `&mut OutputFile` while the path
                // computation reads `this.config`. Snapshot the config slices
                // once outside the loop so the per-file `&mut` doesn't overlap
                // `&this.config`.
                let outdir_is_abs = !this.config.outdir.is_empty()
                    && bun_paths::is_absolute(&this.config.outdir.list);
                let outdir = this.config.outdir.list.clone();
                let dir = this.config.dir.list.clone();
                // SAFETY: `FileSystem::instance()` is the process-lifetime singleton
                // initialized during VM startup before any `Bun.build` is reachable.
                let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

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
                        crate::generated_classes::js_BuildArtifact::sourcemap_set_cached(
                            to_assign_on_sourcemap,
                            global_this,
                            result,
                        );
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
                match bun_ast_jsc::log_to_js_array(&this.log, global_this) {
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
                    Bun__setupLazyMetafile(
                        global_this,
                        build_output,
                        metafile_js_str,
                        metafile_md_str,
                    );
                }

                let did_handle_callbacks = if let Some(plugin) = this.plugins_mut() {
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

// ─── C++ FFI ─────────────────────────────────────────────────────────────────
// `jsc.conv` — sysv64 on Windows-x64, C elsewhere. `Bun__setupLazyMetafile` is
// a hand-written C++ symbol from `BundlerMetafile.cpp` (not codegen-emitted),
// so a local extern block is the correct binding.
//
// NOTE: `BuildArtifactPrototype__sourcemapSetCachedValue` is *not* redeclared
// here — codegen already provides it (and a safe `sourcemap_set_cached`
// wrapper) in `crate::generated_classes::js_BuildArtifact`; redeclaring would
// trip `clashing_extern_declarations` once the param types drift.
bun_jsc::jsc_abi_extern! {
    safe fn Bun__setupLazyMetafile(
        global_this: &JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
}

// ─── `dispatch::JsBundleCompletion` up-call definitions ──────────────────────
// `bun_bundler` declares these `unsafe extern "Rust"` and calls them through
// the opaque `JsBundleCompletion` handle stored in `BundleV2.completion`.

#[unsafe(no_mangle)]
unsafe fn bun_bundle_completion_result_is_err(c: &dispatch::JsBundleCompletion) -> bool {
    // SAFETY: dispatch contract — `c` was erased from a live `*mut JSBundleCompletionTask`.
    let this = unsafe { &*c.as_mut_ptr().cast::<JSBundleCompletionTask>() };
    matches!(this.result, BundleV2Result::Err(_))
}

#[unsafe(no_mangle)]
unsafe fn bun_bundle_completion_enqueue_task_concurrent(
    c: &dispatch::JsBundleCompletion,
    task: core::ptr::NonNull<bun_event_loop::ConcurrentTask::ConcurrentTask>,
) {
    // SAFETY: dispatch contract — `c` was erased from a live `*mut JSBundleCompletionTask`.
    let this = unsafe { &*c.as_mut_ptr().cast::<JSBundleCompletionTask>() };
    // `jsc_event_loop` is a BackRef<EventLoop> — safe Deref; the queue
    // takes ownership of `task`.
    this.jsc_event_loop.enqueue_task_concurrent(task);
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<JSBundleCompletionTask>`.
unsafe impl bun_threading::Linked for JSBundleCompletionTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

impl JSBundleCompletionTask {
    /// Port of `JSBundleCompletionTask.configureBundler` — the post-init half
    /// (everything after `transpiler.* = try Transpiler.init(...)`).
    /// `Transpiler::init` itself is called by `create_and_configure_transpiler`
    /// (Rust cannot zero-init `Transpiler<'a>` and write it in place).
    fn configure_bundler<'a>(
        &mut self,
        transpiler: &mut Transpiler<'a>,
        _bump: &'a Arena,
    ) -> Result<(), bun_core::Error> {
        let config = &mut self.config;

        transpiler.options.env.behavior = config.env_behavior;
        transpiler.options.env.prefix = Box::from(config.env_prefix.list.as_slice());
        // `BundleOptions.bundler_feature_flags: Option<Box<StringSet>>` owns
        // its set, so clone rather than alias `config.features`.
        transpiler.options.bundler_feature_flags = Some(Box::new(config.features.clone()?));
        if config.force_node_env != ForceNodeEnv::Unspecified {
            transpiler.options.resolve.force_node_env = config.force_node_env;
        }

        transpiler.options.entry_points = config.entry_points.keys().to_vec().into_boxed_slice();
        // Convert API JSX config back to options.JSX.Pragma
        let jsx_import = &config.jsx.import_source;
        transpiler.options.resolve.jsx = options::jsx::Pragma {
            factory: if !config.jsx.factory.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    options::jsx::MemberList::Static(options::jsx::defaults::FACTORY),
                    &config.jsx.factory,
                )?
            } else {
                options::jsx::MemberList::Static(options::jsx::defaults::FACTORY)
            },
            fragment: if !config.jsx.fragment.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    options::jsx::MemberList::Static(options::jsx::defaults::FRAGMENT),
                    &config.jsx.fragment,
                )?
            } else {
                options::jsx::MemberList::Static(options::jsx::defaults::FRAGMENT)
            },
            runtime: options::jsx::Runtime::from(config.jsx.runtime),
            development: config.jsx.development,
            package_name: if !jsx_import.is_empty() {
                std::borrow::Cow::Owned(jsx_import.to_vec())
            } else {
                std::borrow::Cow::Borrowed(b"react".as_slice())
            },
            classic_import_source: if !jsx_import.is_empty() {
                std::borrow::Cow::Owned(jsx_import.to_vec())
            } else {
                std::borrow::Cow::Borrowed(b"react".as_slice())
            },
            side_effects: config.jsx.side_effects,
            parse: true,
            import_source: options::jsx::ImportSource {
                development: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 16);
                    let _ = write!(&mut v, "{}/jsx-dev-runtime", bstr::BStr::new(jsx_import));
                    std::borrow::Cow::Owned(v)
                } else {
                    std::borrow::Cow::Borrowed(options::jsx::defaults::IMPORT_SOURCE_DEV)
                },
                production: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 12);
                    let _ = write!(&mut v, "{}/jsx-runtime", bstr::BStr::new(jsx_import));
                    std::borrow::Cow::Owned(v)
                } else {
                    std::borrow::Cow::Borrowed(options::jsx::defaults::IMPORT_SOURCE)
                },
            },
        };
        transpiler.options.no_macros = config.no_macros;
        transpiler.options.loaders =
            options::loaders_from_transform_options(config.loaders.as_ref(), config.target)?;
        transpiler
            .options
            .entry_naming
            .clone_from(&config.names.entry_point.data);
        transpiler
            .options
            .chunk_naming
            .clone_from(&config.names.chunk.data);
        transpiler
            .options
            .asset_naming
            .clone_from(&config.names.asset.data);

        transpiler.options.output_format = config.format;
        transpiler.options.bytecode = config.bytecode;
        transpiler.options.generate_cached_bytecode =
            Some(bun_jsc::cached_bytecode::generate_cached_bytecode_for_bundler);
        transpiler.options.resolve.compile = config.compile.is_some();

        // For compile mode, set the public_path to the target-specific base path
        // This ensures embedded resources like yoga.wasm are correctly found
        if let Some(compile_opts) = &config.compile {
            let base_public_path =
                target_base_public_path(compile_opts.compile_target.os, b"root/");
            transpiler.options.resolve.public_path = Box::from(base_public_path);
        } else {
            transpiler.options.resolve.public_path = Box::from(config.public_path.list.as_slice());
        }

        transpiler.options.resolve.output_dir = Box::from(config.outdir.list.as_slice());
        transpiler.options.resolve.root_dir = Box::from(config.rootdir.list.as_slice());
        transpiler.options.minify_syntax = config.minify.syntax;
        transpiler.options.minify_whitespace = config.minify.whitespace;
        transpiler.options.minify_identifiers = config.minify.identifiers;
        transpiler.options.keep_names = config.minify.keep_names;
        transpiler.options.inlining = config.minify.syntax;
        transpiler.options.source_map = config.source_map;
        transpiler.options.resolve.packages = config.packages;
        transpiler.options.allow_unresolved = match &config.allow_unresolved {
            Some(a) => options::AllowUnresolved::from_strings(a.keys().to_vec().into_boxed_slice()),
            None => options::AllowUnresolved::All,
        };
        transpiler.options.code_splitting = config.code_splitting;
        transpiler.options.emit_dce_annotations = config
            .emit_dce_annotations
            .unwrap_or(!config.minify.whitespace);
        transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
        transpiler.options.tree_shaking_override = config.tree_shaking;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.compile_to_standalone_html = 'brk: {
            if config.compile.is_none() || config.target != bun_ast::Target::Browser {
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
            transpiler.options.resolve.compile = false;
            config.compile = None;
        }
        // `BundleOptions.{banner,footer}` are `Cow<'static, [u8]>`; clone into
        // Owned so the static bound holds without tying `&mut self` to `'a`.
        transpiler.options.banner = std::borrow::Cow::Owned(config.banner.list.clone());
        transpiler.options.footer = std::borrow::Cow::Owned(config.footer.list.clone());
        transpiler.options.react_fast_refresh = config.react_fast_refresh;
        transpiler.options.react_compiler = if config.react_compiler.is_enabled() {
            config.react_compiler_output_mode.unwrap_or_else(|| {
                if config.target.is_server_side() {
                    bun_ast::runtime::ReactCompilerMode::Ssr
                } else {
                    bun_ast::runtime::ReactCompilerMode::Client
                }
            })
        } else {
            bun_ast::runtime::ReactCompilerMode::Disabled
        };
        transpiler.options.react_compiler_parse_test_pragmas =
            config.react_compiler_parse_test_pragmas;
        transpiler.options.metafile = config.metafile;
        transpiler.options.metafile_json_path =
            Box::from(config.metafile_json_path.list.as_slice());
        transpiler.options.metafile_markdown_path =
            Box::from(config.metafile_markdown_path.list.as_slice());
        if config.optimize_imports.count() > 0 {
            // SAFETY: `self.config` outlives `bump` and `optimize_imports` is not mutated
            // during the bundle; a bump.alloc'd clone leaked (arena never runs Drop).
            transpiler.options.optimize_imports =
                Some(unsafe { &*core::ptr::from_ref(&config.optimize_imports) });
        }

        if transpiler.options.resolve.compile {
            // Emitting DCE annotations is nonsensical in --compile.
            transpiler.options.emit_dce_annotations = false;
        }

        transpiler.configure_linker();
        transpiler.configure_defines()?;

        if !transpiler.options.resolve.production {
            transpiler
                .options
                .conditions
                .append_slice(&[b"development"])?;
        }
        // `transpiler.env` is the dotenv loader installed by
        // `Transpiler::init`; non-null and valid for `'a`.
        transpiler.resolver.env_loader =
            NonNull::new(transpiler.env.cast::<bun_dotenv::Loader<'_>>());
        // `Resolver.opts` is the resolver-crate subset
        // — re-project from the now-mutated `transpiler.options`.
        transpiler.sync_resolver_opts();
        Ok(())
    }

    fn complete_on_bundle_thread(&mut self) {
        // `jsc_event_loop` is a `BackRef<EventLoop>` — safe Deref.
        // `ConcurrentTask::create` heap-allocates a fresh task; the
        // queue takes ownership of it.
        self.jsc_event_loop
            .enqueue_task_concurrent(jsc::ConcurrentTask::create(self.task.task()));
    }
    fn file_map(&mut self) -> Option<NonNull<Bv2FileMap>> {
        // `FileMap` and `Bv2FileMap` are the same `bun_bundler` type.
        if self.config.files.map.is_empty() {
            None
        } else {
            Some(NonNull::from(&mut self.config.files))
        }
    }
    // The `&'a mut` return is arena-allocated from `bump`, not derived from
    // a `&` input (same pattern as the other arena constructors).
    #[allow(clippy::mut_from_ref)]
    fn create_and_configure_transpiler<'a>(
        &mut self,
        bump: &'a Arena,
    ) -> Result<&'a mut Transpiler<'a>, bun_core::Error> {
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
            // Use the config value, which `configure_bundler` reapplies anyway.
            ignore_dce_annotations: config.ignore_dce_annotations,
            drop: config.drop.keys().to_vec(),
            bunfig_path: Box::default(),
            jsx: Some(config.jsx.clone()),
            ..Default::default()
        };

        let log: *mut bun_ast::Log = &raw mut self.log;
        // SAFETY: `self.env` is the per-VM dotenv loader stashed at
        // construction; cast erases `'_` (bun_dotenv::Loader is invariant on
        // its arena lifetime, but `Transpiler::init` only stores the pointer).
        let env = self.env.cast::<bun_dotenv::Loader<'static>>();
        let t = Transpiler::init(bump, log, opts, Some(env))?;
        let transpiler: &'a mut Transpiler<'a> = bump.alloc(t);

        // Post-init field wiring.
        // Reborrow through a raw ptr so `&mut self` is usable
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
        // `jsc.AnyEventLoop.init(allocator)` — Mini loop. Stack-owned (not
        // bump-allocated) so its `MiniEventLoop::tasks` queue is dropped at
        // scope exit; the bump bulk-free skips Drop. Declared before `bv2` so
        // it outlives the BACKREF in `linker.loop`.
        let mut any_loop = bun_event_loop::AnyEventLoop::default();
        let event_loop: bun_bundler::linker_context_mod::EventLoop =
            Some(NonNull::from(&mut any_loop).cast::<bun_event_loop::AnyEventLoop<'static>>());

        // `thread_pool` is the `WorkPool` singleton (`OnceLock`-backed,
        // process-lifetime, concurrently read by worker threads). Do NOT
        // materialize `&mut` from it — its provenance is `&'static`, so even a
        // never-written-through `&mut` is UB under Stacked Borrows. Keep it raw
        // (`NonNull`) end-to-end; `ThreadPool::init` stores it as `*mut`.
        let worker_pool = NonNull::new(thread_pool);

        // `Graph.heap` is a borrow, so reuse the caller-owned `bump`.
        let mut bv2 = BundleV2::init(transpiler, None, bump, event_loop, None, worker_pool, bump)?;

        // `Plugin` and `JSBundlerPlugin` are the same `bun_bundler` opaque.
        bv2.plugins = self.plugins;
        bv2.completion = Some(NonNull::from(&mut *self).cast::<dispatch::JsBundleCompletion>());
        // SAFETY: `file_map` returns a `NonNull` into `self.config.files`,
        // which outlives `bv2` (both live until `generate_in_new_thread`
        // returns). `BundleV2.file_map: Option<&'a FileMap>` — erase to `'a`.
        bv2.file_map = self.file_map().map(|p| unsafe { &*p.as_ptr() });

        self.transpiler = (&raw mut *bv2).cast();

        // Snapshot entry points as `&[&[u8]]`.
        let entry_points: Vec<&[u8]> = self
            .config
            .entry_points
            .keys()
            .iter()
            .map(|b| &**b)
            .collect();

        let run = bv2.run_from_js_in_new_thread(&entry_points);

        // The AST-allocator pop lives in `generate_in_new_thread`; the
        // source-map wait-group waits run only on the error path.
        match run {
            Ok(build) => {
                self.result = BundleV2Result::Value(build);
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
