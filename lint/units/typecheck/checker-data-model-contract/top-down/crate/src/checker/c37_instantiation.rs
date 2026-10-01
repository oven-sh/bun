// checker.go 22214-22293 (c37_instantiation): instantiateType and the caches of the active mappers.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::RelationComparisonResult;
use crate::checker::ids::{TypeAliasId, TypeMapperId};
use crate::checker::keys::{CacheHashKey, KeyBuilder};
use crate::diagnostics;
use crate::tscore::golang::Map;
use crate::tscore::ids::TypeId;

impl Checker<'_> {
    pub fn instantiate_type(&mut self, t: TypeId, m: TypeMapperId) -> TypeId {
        self.instantiate_type_with_alias(t, m, TypeAliasId::NIL)
    }

    pub fn instantiate_type_with_alias(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        // Type variables in the alias are checked as well: see the comment at checker.go 22219.
        if t.is_nil()
            || m.is_nil()
            || !(self.could_contain_type_variables(t)
                || (!self.types[t].alias.is_nil()
                    && self.type_aliases[self.types[t].alias].type_arguments.len() > 0
                    && {
                        let type_arguments = self.type_aliases[self.types[t].alias].type_arguments;
                        self.some(type_arguments.as_slice(), |c, t| {
                            c.could_contain_type_variables(t)
                        })
                    }))
        {
            return t;
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.instantiation_depth == 100 || self.instantiation_count >= 5_000_000 {
            // 100 recursive type instantiations, or 5M type instantiations caused by the same statement or expression.
            self.error(
                self.current_node,
                diagnostics::Type_instantiation_is_excessively_deep_and_possibly_infinite,
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
        self.total_instantiation_count += 1;
        self.instantiation_count += 1;
        self.instantiation_depth += 1;
        let result = self.instantiate_type_worker(t, m, alias);
        if index == -1 {
            self.pop_active_mapper();
        } else {
            let ok = self.active_mapper_cache_mut(cache).set(key, result);
            self.map_set(ok);
        }
        self.instantiation_depth -= 1;
        result
    }

    // `c.activeTypeMappersCaches[i]`: the slice keeps its maps beyond its length, so the length is a field.
    fn active_mapper_cache(&self, index: isize) -> &Map<CacheHashKey, TypeId> {
        match usize::try_from(index)
            .ok()
            .filter(|&i| i < self.active_type_mappers_caches_len)
            .and_then(|i| self.active_type_mappers_caches.get(i))
        {
            Some(cache) => cache,
            None => {
                self.index_out_of_range("activeTypeMappersCaches[i]");
                &self.nil_cache
            }
        }
    }

    fn active_mapper_cache_mut(&mut self, index: isize) -> &mut Map<CacheHashKey, TypeId> {
        let in_range = usize::try_from(index)
            .ok()
            .filter(|&i| i < self.active_type_mappers_caches_len);
        match in_range.and_then(|i| self.active_type_mappers_caches.get_mut(i)) {
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
            self.index_out_of_range("popActiveMapper: activeMappers[-1]");
        }
        // Clear the map, but leave it in the list for later reuse.
        let Some(last_index) = self.active_type_mappers_caches_len.checked_sub(1) else {
            self.index_out_of_range("popActiveMapper: activeTypeMappersCaches[-1]");
            return;
        };
        if let Some(cache) = self.active_type_mappers_caches.get_mut(last_index) {
            cache.clear();
        }
        self.active_type_mappers_caches_len = last_index;
    }

    pub fn find_active_mapper(&mut self, mapper: TypeMapperId) -> isize {
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

    // The field `couldContainTypeVariables` holds the method value `couldContainTypeVariablesWorker`.
    pub fn could_contain_type_variables(&mut self, t: TypeId) -> bool {
        self.could_contain_type_variables_worker(t)
    }

    // The scripted set is a hook of this scratch: the tests name the types that contain type variables.
    pub fn could_contain_type_variables_worker(&mut self, t: TypeId) -> bool {
        self.stand_ins.record("couldContainTypeVariablesWorker");
        self.scripted_type_variables.has(t)
    }

    // The worker maps a type that a test named through the mapper and counts as not ported.
    pub fn instantiate_type_worker(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let _ = alias;
        self.stand_ins.record("instantiateTypeWorker");
        self.map(m, t)
    }

    // checker.go 1142-1154
    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNRELIABLE;
        }
        t
    }

    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNMEASURABLE;
        }
        t
    }
}
