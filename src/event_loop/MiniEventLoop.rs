//! MiniEventLoop: A lightweight event loop for non-JavaScript contexts
//!
//! This is a simplified version of jsc.EventLoop that provides event loop functionality
//! without requiring a JavaScript runtime. It enables code reuse between JavaScript-enabled
//! contexts (like `bun run`) and JavaScript-free contexts (like `bun build`, `bun install`,
//! and the Bun Shell).
//!
//! Key characteristics:
//! - Wraps the uSockets event loop, same as jsc.EventLoop
//! - Supports concurrent task execution via thread pools
//! - Provides file polling capabilities for watching filesystem changes
//! - Manages stdout/stderr streams without JavaScript bindings
//! - Handles environment variable loading and management
//!
//! Use cases:
//! - Build processes that need async I/O without JavaScript execution
//! - Package installation with concurrent network requests
//! - Shell command execution with proper I/O handling
//! - Any Bun subsystem that needs event-driven architecture without JS overhead

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
use bun_io::file_poll::Store as FilePollStore;
use bun_sys::{self as sys, Fd, Mode};
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

// ─── Upward link-time externs (LAYERING) ────────────────────────────────────
// The bodies live in `bun_runtime` (which owns `webcore::Blob`) as
// `#[no_mangle]` Rust-ABI fns; the linker resolves them. No `AtomicPtr`, no
// init-order hazard.
unsafe extern "Rust" {
    /// Constructs a `webcore::blob::Store` for stdout/stderr/stdin.
    /// Return value is an erased
    /// `*mut blob::Store` with intrusive refcount = 2; re-exported for
    /// `bun_jsc::rare_data`. Defined in `bun_runtime::webcore::blob`.
    /// No caller-side preconditions (by-value args, allocates fresh).
    pub safe fn __bun_stdio_blob_store_new(fd: Fd, is_atty: bool, mode: Mode) -> *mut ();
}
// ────────────────────────────────────────────────────────────────────────────

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
pub type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

/// Intrusive MPSC queue over `AnyTaskWithExtraContext` linked via its `.next` field.
pub type ConcurrentTaskQueue = UnboundedQueue<AnyTaskWithExtraContext>;

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<AnyTaskWithExtraContext>`.
unsafe impl bun_threading::Linked for AnyTaskWithExtraContext {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// FIFO of raw task pointers (tasks are intrusive nodes; the queue does not own them).
type Queue = LinearFifo<*mut AnyTaskWithExtraContext, DynamicBuffer<*mut AnyTaskWithExtraContext>>;

pub struct MiniEventLoop<'a> {
    pub tasks: Queue,
    pub concurrent_tasks: ConcurrentTaskQueue,
    // Raw pointer because the loop is C-owned
    // (created by `uws_get_loop`/`us_create_loop`) and outlives this struct.
    pub loop_: *mut UwsLoop,
    pub file_polls_: Option<Box<FilePollStore>>,
    /// Mutable; callers (shell spawn,
    /// `createNullDelimitedEnvMap`) write through it. Stored as `NonNull`
    /// (BACKREF) so [`EventLoopHandle::env`] can hand out a `*mut` with
    /// mutable provenance. `'a` is preserved via PhantomData below.
    pub env: Option<NonNull<DotEnvLoader<'a>>>,
    // Never freed in `deinit`. Use Box<[u8]> and dupe on assign.
    pub top_level_dir: Box<[u8]>,
    // Opaque ctx assigned externally; only read/cleared here.
    pub after_event_loop_callback_ctx: Option<NonNull<c_void>>,
    pub after_event_loop_callback: Option<unsafe extern "C" fn(*mut c_void)>,
    pub pipe_read_buffer: Option<Box<PipeReadBuffer>>,
}

thread_local! {
    pub static GLOBAL_INITIALIZED: Cell<bool> = const { Cell::new(false) };
    // Raw pointer because the global is heap-allocated once (heap::alloc) and lives
    // for the thread's lifetime (a true thread-lifetime singleton; never freed).
    pub static GLOBAL: Cell<*mut MiniEventLoop<'static>> = const { Cell::new(core::ptr::null_mut()) };
}

/// Returns the thread-local `*mut MiniEventLoop`.
///
/// Returning `&'static mut`
/// here would let two calls (or `init_global` + any reader of `GLOBAL`) hold
/// overlapping `&mut` to the same allocation — UB. Return the raw pointer;
/// callers reborrow `&mut` for the scope they need.
pub fn init_global(
    env: Option<&'static mut DotEnvLoader<'static>>,
    cwd: Option<&[u8]>,
) -> *mut MiniEventLoop<'static> {
    if GLOBAL_INITIALIZED.with(|g| g.get()) {
        // Already initialized: hand back the stored raw pointer. No `&mut` is
        // materialized here (see fn doc — avoids aliased `&'static mut` UB).
        return GLOBAL.with(|g| g.get());
    }
    let loop_ = MiniEventLoop::init();
    // §Forbidden bans `Box::leak` for `&'static`; this is a
    // thread-lifetime singleton, so use `heap::alloc` (intrusive ownership)
    // and store the raw pointer in the thread-local.
    let global_ptr: *mut MiniEventLoop<'static> = bun_core::heap::into_raw(Box::new(loop_));
    // SAFETY: `global_ptr` was just allocated via `heap::alloc`; this thread
    // holds the only reference for the duration of first-init. The `GLOBAL`
    // thread-local is NOT yet published (set below, after this `&mut` is dropped),
    // so no reader of `GLOBAL` nor a re-entrant `init_global()` can observe
    // the pointer while this exclusive borrow is live. The `&mut` is scoped to
    // this function body — NOT `'static` — and ends before we publish/return the
    // raw ptr.
    let global = unsafe { &mut *global_ptr };

    // sys-level API is `set_parent_raw(tag, ptr)`. Tag 1 = JS,
    // tag 2 = mini (`EventLoopHandle` discriminant + 1).
    {
        let (tag, ptr) = EventLoopHandle::init_mini(global_ptr).into_tag_ptr();
        // SAFETY: see `loop_ptr()` invariant.
        unsafe {
            (*global.loop_ptr())
                .internal_loop_data
                .set_parent_raw(tag, ptr)
        };
    }

    // The process-global loader is stored as `AtomicPtr<Loader<'static>>`.
    global.env = env.map(NonNull::from).or_else(|| {
        NonNull::new(
            dotenv::INSTANCE
                .load(core::sync::atomic::Ordering::Acquire)
                .cast::<DotEnvLoader<'static>>(),
        )
    });
    if global.env.is_none() {
        // Thread-lifetime singletons.
        let map: *mut dotenv::Map = bun_core::heap::into_raw(Box::new(dotenv::Map::init()));
        // SAFETY: `map` lives for the thread (singleton); never freed.
        let loader =
            bun_core::heap::into_raw_nn(Box::new(DotEnvLoader::init(unsafe { &mut *map })));
        global.env = Some(loader);
    }

    // Set top_level_dir from provided cwd or get current working directory
    if let Some(dir) = cwd {
        // Dupe to keep Box<[u8]> ownership uniform.
        global.top_level_dir = Box::<[u8]>::from(dir);
    } else if global.top_level_dir.is_empty() {
        let mut buf = bun_paths::PathBuffer::uninit();
        match sys::getcwd(&mut buf[..]) {
            Ok(len) => {
                global.top_level_dir = Box::<[u8]>::from(&buf[..len]);
            }
            Err(_) => {
                global.top_level_dir = Box::default();
            }
        }
    }

    // Publish the thread-local pointer only AFTER the scoped `&mut *global_ptr`
    // above is no longer used — publishing earlier would let a callee that reads
    // `GLOBAL` re-derive a `&mut` aliasing `global` (UB). Nothing between the
    // `&mut` borrow and here reads `GLOBAL` (`EventLoopHandle::init_mini` /
    // `into_tag_ptr` only copy the pointer value).
    GLOBAL.with(|g| g.set(global_ptr));
    GLOBAL_INITIALIZED.with(|g| g.set(true));
    global_ptr
}

impl<'a> MiniEventLoop<'a> {
    /// Raw `*mut uws::Loop`.
    ///
    /// This is the sole accessor for the `loop_` field. A `&mut UwsLoop`-
    /// returning accessor is intentionally **not** provided: `UwsLoop::tick()`
    /// fires FilePoll callbacks which re-enter this struct via the
    /// `EventLoopCtx` vtable (`platform_event_loop`) and via
    /// `EventLoopHandle::Mini` (e.g. `enqueue_task_concurrent` → `wakeup()`),
    /// so a held `&mut UwsLoop` across `.tick()` would alias. The loop is also
    /// a C-owned handle whose internals are mutated by uSockets itself. All
    /// access goes through the raw pointer instead.
    ///
    /// SAFETY (invariant): `self.loop_` is the live C-owned uws loop set in
    /// [`init`](Self::init) via `UwsLoop::get()`; never null, outlives `self`.
    #[inline]
    pub fn loop_ptr(&self) -> *mut UwsLoop {
        self.loop_
    }

    /// Raw pointer to the `DotEnv::Loader` backref.
    ///
    /// Returns `None` until [`init_global`] populates it. Neither a `&`- nor
    /// a `&mut`-returning accessor is provided: the loader may be shared via
    /// the process-global `dotenv::INSTANCE` (and `Transpiler::env`), and
    /// other safe paths (`EventLoopHandle::create_null_delimited_env_map`,
    /// `interpreter.rs`) materialize `&mut DotEnvLoader` from the same
    /// allocation via raw deref.
    /// Handing out a long-lived `&DotEnvLoader` here would let safe code hold
    /// it across one of those `&mut` paths → aliased `&`/`&mut` UB. Callers
    /// deref the returned `NonNull` for a tightly-scoped borrow under their
    /// own SAFETY contract instead (mirrors [`loop_ptr`](Self::loop_ptr)).
    ///
    /// SAFETY (invariant): when `Some`, points to a thread-/process-lifetime
    /// loader set in `init_global` that outlives `self` (never freed).
    #[inline]
    pub fn env_ptr(&self) -> Option<NonNull<DotEnvLoader<'a>>> {
        self.env
    }

    pub fn pipe_read_buffer(&mut self) -> &mut [u8] {
        // `boxed_zeroed` avoids the 256 KiB stack temporary `Box::new([0u8; N])`
        // would create in debug builds.
        &mut self
            .pipe_read_buffer
            .get_or_insert_with(bun_core::boxed_zeroed::<PipeReadBuffer>)[..]
    }

    pub fn on_after_event_loop(&mut self) {
        if let Some(cb) = self.after_event_loop_callback {
            let ctx = self.after_event_loop_callback_ctx;
            self.after_event_loop_callback = None;
            self.after_event_loop_callback_ctx = None;
            // SAFETY: `cb` is a C-ABI callback registered by the owner of `ctx`; the owner
            // guarantees `ctx` is valid until the callback fires.
            unsafe { cb(ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr())) };
        }
    }

    /// Raw-pointer `FilePollStore` accessor for re-entrant callers.
    ///
    /// The `mini_ctx` vtable shim (`file_polls`) is reached
    /// via `EventLoopCtx` from inside FilePoll callbacks fired by
    /// `UwsLoop::tick()`, which is itself invoked from
    /// `tick`/`tick_once`/`tick_without_idle` while those methods hold
    /// `&mut self`. Re-deriving a second `&mut MiniEventLoop` from the stored
    /// `owner` raw ptr there is aliased-`&mut` UB under Stacked Borrows. This
    /// accessor lazy-inits the store via `addr_of_mut!` on the field only,
    /// never materializing a `&mut Self`.
    ///
    /// # Safety
    /// `this` must point to a live `MiniEventLoop`. Caller must not hold a
    /// live `&mut` to `file_polls_` itself across this call. (Not eligible for
    /// `unsafe-fn-narrow`: every unsafe op below derefs the caller-supplied
    /// `this`; the body cannot discharge that precondition.)
    pub unsafe fn file_polls_raw(this: *mut Self) -> *mut FilePollStore {
        // SAFETY: caller guarantees `this` points to a live `MiniEventLoop` (see fn `# Safety`);
        // `addr_of_mut!` projects to `file_polls_` without forming `&mut Self`.
        unsafe {
            let slot = core::ptr::addr_of_mut!((*this).file_polls_);
            if (*slot).is_none() {
                slot.write(Some(Box::new(FilePollStore::init())));
            }
            // SAFETY: ensured `Some` just above; `Box` deref yields a stable
            // heap address independent of `*this`.
            match &mut *slot {
                Some(b) => &raw mut **b,
                None => core::hint::unreachable_unchecked(),
            }
        }
    }

    pub fn init() -> MiniEventLoop<'a> {
        MiniEventLoop {
            tasks: Queue::init(),
            concurrent_tasks: ConcurrentTaskQueue::default(),
            loop_: UwsLoop::get(),
            file_polls_: None,
            env: None,
            top_level_dir: Box::default(),
            after_event_loop_callback_ctx: None,
            after_event_loop_callback: None,
            pipe_read_buffer: None,
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.readable_length();
        // `ensure_unused_capacity` early-returns without realigning when
        // capacity is already sufficient, and `writable_slice(0)` only yields
        // the first contiguous segment `buf[head+count..]` — so an empty fifo
        // with `head > 0` would yield a short slice and the loop would `break`
        // early, silently dropping tasks already popped from `concurrent`. Use
        // `writable_with_size`, which realigns when the contiguous slice is
        // too short, so the returned slice is always `>= count` long.
        //
        // Fill the writable slice first, track items written in a local, then
        // commit via `update()` after the borrow ends.
        let mut written: usize = 0;
        {
            let mut writable = self.tasks.writable_with_size(count).expect("unreachable");
            loop {
                let task = iter.next();
                if task.is_null() {
                    break;
                }
                writable[0] = task;
                writable = &mut writable[1..];
                written += 1;
                if writable.is_empty() {
                    break;
                }
            }
        }
        self.tasks.update(written);

        self.tasks.readable_length() - start_count
    }

    #[inline]
    pub fn tick_once(&mut self, context: *mut c_void) {
        if self.tick_concurrent_with_count() == 0 && self.tasks.readable_length() == 0 {
            // SAFETY: see `loop_ptr()` invariant.
            unsafe {
                (*self.loop_ptr()).inc();
                (*self.loop_ptr()).tick();
                (*self.loop_ptr()).dec();
            }
            self.on_after_event_loop();
        }

        while let Some(task) = self.tasks.read_item() {
            // SAFETY: tasks are pushed by enqueue_task* and remain valid until run() consumes them.
            unsafe { (*task).run(context) };
        }
    }

    pub fn tick_without_idle(&mut self, context: *mut c_void) {
        loop {
            let _ = self.tick_concurrent_with_count();
            while let Some(task) = self.tasks.read_item() {
                // SAFETY: see tick_once.
                unsafe { (*task).run(context) };
            }

            // SAFETY: see `loop_ptr()` invariant.
            unsafe { (*self.loop_ptr()).tick_without_idle() };

            if self.tasks.readable_length() == 0 && self.tick_concurrent_with_count() == 0 {
                break;
            }
        }
        self.on_after_event_loop();
    }

    pub fn tick<F>(&mut self, context: *mut c_void, is_done: F)
    where
        F: Fn(*mut c_void) -> bool,
    {
        // Generic `F` monomorphizes per callsite. `tick_once` is `#[inline]` so codegen is
        // identical to the previously hand-inlined body.
        while !is_done(context) {
            self.tick_once(context);
        }
    }

    /// `task` must outlive the queued work item; ownership of the intrusive
    /// node stays with the caller until the callback runs.
    pub fn enqueue_task_concurrent(&mut self, task: NonNull<AnyTaskWithExtraContext>) {
        self.concurrent_tasks.push(task);
        // SAFETY: see `loop_ptr()` invariant.
        unsafe { (*self.loop_ptr()).wakeup() };
    }

    /// The caller supplies `field_offset = core::mem::offset_of!(C, <field>)` of the
    /// embedded `AnyTaskWithExtraContext`.
    ///
    /// # Safety
    /// `field_offset == offset_of!(C, <field>)` where `<field>: AnyTaskWithExtraContext`,
    /// and `ctx` is non-null and outlives the queued task (intrusive node; ownership stays
    /// with caller).
    pub unsafe fn enqueue_task_concurrent_with_extra_ctx<C, P>(
        &mut self,
        ctx: *mut C,
        callback: fn(*mut C, *mut P),
        field_offset: usize,
    ) {
        // SAFETY: caller contract — see fn `# Safety`.
        let task = unsafe { ctx.byte_add(field_offset).cast::<AnyTaskWithExtraContext>() };
        // SAFETY: `task` points at a properly aligned `AnyTaskWithExtraContext` field of `*ctx`.
        unsafe { task.write(New::<C, P>::init(ctx, callback)) };

        // SAFETY: `task` was just initialized above and is non-null (derived from `ctx`).
        self.concurrent_tasks
            .push(unsafe { NonNull::new_unchecked(task) });

        // SAFETY: see `loop_ptr()` invariant.
        unsafe { (*self.loop_ptr()).wakeup() };
    }
}

// ───────────── EventLoopCtx adapter (bun_io cycle-break) ─────────────────
// `bun_io::file_poll::Store::put` and friends take an erased `EventLoopCtx`
// instead of naming `MiniEventLoop`/`VirtualMachine` directly. This crate owns
// `MiniEventLoop`, so the Mini-side vtable lives here. The Js-side vtable lives
// in `bun_runtime` (it must name `jsc::VirtualMachine`).

bun_io::link_impl_EventLoopCtx! {
    Mini for MiniEventLoop<'static> => |this| {
        platform_event_loop_ptr() => (*this).loop_ptr(),
        // `file_polls_raw` to avoid aliased `&mut MiniEventLoop` while `tick*`
        // holds `&mut self` across the re-entrant `UwsLoop::tick()` that
        // reaches this body.
        file_polls_ptr()  => MiniEventLoop::file_polls_raw(this),
        // Mini has no pending_unref_counter; the upstream deliberately panics.
        increment_pending_unref_counter() => panic!("FIXME TODO"),
        // `KeepAlive::{,un}refConcurrently` is JS-VM-only (statically rejected
        // on Mini upstream); preserve that invariant rather than racily
        // mutating uws counters off-thread.
        ref_concurrently()   => unreachable!("KeepAlive::refConcurrently is JS-VM-only"),
        unref_concurrently() => unreachable!("KeepAlive::unrefConcurrently is JS-VM-only"),
        after_event_loop_callback() => (*this).after_event_loop_callback,
        set_after_event_loop_callback(cb, ctx) => {
            (*this).after_event_loop_callback = cb;
            (*this).after_event_loop_callback_ctx = ctx;
        },
        pipe_read_buffer() => core::ptr::from_mut::<[u8]>((*this).pipe_read_buffer()),
    }
}

impl<'a> MiniEventLoop<'a> {
    /// `this` is the per-thread `MiniEventLoop` singleton; the returned ctx
    /// must not outlive it.
    #[inline]
    pub fn as_event_loop_ctx(this: &mut MiniEventLoop<'a>) -> bun_io::EventLoopCtx {
        // SAFETY: `this` is a live `&mut`, so the pointer handed to `new` is
        // non-null and exclusively borrowed for the call's duration.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Mini, this) }
    }
}

impl<'a> Drop for MiniEventLoop<'a> {
    fn drop(&mut self) {
        // `tasks.deinit()` is implicit via Queue's Drop.
        debug_assert!(self.concurrent_tasks.is_empty());
    }
}
