// https://github.com/lithdew/rheia/blob/162293d0f0e8d6572a8954c0add83f13f76b3cc6/hash_map.zig
// Apache License 2.0

use core::fmt;
use core::marker::PhantomData;

use bun_alloc::AllocError;

// ──────────────────────────────────────────────────────────────────────────
// Context trait — models Zig's `Context: type` with `.hash(k)` / `.eql(a, b)`
// ──────────────────────────────────────────────────────────────────────────

// Canonical definitions live in `crate::zig_hash_map`; re-exported here so the
// path `bun_collections::static_hash_map::{HashContext, AutoContext}` keeps
// resolving for downstream callers.
pub use crate::zig_hash_map::{AutoHashContext as AutoContext, HashContext};

// ──────────────────────────────────────────────────────────────────────────
// Type aliases (Zig: AutoHashMap)
// ──────────────────────────────────────────────────────────────────────────

pub type AutoHashMap<K, V, const MAX_LOAD_PERCENTAGE: u64> =
    HashMap<K, V, AutoContext, MAX_LOAD_PERCENTAGE>;

// ──────────────────────────────────────────────────────────────────────────
// Shared Entry / GetOrPutResult / constants
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_HASH: u64 = u64::MAX;

#[derive(Clone, Copy)]
pub struct Entry<K, V> {
    pub hash: u64,
    pub key: K,
    pub value: V,
}

impl<K, V> Entry<K, V> {
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.hash == EMPTY_HASH
    }

    #[inline]
    fn empty() -> Self
    where
        K: Copy + Default,
        V: Copy + Default,
    {
        Self {
            hash: EMPTY_HASH,
            key: K::default(),
            value: V::default(),
        }
    }
}

impl<K: fmt::Debug, V: fmt::Debug> fmt::Display for Entry<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "(hash: {}, key: {:?}, value: {:?})",
            self.hash, self.key, self.value
        )
    }
}

pub use crate::hash_map::GetOrPutResult;

// ──────────────────────────────────────────────────────────────────────────
// comptime helpers (Zig top-of-fn const expressions)
// ──────────────────────────────────────────────────────────────────────────

#[inline]
const fn compute_shift(capacity: u64) -> u8 {
    // Zig: 63 - math.log2_int(u64, capacity) + 1
    (63 - capacity.ilog2() + 1) as u8
}

#[inline]
const fn compute_overflow(capacity: u64, shift: u8) -> u64 {
    // Zig: capacity / 10 + (63 - @as(u64, shift) + 1) << 1
    // Zig precedence: `+` binds tighter than `<<`, so this is (a + b) << 1.
    (capacity / 10 + (63 - shift as u64 + 1)) << 1
}

/// Checked u64→usize narrowing for table indices (Zig indexes by u64 directly).
#[inline]
fn to_idx(x: u64) -> usize {
    usize::try_from(x).expect("int cast")
}

/// Total backing-array length for a `StaticHashMap` of the given capacity.
pub const fn static_slots(capacity: usize) -> usize {
    debug_assert!((capacity as u64).is_power_of_two());
    let shift = compute_shift(capacity as u64);
    let overflow = compute_overflow(capacity as u64, shift);
    capacity + overflow as usize
}

// ──────────────────────────────────────────────────────────────────────────
// StaticHashMap
// ──────────────────────────────────────────────────────────────────────────

pub struct StaticHashMap<
    K,
    V,
    Ctx,
    const CAPACITY: usize,
    const SLOTS: usize, // = static_slots(CAPACITY), asserted in default()
> {
    pub entries: [Entry<K, V>; SLOTS],
    pub len: usize,
    /// Zig `u6`; stored as u8.
    pub shift: u8,
    // put_probe_count: usize,
    // get_probe_count: usize,
    // del_probe_count: usize,
    _ctx: PhantomData<Ctx>,
}

impl<K: Copy + Default, V: Copy + Default, Ctx, const CAPACITY: usize, const SLOTS: usize> Default
    for StaticHashMap<K, V, Ctx, CAPACITY, SLOTS>
{
    fn default() -> Self {
        const {
            assert!((CAPACITY as u64).is_power_of_two());
            assert!(
                SLOTS == static_slots(CAPACITY),
                "StaticHashMap: SLOTS must equal static_slots(CAPACITY)"
            );
        };
        Self {
            // TODO(port): `[Entry::empty(); N]` needs `Entry<K,V>: Copy` const-init;
            // may need `MaybeUninit` + loop if K/V aren't const-zeroable.
            entries: [Entry::empty(); SLOTS],
            len: 0,
            shift: compute_shift(CAPACITY as u64),
            _ctx: PhantomData,
        }
    }
}

impl<K: 'static, V: 'static, Ctx, const CAPACITY: usize, const SLOTS: usize> HashMapMixin<K, V, Ctx>
    for StaticHashMap<K, V, Ctx, CAPACITY, SLOTS>
{
    #[inline]
    fn storage(&self) -> &[Entry<K, V>] {
        &self.entries[..]
    }
    #[inline]
    fn storage_mut(&mut self) -> &mut [Entry<K, V>] {
        &mut self.entries[..]
    }
    #[inline]
    fn len_mut(&mut self) -> &mut usize {
        &mut self.len
    }
    #[inline]
    fn shift(&self) -> u8 {
        self.shift
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HashMap (heap-backed, growable)
// ──────────────────────────────────────────────────────────────────────────

pub struct HashMap<K, V, Ctx, const MAX_LOAD_PERCENTAGE: u64> {
    pub entries: Box<[Entry<K, V>]>,
    pub len: usize,
    /// Zig `u6`; stored as u8.
    pub shift: u8,
    // put_probe_count: usize,
    // get_probe_count: usize,
    // del_probe_count: usize,
    _ctx: PhantomData<Ctx>,
}

impl<K: 'static, V: 'static, Ctx, const MAX_LOAD_PERCENTAGE: u64> HashMapMixin<K, V, Ctx>
    for HashMap<K, V, Ctx, MAX_LOAD_PERCENTAGE>
{
    #[inline]
    fn storage(&self) -> &[Entry<K, V>] {
        &self.entries[..]
    }
    #[inline]
    fn storage_mut(&mut self) -> &mut [Entry<K, V>] {
        &mut self.entries[..]
    }
    #[inline]
    fn len_mut(&mut self) -> &mut usize {
        &mut self.len
    }
    #[inline]
    fn shift(&self) -> u8 {
        self.shift
    }
}

impl<
    K: Copy + Default + 'static,
    V: Copy + Default + 'static,
    Ctx: HashContext<K>,
    const MAX_LOAD_PERCENTAGE: u64,
> HashMap<K, V, Ctx, MAX_LOAD_PERCENTAGE>
{
    pub fn init_capacity(capacity: u64) -> Result<Self, AllocError> {
        debug_assert!(capacity.is_power_of_two());

        let shift = compute_shift(capacity);
        let overflow = compute_overflow(capacity, shift);

        let n = usize::try_from(capacity + overflow).expect("int cast");
        // Zig: gpa.alloc + @memset(.{})
        let entries = vec![Entry::<K, V>::empty(); n].into_boxed_slice();

        Ok(Self {
            entries,
            len: 0,
            shift,
            _ctx: PhantomData,
        })
    }

    // `deinit` → handled by `Drop` on `Box<[Entry]>`; no explicit impl needed.

    pub fn ensure_unused_capacity(&mut self, count: usize) -> Result<(), AllocError> {
        self.ensure_total_capacity(self.len + count)
    }

    pub fn ensure_total_capacity(&mut self, count: usize) -> Result<(), AllocError> {
        loop {
            let capacity = 1u64 << (63 - self.shift + 1);
            if (count as u64) <= capacity * MAX_LOAD_PERCENTAGE / 100 {
                break;
            }
            self.grow()?;
        }
        Ok(())
    }

    fn grow(&mut self) -> Result<(), AllocError> {
        let capacity = 1u64 << (63 - self.shift + 1);
        let overflow = compute_overflow(capacity, self.shift);
        let end = usize::try_from(capacity + overflow).expect("int cast");

        let mut map = Self::init_capacity(capacity * 2)?;

        // PORT NOTE: reshaped for borrowck — Zig walks raw `[*]Entry` pointers
        // (`src`, `dst`, `end`); here we iterate by index over the old slice and
        // index into the new boxed slice.
        let mut dst: usize = 0;
        let mut src: usize = 0;
        while src != end {
            let entry = self.entries[src];

            let i = if !entry.is_empty() {
                to_idx(entry.hash >> map.shift)
            } else {
                0
            };
            // Zig: dst = if (@intFromPtr(p) >= @intFromPtr(dst)) p else dst;
            if i >= dst {
                dst = i;
            }
            map.entries[dst] = entry;

            src += 1;
            dst += 1;
        }

        // Zig: self.deinit(gpa); — old Box drops on assignment below.
        self.entries = map.entries;
        self.shift = map.shift;
        Ok(())
    }

    pub fn put(&mut self, key: K, value: V) -> Result<(), AllocError> {
        self.ensure_unused_capacity(1)?;
        self.put_assume_capacity(key, value);
        Ok(())
    }

    pub fn put_context(&mut self, key: K, value: V, _ctx: Ctx) -> Result<(), AllocError> {
        self.put(key, value)
    }

    pub fn get_or_put(&mut self, key: K) -> Result<GetOrPutResult<'_, V>, AllocError> {
        self.ensure_unused_capacity(1)?;
        Ok(self.get_or_put_assume_capacity(key))
    }

    pub fn get_or_put_context(
        &mut self,
        key: K,
        _ctx: Ctx,
    ) -> Result<GetOrPutResult<'_, V>, AllocError> {
        self.get_or_put(key)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HashMapMixin — shared method bodies for StaticHashMap & HashMap
// ──────────────────────────────────────────────────────────────────────────

/// Mirrors Zig's `fn HashMapMixin(Self, K, V, Context) type`. Implementors
/// supply the backing storage; default methods provide the Robin-Hood logic.
pub trait HashMapMixin<K: 'static, V: 'static, Ctx> {
    fn storage(&self) -> &[Entry<K, V>];
    fn storage_mut(&mut self) -> &mut [Entry<K, V>];
    fn len_mut(&mut self) -> &mut usize;
    fn shift(&self) -> u8;

    fn clear_retaining_capacity(&mut self)
    where
        K: Copy + Default,
        V: Copy + Default,
    {
        self.storage_mut().fill(Entry::empty());
        *self.len_mut() = 0;
    }

    /// Full backing slice (capacity + overflow). Matches Zig's `slice()`.
    fn slice(&mut self) -> &mut [Entry<K, V>] {
        // Zig recomputes `capacity + overflow` from `shift`; with Box<[T]>/[T; N]
        // the storage already carries its exact length, so just return it.
        // PORT NOTE: assert kept for parity with Zig's implicit invariant.
        let capacity = 1u64 << (63 - self.shift() + 1);
        let overflow = compute_overflow(capacity, self.shift());
        debug_assert_eq!(
            self.storage_mut().len(),
            usize::try_from(capacity + overflow).expect("int cast")
        );
        self.storage_mut()
    }

    fn put_assume_capacity(&mut self, key: K, value: V)
    where
        K: Copy,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        let result = self.get_or_put_assume_capacity(key);
        if !result.found_existing {
            *result.value_ptr = value;
        }
    }

    fn put_assume_capacity_context(&mut self, key: K, value: V, _ctx: Ctx)
    where
        K: Copy,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        self.put_assume_capacity(key, value);
    }

    fn get_or_put_assume_capacity_context(&mut self, key: K, _ctx: Ctx) -> GetOrPutResult<'_, V>
    where
        K: Copy,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        self.get_or_put_assume_capacity(key)
    }

    fn get_or_put_assume_capacity(&mut self, key: K) -> GetOrPutResult<'_, V>
    where
        K: Copy,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        // PORT NOTE: Zig left `value = undefined` (never read until the caller
        // writes via `value_ptr`). Use `Default` for the placeholder — V may
        // not be zero-valid.
        let mut it: Entry<K, V> = Entry {
            hash: Ctx::ctx_hash(&key),
            key,
            value: V::default(),
        };
        let shift = self.shift();
        let mut i = to_idx(it.hash >> shift);

        debug_assert!(it.hash != EMPTY_HASH);

        let mut inserted_at: Option<usize> = None;
        loop {
            // PORT NOTE: reshaped for borrowck — copy entry out, drop borrow,
            // re-borrow mutably for write/return.
            let entry = self.storage()[i];
            if entry.hash >= it.hash {
                if Ctx::ctx_eql(&entry.key, &key) {
                    return GetOrPutResult {
                        found_existing: true,
                        value_ptr: &mut self.storage_mut()[i].value,
                    };
                }
                self.storage_mut()[i] = it;
                if entry.is_empty() {
                    *self.len_mut() += 1;
                    let idx = inserted_at.unwrap_or(i);
                    return GetOrPutResult {
                        found_existing: false,
                        value_ptr: &mut self.storage_mut()[idx].value,
                    };
                }
                if inserted_at.is_none() {
                    inserted_at = Some(i);
                }
                it = entry;
            }
            // self.put_probe_count += 1;
            i += 1;
        }
    }

    fn get_context(&self, key: K, _ctx: Ctx) -> Option<V>
    where
        K: Copy,
        V: Copy,
        Ctx: HashContext<K>,
    {
        self.get(key)
    }

    fn get(&self, key: K) -> Option<V>
    where
        K: Copy,
        V: Copy,
        Ctx: HashContext<K>,
    {
        let hash = Ctx::ctx_hash(&key);
        debug_assert!(hash != EMPTY_HASH);

        for entry in &self.storage()[to_idx(hash >> self.shift())..] {
            if entry.hash >= hash {
                if !Ctx::ctx_eql(&entry.key, &key) {
                    return None;
                }
                return Some(entry.value);
            }
            // self.get_probe_count += 1;
        }
        unreachable!()
    }

    fn has_context(&self, key: K, _ctx: Ctx) -> bool
    where
        K: Copy,
        Ctx: HashContext<K>,
    {
        self.has(key)
    }

    fn has_with_hash(&self, key_hash: u64) -> bool {
        debug_assert!(key_hash != EMPTY_HASH);

        for entry in &self.storage()[to_idx(key_hash >> self.shift())..] {
            if entry.hash >= key_hash {
                return entry.hash == key_hash;
            }
        }

        false
    }

    fn has(&self, key: K) -> bool
    where
        K: Copy,
        Ctx: HashContext<K>,
    {
        let hash = Ctx::ctx_hash(&key);
        debug_assert!(hash != EMPTY_HASH);

        for entry in &self.storage()[to_idx(hash >> self.shift())..] {
            if entry.hash >= hash {
                if !Ctx::ctx_eql(&entry.key, &key) {
                    return false;
                }
                return true;
            }
            // self.get_probe_count += 1;
        }
        unreachable!()
    }

    fn delete_context(&mut self, key: K, _ctx: Ctx) -> Option<V>
    where
        K: Copy + Default,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        self.delete(key)
    }

    fn delete(&mut self, key: K) -> Option<V>
    where
        K: Copy + Default,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        let hash = Ctx::ctx_hash(&key);
        debug_assert!(hash != EMPTY_HASH);

        let shift = self.shift();
        let mut i = to_idx(hash >> shift);
        loop {
            let entry = self.storage()[i];
            if entry.hash >= hash {
                if !Ctx::ctx_eql(&entry.key, &key) {
                    return None;
                }
                break;
            }
            // self.del_probe_count += 1;
            i += 1;
        }

        let value = self.storage()[i].value;

        loop {
            let next = self.storage()[i + 1];
            let j = to_idx(next.hash >> shift);
            if i < j || next.is_empty() {
                break;
            }
            self.storage_mut()[i] = next;
            // self.del_probe_count += 1;
            i += 1;
        }
        self.storage_mut()[i] = Entry::empty();
        *self.len_mut() -= 1;

        Some(value)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // TODO(port): Zig tests use `std.rand.DefaultPrng` (xoshiro256++). Need a
    // matching PRNG for byte-identical key sequences, or accept any PRNG since
    // these tests only check sortedness/round-trip, not specific keys.

    #[test]
    fn static_hash_map_put_get_delete_grow() {
        // TODO(port): blocked on generic_const_exprs for StaticHashMap inline array.
        // let mut map: StaticHashMap<usize, usize, AutoContext, 512, _> = Default::default();
        // for seed in 0..128 { ... }
    }

    #[test]
    fn hash_map_put_get_delete_grow() {
        // Miri is ~100× slower; 2 seeds still exercises grow (`shift` assert below).
        const SEEDS: u64 = if cfg!(miri) { 2 } else { 128 };
        for seed in 0..SEEDS {
            // TODO(port): replace with xoshiro256++ to match Zig DefaultPrng.
            let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(1);
            let mut next = || {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state
            };

            let mut keys = vec![0usize; 512];
            for k in keys.iter_mut() {
                *k = next() as usize;
            }

            let mut map = AutoHashMap::<usize, usize, 50>::init_capacity(16).unwrap();

            assert_eq!(map.shift, 60);

            for (i, &key) in keys.iter().enumerate() {
                map.put(key, i).unwrap();
            }

            assert_eq!(map.shift, 54);
            assert_eq!(map.len, keys.len());

            let mut it: u64 = 0;
            for entry in map.slice().iter() {
                if !entry.is_empty() {
                    assert!(it <= entry.hash, "Unsorted");
                    it = entry.hash;
                }
            }

            for (i, &key) in keys.iter().enumerate() {
                assert_eq!(map.get(key).unwrap(), i);
            }
            for (i, &key) in keys.iter().enumerate() {
                assert_eq!(map.delete(key).unwrap(), i);
            }
        }
    }
}

// ported from: src/collections/StaticHashMap.zig
