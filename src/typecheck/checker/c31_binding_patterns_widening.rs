// checker.go:17777-18859 (layers T-SYMTYPE, T-JSDECL, T-WIDEN): types of binding elements and binding patterns, rest types, synthetic element accesses for destructuring, JavaScript assignment declarations, widening of declared types, implicit any reports, types of enum members, accessors and aliases, optionality and nullability, cached combined flags and effective property names.
use crate::ast::{
    Arg, Factory, INTERNAL_SYMBOL_NAME_MISSING, JSDeclarationKind, Kind, ModifierFlags,
    NodeFactory, NodeFlags, NodeId, SymbolFlags, SymbolId, TokenFlags,
    get_assignment_declaration_kind, get_combined_modifier_flags, get_combined_node_flags,
    get_declaration_of_kind, get_name_of_declaration, get_property_name_for_property_name_node,
    get_right_most_assigned_expression, get_root_declaration, get_source_file_of_node,
    is_auto_accessor_property_declaration, is_binary_expression, is_binding_element,
    is_binding_pattern, is_call_expression, is_call_signature_declaration,
    is_check_js_enabled_for_file, is_computed_property_name,
    is_function_expression_or_arrow_function, is_function_like, is_function_type_node,
    is_identifier, is_in_js_file, is_left_hand_side_expression, is_method_signature_declaration,
    is_object_binding_pattern, is_parameter_declaration, is_part_of_parameter_declaration,
    is_string_or_numeric_literal_like, is_type_node_kind, skip_parentheses,
    walk_up_binding_elements_and_patterns,
};
use crate::checker::{
    AccessFlags, CachedTypeKey, CachedTypeKind, CheckMode, Checker, ElementFlags, IndexInfoId,
    IterationUse, ObjectFlags, ThisAssignmentDeclarationKind, TupleElementInfo, TypeAliasId,
    TypeFacts, TypeFlags, TypeId, TypeSystemEntity, TypeSystemPropertyName, UnionReduction,
    WideningContext, WideningContextId, WideningKind,
    declaration_belongs_to_private_ambient_member, every_type,
    get_declaration_modifier_flags_from_symbol, get_flow_node_of_node, get_number_literal_value,
    get_property_name_from_type, get_string_literal_value, has_dot_dot_dot_token,
    is_object_literal_type, is_optional_declaration, is_private_within_ambient, is_tuple_type,
    is_type_any, is_type_usable_as_property_name,
};
use crate::collections::OrderedMap;
use crate::core::{List, Map, ScriptTarget, Text, append_if_unique, find};
use crate::diagnostics::{self, MessageId};
use crate::jsnum::Number;
use crate::scanner::{declaration_name_to_string, identifier_to_keyword_kind};
use std::borrow::Cow;

impl<'a> Checker<'a> {
    pub fn is_null_or_undefined(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let expr = skip_parentheses(a, node);
        match a.kind(expr) {
            Kind::NullKeyword => true,
            Kind::Identifier => self.get_resolved_symbol(expr) == self.undefined_symbol,
            _ => false,
        }
    }

    pub fn check_right_hand_side_of_for_of(&mut self, statement: NodeId) -> TypeId {
        let a = self.ast;
        let use_ = if !a
            .as_for_in_or_of_statement(statement)
            .await_modifier
            .is_nil()
        {
            IterationUse::FOR_AWAIT_OF
        } else {
            IterationUse::FOR_OF
        };
        let expression = a.expression(statement);
        let input_type = self.check_non_null_expression(expression);
        self.check_iterated_type_or_element_type(use_, input_type, self.undefined_type, expression)
    }

    // Return the inferred type for a binding element
    pub fn get_type_for_binding_element(&mut self, declaration: NodeId) -> TypeId {
        let a = self.ast;
        let check_mode = if has_dot_dot_dot_token(a, declaration) {
            CheckMode::REST_BINDING_ELEMENT
        } else {
            CheckMode::NORMAL
        };
        let parent_type =
            self.get_type_for_binding_element_parent(a.parent(a.parent(declaration)), check_mode);
        if !parent_type.is_nil() {
            return self.get_binding_element_type_from_parent_type(declaration, parent_type, false);
        }
        TypeId::NIL
    }

    // Return the type of a binding element parent. We check SymbolLinks first to see if a type has been assigned by contextual typing.
    pub fn get_type_for_binding_element_parent(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        if check_mode == CheckMode::NORMAL {
            // We can use a cached resolved type if no optionality was included in that type.
            let symbol = self.get_symbol_of_declaration(node);
            if !symbol.is_nil() {
                let links = self.value_symbol_links_get(symbol);
                let resolved_type = self.value_symbol_links[links].resolved_type;
                if !resolved_type.is_nil()
                    && !(self.strict_null_checks && is_optional_declaration(self.ast, node))
                {
                    return resolved_type;
                }
            }
        }
        self.get_type_for_variable_like_declaration(node, false, check_mode)
    }

    pub fn get_binding_element_type_from_parent_type(
        &mut self,
        declaration: NodeId,
        parent_type: TypeId,
        no_tuple_bounds_check: bool,
    ) -> TypeId {
        let a = self.ast;
        let mut parent_type = parent_type;
        // If an any type was inferred for parent, infer that for the binding element
        if is_type_any(self, parent_type) {
            return parent_type;
        }
        let pattern = a.parent(declaration);
        // Relax null check on ambient destructuring parameters, since the parameters have no implementation and are just documentation
        if self.strict_null_checks
            && a.flags(declaration).intersects(NodeFlags::AMBIENT)
            && is_part_of_parameter_declaration(a, declaration)
        {
            parent_type = self.get_non_nullable_type(parent_type);
        } else if self.strict_null_checks && !a.initializer(a.parent(pattern)).is_nil() {
            let initializer_type = self.get_type_of_initializer(a.initializer(a.parent(pattern)));
            if !self.has_type_facts(initializer_type, TypeFacts::EQ_UNDEFINED) {
                parent_type = self.get_type_with_facts(parent_type, TypeFacts::NE_UNDEFINED);
            }
        }
        let access_flags = AccessFlags::EXPRESSION_POSITION
            | if no_tuple_bounds_check || self.has_default_value(declaration) {
                AccessFlags::ALLOW_MISSING
            } else {
                AccessFlags::NONE
            };
        let t;
        match a.kind(pattern) {
            Kind::ObjectBindingPattern => {
                if has_dot_dot_dot_token(a, declaration) {
                    parent_type = self.get_reduced_type(parent_type);
                    if self.types[parent_type].flags.intersects(TypeFlags::UNKNOWN)
                        || !self.is_valid_spread_type(parent_type)
                    {
                        self.error(
                            declaration,
                            diagnostics::REST_TYPES_MAY_ONLY_BE_CREATED_FROM_OBJECT_TYPES,
                            &[],
                        );
                        return self.error_type;
                    }
                    let elements = a.elements(pattern);
                    let mut literal_members: Vec<NodeId> =
                        Vec::with_capacity(elements.as_slice().len());
                    for &element in elements.as_slice() {
                        if !has_dot_dot_dot_token(a, element) {
                            let name = a.property_name_or_name(element);
                            literal_members.push(name);
                        }
                    }
                    t = self.get_rest_type(
                        parent_type,
                        List::from_slice(&literal_members),
                        a.symbol(declaration),
                    );
                } else {
                    // Use explicitly specified property name ({ p: xxx } form), or otherwise the implied name ({ p } form)
                    let name = a.property_name_or_name(declaration);
                    let index_type = self.get_literal_type_from_property_name(name);
                    let declared_type = self.get_indexed_access_type_ex(
                        parent_type,
                        index_type,
                        access_flags,
                        name,
                        TypeAliasId::NIL,
                    );
                    t = self.get_flow_type_of_destructuring(declaration, declared_type);
                }
            }
            Kind::ArrayBindingPattern => {
                // This elementType will be used if the specific property corresponding to this index is not present (aka the tuple element property). This call also checks that the parentType is in fact an iterable or array (depending on target language).
                let use_ = IterationUse::DESTRUCTURING
                    | if has_dot_dot_dot_token(a, declaration) {
                        IterationUse::NONE
                    } else {
                        IterationUse::POSSIBLY_OUT_OF_BOUNDS
                    };
                let element_type = self.check_iterated_type_or_element_type(
                    use_,
                    parent_type,
                    self.undefined_type,
                    pattern,
                );
                let index = a
                    .elements(pattern)
                    .as_slice()
                    .iter()
                    .position(|&element| element == declaration)
                    .map_or(-1, |index| index as isize);
                if has_dot_dot_dot_token(a, declaration) {
                    // If the parent is a tuple type, the rest element has a tuple type of the remaining tuple element types. Otherwise, the rest element has an array type with same element type as the parent type.
                    let base_constraint = self.map_type(parent_type, &mut |c, t| {
                        if c.types[t]
                            .flags
                            .intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
                        {
                            return c.get_base_constraint_or_type(t);
                        }
                        t
                    });
                    if every_type(self, base_constraint, &mut |c, t| is_tuple_type(c, t)) {
                        t = self
                            .map_type(base_constraint, &mut |c, t| c.slice_tuple_type(t, index, 0));
                    } else {
                        t = self.create_array_type(element_type);
                    }
                } else if self.is_array_like_type(parent_type) {
                    let index_type = self.get_number_literal_type(Number(index as f64));
                    let mut declared_type = self.get_indexed_access_type_or_undefined(
                        parent_type,
                        index_type,
                        access_flags,
                        a.name(declaration),
                        TypeAliasId::NIL,
                    );
                    if declared_type.is_nil() {
                        declared_type = self.error_type;
                    }
                    t = self.get_flow_type_of_destructuring(declaration, declared_type);
                } else {
                    t = element_type;
                }
            }
            kind => {
                return self.fail_detail(
                    "Unhandled case in getBindingElementTypeFromParentType",
                    kind as u32,
                );
            }
        }
        if a.initializer(declaration).is_nil() {
            return t;
        }
        if !a
            .type_node(walk_up_binding_elements_and_patterns(a, declaration))
            .is_nil()
        {
            // In strict null checking mode, if a default value of a non-undefined type is specified, remove undefined from the final type.
            if self.strict_null_checks {
                let initializer_type =
                    self.check_declaration_initializer(declaration, CheckMode::NORMAL, TypeId::NIL);
                if !self.has_type_facts(initializer_type, TypeFacts::IS_UNDEFINED) {
                    return self.get_non_undefined_type(t);
                }
            }
            return t;
        }
        let non_undefined_type = self.get_non_undefined_type(t);
        let initializer_type =
            self.check_declaration_initializer(declaration, CheckMode::NORMAL, TypeId::NIL);
        let union_type = self.get_union_type_ex(
            List::from_slice(&[non_undefined_type, initializer_type]),
            UnionReduction::SUBTYPE,
            TypeAliasId::NIL,
            TypeId::NIL,
        );
        self.widen_type_inferred_from_initializer(declaration, union_type)
    }

    pub fn get_rest_type(
        &mut self,
        source: TypeId,
        properties: List<'_, NodeId>,
        symbol: SymbolId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let source = self.filter_type(source, &mut |c, t| {
            !c.types[t].flags.intersects(TypeFlags::NULLABLE)
        });
        if self.types[source].flags.intersects(TypeFlags::NEVER) {
            return self.empty_object_type;
        }
        if self.types[source].flags.intersects(TypeFlags::UNION) {
            return self.map_type(source, &mut |c, t| c.get_rest_type(t, properties, symbol));
        }
        let mut key_types: Vec<TypeId> = Vec::with_capacity(properties.as_slice().len());
        for &property in properties.as_slice() {
            let key_type = self.get_literal_type_from_property_name(property);
            key_types.push(key_type);
        }
        let mut omit_key_type = self.get_union_type(List::from_slice(&key_types));
        let mut spreadable_properties: Vec<SymbolId> = Vec::new();
        let mut unspreadable_to_rest_keys: Vec<TypeId> = Vec::new();
        let source_properties = self.get_properties_of_type(source);
        for &prop in source_properties.as_slice() {
            let literal_type_from_property = self.get_literal_type_from_property(
                prop,
                TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                false,
            );
            if !self.is_type_assignable_to(literal_type_from_property, omit_key_type)
                && !get_declaration_modifier_flags_from_symbol(a, prop)
                    .intersects(ModifierFlags::PRIVATE | ModifierFlags::PROTECTED)
                && self.is_spreadable_property(prop)
            {
                spreadable_properties.push(prop);
            } else {
                unspreadable_to_rest_keys.push(literal_type_from_property);
            }
        }
        if self.is_generic_object_type(source) || self.is_generic_index_type(omit_key_type) {
            if !unspreadable_to_rest_keys.is_empty() {
                // If the type we're spreading from has properties that cannot be spread into the rest type (e.g. getters, methods), ensure they are explicitly omitted, as they would in the non-generic case.
                let mut omit_key_types: Vec<TypeId> =
                    Vec::with_capacity(unspreadable_to_rest_keys.len() + 1);
                omit_key_types.push(omit_key_type);
                omit_key_types.extend_from_slice(&unspreadable_to_rest_keys);
                omit_key_type = self.get_union_type(List::from_slice(&omit_key_types));
            }
            if self.types[omit_key_type].flags.intersects(TypeFlags::NEVER) {
                return source;
            }
            let omit_type_alias = self.get_global_omit_symbol();
            if omit_type_alias.is_nil() {
                return self.error_type;
            }
            return self.get_type_alias_instantiation(
                omit_type_alias,
                List::from_slice(&[source, omit_key_type]),
                TypeAliasId::NIL,
            );
        }
        let members = a.new_table();
        for &prop in &spreadable_properties {
            let spread_symbol = self.get_spread_symbol(prop, false);
            a.table_set(members, a.sym(prop).name, spread_symbol);
        }
        let index_infos = self.get_index_infos_of_type(source);
        let result = self.new_anonymous_type(symbol, members, List::NIL, List::NIL, index_infos);
        self.types[result].object_flags |= ObjectFlags::OBJECT_REST_TYPE;
        result
    }

    // Determine the control flow type associated with a destructuring declaration or assignment. The following forms of destructuring are possible: `let { x } = obj;` (BindingElement), `let [ x ] = obj;` (BindingElement), `{ x } = obj;` (ShorthandPropertyAssignment), `{ x: v } = obj;` (PropertyAssignment), `[ x ] = obj;` (Expression). We construct a synthetic element access expression corresponding to 'obj.x' such that the control flow analyzer doesn't have to handle all the different syntactic forms.
    pub fn get_flow_type_of_destructuring(
        &mut self,
        node: NodeId,
        declared_type: TypeId,
    ) -> TypeId {
        let reference = self.get_synthetic_element_access(node);
        if !reference.is_nil() {
            return self.get_flow_type_of_reference(reference, declared_type);
        }
        declared_type
    }

    pub fn get_synthetic_element_access(&mut self, node: NodeId) -> NodeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent_access = self.get_parent_element_access(node);
        if !parent_access.is_nil() && !get_flow_node_of_node(a, parent_access).is_nil() {
            let (prop_name, ok) = self.get_destructuring_property_name(node);
            if ok {
                let mut factory = Factory::new(a);
                let literal = factory.new_string_literal(&prop_name, TokenFlags::NONE);
                a.set_loc(literal, a.loc(node));
                let mut lhs_expr = parent_access;
                if !is_left_hand_side_expression(a, parent_access) {
                    lhs_expr = factory.new_parenthesized_expression(parent_access);
                    a.set_loc(lhs_expr, a.loc(node));
                }
                let result = factory.new_element_access_expression(
                    lhs_expr,
                    NodeId::NIL,
                    literal,
                    NodeFlags::NONE,
                );
                a.set_loc(result, a.loc(node));
                a.set_parent(literal, result);
                a.set_parent(result, node);
                if lhs_expr != parent_access {
                    a.set_parent(lhs_expr, result);
                }
                a.set_flow_node(result, get_flow_node_of_node(a, parent_access));
                return result;
            }
        }
        NodeId::NIL
    }

    pub fn get_parent_element_access(&mut self, node: NodeId) -> NodeId {
        let a = self.ast;
        let ancestor = a.parent(a.parent(node));
        match a.kind(ancestor) {
            Kind::BindingElement | Kind::PropertyAssignment => {
                self.get_synthetic_element_access(ancestor)
            }
            Kind::ArrayLiteralExpression => self.get_synthetic_element_access(a.parent(node)),
            Kind::VariableDeclaration => a.initializer(ancestor),
            Kind::BinaryExpression => a.as_binary_expression(ancestor).right,
            _ => NodeId::NIL,
        }
    }

    // Return the type implied by a binding pattern. This is the type implied purely by the binding pattern itself and without regard to its context (i.e. without regard any type annotation or initializer associated with the declaration in which the binding pattern is contained). For example, the implied type of [x, y] is [any, any] and the implied type of { x, y: z = 1 } is { x: any; y: number; }. The type implied by a binding pattern is used as the contextual type of an initializer associated with the binding pattern. Also, for a destructuring parameter with no type annotation or initializer, the type implied by the binding pattern becomes the type of the parameter.
    pub fn get_type_from_binding_pattern(
        &mut self,
        pattern: NodeId,
        include_pattern_in_type: bool,
        report_errors: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if include_pattern_in_type {
            self.contextual_binding_patterns.push(pattern);
        }
        let result = if is_object_binding_pattern(self.ast, pattern) {
            self.get_type_from_object_binding_pattern(
                pattern,
                include_pattern_in_type,
                report_errors,
            )
        } else {
            self.get_type_from_array_binding_pattern(
                pattern,
                include_pattern_in_type,
                report_errors,
            )
        };
        if include_pattern_in_type && self.contextual_binding_patterns.pop().is_none() {
            let _: () = self.fail("slice bounds out of range [:-1]");
        }
        result
    }

    // Return the type implied by an object binding pattern
    pub fn get_type_from_object_binding_pattern(
        &mut self,
        pattern: NodeId,
        include_pattern_in_type: bool,
        report_errors: bool,
    ) -> TypeId {
        let a = self.ast;
        let members = a.new_table();
        let mut string_index_info = IndexInfoId::NIL;
        let mut object_flags =
            ObjectFlags::OBJECT_LITERAL | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
        for &e in a.elements(pattern).as_slice() {
            let name = a.property_name_or_name(e);
            if has_dot_dot_dot_token(a, e) {
                string_index_info = self.new_index_info(
                    self.string_type,
                    self.any_type,
                    false,
                    NodeId::NIL,
                    List::NIL,
                );
                continue;
            }
            let expr_type = self.get_literal_type_from_property_name(name);
            if !is_type_usable_as_property_name(self, expr_type) {
                // do not include computed properties in the implied type
                object_flags |= ObjectFlags::OBJECT_LITERAL_PATTERN_WITH_COMPUTED_PROPERTIES;
                continue;
            }
            let text = get_property_name_from_type(self, expr_type);
            let text = self.text(&text);
            let flags = SymbolFlags::PROPERTY
                | if !a.initializer(e).is_nil() {
                    SymbolFlags::OPTIONAL
                } else {
                    SymbolFlags::NONE
                };
            let symbol = self.new_symbol(flags, text);
            let links = self.value_symbol_links_get(symbol);
            let resolved_type =
                self.get_type_from_binding_element(e, include_pattern_in_type, report_errors);
            self.value_symbol_links[links].resolved_type = resolved_type;
            a.table_set(members, a.sym(symbol).name, symbol);
        }
        let index_infos = if !string_index_info.is_nil() {
            self.list_of(&[string_index_info])
        } else {
            List::NIL
        };
        let result =
            self.new_anonymous_type(SymbolId::NIL, members, List::NIL, List::NIL, index_infos);
        self.types[result].object_flags |= object_flags;
        if include_pattern_in_type {
            let ok = self.pattern_for_type.set(result, pattern);
            self.map_set(ok);
            self.types[result].object_flags |= ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
        }
        result
    }

    // Return the type implied by an array binding pattern
    pub fn get_type_from_array_binding_pattern(
        &mut self,
        pattern: NodeId,
        include_pattern_in_type: bool,
        report_errors: bool,
    ) -> TypeId {
        let a = self.ast;
        let elements = a.elements(pattern);
        let last_element = elements.at(elements.len() - 1);
        let mut rest_element = NodeId::NIL;
        if !last_element.is_nil()
            && is_binding_element(a, last_element)
            && has_dot_dot_dot_token(a, last_element)
        {
            rest_element = last_element;
        }
        if elements.len() == 0 || elements.len() == 1 && !rest_element.is_nil() {
            if self.language_version >= ScriptTarget::ES2015 {
                return self.create_iterable_type(self.any_type);
            }
            return self.any_array_type;
        }
        // core.FindLastIndex
        let mut min_length: isize = 0;
        let mut i = elements.len() - 1;
        while i >= 0 {
            let e = elements.at(i);
            if !(e == rest_element || a.name(e).is_nil() || self.has_default_value(e)) {
                min_length = i + 1;
                break;
            }
            i -= 1;
        }
        let mut element_types: Vec<TypeId> = Vec::with_capacity(elements.as_slice().len());
        let mut element_infos: Vec<TupleElementInfo> =
            Vec::with_capacity(elements.as_slice().len());
        for (i, &e) in elements.as_slice().iter().enumerate() {
            let t = if a.name(e).is_nil() {
                self.any_type
            } else {
                self.get_type_from_binding_element(e, include_pattern_in_type, report_errors)
            };
            let flags = if e == rest_element {
                ElementFlags::REST
            } else if i as isize >= min_length {
                ElementFlags::OPTIONAL
            } else {
                ElementFlags::REQUIRED
            };
            element_types.push(t);
            element_infos.push(TupleElementInfo {
                flags,
                labeled_declaration: NodeId::NIL,
            });
        }
        let element_types = self.list_of(&element_types);
        let mut result =
            self.create_tuple_type_ex(element_types, List::from_slice(&element_infos), false);
        if include_pattern_in_type {
            result = self.clone_type_reference(result);
            let ok = self.pattern_for_type.set(result, pattern);
            self.map_set(ok);
            self.types[result].object_flags |= ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
        }
        result
    }

    // Return the type implied by a binding pattern element. This is the type of the initializer of the element if one is present. Otherwise, if the element is itself a binding pattern, it is the type implied by the binding pattern. Otherwise, it is the type any.
    pub fn get_type_from_binding_element(
        &mut self,
        element: NodeId,
        include_pattern_in_type: bool,
        report_errors: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if !a.initializer(element).is_nil() {
            // The type implied by a binding pattern is independent of context, so we check the initializer with no contextual type or, if the element itself is a binding pattern, with the type implied by that binding pattern.
            let mut contextual_type = self.unknown_type;
            if is_binding_pattern(a, a.name(element)) {
                contextual_type = self.get_type_from_binding_pattern(a.name(element), true, false);
            }
            let initializer_type =
                self.check_declaration_initializer(element, CheckMode::NORMAL, contextual_type);
            let widened_type =
                self.get_widened_literal_type_for_initializer(element, initializer_type);
            return self.add_optionality(widened_type);
        }
        if is_binding_pattern(a, a.name(element)) {
            return self.get_type_from_binding_pattern(
                a.name(element),
                include_pattern_in_type,
                report_errors,
            );
        }
        if report_errors && !self.declaration_belongs_to_private_ambient_member(element) {
            self.report_implicit_any(element, self.any_type, WideningKind::NORMAL);
        }
        // When we're including the pattern in the type (an indication we're obtaining a contextual type), we use a non-inferrable any type. Inference will never directly infer this type, but it is possible to infer a type that contains it, e.g. for a binding pattern like [foo] or { foo }. In such cases, widening of the binding pattern type substitutes a regular any for the non-inferrable any.
        if include_pattern_in_type {
            return self.non_inferrable_any_type;
        }
        self.any_type
    }

    pub fn declaration_belongs_to_private_ambient_member(&self, declaration: NodeId) -> bool {
        let a = self.ast;
        let mut member_declaration = get_root_declaration(a, declaration);
        if is_parameter_declaration(a, member_declaration) {
            member_declaration = a.parent(member_declaration);
        }
        is_private_within_ambient(a, member_declaration)
    }

    pub fn get_type_of_prototype_property(&mut self, prototype: SymbolId) -> TypeId {
        // TypeScript 1.0 spec (April 2014): 8.4 Every class automatically contains a static property member named 'prototype', the type of which is an instantiation of the class type with type Any supplied as a type argument for each type parameter. It is an error to explicitly declare a static property member with the name 'prototype'.
        let parent = self.get_parent_of_symbol(prototype);
        let class_type = self.get_declared_type_of_symbol(parent);
        let type_parameters = self.as_interface_type(class_type).type_parameters();
        if type_parameters.len() != 0 {
            let any_type = self.any_type;
            let type_arguments: Vec<TypeId> = type_parameters
                .as_slice()
                .iter()
                .map(|_| any_type)
                .collect();
            let type_arguments = self.list_of(&type_arguments);
            return self.create_type_reference(class_type, type_arguments);
        }
        class_type
    }

    pub fn get_widened_type_for_assignment_declaration(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let mut t = TypeId::NIL;
        let (kind, location) = self.is_constructor_declared_this_property(symbol);
        if kind == ThisAssignmentDeclarationKind::TYPED {
            if location.is_nil() {
                let _: () =
                    self.fail("location should not be nil when this assignment has a type.");
            } else {
                t = self.get_type_from_type_node(location);
            }
        } else if kind == ThisAssignmentDeclarationKind::CONSTRUCTOR {
            if location.is_nil() {
                let _: () = self.fail(
                    "constructor should not be nil when this assignment is in a constructor.",
                );
            } else {
                t = self.get_flow_type_in_constructor(symbol, location);
            }
        } else if kind == ThisAssignmentDeclarationKind::METHOD {
            t = self.get_type_of_property_in_base_class(symbol);
        }
        if t.is_nil() {
            let mut types: Vec<TypeId> = Vec::new();
            let declarations = a.sym(symbol).declarations;
            for (i, &declaration) in declarations.as_slice().iter().enumerate() {
                if is_binary_expression(a, declaration) && !a.type_node(declaration).is_nil() {
                    t = self.get_type_from_type_node(a.type_node(declaration));
                    break;
                }
                let assigned_type = self.get_assignment_declaration_initializer_type(declaration);
                if !assigned_type.is_nil() {
                    // We ignore initial assignments of undefined to CommonJS exports when there are multiple assignment declarations
                    if get_assignment_declaration_kind(a, declaration)
                        != JSDeclarationKind::EXPORTS_PROPERTY
                        || i != 0
                        || a.sym(symbol).declarations.len() == 1
                        || !self.types[assigned_type]
                            .flags
                            .intersects(TypeFlags::UNDEFINED)
                    {
                        types = append_if_unique(types, assigned_type);
                    }
                }
            }
            if kind == ThisAssignmentDeclarationKind::METHOD && !types.is_empty() {
                if self.strict_null_checks {
                    types = append_if_unique(types, self.undefined_or_missing_type);
                }
            }
            if t.is_nil() {
                t = self.any_type;
                if !types.is_empty() {
                    t = self.get_union_type(List::from_slice(&types));
                }
            }
        }
        t = self.get_widened_type(t);
        // report an all-nullable or empty union as an implicit any in JS files
        let value_declaration = a.sym(symbol).value_declaration;
        if !value_declaration.is_nil() && is_in_js_file(a, value_declaration) {
            let filtered = self.filter_type(t, &mut |c, t| {
                c.types[t].flags.without(TypeFlags::NULLABLE) != TypeFlags::NONE
            });
            if filtered == self.never_type {
                self.report_implicit_any(value_declaration, self.any_type, WideningKind::NORMAL);
                return self.any_type;
            }
        }
        t
    }

    pub fn get_assignment_declaration_initializer_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if is_binary_expression(a, node) {
            let kind = get_assignment_declaration_kind(a, node);
            let t;
            if kind == JSDeclarationKind::MODULE_EXPORTS
                || kind == JSDeclarationKind::EXPORTS_PROPERTY
            {
                let expression_type =
                    self.check_expression_cached(get_right_most_assigned_expression(a, node));
                t = self.get_regular_type_of_literal_type(expression_type);
            } else {
                if kind == JSDeclarationKind::THIS_PROPERTY {
                    let binary = a.as_binary_expression(node);
                    if self.contains_same_named_this_property(binary.left, binary.right) {
                        return TypeId::NIL;
                    }
                }
                t = self.check_expression_for_mutable_location(
                    a.as_binary_expression(node).right,
                    CheckMode::NORMAL,
                );
            }
            if self.is_empty_array_literal_type(t)
                && !self.has_parent_with_type_annotation(a.symbol(node))
            {
                self.report_implicit_any(node, self.any_array_type, WideningKind::NORMAL);
                return self.any_array_type;
            }
            return t;
        }
        if is_call_expression(a, node) {
            return self.get_type_from_property_descriptor(a.arguments(node).at(2usize));
        }
        TypeId::NIL
    }

    // Return true if the parent symbol of the given assignment declaration symbol has declaration with a type annotation. For example, returns true for the symbol associated with `f.a` in `const f: { (): void, a: string[] } = () => {}; f.a = [];`.
    pub fn has_parent_with_type_annotation(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        let parent = a.sym(symbol).parent;
        if !parent.is_nil() {
            let parent_declaration = a.sym(parent).value_declaration;
            if !parent_declaration.is_nil()
                && is_function_expression_or_arrow_function(a, parent_declaration)
            {
                let possibly_annotated_symbol =
                    self.get_symbol_of_node(a.parent(parent_declaration));
                if !possibly_annotated_symbol.is_nil() {
                    let value_declaration = a.sym(possibly_annotated_symbol).value_declaration;
                    if !value_declaration.is_nil() {
                        return !a.type_node(value_declaration).is_nil();
                    }
                }
            }
        }
        false
    }

    pub fn contains_same_named_this_property(
        &mut self,
        this_property: NodeId,
        expression: NodeId,
    ) -> bool {
        fn visit(c: &mut Checker<'_>, this_property: NodeId, node: NodeId) -> bool {
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            let a = c.ast;
            if c.is_matching_reference(this_property, node) {
                return true;
            }
            if is_function_like(a, node) {
                return false;
            }
            a.for_each_child(node, &mut |child| visit(c, this_property, child))
        }
        visit(self, this_property, expression)
    }

    pub fn get_type_from_property_descriptor(&mut self, node: NodeId) -> TypeId {
        let object_literal_type = self.check_expression_cached(node);
        let value_type = self.get_type_of_property_of_type(object_literal_type, b"value");
        if !value_type.is_nil() {
            return value_type;
        }
        let get_func = self.get_type_of_property_of_type(object_literal_type, b"get");
        if !get_func.is_nil() {
            let get_sig = self.get_single_call_signature(get_func);
            if !get_sig.is_nil() {
                return self.get_return_type_of_signature(get_sig);
            }
        }
        let set_func = self.get_type_of_property_of_type(object_literal_type, b"set");
        if !set_func.is_nil() {
            let set_sig = self.get_single_call_signature(set_func);
            if !set_sig.is_nil() {
                return self.get_type_of_first_parameter_of_signature(set_sig);
            }
        }
        self.any_type
    }

    // A property is considered a constructor declared property when all declaration sites are this.xxx assignments, when no declaration sites have JSDoc type annotations, and when at least one declaration site is in the body of a class constructor.
    pub fn is_constructor_declared_this_property(
        &mut self,
        symbol: SymbolId,
    ) -> (ThisAssignmentDeclarationKind, NodeId) {
        let a = self.ast;
        let value_declaration = a.sym(symbol).value_declaration;
        if value_declaration.is_nil() || !is_binary_expression(a, value_declaration) {
            return (ThisAssignmentDeclarationKind::NONE, NodeId::NIL);
        }
        if let Some(kind) = self.this_expando_kinds.get_ok(&symbol) {
            let Some(location) = self.this_expando_locations.get_ok(&symbol) else {
                let _: () =
                    self.fail("location should be cached whenever this expando symbol is cached");
                return (kind, NodeId::NIL);
            };
            return (kind, location);
        }
        let mut all_this = true;
        let mut type_annotation = NodeId::NIL;
        for &declaration in a.sym(symbol).declarations.as_slice() {
            if !is_binary_expression(a, declaration) {
                all_this = false;
                break;
            }
            let bin = a.as_binary_expression(declaration);
            if get_assignment_declaration_kind(a, declaration) == JSDeclarationKind::THIS_PROPERTY
                && (a.kind(bin.left) != Kind::ElementAccessExpression
                    || is_string_or_numeric_literal_like(
                        a,
                        a.as_element_access_expression(bin.left).argument_expression,
                    ))
            {
                if !bin.type_node.is_nil() {
                    type_annotation = bin.type_node;
                }
            } else {
                all_this = false;
                break;
            }
        }
        let mut location = NodeId::NIL;
        let mut kind = ThisAssignmentDeclarationKind::NONE;
        if all_this {
            if !type_annotation.is_nil() {
                location = type_annotation;
                kind = ThisAssignmentDeclarationKind::TYPED;
            } else {
                location = self.get_declaring_constructor(symbol);
                kind = if location.is_nil() {
                    ThisAssignmentDeclarationKind::METHOD
                } else {
                    ThisAssignmentDeclarationKind::CONSTRUCTOR
                };
            }
        }
        let ok = self.this_expando_kinds.set(symbol, kind);
        self.map_set(ok);
        let ok = self.this_expando_locations.set(symbol, location);
        self.map_set(ok);
        (kind, location)
    }

    pub fn is_global_symbol_constructor(&mut self, node: NodeId) -> bool {
        let symbol = self.get_symbol_of_node(node);
        let global_symbol = self.get_global_es_symbol_constructor_type_symbol_or_nil();
        !global_symbol.is_nil() && symbol == global_symbol
    }

    pub fn widen_type_for_variable_like_declaration(
        &mut self,
        t: TypeId,
        declaration: NodeId,
        report_errors: bool,
    ) -> TypeId {
        let a = self.ast;
        let mut t = t;
        if !t.is_nil() {
            // This special case is required for backwards compatibility with libraries that merge a `symbol` property into `SymbolConstructor`. See https://github.com/microsoft/typescript-go/issues/1212
            if self.types[t].flags.intersects(TypeFlags::ES_SYMBOL)
                && self.is_global_symbol_constructor(a.parent(declaration))
            {
                t = self.get_es_symbol_like_type_for_node(declaration);
            }
            if report_errors {
                self.report_errors_from_widening(declaration, t, WideningKind::NORMAL);
            }
            // always widen a 'unique symbol' type if the type was created for a different declaration.
            if self.types[t].flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
                && (is_binding_element(a, declaration) || a.type_node(declaration).is_nil())
            {
                let declaration_symbol = self.get_symbol_of_declaration(declaration);
                if self.types[t].symbol != declaration_symbol {
                    t = self.es_symbol_type;
                }
            }
            return self.get_widened_type(t);
        }
        // Rest parameters default to type any[], other parameters default to type any
        if is_parameter_declaration(a, declaration)
            && !a
                .as_parameter_declaration(declaration)
                .dot_dot_dot_token
                .is_nil()
        {
            t = self.any_array_type;
        } else {
            t = self.any_type;
        }
        // Report implicit any errors unless this is a private property within an ambient declaration
        if report_errors {
            if !declaration_belongs_to_private_ambient_member(a, declaration) {
                self.report_implicit_any(declaration, t, WideningKind::NORMAL);
            }
        }
        t
    }

    pub fn report_implicit_any(
        &mut self,
        declaration: NodeId,
        t: TypeId,
        widening_kind: WideningKind,
    ) {
        let a = self.ast;
        if is_in_js_file(a, declaration)
            && !is_check_js_enabled_for_file(
                a,
                get_source_file_of_node(a, declaration),
                self.compiler_options,
            )
        {
            // Only report implicit any errors/suggestions in TS and ts-check JS files
            return;
        }
        let widened_type = self.get_widened_type(t);
        let type_as_string = self.type_to_string_exported(widened_type);
        let diagnostic: MessageId;
        match a.kind(declaration) {
            Kind::BinaryExpression | Kind::PropertyDeclaration | Kind::PropertySignature => {
                diagnostic = if self.no_implicit_any {
                    diagnostics::MEMBER_0_IMPLICITLY_HAS_AN_1_TYPE
                } else {
                    diagnostics::MEMBER_0_IMPLICITLY_HAS_AN_1_TYPE_BUT_A_BETTER_TYPE_MAY_BE_INFERRED_FROM_USAGE
                };
            }
            Kind::Parameter => {
                let param = a.as_parameter_declaration(declaration);
                if is_identifier(a, param.name) {
                    let name = param.name;
                    let original_keyword_kind = identifier_to_keyword_kind(a, name);
                    let parent = a.parent(declaration);
                    if (is_call_signature_declaration(a, parent)
                        || is_method_signature_declaration(a, parent)
                        || is_function_type_node(a, parent))
                        && a.parameters(parent).as_slice().contains(&declaration)
                        && (is_type_node_kind(original_keyword_kind)
                            || !self
                                .resolve_name(
                                    declaration,
                                    a.text(name),
                                    SymbolFlags::TYPE,
                                    MessageId::NIL,
                                    true,
                                    false,
                                )
                                .is_nil())
                    {
                        let index = a
                            .parameters(parent)
                            .as_slice()
                            .iter()
                            .position(|&parameter| parameter == declaration)
                            .map_or(-1, |index| index as isize);
                        let new_name = [b"arg".as_slice(), index.to_string().as_bytes()].concat();
                        let mut type_name = declaration_name_to_string(a, param.name);
                        if !param.dot_dot_dot_token.is_nil() {
                            type_name.extend_from_slice(b"[]");
                        }
                        self.error_or_suggestion(
                            self.no_implicit_any,
                            declaration,
                            diagnostics::PARAMETER_HAS_A_NAME_BUT_NO_TYPE_DID_YOU_MEAN_0_COLON_1,
                            &[Arg::Str(&new_name), Arg::Str(&type_name)],
                        );
                        return;
                    }
                }
                diagnostic = if !param.dot_dot_dot_token.is_nil() {
                    if self.no_implicit_any {
                        diagnostics::REST_PARAMETER_0_IMPLICITLY_HAS_AN_ANY_TYPE
                    } else {
                        diagnostics::REST_PARAMETER_0_IMPLICITLY_HAS_AN_ANY_TYPE_BUT_A_BETTER_TYPE_MAY_BE_INFERRED_FROM_USAGE
                    }
                } else if self.no_implicit_any {
                    diagnostics::PARAMETER_0_IMPLICITLY_HAS_AN_1_TYPE
                } else {
                    diagnostics::PARAMETER_0_IMPLICITLY_HAS_AN_1_TYPE_BUT_A_BETTER_TYPE_MAY_BE_INFERRED_FROM_USAGE
                };
            }
            Kind::BindingElement => {
                diagnostic = diagnostics::BINDING_ELEMENT_0_IMPLICITLY_HAS_AN_1_TYPE;
                if !self.no_implicit_any {
                    // Don't issue a suggestion for binding elements since the codefix doesn't yet support them.
                    return;
                }
            }
            Kind::FunctionDeclaration
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionExpression
            | Kind::ArrowFunction => {
                if self.no_implicit_any && a.name(declaration).is_nil() {
                    if widening_kind == WideningKind::GENERATOR_YIELD {
                        self.error(
                            declaration,
                            diagnostics::GENERATOR_IMPLICITLY_HAS_YIELD_TYPE_0_CONSIDER_SUPPLYING_A_RETURN_TYPE_ANNOTATION,
                            &[Arg::Str(&type_as_string)],
                        );
                    } else {
                        self.error(
                            declaration,
                            diagnostics::FUNCTION_EXPRESSION_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_0_RETURN_TYPE,
                            &[Arg::Str(&type_as_string)],
                        );
                    }
                    return;
                }
                if !self.no_implicit_any {
                    diagnostic = diagnostics::X_0_IMPLICITLY_HAS_AN_1_RETURN_TYPE_BUT_A_BETTER_TYPE_MAY_BE_INFERRED_FROM_USAGE;
                } else if a.flags(declaration).intersects(NodeFlags::REPARSED) {
                    let name =
                        declaration_name_to_string(a, get_name_of_declaration(a, declaration));
                    if !name.is_empty() {
                        self.error(
                            declaration,
                            diagnostics::X_0_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_1_RETURN_TYPE,
                            &[Arg::Str(&name), Arg::Str(&type_as_string)],
                        );
                    } else {
                        self.error(
                            declaration,
                            diagnostics::THIS_OVERLOAD_IMPLICITLY_RETURNS_THE_TYPE_0_BECAUSE_IT_LACKS_A_RETURN_TYPE_ANNOTATION,
                            &[Arg::Str(&type_as_string)],
                        );
                    }
                    return;
                } else if widening_kind == WideningKind::GENERATOR_YIELD {
                    diagnostic = diagnostics::X_0_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_1_YIELD_TYPE;
                } else {
                    diagnostic = diagnostics::X_0_WHICH_LACKS_RETURN_TYPE_ANNOTATION_IMPLICITLY_HAS_AN_1_RETURN_TYPE;
                }
            }
            Kind::MappedType => {
                if self.no_implicit_any {
                    self.error(
                        declaration,
                        diagnostics::MAPPED_OBJECT_TYPE_IMPLICITLY_HAS_AN_ANY_TEMPLATE_TYPE,
                        &[],
                    );
                }
                return;
            }
            _ => {
                diagnostic = if self.no_implicit_any {
                    diagnostics::VARIABLE_0_IMPLICITLY_HAS_AN_1_TYPE
                } else {
                    diagnostics::VARIABLE_0_IMPLICITLY_HAS_AN_1_TYPE_BUT_A_BETTER_TYPE_MAY_BE_INFERRED_FROM_USAGE
                };
            }
        }
        let name = declaration_name_to_string(a, get_name_of_declaration(a, declaration));
        self.error_or_suggestion(
            self.no_implicit_any,
            declaration,
            diagnostic,
            &[Arg::Str(&name), Arg::Str(&type_as_string)],
        );
    }

    pub fn get_widened_type(&mut self, t: TypeId) -> TypeId {
        self.get_widened_type_with_context(t, WideningContextId::NIL)
    }

    pub fn get_widened_type_with_context(
        &mut self,
        t: TypeId,
        context: WideningContextId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            self.stack_limit::<()>();
            return t;
        }
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::REQUIRES_WIDENING)
        {
            let key = CachedTypeKey {
                kind: CachedTypeKind::WIDENED,
                type_id: t,
            };
            if context.is_nil() {
                let cached = self.cached_types.get(&key);
                if !cached.is_nil() {
                    return cached;
                }
            }
            let mut result = TypeId::NIL;
            if self.types[t]
                .flags
                .intersects(TypeFlags::ANY | TypeFlags::NULLABLE)
            {
                result = self.any_type;
            } else if is_object_literal_type(self, t) {
                result = self.get_widened_type_of_object_literal(t, context);
            } else if self.types[t].flags.intersects(TypeFlags::UNION) {
                let types = self.type_types(t);
                let mut union_context = context;
                if union_context.is_nil() {
                    union_context = self.widening_contexts.alloc(WideningContext {
                        siblings: types,
                        ..WideningContext::default()
                    });
                }
                let widened_types = self.same_map(types, |c, t| {
                    if c.types[t].flags.intersects(TypeFlags::NULLABLE) {
                        return t;
                    }
                    c.get_widened_type_with_context(t, union_context)
                });
                // Widening an empty object literal transitions from a highly restrictive type to a highly inclusive one. For that reason we perform subtype reduction here if the union includes empty object types (e.g. reducing {} | string to just {}).
                let some_empty_object_type = widened_types
                    .as_slice()
                    .iter()
                    .any(|&widened| self.is_empty_object_type(widened));
                let union_reduction = if some_empty_object_type {
                    UnionReduction::SUBTYPE
                } else {
                    UnionReduction::LITERAL
                };
                result = self.get_union_type_ex(
                    widened_types,
                    union_reduction,
                    TypeAliasId::NIL,
                    TypeId::NIL,
                );
            } else if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
                let types = self.type_types(t);
                let widened_types = self.same_map(types, |c, t| c.get_widened_type(t));
                result = self.get_intersection_type(widened_types);
            } else if self.is_array_or_tuple_type(t) {
                let target = self.type_target(t);
                let type_arguments = self.get_type_arguments(t);
                let widened_type_arguments =
                    self.same_map(type_arguments, |c, t| c.get_widened_type(t));
                result = self.create_type_reference(target, widened_type_arguments);
            }
            if !result.is_nil() && context.is_nil() {
                let ok = self.cached_types.set(key, result);
                self.map_set(ok);
            }
            if !result.is_nil() {
                return result;
            }
            return t;
        }
        t
    }

    pub fn get_widened_type_of_object_literal(
        &mut self,
        t: TypeId,
        context: WideningContextId,
    ) -> TypeId {
        let a = self.ast;
        if !context.is_nil() {
            let cached = self.widening_contexts[context].widened_types.get(&t);
            if !cached.is_nil() {
                return cached;
            }
        }
        let members = a.new_table();
        let properties = self.get_properties_of_object_type(t);
        for &prop in properties.as_slice() {
            let widened_property = self.get_widened_property(prop, context);
            a.table_set(members, a.sym(prop).name, widened_property);
        }
        if !context.is_nil() {
            let context_properties = self.get_properties_of_context(context);
            for &prop in context_properties.as_slice() {
                let name = a.sym(prop).name;
                if a.table_get(members, name).is_nil() {
                    let undefined_property = self.get_undefined_property(prop);
                    a.table_set(members, name, undefined_property);
                }
            }
        }
        let symbol = self.types[t].symbol;
        let index_infos = self.get_index_infos_of_type(t);
        let widened_index_infos = self.same_map(index_infos, |c, info| {
            let key_type = c.index_infos[info].key_type;
            let value_type = c.index_infos[info].value_type;
            let widened_value_type = c.get_widened_type(value_type);
            let is_readonly = c.index_infos[info].is_readonly;
            let declaration = c.index_infos[info].declaration;
            let components = c.index_infos[info].components;
            c.new_index_info(
                key_type,
                widened_value_type,
                is_readonly,
                declaration,
                components,
            )
        });
        let result =
            self.new_anonymous_type(symbol, members, List::NIL, List::NIL, widened_index_infos);
        // Retain js literal flag through widening
        let retained_flags = self.types[t].object_flags
            & (ObjectFlags::JS_LITERAL | ObjectFlags::NON_INFERRABLE_TYPE);
        self.types[result].object_flags |= retained_flags;
        // Only cache in child contexts since the root context never widens a particular object literal type more than once
        if !context.is_nil() && !self.widening_contexts[context].parent.is_nil() {
            if self.widening_contexts[context].widened_types.is_nil() {
                self.widening_contexts[context].widened_types = Map::make();
            }
            let ok = self.widening_contexts[context].widened_types.set(t, result);
            self.map_set(ok);
        }
        result
    }

    pub fn get_widened_property(&mut self, prop: SymbolId, context: WideningContextId) -> SymbolId {
        let a = self.ast;
        if !a.sym(prop).flags.intersects(SymbolFlags::PROPERTY) {
            // Since get accessors already widen their return value there is no need to widen accessor based properties here.
            return prop;
        }
        let original = self.get_type_of_symbol(prop);
        let mut prop_context = WideningContextId::NIL;
        if !context.is_nil() {
            prop_context = context.get_child_context(self, a.sym(prop).name);
        }
        let widened = self.get_widened_type_with_context(original, prop_context);
        if widened == original {
            return prop;
        }
        self.create_symbol_with_type(prop, widened)
    }
}

impl WideningContextId {
    pub fn get_child_context<'a>(
        self,
        c: &mut Checker<'a>,
        property_name: Text<'a>,
    ) -> WideningContextId {
        let w = self;
        let cached = c.widening_contexts[w].child_contexts.get(&property_name);
        if !cached.is_nil() {
            return cached;
        }
        let result = c.widening_contexts.alloc(WideningContext {
            parent: w,
            property_name,
            ..WideningContext::default()
        });
        if c.widening_contexts[w].child_contexts.is_nil() {
            c.widening_contexts[w].child_contexts = Map::make();
        }
        let ok = c.widening_contexts[w]
            .child_contexts
            .set(property_name, result);
        c.map_set(ok);
        result
    }
}

impl<'a> Checker<'a> {
    pub fn get_properties_of_context(&mut self, context: WideningContextId) -> List<'a, SymbolId> {
        let a = self.ast;
        if self.widening_contexts[context].resolved_properties.is_nil() {
            let mut names: OrderedMap<Text<'a>, SymbolId> = OrderedMap::default();
            let siblings = self.get_siblings_of_context(context);
            for &t in siblings.as_slice() {
                if is_object_literal_type(self, t)
                    && !self.types[t]
                        .object_flags
                        .intersects(ObjectFlags::CONTAINS_SPREAD)
                {
                    let properties = self.get_properties_of_type(t);
                    for &prop in properties.as_slice() {
                        names.set(a.sym(prop).name, prop);
                    }
                }
            }
            let values: Vec<SymbolId> = names.values().copied().collect();
            // slices.Collect answers nil for no value: an empty result is computed again by the next call.
            let resolved_properties = if values.is_empty() {
                List::NIL
            } else {
                self.list_of(&values)
            };
            self.widening_contexts[context].resolved_properties = resolved_properties;
        }
        self.widening_contexts[context].resolved_properties
    }

    pub fn get_siblings_of_context(&mut self, context: WideningContextId) -> List<'a, TypeId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if context.is_nil() {
            return self.fail("nil WideningContext in getSiblingsOfContext");
        }
        if self.widening_contexts[context].siblings.is_nil() {
            let mut siblings: Vec<TypeId> = Vec::new();
            let parent = self.widening_contexts[context].parent;
            let parent_siblings = self.get_siblings_of_context(parent);
            for &t in parent_siblings.as_slice() {
                if is_object_literal_type(self, t) {
                    let property_name = self.widening_contexts[context].property_name;
                    let prop = self.get_property_of_object_type(t, property_name);
                    if !prop.is_nil() {
                        let prop_type = self.get_type_of_symbol(prop);
                        let distributed = self.type_distributed(prop_type);
                        siblings.extend_from_slice(distributed.as_slice());
                    }
                }
            }
            // The list is never nil once it is computed, also when it is empty.
            let siblings = self.list_of(&siblings);
            self.widening_contexts[context].siblings = siblings;
        }
        self.widening_contexts[context].siblings
    }

    pub fn get_undefined_property(&mut self, prop: SymbolId) -> SymbolId {
        let a = self.ast;
        let name = a.sym(prop).name;
        let cached = self.undefined_properties.get(&name);
        if !cached.is_nil() {
            return cached;
        }
        let result = self.create_symbol_with_type(prop, self.undefined_or_missing_type);
        a.update_symbol(result, |s| s.flags |= SymbolFlags::OPTIONAL);
        let ok = self.undefined_properties.set(name, result);
        self.map_set(ok);
        result
    }

    pub fn get_type_of_enum_member(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            let resolved_type = self.get_declared_type_of_enum_member(symbol);
            self.value_symbol_links[links].resolved_type = resolved_type;
        }
        self.value_symbol_links[links].resolved_type
    }

    pub fn get_type_of_accessors(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::Type,
            ) {
                return self.error_type;
            }
            let getter = get_declaration_of_kind(a, symbol, Kind::GetAccessor);
            let setter = get_declaration_of_kind(a, symbol, Kind::SetAccessor);
            let accessor = find(a.sym(symbol).declarations.as_slice(), |d| {
                is_auto_accessor_property_declaration(a, d)
            });
            // We try to resolve a getter type annotation, a setter type annotation, or a getter function body return type inference, in that order.
            let mut t = self.get_annotated_accessor_type(getter);
            if t.is_nil() {
                t = self.get_annotated_accessor_type(setter);
            }
            if t.is_nil() {
                t = self.get_annotated_accessor_type(accessor);
            }
            if t.is_nil() && !getter.is_nil() {
                let body = a.body(getter);
                if !body.is_nil() {
                    t = self.get_return_type_from_body(getter, CheckMode::NORMAL);
                }
            }
            if t.is_nil() && !accessor.is_nil() {
                t = self.get_widened_type_for_variable_like_declaration(accessor, true);
            }
            if t.is_nil() {
                if !setter.is_nil() && !is_private_within_ambient(a, setter) {
                    let name = self.symbol_to_string(symbol);
                    self.error_or_suggestion(
                        self.no_implicit_any,
                        setter,
                        diagnostics::PROPERTY_0_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_ITS_SET_ACCESSOR_LACKS_A_PARAMETER_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                } else if !getter.is_nil() && !is_private_within_ambient(a, getter) {
                    let name = self.symbol_to_string(symbol);
                    self.error_or_suggestion(
                        self.no_implicit_any,
                        getter,
                        diagnostics::PROPERTY_0_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_ITS_GET_ACCESSOR_LACKS_A_RETURN_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                } else if !accessor.is_nil() && !is_private_within_ambient(a, accessor) {
                    let name = self.symbol_to_string(symbol);
                    self.error_or_suggestion(
                        self.no_implicit_any,
                        accessor,
                        diagnostics::MEMBER_0_IMPLICITLY_HAS_AN_1_TYPE,
                        &[Arg::Str(&name), Arg::Str(b"any")],
                    );
                }
                t = self.any_type;
            }
            if !self.pop_type_resolution() {
                if !self.get_annotated_accessor_type_node(getter).is_nil() {
                    let name = self.symbol_to_string(symbol);
                    self.error(
                        getter,
                        diagnostics::X_0_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                } else if !self.get_annotated_accessor_type_node(setter).is_nil() {
                    let name = self.symbol_to_string(symbol);
                    self.error(
                        setter,
                        diagnostics::X_0_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                } else if !self.get_annotated_accessor_type_node(accessor).is_nil() {
                    // Upstream reports this case at the setter, which can be nil: the diagnostic then has no file.
                    let name = self.symbol_to_string(symbol);
                    self.error(
                        setter,
                        diagnostics::X_0_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                } else if !getter.is_nil() && self.no_implicit_any {
                    let name = self.symbol_to_string(symbol);
                    self.error(
                        getter,
                        diagnostics::X_0_IMPLICITLY_HAS_RETURN_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_RETURN_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ONE_OF_ITS_RETURN_EXPRESSIONS,
                        &[Arg::Str(&name)],
                    );
                }
                t = self.any_type;
            }
            if self.value_symbol_links[links].resolved_type.is_nil() {
                self.value_symbol_links[links].resolved_type = t;
            }
        }
        self.value_symbol_links[links].resolved_type
    }

    pub fn get_write_type_of_accessors(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].write_type.is_nil() {
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::WriteType,
            ) {
                return self.error_type;
            }
            let mut setter = get_declaration_of_kind(a, symbol, Kind::SetAccessor);
            if setter.is_nil() {
                let prop_declaration =
                    get_declaration_of_kind(a, symbol, Kind::PropertyDeclaration);
                if !prop_declaration.is_nil()
                    && is_auto_accessor_property_declaration(a, prop_declaration)
                {
                    setter = prop_declaration;
                }
            }
            let mut write_type = self.get_annotated_accessor_type(setter);
            if !self.pop_type_resolution() {
                if !self.get_annotated_accessor_type_node(setter).is_nil() {
                    let name = self.symbol_to_string(symbol);
                    self.error(
                        setter,
                        diagnostics::X_0_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_TYPE_ANNOTATION,
                        &[Arg::Str(&name)],
                    );
                }
                write_type = self.any_type;
            }
            // Absent an explicit setter type annotation we use the read type of the accessor.
            if self.value_symbol_links[links].write_type.is_nil() {
                if !write_type.is_nil() {
                    self.value_symbol_links[links].write_type = write_type;
                } else {
                    let read_type = self.get_type_of_accessors(symbol);
                    self.value_symbol_links[links].write_type = read_type;
                }
            }
        }
        self.value_symbol_links[links].write_type
    }

    pub fn get_type_of_alias(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::Type,
            ) {
                return self.error_type;
            }
            let target_symbol = self.resolve_alias(symbol);
            let declaration = self.get_declaration_of_alias_symbol(symbol);
            let export_symbol = self.get_target_of_alias_declaration(declaration);
            // It only makes sense to get the type of a value symbol. If the result of resolving the alias is not a value, then it has no type. To get the type associated with a type symbol, call getDeclaredTypeOfSymbol. This check is important because without it, a call to getTypeOfSymbol could end up recursively calling getTypeOfAlias, causing a stack overflow.
            if self.value_symbol_links[links].resolved_type.is_nil() {
                let resolved_type = if self
                    .get_symbol_flags(target_symbol)
                    .intersects(SymbolFlags::VALUE)
                {
                    self.get_type_of_symbol(target_symbol)
                } else {
                    self.error_type
                };
                self.value_symbol_links[links].resolved_type = resolved_type;
            }
            if !self.pop_type_resolution() {
                let error_symbol = if !export_symbol.is_nil() {
                    export_symbol
                } else {
                    symbol
                };
                self.report_circularity_error(error_symbol);
                if self.value_symbol_links[links].resolved_type.is_nil() {
                    self.value_symbol_links[links].resolved_type = self.error_type;
                }
                return self.value_symbol_links[links].resolved_type;
            }
        }
        self.value_symbol_links[links].resolved_type
    }

    pub fn add_optionality(&mut self, t: TypeId) -> TypeId {
        self.add_optionality_ex(t, false, true)
    }

    pub fn add_optionality_ex(
        &mut self,
        t: TypeId,
        is_property: bool,
        is_optional: bool,
    ) -> TypeId {
        if self.strict_null_checks && is_optional {
            return self.get_optional_type(t, is_property);
        }
        t
    }

    pub fn get_optional_type(&mut self, t: TypeId, is_property: bool) -> TypeId {
        self.assert(self.strict_null_checks, "c.strictNullChecks");
        let missing_or_undefined = if is_property {
            self.undefined_or_missing_type
        } else {
            self.undefined_type
        };
        if t == missing_or_undefined
            || self.types[t].flags.intersects(TypeFlags::UNION)
                && self.type_types(t).at(0usize) == missing_or_undefined
        {
            return t;
        }
        self.get_union_type(List::from_slice(&[t, missing_or_undefined]))
    }

    // Add undefined or null or both to a type if they are missing.
    pub fn get_nullable_type(&mut self, t: TypeId, flags: TypeFlags) -> TypeId {
        let missing = flags.without(self.types[t].flags) & (TypeFlags::UNDEFINED | TypeFlags::NULL);
        if missing == TypeFlags::NONE {
            return t;
        }
        if missing == TypeFlags::UNDEFINED {
            return self.get_union_type(List::from_slice(&[t, self.undefined_type]));
        }
        if missing == TypeFlags::NULL {
            return self.get_union_type(List::from_slice(&[t, self.null_type]));
        }
        self.get_union_type(List::from_slice(&[t, self.undefined_type, self.null_type]))
    }

    pub fn get_non_nullable_type(&mut self, t: TypeId) -> TypeId {
        if self.strict_null_checks {
            return self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
        }
        t
    }

    pub fn is_nullable_type(&mut self, t: TypeId) -> bool {
        self.has_type_facts(t, TypeFacts::IS_UNDEFINED_OR_NULL)
    }

    pub fn get_non_nullable_type_if_needed(&mut self, t: TypeId) -> TypeId {
        if self.is_nullable_type(t) {
            return self.get_non_nullable_type(t);
        }
        t
    }

    pub fn get_declaration_node_flags_from_symbol(&mut self, s: SymbolId) -> NodeFlags {
        let value_declaration = self.ast.sym(s).value_declaration;
        if !value_declaration.is_nil() {
            return self.get_combined_node_flags_cached(value_declaration);
        }
        NodeFlags::NONE
    }

    pub fn get_combined_node_flags_cached(&mut self, node: NodeId) -> NodeFlags {
        // we hold onto the last node and result to speed up repeated lookups against the same node.
        if self.last_get_combined_node_flags_node == node {
            return self.last_get_combined_node_flags_result;
        }
        self.last_get_combined_node_flags_node = node;
        self.last_get_combined_node_flags_result = get_combined_node_flags(self.ast, node);
        self.last_get_combined_node_flags_result
    }

    pub fn is_var_const_like(&mut self, node: NodeId) -> bool {
        let block_scope_kind = self.get_combined_node_flags_cached(node) & NodeFlags::BLOCK_SCOPED;
        block_scope_kind == NodeFlags::CONST
            || block_scope_kind == NodeFlags::USING
            || block_scope_kind == NodeFlags::AWAIT_USING
    }

    pub fn get_effective_property_name_for_property_name_node(
        &mut self,
        node: NodeId,
    ) -> (Text<'a>, bool) {
        let a = self.ast;
        let name = get_property_name_for_property_name_node(a, node);
        if &*name != INTERNAL_SYMBOL_NAME_MISSING {
            let name = match name {
                Cow::Borrowed(name) => name,
                Cow::Owned(name) => self.text(&name),
            };
            return (name, true);
        }
        if is_computed_property_name(a, node) {
            // This is cached so `getTypeOfExpression` isn't constantly reinvoked for every property name lookup
            let links = self.computed_name_links.get(node);
            if let Some(has_name) = self.computed_name_links[links].has_name {
                return (self.computed_name_links[links].name, has_name);
            }
            let expression_type = self.get_type_of_expression(a.expression(node));
            let (name, exists) = self.try_get_name_from_type(expression_type);
            self.computed_name_links[links].name = name;
            self.computed_name_links[links].has_name = Some(exists);
            return (name, exists);
        }
        (b"", false)
    }

    pub fn try_get_name_from_type(&self, t: TypeId) -> (Text<'a>, bool) {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
            return (self.as_unique_es_symbol_type(t).name, true);
        }
        if flags.intersects(TypeFlags::STRING_LITERAL) {
            let s = get_string_literal_value(self, t);
            return (s, true);
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL) {
            let s = get_number_literal_value(self, t).string();
            return (self.text(&s), true);
        }
        (b"", false)
    }

    pub fn get_combined_modifier_flags_cached(&mut self, node: NodeId) -> ModifierFlags {
        // we hold onto the last node and result to speed up repeated lookups against the same node.
        if self.last_get_combined_modifier_flags_node == node {
            return self.last_get_combined_modifier_flags_result;
        }
        self.last_get_combined_modifier_flags_node = node;
        self.last_get_combined_modifier_flags_result = get_combined_modifier_flags(self.ast, node);
        self.last_get_combined_modifier_flags_result
    }
}
