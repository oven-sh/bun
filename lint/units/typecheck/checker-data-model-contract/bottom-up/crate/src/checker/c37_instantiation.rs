// checker.go 22214-22285 (c37_instantiation): instantiateType and the stack of active mappers.
use crate::checker::c30_type_keys::{CacheHashKey, KeyBuilder};
use crate::checker::checker::Checker;
use crate::diagnostics;
use crate::tscore::golang::Map;
use crate::tscore::ids::{TypeAliasId, TypeId, TypeMapperId};

impl<'a> Checker<'a> {
    pub fn instantiate_type(&mut self, t: TypeId, m: TypeMapperId) -> TypeId {
        self.instantiate_type_with_alias(t, m, TypeAliasId::NIL)
    }

    pub fn instantiate_type_with_alias(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        // Check for type variables in the alias, so things like `type Brand<T> = number & {}` can potentially be copied with new alias type args, despite them being unreferenced.
        if t.is_nil() || m.is_nil() {
            return t;
        }
        if !self.could_contain_type_variables(t) {
            let t_alias = self.types[t].alias;
            let alias_arguments = self.alias_type_arguments(t_alias);
            if !(!t_alias.is_nil()
                && alias_arguments.len() > 0
                && alias_arguments
                    .iter()
                    .any(|a| self.could_contain_type_variables(a)))
            {
                return t;
            }
        }
        if self.instantiation_depth == 100 || self.instantiation_count >= 5_000_000 {
            // We have reached 100 recursive type instantiations, or 5M type instantiations caused by the same statement or expression.
            self.error(
                self.current_node,
                diagnostics::TYPE_INSTANTIATION_IS_EXCESSIVELY_DEEP_AND_POSSIBLY_INFINITE,
                &[],
            );
            return self.error_type;
        }
        let index = self.find_active_mapper(m);
        if index == -1 {
            self.push_active_mapper(m);
        }
        let mut b = KeyBuilder::default();
        b.write_type(t);
        b.write_alias(self, alias);
        let key = b.hash();
        let cache = if index != -1 {
            index
        } else {
            self.active_type_mappers_caches_len as isize - 1
        };
        if let Some(cached_type) = self.active_mapper_cache(cache).get_ok(&key) {
            return cached_type;
        }
        self.total_instantiation_count = self.total_instantiation_count.wrapping_add(1);
        self.instantiation_count = self.instantiation_count.wrapping_add(1);
        self.instantiation_depth = self.instantiation_depth.wrapping_add(1);
        let result = self.instantiate_type_worker(t, m, alias);
        if index == -1 {
            self.pop_active_mapper();
        } else {
            let ok = self.active_mapper_cache_mut(cache).set(key, result);
            self.map_set(ok);
        }
        self.instantiation_depth = self.instantiation_depth.wrapping_sub(1);
        result
    }

    // `c.activeTypeMappersCaches[index]`: the slice keeps emptied maps beyond its length, so the length is a field.
    fn active_mapper_cache(&self, index: isize) -> &Map<CacheHashKey, TypeId> {
        match usize::try_from(index)
            .ok()
            .filter(|&i| i < self.active_type_mappers_caches_len)
            .and_then(|i| self.active_type_mappers_caches.get(i))
        {
            Some(cache) => cache,
            None => &self.nil_cache,
        }
    }

    fn active_mapper_cache_mut(&mut self, index: isize) -> &mut Map<CacheHashKey, TypeId> {
        match usize::try_from(index)
            .ok()
            .filter(|&i| i < self.active_type_mappers_caches_len)
            .and_then(|i| self.active_type_mappers_caches.get_mut(i))
        {
            Some(cache) => cache,
            None => &mut self.nil_cache,
        }
    }

    pub fn push_active_mapper(&mut self, mapper: TypeMapperId) {
        self.active_mappers.push(mapper);
        let last_index = self.active_type_mappers_caches_len;
        if self.active_type_mappers_caches.len() > last_index {
            // The cap may contain an empty map from popActiveMapper; reuse it.
            self.active_type_mappers_caches_len = last_index + 1;
            if let Some(cache) = self.active_type_mappers_caches.get_mut(last_index) {
                if cache.is_nil() {
                    *cache = Map::make();
                }
            }
        } else {
            self.active_type_mappers_caches.push(Map::make());
            self.active_type_mappers_caches_len = last_index + 1;
        }
    }

    pub fn pop_active_mapper(&mut self) {
        if self.active_mappers.pop().is_none() {
            return self.fail("index out of range [-1]");
        }
        // Clear the map, but leave it in the list for later reuse.
        let Some(last_index) = self.active_type_mappers_caches_len.checked_sub(1) else {
            return self.fail("index out of range [-1]");
        };
        if let Some(cache) = self.active_type_mappers_caches.get_mut(last_index) {
            cache.clear();
        }
        self.active_type_mappers_caches_len = last_index;
    }

    pub fn find_active_mapper(&self, mapper: TypeMapperId) -> isize {
        // core.FindLastIndex
        let mut i = self.active_mappers.len() as isize - 1;
        while i >= 0 {
            if self.active_mappers.get(i as usize).copied() == Some(mapper) {
                return i;
            }
            i -= 1;
        }
        -1
    }

    pub fn clear_active_mapper_caches(&mut self) {
        let len = self.active_type_mappers_caches_len;
        for cache in self.active_type_mappers_caches.iter_mut().take(len) {
            cache.clear();
        }
    }

    // The field `couldContainTypeVariables` holds the method value `couldContainTypeVariablesWorker` (checker.go 1259).
    pub fn could_contain_type_variables(&mut self, t: TypeId) -> bool {
        self.could_contain_type_variables_worker(t)
    }
}
