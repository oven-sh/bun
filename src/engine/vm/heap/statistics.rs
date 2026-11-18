//! How much is in the heap.

use super::{BLOCK_SIZE, Heap};

impl Heap {
    pub fn block_bytes(&self) -> usize {
        self.blocks.borrow().len() * BLOCK_SIZE + self.precise_bytes.get()
    }

    pub fn capacity(&self) -> usize {
        self.block_bytes().saturating_add(self.extra_memory_size())
    }

    /// Of what the last collection has left.
    pub fn size(&self) -> usize {
        (self.policy.old_cell_bytes()).saturating_add(self.extra_memory_size())
    }

    /// As above.
    pub fn object_count(&self) -> usize {
        let (precise, marks) = (self.precise.borrow(), self.last_marks());
        let mut count = precise.iter().filter(|it| it.has_survived(marks)).count();
        self.for_each_directory(|directory| count += directory.mark_count());
        count
    }
}
