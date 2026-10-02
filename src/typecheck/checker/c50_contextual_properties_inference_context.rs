// checker.go:30674-31095 (layer E-CTX): the contextual type of a property, the apparent type of a contextual type and its discrimination by the members of an object literal, the instantiation of a contextual type, the stacks of contextual types and of inference contexts, and context sensitivity.
use crate::ast::{
    CheckFlags, FunctionFlags, Kind, NodeId, SymbolFlags, SymbolId, for_each_return_statement,
    get_function_flags, get_node_id, has_context_sensitive_parameters, is_block, is_jsx_attribute,
    is_jsx_attributes, is_jsx_opening_element, is_object_literal_expression,
    is_object_literal_method, is_property_assignment, is_shorthand_property_assignment,
    node_kind_is,
};
use crate::checker::{
    Checker, ContextFlags, ContextualInfo, DiscriminatedContextualTypeKey, Discriminator,
    InferenceContextId, InferenceContextInfo, MappedTypeNameTypeKind, ObjectFlags, TypeAliasId,
    TypeFlags, TypeId, TypeMapperId, TypeSystemEntity, TypeSystemPropertyName, UnionReduction,
    contains_type, for_each_yield_expression, has_inference_candidates_or_default,
    is_node_descendant_of, is_numeric_literal_name, is_tuple_type,
};
use crate::core::{List, Text, find, map, some};
use crate::jsnum;

impl<'a> Checker<'a> {
    pub fn get_type_of_property_of_contextual_type(&mut self, t: TypeId, name: &[u8]) -> TypeId {
        self.get_type_of_property_of_contextual_type_ex(t, name, TypeId::NIL)
    }

    pub fn get_type_of_property_of_contextual_type_ex(
        &mut self,
        t: TypeId,
        name: &[u8],
        name_type: TypeId,
    ) -> TypeId {
        self.map_type_ex(
            t,
            &mut |c, t| {
                if c.types[t].flags.intersects(TypeFlags::INTERSECTION) {
                    let mut types: Vec<TypeId> = Vec::new();
                    let mut index_info_candidates: Vec<TypeId> = Vec::new();
                    let mut ignore_index_infos = false;
                    for &constituent_type in c.type_types(t).as_slice() {
                        if !c.types[constituent_type]
                            .flags
                            .intersects(TypeFlags::OBJECT)
                        {
                            continue;
                        }
                        if c.is_generic_mapped_type(constituent_type)
                            && c.get_mapped_type_name_type_kind(constituent_type)
                                != MappedTypeNameTypeKind::REMAPPING
                        {
                            let substituted_type = c
                                .get_indexed_mapped_type_substituted_type_of_contextual_type(
                                    constituent_type,
                                    name,
                                    name_type,
                                );
                            types = c.append_contextual_property_type_constituent(
                                types,
                                substituted_type,
                            );
                            continue;
                        }
                        let property_type = c.get_type_of_concrete_property_of_contextual_type(
                            constituent_type,
                            name,
                        );
                        if property_type.is_nil() {
                            if !ignore_index_infos {
                                index_info_candidates.push(constituent_type);
                            }
                            continue;
                        }
                        ignore_index_infos = true;
                        index_info_candidates.clear();
                        types = c.append_contextual_property_type_constituent(types, property_type);
                    }
                    for &candidate in &index_info_candidates {
                        let index_info_type = c.get_type_from_index_infos_of_contextual_type(
                            candidate, name, name_type,
                        );
                        types =
                            c.append_contextual_property_type_constituent(types, index_info_type);
                    }
                    return match types.as_slice() {
                        [] => TypeId::NIL,
                        [only] => *only,
                        _ => c.get_intersection_type(List::from_slice(&types)),
                    };
                }
                if !c.types[t].flags.intersects(TypeFlags::OBJECT) {
                    return TypeId::NIL;
                }
                if c.is_generic_mapped_type(t)
                    && c.get_mapped_type_name_type_kind(t) != MappedTypeNameTypeKind::REMAPPING
                {
                    return c.get_indexed_mapped_type_substituted_type_of_contextual_type(
                        t, name, name_type,
                    );
                }
                let result = c.get_type_of_concrete_property_of_contextual_type(t, name);
                if !result.is_nil() {
                    return result;
                }
                c.get_type_from_index_infos_of_contextual_type(t, name, name_type)
            },
            true,
        )
    }

    pub fn get_indexed_mapped_type_substituted_type_of_contextual_type(
        &mut self,
        t: TypeId,
        name: &[u8],
        name_type: TypeId,
    ) -> TypeId {
        let mut property_name_type = name_type;
        if property_name_type.is_nil() {
            // The name is copied into the arena only when it has no string literal type yet.
            property_name_type = self.string_literal_types.get(&name);
            if property_name_type.is_nil() {
                let name = self.text(name);
                property_name_type = self.get_string_literal_type(name);
            }
        }
        let constraint = self.get_constraint_type_from_mapped_type(t);
        // special case for conditional types pretending to be negated types
        let mapped_name_type = self.as_mapped_type(t).name_type;
        if !mapped_name_type.is_nil()
            && self.is_excluded_mapped_property_name(mapped_name_type, property_name_type)
            || self.is_excluded_mapped_property_name(constraint, property_name_type)
        {
            return TypeId::NIL;
        }
        let constraint_of_constraint = self.get_base_constraint_or_type(constraint);
        if !self.is_type_assignable_to(property_name_type, constraint_of_constraint) {
            return TypeId::NIL;
        }
        self.substitute_indexed_mapped_type(t, property_name_type)
    }

    pub fn is_excluded_mapped_property_name(
        &mut self,
        t: TypeId,
        property_name_type: TypeId,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::CONDITIONAL) {
            let true_type = self.get_true_type_from_conditional_type(t);
            let reduced_true_type = self.get_reduced_type(true_type);
            if !self.types[reduced_true_type]
                .flags
                .intersects(TypeFlags::NEVER)
            {
                return false;
            }
            let false_type = self.get_false_type_from_conditional_type(t);
            let actual_false_type = self.get_actual_type_variable(false_type);
            let check_type = self.as_conditional_type(t).check_type;
            if actual_false_type != self.get_actual_type_variable(check_type) {
                return false;
            }
            let extends_type = self.as_conditional_type(t).extends_type;
            return self.is_type_assignable_to(property_name_type, extends_type);
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            return some(self.type_types(t).as_slice(), |t| {
                self.is_excluded_mapped_property_name(t, property_name_type)
            });
        }
        false
    }

    pub fn get_type_of_concrete_property_of_contextual_type(
        &mut self,
        t: TypeId,
        name: &[u8],
    ) -> TypeId {
        let prop = self.get_property_of_type(t, name);
        if prop.is_nil() || self.is_circular_mapped_property(prop) {
            return TypeId::NIL;
        }
        let prop_type = self.get_type_of_symbol(prop);
        let is_optional = self.ast.sym(prop).flags.intersects(SymbolFlags::OPTIONAL);
        self.remove_missing_type(prop_type, is_optional)
    }

    pub fn get_type_from_index_infos_of_contextual_type(
        &mut self,
        t: TypeId,
        name: &[u8],
        name_type: TypeId,
    ) -> TypeId {
        if is_tuple_type(self, t)
            && is_numeric_literal_name(name)
            && jsnum::from_string(name).0 >= 0.0
        {
            let fixed_length = self.type_target_tuple_type(t).fixed_length;
            let rest_type =
                self.get_element_type_of_slice_of_tuple_type(t, fixed_length, 0, false, true);
            if !rest_type.is_nil() {
                return rest_type;
            }
        }
        let mut name_type = name_type;
        if name_type.is_nil() {
            // The name is copied into the arena only when it has no string literal type yet.
            name_type = self.string_literal_types.get(&name);
            if name_type.is_nil() {
                let name = self.text(name);
                name_type = self.get_string_literal_type(name);
            }
        }
        let index_infos = self.get_index_infos_of_structured_type(t);
        let index_info = self.find_applicable_index_info(index_infos, name_type);
        if index_info.is_nil() {
            return TypeId::NIL;
        }
        self.index_infos[index_info].value_type
    }

    pub fn is_circular_mapped_property(&mut self, symbol: SymbolId) -> bool {
        if self
            .ast
            .sym(symbol)
            .check_flags
            .intersects(CheckFlags::MAPPED)
        {
            let links = self.value_symbol_links_get(symbol);
            return self.value_symbol_links[links].resolved_type.is_nil()
                && self.find_resolution_cycle_start_index(
                    TypeSystemEntity::Symbol(symbol),
                    TypeSystemPropertyName::Type,
                ) >= 0;
        }
        false
    }

    pub fn append_contextual_property_type_constituent(
        &self,
        mut types: Vec<TypeId>,
        t: TypeId,
    ) -> Vec<TypeId> {
        // any doesn't provide any contextual information but could spoil the overall result by nullifying contextual information provided by other intersection constituents so it gets replaced with `unknown` as `T & unknown` is just `T` and all types computed based on the contextual information provided by other constituens are still assignable to any
        if t.is_nil() {
            return types;
        }
        if self.types[t].flags.intersects(TypeFlags::ANY) {
            types.push(self.unknown_type);
            return types;
        }
        types.push(t);
        types
    }

    // Return the contextual type for a given expression node. During overload resolution, a contextual type may temporarily be "pushed" onto a node using the contextualType property.
    pub fn get_apparent_type_of_contextual_type(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let contextual_type = if is_object_literal_method(a, node) {
            self.get_contextual_type_for_object_literal_method(node, context_flags)
        } else {
            self.get_contextual_type(node, context_flags)
        };
        let instantiated_type =
            self.instantiate_contextual_type(contextual_type, node, context_flags);
        if !instantiated_type.is_nil()
            && !(context_flags.intersects(ContextFlags::NO_CONSTRAINTS)
                && self.types[instantiated_type]
                    .flags
                    .intersects(TypeFlags::TYPE_VARIABLE))
        {
            let apparent_type = self.map_type_ex(
                instantiated_type,
                &mut |c, t| {
                    if c.types[t].object_flags.intersects(ObjectFlags::MAPPED) {
                        return t;
                    }
                    c.get_apparent_type(t)
                },
                true,
            );
            let is_union = self.types[apparent_type].flags.intersects(TypeFlags::UNION);
            if is_union && is_object_literal_expression(a, node) {
                return self.discriminate_contextual_type_by_object_members(node, apparent_type);
            }
            if is_union && is_jsx_attributes(a, node) {
                return self.discriminate_contextual_type_by_jsx_attributes(node, apparent_type);
            }
            return apparent_type;
        }
        TypeId::NIL
    }
}

// The discriminator of discriminateContextualTypeByObjectMembers and of discriminateContextualTypeByJSXAttributes. The checker is a parameter of its methods.
pub struct ObjectLiteralDiscriminator<'a> {
    pub props: List<'a, NodeId>,
    pub members: List<'a, SymbolId>,
}

impl<'a> Discriminator<'a> for ObjectLiteralDiscriminator<'a> {
    fn len(&self) -> isize {
        self.props.len() + self.members.len()
    }

    fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a> {
        let a = c.ast;
        if index < self.props.len() {
            return a.sym(a.symbol(self.props.at(index))).name;
        }
        a.sym(self.members.at(index - self.props.len())).name
    }

    fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool {
        let a = c.ast;
        let prop_type = if index < self.props.len() {
            let prop = self.props.at(index);
            if is_property_assignment(a, prop) || is_jsx_attribute(a, prop) {
                let initializer = a.initializer(prop);
                if !initializer.is_nil() {
                    c.get_context_free_type_of_expression(initializer)
                } else {
                    // JsxAttribute without initializer is always true
                    c.true_type
                }
            } else {
                c.get_context_free_type_of_expression(a.name(prop))
            }
        } else {
            c.undefined_type
        };
        for &s in c.type_distributed(prop_type).as_slice() {
            if c.is_type_assignable_to(s, t) {
                return true;
            }
        }
        false
    }
}

impl<'a> Checker<'a> {
    pub fn discriminate_contextual_type_by_object_members(
        &mut self,
        node: NodeId,
        contextual_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let key = DiscriminatedContextualTypeKey {
            node_id: get_node_id(node),
            type_id: contextual_type,
        };
        let discriminated = self.discriminated_contextual_types.get(&key);
        if !discriminated.is_nil() {
            return discriminated;
        }
        let mut discriminated =
            self.get_matching_union_constituent_for_object_literal(contextual_type, node);
        if discriminated.is_nil() {
            let discriminant_properties = self.filter(a.properties(node), |c, p| {
                let symbol = a.symbol(p);
                if symbol.is_nil() {
                    return false;
                }
                if is_property_assignment(a, p) {
                    return c.is_possibly_discriminant_value(a.initializer(p))
                        && c.is_discriminant_property(contextual_type, a.sym(symbol).name);
                }
                if is_shorthand_property_assignment(a, p) {
                    return c.is_discriminant_property(contextual_type, a.sym(symbol).name);
                }
                false
            });
            let properties = self.get_properties_of_type(contextual_type);
            let discriminant_members = self.filter(properties, |c, s| {
                a.sym(s).flags.intersects(SymbolFlags::OPTIONAL)
                    && a.table_get(a.sym(a.symbol(node)).members, a.sym(s).name)
                        .is_nil()
                    && c.is_discriminant_property(contextual_type, a.sym(s).name)
            });
            let mut discriminator = ObjectLiteralDiscriminator {
                props: discriminant_properties,
                members: discriminant_members,
            };
            discriminated =
                self.discriminate_type_by_discriminable_items(contextual_type, &mut discriminator);
        }
        let ok = self.discriminated_contextual_types.set(key, discriminated);
        self.map_set(ok);
        discriminated
    }

    pub fn get_matching_union_constituent_for_object_literal(
        &mut self,
        union_type: TypeId,
        node: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let key_property_name = self.get_key_property_name(union_type);
        if !key_property_name.is_empty() {
            let prop_node = find(a.properties(node).as_slice(), |p| {
                !a.symbol(p).is_nil()
                    && is_property_assignment(a, p)
                    && a.sym(a.symbol(p)).name == key_property_name
                    && self.is_possibly_discriminant_value(a.initializer(p))
            });
            if !prop_node.is_nil() {
                let prop_type = self.get_context_free_type_of_expression(a.initializer(prop_node));
                return self.get_constituent_type_for_key_type(union_type, prop_type);
            }
        }
        TypeId::NIL
    }

    // Return true if the given expression is possibly a discriminant value. We limit the kinds of expressions we check to those that don't depend on their contextual type in order not to cause recursive (and possibly infinite) invocations of getContextualType.
    pub fn is_possibly_discriminant_value(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::StringLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateExpression
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::Identifier
            | Kind::UndefinedKeyword => true,
            Kind::PropertyAccessExpression | Kind::ParenthesizedExpression => {
                self.is_possibly_discriminant_value(a.expression(node))
            }
            Kind::JsxExpression => {
                a.expression(node).is_nil()
                    || self.is_possibly_discriminant_value(a.expression(node))
            }
            _ => false,
        }
    }

    // If the given contextual type contains instantiable types and if a mapper representing return type inferences is available, instantiate those types using that mapper.
    pub fn instantiate_contextual_type(
        &mut self,
        contextual_type: TypeId,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        if !contextual_type.is_nil()
            && self.maybe_type_of_kind(contextual_type, TypeFlags::INSTANTIABLE)
        {
            let inference_context = self.get_inference_context(node);
            // If no inferences have been made, and none of the type parameters for which we are inferring specify default types, nothing is gained from instantiating as type parameters would just be replaced with their constraints similar to the apparent type.
            if !inference_context.is_nil() {
                if context_flags.intersects(ContextFlags::SIGNATURE)
                    && self.inference_contexts[inference_context]
                        .inferences
                        .iter()
                        .any(|info| has_inference_candidates_or_default(self, info))
                {
                    // For contextual signatures we incorporate all inferences made so far, e.g. from return types as well as arguments to the left in a function call.
                    let non_fixing_mapper =
                        self.inference_contexts[inference_context].non_fixing_mapper;
                    let t = self.instantiate_instantiable_types(contextual_type, non_fixing_mapper);
                    if !self.types[t].flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                        return t;
                    }
                }
                let return_mapper = self.inference_contexts[inference_context].return_mapper;
                if !return_mapper.is_nil() {
                    // For other purposes (e.g. determining whether to produce literal types) we only incorporate inferences made from the return type in a function call. We remove the 'boolean' type from the contextual type such that contextually typed boolean literals actually end up widening to 'boolean'.
                    let t = self.instantiate_instantiable_types(contextual_type, return_mapper);
                    if !self.types[t].flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                        if self.types[t].flags.intersects(TypeFlags::UNION)
                            && contains_type(self, self.type_types(t), self.regular_false_type)
                            && contains_type(self, self.type_types(t), self.regular_true_type)
                        {
                            return self.filter_type(t, &mut |c, t| {
                                t != c.regular_false_type && t != c.regular_true_type
                            });
                        }
                        return t;
                    }
                }
            }
        }
        contextual_type
    }

    // This function is similar to instantiateType, except that (a) it only instantiates types that are classified as instantiable (i.e. it doesn't instantiate object types), and (b) it performs no reductions on instantiated union types.
    pub fn instantiate_instantiable_types(&mut self, t: TypeId, mapper: TypeMapperId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            return self.instantiate_type(t, mapper);
        }
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            let types = map(self.type_types(t).as_slice(), |t| {
                self.instantiate_instantiable_types(t, mapper)
            });
            return self.get_union_type_ex(
                List::from_slice(&types),
                UnionReduction::NONE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = map(self.type_types(t).as_slice(), |t| {
                self.instantiate_instantiable_types(t, mapper)
            });
            return self.get_intersection_type(List::from_slice(&types));
        }
        t
    }

    pub fn push_cached_contextual_type(&mut self, node: NodeId) {
        let contextual_type = self.get_contextual_type(node, ContextFlags::NONE);
        self.push_contextual_type(node, contextual_type, true);
    }

    pub fn push_contextual_type(&mut self, node: NodeId, t: TypeId, is_cache: bool) {
        self.contextual_infos
            .push(ContextualInfo { node, t, is_cache });
    }

    pub fn pop_contextual_type(&mut self) {
        if self.contextual_infos.pop().is_none() {
            return self.fail("popContextualType: index out of range [-1]");
        }
    }

    pub fn find_contextual_node(&self, node: NodeId, include_caches: bool) -> isize {
        for (i, info) in self.contextual_infos.iter().enumerate() {
            if node == info.node && (include_caches || !info.is_cache) {
                return i as isize;
            }
        }
        -1
    }

    // Returns true if the given expression contains (at any level of nesting) a function or arrow expression that is subject to contextual typing.
    pub fn is_context_sensitive(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::MethodDeclaration
            | Kind::FunctionDeclaration => {
                self.is_context_sensitive_function_like_declaration(node)
            }
            Kind::ObjectLiteralExpression => some(a.properties(node).as_slice(), |p| {
                self.is_context_sensitive(p)
            }),
            Kind::ArrayLiteralExpression => some(a.elements(node).as_slice(), |e| {
                self.is_context_sensitive(e)
            }),
            Kind::ConditionalExpression => {
                let conditional = a.as_conditional_expression(node);
                self.is_context_sensitive(conditional.when_true)
                    || self.is_context_sensitive(conditional.when_false)
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(node);
                node_kind_is(
                    a,
                    binary.operator_token,
                    &[Kind::BarBarToken, Kind::QuestionQuestionToken],
                ) && (self.is_context_sensitive(binary.left)
                    || self.is_context_sensitive(binary.right))
            }
            Kind::PropertyAssignment => self.is_context_sensitive(a.initializer(node)),
            Kind::ParenthesizedExpression => self.is_context_sensitive(a.expression(node)),
            Kind::JsxAttributes => {
                some(a.properties(node).as_slice(), |p| {
                    self.is_context_sensitive(p)
                }) || is_jsx_opening_element(a, a.parent(node))
                    && some(
                        a.nodes(a.children(a.parent(a.parent(node)))).as_slice(),
                        |child| self.is_context_sensitive(child),
                    )
            }
            Kind::JsxAttribute => {
                // If there is no initializer, JSX attribute has a boolean value of true which is not context sensitive.
                let initializer = a.initializer(node);
                !initializer.is_nil() && self.is_context_sensitive(initializer)
            }
            Kind::JsxExpression => {
                // It is possible to that node.expression is undefined (e.g <div x={} />)
                let expression = a.expression(node);
                !expression.is_nil() && self.is_context_sensitive(expression)
            }
            Kind::YieldExpression => {
                let expression = a.expression(node);
                !expression.is_nil() && self.is_context_sensitive(expression)
            }
            _ => false,
        }
    }

    pub fn is_context_sensitive_function_like_declaration(&self, node: NodeId) -> bool {
        has_context_sensitive_parameters(self.ast, node)
            || self.has_context_sensitive_return_expression(node)
            || self.has_context_sensitive_yield_expression(node)
    }

    pub fn has_context_sensitive_return_expression(&self, node: NodeId) -> bool {
        let a = self.ast;
        if !a.type_parameters(node).is_nil() || !a.type_node(node).is_nil() {
            return false;
        }
        let body = a.body(node);
        if body.is_nil() {
            return false;
        }
        if !is_block(a, body) {
            return self.is_context_sensitive(body);
        }
        for_each_return_statement(a, body, |statement| {
            !a.expression(statement).is_nil() && self.is_context_sensitive(a.expression(statement))
        })
    }

    pub fn has_context_sensitive_yield_expression(&self, node: NodeId) -> bool {
        let a = self.ast;
        get_function_flags(a, node).intersects(FunctionFlags::GENERATOR)
            && !a.body(node).is_nil()
            && for_each_yield_expression(a, a.body(node), |expression| {
                self.is_context_sensitive(expression)
            })
    }

    pub fn push_inference_context(&mut self, node: NodeId, context: InferenceContextId) {
        self.inference_context_infos
            .push(InferenceContextInfo { node, context });
    }

    pub fn pop_inference_context(&mut self) {
        if self.inference_context_infos.pop().is_none() {
            return self.fail("popInferenceContext: index out of range [-1]");
        }
    }

    pub fn get_inference_context(&self, node: NodeId) -> InferenceContextId {
        let a = self.ast;
        for info in self.inference_context_infos.iter().rev() {
            if is_node_descendant_of(a, node, info.node) {
                return info.context;
            }
        }
        InferenceContextId::NIL
    }
}
