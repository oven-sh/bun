//! `ModuleTable`: the dev server's tables of modules, in insertion order.

use bun_ast::{Loader, ModuleKey};
use bun_collections::StringArrayHashMap;
use bun_collections::array_hash_map::{ArrayHashAdapter, ArrayHashContext, StringContext};
use enum_map::Enum as _;

use super::memory_cost::{memory_cost_array_hash_map, memory_cost_array_list};

/// A module is its resolved path plus a key loader (see `ModuleKey`), so two slots can hold one path.
/// Slot `i` has the path `keys()[i]` and the key loader `key_loaders[i]`.
pub(crate) struct ModuleTable<V> {
    /// Keys are paths. Every lookup goes through `KeyAdapter`: the map's own lookups compare the path alone.
    map: StringArrayHashMap<V>,
    /// Parallel to `map`.
    key_loaders: Vec<Option<Loader>>,
    /// The count of slots that have a key loader.
    keyed_count: usize,
}

/// See `bun_collections::GetOrPutResult`. A new slot already has its key.
pub(crate) struct GetOrPutResult<'a, V> {
    pub(crate) found_existing: bool,
    pub(crate) index: usize,
    pub(crate) value_ptr: &'a mut V,
}

struct KeyAdapter<'a> {
    key_loaders: &'a [Option<Loader>],
}

impl ArrayHashAdapter<ModuleKey<'_>, Box<[u8]>> for KeyAdapter<'_> {
    /// The hash of the map's own context, so `re_index` keeps every stored hash valid.
    #[inline]
    fn hash(&self, key: &ModuleKey<'_>) -> u32 {
        ArrayHashContext::hash(&StringContext, key.path())
    }

    #[inline]
    fn eql(&self, a: &ModuleKey<'_>, b: &Box<[u8]>, b_index: usize) -> bool {
        self.key_loaders[b_index] == a.key_loader() && **b == *a.path()
    }
}

impl<V> Default for ModuleTable<V> {
    fn default() -> Self {
        Self {
            map: StringArrayHashMap::default(),
            key_loaders: Vec::new(),
            keyed_count: 0,
        }
    }
}

impl<V> ModuleTable<V> {
    #[inline]
    pub(crate) fn count(&self) -> usize {
        self.map.count()
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// The path of each slot.
    #[inline]
    pub(crate) fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    #[inline]
    pub(crate) fn values(&self) -> &[V] {
        self.map.values()
    }

    #[inline]
    pub(crate) fn values_mut(&mut self) -> &mut [V] {
        self.map.values_mut()
    }

    #[inline]
    pub(crate) fn key_at(&self, index: usize) -> ModuleKey<'_> {
        ModuleKey::new(&self.map.keys()[index], self.key_loaders[index])
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (ModuleKey<'_>, &V)> {
        (0..self.count()).map(|index| (self.key_at(index), &self.map.values()[index]))
    }

    #[inline]
    pub(crate) fn get_index(&self, key: ModuleKey<'_>) -> Option<usize> {
        self.map.get_index_adapted(
            &key,
            &KeyAdapter {
                key_loaders: &self.key_loaders,
            },
        )
    }

    pub(crate) fn get(&self, key: ModuleKey<'_>) -> Option<&V> {
        self.get_index(key).map(|index| &self.map.values()[index])
    }

    /// The slots that hold `path`, under any key loader.
    pub(crate) fn modules_of_path<'a>(
        &'a self,
        path: &'a [u8],
    ) -> impl Iterator<Item = usize> + 'a {
        let keyed = (self.keyed_count > 0).then(|| {
            (0..Loader::LENGTH).filter_map(move |i| {
                self.get_index(ModuleKey::new(path, Some(Loader::from_usize(i))))
            })
        });
        self.get_index(ModuleKey::of_path(path))
            .into_iter()
            .chain(keyed.into_iter().flatten())
    }

    /// True if a slot has a key loader. Only then can two slots hold one path.
    #[inline]
    pub(crate) fn has_key_loaders(&self) -> bool {
        self.keyed_count > 0
    }

    /// True if another slot holds the path of slot `index`.
    pub(crate) fn path_has_other_module(&self, index: usize) -> bool {
        self.has_key_loaders()
            && self
                .modules_of_path(&self.map.keys()[index])
                .any(|other| other != index)
    }

    /// Frees the key of a slot. The slot keeps its index, so the indices of the other slots stay valid.
    pub(crate) fn tombstone(&mut self, index: usize) {
        self.map.keys_mut()[index] = Box::default();
        if self.key_loaders[index].take().is_some() {
            self.keyed_count -= 1;
        }
    }

    /// Removes the slot of `key`. The last slot takes its index.
    pub(crate) fn swap_remove(&mut self, key: ModuleKey<'_>) -> Option<V> {
        let index = self.get_index(key)?;
        let (_, value) = self.map.swap_remove_at(index);
        if self.key_loaders.swap_remove(index).is_some() {
            self.keyed_count -= 1;
        }
        Some(value)
    }

    /// Does not count the paths.
    pub(crate) fn memory_cost(&self) -> usize {
        memory_cost_array_hash_map(&self.map) + memory_cost_array_list(&self.key_loaders)
    }
}

impl<V: Default> ModuleTable<V> {
    /// A new slot holds `V::default()`.
    pub(crate) fn get_or_put(
        &mut self,
        key: ModuleKey<'_>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        debug_assert_eq!(self.key_loaders.len(), self.map.count());
        let gop = self.map.get_or_put_adapted(
            &key,
            &KeyAdapter {
                key_loaders: &self.key_loaders,
            },
        )?;
        if !gop.found_existing {
            *gop.key_ptr = Box::from(key.path());
            self.key_loaders.push(key.key_loader());
            self.keyed_count += usize::from(key.key_loader().is_some());
        }
        Ok(GetOrPutResult {
            found_existing: gop.found_existing,
            index: gop.index,
            value_ptr: gop.value_ptr,
        })
    }
}
