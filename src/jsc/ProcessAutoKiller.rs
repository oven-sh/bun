use bun_collections::ArrayHashMap;
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::ptr::NonNull;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Keys are intrusively-refcounted `*Process` (ref()'d on insert, deref()'d
    /// on remove/drop). Stored as raw ptr for identity-hash semantics.
    pub(crate) processes: ArrayHashMap<*mut Process, u32>,
    pub enabled: bool,
    pub(crate) ever_enabled: bool,
    /// Map value of each tracked process; the test runner begins a new one per execution group.
    scope: u32,
}

impl ProcessAutoKiller {
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

    pub fn kill(&mut self) -> Result {
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.pop() {
            count += Self::kill_and_release(entry.key);
        }
        Result { processes: count }
    }

    /// Earlier scopes stay tracked (and alive) so that [`Self::kill`] still covers them.
    pub fn kill_scope(&mut self) -> Result {
        let mut count: u32 = 0;
        let mut index = self.processes.len();
        while index > 0 {
            index -= 1;
            if self.processes.values()[index] != self.scope {
                continue;
            }
            // Walking backwards, so the entry swapped into `index` was already visited.
            let (process, _) = self.processes.swap_remove_at(index);
            count += Self::kill_and_release(process);
        }
        Result { processes: count }
    }

    /// `process` must already be removed from `processes`; this releases its ref.
    fn kill_and_release(process: *mut Process) -> u32 {
        let killed = {
            // SAFETY: every key in `processes` was ref()'d on insert and is
            // live until the matching deref() below; the entry was removed
            // from the map by the caller, so `&mut Process` is unaliased.
            let p: &mut Process = unsafe { &mut *process };
            if p.has_exited() {
                false
            } else {
                bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                p.kill(SignalCode::DEFAULT.0).is_ok()
            }
        };
        // SAFETY: key live until this releases the ref taken on insert.
        unsafe { Process::deref(process) };
        killed as u32
    }

    pub fn clear(&mut self) {
        for process in self.processes.keys() {
            // SAFETY: see kill_and_release — key is live until deref().
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
            // SAFETY: see kill_and_release — key is live until deref().
            unsafe { Process::deref(*process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}
