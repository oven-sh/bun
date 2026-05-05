//! Contiguous slice of `Coordinator.files` owned by a worker. Dispatching
//! pulls from the front (cache-hot region); stealing takes from the back
//! (furthest from the owner's hot region).

#[derive(Copy, Clone)]
pub struct FileRange {
    pub lo: u32,
    pub hi: u32,
}

impl FileRange {
    pub fn len(self) -> u32 {
        self.hi - self.lo
    }

    pub fn is_empty(self) -> bool {
        self.lo >= self.hi
    }

    pub fn pop_front(&mut self) -> Option<u32> {
        if self.is_empty() {
            return None;
        }
        let v = self.lo;
        self.lo += 1;
        Some(v)
    }

    /// Take the back half as a new contiguous range for the thief, leaving the
    /// owner the front half. The thief then walks its stolen block forward via
    /// pop_front, so both workers keep directory locality. For len()==1 the
    /// single file goes to the thief (owner is either already inflight or was
    /// never spawned).
    pub fn steal_back_half(&mut self) -> Option<FileRange> {
        if self.is_empty() {
            return None;
        }
        let mid = self.lo + self.len() / 2;
        let stolen = FileRange { lo: mid, hi: self.hi };
        self.hi = mid;
        Some(stolen)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/FileRange.zig (32 lines)
//   confidence: high
//   todos:      0
//   notes:      plain POD struct; defer in pop_front reshaped to local + post-increment
// ──────────────────────────────────────────────────────────────────────────
