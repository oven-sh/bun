//! Per-VM registry of in-flight abortable transfers (JS-thread only).
//!
//! Producers whose completion can take arbitrarily long (network transfers)
//! register an abort action at creation and unregister when the JS side
//! consumes the completion. Worker terminate / process exit drains the
//! registry so the transfer finishes promptly and the producer's shutdown
//! gate pin drops — bounding how long the gate close waits.

/// See the module docs. Entries are keyed by the producer's allocation
/// address so normal completion can remove its own entry.
#[derive(Default)]
pub struct TerminateAbortRegistry {
    entries: Vec<Entry>,
}

struct Entry {
    key: usize,
    abort: Box<dyn FnOnce()>,
}

impl TerminateAbortRegistry {
    /// Register `abort` under `key` (the producer's allocation). The action
    /// runs at most once, on the JS thread, with the VM alive; it must not
    /// free `key`'s allocation (the producer's own lifecycle does that).
    pub fn register<T>(&mut self, key: *mut T, abort: impl FnOnce() + 'static) {
        self.entries.push(Entry {
            key: key as usize,
            abort: Box::new(abort),
        });
    }

    /// Drop the entry registered under `key`, if the shutdown walk has not
    /// already consumed it. Returns whether an entry was removed.
    pub fn unregister<T>(&mut self, key: *mut T) -> bool {
        let key = key as usize;
        let Some(i) = self.entries.iter().position(|e| e.key == key) else {
            return false;
        };
        self.entries.swap_remove(i);
        true
    }

    /// Take every registered abort action, leaving the registry empty.
    /// Callers loop until a take yields nothing: an abort can run user JS
    /// that registers new transfers.
    pub fn take_all(&mut self) -> Vec<Box<dyn FnOnce()>> {
        core::mem::take(&mut self.entries)
            .into_iter()
            .map(|e| e.abort)
            .collect()
    }
}
