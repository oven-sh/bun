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

use core::cell::{Cell, OnceCell, UnsafeCell};
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
use bun_io::file_poll::Store as FilePollStore;
use bun_sys::{Fd, Mode};
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

/// Intrusive MPSC queue over `AnyTaskWithExtraContext` linked via its `.next` field.
type ConcurrentTaskQueue = UnboundedQueue<AnyTaskWithExtraContext>;

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

/// Shared borrows only: what a tick runs reaches the loop again, and other threads post to it.
pub struct MiniEventLoop {
    /// No borrow spans a task.
    tasks: UnsafeCell<Queue>,
    concurrent_tasks: ConcurrentTaskQueue,
    pub loop_: &'static UwsLoop,
    file_polls: OnceCell<Box<UnsafeCell<FilePollStore>>>,
    /// Mutable; callers (shell spawn,
    /// `createNullDelimitedEnvMap`) write through it. Stored as `NonNull`
    /// (BACKREF) so [`EventLoopHandle::env`] can hand out a `*mut` with
    /// mutable provenance.
    env: Option<NonNull<DotEnvLoader>>,
    // Opaque ctx assigned externally; only read/cleared here.
    after_event_loop_callback_ctx: Cell<Option<NonNull<c_void>>>,
    after_event_loop_callback: Cell<Option<unsafe extern "C" fn(*mut c_void)>>,
    pipe_read_scratch: Box<bun_io::PipeReadScratch>,
}

thread_local! {
    /// What `init_global` made. `GLOBAL` can be the package manager's loop before that.
    static OWN: Cell<Option<&'static MiniEventLoop>> = const { Cell::new(None) };
    pub static GLOBAL: Cell<Option<&'static MiniEventLoop>> = const { Cell::new(None) };
}

/// Returns this thread's loop. `env` only counts for the call that makes it.
pub fn init_global(env: Option<&'static mut DotEnvLoader>) -> &'static MiniEventLoop {
    if let Some(global) = OWN.get() {
        return global;
    }
    let mut global = MiniEventLoop::init();

    // The process-global loader is stored as `AtomicPtr<Loader>`.
    global.env = env
        .map(NonNull::from)
        .or_else(|| NonNull::new(dotenv::INSTANCE.load(core::sync::atomic::Ordering::Acquire)));
    if global.env.is_none() {
        // Thread-lifetime singleton.
        global.env = Some(bun_core::heap::into_raw_nn(Box::new(DotEnvLoader::init())));
    }

    let global: &'static MiniEventLoop = Box::leak(Box::new(global));
    EventLoopHandle::init_mini(global).set_as_parent_of(global.loop_);

    GLOBAL.set(Some(global));
    OWN.set(Some(global));
    global
}

impl MiniEventLoop {
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
    /// own SAFETY contract instead.
    ///
    /// SAFETY (invariant): when `Some`, points to a thread-/process-lifetime
    /// loader set in `init_global` that outlives `self` (never freed).
    #[inline]
    pub(crate) fn env_ptr(&self) -> Option<NonNull<DotEnvLoader>> {
        self.env
    }

    pub fn on_after_event_loop(&self) {
        if let Some(cb) = self.after_event_loop_callback.get() {
            self.after_event_loop_callback.set(None);
            let ctx = self.after_event_loop_callback_ctx.take();
            // SAFETY: `cb` is a C-ABI callback registered by the owner of `ctx`; the owner
            // guarantees `ctx` is valid until the callback fires.
            unsafe { cb(ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr())) };
        }
    }

    fn file_polls_ptr(&self) -> *mut FilePollStore {
        self.file_polls
            .get_or_init(|| Box::new(UnsafeCell::new(FilePollStore::init())))
            .get()
    }

    pub(crate) fn init() -> MiniEventLoop {
        MiniEventLoop {
            tasks: UnsafeCell::new(Queue::init()),
            concurrent_tasks: ConcurrentTaskQueue::default(),
            loop_: UwsLoop::get(),
            file_polls: OnceCell::new(),
            env: None,
            after_event_loop_callback_ctx: Cell::new(None),
            after_event_loop_callback: Cell::new(None),
            pipe_read_scratch: Box::new(bun_io::PipeReadScratch::new()),
        }
    }

    /// Moves what was posted into `tasks`, and returns how many are waiting there.
    fn tick_concurrent(&self) -> usize {
        // SAFETY: no task runs in this borrow.
        let tasks = unsafe { &mut *self.tasks.get() };
        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return tasks.readable_length();
        }

        let mut iter = concurrent.iterator();
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
            let mut writable = tasks.writable_with_size(count).expect("unreachable");
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
        tasks.update(written);

        tasks.readable_length()
    }

    #[inline]
    pub fn tick_once(&self, context: *mut c_void) {
        if self.tick_concurrent() == 0 {
            self.loop_.inc();
            self.loop_.tick();
            self.loop_.dec();
            self.on_after_event_loop();
        }

        // SAFETY: the borrow of `tasks` ends before the task runs. Tasks are pushed by
        // enqueue_task* and remain valid until run() consumes them.
        unsafe {
            while let Some(task) = (*self.tasks.get()).read_item() {
                (*task).run(context);
            }
        }
    }

    pub(crate) fn tick_without_idle(&self, context: *mut c_void) {
        loop {
            let _ = self.tick_concurrent();
            // SAFETY: see tick_once.
            unsafe {
                while let Some(task) = (*self.tasks.get()).read_item() {
                    (*task).run(context);
                }
            }

            self.loop_.tick_without_idle();

            if self.tick_concurrent() == 0 {
                break;
            }
        }
        self.on_after_event_loop();
    }

    /// `task` must outlive the queued work item; ownership of the intrusive
    /// node stays with the caller until the callback runs.
    pub fn enqueue_task_concurrent(&self, task: NonNull<AnyTaskWithExtraContext>) {
        self.concurrent_tasks.push(task);
        self.loop_.wakeup();
    }

    /// The caller supplies `field_offset = core::mem::offset_of!(C, <field>)` of the
    /// embedded `AnyTaskWithExtraContext`.
    ///
    /// # Safety
    /// `field_offset == offset_of!(C, <field>)` where `<field>: AnyTaskWithExtraContext`,
    /// and `ctx` is non-null and outlives the queued task (intrusive node; ownership stays
    /// with caller).
    pub unsafe fn enqueue_task_concurrent_with_extra_ctx<C, P>(
        &self,
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

        self.loop_.wakeup();
    }
}

// ───────────── EventLoopCtx adapter (bun_io cycle-break) ─────────────────
// `bun_io::file_poll::Store::put` and friends take an erased `EventLoopCtx`
// instead of naming `MiniEventLoop`/`VirtualMachine` directly. This crate owns
// `MiniEventLoop`, so the Mini-side vtable lives here. The Js-side vtable lives
// in `bun_runtime` (it must name `jsc::VirtualMachine`).

bun_io::link_impl_EventLoopCtx! {
    Mini for MiniEventLoop => |this| {
        loop_() => (*this).loop_,
        file_polls_ptr() => (*this).file_polls_ptr(),
        // Mini has no pending_unref_counter; the upstream deliberately panics.
        increment_pending_unref_counter() => panic!("FIXME TODO"),
        after_event_loop_callback() => (*this).after_event_loop_callback.get(),
        set_after_event_loop_callback(cb, ctx) => {
            (*this).after_event_loop_callback.set(cb);
            (*this).after_event_loop_callback_ctx.set(ctx);
        },
        pipe_read_scratch() => &raw const *(*this).pipe_read_scratch,
    }
}

impl MiniEventLoop {
    /// The returned ctx must not outlive `self`.
    #[inline]
    pub fn as_event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        let this = core::ptr::from_ref(self).cast_mut();
        // SAFETY: a mini loop outlives what polls or counts on it. Dispatch takes shared borrows only.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Mini, this) }
    }
}

impl Drop for MiniEventLoop {
    fn drop(&mut self) {
        // `tasks.deinit()` is implicit via Queue's Drop.
        debug_assert!(self.concurrent_tasks.is_empty());
    }
}
