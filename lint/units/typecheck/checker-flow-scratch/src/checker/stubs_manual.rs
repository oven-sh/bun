// Scratch, read by gen_stubs.py and not compiled itself: the signature of each callee of flow.rs for as long as no file of the worktree defines it. Every receiver is `&mut self`, the worst case for the borrows of the caller, except the casts and sinks of the data model.
use crate::ast::{Arg, Ast, DiagnosticId, NodeId, SymbolId};
use crate::checker::data::*;
use crate::core::List;
use crate::diagnostics::MessageId;

impl<'a> Checker<'a> {
    pub fn as_evolving_array_type(&self, t: TypeId) -> &EvolvingArrayType { unimplemented!() }
    pub fn as_evolving_array_type_mut(&mut self, t: TypeId) -> &mut EvolvingArrayType { unimplemented!() }
    pub fn as_interface_type(&self, t: TypeId) -> &InterfaceType { unimplemented!() }
    pub fn as_literal_type(&self, t: TypeId) -> &LiteralType<'a> { unimplemented!() }
    pub fn as_substitution_type(&self, t: TypeId) -> &SubstitutionType { unimplemented!() }
    pub fn as_unique_es_symbol_type(&self, t: TypeId) -> &UniqueESSymbolType<'a> { unimplemented!() }
    pub fn check_expression(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn check_expression_cached(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn check_non_null_expression(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn check_non_null_type(&mut self, t: TypeId, node: NodeId) -> TypeId { unimplemented!() }
    pub fn check_super_expression(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn contains_missing_type(&mut self, t: TypeId) -> bool { unimplemented!() }
    pub fn error(&mut self, location: NodeId, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId { unimplemented!() }
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T { self.faults.set(self.faults.get() + 1); T::fallback(self) }
    pub fn fail_detail<T: Fallback<'a>>(&self, message: &'static str, detail: u32) -> T { unimplemented!() }
    pub fn get_apparent_type(&mut self, t: TypeId) -> TypeId { unimplemented!() }
    pub fn get_applicable_index_info_for_name(&mut self, t: TypeId, name: &[u8]) -> IndexInfoId { unimplemented!() }
    pub fn get_base_constraint_of_type(&mut self, t: TypeId) -> TypeId { unimplemented!() }
    pub fn get_base_constraint_or_type(&mut self, t: TypeId) -> TypeId { unimplemented!() }
    pub fn get_context_free_type_of_expression(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId { unimplemented!() }
    pub fn get_flow_type_of_property(&mut self, reference: NodeId, prop: SymbolId) -> TypeId { unimplemented!() }
    pub fn get_global_es_symbol_constructor_symbol_or_nil(&mut self) -> SymbolId { unimplemented!() }
    pub fn get_global_record_symbol(&mut self) -> SymbolId { unimplemented!() }
    pub fn get_literal_type_from_property_name(&mut self, name: NodeId) -> TypeId { unimplemented!() }
    pub fn get_optional_expression_type(&mut self, expr_type: TypeId, expression: NodeId) -> TypeId { unimplemented!() }
    pub fn get_property_of_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId { unimplemented!() }
    pub fn get_resolved_signature(&mut self, node: NodeId, candidates_out_array: Option<&mut Vec<SignatureId>>, check_mode: CheckMode) -> SignatureId { unimplemented!() }
    pub fn get_signatures_of_type(&mut self, t: TypeId, kind: SignatureKind) -> List<'a, SignatureId> { unimplemented!() }
    pub fn get_symbol_for_private_identifier_expression(&mut self, node: NodeId) -> SymbolId { unimplemented!() }
    pub fn get_type_facts(&mut self, t: TypeId, mask: TypeFacts) -> TypeFacts { unimplemented!() }
    pub fn get_type_of_expression(&mut self, node: NodeId) -> TypeId { unimplemented!() }
    pub fn get_type_of_property_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId { unimplemented!() }
    pub fn get_type_of_property_or_index_signature_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId { unimplemented!() }
    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId { unimplemented!() }
    pub fn has_type_facts(&mut self, t: TypeId, mask: TypeFacts) -> bool { unimplemented!() }
    pub fn is_block_scoped_name_declared_before_use(&mut self, declaration: NodeId, usage: NodeId) -> bool { unimplemented!() }
    pub fn is_constant_variable(&mut self, symbol: SymbolId) -> bool { unimplemented!() }
    pub fn is_constructor_type(&mut self, t: TypeId) -> bool { unimplemented!() }
    pub fn is_function_type(&mut self, t: TypeId) -> bool { unimplemented!() }
    pub fn is_no_infer_type(&mut self, t: TypeId) -> bool { unimplemented!() }
    pub fn is_parameter_or_mutable_local_variable(&mut self, symbol: SymbolId) -> bool { unimplemented!() }
    pub fn is_readonly_symbol(&mut self, symbol: SymbolId) -> bool { unimplemented!() }
    pub fn list_of<T: Copy>(&self, items: &[T]) -> List<'a, T> { unimplemented!() }
    pub fn map_set(&self, ok: bool) { assert!(ok, "assignment to entry in nil map") }
    pub fn new_object_type(&mut self, object_flags: ObjectFlags, symbol: SymbolId) -> TypeId { unimplemented!() }
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T { unimplemented!() }
}

// checker/utilities.go, not in the worktree yet: the shapes that the callers in the worktree use.
pub fn get_assignment_target_kind(a: Ast<'_>, node: NodeId) -> AssignmentKind { unimplemented!() }
pub fn is_in_compound_like_assignment(a: Ast<'_>, node: NodeId) -> bool { unimplemented!() }
pub fn has_only_expression_initializer(a: Ast<'_>, node: NodeId) -> bool { unimplemented!() }
pub fn has_dot_dot_dot_token(a: Ast<'_>, node: NodeId) -> bool { unimplemented!() }
pub fn is_type_any(c: &Checker<'_>, t: TypeId) -> bool { unimplemented!() }
pub fn is_empty_array_literal(a: Ast<'_>, expression: NodeId) -> bool { unimplemented!() }
pub fn is_type_usable_as_property_name(c: &Checker<'_>, t: TypeId) -> bool { unimplemented!() }
pub fn is_non_null_access(a: Ast<'_>, node: NodeId) -> bool { unimplemented!() }
pub fn get_binding_element_property_name(a: Ast<'_>, node: NodeId) -> NodeId { unimplemented!() }
pub fn is_call_chain(a: Ast<'_>, node: NodeId) -> bool { unimplemented!() }
