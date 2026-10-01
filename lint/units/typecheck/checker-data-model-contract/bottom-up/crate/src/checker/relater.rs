// checker/relater.go 102-115, 135-140, 351-422, 1491-1705, 2599-2625, 3094-3222, 4575-4591, 4862-4967 and checker.go 17723-17739, in upstream order. A relater is a record of the checker named by its id. The methods of `*Relater` are methods of `RelaterId` that take the checker first.
use crate::ast::kind_generated::Kind;
use crate::ast_diagnostic::Arg;
use crate::checker::c01_data::{
    ErrorChain, ErrorReporter, ErrorState, Relater, RelationKind, TypeComparer,
};
use crate::checker::c30_type_keys::{CacheHashKey, KeyBuilder};
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    ExpandingFlags, IntersectionState, RecursionFlags, RelationComparisonResult,
    SignatureCheckMode, SignatureFlags, TypeFacts, TypePredicateKind,
};
use crate::checker::types::Ternary;
use crate::diagnostics::{self, MessageId};
use crate::tscore::golang::{Map, Text};
use crate::tscore::ids::{
    DiagnosticId, ErrorChainId, NodeId, RelaterId, SignatureId, TypeId, TypeMapperId,
    TypePredicateId,
};
use crate::tscore::internal::FaultKind;

impl<'a> Checker<'a> {
    // Relation.get
    pub fn relation_get(
        &self,
        relation: RelationKind,
        key: CacheHashKey,
    ) -> RelationComparisonResult {
        match self.relation(relation) {
            Some(rel) => rel.results.get(&key),
            None => RelationComparisonResult::NONE,
        }
    }

    // Relation.set
    pub fn relation_set(
        &mut self,
        relation: RelationKind,
        key: CacheHashKey,
        result: RelationComparisonResult,
    ) {
        let Some(rel) = self.relation_mut(relation) else {
            return;
        };
        if rel.results.is_nil() {
            rel.results = Map::make();
        }
        let ok = rel.results.set(key, result);
        self.map_set(ok);
    }

    // Relation.size
    pub fn relation_size(&self, relation: RelationKind) -> isize {
        match self.relation(relation) {
            Some(rel) => rel.results.len(),
            None => 0,
        }
    }

    pub fn compare_types_assignable_worker(
        &mut self,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> Ternary {
        let _ = report_errors;
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

    // Check that source is related to target according to the given relation. When errorNode is non-nil, errors are reported to the checker's diagnostic collection or through diagnosticOutput when non-nil.
    pub fn check_type_related_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_node: NodeId,
        head_message: MessageId,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let r = self.get_relater();
        self.relaters[r].relation = relation;
        self.relaters[r].error_node = error_node;
        self.relaters[r].relation_count = (16_000_000 - self.relation_size(relation)) / 8;
        let result = r.is_related_to_ex(
            self,
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
            let source_text = self.type_to_string(source);
            let target_text = self.type_to_string(target);
            let diagnostic = self.new_diagnostic_for_node(
                error_node,
                diagnostics::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1,
                &[Arg::Str(source_text), Arg::Str(target_text)],
            );
            self.report_diagnostic(diagnostic, diagnostic_output.as_deref_mut());
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
                            diagnostics::TYPE_ORIGINATES_AT_THIS_IMPORT_A_NAMESPACE_STYLE_IMPORT_CANNOT_BE_CALLED_OR_CONSTRUCTED_AND_WILL_CAUSE_A_FAILURE_AT_RUNTIME_CONSIDER_USING_A_DEFAULT_IMPORT_OR_IMPORT_REQUIRE_HERE_INSTEAD,
                            &[],
                        );
                        self.relaters[r].related_info.push(info);
                    }
                }
            }
            let chain = self.relaters[r].error_chain;
            let chain_node = self.relaters[r].error_node;
            let related_info = self.relaters[r].related_info.clone();
            let diagnostic =
                create_diagnostic_chain_from_error_chain(self, r, chain, chain_node, &related_info);
            self.report_diagnostic(diagnostic, diagnostic_output);
        }
        self.put_relater(r);
        result != Ternary::FALSE
    }

    pub fn report_diagnostic(
        &mut self,
        diagnostic: DiagnosticId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) {
        if !diagnostic.is_nil() {
            match diagnostic_output {
                Some(output) => output.push(diagnostic),
                None => {
                    self.add_diagnostic(diagnostic);
                }
            }
        }
    }

    // `compareTypes(s, t, reportErrors)` where compareTypes is a TypeComparer.
    pub fn call_type_comparer(
        &mut self,
        compare_types: TypeComparer,
        s: TypeId,
        t: TypeId,
        report_errors: bool,
    ) -> Ternary {
        match compare_types {
            TypeComparer::Nil => self.fail("call of a nil TypeComparer"),
            TypeComparer::Assignable => self.compare_types_assignable_worker(s, t, report_errors),
            TypeComparer::Relater {
                r,
                intersection_state,
            } => r.is_related_to_ex(
                self,
                s,
                t,
                RecursionFlags::BOTH,
                report_errors,
                MessageId::NIL,
                intersection_state,
            ),
        }
    }

    // `errorReporter(message, args...)`
    pub fn call_error_reporter(
        &mut self,
        error_reporter: ErrorReporter,
        message: MessageId,
        args: &[Arg<'a>],
    ) {
        match error_reporter {
            Some(r) => r.report_error(self, message, args),
            None => self.fail("call of a nil ErrorReporter"),
        }
    }

    // See signatureRelatedTo, compareSignaturesIdentical
    pub fn compare_signatures_related(
        &mut self,
        mut source: SignatureId,
        mut target: SignatureId,
        check_mode: SignatureCheckMode,
        report_errors: bool,
        error_reporter: ErrorReporter,
        compare_types: TypeComparer,
        report_unreliable_markers: TypeMapperId,
    ) -> Ternary {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
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
                let min = self.get_min_argument_count(source);
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::TARGET_SIGNATURE_PROVIDES_TOO_FEW_ARGUMENTS_EXPECTED_0_OR_MORE_BUT_GOT_1,
                    &[Arg::Int(min as i64), Arg::Int(target_count as i64)],
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
                crate::tscore::ids::InferenceContextId::NIL,
                compare_types,
            );
        }
        let source_count = self.get_parameter_count(source);
        let source_rest_type = self.get_non_array_rest_type(source);
        let target_rest_type = self.get_non_array_rest_type(target);
        if !source_rest_type.is_nil() || !target_rest_type.is_nil() {
            let rest = if !source_rest_type.is_nil() {
                source_rest_type
            } else {
                target_rest_type
            };
            self.instantiate_type(rest, report_unreliable_markers);
        }
        let mut kind = Kind::Unknown;
        let target_declaration = self.signatures[target].declaration;
        if !target_declaration.is_nil() {
            kind = self.ast.kind(target_declaration);
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
                            diagnostics::THE_THIS_TYPES_OF_EACH_SIGNATURE_ARE_INCOMPATIBLE,
                            &[],
                        );
                    }
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        let param_count = if !source_rest_type.is_nil() || !target_rest_type.is_nil() {
            source_count.min(target_count)
        } else {
            source_count.max(target_count)
        };
        let rest_index = if !source_rest_type.is_nil() || !target_rest_type.is_nil() {
            param_count - 1
        } else {
            -1
        };
        let mut i = 0;
        while i < param_count {
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
                // In order to ensure that any generic type Foo<T> is at least co-variant with respect to T no matter how Foo uses T, we need to relate parameters bi-variantly. Two callback parameters relate co-variantly.
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
                    && self.get_type_facts(source_type, TypeFacts::IS_UNDEFINED_OR_NULL)
                        == self.get_type_facts(target_type, TypeFacts::IS_UNDEFINED_OR_NULL);
                let mut related = Ternary::FALSE;
                if callbacks {
                    let callback_mode = (check_mode & SignatureCheckMode::STRICT_ARITY)
                        | if strict_variance {
                            SignatureCheckMode::STRICT_CALLBACK
                        } else {
                            SignatureCheckMode::BIVARIANT_CALLBACK
                        };
                    related = self.compare_signatures_related(
                        target_sig,
                        source_sig,
                        callback_mode,
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
                        let source_name = self.get_parameter_name_at_position(source, i);
                        let target_name = self.get_parameter_name_at_position(target, i);
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::TYPES_OF_PARAMETERS_0_AND_1_ARE_INCOMPATIBLE,
                            &[Arg::Str(source_name), Arg::Str(target_name)],
                        );
                    }
                    return Ternary::FALSE;
                }
                result &= related;
            }
            i += 1;
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
                        let text = self.signature_to_string(source);
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::SIGNATURE_0_MUST_BE_A_TYPE_PREDICATE,
                            &[Arg::Str(text)],
                        );
                    }
                    return Ternary::FALSE;
                }
            } else {
                // When relating callback signatures, we still need to relate return types bi-variantly as otherwise the containing type wouldn't be co-variant.
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
                    // The errors reported here serve as markers that trigger error chain reduction in the (*Relater).reportError method. The markers are elided in the final diagnostic chain and never actually reported.
                    let construct = self.signatures[source]
                        .flags
                        .intersects(SignatureFlags::CONSTRUCT);
                    let message = if self.signatures[source].parameters.len() == 0
                        && self.signatures[target].parameters.len() == 0
                    {
                        if construct {
                            diagnostics::CONSTRUCT_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1
                        } else {
                            diagnostics::CALL_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1
                        }
                    } else if construct {
                        diagnostics::CONSTRUCT_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE
                    } else {
                        diagnostics::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE
                    };
                    let source_text = self.type_to_string(source_return_type);
                    let target_text = self.type_to_string(target_return_type);
                    self.call_error_reporter(
                        error_reporter,
                        message,
                        &[Arg::Str(source_text), Arg::Str(target_text)],
                    );
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
        let source_kind = self.type_predicates[source].kind;
        if source_kind != self.type_predicates[target].kind {
            if report_errors {
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::A_THIS_BASED_TYPE_GUARD_IS_NOT_COMPATIBLE_WITH_A_PARAMETER_BASED_TYPE_GUARD,
                    &[],
                );
                let source_text = self.type_predicate_to_string(source);
                let target_text = self.type_predicate_to_string(target);
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::TYPE_PREDICATE_0_IS_NOT_ASSIGNABLE_TO_1,
                    &[Arg::Str(source_text), Arg::Str(target_text)],
                );
            }
            return Ternary::FALSE;
        }
        if (source_kind == TypePredicateKind::IDENTIFIER
            || source_kind == TypePredicateKind::ASSERTS_IDENTIFIER)
            && self.type_predicates[source].parameter_index
                != self.type_predicates[target].parameter_index
        {
            if report_errors {
                let source_name = self.type_predicates[source].parameter_name;
                let target_name = self.type_predicates[target].parameter_name;
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::PARAMETER_0_IS_NOT_IN_THE_SAME_POSITION_AS_PARAMETER_1,
                    &[Arg::Str(source_name), Arg::Str(target_name)],
                );
                let source_text = self.type_predicate_to_string(source);
                let target_text = self.type_predicate_to_string(target);
                self.call_error_reporter(
                    error_reporter,
                    diagnostics::TYPE_PREDICATE_0_IS_NOT_ASSIGNABLE_TO_1,
                    &[Arg::Str(source_text), Arg::Str(target_text)],
                );
            }
            return Ternary::FALSE;
        }
        let source_t = self.type_predicates[source].t;
        let target_t = self.type_predicates[target].t;
        let related = if source_t == target_t {
            Ternary::TRUE
        } else if !source_t.is_nil() && !target_t.is_nil() {
            self.call_type_comparer(compare_types, source_t, target_t, report_errors)
        } else {
            Ternary::FALSE
        };
        if related == Ternary::FALSE && report_errors {
            let source_text = self.type_predicate_to_string(source);
            let target_text = self.type_predicate_to_string(target);
            self.call_error_reporter(
                error_reporter,
                diagnostics::TYPE_PREDICATE_0_IS_NOT_ASSIGNABLE_TO_1,
                &[Arg::Str(source_text), Arg::Str(target_text)],
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

    pub fn put_relater(&mut self, r: RelaterId) {
        let next = self.free_relater;
        let rel = &mut self.relaters[r];
        rel.maybe_keys_set.clear();
        // `*r = Relater{...}`: every field is zero again; the four buffers keep their capacity.
        rel.relation = RelationKind::Nil;
        rel.error_node = NodeId::NIL;
        rel.error_chain = ErrorChainId::NIL;
        rel.error_chains.clear();
        rel.related_info = Vec::new();
        rel.maybe_keys.clear();
        rel.source_stack.clear();
        rel.target_stack.clear();
        rel.maybe_count = 0;
        rel.source_depth = 0;
        rel.target_depth = 0;
        rel.expanding_flags = ExpandingFlags::NONE;
        rel.overflow = false;
        rel.relation_count = 0;
        rel.next = next;
        self.free_relater = r;
    }
}

impl RelaterId {
    pub fn is_related_to_simple(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        self.is_related_to_ex(
            c,
            source,
            target,
            RecursionFlags::BOTH,
            false,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to_worker(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> Ternary {
        self.is_related_to_ex(
            c,
            source,
            target,
            RecursionFlags::BOTH,
            report_errors,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
    ) -> Ternary {
        self.is_related_to_ex(
            c,
            source,
            target,
            recursion_flags,
            report_errors,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    // Determine if possibly recursive types are related. First, check if the result is already available in the global cache. Second, check if we have already started a comparison of the given two types in which case we assume the result to be true. Third, check if both types are part of deeply nested chains of generic type instantiations and if so assume the types are equal and infinitely expanding. Fourth, if we have reached a depth of 100 nested comparisons, assume we have runaway recursion and issue an error. Otherwise, actually compare the structure of the two types.
    pub fn recursive_type_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
        recursion_flags: RecursionFlags,
    ) -> Ternary {
        let r = self;
        if !c.stack_check.is_safe_to_recurse() {
            // Out of stack is a stack depth overflow of the relation: upstream's own answer to one is overflow and False.
            c.relaters[r].overflow = true;
            return c.stack_limit();
        }
        if c.relaters[r].overflow {
            // Note that stack depth overflows can cause _any_ relation involving structured types to become false, so it is important to have well-defined behavior even in cases that shouldn't normally occur.
            return Ternary::FALSE;
        }
        let relation = c.relaters[r].relation;
        let (id, constrained) = get_relation_key(
            c,
            source,
            target,
            intersection_state,
            relation == RelationKind::Identity,
            false,
        );
        let entry = c.relation_get(relation, id);
        if entry != RelationComparisonResult::NONE {
            if report_errors
                && entry.intersects(RelationComparisonResult::FAILED)
                && !entry.intersects(RelationComparisonResult::OVERFLOW)
            {
                // We are elaborating errors and the cached result is a failure not due to a comparison overflow, so we will do the comparison again to generate an error message.
            } else {
                c.reliability_flags |= entry
                    & (RelationComparisonResult::REPORTS_UNMEASURABLE
                        | RelationComparisonResult::REPORTS_UNRELIABLE);
                if report_errors && entry.intersects(RelationComparisonResult::OVERFLOW) {
                    let source_text = c.type_to_string(source);
                    let target_text = c.type_to_string(target);
                    r.report_error(
                        c,
                        diagnostics::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1,
                        &[Arg::Str(source_text), Arg::Str(target_text)],
                    );
                }
                if entry.intersects(RelationComparisonResult::SUCCEEDED) {
                    return Ternary::TRUE;
                }
                return Ternary::FALSE;
            }
        }
        if c.relaters[r].relation_count <= 0 {
            c.relaters[r].overflow = true;
            return Ternary::FALSE;
        }
        // If source and target are already being compared, consider them related with assumptions
        if c.relaters[r].maybe_keys_set.has(&id) {
            return Ternary::MAYBE;
        }
        // A constrained key indicates that we have type references that reference constrained type parameters. For such keys we also check against the key we would have gotten if all type parameters were unconstrained.
        if constrained {
            let (broadest_equivalent_id, _) = get_relation_key(
                c,
                source,
                target,
                intersection_state,
                relation == RelationKind::Identity,
                true,
            );
            if c.relaters[r].maybe_keys_set.has(&broadest_equivalent_id) {
                return Ternary::MAYBE;
            }
        }
        if c.relaters[r].source_stack.len() == 100 || c.relaters[r].target_stack.len() == 100 {
            // We stop relating if we reach 100 levels of nesting. This is a backstop to catch infinite recursion that wasn't caught by isDeeplyNestedType.
            return Ternary::MAYBE;
        }
        let maybe_start = c.relaters[r].maybe_keys.len();
        c.relaters[r].maybe_keys.push(id);
        c.relaters[r].maybe_keys_set.add(id);
        let save_expanding_flags = c.relaters[r].expanding_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            c.relaters[r].source_stack.push(source);
            if !c.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::SOURCE)
            {
                let stack = c.relaters[r].source_stack.clone();
                if c.is_deeply_nested_type(source, &stack, 3) {
                    c.relaters[r].expanding_flags |= ExpandingFlags::SOURCE;
                }
            }
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            c.relaters[r].target_stack.push(target);
            if !c.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::TARGET)
            {
                let stack = c.relaters[r].target_stack.clone();
                if c.is_deeply_nested_type(target, &stack, 3) {
                    c.relaters[r].expanding_flags |= ExpandingFlags::TARGET;
                }
            }
        }
        let save_reliability_flags = c.reliability_flags;
        c.reliability_flags = RelationComparisonResult::NONE;
        let result = if c.relaters[r].expanding_flags == ExpandingFlags::BOTH {
            Ternary::MAYBE
        } else {
            r.structured_type_related_to(c, source, target, report_errors, intersection_state)
        };
        let propagating_variance_flags = c.reliability_flags;
        c.reliability_flags |= save_reliability_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            c.relaters[r].source_stack.pop();
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            c.relaters[r].target_stack.pop();
        }
        c.relaters[r].expanding_flags = save_expanding_flags;
        if result != Ternary::FALSE {
            if result == Ternary::TRUE
                || (c.relaters[r].source_stack.is_empty() && c.relaters[r].target_stack.is_empty())
            {
                if result == Ternary::TRUE || result == Ternary::MAYBE {
                    // If result is definitely true, record all maybe keys as having succeeded. Also, record Ternary.Maybe results as having succeeded once we reach depth 0, but never record Ternary.Unknown results.
                    r.reset_maybe_stack(c, maybe_start, propagating_variance_flags, true);
                } else {
                    r.reset_maybe_stack(c, maybe_start, propagating_variance_flags, false);
                }
            }
            // Note: it's intentional that we don't reset in the else case; we leave them on the stack such that when we hit depth zero above, we can report all of them as successful.
        } else {
            // A false result goes straight into global cache (when something is false under assumptions it will also be false without assumptions)
            c.relation_set(
                relation,
                id,
                RelationComparisonResult::FAILED | propagating_variance_flags,
            );
            c.relaters[r].relation_count -= 1;
            r.reset_maybe_stack(c, maybe_start, propagating_variance_flags, false);
        }
        result
    }

    pub fn reset_maybe_stack(
        self,
        c: &mut Checker<'_>,
        maybe_start: usize,
        propagating_variance_flags: RelationComparisonResult,
        mark_all_as_succeeded: bool,
    ) {
        let r = self;
        let relation = c.relaters[r].relation;
        let mut i = maybe_start;
        while i < c.relaters[r].maybe_keys.len() {
            let Some(&key) = c.relaters[r].maybe_keys.get(i) else {
                break;
            };
            c.relaters[r].maybe_keys_set.delete(&key);
            if mark_all_as_succeeded {
                c.relation_set(
                    relation,
                    key,
                    RelationComparisonResult::SUCCEEDED | propagating_variance_flags,
                );
                c.relaters[r].relation_count -= 1;
            }
            i += 1;
        }
        c.relaters[r].maybe_keys.truncate(maybe_start);
    }

    pub fn get_error_state(self, c: &Checker<'_>) -> ErrorState {
        ErrorState {
            error_chain: c.relaters[self].error_chain,
            related_info_len: c.relaters[self].related_info.len(),
        }
    }

    pub fn restore_error_state(self, c: &mut Checker<'_>, e: ErrorState) {
        c.relaters[self].error_chain = e.error_chain;
        c.relaters[self].related_info.truncate(e.related_info_len);
    }

    // See signatureAssignableTo, compareSignaturesIdentical
    pub fn signature_related_to(
        self,
        c: &mut Checker<'_>,
        mut source: SignatureId,
        mut target: SignatureId,
        erase: bool,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let mut check_mode = SignatureCheckMode::NONE;
        if c.relaters[r].relation == RelationKind::Subtype {
            check_mode = SignatureCheckMode::STRICT_TOP_SIGNATURE;
        } else if c.relaters[r].relation == RelationKind::StrictSubtype {
            check_mode =
                SignatureCheckMode::STRICT_TOP_SIGNATURE | SignatureCheckMode::STRICT_ARITY;
        }
        if erase {
            source = c.get_erased_signature(source);
            target = c.get_erased_signature(target);
        }
        // The closure over r and intersectionState and the method value r.reportError are values.
        let is_related_to_worker = TypeComparer::Relater {
            r,
            intersection_state,
        };
        c.compare_signatures_related(
            source,
            target,
            check_mode,
            report_errors,
            Some(r),
            is_related_to_worker,
            c.report_unreliable_mapper,
        )
    }

    pub fn report_error<'a>(self, c: &mut Checker<'a>, mut message: MessageId, args: &[Arg<'a>]) {
        let r = self;
        // The variadic slice is written below: a copy of the caller's arguments.
        let mut args: Vec<Arg<'a>> = args.to_vec();
        if message == diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE {
            // Suppress if next message is an excess property error
            let next = r.get_chain_message(c, 0);
            if next == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1
                || next == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2
            {
                return;
            }
            // Transform a property incompatibility message for property 'x' followed by some elaboration message followed by a signature return type incompatibility message into a single return type incompatibility message for 'x()' or 'x(...)'
            let first = args.first().copied().unwrap_or_default();
            let mut arg: Vec<u8> = Vec::new();
            let second = r.get_chain_message(c, 1);
            if second == diagnostics::CALL_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1 {
                arg = [get_property_name_arg(c, first).as_slice(), b"()"].concat();
            } else if second == diagnostics::CONSTRUCT_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1 {
                arg = [b"new ", get_property_name_arg(c, first).as_slice(), b"()"].concat();
            } else if second == diagnostics::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE {
                arg = [get_property_name_arg(c, first).as_slice(), b"(...)"].concat();
            } else if second == diagnostics::CONSTRUCT_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE {
                arg = [b"new ", get_property_name_arg(c, first).as_slice(), b"(...)"].concat();
            }
            if !arg.is_empty() {
                message = diagnostics::THE_TYPES_RETURNED_BY_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES;
                let text = c.text(&arg);
                match args.first_mut() {
                    Some(slot) => *slot = Arg::Str(text),
                    None => c.slice_set(false),
                }
                let chain = c.relaters[r].error_chain;
                let next = c.relaters[r].error_chains[chain].next;
                c.relaters[r].error_chain = c.relaters[r].error_chains[next].next;
            }
            // Transform a property incompatibility message for property 'x' followed by some elaboration message followed by a property incompatibility message for property 'y' into a single property incompatibility message for 'x.y'
            let second = r.get_chain_message(c, 1);
            if second == diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE
                || second == diagnostics::THE_TYPES_OF_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES
                || second
                    == diagnostics::THE_TYPES_RETURNED_BY_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES
            {
                let head = get_property_name_arg(c, args.first().copied().unwrap_or_default());
                let chain = c.relaters[r].error_chain;
                let next = c.relaters[r].error_chains[chain].next;
                let tail =
                    get_property_name_arg(c, c.relaters[r].error_chains[next].args.at(0usize));
                let arg = add_to_dotted_name(&head, &tail);
                c.relaters[r].error_chain = c.relaters[r].error_chains[next].next;
                if message == diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE {
                    message = diagnostics::THE_TYPES_OF_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES;
                }
                let text = c.text(&arg);
                r.report_error(c, message, &[Arg::Str(text)]);
                return;
            }
        }
        let next = c.relaters[r].error_chain;
        let args = c.list_of(&args);
        let chain = c.relaters[r].error_chains.alloc(ErrorChain {
            next,
            message,
            args,
        });
        if chain.is_nil() {
            c.ast.fault(FaultKind::IdSpaceExhausted, "ErrorChain", 0, 0);
        }
        c.relaters[r].error_chain = chain;
    }

    pub fn get_chain_message(self, c: &Checker<'_>, mut index: isize) -> MessageId {
        let mut e = c.relaters[self].error_chain;
        loop {
            if e.is_nil() {
                return MessageId::NIL;
            }
            if index == 0 {
                return c.relaters[self].error_chains[e].message;
            }
            e = c.relaters[self].error_chains[e].next;
            index -= 1;
        }
    }
}

// relater.go 4960: `arg.(string)` is a type assertion.
pub fn get_property_name_arg<'a>(c: &Checker<'a>, arg: Arg<'a>) -> Vec<u8> {
    let s: Text<'a> = match arg {
        Arg::Str(s) => s,
        _ => {
            c.bad_cast("arg.(string)");
            b""
        }
    };
    if let Some(&first) = s.first() {
        if first == b'"' || first == b'\'' || first == b'`' {
            return [b"[", s, b"]"].concat();
        }
    }
    s.to_vec()
}

// relater.go 4911
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
        return [prefix, head.as_slice(), suffix].concat();
    }
    [prefix, head.as_slice(), b".", suffix].concat()
}

// relater.go 400 and checker.go 17723: free functions upstream.

// The chain is as long as the elaboration is deep: the entry tests the stack.
pub fn create_diagnostic_chain_from_error_chain(
    c: &mut Checker<'_>,
    r: RelaterId,
    mut chain: ErrorChainId,
    error_node: NodeId,
    related_info: &[DiagnosticId],
) -> DiagnosticId {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    while !chain.is_nil()
        && c.relaters[r].error_chains[chain]
            .message
            .elided_in_compatibility_pyramid()
    {
        chain = c.relaters[r].error_chains[chain].next;
    }
    if chain.is_nil() {
        return DiagnosticId::NIL;
    }
    let node = c.relaters[r].error_chains[chain];
    let next = create_diagnostic_chain_from_error_chain(c, r, node.next, error_node, related_info);
    if next.is_nil() {
        let diagnostic = c.new_diagnostic_for_node(error_node, node.message, node.args.as_slice());
        return c
            .diagnostic_store
            .set_related_info(diagnostic, related_info.to_vec());
    }
    c.diagnostic_store
        .new_diagnostic_chain(next, node.message, node.args.as_slice())
}

// checker.go 17723
pub fn get_relation_key(
    c: &mut Checker<'_>,
    mut source: TypeId,
    mut target: TypeId,
    intersection_state: IntersectionState,
    is_identity: bool,
    ignore_constraints: bool,
) -> (CacheHashKey, bool) {
    if is_identity && source.0 > target.0 {
        std::mem::swap(&mut source, &mut target);
    }
    let mut b = KeyBuilder::default();
    let mut constrained = false;
    if c.is_type_reference_with_generic_arguments(source)
        && c.is_type_reference_with_generic_arguments(target)
    {
        b.write_byte(b'g');
        constrained = c.write_generic_type_references(&mut b, source, target, ignore_constraints);
    } else {
        b.write_byte(b's');
        b.write_type(source);
        b.write_type(target);
    }
    b.write_uint32(intersection_state.0);
    (b.hash(), constrained)
}
