use core::ptr::NonNull;
use std::sync::Once;

use bun_aio as Async;
use bun_alloc::Arena; // MimallocArena → bumpalo::Bump (ThreadLocalArena)
use bun_core::{self, zstr, Output};
use bun_js_parser as js_ast;
use bun_logger as Logger;
use bun_threading::unbounded_queue::{Node, UnboundedQueue};

use crate::bundle_v2::{FileMap, JSBundleCompletionTask, JSBundlerPlugin};
use crate::{BundleV2, Transpiler};

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
pub extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

/// Port of `std.Thread.ResetEvent` — single-shot manual-reset event used to
/// block `spawn()` until the bundle thread has initialized its `Waker`.
// PORT NOTE: `bun_threading` has no ResetEvent; this is the minimal subset
// (`wait`/`set`) the Zig source touches. Backed by `parking_lot` so wakeups
// are not lost if `set()` races ahead of `wait()`.
#[derive(Default)]
pub struct ResetEvent {
    inner: parking_lot::Mutex<bool>,
    cv: parking_lot::Condvar,
}

impl ResetEvent {
    pub fn wait(&self) {
        let mut guard = self.inner.lock();
        while !*guard {
            self.cv.wait(&mut guard);
        }
    }

    pub fn set(&self) {
        let mut guard = self.inner.lock();
        *guard = true;
        self.cv.notify_all();
    }
}

/// Result of a `Bun.build` invocation handed back to the JS thread.
// PORT NOTE: mirrors `BundleV2.JSBundleCompletionTask.Result` (bundle_v2.zig).
// Defined here (not re-exported from `bundle_v2`) because the un-gated
// `bundle_v2` module keeps the draft body private; T6 (`bundler_jsc`) consumes
// this via the `CompletionStruct` trait.
pub struct BuildResult {
    pub output_files: Vec<crate::options::OutputFile>,
    pub metafile: Option<Box<[u8]>>,
    pub metafile_markdown: Option<Box<[u8]>>,
}

pub enum BundleV2Result {
    Pending,
    Err(bun_core::Error),
    Value(BuildResult),
}

/// Originally, bake.DevServer required a separate bundling thread, but that was
/// later removed. The bundling thread's scheduling logic is generalized over
/// the completion structure.
///
/// CompletionStruct's interface:
///
/// - `configureBundler` is used to configure `Bundler`.
/// - `completeOnBundleThread` is used to tell the task that it is done.
pub struct BundleThread<C: CompletionStruct> {
    pub waker: Async::Waker,
    pub ready_event: ResetEvent,
    // `bun.UnboundedQueue(CompletionStruct, .next)` — intrusive over `C.next`;
    // the field offset is encoded via the `Node` supertrait on `CompletionStruct`.
    pub queue: UnboundedQueue<C>,
    pub generation: bun_core::Generation,
}

/// Trait capturing the interface the Zig `CompletionStruct: type` parameter
/// must satisfy.
///
/// Zig used comptime duck typing and additionally asserted (via `@compileError`)
/// that the *only* valid instantiation is `BundleV2.JSBundleCompletionTask`.
/// The body of `generateInNewThread` directly touched JSBundleCompletionTask
/// fields (`.result`, `.log`, `.plugins`, `.config.files`, `.transpiler`); in
/// Rust those become trait accessors so the generic `BundleThread<C>` stays
/// layout-agnostic. The concrete impl lives in T6 (`bun_bundler_jsc`).
pub trait CompletionStruct: Node + Send + 'static {
    /// Zig: `completion.configureBundler(transpiler, allocator)`
    fn configure_bundler(
        &mut self,
        transpiler: &mut Transpiler<'_>,
        bump: &Arena,
    ) -> Result<(), bun_core::Error>;
    /// Zig: `completion.completeOnBundleThread()`
    fn complete_on_bundle_thread(&mut self);
    /// Zig: `completion.result = .{ .err | .value }`
    fn set_result(&mut self, result: BundleV2Result);
    /// Zig: `completion.log = out_log`
    fn set_log(&mut self, log: Logger::Log);
    /// Zig: `completion.transpiler = this`
    fn set_transpiler(&mut self, this: *mut BundleV2<'_>);
    /// Zig: `completion.plugins`
    fn plugins(&self) -> Option<NonNull<JSBundlerPlugin>>;
    /// Zig: `if (completion.config.files.map.count() > 0) &completion.config.files else null`
    /// — folded into a single accessor so the opaque `FileMap` layout stays in T6.
    fn file_map(&mut self) -> Option<NonNull<FileMap>>;
    /// Zig: `switch (CompletionStruct) { BundleV2.JSBundleCompletionTask => completion, … }`
    /// — the comptime type-switch collapses to a cast the impl provides.
    fn as_js_bundle_completion_task(&mut self) -> NonNull<JSBundleCompletionTask>;
}

impl<C: CompletionStruct> BundleThread<C> {
    /// To initialize, put this somewhere in memory, and then call `spawn()`
    // PORT NOTE: Zig `uninitialized` left `waker` as `undefined`; using a zeroed
    // placeholder. `ready_event.wait()` in `spawn()` blocks until `thread_main`
    // overwrites it, so the zeroed bytes are never observed.
    pub fn uninitialized() -> Self {
        Self {
            // SAFETY: waker is overwritten in thread_main before any use; ready_event.wait()
            // in spawn() blocks until that happens.
            waker: unsafe { core::mem::zeroed() },
            queue: UnboundedQueue::new(),
            generation: 0,
            ready_event: ResetEvent::default(),
        }
    }

    /// # Safety
    /// `instance` must be valid for `'static` (the spawned thread runs forever and
    /// accesses it). After this returns the bundle thread concurrently accesses
    /// `*instance`; callers must only touch it via the raw-pointer methods on this
    /// impl (e.g. `enqueue`) and never materialize a `&mut Self`.
    pub unsafe fn spawn(instance: *mut Self) -> std::io::Result<std::thread::JoinHandle<()>> {
        // PORT NOTE: `std.Thread.spawn(.{}, threadMain, .{instance})` →
        // `std::thread::Builder` so the spawn error is surfaced (Zig used `try`).
        struct SendPtr<T>(*mut T);
        // SAFETY: the pointer is only dereferenced on the bundle thread via raw
        // projections; `BundleThread<C>` itself is never moved across threads.
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
    pub unsafe fn enqueue(instance: *mut Self, completion: *mut C) {
        // SAFETY: field projections via raw ptr — `thread_main` on the bundle thread
        // accesses the same struct concurrently, so we never materialize `&mut Self`.
        // `UnboundedQueue::push` takes `&self` (lock-free MPSC). `Waker::wake` takes
        // `&self` on all platforms (LinuxWaker/Windows/KEventWaker — the latter uses
        // `AtomicBool` for `has_pending_wake`), so this autorefs to `&Waker` and is
        // safe to call concurrently with `wait(&self)` in `thread_main` and with
        // other `enqueue` callers.
        unsafe { (*instance).queue.push(completion) };
        unsafe { (*instance).waker.wake() };
    }

    unsafe fn thread_main(instance: *mut Self) {
        Output::Source::configure_named_thread(zstr!("Bundler"));

        // SAFETY: `waker` is written exactly once here, before `ready_event.set()`
        // releases any thread that could call `enqueue` (which reads `waker`).
        unsafe {
            core::ptr::addr_of_mut!((*instance).waker)
                .write(Async::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker")));
        }

        // Unblock the calling thread so it can continue.
        // SAFETY: raw-ptr field projection; spawning thread is blocked in `ready_event.wait()`.
        unsafe { (*instance).ready_event.set() };

        #[cfg(windows)]
        {
            // PORT NOTE: libuv Timer lives on stack for the lifetime of this never-returning fn.
            // SAFETY: `init()` fully initializes before use.
            let mut timer: bun_sys::windows::libuv::Timer = unsafe { core::mem::zeroed() };
            // SAFETY: raw place read of `waker.loop_.uv_loop` (Copy ptr); field is
            // write-once in `Waker::init()` above and never mutated by `wake()`, so a
            // concurrent `enqueue()` (possible now that `ready_event.set()` has fired)
            // does not conflict. No `&Waker`/`&mut Waker` is materialized here.
            timer.init(unsafe { (*instance).waker.loop_.uv_loop });
            timer.start(u64::MAX, u64::MAX, timer_callback);
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
                // SAFETY: queue stores non-null *mut C pushed via enqueue(); owner keeps it alive
                // until complete_on_bundle_thread() signals completion.
                let completion = unsafe { &mut *completion };
                // SAFETY: `generation` is only read/written on this (bundle) thread.
                let generation = unsafe { (*instance).generation };
                if let Err(err) = Self::generate_in_new_thread(completion, generation) {
                    completion.set_result(BundleV2Result::Err(err));
                    completion.complete_on_bundle_thread();
                }
                has_bundled = true;
            }
            // SAFETY: `generation` is only read/written on this (bundle) thread.
            unsafe {
                let gen = core::ptr::addr_of_mut!((*instance).generation);
                *gen = (*gen).saturating_add(1);
            }

            if has_bundled {
                // SAFETY: `mi_collect(false)` is a thread-local heap sweep with no preconditions.
                unsafe { bun_alloc::mimalloc::mi_collect(false) };
                has_bundled = false;
            }

            // SAFETY: `Waker::wait` takes `&self`; concurrent `wake()` from `enqueue` is by design.
            let _ = unsafe { (*instance).waker.wait() };
        }
    }

    /// This is called from `Bun.build` in JavaScript.
    fn generate_in_new_thread(
        completion: &mut C,
        generation: bun_core::Generation,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: `ThreadLocalArena.init()` → `bun_alloc::Arena::new()` (bumpalo
        // bump arena; `defer heap.deinit()` is handled by Drop).
        let heap = Arena::new();

        let bump = &heap;
        let ast_memory_allocator: &mut js_ast::ASTMemoryAllocator =
            bump.alloc(js_ast::ASTMemoryAllocator::new(bump));
        ast_memory_allocator.reset();
        ast_memory_allocator.push();

        // PORT NOTE: Zig left this `undefined` until `configureBundler` filled it
        // in-place; Rust requires an initialized value, so `Default` then configure.
        let transpiler: &mut Transpiler<'_> = bump.alloc(Transpiler::default());

        completion.configure_bundler(transpiler, bump)?;

        transpiler.resolver.generation = generation;

        // PORT NOTE: borrowck — `BundleV2::init` (in the Zig spec) consumes the
        // arena by value as `heap` while also borrowing `bump = &heap`. The Rust
        // signature is being reshaped in B-2 (see `bundle_v2.rs:__phase_a_draft`);
        // here we hand it the raw `*mut Transpiler` + arena ref and let `init`
        // own its own pool/heap wiring.
        let this: &mut BundleV2<'_> = bump.alloc(BundleV2::init_in_arena(
            transpiler as *mut _,
            bump,
            // `jsc.AnyEventLoop.init(allocator)` — erased `EventLoop` slot. The
            // bundler stores `Option<NonNull<()>>` (see `LinkerContext::EventLoop`);
            // the concrete `MiniEventLoop` is wired by T6 when it constructs the
            // completion task.
            None,
            false,
            bun_threading::work_pool::WorkPool::get(),
        )?);

        this.plugins = completion.plugins();
        // Zig: switch (CompletionStruct) { BundleV2.JSBundleCompletionTask => completion, else => @compileError(...) }
        this.completion = Some(completion.as_js_bundle_completion_task());
        // Set the file_map pointer for in-memory file support
        this.file_map = completion.file_map();
        completion.set_transpiler(this as *mut _);

        // defer { ast_memory_allocator.pop(); this.deinitWithoutFreeingArena(); }
        // errdefer { wait groups; copy log }
        // PORT NOTE: Zig's overlapping defer/errdefer captured ≥2 disjoint &mut
        // borrows. Restructured as straight-line: run, branch on result, then
        // unconditional cleanup. Semantics preserved (errdefer body runs only
        // on the error path; defer body runs on both).
        let entry_points: &[Box<[u8]>] = unsafe { &(*this.transpiler).options.entry_points };
        let run_result = this.run_from_js_in_new_thread(entry_points);

        let out = match run_result {
            Ok(value) => {
                completion.set_result(BundleV2Result::Value(value));

                let mut out_log = Logger::Log::init();
                // SAFETY: `this.transpiler` is the `*mut Transpiler` stored above;
                // valid for the lifetime of `heap`.
                unsafe { (*(*this.transpiler).log).append_to_with_recycled(&mut out_log, true) };
                completion.set_log(out_log);
                completion.complete_on_bundle_thread();
                Ok(())
            }
            Err(err) => {
                // Wait for wait groups to finish. There still may be ongoing work.
                this.linker.source_maps.line_offset_wait_group.wait();
                this.linker.source_maps.quoted_contents_wait_group.wait();

                let mut out_log = Logger::Log::init();
                // SAFETY: as above.
                unsafe { (*(*this.transpiler).log).append_to_with_recycled(&mut out_log, true) };
                completion.set_log(out_log);
                Err(err)
            }
        };

        ast_memory_allocator.pop();
        this.deinit_without_freeing_arena();
        out
    }
}

/// Lazily-initialized singleton. This is used for `Bun.build` since the
/// bundle thread may not be needed.
// PORT NOTE: Zig had a per-monomorphization `singleton` struct with
// `static var instance`. Rust forbids generic statics; the Zig source already
// `@compileError`s for any `CompletionStruct` other than `JSBundleCompletionTask`,
// so the singleton is instantiated once for that concrete type. T6 provides the
// `CompletionStruct` impl for the opaque `JSBundleCompletionTask` forward-decl.
pub mod singleton {
    use super::*;

    static ONCE: Once = Once::new();
    static mut INSTANCE: *mut BundleThread<JSBundleCompletionTask> = core::ptr::null_mut();

    // Blocks the calling thread until the bun build thread is created.
    // std.once also blocks other callers of this function until the first caller is done.
    fn load_once_impl()
    where
        JSBundleCompletionTask: CompletionStruct,
    {
        let bundle_thread = Box::into_raw(Box::new(BundleThread::uninitialized()));
        // SAFETY: only called once under ONCE.
        unsafe { INSTANCE = bundle_thread };

        // 2. Spawn the bun build thread.
        // SAFETY: bundle_thread is a leaked Box, valid for 'static; `spawn` takes the
        // raw pointer directly so no `&mut` is materialized that would alias the
        // bundle thread's own access.
        let os_thread = unsafe { BundleThread::spawn(bundle_thread) }
            .unwrap_or_else(|_| Output::panic(format_args!("Failed to spawn bun build thread")));
        // `std.Thread.detach()` — drop the JoinHandle without joining.
        drop(os_thread);
    }

    /// Returns the raw singleton pointer. The bundle thread runs `thread_main`
    /// against this allocation for the process lifetime, so callers MUST NOT
    /// materialize `&mut BundleThread` from it (Zig `*Self` aliasing semantics).
    /// Use `BundleThread::enqueue(get(), ...)` instead.
    pub fn get() -> *mut BundleThread<JSBundleCompletionTask>
    where
        JSBundleCompletionTask: CompletionStruct,
    {
        ONCE.call_once(load_once_impl);
        // SAFETY: INSTANCE is non-null after call_once and never written again; pointer is
        // a leaked 'static Box.
        unsafe { INSTANCE }
    }

    pub fn enqueue(completion: *mut JSBundleCompletionTask)
    where
        JSBundleCompletionTask: CompletionStruct,
    {
        // SAFETY: `get()` returns the leaked 'static singleton whose bundle thread is
        // running; `BundleThread::enqueue` only performs raw-ptr field projections.
        unsafe { BundleThread::enqueue(get(), completion) };
    }
}

pub use bun_js_parser::Index;
pub use bun_js_parser::Ref;

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/BundleThread.zig (195 lines)
//   confidence: medium
//   todos:      0
//   notes:      generic-static singleton collapsed to concrete JSBundleCompletionTask;
//               defer/errdefer rewritten straight-line; Waker via bun_aio (new dep);
//               ResetEvent ported locally (parking_lot-backed)
// ──────────────────────────────────────────────────────────────────────────
