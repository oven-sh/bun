use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_alloc::Arena; // MimallocArena → bumpalo::Bump (ThreadLocalArena)
use bun_core::{self, Output, zstr};
use bun_io as Async;
use bun_threading::unbounded_queue::{Node, UnboundedQueue};
use bun_uws::Loop as UwsLoop;

use crate::bundle_v2::{FileMap, JSBundlerPlugin, dispatch};
use crate::{BundleV2, Transpiler};

thread_local! {
    /// Set for the lifetime of `thread_main`. Gates [`singleton::drain_pending`]
    /// so it is a no-op from any other thread (e.g. the CLI build path).
    static ON_BUNDLE_THREAD: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

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
    pub generation: bun_core::Generation,
    /// The bundle thread's per-thread uws loop (shared by every per-build
    /// `MiniEventLoop`). `enqueue` wakes this in addition to `waker` so a
    /// `wait_for_parse` parked in `UwsLoop::tick()` returns to drain `queue`.
    /// Published once in `thread_main` before `ready_event.set()`.
    pub uws_loop: AtomicPtr<UwsLoop>,
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
            generation: 0,
            ready_event: ResetEvent::default(),
            uws_loop: AtomicPtr::new(core::ptr::null_mut()),
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
            // If a build is already in-flight the bundle thread is parked in
            // `UwsLoop::tick()` (inside `wait_for_parse`), not on `waker`; wake
            // that too so it returns to drain `queue`. `Relaxed` suffices: the
            // store in `thread_main` happens-before `ready_event.set()`, and
            // `spawn()` waits on that event before any caller can reach here.
            // Raw `us_wakeup_loop` (not `Loop::wakeup(&mut self)`) so no
            // `&mut UwsLoop` is formed while the bundle thread may hold one
            // across `tick()`; `us_wakeup_loop` itself is thread-safe.
            let uws = (*instance).uws_loop.load(Ordering::Relaxed);
            if !uws.is_null() {
                bun_uws::us_wakeup_loop(uws);
            }
        }
    }

    unsafe fn thread_main(instance: *mut Self) {
        Output::Source::configure_named_thread(zstr!("Bundler"));
        ON_BUNDLE_THREAD.set(true);

        // SAFETY: `waker` is written exactly once here, before `ready_event.set()`
        // releases any thread that could call `enqueue` (which reads `waker`).
        unsafe {
            core::ptr::addr_of_mut!((*instance).waker)
                .write(Async::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker")));
        }

        // Publish this thread's uws loop so `enqueue` can wake a build parked in
        // `wait_for_parse`. Every per-build `MiniEventLoop` on this thread
        // shares it (`UwsLoop::get()` is a per-thread lazy singleton).
        // SAFETY: raw-ptr field projection; store is before `ready_event.set()`
        // so any thread that can call `enqueue` observes it.
        unsafe {
            (*instance)
                .uws_loop
                .store(UwsLoop::get(), Ordering::Relaxed);
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
                // SAFETY: queue stores non-null *mut C pushed via enqueue(); owner keeps it alive
                // until complete_on_bundle_thread() signals completion.
                let completion = unsafe { &mut *completion };
                // SAFETY: `generation` is only read/written on this (bundle) thread.
                let generation = unsafe { (*instance).generation };
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
    // `'static`; cross-thread access is mediated entirely through
    // `UnboundedQueue` / `ResetEvent` atomics inside `BundleThread::enqueue`.
    unsafe impl Send for Instance {}
    // SAFETY: `&Instance` only exposes the raw pointer; every dereference path
    // goes through `BundleThread::enqueue`'s atomic queue/waker primitives, so
    // sharing the pointer across threads is sound.
    unsafe impl Sync for Instance {}

    static INSTANCE: std::sync::OnceLock<Instance> = std::sync::OnceLock::new();

    /// Type-erased "pop `queue` and run each build to completion" hook,
    /// registered by [`load_once_impl`]. Lets [`drain_pending`] be called from
    /// `BundleV2::wait_for_parse` (which does not know the concrete `C`) so a
    /// `Bun.build` started from inside a plugin callback of another
    /// `Bun.build` makes progress instead of sitting in `queue` forever.
    static DRAIN_HOOK: std::sync::OnceLock<fn()> = std::sync::OnceLock::new();

    fn drain_impl<C: CompletionStruct>() {
        let instance = get::<C>();
        loop {
            // SAFETY: `UnboundedQueue::pop` takes `&self`; concurrent `push` from
            // `enqueue` is the lock-free queue's intended use.
            let completion = unsafe { (*instance).queue.pop() };
            if completion.is_null() {
                break;
            }
            // SAFETY: queue stores non-null *mut C pushed via enqueue(); owner
            // keeps it alive until complete_on_bundle_thread() signals completion.
            let completion = unsafe { &mut *completion };
            // SAFETY: `generation` is only read/written on this (bundle) thread.
            let generation = unsafe { (*instance).generation };
            match BundleThread::<C>::generate_in_new_thread(completion, generation) {
                Ok(()) => {}
                Err(err) => {
                    completion.set_result(BundleV2Result::Err(err));
                    completion.complete_on_bundle_thread();
                }
            }
        }
    }

    /// Run any builds sitting in `queue` to completion. Called from
    /// `BundleV2::wait_for_parse` each time it wakes so a build enqueued while
    /// another is waiting on a plugin callback (including a nested `Bun.build`
    /// from inside that callback) is not blocked behind it.
    ///
    /// No-op off the bundle thread: `generate_in_new_thread` installs
    /// bundle-thread-local state (`ASTMemoryAllocator::push`, the per-thread
    /// uws loop) and must not run anywhere else.
    pub fn drain_pending() {
        if !ON_BUNDLE_THREAD.get() {
            return;
        }
        if let Some(f) = DRAIN_HOOK.get() {
            f();
        }
    }

    // Blocks the calling thread until the bun build thread is created.
    // OnceLock also blocks other callers of this function until the first caller is done.
    fn load_once_impl<C: CompletionStruct>() -> Instance {
        // All singleton calls use the same `C` (see `get()` safety contract), so
        // this races only against itself and `OnceLock::set` drops the loser.
        let _ = DRAIN_HOOK.set(drain_impl::<C>);

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
    /// Use `BundleThread::enqueue(get(), ...)` instead.
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

    pub fn enqueue<C: CompletionStruct>(completion: *mut C) {
        // Validate the caller's pointer at the public boundary so the unsafe
        // path below never receives null.
        let completion = NonNull::new(completion).unwrap_or_else(|| {
            Output::panic(format_args!("BundleThread enqueue: null completion"))
        });
        // SAFETY: `get()` returns the leaked 'static singleton whose bundle thread is
        // running; `BundleThread::enqueue` only performs raw-ptr field projections.
        unsafe { BundleThread::enqueue(get::<C>(), completion.as_ptr()) };
    }
}
