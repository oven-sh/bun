// checker/relater.go (layers R-REL, R-SIGREL, R-VARIANCE, R-DISCRIM, R-ELAB and the signature, tuple and template helpers between them): the whole file in upstream order, then the functions of the relation layer that upstream keeps in checker.go. A relater is a record of the checker named by its id: the methods of `*Relater` are methods of `RelaterId` that take the checker first.
use crate::ast::{
    Arg, Ast, CheckFlags, DiagnosticId, FunctionFlags, INTERNAL_SYMBOL_NAME_MISSING, Kind,
    ModifierFlags, NodeId, SymbolFlags, SymbolId, find_ancestor, get_declaration_of_kind,
    get_function_flags, get_source_file_of_node, is_binding_element, is_block,
    is_computed_non_literal_name, is_const_assertion, is_expression, is_function_like_declaration,
    is_identifier, is_import_call, is_in_js_file, is_jsx_attribute, is_jsx_attributes,
    is_jsx_opening_like_element, is_named_tuple_member, is_object_literal_element,
    is_omitted_expression, is_parameter_declaration, is_private_identifier,
    is_property_access_expression, is_spread_assignment, is_this_type_node, is_type_predicate_node,
};
use crate::binder::get_symbol_name_for_private_identifier;
use crate::checker::{
    AccessFlags, CacheHashKey, CachedTypeKey, CachedTypeKind, CheckMode, Checker,
    ConditionalRootId, ElementFlags, EnumRelationKey, ErrorChain, ErrorChainId, ErrorReporter,
    ErrorState, ExpandingFlags, IndexFlags, IndexInfoId, InferenceContextId, InferenceFlags,
    InferencePriority, IntersectionFlags, IntersectionState, JsxNames, LiteralValue,
    MappedTypeModifiers, MinArgumentCountFlags, ObjectFlags, RecursionFlags, RecursionId, Relater,
    RelaterId, RelationComparisonResult, RelationKind, SignatureCheckMode, SignatureFlags,
    SignatureId, SignatureKind, Ternary, TupleElementInfo, TypeAliasId, TypeComparer, TypeFacts,
    TypeFlags, TypeFormatFlags, TypeId, TypeMapperId, TypePredicate, TypePredicateId,
    TypePredicateKind, TypeSystemEntity, TypeSystemPropertyName, UnionReduction, VarianceFlags,
    VarianceStackEntry, contains_type, count_types, every_type, get_base_type_node_of_class,
    get_declaration_modifier_flags_from_symbol, get_end_element_count, get_mapped_type_modifiers,
    get_property_name_from_type, get_relation_key, get_start_element_count,
    get_string_literal_value, has_dot_dot_dot_token, has_type, is_conflicting_private_property,
    is_fresh_literal_type, is_generic_tuple_type, is_late_bound_name, is_literal_type,
    is_mutable_tuple_type, is_numeric_literal_name, is_object_literal_type,
    is_object_or_array_literal_type, is_partial_mapped_type, is_single_element_generic_tuple_type,
    is_static_private_identifier_property, is_tuple_type, is_type_any,
    is_type_usable_as_property_name, is_unit_type, is_valid_big_int_string, is_valid_number_string,
    new_simple_type_mapper, new_type_mapper, signature_has_rest_parameter, some_type,
};
use crate::collections::Set;
use crate::core::{List, Map, Text, same};
use crate::diagnostics::{self, MessageId};
use crate::internal::{FaultKind, LoopGuard};
use crate::jsnum::Number;
use crate::stringutil::{combine_surrogate_pairs, decode_js_string_rune};

// What a value needs to be a recursion id: a node, a symbol or a type.
pub trait RecursionIdValue {
    fn recursion_id(self) -> RecursionId;
}

impl RecursionIdValue for NodeId {
    fn recursion_id(self) -> RecursionId {
        RecursionId::Node(self)
    }
}

impl RecursionIdValue for SymbolId {
    fn recursion_id(self) -> RecursionId {
        RecursionId::Symbol(self)
    }
}

impl RecursionIdValue for TypeId {
    fn recursion_id(self) -> RecursionId {
        RecursionId::Type(self)
    }
}

// This function exists to constrain the types of values that can be used as recursion IDs.
pub fn as_recursion_id<T: RecursionIdValue>(value: T) -> RecursionId {
    value.recursion_id()
}

// `isRelatedTo(source, target)` and `compareTypes(s, t)` of upstream's function parameters: the callback gets the checker first.
pub type TypePairComparer<'c, 'a> = &'c mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> Ternary;

// `getTypeOfSourceProperty(sym)` of propertyRelatedTo.
pub type SymbolTypeGetter<'c, 'a> = &'c mut dyn FnMut(&mut Checker<'a>, SymbolId) -> TypeId;

// `diagnosticFactory(prop)` of elaborateElement.
pub type DiagnosticFactory<'c, 'a> = &'c mut dyn FnMut(&mut Checker<'a>, NodeId) -> DiagnosticId;

// strconv.Itoa
fn itoa(value: isize) -> Vec<u8> {
    let mut digits = [0u8; 20];
    let mut at = digits.len();
    let mut rest = value.unsigned_abs();
    loop {
        at -= 1;
        if let Some(slot) = digits.get_mut(at) {
            *slot = b'0' + (rest % 10) as u8;
        }
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    let mut out: Vec<u8> = Vec::new();
    if value < 0 {
        out.push(b'-');
    }
    out.extend_from_slice(digits.get(at..).unwrap_or(b""));
    out
}

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

    pub fn is_type_identical_to(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::Identity)
    }

    pub fn compare_types_identical(&mut self, source: TypeId, target: TypeId) -> Ternary {
        if self.is_type_related_to(source, target, RelationKind::Identity) {
            return Ternary::TRUE;
        }
        Ternary::FALSE
    }

    pub fn compare_types_assignable_simple(&mut self, source: TypeId, target: TypeId) -> Ternary {
        if self.is_type_related_to(source, target, RelationKind::Assignable) {
            return Ternary::TRUE;
        }
        Ternary::FALSE
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

    pub fn compare_types_subtype_of(&mut self, source: TypeId, target: TypeId) -> Ternary {
        if self.is_type_related_to(source, target, RelationKind::Subtype) {
            return Ternary::TRUE;
        }
        Ternary::FALSE
    }

    pub fn is_type_assignable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::Assignable)
    }

    pub fn is_type_subtype_of(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::Subtype)
    }

    pub fn is_type_strict_subtype_of(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::StrictSubtype)
    }

    pub fn is_type_comparable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_type_related_to(source, target, RelationKind::Comparable)
    }

    pub fn are_types_comparable(&mut self, type1: TypeId, type2: TypeId) -> bool {
        self.is_type_comparable_to(type1, type2) || self.is_type_comparable_to(type2, type1)
    }

    pub fn is_type_related_to(
        &mut self,
        mut source: TypeId,
        mut target: TypeId,
        relation: RelationKind,
    ) -> bool {
        if is_fresh_literal_type(self, source) {
            source = self.as_literal_type(source).regular_type;
        }
        if is_fresh_literal_type(self, target) {
            target = self.as_literal_type(target).regular_type;
        }
        if source == target {
            return true;
        }
        if relation != RelationKind::Identity {
            if relation == RelationKind::Comparable
                && !self.types[target].flags.intersects(TypeFlags::NEVER)
                && self.is_simple_type_related_to(target, source, relation, None)
                || self.is_simple_type_related_to(source, target, relation, None)
            {
                return true;
            }
        } else if !(self.types[source].flags | self.types[target].flags).intersects(
            TypeFlags::UNION_OR_INTERSECTION
                | TypeFlags::INDEXED_ACCESS
                | TypeFlags::CONDITIONAL
                | TypeFlags::SUBSTITUTION,
        ) {
            // We have excluded types that may simplify to other forms, so types must have identical flags
            if self.types[source].flags != self.types[target].flags {
                return false;
            }
            if self.types[source].flags.intersects(TypeFlags::SINGLETON) {
                return true;
            }
        }
        if self.types[source].flags.intersects(TypeFlags::OBJECT)
            && self.types[target].flags.intersects(TypeFlags::OBJECT)
        {
            let (id, _) = get_relation_key(
                self,
                source,
                target,
                IntersectionState::NONE,
                relation == RelationKind::Identity,
                false,
            );
            let related = self.relation_get(relation, id);
            if related != RelationComparisonResult::NONE {
                return related.intersects(RelationComparisonResult::SUCCEEDED);
            }
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
            || self.types[target]
                .flags
                .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
        {
            return self.check_type_related_to(source, target, relation, NodeId::NIL);
        }
        false
    }

    pub fn is_simple_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_reporter: ErrorReporter,
    ) -> bool {
        let s = self.types[source].flags;
        let t = self.types[target].flags;
        if t.intersects(TypeFlags::ANY)
            || s.intersects(TypeFlags::NEVER)
            || source == self.wildcard_type
        {
            return true;
        }
        if t.intersects(TypeFlags::UNKNOWN)
            && !(relation == RelationKind::StrictSubtype && s.intersects(TypeFlags::ANY))
        {
            return true;
        }
        if t.intersects(TypeFlags::NEVER) {
            return false;
        }
        if s.intersects(TypeFlags::STRING_LIKE) && t.intersects(TypeFlags::STRING) {
            return true;
        }
        if s.intersects(TypeFlags::STRING_LITERAL)
            && s.intersects(TypeFlags::ENUM_LITERAL)
            && t.intersects(TypeFlags::STRING_LITERAL)
            && !t.intersects(TypeFlags::ENUM_LITERAL)
            && self.as_literal_type(source).value == self.as_literal_type(target).value
        {
            return true;
        }
        if s.intersects(TypeFlags::NUMBER_LIKE) && t.intersects(TypeFlags::NUMBER) {
            return true;
        }
        if s.intersects(TypeFlags::NUMBER_LITERAL)
            && s.intersects(TypeFlags::ENUM_LITERAL)
            && t.intersects(TypeFlags::NUMBER_LITERAL)
            && !t.intersects(TypeFlags::ENUM_LITERAL)
            && self.as_literal_type(source).value == self.as_literal_type(target).value
        {
            return true;
        }
        if s.intersects(TypeFlags::BIG_INT_LIKE) && t.intersects(TypeFlags::BIG_INT) {
            return true;
        }
        if s.intersects(TypeFlags::BOOLEAN_LIKE) && t.intersects(TypeFlags::BOOLEAN) {
            return true;
        }
        if s.intersects(TypeFlags::ES_SYMBOL_LIKE) && t.intersects(TypeFlags::ES_SYMBOL) {
            return true;
        }
        let source_symbol = self.types[source].symbol;
        let target_symbol = self.types[target].symbol;
        if s.intersects(TypeFlags::ENUM)
            && t.intersects(TypeFlags::ENUM)
            && self.ast.sym(source_symbol).name == self.ast.sym(target_symbol).name
            && self.is_enum_type_related_to(source_symbol, target_symbol, error_reporter)
        {
            return true;
        }
        if s.intersects(TypeFlags::ENUM_LITERAL) && t.intersects(TypeFlags::ENUM_LITERAL) {
            if s.intersects(TypeFlags::UNION)
                && t.intersects(TypeFlags::UNION)
                && self.is_enum_type_related_to(source_symbol, target_symbol, error_reporter)
            {
                return true;
            }
            if s.intersects(TypeFlags::LITERAL)
                && t.intersects(TypeFlags::LITERAL)
                && self.as_literal_type(source).value == self.as_literal_type(target).value
                && self.is_enum_type_related_to(source_symbol, target_symbol, error_reporter)
            {
                return true;
            }
        }
        // In non-strictNullChecks mode, `undefined` and `null` are assignable to anything except `never`. Since unions and intersections may reduce to `never`, we exclude them here.
        if s.intersects(TypeFlags::UNDEFINED)
            && (!self.strict_null_checks && !t.intersects(TypeFlags::UNION_OR_INTERSECTION)
                || t.intersects(TypeFlags::UNDEFINED | TypeFlags::VOID))
        {
            return true;
        }
        if s.intersects(TypeFlags::NULL)
            && (!self.strict_null_checks && !t.intersects(TypeFlags::UNION_OR_INTERSECTION)
                || t.intersects(TypeFlags::NULL))
        {
            return true;
        }
        if s.intersects(TypeFlags::OBJECT)
            && t.intersects(TypeFlags::NON_PRIMITIVE)
            && !(relation == RelationKind::StrictSubtype
                && self.is_empty_anonymous_object_type(source)
                && !self.types[source]
                    .object_flags
                    .intersects(ObjectFlags::FRESH_LITERAL))
        {
            return true;
        }
        if relation == RelationKind::Assignable || relation == RelationKind::Comparable {
            if s.intersects(TypeFlags::ANY) {
                return true;
            }
            // Type number is assignable to any computed numeric enum type or any numeric enum literal type, and a numeric literal type is assignable any computed numeric enum type or any numeric enum literal type with a matching value. These rules exist such that enums can be used for bit-flag purposes.
            if s.intersects(TypeFlags::NUMBER)
                && (t.intersects(TypeFlags::ENUM)
                    || t.intersects(TypeFlags::NUMBER_LITERAL)
                        && t.intersects(TypeFlags::ENUM_LITERAL))
            {
                return true;
            }
            if s.intersects(TypeFlags::NUMBER_LITERAL)
                && !s.intersects(TypeFlags::ENUM_LITERAL)
                && (t.intersects(TypeFlags::ENUM)
                    || t.intersects(TypeFlags::NUMBER_LITERAL)
                        && t.intersects(TypeFlags::ENUM_LITERAL)
                        && self.as_literal_type(source).value == self.as_literal_type(target).value)
            {
                return true;
            }
            // Anything is assignable to a union containing undefined, null, and {}
            if self.is_unknown_like_union_type(target) {
                return true;
            }
        }
        false
    }

    pub fn is_enum_type_related_to(
        &mut self,
        source: SymbolId,
        target: SymbolId,
        error_reporter: ErrorReporter,
    ) -> bool {
        // core.IfElse evaluates both of its arguments: the parent is looked up for every symbol.
        let source_parent = self.get_parent_of_symbol(source);
        let source_symbol = if self
            .ast
            .sym(source)
            .flags
            .intersects(SymbolFlags::ENUM_MEMBER)
        {
            source_parent
        } else {
            source
        };
        let target_parent = self.get_parent_of_symbol(target);
        let target_symbol = if self
            .ast
            .sym(target)
            .flags
            .intersects(SymbolFlags::ENUM_MEMBER)
        {
            target_parent
        } else {
            target
        };
        if source_symbol == target_symbol {
            return true;
        }
        if self.ast.sym(source_symbol).name != self.ast.sym(target_symbol).name
            || !self
                .ast
                .sym(source_symbol)
                .flags
                .intersects(SymbolFlags::REGULAR_ENUM)
            || !self
                .ast
                .sym(target_symbol)
                .flags
                .intersects(SymbolFlags::REGULAR_ENUM)
        {
            return false;
        }
        let key = EnumRelationKey {
            source_id: self.ast.get_symbol_id(source_symbol),
            target_id: self.ast.get_symbol_id(target_symbol),
        };
        let entry = self.enum_relation.get(&key);
        if entry != RelationComparisonResult::NONE
            && !(entry.intersects(RelationComparisonResult::FAILED) && error_reporter.is_some())
        {
            return entry.intersects(RelationComparisonResult::SUCCEEDED);
        }
        let target_enum_type = self.get_type_of_symbol(target_symbol);
        let source_enum_type = self.get_type_of_symbol(source_symbol);
        let source_properties = self.get_properties_of_type(source_enum_type);
        for &source_property in source_properties.as_slice() {
            let source_property_symbol = self.ast.sym(source_property);
            if source_property_symbol
                .flags
                .intersects(SymbolFlags::ENUM_MEMBER)
            {
                let target_property =
                    self.get_property_of_type(target_enum_type, source_property_symbol.name);
                if target_property.is_nil()
                    || !self
                        .ast
                        .sym(target_property)
                        .flags
                        .intersects(SymbolFlags::ENUM_MEMBER)
                {
                    if error_reporter.is_some() {
                        let property_text = self.symbol_to_string(source_property);
                        let declared_type = self.get_declared_type_of_symbol(target_symbol);
                        let type_text = self.type_to_string_ex_exported(
                            declared_type,
                            NodeId::NIL,
                            TypeFormatFlags::USE_FULLY_QUALIFIED_TYPE,
                            None,
                        );
                        self.call_error_reporter(
                            error_reporter,
                            diagnostics::PROPERTY_0_IS_MISSING_IN_TYPE_1,
                            &[Arg::Str(&property_text), Arg::Str(&type_text)],
                        );
                    }
                    let ok = self
                        .enum_relation
                        .set(key, RelationComparisonResult::FAILED);
                    self.map_set(ok);
                    return false;
                }
                let source_declaration =
                    get_declaration_of_kind(self.ast, source_property, Kind::EnumMember);
                let source_value = self.get_enum_member_value(source_declaration).value;
                let target_declaration =
                    get_declaration_of_kind(self.ast, target_property, Kind::EnumMember);
                let target_value = self.get_enum_member_value(target_declaration).value;
                if source_value != target_value {
                    // If we have 2 enums with *known* values that differ, they are incompatible.
                    if !matches!(source_value, LiteralValue::Nil)
                        && !matches!(target_value, LiteralValue::Nil)
                    {
                        if error_reporter.is_some() {
                            let symbol_text = self.symbol_to_string(target_symbol);
                            let property_text = self.symbol_to_string(target_property);
                            let target_text = self.value_to_string(&target_value);
                            let source_text = self.value_to_string(&source_value);
                            self.call_error_reporter(
                                error_reporter,
                                diagnostics::EACH_DECLARATION_OF_0_1_DIFFERS_IN_ITS_VALUE_WHERE_2_WAS_EXPECTED_BUT_3_WAS_GIVEN,
                                &[
                                    Arg::Str(&symbol_text),
                                    Arg::Str(&property_text),
                                    Arg::Str(&target_text),
                                    Arg::Str(&source_text),
                                ],
                            );
                        }
                        let ok = self
                            .enum_relation
                            .set(key, RelationComparisonResult::FAILED);
                        self.map_set(ok);
                        return false;
                    }
                    // At this point we know that at least one of the values is 'undefined'. This may mean that we have an opaque member from an ambient enum declaration, or that we were not able to calculate it (which is basically an error). Either way, we can assume that it's numeric. If the other is a string, we have a mismatch in types.
                    let source_is_string = matches!(source_value, LiteralValue::String(_));
                    let target_is_string = matches!(target_value, LiteralValue::String(_));
                    if source_is_string || target_is_string {
                        if error_reporter.is_some() {
                            let known_string_value = if !matches!(source_value, LiteralValue::Nil) {
                                source_value
                            } else {
                                target_value
                            };
                            let symbol_text = self.symbol_to_string(target_symbol);
                            let property_text = self.symbol_to_string(target_property);
                            let value_text = self.value_to_string(&known_string_value);
                            self.call_error_reporter(
                                error_reporter,
                                diagnostics::ONE_VALUE_OF_0_1_IS_THE_STRING_2_AND_THE_OTHER_IS_ASSUMED_TO_BE_AN_UNKNOWN_NUMERIC_VALUE,
                                &[
                                    Arg::Str(&symbol_text),
                                    Arg::Str(&property_text),
                                    Arg::Str(&value_text),
                                ],
                            );
                        }
                        let ok = self
                            .enum_relation
                            .set(key, RelationComparisonResult::FAILED);
                        self.map_set(ok);
                        return false;
                    }
                }
            }
        }
        let ok = self
            .enum_relation
            .set(key, RelationComparisonResult::SUCCEEDED);
        self.map_set(ok);
        true
    }

    pub fn check_type_assignable_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: NodeId,
        head_message: MessageId,
    ) -> bool {
        self.check_type_related_to_ex(
            source,
            target,
            RelationKind::Assignable,
            error_node,
            head_message,
            None,
        )
    }

    pub fn check_type_assignable_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: NodeId,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        self.check_type_related_to_ex(
            source,
            target,
            RelationKind::Assignable,
            error_node,
            head_message,
            diagnostic_output,
        )
    }

    pub fn check_type_comparable_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: NodeId,
        head_message: MessageId,
    ) -> bool {
        self.check_type_related_to_ex(
            source,
            target,
            RelationKind::Comparable,
            error_node,
            head_message,
            None,
        )
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

    // Check that source is related to target according to the given relation. When errorNode is non-nil, errors are reported to the checker's diagnostic collection or through diagnosticOutput when non-nil. Callers can assume that this function only reports zero or one error to diagnosticOutput (unlike checkTypeRelatedToAndOptionallyElaborate).
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
            let source_text = self.type_to_string_exported(source);
            let target_text = self.type_to_string_exported(target);
            let diagnostic = self.new_diagnostic_for_node(
                error_node,
                diagnostics::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1,
                &[Arg::Str(&source_text), Arg::Str(&target_text)],
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
                if !originating_import.is_nil() && !is_import_call(self.ast, originating_import) {
                    let links_target = self.export_type_links[links].target;
                    let target_type = self.get_type_of_symbol(links_target);
                    let helpful_retry =
                        self.check_type_related_to(target_type, target, relation, NodeId::NIL);
                    if helpful_retry {
                        // Likely an incorrect import. Issue a helpful diagnostic to produce a quickfix to change the import
                        let info = self.create_diagnostic_for_node(
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
}

// The chain is as long as the elaboration is deep: the entry tests the stack. The chain nodes are records of the relater, so it is a parameter.
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

impl<'a> Checker<'a> {
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

    pub fn check_type_assignable_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: NodeId,
        expr: NodeId,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        self.check_type_related_to_and_optionally_elaborate(
            source,
            target,
            RelationKind::Assignable,
            error_node,
            expr,
            head_message,
            diagnostic_output,
        )
    }

    pub fn check_type_related_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_node: NodeId,
        expr: NodeId,
        head_message: MessageId,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        if self.is_type_related_to(source, target, relation) {
            return true;
        }
        if !error_node.is_nil()
            && !self.elaborate_error(
                expr,
                source,
                target,
                relation,
                head_message,
                diagnostic_output.as_deref_mut(),
            )
        {
            return self.check_type_related_to_ex(
                source,
                target,
                relation,
                error_node,
                head_message,
                diagnostic_output,
            );
        }
        false
    }

    // The elaboration follows the expression tree: the entry tests the stack.
    pub fn elaborate_error(
        &mut self,
        node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        head_message: MessageId,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if node.is_nil() || self.is_or_has_generic_conditional(target) {
            return false;
        }
        if self.compiler_options.no_check.is_true() {
            return false;
        }
        if self.elaborate_did_you_mean_to_call_or_construct(
            node,
            source,
            target,
            relation,
            SignatureKind::CONSTRUCT,
            head_message,
            diagnostic_output.as_deref_mut(),
        ) || self.elaborate_did_you_mean_to_call_or_construct(
            node,
            source,
            target,
            relation,
            SignatureKind::CALL,
            head_message,
            diagnostic_output.as_deref_mut(),
        ) {
            return true;
        }
        match self.ast.kind(node) {
            Kind::AsExpression if !is_const_assertion(self.ast, node) => {}
            Kind::AsExpression | Kind::JsxExpression | Kind::ParenthesizedExpression => {
                let expression = self.ast.expression(node);
                return self.elaborate_error(
                    expression,
                    source,
                    target,
                    relation,
                    head_message,
                    diagnostic_output,
                );
            }
            Kind::BinaryExpression => {
                let binary = self.ast.as_binary_expression(node);
                match self.ast.kind(binary.operator_token) {
                    Kind::EqualsToken | Kind::CommaToken => {
                        return self.elaborate_error(
                            binary.right,
                            source,
                            target,
                            relation,
                            head_message,
                            diagnostic_output,
                        );
                    }
                    _ => {}
                }
            }
            Kind::ObjectLiteralExpression => {
                return self.elaborate_object_literal(
                    node,
                    source,
                    target,
                    relation,
                    diagnostic_output,
                );
            }
            Kind::ArrayLiteralExpression => {
                return self.elaborate_array_literal(
                    node,
                    source,
                    target,
                    relation,
                    diagnostic_output,
                );
            }
            Kind::ArrowFunction => {
                return self.elaborate_arrow_function(
                    node,
                    source,
                    target,
                    relation,
                    diagnostic_output,
                );
            }
            Kind::JsxAttributes => {
                return self.elaborate_jsx_components(
                    node,
                    source,
                    target,
                    relation,
                    diagnostic_output,
                );
            }
            _ => {}
        }
        false
    }

    pub fn is_or_has_generic_conditional(&mut self, t: TypeId) -> bool {
        if self.types[t].flags.intersects(TypeFlags::CONDITIONAL) {
            return true;
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            for &constituent in self.type_types(t).as_slice() {
                if self.is_or_has_generic_conditional(constituent) {
                    return true;
                }
            }
        }
        false
    }

    pub fn elaborate_did_you_mean_to_call_or_construct(
        &mut self,
        node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        kind: SignatureKind,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let signatures = self.get_signatures_of_type(source, kind);
        let mut some = false;
        for &s in signatures.as_slice() {
            let return_type = self.get_return_type_of_signature(s);
            if !self.types[return_type]
                .flags
                .intersects(TypeFlags::ANY | TypeFlags::NEVER)
                && self.check_type_related_to(return_type, target, relation, NodeId::NIL)
            {
                some = true;
                break;
            }
        }
        if some {
            let mut diags: Vec<DiagnosticId> = Vec::new();
            if !self.check_type_related_to_ex(
                source,
                target,
                relation,
                node,
                head_message,
                Some(&mut diags),
            ) {
                let diagnostic = match diags.first() {
                    Some(&diagnostic) => diagnostic,
                    None => self.fail("index out of range"),
                };
                let message = if kind == SignatureKind::CONSTRUCT {
                    diagnostics::DID_YOU_MEAN_TO_USE_NEW_WITH_THIS_EXPRESSION
                } else {
                    diagnostics::DID_YOU_MEAN_TO_CALL_THIS_EXPRESSION
                };
                let info = self.create_diagnostic_for_node(node, message, &[]);
                let diagnostic = self.diagnostic_store.add_related_info(diagnostic, info);
                self.report_diagnostic(diagnostic, diagnostic_output);
                return true;
            }
        }
        false
    }

    pub fn elaborate_object_literal(
        &mut self,
        node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        if self.types[target]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::NEVER)
        {
            return false;
        }
        let mut reported_error = false;
        for &prop in self.ast.properties(node).as_slice() {
            if is_spread_assignment(self.ast, prop) {
                continue;
            }
            let prop_symbol = self.get_symbol_of_declaration(prop);
            let name_type = self.get_literal_type_from_property(
                prop_symbol,
                TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                false,
            );
            if name_type.is_nil() || self.types[name_type].flags.intersects(TypeFlags::NEVER) {
                continue;
            }
            match self.ast.kind(prop) {
                Kind::SetAccessor
                | Kind::GetAccessor
                | Kind::MethodDeclaration
                | Kind::ShorthandPropertyAssignment => {
                    let name = self.ast.name(prop);
                    reported_error = self.elaborate_element(
                        source,
                        target,
                        relation,
                        name,
                        NodeId::NIL,
                        name_type,
                        MessageId::NIL,
                        None,
                        diagnostic_output.as_deref_mut(),
                    ) || reported_error;
                }
                Kind::PropertyAssignment => {
                    let name = self.ast.name(prop);
                    let message = if is_computed_non_literal_name(self.ast, name) {
                        diagnostics::TYPE_OF_COMPUTED_PROPERTY_S_VALUE_IS_0_WHICH_IS_NOT_ASSIGNABLE_TO_TYPE_1
                    } else {
                        MessageId::NIL
                    };
                    let initializer = self.ast.initializer(prop);
                    reported_error = self.elaborate_element(
                        source,
                        target,
                        relation,
                        name,
                        initializer,
                        name_type,
                        message,
                        None,
                        diagnostic_output.as_deref_mut(),
                    ) || reported_error;
                }
                _ => {}
            }
        }
        reported_error
    }

    pub fn elaborate_array_literal(
        &mut self,
        node: NodeId,
        mut source: TypeId,
        target: TypeId,
        relation: RelationKind,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        if self.types[target]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::NEVER)
        {
            return false;
        }
        if !self.is_tuple_like_type(source) {
            self.push_contextual_type(node, target, false);
            source = self.check_array_literal(node, CheckMode::CONTEXTUAL | CheckMode::FORCE_TUPLE);
            self.pop_contextual_type();
            if !self.is_tuple_like_type(source) {
                return false;
            }
        }
        let mut reported_error = false;
        for (i, &element) in self.ast.elements(node).as_slice().iter().enumerate() {
            if is_omitted_expression(self.ast, element) {
                continue;
            }
            if self.is_tuple_like_type(target) {
                let index_name = Number(i as f64).string();
                if self.get_property_of_type(target, &index_name).is_nil() {
                    continue;
                }
            }
            let name_type = self.get_number_literal_type(Number(i as f64));
            let check_node = self.get_effective_check_node(element);
            reported_error = self.elaborate_element(
                source,
                target,
                relation,
                check_node,
                check_node,
                name_type,
                MessageId::NIL,
                None,
                diagnostic_output.as_deref_mut(),
            ) || reported_error;
        }
        reported_error
    }

    pub fn elaborate_element(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        prop: NodeId,
        next: NodeId,
        name_type: TypeId,
        error_message: MessageId,
        diagnostic_factory: Option<DiagnosticFactory<'_, 'a>>,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let mut target_prop_type =
            self.get_best_match_indexed_access_type_or_undefined(source, target, name_type);
        if target_prop_type.is_nil()
            || self.types[target_prop_type]
                .flags
                .intersects(TypeFlags::INDEXED_ACCESS)
        {
            // Don't elaborate on indexes on generic variables
            return false;
        }
        let mut source_prop_type = self.get_indexed_access_type_or_undefined(
            source,
            name_type,
            AccessFlags::NONE,
            NodeId::NIL,
            TypeAliasId::NIL,
        );
        if source_prop_type.is_nil()
            || self.check_type_related_to(source_prop_type, target_prop_type, relation, NodeId::NIL)
        {
            // Don't elaborate on indexes on generic variables or when types match
            return false;
        }
        if !next.is_nil()
            && self.elaborate_error(
                next,
                source_prop_type,
                target_prop_type,
                relation,
                MessageId::NIL,
                diagnostic_output.as_deref_mut(),
            )
        {
            return true;
        }
        // Issue error on the prop itself, since the prop couldn't elaborate the error
        let mut diags: Vec<DiagnosticId> = Vec::new();
        // Use the expression type, if available
        let mut specific_source = source_prop_type;
        if !next.is_nil() {
            specific_source = self
                .check_expression_for_mutable_location_with_contextual_type(next, source_prop_type);
        }
        if let Some(diagnostic_factory) = diagnostic_factory {
            // Use the custom diagnostic factory if provided (e.g., for JSX text children with dynamic error messages)
            let diagnostic = diagnostic_factory(self, prop);
            diags.push(diagnostic);
        } else if self.exact_optional_property_types
            && self.is_exact_optional_property_mismatch(specific_source, target_prop_type)
        {
            let source_text = self.type_to_string_exported(specific_source);
            let target_text = self.type_to_string_exported(target_prop_type);
            let diagnostic = self.create_diagnostic_for_node(
                prop,
                diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_WITH_EXACTOPTIONALPROPERTYTYPES_COLON_TRUE_CONSIDER_ADDING_UNDEFINED_TO_THE_TYPE_OF_THE_TARGET,
                &[Arg::Str(&source_text), Arg::Str(&target_text)],
            );
            diags.push(diagnostic);
        } else {
            let prop_name = self.get_property_name_from_index(name_type, NodeId::NIL);
            let mut target_symbol = self.get_property_of_type(target, &prop_name);
            if target_symbol.is_nil() {
                target_symbol = self.unknown_symbol;
            }
            let target_is_optional = self
                .ast
                .sym(target_symbol)
                .flags
                .intersects(SymbolFlags::OPTIONAL);
            let mut source_symbol = self.get_property_of_type(source, &prop_name);
            if source_symbol.is_nil() {
                source_symbol = self.unknown_symbol;
            }
            let source_is_optional = self
                .ast
                .sym(source_symbol)
                .flags
                .intersects(SymbolFlags::OPTIONAL);
            target_prop_type = self.remove_missing_type(target_prop_type, target_is_optional);
            source_prop_type = self
                .remove_missing_type(source_prop_type, target_is_optional && source_is_optional);
            let result = self.check_type_related_to_ex(
                specific_source,
                target_prop_type,
                relation,
                prop,
                error_message,
                Some(&mut diags),
            );
            if result && specific_source != source_prop_type {
                // If for whatever reason the expression type doesn't yield an error, make sure we still issue an error on the sourcePropType
                self.check_type_related_to_ex(
                    source_prop_type,
                    target_prop_type,
                    relation,
                    prop,
                    error_message,
                    Some(&mut diags),
                );
            }
        }
        let Some(&diagnostic) = diags.first() else {
            return false;
        };
        let mut property_name: Vec<u8> = Vec::new();
        let mut target_prop = SymbolId::NIL;
        if is_type_usable_as_property_name(self, name_type) {
            property_name.extend_from_slice(&get_property_name_from_type(self, name_type));
            target_prop = self.get_property_of_type(target, &property_name);
        }
        let mut issued_elaboration = false;
        if target_prop.is_nil() {
            let index_info = self.get_applicable_index_info(target, name_type);
            if !index_info.is_nil() {
                let declaration = self.index_infos[index_info].declaration;
                if !declaration.is_nil()
                    && !self
                        .program
                        .is_source_file_default_library(get_source_file_of_node(
                            self.ast,
                            declaration,
                        ))
                {
                    issued_elaboration = true;
                    let info = self.create_diagnostic_for_node(
                        declaration,
                        diagnostics::THE_EXPECTED_TYPE_COMES_FROM_THIS_INDEX_SIGNATURE,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, info);
                }
            }
        }
        let target_prop_declarations = self.ast.sym(target_prop).declarations;
        let target_type_symbol = self.types[target].symbol;
        let target_type_declarations = self.ast.sym(target_type_symbol).declarations;
        if !issued_elaboration
            && (!target_prop.is_nil() && target_prop_declarations.len() != 0
                || !target_type_symbol.is_nil() && target_type_declarations.len() != 0)
        {
            let target_node = if !target_prop.is_nil() && target_prop_declarations.len() != 0 {
                target_prop_declarations.at(0usize)
            } else {
                target_type_declarations.at(0usize)
            };
            if property_name.is_empty()
                || self.types[name_type]
                    .flags
                    .intersects(TypeFlags::UNIQUE_ES_SYMBOL)
            {
                property_name = self.type_to_string_exported(name_type);
            }
            if !self
                .program
                .is_source_file_default_library(get_source_file_of_node(self.ast, target_node))
            {
                let target_text = self.type_to_string_exported(target);
                let info = self.create_diagnostic_for_node(
                    target_node,
                    diagnostics::THE_EXPECTED_TYPE_COMES_FROM_PROPERTY_0_WHICH_IS_DECLARED_HERE_ON_TYPE_1,
                    &[Arg::Str(&property_name), Arg::Str(&target_text)],
                );
                self.diagnostic_store.add_related_info(diagnostic, info);
            }
        }
        self.report_diagnostic(diagnostic, diagnostic_output);
        true
    }

    pub fn get_best_match_indexed_access_type_or_undefined(
        &mut self,
        source: TypeId,
        target: TypeId,
        name_type: TypeId,
    ) -> TypeId {
        let idx = self.get_indexed_access_type_or_undefined(
            target,
            name_type,
            AccessFlags::NONE,
            NodeId::NIL,
            TypeAliasId::NIL,
        );
        if !idx.is_nil() {
            return idx;
        }
        if self.types[target].flags.intersects(TypeFlags::UNION) {
            let best = self.get_best_matching_type(source, target, &mut |c, s, t| {
                c.compare_types_assignable_simple(s, t)
            });
            if !best.is_nil() {
                return self.get_indexed_access_type_or_undefined(
                    best,
                    name_type,
                    AccessFlags::NONE,
                    NodeId::NIL,
                    TypeAliasId::NIL,
                );
            }
        }
        TypeId::NIL
    }

    pub fn check_expression_for_mutable_location_with_contextual_type(
        &mut self,
        next: NodeId,
        source_prop_type: TypeId,
    ) -> TypeId {
        self.push_contextual_type(next, source_prop_type, false);
        let result = self.check_expression_for_mutable_location(next, CheckMode::CONTEXTUAL);
        self.pop_contextual_type();
        result
    }

    pub fn elaborate_arrow_function(
        &mut self,
        node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        // Don't elaborate blocks or functions with annotated parameter types
        if is_block(self.ast, self.ast.body(node)) {
            return false;
        }
        for &parameter in self.ast.parameters(node).as_slice() {
            if has_type(self.ast, parameter) {
                return false;
            }
        }
        let source_sig = self.get_single_call_signature(source);
        if source_sig.is_nil() {
            return false;
        }
        let target_signatures = self.get_signatures_of_type(target, SignatureKind::CALL);
        if target_signatures.len() == 0 {
            return false;
        }
        let return_expression = self.ast.body(node);
        let source_return = self.get_return_type_of_signature(source_sig);
        let target_return_types =
            self.map_list(target_signatures, |c, s| c.get_return_type_of_signature(s));
        let target_return = self.get_union_type(target_return_types);
        if self.check_type_related_to(source_return, target_return, relation, NodeId::NIL) {
            return false;
        }
        if !return_expression.is_nil()
            && self.elaborate_error(
                return_expression,
                source_return,
                target_return,
                relation,
                MessageId::NIL,
                diagnostic_output.as_deref_mut(),
            )
        {
            return true;
        }
        let mut diags: Vec<DiagnosticId> = Vec::new();
        self.check_type_related_to_ex(
            source_return,
            target_return,
            relation,
            return_expression,
            MessageId::NIL,
            Some(&mut diags),
        );
        if let Some(&diagnostic) = diags.first() {
            let target_symbol = self.types[target].symbol;
            let target_declarations = self.ast.sym(target_symbol).declarations;
            if !target_symbol.is_nil() && target_declarations.len() != 0 {
                let info = self.create_diagnostic_for_node(
                    target_declarations.at(0usize),
                    diagnostics::THE_EXPECTED_TYPE_COMES_FROM_THE_RETURN_TYPE_OF_THIS_SIGNATURE,
                    &[],
                );
                self.diagnostic_store.add_related_info(diagnostic, info);
            }
            if !get_function_flags(self.ast, node).intersects(FunctionFlags::ASYNC)
                && self
                    .get_type_of_property_of_type(source_return, b"then")
                    .is_nil()
            {
                let promise_type = self.create_promise_type(source_return);
                if self.check_type_related_to(promise_type, target_return, relation, NodeId::NIL) {
                    let info = self.create_diagnostic_for_node(
                        node,
                        diagnostics::DID_YOU_MEAN_TO_MARK_THIS_FUNCTION_AS_ASYNC,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, info);
                }
            }
            self.report_diagnostic(diagnostic, diagnostic_output);
            return true;
        }
        false
    }

    // A type is 'weak' if it is an object type with at least one optional property and no required properties, call/construct signatures or index signatures
    pub fn is_weak_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            self.resolve_structured_type_members(t);
            let resolved = self.as_structured_type(t);
            let signatures = resolved.signatures;
            let index_infos = resolved.index_infos;
            let properties = resolved.properties;
            if signatures.len() != 0 || index_infos.len() != 0 || properties.len() <= 0 {
                return false;
            }
            for &p in properties.as_slice() {
                if !self.ast.sym(p).flags.intersects(SymbolFlags::OPTIONAL) {
                    return false;
                }
            }
            return true;
        }
        if self.types[t].flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(t).base_type;
            return self.is_weak_type(base_type);
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            for &constituent in self.type_types(t).as_slice() {
                if !self.is_weak_type(constituent) {
                    return false;
                }
            }
            return true;
        }
        false
    }

    pub fn has_common_properties(
        &mut self,
        source: TypeId,
        target: TypeId,
        is_comparing_jsx_attributes: bool,
    ) -> bool {
        let properties = self.get_properties_of_type(source);
        for &prop in properties.as_slice() {
            let name = self.ast.sym(prop).name;
            if self.is_known_property(target, name, is_comparing_jsx_attributes) {
                return true;
            }
        }
        false
    }

    // Check if a property with the given name is known anywhere in the given type. In an object type, a property is considered known if 1. the object type is empty and the check is for assignability, or 2. if the object type has index signatures, or 3. if the property is actually declared in the object type (this means that 'toString', for example, is not usually a known property). 4. In a union or intersection type, a property is considered known if it is known in any constituent type.
    pub fn is_known_property(
        &mut self,
        target_type: TypeId,
        name: &[u8],
        is_comparing_jsx_attributes: bool,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[target_type].flags.intersects(TypeFlags::OBJECT) {
            // For backwards compatibility a symbol-named property is satisfied by a string index signature. This is incorrect and inconsistent with element access expressions, where it is an error, so eventually we should remove this exception.
            if !self.get_property_of_object_type(target_type, name).is_nil()
                || !self
                    .get_applicable_index_info_for_name(target_type, name)
                    .is_nil()
                || is_late_bound_name(name)
                    && !self
                        .get_index_info_of_type(target_type, self.string_type)
                        .is_nil()
                || is_comparing_jsx_attributes && is_hyphenated_jsx_name(name)
            {
                // For JSXAttributes, if the attribute has a hyphenated name, consider that the attribute to be known.
                return true;
            }
        }
        if self.types[target_type]
            .flags
            .intersects(TypeFlags::SUBSTITUTION)
        {
            let base_type = self.as_substitution_type(target_type).base_type;
            return self.is_known_property(base_type, name, is_comparing_jsx_attributes);
        }
        if self.types[target_type]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
            && is_excess_property_check_target(self, target_type)
        {
            for &t in self.type_types(target_type).as_slice() {
                if self.is_known_property(t, name, is_comparing_jsx_attributes) {
                    return true;
                }
            }
        }
        false
    }
}

pub fn is_hyphenated_jsx_name(name: &[u8]) -> bool {
    bun_core::strings::contains(name, b"-")
}

// A substitution type nests as deep as its base type: the entry tests the stack.
pub fn is_excess_property_check_target(c: &Checker<'_>, t: TypeId) -> bool {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    let flags = c.types[t].flags;
    flags.intersects(TypeFlags::OBJECT)
        && !c.types[t]
            .object_flags
            .intersects(ObjectFlags::OBJECT_LITERAL_PATTERN_WITH_COMPUTED_PROPERTIES)
        || flags.intersects(TypeFlags::NON_PRIMITIVE)
        || flags.intersects(TypeFlags::SUBSTITUTION)
            && is_excess_property_check_target(c, c.as_substitution_type(t).base_type)
        || flags.intersects(TypeFlags::UNION)
            && c.type_types(t)
                .as_slice()
                .iter()
                .any(|&u| is_excess_property_check_target(c, u))
        || flags.intersects(TypeFlags::INTERSECTION)
            && c.type_types(t)
                .as_slice()
                .iter()
                .all(|&u| is_excess_property_check_target(c, u))
}

impl<'a> Checker<'a> {
    // Return true if the given type is deeply nested. We consider this to be the case when the given stack contains maxDepth or more occurrences of types with the same recursion identity as the given type. The recursion identity provides a shared identity for type instantiations that repeat in some (possibly infinite) pattern. A homomorphic mapped type is considered deeply nested if its target type is deeply nested, and an intersection is considered deeply nested if any constituent of the intersection is deeply nested. It is possible, though highly unlikely, for the deeply nested check to be true in a situation where a chain of instantiations is not infinitely expanding. Effectively, we will generate a false positive when two types are structurally equal to at least maxDepth levels, but unequal at some level beyond that.
    pub fn is_deeply_nested_type(&mut self, t: TypeId, stack: &[TypeId], max_depth: isize) -> bool {
        if stack.len() as isize >= max_depth {
            let target = get_recursion_identity_target(self, t);
            if self.types[target].flags.intersects(TypeFlags::INTERSECTION) {
                for &t in self.type_types(target).as_slice() {
                    if self.is_deeply_nested_type(t, stack, max_depth) {
                        return true;
                    }
                }
            } else {
                let identity = get_recursion_identity_from_target(self, target);
                let mut count: isize = 0;
                let mut last_type_id = TypeId::NIL;
                for &t in stack {
                    if has_matching_recursion_identity(self, t, identity) {
                        // We only count occurrences with a higher type id than the previous occurrence, since higher type ids are an indicator of newer instantiations caused by recursion.
                        if t >= last_type_id {
                            count += 1;
                            if count >= max_depth {
                                return true;
                            }
                        }
                        last_type_id = t;
                    }
                }
            }
        }
        false
    }
}

pub fn has_matching_recursion_identity(
    c: &mut Checker<'_>,
    t: TypeId,
    identity: RecursionId,
) -> bool {
    let target = get_recursion_identity_target(c, t);
    if c.types[target].flags.intersects(TypeFlags::INTERSECTION) {
        for &t in c.type_types(target).as_slice() {
            if has_matching_recursion_identity(c, t, identity) {
                return true;
            }
        }
        return false;
    }
    get_recursion_identity_from_target(c, target) == identity
}

pub fn get_recursion_identity(c: &mut Checker<'_>, t: TypeId) -> RecursionId {
    let target = get_recursion_identity_target(c, t);
    get_recursion_identity_from_target(c, target)
}

// Get the recursion identity target type from a type. Recursively (a) obtain the target object type of an indexed access (i.e. the T in T[K]), and (b) unwrap nested homomorphic mapped types and return the deepest target type that has a symbol. The unwrapping better preserves unique type identities for mapped types applied to explicitly written object literals.
pub fn get_recursion_identity_target(c: &mut Checker<'_>, t: TypeId) -> TypeId {
    if !c.stack_check.is_safe_to_recurse() {
        c.stack_limit::<()>();
        return t;
    }
    if c.types[t].flags.intersects(TypeFlags::INDEXED_ACCESS) {
        let object_type = c.as_indexed_access_type(t).object_type;
        return get_recursion_identity_target(c, object_type);
    }
    if c.types[t]
        .object_flags
        .contains(ObjectFlags::INSTANTIATED_MAPPED)
    {
        let target = c.get_modifiers_type_from_mapped_type(t);
        if !target.is_nil() {
            let mut has_symbol = !c.types[target].symbol.is_nil();
            if !has_symbol && c.types[target].flags.intersects(TypeFlags::INTERSECTION) {
                has_symbol = c
                    .type_types(target)
                    .as_slice()
                    .iter()
                    .any(|&t| !c.types[t].symbol.is_nil());
            }
            if has_symbol {
                return get_recursion_identity_target(c, target);
            }
        }
    }
    t
}

// The recursion identity of a type is an object identity that is shared among multiple instantiations of the type. We track recursion identities in order to identify deeply nested and possibly infinite type instantiations with the same origin. The default recursion identity is the object identity of the type, meaning that every type is unique. Generally, types with constituents that could circularly reference the type have a recursion identity that differs from the object identity.
pub fn get_recursion_identity_from_target(c: &Checker<'_>, t: TypeId) -> RecursionId {
    let flags = c.types[t].flags;
    let object_flags = c.types[t].object_flags;
    let symbol = c.types[t].symbol;
    // Object and array literals are known not to contain recursive references and don't need a recursion identity.
    if flags.intersects(TypeFlags::OBJECT) && !is_object_or_array_literal_type(c, t) {
        if object_flags.intersects(ObjectFlags::REFERENCE) && !c.as_type_reference(t).node.is_nil()
        {
            // Deferred type references are tracked through their associated AST node. This gives us finer granularity than using their associated target because each manifest type reference has a unique AST node.
            return as_recursion_id(c.as_type_reference(t).node);
        }
        if !symbol.is_nil()
            && !(object_flags.intersects(ObjectFlags::ANONYMOUS)
                && c.ast.sym(symbol).flags.intersects(SymbolFlags::CLASS))
            && !object_flags.intersects(ObjectFlags::FROM_TYPE_NODE)
        {
            // We track object types that have a symbol by that symbol (representing the origin of the type), but exclude the static sides of classes (since they share their symbols with the instance sides) and type references that originate in resolution of AST type nodes (since such type nodes cannot be the source of generative recursion without first being instantiated).
            return as_recursion_id(symbol);
        }
        if is_tuple_type(c, t) && !object_flags.intersects(ObjectFlags::FROM_TYPE_NODE) {
            return as_recursion_id(c.type_target(t));
        }
    }
    if flags.intersects(TypeFlags::TYPE_PARAMETER) && !symbol.is_nil() {
        // We use the symbol of the type parameter such that all "fresh" instantiations of that type parameter have the same recursion identity.
        return as_recursion_id(symbol);
    }
    if flags.intersects(TypeFlags::CONDITIONAL) {
        // The root object represents the origin of the conditional type
        let root = c.as_conditional_type(t).root;
        return as_recursion_id(c.conditional_roots[root].node);
    }
    as_recursion_id(t)
}

impl<'a> Checker<'a> {
    pub fn get_best_matching_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        is_related_to: TypePairComparer<'_, 'a>,
    ) -> TypeId {
        let t = self.find_matching_discriminant_type(source, target, is_related_to);
        if !t.is_nil() {
            return t;
        }
        let t = self.find_matching_type_reference_or_type_alias_reference(source, target);
        if !t.is_nil() {
            return t;
        }
        let t = self.find_best_type_for_object_literal(source, target);
        if !t.is_nil() {
            return t;
        }
        let t = self.find_best_type_for_invokable(source, target, SignatureKind::CALL);
        if !t.is_nil() {
            return t;
        }
        let t = self.find_best_type_for_invokable(source, target, SignatureKind::CONSTRUCT);
        if !t.is_nil() {
            return t;
        }
        self.find_most_overlappy_type(source, target)
    }

    pub fn find_matching_type_reference_or_type_alias_reference(
        &mut self,
        source: TypeId,
        union_target: TypeId,
    ) -> TypeId {
        let source_object_flags = self.types[source].object_flags;
        if source_object_flags.intersects(ObjectFlags::REFERENCE | ObjectFlags::ANONYMOUS)
            && self.types[union_target].flags.intersects(TypeFlags::UNION)
        {
            for &target in self.type_types(union_target).as_slice() {
                if self.types[target].flags.intersects(TypeFlags::OBJECT) {
                    let overlap_obj_flags = source_object_flags & self.types[target].object_flags;
                    if overlap_obj_flags.intersects(ObjectFlags::REFERENCE)
                        && self.type_target(source) == self.type_target(target)
                    {
                        return target;
                    }
                    let source_alias = self.types[source].alias;
                    let target_alias = self.types[target].alias;
                    if overlap_obj_flags.intersects(ObjectFlags::ANONYMOUS)
                        && !source_alias.is_nil()
                        && !target_alias.is_nil()
                        && self.type_aliases[source_alias].symbol
                            == self.type_aliases[target_alias].symbol
                    {
                        return target;
                    }
                }
            }
        }
        TypeId::NIL
    }

    pub fn find_best_type_for_invokable(
        &mut self,
        source: TypeId,
        union_target: TypeId,
        kind: SignatureKind,
    ) -> TypeId {
        if self.get_signatures_of_type(source, kind).len() != 0 {
            for &t in self.type_types(union_target).as_slice() {
                if self.get_signatures_of_type(t, kind).len() != 0 {
                    return t;
                }
            }
        }
        TypeId::NIL
    }

    pub fn find_most_overlappy_type(&mut self, source: TypeId, union_target: TypeId) -> TypeId {
        let mut best_match = TypeId::NIL;
        if !self.types[source]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::INSTANTIABLE_PRIMITIVE)
        {
            let mut matching_count: isize = 0;
            for &target in self.type_types(union_target).as_slice() {
                if !self.types[target]
                    .flags
                    .intersects(TypeFlags::PRIMITIVE | TypeFlags::INSTANTIABLE_PRIMITIVE)
                {
                    let source_index = self.get_index_type(source);
                    let target_index = self.get_index_type(target);
                    let overlap =
                        self.get_intersection_type(List::from_slice(&[source_index, target_index]));
                    if self.types[overlap].flags.intersects(TypeFlags::INDEX) {
                        // perfect overlap of keys
                        return target;
                    } else if is_unit_type(self, overlap)
                        || self.types[overlap].flags.intersects(TypeFlags::UNION)
                    {
                        // We only want to account for literal types otherwise. If we have a union of index types, it seems likely that we needed to elaborate between two generic mapped types anyway.
                        let mut length: isize = 1;
                        if self.types[overlap].flags.intersects(TypeFlags::UNION) {
                            length = 0;
                            for &t in self.type_types(overlap).as_slice() {
                                if is_unit_type(self, t) {
                                    length += 1;
                                }
                            }
                        }
                        if length >= matching_count {
                            best_match = target;
                            matching_count = length;
                        }
                    }
                }
            }
        }
        best_match
    }

    pub fn find_best_type_for_object_literal(
        &mut self,
        source: TypeId,
        union_target: TypeId,
    ) -> TypeId {
        if self.types[source]
            .object_flags
            .intersects(ObjectFlags::OBJECT_LITERAL)
            && some_type(self, union_target, &mut |c, t| c.is_array_like_type(t))
        {
            for &t in self.type_types(union_target).as_slice() {
                if !self.is_array_like_type(t) {
                    return t;
                }
            }
        }
        TypeId::NIL
    }

    pub fn should_report_unmatched_property_error(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        let type_call_signatures =
            self.get_signatures_of_structured_type(source, SignatureKind::CALL);
        let type_construct_signatures =
            self.get_signatures_of_structured_type(source, SignatureKind::CONSTRUCT);
        let type_properties = self.get_properties_of_object_type(source);
        if (type_call_signatures.len() != 0 || type_construct_signatures.len() != 0)
            && type_properties.len() == 0
        {
            if (self
                .get_signatures_of_type(target, SignatureKind::CALL)
                .len()
                != 0
                && type_call_signatures.len() != 0)
                || self
                    .get_signatures_of_type(target, SignatureKind::CONSTRUCT)
                    .len()
                    != 0
                    && type_construct_signatures.len() != 0
            {
                // target has similar signature kinds to source, still focus on the unmatched property
                return true;
            }
            return false;
        }
        true
    }

    pub fn get_unmatched_property(
        &mut self,
        source: TypeId,
        target: TypeId,
        require_optional_properties: bool,
        match_discriminant_properties: bool,
    ) -> SymbolId {
        self.get_unmatched_properties_worker(
            source,
            target,
            require_optional_properties,
            match_discriminant_properties,
            None,
        )
    }

    pub fn get_unmatched_properties(
        &mut self,
        source: TypeId,
        target: TypeId,
        require_optional_properties: bool,
        match_discriminant_properties: bool,
    ) -> List<'a, SymbolId> {
        let mut props: Vec<SymbolId> = Vec::new();
        self.get_unmatched_properties_worker(
            source,
            target,
            require_optional_properties,
            match_discriminant_properties,
            Some(&mut props),
        );
        if props.is_empty() {
            return List::NIL;
        }
        self.list_of(&props)
    }

    pub fn get_unmatched_properties_worker(
        &mut self,
        source: TypeId,
        target: TypeId,
        require_optional_properties: bool,
        match_discriminant_properties: bool,
        mut props_out: Option<&mut Vec<SymbolId>>,
    ) -> SymbolId {
        let properties = self.get_properties_of_type(target);
        for &target_prop in properties.as_slice() {
            if is_static_private_identifier_property(self.ast, target_prop) {
                continue;
            }
            let target_prop_symbol = self.ast.sym(target_prop);
            if require_optional_properties
                || !target_prop_symbol.flags.intersects(SymbolFlags::OPTIONAL)
                    && !target_prop_symbol
                        .check_flags
                        .intersects(CheckFlags::PARTIAL)
            {
                let source_prop = self.get_property_of_type(source, target_prop_symbol.name);
                if source_prop.is_nil() {
                    match props_out.as_deref_mut() {
                        None => return target_prop,
                        Some(props) => props.push(target_prop),
                    }
                } else if match_discriminant_properties {
                    let target_type = self.get_type_of_symbol(target_prop);
                    if self.types[target_type].flags.intersects(TypeFlags::UNIT) {
                        let source_type = self.get_type_of_symbol(source_prop);
                        let mut matched = self.types[source_type].flags.intersects(TypeFlags::ANY);
                        if !matched {
                            let regular_source = self.get_regular_type_of_literal_type(source_type);
                            let regular_target = self.get_regular_type_of_literal_type(target_type);
                            matched = regular_source == regular_target;
                        }
                        if !matched {
                            match props_out.as_deref_mut() {
                                None => return target_prop,
                                Some(props) => props.push(target_prop),
                            }
                        }
                    }
                }
            }
        }
        SymbolId::NIL
    }
}

// The result is the argument itself when nothing is excluded, else a new list.
pub fn exclude_properties<'a>(
    c: &Checker<'a>,
    properties: List<'a, SymbolId>,
    excluded_properties: &Set<Text<'a>>,
) -> List<'a, SymbolId> {
    if excluded_properties.len() == 0 || properties.len() == 0 {
        return properties;
    }
    let mut reduced: Vec<SymbolId> = Vec::new();
    let mut excluded = false;
    for (i, &prop) in properties.as_slice().iter().enumerate() {
        if !excluded_properties.has(&c.ast.sym(prop).name) {
            if excluded {
                reduced.push(prop);
            }
        } else if !excluded {
            reduced = properties.as_slice().get(..i).unwrap_or(&[]).to_vec();
            excluded = true;
        }
    }
    if excluded {
        return c.list_of(&reduced);
    }
    properties
}

// The discriminator of findMatchingDiscriminantType. The checker is a parameter of its methods.
pub struct TypeDiscriminator<'c, 'a> {
    pub props: List<'a, SymbolId>,
    pub is_related_to: TypePairComparer<'c, 'a>,
}

impl<'a> Discriminator<'a> for TypeDiscriminator<'_, 'a> {
    fn len(&self) -> isize {
        self.props.len()
    }

    fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a> {
        c.ast.sym(self.props.at(index)).name
    }

    fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool {
        let prop_type = c.get_type_of_symbol(self.props.at(index));
        for &s in c.type_distributed(prop_type).as_slice() {
            if (self.is_related_to)(c, s, t) != Ternary::FALSE {
                return true;
            }
        }
        false
    }
}

impl<'a> Checker<'a> {
    // Keep this up-to-date with the same logic within `getApparentTypeOfContextualType`, since they should behave similarly
    pub fn find_matching_discriminant_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        is_related_to: TypePairComparer<'_, 'a>,
    ) -> TypeId {
        if self.types[target].flags.intersects(TypeFlags::UNION)
            && self.types[source]
                .flags
                .intersects(TypeFlags::INTERSECTION | TypeFlags::OBJECT)
        {
            let matched = self.get_matching_union_constituent_for_type(target, source);
            if !matched.is_nil() {
                return matched;
            }
            let source_properties = self.get_properties_of_type(source);
            let discriminant_properties =
                self.find_discriminant_properties(source_properties, target);
            if discriminant_properties.len() != 0 {
                let mut discriminator = TypeDiscriminator {
                    props: discriminant_properties,
                    is_related_to,
                };
                let discriminated =
                    self.discriminate_type_by_discriminable_items(target, &mut discriminator);
                if discriminated != target {
                    return discriminated;
                }
            }
        }
        TypeId::NIL
    }

    pub fn find_discriminant_properties(
        &mut self,
        source_properties: List<'a, SymbolId>,
        target: TypeId,
    ) -> List<'a, SymbolId> {
        let mut result: Vec<SymbolId> = Vec::new();
        for &source_property in source_properties.as_slice() {
            let name = self.ast.sym(source_property).name;
            if self.is_discriminant_property(target, name) {
                result.push(source_property);
            }
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn is_discriminant_property(&mut self, t: TypeId, name: &[u8]) -> bool {
        if !t.is_nil() && self.types[t].flags.intersects(TypeFlags::UNION) {
            let prop = self.get_union_or_intersection_property(t, name, false);
            if !prop.is_nil()
                && self
                    .ast
                    .sym(prop)
                    .check_flags
                    .intersects(CheckFlags::SYNTHETIC_PROPERTY)
            {
                if !self
                    .ast
                    .sym(prop)
                    .check_flags
                    .intersects(CheckFlags::IS_DISCRIMINANT_COMPUTED)
                {
                    self.ast.update_symbol(prop, |s| {
                        s.check_flags |= CheckFlags::IS_DISCRIMINANT_COMPUTED
                    });
                    if self
                        .ast
                        .sym(prop)
                        .check_flags
                        .contains(CheckFlags::NON_UNIFORM_AND_LITERAL)
                    {
                        let prop_type = self.get_type_of_symbol(prop);
                        if !self.is_generic_type(prop_type) {
                            self.ast.update_symbol(prop, |s| {
                                s.check_flags |= CheckFlags::IS_DISCRIMINANT
                            });
                        }
                    }
                }
                return self
                    .ast
                    .sym(prop)
                    .check_flags
                    .intersects(CheckFlags::IS_DISCRIMINANT);
            }
        }
        false
    }

    pub fn get_matching_union_constituent_for_type(
        &mut self,
        union_type: TypeId,
        t: TypeId,
    ) -> TypeId {
        let key_property_name = self.get_key_property_name(union_type);
        if key_property_name.is_empty() {
            return TypeId::NIL;
        }
        let prop_type = self.get_type_of_property_of_type(t, key_property_name);
        if prop_type.is_nil() {
            return TypeId::NIL;
        }
        self.get_constituent_type_for_key_type(union_type, prop_type)
    }

    // Return the name of a discriminant property for which it was possible and feasible to construct a map of constituent types keyed by the literal types of the property by that name in each constituent type. Return an empty string if no such discriminant property exists.
    pub fn get_key_property_name(&mut self, t: TypeId) -> Text<'a> {
        if self.as_union_type(t).key_property_name.is_empty() {
            let (key_property_name, constituent_map) = self.compute_key_property_name_and_map(t);
            let u = self.as_union_type_mut(t);
            u.key_property_name = key_property_name;
            u.constituent_map = constituent_map;
        }
        let key_property_name = self.as_union_type(t).key_property_name;
        if key_property_name == INTERNAL_SYMBOL_NAME_MISSING {
            return b"";
        }
        key_property_name
    }

    // Given a union type for which getKeyPropertyName returned a non-empty string, return the constituent that corresponds to the given key type for that property name.
    pub fn get_constituent_type_for_key_type(&mut self, t: TypeId, key_type: TypeId) -> TypeId {
        let key = self.get_regular_type_of_literal_type(key_type);
        let result = self.as_union_type(t).constituent_map.get(&key);
        if result != self.unknown_type {
            return result;
        }
        TypeId::NIL
    }

    pub fn compute_key_property_name_and_map(
        &mut self,
        t: TypeId,
    ) -> (Text<'a>, Map<TypeId, TypeId>) {
        let types = self.type_types(t);
        if types.len() < 10
            || self.types[t]
                .object_flags
                .intersects(ObjectFlags::PRIMITIVE_UNION)
        {
            return (INTERNAL_SYMBOL_NAME_MISSING, Map::default());
        }
        let mut object_count: isize = 0;
        for &u in types.as_slice() {
            if is_object_or_instantiable_non_primitive(self, u) {
                object_count += 1;
            }
        }
        if object_count < 10 {
            return (INTERNAL_SYMBOL_NAME_MISSING, Map::default());
        }
        let key_property_name = self.get_key_property_candidate_name(types);
        if key_property_name.is_empty() {
            return (INTERNAL_SYMBOL_NAME_MISSING, Map::default());
        }
        let map_by_key_property = self.map_types_by_key_property(types, key_property_name);
        if map_by_key_property.is_nil() {
            return (INTERNAL_SYMBOL_NAME_MISSING, Map::default());
        }
        (key_property_name, map_by_key_property)
    }
}

pub fn is_object_or_instantiable_non_primitive(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t]
        .flags
        .intersects(TypeFlags::OBJECT | TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
}

impl<'a> Checker<'a> {
    pub fn get_key_property_candidate_name(&mut self, types: List<'a, TypeId>) -> Text<'a> {
        for &t in types.as_slice() {
            if self.types[t]
                .flags
                .intersects(TypeFlags::OBJECT | TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
            {
                let properties = self.get_properties_of_type(t);
                for &p in properties.as_slice() {
                    let prop_type = self.get_type_of_symbol(p);
                    if is_unit_type(self, prop_type) {
                        return self.ast.sym(p).name;
                    }
                }
            }
        }
        b""
    }

    // Given a set of constituent types and a property name, create and return a map keyed by the literal types of the property by that name in each constituent type. No map is returned if some key property has a non-literal type or if less than 10 or less than 50% of the constituents have a unique key. Entries with duplicate keys have unknownType as the value.
    pub fn map_types_by_key_property(
        &mut self,
        types: List<'a, TypeId>,
        key_property_name: &[u8],
    ) -> Map<TypeId, TypeId> {
        let mut types_by_key: Map<TypeId, TypeId> = Map::make();
        let mut count: isize = 0;
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(
                TypeFlags::OBJECT | TypeFlags::INTERSECTION | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
            ) {
                let discriminant = self.get_type_of_property_of_type(t, key_property_name);
                if discriminant.is_nil() || !is_literal_type(self, discriminant) {
                    return Map::default();
                }
                let mut duplicate = false;
                for &d in self.type_distributed(discriminant).as_slice() {
                    let key = self.get_regular_type_of_literal_type(d);
                    let existing = types_by_key.get(&key);
                    if existing.is_nil() {
                        let ok = types_by_key.set(key, t);
                        self.map_set(ok);
                    } else if existing != self.unknown_type {
                        let ok = types_by_key.set(key, self.unknown_type);
                        self.map_set(ok);
                        duplicate = true;
                    }
                }
                if !duplicate {
                    count += 1;
                }
            }
        }
        if count >= 10 && count * 2 >= types.len() {
            return types_by_key;
        }
        Map::default()
    }
}

pub trait Discriminator<'a> {
    // Number of discriminant properties
    fn len(&self) -> isize;
    // Property name of index-th discriminator
    fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a>;
    // True if index-th discriminator matches the given type
    fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool;
}

impl<'a> Checker<'a> {
    pub fn discriminate_type_by_discriminable_items(
        &mut self,
        target: TypeId,
        discriminator: &mut dyn Discriminator<'a>,
    ) -> TypeId {
        let types = self.type_types(target);
        let mut include: Vec<Ternary> = vec![Ternary::FALSE; types.as_slice().len()];
        for (i, &t) in types.as_slice().iter().enumerate() {
            if !self.types[t].flags.intersects(TypeFlags::PRIMITIVE) {
                let reduced = self.get_reduced_type(t);
                if !self.types[reduced].flags.intersects(TypeFlags::NEVER) {
                    if let Some(slot) = include.get_mut(i) {
                        *slot = Ternary::TRUE;
                    }
                }
            }
        }
        for n in 0..discriminator.len() {
            // If the remaining target types include at least one with a matching discriminant, eliminate those that have non-matching discriminants. This ensures that we ignore erroneous discriminators and gradually refine the target set without eliminating every constituent (which would lead to `never`).
            let mut matched = false;
            for (i, &t) in types.as_slice().iter().enumerate() {
                if include.get(i).copied().unwrap_or_default() != Ternary::FALSE {
                    let name = discriminator.name(self, n);
                    let target_type = self.get_type_of_property_or_index_signature_of_type(t, name);
                    if !target_type.is_nil() {
                        if discriminator.matches(self, n, target_type) {
                            matched = true;
                        } else if let Some(slot) = include.get_mut(i) {
                            *slot = Ternary::MAYBE;
                        }
                    }
                }
            }
            // Turn each Ternary.Maybe into Ternary.False if there was a match. Otherwise, revert to Ternary.True.
            for slot in include.iter_mut() {
                if *slot == Ternary::MAYBE {
                    *slot = if matched {
                        Ternary::FALSE
                    } else {
                        Ternary::TRUE
                    };
                }
            }
        }
        if include.contains(&Ternary::FALSE) {
            let mut filtered_types: Vec<TypeId> = Vec::new();
            for (i, &t) in types.as_slice().iter().enumerate() {
                if include.get(i).copied().unwrap_or_default() == Ternary::TRUE {
                    filtered_types.push(t);
                }
            }
            let filtered_list = if filtered_types.is_empty() {
                List::NIL
            } else {
                List::from_slice(&filtered_types)
            };
            let filtered = self.get_union_type_ex(
                filtered_list,
                UnionReduction::NONE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
            if !self.types[filtered].flags.intersects(TypeFlags::NEVER) {
                return filtered;
            }
        }
        target
    }

    pub fn filter_primitives_if_contains_non_primitive(&mut self, union_type: TypeId) -> TypeId {
        if self.maybe_type_of_kind(union_type, TypeFlags::NON_PRIMITIVE) {
            let result = self.filter_type(union_type, &mut |c, t| is_non_primitive_type(c, t));
            if !self.types[result].flags.intersects(TypeFlags::NEVER) {
                return result;
            }
        }
        union_type
    }
}

pub fn is_non_primitive_type(c: &Checker<'_>, t: TypeId) -> bool {
    !c.types[t].flags.intersects(TypeFlags::PRIMITIVE)
}

impl<'a> Checker<'a> {
    pub fn get_type_names_for_error_display(
        &mut self,
        left: TypeId,
        right: TypeId,
    ) -> (Vec<u8>, Vec<u8>) {
        let left_symbol = self.types[left].symbol;
        let mut left_str = if self.symbol_value_declaration_is_context_sensitive(left_symbol) {
            let enclosing = self.ast.sym(left_symbol).value_declaration;
            self.type_to_string(left, enclosing)
        } else {
            self.type_to_string_exported(left)
        };
        let right_symbol = self.types[right].symbol;
        let mut right_str = if self.symbol_value_declaration_is_context_sensitive(right_symbol) {
            let enclosing = self.ast.sym(right_symbol).value_declaration;
            self.type_to_string(right, enclosing)
        } else {
            self.type_to_string_exported(right)
        };
        if left_str == right_str {
            left_str = self.get_type_name_for_error_display(left);
            right_str = self.get_type_name_for_error_display(right);
        }
        (left_str, right_str)
    }

    pub fn get_type_name_for_error_display(&mut self, t: TypeId) -> Vec<u8> {
        self.type_to_string_ex(
            t,
            NodeId::NIL,
            TypeFormatFlags::USE_FULLY_QUALIFIED_TYPE,
            None,
        )
    }

    pub fn symbol_value_declaration_is_context_sensitive(&mut self, symbol: SymbolId) -> bool {
        if symbol.is_nil() {
            return false;
        }
        let value_declaration = self.ast.sym(symbol).value_declaration;
        !value_declaration.is_nil()
            && is_expression(self.ast, value_declaration)
            && !self.is_context_sensitive(value_declaration)
    }

    // A constraint chain is as long as the declarations make it: the entry tests the stack.
    pub fn type_could_have_top_level_singleton_types(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        // Okay, yes, 'boolean' is a union of 'true | false', but that's not useful in error reporting scenarios. If you need to use this function but that detail matters, feel free to add a flag.
        if self.types[t].flags.intersects(TypeFlags::BOOLEAN) {
            return false;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            for &constituent in self.type_types(t).as_slice() {
                if self.type_could_have_top_level_singleton_types(constituent) {
                    return true;
                }
            }
            return false;
        }
        if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            let constraint = self.get_constraint_of_type(t);
            if !constraint.is_nil() && constraint != t {
                return self.type_could_have_top_level_singleton_types(constraint);
            }
        }
        is_unit_type(self, t)
            || self.types[t].flags.intersects(TypeFlags::TEMPLATE_LITERAL)
            || self.types[t].flags.intersects(TypeFlags::STRING_MAPPING)
    }

    pub fn get_variances(&mut self, t: TypeId) -> List<'a, VarianceFlags> {
        // Arrays and tuples are known to be covariant, no need to spend time computing this.
        if t == self.global_array_type
            || t == self.global_readonly_array_type
            || self.types[t].object_flags.intersects(ObjectFlags::TUPLE)
        {
            return self.array_variances;
        }
        let symbol = self.types[t].symbol;
        let type_parameters = self.as_interface_type(t).type_parameters();
        self.get_variances_worker(symbol, type_parameters)
    }

    pub fn get_alias_variances(&mut self, symbol: SymbolId) -> List<'a, VarianceFlags> {
        let links = self.type_alias_links.get(symbol);
        let type_parameters = self.type_alias_links[links].type_parameters;
        self.get_variances_worker(symbol, type_parameters)
    }

    // Return an array containing the variance of each type parameter. The variance is effectively a digest of the type comparisons that occur for each type argument when instantiations of the generic type are structurally compared. We infer the variance information by comparing instantiations of the generic type for type arguments with known relations. The function returns an empty slice when invoked recursively for the given generic type.
    pub fn get_variances_worker(
        &mut self,
        symbol: SymbolId,
        type_parameters: List<'a, TypeId>,
    ) -> List<'a, VarianceFlags> {
        let links = self.variance_links.get(symbol);
        if self.variance_links[links].variances.is_nil() {
            let stack_index = self.get_variance_stack_index(symbol);
            if stack_index < 0 {
                let save_resolution_start = self.resolution_start;
                if self.variance_stack.is_empty() {
                    self.resolution_start = self.type_resolutions.len() as isize;
                }
                self.variance_stack.push(VarianceStackEntry {
                    symbol,
                    type_parameters,
                });
                let mut variances: Vec<VarianceFlags> =
                    vec![VarianceFlags::INVARIANT; type_parameters.as_slice().len()];
                for (i, &tp) in type_parameters.as_slice().iter().enumerate() {
                    let modifiers = self.get_type_parameter_modifiers(tp);
                    let variance;
                    if modifiers.intersects(ModifierFlags::OUT) {
                        if modifiers.intersects(ModifierFlags::IN) {
                            variance = VarianceFlags::INVARIANT;
                        } else {
                            variance = VarianceFlags::COVARIANT;
                        }
                    } else if modifiers.intersects(ModifierFlags::IN) {
                        variance = VarianceFlags::CONTRAVARIANT;
                    } else {
                        let save_reliability_flags = self.reliability_flags;
                        self.reliability_flags = RelationComparisonResult::NONE;
                        // We first compare instantiations where the type parameter is replaced with marker types that have a known subtype relationship. From this we can infer invariance, covariance, contravariance or bivariance.
                        let type_with_super =
                            self.create_marker_type(symbol, tp, self.marker_super_type);
                        let type_with_sub =
                            self.create_marker_type(symbol, tp, self.marker_sub_type);
                        let sub_to_super =
                            self.is_type_assignable_to(type_with_sub, type_with_super);
                        let super_to_sub =
                            self.is_type_assignable_to(type_with_super, type_with_sub);
                        let mut computed = VarianceFlags::INVARIANT;
                        if sub_to_super {
                            computed |= VarianceFlags::COVARIANT;
                        }
                        if super_to_sub {
                            computed |= VarianceFlags::CONTRAVARIANT;
                        }
                        // If the instantiations appear to be related bivariantly it may be because the type parameter is independent (i.e. it isn't witnessed anywhere in the generic type). To determine this we compare instantiations where the type parameter is replaced with marker types that are known to be unrelated.
                        if computed == VarianceFlags::BIVARIANT {
                            let type_with_other =
                                self.create_marker_type(symbol, tp, self.marker_other_type);
                            if self.is_type_assignable_to(type_with_other, type_with_super) {
                                computed = VarianceFlags::INDEPENDENT;
                            }
                        }
                        if self
                            .reliability_flags
                            .intersects(RelationComparisonResult::REPORTS_UNMEASURABLE)
                        {
                            computed |= VarianceFlags::UNMEASURABLE;
                        }
                        if self
                            .reliability_flags
                            .intersects(RelationComparisonResult::REPORTS_UNRELIABLE)
                        {
                            computed |= VarianceFlags::UNRELIABLE;
                        }
                        self.reliability_flags = save_reliability_flags;
                        variance = computed;
                    }
                    // If variance computation was restarted due to a circularity we may have already computed variances for this generic type. If so, we exit early.
                    if self.variance_links[links].variances.len() != 0 {
                        break;
                    }
                    match variances.get_mut(i) {
                        Some(slot) => *slot = variance,
                        None => self.slice_set(false),
                    }
                }
                // Store the results unless a restarted computation has already stored them.
                if self.variance_links[links].variances.len() == 0 {
                    let stored = self.list_of(&variances);
                    self.variance_links[links].variances = stored;
                }
                self.variance_stack.pop();
                if self.variance_stack.is_empty() {
                    self.resolution_start = save_resolution_start;
                }
            } else {
                // We've detected a circularity. Since we may compute different variances depending on where we enter a circularity, we find the generic type with the "smallest" symbol in the circular region of the variance stack and restart the computation from there if necessary. This ensures stable results for circular generic types.
                let stack_index = usize::try_from(stack_index).unwrap_or(0);
                let mut min_index = stack_index;
                let mut i = stack_index + 1;
                while i < self.variance_stack.len() {
                    let symbol_at_i = self
                        .variance_stack
                        .get(i)
                        .map_or(SymbolId::NIL, |entry| entry.symbol);
                    let symbol_at_min = self
                        .variance_stack
                        .get(min_index)
                        .map_or(SymbolId::NIL, |entry| entry.symbol);
                    if self.compare_symbols(symbol_at_i, symbol_at_min) < 0 {
                        min_index = i;
                    }
                    i += 1;
                }
                if min_index > stack_index {
                    let save_variance_stack = std::mem::take(&mut self.variance_stack);
                    let entry = save_variance_stack
                        .get(min_index)
                        .copied()
                        .unwrap_or_default();
                    self.get_variances_worker(entry.symbol, entry.type_parameters);
                    self.variance_stack = save_variance_stack;
                }
                // Store an empty slice to mark that we can't compute variances for this type. We treat type parameters as co-variant in this case.
                if self.variance_links[links].variances.len() == 0 {
                    let empty = self.list_of::<VarianceFlags>(&[]);
                    self.variance_links[links].variances = empty;
                }
            }
        }
        self.variance_links[links].variances
    }

    pub fn get_variance_stack_index(&self, symbol: SymbolId) -> isize {
        for (i, entry) in self.variance_stack.iter().enumerate() {
            if entry.symbol == symbol {
                return i as isize;
            }
        }
        -1
    }

    pub fn create_marker_type(
        &mut self,
        symbol: SymbolId,
        source: TypeId,
        target: TypeId,
    ) -> TypeId {
        let mapper = new_simple_type_mapper(self, source, target);
        let t = self.get_declared_type_of_symbol(symbol);
        if self.is_error_type(t) {
            return t;
        }
        let result;
        if self
            .ast
            .sym(symbol)
            .flags
            .intersects(SymbolFlags::TYPE_ALIAS)
        {
            let links = self.type_alias_links.get(symbol);
            let type_parameters = self.type_alias_links[links].type_parameters;
            let type_arguments = self.instantiate_types(type_parameters, mapper);
            result = self.get_type_alias_instantiation(symbol, type_arguments, TypeAliasId::NIL);
        } else {
            let type_parameters = self.as_interface_type(t).type_parameters();
            let type_arguments = self.instantiate_types(type_parameters, mapper);
            result = self.create_type_reference(t, type_arguments);
        }
        self.marker_types.add(result);
        result
    }

    pub fn is_marker_type(&self, t: TypeId) -> bool {
        self.marker_types.has(&t)
    }

    pub fn get_type_parameter_modifiers(&mut self, tp: TypeId) -> ModifierFlags {
        let mut flags = ModifierFlags::NONE;
        let symbol = self.types[tp].symbol;
        if !symbol.is_nil() {
            for &d in self.ast.sym(symbol).declarations.as_slice() {
                flags |= self.ast.modifier_flags(d);
            }
        }
        flags & (ModifierFlags::IN | ModifierFlags::OUT | ModifierFlags::CONST)
    }

    // Return true if the given type reference has a 'void' type argument for a covariant type parameter. See comment at call in recursiveTypeRelatedTo for when this case matters.
    pub fn has_covariant_void_argument(
        &mut self,
        type_arguments: List<'a, TypeId>,
        variances: List<'a, VarianceFlags>,
    ) -> bool {
        for (i, &v) in variances.as_slice().iter().enumerate() {
            if (v & VarianceFlags::VARIANCE_MASK) == VarianceFlags::COVARIANT
                && self.types[type_arguments.at(i)]
                    .flags
                    .intersects(TypeFlags::VOID)
            {
                return true;
            }
        }
        false
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
        args: &[Arg<'_>],
    ) {
        match error_reporter {
            Some(r) => r.report_error(self, message, args),
            None => self.fail("call of a nil ErrorReporter"),
        }
    }

    // Two callback parameters recurse with the signatures swapped: the entry tests the stack.
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
                // the second condition should be redundant, because there is no error reporting when comparing signatures by strict arity since it is only done for subtype reduction
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
            && !same(
                self.signatures[source].type_parameters.as_slice(),
                self.signatures[target].type_parameters.as_slice(),
            )
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
                // In order to ensure that any generic type Foo<T> is at least co-variant with respect to T no matter how Foo uses T, we need to relate parameters bi-variantly (given that parameters are input positions, they naturally relate only contra-variantly). However, if the source and target parameters both have function types with a single call signature, we know we are relating two callback parameters. In that case it is sufficient to only relate the parameters of the signatures co-variantly because, similar to return values, callback parameters are output positions. This means that a Promise<T>, where T is used only in callback parameter positions, will be co-variant (as opposed to bi-variant) with respect to T.
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
                            &[Arg::Str(&source_name), Arg::Str(&target_name)],
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
                            &[Arg::Str(&text)],
                        );
                    }
                    return Ternary::FALSE;
                }
            } else {
                // When relating callback signatures, we still need to relate return types bi-variantly as otherwise the containing type wouldn't be co-variant. For example, interface Foo<T> { add(cb: () => T): void } wouldn't be co-variant for T without this rule.
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
                    let source_text = self.type_to_string_exported(source_return_type);
                    let target_text = self.type_to_string_exported(target_return_type);
                    self.call_error_reporter(
                        error_reporter,
                        message,
                        &[Arg::Str(&source_text), Arg::Str(&target_text)],
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
                    &[Arg::Str(&source_text), Arg::Str(&target_text)],
                );
            }
            return Ternary::FALSE;
        }
        if source_kind == TypePredicateKind::IDENTIFIER
            || source_kind == TypePredicateKind::ASSERTS_IDENTIFIER
        {
            if self.type_predicates[source].parameter_index
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
                        &[Arg::Str(&source_text), Arg::Str(&target_text)],
                    );
                }
                return Ternary::FALSE;
            }
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
                &[Arg::Str(&source_text), Arg::Str(&target_text)],
            );
        }
        related
    }

    // Returns true if `s` is `(...args: A) => R` where `A` is `any`, `any[]`, `never`, or `never[]`, and `R` is `any` or `unknown`.
    pub fn is_top_signature(&mut self, s: SignatureId) -> bool {
        let type_parameters = self.signatures[s].type_parameters;
        let this_parameter = self.signatures[s].this_parameter;
        let parameters = self.signatures[s].parameters;
        if type_parameters.len() != 0 {
            return false;
        }
        if !this_parameter.is_nil() {
            let this_type = self.get_type_of_parameter(this_parameter);
            if !is_type_any(self, this_type) {
                return false;
            }
        }
        if parameters.len() == 1 && signature_has_rest_parameter(self, s) {
            let param_type = self.get_type_of_parameter(parameters.at(0usize));
            let rest_type = if self.is_array_type(param_type) {
                self.get_type_arguments(param_type).at(0usize)
            } else {
                param_type
            };
            if !self.types[rest_type]
                .flags
                .intersects(TypeFlags::ANY | TypeFlags::NEVER)
            {
                return false;
            }
            let return_type = self.get_return_type_of_signature(s);
            return self.types[return_type]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN);
        }
        false
    }

    // Return the number of parameters in a signature. The rest parameter, if present, counts as one parameter. For example, the parameter count of (x: number, y: number, ...z: string[]) is 3 and the parameter count of (x: number, ...args: [number, ...string[], boolean])) is also 3. In the latter example, the effective rest type is [...string[], boolean].
    pub fn get_parameter_count(&mut self, signature: SignatureId) -> isize {
        let parameters = self.signatures[signature].parameters;
        let length = parameters.len();
        if signature_has_rest_parameter(self, signature) {
            let rest_type = self.get_type_of_symbol(parameters.at(length - 1));
            if is_tuple_type(self, rest_type) {
                let target = self.type_target_tuple_type(rest_type);
                let variable = target.combined_flags.intersects(ElementFlags::VARIABLE);
                return length + target.fixed_length - if variable { 0 } else { 1 };
            }
        }
        length
    }

    pub fn get_min_argument_count(&mut self, signature: SignatureId) -> isize {
        self.get_min_argument_count_ex(signature, MinArgumentCountFlags::NONE)
    }

    pub fn get_min_argument_count_ex(
        &mut self,
        signature: SignatureId,
        flags: MinArgumentCountFlags,
    ) -> isize {
        let strong_arity_for_untyped_js =
            flags.intersects(MinArgumentCountFlags::STRONG_ARITY_FOR_UNTYPED_JS);
        let void_is_non_optional = flags.intersects(MinArgumentCountFlags::VOID_IS_NON_OPTIONAL);
        if void_is_non_optional || self.signatures[signature].resolved_min_argument_count == -1 {
            let mut min_argument_count: isize = -1;
            let parameters = self.signatures[signature].parameters;
            if signature_has_rest_parameter(self, signature) {
                let rest_type = self.get_type_of_symbol(parameters.at(parameters.len() - 1));
                if is_tuple_type(self, rest_type) {
                    let target = self.type_target_tuple_type(rest_type);
                    let mut first_optional_index: isize = -1;
                    for (i, &info) in target.element_infos.as_slice().iter().enumerate() {
                        if !info.flags.intersects(ElementFlags::REQUIRED) {
                            first_optional_index = i as isize;
                            break;
                        }
                    }
                    let mut required_count = first_optional_index;
                    if first_optional_index < 0 {
                        required_count = target.fixed_length;
                    }
                    if required_count > 0 {
                        min_argument_count = parameters.len() - 1 + required_count;
                    }
                }
            }
            if min_argument_count == -1 {
                if !strong_arity_for_untyped_js
                    && self.signatures[signature]
                        .flags
                        .intersects(SignatureFlags::IS_UNTYPED_SIGNATURE_IN_JS_FILE)
                {
                    return 0;
                }
                min_argument_count = self.signatures[signature].min_argument_count as isize;
            }
            if void_is_non_optional {
                return min_argument_count;
            }
            let mut i = min_argument_count - 1;
            while i >= 0 {
                let t = self.get_type_at_position(signature, i);
                if !some_type(self, t, &mut |c, t| {
                    c.types[t].flags.intersects(TypeFlags::VOID)
                }) {
                    break;
                }
                min_argument_count = i;
                i -= 1;
            }
            self.signatures[signature].resolved_min_argument_count = min_argument_count as i32;
        }
        self.signatures[signature].resolved_min_argument_count as isize
    }

    pub fn has_effective_rest_parameter(&mut self, signature: SignatureId) -> bool {
        if signature_has_rest_parameter(self, signature) {
            let parameters = self.signatures[signature].parameters;
            let rest_type = self.get_type_of_symbol(parameters.at(parameters.len() - 1));
            return !is_tuple_type(self, rest_type)
                || self
                    .type_target_tuple_type(rest_type)
                    .combined_flags
                    .intersects(ElementFlags::VARIABLE);
        }
        false
    }

    pub fn get_type_at_position(&mut self, signature: SignatureId, pos: isize) -> TypeId {
        let t = self.try_get_type_at_position(signature, pos);
        if !t.is_nil() {
            return t;
        }
        self.any_type
    }

    pub fn try_get_type_at_position(&mut self, signature: SignatureId, pos: isize) -> TypeId {
        let parameters = self.signatures[signature].parameters;
        let has_rest = signature_has_rest_parameter(self, signature);
        let param_count = parameters.len() - if has_rest { 1 } else { 0 };
        if pos < param_count {
            return self.get_type_of_parameter(parameters.at(pos));
        }
        if has_rest {
            // We want to return the value undefined for an out of bounds parameter position, so we need to check bounds here before calling getIndexedAccessType (which otherwise would return the type 'undefined').
            let rest_type = self.get_type_of_symbol(parameters.at(param_count));
            let index = pos - param_count;
            if !is_tuple_type(self, rest_type)
                || self
                    .type_target_tuple_type(rest_type)
                    .combined_flags
                    .intersects(ElementFlags::VARIABLE)
                || index < self.type_target_tuple_type(rest_type).fixed_length
            {
                let index_type = self.get_number_literal_type(Number(index as f64));
                return self.get_indexed_access_type(rest_type, index_type);
            }
        }
        TypeId::NIL
    }

    // Return the rest type at the given position, transforming `any[]` into just `any`. We do this because in signatures we want `any[]` in a rest position to be compatible with anything, but `any[]` isn't assignable to tuple types with required elements.
    pub fn get_rest_or_any_type_at_position(&mut self, source: SignatureId, pos: isize) -> TypeId {
        let rest_type = self.get_rest_type_at_position(source, pos, false);
        if !rest_type.is_nil() {
            let element_type = self.get_element_type_of_array_type(rest_type);
            if !element_type.is_nil() && is_type_any(self, element_type) {
                return self.any_type;
            }
        }
        rest_type
    }

    pub fn get_rest_type_at_position(
        &mut self,
        source: SignatureId,
        pos: isize,
        readonly: bool,
    ) -> TypeId {
        let parameter_count = self.get_parameter_count(source);
        let min_argument_count = self.get_min_argument_count(source);
        let rest_type = self.get_effective_rest_type(source);
        if !rest_type.is_nil() && pos >= parameter_count - 1 {
            if pos == parameter_count - 1 {
                return rest_type;
            } else {
                let element_type = self.get_indexed_access_type(rest_type, self.number_type);
                return self.create_array_type(element_type);
            }
        }
        let length = parameter_count - pos;
        if length <= 0 {
            return self.create_tuple_type_ex(List::NIL, List::NIL, readonly);
        }
        // Every index is written once and in order: the two slices grow by one element per turn.
        let mut types: Vec<TypeId> = Vec::new();
        let mut infos: Vec<TupleElementInfo> = Vec::new();
        let mut i: isize = 0;
        while i < length {
            let flags;
            if rest_type.is_nil() || i < length - 1 {
                let t = self.get_type_at_position(source, i + pos);
                types.push(t);
                flags = if i + pos < min_argument_count {
                    ElementFlags::REQUIRED
                } else {
                    ElementFlags::OPTIONAL
                };
            } else {
                types.push(rest_type);
                flags = ElementFlags::VARIADIC;
            }
            let labeled_declaration = self.get_nameable_declaration_at_position(source, i + pos);
            infos.push(TupleElementInfo {
                flags,
                labeled_declaration,
            });
            i += 1;
        }
        let types = self.list_of(&types);
        self.create_tuple_type_ex(types, List::from_slice(&infos), readonly)
    }

    pub fn get_nameable_declaration_at_position(
        &mut self,
        signature: SignatureId,
        pos: isize,
    ) -> NodeId {
        let parameters = self.signatures[signature].parameters;
        let has_rest = signature_has_rest_parameter(self, signature);
        let param_count = parameters.len() - if has_rest { 1 } else { 0 };
        if pos < param_count {
            let decl = self.ast.sym(parameters.at(pos)).value_declaration;
            if !decl.is_nil() && self.is_valid_declaration_for_tuple_label(decl) {
                return decl;
            }
            return NodeId::NIL;
        }
        if has_rest {
            let rest_parameter = parameters.at(param_count);
            let rest_type = self.get_type_of_symbol(rest_parameter);
            if is_tuple_type(self, rest_type) {
                let element_infos = self.type_target_tuple_type(rest_type).element_infos;
                let index = pos - param_count;
                if index < element_infos.len() {
                    return element_infos.at(index).labeled_declaration;
                }
                return NodeId::NIL;
            }
            let value_declaration = self.ast.sym(rest_parameter).value_declaration;
            if !value_declaration.is_nil()
                && self.is_valid_declaration_for_tuple_label(value_declaration)
            {
                return value_declaration;
            }
        }
        NodeId::NIL
    }

    pub fn is_valid_declaration_for_tuple_label(&mut self, d: NodeId) -> bool {
        is_named_tuple_member(self.ast, d)
            || is_parameter_declaration(self.ast, d)
                && !self.ast.name(d).is_nil()
                && is_identifier(self.ast, self.ast.name(d))
    }

    pub fn get_non_array_rest_type(&mut self, signature: SignatureId) -> TypeId {
        let rest_type = self.get_effective_rest_type(signature);
        if !rest_type.is_nil() && !self.is_array_type(rest_type) && !is_type_any(self, rest_type) {
            return rest_type;
        }
        TypeId::NIL
    }

    pub fn get_effective_rest_type(&mut self, signature: SignatureId) -> TypeId {
        if signature_has_rest_parameter(self, signature) {
            let parameters = self.signatures[signature].parameters;
            let rest_type = self.get_type_of_symbol(parameters.at(parameters.len() - 1));
            if !is_tuple_type(self, rest_type) {
                if is_type_any(self, rest_type) {
                    return self.any_array_type;
                }
                return rest_type;
            }
            let target = self.type_target_tuple_type(rest_type);
            if target.combined_flags.intersects(ElementFlags::VARIABLE) {
                let fixed_length = target.fixed_length;
                return self.slice_tuple_type(rest_type, fixed_length, 0);
            }
        }
        TypeId::NIL
    }

    pub fn slice_tuple_type(&mut self, t: TypeId, index: isize, end_skip_count: isize) -> TypeId {
        let fixed_length = self.type_target_tuple_type(t).fixed_length;
        let element_infos = self.type_target_tuple_type(t).element_infos.as_slice();
        let end_index = self.get_type_reference_arity(t) - end_skip_count.max(0);
        if index > fixed_length {
            let rest_array_type = self.get_rest_array_type_of_tuple_type(t);
            if !rest_array_type.is_nil() {
                return rest_array_type;
            }
            return self.create_tuple_type(List::NIL);
        }
        if index >= end_index {
            return self.create_tuple_type(List::NIL);
        }
        // The two lists are sub slices of the type arguments and of the element infos: a bound outside a list is cut to the list.
        let type_arguments = self.get_type_arguments(t).as_slice();
        let lo = usize::try_from(index).unwrap_or(0);
        let hi = usize::try_from(end_index).unwrap_or(0);
        let type_lo = lo.min(type_arguments.len());
        let type_hi = hi.min(type_arguments.len()).max(type_lo);
        let info_lo = lo.min(element_infos.len());
        let info_hi = hi.min(element_infos.len()).max(info_lo);
        let element_types = List::from_slice(type_arguments.get(type_lo..type_hi).unwrap_or(&[]));
        let element_infos = List::from_slice(element_infos.get(info_lo..info_hi).unwrap_or(&[]));
        self.create_tuple_type_ex(element_types, element_infos, false)
    }

    pub fn get_known_keys_of_tuple_type(&mut self, t: TypeId) -> TypeId {
        let fixed_length =
            usize::try_from(self.type_target_tuple_type(t).fixed_length).unwrap_or(0);
        let mut keys: Vec<TypeId> = Vec::with_capacity(fixed_length + 1);
        for i in 0..fixed_length {
            let text = self.text(i.to_string().as_bytes());
            let key = self.get_string_literal_type(text);
            keys.push(key);
        }
        let array_type = if self.type_target_tuple_type(t).readonly {
            self.global_readonly_array_type
        } else {
            self.global_array_type
        };
        let index_type = self.get_index_type(array_type);
        keys.push(index_type);
        self.get_union_type(List::from_slice(&keys))
    }

    pub fn get_rest_array_type_of_tuple_type(&mut self, t: TypeId) -> TypeId {
        let rest_type = self.get_rest_type_of_tuple_type(t);
        if !rest_type.is_nil() {
            return self.create_array_type(rest_type);
        }
        TypeId::NIL
    }

    pub fn get_this_type_of_signature(&mut self, signature: SignatureId) -> TypeId {
        let this_parameter = self.signatures[signature].this_parameter;
        if !this_parameter.is_nil() {
            return self.get_type_of_symbol(this_parameter);
        }
        TypeId::NIL
    }

    pub fn is_instantiated_generic_parameter(
        &mut self,
        signature: SignatureId,
        pos: isize,
    ) -> bool {
        let target = self.signatures[signature].target;
        if target.is_nil() {
            return false;
        }
        let t = self.try_get_type_at_position(target, pos);
        !t.is_nil() && self.is_generic_type(t)
    }

    pub fn get_parameter_name_at_position(
        &mut self,
        signature: SignatureId,
        pos: isize,
    ) -> Vec<u8> {
        let parameters = self.signatures[signature].parameters;
        let has_rest = signature_has_rest_parameter(self, signature);
        let param_count = parameters.len() - if has_rest { 1 } else { 0 };
        if pos < param_count {
            return self.ast.sym(parameters.at(pos)).name.to_vec();
        }
        let rest_parameter = parameters.at(param_count);
        if rest_parameter.is_nil() {
            self.fail::<()>("index out of range");
            return Vec::new();
        }
        let rest_type = self.get_type_of_symbol(rest_parameter);
        if is_tuple_type(self, rest_type) {
            let index = pos - param_count;
            let element_info = self
                .type_target_tuple_type(rest_type)
                .element_infos
                .at(index);
            return self.get_tuple_element_label(element_info, rest_parameter, index);
        }
        self.ast.sym(rest_parameter).name.to_vec()
    }

    pub fn get_tuple_element_label(
        &mut self,
        element_info: TupleElementInfo,
        rest_symbol: SymbolId,
        index: isize,
    ) -> Vec<u8> {
        if !element_info.labeled_declaration.is_nil() {
            let name = self.ast.name(element_info.labeled_declaration);
            return self.ast.text(name).to_vec();
        }
        if !rest_symbol.is_nil() {
            let value_declaration = self.ast.sym(rest_symbol).value_declaration;
            if !value_declaration.is_nil() && is_parameter_declaration(self.ast, value_declaration)
            {
                return self.get_tuple_element_label_from_binding_element(
                    value_declaration,
                    index,
                    element_info.flags,
                );
            }
        }
        let root_name: &[u8] = if !rest_symbol.is_nil() {
            self.ast.sym(rest_symbol).name
        } else {
            b"arg"
        };
        [root_name, b"_", itoa(index).as_slice()].concat()
    }

    // The binding patterns of a rest parameter nest as deep as the source does: the entry tests the stack.
    pub fn get_tuple_element_label_from_binding_element(
        &mut self,
        node: NodeId,
        index: isize,
        element_flags: ElementFlags,
    ) -> Vec<u8> {
        if !self.stack_check.is_safe_to_recurse() {
            self.stack_limit::<()>();
            return [b"arg_".as_slice(), itoa(index).as_slice()].concat();
        }
        let node_name = self.ast.name(node);
        if !node_name.is_nil() {
            match self.ast.kind(node_name) {
                Kind::Identifier => {
                    let name = self.ast.text(node_name);
                    if has_dot_dot_dot_token(self.ast, node) {
                        // given (...[x, y, ...z]: [number, number, ...number[]]) => ... this produces (x: number, y: number, ...z: number[]) => ... which preserves rest elements of 'z'; given (...[x, y, ...z]: [number, number, ...[...number[], number]]) => ... this produces (x: number, y: number, ...z: number[], z_1: number) => ... which preserves rest elements of z but gives distinct numbers to fixed elements of 'z'
                        if element_flags.intersects(ElementFlags::VARIABLE) {
                            return name.to_vec();
                        }
                        return [name, b"_", itoa(index).as_slice()].concat();
                    }
                    // given (...[x]: [number]) => ... this produces (x: number) => ... which preserves fixed elements of 'x'; given (...[x]: ...number[]) => ... this produces (x_0: number) => ... which which numbers fixed elements of 'x' whose tuple element type is variable
                    if element_flags.intersects(ElementFlags::FIXED) {
                        return name.to_vec();
                    }
                    return [name, b"_n".as_slice()].concat();
                }
                Kind::ArrayBindingPattern => {
                    if has_dot_dot_dot_token(self.ast, node) {
                        let elements = self.ast.elements(node_name);
                        let last_element = elements.at(elements.len() - 1);
                        let last_element_is_binding_element_rest = !last_element.is_nil()
                            && is_binding_element(self.ast, last_element)
                            && has_dot_dot_dot_token(self.ast, last_element);
                        let element_count = elements.len()
                            - if last_element_is_binding_element_rest {
                                1
                            } else {
                                0
                            };
                        if index < element_count {
                            let element = elements.at(index);
                            if is_binding_element(self.ast, element) {
                                return self.get_tuple_element_label_from_binding_element(
                                    element,
                                    index,
                                    element_flags,
                                );
                            }
                        } else if last_element_is_binding_element_rest {
                            return self.get_tuple_element_label_from_binding_element(
                                last_element,
                                index - element_count,
                                element_flags,
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        [b"arg_".as_slice(), itoa(index).as_slice()].concat()
    }

    // The targets of instantiated signatures form a chain: the entry tests the stack.
    pub fn get_type_predicate_of_signature(&mut self, sig: SignatureId) -> TypePredicateId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.signatures[sig].resolved_type_predicate.is_nil() {
            let target = self.signatures[sig].target;
            let composite = self.signatures[sig].composite;
            if !target.is_nil() {
                let target_type_predicate = self.get_type_predicate_of_signature(target);
                if !target_type_predicate.is_nil() {
                    let mapper = self.signatures[sig].mapper;
                    let predicate = self.instantiate_type_predicate(target_type_predicate, mapper);
                    self.signatures[sig].resolved_type_predicate = predicate;
                }
            } else if !composite.is_nil() {
                let signatures = self.composite_signatures[composite].signatures;
                let is_union = self.composite_signatures[composite].is_union;
                let predicate = self.get_union_or_intersection_type_predicate(signatures, is_union);
                self.signatures[sig].resolved_type_predicate = predicate;
            } else {
                let declaration = self.signatures[sig].declaration;
                if !declaration.is_nil() {
                    let type_node = self.ast.type_node(declaration);
                    if !type_node.is_nil() {
                        if is_type_predicate_node(self.ast, type_node) {
                            let predicate =
                                self.create_type_predicate_from_type_predicate_node(type_node, sig);
                            self.signatures[sig].resolved_type_predicate = predicate;
                        }
                    } else {
                        let resolved_return_type = self.signatures[sig].resolved_return_type;
                        if is_function_like_declaration(self.ast, declaration)
                            && (resolved_return_type.is_nil()
                                || self.types[resolved_return_type]
                                    .flags
                                    .intersects(TypeFlags::BOOLEAN))
                            && self.get_parameter_count(sig) > 0
                        {
                            // avoid infinite loop
                            self.signatures[sig].resolved_type_predicate = self.no_type_predicate;
                            let predicate = self.get_type_predicate_from_body(declaration);
                            self.signatures[sig].resolved_type_predicate = predicate;
                        }
                    }
                }
            }
            if self.signatures[sig].resolved_type_predicate.is_nil() {
                self.signatures[sig].resolved_type_predicate = self.no_type_predicate;
            }
        }
        if self.signatures[sig].resolved_type_predicate == self.no_type_predicate {
            return TypePredicateId::NIL;
        }
        self.signatures[sig].resolved_type_predicate
    }

    pub fn get_union_or_intersection_type_predicate(
        &mut self,
        signatures: List<'a, SignatureId>,
        is_union: bool,
    ) -> TypePredicateId {
        let mut last = TypePredicateId::NIL;
        let mut types: Vec<TypeId> = Vec::new();
        for &sig in signatures.as_slice() {
            let pred = self.get_type_predicate_of_signature(sig);
            if !pred.is_nil() {
                // Constituent type predicates must all have matching kinds. We don't create composite type predicates for assertions.
                let pred_kind = self.type_predicates[pred].kind;
                if pred_kind != TypePredicateKind::THIS
                    && pred_kind != TypePredicateKind::IDENTIFIER
                    || !last.is_nil() && !self.type_predicate_kinds_match(last, pred)
                {
                    return TypePredicateId::NIL;
                }
                last = pred;
                types.push(self.type_predicates[pred].t);
            } else {
                // In composite union signatures we permit and ignore signatures with a return type `false`.
                let mut return_type = TypeId::NIL;
                if is_union {
                    return_type = self.get_return_type_of_signature(sig);
                }
                if return_type != self.false_type && return_type != self.regular_false_type {
                    return TypePredicateId::NIL;
                }
            }
        }
        if last.is_nil() {
            return TypePredicateId::NIL;
        }
        let composite_type = self.get_union_or_intersection_type(
            List::from_slice(&types),
            is_union,
            UnionReduction::LITERAL,
        );
        let kind = self.type_predicates[last].kind;
        let parameter_name = self.type_predicates[last].parameter_name;
        let parameter_index = self.type_predicates[last].parameter_index;
        self.new_type_predicate(kind, parameter_name, parameter_index, composite_type)
    }

    pub fn type_predicate_kinds_match(&mut self, a: TypePredicateId, b: TypePredicateId) -> bool {
        self.type_predicates[a].kind == self.type_predicates[b].kind
            && self.type_predicates[a].parameter_index == self.type_predicates[b].parameter_index
    }

    pub fn create_type_predicate_from_type_predicate_node(
        &mut self,
        node: NodeId,
        signature: SignatureId,
    ) -> TypePredicateId {
        let predicate_node = self.ast.as_type_predicate_node(node);
        let mut t = TypeId::NIL;
        if !predicate_node.type_node.is_nil() {
            t = self.get_type_from_type_node(predicate_node.type_node);
        }
        if is_this_type_node(self.ast, predicate_node.parameter_name) {
            let kind = if !predicate_node.asserts_modifier.is_nil() {
                TypePredicateKind::ASSERTS_THIS
            } else {
                TypePredicateKind::THIS
            };
            return self.new_type_predicate(kind, b"", 0, t);
        }
        let kind = if !predicate_node.asserts_modifier.is_nil() {
            TypePredicateKind::ASSERTS_IDENTIFIER
        } else {
            TypePredicateKind::IDENTIFIER
        };
        let name = self.ast.text(predicate_node.parameter_name);
        let mut index: isize = -1;
        for (i, &p) in self.signatures[signature]
            .parameters
            .as_slice()
            .iter()
            .enumerate()
        {
            if self.ast.sym(p).name == name {
                index = i as isize;
                break;
            }
        }
        self.new_type_predicate(kind, name, index as i32, t)
    }

    pub fn instantiate_type_predicate(
        &mut self,
        predicate: TypePredicateId,
        mapper: TypeMapperId,
    ) -> TypePredicateId {
        let predicate_type = self.type_predicates[predicate].t;
        let t = self.instantiate_type(predicate_type, mapper);
        if t == predicate_type {
            return predicate;
        }
        let kind = self.type_predicates[predicate].kind;
        let parameter_name = self.type_predicates[predicate].parameter_name;
        let parameter_index = self.type_predicates[predicate].parameter_index;
        self.new_type_predicate(kind, parameter_name, parameter_index, t)
    }

    pub fn new_type_predicate(
        &mut self,
        kind: TypePredicateKind,
        parameter_name: Text<'a>,
        parameter_index: i32,
        t: TypeId,
    ) -> TypePredicateId {
        let predicate = self.type_predicates.alloc(TypePredicate {
            kind,
            parameter_index,
            parameter_name,
            t,
        });
        if predicate.is_nil() {
            self.ast
                .fault(FaultKind::IdSpaceExhausted, "TypePredicate", 0, 0);
        }
        predicate
    }

    // A composite signature can be made of composite signatures: the entry tests the stack.
    pub fn is_resolving_return_type_of_signature(&mut self, signature: SignatureId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let composite = self.signatures[signature].composite;
        if !composite.is_nil() {
            for &s in self.composite_signatures[composite].signatures.as_slice() {
                if self.is_resolving_return_type_of_signature(s) {
                    return true;
                }
            }
        }
        self.signatures[signature].resolved_return_type.is_nil()
            && self.find_resolution_cycle_start_index(
                TypeSystemEntity::Signature(signature),
                TypeSystemPropertyName::ResolvedReturnType,
            ) >= 0
    }

    pub fn find_matching_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
        signature: SignatureId,
        list_index: isize,
    ) -> List<'a, SignatureId> {
        if self.signatures[signature].type_parameters.len() != 0 {
            // We require an exact match for generic signatures, so we only return signatures from the first signature list and only if they have exact matches in the other signature lists.
            if list_index > 0 {
                return List::NIL;
            }
            for list in signature_lists.iter().skip(1) {
                if self
                    .find_matching_signature(list.as_slice(), signature, false, false, false)
                    .is_nil()
                {
                    return List::NIL;
                }
            }
            return self.list_of(&[signature]);
        }
        let mut result: Vec<SignatureId> = Vec::new();
        for (i, list) in signature_lists.iter().enumerate() {
            // Allow matching non-generic signatures to have excess parameters (as a fallback if exact parameter match is not found) and different return types. Prefer matching this types if possible.
            let mut matched;
            if i as isize == list_index {
                matched = signature;
            } else {
                matched =
                    self.find_matching_signature(list.as_slice(), signature, false, false, true);
                if matched.is_nil() {
                    matched =
                        self.find_matching_signature(list.as_slice(), signature, true, false, true);
                }
            }
            if matched.is_nil() {
                return List::NIL;
            }
            if !result.contains(&matched) {
                result.push(matched);
            }
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn find_matching_signature(
        &mut self,
        signature_list: &[SignatureId],
        signature: SignatureId,
        partial_match: bool,
        ignore_this_types: bool,
        ignore_return_types: bool,
    ) -> SignatureId {
        let mut compare_types = |c: &mut Checker<'a>, s: TypeId, t: TypeId| -> Ternary {
            if partial_match {
                c.compare_types_subtype_of(s, t)
            } else {
                c.compare_types_identical(s, t)
            }
        };
        for &s in signature_list {
            if self.compare_signatures_identical(
                s,
                signature,
                partial_match,
                ignore_this_types,
                ignore_return_types,
                &mut compare_types,
            ) != Ternary::FALSE
            {
                return s;
            }
        }
        SignatureId::NIL
    }

    // See signatureRelatedTo, compareSignaturesIdentical
    pub fn compare_signatures_identical(
        &mut self,
        mut source: SignatureId,
        target: SignatureId,
        partial_match: bool,
        ignore_this_types: bool,
        ignore_return_types: bool,
        compare_types: TypePairComparer<'_, 'a>,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        if !self.is_matching_signature(source, target, partial_match) {
            return Ternary::FALSE;
        }
        // Check that the two signatures have the same number of type parameters.
        let source_type_parameters = self.signatures[source].type_parameters;
        let target_type_parameters = self.signatures[target].type_parameters;
        if source_type_parameters.len() != target_type_parameters.len() {
            return Ternary::FALSE;
        }
        // Check that type parameter constraints and defaults match. If they do, instantiate the source signature with the type parameters of the target signature and continue the comparison.
        if target_type_parameters.len() != 0 {
            let mapper = new_type_mapper(self, source_type_parameters, target_type_parameters);
            for (i, &t) in target_type_parameters.as_slice().iter().enumerate() {
                let s = source_type_parameters.at(i);
                if s != t {
                    let source_constraint = self.get_constraint_or_unknown_from_type_parameter(s);
                    let source_constraint = self.instantiate_type(source_constraint, mapper);
                    let target_constraint = self.get_constraint_or_unknown_from_type_parameter(t);
                    if compare_types(self, source_constraint, target_constraint) == Ternary::FALSE {
                        return Ternary::FALSE;
                    }
                    let source_default = self.get_default_or_unknown_from_type_parameter(s);
                    let source_default = self.instantiate_type(source_default, mapper);
                    let target_default = self.get_default_or_unknown_from_type_parameter(t);
                    if compare_types(self, source_default, target_default) == Ternary::FALSE {
                        return Ternary::FALSE;
                    }
                }
            }
            source = self.instantiate_signature_ex(source, mapper, true);
        }
        let mut result = Ternary::TRUE;
        if !ignore_this_types {
            let source_this_type = self.get_this_type_of_signature(source);
            if !source_this_type.is_nil() {
                let target_this_type = self.get_this_type_of_signature(target);
                if !target_this_type.is_nil() {
                    let related = compare_types(self, source_this_type, target_this_type);
                    if related == Ternary::FALSE {
                        return Ternary::FALSE;
                    }
                    result &= related;
                }
            }
        }
        let target_parameter_count = self.get_parameter_count(target);
        let mut i: isize = 0;
        while i < target_parameter_count {
            let s = self.get_type_at_position(source, i);
            let t = self.get_type_at_position(target, i);
            let related = compare_types(self, t, s);
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
            i += 1;
        }
        if !ignore_return_types {
            let source_type_predicate = self.get_type_predicate_of_signature(source);
            let target_type_predicate = self.get_type_predicate_of_signature(target);
            if !source_type_predicate.is_nil() || !target_type_predicate.is_nil() {
                result &= self.compare_type_predicates_identical(
                    source_type_predicate,
                    target_type_predicate,
                    compare_types,
                );
            } else {
                let source_return_type = self.get_return_type_of_signature(source);
                let target_return_type = self.get_return_type_of_signature(target);
                result &= compare_types(self, source_return_type, target_return_type);
            }
        }
        result
    }

    pub fn is_matching_signature(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        partial_match: bool,
    ) -> bool {
        let source_parameter_count = self.get_parameter_count(source);
        let target_parameter_count = self.get_parameter_count(target);
        let source_min_argument_count = self.get_min_argument_count(source);
        let target_min_argument_count = self.get_min_argument_count(target);
        let source_has_rest_parameter = self.has_effective_rest_parameter(source);
        let target_has_rest_parameter = self.has_effective_rest_parameter(target);
        // A source signature matches a target signature if the two signatures have the same number of required, optional, and rest parameters.
        if source_parameter_count == target_parameter_count
            && source_min_argument_count == target_min_argument_count
            && source_has_rest_parameter == target_has_rest_parameter
        {
            return true;
        }
        // A source signature partially matches a target signature if the target signature has no fewer required parameters
        if partial_match && source_min_argument_count <= target_min_argument_count {
            return true;
        }
        false
    }

    pub fn compare_type_parameters_identical(
        &mut self,
        source_params: List<'a, TypeId>,
        target_params: List<'a, TypeId>,
    ) -> bool {
        if source_params.len() != target_params.len() {
            return false;
        }
        let mapper = new_type_mapper(self, target_params, source_params);
        for (i, &source) in source_params.as_slice().iter().enumerate() {
            let target = target_params.at(i);
            if source == target {
                continue;
            }
            // We instantiate the target type parameter constraints into the source types so we can recognize `<T, U extends T>` as the same as `<A, B extends A>`
            let mut source_constraint = self.get_constraint_from_type_parameter(source);
            if source_constraint.is_nil() {
                source_constraint = self.unknown_type;
            }
            let mut target_constraint = self.get_constraint_from_type_parameter(target);
            if target_constraint.is_nil() {
                target_constraint = self.unknown_type;
            }
            let target_constraint = self.instantiate_type(target_constraint, mapper);
            if !self.is_type_identical_to(source_constraint, target_constraint) {
                return false;
            }
            // We don't compare defaults - we just use the type parameter defaults from the first signature that seems to match. It might make sense to combine these defaults in the future, but doing so intelligently requires knowing if the parameter is used covariantly or contravariantly (so we intersect if it's used like a parameter or union if used like a return type) and, since it's just an inference _default_, just picking one arbitrarily works OK.
        }
        true
    }

    pub fn compare_type_predicates_identical(
        &mut self,
        source: TypePredicateId,
        target: TypePredicateId,
        compare_types: TypePairComparer<'_, 'a>,
    ) -> Ternary {
        if source.is_nil() || target.is_nil() || !self.type_predicate_kinds_match(source, target) {
            return Ternary::FALSE;
        }
        let source_t = self.type_predicates[source].t;
        let target_t = self.type_predicates[target].t;
        if source_t == target_t {
            return Ternary::TRUE;
        }
        if !source_t.is_nil() && !target_t.is_nil() {
            return compare_types(self, source_t, target_t);
        }
        Ternary::FALSE
    }

    pub fn get_effective_constraint_of_intersection(
        &mut self,
        types: List<'_, TypeId>,
        target_is_union: bool,
    ) -> TypeId {
        let mut constraints: Vec<TypeId> = Vec::new();
        let mut has_disjoint_domain_type = false;
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
                // We keep following constraints as long as we have an instantiable type that is known not to be circular or infinite (hence we stop on index access types).
                let mut constraint = self.get_constraint_of_type(t);
                let mut guard = LoopGuard::new();
                while !constraint.is_nil()
                    && self.types[constraint].flags.intersects(
                        TypeFlags::TYPE_PARAMETER | TypeFlags::INDEX | TypeFlags::CONDITIONAL,
                    )
                {
                    if !guard.turn() {
                        self.loop_limit("getEffectiveConstraintOfIntersection");
                        break;
                    }
                    constraint = self.get_constraint_of_type(constraint);
                }
                if !constraint.is_nil() {
                    constraints.push(constraint);
                    if target_is_union {
                        constraints.push(t);
                    }
                }
            } else if self.types[t].flags.intersects(TypeFlags::DISJOINT_DOMAINS)
                || self.is_empty_anonymous_object_type(t)
            {
                has_disjoint_domain_type = true;
            }
        }
        // If the target is a union type or if we are intersecting with types belonging to one of the disjoint domains, we may end up producing a constraint that hasn't been examined before.
        if !constraints.is_empty() && (target_is_union || has_disjoint_domain_type) {
            if has_disjoint_domain_type {
                // We add any types belong to one of the disjoint domains because they might cause the final intersection operation to reduce the union constraints.
                for &t in types.as_slice() {
                    if self.types[t].flags.intersects(TypeFlags::DISJOINT_DOMAINS)
                        || self.is_empty_anonymous_object_type(t)
                    {
                        constraints.push(t);
                    }
                }
            }
            // The source types were normalized; ensure the result is normalized too.
            let intersection = self.get_intersection_type_ex(
                List::from_slice(&constraints),
                IntersectionFlags::NO_CONSTRAINT_REDUCTION,
                TypeAliasId::NIL,
            );
            return self.get_normalized_type(intersection, false);
        }
        TypeId::NIL
    }

    pub fn template_literal_types_definitely_unrelated(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        // Two template literal types with differences in their starting or ending text spans are definitely unrelated.
        let source_texts = self.as_template_literal_type(source).texts;
        let target_texts = self.as_template_literal_type(target).texts;
        let source_start = source_texts.at(0usize);
        let target_start = target_texts.at(0usize);
        let source_end = source_texts.at(source_texts.len() - 1);
        let target_end = target_texts.at(target_texts.len() - 1);
        let start_len = source_start.len().min(target_start.len()) as isize;
        let end_len = source_end.len().min(target_end.len()) as isize;
        sub_text(source_start, 0, start_len) != sub_text(target_start, 0, start_len)
            || sub_text(
                source_end,
                source_end.len() as isize - end_len,
                source_end.len() as isize,
            ) != sub_text(
                target_end,
                target_end.len() as isize - end_len,
                target_end.len() as isize,
            )
    }

    pub fn is_type_matched_by_template_literal_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        compare_types: TypeComparer,
    ) -> bool {
        let inferences = self.infer_types_from_template_literal_type(source, target);
        if !inferences.is_nil() {
            let target_types = self.as_template_literal_type(target).types;
            for (i, &inference) in inferences.as_slice().iter().enumerate() {
                if !self.is_valid_type_for_template_literal_placeholder(
                    inference,
                    target_types.at(i),
                    compare_types,
                ) {
                    return false;
                }
            }
            return true;
        }
        false
    }

    pub fn infer_types_from_template_literal_type(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> List<'a, TypeId> {
        if self.types[source]
            .flags
            .intersects(TypeFlags::STRING_LITERAL)
        {
            let value = get_string_literal_value(self, source);
            return self.infer_from_literal_parts_to_template_literal(
                List::from_slice(&[value]),
                List::NIL,
                target,
            );
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::TEMPLATE_LITERAL)
        {
            let source_texts = self.as_template_literal_type(source).texts;
            let source_types = self.as_template_literal_type(source).types;
            let target_texts = self.as_template_literal_type(target).texts;
            let target_types = self.as_template_literal_type(target).types;
            if source_texts.as_slice() == target_texts.as_slice() {
                if source_types.is_nil() {
                    return List::NIL;
                }
                let mut result: Vec<TypeId> = Vec::with_capacity(source_types.as_slice().len());
                for (i, &s) in source_types.as_slice().iter().enumerate() {
                    let source_constraint = self.get_base_constraint_or_type(s);
                    let target_constraint = self.get_base_constraint_or_type(target_types.at(i));
                    if self.is_type_assignable_to(source_constraint, target_constraint) {
                        result.push(s);
                    } else {
                        let string_like = self.get_string_like_type_for_type(s);
                        result.push(string_like);
                    }
                }
                return self.list_of(&result);
            }
            return self.infer_from_literal_parts_to_template_literal(
                source_texts,
                source_types,
                target,
            );
        }
        List::NIL
    }

    // This function infers from the text parts and type parts of a source literal to a target template literal. The number of text parts is always one more than the number of type parts, and a source string literal is treated as a source with one text part and zero type parts. The function returns an array of inferred string or template literal types corresponding to the placeholders in the target template literal, or undefined if the source doesn't match the target. We first check that the starting source text part matches the starting target text part, and that the ending source text part ends matches the ending target text part. We then iterate through the remaining target text parts, finding a match for each in the source and inferring string or template literal types created from the segments of the source that occur between the matches. During this iteration, seg holds the index of the current text part in the sourceTexts array and pos holds the current character position in the current text part.
    pub fn infer_from_literal_parts_to_template_literal(
        &mut self,
        source_texts: List<'_, Text<'a>>,
        source_types: List<'_, TypeId>,
        target: TypeId,
    ) -> List<'a, TypeId> {
        let last_source_index = source_texts.len() - 1;
        let source_start_text = source_texts.at(0usize);
        let source_end_text = source_texts.at(last_source_index);
        let target_texts = self.as_template_literal_type(target).texts;
        let last_target_index = target_texts.len() - 1;
        let target_start_text = target_texts.at(0usize);
        let target_end_text = target_texts.at(last_target_index);
        if last_source_index == 0
            && source_start_text.len() < target_start_text.len() + target_end_text.len()
            || !source_start_text.starts_with(target_start_text)
            || !source_end_text.ends_with(target_end_text)
        {
            return List::NIL;
        }
        let remaining_end_text = sub_text(
            source_end_text,
            0,
            source_end_text.len() as isize - target_end_text.len() as isize,
        );
        let mut state = LiteralPartsState {
            source_texts,
            source_types,
            last_source_index,
            remaining_end_text,
            seg: 0,
            pos: target_start_text.len() as isize,
            matches: Vec::new(),
        };
        let mut i: isize = 1;
        while i < last_target_index {
            let delim = target_texts.at(i);
            if !delim.is_empty() {
                let mut s = state.seg;
                let mut p = state.pos;
                loop {
                    let source_text = state.get_source_text(s);
                    let rest = sub_text(source_text, p, source_text.len() as isize);
                    if let Some(d) = bun_core::strings::index_of(rest, delim) {
                        p += d as isize;
                        break;
                    }
                    s += 1;
                    if s == source_texts.len() {
                        return List::NIL;
                    }
                    p = 0;
                }
                self.add_literal_parts_match(&mut state, s, p);
                state.pos += delim.len() as isize;
            } else {
                let source_text = state.get_source_text(state.seg);
                if state.pos < source_text.len() as isize {
                    // Consume one code point at a time, matching the string iterator (`[x, ..._] = s`) rather than UTF-16 code-unit indexing (`s[0]`). DecodeJSStringRune is required rather than a plain UTF-8 decode because a lone surrogate is stored as an invalid-UTF-8 sentinel, and it pulls the whole sentinel off as one code point.
                    let (_, size) = decode_js_string_rune(sub_text(
                        source_text,
                        state.pos,
                        source_text.len() as isize,
                    ));
                    let (seg, pos) = (state.seg, state.pos + size as isize);
                    self.add_literal_parts_match(&mut state, seg, pos);
                } else if state.seg < last_source_index {
                    let seg = state.seg + 1;
                    self.add_literal_parts_match(&mut state, seg, 0);
                } else {
                    return List::NIL;
                }
            }
            i += 1;
        }
        let last_text_len = state.get_source_text(last_source_index).len() as isize;
        self.add_literal_parts_match(&mut state, last_source_index, last_text_len);
        self.list_of(&state.matches)
    }

    // The closure addMatch of inferFromLiteralPartsToTemplateLiteral.
    fn add_literal_parts_match(
        &mut self,
        state: &mut LiteralPartsState<'_, 'a>,
        s: isize,
        p: isize,
    ) {
        let match_type;
        if s == state.seg {
            let text = sub_text(state.get_source_text(s), state.pos, p);
            let combined = combine_surrogate_pairs(text);
            let value = self.text(combined.as_ref());
            match_type = self.get_string_literal_type(value);
        } else {
            let mut match_texts: Vec<Text<'a>> = Vec::new();
            let first = state.source_texts.at(state.seg);
            match_texts.push(sub_text(first, state.pos, first.len() as isize));
            match_texts.extend_from_slice(sub_slice(
                state.source_texts.as_slice(),
                state.seg + 1,
                s,
            ));
            match_texts.push(sub_text(state.get_source_text(s), 0, p));
            let match_types = sub_slice(state.source_types.as_slice(), state.seg, s);
            match_type =
                self.get_template_literal_type(&match_texts, List::from_slice(match_types));
        }
        state.matches.push(match_type);
        state.seg = s;
        state.pos = p;
    }

    pub fn get_string_like_type_for_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t]
            .flags
            .intersects(TypeFlags::ANY | TypeFlags::STRING_LIKE)
        {
            return t;
        }
        let texts: [&[u8]; 2] = [b"", b""];
        self.get_template_literal_type(&texts, List::from_slice(&[t]))
    }

    pub fn is_valid_type_for_template_literal_placeholder(
        &mut self,
        source: TypeId,
        target: TypeId,
        compare_types: TypeComparer,
    ) -> bool {
        let target_flags = self.types[target].flags;
        if target_flags.intersects(TypeFlags::INTERSECTION) {
            for &t in self.type_types(target).as_slice() {
                if !(t == self.empty_type_literal_type
                    || self.is_valid_type_for_template_literal_placeholder(
                        source,
                        t,
                        compare_types,
                    ))
                {
                    return false;
                }
            }
            return true;
        }
        if target_flags.intersects(TypeFlags::STRING)
            || self.call_type_comparer(compare_types, source, target, false) != Ternary::FALSE
        {
            return true;
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::STRING_LITERAL)
        {
            let value = get_string_literal_value(self, source);
            return target_flags.intersects(TypeFlags::NUMBER)
                && is_valid_number_string(value, false)
                || target_flags.intersects(TypeFlags::BIG_INT)
                    && is_valid_big_int_string(value, false)
                || target_flags.intersects(TypeFlags::BOOLEAN_LITERAL | TypeFlags::NULLABLE)
                    && value == self.as_intrinsic_type(target).intrinsic_name
                || target_flags.intersects(TypeFlags::STRING_MAPPING)
                    && self.is_member_of_string_mapping(source, target)
                || target_flags.intersects(TypeFlags::TEMPLATE_LITERAL)
                    && self.is_type_matched_by_template_literal_type(
                        source,
                        target,
                        compare_types,
                    );
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::TEMPLATE_LITERAL)
        {
            let texts = self.as_template_literal_type(source).texts;
            let first_type = self.as_template_literal_type(source).types.at(0usize);
            return texts.len() == 2
                && texts.at(0usize).is_empty()
                && texts.at(1usize).is_empty()
                && self.call_type_comparer(compare_types, first_type, target, false)
                    != Ternary::FALSE;
        }
        false
    }

    // String mappings nest as deep as the declarations make them: the entry tests the stack.
    pub fn is_member_of_string_mapping(&mut self, source: TypeId, target: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let target_flags = self.types[target].flags;
        if target_flags.intersects(TypeFlags::ANY) {
            return true;
        }
        if target_flags.intersects(TypeFlags::STRING | TypeFlags::TEMPLATE_LITERAL) {
            return self.is_type_assignable_to(source, target);
        }
        if target_flags.intersects(TypeFlags::STRING_MAPPING) {
            // We need to see whether applying the same mappings of the target onto the source would produce an identical type *and* that it's compatible with the inner-most non-string-mapped type. The intuition here is that if same mappings don't affect the source at all, and the source is compatible with the unmapped target, then they must still reside in the same domain.
            let (mapped, inner) = self.apply_target_string_mapping_to_source(source, target);
            return mapped == source && self.is_member_of_string_mapping(source, inner);
        }
        false
    }

    pub fn apply_target_string_mapping_to_source(
        &mut self,
        mut source: TypeId,
        target: TypeId,
    ) -> (TypeId, TypeId) {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut inner = self.as_string_mapping_type(target).target;
        if self.types[inner]
            .flags
            .intersects(TypeFlags::STRING_MAPPING)
        {
            (source, inner) = self.apply_target_string_mapping_to_source(source, inner);
        }
        let target_symbol = self.types[target].symbol;
        (self.get_string_mapping_type(target_symbol, source), inner)
    }
}

// The locals that the closures getSourceText and addMatch of inferFromLiteralPartsToTemplateLiteral share.
struct LiteralPartsState<'s, 'a> {
    source_texts: List<'s, Text<'a>>,
    source_types: List<'s, TypeId>,
    last_source_index: isize,
    remaining_end_text: Text<'a>,
    seg: isize,
    pos: isize,
    matches: Vec<TypeId>,
}

impl<'a> LiteralPartsState<'_, 'a> {
    // getSourceText
    fn get_source_text(&self, index: isize) -> Text<'a> {
        if index < self.last_source_index {
            return self.source_texts.at(index);
        }
        self.remaining_end_text
    }
}

// s[lo:hi] of a slice, with Go's bounds turned into a clamp.
fn sub_slice<T>(s: &[T], lo: isize, hi: isize) -> &[T] {
    let hi = usize::try_from(hi).unwrap_or(0).min(s.len());
    let lo = usize::try_from(lo).unwrap_or(0).min(hi);
    s.get(lo..hi).unwrap_or(&[])
}

// s[lo:hi] of a text.
fn sub_text(s: &[u8], lo: isize, hi: isize) -> &[u8] {
    sub_slice(s, lo, hi)
}

pub fn visibility_to_string(flags: ModifierFlags) -> &'static [u8] {
    if flags == ModifierFlags::PRIVATE {
        return b"private";
    }
    if flags == ModifierFlags::PROTECTED {
        return b"protected";
    }
    b"public"
}

impl<'a> Checker<'a> {
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
        // `*r = Relater{...}`: every field is zero again; the buffers keep their capacity.
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

// The locals of structuredTypeRelatedToWorker that its closure relateVariances reads and writes.
struct VarianceRelation {
    result: Ternary,
    variance_check_failed: bool,
    original_error_chain: ErrorChainId,
    save_error_state: ErrorState,
    report_errors: bool,
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

    // Out of stack is a stack depth overflow of the relation: upstream's own answer to one is overflow and False.
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
        let r = self;
        if original_source == original_target {
            return Ternary::TRUE;
        }
        if !c.stack_check.is_safe_to_recurse() {
            c.relaters[r].overflow = true;
            return c.stack_limit();
        }
        let relation = c.relaters[r].relation;
        let error_reporter: ErrorReporter = if report_errors { Some(r) } else { None };
        // Before normalization: if `source` is type an object type, and `target` is primitive, skip all the checks we don't need and just return `isSimpleTypeRelatedTo` result
        if c.types[original_source].flags.intersects(TypeFlags::OBJECT)
            && c.types[original_target]
                .flags
                .intersects(TypeFlags::PRIMITIVE)
        {
            if relation == RelationKind::Comparable
                && !c.types[original_target].flags.intersects(TypeFlags::NEVER)
                && c.is_simple_type_related_to(original_target, original_source, relation, None)
                || c.is_simple_type_related_to(
                    original_source,
                    original_target,
                    relation,
                    error_reporter,
                )
            {
                return Ternary::TRUE;
            }
            if report_errors {
                r.report_error_results(
                    c,
                    original_source,
                    original_target,
                    original_source,
                    original_target,
                    head_message,
                );
            }
            return Ternary::FALSE;
        }
        // Normalize the source and target types: Turn fresh literal types into regular literal types, turn deferred type references into regular type references, simplify indexed access and conditional types, and resolve substitution types to either the substitution (on the source side) or the type variable (on the target side).
        let source = c.get_normalized_type(original_source, false);
        let mut target = c.get_normalized_type(original_target, true);
        if source == target {
            return Ternary::TRUE;
        }
        if relation == RelationKind::Identity {
            if c.types[source].flags != c.types[target].flags {
                return Ternary::FALSE;
            }
            if c.types[source].flags.intersects(TypeFlags::SINGLETON) {
                return Ternary::TRUE;
            }
            return r.recursive_type_related_to(
                c,
                source,
                target,
                false,
                IntersectionState::NONE,
                recursion_flags,
            );
        }
        // We fastpath comparing a type parameter to exactly its constraint, as this is _super_ common, and otherwise, for type parameters in large unions, causes us to need to compare the union to itself, as we break down the _target_ union first, _then_ get the source constraint - so for every member of the target, we attempt to find a match in the source. This avoids that in cases where the target is exactly the constraint.
        if c.types[source].flags.intersects(TypeFlags::TYPE_PARAMETER)
            && c.get_constraint_of_type(source) == target
        {
            return Ternary::TRUE;
        }
        // See if we're relating a definitely non-nullable type to a union that includes null and/or undefined plus a single non-nullable type. If so, remove null and/or undefined from the target type.
        if c.types[source]
            .flags
            .intersects(TypeFlags::DEFINITELY_NON_NULLABLE)
            && c.types[target].flags.intersects(TypeFlags::UNION)
        {
            let types = c.type_types(target);
            let mut candidate = TypeId::NIL;
            if types.len() == 2
                && c.types[types.at(0usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
            {
                candidate = types.at(1usize);
            } else if types.len() == 3
                && c.types[types.at(0usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
                && c.types[types.at(1usize)]
                    .flags
                    .intersects(TypeFlags::NULLABLE)
            {
                candidate = types.at(2usize);
            }
            if !candidate.is_nil() && !c.types[candidate].flags.intersects(TypeFlags::NULLABLE) {
                target = c.get_normalized_type(candidate, true);
                if source == target {
                    return Ternary::TRUE;
                }
            }
        }
        if relation == RelationKind::Comparable
            && !c.types[target].flags.intersects(TypeFlags::NEVER)
            && c.is_simple_type_related_to(target, source, relation, None)
            || c.is_simple_type_related_to(source, target, relation, error_reporter)
        {
            return Ternary::TRUE;
        }
        if c.types[source]
            .flags
            .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
            || c.types[target]
                .flags
                .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
        {
            let is_performing_excess_property_checks = !intersection_state
                .intersects(IntersectionState::TARGET)
                && is_object_literal_type(c, source)
                && c.types[source]
                    .object_flags
                    .intersects(ObjectFlags::FRESH_LITERAL);
            if is_performing_excess_property_checks {
                if r.has_excess_properties(c, source, target, report_errors) {
                    if report_errors {
                        let error_target = if !c.types[original_target].alias.is_nil() {
                            original_target
                        } else {
                            target
                        };
                        r.report_relation_error(c, head_message, source, error_target);
                    }
                    return Ternary::FALSE;
                }
            }
            let is_performing_common_property_checks = (relation != RelationKind::Comparable
                || is_unit_type(c, source))
                && !intersection_state.intersects(IntersectionState::TARGET)
                && c.types[source]
                    .flags
                    .intersects(TypeFlags::PRIMITIVE | TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && source != c.global_object_type
                && c.types[target]
                    .flags
                    .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && c.is_weak_type(target)
                && (c.get_properties_of_type(source).len() > 0
                    || c.type_has_call_or_construct_signatures(source));
            let is_comparing_jsx_attributes = c.types[source]
                .object_flags
                .intersects(ObjectFlags::JSX_ATTRIBUTES);
            if is_performing_common_property_checks
                && !c.has_common_properties(source, target, is_comparing_jsx_attributes)
            {
                if report_errors {
                    let source_for_text = if !c.types[original_source].alias.is_nil() {
                        original_source
                    } else {
                        source
                    };
                    let source_string = c.type_to_string_exported(source_for_text);
                    let target_for_text = if !c.types[original_target].alias.is_nil() {
                        original_target
                    } else {
                        target
                    };
                    let target_string = c.type_to_string_exported(target_for_text);
                    let calls = c.get_signatures_of_type(source, SignatureKind::CALL);
                    let constructs = c.get_signatures_of_type(source, SignatureKind::CONSTRUCT);
                    let mut did_you_mean_to_call = false;
                    if calls.len() > 0 {
                        let return_type = c.get_return_type_of_signature(calls.at(0usize));
                        did_you_mean_to_call =
                            r.is_related_to(c, return_type, target, RecursionFlags::SOURCE, false)
                                != Ternary::FALSE;
                    }
                    if !did_you_mean_to_call && constructs.len() > 0 {
                        let return_type = c.get_return_type_of_signature(constructs.at(0usize));
                        did_you_mean_to_call =
                            r.is_related_to(c, return_type, target, RecursionFlags::SOURCE, false)
                                != Ternary::FALSE;
                    }
                    if did_you_mean_to_call {
                        r.report_error(
                            c,
                            diagnostics::VALUE_OF_TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1_DID_YOU_MEAN_TO_CALL_IT,
                            &[Arg::Str(&source_string), Arg::Str(&target_string)],
                        );
                    } else {
                        r.report_error(
                            c,
                            diagnostics::TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1,
                            &[Arg::Str(&source_string), Arg::Str(&target_string)],
                        );
                    }
                }
                return Ternary::FALSE;
            }
            let skip_caching = c.types[source].flags.intersects(TypeFlags::UNION)
                && c.type_types(source).len() < 4
                && !c.types[target].flags.intersects(TypeFlags::UNION)
                || c.types[target].flags.intersects(TypeFlags::UNION)
                    && c.type_types(target).len() < 4
                    && !c.types[source]
                        .flags
                        .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE);
            let result = if skip_caching {
                r.union_or_intersection_related_to(
                    c,
                    source,
                    target,
                    report_errors,
                    intersection_state,
                )
            } else {
                r.recursive_type_related_to(
                    c,
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
            r.report_error_results(
                c,
                original_source,
                original_target,
                source,
                target,
                head_message,
            );
        }
        Ternary::FALSE
    }

    pub fn has_excess_properties(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> bool {
        let r = self;
        if !is_excess_property_check_target(c, target)
            || !c.no_implicit_any
                && c.types[target]
                    .object_flags
                    .intersects(ObjectFlags::JS_LITERAL)
        {
            // Disable excess property checks on JS literals to simulate having an implicit "index signature" - but only outside of noImplicitAny
            return false;
        }
        let is_comparing_jsx_attributes = c.types[source]
            .object_flags
            .intersects(ObjectFlags::JSX_ATTRIBUTES);
        let relation = c.relaters[r].relation;
        if (relation == RelationKind::Assignable || relation == RelationKind::Comparable)
            && (c.is_type_subset_of(c.global_object_type, target)
                || (!is_comparing_jsx_attributes && c.is_empty_object_type(target)))
        {
            return false;
        }
        let mut reduced_target = target;
        let mut check_types = List::NIL;
        if c.types[target].flags.intersects(TypeFlags::UNION) {
            reduced_target = c.find_matching_discriminant_type(source, target, &mut |c, s, t| {
                r.is_related_to_simple(c, s, t)
            });
            if reduced_target.is_nil() {
                reduced_target = c.filter_primitives_if_contains_non_primitive(target);
            }
            check_types = c.type_distributed(reduced_target);
        }
        let source_symbol = c.types[source].symbol;
        let properties = c.get_properties_of_type(source);
        for &prop in properties.as_slice() {
            if should_check_as_excess_property(c.ast, prop, source_symbol)
                && !is_ignored_jsx_property(c, source, prop)
            {
                let prop_name = c.ast.sym(prop).name;
                if !c.is_known_property(reduced_target, prop_name, is_comparing_jsx_attributes) {
                    if report_errors {
                        // Report error in terms of object types in the target as those are the only ones we check in isKnownProperty.
                        let error_target = c.filter_type(reduced_target, &mut |c, t| {
                            is_excess_property_check_target(c, t)
                        });
                        // We know *exactly* where things went wrong when comparing the types. Use this property as the error node as this will be more helpful in reasoning about what went wrong.
                        if c.relaters[r].error_node.is_nil() {
                            c.fail::<()>("No errorNode in hasExcessProperties");
                        }
                        let error_node = c.relaters[r].error_node;
                        let value_declaration = c.ast.sym(prop).value_declaration;
                        if is_jsx_attributes(c.ast, error_node)
                            || is_jsx_opening_like_element(c.ast, error_node)
                            || is_jsx_opening_like_element(c.ast, c.ast.parent(error_node))
                        {
                            // JsxAttributes has an object-literal flag and undergo same type-assignablity check as normal object-literal. However, using an object-literal error message will be very confusing to the users so we give different a message.
                            if !value_declaration.is_nil()
                                && is_jsx_attribute(c.ast, value_declaration)
                                && get_source_file_of_node(c.ast, error_node)
                                    == get_source_file_of_node(c.ast, c.ast.name(value_declaration))
                            {
                                // Note that extraneous children (as in `<NoChild>extra</NoChild>`) don't pass this check, since `children` is a Kind.PropertySignature instead of a Kind.JsxAttribute.
                                c.relaters[r].error_node = c.ast.name(value_declaration);
                            }
                            let prop_name_text = c.symbol_to_string(prop);
                            let suggestion_symbol = c
                                .get_suggested_symbol_for_nonexistent_jsx_attribute(
                                    &prop_name_text,
                                    error_target,
                                );
                            if !suggestion_symbol.is_nil() {
                                let target_text = c.type_to_string_exported(error_target);
                                let suggestion_text = c.symbol_to_string(suggestion_symbol);
                                r.report_error(
                                    c,
                                    diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_2,
                                    &[
                                        Arg::Str(&prop_name_text),
                                        Arg::Str(&target_text),
                                        Arg::Str(&suggestion_text),
                                    ],
                                );
                            } else {
                                let target_text = c.type_to_string_exported(error_target);
                                r.report_error(
                                    c,
                                    diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                                    &[Arg::Str(&prop_name_text), Arg::Str(&target_text)],
                                );
                            }
                        } else {
                            // use the property's value declaration if the property is assigned inside the literal itself
                            let mut object_literal_declaration = NodeId::NIL;
                            if !source_symbol.is_nil() {
                                object_literal_declaration =
                                    c.ast.sym(source_symbol).declarations.at(0usize);
                            }
                            let mut suggestion: Vec<u8> = Vec::new();
                            if !value_declaration.is_nil()
                                && is_object_literal_element(c.ast, value_declaration)
                                && !find_ancestor(c.ast, value_declaration, |d| {
                                    d == object_literal_declaration
                                })
                                .is_nil()
                                && get_source_file_of_node(c.ast, object_literal_declaration)
                                    == get_source_file_of_node(c.ast, error_node)
                            {
                                let name = c.ast.name(value_declaration);
                                c.relaters[r].error_node = name;
                                if is_identifier(c.ast, name) {
                                    suggestion.extend_from_slice(
                                        &c.get_suggestion_for_nonexistent_property(
                                            c.ast.text(name),
                                            error_target,
                                        ),
                                    );
                                }
                            }
                            if !suggestion.is_empty() {
                                let prop_text = c.symbol_to_string(prop);
                                let target_text = c.type_to_string_exported(error_target);
                                r.report_error(
                                    c,
                                    diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2,
                                    &[
                                        Arg::Str(&prop_text),
                                        Arg::Str(&target_text),
                                        Arg::Str(&suggestion),
                                    ],
                                );
                            } else {
                                let prop_text = c.symbol_to_string(prop);
                                let target_text = c.type_to_string_exported(error_target);
                                r.report_error(
                                    c,
                                    diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1,
                                    &[Arg::Str(&prop_text), Arg::Str(&target_text)],
                                );
                            }
                        }
                    }
                    return true;
                }
                if !check_types.is_nil() {
                    let prop_type = c.get_type_of_symbol(prop);
                    let target_prop_type = c.get_type_of_property_in_types(check_types, prop_name);
                    if r.is_related_to(
                        c,
                        prop_type,
                        target_prop_type,
                        RecursionFlags::BOTH,
                        report_errors,
                    ) == Ternary::FALSE
                    {
                        if report_errors {
                            let prop_text = c.symbol_to_string(prop);
                            r.report_error(
                                c,
                                diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE,
                                &[Arg::Str(&prop_text)],
                            );
                        }
                        return true;
                    }
                }
            }
        }
        false
    }
}

impl<'a> Checker<'a> {
    pub fn get_type_of_property_in_types(
        &mut self,
        types: List<'a, TypeId>,
        name: &[u8],
    ) -> TypeId {
        let mut prop_types: Vec<TypeId> = Vec::new();
        for &t in types.as_slice() {
            let prop_type = self.get_type_of_property_in_type(t, name);
            prop_types.push(prop_type);
        }
        self.get_union_type(List::from_slice(&prop_types))
    }

    pub fn get_type_of_property_in_type(&mut self, t: TypeId, name: &[u8]) -> TypeId {
        let t = self.get_apparent_type(t);
        let prop = if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            self.get_property_of_union_or_intersection_type(t, name, false)
        } else {
            self.get_property_of_object_type(t, name)
        };
        if !prop.is_nil() {
            return self.get_type_of_symbol(prop);
        }
        let index_info = self.get_applicable_index_info_for_name(t, name);
        if !index_info.is_nil() {
            return self.index_infos[index_info].value_type;
        }
        self.undefined_type
    }
}

pub fn should_check_as_excess_property(a: Ast<'_>, prop: SymbolId, container: SymbolId) -> bool {
    let prop_declaration = a.sym(prop).value_declaration;
    let container_declaration = a.sym(container).value_declaration;
    !prop_declaration.is_nil()
        && !container_declaration.is_nil()
        && a.parent(prop_declaration) == container_declaration
}

pub fn is_ignored_jsx_property(c: &Checker<'_>, source: TypeId, source_prop: SymbolId) -> bool {
    c.types[source]
        .object_flags
        .intersects(ObjectFlags::JSX_ATTRIBUTES)
        && is_hyphenated_jsx_name(c.ast.sym(source_prop).name)
}

impl<'a> Checker<'a> {
    pub fn is_type_subset_of(&mut self, source: TypeId, target: TypeId) -> bool {
        source == target
            || self.types[source].flags.intersects(TypeFlags::NEVER)
            || self.types[target].flags.intersects(TypeFlags::UNION)
                && self.is_type_subset_of_union(source, target)
    }

    pub fn is_type_subset_of_union(&mut self, source: TypeId, target: TypeId) -> bool {
        if self.types[source].flags.intersects(TypeFlags::UNION) {
            let target_types = self.type_types(target);
            for &t in self.type_types(source).as_slice() {
                if !contains_type(self, target_types, t) {
                    return false;
                }
            }
            return true;
        }
        if self.types[source].flags.intersects(TypeFlags::ENUM_LIKE)
            && self.get_base_type_of_enum_like_type(source) == target
        {
            return true;
        }
        let target_types = self.type_types(target);
        contains_type(self, target_types, source)
    }
}

impl RelaterId {
    pub fn union_or_intersection_related_to(
        self,
        c: &mut Checker<'_>,
        mut source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        // Note that these checks are specifically ordered to produce correct results. In particular, we need to deconstruct unions before intersections (because unions are always at the top), and we need to handle "each" relations before "some" relations for the same kind of type.
        if c.types[source].flags.intersects(TypeFlags::UNION) {
            if c.types[target].flags.intersects(TypeFlags::UNION) {
                // Intersections of union types are normalized into unions of intersection types, and such normalized unions can get very large and expensive to relate. The following fast path checks if the source union originated in an intersection. If so, and if that intersection contains the target type, then we know the result to be true (for any two types A and B, A & B is related to both A and B).
                let source_origin = c.as_union_type(source).origin;
                if !source_origin.is_nil()
                    && c.types[source_origin]
                        .flags
                        .intersects(TypeFlags::INTERSECTION)
                    && !c.types[target].alias.is_nil()
                    && c.type_types(source_origin).as_slice().contains(&target)
                {
                    return Ternary::TRUE;
                }
                // Similarly, in unions of unions the we preserve the original list of unions. This original list is often much shorter than the normalized result, so we scan it in the following fast path.
                let target_origin = c.as_union_type(target).origin;
                if !target_origin.is_nil()
                    && c.types[target_origin].flags.intersects(TypeFlags::UNION)
                    && !c.types[source].alias.is_nil()
                    && c.type_types(target_origin).as_slice().contains(&source)
                {
                    return Ternary::TRUE;
                }
            }
            let report = report_errors && !c.types[source].flags.intersects(TypeFlags::PRIMITIVE);
            if relation == RelationKind::Comparable {
                return r.some_type_related_to_type(c, source, target, report, intersection_state);
            }
            return r.each_type_related_to_type(c, source, target, report, intersection_state);
        }
        if c.types[target].flags.intersects(TypeFlags::UNION) {
            let regular_source = c.get_regular_type_of_object_literal(source);
            let report = report_errors
                && !c.types[source].flags.intersects(TypeFlags::PRIMITIVE)
                && !c.types[target].flags.intersects(TypeFlags::PRIMITIVE);
            return r.type_related_to_some_type(
                c,
                regular_source,
                target,
                report,
                intersection_state,
            );
        }
        if c.types[target].flags.intersects(TypeFlags::INTERSECTION) {
            return r.type_related_to_each_type(
                c,
                source,
                target,
                report_errors,
                IntersectionState::TARGET,
            );
        }
        // Source is an intersection. For the comparable relation, if the target is a primitive type we hoist the constraints of all non-primitive types in the source into a new intersection. We do this because the intersection may further constrain the constraints of the non-primitive types. For example, given a type parameter 'T extends 1 | 2', the intersection 'T & 1' should be reduced to '1' such that it doesn't appear to be comparable to '2'.
        if relation == RelationKind::Comparable
            && c.types[target].flags.intersects(TypeFlags::PRIMITIVE)
        {
            let source_types = c.type_types(source);
            let constraints = c.same_map(source_types, |c, t| {
                if c.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
                    let constraint = c.get_base_constraint_of_type(t);
                    if !constraint.is_nil() {
                        return constraint;
                    }
                    return c.unknown_type;
                }
                t
            });
            if !same(constraints.as_slice(), source_types.as_slice()) {
                source = c.get_intersection_type(constraints);
                if c.types[source].flags.intersects(TypeFlags::NEVER) {
                    return Ternary::FALSE;
                }
                if !c.types[source].flags.intersects(TypeFlags::INTERSECTION) {
                    let result = r.is_related_to(c, source, target, RecursionFlags::SOURCE, false);
                    if result != Ternary::FALSE {
                        return result;
                    }
                    return r.is_related_to(c, target, source, RecursionFlags::SOURCE, false);
                }
            }
        }
        // Check to see if any constituents of the intersection are immediately related to the target. Don't report errors though. Elaborating on whether a source constituent is related to the target is not actually useful and leads to some confusing error messages. Instead, we rely on the caller checking whether the full intersection viewed as an object is related to the target.
        r.some_type_related_to_type(c, source, target, false, IntersectionState::SOURCE)
    }

    pub fn some_type_related_to_type(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let source_types = c.type_types(source);
        if c.types[source].flags.intersects(TypeFlags::UNION)
            && contains_type(c, source_types, target)
        {
            return Ternary::TRUE;
        }
        for (i, &t) in source_types.as_slice().iter().enumerate() {
            let related = r.is_related_to_ex(
                c,
                t,
                target,
                RecursionFlags::SOURCE,
                report_errors && i as isize == source_types.len() - 1,
                MessageId::NIL,
                intersection_state,
            );
            if related != Ternary::FALSE {
                return related;
            }
        }
        Ternary::FALSE
    }

    pub fn each_type_related_to_type(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let mut result = Ternary::TRUE;
        let source_types = c.type_types(source);
        // We strip `undefined` from the target if the `source` trivially doesn't contain it for our correspondence-checking fastpath since `undefined` is frequently added by optionality and would otherwise spoil a potentially useful correspondence
        let stripped_target = r.get_undefined_stripped_target_if_needed(c, source, target);
        let stripped_is_union = c.types[stripped_target].flags.intersects(TypeFlags::UNION);
        let mut stripped_types = List::NIL;
        if stripped_is_union {
            stripped_types = c.type_types(stripped_target);
        }
        for (i, &source_type) in source_types.as_slice().iter().enumerate() {
            if stripped_is_union
                && source_types.len() >= stripped_types.len()
                && source_types.len().checked_rem(stripped_types.len()) == Some(0)
            {
                // many unions are mappings of one another; in such cases, simply comparing members at the same index can shortcut the comparison such unions will have identical lengths, and their corresponding elements will match up. Another common scenario is where a large union has a union of objects intersected with it. In such cases the resulting union has a length which is a multiple of the original union, and the elements correspond modulo the length of the original union
                let index = (i as isize).checked_rem(stripped_types.len()).unwrap_or(0);
                let related = r.is_related_to_ex(
                    c,
                    source_type,
                    stripped_types.at(index),
                    RecursionFlags::BOTH,
                    false,
                    MessageId::NIL,
                    intersection_state,
                );
                if related != Ternary::FALSE {
                    result &= related;
                    continue;
                }
            }
            let related = r.is_related_to_ex(
                c,
                source_type,
                target,
                RecursionFlags::SOURCE,
                report_errors,
                MessageId::NIL,
                intersection_state,
            );
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    pub fn get_undefined_stripped_target_if_needed(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) -> TypeId {
        if c.types[source].flags.intersects(TypeFlags::UNION)
            && c.types[target].flags.intersects(TypeFlags::UNION)
            && !c.types[c.type_types(source).at(0usize)]
                .flags
                .intersects(TypeFlags::UNDEFINED)
            && c.types[c.type_types(target).at(0usize)]
                .flags
                .intersects(TypeFlags::UNDEFINED)
        {
            return c.extract_types_of_kind(target, TypeFlags(!TypeFlags::UNDEFINED.0));
        }
        target
    }

    pub fn type_related_to_some_type(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        let target_types = c.type_types(target);
        if c.types[target].flags.intersects(TypeFlags::UNION) {
            if contains_type(c, target_types, source) {
                return Ternary::TRUE;
            }
            let source_flags = c.types[source].flags;
            if relation != RelationKind::Comparable
                && c.types[target]
                    .object_flags
                    .intersects(ObjectFlags::PRIMITIVE_UNION)
                && !source_flags.intersects(TypeFlags::ENUM_LITERAL)
                && (source_flags.intersects(
                    TypeFlags::STRING_LITERAL
                        | TypeFlags::BOOLEAN_LITERAL
                        | TypeFlags::BIG_INT_LITERAL,
                ) || (relation == RelationKind::Subtype
                    || relation == RelationKind::StrictSubtype)
                    && source_flags.intersects(TypeFlags::NUMBER_LITERAL))
            {
                // When relating a literal type to a union of primitive types, we know the relation is false unless the union contains the base primitive type or the literal type in one of its fresh/regular forms. We exclude numeric literals for non-subtype relations because numeric literals are assignable to numeric enum literals with the same value. Similarly, we exclude enum literal types because identically named enum types are related (see isEnumTypeRelatedTo). We exclude the comparable relation in entirety because it needs to be checked in both directions.
                let alternate_form = if source == c.as_literal_type(source).regular_type {
                    c.as_literal_type(source).fresh_type
                } else {
                    c.as_literal_type(source).regular_type
                };
                let mut primitive = TypeId::NIL;
                if source_flags.intersects(TypeFlags::STRING_LITERAL) {
                    primitive = c.string_type;
                } else if source_flags.intersects(TypeFlags::NUMBER_LITERAL) {
                    primitive = c.number_type;
                } else if source_flags.intersects(TypeFlags::BIG_INT_LITERAL) {
                    primitive = c.bigint_type;
                }
                if !primitive.is_nil() && contains_type(c, target_types, primitive)
                    || !alternate_form.is_nil() && contains_type(c, target_types, alternate_form)
                {
                    return Ternary::TRUE;
                }
                return Ternary::FALSE;
            }
            let matched = c.get_matching_union_constituent_for_type(target, source);
            if !matched.is_nil() {
                let related = r.is_related_to_ex(
                    c,
                    source,
                    matched,
                    RecursionFlags::TARGET,
                    false,
                    MessageId::NIL,
                    intersection_state,
                );
                if related != Ternary::FALSE {
                    return related;
                }
            }
        }
        for &t in target_types.as_slice() {
            let related = r.is_related_to_ex(
                c,
                source,
                t,
                RecursionFlags::TARGET,
                false,
                MessageId::NIL,
                intersection_state,
            );
            if related != Ternary::FALSE {
                return related;
            }
        }
        if report_errors {
            // Elaborate only if we can find a best matching type in the target union
            let best_matching_type = c.get_best_matching_type(source, target, &mut |c, s, t| {
                r.is_related_to_simple(c, s, t)
            });
            if !best_matching_type.is_nil() {
                r.is_related_to_ex(
                    c,
                    source,
                    best_matching_type,
                    RecursionFlags::TARGET,
                    true,
                    MessageId::NIL,
                    intersection_state,
                );
            }
        }
        Ternary::FALSE
    }

    pub fn type_related_to_each_type(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let mut result = Ternary::TRUE;
        let target_types = c.type_types(target);
        for &target_type in target_types.as_slice() {
            let related = r.is_related_to_ex(
                c,
                source,
                target_type,
                RecursionFlags::TARGET,
                report_errors,
                MessageId::NIL,
                intersection_state,
            );
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    pub fn each_type_related_to_some_type(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let r = self;
        let mut result = Ternary::TRUE;
        let source_types = c.type_types(source);
        for &source_type in source_types.as_slice() {
            let related =
                r.type_related_to_some_type(c, source_type, target, false, IntersectionState::NONE);
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
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
                    let source_text = c.type_to_string_exported(source);
                    let target_text = c.type_to_string_exported(target);
                    r.report_error(
                        c,
                        diagnostics::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1,
                        &[Arg::Str(&source_text), Arg::Str(&target_text)],
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
            // We stop relating if we reach 100 levels of nesting. This is a backstop to catch infinite recursion that wasn't caught by isDeeplyNestedType. It will also stop relating types that truly are over 100 levels deep, but those are exceedingly rare.
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
                // The stack is lent to the call: another relation that the call starts takes another relater.
                let stack = std::mem::take(&mut c.relaters[r].source_stack);
                let deeply_nested = c.is_deeply_nested_type(source, &stack, 3);
                c.relaters[r].source_stack = stack;
                if deeply_nested {
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
                let stack = std::mem::take(&mut c.relaters[r].target_stack);
                let deeply_nested = c.is_deeply_nested_type(target, &stack, 3);
                c.relaters[r].target_stack = stack;
                if deeply_nested {
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
                // If result is definitely true, record all maybe keys as having succeeded. Also, record Ternary.Maybe results as having succeeded once we reach depth 0, but never record Ternary.Unknown results.
                let mark_all_as_succeeded = result == Ternary::TRUE || result == Ternary::MAYBE;
                r.reset_maybe_stack(
                    c,
                    maybe_start,
                    propagating_variance_flags,
                    mark_all_as_succeeded,
                );
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

    pub fn structured_type_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let save_error_state = r.get_error_state(c);
        let mut result = r.structured_type_related_to_worker(
            c,
            source,
            target,
            report_errors,
            intersection_state,
        );
        if c.relaters[r].relation != RelationKind::Identity {
            // The combined constraint of an intersection type is the intersection of the constraints of the constituents. When an intersection type contains instantiable types with union type constraints, there are situations where we need to examine the combined constraint. One is when the target is a union type. Another is when the intersection contains types belonging to one of the disjoint domains. For example, given type variables T and U, each with the constraint 'string | number', the combined constraint of 'T & U' is 'string | number' and we need to check this constraint against a union on the target side. Also, given a type variable V constrained to 'string | number', 'V & number' has a combined constraint of 'string & number | number & number' which reduces to just 'number'. This also handles type parameters, as a type parameter with a union constraint compared against a union needs to have its constraint hoisted into an intersection with said type parameter, this way the type param can be compared with itself in the target (with the influence of its constraint to match other parts). For example, if `T extends 1 | 2` and `U extends 2 | 3` and we compare `T & U` to `T & U & (1 | 2 | 3)`
            let source_flags = c.types[source].flags;
            let target_flags = c.types[target].flags;
            if result == Ternary::FALSE
                && (source_flags.intersects(TypeFlags::INTERSECTION)
                    || source_flags.intersects(TypeFlags::TYPE_PARAMETER)
                        && target_flags.intersects(TypeFlags::UNION))
            {
                let single_source = [source];
                let source_types = if source_flags.intersects(TypeFlags::INTERSECTION) {
                    c.type_types(source)
                } else {
                    List::from_slice(&single_source)
                };
                let constraint = c.get_effective_constraint_of_intersection(
                    source_types,
                    target_flags.intersects(TypeFlags::UNION),
                );
                if !constraint.is_nil() && every_type(c, constraint, &mut |_, t| t != source) {
                    result = r.is_related_to_ex(
                        c,
                        constraint,
                        target,
                        RecursionFlags::SOURCE,
                        false,
                        MessageId::NIL,
                        intersection_state,
                    );
                }
            }
            // When the target is an intersection we need an extra property check in order to detect nested excess properties and nested weak types. The following are motivating examples that all should be errors, but aren't without this extra property check: let obj: { a: { x: string } } & { c: number } = { a: { x: 'hello', y: 2 }, c: 5 }; (nested excess property) and declare let wrong: { a: { y: string } }; let weak: { a?: { x?: number } } & { c?: string } = wrong; (nested weak object type)
            if result != Ternary::FALSE
                && !intersection_state.intersects(IntersectionState::TARGET)
                && target_flags.intersects(TypeFlags::INTERSECTION)
                && !c.is_generic_object_type(target)
                && source_flags.intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
            {
                result &= r.properties_related_to(
                    c,
                    source,
                    target,
                    report_errors,
                    &Set::default(),
                    false,
                    IntersectionState::NONE,
                );
                if result != Ternary::FALSE
                    && is_object_literal_type(c, source)
                    && c.types[source]
                        .object_flags
                        .intersects(ObjectFlags::FRESH_LITERAL)
                {
                    result &= r.index_signatures_related_to(
                        c,
                        source,
                        target,
                        false,
                        report_errors,
                        IntersectionState::NONE,
                    );
                }
            } else if result != Ternary::FALSE
                && c.is_non_generic_object_type(target)
                && !c.is_array_or_tuple_type(target)
                && r.is_source_intersection_needing_extra_check(c, source, target)
            {
                // When the source is an intersection we need an extra check of any optional properties in the target to detect possible mismatched property types. For example: function foo<T extends object>(x: { a?: string }, y: T & { a: boolean }) { x = y; } (mismatched property in source intersection)
                result &= r.properties_related_to(
                    c,
                    source,
                    target,
                    report_errors,
                    &Set::default(),
                    true,
                    intersection_state,
                );
            }
        }
        if result != Ternary::FALSE {
            r.restore_error_state(c, save_error_state);
        }
        result
    }

    pub fn is_source_intersection_needing_extra_check(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if !c.types[source].flags.intersects(TypeFlags::INTERSECTION) {
            return false;
        }
        let apparent = c.get_apparent_type(source);
        if !c.types[apparent]
            .flags
            .intersects(TypeFlags::STRUCTURED_TYPE)
        {
            return false;
        }
        for &t in c.type_types(source).as_slice() {
            if t == target
                || c.types[t]
                    .object_flags
                    .intersects(ObjectFlags::NON_INFERRABLE_TYPE)
            {
                return false;
            }
        }
        true
    }

    // The closure relateVariances of structuredTypeRelatedToWorker.
    fn relate_variances<'a>(
        self,
        c: &mut Checker<'a>,
        st: &mut VarianceRelation,
        source_type_arguments: List<'a, TypeId>,
        target_type_arguments: List<'a, TypeId>,
        variances: List<'a, VarianceFlags>,
        intersection_state: IntersectionState,
    ) -> (Ternary, bool) {
        let r = self;
        st.result = r.type_arguments_related_to(
            c,
            source_type_arguments,
            target_type_arguments,
            variances,
            st.report_errors,
            intersection_state,
        );
        if st.result != Ternary::FALSE {
            return (st.result, true);
        }
        if variances
            .as_slice()
            .iter()
            .any(|&v| v.intersects(VarianceFlags::ALLOWS_STRUCTURAL_FALLBACK))
        {
            // If some type parameter was `Unmeasurable` or `Unreliable`, and we couldn't pass by assuming it was identical, then we have to allow a structural fallback check. We elide the variance-based error elaborations, since those might not be too helpful, since we'll potentially be assuming identity of the type parameter.
            st.original_error_chain = ErrorChainId::NIL;
            r.restore_error_state(c, st.save_error_state);
            return (Ternary::FALSE, false);
        }
        let allow_structural_fallback =
            c.has_covariant_void_argument(target_type_arguments, variances);
        st.variance_check_failed = !allow_structural_fallback;
        // The type arguments did not relate appropriately, but it may be because we have no variance information (in which case typeArgumentsRelatedTo defaulted to covariance for all type arguments). It might also be the case that the target type has a 'void' type argument for a covariant type parameter that is only used in return positions within the generic type (in which case any type argument is permitted on the source side). In those cases we proceed with a structural comparison. Otherwise, we know for certain the instantiations aren't related and we can return here.
        if variances.len() != 0 && !allow_structural_fallback {
            // In some cases generic types that are covariant in regular type checking mode become invariant in --strictFunctionTypes mode because one or more type parameters are used in both co- and contravariant positions. In order to make it easier to diagnose *why* such types are invariant, if any of the type parameters are invariant we reset the reported errors and instead force a structural comparison (which will include elaborations that reveal the reason). We can switch on `reportErrors` here, since varianceCheckFailed guarantees we return `False`, we can return `False` early here to skip calculating the structural error message we don't need.
            if st.variance_check_failed
                && !(st.report_errors
                    && variances
                        .as_slice()
                        .iter()
                        .any(|&v| (v & VarianceFlags::VARIANCE_MASK) == VarianceFlags::INVARIANT))
            {
                return (Ternary::FALSE, true);
            }
            // We remember the original error information so we can restore it in case the structural comparison unexpectedly succeeds. This can happen when the structural comparison result is a Ternary.Maybe for example caused by the recursion depth limiter.
            st.original_error_chain = c.relaters[r].error_chain;
            r.restore_error_state(c, st.save_error_state);
        }
        (Ternary::FALSE, false)
    }

    pub fn structured_type_related_to_worker(
        self,
        c: &mut Checker<'_>,
        mut source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let mut st = VarianceRelation {
            result: Ternary::FALSE,
            variance_check_failed: false,
            original_error_chain: ErrorChainId::NIL,
            save_error_state: r.get_error_state(c),
            report_errors,
        };
        let relation = c.relaters[r].relation;
        let source_flags = c.types[source].flags;
        let target_flags = c.types[target].flags;
        if relation == RelationKind::Identity {
            // We've already checked that source.flags and target.flags are identical
            if source_flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
                let mut result = r.each_type_related_to_some_type(c, source, target);
                if result != Ternary::FALSE {
                    result &= r.each_type_related_to_some_type(c, target, source);
                }
                return result;
            } else if source_flags.intersects(TypeFlags::INDEX) {
                let source_target = c.type_target(source);
                let target_target = c.type_target(target);
                return r.is_related_to(
                    c,
                    source_target,
                    target_target,
                    RecursionFlags::BOTH,
                    false,
                );
            } else if source_flags.intersects(TypeFlags::INDEXED_ACCESS) {
                let source_object_type = c.as_indexed_access_type(source).object_type;
                let target_object_type = c.as_indexed_access_type(target).object_type;
                st.result = r.is_related_to(
                    c,
                    source_object_type,
                    target_object_type,
                    RecursionFlags::BOTH,
                    false,
                );
                if st.result != Ternary::FALSE {
                    let source_index_type = c.as_indexed_access_type(source).index_type;
                    let target_index_type = c.as_indexed_access_type(target).index_type;
                    st.result &= r.is_related_to(
                        c,
                        source_index_type,
                        target_index_type,
                        RecursionFlags::BOTH,
                        false,
                    );
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            } else if source_flags.intersects(TypeFlags::CONDITIONAL) {
                let source_root = c.as_conditional_type(source).root;
                let target_root = c.as_conditional_type(target).root;
                if c.conditional_roots[source_root].is_distributive
                    == c.conditional_roots[target_root].is_distributive
                {
                    let source_check_type = c.as_conditional_type(source).check_type;
                    let target_check_type = c.as_conditional_type(target).check_type;
                    st.result = r.is_related_to(
                        c,
                        source_check_type,
                        target_check_type,
                        RecursionFlags::BOTH,
                        false,
                    );
                    if st.result != Ternary::FALSE {
                        let source_extends_type = c.as_conditional_type(source).extends_type;
                        let target_extends_type = c.as_conditional_type(target).extends_type;
                        st.result &= r.is_related_to(
                            c,
                            source_extends_type,
                            target_extends_type,
                            RecursionFlags::BOTH,
                            false,
                        );
                        if st.result != Ternary::FALSE {
                            let source_true_type = c.get_true_type_from_conditional_type(source);
                            let target_true_type = c.get_true_type_from_conditional_type(target);
                            st.result &= r.is_related_to(
                                c,
                                source_true_type,
                                target_true_type,
                                RecursionFlags::BOTH,
                                false,
                            );
                            if st.result != Ternary::FALSE {
                                let source_false_type =
                                    c.get_false_type_from_conditional_type(source);
                                let target_false_type =
                                    c.get_false_type_from_conditional_type(target);
                                st.result &= r.is_related_to(
                                    c,
                                    source_false_type,
                                    target_false_type,
                                    RecursionFlags::BOTH,
                                    false,
                                );
                                if st.result != Ternary::FALSE {
                                    return st.result;
                                }
                            }
                        }
                    }
                }
            } else if source_flags.intersects(TypeFlags::SUBSTITUTION) {
                let source_base_type = c.as_substitution_type(source).base_type;
                let target_base_type = c.as_substitution_type(target).base_type;
                st.result = r.is_related_to(
                    c,
                    source_base_type,
                    target_base_type,
                    RecursionFlags::BOTH,
                    false,
                );
                if st.result != Ternary::FALSE {
                    let source_constraint = c.as_substitution_type(source).constraint;
                    let target_constraint = c.as_substitution_type(target).constraint;
                    st.result &= r.is_related_to(
                        c,
                        source_constraint,
                        target_constraint,
                        RecursionFlags::BOTH,
                        false,
                    );
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            } else if source_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                let source_texts = c.as_template_literal_type(source).texts;
                let target_texts = c.as_template_literal_type(target).texts;
                if source_texts.as_slice() == target_texts.as_slice() {
                    st.result = Ternary::TRUE;
                    let source_types = c.as_template_literal_type(source).types;
                    let target_types = c.as_template_literal_type(target).types;
                    for (i, &source_type) in source_types.as_slice().iter().enumerate() {
                        let target_type = target_types.at(i);
                        st.result &= r.is_related_to(
                            c,
                            source_type,
                            target_type,
                            RecursionFlags::BOTH,
                            false,
                        );
                        if st.result == Ternary::FALSE {
                            return st.result;
                        }
                    }
                    return st.result;
                }
            } else if source_flags.intersects(TypeFlags::STRING_MAPPING) {
                if c.types[source].symbol == c.types[target].symbol {
                    let source_target = c.as_string_mapping_type(source).target;
                    let target_target = c.as_string_mapping_type(target).target;
                    return r.is_related_to(
                        c,
                        source_target,
                        target_target,
                        RecursionFlags::BOTH,
                        false,
                    );
                }
            }
            if !source_flags.intersects(TypeFlags::OBJECT) {
                return Ternary::FALSE;
            }
        } else if source_flags.intersects(TypeFlags::UNION_OR_INTERSECTION)
            || target_flags.intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            st.result = r.union_or_intersection_related_to(
                c,
                source,
                target,
                report_errors,
                intersection_state,
            );
            if st.result != Ternary::FALSE {
                return st.result;
            }
            // The ordered decomposition above doesn't handle all cases. Specifically, we also need to handle: Source is instantiable (e.g. source has union or intersection constraint). Source is an object, target is a union (e.g. { a, b: boolean } <=> { a, b: true } | { a, b: false }). Source is an intersection, target is an object (e.g. { a } & { b } <=> { a, b }). Source is an intersection, target is a union (e.g. { a } & { b: boolean } <=> { a, b: true } | { a, b: false }). Source is an intersection, target instantiable (e.g. string & { tag } <=> T["a"] constrained to string & { tag }).
            if !(source_flags.intersects(TypeFlags::INSTANTIABLE)
                || source_flags.intersects(TypeFlags::OBJECT)
                    && target_flags.intersects(TypeFlags::UNION)
                || source_flags.intersects(TypeFlags::INTERSECTION)
                    && target_flags
                        .intersects(TypeFlags::OBJECT | TypeFlags::UNION | TypeFlags::INSTANTIABLE))
            {
                return Ternary::FALSE;
            }
        }
        // We limit alias variance probing to only object and conditional types since their alias behavior is more predictable than other, interned types, which may or may not have an alias depending on the order in which things were checked.
        let source_alias = c.types[source].alias;
        let target_alias = c.types[target].alias;
        if source_flags.intersects(TypeFlags::OBJECT | TypeFlags::CONDITIONAL)
            && !source_alias.is_nil()
            && c.type_aliases[source_alias].type_arguments.len() != 0
            && !target_alias.is_nil()
            && c.type_aliases[source_alias].symbol == c.type_aliases[target_alias].symbol
            && !(c.is_marker_type(source) || c.is_marker_type(target))
        {
            let alias_symbol = c.type_aliases[source_alias].symbol;
            let variances = c.get_alias_variances(alias_symbol);
            if variances.len() == 0 {
                return Ternary::UNKNOWN;
            }
            let links = c.type_alias_links.get(alias_symbol);
            let params = c.type_alias_links[links].type_parameters;
            let min_params = c.get_min_type_argument_count(params);
            let node_is_in_js_file =
                is_in_js_file(c.ast, c.ast.sym(alias_symbol).value_declaration);
            let source_alias_arguments = c.type_aliases[source_alias].type_arguments;
            let source_types = c.fill_missing_type_arguments(
                source_alias_arguments,
                params,
                min_params,
                node_is_in_js_file,
            );
            let target_alias_arguments = c.type_aliases[target_alias].type_arguments;
            let target_types = c.fill_missing_type_arguments(
                target_alias_arguments,
                params,
                min_params,
                node_is_in_js_file,
            );
            let (variance_result, ok) = r.relate_variances(
                c,
                &mut st,
                source_types,
                target_types,
                variances,
                intersection_state,
            );
            if ok {
                return variance_result;
            }
        }
        // For a generic type T and a type U that is assignable to T, [...U] is assignable to T, U is assignable to readonly [...T], and U is assignable to [...T] when U is constrained to a mutable array or tuple type.
        if is_single_element_generic_tuple_type(c, source)
            && !c.type_target_tuple_type(source).readonly
        {
            let element = c.get_type_arguments(source).at(0usize);
            st.result = r.is_related_to(c, element, target, RecursionFlags::SOURCE, false);
            if st.result != Ternary::FALSE {
                return st.result;
            }
        }
        if is_single_element_generic_tuple_type(c, target) {
            let mut applies = c.type_target_tuple_type(target).readonly;
            if !applies {
                let source_constraint = c.get_base_constraint_or_type(source);
                applies = c.is_mutable_array_or_tuple(source_constraint);
            }
            if applies {
                let element = c.get_type_arguments(target).at(0usize);
                st.result = r.is_related_to(c, source, element, RecursionFlags::TARGET, false);
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            }
        }
        if target_flags.intersects(TypeFlags::TYPE_PARAMETER) {
            // A source type { [P in Q]: X } is related to a target type T if keyof T is related to Q and X is related to T[Q].
            if c.types[source].object_flags.intersects(ObjectFlags::MAPPED)
                && c.ast
                    .as_mapped_type_node(c.as_mapped_type(source).declaration)
                    .name_type
                    .is_nil()
            {
                let target_index = c.get_index_type(target);
                let source_constraint = c.get_constraint_type_from_mapped_type(source);
                if r.is_related_to(
                    c,
                    target_index,
                    source_constraint,
                    RecursionFlags::BOTH,
                    false,
                ) != Ternary::FALSE
                {
                    if !get_mapped_type_modifiers(c, source)
                        .intersects(MappedTypeModifiers::INCLUDE_OPTIONAL)
                    {
                        let template_type = c.get_template_type_from_mapped_type(source);
                        let type_parameter = c.get_type_parameter_from_mapped_type(source);
                        let indexed_access_type = c.get_indexed_access_type(target, type_parameter);
                        st.result = r.is_related_to(
                            c,
                            template_type,
                            indexed_access_type,
                            RecursionFlags::BOTH,
                            report_errors,
                        );
                        if st.result != Ternary::FALSE {
                            return st.result;
                        }
                    }
                }
            }
            if relation == RelationKind::Comparable
                && source_flags.intersects(TypeFlags::TYPE_PARAMETER)
            {
                // This is a carve-out in comparability to essentially forbid comparing a type parameter with another type parameter unless one extends the other. (Remember: comparability is mostly bidirectional!)
                let constraint = c.get_constraint_of_type_parameter(source);
                if !constraint.is_nil()
                    && some_type(c, constraint, &mut |c, t| {
                        c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER)
                    })
                {
                    return r.is_related_to(c, constraint, target, RecursionFlags::SOURCE, false);
                }
                return Ternary::FALSE;
            }
        } else if target_flags.intersects(TypeFlags::INDEXED_ACCESS) {
            if source_flags.intersects(TypeFlags::INDEXED_ACCESS) {
                // Relate components directly before falling back to constraint relationships. A type S[K] is related to a type T[J] if S is related to T and K is related to J.
                let source_object_type = c.as_indexed_access_type(source).object_type;
                let target_object_type = c.as_indexed_access_type(target).object_type;
                st.result = r.is_related_to(
                    c,
                    source_object_type,
                    target_object_type,
                    RecursionFlags::BOTH,
                    report_errors,
                );
                if st.result != Ternary::FALSE {
                    let source_index_type = c.as_indexed_access_type(source).index_type;
                    let target_index_type = c.as_indexed_access_type(target).index_type;
                    st.result &= r.is_related_to(
                        c,
                        source_index_type,
                        target_index_type,
                        RecursionFlags::BOTH,
                        report_errors,
                    );
                }
                if st.result != Ternary::FALSE {
                    return st.result;
                }
                if report_errors {
                    st.original_error_chain = c.relaters[r].error_chain;
                }
            }
            // A type S is related to a type T[K] if S is related to C, where C is the base constraint of T[K] for writing.
            if relation == RelationKind::Assignable || relation == RelationKind::Comparable {
                let object_type = c.as_indexed_access_type(target).object_type;
                let index_type = c.as_indexed_access_type(target).index_type;
                let base_object_type = c.get_base_constraint_or_type(object_type);
                let base_index_type = c.get_base_constraint_or_type(index_type);
                if !c.is_generic_object_type(base_object_type)
                    && !c.is_generic_index_type(base_index_type)
                {
                    let access_flags = AccessFlags::WRITING
                        | if base_object_type != object_type {
                            AccessFlags::NO_INDEX_SIGNATURES
                        } else {
                            AccessFlags::NONE
                        };
                    let constraint = c.get_indexed_access_type_or_undefined(
                        base_object_type,
                        base_index_type,
                        access_flags,
                        NodeId::NIL,
                        TypeAliasId::NIL,
                    );
                    if !constraint.is_nil() {
                        if report_errors && !st.original_error_chain.is_nil() {
                            // create a new chain for the constraint error
                            r.restore_error_state(c, st.save_error_state);
                        }
                        st.result = r.is_related_to_ex(
                            c,
                            source,
                            constraint,
                            RecursionFlags::TARGET,
                            report_errors,
                            MessageId::NIL,
                            intersection_state,
                        );
                        if st.result != Ternary::FALSE {
                            return st.result;
                        }
                        // prefer the shorter chain of the constraint comparison chain, and the direct comparison chain
                        let current_error_chain = c.relaters[r].error_chain;
                        if report_errors
                            && !st.original_error_chain.is_nil()
                            && !current_error_chain.is_nil()
                        {
                            if chain_depth(c, r, st.original_error_chain)
                                <= chain_depth(c, r, current_error_chain)
                            {
                                c.relaters[r].error_chain = st.original_error_chain;
                            }
                        }
                    }
                }
            }
            if report_errors {
                st.original_error_chain = ErrorChainId::NIL;
            }
        } else if target_flags.intersects(TypeFlags::INDEX) {
            let target_type = c.as_index_type(target).target;
            // A keyof S is related to a keyof T if T is related to S.
            if source_flags.intersects(TypeFlags::INDEX) {
                let source_target = c.as_index_type(source).target;
                st.result =
                    r.is_related_to(c, target_type, source_target, RecursionFlags::BOTH, false);
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            }
            if is_tuple_type(c, target_type) {
                // An index type can have a tuple type target when the tuple type contains variadic elements. Check if the source is related to the known keys of the tuple type.
                let known_keys = c.get_known_keys_of_tuple_type(target_type);
                st.result =
                    r.is_related_to(c, source, known_keys, RecursionFlags::TARGET, report_errors);
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            } else {
                // A type S is assignable to keyof T if S is assignable to keyof C, where C is the simplified form of T or, if T doesn't simplify, the constraint of T.
                let constraint = c.get_simplified_type_or_constraint(target_type);
                if !constraint.is_nil() {
                    // We require Ternary.True here such that circular constraints don't cause false positives. For example, given 'T extends { [K in keyof T]: string }', 'keyof T' has itself as its constraint and produces a Ternary.Maybe when related to other types.
                    let index_flags =
                        c.as_index_type(target).index_flags | IndexFlags::NO_REDUCIBLE_CHECK;
                    let constraint_index = c.get_index_type_ex(constraint, index_flags);
                    if r.is_related_to(
                        c,
                        source,
                        constraint_index,
                        RecursionFlags::TARGET,
                        report_errors,
                    ) == Ternary::TRUE
                    {
                        return Ternary::TRUE;
                    }
                } else if c.is_generic_mapped_type(target_type) {
                    // generic mapped types that don't simplify or have a constraint still have a very simple set of keys we can compare against - their nameType or constraintType. In many ways, this comparison is a deferred version of what `getIndexTypeForMappedType` does to actually resolve the keys for _non_-generic types
                    let name_type = c.get_name_type_from_mapped_type(target_type);
                    let constraint_type = c.get_constraint_type_from_mapped_type(target_type);
                    let target_keys;
                    if !name_type.is_nil()
                        && c.is_mapped_type_with_keyof_constraint_declaration(target_type)
                    {
                        // we need to get the apparent mappings and union them with the generic mappings, since some properties may be missing from the `constraintType` which will otherwise be mapped in the object
                        let mapped_keys = c.get_apparent_mapped_type_keys(name_type, target_type);
                        // We still need to include the non-apparent (and thus still generic) keys in the target side of the comparison (in case they're in the source side)
                        target_keys = c.get_union_type(List::from_slice(&[mapped_keys, name_type]));
                    } else if !name_type.is_nil() {
                        target_keys = name_type;
                    } else {
                        target_keys = constraint_type;
                    }
                    if r.is_related_to(
                        c,
                        source,
                        target_keys,
                        RecursionFlags::TARGET,
                        report_errors,
                    ) == Ternary::TRUE
                    {
                        return Ternary::TRUE;
                    }
                }
            }
        } else if target_flags.intersects(TypeFlags::CONDITIONAL) {
            // If we reach 10 levels of nesting for the same conditional type, assume it is an infinitely expanding recursive conditional type and bail out with a Ternary.Maybe result.
            let stack = std::mem::take(&mut c.relaters[r].target_stack);
            let deeply_nested = c.is_deeply_nested_type(target, &stack, 10);
            c.relaters[r].target_stack = stack;
            if deeply_nested {
                return Ternary::MAYBE;
            }
            let root = c.as_conditional_type(target).root;
            let check_type = c.as_conditional_type(target).check_type;
            let extends_type = c.as_conditional_type(target).extends_type;
            // We check for a relationship to a conditional type target only when the conditional type has no 'infer' positions, is not distributive or is distributive but doesn't reference the check type parameter in either of the result types, and the source isn't an instantiation of the same conditional type (as happens when computing variance).
            if c.conditional_roots[root].infer_type_parameters.is_nil()
                && !c.is_distribution_dependent(root)
                && !(source_flags.intersects(TypeFlags::CONDITIONAL)
                    && c.as_conditional_type(source).root == root)
            {
                // Check if the conditional is always true or always false but still deferred for distribution purposes.
                let permissive_check = c.get_permissive_instantiation(check_type);
                let permissive_extends = c.get_permissive_instantiation(extends_type);
                let skip_true = !c.is_type_assignable_to(permissive_check, permissive_extends);
                let mut skip_false = false;
                if !skip_true {
                    let restrictive_check = c.get_restrictive_instantiation(check_type);
                    let restrictive_extends = c.get_restrictive_instantiation(extends_type);
                    skip_false = c.is_type_assignable_to(restrictive_check, restrictive_extends);
                }
                if skip_true {
                    st.result = Ternary::TRUE;
                } else {
                    let true_type = c.get_true_type_from_conditional_type(target);
                    st.result = r.is_related_to_ex(
                        c,
                        source,
                        true_type,
                        RecursionFlags::TARGET,
                        false,
                        MessageId::NIL,
                        intersection_state,
                    );
                }
                if st.result != Ternary::FALSE {
                    if skip_false {
                        st.result &= Ternary::TRUE;
                    } else {
                        let false_type = c.get_false_type_from_conditional_type(target);
                        st.result &= r.is_related_to_ex(
                            c,
                            source,
                            false_type,
                            RecursionFlags::TARGET,
                            false,
                            MessageId::NIL,
                            intersection_state,
                        );
                    }
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            }
        } else if target_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            if source_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                if relation == RelationKind::Comparable {
                    if c.template_literal_types_definitely_unrelated(source, target) {
                        return Ternary::FALSE;
                    }
                    return Ternary::TRUE;
                }
                // Report unreliable variance for type variables referenced in template literal type placeholders. For example, `foo-${number}` is related to `foo-${string}` even though number isn't related to string.
                c.instantiate_type(source, c.report_unreliable_mapper);
            }
            if c.is_type_matched_by_template_literal_type(
                source,
                target,
                TypeComparer::Relater {
                    r,
                    intersection_state: IntersectionState::NONE,
                },
            ) {
                return Ternary::TRUE;
            }
        } else if target_flags.intersects(TypeFlags::STRING_MAPPING) {
            if !source_flags.intersects(TypeFlags::STRING_MAPPING) {
                if c.is_member_of_string_mapping(source, target) {
                    return Ternary::TRUE;
                }
            }
        } else if c.is_generic_mapped_type(target) && relation != RelationKind::Identity {
            // Check if source type `S` is related to target type `{ [P in Q]: T }` or `{ [P in Q as R]: T}`.
            let keys_remapped = !c
                .ast
                .as_mapped_type_node(c.as_mapped_type(target).declaration)
                .name_type
                .is_nil();
            let template_type = c.get_template_type_from_mapped_type(target);
            let modifiers = get_mapped_type_modifiers(c, target);
            if !modifiers.intersects(MappedTypeModifiers::EXCLUDE_OPTIONAL) {
                // If the mapped type has shape `{ [P in Q]: T[P] }`, source `S` is related to target if `T` = `S`, i.e. `S` is related to `{ [P in Q]: S[P] }`.
                if !keys_remapped
                    && c.types[template_type]
                        .flags
                        .intersects(TypeFlags::INDEXED_ACCESS)
                    && c.as_indexed_access_type(template_type).object_type == source
                    && {
                        let index_type = c.as_indexed_access_type(template_type).index_type;
                        index_type == c.get_type_parameter_from_mapped_type(target)
                    }
                {
                    return Ternary::TRUE;
                }
                if !c.is_generic_mapped_type(source) {
                    // If target has shape `{ [P in Q as R]: T}`, then its keys have type `R`. If target has shape `{ [P in Q]: T }`, then its keys have type `Q`.
                    let target_keys = if keys_remapped {
                        c.get_name_type_from_mapped_type(target)
                    } else {
                        c.get_constraint_type_from_mapped_type(target)
                    };
                    // Type of the keys of source type `S`, i.e. `keyof S`.
                    let source_keys = c.get_index_type_ex(source, IndexFlags::NO_INDEX_SIGNATURES);
                    let include_optional =
                        modifiers.intersects(MappedTypeModifiers::INCLUDE_OPTIONAL);
                    let mut filtered_by_applicability = TypeId::NIL;
                    if include_optional {
                        filtered_by_applicability = c.intersect_types(target_keys, source_keys);
                    }
                    // A source type `S` is related to a target type `{ [P in Q]: T }` if `Q` is related to `keyof S` and `S[Q]` is related to `T`. A source type `S` is related to a target type `{ [P in Q as R]: T }` if `R` is related to `keyof S` and `S[R]` is related to `T. A source type `S` is related to a target type `{ [P in Q]?: T }` if some constituent `Q'` of `Q` is related to `keyof S` and `S[Q']` is related to `T`. A source type `S` is related to a target type `{ [P in Q as R]?: T }` if some constituent `R'` of `R` is related to `keyof S` and `S[R']` is related to `T`.
                    if include_optional
                        && !c.types[filtered_by_applicability]
                            .flags
                            .intersects(TypeFlags::NEVER)
                        || !include_optional
                            && r.is_related_to(
                                c,
                                target_keys,
                                source_keys,
                                RecursionFlags::BOTH,
                                false,
                            ) != Ternary::FALSE
                    {
                        let template_type = c.get_template_type_from_mapped_type(target);
                        let type_parameter = c.get_type_parameter_from_mapped_type(target);
                        // Fastpath: When the template type has the form `Obj[P]` where `P` is the mapped type parameter, directly compare source `S` with `Obj` to avoid creating the (potentially very large) number of new intermediate types made by manufacturing `S[P]`.
                        let non_null_component = c.extract_types_of_kind(
                            template_type,
                            TypeFlags(!TypeFlags::NULLABLE.0),
                        );
                        if !keys_remapped
                            && c.types[non_null_component]
                                .flags
                                .intersects(TypeFlags::INDEXED_ACCESS)
                            && c.as_indexed_access_type(non_null_component).index_type
                                == type_parameter
                        {
                            let object_type =
                                c.as_indexed_access_type(non_null_component).object_type;
                            st.result = r.is_related_to(
                                c,
                                source,
                                object_type,
                                RecursionFlags::TARGET,
                                report_errors,
                            );
                            if st.result != Ternary::FALSE {
                                return st.result;
                            }
                        } else {
                            // We need to compare the type of a property on the source type `S` to the type of the same property on the target type, so we need to construct an indexing type representing a property, and then use indexing type to index the source type for comparison. If the target type has shape `{ [P in Q]: T }`, then a property of the target has type `P`. If the target type has shape `{ [P in Q]?: T }`, then a property of the target has type `P`, but the property is optional, so we only want to compare properties `P` that are common between `keyof S` and `Q`. If the target type has shape `{ [P in Q as R]: T }`, then a property of the target has type `R`. If the target type has shape `{ [P in Q as R]?: T }`, then a property of the target has type `R`, but the property is optional, so we only want to compare properties `R` that are common between `keyof S` and `R`.
                            let mut indexing_type = type_parameter;
                            if keys_remapped {
                                indexing_type = if !filtered_by_applicability.is_nil() {
                                    filtered_by_applicability
                                } else {
                                    target_keys
                                };
                            } else if !filtered_by_applicability.is_nil() {
                                indexing_type = c.get_intersection_type(List::from_slice(&[
                                    filtered_by_applicability,
                                    type_parameter,
                                ]));
                            }
                            let indexed_access_type =
                                c.get_indexed_access_type(source, indexing_type);
                            // Compare `S[indexingType]` to `T`, where `T` is the type of a property of the target type.
                            st.result = r.is_related_to(
                                c,
                                indexed_access_type,
                                template_type,
                                RecursionFlags::BOTH,
                                report_errors,
                            );
                            if st.result != Ternary::FALSE {
                                return st.result;
                            }
                        }
                    }
                    st.original_error_chain = c.relaters[r].error_chain;
                    r.restore_error_state(c, st.save_error_state);
                }
            }
        }
        if source_flags.intersects(TypeFlags::TYPE_VARIABLE) {
            // IndexedAccess comparisons are handled above in the `target.flags&TypeFlagsIndexedAccess` branch
            if !source_flags.intersects(TypeFlags::INDEXED_ACCESS)
                || !target_flags.intersects(TypeFlags::INDEXED_ACCESS)
            {
                let mut constraint = c.get_constraint_of_type(source);
                if constraint.is_nil() {
                    constraint = c.unknown_type;
                }
                // hi-speed no-this-instantiation check (less accurate, but avoids costly `this`-instantiation when the constraint will suffice)
                st.result = r.is_related_to_ex(
                    c,
                    constraint,
                    target,
                    RecursionFlags::SOURCE,
                    false,
                    MessageId::NIL,
                    intersection_state,
                );
                if st.result != Ternary::FALSE {
                    return st.result;
                }
                let constraint_with_this = c.get_type_with_this_argument(constraint, source, false);
                let report_constraint_errors = report_errors
                    && constraint != c.unknown_type
                    && !(target_flags & source_flags).intersects(TypeFlags::TYPE_PARAMETER);
                st.result = r.is_related_to_ex(
                    c,
                    constraint_with_this,
                    target,
                    RecursionFlags::SOURCE,
                    report_constraint_errors,
                    MessageId::NIL,
                    intersection_state,
                );
                if st.result != Ternary::FALSE {
                    return st.result;
                }
                if c.is_mapped_type_generic_indexed_access(source) {
                    // For an indexed access type { [P in K]: E}[X], above we have already explored an instantiation of E with X substituted for P. We also want to explore type { [P in K]: E }[C], where C is the constraint of X.
                    let index_type = c.as_indexed_access_type(source).index_type;
                    let index_constraint = c.get_constraint_of_type(index_type);
                    if !index_constraint.is_nil() {
                        let object_type = c.as_indexed_access_type(source).object_type;
                        let indexed_access_type =
                            c.get_indexed_access_type(object_type, index_constraint);
                        st.result = r.is_related_to(
                            c,
                            indexed_access_type,
                            target,
                            RecursionFlags::SOURCE,
                            report_errors,
                        );
                        if st.result != Ternary::FALSE {
                            return st.result;
                        }
                    }
                }
            }
        } else if source_flags.intersects(TypeFlags::INDEX) {
            let index_target = c.as_index_type(source).target;
            let index_flags = c.as_index_type(source).index_flags;
            let is_deferred_mapped_index = c.should_defer_index_type(index_target, index_flags)
                && c.types[index_target]
                    .object_flags
                    .intersects(ObjectFlags::MAPPED);
            let string_number_symbol_type = c.string_number_symbol_type;
            st.result = r.is_related_to(
                c,
                string_number_symbol_type,
                target,
                RecursionFlags::SOURCE,
                report_errors && !is_deferred_mapped_index,
            );
            if st.result != Ternary::FALSE {
                return st.result;
            }
            if is_deferred_mapped_index {
                let mapped_type = index_target;
                let name_type = c.get_name_type_from_mapped_type(mapped_type);
                // Unlike on the target side, on the source side we do *not* include the generic part of the `nameType`, since that comes from a (potentially anonymous) mapped type local type parameter, so that'd never assign outside the mapped type body, but we still want to allow assignments of index types of identical (or similar enough) mapped types. eg, `keyof {[X in keyof A]: Obj[X]}` should be assignable to `keyof {[Y in keyof A]: Tup[Y]}` because both map over the same set of keys (`keyof A`). Without this source-side breakdown, a `keyof {[X in keyof A]: Obj[X]}` style type won't be assignable to anything except itself, which is much too strict.
                let source_mapped_keys;
                if !name_type.is_nil()
                    && c.is_mapped_type_with_keyof_constraint_declaration(mapped_type)
                {
                    source_mapped_keys = c.get_apparent_mapped_type_keys(name_type, mapped_type);
                } else if !name_type.is_nil() {
                    source_mapped_keys = name_type;
                } else {
                    source_mapped_keys = c.get_constraint_type_from_mapped_type(mapped_type);
                }
                st.result = r.is_related_to(
                    c,
                    source_mapped_keys,
                    target,
                    RecursionFlags::SOURCE,
                    report_errors,
                );
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            }
        } else if source_flags.intersects(TypeFlags::CONDITIONAL) {
            // If we reach 10 levels of nesting for the same conditional type, assume it is an infinitely expanding recursive conditional type and bail out with a Ternary.Maybe result.
            let stack = std::mem::take(&mut c.relaters[r].source_stack);
            let deeply_nested = c.is_deeply_nested_type(source, &stack, 10);
            c.relaters[r].source_stack = stack;
            if deeply_nested {
                return Ternary::MAYBE;
            }
            if target_flags.intersects(TypeFlags::CONDITIONAL) {
                // Two conditional types 'T1 extends U1 ? X1 : Y1' and 'T2 extends U2 ? X2 : Y2' are related if one of T1 and T2 is related to the other, U1 and U2 are identical types, X1 is related to X2, and Y1 is related to Y2.
                let source_root = c.as_conditional_type(source).root;
                let source_params = c.conditional_roots[source_root].infer_type_parameters;
                let mut source_extends = c.as_conditional_type(source).extends_type;
                let target_extends = c.as_conditional_type(target).extends_type;
                let mut mapper = TypeMapperId::NIL;
                if source_params.len() != 0 {
                    // If the source has infer type parameters, we instantiate them in the context of the target
                    let ctx = c.new_inference_context(
                        source_params,
                        SignatureId::NIL,
                        InferenceFlags::NONE,
                        TypeComparer::Relater {
                            r,
                            intersection_state: IntersectionState::NONE,
                        },
                    );
                    let inferences = c.inference_contexts[ctx].inferences;
                    c.infer_types(
                        inferences,
                        target_extends,
                        source_extends,
                        InferencePriority::NO_CONSTRAINTS | InferencePriority::ALWAYS_STRICT,
                        false,
                    );
                    let context_mapper = c.inference_contexts[ctx].mapper;
                    source_extends = c.instantiate_type(source_extends, context_mapper);
                    mapper = c.inference_contexts[ctx].mapper;
                }
                if c.is_type_identical_to(source_extends, target_extends) {
                    let source_check_type = c.as_conditional_type(source).check_type;
                    let target_check_type = c.as_conditional_type(target).check_type;
                    if r.is_related_to(
                        c,
                        source_check_type,
                        target_check_type,
                        RecursionFlags::BOTH,
                        false,
                    ) != Ternary::FALSE
                        || r.is_related_to(
                            c,
                            target_check_type,
                            source_check_type,
                            RecursionFlags::BOTH,
                            false,
                        ) != Ternary::FALSE
                    {
                        let source_true_type = c.get_true_type_from_conditional_type(source);
                        let source_true_type = c.instantiate_type(source_true_type, mapper);
                        let target_true_type = c.get_true_type_from_conditional_type(target);
                        st.result = r.is_related_to(
                            c,
                            source_true_type,
                            target_true_type,
                            RecursionFlags::BOTH,
                            report_errors,
                        );
                        if st.result != Ternary::FALSE {
                            let source_false_type = c.get_false_type_from_conditional_type(source);
                            let target_false_type = c.get_false_type_from_conditional_type(target);
                            st.result &= r.is_related_to(
                                c,
                                source_false_type,
                                target_false_type,
                                RecursionFlags::BOTH,
                                report_errors,
                            );
                        }
                        if st.result != Ternary::FALSE {
                            return st.result;
                        }
                    }
                }
            }
            // conditionals can be related to one another via normal constraint, as, eg, `A extends B ? O : never` should be assignable to `O` when `O` is a conditional (`never` is trivially assignable to `O`, as is `O`!).
            let default_constraint = c.get_default_constraint_of_conditional_type(source);
            if !default_constraint.is_nil() {
                st.result = r.is_related_to(
                    c,
                    default_constraint,
                    target,
                    RecursionFlags::SOURCE,
                    report_errors,
                );
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            }
            // conditionals aren't related to one another via distributive constraint as it is much too inaccurate and allows way more assignments than are desirable (since it maps the source check type to its constraint, it loses information).
            if !target_flags.intersects(TypeFlags::CONDITIONAL)
                && c.has_non_circular_base_constraint(source)
            {
                let distributive_constraint =
                    c.get_constraint_of_distributive_conditional_type(source);
                if !distributive_constraint.is_nil() {
                    r.restore_error_state(c, st.save_error_state);
                    st.result = r.is_related_to(
                        c,
                        distributive_constraint,
                        target,
                        RecursionFlags::SOURCE,
                        report_errors,
                    );
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            }
        } else if source_flags.intersects(TypeFlags::TEMPLATE_LITERAL)
            && !target_flags.intersects(TypeFlags::OBJECT)
        {
            if !target_flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                let constraint = c.get_base_constraint_of_type(source);
                if !constraint.is_nil() && constraint != source {
                    st.result = r.is_related_to(
                        c,
                        constraint,
                        target,
                        RecursionFlags::SOURCE,
                        report_errors,
                    );
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            }
        } else if source_flags.intersects(TypeFlags::STRING_MAPPING) {
            if target_flags.intersects(TypeFlags::STRING_MAPPING) {
                if c.types[source].symbol != c.types[target].symbol {
                    return Ternary::FALSE;
                }
                let source_target = c.as_string_mapping_type(source).target;
                let target_target = c.as_string_mapping_type(target).target;
                st.result = r.is_related_to(
                    c,
                    source_target,
                    target_target,
                    RecursionFlags::BOTH,
                    report_errors,
                );
                if st.result != Ternary::FALSE {
                    return st.result;
                }
            } else {
                let constraint = c.get_base_constraint_of_type(source);
                if !constraint.is_nil() {
                    st.result = r.is_related_to(
                        c,
                        constraint,
                        target,
                        RecursionFlags::SOURCE,
                        report_errors,
                    );
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
            }
        } else {
            // An empty object type is related to any mapped type that includes a '?' modifier.
            if relation != RelationKind::Subtype
                && relation != RelationKind::StrictSubtype
                && is_partial_mapped_type(c, target)
                && c.is_empty_object_type(source)
            {
                return Ternary::TRUE;
            }
            if c.is_generic_mapped_type(target) {
                if c.is_generic_mapped_type(source) {
                    st.result = r.mapped_type_related_to(c, source, target, report_errors);
                    if st.result != Ternary::FALSE {
                        return st.result;
                    }
                }
                return Ternary::FALSE;
            }
            let source_is_primitive = source_flags.intersects(TypeFlags::PRIMITIVE);
            if relation != RelationKind::Identity {
                source = c.get_apparent_type(source);
            } else if c.is_generic_mapped_type(source) {
                return Ternary::FALSE;
            }
            if c.types[source]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
                && c.types[target]
                    .object_flags
                    .intersects(ObjectFlags::REFERENCE)
                && c.type_target(source) == c.type_target(target)
                && !is_tuple_type(c, source)
                && !c.is_marker_type(source)
                && !c.is_marker_type(target)
            {
                // When strictNullChecks is disabled, the element type of the empty array literal is undefinedWideningType, and an empty array literal wouldn't be assignable to a `never[]` without this check.
                if c.is_empty_array_literal_type(source) {
                    return Ternary::TRUE;
                }
                // We have type references to the same generic type, and the type references are not marker type references (which are intended by be compared structurally). Obtain the variance information for the type parameters and relate the type arguments accordingly.
                let source_target = c.type_target(source);
                let variances = c.get_variances(source_target);
                // We return Ternary.Maybe for a recursive invocation of getVariances (signaled by emptyArray). This effectively means we measure variance only from type parameter occurrences that aren't nested in recursive instantiations of the generic type.
                if variances.len() == 0 {
                    return Ternary::UNKNOWN;
                }
                let source_type_arguments = c.get_type_arguments(source);
                let target_type_arguments = c.get_type_arguments(target);
                let (variance_result, ok) = r.relate_variances(
                    c,
                    &mut st,
                    source_type_arguments,
                    target_type_arguments,
                    variances,
                    intersection_state,
                );
                if ok {
                    return variance_result;
                }
            } else if c.is_array_type(target)
                && (c.is_readonly_array_type(target)
                    && every_type(c, source, &mut |c, t| c.is_array_or_tuple_type(t))
                    || every_type(c, source, &mut |c, t| is_mutable_tuple_type(c, t)))
            {
                if relation != RelationKind::Identity {
                    let source_element =
                        c.get_index_type_of_type_ex(source, c.number_type, c.any_type);
                    let target_element =
                        c.get_index_type_of_type_ex(target, c.number_type, c.any_type);
                    return r.is_related_to(
                        c,
                        source_element,
                        target_element,
                        RecursionFlags::BOTH,
                        report_errors,
                    );
                }
                // By flags alone, we know that the `target` is a readonly array while the source is a normal array or tuple or `target` is an array and source is a tuple - in both cases the types cannot be identical, by construction
                return Ternary::FALSE;
            } else if is_generic_tuple_type(c, source)
                && is_tuple_type(c, target)
                && !is_generic_tuple_type(c, target)
            {
                let constraint = c.get_base_constraint_or_type(source);
                if constraint != source {
                    return r.is_related_to(
                        c,
                        constraint,
                        target,
                        RecursionFlags::SOURCE,
                        report_errors,
                    );
                }
            } else if (relation == RelationKind::Subtype || relation == RelationKind::StrictSubtype)
                && c.is_empty_object_type(target)
                && c.types[target]
                    .object_flags
                    .intersects(ObjectFlags::FRESH_LITERAL)
                && !c.is_empty_object_type(source)
            {
                return Ternary::FALSE;
            }
            // Even if relationship doesn't hold for unions, intersections, or generic type references, it may hold in a structural comparison. In a check of the form X = A & B, we will have previously checked if A relates to X or B relates to X. Failing both of those we want to check if the aggregation of A and B's members structurally relates to X. Thus, we include intersection types on the source side here.
            if c.types[source]
                .flags
                .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && target_flags.intersects(TypeFlags::OBJECT)
            {
                // Report structural errors only if we haven't reported any errors yet
                let report_structural_errors = report_errors
                    && c.relaters[r].error_chain == st.save_error_state.error_chain
                    && !source_is_primitive;
                st.result = r.properties_related_to(
                    c,
                    source,
                    target,
                    report_structural_errors,
                    &Set::default(),
                    false,
                    intersection_state,
                );
                if st.result != Ternary::FALSE {
                    st.result &= r.signatures_related_to(
                        c,
                        source,
                        target,
                        SignatureKind::CALL,
                        report_structural_errors,
                        intersection_state,
                    );
                    if st.result != Ternary::FALSE {
                        st.result &= r.signatures_related_to(
                            c,
                            source,
                            target,
                            SignatureKind::CONSTRUCT,
                            report_structural_errors,
                            intersection_state,
                        );
                        if st.result != Ternary::FALSE {
                            st.result &= r.index_signatures_related_to(
                                c,
                                source,
                                target,
                                source_is_primitive,
                                report_structural_errors,
                                intersection_state,
                            );
                        }
                    }
                }
                if st.result != Ternary::FALSE {
                    if !st.variance_check_failed {
                        return st.result;
                    }
                    // Use variance error (there is no structural one) and return false
                    if !st.original_error_chain.is_nil() {
                        c.relaters[r].error_chain = st.original_error_chain;
                    } else if c.relaters[r].error_chain.is_nil() {
                        c.relaters[r].error_chain = st.save_error_state.error_chain;
                    }
                }
            }
            // If S is an object type and T is a discriminated union, S may be related to T if there exists a constituent of T for every combination of the discriminants of S with respect to T. We do not report errors here, as we will use the existing error result from checking each constituent of the union.
            if c.types[source]
                .flags
                .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION)
                && target_flags.intersects(TypeFlags::UNION)
            {
                let object_only_target = c.extract_types_of_kind(
                    target,
                    TypeFlags::OBJECT | TypeFlags::INTERSECTION | TypeFlags::SUBSTITUTION,
                );
                if c.types[object_only_target]
                    .flags
                    .intersects(TypeFlags::UNION)
                {
                    let result =
                        r.type_related_to_discriminated_type(c, source, object_only_target);
                    if result != Ternary::FALSE {
                        return result;
                    }
                }
            }
        }
        Ternary::FALSE
    }

    pub fn type_arguments_related_to<'a>(
        self,
        c: &mut Checker<'a>,
        sources: List<'a, TypeId>,
        targets: List<'a, TypeId>,
        variances: List<'a, VarianceFlags>,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        if sources.len() != targets.len() && relation == RelationKind::Identity {
            return Ternary::FALSE;
        }
        let length = sources.len().min(targets.len());
        let mut result = Ternary::TRUE;
        let mut i: isize = 0;
        while i < length {
            // When variance information isn't available we default to covariance. This happens in the process of computing variance information for recursive types and when comparing 'this' type arguments.
            let mut variance_flags = VarianceFlags::COVARIANT;
            if i < variances.len() {
                variance_flags = variances.at(i);
            }
            let variance = variance_flags & VarianceFlags::VARIANCE_MASK;
            // We ignore arguments for independent type parameters (because they're never witnessed).
            if variance != VarianceFlags::INDEPENDENT {
                let s = sources.at(i);
                let t = targets.at(i);
                let mut related;
                if variance_flags.intersects(VarianceFlags::UNMEASURABLE) {
                    // Even an `Unmeasurable` variance works out without a structural check if the source and target are _identical_. We can't simply assume invariance, because `Unmeasurable` marks nonlinear relations, for example, a relation tainted by the `-?` modifier in a mapped type (where, no matter how the inputs are related, the outputs still might not be)
                    if relation == RelationKind::Identity {
                        related = r.is_related_to(c, s, t, RecursionFlags::BOTH, false);
                    } else {
                        related = c.compare_types_identical(s, t);
                    }
                } else {
                    // Propagate unreliable variance flag in variance computations
                    if !c.variance_stack.is_empty()
                        && variance_flags.intersects(VarianceFlags::UNRELIABLE)
                    {
                        c.instantiate_type(s, c.report_unreliable_mapper);
                    }
                    if variance == VarianceFlags::COVARIANT {
                        related = r.is_related_to_ex(
                            c,
                            s,
                            t,
                            RecursionFlags::BOTH,
                            report_errors,
                            MessageId::NIL,
                            intersection_state,
                        );
                    } else if variance == VarianceFlags::CONTRAVARIANT {
                        related = r.is_related_to_ex(
                            c,
                            t,
                            s,
                            RecursionFlags::BOTH,
                            report_errors,
                            MessageId::NIL,
                            intersection_state,
                        );
                    } else if variance == VarianceFlags::BIVARIANT {
                        // In the bivariant case we first compare contravariantly without reporting errors. Then, if that doesn't succeed, we compare covariantly with error reporting. Thus, error elaboration will be based on the covariant check, which is generally easier to reason about.
                        related = r.is_related_to(c, t, s, RecursionFlags::BOTH, false);
                        if related == Ternary::FALSE {
                            related = r.is_related_to_ex(
                                c,
                                s,
                                t,
                                RecursionFlags::BOTH,
                                report_errors,
                                MessageId::NIL,
                                intersection_state,
                            );
                        }
                    } else {
                        // In the invariant case we first compare covariantly, and only when that succeeds do we proceed to compare contravariantly. Thus, error elaboration will typically be based on the covariant check.
                        related = r.is_related_to_ex(
                            c,
                            s,
                            t,
                            RecursionFlags::BOTH,
                            report_errors,
                            MessageId::NIL,
                            intersection_state,
                        );
                        if related != Ternary::FALSE {
                            related &= r.is_related_to_ex(
                                c,
                                t,
                                s,
                                RecursionFlags::BOTH,
                                report_errors,
                                MessageId::NIL,
                                intersection_state,
                            );
                        }
                    }
                }
                if related == Ternary::FALSE {
                    return Ternary::FALSE;
                }
                result &= related;
            }
            i += 1;
        }
        result
    }

    // A type [P in S]: X is related to a type [Q in T]: Y if T is related to S and X' is related to Y, where X' is an instantiation of X in which P is replaced with Q. Notice that S and T are contra-variant whereas X and Y are co-variant.
    pub fn mapped_type_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        let modifiers_related = relation == RelationKind::Comparable
            || relation == RelationKind::Identity
                && get_mapped_type_modifiers(c, source) == get_mapped_type_modifiers(c, target)
            || relation != RelationKind::Identity
                && c.get_combined_mapped_type_optionality(source)
                    <= c.get_combined_mapped_type_optionality(target);
        if modifiers_related {
            let target_constraint = c.get_constraint_type_from_mapped_type(target);
            let source_constraint_type = c.get_constraint_type_from_mapped_type(source);
            let report_mapper = if c.get_combined_mapped_type_optionality(source) < 0 {
                c.report_unmeasurable_mapper
            } else {
                c.report_unreliable_mapper
            };
            let source_constraint = c.instantiate_type(source_constraint_type, report_mapper);
            let result = r.is_related_to(
                c,
                target_constraint,
                source_constraint,
                RecursionFlags::BOTH,
                report_errors,
            );
            if result != Ternary::FALSE {
                let source_type_parameter = c.get_type_parameter_from_mapped_type(source);
                let target_type_parameter = c.get_type_parameter_from_mapped_type(target);
                let mapper =
                    new_simple_type_mapper(c, source_type_parameter, target_type_parameter);
                let source_name_type = c.get_name_type_from_mapped_type(source);
                let source_name_type = c.instantiate_type(source_name_type, mapper);
                let target_name_type = c.get_name_type_from_mapped_type(target);
                let target_name_type = c.instantiate_type(target_name_type, mapper);
                if source_name_type == target_name_type {
                    let source_template_type = c.get_template_type_from_mapped_type(source);
                    let source_template_type = c.instantiate_type(source_template_type, mapper);
                    let target_template_type = c.get_template_type_from_mapped_type(target);
                    return result
                        & r.is_related_to(
                            c,
                            source_template_type,
                            target_template_type,
                            RecursionFlags::BOTH,
                            report_errors,
                        );
                }
            }
        }
        Ternary::FALSE
    }

    pub fn type_related_to_discriminated_type<'a>(
        self,
        c: &mut Checker<'a>,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let r = self;
        // 1. Generate the combinations of discriminant properties & types 'source' can satisfy. a. If the number of combinations is above a set limit, the comparison is too complex. 2. Filter 'target' to the subset of types whose discriminants exist in the matrix. a. If 'target' does not satisfy all discriminants in the matrix, 'source' is not related. 3. For each type in the filtered 'target', determine if all non-discriminant properties of 'target' are related to a property in 'source'.
        let source_properties = c.get_properties_of_type(source);
        let source_properties_filtered = c.find_discriminant_properties(source_properties, target);
        if source_properties_filtered.len() == 0 {
            return Ternary::FALSE;
        }
        // Though we could compute the number of combinations as we generate the matrix, this would incur additional memory overhead due to array allocations. To reduce this overhead, we first compute the number of combinations to ensure we will not surpass our fixed limit before incurring the cost of any allocations:
        let mut num_combinations: isize = 1;
        for &source_property in source_properties_filtered.as_slice() {
            let source_property_type = c.get_non_missing_type_of_symbol(source_property);
            num_combinations *= count_types(c, source_property_type);
            if num_combinations > 25 {
                return Ternary::FALSE;
            }
            if num_combinations == 0 {
                return Ternary::FALSE;
            }
        }
        // Compute the set of types for each discriminant property.
        let mut source_discriminant_types: Vec<List<'a, TypeId>> = Vec::new();
        let mut excluded_properties: Set<Text<'a>> = Set::default();
        for &source_property in source_properties_filtered.as_slice() {
            let source_property_type = c.get_non_missing_type_of_symbol(source_property);
            source_discriminant_types.push(c.type_distributed(source_property_type));
            excluded_properties.add(c.ast.sym(source_property).name);
        }
        // Build the cartesian product
        let mut discriminant_combinations: Vec<Vec<TypeId>> = Vec::new();
        let mut i: isize = 0;
        while i < num_combinations {
            let mut combination: Vec<TypeId> = vec![TypeId::NIL; source_discriminant_types.len()];
            let mut n = i;
            for (j, source_types) in source_discriminant_types.iter().enumerate().rev() {
                let length = source_types.len();
                if let Some(slot) = combination.get_mut(j) {
                    *slot = source_types.at(n.checked_rem(length).unwrap_or(0));
                }
                n = n.checked_div(length).unwrap_or(0);
            }
            discriminant_combinations.push(combination);
            i += 1;
        }
        // Match each combination of the cartesian product of discriminant properties to one or more constituents of 'target'. If any combination does not have a match then 'source' is not relatable.
        let mut matching_types: Vec<TypeId> = Vec::new();
        let target_types = c.type_types(target);
        let skip_optional =
            c.strict_null_checks || c.relaters[r].relation == RelationKind::Comparable;
        for combination in &discriminant_combinations {
            let mut has_match = false;
            'outer: for &t in target_types.as_slice() {
                for (i, &source_property) in
                    source_properties_filtered.as_slice().iter().enumerate()
                {
                    let source_property_name = c.ast.sym(source_property).name;
                    let target_property = c.get_property_of_type(t, source_property_name);
                    if target_property.is_nil() {
                        continue 'outer;
                    }
                    if source_property == target_property {
                        continue;
                    }
                    // We compare the source property to the target in the context of a single discriminant type.
                    let combination_type = combination.get(i).copied().unwrap_or_default();
                    let related = r.property_related_to(
                        c,
                        source,
                        target,
                        source_property,
                        target_property,
                        &mut |_, _| combination_type,
                        false,
                        IntersectionState::NONE,
                        skip_optional,
                    );
                    // If the target property could not be found, or if the properties were not related, then this constituent is not a match.
                    if related == Ternary::FALSE {
                        continue 'outer;
                    }
                }
                if !matching_types.contains(&t) {
                    matching_types.push(t);
                }
                has_match = true;
            }
            if !has_match {
                // We failed to match any type for this combination.
                return Ternary::FALSE;
            }
        }
        // Compare the remaining non-discriminant properties of each match.
        let mut result = Ternary::TRUE;
        for &t in &matching_types {
            result &= r.properties_related_to(
                c,
                source,
                t,
                false,
                &excluded_properties,
                false,
                IntersectionState::NONE,
            );
            if result != Ternary::FALSE {
                result &= r.signatures_related_to(
                    c,
                    source,
                    t,
                    SignatureKind::CALL,
                    false,
                    IntersectionState::NONE,
                );
                if result != Ternary::FALSE {
                    result &= r.signatures_related_to(
                        c,
                        source,
                        t,
                        SignatureKind::CONSTRUCT,
                        false,
                        IntersectionState::NONE,
                    );
                    if result != Ternary::FALSE
                        && !(is_tuple_type(c, source) && is_tuple_type(c, t))
                    {
                        // Comparing numeric index types when both `source` and `type` are tuples is unnecessary as the element types should be sufficiently covered by `propertiesRelatedTo`. It also causes problems with index type assignability as the types for the excluded discriminants are still included in the index type.
                        result &= r.index_signatures_related_to(
                            c,
                            source,
                            t,
                            false,
                            false,
                            IntersectionState::NONE,
                        );
                    }
                }
            }
            if result == Ternary::FALSE {
                return result;
            }
        }
        result
    }

    pub fn properties_related_to<'a>(
        self,
        c: &mut Checker<'a>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        excluded_properties: &Set<Text<'a>>,
        optionals_only: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        if relation == RelationKind::Identity {
            return r.properties_identical_to(c, source, target, excluded_properties);
        }
        let mut result = Ternary::TRUE;
        if is_tuple_type(c, target) {
            if c.is_array_or_tuple_type(source) {
                if !c.type_target_tuple_type(target).readonly
                    && (c.is_readonly_array_type(source)
                        || is_tuple_type(c, source) && c.type_target_tuple_type(source).readonly)
                {
                    return Ternary::FALSE;
                }
                let source_arity = c.get_type_reference_arity(source);
                let target_arity = c.get_type_reference_arity(target);
                let source_rest = if is_tuple_type(c, source) {
                    c.type_target_tuple_type(source)
                        .combined_flags
                        .intersects(ElementFlags::REST)
                } else {
                    true
                };
                let target_combined_flags = c.type_target_tuple_type(target).combined_flags;
                let target_has_rest_element = target_combined_flags.intersects(ElementFlags::REST);
                let target_has_variable_element =
                    target_combined_flags.intersects(ElementFlags::VARIABLE);
                let source_min_length = if is_tuple_type(c, source) {
                    c.type_target_tuple_type(source).min_length
                } else {
                    0
                };
                let target_min_length = c.type_target_tuple_type(target).min_length;
                if !source_rest && source_arity < target_min_length {
                    if report_errors {
                        r.report_error(
                            c,
                            diagnostics::SOURCE_HAS_0_ELEMENT_S_BUT_TARGET_REQUIRES_1,
                            &[
                                Arg::Int(source_arity as i64),
                                Arg::Int(target_min_length as i64),
                            ],
                        );
                    }
                    return Ternary::FALSE;
                }
                if !target_has_variable_element && target_arity < source_min_length {
                    if report_errors {
                        r.report_error(
                            c,
                            diagnostics::SOURCE_HAS_0_ELEMENT_S_BUT_TARGET_ALLOWS_ONLY_1,
                            &[
                                Arg::Int(source_min_length as i64),
                                Arg::Int(target_arity as i64),
                            ],
                        );
                    }
                    return Ternary::FALSE;
                }
                if !target_has_variable_element && (source_rest || target_arity < source_arity) {
                    if report_errors {
                        if source_min_length < target_min_length {
                            r.report_error(
                                c,
                                diagnostics::TARGET_REQUIRES_0_ELEMENT_S_BUT_SOURCE_MAY_HAVE_FEWER,
                                &[Arg::Int(target_min_length as i64)],
                            );
                        } else {
                            r.report_error(
                                c,
                                diagnostics::TARGET_ALLOWS_ONLY_0_ELEMENT_S_BUT_SOURCE_MAY_HAVE_MORE,
                                &[Arg::Int(target_arity as i64)],
                            );
                        }
                    }
                    return Ternary::FALSE;
                }
                let source_type_arguments = c.get_type_arguments(source);
                let target_type_arguments = c.get_type_arguments(target);
                let target_start_count = get_start_element_count(
                    c.type_target_tuple_type(target),
                    ElementFlags::NON_REST,
                );
                let target_end_count =
                    get_end_element_count(c.type_target_tuple_type(target), ElementFlags::NON_REST);
                let mut can_exclude_discriminants = excluded_properties.len() != 0;
                for source_position in 0..source_arity {
                    let source_flags = if is_tuple_type(c, source) {
                        c.type_target_tuple_type(source)
                            .element_infos
                            .at(source_position)
                            .flags
                    } else {
                        ElementFlags::REST
                    };
                    let source_position_from_end = source_arity - 1 - source_position;
                    let target_position;
                    if target_has_rest_element && source_position >= target_start_count {
                        target_position =
                            target_arity - 1 - source_position_from_end.min(target_end_count);
                    } else {
                        if source_position >= target_arity {
                            if report_errors {
                                r.report_error(
                                    c,
                                    diagnostics::TARGET_ALLOWS_ONLY_0_ELEMENT_S_BUT_SOURCE_MAY_HAVE_MORE,
                                    &[Arg::Int(target_arity as i64)],
                                );
                            }
                            return Ternary::FALSE;
                        }
                        target_position = source_position;
                    }
                    let mut target_flags = ElementFlags::NONE;
                    if target_position >= 0 {
                        target_flags = c
                            .type_target_tuple_type(target)
                            .element_infos
                            .at(target_position)
                            .flags;
                    }
                    if target_flags.intersects(ElementFlags::VARIADIC)
                        && !source_flags.intersects(ElementFlags::VARIADIC)
                    {
                        if report_errors {
                            r.report_error(
                                c,
                                diagnostics::SOURCE_PROVIDES_NO_MATCH_FOR_VARIADIC_ELEMENT_AT_POSITION_0_IN_TARGET,
                                &[Arg::Int(target_position as i64)],
                            );
                        }
                        return Ternary::FALSE;
                    }
                    if source_flags.intersects(ElementFlags::VARIADIC)
                        && !target_flags.intersects(ElementFlags::VARIABLE)
                    {
                        if report_errors {
                            r.report_error(
                                c,
                                diagnostics::VARIADIC_ELEMENT_AT_POSITION_0_IN_SOURCE_DOES_NOT_MATCH_ELEMENT_AT_POSITION_1_IN_TARGET,
                                &[
                                    Arg::Int(source_position as i64),
                                    Arg::Int(target_position as i64),
                                ],
                            );
                        }
                        return Ternary::FALSE;
                    }
                    if target_flags.intersects(ElementFlags::REQUIRED)
                        && !source_flags.intersects(ElementFlags::REQUIRED)
                    {
                        if report_errors {
                            r.report_error(
                                c,
                                diagnostics::SOURCE_PROVIDES_NO_MATCH_FOR_REQUIRED_ELEMENT_AT_POSITION_0_IN_TARGET,
                                &[Arg::Int(target_position as i64)],
                            );
                        }
                        return Ternary::FALSE;
                    }
                    // We can only exclude discriminant properties if we have not yet encountered a variable-length element.
                    if can_exclude_discriminants {
                        if source_flags.intersects(ElementFlags::VARIABLE)
                            || target_flags.intersects(ElementFlags::VARIABLE)
                        {
                            can_exclude_discriminants = false;
                        }
                        if can_exclude_discriminants {
                            let position_name = c.text(&itoa(source_position));
                            if excluded_properties.has(&position_name) {
                                continue;
                            }
                        }
                    }
                    let source_type = c.remove_missing_type(
                        source_type_arguments.at(source_position),
                        (source_flags & target_flags).intersects(ElementFlags::OPTIONAL),
                    );
                    let target_type = target_type_arguments.at(target_position);
                    let target_check_type = if source_flags.intersects(ElementFlags::VARIADIC)
                        && target_flags.intersects(ElementFlags::REST)
                    {
                        c.create_array_type(target_type)
                    } else {
                        c.remove_missing_type(
                            target_type,
                            target_flags.intersects(ElementFlags::OPTIONAL),
                        )
                    };
                    let related = r.is_related_to_ex(
                        c,
                        source_type,
                        target_check_type,
                        RecursionFlags::BOTH,
                        report_errors,
                        MessageId::NIL,
                        intersection_state,
                    );
                    if related == Ternary::FALSE {
                        if report_errors && (target_arity > 1 || source_arity > 1) {
                            if target_has_rest_element
                                && source_position >= target_start_count
                                && source_position_from_end >= target_end_count
                                && target_start_count != source_arity - target_end_count - 1
                            {
                                r.report_error(
                                    c,
                                    diagnostics::TYPE_AT_POSITIONS_0_THROUGH_1_IN_SOURCE_IS_NOT_COMPATIBLE_WITH_TYPE_AT_POSITION_2_IN_TARGET,
                                    &[
                                        Arg::Int(target_start_count as i64),
                                        Arg::Int((source_arity - target_end_count - 1) as i64),
                                        Arg::Int(target_position as i64),
                                    ],
                                );
                            } else {
                                r.report_error(
                                    c,
                                    diagnostics::TYPE_AT_POSITION_0_IN_SOURCE_IS_NOT_COMPATIBLE_WITH_TYPE_AT_POSITION_1_IN_TARGET,
                                    &[
                                        Arg::Int(source_position as i64),
                                        Arg::Int(target_position as i64),
                                    ],
                                );
                            }
                        }
                        return Ternary::FALSE;
                    }
                    result &= related;
                }
                return result;
            }
            if c.type_target_tuple_type(target)
                .combined_flags
                .intersects(ElementFlags::VARIABLE)
            {
                return Ternary::FALSE;
            }
        }
        let require_optional_properties = (relation == RelationKind::Subtype
            || relation == RelationKind::StrictSubtype)
            && !is_object_literal_type(c, source)
            && !c.is_empty_array_literal_type(source)
            && !is_tuple_type(c, source);
        let unmatched_property =
            c.get_unmatched_property(source, target, require_optional_properties, false);
        if !unmatched_property.is_nil() {
            if report_errors && c.should_report_unmatched_property_error(source, target) {
                r.report_unmatched_property(
                    c,
                    source,
                    target,
                    unmatched_property,
                    require_optional_properties,
                );
            }
            return Ternary::FALSE;
        }
        if is_object_literal_type(c, target) {
            let source_properties = c.get_properties_of_type(source);
            let source_properties = exclude_properties(c, source_properties, excluded_properties);
            for &source_prop in source_properties.as_slice() {
                let source_prop_name = c.ast.sym(source_prop).name;
                if c.get_property_of_object_type(target, source_prop_name)
                    .is_nil()
                {
                    if report_errors {
                        let prop_text = c.symbol_to_string(source_prop);
                        let target_text = c.type_to_string_exported(target);
                        r.report_error(
                            c,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                            &[Arg::Str(&prop_text), Arg::Str(&target_text)],
                        );
                    }
                    return Ternary::FALSE;
                }
            }
        }
        // We only call this for union target types when we're attempting to do excess property checking - in those cases, we want to get _all possible props_ from the target union, across all members
        let properties = c.get_properties_of_type(target);
        let numeric_names_only = is_tuple_type(c, source) && is_tuple_type(c, target);
        let target_properties = exclude_properties(c, properties, excluded_properties);
        for &target_prop in target_properties.as_slice() {
            let target_prop_symbol = c.ast.sym(target_prop);
            let name = target_prop_symbol.name;
            if !target_prop_symbol.flags.intersects(SymbolFlags::PROTOTYPE)
                && (!numeric_names_only || is_numeric_literal_name(name) || name == b"length")
                && (!optionals_only || target_prop_symbol.flags.intersects(SymbolFlags::OPTIONAL))
            {
                let source_prop = c.get_property_of_type(source, name);
                if !source_prop.is_nil() && source_prop != target_prop {
                    let related = r.property_related_to(
                        c,
                        source,
                        target,
                        source_prop,
                        target_prop,
                        &mut |c, s| c.get_non_missing_type_of_symbol(s),
                        report_errors,
                        intersection_state,
                        relation == RelationKind::Comparable,
                    );
                    if related == Ternary::FALSE {
                        return Ternary::FALSE;
                    }
                    result &= related;
                }
            }
        }
        result
    }

    pub fn property_related_to<'a>(
        self,
        c: &mut Checker<'a>,
        source: TypeId,
        target: TypeId,
        source_prop: SymbolId,
        target_prop: SymbolId,
        get_type_of_source_property: SymbolTypeGetter<'_, 'a>,
        report_errors: bool,
        intersection_state: IntersectionState,
        skip_optional: bool,
    ) -> Ternary {
        let r = self;
        let source_prop_flags = get_declaration_modifier_flags_from_symbol(c.ast, source_prop);
        let target_prop_flags = get_declaration_modifier_flags_from_symbol(c.ast, target_prop);
        if source_prop_flags.intersects(ModifierFlags::PRIVATE)
            || target_prop_flags.intersects(ModifierFlags::PRIVATE)
        {
            if c.ast.sym(source_prop).value_declaration != c.ast.sym(target_prop).value_declaration
            {
                if report_errors {
                    if source_prop_flags.intersects(ModifierFlags::PRIVATE)
                        && target_prop_flags.intersects(ModifierFlags::PRIVATE)
                    {
                        let prop_text = c.symbol_to_string(target_prop);
                        r.report_error(
                            c,
                            diagnostics::TYPES_HAVE_SEPARATE_DECLARATIONS_OF_A_PRIVATE_PROPERTY_0,
                            &[Arg::Str(&prop_text)],
                        );
                    } else {
                        let source_is_private =
                            source_prop_flags.intersects(ModifierFlags::PRIVATE);
                        let prop_text = c.symbol_to_string(target_prop);
                        let private_text = c.type_to_string_exported(if source_is_private {
                            source
                        } else {
                            target
                        });
                        let other_text = c.type_to_string_exported(if source_is_private {
                            target
                        } else {
                            source
                        });
                        r.report_error(
                            c,
                            diagnostics::PROPERTY_0_IS_PRIVATE_IN_TYPE_1_BUT_NOT_IN_TYPE_2,
                            &[
                                Arg::Str(&prop_text),
                                Arg::Str(&private_text),
                                Arg::Str(&other_text),
                            ],
                        );
                    }
                }
                return Ternary::FALSE;
            }
        } else if target_prop_flags.intersects(ModifierFlags::PROTECTED) {
            if !c.is_valid_override_of(source_prop, target_prop) {
                if report_errors {
                    let mut source_type = c.get_declaring_class(source_prop);
                    if source_type.is_nil() {
                        source_type = source;
                    }
                    let mut target_type = c.get_declaring_class(target_prop);
                    if target_type.is_nil() {
                        target_type = target;
                    }
                    let prop_text = c.symbol_to_string(target_prop);
                    let source_text = c.type_to_string_exported(source_type);
                    let target_text = c.type_to_string_exported(target_type);
                    r.report_error(
                        c,
                        diagnostics::PROPERTY_0_IS_PROTECTED_BUT_TYPE_1_IS_NOT_A_CLASS_DERIVED_FROM_2,
                        &[
                            Arg::Str(&prop_text),
                            Arg::Str(&source_text),
                            Arg::Str(&target_text),
                        ],
                    );
                }
                return Ternary::FALSE;
            }
        } else if source_prop_flags.intersects(ModifierFlags::PROTECTED) {
            if report_errors {
                let prop_text = c.symbol_to_string(target_prop);
                let source_text = c.type_to_string_exported(source);
                let target_text = c.type_to_string_exported(target);
                r.report_error(
                    c,
                    diagnostics::PROPERTY_0_IS_PROTECTED_IN_TYPE_1_BUT_PUBLIC_IN_TYPE_2,
                    &[
                        Arg::Str(&prop_text),
                        Arg::Str(&source_text),
                        Arg::Str(&target_text),
                    ],
                );
            }
            return Ternary::FALSE;
        }
        // Ensure {readonly a: whatever} is not a subtype of {a: whatever}, while {a: whatever} is a subtype of {readonly a: whatever}. This ensures the subtype relationship is ordered, and preventing declaration order from deciding which type "wins" in union subtype reduction. They're still assignable to one another, since `readonly` doesn't affect assignability. This is only applied during the strictSubtypeRelation -- currently used in subtype reduction
        if c.relaters[r].relation == RelationKind::StrictSubtype
            && c.is_readonly_symbol(source_prop)
            && !c.is_readonly_symbol(target_prop)
        {
            return Ternary::FALSE;
        }
        // If the target comes from a partial union prop, allow `undefined` in the target type
        let related = r.is_property_symbol_type_related(
            c,
            source_prop,
            target_prop,
            get_type_of_source_property,
            report_errors,
            intersection_state,
        );
        if related == Ternary::FALSE {
            if report_errors {
                let prop_text = c.symbol_to_string(target_prop);
                r.report_error(
                    c,
                    diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE,
                    &[Arg::Str(&prop_text)],
                );
            }
            return Ternary::FALSE;
        }
        // When checking for comparability, be more lenient with optional properties.
        if !skip_optional
            && c.ast
                .sym(source_prop)
                .flags
                .intersects(SymbolFlags::OPTIONAL)
            && c.ast
                .sym(target_prop)
                .flags
                .intersects(SymbolFlags::CLASS_MEMBER)
            && !c
                .ast
                .sym(target_prop)
                .flags
                .intersects(SymbolFlags::OPTIONAL)
        {
            // TypeScript 1.0 spec (April 2014): 3.8.3 S is a subtype of a type T, and T is a supertype of S if ... S' and T are object types and, for each member M in T.. M is a property and S' contains a property N where if M is a required property, N is also a required property (M - property in T) (N - property in S)
            if report_errors {
                let prop_text = c.symbol_to_string(target_prop);
                let source_text = c.type_to_string_exported(source);
                let target_text = c.type_to_string_exported(target);
                r.report_error(
                    c,
                    diagnostics::PROPERTY_0_IS_OPTIONAL_IN_TYPE_1_BUT_REQUIRED_IN_TYPE_2,
                    &[
                        Arg::Str(&prop_text),
                        Arg::Str(&source_text),
                        Arg::Str(&target_text),
                    ],
                );
            }
            return Ternary::FALSE;
        }
        related
    }

    pub fn is_property_symbol_type_related<'a>(
        self,
        c: &mut Checker<'a>,
        source_prop: SymbolId,
        target_prop: SymbolId,
        get_type_of_source_property: SymbolTypeGetter<'_, 'a>,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let target_is_optional = c.strict_null_checks
            && c.ast
                .sym(target_prop)
                .check_flags
                .intersects(CheckFlags::PARTIAL);
        let target_type = c.get_non_missing_type_of_symbol(target_prop);
        let effective_target = c.add_optionality_ex(target_type, false, target_is_optional);
        // source could resolve to `any` and that's not related to `unknown` target under strict subtype relation
        let mask = if c.relaters[r].relation == RelationKind::StrictSubtype {
            TypeFlags::ANY
        } else {
            TypeFlags::ANY_OR_UNKNOWN
        };
        if c.types[effective_target].flags.intersects(mask) {
            return Ternary::TRUE;
        }
        let effective_source = get_type_of_source_property(c, source_prop);
        r.is_related_to_ex(
            c,
            effective_source,
            effective_target,
            RecursionFlags::BOTH,
            report_errors,
            MessageId::NIL,
            intersection_state,
        )
    }

    pub fn report_unmatched_property(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        unmatched_property: SymbolId,
        require_optional_properties: bool,
    ) {
        let r = self;
        // give specific error in case where private names have the same description
        let unmatched_symbol = c.ast.sym(unmatched_property);
        let source_symbol = c.types[source].symbol;
        if !unmatched_symbol.value_declaration.is_nil()
            && !c.ast.name(unmatched_symbol.value_declaration).is_nil()
            && is_private_identifier(c.ast, c.ast.name(unmatched_symbol.value_declaration))
            && !source_symbol.is_nil()
            && c.ast
                .sym(source_symbol)
                .flags
                .intersects(SymbolFlags::CLASS)
        {
            let private_identifier_description =
                c.ast.text(c.ast.name(unmatched_symbol.value_declaration));
            let symbol_table_key = get_symbol_name_for_private_identifier(
                c.ast,
                source_symbol,
                private_identifier_description,
            );
            if !c.get_property_of_type(source, symbol_table_key).is_nil() {
                let source_text = c.symbol_to_string_exported(source_symbol);
                let target_symbol = c.types[target].symbol;
                let target_text = c.symbol_to_string_exported(target_symbol);
                r.report_error(
                    c,
                    diagnostics::PROPERTY_0_IN_TYPE_1_REFERS_TO_A_DIFFERENT_MEMBER_THAT_CANNOT_BE_ACCESSED_FROM_WITHIN_TYPE_2,
                    &[
                        Arg::Str(private_identifier_description),
                        Arg::Str(&source_text),
                        Arg::Str(&target_text),
                    ],
                );
                return;
            }
        }
        let props = c.get_unmatched_properties(source, target, require_optional_properties, false);
        if props.len() == 1 {
            let (source_type, target_type) = c.get_type_names_for_error_display(source, target);
            let prop_name = c.symbol_to_string(unmatched_property);
            r.report_error(
                c,
                diagnostics::PROPERTY_0_IS_MISSING_IN_TYPE_1_BUT_REQUIRED_IN_TYPE_2,
                &[
                    Arg::Str(&prop_name),
                    Arg::Str(&source_type),
                    Arg::Str(&target_type),
                ],
            );
            if unmatched_symbol.declarations.len() != 0 {
                let info = c.create_diagnostic_for_node(
                    unmatched_symbol.declarations.at(0usize),
                    diagnostics::X_0_IS_DECLARED_HERE,
                    &[Arg::Str(&prop_name)],
                );
                c.relaters[r].related_info.push(info);
            }
        } else if r.try_elaborate_array_like_errors(c, source, target, false) {
            let (source_type, target_type) = c.get_type_names_for_error_display(source, target);
            if props.len() > 5 {
                let mut prop_names: Vec<u8> = Vec::new();
                for (i, &prop) in props.as_slice().get(..4).unwrap_or(&[]).iter().enumerate() {
                    if i != 0 {
                        prop_names.extend_from_slice(b", ");
                    }
                    prop_names.extend_from_slice(&c.symbol_to_string(prop));
                }
                r.report_error(
                    c,
                    diagnostics::TYPE_0_IS_MISSING_THE_FOLLOWING_PROPERTIES_FROM_TYPE_1_COLON_2_AND_3_MORE,
                    &[
                        Arg::Str(&source_type),
                        Arg::Str(&target_type),
                        Arg::Str(&prop_names),
                        Arg::Int((props.len() - 4) as i64),
                    ],
                );
            } else {
                let mut prop_names: Vec<u8> = Vec::new();
                for (i, &prop) in props.as_slice().iter().enumerate() {
                    if i != 0 {
                        prop_names.extend_from_slice(b", ");
                    }
                    prop_names.extend_from_slice(&c.symbol_to_string(prop));
                }
                r.report_error(
                    c,
                    diagnostics::TYPE_0_IS_MISSING_THE_FOLLOWING_PROPERTIES_FROM_TYPE_1_COLON_2,
                    &[
                        Arg::Str(&source_type),
                        Arg::Str(&target_type),
                        Arg::Str(&prop_names),
                    ],
                );
            }
        }
    }

    // The spec for elaboration is: If the source is a readonly tuple and the target is a mutable array or tuple, elaborate on mutability and skip property elaborations. If the source is a tuple then skip property elaborations if the target is an array or tuple. If the source is a readonly array and the target is a mutable array or tuple, elaborate on mutability and skip property elaborations. If the source an array then skip property elaborations if the target is a tuple.
    pub fn try_elaborate_array_like_errors(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> bool {
        let r = self;
        if is_tuple_type(c, source) {
            if c.type_target_tuple_type(source).readonly && c.is_mutable_array_or_tuple(target) {
                if report_errors {
                    let source_text = c.type_to_string_exported(source);
                    let target_text = c.type_to_string_exported(target);
                    r.report_error(
                        c,
                        diagnostics::THE_TYPE_0_IS_READONLY_AND_CANNOT_BE_ASSIGNED_TO_THE_MUTABLE_TYPE_1,
                        &[Arg::Str(&source_text), Arg::Str(&target_text)],
                    );
                }
                return false;
            }
            return c.is_array_or_tuple_type(target);
        }
        if c.is_readonly_array_type(source) && c.is_mutable_array_or_tuple(target) {
            if report_errors {
                let source_text = c.type_to_string_exported(source);
                let target_text = c.type_to_string_exported(target);
                r.report_error(
                    c,
                    diagnostics::THE_TYPE_0_IS_READONLY_AND_CANNOT_BE_ASSIGNED_TO_THE_MUTABLE_TYPE_1,
                    &[Arg::Str(&source_text), Arg::Str(&target_text)],
                );
            }
            return false;
        }
        if is_tuple_type(c, target) {
            return c.is_array_type(source);
        }
        true
    }

    pub fn try_elaborate_errors_for_primitives_and_objects(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) {
        let r = self;
        if (source == c.global_string_type && target == c.string_type)
            || (source == c.global_number_type && target == c.number_type)
            || (source == c.global_boolean_type && target == c.boolean_type)
            || (source == c.get_global_es_symbol_type() && target == c.es_symbol_type)
        {
            let target_text = c.type_to_string_exported(target);
            let source_text = c.type_to_string_exported(source);
            r.report_error(
                c,
                diagnostics::X_0_IS_A_PRIMITIVE_BUT_1_IS_A_WRAPPER_OBJECT_PREFER_USING_0_WHEN_POSSIBLE,
                &[Arg::Str(&target_text), Arg::Str(&source_text)],
            );
        }
    }

    pub fn properties_identical_to<'a>(
        self,
        c: &mut Checker<'a>,
        source: TypeId,
        target: TypeId,
        excluded_properties: &Set<Text<'a>>,
    ) -> Ternary {
        let r = self;
        if !c.types[source].flags.intersects(TypeFlags::OBJECT)
            || !c.types[target].flags.intersects(TypeFlags::OBJECT)
        {
            return Ternary::FALSE;
        }
        let source_object_properties = c.get_properties_of_object_type(source);
        let source_properties =
            exclude_properties(c, source_object_properties, excluded_properties);
        let target_object_properties = c.get_properties_of_object_type(target);
        let target_properties =
            exclude_properties(c, target_object_properties, excluded_properties);
        if source_properties.len() != target_properties.len() {
            return Ternary::FALSE;
        }
        let mut result = Ternary::TRUE;
        for &source_prop in source_properties.as_slice() {
            let source_prop_name = c.ast.sym(source_prop).name;
            let target_prop = c.get_property_of_object_type(target, source_prop_name);
            if target_prop.is_nil() {
                return Ternary::FALSE;
            }
            let related = c.compare_properties(source_prop, target_prop, &mut |c, s, t| {
                r.is_related_to_simple(c, s, t)
            });
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    pub fn signatures_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        kind: SignatureKind,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        if relation == RelationKind::Identity {
            return r.signatures_identical_to(c, source, target, kind);
        }
        // With respect to signatures, the anyFunctionType wildcard is a subtype of every other function type.
        if source == c.any_function_type {
            return Ternary::TRUE;
        }
        if target == c.any_function_type {
            return Ternary::FALSE;
        }
        let source_signatures = c.get_signatures_of_type(source, kind);
        let target_signatures = c.get_signatures_of_type(target, kind);
        if kind == SignatureKind::CONSTRUCT
            && source_signatures.len() != 0
            && target_signatures.len() != 0
        {
            let first_source = source_signatures.at(0usize);
            let first_target = target_signatures.at(0usize);
            let source_is_abstract = c.signatures[first_source]
                .flags
                .intersects(SignatureFlags::ABSTRACT);
            let target_is_abstract = c.signatures[first_target]
                .flags
                .intersects(SignatureFlags::ABSTRACT);
            if source_is_abstract && !target_is_abstract {
                // An abstract constructor type is not assignable to a non-abstract constructor type as it would otherwise be possible to new an abstract class. Note that the assignability check we perform for an extends clause excludes construct signatures from the target, so this check never proceeds.
                if report_errors {
                    r.report_error(
                        c,
                        diagnostics::CANNOT_ASSIGN_AN_ABSTRACT_CONSTRUCTOR_TYPE_TO_A_NON_ABSTRACT_CONSTRUCTOR_TYPE,
                        &[],
                    );
                }
                return Ternary::FALSE;
            }
            if !r.constructor_visibilities_are_compatible(
                c,
                first_source,
                first_target,
                report_errors,
            ) {
                return Ternary::FALSE;
            }
        }
        let mut result = Ternary::TRUE;
        let source_object_flags = c.types[source].object_flags;
        let target_object_flags = c.types[target].object_flags;
        if source_object_flags.intersects(ObjectFlags::INSTANTIATED)
            && target_object_flags.intersects(ObjectFlags::INSTANTIATED)
            && c.types[source].symbol == c.types[target].symbol
            || source_object_flags.intersects(ObjectFlags::REFERENCE)
                && target_object_flags.intersects(ObjectFlags::REFERENCE)
                && c.type_target(source) == c.type_target(target)
        {
            // We have instantiations of the same anonymous type (which typically will be the type of a method). Simply do a pairwise comparison of the signatures in the two signature lists instead of the much more expensive N * M comparison matrix we explore below. We erase type parameters as they are known to always be the same.
            for (i, &target_signature) in target_signatures.as_slice().iter().enumerate() {
                let source_signature = source_signatures.at(i);
                if source_signature.is_nil() {
                    return c.fail("index out of range");
                }
                let related = r.signature_related_to(
                    c,
                    source_signature,
                    target_signature,
                    true,
                    report_errors,
                    intersection_state,
                );
                if related == Ternary::FALSE {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        } else if source_signatures.len() == 1 && target_signatures.len() == 1 {
            // For simple functions (functions with a single signature) we only erase type parameters for the comparable relation. Otherwise, if the source signature is generic, we instantiate it in the context of the target signature before checking the relationship. Ideally we'd do this regardless of the number of signatures, but the potential costs are prohibitive due to the quadratic nature of the logic below.
            let erase_generics = relation == RelationKind::Comparable;
            result = r.signature_related_to(
                c,
                source_signatures.at(0usize),
                target_signatures.at(0usize),
                erase_generics,
                report_errors,
                intersection_state,
            );
        } else {
            'outer: for &t in target_signatures.as_slice() {
                let save_error_state = r.get_error_state(c);
                // Only elaborate errors from the first failure
                let mut should_elaborate_errors = report_errors;
                for &s in source_signatures.as_slice() {
                    let related = r.signature_related_to(
                        c,
                        s,
                        t,
                        true,
                        should_elaborate_errors,
                        intersection_state,
                    );
                    if related != Ternary::FALSE {
                        result &= related;
                        r.restore_error_state(c, save_error_state);
                        continue 'outer;
                    }
                    should_elaborate_errors = false;
                }
                if should_elaborate_errors {
                    let source_text = c.type_to_string_exported(source);
                    let signature_text = c.signature_to_string(t);
                    r.report_error(
                        c,
                        diagnostics::TYPE_0_PROVIDES_NO_MATCH_FOR_THE_SIGNATURE_1,
                        &[Arg::Str(&source_text), Arg::Str(&signature_text)],
                    );
                }
                return Ternary::FALSE;
            }
        }
        result
    }

    pub fn constructor_visibilities_are_compatible(
        self,
        c: &mut Checker<'_>,
        source_signature: SignatureId,
        target_signature: SignatureId,
        report_errors: bool,
    ) -> bool {
        let r = self;
        let source_declaration = c.signatures[source_signature].declaration;
        let target_declaration = c.signatures[target_signature].declaration;
        if source_declaration.is_nil() || target_declaration.is_nil() {
            return true;
        }
        let source_accessibility = c.ast.modifier_flags(source_declaration)
            & ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER;
        let target_accessibility = c.ast.modifier_flags(target_declaration)
            & ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER;
        // A public, protected and private signature is assignable to a private signature.
        if target_accessibility == ModifierFlags::PRIVATE {
            return true;
        }
        // A public and protected signature is assignable to a protected signature.
        if target_accessibility == ModifierFlags::PROTECTED
            && source_accessibility != ModifierFlags::PRIVATE
        {
            return true;
        }
        // Only a public signature is assignable to public signature.
        if target_accessibility != ModifierFlags::PROTECTED
            && source_accessibility == ModifierFlags::NONE
        {
            return true;
        }
        if report_errors {
            r.report_error(
                c,
                diagnostics::CANNOT_ASSIGN_A_0_CONSTRUCTOR_TYPE_TO_A_1_CONSTRUCTOR_TYPE,
                &[
                    Arg::Str(visibility_to_string(source_accessibility)),
                    Arg::Str(visibility_to_string(target_accessibility)),
                ],
            );
        }
        false
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

    pub fn signatures_identical_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        kind: SignatureKind,
    ) -> Ternary {
        let r = self;
        let source_signatures = c.get_signatures_of_type(source, kind);
        let target_signatures = c.get_signatures_of_type(target, kind);
        if source_signatures.len() != target_signatures.len() {
            return Ternary::FALSE;
        }
        let mut result = Ternary::TRUE;
        for (i, &source_signature) in source_signatures.as_slice().iter().enumerate() {
            let related = c.compare_signatures_identical(
                source_signature,
                target_signatures.at(i),
                false,
                false,
                false,
                &mut |c, s, t| r.is_related_to_simple(c, s, t),
            );
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    pub fn index_signatures_related_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        source_is_primitive: bool,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let relation = c.relaters[r].relation;
        if relation == RelationKind::Identity {
            return r.index_signatures_identical_to(c, source, target);
        }
        let index_infos = c.get_index_infos_of_type(target);
        let mut target_has_string_index = false;
        for &info in index_infos.as_slice() {
            if c.index_infos[info].key_type == c.string_type {
                target_has_string_index = true;
                break;
            }
        }
        let mut result = Ternary::TRUE;
        for &target_info in index_infos.as_slice() {
            let target_value_type = c.index_infos[target_info].value_type;
            let related;
            if relation != RelationKind::StrictSubtype
                && !source_is_primitive
                && target_has_string_index
                && c.types[target_value_type].flags.intersects(TypeFlags::ANY)
            {
                related = Ternary::TRUE;
            } else if c.is_generic_mapped_type(source) && target_has_string_index {
                let template_type = c.get_template_type_from_mapped_type(source);
                related = r.is_related_to(
                    c,
                    template_type,
                    target_value_type,
                    RecursionFlags::BOTH,
                    report_errors,
                );
            } else {
                related = r.type_related_to_index_info(
                    c,
                    source,
                    target_info,
                    report_errors,
                    intersection_state,
                );
            }
            if related == Ternary::FALSE {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    pub fn type_related_to_index_info(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target_info: IndexInfoId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let target_key_type = c.index_infos[target_info].key_type;
        let source_info = c.get_applicable_index_info(source, target_key_type);
        if !source_info.is_nil() {
            return r.index_info_related_to(
                c,
                source_info,
                target_info,
                report_errors,
                intersection_state,
            );
        }
        // Intersection constituents are never considered to have an inferred index signature. Also, in the strict subtype relation, only fresh object literals are considered to have inferred index signatures. This ensures { [x: string]: xxx } <: {} but not vice-versa. Without this rule, those types would be mutual strict subtypes.
        if !intersection_state.intersects(IntersectionState::SOURCE)
            && (c.relaters[r].relation != RelationKind::StrictSubtype
                || c.types[source]
                    .object_flags
                    .intersects(ObjectFlags::FRESH_LITERAL))
            && c.is_object_type_with_inferable_index(source)
        {
            return r.members_related_to_index_info(
                c,
                source,
                target_info,
                report_errors,
                intersection_state,
            );
        }
        if report_errors {
            let key_text = c.type_to_string_exported(target_key_type);
            let source_text = c.type_to_string_exported(source);
            r.report_error(
                c,
                diagnostics::INDEX_SIGNATURE_FOR_TYPE_0_IS_MISSING_IN_TYPE_1,
                &[Arg::Str(&key_text), Arg::Str(&source_text)],
            );
        }
        Ternary::FALSE
    }
}

impl<'a> Checker<'a> {
    // Return true if the type was inferred from an object literal, object type literal, enum type, or a value module and has no call or construct signatures, or a JS expando object literal or a rest type, or a reverse mapped type with a source for which one of the above is true.
    pub fn is_object_type_with_inferable_index(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            for &constituent in self.type_types(t).as_slice() {
                if !self.is_object_type_with_inferable_index(constituent) {
                    return false;
                }
            }
            return true;
        }
        let symbol = self.types[t].symbol;
        let symbol_flags = self.ast.sym(symbol).flags;
        let object_flags = self.types[t].object_flags;
        !symbol.is_nil()
            && symbol_flags.intersects(
                SymbolFlags::OBJECT_LITERAL
                    | SymbolFlags::TYPE_LITERAL
                    | SymbolFlags::ENUM
                    | SymbolFlags::VALUE_MODULE,
            )
            && !symbol_flags.intersects(SymbolFlags::CLASS)
            && !self.type_has_call_or_construct_signatures(t)
            || object_flags.intersects(ObjectFlags::JS_LITERAL | ObjectFlags::OBJECT_REST_TYPE)
            || object_flags.intersects(ObjectFlags::REVERSE_MAPPED)
                && self.is_object_type_with_inferable_index(self.as_reverse_mapped_type(t).source)
    }
}

impl RelaterId {
    pub fn members_related_to_index_info(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target_info: IndexInfoId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let mut result = Ternary::TRUE;
        let key_type = c.index_infos[target_info].key_type;
        let target_value_type = c.index_infos[target_info].value_type;
        let props = if c.types[source].flags.intersects(TypeFlags::INTERSECTION) {
            c.get_properties_of_union_or_intersection_type(source)
        } else {
            c.get_properties_of_object_type(source)
        };
        for &prop in props.as_slice() {
            // Skip over ignored JSX and symbol-named members
            if is_ignored_jsx_property(c, source, prop) {
                continue;
            }
            let prop_name_type = c.get_literal_type_from_property(
                prop,
                TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                false,
            );
            if c.is_applicable_index_type(prop_name_type, key_type) {
                let prop_type = c.get_non_missing_type_of_symbol(prop);
                let t = if c.exact_optional_property_types
                    || c.types[prop_type].flags.intersects(TypeFlags::UNDEFINED)
                    || key_type == c.number_type
                    || !c.ast.sym(prop).flags.intersects(SymbolFlags::OPTIONAL)
                {
                    prop_type
                } else {
                    c.get_type_with_facts(prop_type, TypeFacts::NE_UNDEFINED)
                };
                let related = r.is_related_to_ex(
                    c,
                    t,
                    target_value_type,
                    RecursionFlags::BOTH,
                    report_errors,
                    MessageId::NIL,
                    intersection_state,
                );
                if related == Ternary::FALSE {
                    if report_errors {
                        let prop_text = c.symbol_to_string(prop);
                        r.report_error(
                            c,
                            diagnostics::PROPERTY_0_IS_INCOMPATIBLE_WITH_INDEX_SIGNATURE,
                            &[Arg::Str(&prop_text)],
                        );
                    }
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        let source_infos = c.get_index_infos_of_type(source);
        for &info in source_infos.as_slice() {
            let info_key_type = c.index_infos[info].key_type;
            if c.is_applicable_index_type(info_key_type, key_type) {
                let related = r.index_info_related_to(
                    c,
                    info,
                    target_info,
                    report_errors,
                    intersection_state,
                );
                if related == Ternary::FALSE {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        result
    }

    pub fn index_info_related_to(
        self,
        c: &mut Checker<'_>,
        source_info: IndexInfoId,
        target_info: IndexInfoId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let r = self;
        let source_value_type = c.index_infos[source_info].value_type;
        let target_value_type = c.index_infos[target_info].value_type;
        let related = r.is_related_to_ex(
            c,
            source_value_type,
            target_value_type,
            RecursionFlags::BOTH,
            report_errors,
            MessageId::NIL,
            intersection_state,
        );
        if related == Ternary::FALSE && report_errors {
            let source_key_type = c.index_infos[source_info].key_type;
            let target_key_type = c.index_infos[target_info].key_type;
            if source_key_type == target_key_type {
                let key_text = c.type_to_string_exported(source_key_type);
                r.report_error(
                    c,
                    diagnostics::X_0_INDEX_SIGNATURES_ARE_INCOMPATIBLE,
                    &[Arg::Str(&key_text)],
                );
            } else {
                let source_key_text = c.type_to_string_exported(source_key_type);
                let target_key_text = c.type_to_string_exported(target_key_type);
                r.report_error(
                    c,
                    diagnostics::X_0_AND_1_INDEX_SIGNATURES_ARE_INCOMPATIBLE,
                    &[Arg::Str(&source_key_text), Arg::Str(&target_key_text)],
                );
            }
        }
        related
    }

    pub fn index_signatures_identical_to(
        self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let r = self;
        let source_infos = c.get_index_infos_of_type(source);
        let target_infos = c.get_index_infos_of_type(target);
        if source_infos.len() != target_infos.len() {
            return Ternary::FALSE;
        }
        for &target_info in target_infos.as_slice() {
            let target_key_type = c.index_infos[target_info].key_type;
            let source_info = c.get_index_info_of_type(source, target_key_type);
            if source_info.is_nil() {
                return Ternary::FALSE;
            }
            let source_value_type = c.index_infos[source_info].value_type;
            let target_value_type = c.index_infos[target_info].value_type;
            if r.is_related_to(
                c,
                source_value_type,
                target_value_type,
                RecursionFlags::BOTH,
                false,
            ) == Ternary::FALSE
                || c.index_infos[source_info].is_readonly != c.index_infos[target_info].is_readonly
            {
                return Ternary::FALSE;
            }
        }
        Ternary::TRUE
    }

    pub fn report_error_results(
        self,
        c: &mut Checker<'_>,
        original_source: TypeId,
        original_target: TypeId,
        mut source: TypeId,
        mut target: TypeId,
        head_message: MessageId,
    ) {
        let r = self;
        let source_has_base = !c
            .get_single_base_for_non_augmenting_subtype(original_source)
            .is_nil();
        let target_has_base = !c
            .get_single_base_for_non_augmenting_subtype(original_target)
            .is_nil();
        if !c.types[original_source].alias.is_nil() || source_has_base {
            source = original_source;
        }
        if !c.types[original_target].alias.is_nil() || target_has_base {
            target = original_target;
        }
        let source_flags = c.types[source].flags;
        let target_flags = c.types[target].flags;
        if source_flags.intersects(TypeFlags::OBJECT) && target_flags.intersects(TypeFlags::OBJECT)
        {
            r.try_elaborate_array_like_errors(c, source, target, true);
        }
        let source_symbol = c.types[source].symbol;
        if source_flags.intersects(TypeFlags::OBJECT)
            && target_flags.intersects(TypeFlags::PRIMITIVE)
        {
            r.try_elaborate_errors_for_primitives_and_objects(c, source, target);
        } else if !source_symbol.is_nil()
            && source_flags.intersects(TypeFlags::OBJECT)
            && c.global_object_type == source
        {
            r.report_error(
                c,
                diagnostics::THE_OBJECT_TYPE_IS_ASSIGNABLE_TO_VERY_FEW_OTHER_TYPES_DID_YOU_MEAN_TO_USE_THE_ANY_TYPE_INSTEAD,
                &[],
            );
        } else if c.types[source]
            .object_flags
            .intersects(ObjectFlags::JSX_ATTRIBUTES)
            && target_flags.intersects(TypeFlags::INTERSECTION)
        {
            let target_types = c.type_types(target);
            let error_node = c.relaters[r].error_node;
            let intrinsic_attributes = c.get_jsx_type(JsxNames::INTRINSIC_ATTRIBUTES, error_node);
            let intrinsic_class_attributes =
                c.get_jsx_type(JsxNames::INTRINSIC_CLASS_ATTRIBUTES, error_node);
            if !c.is_error_type(intrinsic_attributes)
                && !c.is_error_type(intrinsic_class_attributes)
                && (target_types.as_slice().contains(&intrinsic_attributes)
                    || target_types
                        .as_slice()
                        .contains(&intrinsic_class_attributes))
            {
                return;
            }
        } else if c.types[original_target]
            .flags
            .intersects(TypeFlags::INTERSECTION)
            && c.types[original_target]
                .object_flags
                .intersects(ObjectFlags::IS_NEVER_INTERSECTION)
        {
            let mut message = diagnostics::THE_INTERSECTION_0_WAS_REDUCED_TO_NEVER_BECAUSE_PROPERTY_1_HAS_CONFLICTING_TYPES_IN_SOME_CONSTITUENTS;
            let mut prop = SymbolId::NIL;
            let properties = c.get_properties_of_union_or_intersection_type(original_target);
            for &p in properties.as_slice() {
                if c.is_discriminant_with_never_type(p) {
                    prop = p;
                    break;
                }
            }
            if prop.is_nil() {
                message = diagnostics::THE_INTERSECTION_0_WAS_REDUCED_TO_NEVER_BECAUSE_PROPERTY_1_EXISTS_IN_MULTIPLE_CONSTITUENTS_AND_IS_PRIVATE_IN_SOME;
                let properties = c.get_properties_of_union_or_intersection_type(original_target);
                for &p in properties.as_slice() {
                    if is_conflicting_private_property(c.ast, p) {
                        prop = p;
                        break;
                    }
                }
            }
            if !prop.is_nil() {
                let target_text = c.type_to_string_ex(
                    original_target,
                    NodeId::NIL,
                    TypeFormatFlags::NO_TYPE_REDUCTION,
                    None,
                );
                let prop_text = c.symbol_to_string(prop);
                r.report_error(c, message, &[Arg::Str(&target_text), Arg::Str(&prop_text)]);
            }
        }
        r.report_relation_error(c, head_message, source, target);
        if source_flags.intersects(TypeFlags::TYPE_PARAMETER)
            && !source_symbol.is_nil()
            && c.ast.sym(source_symbol).declarations.len() != 0
            && c.get_constraint_of_type(source).is_nil()
        {
            let synthetic_param = c.clone_type_parameter(source);
            let mapper = new_simple_type_mapper(c, source, synthetic_param);
            let constraint = c.instantiate_type(target, mapper);
            c.as_type_parameter_mut(synthetic_param).constraint = constraint;
            if c.has_non_circular_base_constraint(synthetic_param) {
                let target_constraint_string = c.type_to_string_exported(target);
                let declaration = c.ast.sym(source_symbol).declarations.at(0usize);
                let info = c.new_diagnostic_for_node(
                    declaration,
                    diagnostics::THIS_TYPE_PARAMETER_MIGHT_NEED_AN_EXTENDS_0_CONSTRAINT,
                    &[Arg::Str(&target_constraint_string)],
                );
                c.relaters[r].related_info.push(info);
            }
        }
    }

    pub fn report_relation_error(
        self,
        c: &mut Checker<'_>,
        mut message: MessageId,
        source: TypeId,
        target: TypeId,
    ) {
        let r = self;
        let (source_type, target_type) = c.get_type_names_for_error_display(source, target);
        let mut generalized_source = source;
        let mut generalized_source_type = source_type.clone();
        // Don't generalize on 'never' - we really want the original type to be displayed for use-cases like 'assertNever'.
        if !c.types[target].flags.intersects(TypeFlags::NEVER)
            && is_literal_type(c, source)
            && !c.type_could_have_top_level_singleton_types(target)
        {
            generalized_source = c.get_base_type_of_literal_type(source);
            generalized_source_type = c.get_type_name_for_error_display(generalized_source);
        }
        // If `target` is of indexed access type (and `source` it is not), we use the object type of `target` for better error reporting
        let target_flags = if c.types[target].flags.intersects(TypeFlags::INDEXED_ACCESS)
            && !c.types[source].flags.intersects(TypeFlags::INDEXED_ACCESS)
        {
            c.types[c.as_indexed_access_type(target).object_type].flags
        } else {
            c.types[target].flags
        };
        if target_flags.intersects(TypeFlags::TYPE_PARAMETER)
            && target != c.marker_super_type_for_check
            && target != c.marker_sub_type_for_check
        {
            let constraint = c.get_base_constraint_of_type(target);
            if !constraint.is_nil() && c.is_type_assignable_to(generalized_source, constraint) {
                let constraint_text = c.type_to_string_exported(constraint);
                r.report_error(
                    c,
                    diagnostics::X_0_IS_ASSIGNABLE_TO_THE_CONSTRAINT_OF_TYPE_1_BUT_1_COULD_BE_INSTANTIATED_WITH_A_DIFFERENT_SUBTYPE_OF_CONSTRAINT_2,
                    &[
                        Arg::Str(&generalized_source_type),
                        Arg::Str(&target_type),
                        Arg::Str(&constraint_text),
                    ],
                );
            } else if !constraint.is_nil() && c.is_type_assignable_to(source, constraint) {
                let constraint_text = c.type_to_string_exported(constraint);
                r.report_error(
                    c,
                    diagnostics::X_0_IS_ASSIGNABLE_TO_THE_CONSTRAINT_OF_TYPE_1_BUT_1_COULD_BE_INSTANTIATED_WITH_A_DIFFERENT_SUBTYPE_OF_CONSTRAINT_2,
                    &[
                        Arg::Str(&source_type),
                        Arg::Str(&target_type),
                        Arg::Str(&constraint_text),
                    ],
                );
            } else {
                // Only report this error once
                c.relaters[r].error_chain = ErrorChainId::NIL;
                r.report_error(
                    c,
                    diagnostics::X_0_COULD_BE_INSTANTIATED_WITH_AN_ARBITRARY_TYPE_WHICH_COULD_BE_UNRELATED_TO_1,
                    &[Arg::Str(&target_type), Arg::Str(&generalized_source_type)],
                );
            }
        }
        if message.is_nil() {
            if c.relaters[r].relation == RelationKind::Comparable {
                message = diagnostics::TYPE_0_IS_NOT_COMPARABLE_TO_TYPE_1;
            } else if source_type == target_type {
                message = diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_TWO_DIFFERENT_TYPES_WITH_THIS_NAME_EXIST_BUT_THEY_ARE_UNRELATED;
            } else if c.exact_optional_property_types
                && c.get_exact_optional_unassignable_properties(source, target)
                    .len()
                    != 0
            {
                message = diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_WITH_EXACTOPTIONALPROPERTYTYPES_COLON_TRUE_CONSIDER_ADDING_UNDEFINED_TO_THE_TYPES_OF_THE_TARGET_S_PROPERTIES;
            } else {
                if c.types[source].flags.intersects(TypeFlags::STRING_LITERAL)
                    && c.types[target].flags.intersects(TypeFlags::UNION)
                {
                    let suggested_type =
                        c.get_suggested_type_for_nonexistent_string_literal_type(source, target);
                    if !suggested_type.is_nil() {
                        let suggested_text = c.type_to_string_exported(suggested_type);
                        r.report_error(
                            c,
                            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_DID_YOU_MEAN_2,
                            &[
                                Arg::Str(&generalized_source_type),
                                Arg::Str(&target_type),
                                Arg::Str(&suggested_text),
                            ],
                        );
                        return;
                    }
                }
                message = diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1;
            }
        } else if message
            == diagnostics::ARGUMENT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_PARAMETER_OF_TYPE_1
            && c.exact_optional_property_types
            && c.get_exact_optional_unassignable_properties(source, target)
                .len()
                > 0
        {
            message = diagnostics::ARGUMENT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_PARAMETER_OF_TYPE_1_WITH_EXACTOPTIONALPROPERTYTYPES_COLON_TRUE_CONSIDER_ADDING_UNDEFINED_TO_THE_TYPES_OF_THE_TARGET_S_PROPERTIES;
        }
        let chain_message = r.get_chain_message(c, 0);
        if chain_message
            == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1
            || chain_message
                == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2
        {
            // Suppress if next message is an excess property error
            return;
        } else if chain_message == diagnostics::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1
            || chain_message
                == diagnostics::THE_TYPE_0_IS_READONLY_AND_CANNOT_BE_ASSIGNED_TO_THE_MUTABLE_TYPE_1
        {
            // Suppress if next message is an excessive complexity/stack depth message for source and target or a readonly vs. mutable error for source and target
            if r.chain_args_match(
                c,
                &[
                    Some(Arg::Str(&generalized_source_type)),
                    Some(Arg::Str(&target_type)),
                ],
            ) {
                return;
            }
        } else if chain_message
            == diagnostics::PROPERTY_0_IS_MISSING_IN_TYPE_1_BUT_REQUIRED_IN_TYPE_2
        {
            // Suppress if next message is a missing property message for source and target and we're not reporting on conversion or interface implementation
            if !is_conversion_or_interface_implementation_message(message)
                && r.chain_args_match(
                    c,
                    &[
                        None,
                        Some(Arg::Str(&generalized_source_type)),
                        Some(Arg::Str(&target_type)),
                    ],
                )
            {
                return;
            }
        } else if chain_message
            == diagnostics::TYPE_0_IS_MISSING_THE_FOLLOWING_PROPERTIES_FROM_TYPE_1_COLON_2_AND_3_MORE
            || chain_message
                == diagnostics::TYPE_0_IS_MISSING_THE_FOLLOWING_PROPERTIES_FROM_TYPE_1_COLON_2
        {
            if !is_conversion_or_interface_implementation_message(message)
                && r.chain_args_match(
                    c,
                    &[
                        Some(Arg::Str(&generalized_source_type)),
                        Some(Arg::Str(&target_type)),
                    ],
                )
            {
                return;
            }
        }
        r.report_error(
            c,
            message,
            &[Arg::Str(&generalized_source_type), Arg::Str(&target_type)],
        );
    }

    pub fn report_error<'a>(
        self,
        c: &mut Checker<'a>,
        mut message: MessageId,
        caller_args: &[Arg<'_>],
    ) {
        let r = self;
        // The chain outlives the call and the variadic slice is written below: the arguments are copied, every text into the arena of the checker.
        let mut args: Vec<Arg<'a>> = Vec::with_capacity(caller_args.len());
        for arg in caller_args {
            args.push(match *arg {
                Arg::Str(s) => Arg::Str(c.text(s)),
                Arg::Int(v) => Arg::Int(v),
                Arg::Bool(v) => Arg::Bool(v),
            });
        }
        if message == diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE {
            // Suppress if next message is an excess property error
            let next = r.get_chain_message(c, 0);
            if next
                == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1
                || next
                    == diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2
            {
                return;
            }
            // Transform a property incompatibility message for property 'x' followed by some elaboration message followed by a signature return type incompatibility message into a single return type incompatibility message for 'x()' or 'x(...)'
            let first = args.first().copied().unwrap_or_default();
            let mut arg: Vec<u8> = Vec::new();
            let second = r.get_chain_message(c, 1);
            if second
                == diagnostics::CALL_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1
            {
                arg = [get_property_name_arg(c, first).as_slice(), b"()"].concat();
            } else if second
                == diagnostics::CONSTRUCT_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1
            {
                arg = [b"new ", get_property_name_arg(c, first).as_slice(), b"()"].concat();
            } else if second == diagnostics::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE {
                arg = [get_property_name_arg(c, first).as_slice(), b"(...)"].concat();
            } else if second
                == diagnostics::CONSTRUCT_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE
            {
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
                r.report_error(c, message, &[Arg::Str(&arg)]);
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
}

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

impl RelaterId {
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

    // Return true if the arguments of the first entry on the error chain match the given arguments (where nil acts as a wildcard).
    pub fn chain_args_match(self, c: &Checker<'_>, args: &[Option<Arg<'_>>]) -> bool {
        let chain = c.relaters[self].error_chain;
        let chain_args = c.relaters[self].error_chains[chain].args;
        for (i, a) in args.iter().enumerate() {
            if let Some(a) = a {
                if *a != chain_args.at(i) {
                    return false;
                }
            }
        }
        true
    }
}

// `arg.(string)` is a type assertion: another kind of argument is a fault.
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

pub fn is_conversion_or_interface_implementation_message(message: MessageId) -> bool {
    message == diagnostics::CLASS_0_INCORRECTLY_IMPLEMENTS_INTERFACE_1
        || message
            == diagnostics::CLASS_0_INCORRECTLY_IMPLEMENTS_CLASS_1_DID_YOU_MEAN_TO_EXTEND_1_AND_INHERIT_ITS_MEMBERS_AS_A_SUBCLASS
        || message
            == diagnostics::CONVERSION_OF_TYPE_0_TO_TYPE_1_MAY_BE_A_MISTAKE_BECAUSE_NEITHER_TYPE_SUFFICIENTLY_OVERLAPS_WITH_THE_OTHER_IF_THIS_WAS_INTENTIONAL_CONVERT_THE_EXPRESSION_TO_UNKNOWN_FIRST
        || message == diagnostics::ITS_INSTANCE_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT
        || message == diagnostics::ITS_RETURN_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT
        || message == diagnostics::ITS_ELEMENT_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT
}

// The chain nodes are records of the relater, so it is a parameter.
pub fn chain_depth(c: &Checker<'_>, r: RelaterId, mut chain: ErrorChainId) -> isize {
    let mut depth: isize = 0;
    while !chain.is_nil() {
        depth += 1;
        chain = c.relaters[r].error_chains[chain].next;
    }
    depth
}

impl<'a> Checker<'a> {
    // An object type S is considered to be derived from an object type T if S is a union type and every constituent of S is derived from T, T is a union type and S is derived from at least one constituent of T, or S is an intersection type and some constituent of S is derived from T, or S is a type variable with a base constraint that is derived from T, or T is {} and S is an object-like type (ensuring {} is less derived than Object), or T is one of the global types Object and Function and S is a subtype of T, or T occurs directly or indirectly in an 'extends' clause of S. Note that this check ignores type parameters and only considers the inheritance hierarchy.
    pub fn is_type_derived_from(&mut self, source: TypeId, target: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let source_flags = self.types[source].flags;
        if source_flags.intersects(TypeFlags::UNION) {
            for &t in self.type_types(source).as_slice() {
                if !self.is_type_derived_from(t, target) {
                    return false;
                }
            }
            return true;
        }
        if self.types[target].flags.intersects(TypeFlags::UNION) {
            for &t in self.type_types(target).as_slice() {
                if self.is_type_derived_from(source, t) {
                    return true;
                }
            }
            return false;
        }
        if source_flags.intersects(TypeFlags::INTERSECTION) {
            for &t in self.type_types(source).as_slice() {
                if self.is_type_derived_from(t, target) {
                    return true;
                }
            }
            return false;
        }
        if source_flags.intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE) {
            let mut constraint = self.get_base_constraint_of_type(source);
            if constraint.is_nil() {
                constraint = self.unknown_type;
            }
            return self.is_type_derived_from(constraint, target);
        }
        if self.is_empty_anonymous_object_type(target) {
            return source_flags.intersects(TypeFlags::OBJECT | TypeFlags::NON_PRIMITIVE);
        }
        if target == self.global_object_type {
            return source_flags.intersects(TypeFlags::OBJECT | TypeFlags::NON_PRIMITIVE)
                && !self.is_empty_anonymous_object_type(source);
        }
        if target == self.global_function_type {
            return source_flags.intersects(TypeFlags::OBJECT)
                && self.is_function_object_type(source);
        }
        let target_type = self.get_target_type(target);
        self.has_base_type(source, target_type)
            || (self.is_array_type(target)
                && !self.is_readonly_array_type(target)
                && self.is_type_derived_from(source, self.global_readonly_array_type))
    }

    pub fn is_distribution_dependent(&mut self, root: ConditionalRootId) -> bool {
        if !self.conditional_roots[root].is_distributive {
            return false;
        }
        let check_type = self.conditional_roots[root].check_type;
        let node = self
            .ast
            .as_conditional_type_node(self.conditional_roots[root].node);
        self.is_type_parameter_possibly_referenced(check_type, node.true_type)
            || self.is_type_parameter_possibly_referenced(check_type, node.false_type)
    }
}

// checker.go 11995-12038, 13208-13219, 27988-28023 and 28163-28248: the functions of the relation layer that upstream keeps in checker.go, in upstream order.
impl<'a> Checker<'a> {
    // Invoke the callback for each underlying property symbol of the given symbol and return the first value that isn't undefined.
    pub fn for_each_property(
        &mut self,
        prop: SymbolId,
        callback: &mut dyn FnMut(&mut Checker<'a>, SymbolId) -> bool,
    ) -> bool {
        if !self
            .ast
            .sym(prop)
            .check_flags
            .intersects(CheckFlags::SYNTHETIC)
        {
            return callback(self, prop);
        }
        let links = self.value_symbol_links_get(prop);
        let containing_type = self.value_symbol_links[links].containing_type;
        let name = self.ast.sym(prop).name;
        for &t in self.type_types(containing_type).as_slice() {
            let p = self.get_property_of_type(t, name);
            if !p.is_nil() && self.for_each_property(p, &mut *callback) {
                return true;
            }
        }
        false
    }

    // Return the declaring class type of a property or undefined if property not declared in class
    pub fn get_declaring_class(&mut self, prop: SymbolId) -> TypeId {
        let parent = self.ast.sym(prop).parent;
        if !parent.is_nil() && self.ast.sym(parent).flags.intersects(SymbolFlags::CLASS) {
            let parent_symbol = self.get_parent_of_symbol(prop);
            return self.get_declared_type_of_symbol(parent_symbol);
        }
        TypeId::NIL
    }

    // Return true if source property is a valid override of protected parts of target property.
    pub fn is_valid_override_of(&mut self, source_prop: SymbolId, target_prop: SymbolId) -> bool {
        !self.for_each_property(target_prop, &mut |c, tp| {
            if get_declaration_modifier_flags_from_symbol(c.ast, tp)
                .intersects(ModifierFlags::PROTECTED)
            {
                let declaring_class = c.get_declaring_class(tp);
                return !c.is_property_in_class_derived_from(source_prop, declaring_class);
            }
            false
        })
    }

    // Return true if some underlying source property is declared in a class that derives from the given base class.
    pub fn is_property_in_class_derived_from(
        &mut self,
        prop: SymbolId,
        base_class: TypeId,
    ) -> bool {
        self.for_each_property(prop, &mut |c, sp| {
            let source_class = c.get_declaring_class(sp);
            if !source_class.is_nil() {
                return c.has_base_type(source_class, base_class);
            }
            false
        })
    }

    pub fn get_exact_optional_unassignable_properties(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> List<'a, SymbolId> {
        if is_tuple_type(self, source) && is_tuple_type(self, target) {
            return List::NIL;
        }
        let properties = self.get_properties_of_type(target);
        self.filter(properties, |c, target_prop| {
            let name = c.ast.sym(target_prop).name;
            let source_prop_type = c.get_type_of_property_of_type(source, name);
            let target_prop_type = c.get_type_of_symbol(target_prop);
            c.is_exact_optional_property_mismatch(source_prop_type, target_prop_type)
        })
    }

    pub fn is_exact_optional_property_mismatch(&mut self, source: TypeId, target: TypeId) -> bool {
        !source.is_nil()
            && !target.is_nil()
            && self.maybe_type_of_kind(source, TypeFlags::UNDEFINED)
            && self.contains_missing_type(target)
    }

    // Two types that normalize to each other never reach a fixed point: the loop has a budget, and the entry tests the stack.
    pub fn get_normalized_type(&mut self, mut t: TypeId, writing: bool) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            self.stack_limit::<()>();
            return t;
        }
        let mut guard = LoopGuard::new();
        loop {
            if !guard.turn() {
                self.loop_limit("getNormalizedType");
                return t;
            }
            let flags = self.types[t].flags;
            let n;
            if is_fresh_literal_type(self, t) {
                n = self.as_literal_type(t).regular_type;
            } else if is_generic_tuple_type(self, t) {
                n = self.get_normalized_tuple_type(t, writing);
            } else if self.types[t]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            {
                if !self.as_type_reference(t).node.is_nil() {
                    let target = self.type_target(t);
                    let type_arguments = self.get_type_arguments(t);
                    n = self.create_type_reference(target, type_arguments);
                } else {
                    let base = self.get_single_base_for_non_augmenting_subtype(t);
                    n = if base.is_nil() { t } else { base };
                }
            } else if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
                n = self.get_normalized_union_or_intersection_type(t, writing);
            } else if flags.intersects(TypeFlags::SUBSTITUTION) {
                if writing {
                    n = self.as_substitution_type(t).base_type;
                } else {
                    n = self.get_substitution_intersection(t);
                }
            } else if flags.intersects(TypeFlags::SIMPLIFIABLE) {
                n = self.get_simplified_type(t, writing);
            } else {
                return t;
            }
            if n == t {
                return n;
            }
            t = n;
        }
    }

    pub fn get_normalized_union_or_intersection_type(
        &mut self,
        t: TypeId,
        writing: bool,
    ) -> TypeId {
        let reduced = self.get_reduced_type(t);
        if reduced != t {
            return reduced;
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION)
            && self.should_normalize_intersection(t)
        {
            // Normalization handles cases like Partial<T>[K] & ({} | null) ==> Partial<T>[K] & {} | Partial<T>[K} & null ==> (T[K] | undefined) & {} | (T[K] | undefined) & null ==> T[K] & {} | undefined & {} | T[K] & null | undefined & null ==> T[K] & {} | T[K] & null
            let types = self.type_types(t);
            let normalized_types = self.same_map(types, |c, u| c.get_normalized_type(u, writing));
            if !same(normalized_types.as_slice(), types.as_slice()) {
                return self.get_intersection_type(normalized_types);
            }
        }
        t
    }

    pub fn should_normalize_intersection(&mut self, t: TypeId) -> bool {
        let mut has_instantiable = false;
        let mut has_nullable_or_empty = false;
        for &t in self.type_types(t).as_slice() {
            has_instantiable =
                has_instantiable || self.types[t].flags.intersects(TypeFlags::INSTANTIABLE);
            has_nullable_or_empty = has_nullable_or_empty
                || self.types[t].flags.intersects(TypeFlags::NULLABLE)
                || self.is_empty_anonymous_object_type(t);
            if has_instantiable && has_nullable_or_empty {
                return true;
            }
        }
        false
    }

    pub fn get_normalized_tuple_type(&mut self, t: TypeId, writing: bool) -> TypeId {
        let elements = self.get_element_types(t);
        let normalized_elements = self.same_map(elements, |c, t| {
            if c.types[t].flags.intersects(TypeFlags::SIMPLIFIABLE) {
                return c.get_simplified_type(t, writing);
            }
            t
        });
        if !same(elements.as_slice(), normalized_elements.as_slice()) {
            let target = self.type_target(t);
            return self.create_normalized_tuple_type(target, normalized_elements);
        }
        t
    }

    pub fn get_single_base_for_non_augmenting_subtype(&mut self, t: TypeId) -> TypeId {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
            || !self.types[self.type_target(t)]
                .object_flags
                .intersects(ObjectFlags::CLASS_OR_INTERFACE)
        {
            return TypeId::NIL;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::EQUIVALENT_BASE_TYPE,
            type_id: t,
        };
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::IDENTICAL_BASE_TYPE_CALCULATED)
        {
            return self.cached_types.get(&key);
        }
        self.types[t].object_flags |= ObjectFlags::IDENTICAL_BASE_TYPE_CALCULATED;
        let target = self.type_target(t);
        if self.types[target]
            .object_flags
            .intersects(ObjectFlags::CLASS)
        {
            let base_type_node = get_base_type_node_of_class(self, target);
            // A base type expression may circularly reference the class itself (e.g. as an argument to function call), so we only check for base types specified as simple qualified names.
            if !base_type_node.is_nil() {
                let expression = self.ast.expression(base_type_node);
                if !is_identifier(self.ast, expression)
                    && !is_property_access_expression(self.ast, expression)
                {
                    return TypeId::NIL;
                }
            }
        }
        let bases = self.get_base_types(target);
        if bases.len() != 1 {
            return TypeId::NIL;
        }
        let symbol = self.types[t].symbol;
        let members = self.get_members_of_symbol(symbol);
        if self.ast.table_len(members) != 0 {
            // If the interface has any members, they may subtype members in the base, so we should do a full structural comparison
            return TypeId::NIL;
        }
        let type_parameters = self.as_interface_type(target).type_parameters();
        let mut instantiated_base;
        if type_parameters.len() == 0 {
            instantiated_base = bases.at(0usize);
        } else {
            let type_arguments = self.get_type_arguments(t);
            let mapper = new_type_mapper(
                self,
                type_parameters,
                List::from_slice(sub_slice(
                    type_arguments.as_slice(),
                    0,
                    type_parameters.len(),
                )),
            );
            instantiated_base = self.instantiate_type(bases.at(0usize), mapper);
        }
        let type_arguments = self.get_type_arguments(t);
        if type_arguments.len() > type_parameters.len() {
            let type_arguments = self.get_type_arguments(t);
            let this_argument = type_arguments.at(type_arguments.len() - 1);
            instantiated_base =
                self.get_type_with_this_argument(instantiated_base, this_argument, false);
        }
        let ok = self.cached_types.set(key, instantiated_base);
        self.map_set(ok);
        instantiated_base
    }
}
