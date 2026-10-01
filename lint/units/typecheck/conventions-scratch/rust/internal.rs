// One sink for what upstream does with panic, debug.Assert, debug.Fail and the runtime's own panics.
use crate::ids::NodeId;
use std::cell::Cell;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaultKind {
    Panic,
    Assert,
    BadCast,
    NilMapWrite,
    WriteToBoundObject,
    StackLimit,
    IdSpaceExhausted,
}

#[derive(Clone, Copy, Debug)]
pub struct InternalFault {
    pub kind: FaultKind,
    // Upstream's message, verbatim.
    pub message: &'static str,
    // The value upstream appends to the message (a Kind, a token), else 0.
    pub detail: u32,
    // `currentNode` of the checker when the fault was recorded.
    pub node: NodeId,
}

#[derive(Default)]
pub struct InternalLog {
    faults: Cell<Vec<InternalFault>>,
    count: Cell<u32>,
}

impl InternalLog {
    pub const MAX_KEPT: usize = 64;
    pub fn record(&self, fault: InternalFault) {
        self.count.set(self.count.get().saturating_add(1));
        let mut faults = self.faults.take();
        if faults.len() < Self::MAX_KEPT {
            faults.push(fault);
        }
        self.faults.set(faults);
    }
    pub fn count(&self) -> u32 {
        self.count.get()
    }
    pub fn snapshot(&self) -> Vec<InternalFault> {
        let faults = self.faults.take();
        let copy = faults.clone();
        self.faults.set(faults);
        copy
    }
}

// Names of upstream functions that were entered before they were ported.
#[derive(Default)]
pub struct StandInLog {
    entries: Cell<Vec<(&'static str, u32)>>,
}

impl StandInLog {
    pub fn record(&self, name: &'static str) {
        let mut entries = self.entries.take();
        match entries.iter_mut().find(|entry| entry.0 == name) {
            Some(entry) => entry.1 = entry.1.saturating_add(1),
            None => entries.push((name, 1)),
        }
        self.entries.set(entries);
    }
    pub fn is_empty(&self) -> bool {
        let entries = self.entries.take();
        let empty = entries.is_empty();
        self.entries.set(entries);
        empty
    }
    pub fn snapshot(&self) -> Vec<(&'static str, u32)> {
        let entries = self.entries.take();
        let copy = entries.clone();
        self.entries.set(entries);
        copy
    }
}
