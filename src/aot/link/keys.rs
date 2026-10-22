use super::unit::{KeyList, SHARD_COUNT, hash_key, shard_of};
use crate::ir::{InParallel, for_each_mut};
use core::hash::Hash;
use hashbrown::HashTable;

pub(super) struct MergedKeys<K> {
    pub keys: Vec<K>,
    pub local_to_merged: Vec<Vec<u32>>,
    shards: Vec<KeyShard<K>>,
    bases: [u32; SHARD_COUNT + 1],
}

impl<K: Copy + Eq + Hash> MergedKeys<K> {
    pub(super) fn find(&self, key: &K) -> Option<u32> {
        find_merged_index(&self.shards, &self.bases, hash_key(key), key)
    }
}

struct KeyShard<K> {
    shard: usize,
    table: HashTable<u32>,
    keys: Vec<K>,
    hashes: Vec<u64>,
}

impl<K: Copy + Eq> KeyShard<K> {
    fn new(shard: usize) -> KeyShard<K> {
        KeyShard {
            shard,
            table: HashTable::new(),
            keys: Vec::new(),
            hashes: Vec::new(),
        }
    }

    fn find(&self, hash: u64, key: &K) -> Option<u32> {
        self.table
            .find(hash, |&index| self.keys[index as usize] == *key)
            .copied()
    }

    fn collect_keys(&mut self, lists: &[&KeyList<K>]) {
        for list in lists {
            for &local in list.shards.shard(self.shard) {
                let (hash, key) = (list.hashes[local as usize], list.keys[local as usize]);
                if self.find(hash, &key).is_some() {
                    continue;
                }
                let index = self.keys.len() as u32;
                self.keys.push(key);
                self.hashes.push(hash);
                let hashes = &self.hashes;
                self.table
                    .insert_unique(hash, index, |&other| hashes[other as usize]);
            }
        }
    }
}

fn find_merged_index<K: Copy + Eq>(
    shards: &[KeyShard<K>],
    bases: &[u32; SHARD_COUNT + 1],
    hash: u64,
    key: &K,
) -> Option<u32> {
    let shard = shard_of(hash);
    Some(bases[shard] + shards[shard].find(hash, key)?)
}

pub(super) fn merge_keys<K: Copy + Eq + Hash + Send + Sync>(
    lists: &[&KeyList<K>],
    in_parallel: InParallel<'_>,
) -> MergedKeys<K> {
    let mut shards: Vec<KeyShard<K>> = (0..SHARD_COUNT).map(KeyShard::new).collect();
    for_each_mut(&mut shards, in_parallel, &|shard| shard.collect_keys(lists));

    let mut bases = [0; SHARD_COUNT + 1];
    let mut keys = Vec::with_capacity(shards.iter().map(|shard| shard.keys.len()).sum());
    for shard in &shards {
        keys.extend_from_slice(&shard.keys);
        bases[shard.shard + 1] = keys.len() as u32;
    }

    let mut slots: Vec<(usize, Vec<u32>)> =
        (0..lists.len()).map(|list| (list, Vec::new())).collect();
    for_each_mut(&mut slots, in_parallel, &|(position, indexes)| {
        let list = lists[*position];
        indexes.reserve_exact(list.keys.len());
        for (key, &hash) in list.keys.iter().zip(&list.hashes) {
            let index = find_merged_index(&shards, &bases, hash, key);
            indexes.push(index.expect("every declared key was merged"));
        }
    });

    MergedKeys {
        keys,
        local_to_merged: slots.into_iter().map(|(_, indexes)| indexes).collect(),
        shards,
        bases,
    }
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
