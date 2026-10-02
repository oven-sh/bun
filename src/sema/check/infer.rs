//! Working out what type parameters stand for from a type that is given and a type that mentions them.
//!
//! Follows `internal/checker/inference.go` of TypeScript 7.0.2 function by function. The names in `backticks` at the head of
//! a function are the ones there. Left out: what the language service blocks, `wildcardType` (there is none here), and the
//! arity a spread argument implies for `[...T, ...U]`.

use super::*;
use smallvec::{SmallVec, smallvec};

/// The members of a union or an intersection while they are gone through.
pub(super) type Parts = SmallVec<[TypeId; 8]>;

/// From this many pairs on `Inference::visited` is looked up by `Inference::visited_index`.
const VISITED_INDEX_FROM: usize = 16;

// InferencePriority. The lower the better.
pub(super) const PRIORITY_NAKED: u32 = 1;
const PRIORITY_SPECULATIVE_TUPLE: u32 = 1 << 1;
const PRIORITY_SUBSTITUTE_SOURCE: u32 = 1 << 2;
pub(super) const PRIORITY_HOMOMORPHIC: u32 = 1 << 3;
/// The same, from a source with something left out of it.
pub(super) const PRIORITY_PARTIAL_HOMOMORPHIC: u32 = 1 << 4;
pub(super) const PRIORITY_MAPPED_CONSTRAINT: u32 = 1 << 5;
const PRIORITY_CONTRAVARIANT_CONDITIONAL: u32 = 1 << 6;
pub(super) const PRIORITY_RETURN: u32 = 1 << 7;
const PRIORITY_LITERAL_KEYOF: u32 = 1 << 8;
/// What a type parameter extends is not looked into.
pub(super) const PRIORITY_NO_CONSTRAINTS: u32 = 1 << 9;
/// As under strictFunctionTypes, whatever the options say.
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
    /// How far inside type arguments each of `covariant` was found. The deepest come first.
    depths: SmallVec<[u32; 4]>,
    pub contravariant: SmallVec<[TypeId; 4]>,
    /// Candidates of a worse priority are dropped.
    pub priority: u32,
    /// Every inference so far was to the parameter itself, not to something that contains it.
    pub top_level: bool,
    pub fixed: Option<TypeId>,
    /// `...args: T`: how many arguments there are for it.
    pub implied_arity: Option<usize>,
    /// `inferredType`: what `getInferredType` came to, until something changes that it rests on (`clearCachedInferences`). While it
    /// is worked out: what it is before what the parameter extends is looked at.
    inferred: std::cell::Cell<Option<TypeId>>,
}

/// `InferenceContext` and `InferenceState` in one.
#[derive(Clone)]
pub struct Inference {
    pub(super) params: SmallVec<[TypeId; 4]>,
    pub(super) candidates: SmallVec<[Candidate; 2]>,
    /// The signature the parameters belong to, for looking at where they occur in its return type.
    pub(super) sig: Option<SigId>,
    contra: bool,
    bivariant: bool,
    priority: u32,
    /// The best priority anything was inferred at since it was last reset.
    inference_priority: i32,
    visited: SmallVec<[(TypeId, TypeId, i32); 8]>,
    /// Where each pair is in `visited`, once there are `VISITED_INDEX_FROM` of them.
    visited_index: FxHashMap<(TypeId, TypeId), u32>,
    source_stack: SmallVec<[TypeId; 8]>,
    target_stack: SmallVec<[TypeId; 8]>,
    expanding: u8,
    depth: u32,
    calls: u32,
    /// The parameter type an inference started from.
    original_target: TypeId,
    /// The call is written in the body of what it calls: the type parameters in scope there are the ones being inferred.
    pub(super) calls_itself: bool,
    /// Where the call is written, until it has been asked whether a function around it took the type parameters over.
    pub(super) call_site: Option<(FileId, ExprId)>,
    /// What is inferred from has holes (`UNRESOLVED`) where something waits for its context or is not known yet: whatever
    /// holds one is no candidate (`ObjectFlagsNonInferrableType`).
    pub(super) leaves_out_unknown: bool,
    /// `calls_itself` or `leaves_out_unknown` has decided whether something became a candidate.
    pub(super) went_by_flags: bool,
    /// What is inferred from is what a binding pattern implies (`patternForType`).
    pub(super) from_pattern: bool,
    /// The types of the array literals in the arguments (`ObjectFlagsArrayLiteral`).
    pub(super) array_literals: Vec<TypeId>,
    /// `InferenceFlagsAnyDefault`: the call is written in a JavaScript file, where a parameter nothing is known of is `any`.
    pub(super) any_default: bool,
    /// What has been filled in around the signature that is inferred from. Those of its own type parameters that are not
    /// clones do not know, so what they extend has to be looked at through this.
    pub(super) around_source: MapperId,
    /// Without a signature, for `infer`: what has been filled in around the conditional type. What the parameters extend may
    /// mention it.
    around: MapperId,
    /// `getPermissiveInstantiation`, `getRestrictiveInstantiation`: the signatures are parts of such instantiations, compared under
    /// this relation. The type parameters declared around them stand in for the wildcard, or for type parameters that extend
    /// nothing: what they are declared to extend is not resolved.
    pub(super) stand_ins: Option<super::relate::Relation>,
    /// The type parameters of the signature that is inferred from, which are no stand-ins.
    pub(super) own_of_source: SmallVec<[TypeId; 4]>,
    /// `propagationType`: the stand-in for the wildcard that is inferred for every type parameter in the target.
    propagated: Option<TypeId>,
    /// The members of a literal are being checked that `getApparentTypeOfContextualType` has no type for under
    /// `ContextFlagsNoConstraints`: `inferFromIntraExpressionSites` infers nothing from them.
    pub(super) skip_intra_expression_sites: bool,
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
            calls_itself: false,
            call_site: None,
            leaves_out_unknown: false,
            went_by_flags: false,
            from_pattern: false,
            array_literals: Vec::new(),
            any_default: false,
            around_source: MapperId::IDENTITY,
            around: MapperId::IDENTITY,
            stand_ins: None,
            own_of_source: SmallVec::new(),
            propagated: None,
            skip_intra_expression_sites: false,
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

impl<'p> Checker<'p> {
    /// What `params` are if `source` is to fit `target`. For `infer` in conditional types.
    pub fn infer_from_types(
        &mut self,
        params: &[TypeId],
        source: TypeId,
        target: TypeId,
        around: MapperId,
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
            .map(|i| self.inferred_type(&inference, i))
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

    /// `inferTypes`. `contra`: `target` is something that is taken, not given.
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
        self.infer_types(n, source, target);
    }

    /// `inferFromTypes`
    fn infer_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        if !self.has_type_variables(target) || self.is_no_infer(target) {
            return;
        }
        let (mut source, mut target) = (self.force(source), self.force(target));
        // What is expected of the result may have holes where the calls around have nothing to go by yet.
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
        // The members of `source` and of `target` in order, if they are unions none of whose members paired off.
        let (mut source_in_order, mut target_in_order): (Option<Parts>, Option<Parts>) =
            (None, None);
        match self.data(target) {
            TypeData::Union(_) => {
                // `never` is a source like any other, not a union of nothing.
                let mut sources: Parts = if source.is_never() {
                    smallvec![source]
                } else {
                    self.sorted_parts(source)
                };
                let mut targets = self.sorted_parts(target);
                let (whole_source, whole_target) = (source, target);
                let (source_count, target_count) = (sources.len(), targets.len());
                // Members that are the same on both sides pair off (`isTypeOrBaseIdenticalTo`), then those made from the same
                // generic type or alias (`isTypeCloselyMatchedBy`).
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
                    // From `string` to `string | T`: better `string` for `T` than what `T` extends.
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
                    .all(|&t| self.is_object_type(t) && !self.is_generic_mapped(t)) =>
            {
                // From `string[] & { extra: any }` to `string[] & T`: `{ extra: any }` for `T`. But to `string[] & Iterable<T>` the
                // `string[]` stays, and gives `string` for `T`.
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
                // A parameter says nothing about itself, unless it is the caller's as well. It still counts as an inference made.
                if source == target {
                    if !n.calls_itself
                        && let Some((file, call)) = n.call_site.take()
                    {
                        n.calls_itself = self.is_type_param_adopted_around(file, call, target);
                    }
                    if !n.calls_itself {
                        n.inference_priority = n.inference_priority.min(n.priority as i32);
                        return;
                    }
                    n.went_by_flags = true;
                }
                // `ObjectFlagsNonInferrableType`: what has something left out of it is no candidate.
                if self.is_non_inferrable(source, 0) {
                    return;
                }
                if n.leaves_out_unknown && !self.is_known(source) {
                    n.went_by_flags = true;
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
        // Nothing is inferred to a type parameter that is not inferred for. tsgo finds that out from `getApparentType` of a source
        // whose type parameters extend nothing.
        if n.stand_ins.is_some() && self.is_type_param(target) {
            return;
        }
        match (self.data(source), self.data(target)) {
            // Two that are both put off go by way of `invokeOnce`, or it might never end.
            (
                TypeData::Ref {
                    target: st,
                    args: sa,
                },
                TypeData::Ref {
                    target: tt,
                    args: ta,
                },
            ) if (st == tt || self.is_array(source) && self.is_array(target))
                && !(self.has_lazy_alias(sa) && self.has_lazy_alias(ta)) =>
            {
                self.infer_from_type_arguments_of(n, *st, sa, ta);
            }
            (
                TypeData::Tuple {
                    elems: se,
                    flags: sf,
                    readonly: sr,
                },
                TypeData::Tuple {
                    elems: te,
                    flags: tf,
                    readonly: tr,
                },
            ) if sf == tf && sr == tr && !(self.has_lazy_alias(se) && self.has_lazy_alias(te)) => {
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
                if self.is_generic_mapped(source) && self.is_generic_mapped(target) {
                    self.invoke_once(n, source, target, Self::infer_from_generic_mapped_types);
                }
                if let Some(relation) = n.stand_ins
                    && let Some(others) = self.without_stand_ins(n, source)
                {
                    // `source == c.wildcardType`: it is inferred for every type parameter in `target`.
                    if relation == super::relate::Relation::Permissive {
                        if n.propagated.is_none() {
                            n.propagated = Some(source);
                            self.infer_types(n, target, target);
                            n.propagated = None;
                        }
                        return;
                    }
                    // `getApparentType` makes `{}` of a type parameter that extends nothing.
                    if others.is_empty() {
                        return;
                    }
                    source = self.intersection(&others);
                }
                if !(n.priority & PRIORITY_NO_CONSTRAINTS != 0
                    && (matches!(self.data(source), TypeData::Intersection(_))
                        || self.is_instantiable(source)))
                {
                    let apparent = self.apparent_type_for_relation(source);
                    // What a type parameter extends can be anything.
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

    /// The members of `source` that are no stand-ins (`Inference::stand_ins`), if `source` is one or is an intersection with one.
    fn without_stand_ins(&self, n: &Inference, source: TypeId) -> Option<Parts> {
        let is_stand_in = |p: TypeId| self.is_type_param(p) && !n.own_of_source.contains(&p);
        match self.data(source) {
            TypeData::Intersection(parts) if parts.iter().any(|&p| is_stand_in(p)) => {
                Some(parts.iter().copied().filter(|&p| !is_stand_in(p)).collect())
            }
            _ if is_stand_in(source) => Some(Parts::new()),
            _ => None,
        }
    }

    fn is_generic_mapped(&mut self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            }
        ) && self.is_generic(ty)
    }

    /// Stands for `TypeReference.node != nil` (`isDeferredTypeReferenceNode`): one of `args` is, or is a choice of, an alias
    /// that is looked up when it is needed.
    fn has_lazy_alias(&self, args: &[TypeId]) -> bool {
        args.iter().any(|&a| match self.data(a) {
            TypeData::LazyAlias { .. } => true,
            TypeData::Union(parts) | TypeData::Intersection(parts) => self.has_lazy_alias(parts),
            _ => false,
        })
    }

    /// What `inferFromTypes` does once it has found the type parameter `target` is.
    fn add_candidate(
        &mut self,
        n: &mut Inference,
        index: usize,
        candidate: TypeId,
        target: TypeId,
    ) {
        if self.trace_relations {
            eprintln!(
                "CANDIDATE for {index}: {:?} priority {} fixed {:?}",
                self.data(candidate),
                n.priority,
                n.candidates[index].fixed
            );
        }
        if n.candidates[index].fixed.is_none() {
            let (priority, contra, depth) = (n.priority, n.contra && !n.bivariant, n.depth);
            let c = &mut n.candidates[index];
            if priority < c.priority {
                c.covariant.clear();
                c.depths.clear();
                c.contravariant.clear();
                c.top_level = true;
                c.priority = priority;
            }
            if priority == c.priority {
                // Contravariant only where nothing on the way went both ways.
                if contra {
                    if !c.contravariant.contains(&candidate) {
                        c.contravariant.push(candidate);
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

    /// The members of a union in the order TypeScript goes through them, as `parts_in_order` gives them.
    pub(super) fn sorted_parts(&self, ty: TypeId) -> Parts {
        let mut parts = Parts::from_slice(self.parts(ty));
        if parts.len() > 1 {
            parts.sort_by(|&a, &b| self.compare_types(a, b));
        }
        parts
    }

    /// `inferFromTypeArguments`, between two instantiations of `of`.
    fn infer_from_type_arguments_of(
        &mut self,
        n: &mut Inference,
        of: Sym,
        sources: &[TypeId],
        targets: &[TypeId],
    ) {
        if let Some(known) = self.p.variances.get_ref(&of) {
            return self.infer_from_type_arguments(n, sources, targets, known);
        }
        let variances = self.variances_of(of);
        self.infer_from_type_arguments(n, sources, targets, &variances);
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

    /// `invokeOnce`: not twice between the same two types, and not on and on between instantiations of the same two.
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

    /// `inferFromMatchingTypes`: infers between the pairs that `matches`, and leaves the members that are in no pair.
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
        let keep_unmatched = |list: &mut Parts, matched: &[bool]| {
            let mut next = 0;
            list.retain(|_| {
                next += 1;
                !matched[next - 1]
            });
        };
        keep_unmatched(sources, &matched_sources[..]);
        keep_unmatched(targets, &matched_targets[..]);
    }

    /// `inferToMultipleTypes`. `sources_in_order`: the members of `source` in order, or `source` alone if it is no union, if that is
    /// at hand.
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
            // First to what is not a type parameter on its own, keeping track of the sources something as good as what a type
            // parameter on its own would get was inferred from.
            for &t in targets {
                if n.index_of(t).is_some() {
                    naked = t;
                    type_variable_count += 1;
                    continue;
                }
                for (i, &s) in sources.iter().enumerate() {
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
            // One type parameter on its own, and everything was gone through: it is what nothing was inferred from.
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
        // To a type parameter on its own last, and for less: from `Promise<string>` to `T | Promise<T>` it is `string` that is
        // wanted for `T`. In an intersection, only if there is one.
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
        let matches = match self.data(source) {
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => self.template_pieces(&[*value], &[], texts, types),
            TypeData::Template {
                texts: st,
                types: sy,
            } => self.template_pieces(st, sy, texts, types),
            _ => None,
        };
        // Nothing but placeholders, and no match: `never` for each, so that what comes of it fits nothing. What they extend,
        // `string`, would fit.
        if matches.is_none()
            && !texts
                .iter()
                .all(|&t| self.files().atoms.bytes(t).is_empty())
        {
            return;
        }
        for (i, &target) in types.iter().enumerate() {
            let source = matches.as_ref().map_or(TypeId::NEVER, |m| m[i]);
            // A piece of a string for a type parameter that extends `number`, say: the number it spells.
            if let TypeData::StringLit { value, .. } = *self.data(source)
                && let Some(index) = n.index_of(target)
                && let Some(constraint) = self.base_constraint_of(n.params[index])
                && !self.is_any(constraint)
                && !self.some_type(constraint, |_, m| m == TypeId::STRING)
                && let Some(spelled) = self.literal_spelled_by(value, source, constraint)
            {
                self.infer_types(n, spelled, target);
                continue;
            }
            self.infer_types(n, source, target);
        }
    }

    /// The member of `constraint` the text `value` is best taken for. The `choose` closure of `inferToTemplateLiteralType`.
    fn literal_spelled_by(
        &mut self,
        value: Atom,
        source: TypeId,
        constraint: TypeId,
    ) -> Option<TypeId> {
        let text = self.files().atoms.text(value).into_owned();
        let number = text
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && self.files().atoms.text(self.number_name(*v)) == text);
        // `isValidBigIntString(text, roundTripOnly)`: just what a bigint prints as.
        let negative = text.starts_with('-');
        let digits = text.strip_prefix('-').unwrap_or(&text);
        let is_bigint = !digits.is_empty()
            && digits.bytes().all(|b| b.is_ascii_digit())
            && if digits == "0" {
                !negative
            } else {
                !digits.starts_with('0')
            };
        // In order of preference.
        let rank = |c: &mut Self, t: TypeId| -> Option<(u32, TypeId)> {
            match c.data(t) {
                TypeData::Template { texts, types } => c
                    .is_matched_by_template(source, texts, types)
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
                    let written = c.files().atoms.intern(digits.as_bytes());
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
                } => (is_bigint
                    && *minus == negative
                    && c.files().atoms.bytes(*written) == digits.as_bytes())
                .then_some((6, t)),
                TypeData::BoolLit { value: v, .. } => {
                    (text == if *v { "true" } else { "false" }).then_some((7, t))
                }
                _ if t.is_undefined() => (text == "undefined").then_some((8, t)),
                _ if t.is_null() => (text == "null").then_some((9, t)),
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

    /// `createEmptyObjectTypeFromStringLiteral`: an object with the properties named, each `any`.
    fn empty_object_type_from_string_literal(&mut self, ty: TypeId) -> TypeId {
        let mut shape = Shape::default();
        // A string enum member can have the value of another member or of a string literal.
        let mut names = crate::util::FxHashSet::default();
        for &t in self.parts(ty) {
            if let Some(value) = self.string_literal_value(t)
                && names.insert(value)
            {
                shape.props.push(Prop {
                    name: value,
                    flags: PropFlags::empty(),
                    source: PropSource::Type(TypeId::ANY),
                    mapper: MapperId::IDENTITY,
                });
            }
        }
        if ty == TypeId::STRING {
            shape
                .index
                .push(IndexInfo::new(TypeId::STRING, TypeId::EMPTY_OBJECT, false));
        }
        self.synth(shape)
    }

    // ───────────────────────────── objects ─────────────────────────────

    /// `inferFromObjectTypes`
    fn infer_from_object_types(&mut self, n: &mut Inference, source: TypeId, target: TypeId) {
        if let (
            TypeData::Ref {
                target: st,
                args: sa,
            },
            TypeData::Ref {
                target: tt,
                args: ta,
            },
        ) = (self.data(source), self.data(target))
            && (st == tt || self.is_array(source) && self.is_array(target))
        {
            self.infer_from_type_arguments_of(n, *st, sa, ta);
            return;
        }
        // Tuples of one make are references to one generic type as well.
        if let (
            TypeData::Tuple {
                elems: se,
                flags: sf,
                readonly: sr,
            },
            TypeData::Tuple {
                elems: te,
                flags: tf,
                readonly: tr,
            },
        ) = (self.data(source), self.data(target))
            && sf == tf
            && sr == tr
        {
            self.infer_from_type_arguments(n, se, te, &[]);
            return;
        }
        if self.is_generic_mapped(source) && self.is_generic_mapped(target) {
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
        // Only if the two may have to do with each other.
        if self.types_definitely_unrelated(source, target) {
            return;
        }
        if self.is_array_or_tuple(source) {
            if let TypeData::Tuple { elems, flags, .. } = self.data(target) {
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
                TypeData::Tuple { elems, flags, .. } => (elems, flags, true),
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
        let fixed_length = |flags: &[ElemFlags]| {
            flags
                .iter()
                .position(|f| f.intersects(variable))
                .unwrap_or(flags.len())
        };
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
                    // `[...T, ...U]`: `T` takes as much of the source as there are arguments for it.
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
                    // `[...T, ...rest]`: if `T` extends a tuple of a fixed size, that is how much of the source it takes.
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
                // One variadic element: what lies between the fixed parts of the source. A guess if the target ends in optional ones.
                let priority = if element_flags[target_arity - 1].contains(ElemFlags::OPTIONAL) {
                    PRIORITY_SPECULATIVE_TUPLE
                } else {
                    0
                };
                let slice = self.slice_tuple(source_elems, source_flags, start_length, end_length);
                self.infer_with_priority(n, slice, element_types[start_length], priority);
            } else if middle_length == 1 && element_flags[start_length].contains(ElemFlags::REST) {
                if let Some(rest) =
                    self.element_type_of_slice(source_elems, source_flags, start_length, end_length)
                {
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
        let fixed = flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
            .unwrap_or(flags.len());
        if index > fixed {
            // `getRestArrayTypeOfTupleType`: an array of all there is from the first element without a fixed place on.
            return match self.element_type_of_slice(elems, flags, fixed, 0) {
                Some(rest) => self.array_of(rest),
                None => self.tuple(&[], &[], false),
            };
        }
        if index >= end {
            return self.tuple(&[], &[], false);
        }
        self.normalized_tuple(&elems[index..end], &flags[index..end], false)
    }

    /// `getElementTypeOfSliceOfTupleType`
    fn element_type_of_slice(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        index: usize,
        end_skip_count: usize,
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
        Some(self.union(&types))
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
            let fixed_length = |f: &[ElemFlags]| {
                f.iter()
                    .position(|f| f.intersects(variable))
                    .unwrap_or(f.len())
            };
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
                let wanted = self.type_of_prop(tp, tm.mapper);
                if self.is_unit(wanted) {
                    let given = self.type_of_prop(sp, source_mapper);
                    if !(self.is_any(given)
                        || self.with_freshness(given, false) == self.with_freshness(wanted, false))
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
            // A `NoInfer<T>` written there is still that.
            let wanted = self.type_of_prop(tp, tm.mapper);
            if !self.has_type_variables(wanted) || self.is_no_infer(wanted) {
                continue;
            }
            // `removeMissingType`, as `type_of_prop_as_read` does it.
            let wanted = if !tp.flags.contains(PropFlags::OPTIONAL) {
                wanted
            } else if self.p.files.options.exact_optional_property_types {
                self.remove_missing_type(wanted, true)
            } else {
                self.optional(wanted)
            };
            let Some((sp, source_mapper)) = self.property_in(&sm, tp.name) else {
                continue;
            };
            let given = self.type_of_prop_as_read(sp, source_mapper);
            self.infer_types(n, given, wanted);
        }
    }

    /// `getTypeOfSymbol` of a property: what stands for its being left out is in it.
    fn type_of_prop_or_missing(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let ty = self.type_of_prop(prop, mapper);
        if prop.flags.contains(PropFlags::OPTIONAL) {
            self.optional_property(ty)
        } else {
            ty
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
        // `returnOnlyType`: a function that waits for its context, kept for what it returns.
        let return_only = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::Partial);
        // From the bottom up. If the source has fewer, its first does for the rest of the target's.
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

    /// `instantiate_sig(sig, mapper)`, where `sig` is the only call (or construct) signature among the members of `ty` and `mapper`
    /// is what they come with. `signatures` keeps it for an object type that is looked into as it stands.
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

    /// The heart of `instantiateTypeWithSingleGenericCallSignature`. `generic` is given where `contextual`, which is not generic,
    /// is expected, by a function that returns a function. If what it says of the type parameters being inferred is news, it
    /// says it in terms of its own type parameters, which then become those of the function returned.
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
        // `target.declaration`: the signature of a union is declared where the first it stands for is.
        let is_method = match self.sig_decl(self.p.types.sig_origin(target)) {
            Some((file, func, _)) => matches!(
                self.hir(file)[func].kind,
                FnKind::Method | FnKind::Constructor
            ),
            None => false,
        };
        // The target's own type parameters are nobody's business. They may be the very declarations that are being
        // inferred: the members of what `flat` returns include `flat`.
        let target = self.erased_sig(target);
        if !return_only {
            // Once through a signature that goes both ways, everything further in does.
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

    /// `applyToParameterTypes`: the pairs it goes through.
    fn parameter_type_pairs(
        &mut self,
        source: SigId,
        target: SigId,
    ) -> SmallVec<[(TypeId, TypeId); 8]> {
        let (sp, tp) = (self.sig_params(source), self.sig_params(target));
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
            // For a `const` type parameter that need not be an array that can be written to, the rest is not one.
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

    /// `applyToReturnTypes`: the pair it goes through, if any. What the source tests or returns is asked only if it is needed.
    fn return_type_pair(&mut self, source: SigId, target: SigId) -> Option<(TypeId, TypeId)> {
        if let Some(t) = self.sig_predicate(target)
            && let Some(s) = self.sig_predicate(source)
            // `typePredicateKindsMatch`
            && (t.asserts, t.param) == (s.asserts, s.param)
            && let (Some(st), Some(tt)) = (s.ty, t.ty)
        {
            return Some((st, tt));
        }
        // A `NoInfer<T>` written there is still that.
        let wanted = self.sig_return(target);
        if !self.has_type_variables(wanted) {
            return None;
        }
        Some((self.sig_return(source), wanted))
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
        // What is known to have nothing but what is seen has an index signature for it. `inferFromTypes` has put
        // `getApparentType(source)` for the source, unless what type parameters extend is to be left out of it.
        let looks = if n.priority & PRIORITY_NO_CONSTRAINTS != 0 {
            source
        } else {
            self.apparent_type_of_intersection(source)
        };
        if self.is_object_type_with_inferable_index(looks) {
            for info in &tm.shape().index {
                let wanted = self.instantiate(info.value, tm.mapper);
                if !self.has_type_variables(wanted) {
                    continue;
                }
                let mut types = Parts::new();
                for prop in &sm.shape().props {
                    if self.is_name_applicable_to_index(prop.name, info.key) {
                        // What is there if the property is.
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
                    self.infer_with_priority(n, all, wanted, priority);
                }
            }
        }
        for info in &tm.shape().index {
            let wanted = self.instantiate(info.value, tm.mapper);
            if self.has_type_variables(wanted)
                && let Some(given) = self.applicable_index_info(&sm, info.key, None)
            {
                self.infer_with_priority(n, given, wanted, priority);
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
                // `{ [P in keyof T]: X }`: work out what it was made from, and infer from that to `T`, for less than what is
                // inferred to `T` directly, and for less still if it is only part of the answer.
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
                    // `patternForType`, `IndexFlagsNoIndexSignatures`: the `...rest` of a pattern is no key.
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
                // `X` is what the properties of the source hold.
                let Some(sm) = self.members(source) else {
                    return true;
                };
                let mut types: Vec<TypeId> = sm
                    .shape()
                    .props
                    .iter()
                    .map(|p| self.type_of_prop_or_missing(p, sm.mapper))
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

    /// `createReverseMappedType`: what `{ [P in keyof T]: X }` was made from to come out as `source`.
    pub(super) fn reverse_mapped_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        of: TypeId,
    ) -> Option<TypeId> {
        let members = self.members(source)?;
        // It takes a string index signature, or properties that are not all left out.
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
            let readonly = self.is_global_ref(source, known::ReadonlyArray).is_some();
            return Some(if readonly {
                self.readonly_array_of(element)
            } else {
                self.array_of(element)
            });
        }
        if let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = self.data(source)
        {
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
        // What is in it is worked out when it is asked for.
        Some(self.intern(TypeData::ReverseMapped {
            source,
            mapped: target,
            of,
        }))
    }

    /// `ObjectFlagsNonInferrableType`: `ty` is, or holds, `autoType`, `silentNeverType` or a literal looked at without the functions
    /// in it that wait for their context.
    pub(super) fn is_non_inferrable(&self, ty: TypeId, depth: u32) -> bool {
        if depth > 8 {
            return false;
        }
        match self.data(ty) {
            TypeData::Synth(shape) => shape.literal == Literalness::Partial,
            TypeData::Intrinsic(Intrinsic::Auto | Intrinsic::SilentNever) => true,
            TypeData::Tuple { elems: list, .. }
            | TypeData::Ref { args: list, .. }
            | TypeData::Union(list)
            | TypeData::Intersection(list) => {
                list.iter().any(|&m| self.is_non_inferrable(m, depth + 1))
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
            TypeData::Tuple { elems, .. } => elems.iter().any(|&e| self.is_partially_inferable(e)),
            _ => false,
        }
    }

    /// `resolveReverseMappedTypeMembers`. The types of the properties are worked out along with it.
    pub(super) fn build_reverse_mapped_shape(
        &mut self,
        source: TypeId,
        target: TypeId,
        of: TypeId,
    ) -> Shape {
        let mut shape = Shape::default();
        let Some(members) = self.members(source) else {
            return shape;
        };
        let adds_optional = self.mapped_optional_modifier(target) == MappedModifier::Add;
        let adds_readonly = self.mapped_origin(target).is_some_and(|(file, node, _)| {
            self.mapped_decl(file, node).readonly == MappedModifier::Add
        });
        let limited = self.limited_constraint(target, of);
        // `{ [P in keyof T[K]]: X }` was made from the same as `{ [P in keyof T]: X }`. Said so, fewer types come of it.
        let mut for_props = (target, of);
        if let TypeData::IndexedAccess { obj, index, .. } = *self.data(of)
            && matches!(self.data(obj), TypeData::TypeParam(..))
            && matches!(self.data(index), TypeData::TypeParam(..))
        {
            // `replaceIndexedAccess`: `[T][0]` is `T`.
            let zero = self.number_literal(0.0, false);
            let one = self.tuple(&[obj], &[ElemFlags::REQUIRED], false);
            let mapper = self.mapper_from(&[index, obj], &[zero, one]);
            let replaced = self.instantiate(target, mapper);
            if self.mapped_origin(replaced).is_some() {
                for_props = (replaced, obj);
            }
        }
        for prop in &members.shape().props {
            // What the rest of the constraint does not let through would not have come through the mapping.
            if let Some(limited) = limited
                && let Some(key) = self.key_type_of_name(prop.name)
                && !self.is_assignable(key, limited)
            {
                continue;
            }
            let ty = self.type_of_prop_or_missing(prop, members.mapper);
            let ty = self
                .infer_reverse_mapped_type(ty, for_props.0, for_props.1)
                .unwrap_or(TypeId::UNKNOWN);
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
                source: Self::copy_of(ty, &[prop], false),
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

    /// `getLimitedConstraint`: of `{ [P in keyof T & K]: X }`, the `K`.
    fn limited_constraint(&mut self, target: TypeId, of: TypeId) -> Option<TypeId> {
        let keys = self.mapped_keys(target);
        let own = self.intern(TypeData::Keyof(of));
        // `keyof T & ("a" | "b")` is `keyof T & "a" | keyof T & "b"` by now, and does not remember (`UnionType.origin`).
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
            Some(self.regular_object(inferred))
        } else {
            None
        };
        self.reverse_mapped_source_stack.pop();
        self.reverse_mapped_target_stack.pop();
        self.reverse_expanding = saved;
        result
    }

    /// The parameters from `from` on, as the tuple a rest parameter would collect them in.
    pub fn params_as_tuple(&mut self, params: &[SigParam], from: usize) -> TypeId {
        self.rest_type_at_position(params, from, false)
    }

    /// `getRestTypeAtPosition`
    fn rest_type_at_position(
        &mut self,
        params: &[SigParam],
        from: usize,
        readonly: bool,
    ) -> TypeId {
        // Position by position: `...args: [a: A, b?: B, ...c: C[]]` is as good as `a: A, b?: B, ...c: C[]`.
        let mut elems = Parts::new();
        // `getNameableDeclarationAtPosition`: what each is called.
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
                elems: te,
                flags: tf,
                readonly: tr,
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
                    TypeData::Tuple { elems, flags, .. }
                        if elems.len() == 1 && flags[0].contains(ElemFlags::REST) =>
                    {
                        let element = elems[0];
                        self.array_of(element)
                    }
                    _ => tail,
                });
            }
        }
        // Those that can go without an argument may be missing, whatever is written with a `?`.
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

    /// `getBaseSignature`: `sig` with each of its type parameters, declared or adopted, replaced by its base constraint.
    pub fn base_sig(&mut self, sig: SigId) -> SigId {
        let mut params = self.sig_type_params(sig);
        if params.is_empty() {
            params = self.adopted_type_params(sig).into();
        }
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
        // As often as it takes for those that depend on one another to come down to what is outside; what still goes round is `any`.
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
        let SigData::Decl { file, func, mapper } = *self.p.types.sig(sig) else {
            return Vec::new();
        };
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
        let contextual = self.contextual_signature(file, func);
        self.eager.pop();
        let Some(contextual) = contextual else {
            return Vec::new();
        };
        let mut params = self.sig_type_params(contextual).into_vec();
        params.retain(|&param| self.p.types.map(mapper, param).is_none());
        params
    }

    /// `cloneTypeParameter`: `param` is that of a signature found in something instantiated. What it extends and defaults to
    /// comes with what is around the signature filled in; for any other that is still to be done.
    fn is_cloned_type_param(&self, param: TypeId) -> bool {
        matches!(*self.data(param), TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY)
    }

    // ───────────────────────────── conclusions ─────────────────────────────

    /// `hasPrimitiveConstraint`, of a type parameter that extends `constraint`.
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
    pub fn common_supertype(&mut self, types: &[TypeId]) -> TypeId {
        self.common_supertype_under(types, None)
    }

    /// `getCommonSupertype`. `stand_ins`: `stand_ins_among` the types.
    fn common_supertype_under(
        &mut self,
        types: &[TypeId],
        stand_ins: Option<super::relate::Relation>,
    ) -> TypeId {
        if types.len() == 1 {
            return types[0];
        }
        // What can be missing is set aside, and put back at the end.
        let is_nullable = |m: TypeId| m.is_undefined() || m.is_null();
        let primary: Parts = if self.p.files.options.strict_null_checks {
            types
                .iter()
                .map(|&t| self.filter(t, |_, m| !is_nullable(m)))
                .collect()
        } else {
            Parts::from_slice(types)
        };
        // Literals of one primitive stay a union. Otherwise the leftmost that nothing to its right is a supertype of.
        let supertype = if self.literal_types_with_same_base_type(&primary) {
            self.union(&primary)
        } else {
            self.single_common_supertype(&primary, stand_ins)
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
    fn single_common_supertype(
        &mut self,
        types: &[TypeId],
        stand_ins: Option<super::relate::Relation>,
    ) -> TypeId {
        // Which is a subtype of which goes by what type parameters extend.
        if let Some(relation) = stand_ins {
            let mut candidate = types[0];
            for &t in &types[1..] {
                if self.related(candidate, t, relation) {
                    candidate = t;
                }
            }
            return candidate;
        }
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

    /// `getCommonSubtype`: the leftmost that nothing to its right is a subtype of. `stand_ins`: `stand_ins_among` the types.
    fn common_subtype(
        &mut self,
        types: &[TypeId],
        stand_ins: Option<super::relate::Relation>,
    ) -> TypeId {
        let relation = stand_ins.unwrap_or(super::relate::Relation::Subtype);
        let mut best = types[0];
        for &t in &types[1..] {
            if self.related(t, best, relation) {
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

    /// `Inference::stand_ins`, if there is a type parameter in `types`.
    fn stand_ins_among(&self, n: &Inference, types: &[TypeId]) -> Option<super::relate::Relation> {
        n.stand_ins
            .filter(|_| types.iter().any(|&t| self.has_type_variables(t)))
    }

    /// `getUnionType(types, UnionReductionSubtype)` where there are stand-ins. Which member is a subtype of which goes by what type
    /// parameters extend, so `relation` decides (`Inference::stand_ins`).
    fn union_reduced_under(
        &mut self,
        types: &[TypeId],
        relation: super::relate::Relation,
    ) -> TypeId {
        let union = self.union(types);
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        // `removeSubtypes` goes through the members from the last.
        let mut kept = Parts::from_slice(members);
        for i in (0..kept.len()).rev() {
            let source = kept[i];
            if (0..kept.len()).any(|j| j != i && self.related(source, kept[j], relation)) {
                kept.remove(i);
            }
        }
        if kept.len() == members.len() {
            union
        } else {
            self.union(&kept)
        }
    }

    /// `getCovariantInference`, and what `param` extends. `stand_ins`: `stand_ins_among` the candidates.
    fn covariant_inference(
        &mut self,
        c: &Candidate,
        param: TypeId,
        sig: SigId,
        is_fixed: bool,
        array_literals: &[TypeId],
        stand_ins: Option<super::relate::Relation>,
    ) -> (TypeId, Option<TypeId>) {
        // `unionObjectAndArrayLiteralCandidates`: the object and array literals count as one, after the others.
        let mut candidates = c.covariant.clone();
        if candidates.len() > 1 {
            let is_literal =
                |c: &Self, t: TypeId| c.is_object_literal_type(t) || array_literals.contains(&t);
            let literals: SmallVec<[TypeId; 4]> = candidates
                .iter()
                .copied()
                .filter(|&t| is_literal(self, t))
                .collect();
            if !literals.is_empty() {
                candidates.retain(|t| !is_literal(self, *t));
                candidates.push(self.union_reduced(&literals));
            }
        }
        // Literals are widened if every inference was to the type parameter itself, it does not extend anything primitive, and
        // it was settled early or is not what is returned.
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
            self.common_supertype_under(&candidates, stand_ins)
        } else if let Some(relation) = stand_ins {
            self.union_reduced_under(&candidates, relation)
        } else {
            self.union_reduced(&candidates)
        };
        (self.regular_object(unwidened), constraint)
    }

    /// `context.compareTypes`, and `isTypeAssignableTo` between what is inferred.
    fn is_inferred_assignable(&mut self, n: &Inference, source: TypeId, target: TypeId) -> bool {
        let relation = self
            .stand_ins_among(n, &[source, target])
            .unwrap_or(super::relate::Relation::Assignable);
        self.related(source, target, relation)
    }

    /// What parameter `index` is, going by what has been seen so far. Does not settle it.
    pub(super) fn inferred_type(&mut self, n: &Inference, index: usize) -> TypeId {
        self.get_inferred_type(n, index, false)
    }

    /// `getInferredType`. `is_fixed`: it is being settled, because something has to know it before everything has been seen.
    fn get_inferred_type(&mut self, n: &Inference, index: usize, is_fixed: bool) -> TypeId {
        let c = &n.candidates[index];
        if let Some(fixed) = c.fixed {
            return fixed;
        }
        if let Some(inferred) = c.inferred.get() {
            return inferred;
        }
        let inferred = self.get_inferred_type_anew(n, index, is_fixed);
        n.candidates[index].inferred.set(Some(inferred));
        inferred
    }

    fn get_inferred_type_anew(&mut self, n: &Inference, index: usize, is_fixed: bool) -> TypeId {
        let c = &n.candidates[index];
        let param = n.params[index];
        // What the signature was found in has been filled in. A clone knows.
        let outer = if self.is_cloned_type_param(param) {
            MapperId::IDENTITY
        } else {
            n.sig
                .and_then(|sig| self.sig_decl(sig))
                .map_or(n.around, |(_, _, mapper)| mapper)
        };
        let mut inferred = None;
        let mut fallback = None;
        // What `param` extends, if that has been asked.
        let mut extended = None;
        if let Some(sig) = n.sig {
            let covariant = if c.covariant.is_empty() {
                None
            } else {
                let stand_ins = self.stand_ins_among(n, &c.covariant);
                let (covariant, constraint) =
                    self.covariant_inference(c, param, sig, is_fixed, &n.array_literals, stand_ins);
                extended = Some(constraint);
                Some(covariant)
            };
            let contravariant = if c.contravariant.is_empty() {
                None
            } else if c.priority & PRIORITY_IMPLIES_COMBINATION != 0 {
                Some(self.intersection(&c.contravariant))
            } else {
                let stand_ins = self.stand_ins_among(n, &c.contravariant);
                Some(self.common_subtype(&c.contravariant, stand_ins))
            };
            if covariant.is_some() || contravariant.is_some() {
                // The covariant one, unless it is `never` or `any`, or is one of several that do not agree, or fits nowhere the
                // parameter is consumed, or something inferred for a parameter that extends this one does not fit it.
                let prefer_covariant = match (covariant, contravariant) {
                    (Some(_), None) => true,
                    (None, _) => false,
                    (Some(co), Some(_)) => {
                        !co.is_never()
                            && !self.is_any(co)
                            && c.contravariant
                                .iter()
                                .any(|&t| self.is_inferred_assignable(n, co, t))
                            && (0..n.params.len()).all(|other| {
                                other != index
                                    && self.constraint_of_type_param(n.params[other]) != Some(param)
                                    || n.candidates[other]
                                        .covariant
                                        .iter()
                                        .all(|&t| self.is_inferred_assignable(n, t, co))
                            })
                    }
                };
                (inferred, fallback) = if prefer_covariant {
                    (covariant, contravariant)
                } else {
                    (contravariant, covariant)
                };
            } else if let Some(default) = self.default_of_type_param(param) {
                // A default may mention the parameters before it. Those from it on are nothing yet.
                let mut default = self.instantiate(default, outer);
                if self.has_type_variables(default) {
                    let unknowns: SmallVec<[TypeId; 4]> =
                        smallvec![TypeId::UNKNOWN; n.params.len() - index];
                    let backreference = self.mapper_from(&n.params[index..], &unknowns);
                    default = self.instantiate(default, backreference);
                    let so_far = self.non_fixing_mapper(n, default);
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
            Some(asked) => asked,
            None => self.constraint_of_type_param(param),
        };
        let Some(constraint) = extended else {
            return provisional;
        };
        let constraint = self.instantiate(constraint, outer);
        // What it extends may lead back to it.
        c.inferred.set(Some(provisional));
        let so_far = self.non_fixing_mapper(n, constraint);
        let constraint = self.instantiate(constraint, so_far);
        if let Some(ty) = inferred
            && !self.is_inferred_assignable(n, ty, constraint)
            && !self.fits_through_what_is_around(n, ty, constraint)
        {
            // Going by what is expected of the result alone is a guess anyway: what of it fits will do.
            let filtered = if c.priority == PRIORITY_RETURN {
                self.filter(ty, |k, m| k.is_inferred_assignable(n, m, constraint))
            } else {
                TypeId::NEVER
            };
            inferred = (!filtered.is_never()).then_some(filtered);
        }
        match inferred {
            Some(ty) => ty,
            None => match fallback {
                Some(fallback) if self.is_inferred_assignable(n, fallback, constraint) => fallback,
                _ => constraint,
            },
        }
    }

    /// Whether the type parameter `ty` of the signature that is inferred from extends something that fits `constraint`, once
    /// what is around that signature is filled in.
    fn fits_through_what_is_around(
        &mut self,
        n: &Inference,
        ty: TypeId,
        constraint: TypeId,
    ) -> bool {
        if n.around_source == MapperId::IDENTITY
            || !matches!(self.data(ty), TypeData::TypeParam(..))
            || self.is_cloned_type_param(ty)
            || n.stand_ins.is_some() && !n.own_of_source.contains(&ty)
        {
            return false;
        }
        let Some(declared) = self.constraint_of_type_param(ty) else {
            return false;
        };
        let extended = self.instantiate(declared, n.around_source);
        extended != declared
            && (extended == constraint || self.is_inferred_assignable(n, extended, constraint))
    }

    /// `nonFixingMapper`, for the parameters `ty` mentions.
    fn non_fixing_mapper(&mut self, n: &Inference, ty: TypeId) -> MapperId {
        if !self.has_type_variables(ty) {
            return MapperId::IDENTITY;
        }
        let mut pairs = Vec::new();
        let mentioned = self.params_mentioned_in(ty, &n.params);
        for i in 0..n.params.len() {
            if mentioned[i] {
                pairs.push((n.params[i], self.get_inferred_type(n, i, false)));
            }
        }
        if pairs.is_empty() {
            return MapperId::IDENTITY;
        }
        self.p.types.mapper(pairs)
    }

    /// Every parameter as it stands.
    pub(super) fn inference_mapper(&mut self, n: &Inference) -> MapperId {
        let types: SmallVec<[TypeId; 4]> = (0..n.params.len())
            .map(|i| self.inferred_type(n, i))
            .collect();
        self.mapper_from(&n.params, &types)
    }

    /// What `fix_params_in` settles parameter `index` on, or has settled it on.
    pub(super) fn settled_type(&mut self, n: &Inference, index: usize) -> TypeId {
        // Nothing is settled: what is found on the way holds only if it were.
        n.clear_cached_inferences();
        let settled = self.get_inferred_type(n, index, true);
        n.clear_cached_inferences();
        settled
    }

    /// Settles the parameters `ty` mentions: whatever is inferred later does not change them.
    pub(super) fn fix_params_in(&mut self, inference: &mut Inference, ty: TypeId) {
        let mentioned = self.params_mentioned_in(ty, &inference.params);
        for i in 0..inference.params.len() {
            if inference.candidates[i].fixed.is_none() && mentioned[i] {
                inference.clear_cached_inferences();
                let fixed = self.get_inferred_type(inference, i, true);
                inference.candidates[i].fixed = Some(fixed);
            }
        }
    }

    /// Whether `param` occurs in `ty`, as far as can be told without resolving members.
    pub fn mentions(&self, ty: TypeId, param: TypeId) -> bool {
        self.any_type_in(ty, |t| t == param)
    }

    /// `mentions`, for each of `params`, going through `ty` once.
    fn params_mentioned_in(&self, ty: TypeId, params: &[TypeId]) -> SmallVec<[bool; 4]> {
        let mut mentioned: SmallVec<[bool; 4]> = smallvec![false; params.len()];
        let may_be_any = self.any_type_in(ty, |t| {
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

    /// Whether `found` says yes to `ty` or to something `ty` is made of, as far as can be told without resolving members. Yes also
    /// where that cannot be told. A type refers only to types made before it, and each is looked at once, however deep it lies.
    fn any_type_in(&self, ty: TypeId, mut found: impl FnMut(TypeId) -> bool) -> bool {
        let mut left: SmallVec<[TypeId; 16]> = smallvec![ty];
        // The first few are looked up as they come.
        let mut seen: SmallVec<[TypeId; 16]> = SmallVec::new();
        let mut seen_later = crate::util::FxHashSet::default();
        while let Some(ty) = left.pop() {
            if found(ty) {
                return true;
            }
            if !self.has_type_variables(ty) || seen.contains(&ty) {
                continue;
            }
            if seen.len() < seen.inline_size() {
                seen.push(ty);
            } else if !seen_later.insert(ty) {
                continue;
            }
            let values = |mapper: MapperId| self.p.types.mapping(mapper).iter().map(|pair| pair.1);
            match self.data(ty) {
                TypeData::Union(types) | TypeData::Intersection(types) => {
                    left.extend_from_slice(types);
                }
                TypeData::Ref { args, .. } | TypeData::LazyAlias { args, .. } => {
                    left.extend_from_slice(args);
                }
                TypeData::Tuple { elems, .. } => left.extend_from_slice(elems),
                TypeData::Template { types, .. } => left.extend_from_slice(types),
                TypeData::Anon { mapper, .. }
                | TypeData::Fns { mapper, .. }
                | TypeData::Cond { mapper, .. } => left.extend(values(*mapper)),
                TypeData::Synth(shape) => {
                    if !shape.call.is_empty() {
                        return true;
                    }
                    for p in &shape.props {
                        match p.source {
                            PropSource::Type(t) | PropSource::Copy(t, ..) => left.push(t),
                            _ => left.extend(values(p.mapper)),
                        }
                    }
                    left.extend(shape.index.iter().map(|i| i.value));
                }
                TypeData::IndexedAccess { obj, index, .. } => left.extend([*obj, *index]),
                TypeData::Substitution { base, constraint } => left.extend([*base, *constraint]),
                TypeData::ReverseMapped { source: t, .. }
                | TypeData::Keyof(t)
                | TypeData::StringMapping { ty: t, .. } => left.push(*t),
                _ => {}
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
