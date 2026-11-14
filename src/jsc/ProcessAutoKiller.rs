use bun_collections::ArrayHashMap;
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::cell::Cell;
use core::ptr::NonNull;

use crate::JsCell;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Keys are intrusively-refcounted `*Process` (ref()'d on insert, deref()'d
    /// on remove/drop). Stored as raw ptr for identity-hash semantics.
    processes: JsCell<ArrayHashMap<*mut Process, ()>>,
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
        while let Some(entry) = self.processes.with_mut(ArrayHashMap::pop) {
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

    pub fn clear(&self) {
        for process in self.processes.get().keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(*process) };
        }

        self.processes.with_mut(|processes| {
            if processes.capacity() > 256 {
                processes.clear_and_free();
            }
            processes.clear();
        });
    }

    /// Registers a freshly spawned subprocess for auto-kill tracking.
    /// Takes a raw `*mut Process` (not `&Process`) to preserve pointer
    /// identity semantics for the map key without a const→mut provenance cast.
    pub(crate) fn on_subprocess_spawn(&self, process: NonNull<Process>) {
        if self.enabled.get() {
            // Alloc failure means we never took
            // a ref, so just bail. `put` here is fallible only on OOM.
            if self
                .processes
                .with_mut(|p| p.put(process.as_ptr(), ()))
                .is_err()
            {
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
            if self
                .processes
                .with_mut(|p| p.swap_remove(&process.as_ptr()))
            {
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
        for process in self.processes.get().keys() {
            // SAFETY: see kill_processes — key is live until deref().
            unsafe { Process::deref(*process) };
        }
        // `self.processes` storage freed by its own Drop.
    }
}
