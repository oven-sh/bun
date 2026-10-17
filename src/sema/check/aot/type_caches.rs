use crate::atom::Atom;
use crate::types::TypeId;
use crate::util::{FxBuild, FxHashMap};
use bun_threading::RwLock;
use std::hash::{BuildHasher, Hash};

pub(super) struct ShardedCache<K, V> {
    shards: Vec<RwLock<FxHashMap<K, V>>>,
}

impl<K, V> Default for ShardedCache<K, V> {
    fn default() -> ShardedCache<K, V> {
        ShardedCache {
            shards: (0..64).map(|_| RwLock::new(FxHashMap::default())).collect(),
        }
    }
}

impl<K: Copy + Eq + Hash, V> ShardedCache<K, V> {
    fn shard(&self, key: K) -> &RwLock<FxHashMap<K, V>> {
        &self.shards[(FxBuild.hash_one(key) >> 58) as usize]
    }

    pub(super) fn get_as<R>(&self, key: K, read: impl FnOnce(&V) -> R) -> Option<R> {
        self.shard(key).read().get(&key).map(read)
    }

    pub(super) fn insert(&self, key: K, value: V) {
        self.shard(key).write().entry(key).or_insert(value);
    }

    fn take(&self) -> Vec<FxHashMap<K, V>> {
        self.shards
            .iter()
            .map(|shard| std::mem::take(&mut *shard.write()))
            .collect()
    }
}

#[derive(Default, Clone)]
pub(super) struct NestedPairs {
    pub(super) pairs: Vec<(TypeId, TypeId)>,
    pub(super) runs: Vec<(TypeId, TypeId, usize, usize)>,
}

impl NestedPairs {
    pub(super) fn add_run(&mut self, from: TypeId, to: TypeId, run: &[(TypeId, TypeId)]) {
        if !run.is_empty() {
            let start = self.pairs.len();
            self.pairs.extend_from_slice(run);
            self.runs.push((from, to, start, self.pairs.len()));
        }
    }

    pub(super) fn is_published(&self) -> bool {
        self.pairs
            .iter()
            .all(|&(held, slot_type)| is_published(held) && is_published(slot_type))
            && self
                .runs
                .iter()
                .all(|&(from, to, ..)| is_published(from) && is_published(to))
    }
}

pub(super) fn is_published(ty: TypeId) -> bool {
    !crate::local::is_local_number(ty.0)
}

#[derive(Default)]
pub(super) struct TypeCaches {
    pub(super) index_and_call_facts: ShardedCache<TypeId, ([Option<TypeId>; 2], [bool; 2])>,
    pub(super) function_members: ShardedCache<TypeId, Box<[(Atom, TypeId)]>>,
    pub(super) nested_pairs_cache: ShardedCache<(TypeId, TypeId), NestedPairs>,
    pub(super) plain_data: ShardedCache<(TypeId, bool), bool>,
    pub(super) object_types: ShardedCache<TypeId, super::mutations::ObjectTypes>,
    pub(super) nested_flows: ShardedCache<(TypeId, TypeId), Box<[(TypeId, TypeId)]>>,
}

impl TypeCaches {
    pub(super) fn release(&self) {
        let taken = (
            self.index_and_call_facts.take(),
            self.function_members.take(),
            self.nested_pairs_cache.take(),
            self.plain_data.take(),
        );
        let _ = std::thread::Builder::new().spawn(move || drop(taken));
        let escape_caches = (self.object_types.take(), self.nested_flows.take());
        let _ = std::thread::Builder::new().spawn(move || drop(escape_caches));
    }
}
