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
//@@NEXT@@
}
