use crate::Error;
use crate::set::Set;
use crate::tree::{SetId, Tree};

const MAX_OWNED_RANGES: usize = 1 << 23;
const SETS_COMPARED_IN_TURN: usize = 8;
const PROBES: usize = 4;

/// Finds the sets that a tree has already, in a few steps.
#[derive(Default)]
pub(super) struct KnownSets {
    /// By hash, once there are many: the index of a set plus one.
    slots: Vec<u32>,
    owned_ranges: usize,
}

impl KnownSets {
    #[inline]
    pub(super) fn find_or_add(&mut self, tree: &mut Tree, set: Set) -> Result<SetId, Error> {
        let known = match self.slots.is_empty() {
            true => tree.sets().iter().position(|known| *known == set),
            false => self.find(tree.sets(), &set),
        };
        if let Some(index) = known {
            return Ok(SetId(index as u32));
        }
        self.owned_ranges += set.owned_ranges();
        if self.owned_ranges > MAX_OWNED_RANGES {
            return Err(Error::PatternTooLarge);
        }
        let id = tree.add_set(set)?;
        if id.index() >= SETS_COMPARED_IN_TURN {
            self.remember_last(tree.sets())?;
        }
        Ok(id)
    }

    fn probes(&self, set: &Set) -> impl Iterator<Item = usize> + use<> {
        let (hash, mask) = ((set.hash() >> 32) as usize, self.slots.len() - 1);
        (0..PROBES).map(move |probe| (hash + probe) & mask)
    }

    fn find(&self, sets: &[Set], set: &Set) -> Option<usize> {
        self.probes(set)
            .map_while(|slot| (self.slots[slot] as usize).checked_sub(1))
            .find(|&index| sets[index] == *set)
    }

    fn remember_last(&mut self, sets: &[Set]) -> Result<(), Error> {
        let mut first_new = sets.len() - 1;
        if sets.len() * 2 > self.slots.len() {
            let slots = (sets.len() * 4).next_power_of_two();
            self.slots.clear();
            self.slots
                .try_reserve_exact(slots)
                .map_err(|_| Error::OutOfMemory)?;
            self.slots.resize(slots, 0);
            first_new = 0;
        }
        for (index, set) in sets.iter().enumerate().skip(first_new) {
            // If all probes are taken, the set of the last one is forgotten.
            let mut chosen = 0;
            for slot in self.probes(set) {
                chosen = slot;
                if self.slots[slot] == 0 {
                    break;
                }
            }
            self.slots[chosen] = index as u32 + 1;
        }
        Ok(())
    }
}
