// checker/inference.go 32-63, 1251-1284, 1625-1652, 1669-1684 and checker.go 19580-19610, in upstream order.
use crate::checker::c01_data::{
    InferenceContext, InferenceInfo, InferenceState, IntraExpressionInferenceSite, TypeComparer,
};
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{InferenceFlags, InferencePriority, TypeFlags};
use crate::tscore::golang::{List, LiveList, Map};
use crate::tscore::ids::{
    InferenceContextId, InferenceInfoId, InferenceStateId, NodeId, SignatureId, TypeId,
    TypeMapperId,
};

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
        state.expanding_flags = Default::default();
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
        if state.visited.is_nil() {
            state.visited = Map::make();
        }
        self.infer_from_types(n, original_source, original_target);
        self.put_inference_state(n);
    }

    // checker.go 19580
    pub fn instantiate_signature_in_context_of(
        &mut self,
        signature: SignatureId,
        contextual_signature: SignatureId,
        inference_context: InferenceContextId,
        compare_types: TypeComparer,
    ) -> SignatureId {
        let type_parameters = self.get_type_parameters_for_mapper(signature);
        let context = self.new_inference_context(
            type_parameters,
            signature,
            InferenceFlags::NONE,
            compare_types,
        );
        // We clone the inferenceContext to avoid fixing. For example, when the source signature is <T>(x: T) => T[] and the contextual signature is (...args: A) => B, we want to infer the element type of A's constraint (say 'any') for T but leave it possible to later infer '[any]' back to A.
        let rest_type = self.get_effective_rest_type(contextual_signature);
        let mut mapper = TypeMapperId::NIL;
        if !inference_context.is_nil() {
            if !rest_type.is_nil()
                && self.types[rest_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
            {
                mapper = self.inference_contexts[inference_context].non_fixing_mapper;
            } else {
                mapper = self.inference_contexts[inference_context].mapper;
            }
        }
        let source_signature = if !mapper.is_nil() {
            self.instantiate_signature(contextual_signature, mapper)
        } else {
            contextual_signature
        };
        let inferences = self.inference_contexts[context].inferences;
        self.apply_to_parameter_types(source_signature, signature, &mut |c, source, target| {
            // Type parameters from outer context referenced by source type are fixed by instantiation of the source type
            c.infer_types(inferences, source, target, InferencePriority::NONE, false);
        });
        if inference_context.is_nil() {
            self.apply_to_return_types(
                contextual_signature,
                signature,
                &mut |c, source, target| {
                    c.infer_types(
                        inferences,
                        source,
                        target,
                        InferencePriority::RETURN_TYPE,
                        false,
                    );
                },
            );
        }
        let inferred_types = self.get_inferred_types(context);
        let declaration = self.signatures[contextual_signature].declaration;
        let is_in_js_file = self.is_in_js_file(declaration);
        self.get_signature_instantiation(signature, inferred_types, is_in_js_file, List::NIL)
    }

    pub fn new_inference_context(
        &mut self,
        type_parameters: List<'a, TypeId>,
        signature: SignatureId,
        flags: InferenceFlags,
        mut compare_types: TypeComparer,
    ) -> InferenceContextId {
        if compare_types == TypeComparer::Nil {
            compare_types = TypeComparer::Assignable;
        }
        // core.Map(typeParameters, newInferenceInfo): nil for nil.
        let inferences = if type_parameters.is_nil() {
            LiveList::NIL
        } else {
            let infos: Vec<InferenceInfoId> = type_parameters
                .iter()
                .map(|type_parameter| new_inference_info(self, type_parameter))
                .collect();
            self.live_list(&infos)
        };
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
        let inferences = self.inference_contexts[n].inferences;
        let cloned = self.clone_inference_infos(inferences);
        let signature = self.inference_contexts[n].signature;
        let flags = self.inference_contexts[n].flags | extra_flags;
        let compare_types = self.inference_contexts[n].compare_types;
        self.new_inference_context_worker(cloned, signature, flags, compare_types)
    }

    pub fn clone_inferred_part_of_context(&mut self, n: InferenceContextId) -> InferenceContextId {
        // core.Filter(n.inferences, hasInferenceCandidates): only the length and the elements are read.
        let kept: Vec<InferenceInfoId> = self.inference_contexts[n]
            .inferences
            .iter()
            .filter(|info| has_inference_candidates(self, *info))
            .collect();
        if kept.is_empty() {
            return InferenceContextId::NIL;
        }
        let cloned: Vec<InferenceInfoId> = kept
            .iter()
            .map(|info| clone_inference_info(self, *info))
            .collect();
        let cloned = self.live_list(&cloned);
        let signature = self.inference_contexts[n].signature;
        let flags = self.inference_contexts[n].flags;
        let compare_types = self.inference_contexts[n].compare_types;
        self.new_inference_context_worker(cloned, signature, flags, compare_types)
    }

    // core.Map(inferences, cloneInferenceInfo): nil for nil.
    fn clone_inference_infos(
        &mut self,
        inferences: LiveList<'a, InferenceInfoId>,
    ) -> LiveList<'a, InferenceInfoId> {
        if inferences.is_nil() {
            return LiveList::NIL;
        }
        let cloned: Vec<InferenceInfoId> = inferences
            .iter()
            .map(|info| clone_inference_info(self, info))
            .collect();
        self.live_list(&cloned)
    }

    pub fn new_inference_context_worker(
        &mut self,
        inferences: LiveList<'a, InferenceInfoId>,
        signature: SignatureId,
        flags: InferenceFlags,
        compare_types: TypeComparer,
    ) -> InferenceContextId {
        let n = self.inference_contexts.alloc(InferenceContext {
            inferences,
            signature,
            flags,
            compare_types,
            ..InferenceContext::default()
        });
        let mapper = self.new_inference_type_mapper(n, true);
        let non_fixing_mapper = self.new_inference_type_mapper(n, false);
        self.inference_contexts[n].mapper = mapper;
        self.inference_contexts[n].non_fixing_mapper = non_fixing_mapper;
        n
    }

    pub fn add_intra_expression_inference_site(
        &mut self,
        n: InferenceContextId,
        node: NodeId,
        t: TypeId,
    ) {
        self.inference_contexts[n]
            .intra_expression_inference_sites
            .push(IntraExpressionInferenceSite { node, t });
    }

    // `target[i] = source[i]` is seen by every holder of the target list.
    pub fn merge_inferences(
        &mut self,
        target: LiveList<'a, InferenceInfoId>,
        source: LiveList<'a, InferenceInfoId>,
    ) {
        for i in 0..target.len() {
            if !has_inference_candidates(self, target.at(i))
                && has_inference_candidates(self, source.at(i))
            {
                let ok = target.set(i, source.at(i));
                self.slice_set(ok);
            }
        }
    }
}

// inference.go 1625-1676: free functions upstream.

pub fn new_inference_info(c: &mut Checker<'_>, type_parameter: TypeId) -> InferenceInfoId {
    c.inference_infos.alloc(InferenceInfo {
        type_parameter,
        priority: InferencePriority::MAX_VALUE,
        top_level: true,
        implied_arity: -1,
        ..InferenceInfo::default()
    })
}

pub fn clone_inference_info(c: &mut Checker<'_>, info: InferenceInfoId) -> InferenceInfoId {
    let clone = c.inference_infos[info].clone();
    c.inference_infos.alloc(clone)
}

pub fn clear_cached_inferences(c: &mut Checker<'_>, inferences: LiveList<'_, InferenceInfoId>) {
    for inference in inferences.iter() {
        if !c.inference_infos[inference].is_fixed {
            c.inference_infos[inference].inferred_type = TypeId::NIL;
        }
    }
}

pub fn has_inference_candidates(c: &Checker<'_>, info: InferenceInfoId) -> bool {
    !c.inference_infos[info].candidates.is_empty()
        || !c.inference_infos[info].contra_candidates.is_empty()
}

pub fn has_overlapping_inferences(
    c: &Checker<'_>,
    a: LiveList<'_, InferenceInfoId>,
    b: LiveList<'_, InferenceInfoId>,
) -> bool {
    for i in 0..a.len() {
        if has_inference_candidates(c, a.at(i)) && has_inference_candidates(c, b.at(i)) {
            return true;
        }
    }
    false
}
