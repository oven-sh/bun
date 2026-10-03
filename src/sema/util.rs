//! Small containers shared by the rest of the crate.

use bun_threading::Guarded;
use std::hash::{BuildHasherDefault, Hasher};
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
/// The keys are small ids. What `disallowed_types` is after is `RandomState`: the hasher here is Fx, as in `bun_collections::AutoContext`.
#[allow(clippy::disallowed_types)]
pub type FxHashMap<K, V> = std::collections::HashMap<K, V, FxBuild>;
#[allow(clippy::disallowed_types)]
pub type FxHashSet<K> = std::collections::HashSet<K, FxBuild>;

#[inline]
pub fn fx_hash<T: std::hash::Hash + ?Sized>(value: &T) -> u64 {
    let mut h = FxHasher::default();
    value.hash(&mut h);
    h.finish()
}

/// A number for each key that comes more than once: 0, 1, .. in the order each first comes in.
pub fn number_repeated<K: Copy + Eq + std::hash::Hash>(keys: &[K]) -> FxHashMap<K, usize> {
    let mut numbers: FxHashMap<K, usize> = FxHashMap::default();
    // Nearly always every key comes once.
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

/// `in_parallel(count, work)` runs `work(i)` exactly once for every `i` below `count`, on the pool, and returns when all have returned.
pub type InParallel<'a> = &'a dyn Fn(usize, &(dyn Fn(usize) + Sync));

/// `work(&mut items[i])` for every item, on the pool. The first items are begun first.
pub fn for_each_mut<T: Send>(
    items: &mut [T],
    in_parallel: InParallel<'_>,
    work: &(dyn Fn(&mut T) + Sync),
) {
    struct Items<T>(*mut T);
    // SAFETY: the threads get at different items, which are `Send`.
    unsafe impl<T: Send> Sync for Items<T> {}
    impl<T> Items<T> {
        /// # Safety
        /// `i` is in bounds, and no other reference to the item is in use.
        #[allow(clippy::mut_from_ref)]
        unsafe fn item(&self, i: usize) -> &mut T {
            // SAFETY: the caller's.
            unsafe { &mut *self.0.add(i) }
        }
    }
    let all = Items(items.as_mut_ptr());
    // SAFETY: `in_parallel` gives every `i` below the length to one call, so no two calls have one item, and `items` is borrowed until
    // all have returned.
    in_parallel(items.len(), &|i| work(unsafe { all.item(i) }));
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

    /// Gives out `count` indices in a row and returns the first. Their chunks are in place afterwards, so that many threads can `write`
    /// to them at once.
    ///
    /// # Safety
    /// Every one of the indices is to be given to `write` before the vector is dropped.
    pub unsafe fn reserve(&self, count: u32) -> u32 {
        let first = self.len.fetch_add(count, Ordering::Relaxed);
        if count != 0 {
            // A later index is in a chunk with fewer leading zeros.
            for chunk in locate(first + count - 1).0..=locate(first).0 {
                if self.chunks[chunk].load(Ordering::Acquire).is_null() {
                    self.install_chunk(chunk);
                }
            }
        }
        first
    }

    /// # Safety
    /// `index` is one that `reserve` has given out, this is the only `write` to it, and nobody reads it before a barrier.
    #[inline]
    pub unsafe fn write(&self, index: u32, value: T) {
        let (chunk, offset) = locate(index);
        let base = self.chunks[chunk].load(Ordering::Relaxed);
        // SAFETY: `reserve` has put the chunk in place, `offset` is inside it, and the slot is this call's alone.
        unsafe { base.wrapping_add(offset).write(value) };
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

    /// The index of what `is_it` says yes to among those with the hash `spread`. `order`: `Acquire` if another thread may be adding.
    #[inline]
    fn find(
        &self,
        spread: u64,
        order: Ordering,
        mut is_it: impl FnMut(u32) -> bool,
    ) -> Option<u32> {
        let tag = spread as u32;
        let mut at = tag as usize & self.mask;
        loop {
            // SAFETY: `mask` is one less than there are places.
            let place = unsafe { self.places.get_unchecked(at) }.load(order);
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
    writer: Guarded<Writer>,
}

#[derive(Default)]
struct Writer {
    count: usize,
    /// All the tables there have been, the current one last. `GrowingPlaces::current` points into a box, and readers of an older one are
    /// still at it when the list grows.
    #[expect(clippy::vec_box)]
    tables: Vec<Box<Places>>,
}

impl Default for GrowingPlaces {
    fn default() -> Self {
        GrowingPlaces {
            current: AtomicPtr::new(std::ptr::null_mut()),
            writer: Guarded::default(),
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
        unsafe { &*current }.find(spread, Ordering::Acquire, is_it)
    }

    /// `find`, during a step: nobody adds anything, and the barrier before the step has ordered what was added. Plain loads.
    #[inline]
    pub(crate) fn find_frozen(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        let current = self.current.load(Ordering::Relaxed);
        if current.is_null() {
            return None;
        }
        // SAFETY: as in `find`.
        unsafe { &*current }.find(spread, Ordering::Relaxed, is_it)
    }

    /// At a barrier, by the one thread that fills this part: adds `count` pairs of a hash and an index, none of which is there yet. One
    /// lock, and at most one bigger table, for all of them.
    pub(crate) fn extend(&self, count: usize, added: impl Iterator<Item = (u64, u32)>) {
        if count == 0 {
            return;
        }
        let mut writer = self.writer.lock();
        self.make_room(&mut writer, count);
        let places = writer.tables.last().unwrap();
        let mut put = 0;
        for (spread, index) in added {
            places.put(spread, index);
            put += 1;
        }
        debug_assert_eq!(put, count);
        writer.count += count;
    }

    /// Afterwards `more` places can be filled, and three quarters of the table at most are.
    fn make_room(&self, writer: &mut Writer, more: usize) {
        let capacity = writer.tables.last().map_or(0, |t| t.mask + 1);
        if (writer.count + more) * 4 <= capacity * 3 {
            return;
        }
        let needed = ((writer.count + more) * 4).div_ceil(3);
        let bigger = Places::with_capacity(needed.next_power_of_two().max(capacity * 2).max(16));
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

    /// What `is_it` says yes to, or else what `make` adds.
    pub(crate) fn find_or_add(
        &self,
        spread: u64,
        mut is_it: impl FnMut(u32) -> bool,
        make: impl FnOnce() -> u32,
    ) -> u32 {
        let mut writer = self.writer.lock();
        // Somebody may have been faster.
        if let Some(found) = writer
            .tables
            .last()
            .and_then(|t| t.find(spread, Ordering::Relaxed, &mut is_it))
        {
            return found;
        }
        self.make_room(&mut writer, 1);
        let index = make();
        writer.tables.last().unwrap().put(spread, index);
        writer.count += 1;
        index
    }

    fn len(&self) -> usize {
        self.writer.lock().count
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
    pub fn entries(&self) -> usize {
        self.shards.iter().map(|s| s.entries.len() as usize).sum()
    }

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

    /// `get_ref`, during a step: see `GrowingPlaces::find_frozen`. `spread`: `spread_hash(key)`.
    #[inline]
    pub(crate) fn get_frozen(&self, spread: u64, key: &K) -> Option<&V> {
        let shard = &self.shards[shard_of(spread)];
        shard
            .places
            .find_frozen(spread, |i| shard.entries.get(i).0 == *key)
            .map(|i| &shard.entries.get(i).1)
    }

    /// At a barrier, by the one thread that fills the shard of `spread`, which is `spread_hash(key)`. Keeps what is there already.
    /// Whether `value` was put in.
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
