// SCRATCH STAND-IN, not delivered: Fault, FaultKind and Faults of the research contract (tscore/internal.rs), which sibling code imports from crate::internal.
use std::cell::{Cell, RefCell};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaultKind {
    Panic,
    Assert,
    BadCast,
    NilRead,
    NilWrite,
    NilMapWrite,
    WriteToFrozen,
    IdSpaceExhausted,
    StoreBusy,
    TwoParents,
    StackLimit,
    LoopLimit,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fault {
    pub kind: FaultKind,
    pub message: &'static str,
    pub detail: u32,
    pub id: u32,
}

#[derive(Default)]
pub struct Faults {
    count: Cell<u32>,
    first: Cell<Option<Fault>>,
    kept: RefCell<Vec<Fault>>,
}

impl Faults {
    pub const MAX_KEPT: usize = 64;
    pub fn record(&self, fault: Fault) {
        if self.count.get() == 0 {
            self.first.set(Some(fault));
        }
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
        self.first.get()
    }
    pub fn snapshot(&self) -> Vec<Fault> {
        match self.kept.try_borrow() {
            Ok(kept) => kept.clone(),
            Err(_) => Vec::new(),
        }
    }
}
