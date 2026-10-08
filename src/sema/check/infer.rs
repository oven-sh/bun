//! Infers type arguments for type parameters from a source type and a target type that mentions
//! them.
//!
//! Follows `internal/checker/inference.go` of TypeScript 7.0.2 function by function. The names in
//! `backticks` at the head of a function are the names there. Omitted: what the language service
//! blocks, and the arity a spread argument implies for `[...T, ...U]`.

use super::*;
use crate::bind::{Decl, ScopeKind};
use smallvec::{SmallVec, smallvec};

/// The members of a union or an intersection during iteration.
pub(super) type Parts = SmallVec<[TypeId; 8]>;

/// From this many pairs on, `Inference::visited` is searched through `Inference::visited_index`.
const VISITED_INDEX_FROM: usize = 16;

// InferencePriority. The lower the better.
pub(super) const PRIORITY_NAKED: u32 = 1;
const PRIORITY_SPECULATIVE_TUPLE: u32 = 1 << 1;
const PRIORITY_SUBSTITUTE_SOURCE: u32 = 1 << 2;
pub(super) const PRIORITY_HOMOMORPHIC: u32 = 1 << 3;
/// The same, from an incomplete source.
pub(super) const PRIORITY_PARTIAL_HOMOMORPHIC: u32 = 1 << 4;
pub(super) const PRIORITY_MAPPED_CONSTRAINT: u32 = 1 << 5;
const PRIORITY_CONTRAVARIANT_CONDITIONAL: u32 = 1 << 6;
pub(super) const PRIORITY_RETURN: u32 = 1 << 7;
const PRIORITY_LITERAL_KEYOF: u32 = 1 << 8;
/// The constraint of a type parameter is not considered.
pub(super) const PRIORITY_NO_CONSTRAINTS: u32 = 1 << 9;
/// As under strictFunctionTypes, regardless of the options.
pub(super) const PRIORITY_ALWAYS_STRICT: u32 = 1 << 10;
const PRIORITY_MAX: i32 = 1 << 11;
const PRIORITY_CIRCULARITY: i32 = -1;
/// Candidates found there are alternatives, not attempts at one answer.
const PRIORITY_IMPLIES_COMBINATION: u32 =
    PRIORITY_RETURN | PRIORITY_MAPPED_CONSTRAINT | PRIORITY_LITERAL_KEYOF;

/// `InferenceInfo`
#[derive(Clone, Default)]
pub(super) struct Candidate {
    pub covariant: SmallVec<[TypeId; 4]>,
    /// Type argument nesting depth at which each of `covariant` was found. The deepest come first.
    depths: SmallVec<[u32; 4]>,
    pub contravariant: SmallVec<[TypeId; 4]>,
    /// Candidates of a worse priority are dropped.
    pub priority: u32,
    /// Every inference so far was to the parameter itself, not to something that contains it.
    pub top_level: bool,
    pub fixed: Option<TypeId>,
    /// `...args: T`: the number of arguments for it.
    pub implied_arity: Option<usize>,
    /// `inferredType`: the result of `getInferredType`, cached until something it depends on
    /// changes (`clearCachedInferences`). While it is in progress: the type before the constraint
    /// of the parameter is applied.
    inferred: std::cell::Cell<Option<TypeId>>,
}

/// `InferenceContext` and `InferenceState` in one.
#[derive(Clone)]
pub(super) struct Inference {
    pub(super) params: SmallVec<[TypeId; 4]>,
    pub(super) candidates: SmallVec<[Candidate; 2]>,
    /// The signature the parameters belong to, used to find their occurrences in its return type.
    pub(super) sig: Option<SigId>,
    contra: bool,
    bivariant: bool,
    priority: u32,
    /// The best priority anything was inferred at since it was last reset.
    inference_priority: i32,
    visited: SmallVec<[(TypeId, TypeId, i32); 8]>,
    /// The index of each pair in `visited`, once there are `VISITED_INDEX_FROM` of them.
    visited_index: FxHashMap<(TypeId, TypeId), u32>,
    source_stack: SmallVec<[TypeId; 8]>,
    target_stack: SmallVec<[TypeId; 8]>,
    expanding: u8,
    depth: u32,
    calls: u32,
    /// The parameter type an inference started from.
    original_target: TypeId,
    /// `InferenceFlagsAnyDefault`: the call is in a JavaScript file, where a parameter without
    /// inferences is `any`.
    pub(super) any_default: bool,
    /// The mapper for the outer type parameters of the source signature. Its own type parameters
    /// that are not clones are not instantiated with it, so their constraints have to be
    /// instantiated through this.
    pub(super) around_source: MapperId,
    /// Without a signature, for `infer`: the mapper for the outer type parameters of the
    /// conditional type. The constraints of the parameters may mention them.
    pub(super) around: MapperId,
    /// `propagationType`
    propagated: Option<TypeId>,
    /// `returnMapper`, as the context whose `mapper` it is: nothing is inferred before something is
    /// mapped. `None`: nil.
    pub(super) return_context: Option<Box<Inference>>,
    /// The clone that `createOuterReturnMapper` creates, once.
    pub(super) outer_return_context: Option<Box<Inference>>,
    /// `InferenceFlagsNoDefault`
    pub(super) no_default: bool,
    /// `InferenceFlagsSkippedGenericFunction`
    pub(super) skipped_generic_function: bool,
    /// `inferredTypeParameters`
    pub(super) inferred_type_params: Vec<TypeId>,
    /// `intraExpressionInferenceSites`
    pub(super) intra_expression_inference_sites: Vec<(FileId, ExprId, TypeId)>,
}

impl Inference {
    pub(super) fn for_params(params: &[TypeId], sig: Option<SigId>) -> Inference {
        let candidates = params
            .iter()
            .map(|_| Candidate {
                priority: PRIORITY_MAX as u32,
                top_level: true,
                ..Default::default()
            })
            .collect();
        Inference {
            params: SmallVec::from_slice(params),
            candidates,
            sig,
            contra: false,
            bivariant: false,
            priority: 0,
            inference_priority: PRIORITY_MAX,
            visited: SmallVec::new(),
            visited_index: FxHashMap::default(),
            source_stack: SmallVec::new(),
            target_stack: SmallVec::new(),
            expanding: 0,
            depth: 0,
            calls: 0,
            original_target: TypeId::NEVER,
            any_default: false,
            around_source: MapperId::IDENTITY,
            around: MapperId::IDENTITY,
            propagated: None,
            return_context: None,
            outer_return_context: None,
            no_default: false,
            skipped_generic_function: false,
            inferred_type_params: Vec::new(),
            intra_expression_inference_sites: Vec::new(),
        }
    }

    /// `clearCachedInferences`
    pub(super) fn clear_cached_inferences(&self) {
        for c in &self.candidates {
            c.inferred.set(None);
        }
    }

    /// `getInferenceInfoForType`
    #[inline]
    fn index_of(&self, ty: TypeId) -> Option<usize> {
        self.params.iter().position(|&p| p == ty)
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// Infers `params` from `source` to `target`. For `infer` in conditional types.
    pub fn infer_from_types(
        &mut self,
        params: &[TypeId],
        source: TypeId,
        target: TypeId,
        around: MapperId,
    ) -> Vec<TypeId> {
        self.infer_from_types_comparing(params, source, target, around, &mut |c, s, t| {
            c.is_assignable(s, t)
        })
    }

    pub(super) fn infer_from_types_comparing(
        &mut self,
        params: &[TypeId],
        source: TypeId,
        target: TypeId,
        around: MapperId,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> Vec<TypeId> {
        let mut inference = Inference::for_params(params, None);
        inference.around = around;
        self.infer(
            &mut inference,
            source,
            target,
            PRIORITY_NO_CONSTRAINTS | PRIORITY_ALWAYS_STRICT,
        );
        (0..params.len())
            .map(|i| self.get_inferred_type_comparing(&inference, i, false, compare))
            .collect()
    }

    /// `inferTypes`
    pub(super) fn infer(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        priority: u32,
    ) {
        self.infer_ex(n, source, target, priority, false);
    }

    /// `inferTypes`. `contra`: `target` is in a contravariant position.
    fn infer_ex(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        priority: u32,
        contra: bool,
    ) {
        n.priority = priority;
        n.inference_priority = PRIORITY_MAX;
        n.contra = contra;
        n.bivariant = false;
        n.visited.clear();
        if !n.visited_index.is_empty() {
            n.visited_index.clear();
        }
        n.source_stack.clear();
        n.target_stack.clear();
        n.expanding = 0;
        n.depth = 0;
        n.calls = 0;
        n.original_target = target;
        // Fast path: `n.priority` only grows during inference and a candidate with a worse priority than the existing inference is
        // discarded, so nothing can be recorded. Limited to `InferencePriorityReturnType`: at other priorities inference can still
        // clear `topLevel`.
        if priority & PRIORITY_RETURN != 0
            && n.candidates
                .iter()
                .all(|c| c.fixed.is_some() || c.priority < priority)
        {
            return;
        }
        self.infer_types(n, source, target);
    }

    /// `inferFromTypes`
    fn infer_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        if !self.could_contain_type_variables(target) || self.is_no_infer(target) {
            return;
        }
        // It is inferred for every type parameter in `target`.
        if source == TypeId::WILDCARD {
            let saved = n.propagated.replace(source);
            self.infer_types(n, target, target);
            n.propagated = saved;
            return;
        }
        let (mut source, mut target) = (source, target);
        // The contextual return type may contain unresolved parts where the enclosing calls have no
        // inferences yet.
        if source == TypeId::UNRESOLVED && n.priority & PRIORITY_RETURN != 0 {
            return;
        }
        n.calls += 1;
        if n.calls > 200_000 || self.is_stack_low() {
            return;
        }
        // Two instantiations of one alias: infer between the type arguments only. Without type arguments there is nothing to infer.
        if let Some((alias, sources, targets, _)) = self.same_alias(source, target) {
            if !sources.is_empty() {
                self.infer_from_type_arguments_of(n, alias, &sources, &targets);
            }
            return;
        }
        if source == target {
            match self.data(source) {
                TypeData::Union(_) => {
                    for t in self.sorted_parts(source) {
                        self.infer_types(n, t, t);
                    }
                    return;
                }
                TypeData::Intersection(parts) => {
                    for &t in parts.iter() {
                        self.infer_types(n, t, t);
                    }
                    return;
                }
                _ => {}
            }
        }
        // The members of `source` and of `target` in order, if they are unions none of whose
        // members were matched.
        let (mut source_in_order, mut target_in_order): (Option<Parts>, Option<Parts>) =
            (None, None);
        match self.data(target) {
            TypeData::Union(_) => {
                // `never` is a source like any other, not an empty union.
                let mut sources: Parts = if source.is_never() {
                    smallvec![source]
                } else {
                    self.sorted_parts(source)
                };
                let mut targets = self.sorted_parts(target);
                let (whole_source, whole_target) = (source, target);
                let (source_count, target_count) = (sources.len(), targets.len());
                // Identical members on both sides are matched, then those instantiated from the
                // same generic type or alias.
                self.infer_from_matching(
                    n,
                    &mut sources,
                    &mut targets,
                    Self::is_type_or_base_identical_to,
                );
                self.infer_from_matching(
                    n,
                    &mut sources,
                    &mut targets,
                    Self::is_type_closely_matched_by,
                );
                if targets.is_empty() {
                    return;
                }
                target = self.union(&targets);
                if sources.is_empty() {
                    // From `string` to `string | T`: `string` is a better inference for `T` than
                    // the constraint of `T`.
                    self.infer_with_priority(n, source, target, PRIORITY_NAKED);
                    return;
                }
                source = self.union(&sources);
                if source == whole_source && sources.len() == source_count {
                    source_in_order = Some(sources);
                }
                if target == whole_target && targets.len() == target_count {
                    target_in_order = Some(targets);
                }
            }
            TypeData::Intersection(target_parts)
                if !target_parts
                    .iter()
                    .all(|&t| self.is_object_type(t) && !self.is_generic_mapped_type(t))
                // From `string[] & { extra: any }` to `string[] & T`: `{ extra: any }` for `T`. But
                // to `string[] & Iterable<T>` the `string[]` stays, and yields `string` for `T`.
                && !self.is_union(source) =>
            {
                let mut sources: Parts = match self.data(source) {
                    TypeData::Intersection(parts) => SmallVec::from_slice(parts),
                    _ => smallvec![source],
                };
                let mut targets: Parts = SmallVec::from_slice(target_parts);
                self.infer_from_matching(n, &mut sources, &mut targets, |c, s, t| {
                    s == t || c.is_identical(s, t)
                });
                if sources.is_empty() || targets.is_empty() {
                    return;
                }
                source = self.intersection(&sources);
                target = self.intersection(&targets);
            }
            _ => {}
        }
        // That may be all that is left of the union or the intersection.
        if self.is_no_infer(target) {
            return;
        }
        target = self.actual_type_variable(target);
        if self.is_type_variable(target) {
            if let Some(index) = n.index_of(target) {
                // `ObjectFlagsNonInferrableType`: a type with omitted parts is not a candidate. Nor
                // is `nonInferrableAnyType`, which lacks the flag: a type that contains it is one.
                if self.is_non_inferrable(source) || source == TypeId::NON_INFERRABLE_ANY {
                    return;
                }
                let candidate = n.propagated.unwrap_or(source);
                self.add_candidate(n, index, candidate, target);
                return;
            }
            // A simpler form may show more type parameters.
            let simplified = self.simplified(target, false);
            if simplified != target {
                self.infer_types(n, source, simplified);
            } else if let TypeData::IndexedAccess { obj, index, .. } = *self.data(target) {
                let index = self.simplified(index, false);
                if self.is_instantiable(index) {
                    let object = self.simplified(obj, false);
                    if let Some(distributed) =
                        self.distribute_index_over_object_type(object, index, false)
                        && distributed != target
                    {
                        self.infer_types(n, source, distributed);
                    }
                }
            }
        }
        // `source.AsTypeReference().node != nil && target.AsTypeReference().node != nil`
        let are_both_deferred =
            self.types().deferred(source).is_some() && self.types().deferred(target).is_some();
        match (self.data(source), self.data(target)) {
            // Two deferred references go through `invokeOnce`; otherwise inference might not
            // terminate.
            (TypeData::Ref { target: st, .. }, TypeData::Ref { target: tt, .. })
                if (st == tt || self.is_array(source) && self.is_array(target))
                    && !are_both_deferred =>
            {
                let (sa, ta) = (self.type_arguments(source), self.type_arguments(target));
                self.infer_from_type_arguments_of(n, *st, sa, ta);
            }
            (
                TypeData::Tuple {
                    flags: sf,
                    readonly: sr,
                    ..
                },
                TypeData::Tuple {
                    flags: tf,
                    readonly: tr,
                    ..
                },
            ) if sf == tf && sr == tr && !are_both_deferred => {
                let (se, te) = (self.type_arguments(source), self.type_arguments(target));
                self.infer_from_type_arguments(n, se, te, &[]);
            }
            (TypeData::Keyof(s), TypeData::Keyof(t)) => {
                self.infer_from_contravariant_types(n, *s, *t)
            }
            (_, TypeData::Keyof(t))
                if source == TypeId::STRING
                    || self.is_boolean(source)
                    || !source.is_never() && self.every_type(source, |c, m| c.is_unit(m)) =>
            {
                let empty = self.empty_object_type_from_string_literal(source);
                let saved = n.priority;
                n.priority |= PRIORITY_LITERAL_KEYOF;
                self.infer_from_contravariant_types(n, empty, *t);
                n.priority = saved;
            }
            (
                TypeData::IndexedAccess {
                    obj: so, index: si, ..
                },
                TypeData::IndexedAccess {
                    obj: to, index: ti, ..
                },
            ) => {
                self.infer_types(n, *so, *to);
                self.infer_types(n, *si, *ti);
            }
            (
                TypeData::StringMapping { kind: sk, ty: s },
                TypeData::StringMapping { kind: tk, ty: t },
            ) => {
                if sk == tk {
                    self.infer_types(n, *s, *t);
                }
            }
            (&TypeData::Substitution { base, constraint }, _) => {
                self.infer_types(n, base, target);
                let both = self.substitution_intersection(base, constraint);
                self.infer_with_priority(n, both, target, PRIORITY_SUBSTITUTE_SOURCE);
            }
            (_, TypeData::Cond { .. }) => {
                self.invoke_once(n, source, target, Self::infer_to_conditional_type)
            }
            (_, TypeData::Union(_)) => {
                let parts = match target_in_order {
                    Some(parts) => parts,
                    None => self.sorted_parts(target),
                };
                self.infer_to_multiple_types(n, source, source_in_order, &parts, Multiple::Union)
            }
            (_, TypeData::Intersection(parts)) => {
                self.infer_to_multiple_types(n, source, None, parts, Multiple::Intersection)
            }
            (TypeData::Union(_), _) => {
                for s in self.sorted_parts(source) {
                    self.infer_types(n, s, target);
                }
            }
            (_, TypeData::Template { texts, types }) => {
                self.infer_to_template_literal_type(n, source, texts, types)
            }
            _ => {
                let mut source = self.reduced(source);
                if self.is_generic_mapped_type(source) && self.is_generic_mapped_type(target) {
                    self.invoke_once(n, source, target, Self::infer_from_generic_mapped_types);
                }
                if !(n.priority & PRIORITY_NO_CONSTRAINTS != 0
                    && (matches!(self.data(source), TypeData::Intersection(_))
                        || self.is_instantiable(source)))
                {
                    let apparent = self.apparent_type(source);
                    // The constraint of a type parameter can be any type.
                    if apparent != source
                        && !(self.is_object_type(apparent)
                            || matches!(self.data(apparent), TypeData::Intersection(_)))
                    {
                        self.infer_types(n, apparent, target);
                        return;
                    }
                    source = apparent;
                }
                if self.is_object_type(source)
                    || matches!(self.data(source), TypeData::Intersection(_))
                {
                    self.invoke_once(n, source, target, Self::infer_from_object_types);
                }
            }
        }
    }

    /// The part of `inferFromTypes` that runs once it has found which type parameter `target` is.
    fn add_candidate(
        &mut self,
        n: &mut Inference,
        index: usize,
        candidate: TypeId,
        target: TypeId,
    ) {
        if n.candidates[index].fixed.is_none() {
            let (priority, contra, depth) = (n.priority, n.contra && !n.bivariant, n.depth);
            let mut has_changed = false;
            let c = &mut n.candidates[index];
            if priority < c.priority {
                c.covariant.clear();
                c.depths.clear();
                c.contravariant.clear();
                c.top_level = true;
                c.priority = priority;
            }
            if priority == c.priority {
                // Contravariant only if no bivariant position was crossed on the way.
                if contra {
                    if !c.contravariant.contains(&candidate) {
                        c.contravariant.push(candidate);
                        has_changed = true;
                    }
                } else {
                    let found = c.covariant.iter().position(|&t| t == candidate);
                    if found.is_none_or(|i| c.depths[i] < depth) {
                        if let Some(i) = found {
                            c.covariant.remove(i);
                            c.depths.remove(i);
                        }
                        let at = c
                            .depths
                            .iter()
                            .position(|&d| d < depth)
                            .unwrap_or(c.depths.len());
                        c.covariant.insert(at, candidate);
                        c.depths.insert(at, depth);
                        has_changed = true;
                    }
                }
            }
            if priority & PRIORITY_RETURN == 0
                && matches!(
                    self.data(target),
                    TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_)
                )
                && n.candidates[index].top_level
                && !self.is_type_parameter_at_top_level(n.original_target, target, 0)
            {
                n.candidates[index].top_level = false;
                has_changed = true;
            }
            if has_changed {
                n.clear_cached_inferences();
            }
        }
        n.inference_priority = n.inference_priority.min(n.priority as i32);
    }

    /// The members of a union in the order TypeScript iterates over them, as `parts_in_order`
    /// returns them.
    pub(super) fn sorted_parts(&self, ty: TypeId) -> Parts {
        Parts::from_slice(self.parts(ty))
    }

    /// `inferFromTypeArguments`, between two instantiations of `of`. Cached variances are read in
    /// place: all threads share them, and a reference count incremented and decremented for every
    /// pair of references costs every thread.
    fn infer_from_type_arguments_of(
        &mut self,
        n: &mut Inference,
        of: Sym,
        sources: &[TypeId],
        targets: &[TypeId],
    ) {
        if let Some(known) = self.p.variances.get_ref(&self.task, &of) {
            self.note_inferred_by_variances(of, sources.len().min(targets.len()));
            return self.infer_from_type_arguments(n, sources, targets, known);
        }
        let variances = self.variances_of(of);
        self.note_inferred_by_variances(of, sources.len().min(targets.len()));
        self.infer_from_type_arguments(n, sources, targets, variances);
    }

    /// `inferFromTypeArguments`
    fn infer_from_type_arguments(
        &mut self,
        n: &mut Inference,
        sources: &[TypeId],
        targets: &[TypeId],
        variances: &[u8],
    ) {
        n.depth += 1;
        for i in 0..sources.len().min(targets.len()) {
            if variances.get(i).is_some_and(|v| v & 7 == 2) {
                self.infer_from_contravariant_types(n, sources[i], targets[i]);
            } else {
                self.infer_types(n, sources[i], targets[i]);
            }
        }
        n.depth -= 1;
    }

    /// `inferWithPriority`
    fn infer_with_priority(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        priority: u32,
    ) {
        let saved = n.priority;
        n.priority |= priority;
        self.infer_types(n, source, target);
        n.priority = saved;
    }

    /// `inferFromContravariantTypes`
    fn infer_from_contravariant_types(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
    ) {
        n.contra = !n.contra;
        self.infer_types(n, source, target);
        n.contra = !n.contra;
    }

    /// `invokeOnce`: not twice for the same pair of types, and not indefinitely between
    /// instantiations of the same two.
    fn invoke_once(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        action: fn(&mut Self, &mut Inference, TypeId, TypeId),
    ) {
        let seen = if n.visited.len() < VISITED_INDEX_FROM {
            n.visited
                .iter()
                .position(|v| v.0 == source && v.1 == target)
        } else {
            n.visited_index
                .get(&(source, target))
                .map(|&slot| slot as usize)
        };
        if let Some(seen) = seen {
            n.inference_priority = n.inference_priority.min(n.visited[seen].2);
            return;
        }
        let slot = n.visited.len();
        n.visited.push((source, target, PRIORITY_CIRCULARITY));
        if n.visited.len() == VISITED_INDEX_FROM {
            n.visited_index.extend(
                n.visited
                    .iter()
                    .enumerate()
                    .map(|(i, v)| ((v.0, v.1), i as u32)),
            );
        } else if n.visited.len() > VISITED_INDEX_FROM {
            n.visited_index.insert((source, target), slot as u32);
        }
        let saved_priority = std::mem::replace(&mut n.inference_priority, PRIORITY_MAX);
        let saved_expanding = n.expanding;
        n.source_stack.push(source);
        n.target_stack.push(target);
        if self.is_deeply_nested_type(source, &n.source_stack, 2) {
            n.expanding |= 1;
        }
        if self.is_deeply_nested_type(target, &n.target_stack, 2) {
            n.expanding |= 2;
        }
        if n.expanding != 3 {
            action(self, n, source, target);
        } else {
            n.inference_priority = PRIORITY_CIRCULARITY;
        }
        n.target_stack.pop();
        n.source_stack.pop();
        n.expanding = saved_expanding;
        n.visited[slot].2 = n.inference_priority;
        n.inference_priority = n.inference_priority.min(saved_priority);
    }

    /// `inferFromMatchingTypes`: infers between the pairs for which `matches` holds, and leaves the
    /// unmatched members.
    fn infer_from_matching(
        &mut self,
        n: &mut Inference,
        sources: &mut Parts,
        targets: &mut Parts,
        matches: impl Fn(&mut Self, TypeId, TypeId) -> bool,
    ) {
        let mut matched_sources: SmallVec<[bool; 8]> = smallvec![false; sources.len()];
        let mut matched_targets: SmallVec<[bool; 8]> = smallvec![false; targets.len()];
        let mut any_matched = false;
        for (j, &t) in targets.iter().enumerate() {
            for (i, &s) in sources.iter().enumerate() {
                if matches(self, s, t) {
                    self.infer_types(n, s, t);
                    matched_sources[i] = true;
                    matched_targets[j] = true;
                    any_matched = true;
                }
            }
        }
        if !any_matched {
            return;
        }
        let retain_unmatched = |list: &mut Parts, matched: &[bool]| {
            let mut next = 0;
            list.retain(|_| {
                next += 1;
                !matched[next - 1]
            });
        };
        retain_unmatched(sources, &matched_sources[..]);
        retain_unmatched(targets, &matched_targets[..]);
    }

    /// `inferToMultipleTypes`. `sources_in_order`: the members of `source` in order, or `source`
    /// alone if it is not a union, if already available.
    fn infer_to_multiple_types(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        sources_in_order: Option<Parts>,
        targets: &[TypeId],
        kind: Multiple,
    ) {
        let mut type_variable_count = 0;
        if kind == Multiple::Union {
            let mut naked = TypeId::NEVER;
            let sources: Parts = match sources_in_order {
                Some(sources) => sources,
                None if self.is_union(source) => self.sorted_parts(source),
                None => smallvec![source],
            };
            let mut matched: SmallVec<[bool; 8]> = smallvec![false; sources.len()];
            let mut circularity = false;
            // `Extract<A | B | .., { kind: T }>` is a union of conditional types that differ only
            // where there is no type parameter. Inferring from one source to one target a second
            // time changes nothing: the candidates are a set, `invoke_once` returns the priority
            // it has stored, and `matched`, `circularity` and the priority only accumulate.
            let has_many_pairs = sources.len() >= 4 && targets.len() >= 4;
            let mut inferred_to = crate::util::FxHashSet::default();
            // By source: `None` if what is inferred from it depends on more than the branches.
            let mut source_aliases: SmallVec<[Option<Option<Sym>>; 8]> = SmallVec::new();
            // First to the targets that are not naked type parameters, tracking the sources from
            // which an inference was made at a priority as good as a naked type parameter would
            // get.
            for &t in targets {
                if n.index_of(t).is_some() {
                    naked = t;
                    type_variable_count += 1;
                    continue;
                }
                let is_repeated = has_many_pairs
                    && (self.generic_parts_of_branches(t))
                        .is_some_and(|parts| !inferred_to.insert(parts));
                let target_alias = is_repeated.then(|| self.alias_symbol_of_type(t));
                if is_repeated && source_aliases.is_empty() {
                    source_aliases.extend(sources.iter().map(|&s| {
                        let depends_on_more = s == TypeId::WILDCARD
                            || matches!(
                                self.data(s),
                                TypeData::Cond { .. } | TypeData::Substitution { .. }
                            );
                        (!depends_on_more).then(|| self.alias_symbol_of_type(s))
                    }));
                }
                for (i, &s) in sources.iter().enumerate() {
                    // `same_alias` is the other thing that `infer_types` asks of the target.
                    if let Some(target_alias) = target_alias
                        && let Some(source_alias) = source_aliases[i]
                        && (source_alias.is_none() || source_alias != target_alias)
                    {
                        continue;
                    }
                    let saved = std::mem::replace(&mut n.inference_priority, PRIORITY_MAX);
                    self.infer_types(n, s, t);
                    if n.inference_priority == n.priority as i32 {
                        matched[i] = true;
                    }
                    circularity |= n.inference_priority == PRIORITY_CIRCULARITY;
                    n.inference_priority = n.inference_priority.min(saved);
                }
            }
            if type_variable_count == 0 {
                // From `A | B` to `T & (X | Y)`, which is `T & X | T & Y` by now: `A | B` for `T`.
                let mut variable = None;
                for &t in targets {
                    let TypeData::Intersection(parts) = self.data(t) else {
                        return;
                    };
                    let Some(&v) = parts.iter().find(|&&p| n.index_of(p).is_some()) else {
                        return;
                    };
                    if variable.is_some_and(|other| other != v) {
                        return;
                    }
                    variable = Some(v);
                }
                if let Some(variable) = variable {
                    self.infer_with_priority(n, source, variable, PRIORITY_NAKED);
                }
                return;
            }
            // A single naked type parameter, and every inference completed: it is inferred from the
            // sources that nothing was inferred from.
            if type_variable_count == 1 && !circularity {
                let unmatched: Parts = sources
                    .iter()
                    .zip(&matched)
                    .filter(|(_, m)| !**m)
                    .map(|(&s, _)| s)
                    .collect();
                if !unmatched.is_empty() {
                    let rest = self.union(&unmatched);
                    self.infer_types(n, rest, naked);
                    return;
                }
            }
        } else {
            for &t in targets {
                if n.index_of(t).is_some() {
                    type_variable_count += 1;
                } else {
                    self.infer_types(n, source, t);
                }
            }
        }
        // To a naked type parameter last, at a lower priority: from `Promise<string>` to `T |
        // Promise<T>` the desired inference for `T` is `string`. In an intersection, only if there
        // is exactly one.
        if if kind == Multiple::Intersection {
            type_variable_count == 1
        } else {
            type_variable_count > 0
        } {
            for &t in targets {
                if n.index_of(t).is_some() {
                    self.infer_with_priority(n, source, t, PRIORITY_NAKED);
                }
            }
        }
    }

    /// What `infer_to_conditional_type` infers to, from a source that is not a conditional type,
    /// in that order: the branches of `target`, without those parts from which `infer_types`
    /// returns at once. `None`: `target` is not a conditional type.
    fn generic_parts_of_branches(&mut self, target: TypeId) -> Option<SmallVec<[TypeId; 2]>> {
        if !matches!(self.data(target), TypeData::Cond { .. }) {
            return None;
        }
        let mut generic: SmallVec<[TypeId; 2]> = SmallVec::new();
        for branch in [self.cond_true(target), self.cond_false(target)] {
            if !self.could_contain_type_variables(branch) {
                continue;
            }
            // `infer_types` goes on to each part of such an intersection, and none is a naked
            // type parameter.
            let parts: Parts = match self.data(branch) {
                TypeData::Intersection(parts) => SmallVec::from_slice(parts),
                _ => SmallVec::new(),
            };
            if !parts.is_empty()
                && self.alias_symbol_of_type(branch).is_none()
                && !self.is_no_infer(branch)
                && (parts.iter())
                    .all(|&t| self.is_object_type(t) && !self.is_generic_mapped_type(t))
            {
                generic.extend(
                    parts
                        .into_iter()
                        .filter(|&t| self.could_contain_type_variables(t)),
                );
            } else {
                generic.push(branch);
            }
        }
        Some(generic)
    }

    /// `inferToConditionalType`
    fn infer_to_conditional_type(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        if matches!(self.data(source), TypeData::Cond { .. }) {
            for which in 0..4 {
                let (s, t) = (
                    self.cond_piece(source, which),
                    self.cond_piece(target, which),
                );
                self.infer_types(n, s, t);
            }
            return;
        }
        let targets = [self.cond_true(target), self.cond_false(target)];
        let saved = n.priority;
        if n.contra {
            n.priority |= PRIORITY_CONTRAVARIANT_CONDITIONAL;
        }
        self.infer_to_multiple_types(n, source, None, &targets, Multiple::Branches);
        n.priority = saved;
    }

    /// `inferToTemplateLiteralType`
    fn infer_to_template_literal_type(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        texts: &[Atom],
        types: &[TypeId],
    ) {
        let matches = self.infer_types_from_template_literal_type(source, texts, types);
        // Only placeholders, and no match: `never` for each, so that the result matches nothing.
        // Their constraint, `string`, would match.
        if matches.is_none() && !texts.iter().all(|&t| self.atoms().bytes(t).is_empty()) {
            return;
        }
        for (i, &target) in types.iter().enumerate() {
            let source = matches.as_ref().map_or(TypeId::NEVER, |m| m[i]);
            // A substring inferred for a type parameter constrained to, for example, `number`: the
            // number it spells.
            if let Some(value) = self.string_literal_value(source)
                && let Some(index) = n.index_of(target)
                && let Some(constraint) = self.base_constraint_of(n.params[index])
                && !self.is_any(constraint)
                && let Some(matching_type) = self.literal_matching_text(value, source, constraint)
            {
                self.infer_types(n, matching_type, target);
                continue;
            }
            self.infer_types(n, source, target);
        }
    }

    /// `matchingType` of `inferToTemplateLiteralType`: the member of `constraint` that best
    /// represents `source`, a string literal type with the text `value`. `None`: `never`.
    fn literal_matching_text(
        &mut self,
        value: Atom,
        source: TypeId,
        constraint: TypeId,
    ) -> Option<TypeId> {
        let mut all_type_flags = (self.parts(constraint).iter())
            .fold(0, |all_type_flags, &t| all_type_flags | self.flags(t));
        // Nothing is preferred to `string`.
        if all_type_flags & tf::STRING != 0 {
            return None;
        }
        let text = self.atoms().bytes(value);
        let number = super::relate::number_from_string(text);
        // `isValidNumberString(text, roundTripOnly)`. An enum member keeps `TypeFlagsEnumLiteral`.
        if all_type_flags & tf::NUMBER_LIKE != 0
            && (text.is_empty() || !number.is_finite() || self.number_name(number) != value)
        {
            all_type_flags &= !tf::NUMBER_LIKE;
        }
        // `isValidBigIntString(text, roundTripOnly)`: exactly what a bigint prints as.
        let negative = text.starts_with(b"-");
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        let is_bigint = !digits.is_empty()
            && digits.iter().all(|b| b.is_ascii_digit())
            && if digits == b"0" {
                !negative
            } else {
                !digits.starts_with(b"0")
            };
        if !is_bigint {
            all_type_flags &= !tf::BIGINT_LIKE;
        }
        let choose = |c: &mut Self, left: TypeId, right: TypeId| -> TypeId {
            let (left_flags, right_flags) = (c.flags(left), c.flags(right));
            if right_flags & all_type_flags == 0 || left_flags & tf::STRING != 0 {
                return left;
            }
            if right_flags & tf::STRING != 0 {
                return source;
            }
            if left_flags & tf::TEMPLATE_LITERAL != 0 {
                return left;
            }
            if let TypeData::Template { texts, types } = c.data(right)
                && c.is_type_matched_by_template_literal_type(
                    source,
                    texts,
                    types,
                    &mut |c, s, t| c.is_assignable(s, t),
                )
            {
                return source;
            }
            if left_flags & tf::STRING_MAPPING != 0 {
                return left;
            }
            if let TypeData::StringMapping { kind, .. } = *c.data(right)
                && c.string_mapping(kind, source) == source
            {
                return source;
            }
            if left_flags & tf::STRING_LITERAL != 0 {
                return left;
            }
            if c.string_literal_value(right) == Some(value) {
                return right;
            }
            if left_flags & tf::NUMBER != 0 {
                return left;
            }
            if right_flags & tf::NUMBER != 0 {
                return c.number_literal(number, false);
            }
            if left_flags & tf::ENUM != 0 {
                return left;
            }
            if right_flags & tf::ENUM != 0 {
                return c.number_literal(number, false);
            }
            if left_flags & tf::NUMBER_LITERAL != 0 {
                return left;
            }
            if let TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } = *c.data(right)
                && f64::from_bits(bits) == number
            {
                return right;
            }
            if left_flags & tf::BIGINT != 0 {
                return left;
            }
            // `parseBigIntLiteralType`
            if right_flags & tf::BIGINT != 0 {
                let written = c.atoms().intern(digits);
                return c.intern(TypeData::BigIntLit {
                    text: written,
                    negative,
                    fresh: false,
                });
            }
            if left_flags & tf::BIGINT_LITERAL != 0 {
                return left;
            }
            if let TypeData::BigIntLit {
                text: written,
                negative: minus,
                ..
            } = *c.data(right)
                && minus == negative
                && c.atoms().bytes(written) == digits
            {
                return right;
            }
            if left_flags & tf::BOOLEAN != 0 {
                return left;
            }
            if right_flags & tf::BOOLEAN != 0 {
                return match text {
                    b"true" => TypeId::TRUE,
                    b"false" => TypeId::FALSE,
                    _ => TypeId::BOOLEAN,
                };
            }
            if left_flags & tf::BOOLEAN_LITERAL != 0 {
                return left;
            }
            if let TypeData::BoolLit { value: is_true, .. } = *c.data(right) {
                let name: &[u8] = if is_true { b"true" } else { b"false" };
                if text == name {
                    return right;
                }
            }
            if left_flags & tf::UNDEFINED != 0 {
                return left;
            }
            if right_flags & tf::UNDEFINED != 0 && text == b"undefined" {
                return right;
            }
            if left_flags & tf::NULL != 0 {
                return left;
            }
            if right_flags & tf::NULL != 0 && text == b"null" {
                return right;
            }
            left
        };
        let mut matching_type = TypeId::NEVER;
        for &t in self.parts(constraint) {
            matching_type = choose(self, matching_type, t);
        }
        (!matching_type.is_never()).then_some(matching_type)
    }

    /// `inferFromGenericMappedTypes`: `{ [P in S]: X }` and `{ [P in T]: Y }`: from `S` to `T` and from `X` to `Y`.
    fn infer_from_generic_mapped_types(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
    ) {
        let (s, t) = (self.mapped_keys(source), self.mapped_keys(target));
        self.infer_types(n, s, t);
        let (s, t) = (self.mapped_template(source), self.mapped_template(target));
        self.infer_types(n, s, t);
        if let (Some(s), Some(t)) = (self.mapped_name_type(source), self.mapped_name_type(target)) {
            self.infer_types(n, s, t);
        }
    }

    /// `createEmptyObjectTypeFromStringLiteral`: an object type with the named properties, each of
    /// type `any`.
    fn empty_object_type_from_string_literal(&mut self, ty: TypeId) -> TypeId {
        let mut shape = Shape::new_in(self.arena);
        // `members[name] = literalProp`: a string enum member can have the value of a member of
        // another enum or of a string literal. The last one replaces the others.
        let mut index_of_name = crate::util::FxHashMap::default();
        for t in self.sorted_parts(ty) {
            let Some(value) = self.string_literal_value(t) else {
                continue;
            };
            // `literalProp.Declarations = t.symbol.Declarations`: `getLiteralTypeFromProperty` reads
            // the name of an enum member in its declaration. Without one the name is a string.
            let (flags, source) = match *self.data(t) {
                TypeData::EnumLit { member, .. } => {
                    let declared = Prop {
                        name: self.files().symbol(member).name,
                        flags: PropFlags::empty(),
                        source: PropSource::Symbol(member),
                        mapper: MapperId::IDENTITY,
                    };
                    let source = Self::copy_of(TypeId::ANY, &[&declared], true, self.arena);
                    (PropFlags::empty(), source)
                }
                _ => (PropFlags::STRING_NAME, PropSource::Type(TypeId::ANY)),
            };
            let literal_prop = Prop {
                name: value,
                flags,
                source,
                mapper: MapperId::IDENTITY,
            };
            if let Some(&earlier) = index_of_name.get(&value) {
                shape.props[earlier] = literal_prop;
            } else {
                index_of_name.insert(value, shape.props.len());
                shape.props.push(literal_prop);
            }
        }
        self.get_named_members(&mut shape.props, |_| true, &[]);
        if ty == TypeId::STRING {
            shape
                .index
                .push(IndexInfo::new(TypeId::STRING, TypeId::EMPTY_OBJECT, false));
        }
        shape.literal = Literalness::OfLiteralKeyof;
        self.synth(shape)
    }

    // ───────────────────────────── objects ─────────────────────────────

    /// `inferFromObjectTypes`
    fn infer_from_object_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        if let (TypeData::Ref { target: st, .. }, TypeData::Ref { target: tt, .. }) =
            (self.data(source), self.data(target))
            && (st == tt || self.is_array(source) && self.is_array(target))
        {
            let (sa, ta) = (self.type_arguments(source), self.type_arguments(target));
            self.infer_from_type_arguments_of(n, *st, sa, ta);
            return;
        }
        // Tuples of the same shape are also references to the same generic type.
        if let (
            TypeData::Tuple {
                flags: sf,
                readonly: sr,
                ..
            },
            TypeData::Tuple {
                flags: tf,
                readonly: tr,
                ..
            },
        ) = (self.data(source), self.data(target))
            && sf == tf
            && sr == tr
        {
            let (se, te) = (self.type_arguments(source), self.type_arguments(target));
            self.infer_from_type_arguments(n, se, te, &[]);
            return;
        }
        if self.is_generic_mapped_type(source) && self.is_generic_mapped_type(target) {
            self.infer_from_generic_mapped_types(n, source, target);
        }
        if matches!(
            self.data(target),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            }
        ) && self.mapped_name_type(target).is_none()
        {
            let constraint = self.mapped_keys(target);
            if self.infer_to_mapped_type(n, source, target, constraint) {
                return;
            }
        }
        // FOR SPEED: a target that is no object type has no properties to infer to
        // (`getPropertiesOfObjectType`), and the signatures and index signatures are those of its
        // constraint. Without type variables in that, `inferFromTypes` returns at once for each,
        // whatever `typesDefinitelyUnrelated` answers, and that lists every property of the 509
        // tuples that `Commands[Method]["paramsType"]` of devtools-protocol is constrained to.
        if !self.is_object_type(target) {
            let apparent = self.reduced_apparent_type(target);
            if !self.has_type_variables(apparent) {
                return;
            }
        }
        // Only if the two types may be related.
        if self.types_definitely_unrelated(source, target) {
            return;
        }
        if self.is_array_or_tuple(source) {
            if let TypeData::Tuple { flags, .. } = self.data(target) {
                let elems = self.type_arguments(target);
                self.infer_to_tuple(n, source, elems, flags);
                return;
            }
            if self.is_array(target) {
                self.infer_from_index_types(n, source, target);
                return;
            }
        }
        self.infer_from_properties(n, source, target);
        self.infer_from_signatures(n, source, target, false);
        self.infer_from_signatures(n, source, target, true);
        self.infer_from_index_types(n, source, target);
    }

    /// The part of `inferFromObjectTypes` for an array or a tuple against a tuple.
    fn infer_to_tuple(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        element_types: &[TypeId],
        element_flags: &[ElemFlags],
    ) {
        let variable = ElemFlags::REST | ElemFlags::VARIADIC;
        let one_element;
        let (source_elems, source_flags, source_is_tuple): (&[TypeId], &[ElemFlags], bool) =
            match self.data(source) {
                TypeData::Tuple { flags, .. } => (self.type_arguments(source), flags, true),
                _ => {
                    one_element = [self.array_element(source).unwrap_or(TypeId::ANY)];
                    (&one_element, &[ElemFlags::REST], false)
                }
            };
        let (source_arity, target_arity) = (source_elems.len(), element_types.len());
        // The same structure: element by element.
        if source_is_tuple
            && source_arity == target_arity
            && source_flags.iter().zip(element_flags).all(|(s, t)| {
                (*s & variable).is_empty() == (*t & variable).is_empty()
                    && *s & variable == *t & variable
            })
        {
            for i in 0..target_arity {
                self.infer_types(n, source_elems[i], element_types[i]);
            }
            return;
        }
        let fixed_length = |flags: &[ElemFlags]| Self::fixed_length(flags);
        let end_fixed_count = |flags: &[ElemFlags]| {
            flags
                .iter()
                .rev()
                .position(|f| f.intersects(variable))
                .unwrap_or(flags.len())
        };
        let (mut start_length, mut end_length) = (0, 0);
        if source_is_tuple {
            start_length = fixed_length(source_flags).min(fixed_length(element_flags));
            if element_flags.iter().any(|f| f.intersects(variable)) {
                end_length = end_fixed_count(source_flags).min(end_fixed_count(element_flags));
            }
        }
        for i in 0..start_length {
            self.infer_types(n, source_elems[i], element_types[i]);
        }
        if !source_is_tuple
            || source_arity.checked_sub(start_length + end_length) == Some(1)
                && source_flags[start_length].contains(ElemFlags::REST)
        {
            // One rest element is left in the source: from it to every element of the target.
            let rest = source_elems[start_length];
            for i in start_length..target_arity.saturating_sub(end_length) {
                let t = if element_flags[i].contains(ElemFlags::VARIADIC) {
                    self.array_of(rest)
                } else {
                    rest
                };
                self.infer_types(n, t, element_types[i]);
            }
        } else {
            let middle_length = target_arity.saturating_sub(start_length + end_length);
            let fixed_tuple_constraint =
                |c: &mut Self, n: &Inference, t: TypeId| -> Option<usize> {
                    let index = n.index_of(t)?;
                    let constraint = c.base_constraint_of(n.params[index])?;
                    match c.data(constraint) {
                        TypeData::Tuple { flags, .. }
                            if !flags.iter().any(|f| f.intersects(variable)) =>
                        {
                            Some(flags.len())
                        }
                        _ => None,
                    }
                };
            if middle_length == 2 {
                let (a, b) = (element_flags[start_length], element_flags[start_length + 1]);
                if a.contains(ElemFlags::VARIADIC) && b.contains(ElemFlags::VARIADIC) {
                    // `[...T, ...U]`: `T` takes as many source elements as there are arguments for
                    // it.
                    if let Some(implied_arity) = n
                        .index_of(element_types[start_length])
                        .and_then(|i| n.candidates[i].implied_arity)
                    {
                        let skipped = (end_length + source_arity).saturating_sub(implied_arity);
                        let first =
                            self.slice_tuple(source_elems, source_flags, start_length, skipped);
                        self.infer_types(n, first, element_types[start_length]);
                        let second = self.slice_tuple(
                            source_elems,
                            source_flags,
                            start_length + implied_arity,
                            end_length,
                        );
                        self.infer_types(n, second, element_types[start_length + 1]);
                    }
                } else if a.contains(ElemFlags::VARIADIC) && b.contains(ElemFlags::REST) {
                    // `[...T, ...rest]`: if the constraint of `T` is a fixed-size tuple, `T` takes
                    // that many source elements.
                    if let Some(implied_arity) =
                        fixed_tuple_constraint(self, n, element_types[start_length])
                    {
                        let slice = self.slice_tuple(
                            source_elems,
                            source_flags,
                            start_length,
                            source_arity.saturating_sub(start_length + implied_arity),
                        );
                        self.infer_types(n, slice, element_types[start_length]);
                        if let Some(rest) = self.element_type_of_slice(
                            source_elems,
                            source_flags,
                            start_length + implied_arity,
                            end_length,
                            false,
                        ) {
                            self.infer_types(n, rest, element_types[start_length + 1]);
                        }
                    }
                } else if a.contains(ElemFlags::REST) && b.contains(ElemFlags::VARIADIC) {
                    // `[...rest, ...T]`
                    if let Some(implied_arity) =
                        fixed_tuple_constraint(self, n, element_types[start_length + 1])
                    {
                        let end_index =
                            source_arity - end_fixed_count(element_flags).min(source_arity);
                        if let Some(start_index) = end_index
                            .checked_sub(implied_arity)
                            .filter(|&s| s >= start_length)
                        {
                            let trailing = self.tuple(
                                &source_elems[start_index..end_index],
                                &source_flags[start_index..end_index],
                                false,
                            );
                            if let Some(rest) = self.element_type_of_slice(
                                source_elems,
                                source_flags,
                                start_length,
                                end_length + implied_arity,
                                false,
                            ) {
                                self.infer_types(n, rest, element_types[start_length]);
                            }
                            self.infer_types(n, trailing, element_types[start_length + 1]);
                        }
                    }
                }
            } else if middle_length == 1
                && element_flags[start_length].contains(ElemFlags::VARIADIC)
            {
                // One variadic element: the source elements between the fixed parts. Speculative if
                // the target ends in optional elements.
                let priority = if element_flags[target_arity - 1].contains(ElemFlags::OPTIONAL) {
                    PRIORITY_SPECULATIVE_TUPLE
                } else {
                    0
                };
                let slice = self.slice_tuple(source_elems, source_flags, start_length, end_length);
                self.infer_with_priority(n, slice, element_types[start_length], priority);
            } else if middle_length == 1
                && element_flags[start_length].contains(ElemFlags::REST)
                && let Some(rest) = self.element_type_of_slice(
                    source_elems,
                    source_flags,
                    start_length,
                    end_length,
                    false,
                )
            {
                self.infer_types(n, rest, element_types[start_length]);
            }
        }
        for i in 0..end_length {
            self.infer_types(
                n,
                source_elems[source_arity - i - 1],
                element_types[target_arity - i - 1],
            );
        }
    }

    /// `sliceTupleType`
    pub(super) fn slice_tuple(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        index: usize,
        end_skip_count: usize,
    ) -> TypeId {
        let end = elems.len().saturating_sub(end_skip_count);
        let fixed = Self::fixed_length(flags);
        if index > fixed {
            // `getRestArrayTypeOfTupleType`: an array of all the element types from the first
            // non-fixed element on.
            return match self.element_type_of_slice(elems, flags, fixed, 0, false) {
                Some(rest) => self.array_of(rest),
                None => self.tuple(&[], &[], false),
            };
        }
        if index >= end {
            return self.tuple(&[], &[], false);
        }
        self.normalized_tuple(&elems[index..end], &flags[index..end], false)
    }

    /// `getElementTypeOfSliceOfTupleType`, for reading
    pub(super) fn element_type_of_slice(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        index: usize,
        end_skip_count: usize,
        no_reductions: bool,
    ) -> Option<TypeId> {
        let length = elems.len().saturating_sub(end_skip_count);
        if index >= length {
            return None;
        }
        let types: Parts = (index..length)
            .map(|i| {
                if flags[i].contains(ElemFlags::VARIADIC) {
                    self.indexed_access(elems[i], TypeId::NUMBER)
                } else {
                    elems[i]
                }
            })
            .collect();
        Some(if no_reductions {
            self.union_unreduced(&types)
        } else {
            self.union(&types)
        })
    }

    /// `typesDefinitelyUnrelated`
    pub(super) fn types_definitely_unrelated(&mut self, source: TypeId, target: TypeId) -> bool {
        if let (TypeData::Tuple { flags: s, .. }, TypeData::Tuple { flags: t, .. }) =
            (self.data(source), self.data(target))
        {
            let variable = ElemFlags::REST | ElemFlags::VARIADIC;
            let min_length = |f: &[ElemFlags]| {
                f.iter()
                    .filter(|f| f.intersects(ElemFlags::REQUIRED | ElemFlags::VARIADIC))
                    .count()
            };
            let fixed_length = |f: &[ElemFlags]| Self::fixed_length(f);
            let has = |f: &[ElemFlags], which: ElemFlags| f.iter().any(|f| f.intersects(which));
            return !has(t, ElemFlags::VARIADIC) && min_length(t) > min_length(s)
                || !has(t, variable) && (has(s, variable) || fixed_length(t) < fixed_length(s));
        }
        // Each has a property the other lacks.
        self.has_unmatched_property(source, target, true)
            && self.has_unmatched_property(target, source, false)
    }

    /// `getUnmatchedProperty(source, target, false, matchDiscriminantProperties) != nil`
    fn has_unmatched_property(
        &mut self,
        source: TypeId,
        target: TypeId,
        match_discriminant_properties: bool,
    ) -> bool {
        // `getPropertyOfType(source, name)` makes the properties of a union one by one, as they are
        // asked for.
        let source = self.reduced_apparent_type(source);
        let sm = match self.is_union(source) {
            true => None,
            false => self.members(source),
        };
        let Some(tm) = self.members_of_reduced_apparent_type(target) else {
            return false;
        };
        (tm.shape().props.iter()).any(|tp| {
            let of_target = (tp, tm.mapper);
            self.is_unmatched_property(
                source,
                sm.as_ref(),
                of_target,
                match_discriminant_properties,
            )
        })
    }

    /// The body of the loop of `getUnmatchedPropertiesWorker`, without `requireOptionalProperties`.
    fn is_unmatched_property(
        &mut self,
        source: TypeId,
        source_members: Option<&Members<'p>>,
        (tp, target_mapper): (&Prop<'p>, MapperId),
        match_discriminant_properties: bool,
    ) -> bool {
        let partial = PropFlags::READ_PARTIAL | PropFlags::WRITE_PARTIAL;
        if self.is_static_private_name(tp) || tp.flags.intersects(PropFlags::OPTIONAL | partial) {
            return false;
        }
        let source_prop = match source_members {
            Some(members) => self.property_in_type(source, members, tp.name),
            None => self.get_property_of_type(source, tp.name),
        };
        let Some((sp, source_mapper)) = source_prop else {
            return true;
        };
        if !match_discriminant_properties {
            return false;
        }
        let expected = self.type_of_prop(tp, target_mapper);
        if !self.is_unit(expected) {
            return false;
        }
        let actual = self.type_of_prop(sp, source_mapper);
        !(self.is_any(actual)
            || self.with_freshness(actual, false) == self.with_freshness(expected, false))
    }

    /// `resolveStructuredTypeMembers(getReducedApparentType(ty))`: where `getPropertiesOfType`,
    /// `getPropertyOfType` and `getIndexInfosOfType` look.
    fn members_of_reduced_apparent_type(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let apparent = self.reduced_apparent_type_as_object(ty);
        self.members(apparent)
    }

    /// `isTypeOrBaseIdenticalTo`
    fn is_type_or_base_identical_to(&mut self, s: TypeId, t: TypeId) -> bool {
        if t == TypeId::MISSING {
            return s == t;
        }
        self.is_identical(s, t)
            || self.flags(t) & tf::STRING != 0 && self.flags(s) & tf::STRING_LITERAL != 0
            || self.flags(t) & tf::NUMBER != 0 && self.flags(s) & tf::NUMBER_LITERAL != 0
    }

    /// `isTypeCloselyMatchedBy`
    fn is_type_closely_matched_by(&mut self, s: TypeId, t: TypeId) -> bool {
        self.is_object_type(s)
            && self.is_object_type(t)
            && self
                .symbol_of_type(s)
                .is_some_and(|symbol| self.symbol_of_type(t) == Some(symbol))
            || self
                .same_alias(s, t)
                .is_some_and(|(.., has_type_arguments)| has_type_arguments)
    }

    /// `inferFromProperties`
    fn infer_from_properties(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        // `getPropertiesOfObjectType`
        if !self.is_object_type(target) {
            return;
        }
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return;
        };
        let mut inherited = self.inherited_of(sm.shape());
        for tp in &tm.shape().props {
            // `getPropertyOfType(source, targetProp.Name)` comes before either `getTypeOfSymbol`: a
            // target property that the source lacks may be the one whose type is being resolved.
            let Some((sp, source_mapper)) =
                self.property_among(source, &sm, &mut inherited, tp.name)
            else {
                continue;
            };
            let actual = self.type_of_prop_as_read(sp, source_mapper);
            let expected = self.type_of_prop_as_read(tp, tm.mapper);
            self.infer_types(n, actual, expected);
        }
    }

    /// `inferFromSignatures`
    fn infer_from_signatures(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        construct: bool,
    ) {
        // FOR SPEED: few object types have signatures, and `signatures` stores a list for every
        // type it is asked for.
        if self.is_object_type(source)
            && self.members(source).is_some_and(|members| {
                let shape = members.shape();
                if construct {
                    shape.construct.is_empty()
                } else {
                    shape.call.is_empty()
                }
            })
        {
            return;
        }
        let source_signatures = self.signatures(source, construct);
        let source_len = source_signatures.len();
        if source_len == 0 {
            return;
        }
        // `returnOnlyType`: a context sensitive function, retained only for its return type.
        let return_only = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::Partial);
        // From the last signature to the first. If the source has fewer, its first signature is
        // paired with the remaining target signatures.
        let target_signatures = self.signatures(target, construct);
        for (i, &t) in target_signatures.iter().enumerate() {
            let source_index = (source_len + i).saturating_sub(target_signatures.len());
            self.infer_from_signature(n, source_signatures[source_index], t, return_only);
        }
    }

    /// `instantiate_sig(sig, mapper)`, where `sig` is the only call (or construct) signature among
    /// the members of `ty` and `mapper` is their mapper. `signatures` caches it for an object type
    /// that is inspected as is.
    pub(super) fn instantiate_only_sig(
        &mut self,
        ty: TypeId,
        construct: bool,
        sig: SigId,
        mapper: MapperId,
    ) -> SigId {
        if mapper == MapperId::IDENTITY {
            return sig;
        }
        let stands = match self.data(ty) {
            TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
            _ => self.is_object_type(ty),
        };
        if stands {
            let kept = self.signatures(ty, construct);
            if let [only] = kept[..] {
                return only;
            }
        }
        self.instantiate_sig(sig, mapper)
    }

    /// The core of `instantiateTypeWithSingleGenericCallSignature`. `generic` is passed where
    /// `contextual`, which is not generic, is expected, by a function that returns a function. If
    /// it contributes new inferences for the type parameters being inferred, they are expressed in
    /// its own type parameters, which then become those of the returned function.
    pub(super) fn adopt_generic_argument(
        &mut self,
        n: &mut Inference,
        generic: SigId,
        contextual: SigId,
    ) -> bool {
        let has_candidates = |c: &Candidate| !c.covariant.is_empty() || !c.contravariant.is_empty();
        if n.candidates.iter().all(has_candidates) {
            return false;
        }
        let mut scratch = Inference::for_params(&n.params, n.sig);
        for (s, t) in self.parameter_type_pairs(generic, contextual) {
            self.infer_ex(&mut scratch, s, t, 0, true);
        }
        if !scratch.candidates.iter().any(has_candidates) {
            return false;
        }
        if let Some(ReturnTypePair { s, t }) = self.return_type_pair(generic, contextual) {
            self.infer(&mut scratch, s, t, 0);
        }
        // `hasOverlappingInferences`
        if n.candidates
            .iter()
            .zip(&scratch.candidates)
            .any(|(a, b)| has_candidates(a) && has_candidates(b))
        {
            return false;
        }
        // `mergeInferences`
        for (target, source) in n.candidates.iter_mut().zip(scratch.candidates) {
            if has_candidates(&source) {
                *target = source;
            }
        }
        true
    }

    /// `inferFromSignature(getBaseSignature(source), getErasedSignature(target))`. `return_only`: `SignatureFlagsIsNonInferrable`
    fn infer_from_signature(
        &mut self,
        n: &mut Inference,
        source: SigId,
        target: SigId,
        return_only: bool,
    ) {
        let source = self.base_sig(source);
        let declared = self.declared_sig(target);
        let is_method = match self.sig_decl(declared) {
            Some((file, func, _)) => matches!(
                self.hir(file)[func].kind,
                FnKind::Method | FnKind::Constructor
            ),
            None => false,
        };
        // The target's own type parameters are irrelevant. They may be the very declarations that
        // are being inferred: the members of the return type of `flat` include `flat`.
        let target = self.erased_sig(target);
        if !return_only {
            // Once a bivariant signature has been crossed, everything nested in it is bivariant.
            let saved_bivariant = n.bivariant;
            n.bivariant |= is_method;
            let strict = self.p.files.options.strict_function_types
                || n.priority & PRIORITY_ALWAYS_STRICT != 0;
            for (s, t) in self.parameter_type_pairs(source, target) {
                if strict {
                    self.infer_from_contravariant_types(n, s, t)
                } else {
                    self.infer_types(n, s, t)
                }
            }
            n.bivariant = saved_bivariant;
        }
        if let Some(ReturnTypePair { s, t }) = self.return_type_pair(source, target) {
            self.infer_types(n, s, t);
        }
    }

    /// `applyToParameterTypes`: the pairs it visits.
    pub(super) fn parameter_type_pairs(
        &mut self,
        source: SigId,
        target: SigId,
    ) -> SmallVec<[(TypeId, TypeId); 8]> {
        let tp = self.sig_params(target);
        // `getTypeAtPosition(source, i)`, and `getRestTypeAtPosition(source, ..)` for all remaining
        // positions.
        let requested = match tp.last() {
            Some(last) if last.rest => usize::MAX,
            _ => tp.len(),
        };
        // `getParameterCount(source)`, then `getThisTypeOfSignature`, then `getTypeAtPosition`.
        self.request_type_of_rest_parameter(source);
        let this_types = self
            .sig_this_type(source)
            .and_then(|s| self.sig_this_type(target).map(|t| (s, t)));
        let sp = self.sig_params_up_to(source, requested);
        let (source_count, target_count) = (self.parameter_count(&sp), self.parameter_count(&tp));
        let (source_rest, target_rest) =
            (self.effective_rest_type(&sp), self.effective_rest_type(&tp));
        let target_non_rest_count = if target_rest.is_some() {
            target_count - 1
        } else {
            target_count
        };
        let param_count = if source_rest.is_some() {
            target_non_rest_count
        } else {
            source_count.min(target_non_rest_count)
        };
        // `getTypeAtPosition(target, i)`
        self.note_parameter_types_resolved(target, &tp, param_count);
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::with_capacity(param_count + 2);
        pairs.extend(this_types);
        for i in 0..param_count {
            let (s, t) = (
                self.param_type_at(&sp, i).unwrap_or(TypeId::ANY),
                self.param_type_at(&tp, i).unwrap_or(TypeId::ANY),
            );
            pairs.push((s, t));
        }
        if let Some(target_rest) = target_rest {
            // For a `const` type parameter whose constraint does not require a mutable array, the
            // rest type is readonly.
            let readonly = self.is_const_type_variable(target_rest, 0)
                && !self
                    .parts(target_rest)
                    .iter()
                    .any(|&m| self.is_mutable_array_like(m));
            pairs.push((
                self.rest_type_at_position(&sp, param_count, readonly),
                target_rest,
            ));
        }
        pairs
    }

    /// `isMutableArrayLikeType`
    fn is_mutable_array_like(&mut self, ty: TypeId) -> bool {
        if self.is_mutable_array_or_tuple(ty) {
            return true;
        }
        if self.is_any(ty) || ty.is_undefined() || ty.is_null() {
            return false;
        }
        let any_array = self.array_of(TypeId::ANY);
        self.is_assignable(ty, any_array)
    }

    /// `applyToReturnTypes`: the pair it visits, if any. The type predicate or return type of the
    /// source is resolved only if needed.
    fn return_type_pair(&mut self, source: SigId, target: SigId) -> Option<ReturnTypePair> {
        if let Some(t) = self.sig_predicate(target)
            && let Some(s) = self.sig_predicate(source)
            // `typePredicateKindsMatch`
            && (t.asserts, t.param) == (s.asserts, s.param)
            && let (Some(s), Some(t)) = (s.ty, t.ty)
        {
            return Some(ReturnTypePair { s, t });
        }
        // A `NoInfer<T>` in the declaration is preserved.
        let t = self.sig_return(target);
        if !self.could_contain_type_variables(t) {
            return None;
        }
        let s = self.sig_return(source);
        Some(ReturnTypePair { s, t })
    }

    /// `inferFromIndexTypes`
    fn infer_from_index_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        let (Some(sm), Some(tm)) = (
            self.members(source),
            self.members_of_reduced_apparent_type(target),
        ) else {
            return;
        };
        if tm.shape().index.is_empty() {
            return;
        }
        let is_mapped = |c: &Self, t: TypeId| {
            matches!(
                c.data(t),
                TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                }
            )
        };
        let priority = if is_mapped(self, source) && is_mapped(self, target) {
            PRIORITY_HOMOMORPHIC
        } else {
            0
        };
        // A type known to have exactly its visible properties has an implicit index signature.
        // `inferFromTypes` has replaced the source with `getApparentType(source)`, unless the
        // constraints of type parameters are to be ignored.
        let looks = if n.priority & PRIORITY_NO_CONSTRAINTS != 0 {
            source
        } else {
            self.apparent_type_of_intersection(source)
        };
        if self.is_object_type_with_inferable_index(looks) {
            for info in &tm.shape().index {
                let expected = self.instantiate(info.value, tm.mapper);
                let mut types = Parts::new();
                for prop in &sm.shape().props {
                    if self.is_property_applicable_to_index(source, prop, info.key) {
                        // The type of the property when it is present.
                        let ty = self.type_of_prop(prop, sm.mapper);
                        types.push(if prop.flags.contains(PropFlags::OPTIONAL) {
                            self.remove_missing_or_undefined_type(ty)
                        } else {
                            ty
                        });
                    }
                }
                for other in &sm.shape().index {
                    if other.key == info.key || self.is_applicable_index_type(other.key, info.key) {
                        types.push(self.instantiate(other.value, sm.mapper));
                    }
                }
                if !types.is_empty() {
                    let all = self.union(&types);
                    self.infer_with_priority(n, all, expected, priority);
                }
            }
        }
        for info in &tm.shape().index {
            if let Some(source_info) = self.applicable_index_info(&sm, info.key) {
                let expected = self.instantiate(info.value, tm.mapper);
                self.infer_with_priority(n, source_info.value, expected, priority);
            }
        }
    }

    // ───────────────────────────── mapped types ─────────────────────────────

    /// `inferToMappedType`. `true`: dealt with.
    fn infer_to_mapped_type(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        constraint: TypeId,
    ) -> bool {
        match *self.data(constraint) {
            TypeData::Union(_) | TypeData::Intersection(_) => {
                let parts = match self.data(constraint) {
                    TypeData::Intersection(parts) => Parts::from_slice(parts),
                    _ => self.sorted_parts(constraint),
                };
                let mut result = false;
                for t in parts {
                    result |= self.infer_to_mapped_type(n, source, target, t);
                }
                result
            }
            TypeData::Keyof(of) => {
                // `{ [P in keyof T]: X }`: reverse the mapping to recover the type it was mapped
                // from, and infer from that to `T`, at a lower priority than a direct inference to
                // `T`, and lower still if it is only partial.
                if let Some(index) = n.index_of(of)
                    && n.candidates[index].fixed.is_none()
                    && let Some(inferred) = self.reverse_mapped_type(source, target, of)
                {
                    let priority = if self.is_non_inferrable(source) {
                        PRIORITY_PARTIAL_HOMOMORPHIC
                    } else {
                        PRIORITY_HOMOMORPHIC
                    };
                    self.infer_with_priority(n, inferred, of, priority);
                }
                true
            }
            TypeData::TypeParam(..) => {
                // `{ [P in K]: X }`: `K` is the keys of the source.
                let keys = match self.data(source) {
                    // `patternForType`, `IndexFlagsNoIndexSignatures`: the `...rest` of a pattern
                    // is not a key.
                    TypeData::Synth(shape) if shape.literal.is_of_pattern() => {
                        let mut keys = Vec::with_capacity(shape.props.len());
                        for prop in &shape.props {
                            keys.extend(self.key_type_of_name(prop.name));
                        }
                        keys.extend(
                            shape
                                .index
                                .iter()
                                .map(|i| i.key)
                                .filter(|&key| key == TypeId::NUMBER || key == TypeId::SYMBOL),
                        );
                        self.union(&keys)
                    }
                    _ => self.keyof(source),
                };
                self.infer_with_priority(n, keys, constraint, PRIORITY_MAPPED_CONSTRAINT);
                // With `K extends keyof T`, as for `{ [P in keyof T]: X }`. That is `Pick<T, K>`.
                if let Some(extended) = self.constraint_of(constraint)
                    && self.infer_to_mapped_type(n, source, target, extended)
                {
                    return true;
                }
                // `X` is the type of the properties of the source.
                let Some(sm) = self.members(source) else {
                    return true;
                };
                let mut types: Vec<TypeId> = sm
                    .shape()
                    .props
                    .iter()
                    .map(|p| self.type_of_prop_with_missing(p, sm.mapper))
                    .collect();
                // `enumNumberIndexInfo`, the only index signature of an enum object, contributes nothing.
                if !matches!(
                    self.data(source),
                    TypeData::Anon {
                        origin: Origin::EnumObject(_),
                        ..
                    }
                ) {
                    types.extend(
                        sm.shape()
                            .index
                            .iter()
                            .map(|i| self.instantiate(i.value, sm.mapper)),
                    );
                }
                let all = self.union(&types);
                let template = self.mapped_template(target);
                self.infer_types(n, all, template);
                true
            }
            _ => false,
        }
    }

    /// `createReverseMappedType`: the type that `{ [P in keyof T]: X }` maps to `source`.
    pub(super) fn reverse_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        of: TypeId,
    ) -> Option<TypeId> {
        let members = self.members_of_reduced_apparent_type(source)?;
        // It requires a string index signature, or properties that are not all omitted.
        if !(members
            .shape()
            .index
            .iter()
            .any(|i| i.key == TypeId::STRING)
            || !members.shape().props.is_empty() && self.is_partially_inferable(source))
        {
            return None;
        }
        if let Some(element) = self.array_element(source) {
            let element = self.infer_reverse_mapped_type(element, target, of)?;
            let readonly = self.is_reference_to_global(source, known::ReadonlyArray, 1);
            return Some(if readonly {
                self.readonly_array_of(element)
            } else {
                self.array_of(element)
            });
        }
        if let TypeData::Tuple {
            flags, readonly, ..
        } = self.data(source)
        {
            let element_types: SmallVec<[Option<TypeId>; 8]> = self
                .type_arguments(source)
                .iter()
                .map(|&e| self.infer_reverse_mapped_type(e, target, of))
                .collect();
            let element_types: Parts = element_types.into_iter().collect::<Option<_>>()?;
            let adds_optional = self.mapped_optional_modifier(target) == MappedModifier::Add;
            let element_infos: SmallVec<[ElemFlags; 8]> = flags
                .iter()
                .map(|&f| {
                    if adds_optional && f.contains(ElemFlags::OPTIONAL) {
                        ElemFlags::REQUIRED.with_label(f.labeled_declaration())
                    } else {
                        f
                    }
                })
                .collect();
            return Some(self.normalized_tuple(&element_types, &element_infos, *readonly));
        }
        // Its members are resolved on demand.
        Some(self.intern(TypeData::ReverseMapped {
            source,
            mapped: target,
            of,
        }))
    }

    /// `t.objectFlags&ObjectFlagsNonInferrableType != 0`: `ty` is, or contains, `autoType`,
    /// `silentNeverType` or a literal checked without its context sensitive functions.
    #[inline]
    pub(super) fn is_non_inferrable(&self, ty: TypeId) -> bool {
        let flags = self.types().object_flags(ty);
        flags.contains(ObjectFlags::NON_INFERRABLE_TYPE)
            || flags.contains(ObjectFlags::NON_INFERRABLE_BY_ALIAS)
                && self.is_non_inferrable_by_alias(ty)
    }

    /// `is_non_inferrable` for a type that has `ObjectFlags::NON_INFERRABLE_BY_ALIAS` only.
    fn is_non_inferrable_by_alias(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Synth(shape) => shape.props.iter().any(|p| {
                matches!(p.source, PropSource::Copy(ty, ..) | PropSource::Type(ty)
                    if self.is_non_inferrable(ty))
            }),
            TypeData::Tuple {
                elems: TypeArguments::Given(list),
                ..
            }
            | TypeData::Ref {
                args: TypeArguments::Given(list),
                ..
            }
            | TypeData::Union(list)
            | TypeData::Intersection(list) => list.iter().any(|&m| self.is_non_inferrable(m)),
            // `instantiateAnonymousType`: `objectFlags |=
            // getPropagatingFlagsOfTypes(aliasTypeArguments)`. A type substituted for a type
            // parameter in an anonymous type does not mark it, unless the anonymous type has an
            // alias and the substituted type is a type argument of the alias.
            TypeData::Anon { .. } | TypeData::Fns { .. } => {
                self.alias_of_type(ty).is_some_and(|(_, type_arguments)| {
                    type_arguments
                        .iter()
                        .any(|&argument| self.is_non_inferrable(argument))
                })
            }
            _ => false,
        }
    }

    /// `isPartiallyInferableType`
    fn is_partially_inferable(&mut self, ty: TypeId) -> bool {
        if !self.is_non_inferrable(ty) {
            return true;
        }
        if self.is_object_literal_type(ty) {
            return self.members(ty).is_some_and(|members| {
                members.shape().props.iter().any(|p| {
                    let ty = self.type_of_prop(p, members.mapper);
                    self.is_partially_inferable(ty)
                })
            });
        }
        self.is_tuple(ty)
            && self
                .type_arguments(ty)
                .iter()
                .any(|&e| self.is_partially_inferable(e))
    }

    /// `resolveReverseMappedTypeMembers`, of `ty`.
    pub(super) fn build_reverse_mapped_shape(
        &mut self,
        ty: TypeId,
        source: TypeId,
        target: TypeId,
        of: TypeId,
    ) -> Shape<'s> {
        let mut shape = Shape::new_in(self.arena);
        let Some(members) = self.members_of_reduced_apparent_type(source) else {
            return shape;
        };
        let adds_optional = self.mapped_optional_modifier(target) == MappedModifier::Add;
        let adds_readonly = self.mapped_origin(target).is_some_and(|(file, node, _)| {
            self.mapped_decl(file, node).readonly == MappedModifier::Add
        });
        if let Some(info) = members
            .shape()
            .index
            .iter()
            .find(|i| i.key == TypeId::STRING)
        {
            let value = self.instantiate(info.value, members.mapper);
            let value = self
                .infer_reverse_mapped_type(value, target, of)
                .unwrap_or(TypeId::UNKNOWN);
            shape.index.push(IndexInfo::new(
                TypeId::STRING,
                value,
                !adds_readonly && info.readonly,
            ));
        }
        let limited = self.limited_constraint(target, of);
        for prop in &members.shape().props {
            // Properties that the rest of the constraint filters out would not have passed through
            // the mapping.
            if let Some(limited) = limited
                && let Some(key) = self.key_type_of_name(prop.name)
                && !self.is_assignable(key, limited)
            {
                continue;
            }
            // `links.propertyType = c.getTypeOfSymbol(prop)`
            self.type_of_prop_with_missing(prop, members.mapper);
            let mut flags = PropFlags::empty();
            if !adds_optional && prop.flags.contains(PropFlags::OPTIONAL) {
                flags |= PropFlags::OPTIONAL;
            }
            if !adds_readonly && prop.flags.contains(PropFlags::READONLY) {
                flags |= PropFlags::READONLY;
            }
            shape.props.push(Prop {
                name: prop.name,
                flags,
                source: PropSource::ReverseMapped(
                    ty,
                    self.list_of(Self::declared_properties(&[prop], self.arena)),
                ),
                mapper: MapperId::IDENTITY,
            });
        }
        shape
    }

    /// `getTypeOfReverseMappedSymbol` for the property `name` of the reverse mapped type `ty`.
    pub(super) fn type_of_reverse_mapped_prop(&mut self, ty: TypeId, name: Atom) -> TypeId {
        let TypeData::ReverseMapped { source, mapped, of } = *self.data(ty) else {
            return TypeId::UNRESOLVED;
        };
        let Some(members) = self.members_of_reduced_apparent_type(source) else {
            return TypeId::UNRESOLVED;
        };
        let Some(prop) = members.resolved.prop(name) else {
            return TypeId::UNRESOLVED;
        };
        let property_type = self.type_of_prop_with_missing(prop, members.mapper);
        // `{ [P in keyof T[K]]: X }` was mapped from the same type as `{ [P in keyof T]: X }`.
        // Normalizing to that form creates fewer types.
        let (mut mapped, mut of) = (mapped, of);
        if let TypeData::IndexedAccess { obj, index, .. } = *self.data(of)
            && matches!(self.data(obj), TypeData::TypeParam(..))
            && matches!(self.data(index), TypeData::TypeParam(..))
        {
            // `replaceIndexedAccess`: `[T][0]` is `T`.
            let zero = self.number_literal(0.0, false);
            let one = self.tuple(&[obj], &[ElemFlags::REQUIRED], false);
            let mapper = self.mapper_from(&[index, obj], &[zero, one]);
            let replaced = self.instantiate(mapped, mapper);
            if self.mapped_origin(replaced).is_some() {
                (mapped, of) = (replaced, obj);
            }
        }
        self.infer_reverse_mapped_type(property_type, mapped, of)
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// `getLimitedConstraint`: of `{ [P in keyof T & K]: X }`, the `K`.
    fn limited_constraint(&mut self, target: TypeId, of: TypeId) -> Option<TypeId> {
        let constraint = self.mapped_keys(target);
        // `keyof T & ("a" | "b")` is `keyof T & "a" | keyof T & "b"` by now.
        let origin: &[TypeId] = match (self.data(constraint), self.origin(constraint)) {
            (TypeData::Union(_), UnionOrigin::Intersection(types)) => types,
            (TypeData::Intersection(types), _) => types,
            _ => return None,
        };
        let constraint_type = self.intern(TypeData::Keyof(of));
        let others: Parts = (origin.iter().copied())
            .filter(|&t| t != constraint_type)
            .collect();
        let limited = self.intersection(&others);
        (!limited.is_never()).then_some(limited)
    }

    /// `inferReverseMappedType`
    fn infer_reverse_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        of: TypeId,
    ) -> Option<TypeId> {
        let key = (source, target, of);
        if let Some(cached) = self.p.reverse_mapped_cache.get(&self.task, &key) {
            return Some(cached.unwrap_or(TypeId::UNKNOWN));
        }
        let scope = self.begin_scope();
        self.reverse_mapped_source_stack.push(source);
        self.reverse_mapped_target_stack.push(target);
        let saved = self.reverse_expanding;
        let (sources, targets) = (
            std::mem::take(&mut self.reverse_mapped_source_stack),
            std::mem::take(&mut self.reverse_mapped_target_stack),
        );
        if self.is_deeply_nested_type(source, &sources, 2) {
            self.reverse_expanding |= 1;
        }
        if self.is_deeply_nested_type(target, &targets, 2) {
            self.reverse_expanding |= 2;
        }
        (
            self.reverse_mapped_source_stack,
            self.reverse_mapped_target_stack,
        ) = (sources, targets);
        let result = if self.reverse_expanding != 3 && self.reverse_mapped_source_stack.len() < 24 {
            // `inferReverseMappedTypeWorker`: `T[P]` is what is inferred.
            let param = self.mapped_type_param(target);
            let element = self.indexed_access(of, param);
            let template = self.mapped_template(target);
            let mut inner = Inference::for_params(&[element], None);
            self.infer(&mut inner, source, template, 0);
            let inferred = self
                .type_from_inference(&inner.candidates[0])
                .unwrap_or(TypeId::UNKNOWN);
            Some(self.get_widened_type(inferred))
        } else {
            None
        };
        self.reverse_mapped_source_stack.pop();
        self.reverse_mapped_target_stack.pop();
        self.reverse_expanding = saved;
        match self.end_scope_by_counters(scope) {
            Ok(stored) => (self.p.reverse_mapped_cache).insert(&self.task, key, result, stored),
            Err(_) => result,
        }
    }

    /// `getRestTypeAtPosition`
    pub(super) fn rest_type_at_position(
        &mut self,
        params: &[SigParam],
        pos: usize,
        readonly: bool,
    ) -> TypeId {
        let parameter_count = self.parameter_count(params);
        let min_argument_count = self.min_argument_count(params);
        let rest_type = self.effective_rest_type(params);
        if let Some(rest_type) = rest_type
            && pos + 1 >= parameter_count
        {
            if pos + 1 == parameter_count {
                return rest_type;
            }
            let element = self.indexed_access(rest_type, TypeId::NUMBER);
            return self.array_of(element);
        }
        let mut types = Parts::new();
        let mut infos: SmallVec<[ElemFlags; 8]> = SmallVec::new();
        for i in pos..parameter_count {
            let (ty, flags) = match rest_type {
                Some(rest_type) if i + 1 == parameter_count => (rest_type, ElemFlags::VARIADIC),
                _ => (
                    self.param_type_at(params, i).unwrap_or(TypeId::ANY),
                    if i < min_argument_count {
                        ElemFlags::REQUIRED
                    } else {
                        ElemFlags::OPTIONAL
                    },
                ),
            };
            types.push(ty);
            infos.push(flags.with_label(self.nameable_declaration_at_position(params, i)));
        }
        self.normalized_tuple(&types, &infos, readonly)
    }

    /// `getNameableDeclarationAtPosition`
    fn nameable_declaration_at_position(
        &self,
        params: &[SigParam],
        pos: usize,
    ) -> LabeledDeclaration {
        let Some(last) = params.last() else {
            return LabeledDeclaration::NONE;
        };
        // `isValidDeclarationForTupleLabel`: `name` is `NONE` for a pattern.
        let label = |parameter: &SigParam| match parameter.declaration {
            Some((file, p)) if parameter.name.is_some() => LabeledDeclaration {
                name: parameter.name,
                file,
                pos: self.hir(file)[p].pos,
            },
            _ => LabeledDeclaration::NONE,
        };
        let param_count = params.len() - usize::from(last.rest);
        if pos < param_count {
            return label(&params[pos]);
        }
        if !last.rest {
            return LabeledDeclaration::NONE;
        }
        match self.data(last.ty) {
            TypeData::Tuple { flags, .. } => flags
                .get(pos - param_count)
                .map_or(LabeledDeclaration::NONE, |info| info.labeled_declaration()),
            _ => label(last),
        }
    }

    /// `getBaseSignature`: `sig` with each of its type parameters replaced by its base constraint.
    pub fn base_sig(&mut self, sig: SigId) -> SigId {
        let params = self.sig_type_params(sig);
        if params.is_empty() {
            return sig;
        }
        let outer = self.mapper_around_sig(sig);
        let mut bases: SmallVec<[TypeId; 4]> = params
            .iter()
            .map(|&p| match self.constraint_of_type_param(p) {
                Some(c) if self.is_cloned_type_param(p) => c,
                Some(c) => self.instantiate(c, outer),
                None => TypeId::UNKNOWN,
            })
            .collect();
        // Repeated until mutually dependent constraints reduce to outer types; whatever is still
        // circular becomes `any`.
        let to_constraints = self.mapper_from(&params, &bases);
        for _ in 1..params.len() {
            for base in &mut bases {
                *base = self.instantiate(*base, to_constraints);
            }
        }
        let anys: SmallVec<[TypeId; 4]> = smallvec![TypeId::ANY; params.len()];
        let eraser = self.mapper_from(&params, &anys);
        for base in &mut bases {
            *base = self.instantiate(*base, eraser);
        }
        self.with_own_type_params(sig, &params, &bases)
    }

    /// `assignContextualParameterTypes`: a context sensitive function expression, arrow function or object literal method without
    /// type parameters adopts those of its contextual signature (`sig.typeParameters = context.typeParameters`). Returns the
    /// adopted type parameters that `sig` has no type argument for.
    pub(super) fn adopted_type_params(&mut self, sig: SigId) -> Vec<TypeId> {
        match *self.types().sig(sig) {
            SigData::Decl { file, func, mapper } => self.adopted_type_params_of(file, func, mapper),
            _ => Vec::new(),
        }
    }

    /// `adopted_type_params` for the signature of `func` that has `mapper`.
    pub(super) fn adopted_type_params_of(
        &mut self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> Vec<TypeId> {
        if !self.hir(file)[func].type_params.is_empty() {
            return Vec::new();
        }
        let Some(owner) = self.takes_context(file, func) else {
            return Vec::new();
        };
        if !self.is_context_sensitive(file, owner) {
            return Vec::new();
        }
        // tsc stored the type parameters when it checked the function, so a cycle through this lookup is not an error.
        self.eager.push(self.stack.len());
        let contextual = self.assigned_contextual_signature(file, func);
        self.eager.pop();
        let Some(contextual) = contextual else {
            return Vec::new();
        };
        let mut params = self.sig_type_params(contextual).into_vec();
        params.retain(|&param| {
            self.types()
                .map(mapper, param)
                .is_none_or(|actual| actual == param)
        });
        params
    }

    /// `cloneTypeParameter`: `param` belongs to a signature found in an instantiated type. Its
    /// constraint and default are already instantiated with the outer mapper of the signature; for
    /// any other type parameter that remains to be done.
    fn is_cloned_type_param(&self, param: TypeId) -> bool {
        matches!(*self.data(param), TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY)
    }

    // ───────────────────────────── conclusions ─────────────────────────────

    /// `hasPrimitiveConstraint` for a type parameter with the constraint `constraint`.
    fn is_primitive_constraint(&mut self, constraint: Option<TypeId>) -> bool {
        let Some(mut constraint) = constraint else {
            return false;
        };
        if matches!(self.data(constraint), TypeData::Cond { .. }) {
            constraint = self.default_constraint_of_conditional(constraint);
        }
        self.may_be_primitive_or_key(constraint)
    }

    /// `maybeTypeOfKind(t, Primitive | Index | TemplateLiteral | StringMapping)`
    pub(super) fn may_be_primitive_or_key(&self, ty: TypeId) -> bool {
        self.maybe_type_of_kind(ty, |c, t| {
            matches!(c.data(t), TypeData::Keyof(_)) || c.is_primitive(t)
        })
    }

    /// `isTypeParameterAtTopLevel`
    fn is_type_parameter_at_top_level(&mut self, ty: TypeId, param: TypeId, depth: u32) -> bool {
        if ty == param {
            return true;
        }
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.is_type_parameter_at_top_level(p, param, depth)),
            TypeData::Cond { .. } if depth < 3 => {
                let (yes, no) = (self.cond_piece(ty, 2), self.cond_piece(ty, 3));
                self.is_type_parameter_at_top_level(yes, param, depth + 1)
                    || self.is_type_parameter_at_top_level(no, param, depth + 1)
            }
            _ => false,
        }
    }

    /// `isTypeParameterAtTopLevelInReturnType`
    fn is_type_parameter_at_top_level_in_return_type(&mut self, sig: SigId, param: TypeId) -> bool {
        if let Some(predicate) = self.sig_predicate(sig) {
            return predicate
                .ty
                .is_some_and(|ty| self.is_type_parameter_at_top_level(ty, param, 0));
        }
        let ret = self.sig_return(sig);
        self.is_type_parameter_at_top_level(ret, param, 0)
    }

    /// `getCommonSupertype`
    fn common_supertype(&mut self, types: &[TypeId]) -> TypeId {
        if types.len() == 1 {
            return types[0];
        }
        // Nullable members are set aside and added back at the end.
        let is_nullable = |m: TypeId| m.is_undefined() || m.is_null();
        let primary: Parts = if self.p.files.options.strict_null_checks {
            types
                .iter()
                .map(|&t| self.filter(t, |_, m| !is_nullable(m)))
                .collect()
        } else {
            Parts::from_slice(types)
        };
        // Literals of one primitive stay a union. Otherwise the leftmost type that has no supertype
        // to its right.
        let supertype = if self.literal_types_with_same_base_type(&primary) {
            self.union(&primary)
        } else {
            self.single_common_supertype(&primary)
        };
        if primary[..] == types[..] {
            return supertype;
        }
        let mut with_nullable: SmallVec<[TypeId; 4]> = smallvec![supertype];
        for &t in types {
            for &m in self.parts(t) {
                // `getNullableType` adds the ordinary ones.
                if is_nullable(m) && !with_nullable.contains(&m.plain()) {
                    with_nullable.push(m.plain());
                }
            }
        }
        self.union(&with_nullable)
    }

    /// `literalTypesWithSameBaseType`
    fn literal_types_with_same_base_type(&mut self, types: &[TypeId]) -> bool {
        let mut common = None;
        for &t in types {
            if t.is_never() {
                continue;
            }
            let base = self.base_of_literal(t);
            let common = *common.get_or_insert(base);
            if base == t || base != common {
                return false;
            }
        }
        true
    }

    /// `getSingleCommonSupertype`
    fn single_common_supertype(&mut self, types: &[TypeId]) -> TypeId {
        let leftmost = |c: &mut Self, relation: fn(&mut Self, TypeId, TypeId) -> bool| {
            let mut candidate = types[0];
            for &t in &types[1..] {
                if relation(c, candidate, t) {
                    candidate = t;
                }
            }
            candidate
        };
        let candidate = leftmost(self, Self::is_strict_subtype);
        if types
            .iter()
            .all(|&t| t == candidate || self.is_strict_subtype(t, candidate))
        {
            return candidate;
        }
        leftmost(self, Self::is_subtype)
    }

    /// `getCommonSubtype`: the leftmost type that has no subtype to its right.
    fn common_subtype(&mut self, types: &[TypeId]) -> TypeId {
        let mut best = types[0];
        for &t in &types[1..] {
            if self.is_subtype(t, best) {
                best = t;
            }
        }
        best
    }

    /// `getTypeFromInference`
    fn type_from_inference(&mut self, c: &Candidate) -> Option<TypeId> {
        if !c.covariant.is_empty() {
            Some(self.union_reduced(&c.covariant))
        } else if !c.contravariant.is_empty() {
            Some(self.intersection(&c.contravariant))
        } else {
            None
        }
    }

    /// `isObjectOrArrayLiteralType`
    fn is_object_or_array_literal_type(&self, ty: TypeId) -> bool {
        self.types().is_array_literal(ty) || self.is_object_literal_type(ty)
    }

    /// `getCovariantInference`, and the constraint of `param`.
    fn covariant_inference(
        &mut self,
        c: &Candidate,
        param: TypeId,
        sig: SigId,
        is_fixed: bool,
    ) -> (TypeId, Option<TypeId>) {
        // `unionObjectAndArrayLiteralCandidates`: the object and array literals count as one, after the others.
        let mut candidates = c.covariant.clone();
        if candidates.len() > 1 {
            let (literals, mut others): (SmallVec<[TypeId; 4]>, SmallVec<[TypeId; 4]>) = candidates
                .iter()
                .copied()
                .partition(|&t| self.is_object_or_array_literal_type(t));
            if !literals.is_empty() {
                others.push(self.union_reduced(&literals));
                candidates = others;
            }
        }
        // Literals are widened if every inference was to the type parameter itself, its constraint
        // is not primitive, and it was fixed early or is not the return type.
        let constraint = self.constraint_of_type_param(param);
        let primitive_constraint =
            self.is_primitive_constraint(constraint) || self.is_const_type_variable(param, 0);
        let widen = !primitive_constraint
            && c.top_level
            && (is_fixed || !self.is_type_parameter_at_top_level_in_return_type(sig, param));
        for t in &mut candidates {
            *t = if primitive_constraint {
                self.regular(*t)
            } else if widen {
                self.widen_literal(*t)
            } else {
                *t
            };
        }
        let unwidened = if c.priority & PRIORITY_IMPLIES_COMBINATION == 0 {
            self.common_supertype(&candidates)
        } else {
            self.union_reduced(&candidates)
        };
        (self.get_widened_type(unwidened), constraint)
    }

    /// `getInferredType`. `is_fixed`: the inference is being fixed, because something needs it
    /// before all candidates have been collected.
    pub(super) fn get_inferred_type(
        &mut self,
        n: &Inference,
        index: usize,
        is_fixed: bool,
    ) -> TypeId {
        self.get_inferred_type_comparing(n, index, is_fixed, &mut |c, s, t| c.is_assignable(s, t))
    }

    /// `compare`: `InferenceContext.compareTypes`, as "is not `TernaryFalse`". A comparison of two
    /// signatures passes its own `isRelatedTo`, so that what is in progress and how deep it is
    /// count for the constraint of an inferred type too. Otherwise `compareTypesAssignable`.
    fn get_inferred_type_comparing(
        &mut self,
        n: &Inference,
        index: usize,
        is_fixed: bool,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> TypeId {
        let c = &n.candidates[index];
        if let Some(fixed) = c.fixed {
            return fixed;
        }
        if let Some(inferred) = c.inferred.get() {
            return inferred;
        }
        let inferred = self.get_inferred_type_uncached(n, index, is_fixed, compare);
        n.candidates[index].inferred.set(Some(inferred));
        inferred
    }

    fn get_inferred_type_uncached(
        &mut self,
        n: &Inference,
        index: usize,
        is_fixed: bool,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> TypeId {
        let c = &n.candidates[index];
        let param = n.params[index];
        if param == TypeId::ERROR {
            return param;
        }
        // The type containing the signature has been instantiated. A clone already reflects that.
        let outer = if self.is_cloned_type_param(param) {
            MapperId::IDENTITY
        } else {
            match n.sig {
                Some(sig) => self.mapper_around_sig(sig),
                None => n.around,
            }
        };
        let mut inferred = None;
        let mut fallback = None;
        // The constraint of `param`, if it has been resolved.
        let mut extended = None;
        if let Some(sig) = n.sig {
            let covariant = if c.covariant.is_empty() {
                None
            } else {
                let (covariant, constraint) = self.covariant_inference(c, param, sig, is_fixed);
                extended = Some(constraint);
                Some(covariant)
            };
            let contravariant = if c.contravariant.is_empty() {
                None
            } else if c.priority & PRIORITY_IMPLIES_COMBINATION != 0 {
                Some(self.intersection(&c.contravariant))
            } else {
                Some(self.common_subtype(&c.contravariant))
            };
            if covariant.is_some() || contravariant.is_some() {
                // The covariant inference, unless it is `never` or `any`, or is one of several
                // candidates that disagree, or is assignable to no contravariant candidate, or an
                // inference for a parameter constrained by this one is not assignable to it.
                let prefer_covariant = match (covariant, contravariant) {
                    (Some(_), None) => true,
                    (None, _) => false,
                    (Some(co), Some(_)) => {
                        !co.is_never()
                            && !self.is_any(co)
                            && c.contravariant.iter().any(|&t| self.is_assignable(co, t))
                            && (0..n.params.len()).all(|other| {
                                other != index
                                    && self.constraint_of_type_param(n.params[other]) != Some(param)
                                    || n.candidates[other]
                                        .covariant
                                        .iter()
                                        .all(|&t| self.is_assignable(t, co))
                            })
                    }
                };
                (inferred, fallback) = if prefer_covariant {
                    (covariant, contravariant)
                } else {
                    (contravariant, covariant)
                };
            } else if n.no_default {
                inferred = Some(TypeId::SILENT_NEVER);
            } else if let Some(default) = self.default_of_type_param(param) {
                // A default may mention the preceding parameters. Those from it on have no type
                // yet.
                let mut default = self.instantiate(default, outer);
                if self.has_type_variables(default) {
                    let unknowns: SmallVec<[TypeId; 4]> =
                        smallvec![TypeId::UNKNOWN; n.params.len() - index];
                    let backreference = self.mapper_from(&n.params[index..], &unknowns);
                    default = self.instantiate(default, backreference);
                    let so_far = self.non_fixing_mapper_comparing(n, default, compare);
                    default = self.instantiate(default, so_far);
                }
                inferred = Some(default);
            }
        } else {
            inferred = self.type_from_inference(c);
        }
        let provisional = inferred.unwrap_or(if n.any_default {
            TypeId::ANY
        } else {
            TypeId::UNKNOWN
        });
        let extended = match extended {
            Some(requested) => requested,
            None => self.constraint_of_type_param(param),
        };
        let Some(constraint) = extended else {
            return provisional;
        };
        let constraint = self.instantiate(constraint, outer);
        // Its constraint may refer back to it.
        c.inferred.set(Some(provisional));
        let so_far = self.non_fixing_mapper_comparing(n, constraint, compare);
        let constraint = self.instantiate(constraint, so_far);
        if let Some(inference) = inferred {
            let constraint_with_this = self.type_with_this_argument(constraint, inference);
            if !compare(self, inference, constraint_with_this)
                && !self.satisfies_constraint_in_outer_context(n, inference, constraint, compare)
            {
                // An inference from the contextual return type alone is speculative anyway: the
                // part of it that satisfies the constraint is used.
                let filtered = if c.priority == PRIORITY_RETURN {
                    self.filter(inference, |k, m| compare(k, m, constraint_with_this))
                } else {
                    TypeId::NEVER
                };
                inferred = (!filtered.is_never()).then_some(filtered);
            }
        }
        match inferred {
            Some(ty) => ty,
            None => match fallback {
                Some(fallback) => {
                    let constraint_with_this = self.type_with_this_argument(constraint, fallback);
                    if compare(self, fallback, constraint_with_this) {
                        fallback
                    } else {
                        constraint
                    }
                }
                None => constraint,
            },
        }
    }

    /// Whether the constraint of the type parameter `ty` of the source signature is related to
    /// `constraint`, once it is instantiated with the outer mapper of that signature.
    /// `instantiateSignature` clones the type parameters, so in tsgo `ty` has that constraint. Here
    /// an instantiated signature has the declared type parameters and a mapper.
    fn satisfies_constraint_in_outer_context(
        &mut self,
        n: &Inference,
        ty: TypeId,
        constraint: TypeId,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> bool {
        if n.around_source == MapperId::IDENTITY
            || !matches!(self.data(ty), TypeData::TypeParam(..))
            || self.is_cloned_type_param(ty)
        {
            return false;
        }
        let Some(declared) = self.constraint_of_type_param(ty) else {
            return false;
        };
        let extended = self.instantiate(declared, n.around_source);
        extended != declared && (extended == constraint || compare(self, extended, constraint))
    }

    /// `nonFixingMapper`, for the parameters `ty` mentions.
    pub(super) fn non_fixing_mapper(&mut self, n: &Inference, ty: TypeId) -> MapperId {
        self.non_fixing_mapper_comparing(n, ty, &mut |c, s, t| c.is_assignable(s, t))
    }

    fn non_fixing_mapper_comparing(
        &mut self,
        n: &Inference,
        ty: TypeId,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> MapperId {
        if !self.has_type_variables(ty) {
            return self.mapper_of_context_not_mentioned_in(ty);
        }
        let mut pairs = Vec::new();
        let mentioned = self.params_mentioned_in(ty, &n.params);
        for i in 0..n.params.len() {
            if mentioned[i] {
                let inferred = self.get_inferred_type_comparing(n, i, false, compare);
                pairs.push((n.params[i], inferred));
            }
        }
        if pairs.is_empty() {
            return self.mapper_of_context_not_mentioned_in(ty);
        }
        self.types().mapper(pairs)
    }

    /// The mapper of an inference context, for a `ty` that mentions none of its type parameters.
    /// It is not nil, so `instantiateType` replaces what has
    /// `ObjectFlags::HAS_OTHER_INSTANTIATION`. Only a type parameter is looked up in a mapper: the
    /// pair maps nothing.
    fn mapper_of_context_not_mentioned_in(&self, ty: TypeId) -> MapperId {
        let flags = self.types().object_flags(ty);
        if flags.contains(ObjectFlags::HAS_OTHER_INSTANTIATION) {
            self.types().mapper_of(&[(TypeId::NEVER, TypeId::UNKNOWN)])
        } else {
            MapperId::IDENTITY
        }
    }

    /// `context.mapper`, for what `ty` mentions (`InferenceTypeMapper.Map`).
    pub(super) fn fixing_mapper(&mut self, n: &mut Inference, ty: TypeId) -> MapperId {
        if !self.may_mention_type_parameter(ty) {
            return self.mapper_of_context_not_mentioned_in(ty);
        }
        let mentioned = self.params_mentioned_in(ty, &n.params);
        let mut pairs = Vec::new();
        for i in 0..n.params.len() {
            if !mentioned[i] {
                continue;
            }
            if n.candidates[i].fixed.is_none() {
                self.infer_from_intra_expression_sites(n);
                n.clear_cached_inferences();
                n.candidates[i].fixed = Some(self.get_inferred_type(n, i, true));
            }
            pairs.push((n.params[i], self.get_inferred_type(n, i, true)));
        }
        if pairs.is_empty() {
            return self.mapper_of_context_not_mentioned_in(ty);
        }
        self.types().mapper(pairs)
    }

    /// `inferFromIntraExpressionSites`
    fn infer_from_intra_expression_sites(&mut self, n: &mut Inference) {
        for (file, e, ty) in std::mem::take(&mut n.intra_expression_inference_sites) {
            if let Some(contextual_type) =
                self.contextual_type(file, e, ContextFlags::NO_CONSTRAINTS)
            {
                self.infer(n, ty, contextual_type, 0);
            }
        }
    }

    /// `core.Some(n.inferences, hasInferenceCandidatesOrDefault)`
    pub(super) fn has_inference_candidates_or_default(&self, n: &Inference) -> bool {
        (0..n.params.len()).any(|i| {
            let c = &n.candidates[i];
            !c.covariant.is_empty()
                || !c.contravariant.is_empty()
                || self.has_type_parameter_default(n.params[i])
        })
    }

    /// Maps every parameter to its current inference.
    pub(super) fn inference_mapper(&mut self, n: &Inference) -> MapperId {
        self.inference_mapper_comparing(n, &mut |c, s, t| c.is_assignable(s, t))
    }

    pub(super) fn inference_mapper_comparing(
        &mut self,
        n: &Inference,
        compare: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> MapperId {
        let types: SmallVec<[TypeId; 4]> = (0..n.params.len())
            .map(|i| self.get_inferred_type_comparing(n, i, false, compare))
            .collect();
        self.mapper_from(&n.params, &types)
    }

    /// Whether `param` occurs in `ty`, as far as can be told without resolving members.
    pub fn mentions(&self, ty: TypeId, param: TypeId) -> bool {
        self.any_type_in(ty, false, |t| t == param)
    }

    /// `couldContainTypeVariables`. It holds wherever `has_type_variables`, which is exact, does,
    /// and for every type that the original does not look into. Inference to such a type finds no
    /// candidate, but resolves the parts of the source that it visits.
    pub(super) fn could_contain_type_variables(&self, ty: TypeId) -> bool {
        if self.has_type_variables(ty) || self.is_instantiable(ty) {
            return true;
        }
        let some = |types: &[TypeId]| types.iter().any(|&t| self.could_contain_type_variables(t));
        let generic_kinds = SymFlags::FUNCTION
            | SymFlags::METHOD
            | SymFlags::CLASS
            | SymFlags::TYPE_LITERAL
            | SymFlags::OBJECT_LITERAL;
        let (mapper, could_contain) = match self.data(ty) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args {
                TypeArguments::Given(actual) => (MapperId::IDENTITY, some(actual)),
                TypeArguments::Deferred(deferred) => (deferred.mapper, true),
            },
            TypeData::Anon { origin, mapper } => {
                let could_contain = match *origin {
                    Origin::TypeLiteral(..)
                    | Origin::Mapped(..)
                    | Origin::ObjectLiteral(..)
                    | Origin::WidenedLiteral(..) => true,
                    Origin::ClassStatic(symbol)
                    | Origin::Function(symbol)
                    | Origin::EnumObject(symbol)
                    | Origin::Module(symbol)
                    | Origin::Namespace { module: symbol, .. } => {
                        self.files().flags(symbol).intersects(generic_kinds)
                    }
                    Origin::GlobalThis => false,
                };
                (*mapper, could_contain)
            }
            TypeData::Fns { mapper, .. } => (*mapper, true),
            TypeData::ReverseMapped { .. } => (MapperId::IDENTITY, true),
            TypeData::Union(types) | TypeData::Intersection(types) => (
                MapperId::IDENTITY,
                self.flags(ty) & tf::ENUM_LITERAL == 0 && some(types),
            ),
            TypeData::Synth(shape) => (
                shape.mapper,
                shape.is_object_rest_type
                    || shape.instantiation_expression.is_some()
                    || shape.symbol_declared_at.is_some_and(|it| it.2.is_some()),
            ),
            _ => return false,
        };
        // `getObjectTypeInstantiation`: an instantiation could contain what the type arguments for
        // its outer type parameters could.
        if mapper != MapperId::IDENTITY {
            let mut type_arguments = self.types().mapping(mapper).iter().map(|pair| pair.1);
            return type_arguments.any(|t| self.could_contain_type_variables(t));
        }
        could_contain && !self.is_non_generic_top_level_type(ty)
    }

    /// `isNonGenericTopLevelType`
    fn is_non_generic_top_level_type(&self, ty: TypeId) -> bool {
        self.alias_symbol_of_type(ty)
            .is_some_and(|alias| self.is_non_generic_top_level_alias(alias))
    }

    /// The same for a type whose `alias.symbol` is `alias`.
    pub(super) fn is_non_generic_top_level_alias(&self, alias: Sym) -> bool {
        let declarations = self.files().decls_of(alias);
        let Some((file, declaration)) = declarations.iter().find_map(|&(file, decl)| match decl {
            Decl::Alias(declaration) => Some((file, declaration)),
            _ => None,
        }) else {
            return false;
        };
        // Declared there, it has type arguments exactly if it has type parameters.
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.scope_of_declaration(hir, Decl::Alias(declaration));
        hir[declaration].type_params.is_empty()
            && bound
                .scopes
                .get(parent.idx())
                .is_some_and(|scope| scope.kind == ScopeKind::File)
    }

    /// Whether instantiating `ty` may map a type parameter.
    fn may_mention_type_parameter(&self, ty: TypeId) -> bool {
        self.types()
            .object_flags(ty)
            .intersects(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES | ObjectFlags::HAS_REVERSE_MAPPED)
    }

    /// `mentions` for each of `params`, in a single traversal of `ty`.
    pub(super) fn params_mentioned_in(&self, ty: TypeId, params: &[TypeId]) -> SmallVec<[bool; 4]> {
        let mut mentioned: SmallVec<[bool; 4]> = smallvec![false; params.len()];
        let may_be_any = self.any_type_in(ty, false, |t| {
            if let Some(i) = params.iter().position(|&p| p == t) {
                mentioned[i] = true;
            }
            false
        });
        if may_be_any {
            mentioned.fill(true);
        }
        mentioned
    }

    /// Whether `found` holds for `ty` or for a constituent of `ty`, as far as can be determined
    /// without resolving members. Also true where that cannot be determined. A type refers only to
    /// types created before it, and each is visited once, however deeply nested.
    /// `all`: also traverses signatures, so the result is always exact. Not the type arguments of
    /// an alias: `getObjectTypeInstantiation` leaves a type unchanged that mentions none of its
    /// outer type parameters, whatever it is an alias of.
    pub(super) fn any_type_in(
        &self,
        ty: TypeId,
        all: bool,
        mut found: impl FnMut(TypeId) -> bool,
    ) -> bool {
        let mut left: SmallVec<[TypeId; 16]> = smallvec![ty];
        let mut signatures: SmallVec<[SigId; 4]> = SmallVec::new();
        // The first few are searched linearly.
        let mut seen: SmallVec<[TypeId; 16]> = SmallVec::new();
        let mut seen_later = crate::util::FxHashSet::default();
        while let Some(ty) = left.pop() {
            if found(ty) {
                return true;
            }
            if !self.may_mention_type_parameter(ty) || seen.contains(&ty) {
                continue;
            }
            if seen.len() < seen.inline_size() {
                seen.push(ty);
            } else if !seen_later.insert(ty) {
                continue;
            }
            let values = |mapper: MapperId| self.types().mapping(mapper).iter().map(|pair| pair.1);
            match self.data(ty) {
                TypeData::Union(types) | TypeData::Intersection(types) => {
                    left.extend_from_slice(types);
                }
                TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args {
                    TypeArguments::Given(actual) => left.extend_from_slice(actual),
                    TypeArguments::Deferred(deferred) => left.extend(values(deferred.mapper)),
                },
                TypeData::Template { types, .. } => left.extend_from_slice(types),
                TypeData::Anon { mapper, .. }
                | TypeData::Fns { mapper, .. }
                | TypeData::Cond { mapper, .. } => left.extend(values(*mapper)),
                TypeData::Synth(shape) => {
                    if all {
                        signatures.extend(shape.call.iter().chain(&shape.construct).copied());
                    } else if !shape.call.is_empty() || !shape.construct.is_empty() {
                        return true;
                    }
                    for p in &shape.props {
                        match p.source {
                            PropSource::Type(t)
                            | PropSource::Copy(t, ..)
                            | PropSource::ReverseMapped(t, _) => left.push(t),
                            _ => left.extend(values(p.mapper)),
                        }
                    }
                    left.extend(shape.index.iter().map(|i| i.value));
                    left.extend(values(shape.mapper));
                }
                TypeData::IndexedAccess { obj, index, .. } => left.extend([*obj, *index]),
                TypeData::Substitution { base, constraint } => left.extend([*base, *constraint]),
                // `instantiateReverseMappedType` instantiates all three.
                TypeData::ReverseMapped { source, mapped, of } => {
                    left.extend([*source, *mapped, *of]);
                }
                TypeData::Keyof(t) | TypeData::StringMapping { ty: t, .. } => left.push(*t),
                _ => {}
            }
            while let Some(sig) = signatures.pop() {
                match self.types().sig(sig) {
                    SigData::Decl { mapper, .. } | SigData::Construct { mapper, .. } => {
                        left.extend(values(*mapper))
                    }
                    SigData::DefaultConstruct { base, mapper, .. } => {
                        signatures.extend(*base);
                        left.extend(values(*mapper));
                    }
                    SigData::Synth {
                        params,
                        ret,
                        this,
                        of,
                        ..
                    } => {
                        left.extend(params.iter().map(|p| p.ty).chain([*ret]).chain(*this));
                        signatures.extend_from_slice(of);
                    }
                    SigData::WithReturn { sig, ret } => {
                        signatures.push(*sig);
                        left.push(*ret);
                    }
                }
            }
        }
        false
    }
}

/// The arguments of the callback of `applyToReturnTypes`.
struct ReturnTypePair {
    s: TypeId,
    t: TypeId,
}

/// What `inferToMultipleTypes` infers to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Multiple {
    Union,
    Intersection,
    /// The branches of a conditional type.
    Branches,
}
