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
    /// Map value of each tracked process; the test runner begins a new one per test or hook callback.
    scope: u32,
    /// The scope of the last [`Self::kill_since`], which left the processes of earlier scopes alive.
    spared_until: Option<u32>,
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

    /// The current scope, as a mark for [`Self::kill_since`].
    pub fn scope(&self) -> u32 {
        self.scope
    }

    /// Every tracked process: for the `--isolate` swap between files, and where no cleanup hook is left to run.
    pub fn kill(&mut self) -> Result {
        self.spared_until = None;
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.pop() {
            count += Self::kill_and_release(entry.key);
        }
        Result { processes: count }
    }

    /// The processes of the current scope.
    pub fn kill_scope(&mut self) -> Result {
        self.kill_since(self.scope.wrapping_sub(1))
    }

    /// The processes of every scope begun after `mark` was read from [`Self::scope`]. Earlier scopes stay tracked for [`Self::kill_spared`] and [`Self::kill`].
    pub fn kill_since(&mut self, mark: u32) -> Result {
        self.spared_until = Some(self.scope);
        self.kill_where(mark, false)
    }

    /// The processes that [`Self::kill_since`] left alive: those of the scopes up to its last call.
    pub fn kill_spared(&mut self) -> Result {
        match self.spared_until.take() {
            Some(mark) => self.kill_where(mark, true),
            None => Result { processes: 0 },
        }
    }

    /// The scopes begun after `mark`, or with `up_to` the scopes up to `mark`.
    fn kill_where(&mut self, mark: u32, up_to: bool) -> Result {
        let span = self.scope.wrapping_sub(mark);
        let mut count: u32 = 0;
        let mut index = self.processes.len();
        while index > 0 {
            index -= 1;
            if (self.scope.wrapping_sub(self.processes.values()[index]) >= span) != up_to {
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
        self.spared_until = None;
        for process in self.processes.keys() {
            // SAFETY: see kill_and_release: key is live until deref().
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
            // SAFETY: see kill_and_release: key is live until deref().
            unsafe { Process::deref(*process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}
