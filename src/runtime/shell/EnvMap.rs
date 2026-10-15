use bun_collections::array_hash_map::{self, ArrayHashContext, ArrayHashMap};

use crate::shell::EnvStr;

pub(crate) struct EnvMap {
    map: EnvMapInner,
}

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

    /// NOTE: This will `.ref()` value, so you should `defer value.deref()` it
    /// before handing it to this function!!!
    pub(crate) fn insert(&mut self, key: EnvStr, val: EnvStr) {
        let result = self.map.get_or_put(key).expect("OOM");
        if !result.found_existing {
            key.ref_();
        } else {
            result.value_ptr.deref();
        }
        val.ref_();
        *result.value_ptr = val;
    }

    pub(crate) fn iter(&self) -> impl core::iter::Iterator<Item = (&EnvStr, &EnvStr)> {
        self.map.keys().iter().zip(self.map.values())
    }

    pub(crate) fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity).expect("OOM");
    }

    /// NOTE: Make sure you deref the string when done!
    pub(crate) fn get(&self, key: EnvStr) -> Option<EnvStr> {
        let val = *self.map.get(&key)?;
        val.ref_();
        Some(val)
    }

    pub(crate) fn clone(&self) -> EnvMap {
        let new = EnvMap {
            map: self.map.clone().expect("OOM"),
        };
        new.ref_strings();
        new
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

// `VarTable` slot attributes. Zero is an exported variable that has a value,
// so an inherited environment needs no marking.
const LOCAL: u8 = 1 << 0;
const UNSET: u8 = 1 << 1;

const _: () = assert!(core::mem::size_of::<EnvStr>() == 16);

/// Every shell variable, one slot per name. The attribute bits of the slot say
/// if the name is exported and if it has a value.
pub(crate) struct VarTable {
    map: EnvMap,
}

impl VarTable {
    /// Every entry of `env` becomes an exported variable.
    pub(crate) fn from_exported(env: EnvMap) -> VarTable {
        VarTable { map: env }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.map.memory_cost()
    }

    pub(crate) fn clone(&self) -> VarTable {
        VarTable {
            map: self.map.clone(),
        }
    }

    /// `NAME=value`. The name keeps its export attribute.
    /// NOTE: This will `.ref()` value, like `EnvMap::insert`.
    pub(crate) fn set(&mut self, name: EnvStr, value: EnvStr) {
        let slot = self.map.map.get_or_put(name).expect("OOM");
        let attrs = if slot.found_existing {
            slot.value_ptr.deref();
            slot.value_ptr.var_attrs() & !UNSET
        } else {
            name.ref_();
            LOCAL
        };
        value.ref_();
        *slot.value_ptr = value.with_var_attrs(attrs);
    }

    /// `export NAME=value`, or `export NAME` for `None`: the name keeps its value.
    /// NOTE: This will `.ref()` value, like `EnvMap::insert`.
    pub(crate) fn export(&mut self, name: EnvStr, value: Option<EnvStr>) {
        let slot = self.map.map.get_or_put(name).expect("OOM");
        if !slot.found_existing {
            name.ref_();
        }
        match value {
            Some(value) => {
                slot.value_ptr.deref();
                value.ref_();
                *slot.value_ptr = value.with_var_attrs(0);
            }
            None if slot.found_existing => {
                let attrs = slot.value_ptr.var_attrs() & !LOCAL;
                *slot.value_ptr = slot.value_ptr.with_var_attrs(attrs);
            }
            None => *slot.value_ptr = slot.value_ptr.with_var_attrs(UNSET),
        }
    }

    /// The value of `$NAME`.
    /// NOTE: Make sure you deref the string when done!
    pub(crate) fn get(&self, name: EnvStr) -> Option<EnvStr> {
        let slot = *self.map.map.get(&name)?;
        if slot.var_attrs() & UNSET != 0 {
            return None;
        }
        let value = slot.with_var_attrs(0);
        value.ref_();
        Some(value)
    }

    /// The value a child process inherits for `name`.
    /// NOTE: Make sure you deref the string when done!
    pub(crate) fn get_exported(&self, name: EnvStr) -> Option<EnvStr> {
        let slot = *self.map.map.get(&name)?;
        if slot.var_attrs() != 0 {
            return None;
        }
        slot.ref_();
        Some(slot)
    }

    /// The environment of a child process: exported names that have a value.
    pub(crate) fn exported(&self) -> impl core::iter::Iterator<Item = (&EnvStr, &EnvStr)> {
        self.map.iter().filter(|(_, slot)| slot.var_attrs() == 0)
    }

    /// Every exported name. The value is `None` until the name is assigned.
    pub(crate) fn exported_names(
        &self,
    ) -> impl core::iter::Iterator<Item = (EnvStr, Option<EnvStr>)> + '_ {
        self.map
            .iter()
            .filter(|(_, slot)| slot.var_attrs() & LOCAL == 0)
            .map(|(name, slot)| (*name, (slot.var_attrs() & UNSET == 0).then_some(*slot)))
    }
}
