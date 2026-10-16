use core::hash::{BuildHasher, Hash, Hasher};
use core::ptr::NonNull;

use bun_paths::fs::Path;
use hashbrown::hash_map::RawEntryMut;

use crate::IndexStringMap::IndexInt;

/// The identity of a module: the text of its resolved path and the namespace
/// of that path. The `file` namespace is stored as the empty namespace.
///
/// The hash covers the text alone, so a path in the `file` namespace hashes as
/// its text, and a lookup hashes the text it was given without building a key.
struct ModuleKey {
    /// The text, then the namespace. One allocation that the key owns.
    bytes: NonNull<u8>,
    text_len: u32,
    namespace_len: u32,
}

// SAFETY: `bytes` is a `Box<[u8]>` that only this key reaches. Nothing reads it
// through a shared alias that outlives `&self`.
unsafe impl Send for ModuleKey {}
// SAFETY: the key has no interior mutability.
unsafe impl Sync for ModuleKey {}

impl ModuleKey {
    fn new(namespace: &[u8], text: &[u8]) -> Self {
        let mut bytes = Vec::with_capacity(text.len() + namespace.len());
        bytes.extend_from_slice(text);
        bytes.extend_from_slice(namespace);
        let bytes = Box::into_raw(bytes.into_boxed_slice());
        Self {
            // SAFETY: `Box::into_raw` never returns null.
            bytes: unsafe { NonNull::new_unchecked(bytes.cast::<u8>()) },
            text_len: u32::try_from(text.len()).expect("int cast"),
            namespace_len: u32::try_from(namespace.len()).expect("int cast"),
        }
    }

    #[inline]
    fn text(&self) -> &[u8] {
        // SAFETY: `bytes` points at `text_len + namespace_len` initialised bytes
        // for the lifetime of `self`.
        unsafe { core::slice::from_raw_parts(self.bytes.as_ptr(), self.text_len as usize) }
    }

    #[inline]
    fn namespace(&self) -> &[u8] {
        // SAFETY: see `text`.
        unsafe {
            core::slice::from_raw_parts(
                self.bytes.as_ptr().add(self.text_len as usize),
                self.namespace_len as usize,
            )
        }
    }

    #[inline]
    fn is(&self, namespace: &[u8], text: &[u8]) -> bool {
        self.text() == text && self.namespace() == namespace
    }
}

impl Drop for ModuleKey {
    fn drop(&mut self) {
        let len = self.text_len as usize + self.namespace_len as usize;
        // SAFETY: `bytes` and `len` are the `Box<[u8]>` that `new` leaked.
        unsafe {
            drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                self.bytes.as_ptr(),
                len,
            )));
        }
    }
}

impl Hash for ModuleKey {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.text().hash(state);
    }
}

impl PartialEq for ModuleKey {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.is(other.namespace(), other.text())
    }
}
impl Eq for ModuleKey {}

/// The namespace a path is keyed under.
#[inline]
fn key_namespace<'a>(path: &Path<'a>) -> &'a [u8] {
    if path.is_file() { b"" } else { path.namespace }
}

/// A table of modules. Two paths are one module when their namespaces and
/// their texts are equal. No lookup allocates.
pub struct ModuleMap<V> {
    map: hashbrown::HashMap<ModuleKey, V, bun_wyhash::BuildHasher>,
}

impl<V> Default for ModuleMap<V> {
    fn default() -> Self {
        Self {
            map: hashbrown::HashMap::default(),
        }
    }
}

pub type PathToSourceIndexMap = ModuleMap<IndexInt>;

pub(crate) type GetOrPutResult<'a, V> = bun_collections::string_hash_map::GetOrPutResult<'a, V>;

impl<V> ModuleMap<V> {
    #[inline]
    fn hash(&self, text: &[u8]) -> u64 {
        self.map.hasher().hash_one(text)
    }

    fn get_key(&self, namespace: &[u8], text: &[u8]) -> Option<&V> {
        self.map
            .raw_entry()
            .from_hash(self.hash(text), |key| key.is(namespace, text))
            .map(|(_, value)| value)
    }

    fn get_or_put_key(&mut self, namespace: &[u8], text: &[u8]) -> GetOrPutResult<'_, V>
    where
        V: Default,
    {
        let hash = self.hash(text);
        match self
            .map
            .raw_entry_mut()
            .from_hash(hash, |key| key.is(namespace, text))
        {
            RawEntryMut::Occupied(entry) => GetOrPutResult {
                found_existing: true,
                value_ptr: entry.into_mut(),
            },
            RawEntryMut::Vacant(entry) => GetOrPutResult {
                found_existing: false,
                value_ptr: entry
                    .insert_hashed_nocheck(hash, ModuleKey::new(namespace, text), V::default())
                    .1,
            },
        }
    }

    fn remove_key(&mut self, namespace: &[u8], text: &[u8]) -> bool {
        let hash = self.hash(text);
        match self
            .map
            .raw_entry_mut()
            .from_hash(hash, |key| key.is(namespace, text))
        {
            RawEntryMut::Occupied(entry) => {
                entry.remove();
                true
            }
            RawEntryMut::Vacant(_) => false,
        }
    }

    pub(crate) fn get(&self, path: &Path<'_>) -> Option<V>
    where
        V: Copy,
    {
        self.get_key(key_namespace(path), path.text).copied()
    }

    /// `get` for a path in the `file` namespace, from its text.
    pub(crate) fn get_file(&self, text: &[u8]) -> Option<V>
    where
        V: Copy,
    {
        self.get_key(b"", text).copied()
    }

    pub(crate) fn get_or_put(
        &mut self,
        path: &Path<'_>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError>
    where
        V: Default,
    {
        Ok(self.get_or_put_key(key_namespace(path), path.text))
    }

    pub(crate) fn put(&mut self, path: &Path<'_>, value: V) -> Result<(), bun_alloc::AllocError>
    where
        V: Default,
    {
        *self.get_or_put_key(key_namespace(path), path.text).value_ptr = value;
        Ok(())
    }

    /// `put` for a path in the `file` namespace, from its text.
    pub(crate) fn put_file(&mut self, text: &[u8], value: V) -> Result<(), bun_alloc::AllocError>
    where
        V: Default,
    {
        *self.get_or_put_key(b"", text).value_ptr = value;
        Ok(())
    }

    /// Removes the module of a path in the `file` namespace, from its text.
    pub fn remove_file(&mut self, text: &[u8]) -> bool {
        self.remove_key(b"", text)
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.map.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
    }

    pub(crate) fn values(&self) -> impl Iterator<Item = &V> {
        self.map.values()
    }
}
