// One sink for what upstream does with panic, debug.Assert, a failed type assertion, a nil dereference and the runtime's own panics.
use std::cell::{Cell, RefCell};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaultKind {
    Panic,
    Assert,
    BadCast,
    WriteToFrozen,
    NilWrite,
    NilMapWrite,
    IndexOutOfRange,
    IdSpaceExhausted,
    StoreBusy,
    TwoParents,
    StackLimit,
    LoopLimit,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fault {
    pub kind: FaultKind,
    // Upstream's message, or the name of the accessor.
    pub message: &'static str,
    // The value upstream appends to the message (a Kind), else 0.
    pub detail: u32,
    // The id that the access was made through, or the node that the checker was checking.
    pub id: u32,
}

#[derive(Default)]
pub struct Faults {
    count: Cell<u32>,
    kept: RefCell<Vec<Fault>>,
}

impl Faults {
    pub const MAX_KEPT: usize = 64;
    pub fn record(&self, fault: Fault) {
        self.count.set(self.count.get().saturating_add(1));
        if let Ok(mut kept) = self.kept.try_borrow_mut() {
            if kept.len() < Self::MAX_KEPT {
                kept.push(fault);
            }
        }
    }
    pub fn count(&self) -> u32 {
        self.count.get()
    }
    pub fn first(&self) -> Option<Fault> {
        match self.kept.try_borrow() {
            Ok(kept) => kept.first().copied(),
            Err(_) => None,
        }
    }
    // The faults that were kept, oldest first: what a driver turns into internal diagnostics.
    pub fn snapshot(&self) -> Vec<Fault> {
        match self.kept.try_borrow() {
            Ok(kept) => kept.clone(),
            Err(_) => Vec::new(),
        }
    }
}

// Names of upstream functions that were entered before they were ported, with the number of entries.
#[derive(Default)]
pub struct StandInLog {
    entries: RefCell<Vec<(&'static str, u32)>>,
}

impl StandInLog {
    pub fn record(&self, name: &'static str) {
        let Ok(mut entries) = self.entries.try_borrow_mut() else {
            return;
        };
        match entries.iter_mut().find(|entry| entry.0 == name) {
            Some(entry) => entry.1 = entry.1.saturating_add(1),
            None => entries.push((name, 1)),
        }
    }
    pub fn is_empty(&self) -> bool {
        match self.entries.try_borrow() {
            Ok(entries) => entries.is_empty(),
            Err(_) => false,
        }
    }
    pub fn snapshot(&self) -> Vec<(&'static str, u32)> {
        match self.entries.try_borrow() {
            Ok(entries) => entries.clone(),
            Err(_) => Vec::new(),
        }
    }
}
