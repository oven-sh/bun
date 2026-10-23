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
