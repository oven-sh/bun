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

    /// NOTE: Make sure you deref the string when done!
    pub(crate) fn get(&self, key: EnvStr) -> Option<EnvStr> {
        let val = *self.map.get(&key)?;
        val.ref_();
        Some(val)
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

/// One shell variable.
#[derive(Copy, Clone, Default)]
enum Var {
    /// Exported, with a value: a child process inherits it.
    Exported(EnvStr),
    /// Has a value, not exported.
    Local(EnvStr),
    /// Exported, no value yet.
    #[default]
    ExportedUnset,
}

impl Var {
    fn value(self) -> Option<EnvStr> {
        match self {
            Var::Exported(value) | Var::Local(value) => Some(value),
            Var::ExportedUnset => None,
        }
    }
}

type VarMap = ArrayHashMap<EnvStr, Var, EnvMapContext>;

/// Every shell variable, one entry per name.
pub(crate) struct VarTable {
    map: VarMap,
}

impl VarTable {
    pub(crate) fn init() -> VarTable {
        VarTable { map: VarMap::new() }
    }

    pub(crate) fn init_with_capacity(cap: usize) -> VarTable {
        VarTable {
            map: VarMap::with_capacity(cap),
        }
    }

    pub(crate) fn ensure_total_capacity(&mut self, new_capacity: usize) {
        self.map.ensure_total_capacity(new_capacity).expect("OOM");
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut size: usize = core::mem::size_of::<VarTable>();
        size += core::mem::size_of_val(self.map.keys());
        size += core::mem::size_of_val(self.map.values());
        for (name, var) in self.map.iter() {
            size += name.memory_cost();
            size += var.value().map_or(0, EnvStr::memory_cost);
        }
        size
    }

    pub(crate) fn clone(&self) -> VarTable {
        let new = VarTable {
            map: self.map.clone().expect("OOM"),
        };
        for (name, var) in new.map.iter() {
            name.ref_();
            if let Some(value) = var.value() {
                value.ref_();
            }
        }
        new
    }

    /// `NAME=value`: the name keeps its export attribute. Refs `value`, like `EnvMap::insert`.
    pub(crate) fn set(&mut self, name: EnvStr, value: EnvStr) {
        let slot = self.map.get_or_put(name).expect("OOM");
        value.ref_();
        if !slot.found_existing {
            name.ref_();
            *slot.value_ptr = Var::Local(value);
            return;
        }
        *slot.value_ptr = match *slot.value_ptr {
            Var::Local(old) => {
                old.deref();
                Var::Local(value)
            }
            Var::Exported(old) => {
                old.deref();
                Var::Exported(value)
            }
            Var::ExportedUnset => Var::Exported(value),
        };
    }

    /// `export NAME=value`, or `export NAME` for `None`, which keeps the value. Refs `value`.
    pub(crate) fn export(&mut self, name: EnvStr, value: Option<EnvStr>) {
        let slot = self
            .map
            .get_or_put_value(name, Var::ExportedUnset)
            .expect("OOM");
        if !slot.found_existing {
            name.ref_();
        }
        match (value, *slot.value_ptr) {
            (Some(value), old) => {
                value.ref_();
                if let Some(old) = old.value() {
                    old.deref();
                }
                *slot.value_ptr = Var::Exported(value);
            }
            (None, Var::Local(value)) => *slot.value_ptr = Var::Exported(value),
            (None, Var::Exported(_) | Var::ExportedUnset) => {}
        }
    }

    /// The value of `$NAME`. Deref it when done, like `EnvMap::get`.
    pub(crate) fn get(&self, name: EnvStr) -> Option<EnvStr> {
        let value = self.map.get(&name)?.value()?;
        value.ref_();
        Some(value)
    }

    /// The value a child process inherits for `name`. Deref it when done.
    pub(crate) fn get_exported(&self, name: EnvStr) -> Option<EnvStr> {
        let Var::Exported(value) = *self.map.get(&name)? else {
            return None;
        };
        value.ref_();
        Some(value)
    }

    /// The environment of a child process, one entry per name: each exported name that has a value, then `prefixes`, which replace an exported name.
    pub(crate) fn child_env<'a>(
        &'a self,
        prefixes: Option<&'a EnvMap>,
    ) -> impl core::iter::Iterator<Item = (&'a EnvStr, &'a EnvStr)> {
        let (names, values): (&[EnvStr], &[EnvStr]) =
            prefixes.map_or((&[], &[]), |p| (p.map.keys(), p.map.values()));
        let replaced = move |name: &EnvStr| names.iter().any(|p| EnvMapContext.eql(p, name, 0));
        self.map
            .iter()
            .filter_map(move |(name, var)| match var {
                Var::Exported(value) if !replaced(name) => Some((name, value)),
                Var::Exported(_) | Var::Local(_) | Var::ExportedUnset => None,
            })
            .chain(names.iter().zip(values))
    }

    /// Every exported name. The value is `None` until the name is assigned.
    pub(crate) fn exported_names(
        &self,
    ) -> impl core::iter::Iterator<Item = (EnvStr, Option<EnvStr>)> + '_ {
        self.map.iter().filter_map(|(name, var)| match *var {
            Var::Exported(value) => Some((*name, Some(value))),
            Var::ExportedUnset => Some((*name, None)),
            Var::Local(_) => None,
        })
    }
}

impl Drop for VarTable {
    fn drop(&mut self) {
        for (name, var) in self.map.iter() {
            name.deref();
            if let Some(value) = var.value() {
                value.deref();
            }
        }
    }
}
