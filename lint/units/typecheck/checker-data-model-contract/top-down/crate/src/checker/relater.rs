// relater.go 87-145, 342-422, 1487-1706, 2569-2745, 3089-3222, 4575-4591, 4862-4981: the relater as a record of the checker. Callees of other layers are stand-ins.
use crate::ast::diagnostic::Arg;
use crate::ast::kind_generated::Kind;
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    ExpandingFlags, IntersectionState, ObjectFlags, RecursionFlags, RelationComparisonResult,
    SignatureCheckMode, SignatureFlags, SignatureKind, TypeFlags, TypePredicateKind,
};
use crate::checker::ids::*;
use crate::checker::keys::{CacheHashKey, get_relation_key};
use crate::checker::types::Ternary;
use crate::diagnostics::{self, MessageId};
use crate::tscore::arena::Arena;
use crate::tscore::golang::{List, Map};
use crate::tscore::gomore::Set;
use crate::tscore::ids::{DiagnosticId, NodeId, SymbolId, TypeId};

// Upstream holds five `*Relation` and compares the pointers. `Nil` is the relation of a relater that sits in the pool.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum RelationKind {
    #[default]
    Nil,
    Subtype,
    StrictSubtype,
    Assignable,
    Comparable,
    Identity,
}

// relater.go 98-115. The map is made by the first `set`.
#[derive(Default)]
pub struct Relation {
    pub results: Map<CacheHashKey, RelationComparisonResult>,
}

// relater.go 2574-2578. A node is never changed after it is made, so a saved head stays valid.
#[derive(Clone, Default)]
pub struct ErrorChain<'a> {
    pub next: ErrorChainId,
    pub message: MessageId,
    pub args: Vec<Arg<'a>>,
}

// relater.go 2569-2572. Restoring the slice header of relatedInfo is a truncation: saves and restores nest.
#[derive(Clone, Copy, Default)]
pub struct ErrorState {
    pub error_chain: ErrorChainId,
    pub related_info_len: usize,
}

// relater.go 2580-2597 without `c`. maybeCount, sourceDepth and targetDepth are declared upstream and never used.
#[derive(Default)]
pub struct Relater<'a> {
    pub relation: RelationKind,
    pub error_node: NodeId,
    pub error_chain: ErrorChainId,
    pub error_chains: Arena<ErrorChainId, ErrorChain<'a>>,
    pub related_info: Vec<DiagnosticId>,
    pub maybe_keys: Vec<CacheHashKey>,
    pub maybe_keys_set: Set<CacheHashKey>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
    pub expanding_flags: ExpandingFlags,
    pub overflow: bool,
    pub relation_count: isize,
    pub next: RelaterId,
}

// types.go 1425. A comparer is stored in an inference context and passed beside a reporter, so it is data and not a closure.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeComparer {
    #[default]
    Nil,
    // c.compareTypesAssignable, bound to compareTypesAssignableWorker at checker.go 1262.
    Assignable,
    // r.isRelatedToWorker (relater.go 3616, 3768) and the closure of signatureRelatedTo (relater.go 4587).
    Relater {
        r: RelaterId,
        intersection_state: IntersectionState,
    },
}

// relater.go 87. The only reporter that upstream ever passes is `r.reportError`.
pub type ErrorReporter = Option<RelaterId>;

impl<'a> Checker<'a> {
    fn relation(&self, relation: RelationKind) -> Option<&Relation> {
        match relation {
            RelationKind::Nil => None,
            RelationKind::Subtype => Some(&self.subtype_relation),
            RelationKind::StrictSubtype => Some(&self.strict_subtype_relation),
            RelationKind::Assignable => Some(&self.assignable_relation),
            RelationKind::Comparable => Some(&self.comparable_relation),
            RelationKind::Identity => Some(&self.identity_relation),
        }
    }

    // Relation.get. A nil relation is the relation of a pooled relater: upstream dereferences nil there.
    pub fn relation_get(
        &self,
        relation: RelationKind,
        key: CacheHashKey,
    ) -> RelationComparisonResult {
        match self.relation(relation) {
            Some(rel) => rel.results.get(&key),
            None => self.fail("nil Relation"),
        }
    }

    // Relation.set
    pub fn relation_set(
        &mut self,
        relation: RelationKind,
        key: CacheHashKey,
        result: RelationComparisonResult,
    ) {
        let rel = match relation {
            RelationKind::Nil => return self.fail("nil Relation"),
            RelationKind::Subtype => &mut self.subtype_relation,
            RelationKind::StrictSubtype => &mut self.strict_subtype_relation,
            RelationKind::Assignable => &mut self.assignable_relation,
            RelationKind::Comparable => &mut self.comparable_relation,
            RelationKind::Identity => &mut self.identity_relation,
        };
        if rel.results.is_nil() {
            rel.results = Map::make();
        }
        let _ = rel.results.set(key, result);
    }

    // Relation.size
    pub fn relation_size(&self, relation: RelationKind) -> isize {
        match self.relation(relation) {
            Some(rel) => rel.results.len(),
            None => self.fail("nil Relation"),
        }
    }

    pub fn is_type_identical_to(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::Identity)
    }

    pub fn compare_types_identical(&mut self, source: TypeId, target: TypeId) -> Ternary {
        if self.is_type_related_to(source, target, RelationKind::Identity) {
            return Ternary::TRUE;
        }
        Ternary::FALSE
    }

    pub fn compare_types_assignable_worker(
        &mut self,
        source: TypeId,
        target: TypeId,
        _report_errors: bool,
    ) -> Ternary {
        if self.is_type_related_to(source, target, RelationKind::Assignable) {
            return Ternary::TRUE;
        }
        Ternary::FALSE
    }

    pub fn check_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_node: NodeId,
    ) -> bool {
        self.check_type_related_to_ex(source, target, relation, error_node, MessageId::NIL, None)
    }

    // Check that source is related to target according to the given relation; zero or one error goes to diagnostic_output.
    pub fn check_type_related_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_node: NodeId,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let r = self.get_relater();
        self.relaters[r].relation = relation;
        self.relaters[r].error_node = error_node;
        self.relaters[r].relation_count = (16_000_000 - self.relation_size(relation)) / 8;
        let result = self.is_related_to_ex(
            r,
            source,
            target,
            RecursionFlags::BOTH,
            !error_node.is_nil(),
            head_message,
            IntersectionState::NONE,
        );
        if self.relaters[r].overflow {
            // Record this relation as having failed such that we don't attempt the overflowing operation again.
            let (id, _) = get_relation_key(
                self,
                source,
                target,
                IntersectionState::NONE,
                relation == RelationKind::Identity,
                false,
            );
            self.relation_set(
                relation,
                id,
                RelationComparisonResult::FAILED | RelationComparisonResult::COMPLEXITY_OVERFLOW,
            );
            let mut error_node = error_node;
            if error_node.is_nil() {
                error_node = self.current_node;
            }
            let args = [
                Arg::Str(self.type_to_string(source)),
                Arg::Str(self.type_to_string(target)),
            ];
            let diagnostic = self.new_diagnostic_for_node(
                error_node,
                diagnostics::Excessive_complexity_comparing_types_0_and_1,
                &args,
            );
            self.report_diagnostic(diagnostic, diagnostic_output);
        } else if !self.relaters[r].error_chain.is_nil() {
            // Check if we should issue an extra diagnostic to produce a quickfix for a slightly incorrect import statement
            let source_symbol = self.types[source].symbol;
            if !head_message.is_nil()
                && !error_node.is_nil()
                && result == Ternary::FALSE
                && !source_symbol.is_nil()
                && self.export_type_links.has(source_symbol)
            {
                let links = self.export_type_links.get(source_symbol);
                let originating_import = self.export_type_links[links].originating_import;
                if !originating_import.is_nil() && !self.is_import_call(originating_import) {
                    let links_target = self.export_type_links[links].target;
                    let target_type = self.get_type_of_symbol(links_target);
                    let helpful_retry =
                        self.check_type_related_to(target_type, target, relation, NodeId::NIL);
                    if helpful_retry {
                        // Likely an incorrect import. Issue a helpful diagnostic to produce a quickfix to change the import
                        let info = self.new_diagnostic_for_node(
                            originating_import,
                            diagnostics::Type_originates_at_this_import_A_namespace_style_import_cannot_be_called_or_constructed_and_will_cause_a_failure_at_runtime_Consider_using_a_default_import_or_import_require_here_instead,
                            &[],
                        );
                        self.relaters[r].related_info.push(info);
                    }
                }
            }
            let chain = self.relaters[r].error_chain;
            let diagnostic = self.create_diagnostic_chain_from_error_chain(r, chain);
            self.report_diagnostic(diagnostic, diagnostic_output);
        }
        self.put_relater(r);
        result != Ternary::FALSE
    }

    // createDiagnosticChainFromErrorChain: errorNode and relatedInfo are those of the relater that owns the chain.
    pub fn create_diagnostic_chain_from_error_chain(
        &mut self,
        r: RelaterId,
        chain: ErrorChainId,
    ) -> DiagnosticId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut chain = chain;
        while !chain.is_nil()
            && self.relaters[r].error_chains[chain]
                .message
                .elided_in_compatibility_pyramid()
        {
            chain = self.relaters[r].error_chains[chain].next;
        }
        if chain.is_nil() {
            return DiagnosticId::NIL;
        }
        let node = self.relaters[r].error_chains[chain].clone();
        let next = self.create_diagnostic_chain_from_error_chain(r, node.next);
        if next.is_nil() {
            let error_node = self.relaters[r].error_node;
            let diagnostic = self.new_diagnostic_for_node(error_node, node.message, &node.args);
            let related_info = self.relaters[r].related_info.clone();
            return self
                .diagnostic_store
                .set_related_info(diagnostic, related_info);
        }
        self.diagnostic_store
            .new_diagnostic_chain(next, node.message, &node.args)
    }

    pub fn report_diagnostic(
        &mut self,
        diagnostic: DiagnosticId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) {
        if !diagnostic.is_nil() {
            match diagnostic_output {
                Some(output) => output.push(diagnostic),
                None => self.add_diagnostic(diagnostic),
            }
        }
    }

    pub fn is_signature_assignable_to(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        ignore_return_types: bool,
    ) -> bool {
        let check_mode = if ignore_return_types {
            SignatureCheckMode::IGNORE_RETURN_TYPES
        } else {
            SignatureCheckMode::NONE
        };
        self.compare_signatures_related(
            source,
            target,
            check_mode,
            false,
            None,
            TypeComparer::Assignable,
            TypeMapperId::NIL,
        ) != Ternary::FALSE
    }

    // A call of a value of type TypeComparer.
    pub fn call_type_comparer(
        &mut self,
        compare_types: TypeComparer,
        s: TypeId,
        t: TypeId,
        report_errors: bool,
    ) -> Ternary {
        match compare_types {
            TypeComparer::Nil => self.fail("nil TypeComparer"),
            TypeComparer::Assignable => self.compare_types_assignable_worker(s, t, report_errors),
            TypeComparer::Relater {
                r,
                intersection_state,
            } => self.is_related_to_ex(
                r,
                s,
                t,
                RecursionFlags::BOTH,
                report_errors,
                MessageId::NIL,
                intersection_state,
            ),
        }
    }

    // A call of a value of type ErrorReporter.
    pub fn call_error_reporter(
        &mut self,
        error_reporter: ErrorReporter,
        message: MessageId,
        args: &[Arg<'a>],
    ) {
        match error_reporter {
            Some(r) => self.report_error(r, message, args),
            None => self.fail("nil ErrorReporter"),
        }
    }

    pub fn compare_signatures_related(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        check_mode: SignatureCheckMode,
        report_errors: bool,
        error_reporter: ErrorReporter,
        compare_types: TypeComparer,
        report_unreliable_markers: TypeMapperId,
    ) -> Ternary {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let (mut source, mut target) = (source, target);
        if source == target {
            return Ternary::TRUE;
        }
        if !(check_mode.intersects(SignatureCheckMode::STRICT_TOP_SIGNATURE)
            && self.is_top_signature(source))
            && self.is_top_signature(target)
        {
            return Ternary::TRUE;
        }
        if check_mode.intersects(SignatureCheckMode::STRICT_TOP_SIGNATURE)
            && self.is_top_signature(source)
            && !self.is_top_signature(target)
        {
            return Ternary::FALSE;
        }
        let target_count = self.get_parameter_count(target);
        let mut source_has_more_parameters = false;
        if !self.has_effective_rest_parameter(target) {
            if check_mode.intersects(SignatureCheckMode::STRICT_ARITY) {
                source_has_more_parameters = self.has_effective_rest_parameter(source)
                    || self.get_parameter_count(source) > target_count;
            } else {
                source_has_more_parameters = self.get_min_argument_count(source) > target_count;
            }
        }
        if source_has_more_parameters {
            if report_errors && !check_mode.intersects(SignatureCheckMode::STRICT_ARITY) {
                // the second condition should be redundant, because there is no error reporting when comparing signatures by strict arity
                let args = [
                    Arg::from(self.get_min_argument_count(source)),
                    Arg::from(target_count),
                ];
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::Target_signature_provides_too_few_arguments_Expected_0_or_more_but_got_1,
                    &args,
                );
            }
            return Ternary::FALSE;
        }
        if self.signatures[source].type_parameters.len() != 0
            && !self.signatures[source]
                .type_parameters
                .same(self.signatures[target].type_parameters)
        {
            target = self.get_canonical_signature(target);
            source = self.instantiate_signature_in_context_of(
                source,
                target,
                InferenceContextId::NIL,
                compare_types,
            );
        }
        let source_count = self.get_parameter_count(source);
        let source_rest_type = self.get_non_array_rest_type(source);
        let target_rest_type = self.get_non_array_rest_type(target);
        if !source_rest_type.is_nil() || !target_rest_type.is_nil() {
            let rest_type = if !source_rest_type.is_nil() {
                source_rest_type
            } else {
                target_rest_type
            };
            self.instantiate_type(rest_type, report_unreliable_markers);
        }
        let mut kind = Kind::Unknown;
        let a = self.ast;
        if !self.signatures[target].declaration.is_nil() {
            kind = a.kind(self.signatures[target].declaration);
        }
        let strict_variance = !check_mode.intersects(SignatureCheckMode::CALLBACK)
            && self.strict_function_types
            && kind != Kind::MethodDeclaration
            && kind != Kind::MethodSignature
            && kind != Kind::Constructor;
        let mut result = Ternary::TRUE;
        let source_this_type = self.get_this_type_of_signature(source);
        if !source_this_type.is_nil() && source_this_type != self.void_type {
            let target_this_type = self.get_this_type_of_signature(target);
            if !target_this_type.is_nil() {
                // void sources are assignable to anything.
                let mut related = Ternary::FALSE;
                if !strict_variance {
                    related = self.call_type_comparer(
                        compare_types,
                        source_this_type,
                        target_this_type,
                        false,
                    );
                }
                if related == Ternary::FALSE {
                    related = self.call_type_comparer(
                        compare_types,
                        target_this_type,
                        source_this_type,
                        report_errors,
                    );
                }
                if related == Ternary::FALSE {
                    if report_errors {
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::The_this_types_of_each_signature_are_incompatible,
                            &[],
                        );
                    }
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        let has_rest = !source_rest_type.is_nil() || !target_rest_type.is_nil();
        let param_count = if has_rest {
            source_count.min(target_count)
        } else {
            source_count.max(target_count)
        };
        let rest_index = if has_rest { param_count - 1 } else { -1 };
        for i in 0..param_count {
            let source_type = if i == rest_index {
                self.get_rest_or_any_type_at_position(source, i)
            } else {
                self.try_get_type_at_position(source, i)
            };
            let target_type = if i == rest_index {
                self.get_rest_or_any_type_at_position(target, i)
            } else {
                self.try_get_type_at_position(target, i)
            };
            if !source_type.is_nil()
                && !target_type.is_nil()
                && (source_type != target_type
                    || check_mode.intersects(SignatureCheckMode::STRICT_ARITY))
            {
                // Callback parameters are related co-variantly: see the comment at relater.go 1575.
                let mut source_sig = SignatureId::NIL;
                let mut target_sig = SignatureId::NIL;
                if !check_mode.intersects(SignatureCheckMode::CALLBACK)
                    && !self.is_instantiated_generic_parameter(source, i)
                {
                    let non_nullable = self.get_non_nullable_type(source_type);
                    source_sig = self.get_single_call_signature(non_nullable);
                }
                if !check_mode.intersects(SignatureCheckMode::CALLBACK)
                    && !self.is_instantiated_generic_parameter(target, i)
                {
                    let non_nullable = self.get_non_nullable_type(target_type);
                    target_sig = self.get_single_call_signature(non_nullable);
                }
                let callbacks = !source_sig.is_nil()
                    && !target_sig.is_nil()
                    && self.get_type_predicate_of_signature(source_sig).is_nil()
                    && self.get_type_predicate_of_signature(target_sig).is_nil()
                    && self.get_type_facts(source_type, TYPE_FACTS_IS_UNDEFINED_OR_NULL)
                        == self.get_type_facts(target_type, TYPE_FACTS_IS_UNDEFINED_OR_NULL);
                let mut related = Ternary::FALSE;
                if callbacks {
                    let callback_mode = if strict_variance {
                        SignatureCheckMode::STRICT_CALLBACK
                    } else {
                        SignatureCheckMode::BIVARIANT_CALLBACK
                    };
                    related = self.compare_signatures_related(
                        target_sig,
                        source_sig,
                        (check_mode & SignatureCheckMode::STRICT_ARITY) | callback_mode,
                        report_errors,
                        error_reporter,
                        compare_types,
                        report_unreliable_markers,
                    );
                } else {
                    if !check_mode.intersects(SignatureCheckMode::CALLBACK) && !strict_variance {
                        related =
                            self.call_type_comparer(compare_types, source_type, target_type, false);
                    }
                    if related == Ternary::FALSE {
                        related = self.call_type_comparer(
                            compare_types,
                            target_type,
                            source_type,
                            report_errors,
                        );
                    }
                }
                // With strict arity, (x: number | undefined) => void is a subtype of (x?: number | undefined) => void
                if related != Ternary::FALSE
                    && check_mode.intersects(SignatureCheckMode::STRICT_ARITY)
                    && i >= self.get_min_argument_count(source)
                    && i < self.get_min_argument_count(target)
                    && self.call_type_comparer(compare_types, source_type, target_type, false)
                        != Ternary::FALSE
                {
                    related = Ternary::FALSE;
                }
                if related == Ternary::FALSE {
                    if report_errors {
                        let args = [
                            Arg::Str(self.get_parameter_name_at_position(source, i)),
                            Arg::Str(self.get_parameter_name_at_position(target, i)),
                        ];
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::Types_of_parameters_0_and_1_are_incompatible,
                            &args,
                        );
                    }
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        if !check_mode.intersects(SignatureCheckMode::IGNORE_RETURN_TYPES) {
            // If a signature resolution is already in-flight, skip issuing a circularity error here and just use the `any` type directly
            let target_return_type = self.get_non_circular_return_type_of_signature(target);
            if target_return_type == self.void_type || target_return_type == self.any_type {
                return result;
            }
            let source_return_type = self.get_non_circular_return_type_of_signature(source);
            // The following block preserves behavior forbidding boolean returning functions from being assignable to type guard returning functions
            let target_type_predicate = self.get_type_predicate_of_signature(target);
            if !target_type_predicate.is_nil() {
                let source_type_predicate = self.get_type_predicate_of_signature(source);
                if !source_type_predicate.is_nil() {
                    result &= self.compare_type_predicate_related_to(
                        source_type_predicate,
                        target_type_predicate,
                        report_errors,
                        error_reporter,
                        compare_types,
                    );
                } else if self.type_predicates[target_type_predicate].kind
                    == TypePredicateKind::IDENTIFIER
                    || self.type_predicates[target_type_predicate].kind == TypePredicateKind::THIS
                {
                    if report_errors {
                        let args = [Arg::Str(self.signature_to_string(source))];
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::Signature_0_must_be_a_type_predicate,
                            &args,
                        );
                    }
                    return Ternary::FALSE;
                }
            } else {
                // Return types of callback signatures are still related bi-variantly: see the comment at relater.go 1643.
                let mut related = Ternary::FALSE;
                if check_mode.intersects(SignatureCheckMode::BIVARIANT_CALLBACK) {
                    related = self.call_type_comparer(
                        compare_types,
                        target_return_type,
                        source_return_type,
                        false,
                    );
                }
                if related == Ternary::FALSE {
                    related = self.call_type_comparer(
                        compare_types,
                        source_return_type,
                        target_return_type,
                        report_errors,
                    );
                }
                result &= related;
                if result == Ternary::FALSE && report_errors {
                    // The errors reported here serve as markers that trigger error chain reduction in reportError and are never reported.
                    let construct = self.signatures[source]
                        .flags
                        .intersects(SignatureFlags::CONSTRUCT);
                    let message = if self.signatures[source].parameters.len() == 0
                        && self.signatures[target].parameters.len() == 0
                    {
                        if construct {
                            diagnostics::Construct_signatures_with_no_arguments_have_incompatible_return_types_0_and_1
                        } else {
                            diagnostics::Call_signatures_with_no_arguments_have_incompatible_return_types_0_and_1
                        }
                    } else if construct {
                        diagnostics::Construct_signature_return_types_0_and_1_are_incompatible
                    } else {
                        diagnostics::Call_signature_return_types_0_and_1_are_incompatible
                    };
                    let args = [
                        Arg::Str(self.type_to_string(source_return_type)),
                        Arg::Str(self.type_to_string(target_return_type)),
                    ];
                    self.call_error_reporter(error_reporter, message, &args);
                }
            }
        }
        result
    }

    pub fn compare_type_predicate_related_to(
        &mut self,
        source: TypePredicateId,
        target: TypePredicateId,
        report_errors: bool,
        error_reporter: ErrorReporter,
        compare_types: TypeComparer,
    ) -> Ternary {
        if self.type_predicates[source].kind != self.type_predicates[target].kind {
            if report_errors {
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::A_this_based_type_guard_is_not_compatible_with_a_parameter_based_type_guard,
                    &[],
                );
                let args = [
                    Arg::Str(self.type_predicate_to_string(source)),
                    Arg::Str(self.type_predicate_to_string(target)),
                ];
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::Type_predicate_0_is_not_assignable_to_1,
                    &args,
                );
            }
            return Ternary::FALSE;
        }
        let source_kind = self.type_predicates[source].kind;
        if (source_kind == TypePredicateKind::IDENTIFIER
            || source_kind == TypePredicateKind::ASSERTS_IDENTIFIER)
            && self.type_predicates[source].parameter_index
                != self.type_predicates[target].parameter_index
        {
            if report_errors {
                let args = [
                    Arg::Str(self.type_predicates[source].parameter_name),
                    Arg::Str(self.type_predicates[target].parameter_name),
                ];
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::Parameter_0_is_not_in_the_same_position_as_parameter_1,
                    &args,
                );
                let args = [
                    Arg::Str(self.type_predicate_to_string(source)),
                    Arg::Str(self.type_predicate_to_string(target)),
                ];
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::Type_predicate_0_is_not_assignable_to_1,
                    &args,
                );
            }
            return Ternary::FALSE;
        }
        let (source_t, target_t) = (
            self.type_predicates[source].t,
            self.type_predicates[target].t,
        );
        let related = if source_t == target_t {
            Ternary::TRUE
        } else if !source_t.is_nil() && !target_t.is_nil() {
            self.call_type_comparer(compare_types, source_t, target_t, report_errors)
        } else {
            Ternary::FALSE
        };
        if related == Ternary::FALSE && report_errors {
            let args = [
                Arg::Str(self.type_predicate_to_string(source)),
                Arg::Str(self.type_predicate_to_string(target)),
            ];
            self.call_error_reporter(
                error_reporter,
                diagnostics::Type_predicate_0_is_not_assignable_to_1,
                &args,
            );
        }
        related
    }

    pub fn get_relater(&mut self) -> RelaterId {
        let mut r = self.free_relater;
        if r.is_nil() {
            r = self.relaters.alloc(Relater::default());
        }
        self.free_relater = self.relaters[r].next;
        r
    }

    // The record is reset in place, so a comparer that still names it sees a relater without a relation, as upstream's does.
    pub fn put_relater(&mut self, r: RelaterId) {
        let next = self.free_relater;
        let rel = &mut self.relaters[r];
        rel.maybe_keys_set.clear();
        rel.maybe_keys.clear();
        rel.source_stack.clear();
        rel.target_stack.clear();
        rel.relation = RelationKind::Nil;
        rel.error_node = NodeId::NIL;
        rel.error_chain = ErrorChainId::NIL;
        rel.error_chains = Arena::new();
        rel.related_info = Vec::new();
        rel.expanding_flags = ExpandingFlags::NONE;
        rel.overflow = false;
        rel.relation_count = 0;
        rel.next = next;
        self.free_relater = r;
    }

    pub fn is_related_to_simple(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        self.is_related_to_ex(
            r,
            source,
            target,
            RecursionFlags::BOTH,
            false,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to_worker(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> Ternary {
        self.is_related_to_ex(
            r,
            source,
            target,
            RecursionFlags::BOTH,
            report_errors,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
    ) -> Ternary {
        self.is_related_to_ex(
            r,
            source,
            target,
            recursion_flags,
            report_errors,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to_ex(
        &mut self,
        r: RelaterId,
        original_source: TypeId,
        original_target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
        head_message: MessageId,
        intersection_state: IntersectionState,
    ) -> Ternary {
        // No stack left: the answer of upstream's own backstop at 100 levels of nesting (relater.go 3136).
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return Ternary::MAYBE;
        }
        if original_source == original_target {
            return Ternary::TRUE;
        }
        let relation = self.relaters[r].relation;
        let error_reporter: ErrorReporter = if report_errors { Some(r) } else { None };
        // Before normalization: an object source and a primitive target need only the `isSimpleTypeRelatedTo` result
        if self.types[original_source]
            .flags
            .intersects(TypeFlags::OBJECT)
            && self.types[original_target]
                .flags
                .intersects(TypeFlags::PRIMITIVE)
        {
            if relation == RelationKind::Comparable
                && !self.types[original_target]
                    .flags
                    .intersects(TypeFlags::NEVER)
                && self.is_simple_type_related_to(original_target, original_source, relation, None)
                || self.is_simple_type_related_to(
                    original_source,
                    original_target,
                    relation,
                    error_reporter,
                )
            {
                return Ternary::TRUE;
            }
            if report_errors {
                self.report_error_results(
                    r,
                    original_source,
                    original_target,
                    original_source,
                    original_target,
                    head_message,
                );
            }
            return Ternary::FALSE;
        }
        // Normalize the source and target types: see the comment at relater.go 2648.
        let source = self.get_normalized_type(original_source, false);
        let mut target = self.get_normalized_type(original_target, true);
        if source == target {
            return Ternary::TRUE;
        }
        if relation == RelationKind::Identity {
            if self.types[source].flags != self.types[target].flags {
                return Ternary::FALSE;
            }
            if self.types[source].flags.intersects(TypeFlags::SINGLETON) {
                return Ternary::TRUE;
            }
            return self.recursive_type_related_to(
                r,
                source,
                target,
                false,
                IntersectionState::NONE,
                recursion_flags,
            );
        }
        // We fastpath comparing a type parameter to exactly its constraint, as this is _super_ common
        if self.types[source]
            .flags
            .intersects(TypeFlags::TYPE_PARAMETER)
            && self.get_constraint_of_type(source) == target
        {
            return Ternary::TRUE;
        }
        // A definitely non-nullable source drops null and undefined from a target union that has one other constituent.
        if self.types[source]
            .flags
            .intersects(TypeFlags::DEFINITELY_NON_NULLABLE)
            && self.types[target].flags.intersects(TypeFlags::UNION)
        {
            let types = self.type_types(target);
            let mut candidate = TypeId::NIL;
            if types.len() == 2
                && self.types[types.at(0usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
            {
                candidate = types.at(1usize);
            } else if types.len() == 3
                && self.types[types.at(0usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
                && self.types[types.at(1usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
            {
                candidate = types.at(2usize);
            }
            if !candidate.is_nil() && !self.types[candidate].flags.intersects(TypeFlags::NULLABLE) {
                target = self.get_normalized_type(candidate, true);
                if source == target {
                    return Ternary::TRUE;
                }
            }
        }
        if relation == RelationKind::Comparable
            && !self.types[target].flags.intersects(TypeFlags::NEVER)
            && self.is_simple_type_related_to(target, source, relation, None)
            || self.is_simple_type_related_to(source, target, relation, error_reporter)
        {
            return Ternary::TRUE;
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
            || self.types[target]
                .flags
                .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
        {
            let is_performing_excess_property_checks = !intersection_state
                .intersects(IntersectionState::TARGET)
                && self.is_object_literal_type(source)
                && self.types[source]
                    .object_flags
                    .intersects(ObjectFlags::FRESH_LITERAL);
            if is_performing_excess_property_checks
                && self.has_excess_properties(r, source, target, report_errors)
            {
                if report_errors {
                    let shown = if !self.types[original_target].alias.is_nil() {
                        original_target
                    } else {
                        target
                    };
                    self.report_relation_error(r, head_message, source, shown);
                }
                return Ternary::FALSE;
            }
            let is_performing_common_property_checks = (relation != RelationKind::Comparable
                || self.is_unit_type(source))
                && !intersection_state.intersects(IntersectionState::TARGET)
                && self.types[source]
                    .flags
                    .intersects(TypeFlags::PRIMITIVE | TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && source != self.global_object_type
                && self.types[target]
                    .flags
                    .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && self.is_weak_type(target)
                && (self.get_properties_of_type(source).len() > 0
                    || self.type_has_call_or_construct_signatures(source));
            let is_comparing_jsx_attributes = self.types[source]
                .object_flags
                .intersects(ObjectFlags::JSX_ATTRIBUTES);
            if is_performing_common_property_checks
                && !self.has_common_properties(source, target, is_comparing_jsx_attributes)
            {
                if report_errors {
                    let shown_source = if !self.types[original_source].alias.is_nil() {
                        original_source
                    } else {
                        source
                    };
                    let shown_target = if !self.types[original_target].alias.is_nil() {
                        original_target
                    } else {
                        target
                    };
                    let source_string = self.type_to_string(shown_source);
                    let target_string = self.type_to_string(shown_target);
                    let calls = self.get_signatures_of_type(source, SignatureKind::CALL);
                    let constructs = self.get_signatures_of_type(source, SignatureKind::CONSTRUCT);
                    let mut did_you_mean_to_call = false;
                    if calls.len() > 0 {
                        let return_type = self.get_return_type_of_signature(calls.at(0usize));
                        did_you_mean_to_call = self.is_related_to(
                            r,
                            return_type,
                            target,
                            RecursionFlags::SOURCE,
                            false,
                        ) != Ternary::FALSE;
                    }
                    if !did_you_mean_to_call && constructs.len() > 0 {
                        let return_type = self.get_return_type_of_signature(constructs.at(0usize));
                        did_you_mean_to_call = self.is_related_to(
                            r,
                            return_type,
                            target,
                            RecursionFlags::SOURCE,
                            false,
                        ) != Ternary::FALSE;
                    }
                    let args = [Arg::Str(source_string), Arg::Str(target_string)];
                    if did_you_mean_to_call {
                        self.report_error(
                            r,
                            diagnostics::Value_of_type_0_has_no_properties_in_common_with_type_1_Did_you_mean_to_call_it,
                            &args,
                        );
                    } else {
                        self.report_error(
                            r,
                            diagnostics::Type_0_has_no_properties_in_common_with_type_1,
                            &args,
                        );
                    }
                }
                return Ternary::FALSE;
            }
            let skip_caching = self.types[source].flags.intersects(TypeFlags::UNION)
                && self.type_types(source).len() < 4
                && !self.types[target].flags.intersects(TypeFlags::UNION)
                || self.types[target].flags.intersects(TypeFlags::UNION)
                    && self.type_types(target).len() < 4
                    && !self.types[source]
                        .flags
                        .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE);
            let result = if skip_caching {
                self.union_or_intersection_related_to(
                    r,
                    source,
                    target,
                    report_errors,
                    intersection_state,
                )
            } else {
                self.recursive_type_related_to(
                    r,
                    source,
                    target,
                    report_errors,
                    intersection_state,
                    recursion_flags,
                )
            };
            if result != Ternary::FALSE {
                return result;
            }
        }
        if report_errors {
            self.report_error_results(
                r,
                original_source,
                original_target,
                source,
                target,
                head_message,
            );
        }
        Ternary::FALSE
    }

    // Determine if possibly recursive types are related: see the comment at relater.go 3089.
    pub fn recursive_type_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
        recursion_flags: RecursionFlags,
    ) -> Ternary {
        if self.relaters[r].overflow {
            // Stack depth overflows can cause any relation involving structured types to become false.
            return Ternary::FALSE;
        }
        let relation = self.relaters[r].relation;
        // A relater of the pool has no relation: upstream dereferences nil at `r.relation.get` and nothing after it runs.
        if relation == RelationKind::Nil {
            return self.fail("nil Relation");
        }
        let is_identity = relation == RelationKind::Identity;
        let (id, constrained) =
            get_relation_key(self, source, target, intersection_state, is_identity, false);
        let entry = self.relation_get(relation, id);
        if entry != RelationComparisonResult::NONE {
            if report_errors
                && entry.intersects(RelationComparisonResult::FAILED)
                && !entry.intersects(RelationComparisonResult::OVERFLOW)
            {
                // The cached result is a failure not due to a comparison overflow: compare again to generate an error message.
            } else {
                self.reliability_flags |= entry
                    & (RelationComparisonResult::REPORTS_UNMEASURABLE
                        | RelationComparisonResult::REPORTS_UNRELIABLE);
                if report_errors && entry.intersects(RelationComparisonResult::OVERFLOW) {
                    let args = [
                        Arg::Str(self.type_to_string(source)),
                        Arg::Str(self.type_to_string(target)),
                    ];
                    self.report_error(
                        r,
                        diagnostics::Excessive_complexity_comparing_types_0_and_1,
                        &args,
                    );
                }
                if entry.intersects(RelationComparisonResult::SUCCEEDED) {
                    return Ternary::TRUE;
                }
                return Ternary::FALSE;
            }
        }
        if self.relaters[r].relation_count <= 0 {
            self.relaters[r].overflow = true;
            return Ternary::FALSE;
        }
        // If source and target are already being compared, consider them related with assumptions
        if self.relaters[r].maybe_keys_set.has(id) {
            return Ternary::MAYBE;
        }
        // A constrained key is also checked against the key of the same references with unconstrained type parameters.
        if constrained {
            let (broadest_equivalent_id, _) =
                get_relation_key(self, source, target, intersection_state, is_identity, true);
            if self.relaters[r].maybe_keys_set.has(broadest_equivalent_id) {
                return Ternary::MAYBE;
            }
        }
        if self.relaters[r].source_stack.len() == 100 || self.relaters[r].target_stack.len() == 100
        {
            // We stop relating if we reach 100 levels of nesting.
            return Ternary::MAYBE;
        }
        let maybe_start = self.relaters[r].maybe_keys.len();
        self.relaters[r].maybe_keys.push(id);
        self.relaters[r].maybe_keys_set.add(id);
        let save_expanding_flags = self.relaters[r].expanding_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            self.relaters[r].source_stack.push(source);
            if !self.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::SOURCE)
                && self.is_deeply_nested_type_in_relater(r, source, true, 3)
            {
                self.relaters[r].expanding_flags |= ExpandingFlags::SOURCE;
            }
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            self.relaters[r].target_stack.push(target);
            if !self.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::TARGET)
                && self.is_deeply_nested_type_in_relater(r, target, false, 3)
            {
                self.relaters[r].expanding_flags |= ExpandingFlags::TARGET;
            }
        }
        let save_reliability_flags = self.reliability_flags;
        self.reliability_flags = RelationComparisonResult::NONE;
        let result = if self.relaters[r].expanding_flags == ExpandingFlags::BOTH {
            Ternary::MAYBE
        } else {
            self.structured_type_related_to(r, source, target, report_errors, intersection_state)
        };
        let propagating_variance_flags = self.reliability_flags;
        self.reliability_flags |= save_reliability_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            self.relaters[r].source_stack.pop();
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            self.relaters[r].target_stack.pop();
        }
        self.relaters[r].expanding_flags = save_expanding_flags;
        if result != Ternary::FALSE {
            if result == Ternary::TRUE
                || (self.relaters[r].source_stack.is_empty()
                    && self.relaters[r].target_stack.is_empty())
            {
                // Maybe results are recorded as having succeeded once we reach depth 0, Unknown results never.
                let mark = result == Ternary::TRUE || result == Ternary::MAYBE;
                self.reset_maybe_stack(r, maybe_start, propagating_variance_flags, mark);
            }
            // Otherwise the keys stay on the stack: at depth zero all of them are reported as successful.
        } else {
            // A false result goes straight into global cache
            self.relation_set(
                relation,
                id,
                RelationComparisonResult::FAILED | propagating_variance_flags,
            );
            self.relaters[r].relation_count -= 1;
            self.reset_maybe_stack(r, maybe_start, propagating_variance_flags, false);
        }
        result
    }

    pub fn reset_maybe_stack(
        &mut self,
        r: RelaterId,
        maybe_start: usize,
        propagating_variance_flags: RelationComparisonResult,
        mark_all_as_succeeded: bool,
    ) {
        let relation = self.relaters[r].relation;
        let mut i = maybe_start;
        while let Some(&key) = self.relaters[r].maybe_keys.get(i) {
            self.relaters[r].maybe_keys_set.delete(key);
            if mark_all_as_succeeded {
                self.relation_set(
                    relation,
                    key,
                    RelationComparisonResult::SUCCEEDED | propagating_variance_flags,
                );
                self.relaters[r].relation_count -= 1;
            }
            i += 1;
        }
        self.relaters[r].maybe_keys.truncate(maybe_start);
    }

    pub fn get_error_state(&self, r: RelaterId) -> ErrorState {
        ErrorState {
            error_chain: self.relaters[r].error_chain,
            related_info_len: self.relaters[r].related_info.len(),
        }
    }

    pub fn restore_error_state(&mut self, r: RelaterId, e: ErrorState) {
        self.relaters[r].error_chain = e.error_chain;
        self.relaters[r].related_info.truncate(e.related_info_len);
    }

    // See signatureAssignableTo, compareSignaturesIdentical
    pub fn signature_related_to(
        &mut self,
        r: RelaterId,
        source: SignatureId,
        target: SignatureId,
        erase: bool,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let (mut source, mut target) = (source, target);
        let mut check_mode = SignatureCheckMode::NONE;
        if self.relaters[r].relation == RelationKind::Subtype {
            check_mode = SignatureCheckMode::STRICT_TOP_SIGNATURE;
        } else if self.relaters[r].relation == RelationKind::StrictSubtype {
            check_mode =
                SignatureCheckMode::STRICT_TOP_SIGNATURE | SignatureCheckMode::STRICT_ARITY;
        }
        if erase {
            source = self.get_erased_signature(source);
            target = self.get_erased_signature(target);
        }
        // The closure isRelatedToWorker and the method value r.reportError: both name this relater.
        let is_related_to_worker = TypeComparer::Relater {
            r,
            intersection_state,
        };
        self.compare_signatures_related(
            source,
            target,
            check_mode,
            report_errors,
            Some(r),
            is_related_to_worker,
            self.report_unreliable_mapper,
        )
    }

    pub fn report_error(&mut self, r: RelaterId, message: MessageId, args: &[Arg<'a>]) {
        let mut message = message;
        let mut args: Vec<Arg<'a>> = args.to_vec();
        if message == diagnostics::Types_of_property_0_are_incompatible {
            // Suppress if next message is an excess property error
            let first = self.get_chain_message(r, 0);
            if first
                == diagnostics::Object_literal_may_only_specify_known_properties_and_0_does_not_exist_in_type_1
                || first
                    == diagnostics::Object_literal_may_only_specify_known_properties_but_0_does_not_exist_in_type_1_Did_you_mean_to_write_2
            {
                return;
            }
            // A property message above a return type marker becomes one message for 'x()' or 'x(...)'.
            let second = self.get_chain_message(r, 1);
            let mut arg: Vec<u8> = Vec::new();
            if second
                == diagnostics::Call_signatures_with_no_arguments_have_incompatible_return_types_0_and_1
            {
                arg = [self.get_property_name_arg(args.first()).as_slice(), b"()"].concat();
            } else if second
                == diagnostics::Construct_signatures_with_no_arguments_have_incompatible_return_types_0_and_1
            {
                arg = [
                    b"new ",
                    self.get_property_name_arg(args.first()).as_slice(),
                    b"()",
                ]
                .concat();
            } else if second == diagnostics::Call_signature_return_types_0_and_1_are_incompatible {
                arg = [self.get_property_name_arg(args.first()).as_slice(), b"(...)"].concat();
            } else if second
                == diagnostics::Construct_signature_return_types_0_and_1_are_incompatible
            {
                arg = [
                    b"new ",
                    self.get_property_name_arg(args.first()).as_slice(),
                    b"(...)",
                ]
                .concat();
            }
            if !arg.is_empty() {
                message = diagnostics::The_types_returned_by_0_are_incompatible_between_these_types;
                if let Some(slot) = args.first_mut() {
                    *slot = Arg::Str(self.text(&arg));
                }
                let head = self.relaters[r].error_chain;
                let next = self.relaters[r].error_chains[head].next;
                self.relaters[r].error_chain = self.relaters[r].error_chains[next].next;
            }
            // A property message above a property message becomes one message for 'x.y'.
            let second = self.get_chain_message(r, 1);
            if second == diagnostics::Types_of_property_0_are_incompatible
                || second == diagnostics::The_types_of_0_are_incompatible_between_these_types
                || second
                    == diagnostics::The_types_returned_by_0_are_incompatible_between_these_types
            {
                let head = self.get_property_name_arg(args.first());
                let chain_head = self.relaters[r].error_chain;
                let chain_next = self.relaters[r].error_chains[chain_head].next;
                let tail_arg = self.relaters[r].error_chains[chain_next]
                    .args
                    .first()
                    .copied();
                let tail = self.get_property_name_arg(tail_arg.as_ref());
                let arg = add_to_dotted_name(&head, &tail);
                self.relaters[r].error_chain = self.relaters[r].error_chains[chain_next].next;
                if message == diagnostics::Types_of_property_0_are_incompatible {
                    message = diagnostics::The_types_of_0_are_incompatible_between_these_types;
                }
                let arg = [Arg::Str(self.text(&arg))];
                self.report_error(r, message, &arg);
                return;
            }
        }
        let next = self.relaters[r].error_chain;
        let node = self.relaters[r].error_chains.alloc(ErrorChain {
            next,
            message,
            args,
        });
        self.relaters[r].error_chain = node;
    }

    pub fn get_chain_message(&self, r: RelaterId, index: isize) -> MessageId {
        let mut e = self.relaters[r].error_chain;
        let mut index = index;
        loop {
            if e.is_nil() {
                return MessageId::NIL;
            }
            if index == 0 {
                return self.relaters[r].error_chains[e].message;
            }
            e = self.relaters[r].error_chains[e].next;
            index -= 1;
        }
    }

    // Return true if the arguments of the first entry on the error chain match the given arguments (where None acts as a wildcard).
    pub fn chain_args_match(&self, r: RelaterId, args: &[Option<Arg<'a>>]) -> bool {
        let head = self.relaters[r].error_chain;
        let chain_args = &self.relaters[r].error_chains[head].args;
        for (i, a) in args.iter().enumerate() {
            if a.is_some() && *a != chain_args.get(i).copied() {
                return false;
            }
        }
        true
    }

    // getPropertyNameArg: `arg.(string)`, and `args[0]` of its callers.
    pub fn get_property_name_arg(&self, arg: Option<&Arg<'a>>) -> Vec<u8> {
        let Some(&Arg::Str(s)) = arg else {
            self.bad_cast("arg.(string)", self.current_node.0);
            return Vec::new();
        };
        match s.first() {
            Some(b'"' | b'\'' | b'`') => [b"[", s, b"]"].concat(),
            _ => s.to_vec(),
        }
    }

    pub fn chain_depth(&self, r: RelaterId, chain: ErrorChainId) -> isize {
        let mut depth = 0;
        let mut chain = chain;
        while !chain.is_nil() {
            depth += 1;
            chain = self.relaters[r].error_chains[chain].next;
        }
        depth
    }

    // r.c.isDeeplyNestedType(t, r.sourceStack, n): the stack is copied out because the callee takes the checker.
    fn is_deeply_nested_type_in_relater(
        &mut self,
        r: RelaterId,
        t: TypeId,
        source_side: bool,
        max_depth: isize,
    ) -> bool {
        let stack = if source_side {
            self.relaters[r].source_stack.clone()
        } else {
            self.relaters[r].target_stack.clone()
        };
        self.is_deeply_nested_type(t, &stack, max_depth)
    }

    // Stand-ins for the callees of other layers, with upstream's names in the log.
    pub fn is_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
    ) -> bool {
        let _ = (source, target, relation);
        self.stand_in("isTypeRelatedTo")
    }
    pub fn is_simple_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_reporter: ErrorReporter,
    ) -> bool {
        let _ = (source, target, relation, error_reporter);
        self.stand_in("isSimpleTypeRelatedTo")
    }
    pub fn report_error_results(
        &mut self,
        r: RelaterId,
        original_source: TypeId,
        original_target: TypeId,
        source: TypeId,
        target: TypeId,
        head_message: MessageId,
    ) {
        let _ = (
            r,
            original_source,
            original_target,
            source,
            target,
            head_message,
        );
        self.stand_in("reportErrorResults")
    }
    pub fn report_relation_error(
        &mut self,
        r: RelaterId,
        message: MessageId,
        source: TypeId,
        target: TypeId,
    ) {
        let _ = (r, message, source, target);
        self.stand_in("reportRelationError")
    }
    pub fn has_excess_properties(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> bool {
        let _ = (r, source, target, report_errors);
        self.stand_in("hasExcessProperties")
    }
    pub fn union_or_intersection_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (r, source, target, report_errors, intersection_state);
        self.stand_in("unionOrIntersectionRelatedTo")
    }
    // The scripted results are a hook of this scratch: the tests drive recursiveTypeRelatedTo through them.
    pub fn structured_type_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (r, source, target, report_errors, intersection_state);
        match self.scripted_structured_results.pop() {
            Some(result) => result,
            None => self.stand_in("structuredTypeRelatedTo"),
        }
    }
    pub fn is_deeply_nested_type(&mut self, t: TypeId, stack: &[TypeId], max_depth: isize) -> bool {
        let _ = (t, stack, max_depth);
        self.stand_in("isDeeplyNestedType")
    }
    pub fn get_normalized_type(&mut self, t: TypeId, writing: bool) -> TypeId {
        let _ = writing;
        self.stand_ins.record("getNormalizedType");
        t
    }
    pub fn get_constraint_of_type(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_ins.record("getConstraintOfType");
        TypeId::NIL
    }
    // The stand-in answers with the constraint that a test stored in the type parameter.
    pub fn get_constraint_of_type_parameter(&mut self, t: TypeId) -> TypeId {
        self.stand_ins.record("getConstraintOfTypeParameter");
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.as_type_parameter(t).constraint;
        }
        TypeId::NIL
    }
    pub fn get_type_arguments(&mut self, t: TypeId) -> List<'a, TypeId> {
        self.stand_ins.record("getTypeArguments");
        self.as_type_reference(t).resolved_type_arguments
    }
    pub fn is_object_literal_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("isObjectLiteralType")
    }
    pub fn is_unit_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("isUnitType")
    }
    pub fn is_weak_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("isWeakType")
    }
    pub fn has_common_properties(&mut self, source: TypeId, target: TypeId, jsx: bool) -> bool {
        let _ = (source, target, jsx);
        self.stand_in("hasCommonProperties")
    }
    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        let _ = t;
        self.stand_in("getPropertiesOfType")
    }
    pub fn type_has_call_or_construct_signatures(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("typeHasCallOrConstructSignatures")
    }
    pub fn get_signatures_of_type(
        &mut self,
        t: TypeId,
        kind: SignatureKind,
    ) -> List<'a, SignatureId> {
        let _ = (t, kind);
        self.stand_in("getSignaturesOfType")
    }
    pub fn get_return_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        self.stand_in("getReturnTypeOfSignature")
    }
    pub fn get_non_circular_return_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        self.stand_ins.record("getNonCircularReturnTypeOfSignature");
        self.signatures[s].resolved_return_type
    }
    pub fn type_to_string(&mut self, t: TypeId) -> crate::tscore::golang::Text<'a> {
        self.stand_ins.record("TypeToString");
        let name = format!("#{}", self.types[t].id.0);
        self.text(name.as_bytes())
    }
    pub fn signature_to_string(&mut self, s: SignatureId) -> crate::tscore::golang::Text<'a> {
        let _ = s;
        self.stand_in("signatureToString")
    }
    pub fn type_predicate_to_string(
        &mut self,
        p: TypePredicateId,
    ) -> crate::tscore::golang::Text<'a> {
        let _ = p;
        self.stand_in("typePredicateToString")
    }
    pub fn is_top_signature(&mut self, s: SignatureId) -> bool {
        let _ = s;
        self.stand_in("isTopSignature")
    }
    pub fn get_parameter_count(&mut self, s: SignatureId) -> isize {
        self.stand_ins.record("getParameterCount");
        self.signatures[s].parameters.len()
    }
    pub fn has_effective_rest_parameter(&mut self, s: SignatureId) -> bool {
        let _ = s;
        self.stand_in("hasEffectiveRestParameter")
    }
    pub fn get_min_argument_count(&mut self, s: SignatureId) -> isize {
        self.stand_ins.record("getMinArgumentCount");
        self.signatures[s].parameters.len()
    }
    pub fn get_canonical_signature(&mut self, s: SignatureId) -> SignatureId {
        self.stand_ins.record("getCanonicalSignature");
        s
    }
    pub fn get_erased_signature(&mut self, s: SignatureId) -> SignatureId {
        self.stand_ins.record("getErasedSignature");
        s
    }
    pub fn get_non_array_rest_type(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        self.stand_ins.record("getNonArrayRestType");
        TypeId::NIL
    }
    pub fn get_this_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        self.stand_ins.record("getThisTypeOfSignature");
        TypeId::NIL
    }
    pub fn get_rest_or_any_type_at_position(&mut self, s: SignatureId, pos: isize) -> TypeId {
        let _ = (s, pos);
        self.stand_in("getRestOrAnyTypeAtPosition")
    }
    pub fn try_get_type_at_position(&mut self, s: SignatureId, pos: isize) -> TypeId {
        let _ = (s, pos);
        self.stand_ins.record("tryGetTypeAtPosition");
        TypeId::NIL
    }
    pub fn is_instantiated_generic_parameter(&mut self, s: SignatureId, pos: isize) -> bool {
        let _ = (s, pos);
        self.stand_in("isInstantiatedGenericParameter")
    }
    pub fn get_non_nullable_type(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("GetNonNullableType")
    }
    pub fn get_single_call_signature(&mut self, t: TypeId) -> SignatureId {
        let _ = t;
        self.stand_ins.record("getSingleCallSignature");
        SignatureId::NIL
    }
    pub fn get_type_predicate_of_signature(&mut self, s: SignatureId) -> TypePredicateId {
        let _ = s;
        self.stand_in("getTypePredicateOfSignature")
    }
    pub fn get_type_facts(&mut self, t: TypeId, mask: u32) -> u32 {
        let _ = (t, mask);
        self.stand_ins.record("getTypeFacts");
        0
    }
    pub fn get_parameter_name_at_position(
        &mut self,
        s: SignatureId,
        pos: isize,
    ) -> crate::tscore::golang::Text<'a> {
        let _ = (s, pos);
        self.stand_in("getParameterNameAtPosition")
    }
    pub fn is_import_call(&mut self, node: NodeId) -> bool {
        let _ = node;
        self.stand_in("ast.IsImportCall")
    }
}

// TypeFactsIsUndefinedOrNull of checker.go 426-428, until the type facts layer lands.
const TYPE_FACTS_IS_UNDEFINED_OR_NULL: u32 = (1 << 24) | (1 << 25);

pub fn add_to_dotted_name(head: &[u8], tail: &[u8]) -> Vec<u8> {
    let head: Vec<u8> = if head.starts_with(b"new ") {
        [b"(", head, b")"].concat()
    } else {
        head.to_vec()
    };
    let mut pos = 0;
    loop {
        let rest = tail.get(pos..).unwrap_or(b"");
        if rest.starts_with(b"(") {
            pos += 1;
        } else if rest.starts_with(b"new ") {
            pos += 4;
        } else {
            break;
        }
    }
    let prefix = tail.get(..pos).unwrap_or(b"");
    let suffix = tail.get(pos..).unwrap_or(b"");
    if suffix.starts_with(b"[") {
        return [prefix, &head, suffix].concat();
    }
    [prefix, &head, b".", suffix].concat()
}
