//! `bun.StringMap`.
//!
//! A `StringArrayHashMap<Box<[u8]>>` plus a `dupe_keys` flag controlling
//! whether `insert` clones the key bytes. Values are always cloned.

use bun_alloc::AllocError;

use crate::array_hash_map::StringArrayHashMap;

pub struct StringMap {
    pub map: StringArrayHashMap<Box<[u8]>>,
    pub dupe_keys: bool,
}

impl Default for StringMap {
    fn default() -> Self {
        Self::init(false)
    }
}

impl StringMap {
    /// `init(allocator, dupe_keys)` — allocator dropped (global mimalloc).
    pub fn init(dupe_keys: bool) -> Self {
        Self {
            map: StringArrayHashMap::default(),
            dupe_keys,
        }
    }

    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self {
            map: self.map.clone()?,
            dupe_keys: self.dupe_keys,
        })
    }

    #[inline]
    pub fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    #[inline]
    pub fn values(&self) -> &[Box<[u8]>] {
        self.map.values()
    }

    #[inline]
    pub fn count(&self) -> usize {
        self.map.count()
    }

    /// `insert` / `put`: dupe `value`; dupe `key` only when `dupe_keys`
    /// and the key is new. (When `dupe_keys == false` the original stored a borrowed
    /// slice; here `Box<[u8]>` forces a copy regardless — the flag is kept for
    /// API parity and to skip the redundant second copy.)
    pub fn insert(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        let entry = self.map.get_or_put(key)?;
        // get_or_put already boxed `key` on miss; the original `dupe_keys` branch
        // would dupe again here — that's the same allocation, so skip it.
        let _ = self.dupe_keys;
        *entry.value_ptr = Box::from(value);
        Ok(())
    }

    /// Alias matching `pub const put = insert;`.
    #[inline]
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        self.insert(key, value)
    }

    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.map.get(key).map(|v| &**v)
    }

    // `sort` takes a generic ctx; defer until a caller needs it.
    // TODO(port): StringMap::sort — wire once ArrayHashMap::sort lands.

    // `deinit` → Drop on the inner Vecs.
}
