//! Small containers shared by the rest of the crate.

use std::hash::{BuildHasherDefault, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};

/// The multiply-rotate hash rustc uses: keys here are small integers and short tuples of them.
#[derive(Default, Clone, Copy)]
pub struct FxHasher {
    hash: u64,
}

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

impl FxHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        self.hash = (self.hash.rotate_left(5) ^ word).wrapping_mul(SEED);
    }
}

impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, mut bytes: &[u8]) {
        while bytes.len() >= 8 {
            self.add(u64::from_le_bytes(bytes[..8].try_into().unwrap()));
            bytes = &bytes[8..];
        }
        if bytes.len() >= 4 {
            self.add(u64::from(u32::from_le_bytes(
                bytes[..4].try_into().unwrap(),
            )));
            bytes = &bytes[4..];
        }
        for &b in bytes {
            self.add(u64::from(b));
        }
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u16(&mut self, i: u16) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.add(i);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.add(i as u64);
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.hash
    }
}

pub type FxBuild = BuildHasherDefault<FxHasher>;
pub type FxHashMap<K, V> = std::collections::HashMap<K, V, FxBuild>;
pub type FxHashSet<K> = std::collections::HashSet<K, FxBuild>;

#[inline]
pub fn fx_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    let mut h = FxHasher::default();
    value.hash(&mut h);
    h.finish()
}

/// A list that is kept for good somewhere, or was made for whoever asked.
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

const FIRST_CHUNK_BITS: u32 = 10;
/// One for each number of leading zeros a `u32` can have.
const CHUNKS: usize = 33;

/// A vector that only grows, whose elements never move, and that is read and added to without a lock.
///
/// Each chunk is twice as long as the one before it. What is kept of a chunk is where it would begin if it held what is before it as
/// well, so that an element is found without working out where in its chunk it is: see `locate`.
pub struct AppendVec<T> {
    chunks: [AtomicPtr<T>; CHUNKS],
    len: AtomicU32,
}

// SAFETY: elements are only handed out by shared reference, and an index is only handed out once its slot is written.
unsafe impl<T: Send + Sync> Sync for AppendVec<T> {}
// SAFETY: owns its elements.
unsafe impl<T: Send> Send for AppendVec<T> {}

/// Which chunk `index` is in, and how far it is from what is kept of the chunk.
#[inline]
fn locate(index: u32) -> (usize, usize) {
    let n = index.wrapping_add(1 << FIRST_CHUNK_BITS);
    (n.leading_zeros() as usize, n as usize)
}

/// Also how far the chunk is from what is kept of it.
#[inline]
fn chunk_len(chunk: usize) -> usize {
    1usize << (31 - chunk)
}

impl<T> Default for AppendVec<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> AppendVec<T> {
    pub fn new() -> Self {
        AppendVec {
            chunks: [const { AtomicPtr::new(std::ptr::null_mut()) }; CHUNKS],
            len: AtomicU32::new(0),
        }
    }

    /// How many indices have been given out.
    #[inline]
    pub fn len(&self) -> u32 {
        self.len.load(Ordering::Acquire)
    }

    pub fn push(&self, value: T) -> u32 {
        self.push_with(|_| value)
    }

    /// `make` is told the index the value gets. Whoever passes the index on to another thread has to do so with `Release`.
    pub fn push_with(&self, make: impl FnOnce(u32) -> T) -> u32 {
        let index = self.len.fetch_add(1, Ordering::Relaxed);
        let (chunk, offset) = locate(index);
        let mut base = self.chunks[chunk].load(Ordering::Acquire);
        if base.is_null() {
            base = self.install_chunk(chunk);
        }
        // SAFETY: `offset` is inside the chunk, the slot is this call's alone, and nobody reads it before the index is handed out.
        unsafe { base.wrapping_add(offset).write(make(index)) };
        index
    }

    /// Several threads may get here at once. The first to put its chunk in place wins.
    #[cold]
    fn install_chunk(&self, chunk: usize) -> *mut T {
        let layout = std::alloc::Layout::array::<T>(chunk_len(chunk)).unwrap();
        // SAFETY: the layout has a non-zero size for every `T` this crate stores.
        let fresh = unsafe { std::alloc::alloc(layout) }.cast::<T>();
        assert!(!fresh.is_null());
        let base = fresh.wrapping_sub(chunk_len(chunk));
        // Null is for a chunk that is not there.
        assert!(!base.is_null());
        match self.chunks[chunk].compare_exchange(
            std::ptr::null_mut(),
            base,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => base,
            Err(installed) => {
                // SAFETY: allocated above with the same layout, and shown to nobody.
                unsafe { std::alloc::dealloc(fresh.cast::<u8>(), layout) };
                installed
            }
        }
    }

    #[inline]
    pub fn get(&self, index: u32) -> &T {
        let (chunk, offset) = locate(index);
        // SAFETY: there is a place for every number of leading zeros.
        let chunk = unsafe { self.chunks.get_unchecked(chunk) };
        // Whoever pushed had seen the chunk, and the index came from there with `Release` and `Acquire`: there is nothing left to wait for.
        let base = chunk.load(Ordering::Relaxed);
        // SAFETY: an index comes from `push`, which initialized the slot before handing it out.
        unsafe { &*base.wrapping_add(offset) }
    }
}

impl<T> Drop for AppendVec<T> {
    fn drop(&mut self) {
        let len = *self.len.get_mut();
        for (chunk, slot) in self.chunks.iter_mut().enumerate() {
            let base = *slot.get_mut();
            if base.is_null() {
                continue;
            }
            let base = base.wrapping_add(chunk_len(chunk));
            let start = (chunk_len(chunk) - (1 << FIRST_CHUNK_BITS)) as u32;
            let used = (len.saturating_sub(start) as usize).min(chunk_len(chunk));
            for i in 0..used {
                // SAFETY: the first `len` slots are initialized.
                unsafe { std::ptr::drop_in_place(base.add(i)) };
            }
            let layout = std::alloc::Layout::array::<T>(chunk_len(chunk)).unwrap();
            // SAFETY: allocated in `install_chunk` with the same layout.
            unsafe { std::alloc::dealloc(base.cast::<u8>(), layout) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_vec_keeps_what_is_pushed() {
        let v = AppendVec::<String>::new();
        for i in 0..5000u32 {
            assert_eq!(v.push(i.to_string()), i);
        }
        for i in (0..5000u32).step_by(37) {
            assert_eq!(v.get(i), &i.to_string());
        }
    }

    #[test]
    fn sharded_map_keeps_the_first_of_what_many_threads_put_in() {
        let map = ShardedMap::<(u32, u32), String>::default();
        std::thread::scope(|scope| {
            for thread in 0..8u32 {
                let map = &map;
                scope.spawn(move || {
                    for i in 0..20_000u32 {
                        let key = (i % 7000, i % 13);
                        let kept = map.insert(key, format!("{}-{}", key.0, key.1));
                        assert_eq!(kept, format!("{}-{}", key.0, key.1), "thread {thread}");
                        assert_eq!(map.get(&key), Some(kept));
                    }
                });
            }
        });
        let mut distinct = std::collections::HashSet::new();
        for i in 0..20_000u32 {
            distinct.insert((i % 7000, i % 13));
        }
        assert_eq!(map.len(), distinct.len());
        assert_eq!(map.get(&(7001, 0)), None);
    }
}

const MAP_SHARDS: usize = 256;

/// Spreads a hash over all its bits: the top ones pick the shard, the low half is the tag, which the place in the table goes by.
#[inline]
fn spread(hash: u64) -> u64 {
    (hash ^ (hash >> 32)).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

/// The places of an open-addressed table. A place holds 0, or the tag of a hash in its upper half and an index plus one in its lower.
pub(crate) struct Places {
    mask: usize,
    places: Box<[AtomicU64]>,
}

impl Places {
    fn with_capacity(capacity: usize) -> Box<Places> {
        Box::new(Places {
            mask: capacity - 1,
            places: (0..capacity).map(|_| AtomicU64::new(0)).collect(),
        })
    }

    /// The index of what `is_it` says yes to among those with the hash `spread`.
    #[inline]
    fn find(&self, spread: u64, mut is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        let tag = spread as u32;
        let mut at = tag as usize & self.mask;
        loop {
            // SAFETY: `mask` is one less than there are places.
            let place = unsafe { self.places.get_unchecked(at) }.load(Ordering::Acquire);
            if place == 0 {
                return None;
            }
            if (place >> 32) as u32 == tag && is_it(place as u32 - 1) {
                return Some(place as u32 - 1);
            }
            at = (at + 1) & self.mask;
        }
    }

    /// Only whoever holds the lock of the shard puts anything in.
    fn put(&self, spread: u64, index: u32) {
        self.put_place(u64::from(spread as u32) << 32 | u64::from(index + 1));
    }

    /// What is in a place says where it goes: a table grows without looking at what it is a table of.
    fn put_place(&self, place: u64) {
        let mut at = (place >> 32) as usize & self.mask;
        while self.places[at].load(Ordering::Relaxed) != 0 {
            at = (at + 1) & self.mask;
        }
        self.places[at].store(place, Ordering::Release);
    }
}

/// One part of a table that only grows. It is read without a lock: the places are reached through a pointer that is swapped for
/// one to a bigger table when they fill up, and the old ones stay where they are for whoever is still reading them.
pub(crate) struct GrowingPlaces {
    current: AtomicPtr<Places>,
    writer: Mutex<Writer>,
}

#[derive(Default)]
struct Writer {
    count: usize,
    /// All the tables there have been, the current one last.
    tables: Vec<Box<Places>>,
}

impl Default for GrowingPlaces {
    fn default() -> Self {
        GrowingPlaces {
            current: AtomicPtr::new(std::ptr::null_mut()),
            writer: Mutex::default(),
        }
    }
}

impl GrowingPlaces {
    #[inline]
    pub(crate) fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        let current = self.current.load(Ordering::Acquire);
        if current.is_null() {
            return None;
        }
        // SAFETY: a table lives as long as `self`: `Writer::tables` owns it and gives nothing up.
        unsafe { &*current }.find(spread, is_it)
    }

    /// What `is_it` says yes to, or else what `make` adds.
    pub(crate) fn find_or_add(
        &self,
        spread: u64,
        mut is_it: impl FnMut(u32) -> bool,
        make: impl FnOnce() -> u32,
    ) -> u32 {
        let mut writer = self.writer.lock().unwrap();
        // Somebody may have been faster.
        if let Some(found) = writer
            .tables
            .last()
            .and_then(|t| t.find(spread, &mut is_it))
        {
            return found;
        }
        let capacity = writer.tables.last().map_or(0, |t| t.mask + 1);
        if (writer.count + 1) * 4 > capacity * 3 {
            let bigger = Places::with_capacity((capacity * 2).max(16));
            if let Some(old) = writer.tables.last() {
                for place in &old.places {
                    let place = place.load(Ordering::Relaxed);
                    if place != 0 {
                        bigger.put_place(place);
                    }
                }
            }
            self.current
                .store(std::ptr::from_ref(&*bigger).cast_mut(), Ordering::Release);
            writer.tables.push(bigger);
        }
        let index = make();
        writer.tables.last().unwrap().put(spread, index);
        writer.count += 1;
        index
    }

    fn len(&self) -> usize {
        self.writer.lock().unwrap().count
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

struct MapShard<K, V> {
    places: GrowingPlaces,
    entries: AppendVec<(K, V)>,
}

/// A memo table many threads fill. Two threads may compute the same entry; they compute the same value. Looking something up takes no
/// lock and writes to nothing that is shared. Only adding something takes the lock of one of the parts.
pub struct ShardedMap<K, V> {
    shards: Box<[MapShard<K, V>; MAP_SHARDS]>,
}

impl<K: std::hash::Hash + Eq, V> Default for ShardedMap<K, V> {
    fn default() -> Self {
        let shards: Box<[MapShard<K, V>]> = (0..MAP_SHARDS)
            .map(|_| MapShard {
                places: GrowingPlaces::default(),
                entries: AppendVec::new(),
            })
            .collect();
        ShardedMap {
            shards: shards.try_into().unwrap_or_else(|_| unreachable!()),
        }
    }
}

impl<K: std::hash::Hash + Eq, V> ShardedMap<K, V> {
    /// What is kept never moves.
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

    /// Keeps what is there already, and returns what is kept.
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

impl<K: std::hash::Hash + Eq, V: Clone> ShardedMap<K, V> {
    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        let spread = spread_hash(key);
        let shard = &self.shards[shard_of(spread)];
        let mut found = None;
        shard.places.find(spread, |i| {
            let entry = shard.entries.get(i);
            if entry.0 == *key {
                found = Some(&entry.1);
            }
            found.is_some()
        });
        found.cloned()
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        let spread = spread_hash(&key);
        let shard = &self.shards[shard_of(spread)];
        // Looked at until it is put in, which is the last thing that is done with it.
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

    pub fn len(&self) -> usize {
        self.shards.iter().map(|s| s.places.len()).sum()
    }
}
