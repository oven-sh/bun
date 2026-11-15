use bun_collections::array_hash_map::{self, ArrayHashContext, ArrayHashMap};

use crate::shell::EnvStr;

pub(crate) struct EnvMap<'a> {
    map: EnvMapInner<'a>,
}

// Named `EnvMapInner` to avoid rustc confusing it with the unrelated mmap
// `sys::c::MapType` / `sys::posix::MapType` in diagnostic suggestions.
type EnvMapInner<'a> = ArrayHashMap<EnvStr<'a>, EnvStr<'a>, EnvMapContext>;

#[derive(Default)]
struct EnvMapContext;

impl<'a> ArrayHashContext<EnvStr<'a>> for EnvMapContext {
    fn hash(&self, s: &EnvStr<'a>) -> u32 {
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

    fn eql(&self, a: &EnvStr<'a>, b: &EnvStr<'a>, _b_index: usize) -> bool {
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

impl<'a> EnvMap<'a> {
    pub(crate) fn init() -> EnvMap<'a> {
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

    pub(crate) fn init_with_capacity(cap: usize) -> EnvMap<'a> {
        EnvMap {
            map: EnvMapInner::with_capacity(cap),
        }
    }

    pub(crate) fn insert(&mut self, key: EnvStr<'a>, val: EnvStr<'a>) {
        self.map.put(key, val).expect("OOM");
    }

    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = (&EnvStr<'a>, &EnvStr<'a>)> {
        self.map.keys().iter().zip(self.map.values())
    }

    pub(crate) fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity).expect("OOM");
    }

    pub(crate) fn get<'s>(&'s self, key: &'s [u8]) -> Option<&'s [u8]> {
        let map: &EnvMapInner<'s> = &self.map;
        map.get(&EnvStr::init_slice(key)).map(EnvStr::slice)
    }

    pub(crate) fn clone(&self) -> EnvMap<'a> {
        EnvMap {
            map: self.map.clone().expect("OOM"),
        }
    }
}
