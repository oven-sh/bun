use bun_collections::ArrayHashMap;
use bun_spawn::Process;
use bun_sys::SignalCode;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Keys are intrusively-refcounted `*Process` (ref()'d on insert, deref()'d
    /// on remove/drop). Stored as raw ptr to preserve identity-hash semantics
    /// of Zig `AutoArrayHashMap(*Process, void)`.
    pub processes: ArrayHashMap<*mut Process, ()>,
    pub enabled: bool,
    pub ever_enabled: bool,
}

impl ProcessAutoKiller {
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
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.pop() {
            {
                // SAFETY: every key in `processes` was ref()'d on insert and is
                // live until the matching deref() below; popped entry is
                // exclusively owned for this scope so `&mut Process` is unaliased.
                let p: &mut Process = unsafe { &mut *entry.key };
                if !p.has_exited() {
                    bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                    count += p.kill(SignalCode::DEFAULT.0).is_ok() as u32;
                }
            }
            // SAFETY: key live until this releases the ref taken on insert.
            unsafe { Process::deref(entry.key) };
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

    /// Spec: `onSubprocessSpawn(*ProcessAutoKiller, *bun.spawn.Process)`.
    /// Takes a raw `*mut Process` (not `&Process`) to preserve Zig's pointer
    /// identity semantics for the map key without a const→mut provenance cast.
    pub fn on_subprocess_spawn(&mut self, process: *mut Process) {
        if self.enabled {
            // Zig: `put(...) catch return` — alloc failure means we never took
            // a ref, so just bail. `put` here is fallible only on OOM.
            if self.processes.put(process, ()).is_err() {
                return;
            }
            // SAFETY: caller passes a live Process; we take a ref to extend its
            // lifetime for as long as it sits in `processes`.
            unsafe { (*process).ref_() };
        }
    }

    /// Spec: `onSubprocessExit(*ProcessAutoKiller, *bun.spawn.Process)`.
    pub fn on_subprocess_exit(&mut self, process: *mut Process) {
        if self.ever_enabled {
            if self.processes.swap_remove(&process) {
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
        for process in self.processes.keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(*process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}

// ported from: src/jsc/ProcessAutoKiller.zig
