use core::ptr::NonNull;
use core::sync::atomic::{AtomicU16, AtomicU32, Ordering};

use bun_alloc::Arena; // MimallocArena → bumpalo::Bump (ThreadLocalArena)
use bun_core::{self, Output, zstr};
use bun_io as Async;
use bun_threading::unbounded_queue::{Node, UnboundedQueue};

use crate::bundle_v2::{FileMap, JSBundlerPlugin, dispatch};
use crate::{BundleV2, Transpiler};

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
pub(crate) extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

/// Port of `std.Thread.ResetEvent` — single-shot manual-reset event used to
/// block `spawn()` until the bundle thread has initialized its `Waker`.
// Re-exports `bun_threading::ResetEvent` (futex-backed); the futex impl
// preserves the "set-before-wait does not deadlock" property `spawn()` relies on.
pub use bun_threading::ResetEvent;

/// Result of a `Bun.build` invocation handed back to the JS thread.
/// Consumed by `bundler_jsc` via the `CompletionStruct` trait.
pub struct BuildResult {
    pub output_files: Vec<crate::options::OutputFile>,
    pub metafile: Option<Box<[u8]>>,
    pub metafile_markdown: Option<Box<[u8]>>,
}

pub enum BundleV2Result {
    Pending,
    Err(crate::Error),
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
// The trait bound lives on the `impl` (not the struct) so the
// `singleton` static can name `BundleThread<JSBundleCompletionTask>` before T6
// provides the `CompletionStruct` impl for the forward-decl.
pub struct BundleThread<C: Node> {
    pub waker: Async::Waker,
    pub ready_event: ResetEvent,
    // `bun.UnboundedQueue(CompletionStruct, .next)` — intrusive over `C.next`;
    // the field offset is encoded via the `Node` supertrait on `CompletionStruct`.
    pub queue: UnboundedQueue<C>,
    /// Resolver cache-invalidation counter. Incremented by `thread_main` between
    /// queue batches; read (possibly from an overflow thread) before each build.
    /// Atomic only so the cross-thread read is well-defined; ordering is
    /// irrelevant since concurrent builds legitimately share a generation.
    pub generation: AtomicU16,
    /// Builds scheduled via [`singleton::enqueue`] and not yet completed.
    /// Incremented there, decremented after `generate_in_new_thread` returns
    /// (on whichever thread ran it). The enqueue that observes the 0→1
    /// transition uses the singleton thread; any other goes to an overflow
    /// thread. This makes two `Bun.build` calls issued back-to-back on the JS
    /// thread deterministic: the second always overflows, regardless of whether
    /// `thread_main` has woken yet.
    pub scheduled: AtomicU32,
}

/// Trait capturing the interface a completion task must satisfy.
///
/// The trait accessors keep the generic `BundleThread<C>`
/// layout-agnostic. The concrete impl lives in T6 (`bun_bundler_jsc`).
pub trait CompletionStruct: Node + Send + 'static {
    /// `bump` is the per-build mimalloc heap that backs `transpiler`, so the
    /// two share lifetime `'a` (option fields like `optimize_imports: &'a
    /// StringSet` borrow from `bump`).
    fn configure_bundler<'a>(
        &mut self,
        transpiler: &mut Transpiler<'a>,
        bump: &'a Arena,
    ) -> Result<(), crate::Error>;
    fn complete_on_bundle_thread(&mut self);
    fn set_result(&mut self, result: BundleV2Result);
    fn set_log(&mut self, log: bun_ast::Log);
    fn set_transpiler(&mut self, this: *mut BundleV2<'_>);
    fn plugins(&self) -> Option<NonNull<JSBundlerPlugin>>;
    /// Returns the file map if non-empty; a single accessor so the opaque
    /// `FileMap` layout stays in T6.
    fn file_map(&mut self) -> Option<NonNull<FileMap>>;
    /// Returns a §Dispatch handle (erased owner + `&'static` vtable) the impl
    /// provides, so the bundler can read `result == .err` /
    /// `jsc_event_loop.enqueueTaskConcurrent` without naming the concrete
    /// struct.
    fn as_js_bundle_completion_task(&mut self) -> dispatch::CompletionHandle;

    /// `Transpiler<'a>` has borrow-carrying fields (`arena: &'a Arena`,
    /// `resolver: Resolver<'a>`) that cannot be zero-init'd, so the allocate +
    /// configure pair is folded into one trait call returning the
    /// arena-allocated, fully-configured transpiler.
    // The returned `&'a mut Transpiler<'a>` is arena-allocated via `bump.alloc(...)`
    // (bumpalo `Bump`), which hands out `&mut` from `&self` through interior
    // mutability — the standard arena pattern `mut_from_ref` cannot see through.
    #[allow(clippy::mut_from_ref)]
    fn create_and_configure_transpiler<'a>(
        &mut self,
        bump: &'a Arena,
    ) -> Result<&'a mut Transpiler<'a>, crate::Error>;

    /// Constructs the `BundleV2`, wires `plugins`/`completion`/`file_map`,
    /// and runs the bundle.
    ///
    /// This body is `JSBundleCompletionTask`-specific, so the
    /// construction + run is delegated to the trait impl in T6, which has
    /// access to the concrete event-loop / work-pool wiring. The shared
    /// scaffolding (arena, AST arena push/pop, log copy,
    /// `completeOnBundleThread`) stays in `generate_in_new_thread` below.
    fn init_and_run<'a>(
        &mut self,
        transpiler: &'a mut Transpiler<'a>,
        bump: &'a Arena,
        // Raw `*mut` (not `&'static`) because `BundleV2::init` ultimately
        // stores it as `worker_pool: *mut ThreadPool` and `WorkPool::get()`
        // hands out `&'static`; materializing `&mut` from that would be UB.
        thread_pool: *mut bun_threading::ThreadPool,
    ) -> Result<(), crate::Error>;
}

impl<C: CompletionStruct> BundleThread<C> {
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
            waker: Async::Waker::placeholder(),
            queue: UnboundedQueue::new(),
            generation: AtomicU16::new(0),
            ready_event: ResetEvent::default(),
            scheduled: AtomicU32::new(0),
        }
    }

    /// # Safety
    /// `instance` must be valid for `'static` (the spawned thread runs forever and
    /// accesses it). After this returns the bundle thread concurrently accesses
    /// `*instance`; callers must only touch it via the raw-pointer methods on this
    /// impl (e.g. `enqueue_or_spawn`) and never materialize a `&mut Self`.
    pub unsafe fn spawn(instance: *mut Self) -> std::io::Result<std::thread::JoinHandle<()>> {
        // `std::thread::Builder` (not `std::thread::spawn`) so the spawn error
        // is surfaced to the caller.
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
                // and is the sole writer of `waker`/`generation`, so concurrent `enqueue_or_spawn()`
                // from other threads is sound.
                unsafe { Self::thread_main(ptr.0) }
            })?;
        // SAFETY: field projection via raw ptr — the spawned thread is concurrently
        // writing `waker`, so we must not hold `&Self`/`&mut Self` here. `ready_event`
        // itself is a sync primitive safe to wait on from this thread.
        unsafe { (*instance).ready_event.wait() };
        Ok(thread)
    }

    /// Schedule one completion. When no other build is outstanding this queues
    /// onto the singleton thread; otherwise the build runs on its own
    /// short-lived overflow thread. See [`singleton::enqueue`] for why.
    ///
    /// # Safety
    /// `instance` must point to a live `BundleThread` whose bundle thread has
    /// been spawned (so `waker` is initialized). Called concurrently with
    /// `thread_main`. `completion` is a live, caller-owned task node
    /// (non-null); the caller transfers it here and must not touch it again
    /// until `complete_on_bundle_thread` fires.
    pub unsafe fn enqueue_or_spawn(instance: *mut Self, completion: *mut C) {
        // SAFETY: `completion` is a live, caller-owned task node (non-null).
        let completion = unsafe { core::ptr::NonNull::new_unchecked(completion) };
        // SAFETY: atomic field projected via raw ptr. `AcqRel` so a caller that
        // wins the 0→1 race has a happens-before edge with the `Release`
        // `fetch_sub` of the previous build's completion.
        let prev = unsafe { (*instance).scheduled.fetch_add(1, Ordering::AcqRel) };
        if prev > 0 {
            // SAFETY: atomic field projected via raw ptr.
            let generation = unsafe { (*instance).generation.load(Ordering::Relaxed) };
            // SAFETY: `completion` is live and transferred to the spawned thread;
            // `spawn_overflow_thread` upholds the same ownership contract.
            match unsafe { Self::spawn_overflow_thread(instance, completion, generation) } {
                Ok(()) => return,
                Err(e) => {
                    // Cannot fall through to `queue`: if this build is awaited
                    // from inside the singleton build's plugin callback, the
                    // singleton is parked in `wait_for_parse` (not on `waker`)
                    // and would never pop it. Reject so the plugin promise
                    // settles instead of hanging the process.
                    // SAFETY: `completion` is the live caller-owned task; sole
                    // mutator on this (JS) thread until
                    // `complete_on_bundle_thread` hands it back.
                    let completion = unsafe { &mut *completion.as_ptr() };
                    let mut log = bun_ast::Log::init();
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!("Failed to spawn concurrent Bun.build thread: {e}"),
                    );
                    completion.set_log(log);
                    completion.set_result(BundleV2Result::Err(crate::Error::BuildFailed));
                    completion.complete_on_bundle_thread();
                    // SAFETY: atomic field projected via raw ptr. Pairs with the
                    // `fetch_add` above.
                    unsafe { (*instance).scheduled.fetch_sub(1, Ordering::Release) };
                    return;
                }
            }
        }
        // SAFETY: field projections via raw ptr — `thread_main` on the bundle
        // thread accesses the same struct concurrently, so we never materialize
        // `&mut Self`. `UnboundedQueue::push` takes `&self` (lock-free MPSC).
        // `Waker::wake` takes `&self` on all platforms (LinuxWaker / Windows /
        // KEventWaker — the latter uses `AtomicBool` for `has_pending_wake`),
        // so this autorefs to `&Waker` and is safe to call concurrently with
        // `wait(&self)` in `thread_main` and with other `enqueue_or_spawn`
        // callers.
        unsafe {
            (*instance).queue.push(completion);
            (*instance).waker.wake();
        }
    }

    unsafe fn thread_main(instance: *mut Self) {
        Output::Source::configure_named_thread(zstr!("Bundler"));

        // SAFETY: `waker` is written exactly once here, before `ready_event.set()`
        // releases any thread that could call `enqueue_or_spawn` (which reads `waker`).
        unsafe {
            core::ptr::addr_of_mut!((*instance).waker)
                .write(Async::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker")));
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
        let mut timer: bun_sys::windows::libuv::Timer = bun_core::ffi::zeroed();
        #[cfg(windows)]
        {
            // SAFETY: raw place read of `waker.loop_.uv_loop` (Copy ptr); field is
            // write-once in `Waker::init()` above and never mutated by `wake()`, so a
            // concurrent `enqueue_or_spawn()` (possible now that `ready_event.set()` has fired)
            // does not conflict. No `&Waker`/`&mut Waker` is materialized here.
            timer.init(unsafe { (*instance).waker.uv_loop() });
            timer.start(u64::MAX, u64::MAX, Some(timer_callback));
        }

        let mut has_bundled = false;
        loop {
            loop {
                // SAFETY: `UnboundedQueue::pop` takes `&self`; concurrent `push` from
                // `enqueue_or_spawn` is the lock-free queue's intended use.
                let completion = unsafe { (*instance).queue.pop() };
                if completion.is_null() {
                    break;
                }
                // SAFETY: queue stores non-null *mut C pushed via enqueue_or_spawn(); owner keeps it alive
                // until complete_on_bundle_thread() signals completion.
                let completion = unsafe { &mut *completion };
                // SAFETY: atomic field projected via raw ptr; overflow threads may
                // read `generation` concurrently.
                let generation = unsafe { (*instance).generation.load(Ordering::Relaxed) };
                // `panic = "abort"` → a Rust panic on this thread enters the
                // crash-handler hook and aborts the whole process.
                // No `catch_unwind` — there is nothing to catch.
                match Self::generate_in_new_thread(completion, generation) {
                    Ok(()) => {}
                    Err(err) => {
                        completion.set_result(BundleV2Result::Err(err));
                        completion.complete_on_bundle_thread();
                    }
                }
                // SAFETY: atomic field projected via raw ptr. `Release` pairs with
                // the `AcqRel` `fetch_add` in `enqueue_or_spawn`.
                unsafe { (*instance).scheduled.fetch_sub(1, Ordering::Release) };
                has_bundled = true;
            }
            // SAFETY: atomic field projected via raw ptr; only incremented here.
            unsafe {
                let g = &(*instance).generation;
                g.store(
                    g.load(Ordering::Relaxed).saturating_add(1),
                    Ordering::Relaxed,
                );
            }

            if has_bundled {
                bun_alloc::mimalloc::mi_collect(false);
                has_bundled = false;
            }

            // SAFETY: `Waker::wait` takes `&self`; concurrent `wake()` from `enqueue_or_spawn` is by design.
            unsafe { (*instance).waker.wait() };
        }
    }

    /// Run one build to completion on a freshly spawned thread, then release
    /// that thread's bundler-specific lazy state. Used by
    /// [`singleton::enqueue`] when the singleton thread is already inside a
    /// build (which parks in `wait_for_parse` and would not service `queue`
    /// until done), so a `Bun.build` awaited from inside another build's
    /// plugin callback, or started concurrently with one, makes progress
    /// instead of deadlocking or head-of-line blocking behind it.
    ///
    /// # Safety
    /// `instance` is the live singleton (same contract as
    /// [`Self::enqueue_or_spawn`]).
    /// `completion` is a live owner-held task; the caller transfers it to the
    /// spawned thread and must not touch it again until
    /// `complete_on_bundle_thread` fires.
    unsafe fn spawn_overflow_thread(
        instance: *mut Self,
        completion: NonNull<C>,
        generation: bun_core::Generation,
    ) -> std::io::Result<()> {
        struct SendPtr<T>(*mut T);
        // SAFETY: `C: Send` (via `CompletionStruct`'s `Send + 'static` bound) and
        // `instance` is the leaked `'static` singleton; each pointer is dereferenced
        // only on the spawned thread via raw projection / the documented contract.
        unsafe impl<T> Send for SendPtr<T> {}
        let completion_ptr = SendPtr(completion.as_ptr());
        let instance_ptr = SendPtr(instance);
        std::thread::Builder::new()
            .name("Bundler".into())
            .spawn(move || {
                let completion_ptr = completion_ptr;
                let instance_ptr = instance_ptr;
                Output::Source::configure_named_thread(zstr!("Bundler"));
                // SAFETY: `completion` is the live owner-held task the caller
                // transferred; this thread is now its sole mutator until
                // `complete_on_bundle_thread` hands it back to the JS thread.
                let completion = unsafe { &mut *completion_ptr.0 };
                match Self::generate_in_new_thread(completion, generation) {
                    Ok(()) => {}
                    Err(err) => {
                        completion.set_result(BundleV2Result::Err(err));
                        completion.complete_on_bundle_thread();
                    }
                }
                // SAFETY: atomic field projected via raw ptr on the `'static`
                // singleton. `Release` pairs with `enqueue_or_spawn`'s `AcqRel`.
                unsafe { (*instance_ptr.0).scheduled.fetch_sub(1, Ordering::Release) };
                // `init_and_run` lazily created this thread's uws loop (via
                // `MiniEventLoop::init`); free its 512 KiB recv buffer and the
                // cork buffers. Mimalloc reclaims this thread's arena pool on
                // thread teardown; the resolver's per-thread scratch-buffer
                // boxes free themselves via their `thread_local!` `Drop` slots.
                #[cfg(not(windows))]
                {
                    bun_uws::on_thread_exit();
                }
                #[cfg(windows)]
                {
                    // `WindowsLoop::get()` passes a non-null `uv_loop_t` hint,
                    // so `uWS::Loop::get` leaves `cleanMe` false and
                    // `on_thread_exit` would skip the free. Free the wrapper
                    // explicitly (queues uv_pre/uv_check/timer/async close
                    // callbacks and releases recv/send/cork buffers), then
                    // close this thread's `uv_loop_t` to flush those callbacks
                    // and release its IOCP handle.
                    bun_uws::free_loop_wrapper_at_thread_exit();
                    bun_sys::windows::libuv::Loop::shutdown();
                }
            })?;
        Ok(())
    }

    /// This is called from `Bun.build` in JavaScript.
    fn generate_in_new_thread(
        completion: &mut C,
        generation: bun_core::Generation,
    ) -> Result<(), crate::Error> {
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
            // the impl can hand it to `BundleV2::init` (which stores `*mut`).
            std::ptr::from_ref(bun_threading::work_pool::WorkPool::get()).cast_mut(),
        );

        // Straight-line teardown: log copy
        // runs on both paths; `completeOnBundleThread` only on success (the error
        // path's `set_result(Err)` + complete happens in `thread_main`). The
        // `deinitWithoutFreeingArena` + wait-group drain live inside `init_and_run`
        // (it owns `this`).
        let mut out_log = bun_ast::Log::init();
        // SAFETY: `transpiler.log` is the arena-allocated `*mut Log` set up by
        // `configure_bundler`; valid for the lifetime of `heap`. Raw deref so the
        // `&'a mut Transpiler` consumed by `init_and_run` above is not reborrowed.
        let _ = unsafe { (*(*transpiler_ptr).log).append_to_with_recycled(&mut out_log, true) }; // logger OOM-only
        completion.set_log(out_log);

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
        // past `init_and_run` (`set_transpiler` was cleared by
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

/// Lazily-initialized singleton. This is used for `Bun.build` since the
/// bundle thread may not be needed.
// Rust forbids generic statics, so the storage is
// type-erased (`*mut ()`) and the accessor functions are generic over `C`.
// In practice exactly one `C` (`JSBundleCompletionTask`) is ever used — see
// `get`'s safety contract — so the
// erased static is sound. T6 (`bun_bundler_jsc`) calls these with its concrete
// completion-task type.
pub mod singleton {
    use super::*;

    /// `Send + Sync` newtype around the leaked `BundleThread` allocation so it
    /// can sit inside a `OnceLock`. Type-erased because Rust forbids generic
    /// statics; see module comment. Stored as a raw pointer (not `&'static`)
    /// because the bundle thread mutates `*self` concurrently — callers must
    /// only ever project fields via raw-pointer access.
    struct Instance(NonNull<()>);
    // SAFETY: the allocation is a leaked `Box<BundleThread<C>>` valid for
    // `'static`; cross-thread access is mediated entirely through the
    // `UnboundedQueue` / `ResetEvent` / `scheduled` atomics inside
    // `BundleThread::enqueue_or_spawn`.
    unsafe impl Send for Instance {}
    // SAFETY: `&Instance` only exposes the raw pointer; every dereference path
    // goes through `BundleThread::enqueue_or_spawn`'s atomic primitives, so
    // sharing the pointer across threads is sound.
    unsafe impl Sync for Instance {}

    static INSTANCE: std::sync::OnceLock<Instance> = std::sync::OnceLock::new();

    // Blocks the calling thread until the bun build thread is created.
    // OnceLock also blocks other callers of this function until the first caller is done.
    fn load_once_impl<C: CompletionStruct>() -> Instance {
        let bundle_thread = bun_core::heap::into_raw(Box::new(BundleThread::<C>::uninitialized()));

        // 2. Spawn the bun build thread.
        // SAFETY: bundle_thread is a leaked Box, valid for 'static; `spawn` takes the
        // raw pointer directly so no `&mut` is materialized that would alias the
        // bundle thread's own access.
        let os_thread = unsafe { BundleThread::spawn(bundle_thread) }
            .unwrap_or_else(|_| Output::panic(format_args!("Failed to spawn bun build thread")));
        // `std.Thread.detach()` — drop the JoinHandle without joining.
        drop(os_thread);

        // SAFETY: `into_raw` of a `Box` is never null.
        Instance(unsafe { NonNull::new_unchecked(bundle_thread.cast::<()>()) })
    }

    /// Returns the raw singleton pointer. The bundle thread runs `thread_main`
    /// against this allocation for the process lifetime, so callers MUST NOT
    /// materialize `&mut BundleThread` from it.
    /// Use `BundleThread::enqueue_or_spawn(get(), ...)` instead.
    ///
    /// # Safety
    /// All calls (across the process) must use the same `C`; the static is
    /// type-erased.
    pub fn get<C: CompletionStruct>() -> *mut BundleThread<C> {
        // INSTANCE is a leaked 'static Box of `BundleThread<C>` (same `C` per
        // the safety contract).
        INSTANCE
            .get_or_init(load_once_impl::<C>)
            .0
            .as_ptr()
            .cast::<BundleThread<C>>()
    }

    /// Schedule one `Bun.build`. When the singleton bundle thread is idle this
    /// queues onto it (so sequential builds share the long-lived thread and its
    /// warm resolver cache). When it is already inside a build the new build
    /// runs on a short-lived overflow thread instead, because the singleton
    /// parks inside `wait_for_parse` for the whole build and would not touch
    /// `queue` until done: a plugin `onLoad`/`onResolve` that awaits a nested
    /// `Bun.build` would otherwise self-deadlock, and an independent
    /// concurrent build would head-of-line block behind any slow plugin.
    pub fn enqueue<C: CompletionStruct>(completion: *mut C) {
        // Validate the caller's pointer at the public boundary so the unsafe
        // path below never receives null.
        let completion = NonNull::new(completion).unwrap_or_else(|| {
            Output::panic(format_args!("BundleThread enqueue: null completion"))
        });
        // SAFETY: `get()` returns the leaked 'static singleton whose bundle thread
        // is running; `enqueue_or_spawn` only performs raw-ptr field projections.
        unsafe { BundleThread::enqueue_or_spawn(get::<C>(), completion.as_ptr()) };
    }
}
