// checker.go:22214-22911 (layers T-INSTANTIATE, K-COND, T-MAPPED): instantiation of types with the caches of the active mappers, the test for type variables, instantiation of object types, anonymous types, conditional types, mapped types, reverse mapped types and type aliases, the type parameter, constraint, name and template of a mapped type, and instantiation of lists.
use crate::ast::{
    FindAncestorResult, Kind, NodeId, SymbolFlags, SymbolId, find_ancestor_or_quit,
    get_declaration_of_kind, get_first_identifier, is_block, is_conditional_type_node,
    is_this_identifier, is_type_operator_node, is_type_parameter_declaration,
};
use crate::checker::{
    CacheHashKey, Checker, ElementFlags, IndexInfoId, IntersectionFlags, KeyBuilder, ListItem,
    MappedTypeModifiers, ObjectFlags, SignatureId, TupleElementInfo, TypeAlias, TypeAliasId,
    TypeFlags, TypeId, TypeMapperId, TypeSystemEntity, TypeSystemPropertyName, UnionReduction,
    append_type_mapping, every_type, get_conditional_type_key, get_mapped_type_modifiers,
    get_type_instantiation_key, is_node_descendant_of, is_tuple_type, new_simple_type_mapper,
    new_type_mapper, prepend_type_mapping,
};
use crate::core::{List, Map, or_else, same};
use crate::diagnostics;

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
        // Check for type variables in the alias, so things like `type Brand<T> = number & {}` can potentially be copied with new alias type args, despite them being unreferenced. This is the behavior most people using aliases expect, and prevents the cache from leaking type parameters outside their scope of validity. tests/cases/compiler/declarationEmitArrowFunctionNoRenaming.ts contains an example of this, which previously only worked in strada via some input node reuse logic instead.
        if t.is_nil() || m.is_nil() {
            return t;
        }
        if !self.could_contain_type_variables(t) {
            let alias_type_arguments = self.alias_type_arguments(self.types[t].alias);
            if !(alias_type_arguments.len() > 0
                && alias_type_arguments
                    .as_slice()
                    .iter()
                    .any(|&u| self.could_contain_type_variables(u)))
            {
                return t;
            }
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.instantiation_depth == 100 || self.instantiation_count >= 5_000_000 {
            // We have reached 100 recursive type instantiations, or 5M type instantiations caused by the same statement or expression. There is a very high likelihood we're dealing with a combination of infinite generic types that perpetually generate new type identities, so we stop the recursion here by yielding the error type.
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

    // `c.activeTypeMappersCaches[index]`: the list keeps emptied maps beyond its length for reuse, so the length is the field active_type_mappers_caches_len.
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

    // The field `couldContainTypeVariables` of upstream's Checker holds the method value `couldContainTypeVariablesWorker` (checker.go:1259).
    pub fn could_contain_type_variables(&mut self, t: TypeId) -> bool {
        self.could_contain_type_variables_worker(t)
    }

    // Return true if the given type could possibly reference a type parameter for which we perform type inference (i.e. a type parameter of a generic function). We cache results for union and intersection types for performance reasons.
    pub fn could_contain_type_variables_worker(&mut self, t: TypeId) -> bool {
        let a = self.ast;
        let flags = self.types[t].flags;
        if !flags.intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE) {
            return false;
        }
        let object_flags = self.types[t].object_flags;
        if object_flags.intersects(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED) {
            return object_flags.intersects(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES);
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let symbol = self.types[t].symbol;
        let result = flags.intersects(TypeFlags::INSTANTIABLE)
            || flags.intersects(TypeFlags::OBJECT)
                && !self.is_non_generic_top_level_type(t)
                && (object_flags.intersects(ObjectFlags::REFERENCE)
                    && (!self.as_type_reference(t).node.is_nil()
                        || self
                            .get_type_arguments(t)
                            .as_slice()
                            .iter()
                            .any(|&u| self.could_contain_type_variables(u)))
                    || object_flags.intersects(ObjectFlags::ANONYMOUS)
                        && !symbol.is_nil()
                        && a.sym(symbol).flags.intersects(
                            SymbolFlags::FUNCTION
                                | SymbolFlags::METHOD
                                | SymbolFlags::CLASS
                                | SymbolFlags::TYPE_LITERAL
                                | SymbolFlags::OBJECT_LITERAL,
                        )
                        && !a.sym(symbol).declarations.is_nil()
                    || object_flags.intersects(
                        ObjectFlags::MAPPED
                            | ObjectFlags::REVERSE_MAPPED
                            | ObjectFlags::OBJECT_REST_TYPE
                            | ObjectFlags::INSTANTIATION_EXPRESSION_TYPE,
                    ))
            || flags.intersects(TypeFlags::UNION_OR_INTERSECTION)
                && !flags.intersects(TypeFlags::ENUM_LITERAL)
                && !self.is_non_generic_top_level_type(t)
                && self
                    .type_types(t)
                    .as_slice()
                    .iter()
                    .any(|&u| self.could_contain_type_variables(u));
        self.types[t].object_flags |= ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
            | if result {
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
            } else {
                ObjectFlags::NONE
            };
        result
    }

    pub fn is_non_generic_top_level_type(&self, t: TypeId) -> bool {
        let a = self.ast;
        let alias = self.types[t].alias;
        if !alias.is_nil() && self.type_aliases[alias].type_arguments.len() == 0 {
            let alias_symbol = self.type_aliases[alias].symbol;
            let mut declaration =
                get_declaration_of_kind(a, alias_symbol, Kind::TypeAliasDeclaration);
            if declaration.is_nil() {
                declaration =
                    get_declaration_of_kind(a, alias_symbol, Kind::JSTypeAliasDeclaration);
            }
            return !declaration.is_nil()
                && !find_ancestor_or_quit(a, a.parent(declaration), |n| match a.kind(n) {
                    Kind::SourceFile => FindAncestorResult::TRUE,
                    Kind::ModuleDeclaration => FindAncestorResult::FALSE,
                    _ => FindAncestorResult::QUIT,
                })
                .is_nil();
        }
        false
    }

    pub fn instantiate_type_worker(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let mut alias = alias;
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.map(m, t);
        }
        if flags.intersects(TypeFlags::OBJECT) {
            let object_flags = self.types[t].object_flags;
            if object_flags
                .intersects(ObjectFlags::REFERENCE | ObjectFlags::ANONYMOUS | ObjectFlags::MAPPED)
            {
                if object_flags.intersects(ObjectFlags::REFERENCE)
                    && self.as_type_reference(t).node.is_nil()
                {
                    let resolved_type_arguments = self.as_type_reference(t).resolved_type_arguments;
                    let new_type_arguments = self.instantiate_types(resolved_type_arguments, m);
                    if same(
                        new_type_arguments.as_slice(),
                        resolved_type_arguments.as_slice(),
                    ) {
                        return t;
                    }
                    let target = self.type_target(t);
                    return self.create_normalized_type_reference(target, new_type_arguments);
                }
                if object_flags.intersects(ObjectFlags::REVERSE_MAPPED) {
                    return self.instantiate_reverse_mapped_type(t, m);
                }
                return self.get_object_type_instantiation(t, m, alias);
            }
            return t;
        }
        if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            let mut source = t;
            if self.types[t].flags.intersects(TypeFlags::UNION) {
                let origin = self.as_union_type(t).origin;
                if !origin.is_nil()
                    && self.types[origin]
                        .flags
                        .intersects(TypeFlags::UNION_OR_INTERSECTION)
                {
                    source = origin;
                }
            }
            let types = self.type_types(source);
            let new_types = self.instantiate_types(types, m);
            let type_alias = self.types[t].alias;
            if same(new_types.as_slice(), types.as_slice())
                && self.alias_symbol(alias) == self.alias_symbol(type_alias)
            {
                return t;
            }
            if alias.is_nil() {
                alias = self.instantiate_type_alias(type_alias, m);
            }
            if self.types[source].flags.intersects(TypeFlags::INTERSECTION) {
                return self.get_intersection_type_ex(new_types, IntersectionFlags::NONE, alias);
            }
            return self.get_union_type_ex(new_types, UnionReduction::LITERAL, alias, TypeId::NIL);
        }
        if flags.intersects(TypeFlags::INDEX) {
            let target = self.type_target(t);
            let new_target = self.instantiate_type(target, m);
            return self.get_index_type(new_target);
        }
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            if alias.is_nil() {
                let type_alias = self.types[t].alias;
                alias = self.instantiate_type_alias(type_alias, m);
            }
            let object_type = self.as_indexed_access_type(t).object_type;
            let index_type = self.as_indexed_access_type(t).index_type;
            let new_object_type = self.instantiate_type(object_type, m);
            let new_index_type = self.instantiate_type(index_type, m);
            let access_flags = self.as_indexed_access_type(t).access_flags;
            return self.get_indexed_access_type_ex(
                new_object_type,
                new_index_type,
                access_flags,
                NodeId::NIL,
                alias,
            );
        }
        if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            let texts = self.as_template_literal_type(t).texts;
            let types = self.as_template_literal_type(t).types;
            let new_types = self.instantiate_types(types, m);
            return self.get_template_literal_type(texts.as_slice(), new_types);
        }
        if flags.intersects(TypeFlags::STRING_MAPPING) {
            let symbol = self.types[t].symbol;
            let target = self.as_string_mapping_type(t).target;
            let new_target = self.instantiate_type(target, m);
            return self.get_string_mapping_type(symbol, new_target);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            let conditional_mapper = self.as_conditional_type(t).mapper;
            let combined_mapper = self.combine_type_mappers(conditional_mapper, m);
            return self.get_conditional_type_instantiation(t, combined_mapper, false, alias);
        }
        if flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(t).base_type;
            let new_base_type = self.instantiate_type(base_type, m);
            if self.is_no_infer_type(t) {
                return self.get_no_infer_type(new_base_type);
            }
            let constraint = self.as_substitution_type(t).constraint;
            let new_constraint = self.instantiate_type(constraint, m);
            // A substitution type originates in the true branch of a conditional type and can be resolved to just the base type in the same cases as the conditional type resolves to its true branch (because the base type is then known to satisfy the constraint).
            if self.types[new_base_type]
                .flags
                .intersects(TypeFlags::TYPE_VARIABLE)
                && self.is_generic_type(new_constraint)
            {
                return self.get_substitution_type(new_base_type, new_constraint);
            }
            if self.types[new_constraint]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN)
            {
                return new_base_type;
            }
            let restrictive_base_type = self.get_restrictive_instantiation(new_base_type);
            let restrictive_constraint = self.get_restrictive_instantiation(new_constraint);
            if self.is_type_assignable_to(restrictive_base_type, restrictive_constraint) {
                return new_base_type;
            }
            if self.types[new_base_type]
                .flags
                .intersects(TypeFlags::TYPE_VARIABLE)
            {
                return self.get_substitution_type(new_base_type, new_constraint);
            }
            return self.get_intersection_type(List::from_slice(&[new_constraint, new_base_type]));
        }
        t
    }

    // Handles instantiation of the following object types: AnonymousType (ObjectFlagsAnonymous|ObjectFlagsSingleSignatureType), TypeReference with node != nil (ObjectFlagsReference), InstantiationExpressionType (ObjectFlagsInstantiationExpressionType), MappedType (ObjectFlagsMapped)
    pub fn get_object_type_instantiation(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let a = self.ast;
        let object_flags = self.types[t].object_flags;
        let declaration;
        if object_flags.intersects(ObjectFlags::REFERENCE) {
            // Deferred type reference
            declaration = self.as_type_reference(t).node;
        } else if object_flags.intersects(ObjectFlags::INSTANTIATION_EXPRESSION_TYPE) {
            declaration = self.as_instantiation_expression_type(t).node;
        } else {
            let declarations = a.sym(self.types[t].symbol).declarations;
            if declarations.len() == 0 {
                let _: () = self.fail("index out of range [0]");
                return t;
            }
            declaration = declarations.at(0usize);
        }
        let links = self.type_node_links.get(declaration);
        let target;
        if object_flags.intersects(ObjectFlags::REFERENCE) {
            // Deferred type reference
            target = self.type_node_links[links].resolved_type;
        } else if object_flags.intersects(ObjectFlags::INSTANTIATED) {
            target = self.type_target(t);
        } else {
            target = t;
        }
        let mut type_parameters = self.type_node_links[links].outer_type_parameters;
        if type_parameters.is_nil() {
            // The first time an anonymous type is instantiated we compute and store a list of the type parameters that are in scope (and therefore potentially referenced). For type literals that aren't the right hand side of a generic type alias declaration we optimize by reducing the set of type parameters to those that are possibly referenced in the literal.
            type_parameters = self.get_outer_type_parameters(declaration, true);
            if self.alias_type_arguments(self.types[target].alias).len() == 0 {
                if object_flags
                    .intersects(ObjectFlags::REFERENCE | ObjectFlags::INSTANTIATION_EXPRESSION_TYPE)
                {
                    type_parameters = self.filter(type_parameters, |c, tp| {
                        c.is_type_parameter_possibly_referenced(tp, declaration)
                    });
                } else if a
                    .sym(self.types[target].symbol)
                    .flags
                    .intersects(SymbolFlags::METHOD | SymbolFlags::TYPE_LITERAL)
                {
                    let declarations = a.sym(self.types[t].symbol).declarations;
                    type_parameters = self.filter(type_parameters, |c, tp| {
                        declarations
                            .as_slice()
                            .iter()
                            .any(|&d| c.is_type_parameter_possibly_referenced(tp, d))
                    });
                }
            }
            if type_parameters.is_nil() {
                type_parameters = self.list_of(&[]);
            }
            self.type_node_links[links].outer_type_parameters = type_parameters;
        }
        if type_parameters.len() == 0 {
            return t;
        }
        // We are instantiating an anonymous type that has one or more type parameters in scope. Apply the mapper to the type parameters to produce the effective list of type arguments, and compute the instantiation cache key from the type IDs of the type arguments.
        let mut type_arguments: Vec<TypeId> = Vec::with_capacity(type_parameters.as_slice().len());
        for &tp in type_parameters.as_slice() {
            let type_mapper = self.type_mapper(t);
            let type_argument = self.map_type_with_composite_mapper(tp, type_mapper, m);
            type_arguments.push(type_argument);
        }
        let type_arguments = self.list_of(&type_arguments);
        let mut new_alias = alias;
        if new_alias.is_nil() {
            let type_alias = self.types[t].alias;
            new_alias = self.instantiate_type_alias(type_alias, m);
        }
        let key = get_type_instantiation_key(
            self,
            type_arguments,
            new_alias,
            object_flags.intersects(ObjectFlags::SINGLE_SIGNATURE_TYPE),
        );
        if self.as_object_type(target).instantiations.is_nil() {
            self.as_object_type_mut(target).instantiations = Map::make();
            let target_alias = self.types[target].alias;
            let identity_key =
                get_type_instantiation_key(self, type_parameters, target_alias, false);
            let ok = self
                .as_object_type_mut(target)
                .instantiations
                .set(identity_key, target);
            self.map_set(ok);
        }
        let mut result = self.as_object_type(target).instantiations.get(&key);
        if result.is_nil() {
            let mut new_mapper = new_type_mapper(self, type_parameters, type_arguments);
            let target_object_flags = self.types[target].object_flags;
            if target_object_flags.intersects(ObjectFlags::SINGLE_SIGNATURE_TYPE) && !m.is_nil() {
                new_mapper = self.combine_type_mappers(new_mapper, m);
            }
            if target_object_flags.intersects(ObjectFlags::REFERENCE) {
                let reference_target = self.type_target(t);
                let node = self.as_type_reference(t).node;
                result = self.create_deferred_type_reference(
                    reference_target,
                    node,
                    new_mapper,
                    new_alias,
                );
            } else if target_object_flags.intersects(ObjectFlags::MAPPED) {
                result = self.instantiate_mapped_type(target, new_mapper, new_alias);
            } else {
                result = self.instantiate_anonymous_type(target, new_mapper, new_alias);
            }
            let ok = self
                .as_object_type_mut(target)
                .instantiations
                .set(key, result);
            self.map_set(ok);
            if self.types[result]
                .flags
                .intersects(TypeFlags::OBJECT_FLAGS_TYPE)
                && !self.types[result]
                    .object_flags
                    .intersects(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED)
            {
                // if `result` is one of the object types we tried to make (it may not be, due to how `instantiateMappedType` works), we can carry forward the type variable containment check from the input type arguments
                let result_could_contain_object_flags = type_arguments
                    .as_slice()
                    .iter()
                    .any(|&u| self.could_contain_type_variables(u));
                if !self.types[result]
                    .object_flags
                    .intersects(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED)
                {
                    if self.types[result].object_flags.intersects(
                        ObjectFlags::MAPPED | ObjectFlags::ANONYMOUS | ObjectFlags::REFERENCE,
                    ) {
                        self.types[result].object_flags |=
                            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                                | if result_could_contain_object_flags {
                                    ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                                } else {
                                    ObjectFlags::NONE
                                };
                    } else {
                        // If none of the type arguments for the outer type parameters contain type variables, it follows that the instantiated type doesn't reference type variables. Intrinsics have `CouldContainTypeVariablesComputed` pre-set, so this should only cover unions and intersections resulting from `instantiateMappedType`
                        self.types[result].object_flags |= if !result_could_contain_object_flags {
                            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                        } else {
                            ObjectFlags::NONE
                        };
                    }
                }
            }
        }
        result
    }

    pub fn is_type_parameter_possibly_referenced(&mut self, tp: TypeId, node: NodeId) -> bool {
        fn contains_reference(c: &mut Checker<'_>, tp: TypeId, node: NodeId) -> bool {
            // A walk that cannot go on proves nothing: the type parameter counts as possibly referenced.
            if !c.stack_check.is_safe_to_recurse() {
                c.stack_limit::<()>();
                return true;
            }
            let a = c.ast;
            match a.kind(node) {
                Kind::ThisType => return c.as_type_parameter(tp).is_this_type,
                Kind::TypeReference => {
                    // use worker because we're looking for === equality
                    if !c.as_type_parameter(tp).is_this_type && a.type_arguments(node).len() == 0 {
                        let symbol = c.get_symbol_from_type_reference(node);
                        if symbol == c.types[tp].symbol {
                            return true;
                        }
                    }
                }
                Kind::TypeQuery => {
                    let entity_name = a.as_type_query_node(node).expr_name;
                    let first_identifier = get_first_identifier(a, entity_name);
                    if !is_this_identifier(a, first_identifier) {
                        let first_identifier_symbol = c.get_resolved_symbol(first_identifier);
                        // There is exactly one declaration, otherwise `containsReference` is not called
                        let tp_declaration = a.sym(c.types[tp].symbol).declarations.at(0usize);
                        let mut tp_scope = NodeId::NIL;
                        if is_type_parameter_declaration(a, tp_declaration) {
                            // Type parameter is a regular type parameter, e.g. foo<T>
                            tp_scope = a.parent(tp_declaration);
                        } else if c.as_type_parameter(tp).is_this_type {
                            // Type parameter is the this type, and its declaration is the class declaration.
                            tp_scope = tp_declaration;
                        }
                        if !tp_scope.is_nil() {
                            if a.sym(first_identifier_symbol)
                                .declarations
                                .as_slice()
                                .iter()
                                .any(|&d| is_node_descendant_of(a, d, tp_scope))
                            {
                                return true;
                            }
                            for &type_argument in a.type_arguments(node).as_slice() {
                                if contains_reference(c, tp, type_argument) {
                                    return true;
                                }
                            }
                            return false;
                        }
                    }
                    return true;
                }
                Kind::MethodDeclaration | Kind::MethodSignature => {
                    let return_type = a.type_node(node);
                    if return_type.is_nil() && !a.body(node).is_nil() {
                        return true;
                    }
                    for &type_parameter in a.type_parameters(node).as_slice() {
                        if contains_reference(c, tp, type_parameter) {
                            return true;
                        }
                    }
                    for &parameter in a.parameters(node).as_slice() {
                        if contains_reference(c, tp, parameter) {
                            return true;
                        }
                    }
                    return !return_type.is_nil() && contains_reference(c, tp, return_type);
                }
                _ => {}
            }
            a.for_each_child(node, &mut |child| contains_reference(c, tp, child))
        }
        let a = self.ast;
        // If the type parameter doesn't have exactly one declaration, if there are intervening statement blocks between the node and the type parameter declaration, if the node contains actual references to the type parameter, or if the node contains type queries that we can't prove couldn't contain references to the type parameter, we consider the type parameter possibly referenced.
        let symbol = self.types[tp].symbol;
        if !symbol.is_nil() && a.sym(symbol).declarations.len() == 1 {
            let container = a.parent(a.sym(symbol).declarations.at(0usize));
            let mut n = node;
            while n != container {
                if n.is_nil()
                    || is_block(a, n)
                    || is_conditional_type_node(a, n)
                        && contains_reference(self, tp, a.as_conditional_type_node(n).extends_type)
                {
                    return true;
                }
                n = a.parent(n);
            }
            return contains_reference(self, tp, node);
        }
        true
    }

    pub fn instantiate_anonymous_type(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let mut m = m;
        let mut alias = alias;
        let object_flags = self.types[t].object_flags;
        let symbol = self.types[t].symbol;
        let result = self.new_object_type(
            object_flags.without(
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                    | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES,
            ) | ObjectFlags::INSTANTIATED,
            symbol,
        );
        if object_flags.intersects(ObjectFlags::MAPPED) {
            let declaration = self.as_mapped_type(t).declaration;
            self.as_mapped_type_mut(result).declaration = declaration;
            // C.f. instantiateSignature
            let orig_type_parameter = self.get_type_parameter_from_mapped_type(t);
            let fresh_type_parameter = self.clone_type_parameter(orig_type_parameter);
            self.as_mapped_type_mut(result).type_parameter = fresh_type_parameter;
            let fresh_mapper =
                new_simple_type_mapper(self, orig_type_parameter, fresh_type_parameter);
            m = self.combine_type_mappers(fresh_mapper, m);
            self.as_type_parameter_mut(fresh_type_parameter).mapper = m;
        } else if object_flags.intersects(ObjectFlags::INSTANTIATION_EXPRESSION_TYPE) {
            let node = self.as_instantiation_expression_type(t).node;
            self.as_instantiation_expression_type_mut(result).node = node;
        }
        if alias.is_nil() {
            let type_alias = self.types[t].alias;
            alias = self.instantiate_type_alias(type_alias, m);
        }
        self.types[result].alias = alias;
        if !alias.is_nil() && self.type_aliases[alias].type_arguments.len() != 0 {
            let alias_type_arguments = self.type_aliases[alias].type_arguments;
            let propagating_flags =
                self.get_propagating_flags_of_types(alias_type_arguments, TypeFlags::NONE);
            self.types[result].object_flags |= propagating_flags;
        }
        self.as_object_type_mut(result).target = t;
        self.as_object_type_mut(result).mapper = m;
        result
    }

    pub fn get_conditional_type_instantiation(
        &mut self,
        t: TypeId,
        mapper: TypeMapperId,
        for_constraint: bool,
        alias: TypeAliasId,
    ) -> TypeId {
        let root = self.as_conditional_type(t).root;
        let outer_type_parameters = self.conditional_roots[root].outer_type_parameters;
        if outer_type_parameters.len() != 0 {
            // We are instantiating a conditional type that has one or more type parameters in scope. Apply the mapper to the type parameters to produce the effective list of type arguments, and compute the instantiation cache key from the type IDs of the type arguments.
            let type_arguments = self.map_list(outer_type_parameters, |c, tp| c.map(mapper, tp));
            let key = get_conditional_type_key(self, type_arguments, alias, for_constraint);
            let mut result = self.conditional_roots[root].instantiations.get(&key);
            if result.is_nil() {
                let new_mapper = new_type_mapper(self, outer_type_parameters, type_arguments);
                let check_type = self.conditional_roots[root].check_type;
                let mut distribution_type = TypeId::NIL;
                if self.conditional_roots[root].is_distributive {
                    let mapped_check_type = self.map(new_mapper, check_type);
                    distribution_type = self.get_reduced_type(mapped_check_type);
                }
                // Distributive conditional types are distributed over union types. For example, when the distributive conditional type T extends U ? X : Y is instantiated with A | B for T, the result is (A extends U ? X : Y) | (B extends U ? X : Y).
                if !distribution_type.is_nil()
                    && check_type != distribution_type
                    && self.types[distribution_type]
                        .flags
                        .intersects(TypeFlags::UNION | TypeFlags::NEVER)
                {
                    result = self.map_type_with_alias(
                        distribution_type,
                        &mut |c, t| {
                            let mapper = prepend_type_mapping(c, check_type, t, new_mapper);
                            c.get_conditional_type(root, mapper, for_constraint, TypeAliasId::NIL)
                        },
                        alias,
                    );
                } else {
                    result = self.get_conditional_type(root, new_mapper, for_constraint, alias);
                }
                let ok = self.conditional_roots[root].instantiations.set(key, result);
                self.map_set(ok);
            }
            return result;
        }
        t
    }

    pub fn clone_type_parameter(&mut self, tp: TypeId) -> TypeId {
        let symbol = self.types[tp].symbol;
        let result = self.new_type_parameter(symbol);
        self.as_type_parameter_mut(result).target = tp;
        result
    }

    pub fn get_homomorphic_type_variable(&mut self, t: TypeId) -> TypeId {
        let constraint_type = self.get_constraint_type_from_mapped_type(t);
        if self.types[constraint_type]
            .flags
            .intersects(TypeFlags::INDEX)
        {
            let target = self.as_index_type(constraint_type).target;
            let type_variable = self.get_actual_type_variable(target);
            if self.types[type_variable]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER)
            {
                return type_variable;
            }
        }
        TypeId::NIL
    }

    pub fn instantiate_mapped_type(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        // For a homomorphic mapped type { [P in keyof T]: X }, where T is some type variable, the mapping operation depends on T as follows: If T is a primitive type no mapping is performed and the result is simply T. If T is a union type we distribute the mapped type over the union. If T is an array we map to an array where the element type has been transformed. If T is a tuple we map to a tuple where the element types have been transformed. If T is an intersection of array or tuple types we map to an intersection of transformed array or tuple types. Otherwise we map to an object type where the type of each property has been transformed. For example, when T is instantiated to a union type A | B, we produce { [P in keyof A]: X } | { [P in keyof B]: X }, and when when T is instantiated to a union type A | undefined, we produce { [P in keyof A]: X } | undefined.
        fn instantiate_constituent(
            c: &mut Checker<'_>,
            t: TypeId,
            type_variable: TypeId,
            m: TypeMapperId,
            s: TypeId,
        ) -> TypeId {
            let a = c.ast;
            if !c.types[s].flags.intersects(
                TypeFlags::ANY_OR_UNKNOWN
                    | TypeFlags::INSTANTIABLE_NON_PRIMITIVE
                    | TypeFlags::OBJECT
                    | TypeFlags::INTERSECTION,
            ) || s == c.wildcard_type
                || c.is_error_type(s)
            {
                return s;
            }
            let declaration = c.as_mapped_type(t).declaration;
            if a.as_mapped_type_node(declaration).name_type.is_nil() {
                if c.is_array_type(s)
                    || c.types[s].flags.intersects(TypeFlags::ANY)
                        && c.find_resolution_cycle_start_index(
                            TypeSystemEntity::Type(type_variable),
                            TypeSystemPropertyName::ResolvedBaseConstraint,
                        ) < 0
                        && c.has_array_or_type_type_constraint(type_variable)
                {
                    let mapper = prepend_type_mapping(c, type_variable, s, m);
                    return c.instantiate_mapped_array_type(s, t, mapper);
                }
                if is_tuple_type(c, s) {
                    return c.instantiate_mapped_tuple_type(s, t, type_variable, m);
                }
                if c.is_array_or_tuple_or_intersection(s) {
                    let types = c.type_types(s);
                    let new_types = c.map_list(types, |c, u| {
                        instantiate_constituent(c, t, type_variable, m, u)
                    });
                    return c.get_intersection_type(new_types);
                }
            }
            let mapper = prepend_type_mapping(c, type_variable, s, m);
            c.instantiate_anonymous_type(t, mapper, TypeAliasId::NIL)
        }
        let type_variable = self.get_homomorphic_type_variable(t);
        if !type_variable.is_nil() {
            let mapped_type_variable = self.instantiate_type(type_variable, m);
            if type_variable != mapped_type_variable {
                let reduced = self.get_reduced_type(mapped_type_variable);
                return self.map_type_with_alias(
                    reduced,
                    &mut |c, s| instantiate_constituent(c, t, type_variable, m, s),
                    alias,
                );
            }
        }
        // If the constraint type of the instantiation is the wildcard type, return the wildcard type.
        let constraint_type = self.get_constraint_type_from_mapped_type(t);
        if self.instantiate_type(constraint_type, m) == self.wildcard_type {
            return self.wildcard_type;
        }
        self.instantiate_anonymous_type(t, m, alias)
    }

    pub fn has_array_or_type_type_constraint(&mut self, type_variable: TypeId) -> bool {
        let constraint = self.get_constraint_of_type_parameter(type_variable);
        !constraint.is_nil()
            && every_type(self, constraint, &mut |c, t| c.is_array_or_tuple_type(t))
    }

    pub fn instantiate_mapped_array_type(
        &mut self,
        array_type: TypeId,
        mapped_type: TypeId,
        m: TypeMapperId,
    ) -> TypeId {
        let number_type = self.number_type;
        let element_type = self.instantiate_mapped_type_template(mapped_type, number_type, true, m);
        if self.is_error_type(element_type) {
            return self.error_type;
        }
        let readonly = get_modified_readonly_state(
            self.is_readonly_array_type(array_type),
            get_mapped_type_modifiers(self, mapped_type),
        );
        self.create_array_type_ex(element_type, readonly)
    }

    pub fn instantiate_mapped_tuple_type(
        &mut self,
        tuple_type: TypeId,
        mapped_type: TypeId,
        type_variable: TypeId,
        m: TypeMapperId,
    ) -> TypeId {
        // We apply the mapped type's template type to each of the fixed part elements. For variadic elements, we apply the mapped type itself to the variadic element type. For other elements in the variable part of the tuple, we surround the element type with an array type and apply the mapped type to that. This ensures that we get sequential property key types for the fixed part of the tuple, and property key type number for the remaining elements. For example, with `type Keys<T> = { [K in keyof T]: K }`, the type `Keys<[string, string, ...T, string]>` for a `T extends any[]` is `["0", "1", ...Keys<T>, number]`.
        let element_infos = self.type_target_tuple_type(tuple_type).element_infos;
        let fixed_length = self.type_target_tuple_type(tuple_type).fixed_length;
        let mut fixed_mapper = m;
        if fixed_length != 0 {
            fixed_mapper = prepend_type_mapping(self, type_variable, tuple_type, m);
        }
        let modifiers = get_mapped_type_modifiers(self, mapped_type);
        let element_types = self.get_element_types(tuple_type);
        let mut new_element_types: Vec<TypeId> = Vec::with_capacity(element_types.as_slice().len());
        let mut new_element_infos: Vec<TupleElementInfo> = element_infos.as_slice().to_vec();
        for (i, &e) in element_types.as_slice().iter().enumerate() {
            let flags = element_infos.at(i).flags;
            let mapped = if (i as isize) < fixed_length {
                let index = self.text(i.to_string().as_bytes());
                let key = self.get_string_literal_type(index);
                self.instantiate_mapped_type_template(
                    mapped_type,
                    key,
                    flags.intersects(ElementFlags::OPTIONAL),
                    fixed_mapper,
                )
            } else if flags.intersects(ElementFlags::VARIADIC) {
                let mapper = prepend_type_mapping(self, type_variable, e, m);
                self.instantiate_type(mapped_type, mapper)
            } else {
                let array_type = self.create_array_type(e);
                let mapper = prepend_type_mapping(self, type_variable, array_type, m);
                let instantiated = self.instantiate_type(mapped_type, mapper);
                let element_type = self.get_element_type_of_array_type(instantiated);
                if element_type.is_nil() {
                    self.unknown_type
                } else {
                    element_type
                }
            };
            if modifiers.intersects(MappedTypeModifiers::INCLUDE_OPTIONAL) {
                if flags.intersects(ElementFlags::REQUIRED) {
                    if let Some(info) = new_element_infos.get_mut(i) {
                        info.flags = ElementFlags::OPTIONAL;
                    }
                }
            } else if modifiers.intersects(MappedTypeModifiers::EXCLUDE_OPTIONAL) {
                if flags.intersects(ElementFlags::OPTIONAL) {
                    if let Some(info) = new_element_infos.get_mut(i) {
                        info.flags = ElementFlags::REQUIRED;
                    }
                }
            }
            new_element_types.push(mapped);
        }
        let readonly = self.type_target_tuple_type(tuple_type).readonly;
        let new_readonly =
            get_modified_readonly_state(readonly, get_mapped_type_modifiers(self, mapped_type));
        if new_element_types.contains(&self.error_type) {
            return self.error_type;
        }
        let new_element_types = self.list_of(&new_element_types);
        self.create_tuple_type_ex(
            new_element_types,
            List::from_slice(&new_element_infos),
            new_readonly,
        )
    }

    pub fn instantiate_mapped_type_template(
        &mut self,
        t: TypeId,
        key: TypeId,
        is_optional: bool,
        m: TypeMapperId,
    ) -> TypeId {
        let type_parameter = self.get_type_parameter_from_mapped_type(t);
        let template_mapper = append_type_mapping(self, m, type_parameter, key);
        let target = or_else(self.as_mapped_type(t).target, t);
        let template_type = self.get_template_type_from_mapped_type(target);
        let prop_type = self.instantiate_type(template_type, template_mapper);
        let modifiers = get_mapped_type_modifiers(self, t);
        if self.strict_null_checks
            && modifiers.intersects(MappedTypeModifiers::INCLUDE_OPTIONAL)
            && !self.maybe_type_of_kind(prop_type, TypeFlags::UNDEFINED | TypeFlags::VOID)
        {
            return self.get_optional_type(prop_type, true);
        }
        if self.strict_null_checks
            && modifiers.intersects(MappedTypeModifiers::EXCLUDE_OPTIONAL)
            && is_optional
        {
            return self.remove_missing_or_undefined_type(prop_type);
        }
        prop_type
    }
}

pub fn get_modified_readonly_state(state: bool, modifiers: MappedTypeModifiers) -> bool {
    if modifiers.intersects(MappedTypeModifiers::INCLUDE_READONLY) {
        return true;
    }
    if modifiers.intersects(MappedTypeModifiers::EXCLUDE_READONLY) {
        return false;
    }
    state
}

impl<'a> Checker<'a> {
    pub fn get_type_parameter_from_mapped_type(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        if self.as_mapped_type(t).type_parameter.is_nil() {
            let declaration = self.as_mapped_type(t).declaration;
            let symbol =
                self.get_symbol_of_declaration(a.as_mapped_type_node(declaration).type_parameter);
            let type_parameter = self.get_declared_type_of_type_parameter(symbol);
            self.as_mapped_type_mut(t).type_parameter = type_parameter;
        }
        self.as_mapped_type(t).type_parameter
    }

    pub fn get_constraint_type_from_mapped_type(&mut self, t: TypeId) -> TypeId {
        if self.as_mapped_type(t).constraint_type.is_nil() {
            let type_parameter = self.get_type_parameter_from_mapped_type(t);
            let constraint = self.get_constraint_of_type_parameter(type_parameter);
            let constraint_type = or_else(constraint, self.error_type);
            self.as_mapped_type_mut(t).constraint_type = constraint_type;
        }
        self.as_mapped_type(t).constraint_type
    }

    pub fn get_name_type_from_mapped_type(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        let name_type_node = a
            .as_mapped_type_node(self.as_mapped_type(t).declaration)
            .name_type;
        if name_type_node.is_nil() {
            return TypeId::NIL;
        }
        if self.as_mapped_type(t).name_type.is_nil() {
            let declared_name_type = self.get_type_from_type_node(name_type_node);
            let mapper = self.as_mapped_type(t).mapper;
            let name_type = self.instantiate_type(declared_name_type, mapper);
            self.as_mapped_type_mut(t).name_type = name_type;
        }
        self.as_mapped_type(t).name_type
    }

    pub fn get_template_type_from_mapped_type(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        if self.as_mapped_type(t).template_type.is_nil() {
            let type_node = a
                .as_mapped_type_node(self.as_mapped_type(t).declaration)
                .type_node;
            if !type_node.is_nil() {
                let declared_type = self.get_type_from_type_node(type_node);
                let is_optional = get_mapped_type_modifiers(self, t)
                    .intersects(MappedTypeModifiers::INCLUDE_OPTIONAL);
                let optional_type = self.add_optionality_ex(declared_type, true, is_optional);
                let mapper = self.as_mapped_type(t).mapper;
                let template_type = self.instantiate_type(optional_type, mapper);
                self.as_mapped_type_mut(t).template_type = template_type;
            } else {
                let error_type = self.error_type;
                self.as_mapped_type_mut(t).template_type = error_type;
            }
        }
        self.as_mapped_type(t).template_type
    }

    pub fn is_mapped_type_with_keyof_constraint_declaration(&self, t: TypeId) -> bool {
        let a = self.ast;
        let constraint_declaration = self.get_constraint_declaration_for_mapped_type(t);
        is_type_operator_node(a, constraint_declaration)
            && a.as_type_operator_node(constraint_declaration).operator == Kind::KeyOfKeyword
    }

    pub fn get_constraint_declaration_for_mapped_type(&self, t: TypeId) -> NodeId {
        let a = self.ast;
        let declaration = self.as_mapped_type(t).declaration;
        a.as_type_parameter_declaration(a.as_mapped_type_node(declaration).type_parameter)
            .constraint
    }

    pub fn get_apparent_mapped_type_keys(
        &mut self,
        name_type: TypeId,
        target_type: TypeId,
    ) -> TypeId {
        let modifiers_type = self.get_modifiers_type_from_mapped_type(target_type);
        let modifiers_type = self.get_apparent_type(modifiers_type);
        let mut mapped_keys: Vec<TypeId> = Vec::new();
        self.for_each_mapped_type_property_key_type_and_index_signature_key_type(
            modifiers_type,
            TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
            false,
            &mut |c, t| {
                let mapper = c.type_mapper(target_type);
                let type_parameter = c.get_type_parameter_from_mapped_type(target_type);
                let mapper = append_type_mapping(c, mapper, type_parameter, t);
                mapped_keys.push(c.instantiate_type(name_type, mapper));
            },
        );
        self.get_union_type(List::from_slice(&mapped_keys))
    }

    pub fn for_each_mapped_type_property_key_type_and_index_signature_key_type(
        &mut self,
        t: TypeId,
        include: TypeFlags,
        strings_only: bool,
        cb: &mut dyn FnMut(&mut Checker<'a>, TypeId),
    ) {
        let properties = self.get_properties_of_type(t);
        for &prop in properties.as_slice() {
            let key_type = self.get_literal_type_from_property(prop, include, false);
            cb(self, key_type);
        }
        if self.types[t].flags.intersects(TypeFlags::ANY) {
            let string_type = self.string_type;
            cb(self, string_type);
        } else {
            let index_infos = self.get_index_infos_of_type(t);
            for &info in index_infos.as_slice() {
                let key_type = self.index_infos[info].key_type;
                if !strings_only
                    || self.types[key_type]
                        .flags
                        .intersects(TypeFlags::STRING | TypeFlags::TEMPLATE_LITERAL)
                {
                    cb(self, key_type);
                }
            }
        }
    }

    pub fn instantiate_reverse_mapped_type(&mut self, t: TypeId, m: TypeMapperId) -> TypeId {
        let mapped_type = self.as_reverse_mapped_type(t).mapped_type;
        let inner_mapped_type = self.instantiate_type(mapped_type, m);
        if !self.types[inner_mapped_type]
            .object_flags
            .intersects(ObjectFlags::MAPPED)
        {
            return t;
        }
        let constraint_type = self.as_reverse_mapped_type(t).constraint_type;
        let inner_index_type = self.instantiate_type(constraint_type, m);
        if !self.types[inner_index_type]
            .flags
            .intersects(TypeFlags::INDEX)
        {
            return t;
        }
        let source = self.as_reverse_mapped_type(t).source;
        let instantiated_source = self.instantiate_type(source, m);
        let instantiated = self.infer_type_for_homomorphic_mapped_type(
            instantiated_source,
            inner_mapped_type,
            inner_index_type,
        );
        if !instantiated.is_nil() {
            return instantiated;
        }
        // Nested invocation of `inferTypeForHomomorphicMappedType` or the `source` instantiated into something unmappable
        t
    }

    pub fn instantiate_type_alias(&mut self, alias: TypeAliasId, m: TypeMapperId) -> TypeAliasId {
        if alias.is_nil() {
            return TypeAliasId::NIL;
        }
        let symbol = self.type_aliases[alias].symbol;
        let type_arguments = self.type_aliases[alias].type_arguments;
        let type_arguments = self.instantiate_types(type_arguments, m);
        self.type_aliases.alloc(TypeAlias {
            symbol,
            type_arguments,
        })
    }

    pub fn instantiate_types(
        &mut self,
        types: List<'a, TypeId>,
        m: TypeMapperId,
    ) -> List<'a, TypeId> {
        instantiate_list(self, types, m, Checker::instantiate_type)
    }

    pub fn instantiate_symbols(
        &mut self,
        symbols: List<'a, SymbolId>,
        m: TypeMapperId,
    ) -> List<'a, SymbolId> {
        instantiate_list(self, symbols, m, Checker::instantiate_symbol)
    }

    pub fn instantiate_signatures(
        &mut self,
        signatures: List<'a, SignatureId>,
        m: TypeMapperId,
    ) -> List<'a, SignatureId> {
        instantiate_list(self, signatures, m, Checker::instantiate_signature)
    }

    pub fn instantiate_index_infos(
        &mut self,
        index_infos: List<'a, IndexInfoId>,
        m: TypeMapperId,
    ) -> List<'a, IndexInfoId> {
        instantiate_list(self, index_infos, m, Checker::instantiate_index_info)
    }
}

pub fn instantiate_list<'a, T: ListItem<'a> + PartialEq>(
    c: &mut Checker<'a>,
    values: List<'a, T>,
    m: TypeMapperId,
    mut instantiator: impl FnMut(&mut Checker<'a>, T, TypeMapperId) -> T,
) -> List<'a, T> {
    let items = values.as_slice();
    for (i, &value) in items.iter().enumerate() {
        let mapped = instantiator(c, value, m);
        if mapped != value {
            let mut result: Vec<T> = Vec::with_capacity(items.len());
            result.extend_from_slice(items.get(..i).unwrap_or(&[]));
            result.push(mapped);
            for &value in items.get(i + 1..).unwrap_or(&[]) {
                let mapped = instantiator(c, value, m);
                result.push(mapped);
            }
            return c.list_of(&result);
        }
    }
    values
}
