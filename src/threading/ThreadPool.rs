// Thank you @kprotty.
//
// This file contains code derived from the following source:
//   https://github.com/kprotty/zap/blob/blog/src/thread_pool.zig
//
// That code is covered by the following copyright and license notice:
//   MIT License
//
//   Copyright (c) 2021 kprotty
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

use core::cell::Cell;
use core::mem::offset_of;
use core::ptr::{self, NonNull};
use core::sync::atomic::{
    AtomicBool, AtomicPtr, AtomicU32, AtomicUsize, Ordering,
};

use bun_core::Output;
use crate::{Futex, WaitGroup};

// PORT NOTE: Zig's `packed struct(u32)` named `Sync` is kept as `Sync` here for
// diffability with the .zig. It shadows `core::marker::Sync` within this module;
// no `T: Sync` bounds are written in this file. Phase B may rename.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
struct Sync(u32);

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum SyncState {
    /// A notification can be issued to wake up a sleeping as the "waking thread".
    Pending = 0,
    /// The state was notified with a signal. A thread is woken up.
    /// The first thread to transition to `waking` becomes the "waking thread".
    Signaled = 1,
    /// There is a "waking thread" among us.
    /// No other thread should be woken up until the waking thread transitions the state.
    Waking = 2,
    /// The thread pool was terminated. Start decremented `spawned` so that it can be joined.
    Shutdown = 3,
}

impl Sync {
    // Bit layout (LSB-first, matching Zig packed struct field order):
    //   idle:     u14  bits 0..14
    //   spawned:  u14  bits 14..28
    //   unused:   bool bit  28
    //   notified: bool bit  29
    //   state:    u2   bits 30..32
    const IDLE_MASK: u32 = 0x3FFF;
    const SPAWNED_SHIFT: u32 = 14;
    const SPAWNED_MASK: u32 = 0x3FFF << Self::SPAWNED_SHIFT;
    const NOTIFIED_BIT: u32 = 1 << 29;
    const STATE_SHIFT: u32 = 30;
    const STATE_MASK: u32 = 0b11 << Self::STATE_SHIFT;

    const fn zero() -> Self {
        Sync(0)
    }

    #[inline]
    fn idle(self) -> u16 {
        (self.0 & Self::IDLE_MASK) as u16
    }
    #[inline]
    fn set_idle(&mut self, v: u16) {
        self.0 = (self.0 & !Self::IDLE_MASK) | (v as u32 & Self::IDLE_MASK);
    }
    #[inline]
    fn spawned(self) -> u16 {
        ((self.0 & Self::SPAWNED_MASK) >> Self::SPAWNED_SHIFT) as u16
    }
    #[inline]
    fn set_spawned(&mut self, v: u16) {
        self.0 = (self.0 & !Self::SPAWNED_MASK)
            | ((v as u32 & 0x3FFF) << Self::SPAWNED_SHIFT);
    }
    #[inline]
    fn notified(self) -> bool {
        self.0 & Self::NOTIFIED_BIT != 0
    }
    #[inline]
    fn set_notified(&mut self, v: bool) {
        if v {
            self.0 |= Self::NOTIFIED_BIT;
        } else {
            self.0 &= !Self::NOTIFIED_BIT;
        }
    }
    #[inline]
    fn state(self) -> SyncState {
        // SAFETY: 2-bit field, all 4 values are valid SyncState discriminants.
        unsafe { core::mem::transmute(((self.0 >> Self::STATE_SHIFT) & 0b11) as u8) }
    }
    #[inline]
    fn set_state(&mut self, s: SyncState) {
        self.0 = (self.0 & !Self::STATE_MASK) | ((s as u32) << Self::STATE_SHIFT);
    }
}

/// Atomic wrapper over the packed `Sync` word.
#[repr(transparent)]
struct AtomicSync(AtomicU32);

impl AtomicSync {
    const fn new(v: Sync) -> Self {
        AtomicSync(AtomicU32::new(v.0))
    }
    #[inline]
    fn load(&self, order: Ordering) -> Sync {
        Sync(self.0.load(order))
    }
    /// Returns `None` on success, `Some(current)` on failure (matches Zig `cmpxchgWeak`).
    #[inline]
    fn cmpxchg_weak(
        &self,
        old: Sync,
        new: Sync,
        success: Ordering,
        failure: Ordering,
    ) -> Option<Sync> {
        match self.0.compare_exchange_weak(old.0, new.0, success, failure) {
            Ok(_) => None,
            Err(cur) => Some(Sync(cur)),
        }
    }
    #[inline]
    fn fetch_or(&self, val: Sync, order: Ordering) -> Sync {
        Sync(self.0.fetch_or(val.0, order))
    }
    #[inline]
    fn fetch_sub(&self, val: Sync, order: Ordering) -> Sync {
        Sync(self.0.fetch_sub(val.0, order))
    }
}

pub struct ThreadPool {
    pub sleep_on_idle_network_thread: bool,
    pub stack_size: u32,
    pub max_threads: u32,
    sync: AtomicSync,
    idle_event: Event,
    join_event: Event,
    run_queue: node::Queue,
    threads: AtomicPtr<Thread>,
    pub name: &'static [u8],
    pub spawned_thread_count: AtomicU32,
    wait_group: WaitGroup,
    /// Used by `schedule` to optimize for the case where the thread pool isn't running yet.
    is_running: AtomicBool,
}

/// Configuration options for the thread pool.
/// TODO: add CPU core affinity?
pub struct Config {
    pub stack_size: u32,
    pub max_threads: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            stack_size: DEFAULT_THREAD_STACK_SIZE,
            max_threads: 0,
        }
    }
}

impl ThreadPool {
    /// Statically initialize the thread pool using the configuration.
    pub fn init(config: Config) -> ThreadPool {
        ThreadPool {
            sleep_on_idle_network_thread: true,
            stack_size: 1.max(config.stack_size),
            max_threads: 1.max(config.max_threads),
            sync: AtomicSync::new(Sync::zero()),
            idle_event: Event::default(),
            join_event: Event::default(),
            run_queue: node::Queue::default(),
            threads: AtomicPtr::new(ptr::null_mut()),
            name: b"",
            spawned_thread_count: AtomicU32::new(0),
            wait_group: WaitGroup::init(),
            is_running: AtomicBool::new(false),
        }
    }

    pub fn wake_for_idle_events(&self) {
        // Wake all the threads to check for idle events.
        self.idle_event.wake(Event::NOTIFIED, u32::MAX);
    }
}

/// Shut down the thread pool and stop the worker threads.
impl Drop for ThreadPool {
    fn drop(&mut self) {
        self.shutdown();
        self.join();
        // Zig: `self.* = undefined;` — no-op in Rust.
    }
}

/// A Task represents the unit of Work / Job / Execution that the ThreadPool schedules.
/// The user provides a `callback` which is invoked when the *Task can run on a thread.
#[repr(C)]
pub struct Task {
    pub node: Node,
    pub callback: unsafe fn(*mut Task),
}

impl Task {
    #[inline]
    unsafe fn from_node(node: *mut Node) -> *mut Task {
        // SAFETY: caller guarantees `node` points to the `node` field of a `Task`.
        unsafe { (node as *mut u8).sub(offset_of!(Task, node)).cast::<Task>() }
    }
}

/// An unordered collection of Tasks which can be submitted for scheduling as a group.
#[derive(Default)]
pub struct Batch {
    pub len: usize,
    pub head: Option<NonNull<Task>>,
    pub tail: Option<NonNull<Task>>,
}

impl Batch {
    pub fn pop(&mut self) -> Option<NonNull<Task>> {
        // SAFETY: `len` is only read here for the fast-path zero check; the
        // atomic load mirrors Zig's `@atomicLoad(usize, &this.len, .monotonic)`.
        let len = unsafe {
            (*(&self.len as *const usize as *const AtomicUsize)).load(Ordering::Relaxed)
        };
        if len == 0 {
            return None;
        }
        let task = self.head.unwrap();
        // SAFETY: head is non-null per the unwrap above; tasks form an intrusive list.
        let next = unsafe { (*task.as_ptr()).node.next };
        if !next.is_null() {
            // SAFETY: next points to the `node` field of the following Task.
            self.head = NonNull::new(unsafe { Task::from_node(next) });
        } else {
            if task != self.tail.unwrap() {
                unreachable!();
            }
            self.tail = None;
            self.head = None;
        }

        self.len -= 1;
        if len == 0 {
            self.tail = None;
        }
        Some(task)
    }

    /// Create a batch from a single task.
    pub fn from(task: *mut Task) -> Batch {
        let task = NonNull::new(task);
        Batch {
            len: 1,
            head: task,
            tail: task,
        }
    }

    /// Another batch into this one, taking ownership of its tasks.
    pub fn push(&mut self, batch: Batch) {
        if batch.len == 0 {
            return;
        }
        if self.len == 0 {
            *self = batch;
        } else {
            // SAFETY: self.len != 0 implies tail is Some; intrusive list link assignment.
            unsafe {
                (*self.tail.unwrap().as_ptr()).node.next = match batch.head {
                    Some(h) => ptr::addr_of_mut!((*h.as_ptr()).node),
                    None => ptr::null_mut(),
                };
            }
            self.tail = batch.tail;
            self.len += batch.len;
        }
    }
}

/// Dispatch trait for `each_impl`: erases the by-value vs by-pointer comptime
/// branch from Zig's `eachImpl(..., comptime as_ptr: bool)` into two impls.
trait EachCall<Ctx, V>: core::marker::Sync {
    /// SAFETY: `value` must point to a live `V` exclusively owned by this call.
    unsafe fn call(&self, ctx: &Ctx, value: *mut V, i: usize);
}

struct ByValue<F>(F);
impl<Ctx, V: Copy, F> EachCall<Ctx, V> for ByValue<F>
where
    F: Fn(&Ctx, V, usize) + core::marker::Sync,
{
    #[inline]
    unsafe fn call(&self, ctx: &Ctx, value: *mut V, i: usize) {
        // SAFETY: caller guarantees `value` is a live `V`; `V: Copy` so deref is a copy.
        (self.0)(ctx, unsafe { *value }, i);
    }
}

struct ByPtr<F>(F);
impl<Ctx, V, F> EachCall<Ctx, V> for ByPtr<F>
where
    F: Fn(&Ctx, *mut V, usize) + core::marker::Sync,
{
    #[inline]
    unsafe fn call(&self, ctx: &Ctx, value: *mut V, i: usize) {
        (self.0)(ctx, value, i);
    }
}

impl ThreadPool {
    /// Loop over an array of tasks and invoke `run_fn` on each one in a different thread.
    /// **Blocks the calling thread** until all tasks are completed.
    ///
    /// This function does not shut down or deinit the thread pool.
    pub fn each<Ctx, V: Copy, F>(&self, ctx: Ctx, run_fn: F, values: &mut [V])
    where
        // TODO(port): narrow bounds — Zig used `anytype` + comptime fn
        F: Fn(&Ctx, V, usize) + core::marker::Sync,
        Ctx: core::marker::Sync,
        V: core::marker::Sync,
    {
        self.each_impl(ctx, ByValue(run_fn), values);
    }

    /// Like `each`, but calls `run_fn` with a pointer to the value.
    pub fn each_ptr<Ctx, V, F>(&self, ctx: Ctx, run_fn: F, values: &mut [V])
    where
        F: Fn(&Ctx, *mut V, usize) + core::marker::Sync,
        Ctx: core::marker::Sync,
        V: core::marker::Sync,
    {
        self.each_impl(ctx, ByPtr(run_fn), values);
    }

    fn each_impl<Ctx, V, F>(&self, ctx: Ctx, run_fn: F, values: &mut [V])
    where
        F: EachCall<Ctx, V>,
        Ctx: core::marker::Sync,
        V: core::marker::Sync,
    {
        if values.is_empty() {
            return;
        }

        struct WaitContext<Ctx, V, F> {
            ctx: Ctx,
            values: *mut [V],
            run_fn: F,
        }

        #[repr(C)]
        struct RunnerTask<Ctx, V, F> {
            task: Task,
            // TODO(port): lifetime — LIFETIMES.tsv row 2144 says BORROW_PARAM →
            // `&'a WaitContext<Ctx, Values>`. Kept as raw because it crosses threads
            // via the intrusive Task callback; revisit with a scoped lifetime in Phase B.
            ctx: *const WaitContext<Ctx, V, F>,
            i: usize,
        }

        // PORT NOTE: `run_fn` was `comptime` in Zig (monomorphized into `call`).
        // Here it is stored in WaitContext and dispatched via the `EachCall` trait,
        // which encodes the `comptime as_ptr` branch (ByValue vs ByPtr).
        unsafe fn call<Ctx, V, F: EachCall<Ctx, V>>(task: *mut Task) {
            // SAFETY: task points to RunnerTask.task (offset 0, repr(C)).
            let runner_task = unsafe {
                &mut *(task as *mut u8)
                    .sub(offset_of!(RunnerTask<Ctx, V, F>, task))
                    .cast::<RunnerTask<Ctx, V, F>>()
            };
            let i = runner_task.i;
            // SAFETY: ctx points to a stack-local WaitContext kept alive by wait_for_all().
            let wctx = unsafe { &*runner_task.ctx };
            // SAFETY: `values` slice outlives all RunnerTasks (wait_for_all() blocks until
            // every task finishes); each task owns a distinct index `i`.
            let value: *mut V = unsafe { &mut (*wctx.values)[i] };
            // SAFETY: `value` is live and exclusively owned by this task per the index.
            unsafe { wctx.run_fn.call(&wctx.ctx, value, i) };
        }

        let wait_context = WaitContext {
            ctx,
            values: values as *mut [V],
            run_fn,
        };

        // PERF(port): was allocator.alloc(RunnerTask, values.len) — using Vec; profile in Phase B
        let mut tasks: Vec<RunnerTask<Ctx, V, F>> = Vec::with_capacity(values.len());
        let mut batch = Batch::default();
        let mut offset = values.len();

        for _ in 0..values.len() {
            offset -= 1;
            tasks.push(RunnerTask {
                i: offset,
                task: Task {
                    node: Node::default(),
                    callback: call::<Ctx, V, F>,
                },
                ctx: &wait_context as *const _,
            });
        }
        // PORT NOTE: reshaped for borrowck — Zig wrote into pre-allocated slots and
        // pushed in the same loop. Here we push to Vec first (no realloc: capacity
        // reserved) then take stable addresses.
        for runner_task in tasks.iter_mut() {
            batch.push(Batch::from(ptr::addr_of_mut!(runner_task.task)));
        }
        self.schedule(batch);
        self.wait_for_all();
        // `tasks` drops here after all worker threads have finished touching it.
    }

    fn schedule_impl(&self, batch: Batch, try_current: bool) {
        // Sanity check
        if batch.len == 0 {
            return;
        }

        // Extract out the `Node`s from the `Task`s
        // SAFETY: batch.len != 0 implies head/tail are Some.
        let mut list = unsafe {
            node::List {
                head: NonNull::new_unchecked(ptr::addr_of_mut!(
                    (*batch.head.unwrap().as_ptr()).node
                )),
                tail: NonNull::new_unchecked(ptr::addr_of_mut!(
                    (*batch.tail.unwrap().as_ptr()).node
                )),
            }
        };

        // .monotonic access is okay because:
        //
        // * If the thread pool hasn't started yet, no thread could concurrently set
        //   `is_running` to true, because thread pool initialization should only
        //   happen on one thread.
        //
        // * If the thread pool is running, the current thread could be one of the threads
        //   in the thread pool, but `is_running` was necessarily set to true before the
        //   thread was created.
        if self.is_running.load(Ordering::Relaxed) {
            self.wait_group.add(batch.len);
        } else {
            self.wait_group.add_unsynchronized(batch.len);
        }

        let current: *mut Thread = 'blk: {
            if !try_current {
                break 'blk ptr::null_mut();
            }
            let current = Thread::current();
            if current.is_null() {
                break 'blk ptr::null_mut();
            }
            // Make sure thread is part of this thread pool, not a different one.
            // SAFETY: current is a live thread-local Thread for this OS thread.
            if unsafe { (*current).thread_pool } == self as *const ThreadPool {
                current
            } else {
                ptr::null_mut()
            }
        };
        if !current.is_null() {
            // SAFETY: current is the calling thread's own Thread; exclusive access.
            unsafe {
                if (*current).run_buffer.push(&mut list).is_err() {
                    (*current).run_queue.push(list);
                }
            }
        } else {
            self.run_queue.push(list);
        }
        self.force_spawn();
    }

    /// Schedule a batch of tasks to be executed by some thread on the thread pool.
    pub fn schedule(&self, batch: Batch) {
        self.schedule_impl(batch, false);
    }

    /// This function should only be called from threads that are part of the thread pool.
    pub fn schedule_inside_thread_pool(&self, batch: Batch) {
        self.schedule_impl(batch, true);
    }

    /// Wait for all tasks to complete. This does not shut down or deinit the thread pool.
    pub fn wait_for_all(&self) {
        self.wait_group.wait();
    }

    /// Wait for all tasks to complete, then shut down and deinit the thread pool.
    pub fn wait_and_deinit(self) {
        // PORT NOTE: Zig took `*ThreadPool` and called deinit() in-place. In Rust,
        // consuming `self` runs `Drop` (shutdown + join) at end of scope.
        self.wait_for_all();
        // Drop runs shutdown() + join().
    }

    fn force_spawn(&self) {
        // Try to notify a thread
        let is_waking = false;
        self.notify(is_waking);
    }

    #[inline(always)]
    fn notify(&self, is_waking: bool) {
        // Fast path to check the Sync state to avoid calling into notify_slow().
        // If we're waking, then we need to update the state regardless
        if !is_waking {
            // Must be an RMW, not a load: an RMW participates in `sync`'s modification
            // order, so if we observe notified=true here, the worker's later acquire-CAS
            // that clears it synchronizes-with this release and will see the task we just
            // pushed. A plain load (even .seq_cst) allows "we see stale notified=true AND
            // worker sees run_queue empty" → task stranded
            let sync = self.sync.fetch_or(Sync::zero(), Ordering::Release);
            if sync.notified() {
                return;
            }
        }

        self.notify_slow(is_waking);
    }
}

pub const DEFAULT_THREAD_STACK_SIZE: u32 = {
    // 4mb
    const DEFAULT: u32 = 4 * 1024 * 1024;
    #[cfg(not(target_os = "macos"))]
    {
        DEFAULT
    }
    #[cfg(target_os = "macos")]
    {
        // TODO(port): Zig used `std.heap.page_size_max`; using 16384 (arm64 macOS).
        const PAGE_SIZE_MAX: u32 = 16384;
        let size = DEFAULT - (DEFAULT % PAGE_SIZE_MAX);
        // stack size must be a multiple of page_size
        // macOS will fail to spawn a thread if the stack size is not a multiple of page_size
        assert!(size % PAGE_SIZE_MAX == 0, "Thread stack size is not a multiple of page size");
        size
    }
};

/// Wrapper to send a raw pointer across `std::thread::spawn`.
#[repr(transparent)]
struct SendPtr<T>(*const T);
// SAFETY: ThreadPool is designed for concurrent access from worker threads;
// the pointer is kept alive by `join()` which waits for all workers to exit.
unsafe impl<T> Send for SendPtr<T> {}

impl ThreadPool {
    /// Warm the thread pool up to the given number of threads.
    /// https://www.youtube.com/watch?v=ys3qcbO5KWw
    pub fn warm(&self, count: u16) {
        // PORT NOTE: Zig used u14; Rust has no u14, using u16 and truncating to 14 bits.
        self.is_running.store(true, Ordering::Relaxed);
        let target = count.min((self.max_threads & 0x3FFF) as u16);
        let mut sync = self.sync.load(Ordering::Relaxed);
        while sync.spawned() < target {
            let mut new_sync = sync;
            new_sync.set_spawned(new_sync.spawned() + 1);
            if let Some(current) = self.sync.cmpxchg_weak(
                sync,
                new_sync,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                sync = current;
                continue;
            }
            let stack_size = self.stack_size as usize;
            let pool = SendPtr(self as *const ThreadPool);
            match std::thread::Builder::new()
                .stack_size(stack_size)
                .spawn(move || {
                    let pool = pool;
                    // SAFETY: pool outlives all worker threads (join() waits).
                    unsafe { Thread::run(pool.0) }
                }) {
                Ok(_handle) => {
                    // Dropping JoinHandle detaches the thread (matches Zig `thread.detach()`).
                }
                Err(_) => return self.unregister(ptr::null_mut()),
            }
            sync = new_sync;
        }
    }

    #[inline(never)]
    fn notify_slow(&self, is_waking: bool) {
        self.is_running.store(true, Ordering::Relaxed);
        let mut sync = self.sync.load(Ordering::Relaxed);
        while sync.state() != SyncState::Shutdown {
            let can_wake = is_waking || (sync.state() == SyncState::Pending);
            if is_waking {
                debug_assert!(sync.state() == SyncState::Waking);
            }

            let mut new_sync = sync;
            new_sync.set_notified(true);
            if can_wake && sync.idle() > 0 {
                // wake up an idle thread
                new_sync.set_state(SyncState::Signaled);
            } else if can_wake && (sync.spawned() as u32) < self.max_threads {
                // spawn a new thread
                new_sync.set_state(SyncState::Signaled);
                new_sync.set_spawned(new_sync.spawned() + 1);
            } else if is_waking {
                // no other thread to pass on "waking" status
                new_sync.set_state(SyncState::Pending);
            } else if sync.notified() {
                // nothing to update
                return;
            }

            // Release barrier synchronizes with Acquire in wait()
            // to ensure pushes to run queues happen before observing a posted notification.
            sync = match self.sync.cmpxchg_weak(
                sync,
                new_sync,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Some(cur) => cur,
                None => {
                    // We signaled to notify an idle thread
                    if can_wake && sync.idle() > 0 {
                        return self.idle_event.notify();
                    }

                    // We signaled to spawn a new thread
                    if can_wake && (sync.spawned() as u32) < self.max_threads {
                        let stack_size = self.stack_size as usize;
                        let pool = SendPtr(self as *const ThreadPool);
                        match std::thread::Builder::new()
                            .stack_size(stack_size)
                            .spawn(move || {
                                let pool = pool;
                                // SAFETY: pool outlives all worker threads (join() waits).
                                unsafe { Thread::run(pool.0) }
                            }) {
                            Ok(_handle) => {
                                // detach by dropping
                            }
                            Err(_) => return self.unregister(ptr::null_mut()),
                        }
                        // if (self.name.len > 0) thread.setName(self.name) catch {};
                        return;
                    }

                    return;
                }
            };
        }
    }

    #[inline(never)]
    fn wait(&self, _is_waking: bool) -> Result<bool, WaitError> {
        let mut is_idle = false;
        let mut is_waking = _is_waking;
        let mut sync = self.sync.load(Ordering::Relaxed);

        loop {
            if sync.state() == SyncState::Shutdown {
                return Err(WaitError::Shutdown);
            }
            if is_waking {
                debug_assert!(sync.state() == SyncState::Waking);
            }

            // Consume a notification made by notify().
            if sync.notified() {
                let mut new_sync = sync;
                new_sync.set_notified(false);
                if is_idle {
                    new_sync.set_idle(new_sync.idle() - 1);
                }
                if sync.state() == SyncState::Signaled {
                    new_sync.set_state(SyncState::Waking);
                }

                // Acquire barrier synchronizes with notify()
                // to ensure that pushes to run queue are observed after wait() returns.
                sync = match self.sync.cmpxchg_weak(
                    sync,
                    new_sync,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Some(cur) => cur,
                    None => {
                        return Ok(is_waking || (sync.state() == SyncState::Signaled));
                    }
                };
            } else if !is_idle {
                let mut new_sync = sync;
                new_sync.set_idle(new_sync.idle() + 1);
                if is_waking {
                    new_sync.set_state(SyncState::Pending);
                }

                sync = match self.sync.cmpxchg_weak(
                    sync,
                    new_sync,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Some(cur) => cur,
                    None => {
                        is_waking = false;
                        is_idle = true;
                        continue;
                    }
                };
            } else {
                let current = Thread::current();
                if !current.is_null() {
                    // SAFETY: thread-local Thread for this OS thread.
                    unsafe { (*current).drain_idle_events() };
                }

                self.idle_event.wait();
                sync = self.sync.load(Ordering::Relaxed);
            }
        }
    }

    /// Marks the thread pool as shutdown
    #[inline(never)]
    pub fn shutdown(&self) {
        let mut sync = self.sync.load(Ordering::Relaxed);
        while sync.state() != SyncState::Shutdown {
            let mut new_sync = sync;
            new_sync.set_notified(true);
            new_sync.set_state(SyncState::Shutdown);
            new_sync.set_idle(0);

            // Full barrier to synchronize with both wait() and notify()
            sync = match self.sync.cmpxchg_weak(
                sync,
                new_sync,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Some(cur) => cur,
                None => {
                    // Wake up any threads sleeping on the idle_event.
                    // TODO: I/O polling notification here.
                    if sync.idle() > 0 {
                        self.idle_event.shutdown();
                    }
                    return;
                }
            };
        }
    }

    fn register(&self, thread: *mut Thread) {
        // Push the thread onto the threads stack in a lock-free manner.
        let mut threads = self.threads.load(Ordering::Relaxed);
        loop {
            // SAFETY: thread is the calling worker's own stack-local Thread.
            unsafe { (*thread).next = threads };
            match self.threads.compare_exchange_weak(
                threads,
                thread,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(cur) => threads = cur,
            }
        }
    }

    fn unregister(&self, maybe_thread: *mut Thread) {
        // Un-spawn one thread, either due to a failed OS thread spawning or the thread is exiting.
        let one_spawned = {
            let mut s = Sync::zero();
            s.set_spawned(1);
            s
        };
        let sync = self.sync.fetch_sub(one_spawned, Ordering::Release);
        debug_assert!(sync.spawned() > 0);

        // The last thread to exit must wake up the thread pool join()er
        // who will start the chain to shutdown all the threads.
        if sync.state() == SyncState::Shutdown && sync.spawned() == 1 {
            self.join_event.notify();
        }

        // If this is a thread pool thread, wait for a shutdown signal by the thread pool join()er.
        if maybe_thread.is_null() {
            return;
        }
        let thread = maybe_thread;
        // SAFETY: thread is the calling worker's own stack-local Thread.
        unsafe { (*thread).join_event.wait() };

        // After receiving the shutdown signal, shutdown the next thread in the pool.
        // We have to do that without touching the thread pool itself since its memory is invalidated by now.
        // So just follow our .next link.
        // SAFETY: same as above.
        let next_thread = unsafe { (*thread).next };
        if next_thread.is_null() {
            return;
        }
        // SAFETY: next_thread is a registered Thread still blocked in join_event.wait().
        unsafe { (*next_thread).join_event.notify() };
    }

    fn join(&self) {
        // Wait for the thread pool to be shutdown() then for all threads to enter a joinable state
        let mut sync = self.sync.load(Ordering::Relaxed);
        if !(sync.state() == SyncState::Shutdown && sync.spawned() == 0) {
            self.join_event.wait();
            sync = self.sync.load(Ordering::Relaxed);
        }

        debug_assert!(sync.state() == SyncState::Shutdown);
        debug_assert!(sync.spawned() == 0);

        // If there are threads, start off the chain sending it the shutdown signal.
        // The thread receives the shutdown signal and sends it to the next thread, and the next..
        let thread = self.threads.load(Ordering::Acquire);
        if thread.is_null() {
            return;
        }
        // SAFETY: thread is a registered Thread blocked in join_event.wait().
        unsafe { (*thread).join_event.notify() };
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
enum WaitError {
    #[error("Shutdown")]
    Shutdown,
}

pub struct Thread {
    next: *mut Thread,
    target: *mut Thread,
    join_event: Event,
    run_queue: node::Queue,
    idle_queue: node::Queue,
    run_buffer: node::Buffer,
    thread_pool: *const ThreadPool,
}

thread_local! {
    static CURRENT: Cell<*mut Thread> = const { Cell::new(ptr::null_mut()) };
}

static COUNTER: AtomicU32 = AtomicU32::new(0);

impl Thread {
    #[inline]
    pub fn current() -> *mut Thread {
        CURRENT.with(|c| c.get())
    }

    pub fn push_idle_task(&self, task: *mut Task) {
        // SAFETY: task is non-null per caller contract.
        let node_ptr = unsafe { NonNull::new_unchecked(ptr::addr_of_mut!((*task).node)) };
        let list = node::List {
            head: node_ptr,
            tail: node_ptr,
        };
        self.idle_queue.push(list);
    }

    /// Thread entry point which runs a worker for the ThreadPool
    unsafe fn run(thread_pool: *const ThreadPool) {
        bun_alloc::mimalloc::mi_thread_set_in_threadpool();

        {
            let mut counter_buf = [0u8; 100];
            let int = COUNTER.fetch_add(1, Ordering::SeqCst);
            // PORT NOTE: Zig used bufPrintZ; format into the buffer, track written
            // length via the advancing &mut [u8] cursor, then NUL-terminate.
            use std::io::Write;
            let len = {
                let mut cur: &mut [u8] = &mut counter_buf[..99];
                let before = cur.len();
                match write!(&mut cur, "Bun Pool {}", int) {
                    Ok(()) => before - cur.len(),
                    Err(_) => 0,
                }
            };
            let named: &[u8] = if len > 0 {
                counter_buf[len] = 0;
                &counter_buf[..len]
            } else {
                b"Bun Pool"
            };
            Output::Source::configure_named_thread(named);
        }

        let mut self_ = Thread {
            next: ptr::null_mut(),
            target: ptr::null_mut(),
            join_event: Event::default(),
            run_queue: node::Queue::default(),
            idle_queue: node::Queue::default(),
            run_buffer: node::Buffer::default(),
            thread_pool,
        };
        let self_ptr: *mut Thread = &mut self_;
        CURRENT.with(|c| c.set(self_ptr));
        let _current_guard = scopeguard::guard((), |_| {
            CURRENT.with(|c| c.set(ptr::null_mut()));
        });

        // SAFETY: thread_pool outlives this worker (join() waits).
        unsafe { (*thread_pool).register(self_ptr) };
        let _unregister_guard = scopeguard::guard((), move |_| {
            // SAFETY: thread_pool outlives this worker; self_ptr is our stack-local Thread.
            unsafe { (*thread_pool).unregister(self_ptr) };
        });

        let mut is_waking = false;
        loop {
            // SAFETY: thread_pool is live for the duration of run().
            is_waking = match unsafe { (*thread_pool).wait(is_waking) } {
                Ok(w) => w,
                Err(_) => return,
            };

            // SAFETY: self_ptr is our own stack-local Thread.
            while let Some(result) = unsafe { (*self_ptr).pop(thread_pool) } {
                if result.pushed || is_waking {
                    // SAFETY: thread_pool outlives this worker (join() waits).
                    unsafe { (*thread_pool).notify(is_waking) };
                }
                is_waking = false;

                // SAFETY: result.node points to the `node` field of a Task.
                let task = unsafe { Task::from_node(result.node.as_ptr()) };
                // SAFETY: task is a live scheduled Task; callback contract is `unsafe fn(*mut Task)`.
                unsafe { ((*task).callback)(task) };
                // SAFETY: thread_pool outlives this worker (join() waits).
                unsafe { (*thread_pool).wait_group.finish() };
            }

            Output::flush();
            // SAFETY: self_ptr is our own stack-local Thread.
            unsafe { (*self_ptr).drain_idle_events() };
        }
    }

    pub fn drain_idle_events(&self) {
        let consumer = match self.idle_queue.try_acquire_consumer() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mut consumer = scopeguard::guard(consumer, |c| {
            self.idle_queue.release_consumer(c);
        });
        while let Some(node) = self.idle_queue.pop(&mut *consumer) {
            // SAFETY: node points to the `node` field of a Task.
            let task = unsafe { Task::from_node(node) };
            unsafe { ((*task).callback)(task) };
        }
    }

    /// Try to dequeue a Node/Task from the ThreadPool.
    /// Spurious reports of dequeue() returning empty are allowed.
    pub fn pop(&mut self, thread_pool: *const ThreadPool) -> Option<node::Stole> {
        // Check our local buffer first
        if let Some(node) = self.run_buffer.pop() {
            return Some(node::Stole {
                node,
                pushed: false,
            });
        }

        // Then check our local queue
        if let Some(stole) = self.run_buffer.consume(&self.run_queue) {
            return Some(stole);
        }

        // Then the global queue
        // SAFETY: thread_pool is live for the duration of the worker.
        if let Some(stole) = self.run_buffer.consume(unsafe { &(*thread_pool).run_queue }) {
            return Some(stole);
        }

        // Then try work stealing from other threads
        // SAFETY: thread_pool outlives this worker (join() waits).
        let mut num_threads =
            unsafe { (*thread_pool).sync.load(Ordering::Relaxed).spawned() };
        while num_threads > 0 {
            // Traverse the stack of registered threads on the thread pool
            let target = if !self.target.is_null() {
                self.target
            } else {
                // SAFETY: thread_pool outlives this worker (join() waits).
                let t = unsafe { (*thread_pool).threads.load(Ordering::Acquire) };
                if t.is_null() {
                    unreachable!();
                }
                t
            };
            // SAFETY: target is a registered Thread in the lock-free stack.
            self.target = unsafe { (*target).next };

            // Try to steal from their queue first to avoid contention (the target steal's from queue last).
            // SAFETY: target is a registered Thread in the lock-free stack, alive until join().
            if let Some(stole) = self.run_buffer.consume(unsafe { &(*target).run_queue }) {
                return Some(stole);
            }

            // Skip stealing from the buffer if we're the target.
            // We still steal from our own queue above given it may have just been locked the first time we tried.
            if target == self as *mut Thread {
                num_threads -= 1;
                continue;
            }

            // Steal from the buffer of a remote thread as a last resort
            // SAFETY: target is a registered Thread in the lock-free stack, alive until join().
            if let Some(stole) = self.run_buffer.steal(unsafe { &(*target).run_buffer }) {
                return Some(stole);
            }

            num_threads -= 1;
        }

        None
    }
}

/// An event which stores 1 semaphore token and is multi-threaded safe.
/// The event can be shutdown(), waking up all wait()ing threads and
/// making subsequent wait()'s return immediately.
struct Event {
    state: AtomicU32,
}

impl Default for Event {
    fn default() -> Self {
        Event {
            state: AtomicU32::new(Self::EMPTY),
        }
    }
}

impl Event {
    const EMPTY: u32 = 0;
    const WAITING: u32 = 1;
    pub const NOTIFIED: u32 = 2;
    const SHUTDOWN: u32 = 3;

    /// Wait for and consume a notification
    /// or wait for the event to be shutdown entirely
    #[inline(never)]
    fn wait(&self) {
        let mut acquire_with: u32 = Self::EMPTY;
        let mut state = self.state.load(Ordering::Relaxed);
        let mut has_shrunk_memory: bool = false;

        loop {
            // If we're shutdown then exit early.
            // Acquire barrier to ensure operations before the shutdown() are seen after the wait().
            // Shutdown is rare so it's better to have an Acquire barrier here instead of on CAS failure + load which are common.
            if state == Self::SHUTDOWN {
                return;
            }

            // Consume a notification when it pops up.
            // Acquire barrier to ensure operations before the notify() appear after the wait().
            if state == Self::NOTIFIED {
                match self.state.compare_exchange_weak(
                    state,
                    acquire_with,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => return,
                    Err(cur) => state = cur,
                }
                continue;
            }

            // There is no notification to consume, we should wait on the event by ensuring its WAITING.
            if state != Self::WAITING {
                match self.state.compare_exchange_weak(
                    state,
                    Self::WAITING,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // fall through to futex wait
                    }
                    Err(cur) => {
                        state = cur;
                        continue;
                    }
                }
            }

            // Wait on the event until a notify() or shutdown().
            // If we wake up to a notification, we must acquire it with WAITING instead of EMPTY
            // since there may be other threads sleeping on the Futex who haven't been woken up yet.
            //
            // Acquiring to WAITING will make the next notify() or shutdown() wake a sleeping futex thread
            // who will either exit on SHUTDOWN or acquire with WAITING again, ensuring all threads are awoken.
            // This unfortunately results in the last notify() or shutdown() doing an extra futex wake but that's fine.
            let timeout_ns: Option<u64> = if !has_shrunk_memory {
                Some(10_000_000_000) // std.time.ns_per_s * 10
            } else {
                None
            };
            if Futex::wait(&self.state, Self::WAITING, timeout_ns).is_err() {
                has_shrunk_memory = true;
                bun_core::Global::mimalloc_cleanup(false);
                // MOVE_DOWN(b0): wtf::release_fast_malloc_free_memory_for_this_thread moved jsc→alloc.
                bun_alloc::wtf::release_fast_malloc_free_memory_for_this_thread();
            }
            state = self.state.load(Ordering::Relaxed);
            acquire_with = Self::WAITING;
        }
    }

    /// Post a notification to the event if it doesn't have one already
    /// then wake up a waiting thread if there is one as well.
    fn notify(&self) {
        self.wake(Self::NOTIFIED, 1);
    }

    /// Marks the event as shutdown, making all future wait()'s return immediately.
    /// Then wakes up any threads currently waiting on the Event.
    fn shutdown(&self) {
        self.wake(Self::SHUTDOWN, u32::MAX);
    }

    fn wake(&self, release_with: u32, wake_threads: u32) {
        // Update the Event to notify it with the new `release_with` state (either NOTIFIED or SHUTDOWN).
        // Release barrier to ensure any operations before this are this to happen before the wait() in the other threads.
        let state = self.state.swap(release_with, Ordering::Release);

        // Only wake threads sleeping in futex if the state is WAITING.
        // Avoids unnecessary wake ups.
        if state == Self::WAITING {
            Futex::wake(&self.state, wake_threads);
        }
    }
}

/// Linked list intrusive memory node and lock-free data structures to operate with it
#[repr(C)]
#[derive(Default)]
pub struct Node {
    pub next: *mut Node,
}

pub mod node {
    use super::*;

    /// A linked list of Nodes
    pub struct List {
        pub head: NonNull<Node>,
        pub tail: NonNull<Node>,
    }

    #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
    pub enum ConsumerError {
        #[error("Empty")]
        Empty,
        #[error("Contended")]
        Contended,
    }

    /// An unbounded multi-producer-(non blocking)-multi-consumer queue of Node pointers.
    pub struct Queue {
        stack: AtomicUsize,
        cache: *mut Node,
    }

    // SAFETY: Queue is a lock-free MPMC queue; raw `cache` is guarded by the
    // IS_CONSUMING bit in `stack`.
    unsafe impl core::marker::Sync for Queue {}
    unsafe impl Send for Queue {}

    impl Default for Queue {
        fn default() -> Self {
            Queue {
                stack: AtomicUsize::new(0),
                cache: ptr::null_mut(),
            }
        }
    }

    impl Queue {
        const HAS_CACHE: usize = 0b01;
        const IS_CONSUMING: usize = 0b10;
        const PTR_MASK: usize = !(Self::HAS_CACHE | Self::IS_CONSUMING);

        const _ALIGN_CHECK: () = assert!(
            core::mem::align_of::<Node>() >= ((Self::IS_CONSUMING | Self::HAS_CACHE) + 1)
        );

        pub(super) fn push(&self, list: List) {
            let mut stack = self.stack.load(Ordering::Relaxed);
            loop {
                // Attach the list to the stack (pt. 1)
                // SAFETY: list.tail points to a Node owned by the caller.
                unsafe {
                    (*list.tail.as_ptr()).next = (stack & Self::PTR_MASK) as *mut Node;
                }

                // Update the stack with the list (pt. 2).
                // Don't change the HAS_CACHE and IS_CONSUMING bits of the consumer.
                let mut new_stack = list.head.as_ptr() as usize;
                debug_assert!(new_stack & !Self::PTR_MASK == 0);
                new_stack |= stack & !Self::PTR_MASK;

                // Push to the stack with a release barrier for the consumer to see the proper list links.
                match self.stack.compare_exchange_weak(
                    stack,
                    new_stack,
                    Ordering::Release,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => break,
                    Err(cur) => stack = cur,
                }
            }
        }

        pub(super) fn try_acquire_consumer(&self) -> Result<*mut Node, ConsumerError> {
            let mut stack = self.stack.load(Ordering::Relaxed);
            loop {
                if stack & Self::IS_CONSUMING != 0 {
                    return Err(ConsumerError::Contended); // The queue already has a consumer.
                }
                if stack & (Self::HAS_CACHE | Self::PTR_MASK) == 0 {
                    return Err(ConsumerError::Empty); // The queue is empty when there's nothing cached and nothing in the stack.
                }

                // When we acquire the consumer, also consume the pushed stack if the cache is empty.
                let mut new_stack = stack | Self::HAS_CACHE | Self::IS_CONSUMING;
                if stack & Self::HAS_CACHE == 0 {
                    debug_assert!(stack & Self::PTR_MASK != 0);
                    new_stack &= !Self::PTR_MASK;
                }

                // Acquire barrier on getting the consumer to see cache/Node updates done by previous consumers
                // and to ensure our cache/Node updates in pop() happen after that of previous consumers.
                match self.stack.compare_exchange_weak(
                    stack,
                    new_stack,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // SAFETY: we now hold IS_CONSUMING; cache is exclusively ours.
                        let cache = unsafe { ptr::read(&self.cache) };
                        return Ok(if !cache.is_null() {
                            cache
                        } else {
                            (stack & Self::PTR_MASK) as *mut Node
                        });
                    }
                    Err(cur) => stack = cur,
                }
            }
        }

        pub(super) fn release_consumer(&self, consumer: *mut Node) {
            // Stop consuming and remove the HAS_CACHE bit as well if the consumer's cache is empty.
            // When HAS_CACHE bit is zeroed, the next consumer will acquire the pushed stack nodes.
            let mut remove = Self::IS_CONSUMING;
            if consumer.is_null() {
                remove |= Self::HAS_CACHE;
            }

            // Release the consumer with a release barrier to ensure cache/node accesses
            // happen before the consumer was released and before the next consumer starts using the cache.
            // SAFETY: we hold IS_CONSUMING; cache is exclusively ours until fetch_sub releases it.
            unsafe { ptr::write(&self.cache as *const *mut Node as *mut *mut Node, consumer) };
            let stack = self.stack.fetch_sub(remove, Ordering::Release);
            debug_assert!(stack & remove != 0);
        }

        pub(super) fn pop(&self, consumer_ref: &mut *mut Node) -> Option<*mut Node> {
            // Check the consumer cache (fast path)
            if !consumer_ref.is_null() {
                let node = *consumer_ref;
                // SAFETY: node is a Node from the consumer chain we exclusively own.
                *consumer_ref = unsafe { (*node).next };
                return Some(node);
            }

            // Load the stack to see if there was anything pushed that we could grab.
            let mut stack = self.stack.load(Ordering::Relaxed);
            debug_assert!(stack & Self::IS_CONSUMING != 0);
            if stack & Self::PTR_MASK == 0 {
                return None;
            }

            // Nodes have been pushed to the stack, grab then with an Acquire barrier to see the Node links.
            stack = self
                .stack
                .swap(Self::HAS_CACHE | Self::IS_CONSUMING, Ordering::Acquire);
            debug_assert!(stack & Self::IS_CONSUMING != 0);
            debug_assert!(stack & Self::PTR_MASK != 0);

            let node = (stack & Self::PTR_MASK) as *mut Node;
            // SAFETY: node is the head of the pushed stack we just acquired.
            *consumer_ref = unsafe { (*node).next };
            Some(node)
        }
    }

    #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
    pub enum BufferPushError {
        #[error("Overflow")]
        Overflow,
    }

    type Index = u32;
    pub const CAPACITY: usize = 256; // Appears to be a pretty good trade-off in space vs contended throughput

    const _: () = assert!(Index::MAX as usize >= CAPACITY);
    const _: () = assert!(CAPACITY.is_power_of_two());

    /// A bounded single-producer, multi-consumer ring buffer for node pointers.
    pub struct Buffer {
        head: AtomicU32,
        tail: AtomicU32,
        array: [AtomicPtr<Node>; CAPACITY],
    }

    // SAFETY: Buffer is a lock-free SPMC ring; all cross-thread access is via atomics.
    unsafe impl core::marker::Sync for Buffer {}
    unsafe impl Send for Buffer {}

    impl Default for Buffer {
        fn default() -> Self {
            Buffer {
                head: AtomicU32::new(0),
                tail: AtomicU32::new(0),
                // PORT NOTE: Zig left this `undefined`; we zero-init.
                array: [const { AtomicPtr::new(ptr::null_mut()) }; CAPACITY],
            }
        }
    }

    pub struct Stole {
        pub node: NonNull<Node>,
        pub pushed: bool,
    }

    impl Buffer {
        // PORT NOTE: Zig's `.raw` field access (non-atomic) on Atomic(T) is mapped to
        // Relaxed loads here; Rust does not expose unsynchronized access on atomics.
        // PERF(port): was non-atomic raw read — profile in Phase B.
        #[inline]
        fn tail_raw(&self) -> Index {
            self.tail.load(Ordering::Relaxed)
        }
        #[inline]
        fn array_raw(&self, idx: usize) -> *mut Node {
            self.array[idx].load(Ordering::Relaxed)
        }

        pub(super) fn push(&self, list: &mut List) -> Result<(), BufferPushError> {
            let mut head = self.head.load(Ordering::Relaxed);
            let mut tail = self.tail_raw(); // we're the only thread that can change this

            loop {
                let mut size = tail.wrapping_sub(head);
                debug_assert!(size as usize <= CAPACITY);

                // Push nodes from the list to the buffer if it's not empty.
                if (size as usize) < CAPACITY {
                    let mut nodes: *mut Node = list.head.as_ptr();
                    while (size as usize) < CAPACITY {
                        if nodes.is_null() {
                            break;
                        }
                        let node = nodes;
                        // SAFETY: node is part of the caller-provided list.
                        nodes = unsafe { (*node).next };

                        // Array written atomically with weakest ordering since it could be getting atomically read by steal().
                        // PORT NOTE: Zig .unordered → Relaxed (Rust has no Unordered).
                        self.array[(tail as usize) % CAPACITY]
                            .store(node, Ordering::Relaxed);
                        tail = tail.wrapping_add(1);
                        size += 1;
                    }

                    // Release barrier synchronizes with Acquire loads for steal()ers to see the array writes.
                    self.tail.store(tail, Ordering::Release);

                    // Update the list with the nodes we pushed to the buffer and try again if there's more.
                    match NonNull::new(nodes) {
                        None => return Ok(()),
                        Some(h) => list.head = h,
                    }
                    core::hint::spin_loop();
                    head = self.head.load(Ordering::Relaxed);
                    continue;
                }

                // Try to steal/overflow half of the tasks in the buffer to make room for future push()es.
                // Migrating half amortizes the cost of stealing while requiring future pops to still use the buffer.
                // Acquire barrier to ensure the linked list creation after the steal only happens after we successfully steal.
                let mut migrate = size / 2;
                match self.head.compare_exchange_weak(
                    head,
                    head.wrapping_add(migrate),
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Err(cur) => head = cur,
                    Ok(_) => {
                        // Link the migrated Nodes together
                        let first = self.array_raw((head as usize) % CAPACITY);
                        while migrate > 0 {
                            let prev = self.array_raw((head as usize) % CAPACITY);
                            head = head.wrapping_add(1);
                            // SAFETY: prev/next are nodes we just claimed from our own buffer.
                            unsafe {
                                (*prev).next = self.array_raw((head as usize) % CAPACITY);
                            }
                            migrate -= 1;
                        }

                        // Append the list that was supposed to be pushed to the end of the migrated Nodes
                        let last =
                            self.array_raw((head.wrapping_sub(1) as usize) % CAPACITY);
                        // SAFETY: last is the last migrated node; list.head/tail are caller-owned.
                        unsafe {
                            (*last).next = list.head.as_ptr();
                            (*list.tail.as_ptr()).next = ptr::null_mut();
                        }

                        // Return the migrated nodes + the original list as overflowed
                        // SAFETY: first is non-null (migrate >= 1 originally).
                        list.head = unsafe { NonNull::new_unchecked(first) };
                        return Err(BufferPushError::Overflow);
                    }
                }
            }
        }

        pub(super) fn pop(&self) -> Option<NonNull<Node>> {
            let mut head = self.head.load(Ordering::Relaxed);
            let tail = self.tail_raw(); // we're the only thread that can change this

            loop {
                // Quick sanity check and return null when not empty
                let size = tail.wrapping_sub(head);
                debug_assert!(size as usize <= CAPACITY);
                if size == 0 {
                    return None;
                }

                // Dequeue with an acquire barrier to ensure any writes done to the Node
                // only happens after we successfully claim it from the array.
                match self.head.compare_exchange_weak(
                    head,
                    head.wrapping_add(1),
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Err(cur) => head = cur,
                    Ok(_) => {
                        let node = self.array_raw((head as usize) % CAPACITY);
                        // SAFETY: node was stored non-null in push().
                        return Some(unsafe { NonNull::new_unchecked(node) });
                    }
                }
            }
        }

        pub(super) fn consume(&self, queue: &Queue) -> Option<Stole> {
            let consumer = match queue.try_acquire_consumer() {
                Ok(c) => c,
                Err(_) => return None,
            };
            let mut consumer = scopeguard::guard(consumer, |c| {
                queue.release_consumer(c);
            });

            let head = self.head.load(Ordering::Relaxed);
            let tail = self.tail_raw(); // we're the only thread that can change this

            let size = tail.wrapping_sub(head);
            debug_assert!(size as usize <= CAPACITY);
            debug_assert!(size == 0); // we should only be consuming if our array is empty

            // Pop nodes from the queue and push them to our array.
            // Atomic stores to the array as steal() threads may be atomically reading from it.
            let mut pushed: Index = 0;
            while (pushed as usize) < CAPACITY {
                let Some(node) = queue.pop(&mut *consumer) else {
                    break;
                };
                // PORT NOTE: Zig .unordered → Relaxed.
                self.array[(tail.wrapping_add(pushed) as usize) % CAPACITY]
                    .store(node, Ordering::Relaxed);
                pushed += 1;
            }

            // We will be returning one node that we stole from the queue.
            // Get an extra, and if that's not possible, take one from our array.
            let node = match queue.pop(&mut *consumer) {
                Some(n) => n,
                None => 'blk: {
                    if pushed == 0 {
                        return None;
                    }
                    pushed -= 1;
                    break 'blk self
                        .array_raw((tail.wrapping_add(pushed) as usize) % CAPACITY);
                }
            };

            // Update the array tail with the nodes we pushed to it.
            // Release barrier to synchronize with Acquire barrier in steal()'s to see the written array Nodes.
            if pushed > 0 {
                self.tail.store(tail.wrapping_add(pushed), Ordering::Release);
            }
            Some(Stole {
                // SAFETY: node is non-null (from queue.pop or array slot we wrote).
                node: unsafe { NonNull::new_unchecked(node) },
                pushed: pushed > 0,
            })
        }

        pub(super) fn steal(&self, buffer: &Buffer) -> Option<Stole> {
            let head = self.head.load(Ordering::Relaxed);
            let tail = self.tail_raw(); // we're the only thread that can change this

            let size = tail.wrapping_sub(head);
            debug_assert!(size as usize <= CAPACITY);
            debug_assert!(size == 0); // we should only be stealing if our array is empty

            loop {
                let buffer_head = buffer.head.load(Ordering::Acquire);
                let buffer_tail = buffer.tail.load(Ordering::Acquire);

                // Overly large size indicates the tail was updated a lot after the head was loaded.
                // Reload both and try again.
                let buffer_size = buffer_tail.wrapping_sub(buffer_head);
                if buffer_size as usize > CAPACITY {
                    core::hint::spin_loop();
                    continue;
                }

                // Try to steal half (divCeil) to amortize the cost of stealing from other threads.
                let steal_size = buffer_size - (buffer_size / 2);
                if steal_size == 0 {
                    return None;
                }

                // Copy the nodes we will steal from the target's array to our own.
                // Atomically load from the target buffer array as it may be pushing and atomically storing to it.
                // Atomic store to our array as other steal() threads may be atomically loading from it as above.
                for i in 0..steal_size {
                    // PORT NOTE: Zig .unordered → Relaxed.
                    let node = buffer.array
                        [(buffer_head.wrapping_add(i) as usize) % CAPACITY]
                        .load(Ordering::Relaxed);
                    self.array[(tail.wrapping_add(i) as usize) % CAPACITY]
                        .store(node, Ordering::Relaxed);
                }

                // Try to commit the steal from the target buffer using:
                // - an Acquire barrier to ensure that we only interact with the stolen Nodes after the steal was committed.
                // - a Release barrier to ensure that the Nodes are copied above prior to the committing of the steal
                //   because if they're copied after the steal, the could be getting rewritten by the target's push().
                match buffer.head.compare_exchange(
                    buffer_head,
                    buffer_head.wrapping_add(steal_size),
                    Ordering::AcqRel,
                    Ordering::Relaxed,
                ) {
                    Err(_) => {
                        core::hint::spin_loop();
                    }
                    Ok(_) => {
                        // Pop one from the nodes we stole as we'll be returning it
                        let pushed = steal_size - 1;
                        let node = self
                            .array_raw((tail.wrapping_add(pushed) as usize) % CAPACITY);

                        // Update the array tail with the nodes we pushed to it.
                        // Release barrier to synchronize with Acquire barrier in steal()'s to see the written array Nodes.
                        if pushed > 0 {
                            self.tail
                                .store(tail.wrapping_add(pushed), Ordering::Release);
                        }
                        return Some(Stole {
                            // SAFETY: node was stored non-null by the target's push().
                            node: unsafe { NonNull::new_unchecked(node) },
                            pushed: pushed > 0,
                        });
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/ThreadPool.zig (1055 lines)
//   confidence: medium
//   todos:      4
//   notes:      packed Sync(u32) hand-bitpacked; each_impl comptime as_ptr → EachCall trait (ByValue/ByPtr); .raw/.unordered → Relaxed; std::thread used for spawn; Queue.cache written via raw ptr under IS_CONSUMING
// ──────────────────────────────────────────────────────────────────────────
