use bun_collections::ArrayHashMap;
use bun_collections::array_hash_map::{ArrayHashContext, AutoContext};
use bun_ptr::RefPtr;
use bun_spawn::Process;
use bun_sys::SignalCode;
use core::cell::Cell;

use crate::JsCell;

bun_core::declare_scope!(AutoKiller, hidden);

#[derive(Default)]
pub struct ProcessAutoKiller {
    /// Each tracked process maps to its spawn serial (see [`ProcessAutoKiller::mark`]).
    processes: JsCell<ArrayHashMap<RefPtr<Process>, u64, ByAddress>>,
    pub enabled: Cell<bool>,
    ever_enabled: Cell<bool>,
    next_serial: Cell<u64>,
}

#[derive(Default)]
struct ByAddress;

impl ArrayHashContext<RefPtr<Process>> for ByAddress {
    fn hash(&self, key: &RefPtr<Process>) -> u32 {
        AutoContext.hash(&key.as_ptr())
    }

    fn eql(&self, a: &RefPtr<Process>, b: &RefPtr<Process>, _: usize) -> bool {
        a.as_ptr() == b.as_ptr()
    }
}

impl ProcessAutoKiller {
    pub fn enable(&self) {
        self.enabled.set(true);
        self.ever_enabled.set(true);
    }

    pub fn disable(&self) {
        self.enabled.set(false);
    }

    pub(crate) fn kill(&self) -> Result {
        Result {
            processes: self.kill_processes(),
        }
    }

    /// The serial the next tracked process gets. Pass it to [`ProcessAutoKiller::kill_spawned_since`] to kill only the processes spawned after this call.
    pub fn mark(&self) -> u64 {
        self.next_serial.get()
    }

    /// Kills the tracked processes spawned since `mark` was taken, and keeps tracking the older ones.
    pub fn kill_spawned_since(&self, mark: u64) -> Result {
        let mut to_kill: Vec<RefPtr<Process>> = Vec::new();
        self.processes.with_mut(|processes| {
            processes.retain(|process, serial| {
                if *serial >= mark {
                    to_kill.push(process.clone());
                    false
                } else {
                    true
                }
            })
        });
        let mut count: u32 = 0;
        for p in to_kill {
            count += Self::kill_one(&p) as u32;
        }
        Result { processes: count }
    }

    fn kill_processes(&self) -> u32 {
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.with_mut(ArrayHashMap::pop) {
            count += Self::kill_one(&entry.key) as u32;
        }
        count
    }

    fn kill_one(p: &RefPtr<Process>) -> bool {
        if p.has_exited() {
            return false;
        }
        bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
        p.kill(SignalCode::DEFAULT.0).is_ok()
    }

    pub fn clear(&self) {
        self.processes.with_mut(|processes| {
            if processes.capacity() > 256 {
                processes.clear_and_free();
            }
            processes.clear();
        });
    }

    /// Registers a freshly spawned subprocess for auto-kill tracking.
    pub(crate) fn on_subprocess_spawn(&self, process: &RefPtr<Process>) {
        if self.enabled.get() {
            let serial = self.next_serial.get();
            self.next_serial.set(serial + 1);
            let _ = self.processes.with_mut(|p| p.put(process.clone(), serial));
        }
    }

    /// Removes an exited subprocess from auto-kill tracking.
    pub(crate) fn on_subprocess_exit(&self, process: &RefPtr<Process>) {
        if self.ever_enabled.get() {
            self.processes.with_mut(|p| p.swap_remove(process));
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct Result {
    pub processes: u32,
}
