use core::ptr::NonNull;

use bun_alloc::Arena; // MimallocArena → bumpalo::Bump (ThreadLocalArena)
use bun_core::{self, Output, zstr};
use bun_io as Async;
use bun_threading::unbounded_queue::{Node, UnboundedQueue};

use crate::Transpiler;
use crate::thread_pool::BundleHeap;

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

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
pub(crate) struct BundleThread<C: Node> {
    pub(crate) waker: Async::Waker,
    pub(crate) ready_event: ResetEvent,
    // `bun.UnboundedQueue(CompletionStruct, .next)` — intrusive over `C.next`;
    // the field offset is encoded via the `Node` supertrait on `CompletionStruct`.
    pub(crate) queue: UnboundedQueue<C>,
    pub(crate) generation: bun_core::Generation,
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
    /// Bundle thread, on dequeue: `false` if the owner released this build
    /// while it was still queued ([`free_released_unstarted`] then frees it).
    fn try_start(&mut self) -> bool;
    fn free_released_unstarted(this: *mut Self);
    fn complete_on_bundle_thread(&mut self);
    fn set_result(&mut self, result: BundleV2Result);
    fn set_log(&mut self, log: bun_ast::Log);

    /// The per-build transpiler, configured from the task's config. `heap`
    /// is the per-build heap that backs it, so the two share `'a` (option
    /// fields like `optimize_imports: &'a StringSet` borrow from it).
    fn create_and_configure_transpiler<'a>(
        &mut self,
        heap: &'a Arena,
    ) -> Result<Box<Transpiler<'a>>, crate::Error>;

    /// Constructs the `BundleV2` (wiring plugins / completion handle / file
    /// map from the task) and runs the bundle to completion.
    fn init_and_run<'a>(
        &mut self,
        transpiler: &mut Transpiler<'a>,
        heap: &'a BundleHeap,
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
    pub(crate) fn uninitialized() -> Self {
        Self {
            waker: Async::Waker::placeholder(),
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
    pub(crate) unsafe fn spawn(
        instance: *mut Self,
    ) -> std::io::Result<std::thread::JoinHandle<()>> {
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
    pub(crate) unsafe fn enqueue(instance: *mut Self, completion: *mut C) {
        // SAFETY: `completion` is a live, caller-owned task node (non-null).
        let completion = unsafe { core::ptr::NonNull::new_unchecked(completion) };
        // SAFETY: field projections via raw ptr — `thread_main` on the bundle thread
        // accesses the same struct concurrently, so we never materialize `&mut Self`.
        // `UnboundedQueue::push` takes `&self` (lock-free MPSC). `Waker::wake` takes
        // `&self` on all platforms and only reads a Copy field (eventfd, mach port,
        // `WindowsLoop` pointer) to pass to a wake call that is safe from any thread
        // (eventfd write, mach_msg send, uv_async_send), so the `&Waker` autoref is
        // sound alongside `wait(&self)` in `thread_main` and other `enqueue` callers.
        unsafe {
            (*instance).queue.push(completion);
            (*instance).waker.wake();
        }
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
                // until complete_on_bundle_thread() signals completion — unless it
                // released the build while it sat here (its VM went away).
                if !unsafe { (*completion).try_start() } {
                    C::free_released_unstarted(completion);
                    continue;
                }
                // SAFETY: as above; started ⇒ the owner waits for us.
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
                crate::bundle_v2::dispatch::__bun_jsc_destroy_bytecode_cache_vm();
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
        let heap = BundleHeap::new();
        let mut ast_memory_store = bun_ast::ASTMemoryAllocator::new(&heap);
        ast_memory_store.reset();
        ast_memory_store.push();

        let mut transpiler = completion.create_and_configure_transpiler(&heap)?;
        transpiler.resolver.generation = generation;

        let run = completion.init_and_run(&mut transpiler, &heap);

        // The log copy runs on both paths; `completeOnBundleThread` only on
        // success (the error path's `set_result(Err)` + complete happens in
        // `thread_main`).
        let mut out_log = bun_ast::Log::init();
        let _ = transpiler
            .log_mut()
            .append_to_with_recycled(&mut out_log, true); // logger OOM-only
        completion.set_log(out_log);

        if run.is_ok() {
            completion.complete_on_bundle_thread();
        }

        ast_memory_store.pop();
        drop(transpiler);
        drop(ast_memory_store);
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
    /// Use `BundleThread::enqueue(get(), ...)` instead.
    ///
    /// # Safety
    /// All calls (across the process) must use the same `C`; the static is
    /// type-erased.
    pub(crate) fn get<C: CompletionStruct>() -> *mut BundleThread<C> {
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
