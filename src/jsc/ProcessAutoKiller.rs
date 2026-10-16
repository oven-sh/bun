use bun_collections::ArrayHashMap;
#[cfg(unix)]
use bun_core::{Timespec, TimespecMockMode};
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::ptr::NonNull;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Keys are intrusively-refcounted `*Process` (ref()'d on insert, deref()'d
    /// on remove/drop). Stored as raw ptr for identity-hash semantics.
    pub(crate) processes: ArrayHashMap<*mut Process, ()>,
    pub enabled: bool,
    pub(crate) ever_enabled: bool,
}

impl ProcessAutoKiller {
    /// How long a process that was sent SIGTERM has to exit before it is sent SIGKILL.
    pub const GRACE_MS: i64 = 500;

    pub fn enable(&mut self) {
        self.enabled = true;
        self.ever_enabled = true;
    }

    pub fn disable(&mut self) {
        self.enabled = false;
    }

    pub fn kill(&mut self) -> Result {
        Result {
            processes: self.kill_processes(),
        }
    }

    fn kill_processes(&mut self) -> u32 {
        let count = Self::terminate(self.processes.keys());
        while let Some(entry) = self.processes.pop() {
            #[cfg(unix)]
            {
                // SAFETY: every key in `processes` was ref()'d on insert and is
                // live until the matching deref() below; popped entry is
                // exclusively owned for this scope so `&mut Process` is unaliased.
                let p: &mut Process = unsafe { &mut *entry.key };
                if !p.has_ended() {
                    bun_core::scoped_log!(AutoKiller, "process.kill {} SIGKILL", p.pid);
                    let _ = p.kill(SignalCode::SIGKILL.0);
                }
            }
            // SAFETY: key live until this releases the ref taken on insert.
            unsafe { Process::deref(entry.key) };
        }
        count
    }

    /// Sends SIGTERM to each of `processes` that is still running, and returns how many. On POSIX a process can
    /// ignore that signal, so this then waits there until they have all ended, for at most [`Self::GRACE_MS`].
    fn terminate(processes: &[*mut Process]) -> u32 {
        let mut count: u32 = 0;
        for &process in processes {
            // SAFETY: every key in `processes` was ref()'d on insert and stays tracked for this
            // call, which runs no event loop turn; each `&mut Process` ends before the next.
            let p: &mut Process = unsafe { &mut *process };
            if !p.has_exited() {
                bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                count += p.kill(SignalCode::DEFAULT.0).is_ok() as u32;
            }
        }
        #[cfg(unix)]
        if count > 0 {
            let deadline = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, Self::GRACE_MS);
            for &process in processes {
                // SAFETY: as above.
                unsafe { &*process }.wait_until_ended(&deadline);
            }
        }
        count
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
            if self.processes.put(process.as_ptr(), ()).is_err() {
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
            if self.processes.swap_remove(&process.as_ptr()) {
                // SAFETY: we held a ref from on_subprocess_spawn; the pointee
                // is live until this deref() releases it.
                unsafe { Process::deref(process.as_ptr()) };
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
        for process in self.processes.keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(*process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}
