//! Domain runs — the run driver.
//!
//! A domain run turns Bun's one event loop from inside a synchronous frame while
//! admitting only work born since the run started (see `bun_io::run_epoch` for
//! how everything is stamped, and `src/jsc/bindings/EventLoopDomain.h` for how
//! microtasks and `process.nextTick` carry their birth in the async context).
//! Anything older that surfaces while the run is active — due timers,
//! immediates, event-loop tasks, ready I/O — is parked and handed back, in its
//! original order and with unchanged deadlines, when the run exits. Runs nest.
//!
//! With no run entered every gate is one branch on `active_run_start() == 0`.

use core::cell::RefCell;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::run_epoch;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, PromiseStatus, Task};

use crate::timer::ImmediateObject;

bun_core::declare_scope!(DomainRun, hidden);

/// What a run admits besides what was born since it started. A run must be able
/// to wait on its own consequences without deadlocking; everything else it can
/// hold.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// The run executes no code of its own while it waits (spawnSync): nothing
    /// that predates it is admitted, microtasks and nextTicks are not drained
    /// at all (`vm.suppress_microtask_drain`), and the embedder's loop hooks
    /// are skipped. Needs nothing from JSC.
    Strict,
    /// The run executes arbitrary code of its own (a frame awaiting a promise it
    /// created): older listen sockets keep accepting (a fetch to a server created
    /// outside must not deadlock), older sockets it writes to become its own,
    /// module-loader jobs run, and callbacks it dispatches on others' behalf run
    /// under its domain so that what they schedule is admitted.
    Permissive,
}

struct RunState {
    /// The run's name: I/O, tasks and timers born before it are foreign.
    start: u32,
    policy: Policy,
    /// Strict runs: `vm.suppress_microtask_drain` at entry, restored on exit.
    suppressed_before: bool,
    /// Foreign `setImmediate`s that reached the front, in order.
    parked_immediates: Vec<*mut ImmediateObject>,
    /// Foreign event-loop tasks, in dequeue order.
    parked_tasks: Vec<Task>,
}

thread_local! {
    static RUNS: RefCell<Vec<RunState>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "C" {
    fn Bun__Domain__enterRun(global: *mut JSGlobalObject, start: u32);
    fn Bun__Domain__beginLoopPhase(global: *mut JSGlobalObject);
    fn Bun__Domain__exitRun(global: *mut JSGlobalObject);
}

fn with_current<R>(f: impl FnOnce(&mut RunState) -> R) -> R {
    RUNS.with_borrow_mut(|runs| f(runs.last_mut().expect("domain run active")))
}

// ─── gates ───────────────────────────────────────────────────────────────────
// (Timers are parked inside `timer::All::next`; I/O in `bun_io` / usockets.)

/// `run_immediate_task` is about to run `immediate`. If a run is active and it
/// was queued before the run started, park it (refs and keep-alive left as they
/// are: it is still logically queued) and report `true`.
///
/// # Safety
/// `immediate` is a live queued `ImmediateObject`.
#[inline]
pub(crate) unsafe fn park_immediate_if_foreign(immediate: *mut ImmediateObject) -> bool {
    // SAFETY: per fn contract.
    if !run_epoch::is_foreign(unsafe { (*immediate).event_loop_timer.birth }) {
        return false;
    }
    with_current(|run| run.parked_immediates.push(immediate));
    bun_core::scoped_log!(DomainRun, "parked foreign immediate {:p}", immediate);
    true
}

/// `tick_queue_with_count` dequeued `task`. If a run is active and the task was
/// born before it started (or off-thread with no known birth), park it and
/// report `true`.
#[inline]
pub(crate) fn park_task_if_foreign(task: Task) -> bool {
    if !run_epoch::is_foreign(task.birth) {
        return false;
    }
    bun_core::scoped_log!(
        DomainRun,
        "parked foreign task {} (born {})",
        task.tag.name(),
        task.birth
    );
    with_current(|run| run.parked_tasks.push(task));
    true
}

// ─── the run ─────────────────────────────────────────────────────────────────

/// One run. Entering pushes onto the run stack (here and in C++); dropping pops
/// it and hands every parked item back to the loop.
pub struct DomainRun {
    vm: *mut VirtualMachine,
    start: u32,
}

impl DomainRun {
    /// # Safety
    /// `vm` is the live per-thread VM; the run must be dropped on this thread,
    /// innermost first.
    pub unsafe fn enter(vm: *mut VirtualMachine, policy: Policy) -> DomainRun {
        let start = run_epoch::bump();
        let permissive = policy == Policy::Permissive;
        // SAFETY: per fn contract.
        let suppressed_before = unsafe {
            if permissive {
                // Its own code's microtasks must run: JSC drains only what was
                // queued since `start` (see EventLoopDomain.h).
                Bun__Domain__enterRun((*vm).global, start);
                false
            } else {
                (*vm).suppress_microtask_drain.replace(true)
            }
        };
        RUNS.with_borrow_mut(|runs| {
            runs.push(RunState {
                start,
                policy,
                suppressed_before,
                parked_immediates: Vec::new(),
                parked_tasks: Vec::new(),
            })
        });
        run_epoch::set_active_run(start, policy == Policy::Strict);
        // SAFETY: per fn contract; the uws loop exists before any run can start.
        unsafe {
            if (*vm).event_loop_handle.is_some() {
                (*(*vm).uws_loop()).domain_run_began(start, permissive);
            }
        }
        bun_core::scoped_log!(DomainRun, "enter run {}", start);
        DomainRun { vm, start }
    }

    /// One gated turn of the loop: tasks, immediates and a checkpoint; then —
    /// unless `done()` now holds — due timers and the poll, sleeping no later
    /// than `deadline` (or the run's next timer). Uses exactly the tick logic of
    /// ordinary execution; the gates do the filtering. `done` is consulted
    /// after the ready work so a condition satisfied by it does not sit through
    /// a poll that may have nothing to wake it. Returns whether `deadline` has
    /// passed.
    ///
    /// # Safety
    /// As [`DomainRun::enter`]; must be the innermost run.
    pub unsafe fn turn(&self, deadline: Option<&Timespec>, done: impl FnOnce() -> bool) -> bool {
        debug_assert_eq!(run_epoch::active_run_start(), self.start);
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
        unsafe { crate::jsc_hooks::auto_tick_after_immediates(vm, deadline) };
        deadline_passed()
    }
}

impl Drop for DomainRun {
    fn drop(&mut self) {
        // SAFETY: `vm` live per `enter` contract; runs are dropped innermost first.
        unsafe { exit_run(self.vm, self.start) };
    }
}

/// # Safety
/// `vm` is the live per-thread VM and `start` names the innermost run.
unsafe fn exit_run(vm: *mut VirtualMachine, start: u32) {
    // Hand everything back while the run is still formally active, so nothing
    // is ever parked-but-owned-by-no-run; then pop.
    let (parked_tasks, parked_immediates, policy, suppressed_before, outer) =
        RUNS.with_borrow_mut(|runs| {
            let outer = runs.iter().rev().nth(1).map(|r| (r.start, r.policy));
            let run = runs.last_mut().expect("domain run active");
            debug_assert_eq!(run.start, start);
            let tasks = core::mem::take(&mut run.parked_tasks);
            let immediates = core::mem::take(&mut run.parked_immediates);
            (tasks, immediates, run.policy, run.suppressed_before, outer)
        });
    // No outer run: start 0, and nothing is permissive.
    let (outer_start, outer_policy) = outer.unwrap_or((0, Policy::Strict));
    bun_core::scoped_log!(
        DomainRun,
        "exit run {} (handing back {} immediates, {} tasks)",
        start,
        parked_immediates.len(),
        parked_tasks.len()
    );

    // SAFETY: per fn contract; `event_loop()` is the VM's embedded loop.
    let el = unsafe { &mut *(*vm).event_loop() };
    if !parked_tasks.is_empty() {
        bun_core::handle_oom(el.tasks.unget(&parked_tasks));
    }
    if !parked_immediates.is_empty() {
        let mut immediates: Vec<*mut ()> =
            parked_immediates.into_iter().map(|p| p.cast()).collect();
        immediates.append(&mut el.immediate_tasks);
        el.immediate_tasks = immediates;
    }
    // SAFETY: JS thread; the timer heap is this thread's.
    unsafe {
        (*crate::jsc_hooks::runtime_state())
            .timer
            .unpark_after_run(outer_start)
    };

    // Foreign I/O that became ready during the run reports again from the next
    // poll, to its owner (or stays held if still foreign to an outer run).
    // SAFETY: per fn contract.
    unsafe {
        if (*vm).event_loop_handle.is_some() {
            let uws_loop = (*vm).uws_loop();
            #[cfg(not(windows))]
            if bun_io::held_polls::release_after_run(bun_io::uws_to_native(uws_loop), outer_start) {
                // Held one-shot readiness (a foreign child's exit on kqueue) is its
                // owner's callback: deliver it from the loop, not from this frame.
                let mut replay = Task::new(
                    bun_event_loop::task_tag::RunEpochReplay,
                    core::ptr::null_mut(),
                );
                replay.birth = start;
                el.enqueue_task(replay);
            }
            (*uws_loop).domain_run_ended(outer_start, outer_policy == Policy::Permissive);
        }
    }

    RUNS.with_borrow_mut(|runs| {
        runs.pop();
    });
    run_epoch::set_active_run(outer_start, outer_policy == Policy::Strict);
    // SAFETY: per fn contract.
    unsafe {
        match policy {
            Policy::Permissive => Bun__Domain__exitRun((*vm).global),
            Policy::Strict => (*vm).suppress_microtask_drain.set(suppressed_before),
        }
    }
}

/// bun:jsc `runUntilInDomainForTesting(thunk)`: enter a permissive run, call
/// `thunk` (it returns a promise the run created), and turn the loop until the
/// promise settles or `timeout_ms` elapses. Returns the promise.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Domain__runUntilInDomainForTesting(
    global: &JSGlobalObject,
    thunk: JSValue,
    timeout_ms: u32,
) -> JSValue {
    let vm = global.bun_vm_ptr();
    // SAFETY: `vm` is the live per-thread VM owning `global`.
    let run = unsafe { DomainRun::enter(vm, Policy::Permissive) };
    let Ok(result) = thunk.call(global, JSValue::UNDEFINED, &[]) else {
        return JSValue::ZERO;
    };
    // SAFETY: `global` is live; a run was entered above.
    unsafe { Bun__Domain__beginLoopPhase(global.as_ptr()) };
    let _keep = bun_jsc::Strong::create(result, global);
    let promise = result.as_any_promise();
    let pending = || matches!(&promise, Some(p) if p.status() == PromiseStatus::Pending);
    let deadline = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, i64::from(timeout_ms));
    // SAFETY: `vm` live; `event_loop()` is its embedded loop; `run` is innermost.
    unsafe {
        let el = (*vm).event_loop();
        let _ = (*el).drain_microtasks();
        while pending() && (*vm).script_allowed() {
            if run.turn(Some(&deadline), || !pending()) {
                break;
            }
        }
        // What the run made ready in its final step runs before it returns.
        (*el).tick_immediate_tasks(vm);
        let _ = (*el).drain_microtasks();
    }
    drop(run);
    result
}
