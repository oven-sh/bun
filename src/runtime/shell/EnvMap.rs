use bun_collections::array_hash_map::{self, ArrayHashContext, ArrayHashMap, Iter};

use crate::shell::EnvStr;

pub(crate) struct EnvMap {
    map: EnvMapInner,
}

pub(crate) type Iterator<'a> = Iter<'a, EnvStr, EnvStr>;

// Named `EnvMapInner` to avoid rustc confusing it with the unrelated mmap
// `sys::c::MapType` / `sys::posix::MapType` in diagnostic suggestions.
type EnvMapInner = ArrayHashMap<EnvStr, EnvStr, EnvMapContext>;

#[derive(Default)]
struct EnvMapContext;

impl ArrayHashContext<EnvStr> for EnvMapContext {
    fn hash(&self, s: &EnvStr) -> u32 {
        #[cfg(windows)]
        {
            return <array_hash_map::CaseInsensitiveAsciiStringContext as ArrayHashContext<[u8]>>::hash(
                &array_hash_map::CaseInsensitiveAsciiStringContext::default(),
                s.slice(),
            );
        }
        #[cfg(not(windows))]
        {
            array_hash_map::hash_string(s.slice())
        }
    }

    fn eql(&self, a: &EnvStr, b: &EnvStr, _b_index: usize) -> bool {
        #[cfg(windows)]
        {
            // Must be length-checked: "PATH" must NOT match "PATHEXT".
            return bun_core::strings::eql_case_insensitive_asciii_check_length(
                a.slice(),
                b.slice(),
            );
        }
        #[cfg(not(windows))]
        {
            a.slice() == b.slice()
        }
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
        self.map.put(key, val).expect("OOM");
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

    pub(crate) fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.map.get(&EnvStr::init_slice(key)).map(EnvStr::slice)
    }

    pub(crate) fn clone(&self) -> EnvMap {
        EnvMap {
            map: self.map.clone().expect("OOM"),
        }
    }
}
