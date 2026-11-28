//! The threads that run the `Bun.build()`s of the process, one after the other.
//!
//! The plugins of a build may wait for a build in the queue. Once `watch` finds that likely, that
//! one starts on another thread. Even then only the build that has the turn works.

use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use bun_bundler::bundle_v2::dispatch::Turn;
use bun_core::{Generation, Output, zstr};
use bun_event_loop::BoxedTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JsPtr, LoopKind, Ticket, VmHandle};
use bun_threading::guarded::GuardedLock;
use bun_threading::{Condition, Guarded, Mutex};

use super::{BundleJs, JSBundleCompletionTask};
use crate::api::js_bundler::js_bundler::ParkedBuild;

/// How long the plugins may be silent if a build is likely to be ahead of one that it needs. Per started build.
const SHORT_PATIENCE: Duration = Duration::from_millis(100);
/// The same if that is less likely, the first time.
const LONG_PATIENCE: Duration = Duration::from_secs(1);

/// A `Bun.build()` call that waits for `setup()`.
struct Parked {
    call: u64,
    vm: VmHandle,
    build: JsPtr<ParkedBuild>,
}

#[derive(Clone, Copy)]
struct Order {
    /// When it was first parked, or else queued.
    call: u64,
    queued: u64,
    /// `None` if all that it can have waited for is ahead of it.
    patience: Option<Duration>,
}

pub(super) struct QueuedBuild {
    pub(super) task: Box<JSBundleCompletionTask>,
    ticket: Ticket,
    vm: VmHandle,
    order: Order,
}

/// What a build can't share with another one that has started.
#[derive(Clone, Copy)]
struct Claims {
    /// `.defer()` waits for the only build of its plugins.
    plugins_addr: Option<usize>,
    uses_checker: bool,
    /// The checker has state of the process, and `compile.aot` asks its plugins from inside it.
    waits_in_checker: bool,
}

impl Claims {
    fn of(task: &JSBundleCompletionTask) -> Self {
        let config = &task.config;
        let is_aot = (config.compile.as_ref()).is_some_and(|compile| compile.aot.is_some());
        Self {
            plugins_addr: (task.plugins).map(|plugins| plugins.as_non_null().addr().get()),
            uses_checker: is_aot || config.check || config.dts,
            waits_in_checker: is_aot && task.plugins.is_some(),
        }
    }

    fn can_overlap(self, other: Self) -> bool {
        (self.plugins_addr.is_none() || self.plugins_addr != other.plugins_addr)
            && !(self.waits_in_checker && other.uses_checker)
            && !(other.waits_in_checker && self.uses_checker)
    }
}

/// A thread's, for the build it runs.
pub(super) struct Seat {
    /// Written under `STATE`'s lock.
    pub(super) cancelled: AtomicBool,
    /// The thread's `Loop::get()`, in which the `MiniEventLoop` of a build waits. `AtomicPtr` only to be `Sync`.
    uws_loop: AtomicPtr<bun_uws::Loop>,
    /// How many threads of the build wait for its plugins. Locked before `STATE`.
    /// `compile.aot` has several, and has no turn while one of them waits.
    waits: Guarded<u32>,
    answers_on_the_way: AtomicU32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Probe {
    NotSent,
    Sent,
    FoundBusy,
    /// The VM has only builds left, so nothing but their end can settle a promise.
    FoundIdle,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stuck {
    No,
    Maybe,
    Yes,
}

struct Started {
    /// The address of its `BundleJs`.
    js_addr: usize,
    seat: &'static Seat,
    claims: Claims,
    vm: VmHandle,
    order: Order,
    probe: Probe,
}

struct State {
    parked: Vec<Parked>,
    /// For `Order`.
    clock: u64,
    queue: VecDeque<QueuedBuild>,
    started: Vec<Started>,
    /// Addresses of `Seat`s. The first has the turn, the others wait for it.
    turn: VecDeque<usize>,
    idle_threads: u32,
    has_watcher: bool,
    are_started_stuck: Stuck,
    /// The resolver rereads a directory whose listing has a lower generation. The runtime's have 0.
    generation: Generation,
}

type Locked = GuardedLock<'static, State, Mutex>;

static STATE: Guarded<State> = Guarded::new(State {
    parked: Vec::new(),
    clock: 0,
    queue: VecDeque::new(),
    started: Vec::new(),
    turn: VecDeque::new(),
    idle_threads: 0,
    has_watcher: false,
    are_started_stuck: Stuck::No,
    generation: 0,
});
static IDLE: Condition = Condition::new();
static WATCH: Condition = Condition::new();
static TURN: Condition = Condition::new();

/// Counts the answers of plugins, and how often the turn was given up.
static PROGRESS: AtomicU64 = AtomicU64::new(0);

impl State {
    fn next_index(&self) -> Option<usize> {
        if self.started.is_empty() {
            return (!self.queue.is_empty()).then_some(0);
        }
        (self.are_started_stuck != Stuck::No).then(|| self.likeliest_waited_for())?
    }

    fn likeliest_waited_for(&self) -> Option<usize> {
        let can_start = |queued: &QueuedBuild| {
            let claims = Claims::of(&queued.task);
            (self.started.iter()).all(|it| it.claims.can_overlap(claims))
        };
        let was_overtaken = |queued: &QueuedBuild| {
            let order = queued.order;
            (self.started.iter()).any(|it| {
                order.call < it.order.call
                    // In a deadlock, a nested build is rightly ahead of those that were queued before.
                    && (order.queued > it.order.queued || self.are_started_stuck == Stuck::Maybe)
            })
        };
        (self.queue.iter())
            .position(|queued| was_overtaken(queued) && can_start(queued))
            .or_else(|| self.queue.iter().rposition(can_start))
    }

    fn take_next(&mut self) -> Option<QueuedBuild> {
        let index = self.next_index();
        self.are_started_stuck = Stuck::No;
        let mut next = self.queue.remove(index?)?;
        if index != Some(0) {
            next.order.patience.get_or_insert(LONG_PATIENCE);
        }
        Some(next)
    }

    fn tick_clock(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn find_thread_for_next(&mut self) -> std::io::Result<()> {
        if self.next_index().is_none() {
            return Ok(());
        }
        if self.idle_threads == 0 {
            spawn("Bundler", thread_main)?;
            self.idle_threads = 1;
        }
        IDLE.signal();
        Ok(())
    }

    fn do_started_wait(&self) -> bool {
        self.turn.is_empty()
            && (self.started.iter())
                .all(|it| it.seat.answers_on_the_way.load(Ordering::SeqCst) == 0)
    }

    fn forget_findings(&mut self) {
        for started in (self.started.iter_mut()).filter(|it| it.probe != Probe::Sent) {
            started.probe = Probe::NotSent;
        }
    }

    fn ensure_watcher(&mut self) {
        if !self.has_watcher
            && self.turn.is_empty()
            && !self.started.is_empty()
            && !self.queue.is_empty()
        {
            self.has_watcher = spawn("Bundler Watcher", || watch()).is_ok();
        }
    }
}

fn fail_next(mut state: Locked, err: &dyn core::fmt::Display) {
    if state.are_started_stuck == Stuck::Maybe {
        state.are_started_stuck = Stuck::No;
    }
    let mut failed = Vec::new();
    while state.idle_threads == 0
        && let Some(next) = state.take_next()
    {
        failed.push(next);
    }
    PROGRESS.fetch_add(1, Ordering::SeqCst);
    drop(state);
    for QueuedBuild { task, ticket, .. } in failed {
        task.fail_to_start(err, &ticket);
    }
}

impl Seat {
    fn addr(&self) -> usize {
        core::ptr::from_ref(self).addr()
    }

    pub(super) fn has_turn(&self) -> bool {
        STATE.lock().turn.front() == Some(&self.addr())
    }

    /// A cancelled build goes without: its VM does not wait behind other VMs' builds.
    fn take_turn(&self, mut state: Locked) {
        state.turn.push_back(self.addr());
        while state.turn.front() != Some(&self.addr()) {
            if self.cancelled.load(Ordering::SeqCst) {
                return state.turn.retain(|&seat| seat != self.addr());
            }
            TURN.wait_guarded(&mut state);
        }
    }

    fn give_up_turn(&self, state: &mut State) {
        state.turn.retain(|&seat| seat != self.addr());
        PROGRESS.fetch_add(1, Ordering::SeqCst);
        if !state.turn.is_empty() {
            TURN.broadcast();
        }
    }
}

impl Turn for Seat {
    fn wait_begins(&self) {
        let mut waits = self.waits.lock();
        *waits += 1;
        if *waits == 1 {
            let mut state = STATE.lock();
            self.give_up_turn(&mut state);
            state.ensure_watcher();
        }
    }

    fn wait_ends(&self) {
        let mut waits = self.waits.lock();
        *waits -= 1;
        if *waits == 0 {
            self.take_turn(STATE.lock());
        }
    }

    fn answer_sent(&self) {
        self.answers_on_the_way.fetch_add(1, Ordering::SeqCst);
        PROGRESS.fetch_add(1, Ordering::SeqCst);
    }

    fn answer_taken(&self) {
        self.answers_on_the_way.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Returns the number of the call, which it keeps if it has one.
pub(crate) fn park(call: Option<u64>, vm: &VirtualMachine, build: JsPtr<ParkedBuild>) -> u64 {
    let vm = vm.handle();
    let mut state = STATE.lock();
    let call = call.unwrap_or_else(|| state.tick_clock());
    state.parked.push(Parked { call, vm, build });
    call
}

pub(crate) fn unpark(call: u64) -> Option<JsPtr<ParkedBuild>> {
    let mut state = STATE.lock();
    let index = state.parked.iter().position(|it| it.call == call)?;
    Some(state.parked.swap_remove(index).build)
}

pub(super) fn enqueue(task: Box<JSBundleCompletionTask>, vm: &VirtualMachine, call: Option<u64>) {
    // A `setup()` can settle while a macro runs.
    let (ticket, vm) = (vm.ticket_of(LoopKind::Regular), vm.handle());
    let mut state = STATE.lock();
    let queued = state.tick_clock();
    let call = call.unwrap_or(queued);
    let patience = (state.parked.iter())
        .map(|it| match it.call < call {
            true => SHORT_PATIENCE,
            false => LONG_PATIENCE,
        })
        .min();
    state.queue.push_back(QueuedBuild {
        task,
        ticket,
        vm,
        order: Order {
            call,
            queued,
            patience,
        },
    });
    state.ensure_watcher();
    WATCH.signal();
    if let Err(err) = state.find_thread_for_next() {
        fail_next(state, &err);
    }
}

pub(super) fn take_unstarted(js: *mut BundleJs) -> Option<QueuedBuild> {
    let mut state = STATE.lock();
    let index = (state.queue.iter()).rposition(|queued| queued.task.js.as_ptr() == js)?;
    state.queue.remove(index)
}

pub(super) fn cancel_if_started(js: &BundleJs) {
    let state = STATE.lock();
    let js_addr = core::ptr::from_ref(js).addr();
    for Started { seat, .. } in state.started.iter().filter(|it| it.js_addr == js_addr) {
        seat.cancelled.store(true, Ordering::SeqCst);
        // SAFETY: a thread that has a loop never exits or frees it, and wakeup is thread-safe.
        unsafe { bun_uws::us_wakeup_loop(seat.uws_loop.load(Ordering::Relaxed)) };
    }
    TURN.broadcast();
}

pub(crate) struct StuckBuildsProbe {
    progress: u64,
}

impl BoxedTask for StuckBuildsProbe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StuckBuildsProbe;
    // The VM stops, and cancels its builds.
    fn release_unrun(self: Box<Self>) {}
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl StuckBuildsProbe {
    pub(crate) fn run(&self, vm: &VirtualMachine) {
        let handle = vm.handle();
        let mut state = STATE.lock();
        let builds = (state.parked.iter().filter(|it| it.vm == handle)).count()
            + (state.queue.iter().filter(|it| it.vm == handle)).count()
            + (state.started.iter().filter(|it| it.vm == handle)).count();
        let found = if PROGRESS.load(Ordering::SeqCst) != self.progress {
            Probe::NotSent
        } else if vm.has_work_left_besides(builds as u32) {
            Probe::FoundBusy
        } else {
            WATCH.signal();
            Probe::FoundIdle
        };
        for started in state.started.iter_mut().filter(|it| it.vm == handle) {
            started.probe = found;
        }
    }
}

fn watch() -> ! {
    Output::Source::configure_named_thread(zstr!("Bundler Watcher"));
    let (mut progress, mut quiet_since) = (PROGRESS.load(Ordering::SeqCst), Instant::now());
    let mut state = STATE.lock();
    loop {
        while state.queue.is_empty() {
            WATCH.wait_guarded(&mut state);
        }
        let pause =
            (quiet_since.elapsed() / 4).clamp(Duration::from_millis(2), Duration::from_millis(50));
        let _ = WATCH.timed_wait_guarded(&mut state, pause.as_nanos() as u64);

        let progress_now = PROGRESS.load(Ordering::SeqCst);
        if progress_now != progress
            || !state.do_started_wait()
            || state.are_started_stuck != Stuck::No
        {
            (progress, quiet_since) = (progress_now, Instant::now());
            state.forget_findings();
            continue;
        }
        if state.likeliest_waited_for().is_none() {
            continue;
        }

        let quiet_for = quiet_since.elapsed();
        if (state.started.iter()).all(|it| it.probe == Probe::FoundIdle) {
            state.are_started_stuck = Stuck::Yes;
        } else if quiet_for >= SHORT_PATIENCE * state.started.len() as u32
            && let Some(impatient) = state.started.iter_mut().find(|it| {
                (it.order.patience).is_some_and(|patience| quiet_for >= patience)
                    // Not while its plugins keep the VM from running the probe.
                    && matches!(it.probe, Probe::FoundBusy | Probe::FoundIdle)
            })
        {
            impatient.order.patience = Some(SHORT_PATIENCE);
            state.are_started_stuck = Stuck::Maybe;
        }
        if state.are_started_stuck != Stuck::No {
            if let Err(err) = state.find_thread_for_next() {
                fail_next(state, &err);
                state = STATE.lock();
            }
            continue;
        }

        if (state.started.iter()).all(|it| it.probe != Probe::Sent) {
            state.forget_findings();
        }
        let mut to_probe: Vec<VmHandle> = Vec::new();
        for started in (state.started.iter_mut()).filter(|it| it.probe == Probe::NotSent) {
            started.probe = Probe::Sent;
            if !to_probe.contains(&started.vm) {
                to_probe.push(started.vm.clone());
            }
        }
        drop(state);
        for vm in to_probe {
            let probe = Box::new(StuckBuildsProbe { progress });
            let _ = vm.post::<StuckBuildsProbe>(LoopKind::Regular, probe);
        }
        state = STATE.lock();
    }
}

/// Blocks until this idle thread has a build, and the build has the turn or is cancelled.
fn start_next(seat: &'static Seat, mut state: Locked) -> (QueuedBuild, Generation) {
    let next = loop {
        match state.take_next() {
            Some(next) => break next,
            None => IDLE.wait_guarded(&mut state),
        }
    };
    state.idle_threads -= 1;
    state.started.push(Started {
        js_addr: next.task.js.as_ptr().addr(),
        seat,
        claims: Claims::of(&next.task),
        vm: next.vm.clone(),
        order: next.order,
        probe: Probe::NotSent,
    });
    seat.cancelled.store(false, Ordering::SeqCst);
    state.generation = state.generation.saturating_add(1);
    let generation = state.generation;
    seat.take_turn(state);
    (next, generation)
}

fn finish(seat: &Seat) -> Locked {
    let mut state = STATE.lock();
    debug_assert_eq!(seat.answers_on_the_way.load(Ordering::SeqCst), 0);
    state.started.retain(|it| !core::ptr::eq(it.seat, seat));
    seat.give_up_turn(&mut state);
    state.idle_threads += 1;
    state.ensure_watcher();
    state
}

fn spawn(name: &str, main: fn()) -> std::io::Result<()> {
    let thread = std::thread::Builder::new().name(name.into());
    thread.spawn(main).map(drop)
}

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

fn thread_main() {
    Output::Source::configure_named_thread(zstr!("Bundler"));
    let uws_loop: &bun_uws::Loop = match bun_uws::Loop::try_get() {
        Ok(uws_loop) => uws_loop,
        Err(err) => {
            let mut state = STATE.lock();
            state.idle_threads -= 1;
            return fail_next(state, &<&str>::from(err));
        }
    };

    // At function scope: the loop holds its address.
    #[cfg(windows)]
    let mut timer: bun_sys::windows::libuv::Timer = bun_core::ffi::zeroed();
    #[cfg(windows)]
    {
        timer.init(uws_loop.uv_loop());
        timer.start(u64::MAX, u64::MAX, Some(timer_callback));
    }

    let seat: &'static Seat = Box::leak(Box::new(Seat {
        cancelled: AtomicBool::new(false),
        uws_loop: AtomicPtr::new(core::ptr::from_ref(uws_loop).cast_mut()),
        waits: Guarded::new(0),
        answers_on_the_way: AtomicU32::new(0),
    }));
    let mut state = STATE.lock();
    loop {
        let (QueuedBuild { task, ticket, .. }, generation) = start_next(seat, state);
        task.run(ticket, seat, generation);

        state = finish(seat);
        if state.next_index().is_none() {
            drop(state);
            bun_jsc::cached_bytecode::destroy_bytecode_cache_vm();
            bun_alloc::mimalloc::mi_collect(false);
            state = STATE.lock();
        }
    }
}
