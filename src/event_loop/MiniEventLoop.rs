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

use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
#[cfg(not(windows))]
use bun_io::file_poll::Store as FilePollStore;
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

/// Intrusive MPSC queue over `AnyTaskWithExtraContext` linked via its `.next` field.
type ConcurrentTaskQueue = UnboundedQueue<AnyTaskWithExtraContext>;

bun_core::intrusive_field!(AnyTaskWithExtraContext, next: bun_threading::Link<AnyTaskWithExtraContext>);

/// FIFO of raw task pointers (tasks are intrusive nodes; the queue does not own them).
type Queue = LinearFifo<*mut AnyTaskWithExtraContext, DynamicBuffer<*mut AnyTaskWithExtraContext>>;

/// Shared borrows only: what a tick runs reaches the loop again, and other threads post to it.
pub struct MiniEventLoop {
    /// No borrow spans a task.
    tasks: UnsafeCell<Queue>,
    concurrent_tasks: ConcurrentTaskQueue,
    pub loop_: &'static UwsLoop,
    #[cfg(not(windows))]
    file_polls: OnceCell<Box<FilePollStore>>,
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

/// Returns this thread's loop.
pub fn init_global() -> &'static MiniEventLoop {
    if let Some(global) = GLOBAL.get() {
        return global;
    }
    let global: &'static MiniEventLoop = Box::leak(Box::new(MiniEventLoop::init()));
    EventLoopHandle::init_mini(global).set_as_parent_of(global.loop_);

    GLOBAL.set(Some(global));
    global
}

impl MiniEventLoop {
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
        MiniEventLoop {
            tasks: UnsafeCell::new(Queue::init()),
            concurrent_tasks: ConcurrentTaskQueue::default(),
            loop_: UwsLoop::get(),
            #[cfg(not(windows))]
            file_polls: OnceCell::new(),
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
        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.len();
        if concurrent.is_empty() {
            return tasks.readable_length();
        }

        let mut iter = concurrent.iterator();
        bun_core::handle_oom(tasks.write_with(count, |mut cursor| {
            while cursor.capacity() > 0 {
                cursor.append(&[iter.next()]);
            }
        }));

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

        self.run_tasks(context);
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

    /// # Safety
    /// `task` is not queued and stays valid until its callback is called. The callback is sound to
    /// call once on this loop's thread, with the context passed to `tick_once`.
    pub unsafe fn enqueue_task_concurrent(&self, task: NonNull<AnyTaskWithExtraContext>) {
        // Read first: the push lets a bundle finish and drop `self`. The main and bundle threads never call `free_thread_loop`.
        let loop_ = self.loop_;
        // SAFETY: fn contract. Only this loop's thread pops.
        unsafe { self.concurrent_tasks.push(task) };
        loop_.wakeup();
    }

    /// Calls `callback(value, context)` on this loop's thread.
    pub fn enqueue_callback_concurrent<T: Send + 'static>(
        &self,
        value: T,
        callback: fn(T, *mut c_void),
    ) {
        let task = AnyTaskWithExtraContext::from_callback_auto_deinit(value, callback);
        // SAFETY: a new allocation, which its callback frees. `T` is `Send`.
        unsafe { self.enqueue_task_concurrent(task) };
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

        // SAFETY: `task` was just initialized above, is non-null (derived from `ctx`) and
        // lives as long as `ctx`.
        unsafe { self.enqueue_task_concurrent(NonNull::new_unchecked(task)) };
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
