// checker/inference.go: type inference. The pool of inference states, inference between two types, reverse mapped types, inference contexts and the inferred type of a type parameter. InferenceKey and InferenceState are records of c01_data.rs, and an `*InferenceState`, `*InferenceContext` or `*InferenceInfo` of upstream is the id of its record.
use crate::ast::{
    CheckFlags, Kind, NodeId, SymbolFlags, SymbolId, is_in_js_file, is_method_declaration,
    is_type_parameter_declaration,
};
use crate::checker::utilities::slices::sort_func;
use crate::checker::{
    Checker, ContextFlags, ElementFlags, ExpandingFlags, IndexFlags, IndexInfoId, InferenceContext,
    InferenceContextId, InferenceFlags, InferenceInfo, InferenceInfoId, InferenceKey,
    InferencePriority, InferenceState, InferenceStateId, IntraExpressionInferenceSite,
    MappedTypeModifiers, ObjectFlags, ReverseMappedTypeKey, SignatureFlags, SignatureId,
    SignatureKind, Ternary, TupleElementInfo, TypeAliasId, TypeComparer, TypeFlags, TypeId,
    TypeMapperId, UnionReduction, VarianceFlags, apply_string_mapping, compare_types,
    get_big_int_literal_value, get_boolean_literal_value, get_end_element_count,
    get_mapped_type_modifiers, get_number_literal_value, get_string_literal_value, is_literal_type,
    is_object_literal_type, is_object_or_array_literal_type, is_tuple_type, is_type_any,
    is_valid_big_int_string, is_valid_number_string, merge_type_mappers, new_merged_type_mapper,
    new_type_mapper, pseudo_big_int_to_string, some_type,
};
use crate::core::{
    List, LiveList, Map, append_if_unique, concatenate, filter, find, if_else, or_else, same,
    same_map, some,
};
use crate::jsnum::{Number, from_string};
use std::borrow::Cow;

impl<'a> Checker<'a> {
    pub fn get_inference_state(&mut self) -> InferenceStateId {
        let mut n = self.freeinference_state;
        if n.is_nil() {
            n = self.inference_states.alloc(InferenceState::default());
        }
        self.freeinference_state = self.inference_states[n].next;
        n
    }

    pub fn put_inference_state(&mut self, n: InferenceStateId) {
        let next = self.freeinference_state;
        let state = &mut self.inference_states[n];
        state.visited.clear();
        // `*n = InferenceState{...}`: every field is zero again; the map and the two stacks keep their storage.
        state.inferences = LiveList::NIL;
        state.original_source = TypeId::NIL;
        state.original_target = TypeId::NIL;
        state.priority = InferencePriority::NONE;
        state.inference_priority = InferencePriority::NONE;
        state.contravariant = false;
        state.bivariant = false;
        state.expanding_flags = ExpandingFlags::NONE;
        state.propagation_type = TypeId::NIL;
        state.source_stack.clear();
        state.target_stack.clear();
        state.next = next;
        self.freeinference_state = n;
    }

    pub fn infer_types(
        &mut self,
        inferences: LiveList<'a, InferenceInfoId>,
        original_source: TypeId,
        original_target: TypeId,
        priority: InferencePriority,
        contravariant: bool,
    ) {
        let n = self.get_inference_state();
        let state = &mut self.inference_states[n];
        state.inferences = inferences;
        state.original_source = original_source;
        state.original_target = original_target;
        state.priority = priority;
        state.inference_priority = InferencePriority::MAX_VALUE;
        state.contravariant = contravariant;
        self.infer_from_types(n, original_source, original_target);
        self.put_inference_state(n);
    }

    // The recursion follows the structure of the two types, so the entry tests the stack.
    pub fn infer_from_types(&mut self, n: InferenceStateId, mut source: TypeId, mut target: TypeId) {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if !self.could_contain_type_variables(target) || self.is_no_infer_type(target) {
            return;
        }
        if source == self.wildcard_type || source == self.blocked_string_type {
            // We are inferring from an 'any' type. We want to infer this type for every type parameter referenced in the target type, so we record it as the propagation type and infer from the target to itself. Then, as we find candidates we substitute the propagation type.
            let save_propagation_type = self.inference_states[n].propagation_type;
            self.inference_states[n].propagation_type = source;
            self.infer_from_types(n, target, target);
            self.inference_states[n].propagation_type = save_propagation_type;
            return;
        }
        let source_alias = self.types[source].alias;
        let target_alias = self.types[target].alias;
        if !source_alias.is_nil()
            && !target_alias.is_nil()
            && self.type_aliases[source_alias].symbol == self.type_aliases[target_alias].symbol
        {
            let symbol = self.type_aliases[source_alias].symbol;
            let source_type_arguments = self.type_aliases[source_alias].type_arguments;
            let target_type_arguments = self.type_aliases[target_alias].type_arguments;
            if source_type_arguments.len() != 0 || target_type_arguments.len() != 0 {
                // Source and target are types originating in the same generic type alias declaration. Simply infer from source type arguments to target type arguments, with defaults applied.
                let links = self.type_alias_links.get(symbol);
                let params = self.type_alias_links[links].type_parameters;
                let min_params = self.get_min_type_argument_count(params);
                let node_is_in_js_file = is_in_js_file(a, a.sym(symbol).value_declaration);
                let source_types = self.fill_missing_type_arguments(
                    source_type_arguments,
                    params,
                    min_params,
                    node_is_in_js_file,
                );
                let target_types = self.fill_missing_type_arguments(
                    target_type_arguments,
                    params,
                    min_params,
                    node_is_in_js_file,
                );
                let variances = self.get_alias_variances(symbol);
                self.infer_from_type_arguments(n, source_types, target_types, variances);
            }
            // And if there weren't any type arguments, there's no reason to run inference as the types must be the same.
            return;
        }
        if source == target
            && self.types[source]
                .flags
                .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            // When source and target are the same union or intersection type, just relate each constituent type to itself.
            let types = self.type_types(source);
            for &t in types.as_slice() {
                self.infer_from_types(n, t, t);
            }
            return;
        }
        if self.types[target].flags.intersects(TypeFlags::UNION) {
            let single_source = [source];
            let source_types: &[TypeId] = if self.types[source].flags.intersects(TypeFlags::UNION) {
                self.type_types(source).as_slice()
            } else {
                &single_source
            };
            let target_types = self.type_types(target);
            // First, infer between identically matching source and target constituents and remove the matching types.
            let (temp_sources, temp_targets) = self.infer_from_matching_types(
                n,
                source_types,
                target_types.as_slice(),
                Self::is_type_or_base_identical_to,
                false,
            );
            // Next, infer between closely matching source and target constituents and remove the matching types. Types closely match when they are instantiations of the same object type or instantiations of the same type alias.
            let (sources, targets) = self.infer_from_matching_types(
                n,
                &temp_sources,
                &temp_targets,
                |c, s, t| c.is_type_closely_matched_by(s, t),
                true,
            );
            if targets.is_empty() {
                return;
            }
            target = self.get_union_type(List::from_slice(&targets));
            if sources.is_empty() {
                // All source constituents have been matched and there is nothing further to infer from. However, simply making no inferences is undesirable because it could ultimately mean inferring a type parameter constraint. Instead, make a lower priority inference from the full source to whatever remains in the target. For example, when inferring from string to 'string | T', make a lower priority inference of string for T.
                self.infer_with_priority(
                    n,
                    source,
                    target,
                    InferencePriority::NAKED_TYPE_VARIABLE,
                );
                return;
            }
            source = self.get_union_type(List::from_slice(&sources));
        } else if self.types[target]
            .flags
            .intersects(TypeFlags::INTERSECTION)
            && {
                let target_types = self.type_types(target);
                !target_types
                    .as_slice()
                    .iter()
                    .all(|&t| self.is_non_generic_object_type(t))
            }
        {
            // We reduce intersection types unless they're simple combinations of object types. For example, when inferring from 'string[] & { extra: any }' to 'string[] & T' we want to remove string[] and infer { extra: any } for T. But when inferring to 'string[] & Iterable<T>' we want to keep the string[] on the source side and infer string for T.
            if !self.types[source].flags.intersects(TypeFlags::UNION) {
                let single_source = [source];
                let source_types: &[TypeId] =
                    if self.types[source].flags.intersects(TypeFlags::INTERSECTION) {
                        self.type_types(source).as_slice()
                    } else {
                        &single_source
                    };
                let target_types = self.type_types(target);
                // Infer between identically matching source and target constituents and remove the matching types.
                let (sources, targets) = self.infer_from_matching_types(
                    n,
                    source_types,
                    target_types.as_slice(),
                    Self::is_type_identical_to,
                    false,
                );
                if sources.is_empty() || targets.is_empty() {
                    return;
                }
                source = self.get_intersection_type(List::from_slice(&sources));
                target = self.get_intersection_type(List::from_slice(&targets));
            }
        }
        if self.types[target]
            .flags
            .intersects(TypeFlags::INDEXED_ACCESS | TypeFlags::SUBSTITUTION)
        {
            if self.is_no_infer_type(target) {
                return;
            }
            target = self.get_actual_type_variable(target);
        }
        if self.types[target]
            .flags
            .intersects(TypeFlags::TYPE_VARIABLE)
        {
            // Skip inference if the source is "blocked", which is used by the language service to prevent inference on nodes currently being edited.
            if self.is_from_inference_blocked_source(source) {
                return;
            }
            let inference = get_inference_info_for_type(self, n, target);
            if !inference.is_nil() {
                // If target is a type parameter, make an inference, unless the source type contains a "non-inferrable" type. Types with this flag set are markers used to prevent inference: anyFunctionType, autoType and autoArrayType are internal and should not be observable, and silentNeverType is returned by getInferredType when instantiating a generic function for inference. This flag is infectious: Box<never> of silentNeverType is also non-inferrable. As a special case, also ignore nonInferrableAnyType, which is a special form of the any type used as a stand-in for binding elements when they are being inferred.
                if self.types[source]
                    .object_flags
                    .intersects(ObjectFlags::NON_INFERRABLE_TYPE)
                    || source == self.non_inferrable_any_type
                {
                    return;
                }
                if !self.inference_infos[inference].is_fixed {
                    let candidate = or_else(self.inference_states[n].propagation_type, source);
                    if candidate == self.blocked_string_type {
                        return;
                    }
                    let priority = self.inference_states[n].priority;
                    if priority < self.inference_infos[inference].priority {
                        let info = &mut self.inference_infos[inference];
                        info.candidates = Vec::new();
                        info.contra_candidates = Vec::new();
                        info.top_level = true;
                        info.priority = priority;
                    }
                    if priority == self.inference_infos[inference].priority {
                        let inferences = self.inference_states[n].inferences;
                        // We make contravariant inferences only if we are in a pure contravariant position, i.e. only if we have not descended into a bivariant position.
                        if self.inference_states[n].contravariant
                            && !self.inference_states[n].bivariant
                        {
                            if !self.inference_infos[inference]
                                .contra_candidates
                                .contains(&candidate)
                            {
                                self.inference_infos[inference]
                                    .contra_candidates
                                    .push(candidate);
                                clear_cached_inferences(self, inferences);
                            }
                        } else if !self.inference_infos[inference]
                            .candidates
                            .contains(&candidate)
                        {
                            self.inference_infos[inference].candidates.push(candidate);
                            clear_cached_inferences(self, inferences);
                        }
                    }
                    if !priority.intersects(InferencePriority::RETURN_TYPE)
                        && self.types[target]
                            .flags
                            .intersects(TypeFlags::TYPE_PARAMETER)
                        && self.inference_infos[inference].top_level
                    {
                        let original_target = self.inference_states[n].original_target;
                        if !self.is_type_parameter_at_top_level(original_target, target, 0) {
                            self.inference_infos[inference].top_level = false;
                            let inferences = self.inference_states[n].inferences;
                            clear_cached_inferences(self, inferences);
                        }
                    }
                }
                let state = &mut self.inference_states[n];
                state.inference_priority = state.inference_priority.min(state.priority);
                return;
            }
            // Infer to the simplified version of an indexed access, if possible, to (hopefully) expose more bare type parameters to the inference engine
            let simplified = self.get_simplified_type(target, false);
            if simplified != target {
                self.infer_from_types(n, source, simplified);
            } else if self.types[target]
                .flags
                .intersects(TypeFlags::INDEXED_ACCESS)
            {
                let target_index_type = self.as_indexed_access_type(target).index_type;
                let index_type = self.get_simplified_type(target_index_type, false);
                // Generally simplifications of instantiable indexes are avoided to keep relationship checking correct, however if our target is an access, we can consider that key of that access to be "instantiated", since we're looking to find the infernce goal in any way we can.
                if self.types[index_type]
                    .flags
                    .intersects(TypeFlags::INSTANTIABLE)
                {
                    let target_object_type = self.as_indexed_access_type(target).object_type;
                    let object_type = self.get_simplified_type(target_object_type, false);
                    let simplified =
                        self.distribute_index_over_object_type(object_type, index_type, false);
                    if !simplified.is_nil() && simplified != target {
                        self.infer_from_types(n, source, simplified);
                    }
                }
            }
        }
        let source_flags = self.types[source].flags;
        let target_flags = self.types[target].flags;
        if self.types[source]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
            && self.types[target]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            && (self.as_type_reference(source).target == self.as_type_reference(target).target
                || self.is_array_type(source) && self.is_array_type(target))
            && (self.as_type_reference(source).node.is_nil()
                || self.as_type_reference(target).node.is_nil())
        {
            // If source and target are references to the same generic type, infer from type arguments
            let source_type_arguments = self.get_type_arguments(source);
            let target_type_arguments = self.get_type_arguments(target);
            let source_target = self.as_type_reference(source).target;
            let variances = self.get_variances(source_target);
            self.infer_from_type_arguments(
                n,
                source_type_arguments,
                target_type_arguments,
                variances,
            );
        } else if source_flags.intersects(TypeFlags::INDEX)
            && target_flags.intersects(TypeFlags::INDEX)
        {
            let source_target = self.as_index_type(source).target;
            let target_target = self.as_index_type(target).target;
            self.infer_from_contravariant_types(n, source_target, target_target);
        } else if (is_literal_type(self, source) || source_flags.intersects(TypeFlags::STRING))
            && target_flags.intersects(TypeFlags::INDEX)
        {
            let empty = self.create_empty_object_type_from_string_literal(source);
            let target_target = self.as_index_type(target).target;
            self.infer_from_contravariant_types_with_priority(
                n,
                empty,
                target_target,
                InferencePriority::LITERAL_KEYOF,
            );
        } else if source_flags.intersects(TypeFlags::INDEXED_ACCESS)
            && target_flags.intersects(TypeFlags::INDEXED_ACCESS)
        {
            let source_object_type = self.as_indexed_access_type(source).object_type;
            let target_object_type = self.as_indexed_access_type(target).object_type;
            self.infer_from_types(n, source_object_type, target_object_type);
            let source_index_type = self.as_indexed_access_type(source).index_type;
            let target_index_type = self.as_indexed_access_type(target).index_type;
            self.infer_from_types(n, source_index_type, target_index_type);
        } else if source_flags.intersects(TypeFlags::STRING_MAPPING)
            && target_flags.intersects(TypeFlags::STRING_MAPPING)
        {
            if self.types[source].symbol == self.types[target].symbol {
                let source_target = self.as_string_mapping_type(source).target;
                let target_target = self.as_string_mapping_type(target).target;
                self.infer_from_types(n, source_target, target_target);
            }
        } else if source_flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(source).base_type;
            self.infer_from_types(n, base_type, target);
            // Make substitute inference at a lower priority
            let substitution_intersection = self.get_substitution_intersection(source);
            self.infer_with_priority(
                n,
                substitution_intersection,
                target,
                InferencePriority::SUBSTITUTE_SOURCE,
            );
        } else if target_flags.intersects(TypeFlags::CONDITIONAL) {
            self.invoke_once(n, source, target, Self::infer_to_conditional_type);
        } else if target_flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            let target_types = self.type_types(target);
            self.infer_to_multiple_types(n, source, target_types, target_flags);
        } else if source_flags.intersects(TypeFlags::UNION) {
            // Source is a union or intersection type, infer from each constituent type
            let source_types = self.type_types(source);
            for &source_type in source_types.as_slice() {
                self.infer_from_types(n, source_type, target);
            }
        } else if target_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            self.infer_to_template_literal_type(n, source, target);
        } else {
            source = self.get_reduced_type(source);
            if self.is_generic_mapped_type(source) && self.is_generic_mapped_type(target) {
                self.invoke_once(n, source, target, Self::infer_from_generic_mapped_types);
            }
            if !(self.inference_states[n]
                .priority
                .intersects(InferencePriority::NO_CONSTRAINTS)
                && self.types[source]
                    .flags
                    .intersects(TypeFlags::INTERSECTION | TypeFlags::INSTANTIABLE))
            {
                let apparent_source = self.get_apparent_type(source);
                // getApparentType can return _any_ type, since an indexed access or conditional may simplify to any other type. If that occurs and it doesn't simplify to an object or intersection, we'll need to restart `inferFromTypes` with the simplified source.
                if apparent_source != source
                    && !self.types[apparent_source]
                        .flags
                        .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                {
                    self.infer_from_types(n, apparent_source, target);
                    return;
                }
                source = apparent_source;
            }
            if self.types[source]
                .flags
                .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
            {
                self.invoke_once(n, source, target, Self::infer_from_object_types);
            }
        }
    }

    pub fn infer_from_type_arguments(
        &mut self,
        n: InferenceStateId,
        source_types: List<'_, TypeId>,
        target_types: List<'_, TypeId>,
        variances: List<'_, VarianceFlags>,
    ) {
        for i in 0..source_types.len().min(target_types.len()) {
            if i < variances.len()
                && (variances.at(i) & VarianceFlags::VARIANCE_MASK) == VarianceFlags::CONTRAVARIANT
            {
                self.infer_from_contravariant_types(n, source_types.at(i), target_types.at(i));
            } else {
                self.infer_from_types(n, source_types.at(i), target_types.at(i));
            }
        }
    }

    pub fn infer_with_priority(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
        new_priority: InferencePriority,
    ) {
        let save_priority = self.inference_states[n].priority;
        self.inference_states[n].priority |= new_priority;
        self.infer_from_types(n, source, target);
        self.inference_states[n].priority = save_priority;
    }

    pub fn infer_from_contravariant_types_with_priority(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
        new_priority: InferencePriority,
    ) {
        let save_priority = self.inference_states[n].priority;
        self.inference_states[n].priority |= new_priority;
        self.infer_from_contravariant_types(n, source, target);
        self.inference_states[n].priority = save_priority;
    }

    pub fn infer_from_contravariant_types(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
    ) {
        let state = &mut self.inference_states[n];
        state.contravariant = !state.contravariant;
        self.infer_from_types(n, source, target);
        let state = &mut self.inference_states[n];
        state.contravariant = !state.contravariant;
    }

    pub fn infer_from_contravariant_types_if_strict_function_types(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
    ) {
        if self.strict_function_types
            || self.inference_states[n]
                .priority
                .intersects(InferencePriority::ALWAYS_STRICT)
        {
            self.infer_from_contravariant_types(n, source, target);
        } else {
            self.infer_from_types(n, source, target);
        }
    }

    // Ensure an inference action is performed only once for the given source and target types. This includes two things: avoiding inferring between the same pair of source and target types, and avoiding circularly inferring between source and target types. For an example of the last, consider inferring between source type `type Deep<T> = { next: Deep<Deep<T>> }` and target type `type Loop<U> = { next: Loop<U> }`: the types of the `next` property are ever deeper instantiations of `Deep` against `Loop<U>`, so we would go on inferring forever, even though we would never infer between the same pair of types.
    pub fn invoke_once(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
        action: fn(&mut Checker<'a>, InferenceStateId, TypeId, TypeId),
    ) {
        let key = InferenceKey {
            s: source,
            t: target,
        };
        if let Some(status) = self.inference_states[n].visited.get_ok(&key) {
            let state = &mut self.inference_states[n];
            state.inference_priority = state.inference_priority.min(status);
            return;
        }
        if self.inference_states[n].visited.is_nil() {
            self.inference_states[n].visited = Map::make();
        }
        let ok = self.inference_states[n]
            .visited
            .set(key, InferencePriority::CIRCULARITY);
        self.map_set(ok);
        let save_inference_priority = self.inference_states[n].inference_priority;
        self.inference_states[n].inference_priority = InferencePriority::MAX_VALUE;
        // We stop inferring and report a circularity if we encounter duplicate recursion identities on both the source side and the target side.
        let save_expanding_flags = self.inference_states[n].expanding_flags;
        self.inference_states[n].source_stack.push(source);
        self.inference_states[n].target_stack.push(target);
        let source_stack = std::mem::take(&mut self.inference_states[n].source_stack);
        let source_is_deeply_nested = self.is_deeply_nested_type(source, &source_stack, 2);
        self.inference_states[n].source_stack = source_stack;
        if source_is_deeply_nested {
            self.inference_states[n].expanding_flags |= ExpandingFlags::SOURCE;
        }
        let target_stack = std::mem::take(&mut self.inference_states[n].target_stack);
        let target_is_deeply_nested = self.is_deeply_nested_type(target, &target_stack, 2);
        self.inference_states[n].target_stack = target_stack;
        if target_is_deeply_nested {
            self.inference_states[n].expanding_flags |= ExpandingFlags::TARGET;
        }
        if self.inference_states[n].expanding_flags != ExpandingFlags::BOTH {
            action(self, n, source, target);
        } else {
            self.inference_states[n].inference_priority = InferencePriority::CIRCULARITY;
        }
        self.inference_states[n].target_stack.pop();
        self.inference_states[n].source_stack.pop();
        self.inference_states[n].expanding_flags = save_expanding_flags;
        let inference_priority = self.inference_states[n].inference_priority;
        let ok = self.inference_states[n]
            .visited
            .set(key, inference_priority);
        self.map_set(ok);
        let state = &mut self.inference_states[n];
        state.inference_priority = state.inference_priority.min(save_inference_priority);
    }

    // `sources` and `targets` come back as they are when nothing matched, as core.Filter answers upstream.
    pub fn infer_from_matching_types<'s>(
        &mut self,
        n: InferenceStateId,
        sources: &'s [TypeId],
        targets: &'s [TypeId],
        matches: fn(&mut Checker<'a>, TypeId, TypeId) -> bool,
        sort: bool,
    ) -> (Cow<'s, [TypeId]>, Cow<'s, [TypeId]>) {
        let mut matched_sources: Vec<TypeId> = Vec::new();
        let mut matched_targets: Vec<TypeId> = Vec::new();
        for &t in targets {
            for &s in sources {
                if matches(self, s, t) {
                    if !sort {
                        self.infer_from_types(n, s, t);
                    }
                    matched_sources = append_if_unique(matched_sources, s);
                    matched_targets = append_if_unique(matched_targets, t);
                }
            }
        }
        if sort {
            // Sort target types by decreasing depth of generic instantiations. Intuitively, a successful inference from a type argument with deeper nesting is of higher quality because we've stripped away more layers of type instantiations that otherwise might skew the results. For example, when inferring from string[] | string[][] to T[] | T[][], the inference of string we make from relating string[][] to T[][] is of higher quality than the inference of string[] we make relating string[][] to T[].
            sort_func(&mut matched_targets, &mut |t1, t2| {
                compare_types_and_depth(self, t1, t2) < 0
            });
            for &t in &matched_targets {
                for &s in &matched_sources {
                    if matches(self, s, t) {
                        self.infer_from_types(n, s, t);
                    }
                }
            }
        }
        let sources = if matched_sources.is_empty() {
            Cow::Borrowed(sources)
        } else {
            filter(sources, |t| !matched_sources.contains(&t))
        };
        let targets = if matched_targets.is_empty() {
            Cow::Borrowed(targets)
        } else {
            filter(targets, |t| !matched_targets.contains(&t))
        };
        (sources, targets)
    }
}

// Compare two types first by depth and then by the regular type ordering.
pub fn compare_types_and_depth(c: &mut Checker<'_>, t1: TypeId, t2: TypeId) -> isize {
    let d1 = get_type_depth(c, t1, 3);
    let d2 = get_type_depth(c, t2, 3);
    if d1 != d2 {
        // Largest depth sorts first
        return d2 - d1;
    }
    compare_types(c, t1, t2)
}

// Return the depth of the given type up to the given maximum depth. For generic aliased types and type references, the depth is one plus the largest type argument depth. For union and intersection types, the depth is the largest constituent type depth. For all other types, the depth is zero. The maximum depth limits infinite recursion of circular types.
pub fn get_type_depth(c: &mut Checker<'_>, t: TypeId, max_depth: isize) -> isize {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    if max_depth != 0 {
        let alias = c.types[t].alias;
        if !alias.is_nil() && c.type_aliases[alias].type_arguments.len() != 0 {
            let type_arguments = c.type_aliases[alias].type_arguments;
            return get_type_list_depth(c, type_arguments, max_depth - 1) + 1;
        }
        if c.types[t].object_flags.intersects(ObjectFlags::REFERENCE) {
            let type_arguments = c.get_type_arguments(t);
            if type_arguments.len() != 0 {
                return get_type_list_depth(c, type_arguments, max_depth - 1) + 1;
            }
        }
        if c.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            let types = c.type_types(t);
            return get_type_list_depth(c, types, max_depth);
        }
    }
    0
}

pub fn get_type_list_depth(c: &mut Checker<'_>, types: List<'_, TypeId>, max_depth: isize) -> isize {
    let mut depth = 0;
    for &t in types.as_slice() {
        depth = depth.max(get_type_depth(c, t, max_depth));
    }
    depth
}

impl<'a> Checker<'a> {
    pub fn infer_to_multiple_types(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        targets: List<'_, TypeId>,
        target_flags: TypeFlags,
    ) {
        let mut type_variable_count = 0;
        if target_flags.intersects(TypeFlags::UNION) {
            let mut naked_type_variable = TypeId::NIL;
            let single_source = [source];
            let sources: &[TypeId] = if self.types[source].flags.intersects(TypeFlags::UNION) {
                self.type_types(source).as_slice()
            } else {
                &single_source
            };
            let mut matched = vec![false; sources.len()];
            let mut inference_circularity = false;
            // First infer to types that are not naked type variables. For each source type we track whether inferences were made from that particular type to some target with equal priority (i.e. of equal quality) to what we would infer for a naked type parameter.
            for &t in targets.as_slice() {
                if !get_inference_info_for_type(self, n, t).is_nil() {
                    naked_type_variable = t;
                    type_variable_count += 1;
                } else {
                    for (&s, source_matched) in sources.iter().zip(matched.iter_mut()) {
                        let save_inference_priority = self.inference_states[n].inference_priority;
                        self.inference_states[n].inference_priority = InferencePriority::MAX_VALUE;
                        self.infer_from_types(n, s, t);
                        let inference_priority = self.inference_states[n].inference_priority;
                        if inference_priority == self.inference_states[n].priority {
                            *source_matched = true;
                        }
                        inference_circularity = inference_circularity
                            || inference_priority == InferencePriority::CIRCULARITY;
                        self.inference_states[n].inference_priority =
                            inference_priority.min(save_inference_priority);
                    }
                }
            }
            if type_variable_count == 0 {
                // If every target is an intersection of types containing a single naked type variable, make a lower priority inference to that type variable. This handles inferring from 'A | B' to 'T & (X | Y)' where we want to infer 'A | B' for T.
                let intersection_type_variable =
                    get_single_type_variable_from_intersection_types(self, n, targets);
                if !intersection_type_variable.is_nil() {
                    self.infer_with_priority(
                        n,
                        source,
                        intersection_type_variable,
                        InferencePriority::NAKED_TYPE_VARIABLE,
                    );
                }
                return;
            }
            // If the target has a single naked type variable and no inference circularities were encountered above (meaning we explored the types fully), create a union of the source types from which no inferences have been made so far and infer from that union to the naked type variable.
            if type_variable_count == 1 && !inference_circularity {
                let mut unmatched: Vec<TypeId> = Vec::new();
                for (&s, &source_matched) in sources.iter().zip(matched.iter()) {
                    if !source_matched {
                        unmatched.push(s);
                    }
                }
                if !unmatched.is_empty() {
                    let unmatched_type = self.get_union_type(List::from_slice(&unmatched));
                    self.infer_from_types(n, unmatched_type, naked_type_variable);
                    return;
                }
            }
        } else {
            // We infer from types that are not naked type variables first so that inferences we make from nested naked type variables and given slightly higher priority by virtue of being first in the candidates array.
            for &t in targets.as_slice() {
                if !get_inference_info_for_type(self, n, t).is_nil() {
                    type_variable_count += 1;
                } else {
                    self.infer_from_types(n, source, t);
                }
            }
        }
        // Inferences directly to naked type variables are given lower priority as they are less specific. For example, when inferring from Promise<string> to T | Promise<T>, we want to infer string for T, not Promise<string> | string. For intersection types we only infer to single naked type variables.
        if target_flags.intersects(TypeFlags::INTERSECTION) && type_variable_count == 1
            || !target_flags.intersects(TypeFlags::INTERSECTION) && type_variable_count > 0
        {
            for &t in targets.as_slice() {
                if !get_inference_info_for_type(self, n, t).is_nil() {
                    self.infer_with_priority(
                        n,
                        source,
                        t,
                        InferencePriority::NAKED_TYPE_VARIABLE,
                    );
                }
            }
        }
    }
}

pub fn get_single_type_variable_from_intersection_types(
    c: &Checker<'_>,
    n: InferenceStateId,
    types: List<'_, TypeId>,
) -> TypeId {
    let mut type_variable = TypeId::NIL;
    for &t in types.as_slice() {
        if !c.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            return TypeId::NIL;
        }
        let v = find(c.type_types(t).as_slice(), |t| {
            !get_inference_info_for_type(c, n, t).is_nil()
        });
        if v.is_nil() || !type_variable.is_nil() && v != type_variable {
            return TypeId::NIL;
        }
        type_variable = v;
    }
    type_variable
}

impl<'a> Checker<'a> {
    pub fn infer_to_multiple_types_with_priority(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        targets: List<'_, TypeId>,
        target_flags: TypeFlags,
        new_priority: InferencePriority,
    ) {
        let save_priority = self.inference_states[n].priority;
        self.inference_states[n].priority |= new_priority;
        self.infer_to_multiple_types(n, source, targets, target_flags);
        self.inference_states[n].priority = save_priority;
    }

    pub fn infer_to_conditional_type(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
    ) {
        if self.types[source].flags.intersects(TypeFlags::CONDITIONAL) {
            let source_check_type = self.as_conditional_type(source).check_type;
            let target_check_type = self.as_conditional_type(target).check_type;
            self.infer_from_types(n, source_check_type, target_check_type);
            let source_extends_type = self.as_conditional_type(source).extends_type;
            let target_extends_type = self.as_conditional_type(target).extends_type;
            self.infer_from_types(n, source_extends_type, target_extends_type);
            let source_true_type = self.get_true_type_from_conditional_type(source);
            let target_true_type = self.get_true_type_from_conditional_type(target);
            self.infer_from_types(n, source_true_type, target_true_type);
            let source_false_type = self.get_false_type_from_conditional_type(source);
            let target_false_type = self.get_false_type_from_conditional_type(target);
            self.infer_from_types(n, source_false_type, target_false_type);
        } else {
            let true_type = self.get_true_type_from_conditional_type(target);
            let false_type = self.get_false_type_from_conditional_type(target);
            let target_flags = self.types[target].flags;
            let new_priority = if_else(
                self.inference_states[n].contravariant,
                InferencePriority::CONTRAVARIANT_CONDITIONAL,
                InferencePriority::NONE,
            );
            self.infer_to_multiple_types_with_priority(
                n,
                source,
                List::from_slice(&[true_type, false_type]),
                target_flags,
                new_priority,
            );
        }
    }

    // `target` is the template literal type, which upstream passes as its `*TemplateLiteralType`.
    pub fn infer_to_template_literal_type(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
    ) {
        let matches = self.infer_types_from_template_literal_type(source, target);
        let types = self.as_template_literal_type(target).types;
        let texts = self.as_template_literal_type(target).texts;
        // When the target template literal contains only placeholders (meaning that inference is intended to extract single characters and remainder strings) and inference fails to produce matches, we want to infer 'never' for each placeholder such that instantiation with the inferred value(s) produces 'never', a type for which an assignment check will fail. If we make no inferences, we'll likely end up with the constraint 'string' which, upon instantiation, would collapse all the placeholders to just 'string', and an assignment check might succeed. That would be a pointless and confusing outcome.
        if matches.len() != 0 || texts.as_slice().iter().all(|s| s.is_empty()) {
            for (i, &target) in types.as_slice().iter().enumerate() {
                let source = if matches.len() != 0 {
                    matches.at(i)
                } else {
                    self.never_type
                };
                // If we are inferring from a string literal type to a type variable whose constraint includes one of the allowed template literal placeholder types, infer from a literal type corresponding to the constraint.
                if self.types[source]
                    .flags
                    .intersects(TypeFlags::STRING_LITERAL)
                    && self.types[target]
                        .flags
                        .intersects(TypeFlags::TYPE_VARIABLE)
                {
                    let inference_context = get_inference_info_for_type(self, n, target);
                    if !inference_context.is_nil() {
                        let type_parameter = self.inference_infos[inference_context].type_parameter;
                        let constraint = self.get_base_constraint_of_type(type_parameter);
                        if !constraint.is_nil() && !is_type_any(self, constraint) {
                            let constraint_types = self.type_distributed(constraint);
                            let mut all_type_flags = TypeFlags::NONE;
                            for &t in constraint_types.as_slice() {
                                all_type_flags |= self.types[t].flags;
                            }
                            // If the constraint contains `string`, we don't need to look for a more preferred type
                            if !all_type_flags.intersects(TypeFlags::STRING) {
                                let str = get_string_literal_value(self, source);
                                // If the type contains `number` or a number literal and the string isn't a valid number, exclude numbers
                                if all_type_flags.intersects(TypeFlags::NUMBER_LIKE)
                                    && !is_valid_number_string(str, true)
                                {
                                    all_type_flags = all_type_flags.without(TypeFlags::NUMBER_LIKE);
                                }
                                // If the type contains `bigint` or a bigint literal and the string isn't a valid bigint, exclude bigints
                                if all_type_flags.intersects(TypeFlags::BIG_INT_LIKE)
                                    && !is_valid_big_int_string(str, true)
                                {
                                    all_type_flags =
                                        all_type_flags.without(TypeFlags::BIG_INT_LIKE);
                                }
                                let choose = |c: &mut Checker<'a>,
                                              left: TypeId,
                                              right: TypeId|
                                 -> TypeId {
                                    let left_flags = c.types[left].flags;
                                    let right_flags = c.types[right].flags;
                                    if !right_flags.intersects(all_type_flags) {
                                        return left;
                                    }
                                    if left_flags.intersects(TypeFlags::STRING) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::STRING) {
                                        return source;
                                    }
                                    if left_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::TEMPLATE_LITERAL)
                                        && c.is_type_matched_by_template_literal_type(
                                            source,
                                            right,
                                            TypeComparer::Assignable,
                                        )
                                    {
                                        return source;
                                    }
                                    if left_flags.intersects(TypeFlags::STRING_MAPPING) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::STRING_MAPPING)
                                        && *str
                                            == *apply_string_mapping(
                                                c.ast,
                                                c.types[right].symbol,
                                                str,
                                            )
                                    {
                                        return source;
                                    }
                                    if left_flags.intersects(TypeFlags::STRING_LITERAL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::STRING_LITERAL)
                                        && get_string_literal_value(c, right) == str
                                    {
                                        return right;
                                    }
                                    if left_flags.intersects(TypeFlags::NUMBER) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::NUMBER) {
                                        return c.get_number_literal_type(from_string(str));
                                    }
                                    if left_flags.intersects(TypeFlags::ENUM) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::ENUM) {
                                        return c.get_number_literal_type(from_string(str));
                                    }
                                    if left_flags.intersects(TypeFlags::NUMBER_LITERAL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::NUMBER_LITERAL)
                                        && get_number_literal_value(c, right) == from_string(str)
                                    {
                                        return right;
                                    }
                                    if left_flags.intersects(TypeFlags::BIG_INT) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::BIG_INT) {
                                        return c.parse_big_int_literal_type(str);
                                    }
                                    if left_flags.intersects(TypeFlags::BIG_INT_LITERAL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::BIG_INT_LITERAL)
                                        && pseudo_big_int_to_string(get_big_int_literal_value(
                                            c, right,
                                        )) == str
                                    {
                                        return right;
                                    }
                                    if left_flags.intersects(TypeFlags::BOOLEAN) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::BOOLEAN) {
                                        if str == b"true" {
                                            return c.true_type;
                                        }
                                        if str == b"false" {
                                            return c.false_type;
                                        }
                                        return c.boolean_type;
                                    }
                                    if left_flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::BOOLEAN_LITERAL)
                                        && if_else(
                                            get_boolean_literal_value(c, right),
                                            b"true".as_slice(),
                                            b"false".as_slice(),
                                        ) == str
                                    {
                                        return right;
                                    }
                                    if left_flags.intersects(TypeFlags::UNDEFINED) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::UNDEFINED)
                                        && c.as_intrinsic_type(right).intrinsic_name == str
                                    {
                                        return right;
                                    }
                                    if left_flags.intersects(TypeFlags::NULL) {
                                        return left;
                                    }
                                    if right_flags.intersects(TypeFlags::NULL)
                                        && c.as_intrinsic_type(right).intrinsic_name == str
                                    {
                                        return right;
                                    }
                                    left
                                };
                                let mut matching_type = self.never_type;
                                for &t in constraint_types.as_slice() {
                                    matching_type = choose(self, matching_type, t);
                                }
                                if !self.types[matching_type]
                                    .flags
                                    .intersects(TypeFlags::NEVER)
                                {
                                    self.infer_from_types(n, matching_type, target);
                                    continue;
                                }
                            }
                        }
                    }
                }
                self.infer_from_types(n, source, target);
            }
        }
    }

    pub fn infer_from_generic_mapped_types(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
    ) {
        // The source and target types are generic types { [P in S]: X } and { [P in T]: Y }, so we infer from S to T and from X to Y.
        let source_constraint_type = self.get_constraint_type_from_mapped_type(source);
        let target_constraint_type = self.get_constraint_type_from_mapped_type(target);
        self.infer_from_types(n, source_constraint_type, target_constraint_type);
        let source_template_type = self.get_template_type_from_mapped_type(source);
        let target_template_type = self.get_template_type_from_mapped_type(target);
        self.infer_from_types(n, source_template_type, target_template_type);
        let source_name_type = self.get_name_type_from_mapped_type(source);
        let target_name_type = self.get_name_type_from_mapped_type(target);
        if !source_name_type.is_nil() && !target_name_type.is_nil() {
            self.infer_from_types(n, source_name_type, target_name_type);
        }
    }

    pub fn infer_from_object_types(&mut self, n: InferenceStateId, source: TypeId, target: TypeId) {
        let a = self.ast;
        if self.types[source]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
            && self.types[target]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            && (self.type_target(source) == self.type_target(target)
                || self.is_array_type(source) && self.is_array_type(target))
        {
            // If source and target are references to the same generic type, infer from type arguments
            let source_type_arguments = self.get_type_arguments(source);
            let target_type_arguments = self.get_type_arguments(target);
            let source_target = self.type_target(source);
            let variances = self.get_variances(source_target);
            self.infer_from_type_arguments(
                n,
                source_type_arguments,
                target_type_arguments,
                variances,
            );
            return;
        }
        if self.is_generic_mapped_type(source) && self.is_generic_mapped_type(target) {
            self.infer_from_generic_mapped_types(n, source, target);
        }
        if self.types[target]
            .object_flags
            .intersects(ObjectFlags::MAPPED)
            && a.as_mapped_type_node(self.as_mapped_type(target).declaration)
                .name_type
                .is_nil()
        {
            let constraint_type = self.get_constraint_type_from_mapped_type(target);
            if self.infer_to_mapped_type(n, source, target, constraint_type) {
                return;
            }
        }
        // Infer from the members of source and target only if the two types are possibly related
        if self.types_definitely_unrelated(source, target) {
            return;
        }
        if self.is_array_or_tuple_type(source) {
            if is_tuple_type(self, target) {
                let source_arity = self.get_type_reference_arity(source);
                let target_arity = self.get_type_reference_arity(target);
                let element_types = self.get_type_arguments(target);
                let element_infos = self.type_target_tuple_type(target).element_infos;
                // When source and target are tuple types with the same structure (fixed, variadic, and rest are matched to the same kind in each position), simply infer between the element types.
                if is_tuple_type(self, source)
                    && self.is_tuple_type_structure_matching(source, target)
                {
                    for i in 0..target_arity {
                        let source_element_type = self.get_type_arguments(source).at(i);
                        self.infer_from_types(n, source_element_type, element_types.at(i));
                    }
                    return;
                }
                let mut start_length = 0;
                let mut end_length = 0;
                if is_tuple_type(self, source) {
                    start_length = self
                        .type_target_tuple_type(source)
                        .fixed_length
                        .min(self.type_target_tuple_type(target).fixed_length);
                    if self
                        .type_target_tuple_type(target)
                        .combined_flags
                        .intersects(ElementFlags::VARIABLE)
                    {
                        end_length = get_end_element_count(
                            self.type_target_tuple_type(source),
                            ElementFlags::FIXED,
                        )
                        .min(get_end_element_count(
                            self.type_target_tuple_type(target),
                            ElementFlags::FIXED,
                        ));
                    }
                }
                // Infer between starting fixed elements.
                for i in 0..start_length {
                    let source_element_type = self.get_type_arguments(source).at(i);
                    self.infer_from_types(n, source_element_type, element_types.at(i));
                }
                if !is_tuple_type(self, source)
                    || source_arity - start_length - end_length == 1
                        && self
                            .type_target_tuple_type(source)
                            .element_infos
                            .at(start_length)
                            .flags
                            .intersects(ElementFlags::REST)
                {
                    // Single rest element remains in source, infer from that to every element in target
                    let rest_type = self.get_type_arguments(source).at(start_length);
                    for i in start_length..target_arity - end_length {
                        let mut t = rest_type;
                        if element_infos
                            .at(i)
                            .flags
                            .intersects(ElementFlags::VARIADIC)
                        {
                            t = self.create_array_type(t);
                        }
                        self.infer_from_types(n, t, element_types.at(i));
                    }
                } else {
                    let middle_length = target_arity - start_length - end_length;
                    if middle_length == 2 {
                        if (element_infos.at(start_length).flags
                            & element_infos.at(start_length + 1).flags)
                            .intersects(ElementFlags::VARIADIC)
                        {
                            // Middle of target is [...T, ...U] and source is tuple type
                            let target_info = get_inference_info_for_type(
                                self,
                                n,
                                element_types.at(start_length),
                            );
                            if !target_info.is_nil()
                                && self.inference_infos[target_info].implied_arity >= 0
                            {
                                // Infer slices from source based on implied arity of T.
                                let implied_arity = self.inference_infos[target_info].implied_arity;
                                let leading_slice = self.slice_tuple_type(
                                    source,
                                    start_length,
                                    end_length + source_arity - implied_arity,
                                );
                                self.infer_from_types(
                                    n,
                                    leading_slice,
                                    element_types.at(start_length),
                                );
                                let implied_arity = self.inference_infos[target_info].implied_arity;
                                let trailing_slice = self.slice_tuple_type(
                                    source,
                                    start_length + implied_arity,
                                    end_length,
                                );
                                self.infer_from_types(
                                    n,
                                    trailing_slice,
                                    element_types.at(start_length + 1),
                                );
                            }
                        } else if element_infos
                            .at(start_length)
                            .flags
                            .intersects(ElementFlags::VARIADIC)
                            && element_infos
                                .at(start_length + 1)
                                .flags
                                .intersects(ElementFlags::REST)
                        {
                            // Middle of target is [...T, ...rest] and source is tuple type: if T is constrained by a fixed-size tuple we might be able to use its arity to infer T
                            let info = get_inference_info_for_type(
                                self,
                                n,
                                element_types.at(start_length),
                            );
                            if !info.is_nil() {
                                let type_parameter = self.inference_infos[info].type_parameter;
                                let constraint = self.get_base_constraint_of_type(type_parameter);
                                if !constraint.is_nil()
                                    && is_tuple_type(self, constraint)
                                    && !self
                                        .type_target_tuple_type(constraint)
                                        .combined_flags
                                        .intersects(ElementFlags::VARIABLE)
                                {
                                    let implied_arity =
                                        self.type_target_tuple_type(constraint).fixed_length;
                                    let leading_slice = self.slice_tuple_type(
                                        source,
                                        start_length,
                                        source_arity - (start_length + implied_arity),
                                    );
                                    self.infer_from_types(
                                        n,
                                        leading_slice,
                                        element_types.at(start_length),
                                    );
                                    let rest_type = self.get_element_type_of_slice_of_tuple_type(
                                        source,
                                        start_length + implied_arity,
                                        end_length,
                                        false,
                                        false,
                                    );
                                    if !rest_type.is_nil() {
                                        self.infer_from_types(
                                            n,
                                            rest_type,
                                            element_types.at(start_length + 1),
                                        );
                                    }
                                }
                            }
                        } else if element_infos
                            .at(start_length)
                            .flags
                            .intersects(ElementFlags::REST)
                            && element_infos
                                .at(start_length + 1)
                                .flags
                                .intersects(ElementFlags::VARIADIC)
                        {
                            // Middle of target is [...rest, ...T] and source is tuple type: if T is constrained by a fixed-size tuple we might be able to use its arity to infer T
                            let info = get_inference_info_for_type(
                                self,
                                n,
                                element_types.at(start_length + 1),
                            );
                            if !info.is_nil() {
                                let type_parameter = self.inference_infos[info].type_parameter;
                                let constraint = self.get_base_constraint_of_type(type_parameter);
                                if !constraint.is_nil()
                                    && is_tuple_type(self, constraint)
                                    && !self
                                        .type_target_tuple_type(constraint)
                                        .combined_flags
                                        .intersects(ElementFlags::VARIABLE)
                                {
                                    let implied_arity =
                                        self.type_target_tuple_type(constraint).fixed_length;
                                    let end_index = source_arity
                                        - get_end_element_count(
                                            self.type_target_tuple_type(target),
                                            ElementFlags::FIXED,
                                        );
                                    let start_index = end_index - implied_arity;
                                    if start_index >= start_length {
                                        let trailing_types = self
                                            .get_type_arguments(source)
                                            .sub(start_index, end_index);
                                        let trailing_infos = self
                                            .type_target_tuple_type(source)
                                            .element_infos
                                            .sub(start_index, end_index);
                                        let trailing_slice = self.create_tuple_type_ex(
                                            trailing_types,
                                            trailing_infos,
                                            false,
                                        );
                                        let rest_type = self
                                            .get_element_type_of_slice_of_tuple_type(
                                                source,
                                                start_length,
                                                end_length + implied_arity,
                                                false,
                                                false,
                                            );
                                        if !rest_type.is_nil() {
                                            self.infer_from_types(
                                                n,
                                                rest_type,
                                                element_types.at(start_length),
                                            );
                                        }
                                        self.infer_from_types(
                                            n,
                                            trailing_slice,
                                            element_types.at(start_length + 1),
                                        );
                                    }
                                }
                            }
                        }
                    } else if middle_length == 1
                        && element_infos
                            .at(start_length)
                            .flags
                            .intersects(ElementFlags::VARIADIC)
                    {
                        // Middle of target is exactly one variadic element. Infer the slice between the fixed parts in the source. If target ends in optional element(s), make a lower priority a speculative inference.
                        let priority = if_else(
                            element_infos
                                .at(target_arity - 1)
                                .flags
                                .intersects(ElementFlags::OPTIONAL),
                            InferencePriority::SPECULATIVE_TUPLE,
                            InferencePriority::NONE,
                        );
                        let source_slice = self.slice_tuple_type(source, start_length, end_length);
                        self.infer_with_priority(
                            n,
                            source_slice,
                            element_types.at(start_length),
                            priority,
                        );
                    } else if middle_length == 1
                        && element_infos
                            .at(start_length)
                            .flags
                            .intersects(ElementFlags::REST)
                    {
                        // Middle of target is exactly one rest element. If middle of source is not empty, infer union of middle element types.
                        let rest_type = self.get_element_type_of_slice_of_tuple_type(
                            source,
                            start_length,
                            end_length,
                            false,
                            false,
                        );
                        if !rest_type.is_nil() {
                            self.infer_from_types(n, rest_type, element_types.at(start_length));
                        }
                    }
                }
                // Infer between ending fixed elements
                for i in 0..end_length {
                    let source_element_type =
                        self.get_type_arguments(source).at(source_arity - i - 1);
                    self.infer_from_types(
                        n,
                        source_element_type,
                        element_types.at(target_arity - i - 1),
                    );
                }
                return;
            }
            if self.is_array_type(target) {
                self.infer_from_index_types(n, source, target);
                return;
            }
        }
        self.infer_from_properties(n, source, target);
        self.infer_from_signatures(n, source, target, SignatureKind::CALL);
        self.infer_from_signatures(n, source, target, SignatureKind::CONSTRUCT);
        self.infer_from_index_types(n, source, target);
    }

    pub fn infer_from_properties(&mut self, n: InferenceStateId, source: TypeId, target: TypeId) {
        let a = self.ast;
        let properties = self.get_properties_of_object_type(target);
        for &target_prop in properties.as_slice() {
            let source_prop = self.get_property_of_type(source, a.sym(target_prop).name);
            if !source_prop.is_nil()
                && !some(a.sym(source_prop).declarations.as_slice(), |d| {
                    self.is_skip_direct_inference_node(d)
                })
            {
                let source_prop_type = self.get_type_of_symbol(source_prop);
                let source_type = self.remove_missing_type(
                    source_prop_type,
                    a.sym(source_prop).flags.intersects(SymbolFlags::OPTIONAL),
                );
                let target_prop_type = self.get_type_of_symbol(target_prop);
                let target_type = self.remove_missing_type(
                    target_prop_type,
                    a.sym(target_prop).flags.intersects(SymbolFlags::OPTIONAL),
                );
                self.infer_from_types(n, source_type, target_type);
            }
        }
    }

    pub fn infer_from_signatures(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
        kind: SignatureKind,
    ) {
        let source_signatures = self.get_signatures_of_type(source, kind);
        let source_len = source_signatures.len();
        if source_len > 0 {
            // We match source and target signatures from the bottom up, and if the source has fewer signatures than the target, we infer from the first source signature to the excess target signatures.
            let target_signatures = self.get_signatures_of_type(target, kind);
            let target_len = target_signatures.len();
            for i in 0..target_len {
                let source_index = (source_len - target_len + i).max(0);
                let base_signature = self.get_base_signature(source_signatures.at(source_index));
                let erased_signature = self.get_erased_signature(target_signatures.at(i));
                self.infer_from_signature(n, base_signature, erased_signature);
            }
        }
    }

    pub fn infer_from_signature(
        &mut self,
        n: InferenceStateId,
        source: SignatureId,
        target: SignatureId,
    ) {
        let a = self.ast;
        if !self.signatures[source]
            .flags
            .intersects(SignatureFlags::IS_NON_INFERRABLE)
        {
            let save_bivariant = self.inference_states[n].bivariant;
            let mut kind = Kind::Unknown;
            let declaration = self.signatures[target].declaration;
            if !declaration.is_nil() {
                kind = a.kind(declaration);
            }
            // Once we descend into a bivariant signature we remain bivariant for all nested inferences
            self.inference_states[n].bivariant = save_bivariant
                || kind == Kind::MethodDeclaration
                || kind == Kind::MethodSignature
                || kind == Kind::Constructor;
            self.apply_to_parameter_types(source, target, &mut |c, s, t| {
                c.infer_from_contravariant_types_if_strict_function_types(n, s, t);
            });
            self.inference_states[n].bivariant = save_bivariant;
        }
        self.apply_to_return_types(source, target, &mut |c, s, t| {
            c.infer_from_types(n, s, t);
        });
    }

    pub fn apply_to_parameter_types(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        callback: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId),
    ) {
        let source_count = self.get_parameter_count(source);
        let target_count = self.get_parameter_count(target);
        let source_rest_type = self.get_effective_rest_type(source);
        let target_rest_type = self.get_effective_rest_type(target);
        let mut target_non_rest_count = target_count;
        if !target_rest_type.is_nil() {
            target_non_rest_count -= 1;
        }
        let mut param_count = target_non_rest_count;
        if source_rest_type.is_nil() {
            param_count = source_count.min(target_non_rest_count);
        }
        let source_this_type = self.get_this_type_of_signature(source);
        if !source_this_type.is_nil() {
            let target_this_type = self.get_this_type_of_signature(target);
            if !target_this_type.is_nil() {
                callback(self, source_this_type, target_this_type);
            }
        }
        for i in 0..param_count {
            let source_type = self.get_type_at_position(source, i);
            let target_type = self.get_type_at_position(target, i);
            callback(self, source_type, target_type);
        }
        if !target_rest_type.is_nil() {
            let readonly = self.is_const_type_variable(target_rest_type, 0)
                && !some_type(self, target_rest_type, &mut |c, t| {
                    c.is_mutable_array_like_type(t)
                });
            let rest_type = self.get_rest_type_at_position(source, param_count, readonly);
            callback(self, rest_type, target_rest_type);
        }
    }

    pub fn apply_to_return_types(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        callback: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId),
    ) {
        let target_type_predicate = self.get_type_predicate_of_signature(target);
        if !target_type_predicate.is_nil() {
            let source_type_predicate = self.get_type_predicate_of_signature(source);
            if !source_type_predicate.is_nil()
                && self.type_predicate_kinds_match(source_type_predicate, target_type_predicate)
                && !self.type_predicates[source_type_predicate].t.is_nil()
                && !self.type_predicates[target_type_predicate].t.is_nil()
            {
                let source_type = self.type_predicates[source_type_predicate].t;
                let target_type = self.type_predicates[target_type_predicate].t;
                callback(self, source_type, target_type);
                return;
            }
        }
        let target_return_type = self.get_return_type_of_signature(target);
        if self.could_contain_type_variables(target_return_type) {
            let source_return_type = self.get_return_type_of_signature(source);
            callback(self, source_return_type, target_return_type);
        }
    }

    pub fn infer_from_index_types(&mut self, n: InferenceStateId, source: TypeId, target: TypeId) {
        let a = self.ast;
        // Inferences across mapped type index signatures are pretty much the same a inferences to homomorphic variables
        let mut priority = InferencePriority::NONE;
        if (self.types[source].object_flags & self.types[target].object_flags)
            .intersects(ObjectFlags::MAPPED)
        {
            priority = InferencePriority::HOMOMORPHIC_MAPPED_TYPE;
        }
        let index_infos = self.get_index_infos_of_type(target);
        if self.is_object_type_with_inferable_index(source) {
            for &target_info in index_infos.as_slice() {
                let mut prop_types: Vec<TypeId> = Vec::new();
                let properties = self.get_properties_of_type(source);
                for &prop in properties.as_slice() {
                    let name_type = self.get_literal_type_from_property(
                        prop,
                        TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                        false,
                    );
                    let target_key_type = self.index_infos[target_info].key_type;
                    if self.is_applicable_index_type(name_type, target_key_type) {
                        let mut prop_type = self.get_type_of_symbol(prop);
                        if a.sym(prop).flags.intersects(SymbolFlags::OPTIONAL) {
                            prop_type = self.remove_missing_or_undefined_type(prop_type);
                        }
                        prop_types.push(prop_type);
                    }
                }
                let source_index_infos = self.get_index_infos_of_type(source);
                for &info in source_index_infos.as_slice() {
                    let key_type = self.index_infos[info].key_type;
                    let target_key_type = self.index_infos[target_info].key_type;
                    if self.is_applicable_index_type(key_type, target_key_type) {
                        prop_types.push(self.index_infos[info].value_type);
                    }
                }
                if !prop_types.is_empty() {
                    let union_type = self.get_union_type(List::from_slice(&prop_types));
                    let target_value_type = self.index_infos[target_info].value_type;
                    self.infer_with_priority(n, union_type, target_value_type, priority);
                }
            }
        }
        for &target_info in index_infos.as_slice() {
            let target_key_type = self.index_infos[target_info].key_type;
            let source_info = self.get_applicable_index_info(source, target_key_type);
            if !source_info.is_nil() {
                let source_value_type = self.index_infos[source_info].value_type;
                let target_value_type = self.index_infos[target_info].value_type;
                self.infer_with_priority(n, source_value_type, target_value_type, priority);
            }
        }
    }

    // The recursion follows the constraint chain of a type parameter, so the entry tests the stack.
    pub fn infer_to_mapped_type(
        &mut self,
        n: InferenceStateId,
        source: TypeId,
        target: TypeId,
        constraint_type: TypeId,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let constraint_flags = self.types[constraint_type].flags;
        if constraint_flags.intersects(TypeFlags::UNION)
            || constraint_flags.intersects(TypeFlags::INTERSECTION)
        {
            let mut result = false;
            let types = self.type_types(constraint_type);
            for &t in types.as_slice() {
                result = or_else(self.infer_to_mapped_type(n, source, target, t), result);
            }
            return result;
        }
        if constraint_flags.intersects(TypeFlags::INDEX) {
            // We're inferring from some source type S to a homomorphic mapped type { [P in keyof T]: X }, where T is a type variable. Use inferTypeForHomomorphicMappedType to infer a suitable source type and then make a secondary inference from that type to T. We make a secondary inference such that direct inferences to T get priority over inferences to Partial<T>, for example.
            let constraint_target = self.as_index_type(constraint_type).target;
            let inference = get_inference_info_for_type(self, n, constraint_target);
            if !inference.is_nil()
                && !self.inference_infos[inference].is_fixed
                && !self.is_from_inference_blocked_source(source)
            {
                let inferred_type =
                    self.infer_type_for_homomorphic_mapped_type(source, target, constraint_type);
                if !inferred_type.is_nil() {
                    // We assign a lower priority to inferences made from types containing non-inferrable types because we may only have a partial result (i.e. we may have failed to make reverse inferences for some properties).
                    let type_parameter = self.inference_infos[inference].type_parameter;
                    let new_priority = if_else(
                        self.types[source]
                            .object_flags
                            .intersects(ObjectFlags::NON_INFERRABLE_TYPE),
                        InferencePriority::PARTIAL_HOMOMORPHIC_MAPPED_TYPE,
                        InferencePriority::HOMOMORPHIC_MAPPED_TYPE,
                    );
                    self.infer_with_priority(n, inferred_type, type_parameter, new_priority);
                }
            }
            return true;
        }
        if constraint_flags.intersects(TypeFlags::TYPE_PARAMETER) {
            // We're inferring from some source type S to a mapped type { [P in K]: X }, where K is a type parameter. First infer from 'keyof S' to K.
            let index_flags = if_else(
                !self.pattern_for_type.get(&source).is_nil(),
                IndexFlags::NO_INDEX_SIGNATURES,
                IndexFlags::NONE,
            );
            let index_type = self.get_index_type_ex(source, index_flags);
            self.infer_with_priority(
                n,
                index_type,
                constraint_type,
                InferencePriority::MAPPED_TYPE_CONSTRAINT,
            );
            // If K is constrained to a type C, also infer to C. Thus, for a mapped type { [P in K]: X }, where K extends keyof T, we make the same inferences as for a homomorphic mapped type { [P in keyof T]: X }. This enables us to make meaningful inferences when the target is a Pick<T, K>.
            let extended_constraint = self.get_constraint_of_type(constraint_type);
            if !extended_constraint.is_nil()
                && self.infer_to_mapped_type(n, source, target, extended_constraint)
            {
                return true;
            }
            // If no inferences can be made to K's constraint, infer from a union of the property types in the source to the template type X.
            let properties = self.get_properties_of_type(source);
            let mut prop_types: Vec<TypeId> = Vec::with_capacity(properties.as_slice().len());
            for &prop in properties.as_slice() {
                let prop_type = self.get_type_of_symbol(prop);
                prop_types.push(prop_type);
            }
            let index_infos = self.get_index_infos_of_type(source);
            let mut index_types: Vec<TypeId> = Vec::with_capacity(index_infos.as_slice().len());
            for &info in index_infos.as_slice() {
                if info != self.enum_number_index_info {
                    index_types.push(self.index_infos[info].value_type);
                } else {
                    index_types.push(self.never_type);
                }
            }
            let all_types = concatenate(&prop_types, &index_types);
            let union_type = self.get_union_type(List::from_slice(&all_types));
            let template_type = self.get_template_type_from_mapped_type(target);
            self.infer_from_types(n, union_type, template_type);
            return true;
        }
        false
    }

    // Infer a suitable input type for a homomorphic mapped type { [P in keyof T]: X }. We construct an object type with the same set of properties as the source type, where the type of each property is computed by inferring from the source property type to X for the type variable T[P] (i.e. we treat the type T[P] as the type variable we're inferring for).
    pub fn infer_type_for_homomorphic_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        constraint: TypeId,
    ) -> TypeId {
        let key = ReverseMappedTypeKey {
            source_id: source,
            target_id: target,
            constraint_id: constraint,
        };
        let cached = self.reverse_homomorphic_mapped_cache.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let t = self.create_reverse_mapped_type(source, target, constraint);
        let ok = self.reverse_homomorphic_mapped_cache.set(key, t);
        self.map_set(ok);
        t
    }

    pub fn create_reverse_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        constraint: TypeId,
    ) -> TypeId {
        // We consider a source type reverse mappable if it has a string index signature or if it has one or more properties and is of a partially inferable type.
        let string_type = self.string_type;
        let has_string_index_info = !self.get_index_info_of_type(source, string_type).is_nil();
        if !(has_string_index_info
            || self.get_properties_of_type(source).len() != 0
                && self.is_partially_inferable_type(source))
        {
            return TypeId::NIL;
        }
        // For arrays and tuples we infer new arrays and tuples where the reverse mapping has been applied to the element type(s).
        if self.is_array_type(source) {
            let source_element_type = self.get_type_arguments(source).at(0usize);
            let element_type =
                self.infer_reverse_mapped_type(source_element_type, target, constraint);
            if element_type.is_nil() {
                return TypeId::NIL;
            }
            let readonly = self.is_readonly_array_type(source);
            return self.create_array_type_ex(element_type, readonly);
        }
        if is_tuple_type(self, source) {
            let source_element_types = self.get_element_types(source);
            let element_types = self.map_list(source_element_types, |c, t| {
                c.infer_reverse_mapped_type(t, target, constraint)
            });
            if element_types.as_slice().iter().any(|t| t.is_nil()) {
                return TypeId::NIL;
            }
            let source_element_infos = self.type_target_tuple_type(source).element_infos;
            let element_infos = if get_mapped_type_modifiers(self, target)
                .intersects(MappedTypeModifiers::INCLUDE_OPTIONAL)
            {
                same_map(source_element_infos.as_slice(), |info| {
                    if info.flags.intersects(ElementFlags::OPTIONAL) {
                        return TupleElementInfo {
                            flags: ElementFlags::REQUIRED,
                            labeled_declaration: info.labeled_declaration,
                        };
                    }
                    info
                })
            } else {
                Cow::Borrowed(source_element_infos.as_slice())
            };
            let readonly = self.type_target_tuple_type(source).readonly;
            return self.create_tuple_type_ex(
                element_types,
                List::from_slice(&element_infos),
                readonly,
            );
        }
        // For all other object types we infer a new object type where the reverse mapping has been applied to the type of each property.
        let reversed = self.new_object_type(
            ObjectFlags::REVERSE_MAPPED | ObjectFlags::ANONYMOUS,
            SymbolId::NIL,
        );
        let data = self.as_reverse_mapped_type_mut(reversed);
        data.source = source;
        data.mapped_type = target;
        data.constraint_type = constraint;
        reversed
    }

    // We consider a type to be partially inferable if it isn't marked non-inferable or if it is an object literal type with at least one property of an inferable type. For example, an object literal { a: 123, b: x => true } is marked non-inferable because it contains a context sensitive arrow function, but is considered partially inferable because property 'a' has an inferable type.
    pub fn is_partially_inferable_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::NON_INFERRABLE_TYPE)
        {
            return true;
        }
        if is_object_literal_type(self, t) {
            let properties = self.get_properties_of_type(t);
            for &prop in properties.as_slice() {
                let prop_type = self.get_type_of_symbol(prop);
                if self.is_partially_inferable_type(prop_type) {
                    return true;
                }
            }
        }
        if is_tuple_type(self, t) {
            let element_types = self.get_element_types(t);
            for &element_type in element_types.as_slice() {
                if self.is_partially_inferable_type(element_type) {
                    return true;
                }
            }
        }
        false
    }

    pub fn infer_reverse_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        constraint: TypeId,
    ) -> TypeId {
        let key = ReverseMappedTypeKey {
            source_id: source,
            target_id: target,
            constraint_id: constraint,
        };
        if let Some(cached) = self.reverse_mapped_cache.get_ok(&key) {
            return or_else(cached, self.unknown_type);
        }
        self.reverse_mapped_source_stack.push(source);
        self.reverse_mapped_target_stack.push(target);
        let save_expanding_flags = self.reverse_expanding_flags;
        let source_stack = std::mem::take(&mut self.reverse_mapped_source_stack);
        let source_is_deeply_nested = self.is_deeply_nested_type(source, &source_stack, 2);
        self.reverse_mapped_source_stack = source_stack;
        if source_is_deeply_nested {
            self.reverse_expanding_flags |= ExpandingFlags::SOURCE;
        }
        let target_stack = std::mem::take(&mut self.reverse_mapped_target_stack);
        let target_is_deeply_nested = self.is_deeply_nested_type(target, &target_stack, 2);
        self.reverse_mapped_target_stack = target_stack;
        if target_is_deeply_nested {
            self.reverse_expanding_flags |= ExpandingFlags::TARGET;
        }
        let mut t = TypeId::NIL;
        if self.reverse_expanding_flags != ExpandingFlags::BOTH {
            t = self.infer_reverse_mapped_type_worker(source, target, constraint);
        }
        self.reverse_mapped_source_stack.pop();
        self.reverse_mapped_target_stack.pop();
        self.reverse_expanding_flags = save_expanding_flags;
        let ok = self.reverse_mapped_cache.set(key, t);
        self.map_set(ok);
        t
    }

    pub fn infer_reverse_mapped_type_worker(
        &mut self,
        source: TypeId,
        target: TypeId,
        constraint: TypeId,
    ) -> TypeId {
        let constraint_target = self.as_index_type(constraint).target;
        let mapped_type_parameter = self.get_type_parameter_from_mapped_type(target);
        let type_parameter = self.get_indexed_access_type(constraint_target, mapped_type_parameter);
        let template_type = self.get_template_type_from_mapped_type(target);
        let inference = new_inference_info(self, type_parameter);
        let inferences = self.live_list(&[inference]);
        self.infer_types(
            inferences,
            source,
            template_type,
            InferencePriority::NONE,
            false,
        );
        let inferred_type = self.get_type_from_inference(inference);
        let unknown_type = self.unknown_type;
        self.get_widened_type(or_else(inferred_type, unknown_type))
    }

    pub fn resolve_reverse_mapped_type_members(&mut self, t: TypeId) {
        let a = self.ast;
        let source = self.as_reverse_mapped_type(t).source;
        let mapped_type = self.as_reverse_mapped_type(t).mapped_type;
        let constraint_type = self.as_reverse_mapped_type(t).constraint_type;
        let string_type = self.string_type;
        let index_info = self.get_index_info_of_type(source, string_type);
        let modifiers = get_mapped_type_modifiers(self, mapped_type);
        let readonly_mask = !modifiers.intersects(MappedTypeModifiers::INCLUDE_READONLY);
        let optional_mask = if_else(
            modifiers.intersects(MappedTypeModifiers::INCLUDE_OPTIONAL),
            SymbolFlags::NONE,
            SymbolFlags::OPTIONAL,
        );
        let mut index_infos: List<'a, IndexInfoId> = List::NIL;
        if !index_info.is_nil() {
            let value_type = self.index_infos[index_info].value_type;
            let inferred_type =
                self.infer_reverse_mapped_type(value_type, mapped_type, constraint_type);
            let unknown_type = self.unknown_type;
            let is_readonly = readonly_mask && self.index_infos[index_info].is_readonly;
            let info = self.new_index_info(
                string_type,
                or_else(inferred_type, unknown_type),
                is_readonly,
                NodeId::NIL,
                List::NIL,
            );
            index_infos = self.list_of(&[info]);
        }
        let members = a.new_table();
        let limited_constraint = self.get_limited_constraint(t);
        let properties = self.get_properties_of_type(source);
        for &prop in properties.as_slice() {
            // In case of a reverse mapped type with an intersection constraint, if we were able to extract the filtering type literals we skip those properties that are not assignable to them, because the extra properties wouldn't get through the application of the mapped type anyway
            if !limited_constraint.is_nil() {
                let property_name_type = self.get_literal_type_from_property(
                    prop,
                    TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                    false,
                );
                if !self.is_type_assignable_to(property_name_type, limited_constraint) {
                    continue;
                }
            }
            let check_flags = CheckFlags::REVERSE_MAPPED
                | if_else(
                    readonly_mask && self.is_readonly_symbol(prop),
                    CheckFlags::READONLY,
                    CheckFlags::NONE,
                );
            let prop_symbol = a.sym(prop);
            let inferred_prop = self.new_symbol_ex(
                SymbolFlags::PROPERTY | (prop_symbol.flags & optional_mask),
                prop_symbol.name,
                check_flags,
            );
            a.update_symbol(inferred_prop, |s| s.declarations = prop_symbol.declarations);
            let inferred_links = self.value_symbol_links_get(inferred_prop);
            let prop_links = self.value_symbol_links_get(prop);
            let name_type = self.value_symbol_links[prop_links].name_type;
            self.value_symbol_links[inferred_links].name_type = name_type;
            let links = self.reverse_mapped_symbol_links.get(inferred_prop);
            let property_type = self.get_type_of_symbol(prop);
            self.reverse_mapped_symbol_links[links].property_type = property_type;
            let constraint_target = self.as_index_type(constraint_type).target;
            if self.types[constraint_target]
                .flags
                .intersects(TypeFlags::INDEXED_ACCESS)
                && self.types[self.as_indexed_access_type(constraint_target).object_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
                && self.types[self.as_indexed_access_type(constraint_target).index_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
            {
                // A reverse mapping of `{[K in keyof T[K_1]]: T[K_1]}` is the same as that of `{[K in keyof T]: T}`, since all we care about is inferring to the "type parameter" (or indexed access) shared by the constraint and template. So, to reduce the number of type identities produced, we simplify such indexed access occurrences
                let new_type_param = self.as_indexed_access_type(constraint_target).object_type;
                let new_mapped_type =
                    self.replace_indexed_access(mapped_type, constraint_target, new_type_param);
                self.reverse_mapped_symbol_links[links].mapped_type = new_mapped_type;
                let new_constraint_type = self.get_index_type(new_type_param);
                self.reverse_mapped_symbol_links[links].constraint_type = new_constraint_type;
            } else {
                self.reverse_mapped_symbol_links[links].mapped_type = mapped_type;
                self.reverse_mapped_symbol_links[links].constraint_type = constraint_type;
            }
            a.table_set(members, prop_symbol.name, inferred_prop);
        }
        self.set_structured_type_members(t, members, List::NIL, List::NIL, index_infos);
    }

    pub fn get_type_of_reverse_mapped_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            let reverse_links = self.reverse_mapped_symbol_links.get(symbol);
            let property_type = self.reverse_mapped_symbol_links[reverse_links].property_type;
            let mapped_type = self.reverse_mapped_symbol_links[reverse_links].mapped_type;
            let constraint_type = self.reverse_mapped_symbol_links[reverse_links].constraint_type;
            let inferred_type =
                self.infer_reverse_mapped_type(property_type, mapped_type, constraint_type);
            let unknown_type = self.unknown_type;
            self.value_symbol_links[links].resolved_type = or_else(inferred_type, unknown_type);
        }
        self.value_symbol_links[links].resolved_type
    }

    // If the original mapped type had an intersection constraint we extract its components, and we make an attempt to do so even if the intersection has been reduced to a union. This entire process allows us to possibly retrieve the filtering type literals. e.g. { [K in keyof U & ("a" | "b") ] } -> "a" | "b"
    pub fn get_limited_constraint(&mut self, t: TypeId) -> TypeId {
        let mapped_type = self.as_reverse_mapped_type(t).mapped_type;
        let constraint = self.get_constraint_type_from_mapped_type(mapped_type);
        let constraint_flags = self.types[constraint].flags;
        if !(constraint_flags.intersects(TypeFlags::UNION)
            || constraint_flags.intersects(TypeFlags::INTERSECTION))
        {
            return TypeId::NIL;
        }
        let mut origin = constraint;
        if constraint_flags.intersects(TypeFlags::UNION) {
            origin = self.as_union_type(constraint).origin;
        }
        if origin.is_nil() || !self.types[origin].flags.intersects(TypeFlags::INTERSECTION) {
            return TypeId::NIL;
        }
        let constraint_type = self.as_reverse_mapped_type(t).constraint_type;
        let origin_types = self.type_types(origin);
        let filtered_types = filter(origin_types.as_slice(), |t| t != constraint_type);
        let limited_constraint = self.get_intersection_type(List::from_slice(&filtered_types));
        if limited_constraint != self.never_type {
            return limited_constraint;
        }
        TypeId::NIL
    }

    pub fn replace_indexed_access(
        &mut self,
        instantiable: TypeId,
        t: TypeId,
        replacement: TypeId,
    ) -> TypeId {
        // map type.indexType to 0 and type.objectType to `[TReplacement]`, thus making the indexed access `[TReplacement][0]` or `TReplacement`
        let index_type = self.as_indexed_access_type(t).index_type;
        let object_type = self.as_indexed_access_type(t).object_type;
        let zero_type = self.get_number_literal_type(Number(0.0));
        let replacement_types = self.list_of(&[replacement]);
        let tuple_type = self.create_tuple_type(replacement_types);
        let sources = self.list_of(&[index_type, object_type]);
        let targets = self.list_of(&[zero_type, tuple_type]);
        let mapper = new_type_mapper(self, sources, targets);
        self.instantiate_type(instantiable, mapper)
    }

    pub fn types_definitely_unrelated(&mut self, source: TypeId, target: TypeId) -> bool {
        // Two tuple types with incompatible arities are definitely unrelated. Two object types that each have a property that is unmatched in the other are definitely unrelated.
        if is_tuple_type(self, source) && is_tuple_type(self, target) {
            return tuple_types_definitely_unrelated(self, source, target);
        }
        !self
            .get_unmatched_property(source, target, false, true)
            .is_nil()
            && !self
                .get_unmatched_property(target, source, false, false)
                .is_nil()
    }
}

pub fn tuple_types_definitely_unrelated(c: &Checker<'_>, source: TypeId, target: TypeId) -> bool {
    let s = c.type_target_tuple_type(source);
    let t = c.type_target_tuple_type(target);
    !t.combined_flags.intersects(ElementFlags::VARIADIC) && t.min_length > s.min_length
        || !t.combined_flags.intersects(ElementFlags::VARIABLE)
            && (s.combined_flags.intersects(ElementFlags::VARIABLE)
                || t.fixed_length < s.fixed_length)
}

impl<'a> Checker<'a> {
    pub fn is_tuple_type_structure_matching(&self, t1: TypeId, t2: TypeId) -> bool {
        if self.get_type_reference_arity(t1) != self.get_type_reference_arity(t2) {
            return false;
        }
        let element_infos = self.type_target_tuple_type(t1).element_infos;
        for (i, e) in element_infos.as_slice().iter().enumerate() {
            let other = self.type_target_tuple_type(t2).element_infos.at(i);
            if (e.flags & ElementFlags::VARIABLE) != (other.flags & ElementFlags::VARIABLE) {
                return false;
            }
        }
        true
    }

    pub fn is_type_or_base_identical_to(&mut self, s: TypeId, t: TypeId) -> bool {
        if t == self.missing_type {
            return s == t;
        }
        self.is_type_identical_to(s, t)
            || self.types[t].flags.intersects(TypeFlags::STRING)
                && self.types[s].flags.intersects(TypeFlags::STRING_LITERAL)
            || self.types[t].flags.intersects(TypeFlags::NUMBER)
                && self.types[s].flags.intersects(TypeFlags::NUMBER_LITERAL)
    }

    pub fn is_type_closely_matched_by(&self, s: TypeId, t: TypeId) -> bool {
        let source = &self.types[s];
        let target = &self.types[t];
        source.flags.intersects(TypeFlags::OBJECT)
            && target.flags.intersects(TypeFlags::OBJECT)
            && !source.symbol.is_nil()
            && source.symbol == target.symbol
            || !source.alias.is_nil()
                && !target.alias.is_nil()
                && self.type_aliases[source.alias].type_arguments.len() != 0
                && self.type_aliases[source.alias].symbol == self.type_aliases[target.alias].symbol
    }

    // Create an object with properties named in the string literal type. Every property has type `any`.
    pub fn create_empty_object_type_from_string_literal(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        let members = a.new_table();
        let types = self.type_distributed(t);
        for &t in types.as_slice() {
            if !self.types[t].flags.intersects(TypeFlags::STRING_LITERAL) {
                continue;
            }
            let name = get_string_literal_value(self, t);
            let literal_prop = self.new_symbol(SymbolFlags::PROPERTY, name);
            let links = self.value_symbol_links_get(literal_prop);
            self.value_symbol_links[links].resolved_type = self.any_type;
            let symbol = self.types[t].symbol;
            if !symbol.is_nil() {
                let literal_symbol = a.sym(symbol);
                a.update_symbol(literal_prop, |s| {
                    s.declarations = literal_symbol.declarations;
                    s.value_declaration = literal_symbol.value_declaration;
                });
            }
            a.table_set(members, name, literal_prop);
        }
        let mut index_infos: List<'a, IndexInfoId> = List::NIL;
        if self.types[t].flags.intersects(TypeFlags::STRING) {
            let string_type = self.string_type;
            let empty_object_type = self.empty_object_type;
            let info = self.new_index_info(
                string_type,
                empty_object_type,
                false,
                NodeId::NIL,
                List::NIL,
            );
            index_infos = self.list_of(&[info]);
        }
        self.new_anonymous_type(SymbolId::NIL, members, List::NIL, List::NIL, index_infos)
    }
//@@NEXT@@
}
