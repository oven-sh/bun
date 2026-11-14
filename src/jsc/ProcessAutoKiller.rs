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
    processes: JsCell<ArrayHashMap<RefPtr<Process>, (), ByAddress>>,
    pub enabled: Cell<bool>,
    ever_enabled: Cell<bool>,
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

    pub fn kill(&self) -> Result {
        Result {
            processes: self.kill_processes(),
        }
    }

    fn kill_processes(&self) -> u32 {
        let mut count: u32 = 0;
        while let Some(entry) = self.processes.with_mut(ArrayHashMap::pop) {
            let p = entry.key;
            if !p.has_exited() {
                bun_core::scoped_log!(AutoKiller, "process.kill {}", p.pid);
                count += p.kill(SignalCode::DEFAULT.0).is_ok() as u32;
            }
        }
        count
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
            let _ = self.processes.with_mut(|p| p.put(process.clone(), ()));
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
