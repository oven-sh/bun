//! The `bun_collections` hash maps in an [`AstArena`]. Methods that allocate take the arena, as for [`AstVec`].

use core::alloc::Layout;
use core::hash::BuildHasher;
use core::mem::ManuallyDrop;
use core::ops::{Deref, DerefMut};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_collections::array_hash_map::{
    ArrayHashContext, GetOrPutResult, HashIndex, INDEX_THRESHOLD, hash_string,
};
use bun_collections::hashbrown::HashTable;
use bun_collections::hashbrown::hash_table::{self, Entry};
use bun_collections::{AutoContext, hash_map};

use crate::{AstArena, AstBox, AstVec, StoreStr};

/// The arena that was passed to the last method that can allocate.
struct TableAlloc(
    /// `AtomicPtr`: `HashTable::allocator` returns `&A`, and tables are `Sync`. `Relaxed`: only stored through `&mut` to the table.
    AtomicPtr<AstArena>,
);

impl TableAlloc {
    fn new(arena: &AstArena) -> Self {
        TableAlloc(AtomicPtr::new(ptr::from_ref(arena).cast_mut()))
    }

    fn set(&self, arena: &AstArena) {
        self.0
            .store(ptr::from_ref(arena).cast_mut(), Ordering::Relaxed);
    }
}

// SAFETY: `alloc_layout` returns a new allocation that fits `layout`. It is valid until the arena resets, after which
// the table, like any `StoreRef`, must not be used.
unsafe impl allocator_api2::alloc::Allocator for TableAlloc {
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, allocator_api2::alloc::AllocError> {
        // SAFETY: a table only allocates inside `with_capacity_in` and `build_index`, and through the reference that
        // `table_mut` or `index_mut` returns. All borrow the stored arena, and the reference is not kept or sent to
        // another thread.
        let arena = unsafe { &*self.0.load(Ordering::Relaxed) };
        Ok(NonNull::slice_from_raw_parts(
            arena.alloc_layout(layout),
            layout.size(),
        ))
    }

    unsafe fn deallocate(&self, _: NonNull<u8>, _: Layout) {}
}

pub struct AstHashTable<T>(ManuallyDrop<HashTable<T, TableAlloc>>);

impl<T> AstHashTable<T> {
    const fn new() -> Self {
        const { assert!(!core::mem::needs_drop::<T>()) };
        let alloc = TableAlloc(AtomicPtr::new(ptr::null_mut()));
        AstHashTable(ManuallyDrop::new(HashTable::new_in(alloc)))
    }

    pub(crate) fn with_capacity_in(capacity: usize, arena: &AstArena) -> Self {
        const { assert!(!core::mem::needs_drop::<T>()) };
        let table = HashTable::with_capacity_in(capacity, TableAlloc::new(arena));
        AstHashTable(ManuallyDrop::new(table))
    }

    /// Every method that can allocate goes through this.
    #[inline]
    fn table_mut<'t>(&'t mut self, arena: &'t AstArena) -> &'t mut HashTable<T, TableAlloc> {
        self.0.allocator().set(arena);
        &mut self.0
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn iter(&self) -> hash_table::Iter<'_, T> {
        self.0.iter()
    }

    #[inline]
    pub(crate) fn find(&self, hash: u64, eq: impl FnMut(&T) -> bool) -> Option<&T> {
        self.0.find(hash, eq)
    }

    #[inline]
    fn remove(&mut self, hash: u64, eq: impl FnMut(&T) -> bool) -> Option<T> {
        Some(self.0.find_entry(hash, eq).ok()?.remove().0)
    }

    #[inline]
    pub(crate) fn reserve(
        &mut self,
        arena: &AstArena,
        additional: usize,
        hasher: impl Fn(&T) -> u64,
    ) {
        self.table_mut(arena).reserve(additional, hasher);
    }

    #[inline]
    pub(crate) fn insert_unique(
        &mut self,
        arena: &AstArena,
        hash: u64,
        value: T,
        hasher: impl Fn(&T) -> u64,
    ) {
        self.table_mut(arena).insert_unique(hash, value, hasher);
    }

    #[inline]
    pub(crate) fn get_or_insert_with<'t>(
        &'t mut self,
        arena: &'t AstArena,
        hash: u64,
        eq: impl FnMut(&T) -> bool,
        hasher: impl Fn(&T) -> u64,
        value: impl FnOnce() -> T,
    ) -> hash_map::GetOrPutResult<'t, T> {
        let entry = self.table_mut(arena).entry(hash, eq, hasher);
        hash_map::GetOrPutResult {
            found_existing: matches!(entry, Entry::Occupied(_)),
            value_ptr: entry.or_insert_with(value).into_mut(),
        }
    }
}

/// Iterates in the same order as `StringHashMap`.
pub struct AstStringHashMap<V>(AstHashTable<(StoreStr, V)>);

impl<V> Default for AstStringHashMap<V> {
    fn default() -> Self {
        AstStringHashMap(AstHashTable::new())
    }
}

fn hash_key(key: &[u8]) -> u64 {
    bun_wyhash::BuildHasher::default().hash_one(key)
}

impl<V> AstStringHashMap<V> {
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &V)> {
        self.0.iter().map(|(key, value)| (&**key, value))
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.0.iter().map(|(_, value)| value)
    }

    pub fn get(&self, key: &[u8]) -> Option<&V> {
        Some(&self.0.find(hash_key(key), |entry| *entry.0 == *key)?.1)
    }

    pub fn remove(&mut self, key: &[u8]) -> Option<V> {
        Some(self.0.remove(hash_key(key), |entry| *entry.0 == *key)?.1)
    }

    pub fn reserve(&mut self, arena: &AstArena, additional: usize) {
        self.0
            .reserve(arena, additional, |entry| hash_key(&entry.0));
    }

    /// Copies `key`.
    pub fn get_or_put_value<'t>(
        &'t mut self,
        arena: &'t AstArena,
        key: &[u8],
        value: V,
    ) -> &'t mut V {
        let hash = hash_key(key);
        match self
            .0
            .table_mut(arena)
            .find_entry(hash, |entry| *entry.0 == *key)
        {
            Ok(entry) => &mut entry.into_mut().1,
            Err(absent) => {
                let entry = (arena.dupe_str(key), value);
                let table = absent.into_table();
                &mut table
                    .insert_unique(hash, entry, |entry| hash_key(&entry.0))
                    .into_mut()
                    .1
            }
        }
    }

    /// Does not copy `key`.
    pub fn put_borrowed(&mut self, arena: &AstArena, key: StoreStr, value: V)
    where
        V: Copy,
    {
        let entry = self.0.get_or_insert_with(
            arena,
            hash_key(&key),
            |entry| *entry.0 == *key,
            |entry| hash_key(&entry.0),
            || (key, value),
        );
        entry.value_ptr.1 = value;
    }
}

type Index = AstBox<ManuallyDrop<HashIndex<TableAlloc>>>;

/// Every method that can allocate goes through this.
fn index_mut<'t>(index: &'t mut Index, arena: &'t AstArena) -> &'t mut HashIndex<TableAlloc> {
    index.allocator().set(arena);
    index
}

// Out of line: one copy for every `K`, `V`.
#[cold]
#[inline(never)]
fn build_index(arena: &AstArena, hashes: &AstVec<u32>) -> Index {
    let index = HashIndex::build(hashes, hashes.capacity(), TableAlloc::new(arena));
    AstBox::new_in(ManuallyDrop::new(index), arena)
}

pub struct AstArrayHashMap<K, V, C = AutoContext> {
    keys: AstVec<K>,
    values: AstVec<V>,
    hashes: AstVec<u32>,
    /// `None` until there are more than [`INDEX_THRESHOLD`] entries.
    index: Option<Index>,
    ctx: C,
}

impl<K, V, C: Default> Default for AstArrayHashMap<K, V, C> {
    fn default() -> Self {
        AstArrayHashMap {
            keys: AstVec::new(),
            values: AstVec::new(),
            hashes: AstVec::new(),
            index: None,
            ctx: C::default(),
        }
    }
}

impl<K, V, C> AstArrayHashMap<K, V, C> {
    #[inline]
    pub fn count(&self) -> usize {
        self.keys.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    #[inline]
    pub fn keys(&self) -> &[K] {
        &self.keys
    }

    #[inline]
    pub fn values(&self) -> &[V] {
        &self.values
    }

    #[inline]
    pub fn values_mut(&mut self) -> &mut [V] {
        &mut self.values
    }

    #[inline]
    pub fn iter(&self) -> core::iter::Zip<core::slice::Iter<'_, K>, core::slice::Iter<'_, V>> {
        self.keys.iter().zip(self.values.iter())
    }

    pub fn ensure_total_capacity(&mut self, arena: &AstArena, n: usize) {
        self.reserve(arena, n.saturating_sub(self.count()));
    }

    pub fn reserve(&mut self, arena: &AstArena, n: usize) {
        self.keys.reserve(arena, n);
        self.values.reserve(arena, n);
        self.hashes.reserve(arena, n);
        if let Some(index) = &mut self.index {
            index_mut(index, arena).reserve(&self.hashes, self.hashes.capacity());
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.keys.clear();
        self.values.clear();
        self.hashes.clear();
        self.index = None;
    }

    #[inline]
    fn find_hash(&self, h: u32, eq: impl Fn(&K, usize) -> bool) -> Option<usize> {
        let is_match = |i: usize| self.hashes[i] == h && eq(&self.keys[i], i);
        match &self.index {
            Some(index) => index.find(h, is_match),
            None => (0..self.hashes.len()).find(|&i| is_match(i)),
        }
    }

    #[inline]
    fn push_entry(&mut self, arena: &AstArena, key: K, value: V, h: u32) -> usize {
        let i = self.keys.len();
        self.keys.push(arena, key);
        self.values.push(arena, value);
        self.hashes.push(arena, h);
        match &mut self.index {
            Some(index) => index_mut(index, arena).insert(&self.hashes, i as u32, h),
            None if i >= INDEX_THRESHOLD => self.index = Some(build_index(arena, &self.hashes)),
            None => {}
        }
        i
    }

    fn gop_at(&mut self, index: usize, found_existing: bool) -> GetOrPutResult<'_, K, V> {
        GetOrPutResult {
            found_existing,
            index,
            key_ptr: &mut self.keys[index],
            value_ptr: &mut self.values[index],
        }
    }

    fn swap_remove_at(&mut self, removed: usize) {
        self.keys.swap_remove(removed);
        self.values.swap_remove(removed);
        let hash = self.hashes.swap_remove(removed);
        if let Some(index) = &mut self.index {
            index.swap_remove(&self.hashes, removed, hash);
        }
    }
}

impl<K, V, C: ArrayHashContext<K>> AstArrayHashMap<K, V, C> {
    #[inline]
    fn get_index(&self, key: &K) -> Option<usize> {
        self.find_hash(self.ctx.hash(key), |k, i| self.ctx.eql(key, k, i))
    }

    #[inline]
    pub fn contains(&self, key: &K) -> bool {
        self.get_index(key).is_some()
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.get_index(key).map(|i| &self.values[i])
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.get_index(key).map(|i| &mut self.values[i])
    }

    pub fn put(&mut self, arena: &AstArena, key: K, value: V) {
        let h = self.ctx.hash(&key);
        match self.find_hash(h, |k, i| self.ctx.eql(&key, k, i)) {
            Some(i) => self.values[i] = value,
            None => {
                self.push_entry(arena, key, value, h);
            }
        }
    }

    pub fn put_no_clobber(&mut self, arena: &AstArena, key: K, value: V) {
        debug_assert!(!self.contains(&key), "put_no_clobber: key already present");
        let h = self.ctx.hash(&key);
        self.push_entry(arena, key, value, h);
    }

    pub fn get_or_put(&mut self, arena: &AstArena, key: K) -> GetOrPutResult<'_, K, V>
    where
        V: Default,
    {
        self.get_or_put_value(arena, key, V::default())
    }

    pub fn get_or_put_value(
        &mut self,
        arena: &AstArena,
        key: K,
        value: V,
    ) -> GetOrPutResult<'_, K, V> {
        let h = self.ctx.hash(&key);
        if let Some(i) = self.find_hash(h, |k, i| self.ctx.eql(&key, k, i)) {
            return self.gop_at(i, true);
        }
        let i = self.push_entry(arena, key, value, h);
        self.gop_at(i, false)
    }

    pub fn swap_remove(&mut self, key: &K) -> bool {
        let Some(i) = self.get_index(key) else {
            return false;
        };
        self.swap_remove_at(i);
        true
    }

    /// Preserves the order of the other entries.
    pub fn remove(&mut self, arena: &AstArena, key: &K) -> Option<V>
    where
        K: Copy,
    {
        let i = self.get_index(key)?;
        self.keys.remove(i);
        self.hashes.remove(i);
        self.index = (self.count() > INDEX_THRESHOLD).then(|| build_index(arena, &self.hashes));
        self.values[i..].rotate_left(1);
        self.values.pop()
    }
}

/// Copies its keys into the arena.
pub struct AstStringArrayHashMap<V>(AstArrayHashMap<StoreStr, V, ()>);

impl<V> Default for AstStringArrayHashMap<V> {
    fn default() -> Self {
        AstStringArrayHashMap(AstArrayHashMap::default())
    }
}

impl<V> Deref for AstStringArrayHashMap<V> {
    type Target = AstArrayHashMap<StoreStr, V, ()>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<V> DerefMut for AstStringArrayHashMap<V> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<V> AstStringArrayHashMap<V> {
    #[inline]
    pub fn get_index(&self, key: &[u8]) -> Option<usize> {
        self.0.find_hash(hash_string(key), |k, _| **k == *key)
    }

    #[inline]
    pub fn contains(&self, key: &[u8]) -> bool {
        self.get_index(key).is_some()
    }

    pub fn get(&self, key: &[u8]) -> Option<&V> {
        self.get_index(key).map(|i| &self.0.values[i])
    }

    pub fn get_mut(&mut self, key: &[u8]) -> Option<&mut V> {
        self.get_index(key).map(|i| &mut self.0.values[i])
    }

    pub fn put(&mut self, arena: &AstArena, key: &[u8], value: V) {
        let h = hash_string(key);
        match self.0.find_hash(h, |k, _| **k == *key) {
            Some(i) => self.0.values[i] = value,
            None => {
                self.0.push_entry(arena, arena.dupe_str(key), value, h);
            }
        }
    }

    pub fn get_or_put(&mut self, arena: &AstArena, key: &[u8]) -> GetOrPutResult<'_, StoreStr, V>
    where
        V: Default,
    {
        let h = hash_string(key);
        if let Some(i) = self.0.find_hash(h, |k, _| **k == *key) {
            return self.0.gop_at(i, true);
        }
        let i = self
            .0
            .push_entry(arena, arena.dupe_str(key), V::default(), h);
        self.0.gop_at(i, false)
    }
}

#[cfg(test)]
mod tests {
    use bun_collections::{ArrayHashMap, StringArrayHashMap, StringHashMap};

    use super::*;

    fn keys(count: u32) -> impl Iterator<Item = (u32, u32)> {
        (0..count).map(|i| (i, i.wrapping_mul(2654435761) >> 16))
    }

    #[test]
    fn array_hash_map_matches_bun_collections() {
        for distinct in [5, 12, 100] {
            let arena = AstArena::new();
            let mut map = AstArrayHashMap::<u32, u32>::default();
            let mut expected = ArrayHashMap::<u32, u32>::default();
            for (i, random) in keys(400) {
                let key = random % distinct;
                match i % 7 {
                    0 => assert_eq!(map.swap_remove(&key), expected.swap_remove(&key)),
                    1 => assert_eq!(map.remove(&arena, &key), expected.remove(&key)),
                    2 => {
                        let entry = map.get_or_put(&arena, key);
                        let expected = expected.get_or_put(key).unwrap();
                        assert_eq!(entry.found_existing, expected.found_existing);
                        assert_eq!(entry.index, expected.index);
                    }
                    3 => map.reserve(&arena, 3),
                    _ => {
                        map.put(&arena, key, i);
                        expected.put(key, i).unwrap();
                    }
                }
                assert_eq!(map.keys(), expected.keys());
                assert_eq!(map.values(), expected.values());
                assert_eq!(map.get(&(i % distinct)), expected.get(&(i % distinct)));
            }
            map.clear_retaining_capacity();
            assert_eq!((map.count(), map.get(&0)), (0, None));
        }
    }

    #[test]
    fn string_maps_copy_keys_and_match_bun_collections() {
        let arena = AstArena::new();
        let mut ordered = AstStringArrayHashMap::<u32>::default();
        let mut expected_ordered = StringArrayHashMap::<u32>::default();
        let mut unordered = AstStringHashMap::<u32>::default();
        let mut expected_unordered = StringHashMap::<u32>::default();
        for (i, random) in keys(200) {
            let key = (random % 50).to_string().into_bytes();
            ordered.put(&arena, &key, i);
            expected_ordered.put(&key, i).unwrap();
            if i % 5 == 0 {
                assert_eq!(unordered.remove(&key), expected_unordered.remove(&key[..]));
            } else {
                *unordered.get_or_put_value(&arena, &key, 0) += i;
                *expected_unordered.get_or_put_value(&key, 0).unwrap() += i;
            }
        }
        let expected_keys = expected_ordered.keys().iter().map(|key| &**key);
        assert!(ordered.keys().iter().map(|key| &**key).eq(expected_keys));
        assert_eq!(ordered.values(), expected_ordered.values());
        let expected_entries = expected_unordered
            .iter()
            .map(|(key, value)| (&**key, value));
        assert!(unordered.iter().eq(expected_entries));
    }

    #[test]
    fn table_can_grow_in_another_arena() {
        let (first, second) = (AstArena::new(), AstArena::new());
        let mut table = AstHashTable::new();
        table.insert_unique(&first, 0, 0u64, |&value| value);
        table.reserve(&second, 100, |&value| value);
        drop(first);
        assert_eq!(table.find(0, |&value| value == 0), Some(&0));
    }
}
