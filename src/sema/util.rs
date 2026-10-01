//! Small containers shared by the rest of the crate.

use std::hash::{BuildHasherDefault, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

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

const FIRST_CHUNK_BITS: u32 = 10;
const CHUNKS: usize = 23;

/// A vector that only grows, whose elements never move, and that is read without a lock.
pub struct AppendVec<T> {
    chunks: [AtomicPtr<T>; CHUNKS],
    len: AtomicU32,
    grow: Mutex<()>,
}

// SAFETY: elements are only handed out by shared reference, and are written before `len` covers them.
unsafe impl<T: Send + Sync> Sync for AppendVec<T> {}
// SAFETY: owns its elements.
unsafe impl<T: Send> Send for AppendVec<T> {}

#[inline]
fn locate(index: u32) -> (usize, usize) {
    let n = index + (1 << FIRST_CHUNK_BITS);
    let chunk = 31 - n.leading_zeros() - FIRST_CHUNK_BITS;
    (
        chunk as usize,
        (n - (1 << (chunk + FIRST_CHUNK_BITS))) as usize,
    )
}

#[inline]
fn chunk_len(chunk: usize) -> usize {
    1usize << (chunk as u32 + FIRST_CHUNK_BITS)
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
            grow: Mutex::new(()),
        }
    }

    #[inline]
    pub fn len(&self) -> u32 {
        self.len.load(Ordering::Acquire)
    }

    pub fn push(&self, value: T) -> u32 {
        self.push_with(|_| value)
    }

    /// `make` is told the index the value gets.
    pub fn push_with(&self, make: impl FnOnce(u32) -> T) -> u32 {
        let _guard = self.grow.lock().unwrap();
        let index = self.len.load(Ordering::Relaxed);
        let value = make(index);
        let (chunk, offset) = locate(index);
        let mut base = self.chunks[chunk].load(Ordering::Relaxed);
        if base.is_null() {
            let layout = std::alloc::Layout::array::<T>(chunk_len(chunk)).unwrap();
            // SAFETY: the layout has a non-zero size for every `T` this crate stores.
            base = unsafe { std::alloc::alloc(layout) }.cast::<T>();
            assert!(!base.is_null());
            self.chunks[chunk].store(base, Ordering::Release);
        }
        // SAFETY: `offset` is inside the chunk, and nobody reads the slot until `len` covers it.
        unsafe { base.add(offset).write(value) };
        self.len.store(index + 1, Ordering::Release);
        index
    }

    #[inline]
    pub fn get(&self, index: u32) -> &T {
        debug_assert!(index < self.len());
        let (chunk, offset) = locate(index);
        let base = self.chunks[chunk].load(Ordering::Acquire);
        // SAFETY: an index comes from `push`, which initialized the slot before handing it out.
        unsafe { &*base.add(offset) }
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
            let start = (chunk_len(chunk) - (1 << FIRST_CHUNK_BITS)) as u32;
            let used = (len.saturating_sub(start) as usize).min(chunk_len(chunk));
            for i in 0..used {
                // SAFETY: the first `len` slots are initialized.
                unsafe { std::ptr::drop_in_place(base.add(i)) };
            }
            let layout = std::alloc::Layout::array::<T>(chunk_len(chunk)).unwrap();
            // SAFETY: allocated in `push` with the same layout.
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
}

const MAP_SHARDS: usize = 64;

/// A memo table many threads fill. Two threads may compute the same entry; they compute the same value.
pub struct ShardedMap<K, V> {
    shards: Box<[std::sync::RwLock<FxHashMap<K, V>>]>,
}

impl<K: std::hash::Hash + Eq, V: Clone> Default for ShardedMap<K, V> {
    fn default() -> Self {
        ShardedMap {
            shards: (0..MAP_SHARDS).map(|_| Default::default()).collect(),
        }
    }
}

impl<K: std::hash::Hash + Eq, V: Clone> ShardedMap<K, V> {
    #[inline]
    fn shard(&self, key: &K) -> &std::sync::RwLock<FxHashMap<K, V>> {
        &self.shards[(fx_hash(key) >> 58) as usize % MAP_SHARDS]
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        self.shard(key).read().unwrap().get(key).cloned()
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        self.shard(&key)
            .write()
            .unwrap()
            .entry(key)
            .or_insert(value)
            .clone()
    }

    pub fn len(&self) -> usize {
        self.shards.iter().map(|s| s.read().unwrap().len()).sum()
    }
}
