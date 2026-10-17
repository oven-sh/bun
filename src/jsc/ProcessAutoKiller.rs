use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::ptr::NonNull;

use crate::virtual_machine::VirtualMachine;

bun_core::declare_scope!(AutoKiller, hidden);

pub struct ProcessAutoKiller {
    /// Keys are intrusively-refcounted `*Process` (ref()'d on insert, deref()'d
    /// on remove/drop). Stored as raw ptr for identity-hash semantics.
    /// The value is the `scope` the process was spawned in.
    pub(crate) processes: ArrayHashMap<*mut Process, u32>,
    pub enabled: bool,
    pub(crate) ever_enabled: bool,
    /// The test runner begins a new one for each test and hook callback.
    scope: u32,
    /// What a timed-out callback spawned, was sent SIGTERM and has not exited, oldest first. Each
    /// keeps the ref it had in `processes` until it exits, is sent SIGKILL, or Bun exits.
    terminating: Vec<Terminating>,
    /// Armed no later than the first `kill_at` of `terminating`.
    timer: EventLoopTimer,
}

struct Terminating {
    process: *mut Process,
    /// `GRACE_MS` after its SIGTERM.
    kill_at: Timespec,
}

bun_event_loop::impl_timer_owner!(ProcessAutoKiller; from_timer_ptr => timer);

impl Default for ProcessAutoKiller {
    fn default() -> Self {
        Self {
            processes: ArrayHashMap::default(),
            enabled: false,
            ever_enabled: false,
            scope: 0,
            terminating: Vec::new(),
            timer: EventLoopTimer::init_paused(TimerTag::ProcessAutoKiller),
        }
    }
}

impl ProcessAutoKiller {
    /// How long a process has to exit after a timeout sent it SIGTERM, before it is sent SIGKILL.
    pub const GRACE_MS: i64 = 500;

    pub fn enable(&mut self) {
        self.enabled = true;
        self.ever_enabled = true;
    }

    pub fn disable(&mut self) {
        self.enabled = false;
    }

    pub fn begin_scope(&mut self) {
        self.scope = self.scope.wrapping_add(1);
    }

    /// One SIGTERM to every tracked process: for the `--isolate` swap between files.
    pub fn kill(&mut self) -> Result {
        Result {
            processes: self.kill_processes(None),
        }
    }

    /// A test or hook callback timed out. One SIGTERM to every tracked process, as [`Self::kill`].
    /// A process can ignore that on POSIX, so what the callback spawned itself stays ref'd, and
    /// is sent SIGKILL if it is still running `GRACE_MS` later: from `vm`'s event loop, or from
    /// [`Self::finish_before_exit`] when Bun exits first.
    ///
    /// # Safety
    /// `self` is `vm.auto_killer`, and this is `vm`'s JS thread.
    pub unsafe fn kill_on_timeout(&mut self, vm: *mut VirtualMachine) -> Result {
        // The real clock: the grace period is Bun's, not the test's.
        let kill_at = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, Self::GRACE_MS);
        let count = self.kill_processes(Some((self.scope, kill_at)));
        // SAFETY: per fn contract.
        unsafe { self.arm_timer(vm) };
        Result { processes: count }
    }

    /// # Safety
    /// As [`Self::kill_on_timeout`].
    unsafe fn arm_timer(&mut self, vm: *mut VirtualMachine) {
        let Some(first) = self.terminating.first() else {
            return;
        };
        // Armed already: for `first`, or for one before it that has exited since.
        if self.timer.state == TimerState::ACTIVE {
            return;
        }
        self.timer.next = first.kill_at;
        // SAFETY: per fn contract, the node is address-stable while it is linked.
        unsafe { VirtualMachine::timer_insert(vm, &raw mut self.timer) };
    }

    /// `own`: the scope whose processes are sent SIGKILL at the `Timespec` if they are still running.
    fn kill_processes(&mut self, own: Option<(u32, Timespec)>) -> u32 {
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.pop() {
            {
                // SAFETY: every key in `processes` was ref()'d on insert and is
                // live until the matching deref() below; popped entry is
                // exclusively owned for this scope so `&mut Process` is unaliased.
                let p: &mut Process = unsafe { &mut *entry.key };
                if !p.has_exited() {
                    bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                    let asked = p.kill(SignalCode::DEFAULT.0).is_ok();
                    count += asked as u32;
                    if let Some((scope, kill_at)) = own {
                        if asked && scope == entry.value && Self::can_force_kill(p) {
                            // Its ref moves to `terminating`.
                            self.terminating.push(Terminating {
                                process: entry.key,
                                kill_at,
                            });
                            continue;
                        }
                    }
                }
            }
            // SAFETY: key live until this releases the ref taken on insert.
            unsafe { Process::deref(entry.key) };
        }
        count
    }

    /// Whether a second signal can go to `process` when it ignores the first.
    fn can_force_kill(process: &Process) -> bool {
        // Windows ends the process on the first one. A waiter thread reaps off this thread, so the
        // pid can be another process's before `status` says so. In no-orphans mode the exit
        // sweep ends the process with its descendants, which a SIGKILL now would orphan.
        #[cfg(unix)]
        {
            matches!(process.poller, bun_spawn::process::Poller::Fd(_))
                && !bun_io::ParentDeathWatchdog::is_enabled()
        }
        #[cfg(not(unix))]
        {
            let _ = process;
            false
        }
    }

    /// SIGKILL to those of `terminating` whose grace period is over at `now`, and their refs released.
    fn kill_due(&mut self, now: &Timespec) {
        let due = self
            .terminating
            .partition_point(|waiting| !waiting.kill_at.greater(now));
        for Terminating { process, .. } in self.terminating.drain(..due) {
            // SAFETY: ref'd by `terminating` until the deref below; nothing else borrows it.
            let p: &mut Process = unsafe { &mut *process };
            if !p.has_exited() && Self::can_force_kill(p) {
                bun_core::scoped_log!(AutoKiller, "process.kill {} SIGKILL", p.pid);
                let _ = p.kill(SignalCode::SIGKILL.0);
            }
            // SAFETY: releases the ref that `kill_processes` left with `terminating`.
            unsafe { Process::deref(process) };
        }
    }

    /// `Tag::ProcessAutoKiller` fire body.
    ///
    /// # Safety
    /// As [`Self::kill_on_timeout`].
    pub unsafe fn on_timer(&mut self, vm: *mut VirtualMachine) {
        self.timer.state = TimerState::FIRED;
        self.kill_due(&Timespec::now(TimespecMockMode::ForceRealTime));
        // SAFETY: per fn contract.
        unsafe { self.arm_timer(vm) };
    }

    /// Bun is about to exit, so `timer` cannot fire any more. Gives each of `terminating` the rest
    /// of its grace period, then sends it SIGKILL. Turns no event loop and runs no exit handler.
    pub fn finish_before_exit(&mut self) {
        #[cfg(unix)]
        {
            let mut step_ms: i64 = 1;
            while !self.terminating.is_empty() {
                self.terminating.retain(|waiting| {
                    // SAFETY: ref'd by `terminating`.
                    let p = unsafe { &*waiting.process };
                    let ended = p.has_exited() || !Self::can_force_kill(p) || {
                        let mut status: core::ffi::c_int = 0;
                        // This reaps the child, which is fine: nothing else waits for it any more.
                        // SAFETY: `status` is a valid out-pointer.
                        unsafe { libc::waitpid(p.pid, &raw mut status, libc::WNOHANG) != 0 }
                    };
                    if ended {
                        // SAFETY: releases the ref that `kill_processes` left with `terminating`.
                        unsafe { Process::deref(waiting.process) };
                    }
                    !ended
                });
                let now = Timespec::now(TimespecMockMode::ForceRealTime);
                self.kill_due(&now);
                let Some(first) = self.terminating.first() else {
                    return;
                };
                let remaining_ms = first.kill_at.duration(&now).ms().max(1);
                std::thread::sleep(std::time::Duration::from_millis(
                    step_ms.min(remaining_ms).unsigned_abs(),
                ));
                step_ms = (step_ms * 2).min(16);
            }
        }
    }

    pub fn clear(&mut self) {
        for process in self.processes.keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(*process) };
        }

        if self.processes.capacity() > 256 {
            self.processes.clear_and_free();
        }

        self.processes.clear();
    }

    /// Registers a freshly spawned subprocess for auto-kill tracking.
    /// Takes a raw `*mut Process` (not `&Process`) to preserve pointer
    /// identity semantics for the map key without a const→mut provenance cast.
    pub(crate) fn on_subprocess_spawn(&mut self, process: NonNull<Process>) {
        if self.enabled {
            // Alloc failure means we never took
            // a ref, so just bail. `put` here is fallible only on OOM.
            if self.processes.put(process.as_ptr(), self.scope).is_err() {
                return;
            }
            // SAFETY: caller passes a live Process; we take a ref to extend its
            // lifetime for as long as it sits in `processes`.
            unsafe { (*process.as_ptr()).ref_() };
        }
    }

    /// Removes an exited subprocess from auto-kill tracking, releasing the
    /// ref taken at spawn.
    pub(crate) fn on_subprocess_exit(&mut self, process: NonNull<Process>) {
        if self.ever_enabled {
            let process = process.as_ptr();
            let terminating = &mut self.terminating;
            if self.processes.swap_remove(&process)
                || terminating
                    .iter()
                    .position(|waiting| waiting.process == process)
                    .map(|index| terminating.remove(index))
                    .is_some()
            {
                // SAFETY: we held a ref from on_subprocess_spawn; the pointee
                // is live until this deref() releases it.
                unsafe { Process::deref(process) };
            }
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct Result {
    pub processes: u32,
}

impl Drop for ProcessAutoKiller {
    fn drop(&mut self) {
        let terminating = self.terminating.iter().map(|waiting| waiting.process);
        for process in self.processes.keys().iter().copied().chain(terminating) {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}
