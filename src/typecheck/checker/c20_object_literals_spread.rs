// checker.go:13235-13989 (layers E-LITERAL, T-UIMEMBERS, E-ACCESS, E-CORE): the check of an object literal with its property assignments, shorthand properties and methods, the deprecations of its contextual type, spread types with their symbols and index infos, const contexts and const type variables, the narrowed type of a destructured or contextually typed symbol, read-only symbols, and the check of an expression for a mutable location.
use crate::ast::{
    Arg, CheckFlags, FindAncestorResult, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags,
    SymbolId, SymbolTableId, find_ancestor_or_quit, get_root_declaration, get_this_parameter,
    has_syntactic_modifier, is_array_literal_expression, is_assignment_target,
    is_binary_expression, is_binding_element, is_call_expression, is_class_like,
    is_computed_property_name, is_const_assertion, is_entity_name_expression,
    is_function_like_declaration, is_in_js_file, is_in_json_file, is_method_declaration,
    is_node_descendant_of, is_object_binding_pattern, is_object_literal_expression,
    is_object_literal_method, is_parameter_declaration, is_parenthesized_expression,
    is_private_identifier_class_element_declaration, is_property_assignment,
    is_shorthand_property_assignment, is_spread_element, is_template_span,
    is_variable_declaration, skip_parentheses,
};
use crate::checker::{
    CheckMode, Checker, ContextFlags, ElementFlags, IndexInfoId, NodeCheckFlags, ObjectFlags,
    TypeAliasId, TypeFlags, TypeId, TypeMapperId, UnionReduction, every_type,
    get_boolean_literal_value, get_declaration_modifier_flags_from_symbol, get_flow_node_of_node,
    get_property_name_from_type, has_dot_dot_dot_token, is_tuple_type, is_type_assertion,
    is_type_usable_as_property_name, signature_has_rest_parameter,
};
use crate::collections::Set;
use crate::core::{List, Text, every, find, find_index, if_else, some};
use crate::diagnostics::{self, MessageId};
use crate::jsnum::Number;

// The locals of checkObjectLiteral that its closure createObjectLiteralType reads: they change between its calls.
struct ObjectLiteralState {
    node: NodeId,
    contextual_type: TypeId,
    in_destructuring_pattern: bool,
    properties_table: SymbolTableId,
    properties_array: Vec<SymbolId>,
    offset: usize,
    object_flags: ObjectFlags,
    pattern_with_computed_properties: bool,
    has_computed_string_property: bool,
    has_computed_number_property: bool,
    has_computed_symbol_property: bool,
}

impl<'a> Checker<'a> {
    pub fn check_object_literal(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        // The closure createObjectLiteralType of upstream.
        fn create_object_literal_type(c: &mut Checker<'_>, st: &ObjectLiteralState) -> TypeId {
            let a = c.ast;
            let mut index_infos: Vec<IndexInfoId> = Vec::new();
            let is_readonly = c.is_const_context(st.node);
            let properties = st.properties_array.get(st.offset..).unwrap_or(&[]);
            if st.has_computed_string_property {
                let string_type = c.string_type;
                let info = c.get_object_literal_index_info(is_readonly, properties, string_type);
                index_infos.push(info);
            }
            if st.has_computed_number_property {
                let number_type = c.number_type;
                let info = c.get_object_literal_index_info(is_readonly, properties, number_type);
                index_infos.push(info);
            }
            if st.has_computed_symbol_property {
                let es_symbol_type = c.es_symbol_type;
                let info =
                    c.get_object_literal_index_info(is_readonly, properties, es_symbol_type);
                index_infos.push(info);
            }
            let index_infos = c.list(&index_infos);
            let result = c.new_anonymous_type(
                a.symbol(st.node),
                st.properties_table,
                List::NIL,
                List::NIL,
                index_infos,
            );
            c.types[result].object_flags |= st.object_flags
                | ObjectFlags::OBJECT_LITERAL
                | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
            if st.contextual_type.is_nil()
                && is_in_js_file(a, st.node)
                && !is_in_json_file(a, st.node)
            {
                c.types[result].object_flags |= ObjectFlags::JS_LITERAL;
            }
            if st.pattern_with_computed_properties {
                c.types[result].object_flags |=
                    ObjectFlags::OBJECT_LITERAL_PATTERN_WITH_COMPUTED_PROPERTIES;
            }
            if st.in_destructuring_pattern {
                let ok = c.pattern_for_type.set(result, st.node);
                c.map_set(ok);
            }
            result
        }
        let a = self.ast;
        let symbol = a.symbol(node);
        // Expando object literals have empty properties but filled exports
        if a.properties(node).len() == 0
            && !symbol.is_nil()
            && a.table_len(a.sym(symbol).exports) != 0
        {
            let result = self.new_anonymous_type(
                symbol,
                a.sym(symbol).exports,
                List::NIL,
                List::NIL,
                List::NIL,
            );
            if is_in_js_file(a, node) && !is_in_json_file(a, node) {
                self.types[result].object_flags |= ObjectFlags::JS_LITERAL;
            }
            // An expando object literal has no property children (len == 0), so there is nothing to check here.
            return result;
        }
        self.check_node_deferred(node);
        let in_destructuring_pattern = is_assignment_target(a, node);
        // Grammar checking
        self.check_grammar_object_literal_expression(node, in_destructuring_pattern);
        let mut all_properties_table = SymbolTableId::NIL;
        if self.strict_null_checks {
            all_properties_table = a.new_table();
        }
        let properties_table = a.new_table();
        let mut spread = self.empty_object_type;
        self.push_cached_contextual_type(node);
        let contextual_type = self.get_apparent_type_of_contextual_type(node, ContextFlags::NONE);
        let mut contextual_type_has_pattern = false;
        if !contextual_type.is_nil() {
            let pattern = self.pattern_for_type.get(&contextual_type);
            if !pattern.is_nil()
                && (is_object_binding_pattern(a, pattern)
                    || is_object_literal_expression(a, pattern))
            {
                contextual_type_has_pattern = true;
            }
        }
        let in_const_context = self.is_const_context(node);
        let mut check_flags = CheckFlags::NONE;
        if in_const_context {
            check_flags = CheckFlags::READONLY;
        }
        let mut st = ObjectLiteralState {
            node,
            contextual_type,
            in_destructuring_pattern,
            properties_table,
            properties_array: Vec::new(),
            offset: 0,
            object_flags: ObjectFlags::FRESH_LITERAL,
            pattern_with_computed_properties: false,
            has_computed_string_property: false,
            has_computed_number_property: false,
            has_computed_symbol_property: false,
        };
        // Spreads may cause an early bail; ensure computed names are always checked (this is cached), as otherwise they may not be checked until exports for the type at this position are retrieved, which may never occur.
        for &elem in a.properties(node).as_slice() {
            let name = a.name(elem);
            if !name.is_nil() && is_computed_property_name(a, name) {
                self.check_computed_property_name(name);
            }
        }
        for &member_decl in a.properties(node).as_slice() {
            let mut member = self.get_symbol_of_declaration(member_decl);
            let mut computed_name_type = TypeId::NIL;
            let member_name = a.name(member_decl);
            if !member_name.is_nil() && a.kind(member_name) == Kind::ComputedPropertyName {
                computed_name_type = self.check_computed_property_name(member_name);
            }
            if is_property_assignment(a, member_decl)
                || is_shorthand_property_assignment(a, member_decl)
                || is_object_literal_method(a, member_decl)
            {
                let t = match a.kind(member_decl) {
                    Kind::PropertyAssignment => {
                        self.check_property_assignment(member_decl, check_mode)
                    }
                    Kind::ShorthandPropertyAssignment => self.check_shorthand_property_assignment(
                        member_decl,
                        in_destructuring_pattern,
                        check_mode,
                    ),
                    _ => self.check_object_literal_method(member_decl, check_mode),
                };
                st.object_flags |= self.types[t].object_flags & ObjectFlags::PROPAGATING_FLAGS;
                let mut name_type = TypeId::NIL;
                if !computed_name_type.is_nil()
                    && is_type_usable_as_property_name(self, computed_name_type)
                {
                    name_type = computed_name_type;
                }
                let prop = if !name_type.is_nil() {
                    let name = get_property_name_from_type(self, name_type);
                    let name = self.text(&name);
                    self.new_symbol_ex(
                        SymbolFlags::PROPERTY | a.sym(member).flags,
                        name,
                        check_flags | CheckFlags::LATE,
                    )
                } else {
                    self.new_symbol_ex(
                        SymbolFlags::PROPERTY | a.sym(member).flags,
                        a.sym(member).name,
                        check_flags,
                    )
                };
                let links = self.value_symbol_links_get(prop);
                if !name_type.is_nil() {
                    self.value_symbol_links[links].name_type = name_type;
                }
                if in_destructuring_pattern && self.has_default_value(member_decl) {
                    // If object literal is an assignment pattern and if the assignment pattern specifies a default value for the property, make the property optional.
                    a.update_symbol(prop, |s| s.flags |= SymbolFlags::OPTIONAL);
                } else if contextual_type_has_pattern
                    && !self.types[contextual_type]
                        .object_flags
                        .intersects(ObjectFlags::OBJECT_LITERAL_PATTERN_WITH_COMPUTED_PROPERTIES)
                {
                    // If object literal is contextually typed by the implied type of a binding pattern, and if the binding pattern specifies a default value for the property, make the property optional.
                    let implied_prop =
                        self.get_property_of_type(contextual_type, a.sym(member).name);
                    if !implied_prop.is_nil() {
                        let optional = a.sym(implied_prop).flags & SymbolFlags::OPTIONAL;
                        a.update_symbol(prop, |s| s.flags |= optional);
                    } else if self
                        .get_index_info_of_type(contextual_type, self.string_type)
                        .is_nil()
                    {
                        let member_text = self.symbol_to_string(member);
                        let type_text = self.type_to_string_exported(contextual_type);
                        self.error(
                            a.name(member_decl),
                            diagnostics::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1,
                            &[Arg::Str(&member_text), Arg::Str(&type_text)],
                        );
                    }
                }
                let member_symbol = a.sym(member);
                a.update_symbol(prop, |s| {
                    s.declarations = member_symbol.declarations;
                    s.parent = member_symbol.parent;
                    s.value_declaration = member_symbol.value_declaration;
                });
                self.value_symbol_links[links].resolved_type = t;
                self.value_symbol_links[links].target = member;
                member = prop;
                if !all_properties_table.is_nil() {
                    a.table_set(all_properties_table, a.sym(prop).name, prop);
                }
                if !contextual_type.is_nil()
                    && check_mode.intersects(CheckMode::INFERENTIAL)
                    && !check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE)
                    && (is_property_assignment(a, member_decl)
                        || is_method_declaration(a, member_decl))
                    && self.is_context_sensitive(member_decl)
                {
                    let inference_context = self.get_inference_context(node);
                    // In CheckMode.Inferential we should always have an inference context
                    let mut inference_node = member_decl;
                    if is_property_assignment(a, member_decl) {
                        inference_node = a.initializer(member_decl);
                    }
                    self.add_intra_expression_inference_site(inference_context, inference_node, t);
                }
            } else if a.kind(member_decl) == Kind::SpreadAssignment {
                if !st.properties_array.is_empty() {
                    let object_literal_type = create_object_literal_type(self, &st);
                    spread = self.get_spread_type(
                        spread,
                        object_literal_type,
                        a.symbol(node),
                        st.object_flags,
                        in_const_context,
                    );
                    st.properties_array = Vec::new();
                    st.properties_table = a.new_table();
                    st.has_computed_string_property = false;
                    st.has_computed_number_property = false;
                    st.has_computed_symbol_property = false;
                }
                let expression_type = self.check_expression_ex(
                    a.expression(member_decl),
                    check_mode & CheckMode::INFERENTIAL,
                );
                let t = self.get_reduced_type(expression_type);
                if self.is_valid_spread_type(t) {
                    let merged_type =
                        self.try_merge_union_of_object_type_and_empty_object(t, in_const_context);
                    if !all_properties_table.is_nil() {
                        self.check_spread_prop_overrides(
                            merged_type,
                            all_properties_table,
                            member_decl,
                        );
                    }
                    st.offset = st.properties_array.len();
                    if self.is_error_type(spread) {
                        continue;
                    }
                    spread = self.get_spread_type(
                        spread,
                        merged_type,
                        a.symbol(node),
                        st.object_flags,
                        in_const_context,
                    );
                } else {
                    self.error(
                        member_decl,
                        diagnostics::SPREAD_TYPES_MAY_ONLY_BE_CREATED_FROM_OBJECT_TYPES,
                        &[],
                    );
                    spread = self.error_type;
                }
                continue;
            } else {
                // TypeScript 1.0 spec (April 2014): a get accessor declaration is processed in the same manner as an ordinary function declaration (section 6.1) with no parameters, and a set accessor declaration is processed in the same manner as an ordinary function declaration with a single parameter and a Void return type.
                self.assert(
                    a.kind(member_decl) == Kind::GetAccessor
                        || a.kind(member_decl) == Kind::SetAccessor,
                    "memberDecl.Kind == ast.KindGetAccessor || memberDecl.Kind == ast.KindSetAccessor",
                );
                self.check_node_deferred(member_decl);
            }
            if !computed_name_type.is_nil()
                && !self.types[computed_name_type]
                    .flags
                    .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE)
            {
                if self.is_type_assignable_to(computed_name_type, self.string_number_symbol_type) {
                    if self.is_type_assignable_to(computed_name_type, self.number_type) {
                        st.has_computed_number_property = true;
                    } else if self.is_type_assignable_to(computed_name_type, self.es_symbol_type) {
                        st.has_computed_symbol_property = true;
                    } else {
                        st.has_computed_string_property = true;
                    }
                    if in_destructuring_pattern {
                        st.pattern_with_computed_properties = true;
                    }
                }
            } else {
                a.table_set(st.properties_table, a.sym(member).name, member);
            }
            st.properties_array.push(member);
        }
        self.pop_contextual_type();
        if self.is_error_type(spread) {
            return self.error_type;
        }
        if spread != self.empty_object_type {
            if !st.properties_array.is_empty() {
                let object_literal_type = create_object_literal_type(self, &st);
                spread = self.get_spread_type(
                    spread,
                    object_literal_type,
                    a.symbol(node),
                    st.object_flags,
                    in_const_context,
                );
                st.properties_array = Vec::new();
                st.properties_table = a.new_table();
                st.has_computed_string_property = false;
                st.has_computed_number_property = false;
            }
            // remap the raw emptyObjectType fed in at the top into a fresh empty object literal type, unique to this use site
            return self.map_type(spread, &mut |c, t| {
                if t == c.empty_object_type {
                    return create_object_literal_type(c, &st);
                }
                t
            });
        }
        create_object_literal_type(self, &st)
    }

    pub fn check_contextual_deprecations(&mut self, node: NodeId) {
        let a = self.ast;
        let contextual_type = self.get_apparent_type_of_contextual_type(node, ContextFlags::NONE);
        for &property in a.properties(node).as_slice() {
            if self.is_canceled() {
                return;
            }
            let name = a.name(property);
            if !name.is_nil() && !is_computed_property_name(a, name) {
                self.check_deprecated_property(name, contextual_type);
            }
        }
    }

    pub fn check_deprecated_property(&mut self, name: NodeId, contextual_type: TypeId) {
        let a = self.ast;
        if contextual_type.is_nil() {
            return;
        }
        let prop = self.get_property_of_type(contextual_type, a.text(name));
        if prop.is_nil() || a.sym(prop).declarations.len() == 0 {
            return;
        }
        if self.is_deprecated_symbol(prop) {
            self.add_deprecated_suggestion(name, a.sym(prop).declarations, a.text(name));
        }
    }

    pub fn check_spread_prop_overrides(&mut self, t: TypeId, props: SymbolTableId, spread: NodeId) {
        let a = self.ast;
        let properties = self.get_properties_of_type(t);
        for &right in properties.as_slice() {
            let right_symbol = a.sym(right);
            if !right_symbol.flags.intersects(SymbolFlags::OPTIONAL)
                && !right_symbol.check_flags.intersects(CheckFlags::PARTIAL)
            {
                let left = a.table_get(props, right_symbol.name);
                if !left.is_nil() {
                    let left_symbol = a.sym(left);
                    let diagnostic = self.error(
                        left_symbol.value_declaration,
                        diagnostics::X_0_IS_SPECIFIED_MORE_THAN_ONCE_SO_THIS_USAGE_WILL_BE_OVERWRITTEN,
                        &[Arg::Str(left_symbol.name)],
                    );
                    let related = self.new_diagnostic_for_node(
                        spread,
                        diagnostics::THIS_SPREAD_ALWAYS_OVERWRITES_THIS_PROPERTY,
                        &[],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
            }
        }
    }

    // Since the source of spread types are object literals, which are not binary, this function should be called in a left folding style, with left = previous result of getSpreadType and right = the new element to be spread.
    pub fn get_spread_type(
        &mut self,
        mut left: TypeId,
        mut right: TypeId,
        symbol: SymbolId,
        object_flags: ObjectFlags,
        readonly: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if self.types[left].flags.intersects(TypeFlags::ANY)
            || self.types[right].flags.intersects(TypeFlags::ANY)
        {
            return self.any_type;
        }
        if self.types[left].flags.intersects(TypeFlags::UNKNOWN)
            || self.types[right].flags.intersects(TypeFlags::UNKNOWN)
        {
            return self.unknown_type;
        }
        if self.types[left].flags.intersects(TypeFlags::NEVER) {
            return right;
        }
        if self.types[right].flags.intersects(TypeFlags::NEVER) {
            return left;
        }
        left = self.try_merge_union_of_object_type_and_empty_object(left, readonly);
        if self.types[left].flags.intersects(TypeFlags::UNION) {
            if self.check_cross_product_union(List::from_slice(&[left, right])) {
                return self.map_type(left, &mut |c, t| {
                    c.get_spread_type(t, right, symbol, object_flags, readonly)
                });
            }
            return self.error_type;
        }
        right = self.try_merge_union_of_object_type_and_empty_object(right, readonly);
        if self.types[right].flags.intersects(TypeFlags::UNION) {
            if self.check_cross_product_union(List::from_slice(&[left, right])) {
                return self.map_type(right, &mut |c, t| {
                    c.get_spread_type(left, t, symbol, object_flags, readonly)
                });
            }
            return self.error_type;
        }
        if self.types[right].flags.intersects(
            TypeFlags::BOOLEAN_LIKE
                | TypeFlags::NUMBER_LIKE
                | TypeFlags::BIG_INT_LIKE
                | TypeFlags::STRING_LIKE
                | TypeFlags::ENUM_LIKE
                | TypeFlags::NON_PRIMITIVE
                | TypeFlags::INDEX,
        ) {
            return left;
        }
        if self.is_generic_object_type(left) || self.is_generic_object_type(right) {
            if self.is_empty_object_type(left) {
                return right;
            }
            // When the left type is an intersection, we may need to merge the last constituent of the intersection with the right type. For example when the left type is 'T & { a: string }' and the right type is '{ b: string }' we produce 'T & { a: string, b: string }'.
            if self.types[left].flags.intersects(TypeFlags::INTERSECTION) {
                let types = self.type_types(left);
                let last_left = types.at(types.len() - 1);
                if self.is_non_generic_object_type(last_left)
                    && self.is_non_generic_object_type(right)
                {
                    let mut new_types = types.as_slice().to_vec();
                    let last_type =
                        self.get_spread_type(last_left, right, symbol, object_flags, readonly);
                    match new_types.last_mut() {
                        Some(last) => *last = last_type,
                        None => self.slice_set(false),
                    }
                    return self.get_intersection_type(List::from_slice(&new_types));
                }
            }
            return self.get_intersection_type(List::from_slice(&[left, right]));
        }
        let members = a.new_table();
        let mut skipped_private_members: Set<Text<'a>> = Set::default();
        let index_infos = if left == self.empty_object_type {
            self.get_index_infos_of_type(right)
        } else {
            self.get_union_index_infos(List::from_slice(&[left, right]))
        };
        let right_props = self.get_properties_of_type(right);
        for &right_prop in right_props.as_slice() {
            if get_declaration_modifier_flags_from_symbol(a, right_prop)
                .intersects(ModifierFlags::PRIVATE | ModifierFlags::PROTECTED)
            {
                skipped_private_members.add(a.sym(right_prop).name);
            } else if self.is_spreadable_property(right_prop) {
                let spread_symbol = self.get_spread_symbol(right_prop, readonly);
                a.table_set(members, a.sym(right_prop).name, spread_symbol);
            }
        }
        let left_props = self.get_properties_of_type(left);
        for &left_prop in left_props.as_slice() {
            if skipped_private_members.has(&a.sym(left_prop).name)
                || !self.is_spreadable_property(left_prop)
            {
                continue;
            }
            let right_prop = a.table_get(members, a.sym(left_prop).name);
            if !right_prop.is_nil() {
                let right_type = self.get_type_of_symbol(right_prop);
                if a.sym(right_prop).flags.intersects(SymbolFlags::OPTIONAL) {
                    let declarations = self.concatenate(
                        a.sym(left_prop).declarations,
                        a.sym(right_prop).declarations,
                    );
                    let flags =
                        SymbolFlags::PROPERTY | (a.sym(left_prop).flags & SymbolFlags::OPTIONAL);
                    let result = self.new_symbol(flags, a.sym(left_prop).name);
                    let links = self.value_symbol_links_get(result);
                    // Optimization: avoid calculating the union type if spreading into the exact same type. This is common, e.g. spreading one options bag into another where the bags have the same type, or have properties which overlap. If the unions are large, it may turn out to be expensive to perform subtype reduction.
                    let left_type = self.get_type_of_symbol(left_prop);
                    let left_type_without_undefined =
                        self.remove_missing_or_undefined_type(left_type);
                    let right_type_without_undefined =
                        self.remove_missing_or_undefined_type(right_type);
                    if left_type_without_undefined == right_type_without_undefined {
                        self.value_symbol_links[links].resolved_type = left_type;
                    } else {
                        let resolved_type = self.get_union_type_ex(
                            List::from_slice(&[left_type, right_type_without_undefined]),
                            UnionReduction::SUBTYPE,
                            TypeAliasId::NIL,
                            TypeId::NIL,
                        );
                        self.value_symbol_links[links].resolved_type = resolved_type;
                    }
                    let spread_links = self.spread_links.get(result);
                    self.spread_links[spread_links].left_spread = left_prop;
                    self.spread_links[spread_links].right_spread = right_prop;
                    a.update_symbol(result, |s| s.declarations = declarations);
                    let left_links = self.value_symbol_links_get(left_prop);
                    let name_type = self.value_symbol_links[left_links].name_type;
                    self.value_symbol_links[links].name_type = name_type;
                    a.table_set(members, a.sym(left_prop).name, result);
                }
            } else {
                let spread_symbol = self.get_spread_symbol(left_prop, readonly);
                a.table_set(members, a.sym(left_prop).name, spread_symbol);
            }
        }
        let spread_index_infos = self.same_map(index_infos, |c, info| {
            c.get_index_info_with_readonly(info, readonly)
        });
        let spread =
            self.new_anonymous_type(symbol, members, List::NIL, List::NIL, spread_index_infos);
        self.types[spread].object_flags |= ObjectFlags::OBJECT_LITERAL
            | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL
            | ObjectFlags::CONTAINS_SPREAD
            | object_flags;
        spread
    }

    pub fn get_index_info_with_readonly(
        &mut self,
        info: IndexInfoId,
        readonly: bool,
    ) -> IndexInfoId {
        if self.index_infos[info].is_readonly != readonly {
            let key_type = self.index_infos[info].key_type;
            let value_type = self.index_infos[info].value_type;
            let declaration = self.index_infos[info].declaration;
            let components = self.index_infos[info].components;
            return self.new_index_info(key_type, value_type, readonly, declaration, components);
        }
        info
    }

    pub fn is_valid_spread_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return true;
        }
        let mapped = self.map_type(t, &mut |c, t| c.get_base_constraint_or_type(t));
        let s = self.remove_definitely_falsy_types(mapped);
        self.types[s].flags.intersects(
            TypeFlags::ANY
                | TypeFlags::NON_PRIMITIVE
                | TypeFlags::OBJECT
                | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
        ) || self.types[s]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
            && every(self.type_types(s).as_slice(), |t| {
                self.is_valid_spread_type(t)
            })
    }

    pub fn get_union_index_infos(&mut self, types: List<'_, TypeId>) -> List<'a, IndexInfoId> {
        let source_infos = self.get_index_infos_of_type(types.at(0usize));
        let mut result: Vec<IndexInfoId> = Vec::new();
        for &info in source_infos.as_slice() {
            let index_type = self.index_infos[info].key_type;
            if every(types.as_slice(), |t| {
                !self.get_index_info_of_type(t, index_type).is_nil()
            }) {
                let mut value_types: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
                for &t in types.as_slice() {
                    let value_type = self.get_index_type_of_type(t, index_type);
                    value_types.push(value_type);
                }
                let value_type = self.get_union_type(List::from_slice(&value_types));
                let is_readonly = some(types.as_slice(), |t| {
                    let type_info = self.get_index_info_of_type(t, index_type);
                    self.index_infos[type_info].is_readonly
                });
                let index_info = self.new_index_info(
                    index_type,
                    value_type,
                    is_readonly,
                    NodeId::NIL,
                    List::NIL,
                );
                result.push(index_info);
            }
        }
        self.list(&result)
    }

    pub fn is_non_generic_object_type(&mut self, t: TypeId) -> bool {
        self.types[t].flags.intersects(TypeFlags::OBJECT) && !self.is_generic_mapped_type(t)
    }

    pub fn try_merge_union_of_object_type_and_empty_object(
        &mut self,
        t: TypeId,
        readonly: bool,
    ) -> TypeId {
        let a = self.ast;
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return t;
        }
        let types = self.type_types(t);
        if every(types.as_slice(), |s| {
            self.is_empty_object_type_or_spreads_into_empty_object(s)
        }) {
            let empty = find(types.as_slice(), |s| self.is_empty_object_type(s));
            if !empty.is_nil() {
                return empty;
            }
            return self.empty_object_type;
        }
        let first_type = find(types.as_slice(), |s| {
            !self.is_empty_object_type_or_spreads_into_empty_object(s)
        });
        if first_type.is_nil() {
            return t;
        }
        let second_type = find(types.as_slice(), |s| {
            s != first_type && !self.is_empty_object_type_or_spreads_into_empty_object(s)
        });
        if !second_type.is_nil() {
            return t;
        }
        // gets the type as if it had been spread, but where everything in the spread is made optional
        let members = a.new_table();
        let properties = self.get_properties_of_type(first_type);
        for &prop in properties.as_slice() {
            // Privates are skipped.
            if !get_declaration_modifier_flags_from_symbol(a, prop)
                .intersects(ModifierFlags::PRIVATE | ModifierFlags::PROTECTED)
                && self.is_spreadable_property(prop)
            {
                let prop_symbol = a.sym(prop);
                let is_setonly_accessor = prop_symbol.flags.intersects(SymbolFlags::SET_ACCESSOR)
                    && !prop_symbol.flags.intersects(SymbolFlags::GET_ACCESSOR);
                let flags = SymbolFlags::PROPERTY | SymbolFlags::OPTIONAL;
                let result = self.new_symbol_ex(
                    flags,
                    prop_symbol.name,
                    (prop_symbol.check_flags & CheckFlags::LATE)
                        | if_else(readonly, CheckFlags::READONLY, CheckFlags::NONE),
                );
                let links = self.value_symbol_links_get(result);
                if is_setonly_accessor {
                    self.value_symbol_links[links].resolved_type = self.undefined_type;
                } else {
                    let prop_type = self.get_type_of_symbol(prop);
                    let resolved_type = self.add_optionality_ex(prop_type, true, true);
                    self.value_symbol_links[links].resolved_type = resolved_type;
                }
                let declarations = a.sym(prop).declarations;
                a.update_symbol(result, |s| s.declarations = declarations);
                let prop_links = self.value_symbol_links_get(prop);
                let name_type = self.value_symbol_links[prop_links].name_type;
                self.value_symbol_links[links].name_type = name_type;
                let mapped_links = self.mapped_symbol_links.get(result);
                self.mapped_symbol_links[mapped_links].synthetic_origin = prop;
                a.table_set(members, a.sym(prop).name, result);
            }
        }
        let index_infos = self.get_index_infos_of_type(first_type);
        let spread = self.new_anonymous_type(
            self.types[first_type].symbol,
            members,
            List::NIL,
            List::NIL,
            index_infos,
        );
        self.types[spread].object_flags |=
            ObjectFlags::OBJECT_LITERAL | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
        spread
    }

    // We approximate own properties as non-methods plus methods that are inside the object literal
    pub fn is_spreadable_property(&self, prop: SymbolId) -> bool {
        let a = self.ast;
        let symbol = a.sym(prop);
        !some(symbol.declarations.as_slice(), |d| {
            is_private_identifier_class_element_declaration(a, d)
        }) && !symbol.flags.intersects(
            SymbolFlags::METHOD | SymbolFlags::GET_ACCESSOR | SymbolFlags::SET_ACCESSOR,
        ) || !some(symbol.declarations.as_slice(), |d| {
            !a.parent(d).is_nil() && is_class_like(a, a.parent(d))
        })
    }

    pub fn get_spread_symbol(&mut self, prop: SymbolId, readonly: bool) -> SymbolId {
        let a = self.ast;
        let prop_symbol = a.sym(prop);
        let is_setonly_accessor = prop_symbol.flags.intersects(SymbolFlags::SET_ACCESSOR)
            && !prop_symbol.flags.intersects(SymbolFlags::GET_ACCESSOR);
        if !is_setonly_accessor && readonly == self.is_readonly_symbol(prop) {
            return prop;
        }
        let flags = SymbolFlags::PROPERTY | (prop_symbol.flags & SymbolFlags::OPTIONAL);
        let result = self.new_symbol_ex(
            flags,
            prop_symbol.name,
            (prop_symbol.check_flags & CheckFlags::LATE)
                | if_else(readonly, CheckFlags::READONLY, CheckFlags::NONE),
        );
        let links = self.value_symbol_links_get(result);
        if is_setonly_accessor {
            self.value_symbol_links[links].resolved_type = self.undefined_type;
        } else {
            let prop_type = self.get_type_of_symbol(prop);
            self.value_symbol_links[links].resolved_type = prop_type;
        }
        let declarations = a.sym(prop).declarations;
        a.update_symbol(result, |s| s.declarations = declarations);
        let prop_links = self.value_symbol_links_get(prop);
        let name_type = self.value_symbol_links[prop_links].name_type;
        self.value_symbol_links[links].name_type = name_type;
        let mapped_links = self.mapped_symbol_links.get(result);
        self.mapped_symbol_links[mapped_links].synthetic_origin = prop;
        result
    }

    pub fn is_empty_object_type_or_spreads_into_empty_object(&mut self, t: TypeId) -> bool {
        self.is_empty_object_type(t)
            || self.types[t].flags.intersects(
                TypeFlags::NULL
                    | TypeFlags::UNDEFINED
                    | TypeFlags::BOOLEAN_LIKE
                    | TypeFlags::NUMBER_LIKE
                    | TypeFlags::BIG_INT_LIKE
                    | TypeFlags::STRING_LIKE
                    | TypeFlags::ENUM_LIKE
                    | TypeFlags::NON_PRIMITIVE
                    | TypeFlags::INDEX,
            )
    }

    pub fn has_default_value(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        is_binding_element(a, node) && !a.initializer(node).is_nil()
            || is_property_assignment(a, node) && self.has_default_value(a.initializer(node))
            || is_shorthand_property_assignment(a, node)
                && !a
                    .as_shorthand_property_assignment(node)
                    .object_assignment_initializer
                    .is_nil()
            || is_binary_expression(a, node)
                && a.kind(a.as_binary_expression(node).operator_token) == Kind::EqualsToken
    }

    pub fn is_const_context(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(node);
        is_const_assertion(a, parent)
            || self.is_valid_const_assertion_argument(node) && {
                let contextual_type = self.get_contextual_type(node, ContextFlags::NONE);
                self.is_const_type_variable(contextual_type, 0)
            }
            || (is_parenthesized_expression(a, parent)
                || is_array_literal_expression(a, parent)
                || is_spread_element(a, parent))
                && self.is_const_context(parent)
            || (is_property_assignment(a, parent)
                || is_shorthand_property_assignment(a, parent)
                || is_template_span(a, parent))
                && self.is_const_context(a.parent(parent))
    }

    pub fn is_valid_const_assertion_argument(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return true;
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::ArrayLiteralExpression
            | Kind::ObjectLiteralExpression
            | Kind::TemplateExpression => true,
            Kind::ParenthesizedExpression => {
                self.is_valid_const_assertion_argument(a.expression(node))
            }
            Kind::PrefixUnaryExpression => {
                let op = a.as_prefix_unary_expression(node).operator;
                let arg = a.as_prefix_unary_expression(node).operand;
                op == Kind::MinusToken
                    && (a.kind(arg) == Kind::NumericLiteral || a.kind(arg) == Kind::BigIntLiteral)
                    || op == Kind::PlusToken && a.kind(arg) == Kind::NumericLiteral
            }
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                let expr = skip_parentheses(a, a.expression(node));
                let mut symbol = SymbolId::NIL;
                if is_entity_name_expression(a, expr) {
                    symbol =
                        self.resolve_entity_name(expr, SymbolFlags::VALUE, true, false, NodeId::NIL);
                }
                !symbol.is_nil() && a.sym(symbol).flags.intersects(SymbolFlags::ENUM)
            }
            _ => false,
        }
    }

    pub fn is_const_type_variable(&mut self, t: TypeId, depth: isize) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if depth >= 5 || t.is_nil() {
            return false;
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            let symbol = self.types[t].symbol;
            return !symbol.is_nil()
                && some(a.sym(symbol).declarations.as_slice(), |d| {
                    has_syntactic_modifier(a, d, ModifierFlags::CONST)
                });
        }
        if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            return some(self.type_types(t).as_slice(), |s| {
                self.is_const_type_variable(s, depth)
            });
        }
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = self.as_indexed_access_type(t).object_type;
            return self.is_const_type_variable(object_type, depth + 1);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            let constraint = self.get_constraint_of_conditional_type(t);
            return self.is_const_type_variable(constraint, depth + 1);
        }
        if flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(t).base_type;
            return self.is_const_type_variable(base_type, depth);
        }
        if self.types[t].object_flags.intersects(ObjectFlags::MAPPED) {
            let type_variable = self.get_homomorphic_type_variable(t);
            return !type_variable.is_nil() && self.is_const_type_variable(type_variable, depth);
        }
        if self.is_generic_tuple_type(t) {
            let element_types = self.get_element_types(t);
            for (i, &s) in element_types.as_slice().iter().enumerate() {
                if self
                    .type_target_tuple_type(t)
                    .element_infos
                    .at(i)
                    .flags
                    .intersects(ElementFlags::VARIADIC)
                    && self.is_const_type_variable(s, depth)
                {
                    return true;
                }
            }
        }
        false
    }

    pub fn check_property_assignment(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        // Do not use hasDynamicName here, because that returns false for well known symbols. We want to perform checkComputedPropertyName for all computed properties, including well known symbols.
        if is_computed_property_name(a, a.name(node)) {
            self.check_computed_property_name(a.name(node));
        }
        let initializer_type =
            self.check_expression_for_mutable_location(a.initializer(node), check_mode);
        if !a.type_node(node).is_nil() {
            let t = self.get_type_from_type_node(a.type_node(node));
            self.check_type_assignable_to_and_optionally_elaborate(
                initializer_type,
                t,
                node,
                a.initializer(node),
                MessageId::NIL,
                None,
            );
            return t;
        }
        initializer_type
    }

    pub fn check_shorthand_property_assignment(
        &mut self,
        node: NodeId,
        in_destructuring_pattern: bool,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let mut expr = NodeId::NIL;
        if !in_destructuring_pattern {
            expr = a
                .as_shorthand_property_assignment(node)
                .object_assignment_initializer;
        }
        if expr.is_nil() {
            expr = a.name(node);
        }
        let expression_type = self.check_expression_for_mutable_location(expr, check_mode);
        if !a.type_node(node).is_nil() {
            let t = self.get_type_from_type_node(a.type_node(node));
            self.check_type_assignable_to_and_optionally_elaborate(
                expression_type,
                t,
                node,
                expr,
                MessageId::NIL,
                None,
            );
            return t;
        }
        expression_type
    }

    pub fn is_in_property_initializer_or_class_static_block(
        &self,
        node: NodeId,
        ignore_arrow_functions: bool,
    ) -> bool {
        let a = self.ast;
        !find_ancestor_or_quit(a, node, |n| match a.kind(n) {
            Kind::PropertyDeclaration | Kind::ClassStaticBlockDeclaration => {
                FindAncestorResult::TRUE
            }
            Kind::TypeQuery | Kind::JsxClosingElement => FindAncestorResult::QUIT,
            Kind::ArrowFunction => if_else(
                ignore_arrow_functions,
                FindAncestorResult::FALSE,
                FindAncestorResult::QUIT,
            ),
            Kind::Block => if_else(
                is_function_like_declaration(a, a.parent(n))
                    && a.kind(a.parent(n)) != Kind::ArrowFunction,
                FindAncestorResult::QUIT,
                FindAncestorResult::FALSE,
            ),
            _ => FindAncestorResult::FALSE,
        })
        .is_nil()
    }

    pub fn get_narrowed_type_of_symbol(&mut self, symbol: SymbolId, location: NodeId) -> TypeId {
        let a = self.ast;
        let mut t = self.get_type_of_symbol(symbol);
        let declaration = a.sym(symbol).value_declaration;
        if !declaration.is_nil() {
            if is_binding_element(a, declaration)
                && a.initializer(declaration).is_nil()
                && !has_dot_dot_dot_token(a, declaration)
                && a.elements(a.parent(declaration)).len() >= 2
            {
                // If we have a non-rest binding element with no initializer declared as a const variable or a const-like parameter (a parameter for which there are no assignments in the function body), and if the parent type for the destructuring is a union type, one or more of the binding elements may represent discriminant properties, and we want the effects of conditional checks on such discriminants to affect the types of other binding elements from the same destructuring. Consider `type Action = { kind: 'A', payload: number } | { kind: 'B', payload: string }; function f({ kind, payload }: Action) { if (kind === 'A') { payload.toFixed(); } if (kind === 'B') { payload.toUpperCase(); } }`: we want the conditional checks on 'kind' to affect the type of 'payload'. To facilitate this, we use the binding pattern AST instance for '{ kind, payload }' as a pseudo-reference and narrow this reference as if it occurred in the specified location. We then recompute the narrowed binding element type by destructuring from the narrowed parent type.
                'binding_element: {
                    let root_declaration = get_root_declaration(a, declaration);
                    let root_initializer = a.initializer(root_declaration);
                    // Avoid declaration circularity without blocking binding defaults or nested callbacks.
                    if !root_initializer.is_nil()
                        && is_node_descendant_of(a, location, root_initializer)
                        && self.get_control_flow_container(declaration)
                            == self.get_control_flow_container(location)
                    {
                        break 'binding_element;
                    }
                    let parent = a.parent(a.parent(declaration));
                    if is_variable_declaration(a, root_declaration)
                        && self
                            .get_combined_node_flags_cached(root_declaration)
                            .intersects(NodeFlags::CONSTANT)
                        || is_parameter_declaration(a, root_declaration)
                    {
                        let links = self.node_links.get(parent);
                        if !self.node_links[links]
                            .flags
                            .intersects(NodeCheckFlags::IN_CHECK_IDENTIFIER)
                        {
                            self.node_links[links].flags |= NodeCheckFlags::IN_CHECK_IDENTIFIER;
                            let parent_type =
                                self.get_type_for_binding_element_parent(parent, CheckMode::NORMAL);
                            let mut parent_type_constraint = TypeId::NIL;
                            if !parent_type.is_nil() {
                                parent_type_constraint = self.map_type(parent_type, &mut |c, s| {
                                    c.get_base_constraint_or_type(s)
                                });
                            }
                            // Guard parent-type resolution only; flow analysis should allow re-entrant narrowing
                            self.node_links[links].flags = self.node_links[links]
                                .flags
                                .without(NodeCheckFlags::IN_CHECK_IDENTIFIER);
                            if !parent_type_constraint.is_nil()
                                && self.types[parent_type_constraint]
                                    .flags
                                    .intersects(TypeFlags::UNION)
                                && !(is_parameter_declaration(a, root_declaration)
                                    && self.is_some_symbol_assigned(root_declaration))
                            {
                                let pattern = a.parent(declaration);
                                let narrowed_type = self.get_flow_type_of_reference_ex(
                                    pattern,
                                    parent_type_constraint,
                                    parent_type_constraint,
                                    NodeId::NIL,
                                    get_flow_node_of_node(a, location),
                                );
                                if self.types[narrowed_type].flags.intersects(TypeFlags::NEVER) {
                                    t = self.never_type;
                                } else {
                                    // Destructurings are validated against the parent type elsewhere. Here we disable tuple bounds checks because the narrowed type may have lower arity than the full parent type. For example, for the declaration [x, y]: [1, 2] | [3], we may have narrowed the parent type to just [3].
                                    t = self.get_binding_element_type_from_parent_type(
                                        declaration,
                                        narrowed_type,
                                        true,
                                    );
                                }
                            }
                        }
                    }
                }
            } else if is_parameter_declaration(a, declaration)
                && a.type_node(declaration).is_nil()
                && a.initializer(declaration).is_nil()
                && !has_dot_dot_dot_token(a, declaration)
            {
                // If we have a const-like parameter with no type annotation or initializer, and if the parameter is contextually typed by a signature with a single rest parameter of a union of tuple types, one or more of the parameters may represent discriminant tuple elements, and we want the effects of conditional checks on such discriminants to affect the types of other parameters in the same parameter list. Consider `type Action = [kind: 'A', payload: number] | [kind: 'B', payload: string]; const f: (...args: Action) => void = (kind, payload) => { if (kind === 'A') { payload.toFixed(); } if (kind === 'B') { payload.toUpperCase(); } }`: we want the conditional checks on 'kind' to affect the type of 'payload'. To facilitate this, we use the arrow function AST node for '(kind, payload) => ...' as a pseudo-reference and narrow this reference as if it occurred in the specified location. We then recompute the narrowed parameter type by indexing into the narrowed tuple type.
                let func = a.parent(declaration);
                if a.parameters(func).len() >= 2
                    && self.is_context_sensitive_function_or_object_literal_method(func)
                {
                    let contextual_signature = self.get_contextual_signature(func);
                    if !contextual_signature.is_nil()
                        && self.signatures[contextual_signature].parameters.len() == 1
                        && signature_has_rest_parameter(self, contextual_signature)
                    {
                        let mut mapper = TypeMapperId::NIL;
                        let context = self.get_inference_context(func);
                        if !context.is_nil() {
                            mapper = self.inference_contexts[context].non_fixing_mapper;
                        }
                        let rest_parameter =
                            self.signatures[contextual_signature].parameters.at(0usize);
                        let rest_parameter_type = self.get_type_of_symbol(rest_parameter);
                        let instantiated_type = self.instantiate_type(rest_parameter_type, mapper);
                        let rest_type = self.get_reduced_apparent_type(instantiated_type);
                        if self.types[rest_type].flags.intersects(TypeFlags::UNION)
                            && every_type(self, rest_type, &mut |c, s| is_tuple_type(c, s))
                            && !some(a.parameters(func).as_slice(), |parameter| {
                                self.is_some_symbol_assigned(parameter)
                            })
                        {
                            let narrowed_type = self.get_flow_type_of_reference_ex(
                                func,
                                rest_type,
                                rest_type,
                                NodeId::NIL,
                                get_flow_node_of_node(a, location),
                            );
                            let index = find_index(a.parameters(func).as_slice(), |parameter| {
                                parameter == declaration
                            }) - if_else(!get_this_parameter(a, func).is_nil(), 1, 0);
                            let index_type = self.get_number_literal_type(Number(index as f64));
                            t = self.get_indexed_access_type(narrowed_type, index_type);
                        }
                    }
                }
            }
        }
        t
    }

    pub fn is_readonly_assignment_declaration(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_call_expression(a, node) {
            return false;
        }
        let property_descriptor_type = self.check_expression_cached(a.arguments(node).at(2usize));
        let value_type = self.get_type_of_property_of_type(property_descriptor_type, b"value");
        if !value_type.is_nil() {
            let writable_prop = self.get_property_of_type(property_descriptor_type, b"writable");
            if !writable_prop.is_nil() {
                let value_declaration = a.sym(writable_prop).value_declaration;
                let writable_type = if !value_declaration.is_nil()
                    && is_property_assignment(a, value_declaration)
                {
                    self.check_expression(a.initializer(value_declaration))
                } else {
                    self.get_type_of_symbol(writable_prop)
                };
                return self.types[writable_type]
                    .flags
                    .intersects(TypeFlags::BOOLEAN_LITERAL)
                    && !get_boolean_literal_value(self, writable_type);
            }
            return true;
        }
        self.get_type_of_property_of_type(property_descriptor_type, b"set")
            .is_nil()
    }

    pub fn is_readonly_symbol(&mut self, symbol: SymbolId) -> bool {
        // The following symbols are considered read-only: Properties with a 'readonly' modifier, Variables declared with 'const', Get accessors without matching set accessors, Enum members, Object.defineProperty assignments with writable false or no setter, Unions and intersections of the above (unions and intersections eagerly set isReadonly on creation)
        let a = self.ast;
        let s = a.sym(symbol);
        s.check_flags.intersects(CheckFlags::READONLY)
            || s.flags.intersects(SymbolFlags::PROPERTY)
                && get_declaration_modifier_flags_from_symbol(a, symbol)
                    .intersects(ModifierFlags::READONLY)
            || s.flags.intersects(SymbolFlags::VARIABLE)
                && self
                    .get_declaration_node_flags_from_symbol(symbol)
                    .intersects(NodeFlags::CONSTANT)
            || s.flags.intersects(SymbolFlags::ACCESSOR)
                && !s.flags.intersects(SymbolFlags::SET_ACCESSOR)
            || s.flags.intersects(SymbolFlags::ENUM_MEMBER)
            || some(s.declarations.as_slice(), |declaration| {
                self.is_readonly_assignment_declaration(declaration)
            })
    }

    pub fn check_object_literal_method(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        // Grammar checking
        self.check_grammar_method(node);
        // Do not use hasDynamicName here, because that returns false for well known symbols. We want to perform checkComputedPropertyName for all computed properties, including well known symbols.
        if is_computed_property_name(a, a.name(node)) {
            self.check_computed_property_name(a.name(node));
        }
        let uninstantiated_type =
            self.check_function_expression_or_object_literal_method(node, check_mode);
        self.instantiate_type_with_single_generic_call_signature(
            node,
            uninstantiated_type,
            check_mode,
        )
    }

    pub fn check_expression_for_mutable_location(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let t = self.check_expression_ex(node, check_mode);
        if self.is_const_context(node) {
            return self.get_regular_type_of_literal_type(t);
        }
        if is_type_assertion(self.ast, node) {
            return t;
        }
        let contextual_type = self.get_contextual_type(node, ContextFlags::NONE);
        let instantiated_type =
            self.instantiate_contextual_type(contextual_type, node, ContextFlags::NONE);
        self.get_widened_literal_like_type_for_contextual_type(t, instantiated_type)
    }
}
