const MIN_CAPACITY: usize = 4096;
/// So that a few bytes after a long body do not double it.
const SPARE_CAPACITY: usize = 12;

/// Bytes that leave from the front without moving the others.
#[derive(Default)]
pub struct Queue {
    bytes: Vec<u8>,
    head: usize,
}

impl Queue {
    pub fn len(&self) -> usize {
        self.bytes.len() - self.head
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn capacity(&self) -> usize {
        self.bytes.capacity()
    }

    pub fn as_slice(&self) -> &[u8] {
        self.bytes.get(self.head..).unwrap_or_default()
    }

    /// Returns what to append to.
    pub fn reserve(&mut self, additional: usize) -> &mut Vec<u8> {
        if additional > self.bytes.capacity() - self.bytes.len() {
            self.make_room(additional);
        }
        &mut self.bytes
    }

    #[cold]
    fn make_room(&mut self, additional: usize) {
        let needed = self.len() + additional;
        if needed <= self.capacity() {
            self.bytes.drain(..self.head);
        } else {
            let capacity = (needed + SPARE_CAPACITY).max(self.capacity() * 2);
            let capacity = capacity.max(MIN_CAPACITY);
            if self.head == 0 {
                return self.bytes.reserve_exact(capacity - self.bytes.len());
            }
            let mut bytes = Vec::with_capacity(capacity);
            bytes.extend_from_slice(self.as_slice());
            self.bytes = bytes;
        }
        self.head = 0;
    }

    pub fn append(&mut self, bytes: &[u8]) {
        self.reserve(bytes.len()).extend_from_slice(bytes);
    }

    /// Keeps the allocation.
    pub fn consume(&mut self, len: usize) {
        self.head += len;
        if self.is_empty() {
            self.bytes.clear();
            self.head = 0;
        }
    }

    /// Frees the allocation with the last byte.
    pub fn erase(&mut self, len: usize) {
        self.head += len;
        if self.is_empty() {
            *self = Self::default();
        }
    }
}
