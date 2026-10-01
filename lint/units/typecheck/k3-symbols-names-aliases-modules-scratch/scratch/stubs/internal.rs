// One sink for what upstream does with panic, debug.Assert, a failed type assertion, a nil dereference and an endless loop.
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
    // Upstream's message, or the name of the accessor.
    pub message: &'static str,
    // The value upstream appends to the message (a Kind), else 0.
    pub detail: u32,
    // The id that the access was made through, or `currentNode` of the checker.
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
    // The first MAX_KEPT faults, in the order they were recorded.
    pub fn snapshot(&self) -> Vec<Fault> {
        match self.kept.try_borrow() {
            Ok(kept) => kept.clone(),
            Err(_) => Vec::new(),
        }
    }
}

// Names of upstream functions that were entered before they were ported, with the number of entries.
#[derive(Default)]
pub struct StandIns {
    entries: RefCell<Vec<(&'static str, u32)>>,
}

impl StandIns {
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
        self.entries.try_borrow().is_ok_and(|e| e.is_empty())
    }
    pub fn count_of(&self, name: &str) -> u32 {
        match self.entries.try_borrow() {
            Ok(entries) => entries
                .iter()
                .find(|entry| entry.0 == name)
                .map_or(0, |entry| entry.1),
            Err(_) => 0,
        }
    }
    // In the order of the first entry of each function.
    pub fn snapshot(&self) -> Vec<(&'static str, u32)> {
        match self.entries.try_borrow() {
            Ok(entries) => entries.clone(),
            Err(_) => Vec::new(),
        }
    }
}

// The budget of a loop whose end depends on checker state and not on the syntax tree or a list.
pub const LOOP_LIMIT: u32 = 1 << 20;

#[derive(Clone, Copy)]
pub struct LoopGuard {
    left: u32,
}

impl Default for LoopGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl LoopGuard {
    pub const fn new() -> Self {
        Self { left: LOOP_LIMIT }
    }
    pub const fn with_limit(limit: u32) -> Self {
        Self { left: limit }
    }
    // False once the budget is spent: the caller records LoopLimit and leaves the loop as upstream's `break` does.
    #[must_use]
    pub fn turn(&mut self) -> bool {
        if self.left == 0 {
            return false;
        }
        self.left -= 1;
        true
    }
}
