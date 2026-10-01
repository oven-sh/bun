// One sink for what upstream does with panic, debug.Assert, and the runtime's own panics (nil, bad cast).
use std::cell::Cell;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaultKind {
    Panic,
    NilRead,
    BadCast,
    WriteToBoundObject,
    IdSpaceExhausted,
    SharedNode,
    BuilderMisuse,
}

#[derive(Clone, Copy, Debug)]
pub struct InternalFault {
    pub kind: FaultKind,
    // Upstream's message, verbatim, or the name of the accessor.
    pub message: &'static str,
    // The value upstream appends to the message (a Kind), or the id that was read.
    pub detail: u32,
}

#[derive(Default)]
pub struct InternalLog {
    faults: Cell<Vec<InternalFault>>,
    count: Cell<u32>,
}

impl InternalLog {
    pub const MAX_KEPT: usize = 64;
    #[cold]
    pub fn record(&self, kind: FaultKind, message: &'static str, detail: u32) {
        self.count.set(self.count.get().saturating_add(1));
        let mut faults = self.faults.take();
        if faults.len() < Self::MAX_KEPT {
            faults.push(InternalFault {
                kind,
                message,
                detail,
            });
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
