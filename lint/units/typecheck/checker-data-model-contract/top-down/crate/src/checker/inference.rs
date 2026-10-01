// checker.go 276-298 and inference.go 11-63, 1251-1283, 1317-1412, 1625-1684, mapper.go 87-94 and 300-326: inference records and their makers.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    ExpandingFlags, InferenceFlags, InferencePriority, TypeFlags,
};
use crate::checker::ids::*;
use crate::checker::relater::TypeComparer;
use crate::checker::types::Ternary;
use crate::tscore::golang::{GoIndex, List, Map, SliceBuf};
use crate::tscore::ids::{NodeId, TypeId};

// checker.go 289-298. The candidate lists grow by append and belong to one record, so they are vectors.
#[derive(Default, Clone)]
pub struct InferenceInfo {
    pub type_parameter: TypeId,
    pub candidates: Vec<TypeId>,
    pub contra_candidates: Vec<TypeId>,
    pub inferred_type: TypeId,
    pub priority: InferencePriority,
    pub top_level: bool,
    pub is_fixed: bool,
    pub implied_arity: isize,
}

#[derive(Clone, Copy, Default)]
pub struct IntraExpressionInferenceSite {
    pub node: NodeId,
    pub t: TypeId,
}

// checker.go 276-287. `inferences` is a handle: mergeInferences replaces elements that an inference state also sees.
#[derive(Default)]
pub struct InferenceContext<'a> {
    pub inferences: InferenceListId,
    pub signature: SignatureId,
    pub flags: InferenceFlags,
    pub compare_types: TypeComparer,
    pub mapper: TypeMapperId,
    pub non_fixing_mapper: TypeMapperId,
    pub return_mapper: TypeMapperId,
    pub outer_return_mapper: TypeMapperId,
    pub inferred_type_parameters: List<'a, TypeId>,
    pub intra_expression_inference_sites: Vec<IntraExpressionInferenceSite>,
}

// inference.go 16-30. InferenceKey is the pair of type ids.
#[derive(Default)]
pub struct InferenceState {
    pub inferences: InferenceListId,
    pub original_source: TypeId,
    pub original_target: TypeId,
    pub priority: InferencePriority,
    pub inference_priority: InferencePriority,
    pub contravariant: bool,
    pub bivariant: bool,
    pub expanding_flags: ExpandingFlags,
    pub propagation_type: TypeId,
    pub visited: Map<(TypeId, TypeId), InferencePriority>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
    pub next: InferenceStateId,
}

impl<'a> Checker<'a> {
    pub fn get_inference_state(&mut self) -> InferenceStateId {
        let mut n = self.free_inference_state;
        if n.is_nil() {
            n = self.inference_states.alloc(InferenceState::default());
        }
        self.free_inference_state = self.inference_states[n].next;
        n
    }

    pub fn put_inference_state(&mut self, n: InferenceStateId) {
        let next = self.free_inference_state;
        let state = &mut self.inference_states[n];
        state.visited.clear();
        state.inferences = InferenceListId::NIL;
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
        self.free_inference_state = n;
    }

    pub fn infer_types(
        &mut self,
        inferences: InferenceListId,
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

    // A nil comparer is `c.compareTypesAssignable`.
    pub fn new_inference_context(
        &mut self,
        type_parameters: List<'a, TypeId>,
        signature: SignatureId,
        flags: InferenceFlags,
        compare_types: TypeComparer,
    ) -> InferenceContextId {
        let mut compare_types = compare_types;
        if compare_types == TypeComparer::Nil {
            compare_types = TypeComparer::Assignable;
        }
        let mut inferences = Vec::with_capacity(type_parameters.as_slice().len());
        for type_parameter in type_parameters.iter() {
            inferences.push(self.new_inference_info(type_parameter));
        }
        let inferences = self.inference_lists.alloc(inferences);
        self.new_inference_context_worker(inferences, signature, flags, compare_types)
    }

    pub fn clone_inference_context(
        &mut self,
        n: InferenceContextId,
        extra_flags: InferenceFlags,
    ) -> InferenceContextId {
        if n.is_nil() {
            return InferenceContextId::NIL;
        }
        let source = self.inference_lists[self.inference_contexts[n].inferences].clone();
        let mut inferences = Vec::with_capacity(source.len());
        for info in source {
            inferences.push(self.clone_inference_info(info));
        }
        let inferences = self.inference_lists.alloc(inferences);
        let (signature, flags, compare_types) = {
            let context = &self.inference_contexts[n];
            (context.signature, context.flags, context.compare_types)
        };
        self.new_inference_context_worker(inferences, signature, flags | extra_flags, compare_types)
    }

    pub fn new_inference_context_worker(
        &mut self,
        inferences: InferenceListId,
        signature: SignatureId,
        flags: InferenceFlags,
        compare_types: TypeComparer,
    ) -> InferenceContextId {
        let n = self.inference_contexts.alloc(InferenceContext {
            inferences,
            signature,
            flags,
            compare_types,
            ..Default::default()
        });
        let mapper = self.new_inference_type_mapper(n, true);
        self.inference_contexts[n].mapper = mapper;
        let non_fixing_mapper = self.new_inference_type_mapper(n, false);
        self.inference_contexts[n].non_fixing_mapper = non_fixing_mapper;
        n
    }

    pub fn new_inference_info(&mut self, type_parameter: TypeId) -> InferenceInfoId {
        self.inference_infos.alloc(InferenceInfo {
            type_parameter,
            priority: InferencePriority::MAX_VALUE,
            top_level: true,
            implied_arity: -1,
            ..Default::default()
        })
    }

    pub fn clone_inference_info(&mut self, info: InferenceInfoId) -> InferenceInfoId {
        let copy = self.inference_infos[info].clone();
        self.inference_infos.alloc(copy)
    }

    pub fn clear_cached_inferences(&mut self, inferences: InferenceListId) {
        let mut i = 0;
        while let Some(&inference) = self.inference_lists[inferences].get(i) {
            if !self.inference_infos[inference].is_fixed {
                self.inference_infos[inference].inferred_type = TypeId::NIL;
            }
            i += 1;
        }
    }

    pub fn has_inference_candidates(&self, info: InferenceInfoId) -> bool {
        let info = &self.inference_infos[info];
        !info.candidates.is_empty() || !info.contra_candidates.is_empty()
    }

    // `target[i] = source[i]`: every holder of the target list sees the new element.
    pub fn merge_inferences(&mut self, target: InferenceListId, source: InferenceListId) {
        for i in 0..self.inference_lists[target].len() {
            let target_info = self.inference_at(target, i);
            let Some(&source_info) = self.inference_lists[source].get(i) else {
                self.index_out_of_range("mergeInferences: source[i]");
                break;
            };
            if !self.has_inference_candidates(target_info)
                && self.has_inference_candidates(source_info)
            {
                if let Some(slot) = self.inference_lists[target].get_mut(i) {
                    *slot = source_info;
                }
            }
        }
    }

    // `inferences[i]`
    pub fn inference_at(
        &self,
        inferences: InferenceListId,
        index: impl GoIndex,
    ) -> InferenceInfoId {
        match index
            .to_index()
            .and_then(|i| self.inference_lists[inferences].get(i))
        {
            Some(&info) => info,
            None => {
                self.index_out_of_range("inferences[i]");
                InferenceInfoId::NIL
            }
        }
    }

    // Maps forward-references to later types parameters to the empty object type.
    pub fn new_backreference_mapper(
        &mut self,
        context: InferenceContextId,
        index: isize,
    ) -> TypeMapperId {
        let inferences = self.inference_contexts[context].inferences;
        let mut type_parameters = SliceBuf::make(0, 0);
        let start = usize::try_from(index).unwrap_or(0);
        for &info in self.inference_lists[inferences].get(start..).unwrap_or(&[]) {
            type_parameters.push(self.inference_infos[info].type_parameter);
        }
        let type_parameters = self.list(&type_parameters);
        self.new_array_to_single_type_mapper(type_parameters, self.unknown_type)
    }

    // InferenceTypeMapper.Map
    pub fn map_inference(&mut self, n: InferenceContextId, fixing: bool, t: TypeId) -> TypeId {
        let inferences = self.inference_contexts[n].inferences;
        let mut i = 0;
        while let Some(&inference) = self.inference_lists[inferences].get(i) {
            if t == self.inference_infos[inference].type_parameter {
                if fixing && !self.inference_infos[inference].is_fixed {
                    // Before we commit to a particular inference, we infer from any intra-expression inference sites we have collected.
                    self.infer_from_intra_expression_sites(n);
                    let inferences = self.inference_contexts[n].inferences;
                    self.clear_cached_inferences(inferences);
                    self.inference_infos[inference].is_fixed = true;
                }
                return self.get_inferred_type(n, i as isize);
            }
            i += 1;
        }
        t
    }

    pub fn get_inferred_type(&mut self, n: InferenceContextId, index: isize) -> TypeId {
        let inferences = self.inference_contexts[n].inferences;
        let inference = self.inference_at(inferences, index);
        if self.inference_infos[inference].inferred_type.is_nil() {
            if self.inference_infos[inference].type_parameter == self.error_type {
                return self.inference_infos[inference].type_parameter;
            }
            let mut inferred_type = TypeId::NIL;
            let mut fallback_type = TypeId::NIL;
            let signature = self.inference_contexts[n].signature;
            if !signature.is_nil() {
                let mut inferred_covariant_type = TypeId::NIL;
                if !self.inference_infos[inference].candidates.is_empty() {
                    inferred_covariant_type = self.get_covariant_inference(inference, signature);
                }
                let mut inferred_contravariant_type = TypeId::NIL;
                if !self.inference_infos[inference].contra_candidates.is_empty() {
                    inferred_contravariant_type = self.get_contravariant_inference(inference);
                }
                if !inferred_covariant_type.is_nil() || !inferred_contravariant_type.is_nil() {
                    // The co-variant inference is preferred under the conditions of the comment at inference.go 1336.
                    let prefer_covariant_type = !inferred_covariant_type.is_nil()
                        && (inferred_contravariant_type.is_nil()
                            || !self.types[inferred_covariant_type]
                                .flags
                                .intersects(TypeFlags::NEVER | TypeFlags::ANY)
                                && {
                                    let contra_candidates =
                                        self.inference_infos[inference].contra_candidates.clone();
                                    self.some(&contra_candidates, |c, t| {
                                        c.is_type_assignable_to(inferred_covariant_type, t)
                                    })
                                }
                                && {
                                    let others = self.inference_lists[inferences].clone();
                                    self.every(&others, |c, other| {
                                        other != inference
                                            && c.get_constraint_of_type_parameter(
                                                c.inference_infos[other].type_parameter,
                                            ) != c.inference_infos[inference].type_parameter
                                            || {
                                                let candidates =
                                                    c.inference_infos[other].candidates.clone();
                                                c.every(&candidates, |c, t| {
                                                    c.is_type_assignable_to(
                                                        t,
                                                        inferred_covariant_type,
                                                    )
                                                })
                                            }
                                    })
                                });
                    if prefer_covariant_type {
                        inferred_type = inferred_covariant_type;
                        fallback_type = inferred_contravariant_type;
                    } else {
                        inferred_type = inferred_contravariant_type;
                        fallback_type = inferred_covariant_type;
                    }
                } else if self.inference_contexts[n]
                    .flags
                    .intersects(InferenceFlags::NO_DEFAULT)
                {
                    // We use silentNeverType as the wildcard that signals no inferences.
                    inferred_type = self.silent_never_type;
                } else {
                    // Infer either the default or the empty object type when no inferences were made.
                    let type_parameter = self.inference_infos[inference].type_parameter;
                    let default_type = self.get_default_from_type_parameter(type_parameter);
                    if !default_type.is_nil() {
                        // Any forward reference to a type parameter should be instantiated to the empty object type.
                        let backreference = self.new_backreference_mapper(n, index);
                        let non_fixing_mapper = self.inference_contexts[n].non_fixing_mapper;
                        let mapper = self.merge_type_mappers(backreference, non_fixing_mapper);
                        inferred_type = self.instantiate_type(default_type, mapper);
                    }
                }
            } else {
                inferred_type = self.get_type_from_inference(inference);
            }
            self.inference_infos[inference].inferred_type = inferred_type;
            if self.inference_infos[inference].inferred_type.is_nil() {
                self.inference_infos[inference].inferred_type = if self.inference_contexts[n]
                    .flags
                    .intersects(InferenceFlags::ANY_DEFAULT)
                {
                    self.any_type
                } else {
                    self.unknown_type
                };
            }
            let type_parameter = self.inference_infos[inference].type_parameter;
            let constraint = self.get_constraint_of_type_parameter(type_parameter);
            if !constraint.is_nil() {
                let non_fixing_mapper = self.inference_contexts[n].non_fixing_mapper;
                let instantiated_constraint = self.instantiate_type(constraint, non_fixing_mapper);
                let compare_types = self.inference_contexts[n].compare_types;
                if !inferred_type.is_nil() {
                    let constraint_with_this = self.get_type_with_this_argument(
                        instantiated_constraint,
                        inferred_type,
                        false,
                    );
                    if self.call_type_comparer(
                        compare_types,
                        inferred_type,
                        constraint_with_this,
                        false,
                    ) == Ternary::FALSE
                    {
                        let mut filtered_by_constraint = TypeId::NIL;
                        if self.inference_infos[inference].priority
                            == InferencePriority::RETURN_TYPE
                        {
                            // A pure return type inference may succeed without the constituents that are not assignable to the constraint.
                            filtered_by_constraint = self.map_type(inferred_type, &mut |c, t| {
                                if c.call_type_comparer(
                                    compare_types,
                                    t,
                                    constraint_with_this,
                                    false,
                                ) != Ternary::FALSE
                                {
                                    t
                                } else {
                                    c.never_type
                                }
                            });
                        }
                        inferred_type = if !filtered_by_constraint.is_nil()
                            && !self.types[filtered_by_constraint]
                                .flags
                                .intersects(TypeFlags::NEVER)
                        {
                            filtered_by_constraint
                        } else {
                            TypeId::NIL
                        };
                    }
                }
                if inferred_type.is_nil() {
                    // If the fallback type satisfies the constraint, we pick it. Otherwise, we pick the constraint.
                    inferred_type = if !fallback_type.is_nil() && {
                        let fallback_constraint = self.get_type_with_this_argument(
                            instantiated_constraint,
                            fallback_type,
                            false,
                        );
                        self.call_type_comparer(
                            compare_types,
                            fallback_type,
                            fallback_constraint,
                            false,
                        ) != Ternary::FALSE
                    } {
                        fallback_type
                    } else {
                        instantiated_constraint
                    };
                }
                self.inference_infos[inference].inferred_type = inferred_type;
            }
            self.clear_active_mapper_caches();
        }
        self.inference_infos[inference].inferred_type
    }

    pub fn get_inferred_types(&mut self, n: InferenceContextId) -> List<'a, TypeId> {
        let inferences = self.inference_contexts[n].inferences;
        let len = self.inference_lists[inferences].len();
        let mut result = SliceBuf::make(len as isize, len as isize);
        for i in 0..len {
            let inferred = self.get_inferred_type(n, i as isize);
            result.set(i, inferred);
        }
        self.list(&result)
    }

    // Stand-ins for the rest of inference.go and for callees of other layers.
    pub fn infer_from_types(&mut self, n: InferenceStateId, source: TypeId, target: TypeId) {
        let _ = (n, source, target);
        self.stand_in("inferFromTypes")
    }
    pub fn infer_from_intra_expression_sites(&mut self, n: InferenceContextId) {
        let _ = n;
        self.stand_in("inferFromIntraExpressionSites")
    }
    pub fn get_covariant_inference(
        &mut self,
        inference: InferenceInfoId,
        signature: SignatureId,
    ) -> TypeId {
        let _ = signature;
        self.stand_ins.record("getCovariantInference");
        self.inference_infos[inference]
            .candidates
            .first()
            .copied()
            .unwrap_or_default()
    }
    pub fn get_contravariant_inference(&mut self, inference: InferenceInfoId) -> TypeId {
        self.stand_ins.record("getContravariantInference");
        self.inference_infos[inference]
            .contra_candidates
            .first()
            .copied()
            .unwrap_or_default()
    }
    pub fn get_type_from_inference(&mut self, inference: InferenceInfoId) -> TypeId {
        let _ = inference;
        self.stand_ins.record("getTypeFromInference");
        TypeId::NIL
    }
    pub fn is_type_assignable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        let _ = (source, target);
        self.stand_in("isTypeAssignableTo")
    }
    pub fn get_default_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        self.stand_ins.record("getDefaultFromTypeParameter");
        self.scripted_defaults.get(&t)
    }
    pub fn get_type_with_this_argument(
        &mut self,
        t: TypeId,
        this_argument: TypeId,
        need_apparent_type: bool,
    ) -> TypeId {
        let _ = (this_argument, need_apparent_type);
        self.stand_ins.record("getTypeWithThisArgument");
        t
    }
    pub fn instantiate_signature_in_context_of(
        &mut self,
        signature: SignatureId,
        contextual_signature: SignatureId,
        inference_context: InferenceContextId,
        compare_types: TypeComparer,
    ) -> SignatureId {
        let _ = (contextual_signature, inference_context, compare_types);
        self.stand_ins.record("instantiateSignatureInContextOf");
        signature
    }
}
