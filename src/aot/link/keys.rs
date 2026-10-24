use super::unit::{FindsByUnit, KeyList, SHARD_COUNT, hash_key, shard_of};
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel};
use core::hash::Hash;
use hashbrown::HashTable;
use hashbrown::hash_table::Entry;

/// The distinct entries whose hashes fall into one shard, in the order in which they were added.
pub(super) struct Shard<E, H = u64> {
    table: HashTable<u32>,
    entries: Vec<E>,
    hashes: Vec<H>,
}

impl<E, H: Copy + Into<u64>> Shard<E, H> {
    pub(super) fn find(&self, hash: H, is_equal: impl Fn(&E, H) -> bool) -> Option<u32> {
        let is_equal =
            |&other: &u32| is_equal(&self.entries[other as usize], self.hashes[other as usize]);
        self.table.find(hash.into(), is_equal).copied()
    }

    pub(super) fn add(&mut self, hash: H, entry: E, is_equal: impl Fn(&E, H) -> bool) {
        let (entries, hashes) = (&self.entries, &self.hashes);
        let place = self.table.entry(
            hash.into(),
            |&other| is_equal(&entries[other as usize], hashes[other as usize]),
            |&other| hashes[other as usize].into(),
        );
        if let Entry::Vacant(vacant) = place {
            vacant.insert(self.entries.len() as u32);
            self.entries.push(entry);
            self.hashes.push(hash);
        }
    }
}

/// `fill` adds to a shard, given its number, all that falls into it.
pub(super) fn collect_shards<E: Send, H: Send>(
    in_parallel: InParallel<'_>,
    fill: &(dyn Fn(usize, &mut Shard<E, H>) + Sync),
) -> Vec<Shard<E, H>> {
    map_each((0..SHARD_COUNT).collect(), in_parallel, &|number| {
        let mut shard = Shard {
            table: HashTable::new(),
            entries: Vec::new(),
            hashes: Vec::new(),
        };
        fill(number, &mut shard);
        shard
    })
}

/// Numbers the entries, each with the unit that is the first to hold it: the units in order, the entries of one unit by `key`.
/// The numbers by shard and entry, then the entries by number.
pub(super) fn number_by_unit<I: Id + Send + Sync, H, K: Ord>(
    shards: &[Shard<(u32, I), H>],
    unit_count: usize,
    in_parallel: InParallel<'_>,
    key: &(dyn Fn(u32, I) -> K + Sync),
) -> (Vec<Vec<I>>, Vec<(u32, I)>) {
    let entries: Vec<&[(u32, I)]> = shards.iter().map(|shard| &shard.entries[..]).collect();
    let by_unit = FindsByUnit::new(unit_count, &entries);
    let order = by_unit.order_rows_by(in_parallel, key);
    let by_place = by_unit.number_in(&order);
    let places = by_unit.places.iter().collect();
    let numbers = map_each(places, in_parallel, &|places: &Vec<u32>| {
        places
            .iter()
            .map(|&place| by_place[place as usize])
            .collect()
    });
    let entry = |&place: &u32| by_unit.finds[place as usize];
    (numbers, order.iter().map(entry).collect())
}

pub(super) struct MergedKeys<K> {
    pub keys: Vec<K>,
    pub local_to_merged: Vec<Vec<u32>>,
    shards: Vec<Shard<K>>,
    bases: [u32; SHARD_COUNT + 1],
}

impl<K: Copy + Eq + Hash> MergedKeys<K> {
    pub(super) fn find(&self, key: &K) -> Option<u32> {
        self.find_hashed(hash_key(key), key)
    }

    fn find_hashed(&self, hash: u64, key: &K) -> Option<u32> {
        let shard = shard_of(hash);
        Some(self.bases[shard] + self.shards[shard].find(hash, |other, _| other == key)?)
    }
}

pub(super) fn merge_keys<K: Copy + Eq + Hash + Send + Sync>(
    lists: &[&KeyList<K>],
    in_parallel: InParallel<'_>,
) -> MergedKeys<K> {
    let shards = collect_shards(in_parallel, &|number, shard: &mut Shard<K>| {
        for list in lists {
            for &local in list.shards.shard(number) {
                let key = list.keys[local as usize];
                shard.add(list.hashes[local as usize], key, |&other, _| other == key);
            }
        }
    });

    let mut bases = [0; SHARD_COUNT + 1];
    let mut keys = Vec::with_capacity(shards.iter().map(|shard| shard.entries.len()).sum());
    for (number, shard) in shards.iter().enumerate() {
        keys.extend_from_slice(&shard.entries);
        bases[number + 1] = keys.len() as u32;
    }

    let mut merged = MergedKeys {
        keys,
        local_to_merged: Vec::new(),
        shards,
        bases,
    };
    merged.local_to_merged = map_each(lists.to_vec(), in_parallel, &|list: &KeyList<K>| {
        let merged_index = |(key, &hash): (&K, &u64)| {
            let index = merged.find_hashed(hash, key);
            index.expect("every declared key was merged")
        };
        let keys = list.keys.iter().zip(&list.hashes);
        keys.map(merged_index).collect()
    });
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::FunctionKey;
    use crate::link::testing::{forward, reverse, test_function_key};
    use core::fmt::Debug;
    use std::collections::BTreeSet;

    fn number_lists() -> [KeyList<u64>; 3] {
        [
            KeyList::new((0..1000).collect()),
            KeyList::new((500..1500).rev().collect()),
            KeyList::new((0..3000).step_by(7).collect()),
        ]
    }

    fn function_key_lists() -> [KeyList<FunctionKey>; 3] {
        let key = test_function_key;
        [
            KeyList::new(vec![key(0, 0), key(0, 1), key(1, 0)]),
            KeyList::new(vec![key(1, 0), key(1, 1), key(0, 1)]),
            KeyList::new(vec![key(2, 0), key(0, 0), key(1, 1), key(2, 1)]),
        ]
    }

    fn mapped_keys<K: Copy>(merged: &MergedKeys<K>, list: usize) -> Vec<K> {
        merged.local_to_merged[list]
            .iter()
            .map(|&index| merged.keys[index as usize])
            .collect()
    }

    fn assert_merged<K>(lists: &[&KeyList<K>], merged: &MergedKeys<K>)
    where
        K: Copy + Ord + Hash + Debug,
    {
        let mut seen = BTreeSet::new();
        let mut expected_keys = Vec::new();
        for list in lists {
            expected_keys.extend(list.keys.iter().copied().filter(|&key| seen.insert(key)));
        }
        expected_keys.sort_by_key(|key| shard_of(hash_key(key)));
        assert_eq!(merged.keys, expected_keys);

        assert_eq!(merged.local_to_merged.len(), lists.len());
        for (position, list) in lists.iter().enumerate() {
            assert_eq!(mapped_keys(merged, position), list.keys);
            for (key, &index) in list.keys.iter().zip(&merged.local_to_merged[position]) {
                assert_eq!(merged.find(key), Some(index));
            }
        }
    }

    #[test]
    fn merges_overlapping_number_lists() {
        let [first, second, third] = number_lists();
        let lists = [&first, &second, &third];
        let merged = merge_keys(&lists, &forward);
        assert_merged(&lists, &merged);
        assert_eq!(merged.find(&3000), None);
    }

    #[test]
    fn merges_overlapping_function_key_lists() {
        let [first, second, third] = function_key_lists();
        let lists = [&first, &second, &third];
        let merged = merge_keys(&lists, &forward);
        assert_merged(&lists, &merged);
        assert_eq!(merged.keys.len(), 6);
        assert_eq!(merged.find(&test_function_key(3, 0)), None);
    }

    #[test]
    fn task_order_does_not_change_result() {
        let [first, second, third] = number_lists();
        let lists = [&first, &second, &third];
        let in_order = merge_keys(&lists, &forward);
        let in_reverse = merge_keys(&lists, &reverse);
        assert_eq!(in_order.keys, in_reverse.keys);
        assert_eq!(in_order.local_to_merged, in_reverse.local_to_merged);
    }

    #[test]
    fn list_order_does_not_change_key_mapping() {
        let [first, second, third] = number_lists();
        let merged = merge_keys(&[&first, &second, &third], &forward);
        let swapped = merge_keys(&[&second, &first, &third], &forward);
        assert_merged(&[&second, &first, &third], &swapped);
        for (list, swapped_list) in [(0, 1), (1, 0), (2, 2)] {
            assert_eq!(
                mapped_keys(&merged, list),
                mapped_keys(&swapped, swapped_list)
            );
        }
    }

    #[test]
    fn empty_list_has_no_indexes() {
        let (empty, other) = (KeyList::new(Vec::new()), KeyList::new(vec![4u64, 9]));
        let merged = merge_keys(&[&empty, &other], &forward);
        assert_merged(&[&empty, &other], &merged);
        assert!(merged.local_to_merged[0].is_empty());
    }

    #[test]
    fn no_lists_merge_to_empty_result() {
        let merged = merge_keys::<u64>(&[], &forward);
        assert!(merged.keys.is_empty());
        assert!(merged.local_to_merged.is_empty());
        assert_eq!(merged.find(&0), None);
    }
}
