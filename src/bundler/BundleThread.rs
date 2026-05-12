use core::ptr::NonNull;

use bun_alloc::Arena; // MimallocArena → bumpalo::Bump (ThreadLocalArena)
use bun_core::{self, Output, zstr};
use bun_io as Async;
use bun_js_parser as js_ast;
use bun_threading::unbounded_queue::{Node, UnboundedQueue};

use crate::bundle_v2::{FileMap, JSBundlerPlugin, dispatch};
use crate::{BundleV2, Transpiler};

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
pub extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

/// Port of `std.Thread.ResetEvent` — single-shot manual-reset event used to
/// block `spawn()` until the bundle thread has initialized its `Waker`.
// PORT NOTE: re-export `bun_threading::ResetEvent` (futex-backed); the local
// `wait()`/`set()`/`Default` API is identical, and the futex impl preserves
// the "set-before-wait does not deadlock" property the parking_lot draft had.
pub use bun_threading::ResetEvent;

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
// PORT NOTE: trait bound lives on the `impl` (not the struct) so the
// `singleton` static can name `BundleThread<JSBundleCompletionTask>` before T6
// provides the `CompletionStruct` impl for the forward-decl.
pub struct BundleThread<C: Node> {
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
    /// Zig: `completion.configureBundler(transpiler, arena)` — `arena`
    /// is the per-build mimalloc heap that backs `transpiler`, so the two
    /// share lifetime `'a` (option fields like `optimize_imports: &'a StringSet`
    /// borrow from `bump`).
    fn configure_bundler<'a>(
        &mut self,
        transpiler: &mut Transpiler<'a>,
        bump: &'a Arena,
    ) -> Result<(), bun_core::Error>;
    /// Zig: `completion.completeOnBundleThread()`
    fn complete_on_bundle_thread(&mut self);
    /// Zig: `completion.result = .{ .err | .value }`
    fn set_result(&mut self, result: BundleV2Result);
    /// Zig: `completion.log = out_log`
    fn set_log(&mut self, log: bun_ast::Log);
    /// Zig: `completion.transpiler = this`
    fn set_transpiler(&mut self, this: *mut BundleV2<'_>);
    /// Zig: `completion.plugins`
    fn plugins(&self) -> Option<NonNull<JSBundlerPlugin>>;
    /// Zig: `if (completion.config.files.map.count() > 0) &completion.config.files else null`
    /// — folded into a single accessor so the opaque `FileMap` layout stays in T6.
    fn file_map(&mut self) -> Option<NonNull<FileMap>>;
    /// Zig: `switch (CompletionStruct) { BundleV2.JSBundleCompletionTask => completion, … }`
    /// — the comptime type-switch collapses to a §Dispatch handle (erased
    /// owner + `&'static` vtable) the impl provides, so the bundler can read
    /// `result == .err` / `jsc_event_loop.enqueueTaskConcurrent` without
    /// naming the concrete struct.
    fn as_js_bundle_completion_task(&mut self) -> dispatch::CompletionHandle;

    /// Zig: `const transpiler = try arena.create(bun.Transpiler);` followed by
    /// `try completion.configureBundler(transpiler, arena);` — Zig left the
    /// `Transpiler` `undefined` and let `configureBundler` initialize it in place.
    /// Rust's `Transpiler<'a>` has borrow-carrying fields (`arena: &'a Arena`,
    /// `resolver: Resolver<'a>`) that cannot be zero-init'd, so the allocate +
    /// configure pair is folded into one trait call returning the
    /// arena-allocated, fully-configured transpiler.
    fn create_and_configure_transpiler<'a>(
        &mut self,
        bump: &'a Arena,
    ) -> Result<&'a mut Transpiler<'a>, bun_core::Error>;

    /// Zig: `try BundleV2.init(transpiler, null, arena, jsc.AnyEventLoop.init(arena),
    /// false, jsc.WorkPool.get(), heap)` → wire `this.{plugins,completion,file_map}`
    /// from `self` → `completion.transpiler = this` → `this.runFromJSInNewThread(...)`
    /// → on success `self.set_result(Value(..))` → `this.deinitWithoutFreeingArena()`;
    /// on error drain `this.linker.source_maps.*_wait_group` then deinit.
    ///
    /// PORT NOTE: the un-gated `BundleV2` impl does not yet expose `init` /
    /// `run_from_js_in_new_thread` (they live in `bundle_v2::_the gated draft block (now dissolved)`
    /// pending the linker pipeline un-gate). The Zig `@compileError` already
    /// proves this body is `JSBundleCompletionTask`-specific, so the
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
    ) -> Result<(), bun_core::Error>;
}

impl<C: CompletionStruct> BundleThread<C> {
    /// To initialize, put this somewhere in memory, and then call `spawn()`
    // PORT NOTE: Zig `uninitialized` left `waker` as `undefined`. We can't use
    // `mem::zeroed()` here — on macOS `Waker` holds a `Box<[u8]>` and on
    // Windows a `&'static` loop, both of which have a NonNull validity
    // invariant (zeroing them is *language-level* UB even if never read).
    // `placeholder()` yields a fully-initialized inert value instead.
    // `ready_event.wait()` in `spawn()` blocks until `thread_main` overwrites
    // it via `ptr::write`, so the placeholder is never observed live.
    pub fn uninitialized() -> Self {
        Self {
            #[cfg(unix)]
            waker: Async::Waker::placeholder(),
            #[cfg(windows)]
            // TODO(port,windows): `Waker { loop_: &'static _ }` is also
            // NonNull; provide a `placeholder()` once the Windows event-loop
            // port lands. Kept as-is here to avoid an untestable change.
            // SAFETY: see TODO — this is technically invalid_value UB on
            // Windows; the field is overwritten before any read.
            waker: unsafe { bun_core::ffi::zeroed_unchecked() },
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

        // PORT NOTE: libuv Timer lives on stack for the lifetime of this never-returning fn.
        // It MUST be declared at function scope (not inside the `#[cfg(windows)] { ... }`
        // block below) because `timer.init()`/`timer.start()` register `&timer`'s address
        // into the uv loop's intrusive handle queue / timer min-heap, and `waker.wait()`
        // (→ `uv_run`) in the `loop {}` below dereferences that address. Matches Zig spec
        // (BundleThread.zig:77) which hoists `var timer` to `threadMain` scope.
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
                // crash-handler hook and aborts the whole process (matching Zig's
                // `@panic`). No `catch_unwind` — there is nothing to catch.
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
                // SAFETY: `mi_collect(false)` is a thread-local heap sweep with no preconditions.
                unsafe { bun_alloc::mimalloc::mi_collect(false) };
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
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: `ThreadLocalArena.init()` → `bun_alloc::Arena::new()` (bumpalo
        // bump arena; `defer heap.deinit()` is handled by Drop).
        let heap = Arena::new();

        let bump = &heap;
        let ast_memory_store: &mut bun_ast::ASTMemoryAllocator =
            bump.alloc(bun_ast::ASTMemoryAllocator::new(bump));
        ast_memory_store.reset();
        ast_memory_store.push();

        // Zig: `const transpiler = try arena.create(bun.Transpiler);`
        //      `try completion.configureBundler(transpiler, arena);`
        // Folded — see `create_and_configure_transpiler` doc.
        let transpiler = completion.create_and_configure_transpiler(bump)?;

        transpiler.resolver.generation = generation;

        // Zig: `const this = try BundleV2.init(transpiler, null, arena,
        //       jsc.AnyEventLoop.init(arena), false, jsc.WorkPool.get(), heap);`
        // followed by field wiring + `runFromJSInNewThread`. Delegated — see
        // `init_and_run` doc. Reborrow `transpiler` through a raw ptr so
        // `completion` can be borrowed again below (Zig stored `*Transpiler`).
        let transpiler_ptr: *mut Transpiler<'_> = transpiler;
        let run = completion.init_and_run(
            // SAFETY: `transpiler` lives in `bump` for the duration of `heap`.
            unsafe { &mut *transpiler_ptr },
            bump,
            // `WorkPool::get()` returns `&'static ThreadPool`; pass as raw so
            // the impl can hand it to `BundleV2::init` (which stores `*mut`).
            std::ptr::from_ref(bun_threading::work_pool::WorkPool::get()).cast_mut(),
        );

        // PORT NOTE: Zig's overlapping `defer { ast_memory_store.pop();
        // this.deinitWithoutFreeingArena(); }` + `errdefer { wait_groups; copy log }`
        // captured ≥2 disjoint &mut borrows. Restructured as straight-line: log copy
        // runs on both paths; `completeOnBundleThread` only on success (the error
        // path's `set_result(Err)` + complete happens in `thread_main`). The
        // `deinitWithoutFreeingArena` + wait-group drain live inside `init_and_run`
        // (it owns `this`).
        let mut out_log = bun_ast::Log::init();
        // SAFETY: `transpiler.log` is the arena-allocated `*mut Log` set up by
        // `configure_bundler`; valid for the lifetime of `heap`. Raw deref so the
        // `&'a mut Transpiler` consumed by `init_and_run` above is not reborrowed.
        let _ = unsafe { (*(*transpiler_ptr).log).append_to_with_recycled(&mut out_log, true) }; // logger OOM-only (Zig: catch unreachable)
        completion.set_log(out_log);

        if run.is_ok() {
            completion.complete_on_bundle_thread();
        }

        ast_memory_store.pop();

        // Zig allocated `transpiler` / `ast_memory_store` from the arena and
        // relied on `defer heap.deinit()` to bulk-free them. That works there
        // because every container they hold (`Resolver` caches, `BundleOptions`
        // strings, the AST allocator's own `mi_heap` handle, …) is itself
        // arena-backed. The Rust port replaced those containers with global-heap
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
            core::ptr::drop_in_place(ast_memory_store as *mut bun_ast::ASTMemoryAllocator);
        }

        run
    }
}

/// Lazily-initialized singleton. This is used for `Bun.build` since the
/// bundle thread may not be needed.
// PORT NOTE: Zig had a per-monomorphization `singleton` struct with
// `static var instance`. Rust forbids generic statics, so the storage is
// type-erased (`*mut ()`) and the accessor functions are generic over `C`.
// The Zig source already `@compileError`s for any `CompletionStruct` other than
// `JSBundleCompletionTask`, so in practice exactly one `C` is ever used and the
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
    /// materialize `&mut BundleThread` from it (Zig `*Self` aliasing semantics).
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
        // SAFETY: `get()` returns the leaked 'static singleton whose bundle thread is
        // running; `BundleThread::enqueue` only performs raw-ptr field projections.
        unsafe { BundleThread::enqueue(get::<C>(), completion) };
    }
}

use bun_ast::Index;
use bun_ast::Ref;

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/BundleThread.zig
