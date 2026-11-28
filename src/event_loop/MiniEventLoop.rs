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

#[cfg(not(windows))]
use core::cell::OnceCell;
use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
#[cfg(not(windows))]
use bun_io::file_poll::Store as FilePollStore;
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, MiniTask};
// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

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

/// FIFO of the nodes of queued tasks.
type Queue = LinearFifo<*mut AnyTaskWithExtraContext, DynamicBuffer<*mut AnyTaskWithExtraContext>>;

/// The part of a [`MiniEventLoop`] that other threads use.
pub struct Inbox {
    tasks: ConcurrentTaskQueue,
    uws_loop: AtomicPtr<UwsLoop>,
}

/// Shared borrows only: what a tick runs reaches the loop again, and other threads post to it.
pub struct MiniEventLoop {
    /// No borrow spans a task.
    tasks: UnsafeCell<Queue>,
    pub inbox: Inbox,
    pub loop_: &'static UwsLoop,
    #[cfg(not(windows))]
    file_polls: OnceCell<Box<FilePollStore>>,
    /// `NonNull` so that [`EventLoopHandle::env`] can hand out a `*mut` with mutable provenance.
    env: Option<NonNull<DotEnvLoader>>,
    // Opaque ctx assigned externally; only read/cleared here.
    #[cfg(not(windows))]
    after_event_loop_callback_ctx: Cell<Option<NonNull<c_void>>>,
    #[cfg(not(windows))]
    after_event_loop_callback: Cell<Option<unsafe extern "C" fn(*mut c_void)>>,
    #[cfg(not(windows))]
    pipe_read_scratch: Box<bun_io::PipeReadScratch>,
}

thread_local! {
    static GLOBAL: Cell<Option<&'static MiniEventLoop>> = const { Cell::new(None) };
}

/// Returns this thread's loop. `env` only counts for the call that makes it.
pub fn init_global(env: Option<&'static mut DotEnvLoader>) -> &'static MiniEventLoop {
    if let Some(global) = GLOBAL.get() {
        return global;
    }
    let mut global = MiniEventLoop::init();

    // The process-global loader is stored as `AtomicPtr<Loader>`.
    global.env = env
        .map(NonNull::from)
        .or_else(|| NonNull::new(dotenv::INSTANCE.load(Ordering::Acquire)));
    if global.env.is_none() {
        // Thread-lifetime singleton.
        global.env = Some(bun_core::heap::into_raw_nn(Box::new(DotEnvLoader::init())));
    }

    let global: &'static MiniEventLoop = Box::leak(Box::new(global));
    EventLoopHandle::init_mini(global).set_as_parent_of(global.loop_);

    GLOBAL.set(Some(global));
    global
}

impl MiniEventLoop {
    /// Raw pointer to the `DotEnv::Loader` backref.
    ///
    /// Returns `None` until [`init_global`] populates it. Neither a `&`- nor
    /// a `&mut`-returning accessor is provided: the loader may be shared via
    /// the process-global `dotenv::INSTANCE` (and `Transpiler::env`), and
    /// other safe paths materialize `&mut DotEnvLoader` from the same
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
        #[cfg(not(windows))]
        if let Some(cb) = self.after_event_loop_callback.get() {
            self.after_event_loop_callback.set(None);
            let ctx = self.after_event_loop_callback_ctx.take();
            // SAFETY: `cb` is a C-ABI callback registered by the owner of `ctx`; the owner
            // guarantees `ctx` is valid until the callback fires.
            unsafe { cb(ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr())) };
        }
    }

    #[cfg(not(windows))]
    fn file_polls(&self) -> &FilePollStore {
        self.file_polls
            .get_or_init(|| Box::new(FilePollStore::init()))
    }

    pub(crate) fn init() -> MiniEventLoop {
        let loop_: &UwsLoop = UwsLoop::get();
        MiniEventLoop {
            tasks: UnsafeCell::new(Queue::init()),
            inbox: Inbox {
                tasks: ConcurrentTaskQueue::default(),
                uws_loop: AtomicPtr::new(core::ptr::from_ref(loop_).cast_mut()),
            },
            loop_,
            #[cfg(not(windows))]
            file_polls: OnceCell::new(),
            env: None,
            #[cfg(not(windows))]
            after_event_loop_callback_ctx: Cell::new(None),
            #[cfg(not(windows))]
            after_event_loop_callback: Cell::new(None),
            #[cfg(not(windows))]
            pipe_read_scratch: Box::new(bun_io::PipeReadScratch::new()),
        }
    }

    /// Moves what was posted into `tasks`, and returns how many are waiting there.
    fn tick_concurrent(&self) -> usize {
        // SAFETY: no task runs in this borrow.
        let tasks = unsafe { &mut *self.tasks.get() };
        let concurrent = self.inbox.tasks.pop_batch();
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
        self.wait_for_tasks();
        self.run_tasks(context);
    }

    pub fn has_tasks(&self) -> bool {
        self.tick_concurrent() > 0
    }

    /// Runs none of them, and may return without any.
    pub fn wait_for_tasks(&self) {
        if !self.has_tasks() {
            self.loop_.inc();
            self.loop_.tick();
            self.loop_.dec();
            self.on_after_event_loop();
        }
    }

    fn run_tasks(&self, context: *mut c_void) {
        loop {
            // SAFETY: a queued task is live until it runs. It may queue others and free itself, so
            // nothing is borrowed across the call.
            let (callback, ctx) = unsafe {
                let Some(task) = (*self.tasks.get()).read_item() else {
                    return;
                };
                ((*task).callback, (*task).ctx)
            };
            callback(ctx.expect("ctx is non-null").as_ptr(), context.cast());
        }
    }

    pub(crate) fn tick_without_idle(&self, context: *mut c_void) {
        loop {
            let _ = self.tick_concurrent();
            self.run_tasks(context);

            self.loop_.tick_without_idle();

            if self.tick_concurrent() == 0 {
                break;
            }
        }
        self.on_after_event_loop();
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
        // SAFETY: fn contract. The two `fn` types differ in their pointees alone.
        unsafe {
            let task = ctx.byte_add(field_offset).cast::<AnyTaskWithExtraContext>();
            task.write(AnyTaskWithExtraContext {
                ctx: NonNull::new(ctx.cast()),
                callback: bun_ptr::cast_fn_ptr::<fn(*mut C, *mut P), fn(*mut (), *mut ())>(
                    callback,
                ),
                next: bun_threading::Link::new(),
            });
            self.inbox
                .enqueue_task_concurrent(NonNull::new_unchecked(task));
        }
    }
}

impl Inbox {
    /// For a task that `node` returns a field of.
    pub fn post_intrusive<T: MiniTask>(
        &self,
        task: Box<T>,
        node: impl FnOnce(&mut T) -> &mut AnyTaskWithExtraContext,
    ) {
        let task = bun_core::heap::into_raw_nn(task);
        // SAFETY: nothing else can reach the box before the callback takes it back.
        let node = node(unsafe { &mut *task.as_ptr() });
        *node = AnyTaskWithExtraContext {
            ctx: Some(task.cast()),
            callback: |task, _| {
                // SAFETY: this is `ctx`, the box given up above, and a queued node runs once.
                unsafe { bun_core::heap::take(task.cast::<T>()) }.run_from_main_thread();
            },
            next: bun_threading::Link::new(),
        };
        self.enqueue_task_concurrent(NonNull::from(node));
    }

    fn enqueue_task_concurrent(&self, task: NonNull<AnyTaskWithExtraContext>) {
        // Read first: the push lets a bundle finish and drop `self`.
        let uws_loop = self.uws_loop.load(Ordering::Relaxed);
        self.tasks.push(task);
        // SAFETY: the main and bundle threads never call `free_thread_loop`. `Loop` is `!Sync`, but
        // any thread may wake it.
        unsafe { bun_uws::us_wakeup_loop(uws_loop) };
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
        file_polls_ptr() => (*this).file_polls(),
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
        let this = core::ptr::from_ref(self).cast_mut();
        // SAFETY: `self` is `'static`. Dispatch takes shared borrows only.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Mini, this) }
    }
}

impl Drop for MiniEventLoop {
    fn drop(&mut self) {
        // `tasks.deinit()` is implicit via Queue's Drop.
        debug_assert!(self.inbox.tasks.is_empty());
    }
}
