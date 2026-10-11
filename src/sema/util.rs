//! Small containers shared by the rest of the crate.

pub mod memory;

pub use memory::{AppendVec, LocalVec};

use bun_threading::Guarded;
use memory::Newest;
use std::alloc::{Allocator, Global};
use std::hash::Hasher;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};

/// The hash rustc uses, as in `bun_collections::AutoContext`: keys here are small integers and short
/// tuples of them. Nothing may depend on the order in which a map or a set iterates.
pub use rustc_hash::{FxBuildHasher as FxBuild, FxHashMap, FxHashSet, FxHasher};

#[inline]
pub fn fx_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    let mut h = FxHasher::default();
    value.hash(&mut h);
    h.finish()
}

/// A number for each key that occurs more than once: 0, 1, .. in order of first occurrence.
pub fn number_repeated<K: Copy + Eq + std::hash::Hash>(keys: &[K]) -> FxHashMap<K, usize> {
    let mut numbers: FxHashMap<K, usize> = FxHashMap::default();
    // Nearly always every key occurs once.
    if keys.len() <= 32 && (1..keys.len()).all(|i| !keys[..i].contains(&keys[i])) {
        return numbers;
    }
    let mut times: FxHashMap<K, usize> = FxHashMap::default();
    for &key in keys {
        *times.entry(key).or_default() += 1;
    }
    for &key in keys {
        if times[&key] > 1 {
            let next = numbers.len();
            numbers.entry(key).or_insert(next);
        }
    }
    numbers
}

/// A list that is either borrowed from permanent storage or was built for the caller.
#[derive(Clone, Debug)]
pub enum List<'p, T> {
    Kept(&'p [T]),
    Own(Vec<T>),
    One(T),
}

impl<T> std::ops::Deref for List<'_, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        match self {
            List::Kept(kept) => kept,
            List::Own(own) => own,
            List::One(one) => std::slice::from_ref(one),
        }
    }
}

impl<T: Clone> List<'_, T> {
    #[inline]
    pub fn into_vec(self) -> Vec<T> {
        match self {
            List::Kept(kept) => kept.to_vec(),
            List::Own(own) => own,
            List::One(one) => vec![one],
        }
    }
}

impl<T> Default for List<'_, T> {
    #[inline]
    fn default() -> Self {
        List::Kept(&[])
    }
}

impl<T> From<Vec<T>> for List<'_, T> {
    #[inline]
    fn from(own: Vec<T>) -> Self {
        List::Own(own)
    }
}

impl<T: Clone> From<List<'_, T>> for Box<[T]> {
    #[inline]
    fn from(list: List<'_, T>) -> Self {
        match list {
            List::Kept(kept) => kept.into(),
            List::Own(own) => own.into(),
            List::One(one) => Box::new([one]),
        }
    }
}

impl<T: PartialEq> PartialEq for List<'_, T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T: PartialEq> PartialEq<Vec<T>> for List<'_, T> {
    #[inline]
    fn eq(&self, other: &Vec<T>) -> bool {
        **self == **other
    }
}

impl<T: PartialEq> PartialEq<List<'_, T>> for Vec<T> {
    #[inline]
    fn eq(&self, other: &List<'_, T>) -> bool {
        **self == **other
    }
}

pub struct ListIter<'p, T> {
    list: List<'p, T>,
    next: usize,
}

impl<T: Copy> Iterator for ListIter<'_, T> {
    type Item = T;
    #[inline]
    fn next(&mut self) -> Option<T> {
        let item = self.list.get(self.next).copied();
        self.next += 1;
        item
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let left = self.list.len().saturating_sub(self.next);
        (left, Some(left))
    }
}

impl<T: Copy> ExactSizeIterator for ListIter<'_, T> {}

impl<'p, T: Copy> IntoIterator for List<'p, T> {
    type Item = T;
    type IntoIter = ListIter<'p, T>;
    #[inline]
    fn into_iter(self) -> ListIter<'p, T> {
        ListIter {
            list: self,
            next: 0,
        }
    }
}

impl<'a, T> IntoIterator for &'a List<'_, T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> std::slice::Iter<'a, T> {
        self.iter()
    }
}

/// `in_parallel(count, work)` runs `work(i)` exactly once for every `i` below `count`, on the pool, and returns when all have returned.
pub type InParallel<'a> = &'a dyn Fn(usize, &(dyn Fn(usize) + Sync));

/// Runs `work(&mut items[i])` for every item, on the pool. The first items are started first.
pub fn for_each_mut<T: Send>(
    items: &mut [T],
    in_parallel: InParallel<'_>,
    work: &(dyn Fn(&mut T) + Sync),
) {
    // `in_parallel` passes every index to exactly one call, so no lock is contended.
    let items: Vec<Guarded<&mut T>> = items.iter_mut().map(Guarded::new).collect();
    in_parallel(items.len(), &|i| work(&mut **items[i].lock()));
}

const MAP_SHARDS: usize = 256;

/// Mixes a hash into all of its bits: the top bits select the shard, the low half is the tag, which
/// determines the slot in the table.
#[inline]
fn spread(hash: u64) -> u64 {
    (hash ^ (hash >> 32)).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

/// What differs between the tables that threads share and those of one task.
pub(crate) trait Placement {
    /// The number of slots of the first table.
    const LEAST: usize;
    /// For the store that fills a slot.
    const STORE: Ordering;
    /// The slot at which the search for a tag starts, modulo the number of slots.
    fn start(tag: u32) -> usize;
}

/// The slots of an open-addressed table that only grows. A slot holds 0, or the tag of a hash in its
/// upper half and an index plus one in its lower half. A read takes no lock: when the slots fill
/// up, a bigger table replaces them, and the old tables stay allocated for those who read them.
pub(crate) struct Places<P, A: Allocator + Clone = Global> {
    /// Their number is a power of two.
    slots: Newest<AtomicU64, A>,
    placement: PhantomData<P>,
}

impl<P: Placement, A: Allocator + Clone> Places<P, A> {
    pub(crate) fn new_in(alloc: A) -> Self {
        Places {
            slots: Newest::new_in(alloc),
            placement: PhantomData,
        }
    }

    /// The index of the entry that `is_it` accepts among those with the hash `spread`. `order`:
    /// `Acquire` if another thread may be inserting.
    #[inline]
    pub(crate) fn find(
        &self,
        spread: u64,
        order: Ordering,
        mut is_it: impl FnMut(u32) -> bool,
    ) -> Option<u32> {
        let slots = self.slots.get(order);
        if slots.is_empty() {
            return None;
        }
        // Computed from the length, so that the compiler sees that `at` is in bounds.
        let (tag, mask) = (spread as u32, slots.len() - 1);
        let mut at = P::start(tag) & mask;
        loop {
            let place = slots[at].load(order);
            if place == 0 {
                return None;
            }
            if (place >> 32) as u32 == tag && is_it(place as u32 - 1) {
                return Some(place as u32 - 1);
            }
            at = (at + 1) & mask;
        }
    }

    /// The content of a slot determines its position, so a table grows without reading the entries
    /// it indexes.
    #[inline]
    fn put(slots: &[AtomicU64], place: u64) {
        let mask = slots.len() - 1;
        let mut at = P::start((place >> 32) as u32) & mask;
        while slots[at].load(Ordering::Relaxed) != 0 {
            at = (at + 1) & mask;
        }
        slots[at].store(place, P::STORE);
    }

    /// The slots, of which `more` can be filled with a load factor of at most three quarters.
    /// `len`: the number of entries. One thread at a time, here and in `add`.
    #[inline]
    fn reserve(&self, len: usize, more: usize) -> &[AtomicU64] {
        let old = self.slots.get(Ordering::Relaxed);
        if (len + more) * 4 <= old.len() * 3 {
            return old;
        }
        self.grow(old, len + more)
    }

    #[cold]
    #[inline(never)]
    fn grow(&self, old: &[AtomicU64], len: usize) -> &[AtomicU64] {
        let needed = (len * 4).div_ceil(3).next_power_of_two();
        (self.slots).replace(needed.max(old.len() * 2).max(P::LEAST), |bigger| {
            for place in old {
                let place = place.load(Ordering::Relaxed);
                if place != 0 {
                    Self::put(bigger, place);
                }
            }
        })
    }

    /// Adds entries that are not present yet: pairs of a hash and an index. `len`: the number of
    /// entries before. At most one resize for all of them.
    #[inline]
    pub(crate) fn add(&self, len: usize, more: usize, added: impl Iterator<Item = (u64, u32)>) {
        let slots = self.reserve(len, more);
        let mut put = 0;
        for (spread, index) in added {
            Self::put(slots, u64::from(spread as u32) << 32 | u64::from(index + 1));
            put += 1;
        }
        debug_assert_eq!(put, more);
    }

    /// Frees the tables that bigger ones have replaced.
    #[inline]
    pub(crate) fn forget_older(&mut self) {
        self.slots.forget_older();
    }

    /// Frees the tables.
    pub(crate) fn clear(&mut self) {
        self.slots.clear();
    }
}

pub(crate) struct Shared;

impl Placement for Shared {
    const LEAST: usize = 16;
    const STORE: Ordering = Ordering::Release;
    #[inline]
    fn start(tag: u32) -> usize {
        tag as usize
    }
}

/// One shard of a table that only grows and that threads share. Only an insert takes the lock.
pub(crate) struct GrowingPlaces<A: Allocator + Clone = Global> {
    places: Places<Shared, A>,
    /// The number of entries. A thread that inserts holds the lock.
    len: Guarded<usize>,
}

impl<A: Allocator + Clone + Default> Default for GrowingPlaces<A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<A: Allocator + Clone> GrowingPlaces<A> {
    pub(crate) fn new_in(alloc: A) -> Self {
        GrowingPlaces {
            places: Places::new_in(alloc),
            len: Guarded::new(0),
        }
    }

    #[inline]
    pub(crate) fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.places.find(spread, Ordering::Acquire, is_it)
    }

    /// `find`, during a step: no thread inserts, and the barrier before the step has ordered the
    /// earlier inserts. Plain loads.
    #[inline]
    pub(crate) fn find_frozen(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.places.find(spread, Ordering::Relaxed, is_it)
    }

    /// Runs at a barrier, on the one thread that fills this shard: adds `count` pairs of a hash and
    /// an index, none of which is present yet. One lock acquisition, and at most one resize, for
    /// all of them.
    pub(crate) fn extend(&self, count: usize, added: impl Iterator<Item = (u64, u32)>) {
        if count == 0 {
            return;
        }
        let mut len = self.len.lock();
        self.places.add(*len, count, added);
        *len += count;
    }

    /// Runs at a barrier, on the one thread that fills this shard: room for `more` entries, with at
    /// most one resize. A table that a bigger one replaces stays allocated.
    pub(crate) fn reserve(&self, more: usize) {
        let len = self.len.lock();
        self.places.reserve(*len, more);
    }

    /// The entry that `is_it` accepts, or else the one that `make` adds.
    pub(crate) fn find_or_add(
        &self,
        spread: u64,
        is_it: impl FnMut(u32) -> bool,
        make: impl FnOnce() -> u32,
    ) -> u32 {
        let mut len = self.len.lock();
        // Another thread may have inserted it first.
        if let Some(found) = self.places.find(spread, Ordering::Relaxed, is_it) {
            return found;
        }
        let index = make();
        (self.places).add(*len, 1, std::iter::once((spread, index)));
        *len += 1;
        index
    }
}

#[inline]
pub(crate) fn shard_of(spread: u64) -> usize {
    (spread >> 56) as usize % MAP_SHARDS
}

#[inline]
pub(crate) fn spread_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    spread(fx_hash(value))
}

pub(crate) const SHARDS: usize = MAP_SHARDS;

struct MapShard<K, V, A: Allocator + Clone> {
    places: GrowingPlaces<A>,
    entries: AppendVec<(K, V), A>,
}

/// A concurrent memo table. Two threads may compute the same entry; they compute the same value. A
/// lookup is lock-free and writes to no shared memory. Only an insert takes the lock of one shard.
pub struct ShardedMap<K, V, A: Allocator + Clone = Global> {
    shards: Box<[MapShard<K, V, A>; MAP_SHARDS], A>,
}

impl<K, V, A: Allocator + Clone + Default> Default for ShardedMap<K, V, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<K, V, A: Allocator + Clone> ShardedMap<K, V, A> {
    pub fn new_in(alloc: A) -> Self {
        let shard = |_| MapShard {
            places: GrowingPlaces::new_in(alloc.clone()),
            entries: AppendVec::new_in(alloc.clone()),
        };
        ShardedMap {
            shards: Box::new_in(std::array::from_fn(shard), alloc.clone()),
        }
    }
}

impl<K: std::hash::Hash + Eq, V, A: Allocator + Clone> ShardedMap<K, V, A> {
    pub fn entries(&self) -> usize {
        self.shards.iter().map(|s| s.entries.len() as usize).sum()
    }

    /// Stored values never move.
    #[inline]
    pub fn get_ref<Q>(&self, key: &Q) -> Option<&V>
    where
        K: std::borrow::Borrow<Q>,
        Q: std::hash::Hash + Eq + ?Sized,
    {
        let spread = spread_hash(key);
        let shard = &self.shards[shard_of(spread)];
        shard
            .places
            .find(spread, |i| shard.entries.get(i).0.borrow() == key)
            .map(|i| &shard.entries.get(i).1)
    }

    /// `get_ref`, during a step: see `GrowingPlaces::find_frozen`. `spread`: `spread_hash(key)`.
    #[inline]
    pub(crate) fn get_frozen(&self, spread: u64, key: &K) -> Option<&V> {
        let shard = &self.shards[shard_of(spread)];
        shard
            .places
            .find_frozen(spread, |i| shard.entries.get(i).0 == *key)
            .map(|i| &shard.entries.get(i).1)
    }

    /// Runs at a barrier, on the one thread that fills `shards`: room for `more` entries in each.
    pub(crate) fn reserve(&self, shards: std::ops::Range<usize>, more: usize) {
        for shard in &self.shards[shards] {
            shard.places.reserve(more);
        }
    }

    /// Runs at a barrier, on the one thread that fills the shard of `spread`, which is
    /// `spread_hash(key)`. Does not overwrite an existing value.
    /// Returns whether `value` was inserted.
    pub(crate) fn add_if_absent(&self, spread: u64, key: &K, value: V) -> bool
    where
        K: Clone,
    {
        let shard = &self.shards[shard_of(spread)];
        let mut value = Some(value);
        shard.places.find_or_add(
            spread,
            |i| shard.entries.get(i).0 == *key,
            || shard.entries.push((key.clone(), value.take().unwrap())),
        );
        value.is_none()
    }

    /// Does not overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, key: K, value: V) -> &V {
        let spread = spread_hash(&key);
        let shard = &self.shards[shard_of(spread)];
        let entry = std::cell::RefCell::new(Some((key, value)));
        let index = shard.places.find_or_add(
            spread,
            |i| {
                entry
                    .borrow()
                    .as_ref()
                    .is_some_and(|e| shard.entries.get(i).0 == e.0)
            },
            || shard.entries.push(entry.borrow_mut().take().unwrap()),
        );
        &shard.entries.get(index).1
    }
}

impl<K: std::hash::Hash + Eq, V: Clone, A: Allocator + Clone> ShardedMap<K, V, A> {
    /// Does not overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        let spread = spread_hash(&key);
        let shard = &self.shards[shard_of(spread)];
        // Read until it is inserted, which is its last use.
        let entry = std::cell::RefCell::new(Some((key, value)));
        let index = shard.places.find_or_add(
            spread,
            |i| {
                entry
                    .borrow()
                    .as_ref()
                    .is_some_and(|e| shard.entries.get(i).0 == e.0)
            },
            || shard.entries.push(entry.borrow_mut().take().unwrap()),
        );
        shard.entries.get(index).1.clone()
    }
}
