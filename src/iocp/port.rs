use core::any::Any;
use core::cell::{Cell, RefCell};
use core::cmp::Reverse;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::collections::{BinaryHeap, VecDeque};
use std::os::windows::io::OwnedHandle;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_sys::windows::kernel32::GetCurrentThreadId;
use bun_threading::fifo_pool::{has_warming_thread, try_during_warmup};
use bun_threading::spin::{AdaptiveSpin, has_multiple_cpus};
use bun_threading::{Condition, Guarded};
use bun_windows_sys::Win32Error;

use crate::afd::{Readiness, Sockets};
use crate::request::Requests;
use crate::slab::Token;
use crate::sys::{self, Packet, Timeout};
use crate::timer::Timer;
use crate::wake_event::{WakeEvent, WakeListener};

/// Completion keys.
pub(crate) mod key {
    pub(crate) const SOCKET: usize = 1;
    pub(crate) const REQUEST: usize = 2;
    pub(crate) const TIMER: usize = 3;
    pub(crate) const WAKE: usize = 4;
    pub(crate) const COMPLETER_RESULTS: usize = 5;
    pub(crate) const POLL_RETRY: usize = 6;
    /// A request on a file that is bound to the port.
    pub(crate) const FILE: usize = 7;
    pub(crate) const WAKE_EVENT: usize = 8;
    /// A completed read whose callback is deferred.
    pub(crate) const DEFERRED_READ: usize = 9;
}

const BATCH_SIZE: usize = 128;
const IO_BUDGET_PER_ITERATION: usize = 16;
const MAX_REPLY_CREDITS: u64 = BATCH_SIZE as u64;

/// The part of a [`Port`] that other threads use.
pub(crate) struct Shared {
    pub(crate) handle: OwnedHandle,
    wake_event: WakeEvent,
    /// Only the first pending wake notifies the port.
    pending_wake_count: AtomicU64,
    /// Pending wakes that came from other loops.
    cross_loop_wake_count: AtomicU64,
    is_parked: AtomicBool,
    /// The port's thread ran only briefly between its last two parks.
    is_short_run: AtomicBool,
    completer_results: Guarded<Vec<(Token, Box<dyn Any + Send>)>>,
    pending_write_count: Guarded<usize>,
    writes_drained: Condition,
    pending_close_count: AtomicUsize,
}

impl Shared {
    pub(crate) fn push_result(&self, token: Token, result: Box<dyn Any + Send>) {
        let was_empty = {
            let mut results = self.completer_results.lock();
            results.push((token, result));
            results.len() == 1
        };
        if was_empty {
            self.notify(key::COMPLETER_RESULTS, true);
        }
    }

    /// The first tasks of a pool thread are slow on busy CPUs, and the long wait decays the port thread's boost. The wake event restores it.
    fn notify(&self, key: usize, is_reply: bool) {
        let signal = || self.wake_event.try_signal(key);
        let should_boost = is_reply && self.is_short_run.load(Ordering::SeqCst);
        if !(try_during_warmup(signal) || (should_boost && signal())) {
            sys::post_packet(&self.handle, key, 0);
        }
    }

    pub(crate) fn is_parked(&self) -> bool {
        self.is_parked.load(Ordering::SeqCst)
    }
}

thread_local! {
    /// Unanswered wakes from other loops; `None` on a thread without a loop. Only replies are boosted, so a stream of wakes stays batched.
    static REPLY_CREDITS: Cell<Option<u64>> = const { Cell::new(None) };
}

/// Makes a [`Port`] report [`Event::Wake`], from any thread.
pub struct Waker {
    shared: Arc<Shared>,
    loop_thread_id: u32,
}

impl Waker {
    pub fn wake(&self) {
        let shared = &*self.shared;
        let credits = REPLY_CREDITS.get();
        if let Some(credits) = credits
            && self.loop_thread_id != GetCurrentThreadId()
        {
            REPLY_CREDITS.set(Some(credits.saturating_sub(1)));
            shared.cross_loop_wake_count.fetch_add(1, Ordering::Relaxed);
        }
        if shared.pending_wake_count.fetch_add(1, Ordering::SeqCst) == 0 {
            shared.notify(key::WAKE, credits != Some(0));
        }
    }
}

/// Counts a write on another thread as pending until it is dropped.
pub struct PendingWrite(Arc<Shared>);

impl Drop for PendingWrite {
    fn drop(&mut self) {
        let mut count = self.0.pending_write_count.lock();
        *count -= 1;
        if *count == 0 {
            self.0.writes_drained.notify_one();
        }
    }
}

/// Counts a file that another thread closes as open until it is dropped.
pub struct PendingClose(Waker);

impl Drop for PendingClose {
    fn drop(&mut self) {
        let count = &self.0.shared.pending_close_count;
        if count.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.wake();
        }
    }
}

/// The result of [`Port::wait_for_pending_writes`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum WriteProgress {
    Drained,
    /// Some writes finished before the timeout.
    Partial,
    Stalled,
}

/// What [`Port::dispatch`] passes to its caller.
pub enum Event {
    Wake,
    /// For a [`ReadinessHandler::UserData`](crate::ReadinessHandler::UserData).
    Socket(NonNull<c_void>, Readiness),
}

/// An iteration of the loop is [`prepare`](Port::prepare), [`wait`](Port::wait) and [`dispatch`](Port::dispatch).
pub struct Port {
    pub(crate) shared: Arc<Shared>,
    pub(crate) sockets: Sockets,
    pub(crate) requests: Requests,
    timer: Timer,
    wake_listener: WakeListener,
    spin: Cell<AdaptiveSpin>,
    /// Since the last `spin.record_wait`.
    event_count: Cell<u64>,
    unparked_at_ns: Cell<u64>,
    /// Since the last `wait`. Unsolicited data arrives in larger chunks if the thread sleeps instead of spinning.
    has_received: Cell<bool>,
    has_sent: Cell<bool>,
    /// `batch[batch_pos..batch_len]` is dequeued and not dispatched yet.
    batch: [Cell<Packet>; BATCH_SIZE],
    batch_pos: Cell<usize>,
    batch_len: Cell<usize>,
    /// The last dequeue removed `BATCH_SIZE` packets, so the port may have more.
    is_batch_full: Cell<bool>,
    has_posted: Cell<bool>,
    /// Excludes sockets, which can stay ready without making progress.
    has_posted_request: Cell<bool>,
    /// Packets that are dispatched without another dequeue.
    deferred: RefCell<VecDeque<Packet>>,
    /// Appended to `deferred` at the start of `dispatch`.
    next_iteration: RefCell<VecDeque<Packet>>,
    /// `key::DEFERRED_READ` packets in both queues.
    deferred_read_count: Cell<usize>,
    /// Hangups that wait for those reads, each with the `deferred_round` in which it was queued.
    pending_hangups: RefCell<VecDeque<(Packet, u64)>>,
    deferred_round: Cell<u64>,
    /// End of the last iteration or idle wait.
    busy_since_ns: Cell<u64>,
    is_more_data_expected: Cell<bool>,
    overdue: Cell<Overdue>,
    had_overdue_timer: Cell<bool>,
    has_slow_timers: Cell<bool>,
    /// What remains for this iteration. `None` unless the loop is I/O-starved.
    io_budget: Cell<Option<usize>>,
    budget_claim_count: Cell<usize>,
    /// Of the last iteration that had any claims.
    last_budget_claim_count: Cell<usize>,
    iteration: Cell<u64>,
    /// A timer has been overdue since the last `park`.
    is_overrun: Cell<bool>,
    next_yield_ns: Cell<u64>,
    receive_streak: Cell<ReceiveStreak>,
    /// `(due_ns, key, context)` of packets to defer.
    delayed: RefCell<BinaryHeap<Reverse<(u64, usize, usize)>>>,
    loop_ref_count: Cell<usize>,
    is_shutdown: Cell<bool>,
    is_thread_exiting: Cell<bool>,
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum Overdue {
    #[default]
    None,
    Timer,
    TimerAndTasks,
}

/// Consecutive iterations that only received data and did not have to block for it.
#[derive(Copy, Clone, Default)]
struct ReceiveStreak {
    len: u32,
    last_wait_end_ns: u64,
}

pub(crate) fn now_ns() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

impl Port {
    pub fn new() -> Result<Rc<Port>, Win32Error> {
        Ok(Rc::new(Port {
            shared: Arc::new(Shared {
                handle: sys::create_port(u32::MAX)?,
                wake_event: WakeEvent::default(),
                pending_wake_count: AtomicU64::new(0),
                cross_loop_wake_count: AtomicU64::new(0),
                is_parked: AtomicBool::new(false),
                is_short_run: AtomicBool::new(false),
                completer_results: Guarded::default(),
                pending_write_count: Guarded::default(),
                pending_close_count: AtomicUsize::new(0),
                writes_drained: Condition::new(),
            }),
            sockets: Sockets::new(),
            requests: Requests::new(),
            timer: Timer::default(),
            wake_listener: WakeListener::default(),
            spin: Cell::new(AdaptiveSpin::new()),
            event_count: Cell::new(0),
            unparked_at_ns: Cell::new(now_ns()),
            has_received: Cell::new(false),
            has_sent: Cell::new(false),
            batch: [const { Cell::new(Packet::EMPTY) }; BATCH_SIZE],
            batch_pos: Cell::new(0),
            batch_len: Cell::new(0),
            is_batch_full: Cell::new(false),
            has_posted: Cell::new(false),
            has_posted_request: Cell::new(false),
            deferred: RefCell::default(),
            next_iteration: RefCell::default(),
            deferred_read_count: Cell::new(0),
            pending_hangups: RefCell::default(),
            deferred_round: Cell::new(0),
            busy_since_ns: Cell::new(now_ns()),
            is_more_data_expected: Cell::new(false),
            overdue: Cell::default(),
            had_overdue_timer: Cell::new(false),
            has_slow_timers: Cell::new(false),
            io_budget: Cell::new(None),
            budget_claim_count: Cell::new(0),
            last_budget_claim_count: Cell::new(1),
            iteration: Cell::new(0),
            is_overrun: Cell::new(false),
            next_yield_ns: Cell::new(0),
            receive_streak: Cell::default(),
            delayed: RefCell::default(),
            loop_ref_count: Cell::new(0),
            is_shutdown: Cell::new(false),
            is_thread_exiting: Cell::new(false),
        }))
    }

    pub fn waker(&self) -> Waker {
        if REPLY_CREDITS.get().is_none() {
            REPLY_CREDITS.set(Some(0));
        }
        Waker {
            shared: Arc::clone(&self.shared),
            loop_thread_id: GetCurrentThreadId(),
        }
    }

    pub fn add_pending_write(&self) -> PendingWrite {
        *self.shared.pending_write_count.lock() += 1;
        PendingWrite(Arc::clone(&self.shared))
    }

    pub fn add_pending_close(&self) -> PendingClose {
        let count = &self.shared.pending_close_count;
        count.fetch_add(1, Ordering::SeqCst);
        PendingClose(self.waker())
    }

    /// For a thread that is about to exit.
    pub fn wait_for_pending_writes(&self) -> WriteProgress {
        const TIMEOUT_NS: u64 = 500_000_000;
        let deadline_ns = now_ns() + TIMEOUT_NS;
        let initial_count =
            *self.shared.pending_write_count.lock() + self.requests.thread_bound_write_count();
        while self.requests.thread_bound_write_count() > 0 && now_ns() < deadline_ns {
            let remaining_ns = deadline_ns.saturating_sub(now_ns());
            self.prefetch_packets(Timeout::Relative(remaining_ns.div_ceil(100) as i64));
        }
        let mut count = self.shared.pending_write_count.lock();
        while *count > 0 && now_ns() < deadline_ns {
            let remaining_ns = deadline_ns.saturating_sub(now_ns());
            let _ = self
                .shared
                .writes_drained
                .timed_wait_guarded(&mut count, remaining_ns);
        }
        match *count + self.requests.thread_bound_write_count() {
            0 => WriteProgress::Drained,
            final_count if final_count < initial_count => WriteProgress::Partial,
            _ => WriteProgress::Stalled,
        }
    }

    pub fn set_thread_exiting(&self) {
        self.is_thread_exiting.set(true);
    }

    pub fn is_thread_exiting(&self) -> bool {
        self.is_thread_exiting.get()
    }

    pub fn note_receive(&self) {
        self.has_received.set(true);
    }

    /// A writer that was blocked on a full buffer is about to continue.
    pub fn expect_more_data(&self) {
        self.is_more_data_expected.set(true);
    }

    pub fn is_iteration_slow(&self) -> bool {
        const SLOW_THRESHOLD_NS: u64 = 500_000;
        now_ns().saturating_sub(self.busy_since_ns.get()) > SLOW_THRESHOLD_NS
    }

    /// Whether slow timers are due again as soon as they have run, which leaves a stream one I/O step per iteration.
    pub(crate) fn is_io_starved(&self) -> bool {
        self.io_budget.get().is_some()
    }

    /// Returns how many of `requested` extra I/O steps a stream may take. All streams share the budget of an iteration.
    pub fn take_io_budget(&self, requested: usize) -> usize {
        let Some(remaining) = self.io_budget.get() else {
            return 0;
        };
        if requested == 0 {
            return 0;
        }
        self.budget_claim_count.update(|count| count + 1);
        let share = (IO_BUDGET_PER_ITERATION / self.last_budget_claim_count.get()).max(1);
        let granted = requested.min(remaining).min(share);
        self.io_budget.set(Some(remaining - granted));
        granted
    }

    pub fn iteration(&self) -> u64 {
        self.iteration.get()
    }

    pub fn note_send(&self) {
        self.has_sent.set(true);
    }

    pub fn note_timers_drained(&self) {
        self.has_slow_timers.set(self.is_iteration_slow());
    }

    /// The timer is the reason for the zero timeout of the next `wait`.
    pub fn note_overdue_timer(&self) {
        self.overdue.set(Overdue::Timer);
    }

    /// The next `wait` has a zero timeout even without the timer.
    pub fn note_overdue_timer_and_tasks(&self) {
        self.overdue.set(Overdue::TimerAndTasks);
    }

    /// Whether any [`LoopRef`] is set.
    pub fn has_loop_refs(&self) -> bool {
        self.loop_ref_count.get() > 0
    }

    /// Whether a dropped request is still in flight. The kernel keeps its file open until the packet is dequeued.
    pub(crate) fn has_abandoned_requests(&self) -> bool {
        self.requests.has_abandoned()
    }

    /// Whether a file that was dropped is still open.
    pub fn has_closing_files(&self) -> bool {
        self.has_abandoned_requests() || self.shared.pending_close_count.load(Ordering::SeqCst) > 0
    }

    /// Does not count [`ReadinessHandler::UserData`](crate::ReadinessHandler::UserData).
    pub fn callback_count(&self) -> usize {
        self.requests.callback_count() + self.sockets.callback_count()
    }

    pub(crate) fn is_shutdown(&self) -> bool {
        self.is_shutdown.get()
    }

    pub(crate) fn defer(&self, packet: Packet) {
        self.enqueue(&self.deferred, packet);
    }

    pub(crate) fn defer_to_next_iteration(&self, packet: Packet) {
        if packet.key == key::DEFERRED_READ && !self.pending_hangups.borrow().is_empty() {
            self.defer(packet);
        } else {
            self.enqueue(&self.next_iteration, packet);
        }
    }

    pub(crate) fn has_deferred_batch(&self) -> bool {
        self.deferred.borrow().len() >= BATCH_SIZE
    }

    /// Whether a socket event can be dispatched ahead of the packets on the port.
    pub(crate) fn can_skip_queue(&self) -> bool {
        !self.is_batch_full.get() && self.next_iteration.borrow().len() < BATCH_SIZE
    }

    fn enqueue(&self, queue: &RefCell<VecDeque<Packet>>, packet: Packet) {
        self.deferred_read_count
            .update(|count| count + usize::from(packet.key == key::DEFERRED_READ));
        queue.borrow_mut().push_back(packet);
    }

    /// Orders `packet` after those that are already queued on the port.
    pub(crate) fn post(&self, packet: Packet) {
        sys::post_packet(&self.shared.handle, packet.key, packet.context);
        self.has_posted.set(true);
        if packet.key != key::SOCKET {
            self.has_posted_request.set(true);
        }
    }

    /// Only finds the packet that was deferred last. Removing it saves the loop an iteration.
    pub(crate) fn pop_deferred_read(&self, token: Token) -> Option<Packet> {
        let packet = self.deferred.borrow_mut().pop_back_if(|packet| {
            packet.key == key::DEFERRED_READ && packet.context == token.to_raw()
        });
        self.deferred_read_count
            .update(|count| count - usize::from(packet.is_some()));
        packet
    }

    pub(crate) fn delay(&self, key: usize, token: Token, delay_ns: u64) {
        let entry = (now_ns() + delay_ns, key, token.to_raw());
        self.delayed.borrow_mut().push(Reverse(entry));
    }

    fn defer_due_packets(&self) {
        let mut delayed = self.delayed.borrow_mut();
        if delayed.is_empty() {
            return;
        }
        let now = now_ns();
        while let Some(&Reverse((due_ns, key, context))) = delayed.peek()
            && due_ns <= now
        {
            delayed.pop();
            self.defer(Packet::new(key, context));
        }
    }

    fn undispatched_count(&self) -> usize {
        let deferred_count = self.deferred.borrow().len() + self.next_iteration.borrow().len();
        self.batch_len.get() - self.batch_pos.get()
            + deferred_count
            + self.pending_hangups.borrow().len()
    }

    fn has_work(&self) -> bool {
        self.undispatched_count() > 0 || self.has_posted.get() || self.sockets.has_queued_updates()
    }

    /// Returns `true` if `wait` is known not to block.
    pub fn prepare(&self) -> bool {
        self.sockets.submit_updates(self);
        self.has_work()
    }

    /// Returns an upper bound on the number of events. Neither allocates nor frees.
    pub fn wait(&self, timeout_ns: Option<u64>) -> usize {
        const COALESCE_INTERVAL_NS: u64 = 20_000;
        const COALESCE_THRESHOLD: u32 = 4;
        const STREAK_RESET_INTERVAL: u32 = 64;

        let overdue = self.overdue.take();
        let has_overdue_timer = overdue != Overdue::None;
        let had_overdue_timer = self.had_overdue_timer.replace(has_overdue_timer);
        let is_io_starved = self.has_slow_timers.take() && had_overdue_timer && has_overdue_timer;
        self.io_budget
            .set(is_io_starved.then_some(IO_BUDGET_PER_ITERATION));
        let claim_count = self.budget_claim_count.take();
        if claim_count > 0 {
            self.last_budget_claim_count.set(claim_count);
        }
        self.iteration.update(|iteration| iteration + 1);
        // A callback is running the loop. The kernel does not deliver these packets again.
        if self.batch_pos.get() < self.batch_len.get() {
            return self.undispatched_count();
        }
        let has_received = self.has_received.take();
        let has_sent = self.has_sent.take();
        let is_receive_only = has_received && !has_sent;
        let streak = self.receive_streak.take();
        let can_coalesce = is_receive_only && timeout_ns != Some(0);
        if can_coalesce && streak.len >= COALESCE_THRESHOLD && has_multiple_cpus() {
            // Every notification costs the sender, so let data accumulate.
            while now_ns() < streak.last_wait_end_ns + COALESCE_INTERVAL_NS {
                core::hint::spin_loop();
            }
        }
        let mut is_immediate = true;
        if timeout_ns == Some(0) || self.has_work() {
            self.fill_batch(Timeout::Zero);
            if overdue == Overdue::Timer {
                self.maybe_yield();
            }
        } else {
            self.is_overrun.set(false);
            self.shared.is_parked.store(true, Ordering::SeqCst);
            is_immediate = self.park(timeout_ns, is_receive_only);
            self.shared.is_parked.store(false, Ordering::SeqCst);
        }
        if can_coalesce && is_immediate {
            // Data is always ready after a coalescing delay, so the streak has to be detected again periodically.
            self.receive_streak.set(ReceiveStreak {
                len: (streak.len + 1) % STREAK_RESET_INTERVAL,
                last_wait_end_ns: now_ns(),
            });
        }
        self.undispatched_count()
    }

    /// A thread that never waits keeps its CPU for a whole quantum, up to 12 clock ticks.
    fn maybe_yield(&self) {
        const CLOCK_TICK_NS: u64 = 15_625_000;
        const MAX_QUANTUM_NS: u64 = 12 * CLOCK_TICK_NS;
        const MIN_YIELD_INTERVAL_NS: u64 = 2_000_000;
        let now = now_ns();
        if !self.is_overrun.replace(true) {
            self.next_yield_ns
                .update(|next_ns| next_ns.max(now + CLOCK_TICK_NS));
        }
        if now < self.next_yield_ns.get() || self.has_work() || self.is_batch_full.get() {
            return;
        }
        std::thread::yield_now();
        let yielded_ns = now_ns().saturating_sub(now);
        self.busy_since_ns.update(|since_ns| since_ns + yielded_ns);
        // A thread that kept the CPU for long is CPU-bound too, so back off quadratically.
        let backoff_ns = yielded_ns.min(MAX_QUANTUM_NS).pow(2) / CLOCK_TICK_NS;
        self.next_yield_ns
            .set(now + yielded_ns + backoff_ns + MIN_YIELD_INTERVAL_NS);
        self.fill_batch(Timeout::Zero);
    }

    /// Returns `true` if the first dequeue found packets. With `is_receive_only`, that dequeue does not block.
    fn park(&self, timeout_ns: Option<u64>, is_receive_only: bool) -> bool {
        const IDLE_THRESHOLD_NS: u64 = 100_000;
        const SHORT_RUN_THRESHOLD_NS: u64 = 1_000_000;
        let start_ns = now_ns();
        let mut spin = self.spin.get();
        let next_due_ns = self
            .delayed
            .borrow()
            .peek()
            .map(|&Reverse((due_ns, ..))| due_ns);
        let deadline_ns = timeout_ns
            .map_or(u64::MAX, |timeout_ns| start_ns.saturating_add(timeout_ns))
            .min(next_due_ns.unwrap_or(u64::MAX));
        let spin_limit_ns = if is_receive_only { 0 } else { spin.limit_ns() };
        let mut now = start_ns;
        let spin_deadline_ns = start_ns + spin_limit_ns;
        let mut is_first_dequeue = true;
        let run_ns = start_ns.saturating_sub(self.unparked_at_ns.get());
        let is_short_run = run_ns < SHORT_RUN_THRESHOLD_NS;
        self.shared
            .is_short_run
            .store(is_short_run, Ordering::SeqCst);
        let mut has_slept = false;
        loop {
            let timeout = if now < spin_deadline_ns || (is_first_dequeue && is_receive_only) {
                Timeout::Zero
            } else if deadline_ns == u64::MAX {
                Timeout::Infinite
            } else {
                let remaining_ns = deadline_ns.saturating_sub(now);
                self.timer
                    .prepare_timeout(&self.shared.handle, now, remaining_ns)
            };
            let has_packets = if matches!(timeout, Timeout::Zero) {
                self.fill_batch(timeout)
            } else {
                // Only once: a timer that was set for an earlier deadline makes this loop sleep again.
                if !core::mem::replace(&mut has_slept, true) {
                    self.timer
                        .update_boost(now, run_ns, is_short_run, deadline_ns - now);
                }
                self.sleep(timeout, is_short_run)
            };
            now = now_ns();
            is_first_dequeue &= has_packets;
            if has_packets || now >= deadline_ns {
                break;
            }
        }
        if now.saturating_sub(start_ns) > IDLE_THRESHOLD_NS {
            self.busy_since_ns.set(now);
        }
        self.unparked_at_ns.set(now);
        let sleep_ns = now.saturating_sub(spin_deadline_ns);
        self.timer
            .record_wait(run_ns + (now - start_ns) - sleep_ns, sleep_ns);
        if now >= deadline_ns {
            self.timer.note_deadline(self.undispatched_count() > 0);
        }
        spin.record_wait(start_ns, now, spin_limit_ns, self.event_count.take());
        self.spin.set(spin);
        is_first_dequeue
    }

    fn sleep(&self, timeout: Timeout, is_short_run: bool) -> bool {
        if !is_short_run && !has_warming_thread() {
            return self.fill_batch(timeout);
        }
        let shared = &*self.shared;
        let dequeue = || self.fill_batch(timeout);
        self.wake_listener
            .with_armed(&shared.wake_event, &shared.handle, dequeue)
    }

    /// Returns `false` if there is nothing to dispatch.
    fn fill_batch(&self, timeout: Timeout) -> bool {
        let removed_count = sys::dequeue_packets(&self.shared.handle, &self.batch, timeout);
        self.is_batch_full.set(removed_count == BATCH_SIZE);
        self.has_posted.set(false);
        self.has_posted_request.set(false);
        let mut len = 0;
        for cell in &self.batch[..removed_count] {
            if let Some(packet) = self.preprocess_packet(cell.get()) {
                self.batch[len].set(packet);
                len += 1;
            }
        }
        self.batch_pos.set(0);
        self.batch_len.set(len);
        len > 0
    }

    /// Returns `None` if the dequeued packet needs no dispatch.
    fn preprocess_packet(&self, packet: Packet) -> Option<Packet> {
        match packet.key {
            key::TIMER => {
                self.timer.on_expire();
                None
            }
            key::SOCKET => self.sockets.accept_packet(packet.context).then_some(packet),
            key::WAKE_EVENT => {
                let key = self
                    .wake_listener
                    .take_signaled_key(&self.shared.wake_event);
                Some(Packet::new(key, 0))
            }
            _ => Some(packet),
        }
    }

    /// Dequeues packets, which makes the kernel write the results of their requests, and defers the dispatch. Returns `false` on timeout.
    pub(crate) fn prefetch_packets(&self, timeout: Timeout) -> bool {
        let packets = [const { Cell::new(Packet::EMPTY) }; BATCH_SIZE];
        let removed_count = sys::dequeue_packets(&self.shared.handle, &packets, timeout);
        for packet in packets[..removed_count].iter().map(Cell::get) {
            if let Some(packet) = self.preprocess_packet(packet) {
                self.defer(packet);
            }
        }
        removed_count > 0
    }

    pub fn dispatch(&self, on_event: impl Fn(Event)) {
        /// Bounds the time until timers run again.
        const MAX_BATCHES: usize = 48;
        const MAX_DURATION_NS: u64 = 2_000_000;

        let deadline_ns = self.is_batch_full.get().then(|| now_ns() + MAX_DURATION_NS);
        self.deferred
            .borrow_mut()
            .append(&mut self.next_iteration.borrow_mut());
        self.defer_due_packets();
        self.dispatch_deferred(&on_event);
        self.dispatch_batch(&on_event);
        for _ in 1..MAX_BATCHES {
            if !self.is_batch_full.get() || deadline_ns.is_none_or(|ns| now_ns() > ns) {
                break;
            }
            self.prepare();
            self.fill_batch(Timeout::Zero);
            self.dispatch_batch(&on_event);
        }
        self.prepare();
        self.drain_deferred(&on_event);
    }

    /// Runs for as long as the rest of the iteration took, so that a slow iteration does not throttle streams.
    fn drain_deferred(&self, on_event: &impl Fn(Event)) {
        const MIN_ROUNDS: usize = 8;
        const MIN_DURATION_NS: u64 = 2_000_000;
        const MAX_DURATION_NS: u64 = 100_000_000;

        let mut now = now_ns();
        let busy_ns = now.saturating_sub(self.busy_since_ns.get());
        let deadline_ns = now + busy_ns.clamp(MIN_DURATION_NS, MAX_DURATION_NS);
        for round in 0.. {
            let has_time = round < MIN_ROUNDS || now <= deadline_ns;
            let has_dispatched = has_time
                && (self.dispatch_deferred(on_event)
                    || self.dispatch_posted(on_event)
                    || (self.is_more_data_expected.take()
                        && busy_ns > MIN_DURATION_NS
                        && self.spin_and_dispatch(on_event)));
            if !has_dispatched {
                break;
            }
            now = now_ns();
        }
        self.busy_since_ns.set(now);
    }

    /// Returns `false` if the loop is not I/O-starved, nothing was posted, or other work comes first.
    fn dispatch_posted(&self, on_event: &impl Fn(Event)) -> bool {
        if !(self.has_posted_request.get() && self.is_io_starved())
            || self.undispatched_count() > 0
            || self.sockets.has_queued_updates()
        {
            return false;
        }
        self.fill_batch(Timeout::Zero);
        self.dispatch_batch(on_event);
        true
    }

    /// Returns `false` if nothing arrived in time or other work comes first.
    fn spin_and_dispatch(&self, on_event: &impl Fn(Event)) -> bool {
        const SPIN_TIMEOUT_NS: u64 = 50_000;
        if self.has_work() || !has_multiple_cpus() {
            return false;
        }
        let deadline_ns = now_ns() + SPIN_TIMEOUT_NS;
        while !self.fill_batch(Timeout::Zero) {
            if now_ns() > deadline_ns {
                return false;
            }
        }
        self.dispatch_batch(on_event);
        self.prepare();
        true
    }

    fn dispatch_batch(&self, on_event: &impl Fn(Event)) {
        while self.batch_pos.get() < self.batch_len.get() {
            let packet = self.batch[self.batch_pos.get()].get();
            self.batch_pos.update(|pos| pos + 1);
            self.dispatch_packet(packet, on_event);
        }
    }

    /// Covers only packets that were deferred before the call. Returns `false` if there were none.
    fn dispatch_deferred(&self, on_event: &impl Fn(Event)) -> bool {
        let count = self.deferred.borrow().len();
        for _ in 0..count {
            let Some(packet) = self.deferred.borrow_mut().pop_front() else {
                break;
            };
            self.dispatch_packet(packet, on_event);
        }
        self.deferred_round
            .update(|round| round + u64::from(count > 0));
        while let Some(packet) = self.take_due_hangup() {
            self.requests.complete(self, packet);
        }
        count > 0
    }

    fn should_queue_hangup(&self, packet: Packet) -> bool {
        (self.deferred_read_count.get() > 0 || !self.pending_hangups.borrow().is_empty())
            && self.requests.is_hangup(packet)
    }

    fn queue_hangup(&self, packet: Packet) {
        if self.pending_hangups.borrow().is_empty() {
            let mut deferred = self.deferred.borrow_mut();
            self.next_iteration.borrow_mut().retain(|&queued| {
                let is_read = queued.key == key::DEFERRED_READ;
                if is_read {
                    deferred.push_back(queued);
                }
                !is_read
            });
        }
        self.pending_hangups
            .borrow_mut()
            .push_back((packet, self.deferred_round.get()));
    }

    fn take_due_hangup(&self) -> Option<Packet> {
        /// Enough to drain what a pipe holds. An unrelated pipe may never run out of data.
        const MAX_WAIT_ROUNDS: u64 = 4;
        let is_due = |queued_round| {
            self.deferred_read_count.get() == 0
                || self.deferred_round.get() > queued_round + MAX_WAIT_ROUNDS
        };
        let hangup = self
            .pending_hangups
            .borrow_mut()
            .pop_front_if(|&mut (_, queued_round)| is_due(queued_round));
        hangup.map(|(packet, _)| packet)
    }

    fn dispatch_packet(&self, packet: Packet, on_event: &impl Fn(Event)) {
        match packet.key {
            key::SOCKET => {
                self.record_events(1);
                self.sockets.complete(self, packet.context, on_event);
            }
            key::POLL_RETRY => self.sockets.retry_poll(packet.context),
            key::REQUEST | key::FILE if self.should_queue_hangup(packet) => {
                self.queue_hangup(packet);
            }
            key::REQUEST | key::FILE => {
                self.record_events(1);
                self.requests.complete(self, packet);
            }
            key::DEFERRED_READ => {
                self.deferred_read_count.update(|count| count - 1);
                self.record_events(1);
                self.requests.complete(self, packet);
            }
            key::WAKE => {
                self.record_events(self.shared.pending_wake_count.swap(0, Ordering::SeqCst));
                let new_credits = self.shared.cross_loop_wake_count.swap(0, Ordering::Relaxed);
                if let Some(credits) = REPLY_CREDITS.get() {
                    REPLY_CREDITS.set(Some((credits + new_credits).min(MAX_REPLY_CREDITS)));
                }
                on_event(Event::Wake);
            }
            key::COMPLETER_RESULTS => {
                let results = core::mem::take(&mut *self.shared.completer_results.lock());
                for (token, result) in results {
                    self.record_events(1);
                    self.requests.complete_with_result(self, token, result);
                }
            }
            _ => {}
        }
    }

    fn record_events(&self, count: u64) {
        self.event_count.update(|total| total + count);
    }

    /// Cancels every request that is not detached. No callback runs from now on.
    pub fn shutdown(&self) {
        const TIMEOUT_NS: u64 = 10_000_000_000;

        self.is_shutdown.set(true);
        self.sockets.deregister_all();
        self.requests.abandon_all();
        let deadline_ns = now_ns() + TIMEOUT_NS;
        loop {
            self.dispatch(|_| {});
            let remaining_ns = deadline_ns.saturating_sub(now_ns());
            if self.requests.has_detached() {
                self.fill_batch(Timeout::Infinite);
            } else if remaining_ns > 0 && self.has_io_in_flight() {
                self.fill_batch(Timeout::Relative(remaining_ns.div_ceil(100) as i64));
            } else {
                break;
            }
        }
    }

    /// Valid only during `shutdown`.
    fn has_io_in_flight(&self) -> bool {
        self.sockets.has_polls_in_flight() || self.has_closing_files()
    }
}

impl Drop for Port {
    fn drop(&mut self) {
        if !self.is_shutdown() {
            self.shutdown();
        }
        self.sockets.leak_in_flight();
        self.requests.leak_in_flight();
    }
}

/// Keeps the loop of a port alive while it is set.
pub struct LoopRef {
    port: Rc<Port>,
    is_set: Cell<bool>,
}

impl LoopRef {
    pub fn new(port: &Rc<Port>) -> LoopRef {
        LoopRef {
            port: Rc::clone(port),
            is_set: Cell::new(false),
        }
    }

    pub fn set(&self, value: bool) {
        if self.is_set.replace(value) != value {
            self.port
                .loop_ref_count
                .update(|count| if value { count + 1 } else { count - 1 });
        }
    }
}

impl Drop for LoopRef {
    fn drop(&mut self) {
        self.set(false);
    }
}
