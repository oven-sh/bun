//! Small containers shared by the rest of the crate.

pub mod memory;

pub use memory::{AppendVec, LocalVec};

use bun_collections::index_sort;
use bun_threading::Guarded;
use memory::{Fixed, Growing, Newest, Series};
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

    /// Some of TypeScript's comparisons aren't total orders, and the standard library's sorts may panic on those. The
    /// checker follows the Go version of TypeScript, and with a comparison like that only Go's own stable sort
    /// algorithm produces the same order.
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

/// A bit set of positions in a list. Methods that combine two sets expect both to be for lists of the same length. Sets
/// of up to 128 positions are stored inline.
#[derive(Clone, Default)]
pub(crate) struct PositionSet(SmallVec<[u64; 2]>);

/// Iterates over the positions of the set bits in a word, lowest first.
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
    /// Returns an empty set for a list of `len` items.
    pub(crate) fn new(len: usize) -> PositionSet {
        PositionSet(smallvec![0; len.div_ceil(64)])
    }

    /// Resets the set to `new(len)` and reuses the allocation.
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

    /// Yields each word of the set with the bits in `excluded` cleared, paired with the word's index.
    #[inline]
    fn words_except(
        &self,
        excluded: &PositionSet,
    ) -> impl DoubleEndedIterator<Item = (usize, u64)> {
        let words = self.0.iter().zip(&excluded.0).enumerate();
        words.map(|(at, (word, excluded))| (at, word & !excluded))
    }

    /// Returns the lowest position in the set that isn't in `excluded`.
    pub(crate) fn first_except(&self, excluded: &PositionSet) -> Option<usize> {
        let (at, word) = self.words_except(excluded).find(|it| it.1 != 0)?;
        Some(at * 64 + word.trailing_zeros() as usize)
    }

    /// Returns the highest position in the set that isn't in `excluded`.
    pub(crate) fn last_except(&self, excluded: &PositionSet) -> Option<usize> {
        let (at, word) = self.words_except(excluded).rev().find(|it| it.1 != 0)?;
        Some(at * 64 + 63 - word.leading_zeros() as usize)
    }

    /// Iterates over the positions in ascending order.
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

/// Returns the slot value for entry `index` with hash `spread` in an open-addressed table: the
/// hash's tag in the upper 32 bits and `index + 1` in the lower 32. A free slot is 0.
#[inline]
pub(crate) fn place_of(spread: u64, index: u32) -> u64 {
    u64::from(spread as u32) << 32 | u64::from(index + 1)
}

/// Searches a table of `len` slots, read through `slot`. `len` must be a power of two. Returns `Ok`
/// with the index of the entry that `is_it` accepts among those with hash `spread`. If there isn't
/// one, returns `Err` with the free slot that ended the search, which is where that entry would be
/// inserted.
#[inline]
pub(crate) fn search<P: Placement>(
    len: usize,
    spread: u64,
    slot: impl Fn(usize) -> u64,
    mut is_it: impl FnMut(u32) -> bool,
) -> Result<u32, usize> {
    // The mask is computed from `len` here so the compiler can prove that `at` is in bounds.
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

/// Returns the free slot for a new entry with `tag`. The entry must not be in the table yet. A
/// slot's position depends only on its value, so growing a table doesn't read the entries it
/// indexes.
#[inline]
pub(crate) fn free_slot<P: Placement>(len: usize, tag: u32, slot: impl Fn(usize) -> u64) -> usize {
    let mask = len - 1;
    let mut at = P::start(tag) & mask;
    while slot(at) != 0 {
        at = (at + 1) & mask;
    }
    at
}

/// True if `len` entries are too many for `slots` slots. The maximum load factor is 3/4.
#[inline]
pub(crate) fn is_too_full(len: usize, slots: usize) -> bool {
    len * 4 > slots * 3
}

/// Returns the new slot count when a table of `old` slots grows to store `len` entries.
pub(crate) fn slots_for<P: Placement>(len: usize, old: usize) -> usize {
    let needed = (len * 4).div_ceil(3).next_power_of_two();
    needed.max(old * 2).max(P::LEAST)
}

/// The slots of a grow-only open-addressed table that threads share. See `place_of` for the slot format. The table is
/// split into shards. Reads are lock-free: when a shard's slots fill up, a bigger array replaces them, and the old array
/// stays allocated for threads that are still reading it. Shards grow independently, so a resize moves only one shard,
/// and that's the most an insert may have to wait for.
pub(crate) struct Places<P, A: Allocator + Clone, S: Series<AtomicU64, A>> {
    /// Their number is a power of two.
    slots: Newest<AtomicU64, A, S>,
    placement: PhantomData<P>,
}

impl<P: Placement, A: Allocator + Clone, S: Series<AtomicU64, A>> Places<P, A, S> {
    pub(crate) fn new_in(alloc: A) -> Self {
        Places {
            slots: Newest::new_in(alloc),
            placement: PhantomData,
        }
    }

    /// The index of the entry that `is_it` accepts among those of `shard` with the hash `spread`. `order`: `Acquire` if
    /// another thread may be inserting.
    #[inline]
    pub(crate) fn find(
        &self,
        shard: usize,
        spread: u64,
        order: Ordering,
        is_it: impl FnMut(u32) -> bool,
    ) -> Option<u32> {
        let slots = self.slots.get(shard, order);
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

    /// Returns the slots of `shard`, grown if needed so that `more` entries can be added. `len` is the shard's current
    /// entry count. Only one thread at a time may call this or `add` for a given shard.
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

    /// Adds an entry to `shard`, which must not be present already. `len` is the shard's entry count before the call.
    #[inline]
    fn add(&self, shard: usize, len: usize, spread: u64, index: u32) {
        Self::put(self.reserve(shard, len, 1), place_of(spread, index));
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

/// A grow-only table that threads share. Only an insert locks, and it locks only its own shard.
///
/// A lookup loads one word with the address and length of its shard's slots, then the slot itself. The words of all
/// shards are adjacent and separate from the locks, so having many shards doesn't slow a lookup down.
pub(crate) struct GrowingPlaces<A: Allocator + Clone = Global, const N: usize = 1> {
    places: Places<Shared, A, Fixed<AtomicU64, N>>,
    /// Entry count of each shard. Inserting into a shard requires its lock.
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
        (self.places).find(shard_among(spread, N), spread, Ordering::Acquire, is_it)
    }

    /// Calls `read` with every shard locked, so no thread can insert while it runs. This can't deadlock: the locks are
    /// acquired in shard order, and no other code waits for a second shard lock while holding one.
    pub(crate) fn while_none_grows<R>(&self, read: impl FnOnce() -> R) -> R {
        let _held: Vec<_> = self.lens.iter().map(Guarded::lock).collect();
        read()
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
        if let Some(found) = self.places.find(shard, spread, Ordering::Relaxed, is_it) {
            return found;
        }
        let index = make();
        self.places.add(shard, *len, spread, index);
        *len += 1;
        index
    }
}

/// Selects one of the tables of a `WindowedPlaces`.
///
/// Ids are assigned in order, and most lookups of a key happen soon after the youngest id in the key was assigned. So
/// a key belongs to the window of that id, and `1 << IDS` consecutive ids share a window. The tables of the latest
/// windows are small, and they're next to each other in the directory, so a lookup usually hits the cache. With one
/// table for all keys, which is tens of megabytes, nearly every lookup is a cache miss and a page walk.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Window(u32);

type Windows<A> = Growing<AtomicU64, A>;

impl Window {
    const IDS: u32 = 6;
    /// Number of windows that `of_hash` spreads keys over.
    const HASHED: u32 = 64;

    #[inline]
    fn new(group: usize, index: u32) -> Window {
        Window(Windows::<Global>::series(group, index) as u32)
    }

    /// Returns the window of the type `id`.
    #[inline]
    pub fn of_type(id: u32) -> Window {
        Window::new(0, id >> Self::IDS)
    }

    /// Returns the window of the mapper `id`.
    #[inline]
    pub fn of_mapper(id: u32) -> Window {
        Window::new(1, id >> Self::IDS)
    }

    /// Returns the window of the atom `id`. Atoms are numbered in order of first appearance.
    #[inline]
    pub fn of_atom(id: u32) -> Window {
        Window::new(2, id >> Self::IDS)
    }

    /// Returns the window of a key that has no id in it but belongs to declaration `index` of `file`. Most
    /// declarations of a file are visited in order.
    #[inline]
    pub fn of_place(file: u32, index: u32) -> Window {
        Window::new(3, Self::HASHED + ((file << 2) | ((index >> 9) & 3)))
    }

    /// Returns the window of any other key.
    #[inline]
    pub fn of_hash<T: std::hash::Hash + ?Sized>(key: &T) -> Window {
        Window::new(3, (fx_hash(key) >> 32) as u32 % Self::HASHED)
    }
}

/// A key of a table that has a `WindowedPlaces`.
pub trait Windowed: std::hash::Hash {
    fn window(&self) -> Window;
}

/// Returns the hash that a `WindowedPlaces` finds `value` by: the window in the upper half, the tag in the lower half.
#[inline]
pub(crate) fn spread_in_window<T: Windowed + ?Sized>(value: &T) -> u64 {
    spread_of(value.window(), fx_hash(value))
}

/// `spread_in_window` of a key that has `window` and the `fx_hash` `hash`.
#[inline]
pub(crate) fn spread_of(window: Window, hash: u64) -> u64 {
    (u64::from(window.0) << 32) | (spread(hash) & u64::from(u32::MAX))
}

pub(crate) struct InWindow;

impl Placement for InWindow {
    /// A table that grows stays allocated beside the bigger one, so a smaller start takes more memory, not less.
    const LEAST: usize = 32;
    #[inline]
    fn start(tag: u32) -> usize {
        tag as usize
    }
}

/// Number of locks of a `WindowedPlaces`.
const WINDOW_LOCKS: usize = 64;

/// A `GrowingPlaces` with a shard for each `Window`.
pub(crate) struct WindowedPlaces<A: Allocator + Clone = Global> {
    /// A series' counter is the window's entry count. Inserting into a window requires its lock.
    places: Places<InWindow, A, Windows<A>>,
    /// Neighboring windows have different locks.
    locks: [Guarded<()>; WINDOW_LOCKS],
}

impl<A: Allocator + Clone> WindowedPlaces<A> {
    pub(crate) fn new_in(alloc: A) -> Self {
        WindowedPlaces {
            places: Places::new_in(alloc),
            locks: std::array::from_fn(|_| Guarded::new(())),
        }
    }

    #[inline]
    pub(crate) fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        (self.places).find((spread >> 32) as usize, spread, Ordering::Acquire, is_it)
    }

    /// `find` while no thread inserts. Something must have ordered the earlier inserts before this
    /// call. Plain loads.
    #[inline]
    pub(crate) fn find_frozen(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        (self.places).find((spread >> 32) as usize, spread, Ordering::Relaxed, is_it)
    }

    /// The entry that `is_it` accepts, or else the one that `make` adds.
    pub(crate) fn find_or_add(
        &self,
        spread: u64,
        is_it: impl FnMut(u32) -> bool,
        make: impl FnOnce() -> u32,
    ) -> u32 {
        let window = (spread >> 32) as usize;
        let _held = self.locks[window % WINDOW_LOCKS].lock();
        // Another thread may have inserted it first.
        if let Some(found) = self.places.find(window, spread, Ordering::Relaxed, is_it) {
            return found;
        }
        let index = make();
        let len = self.places.slots.series().count(window);
        (self.places).add(window, len.load(Ordering::Relaxed) as usize, spread, index);
        len.fetch_add(1, Ordering::Relaxed);
        index
    }
}

/// Returns the shard for a hash in a table of `shards` shards, from the hash's top bits. `shards`
/// must be a power of two and at most 256.
#[inline]
pub(crate) fn shard_among(spread: u64, shards: usize) -> usize {
    ((spread >> 56) as usize * shards) >> 8
}

#[inline]
pub(crate) fn spread_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    spread(fx_hash(value))
}

pub(crate) const SHARDS: usize = MAP_SHARDS;

/// Number of lists that a `ShardedMap` splits its entries into, by the top bits of their hashes. Every insert writes to
/// its list's length, so several lists spread out that contention. Every lookup reads its list's header, so the count
/// is small.
const LISTS: usize = 8;

/// A concurrent memo table. Two threads may compute the same entry; they compute the same value. A
/// lookup is lock-free and doesn't write to shared memory. An insert locks one of the `N` shards.
pub struct ShardedMap<K, V, A: Allocator + Clone = Global, const N: usize = MAP_SHARDS> {
    /// Maps a hash to an entry's index in its list.
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
    #[cfg(test)]
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

/// A `ShardedMap` with a `WindowedPlaces`. Every `spread` is `spread_in_window(key)`.
pub(crate) struct WindowedMap<K, V, A: Allocator + Clone = Global> {
    /// Maps a hash to an entry's index in its list.
    places: Box<WindowedPlaces<A>, A>,
    entries: Box<[AppendVec<(K, V), A>; LISTS], A>,
}

impl<K: Eq, V, A: Allocator + Clone> WindowedMap<K, V, A> {
    pub(crate) fn new_in(alloc: A) -> Self {
        let list = |_| AppendVec::new_in(alloc.clone());
        WindowedMap {
            places: Box::new_in(WindowedPlaces::new_in(alloc.clone()), alloc.clone()),
            entries: Box::new_in(std::array::from_fn(list), alloc.clone()),
        }
    }

    /// Selects the list by the tag. Keys that are inserted around the same time have the same window.
    #[inline]
    fn list(&self, spread: u64) -> &AppendVec<(K, V), A> {
        &self.entries[shard_among(spread << 32, LISTS)]
    }

    pub(crate) fn entries(&self) -> usize {
        self.entries.iter().map(|list| list.len() as usize).sum()
    }

    /// `get_by_now` while no thread inserts: see `WindowedPlaces::find_frozen`.
    #[inline]
    pub(crate) fn get_frozen(&self, spread: u64, key: &K) -> Option<&V> {
        let list = self.list(spread);
        (self.places)
            .find_frozen(spread, |i| list.get(i).0 == *key)
            .map(|i| &list.get(i).1)
    }

    /// Returns the value of `key`. Stored values never move.
    #[inline]
    pub(crate) fn get_by_now(&self, spread: u64, key: &K) -> Option<&V> {
        let list = self.list(spread);
        (self.places)
            .find(spread, |i| list.get(i).0 == *key)
            .map(|i| &list.get(i).1)
    }

    /// Inserts `value` unless `key` already has a value. Returns true if `value` was inserted.
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
}
