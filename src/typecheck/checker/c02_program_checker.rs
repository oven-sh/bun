// checker.go:553-906 (layer STRUCT): Program with the methods of Host that the checker calls, and the Checker. A field of upstream keeps its name and its place. Before those fields come what the port adds: the tree context, the stores of the records that upstream names by pointer, the lists that the checker makes, and the sinks for what upstream does with a panic.
use crate::ast::stable::Stable;
use crate::ast::{
    Arg, Ast, DiagnosticId, DiagnosticStore, DiagnosticsCollection, FlowNodeId, ModifierFlags,
    NodeFlags, NodeId, PatternAmbientModule, SourceFileMetaData, SymbolFlags, SymbolId,
    SymbolTableId,
};
use crate::checker::nodebuilder::NodeBuilderState;
use crate::checker::symbolaccessibility::SymbolTableID;
use crate::checker::{
    AliasSymbolLinks, ArrayLiteralLinks, AssertionLinks, AssignmentReducedKey, CacheHashKey,
    CachedSignatureKey, CachedTypeKey, CompositeSignature, CompositeSignatureId,
    ComputedNameNodeLinks, ConditionalRoot, ConditionalRootId, ContainingSymbolLinks,
    ContextualInfo, DeclaredTypeLinks, DeferredSymbolLinks, DiscriminatedContextualTypeKey,
    ElementFlags, EnumLiteralKey, EnumMemberLinks, EnumRelationKey, ErrorChainId, ExpandingFlags,
    ExportTypeLinks, FlowLoopInfo, FlowLoopKey, FlowState, FlowStateId, FlowType, IndexInfo,
    IndexInfoId, InferenceContext, InferenceContextId, InferenceContextInfo, InferenceInfo,
    InferenceInfoId, InferenceState, InferenceStateId, InstantiationExpressionKey, IterationTypes,
    IterationTypesKey, JsxElementLinks, LateBoundLinks, MappedSymbolLinks,
    MarkedAssignmentSymbolLinks, MembersAndExportsLinks, ModuleSymbolLinks, NarrowedTypeKey,
    NilSections, NodeLinkStore, NodeLinks, NonExistentPropertyKey, ObjectFlags, PropertiesTypesKey,
    Records, Relater, RelaterId, Relation, RelationComparisonResult, RelationKind,
    ReverseMappedSymbolLinks, ReverseMappedTypeKey, SharedFlow, Signature, SignatureFlags,
    SignatureId, SignatureLinks, SourceFileLinks, SpreadLinks, StringMappingKey,
    SubstitutionTypeKey, SwitchStatementLinks, SymbolArenaLinkStore, SymbolNodeLinks,
    SymbolReferenceLinks, Ternary, ThisAssignmentDeclarationKind, TupleElementInfo, Type,
    TypeAlias, TypeAliasId, TypeAliasLinks, TypeFacts, TypeFlags, TypeId, TypeMapper, TypeMapperId,
    TypeNodeLinks, TypePredicate, TypePredicateId, TypeResolution, UnionOfUnionKey,
    ValueSymbolLinks, VarianceFlags, VarianceLinks, VarianceStackEntry, WideningContext,
    WideningContextId,
};
use crate::collections::Set;
use crate::core::{
    CompilerOptions, LinkStore, List, LiveList, Map, Memo, ModuleKind, ModuleResolutionKind,
    ResolutionMode, ScriptTarget, Text, Tristate,
};
use crate::internal::{FaultKind, StandIns};
use crate::jsnum::PseudoBigInt;
use crate::module::ResolvedModule;
use crate::tspath::Path;
use bun_core::StackCheck;
use std::cell::Cell;

// tsoptions.ParsedCommandLine as far as the checker reads it: the options and the common source directory of a referenced project.
#[derive(Clone, Default, Debug)]
pub struct ParsedCommandLine {
    pub options: CompilerOptions,
    pub common_source_directory: Vec<u8>,
}

impl ParsedCommandLine {
    pub fn compiler_options(&self) -> &CompilerOptions {
        &self.options
    }

    pub fn common_source_directory(&self) -> &[u8] {
        &self.common_source_directory
    }
}

// tsoptions.SourceOutputAndProjectReference
#[derive(Clone, Copy, Default, Debug)]
pub struct SourceOutputAndProjectReference<'p> {
    pub source: &'p [u8],
    pub output_dts: &'p [u8],
    pub resolved: Option<&'p ParsedCommandLine>,
}

// Program of upstream with the five methods of Host (modulespecifiers.ModuleSpecifierGenerationHost) that the checker calls. A file is the id of its SourceFile node where upstream passes an ast.HasFileName or the tspath.Path of a file of the program, and a string of the program lives as long as the program.
pub trait Program<'p> {
    fn options(&self) -> &'p CompilerOptions;
    fn source_files(&self) -> &'p [NodeId];
    fn bind_source_files(&self);
    fn file_exists(&self, file_name: &[u8]) -> bool;
    fn get_source_file(&self, file_name: &[u8]) -> NodeId;
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId;
    fn get_emit_module_format_of_file(&self, source_file: NodeId) -> ModuleKind;
    fn get_emit_syntax_for_usage_location(
        &self,
        source_file: NodeId,
        usage_location: NodeId,
    ) -> ResolutionMode;
    fn get_implied_node_format_for_emit(&self, source_file: NodeId) -> ModuleKind;
    // None is the nil module of upstream.
    fn get_resolved_module(
        &self,
        current_source_file: NodeId,
        module_reference: &[u8],
        mode: ResolutionMode,
    ) -> Option<ResolvedModule<'p>>;
    // GetResolvedModules: the one caller ranges over every resolved module of every file, in no order that it depends on.
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(&ResolvedModule<'p>));
    // `GetPackagesMap()[packageName]` with its ok: the callers only look a name up.
    fn get_packages_map_entry(&self, package_name: &[u8]) -> Option<bool>;
    fn get_source_file_meta_data(&self, file: NodeId) -> SourceFileMetaData;
    // The module reference and the specifier node.
    fn get_jsx_runtime_import_specifier(&self, file: NodeId) -> (&'p [u8], NodeId);
    fn get_import_helpers_import_specifier(&self, file: NodeId) -> NodeId;
    fn source_file_may_be_emitted(&self, source_file: NodeId, force_dts_emit: bool) -> bool;
    fn is_source_file_default_library(&self, file: NodeId) -> bool;
    fn get_project_reference_from_output_dts(
        &self,
        file: NodeId,
    ) -> Option<SourceOutputAndProjectReference<'p>>;
    fn get_redirect_for_resolution(&self, file: NodeId) -> Option<&'p ParsedCommandLine>;
    fn common_source_directory(&self) -> &'p [u8];

    // Host

    fn use_case_sensitive_file_names(&self) -> bool;
    fn get_current_directory(&self) -> &'p [u8];
    // The path is of a file that need not be in the program.
    fn get_project_reference_from_source(
        &self,
        path: &Path,
    ) -> Option<SourceOutputAndProjectReference<'p>>;
    fn get_default_resolution_mode_for_file(&self, file: NodeId) -> ResolutionMode;
    fn get_mode_for_usage_location(&self, file: NodeId, usage_location: NodeId) -> ResolutionMode;
}

// An element of a list that the checker makes.
pub trait ListItem<'a>: Copy + Default + 'a {
    fn store(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Self]>>;
}

// An element of a list that upstream writes after it shared it.
pub trait LiveItem<'a>: Copy + Default + 'a {
    fn cells(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Cell<Self>]>>;
}

macro_rules! define_checker_arena {
    (lists { $($field:ident: $item:ty),* $(,)? } live { $($live:ident: $live_item:ty),* $(,)? }) => {
        // The lists and texts that one checker makes, where upstream allocates a slice or a string: nothing moves and nothing is freed before the arena.
        #[derive(Default)]
        pub struct CheckerArena<'a> {
            $($field: Stable<Box<[$item]>>,)*
            $($live: Stable<Box<[Cell<$live_item>]>>,)*
            bytes: Stable<Box<[u8]>>,
            allocated: Cell<usize>,
        }

        $(impl<'a> ListItem<'a> for $item {
            fn store(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Self]>> {
                &arena.$field
            }
        })*

        $(impl<'a> LiveItem<'a> for $live_item {
            fn cells(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Cell<Self>]>> {
                &arena.$live
            }
        })*
    };
}

define_checker_arena!(
    lists {
        type_ids: TypeId,
        symbol_ids: SymbolId,
        node_ids: NodeId,
        signature_ids: SignatureId,
        index_info_ids: IndexInfoId,
        tuple_element_infos: TupleElementInfo,
        variance_flags: VarianceFlags,
        texts: Text<'a>,
        args: Arg<'a>,
    }
    live {
        live_type_ids: TypeId,
        live_inference_info_ids: InferenceInfoId,
    }
);

impl<'a> CheckerArena<'a> {
    pub fn new() -> Self {
        Self::default()
    }

    // One allocation for a list: the empty slice for no element and once the store is full.
    pub fn alloc_slice_copy<T: ListItem<'a>>(&'a self, src: &[T]) -> &'a [T] {
        if src.is_empty() {
            return &[];
        }
        self.allocated
            .set(self.allocated.get().saturating_add(size_of_val(src)));
        match T::store(self).push(src.into()) {
            Some(slice) => slice,
            None => &[],
        }
    }

    pub fn alloc_cells<T: LiveItem<'a>>(&'a self, src: &[T]) -> &'a [Cell<T>] {
        if src.is_empty() {
            return &[];
        }
        self.allocated
            .set(self.allocated.get().saturating_add(size_of_val(src)));
        let cells: Box<[Cell<T>]> = src.iter().map(|value| Cell::new(*value)).collect();
        match T::cells(self).push(cells) {
            Some(slice) => slice,
            None => &[],
        }
    }

    pub fn alloc_bytes(&'a self, src: &[u8]) -> Text<'a> {
        if src.is_empty() {
            return &[];
        }
        self.allocated
            .set(self.allocated.get().saturating_add(src.len()));
        match self.bytes.push(src.into()) {
            Some(slice) => slice,
            None => &[],
        }
    }

    pub fn allocated_bytes(&self) -> usize {
        self.allocated.get()
    }
}

// `func()` of deferredDiagnosticCallbacks: a callback is run once, by produceDeferredDiagnostics, with the checker that upstream's closure captures.
pub type DeferredDiagnosticCallback<'a> = Box<dyn FnOnce(&mut Checker<'a>) + 'a>;

// The value that stands for the result of a function that upstream leaves through a panic, of a callee that is not ported yet, and of a recursion that is cut.
pub trait Fallback<'a>: Sized {
    fn fallback(c: &Checker<'a>) -> Self;
}

// Nil, false, zero and the empty value.
macro_rules! fallback_default {
    ($($ty:ty),* $(,)?) => {$(
        impl<'a> Fallback<'a> for $ty {
            fn fallback(_: &Checker<'a>) -> Self {
                <$ty>::default()
            }
        }
    )*};
}

fallback_default!(
    (),
    bool,
    isize,
    usize,
    i32,
    u32,
    i64,
    u64,
    f64,
    NodeId,
    SymbolId,
    SymbolTableId,
    FlowNodeId,
    DiagnosticId,
    TypeMapperId,
    TypeAliasId,
    IndexInfoId,
    TypePredicateId,
    ConditionalRootId,
    CompositeSignatureId,
    WideningContextId,
    InferenceContextId,
    InferenceInfoId,
    InferenceStateId,
    RelaterId,
    ErrorChainId,
    FlowStateId,
    CacheHashKey,
    TypeFlags,
    ObjectFlags,
    ElementFlags,
    SignatureFlags,
    VarianceFlags,
    TypeFacts,
    RelationComparisonResult,
    NodeFlags,
    ModifierFlags,
    SymbolFlags,
    Tristate,
    ModuleKind,
    IterationTypes,
    PseudoBigInt,
);

// The error type.
impl<'a> Fallback<'a> for TypeId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.error_type
    }
}

// The unknown signature.
impl<'a> Fallback<'a> for SignatureId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.unknown_signature
    }
}

impl<'a> Fallback<'a> for Ternary {
    fn fallback(_: &Checker<'a>) -> Self {
        Ternary::FALSE
    }
}

impl<'a> Fallback<'a> for FlowType {
    fn fallback(c: &Checker<'a>) -> Self {
        FlowType {
            t: c.error_type,
            incomplete: false,
        }
    }
}

impl<'a> Fallback<'a> for Text<'a> {
    fn fallback(_: &Checker<'a>) -> Self {
        b""
    }
}

impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
    fn fallback(_: &Checker<'a>) -> Self {
        List::NIL
    }
}

impl<'a, T> Fallback<'a> for Option<T> {
    fn fallback(_: &Checker<'a>) -> Self {
        None
    }
}

impl<'a, T> Fallback<'a> for Vec<T> {
    fn fallback(_: &Checker<'a>) -> Self {
        Vec::new()
    }
}

impl<'a, A: Fallback<'a>, B: Fallback<'a>> Fallback<'a> for (A, B) {
    fn fallback(c: &Checker<'a>) -> Self {
        (A::fallback(c), B::fallback(c))
    }
}

impl<'a, A: Fallback<'a>, B: Fallback<'a>, C: Fallback<'a>> Fallback<'a> for (A, B, C) {
    fn fallback(c: &Checker<'a>) -> Self {
        (A::fallback(c), B::fallback(c), C::fallback(c))
    }
}

// Checker

// One list of fields makes the struct and `&Checker{}`: a field of `args` is given by the caller, a field of `made` is made with its expression, and every other field starts as Go's zero value.
macro_rules! checker_fields {
    (
        args { $($arg:ident: $arg_ty:ty,)* }
        made { $($made:ident: $made_ty:ty = $made_value:expr,)* }
        zero { $($field:ident: $field_ty:ty,)* }
    ) => {
        pub struct Checker<'a> {
            $(pub $arg: $arg_ty,)*
            $(pub $made: $made_ty,)*
            $(pub $field: $field_ty,)*
        }

        impl<'a> Checker<'a> {
            // `c := &Checker{}` of NewChecker, which fills the fields in.
            pub fn zero($($arg: $arg_ty),*) -> Self {
                Self {
                    $($arg,)*
                    $($made: $made_value,)*
                    $($field: Default::default(),)*
                }
            }
        }
    };
}

checker_fields! {
    args {
        // The tree context: the files of the program and the open store of this checker, where its transient symbols and its synthetic nodes live. They take the place of symbolArena and factory.
        ast: Ast<'a>,
        lists: &'a CheckerArena<'a>,
        program: &'a dyn Program<'a>,
        compiler_options: &'a CompilerOptions,
    }
    made {
        // The stack of the thread that makes the checker: one checker, one thread.
        stack_check: StackCheck = StackCheck::init(),
    }
    zero {
        stand_ins: StandIns,
        // The records that upstream names by pointer. The stores of the signatures and of the index infos are signatureArena and indexInfoArena below.
        types: Records<TypeId, Type<'a>>,
        type_mappers: Records<TypeMapperId, TypeMapper<'a>>,
        type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        type_predicates: Records<TypePredicateId, TypePredicate<'a>>,
        conditional_roots: Records<ConditionalRootId, ConditionalRoot<'a>>,
        composite_signatures: Records<CompositeSignatureId, CompositeSignature<'a>>,
        widening_contexts: Records<WideningContextId, WideningContext<'a>>,
        inference_contexts: Records<InferenceContextId, InferenceContext<'a>>,
        inference_infos: Records<InferenceInfoId, InferenceInfo>,
        inference_states: Records<InferenceStateId, InferenceState<'a>>,
        relaters: Records<RelaterId, Relater<'a>>,
        flow_states: Records<FlowStateId, FlowState>,
        // What a failed cast of a type reads, and where it writes.
        nil_sections: NilSections<'a>,
        sink_sections: NilSections<'a>,
        // What a read of activeTypeMappersCaches outside its length gets.
        nil_cache: Map<CacheHashKey, TypeId>,
        // `len(c.activeTypeMappersCaches)`: the list keeps the emptied maps beyond its length for reuse, as upstream's capacity does.
        active_type_mappers_caches_len: usize,
        // The diagnostics of the two collections below.
        diagnostic_store: DiagnosticStore,
        // typeToStringNodebuilder
        node_builder: NodeBuilderState,

        id: u32,
        files: List<'a, NodeId>,
        file_index_map: Map<NodeId, isize>,
        // compareSymbols and compareSymbolChains are the methods compare_symbols and compare_symbol_chains.
        type_count: u32,
        symbol_count: u32,
        signature_count: u32,
        total_instantiation_count: u32,
        instantiation_count: u32,
        instantiation_depth: u32,
        conditional_constraint_depth: u32,
        inline_level: isize,
        serialization_level: isize,
        current_node: NodeId,
        variance_type_parameter: TypeId,
        language_version: ScriptTarget,
        module_kind: ModuleKind,
        module_resolution_kind: ModuleResolutionKind,
        is_inference_partially_blocked: bool,
        legacy_decorators: bool,
        emit_standard_class_fields: bool,
        strict_null_checks: bool,
        strict_function_types: bool,
        strict_bind_call_apply: bool,
        strict_property_initialization: bool,
        strict_builtin_iterator_return: bool,
        no_implicit_any: bool,
        no_implicit_this: bool,
        use_unknown_in_catch_variables: bool,
        exact_optional_property_types: bool,
        can_collect_symbol_alias_accessibility_data: bool,
        was_canceled: bool,
        array_variances: List<'a, VarianceFlags>,
        globals: SymbolTableId,
        // evaluate is the method that runs the evaluator with the entity evaluator of the checker.
        string_literal_types: Map<Text<'a>, TypeId>,
        // The key is the bits of the number with both zeros as one key. A NaN has nan_type.
        number_literal_types: Map<u64, TypeId>,
        nan_type: TypeId,
        bigint_literal_types: Map<PseudoBigInt, TypeId>,
        enum_literal_types: Map<EnumLiteralKey<'a>, TypeId>,
        enum_nan_literal_types: Map<SymbolId, TypeId>,
        indexed_access_types: Map<CacheHashKey, TypeId>,
        template_literal_types: Map<CacheHashKey, TypeId>,
        string_mapping_types: Map<StringMappingKey, TypeId>,
        unique_es_symbol_types: Map<SymbolId, TypeId>,
        this_expando_kinds: Map<SymbolId, ThisAssignmentDeclarationKind>,
        this_expando_locations: Map<SymbolId, NodeId>,
        subtype_reduction_cache: Map<CacheHashKey, List<'a, TypeId>>,
        cached_types: Map<CachedTypeKey, TypeId>,
        cached_signatures: Map<CachedSignatureKey, SignatureId>,
        undefined_properties: Map<Text<'a>, SymbolId>,
        narrowed_types: Map<NarrowedTypeKey, TypeId>,
        assignment_reduced_types: Map<AssignmentReducedKey, TypeId>,
        discriminated_contextual_types: Map<DiscriminatedContextualTypeKey, TypeId>,
        instantiation_expression_types: Map<InstantiationExpressionKey, TypeId>,
        substitution_types: Map<SubstitutionTypeKey, TypeId>,
        reverse_mapped_cache: Map<ReverseMappedTypeKey, TypeId>,
        reverse_homomorphic_mapped_cache: Map<ReverseMappedTypeKey, TypeId>,
        iteration_types_cache: Map<IterationTypesKey, IterationTypes>,
        marker_types: Set<TypeId>,
        resolving_explicit_type_of_symbol: Set<SymbolId>,
        undefined_symbol: SymbolId,
        arguments_symbol: SymbolId,
        require_symbol: SymbolId,
        unknown_symbol: SymbolId,
        unresolved_symbols: Map<Text<'a>, SymbolId>,
        error_types: Map<CacheHashKey, TypeId>,
        module_symbols: Map<NodeId, SymbolId>,
        global_this_symbol: SymbolId,
        symbol_table_alias_cache: Map<SymbolTableID, List<'a, SymbolId>>,
        class_expression_name_tables: Map<NodeId, SymbolTableId>,
        // resolveName and resolveNameForSymbolSuggestion are the methods that run the name resolver with the hooks of the checker.
        tuple_types: Map<CacheHashKey, TypeId>,
        union_types: Map<CacheHashKey, TypeId>,
        union_of_union_types: Map<UnionOfUnionKey, TypeId>,
        intersection_types: Map<CacheHashKey, TypeId>,
        properties_types: Map<PropertiesTypesKey, TypeId>,
        diagnostics: DiagnosticsCollection,
        suggestion_diagnostics: DiagnosticsCollection,
        // signatureArena
        signatures: Records<SignatureId, Signature<'a>>,
        // indexInfoArena
        index_infos: Records<IndexInfoId, IndexInfo<'a>>,
        merged_symbols: Map<SymbolId, SymbolId>,
        node_links: LinkStore<NodeId, NodeLinks>,
        signature_links: LinkStore<NodeId, SignatureLinks>,
        symbol_node_links: NodeLinkStore<SymbolNodeLinks>,
        type_node_links: LinkStore<NodeId, TypeNodeLinks<'a>>,
        enum_member_links: LinkStore<NodeId, EnumMemberLinks<'a>>,
        assertion_links: LinkStore<NodeId, AssertionLinks>,
        array_literal_links: LinkStore<NodeId, ArrayLiteralLinks>,
        switch_statement_links: LinkStore<NodeId, SwitchStatementLinks<'a>>,
        jsx_element_links: LinkStore<NodeId, JsxElementLinks>,
        computed_name_links: LinkStore<NodeId, ComputedNameNodeLinks<'a>>,
        symbol_reference_links: LinkStore<SymbolId, SymbolReferenceLinks>,
        // Read through value_symbol_links_get, value_symbol_links_has and value_symbol_links_try_get, which ask for the id of the symbol as upstream's store does.
        value_symbol_links: SymbolArenaLinkStore<ValueSymbolLinks>,
        mapped_symbol_links: LinkStore<SymbolId, MappedSymbolLinks>,
        deferred_symbol_links: LinkStore<SymbolId, DeferredSymbolLinks<'a>>,
        alias_symbol_links: LinkStore<SymbolId, AliasSymbolLinks>,
        module_symbol_links: LinkStore<SymbolId, ModuleSymbolLinks<'a>>,
        late_bound_links: LinkStore<SymbolId, LateBoundLinks>,
        export_type_links: LinkStore<SymbolId, ExportTypeLinks>,
        members_and_exports_links: LinkStore<SymbolId, MembersAndExportsLinks>,
        type_alias_links: LinkStore<SymbolId, TypeAliasLinks<'a>>,
        declared_type_links: LinkStore<SymbolId, DeclaredTypeLinks>,
        spread_links: LinkStore<SymbolId, SpreadLinks>,
        variance_links: LinkStore<SymbolId, VarianceLinks<'a>>,
        reverse_mapped_symbol_links: LinkStore<SymbolId, ReverseMappedSymbolLinks>,
        marked_assignment_symbol_links: LinkStore<SymbolId, MarkedAssignmentSymbolLinks>,
        symbol_container_links: LinkStore<SymbolId, ContainingSymbolLinks<'a>>,
        source_file_links: LinkStore<NodeId, SourceFileLinks<'a>>,
        // regExpScanner is made by the check of a regular expression literal.
        pattern_for_type: Map<TypeId, NodeId>,
        context_free_types: Map<NodeId, TypeId>,
        any_type: TypeId,
        auto_type: TypeId,
        wildcard_type: TypeId,
        blocked_string_type: TypeId,
        error_type: TypeId,
        unresolved_type: TypeId,
        non_inferrable_any_type: TypeId,
        intrinsic_marker_type: TypeId,
        unknown_type: TypeId,
        undefined_type: TypeId,
        undefined_widening_type: TypeId,
        missing_type: TypeId,
        undefined_or_missing_type: TypeId,
        optional_type: TypeId,
        null_type: TypeId,
        null_widening_type: TypeId,
        string_type: TypeId,
        number_type: TypeId,
        bigint_type: TypeId,
        regular_false_type: TypeId,
        false_type: TypeId,
        regular_true_type: TypeId,
        true_type: TypeId,
        boolean_type: TypeId,
        es_symbol_type: TypeId,
        void_type: TypeId,
        never_type: TypeId,
        silent_never_type: TypeId,
        implicit_never_type: TypeId,
        unreachable_never_type: TypeId,
        non_primitive_type: TypeId,
        string_or_number_type: TypeId,
        string_number_symbol_type: TypeId,
        number_or_big_int_type: TypeId,
        template_constraint_type: TypeId,
        numeric_string_type: TypeId,
        unique_literal_type: TypeId,
        unique_literal_mapper: TypeMapperId,
        reliability_flags: RelationComparisonResult,
        report_unreliable_mapper: TypeMapperId,
        report_unmeasurable_mapper: TypeMapperId,
        restrictive_mapper: TypeMapperId,
        permissive_mapper: TypeMapperId,
        empty_object_type: TypeId,
        empty_jsx_object_type: TypeId,
        empty_fresh_jsx_object_type: TypeId,
        empty_type_literal_type: TypeId,
        unknown_empty_object_type: TypeId,
        unknown_union_type: TypeId,
        empty_generic_type: TypeId,
        any_function_type: TypeId,
        no_constraint_type: TypeId,
        circular_constraint_type: TypeId,
        resolving_default_type: TypeId,
        marker_super_type: TypeId,
        marker_sub_type: TypeId,
        marker_other_type: TypeId,
        marker_super_type_for_check: TypeId,
        marker_sub_type_for_check: TypeId,
        no_type_predicate: TypePredicateId,
        any_signature: SignatureId,
        unknown_signature: SignatureId,
        resolving_signature: SignatureId,
        silent_never_signature: SignatureId,
        cached_arguments_referenced: Map<NodeId, bool>,
        enum_number_index_info: IndexInfoId,
        any_base_type_index_info: IndexInfoId,
        pattern_ambient_modules: Vec<PatternAmbientModule>,
        pattern_ambient_module_augmentations: SymbolTableId,
        global_object_type: TypeId,
        global_function_type: TypeId,
        global_callable_function_type: TypeId,
        global_newable_function_type: TypeId,
        global_array_type: TypeId,
        global_readonly_array_type: TypeId,
        global_string_type: TypeId,
        global_number_type: TypeId,
        global_boolean_type: TypeId,
        global_reg_exp_type: TypeId,
        global_this_type: TypeId,
        any_array_type: TypeId,
        auto_array_type: TypeId,
        any_readonly_array_type: TypeId,
        deferred_global_import_meta_expression_type: TypeId,
        contextual_binding_patterns: Vec<NodeId>,
        empty_string_type: TypeId,
        zero_type: TypeId,
        zero_big_int_type: TypeId,
        typeof_type: TypeId,
        type_resolutions: Vec<TypeResolution>,
        resolution_start: isize,
        variance_stack: Vec<VarianceStackEntry<'a>>,
        // `*int` upstream
        apparent_argument_count: Option<isize>,
        last_get_combined_node_flags_node: NodeId,
        last_get_combined_node_flags_result: NodeFlags,
        last_get_combined_modifier_flags_node: NodeId,
        last_get_combined_modifier_flags_result: ModifierFlags,
        // The head of the free list in inference_states
        freeinference_state: InferenceStateId,
        // The head of the free list in flow_states
        free_flow_state: FlowStateId,
        flow_loop_cache: Map<FlowLoopKey, TypeId>,
        flow_loop_stack: Vec<FlowLoopInfo>,
        shared_flows: Vec<SharedFlow>,
        antecedent_types: Vec<TypeId>,
        flow_analysis_disabled: bool,
        flow_invocation_count: isize,
        flow_type_cache: Map<NodeId, TypeId>,
        last_flow_node: FlowNodeId,
        last_flow_node_reachable: bool,
        flow_node_reachable: Map<FlowNodeId, bool>,
        flow_node_post_super: Map<FlowNodeId, bool>,
        renamed_binding_elements_in_types: Vec<NodeId>,
        contextual_infos: Vec<ContextualInfo>,
        inference_context_infos: Vec<InferenceContextInfo>,
        awaited_type_stack: Vec<TypeId>,
        reverse_mapped_source_stack: Vec<TypeId>,
        reverse_mapped_target_stack: Vec<TypeId>,
        reverse_expanding_flags: ExpandingFlags,
        // The head of the free list in relaters
        free_relater: RelaterId,
        // The five relations are values here: a `*Relation` of upstream is a RelationKind, which relation and relation_mut resolve.
        subtype_relation: Relation,
        strict_subtype_relation: Relation,
        assignable_relation: Relation,
        comparable_relation: Relation,
        identity_relation: Relation,
        enum_relation: Map<EnumRelationKey, RelationComparisonResult>,
        // A memoized getter of upstream is the method of its name, and its field holds the memoized value.
        get_global_es_symbol_type: Memo<TypeId>,
        get_global_big_int_type: Memo<TypeId>,
        get_global_import_meta_type: Memo<TypeId>,
        get_global_import_attributes_type: Memo<TypeId>,
        get_global_import_attributes_type_checked: Memo<TypeId>,
        get_global_non_nullable_type_alias_or_nil: Memo<SymbolId>,
        get_global_extract_symbol: Memo<SymbolId>,
        get_global_disposable_type: Memo<TypeId>,
        get_global_async_disposable_type: Memo<TypeId>,
        get_global_awaited_symbol: Memo<SymbolId>,
        get_global_awaited_symbol_or_nil: Memo<SymbolId>,
        get_global_nan_symbol_or_nil: Memo<SymbolId>,
        get_global_record_symbol: Memo<SymbolId>,
        get_global_template_strings_array_type: Memo<TypeId>,
        get_global_es_symbol_constructor_symbol_or_nil: Memo<SymbolId>,
        get_global_es_symbol_constructor_type_symbol_or_nil: Memo<SymbolId>,
        get_global_import_call_options_type: Memo<TypeId>,
        get_global_import_call_options_type_checked: Memo<TypeId>,
        get_global_promise_type: Memo<TypeId>,
        get_global_promise_type_checked: Memo<TypeId>,
        get_global_promise_like_type: Memo<TypeId>,
        get_global_promise_constructor_symbol: Memo<SymbolId>,
        get_global_promise_constructor_symbol_or_nil: Memo<SymbolId>,
        get_global_omit_symbol: Memo<SymbolId>,
        get_global_no_infer_symbol_or_nil: Memo<SymbolId>,
        get_global_iterator_type: Memo<TypeId>,
        get_global_iterable_type: Memo<TypeId>,
        get_global_iterable_type_checked: Memo<TypeId>,
        get_global_iterable_iterator_type: Memo<TypeId>,
        get_global_iterable_iterator_type_checked: Memo<TypeId>,
        get_global_iterator_object_type: Memo<TypeId>,
        get_global_generator_type: Memo<TypeId>,
        get_global_async_iterator_type: Memo<TypeId>,
        get_global_async_iterable_type: Memo<TypeId>,
        get_global_async_iterable_type_checked: Memo<TypeId>,
        get_global_async_iterable_iterator_type: Memo<TypeId>,
        get_global_async_iterable_iterator_type_checked: Memo<TypeId>,
        get_global_async_iterator_object_type: Memo<TypeId>,
        get_global_async_generator_type: Memo<TypeId>,
        get_global_iterator_yield_result_type: Memo<TypeId>,
        get_global_iterator_return_result_type: Memo<TypeId>,
        get_global_typed_property_descriptor_type: Memo<TypeId>,
        get_global_class_decorator_context_type: Memo<TypeId>,
        get_global_class_method_decorator_context_type: Memo<TypeId>,
        get_global_class_getter_decorator_context_type: Memo<TypeId>,
        get_global_class_setter_decorator_context_type: Memo<TypeId>,
        // getGlobalClassAccessorDecoratorContxtType is never assigned and never read upstream.
        get_global_class_accessor_decorator_context_type: Memo<TypeId>,
        get_global_class_accessor_decorator_target_type: Memo<TypeId>,
        get_global_class_accessor_decorator_result_type: Memo<TypeId>,
        get_global_class_field_decorator_context_type: Memo<TypeId>,
        // syncIterationTypesResolver and asyncIterationTypesResolver are the two values of IterationTypesResolverKind. isPrimitiveOrObjectOrEmptyType, containsMissingType, couldContainTypeVariables, isStringIndexSignatureOnlyType and markNodeAssignments are the methods that NewChecker binds them to, compareTypesAssignable is TypeComparer::Assignable, and the emit resolver belongs to declaration emit.
        jsx_namespace: Text<'a>,
        jsx_factory_entity: NodeId,
        skip_direct_inference_nodes: Set<NodeId>,
        // ctx: a check is not canceled.
        packages_map: Map<Text<'a>, bool>,
        active_mappers: Vec<TypeMapperId>,
        active_type_mappers_caches: Vec<Map<CacheHashKey, TypeId>>,
        // ambientModulesOnce is the `done` of the memoized list.
        ambient_modules: Memo<List<'a, SymbolId>>,
        within_unreachable_code: bool,
        reported_unreachable_nodes: Set<NodeId>,
        non_existent_properties: Set<NonExistentPropertyKey>,
        deferred_diagnostic_callbacks: Vec<DeferredDiagnosticCallback<'a>>,
        // mu and tracer: one checker on one thread, and tracing is not ported.
    }
}

impl<'a> Checker<'a> {
    fn record_fault(&self, kind: FaultKind, message: &'static str, detail: u32) {
        self.ast.fault(kind, message, detail, self.current_node.0);
    }

    // `panic(message)`: an internal diagnostic, and the fallback of the result.
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
        self.fail_detail(message, 0)
    }

    // `panic(message + value.String())`: the value is the detail of the internal diagnostic.
    pub fn fail_detail<T: Fallback<'a>>(&self, message: &'static str, detail: u32) -> T {
        self.record_fault(FaultKind::Panic, message, detail);
        T::fallback(self)
    }

    // `debug.Assert(value, message)`
    pub fn assert(&self, value: bool, message: &'static str) {
        if !value {
            self.record_fault(FaultKind::Assert, message, 0);
        }
    }

    // A type assertion of upstream that fails, and a cast of a type to data that it does not have.
    pub fn bad_cast(&self, message: &'static str) {
        self.record_fault(FaultKind::BadCast, message, 0);
    }

    // The whole body of a function that is not ported yet: its name goes to the stand-in log.
    pub fn stand_in<T: Fallback<'a>>(&self, name: &'static str) -> T {
        self.stand_ins.record(name);
        T::fallback(self)
    }

    // `m[k] = v` of a map that can be nil: `ok` is what the write answered.
    pub fn map_set(&self, ok: bool) {
        if !ok {
            self.record_fault(FaultKind::NilMapWrite, "assignment to entry in nil map", 0);
        }
    }

    // `s[i] = v` with an index that can be outside the slice: `ok` is what the write answered.
    pub fn slice_set(&self, ok: bool) {
        if !ok {
            self.record_fault(FaultKind::Panic, "index out of range", 0);
        }
    }

    // What a recursion answers when the thread has no stack left, where Go's stack grows.
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T {
        self.record_fault(FaultKind::StackLimit, "stack limit reached", 0);
        T::fallback(self)
    }

    // A loop over the state of the checker has spent its budget: the caller leaves it as a `break` of upstream does.
    pub fn loop_limit(&self, function: &'static str) {
        self.record_fault(FaultKind::LoopLimit, function, 0);
    }

    // Everything that upstream would have died of: the recorded faults, and the reads and writes through nil in the stores.
    pub fn internal_fault_count(&self) -> u32 {
        let nil = [
            self.types.nil_accesses(),
            self.signatures.nil_accesses(),
            self.index_infos.nil_accesses(),
            self.type_mappers.nil_accesses(),
            self.type_aliases.nil_accesses(),
            self.type_predicates.nil_accesses(),
            self.conditional_roots.nil_accesses(),
            self.composite_signatures.nil_accesses(),
            self.widening_contexts.nil_accesses(),
            self.inference_contexts.nil_accesses(),
            self.inference_infos.nil_accesses(),
            self.inference_states.nil_accesses(),
            self.relaters.nil_accesses(),
            self.flow_states.nil_accesses(),
        ];
        nil.iter().fold(self.ast.open().faults.count(), |sum, n| {
            sum.saturating_add(*n)
        })
    }

    // `[]T{a, b}`, and a slice of upstream at the place where it is stored or returned. The list is not nil.
    pub fn list_of<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        List::from_slice(self.lists.alloc_slice_copy(items))
    }

    // A slice that upstream declares as nil and appends to: nil when nothing was appended.
    pub fn list<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        if items.is_empty() {
            return List::NIL;
        }
        self.list_of(items)
    }

    // slices.Clone: nil stays nil, and the copy has its own identity.
    pub fn clone_list<T: ListItem<'a>>(&self, list: List<'_, T>) -> List<'a, T> {
        if list.is_nil() {
            return List::NIL;
        }
        self.list_of(list.as_slice())
    }

    // A slice that upstream writes after another holder got it.
    pub fn live_list<T: LiveItem<'a>>(&self, items: &[T]) -> LiveList<'a, T> {
        LiveList::from_cells(self.lists.alloc_cells(items))
    }

    // A string that the checker builds and keeps.
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        self.lists.alloc_bytes(bytes)
    }

    // The relation behind a `*Relation` of upstream: None, and an internal diagnostic, for the nil relation.
    pub fn relation(&self, kind: RelationKind) -> Option<&Relation> {
        match kind {
            RelationKind::Nil => {
                self.record_fault(FaultKind::NilRead, "nil Relation", 0);
                None
            }
            RelationKind::Subtype => Some(&self.subtype_relation),
            RelationKind::StrictSubtype => Some(&self.strict_subtype_relation),
            RelationKind::Assignable => Some(&self.assignable_relation),
            RelationKind::Comparable => Some(&self.comparable_relation),
            RelationKind::Identity => Some(&self.identity_relation),
        }
    }

    pub fn relation_mut(&mut self, kind: RelationKind) -> Option<&mut Relation> {
        match kind {
            RelationKind::Nil => {
                self.record_fault(FaultKind::NilWrite, "nil Relation", 0);
                None
            }
            RelationKind::Subtype => Some(&mut self.subtype_relation),
            RelationKind::StrictSubtype => Some(&mut self.strict_subtype_relation),
            RelationKind::Assignable => Some(&mut self.assignable_relation),
            RelationKind::Comparable => Some(&mut self.comparable_relation),
            RelationKind::Identity => Some(&mut self.identity_relation),
        }
    }

    // core.Filter with a callback that takes the checker: the argument itself when nothing is removed, else a new list that is not nil.
    pub fn filter<T: ListItem<'a>>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> List<'a, T> {
        let items = slice.as_slice();
        for (i, &value) in items.iter().enumerate() {
            if !f(self, value) {
                let mut result: Vec<T> = Vec::with_capacity(items.len());
                result.extend_from_slice(items.get(..i).unwrap_or(&[]));
                for &value in items.get(i + 1..).unwrap_or(&[]) {
                    if f(self, value) {
                        result.push(value);
                    }
                }
                return self.list_of(&result);
            }
        }
        slice
    }

    // core.Map with a callback that takes the checker: nil for nil, else a new list of the same length.
    pub fn map_list<T: Copy + Default, U: ListItem<'a>>(
        &mut self,
        slice: List<'_, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> U,
    ) -> List<'a, U> {
        if slice.is_nil() {
            return List::NIL;
        }
        let items = slice.as_slice();
        let mut result: Vec<U> = Vec::with_capacity(items.len());
        for &value in items {
            let mapped = f(self, value);
            result.push(mapped);
        }
        self.list_of(&result)
    }

    // core.SameMap with a callback that takes the checker: the argument itself when no element changes.
    pub fn same_map<T: ListItem<'a> + PartialEq>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> T,
    ) -> List<'a, T> {
        let items = slice.as_slice();
        for (i, &value) in items.iter().enumerate() {
            let mapped = f(self, value);
            if mapped != value {
                let mut result: Vec<T> = Vec::with_capacity(items.len());
                result.extend_from_slice(items.get(..i).unwrap_or(&[]));
                result.push(mapped);
                for &value in items.get(i + 1..).unwrap_or(&[]) {
                    let mapped = f(self, value);
                    result.push(mapped);
                }
                return self.list_of(&result);
            }
        }
        slice
    }

    // core.Concatenate: one of the arguments when the other is empty.
    pub fn concatenate<T: ListItem<'a>>(&self, s1: List<'a, T>, s2: List<'a, T>) -> List<'a, T> {
        if s2.len() == 0 {
            return s1;
        }
        if s1.len() == 0 {
            return s2;
        }
        let result = [s1.as_slice(), s2.as_slice()].concat();
        self.list_of(&result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::stable::Arena;
    use crate::ast::{Frozen, IdAllocator, Open};
    use crate::checker::{
        LiteralType, LiteralValue, TypeData, TypeMapperKind, TypeParameter,
        UnionOrIntersectionType, UnionType, new_array_to_single_type_mapper,
        new_merged_type_mapper, new_simple_type_mapper, new_type_mapper,
    };
    use crate::core::same;

    // A program without files.
    struct NoProgram<'p> {
        options: &'p CompilerOptions,
    }

    impl<'p> Program<'p> for NoProgram<'p> {
        fn options(&self) -> &'p CompilerOptions {
            self.options
        }
        fn source_files(&self) -> &'p [NodeId] {
            &[]
        }
        fn bind_source_files(&self) {}
        fn file_exists(&self, _file_name: &[u8]) -> bool {
            false
        }
        fn get_source_file(&self, _file_name: &[u8]) -> NodeId {
            NodeId::NIL
        }
        fn get_source_file_for_resolved_module(&self, _file_name: &[u8]) -> NodeId {
            NodeId::NIL
        }
        fn get_emit_module_format_of_file(&self, _source_file: NodeId) -> ModuleKind {
            ModuleKind::NONE
        }
        fn get_emit_syntax_for_usage_location(
            &self,
            _source_file: NodeId,
            _usage_location: NodeId,
        ) -> ResolutionMode {
            ModuleKind::NONE
        }
        fn get_implied_node_format_for_emit(&self, _source_file: NodeId) -> ModuleKind {
            ModuleKind::NONE
        }
        fn get_resolved_module(
            &self,
            _current_source_file: NodeId,
            _module_reference: &[u8],
            _mode: ResolutionMode,
        ) -> Option<ResolvedModule<'p>> {
            None
        }
        fn for_each_resolved_module(&self, _f: &mut dyn FnMut(&ResolvedModule<'p>)) {}
        fn get_packages_map_entry(&self, _package_name: &[u8]) -> Option<bool> {
            None
        }
        fn get_source_file_meta_data(&self, _file: NodeId) -> SourceFileMetaData {
            SourceFileMetaData::default()
        }
        fn get_jsx_runtime_import_specifier(&self, _file: NodeId) -> (&'p [u8], NodeId) {
            (b"", NodeId::NIL)
        }
        fn get_import_helpers_import_specifier(&self, _file: NodeId) -> NodeId {
            NodeId::NIL
        }
        fn source_file_may_be_emitted(&self, _source_file: NodeId, _force_dts_emit: bool) -> bool {
            false
        }
        fn is_source_file_default_library(&self, _file: NodeId) -> bool {
            false
        }
        fn get_project_reference_from_output_dts(
            &self,
            _file: NodeId,
        ) -> Option<SourceOutputAndProjectReference<'p>> {
            None
        }
        fn get_redirect_for_resolution(&self, _file: NodeId) -> Option<&'p ParsedCommandLine> {
            None
        }
        fn common_source_directory(&self) -> &'p [u8] {
            b""
        }
        fn use_case_sensitive_file_names(&self) -> bool {
            true
        }
        fn get_current_directory(&self) -> &'p [u8] {
            b"/"
        }
        fn get_project_reference_from_source(
            &self,
            _path: &Path,
        ) -> Option<SourceOutputAndProjectReference<'p>> {
            None
        }
        fn get_default_resolution_mode_for_file(&self, _file: NodeId) -> ResolutionMode {
            ModuleKind::NONE
        }
        fn get_mode_for_usage_location(
            &self,
            _file: NodeId,
            _usage_location: NodeId,
        ) -> ResolutionMode {
            ModuleKind::NONE
        }
    }

    // `&Checker{}` over an open store and no file.
    fn with_checker(test: impl FnOnce(&mut Checker<'_>)) {
        let ids = IdAllocator::new();
        let arena = Arena::new();
        let open = Open::new(&arena, &ids);
        let frozen = Frozen::none();
        let lists = CheckerArena::new();
        let options = CompilerOptions::default();
        let program = NoProgram { options: &options };
        let mut c = Checker::zero(Ast::new(&frozen, &open), &lists, &program, &options);
        test(&mut c);
    }

    fn new_type(c: &mut Checker<'_>, flags: TypeFlags) -> TypeId {
        c.types.alloc(Type {
            flags,
            ..Type::default()
        })
    }

    #[test]
    fn the_zero_checker_has_no_record_and_reads_its_program() {
        with_checker(|c| {
            assert_eq!((c.types.count(), c.signatures.count()), (0, 0));
            assert!(c.any_type.is_nil() && c.globals.is_nil() && c.files.is_nil());
            assert!(c.string_literal_types.is_nil() && !c.ambient_modules.done);
            assert!(c.program.source_files().is_empty());
            assert_eq!(c.program.get_current_directory(), b"/");
            assert_eq!(c.internal_fault_count(), 0);
        });
    }

    #[test]
    fn a_cast_that_fails_is_a_fault_and_reads_the_zero_data() {
        with_checker(|c| {
            let t = c.types.alloc(Type {
                flags: TypeFlags::STRING_LITERAL,
                data: TypeData::Literal(LiteralType {
                    value: LiteralValue::String(b"a"),
                    ..LiteralType::default()
                }),
                ..Type::default()
            });
            assert_eq!(c.as_literal_type(t).value, LiteralValue::String(b"a"));
            c.as_literal_type_mut(t).fresh_type = t;
            assert_eq!(c.as_literal_type(t).fresh_type(), t);
            assert_eq!(c.internal_fault_count(), 0);

            assert!(c.as_union_type(t).types.is_nil());
            assert_eq!(
                c.ast.open().faults.first().map(|fault| fault.kind),
                Some(FaultKind::BadCast)
            );
            c.as_union_type_mut(t).origin = t;
            assert!(c.as_union_type(t).origin.is_nil());
            assert!(!c.has_structured_type(t));
            assert!(c.as_structured_type(t).members.is_nil());
            assert_eq!(c.internal_fault_count(), 4);
        });
    }

    #[test]
    fn an_embedded_struct_is_read_through_its_record() {
        with_checker(|c| {
            let a = new_type(c, TypeFlags::STRING);
            let b = new_type(c, TypeFlags::NUMBER);
            let never = new_type(c, TypeFlags::NEVER);
            let types = c.list_of(&[a, b]);
            let u = c.types.alloc(Type {
                flags: TypeFlags::UNION,
                data: TypeData::Union(Box::new(UnionType {
                    base: UnionOrIntersectionType {
                        types,
                        ..UnionOrIntersectionType::default()
                    },
                    ..UnionType::default()
                })),
                ..Type::default()
            });
            assert!(same(c.as_union_type(u).types.as_slice(), types.as_slice()));
            assert!(same(
                c.as_union_or_intersection_type(u).types.as_slice(),
                types.as_slice()
            ));
            assert!(same(c.type_types(u).as_slice(), types.as_slice()));
            assert!(same(c.type_distributed(u).as_slice(), types.as_slice()));
            assert_eq!(c.type_distributed(a).as_slice(), [a]);
            assert!(c.type_distributed(never).is_nil());
            assert!(c.has_structured_type(u) && c.has_constrained_type(u));
            assert!(!c.has_object_type(u));
            c.as_structured_type_mut(u).call_signature_count = 2;
            c.as_constrained_type_mut(u).resolved_base_constraint = a;
            assert_eq!(c.as_union_type(u).call_signature_count, 2);
            assert_eq!(c.as_union_type(u).resolved_base_constraint, a);
            assert!(c.types[u].is_union() && !c.types[u].is_intersection());
            assert_eq!(c.internal_fault_count(), 0);
        });
    }

    #[test]
    fn a_mapper_maps_as_its_kind_of_upstream_does() {
        with_checker(|c| {
            let type_parameter = |c: &mut Checker<'_>, is_this_type: bool| {
                c.types.alloc(Type {
                    flags: TypeFlags::TYPE_PARAMETER,
                    data: TypeData::TypeParameter(Box::new(TypeParameter {
                        is_this_type,
                        ..TypeParameter::default()
                    })),
                    ..Type::default()
                })
            };
            let s = type_parameter(c, false);
            let this_type = type_parameter(c, true);
            let t = new_type(c, TypeFlags::STRING);
            let u = new_type(c, TypeFlags::NUMBER);

            let simple = new_simple_type_mapper(c, s, t);
            assert_eq!((c.map(simple, s), c.map(simple, u)), (t, u));
            assert_eq!(c.mapper_kind(simple), TypeMapperKind::SIMPLE);
            assert!(!c.maps_this_only(simple));
            let this_mapper = new_simple_type_mapper(c, this_type, t);
            assert!(c.maps_this_only(this_mapper));

            let sources = c.list_of(&[s, t]);
            let targets = c.list_of(&[t, u]);
            let array = new_type_mapper(c, sources, targets);
            assert_eq!(c.mapper_kind(array), TypeMapperKind::ARRAY);
            assert_eq!(
                (c.map(array, s), c.map(array, t), c.map(array, u)),
                (t, u, u)
            );

            let one = c.list_of(&[s]);
            let single = new_type_mapper(c, one, targets);
            assert_eq!(c.mapper_kind(single), TypeMapperKind::SIMPLE);
            assert_eq!(c.map(single, s), t);

            let merged = new_merged_type_mapper(c, simple, array);
            assert_eq!(c.mapper_kind(merged), TypeMapperKind::MERGED);
            assert_eq!(c.map(merged, s), u);

            let to_single = new_array_to_single_type_mapper(c, sources, u);
            assert_eq!(c.mapper_kind(to_single), TypeMapperKind::UNKNOWN);
            assert_eq!((c.map(to_single, s), c.map(to_single, t)), (u, u));
            assert_eq!(c.map(to_single, this_type), this_type);

            let live = c.live_list(&[TypeId::NIL, TypeId::NIL]);
            let filling = new_type_mapper(c, sources, live);
            assert!(c.map(filling, s).is_nil());
            assert!(live.set(0usize, u));
            assert_eq!(c.map(filling, s), u);

            assert!(c.combine_type_mappers(TypeMapperId::NIL, simple) == simple);
            assert_eq!(c.internal_fault_count(), 0);
            assert_eq!(c.map(TypeMapperId::NIL, s), s);
            assert_eq!(c.internal_fault_count(), 1);
        });
    }

    #[test]
    fn a_list_keeps_nil_empty_and_identity_apart() {
        with_checker(|c| {
            let a = new_type(c, TypeFlags::STRING);
            let b = new_type(c, TypeFlags::NUMBER);
            assert!(c.list::<TypeId>(&[]).is_nil());
            assert!(!c.list_of::<TypeId>(&[]).is_nil());
            let list = c.list_of(&[a, b, a]);

            let kept = c.filter(list, |_, _| true);
            assert!(same(kept.as_slice(), list.as_slice()));
            let filtered = c.filter(list, |c, t| c.types[t].flags.intersects(TypeFlags::STRING));
            assert_eq!(filtered.as_slice(), [a, a]);
            let none = c.filter(list, |_, _| false);
            assert!(!none.is_nil() && none.len() == 0);

            let unchanged = c.same_map(list, |_, t| t);
            assert!(same(unchanged.as_slice(), list.as_slice()));
            let changed = c.same_map(list, |_, t| if t == b { a } else { t });
            assert_eq!(changed.as_slice(), [a, a, a]);

            assert!(c.map_list(List::<TypeId>::NIL, |_, t| t).is_nil());
            let symbols = c.map_list(list, |c, t| c.types[t].symbol);
            assert_eq!(symbols.as_slice(), [SymbolId::NIL; 3]);

            assert!(same(
                c.concatenate(list, List::NIL).as_slice(),
                list.as_slice()
            ));
            assert!(same(
                c.concatenate(List::NIL, list).as_slice(),
                list.as_slice()
            ));
            assert_eq!(c.concatenate(filtered, list).as_slice(), [a, a, a, b, a]);

            let copy = c.clone_list(list);
            assert_eq!(copy.as_slice(), list.as_slice());
            assert!(!same(copy.as_slice(), list.as_slice()));
            assert!(c.clone_list(List::<TypeId>::NIL).is_nil());
            assert_eq!(c.text(b"abc"), b"abc");
        });
    }

    #[test]
    fn the_value_symbol_links_ask_for_the_id_of_the_symbol() {
        with_checker(|c| {
            let a = c.ast;
            let first = a.new_symbol(SymbolFlags::PROPERTY, b"p");
            let second = a.new_symbol(SymbolFlags::PROPERTY, b"q");
            assert!(!c.value_symbol_links_has(second));
            let links = c.value_symbol_links_get(first);
            c.value_symbol_links[links].resolved_type = TypeId(1);
            assert!(a.get_symbol_id(second) < a.get_symbol_id(first));
            assert!(c.value_symbol_links_has(first));
            let again = c.value_symbol_links_get(first);
            assert_eq!(c.value_symbol_links[again].resolved_type, TypeId(1));
            assert!(c.value_symbol_links_try_get(second).is_nil());
            assert_eq!(c.internal_fault_count(), 0);
        });
    }

    #[test]
    fn what_upstream_dies_of_is_a_fault_and_a_fallback() {
        with_checker(|c| {
            c.error_type = new_type(c, TypeFlags::ANY);
            c.unknown_signature = c.signatures.alloc(Signature::default());
            let t: TypeId = c.fail("boom");
            assert_eq!(t, c.error_type);
            let s: SignatureId = c.stack_limit();
            assert_eq!(s, c.unknown_signature);
            let (stand_in_type, stand_in_flag): (TypeId, bool) = c.stand_in("notPorted");
            assert_eq!((stand_in_type, stand_in_flag), (c.error_type, false));
            let flow: FlowType = c.fail_detail("boom", 7);
            assert_eq!((flow.t, flow.incomplete), (c.error_type, false));
            let ternary: Ternary = c.fail("boom");
            assert_eq!(ternary, Ternary::FALSE);
            let list: List<'_, TypeId> = c.fail("boom");
            assert!(list.is_nil());
            c.assert(true, "holds");
            c.assert(false, "does not hold");
            c.map_set(true);
            c.map_set(false);
            c.slice_set(false);
            c.loop_limit("resolveAlias");
            assert!(c.relation(RelationKind::Nil).is_none());
            assert!(c.relation_mut(RelationKind::Nil).is_none());
            assert!(c.relation(RelationKind::Identity).is_some());
            let first = c.ast.open().faults.first();
            assert_eq!(
                first.map(|fault| (fault.kind, fault.message)),
                Some((FaultKind::Panic, "boom"))
            );
            assert_eq!(c.internal_fault_count(), 11);
        });
    }
}
