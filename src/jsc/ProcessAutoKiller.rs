use bun_collections::ArrayHashMapCell;
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::cell::Cell;
use core::ptr::NonNull;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Intrusively-refcounted `Process`es by address (ref()'d on insert,
    /// deref()'d on remove/drop).
    processes: ArrayHashMapCell<usize, NonNull<Process>>,
    pub enabled: Cell<bool>,
    ever_enabled: Cell<bool>,
}

impl ProcessAutoKiller {
    pub fn enable(&self) {
        self.enabled.set(true);
        self.ever_enabled.set(true);
    }

    pub fn disable(&self) {
        self.enabled.set(false);
    }

    pub fn kill(&self) -> Result {
        Result {
            processes: self.kill_processes(),
        }
    }

    fn kill_processes(&self) -> u32 {
        let mut count: u32 = 0;
        for process in self.processes.take().values().iter().rev() {
            {
                // SAFETY: every value in `processes` was ref()'d on insert and is
                // live until the matching deref() below; nothing else borrows the
                // `Process` while this thread is here.
                let p: &mut Process = unsafe { &mut *process.as_ptr() };
                if !p.has_exited() {
                    bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                    count += p.kill(SignalCode::DEFAULT.0).is_ok() as u32;
                }
            }
            // SAFETY: live until this releases the ref taken on insert.
            unsafe { Process::deref(process.as_ptr()) };
        }
        count
    }

    pub fn clear(&self) {
        for process in self.processes.take().values() {
            // SAFETY: see kill_processes — live until deref().
            unsafe { Process::deref(process.as_ptr()) };
        }
    }

    /// Registers a freshly spawned subprocess for auto-kill tracking.
    pub(crate) fn on_subprocess_spawn(&self, process: NonNull<Process>) {
        if self.enabled.get() {
            // Alloc failure means we never took
            // a ref, so just bail. `put` here is fallible only on OOM.
            if self.processes.put(process.addr().get(), process).is_err() {
                return;
            }
            // SAFETY: caller passes a live Process; we take a ref to extend its
            // lifetime for as long as it sits in `processes`.
            unsafe { (*process.as_ptr()).ref_() };
        }
    }

    /// Removes an exited subprocess from auto-kill tracking, releasing the
    /// ref taken at spawn.
    pub(crate) fn on_subprocess_exit(&self, process: NonNull<Process>) {
        if self.ever_enabled.get() {
            if self.processes.swap_remove(process.addr().get()) {
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
        self.clear();
    }
}
