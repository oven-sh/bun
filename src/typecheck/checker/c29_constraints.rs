// checker.go:17141-17469 (layers T-CONSTRAINT, T-DECLARED): constraints of types, type parameters, indexed access types and conditional types, the inferred constraint of an `infer` type parameter, the declared type of a class or interface and the test for an interface without `this`.
use crate::ast::{
    NodeFlags, NodeId, SymbolFlags, SymbolId, get_extends_heritage_clause_elements,
    get_heritage_clause_element_name, is_conditional_type_node, is_entity_name,
    is_entity_name_expression, is_infer_type_node, is_interface_declaration, is_mapped_type_node,
    is_named_tuple_member, is_parameter_declaration, is_parenthesized_type_node, is_rest_type_node,
    is_template_literal_type_span, is_type_parameter_declaration, is_type_reference_node,
    skip_parentheses,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ObjectFlags, TypeAliasId, TypeFlags, TypeId,
    get_type_list_key, is_type_any, new_deferred_type_mapper, new_simple_type_mapper,
    prepend_type_mapping,
};
use crate::core::{List, Map, find_index};

impl<'a> Checker<'a> {
    pub fn get_constraint_of_type(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.get_constraint_of_type_parameter(t);
        }
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            return self.get_constraint_of_indexed_access(t);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            return self.get_constraint_of_conditional_type(t);
        }
        self.get_base_constraint_of_type(t)
    }

    pub fn get_constraint_of_type_parameter(&mut self, type_parameter: TypeId) -> TypeId {
        if self.has_non_circular_base_constraint(type_parameter) {
            return self.get_constraint_from_type_parameter(type_parameter);
        }
        TypeId::NIL
    }

    pub fn has_non_circular_base_constraint(&mut self, t: TypeId) -> bool {
        self.get_resolved_base_constraint(t, &mut Vec::new()) != self.circular_constraint_type
    }

    // This is a worker function. Use getConstraintOfTypeParameter which guards against circular constraints
    pub fn get_constraint_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if !self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return TypeId::NIL;
        }
        let a = self.ast;
        if self.as_type_parameter(t).constraint.is_nil() {
            let mut constraint;
            let target = self.as_type_parameter(t).target;
            if !target.is_nil() {
                let target_constraint = self.get_constraint_of_type_parameter(target);
                let mapper = self.as_type_parameter(t).mapper;
                constraint = self.instantiate_type(target_constraint, mapper);
            } else {
                let constraint_declaration = self.get_constraint_declaration(t);
                if !constraint_declaration.is_nil() {
                    constraint = self.get_type_from_type_node(constraint_declaration);
                    if self.types[constraint].flags.intersects(TypeFlags::ANY)
                        && !self.is_error_type(constraint)
                    {
                        // use stringNumberSymbolType as the base constraint for mapped type key constraints (unknown isn;t assignable to that, but `any` was), use unknown otherwise
                        if is_mapped_type_node(a, a.parent(a.parent(constraint_declaration))) {
                            constraint = self.string_number_symbol_type;
                        } else {
                            constraint = self.unknown_type;
                        }
                    }
                } else {
                    constraint = self.get_inferred_type_parameter_constraint(t, false);
                }
            }
            if constraint.is_nil() {
                constraint = self.no_constraint_type;
            }
            self.as_type_parameter_mut(t).constraint = constraint;
        }
        let constraint = self.as_type_parameter(t).constraint;
        if constraint != self.no_constraint_type {
            return constraint;
        }
        TypeId::NIL
    }

    pub fn get_constraint_or_unknown_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        let result = self.get_constraint_from_type_parameter(t);
        if !result.is_nil() {
            return result;
        }
        self.unknown_type
    }

    pub fn get_inferred_type_parameter_constraint(
        &mut self,
        t: TypeId,
        omit_type_references: bool,
    ) -> TypeId {
        let a = self.ast;
        let mut inferences: Vec<TypeId> = Vec::new();
        let symbol = self.types[t].symbol;
        if !symbol.is_nil() && a.sym(symbol).declarations.len() != 0 {
            for &declaration in a.sym(symbol).declarations.as_slice() {
                if is_infer_type_node(a, a.parent(declaration)) {
                    // When an 'infer T' declaration is immediately contained in a type reference node (such as 'Foo<infer T>'), T's constraint is inferred from the constraint of the corresponding type parameter in 'Foo'. When multiple 'infer T' declarations are present, we form an intersection of the inferred constraint types.
                    let mut child = a.parent(declaration);
                    let mut parent = a.parent(child);
                    while !parent.is_nil() && is_parenthesized_type_node(a, parent) {
                        child = parent;
                        parent = a.parent(child);
                    }
                    if is_type_reference_node(a, parent) && !omit_type_references {
                        let type_parameters =
                            self.get_type_parameters_for_type_reference_or_import(parent);
                        if !type_parameters.is_nil() {
                            let index =
                                find_index(a.type_arguments(parent).as_slice(), |argument| {
                                    argument == child
                                });
                            if index >= 0 && index < type_parameters.len() {
                                let declared_constraint = self
                                    .get_constraint_of_type_parameter(type_parameters.at(index));
                                if !declared_constraint.is_nil() {
                                    // Type parameter constraints can reference other type parameters so constraints need to be instantiated. If instantiation produces the type parameter itself, we discard that inference. For example, in `type Foo<T extends string, U extends T> = [T, U]; type Bar<T> = T extends Foo<infer X, infer X> ? Foo<X, X> : T;` the instantiated constraint for U is X, so we discard that inference.
                                    let mapper = new_deferred_type_mapper(
                                        self,
                                        type_parameters,
                                        parent,
                                        type_parameters,
                                    );
                                    let constraint =
                                        self.instantiate_type(declared_constraint, mapper);
                                    if constraint != t {
                                        inferences.push(constraint);
                                    }
                                }
                            }
                        }
                    } else if is_parameter_declaration(a, parent)
                        && !a
                            .as_parameter_declaration(parent)
                            .dot_dot_dot_token
                            .is_nil()
                        || is_rest_type_node(a, parent)
                        || is_named_tuple_member(a, parent)
                            && !a.as_named_tuple_member(parent).dot_dot_dot_token.is_nil()
                    {
                        let array_type = self.create_array_type(self.unknown_type);
                        inferences.push(array_type);
                    } else if is_template_literal_type_span(a, parent) {
                        inferences.push(self.string_type);
                    } else if is_type_parameter_declaration(a, parent)
                        && is_mapped_type_node(a, a.parent(parent))
                    {
                        inferences.push(self.string_number_symbol_type);
                    } else if is_mapped_type_node(a, parent)
                        && !a.type_node(parent).is_nil()
                        && skip_parentheses(a, a.type_node(parent)) == a.parent(declaration)
                        && is_conditional_type_node(a, a.parent(parent))
                        && a.as_conditional_type_node(a.parent(parent)).extends_type == parent
                        && is_mapped_type_node(
                            a,
                            a.as_conditional_type_node(a.parent(parent)).check_type,
                        )
                        && !a
                            .type_node(a.as_conditional_type_node(a.parent(parent)).check_type)
                            .is_nil()
                    {
                        let check_mapped_type =
                            a.as_conditional_type_node(a.parent(parent)).check_type;
                        let node_type =
                            self.get_type_from_type_node(a.type_node(check_mapped_type));
                        let check_mapped_type_parameter =
                            a.as_mapped_type_node(check_mapped_type).type_parameter;
                        let type_parameter_symbol =
                            self.get_symbol_of_declaration(check_mapped_type_parameter);
                        let type_parameter =
                            self.get_declared_type_of_type_parameter(type_parameter_symbol);
                        let constraint_node = a
                            .as_type_parameter_declaration(check_mapped_type_parameter)
                            .constraint;
                        // core.IfElse evaluates both of its values: the type of the constraint node is asked for also when there is no such node.
                        let constraint_type = self.get_type_from_type_node(constraint_node);
                        let target = if !constraint_node.is_nil() {
                            constraint_type
                        } else {
                            self.string_number_symbol_type
                        };
                        let mapper = new_simple_type_mapper(self, type_parameter, target);
                        let instantiated = self.instantiate_type(node_type, mapper);
                        inferences.push(instantiated);
                    }
                }
            }
        }
        if !inferences.is_empty() {
            return self.get_intersection_type(List::from_slice(&inferences));
        }
        TypeId::NIL
    }

    pub fn get_type_parameters_for_type_reference_or_import(
        &mut self,
        node: NodeId,
    ) -> List<'a, TypeId> {
        let t = self.get_type_from_type_node(node);
        if !self.is_error_type(t) {
            let symbol = self.get_resolved_symbol_or_nil(node);
            if !symbol.is_nil() {
                return self.get_type_parameters_for_type_and_symbol(t, symbol);
            }
        }
        List::NIL
    }

    pub fn get_type_parameters_for_type_and_symbol(
        &mut self,
        t: TypeId,
        symbol: SymbolId,
    ) -> List<'a, TypeId> {
        if !self.is_error_type(t) {
            if self
                .ast
                .sym(symbol)
                .flags
                .intersects(SymbolFlags::TYPE_ALIAS)
            {
                let links = self.type_alias_links.get(symbol);
                let type_parameters = self.type_alias_links[links].type_parameters;
                if type_parameters.len() != 0 {
                    return type_parameters;
                }
            }
            if self.types[t]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            {
                let target = self.type_target(t);
                return self.as_interface_type(target).local_type_parameters();
            }
        }
        List::NIL
    }

    pub fn get_effective_type_argument_at_index(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
        index: isize,
    ) -> TypeId {
        let type_arguments = self.ast.type_arguments(node);
        if index < type_arguments.len() {
            return self.get_type_from_type_node(type_arguments.at(index));
        }
        self.get_effective_type_arguments(node, type_parameters)
            .at(index)
    }

    pub fn get_constraint_of_indexed_access(&mut self, t: TypeId) -> TypeId {
        if self.has_non_circular_base_constraint(t) {
            return self.get_constraint_from_indexed_access(t);
        }
        TypeId::NIL
    }

    pub fn get_constraint_from_indexed_access(&mut self, t: TypeId) -> TypeId {
        let object_type = self.as_indexed_access_type(t).object_type;
        let index_type = self.as_indexed_access_type(t).index_type;
        let access_flags = self.as_indexed_access_type(t).access_flags;
        if self.is_mapped_type_generic_indexed_access(t) {
            // For indexed access types of the form { [P in K]: E }[X], where K is non-generic and X is generic, we substitute an instantiation of E where P is replaced with X.
            return self.substitute_indexed_mapped_type(object_type, index_type);
        }
        let index_constraint = self.get_simplified_type_or_constraint(index_type);
        if !index_constraint.is_nil() && index_constraint != index_type {
            let indexed_access = self.get_indexed_access_type_or_undefined(
                object_type,
                index_constraint,
                access_flags,
                NodeId::NIL,
                TypeAliasId::NIL,
            );
            if !indexed_access.is_nil() {
                return indexed_access;
            }
        }
        let object_constraint = self.get_simplified_type_or_constraint(object_type);
        if !object_constraint.is_nil() && object_constraint != object_type {
            return self.get_indexed_access_type_or_undefined(
                object_constraint,
                index_type,
                access_flags,
                NodeId::NIL,
                TypeAliasId::NIL,
            );
        }
        TypeId::NIL
    }

    pub fn get_constraint_of_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self.has_non_circular_base_constraint(t) {
            return self.get_constraint_from_conditional_type(t);
        }
        TypeId::NIL
    }

    pub fn get_constraint_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        let constraint = self.get_constraint_of_distributive_conditional_type(t);
        if !constraint.is_nil() {
            return constraint;
        }
        self.get_default_constraint_of_conditional_type(t)
    }

    pub fn get_default_constraint_of_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self
            .as_conditional_type(t)
            .resolved_default_constraint
            .is_nil()
        {
            // An `any` branch of a conditional type would normally be viral - specifically, without special handling here, a conditional type with a single branch of type `any` would be assignable to anything, since it's constraint would simplify to just `any`. This result is _usually_ unwanted - so instead here we elide an `any` branch from the constraint type, in effect treating `any` like `never` rather than `unknown` in this location.
            let true_constraint = self.get_inferred_true_type_from_conditional_type(t);
            let false_constraint = self.get_false_type_from_conditional_type(t);
            let resolved_default_constraint = if is_type_any(self, true_constraint) {
                false_constraint
            } else if is_type_any(self, false_constraint) {
                true_constraint
            } else {
                self.get_union_type(List::from_slice(&[true_constraint, false_constraint]))
            };
            self.as_conditional_type_mut(t).resolved_default_constraint =
                resolved_default_constraint;
        }
        self.as_conditional_type(t).resolved_default_constraint
    }

    pub fn get_constraint_of_distributive_conditional_type(&mut self, t: TypeId) -> TypeId {
        if self
            .as_conditional_type(t)
            .resolved_constraint_of_distributive
            .is_nil()
        {
            // Check if we have a conditional type of the form 'T extends U ? X : Y', where T is a constrained type parameter. If so, create an instantiation of the conditional type where T is replaced with its constraint. We do this because if the constraint is a union type it will be distributed over the conditional type and possibly reduced. For example, 'T extends undefined ? never : T' removes 'undefined' from T. We skip returning a distributive constraint for a restrictive instantiation of a conditional type as the constraint for all type params (check type included) have been replace with `unknown`, which is going to produce even more false positive/negative results than the distribute constraint already does. Please note: the distributive constraint is a kludge for emulating what a negated type could to do filter a union - once negated types exist and are applied to the conditional false branch, this "constraint" likely doesn't need to exist.
            let root = self.as_conditional_type(t).root;
            let check_type = self.as_conditional_type(t).check_type;
            let key = CachedTypeKey {
                kind: CachedTypeKind::RESTRICTIVE_INSTANTIATION,
                type_id: t,
            };
            if self.conditional_roots[root].is_distributive && self.cached_types.get(&key) != t {
                let mut constraint = self.get_simplified_type(check_type, false);
                if constraint == check_type {
                    constraint = self.get_constraint_of_type(constraint);
                }
                if !constraint.is_nil() && constraint != check_type {
                    let root_check_type = self.conditional_roots[root].check_type;
                    let mapper = self.as_conditional_type(t).mapper;
                    let mapper = prepend_type_mapping(self, root_check_type, constraint, mapper);
                    let instantiated =
                        self.get_conditional_type_instantiation(t, mapper, true, TypeAliasId::NIL);
                    if !self.types[instantiated].flags.intersects(TypeFlags::NEVER) {
                        self.as_conditional_type_mut(t)
                            .resolved_constraint_of_distributive = instantiated;
                        return instantiated;
                    }
                }
            }
            let no_constraint_type = self.no_constraint_type;
            self.as_conditional_type_mut(t)
                .resolved_constraint_of_distributive = no_constraint_type;
        }
        let resolved = self
            .as_conditional_type(t)
            .resolved_constraint_of_distributive;
        if resolved != self.no_constraint_type {
            return resolved;
        }
        TypeId::NIL
    }

    pub fn get_declared_type_of_class_or_interface(&mut self, symbol: SymbolId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let kind = if self.ast.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
                ObjectFlags::CLASS
            } else {
                ObjectFlags::INTERFACE
            };
            let t = self.new_object_type(kind, symbol);
            self.declared_type_links[links].declared_type = t;
            let outer_type_parameters =
                self.get_outer_type_parameters_of_class_or_interface(symbol);
            let type_parameters = self
                .append_local_type_parameters_of_class_or_interface_or_type_alias(
                    outer_type_parameters,
                    symbol,
                );
            // A class or interface is generic if it has type parameters or a "this" type. We always give classes a "this" type because it is not feasible to analyze all members to determine if the "this" type escapes the class (in particular, property types inferred from initializers and method return types inferred from return statements are very hard to exhaustively analyze). We give interfaces a "this" type if we can't definitely determine that they are free of "this" references.
            if !type_parameters.is_nil()
                || kind == ObjectFlags::CLASS
                || !self.is_thisless_interface(symbol)
            {
                self.types[t].object_flags |= ObjectFlags::REFERENCE;
                let this_type = self.new_type_parameter(symbol);
                self.as_interface_type_mut(t).this_type = this_type;
                self.as_type_parameter_mut(this_type).is_this_type = true;
                self.as_type_parameter_mut(this_type).constraint = t;
                let mut all_type_parameters: Vec<TypeId> = type_parameters.as_slice().to_vec();
                all_type_parameters.push(this_type);
                let all_type_parameters = self.list_of(&all_type_parameters);
                self.as_interface_type_mut(t).all_type_parameters = all_type_parameters;
                self.as_interface_type_mut(t).outer_type_parameter_count =
                    outer_type_parameters.as_slice().len() as isize;
                let resolved_type_arguments = self.as_interface_type(t).type_parameters();
                self.as_type_reference_mut(t).resolved_type_arguments = resolved_type_arguments;
                self.as_object_type_mut(t).instantiations = Map::make();
                let key = get_type_list_key(resolved_type_arguments);
                let ok = self.as_object_type_mut(t).instantiations.set(key, t);
                self.map_set(ok);
                self.as_object_type_mut(t).target = t;
            }
        }
        self.declared_type_links[links].declared_type
    }

    // Returns true if the interface given by the symbol is free of "this" references. Specifically, the result is true if the interface itself contains no references to "this" in its body, if all base types are interfaces, and if none of the base interfaces have a "this" type.
    pub fn is_thisless_interface(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        for &declaration in a.sym(symbol).declarations.as_slice() {
            if is_interface_declaration(a, declaration) {
                if a.flags(declaration).intersects(NodeFlags::CONTAINS_THIS) {
                    return false;
                }
                let base_type_nodes = get_extends_heritage_clause_elements(a, declaration);
                for &node in base_type_nodes {
                    let name = get_heritage_clause_element_name(a, node);
                    if is_entity_name(a, name) || is_entity_name_expression(a, name) {
                        let base_symbol = self.resolve_entity_name(
                            name,
                            SymbolFlags::TYPE,
                            true,
                            false,
                            NodeId::NIL,
                        );
                        if base_symbol.is_nil()
                            || !a.sym(base_symbol).flags.intersects(SymbolFlags::INTERFACE)
                        {
                            return false;
                        }
                        let base_type = self.get_declared_type_of_class_or_interface(base_symbol);
                        if !self.as_interface_type(base_type).this_type.is_nil() {
                            return false;
                        }
                    }
                }
            }
        }
        true
    }
}
