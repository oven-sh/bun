// checker.go 14075-14084 (c21_resolved_symbols_diagnostics): deferred diagnostics.
use crate::checker::checker::{Checker, Deferred};

impl<'a> Checker<'a> {
    pub fn add_deferred_diagnostic(&mut self, callback: Deferred<'a>) {
        self.deferred_diagnostic_callbacks.push(callback);
    }

    pub fn produce_deferred_diagnostics(&mut self) {
        // `range` reads the slice once: a callback added by a callback is not run, and the assignment drops it.
        let callbacks = std::mem::take(&mut self.deferred_diagnostic_callbacks);
        for cb in callbacks {
            cb(self);
        }
        self.deferred_diagnostic_callbacks = Vec::new();
    }
}
