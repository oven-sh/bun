//! Small containers shared by the rest of the crate.

pub mod memory;

pub use memory::{AppendVec, LocalVec};

use bun_collections::index_sort;
use bun_threading::Guarded;
use memory::Newest;
use smallvec::{SmallVec, smallvec};
use std::alloc::{Allocator, Global};
use std::hash::Hasher;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};

/// The hash rustc uses, as in `bun_collections::AutoContext`: keys here are small integers and short
/// tuples of them. Nothing may depend on the order in which a map or a set iterates.
pub use rustc_hash::{FxBuildHasher as FxBuild, FxHashMap, FxHashSet, FxHasher};

/// The sorts of slices, compiled once for the whole program: those of the standard library are compiled once for each
/// type and closure, several KB each. They cost a list of indices and a call for each comparison, so they are not for
/// what is sorted all the time.
pub trait SharedSort<T> {
    fn shared_sort(&mut self)
    where
        T: Ord;
    fn shared_sort_by(&mut self, compare: impl FnMut(&T, &T) -> std::cmp::Ordering);
    fn shared_sort_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
    fn shared_sort_by_cached_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
    fn shared_sort_unstable(&mut self)
    where
        T: Ord;
    fn shared_sort_unstable_by(&mut self, compare: impl FnMut(&T, &T) -> std::cmp::Ordering);
    fn shared_sort_unstable_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
}

impl<T> SharedSort<T> for [T] {
    fn shared_sort(&mut self)
    where
        T: Ord,
    {
        index_sort::sort_slice_by(self, T::cmp);
    }

    /// Some of TypeScript's comparisons aren't total orders, and the sorts of the standard library may panic on those. The checker
    /// follows the Go version of TypeScript, and for such a comparison only Go's own stable sort gives what it gives.
    fn shared_sort_by(&mut self, compare: impl FnMut(&T, &T) -> std::cmp::Ordering) {
        index_sort::go_stable_sort_slice_by(self, compare);
    }

    fn shared_sort_by_key<K: Ord>(&mut self, mut key: impl FnMut(&T) -> K) {
        index_sort::sort_slice_by(self, |a, b| key(a).cmp(&key(b)));
    }

    fn shared_sort_by_cached_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K) {
        let keys: Vec<K> = self.iter().map(key).collect();
        let mut order = index_sort::identity(self.len());
        index_sort::sort_indices(&mut order, &mut |a, b| {
            keys[a as usize].cmp(&keys[b as usize])
        });
        index_sort::apply_permutation_in_place(self, &mut order);
    }

    fn shared_sort_unstable(&mut self)
    where
        T: Ord,
    {
        index_sort::sort_slice_unstable_by(self, T::cmp);
    }

    fn shared_sort_unstable_by(&mut self, compare: impl FnMut(&T, &T) -> std::cmp::Ordering) {
        index_sort::sort_slice_unstable_by(self, compare);
    }

    fn shared_sort_unstable_by_key<K: Ord>(&mut self, mut key: impl FnMut(&T) -> K) {
        index_sort::sort_slice_unstable_by(self, |a, b| key(a).cmp(&key(b)));
    }
}

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

/// A set of positions in a list, one bit for each. Two sets that are compared are about lists of the same length. Up to
/// 128 positions take no allocation.
#[derive(Clone, Default)]
pub(crate) struct PositionSet(SmallVec<[u64; 2]>);

/// The positions of the bits that are set in a word, lowest first.
struct BitsOfWord(u64);

impl Iterator for BitsOfWord {
    type Item = usize;

    #[inline]
    fn next(&mut self) -> Option<usize> {
        if self.0 == 0 {
            return None;
        }
        let bit = self.0.trailing_zeros() as usize;
        self.0 &= self.0 - 1;
        Some(bit)
    }
}

impl PositionSet {
    /// The empty set of positions in a list of `len` items.
    pub(crate) fn new(len: usize) -> PositionSet {
        PositionSet(smallvec![0; len.div_ceil(64)])
    }

    /// Makes it `new(len)`, and keeps the allocation.
    pub(crate) fn reset(&mut self, len: usize) {
        self.0.clear();
        self.0.resize(len.div_ceil(64), 0);
    }

    #[inline]
    pub(crate) fn insert(&mut self, position: usize) {
        self.0[position / 64] |= 1 << (position % 64);
    }

    #[inline]
    pub(crate) fn contains(&self, position: usize) -> bool {
        self.0[position / 64] >> (position % 64) & 1 != 0
    }

    /// The words of the set without what is in `excluded`, each with its index.
    #[inline]
    fn words_except(
        &self,
        excluded: &PositionSet,
    ) -> impl DoubleEndedIterator<Item = (usize, u64)> {
        let words = self.0.iter().zip(&excluded.0).enumerate();
        words.map(|(at, (word, excluded))| (at, word & !excluded))
    }

    /// The lowest position that is not in `excluded`.
    pub(crate) fn first_except(&self, excluded: &PositionSet) -> Option<usize> {
        let (at, word) = self.words_except(excluded).find(|it| it.1 != 0)?;
        Some(at * 64 + word.trailing_zeros() as usize)
    }

    /// The highest position that is not in `excluded`.
    pub(crate) fn last_except(&self, excluded: &PositionSet) -> Option<usize> {
        let (at, word) = self.words_except(excluded).rev().find(|it| it.1 != 0)?;
        Some(at * 64 + 63 - word.leading_zeros() as usize)
    }

    /// In ascending order.
    pub(crate) fn iter(&self) -> impl Iterator<Item = usize> {
        let words = self.0.iter().enumerate();
        words.flat_map(|(at, &word)| BitsOfWord(word).map(move |bit| at * 64 + bit))
    }
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
    /// The slot at which the search for a tag starts, modulo the number of slots.
    fn start(tag: u32) -> usize;
}

/// What a slot of an open-addressed table holds for the entry `index` with the hash `spread`: the
/// tag of the hash in its upper half and the index plus one in its lower half. A free slot holds 0.
#[inline]
pub(crate) fn place_of(spread: u64, index: u32) -> u64 {
    u64::from(spread as u32) << 32 | u64::from(index + 1)
}

/// Searches a table of `len` slots, a power of two, which `slot` reads. `Ok`: the index of the entry
/// that `is_it` accepts among those with the hash `spread`. `Err`: there is none, and this is the
/// free slot that has ended the search, which is where such an entry goes.
#[inline]
pub(crate) fn search<P: Placement>(
    len: usize,
    spread: u64,
    slot: impl Fn(usize) -> u64,
    mut is_it: impl FnMut(u32) -> bool,
) -> Result<u32, usize> {
    // Computed from the length, so that the compiler sees that `at` is in bounds.
    let (tag, mask) = (spread as u32, len - 1);
    let mut at = P::start(tag) & mask;
    loop {
        let place = slot(at);
        if place == 0 {
            return Err(at);
        }
        if (place >> 32) as u32 == tag && is_it(place as u32 - 1) {
            return Ok(place as u32 - 1);
        }
        at = (at + 1) & mask;
    }
}

/// The slot for an entry with `tag` that is not in the table. The content of a slot determines its
/// position, so a table grows without reading the entries it indexes.
#[inline]
pub(crate) fn free_slot<P: Placement>(len: usize, tag: u32, slot: impl Fn(usize) -> u64) -> usize {
    let mask = len - 1;
    let mut at = P::start(tag) & mask;
    while slot(at) != 0 {
        at = (at + 1) & mask;
    }
    at
}

/// Whether `slots` slots are too few for `len` entries: the load factor is at most three quarters.
#[inline]
pub(crate) fn is_too_full(len: usize, slots: usize) -> bool {
    len * 4 > slots * 3
}

/// The number of slots of the table that replaces one of `old` slots, for `len` entries.
pub(crate) fn slots_for<P: Placement>(len: usize, old: usize) -> usize {
    let needed = (len * 4).div_ceil(3).next_power_of_two();
    needed.max(old * 2).max(P::LEAST)
}

/// The slots of an open-addressed table that only grows and that threads share: see `place_of`. It has `N` shards, each
/// with the slots for the hashes that `shard_among` gives it. A read takes no lock: when the slots of a shard fill up,
/// bigger ones replace them, and the old ones stay allocated for those who read them. So the table is never moved as a
/// whole: what is moved at a time, and what an insert may have to wait for, is one `N`th of it.
pub(crate) struct Places<P, A: Allocator + Clone = Global, const N: usize = 1> {
    /// Their number is a power of two.
    slots: Newest<AtomicU64, A, N>,
    placement: PhantomData<P>,
}

impl<P: Placement, A: Allocator + Clone, const N: usize> Places<P, A, N> {
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
        is_it: impl FnMut(u32) -> bool,
    ) -> Option<u32> {
        let slots = self.slots.get(shard_among(spread, N), order);
        if slots.is_empty() {
            return None;
        }
        search::<P>(slots.len(), spread, |at| slots[at].load(order), is_it).ok()
    }

    #[inline]
    fn put(slots: &[AtomicU64], place: u64) {
        let slot = |at: usize| slots[at].load(Ordering::Relaxed);
        let at = free_slot::<P>(slots.len(), (place >> 32) as u32, slot);
        slots[at].store(place, Ordering::Release);
    }

    /// The slots of `shard`, of which `more` can be filled. `len`: the number of its entries. One thread at a time for
    /// a shard, here and in `add`.
    #[inline]
    fn reserve(&self, shard: usize, len: usize, more: usize) -> &[AtomicU64] {
        let old = self.slots.get(shard, Ordering::Relaxed);
        if !is_too_full(len + more, old.len()) {
            return old;
        }
        self.grow(shard, old, len + more)
    }

    #[cold]
    #[inline(never)]
    fn grow(&self, shard: usize, old: &[AtomicU64], len: usize) -> &[AtomicU64] {
        (self.slots).replace(shard, slots_for::<P>(len, old.len()), |bigger| {
            for place in old {
                let place = place.load(Ordering::Relaxed);
                if place != 0 {
                    Self::put(bigger, place);
                }
            }
        })
    }

    /// Adds entries of `shard` that are not present yet: pairs of a hash and an index. `len`: the number of its entries
    /// before. At most one resize for all of them.
    #[inline]
    fn add(&self, shard: usize, len: usize, more: usize, added: impl Iterator<Item = (u64, u32)>) {
        let slots = self.reserve(shard, len, more);
        let mut put = 0;
        for (spread, index) in added {
            debug_assert_eq!(shard_among(spread, N), shard);
            Self::put(slots, place_of(spread, index));
            put += 1;
        }
        debug_assert_eq!(put, more);
    }
}

pub(crate) struct Shared;

impl Placement for Shared {
    const LEAST: usize = 16;
    #[inline]
    fn start(tag: u32) -> usize {
        tag as usize
    }
}

/// A table that only grows and that threads share. Only an insert takes a lock, that of its shard.
///
/// A lookup loads one word for its shard, which has the address and the number of its slots, and then the slot. The words
/// of all shards are next to each other, apart from the locks. So many shards cost a lookup nothing.
pub(crate) struct GrowingPlaces<A: Allocator + Clone = Global, const N: usize = 1> {
    places: Places<Shared, A, N>,
    /// The number of entries of each shard. A thread that inserts there holds the lock.
    lens: [Guarded<usize>; N],
}

impl<A: Allocator + Clone + Default, const N: usize> Default for GrowingPlaces<A, N> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<A: Allocator + Clone, const N: usize> GrowingPlaces<A, N> {
    pub(crate) fn new_in(alloc: A) -> Self {
        GrowingPlaces {
            places: Places::new_in(alloc),
            lens: std::array::from_fn(|_| Guarded::new(0)),
        }
    }

    #[inline]
    pub(crate) fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.places.find(spread, Ordering::Acquire, is_it)
    }

    /// Calls `read` while no thread inserts. The locks are taken in the order of the shards, and who holds one of them
    /// otherwise waits for no other.
    pub(crate) fn while_none_grows<R>(&self, read: impl FnOnce() -> R) -> R {
        let _held: Vec<_> = self.lens.iter().map(Guarded::lock).collect();
        read()
    }

    /// `find`, during a step: no thread inserts, and the barrier before the step has ordered the
    /// earlier inserts. Plain loads.
    #[inline]
    pub(crate) fn find_frozen(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.places.find(spread, Ordering::Relaxed, is_it)
    }

    /// Runs at a barrier, on the one thread that fills `shard`: adds `count` pairs of a hash and
    /// an index, none of which is present yet. One lock acquisition, and at most one resize, for
    /// all of them.
    pub(crate) fn extend(
        &self,
        shard: usize,
        count: usize,
        added: impl Iterator<Item = (u64, u32)>,
    ) {
        if count == 0 {
            return;
        }
        let mut len = self.lens[shard].lock();
        self.places.add(shard, *len, count, added);
        *len += count;
    }

    /// Runs at a barrier, on the one thread that fills `shard`: room for `more` entries, with at
    /// most one resize. Slots that bigger ones replace stay allocated.
    pub(crate) fn reserve(&self, shard: usize, more: usize) {
        let len = self.lens[shard].lock();
        self.places.reserve(shard, *len, more);
    }

    /// The entry that `is_it` accepts, or else the one that `make` adds.
    pub(crate) fn find_or_add(
        &self,
        spread: u64,
        is_it: impl FnMut(u32) -> bool,
        make: impl FnOnce() -> u32,
    ) -> u32 {
        let shard = shard_among(spread, N);
        let mut len = self.lens[shard].lock();
        // Another thread may have inserted it first.
        if let Some(found) = self.places.find(spread, Ordering::Relaxed, is_it) {
            return found;
        }
        let index = make();
        (self.places).add(shard, *len, 1, std::iter::once((spread, index)));
        *len += 1;
        index
    }
}

/// The shard of a hash in a table of `shards` shards, a power of two that is at most 256: the top
/// bits of the hash.
#[inline]
pub(crate) fn shard_among(spread: u64, shards: usize) -> usize {
    ((spread >> 56) as usize * shards) >> 8
}

#[inline]
pub(crate) fn spread_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    spread(fx_hash(value))
}

pub(crate) const SHARDS: usize = MAP_SHARDS;

/// The entries of a `ShardedMap` are in this many lists, by the top bits of their hashes: a thread that adds one writes to
/// the length of its list. A lookup goes through the head of the list, so they are few.
const LISTS: usize = 8;

/// A concurrent memo table. Two threads may compute the same entry; they compute the same value. A
/// lookup is lock-free and writes to no shared memory. Only an insert takes the lock of one of `N` shards.
pub struct ShardedMap<K, V, A: Allocator + Clone = Global, const N: usize = MAP_SHARDS> {
    /// The index of an entry in its list.
    places: Box<GrowingPlaces<A, N>, A>,
    entries: Box<[AppendVec<(K, V), A>; LISTS], A>,
}

impl<K, V, A: Allocator + Clone + Default, const N: usize> Default for ShardedMap<K, V, A, N> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<K, V, A: Allocator + Clone, const N: usize> ShardedMap<K, V, A, N> {
    pub fn new_in(alloc: A) -> Self {
        let list = |_| AppendVec::new_in(alloc.clone());
        ShardedMap {
            places: Box::new_in(GrowingPlaces::new_in(alloc.clone()), alloc.clone()),
            entries: Box::new_in(std::array::from_fn(list), alloc.clone()),
        }
    }

    #[inline]
    fn list(&self, spread: u64) -> &AppendVec<(K, V), A> {
        &self.entries[shard_among(spread, LISTS)]
    }
}

impl<K: std::hash::Hash + Eq, V, A: Allocator + Clone, const N: usize> ShardedMap<K, V, A, N> {
    pub fn entries(&self) -> usize {
        self.entries.iter().map(|list| list.len() as usize).sum()
    }

    /// Stored values never move.
    #[inline]
    pub fn get_ref<Q>(&self, key: &Q) -> Option<&V>
    where
        K: std::borrow::Borrow<Q>,
        Q: std::hash::Hash + Eq + ?Sized,
    {
        let spread = spread_hash(key);
        let list = self.list(spread);
        (self.places)
            .find(spread, |i| list.get(i).0.borrow() == key)
            .map(|i| &list.get(i).1)
    }

    /// `get_ref`, during a step: see `GrowingPlaces::find_frozen`. `spread`: `spread_hash(key)`.
    #[inline]
    pub(crate) fn get_frozen(&self, spread: u64, key: &K) -> Option<&V> {
        let list = self.list(spread);
        (self.places)
            .find_frozen(spread, |i| list.get(i).0 == *key)
            .map(|i| &list.get(i).1)
    }

    /// `get_ref` with the hash at hand: `spread_hash(key)`.
    #[inline]
    pub(crate) fn get_by_now(&self, spread: u64, key: &K) -> Option<&V> {
        let list = self.list(spread);
        (self.places)
            .find(spread, |i| list.get(i).0 == *key)
            .map(|i| &list.get(i).1)
    }

    /// Runs at a barrier, on the one thread that fills `shards`: room for `more` entries in each.
    pub(crate) fn reserve(&self, shards: std::ops::Range<usize>, more: usize) {
        for shard in shards {
            self.places.reserve(shard, more);
        }
    }

    /// Runs at a barrier, on the one thread that fills the shard of `spread`, which is
    /// `spread_hash(key)`, or in a commit. Does not overwrite an existing value.
    /// Returns whether `value` was inserted.
    pub(crate) fn add_if_absent(&self, spread: u64, key: &K, value: V) -> bool
    where
        K: Clone,
    {
        let list = self.list(spread);
        let mut value = Some(value);
        self.places.find_or_add(
            spread,
            |i| list.get(i).0 == *key,
            || list.push((key.clone(), value.take().unwrap())),
        );
        value.is_none()
    }

    /// Does not overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, key: K, value: V) -> &V {
        let spread = spread_hash(&key);
        let list = self.list(spread);
        let entry = std::cell::RefCell::new(Some((key, value)));
        let index = self.places.find_or_add(
            spread,
            |i| {
                entry
                    .borrow()
                    .as_ref()
                    .is_some_and(|e| list.get(i).0 == e.0)
            },
            || list.push(entry.borrow_mut().take().unwrap()),
        );
        &list.get(index).1
    }
}
