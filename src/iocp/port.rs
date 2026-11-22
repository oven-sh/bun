use core::cell::{Cell, RefCell};
use core::cmp::Reverse;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::collections::{BinaryHeap, VecDeque};
use std::os::windows::io::OwnedHandle;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_sys::windows::kernel32::GetCurrentThreadId;
use bun_threading::fifo_pool::{has_new_thread, on_new_thread};
use bun_threading::spin::{Spin, has_other_cpu};
use bun_threading::{Condition, Guarded};
use bun_windows_sys::Win32Error;

use crate::afd::{Readiness, Sockets};
use crate::bell::{Bell, Listener};
use crate::request::{Outcome, Requests};
use crate::slab::Token;
use crate::sys::{self, Packet, Timeout};
use crate::timer::Timer;

/// What a packet is about.
pub(crate) mod key {
    pub(crate) const SOCKET: usize = 1;
    pub(crate) const REQUEST: usize = 2;
    pub(crate) const TIMER: usize = 3;
    pub(crate) const WAKE: usize = 4;
    pub(crate) const OUTCOMES: usize = 5;
    pub(crate) const POLL_AGAIN: usize = 6;
    /// A request on a file that is bound to the port.
    pub(crate) const FILE: usize = 7;
    pub(crate) const BELL: usize = 8;
    /// A deferred request that has read something.
    pub(crate) const INPUT: usize = 9;
}

const BATCH: usize = 128;

/// The part of a [`Port`] that other threads use.
pub(crate) struct Shared {
    pub(crate) handle: OwnedHandle,
    bell: Bell,
    /// The first is posted.
    wakes: AtomicU64,
    /// How many of them are from other loops.
    questions: AtomicU64,
    is_parked: AtomicBool,
    /// The thread was done soon with what came last.
    is_brief: AtomicBool,
    outcomes: Guarded<Vec<(Token, Outcome)>>,
    pending_writes: Guarded<usize>,
    all_written: Condition,
}

impl Shared {
    pub(crate) fn send(&self, request: Token, outcome: Outcome) {
        let was_empty = {
            let mut outcomes = self.outcomes.lock();
            outcomes.push((request, outcome));
            outcomes.len() == 1
        };
        if was_empty {
            self.notify(key::OUTCOMES, true);
        }
    }

    /// On busy CPUs the first tasks of a thread take long, and whoever waits for long loses a raised priority.
    fn notify(&self, key: usize, is_answer: bool) {
        let ring = || self.bell.ring(key);
        let is_urgent = is_answer && self.is_brief.load(Ordering::SeqCst);
        if !(on_new_thread(ring) || (is_urgent && ring())) {
            sys::post(&self.handle, key, 0);
        }
    }

    pub(crate) fn is_parked(&self) -> bool {
        self.is_parked.load(Ordering::SeqCst)
    }
}

thread_local! {
    /// A thread of a pool does nothing unasked. One with a loop may send a flood, which a raised receiver would cut into pieces.
    static ANSWERS_DUE: Cell<Option<u64>> = const { Cell::new(None) };
}

/// Makes a [`Port`] report [`Event::Wake`], from any thread.
pub struct Waker(Arc<Shared>, u32);

impl Waker {
    pub fn wake(&self) {
        let due = ANSWERS_DUE.get();
        if let Some(due) = due
            && self.1 != GetCurrentThreadId()
        {
            ANSWERS_DUE.set(Some(due.saturating_sub(1)));
            self.0.questions.fetch_add(1, Ordering::Relaxed);
        }
        if self.0.wakes.fetch_add(1, Ordering::SeqCst) == 0 {
            self.0.notify(key::WAKE, due != Some(0));
        }
    }
}

/// A write that another thread makes, until it is dropped.
pub struct PendingWrite(Arc<Shared>);

impl Drop for PendingWrite {
    fn drop(&mut self) {
        let mut count = self.0.pending_writes.lock();
        *count -= 1;
        if *count == 0 {
            self.0.all_written.notify_one();
        }
    }
}

/// What [`Port::dispatch`] leaves to its caller.
pub enum Event {
    Wake,
    /// For a [`Watcher::Foreign`](crate::Watcher::Foreign).
    Socket(NonNull<c_void>, Readiness),
}

/// A turn of the loop is [`prepare`](Port::prepare), [`wait`](Port::wait) and [`dispatch`](Port::dispatch). A callback may run turns of its own.
pub struct Port {
    pub(crate) shared: Arc<Shared>,
    pub(crate) sockets: Sockets,
    pub(crate) requests: Requests,
    timer: Timer,
    listener: Listener,
    spin: Cell<Spin>,
    /// Events, since `spin` was last told.
    work: Cell<u64>,
    /// The end of the last `park`.
    woke_ns: Cell<u64>,
    /// Since the last wait. What is sent unasked comes in larger pieces to a thread that sleeps.
    has_received: Cell<bool>,
    has_sent: Cell<bool>,
    /// `batch[next..end]` came from the system and is yet to be dispatched.
    batch: [Cell<Packet>; BATCH],
    next: Cell<usize>,
    end: Cell<usize>,
    /// The system may have had more than `batch` has room for.
    was_full: Cell<bool>,
    has_posted: Cell<bool>,
    /// What ended without a packet from the system.
    deferred: RefCell<VecDeque<Packet>>,
    /// The same, for a turn that has not begun.
    next_turn: RefCell<VecDeque<Packet>>,
    /// How many of both are `key::INPUT`.
    inputs: Cell<usize>,
    /// What waits for them, and since which of the `rounds`.
    ends: RefCell<VecDeque<(Packet, u64)>>,
    rounds: Cell<u64>,
    /// When the last turn ended, or a wait for which nothing was ready.
    busy_since_ns: Cell<u64>,
    expects_more: Cell<bool>,
    has_overdue_timer: Cell<bool>,
    /// A timer has been overdue since the last `park`.
    is_overrun: Cell<bool>,
    next_yield_ns: Cell<u64>,
    /// How many turns in a row have only received what was there at once, and when the last one began.
    flood: Cell<(u32, u64)>,
    /// The time when it is deferred, and the key and context of the packet.
    delayed: RefCell<BinaryHeap<Reverse<(u64, usize, usize)>>>,
    holds: Cell<usize>,
    is_shut_down: Cell<bool>,
}

pub(crate) fn now_ns() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

impl Port {
    pub fn new() -> Result<Rc<Port>, Win32Error> {
        Ok(Rc::new(Port {
            shared: Arc::new(Shared {
                handle: sys::create_port(u32::MAX)?,
                bell: Bell::default(),
                wakes: AtomicU64::new(0),
                questions: AtomicU64::new(0),
                is_parked: AtomicBool::new(false),
                is_brief: AtomicBool::new(false),
                outcomes: Guarded::default(),
                pending_writes: Guarded::default(),
                all_written: Condition::new(),
            }),
            sockets: Sockets::new(),
            requests: Requests::new(),
            timer: Timer::default(),
            listener: Listener::default(),
            spin: Cell::new(Spin::new()),
            work: Cell::new(0),
            woke_ns: Cell::new(now_ns()),
            has_received: Cell::new(false),
            has_sent: Cell::new(false),
            batch: [const { Cell::new(Packet::EMPTY) }; BATCH],
            next: Cell::new(0),
            end: Cell::new(0),
            was_full: Cell::new(false),
            has_posted: Cell::new(false),
            deferred: RefCell::default(),
            next_turn: RefCell::default(),
            inputs: Cell::new(0),
            ends: RefCell::default(),
            rounds: Cell::new(0),
            busy_since_ns: Cell::new(now_ns()),
            expects_more: Cell::new(false),
            has_overdue_timer: Cell::new(false),
            is_overrun: Cell::new(false),
            next_yield_ns: Cell::new(0),
            flood: Cell::new((0, 0)),
            delayed: RefCell::default(),
            holds: Cell::new(0),
            is_shut_down: Cell::new(false),
        }))
    }

    pub fn waker(&self) -> Waker {
        ANSWERS_DUE.set(ANSWERS_DUE.get().or(Some(0)));
        Waker(Arc::clone(&self.shared), GetCurrentThreadId())
    }

    pub fn pending_write(&self) -> PendingWrite {
        *self.shared.pending_writes.lock() += 1;
        PendingWrite(Arc::clone(&self.shared))
    }

    /// For a thread that is about to end. Not for long: `true` if some have ended and others have not.
    pub fn wait_for_pending_writes(&self) -> bool {
        const PATIENCE_NS: u64 = 500_000_000;
        let deadline = now_ns() + PATIENCE_NS;
        let before = *self.shared.pending_writes.lock() + self.requests.writes_of_thread();
        while self.requests.writes_of_thread() > 0 && now_ns() < deadline {
            let left = deadline.saturating_sub(now_ns());
            self.fetch(Timeout::After(left.div_ceil(100) as i64));
        }
        let mut count = self.shared.pending_writes.lock();
        while *count > 0 && now_ns() < deadline {
            let left = deadline.saturating_sub(now_ns());
            let _ = (self.shared.all_written).timed_wait_guarded(&mut count, left);
        }
        (1..before).contains(&(*count + self.requests.writes_of_thread()))
    }

    pub fn did_receive(&self) {
        self.has_received.set(true);
    }

    /// A writer has been waiting for room, and is about to go on.
    pub fn expect_more(&self) {
        self.expects_more.set(true);
    }

    /// Whether it is long from one turn to the next.
    pub fn is_slow(&self) -> bool {
        const SLOW_NS: u64 = 500_000;
        now_ns().saturating_sub(self.busy_since_ns.get()) > SLOW_NS
    }

    pub fn did_send(&self) {
        self.has_sent.set(true);
    }

    /// That is why the next `wait` has no time.
    pub fn note_overdue_timer(&self) {
        self.has_overdue_timer.set(true);
    }

    /// Whether a [`Hold`] is set.
    pub fn is_held(&self) -> bool {
        self.holds.get() > 0
    }

    /// Whether a request that was dropped is still under way. The system keeps its file open until the packet is taken.
    pub fn is_closing(&self) -> bool {
        self.requests.has_abandoned()
    }

    /// How many expect to be called, apart from each [`Watcher::Foreign`](crate::Watcher::Foreign).
    pub fn callback_count(&self) -> usize {
        self.requests.callback_count() + self.sockets.callback_count()
    }

    pub(crate) fn is_shut_down(&self) -> bool {
        self.is_shut_down.get()
    }

    pub(crate) fn defer(&self, packet: Packet) {
        self.defer_to(&self.deferred, packet);
    }

    pub(crate) fn defer_to_next_turn(&self, packet: Packet) {
        match packet.key == key::INPUT && !self.ends.borrow().is_empty() {
            true => self.defer(packet),
            false => self.defer_to(&self.next_turn, packet),
        }
    }

    fn defer_to(&self, queue: &RefCell<VecDeque<Packet>>, packet: Packet) {
        (self.inputs).update(|count| count + usize::from(packet.key == key::INPUT));
        queue.borrow_mut().push_back(packet);
    }

    /// It comes after the packets that the system has by now.
    pub(crate) fn post(&self, packet: Packet) {
        sys::post(&self.shared.handle, packet.key, packet.context);
        self.has_posted.set(true);
    }

    /// Spares the loop a turn for what was deferred a moment ago.
    pub(crate) fn take_back(&self, read: Token) -> Option<Packet> {
        let address = (key::INPUT, read.to_raw());
        let taken = (self.deferred.borrow_mut())
            .pop_back_if(|packet| (packet.key, packet.context) == address);
        (self.inputs).update(|count| count - usize::from(taken.is_some()));
        taken
    }

    pub(crate) fn delay(&self, key: usize, token: Token, delay_ns: u64) {
        let entry = (now_ns() + delay_ns, key, token.to_raw());
        self.delayed.borrow_mut().push(Reverse(entry));
    }

    fn defer_delayed(&self) {
        let mut delayed = self.delayed.borrow_mut();
        if delayed.is_empty() {
            return;
        }
        let now = now_ns();
        while let Some(&Reverse((due, key, context))) = delayed.peek()
            && due <= now
        {
            delayed.pop();
            self.defer(Packet::new(key, context));
        }
    }

    fn undispatched(&self) -> usize {
        let deferred = self.deferred.borrow().len() + self.next_turn.borrow().len();
        self.end.get() - self.next.get() + deferred + self.ends.borrow().len()
    }

    fn has_work(&self) -> bool {
        self.undispatched() > 0 || self.has_posted.get() || self.sockets.has_changed()
    }

    /// `true` if `wait` is known to return at once.
    pub fn prepare(&self) -> bool {
        self.sockets.submit_changed(self);
        self.has_work()
    }

    /// Returns how many events there are at most. It neither allocates nor frees.
    pub fn wait(&self, timeout_ns: Option<u64>) -> usize {
        const FLOOD_TURN_NS: u64 = 20_000;
        const TURNS_TO_FLOOD: u32 = 4;
        const TURNS_TO_DOUBT: u32 = 64;

        let has_overdue_timer = self.has_overdue_timer.take();
        if self.next.get() < self.end.get() {
            return self.undispatched();
        }
        let only_receives = self.has_received.take() & !self.has_sent.take();
        let (turns, began_at) = self.flood.take();
        let may_be_flood = only_receives && timeout_ns != Some(0);
        if may_be_flood && turns >= TURNS_TO_FLOOD && has_other_cpu() {
            // A sender pays for every time that it has to tell us.
            while now_ns() < began_at + FLOOD_TURN_NS {
                core::hint::spin_loop();
            }
        }
        let mut is_at_once = true;
        if timeout_ns == Some(0) || self.has_work() {
            self.fill_batch(Timeout::Now);
            if has_overdue_timer {
                self.yield_now_and_then();
            }
        } else {
            self.is_overrun.set(false);
            self.shared.is_parked.store(true, Ordering::SeqCst);
            is_at_once = self.park(timeout_ns, only_receives);
            self.shared.is_parked.store(false, Ordering::SeqCst);
        }
        if may_be_flood && is_at_once {
            // After a pause there is always something, so it has to show itself again.
            self.flood.set(((turns + 1) % TURNS_TO_DOUBT, now_ns()));
        }
        self.undispatched()
    }

    /// The system leaves the CPU to a thread that never waits for up to 190 ms at a time.
    fn yield_now_and_then(&self) {
        const CLOCK_TICK_NS: u64 = 15_625_000;
        const MAX_QUANTUM_NS: u64 = 12 * CLOCK_TICK_NS;
        const MIN_PAUSE_NS: u64 = 2_000_000;
        let now = now_ns();
        if !self.is_overrun.replace(true) {
            (self.next_yield_ns).update(|next| next.max(now + CLOCK_TICK_NS));
        }
        if now < self.next_yield_ns.get() || self.has_work() || self.was_full.get() {
            return;
        }
        std::thread::yield_now();
        let lost = now_ns().saturating_sub(now);
        self.busy_since_ns.update(|since| since + lost);
        // Whoever keeps the CPU for long does not wait either.
        let pause = lost.min(MAX_QUANTUM_NS).pow(2) / CLOCK_TICK_NS;
        (self.next_yield_ns).set(now + lost + pause + MIN_PAUSE_NS);
        self.fill_batch(Timeout::Now);
    }

    /// `true` if the first look was enough. With `only_receives`, that look does not wait.
    fn park(&self, timeout_ns: Option<u64>, only_receives: bool) -> bool {
        const IDLE_NS: u64 = 100_000;
        const BRIEF_NS: u64 = 1_000_000;
        let (start, mut spin) = (now_ns(), self.spin.get());
        let next_due = self.delayed.borrow().peek().map(|entry| entry.0.0);
        let deadline = (timeout_ns.map_or(u64::MAX, |timeout| start.saturating_add(timeout)))
            .min(next_due.unwrap_or(u64::MAX));
        let awake_ns = if only_receives { 0 } else { spin.limit_ns() };
        let (mut now, awake_until, mut is_first) = (start, start + awake_ns, true);
        let ran_ns = start.saturating_sub(self.woke_ns.get());
        let is_brief = ran_ns < BRIEF_NS;
        self.shared.is_brief.store(is_brief, Ordering::SeqCst);
        let mut has_slept = false;
        loop {
            let timeout = match deadline {
                _ if now < awake_until || (is_first && only_receives) => Timeout::Now,
                u64::MAX => Timeout::Never,
                _ => (self.timer).timeout(&self.shared.handle, now, deadline.saturating_sub(now)),
            };
            let has_packets = if matches!(timeout, Timeout::Now) {
                self.fill_batch(timeout)
            } else {
                // The timer can be set for an earlier time.
                if !core::mem::replace(&mut has_slept, true) {
                    self.timer.before_sleep(ran_ns, is_brief, deadline - now);
                }
                self.sleep(timeout, is_brief)
            };
            now = now_ns();
            is_first &= has_packets;
            if has_packets || now >= deadline {
                break;
            }
        }
        if now.saturating_sub(start) > IDLE_NS {
            self.busy_since_ns.set(now);
        }
        self.woke_ns.set(now);
        let slept_ns = now.saturating_sub(awake_until);
        (self.timer).waited(ran_ns + (now - start) - slept_ns, slept_ns);
        if now >= deadline {
            self.timer.note_deadline(self.undispatched() > 0);
        }
        spin.waited(start, now, awake_ns, self.work.take());
        self.spin.set(spin);
        is_first
    }

    fn sleep(&self, timeout: Timeout, is_brief: bool) -> bool {
        if !is_brief && !has_new_thread() {
            return self.fill_batch(timeout);
        }
        let Shared { handle, bell, .. } = &*self.shared;
        (self.listener).listen(bell, handle, || self.fill_batch(timeout))
    }

    /// `false` if there is nothing to dispatch.
    fn fill_batch(&self, timeout: Timeout) -> bool {
        let removed = sys::remove_packets(&self.shared.handle, &self.batch, timeout);
        self.was_full.set(removed == BATCH);
        self.has_posted.set(false);
        let mut end = 0;
        for cell in &self.batch[..removed] {
            if let Some(packet) = self.receive(cell.get()) {
                self.batch[end].set(packet);
                end += 1;
            }
        }
        self.next.set(0);
        self.end.set(end);
        end > 0
    }

    /// `None` if that is all there is to do for the packet.
    fn receive(&self, packet: Packet) -> Option<Packet> {
        match packet.key {
            key::TIMER => {
                self.timer.fired();
                None
            }
            key::SOCKET => self.sockets.receive(packet.context).then_some(packet),
            key::BELL => Some(Packet::new(self.listener.rang(&self.shared.bell), 0)),
            _ => Some(packet),
        }
    }

    /// Takes packets from the system, which writes the results of requests then, and dispatches them later.
    pub(crate) fn fetch(&self, timeout: Timeout) {
        let packets = [const { Cell::new(Packet::EMPTY) }; BATCH];
        let removed = sys::remove_packets(&self.shared.handle, &packets, timeout);
        for packet in packets[..removed].iter().map(Cell::get) {
            if let Some(packet) = self.receive(packet) {
                self.defer(packet);
            }
        }
    }

    pub fn dispatch(&self, on_event: impl Fn(Event)) {
        /// Bounds the time until timers run again.
        const MAX_BATCHES: usize = 48;

        self.deferred
            .borrow_mut()
            .append(&mut self.next_turn.borrow_mut());
        self.defer_delayed();
        self.dispatch_deferred(&on_event);
        self.dispatch_batch(&on_event);
        for _ in 1..MAX_BATCHES {
            if !self.was_full.get() {
                break;
            }
            self.prepare();
            self.fill_batch(Timeout::Now);
            self.dispatch_batch(&on_event);
        }
        self.prepare();
        self.dispatch_deferred_for_a_while(&on_event);
    }

    /// For as long as everything else has taken, so that a slow turn does not hold up a stream.
    fn dispatch_deferred_for_a_while(&self, on_event: &impl Fn(Event)) {
        const MIN_ROUNDS: usize = 8;
        const MIN_NS: u64 = 2_000_000;
        const MAX_NS: u64 = 100_000_000;

        let mut now = now_ns();
        let busy_ns = now.saturating_sub(self.busy_since_ns.get());
        let deadline = now + busy_ns.clamp(MIN_NS, MAX_NS);
        for round in 0.. {
            let goes_on = (round < MIN_ROUNDS || now <= deadline)
                && (self.dispatch_deferred(on_event)
                    || (self.expects_more.take()
                        && busy_ns > MIN_NS
                        && self.dispatch_soon(on_event)));
            if !goes_on {
                break;
            }
            now = now_ns();
        }
        self.busy_since_ns.set(now);
    }

    /// `false` if nothing has come, or something else is first.
    fn dispatch_soon(&self, on_event: &impl Fn(Event)) -> bool {
        const SOON_NS: u64 = 50_000;
        if self.has_work() || !has_other_cpu() {
            return false;
        }
        let deadline = now_ns() + SOON_NS;
        while !self.fill_batch(Timeout::Now) {
            if now_ns() > deadline {
                return false;
            }
        }
        self.dispatch_batch(on_event);
        self.prepare();
        true
    }

    fn dispatch_batch(&self, on_event: &impl Fn(Event)) {
        while self.next.get() < self.end.get() {
            let packet = self.batch[self.next.get()].get();
            self.next.update(|next| next + 1);
            self.deliver(packet, on_event);
        }
    }

    /// Only what was deferred before the call. `false` if that is nothing.
    fn dispatch_deferred(&self, on_event: &impl Fn(Event)) -> bool {
        let count = self.deferred.borrow().len();
        for _ in 0..count {
            let Some(packet) = self.deferred.borrow_mut().pop_front() else {
                break;
            };
            self.deliver(packet, on_event);
        }
        self.rounds.update(|rounds| rounds + u64::from(count > 0));
        while let Some(packet) = self.take_end() {
            self.requests.complete(self, packet);
        }
        count > 0
    }

    fn must_wait(&self, packet: Packet) -> bool {
        (self.inputs.get() > 0 || !self.ends.borrow().is_empty()) && self.requests.is_end(packet)
    }

    fn hold_end(&self, packet: Packet) {
        if self.ends.borrow().is_empty() {
            let mut deferred = self.deferred.borrow_mut();
            (self.next_turn.borrow_mut()).retain(|&packet| {
                packet.key != key::INPUT || {
                    deferred.push_back(packet);
                    false
                }
            });
        }
        (self.ends.borrow_mut()).push_back((packet, self.rounds.get()));
    }

    fn take_end(&self) -> Option<Packet> {
        /// Enough for what a pipe holds. Another may never run dry.
        const MAX_ROUNDS: u64 = 4;
        let is_due = |since| self.inputs.get() == 0 || self.rounds.get() > since + MAX_ROUNDS;
        let end = self.ends.borrow_mut().pop_front_if(|end| is_due(end.1));
        end.map(|end| end.0)
    }

    fn deliver(&self, packet: Packet, on_event: &impl Fn(Event)) {
        match packet.key {
            key::SOCKET => {
                self.add_work(1);
                self.sockets.complete(self, packet.context, on_event);
            }
            key::POLL_AGAIN => self.sockets.poll_again(packet.context),
            key::REQUEST | key::FILE if self.must_wait(packet) => self.hold_end(packet),
            key::REQUEST | key::FILE => {
                self.add_work(1);
                self.requests.complete(self, packet);
            }
            key::INPUT => {
                self.inputs.update(|count| count - 1);
                self.add_work(1);
                self.requests.complete(self, packet);
            }
            key::WAKE => {
                self.add_work(self.shared.wakes.swap(0, Ordering::SeqCst));
                let asked = self.shared.questions.swap(0, Ordering::Relaxed);
                ANSWERS_DUE.set(ANSWERS_DUE.get().map(|due| (due + asked).min(BATCH as u64)));
                on_event(Event::Wake);
            }
            key::OUTCOMES => {
                let outcomes = core::mem::take(&mut *self.shared.outcomes.lock());
                for (token, outcome) in outcomes {
                    if self.requests.store(token, outcome) {
                        self.defer(Packet::new(key::REQUEST, token.to_raw()));
                    }
                }
            }
            _ => {}
        }
    }

    fn add_work(&self, count: u64) {
        self.work.update(|work| work + count);
    }

    /// Cancels everything, and nothing is called back from now on.
    pub fn shut_down(&self) {
        const PATIENCE_NS: u64 = 10_000_000_000;

        self.is_shut_down.set(true);
        self.sockets.abandon_all();
        self.requests.abandon_all();
        let deadline = now_ns() + PATIENCE_NS;
        loop {
            self.dispatch(|_| {});
            let remaining = deadline.saturating_sub(now_ns());
            if remaining == 0 || !self.is_system_writing() {
                break;
            }
            self.fill_batch(Timeout::After(remaining.div_ceil(100) as i64));
        }
    }

    /// After `abandon_all`.
    fn is_system_writing(&self) -> bool {
        self.sockets.is_system_writing() || self.is_closing()
    }
}

impl Drop for Port {
    fn drop(&mut self) {
        if !self.is_shut_down() {
            self.shut_down();
        }
        self.sockets.leak_in_flight();
        self.requests.leak_in_flight();
    }
}

/// Keeps the loop of a port running while it is set.
pub struct Hold {
    port: Rc<Port>,
    is_set: Cell<bool>,
}

impl Hold {
    pub fn new(port: &Rc<Port>) -> Hold {
        Hold {
            port: Rc::clone(port),
            is_set: Cell::new(false),
        }
    }

    pub fn set(&self, value: bool) {
        if self.is_set.replace(value) != value {
            let holds = &self.port.holds;
            holds.update(|holds| if value { holds + 1 } else { holds - 1 });
        }
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        self.set(false);
    }
}
