// https://github.com/lithdew/rheia/blob/162293d0f0e8d6572a8954c0add83f13f76b3cc6/hash_map.zig
// Apache License 2.0

use core::marker::PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// Context trait — `.hash(k)` / `.eql(a, b)`
// ──────────────────────────────────────────────────────────────────────────

// Canonical definitions live in `crate::zig_hash_map`; re-exported here so the
// path `bun_collections::static_hash_map::{HashContext, AutoContext}` keeps
// resolving for downstream callers.
pub use crate::zig_hash_map::{AutoHashContext as AutoContext, HashContext};

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Shared Entry / GetOrPutResult / constants
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_HASH: u64 = u64::MAX;

#[derive(Clone, Copy)]
pub struct Entry<K, V> {
    pub hash: u64,
    pub key: K,
    pub(crate) value: V,
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
        // Key/value of an empty entry (hash == EMPTY_HASH) are never read.
        // `mem::zeroed()` cannot be used here: K may be `&[u8]` (or any `Copy`
        // type with a niche), for which all-zero bytes violate the validity
        // invariant regardless of whether the value is later read. Use
        // `Default` for the unread placeholder instead.
        Self {
            hash: EMPTY_HASH,
            key: K::default(),
            value: V::default(),
        }
    }
}

pub use crate::hash_map::GetOrPutResult;

// ──────────────────────────────────────────────────────────────────────────
// const helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline]
const fn compute_shift(capacity: u64) -> u8 {
    (63 - capacity.ilog2() + 1) as u8
}

#[inline]
const fn compute_overflow(capacity: u64, shift: u8) -> u64 {
    (capacity / 10 + (63 - shift as u64 + 1)) << 1
}

/// Checked u64→usize narrowing for table indices.
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

// The inline `[Entry; CAPACITY + overflow]` array length depends on a const fn
// of `CAPACITY`, which requires nightly `feature(generic_const_exprs)`.
// Stable workaround (same as ArrayBitSet): callers pass `SLOTS = static_slots(CAPACITY)`
// as a second const param; a const-assert in `Default::default()` checks they match.
pub struct StaticHashMap<
    K,
    V,
    Ctx,
    const CAPACITY: usize,
    const SLOTS: usize, // = static_slots(CAPACITY), asserted in default()
> {
    pub entries: [Entry<K, V>; SLOTS],
    pub len: usize,
    /// Hash shift; always < 64, stored as u8.
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
// HashMapMixin — shared method bodies for StaticHashMap
// ──────────────────────────────────────────────────────────────────────────

/// Implementors supply the backing storage; default methods provide the
/// Robin-Hood logic.
pub trait HashMapMixin<K: 'static, V: 'static, Ctx> {
    fn storage(&self) -> &[Entry<K, V>];
    fn storage_mut(&mut self) -> &mut [Entry<K, V>];
    fn len_mut(&mut self) -> &mut usize;
    fn shift(&self) -> u8;

    /// Full backing slice (capacity + overflow).
    fn slice(&mut self) -> &mut [Entry<K, V>] {
        // The storage carries its exact length; the assert checks it stays
        // consistent with the `shift`-derived `capacity + overflow` size.
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

    fn get_or_put_assume_capacity(&mut self, key: K) -> GetOrPutResult<'_, V>
    where
        K: Copy,
        V: Copy + Default,
        Ctx: HashContext<K>,
    {
        // `value` is never read until the caller writes via `value_ptr`. Use
        // `Default` for the placeholder — V may not be zero-valid.
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
            // Copy the entry out, drop the borrow, re-borrow mutably for
            // write/return.
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

    fn has_with_hash(&self, key_hash: u64) -> bool {
        debug_assert!(key_hash != EMPTY_HASH);

        for entry in &self.storage()[to_idx(key_hash >> self.shift())..] {
            if entry.hash >= key_hash {
                return entry.hash == key_hash;
            }
        }

        false
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

    /// xoshiro256++ with the state seeded by splitmix64. `AutoHashContext`
    /// routes through `bun_wyhash::auto_hash` (mum-mix). The 100%-load probe
    /// bound of the static test was validated for this hash by exact
    /// simulation of all 128 seeds: max slot index touched (incl. delete's
    /// `i + 1` backshift read) is 548 of 632, with no 64-bit hash collisions
    /// among any seed's 512 keys.
    struct Xoshiro256PlusPlus {
        s: [u64; 4],
    }

    impl Xoshiro256PlusPlus {
        fn init(seed: u64) -> Self {
            fn splitmix64(state: &mut u64) -> u64 {
                *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
                let mut z = *state;
                z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
                z ^ (z >> 31)
            }
            let mut sm = seed;
            let mut s = [0u64; 4];
            for slot in s.iter_mut() {
                *slot = splitmix64(&mut sm);
            }
            Self { s }
        }

        fn next(&mut self) -> u64 {
            let s = &mut self.s;
            let result = s[0].wrapping_add(s[3]).rotate_left(23).wrapping_add(s[0]);
            let t = s[1] << 17;
            s[2] ^= s[0];
            s[3] ^= s[1];
            s[1] ^= s[2];
            s[0] ^= s[3];
            s[2] ^= t;
            s[3] = s[3].rotate_left(45);
            result
        }
    }

    #[test]
    fn static_hash_map_put_get_delete_grow() {
        const CAP: usize = 512;
        const SLOTS: usize = static_slots(CAP);
        // Boxed: ~15 KB of entries is fine on the heap, gratuitous on the stack.
        let mut map: Box<StaticHashMap<usize, usize, AutoContext, CAP, SLOTS>> =
            Box::new(Default::default());

        // Miri is ~100× slower; 2 seeds still cover the put/get/delete cycle.
        const SEEDS: u64 = if cfg!(miri) { 2 } else { 128 };
        for seed in 0..SEEDS {
            let mut rng = Xoshiro256PlusPlus::init(seed);

            let keys: Vec<usize> = (0..512).map(|_| rng.next() as usize).collect();

            assert_eq!(map.shift, 55);

            for (i, &key) in keys.iter().enumerate() {
                map.put_assume_capacity(key, i);
            }
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
