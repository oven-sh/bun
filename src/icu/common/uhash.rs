//! A hash table whose iteration order shows in results, so each probe and rehash counts. ICU4C: uhash.cpp, hash.h

use crate::common::memory::{try_filled, try_push, try_to_vec};
use crate::common::slice_ext::{SliceExt, SoftUnwrap, slices_equal};
use crate::common::utypes::{U_MEMORY_ALLOCATION_ERROR, UErrorCode};

const PRIMES: [usize; 29] = [
    7, 13, 31, 61, 127, 251, 509, 1021, 2039, 4093, 8191, 16381, 32749, 65521, 131071, 262139,
    524287, 1048573, 2097143, 4194301, 8388593, 16777213, 33554393, 67108859, 134217689, 268435399,
    536870909, 1073741789, 2147483647,
];

/// `PRIMES[DEFAULT_PRIME_INDEX]`
const DEFAULT_SIZE: usize = 127;

const OCCUPIED: u32 = 0x8000_0000;

#[derive(Clone, Copy, Default)]
struct Slot {
    /// The hash code with `OCCUPIED` set, or 0 if empty.
    code: u32,
    entry: u32,
}

impl Slot {
    fn is_occupied(self) -> bool {
        self.code >= OCCUPIED
    }
}

/// The slots of a `UHashtable`. They hold indexes into a list of entries that the owner keeps.
#[derive(Default)]
struct Slots {
    /// An empty list stands for `DEFAULT_SIZE` empty slots.
    slots: Vec<Slot>,
    count: usize,
}

impl Slots {
    fn empty_slots(size: usize) -> Result<Vec<Slot>, UErrorCode> {
        try_filled(
            Slot::default(),
            PRIMES
                .into_iter()
                .find(|&prime| prime >= size)
                .soft_unwrap(),
        )
    }

    /// Visits every slot, because the length is prime.
    fn probe_sequence(&self, code: u32) -> impl Iterator<Item = usize> + use<> {
        let (hash, length) = ((code & !OCCUPIED) as usize, self.slots.len().max(2));
        let jump = hash % (length - 1) + 1;
        let first = (hash ^ 0x400_0000) % length;
        std::iter::successors(Some(first), move |index| Some((index + jump) % length))
            .take(self.slots.len())
    }

    fn find_slot(&self, hash: i32, matches: &dyn Fn(usize) -> bool) -> Option<(usize, Slot)> {
        let code = hash as u32 | OCCUPIED;
        let mut used = self
            .probe_sequence(code)
            .map(|index| (index, self.slots.at(index)))
            .take_while(|(_, slot)| slot.is_occupied());
        used.find(|(_, slot)| slot.code == code && matches(slot.entry as usize))
    }

    pub(crate) fn find(&self, hash: i32, matches: &dyn Fn(usize) -> bool) -> Option<usize> {
        self.find_slot(hash, matches)
            .map(|(_, slot)| slot.entry as usize)
    }

    /// `highWaterMark` is a `float`, which rounds for large tables.
    fn needs_rehash(&self) -> bool {
        self.slots.is_empty() || self.count > (self.slots.len() as f32 * 0.5) as usize
    }

    /// Makes room for one more entry.
    pub(crate) fn reserve_one(&mut self) -> Result<(), UErrorCode> {
        if self.needs_rehash() {
            let size = if self.slots.is_empty() {
                DEFAULT_SIZE
            } else {
                self.slots.len() + 1
            };
            let old = std::mem::replace(&mut self.slots, Self::empty_slots(size)?);
            old.into_iter()
                .rev()
                .filter(|slot| slot.is_occupied())
                .for_each(|slot| self.place(slot));
        }
        Ok(())
    }

    /// Inserts an entry that does not exist yet. Call `reserve_one` first.
    pub(crate) fn insert(&mut self, hash: i32, entry: usize) {
        self.place(Slot {
            code: hash as u32 | OCCUPIED,
            entry: entry as u32,
        });
        self.count += 1;
    }

    fn place(&mut self, slot: Slot) {
        let free = self
            .probe_sequence(slot.code)
            .find(|&index| !self.slots.at(index).is_occupied())
            .soft_unwrap();
        self.slots.set(free, slot);
    }

    /// Returns the entries in the order of `uhash_nextElement`.
    pub(crate) fn entries(&self) -> impl Iterator<Item = usize> {
        self.slots
            .iter()
            .filter(|slot| slot.is_occupied())
            .map(|slot| slot.entry as usize)
    }
}

/// Hashes at most 63 evenly spaced units. ICU4C: ustring.cpp, ustr_hashUCharsN
fn hash_code(key: &[u16]) -> i32 {
    let sample = key.iter().step_by((key.len() / 32).max(1));
    let code = sample.fold(0u32, |hash, &c| {
        hash.wrapping_mul(37).wrapping_add(c.into())
    });
    code.max(1) as i32
}

/// A map from strings. ICU4C: hash.h, Hashtable
pub(crate) struct Hashtable<V> {
    entries: Vec<(Vec<u16>, V)>,
    slots: Slots,
}

impl<V> Default for Hashtable<V> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            slots: Slots::default(),
        }
    }
}

impl<V> Hashtable<V> {
    fn find(&self, key: &[u16], hash: i32) -> Option<usize> {
        self.slots.find(hash, &|entry| {
            self.entries
                .soft_get(entry)
                .is_some_and(|entry| slices_equal(&entry.0, key))
        })
    }

    pub(crate) fn get(&self, key: &[u16]) -> Option<&V> {
        self.entries
            .soft_get(self.find(key, hash_code(key))?)
            .map(|entry| &entry.1)
    }

    fn add(&mut self, key: &[u16], hash: i32, value: V) -> Result<usize, UErrorCode> {
        let entry = self.entries.len();
        try_push(&mut self.entries, (try_to_vec(key)?, value))?;
        self.slots.insert(hash, entry);
        Ok(entry)
    }

    pub(crate) fn get_or_put(
        &mut self,
        key: &[u16],
        make: impl FnOnce() -> Result<V, UErrorCode>,
    ) -> Result<&mut V, UErrorCode> {
        let hash = hash_code(key);
        let entry = match self.find(key, hash) {
            Some(entry) => entry,
            None => {
                self.slots.reserve_one()?;
                self.add(key, hash, make()?)?
            }
        };
        self.entries
            .soft_get_mut(entry)
            .map(|entry| &mut entry.1)
            .ok_or(U_MEMORY_ALLOCATION_ERROR)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&[u16], &V)> {
        self.slots
            .entries()
            .filter_map(|entry| self.entries.soft_get(entry))
            .map(|(key, value)| (key.as_slice(), value))
    }
}
