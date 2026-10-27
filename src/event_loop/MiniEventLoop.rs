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

use bun_collections::FifoCell;
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
use bun_io::file_poll::Store as FilePollStore;
use bun_sys::{self as sys, Fd, Mode};
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::{EventLoopHandle, LoopWaker};

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
type Queue = FifoCell<*mut AnyTaskWithExtraContext>;

/// The part of a [`MiniEventLoop`] that other threads reach. They borrow this and never the
/// `MiniEventLoop`, whose other fields belong to its thread.
pub struct Shared {
    concurrent_tasks: ConcurrentTaskQueue,
    waker: LoopWaker,
}

const _: () = {
    const fn assert_sync<T: Sync>() {}
    assert_sync::<Shared>();
};

impl Shared {
    /// Any thread.
    ///
    /// The loop's thread can run `task` as soon as it is in the queue. A loop that an
    /// `AnyEventLoop` owns (one per `Bun.build`) may have been waiting only for that and be dropped
    /// before this returns, so this takes a pointer and does not read `*this` after the push.
    ///
    /// # Safety
    /// `this` is live until its thread has run `task`. `task` is in no queue, and is live until
    /// the loop's thread has run it (the node stays the caller's).
    pub unsafe fn enqueue_task_concurrent(
        this: *const Shared,
        task: NonNull<AnyTaskWithExtraContext>,
    ) {
        // SAFETY: fn contract.
        unsafe {
            let waker = (*this).waker;
            ConcurrentTaskQueue::push_raw(&raw const (*this).concurrent_tasks, task);
            waker.wake();
        }
    }

    /// Any thread.
    ///
    /// The caller supplies `field_offset = core::mem::offset_of!(C, <field>)` of the
    /// embedded `AnyTaskWithExtraContext`.
    ///
    /// # Safety
    /// `this`: as for [`enqueue_task_concurrent`](Self::enqueue_task_concurrent).
    /// `field_offset == offset_of!(C, <field>)` where `<field>: AnyTaskWithExtraContext`,
    /// and `ctx` is non-null and outlives the queued task (intrusive node; ownership stays
    /// with caller).
    pub unsafe fn enqueue_task_concurrent_with_extra_ctx<C, P>(
        this: *const Shared,
        ctx: *mut C,
        callback: fn(*mut C, *mut P),
        field_offset: usize,
    ) {
        // SAFETY: caller contract — see fn `# Safety`.
        let task = unsafe { ctx.byte_add(field_offset).cast::<AnyTaskWithExtraContext>() };
        // SAFETY: `task` points at a properly aligned `AnyTaskWithExtraContext` field of `*ctx`.
        unsafe { task.write(New::<C, P>::init(ctx, callback)) };

        // SAFETY: fn contract; `task` was just initialized above and is non-null (derived from `ctx`).
        unsafe { Self::enqueue_task_concurrent(this, NonNull::new_unchecked(task)) };
    }
}

/// Every method takes `&self`: a task or a poll callback this loop runs reaches the same loop again
/// through an [`EventLoopHandle`] or a `bun_io::EventLoopCtx`.
pub struct MiniEventLoop {
    tasks: Queue,
    pub shared: Shared,
    /// The loop of the thread that made this.
    pub loop_: &'static UwsLoop,
    file_polls: OnceCell<Box<UnsafeCell<FilePollStore>>>,
    /// Callers (shell spawn, `createNullDelimitedEnvMap`) write through it. Only
    /// [`init_global`] sets it, to a loader that is never freed.
    pub(crate) env: Option<NonNull<DotEnvLoader>>,
    /// Only [`init_global`] sets it.
    pub(crate) top_level_dir: Box<[u8]>,
    // Opaque ctx assigned externally; only read/cleared here.
    after_event_loop_callback_ctx: Cell<Option<NonNull<c_void>>>,
    after_event_loop_callback: Cell<Option<unsafe extern "C" fn(*mut c_void)>>,
    pipe_read_scratch: Box<bun_io::PipeReadScratch>,
}

thread_local! {
    static GLOBAL_INITIALIZED: Cell<bool> = const { Cell::new(false) };
    /// The loop `bun_io::get_vm_ctx(AllocatorType::Mini)` resolves to on this thread.
    pub static GLOBAL: Cell<Option<&'static MiniEventLoop>> = const { Cell::new(None) };
}

/// This thread's `MiniEventLoop`, made on the first call (which is the only one whose arguments
/// are used) and never freed.
pub fn init_global(
    env: Option<&'static mut DotEnvLoader>,
    cwd: Option<&[u8]>,
) -> &'static MiniEventLoop {
    if GLOBAL_INITIALIZED.get() {
        return GLOBAL.get().expect("set together with GLOBAL_INITIALIZED");
    }
    let mut loop_ = MiniEventLoop::init();

    // The process-global loader is stored as `AtomicPtr<Loader>`.
    loop_.env = env
        .map(NonNull::from)
        .or_else(|| NonNull::new(dotenv::INSTANCE.load(core::sync::atomic::Ordering::Acquire)));
    if loop_.env.is_none() {
        // Thread-lifetime singleton.
        loop_.env = Some(bun_core::heap::into_raw_nn(Box::new(DotEnvLoader::init())));
    }

    // Set top_level_dir from provided cwd or get current working directory
    if let Some(dir) = cwd {
        loop_.top_level_dir = Box::<[u8]>::from(dir);
    } else {
        let mut buf = bun_paths::path_buffer_pool::get();
        if let Ok(len) = sys::getcwd(&mut buf[..]) {
            loop_.top_level_dir = Box::<[u8]>::from(&buf[..len]);
        }
    }

    let global: &'static MiniEventLoop = Box::leak(Box::new(loop_));
    EventLoopHandle::init_mini(global).set_as_parent_of(global.loop_);
    GLOBAL.set(Some(global));
    GLOBAL_INITIALIZED.set(true);
    global
}

impl MiniEventLoop {
    pub fn on_after_event_loop(&self) {
        if let Some(cb) = self.after_event_loop_callback.take() {
            let ctx = self.after_event_loop_callback_ctx.take();
            // SAFETY: `cb` is a C-ABI callback registered by the owner of `ctx`; the owner
            // guarantees `ctx` is valid until the callback fires.
            unsafe { cb(ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr())) };
        }
    }

    /// `bun_io` changes the store through this pointer.
    fn file_polls(&self) -> *mut FilePollStore {
        self.file_polls
            .get_or_init(|| Box::new(UnsafeCell::new(FilePollStore::init())))
            .get()
    }

    pub(crate) fn init() -> MiniEventLoop {
        let loop_ = UwsLoop::get();
        MiniEventLoop {
            tasks: Queue::new(),
            shared: Shared {
                concurrent_tasks: ConcurrentTaskQueue::default(),
                // SAFETY: this thread's loop. Only `bun_uws::free_thread_loop` frees it, and its
                // caller promises that no thread wakes it afterwards.
                waker: unsafe { LoopWaker::new(loop_) },
            },
            loop_,
            file_polls: OnceCell::new(),
            env: None,
            top_level_dir: Box::default(),
            after_event_loop_callback_ctx: Cell::new(None),
            after_event_loop_callback: Cell::new(None),
            pipe_read_scratch: Box::new(bun_io::PipeReadScratch::new()),
        }
    }

    fn tick_concurrent_with_count(&self) -> usize {
        let concurrent = self.shared.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.readable_length();
        bun_core::handle_oom(self.tasks.ensure_unused_capacity(count));
        loop {
            let task = iter.next();
            if task.is_null() {
                break;
            }
            // SAFETY: room for `count` was made above, `iter` yields at most `count` tasks, and
            // `iter.next()` only follows a link.
            unsafe { self.tasks.write_item_assume_capacity(task) };
        }

        self.tasks.readable_length() - start_count
    }

    #[inline]
    pub fn tick_once(&self, context: *mut c_void) {
        if self.tick_concurrent_with_count() == 0 && self.tasks.readable_length() == 0 {
            self.loop_.inc();
            self.loop_.tick();
            self.loop_.dec();
            self.on_after_event_loop();
        }

        while let Some(task) = self.tasks.read_item() {
            // SAFETY: tasks are pushed by enqueue_task* and remain valid until run() consumes them.
            unsafe { (*task).run(context) };
        }
    }

    pub(crate) fn tick_without_idle(&self, context: *mut c_void) {
        loop {
            let _ = self.tick_concurrent_with_count();
            while let Some(task) = self.tasks.read_item() {
                // SAFETY: see tick_once.
                unsafe { (*task).run(context) };
            }

            self.loop_.tick_without_idle();

            if self.tasks.readable_length() == 0 && self.tick_concurrent_with_count() == 0 {
                break;
            }
        }
        self.on_after_event_loop();
    }

    pub fn tick<F>(&self, context: *mut c_void, is_done: F)
    where
        F: Fn(*mut c_void) -> bool,
    {
        while !is_done(context) {
            self.tick_once(context);
        }
    }
}

// ───────────── EventLoopCtx adapter (bun_io cycle-break) ─────────────────
// `bun_io::file_poll::Store::put` and friends take an erased `EventLoopCtx`
// instead of naming `MiniEventLoop`/`VirtualMachine` directly. This crate owns
// `MiniEventLoop`, so the Mini-side vtable lives here. The Js-side vtable lives
// in `bun_runtime` (it must name `jsc::VirtualMachine`).

bun_io::link_impl_EventLoopCtx! {
    Mini for MiniEventLoop => |this| {
        platform_event_loop_ptr() => (*this).loop_.as_ptr(),
        file_polls_ptr()  => (*this).file_polls(),
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
    #[inline]
    pub fn as_event_loop_ctx(&'static self) -> bun_io::EventLoopCtx {
        // SAFETY: `'static` outlives every dispatch.
        unsafe {
            bun_io::EventLoopCtx::new(
                bun_io::EventLoopCtxKind::Mini,
                core::ptr::from_ref(self).cast_mut(),
            )
        }
    }
}

impl Drop for MiniEventLoop {
    fn drop(&mut self) {
        debug_assert!(self.shared.concurrent_tasks.is_empty());
    }
}
