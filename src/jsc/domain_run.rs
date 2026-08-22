//! Domain runs — the run stack and the one loop step everything uses.
//!
//! Every turn of a Bun event loop happens inside a *domain run*: the root
//! program is a run entered when its VM starts, and a synchronous frame that
//! must block (spawnSync; a frame awaiting a promise it created) enters a
//! nested run and turns the same loop with the same [`turn`] step. What a turn
//! admits is decided by births (see `bun_io::run_epoch`): the innermost run's
//! own consequences — anything born since it started — proceed; anything older
//! that surfaces (due timers, immediates, event-loop tasks, ready I/O) is
//! parked and handed back, in its original order and with unchanged deadlines,
//! when that run exits. The root run started before everything, so at the root
//! nothing is ever held and a turn is an ordinary event-loop iteration.

use core::cell::RefCell;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::run_epoch;

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, PromiseStatus, Task};

bun_core::declare_scope!(DomainRun, hidden);

/// What the run's own consequences are made of. A run must be able to wait on
/// its own consequences without deadlocking; everything else it can hold.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// Native work only (spawnSync: the child's pipes and exit). No script the
    /// caller caused can be pending, so none runs: microtasks and nextTicks are
    /// not drained, timers, immediates and everything older are held, and the
    /// embedder's loop hooks are skipped.
    Native,
    /// Native work and the frame's own scripts (the root program; a frame
    /// awaiting a promise it created): its microtasks and ticks run while older
    /// ones wait, older listen sockets keep accepting (a fetch to a server
    /// created outside must not deadlock), older sockets its code writes to
    /// become its own, and module-loader jobs run.
    NativeAndScripts,
}

struct RunState {
    /// The run's name: I/O, tasks and timers born before it are foreign.
    /// `run_epoch::PRIMORDIAL` for the root.
    start: u32,
    policy: Policy,
    /// `Native` runs: `vm.suppress_microtask_drain` at entry, restored on exit.
    suppressed_before: bool,
    /// Foreign `setImmediate`s that reached the front, in order.
    parked_immediates: Vec<*mut ()>,
    /// The task queue as it stood at entry (all older than the run), set aside
    /// wholesale so a backlog is not re-examined task by task on every call.
    tasks_at_entry: Vec<Task>,
    /// Foreign event-loop tasks that arrived during the run, in dequeue order.
    parked_tasks: Vec<Task>,
}

thread_local! {
    /// `RUNS[0]` is the root run for this thread's VM.
    static RUNS: RefCell<Vec<RunState>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "C" {
    // The C++/JSC side, like the uws loop, mirrors nested script-running runs
    // only: the root has nothing to set aside (see EventLoopDomain.h).
    fn Bun__Domain__enterRun(global: *mut JSGlobalObject, start: u32);
    fn Bun__Domain__beginLoopPhase(global: *mut JSGlobalObject);
    fn Bun__Domain__exitRun(global: *mut JSGlobalObject);
}

/// Whether a run other than the root is active on this thread: some outer
/// frame is blocked mid-job, so its end-of-job work (unhandled-rejection
/// processing, WeakRef release, JSC's deferred work) waits for it.
#[inline]
pub fn in_nested_run() -> bool {
    run_epoch::run_depth() > 1
}

fn with_current<R>(f: impl FnOnce(&mut RunState) -> R) -> R {
    RUNS.with_borrow_mut(|runs| f(runs.last_mut().expect("domain run active")))
}

// ─── gates ───────────────────────────────────────────────────────────────────
// (Timers are parked inside `timer::All::next`; I/O in `bun_io` / usockets.)

/// `run_immediate_task` is about to run an immediate born at `birth`. If it
/// predates the innermost run, park it (refs and keep-alive left as they are:
/// it is still logically queued) and report `true`.
#[inline]
pub fn park_immediate_if_foreign(immediate: *mut (), birth: u32) -> bool {
    if !run_epoch::is_foreign(birth) {
        return false;
    }
    with_current(|run| run.parked_immediates.push(immediate));
    bun_core::scoped_log!(DomainRun, "parked foreign immediate {:p}", immediate);
    true
}

/// `tick_queue_with_count` dequeued `task`. If it predates the innermost run
/// (or its birth is unknown), park it and report `true`.
#[inline]
pub fn park_task_if_foreign(task: Task) -> bool {
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

// ─── the loop step ───────────────────────────────────────────────────────────

/// One turn of the innermost run: event-loop tasks; then, unless the run is
/// native-only, immediates; then due timers and the poll, sleeping no later than
/// `deadline` (or the next timer). `done` is evaluated after the tasks and again
/// after the immediates — up to twice per turn, so it may do the bookkeeping it
/// needs but must be idempotent — so a condition satisfied by ready work neither
/// runs work it did not need nor sits through a poll that may have nothing to
/// wake it. Returns whether `deadline` has passed. This is the event loop's
/// iteration; the gates do the filtering.
///
/// # Safety
/// `vm` is the live per-thread VM.
pub unsafe fn turn(
    vm: *mut VirtualMachine,
    deadline: Option<&Timespec>,
    mut done: impl FnMut() -> bool,
) -> bool {
    let deadline_passed = || match deadline {
        Some(deadline) => {
            Timespec::now(TimespecMockMode::ForceRealTime).order(deadline)
                != core::cmp::Ordering::Less
        }
        None => false,
    };
    // SAFETY: per fn contract.
    if unsafe { ready_phases(vm, &mut done) } {
        return deadline_passed();
    }
    // SAFETY: per fn contract.
    unsafe { (*vm).poll(deadline, true) };
    deadline_passed()
}

/// [`turn`] for the program's own run-to-completion loops (main script,
/// shutdown, `beforeExit`): the same ready phases, then the poll without the
/// per-iteration housekeeping (see `RuntimeHooks::poll`).
///
/// # Safety
/// `vm` is the live per-thread VM.
pub unsafe fn turn_active(vm: *mut VirtualMachine, mut done: impl FnMut() -> bool) {
    // SAFETY: per fn contract.
    if unsafe { ready_phases(vm, &mut done) } {
        return;
    }
    // SAFETY: per fn contract.
    unsafe { (*vm).poll(None, false) };
}

/// The ready half of a turn: event-loop tasks, then (unless the innermost run is
/// native-only, whose queues hold only outer work) immediates. `true` as soon
/// as `done` holds.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn ready_phases(vm: *mut VirtualMachine, done: &mut impl FnMut() -> bool) -> bool {
    // SAFETY: per fn contract; `el` is the live per-thread event loop.
    let el = unsafe { (*vm).event_loop() };
    // SAFETY: as above.
    unsafe { (*el).tick() };
    if done() {
        return true;
    }
    if run_epoch::active_run_is_native_only() {
        return false;
    }
    // SAFETY: as above.
    unsafe {
        let had_immediates = !(*el).immediate_tasks.is_empty();
        (*el).tick_immediate_tasks(vm);
        // Beneath an entered frame (a nested wait) `EventLoop::exit` does not
        // drain after each immediate; their microtasks may be what `done` waits for.
        if had_immediates && (*el).entered_event_loop_count > 0 {
            let _ = (*el).drain_microtasks();
        }
    }
    done()
}

// ─── the runs ────────────────────────────────────────────────────────────────

/// Enter this VM's root run. Everything the program does from here on is one of
/// its consequences; nothing predates it. Lives as long as the VM.
pub fn enter_root() {
    if run_epoch::run_depth() != 0 {
        // A second VM on a thread that already has one (its root stands).
        return;
    }
    RUNS.with_borrow_mut(|runs| {
        runs.push(RunState {
            start: run_epoch::PRIMORDIAL,
            policy: Policy::NativeAndScripts,
            suppressed_before: false,
            parked_immediates: Vec::new(),
            tasks_at_entry: Vec::new(),
            parked_tasks: Vec::new(),
        })
    });
    run_epoch::push_run(run_epoch::PRIMORDIAL, true);
    bun_core::scoped_log!(DomainRun, "enter root run");
}

/// The VM is going away (worker teardown): drop the root run's bookkeeping.
pub fn exit_root() {
    RUNS.with_borrow_mut(|runs| {
        debug_assert!(runs.len() <= 1, "VM torn down inside a nested run");
        runs.clear();
    });
    if run_epoch::run_depth() > 0 {
        run_epoch::pop_run(0, false);
    }
}

/// A nested run. Entering pushes onto the run stack (here, and for a
/// script-running run in C++/JSC); dropping pops it and hands every parked item
/// back to the loop.
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
        let executes_scripts = policy == Policy::NativeAndScripts;
        // SAFETY: per fn contract.
        let suppressed_before = unsafe {
            if executes_scripts {
                // Its own scripts' microtasks and ticks must run while older ones
                // wait (see EventLoopDomain.h).
                Bun__Domain__enterRun((*vm).global, start);
                false
            } else {
                (*vm).suppress_microtask_drain.replace(true)
            }
        };
        // SAFETY: per fn contract; `event_loop()` is the VM's embedded loop.
        let tasks_at_entry = unsafe {
            let el = &mut *(*vm).event_loop();
            let mut taken = Vec::with_capacity(el.tasks.readable_length());
            while let Some(task) = el.tasks.read_item() {
                taken.push(task);
            }
            taken
        };
        RUNS.with_borrow_mut(|runs| {
            debug_assert!(!runs.is_empty(), "nested run without a root");
            runs.push(RunState {
                start,
                policy,
                suppressed_before,
                parked_immediates: Vec::new(),
                tasks_at_entry,
                parked_tasks: Vec::new(),
            })
        });
        run_epoch::push_run(start, executes_scripts);
        // SAFETY: per fn contract; the uws loop exists before any nested run.
        unsafe {
            if (*vm).event_loop_handle.is_some() {
                (*(*vm).uws_loop()).domain_run_began(start, executes_scripts);
            }
        }
        bun_core::scoped_log!(DomainRun, "enter run {}", start);
        DomainRun { vm, start }
    }

    /// The entering frame's own code has run; from here on the run only turns
    /// the loop, under an empty ambient async context like the top of the loop.
    pub fn begin_loop_phase(&self) {
        // SAFETY: `vm` live per `enter` contract.
        unsafe { Bun__Domain__beginLoopPhase((*self.vm).global) };
    }

    /// [`turn`] this run (which must be the innermost).
    ///
    /// # Safety
    /// As [`DomainRun::enter`].
    pub unsafe fn turn(&self, deadline: Option<&Timespec>, done: impl FnMut() -> bool) -> bool {
        debug_assert_eq!(run_epoch::active_run_start(), self.start);
        // SAFETY: per fn contract.
        unsafe { turn(self.vm, deadline, done) }
    }
}

impl Drop for DomainRun {
    fn drop(&mut self) {
        // SAFETY: `vm` live per `enter` contract; runs are dropped innermost first.
        unsafe { exit_run(self.vm, self.start) };
    }
}

/// # Safety
/// `vm` is the live per-thread VM and `start` names the innermost, nested, run.
unsafe fn exit_run(vm: *mut VirtualMachine, start: u32) {
    // Hand everything back while the run is still formally active; then pop.
    let (
        parked_tasks,
        parked_immediates,
        policy,
        suppressed_before,
        outer_start,
        outer_policy,
        outer_is_root,
    ) = RUNS.with_borrow_mut(|runs| {
        debug_assert!(runs.len() >= 2, "exiting the root run");
        let outer = &runs[runs.len() - 2];
        let (outer_start, outer_policy, outer_is_root) =
            (outer.start, outer.policy, runs.len() == 2);
        let run = runs.last_mut().expect("domain run active");
        debug_assert_eq!(run.start, start);
        let mut tasks = core::mem::take(&mut run.tasks_at_entry);
        tasks.append(&mut run.parked_tasks);
        let immediates = core::mem::take(&mut run.parked_immediates);
        (
            tasks,
            immediates,
            run.policy,
            run.suppressed_before,
            outer_start,
            outer_policy,
            outer_is_root,
        )
    });
    let outer_executes_scripts = outer_policy == Policy::NativeAndScripts;
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
        let mut immediates = parked_immediates;
        immediates.append(&mut el.immediate_tasks);
        el.immediate_tasks = immediates;
    }
    // SAFETY: per fn contract.
    unsafe { (*vm).timer_unpark_after_run(outer_start) };

    // Foreign I/O that became ready during the run reports again from the next
    // poll, to its owner (or stays held if still foreign to an outer run). The
    // uws loop mirrors only nested runs (the root holds nothing).
    let mirrored_outer_start = if outer_is_root { 0 } else { outer_start };
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
            (*uws_loop).domain_run_ended(mirrored_outer_start, outer_executes_scripts);
        }
    }

    RUNS.with_borrow_mut(|runs| {
        runs.pop();
    });
    run_epoch::pop_run(outer_start, outer_executes_scripts);
    // SAFETY: per fn contract.
    unsafe {
        match policy {
            Policy::NativeAndScripts => Bun__Domain__exitRun((*vm).global),
            Policy::Native => (*vm).suppress_microtask_drain.set(suppressed_before),
        }
    }
}

/// bun:jsc `runUntilInDomainForTesting(thunk)`: enter a script-running run,
/// call `thunk` (it returns a promise the run created), and turn the loop until
/// the promise settles or `timeout_ms` elapses. Returns the promise.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Domain__runUntilInDomainForTesting(
    global: &JSGlobalObject,
    thunk: JSValue,
    timeout_ms: u32,
) -> JSValue {
    let vm = global.bun_vm_ptr();
    // SAFETY: `vm` is the live per-thread VM owning `global`.
    let run = unsafe { DomainRun::enter(vm, Policy::NativeAndScripts) };
    let Ok(result) = thunk.call(global, JSValue::UNDEFINED, &[]) else {
        return JSValue::ZERO;
    };
    run.begin_loop_phase();
    let _keep = crate::Strong::create(result, global);
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
