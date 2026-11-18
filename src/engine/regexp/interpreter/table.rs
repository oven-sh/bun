//! A hash table that says what it costs.

const INITIAL_SLOTS: usize = 1 << 8;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(super) struct Key(u64, u64);

impl Key {
    /// The first is not zero.
    #[inline(always)]
    pub(super) fn new([a, b, c, d]: [u32; 4]) -> Key {
        let join = |high, low| u64::from(high) << 32 | u64::from(low);
        Key(join(a, b), join(c, d))
    }

    fn is_none(self) -> bool {
        self.0 == 0
    }
}

#[derive(Clone, Copy, Default)]
struct Slot {
    key: Key,
    value: u64,
}

#[derive(Default)]
pub(super) struct Table {
    slots: Vec<Slot>,
    taken: usize,
    /// Since it was last taken.
    pub(super) work: u64,
}

fn index_in(slots: &[Slot], key: Key) -> usize {
    const MULTIPLIER: u64 = 0x9e37_79b9_7f4a_7c15;
    let mixed = key.0.wrapping_mul(MULTIPLIER);
    let mixed = (mixed.rotate_left(32) ^ key.1).wrapping_mul(MULTIPLIER);
    let mut index = (mixed >> 32) as usize & (slots.len() - 1);
    while slots[index].key != key && !slots[index].key.is_none() {
        index = (index + 1) & (slots.len() - 1);
    }
    index
}

impl Table {
    pub(super) fn size(&self) -> usize {
        self.slots.capacity() * size_of::<Slot>()
    }

    pub(super) fn len(&self) -> usize {
        self.taken
    }

    /// Starts small again.
    pub(super) fn clear(&mut self) {
        self.slots.clear();
        self.taken = 0;
    }

    /// Whether two more keys can be added without moving the others.
    #[inline]
    pub(super) fn make_room(&mut self, max_size: usize) -> bool {
        (self.taken + 2) * 2 <= self.slots.len() || self.grow(max_size).is_some()
    }

    #[cold]
    fn grow(&mut self, max_size: usize) -> Option<()> {
        const WORK_PER_SLOT: u64 = 24;
        if self.slots.is_empty() {
            self.slots.try_reserve_exact(INITIAL_SLOTS).ok()?;
            self.slots.resize(INITIAL_SLOTS, Slot::default());
            self.work += INITIAL_SLOTS as u64;
            return Some(());
        }
        let length = self.slots.len() * 2;
        if length * size_of::<Slot>() > max_size {
            return None;
        }
        let mut slots = Vec::new();
        slots.try_reserve_exact(length).ok()?;
        slots.resize(length, Slot::default());
        for slot in self.slots.iter().filter(|it| !it.key.is_none()) {
            let index = index_in(&slots, slot.key);
            slots[index] = *slot;
        }
        self.slots = slots;
        self.work += length as u64 * WORK_PER_SLOT;
        Some(())
    }

    /// Removes all keys, and keeps the room for them.
    #[cold]
    pub(super) fn empty(&mut self) {
        self.slots.fill(Slot::default());
        self.taken = 0;
        self.work += self.slots.len() as u64;
    }

    /// The larger the table, the further away from the processor it is.
    fn work_of_search(&self) -> u64 {
        match self.slots.len().ilog2() {
            ..=13 => 32,
            14..=17 => 96,
            _ => 480,
        }
    }

    #[inline(always)]
    pub(super) fn has_at(&self, index: usize, key: Key) -> bool {
        self.slots.get(index).is_some_and(|it| it.key == key)
    }

    pub(super) fn find(&mut self, key: Key) -> Option<usize> {
        if self.slots.is_empty() {
            return None;
        }
        self.work += self.work_of_search();
        let index = index_in(&self.slots, key);
        self.has_at(index, key).then_some(index)
    }

    /// The value of a new key is zero. There is room.
    pub(super) fn find_or_add(&mut self, key: Key) -> usize {
        self.work += self.work_of_search();
        let index = index_in(&self.slots, key);
        if self.slots[index].key.is_none() {
            self.slots[index].key = key;
            self.taken += 1;
        }
        index
    }

    #[inline]
    pub(super) fn value(&mut self, index: usize) -> &mut u64 {
        &mut self.slots[index].value
    }
}
