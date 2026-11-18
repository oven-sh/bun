use super::block::{BLOCK_SIZE, Block};

/// Answers whether any word is the address of a block of the heap.
pub(super) struct BlockSet {
    /// Linear probing. Zero is an empty slot.
    slots: Vec<usize>,
    count: usize,
    /// The union of the bits of all addresses that have been added.
    filter: usize,
}

impl BlockSet {
    pub(super) fn new() -> BlockSet {
        BlockSet {
            slots: vec![0; 64],
            count: 0,
            filter: 0,
        }
    }

    #[inline(always)]
    fn home(&self, block: usize) -> usize {
        ((block / BLOCK_SIZE).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 24) & (self.slots.len() - 1)
    }

    pub(super) fn len(&self) -> usize {
        self.count
    }

    pub(super) fn add(&mut self, block: usize) {
        if (self.count + 1) * 2 > self.slots.len() {
            self.resize(self.slots.len() * 2);
        }
        let mut index = self.home(block);
        while self.slots[index] != 0 {
            index = (index + 1) & (self.slots.len() - 1);
        }
        self.slots[index] = block;
        self.count += 1;
        self.filter |= block;
    }

    pub(super) fn remove(&mut self, block: usize) {
        let mask = self.slots.len() - 1;
        let mut hole = self.home(block);
        while self.slots[hole] != block {
            assert!(self.slots[hole] != 0);
            hole = (hole + 1) & mask;
        }
        let mut index = (hole + 1) & mask;
        while self.slots[index] != 0 {
            let home = self.home(self.slots[index]);
            if index.wrapping_sub(home) & mask >= index.wrapping_sub(hole) & mask {
                self.slots[hole] = self.slots[index];
                hole = index;
            }
            index = (index + 1) & mask;
        }
        self.slots[hole] = 0;
        self.count -= 1;
        if self.count * 16 < self.slots.len() && self.slots.len() > 64 {
            self.resize(self.slots.len() / 4);
        }
    }

    fn resize(&mut self, capacity: usize) {
        let old = core::mem::replace(&mut self.slots, vec![0; capacity.max(64)]);
        (self.count, self.filter) = (0, 0);
        for block in old.into_iter().filter(|&block| block != 0) {
            self.add(block);
        }
    }

    #[inline(always)]
    pub(super) fn block_containing(&self, address: usize) -> Option<&'static Block> {
        let block = address & !(BLOCK_SIZE - 1);
        if block & !self.filter != 0 || block == 0 {
            return None;
        }
        let mut index = self.home(block);
        loop {
            match self.slots[index] {
                0 => return None,
                // SAFETY: a member of the set.
                found if found == block => return Some(unsafe { Block::containing(block) }),
                _ => index = (index + 1) & (self.slots.len() - 1),
            }
        }
    }
}
