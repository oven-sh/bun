use bun_collections::array_hash_map::{self, ArrayHashContext, ArrayHashMap, Iter};

use crate::shell::EnvStr;

pub struct EnvMap {
    map: EnvMapInner,
}

// PORT NOTE: Zig used `std.ArrayHashMap(K, V, Context, store_hash=true)`.
// `bun_collections::ArrayHashMap` already takes a `C: ArrayHashContext<K>` param.
pub type Iterator<'a> = Iter<'a, EnvStr, EnvStr>;

// PORT NOTE: Zig calls this `MapType`. Renamed to avoid rustc confusing it with the
// unrelated mmap `sys::c::MapType` / `sys::posix::MapType` in diagnostic suggestions.
type EnvMapInner = ArrayHashMap<EnvStr, EnvStr, EnvMapContext>;

#[derive(Default)]
struct EnvMapContext;

impl ArrayHashContext<EnvStr> for EnvMapContext {
    fn hash(&self, s: &EnvStr) -> u32 {
        #[cfg(windows)]
        {
            // Zig: `bun.CaseInsensitiveASCIIStringContext.hash(undefined, s.slice())`.
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
            // Zig: `bun.CaseInsensitiveASCIIStringContext.eql` → `eqlCaseInsensitiveASCIIICheckLength`.
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
    pub fn init() -> EnvMap {
        EnvMap {
            map: EnvMapInner::new(),
        }
    }

    pub fn memory_cost(&self) -> usize {
        let mut size: usize = core::mem::size_of::<EnvMap>();
        size += self.map.keys().len() * core::mem::size_of::<EnvStr>();
        size += self.map.values().len() * core::mem::size_of::<EnvStr>();
        debug_assert_eq!(self.map.keys().len(), self.map.values().len());
        for (key, value) in self.map.keys().iter().zip(self.map.values()) {
            size += key.memory_cost();
            size += value.memory_cost();
        }
        size
    }

    pub fn init_with_capacity(cap: usize) -> EnvMap {
        EnvMap {
            map: EnvMapInner::with_capacity(cap),
        }
    }

    /// NOTE: This will `.ref()` value, so you should `defer value.deref()` it
    /// before handing it to this function!!!
    pub fn insert(&mut self, key: EnvStr, val: EnvStr) {
        // PORT NOTE: `bun.handleOom` → `.expect("OOM")` (abort-on-OOM is the Rust default).
        let result = self.map.get_or_put(key).expect("OOM");
        if !result.found_existing {
            key.ref_();
        } else {
            result.value_ptr.deref();
        }
        val.ref_();
        *result.value_ptr = val;
    }

    pub fn iterator(&mut self) -> Iterator<'_> {
        self.map.iterator()
    }

    pub fn iter(&self) -> impl core::iter::Iterator<Item = (&EnvStr, &EnvStr)> {
        self.map.keys().iter().zip(self.map.values())
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.deref_strings();
        self.map.clear_retaining_capacity();
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity).expect("OOM");
    }

    /// NOTE: Make sure you deref the string when done!
    pub fn get(&self, key: EnvStr) -> Option<EnvStr> {
        let val = *self.map.get(&key)?;
        val.ref_();
        Some(val)
    }

    pub fn clone(&self) -> EnvMap {
        let new = EnvMap {
            map: self.map.clone().expect("OOM"),
        };
        new.ref_strings();
        new
    }

    // PORT NOTE: allocator param dropped (global mimalloc); identical to `clone` now.
    pub fn clone_with_allocator(&self) -> EnvMap {
        self.clone()
    }

    fn ref_strings(&self) {
        for (key, value) in self.map.keys().iter().zip(self.map.values()) {
            key.ref_();
            value.ref_();
        }
    }

    fn deref_strings(&self) {
        for (key, value) in self.map.keys().iter().zip(self.map.values()) {
            key.deref();
            value.deref();
        }
    }
}

impl Drop for EnvMap {
    fn drop(&mut self) {
        self.deref_strings();
        // map storage freed by its own Drop
    }
}

// ported from: src/shell/EnvMap.zig
