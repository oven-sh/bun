use bun_collections::ArrayHashMap;
use bun_shell::EnvStr;

pub struct EnvMap {
    map: MapType,
}

// TODO(port): bun_collections::ArrayHashMap needs a custom-context generic param
// matching Zig's `std.ArrayHashMap(K, V, Context, store_hash=true)`.
pub type Iterator<'a> = bun_collections::array_hash_map::Iterator<'a, EnvStr, EnvStr>;

type MapType = ArrayHashMap<EnvStr, EnvStr, EnvMapContext>;

struct EnvMapContext;

impl bun_collections::array_hash_map::Context<EnvStr> for EnvMapContext {
    fn hash(&self, s: &EnvStr) -> u32 {
        #[cfg(windows)]
        {
            return bun_core::CaseInsensitiveAsciiStringContext::hash(s.slice());
        }
        #[cfg(not(windows))]
        {
            bun_collections::array_hash_map::hash_string(s.slice())
        }
    }

    fn eql(&self, a: &EnvStr, b: &EnvStr, _b_index: usize) -> bool {
        #[cfg(windows)]
        {
            return bun_core::CaseInsensitiveAsciiStringContext::eql(a.slice(), b.slice());
        }
        #[cfg(not(windows))]
        {
            bun_collections::array_hash_map::eql_string(a.slice(), b.slice())
        }
    }
}

impl EnvMap {
    pub fn init() -> EnvMap {
        EnvMap { map: MapType::new() }
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
        let mut map = MapType::new();
        map.ensure_total_capacity(cap);
        EnvMap { map }
    }

    /// NOTE: This will `.ref()` value, so you should `defer value.deref()` it
    /// before handing it to this function!!!
    pub fn insert(&mut self, key: EnvStr, val: EnvStr) {
        let result = self.map.get_or_put(key);
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

    pub fn clear_retaining_capacity(&mut self) {
        self.deref_strings();
        self.map.clear();
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity);
    }

    /// NOTE: Make sure you deref the string when done!
    pub fn get(&mut self, key: EnvStr) -> Option<EnvStr> {
        let Some(val) = self.map.get(key) else { return None };
        val.ref_();
        Some(val)
    }

    pub fn clone(&mut self) -> EnvMap {
        let mut new = EnvMap {
            map: self.map.clone(),
        };
        new.ref_strings();
        new
    }

    // PORT NOTE: allocator param dropped (global mimalloc); identical to `clone` now.
    pub fn clone_with_allocator(&mut self) -> EnvMap {
        let mut new = EnvMap {
            map: self.map.clone(),
        };
        new.ref_strings();
        new
    }

    fn ref_strings(&mut self) {
        let mut iter = self.map.iterator();
        while let Some(entry) = iter.next() {
            entry.key_ptr.ref_();
            entry.value_ptr.ref_();
        }
    }

    fn deref_strings(&mut self) {
        let mut iter = self.map.iterator();
        while let Some(entry) = iter.next() {
            entry.key_ptr.deref();
            entry.value_ptr.deref();
        }
    }
}

impl Drop for EnvMap {
    fn drop(&mut self) {
        self.deref_strings();
        // map storage freed by its own Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/EnvMap.zig (119 lines)
//   confidence: medium
//   todos:      1
//   notes:      ArrayHashMap needs custom Context param (Windows case-insensitive); allocator params dropped per §Allocators
// ──────────────────────────────────────────────────────────────────────────
