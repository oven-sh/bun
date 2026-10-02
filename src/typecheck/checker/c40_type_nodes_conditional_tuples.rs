// checker.go:24225-25124 (layers T-TYPENODE, K-COND, T-INSTANTIATE, K-IMPORTTYPE, T-TUPLE, K-GENERIC, K-SUBST): types of the remaining type nodes, conditional types with their resolution, tail recursion and branch types, permissive and restrictive instantiations, the type of an import type node, array and tuple type construction, generic type predicates and the conditional flow type of a type node.
use crate::ast::{
    Arg, Ast, CheckFlags, JSDeclarationKind, Kind, NodeId, SymbolFlags, SymbolId,
    get_assignment_declaration_kind, is_conditional_type_node, is_identifier,
    is_literal_import_type_node, is_mapped_type_node, is_named_tuple_member, is_optional_type_node,
    is_parameter_declaration, is_qualified_name, is_rest_type_node, is_statement,
    is_tuple_type_node, is_type_operator_node, node_is_missing, skip_type_parentheses,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ConditionalRoot, ConditionalRootId, ElementFlags,
    InferenceFlags, InferencePriority, IntersectionFlags, ObjectFlags, SignatureId,
    TupleElementInfo, TypeAliasId, TypeComparer, TypeFlags, TypeId, TypeMapperId, UnionReduction,
    create_symbol_table, every_type, get_conditional_type_key, get_total_fixed_element_count,
    get_tuple_key, get_type_list_key, is_tuple_type, new_simple_type_mapper, new_type_mapper,
    some_type,
};
use crate::core::{List, Map, or_else};
use crate::diagnostics;
use crate::jsnum::Number;
use crate::scanner::declaration_name_to_string;

// `s[i]` as a guarded read: the zero value when the index is outside the slice.
fn at<T: Copy + Default>(items: &[T], index: usize) -> T {
    items.get(index).copied().unwrap_or_default()
}

impl<'a> Checker<'a> {
    pub fn get_type_from_type_query_node(&mut self, node: NodeId) -> TypeId {
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            // TypeScript 1.0 spec (April 2014): 3.6.3 The expression is processed as an identifier expression (section 4.3) or property access expression(section 4.10), the widened type(section 3.9) of which becomes the result.
            let t = self.check_expression_with_type_arguments(node);
            let widened = self.get_widened_type(t);
            let regular = self.get_regular_type_of_literal_type(widened);
            self.type_node_links[links].resolved_type = regular;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_array_or_tuple_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let target = self.get_array_or_tuple_target_type(node);
            let is_tuple = a.kind(node) == Kind::TupleType;
            let resolved = if target == self.empty_generic_type {
                self.empty_object_type
            } else if !(is_tuple
                && a.elements(node)
                    .as_slice()
                    .iter()
                    .any(|&element| self.is_variadic_tuple_element(element)))
                && self.is_deferred_type_reference_node(node, false)
            {
                if is_tuple && a.elements(node).as_slice().is_empty() {
                    target
                } else {
                    self.create_deferred_type_reference(
                        target,
                        node,
                        TypeMapperId::NIL,
                        TypeAliasId::NIL,
                    )
                }
            } else {
                let mut element_types: Vec<TypeId> = Vec::new();
                if a.kind(node) == Kind::ArrayType {
                    let element_type =
                        self.get_type_from_type_node(a.as_array_type_node(node).element_type);
                    element_types.push(element_type);
                } else {
                    for &element in a.elements(node).as_slice() {
                        let element_type = self.get_type_from_type_node(element);
                        element_types.push(element_type);
                    }
                }
                let element_types = self.list_of(&element_types);
                if self.types[target]
                    .object_flags
                    .intersects(ObjectFlags::TUPLE)
                {
                    self.create_normalized_tuple_type_ex(
                        target,
                        element_types,
                        ObjectFlags::FROM_TYPE_NODE,
                    )
                } else {
                    self.create_type_reference_ex(
                        target,
                        element_types,
                        ObjectFlags::FROM_TYPE_NODE,
                    )
                }
            };
            self.type_node_links[links].resolved_type = resolved;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn is_variadic_tuple_element(&self, node: NodeId) -> bool {
        self.get_tuple_element_flags(node)
            .intersects(ElementFlags::VARIADIC)
    }

    pub fn get_array_or_tuple_target_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let readonly = self.is_readonly_type_operator(a.parent(node));
        let element_type = self.get_array_element_type_node(node);
        if !element_type.is_nil() {
            if readonly {
                return self.global_readonly_array_type;
            }
            return self.global_array_type;
        }
        let element_infos: Vec<TupleElementInfo> = a
            .elements(node)
            .as_slice()
            .iter()
            .map(|&element| self.get_tuple_element_info(element))
            .collect();
        self.get_tuple_target_type(List::from_slice(&element_infos), readonly)
    }

    pub fn is_readonly_type_operator(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_type_operator_node(a, node)
            && a.as_type_operator_node(node).operator == Kind::ReadonlyKeyword
    }

    pub fn get_type_from_named_tuple_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let resolved = if !a.as_named_tuple_member(node).dot_dot_dot_token.is_nil() {
                self.get_type_from_rest_type_node(node)
            } else {
                let t = self.get_type_from_type_node(a.type_node(node));
                self.add_optionality_ex(t, true, !a.question_token(node).is_nil())
            };
            self.type_node_links[links].resolved_type = resolved;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_rest_type_node(&mut self, node: NodeId) -> TypeId {
        let mut type_node = self.ast.type_node(node);
        let element_type_node = self.get_array_element_type_node(type_node);
        if !element_type_node.is_nil() {
            type_node = element_type_node;
        }
        self.get_type_from_type_node(type_node)
    }

    pub fn get_array_element_type_node(&self, node: NodeId) -> NodeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::ParenthesizedType => return self.get_array_element_type_node(a.type_node(node)),
            Kind::TupleType => {
                if let [element] = a.elements(node).as_slice() {
                    let node = *element;
                    if a.kind(node) == Kind::RestType {
                        return self.get_array_element_type_node(a.type_node(node));
                    }
                    if a.kind(node) == Kind::NamedTupleMember
                        && !a.as_named_tuple_member(node).dot_dot_dot_token.is_nil()
                    {
                        return self.get_array_element_type_node(a.type_node(node));
                    }
                }
            }
            Kind::ArrayType => return a.as_array_type_node(node).element_type,
            _ => {}
        }
        NodeId::NIL
    }

    pub fn get_type_from_optional_type_node(&mut self, node: NodeId) -> TypeId {
        let t = self.get_type_from_type_node(self.ast.type_node(node));
        self.add_optionality_ex(t, true, true)
    }

    pub fn get_type_from_union_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let alias = self.get_alias_for_type_node(node);
            let mut types: Vec<TypeId> = Vec::new();
            for &type_node in a.nodes(a.as_union_type_node(node).types).as_slice() {
                let t = self.get_type_from_type_node(type_node);
                types.push(t);
            }
            let resolved = self.get_union_type_ex(
                List::from_slice(&types),
                UnionReduction::LITERAL,
                alias,
                TypeId::NIL,
            );
            self.type_node_links[links].resolved_type = resolved;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_intersection_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let alias = self.get_alias_for_type_node(node);
            let mut types: Vec<TypeId> = Vec::new();
            for &type_node in a.nodes(a.as_intersection_type_node(node).types).as_slice() {
                let t = self.get_type_from_type_node(type_node);
                types.push(t);
            }
            // We perform no supertype reduction for X & {} or {} & X, where X is one of string, number, bigint, or a pattern literal template type. This enables union types like "a" | "b" | string & {} or "aa" | "ab" | `a${string}` which preserve the literal types for purposes of statement completion.
            let mut no_supertype_reduction = false;
            if types.len() == 2 {
                let empty_type_literal_type = self.empty_type_literal_type;
                if let Some(empty_index) = types.iter().position(|&t| t == empty_type_literal_type)
                {
                    let t = at(&types, 1 - empty_index);
                    no_supertype_reduction = self.types[t]
                        .flags
                        .intersects(TypeFlags::STRING | TypeFlags::NUMBER | TypeFlags::BIG_INT)
                        || self.types[t].flags.intersects(TypeFlags::TEMPLATE_LITERAL)
                            && self.is_pattern_literal_type(t);
                }
            }
            let flags = if no_supertype_reduction {
                IntersectionFlags::NO_SUPERTYPE_REDUCTION
            } else {
                IntersectionFlags::NONE
            };
            let resolved = self.get_intersection_type_ex(List::from_slice(&types), flags, alias);
            self.type_node_links[links].resolved_type = resolved;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_template_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let data = a.as_template_literal_type_node(node);
            let spans = a.nodes(data.template_spans).as_slice();
            let mut texts: Vec<&[u8]> = Vec::with_capacity(spans.len() + 1);
            let mut types: Vec<TypeId> = Vec::with_capacity(spans.len());
            texts.push(a.text(data.head));
            for &span in spans {
                texts.push(a.text(a.as_template_literal_type_span(span).literal));
                let t = self.get_type_from_type_node(a.type_node(span));
                types.push(t);
            }
            let resolved = self.get_template_literal_type(&texts, List::from_slice(&types));
            self.type_node_links[links].resolved_type = resolved;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_mapped_type_node(&mut self, node: NodeId) -> TypeId {
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let symbol = self.ast.symbol(node);
            let t = self.new_object_type(ObjectFlags::MAPPED, symbol);
            self.as_mapped_type_mut(t).declaration = node;
            let alias = self.get_alias_for_type_node(node);
            self.types[t].alias = alias;
            self.type_node_links[links].resolved_type = t;
            // Eagerly resolve the constraint type which forces an error if the constraint type circularly references itself through one or more type aliases.
            self.get_constraint_type_from_mapped_type(t);
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_conditional_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let data = a.as_conditional_type_node(node);
            let check_type = self.get_type_from_type_node(data.check_type);
            let alias = self.get_alias_for_type_node(node);
            let all_outer_type_parameters = self.get_outer_type_parameters(node, true);
            let outer_type_parameters = if !alias.is_nil()
                && self.type_aliases[alias].type_arguments.len() != 0
            {
                all_outer_type_parameters
            } else {
                self.filter(all_outer_type_parameters, |c, tp| {
                    c.is_type_parameter_possibly_referenced(tp, node)
                })
            };
            let extends_type = self.get_type_from_type_node(data.extends_type);
            let is_distributive = self.types[check_type]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER);
            let infer_type_parameters = self.get_infer_type_parameters(node);
            let root = self.conditional_roots.alloc(ConditionalRoot {
                node,
                check_type,
                extends_type,
                is_distributive,
                infer_type_parameters,
                outer_type_parameters,
                instantiations: Map::default(),
                alias,
            });
            let resolved =
                self.get_conditional_type(root, TypeMapperId::NIL, false, TypeAliasId::NIL);
            self.type_node_links[links].resolved_type = resolved;
            if !outer_type_parameters.is_nil() {
                self.conditional_roots[root].instantiations = Map::make();
                let key =
                    get_conditional_type_key(self, outer_type_parameters, TypeAliasId::NIL, false);
                let ok = self.conditional_roots[root]
                    .instantiations
                    .set(key, resolved);
                self.map_set(ok);
            }
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_conditional_type(
        &mut self,
        mut root: ConditionalRootId,
        mut mapper: TypeMapperId,
        for_constraint: bool,
        mut alias: TypeAliasId,
    ) -> TypeId {
        let a = self.ast;
        let mut extra_types: Vec<TypeId> = Vec::new();
        let mut tail_count = 0;
        // We loop here for an immediately nested conditional type in the false position, effectively treating types of the form 'A extends B ? X : C extends D ? Y : E extends F ? Z : ...' as a single construct for purposes of resolution. We also loop here when resolution of a conditional type ends in resolution of another (or, through recursion, possibly the same) conditional type. In the potentially tail-recursive cases we increment the tail recursion counter and stop after 1000 iterations.
        let result = loop {
            if tail_count == 1000 {
                self.error(
                    self.current_node,
                    diagnostics::TYPE_INSTANTIATION_IS_EXCESSIVELY_DEEP_AND_POSSIBLY_INFINITE,
                    &[],
                );
                return self.error_type;
            }
            let root_node = self.conditional_roots[root].node;
            let root_check_type = self.conditional_roots[root].check_type;
            let root_extends_type = self.conditional_roots[root].extends_type;
            let actual_check_type = self.get_actual_type_variable(root_check_type);
            let check_type = self.instantiate_type(actual_check_type, mapper);
            let extends_type = self.instantiate_type(root_extends_type, mapper);
            if check_type == self.error_type || extends_type == self.error_type {
                return self.error_type;
            }
            if check_type == self.wildcard_type || extends_type == self.wildcard_type {
                return self.wildcard_type;
            }
            let node_data = a.as_conditional_type_node(root_node);
            let check_type_node = skip_type_parentheses(a, node_data.check_type);
            let extends_type_node = skip_type_parentheses(a, node_data.extends_type);
            // When the check and extends types are simple tuple types of the same arity, we defer resolution of the conditional type when any tuple elements are generic. This is such that non-distributable conditional types can be written `[X] extends [Y] ? ...` and be deferred similarly to `X extends Y ? ...`.
            let check_tuples = self.is_simple_tuple_type(check_type_node)
                && self.is_simple_tuple_type(extends_type_node)
                && a.elements(check_type_node).len() == a.elements(extends_type_node).len();
            let check_type_deferred = self.is_deferred_type(check_type, check_tuples);
            let mut combined_mapper = TypeMapperId::NIL;
            let infer_type_parameters = self.conditional_roots[root].infer_type_parameters;
            if infer_type_parameters.len() != 0 {
                // When we're looking at making an inference for an infer type, when we get its constraint, it'll automagically be instantiated with the context, so it doesn't need the mapper for the inference context - however the constraint may refer to another _root_, _uncloned_ `infer` type parameter [1], or to something mapped by `mapper` [2]. [1] Eg, if we have `Foo<T, U extends T>` and `Foo<number, infer B>` - `B` is constrained to `T`, which, in turn, has been instantiated as `number`. Conversely, if we have `Foo<infer A, infer B>`, `B` is still constrained to `T` and `T` is instantiated as `A`. [2] Eg, if we have `Foo<T, U extends T>` and `Foo<Q, infer B>` where `Q` is mapped by `mapper` into `number` - `B` is constrained to `T` which is in turn instantiated as `Q`, which is in turn instantiated as `number`. So we need to combine `context.nonFixingMapper` with `mapper` so their constraints can be instantiated in the context of `mapper` (otherwise they'd only get inference context information), and incorporate all of the component mappers into the combined mapper for the true and false members. This means we have two mappers that need applying: the original `mapper` used to create this conditional, and the mapper that maps the infer type parameter to its inference result (`context.mapper`).
                let context = self.new_inference_context(
                    infer_type_parameters,
                    SignatureId::NIL,
                    InferenceFlags::NONE,
                    TypeComparer::Nil,
                );
                if !mapper.is_nil() {
                    let non_fixing_mapper = self.inference_contexts[context].non_fixing_mapper;
                    let combined = self.combine_type_mappers(non_fixing_mapper, mapper);
                    self.inference_contexts[context].non_fixing_mapper = combined;
                }
                if !check_type_deferred {
                    // We don't want inferences from constraints as they may cause us to eagerly resolve the conditional type instead of deferring resolution. Also, we always want strict function types rules (i.e. proper contravariance) for inferences.
                    let inferences = self.inference_contexts[context].inferences;
                    self.infer_types(
                        inferences,
                        check_type,
                        extends_type,
                        InferencePriority::NO_CONSTRAINTS | InferencePriority::ALWAYS_STRICT,
                        false,
                    );
                }
                // It's possible for 'infer T' type parameters to be given uninstantiated constraints when the those type parameters are used in type references (see getInferredTypeParameterConstraint). For that reason we need context.mapper to be first in the combined mapper.
                let context_mapper = self.inference_contexts[context].mapper;
                combined_mapper = if !mapper.is_nil() {
                    self.combine_type_mappers(context_mapper, mapper)
                } else {
                    context_mapper
                };
            }
            // Instantiate the extends type including inferences for 'infer T' type parameters
            let inferred_extends_type = if !combined_mapper.is_nil() {
                self.instantiate_type(root_extends_type, combined_mapper)
            } else {
                extends_type
            };
            // We attempt to resolve the conditional type only when the check and extends types are non-generic
            if !check_type_deferred && !self.is_deferred_type(inferred_extends_type, check_tuples) {
                let inferred_extends_flags = self.types[inferred_extends_type].flags;
                let check_type_is_any = self.types[check_type].flags.intersects(TypeFlags::ANY);
                // Return falseType for a definitely false extends check. We check an instantiations of the two types with type parameters mapped to the wildcard type, the most permissive instantiations possible (the wildcard type is assignable to and from all types). If those are not related, then no instantiations will be and we can just return the false branch type.
                let mut definitely_false = false;
                if !inferred_extends_flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                    definitely_false = check_type_is_any;
                    if !definitely_false {
                        let permissive_check_type = self.get_permissive_instantiation(check_type);
                        let permissive_extends_type =
                            self.get_permissive_instantiation(inferred_extends_type);
                        definitely_false = !self
                            .is_type_assignable_to(permissive_check_type, permissive_extends_type);
                    }
                }
                if definitely_false {
                    // Return union of trueType and falseType for 'any' since it matches anything. Furthermore, for a distributive conditional type applied to the constraint of a type variable, include trueType if there are possible values of the check type that are also possible values of the extends type. We use a reverse assignability check as it is less expensive than the comparable relationship and avoids false positives of a non-empty intersection check.
                    let mut include_true_type = check_type_is_any;
                    if !include_true_type
                        && for_constraint
                        && !inferred_extends_flags.intersects(TypeFlags::NEVER)
                    {
                        let permissive_extends_type =
                            self.get_permissive_instantiation(inferred_extends_type);
                        include_true_type =
                            some_type(self, permissive_extends_type, &mut |c, t| {
                                let permissive_check_type =
                                    c.get_permissive_instantiation(check_type);
                                c.is_type_assignable_to(t, permissive_check_type)
                            });
                    }
                    if include_true_type {
                        let true_type = self.get_type_from_type_node(node_data.true_type);
                        let extra_type =
                            self.instantiate_type(true_type, or_else(combined_mapper, mapper));
                        extra_types.push(extra_type);
                    }
                    // If falseType is an immediately nested conditional type that isn't distributive or has an identical checkType, switch to that type and loop.
                    let false_type = self.get_type_from_type_node(node_data.false_type);
                    if self.types[false_type]
                        .flags
                        .intersects(TypeFlags::CONDITIONAL)
                    {
                        let new_root = self.as_conditional_type(false_type).root;
                        if a.parent(self.conditional_roots[new_root].node) == root_node
                            && (!self.conditional_roots[new_root].is_distributive
                                || self.conditional_roots[new_root].check_type == root_check_type)
                        {
                            root = new_root;
                            continue;
                        }
                        let (new_root, new_root_mapper) =
                            self.get_tail_recursion_root(false_type, mapper);
                        if !new_root.is_nil() {
                            root = new_root;
                            mapper = new_root_mapper;
                            alias = TypeAliasId::NIL;
                            if !self.conditional_roots[new_root].alias.is_nil() {
                                tail_count += 1;
                            }
                            continue;
                        }
                    }
                    break self.instantiate_type(false_type, mapper);
                }
                // Return trueType for a definitely true extends check. We check instantiations of the two types with type parameters mapped to their restrictive form, i.e. a form of the type parameter that has no constraint. This ensures that, for example, the type `type Foo<T extends { x: any }> = T extends { x: string } ? string : number` doesn't immediately resolve to 'string' instead of being deferred.
                let mut definitely_true =
                    inferred_extends_flags.intersects(TypeFlags::ANY_OR_UNKNOWN);
                if !definitely_true {
                    let restrictive_check_type = self.get_restrictive_instantiation(check_type);
                    let restrictive_extends_type =
                        self.get_restrictive_instantiation(inferred_extends_type);
                    definitely_true = self
                        .is_type_assignable_to(restrictive_check_type, restrictive_extends_type);
                }
                if definitely_true {
                    let true_type = self.get_type_from_type_node(node_data.true_type);
                    let true_mapper = or_else(combined_mapper, mapper);
                    let (new_root, new_root_mapper) =
                        self.get_tail_recursion_root(true_type, true_mapper);
                    if !new_root.is_nil() {
                        root = new_root;
                        mapper = new_root_mapper;
                        alias = TypeAliasId::NIL;
                        if !self.conditional_roots[new_root].alias.is_nil() {
                            tail_count += 1;
                        }
                        continue;
                    }
                    break self.instantiate_type(true_type, true_mapper);
                }
            }
            // Return a deferred type for a check that is neither definitely true nor definitely false
            let deferred = self.new_conditional_type(root, mapper, combined_mapper);
            let deferred_alias = if !alias.is_nil() {
                alias
            } else {
                let root_alias = self.conditional_roots[root].alias;
                self.instantiate_type_alias(root_alias, mapper)
            };
            self.types[deferred].alias = deferred_alias;
            break deferred;
        };
        if !extra_types.is_empty() {
            extra_types.push(result);
            return self.get_union_type(List::from_slice(&extra_types));
        }
        result
    }

    // We tail-recurse for generic conditional types that (a) have not already been evaluated and cached, and (b) are non distributive, have a check type that is unaffected by instantiation, or have a non-union check type. Note that recursion is possible only through aliased conditional types, so we only increment the tail recursion counter for those.
    pub fn get_tail_recursion_root(
        &mut self,
        new_type: TypeId,
        new_mapper: TypeMapperId,
    ) -> (ConditionalRootId, TypeMapperId) {
        if self.types[new_type]
            .flags
            .intersects(TypeFlags::CONDITIONAL)
            && !new_mapper.is_nil()
        {
            let new_root = self.as_conditional_type(new_type).root;
            let outer_type_parameters = self.conditional_roots[new_root].outer_type_parameters;
            if outer_type_parameters.len() != 0 {
                let type_mapper = self.as_conditional_type(new_type).mapper;
                let type_param_mapper = self.combine_type_mappers(type_mapper, new_mapper);
                let type_arguments =
                    self.map_list(outer_type_parameters, |c, t| c.map(type_param_mapper, t));
                let new_root_mapper = new_type_mapper(self, outer_type_parameters, type_arguments);
                let root_check_type = self.conditional_roots[new_root].check_type;
                let mut new_check_type = TypeId::NIL;
                if self.conditional_roots[new_root].is_distributive {
                    new_check_type = self.map(new_root_mapper, root_check_type);
                }
                if new_check_type.is_nil()
                    || new_check_type == root_check_type
                    || !self.types[new_check_type]
                        .flags
                        .intersects(TypeFlags::UNION | TypeFlags::NEVER)
                {
                    return (new_root, new_root_mapper);
                }
            }
        }
        (ConditionalRootId::NIL, TypeMapperId::NIL)
    }

    pub fn is_simple_tuple_type(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_tuple_type_node(a, node)
            && !a.elements(node).as_slice().is_empty()
            && !a.elements(node).as_slice().iter().any(|&e| {
                is_optional_type_node(a, e)
                    || is_rest_type_node(a, e)
                    || is_named_tuple_member(a, e)
                        && (!a.question_token(e).is_nil()
                            || !a.as_named_tuple_member(e).dot_dot_dot_token.is_nil())
            })
    }

    pub fn is_deferred_type(&mut self, t: TypeId, check_tuples: bool) -> bool {
        if self.is_generic_type(t) {
            return true;
        }
        if check_tuples && is_tuple_type(self, t) {
            let element_types = self.get_element_types(t);
            return element_types
                .as_slice()
                .iter()
                .any(|&element_type| self.is_generic_type(element_type));
        }
        false
    }

    pub fn get_permissive_instantiation(&mut self, t: TypeId) -> TypeId {
        if self.types[t]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::ANY_OR_UNKNOWN | TypeFlags::NEVER)
        {
            return t;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::PERMISSIVE_INSTANTIATION,
            type_id: t,
        };
        let cached = self.cached_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let permissive_mapper = self.permissive_mapper;
        let result = self.instantiate_type(t, permissive_mapper);
        let ok = self.cached_types.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn get_restrictive_instantiation(&mut self, t: TypeId) -> TypeId {
        if self.types[t]
            .flags
            .intersects(TypeFlags::PRIMITIVE | TypeFlags::ANY_OR_UNKNOWN | TypeFlags::NEVER)
        {
            return t;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::RESTRICTIVE_INSTANTIATION,
            type_id: t,
        };
        let cached = self.cached_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let restrictive_mapper = self.restrictive_mapper;
        let result = self.instantiate_type(t, restrictive_mapper);
        let ok = self.cached_types.set(key, result);
        self.map_set(ok);
        // We set the following so we don't attempt to set the restrictive instance of a restrictive instance which is redundant - we'll produce new type identities, but all type params have already been mapped. This also gives us a way to detect restrictive instances upon comparisons and _disable_ the "distributeive constraint" assignability check for them, which is distinctly unsafe, as once you have a restrctive instance, all the type parameters are constrained to `unknown` and produce tons of false positives/negatives!
        let result_key = CachedTypeKey {
            kind: CachedTypeKind::RESTRICTIVE_INSTANTIATION,
            type_id: result,
        };
        let ok = self.cached_types.set(result_key, result);
        self.map_set(ok);
        result
    }

    pub fn get_restrictive_type_parameter(&mut self, t: TypeId) -> TypeId {
        let constraint = self.as_type_parameter(t).constraint;
        if constraint.is_nil() && self.get_constraint_declaration(t).is_nil()
            || constraint == self.no_constraint_type
        {
            return t;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::RESTRICTIVE_TYPE_PARAMETER,
            type_id: t,
        };
        let cached = self.cached_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let symbol = self.types[t].symbol;
        let result = self.new_type_parameter(symbol);
        let no_constraint_type = self.no_constraint_type;
        self.as_type_parameter_mut(result).constraint = no_constraint_type;
        let ok = self.cached_types.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn restrictive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.get_restrictive_type_parameter(t);
        }
        t
    }

    pub fn permissive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.wildcard_type;
        }
        t
    }

    pub fn get_true_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self.as_conditional_type(t).resolved_true_type.is_nil() {
            let root = self.as_conditional_type(t).root;
            let root_node = self.conditional_roots[root].node;
            let true_type_node = self.ast.as_conditional_type_node(root_node).true_type;
            let true_type = self.get_type_from_type_node(true_type_node);
            let mapper = self.as_conditional_type(t).mapper;
            let resolved = self.instantiate_type(true_type, mapper);
            self.as_conditional_type_mut(t).resolved_true_type = resolved;
        }
        self.as_conditional_type(t).resolved_true_type
    }

    pub fn get_false_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self.as_conditional_type(t).resolved_false_type.is_nil() {
            let root = self.as_conditional_type(t).root;
            let root_node = self.conditional_roots[root].node;
            let false_type_node = self.ast.as_conditional_type_node(root_node).false_type;
            let false_type = self.get_type_from_type_node(false_type_node);
            let mapper = self.as_conditional_type(t).mapper;
            let resolved = self.instantiate_type(false_type, mapper);
            self.as_conditional_type_mut(t).resolved_false_type = resolved;
        }
        self.as_conditional_type(t).resolved_false_type
    }

    pub fn get_inferred_true_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self
            .as_conditional_type(t)
            .resolved_inferred_true_type
            .is_nil()
        {
            let combined_mapper = self.as_conditional_type(t).combined_mapper;
            let resolved = if !combined_mapper.is_nil() {
                let root = self.as_conditional_type(t).root;
                let root_node = self.conditional_roots[root].node;
                let true_type_node = self.ast.as_conditional_type_node(root_node).true_type;
                let true_type = self.get_type_from_type_node(true_type_node);
                self.instantiate_type(true_type, combined_mapper)
            } else {
                self.get_true_type_from_conditional_type(t)
            };
            self.as_conditional_type_mut(t).resolved_inferred_true_type = resolved;
        }
        self.as_conditional_type(t).resolved_inferred_true_type
    }

    pub fn get_type_from_infer_type_node(&mut self, node: NodeId) -> TypeId {
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let symbol =
                self.get_symbol_of_declaration(self.ast.as_infer_type_node(node).type_parameter);
            let t = self.get_declared_type_of_type_parameter(symbol);
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_import_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let n = a.as_import_type_node(node);
            if !is_literal_import_type_node(a, node) {
                self.error(n.argument, diagnostics::STRING_LITERAL_EXPECTED, &[]);
                let symbol_links = self.symbol_node_links.get(node);
                self.symbol_node_links[symbol_links].resolved_symbol = self.unknown_symbol;
                self.type_node_links[links].resolved_type = self.error_type;
                return self.type_node_links[links].resolved_type;
            }
            let target_meaning = if n.is_type_of {
                SymbolFlags::VALUE
            } else {
                SymbolFlags::TYPE
            };
            let module_name = a.as_literal_type_node(n.argument).literal;
            let inner_module_symbol = self.resolve_external_module_name(node, module_name, false);
            if inner_module_symbol.is_nil() {
                let symbol_links = self.symbol_node_links.get(node);
                self.symbol_node_links[symbol_links].resolved_symbol = self.unknown_symbol;
                self.type_node_links[links].resolved_type = self.error_type;
                return self.type_node_links[links].resolved_type;
            }
            let module_symbol = self.resolve_external_module_symbol(inner_module_symbol, false);
            if !node_is_missing(a, n.qualifier) {
                let name_chain = self.get_identifier_chain(n.qualifier);
                let mut current_namespace = module_symbol;
                for (i, &current) in name_chain.iter().enumerate() {
                    let meaning = if i + 1 == name_chain.len() {
                        target_meaning
                    } else {
                        SymbolFlags::NAMESPACE
                    };
                    // typeof a.b.c is normally resolved using `checkExpression` which in turn defers to `checkQualifiedName`. That, in turn, ultimately uses `getPropertyOfType` on the type of the symbol, which differs slightly from the `exports` lookup process that only looks up namespace members which is used for most type references
                    let resolved_namespace = self.resolve_symbol(current_namespace);
                    let merged_resolved_symbol = self.get_merged_symbol(resolved_namespace);
                    let mut symbol_from_variable = SymbolId::NIL;
                    let mut symbol_from_module = SymbolId::NIL;
                    if n.is_type_of {
                        let namespace_type = self.get_type_of_symbol(merged_resolved_symbol);
                        symbol_from_variable = self.get_property_of_type_ex(
                            namespace_type,
                            a.text(current),
                            false,
                            true,
                        );
                    } else {
                        let exports = self.get_exports_of_symbol(merged_resolved_symbol);
                        symbol_from_module = self.get_symbol(exports, a.text(current), meaning);
                        if symbol_from_module.is_nil() {
                            // a CommonJS module might have typedefs exported alongside an export=
                            let immediate_module_symbol =
                                self.resolve_external_module_symbol(inner_module_symbol, true);
                            if !immediate_module_symbol.is_nil()
                                && a.sym(immediate_module_symbol)
                                    .declarations
                                    .as_slice()
                                    .iter()
                                    .any(|&d| {
                                        get_assignment_declaration_kind(a, d)
                                            == JSDeclarationKind::MODULE_EXPORTS
                                    })
                            {
                                let exports = self
                                    .get_exports_of_symbol(a.sym(immediate_module_symbol).parent);
                                symbol_from_module =
                                    self.get_symbol(exports, a.text(current), meaning);
                            }
                        }
                    }
                    let next = or_else(symbol_from_module, symbol_from_variable);
                    if next.is_nil() {
                        let namespace_name =
                            self.get_fully_qualified_name(current_namespace, NodeId::NIL);
                        let declaration_name = declaration_name_to_string(a, current);
                        self.error(
                            current,
                            diagnostics::NAMESPACE_0_HAS_NO_EXPORTED_MEMBER_1,
                            &[Arg::Str(&namespace_name), Arg::Str(&declaration_name)],
                        );
                        self.type_node_links[links].resolved_type = self.error_type;
                        return self.type_node_links[links].resolved_type;
                    }
                    let current_links = self.symbol_node_links.get(current);
                    self.symbol_node_links[current_links].resolved_symbol = next;
                    let parent_links = self.symbol_node_links.get(a.parent(current));
                    self.symbol_node_links[parent_links].resolved_symbol = next;
                    current_namespace = next;
                }
                let resolved =
                    self.resolve_import_symbol_type(node, current_namespace, target_meaning);
                self.type_node_links[links].resolved_type = resolved;
            } else {
                let module_flags = self.get_symbol_flags(module_symbol);
                if module_flags.intersects(target_meaning) {
                    let resolved =
                        self.resolve_import_symbol_type(node, module_symbol, target_meaning);
                    self.type_node_links[links].resolved_type = resolved;
                } else {
                    let message = if target_meaning == SymbolFlags::VALUE {
                        diagnostics::MODULE_0_DOES_NOT_REFER_TO_A_VALUE_BUT_IS_USED_AS_A_VALUE_HERE
                    } else {
                        diagnostics::MODULE_0_DOES_NOT_REFER_TO_A_TYPE_BUT_IS_USED_AS_A_TYPE_HERE_DID_YOU_MEAN_TYPEOF_IMPORT_0
                    };
                    self.error(node, message, &[Arg::Str(a.text(module_name))]);
                    let symbol_links = self.symbol_node_links.get(node);
                    self.symbol_node_links[symbol_links].resolved_symbol = self.unknown_symbol;
                    self.type_node_links[links].resolved_type = self.error_type;
                }
            }
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_identifier_chain(&self, node: NodeId) -> Vec<NodeId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if is_identifier(a, node) {
            return vec![node];
        }
        let qualified = a.as_qualified_name(node);
        // A node that is no qualified name ends the chain: its cast is recorded, where upstream panics.
        if !is_qualified_name(a, node) {
            return Vec::new();
        }
        let mut chain = self.get_identifier_chain(qualified.left);
        chain.push(qualified.right);
        chain
    }

    pub fn resolve_import_symbol_type(
        &mut self,
        node: NodeId,
        symbol: SymbolId,
        meaning: SymbolFlags,
    ) -> TypeId {
        let resolved_symbol = self.resolve_symbol(symbol);
        let links = self.symbol_node_links.get(node);
        self.symbol_node_links[links].resolved_symbol = resolved_symbol;
        if meaning == SymbolFlags::VALUE {
            // intentionally doesn't use resolved symbol so type is cached as expected on the alias
            let expr_type = self.get_type_of_symbol(symbol);
            return self.get_instantiation_expression_type(expr_type, node);
        }
        // getTypeReferenceType doesn't handle aliases - it must get the resolved symbol
        self.get_type_reference_type(node, resolved_symbol)
    }

    pub fn create_type_from_generic_global_type(
        &mut self,
        generic_global_type: TypeId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeId {
        if generic_global_type != self.empty_generic_type {
            return self.create_type_reference(generic_global_type, type_arguments);
        }
        self.empty_object_type
    }

    pub fn get_global_strict_function_type(&mut self, name: &[u8]) -> TypeId {
        if self.strict_bind_call_apply {
            return self.get_global_type(name, 0, true);
        }
        self.global_function_type
    }

    pub fn get_global_import_meta_expression_type(&mut self) -> TypeId {
        if self.deferred_global_import_meta_expression_type.is_nil() {
            let a = self.ast;
            // Create a synthetic type `ImportMetaExpression { meta: MetaProperty }`
            let symbol = self.new_symbol(SymbolFlags::NONE, b"ImportMetaExpression");
            let import_meta_type = self.get_global_import_meta_type();
            let meta_property_symbol =
                self.new_symbol_ex(SymbolFlags::PROPERTY, b"meta", CheckFlags::READONLY);
            a.update_symbol(meta_property_symbol, |s| s.parent = symbol);
            let links = self.value_symbol_links_get(meta_property_symbol);
            self.value_symbol_links[links].resolved_type = import_meta_type;
            let members = create_symbol_table(a, &[meta_property_symbol]);
            a.update_symbol(symbol, |s| s.members = members);
            let t = self.new_anonymous_type(symbol, members, List::NIL, List::NIL, List::NIL);
            self.deferred_global_import_meta_expression_type = t;
        }
        self.deferred_global_import_meta_expression_type
    }

    pub fn create_iterable_type(&mut self, iterated_type: TypeId) -> TypeId {
        let generic_global_type = self.get_global_iterable_type_checked();
        let type_arguments = self.list_of(&[iterated_type, self.void_type, self.undefined_type]);
        self.create_type_from_generic_global_type(generic_global_type, type_arguments)
    }

    pub fn create_array_type(&mut self, element_type: TypeId) -> TypeId {
        self.create_array_type_ex(element_type, false)
    }

    pub fn create_array_type_ex(&mut self, element_type: TypeId, readonly: bool) -> TypeId {
        let generic_global_type = if readonly {
            self.global_readonly_array_type
        } else {
            self.global_array_type
        };
        let type_arguments = self.list_of(&[element_type]);
        self.create_type_from_generic_global_type(generic_global_type, type_arguments)
    }

    pub fn get_tuple_element_flags(&self, node: NodeId) -> ElementFlags {
        let a = self.ast;
        match a.kind(node) {
            Kind::OptionalType => ElementFlags::OPTIONAL,
            Kind::RestType => {
                if !self.get_array_element_type_node(a.type_node(node)).is_nil() {
                    ElementFlags::REST
                } else {
                    ElementFlags::VARIADIC
                }
            }
            Kind::NamedTupleMember => {
                let named = a.as_named_tuple_member(node);
                if !named.question_token.is_nil() {
                    return ElementFlags::OPTIONAL;
                }
                if !named.dot_dot_dot_token.is_nil() {
                    return if !self.get_array_element_type_node(named.type_node).is_nil() {
                        ElementFlags::REST
                    } else {
                        ElementFlags::VARIADIC
                    };
                }
                ElementFlags::REQUIRED
            }
            _ => ElementFlags::REQUIRED,
        }
    }

    pub fn get_tuple_element_info(&self, node: NodeId) -> TupleElementInfo {
        let a = self.ast;
        TupleElementInfo {
            flags: self.get_tuple_element_flags(node),
            labeled_declaration: if is_named_tuple_member(a, node)
                || is_parameter_declaration(a, node)
            {
                node
            } else {
                NodeId::NIL
            },
        }
    }

    pub fn create_tuple_type(&mut self, element_types: List<'a, TypeId>) -> TypeId {
        let element_infos: Vec<TupleElementInfo> = element_types
            .as_slice()
            .iter()
            .map(|_| TupleElementInfo {
                flags: ElementFlags::REQUIRED,
                labeled_declaration: NodeId::NIL,
            })
            .collect();
        self.create_tuple_type_ex(element_types, List::from_slice(&element_infos), false)
    }

    pub fn create_tuple_type_ex(
        &mut self,
        element_types: List<'a, TypeId>,
        element_infos: List<'_, TupleElementInfo>,
        readonly: bool,
    ) -> TypeId {
        let tuple_target = self.get_tuple_target_type(element_infos, readonly);
        if tuple_target == self.empty_generic_type {
            return self.empty_object_type;
        }
        if !element_types.as_slice().is_empty() {
            return self.create_normalized_type_reference(tuple_target, element_types);
        }
        tuple_target
    }

    pub fn get_tuple_target_type(
        &mut self,
        element_infos: List<'_, TupleElementInfo>,
        readonly: bool,
    ) -> TypeId {
        let infos = element_infos.as_slice();
        if infos.len() == 1 && at(infos, 0).flags.intersects(ElementFlags::REST) {
            // [...X[]] is equivalent to just X[]
            if readonly {
                return self.global_readonly_array_type;
            }
            return self.global_array_type;
        }
        let key = get_tuple_key(element_infos, readonly);
        let mut t = self.tuple_types.get(&key);
        if t.is_nil() {
            t = self.create_tuple_target_type(element_infos, readonly);
            let ok = self.tuple_types.set(key, t);
            self.map_set(ok);
        }
        t
    }

    // We represent tuple types as type references to synthesized generic interface types created by this function. The types are of the form: interface Tuple<T0, T1, T2, ...> extends Array<T0 | T1 | T2 | ...> { 0: T0, 1: T1, 2: T2, ... }. Note that the generic type created by this function has no symbol associated with it. The same is true for each of the synthesized type parameters.
    pub fn create_tuple_target_type(
        &mut self,
        element_infos: List<'_, TupleElementInfo>,
        readonly: bool,
    ) -> TypeId {
        let a = self.ast;
        let infos = element_infos.as_slice();
        let arity = infos.len();
        let min_length = infos
            .iter()
            .filter(|e| {
                e.flags
                    .intersects(ElementFlags::REQUIRED | ElementFlags::VARIADIC)
            })
            .count();
        let mut type_parameters: Vec<TypeId> = Vec::with_capacity(arity);
        let members = a.new_table();
        let mut combined_flags = ElementFlags::NONE;
        let check_flags = if readonly {
            CheckFlags::READONLY
        } else {
            CheckFlags::NONE
        };
        for (i, info) in infos.iter().enumerate() {
            let type_parameter = self.new_type_parameter(SymbolId::NIL);
            type_parameters.push(type_parameter);
            let flags = info.flags;
            combined_flags |= flags;
            if !combined_flags.intersects(ElementFlags::VARIABLE) {
                let optional_flags = if flags.intersects(ElementFlags::OPTIONAL) {
                    SymbolFlags::OPTIONAL
                } else {
                    SymbolFlags::NONE
                };
                let symbol_flags = SymbolFlags::PROPERTY | optional_flags;
                let name = self.text(i.to_string().as_bytes());
                let property = self.new_symbol_ex(symbol_flags, name, check_flags);
                let links = self.value_symbol_links_get(property);
                self.value_symbol_links[links].resolved_type = type_parameter;
                a.table_set(members, name, property);
            }
        }
        let fixed_length = a.table_len(members);
        let length_symbol = self.new_symbol_ex(SymbolFlags::PROPERTY, b"length", check_flags);
        if combined_flags.intersects(ElementFlags::VARIABLE) {
            let number_type = self.number_type;
            let links = self.value_symbol_links_get(length_symbol);
            self.value_symbol_links[links].resolved_type = number_type;
        } else {
            let mut literal_types: Vec<TypeId> = Vec::new();
            for i in min_length..=arity {
                let literal_type = self.get_number_literal_type(Number(i as f64));
                literal_types.push(literal_type);
            }
            let links = self.value_symbol_links_get(length_symbol);
            let length_type = self.get_union_type(List::from_slice(&literal_types));
            self.value_symbol_links[links].resolved_type = length_type;
        }
        a.table_set(members, b"length", length_symbol);
        let t = self.new_object_type(ObjectFlags::TUPLE | ObjectFlags::REFERENCE, SymbolId::NIL);
        let this_type = self.new_type_parameter(SymbolId::NIL);
        self.as_interface_type_mut(t).this_type = this_type;
        self.as_type_parameter_mut(this_type).is_this_type = true;
        self.as_type_parameter_mut(this_type).constraint = t;
        type_parameters.push(this_type);
        let all_type_parameters = self.list_of(&type_parameters);
        self.as_interface_type_mut(t).all_type_parameters = all_type_parameters;
        self.as_object_type_mut(t).instantiations = Map::make();
        let own_type_parameters = self.as_interface_type(t).type_parameters();
        let key = get_type_list_key(own_type_parameters);
        let ok = self.as_object_type_mut(t).instantiations.set(key, t);
        self.map_set(ok);
        self.as_object_type_mut(t).target = t;
        self.as_type_reference_mut(t).resolved_type_arguments = own_type_parameters;
        self.as_interface_type_mut(t).declared_members_resolved = true;
        self.as_interface_type_mut(t).declared_members = members;
        let stored_infos = self.list_of(infos);
        let d = self.as_tuple_type_mut(t);
        d.element_infos = stored_infos;
        d.min_length = min_length as isize;
        d.fixed_length = fixed_length;
        d.combined_flags = combined_flags;
        d.readonly = readonly;
        t
    }

    pub fn get_element_type_of_slice_of_tuple_type(
        &mut self,
        t: TypeId,
        index: isize,
        end_skip_count: isize,
        writing: bool,
        no_reductions: bool,
    ) -> TypeId {
        let length = self.get_type_reference_arity(t) - end_skip_count;
        let element_infos = self.type_target_tuple_type(t).element_infos.as_slice();
        if index < length {
            let type_arguments = self.get_type_arguments(t).as_slice();
            let mut element_types: Vec<TypeId> = Vec::new();
            let mut i = index;
            while i < length {
                let position = usize::try_from(i).unwrap_or(usize::MAX);
                let mut e = at(type_arguments, position);
                if at(element_infos, position)
                    .flags
                    .intersects(ElementFlags::VARIADIC)
                {
                    let number_type = self.number_type;
                    e = self.get_indexed_access_type(e, number_type);
                }
                element_types.push(e);
                i += 1;
            }
            if writing {
                return self.get_intersection_type(List::from_slice(&element_types));
            }
            let reduction = if no_reductions {
                UnionReduction::NONE
            } else {
                UnionReduction::LITERAL
            };
            return self.get_union_type_ex(
                List::from_slice(&element_types),
                reduction,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        TypeId::NIL
    }

    pub fn get_rest_type_of_tuple_type(&mut self, t: TypeId) -> TypeId {
        let fixed_length = self.type_target_tuple_type(t).fixed_length;
        self.get_element_type_of_slice_of_tuple_type(t, fixed_length, 0, false, false)
    }

    pub fn get_tuple_element_type_out_of_start_count(
        &mut self,
        t: TypeId,
        index: Number,
        undefined_like_type: TypeId,
    ) -> TypeId {
        self.map_type(t, &mut |c, t| {
            let rest_type = c.get_rest_type_of_tuple_type(t);
            if rest_type.is_nil() {
                return c.undefined_type;
            }
            if !undefined_like_type.is_nil()
                && index.0 >= get_total_fixed_element_count(c.type_target_tuple_type(t)) as f64
            {
                return c.get_union_type(List::from_slice(&[rest_type, undefined_like_type]));
            }
            rest_type
        })
    }

    pub fn is_generic_type(&mut self, t: TypeId) -> bool {
        self.get_generic_object_flags(t) != ObjectFlags::NONE
    }

    pub fn is_generic_object_type(&mut self, t: TypeId) -> bool {
        self.get_generic_object_flags(t)
            .intersects(ObjectFlags::IS_GENERIC_OBJECT_TYPE)
    }

    pub fn is_generic_index_type(&mut self, t: TypeId) -> bool {
        self.get_generic_object_flags(t)
            .intersects(ObjectFlags::IS_GENERIC_INDEX_TYPE)
    }

    pub fn get_generic_object_flags(&mut self, t: TypeId) -> ObjectFlags {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return ObjectFlags::NONE;
        }
        let mut combined_flags = ObjectFlags::NONE;
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION | TypeFlags::SUBSTITUTION)
        {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_GENERIC_TYPE_COMPUTED)
            {
                if self.types[t]
                    .flags
                    .intersects(TypeFlags::UNION_OR_INTERSECTION)
                {
                    let types = self.type_types(t);
                    for &u in types.as_slice() {
                        combined_flags |= self.get_generic_object_flags(u);
                    }
                } else {
                    let base_type = self.as_substitution_type(t).base_type;
                    let constraint = self.as_substitution_type(t).constraint;
                    let base_flags = self.get_generic_object_flags(base_type);
                    let constraint_flags = self.get_generic_object_flags(constraint);
                    combined_flags = base_flags | constraint_flags;
                }
                self.types[t].object_flags |=
                    ObjectFlags::IS_GENERIC_TYPE_COMPUTED | combined_flags;
            }
            return self.types[t].object_flags & ObjectFlags::IS_GENERIC_TYPE;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
            || self.is_generic_mapped_type(t)
            || self.is_generic_tuple_type(t)
        {
            combined_flags |= ObjectFlags::IS_GENERIC_OBJECT_TYPE;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE | TypeFlags::INDEX)
            || self.is_generic_string_like_type(t)
        {
            combined_flags |= ObjectFlags::IS_GENERIC_INDEX_TYPE;
        }
        combined_flags
    }

    pub fn is_generic_tuple_type(&self, t: TypeId) -> bool {
        is_tuple_type(self, t)
            && self
                .type_target_tuple_type(t)
                .combined_flags
                .intersects(ElementFlags::VARIADIC)
    }

    pub fn is_generic_mapped_type(&mut self, t: TypeId) -> bool {
        if self.types[t].object_flags.intersects(ObjectFlags::MAPPED) {
            let constraint = self.get_constraint_type_from_mapped_type(t);
            if self.is_generic_index_type(constraint) {
                return true;
            }
            // A mapped type is generic if the 'as' clause references generic types other than the iteration type. To determine this, we substitute the constraint type (that we now know isn't generic) for the iteration type and check whether the resulting type is generic.
            let name_type = self.get_name_type_from_mapped_type(t);
            if !name_type.is_nil() {
                let type_parameter = self.get_type_parameter_from_mapped_type(t);
                let mapper = new_simple_type_mapper(self, type_parameter, constraint);
                let instantiated = self.instantiate_type(name_type, mapper);
                if self.is_generic_index_type(instantiated) {
                    return true;
                }
            }
        }
        false
    }

    // A union type which is reducible upon instantiation (meaning some members are removed under certain instantiations) must be kept generic, as that instantiation information needs to flow through the type system. By replacing all type parameters in the union with a special never type that is treated as a literal in `getReducedType`, we can cause the `getReducedType` logic to reduce the resulting type if possible (since only intersections with conflicting literal-typed properties are reducible).
    pub fn is_generic_reducible_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::UNION)
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::CONTAINS_INTERSECTIONS)
        {
            let types = self.type_types(t);
            for &u in types.as_slice() {
                if self.is_generic_reducible_type(u) {
                    return true;
                }
            }
        }
        self.types[t].flags.intersects(TypeFlags::INTERSECTION) && self.is_reducible_intersection(t)
    }

    pub fn is_reducible_intersection(&mut self, t: TypeId) -> bool {
        if self
            .as_intersection_type(t)
            .unique_literal_filled_instantiation
            .is_nil()
        {
            let mapper = self.unique_literal_mapper;
            let instantiation = self.instantiate_type(t, mapper);
            self.as_intersection_type_mut(t)
                .unique_literal_filled_instantiation = instantiation;
        }
        let instantiation = self
            .as_intersection_type(t)
            .unique_literal_filled_instantiation;
        self.get_reduced_type(instantiation) != instantiation
    }

    pub fn get_unique_literal_type_for_type_parameter(&self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.unique_literal_type;
        }
        t
    }

    pub fn get_conditional_flow_type_of_type(&mut self, t: TypeId, node: NodeId) -> TypeId {
        let a = self.ast;
        let mut node = node;
        let mut constraints: Vec<TypeId> = Vec::new();
        let mut covariant = true;
        while !node.is_nil() && !is_statement(a, node) && a.kind(node) != Kind::JSDoc {
            let parent = a.parent(node);
            // only consider variance flipped by parameter locations - `keyof` types would usually be considered variance inverting, but often get used in indexed accesses where they behave sortof invariantly, but our checking is lax
            if is_parameter_declaration(a, parent) {
                covariant = !covariant;
            }
            // Always substitute on type parameters, regardless of variance, since even in contravariant positions, they may rely on substituted constraints to be valid
            if (covariant || self.types[t].flags.intersects(TypeFlags::TYPE_VARIABLE))
                && is_conditional_type_node(a, parent)
                && node == a.as_conditional_type_node(parent).true_type
            {
                let data = a.as_conditional_type_node(parent);
                let constraint = self.get_implied_constraint(t, data.check_type, data.extends_type);
                if !constraint.is_nil() {
                    constraints.push(constraint);
                }
            } else if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER)
                && is_mapped_type_node(a, parent)
                && a.as_mapped_type_node(parent).name_type.is_nil()
                && node == a.type_node(parent)
            {
                let mapped_type = self.get_type_from_type_node(parent);
                let mapped_type_parameter = self.get_type_parameter_from_mapped_type(mapped_type);
                let actual_type_variable = self.get_actual_type_variable(t);
                if mapped_type_parameter == actual_type_variable {
                    let type_parameter = self.get_homomorphic_type_variable(mapped_type);
                    if !type_parameter.is_nil() {
                        let constraint = self.get_constraint_of_type_parameter(type_parameter);
                        if !constraint.is_nil()
                            && every_type(self, constraint, &mut |c, u| c.is_array_or_tuple_type(u))
                        {
                            let number_type = self.number_type;
                            let numeric_string_type = self.numeric_string_type;
                            let union = self.get_union_type(List::from_slice(&[
                                number_type,
                                numeric_string_type,
                            ]));
                            constraints.push(union);
                        }
                    }
                }
            }
            node = parent;
        }
        if !constraints.is_empty() {
            let intersection = self.get_intersection_type(List::from_slice(&constraints));
            return self.get_substitution_type(t, intersection);
        }
        t
    }

    pub fn get_implied_constraint(
        &mut self,
        t: TypeId,
        check_node: NodeId,
        extends_node: NodeId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return TypeId::NIL;
        }
        let a = self.ast;
        if is_unary_tuple_type_node(a, check_node) && is_unary_tuple_type_node(a, extends_node) {
            return self.get_implied_constraint(
                t,
                at(a.elements(check_node).as_slice(), 0),
                at(a.elements(extends_node).as_slice(), 0),
            );
        }
        let check_type = self.get_type_from_type_node(check_node);
        let actual_check_type = self.get_actual_type_variable(check_type);
        let actual_type_variable = self.get_actual_type_variable(t);
        if actual_check_type == actual_type_variable {
            return self.get_type_from_type_node(extends_node);
        }
        TypeId::NIL
    }
}

pub fn is_unary_tuple_type_node(a: Ast<'_>, node: NodeId) -> bool {
    is_tuple_type_node(a, node) && a.elements(node).as_slice().len() == 1
}
