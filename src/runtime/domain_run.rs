//! Domain runs — the run driver.
//!
//! A domain run turns Bun's one event loop from inside a synchronous frame while
//! admitting only the work attributed to the run's *domain* (see
//! `src/jsc/bindings/EventLoopDomain.h` for how work is attributed). Anything
//! else that surfaces while the run is active — due timers, immediates,
//! event-loop tasks of another domain — is parked here and handed back, in its
//! original order and with unchanged deadlines, when the run exits. Microtasks
//! and `process.nextTick` are gated on the C++/JS side off the same "active run
//! domain"; the run stack below mirrors the C++ one and is what the Rust gates
//! consult.
//!
//! With no run entered every gate is one branch on [`active_run`]` == 0`.

use core::cell::RefCell;

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, InHeap};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, PromiseStatus, Task};

use crate::timer::ImmediateObject;

bun_core::declare_scope!(DomainRun, hidden);

/// What a run admits besides its own domain's work. A run must be able to wait
/// on its own consequences without deadlocking; everything else it can hold.
#[derive(Clone, Copy)]
pub struct Policy {
    /// Keep accepting on listen sockets that predate the run. A new connection is
    /// an external event rather than an outer callback, and a run whose code
    /// fetches from a server created outside it needs the accept to proceed;
    /// but for a run that cannot depend on it (spawnSync) admitting it is pure
    /// re-entrancy, so it is a choice.
    pub admits_accepts: bool,
    /// Run module-loader microtasks inside the run. They are keyed by loader
    /// state, not by the importer's context, so they cannot be attributed: a run
    /// whose code may `import()` needs them, at the price that an import started
    /// outside it may progress inside.
    pub admits_loader_jobs: bool,
}

impl Policy {
    /// Nothing but the run's own consequences (spawnSync).
    pub const STRICT: Policy = Policy {
        admits_accepts: false,
        admits_loader_jobs: false,
    };
    /// Also whatever a run awaiting arbitrary work of its own could need.
    pub const PERMISSIVE: Policy = Policy {
        admits_accepts: true,
        admits_loader_jobs: true,
    };
}

struct RunState {
    domain: u32,
    policy: Policy,
    /// I/O created before this is foreign to the run (see `bun_io::run_epoch`).
    start_epoch: u32,
    /// Foreign timers that became due during the run. Kept out of the timer heap
    /// for the run's duration (so the poll timeout ignores them) and reinserted
    /// with their original deadline on exit.
    deferred_timers: Vec<*mut EventLoopTimer>,
    /// Foreign `setImmediate`s that reached the front.
    parked_immediates: Vec<*mut ImmediateObject>,
    /// Foreign event-loop tasks, in dequeue order.
    parked_tasks: Vec<Task>,
}

thread_local! {
    static RUNS: RefCell<Vec<RunState>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "C" {
    fn Bun__Domain__enterRun(global: *mut JSGlobalObject, domain: u32, admits_loader_jobs: bool);
    fn Bun__Domain__exitRun(global: *mut JSGlobalObject);
    fn Bun__Domain__callInEntryContext(global: *mut JSGlobalObject, function: JSValue) -> JSValue;
}

/// The innermost run's domain; 0 when no run is active. (`RUNS.last()`, mirrored
/// in the lowest tier so `Task` stamping can read it too.)
#[inline]
pub fn active_run() -> u32 {
    bun_event_loop::active_run_domain()
}

#[inline]
pub fn is_in_run() -> bool {
    active_run() != 0
}

fn with_current<R>(f: impl FnOnce(&mut RunState) -> R) -> R {
    RUNS.with_borrow_mut(|runs| f(runs.last_mut().expect("domain run active")))
}

// ─── gates ───────────────────────────────────────────────────────────────────

/// `timer::All::next` popped a due timer. If a run is active and the timer was
/// armed by another domain, take custody of it (out of the heap, state left
/// `ACTIVE`) until the run exits and report `true`.
///
/// # Safety
/// `timer` is a live heap node just removed by `delete_min`.
#[inline]
pub(crate) unsafe fn defer_timer_if_foreign(timer: *mut EventLoopTimer) -> bool {
    let active = active_run();
    // SAFETY: per fn contract.
    if active == 0 || unsafe { (*timer).domain == active || !(*timer).tag.is_domain_gated() } {
        return false;
    }
    // SAFETY: per fn contract — the node is out of the heap; record that so a
    // cancel during the run knows to look for it here.
    unsafe { (*timer).in_heap = InHeap::DeferredByRun };
    with_current(|run| run.deferred_timers.push(timer));
    bun_core::scoped_log!(DomainRun, "deferred foreign timer {:p}", timer);
    true
}

/// `timer::All::remove` on a timer this module has custody of (a cancel during
/// the run): drop it from whichever run holds it.
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

/// `run_immediate_task` is about to run `immediate`. If a run is active and it
/// was queued by another domain, park it (refs and keep-alive left as they are:
/// it is still logically queued) and report `true`.
///
/// # Safety
/// `immediate` is a live queued `ImmediateObject`.
#[inline]
pub(crate) unsafe fn park_immediate_if_foreign(immediate: *mut ImmediateObject) -> bool {
    let active = active_run();
    // SAFETY: per fn contract.
    if active == 0 || unsafe { (*immediate).event_loop_timer.domain } == active {
        return false;
    }
    with_current(|run| run.parked_immediates.push(immediate));
    bun_core::scoped_log!(DomainRun, "parked foreign immediate {:p}", immediate);
    true
}

/// `tick_queue_with_count` dequeued `task`. If a run is active and the task is
/// another domain's (another run's, or a root's), park it and report `true`.
/// Unattributed tasks (domain 0 — created on a thread with no VM) are admitted:
/// they are completions whose observable continuations are microtasks, which
/// are gated; a completion that runs JS directly must be stamped by its owner.
#[inline]
pub(crate) fn park_task_if_foreign(task: Task) -> bool {
    let active = active_run();
    if active == 0 || task.domain == active {
        return false;
    }
    if task.domain == 0 {
        bun_core::scoped_log!(DomainRun, "admitted unattributed task {}", task.tag.name());
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

/// A run of one domain. Entering pushes onto the run stack (here and in C++);
/// dropping pops it and hands every parked item back to the loop.
pub struct DomainRun {
    vm: *mut VirtualMachine,
    domain: u32,
}

impl DomainRun {
    /// # Safety
    /// `vm` is the live per-thread VM; the run must be dropped on this thread,
    /// innermost first.
    pub unsafe fn enter(vm: *mut VirtualMachine, domain: u32, policy: Policy) -> DomainRun {
        debug_assert!(domain != 0);
        // SAFETY: per fn contract.
        unsafe { Bun__Domain__enterRun((*vm).global, domain, policy.admits_loader_jobs) };
        // I/O created from here on is the run's own; everything older is foreign.
        let start_epoch = bun_io::run_epoch::bump();
        RUNS.with_borrow_mut(|runs| {
            runs.push(RunState {
                domain,
                policy,
                start_epoch,
                deferred_timers: Vec::new(),
                parked_immediates: Vec::new(),
                parked_tasks: Vec::new(),
            })
        });
        bun_event_loop::set_active_run_domain(domain);
        bun_io::run_epoch::set_active_run_start(start_epoch);
        // SAFETY: per fn contract; the uws loop exists before any run can start.
        unsafe {
            if (*vm).event_loop_handle.is_some() {
                (*(*vm).uws_loop()).domain_run_began(start_epoch, policy.admits_accepts);
            }
        }
        bun_core::scoped_log!(DomainRun, "enter run {} (epoch {})", domain, start_epoch);
        DomainRun { vm, domain }
    }

    /// Enter a run of a freshly allocated domain.
    ///
    /// # Safety
    /// As [`DomainRun::enter`].
    pub unsafe fn enter_new(vm: *mut VirtualMachine, policy: Policy) -> DomainRun {
        // SAFETY: per fn contract.
        unsafe { Self::enter(vm, bun_event_loop::allocate_domain(), policy) }
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
    /// As [`DomainRun::enter`]; must be the innermost run.
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
        // SAFETY: per fn contract.
        unsafe { crate::jsc_hooks::auto_tick_for_domain_run(vm, deadline) };
        deadline_passed()
    }

    /// What the domain already made ready in its final step (immediates it
    /// queued, their microtasks) runs before the run returns rather than
    /// lingering as work nobody may turn the loop for.
    pub fn final_ready_pass(&self) {
        let vm = self.vm;
        // SAFETY: `vm` live per `enter` contract.
        unsafe {
            let el = (*vm).event_loop();
            (*el).tick_immediate_tasks(vm);
            let _ = (*el).drain_microtasks();
        }
    }
}

impl Drop for DomainRun {
    fn drop(&mut self) {
        // SAFETY: `vm` live per `enter` contract; runs are dropped innermost first.
        unsafe { exit_run(self.vm, self.domain) };
    }
}

/// # Safety
/// `vm` is the live per-thread VM and `domain` is the innermost run.
unsafe fn exit_run(vm: *mut VirtualMachine, domain: u32) {
    let (run, outer_start_epoch, outer_policy) = RUNS.with_borrow_mut(|runs| {
        let run = runs.pop().expect("domain run active");
        debug_assert_eq!(run.domain, domain);
        let outer = runs.last();
        bun_event_loop::set_active_run_domain(outer.map_or(0, |r| r.domain));
        (
            run,
            outer.map_or(0, |r| r.start_epoch),
            outer.map_or(Policy::PERMISSIVE, |r| r.policy),
        )
    });
    // SAFETY: per fn contract.
    unsafe { Bun__Domain__exitRun((*vm).global) };
    bun_core::scoped_log!(
        DomainRun,
        "exit run {} (handing back {} timers, {} immediates, {} tasks)",
        domain,
        run.deferred_timers.len(),
        run.parked_immediates.len(),
        run.parked_tasks.len()
    );

    // Foreign I/O that became ready during the run reports again from the next
    // poll, to its owner (or stays parked if still foreign to an outer run).
    bun_io::run_epoch::set_active_run_start(outer_start_epoch);
    // SAFETY: per fn contract.
    unsafe {
        if (*vm).event_loop_handle.is_some() {
            let uws_loop = (*vm).uws_loop();
            #[cfg(not(windows))]
            if bun_io::run_epoch::rearm_after_run(
                bun_io::uws_to_native(uws_loop),
                outer_start_epoch,
            ) {
                // Held one-shot readiness (a foreign child's exit on kqueue) is its
                // owner's callback: deliver it from the loop, not from this frame.
                (*(*vm).event_loop()).enqueue_task(Task::new(
                    bun_event_loop::task_tag::RunEpochReplay,
                    core::ptr::null_mut(),
                ));
            }
            (*uws_loop).domain_run_ended(outer_start_epoch, outer_policy.admits_accepts);
        }
    }

    if !run.deferred_timers.is_empty() {
        // SAFETY: the nodes were live when deferred and their owners cannot have
        // freed them since: cancelling routes through `forget_deferred_timer`
        // (removing them from this list first) and finalization requires the timer
        // to be out of the heap, which its `ACTIVE` state denies.
        unsafe {
            (*crate::jsc_hooks::runtime_state())
                .timer
                .reinsert_after_run(&run.deferred_timers)
        };
    }

    // SAFETY: per fn contract; `event_loop()` is the VM's embedded loop.
    let el = unsafe { &mut *(*vm).event_loop() };
    if !run.parked_tasks.is_empty() {
        bun_core::handle_oom(el.tasks.unget(&run.parked_tasks));
    }
    if !run.parked_immediates.is_empty() {
        let mut immediates: Vec<*mut ()> = run
            .parked_immediates
            .into_iter()
            .map(|p| p.cast())
            .collect();
        immediates.append(&mut el.immediate_tasks);
        el.immediate_tasks = immediates;
    }
}

/// bun:jsc `runUntilInDomainForTesting(thunk)`: enter a fresh (permissive) run,
/// call `thunk` (which returns a promise created under that domain), and turn
/// the loop for the domain until the promise settles. Returns the promise.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Domain__runUntilInDomainForTesting(
    global: &JSGlobalObject,
    thunk: JSValue,
) -> JSValue {
    let vm = global.bun_vm_ptr();
    // SAFETY: `vm` is the live per-thread VM owning `global`.
    let run = unsafe { DomainRun::enter_new(vm, Policy::PERMISSIVE) };
    // SAFETY: `global` is live; a run was entered above.
    let result = unsafe { Bun__Domain__callInEntryContext(global.as_ptr(), thunk) };
    if global.has_exception() {
        return JSValue::ZERO;
    }
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
