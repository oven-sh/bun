use bun_collections::array_hash_map::{
    self, ArrayHashAdapter, ArrayHashContext, ArrayHashMap, Iter,
};

use crate::shell::EnvStr;

pub struct EnvMap {
    map: EnvMapInner,
}

pub(crate) type Iterator<'a> = Iter<'a, EnvStr, EnvStr>;

// Named `EnvMapInner` to avoid rustc confusing it with the unrelated mmap
// `sys::c::MapType` / `sys::posix::MapType` in diagnostic suggestions.
type EnvMapInner = ArrayHashMap<EnvStr, EnvStr, EnvMapContext>;

#[derive(Default)]
struct EnvMapContext;

impl EnvMapContext {
    #[inline]
    fn hash_bytes(s: &[u8]) -> u32 {
        #[cfg(windows)]
        {
            return <array_hash_map::CaseInsensitiveAsciiStringContext as ArrayHashContext<[u8]>>::hash(
                &array_hash_map::CaseInsensitiveAsciiStringContext::default(),
                s,
            );
        }
        #[cfg(not(windows))]
        {
            array_hash_map::hash_string(s)
        }
    }

    #[inline]
    fn eql_bytes(a: &[u8], b: &[u8]) -> bool {
        #[cfg(windows)]
        {
            // Must be length-checked: "PATH" must NOT match "PATHEXT".
            return bun_core::strings::eql_case_insensitive_asciii_check_length(a, b);
        }
        #[cfg(not(windows))]
        {
            a == b
        }
    }
}

impl ArrayHashContext<EnvStr> for EnvMapContext {
    fn hash(&self, s: &EnvStr) -> u32 {
        Self::hash_bytes(s.slice())
    }

    fn eql(&self, a: &EnvStr, b: &EnvStr, _b_index: usize) -> bool {
        Self::eql_bytes(a.slice(), b.slice())
    }
}

impl ArrayHashAdapter<[u8], EnvStr> for EnvMapContext {
    fn hash(&self, key: &[u8]) -> u32 {
        Self::hash_bytes(key)
    }

    fn eql(&self, a: &[u8], b: &EnvStr, _b_index: usize) -> bool {
        Self::eql_bytes(a, b.slice())
    }
}

impl EnvMap {
    pub(crate) fn init() -> EnvMap {
        EnvMap {
            map: EnvMapInner::new(),
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut size: usize = core::mem::size_of::<EnvMap>();
        size += core::mem::size_of_val(self.map.keys());
        size += core::mem::size_of_val(self.map.values());
        debug_assert_eq!(self.map.keys().len(), self.map.values().len());
        for (key, value) in self.map.keys().iter().zip(self.map.values()) {
            size += key.memory_cost();
            size += value.memory_cost();
        }
        size
    }

    pub(crate) fn init_with_capacity(cap: usize) -> EnvMap {
        EnvMap {
            map: EnvMapInner::with_capacity(cap),
        }
    }

    pub(crate) fn insert(&mut self, key: EnvStr, val: EnvStr) {
        let result = self.map.get_or_put(key).expect("OOM");
        *result.value_ptr = val;
    }

    pub(crate) fn iterator(&mut self) -> Iterator<'_> {
        self.map.iterator()
    }

    pub(crate) fn iter(&self) -> impl core::iter::Iterator<Item = (&EnvStr, &EnvStr)> {
        self.map.keys().iter().zip(self.map.values())
    }

    pub(crate) fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity).expect("OOM");
    }

    pub fn get(&self, key: &[u8]) -> Option<&EnvStr> {
        let i = self.map.get_index_adapted(key, &EnvMapContext)?;
        Some(&self.map.values()[i])
    }

    pub(crate) fn clone(&self) -> EnvMap {
        EnvMap {
            map: self.map.clone().expect("OOM"),
        }
    }
}
