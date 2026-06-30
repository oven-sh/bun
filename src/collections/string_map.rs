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

    /// Dupe `value`; `key` is duped on miss regardless (`Box<[u8]>` forces a
    /// copy), so the `dupe_keys` flag is kept for API parity only.
    pub fn insert(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        let entry = self.map.get_or_put(key)?;
        // get_or_put already boxed `key` on miss; duping again here would be
        // the same allocation, so skip it.
        let _ = self.dupe_keys;
        *entry.value_ptr = Box::from(value);
        Ok(())
    }

    /// Alias for [`insert`](Self::insert).
    #[inline]
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        self.insert(key, value)
    }

    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.map.get(key).map(|v| &**v)
    }

    /// Forwards to the inner map's order-preserving sort. The closure
    /// receives the parallel key/value slices plus the two indices so it can
    /// compare on either column.
    pub fn sort(
        &mut self,
        less_than: impl FnMut(&[Box<[u8]>], &[Box<[u8]>], usize, usize) -> bool,
    ) {
        self.map.sort(less_than);
    }

    // `deinit` → Drop on the inner Vecs.
}
