// checker.go:22214-22296 and mapper.go.
use crate::checker::Checker;
use crate::golang::Map;
use crate::ids::*;
use crate::keys::KeyBuilder;
use crate::types::{FunctionMapper, TypeMapper};

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
        if t.is_nil()
            || m.is_nil()
            || !(self.could_contain_type_variables(t)
                || (!self.types[t].alias.is_nil()
                    && self.type_aliases[self.types[t].alias].type_arguments.len() > 0
                    && self.some_could_contain_type_variables(
                        self.type_aliases[self.types[t].alias].type_arguments,
                    )))
        {
            return t;
        }
        if self.instantiation_depth == 100 || self.instantiation_count >= 5_000_000 {
            // We have reached 100 recursive type instantiations, or 5M type instantiations caused by the same statement or expression.
            self.error(self.current_node, MessageId(2589));
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

    fn active_mapper_cache(&self, index: isize) -> &Map<CacheKey, TypeId> {
        match usize::try_from(index)
            .ok()
            .filter(|&i| i < self.active_type_mappers_caches_len)
            .and_then(|i| self.active_type_mappers_caches.get(i))
        {
            Some(cache) => cache,
            None => &self.nil_cache,
        }
    }

    fn active_mapper_cache_mut(&mut self, index: isize) -> &mut Map<CacheKey, TypeId> {
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
        self.active_mappers.pop();
        // Clear the map, but leave it in the list for later reuse.
        let Some(last_index) = self.active_type_mappers_caches_len.checked_sub(1) else {
            return self.fail("index out of range [-1]");
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

    // The field `couldContainTypeVariables` holds the method value `couldContainTypeVariablesWorker`.
    pub fn could_contain_type_variables(&mut self, t: TypeId) -> bool {
        self.could_contain_type_variables_worker(t)
    }

    pub fn could_contain_type_variables_worker(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("couldContainTypeVariablesWorker")
    }

    // core.Some(list, c.couldContainTypeVariables)
    fn some_could_contain_type_variables(
        &mut self,
        types: crate::golang::List<'a, TypeId>,
    ) -> bool {
        crate::fn5_callbacks::some(types, |t| self.could_contain_type_variables(t))
    }

    pub fn instantiate_type_worker(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let _ = (t, m, alias);
        self.stand_in("instantiateTypeWorker")
    }

    // m.Map(t)
    pub fn map(&mut self, m: TypeMapperId, t: TypeId) -> TypeId {
        match self.type_mappers[m] {
            TypeMapper::Simple { source, target } => {
                if t == source {
                    return target;
                }
                t
            }
            TypeMapper::Array { sources, targets } => {
                for (i, s) in sources.iter().enumerate() {
                    if t == s {
                        return targets.at(i);
                    }
                }
                t
            }
            TypeMapper::Merged { m1, m2 } => {
                let t1 = self.map(m1, t);
                self.map(m2, t1)
            }
            TypeMapper::Function(f) => self.call_function_mapper(f, t),
            TypeMapper::Nil => t,
        }
    }

    fn call_function_mapper(&mut self, f: FunctionMapper, t: TypeId) -> TypeId {
        match f {
            FunctionMapper::ReportUnreliable => self.report_unreliable_worker(t),
            _ => self.stand_in("FunctionTypeMapper.fn"),
        }
    }

    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId {
        t
    }

    pub fn error(&mut self, location: NodeId, message: MessageId) -> DiagnosticId {
        let _ = (location, message);
        self.stand_in("error")
    }
}

pub type CacheKey = crate::keys::CacheHashKey;
