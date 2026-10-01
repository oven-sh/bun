// Scratch stand-in (not part of the repository) for the parts of package checker that K3 steps 28 to 30 call and that no file of the tree defines yet: one line per function, the shape that the callers of the tree use. A line is dropped when the tree defines the function.
#![allow(unused_variables, unused_mut, unused_imports)]
use super::*;
use crate::ast::{Arg, Ast, DiagnosticId, NodeId, SymbolFlags, SymbolId, SymbolTableId};
use crate::core::{List, LiveList, Map, Text};
use crate::diagnostics::MessageId;

// nodebuilder.rs of the tree has its own callees: the Checker only holds the state.
#[derive(Default)]
pub struct NodeBuilderState;

// c30_type_keys.rs (not in the tree yet)
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct CacheHashKey {
    pub hi: u64,
    pub lo: u64,
}
impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        Self { hi: bytes.len() as u64, lo: bytes.iter().map(|b| u64::from(*b)).sum() }
    }
}

// relater.rs 76
pub type DiagnosticFactory<'c, 'a> = &'c mut dyn FnMut(&mut Checker<'a>, NodeId) -> DiagnosticId;

// relater.rs: the trait behind discriminateTypeByDiscriminableItems.
pub trait Discriminator<'a> {
    fn len(&self) -> isize;
    fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a>;
    fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool;
}
// checker.go: ObjectLiteralDiscriminator{c, props, members}. The checker is a parameter of the methods.
pub struct ObjectLiteralDiscriminator<'a> {
    pub props: List<'a, NodeId>,
    pub members: List<'a, SymbolId>,
}
impl<'a> Discriminator<'a> for ObjectLiteralDiscriminator<'a> {
    fn len(&self) -> isize {
        self.props.len() + self.members.len()
    }
    fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a> {
        b""
    }
    fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool {
        false
    }
}

impl<'a> Checker<'a> {
    // c21 of the contract (D-SINK) and utilities.go
    pub fn add_deferred_diagnostic(&mut self, callback: DeferredDiagnosticCallback<'a>) { self.deferred_diagnostic_callbacks.push(callback); }
    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId { diagnostic }
    pub fn error(&mut self, location: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic)
    }
    pub fn add_error_or_suggestion(&mut self, is_error: bool, diagnostic: DiagnosticId) {}
    pub fn error_and_maybe_suggest_await(&mut self, location: NodeId, maybe_missing_await: bool, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId { self.stand_in("errorAndMaybeSuggestAwait") }
    pub fn new_diagnostic_for_node(&mut self, node: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId { self.stand_in("NewDiagnosticForNode") }
    pub fn new_diagnostic_chain_for_node(&mut self, chain: DiagnosticId, node: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId { self.stand_in("NewDiagnosticChainForNode") }

    // callees of mapper.rs that the tree does not have yet
    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId { t }
    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId { t }
    pub fn infer_from_intra_expression_sites(&mut self, n: InferenceContextId) {}
    pub fn get_inferred_type(&mut self, n: InferenceContextId, index: isize) -> TypeId { self.stand_in("getInferredType") }
    // mapper.go of the contract
    pub fn map(&mut self, m: TypeMapperId, t: TypeId) -> TypeId { self.stand_in("TypeMapper.Map") }

    // c41 of the contract
    pub fn new_anonymous_type(&mut self, symbol: SymbolId, members: SymbolTableId, call_signatures: List<'a, SignatureId>, construct_signatures: List<'a, SignatureId>, index_infos: List<'a, IndexInfoId>) -> TypeId { self.stand_in("newAnonymousType") }
    pub fn new_signature(&mut self, flags: SignatureFlags, declaration: NodeId, type_parameters: List<'a, TypeId>, this_parameter: SymbolId, parameters: List<'a, SymbolId>, resolved_return_type: TypeId, resolved_type_predicate: TypePredicateId, min_argument_count: isize) -> SignatureId { self.stand_in("newSignature") }

    // name resolution and globals (C-INIT, N-RESOLVE)
    pub fn resolve_name(&mut self, location: NodeId, name: &[u8], meaning: SymbolFlags, name_not_found_message: MessageId, is_use: bool, exclude_globals: bool) -> SymbolId { self.stand_in("resolveName") }
    pub fn get_global_symbol(&mut self, name: &[u8], meaning: SymbolFlags, diagnostic: MessageId) -> SymbolId { self.stand_in("getGlobalSymbol") }
    pub fn get_global_type(&mut self, name: &[u8], arity: isize, report_errors: bool) -> TypeId { self.stand_in("getGlobalType") }
    pub fn get_spelling_suggestion_for_name(&mut self, name: &[u8], symbols: &[SymbolId], meaning: SymbolFlags) -> SymbolId { self.stand_in("getSpellingSuggestionForName") }
    pub fn get_global_awaited_symbol(&mut self) -> SymbolId { self.stand_in("getGlobalAwaitedSymbol") }
    pub fn get_global_awaited_symbol_or_nil(&mut self) -> SymbolId { self.stand_in("getGlobalAwaitedSymbolOrNil") }
    pub fn get_global_promise_type(&mut self) -> TypeId { self.stand_in("getGlobalPromiseType") }
    pub fn get_global_iterator_type(&mut self) -> TypeId { self.stand_in("getGlobalIteratorType") }
    pub fn get_global_iterable_type(&mut self) -> TypeId { self.stand_in("getGlobalIterableType") }
    pub fn get_global_iterable_type_checked(&mut self) -> TypeId { self.stand_in("getGlobalIterableTypeChecked") }
    pub fn get_global_iterable_iterator_type(&mut self) -> TypeId { self.stand_in("getGlobalIterableIteratorType") }
    pub fn get_global_iterable_iterator_type_checked(&mut self) -> TypeId { self.stand_in("getGlobalIterableIteratorTypeChecked") }
    pub fn get_global_iterator_object_type(&mut self) -> TypeId { self.stand_in("getGlobalIteratorObjectType") }
    pub fn get_global_generator_type(&mut self) -> TypeId { self.stand_in("getGlobalGeneratorType") }
    pub fn get_global_async_iterator_type(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIteratorType") }
    pub fn get_global_async_iterable_type(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIterableType") }
    pub fn get_global_async_iterable_type_checked(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIterableTypeChecked") }
    pub fn get_global_async_iterable_iterator_type(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIterableIteratorType") }
    pub fn get_global_async_iterable_iterator_type_checked(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIterableIteratorTypeChecked") }
    pub fn get_global_async_iterator_object_type(&mut self) -> TypeId { self.stand_in("getGlobalAsyncIteratorObjectType") }
    pub fn get_global_async_generator_type(&mut self) -> TypeId { self.stand_in("getGlobalAsyncGeneratorType") }
    pub fn get_global_iterator_yield_result_type(&mut self) -> TypeId { self.stand_in("getGlobalIteratorYieldResultType") }
    pub fn get_global_iterator_return_result_type(&mut self) -> TypeId { self.stand_in("getGlobalIteratorReturnResultType") }
    pub fn get_global_typed_property_descriptor_type(&mut self) -> TypeId { self.stand_in("getGlobalTypedPropertyDescriptorType") }
    pub fn get_global_class_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassDecoratorContextType") }
    pub fn get_global_class_method_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassMethodDecoratorContextType") }
    pub fn get_global_class_getter_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassGetterDecoratorContextType") }
    pub fn get_global_class_setter_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassSetterDecoratorContextType") }
    pub fn get_global_class_accessor_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassAccessorDecoratorContextType") }
    pub fn get_global_class_accessor_decorator_target_type(&mut self) -> TypeId { self.stand_in("getGlobalClassAccessorDecoratorTargetType") }
    pub fn get_global_class_accessor_decorator_result_type(&mut self) -> TypeId { self.stand_in("getGlobalClassAccessorDecoratorResultType") }
    pub fn get_global_class_field_decorator_context_type(&mut self) -> TypeId { self.stand_in("getGlobalClassFieldDecoratorContextType") }

    // expressions, calls, contextual types, inference (later steps)
    pub fn check_expression(&mut self, node: NodeId) -> TypeId { self.stand_in("checkExpression") }
    pub fn check_expression_cached(&mut self, node: NodeId) -> TypeId { self.stand_in("checkExpressionCached") }
    pub fn check_expression_ex(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId { self.stand_in("checkExpressionEx") }
    pub fn check_expression_for_mutable_location(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId { self.stand_in("checkExpressionForMutableLocation") }
    pub fn check_expression_with_contextual_type(&mut self, node: NodeId, contextual_type: TypeId, inference_context: InferenceContextId, check_mode: CheckMode) -> TypeId { self.stand_in("checkExpressionWithContextualType") }
    pub fn check_computed_property_name(&mut self, node: NodeId) -> TypeId { self.stand_in("checkComputedPropertyName") }
    pub fn check_deprecated_signature(&mut self, signature: SignatureId, node: NodeId) {}
    pub fn check_grammar_await_or_await_using(&mut self, node: NodeId) -> bool { self.stand_in("checkGrammarAwaitOrAwaitUsing") }
    pub fn check_grammar_decorator(&mut self, node: NodeId) -> bool { self.stand_in("checkGrammarDecorator") }
    pub fn check_grammar_jsx_element(&mut self, node: NodeId) -> bool { self.stand_in("checkGrammarJsxElement") }
    pub fn check_grammar_jsx_expression(&mut self, node: NodeId) -> bool { self.stand_in("checkGrammarJsxExpression") }
    pub fn check_spread_prop_overrides(&mut self, t: TypeId, props: SymbolTableId, spread: NodeId) {}
    pub fn create_synthetic_expression(&mut self, parent: NodeId, t: TypeId, is_spread: bool, tuple_name_source: NodeId) -> NodeId { self.stand_in("createSyntheticExpression") }
    pub fn add_intra_expression_inference_site(&mut self, context: InferenceContextId, node: NodeId, t: TypeId) {}
    pub fn find_contextual_node(&mut self, node: NodeId, include_caches: bool) -> isize { self.stand_in("findContextualNode") }
    pub fn get_apparent_type_of_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId { self.stand_in("getApparentTypeOfContextualType") }
    pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId { self.stand_in("getContextualType") }
    pub fn get_contextual_type_for_argument_at_index(&mut self, call_target: NodeId, arg_index: isize) -> TypeId { self.stand_in("getContextualTypeForArgumentAtIndex") }
    pub fn get_type_of_property_of_contextual_type(&mut self, t: TypeId, name: &[u8]) -> TypeId { self.stand_in("getTypeOfPropertyOfContextualType") }
    pub fn get_inference_context(&mut self, node: NodeId) -> InferenceContextId { InferenceContextId::NIL }
    pub fn get_inferred_types(&mut self, n: InferenceContextId) -> List<'a, TypeId> { self.stand_in("getInferredTypes") }
    pub fn infer_types(&mut self, inferences: LiveList<'a, InferenceInfoId>, original_source: TypeId, original_target: TypeId, priority: InferencePriority, contravariant: bool) {}
    pub fn get_resolved_signature(&mut self, node: NodeId, candidates_out_array: Option<&mut Vec<SignatureId>>, check_mode: CheckMode) -> SignatureId { self.stand_in("getResolvedSignature") }
    pub fn resolve_call(&mut self, node: NodeId, signatures: List<'a, SignatureId>, candidates_out_array: Option<&mut Vec<SignatureId>>, check_mode: CheckMode, call_chain_flags: SignatureFlags, head_message: MessageId) -> SignatureId { self.stand_in("resolveCall") }
    pub fn resolve_error_call(&mut self, node: NodeId) -> SignatureId { self.stand_in("resolveErrorCall") }
    pub fn resolve_untyped_call(&mut self, node: NodeId) -> SignatureId { self.stand_in("resolveUntypedCall") }
    pub fn is_untyped_function_call(&mut self, func_type: TypeId, apparent_func_type: TypeId, num_call_signatures: isize, num_construct_signatures: isize) -> bool { self.stand_in("isUntypedFunctionCall") }
    pub fn invocation_error_details(&mut self, error_target: NodeId, apparent_type: TypeId, kind: SignatureKind) -> DiagnosticId { self.stand_in("invocationErrorDetails") }
    pub fn invocation_error_recovery(&mut self, apparent_type: TypeId, kind: SignatureKind, diagnostic: DiagnosticId) {}
    pub fn is_context_sensitive(&mut self, node: NodeId) -> bool { self.stand_in("isContextSensitive") }
    pub fn is_possibly_discriminant_value(&mut self, node: NodeId) -> bool { self.stand_in("isPossiblyDiscriminantValue") }
    pub fn get_symbol_at_location(&mut self, node: NodeId, ignore_errors: bool) -> SymbolId { self.stand_in("getSymbolAtLocation") }
    pub fn get_type_of_node(&mut self, node: NodeId) -> TypeId { self.stand_in("getTypeOfNode") }
    pub fn get_first_transformable_static_class_element(&mut self, node: NodeId) -> NodeId { self.stand_in("getFirstTransformableStaticClassElement") }

    // types (other layers)
    pub fn create_type_reference(&mut self, target: TypeId, type_arguments: List<'a, TypeId>) -> TypeId { self.stand_in("createTypeReference") }
    pub fn try_create_type_reference(&mut self, target: TypeId, type_arguments: List<'a, TypeId>) -> TypeId { self.stand_in("tryCreateTypeReference") }
    pub fn fill_missing_type_arguments(&mut self, type_arguments: List<'a, TypeId>, type_parameters: List<'a, TypeId>, min_type_argument_count: isize, is_javascript_implicit_any: bool) -> List<'a, TypeId> { self.stand_in("fillMissingTypeArguments") }
    pub fn get_min_type_argument_count(&mut self, type_parameters: List<'a, TypeId>) -> isize { self.stand_in("getMinTypeArgumentCount") }
    pub fn get_apparent_type(&mut self, t: TypeId) -> TypeId { self.stand_in("getApparentType") }
    pub fn get_applicable_index_info_for_name(&mut self, t: TypeId, name: &[u8]) -> IndexInfoId { IndexInfoId::NIL }
    pub fn get_applicable_index_symbol(&mut self, t: TypeId, key_type: TypeId) -> SymbolId { self.stand_in("getApplicableIndexSymbol") }
    pub fn get_base_constraint_of_type(&mut self, t: TypeId) -> TypeId { self.stand_in("getBaseConstraintOfType") }
    pub fn get_base_constraint_or_type(&mut self, t: TypeId) -> TypeId { self.stand_in("getBaseConstraintOrType") }
    pub fn get_index_type_of_type(&mut self, t: TypeId, key_type: TypeId) -> TypeId { self.stand_in("getIndexTypeOfType") }
    pub fn get_indexed_access_type(&mut self, object_type: TypeId, index_type: TypeId) -> TypeId { self.stand_in("getIndexedAccessType") }
    pub fn get_indexed_access_type_or_undefined(&mut self, object_type: TypeId, index_type: TypeId, access_flags: AccessFlags, access_node: NodeId, alias: TypeAliasId) -> TypeId { self.stand_in("getIndexedAccessTypeOrUndefined") }
    pub fn get_literal_type_from_property_name(&mut self, name: NodeId) -> TypeId { self.stand_in("getLiteralTypeFromPropertyName") }
    pub fn get_propagating_flags_of_types(&self, types: List<'_, TypeId>, exclude_kinds: TypeFlags) -> ObjectFlags { ObjectFlags::NONE }
    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> { self.stand_in("getPropertiesOfType") }
    pub fn get_property_name_for_known_symbol_name(&mut self, symbol_name: &[u8]) -> Vec<u8> { Vec::new() }
    pub fn get_property_name_from_index(&mut self, index_type: TypeId, access_node: NodeId) -> Vec<u8> { Vec::new() }
    pub fn get_property_of_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId { self.stand_in("getPropertyOfType") }
    pub fn get_reduced_type(&mut self, t: TypeId) -> TypeId { self.stand_in("getReducedType") }
    pub fn get_signatures_of_type(&mut self, t: TypeId, kind: SignatureKind) -> List<'a, SignatureId> { self.stand_in("getSignaturesOfType") }
    pub fn get_spread_type(&mut self, left: TypeId, right: TypeId, symbol: SymbolId, object_flags: ObjectFlags, readonly: bool) -> TypeId { self.stand_in("getSpreadType") }
    pub fn get_type_of_property_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId { self.stand_in("getTypeOfPropertyOfType") }
    pub fn get_type_of_property_or_index_signature_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId { self.stand_in("getTypeOfPropertyOrIndexSignatureOfType") }
    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId { self.stand_in("getTypeOfSymbol") }
    pub fn get_type_with_facts(&mut self, t: TypeId, include: TypeFacts) -> TypeId { self.stand_in("getTypeWithFacts") }
    pub fn get_union_signatures(&mut self, signature_lists: &[List<'a, SignatureId>]) -> List<'a, SignatureId> { self.stand_in("getUnionSignatures") }
    pub fn include_undefined_in_index_signature(&mut self, t: TypeId) -> TypeId { self.stand_in("includeUndefinedInIndexSignature") }
    pub fn is_valid_spread_type(&mut self, t: TypeId) -> bool { self.stand_in("isValidSpreadType") }
    pub fn remove_missing_type(&mut self, t: TypeId, is_optional: bool) -> TypeId { t }
}

// utilities.go and mapper.go: free functions upstream.
pub fn entity_name_to_string(a: Ast<'_>, name: NodeId) -> Vec<u8> { Vec::new() }
pub fn is_jsx_intrinsic_tag_name(a: Ast<'_>, tag_name: NodeId) -> bool { false }
pub fn is_type_any(c: &Checker<'_>, t: TypeId) -> bool { !t.is_nil() && c.types[t].flags.intersects(TypeFlags::ANY) }
// free functions that the data model imports from files that the tree does not have yet
pub fn value_to_string(value: &LiteralValue<'_>) -> Vec<u8> { Vec::new() }
pub fn clear_cached_inferences(c: &mut Checker<'_>, inferences: LiveList<'_, InferenceInfoId>) {}
pub fn is_this_type_parameter(c: &Checker<'_>, t: TypeId) -> bool { false }
