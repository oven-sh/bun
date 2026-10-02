
#[allow(unused_variables, clippy::too_many_arguments, clippy::needless_pass_by_value)]
impl<'a> Checker<'a> {
    // c02_program_checker.rs 739 and 816
    pub fn fail<T: Default>(&self, message: &'static str) -> T {
        T::default()
    }
    pub fn list_of<T: Copy + Default + 'a>(&self, items: &[T]) -> List<'a, T> {
        List::NIL
    }
    // c22_symbols_merge.rs
    pub fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        SymbolId::NIL
    }
    pub fn new_symbol_ex(
        &mut self,
        flags: SymbolFlags,
        name: Text<'a>,
        check_flags: CheckFlags,
    ) -> SymbolId {
        SymbolId::NIL
    }
    pub fn merge_symbol_table(
        &mut self,
        target: SymbolTableId,
        source: SymbolTableId,
        unidirectional: bool,
        merged_parent: SymbolId,
    ) {
    }
    pub fn merge_symbol(
        &mut self,
        target: SymbolId,
        source: SymbolId,
        unidirectional: bool,
    ) -> SymbolId {
        target
    }
    pub fn create_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        DiagnosticId::NIL
    }
    pub fn get_merged_symbol(&self, symbol: SymbolId) -> SymbolId {
        symbol
    }
    pub fn get_symbol_of_declaration(&mut self, node: NodeId) -> SymbolId {
        SymbolId::NIL
    }
    // c04_name_resolution_hooks.rs: get_symbol as it is, the seven others as the name resolver takes them.
    pub fn get_symbol(
        &mut self,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        SymbolId::NIL
    }
    pub fn symbol_referenced(&mut self, symbol: SymbolId, meaning: SymbolFlags) {}
    pub fn get_requires_scope_change_cache(&mut self, node: NodeId) -> Tristate {
        Tristate::UNKNOWN
    }
    pub fn set_requires_scope_change_cache(&mut self, node: NodeId, value: Tristate) {}
    pub fn check_and_report_error_for_invalid_initializer(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        property_with_invalid_initializer: NodeId,
        result: SymbolId,
    ) -> bool {
        false
    }
    pub fn on_failed_to_resolve_symbol(
        &mut self,
        error_location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
        name_not_found_message: MessageId,
    ) {
    }
    pub fn on_successfully_resolved_symbol(
        &mut self,
        error_location: NodeId,
        result: SymbolId,
        meaning: SymbolFlags,
        last_location: NodeId,
        associated_declaration_for_containing_initializer_or_binding_name: NodeId,
        within_deferred_context: bool,
    ) {
    }
    pub fn get_suggestion_for_symbol_name_lookup(
        &mut self,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        SymbolId::NIL
    }
    // c21_resolved_symbols_diagnostics.rs 206 and 232, utilities.rs 75
    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        diagnostic
    }
    pub fn error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        DiagnosticId::NIL
    }
    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        DiagnosticId::NIL
    }
    // utilities.rs 507, symbolaccessibility.rs 836
    pub fn compare_symbols_worker(&self, s1: SymbolId, s2: SymbolId) -> isize {
        0
    }
    pub fn compare_symbol_chains_worker(&self, a: &[SymbolId], b: &[SymbolId]) -> isize {
        0
    }
    // c24_external_modules.rs 87 and 831, c26_exports_late_binding.rs 65
    pub fn resolve_external_module_name_worker(
        &mut self,
        location: NodeId,
        module_reference_expression: NodeId,
        module_not_found_error: MessageId,
        ignore_errors: bool,
        is_for_augmentation: bool,
    ) -> SymbolId {
        SymbolId::NIL
    }
    pub fn resolve_external_module_symbol(
        &mut self,
        module_symbol: SymbolId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        module_symbol
    }
    pub fn get_resolved_members_or_exports_of_symbol(
        &mut self,
        symbol: SymbolId,
        resolution_kind: MembersOrExportsResolutionKind,
    ) -> SymbolTableId {
        SymbolTableId::NIL
    }
    // c38 1294, c39 474, c40 370, 381 and 394, c42 53, 67 and 93, c43 208 and 1476, c47 198
    pub fn get_declared_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        TypeId::NIL
    }
    pub fn evaluate_entity(&mut self, expr: NodeId, location: NodeId) -> evaluator::Result<'a> {
        evaluator::Result::default()
    }
    pub fn create_type_from_generic_global_type(
        &mut self,
        generic_global_type: TypeId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeId {
        generic_global_type
    }
    pub fn get_global_strict_function_type(&mut self, name: &[u8]) -> TypeId {
        if self.strict_bind_call_apply {
            return self.get_global_type(name, 0, true);
        }
        self.global_function_type
    }
    pub fn create_array_type(&mut self, element_type: TypeId) -> TypeId {
        element_type
    }
    pub fn get_string_literal_type(&mut self, value: Text<'a>) -> TypeId {
        TypeId::NIL
    }
    pub fn get_number_literal_type(&mut self, value: Number) -> TypeId {
        TypeId::NIL
    }
    pub fn get_big_int_literal_type(&mut self, value: PseudoBigInt) -> TypeId {
        TypeId::NIL
    }
    pub fn get_union_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        TypeId::NIL
    }
    pub fn is_empty_anonymous_object_type(&mut self, t: TypeId) -> bool {
        false
    }
    pub fn get_template_literal_type(
        &mut self,
        texts: &[&[u8]],
        types: List<'_, TypeId>,
    ) -> TypeId {
        TypeId::NIL
    }
    // c41_new_types.rs
    pub fn new_intrinsic_type(&mut self, flags: TypeFlags, intrinsic_name: Text<'a>) -> TypeId {
        TypeId::NIL
    }
    pub fn new_intrinsic_type_ex(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: Text<'a>,
        object_flags: ObjectFlags,
    ) -> TypeId {
        TypeId::NIL
    }
    pub fn create_widening_type(&mut self, non_widening_type: TypeId) -> TypeId {
        non_widening_type
    }
    pub fn create_unknown_union_type(&mut self) -> TypeId {
        TypeId::NIL
    }
    pub fn new_literal_type(
        &mut self,
        flags: TypeFlags,
        value: LiteralValue<'a>,
        regular_type: TypeId,
    ) -> TypeId {
        TypeId::NIL
    }
    pub fn new_object_type(&mut self, object_flags: ObjectFlags, symbol: SymbolId) -> TypeId {
        TypeId::NIL
    }
    pub fn new_anonymous_type(
        &mut self,
        symbol: SymbolId,
        members: SymbolTableId,
        call_signatures: List<'a, SignatureId>,
        construct_signatures: List<'a, SignatureId>,
        index_infos: List<'a, IndexInfoId>,
    ) -> TypeId {
        TypeId::NIL
    }
    pub fn new_type_parameter(&mut self, symbol: SymbolId) -> TypeId {
        TypeId::NIL
    }
    pub fn new_signature(
        &mut self,
        flags: SignatureFlags,
        declaration: NodeId,
        type_parameters: List<'a, TypeId>,
        this_parameter: SymbolId,
        parameters: List<'a, SymbolId>,
        resolved_return_type: TypeId,
        resolved_type_predicate: TypePredicateId,
        min_argument_count: isize,
    ) -> SignatureId {
        SignatureId::NIL
    }
    // types.rs: the casts and Type.Types
    pub fn as_literal_type_mut(&mut self, t: TypeId) -> &mut LiteralType<'a> {
        &mut self.sink_literal
    }
    pub fn as_object_type_mut(&mut self, t: TypeId) -> &mut ObjectType<'a> {
        &mut self.sink_object
    }
    pub fn as_type_parameter_mut(&mut self, t: TypeId) -> &mut TypeParameter {
        &mut self.sink_type_parameter
    }
    pub fn as_interface_type(&self, t: TypeId) -> &InterfaceType<'a> {
        &self.sink_interface
    }
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        List::NIL
    }
    // links.rs 14
    pub fn value_symbol_links_get(&mut self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        self.value_symbol_links.get(symbol)
    }
}
