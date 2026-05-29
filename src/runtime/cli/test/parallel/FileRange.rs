//! Contiguous slice of `Coordinator.files` owned by a worker. Dispatching
//! pulls from the front (cache-hot region); stealing takes from the back
//! (furthest from the owner's hot region).

#[derive(Copy, Clone)]
pub struct FileRange {
    pub lo: u32,
    pub hi: u32,
}

impl FileRange {
    pub(crate) fn len(self) -> u32 {
        self.hi - self.lo
    }

    pub(crate) fn is_empty(self) -> bool {
        self.lo >= self.hi
    }

    pub(crate) fn pop_front(&mut self) -> Option<u32> {
        if self.is_empty() {
            return None;
        }
        let v = self.lo;
        self.lo += 1;
        Some(v)
    }

    pub(crate) fn steal_back_half(&mut self) -> Option<FileRange> {
        if self.is_empty() {
            return None;
        }
        let mid = self.lo + self.len() / 2;
        let stolen = FileRange {
            lo: mid,
            hi: self.hi,
        };
        self.hi = mid;
        Some(stolen)
    }
}

// ported from: src/cli/test/parallel/FileRange.zig
