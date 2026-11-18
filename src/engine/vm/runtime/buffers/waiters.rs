//! The WaiterList Records of ECMA-262, which all threads share. The address of a location finds its list.

use core::ops::Range;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use core::time::Duration;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, OnceLock};
use std::task::Wake;
use std::time::Instant;

use bun_engine_text::{PropertyName, names};
use bun_threading::{Futex, Guarded};
use smallvec::SmallVec;

use super::element::Element;
use crate::{
    Cx, Gc, GcFree, JsPromise, JsResult, JsString, JsTypedArray, Timer, TypedArray, Value, Vm,
    WeakTicket, WorkKind,
};

/// The numbers are what `memory.atomic.wait` returns.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum WaitResult {
    Ok = 0,
    NotEqual = 1,
    TimedOut = 2,
}

impl WaitResult {
    fn name(self) -> PropertyName<'static> {
        match self {
            WaitResult::Ok => names::ok,
            WaitResult::NotEqual => names::notEqual,
            WaitResult::TimedOut => names::timedOut,
        }
    }

    pub fn to_value(self, vm: &Vm) -> Value {
        JsString::from_name(vm, self.name()).into()
    }
}

struct BlockedThread {
    state: AtomicU32,
}

impl BlockedThread {
    const IS_NOTIFIED: u32 = 1;
    const IS_INTERRUPTED: u32 = 2;

    fn wake_for(&self, reason: u32) {
        self.state.fetch_or(reason, Ordering::Release);
        Futex::wake(&self.state, 1);
    }
}

impl Wake for BlockedThread {
    fn wake(self: Arc<BlockedThread>) {
        self.wake_for(Self::IS_INTERRUPTED);
    }
}

struct PendingPromise {
    ticket: WeakTicket,
    timer: OnceLock<Timer>,
    is_settled: AtomicBool,
}

// SAFETY: the ticket sees to the promise.
unsafe impl GcFree for PendingPromise {}

impl PendingPromise {
    fn settle(&self, result: WaitResult) {
        if self.is_settled.swap(true, Ordering::Relaxed) {
            return;
        }
        if let Some(timer) = self.timer.get() {
            timer.cancel();
        }
        self.ticket.schedule(move |cx, ticket| {
            if let Some(promise) = ticket.target(cx) {
                promise.cast::<JsPromise>().fulfill(cx, result.to_value(cx));
            }
            Ok(())
        });
    }
}

#[derive(Clone)]
enum Kind {
    Thread(Arc<BlockedThread>),
    Promise(Arc<PendingPromise>),
}

struct Waiter {
    /// The address of the `Vm` that waits.
    agent: usize,
    kind: Kind,
}

impl Waiter {
    fn identity(&self) -> usize {
        match &self.kind {
            Kind::Thread(thread) => Arc::as_ptr(thread).addr(),
            Kind::Promise(promise) => Arc::as_ptr(promise).addr(),
        }
    }

    /// False if the realm of a promise has died.
    fn is_waiting(&self) -> bool {
        match &self.kind {
            Kind::Thread(_) => true,
            Kind::Promise(promise) => promise.ticket.is_active(),
        }
    }
}

/// No list is empty.
static LISTS: Guarded<BTreeMap<usize, VecDeque<Waiter>>> = Guarded::new(BTreeMap::new());

fn agent_of(vm: &Vm) -> usize {
    core::ptr::from_ref(vm).addr()
}

/// Whether it was there.
fn remove(address: usize, identity: usize) -> bool {
    let mut lists = LISTS.lock();
    let Some(list) = lists.get_mut(&address) else {
        return false;
    };
    let position = list.iter().position(|it| it.identity() == identity);
    let removed = position.and_then(|position| list.remove(position));
    if list.is_empty() {
        lists.remove(&address);
    }
    removed.is_some()
}

/// Blocks the thread if `has_expected_value`, which looks at the location, says so. Fails if execution is terminated.
pub fn wait_at_address(
    cx: &Cx,
    address: usize,
    has_expected_value: impl FnOnce() -> bool,
    timeout: Option<Duration>,
) -> JsResult<WaitResult> {
    /// Only the thread itself can give back what its allocator holds. A short wait is not worth it.
    const IDLE_AFTER: Duration = Duration::from_millis(100);
    let start = Instant::now();
    let thread = Arc::new(BlockedThread {
        state: AtomicU32::new(0),
    });
    {
        let mut lists = LISTS.lock();
        if !has_expected_value() {
            return Ok(WaitResult::NotEqual);
        }
        lists.entry(address).or_default().push_back(Waiter {
            agent: agent_of(cx),
            kind: Kind::Thread(Arc::clone(&thread)),
        });
    }
    let _wake = cx.wake_on_termination(Arc::clone(&thread).into());
    let mut is_idle = !bun_alloc::USE_MIMALLOC;
    loop {
        let state = thread.state.load(Ordering::Acquire);
        if state & BlockedThread::IS_NOTIFIED != 0 {
            return Ok(WaitResult::Ok);
        }
        let elapsed = start.elapsed();
        if cx.is_termination_requested() || timeout.is_some_and(|timeout| elapsed >= timeout) {
            break;
        }
        if !is_idle && elapsed >= IDLE_AFTER {
            is_idle = true;
            cx.heap.finish_collection();
            bun_alloc::mimalloc::mi_on_thread_idle();
            continue;
        }
        let until = match timeout {
            _ if is_idle => timeout,
            Some(timeout) => Some(timeout.min(IDLE_AFTER)),
            None => Some(IDLE_AFTER),
        };
        let nanoseconds =
            until.map(|it| u64::try_from((it - elapsed).as_nanos()).unwrap_or(u64::MAX));
        let _ = Futex::wait(&thread.state, state, nanoseconds);
    }
    if !remove(address, Arc::as_ptr(&thread).addr()) {
        return Ok(WaitResult::Ok);
    }
    if !cx.is_termination_requested() {
        return Ok(WaitResult::TimedOut);
    }
    Err(cx.throw_termination())
}

/// The promise that gets the result, unless that is known at once.
fn wait_asynchronously(
    cx: &Cx,
    address: usize,
    has_expected_value: impl FnOnce() -> bool,
    timeout: Option<Duration>,
) -> Result<Gc<JsPromise>, WaitResult> {
    let promise = JsPromise::new(cx);
    let mut lists = LISTS.lock();
    if !has_expected_value() {
        return Err(WaitResult::NotEqual);
    }
    if timeout == Some(Duration::ZERO) {
        return Err(WaitResult::TimedOut);
    }
    let pending = Arc::new(PendingPromise {
        ticket: cx.add_pending_work(WorkKind::AtSomePoint, promise.upcast(), &[]),
        timer: OnceLock::new(),
        is_settled: AtomicBool::new(false),
    });
    if let Some(timeout) = timeout {
        let timed_out = Arc::clone(&pending);
        let timer = cx.timer_queue().start(timeout, move |_| {
            remove(address, Arc::as_ptr(&timed_out).addr());
            timed_out.settle(WaitResult::TimedOut);
        });
        let _ = pending.timer.set(timer);
    }
    lists.entry(address).or_default().push_back(Waiter {
        agent: agent_of(cx),
        kind: Kind::Promise(pending),
    });
    Ok(promise)
}

/// Returns how many it has woken, which is at most `count`.
pub fn notify_at_address(address: usize, count: u32) -> u32 {
    let mut woken = SmallVec::<[Kind; 4]>::new();
    {
        let mut lists = LISTS.lock();
        let Some(list) = lists.get_mut(&address) else {
            return 0;
        };
        while woken.len() < count as usize
            && let Some(waiter) = list.pop_front()
        {
            if waiter.is_waiting() {
                woken.push(waiter.kind);
            }
        }
        if list.is_empty() {
            lists.remove(&address);
        }
    }
    for kind in &woken {
        match kind {
            Kind::Thread(thread) => thread.wake_for(BlockedThread::IS_NOTIFIED),
            Kind::Promise(promise) => promise.settle(WaitResult::Ok),
        }
    }
    woken.len() as u32
}

/// At that address, or at all.
pub fn waiter_count(address: Option<usize>) -> usize {
    let range = address.map_or(0..=usize::MAX, |address| address..=address);
    let lists = LISTS.lock();
    let waiters = lists.range(range).flat_map(|(_, list)| list);
    waiters.filter(|waiter| waiter.is_waiting()).count()
}

/// The memory is about to be freed, so nothing will notify them. Those with a timeout wait for that.
pub(super) fn forget_range(range: Range<usize>) {
    let lists: Vec<_> = LISTS.lock().extract_if(range, |_, _| true).collect();
    for waiter in lists.iter().flat_map(|(_, list)| list) {
        if let Kind::Promise(promise) = &waiter.kind
            && promise.timer.get().is_none()
        {
            promise.ticket.cancel();
        }
    }
}

pub(super) fn forget_agent(vm: &Vm) {
    LISTS.lock().retain(|_, list| {
        list.retain(|waiter| waiter.agent != agent_of(vm));
        !list.is_empty()
    });
}

/// All panic unless the memory is shared and the index is valid.
impl JsTypedArray {
    pub fn address_of_shared_element(&self, index: usize) -> usize {
        assert!(self.is_shared() && self.is_valid_index(index));
        self.vector().addr() + (index << self.size_shift())
    }

    pub fn notify(&self, index: usize, count: u32) -> u32 {
        notify_at_address(self.address_of_shared_element(index), count)
    }
}

/// So do these.
impl<T: Element + PartialEq> TypedArray<T> {
    fn has_at(&self, index: usize, expected: T) -> bool {
        // SAFETY: only read, at once.
        unsafe { self.elements_unchecked() }.atomic_load(index) == expected
    }

    pub fn wait(
        &self,
        cx: &Cx,
        index: usize,
        expected: T,
        timeout: Option<Duration>,
    ) -> JsResult<WaitResult> {
        let address = self.address_of_shared_element(index);
        let result = wait_at_address(cx, address, || self.has_at(index, expected), timeout);
        Gc::from(self).keep_alive();
        result
    }

    /// The promise that gets the result, unless that is known at once.
    pub fn wait_async(
        &self,
        cx: &Cx,
        index: usize,
        expected: T,
        timeout: Option<Duration>,
    ) -> Result<Gc<JsPromise>, WaitResult> {
        let address = self.address_of_shared_element(index);
        wait_asynchronously(cx, address, || self.has_at(index, expected), timeout)
    }
}
