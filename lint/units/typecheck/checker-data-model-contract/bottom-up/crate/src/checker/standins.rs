// The callees of the translated functions that this scratch does not port. In the crate each one sits at its upstream position in its own file. A stand-in records its upstream name and returns the fallback of its result type. A few answer from a script so that the tests can steer a caller.
use crate::checker::c01_data::RelationKind;
use crate::checker::c30_type_keys::KeyBuilder;
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    IntersectionState, RecursionFlags, RelationComparisonResult, TypeFacts, TypeFlags,
};
use crate::checker::types::Ternary;
use crate::diagnostics::MessageId;
use crate::tscore::golang::{List, Text};
use crate::tscore::ids::{
    DiagnosticId, InferenceContextId, InferenceStateId, NodeId, RelaterId, SignatureId, SymbolId,
    TypeAliasId, TypeId, TypeMapperId, TypePredicateId,
};

// What a test wants a stand-in to answer: (upstream name, id of the first argument) gives the id or number of the result.
#[derive(Default)]
pub struct Scripted {
    pub answers: Vec<(&'static str, u32, u32)>,
}

impl Scripted {
    pub fn get(&self, name: &str, argument: u32) -> Option<u32> {
        self.answers
            .iter()
            .find(|answer| answer.0 == name && answer.1 == argument)
            .map(|answer| answer.2)
    }
}

// (c: &mut Checker, source, target): the callback of applyToParameterTypes and applyToReturnTypes.
pub type TypePairCallback<'c, 'a> = &'c mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId);

impl<'a> Checker<'a> {
    // checker.go 25068
    pub fn get_unique_literal_type_for_type_parameter(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.unique_literal_type;
        }
        t
    }

    // checker.go 1142
    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNRELIABLE;
        }
        t
    }

    // checker.go 1149
    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNMEASURABLE;
        }
        t
    }

    // checker.go 24648
    pub fn restrictive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.get_restrictive_type_parameter(t);
        }
        t
    }

    // checker.go 24655
    pub fn permissive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.wildcard_type;
        }
        t
    }

    // checker.go 22063
    pub fn has_type_parameter_default(&mut self, t: TypeId) -> bool {
        let symbol = self.types[t].symbol;
        if symbol.is_nil() {
            return false;
        }
        let a = self.ast;
        a.sym(symbol).declarations.iter().any(|d| {
            crate::ast::ast_generated::is_type_parameter_declaration(a, d)
                && !a.as_type_parameter_declaration(d).default_type.is_nil()
        })
    }

    pub fn get_restrictive_type_parameter(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("getRestrictiveTypeParameter")
    }

    pub fn get_effective_type_argument_at_index(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
        index: isize,
    ) -> TypeId {
        let _ = (node, type_parameters, index);
        self.stand_in("getEffectiveTypeArgumentAtIndex")
    }

    pub fn infer_from_intra_expression_sites(&mut self, n: InferenceContextId) {
        let _ = n;
        self.stand_in("inferFromIntraExpressionSites")
    }

    pub fn get_inferred_type(&mut self, n: InferenceContextId, index: isize) -> TypeId {
        let _ = (n, index);
        self.stand_in("getInferredType")
    }

    pub fn get_inferred_types(&mut self, n: InferenceContextId) -> List<'a, TypeId> {
        let _ = n;
        self.stand_in("getInferredTypes")
    }

    pub fn infer_from_types(&mut self, n: InferenceStateId, source: TypeId, target: TypeId) {
        let _ = (n, source, target);
        self.stand_in("inferFromTypes")
    }

    pub fn get_union_type(&mut self, types: List<'a, TypeId>) -> TypeId {
        let _ = types;
        self.stand_in("getUnionType")
    }

    pub fn get_intersection_type(&mut self, types: List<'a, TypeId>) -> TypeId {
        let _ = types;
        self.stand_in("getIntersectionType")
    }

    pub fn get_alias_for_type_node(&mut self, node: NodeId) -> TypeAliasId {
        let _ = node;
        self.stand_in("getAliasForTypeNode")
    }

    pub fn instantiate_types(
        &mut self,
        types: List<'a, TypeId>,
        mapper: TypeMapperId,
    ) -> List<'a, TypeId> {
        let _ = (types, mapper);
        self.stand_in("instantiateTypes")
    }

    pub fn could_contain_type_variables_worker(&mut self, t: TypeId) -> bool {
        if let Some(answer) = self.scripted.get("couldContainTypeVariablesWorker", t.0) {
            return answer != 0;
        }
        self.stand_in("couldContainTypeVariablesWorker")
    }

    // The script turns it into `m.Map(t)`: what the worker does for a type parameter.
    pub fn instantiate_type_worker(
        &mut self,
        t: TypeId,
        m: TypeMapperId,
        alias: TypeAliasId,
    ) -> TypeId {
        let _ = alias;
        if self.scripted.get("instantiateTypeWorker", t.0).is_some() {
            return self.map(m, t);
        }
        self.stand_in("instantiateTypeWorker")
    }

    pub fn get_default_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        if let Some(answer) = self.scripted.get("getDefaultFromTypeParameter", t.0) {
            return TypeId(answer);
        }
        let _: TypeId = self.stand_in("getDefaultFromTypeParameter");
        TypeId::NIL
    }

    pub fn is_type_identical_to(&mut self, source: TypeId, target: TypeId) -> bool {
        let _ = (source, target);
        self.stand_in("isTypeIdenticalTo")
    }

    pub fn is_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
    ) -> bool {
        let _ = (target, relation);
        if let Some(answer) = self.scripted.get("isTypeRelatedTo", source.0) {
            return answer != 0;
        }
        self.stand_in("isTypeRelatedTo")
    }

    pub fn compare_types(&mut self, t1: TypeId, t2: TypeId) -> isize {
        let _ = (t1, t2);
        self.stand_in("CompareTypes")
    }

    pub fn is_named_member(&mut self, symbol: SymbolId, id: Text<'a>) -> bool {
        let _ = (symbol, id);
        self.stand_in("isNamedMember")
    }

    pub fn is_declaration_contained_by(&mut self, symbol: SymbolId, container: SymbolId) -> bool {
        let _ = (symbol, container);
        self.stand_in("isDeclarationContainedBy")
    }

    pub fn find_matching_signature(
        &mut self,
        signature_list: &[SignatureId],
        signature: SignatureId,
        partial_match: bool,
        ignore_this_types: bool,
        ignore_return_types: bool,
    ) -> SignatureId {
        let _ = (
            signature_list,
            signature,
            partial_match,
            ignore_this_types,
            ignore_return_types,
        );
        let _: SignatureId = self.stand_in("findMatchingSignature");
        SignatureId::NIL
    }

    pub fn find_matching_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
        signature: SignatureId,
        list_index: isize,
    ) -> List<'a, SignatureId> {
        let _ = (signature_lists, signature, list_index);
        self.stand_in("findMatchingSignatures")
    }

    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let _ = symbol;
        self.stand_in("getTypeOfSymbol")
    }

    pub fn create_symbol_with_type(&mut self, source: SymbolId, t: TypeId) -> SymbolId {
        let _ = (source, t);
        self.stand_in("createSymbolWithType")
    }

    pub fn create_union_signature(
        &mut self,
        sig: SignatureId,
        union_signatures: List<'a, SignatureId>,
    ) -> SignatureId {
        let _ = (sig, union_signatures);
        self.stand_in("createUnionSignature")
    }

    pub fn compare_type_parameters_identical(
        &mut self,
        source_params: List<'a, TypeId>,
        target_params: List<'a, TypeId>,
    ) -> bool {
        let _ = (source_params, target_params);
        self.stand_in("compareTypeParametersIdentical")
    }

    // The script gives the combined signature for `left`; without one the stand-in answers `left`.
    pub fn combine_union_or_intersection_member_signatures(
        &mut self,
        left: SignatureId,
        right: SignatureId,
        is_union: bool,
    ) -> SignatureId {
        let _ = (right, is_union);
        if let Some(answer) = self
            .scripted
            .get("combineUnionOrIntersectionMemberSignatures", left.0)
        {
            return SignatureId(answer);
        }
        let _: SignatureId = self.stand_in("combineUnionOrIntersectionMemberSignatures");
        left
    }

    pub fn is_deprecated_symbol(&mut self, symbol: SymbolId) -> bool {
        if let Some(answer) = self.scripted.get("isDeprecatedSymbol", symbol.0) {
            return answer != 0;
        }
        self.stand_in("isDeprecatedSymbol")
    }

    pub fn get_declaration_of_alias_symbol(&mut self, symbol: SymbolId) -> NodeId {
        if let Some(answer) = self.scripted.get("getDeclarationOfAliasSymbol", symbol.0) {
            return NodeId(answer);
        }
        self.stand_in("getDeclarationOfAliasSymbol")
    }

    pub fn resolve_alias(&mut self, symbol: SymbolId) -> SymbolId {
        if let Some(answer) = self.scripted.get("resolveAlias", symbol.0) {
            return SymbolId(answer);
        }
        let _: SymbolId = self.stand_in("resolveAlias");
        self.unknown_symbol
    }

    pub fn get_immediate_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        if let Some(answer) = self.scripted.get("getImmediateAliasedSymbol", symbol.0) {
            return SymbolId(answer);
        }
        self.stand_in("getImmediateAliasedSymbol")
    }

    pub fn add_deprecated_suggestion(
        &mut self,
        location: NodeId,
        declarations: List<'a, NodeId>,
        deprecated_entity: Text<'a>,
    ) -> DiagnosticId {
        let _ = (location, declarations, deprecated_entity);
        self.stand_in("addDeprecatedSuggestion")
    }

    pub fn type_to_string(&mut self, t: TypeId) -> Text<'a> {
        let _ = t;
        self.stand_in("TypeToString")
    }

    pub fn signature_to_string(&mut self, s: SignatureId) -> Text<'a> {
        let _ = s;
        self.stand_in("signatureToString")
    }

    pub fn type_predicate_to_string(&mut self, p: TypePredicateId) -> Text<'a> {
        let _ = p;
        self.stand_in("typePredicateToString")
    }

    // scanner.GetErrorRangeForNode belongs to the scanner: the stand-in answers the range of the node.
    pub fn get_error_range_for_node(
        &mut self,
        file: NodeId,
        node: NodeId,
    ) -> crate::tscore::text::TextRange {
        let _ = file;
        let _: () = self.stand_in("scanner.GetErrorRangeForNode");
        self.ast.loc(node)
    }

    // ast.IsImportCall and ast.IsInJSFile belong to the ast utilities.
    pub fn is_import_call(&mut self, node: NodeId) -> bool {
        let _ = node;
        self.stand_in("ast.IsImportCall")
    }

    pub fn is_in_js_file(&mut self, node: NodeId) -> bool {
        let _ = node;
        self.stand_in("ast.IsInJSFile")
    }

    pub fn is_top_signature(&mut self, s: SignatureId) -> bool {
        let _ = s;
        self.stand_in("isTopSignature")
    }

    // Answers the number of declared parameters: enough for signatures without a rest parameter.
    pub fn get_parameter_count(&mut self, s: SignatureId) -> isize {
        let _: isize = self.stand_in("getParameterCount");
        self.signatures[s].parameters.len()
    }

    pub fn has_effective_rest_parameter(&mut self, s: SignatureId) -> bool {
        let _ = s;
        self.stand_in("hasEffectiveRestParameter")
    }

    pub fn get_min_argument_count(&mut self, s: SignatureId) -> isize {
        let _: isize = self.stand_in("getMinArgumentCount");
        self.signatures[s].min_argument_count as isize
    }

    pub fn get_canonical_signature(&mut self, s: SignatureId) -> SignatureId {
        let _: SignatureId = self.stand_in("getCanonicalSignature");
        s
    }

    pub fn get_erased_signature(&mut self, s: SignatureId) -> SignatureId {
        let _: SignatureId = self.stand_in("getErasedSignature");
        s
    }

    pub fn get_non_array_rest_type(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        let _: TypeId = self.stand_in("getNonArrayRestType");
        TypeId::NIL
    }

    pub fn get_this_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        let _: TypeId = self.stand_in("getThisTypeOfSignature");
        TypeId::NIL
    }

    pub fn get_rest_or_any_type_at_position(&mut self, s: SignatureId, pos: isize) -> TypeId {
        let _ = (s, pos);
        self.stand_in("getRestOrAnyTypeAtPosition")
    }

    // The script answers by parameter symbol: the type of parameter `pos` of `s`.
    pub fn try_get_type_at_position(&mut self, s: SignatureId, pos: isize) -> TypeId {
        let parameter = self.signatures[s].parameters.at(pos);
        if let Some(answer) = self.scripted.get("tryGetTypeAtPosition", parameter.0) {
            return TypeId(answer);
        }
        let _: TypeId = self.stand_in("tryGetTypeAtPosition");
        TypeId::NIL
    }

    pub fn is_instantiated_generic_parameter(&mut self, s: SignatureId, pos: isize) -> bool {
        let _ = (s, pos);
        self.stand_in("isInstantiatedGenericParameter")
    }

    pub fn get_non_nullable_type(&mut self, t: TypeId) -> TypeId {
        let _: TypeId = self.stand_in("GetNonNullableType");
        t
    }

    pub fn get_single_call_signature(&mut self, t: TypeId) -> SignatureId {
        let _ = t;
        let _: SignatureId = self.stand_in("getSingleCallSignature");
        SignatureId::NIL
    }

    pub fn get_type_predicate_of_signature(&mut self, s: SignatureId) -> TypePredicateId {
        let _ = s;
        self.stand_in("getTypePredicateOfSignature")
    }

    pub fn get_type_facts(&mut self, t: TypeId, mask: TypeFacts) -> TypeFacts {
        let _ = (t, mask);
        self.stand_in("getTypeFacts")
    }

    pub fn get_parameter_name_at_position(&mut self, s: SignatureId, pos: isize) -> Text<'a> {
        let _: Text<'a> = self.stand_in("getParameterNameAtPosition");
        let parameter = self.signatures[s].parameters.at(pos);
        self.ast.sym(parameter).name
    }

    // The script answers by signature; without one the stand-in answers the resolved return type.
    pub fn get_non_circular_return_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        if let Some(answer) = self
            .scripted
            .get("getNonCircularReturnTypeOfSignature", s.0)
        {
            return TypeId(answer);
        }
        let _: TypeId = self.stand_in("getNonCircularReturnTypeOfSignature");
        self.signatures[s].resolved_return_type
    }

    pub fn is_type_reference_with_generic_arguments(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("isTypeReferenceWithGenericArguments")
    }

    pub fn write_generic_type_references(
        &mut self,
        b: &mut KeyBuilder,
        source: TypeId,
        target: TypeId,
        ignore_constraints: bool,
    ) -> bool {
        let _ = (b, source, target, ignore_constraints);
        self.stand_in("keyBuilder.writeGenericTypeReferences")
    }

    pub fn is_deeply_nested_type(&mut self, t: TypeId, stack: &[TypeId], max_depth: isize) -> bool {
        let _ = (t, stack, max_depth);
        self.stand_in("isDeeplyNestedType")
    }

    pub fn get_type_parameters_for_mapper(&mut self, s: SignatureId) -> List<'a, TypeId> {
        let _: List<'a, TypeId> = self.stand_in("getTypeParametersForMapper");
        self.signatures[s].type_parameters
    }

    pub fn get_effective_rest_type(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        let _: TypeId = self.stand_in("getEffectiveRestType");
        TypeId::NIL
    }

    pub fn instantiate_signature(&mut self, s: SignatureId, m: TypeMapperId) -> SignatureId {
        let _ = m;
        let _: SignatureId = self.stand_in("instantiateSignature");
        s
    }

    pub fn apply_to_parameter_types(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        callback: TypePairCallback<'_, 'a>,
    ) {
        let _ = (source, target, callback);
        self.stand_in("applyToParameterTypes")
    }

    // The script makes it call back once with the two resolved return types, as upstream does for plain signatures.
    pub fn apply_to_return_types(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        callback: TypePairCallback<'_, 'a>,
    ) {
        if self.scripted.get("applyToReturnTypes", source.0).is_some() {
            let source_return_type = self.signatures[source].resolved_return_type;
            let target_return_type = self.signatures[target].resolved_return_type;
            callback(self, source_return_type, target_return_type);
            return;
        }
        self.stand_in("applyToReturnTypes")
    }

    pub fn get_signature_instantiation(
        &mut self,
        s: SignatureId,
        type_arguments: List<'a, TypeId>,
        is_javascript: bool,
        inferred_type_parameters: List<'a, TypeId>,
    ) -> SignatureId {
        let _ = (type_arguments, is_javascript, inferred_type_parameters);
        let _: SignatureId = self.stand_in("getSignatureInstantiation");
        s
    }
}

impl RelaterId {
    // The script answers by source type: 0 False, 1 True, 2 Maybe. Without one: the stand-in.
    pub fn is_related_to_ex(
        self,
        c: &mut Checker<'_>,
        original_source: TypeId,
        original_target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
        head_message: MessageId,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (
            original_target,
            recursion_flags,
            report_errors,
            head_message,
            intersection_state,
        );
        // Upstream reads the relation on every path that does not end at `source == target`.
        let relation = c.relaters[self].relation;
        if c.relation(relation).is_none() {
            return Ternary::FALSE;
        }
        match c.scripted.get("Relater.isRelatedToEx", original_source.0) {
            Some(0) => Ternary::FALSE,
            Some(1) => Ternary::TRUE,
            Some(2) => Ternary::MAYBE,
            _ => c.stand_in("Relater.isRelatedToEx"),
        }
    }

    pub fn structured_type_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (target, report_errors, intersection_state);
        match c.scripted.get("Relater.structuredTypeRelatedTo", source.0) {
            Some(0) => Ternary::FALSE,
            Some(1) => Ternary::TRUE,
            Some(2) => Ternary::MAYBE,
            // The script value 3 recurses once into the same pair, as a self-referential type does.
            Some(3) => self.recursive_type_related_to(
                c,
                source,
                target,
                report_errors,
                intersection_state,
                RecursionFlags::BOTH,
            ),
            _ => c.stand_in("Relater.structuredTypeRelatedTo"),
        }
    }
}
