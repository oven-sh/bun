//! Infers type arguments for type parameters from a source type and a target type that mentions
//! them.
//!
//! Follows `internal/checker/inference.go` of TypeScript 7.0.2 function by function. The names in
//! `backticks` at the head of a function are the names there. Omitted: what the language service
//! blocks, and the arity a spread argument implies for `[...T, ...U]`.

use super::*;
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
    /// `ObjectFlagsArrayLiteral` of each of `covariant`. `createArrayLiteralType` sets it on a clone
    /// of the array type, so `number[]` and the type of `[1]` are two candidates.
    array_literals: SmallVec<[bool; 4]>,
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
    /// The source is the type implied by a binding pattern (`patternForType`).
    pub(super) from_pattern: bool,
    /// The types with `ObjectFlagsArrayLiteral` in the type of the argument that is being inferred
    /// from (`Checker::array_literal_types_in`).
    pub(super) array_literals: Vec<TypeId>,
    /// `InferenceFlagsAnyDefault`: the call is in a JavaScript file, where a parameter without
    /// inferences is `any`.
    pub(super) any_default: bool,
    /// The mapper for the outer type parameters of the source signature. Its own type parameters
    /// that are not clones are not instantiated with it, so their constraints have to be
    /// instantiated through this.
    pub(super) around_source: MapperId,
    /// Without a signature, for `infer`: the mapper for the outer type parameters of the
    /// conditional type. The constraints of the parameters may mention them.
    around: MapperId,
    /// `propagationType`
    propagated: Option<TypeId>,
    /// `returnMapper`. `IDENTITY`: nil.
    pub(super) return_mapper: MapperId,
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
            from_pattern: false,
            array_literals: Vec::new(),
            any_default: false,
            around_source: MapperId::IDENTITY,
            around: MapperId::IDENTITY,
            propagated: None,
            return_mapper: MapperId::IDENTITY,
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
    /// `ObjectFlagsNonInferrableType`: part of the type is missing.
    pub(super) fn is_non_inferrable_type(&self, ty: TypeId) -> bool {
        let flags = self.types().object_flags(ty);
        flags.contains(ObjectFlags::HAS_UNRESOLVED)
    }

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
        if !self.has_type_variables(target) || self.is_no_infer(target) {
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
                // Identical members on both sides are matched (`isTypeOrBaseIdenticalTo`), then
                // those instantiated from the same generic type or alias
                // (`isTypeCloselyMatchedBy`).
                self.infer_from_matching(n, &mut sources, &mut targets, |c, s, t| {
                    if t == TypeId::MISSING {
                        return s == t;
                    }
                    // Enum members have `TypeFlagsStringLiteral` or `TypeFlagsNumberLiteral` too.
                    c.with_freshness(s, false).plain() == t.plain()
                        || t == TypeId::STRING && c.string_literal_value(s).is_some()
                        || t == TypeId::NUMBER
                            && matches!(
                                c.data(s),
                                TypeData::NumberLit { .. }
                                    | TypeData::EnumLit {
                                        value: EnumValue::Number(_),
                                        ..
                                    }
                            )
                        || c.is_object_type(s) && c.is_object_type(t) && c.is_identical(s, t)
                });
                self.infer_from_matching(n, &mut sources, &mut targets, |c, s, t| {
                    match (c.data(s), c.data(t)) {
                        (TypeData::Ref { target: a, .. }, TypeData::Ref { target: b, .. }) => {
                            a == b
                        }
                        (TypeData::Anon { origin: a, .. }, TypeData::Anon { origin: b, .. }) => {
                            a == b
                        }
                        (TypeData::Fns { decls: a, .. }, TypeData::Fns { decls: b, .. }) => a == b,
                        _ => c
                            .same_alias(s, t)
                            .is_some_and(|(.., has_type_arguments)| has_type_arguments),
                    }
                });
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
                    .all(|&t| self.is_object_type(t) && !self.is_generic_mapped_type(t)) =>
            {
                // From `string[] & { extra: any }` to `string[] & T`: `{ extra: any }` for `T`. But
                // to `string[] & Iterable<T>` the `string[]` stays, and yields `string` for `T`.
                if !self.is_union(source) {
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
                // `ObjectFlagsNonInferrableType`: a type with omitted parts is not a candidate.
                if self.is_non_inferrable(source, 0) {
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
                    let apparent = self.apparent_type_for_relation(source);
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
            let is_array_literal = n.array_literals.contains(&candidate);
            let c = &mut n.candidates[index];
            if priority < c.priority {
                c.covariant.clear();
                c.depths.clear();
                c.array_literals.clear();
                c.contravariant.clear();
                c.top_level = true;
                c.priority = priority;
            }
            if priority == c.priority {
                // Contravariant only if no bivariant position was crossed on the way.
                if contra {
                    if !c.contravariant.contains(&candidate) {
                        c.contravariant.push(candidate);
                    }
                } else {
                    let found = (0..c.covariant.len()).find(|&i| {
                        c.covariant[i] == candidate && c.array_literals[i] == is_array_literal
                    });
                    if found.is_none_or(|i| c.depths[i] < depth) {
                        if let Some(i) = found {
                            c.covariant.remove(i);
                            c.depths.remove(i);
                            c.array_literals.remove(i);
                        }
                        let at = c
                            .depths
                            .iter()
                            .position(|&d| d < depth)
                            .unwrap_or(c.depths.len());
                        c.covariant.insert(at, candidate);
                        c.depths.insert(at, depth);
                        c.array_literals.insert(at, is_array_literal);
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
            }
            n.clear_cached_inferences();
        }
        n.inference_priority = n.inference_priority.min(n.priority as i32);
    }

    /// The members of a union in the order TypeScript iterates over them, as `parts_in_order`
    /// returns them.
    pub(super) fn sorted_parts(&self, ty: TypeId) -> Parts {
        let mut parts = Parts::from_slice(self.parts(ty));
        if parts.len() > 1 {
            parts.sort_by(|&a, &b| self.compare_types(a, b));
        }
        parts
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
        if let Some(known) = self.p.variances.get_ref(&mut self.task, &of) {
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
            if !self.has_type_variables(branch) {
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
                generic.extend(parts.into_iter().filter(|&t| self.has_type_variables(t)));
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
                let (s, t) = if which == 2 {
                    (self.cond_true(source), self.cond_true(target))
                } else {
                    (
                        self.cond_piece(source, which),
                        self.cond_piece(target, which),
                    )
                };
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
            if let TypeData::StringLit { value, .. } = *self.data(source)
                && let Some(index) = n.index_of(target)
                && let Some(constraint) = self.base_constraint_of(n.params[index])
                && !self.is_any(constraint)
                && !self.some_type(constraint, |_, m| m == TypeId::STRING)
                && let Some(spelled) = self.literal_matching_text(value, source, constraint)
            {
                self.infer_types(n, spelled, target);
                continue;
            }
            self.infer_types(n, source, target);
        }
    }

    /// The member of `constraint` that best represents the text `value`. The `choose` closure of
    /// `inferToTemplateLiteralType`.
    fn literal_matching_text(
        &mut self,
        value: Atom,
        source: TypeId,
        constraint: TypeId,
    ) -> Option<TypeId> {
        let text = self.atoms().bytes(value);
        let number = crate::atom::parse_number(text)
            .filter(|v| v.is_finite() && self.number_name(*v) == value);
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
        // In order of preference.
        let rank = |c: &mut Self, t: TypeId| -> Option<(u32, TypeId)> {
            match c.data(t) {
                TypeData::Template { texts, types } => c
                    .is_type_matched_by_template_literal_type(
                        source,
                        texts,
                        types,
                        &mut |c, s, t| c.is_assignable(s, t),
                    )
                    .then_some((1, source)),
                TypeData::StringMapping { kind, .. } => {
                    (c.string_mapping(*kind, source) == source).then_some((2, source))
                }
                TypeData::StringLit { value: v, .. }
                | TypeData::EnumLit {
                    value: EnumValue::String(v),
                    ..
                } => (*v == value).then_some((3, t)),
                TypeData::Intrinsic(Intrinsic::Number) | TypeData::Enum { .. } => {
                    number.map(|v| (4, c.number_literal(v, false)))
                }
                TypeData::NumberLit { bits, .. }
                | TypeData::EnumLit {
                    value: EnumValue::Number(bits),
                    ..
                } => (number.map(f64::to_bits) == Some(*bits)).then_some((5, t)),
                // `parseBigIntLiteralType`
                TypeData::Intrinsic(Intrinsic::BigInt) if is_bigint => {
                    let written = c.atoms().intern(digits);
                    Some((
                        6,
                        c.intern(TypeData::BigIntLit {
                            text: written,
                            negative,
                            fresh: false,
                        }),
                    ))
                }
                TypeData::BigIntLit {
                    text: written,
                    negative: minus,
                    ..
                } => (is_bigint && *minus == negative && c.atoms().bytes(*written) == digits)
                    .then_some((6, t)),
                TypeData::BoolLit { value: v, .. } => {
                    (text == if *v { &b"true"[..] } else { b"false" }).then_some((7, t))
                }
                _ if t.is_undefined() => (text == b"undefined").then_some((8, t)),
                _ if t.is_null() => (text == b"null").then_some((9, t)),
                _ => None,
            }
        };
        let mut best: Option<(u32, TypeId)> = None;
        for &t in self.parts(constraint) {
            if let Some(found) = rank(self, t)
                && best.is_none_or(|b| found.0 < b.0)
            {
                best = Some(found);
            }
        }
        best.map(|b| b.1)
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
        self.infer_from_signatures_of(n, source, target, false);
        self.infer_from_signatures_of(n, source, target, true);
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
            } else if middle_length == 1 && element_flags[start_length].contains(ElemFlags::REST) {
                if let Some(rest) = self.element_type_of_slice(
                    source_elems,
                    source_flags,
                    start_length,
                    end_length,
                    false,
                ) {
                    self.infer_types(n, rest, element_types[start_length]);
                }
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
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return false;
        };
        for tp in &tm.shape().props {
            if tp.flags.contains(PropFlags::OPTIONAL) {
                continue;
            }
            let Some((sp, source_mapper)) = self.property_in(&sm, tp.name) else {
                return true;
            };
            if match_discriminant_properties {
                let expected = self.type_of_prop(tp, tm.mapper);
                if self.is_unit(expected) {
                    let actual = self.type_of_prop(sp, source_mapper);
                    if !(self.is_any(actual)
                        || self.with_freshness(actual, false)
                            == self.with_freshness(expected, false))
                    {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// `inferFromProperties`
    fn infer_from_properties(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return;
        };
        for tp in &tm.shape().props {
            // `getPropertyOfType(source, targetProp.Name)` comes before either `getTypeOfSymbol`: a
            // target property that the source lacks may be the one whose type is being resolved.
            let Some((sp, source_mapper)) = self.property_in(&sm, tp.name) else {
                continue;
            };
            let actual = self.type_of_prop_as_read(sp, source_mapper);
            // A `NoInfer<T>` in the declaration is preserved.
            let expected = self.type_of_prop(tp, tm.mapper);
            if !self.has_type_variables(expected) || self.is_no_infer(expected) {
                continue;
            }
            // `removeMissingType`, as `type_of_prop_as_read` does it.
            let expected = if !tp.flags.contains(PropFlags::OPTIONAL) {
                expected
            } else if self.p.files.options.exact_optional_property_types {
                self.remove_missing_type(expected, true)
            } else {
                self.optional(expected)
            };
            self.infer_types(n, actual, expected);
        }
    }

    /// `inferFromSignatures`
    fn infer_from_signatures_of(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
        construct: bool,
    ) {
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return;
        };
        let (ss, ts) = if construct {
            (&sm.shape().construct, &tm.shape().construct)
        } else {
            (&sm.shape().call, &tm.shape().call)
        };
        if ss.is_empty() {
            return;
        }
        // `returnOnlyType`: a context sensitive function, retained only for its return type.
        let return_only = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::Partial);
        // From the last signature to the first. If the source has fewer, its first signature is
        // paired with the remaining target signatures.
        for (i, &t) in ts.iter().enumerate() {
            let source_index = (ss.len() + i).saturating_sub(ts.len());
            let s = if ss.len() == 1 {
                self.instantiate_only_sig(source, construct, ss[0], sm.mapper)
            } else {
                self.instantiate_sig(ss[source_index], sm.mapper)
            };
            let t = if ts.len() == 1 {
                self.instantiate_only_sig(target, construct, t, tm.mapper)
            } else {
                self.instantiate_sig(t, tm.mapper)
            };
            self.infer_from_signatures(n, s, t, return_only);
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
        if let Some((s, t)) = self.return_type_pair(generic, contextual) {
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
    fn infer_from_signatures(
        &mut self,
        n: &mut Inference,
        source: SigId,
        target: SigId,
        return_only: bool,
    ) {
        let source = self.base_sig(source);
        // `target.declaration`: the signature of a union has the declaration of the first signature
        // it represents.
        let is_method = match self.sig_decl(self.types().sig_origin(target)) {
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
        if let Some((s, t)) = self.return_type_pair(source, target) {
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
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::with_capacity(param_count + 2);
        if let Some(s) = self.sig_this_type(source)
            && let Some(t) = self.sig_this_type(target)
        {
            pairs.push((s, t));
        }
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
    fn return_type_pair(&mut self, source: SigId, target: SigId) -> Option<(TypeId, TypeId)> {
        if let Some(t) = self.sig_predicate(target)
            && let Some(s) = self.sig_predicate(source)
            // `typePredicateKindsMatch`
            && (t.asserts, t.param) == (s.asserts, s.param)
            && let (Some(st), Some(tt)) = (s.ty, t.ty)
        {
            return Some((st, tt));
        }
        // A `NoInfer<T>` in the declaration is preserved.
        let expected = self.sig_return(target);
        if !self.has_type_variables(expected) {
            return None;
        }
        Some((self.sig_return(source), expected))
    }

    /// `inferFromIndexTypes`
    fn infer_from_index_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
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
                if !self.has_type_variables(expected) {
                    continue;
                }
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
                    if other.key == info.key
                        || info.key == TypeId::STRING && other.key != TypeId::SYMBOL
                        || self.is_assignable(other.key, info.key)
                    {
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
            let expected = self.instantiate(info.value, tm.mapper);
            if self.has_type_variables(expected)
                && let Some(actual) = self
                    .applicable_index_info(&sm, info.key)
                    .map(|info| info.value)
            {
                self.infer_with_priority(n, actual, expected, priority);
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
                    let priority = if self.is_non_inferrable(source, 0) {
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
                    TypeData::Synth(shape)
                        if n.from_pattern
                            || matches!(
                                shape.literal,
                                Literalness::Pattern | Literalness::PatternWithComputedNames
                            ) =>
                    {
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
        let members = self.members(source)?;
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
            let readonly = self.is_reference_to_global(source, known::ReadonlyArray);
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
            let elems = self.type_arguments(source);
            let mut types = Vec::with_capacity(elems.len());
            for &e in elems.iter() {
                types.push(self.infer_reverse_mapped_type(e, target, of)?);
            }
            let adds_optional = self.mapped_optional_modifier(target) == MappedModifier::Add;
            let flags: Vec<ElemFlags> = flags
                .iter()
                .map(|&f| {
                    if adds_optional && f.contains(ElemFlags::OPTIONAL) {
                        ElemFlags::REQUIRED.with_label(f.label())
                    } else {
                        f
                    }
                })
                .collect();
            return Some(self.tuple(&types, &flags, *readonly));
        }
        // Its members are resolved on demand.
        Some(self.intern(TypeData::ReverseMapped {
            source,
            mapped: target,
            of,
        }))
    }

    /// `ObjectFlagsNonInferrableType`: `ty` is, or contains, `autoType`, `silentNeverType` or a
    /// literal checked without its context sensitive functions.
    pub(super) fn is_non_inferrable(&self, ty: TypeId, depth: u32) -> bool {
        if depth > 8 {
            return false;
        }
        match self.data(ty) {
            TypeData::Synth(shape) => {
                shape.literal == Literalness::Partial
                    || shape.literal == Literalness::JsxAttributes
                        && shape.props.iter().any(|p| {
                            matches!(p.source, PropSource::Copy(ty, ..) | PropSource::Type(ty)
                                if self.is_non_inferrable(ty, depth + 1))
                        })
            }
            TypeData::Intrinsic(
                Intrinsic::Auto | Intrinsic::SilentNever | Intrinsic::NonInferrableAny,
            ) => true,
            // `checkObjectLiteral` propagates the flag from the member types (`look_at_members`), and
            // `getWidenedTypeOfObjectLiteral` keeps it. The contextual type of a call is widened (`without_pattern_marks`).
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., object_flags, _),
                ..
            } if object_flags.contains(ObjectFlags::NON_INFERRABLE_TYPE) => true,
            TypeData::Anon {
                origin: Origin::WidenedLiteral(.., true),
                ..
            } => true,
            // `createDeferredTypeReference` sets no propagating flags.
            TypeData::Tuple {
                elems: TypeArguments::Given(list),
                ..
            }
            | TypeData::Ref {
                args: TypeArguments::Given(list),
                ..
            }
            | TypeData::Union(list)
            | TypeData::Intersection(list) => {
                list.iter().any(|&m| self.is_non_inferrable(m, depth + 1))
            }
            // `instantiateAnonymousType`: `objectFlags |=
            // getPropagatingFlagsOfTypes(aliasTypeArguments)`. A type substituted for a type
            // parameter in an anonymous type does not mark it, unless the anonymous type has an
            // alias and the substituted type is a type argument of the alias.
            TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. }
                if self
                    .types()
                    .mapping(*mapper)
                    .iter()
                    .any(|pair| self.is_non_inferrable(pair.1, depth + 1)) =>
            {
                self.alias_of_type(ty).is_some_and(|(_, type_arguments)| {
                    type_arguments
                        .iter()
                        .any(|&argument| self.is_non_inferrable(argument, depth + 1))
                })
            }
            _ => false,
        }
    }

    /// `isPartiallyInferableType`
    fn is_partially_inferable(&mut self, ty: TypeId) -> bool {
        if !self.is_non_inferrable(ty, 0) {
            return true;
        }
        match self.data(ty) {
            TypeData::Synth(shape) => shape.props.iter().any(|p| {
                let ty = self.type_of_prop(p, MapperId::IDENTITY);
                self.is_partially_inferable(ty)
            }),
            TypeData::Tuple { .. } => self
                .type_arguments(ty)
                .iter()
                .any(|&e| self.is_partially_inferable(e)),
            _ => false,
        }
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
        let Some(members) = self.members(source) else {
            return shape;
        };
        let adds_optional = self.mapped_optional_modifier(target) == MappedModifier::Add;
        let adds_readonly = self.mapped_origin(target).is_some_and(|(file, node, _)| {
            self.mapped_decl(file, node).readonly == MappedModifier::Add
        });
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
        shape
    }

    /// `getTypeOfReverseMappedSymbol` for the property `name` of the reverse mapped type `ty`.
    pub(super) fn type_of_reverse_mapped_prop(&mut self, ty: TypeId, name: Atom) -> TypeId {
        let TypeData::ReverseMapped { source, mapped, of } = *self.data(ty) else {
            return TypeId::UNRESOLVED;
        };
        let Some(members) = self.members(source) else {
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
        let keys = self.mapped_keys(target);
        let own = self.intern(TypeData::Keyof(of));
        // `keyof T & ("a" | "b")` is `keyof T & "a" | keyof T & "b"` by now, and the original form
        // is not recorded (`UnionType.origin`).
        let mut limits = Vec::new();
        for &part in self.parts(keys) {
            let TypeData::Intersection(members) = self.data(part) else {
                return None;
            };
            if !members.contains(&own) {
                return None;
            }
            let others: Vec<TypeId> = members.iter().copied().filter(|&m| m != own).collect();
            limits.push(self.intersection(&others));
        }
        let limited = self.union(&limits);
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
        if let Some(cached) = self.p.reverse_mapped_cache.get(&mut self.task, &key) {
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
            Ok(stored) => (self.p.reverse_mapped_cache).insert(&mut self.task, key, result, stored),
            Err(_) => result,
        }
    }

    /// `getRestTypeAtPosition`
    pub(super) fn rest_type_at_position(
        &mut self,
        params: &[SigParam],
        from: usize,
        readonly: bool,
    ) -> TypeId {
        // Position by position: `...args: [a: A, b?: B, ...c: C[]]` is equivalent to `a: A, b?: B,
        // ...c: C[]`.
        let mut elems = Parts::new();
        // `getNameableDeclarationAtPosition`: the name of each.
        let mut labels: SmallVec<[Atom; 8]> = SmallVec::new();
        let mut rest = None;
        let mut rest_label = Atom::NONE;
        for p in params {
            if !p.rest {
                elems.push(p.ty);
                labels.push(p.label());
                continue;
            }
            let TypeData::Tuple {
                flags: tf,
                readonly: tr,
                ..
            } = self.data(p.ty)
            else {
                rest = Some(if self.is_any(p.ty) {
                    self.array_of(p.ty)
                } else {
                    p.ty
                });
                rest_label = p.label();
                continue;
            };
            let te = self.type_arguments(p.ty);
            let fixed = tf
                .iter()
                .take_while(|f| !f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                .count();
            elems.extend_from_slice(&te[..fixed]);
            labels.extend(tf[..fixed].iter().map(|f| f.label()));
            if fixed < te.len() {
                rest_label = tf[fixed].label();
                let tail = self.normalized_tuple(&te[fixed..], &tf[fixed..], *tr);
                rest = Some(match self.data(tail) {
                    TypeData::Tuple { flags, .. }
                        if flags.len() == 1 && flags[0].contains(ElemFlags::REST) =>
                    {
                        let element = self.type_arguments(tail)[0];
                        self.array_of(element)
                    }
                    _ => tail,
                });
            }
        }
        // Parameters that need no argument are optional, regardless of which are declared with a
        // `?`.
        let min = self.min_argument_count(params);
        let mut flags: SmallVec<[ElemFlags; 8]> = (0..elems.len())
            .map(|i| {
                let flag = if i < min {
                    ElemFlags::REQUIRED
                } else {
                    ElemFlags::OPTIONAL
                };
                flag.with_label(labels[i])
            })
            .collect();
        if let Some(rest) = rest {
            if from == elems.len() {
                return rest;
            }
            if from > elems.len() {
                let element = self.indexed_access(rest, TypeId::NUMBER);
                return self.array_of(element);
            }
            elems.push(rest);
            flags.push(ElemFlags::VARIADIC.with_label(rest_label));
        }
        let from = from.min(elems.len());
        self.normalized_tuple(&elems[from..], &flags[from..], readonly)
    }

    /// `getBaseSignature`: `sig` with each of its type parameters replaced by its base constraint.
    pub fn base_sig(&mut self, sig: SigId) -> SigId {
        let params = self.sig_type_params(sig);
        if params.is_empty() {
            return sig;
        }
        let outer = self
            .sig_decl(sig)
            .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
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
            // `isObjectOrArrayLiteralType`
            let is_literal: SmallVec<[bool; 4]> = (0..candidates.len())
                .map(|i| {
                    c.array_literals.get(i) == Some(&true)
                        || self.is_object_literal_type(candidates[i])
                })
                .collect();
            if is_literal.contains(&true) {
                let mut literals: SmallVec<[TypeId; 4]> = SmallVec::new();
                let mut others: SmallVec<[TypeId; 4]> = SmallVec::new();
                for (&candidate, &literal) in candidates.iter().zip(&is_literal) {
                    if literal {
                        literals.push(candidate);
                    } else {
                        others.push(candidate);
                    }
                }
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
        // The type containing the signature has been instantiated. A clone already reflects that.
        let outer = if self.is_cloned_type_param(param) {
            MapperId::IDENTITY
        } else {
            n.sig
                .and_then(|sig| self.sig_decl(sig))
                .map_or(n.around, |(_, _, mapper)| mapper)
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
        if let Some(ty) = inferred {
            let constraint_with_this = self.type_with_this_argument(constraint, ty);
            if !compare(self, ty, constraint_with_this)
                && !self.satisfies_constraint_in_outer_context(n, ty, constraint, compare)
            {
                // An inference from the contextual return type alone is speculative anyway: the
                // part of it that satisfies the constraint is used.
                let filtered = if c.priority == PRIORITY_RETURN {
                    self.filter(ty, |k, m| compare(k, m, constraint_with_this))
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
            return MapperId::IDENTITY;
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
            return MapperId::IDENTITY;
        }
        self.types().mapper(pairs)
    }

    /// `context.mapper`, for what `ty` mentions (`InferenceTypeMapper.Map`).
    pub(super) fn fixing_mapper(&mut self, n: &mut Inference, ty: TypeId) -> MapperId {
        if !self.may_mention_type_parameter(ty) {
            return MapperId::IDENTITY;
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
            return MapperId::IDENTITY;
        }
        self.types().mapper(pairs)
    }

    /// `inferFromIntraExpressionSites`
    fn infer_from_intra_expression_sites(&mut self, n: &mut Inference) {
        for (file, e, ty) in std::mem::take(&mut n.intra_expression_inference_sites) {
            if let Some(contextual_type) =
                self.contextual_type(file, e, ContextFlags::NO_CONSTRAINTS)
            {
                let outside = n.array_literals.len();
                self.array_literal_types_in(file, e, &mut n.array_literals);
                self.infer(n, ty, contextual_type, 0);
                n.array_literals.truncate(outside);
            }
        }
    }

    /// `core.Some(n.inferences, hasInferenceCandidatesOrDefault)`
    pub(super) fn has_inference_candidates_or_default(&mut self, n: &Inference) -> bool {
        (0..n.params.len()).any(|i| {
            let c = &n.candidates[i];
            !c.covariant.is_empty() || !c.contravariant.is_empty() || self.has_default(n.params[i])
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

    /// `couldContainTypeVariables`: whether instantiating `ty` may map a type parameter.
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

/// What `inferToMultipleTypes` infers to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Multiple {
    Union,
    Intersection,
    /// The branches of a conditional type.
    Branches,
}
