//! Scoped event-loop runs — the run driver.
//!
//! A scoped run turns Bun's one event loop from inside a synchronous frame
//! while admitting only the work attributed to the run's *domain* (see
//! `src/jsc/bindings/EventLoopDomain.h` for how work is attributed). Anything
//! else that surfaces while the run is active — due timers, immediates,
//! event-loop tasks of another run — is parked here and handed back, in its
//! original order and with unchanged deadlines, when the run exits. Microtasks
//! and `process.nextTick` are gated on the C++/JS side off the same "active
//! run domain"; the run stack below mirrors the C++ one and is what the Rust
//! gates consult.
//!
//! With no run entered every gate is one branch on [`active_run`]` == 0`.

use core::cell::{Cell, RefCell};

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, InHeap, Tag as TimerTag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, PromiseStatus, Task};

use crate::jsc::generated::{JSImmediate, JSTimeout};
use crate::timer::{ImmediateObject, TimeoutObject};

bun_core::declare_scope!(DomainRun, hidden);

struct RunState {
    domain: u32,
    /// The enclosing run's start epoch (0 if none), restored on exit. This run's
    /// own start epoch lives where the gates read it (`bun_io::run_epoch` and the
    /// uws loop data): I/O created before it is foreign to the run.
    outer_start_epoch: u32,
    /// Foreign JS timers that became due during the run. Kept out of the timer
    /// heap for the run's duration (so the poll timeout ignores them) and
    /// reinserted with their original deadline on exit.
    deferred_timers: Vec<*mut EventLoopTimer>,
    /// Foreign `setImmediate`s that reached the front (erased `*mut ImmediateObject`).
    parked_immediates: Vec<*mut ()>,
    /// Foreign event-loop tasks, in dequeue order.
    parked_tasks: Vec<Task>,
}

thread_local! {
    static RUNS: RefCell<Vec<RunState>> = const { RefCell::new(Vec::new()) };
    /// The innermost run's wall-clock deadline for the poll `auto_tick` is about to make.
    static POLL_DEADLINE: Cell<Option<Timespec>> = const { Cell::new(None) };
}

unsafe extern "C" {
    fn Bun__Domain__enterRun(global: *mut JSGlobalObject, domain: u32);
    fn Bun__Domain__exitRun(global: *mut JSGlobalObject);
    fn Bun__Domain__allocate(global: *mut JSGlobalObject) -> u32;
    fn Bun__Domain__ofCallback(global: *mut JSGlobalObject, callback: JSValue) -> u32;
}

/// The innermost scoped run's domain; 0 when no run is active. (`RUNS.last()`,
/// mirrored in the lowest tier so `Task` stamping can read it too.)
#[inline]
pub fn active_run() -> u32 {
    bun_event_loop::active_run_domain()
}

#[inline]
pub fn is_in_run() -> bool {
    active_run() != 0
}

/// While a run is turning the loop, `auto_tick` must not sleep past this.
#[inline]
pub fn poll_deadline() -> Option<Timespec> {
    POLL_DEADLINE.get()
}

fn with_current<R>(f: impl FnOnce(&mut RunState) -> R) -> R {
    RUNS.with_borrow_mut(|runs| f(runs.last_mut().expect("scoped run active")))
}

// ─── gates ───────────────────────────────────────────────────────────────────

/// Domain of a stored native callback (an `AsyncContextFrame` → its captured
/// context's domain; a bare function → 0).
///
/// # Safety
/// `vm` is the live per-thread VM.
#[inline]
unsafe fn domain_of_callback(vm: *mut VirtualMachine, callback: JSValue) -> u32 {
    // SAFETY: per fn contract; `global` is set at VM init.
    unsafe { Bun__Domain__ofCallback((*vm).global, callback) }
}

/// `timer::All::next` popped a due `TimeoutObject` timer while a run is active.
/// If its callback belongs to another domain, take custody of it (out of the
/// heap, state left `ACTIVE`) until the run exits and report `true`.
///
/// # Safety
/// `timer` is a live heap node just removed by `delete_min`; `vm` is the live
/// per-thread VM.
pub(crate) unsafe fn defer_timer_if_foreign(
    timer: *mut EventLoopTimer,
    vm: *mut VirtualMachine,
) -> bool {
    debug_assert!(is_in_run());
    // SAFETY: per fn contract.
    let callback = unsafe {
        match (*timer).tag {
            TimerTag::TimeoutObject => {
                let parent = TimeoutObject::from_timer_ptr(timer);
                let Some(this_value) = (*parent).internals.this_value.get().try_get() else {
                    return false;
                };
                JSTimeout::callback_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
            }
            _ => return false,
        }
    };
    // SAFETY: per fn contract.
    if unsafe { domain_of_callback(vm, callback) } == active_run() {
        return false;
    }
    // SAFETY: per fn contract — the node is out of the heap; record that so a
    // `clearTimeout` during the run knows to look for it here.
    unsafe { (*timer).in_heap = InHeap::DeferredByRun };
    with_current(|run| run.deferred_timers.push(timer));
    bun_core::scoped_log!(DomainRun, "deferred foreign timer {:p}", timer);
    true
}

/// `timer::All::remove` on a timer this module has custody of (a `clearTimeout`
/// during the run): drop it from whichever run holds it.
pub(crate) fn forget_deferred_timer(timer: *mut EventLoopTimer) {
    RUNS.with_borrow_mut(|runs| {
        for run in runs.iter_mut().rev() {
            if let Some(i) = run
                .deferred_timers
                .iter()
                .position(|t| core::ptr::eq(*t, timer))
            {
                run.deferred_timers.remove(i);
                return;
            }
        }
        debug_assert!(false, "DeferredByRun timer not held by any run");
    });
}

/// `run_immediate_task` is about to run `immediate` while a run is active. If
/// its callback belongs to another domain, park it (refs and keep-alive left as
/// they are: it is still logically queued) and report `true`.
///
/// # Safety
/// `immediate` is a live queued `ImmediateObject`; `vm` is the live per-thread VM.
pub(crate) unsafe fn park_immediate_if_foreign(
    immediate: *mut ImmediateObject,
    vm: *mut VirtualMachine,
) -> bool {
    debug_assert!(is_in_run());
    // SAFETY: per fn contract.
    let callback = unsafe {
        let Some(this_value) = (*immediate).internals.this_value.get().try_get() else {
            return false;
        };
        JSImmediate::callback_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    };
    // SAFETY: per fn contract.
    if unsafe { domain_of_callback(vm, callback) } == active_run() {
        return false;
    }
    with_current(|run| run.parked_immediates.push(immediate.cast()));
    bun_core::scoped_log!(DomainRun, "parked foreign immediate {:p}", immediate);
    true
}

/// `tick_queue_with_count` dequeued `task` while a run is active. Tasks stamped
/// with another domain (another run's, or the root's) are parked; unattributed
/// tasks (domain 0 — created off the JS thread, provenance unknown) run in any
/// run, since their observable continuations are microtasks, which are gated.
#[inline]
pub(crate) fn park_task_if_foreign(task: Task) -> bool {
    let active = active_run();
    if active == 0 || task.domain == 0 || task.domain == active {
        return false;
    }
    with_current(|run| run.parked_tasks.push(task));
    bun_core::scoped_log!(
        DomainRun,
        "parked foreign task {} (domain {})",
        task.tag.name(),
        task.domain
    );
    true
}

// ─── the run ─────────────────────────────────────────────────────────────────

/// A scoped run of one domain. Entering pushes onto the run stack (here and in
/// C++); dropping pops it and hands every parked item back to the loop.
pub struct ScopedRun {
    vm: *mut VirtualMachine,
    domain: u32,
}

impl ScopedRun {
    /// # Safety
    /// `vm` is the live per-thread VM; the run must be dropped on this thread,
    /// innermost first.
    pub unsafe fn enter(vm: *mut VirtualMachine, domain: u32) -> ScopedRun {
        debug_assert!(domain != 0);
        // SAFETY: per fn contract.
        unsafe { Bun__Domain__enterRun((*vm).global, domain) };
        let outer_start_epoch = bun_io::run_epoch::active_run_start();
        // I/O created from here on is the run's own; everything older is foreign.
        let start_epoch = bun_io::run_epoch::bump();
        RUNS.with_borrow_mut(|runs| {
            runs.push(RunState {
                domain,
                outer_start_epoch,
                deferred_timers: Vec::new(),
                parked_immediates: Vec::new(),
                parked_tasks: Vec::new(),
            })
        });
        bun_event_loop::set_active_run_domain(domain);
        // SAFETY: per fn contract.
        unsafe { set_run_start_epoch(vm, start_epoch) };
        bun_core::scoped_log!(DomainRun, "enter run {} (epoch {})", domain, start_epoch);
        ScopedRun { vm, domain }
    }

    /// Enter a run of a freshly allocated domain.
    ///
    /// # Safety
    /// As [`ScopedRun::enter`].
    pub unsafe fn enter_new(vm: *mut VirtualMachine) -> ScopedRun {
        // SAFETY: per fn contract.
        let domain = unsafe { Bun__Domain__allocate((*vm).global) };
        // SAFETY: per fn contract.
        unsafe { Self::enter(vm, domain) }
    }

    #[inline]
    pub fn domain(&self) -> u32 {
        self.domain
    }

    /// Run this domain's nextTicks and microtasks (the checkpoint is run-aware).
    /// A termination is left pending on the VM for the caller's own checks.
    pub fn checkpoint(&self) {
        // SAFETY: `vm` is live per `enter` contract; `event_loop()` is its embedded loop.
        let _ = unsafe { (*(*self.vm).event_loop()).drain_microtasks() };
    }

    /// One gated turn of the loop: tasks, immediates and a checkpoint; then —
    /// unless `done()` now holds — due timers and the poll, sleeping no later
    /// than `deadline` (or this domain's next timer). Uses exactly the tick
    /// logic of ordinary execution; the gates do the filtering. `done` is
    /// consulted after the ready work so a condition satisfied by it does not
    /// sit through a poll that may have nothing to wake it. Returns whether
    /// `deadline` has passed.
    ///
    /// # Safety
    /// As [`ScopedRun::enter`]; must be the innermost run.
    pub unsafe fn turn(&self, deadline: Option<&Timespec>, done: impl FnOnce() -> bool) -> bool {
        debug_assert_eq!(active_run(), self.domain);
        let vm = self.vm;
        let deadline_passed = || match deadline {
            Some(deadline) => {
                Timespec::now(TimespecMockMode::ForceRealTime).order(deadline)
                    != core::cmp::Ordering::Less
            }
            None => false,
        };
        // SAFETY: per fn contract; `el` is the live per-thread event loop.
        unsafe {
            let el = (*vm).event_loop();
            (*el).tick();
            (*el).tick_immediate_tasks(vm);
            let _ = (*el).drain_microtasks();
        }
        if done() {
            return deadline_passed();
        }
        let outer_deadline = POLL_DEADLINE.replace(deadline.copied());
        // SAFETY: per fn contract. `auto_tick_for_domain_run` is `auto_tick`
        // without the leading immediates pass done above; it caps its poll
        // timeout with `poll_deadline()`.
        unsafe { crate::jsc_hooks::auto_tick_for_domain_run(vm) };
        POLL_DEADLINE.set(outer_deadline);
        deadline_passed()
    }

    /// What the domain already made ready in its final step (immediates it
    /// queued, their microtasks) runs before the run returns rather than
    /// lingering as work nobody may turn the loop for.
    fn final_ready_pass(&self) {
        let vm = self.vm;
        // SAFETY: `vm` live per `enter` contract.
        unsafe {
            let el = (*vm).event_loop();
            (*el).tick_immediate_tasks(vm);
            let _ = (*el).drain_microtasks();
        }
    }
}

impl Drop for ScopedRun {
    fn drop(&mut self) {
        // SAFETY: `vm` live per `enter` contract; runs are dropped innermost first.
        unsafe { exit_run(self.vm, self.domain) };
    }
}

/// Publish the innermost run's start epoch to the FilePoll gate (thread-local)
/// and the usockets gate (loop data).
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn set_run_start_epoch(vm: *mut VirtualMachine, epoch: u32) {
    bun_io::run_epoch::set_active_run_start(epoch);
    // SAFETY: per fn contract; the uws loop exists before any run can start.
    unsafe {
        if (*vm).event_loop_handle.is_some() {
            (*(*vm).uws_loop()).internal_loop_data.run_start_epoch = epoch;
        }
    }
}

/// # Safety
/// `vm` is the live per-thread VM and `domain` is the innermost run.
unsafe fn exit_run(vm: *mut VirtualMachine, domain: u32) {
    let run = RUNS.with_borrow_mut(|runs| {
        let run = runs.pop().expect("scoped run active");
        debug_assert_eq!(run.domain, domain);
        bun_event_loop::set_active_run_domain(runs.last().map_or(0, |r| r.domain));
        run
    });
    // SAFETY: per fn contract.
    unsafe { Bun__Domain__exitRun((*vm).global) };
    // Foreign I/O that became ready during the run reports again from the next
    // poll, to its owner (or stays parked if still foreign to an outer run).
    // SAFETY: per fn contract.
    unsafe {
        bun_io::run_epoch::set_active_run_start(run.outer_start_epoch);
        if (*vm).event_loop_handle.is_some() {
            let uws_loop = (*vm).uws_loop();
            #[cfg(not(windows))]
            bun_io::run_epoch::rearm_after_run(
                bun_io::uws_to_native(uws_loop),
                run.outer_start_epoch,
            );
            (*uws_loop).scoped_run_ended(run.outer_start_epoch);
        }
    }
    bun_core::scoped_log!(
        DomainRun,
        "exit run {} (handing back {} timers, {} immediates, {} tasks)",
        domain,
        run.deferred_timers.len(),
        run.parked_immediates.len(),
        run.parked_tasks.len()
    );

    // Timers go back into the heap with their original deadline and epoch, so
    // relative order among them (and against timers that never left) is unchanged.
    if !run.deferred_timers.is_empty() {
        let state = crate::jsc_hooks::runtime_state();
        for timer in run.deferred_timers {
            // SAFETY: the node was live when deferred and its owner cannot have
            // freed it since: `clearTimeout` routes through `forget_deferred_timer`
            // (removing it from this list first) and finalization requires the
            // timer to be out of the heap, which its `ACTIVE` state denies.
            unsafe {
                (*state).timer.timers.insert(timer);
                (*timer).in_heap = InHeap::Regular;
            }
        }
    }

    // SAFETY: per fn contract; `event_loop()` is the VM's embedded loop.
    let el = unsafe { &mut *(*vm).event_loop() };
    if !run.parked_tasks.is_empty() {
        bun_core::handle_oom(el.tasks.unget(&run.parked_tasks));
    }
    if !run.parked_immediates.is_empty() {
        let mut immediates = run.parked_immediates;
        immediates.append(&mut el.immediate_tasks);
        el.immediate_tasks = immediates;
    }
}

/// Enter a run of `domain` and turn the loop until `until()` holds.
///
/// # Safety
/// `vm` is the live per-thread VM.
pub unsafe fn run_until(vm: *mut VirtualMachine, domain: u32, mut until: impl FnMut() -> bool) {
    // SAFETY: per fn contract.
    let run = unsafe { ScopedRun::enter(vm, domain) };
    run.checkpoint();
    // SAFETY: `run` is the innermost run; `vm` per fn contract.
    while !until() && unsafe { (*vm).script_allowed() } {
        // SAFETY: as above.
        unsafe { run.turn(None, &mut until) };
    }
    run.final_ready_pass();
}

/// bun:jsc `runUntilInDomainForTesting(thunk)`: enter a fresh scoped run, call
/// `thunk` (which returns a promise created under that domain), and turn the
/// loop for the domain until the promise settles. Returns the settled promise.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Domain__runUntilInDomainForTesting(
    global: &JSGlobalObject,
    thunk: JSValue,
) -> JSValue {
    let vm = global.bun_vm_ptr();
    // SAFETY: `vm` is the live per-thread VM owning `global`.
    let run = unsafe { ScopedRun::enter_new(vm) };
    let result = match thunk.call(global, JSValue::UNDEFINED, &[]) {
        Ok(v) => v,
        Err(_) => return JSValue::ZERO,
    };
    let _keep = bun_jsc::Strong::create(result, global);
    let promise = result.as_any_promise();
    let pending = || matches!(&promise, Some(p) if p.status() == PromiseStatus::Pending);
    run.checkpoint();
    // SAFETY: `vm` is live.
    while pending() && unsafe { (*vm).script_allowed() } && !global.has_exception() {
        // SAFETY: `run` is the innermost run.
        unsafe { run.turn(None, || !pending()) };
    }
    run.final_ready_pass();
    drop(run);
    result
}
