// checker.go:908-1503 (layer C-INIT): NewChecker and what it makes, the closure fields of upstream's Checker as methods, the resolvers of the global types and symbols, and initializeChecker with the merge of the globals and of the module augmentations.
use crate::ast::{
    Arg, Ast, CheckFlags, INTERNAL_SYMBOL_NAME_EXPORT_STAR, INTERNAL_SYMBOL_NAME_TYPE, Kind,
    NodeFlags, NodeId, OuterExpressionKinds, PatternAmbientModule, SymbolFlags, SymbolId,
    SymbolTableId, get_symbol_table, is_ambient_module_symbol_name,
    is_external_or_common_js_module, is_global_scope_augmentation, is_type_alias_declaration,
    is_type_declaration, symbol_name,
};
use crate::binder::NameResolver;
use crate::checker::{
    Checker, CheckerArena, FunctionMapper, IndexInfo, LiteralValue, MembersOrExportsResolutionKind,
    ObjectFlags, Program, Relation, RelationComparisonResult, SignatureFlags, TYPEOF_NE_FACTS,
    TypeFlags, TypeId, TypePredicate, TypePredicateId, TypePredicateKind, VarianceFlags,
    new_function_type_mapper,
};
use crate::core::{List, Map, Memo, Tristate, find, if_else};
use crate::diagnostics::{self, MessageId};
use crate::evaluator::{self, new_evaluator};
use crate::jsnum::{Number, PseudoBigInt};
use std::sync::atomic::{AtomicU32, Ordering};

// checker.go:583
static NEXT_CHECKER_ID: AtomicU32 = AtomicU32::new(0);

// The field of the checker that keeps the answer of a memoized getter of upstream: it has the name of the getter.
pub type MemoField<'a, T> = for<'r> fn(&'r mut Checker<'a>) -> &'r mut Memo<T>;

// The tree context and the arena of the lists are arguments, where upstream makes symbolArena and factory itself. The tracer and the mutex are not ported: one checker on one thread.
pub fn new_checker<'a>(
    ast: Ast<'a>,
    lists: &'a CheckerArena<'a>,
    program: &'a dyn Program<'a>,
) -> Checker<'a> {
    // The tree context reads what the binders left, so its maker has bound the files already and the call binds nothing new.
    program.bind_source_files();

    let mut c = Checker::zero(ast, lists, program, program.options());
    c.id = NEXT_CHECKER_ID
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1);
    c.files = List::from_slice(program.source_files());
    c.file_index_map = create_file_index_map(c.files);
    // compareSymbols, compareSymbolChains, evaluate, resolveName, resolveNameForSymbolSuggestion and the memoized getters of 1068-1117 are closure fields upstream: each is the method of its name, after this function.
    let options = c.compiler_options;
    c.language_version = options.get_emit_script_target();
    c.module_kind = options.get_emit_module_kind();
    c.module_resolution_kind = options.get_module_resolution_kind();
    c.legacy_decorators = options.experimental_decorators == Tristate::TRUE;
    c.emit_standard_class_fields = options.get_emit_standard_class_fields();
    c.strict_null_checks = options.get_strict_option_value(options.strict_null_checks);
    c.strict_function_types = options.get_strict_option_value(options.strict_function_types);
    c.strict_bind_call_apply = options.get_strict_option_value(options.strict_bind_call_apply);
    c.strict_property_initialization =
        options.get_strict_option_value(options.strict_property_initialization);
    c.strict_builtin_iterator_return =
        options.get_strict_option_value(options.strict_builtin_iterator_return);
    c.no_implicit_any = options.get_strict_option_value(options.no_implicit_any);
    c.no_implicit_this = options.get_strict_option_value(options.no_implicit_this);
    c.use_unknown_in_catch_variables =
        options.get_strict_option_value(options.use_unknown_in_catch_variables);
    c.exact_optional_property_types = options.exact_optional_property_types == Tristate::TRUE;
    c.can_collect_symbol_alias_accessibility_data =
        options.verbatim_module_syntax.is_false_or_unknown();
    c.array_variances = c.list_of(&[VarianceFlags::COVARIANT]);
    // `make(ast.SymbolTable, countGlobalSymbols(c.files))`: a table of the open store takes no size hint.
    c.globals = ast.new_table();
    c.string_literal_types = Map::make();
    c.number_literal_types = Map::make();
    c.bigint_literal_types = Map::make();
    c.enum_literal_types = Map::make();
    c.enum_nan_literal_types = Map::make();
    c.indexed_access_types = Map::make();
    c.template_literal_types = Map::make();
    c.string_mapping_types = Map::make();
    c.unique_es_symbol_types = Map::make();
    c.this_expando_kinds = Map::make();
    c.this_expando_locations = Map::make();
    c.subtype_reduction_cache = Map::make();
    c.cached_types = Map::make();
    c.cached_signatures = Map::make();
    c.undefined_properties = Map::make();
    c.narrowed_types = Map::make();
    c.assignment_reduced_types = Map::make();
    c.discriminated_contextual_types = Map::make();
    c.instantiation_expression_types = Map::make();
    c.substitution_types = Map::make();
    c.reverse_mapped_cache = Map::make();
    c.reverse_homomorphic_mapped_cache = Map::make();
    c.iteration_types_cache = Map::make();
    c.undefined_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"undefined");
    c.arguments_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"arguments");
    c.require_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"require");
    c.unknown_symbol = c.new_symbol(SymbolFlags::PROPERTY, b"unknown");
    c.unresolved_symbols = Map::make();
    c.error_types = Map::make();
    c.module_symbols = Map::make();
    c.global_this_symbol =
        c.new_symbol_ex(SymbolFlags::MODULE, b"globalThis", CheckFlags::READONLY);
    let (globals, global_this_symbol) = (c.globals, c.global_this_symbol);
    ast.update_symbol(global_this_symbol, |s| s.exports = globals);
    ast.table_set(
        globals,
        ast.sym(global_this_symbol).name,
        global_this_symbol,
    );
    c.tuple_types = Map::make();
    c.union_types = Map::make();
    c.union_of_union_types = Map::make();
    c.intersection_types = Map::make();
    c.properties_types = Map::make();
    c.merged_symbols = Map::make();
    c.pattern_for_type = Map::make();
    c.context_free_types = Map::make();
    c.any_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.auto_type = c.new_intrinsic_type_ex(TypeFlags::ANY, b"any", ObjectFlags::NON_INFERRABLE_TYPE);
    c.wildcard_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.blocked_string_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.error_type = c.new_intrinsic_type(TypeFlags::ANY, b"error");
    c.unresolved_type = c.new_intrinsic_type(TypeFlags::ANY, b"unresolved");
    c.non_inferrable_any_type =
        c.new_intrinsic_type_ex(TypeFlags::ANY, b"any", ObjectFlags::CONTAINS_WIDENING_TYPE);
    c.intrinsic_marker_type = c.new_intrinsic_type(TypeFlags::ANY, b"intrinsic");
    c.unknown_type = c.new_intrinsic_type(TypeFlags::UNKNOWN, b"unknown");
    c.undefined_type = c.new_intrinsic_type(TypeFlags::UNDEFINED, b"undefined");
    c.undefined_widening_type = c.create_widening_type(c.undefined_type);
    c.missing_type = c.new_intrinsic_type(TypeFlags::UNDEFINED, b"undefined");
    c.undefined_or_missing_type = if_else(
        c.exact_optional_property_types,
        c.missing_type,
        c.undefined_type,
    );
    c.optional_type = c.new_intrinsic_type(TypeFlags::UNDEFINED, b"undefined");
    c.null_type = c.new_intrinsic_type(TypeFlags::NULL, b"null");
    c.null_widening_type = c.create_widening_type(c.null_type);
    c.string_type = c.new_intrinsic_type(TypeFlags::STRING, b"string");
    c.number_type = c.new_intrinsic_type(TypeFlags::NUMBER, b"number");
    c.bigint_type = c.new_intrinsic_type(TypeFlags::BIG_INT, b"bigint");
    c.regular_false_type = c.new_literal_type(
        TypeFlags::BOOLEAN_LITERAL,
        LiteralValue::Boolean(false),
        TypeId::NIL,
    );
    c.false_type = c.new_literal_type(
        TypeFlags::BOOLEAN_LITERAL,
        LiteralValue::Boolean(false),
        c.regular_false_type,
    );
    let (regular_false_type, false_type) = (c.regular_false_type, c.false_type);
    c.as_literal_type_mut(regular_false_type).fresh_type = false_type;
    c.as_literal_type_mut(false_type).fresh_type = false_type;
    c.regular_true_type = c.new_literal_type(
        TypeFlags::BOOLEAN_LITERAL,
        LiteralValue::Boolean(true),
        TypeId::NIL,
    );
    c.true_type = c.new_literal_type(
        TypeFlags::BOOLEAN_LITERAL,
        LiteralValue::Boolean(true),
        c.regular_true_type,
    );
    let (regular_true_type, true_type) = (c.regular_true_type, c.true_type);
    c.as_literal_type_mut(regular_true_type).fresh_type = true_type;
    c.as_literal_type_mut(true_type).fresh_type = true_type;
    c.boolean_type = c.get_union_type(List::from_slice(&[
        c.regular_false_type,
        c.regular_true_type,
    ]));
    c.es_symbol_type = c.new_intrinsic_type(TypeFlags::ES_SYMBOL, b"symbol");
    c.void_type = c.new_intrinsic_type(TypeFlags::VOID, b"void");
    c.never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.silent_never_type =
        c.new_intrinsic_type_ex(TypeFlags::NEVER, b"never", ObjectFlags::NON_INFERRABLE_TYPE);
    c.implicit_never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.unreachable_never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.non_primitive_type = c.new_intrinsic_type(TypeFlags::NON_PRIMITIVE, b"object");
    c.string_or_number_type = c.get_union_type(List::from_slice(&[c.string_type, c.number_type]));
    c.string_number_symbol_type = c.get_union_type(List::from_slice(&[
        c.string_type,
        c.number_type,
        c.es_symbol_type,
    ]));
    c.number_or_big_int_type = c.get_union_type(List::from_slice(&[c.number_type, c.bigint_type]));
    let numeric_string_texts: [&[u8]; 2] = [b"", b""];
    c.numeric_string_type =
        c.get_template_literal_type(&numeric_string_texts, List::from_slice(&[c.number_type])); // The `${number}` type
    c.template_constraint_type = c.get_union_type(List::from_slice(&[
        c.string_type,
        c.number_type,
        c.boolean_type,
        c.bigint_type,
        c.null_type,
        c.undefined_type,
    ]));
    c.unique_literal_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never"); // Special `never` flagged by union reduction to behave as a literal
    c.unique_literal_mapper = new_function_type_mapper(&mut c, FunctionMapper::UniqueLiteral);
    c.report_unreliable_mapper = new_function_type_mapper(&mut c, FunctionMapper::ReportUnreliable);
    c.report_unmeasurable_mapper =
        new_function_type_mapper(&mut c, FunctionMapper::ReportUnmeasurable);
    c.restrictive_mapper = new_function_type_mapper(&mut c, FunctionMapper::Restrictive);
    c.permissive_mapper = new_function_type_mapper(&mut c, FunctionMapper::Permissive);
    c.empty_object_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.empty_jsx_object_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.empty_fresh_jsx_object_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    let type_literal_symbol = c.new_symbol(SymbolFlags::TYPE_LITERAL, INTERNAL_SYMBOL_NAME_TYPE);
    c.empty_type_literal_type = c.new_anonymous_type(
        type_literal_symbol,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.unknown_empty_object_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.unknown_union_type = c.create_unknown_union_type();
    c.empty_generic_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    let empty_generic_type = c.empty_generic_type;
    c.as_object_type_mut(empty_generic_type).instantiations = Map::make();
    c.any_function_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    let any_function_type = c.any_function_type;
    c.types[any_function_type].object_flags |= ObjectFlags::NON_INFERRABLE_TYPE;
    c.no_constraint_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.circular_constraint_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.resolving_default_type = c.new_anonymous_type(
        SymbolId::NIL,
        SymbolTableId::NIL,
        List::NIL,
        List::NIL,
        List::NIL,
    );
    c.marker_super_type = c.new_type_parameter(SymbolId::NIL);
    c.marker_sub_type = c.new_type_parameter(SymbolId::NIL);
    let (marker_super_type, marker_sub_type) = (c.marker_super_type, c.marker_sub_type);
    c.as_type_parameter_mut(marker_sub_type).constraint = marker_super_type;
    c.marker_other_type = c.new_type_parameter(SymbolId::NIL);
    c.marker_super_type_for_check = c.new_type_parameter(SymbolId::NIL);
    c.marker_sub_type_for_check = c.new_type_parameter(SymbolId::NIL);
    let (marker_super_type_for_check, marker_sub_type_for_check) =
        (c.marker_super_type_for_check, c.marker_sub_type_for_check);
    c.as_type_parameter_mut(marker_sub_type_for_check)
        .constraint = marker_super_type_for_check;
    c.no_type_predicate = c.type_predicates.alloc(TypePredicate {
        kind: TypePredicateKind::IDENTIFIER,
        parameter_index: 0,
        parameter_name: b"<<unresolved>>",
        t: c.any_type,
    });
    c.any_signature = c.new_signature(
        SignatureFlags::NONE,
        NodeId::NIL,
        List::NIL,
        SymbolId::NIL,
        List::NIL,
        c.any_type,
        TypePredicateId::NIL,
        0,
    );
    c.unknown_signature = c.new_signature(
        SignatureFlags::NONE,
        NodeId::NIL,
        List::NIL,
        SymbolId::NIL,
        List::NIL,
        c.error_type,
        TypePredicateId::NIL,
        0,
    );
    c.resolving_signature = c.new_signature(
        SignatureFlags::NONE,
        NodeId::NIL,
        List::NIL,
        SymbolId::NIL,
        List::NIL,
        c.any_type,
        TypePredicateId::NIL,
        0,
    );
    c.silent_never_signature = c.new_signature(
        SignatureFlags::NONE,
        NodeId::NIL,
        List::NIL,
        SymbolId::NIL,
        List::NIL,
        c.silent_never_type,
        TypePredicateId::NIL,
        0,
    );
    c.cached_arguments_referenced = Map::make();
    c.enum_number_index_info = c.index_infos.alloc(IndexInfo {
        key_type: c.number_type,
        value_type: c.string_type,
        is_readonly: true,
        ..IndexInfo::default()
    });
    c.any_base_type_index_info = c.index_infos.alloc(IndexInfo {
        key_type: c.string_type,
        value_type: c.any_type,
        is_readonly: false,
        ..IndexInfo::default()
    });
    c.empty_string_type = c.get_string_literal_type(b"");
    c.zero_type = c.get_number_literal_type(Number(0.0));
    c.zero_big_int_type = c.get_big_int_literal_type(PseudoBigInt::default());
    // `slices.Sorted(maps.Keys(typeofNEFacts))`: the table holds its entries in the ascending order of their keys.
    let mut typeof_types: Vec<TypeId> = Vec::with_capacity(TYPEOF_NE_FACTS.len());
    for (name, _) in TYPEOF_NE_FACTS {
        typeof_types.push(c.get_string_literal_type(name));
    }
    c.typeof_type = c.get_union_type(List::from_slice(&typeof_types));
    c.flow_loop_cache = Map::make();
    c.flow_node_reachable = Map::make();
    c.flow_node_post_super = Map::make();
    c.subtype_relation = Relation::default();
    c.strict_subtype_relation = Relation::default();
    c.assignable_relation = Relation::default();
    c.comparable_relation = Relation::default();
    c.identity_relation = Relation::default();
    c.enum_relation = Map::make();
    // initializeClosures and initializeIterationResolvers have no function: what they assign are methods, of the checker below and of IterationTypesResolverKind in c12_iteration_types.rs.
    c.initialize_checker();
    c
}

impl<'a> Checker<'a> {
    // `c.compareSymbols = c.compareSymbolsWorker` (checker.go:918)
    pub fn compare_symbols(&self, s1: SymbolId, s2: SymbolId) -> isize {
        self.compare_symbols_worker(s1, s2)
    }

    // `c.compareSymbolChains = c.compareSymbolChainsWorker` (checker.go:919)
    pub fn compare_symbol_chains(&self, a: &[SymbolId], b: &[SymbolId]) -> isize {
        self.compare_symbol_chains_worker(a, b)
    }

    // `c.evaluate = evaluator.NewEvaluator(c.evaluateEntity, ast.OEKParentheses)` (checker.go:937): an evaluator takes its entity evaluator at each call, since a closure that the checker keeps cannot borrow the checker.
    pub fn evaluate(&mut self, expr: NodeId, location: NodeId) -> evaluator::Result<'a> {
        let a = self.ast;
        new_evaluator(OuterExpressionKinds::PARENTHESES).evaluate(
            a,
            expr,
            location,
            &mut |expr, location| self.evaluate_entity(expr, location),
        )
    }

    // `c.resolveName = c.createNameResolver().Resolve` (checker.go:971): a resolver holds ids and function pointers only, so it is made at each call and the checker is its host.
    pub fn resolve_name(
        &mut self,
        location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
        name_not_found_message: MessageId,
        is_use: bool,
        exclude_globals: bool,
    ) -> SymbolId {
        let a = self.ast;
        let mut resolver = self.create_name_resolver();
        resolver.resolve(
            a,
            self,
            location,
            name,
            meaning,
            name_not_found_message,
            is_use,
            exclude_globals,
        )
    }

    // `c.resolveNameForSymbolSuggestion = c.createNameResolverForSuggestion().Resolve` (checker.go:972)
    pub fn resolve_name_for_symbol_suggestion(
        &mut self,
        location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
        name_not_found_message: MessageId,
        is_use: bool,
        exclude_globals: bool,
    ) -> SymbolId {
        let a = self.ast;
        let mut resolver = self.create_name_resolver_for_suggestion();
        resolver.resolve(
            a,
            self,
            location,
            name,
            meaning,
            name_not_found_message,
            is_use,
            exclude_globals,
        )
    }

    // The memoized getters that checker.go:1068-1117 assigns, in that order: each asks the resolver that upstream makes it with.

    pub fn get_global_es_symbol_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_es_symbol_type, b"Symbol", 0, false)
    }

    pub fn get_global_big_int_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_big_int_type, b"BigInt", 0, false)
    }

    pub fn get_global_import_meta_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_import_meta_type,
            b"ImportMeta",
            0,
            true,
        )
    }

    pub fn get_global_import_attributes_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_import_attributes_type,
            b"ImportAttributes",
            0,
            false,
        )
    }

    pub fn get_global_import_attributes_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_import_attributes_type_checked,
            b"ImportAttributes",
            0,
            true,
        )
    }

    pub fn get_global_non_nullable_type_alias_or_nil(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(
            |c| &mut c.get_global_non_nullable_type_alias_or_nil,
            b"NonNullable",
            1,
            false,
        )
    }

    pub fn get_global_extract_symbol(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(
            |c| &mut c.get_global_extract_symbol,
            b"Extract",
            2,
            true,
        )
    }

    pub fn get_global_disposable_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_disposable_type,
            b"Disposable",
            0,
            true,
        )
    }

    pub fn get_global_async_disposable_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_disposable_type,
            b"AsyncDisposable",
            0,
            true,
        )
    }

    pub fn get_global_awaited_symbol(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(
            |c| &mut c.get_global_awaited_symbol,
            b"Awaited",
            1,
            true,
        )
    }

    pub fn get_global_awaited_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(
            |c| &mut c.get_global_awaited_symbol_or_nil,
            b"Awaited",
            1,
            false,
        )
    }

    pub fn get_global_nan_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_value_symbol_resolver(
            |c| &mut c.get_global_nan_symbol_or_nil,
            b"NaN",
            false,
        )
    }

    pub fn get_global_record_symbol(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(|c| &mut c.get_global_record_symbol, b"Record", 2, true)
    }

    pub fn get_global_template_strings_array_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_template_strings_array_type,
            b"TemplateStringsArray",
            0,
            true,
        )
    }

    pub fn get_global_es_symbol_constructor_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_value_symbol_resolver(
            |c| &mut c.get_global_es_symbol_constructor_symbol_or_nil,
            b"Symbol",
            false,
        )
    }

    pub fn get_global_es_symbol_constructor_type_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_type_symbol_resolver(
            |c| &mut c.get_global_es_symbol_constructor_type_symbol_or_nil,
            b"SymbolConstructor",
            false,
        )
    }

    pub fn get_global_import_call_options_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_import_call_options_type,
            b"ImportCallOptions",
            0,
            false,
        )
    }

    pub fn get_global_import_call_options_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_import_call_options_type_checked,
            b"ImportCallOptions",
            0,
            true,
        )
    }

    pub fn get_global_promise_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_promise_type, b"Promise", 1, false)
    }

    pub fn get_global_promise_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_promise_type_checked,
            b"Promise",
            1,
            true,
        )
    }

    pub fn get_global_promise_like_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_promise_like_type,
            b"PromiseLike",
            1,
            true,
        )
    }

    pub fn get_global_promise_constructor_symbol(&mut self) -> SymbolId {
        self.get_global_value_symbol_resolver(
            |c| &mut c.get_global_promise_constructor_symbol,
            b"Promise",
            true,
        )
    }

    pub fn get_global_promise_constructor_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_value_symbol_resolver(
            |c| &mut c.get_global_promise_constructor_symbol_or_nil,
            b"Promise",
            false,
        )
    }

    pub fn get_global_omit_symbol(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(|c| &mut c.get_global_omit_symbol, b"Omit", 2, true)
    }

    pub fn get_global_no_infer_symbol_or_nil(&mut self) -> SymbolId {
        self.get_global_type_alias_resolver(
            |c| &mut c.get_global_no_infer_symbol_or_nil,
            b"NoInfer",
            1,
            false,
        )
    }

    pub fn get_global_iterator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_iterator_type, b"Iterator", 3, false)
    }

    pub fn get_global_iterable_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_iterable_type, b"Iterable", 3, false)
    }

    pub fn get_global_iterable_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterable_type_checked,
            b"Iterable",
            3,
            true,
        )
    }

    pub fn get_global_iterable_iterator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterable_iterator_type,
            b"IterableIterator",
            3,
            false,
        )
    }

    pub fn get_global_iterable_iterator_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterable_iterator_type_checked,
            b"IterableIterator",
            3,
            true,
        )
    }

    pub fn get_global_iterator_object_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterator_object_type,
            b"IteratorObject",
            3,
            false,
        )
    }

    pub fn get_global_generator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(|c| &mut c.get_global_generator_type, b"Generator", 3, false)
    }

    pub fn get_global_async_iterator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterator_type,
            b"AsyncIterator",
            3,
            false,
        )
    }

    pub fn get_global_async_iterable_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterable_type,
            b"AsyncIterable",
            3,
            false,
        )
    }

    pub fn get_global_async_iterable_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterable_type_checked,
            b"AsyncIterable",
            3,
            true,
        )
    }

    pub fn get_global_async_iterable_iterator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterable_iterator_type,
            b"AsyncIterableIterator",
            3,
            false,
        )
    }

    pub fn get_global_async_iterable_iterator_type_checked(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterable_iterator_type_checked,
            b"AsyncIterableIterator",
            3,
            true,
        )
    }

    pub fn get_global_async_iterator_object_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_iterator_object_type,
            b"AsyncIteratorObject",
            3,
            false,
        )
    }

    pub fn get_global_async_generator_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_async_generator_type,
            b"AsyncGenerator",
            3,
            false,
        )
    }

    pub fn get_global_iterator_yield_result_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterator_yield_result_type,
            b"IteratorYieldResult",
            1,
            false,
        )
    }

    pub fn get_global_iterator_return_result_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_iterator_return_result_type,
            b"IteratorReturnResult",
            1,
            false,
        )
    }

    pub fn get_global_typed_property_descriptor_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_typed_property_descriptor_type,
            b"TypedPropertyDescriptor",
            1,
            true,
        )
    }

    pub fn get_global_class_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_decorator_context_type,
            b"ClassDecoratorContext",
            1,
            true,
        )
    }

    pub fn get_global_class_method_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_method_decorator_context_type,
            b"ClassMethodDecoratorContext",
            2,
            true,
        )
    }

    pub fn get_global_class_getter_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_getter_decorator_context_type,
            b"ClassGetterDecoratorContext",
            2,
            true,
        )
    }

    pub fn get_global_class_setter_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_setter_decorator_context_type,
            b"ClassSetterDecoratorContext",
            2,
            true,
        )
    }

    pub fn get_global_class_accessor_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_accessor_decorator_context_type,
            b"ClassAccessorDecoratorContext",
            2,
            true,
        )
    }

    pub fn get_global_class_accessor_decorator_target_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_accessor_decorator_target_type,
            b"ClassAccessorDecoratorTarget",
            2,
            true,
        )
    }

    pub fn get_global_class_accessor_decorator_result_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_accessor_decorator_result_type,
            b"ClassAccessorDecoratorResult",
            2,
            true,
        )
    }

    pub fn get_global_class_field_decorator_context_type(&mut self) -> TypeId {
        self.get_global_type_resolver(
            |c| &mut c.get_global_class_field_decorator_context_type,
            b"ClassFieldDecoratorContext",
            2,
            true,
        )
    }
}

pub fn create_file_index_map(files: List<'_, NodeId>) -> Map<NodeId, isize> {
    let mut result: Map<NodeId, isize> = Map::make();
    for (i, file) in files.iter().enumerate() {
        // The map was just made, so the write is not refused.
        let _ = result.set(file, i as isize);
    }
    result
}

pub fn count_global_symbols(a: Ast<'_>, files: List<'_, NodeId>) -> isize {
    let mut count = 0;
    for file in files.iter() {
        if !is_external_or_common_js_module(a, file) {
            count += a.table_len(a.as_source_file(file).locals);
        }
    }
    count
}

impl<'a> Checker<'a> {
    pub fn report_unreliable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNRELIABLE;
        }
        t
    }

    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId {
        if t == self.marker_super_type || t == self.marker_sub_type || t == self.marker_other_type {
            self.reliability_flags |= RelationComparisonResult::REPORTS_UNMEASURABLE;
        }
        t
    }

    // Resolve to the global class or interface by the given name and arity, or emptyObjectType/emptyGenericType otherwise. `memo` is the place of core.Memoize: the lookup runs until one run of it has returned.
    pub fn get_global_type_resolver(
        &mut self,
        memo: MemoField<'a, TypeId>,
        name: &[u8],
        arity: isize,
        report_errors: bool,
    ) -> TypeId {
        if !memo(self).done {
            let value = self.get_global_type(name, arity, report_errors);
            let slot = memo(self);
            slot.value = value;
            slot.done = true;
        }
        memo(self).value
    }

    // Resolve to the global type alias symbol by the given name and arity, or nil otherwise
    pub fn get_global_type_alias_resolver(
        &mut self,
        memo: MemoField<'a, SymbolId>,
        name: &[u8],
        arity: isize,
        report_errors: bool,
    ) -> SymbolId {
        if !memo(self).done {
            let value = self.get_global_type_alias_symbol(name, arity, report_errors);
            let slot = memo(self);
            slot.value = value;
            slot.done = true;
        }
        memo(self).value
    }

    // Resolve to the global value symbol by the given name, or nil otherwise
    pub fn get_global_value_symbol_resolver(
        &mut self,
        memo: MemoField<'a, SymbolId>,
        name: &[u8],
        report_errors: bool,
    ) -> SymbolId {
        if !memo(self).done {
            let value = self.get_global_symbol(
                name,
                SymbolFlags::VALUE,
                if_else(
                    report_errors,
                    diagnostics::CANNOT_FIND_GLOBAL_VALUE_0,
                    MessageId::NIL,
                ),
            );
            let slot = memo(self);
            slot.value = value;
            slot.done = true;
        }
        memo(self).value
    }

    pub fn get_global_type_symbol_resolver(
        &mut self,
        memo: MemoField<'a, SymbolId>,
        name: &[u8],
        report_errors: bool,
    ) -> SymbolId {
        if !memo(self).done {
            let value = self.get_global_symbol(
                name,
                SymbolFlags::TYPE,
                if_else(
                    report_errors,
                    diagnostics::CANNOT_FIND_GLOBAL_TYPE_0,
                    MessageId::NIL,
                ),
            );
            let slot = memo(self);
            slot.value = value;
            slot.done = true;
        }
        memo(self).value
    }

    // No field of the checker keeps such a list: IterationTypesResolverKind::get_global_builtin_iterator_types, the one place where upstream uses this resolver, makes its list at each call.
    pub fn get_global_types_resolver(
        &mut self,
        memo: MemoField<'a, List<'a, TypeId>>,
        names: &[&[u8]],
        arity: isize,
        report_errors: bool,
    ) -> List<'a, TypeId> {
        if !memo(self).done {
            let mut types: Vec<TypeId> = Vec::with_capacity(names.len());
            for &name in names {
                types.push(self.get_global_type(name, arity, report_errors));
            }
            let value = self.list_of(&types);
            let slot = memo(self);
            slot.value = value;
            slot.done = true;
        }
        memo(self).value
    }

    pub fn get_global_type_alias_symbol(
        &mut self,
        name: &[u8],
        arity: isize,
        report_errors: bool,
    ) -> SymbolId {
        let a = self.ast;
        let symbol = self.get_global_symbol(
            name,
            SymbolFlags::TYPE_ALIAS,
            if_else(
                report_errors,
                diagnostics::CANNOT_FIND_GLOBAL_TYPE_0,
                MessageId::NIL,
            ),
        );
        if symbol.is_nil() {
            return SymbolId::NIL;
        }
        // Resolve the declared type of the symbol. This resolves type parameters for the type alias so that we can check arity.
        self.get_declared_type_of_symbol(symbol);
        let links = self.type_alias_links.get(symbol);
        if self.type_alias_links[links].type_parameters.len() != arity {
            if report_errors {
                let decl = find(a.sym(symbol).declarations.as_slice(), |d| {
                    is_type_alias_declaration(a, d)
                });
                self.error(
                    decl,
                    diagnostics::GLOBAL_TYPE_0_MUST_HAVE_1_TYPE_PARAMETER_S,
                    &[Arg::Str(symbol_name(a, symbol)), Arg::Int(arity as i64)],
                );
            }
            return SymbolId::NIL;
        }
        symbol
    }

    pub fn get_type_alias_type_parameters(&mut self, symbol: SymbolId) -> List<'a, TypeId> {
        if !self
            .ast
            .sym(symbol)
            .flags
            .intersects(SymbolFlags::TYPE_ALIAS)
        {
            return self.fail("Attempted to fetch type alias parameters for non-type-alias symbol");
        }
        self.get_declared_type_of_symbol(symbol);
        let links = self.type_alias_links.get(symbol);
        self.type_alias_links[links].type_parameters
    }

    pub fn get_global_type(&mut self, name: &[u8], arity: isize, report_errors: bool) -> TypeId {
        let a = self.ast;
        let symbol = self.get_global_symbol(
            name,
            SymbolFlags::TYPE,
            if_else(
                report_errors,
                diagnostics::CANNOT_FIND_GLOBAL_TYPE_0,
                MessageId::NIL,
            ),
        );
        if !symbol.is_nil() {
            if a.sym(symbol)
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
            {
                let t = self.get_declared_type_of_symbol(symbol);
                if self.as_interface_type(t).type_parameters().len() == arity {
                    return t;
                }
                if report_errors {
                    self.error(
                        get_global_type_declaration(a, symbol),
                        diagnostics::GLOBAL_TYPE_0_MUST_HAVE_1_TYPE_PARAMETER_S,
                        &[Arg::Str(symbol_name(a, symbol)), Arg::Int(arity as i64)],
                    );
                }
            } else if report_errors {
                self.error(
                    get_global_type_declaration(a, symbol),
                    diagnostics::GLOBAL_TYPE_0_MUST_BE_A_CLASS_OR_INTERFACE_TYPE,
                    &[Arg::Str(symbol_name(a, symbol))],
                );
            }
        }
        if arity != 0 {
            return self.empty_generic_type;
        }
        self.empty_object_type
    }
}

pub fn get_global_type_declaration(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    for &declaration in a.sym(symbol).declarations.as_slice() {
        match a.kind(declaration) {
            Kind::ClassDeclaration
            | Kind::InterfaceDeclaration
            | Kind::EnumDeclaration
            | Kind::TypeAliasDeclaration => return declaration,
            _ => {}
        }
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_global_symbol(
        &mut self,
        name: &[u8],
        meaning: SymbolFlags,
        diagnostic: MessageId,
    ) -> SymbolId {
        // Don't track references for global symbols anyway, so value if `isReference` is arbitrary
        self.resolve_name(NodeId::NIL, name, meaning, diagnostic, false, false)
    }

    // `c.isPrimitiveOrObjectOrEmptyType` of initializeClosures (checker.go:1253)
    pub fn is_primitive_or_object_or_empty_type(&mut self, t: TypeId) -> bool {
        self.types[t]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::NON_PRIMITIVE)
            || self.is_empty_anonymous_object_type(t)
    }

    // `c.containsMissingType` of initializeClosures (checker.go:1256)
    pub fn contains_missing_type(&self, t: TypeId) -> bool {
        t == self.missing_type
            || self.types[t].flags.intersects(TypeFlags::UNION)
                && self.type_types(t).at(0usize) == self.missing_type
    }

    pub fn initialize_checker(&mut self) {
        let a = self.ast;
        // Initialize global symbol table
        let mut ambient_module_symbols: Vec<SymbolId> = Vec::new();
        let files = self.files.as_slice();
        let mut augmentations: Vec<&'a [NodeId]> = Vec::with_capacity(files.len());
        for &file in files {
            let source_file = a.as_source_file(file);
            if !is_external_or_common_js_module(a, file) {
                // It is an error for a non-external-module (i.e. script) to declare its own `globalThis`.
                let file_global_this_symbol = a.table_get(source_file.locals, b"globalThis");
                if !file_global_this_symbol.is_nil() {
                    for &d in a.sym(file_global_this_symbol).declarations.as_slice() {
                        let diagnostic = self.new_diagnostic_for_node(
                            d,
                            diagnostics::DECLARATION_NAME_CONFLICTS_WITH_BUILT_IN_GLOBAL_IDENTIFIER_0,
                            &[Arg::Str(b"globalThis")],
                        );
                        self.add_diagnostic(diagnostic);
                    }
                }
                // Upstream ranges over the locals of the file (a map): the table is walked in its own order.
                let mut position = 0;
                while let Some((_, symbol)) = a.table_entry_at(source_file.locals, position) {
                    position += 1;
                    let data = a.sym(symbol);
                    // We defer merging of global ambient module declarations since they may require other global symbols and types to be resolved. See https://github.com/microsoft/typescript-go/issues/2953.
                    if data.flags.intersects(SymbolFlags::MODULE)
                        && is_ambient_module_symbol_name(data.name)
                    {
                        ambient_module_symbols.push(symbol);
                    } else {
                        self.merge_global_symbol(symbol);
                    }
                }
            }
            self.pattern_ambient_modules
                .extend(source_file.pattern_ambient_modules.iter().map(|module| {
                    PatternAmbientModule {
                        pattern: module.pattern.clone(),
                        symbol: module.symbol,
                    }
                }));
            augmentations.push(source_file.module_augmentations);
            if !source_file.symbol.is_nil() {
                // Merge in UMD exports with first-in-wins semantics (see #9771)
                let mut position = 0;
                while let Some((name, symbol)) =
                    a.table_entry_at(source_file.global_exports, position)
                {
                    position += 1;
                    if a.table_get(self.globals, name).is_nil() {
                        a.table_set(self.globals, name, symbol);
                    }
                }
            }
        }
        // We do global augmentations separately from module augmentations (and before creating global types) because they 1. Affect global types. We won't have the correct global types until global augmentations are merged. Also, 2. Module augmentation instantiation requires creating the type of a module, which, in turn, can require checking for an export or property on the module (if export=) which, in turn, can fall back to the apparent type of the module - either globalObjectType or globalFunctionType - which wouldn't exist if we did module augmentations prior to finalizing the global types.
        for &list in &augmentations {
            for &augmentation in list {
                // Merge 'global' module augmentations. This needs to be done after global symbol table is initialized to make sure that all ambient modules are indexed
                if is_global_scope_augmentation(a, a.parent(augmentation)) {
                    self.merge_module_augmentation(augmentation);
                }
            }
        }
        self.add_undefined_to_globals_or_error_on_redeclaration();
        let links = self.value_symbol_links_get(self.undefined_symbol);
        self.value_symbol_links[links].resolved_type = self.undefined_widening_type;
        let links = self.value_symbol_links_get(self.arguments_symbol);
        let arguments_type = self.get_global_type(b"IArguments", 0, true);
        self.value_symbol_links[links].resolved_type = arguments_type;
        let links = self.value_symbol_links_get(self.unknown_symbol);
        self.value_symbol_links[links].resolved_type = self.error_type;
        let links = self.value_symbol_links_get(self.global_this_symbol);
        let global_this_type =
            self.new_object_type(ObjectFlags::ANONYMOUS, self.global_this_symbol);
        self.value_symbol_links[links].resolved_type = global_this_type;
        // Initialize special types
        self.global_array_type = self.get_global_type(b"Array", 1, true);
        self.global_object_type = self.get_global_type(b"Object", 0, true);
        self.global_function_type = self.get_global_type(b"Function", 0, true);
        self.global_callable_function_type =
            self.get_global_strict_function_type(b"CallableFunction");
        self.global_newable_function_type =
            self.get_global_strict_function_type(b"NewableFunction");
        self.global_string_type = self.get_global_type(b"String", 0, true);
        self.global_number_type = self.get_global_type(b"Number", 0, true);
        self.global_boolean_type = self.get_global_type(b"Boolean", 0, true);
        self.global_reg_exp_type = self.get_global_type(b"RegExp", 0, true);
        self.any_array_type = self.create_array_type(self.any_type);
        self.auto_array_type = self.create_array_type(self.auto_type);
        if self.auto_array_type == self.empty_object_type {
            // autoArrayType is used as a marker, so even if global Array type is not defined, it needs to be a unique type
            self.auto_array_type = self.new_anonymous_type(
                SymbolId::NIL,
                SymbolTableId::NIL,
                List::NIL,
                List::NIL,
                List::NIL,
            );
        }
        self.global_readonly_array_type = self.get_global_type(b"ReadonlyArray", 1, false);
        if self.global_readonly_array_type == self.empty_generic_type {
            self.global_readonly_array_type = self.global_array_type;
        }
        let any_type_arguments = self.list_of(&[self.any_type]);
        self.any_readonly_array_type = self.create_type_from_generic_global_type(
            self.global_readonly_array_type,
            any_type_arguments,
        );
        self.global_this_type = self.get_global_type(b"ThisType", 1, false);
        // Now merge global ambient module declarations
        for &symbol in &ambient_module_symbols {
            self.merge_global_symbol(symbol);
        }
        // merge _nonglobal_ module augmentations. this needs to be done after global symbol table is initialized to make sure that all ambient modules are indexed
        for &list in &augmentations {
            for &augmentation in list {
                if !is_global_scope_augmentation(a, a.parent(augmentation)) {
                    self.merge_module_augmentation(augmentation);
                }
            }
        }
    }

    pub fn merge_global_symbol(&mut self, symbol: SymbolId) {
        let a = self.ast;
        let name = a.sym(symbol).name;
        let global_symbol = a.table_get(self.globals, name);
        let merged = if !global_symbol.is_nil() {
            self.merge_symbol(global_symbol, symbol, false)
        } else {
            self.get_merged_symbol(symbol)
        };
        a.table_set(self.globals, name, merged);
    }

    pub fn merge_module_augmentation(&mut self, module_name: NodeId) {
        let a = self.ast;
        let module_node = a.parent(module_name);
        let module_augmentation = a.as_module_declaration(module_node);
        if a.sym(module_augmentation.symbol).declarations.at(0usize) != module_node {
            // this is a combined symbol for multiple augmentations within the same file. its symbol already has accumulated information for all declarations so we need to add it just once - do the work only for first declaration
            return;
        }
        if is_global_scope_augmentation(a, module_node) {
            self.merge_symbol_table(
                self.globals,
                a.sym(module_augmentation.symbol).exports,
                false,
                SymbolId::NIL,
            );
        } else {
            // find a module that about to be augmented. do not validate names of augmentations that are defined in ambient context
            let mut module_not_found_error = MessageId::NIL;
            if !a
                .flags(a.parent(a.parent(module_name)))
                .intersects(NodeFlags::AMBIENT)
            {
                module_not_found_error =
                    diagnostics::INVALID_MODULE_NAME_IN_AUGMENTATION_MODULE_0_CANNOT_BE_FOUND;
            }
            let mut main_module = self.resolve_external_module_name_worker(
                module_name,
                module_name,
                module_not_found_error,
                false,
                true,
            );
            if main_module.is_nil() {
                return;
            }
            // obtain item referenced by 'export='
            main_module = self.resolve_external_module_symbol(main_module, false);
            if a.sym(main_module).flags.intersects(SymbolFlags::NAMESPACE) {
                // If we're merging an augmentation to a pattern ambient module, we want to perform the merge unidirectionally from the augmentation ('a.foo') to the pattern ('*.foo'), so that 'getMergedSymbol()' on a.foo gives you all the exports both from the pattern and from the augmentation, but 'getMergedSymbol()' on *.foo only gives you exports from *.foo.
                if self
                    .pattern_ambient_modules
                    .iter()
                    .any(|module| main_module == module.symbol)
                {
                    let merged = self.merge_symbol(module_augmentation.symbol, main_module, true);
                    // moduleName will be a StringLiteral since this is not `declare global`.
                    let augmentations =
                        get_symbol_table(a, &mut self.pattern_ambient_module_augmentations);
                    a.table_set(augmentations, a.text(module_name), merged);
                } else {
                    let augmentation_exports = a.sym(module_augmentation.symbol).exports;
                    if !a
                        .table_get(a.sym(main_module).exports, INTERNAL_SYMBOL_NAME_EXPORT_STAR)
                        .is_nil()
                        && a.table_len(augmentation_exports) != 0
                    {
                        // We may need to merge the module augmentation's exports into the target symbols of the resolved exports
                        let resolved_exports = self.get_resolved_members_or_exports_of_symbol(
                            main_module,
                            MembersOrExportsResolutionKind::RESOLVED_EXPORTS,
                        );
                        // Upstream ranges over the exports of the augmentation (a map): the table is walked in its own order.
                        let mut position = 0;
                        while let Some((key, value)) =
                            a.table_entry_at(augmentation_exports, position)
                        {
                            position += 1;
                            let resolved_export = a.table_get(resolved_exports, key);
                            if !resolved_export.is_nil()
                                && a.table_get(a.sym(main_module).exports, key).is_nil()
                            {
                                self.merge_symbol(resolved_export, value, false);
                            }
                        }
                    }
                    self.merge_symbol(main_module, module_augmentation.symbol, false);
                }
            } else {
                // moduleName will be a StringLiteral since this is not `declare global`.
                self.error(
                    module_name,
                    diagnostics::CANNOT_AUGMENT_MODULE_0_BECAUSE_IT_RESOLVES_TO_A_NON_MODULE_ENTITY,
                    &[Arg::Str(a.text(module_name))],
                );
            }
        }
    }

    pub fn add_undefined_to_globals_or_error_on_redeclaration(&mut self) {
        let a = self.ast;
        let name = a.sym(self.undefined_symbol).name;
        let target_symbol = a.table_get(self.globals, name);
        if !target_symbol.is_nil() {
            for &declaration in a.sym(target_symbol).declarations.as_slice() {
                if !is_type_declaration(a, declaration) {
                    let diagnostic = self.create_diagnostic_for_node(
                        declaration,
                        diagnostics::DECLARATION_NAME_CONFLICTS_WITH_BUILT_IN_GLOBAL_IDENTIFIER_0,
                        &[Arg::Str(name)],
                    );
                    self.add_diagnostic(diagnostic);
                }
            }
        } else {
            a.table_set(self.globals, name, self.undefined_symbol);
        }
    }

    pub fn create_name_resolver(&self) -> NameResolver<'a, Checker<'a>> {
        NameResolver {
            compiler_options: self.compiler_options,
            get_symbol_of_declaration: Some(Checker::get_symbol_of_declaration),
            error: Some(Checker::error),
            globals: self.globals,
            arguments_symbol: self.arguments_symbol,
            require_symbol: self.require_symbol,
            lookup: Some(Checker::get_symbol),
            symbol_referenced: Some(Checker::symbol_referenced),
            set_requires_scope_change_cache: Some(Checker::set_requires_scope_change_cache),
            get_requires_scope_change_cache: Some(Checker::get_requires_scope_change_cache),
            on_property_with_invalid_initializer: Some(
                Checker::check_and_report_error_for_invalid_initializer,
            ),
            on_failed_to_resolve_symbol: Some(Checker::on_failed_to_resolve_symbol),
            on_successfully_resolved_symbol: Some(Checker::on_successfully_resolved_symbol),
        }
    }

    pub fn create_name_resolver_for_suggestion(&self) -> NameResolver<'a, Checker<'a>> {
        NameResolver {
            compiler_options: self.compiler_options,
            get_symbol_of_declaration: Some(Checker::get_symbol_of_declaration),
            error: Some(Checker::error),
            globals: self.globals,
            arguments_symbol: self.arguments_symbol,
            require_symbol: self.require_symbol,
            lookup: Some(Checker::get_suggestion_for_symbol_name_lookup),
            symbol_referenced: Some(Checker::symbol_referenced),
            set_requires_scope_change_cache: Some(Checker::set_requires_scope_change_cache),
            get_requires_scope_change_cache: Some(Checker::get_requires_scope_change_cache),
            on_property_with_invalid_initializer: None,
            on_failed_to_resolve_symbol: None,
            on_successfully_resolved_symbol: None,
        }
    }
}
