// One sink for what upstream does with panic, a failed type assertion and a nil dereference.
use std::cell::Cell;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaultKind {
    Panic,
    BadCast,
    WriteToFrozen,
    NilWrite,
    NilMapWrite,
    IdSpaceExhausted,
    StoreBusy,
    TwoParents,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fault {
    pub kind: FaultKind,
    // Upstream's message, or the name of the accessor.
    pub message: &'static str,
    // The value upstream appends to the message (a Kind), else 0.
    pub detail: u32,
    // The id that the access was made through.
    pub id: u32,
}

#[derive(Default)]
pub struct Faults {
    count: Cell<u32>,
    first: Cell<Option<Fault>>,
}

impl Faults {
    pub fn record(&self, fault: Fault) {
        if self.count.get() == 0 {
            self.first.set(Some(fault));
        }
        self.count.set(self.count.get().saturating_add(1));
    }
    pub fn count(&self) -> u32 {
        self.count.get()
    }
    pub fn first(&self) -> Option<Fault> {
        self.first.get()
    }
}
