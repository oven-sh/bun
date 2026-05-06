use core::ffi::c_void;
use std::sync::Once;

use bun_aio as Async;
use bun_alloc::Arena; // MimallocArena → bumpalo::Bump
use bun_core::{self, Output};
use bun_js_parser as js_ast;
use bun_logger as Logger;
use bun_threading::WorkPool;

use crate::BundleV2;

/// Used to keep the bundle thread from spinning on Windows
pub extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

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
    pub ready_event: bun_threading::ResetEvent, // TODO(port): std.Thread.ResetEvent equivalent
    // TODO(port): bun.UnboundedQueue is intrusive over `C.next`; encode field offset via trait/const
    pub queue: bun_collections::UnboundedQueue<C>,
    pub generation: bun_core::Generation,
}

/// Trait capturing the interface the Zig `CompletionStruct: type` parameter must satisfy.
// TODO(port): Zig used `anytype`-style duck typing; verify field/method set matches JSBundleCompletionTask
pub trait CompletionStruct: 'static {
    fn configure_bundler(
        &mut self,
        transpiler: &mut bun_bundler::Transpiler,
        bump: &Arena,
    ) -> Result<(), bun_core::Error>;
    fn complete_on_bundle_thread(&mut self);
    // Field accessors the Zig code touched directly:
    fn set_result(&mut self, result: crate::bundle_v2::BundleResult); // TODO(port): exact result enum type
    fn set_log(&mut self, log: Logger::Log);
    fn set_transpiler(&mut self, this: *mut BundleV2);
    fn plugins(&self) -> Option<*mut crate::bundle_v2::JSBundlerPlugin>; // TODO(port): lifetime
    fn config_files(&mut self) -> &mut crate::bundle_v2::FileMap; // TODO(port): exact type of completion.config.files
}

impl<C: CompletionStruct> BundleThread<C> {
    /// To initialize, put this somewhere in memory, and then call `spawn()`
    // TODO(port): Zig `uninitialized` left `waker` as `undefined`; using a zeroed/default placeholder.
    pub fn uninitialized() -> Self {
        Self {
            // SAFETY: waker is overwritten in thread_main before any use; ready_event.wait()
            // in spawn() blocks until that happens.
            waker: unsafe { core::mem::zeroed() },
            queue: bun_collections::UnboundedQueue::default(),
            generation: 0,
            ready_event: bun_threading::ResetEvent::default(),
        }
    }

    /// # Safety
    /// `instance` must be valid for `'static` (the spawned thread runs forever and
    /// accesses it). After this returns the bundle thread concurrently accesses
    /// `*instance`; callers must only touch it via the raw-pointer methods on this
    /// impl (e.g. `enqueue`) and never materialize a `&mut Self`.
    pub unsafe fn spawn(instance: *mut Self) -> Result<bun_threading::Thread, bun_core::Error> {
        // TODO(port): narrow error set
        let thread = bun_threading::Thread::spawn(move || {
            // SAFETY: caller guarantees `instance` is valid for 'static; `thread_main`
            // accesses fields only via raw-ptr projection (never `&Self`/`&mut Self`)
            // and is the sole writer of `waker`/`generation`, so concurrent `enqueue()`
            // from other threads is sound.
            unsafe { Self::thread_main(instance) }
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
        // safe to call concurrently with `wait(&self)` at .rs:thread_main and with
        // other `enqueue` callers.
        unsafe { (*instance).queue.push(completion) };
        unsafe { (*instance).waker.wake() };
    }

    unsafe fn thread_main(instance: *mut Self) {
        Output::Source::configure_named_thread("Bundler");

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
            // TODO(port): libuv Timer lives on stack for the lifetime of this never-returning fn
            let mut timer: bun_sys::windows::libuv::Timer =
                unsafe { core::mem::zeroed() }; // SAFETY: init() fully initializes before use
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
                    completion.set_result(crate::bundle_v2::BundleResult::Err(err));
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
                bun_alloc::mi_collect(false); // TODO(port): move to bun_alloc_sys
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
        // TODO(port): narrow error set
        let mut heap = Arena::new(); // ThreadLocalArena.init()
        // `defer heap.deinit()` — Drop handles this.

        let bump = &heap;
        let ast_memory_allocator: &mut js_ast::ASTMemoryAllocator =
            bump.alloc(js_ast::ASTMemoryAllocator { allocator: bump });
        ast_memory_allocator.reset();
        ast_memory_allocator.push();

        let transpiler: &mut bun_bundler::Transpiler =
            bump.alloc(bun_bundler::Transpiler::default()); // TODO(port): Zig left this uninit until configure_bundler

        completion.configure_bundler(transpiler, bump)?;

        transpiler.resolver.generation = generation;

        let this: &mut BundleV2 = BundleV2::init(
            transpiler,
            None, // TODO: Kit
            bump,
            bun_event_loop::AnyEventLoop::init(),
            false,
            WorkPool::get(),
            &mut heap,
        )?;
        // PORT NOTE: reshaped for borrowck — `bump` borrows `heap` immutably while `&mut heap`
        // is passed last; Phase B may need to restructure BundleV2::init signature.

        this.plugins = completion.plugins();
        // Zig: switch (CompletionStruct) { BundleV2.JSBundleCompletionTask => completion, else => @compileError(...) }
        // TODO(port): compile-time type assertion that C == JSBundleCompletionTask; for now cast.
        this.completion = Some(completion as *mut C as *mut BundleV2::JSBundleCompletionTask);
        // Set the file_map pointer for in-memory file support
        this.file_map = if completion.config_files().map.count() > 0 {
            Some(completion.config_files() as *mut _)
        } else {
            None
        };
        completion.set_transpiler(this);

        // defer { ast_memory_allocator.pop(); this.deinitWithoutFreeingArena(); }
        let _defer = scopeguard::guard((), |_| {
            ast_memory_allocator.pop();
            this.deinit_without_freeing_arena();
        });
        // TODO(port): errdefer captures ≥2 disjoint &mut borrows (this.linker, this.transpiler.log,
        // completion); scopeguard cannot cleanly express this alongside the defer above.
        let _errdefer = scopeguard::guard((), |_| {
            // Wait for wait groups to finish. There still may be ongoing work.
            this.linker.source_maps.line_offset_wait_group.wait();
            this.linker.source_maps.quoted_contents_wait_group.wait();

            let mut out_log = Logger::Log::init();
            this.transpiler.log.append_to_with_recycled(&mut out_log, true);
            completion.set_log(out_log);
        });

        let value = this.run_from_js_in_new_thread(&transpiler.options.entry_points)?;
        completion.set_result(crate::bundle_v2::BundleResult::Value(value));

        // Disarm errdefer on success.
        scopeguard::ScopeGuard::into_inner(_errdefer);

        let mut out_log = Logger::Log::init();
        this.transpiler.log.append_to_with_recycled(&mut out_log, true);
        completion.set_log(out_log);
        completion.complete_on_bundle_thread();
        Ok(())
    }
}

/// Lazily-initialized singleton. This is used for `Bun.build` since the
/// bundle thread may not be needed.
// TODO(port): Zig had a per-monomorphization `singleton` struct with `static var instance`.
// Rust forbids generic statics; Phase B should instantiate this once for the concrete
// `JSBundleCompletionTask` type (the only valid `CompletionStruct` per the @compileError check).
pub mod singleton {
    use super::*;

    static ONCE: Once = Once::new();
    static mut INSTANCE: Option<*mut BundleThread<BundleV2::JSBundleCompletionTask>> = None;

    // Blocks the calling thread until the bun build thread is created.
    // std.once also blocks other callers of this function until the first caller is done.
    fn load_once_impl() {
        let bundle_thread = Box::into_raw(Box::new(BundleThread::uninitialized()));
        // SAFETY: only called once under ONCE.
        unsafe { INSTANCE = Some(bundle_thread) };

        // 2. Spawn the bun build thread.
        // SAFETY: bundle_thread is a leaked Box, valid for 'static; `spawn` takes the
        // raw pointer directly so no `&mut` is materialized that would alias the
        // bundle thread's own access.
        let os_thread = unsafe { BundleThread::spawn(bundle_thread) }
            .unwrap_or_else(|_| Output::panic("Failed to spawn bun build thread"));
        os_thread.detach();
    }

    /// Returns the raw singleton pointer. The bundle thread runs `thread_main`
    /// against this allocation for the process lifetime, so callers MUST NOT
    /// materialize `&mut BundleThread` from it (Zig `*Self` aliasing semantics).
    /// Use `BundleThread::enqueue(get(), ...)` instead.
    pub fn get() -> *mut BundleThread<BundleV2::JSBundleCompletionTask> {
        ONCE.call_once(load_once_impl);
        // SAFETY: INSTANCE is Some after call_once and never written again; pointer is
        // a leaked 'static Box.
        unsafe { INSTANCE.unwrap() }
    }

    pub fn enqueue(completion: *mut BundleV2::JSBundleCompletionTask) {
        // SAFETY: `get()` returns the leaked 'static singleton whose bundle thread is
        // running; `BundleThread::enqueue` only performs raw-ptr field projections.
        unsafe { BundleThread::enqueue(get(), completion) };
    }
}

pub use bun_js_parser::Ref;

pub use bun_js_parser::Index;

pub use crate::DeferredBatchTask;
pub use crate::ThreadPool;
pub use crate::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/BundleThread.zig (195 lines)
//   confidence: medium
//   todos:      13
//   notes:      generic-static singleton collapsed to concrete JSBundleCompletionTask; defer/errdefer overlap needs borrowck reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
