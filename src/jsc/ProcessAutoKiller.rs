use bun_collections::ArrayHashMap;
use bun_spawn::Process;
use bun_sys::SignalCode;

bun_output::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    // TODO(port): lifetime — keys are intrusively-refcounted *Process; consider
    // bun_ptr::IntrusiveRc<Process> once that type lands. Stored as raw ptr to
    // preserve identity-hash semantics of Zig AutoArrayHashMap.
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
        while let Some((process, ())) = self.processes.pop() {
            // SAFETY: every key in `processes` was ref()'d on insert and is live
            // until the matching deref() below.
            let p = unsafe { &*process };
            if !p.has_exited() {
                bun_output::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                count += p.kill(SignalCode::DEFAULT as i32).is_ok() as u32;
            }
            p.deref();
        }
        count
    }

    pub fn clear(&mut self) {
        for process in self.processes.keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { (**process).deref() };
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
            // Map key is identity (raw ptr) — see TODO(port) on the field.
            self.processes.insert(process, ());
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
                unsafe { (*process).deref() };
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
            unsafe { (**process).deref() };
        }
        // `self.processes` storage freed by its own Drop.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ProcessAutoKiller.zig (75 lines)
//   confidence: medium
//   todos:      1
//   notes:      Process keys are intrusive-refcounted raw ptrs; ref()/deref() method names (ref_/deref) and bun_spawn crate path may need adjusting in Phase B.
// ──────────────────────────────────────────────────────────────────────────
